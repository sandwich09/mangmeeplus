/**
 * AgentCore Runtime tests – item 10B Phase 8.
 * Tests payload validation (via real import) and real HTTP behavior
 * for GET /ping and POST /invocations using the exported makeHttpServer factory.
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect, type AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { AI_BUDGET_PROFILE_TABLE_DIGEST_V2, LINE_AI_CONTEXT_MAX_TURNS, createLineAiInputEvidence, extractValueCandidates } from '@watchdog-bms/contracts';
import { validatePayload, payloadToTurnRequest, makeHttpServer, loadInternalSecret, createRuntimeOrchestrator, readBody, PayloadTooLargeError } from './runtime';
import { appendUsage } from '../common/usage/usage-context';

// ── Stub orchestrator ──────────────────────────────────────────────────────────

const stubOrchestrator = {
  run: async (_req: unknown) => ({
    plan: { status: 'ROUTABLE' as const, language: 'th', intents: [], refusals: [], requiresHumanReview: false },
    outputs: [{ toolCalls: [{ name: 'inventory.list_low_stock', status: 'ok' as const, durationMs: 4 }] }],
    replyText: 'stub reply',
    sourceRefs: [{ label: 'สินค้าใกล้หมด', module: 'inventory', entityType: 'product', permissionChecked: true as const }],
    webLinks: [{ label: 'สินค้าใกล้หมด', path: '/inventory/low-stock' }],
    presentation: { kind: 'answer_cards' as const, cards: [{ text: 'stub reply', sourceLabels: ['สินค้าใกล้หมด'] }] },
    deterministicExpenseCriterionConfirmation: true,
    durationMs: 1,
  }),
};

// ── validatePayload tests ──────────────────────────────────────────────────────

describe('AgentCore Runtime – payload validation', () => {
  it('preserves complete v2 raw input and grant through the AgentCore hop, with the wider bounded input', async () => {
    const text = 'ก'.repeat(8_500);
    const built = await createLineAiInputEvidence({
      turnKey: 'turn-2',
      parts: [{ partId: 'part-1', eventIdHash: 'a'.repeat(64), acceptedAtMs: 100, rawText: text }],
    });
    assert.ok(built);
    const budgetGrantV2 = {
      version: 2 as const, turnKey: 'turn-2', authorityKind: 'webhook_event' as const,
      authorityId: 'event-1', channelOwnerDigest: 'b'.repeat(64), attemptKey: 'attempt-1', monthKey: '2026-09',
      payerCompanyId: 'company-1', model: { provider: 'bedrock' as const, modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0', region: 'ap-southeast-1' },
      allowedProfileIds: ['line-intake-text/2' as const], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
      maxTurnSlots: 4 as const, maxRepairs: 1 as const, admittedAtMs: 100, workDeadlineAtMs: 10_000,
      finalDeadlineAtMs: 20_000, nonce: 'nonce-1', issuerVersion: 'api-1', nextOrdinal: 0, signature: 'c'.repeat(64),
    };
    const payload = validatePayload({
      turnId: 'turn-2', companyId: 'company-1', userId: 'user-1', messageText: built.messageText,
      inputEvidence: built.inputEvidence, budgetGrantV2,
      contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
    });
    assert.ok(payload);
    const request = payloadToTurnRequest(payload!);
    assert.equal(request.messageText, built.messageText);
    assert.deepEqual(request.inputEvidence, built.inputEvidence);
    assert.deepEqual(request.budgetGrantV2, budgetGrantV2);
    assert.deepEqual(request.contractCapabilities, ['input-evidence-v2', 'budget-envelope-v2']);
  });

  it('rejects v2 fields without both negotiated capabilities and an API grant', async () => {
    const built = await createLineAiInputEvidence({
      turnKey: 'turn-3', parts: [{ partId: 'part-1', eventIdHash: 'a'.repeat(64), acceptedAtMs: 100, rawText: 'ดูยอดขาย' }],
    });
    assert.ok(built);
    const base = { turnId: 'turn-3', companyId: 'company-1', userId: 'user-1', messageText: built.messageText, inputEvidence: built.inputEvidence };
    assert.equal(validatePayload({ ...base, contractCapabilities: ['input-evidence-v2'] }), null);
    assert.equal(validatePayload({ ...base, contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'] }), null);
  });

  it('preserves validated period candidates and rejects invented wire dates', () => {
    const messageText = 'สรุปค่าใช้จ่ายเดือนกรกฏาคม และ สิงหาคม';
    const valueCandidates = extractValueCandidates(messageText, '2026-09-25');
    const base = { turnId: 't', companyId: 'c', userId: 'u', messageText };
    assert.deepEqual(payloadToTurnRequest(validatePayload({ ...base, valueCandidates })!).valueCandidates, valueCandidates);
    const forged = { ...valueCandidates, periods: [{ ...valueCandidates.periods![0]!, fromDate: '2025-01-01' }] };
    assert.deepEqual(payloadToTurnRequest(validatePayload({ ...base, valueCandidates: forged })!).valueCandidates, valueCandidates);
  });
  it('loads the internal secret from its exact ARN instead of runtime metadata', async () => {
    const env: NodeJS.ProcessEnv = {
      AI_GATEWAY_INTERNAL_SECRET_ARN: 'arn:aws:secretsmanager:ap-southeast-1:123:secret:watchdog-bms/production/ai-gateway-internal-secret-x',
      AWS_REGION: 'ap-southeast-1',
    };
    let requested = '';
    await loadInternalSecret(env, async (secretId, region) => {
      requested = `${region}:${secretId}`;
      return 'resolved-at-runtime';
    });
    assert.match(requested, /^ap-southeast-1:arn:aws:secretsmanager:/);
    assert.equal(env['AI_GATEWAY_INTERNAL_SECRET'], 'resolved-at-runtime');
  });

  it('fails closed when the managed secret reference is absent or empty', async () => {
    await assert.rejects(loadInternalSecret({}), /AI_GATEWAY_INTERNAL_SECRET_ARN is required/);
    await assert.rejects(
      loadInternalSecret({ AI_GATEWAY_INTERNAL_SECRET_ARN: 'secret-arn' }, async () => ''),
      /AI_GATEWAY_INTERNAL_SECRET is empty/,
    );
  });

  it('boots and plans in production without a JWT key or source ARN', async () => {
    const previous = { ...process.env };
    try {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, {
        APP_ENV: 'production', DEPLOY_ENVIRONMENT: 'production', SERVICE_NAME: 'agentcore-runtime',
        SERVICE_VERSION: 'a'.repeat(40), GIT_SHA: 'a'.repeat(40), PUBLIC_BASE_URL: 'https://ai.example.com',
        CORS_ALLOWED_ORIGINS: 'https://app.example.com',
        LOG_FORMAT: 'json', MODEL_PROVIDER: 'disabled',
        AI_GATEWAY_INTERNAL_SECRET_ARN: 'internal-secret-arn',
        WATCHDOG_JWT_ISSUER: 'https://api.example.com', WATCHDOG_JWT_AUDIENCE: 'watchdog-bms',
      });
      const requested: string[] = [];
      await loadInternalSecret(process.env, async (id) => {
        requested.push(id);
        return 'gA4x8M1q6V3n9C2r7T5p0K8s1D6h4J9z';
      });
      const orchestrator = await createRuntimeOrchestrator();
      const payload = validatePayload({ turnId: 'no-jwt', companyId: 'company-1', userId: 'user-1', messageText: 'สวัสดี' });
      assert.ok(payload);
      const result = await orchestrator.run(payloadToTurnRequest(payload));
      assert.ok(result.plan);
      assert.ok(result.replyText);
      assert.deepEqual(requested, ['internal-secret-arn']);
      assert.equal(process.env['WATCHDOG_JWT_SECRET_ARN'], undefined);
      assert.equal(process.env['WATCHDOG_JWT_SECRET_SOURCE_ARN'], undefined);
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });

  it('valid payload with all required fields is accepted', () => {
    const payload = validatePayload({
      turnId: 'turn-1',
      companyId: 'company-1',
      userId: 'user-1',
      messageText: 'ดูสต็อกสินค้าใกล้หมด',
      permissions: ['inventory.product.read'],
    });
    assert.ok(payload !== null);
    assert.equal(payload?.turnId, 'turn-1');
    assert.equal(payload?.locale, 'th-TH');
  });

  it('re-validates the trusted outer intakeIntent by explicit membership and carries it (forged → dropped)', () => {
    const base = { turnId: 't', companyId: 'c', userId: 'u', messageText: 'ยอดขายวันนี้', permissions: ['crm.report.read'] };
    assert.equal(payloadToTurnRequest(validatePayload({ ...base, intakeIntent: 'BUSINESS_READ_QUESTION' })!).intakeIntent, 'BUSINESS_READ_QUESTION');
    assert.equal(payloadToTurnRequest(validatePayload({ ...base, intakeIntent: 'TOTALLY_FORGED' })!).intakeIntent, undefined);
    assert.equal(payloadToTurnRequest(validatePayload({ ...base, intakeIntent: 42 })!).intakeIntent, undefined);
    assert.equal(payloadToTurnRequest(validatePayload(base)!).intakeIntent, undefined);
  });

  it('missing turnId is rejected', () => {
    assert.equal(
      validatePayload({ companyId: 'c-1', userId: 'u-1', messageText: 'hello' }),
      null,
      'payload without turnId must be rejected',
    );
  });

  it('missing companyId is rejected', () => {
    assert.equal(validatePayload({ turnId: 't-1', userId: 'u-1', messageText: 'hello' }), null);
  });

  it('missing userId is rejected', () => {
    assert.equal(validatePayload({ turnId: 't-1', companyId: 'c-1', messageText: 'hello' }), null);
  });

  it('missing messageText is rejected', () => {
    assert.equal(validatePayload({ turnId: 't-1', companyId: 'c-1', userId: 'u-1' }), null);
  });

  it('null body is rejected', () => {
    assert.equal(validatePayload(null), null);
  });

  it('non-object body is rejected', () => {
    assert.equal(validatePayload('string'), null);
    assert.equal(validatePayload(42), null);
  });

  it('mutation payload is accepted structurally (enforcement is orchestrator responsibility)', () => {
    const payload = validatePayload({
      turnId: 't-2',
      companyId: 'c-1',
      userId: 'u-1',
      messageText: 'อนุมัติจ่ายเงิน',
    });
    assert.ok(payload !== null, 'payload shape is valid; mutation is refused by orchestrator');
  });

  it('permissions default to empty array when absent', () => {
    const payload = validatePayload({ turnId: 't-3', companyId: 'c-1', userId: 'u-1', messageText: 'hello' });
    assert.deepEqual(payload?.permissions, []);
  });

  it('reconstructs authoritative membership, branch, location, and role scope', () => {
    const payload = validatePayload({
      turnId: 't-scope',
      companyId: 'c-1',
      userId: 'u-1',
      membershipId: 'm-1',
      branchIds: ['b-1'],
      locationIds: ['l-1'],
      roles: ['owner'],
      entitlementDeniedPermissions: { 'inventory.report.read': 'inventory' },
      entitledFeatureKeys: ['product_catalog'],
      actorDelegations: { 'inventory.list_low_stock': ['signed-delegation'] },
      messageText: 'hello',
    });
    assert.ok(payload);

    const turnReq = payloadToTurnRequest(payload);
    assert.equal(turnReq.userContext.membershipId, 'm-1');
    assert.deepEqual(turnReq.userContext.branchIds, ['b-1']);
    assert.deepEqual(turnReq.userContext.locationIds, ['l-1']);
    assert.deepEqual(turnReq.userContext.roles, ['owner']);
    assert.deepEqual(turnReq.userContext.entitlementDeniedPermissions, { 'inventory.report.read': 'inventory' });
    assert.deepEqual(turnReq.userContext.entitledFeatureKeys, ['product_catalog']);
    assert.deepEqual(turnReq.actorDelegations, { 'inventory.list_low_stock': ['signed-delegation'] });
  });

  it('carries company feature entitlements through to the rebuilt turn request', () => {
    // AC-6 of the capability-help spec rests on this: UAT and production both run the AgentCore
    // path, so a field dropped here is a field the composer never sees in the only environments
    // that matter.
    const payload = validatePayload({
      turnId: 't-1', companyId: 'c-1', userId: 'u-1', messageText: 'hello',
      permissions: ['line.ai.query'], entitledFeatureKeys: ['crm', 'dashboard_notifications'],
    });
    assert.ok(payload);
    assert.deepEqual(payloadToTurnRequest(payload).entitledFeatureKeys, ['crm', 'dashboard_notifications']);
  });

  it('leaves entitlements undefined when an older gateway does not send them (fail-open)', () => {
    const payload = validatePayload({ turnId: 't-1', companyId: 'c-1', userId: 'u-1', messageText: 'hello' });
    assert.ok(payload);
    assert.equal(payloadToTurnRequest(payload).entitledFeatureKeys, undefined);
  });

  it('parses, bounds, and forwards an optional prepared plan (latency/autonomy §7)', () => {
    const preparedPlan = {
      version: 1, complexity: 'simple', confidence: 0.9,
      intentPlan: {
        status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
        intents: [{ intent: 'read_summary', subject: 'sale', agent: 'sales', priority: 1, requiredTools: ['sales.get_sales_summary'], missingContext: [] }],
      },
      proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { fromDate: '2026-08-20', toDate: '2026-08-20' } }],
      responseMode: 'simple_grounded', answerShape: 'single_metric',
    };
    const payload = validatePayload({ turnId: 't-pp', companyId: 'c-1', userId: 'u-1', messageText: 'hello', preparedPlan });
    assert.ok(payload);
    assert.equal(payload.preparedPlan?.proposedCalls[0]?.toolName, 'sales.get_sales_summary');
    assert.deepEqual(payloadToTurnRequest(payload).preparedPlan, preparedPlan);
  });

  it('drops a forged prepared plan rather than casting wire JSON as authority', () => {
    // Forged company scope injected into the tool input, and an unknown version — either drops it.
    const forged = validatePayload({
      turnId: 't-forge', companyId: 'c-1', userId: 'u-1', messageText: 'hello',
      preparedPlan: { version: 1, complexity: 'simple', confidence: 1, intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [], intents: [] }, proposedCalls: [{ toolName: 'sales.get_sales_summary', input: { companyId: 'other-tenant' } }], responseMode: 'simple_grounded' },
    });
    assert.equal(forged?.preparedPlan, undefined);
    assert.equal(payloadToTurnRequest(forged!).preparedPlan, undefined);
  });

  it('leaves the prepared plan undefined for a legacy caller that never sends one', () => {
    const payload = validatePayload({ turnId: 't-old-pp', companyId: 'c-1', userId: 'u-1', messageText: 'hello' });
    assert.equal(payload?.preparedPlan, undefined);
    assert.equal(payloadToTurnRequest(payload!).preparedPlan, undefined);
  });

  it('drops malformed internal availability evidence and preserves legacy null', () => {
    const malformed = validatePayload({
      turnId: 't-bad-policy', companyId: 'c-1', userId: 'u-1', messageText: 'hello',
      entitlementDeniedPermissions: { 'inventory.report.read': 42 },
      entitledFeatureKeys: ['inventory', 42],
    });
    assert.equal(malformed?.entitlementDeniedPermissions, undefined);
    assert.equal(malformed?.entitledFeatureKeys, undefined);

    const legacy = validatePayload({
      turnId: 't-legacy-policy', companyId: 'c-1', userId: 'u-1', messageText: 'hello',
      entitledFeatureKeys: null,
    });
    assert.equal(legacy?.entitledFeatureKeys, null);
  });

  it('reconstructs a valid turn request when authoritative scope fields are absent', () => {
    const payload = validatePayload({ turnId: 't-old', companyId: 'c-1', userId: 'u-1', messageText: 'hello' });
    assert.ok(payload);

    const turnReq = payloadToTurnRequest(payload);
    assert.equal(turnReq.userContext.membershipId, '');
    assert.deepEqual(turnReq.userContext.roles, []);
    assert.equal(turnReq.userContext.branchIds, undefined);
    assert.equal(turnReq.userContext.locationIds, undefined);
  });

	  it('accepts AgentCore playground prompt shorthand', () => {
	    const payload = validatePayload({ prompt: 'คุณเป็นใคร ทำอะไรได้บ้าง' });
	    assert.ok(payload !== null);
	    assert.equal(payload.messageText, 'คุณเป็นใคร ทำอะไรได้บ้าง');
	    assert.equal(payload.companyId, 'playground-company');
	    assert.equal(payload.userId, 'playground-user');
	  });

	  it('bounds conversation context to LINE_AI_CONTEXT_MAX_TURNS turns and 500 chars per preview', () => {
	    const payload = validatePayload({
	      turnId: 't-context',
	      companyId: 'c-1',
	      userId: 'u-1',
	      messageText: 'อันที่สองล่ะ',
	      conversationContext: {
	        lastTurnAt: '2026-07-05T10:00:00.000Z',
	        recentTurns: Array.from({ length: 20 }, (_, i) => ({
	          at: `2026-07-05T10:00:${String(i).padStart(2, '0')}.000Z`,
	          userMessagePreview: `${i + 1}-`.repeat(400),
	          assistantReplyPreview: `reply-${i + 1}`,
	          intent: 'READ_DETAIL',
	          agent: 'inventory',
	          refused: false,
	        })),
	      },
	    });

	    assert.equal(payload?.conversationContext?.recentTurns.length, LINE_AI_CONTEXT_MAX_TURNS);
	    assert.equal(payload?.conversationContext?.recentTurns[0]?.assistantReplyPreview, `reply-${20 - LINE_AI_CONTEXT_MAX_TURNS + 1}`);
	    assert.equal(payload?.conversationContext?.recentTurns[0]?.userMessagePreview?.length, 500);
	  });

	  // Spec §4 R-M2/R-M3: the runtime HTTP entrypoint re-parses conversationContext field-by-field
	  // rather than casting the request body, so recentReads needs the same explicit acceptance as
	  // deliveredExpenseSummary got when it was added.
	  it('accepts recentReads, bounded to 3 entries and 10 shownItems, with every LineAiReadMemory field', () => {
	    const oneContext = (turnId: string, recentReads: unknown) => ({
	      turnId, companyId: 'c-1', userId: 'u-1', messageText: 'รายการแรกคืออะไร',
	      conversationContext: { recentTurns: [{ at: '2026-09-27T09:00:00.000Z' }], recentReads },
	    });
	    const full = validatePayload(oneContext('t-full', [{
	      tool: 'expense.list_recent', answerShape: 'list', asOf: '2026-09-27T09:00:00.000Z',
	      period: { fromDate: '2026-08-01', toDate: '2026-08-31' }, documentStatus: 'CONFIRMED', paymentStatus: 'UNPAID',
	      categoryId: 'c1', categoryName: 'อาหาร', vendorId: 'v1', vendorName: 'ร้านสมใจ', branchId: 'b1', branchName: 'สาขาลาดพร้าว',
	      groupBy: 'category', shownItems: [{ ordinal: 1, id: 'e1', label: 'ร้านสมใจ', date: '2026-08-05', kind: 'category' }],
	    }]));
	    const entry = full?.conversationContext?.recentReads?.[0];
	    assert.equal(entry?.tool, 'expense.list_recent');
	    assert.deepEqual(entry?.period, { fromDate: '2026-08-01', toDate: '2026-08-31' });
	    assert.equal(entry?.categoryName, 'อาหาร');
	    assert.equal(entry?.branchName, 'สาขาลาดพร้าว');
	    assert.equal(entry?.shownItems?.[0]?.id, 'e1');

	    const many = validatePayload(oneContext('t-many', Array.from({ length: 5 }, (_, i) => ({
	      tool: 'reimbursement.get_summary', answerShape: 'single_metric', asOf: '2026-09-27T09:00:00.000Z', documentStatus: `s${i}`,
	    }))));
	    assert.equal(many?.conversationContext?.recentReads?.length, 3);

	    const manyItems = validatePayload(oneContext('t-items', [{
	      tool: 'expense.list_recent', answerShape: 'list', asOf: '2026-09-27T09:00:00.000Z',
	      shownItems: Array.from({ length: 15 }, (_, i) => ({ ordinal: i + 1, id: `e${i}`, label: 'x' })),
	    }]));
	    assert.equal(manyItems?.conversationContext?.recentReads?.[0]?.shownItems?.length, 10);
	  });

	  it('R22 carries a claim summary\'s applied filters, and drops forged or malformed ones', () => {
	    const oneContext = (claimFilters: unknown, tool = 'reimbursement.get_summary') => validatePayload({
	      turnId: 't-claim', companyId: 'c-1', userId: 'u-1', messageText: 'ของเขารวมเท่าไร',
	      conversationContext: { recentTurns: [{ at: '2026-09-27T09:00:00.000Z' }],
	        recentReads: [{ tool, answerShape: 'single_metric', asOf: '2026-09-27T09:00:00.000Z', claimFilters }] },
	    })?.conversationContext?.recentReads?.[0];
	    assert.deepEqual(oneContext({ requesterName: 'สมชัย', status: 'REJECTED', amountGt: '1000' })?.claimFilters, { requesterName: 'สมชัย', status: 'REJECTED', amountGt: '1000' });
	    assert.deepEqual(oneContext({})?.claimFilters, {});
	    for (const bad of [{ requester: 'someone' }, { amountGt: '1,000' }, { total: '5000' }, { requesterName: 7 }, 'x']) assert.equal(oneContext(bad)?.claimFilters, undefined);
	    assert.equal(oneContext({ requesterName: 'สมชัย' }, 'expense.list_recent')?.claimFilters, undefined);
	  });

	  it('spec R-M6: never carries an amount field through, and rejects a malformed recentReads entry entirely', () => {
	    const oneContext = (recentReads: unknown) => ({
	      turnId: 't-1', companyId: 'c-1', userId: 'u-1', messageText: 'รายการแรกคืออะไร',
	      conversationContext: { recentTurns: [{ at: '2026-09-27T09:00:00.000Z' }], recentReads },
	    });
	    const withAmount = validatePayload(oneContext([{
	      tool: 'expense.list_recent', answerShape: 'list', asOf: '2026-09-27T09:00:00.000Z', amount: '999999.99', totalAmount: 500,
	    }]));
	    const entry = withAmount?.conversationContext?.recentReads?.[0] as Record<string, unknown> | undefined;
	    assert.equal(entry?.['amount'], undefined);
	    assert.equal(entry?.['totalAmount'], undefined);

	    for (const bad of [
	      'not-an-array',
	      [{ tool: '', answerShape: 'list', asOf: '2026-09-27T09:00:00.000Z' }],
	      [{ tool: 'expense.list_recent', answerShape: 'both', asOf: '2026-09-27T09:00:00.000Z' }],
	      [{ tool: 'expense.list_recent', answerShape: 'list', asOf: 'not-a-date' }],
	    ]) {
	      const payload = validatePayload(oneContext(bad));
	      assert.equal(payload?.conversationContext?.recentReads, undefined, JSON.stringify(bad));
	    }
	  });
	});

// ── HTTP behavior tests ────────────────────────────────────────────────────────

describe('AgentCore Runtime – HTTP endpoints', () => {
  let serverUrl = '';
  let testServer: ReturnType<typeof makeHttpServer>;

  before(async () => {
    testServer = makeHttpServer(stubOrchestrator as any);
    await new Promise<void>((resolve) => testServer.listen(0, () => resolve()));
    const port = (testServer.address() as AddressInfo).port;
    serverUrl = `http://localhost:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      testServer.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('GET /ping returns 200 with ok status and discloses nothing else (L-13)', async () => {
    const res = await fetch(`${serverUrl}/ping`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['status'], 'ok');
    assert.equal(body['service'], undefined, 'the internal service name must not be disclosed');
    assert.deepEqual(Object.keys(body), ['status']);
  });

  it('POST /invocations with invalid JSON returns 400 INVALID_JSON', async () => {
    const res = await fetch(`${serverUrl}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json-{',
    });
    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['error'], 'INVALID_JSON');
  });

  it('POST /invocations with missing required fields returns 400 INVALID_PAYLOAD', async () => {
    const res = await fetch(`${serverUrl}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: 'turn-1' }), // missing companyId, userId, messageText
    });
    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['error'], 'INVALID_PAYLOAD');
  });

  it('POST /invocations with valid payload calls stub orchestrator and returns 200', async () => {
    const res = await fetch(`${serverUrl}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turnId: 'turn-1',
        companyId: 'company-1',
        userId: 'user-1',
        messageText: 'ดูสต็อกสินค้าใกล้หมด',
        permissions: ['inventory.product.read'],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['turnId'], 'turn-1');
    assert.equal(body['replyText'], 'stub reply');
    assert.equal(body['refused'], false);
    assert.deepEqual(body['toolsInvoked'], [{ name: 'inventory.list_low_stock', status: 'ok', durationMs: 4 }]);
    assert.deepEqual(body['sourceRefs'], [{ label: 'สินค้าใกล้หมด', module: 'inventory', entityType: 'product', permissionChecked: true }]);
    assert.deepEqual(body['webLinks'], [{ label: 'สินค้าใกล้หมด', path: '/inventory/low-stock' }]);
    assert.deepEqual(body['presentation'], { kind: 'answer_cards', cards: [{ text: 'stub reply', sourceLabels: ['สินค้าใกล้หมด'] }] });
    assert.equal(body['deterministicExpenseCriterionConfirmation'], true);
    assert.ok(!('usage' in body), 'a turn with no model call reports no usage rows');
  });

  it('reports the usage its own model calls produced', async () => {
    // The entrypoint runs outside the gateway's HTTP stack, so it opens its own collector: without
    // it a rebuilt artifact would report nothing and the API could never meter this runtime.
    const usage = { tag: 'line.loop', modelId: 'test-model', ok: true, inputTokens: 12, outputTokens: 3, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 7 };
    const server = makeHttpServer({
      run: async (req: unknown) => { appendUsage(usage); return stubOrchestrator.run(req); },
    } as any);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    try {
      const res = await fetch(`http://localhost:${(server.address() as AddressInfo).port}/invocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: 'turn-2', companyId: 'company-1', userId: 'user-1', messageText: 'ยอดขายวันนี้' }),
      });
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json() as Record<string, unknown>)['usage'], [usage]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('reports complete artifact identity, measured stages, normalized refusal, and model-call count', async () => {
    const saved = {
      GIT_SHA: process.env['GIT_SHA'],
      AGENTCORE_ARTIFACT_SHA256: process.env['AGENTCORE_ARTIFACT_SHA256'],
      SERVICE_VERSION: process.env['SERVICE_VERSION'],
    };
    process.env['GIT_SHA'] = 'a'.repeat(40);
    process.env['AGENTCORE_ARTIFACT_SHA256'] = 'b'.repeat(64);
    process.env['SERVICE_VERSION'] = 'candidate-a';
    const server = makeHttpServer({
      run: async () => ({
        ...(await stubOrchestrator.run({})),
        plan: {
          status: 'UNROUTABLE' as const,
          language: 'th', intents: [],
          refusals: [{ request: 'จ่ายเงิน', reason: 'mutation_blocked' as const }],
          requiresHumanReview: false,
        },
      }),
    } as any);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    try {
      const res = await fetch(`http://localhost:${(server.address() as AddressInfo).port}/invocations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: 'turn-evidence', companyId: 'company-1', userId: 'user-1', messageText: 'จ่ายเงิน' }),
      });
      const body = await res.json() as Record<string, any>;
      assert.deepEqual(body['runtimeIdentity'], {
        sourceCommit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64),
        serviceVersion: 'candidate-a', contractVersion: 1,
      });
      assert.equal(body['refusalReason'], 'mutation_blocked');
      assert.equal(body['modelCallCount'], 0);
      for (const key of ['bodyReadMs', 'payloadValidationMs', 'orchestrationMs', 'runtimeTotalMs']) {
        assert.equal(typeof body['stageDurationsMs'][key], 'number');
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  it('POST /invocations accepts playground prompt shorthand', async () => {
    const res = await fetch(`${serverUrl}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'คุณเป็นใคร ทำอะไรได้บ้าง' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['replyText'], 'stub reply');
  });
});

/**
 * L-12: this entrypoint is a standalone node:http server, so the `json({ limit })` protections in
 * apps/ai-gateway/src/main.ts never applied to it. These cover the caps that replaced them.
 */
describe('AgentCore Runtime – L-12 invocation bounds', () => {
  const LIMIT_ENV = [
    'AGENTCORE_MAX_BODY_BYTES',
    'AGENTCORE_MAX_MESSAGE_CHARS',
    'AGENTCORE_MAX_ATTACHMENTS',
    'AGENTCORE_MAX_CONCURRENT_INVOCATIONS',
  ] as const;
  const saved: Record<string, string | undefined> = {};
  const restore = () => {
    for (const key of LIMIT_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };

  before(() => { for (const key of LIMIT_ENV) saved[key] = process.env[key]; });
  // Each case sets only the limit it exercises; the rest fall back to the shipped defaults.
  beforeEach(restore);
  after(restore);

  /** One server per test so the in-flight counter and env limits never bleed between cases. */
  async function withServer(
    orchestrator: { run: (req: unknown) => Promise<unknown> },
    run: (url: string) => Promise<void>,
  ): Promise<void> {
    const server = makeHttpServer(orchestrator as any);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const url = `http://localhost:${(server.address() as AddressInfo).port}`;
    try {
      await run(url);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }

  // Owner 2026-09-29 ("no more switches; always on"): the release copies this artifact's env forward and it
  // went stale on UAT, so the probe reports the always-on capability whatever the env says — never a 503.
  it('answers the S-4 capability probe as always on, whatever this runtime env says, without invoking the orchestrator', async () => {
    const prior = process.env['LINE_AI_DRAFT_EDIT_ENABLED'];
    let orchestratorCalls = 0;
    try {
      for (const stale of [undefined, 'true', 'false', 'not-a-boolean']) {
        if (stale === undefined) delete process.env['LINE_AI_DRAFT_EDIT_ENABLED'];
        else process.env['LINE_AI_DRAFT_EDIT_ENABLED'] = stale;
        await withServer({ run: async () => { orchestratorCalls += 1; throw new Error('model path must not run'); } }, async (url) => {
          const response = await fetch(`${url}/invocations`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineDraftEditCapabilityProbe: true }),
          });
          assert.equal(response.status, 200);
          assert.equal((await response.json() as any).lineDraftEditEnabled, true);
        });
      }
      assert.equal(orchestratorCalls, 0);
    } finally {
      if (prior === undefined) delete process.env['LINE_AI_DRAFT_EDIT_ENABLED'];
      else process.env['LINE_AI_DRAFT_EDIT_ENABLED'] = prior;
    }
  });

  it('rejects an oversize Content-Length without reading the body at all', async () => {
    const attached: string[] = [];
    const fakeReq = {
      headers: { 'content-length': '99999999' },
      on(event: string) { attached.push(event); return this; },
      pause() { /* unreachable */ },
    } as any;

    await assert.rejects(() => readBody(fakeReq, 1024), PayloadTooLargeError);
    assert.deepEqual(attached, [], 'no data listener attached → not one body byte was buffered');
  });

  it('answers 413 for a declared-oversize body', async () => {
    process.env['AGENTCORE_MAX_BODY_BYTES'] = '2048';
    await withServer(stubOrchestrator, async (url) => {
      const res = await fetch(`${url}/invocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: 't', companyId: 'c', userId: 'u', messageText: 'x'.repeat(4096) }),
      });
      assert.equal(res.status, 413);
      assert.equal((await res.json() as Record<string, unknown>)['error'], 'PAYLOAD_TOO_LARGE');
    });
  });

  it('stops reading and stops buffering the moment a chunked body crosses the cap', async () => {
    // A real stream rather than a hand-written stub: readBody must detach its own listener at the
    // cap, which is what lets the caller discard the rest of the upload while it answers 413.
    const stream = new PassThrough();
    Object.assign(stream, { headers: {} }); // chunked transfer: no Content-Length to pre-check
    const req = stream as unknown as IncomingMessage;

    const pending = readBody(req, 100);
    for (let i = 0; i < 5; i += 1) stream.write(Buffer.alloc(40, 'a'));

    await assert.rejects(() => pending, PayloadTooLargeError);
    assert.equal(stream.listenerCount('data'), 0, 'nothing is counted or buffered past the cap');
    assert.ok(stream.isPaused(), 'the reader must stop pulling bytes at the cap, not after the body ends');
  });

  it('answers 413 to a real chunked oversize upload and destroys the request itself', async () => {
    process.env['AGENTCORE_MAX_BODY_BYTES'] = '512';
    const server = makeHttpServer(stubOrchestrator as any);
    // The runtime's own handler runs first; this listener only wraps destroy so the assertions are
    // about what the runtime did. THIS TEST NEVER CALLS destroy() — that is the point of it.
    const destroyedAfterResponse: boolean[] = [];
    server.on('request', (req, res) => {
      const original = req.destroy.bind(req);
      (req as { destroy: IncomingMessage['destroy'] }).destroy = (error?: Error) => {
        destroyedAfterResponse.push(res.writableFinished);
        return original(error);
      };
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;

    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      let received = '';
      socket.on('connect', () => {
        // No Content-Length, so the pre-check cannot fire: the cap has to be crossed mid-stream.
        socket.write('POST /invocations HTTP/1.1\r\nHost: runtime\r\n'
          + 'Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n');
        for (let i = 0; i < 4; i += 1) socket.write(`100\r\n${'a'.repeat(256)}\r\n`); // 1024 B > 512 B cap
        socket.write('0\r\n\r\n');
      });
      // A regression must fail on the assertions below, not hang the run.
      const giveUp = setTimeout(() => { socket.destroy(); resolve(received); }, 2000);
      const done = () => { clearTimeout(giveUp); resolve(received); };
      socket.on('data', (data) => { received += data.toString('utf8'); });
      socket.on('close', done);
      socket.on('error', (err) => (received ? done() : reject(err)));
    });

    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));

    assert.match(response, /^HTTP\/1\.1 413 /, 'a real client reads the 413, not a connection reset');
    assert.match(response, /PAYLOAD_TOO_LARGE/);
    assert.match(response, /connection: close/i, 'the client is told the connection is closing');
    assert.ok(destroyedAfterResponse.length > 0, 'the runtime destroys the request');
    assert.ok(
      destroyedAfterResponse.every(Boolean),
      'and only once the 413 is on the wire — destroying first is what resets the client mid-response',
    );
  });

  it('accepts an at-limit body', async () => {
    const messageText = 'x'.repeat(64);
    const atLimitBody = JSON.stringify({ turnId: 't', companyId: 'c', userId: 'u', messageText });
    process.env['AGENTCORE_MAX_BODY_BYTES'] = String(Buffer.byteLength(atLimitBody));
    await withServer(stubOrchestrator, async (url) => {
      const res = await fetch(`${url}/invocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: atLimitBody,
      });
      assert.equal(res.status, 200, 'exactly at the cap must pass — the cap is inclusive');
    });
  });

  it('rejects oversize messageText and oversize prompt', () => {
    process.env['AGENTCORE_MAX_MESSAGE_CHARS'] = '10';
    assert.equal(
      validatePayload({ turnId: 't', companyId: 'c', userId: 'u', messageText: 'x'.repeat(11) }),
      null,
    );
    assert.equal(validatePayload({ prompt: 'x'.repeat(11) }), null, 'the playground shorthand is bounded too');
    assert.ok(validatePayload({ turnId: 't', companyId: 'c', userId: 'u', messageText: 'x'.repeat(10) }));
  });

  it('rejects an oversize attachments array', () => {
    process.env['AGENTCORE_MAX_ATTACHMENTS'] = '2';
    const base = { turnId: 't', companyId: 'c', userId: 'u', messageText: 'hello' };
    assert.equal(validatePayload({ ...base, attachments: [1, 2, 3] }), null);
    assert.equal(validatePayload({ prompt: 'hello', attachments: [1, 2, 3] }), null);
    assert.deepEqual(validatePayload({ ...base, attachments: [1, 2] })?.attachments, [1, 2]);
    assert.deepEqual(validatePayload({ ...base, attachments: 'not-an-array' })?.attachments, [], 'unchanged tolerance');
  });

  it('answers 429 beyond the concurrent-invocation cap', async () => {
    process.env['AGENTCORE_MAX_CONCURRENT_INVOCATIONS'] = '1';
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const slowOrchestrator = {
      run: async () => {
        await blocked;
        return (stubOrchestrator as any).run();
      },
    };

    await withServer(slowOrchestrator, async (url) => {
      const post = () => fetch(`${url}/invocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: 't', companyId: 'c', userId: 'u', messageText: 'hello' }),
      });
      const first = post();
      // Let the first request occupy the single slot before the second arrives.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = await post();
      assert.equal(second.status, 429);
      assert.equal((await second.json() as Record<string, unknown>)['error'], 'TOO_MANY_CONCURRENT_INVOCATIONS');

      release();
      assert.equal((await first).status, 200, 'the in-flight request still completes');

      // The slot is released, so a later request is served again.
      assert.equal((await post()).status, 200);
    });
  });
});
