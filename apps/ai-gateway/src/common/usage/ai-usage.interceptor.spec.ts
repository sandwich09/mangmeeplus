import { conservativeTimeoutUsage } from '../../modules/line-ai/infrastructure/provider/provider-usage-estimate';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import {
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2, AI_BUDGET_STEP_BOUNDS, aiBudgetInvocationKey, parseAiBudgetEnvelope, parseAiBudgetEnvelopeV2,
  createLineAiInputEvidence, type AiBudgetEnvelope, type AiBudgetGrantV2, type AiUsageEntry,
} from '@watchdog-bms/contracts';
import { AiUsageInterceptor, internalAiSourceRoute } from './ai-usage.interceptor';
import {
  appendUsage, currentBudgetState, currentUsageCompanyId, drainUsage, runWithUsageContext,
  type BudgetRequestState,
} from './usage-context';
import { pdfPageUpperBound, providerInputTokenUpperBound, v2RenderedInput, withAiBudgetEnvelope } from './ai-budget-provider';
import { createAiBudgetSeam, type AiBudgetSeam, type AiBudgetSettleOutcome, type AiBudgetStepOutcome, type AiBudgetStepV2Outcome } from './ai-budget-seam';
import {
  SETTLE_EVIDENCE_MAX_AGE_MS, SETTLE_EVIDENCE_MAX_ENTRIES,
  beginGuardedProviderCall, drainAiBudgetDurability, endGuardedProviderCall, enqueueSettleEvidence,
  guardedProviderCallsInFlight, resetSettleEvidence, runSettleEvidenceQueue, settleEvidenceDepth,
  type DurabilityLog, type SettleEvidenceOutcome,
} from './ai-budget-durability';
import { AiBudgetShutdownService } from './ai-budget-shutdown.service';
import type {
  IModelProvider, ProviderInput, ProviderOutput, ProviderToolsInput,
} from '../../modules/line-ai/infrastructure/provider/provider.port';

function entry(tag: string): AiUsageEntry {
  return {
    tag,
    modelId: 'test-model',
    ok: true,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    durationMs: 1,
  };
}

function context(body: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ body }) }) } as unknown as ExecutionContext;
}

/** Nest's real CallHandler is lazy — the route handler runs on subscribe, not on handle(). `defer`
 *  reproduces that, which is what makes this a genuine test of the ALS wiring. */
function handler(run: () => Promise<unknown>): CallHandler {
  return { handle: () => defer(run) } as CallHandler;
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function intercept(body: unknown, run: () => Promise<unknown>): Promise<unknown> {
  return firstValueFrom(new AiUsageInterceptor().intercept(context(body), handler(run)));
}

describe('AiUsageInterceptor', () => {
  it('attaches what the providers appended, seeded with the body companyId', async () => {
    let seen: string | undefined;
    const result = await intercept({ requestId: 'r-1', companyId: 'co-1' }, async () => {
      seen = currentUsageCompanyId();
      appendUsage(entry('crm.reply-draft'));
      return { requestId: 'r-1', status: 'ok' };
    });

    assert.equal(seen, 'co-1', 'the handler runs inside the collector, not beside it');
    const usage = (result as { usage?: AiUsageEntry[] }).usage;
    assert.deepEqual(usage?.map((e) => e.tag), ['crm.reply-draft']);
    assert.equal((result as { status: string }).status, 'ok');
  });

  it('falls back to userContext.companyId (the LINE turn shape)', async () => {
    let seen: string | undefined;
    await intercept({ requestId: 'r-2', userContext: { companyId: 'co-2' } }, async () => {
      seen = currentUsageCompanyId();
      return {};
    });
    assert.equal(seen, 'co-2');
  });

  it('leaves a response with no model call exactly as the handler returned it', async () => {
    const result = await intercept({ companyId: 'co-1' }, async () => ({ status: 'not_configured', errorCode: 'PROVIDER_CONFIG_MISSING' }));
    assert.deepEqual(result, { status: 'not_configured', errorCode: 'PROVIDER_CONFIG_MISSING' });
    assert.ok(!('usage' in (result as object)), 'no entries means no field, so old responses stay byte-identical');
  });

  it('does not mix entries between two concurrent invocations', async () => {
    const [first, second] = await Promise.all([
      intercept({ companyId: 'co-a' }, async () => {
        appendUsage(entry('a1'));
        await tick(5);
        appendUsage(entry('a2'));
        return { who: 'a' };
      }),
      intercept({ companyId: 'co-b' }, async () => {
        await tick(1);
        appendUsage(entry('b1'));
        await tick(8);
        return { who: 'b' };
      }),
    ]);

    assert.deepEqual((first as { usage: AiUsageEntry[] }).usage.map((e) => e.tag), ['a1', 'a2']);
    assert.deepEqual((second as { usage: AiUsageEntry[] }).usage.map((e) => e.tag), ['b1']);
  });

  it('keeps usage the handler already reported (AgentCore passthrough) instead of erasing it', async () => {
    const remote = entry('agentcore.remote');
    const result = await intercept({ userContext: { companyId: 'co-1' } }, async () => ({ replyText: 'ok', usage: [remote] }));
    assert.deepEqual((result as { usage: AiUsageEntry[] }).usage, [remote]);
  });

  it('lets a failing handler fail unchanged', async () => {
    await assert.rejects(
      () => intercept({ companyId: 'co-1' }, async () => { throw new Error('handler exploded'); }),
      (err: Error) => err.message === 'handler exploded',
    );
  });

  it('opens a v2 budget state only when the raw evidence, grant and both capabilities agree', async () => {
    const built = await createLineAiInputEvidence({
      turnKey: V2_GRANT.turnKey,
      parts: [{ partId: 'part-v2', eventIdHash: 'd'.repeat(64), acceptedAtMs: 1, rawText: 'ดูสต็อก' }],
    });
    assert.ok(built);
    let state: BudgetRequestState | undefined;
    await intercept({
      companyId: 'co-1', requestId: 'req-v2', messageText: built.messageText,
      inputEvidence: built.inputEvidence, budgetGrantV2: V2_GRANT,
      contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
    }, async () => {
      state = currentBudgetState();
      return {};
    });
    assert.equal(state?.status, 'active-v2');
    assert.equal(state?.status === 'active-v2' ? state.inputDigest : undefined, built.inputEvidence.joinedSha256);
  });
});

// ── Phase E1c: the SPLIT budget envelope (ADR 0013 §6, spec §12.3/§12.6) ──────
//
// The envelope machinery is tested here because `apps/ai-gateway/package.json` carries a FIXED
// `test` file list this change may not edit, and this is the usage/metering spec already on it.

const OCR_ENVELOPE = parseAiBudgetEnvelope({
  attemptKey: 'line-image:abc',
  stepKind: 'receipt-ocr',
  invocationKey: aiBudgetInvocationKey('co-1', 'line-image:abc', 'receipt-ocr', 0),
  bucket: 'OCR',
  monthKey: '2026-09',
  modelId: 'test-model',
  bounds: { ...AI_BUDGET_STEP_BOUNDS['receipt-ocr'] },
  maxCalls: AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls,
}, 'co-1')!;

const TURN_ENVELOPE = parseAiBudgetEnvelope({
  attemptKey: 'line-text:def',
  stepKind: 'line-turn',
  invocationKey: aiBudgetInvocationKey('co-1', 'line-text:def', 'line-turn', 0),
  bucket: 'CHAT',
  monthKey: '2026-09',
  modelId: 'test-model',
  bounds: { ...AI_BUDGET_STEP_BOUNDS['line-turn'] },
  maxCalls: AI_BUDGET_STEP_BOUNDS['line-turn'].maxCalls,
}, 'co-1')!;

/** The wire body the API sends: an ordinal-0 envelope beside the request's own fields. */
function wireEnvelope(envelope: AiBudgetEnvelope, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...envelope, bounds: { ...envelope.bounds }, ...over };
}

function activeState(envelope: AiBudgetEnvelope, calls = 0) {
  return { status: 'active' as const, envelope, sourceRoute: 'receipt-ocr', requestId: 'req-1', calls };
}

const V2_GRANT: AiBudgetGrantV2 = {
  version: 2, turnKey: 'turn-v2', authorityKind: 'webhook_event', authorityId: 'event-v2',
  channelOwnerDigest: 'a'.repeat(64), attemptKey: 'attempt-v2', monthKey: '2026-09', payerCompanyId: 'co-1',
  model: { provider: 'bedrock', modelId: 'test-model', region: 'ap-southeast-1' },
  allowedProfileIds: ['line-control/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
  maxTurnSlots: 4, maxRepairs: 1, admittedAtMs: Date.now() - 1_000, workDeadlineAtMs: Date.now() + 60_000,
  finalDeadlineAtMs: Date.now() + 120_000, nonce: 'nonce-v2', issuerVersion: 'api-1', signature: 'b'.repeat(64), nextOrdinal: 0,
};

function activeV2State(calls = 0) {
  return {
    status: 'active-v2' as const, grant: V2_GRANT, inputDigest: 'c'.repeat(64), sourceRoute: 'line-turn',
    requestId: 'req-v2', calls, repairCount: 0,
  };
}

function v2Seam(log: ReturnType<typeof trace>, repairs: boolean[] = []): AiBudgetSeam {
  return {
    async step(input) {
      return fakeSeam(log).step(input);
    },
    async stepV2(invocation, repair): Promise<AiBudgetStepV2Outcome> {
      repairs.push(repair);
      log.events.push(`v2-step:${invocation.ordinal}:${repair}`);
      const envelope = parseAiBudgetEnvelopeV2({
        ...invocation, version: 2, reservationId: `reservation-${invocation.ordinal}`,
        invocationKey: `${invocation.grant.payerCompanyId}#${invocation.grant.attemptKey}#provider-v2#${invocation.ordinal}`,
        tariffVersion: 'tariff-v2',
      });
      if (!envelope) throw new Error('test fixture produced an invalid v2 envelope');
      return { ok: true, envelope };
    },
    async settle(input) {
      log.events.push(`settle:${input.invocationKey}:${input.entry.ok}:${input.entry.usageBasis ?? 'none'}`);
      return 'recorded';
    },
  };
}

/** Records the order of everything that happens, which is the property most of these assert. */
function trace() {
  const events: string[] = [];
  const inputs: Array<ProviderInput | ProviderToolsInput> = [];
  const outputs: Array<ProviderOutput> = [];
  return { events, inputs, outputs };
}

function fakeProvider(
  log: ReturnType<typeof trace>,
  opts: { withTools?: boolean; fail?: boolean; silent?: boolean; timeout?: boolean } = {},
) {
  const answer = (): ProviderOutput => {
    if (!opts.silent) {
      appendUsage({
        ...entry('ocr.receipt.extract'),
        ok: !opts.fail,
        ...(opts.timeout ? { inputTokens: 30_000, usageBasis: 'CONSERVATIVE_ESTIMATE' as const } : {}),
      });
    }
    if (opts.fail) {
      return opts.timeout
        ? { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'timed out', retryable: true } }
        : { ok: false, error: { code: 'PROVIDER_THROTTLED', message: 'slow down', retryable: true } };
    }
    const out: ProviderOutput = { ok: true, text: 'answer', stopReason: 'end_turn' };
    log.outputs.push(out);
    return out;
  };
  const provider: IModelProvider = {
    generateText: async (input) => { log.events.push('provider'); log.inputs.push(input); return answer(); },
  };
  if (opts.withTools) {
    provider.generateWithTools = async (input) => {
      log.events.push('provider');
      log.inputs.push(input);
      const base = answer();
      return base.ok
        ? { ok: true, text: base.text, toolCalls: [], stopReason: 'end_turn' }
        : { ok: false, error: base.error };
    };
  }
  return provider;
}

function fakeSeam(
  log: ReturnType<typeof trace>,
  over: {
    step?: (ordinal: number) => AiBudgetStepOutcome;
    settle?: () => AiBudgetSettleOutcome | never;
  } = {},
): AiBudgetSeam {
  return {
    async step(input) {
      log.events.push(`step:${input.ordinal}:${input.monthKey}`);
      if (over.step) return over.step(input.ordinal);
      const envelope = parseAiBudgetEnvelope(wireEnvelope(OCR_ENVELOPE, {
        invocationKey: aiBudgetInvocationKey(input.companyId, input.attemptKey, input.stepKind, input.ordinal),
      }), input.companyId, input.ordinal)!;
      return { ok: true, envelope };
    },
    async settle(input) {
      log.events.push(`settle:${input.invocationKey}:${input.entry.ok}:${input.entry.usageBasis ?? 'none'}`);
      return over.settle ? over.settle() : 'recorded';
    },
  };
}

function guarded(
  inner: IModelProvider,
  seam: AiBudgetSeam,
  log: ReturnType<typeof trace>,
  companyId = 'co-1',
): IModelProvider {
  return withAiBudgetEnvelope(inner, {
    modelId: 'test-model',
    companyId,
    seam,
    log: (line) => log.events.push(`log:${String(line['reason'] ?? line['msg'])}`),
  });
}

const textInput = (over: Partial<ProviderInput> = {}): ProviderInput => ({
  systemPrompt: 'read this',
  messages: [{ role: 'user', text: 'OCR_TEXT_START\nx\nOCR_TEXT_END' }],
  maxTokens: 4096,
  usageTag: 'ocr.receipt.extract',
  ...over,
});

/** A minimal PDF whose page count is readable from its own bytes. */
const pdfWithPages = (pages: number): string => Buffer.from(
  `%PDF-1.4\n1 0 obj<</Type /Pages /Count ${pages}>>endobj\n${'2 0 obj<</Type /Page>>endobj\n'.repeat(pages)}%%EOF`,
).toString('base64');

describe('budgetEnvelope at the gateway receiver boundary', () => {
  function interceptRoute(body: unknown, url: string, run: () => Promise<unknown>): Promise<unknown> {
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ body, url }) }) } as unknown as ExecutionContext;
    return firstValueFrom(new AiUsageInterceptor().intercept(ctx, handler(run)));
  }

  it('stores a validated envelope with the route the API meters it under', async () => {
    let state: BudgetRequestState | undefined;
    await interceptRoute(
      { companyId: 'co-1', requestId: 'req-9', budgetEnvelope: wireEnvelope(OCR_ENVELOPE) },
      '/v1/internal/ai/receipt-ocr?trace=1',
      async () => { state = currentBudgetState(); return { status: 'ok' }; },
    );

    assert.equal(state?.status, 'active');
    assert.deepEqual(state?.status === 'active' ? state.envelope : undefined, OCR_ENVELOPE);
    assert.equal(state?.status === 'active' ? state.sourceRoute : undefined, 'receipt-ocr');
    assert.equal(state?.status === 'active' ? state.requestId : undefined, 'req-9');
  });

  it('derives the source route the same way the API does, and falls back safely', () => {
    assert.equal(internalAiSourceRoute('/v1/internal/ai/line-intake-route'), 'line-intake-route');
    assert.equal(internalAiSourceRoute('/v1/internal/ai/crm-summary?x=1'), 'crm-summary');
    assert.equal(internalAiSourceRoute('/internal/ai/line-turn'), 'line-turn');
    assert.equal(internalAiSourceRoute('/v1/health'), 'internal-ai');
    assert.equal(internalAiSourceRoute(undefined), 'internal-ai');
  });

  it('stores NOTHING when the request carries no envelope, so the existing path is unchanged', async () => {
    let state: BudgetRequestState | undefined = { status: 'invalid' };
    const result = await interceptRoute(
      { companyId: 'co-1', requestId: 'req-9' },
      '/v1/internal/ai/receipt-ocr',
      async () => { state = currentBudgetState(); return { status: 'ok', fields: { grandTotalAmount: '180.00' } }; },
    );

    assert.equal(state, undefined);
    assert.deepEqual(result, { status: 'ok', fields: { grandTotalAmount: '180.00' } });
  });

  it('marks a present-but-unusable envelope INVALID rather than ignoring it', async () => {
    const table: Array<[string, unknown, string | undefined]> = [
      ['an undeclared step kind', wireEnvelope(OCR_ENVELOPE, { stepKind: 'line-summary' }), 'co-1'],
      ['widened bounds', wireEnvelope(OCR_ENVELOPE, { bounds: { maxInputTokens: 900_000, maxOutputTokens: 8_192, maxCalls: 4 } }), 'co-1'],
      ['another tenant', wireEnvelope(OCR_ENVELOPE), 'co-2'],
      ['a body with no company at all', wireEnvelope(OCR_ENVELOPE), undefined],
      ['a non-object envelope', 'AI_BUDGET', 'co-1'],
    ];
    for (const [label, budgetEnvelope, companyId] of table) {
      let state: BudgetRequestState | undefined;
      await interceptRoute(
        { ...(companyId ? { companyId } : {}), budgetEnvelope },
        '/v1/internal/ai/receipt-ocr',
        async () => { state = currentBudgetState(); return {}; },
      );
      assert.deepEqual(state, { status: 'invalid' }, label);
    }
  });
});

describe('withAiBudgetEnvelope: no envelope is a pure pass-through', () => {
  it('hands the inner provider the caller own input object and returns its own result', async () => {
    const log = trace();
    const inner = fakeProvider(log);
    const input = textInput();

    const result = await runWithUsageContext({ companyId: 'co-1' }, () => guarded(inner, fakeSeam(log), log).generateText(input));

    assert.equal(log.inputs[0], input, 'the same object, so the provider sees identical bytes');
    assert.equal(result, log.outputs[0], 'the same result object, so the response is identical');
    assert.deepEqual(log.events, ['provider'], 'no step, no settle, no log line');
    assert.equal((result as { ok: true }).ok, true);
  });

  it('passes through outside any request context at all (smoke scripts, unit stubs)', async () => {
    const log = trace();
    const input = textInput();
    const result = await guarded(fakeProvider(log), fakeSeam(log), log).generateText(input);

    assert.equal(log.inputs[0], input);
    assert.equal((result as { ok: true }).ok, true);
    assert.deepEqual(log.events, ['provider']);
  });

  it('leaves the usage rows untagged, so the API meters them the way it always has', async () => {
    const log = trace();
    const drained = await runWithUsageContext({ companyId: 'co-1' }, async () => {
      await guarded(fakeProvider(log), fakeSeam(log), log).generateText(textInput());
      return drainUsage();
    });

    assert.deepEqual(drained.map((e) => e.invocationKey), [undefined]);
  });

  it('exposes generateWithTools only when the inner provider has it', () => {
    const log = trace();
    assert.equal(typeof guarded(fakeProvider(log), fakeSeam(log), log).generateWithTools, 'undefined',
      'the orchestrator reads this as "not capable" and falls back to its JSON loop');
    assert.equal(typeof guarded(fakeProvider(log, { withTools: true }), fakeSeam(log), log).generateWithTools, 'function');
  });
});

describe('withAiBudgetEnvelope: step ordering and refusals', () => {
  it('uses the reserved invocation for call 0 and budget-steps BEFORE every later call', async () => {
    const log = trace();
    const provider = () => guarded(fakeProvider(log), fakeSeam(log), log);

    const drained = await runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) }, async () => {
      // Two separate provider objects, as the receipt chain really builds them.
      await provider().generateText(textInput({ usageTag: 'ocr.receipt.image-read' }));
      await provider().generateText(textInput());
      return drainUsage();
    });

    assert.deepEqual(log.events, [
      'provider', 'settle:co-1#line-image:abc#receipt-ocr#0:true:none',
      // The step happens BEFORE the second provider call, never after it.
      'step:1:2026-09', 'provider', 'settle:co-1#line-image:abc#receipt-ocr#1:true:none',
    ]);
    assert.deepEqual(drained.map((e) => e.invocationKey), [
      'co-1#line-image:abc#receipt-ocr#0',
      'co-1#line-image:abc#receipt-ocr#1',
    ]);
  });

  it('stops the chain on a refused step with the typed code and scope, and calls no provider', async () => {
    const log = trace();
    const seam = fakeSeam(log, { step: () => ({ ok: false, code: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'OCR' }) });
    const provider = () => guarded(fakeProvider(log), seam, log);

    const second = await runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) }, async () => {
      await provider().generateText(textInput());
      return provider().generateText(textInput());
    });

    assert.equal(second.ok, false);
    assert.deepEqual(second.ok === false ? second.error : undefined, {
      code: 'PROVIDER_BUDGET_EXHAUSTED',
      message: 'step_refused',
      retryable: false,
      budgetScope: 'OCR',
      budgetCode: 'AI_BUDGET_INSUFFICIENT',
    });
    assert.deepEqual(log.events.filter((e) => e === 'provider').length, 1, 'the refused call never reaches a provider');
    // And the FIRST call's money is still recorded: a refusal never refunds what already ran.
    assert.ok(log.events.includes('settle:co-1#line-image:abc#receipt-ocr#0:true:none'));
  });

  it('refuses past maxCalls without even asking the seam', async () => {
    const log = trace();
    const provider = () => guarded(fakeProvider(log), fakeSeam(log), log);

    const last = await runWithUsageContext(
      // Already at the chain's ceiling: the next claim is ordinal 4 of a 4-call chain.
      { companyId: 'co-1', budget: activeState(OCR_ENVELOPE, AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls) },
      () => provider().generateText(textInput()),
    );

    assert.equal(last.ok, false);
    assert.equal(last.ok === false ? last.error.budgetCode : undefined, 'AI_BUDGET_UNAVAILABLE');
    assert.deepEqual(log.events, ['log:step_call_budget_exhausted']);
  });

  it('refuses every request it cannot prove is inside the declared bounds', async () => {
    const table: Array<[string, ProviderInput, string]> = [
      ['a prompt over the declared input bound', textInput({ systemPrompt: 'x'.repeat(30_001) }), 'input_bound_exceeded'],
      ['maxTokens over the declared output bound', textInput({ maxTokens: 8_193 }), 'output_bound_exceeded'],
      ['no maxTokens at all (the provider default is unprovable)', textInput({ maxTokens: undefined }), 'output_bound_exceeded'],
      ['a document whose page count cannot be read', textInput({ documents: [{ mimeType: 'application/pdf', contentBase64: 'bm90LWEtcGRm' }] }), 'input_bound_unprovable'],
      ['a document with more pages than the bound admits', textInput({ documents: [{ mimeType: 'application/pdf', contentBase64: pdfWithPages(9) }] }), 'input_bound_unprovable'],
      ['too many images for the declared bound', textInput({ images: Array.from({ length: 16 }, () => ({ mimeType: 'image/jpeg' as const, contentBase64: 'ZmFrZQ==' })) }), 'input_bound_exceeded'],
    ];
    for (const [label, input, reason] of table) {
      const log = trace();
      const result = await runWithUsageContext(
        { companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
        () => guarded(fakeProvider(log), fakeSeam(log), log).generateText(input),
      );
      assert.equal(result.ok, false, label);
      assert.equal(result.ok === false ? result.error.budgetCode : undefined, 'AI_BUDGET_UNAVAILABLE', label);
      assert.equal(result.ok === false ? result.error.budgetScope : undefined, 'OCR', label);
      assert.deepEqual(log.events, [`log:${reason}`], label);
    }
  });

  it('admits a document it CAN bound, and counts its pages against the declared ceiling', async () => {
    const log = trace();
    const result = await runWithUsageContext(
      { companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
      () => guarded(fakeProvider(log), fakeSeam(log), log).generateText(
        textInput({ documents: [{ mimeType: 'application/pdf', contentBase64: pdfWithPages(8) }] }),
      ),
    );

    assert.equal(result.ok, true);
    assert.equal(pdfPageUpperBound(pdfWithPages(3)), 3);
    assert.equal(pdfPageUpperBound('bm90LWEtcGRm'), undefined);
  });

  it('refuses a model the hold was not priced for', async () => {
    const log = trace();
    const result = await runWithUsageContext(
      { companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
      () => withAiBudgetEnvelope(fakeProvider(log), {
        modelId: 'some-other-approved-model',
        companyId: 'co-1',
        seam: fakeSeam(log),
        log: (line) => log.events.push(`log:${String(line['reason'])}`),
      }).generateText(textInput()),
    );

    assert.equal(result.ok, false);
    assert.deepEqual(log.events, ['log:model_mismatch']);
  });

  it('refuses every call of a request whose envelope did not validate', async () => {
    const log = trace();
    const result = await runWithUsageContext(
      { companyId: 'co-1', budget: { status: 'invalid' } },
      () => guarded(fakeProvider(log), fakeSeam(log), log).generateText(textInput()),
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.error.budgetCode : undefined, 'AI_BUDGET_UNAVAILABLE');
    assert.deepEqual(log.events, ['log:envelope_invalid']);
  });

  it('counts the tool catalogue against the input bound on the native loop', async () => {
    const log = trace();
    const tools = [{ name: 'huge', inputSchema: { blob: 'y'.repeat(41_000) } }];
    const result = await runWithUsageContext(
      { companyId: 'co-1', budget: { ...activeState(TURN_ENVELOPE), sourceRoute: 'line-turn' } },
      () => guarded(fakeProvider(log, { withTools: true }), fakeSeam(log), log).generateWithTools!({
        messages: [{ role: 'user', text: 'ยอดขายวันนี้' }],
        tools,
        maxTokens: 1024,
        usageTag: 'line.loop',
      }),
    );

    assert.equal(result.ok, false, 'a 32KB catalogue is the biggest block of a turn prompt');
    assert.deepEqual(log.events, ['log:input_bound_exceeded']);
  });
});

describe('withAiBudgetEnvelope: v2 budget envelope', () => {
  it('B2 maps only the classify usage tag to the separately granted classifier profile', async () => {
    const log = trace(), seam = v2Seam(log), state = activeV2State();
    state.grant = { ...state.grant, authorityKind: 'webhook_classify', maxTurnSlots: 2,
      allowedProfileIds: ['line-classify/2'] };
    const original = seam.stepV2!;
    const profiles: string[] = [];
    seam.stepV2 = async (invocation, repair) => {
      profiles.push(invocation.profileId);
      return original(invocation, repair);
    };
    const result = await runWithUsageContext({ companyId: 'co-1', budget: state }, () =>
      guarded(fakeProvider(log), seam, log).generateText(textInput({ usageTag: 'line.workflow-classify', maxTokens: 1024 })));
    assert.equal(result.ok, true);
    assert.deepEqual(profiles, ['line-classify/2']);
    assert.equal(log.events.filter(event => event === 'provider').length, 1);
    const turnLog = trace();
    const refused = await runWithUsageContext({ companyId: 'co-1', budget: activeV2State() }, () =>
      guarded(fakeProvider(turnLog), v2Seam(turnLog), turnLog).generateText(textInput({ usageTag: 'line.workflow-classify', maxTokens: 1024 })));
    assert.equal(refused.ok, false);
    assert.equal(turnLog.events.includes('provider'), false);
  });

  it('carries the original work deadline into the provider without changing payload or refreshing time', async () => {
    const log = trace(), provider = guarded(fakeProvider(log), v2Seam(log), log), state = activeV2State();
    const input = textInput({ usageTag: 'line.loop', maxTokens: 1024, deadlineAt: state.grant.workDeadlineAtMs - 500 });
    await runWithUsageContext({ companyId: 'co-1', budget: state }, () => provider.generateText(input));
    assert.equal(log.inputs[0]?.deadlineAt, input.deadlineAt);
    assert.deepEqual(log.inputs[0]?.messages, input.messages);
    assert.notEqual(log.inputs[0], input);
  });

  it('R22 ordinary call settles zero usage if admission consumes its remaining work time', async () => {
    const realNow = Date.now; let now = realNow(); Date.now = () => now;
    try {
      const log = trace(), seam = v2Seam(log), original = seam.stepV2!;
      const settlements: AiUsageEntry[] = [];
      const settle = seam.settle;
      seam.settle = async evidence => { settlements.push(structuredClone(evidence.entry)); return settle(evidence); };
      const state = activeV2State(); state.grant = { ...V2_GRANT, workDeadlineAtMs: now + 500, finalDeadlineAtMs: now + 3500 };
      seam.stepV2 = async (invocation, repair) => { const answer = await original(invocation, repair); now += 501; return answer; };
      const result = await runWithUsageContext({ companyId: 'co-1', budget: state }, () => guarded(fakeProvider(log), seam, log).generateText(textInput({ usageTag: 'line.loop', maxTokens: 1024 })));
      assert.equal(result.ok, false); assert.ok(log.events.includes('v2-step:0:false')); assert.equal(log.inputs.length, 0);
      assert.equal(settlements.length, 1);
      assert.equal(settlements[0]!.ok, false);
      assert.deepEqual([settlements[0]!.inputTokens, settlements[0]!.outputTokens, settlements[0]!.cacheReadInputTokens,
        settlements[0]!.cacheWriteInputTokens, settlements[0]!.externalUnits], [0, 0, 0, 0, 0]);
    } finally { Date.now = realNow; }
  });

  it('refuses a changed reservation echo and invalid output bounds before any vendor dispatch', async () => {
    for (const changed of ['signature', 'output'] as const) {
      const log = trace(), seam = v2Seam(log), original = seam.stepV2!;
      seam.stepV2 = async (invocation, repair) => {
        const result = await original(invocation, repair); if (!result.ok) return result;
        return { ok: true, envelope: { ...result.envelope, ...(changed === 'output' ? { requestedOutputTokens: 100 } : { grant: { ...result.envelope.grant, signature: 'd'.repeat(64) } }) } };
      };
      const result = await runWithUsageContext({ companyId: 'co-1', budget: activeV2State() }, () => guarded(fakeProvider(log), seam, log).generateText(textInput({ usageTag: 'line.loop', maxTokens: 1024 })));
      assert.equal(result.ok, false); assert.equal(log.inputs.length, 0);
    }
    for (const maxTokens of [NaN, Infinity, 1.5, -1]) {
      const log = trace(); await runWithUsageContext({ companyId: 'co-1', budget: activeV2State() }, () => guarded(fakeProvider(log), v2Seam(log), log).generateText(textInput({ usageTag: 'line.loop', maxTokens })));
      assert.equal(log.inputs.length, 0); assert.equal(log.events.some(event => event.startsWith('v2-step:')), false);
    }
  });

  it('limits a document QA call to 45 seconds even with a longer admitted job deadline', async () => {
    const log = trace(), before = Date.now(), state = activeV2State(1);
    state.grant = { ...state.grant, authorityKind: 'qa_job', allowedProfileIds: ['document-qa/2'], admittedAtMs: before, maxTurnSlots: 2, workDeadlineAtMs: before + 897000, finalDeadlineAtMs: before + 900000 };
    await runWithUsageContext({ companyId: 'co-1', budget: state }, () => guarded(fakeProvider(log), v2Seam(log), log).generateText(textInput({ usageTag: 'line.document.qa', maxTokens: 1024 })));
    assert.ok(log.inputs[0]?.deadlineAt && log.inputs[0].deadlineAt >= before + 45000 && log.inputs[0].deadlineAt <= Date.now() + 45000);
  });

  it('suppresses a late vendor success but preserves its actual paid usage for settlement', async () => {
    const realNow = Date.now; let now = realNow(); Date.now = () => now;
    try {
      const log = trace(), state = activeV2State(); state.grant = { ...state.grant, workDeadlineAtMs: now + 100, finalDeadlineAtMs: now + 3100 };
      const provider = guarded({ generateText: async () => { appendUsage({ ...entry('line.loop'), usageBasis: 'PROVIDER_REPORTED' }); now += 101; return { ok: true, text: 'late success' }; } }, v2Seam(log), log);
      const result = await runWithUsageContext({ companyId: 'co-1', budget: state }, () => provider.generateText(textInput({ usageTag: 'line.loop', maxTokens: 1024 })));
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'PROVIDER_TIMEOUT');
      assert.ok(log.events.some(event => event.startsWith('settle:') && event.endsWith(':false:PROVIDER_REPORTED')),
        'late success is company cost because the customer never received it');
    } finally { Date.now = realNow; }
  });

  it('queues late settlement off the response path and still posts that exact evidence later', async () => {
    resetSettleEvidence(); let posts = 0;
    const seam = createAiBudgetSeam({ baseUrl: 'https://synthetic-api.test/v1', secret: 'test', timeoutMs: 1000 }, () => {}, async () => { posts++; return new Response(JSON.stringify({ result: 'settled' })); });
    try {
      assert.equal(await seam.settle({ invocationKey: 'late-v2', sourceRoute: 'line-turn', entry: entry('line.loop'), deadlineAt: Date.now() - 1 }), 'unreachable');
      assert.equal(posts, 0); assert.equal(settleEvidenceDepth(), 1);
      await runSettleEvidenceQueue(() => {}, Date.now(), { ignoreBackoff: true });
      assert.equal(posts, 1); assert.equal(settleEvidenceDepth(), 0);
    } finally { resetSettleEvidence(); }
  });

  it('reserves ordinal zero through the v2 seam and settles the same invocation', async () => {
    const log = trace();
    const provider = guarded(fakeProvider(log), v2Seam(log), log);
    const drained = await runWithUsageContext({ companyId: 'co-1', budget: activeV2State() }, async () => {
      await provider.generateText(textInput({ usageTag: 'line.loop', maxTokens: 1024 }));
      return drainUsage();
    });
    assert.equal(log.events[0], 'v2-step:0:false');
    assert.ok(log.events.includes('provider'));
    assert.equal(drained[0]?.invocationKey, 'co-1#attempt-v2#provider-v2#0');
  });

  it('uses the global ordinal even when a profile has its own smaller maxCalls', async () => {
    const log = trace();
    const provider = guarded(fakeProvider(log), v2Seam(log), log);
    const drained = await runWithUsageContext({ companyId: 'co-1', budget: activeV2State(2) }, async () => {
      await provider.generateText(textInput({ usageTag: 'line.loop', maxTokens: 1024 }));
      return drainUsage();
    });
    assert.ok(log.events.includes('v2-step:2:false'));
    assert.equal(drained[0]?.invocationKey, 'co-1#attempt-v2#provider-v2#2');
  });

  it('allows one bounded repair reservation after an incomplete provider result', async () => {
    const log = trace();
    let calls = 0;
    const inner: IModelProvider = { generateText: async () => {
      calls += 1;
      appendUsage({ ...entry('line.loop'), ok: calls > 1 });
      return calls === 1
        ? { ok: false, error: { code: 'PROVIDER_OUTPUT_INCOMPLETE', message: 'incomplete', retryable: false } }
        : { ok: true, text: 'repaired', stopReason: 'end_turn' };
    } };
    const logRepairs: boolean[] = [];
    const provider = guarded(inner, v2Seam(log, logRepairs), log);
    const result = await runWithUsageContext({ companyId: 'co-1', budget: activeV2State() }, async () => {
      await provider.generateText(textInput({ usageTag: 'line.loop', maxTokens: 1024 }));
      return provider.generateText(textInput({ usageTag: 'line.loop', maxTokens: 1024 }));
    });
    assert.equal(result.ok, true);
    assert.deepEqual(logRepairs, [false, true]);
    assert.equal(calls, 2);
  });
});

describe('withAiBudgetEnvelope: invocation evidence', () => {
  it('keeps a dispatched hold unresolved when a provider supplies no usage basis', async () => {
    const log = trace();
    const provider: IModelProvider = {
      generateText: async () => {
        log.events.push('provider');
        appendUsage({
          tag: 'ocr.receipt.extract', modelId: 'test-model', ok: true,
          inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 1,
        });
        return { ok: true, text: 'answer', stopReason: 'end_turn' };
      },
    };
    await runWithUsageContext(
      { companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
      () => guarded(provider, fakeSeam(log), log).generateText(textInput()),
    );

    assert.ok(log.events.includes('provider'));
    assert.equal(log.events.some((event) => event.startsWith('settle:')), false);
    assert.ok(log.events.includes('log:ai.budget.evidence_missing'));
  });

  it('posts evidence for a FAILED provider call too — real cost must never become zero', async () => {
    const log = trace();
    const result = await runWithUsageContext(
      { companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
      () => guarded(fakeProvider(log, { fail: true }), fakeSeam(log), log).generateText(textInput()),
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.error.code : undefined, 'PROVIDER_THROTTLED', 'the provider error is not rewritten');
    assert.deepEqual(log.events, ['provider', 'settle:co-1#line-image:abc#receipt-ocr#0:false:none']);
  });

  it('settles known timeouts even when the adapter returned before logging usage', async () => {
    const log = trace();
    const provider: IModelProvider = { generateText: async () => ({ ok: false,
      error: { code: 'PROVIDER_TIMEOUT', message: 'deadline elapsed', retryable: false } }) };
    await runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) }, async () => {
      const result = await guarded(provider, fakeSeam(log), log).generateText(textInput());
      assert.equal(result.ok, false);
      const [entry] = drainUsage();
      assert.equal(entry!.ok, false);
      assert.equal(entry!.errorCode, 'PROVIDER_TIMEOUT');
      assert.ok(entry!.inputTokens > 0 && entry!.inputTokens < OCR_ENVELOPE.bounds.maxInputTokens);
    });
    assert.deepEqual(log.events, ['settle:co-1#line-image:abc#receipt-ocr#0:false:CONSERVATIVE_ESTIMATE']);
  });

  it('retains missing evidence for a thrown transport outcome for operator reconciliation', async () => {
    const log = trace();
    const provider: IModelProvider = { generateText: async () => { throw new Error('transport outcome unknown'); } };
    await assert.rejects(runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
      () => guarded(provider, fakeSeam(log), log).generateText(textInput())), /transport outcome unknown/);
    assert.equal(log.events.some(event => event.startsWith('settle:')), false);
    assert.ok(log.events.includes('log:ai.budget.evidence_missing'));
  });

  it('posts a timeout at the conservative basis the provider reported', async () => {
    const log = trace();
    await runWithUsageContext(
      { companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
      () => guarded(fakeProvider(log, { fail: true, timeout: true }), fakeSeam(log), log).generateText(textInput()),
    );

    assert.deepEqual(log.events, ['provider', 'settle:co-1#line-image:abc#receipt-ocr#0:false:CONSERVATIVE_ESTIMATE']);
  });

  it('never fails the business call when settlement cannot be posted', async () => {
    for (const settle of [() => 'unreachable' as const, () => { throw new Error('API down'); }]) {
      const log = trace();
      const result = await runWithUsageContext(
        { companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
        () => guarded(fakeProvider(log), fakeSeam(log, { settle }), log).generateText(textInput()),
      );

      assert.equal(result.ok, true, 'the hold stays DISPATCHED -> UNRESOLVED; the answer is still delivered');
    }
  });

  it('settles nothing, and says so, when the provider reported no usage at all', async () => {
    const log = trace();
    const result = await runWithUsageContext(
      { companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
      () => guarded(fakeProvider(log, { silent: true }), fakeSeam(log), log).generateText(textInput()),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(log.events, ['provider', 'log:ai.budget.evidence_missing'],
      'an invented number is worse than a hold that stays until evidence arrives');
  });

  it('settles a call that THREW, then lets the throw propagate', async () => {
    const log = trace();
    const exploding: IModelProvider = {
      generateText: async () => {
        log.events.push('provider');
        appendUsage(entry('ocr.receipt.extract'));
        throw new Error('parser exploded after the provider answered');
      },
    };

    await assert.rejects(
      () => runWithUsageContext(
        { companyId: 'co-1', budget: activeState(OCR_ENVELOPE) },
        () => guarded(exploding, fakeSeam(log), log).generateText(textInput()),
      ),
      (err: Error) => err.message.includes('parser exploded'),
    );
    assert.deepEqual(log.events, ['provider', 'settle:co-1#line-image:abc#receipt-ocr#0:true:none']);
  });

  it('cannot budget-step without a tenant', async () => {
    const log = trace();
    const provider = () => withAiBudgetEnvelope(fakeProvider(log), {
      modelId: 'test-model',
      companyId: undefined,
      seam: fakeSeam(log),
      log: (line) => log.events.push(`log:${String(line['reason'] ?? line['msg'])}`),
    });
    const second = await runWithUsageContext({ budget: activeState(OCR_ENVELOPE) }, async () => {
      await provider().generateText(textInput());
      return provider().generateText(textInput());
    });

    assert.equal(second.ok, false);
    assert.ok(log.events.includes('log:company_unknown'));
  });
});

describe('withAiBudgetEnvelope: a provider that cannot estimate its own timeout', () => {
  /** The OpenAI adapter's shape: an aborted call appends zeros with NO basis at all. */
  function zeroTimeoutProvider(log: ReturnType<typeof trace>): IModelProvider {
    return {
      generateText: async () => {
        log.events.push('provider');
        appendUsage({ ...entry('ocr.receipt.extract'), ok: false, inputTokens: 0, outputTokens: 0 });
        return { ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 'timed out', retryable: true } };
      },
    };
  }

  it('settles a known timeout with a request-size estimate for company accounting', async () => {
    const log = trace();
    const drained = await runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) }, async () => {
      await guarded(zeroTimeoutProvider(log), fakeSeam(log), log).generateText(textInput());
      return drainUsage();
    });

    assert.deepEqual(log.events, [
      'provider', 'settle:co-1#line-image:abc#receipt-ocr#0:false:CONSERVATIVE_ESTIMATE',
    ]);
    // The response copy carries the SAME numbers, so whichever path lands first records the same
    // money and the other is an idempotent duplicate.
    assert.deepEqual(
      [drained[0]!.inputTokens, drained[0]!.outputTokens, drained[0]!.usageBasis],
      [(await conservativeTimeoutUsage(textInput())).inputTokens, 4096, 'CONSERVATIVE_ESTIMATE'],
    );
  });

  it('leaves a provider-reported basis exactly as measured', async () => {
    const log = trace();
    const drained = await runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) }, async () => {
      await guarded(fakeProvider(log), fakeSeam(log), log).generateText(textInput());
      return drainUsage();
    });

    assert.equal(drained[0]!.usageBasis, undefined, 'a SUCCESS is never relabelled as an estimate');
    assert.equal(drained[0]!.inputTokens, 10);
  });

  it('does not estimate a non-timeout failure — a rejected request cost no inference', async () => {
    const log = trace();
    const throttled: IModelProvider = {
      generateText: async () => {
        appendUsage({ ...entry('ocr.receipt.extract'), ok: false, inputTokens: 0, outputTokens: 0 });
        return { ok: false, error: { code: 'PROVIDER_THROTTLED', message: 'slow down', retryable: true } };
      },
    };
    const drained = await runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) }, async () => {
      await guarded(throttled, fakeSeam(log), log).generateText(textInput());
      return drainUsage();
    });

    assert.deepEqual([drained[0]!.inputTokens, drained[0]!.usageBasis], [0, undefined]);
  });
});

describe('withAiBudgetEnvelope: evidence attribution is positional, so calls may not overlap', () => {
  /** Holds the provider open until released, so two guarded calls really are in flight together. */
  function blockingProvider(log: ReturnType<typeof trace>) {
    let release: (() => void) | undefined;
    const provider: IModelProvider = {
      generateText: async () => {
        log.events.push('provider');
        await new Promise<void>((resolve) => { release = resolve; });
        appendUsage(entry('ocr.receipt.image-read'));
        return { ok: true, text: 'answer', stopReason: 'end_turn' };
      },
    };
    return { provider, release: () => release?.() };
  }

  it('refuses the SECOND overlapping call instead of mis-attributing its evidence', async () => {
    const log = trace();
    const blocking = blockingProvider(log);
    const result = await runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) }, async () => {
      const first = guarded(blocking.provider, fakeSeam(log), log).generateText(textInput());
      // The first call is parked inside the provider; a concurrent second one would take the same
      // `fromIndex` and tag the first call's row as its own.
      const second = await guarded(fakeProvider(log), fakeSeam(log), log).generateText(textInput());
      blocking.release();
      await first;
      return second;
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.error.budgetCode : undefined, 'AI_BUDGET_UNAVAILABLE');
    assert.ok(log.events.includes('log:concurrent_provider_call'));
    // Exactly ONE provider ran, and the ordinal was never claimed for the refused call: the first
    // call still settles as ordinal 0.
    assert.equal(log.events.filter((e) => e === 'provider').length, 1);
    assert.ok(log.events.includes('settle:co-1#line-image:abc#receipt-ocr#0:true:none'));
    assert.equal(log.events.some((e) => e.startsWith('step:')), false);
  });

  it('allows the next call once the first has finished — a chain is sequential, not blocked', async () => {
    const log = trace();
    const provider = () => guarded(fakeProvider(log), fakeSeam(log), log);
    await runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) }, async () => {
      await provider().generateText(textInput());
      await provider().generateText(textInput());
    });

    assert.deepEqual(log.events.filter((e) => e === 'provider').length, 2);
    assert.equal(log.events.includes('log:concurrent_provider_call'), false);
  });

  it('never blocks a request with no envelope, however it overlaps', async () => {
    const log = trace();
    const blocking = blockingProvider(log);
    const results = await runWithUsageContext({ companyId: 'co-1' }, async () => {
      const first = guarded(blocking.provider, fakeSeam(log), log).generateText(textInput());
      const second = guarded(fakeProvider(log), fakeSeam(log), log).generateText(textInput());
      blocking.release();
      return Promise.all([first, second]);
    });

    assert.deepEqual(results.map((r) => r.ok), [true, true]);
  });
});

// ── Hold-reconciliation spec §3: do not lose the evidence while this process is alive ────────────
//
// Same file as the envelope machinery above and for the same reason recorded there: the gateway's
// `package.json` carries a FIXED `test` list this change may not edit, and this is the
// usage/metering spec already on it. Every test below drives the queue and the drain with an
// explicit clock — no real timers, no real signals.

describe('durable settle retry: the evidence queue', () => {
  const lines = (): { log: DurabilityLog; seen: Array<Record<string, unknown>> } => {
    const seen: Array<Record<string, unknown>> = [];
    return { log: (line) => { seen.push(line); }, seen };
  };

  const item = (
    id: string,
    post: () => Promise<SettleEvidenceOutcome>,
  ): Parameters<typeof enqueueSettleEvidence>[0] => ({
    invocationKey: `co-1#attempt-${id}#line-turn#0`, sourceRoute: 'line-turn',
    companyId: 'co-1', attempts: 2, post,
  });

  it('re-posts a failing settle until it succeeds, then never again', async () => {
    resetSettleEvidence();
    const { log, seen } = lines();
    let calls = 0;
    // Fails twice more in the queue, then the API comes back.
    enqueueSettleEvidence(item('a', async () => (++calls < 3 ? 'unreachable' : 'recorded')), log, 0);

    // Backoff: 1s, then 5s, then it succeeds. Nothing is posted before its delay is up.
    assert.deepEqual(await runSettleEvidenceQueue(log, 500), { posted: 0, dropped: 0, remaining: 1 });
    assert.equal(calls, 0, 'the first delay is 1s, so nothing was posted at 500ms');
    await runSettleEvidenceQueue(log, 1_000);
    assert.equal(calls, 1);
    await runSettleEvidenceQueue(log, 1_000 + 5_000);
    assert.equal(calls, 2);
    assert.deepEqual(await runSettleEvidenceQueue(log, 1_000 + 5_000 + 30_000), { posted: 1, dropped: 0, remaining: 0 });
    assert.equal(calls, 3);

    // …and it is posted exactly ONCE successfully: the item is gone, so a later pass cannot bill again.
    await runSettleEvidenceQueue(log, 10 * 60_000 - 1);
    assert.equal(calls, 3);
    assert.equal(settleEvidenceDepth(), 0);
    assert.equal(seen.filter((line) => line['msg'] === 'ai.budget.settle_evidence_posted').length, 1);
    resetSettleEvidence();
  });

  it('stops re-posting a REJECTED settle — the API already decided, and it logged it', async () => {
    resetSettleEvidence();
    const { log } = lines();
    let calls = 0;
    enqueueSettleEvidence(item('b', async () => { calls += 1; return 'rejected'; }), log, 0);
    await runSettleEvidenceQueue(log, 1_000);
    await runSettleEvidenceQueue(log, 120_000);
    assert.equal(calls, 1);
    assert.equal(settleEvidenceDepth(), 0);
    resetSettleEvidence();
  });

  it('drops evidence older than the window instead of retrying forever', async () => {
    resetSettleEvidence();
    const { log, seen } = lines();
    enqueueSettleEvidence(item('c', async () => 'unreachable'), log, 0);
    const result = await runSettleEvidenceQueue(log, SETTLE_EVIDENCE_MAX_AGE_MS);
    assert.deepEqual(result, { posted: 0, dropped: 1, remaining: 0 });
    const dropped = seen.find((line) => line['msg'] === 'ai.budget.settle_evidence_dropped');
    assert.equal(dropped?.['reason'], 'expired');
    // Ids only: no prompt, no cap, no balance ever reaches a log line on the money path.
    assert.deepEqual(Object.keys(dropped ?? {}).sort(),
      ['attempts', 'invocationKey', 'msg', 'reason', 'sourceRoute']);
    resetSettleEvidence();
  });

  it('caps the queue and logs the overflow with ids only', async () => {
    resetSettleEvidence();
    const { log, seen } = lines();
    for (let i = 0; i < SETTLE_EVIDENCE_MAX_ENTRIES; i += 1) {
      assert.equal(enqueueSettleEvidence(item(`full-${i}`, async () => 'unreachable'), log, 0), true);
    }
    assert.equal(enqueueSettleEvidence(item('overflow', async () => 'recorded'), log, 0), false);
    const dropped = seen.filter((line) => line['msg'] === 'ai.budget.settle_evidence_dropped');
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0]?.['reason'], 'queue_full');
    assert.equal(dropped[0]?.['depth'], SETTLE_EVIDENCE_MAX_ENTRIES);
    assert.equal(settleEvidenceDepth(), SETTLE_EVIDENCE_MAX_ENTRIES);
    resetSettleEvidence();
  });

  it('is what the seam parks a settle in after its two inline attempts — without delaying the call', async () => {
    resetSettleEvidence();
    const { log, seen } = lines();
    let posts = 0;
    const seam = createAiBudgetSeam(
      { baseUrl: 'http://api.test/v1', secret: 'shh', timeoutMs: 50 },
      log,
      (async () => { posts += 1; throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch,
    );

    const started = Date.now();
    const outcome = await seam.settle({
      invocationKey: 'co-1#attempt-x#line-turn#0', sourceRoute: 'line-turn', companyId: 'co-1',
      entry: entry('line.turn'),
    });

    assert.equal(outcome, 'unreachable');
    assert.equal(posts, 2, 'exactly the two inline attempts — the queue does not run on this path');
    assert.equal(settleEvidenceDepth(), 1, 'the evidence is parked, not lost');
    assert.ok(Date.now() - started < 1_000, 'the business call waits for the 200ms retry only');
    assert.ok(seen.some((line) => line['msg'] === 'ai.budget.settle_unreachable'));

    // The queue re-posts the SAME body through the same seam, so a recovered API settles it.
    await runSettleEvidenceQueue(log, Date.now() + 1_000);
    assert.equal(posts, 3);
    resetSettleEvidence();
  });

  it('parks nothing when the settle succeeds', async () => {
    resetSettleEvidence();
    const { log } = lines();
    const seam = createAiBudgetSeam(
      { baseUrl: 'http://api.test/v1', secret: 'shh', timeoutMs: 50 },
      log,
      (async () => ({ ok: true, json: async () => ({ result: 'duplicate' }) })) as unknown as typeof fetch,
    );
    assert.equal(await seam.settle({
      invocationKey: 'co-1#attempt-y#line-turn#0', sourceRoute: 'line-turn', entry: entry('line.turn'),
    }), 'recorded');
    assert.equal(settleEvidenceDepth(), 0);
    resetSettleEvidence();
  });
});

describe('graceful drain on SIGTERM', () => {
  const lines = (): { log: DurabilityLog; seen: Array<Record<string, unknown>> } => {
    const seen: Array<Record<string, unknown>> = [];
    return { log: (line) => { seen.push(line); }, seen };
  };

  /** A fake clock the drain advances by sleeping, so nothing waits on a real timer. */
  function fakeClock() {
    let nowMs = 0;
    return {
      now: () => nowMs,
      sleep: async (ms: number) => { nowMs += ms; },
      advance: (ms: number) => { nowMs += ms; },
    };
  }

  it('waits for a guarded provider call in flight, then flushes the evidence, then summarises', async () => {
    resetSettleEvidence();
    const { log, seen } = lines();
    const clock = fakeClock();
    let posts = 0;
    enqueueSettleEvidence({
      invocationKey: 'co-1#attempt-d#line-turn#0', sourceRoute: 'line-turn', companyId: 'co-1',
      attempts: 2, post: async () => { posts += 1; return 'recorded'; },
    }, log, 0);

    beginGuardedProviderCall();
    assert.equal(guardedProviderCallsInFlight(), 1);
    // The call finishes 300ms into the drain: the gauge drops while the drain is sleeping.
    const original = clock.sleep;
    let slept = 0;
    const sleep = async (ms: number) => { slept += ms; if (slept >= 300) endGuardedProviderCall(); await original(ms); };

    const summary = await drainAiBudgetDurability({ budgetMs: 20_000, log, sleep, now: clock.now });

    assert.equal(summary.inFlightAtExit, 0, 'the drain waited for the call instead of killing it');
    assert.ok(summary.waitedMs >= 300, `waited ${summary.waitedMs}ms`);
    // Flushed ignoring its own backoff: the evidence was queued at t=0 with a 1s delay, and the
    // drain still posted it — a settle posted after the process exits is a stranded hold.
    assert.equal(posts, 1);
    assert.deepEqual({ posted: summary.posted, dropped: summary.dropped, remaining: summary.remaining },
      { posted: 1, dropped: 0, remaining: 0 });
    const done = seen.filter((line) => line['msg'] === 'ai.budget.drain_complete');
    assert.equal(done.length, 1, 'exactly one summary line');
    assert.deepEqual(Object.keys(done[0] ?? {}).sort(),
      ['dropped', 'inFlightAtExit', 'msg', 'posted', 'remaining', 'waitedMs'], 'counts only');
    resetSettleEvidence();
  });

  it('gives up on a call that outlasts the budget rather than being SIGKILLed mid-flush', async () => {
    resetSettleEvidence();
    const { log } = lines();
    const clock = fakeClock();
    beginGuardedProviderCall();
    const summary = await drainAiBudgetDurability({ budgetMs: 1_000, log, sleep: clock.sleep, now: clock.now });
    assert.equal(summary.inFlightAtExit, 1, 'reported honestly rather than waited on forever');
    assert.ok(summary.waitedMs >= 1_000 && summary.waitedMs < 2_000);
    endGuardedProviderCall();
    resetSettleEvidence();
  });

  it('is a no-op with nothing held — which is every SHARED-only deployment', async () => {
    resetSettleEvidence();
    const { log, seen } = lines();
    const summary = await drainAiBudgetDurability({ budgetMs: 20_000, log, now: () => 0, sleep: async () => {} });
    assert.deepEqual(summary, { waitedMs: 0, inFlightAtExit: 0, posted: 0, dropped: 0, remaining: 0 });
    assert.equal(seen.length, 1);
    resetSettleEvidence();
  });

  it('the shutdown service drains with the configured budget when Nest calls the hook', async () => {
    resetSettleEvidence();
    let posts = 0;
    // Real clock here: this test drives the actual hook, so the item must not already be expired.
    enqueueSettleEvidence({
      invocationKey: 'co-1#attempt-h#line-turn#0', sourceRoute: 'line-turn', companyId: 'co-1',
      attempts: 2, post: async () => { posts += 1; return 'recorded'; },
    }, () => {}, Date.now());
    const warn = console.warn;
    const said: string[] = [];
    console.warn = (line: string) => { said.push(String(line)); };
    try {
      await new AiBudgetShutdownService({ shutdownDrainMs: 20_000 } as never).onApplicationShutdown('SIGTERM');
    } finally {
      console.warn = warn;
    }
    assert.equal(posts, 1);
    const summary = said.map((line) => JSON.parse(line)).find((line) => line.msg === 'ai.budget.drain_complete');
    assert.equal(summary?.signal, 'SIGTERM');
    assert.equal(summary?.posted, 1);
    resetSettleEvidence();
  });

  it('a request with NO envelope marks nothing in flight, so a drain has nothing to wait for', async () => {
    resetSettleEvidence();
    const log = trace();
    await runWithUsageContext({ companyId: 'co-1' }, async () => {
      const provider = guarded(fakeProvider(log), fakeSeam(log), log);
      assert.equal(guardedProviderCallsInFlight(), 0);
      await provider.generateText(textInput());
    });
    assert.equal(guardedProviderCallsInFlight(), 0);
    assert.equal(settleEvidenceDepth(), 0);
    assert.equal(log.events.some((e) => e.startsWith('settle:')), false);
    resetSettleEvidence();
  });

  it('a guarded call IS counted while it runs, and released when it ends', async () => {
    resetSettleEvidence();
    const log = trace();
    let release = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const provider: IModelProvider = {
      generateText: async () => { await blocked; appendUsage(entry('line.turn')); return { ok: true, text: 'answer', stopReason: 'end_turn' }; },
    };
    await runWithUsageContext({ companyId: 'co-1', budget: activeState(OCR_ENVELOPE) }, async () => {
      const running = guarded(provider, fakeSeam(log), log).generateText(textInput());
      await tick(5);
      assert.equal(guardedProviderCallsInFlight(), 1, 'the drain can see this call');
      release();
      await running;
    });
    assert.equal(guardedProviderCallsInFlight(), 0, 'released from the decorator finally');
    resetSettleEvidence();
  });
});


describe('R6 unusable output is classified before settlement', () => {
  for (const tools of [false, true]) for (const scenario of ['valid', 'invalid', 'throw-validator', 'output_limit', 'blocked', 'provider-failed', 'provider-throws']) {
    it(`${tools ? 'tools' : 'text'}: ${scenario} preserves real evidence and isolates the invocation`, async () => {
      const log = trace(), seam = v2Seam(log), settled: AiUsageEntry[] = [];
      seam.settle = async input => { settled.push({ ...input.entry }); return 'recorded'; };
      const real = { ...entry('line.loop'), inputTokens: 123, outputTokens: 45, cacheReadInputTokens: 67, cacheWriteInputTokens: 89,
        usageBasis: 'PROVIDER_REPORTED' as const, externalUnits: 2 };
      const run = async () => {
        appendUsage({ ...real });
        if (scenario === 'provider-throws') throw new Error('transport lost');
        if (scenario === 'provider-failed') return { ok: false as const, error: { code: 'PROVIDER_TIMEOUT' as const, message: 'timeout', retryable: false } };
        return { ok: true as const, text: scenario === 'invalid' ? '{bad' : 'answer', toolCalls: [], stopReason: 'end_turn' as const,
          completion: scenario === 'output_limit' ? 'output_limit' as const : scenario === 'blocked' ? 'blocked' as const : 'complete' as const };
      };
      const provider = guarded({ generateText: run, generateWithTools: run }, seam, log);
      await runWithUsageContext({ companyId: 'co-1', budget: activeV2State() }, async () => {
        appendUsage({ ...entry('unrelated'), invocationKey: 'earlier' });
        const input = textInput({ usageTag: 'line.loop', maxTokens: 1024, acceptOutput: output => {
          if (scenario === 'throw-validator') throw new Error('bad parser');
          return output.text !== '{bad';
        } });
        const call = () => tools ? provider.generateWithTools!({ ...input, tools: [] }) : provider.generateText(input);
        if (scenario === 'provider-throws') await assert.rejects(call, /transport lost/); else await call();
        const rows = drainUsage();
        assert.equal(rows[0]?.ok, true, 'unrelated call is never refunded');
        assert.equal(settled.length, 1);
        assert.deepEqual(settled[0], { ...real, invocationKey: 'co-1#attempt-v2#provider-v2#0',
          ...(scenario === 'valid' ? {} : { ok: false, errorCode: scenario.startsWith('provider-') ? (scenario === 'provider-failed' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNKNOWN') : 'OUTPUT_UNUSABLE' }) });
      });
    });
  }
});


describe('B1 output schema budget identity', () => {
  const input: ProviderInput = { systemPrompt: 'Classify the workflow.', messages: [{ role: 'user', text: 'ส่งใบเบิกของฉันให้อนุมัติหน่อย' }], maxTokens: 256 };
  it('pins the existing schema-free bytes and digests', () => {
    const expected = { inputTokenBound: 5120, payloadDigest: '87d7cbb809786801e300db4f435359e0704d67b7ad3b6b42715d2c51947e3a3a',
      schemaDigest: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' };
    assert.deepEqual(v2RenderedInput(input), expected);
    assert.deepEqual(v2RenderedInput({ ...input, outputSchema: undefined } as any), expected);
  });
  it('counts canonical UTF-8 schema bytes and changes both digests', () => {
    const schema = { type: 'object', required: ['label'], additionalProperties: false, properties: { label: { type: 'string', description: 'ก'.repeat(1000) } } };
    const structured = { ...input, outputSchema: { name: 'classifier', schema } };
    const plain = v2RenderedInput(input), rendered = v2RenderedInput(structured);
    assert.notEqual(rendered.payloadDigest, plain.payloadDigest);
    assert.notEqual(rendered.schemaDigest, plain.schemaDigest);
    assert.ok(rendered.inputTokenBound >= plain.inputTokenBound + Buffer.byteLength('ก'.repeat(1000), 'utf8') - 1024);
    const reordered = { ...structured, outputSchema: { schema: { properties: schema.properties, additionalProperties: false, required: ['label'], type: 'object' }, name: 'classifier' } };
    assert.deepEqual(v2RenderedInput(reordered), rendered);
    assert.notEqual(v2RenderedInput({ ...structured, outputSchema: { ...structured.outputSchema, name: 'different' } }).schemaDigest, rendered.schemaDigest);
    assert.ok(providerInputTokenUpperBound(structured)! >= providerInputTokenUpperBound(input)! + Buffer.byteLength(JSON.stringify(schema), 'utf8'));
  });
});

it('B1 includes output schema text in conservative timeout usage', async () => {
  const plain: ProviderInput = { messages: [{ role: 'user', text: 'ทดสอบ' }], maxTokens: 256 };
  const structured = { ...plain, outputSchema: { name: 'classifier', schema: { type: 'object', description: 'ก'.repeat(1000) } } };
  const before = await conservativeTimeoutUsage(plain);
  const after = await conservativeTimeoutUsage(structured);
  assert.ok(after.inputTokens! >= before.inputTokens! + 900);
});
