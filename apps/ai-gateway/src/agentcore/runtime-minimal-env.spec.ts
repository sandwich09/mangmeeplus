/**
 * UAT 2026-09-29: the Kamal release builds the AgentCore runtime env as `{...currentEnv, ...identity}`, so the
 * artifact kept whatever LINE AI switches it was first created with — a four-family prepared list and no
 * tool-loop/orchestration/critic keys — and six prepared-read families answered "ยังดึงข้อมูลไม่ได้".
 * Owner 2026-09-29: "no more switches; always on". These tests boot the runtime exactly as AgentCore does
 * (`createRuntimeOrchestrator` from process.env) with a MINIMAL env — identity, service and provider keys,
 * not one LINE AI capability switch — and with that stale env, and require the full path either way.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2, LINE_TOOL_REGISTRY, createLineAiInputEvidence, extractValueCandidatesV2,
  type AiBudgetGrantV2,
} from '@watchdog-bms/contracts';
import { createRuntimeOrchestrator, makeHttpServer } from './runtime';
import { APPROVED_PREPARED_FAMILY_KEYS } from '../modules/line-ai/agents/prepared-simple-read-formatter';

const API = 'https://api.test/v1';
const MODEL = 'gpt-4.1-mini';
const TOOL_RESULTS = JSON.parse(readFileSync(join(__dirname, 'runtime-minimal-env.fixtures.json'), 'utf8')) as Record<string, any>;

/** What the release sets on the runtime (identity) plus the service/provider keys every process needs. */
const MINIMAL_ENV: Record<string, string> = {
  APP_ENV: 'local', SERVICE_NAME: 'agentcore-runtime', GIT_SHA: 'a'.repeat(40), SERVICE_VERSION: 'a'.repeat(40),
  AGENTCORE_ARTIFACT_SHA256: 'b'.repeat(64), DEPLOY_ENVIRONMENT: 'uat', ERP_CORE_INTERNAL_URL: API,
  AI_GATEWAY_INTERNAL_SECRET: 'synthetic-internal-secret', MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'synthetic-key',
  OPENAI_MODEL: MODEL, OPENAI_PROCESSING_REGION: 'global', APPROVED_AI_PROVIDERS: 'openai', APPROVED_AI_MODEL_IDS: MODEL,
  APPROVED_AI_REGIONS: 'global',
};
/** The env the release had copied forward onto UAT's AgentCore, with every other switch turned off too. */
const STALE_ENV: Record<string, string> = {
  ...MINIMAL_ENV,
  LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES: 'sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric',
  LINE_AI_TOOLUSE_LOOP_ENABLED: 'false', LINE_AI_COVERAGE_CRITIC_ENABLED: 'false', LINE_AI_PREPARED_SIMPLE_READ_ENABLED: 'false',
  LINE_AI_DRAFT_EDIT_ENABLED: 'false', LINE_AI_AGENT_ORCHESTRATION_ENABLED: 'false', LINE_AI_APPROVED_KNOWLEDGE_ENABLED: 'false',
  LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED: 'false',
};
const ENVS = { minimal: MINIMAL_ENV, stale: STALE_ENV };

const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;
function useEnv(env: Record<string, string>): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, { PATH: savedEnv['PATH'] ?? '' }, env);
}

function bangkokToday(): string { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }

type Seen = { tools: string[]; nativeRequests: number; criticRequests: number; modelRequests: number };
/** The API (budget + permission-checked tools) and the OpenAI Responses wire, both at fetch. */
function installFetch(seen: Seen): void {
  let nativeTurn = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
    if (url === `${API}/internal/ai/budget-step`) {
      const invocation = body['invocation'];
      return Response.json({ ok: true, envelope: { ...invocation, version: 2, reservationId: `reservation-${invocation.ordinal}`,
        invocationKey: `company-1#${invocation.grant.attemptKey}#provider-v2#${invocation.ordinal}`, tariffVersion: 'tariff-test' } });
    }
    if (url === `${API}/internal/ai/budget-settle`) return Response.json({ result: 'settled' });
    if (url === `${API}/internal/ai/tools/invoke`) {
      const toolName = String(body['toolName']);
      seen.tools.push(toolName);
      const result = structuredClone(TOOL_RESULTS[toolName] ?? { toolName, status: 'ok', data: { count: 2 },
        sourceRefs: [{ label: toolName, module: 'inventory', entityType: 'summary', permissionChecked: true }], asOf: new Date().toISOString() });
      // The recorded seed's own month becomes this run's current month, so the test never ages out.
      const today = bangkokToday(), from = String(body['input']?.fromDate ?? `${today.slice(0, 8)}01`), to = String(body['input']?.toDate ?? today);
      for (const holder of [result.data, result.data?.queryApplied]) if (holder?.period) {
        Object.assign(holder.period, 'fromDate' in holder.period ? { fromDate: from, toDate: to } : { startDate: from, endDate: to });
      }
      return Response.json(result);
    }
    if (url === 'https://api.openai.com/v1/responses') {
      seen.modelRequests += 1;
      if (Array.isArray(body['tools']) && body['tools'].length > 0) {
        seen.nativeRequests += 1;
        const output = nativeTurn++ === 0
          ? [{ type: 'function_call', call_id: 'c0', name: 'inventory__list_low_stock', arguments: '{}' }]
          : [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }];
        return Response.json({ status: 'completed', output });
      }
      const firstUserText = String(body['input']?.[0]?.content?.[0]?.text ?? '{}');
      let payload: Record<string, any> = {};
      try { payload = JSON.parse(firstUserText.slice(firstUserText.lastIndexOf('\n') + 1)); } catch { payload = {}; }
      if (Array.isArray(payload['toolsCalled'])) {
        seen.criticRequests += 1;
        return Response.json({ status: 'completed', output_text: JSON.stringify([{ request: 'สินค้าใกล้หมด', verdict: 'covered' }]) });
      }
      if (payload['systemData'] || typeof payload['reply'] === 'string') {
        return Response.json({ status: 'completed', output_text: typeof payload['reply'] === 'string' ? payload['reply'] : 'สินค้าใกล้หมด 2 รายการค่ะ' });
      }
      return Response.json({ status: 'completed', output_text: JSON.stringify({ status: 'ROUTABLE', language: 'th', refusals: [], requiresHumanReview: false,
        intents: [{ intent: 'read_detail', subject: 'inventory', agent: 'inventory', priority: 1, requiredTools: ['inventory.list_low_stock'], missingContext: [] }] }) });
    }
    return Response.json({ error: `unexpected ${url}` }, { status: 404 });
  }) as typeof fetch;
}

async function invokeRuntime(payload: Record<string, unknown>): Promise<Record<string, any>> {
  const orchestrator = await createRuntimeOrchestrator();
  const server = makeHttpServer(orchestrator);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  try {
    const response = await originalFetch(`http://localhost:${(server.address() as AddressInfo).port}/invocations`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(response.status, 200);
    return await response.json() as Record<string, any>;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** A v2 prepared simple read exactly as the API forwards it for a `simple` lane (2 slots, intake spent). */
async function preparedTurn(tool: string, answerShape: 'single_metric' | 'list', messageText: string): Promise<Record<string, unknown>> {
  const meta = LINE_TOOL_REGISTRY.find((candidate) => candidate.name === tool)!;
  const turnKey = `min-env-${tool.replace(/\W/gu, '-')}-${answerShape}`;
  const built = (await createLineAiInputEvidence({ turnKey, parts: [{ partId: 'part-0', eventIdHash: 'e'.repeat(64),
    acceptedAtMs: Date.now(), rawText: messageText }] }))!;
  const evidence = built.inputEvidence, part = evidence.parts[0]!;
  const now = Date.now();
  const grant: AiBudgetGrantV2 = { version: 2, turnKey, authorityKind: 'webhook_event', authorityId: `event-${turnKey}`,
    channelOwnerDigest: 'b'.repeat(64), attemptKey: `attempt-${turnKey}`, monthKey: bangkokToday().slice(0, 7), payerCompanyId: 'company-1',
    model: { provider: 'openai', modelId: MODEL, region: 'global' }, allowedProfileIds: ['line-control/2', 'line-answer/2'],
    profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, maxTurnSlots: 2, maxRepairs: 1, admittedAtMs: now - 1_000,
    workDeadlineAtMs: now + 60_000, finalDeadlineAtMs: now + 90_000, nonce: `nonce-${turnKey}`, issuerVersion: 'api-test-v2',
    nextOrdinal: 1, signature: 'c'.repeat(64) };
  const intent = meta.category === 'read_detail' ? 'read_detail' : meta.category === 'report' ? 'report_request' : 'read_summary';
  return {
    turnId: `turn-${turnKey}`, companyId: 'company-1', userId: 'user-1', membershipId: 'membership-1', chatKeyHash: 'e2e79765d7b4de10',
    messageText, locale: 'th-TH', roles: ['OWNER'],
    permissions: ['ai.tool.invoke', 'line.ai.query', ...meta.requiredPermissions, ...(meta.anyOfPermissions ?? [])],
    actorDelegations: { [tool]: ['delegation-1'] }, inputEvidence: evidence, contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
    budgetGrantV2: grant, valueCandidates: await extractValueCandidatesV2(evidence, bangkokToday()), intakeIntent: 'BUSINESS_READ_QUESTION',
    semanticSubrequests: [{ index: 0, kind: 'read', goal: messageText, requiredEvidence: [], requestedFilters: {}, dependsOn: [],
      evidenceRefs: [{ partId: part.partId, startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 }] }],
    preparedPlan: { version: 1, complexity: 'simple', confidence: 0.9, responseMode: 'simple_grounded', answerShape,
      intentPlan: { status: 'ROUTABLE', language: 'th', requiresHumanReview: false, refusals: [],
        intents: [{ intent, subject: meta.businessSubjects[0], agent: meta.supportedAgents[0], priority: 1, requiredTools: [tool], missingContext: [] }] },
      proposedCalls: [{ toolName: tool, input: {} }] },
  };
}

describe('AgentCore runtime from a minimal or stale env (UAT 2026-09-29)', () => {
  beforeEach(() => { globalThis.fetch = originalFetch; });
  afterEach(() => { useEnv(savedEnv as Record<string, string>); globalThis.fetch = originalFetch; });

  it('serves exactly the ten approved prepared families, from code, never from an env list', () => {
    assert.deepEqual([...APPROVED_PREPARED_FAMILY_KEYS].sort(), [
      'accounting.get_summary::list', 'expense.get_breakdown::list', 'expense.get_daily_closing::single_metric',
      'expense.get_detail::single_metric', 'expense.list_recent::list', 'expense.list_recent::single_metric',
      'reimbursement.get_detail::single_metric', 'reimbursement.get_summary::single_metric',
      'reimbursement.list_pending_approvals::list', 'sales.get_sales_summary::single_metric',
    ]);
  });

  const FAMILIES: Array<[string, 'single_metric' | 'list', string]> = [
    ['expense.list_recent', 'single_metric', 'ค่าใช้จ่ายรวมเท่าไหร่'],
    ['expense.list_recent', 'list', 'ขอดูรายการค่าใช้จ่ายล่าสุด'],
    ['expense.get_breakdown', 'list', 'สรุปค่าใช้จ่ายแยกตามหมวด'],
    ['reimbursement.list_pending_approvals', 'list', 'รายการค้างอนุมัติมีอะไรบ้าง'],
    ['reimbursement.get_summary', 'single_metric', 'ใบเบิกของฉันถึงไหนแล้ว'],
  ];
  for (const [name, env] of Object.entries(ENVS)) {
    for (const [tool, answerShape, messageText] of FAMILIES) {
      it(`${name} env: answers ${tool}::${answerShape} on the prepared lane with no model call`, async () => {
        useEnv(env);
        const seen: Seen = { tools: [], nativeRequests: 0, criticRequests: 0, modelRequests: 0 };
        installFetch(seen);
        const result = await invokeRuntime(await preparedTurn(tool, answerShape, messageText));
        assert.deepEqual(seen.tools, [tool]);
        assert.equal(seen.modelRequests, 0);
        assert.deepEqual(result['semanticCoverage']?.map((item: any) => item.status), ['handled']);
        assert.equal(result['presentation']?.kind, 'answer_cards');
        assert.doesNotMatch(String(result['replyText']), /ยังดึงข้อมูลส่วนนี้ไม่ได้/);
      });
    }

    it(`${name} env: a classic turn runs the native tool-use loop and its coverage critic`, async () => {
      useEnv(env);
      const seen: Seen = { tools: [], nativeRequests: 0, criticRequests: 0, modelRequests: 0 };
      installFetch(seen);
      await invokeRuntime({ turnId: `classic-${name}`, companyId: 'company-1', userId: 'user-1', membershipId: 'membership-1',
        messageText: 'ของอะไรใกล้หมดบ้าง', locale: 'th-TH', roles: ['OWNER'],
        permissions: ['inventory.product.read', 'inventory.report.read', 'inventory.movement.read'],
        actorDelegations: { 'inventory.list_low_stock': ['delegation-1'] } });
      assert.ok(seen.nativeRequests > 0, 'the native tool wire was used');
      assert.deepEqual(seen.tools, ['inventory.list_low_stock']);
      assert.ok(seen.criticRequests > 0, 'the coverage critic judged the turn');
    });
  }
});
