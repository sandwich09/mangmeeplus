import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineAiTurnUseCase } from './line-ai-turn.use-case';
import type { LineAiTurnRequest } from '@watchdog-bms/contracts';

const validReq: LineAiTurnRequest = {
  requestId: 'req-spec',
  webhookEventId: 'evt-spec',
  messageText: 'ดูสต็อกสินค้า',
  messagePreviewHash: 'abc',
  userContext: {
    lineUserId: 'line-1',
    internalUserId: 'user-1',
    companyId: 'company-1',
    membershipId: 'mem-1',
    permissions: ['inventory.product.read', 'inventory.report.read'],
    roles: ['owner'],
    branchIds: ['branch-1'],
    locationIds: ['location-1'],
    locale: 'th-TH',
  },
};

function makeErpTools(status: string = 'ok', data: unknown = { count: 2 }) {
  return {
    invoke: async (tool: any) => ({
      toolName: tool.name, status, data, sourceRefs: [], asOf: new Date().toISOString(),
    }),
  } as any;
}

function makeOrchestrator(replyText: string = 'orchestrator reply') {
  return {
    run: async () => ({
      plan: { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false },
      outputs: [],
      replyText,
      sourceRefs: [],
      webLinks: [],
      durationMs: 5,
    }),
  } as any;
}

function makeAgentcoreRuntime(
  result: Partial<{ replyText: string; refused: boolean; plan: any; durationMs: number; sourceRefs: any[]; webLinks: any[]; toolsInvoked: any[]; presentation: any }> | Error = {},
) {
  return {
    invoke: async () => {
      if (result instanceof Error) throw result;
      return {
        turnId: 'turn-1',
        replyText: result.replyText ?? 'agentcore reply',
        plan: result.plan ?? { status: 'ROUTABLE', intents: [] },
        durationMs: result.durationMs ?? 10,
        refused: result.refused ?? false,
        sourceRefs: result.sourceRefs ?? [],
        webLinks: result.webLinks ?? [],
        toolsInvoked: result.toolsInvoked ?? [],
        ...(result.presentation ? { presentation: result.presentation } : {}),
      };
    },
  } as any;
}

describe('LineAiTurnUseCase – feature flag routing', () => {
  it('feature disabled uses item 07 deterministic path (not orchestrator)', async () => {
    let orchestratorCalled = false;
    const orchestrator = { run: async () => { orchestratorCalled = true; return {} as any; } } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.equal(orchestratorCalled, false, 'orchestrator must not be called when flag is off');
    assert.equal(resp.requestId, validReq.requestId);
    assert.equal(resp.presentation?.kind, 'answer_cards');
    assert.ok((resp.presentation?.cards.length ?? 0) > 0);
  });

  it('deterministic fallback preserves scalar zero as a successful answer card', async () => {
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools('ok', 0), makeOrchestrator(), config, makeAgentcoreRuntime());
    const resp = await useCase.execute(validReq);
    assert.equal(resp.presentation?.kind, 'answer_cards');
    assert.ok(resp.presentation?.cards.some((card) => /0/.test(card.text)));
  });

  it('feature enabled routes to local orchestrator (strands-local) and uses its reply', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator('สวัสดีจาก orchestrator'), config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.equal(resp.replyText, 'สวัสดีจาก orchestrator');
  });

  it('passes local orchestrator presentation through unchanged', async () => {
    const presentation = { kind: 'answer_cards', cards: [{ text: 'สวัสดีจาก card' }] };
    const orchestrator = makeOrchestrator('สวัสดีจาก orchestrator');
    orchestrator.run = async () => ({ ...(await makeOrchestrator().run()), presentation });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());
    assert.deepEqual((await useCase.execute(validReq)).presentation, presentation);
  });

  it('feature enabled – UNROUTABLE plan sets refused=true', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const orchestrator = {
      run: async () => ({
        plan: { status: 'UNROUTABLE', language: 'th', intents: [], refusals: [{ request: 'ชำระเงิน', reason: 'mutation_blocked' }], requiresHumanReview: false },
        outputs: [], replyText: '⚠️ ไม่สามารถดำเนินการ', sourceRefs: [], webLinks: [], durationMs: 1,
      }),
    } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());
    const resp = await useCase.execute({ ...validReq, messageText: 'ชำระเงิน' });
    assert.equal(resp.refused, true);
    assert.equal(resp.refusalReason, 'mutation_blocked');
  });

  it('validation failure returns forbidden before reaching orchestrator', async () => {
    let orchestratorCalled = false;
    const orchestrator = { run: async () => { orchestratorCalled = true; return {} as any; } } as any;
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute({ ...validReq, requestId: '' });
    assert.equal(orchestratorCalled, false, 'orchestrator must not run on invalid request');
    assert.equal(resp.refused, true);
  });

  it('orchestrator error produces safe error reply (no stack traces)', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const orchestrator = { run: async () => { throw new Error('Bedrock error details'); } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.equal(resp.refused, true);
    assert.ok(!resp.replyText.includes('Bedrock'), 'provider error details must not appear in LINE reply');
  });
});

describe('LineAiTurnUseCase – agentcore runtime routing', () => {
  it('routes to AgentCore adapter when LINE_AI_AGENT_RUNTIME=agentcore', async () => {
    let agentcoreCalled = false;
    let invokeInput: any;
    const agentcoreRuntime = {
      invoke: async (input: any) => {
        agentcoreCalled = true;
        invokeInput = input;
        return {
          turnId: 'turn-1',
          replyText: 'reply from agentcore',
          plan: { status: 'ROUTABLE', intents: [] },
          durationMs: 20,
          refused: false,
          sourceRefs: [],
          webLinks: [],
          toolsInvoked: [],
        };
      },
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    let orchestratorCalled = false;
    const orchestrator = { run: async () => { orchestratorCalled = true; return {} as any; } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.equal(agentcoreCalled, true, 'AgentCore adapter must be called');
    assert.equal(orchestratorCalled, false, 'local orchestrator must not be called');
    assert.equal(resp.replyText, 'reply from agentcore');
    assert.equal(resp.refused, false);
    assert.deepEqual(
      {
        membershipId: invokeInput.membershipId,
        branchIds: invokeInput.branchIds,
        locationIds: invokeInput.locationIds,
        roles: invokeInput.roles,
      },
      { membershipId: 'mem-1', branchIds: ['branch-1'], locationIds: ['location-1'], roles: ['owner'] },
    );
    assert.deepEqual(resp.toolsInvoked, []);
  });

  it('maps runtime tool and source lineage onto the turn response', async () => {
    const sourceRef = { label: 'สินค้าใกล้หมด', module: 'inventory', entityType: 'product', permissionChecked: true as const };
    const webLink = { label: 'สินค้าใกล้หมด', path: '/inventory/low-stock' };
    const agentcoreRuntime = makeAgentcoreRuntime({
      sourceRefs: [sourceRef],
      webLinks: [webLink],
      toolsInvoked: [{ name: 'inventory.list_low_stock', status: 'ok', durationMs: 4 }],
    });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.toolsInvoked, ['inventory.list_low_stock']);
    assert.deepEqual(resp.sourceRefs, [sourceRef]);
    assert.deepEqual(resp.sourceLabels, ['สินค้าใกล้หมด']);
    assert.deepEqual(resp.webLinks, [webLink]);
  });

  it('passes AgentCore presentation through unchanged', async () => {
    const presentation = { kind: 'answer_cards', cards: [{ text: 'สต็อก 2 รายการ' }] };
    const agentcoreRuntime = makeAgentcoreRuntime({ presentation });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);
    assert.deepEqual((await useCase.execute(validReq)).presentation, presentation);
  });

  it('AgentCore UNROUTABLE result sets refused=true', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime({ refused: true, plan: { status: 'UNROUTABLE', intents: [] }, replyText: '⚠️ ไม่รองรับ' });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.refused, true);
  });

  it('AgentCore invoke error produces safe reply without leaking error details', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime(Object.assign(new Error('runtime ARN 403 forbidden'), { code: 'INVOKE_ERROR' }));
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.refused, true);
    assert.ok(!resp.replyText.includes('403'), 'error details must not appear in LINE reply');
    assert.ok(!resp.replyText.includes('forbidden'), 'error details must not appear in LINE reply');
  });
});

// ── M-02: real per-tool records + provider-failure trace ─────────────────────

/** Capture what the use case sends to its Nest logger (wired to pino in main.ts). */
function captureLogs(useCase: LineAiTurnUseCase): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const push = (entry: unknown) => { events.push(entry as Record<string, unknown>); };
  (useCase as unknown as { logger: unknown }).logger = { log: push, warn: push, error: push };
  return events;
}

describe('LineAiTurnUseCase – per-tool records (M-02)', () => {
  it('deterministic path builds toolCalls from the measured ToolResults', async () => {
    const erpTools = {
      invoke: async (tool: any) => ({
        toolName: tool.name, status: 'ok', data: { count: 2 }, sourceRefs: [], asOf: new Date().toISOString(), durationMs: 7,
      }),
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.ok((resp.toolCalls?.length ?? 0) > 0, 'deterministic path must report per-tool calls');
    assert.deepEqual(resp.toolCalls?.map((t) => t.name), resp.toolsInvoked, 'toolCalls must match toolsInvoked names');
    assert.ok(resp.toolCalls?.every((t) => t.status === 'ok' && t.durationMs === 7), 'measured per-tool duration must be used, not the turn duration');
  });

  it('deterministic path carries the per-tool errorCode and falls back to 0 when unmeasured', async () => {
    const erpTools = {
      invoke: async (tool: any) => ({
        toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'TOOL_TIMEOUT',
      }),
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: false, lineAiAgentRuntime: 'disabled' } as any;
    const useCase = new LineAiTurnUseCase(erpTools, makeOrchestrator(), config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.ok(resp.toolCalls?.every((t) => t.status === 'error' && t.errorCode === 'TOOL_TIMEOUT' && t.durationMs === 0));
  });

  it('local orchestrator path flattens specialist toolCalls onto the response', async () => {
    const toolCalls = [
      { name: 'inventory.list_low_stock', status: 'ok' as const, durationMs: 11 },
      { name: 'ledger.get_financial_summary', status: 'forbidden' as const, durationMs: 3 },
    ];
    const orchestrator = {
      run: async () => ({
        plan: { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false },
        outputs: [{ toolCalls: [toolCalls[0]] }, { toolCalls: [toolCalls[1]] }],
        replyText: 'ok', sourceRefs: [], webLinks: [], durationMs: 5,
      }),
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.toolCalls, toolCalls);
    assert.deepEqual(resp.toolsInvoked, toolCalls.map((t) => t.name));
  });

  it('AgentCore path passes real per-tool outcomes through, bounded to contract fields', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime({
      toolsInvoked: [
        { name: 'inventory.list_low_stock', status: 'ok', durationMs: 4, sourceRefs: [{ label: 'leak', module: 'inventory', entityType: 'x', permissionChecked: true }] },
        { name: 'ledger.get_financial_summary', status: 'error', durationMs: 9, errorCode: 'HTTP_503' },
      ],
    });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.toolCalls, [
      { name: 'inventory.list_low_stock', status: 'ok', durationMs: 4 },
      { name: 'ledger.get_financial_summary', status: 'error', durationMs: 9, errorCode: 'HTTP_503' },
    ]);
  });

  it('AgentCore version skew cannot poison the per-tool rows the API persists', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime({
      toolsInvoked: [
        // A skewed artifact can send anything; durationMs feeds an Int column and errorCode a String one.
        { name: 'inventory.list_low_stock', status: 'ok', durationMs: '4ms', errorCode: { code: 503 } },
        { name: 'ledger.get_financial_summary', status: 'error', durationMs: Number.NaN },
        { name: 42, status: 'ok', durationMs: 5 },
        null,
      ],
    });
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.toolCalls, [
      { name: 'inventory.list_low_stock', status: 'ok', durationMs: 0 },
      { name: 'ledger.get_financial_summary', status: 'error', durationMs: 0 },
    ], 'unusable durations become 0 and non-string errorCodes are dropped');
    assert.deepEqual(resp.toolsInvoked, ['inventory.list_low_stock', 'ledger.get_financial_summary'],
      'entries without a string name are dropped from both fields');
  });
});

describe('LineAiTurnUseCase – provider failure trace (M-02)', () => {
  it('AgentCore failure sets the provider error code on the refused response and emits ai.provider.failure', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime(Object.assign(new Error('bedrock throttled'), { code: 'PROVIDER_THROTTLED' }));
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);
    const events = captureLogs(useCase);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.refused, true);
    assert.equal(resp.errorCode, 'PROVIDER_THROTTLED');
    const failure = events.find((e) => e['msg'] === 'ai.provider.failure');
    assert.ok(failure, 'ai.provider.failure must be emitted');
    assert.equal(failure['requestId'], validReq.requestId);
    assert.equal(failure['code'], 'PROVIDER_THROTTLED');
    assert.equal(failure['path'], 'agentcore');
  });

  it('AgentCore failure without a typed code falls back to AGENTCORE_INVOKE_FAILED', async () => {
    const agentcoreRuntime = makeAgentcoreRuntime(new Error('socket hang up'));
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'agentcore' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator(), config, agentcoreRuntime);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.errorCode, 'AGENTCORE_INVOKE_FAILED');
  });

  it('orchestrator failure sets ORCHESTRATOR_FAILED and emits ai.provider.failure with path=orchestrator', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const orchestrator = { run: async () => { throw new Error('Bedrock error details'); } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());
    const events = captureLogs(useCase);

    const resp = await useCase.execute(validReq);
    assert.equal(resp.errorCode, 'ORCHESTRATOR_FAILED');
    const failure = events.find((e) => e['msg'] === 'ai.provider.failure');
    assert.ok(failure);
    assert.equal(failure['requestId'], validReq.requestId);
    assert.equal(failure['path'], 'orchestrator');
    assert.ok(!('messageText' in failure), 'provider failure events must not carry message text');
  });

  it('orchestrator ProviderError code is preserved on the refused response', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const orchestrator = { run: async () => { throw Object.assign(new Error('timeout'), { code: 'PROVIDER_TIMEOUT' }); } } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());

    const resp = await useCase.execute(validReq);
    assert.equal(resp.errorCode, 'PROVIDER_TIMEOUT');
  });
});

describe('LineAiTurnUseCase – coverage passthrough (item 10F)', () => {
  it('maps orchestrator coverage verdicts onto the turn response', async () => {
    const coverage = [
      { request: 'ยอดขายวันนี้', verdict: 'covered' as const },
      { request: 'ของใกล้หมด', verdict: 'uncovered' as const, reason: 'budget' },
    ];
    const orchestrator = {
      run: async () => ({
        plan: { status: 'ROUTABLE', language: 'th', intents: [{ intent: 'read_summary', agent: 'general', priority: 1, requiredTools: [], missingContext: [] }], refusals: [], requiresHumanReview: false },
        outputs: [], replyText: 'ok', sourceRefs: [], webLinks: [], durationMs: 5, coverage,
      }),
    } as any;
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), orchestrator, config, makeAgentcoreRuntime());
    const resp = await useCase.execute(validReq);
    assert.deepEqual(resp.coverage, coverage);
  });

  it('omits coverage when the orchestrator has none (10B paths unchanged)', async () => {
    const config = { lineAiAgentOrchestrationEnabled: true, lineAiAgentRuntime: 'strands-local' } as any;
    const useCase = new LineAiTurnUseCase(makeErpTools(), makeOrchestrator('x'), config, makeAgentcoreRuntime());
    const resp = await useCase.execute(validReq);
    assert.equal(resp.coverage, undefined);
  });
});
