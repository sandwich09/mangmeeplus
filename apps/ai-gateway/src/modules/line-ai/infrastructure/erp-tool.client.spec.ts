import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErpToolClient, enforceSourceHonesty, toolMetaToPolicy } from './erp-tool.client';
import { ToolPolicyEnforcerService } from '../../../common/ai/tool-policy-enforcer.service';
import type { AiGatewayConfigService } from '../../../common/config/ai-gateway-config.service';
import { LINE_TOOL_REGISTRY, type ToolMeta } from '@watchdog-bms/contracts';
import { runWithUsageContext } from '../../../common/usage/usage-context';

function makeConfig(overrides: Partial<AiGatewayConfigService> = {}): AiGatewayConfigService {
  return {
    aiToolPolicyEnforced: true,
    aiToolAuditEnabled: true,
    aiFinalMutationEnabled: false,
    aiGatewayInternalSecret: 'test-secret',
    erpCoreInternalUrl: 'http://localhost:3001/v1',
    aiToolTimeoutMs: 5000,
    ...overrides,
  } as AiGatewayConfigService;
}

function makeEnforcer(config: AiGatewayConfigService): ToolPolicyEnforcerService {
  return new ToolPolicyEnforcerService(config);
}

const readTool: ToolMeta = {
  name: 'inventory.list_low_stock',
  description: 'Test read tool.',
  businessSubjects: ['inventory'],
  questionKinds: ['summary'],
  category: 'read_summary',
  requiredPermissions: ['inventory.product.read'],
  sourceModule: 'inventory',
  supportedAgents: ['inventory'],
  sensitiveAudit: false,
  requiresErpPermissionCheck: true,
};

const draftTool: ToolMeta = {
  name: 'synthetic.draft_create',
  description: 'Test draft tool.',
  businessSubjects: ['expense'],
  questionKinds: ['detail'],
  category: 'draft_create',
  requiredPermissions: ['expense.receipt.upload'],
  sourceModule: 'expenses',
  supportedAgents: [],
  sensitiveAudit: true,
  requiresErpPermissionCheck: true,
};

const finalMutationTool: ToolMeta = {
  name: 'synthetic.post_journal',
  description: 'Test mutation tool.',
  businessSubjects: ['ledger'],
  questionKinds: ['detail'],
  category: 'final_mutation',
  requiredPermissions: ['ledger.journal.write'],
  sourceModule: 'accounting',
  supportedAgents: [],
  sensitiveAudit: true,
  requiresErpPermissionCheck: true,
};

const ctx = {
  companyId: 'company-1',
  userId: 'user-1',
  permissions: ['inventory.product.read'],
  locale: 'th-TH',
  actorDelegations: {
    'inventory.list_low_stock': Array.from({ length: 8 }, () => 'delegation-inventory'),
    'synthetic.draft_create': ['delegation-draft'],
    'synthetic.post_journal': ['delegation-mutation'],
    'accounting.get_summary': ['delegation-accounting'],
    'accounting.capture_receipt_evidence': ['delegation-capture'],
  },
};

/** Capture what the client sends to its Nest logger (wired to pino in main.ts). */
function captureLogs(client: ErpToolClient): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const push = (entry: unknown) => { events.push(entry as Record<string, unknown>); };
  (client as unknown as { logger: unknown }).logger = { log: push, warn: push, error: push };
  return events;
}

/** Fresh delegation queue per test – ErpToolClient shifts entries off the shared ctx array. */
function observabilityCtx(requestId: string) {
  return { ...ctx, requestId, actorDelegations: { [readTool.name]: ['delegation-observability'] } };
}

describe('toolMetaToPolicy', () => {
  it('read_summary tool is allowed when final mutation disabled', () => {
    const policy = toolMetaToPolicy(readTool);
    assert.equal(policy.allowedWhenFinalMutationDisabled, true);
    assert.equal(policy.requiresErpCorePermissionCheck, true);
  });

  it('draft_create tool is allowed when final mutation disabled', () => {
    const policy = toolMetaToPolicy(draftTool);
    assert.equal(policy.allowedWhenFinalMutationDisabled, true);
  });

  it('final_mutation tool is blocked when final mutation disabled', () => {
    const policy = toolMetaToPolicy(finalMutationTool);
    assert.equal(policy.allowedWhenFinalMutationDisabled, false);
  });

  it('sensitive tool maps to high risk level', () => {
    const policy = toolMetaToPolicy(draftTool);
    assert.equal(policy.riskLevel, 'high');
  });

  it('non-sensitive tool maps to low risk level', () => {
    const policy = toolMetaToPolicy(readTool);
    assert.equal(policy.riskLevel, 'low');
  });
});

describe('ErpToolClient – governed tool path', () => {
  it('X3: accepts counterparty previews with the same source convention as expense previews', () => {
    const tool = LINE_TOOL_REGISTRY.find(tool => tool.name === 'counterparty.action.preview')!;
    const result = { toolName: tool.name, status: 'ok' as const, data: { reply: 'ตรวจคู่ค้าที่จะเพิ่มแล้วกดยืนยันค่ะ', preview: { lines: ['เลขผู้เสียภาษี: ยังไม่มี → 0105556000011'] } },
      sourceRefs: [{ module: 'accounting-documents', entityType: 'counterparty_action_preview', label: 'คู่ค้า/ผู้รับเงิน', permissionChecked: true as const }], asOf: new Date().toISOString() };
    assert.equal(enforceSourceHonesty(tool, result), result);
    assert.equal(enforceSourceHonesty(tool, { ...result, sourceRefs: [{ ...result.sourceRefs[0]!, sourceType: 'ACTION' }] }).errorCode, 'TOOL_RESULT_SOURCE_MISMATCH');
  });
  it('accepts only successful results with the declared permission-checked source module', () => {
    const valid = { toolName: readTool.name, status: 'ok' as const, data: { count: 1 }, sourceRefs: [{ label: 'stock', module: 'inventory', entityType: 'stock', permissionChecked: true as const }], asOf: '2026-07-15T00:00:00Z' };
    assert.equal(enforceSourceHonesty(readTool, valid), valid);

    const noSource = enforceSourceHonesty(readTool, { ...valid, sourceRefs: [] });
    assert.equal(noSource.errorCode, 'TOOL_RESULT_NO_SOURCE');
    assert.equal(noSource.data, undefined);

    const noData = enforceSourceHonesty(readTool, { ...valid, data: undefined });
    assert.equal(noData.errorCode, 'TOOL_RESULT_NO_DATA');

    const mismatch = enforceSourceHonesty(readTool, { ...valid, sourceRefs: [{ ...valid.sourceRefs[0]!, module: 'employee-access' }] });
    assert.equal(mismatch.errorCode, 'TOOL_RESULT_SOURCE_MISMATCH');
    assert.equal(mismatch.data, undefined);
  });

  it('accepts ACTION locators only from reimbursement draft tools and never as ERP read evidence', () => {
    const reimbursementTool: ToolMeta = { ...draftTool, name: 'reimbursement.draft.get_options',
      sourceModule: 'reimbursements', businessSubjects: ['reimbursement'] };
    const action = { toolName: reimbursementTool.name, status: 'ok' as const,
      data: { reimbursementDraft: { status: 'needs_fields' } }, sourceRefs: [{ label: 'draft',
        module: 'reimbursements', entityType: 'reimbursement_draft_action', entityId: 'action-1',
        permissionChecked: true as const, sourceType: 'ACTION' as const }], asOf: '2026-09-27T00:00:00Z' };
    assert.equal(enforceSourceHonesty(reimbursementTool, action), action);
    assert.equal(enforceSourceHonesty(readTool, { ...action, toolName: readTool.name,
      sourceRefs: [{ ...action.sourceRefs[0]!, module: 'inventory' }] }).errorCode, 'TOOL_RESULT_SOURCE_MISMATCH');
    assert.equal(enforceSourceHonesty(reimbursementTool, { ...action,
      sourceRefs: [{ ...action.sourceRefs[0]!, sourceType: 'ERP_READ' }] }).errorCode, 'TOOL_RESULT_SOURCE_MISMATCH');
  });

  it('scrubs business data and sources from every typed non-ok result', () => {
    for (const status of ['forbidden', 'unsupported_module', 'unavailable', 'error'] as const) {
      const result = enforceSourceHonesty(readTool, {
        toolName: readTool.name,
        status,
        data: { hiddenCount: 999 },
        sourceRefs: [{ label: 'hidden', module: 'inventory', entityType: 'stock', entityId: 'secret', permissionChecked: true }],
        asOf: '2026-07-15T00:00:00Z',
        errorCode: 'SAFE_CODE',
      });
      assert.equal(result.status, status);
      assert.equal(result.data, undefined);
      assert.deepEqual(result.sourceRefs, []);
      assert.equal(result.errorCode, 'SAFE_CODE');
    }
  });

  it('maps malformed or null successful HTTP bodies to a safe typed error', async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const body of [null, { unexpected: true }]) {
        globalThis.fetch = async () => ({ ok: true, json: async () => body }) as Response;
        const config = makeConfig();
        const result = await new ErpToolClient(config, makeEnforcer(config)).invoke(readTool, ctx, {});
        assert.equal(result.status, 'error');
        assert.equal(result.errorCode, 'INVALID_TOOL_RESULT');
        assert.deepEqual(result.sourceRefs, []);
      }
      globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }) as unknown as Response;
      const config = makeConfig();
      const malformed = await new ErpToolClient(config, makeEnforcer(config)).invoke(readTool, ctx, {});
      assert.equal(malformed.status, 'error');
      assert.equal(malformed.errorCode, 'INVALID_TOOL_RESULT');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('draft_create tool is allowed under AI_FINAL_MUTATION_ENABLED=false and proceeds to ERP call', async () => {
    // draft_create is allowed; with no secret the call stops at INTERNAL_SECRET_NOT_CONFIGURED
    const config = makeConfig({ aiFinalMutationEnabled: false, aiGatewayInternalSecret: undefined });
    const client = new ErpToolClient(config, makeEnforcer(config));
    const result = await client.invoke(draftTool, ctx, {});
    // Policy passes draft_create; call stops at missing secret, NOT policy denied
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'INTERNAL_SECRET_NOT_CONFIGURED');
  });

  it('final_mutation tool returns POLICY_DENIED when AI_FINAL_MUTATION_ENABLED=false', async () => {
    const config = makeConfig({ aiFinalMutationEnabled: false });
    const client = new ErpToolClient(config, makeEnforcer(config));
    const syntheticFinal: ToolMeta = { ...finalMutationTool, name: 'synthetic.post_journal' };
    const result = await client.invoke(syntheticFinal, ctx, {});
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'POLICY_DENIED');
    assert.ok(!result.data, 'denied result must not include business data');
  });

  it('read tool is allowed and proceeds to ERP call (secret missing → secret error)', async () => {
    const config = makeConfig({ aiGatewayInternalSecret: undefined });
    const client = new ErpToolClient(config, makeEnforcer(config));
    const result = await client.invoke(readTool, ctx, {});
    // Policy passes; stops at missing secret
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'INTERNAL_SECRET_NOT_CONFIGURED');
  });

  it('policy_enforced=false blocks all tool execution', async () => {
    const config = makeConfig({ aiToolPolicyEnforced: false });
    const client = new ErpToolClient(config, makeEnforcer(config));
    const result = await client.invoke(readTool, ctx, {});
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'POLICY_DENIED');
    assert.ok(!result.data, 'blocked result must not include business data');
  });

  it('accounting.get_summary is wired: reaches the ERP HTTP path like any tool, not short-circuited', async () => {
    let postedToolName: string | undefined;
    let postedContext: Record<string, unknown> | undefined;
    let delegationHeader: string | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      const posted = JSON.parse(String(init?.body));
      postedToolName = posted.toolName;
      postedContext = posted.context;
      delegationHeader = (init?.headers as Record<string, string>)?.['X-Actor-Delegation'];
      return {
        ok: true,
        json: async () => ({ toolName: 'accounting.get_summary', status: 'ok', sourceRefs: [], asOf: new Date().toISOString() }),
      } as Response;
    };
    try {
      const config = makeConfig();
      const client = new ErpToolClient(config, makeEnforcer(config));
      const accountingSummary: ToolMeta = { ...readTool, name: 'accounting.get_summary', requiredPermissions: ['accounting.document.read'], sourceModule: 'accounting' };
      const result = await client.invoke(accountingSummary, ctx, {});
      // Must reach the shared POST path (fetch mock ran) with its own toolName, not return unsupported_module
      assert.equal(postedToolName, 'accounting.get_summary', 'accounting.get_summary must POST to ERP, not short-circuit');
      assert.equal(delegationHeader, 'delegation-accounting');
      assert.equal(postedContext?.['actorDelegations'], undefined);
      assert.notEqual(result.status, 'unsupported_module');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('missing required input field returns MISSING_REQUIRED_INPUT before API call', async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetchCalled = true; return {} as Response; };
    try {
      const config = makeConfig();
      const client = new ErpToolClient(config, makeEnforcer(config));
      const toolWithSchema: ToolMeta = { ...readTool, name: 'accounting.capture_receipt_evidence', category: 'evidence_capture', requiredInputFields: ['attachments'] };
      const result = await client.invoke(toolWithSchema, ctx, {});
      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, 'MISSING_REQUIRED_INPUT');
      assert.equal(fetchCalled, false, 'fetch must not be called when required input is missing');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('permission denied response from ERP contains no business data', async () => {
    // Stub fetch to return forbidden
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ toolName: 'inventory.list_low_stock', status: 'forbidden', sourceRefs: [], asOf: new Date().toISOString() }),
    }) as Response;
    try {
      const config = makeConfig();
      const client = new ErpToolClient(config, makeEnforcer(config));
      const result = await client.invoke(readTool, ctx, {});
      assert.equal(result.status, 'forbidden');
      assert.ok(!result.data, 'forbidden result must not include hidden business data');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('emits ai.tool.invoke.result with requestId + durationMs and attaches durationMs to the result (success)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        toolName: readTool.name,
        status: 'ok',
        data: { count: 1 },
        sourceRefs: [{ label: 'stock', module: 'inventory', entityType: 'stock', permissionChecked: true }],
        asOf: '2026-07-28T00:00:00Z',
      }),
    }) as Response;
    try {
      const config = makeConfig();
      const client = new ErpToolClient(config, makeEnforcer(config));
      const events = captureLogs(client);
      const result = await client.invoke(readTool, observabilityCtx('req-obs-ok'), {});
      assert.equal(result.status, 'ok');
      assert.equal(typeof result.durationMs, 'number', 'ToolResult must carry the measured duration');
      const event = events.find((e) => e['msg'] === 'ai.tool.invoke.result');
      assert.ok(event, 'ai.tool.invoke.result must be emitted once per invoke');
      assert.equal(event['requestId'], 'req-obs-ok');
      assert.equal(event['toolName'], readTool.name);
      assert.equal(event['status'], 'ok');
      assert.equal(event['durationMs'], result.durationMs);
      assert.equal(event['errorCode'], undefined);
      assert.ok(!('input' in event) && !('messageText' in event), 'tool input must never be logged');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('emits ai.tool.invoke.result with the errorCode and durationMs on ERP HTTP failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response;
    try {
      const config = makeConfig();
      const client = new ErpToolClient(config, makeEnforcer(config));
      const events = captureLogs(client);
      const result = await client.invoke(readTool, observabilityCtx('req-obs-503'), {});
      assert.equal(result.errorCode, 'HTTP_503');
      assert.equal(typeof result.durationMs, 'number');
      const event = events.find((e) => e['msg'] === 'ai.tool.invoke.result');
      assert.ok(event);
      assert.equal(event['requestId'], 'req-obs-503');
      assert.equal(event['status'], 'error');
      assert.equal(event['errorCode'], 'HTTP_503');
      assert.equal(event['durationMs'], result.durationMs);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('policy deny event carries requestId and the denied result still carries durationMs', async () => {
    const config = makeConfig({ aiToolPolicyEnforced: false });
    const client = new ErpToolClient(config, makeEnforcer(config));
    const events = captureLogs(client);
    const result = await client.invoke(readTool, observabilityCtx('req-obs-deny'), {});
    assert.equal(result.errorCode, 'POLICY_DENIED');
    assert.equal(typeof result.durationMs, 'number');
    const deny = events.find((e) => e['msg'] === 'ai.tool.policy.deny');
    assert.ok(deny, 'deny must emit the ai.tool.policy.deny code from the M-02 catalog');
    // L-14: the production metric filter keys on $.riskLevel, so a kill-switch trip without one
    // is invisible to the alarm.
    assert.equal(deny['riskLevel'], 'HIGH', 'a policy/kill-switch denial must carry a root-level riskLevel');
    assert.equal(deny['requestId'], 'req-obs-deny');
    assert.equal(deny['toolName'], readTool.name);
    assert.equal(events.find((e) => e['msg'] === 'ai.tool.invoke.result')?.['errorCode'], 'POLICY_DENIED');
  });

  it('policy allow event carries requestId', async () => {
    const config = makeConfig({ aiGatewayInternalSecret: undefined });
    const client = new ErpToolClient(config, makeEnforcer(config));
    const events = captureLogs(client);
    await client.invoke(readTool, observabilityCtx('req-obs-allow'), {});
    const allow = events.find((e) => e['msg'] === 'ai.tool.policy.allow');
    assert.ok(allow);
    assert.equal(allow['requestId'], 'req-obs-allow');
  });

  it('fails closed before ERP fetch when the exact tool delegation is missing', async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return {} as Response;
    };
    try {
      const config = makeConfig();
      const client = new ErpToolClient(config, makeEnforcer(config));
      const result = await client.invoke(readTool, { ...ctx, actorDelegations: {} }, {});
      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, 'ACTOR_DELEGATION_MISSING');
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('forwards reimbursement evidence from trusted context and only the request-scoped v2 grant', async () => {
    const originalFetch = globalThis.fetch;
    let posted: any;
    const grant = { version: 2, turnKey: 'turn', authorityKind: 'webhook_event', authorityId: 'event',
      channelOwnerDigest: 'a'.repeat(64), attemptKey: 'attempt', monthKey: '2026-09', payerCompanyId: 'company-1',
      model: { provider: 'openai', modelId: 'model', region: 'ap-southeast-1' }, allowedProfileIds: ['line-control/2'],
      profileTableDigest: 'b'.repeat(64), maxTurnSlots: 4, maxRepairs: 1, admittedAtMs: 1,
      workDeadlineAtMs: 2, finalDeadlineAtMs: 3, nonce: 'nonce', nextOrdinal: 0,
      issuerVersion: 'line-budget-issuer:2', signature: 'c'.repeat(64) } as any;
    const evidence = { version: 2, turnKey: 'turn', parts: [], joinedSha256: 'd'.repeat(64), complete: true,
      utf16Units: 0, utf8Bytes: 0, normalizationVersion: 'lookup-v2' } as any;
    const candidates = { version: 2, inputDigest: evidence.joinedSha256, extractorVersion: 'value-v2',
      todayIso: '2026-09-27', completeness: 'complete', counts: { amounts: 0, dates: 0, periods: 0 },
      amounts: [], dates: [], periods: [] } as any;
    globalThis.fetch = async (_url, init) => {
      posted = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ toolName: readTool.name, status: 'ok', data: { count: 1 },
        sourceRefs: [{ label: 'stock', module: 'inventory', entityType: 'stock', permissionChecked: true }], asOf: new Date().toISOString() }) } as Response;
    };
    try {
      const config = makeConfig(), client = new ErpToolClient(config, makeEnforcer(config));
      await runWithUsageContext({ companyId: 'company-1', budget: { status: 'active-v2', grant,
        inputDigest: evidence.joinedSha256, sourceRoute: 'line', calls: 0, repairCount: 0 } }, () =>
        client.invoke(readTool, { ...ctx, inputEvidence: evidence, valueCandidatesV2: candidates,
          budgetGrantV2: { ...grant, signature: 'f'.repeat(64) }, actorDelegations: { [readTool.name]: ['delegation'] } }, {}));
      assert.deepEqual(posted.context.inputEvidence, evidence);
      assert.deepEqual(posted.context.valueCandidatesV2, candidates);
      assert.deepEqual(posted.context.budgetGrantV2, grant);
    } finally { globalThis.fetch = originalFetch; }
  });
});
