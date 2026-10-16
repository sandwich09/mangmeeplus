#!/usr/bin/env tsx
/**
 * Orchestrator smoke – proves the model-driven LINE AI orchestration (intent router + tool
 * loop + grounded language layer) works against a REAL provider. Standalone (no NestJS, no DB):
 * the ERP tool client is stubbed with canned read-only data, so ONLY the model calls are real.
 * Never run in CI.
 *
 * Usage:
 *   MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
 *     BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
 *     tsx orchestrator-smoke.ts "ช่วยสรุปสินค้าใกล้หมดให้หน่อย"
 */
import { OrchestratorAgent } from './orchestrator.agent';
import type { LineAiTurnRequest, ToolResult, ToolMeta } from '@watchdog-bms/contracts';
import type { ErpToolContext } from '../infrastructure/erp-tool.client';

const messageText = process.argv[2] ?? 'ช่วยสรุปสินค้าใกล้หมดให้หน่อย';

// createProvider + OrchestratorAgent read only these config getters.
const config = {
  appEnv: process.env['APP_ENV'],
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
  modelProvider: process.env['MODEL_PROVIDER'] ?? 'bedrock',
  bedrockRegion: process.env['BEDROCK_REGION'],
  bedrockModelId: process.env['BEDROCK_MODEL_ID'],
  openAiApiKey: process.env['OPENAI_API_KEY'],
  openAiModel: process.env['OPENAI_MODEL'] ?? 'gpt-4.1-mini',
  aiToolTimeoutMs: Number(process.env['AI_TOOL_TIMEOUT_MS'] ?? '25000'),
  aiMaxToolCalls: Number(process.env['AI_MAX_TOOL_CALLS'] ?? '8'),
} as unknown as ConstructorParameters<typeof OrchestratorAgent>[1];

// Canned read-only tool data so no API/DB is needed; the model still decides which tool runs.
const stubData: Record<string, unknown> = {
  'inventory.list_low_stock': { count: 5 },
  'inventory.get_stock_balance': [{}, {}, {}],
  'inventory.summarize_stock_movements': { inQty: 120, outQty: 80 },
  'ledger.get_financial_summary': { periodKey: '2026-06', netProfit: '120000', totalAssets: '2500000', trialBalanceDifference: '0' },
  'dashboard.get_business_health_summary': { widgets: [{}, {}, {}] },
  'company.get_current_context': { name: 'บริษัท ทดสอบ จำกัด' },
  'expense.list_recent': { summary: { totalAmount: 11875, pendingAmount: 0, draftAmount: 0, confirmedAmount: 11875, paidAmount: 11875, unpaidAmount: 0 }, items: [] },
  'crm.get_customer_summary': { total: 42, active: 40, archived: 2, newCustomers: 3, newCustomersSince: '2026-07-01', totalIncludesArchived: true, totalExcludesMerged: true },
  'crm.search_customers': { query: null, total: 2, page: 1, pageSize: 10, items: [{ id: 'customer-1', displayName: 'บริษัท ลูกค้า เอ จำกัด', status: 'ACTIVE' }] },
};

const erpTools = {
  async invoke(tool: ToolMeta, _ctx: ErpToolContext): Promise<ToolResult> {
    return {
      toolName: tool.name,
      status: 'ok',
      data: stubData[tool.name] ?? { count: 0 },
      sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true, webPath: `/x/${tool.name}` }],
      asOf: new Date().toISOString(),
    } as ToolResult;
  },
} as unknown as ConstructorParameters<typeof OrchestratorAgent>[0];

const req: LineAiTurnRequest = {
  requestId: 'smoke', webhookEventId: 'smoke', messageText, messagePreviewHash: 'smoke', attachments: [],
  userContext: {
    lineUserId: 'smoke', internalUserId: 'smoke', companyId: 'smoke', membershipId: 'smoke',
    permissions: ['inventory.product.read', 'inventory.report.read', 'inventory.movement.read', 'ledger.report.read', 'expense.read', 'dashboard.read', 'crm.customer.read'],
    roles: ['owner'], locale: 'th-TH',
  },
} as LineAiTurnRequest;

void (async () => {
  const result = await new OrchestratorAgent(erpTools, config).run(req);
  const toolsInvoked = result.outputs.flatMap((o) => o.toolCalls.map((t) => t.name));
  console.log(JSON.stringify({
    message: messageText,
    planStatus: result.plan.status,
    intents: result.plan.intents.map((i) => ({ intent: i.intent, subject: i.subject, agent: i.agent, requiredTools: i.requiredTools })),
    toolsInvoked,
    replyText: result.replyText,
    durationMs: result.durationMs,
  }, null, 2));
})().catch((e: unknown) => { console.error('SMOKE_ERROR', (e as Error)?.message ?? e); process.exit(1); });
