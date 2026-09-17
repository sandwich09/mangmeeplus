import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import {
  AI_BUDGET_STEP_BOUNDS, aiBudgetInvocationKey, parseAiBudgetEnvelope,
  type AiBudgetEnvelope, type AiUsageEntry,
} from '@watchdog-bms/contracts';
import { AiUsageInterceptor, internalAiSourceRoute } from './ai-usage.interceptor';
import {
  appendUsage, currentBudgetState, currentUsageCompanyId, drainUsage, runWithUsageContext,
  type BudgetRequestState,
} from './usage-context';
import { pdfPageUpperBound, withAiBudgetEnvelope } from './ai-budget-provider';
import type { AiBudgetSeam, AiBudgetSettleOutcome, AiBudgetStepOutcome } from './ai-budget-seam';
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

describe('withAiBudgetEnvelope: invocation evidence', () => {
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

  it('settles it at the declared bound, labelled an estimate — never at zero (spec §12.6)', async () => {
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
      [AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxInputTokens, 4096, 'CONSERVATIVE_ESTIMATE'],
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
