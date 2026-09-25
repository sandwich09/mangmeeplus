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
import { LINE_AI_CONTEXT_MAX_TURNS, extractValueCandidates } from '@watchdog-bms/contracts';
import { validatePayload, payloadToTurnRequest, makeHttpServer, loadInternalSecret, loadJwtSecret, readBody, PayloadTooLargeError } from './runtime';
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
    durationMs: 1,
  }),
};

// ── Server lifecycle ───────────────────────────────────────────────────────────

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

// ── validatePayload tests ──────────────────────────────────────────────────────

describe('AgentCore Runtime – payload validation', () => {
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

  // validateProductionConfig requires WATCHDOG_JWT_SECRET_ARN of anything carrying
  // JWT_CLOCK_TOLERANCE_SECONDS, which the shared schema always does. The deploy script never set
  // it, so every invocation died in config validation with a 500 and no log group to say why.
  it('resolves the JWT signing key from its own ARN pointer', async () => {
    const env: NodeJS.ProcessEnv = {
      WATCHDOG_JWT_SECRET_SOURCE_ARN: 'arn:aws:secretsmanager:ap-southeast-1:123:secret:watchdog-bms/production/watchdog-jwt-secret-y',
      AWS_REGION: 'ap-southeast-1',
    };
    let requested = '';
    await loadJwtSecret(env, async (secretId, region) => {
      requested = `${region}:${secretId}`;
      return 'jwt-signing-key';
    });
    assert.match(requested, /watchdog-jwt-secret-y$/);
    // The config layer reads material out of the *_ARN name, so that is where it has to land.
    assert.equal(env['WATCHDOG_JWT_SECRET_ARN'], 'jwt-signing-key');
  });

  it('leaves an already-injected JWT key alone so ECS valueFrom still wins', async () => {
    const env: NodeJS.ProcessEnv = { WATCHDOG_JWT_SECRET_ARN: 'injected-by-ecs' };
    await loadJwtSecret(env, async () => 'should-not-be-read');
    assert.equal(env['WATCHDOG_JWT_SECRET_ARN'], 'injected-by-ecs');
  });

  it('fails closed when the JWT secret reference is absent or empty', async () => {
    await assert.rejects(loadJwtSecret({}), /WATCHDOG_JWT_SECRET_SOURCE_ARN is required/);
    await assert.rejects(
      loadJwtSecret({ WATCHDOG_JWT_SECRET_SOURCE_ARN: 'secret-arn' }, async () => ''),
      /WATCHDOG_JWT_SECRET_ARN is empty/,
    );
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
	});

// ── HTTP behavior tests ────────────────────────────────────────────────────────

describe('AgentCore Runtime – HTTP endpoints', () => {
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
