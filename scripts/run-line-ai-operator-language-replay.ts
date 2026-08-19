#!/usr/bin/env tsx
/**
 * Full local orchestration replay. Routing is deterministic fixture input; access normalization,
 * tool dispatch, late feature-off handling, composition, links, and presentation use real code.
 */
import {
  LINE_TOOL_REGISTRY,
  toolFeatureKeys,
  type AgentIntentPlan,
  type LineAiTurnRequest,
  type ToolMeta,
  type ToolResult,
} from '../packages/contracts/src/index';
import { OrchestratorAgent } from '../apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent';
import type { ErpToolContext } from '../apps/ai-gateway/src/modules/line-ai/infrastructure/erp-tool.client';
import {
  LINE_AI_ALL_OPERATOR_CASES,
  LINE_AI_OPERATOR_AVAILABILITY_CORPUS,
  LINE_AI_OPERATOR_LANGUAGE_CORPUS,
  type OperatorAvailabilityCase,
} from './line-ai-operator-language.corpus';

const ROUTES: Record<string, { intent: string; subject: string; agent: string }> = {
  'expense.list_recent': { intent: 'read_summary', subject: 'expense', agent: 'accounting' },
  'expense.get_daily_closing': { intent: 'read_summary', subject: 'expense', agent: 'accounting' },
  'expense.get_detail': { intent: 'read_detail', subject: 'expense', agent: 'accounting' },
  'sales.get_sales_summary': { intent: 'report_request', subject: 'sale', agent: 'sales' },
  'inventory.search_products': { intent: 'read_detail', subject: 'product', agent: 'inventory' },
  'inventory.list_low_stock': { intent: 'read_summary', subject: 'inventory', agent: 'inventory' },
  'crm.get_customer_summary': { intent: 'read_summary', subject: 'customer', agent: 'crm' },
  'crm.get_booking_summary': { intent: 'read_summary', subject: 'booking', agent: 'crm' },
  'crm.get_inbox_summary': { intent: 'read_summary', subject: 'conversation', agent: 'crm' },
  'ledger.get_financial_summary': { intent: 'read_summary', subject: 'ledger', agent: 'cfo' },
  'accounting.get_document_detail': { intent: 'read_detail', subject: 'accounting_document', agent: 'accounting' },
  'accounting.get_receivable_summary': { intent: 'read_summary', subject: 'accounting_document', agent: 'accounting' },
  'procurement.get_summary': { intent: 'read_summary', subject: 'procurement', agent: 'accounting' },
  'procurement.get_ap_outstanding': { intent: 'read_summary', subject: 'supplier', agent: 'accounting' },
  'tax.get_upcoming_tax_obligations': { intent: 'read_summary', subject: 'tax', agent: 'tax' },
  'notifications.list_open_alerts': { intent: 'read_summary', subject: 'report', agent: 'notifications' },
  'dashboard.get_business_health_summary': { intent: 'read_summary', subject: 'company', agent: 'general' },
  'reports.get_monthly_report_summary': { intent: 'report_request', subject: 'report', agent: 'general' },
  'workflow.list_assigned_tasks': { intent: 'read_summary', subject: 'workflow', agent: 'general' },
  'company.list_branches': { intent: 'read_summary', subject: 'branch', agent: 'general' },
  'company.get_employee_summary': { intent: 'read_summary', subject: 'employee', agent: 'general' },
  'reimbursement.get_summary': { intent: 'read_summary', subject: 'reimbursement', agent: 'accounting' },
  'reimbursement.list_pending_approvals': { intent: 'read_summary', subject: 'reimbursement', agent: 'accounting' },
};

const EMPTY_BUCKET = { total: 0, shown: 0, remaining: 0, items: [] };
const DATA: Record<string, unknown> = {
  'expense.list_recent': { summary: { totalAmount: 11875, pendingAmount: 200, confirmedAmount: 11675, paidAmount: 10000, unpaidAmount: 1875 }, items: [] },
  'expense.get_daily_closing': {
    date: '2026-08-19', scope: { kind: 'all_branches' }, occurredToday: { totals: [], paid: [], outstanding: [], items: EMPTY_BUCKET },
    submittedToday: { count: 0 }, dueEndOfDay: { totals: [], items: EMPTY_BUCKET }, overdue: { totals: [], items: EMPTY_BUCKET },
    unscheduledOutstanding: { totals: [], items: EMPTY_BUCKET }, pendingReview: { count: 0 }, evidenceBlockers: { count: 0 }, duplicateRisks: { count: 0 },
  },
  'sales.get_sales_summary': { totalSales: 25000, transactionCount: 12, period: '2026-08' },
  'inventory.search_products': { total: 1, items: [{ id: 'fixture-product', name: 'สินค้า Fixture', sku: 'P100' }] },
  'inventory.list_low_stock': { count: 5, items: [] },
  'crm.get_customer_summary': { total: 42, active: 40, archived: 2 },
  'ledger.get_financial_summary': { netProfit: '120000', totalAssets: '2500000' },
  'accounting.get_receivable_summary': { openCount: 4, outstandingTotal: '23000', currencies: ['THB'] },
  'procurement.get_ap_outstanding': { openCount: 3, outstandingTotal: '18000', suppliers: [] },
  'tax.get_upcoming_tax_obligations': { count: 2, dueSoonCount: 1, items: [] },
  'notifications.list_open_alerts': { count: 2, items: [] },
  'company.list_branches': { total: 2, branches: [{ name: 'สำนักงานใหญ่' }, { name: 'สาขา 2' }] },
  'reimbursement.list_pending_approvals': { count: 2, items: [] },
};

function routeIntent(tool: string, index: number, override?: OperatorAvailabilityCase['route']): AgentIntentPlan['intents'][number] {
  const route = override ?? ROUTES[tool];
  if (!route) throw new Error(`LOCAL_REPLAY_ROUTE_NOT_FOUND:${tool}`);
  return { ...route, priority: index + 1, requiredTools: [tool], missingContext: [] } as AgentIntentPlan['intents'][number];
}

function planFor(messageText: string): AgentIntentPlan {
  const availability = LINE_AI_OPERATOR_AVAILABILITY_CORPUS.find((candidate) => candidate.message === messageText);
  if (availability?.accessMode === 'unsupported_module') {
    return { status: 'UNROUTABLE', language: 'th', intents: [], refusals: [{ request: messageText, reason: 'unsupported_module' }], requiresHumanReview: false };
  }
  if (availability?.accessMode === 'tool_unavailable') {
    return { status: 'UNROUTABLE', language: 'th', intents: [], refusals: [{ request: messageText, reason: 'tool_unavailable' }], requiresHumanReview: false };
  }
  if (availability) {
    const tools = availability.routeTools ?? (availability.routeTool ? [availability.routeTool] : []);
    return {
      status: 'ROUTABLE', language: 'th',
      intents: tools.map((tool, index) => routeIntent(tool, index, tools.length === 1 ? availability.route : undefined)),
      refusals: [], requiresHumanReview: false,
    };
  }
  const testCase = LINE_AI_OPERATOR_LANGUAGE_CORPUS.find((candidate) => candidate.message === messageText);
  if (!testCase) throw new Error('LOCAL_REPLAY_CASE_NOT_FOUND');
  return {
    status: 'ROUTABLE', language: 'th',
    intents: testCase.expectedTools.map((tool, index) => routeIntent(tool, index)),
    refusals: [], requiresHumanReview: false,
  };
}

function payloadFromOpenAiBody(body: any): Record<string, any> {
  const text = String(body.input?.[0]?.content?.[0]?.text ?? '{}');
  try { return JSON.parse(text.slice(text.lastIndexOf('\n') + 1)); } catch { return {}; }
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
  const payload = payloadFromOpenAiBody(JSON.parse(String(init?.body ?? '{}')));
  if (Array.isArray(payload.availableTools)) {
    const name = payload.availableTools[0]?.name;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(name ? { callTool: name } : { done: true }) }) } as Response;
  }
  if (typeof payload.reply === 'string') return { ok: true, json: async () => ({ output_text: payload.reply }) } as Response;
  if (payload.systemData) return { ok: true, json: async () => ({ output_text: '' }) } as Response;
  return { ok: true, json: async () => ({ output_text: JSON.stringify(planFor(String(payload.messageText ?? ''))) }) } as Response;
}) as typeof fetch;

const invoked: string[] = [];
let activeAvailability: OperatorAvailabilityCase | undefined;
const erpTools = {
  async invoke(tool: ToolMeta, _ctx: ErpToolContext): Promise<ToolResult> {
    invoked.push(tool.name);
    if (activeAvailability?.accessMode === 'runtime_feature_disabled') {
      return { toolName: tool.name, status: 'unsupported_module', errorCode: 'FEATURE_NOT_ENABLED', sourceRefs: [], asOf: '2026-08-19T09:00:00.000Z' };
    }
    if (activeAvailability?.accessMode === 'source_unavailable') {
      return { toolName: tool.name, status: 'unavailable', errorCode: 'SOURCE_UNAVAILABLE', sourceRefs: [], asOf: '2026-08-19T09:00:00.000Z' };
    }
    const empty = activeAvailability?.accessMode === 'no_data';
    return {
      toolName: tool.name,
      status: 'ok',
      data: empty ? { count: 0, total: 0, items: [] } : (DATA[tool.name] ?? { count: 1, total: 1, items: [{ id: 'fixture' }], status: 'OPEN' }),
      sourceRefs: [{
        label: tool.name, module: tool.sourceModule, entityType: 'local_fixture', permissionChecked: true,
        ...(tool.name.startsWith('expense.') ? { webPath: '/companies/local-company/expenses' } : {}),
      }],
      asOf: '2026-08-19T09:00:00.000Z',
    } as ToolResult;
  },
} as any;

const config = {
  aiMaxToolCalls: 8, modelProvider: 'openai', openAiApiKey: 'local-fixture', openAiModel: 'local-fixture',
  aiToolTimeoutMs: 1000, lineAiTooluseLoopEnabled: false, lineAiCoverageCriticEnabled: false,
} as any;
const ALL_PERMISSIONS = [...new Set(LINE_TOOL_REGISTRY.flatMap((tool) => [...tool.requiredPermissions, ...(tool.anyOfPermissions ?? [])]))];

function request(messageText: string, index: number, testCase?: OperatorAvailabilityCase): LineAiTurnRequest {
  let permissions = [...ALL_PERMISSIONS];
  let entitledFeatureKeys: string[] | null | undefined;
  let entitlementDeniedPermissions: Record<string, string> | undefined;
  const tools = (testCase?.routeTools ?? (testCase?.routeTool ? [testCase.routeTool] : []))
    .map((name) => LINE_TOOL_REGISTRY.find((tool) => tool.name === name))
    .filter((tool): tool is ToolMeta => !!tool);
  if (testCase?.accessMode === 'partial') {
    entitledFeatureKeys = ['product_catalog'];
  } else if (testCase?.accessMode === 'feature_disabled') {
    entitledFeatureKeys = [];
    if (Number(testCase.id.slice(-2)) % 2 === 0) {
      const denied = [...new Set(tools.flatMap((tool) => [...tool.requiredPermissions, ...(tool.anyOfPermissions ?? [])]))];
      permissions = permissions.filter((permission) => !denied.includes(permission));
      entitlementDeniedPermissions = Object.fromEntries(denied.map((permission) => [permission, 'feature_disabled']));
    }
  } else if (testCase?.accessMode === 'forbidden') {
    const denied = [...new Set(tools.flatMap((tool) => [...tool.requiredPermissions, ...(tool.anyOfPermissions ?? [])]))];
    permissions = permissions.filter((permission) => !denied.includes(permission));
    entitledFeatureKeys = [...new Set(tools.flatMap((tool) => toolFeatureKeys(tool)))];
  } else if (testCase && !['tool_unavailable', 'unsupported_module'].includes(testCase.accessMode)) {
    entitledFeatureKeys = [...new Set(tools.flatMap((tool) => toolFeatureKeys(tool)))];
  }
  return {
    requestId: `operator-replay-${index + 1}`, webhookEventId: `operator-replay-${index + 1}`,
    messageText, messagePreviewHash: `operator-replay-${index + 1}`, attachments: [],
    userContext: {
      lineUserId: 'local-line-user', internalUserId: 'local-user', companyId: 'local-company', membershipId: 'local-membership',
      roles: ['owner'], locale: 'th-TH', permissions,
      ...(entitledFeatureKeys !== undefined ? { entitledFeatureKeys } : {}),
      ...(entitlementDeniedPermissions ? { entitlementDeniedPermissions } : {}),
    },
  };
}

type Failure = { id: string; expectedTools: string[]; invokedTools: string[]; reason: string };
const same = (left: readonly string[], right: readonly string[]) => JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());

void (async () => {
  const startedAt = Date.now();
  const failures: Failure[] = [];
  for (const [index, testCase] of LINE_AI_ALL_OPERATOR_CASES.entries()) {
    invoked.length = 0;
    activeAvailability = testCase.category === 'availability' ? testCase : undefined;
    const result = await new OrchestratorAgent(erpTools, config).run(request(testCase.message, index, activeAvailability));
    const actual = [...new Set(invoked)];
    const expected = activeAvailability?.expectedInvokedTools ?? testCase.expectedTools;
    const reasons: string[] = [];
    if (!same(actual, expected)) reasons.push('tool_mismatch');
    const forbidden = actual.filter((tool) => testCase.forbiddenTools.includes(tool));
    if (forbidden.length) reasons.push(`forbidden=${forbidden.join(',')}`);
    if (!result.replyText.trim()) reasons.push('empty_reply');
    if (activeAvailability) {
      if (result.plan.status !== activeAvailability.expectedPlanStatus) reasons.push(`status=${result.plan.status}`);
      for (const copy of activeAvailability.requiredReplyIncludes) if (!result.replyText.includes(copy)) reasons.push(`missing_copy=${copy}`);
      for (const copy of activeAvailability.forbiddenReplyIncludes) if (result.replyText.includes(copy)) reasons.push(`forbidden_copy=${copy}`);
      const blocked = ['feature_disabled', 'runtime_feature_disabled', 'forbidden', 'source_unavailable', 'tool_unavailable', 'unsupported_module'].includes(activeAvailability.accessMode);
      if (blocked && (result.sourceRefs.length || result.webLinks.length || result.presentation)) reasons.push('blocked_response_leak');
    }
    if (reasons.length) failures.push({ id: testCase.id, expectedTools: [...expected].sort(), invokedTools: actual.sort(), reason: reasons.join(';') });
  }
  const outcomeCounts = Object.fromEntries([...new Set(LINE_AI_OPERATOR_AVAILABILITY_CORPUS.map(({ accessMode }) => accessMode))]
    .map((mode) => [mode, LINE_AI_OPERATOR_AVAILABILITY_CORPUS.filter(({ accessMode }) => accessMode === mode).length]));
  console.log(JSON.stringify({
    event: 'line_ai_operator_language_local_replay_complete', routing: 'fixture', orchestration: 'real_local_code',
    total: LINE_AI_ALL_OPERATOR_CASES.length, languageCases: LINE_AI_OPERATOR_LANGUAGE_CORPUS.length,
    availabilityCases: LINE_AI_OPERATOR_AVAILABILITY_CORPUS.length, noisyAvailabilityCases: LINE_AI_OPERATOR_AVAILABILITY_CORPUS.filter(({ noisy }) => noisy).length,
    outcomeCounts, passed: LINE_AI_ALL_OPERATOR_CASES.length - failures.length, failed: failures.length,
    forbiddenToolInvocations: failures.filter(({ reason }) => reason.includes('forbidden=')).length,
    durationMs: Date.now() - startedAt, failures,
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
})().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : 'UNKNOWN';
  console.error(JSON.stringify({ event: 'line_ai_operator_language_local_replay_failed', errorCode: detail.split(':')[0], detail }));
  process.exitCode = 1;
}).finally(() => { globalThis.fetch = originalFetch; });
