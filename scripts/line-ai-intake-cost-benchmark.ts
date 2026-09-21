#!/usr/bin/env tsx
/**
 * LINE intake cost benchmark (remediation spec §10.1, plan D1/C).
 *
 * Drives the FROZEN corpus in `line-ai-intake-cost.corpus.ts` through the REAL gateway code paths
 * in-process — the production controller entry point for intake and receipt OCR, and the real
 * `OrchestratorAgent` for the follow-on turn — inside `runWithUsageContext`, so every provider call
 * is metered exactly the way production meters it. Standalone (no NestJS server, no database, no
 * HTTP to the API): the ERP tool client is a deterministic stub, so ONLY the model calls are real.
 *
 * NEVER run in CI. It spends real money.
 *
 * Run it from `apps/ai-gateway`: that workspace's tsconfig carries `experimentalDecorators` (the
 * controller is a Nest class) and its `pnpm exec` resolves `sharp`, which is not hoisted to the root.
 *
 * Usage:
 *   cd apps/ai-gateway
 *   MODEL_PROVIDER=bedrock AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 \
 *     BEDROCK_REGION=ap-southeast-1 BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6 \
 *     pnpm exec tsx ../../scripts/line-ai-intake-cost-benchmark.ts --label baseline --out <dir>
 *
 * Options:
 *   --repetitions N   passes over the corpus in a fixed order (default 2). Pass 1 is mostly
 *                     first-use (cache write), pass 2 mostly warm. Cold/warm is classified AFTER
 *                     the fact from each call's cache counters — a provider cache cannot be busted
 *                     without changing the prefix, which would change what we are measuring.
 *   --only a,b,c      run these task ids only (cheap iteration).
 *   --max-thb X       hard spend guard for THIS run (default 60). The run stops as soon as the
 *                     cumulative cost passes it; remaining tasks are recorded as budget_stopped and
 *                     stay in the denominator.
 *   --thb-per-usd X   fixed FX for pricing (default 33). Use the SAME value before and after.
 *   --out DIR         output directory (default ./.intake-cost-out).
 *   --ledger FILE     cumulative spend ledger appended across every run (default <out>/../spend-ledger.jsonl).
 *   --label NAME      run label recorded in the summary (e.g. baseline).
 *   --smoke           one cheap provider call to prove credentials, then exit.
 *   --dry-run         render images and record prompt sizes WITHOUT any provider call.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  LINE_AI_ACTOR_DELEGATIONS_PER_TOOL,
  LINE_TOOL_REGISTRY,
  extractValueCandidates,
  hasToolPermissions,
  type AiUsageEntry,
  type LineAiTurnRequest,
  type LineIntakeRoutePlan,
  type LineIntakeRouteRequest,
  type ReceiptOcrResponse,
  type ToolMeta,
  type ToolResult,
} from '@watchdog-bms/contracts';
import { LineAiInternalController } from '../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller';
import { OrchestratorAgent } from '../apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent';
import { intakeRouterSystemPrompt } from '../apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent';
import { BedrockProvider } from '../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider';
import { drainUsage, runWithUsageContext } from '../apps/ai-gateway/src/common/usage/usage-context';
import { computeCostSatang } from '../apps/api/src/modules/line-ai/application/ai-model-pricing';
import { advisorDirectAnswerText } from '../apps/api/src/modules/line-ai/domain/logic/line-advisor-direct-answer.logic';
import { isCapabilityQuestion } from '../apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic';
import {
  INTAKE_COST_CAPTURE_INTENTS,
  INTAKE_COST_CORPUS_TODAY_ISO,
  LINE_AI_INTAKE_COST_CORPUS,
  QUERY_PERMISSION_KEY,
  RECEIPT_CAPTURE_PERMISSION_KEYS,
  intakeCostCorpusHash,
  type IntakeCostImageSpec,
  type IntakeCostTask,
} from './line-ai-intake-cost.corpus';

// ── options ──────────────────────────────────────────────────────────────────

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const OPTS = {
  repetitions: Number(flag('repetitions') ?? '2'),
  only: (flag('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  maxThb: Number(flag('max-thb') ?? '60'),
  thbPerUsd: Number(flag('thb-per-usd') ?? '33'),
  out: resolve(flag('out') ?? '.intake-cost-out'),
  label: flag('label') ?? 'unlabelled',
  smoke: has('smoke'),
  dryRun: has('dry-run'),
  // Harness-only pacing. A back-to-back corpus run trips the account's Bedrock on-demand burst limit
  // (observed 2026-09-17: PROVIDER_THROTTLED inside a tool loop), which would fill the baseline with
  // infrastructure failures instead of model behaviour. This sleeps before each provider call and is
  // subtracted from the reported latency; it changes no prompt, payload or provider setting.
  paceMs: Number(flag('pace-ms') ?? '2000'),
};
const LEDGER = resolve(flag('ledger') ?? join(dirname(OPTS.out), 'spend-ledger.jsonl'));

// ── environment / production-equivalent capability set ───────────────────────

const ENV = {
  modelProvider: process.env['MODEL_PROVIDER'] ?? 'disabled',
  bedrockRegion: process.env['BEDROCK_REGION'],
  bedrockModelId: process.env['BEDROCK_MODEL_ID'],
  documentAiModelId: process.env['DOCUMENT_AI_MODEL_ID'] ?? process.env['BEDROCK_MODEL_ID'],
  aiToolTimeoutMs: Number(process.env['AI_TOOL_TIMEOUT_MS'] ?? '15000'),
  aiMaxToolCalls: Number(process.env['AI_MAX_TOOL_CALLS'] ?? '8'),
};

/**
 * PRODUCTION-equivalent serving flags, read off `infra/prod-ecs-express/deploy.sh` (2026-09-17):
 * advisor=social, fused-plan shadow=true, prepared simple read=true, draft edit=true, tool-use loop
 * and coverage critic = AI enabled = true, AI_TOOL_TIMEOUT_MS=15000, AI_MAX_TOOL_CALLS=8.
 * `LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE` and `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE` are not set
 * by that script at all, so they take the schema default 'off' — the substitute/reimbursement
 * prompt sections are NOT part of the production intake prompt and are off here too.
 * `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` defaults to the four compiled families in the same
 * script; without them the prepared simple-read lane never fires and the benchmark would measure a
 * path production does not take.
 */
const PROD_FLAGS = {
  lineAiAdvisorMode: 'social',
  lineAiFusedPlanShadowEnabled: true,
  lineAiPreparedSimpleReadEnabled: true,
  lineAiDraftEditEnabled: true,
  lineAiTooluseLoopEnabled: true,
  lineAiCoverageCriticEnabled: true,
  lineAiSubstituteSemanticRoutingMode: 'off',
  lineAiReimbursementSemanticMode: 'off',
  lineAiDeterministicResponseFamilies: [
    'sales.get_sales_summary::single_metric',
    'expense.list_recent::single_metric',
    'accounting.get_summary::list',
    'expense.get_daily_closing::single_metric',
    // Wave 2 R5 (spec §6.2), same default as deploy.sh in both environments since 2026-09-18.
    'tax.get_vat_summary::single_metric',
    'inventory.list_low_stock::list',
    'procurement.get_ap_outstanding::single_metric',
    'procurement.get_ap_outstanding::list',
    'crm.get_customer_summary::single_metric',
    'crm.get_customer_summary::list',
  ],
} as const;

/** The capabilities `tryRouteIntake` would compute from PROD_FLAGS. */
const INTAKE_CAPABILITIES = {
  fusedPlan: PROD_FLAGS.lineAiFusedPlanShadowEnabled || PROD_FLAGS.lineAiPreparedSimpleReadEnabled,
  advisor: PROD_FLAGS.lineAiAdvisorMode === 'social',
} as const;

const INTERNAL_SECRET = 'intake-cost-benchmark-secret';

/** Duck-typed AiGatewayConfigService: exactly the getters the controller, provider factory,
 *  orchestrator, composer and critic read (same trick as `orchestrator-smoke.ts`). */
const config = {
  modelProvider: ENV.modelProvider,
  bedrockRegion: ENV.bedrockRegion,
  bedrockModelId: ENV.bedrockModelId,
  documentAiModelId: ENV.documentAiModelId,
  openAiApiKey: undefined,
  openAiModel: '',
  openAiProcessingRegion: undefined,
  approvedAiProviders: [ENV.modelProvider],
  approvedAiModelIds: [...new Set([ENV.bedrockModelId, ENV.documentAiModelId].filter(Boolean))] as string[],
  approvedAiRegions: [ENV.bedrockRegion].filter(Boolean) as string[],
  aiToolTimeoutMs: ENV.aiToolTimeoutMs,
  aiMaxToolCalls: ENV.aiMaxToolCalls,
  aiGatewayInternalSecret: INTERNAL_SECRET,
  lineAiFusedPlanShadowEnabled: PROD_FLAGS.lineAiFusedPlanShadowEnabled,
  lineAiPreparedSimpleReadEnabled: PROD_FLAGS.lineAiPreparedSimpleReadEnabled,
  lineAiDraftEditEnabled: PROD_FLAGS.lineAiDraftEditEnabled,
  lineAiTooluseLoopEnabled: PROD_FLAGS.lineAiTooluseLoopEnabled,
  lineAiCoverageCriticEnabled: PROD_FLAGS.lineAiCoverageCriticEnabled,
  lineAiDeterministicResponseFamilies: [...PROD_FLAGS.lineAiDeterministicResponseFamilies],
} as never;

// ── measurement shim ─────────────────────────────────────────────────────────
//
// Prompt accounting has to describe what production actually PUTS ON THE WIRE, per block, for every
// call — not a reconstruction of it. `BedrockProvider` is wrapped here, in the harness, so no
// gateway source changes: each call records its own block sizes next to the usage row the provider
// already appends. Sizes and the intake payload's own JSON keys only; no prompt text is stored.

type CallShape = {
  tag: string;
  systemChars: number;
  cacheableChars: number;
  userTextChars: number;
  imageBytes: number;
  maxTokens: number;
  /** Only for `line.intake-route`: serialized size of each top-level payload key. */
  payloadFieldChars?: Record<string, number>;
  /** Only for `line.intake-route`: serialized size of each cacheable-context key. */
  cacheableFieldChars?: Record<string, number>;
};
let CALL_SHAPES: CallShape[] = [];

function fieldSizes(json: string | undefined): Record<string, number> | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, JSON.stringify(v)?.length ?? 0]));
  } catch {
    return undefined;
  }
}

function installMeasurementShim(): void {
  for (const method of ['generateText', 'generateWithTools'] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = BedrockProvider.prototype[method] as (input: any) => Promise<unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (BedrockProvider.prototype as any)[method] = async function measured(input: any) {
      const tag: string = input?.usageTag ?? 'untagged';
      const userText: string = (input?.messages ?? []).map((m: { text?: string }) => m.text ?? '').join('');
      const shape: CallShape = {
        tag,
        systemChars: (input?.systemPrompt ?? '').length,
        cacheableChars: (input?.cacheableContext ?? '').length,
        userTextChars: userText.length,
        imageBytes: (input?.images ?? []).reduce((total: number, image: { contentBase64: string }) =>
          total + Math.ceil((image.contentBase64?.length ?? 0) * 3 / 4), 0),
        maxTokens: input?.maxTokens ?? 0,
      };
      if (tag === 'line.intake-route') {
        shape.payloadFieldChars = fieldSizes(input?.messages?.[0]?.text);
        shape.cacheableFieldChars = fieldSizes(input?.cacheableContext);
      }
      CALL_SHAPES.push(shape);
      if (OPTS.paceMs > 0) await new Promise((done) => setTimeout(done, OPTS.paceMs));
      return original.call(this, input);
    };
  }
}

// ── deterministic image rendering ────────────────────────────────────────────

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildSvg(spec: IntakeCostImageSpec): string {
  const shapes = (spec.shapes ?? []).map((shape) => {
    if (shape.kind === 'rect') return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="${shape.fill}"/>`;
    if (shape.kind === 'circle') return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${shape.fill}"/>`;
    return `<path d="${shape.d}" stroke="${shape.color}" stroke-width="${shape.width}" fill="none" stroke-linecap="round"/>`;
  }).join('');
  const texts = spec.lines.map((line) => {
    const anchor = line.align === 'right' ? 'end' : line.align === 'center' ? 'middle' : 'start';
    return `<text x="${line.x ?? 20}" y="${line.y}" font-family="${escapeXml(line.family ?? 'Helvetica')}" font-size="${line.size ?? 14}"`
      + ` fill="${line.color ?? '#111111'}" font-weight="${line.weight ?? 'normal'}" text-anchor="${anchor}">${escapeXml(line.text)}</text>`;
  }).join('');
  const body = `${shapes}${texts}`;
  const content = spec.rotateDeg
    ? `<g transform="rotate(${spec.rotateDeg} ${spec.widthPx / 2} ${spec.heightPx / 2})">${body}</g>`
    : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.widthPx}" height="${spec.heightPx}">`
    + `<rect width="${spec.widthPx}" height="${spec.heightPx}" fill="${spec.background}"/>${content}</svg>`;
}

async function renderImage(spec: IntakeCostImageSpec): Promise<{ mimeType: 'image/jpeg' | 'image/png'; contentBase64: string; sha256: string; bytes: number }> {
  let pipeline = sharp(Buffer.from(buildSvg(spec)));
  if (spec.blurSigma) pipeline = pipeline.blur(spec.blurSigma);
  const buffer = spec.format === 'png'
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
    : await pipeline.jpeg({ quality: spec.quality ?? 88 }).toBuffer();
  return {
    mimeType: spec.format === 'png' ? 'image/png' : 'image/jpeg',
    contentBase64: buffer.toString('base64'),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length,
  };
}

// ── deterministic ERP tool stub ──────────────────────────────────────────────
//
// Small, synthetic, read-only results so the tool loop and composer run exactly as they do in
// production while nothing touches the API or a database.

const STUB_DATA: Record<string, unknown> = {
  'company.get_current_context': { name: 'บริษัท ทดสอบมั่งมี จำกัด', branchCount: 1 },
  'company.list_branches': { total: 1, items: [{ id: 'br-1', name: 'สาขาทดสอบ' }] },
  'dashboard.get_business_health_summary': { widgets: [{ key: 'sales' }, { key: 'expense' }, { key: 'cash' }] },
  'notifications.list_open_alerts': { count: 2 },
  'notifications.get_daily_summary': { total: 2 },
  'inventory.search_products': { total: 3, items: [{ id: 'p1', name: 'สินค้า ก', onHand: '12' }] },
  'inventory.list_low_stock': { count: 4, items: [{ id: 'p2', name: 'สินค้า ข', onHand: '2', reorderPoint: '10' }] },
  'inventory.get_stock_balance': [{ productId: 'p1', onHand: '12' }],
  'inventory.summarize_stock_movements': { inQty: 120, outQty: 80 },
  'ledger.get_financial_summary': { periodKey: '2026-09', netProfit: '84200.00', totalAssets: '1250000.00', trialBalanceDifference: '0.00' },
  'ledger.get_period_status': { periodKey: '2026-09', status: 'OPEN' },
  'ledger.get_report_summary': { periodKey: '2026-09', revenue: '512000.00', expense: '427800.00' },
  'expense.list_recent': {
    period: { fromDate: '2026-09-01', toDate: '2026-09-17' },
    summary: { totalAmount: '42870.00', confirmedAmount: '42870.00', draftAmount: '0.00', unpaidAmount: '0.00' },
    items: [{ id: 'exp-1', expenseDate: '2026-09-16', vendorName: 'ร้านมั่งมีมาร์ท', amount: '3587.00' }],
  },
  'expense.get_breakdown': {
    period: { fromDate: '2026-09-01', toDate: '2026-09-17' },
    groups: [
      { key: 'cat-food-01', label: 'ค่าอาหารและเครื่องดื่ม', amount: '18240.00' },
      { key: 'cat-fuel-02', label: 'ค่าน้ำมันและเดินทาง', amount: '12630.00' },
      { key: 'cat-office-03', label: 'ค่าอุปกรณ์สำนักงาน', amount: '12000.00' },
    ],
  },
  // Real `ExpenseGetDailyClosingTool` shape (apps/api .../erp-expense-daily-closing.use-case.ts): the
  // civil day, the tool's timezone, the branch scope, and the five per-currency buckets with their own
  // item envelopes. The old `businessDate`/`totals` keys are not what that tool returns, so the
  // specialist refused every daily-closing result and the compiled F3 family could never verify one
  // (seen in the H4 replay: `ปิดยอดเมื่อวานซืน` reached the tool with the right day and still answered
  // with the honest terminal). Same magnitudes as the old keys.
  'expense.get_daily_closing': {
    date: '2026-09-17',
    timezone: 'Asia/Bangkok',
    scope: { kind: 'all_branches' },
    occurredToday: {
      items: { total: 4, items: [], remaining: 0 },
      totals: [{ currency: 'THB', total: '4010.0000', count: 4 }],
      paid: [{ currency: 'THB', total: '3120.0000', count: 3 }],
      outstanding: [{ currency: 'THB', total: '890.0000', count: 1 }],
    },
    dueEndOfDay: { items: { total: 0, items: [], remaining: 0 }, totals: [] },
    overdue: { items: { total: 0, items: [], remaining: 0 }, totals: [] },
    unscheduledOutstanding: { items: { total: 1, items: [], remaining: 0 }, totals: [{ currency: 'THB', total: '890.0000', count: 1 }] },
    submittedToday: { count: 4 },
    pendingReview: { count: 1 },
    evidenceBlockers: { count: 1 },
    duplicateRisks: { count: 0 },
  },
  'expense.get_detail': { id: 'exp-9001', expenseDate: '2026-09-17', vendorName: 'ร้านทดสอบ', amount: '1284.00', lines: [{ description: 'อาหาร', amount: '1200.00' }, { description: 'ค่าบริการ', amount: '84.00' }] },
  'expense.explain_record': {
    id: 'exp-9001', amount: '1284.00',
    lines: [{ description: 'อาหาร', amount: '1200.00' }, { description: 'ค่าบริการ 7%', amount: '84.00' }],
    explanation: { reason: 'SERVICE_CHARGE_SEPARATE_LINE', vatMode: 'NO_VAT' },
  },
  'sales.get_sales_summary': { period: { fromDate: '2026-09-01', toDate: '2026-09-17' }, totalSales: '512000.00', transactionCount: 318 },
  'crm.get_customer_summary': { total: 42, active: 40, archived: 2, newCustomers: 5, newCustomersSince: '2026-09-01' },
  'crm.search_customers': { total: 1, page: 1, pageSize: 10, items: [{ id: 'cus-1', displayName: 'ลูกค้าทดสอบ', status: 'ACTIVE' }] },
  'accounting.get_summary': { periodKey: '2026-09', documentCount: 24 },
  'accounting.list_recent_documents': { total: 2, items: [{ id: 'doc-1', kind: 'INVOICE', amount: '12000.00' }] },
  'accounting.get_document_detail': { id: 'doc-1', kind: 'INVOICE', amount: '12000.00', lines: [{ description: 'บริการ', amount: '12000.00' }] },
  'accounting.get_receivable_summary': { outstandingAmount: '86000.00', overdueAmount: '12000.00' },
  // Real `ProcurementApOutstandingTool` shape (apps/api .../erp-business-tools.use-case.ts): the aging
  // cut-off day, the Decimal-string total, the supplier count, and a preview keyed by supplier ID. The
  // previous `outstandingAmount`/`overdueAmount` keys are not what that tool returns, so the compiled AP
  // family could never verify them — same magnitudes, correct field names.
  'procurement.get_ap_outstanding': {
    asOfDate: '2026-09-17', totalOutstanding: '124500.0000', supplierCount: 6,
    topSuppliers: [{ supplier: 'sup-1', totalOutstanding: '48200.0000' }, { supplier: 'sup-2', totalOutstanding: '31100.0000' }],
  },
  'procurement.get_summary': { openPurchaseOrders: 3, totalAmount: '96000.00' },
  // Real `TaxGetVatSummaryTool` shape (apps/api .../erp-tax-tools.use-case.ts): `vatOutput`/`vatInput`/
  // `netVat` as 2-decimal strings from `displayMoney`, the period status, the ACTIVE event count, the
  // currency, and the tool's own disclaimer. Same magnitudes as the old outputVat/inputVat/payable keys.
  'tax.get_vat_summary': {
    periodKey: '2026-08', status: 'OPEN',
    vatOutput: '35840.00', vatInput: '29960.00', netVat: '5880.00',
    eventCount: 214, currency: 'THB',
    disclaimer: 'ข้อมูลสรุปนี้ยังไม่ผ่านการรับรองจากนักบัญชี กรุณาตรวจสอบและยืนยันก่อนยื่นแบบ',
  },
  'tax.get_upcoming_tax_obligations': { count: 2, items: [{ code: 'PP30', dueDate: '2026-09-23' }] },
  'tax.get_wht_summary': { periodKey: '2026-08', amount: '4200.00' },
  'reports.get_monthly_report_summary': { periodKey: '2026-09', revenue: '512000.00', expense: '427800.00' },
  'reimbursement.get_summary': { pendingCount: 2, pendingAmount: '1860.00' },
  'reimbursement.list_pending_approvals': { count: 2, items: [{ id: 'rb-1', amount: '960.00' }] },
  'workflow.list_assigned_tasks': { count: 1, items: [{ id: 'wf-1', title: 'ตรวจบิล' }] },
};

/** What each tool was actually asked for, per task (period-resolution spec P-06). Ids, dates and
 *  enums only — the values a read tool takes are already bounded to those by the sanitizer, and a
 *  bounded copy is what makes "the tool got the period the resolver produced" checkable after a run. */
type ToolInputRecord = { tool: string; input: Record<string, string | number | boolean> };
let TOOL_INPUTS: ToolInputRecord[] = [];

function boundedToolInput(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') out[key] = value.slice(0, 40);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

const erpTools = {
  async invoke(tool: ToolMeta, _ctx: unknown, input: Record<string, unknown> = {}): Promise<ToolResult> {
    TOOL_INPUTS.push({ tool: tool.name, input: boundedToolInput(input) });
    return {
      toolName: tool.name,
      status: 'ok',
      data: STUB_DATA[tool.name] ?? { count: 0 },
      sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true, webPath: `/x/${tool.name}` }],
      asOf: '2026-09-17T04:00:00.000Z',
    } as ToolResult;
  },
} as never;

// ── production follow-on decision ────────────────────────────────────────────

type FollowOn = 'none' | 'turn' | 'receipt_ocr';

const canQuery = (task: IntakeCostTask) => task.permissions.includes(QUERY_PERMISSION_KEY);
const canCapture = (task: IntakeCostTask) => RECEIPT_CAPTURE_PERMISSION_KEYS.some((key) => task.permissions.includes(key));

/**
 * Exactly the branch order `process-line-webhook.use-case.ts` takes after `tryRouteIntake`:
 *   text  — CLARIFY answers itself; a served advisor draft answers itself; every expense/document/
 *           signature route dispatches deterministically; BUSINESS_READ_QUESTION /
 *           MUTATION_REQUEST_REFUSAL / UNSUPPORTED / UNAVAILABLE go through the gateway turn behind
 *           `line.ai.query`.
 *   image — SIGNATURE / CLARIFY / MUTATION answer themselves; a BUSINESS_READ_QUESTION or
 *           UNSUPPORTED photo WITH a caption parks pending media and asks one question; everything
 *           else reaches receipt OCR behind the capture permission (a reference document is allowed
 *           through without it).
 */
function followOnFor(task: IntakeCostTask, plan: LineIntakeRoutePlan, advisorServed: boolean): FollowOn {
  const routed = plan.status === 'ROUTED';
  if (task.kind === 'image') {
    if (routed && (plan.intent === 'SIGNATURE_UPLOAD_TICKET' || plan.intent === 'CLARIFY' || plan.intent === 'MUTATION_REQUEST_REFUSAL')) return 'none';
    if (routed && (plan.intent === 'BUSINESS_READ_QUESTION' || plan.intent === 'UNSUPPORTED')
      && task.messageText.trim() && canCapture(task)) return 'none';
    const referenceOnly = routed && plan.intent === 'BUSINESS_DOCUMENT_REFERENCE';
    return canCapture(task) || referenceOnly ? 'receipt_ocr' : 'none';
  }
  if (routed && plan.intent === 'CLARIFY') return 'none';
  if (advisorServed) return 'none';
  if (routed && (plan.intent === 'EXPENSE_DOCUMENT_CAPTURE' || plan.intent === 'EXPENSE_DRAFT_CONTINUATION'
    || plan.intent === 'EXPENSE_CAPTURE_CORRECTION' || plan.intent === 'SIGNATURE_UPLOAD_TICKET'
    || plan.intent === 'BUSINESS_DOCUMENT_REFERENCE')) return 'none';
  return canQuery(task) ? 'turn' : 'none';
}

// ── task execution ───────────────────────────────────────────────────────────

type TaskOutcome = 'completed' | 'refused' | 'parse_failed' | 'truncated' | 'provider_error' | 'budget_stopped';

type TaskRecord = {
  runId: string;
  label: string;
  pass: number;
  taskId: string;
  kind: 'text' | 'image';
  coverage: string;
  imageSha256?: string;
  imageBytes?: number;
  outcome: TaskOutcome;
  success: boolean;
  successReasons: string[];
  routedIntent?: string;
  /** Telemetry only (Stage 2): whether the intake answer carried a fused prepared plan / advisor
   *  draft. Read off the parsed plan AFTER the call — it changes nothing that is sent to the model. */
  preparedPlanPresent: boolean;
  advisorAnswerPresent: boolean;
  /** True when production would skip the separate receipt-OCR call. */
  onePassReceiptPresent: boolean;
  expectedIntents: string[];
  routingCorrect: boolean;
  permissionOutcome: 'allowed' | 'denied';
  followOn: FollowOn;
  documentTextChars?: number;
  receipt?: {
    status?: string;
    errorCode?: string;
    grandTotalAmount?: string;
    vatAmount?: string;
    expenseDate?: string;
    vendorName?: string;
    fieldsCorrect?: Record<string, boolean>;
  };
  latencyMs: number;
  wallClockMs?: number;
  calls: number;
  costSatang: number;
  usage: AiUsageEntry[];
  callShapes: CallShape[];
  /** Every ERP tool call this task made, with the input it received (P-06). */
  toolInputs: ToolInputRecord[];
  /** The periods the deterministic resolver read from this task's message (P-06), so a run can be
   *  scored without re-deriving them. Empty when the message names no period. */
  resolvedPeriods: Array<{ kind: string; fromDate: string; toDate: string; monthKey?: string; source: string }>;
};

const ROUTE_REFUSAL_INTENTS = new Set(['MUTATION_REQUEST_REFUSAL', 'UNSUPPORTED', 'CLARIFY']);

const normalizeMoney = (value: string | undefined): string | null => {
  const raw = value?.trim().replace(/,/g, '');
  if (!raw || !/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
};

/** EXACTLY the rule `computeValueCandidates` applies in `process-line-webhook.use-case.ts`: a turn
 *  whose only value is a PERIOD ("ยอดขายเมื่อวาน" — no amount, no written date) must still carry the
 *  payload, or the gateway has nothing to select from and the answer falls back to the tool default. */
function hasValueCandidates(candidates: { amounts: unknown[]; dates: unknown[]; periods?: unknown[] }): boolean {
  return candidates.amounts.length > 0 || candidates.dates.length > 0 || (candidates.periods?.length ?? 0) > 0;
}

function buildIntakeRequest(task: IntakeCostTask, requestId: string, image?: { mimeType: 'image/jpeg' | 'image/png'; contentBase64: string }): LineIntakeRouteRequest {
  const candidates = task.messageText
    ? extractValueCandidates(task.messageText, INTAKE_COST_CORPUS_TODAY_ISO)
    : { amounts: [], dates: [] };
  const hasCandidates = hasValueCandidates(candidates);
  return {
    requestId,
    companyId: 'company-benchmark',
    userId: 'user-benchmark',
    locale: 'th-TH',
    messageText: task.messageText,
    permissions: task.permissions,
    activeCategories: task.activeCategories ?? [],
    capabilities: { ...INTAKE_CAPABILITIES },
    ...(task.conversationContext ? { conversationContext: task.conversationContext as never } : {}),
    ...(hasCandidates ? { valueCandidates: candidates } : {}),
    ...(task.openClarifications ? { openClarifications: task.openClarifications as never } : {}),
    ...(task.recentCapturedExpenses ? { recentCapturedExpenses: task.recentCapturedExpenses as never } : {}),
    ...(task.activeExpenseDrafts ? { activeExpenseDrafts: task.activeExpenseDrafts as never } : {}),
    ...(image ? { attachments: [{ id: 'att-benchmark', mimeType: image.mimeType, purpose: 'unknown' as const, contentBase64: image.contentBase64 }] } : {}),
  };
}

/**
 * The same single-use actor delegations `AiGatewayClient.requestLineTurn` mints before it posts a
 * turn: one bounded batch per tool the caller both holds the permissions for and is entitled to,
 * and none at all without `ai.tool.invoke`. The gateway only checks that the batch is non-empty for
 * the tool it is about to call (`orchestrator.agent.ts` `delegation_missing`) and the stubbed ERP
 * boundary never redeems one, so an opaque placeholder is enough — but leaving them out entirely
 * would close the prepared simple-read lane and measure a path production does not take.
 */
function mintActorDelegations(permissions: readonly string[], requestId: string): Record<string, string[]> {
  if (!permissions.includes('ai.tool.invoke')) return {};
  return Object.fromEntries(
    LINE_TOOL_REGISTRY
      .filter((tool) => hasToolPermissions(tool, permissions))
      .map((tool) => [
        tool.name,
        Array.from({ length: LINE_AI_ACTOR_DELEGATIONS_PER_TOOL }, (_unused, index) => `benchmark-delegation-${requestId}-${tool.name}-${index}`),
      ]),
  );
}

function buildTurnRequest(task: IntakeCostTask, plan: LineIntakeRoutePlan, requestId: string): LineAiTurnRequest {
  const candidates = task.messageText ? extractValueCandidates(task.messageText, INTAKE_COST_CORPUS_TODAY_ISO) : { amounts: [], dates: [] };
  const hasCandidates = hasValueCandidates(candidates);
  const intakeIntent = plan.status === 'ROUTED' ? plan.intent : undefined;
  return {
    requestId,
    webhookEventId: `evt-${requestId}`,
    messageText: task.messageText,
    messagePreviewHash: createHash('sha256').update(task.messageText).digest('hex').slice(0, 32),
    userContext: {
      lineUserId: '[REDACTED]',
      internalUserId: 'user-benchmark',
      companyId: 'company-benchmark',
      membershipId: 'mem-benchmark',
      permissions: task.permissions,
      roles: ['owner'],
      locale: 'th-TH',
      chatKeyHash: 'chat-benchmark-hash',
    },
    actorDelegations: mintActorDelegations(task.permissions, requestId),
    ...(task.conversationContext ? { conversationContext: task.conversationContext as never } : {}),
    ...(hasCandidates ? { valueCandidates: candidates } : {}),
    ...(task.openClarifications ? { openClarifications: task.openClarifications as never } : {}),
    ...(intakeIntent ? { intakeIntent: intakeIntent as never } : {}),
    ...(plan.preparedPlan ? { preparedPlan: plan.preparedPlan } : {}),
  } as LineAiTurnRequest;
}

async function runTask(
  controller: LineAiInternalController,
  orchestrator: OrchestratorAgent,
  task: IntakeCostTask,
  pass: number,
  runId: string,
): Promise<TaskRecord> {
  CALL_SHAPES = [];
  TOOL_INPUTS = [];
  const startedAt = Date.now();
  const requestId = `${runId}-p${pass}-${task.id}`;
  const rendered = task.image ? await renderImage(task.image) : undefined;

  // One usage context per task, exactly like the request-scoped interceptor in production. The
  // drain HAS to happen inside it, so the whole chain and the drain share one closure.
  const chain = await runWithUsageContext({ companyId: 'company-benchmark' }, async () => {
    const intakeRequest = buildIntakeRequest(task, requestId, rendered);
    let routePlan: LineIntakeRoutePlan;
    try {
      routePlan = await controller.lineIntakeRoute(INTERNAL_SECRET, intakeRequest);
    } catch (error) {
      return {
        plan: { status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0, errorCode: `THROWN:${(error as Error).message.slice(0, 60)}` } as LineIntakeRoutePlan,
        receipt: undefined as ReceiptOcrResponse | undefined,
        chainOutcome: 'provider_error' as TaskOutcome | undefined,
        followOn: 'none' as FollowOn,
        usage: drainUsage(),
      };
    }

    const advisorServed = !!advisorDirectAnswerText(routePlan.advisorAnswer, {
      advisorEnabled: INTAKE_CAPABILITIES.advisor,
      routedAdvisor: routePlan.status === 'ROUTED' && routePlan.intent === 'ADVISOR_CONVERSATION',
      hasAttachment: task.kind === 'image',
      hasOpenClarifications: (task.openClarifications?.length ?? 0) > 0,
      hasActiveExpenseDrafts: (task.activeExpenseDrafts?.length ?? 0) > 0,
      hasPendingMediaCapsule: false,
      hasSubstituteState: false,
      capabilityQuestion: isCapabilityQuestion(task.messageText),
    });

    const next = followOnFor(task, routePlan, advisorServed);
    let receiptResult: ReceiptOcrResponse | undefined;
    let chainOutcome: TaskOutcome | undefined;
    try {
      if (next === 'turn') {
        await orchestrator.run(buildTurnRequest(task, routePlan, requestId));
      } else if (next === 'receipt_ocr' && rendered) {
        // Mirror `tryExtractReceiptFields`: a server-validated one-pass envelope skips the whole
        // receipt-OCR request; an absent/rejected candidate follows the unchanged OCR path.
        receiptResult = routePlan.onePassReceipt
          ? { status: 'ok', ...routePlan.onePassReceipt }
          : await controller.receiptOcr(INTERNAL_SECRET, {
            requestId,
            companyId: 'company-benchmark',
            userId: 'user-benchmark',
            activeCategories: task.activeCategories ?? [],
            attachment: { id: 'att-benchmark', mimeType: rendered.mimeType, purpose: 'receipt', contentBase64: rendered.contentBase64 },
            // The production media path forwards the router's own read so OCR skips a second image read.
            ...(routePlan.documentText ? { documentText: routePlan.documentText } : {}),
          } as never);
      }
    } catch (error) {
      chainOutcome = 'provider_error';
      console.error(`  follow-on threw for ${task.id}: ${(error as Error).message.slice(0, 160)}`);
    }
    return { plan: routePlan, receipt: receiptResult, chainOutcome, followOn: next, usage: drainUsage() };
  });

  return finishRecord({ task, pass, runId, startedAt, rendered, ...chain });
}

/** Split out so `runTask` stays readable; scoring is mechanical (spec §10.1 forbids judgement here). */
function finishRecord(input: {
  task: IntakeCostTask;
  pass: number;
  runId: string;
  startedAt: number;
  plan: LineIntakeRoutePlan;
  receipt?: ReceiptOcrResponse;
  chainOutcome?: TaskOutcome;
  followOn: FollowOn;
  rendered?: { sha256: string; bytes: number };
  usage: AiUsageEntry[];
}): TaskRecord {
  const { task, plan, receipt, rendered, usage } = input;
  const costSatang = usage.reduce((total, entry) => total + computeCostSatang(entry, OPTS.thbPerUsd).costSatang, 0);

  const reasons: string[] = [];
  let outcome: TaskOutcome = input.chainOutcome ?? 'completed';
  if (!input.chainOutcome) {
    if (plan.status !== 'ROUTED') {
      outcome = plan.errorCode === 'ROUTER_OUTPUT_TRUNCATED' ? 'truncated'
        : plan.errorCode === 'ROUTER_JSON_PARSE_FAILED' ? 'parse_failed'
        : 'provider_error';
    } else if (ROUTE_REFUSAL_INTENTS.has(plan.intent) && !task.expect.intents.includes(plan.intent as never)) {
      outcome = 'refused';
    }
  }

  const routingCorrect = plan.status === 'ROUTED' && task.expect.intents.includes(plan.intent as never);
  if (!routingCorrect) reasons.push(`route ${plan.status === 'ROUTED' ? plan.intent : plan.errorCode ?? 'UNAVAILABLE'} not in [${task.expect.intents.join('|')}]`);
  if (task.expect.forbidCapture && plan.status === 'ROUTED' && INTAKE_COST_CAPTURE_INTENTS.includes(plan.intent as never)) {
    reasons.push('captured a turn that must not capture');
  }
  if (task.expect.resolvesClarificationIds) {
    const got = new Set(plan.resolvedClarificationIds ?? []);
    for (const id of task.expect.resolvesClarificationIds) if (!got.has(id)) reasons.push(`clarification ${id} not resolved`);
  }
  if (task.expect.requiresDocumentText && !(plan.documentText && plan.documentText.length >= 24)) {
    reasons.push('no usable documentText handed back');
  }

  const fieldsCorrect: Record<string, boolean> = {};
  if (task.expect.receipt) {
    const expected = task.expect.receipt;
    const fields = receipt?.fields;
    fieldsCorrect['grandTotalAmount'] = normalizeMoney(fields?.grandTotalAmount) === normalizeMoney(expected.grandTotalAmount);
    fieldsCorrect['expenseDate'] = (fields?.expenseDate ?? '') === expected.expenseDate;
    fieldsCorrect['vendorName'] = (fields?.vendorName ?? '').toLowerCase().includes(expected.vendorNameContains.toLowerCase());
    if (expected.vatAmount) fieldsCorrect['vatAmount'] = normalizeMoney(fields?.vatAmount) === normalizeMoney(expected.vatAmount);
    for (const [field, ok] of Object.entries(fieldsCorrect)) if (!ok) reasons.push(`receipt ${field} wrong`);
  }

  return {
    runId: input.runId,
    label: OPTS.label,
    pass: input.pass,
    taskId: task.id,
    kind: task.kind,
    coverage: task.coverage,
    ...(rendered ? { imageSha256: rendered.sha256, imageBytes: rendered.bytes } : {}),
    outcome,
    success: reasons.length === 0 && outcome === 'completed',
    successReasons: reasons,
    ...(plan.status === 'ROUTED' ? { routedIntent: plan.intent } : {}),
    preparedPlanPresent: !!plan.preparedPlan,
    advisorAnswerPresent: !!plan.advisorAnswer,
    onePassReceiptPresent: !!plan.onePassReceipt,
    expectedIntents: [...task.expect.intents],
    routingCorrect,
    permissionOutcome: task.expect.permissionOutcome,
    followOn: input.followOn,
    ...(plan.documentText ? { documentTextChars: plan.documentText.length } : {}),
    ...(receipt || task.expect.receipt
      ? {
          receipt: {
            status: receipt?.status,
            ...(receipt?.errorCode ? { errorCode: receipt.errorCode } : {}),
            ...(receipt?.fields?.grandTotalAmount ? { grandTotalAmount: receipt.fields.grandTotalAmount } : {}),
            ...(receipt?.fields?.vatAmount ? { vatAmount: receipt.fields.vatAmount } : {}),
            ...(receipt?.fields?.expenseDate ? { expenseDate: receipt.fields.expenseDate } : {}),
            ...(receipt?.fields?.vendorName ? { vendorName: receipt.fields.vendorName } : {}),
            ...(Object.keys(fieldsCorrect).length ? { fieldsCorrect } : {}),
          },
        }
      : {}),
    // Wall clock minus the harness's own pacing sleeps, so latency is the chain's, not the shim's.
    latencyMs: Math.max(0, Date.now() - input.startedAt - usage.length * OPTS.paceMs),
    wallClockMs: Date.now() - input.startedAt,
    calls: usage.length,
    costSatang,
    usage,
    callShapes: [...CALL_SHAPES],
    toolInputs: [...TOOL_INPUTS],
    resolvedPeriods: (task.messageText
      ? extractValueCandidates(task.messageText, INTAKE_COST_CORPUS_TODAY_ISO).periods ?? []
      : []).map((period) => ({
        kind: period.kind,
        fromDate: period.fromDate,
        toDate: period.toDate,
        ...(period.monthKey ? { monthKey: period.monthKey } : {}),
        source: period.source,
      })),
  };
}

// ── reporting ────────────────────────────────────────────────────────────────

const pct = (part: number, whole: number) => (whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`);
const thb = (satang: number) => (satang / 100).toFixed(2);

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

/** True when SOME call of this task was handed exactly a period the resolver read from its message
 *  (either boundary pair, the CRM window, the single day, or the month key). */
function periodInputMatches(record: TaskRecord): boolean {
  return record.toolInputs.some((call) => record.resolvedPeriods.some((period) => {
    const got = call.input;
    if (typeof got['periodKey'] === 'string') return got['periodKey'] === period.monthKey;
    if (typeof got['date'] === 'string') return got['date'] === period.fromDate && period.fromDate === period.toDate;
    if (typeof got['newSince'] === 'string') return got['newSince'] === period.fromDate && got['newUntil'] === period.toDate;
    return got['fromDate'] === period.fromDate && got['toDate'] === period.toDate;
  }));
}

function summarize(records: TaskRecord[]) {
  const group = (rows: TaskRecord[]) => {
    const attempted = rows.length;
    const completed = rows.filter((r) => r.outcome === 'completed').length;
    const successful = rows.filter((r) => r.success).length;
    const cost = rows.reduce((total, r) => total + r.costSatang, 0);
    const calls = rows.reduce((total, r) => total + r.calls, 0);
    const tokens = rows.flatMap((r) => r.usage).reduce((acc, u) => ({
      input: acc.input + u.inputTokens,
      output: acc.output + u.outputTokens,
      cacheRead: acc.cacheRead + u.cacheReadInputTokens,
      cacheWrite: acc.cacheWrite + u.cacheWriteInputTokens,
    }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    return {
      attempted,
      completed,
      successful,
      refused: rows.filter((r) => r.outcome === 'refused').length,
      parseFailed: rows.filter((r) => r.outcome === 'parse_failed').length,
      truncated: rows.filter((r) => r.outcome === 'truncated').length,
      providerError: rows.filter((r) => r.outcome === 'provider_error').length,
      budgetStopped: rows.filter((r) => r.outcome === 'budget_stopped').length,
      routingCorrect: rows.filter((r) => r.routingCorrect).length,
      /** Provider calls that came back !ok (throttle, timeout, access) — still metered, still paid. */
      failedCalls: rows.flatMap((r) => r.usage).filter((u) => !u.ok).length,
      callsPerTask: attempted ? calls / attempted : 0,
      onePassReceipts: rows.filter((r) => r.onePassReceiptPresent).length,
      tokens,
      costSatang: cost,
      costPerAttemptedSatang: attempted ? cost / attempted : 0,
      costPerSuccessfulSatang: successful ? cost / successful : 0,
      latencyP50: percentile(rows.map((r) => r.latencyMs), 50),
      latencyP90: percentile(rows.map((r) => r.latencyMs), 90),
    };
  };

  const byTag: Record<string, { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; costSatang: number; cold: number; warm: number; neither: number }> = {};
  for (const record of records) {
    for (const entry of record.usage) {
      const bucket = byTag[entry.tag] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costSatang: 0, cold: 0, warm: 0, neither: 0 };
      bucket.calls += 1;
      bucket.input += entry.inputTokens;
      bucket.output += entry.outputTokens;
      bucket.cacheRead += entry.cacheReadInputTokens;
      bucket.cacheWrite += entry.cacheWriteInputTokens;
      bucket.costSatang += computeCostSatang(entry, OPTS.thbPerUsd).costSatang;
      if (entry.cacheWriteInputTokens > 0) bucket.cold += 1;
      else if (entry.cacheReadInputTokens > 0) bucket.warm += 1;
      else bucket.neither += 1;
    }
  }

  const receiptRows = records.filter((r) => r.receipt?.fieldsCorrect);
  const fieldAccuracy: Record<string, { correct: number; total: number }> = {};
  for (const row of receiptRows) {
    for (const [field, ok] of Object.entries(row.receipt!.fieldsCorrect!)) {
      const bucket = fieldAccuracy[field] ??= { correct: 0, total: 0 };
      bucket.total += 1;
      if (ok) bucket.correct += 1;
    }
  }

  return {
    overall: group(records),
    text: group(records.filter((r) => r.kind === 'text')),
    image: group(records.filter((r) => r.kind === 'image')),
    byPass: Object.fromEntries([...new Set(records.map((r) => r.pass))].map((pass) => [pass, group(records.filter((r) => r.pass === pass))])),
    byTag,
    fieldAccuracy,
  };
}

function promptAccounting(records: TaskRecord[]) {
  const intakeShapes = records.flatMap((r) => r.callShapes.filter((s) => s.tag === 'line.intake-route')
    .map((s) => ({ ...s, kind: r.kind })));
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const forKind = (kind: 'text' | 'image') => {
    const rows = intakeShapes.filter((s) => s.kind === kind);
    const fieldKeys = new Set(rows.flatMap((r) => Object.keys(r.payloadFieldChars ?? {})));
    return {
      calls: rows.length,
      systemChars: mean(rows.map((r) => r.systemChars)),
      cacheableChars: mean(rows.map((r) => r.cacheableChars)),
      userTextChars: mean(rows.map((r) => r.userTextChars)),
      imageBytes: mean(rows.map((r) => r.imageBytes)),
      maxTokens: mean(rows.map((r) => r.maxTokens)),
      payloadFieldChars: Object.fromEntries([...fieldKeys].map((key) => [key, mean(rows.map((r) => r.payloadFieldChars?.[key] ?? 0))])),
      cacheableFieldChars: Object.fromEntries(
        [...new Set(rows.flatMap((r) => Object.keys(r.cacheableFieldChars ?? {})))]
          .map((key) => [key, mean(rows.map((r) => r.cacheableFieldChars?.[key] ?? 0))]),
      ),
    };
  };

  // System-prompt sections, measured from the real builder (no reconstruction).
  const full = intakeRouterSystemPrompt({ fusedPlan: true, advisor: true }).length;
  const sections = {
    legacyBase: intakeRouterSystemPrompt({}).length,
    withFusedOnly: intakeRouterSystemPrompt({ fusedPlan: true }).length,
    withAdvisorOnly: intakeRouterSystemPrompt({ advisor: true }).length,
    production: full,
    fusedPlanSectionChars: intakeRouterSystemPrompt({ fusedPlan: true }).length - intakeRouterSystemPrompt({}).length,
    advisorSectionChars: intakeRouterSystemPrompt({ advisor: true }).length - intakeRouterSystemPrompt({}).length,
  };

  // Measured chars→tokens on COLD intake calls: the cacheable prefix is what gets written.
  const coldSamples = records.flatMap((record) =>
    record.usage.filter((u) => u.tag === 'line.intake-route' && u.cacheWriteInputTokens > 0)
      .map((u) => {
        const shape = record.callShapes.find((s) => s.tag === 'line.intake-route');
        return shape ? { prefixChars: shape.systemChars + shape.cacheableChars, cacheWriteTokens: u.cacheWriteInputTokens } : null;
      }).filter(Boolean) as Array<{ prefixChars: number; cacheWriteTokens: number }>);

  return {
    sections,
    text: forKind('text'),
    image: forKind('image'),
    measuredCharsPerCacheWriteToken: coldSamples.length
      ? mean(coldSamples.map((s) => s.prefixChars / s.cacheWriteTokens))
      : null,
    coldSampleCount: coldSamples.length,
  };
}

function markdown(records: TaskRecord[], summary: ReturnType<typeof summarize>, accounting: ReturnType<typeof promptAccounting>, meta: Record<string, unknown>): string {
  const groupRow = (name: string, g: ReturnType<typeof summarize>['overall']) =>
    `| ${name} | ${g.attempted} | ${g.completed} | ${g.successful} | ${pct(g.refused, g.attempted)} | ${pct(g.parseFailed, g.attempted)} | `
    + `${pct(g.truncated, g.attempted)} | ${g.callsPerTask.toFixed(2)} | ${g.onePassReceipts} | ${g.failedCalls} | ${thb(g.costPerAttemptedSatang)} | `
    + `${g.successful ? thb(g.costPerSuccessfulSatang) : '—'} | ${pct(g.routingCorrect, g.attempted)} | ${g.latencyP50} | ${g.latencyP90} |`;

  const lines: string[] = [];
  lines.push(`# LINE intake cost benchmark — ${OPTS.label}`, '');
  lines.push('| key | value |', '| --- | --- |');
  for (const [key, value] of Object.entries(meta)) lines.push(`| ${key} | ${String(value)} |`);
  lines.push('');
  lines.push('## Per kind', '');
  lines.push('| group | attempted | completed | successful | refusal | parse fail | truncation | calls/task | one-pass receipts | failed calls | THB/attempted | THB/successful | routing acc. | p50 ms | p90 ms |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  lines.push(groupRow('overall', summary.overall));
  lines.push(groupRow('text', summary.text));
  lines.push(groupRow('image', summary.image));
  for (const [pass, group] of Object.entries(summary.byPass)) lines.push(groupRow(`pass ${pass}`, group as never));
  lines.push('');
  lines.push('## Tokens by component', '');
  lines.push('| group | input | output | cache read | cache write |', '| --- | ---: | ---: | ---: | ---: |');
  for (const [name, g] of [['overall', summary.overall], ['text', summary.text], ['image', summary.image]] as const) {
    lines.push(`| ${name} | ${g.tokens.input} | ${g.tokens.output} | ${g.tokens.cacheRead} | ${g.tokens.cacheWrite} |`);
  }
  lines.push('');
  lines.push('## Per usage tag (cost cannot hide by moving tag)', '');
  lines.push('| tag | calls | input | output | cache read | cache write | THB | cold | warm | no cache |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [tag, g] of Object.entries(summary.byTag).sort((a, b) => b[1].costSatang - a[1].costSatang)) {
    lines.push(`| \`${tag}\` | ${g.calls} | ${g.input} | ${g.output} | ${g.cacheRead} | ${g.cacheWrite} | ${thb(g.costSatang)} | ${g.cold} | ${g.warm} | ${g.neither} |`);
  }
  lines.push('');
  if (Object.keys(summary.fieldAccuracy).length) {
    lines.push('## OCR field accuracy', '', '| field | correct | total |', '| --- | ---: | ---: |');
    for (const [field, a] of Object.entries(summary.fieldAccuracy)) lines.push(`| ${field} | ${a.correct} | ${a.total} |`);
    lines.push('');
  }
  lines.push('## Intake prompt accounting (measured on the wire, mean chars per call)', '');
  lines.push('| block | text intake | image intake |', '| --- | ---: | ---: |');
  lines.push(`| system prompt | ${accounting.text.systemChars.toFixed(0)} | ${accounting.image.systemChars.toFixed(0)} |`);
  lines.push(`| cacheable catalog block | ${accounting.text.cacheableChars.toFixed(0)} | ${accounting.image.cacheableChars.toFixed(0)} |`);
  lines.push(`| dynamic user payload | ${accounting.text.userTextChars.toFixed(0)} | ${accounting.image.userTextChars.toFixed(0)} |`);
  lines.push(`| image bytes | ${accounting.text.imageBytes.toFixed(0)} | ${accounting.image.imageBytes.toFixed(0)} |`);
  lines.push(`| maxTokens | ${accounting.text.maxTokens.toFixed(0)} | ${accounting.image.maxTokens.toFixed(0)} |`);
  lines.push('');
  lines.push('| payload field | text intake | image intake |', '| --- | ---: | ---: |');
  const payloadKeys = new Set([...Object.keys(accounting.text.payloadFieldChars), ...Object.keys(accounting.image.payloadFieldChars)]);
  for (const key of payloadKeys) {
    lines.push(`| \`${key}\` | ${(accounting.text.payloadFieldChars[key] ?? 0).toFixed(0)} | ${(accounting.image.payloadFieldChars[key] ?? 0).toFixed(0)} |`);
  }
  lines.push('');
  lines.push('| cacheable block key | text intake | image intake |', '| --- | ---: | ---: |');
  const cacheKeys = new Set([...Object.keys(accounting.text.cacheableFieldChars), ...Object.keys(accounting.image.cacheableFieldChars)]);
  for (const key of cacheKeys) {
    lines.push(`| \`${key}\` | ${(accounting.text.cacheableFieldChars[key] ?? 0).toFixed(0)} | ${(accounting.image.cacheableFieldChars[key] ?? 0).toFixed(0)} |`);
  }
  lines.push('');
  lines.push('| system-prompt variant | chars |', '| --- | ---: |');
  for (const [key, value] of Object.entries(accounting.sections)) lines.push(`| ${key} | ${value} |`);
  lines.push('');
  lines.push(`Measured cacheable-prefix chars per cache-write token: ${accounting.measuredCharsPerCacheWriteToken?.toFixed(2) ?? 'n/a'} (${accounting.coldSampleCount} cold samples).`, '');
  // Period resolution (spec P-06): for every task whose message NAMES a period, what the resolver
  // produced against what the tool was actually handed. Nothing here is judged by a model.
  const periodRows = records.filter((record) => record.resolvedPeriods.length > 0);
  if (periodRows.length > 0) {
    const matched = periodRows.filter(periodInputMatches);
    lines.push('## Period resolution (resolver vs. the input the tool received)', '');
    lines.push(`Matched **${matched.length} of ${periodRows.length}** (${pct(matched.length, periodRows.length)}).`, '');
    lines.push('| task | pass | resolved period | tool | input the tool received | match | lane | success |');
    lines.push('| --- | ---: | --- | --- | --- | --- | --- | --- |');
    for (const record of periodRows) {
      const period = record.resolvedPeriods[0]!;
      const call = record.toolInputs[0];
      lines.push(`| ${record.taskId} | ${record.pass} | ${period.kind} ${period.fromDate}..${period.toDate}`
        + `${period.monthKey ? ` (${period.monthKey})` : ''} | ${call?.tool ?? '—'} | `
        + `\`${call ? JSON.stringify(call.input) : '—'}\` | ${periodInputMatches(record) ? 'yes' : 'NO'} | `
        + `${record.toolInputs.length === 1 ? 'one call' : `${record.toolInputs.length} calls`} | ${record.success ? 'ok' : 'BAD'} |`);
    }
    lines.push('');
  }
  lines.push('## Failures', '');
  const failures = records.filter((r) => !r.success);
  if (failures.length === 0) lines.push('None.');
  else {
    lines.push('| task | pass | outcome | routed | reasons |', '| --- | ---: | --- | --- | --- |');
    for (const record of failures) {
      lines.push(`| ${record.taskId} | ${record.pass} | ${record.outcome} | ${record.routedIntent ?? '—'} | ${record.successReasons.join('; ') || '—'} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────────

/** git walks up from the working directory, so this resolves the worktree HEAD wherever the harness
 *  is launched inside it. */
function gitRevision(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function ledgerTotalSatang(): number {
  if (!existsSync(LEDGER)) return 0;
  return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean)
    .reduce((total, line) => {
      try { return total + (JSON.parse(line).costSatang as number ?? 0); } catch { return total; }
    }, 0);
}

async function smoke(): Promise<void> {
  if (!ENV.bedrockRegion || !ENV.bedrockModelId) throw new Error('smoke needs BEDROCK_REGION and BEDROCK_MODEL_ID');
  const provider = new BedrockProvider({ region: ENV.bedrockRegion, modelId: ENV.bedrockModelId, timeoutMs: 20_000 });
  const usage = await runWithUsageContext({ companyId: 'benchmark-smoke' }, async () => {
    const result = await provider.generateText({
      messages: [{ role: 'user', text: 'ตอบด้วยคำเดียวในภาษาไทย: ยืนยัน' }],
      maxTokens: 32,
      usageTag: 'benchmark.smoke',
    });
    const rows = drainUsage();
    if (!result.ok) throw new Error(`smoke failed: ${result.error.code} ${result.error.message}`);
    return rows;
  });
  const costSatang = usage.reduce((total, entry) => total + computeCostSatang(entry, OPTS.thbPerUsd).costSatang, 0);
  appendLedger('smoke', costSatang, usage.length);
  console.log(JSON.stringify({ ok: true, calls: usage.length, costThb: thb(costSatang), modelId: ENV.bedrockModelId, region: ENV.bedrockRegion }));
}

function appendLedger(runId: string, costSatang: number, calls: number): void {
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify({
    at: new Date().toISOString(), runId, label: OPTS.label, calls, costSatang, thbPerUsd: OPTS.thbPerUsd,
  })}\n`);
}

async function main(): Promise<void> {
  if (OPTS.smoke) return smoke();

  installMeasurementShim();
  mkdirSync(OPTS.out, { recursive: true });
  const runId = `${OPTS.label}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const priorSatang = ledgerTotalSatang();

  const tasks = LINE_AI_INTAKE_COST_CORPUS.filter((task) => OPTS.only.length === 0 || OPTS.only.includes(task.id));
  if (tasks.length === 0) throw new Error('no tasks selected');

  if (OPTS.dryRun) {
    for (const task of tasks) {
      if (!task.image) continue;
      const rendered = await renderImage(task.image);
      // Saved so a reviewer can look at the synthetic pages; never committed to the repo.
      writeFileSync(join(OPTS.out, `${task.id}.${task.image.format === 'png' ? 'png' : 'jpg'}`), Buffer.from(rendered.contentBase64, 'base64'));
      console.log(JSON.stringify({ taskId: task.id, sha256: rendered.sha256, bytes: rendered.bytes }));
    }
    console.log(JSON.stringify({ dryRun: true, corpusHash: intakeCostCorpusHash(), tasks: tasks.length }));
    return;
  }

  if (ENV.modelProvider !== 'bedrock') throw new Error('set MODEL_PROVIDER=bedrock for a real measurement run');

  const controller = new LineAiInternalController(config, { execute: async () => { throw new Error('line-turn use case is not used by this harness'); } } as never);
  const orchestrator = new OrchestratorAgent(erpTools, config);

  const records: TaskRecord[] = [];
  let spentSatang = 0;
  let stopped = false;
  const jsonlPath = join(OPTS.out, `${runId}.jsonl`);

  for (let pass = 1; pass <= OPTS.repetitions; pass += 1) {
    for (const task of tasks) {
      if (stopped || spentSatang >= OPTS.maxThb * 100) {
        stopped = true;
        const record = budgetStoppedRecord(task, pass, runId);
        records.push(record);
        appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`);
        continue;
      }
      const record = await runTask(controller, orchestrator, task, pass, runId);
      spentSatang += record.costSatang;
      records.push(record);
      appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`);
      console.log(`[${pass}/${OPTS.repetitions}] ${task.id.padEnd(34)} ${record.outcome.padEnd(14)} `
        + `${record.success ? 'ok ' : 'BAD'} calls=${String(record.calls).padStart(2)} THB=${thb(record.costSatang).padStart(6)} `
        + `${record.latencyMs}ms  run=${thb(spentSatang)} route=${record.routedIntent ?? '-'}`);
    }
  }

  const summary = summarize(records);
  const accounting = promptAccounting(records);
  const meta = {
    runId,
    label: OPTS.label,
    gitRevision: gitRevision(),
    corpusHash: intakeCostCorpusHash(),
    modelId: ENV.bedrockModelId,
    documentModelId: ENV.documentAiModelId,
    region: ENV.bedrockRegion,
    capabilities: JSON.stringify(INTAKE_CAPABILITIES),
    prodFlags: JSON.stringify(PROD_FLAGS),
    thbPerUsd: OPTS.thbPerUsd,
    paceMs: OPTS.paceMs,
    repetitions: OPTS.repetitions,
    tasks: tasks.length,
    runCostThb: thb(spentSatang),
    priorLedgerThb: thb(priorSatang),
    cumulativeThb: thb(priorSatang + spentSatang),
    budgetStopped: stopped,
    startedAt: new Date().toISOString(),
  };

  writeFileSync(join(OPTS.out, `${runId}.summary.json`), `${JSON.stringify({ meta, summary, accounting }, null, 2)}\n`);
  writeFileSync(join(OPTS.out, `${runId}.md`), markdown(records, summary, accounting, meta));
  appendLedger(runId, spentSatang, records.reduce((total, r) => total + r.calls, 0));

  console.log(`\nrun cost THB ${thb(spentSatang)} | cumulative THB ${thb(priorSatang + spentSatang)}`);
  console.log(`outputs: ${jsonlPath}`);
  if (stopped) console.log('WARNING: run stopped on the --max-thb guard; remaining tasks recorded as budget_stopped.');
}

function budgetStoppedRecord(task: IntakeCostTask, pass: number, runId: string): TaskRecord {
  return {
    runId, label: OPTS.label, pass, taskId: task.id, kind: task.kind, coverage: task.coverage,
    outcome: 'budget_stopped', success: false, successReasons: ['run stopped on the spend guard'],
    preparedPlanPresent: false, advisorAnswerPresent: false, onePassReceiptPresent: false,
    expectedIntents: [...task.expect.intents], routingCorrect: false,
    permissionOutcome: task.expect.permissionOutcome, followOn: 'none',
    latencyMs: 0, wallClockMs: 0, calls: 0, costSatang: 0, usage: [], callShapes: [],
    toolInputs: [], resolvedPeriods: [],
  };
}

void main().catch((error: unknown) => {
  console.error('BENCHMARK_ERROR', (error as Error)?.stack ?? error);
  process.exit(1);
});
