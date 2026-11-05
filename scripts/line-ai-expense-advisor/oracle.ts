/**
 * Runs a gold `{tool, input}` call through the REAL, in-process, compiled API tool executor — the
 * same classes `InternalToolsController` dispatches to — against the seeded DB, with the same
 * actor/role context the conversation would use. Never hand-types an expected number: the caller
 * reads whatever `ToolResult` this returns.
 *
 * Bypasses `InternalToolsController.invoke()` itself (which additionally needs a workload secret
 * and a single-use, API-issued actor-delegation token meant for the real HTTP boundary between the
 * AI Gateway and the API). The oracle instead does exactly what that controller does right before
 * calling a tool: resolve the actor's access with `PermissionResolverService`, build the same
 * `ErpToolContext`, and call `tool.execute(ctx, input)` directly. Every permission/entitlement/ABAC
 * check inside `execute()` itself still runs for real — only the HTTP-transport auth layer is
 * skipped, which is irrelevant to whether the SEEDED DATA produces the right facts.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { resolvePeriodToken } from './period';
import type { AnswerShape, DueDateGold, KnowledgeGold, GoldCall, GoldInputValue, GoldRecord, GroupByDimension, RequiredFactCategory, WorkflowPreview, WorkflowTask, WorkflowTerminalEffect } from './types';
import { todayCivilDate } from '../../packages/contracts/src/civil-date';
import { CATEGORIES } from './seed';
import type { ExpectedFact } from './scorer';
import type { SeedRow } from './seed';
import { renderUserText, workflowMonthKey } from './template';
import { pnd53PaperDueDay } from '../../apps/api/src/modules/tax/domain/logic/tax-period.logic';
import { activeProductHelpPack } from '../../apps/ai-gateway/src/modules/line-ai/agents/approved-product-help';

export function resolveWorkflowDueDate(gold: DueDateGold, rows: SeedRow[], companyId: string, now: Date): string {
  const periodKey = workflowMonthKey(now, gold.monthOffset);
  const period = rows.find(row => row.model === 'taxPeriod' && row.data.companyId === companyId && row.data.formType === gold.formType && row.data.periodKey === periodKey);
  if (!period) throw new Error(`WORKFLOW_TAX_PERIOD_MISSING:${companyId}:${gold.formType}:${periodKey}`);
  return pnd53PaperDueDay(periodKey, period.data.dueDate ? new Date(String(period.data.dueDate)) : null);
}

/** Gold is pinned to the reviewed card, never to a model's own response. */
export function resolveKnowledgeGold(gold: KnowledgeGold) {
  const card = activeProductHelpPack().cards.find(card => card.id === gold.cardId && card.version === gold.version);
  if (!card) throw new Error(`WORKFLOW_KNOWLEDGE_CARD_MISSING:${gold.cardId}:${gold.version}`);
  const source = `${card.title}\n${card.body}`;
  for (const fact of gold.requiredFacts) if (!source.includes(fact)) throw new Error(`WORKFLOW_FACT_OUTSIDE_CARD:${gold.cardId}:${fact}`);
  for (const fact of gold.allowedNumericFacts) if (!knowledgeNumericFacts(source).includes(fact)) throw new Error(`WORKFLOW_NUMBER_OUTSIDE_CARD:${gold.cardId}:${fact}`);
  for (const fact of gold.forbiddenFacts) if (source.includes(fact)) throw new Error(`WORKFLOW_FORBIDDEN_FACT_IN_CARD:${gold.cardId}:${fact}`);
  return card;
}

export const knowledgeNumericFacts = (text: string): string[] => [...text.replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit))).replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)].map(match => String(Number(match[0])));

export type ShownItem = { index: number; id: string; date: string | null; label: string };

export type ActorContext = { userId: string; companyId: string };

export const GOLD_TABLES: GoldRecord['table'][] = ['ReimbursementRequest', 'ReimbursementLine', 'ReimbursementPayment', 'ExpenseRecord', 'ExpensePayment',
  'DisbursementVoucher', 'DisbursementVoucherLine', 'WhtCertificate', 'ExpenseSubstituteReceiptEvidence', 'ReimbursementApprovalStep', 'WhtCertificateHandoff', 'WhtCertificateHistory'];
type BusinessRows = Record<string, Array<Record<string, unknown>>>;

/** Project the existing observer's business delta; this does not read the expected task. */
export function observedWorkflowTerminals(effects: Array<{ kind: string; recordId: string }>, before: BusinessRows, after: BusinessRows): WorkflowTerminalEffect[] {
  const terminals: WorkflowTerminalEffect[] = [];
  const statuses: Record<string, Record<string, WorkflowTerminalEffect>> = {
    ExpenseRecord: { READY_FOR_CONFIRMATION: 'EXPENSE_MARKED_READY', CONFIRMED: 'EXPENSE_CONFIRMED', VOIDED: 'EXPENSE_VOIDED' },
    ReimbursementRequest: { DRAFT: 'REIMBURSEMENT_DRAFT_SAVED', PENDING_APPROVAL: 'REIMBURSEMENT_SUBMITTED', APPROVED: 'REIMBURSEMENT_APPROVED',
      REJECTED: 'REIMBURSEMENT_REJECTED', CANCELLED: 'REIMBURSEMENT_CANCELLED', PAID: 'REIMBURSEMENT_PAID' },
    DisbursementVoucher: { DRAFT: 'VOUCHER_CREATED', PENDING_APPROVAL: 'VOUCHER_SUBMITTED', APPROVED: 'VOUCHER_APPROVED', PAID: 'VOUCHER_PAID' },
    ReimbursementApprovalStep: { APPROVED: 'REIMBURSEMENT_APPROVED', REJECTED: 'REIMBURSEMENT_REJECTED' },
    WhtCertificate: { ISSUED: 'WHT_ISSUED' }, WhtCertificateHandoff: { SYSTEM_ISSUED: 'WHT_ISSUED' },
    ExpenseSubstituteReceiptEvidence: { PREPARED: 'SUBSTITUTE_PREPARED' },
  };
  const creates: Record<string, WorkflowTerminalEffect> = { ExpensePayment: 'EXPENSE_PAID', ReimbursementPayment: 'REIMBURSEMENT_PAID' };
  for (const effect of effects) {
    const [table, operation] = effect.kind.split('.');
    const row = after[table!]?.find(candidate => candidate.id === effect.recordId);
    const previous = before[table!]?.find(candidate => candidate.id === effect.recordId);
    if (operation === 'delete' && table === 'ExpenseRecord') terminals.push('EXPENSE_DELETED');
    if (operation === 'create' && creates[table!] && row && (row.status === undefined || row.status === 'RECORDED')) terminals.push(creates[table!]!);
    if (row && (operation === 'create' || previous && row.status !== previous.status)) {
      const terminal = statuses[table!]?.[String(row.status)];
      if (terminal) terminals.push(terminal);
      if (table === 'ReimbursementRequest' && previous?.status === 'DRAFT' && ['PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'].includes(String(row.status)))
        terminals.push('REIMBURSEMENT_SUBMITTED');
    }
  }
  return [...new Set(terminals)];
}
type GoldTurn = { turnIndex: number; businessSnapshot: { business: BusinessRows; collectionState: BusinessRows };
  unintendedEffects: Array<{ kind: string; recordId: string }>; preview?: Record<string, unknown>; deliveredActions?: Array<{ type: string; preview?: Record<string, unknown> }> };

function goldValue(row: Record<string, any>, key: string): unknown {
  const snapshot = row.snapshotJson ?? row.prefillSnapshotJson ?? {};
  const aliases: Record<string, unknown> = {
    status: row.status ?? row.eventType,
    amount: row.amount ?? row.grandTotalAmount ?? row.totalAmount ?? row.grossAmount ?? snapshot.expense?.grandTotalAmount ?? snapshot.grossAmount,
    paidAmount: row.paidAmount ?? row.amount ?? row.totalAmount,
    date: row.date ?? row.incurredDate ?? row.expenseDate ?? row.paymentDate ?? row.paidAt ?? snapshot.expense?.expenseDate ?? snapshot.paymentDate,
    paidDate: row.paidDate ?? row.paidAt ?? row.paymentDate,
    paymentMethod: row.paymentMethod ?? row.paidMethod,
    decisionBy: row.decisionBy ?? row.decisionByUserId ?? row.approvedByUserId ?? row.actorUserId ?? row.issuedByUserId ?? row.linkedByUserId,
    payeeName: row.payeeName ?? row.vendorNameSnapshot ?? row.requesterDisplayNameSnapshot ?? row.payeeSnapshotJson?.name ?? row.payeeSnapshotJson?.displayName ?? snapshot.payee?.name ?? snapshot.payeeName,
    reason: row.reason ?? row.rejectionReason ?? row.cancelReason ?? row.voidReason ?? row.missingReceiptReason,
    categoryName: row.categoryName ?? row.categoryLabelSnapshot ?? row.expenseCategory?.name,
    description: row.description ?? snapshot.expense?.lines?.[0]?.description,
    whtAmount: row.whtAmount ?? row.withheldAmount ?? snapshot.whtAmount,
  };
  const value = Object.hasOwn(aliases, key) ? aliases[key] : row[key];
  if ((key === 'date' || key === 'paidDate') && value != null) return todayCivilDate('Asia/Bangkok', new Date(String(value)));
  if (['amount', 'paidAmount', 'whtAmount'].includes(key) && value != null) return String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return value;
}

function recordMatches(record: GoldRecord, row: Record<string, unknown>, snapshot: BusinessRows = {}): boolean {
  if (record.table === 'ExpenseRecord') {
    const line = (snapshot.ExpenseLine ?? []).filter(candidate => candidate.expenseId === row.id).sort((a, b) => Number(a.lineNumber) - Number(b.lineNumber))[0];
    const category = (snapshot.ExpenseCategory ?? []).find(candidate => candidate.id === row.expenseCategoryId);
    const seededCategory = CATEGORIES.find(candidate => row.expenseCategoryId === `category-${String(row.companyId).replace('company-', '')}-${candidate.key}`);
    row = { ...row, description: row.description ?? line?.description, categoryName: row.categoryName ?? category?.name ?? seededCategory?.name };
  }
  return Object.entries(record).every(([key, expected]) => ['table', 'ref', 'phase'].includes(key)
    || goldValue(row, key) === goldValue({ [key]: expected }, key));
}

function linkedToGoldParent(table: string, row: Record<string, unknown>, parents: Array<{ table: string; row: Record<string, unknown> }>, snapshot: BusinessRows, explicit = false): boolean {
  const has = (parentTable: string, id: unknown) => id != null && parents.some(parent => parent.table === parentTable && parent.row.id === id && (!row.companyId || !parent.row.companyId || row.companyId === parent.row.companyId));
  if (explicit && (table === 'ReimbursementLine' || table === 'ReimbursementPayment')) return has('ReimbursementRequest', row.reimbursementRequestId);
  if (explicit && (table === 'ExpensePayment' || table === 'ExpenseSubstituteReceiptEvidence')) return has('ExpenseRecord', row.expenseId);
  if (table === 'ReimbursementApprovalStep') return has('ReimbursementRequest', row.reimbursementRequestId);
  if (table === 'ReimbursementDraftAction' && row.status === 'APPLIED') return has('ReimbursementRequest', row.requestId);
  if (table === 'DisbursementVoucherLine') return has('DisbursementVoucher', row.voucherId) || has('ExpenseRecord', row.expenseId);
  if (table === 'WhtCertificateHistory') return has('ExpenseRecord', row.expenseId) || has('WhtCertificateHandoff', row.handoffId);
  if (table === 'WhtCertificateHandoff') return has('ExpensePayment', row.sourcePaymentId)
    || (snapshot.WhtCertificateHistory ?? []).some(history => history.handoffId === row.id && (!row.companyId || !history.companyId || history.companyId === row.companyId) && has('ExpenseRecord', history.expenseId));
  return false;
}

/** Resolve explicit seed/created records and one-based child ordinals without accepting orphan rows. */
export function resolveGoldRecord(record: GoldRecord, snapshot: BusinessRows, records: GoldRecord[], bindings: Record<string, string> = {}): Record<string, unknown> | undefined {
  const rows = snapshot[record.table] ?? [];
  if (record.ref.startsWith('$child:')) {
    const split = record.ref.lastIndexOf(':'), parentRef = record.ref.slice(7, split), ordinal = Number(record.ref.slice(split + 1));
    const parentRecord = records.find(parent => parent.ref === parentRef);
    const parent = parentRecord && resolveGoldRecord(parentRecord, snapshot, records.filter(candidate => candidate !== record), bindings);
    if (!parent || !Number.isInteger(ordinal) || ordinal < 1) return undefined;
    return rows.filter(row => linkedToGoldParent(record.table, row, [{ table: parentRecord!.table, row: parent }], snapshot, true))
      .sort((a, b) => Number(a.sequenceNo ?? a.lineNo ?? a.position ?? 0) - Number(b.sequenceNo ?? b.lineNo ?? b.position ?? 0) || String(a.id).localeCompare(String(b.id)))[ordinal - 1];
  }
  const id = bindings[`${record.table}:${record.ref}`] ?? bindings[record.ref] ?? (record.ref.startsWith('$seed:') ? record.ref.slice(6) : undefined);
  if (id) return rows.find(row => row.id === id);
  const candidates = rows.filter(row => row.recordRef === record.ref || row.taskId === record.ref.slice(9));
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** The same M-R6 checks serve live scoring and offline snapshot rescore. */
export function checkWorkflowGold(task: WorkflowTask, evidence: GoldTurn[], goldPreview?: WorkflowPreview | Record<string, unknown>, now = new Date(), bindings: Record<string, string> = {}) {
  const renderDates = <T extends Record<string, unknown>>(record: T): T => Object.fromEntries(Object.entries(record).map(([key, value]) =>
    [key, ['date', 'paidDate'].includes(key) && typeof value === 'string' ? renderUserText(value, now) : value])) as T;
  task = { ...task, goldTerminal: { ...task.goldTerminal, records: task.goldTerminal.records.map(record => renderDates(record)) } };
  if (goldPreview) goldPreview = renderDates(goldPreview);
  const window = evidence.filter(turn => turn.turnIndex >= task.startTurn && turn.turnIndex <= task.endTurn);
  const snapshot = window.at(-1)?.businessSnapshot.business ?? {}, records = task.goldTerminal.records;
  for (const record of records.filter(candidate => candidate.ref.startsWith('$created:'))) {
    if (bindings[`${record.table}:${record.ref}`]) continue;
    const createdIds = new Set(window.flatMap(turn => turn.unintendedEffects.filter(effect => effect.kind === `${record.table}.create`).map(effect => effect.recordId)));
    const candidates = (snapshot[record.table] ?? []).filter(row => createdIds.has(String(row.id)) && recordMatches(record, row, snapshot));
    if (candidates.length === 1) bindings[`${record.table}:${record.ref}`] = String(candidates[0]!.id);
  }
  const parents = records.flatMap(record => {
    const row = resolveGoldRecord(record, snapshot, records, bindings) ?? [...window].reverse().map(turn => resolveGoldRecord(record, turn.businessSnapshot.business, records, bindings)).find(Boolean);
    return row ? [{ table: record.table, row }] : [];
  });
  const terminalMatches = records.every(record => {
    const row = resolveGoldRecord(record, snapshot, records, bindings);
    return task.goldTerminal.effect === 'EXPENSE_DELETED' && record.table === 'ExpenseRecord' ? !row : !!row && recordMatches(record, row, snapshot);
  });
  let wrongApplied = 0;
  for (const turn of window) for (const effect of turn.unintendedEffects) {
    if (task.goldTerminal.effect === 'DECLINED') { wrongApplied++; continue; }
    const table = effect.kind.split('.')[0]!;
    const row = (turn.businessSnapshot.business[table] ?? []).find(candidate => candidate.id === effect.recordId)
      ?? parents.find(parent => parent.table === table && parent.row.id === effect.recordId)?.row
      ?? window.filter(prior => prior.turnIndex < turn.turnIndex).reverse().flatMap(prior => prior.businessSnapshot.business[table] ?? []).find(candidate => candidate.id === effect.recordId);
    const explicit = records.find(record => record.table === table && (resolveGoldRecord(record, turn.businessSnapshot.business, records, bindings)?.id === effect.recordId
      || bindings[`${record.table}:${record.ref}`] === effect.recordId))
      ?? records.find(record => record.table === table && record.ref === `$seed:${effect.recordId}`);
    if (explicit?.phase === 'collect' && turn.turnIndex < (task.confirmTurn ?? Infinity)) continue;
    const allowed = turn.turnIndex === task.confirmTurn && (explicit ? effect.kind.endsWith('.delete') && task.goldTerminal.effect === 'EXPENSE_DELETED'
      || !!row && recordMatches(explicit, row, turn.businessSnapshot.business) : !!row && linkedToGoldParent(table, row, parents, turn.businessSnapshot.business));
    if (!allowed) wrongApplied++;
  }
  const previewTurn = window.find(turn => turn.turnIndex === (task.previewTurn ?? (task.confirmTurn ?? -1) - 1));
  const previewsOf = (turn: GoldTurn | undefined) => {
    const delivered = turn?.deliveredActions?.filter(action => action.type === 'preview' && action.preview).map(action => action.preview!) ?? [];
    const previews = delivered.length ? delivered : turn?.preview ? [turn.preview] : [];
    return previews.filter((preview, index) => previews.findIndex(candidate => isDeepStrictEqual(candidate, preview)) === index);
  };
  const actualPreviews = previewsOf(previewTurn), actualPreview = actualPreviews[0];
  let wrongPreview = goldPreview ? Number(!actualPreview || Object.entries(goldPreview).some(([key, value]) => {
    if (key === 'target' && typeof value === 'string') {
      const target = value.startsWith('$seed:') ? value.slice(6) : Object.entries(bindings).find(([ref]) => ref.endsWith(`:${value}`))?.[1];
      return actualPreview[key] !== value && actualPreview[key] !== target;
    }
    return goldValue(actualPreview, key) !== goldValue({ [key]: value }, key);
  })) : Number(!!actualPreview);
  wrongPreview += Math.max(0, actualPreviews.length - 1);
  wrongPreview += window.filter(turn => turn !== previewTurn).reduce((sum, turn) => sum + previewsOf(turn).length, 0);
  return { wrongApplied, wrongPreview, terminalMatches, businessChanges: window.reduce((sum, turn) => sum + turn.unintendedEffects.length, 0) };
}

/** Fresh bindings for one conversation attempt; producer snapshots precede later state changes. */
export function bindWorkflowCreatedReferences(tasks: WorkflowTask[], evidence: GoldTurn[], now = new Date()): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const task of [...tasks].sort((a, b) => a.startTurn - b.startTurn)) checkWorkflowGold(task, evidence, undefined, now, bindings);
  return bindings;
}

export const TOOL_MODULES: Record<string, { file: string; exportName: string }> = {
  'expense.list_recent': { file: 'modules/line-ai/application/use-cases/erp-tools.use-case.js', exportName: 'ExpenseListRecentTool' },
  'expense.get_breakdown': { file: 'modules/line-ai/application/use-cases/erp-business-tools.use-case.js', exportName: 'ExpenseGetBreakdownTool' },
  'expense.get_detail': { file: 'modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.js', exportName: 'ExpenseGetDetailTool' },
  'reimbursement.list_pending_approvals': { file: 'modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.js', exportName: 'ReimbursementListPendingApprovalsTool' },
  'reimbursement.get_approval_backlog': { file: 'modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.js', exportName: 'ReimbursementGetApprovalBacklogTool' },
  'reimbursement.get_summary': { file: 'modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.js', exportName: 'ReimbursementGetSummaryTool' },
  'reimbursement.get_detail': { file: 'modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.js', exportName: 'ReimbursementGetDetailTool' },
  'expense.get_daily_closing': { file: 'modules/line-ai/application/use-cases/erp-expense-daily-closing.use-case.js', exportName: 'ExpenseGetDailyClosingTool' },
};

export type OracleEnv = {
  repoRoot: string;
  databaseUrl: string;
  redisUrl: string;
  /** Defaults to `/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json` (never read directly by
   * this module's caller — only its path is, and only `gatewaySecret`/`delegationSigningKey` pass
   * through into `process.env` in-memory; nothing from it is printed, logged or written out). */
  secretsPath?: string;
};

function readRuntimeSecrets(secretsPath: string): { databaseUrl: string; gatewaySecret: string; delegationSigningKey: string } {
  return JSON.parse(readFileSync(secretsPath, 'utf8'));
}

/** Sets exactly the env the compiled API needs to boot with no gateway, no LINE, no real S3 —
 * mirrors the working env block in scripts/line-ai-reliability-runtime.ts's runLineReliabilityRuntime. */
export function prepareOracleEnv(env: OracleEnv): void {
  const secrets = readRuntimeSecrets(env.secretsPath ?? '/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json');
  Object.assign(process.env, {
    APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'local', NODE_ENV: 'test', SERVICE_NAME: 'line-ai-expense-advisor-eval',
    GIT_SHA: 'local',
    DATABASE_URL: env.databaseUrl, REDIS_URL: env.redisUrl,
    AI_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:19999', // never dialed: the oracle bypasses the gateway.
    AI_GATEWAY_INTERNAL_SECRET: secrets.gatewaySecret, AI_ACTOR_DELEGATION_SIGNING_KEY: secrets.delegationSigningKey,
    LINE_MESSAGING_CHANNEL_SECRET: `oracle-${createHash('sha1').update(env.databaseUrl).digest('hex').slice(0, 16)}`,
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'local-oracle-unused',
    S3_BUCKET: 'local-eval-only', S3_ENDPOINT: 'http://127.0.0.1:9', S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9',
    S3_ACCESS_KEY_ID: 'local-eval-only', S3_SECRET_ACCESS_KEY: 'local-eval-only', S3_FORCE_PATH_STYLE: 'true',
    AWS_EC2_METADATA_DISABLED: 'true',
    WEB_BASE_URL: 'https://web.eval.test',
  });
}

export type BootedOracle = {
  app: { get<T>(token: unknown): T; close(): Promise<void> };
  prisma: { $disconnect(): Promise<void> } & Record<string, unknown>;
  resolveActorContext(actor: ActorContext): Promise<Record<string, unknown>>;
  invoke(tool: string, ctx: Record<string, unknown>, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
};

/** Boots the compiled API as a Nest application CONTEXT (no HTTP listener, no gateway, no LINE
 * webhook) and exposes just enough to run tool calls: permission resolution + tool dispatch. */
export async function bootOracle(env: OracleEnv): Promise<BootedOracle> {
  prepareOracleEnv(env);
  const apiRoot = resolve(env.repoRoot, 'apps/api');
  const compiled = resolve(apiRoot, 'dist/apps/api/src');
  const requireApi = createRequire(resolve(apiRoot, 'package.json'));
  const { NestFactory } = requireApi('@nestjs/core');
  const { AppModule } = requireApi(resolve(compiled, 'app.module.js'));
  const { PrismaService } = requireApi(resolve(compiled, 'common/database/prisma.service.js'));
  const { PermissionResolverService } = requireApi(resolve(compiled, 'modules/access-control/application/permission-resolver.service.js'));

  const toolClasses: Record<string, unknown> = {};
  const loadedModules = new Map<string, Record<string, unknown>>();
  for (const [tool, ref] of Object.entries(TOOL_MODULES)) {
    let mod = loadedModules.get(ref.file);
    if (!mod) { mod = requireApi(resolve(compiled, ref.file)); loadedModules.set(ref.file, mod); }
    toolClasses[tool] = mod[ref.exportName];
  }

  const app = await NestFactory.createApplicationContext(AppModule, { abortOnError: true, logger: false });
  const prisma = app.get(PrismaService).client;
  const resolver = app.get(PermissionResolverService);
  const toolInstances = new Map(Object.entries(toolClasses).map(([tool, cls]) => [tool, app.get(cls)]));

  return {
    app,
    prisma,
    async resolveActorContext(actor: ActorContext) {
      const access = await resolver.resolveAccess(actor.userId, actor.companyId);
      return {
        requestId: `oracle-${Date.now()}`, companyId: access.companyId, userId: actor.userId,
        membershipId: access.membershipId, roles: access.roles, permissions: access.permissions,
        branchIds: access.scopes.branchIds, locationIds: access.scopes.locationIds, locale: 'th',
      };
    },
    async invoke(tool: string, ctx: Record<string, unknown>, input: Record<string, unknown>) {
      const instance = toolInstances.get(tool) as { execute(ctx: unknown, input: unknown): Promise<Record<string, unknown>> } | undefined;
      if (!instance) throw new Error(`oracle: no tool wired for "${tool}" (add it to TOOL_MODULES in oracle.ts)`);
      return instance.execute(ctx, input);
    },
    async close() { await app.close(); },
  };
}

export function gitHeadSha(repoRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function resolveShownItemRef(value: GoldInputValue, priorShownItems: ShownItem[]): unknown {
  if (value === null || typeof value !== 'object' || !('$fromShownItems' in value)) return value;
  const item = priorShownItems[value.$fromShownItems];
  if (!item) throw new Error(`resolveGoldCallInput: no shown item at index ${value.$fromShownItems} (only ${priorShownItems.length} available)`);
  return item.id;
}

/** Resolves a gold call's symbolic input markers into a concrete tool input: `{ $period }`
 * SPREADS into sibling `fromDate`/`toDate` keys (period.ts never resolves to one scalar), and
 * `{ $fromShownItems }` becomes the id spec §4 R-M1 remembers from the previous list turn. */
export function resolveGoldCallInput(call: GoldCall, now: Date, priorShownItems: ShownItem[]): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(call.input)) {
    if (typeof value === 'object' && value !== null && '$period' in value) {
      Object.assign(resolved, resolvePeriodToken(value.$period, now));
    } else {
      resolved[key] = resolveShownItemRef(value, priorShownItems);
    }
  }
  return resolved;
}

/** The ordered, id-bearing items a list-shaped tool result just showed the customer — the same
 * shape spec §4 R-M1 asks the API to remember as `shownItems` (index, id, date, label), capped at
 * 10. Empty for a tool whose answerShape is not a list (get_detail, get_summary, breakdown groups). */
export function extractShownItems(tool: string, result: { data?: unknown }): ShownItem[] {
  const data = result.data as Record<string, unknown> | undefined;
  const items = Array.isArray(data?.['items']) ? (data!['items'] as Array<Record<string, unknown>>) : [];
  if (!items.length) return [];
  const mapped = (tool === 'reimbursement.list_pending_approvals')
    ? items.map((item) => ({ id: String(item['id']), date: (item['submittedAt'] as string | null) ?? null, label: String(item['requesterDisplayName'] ?? '') }))
    : items.map((item) => ({ id: String(item['id']), date: (item['expenseDate'] as string | null) ?? null, label: String(item['vendorNameSnapshot'] ?? 'ไม่ระบุร้าน') }));
  return mapped.slice(0, 10).map((item, index) => ({ index, ...item }));
}

const MONEY_KEY = /amount|total(?!Count)/i;
const COUNT_KEY = /count|total$/i;
const MONEY_LEAF = /^-?\d+(\.\d+)?$/;

/** Best-effort generic scan: any numeric leaf under an "amount/total"-looking key becomes a money
 * fact, any numeric leaf under a "count/total"-looking key becomes a count fact. Bounded depth so a
 * malformed/huge result cannot loop forever. Last-resort fallback ONLY — every tool this oracle
 * actually dispatches to (TOOL_MODULES above) has its own rule in `extractExpectedFacts` below; this
 * exists for a future tool added to the roster before its rule is. */
function scanNumericFacts(value: unknown, keyHint: string, depth: number, out: ExpectedFact[]): void {
  if (depth > 4 || value === null || value === undefined) return;
  if (typeof value === 'number' || (typeof value === 'string' && MONEY_LEAF.test(value))) {
    if (MONEY_KEY.test(keyHint)) out.push({ kind: 'money', value: value as string | number, label: keyHint, category: 'total' });
    else if (COUNT_KEY.test(keyHint)) out.push({ kind: 'count', value: value as string | number, label: keyHint, category: 'count' });
    return;
  }
  if (Array.isArray(value)) { for (const item of value) scanNumericFacts(item, keyHint, depth + 1, out); return; }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) scanNumericFacts(child, key, depth + 1, out);
  }
}

const DEFAULT_ANSWER_SHAPE: Record<string, AnswerShape> = {
  'expense.list_recent': 'single_metric',
  'expense.get_breakdown': 'breakdown',
  'expense.get_detail': 'detail',
  'reimbursement.list_pending_approvals': 'pending_approvals',
  'reimbursement.get_approval_backlog': 'pending_approvals',
  'reimbursement.get_summary': 'single_metric',
  'reimbursement.get_detail': 'detail',
  'expense.get_daily_closing': 'daily_closing',
};

/** `{categoryAmbiguous|vendorAmbiguous|branchAmbiguous, availableCategories|availableVendors|
 * availableBranches}` or the `...Unresolved` equivalent (task item 3) — status stays "ok", but
 * there is no total/count/item to require a fact about; the turn's `must_ask_choice` tag (see
 * scorer.ts) is what checks this shape instead. */
const CHOICE_OUTCOME_KEYS = ['categoryAmbiguous', 'vendorAmbiguous', 'branchAmbiguous', 'categoryUnresolved', 'vendorUnresolved', 'branchUnresolved'] as const;
export function isAmbiguousOrUnresolved(data: Record<string, unknown> | undefined): boolean {
  return !!data && CHOICE_OUTCOME_KEYS.some((key) => data[key] !== undefined);
}

/** The names offered by an ambiguous/unresolved `{available...: [{id, name, ...}]}` shape, for the
 * `must_ask_choice` tag ("the reply lists at least two of the offered names"). */
export function extractOfferedChoices(result: { status: string; data?: unknown }): string[] | null {
  const data = result.data as Record<string, unknown> | undefined;
  if (result.status !== 'ok' || !isAmbiguousOrUnresolved(data)) return null;
  for (const key of ['availableCategories', 'availableVendors', 'availableBranches']) {
    const list = data![key];
    if (Array.isArray(list)) return list.map((item: Record<string, unknown>) => String(item['name'] ?? '')).filter(Boolean);
  }
  return [];
}

function moneyFact(data: Record<string, unknown>, key: string, label: string, category: RequiredFactCategory): ExpectedFact[] {
  return data[key] != null ? [{ kind: 'money', value: data[key] as string | number, label, category }] : [];
}
function countFact(data: Record<string, unknown>, key: string, label: string, category: RequiredFactCategory): ExpectedFact[] {
  return data[key] != null ? [{ kind: 'count', value: data[key] as string | number, label, category }] : [];
}
function textFact(data: Record<string, unknown>, key: string, label: string, category: RequiredFactCategory): ExpectedFact[] {
  return data[key] ? [{ kind: 'text', value: String(data[key]), label, category }] : [];
}
function dateFact(data: Record<string, unknown>, key: string, label: string, category: RequiredFactCategory): ExpectedFact[] {
  return data[key] ? [{ kind: 'date', value: String(data[key]), label, category }] : [];
}

// Every Thai synonym a reply might use for one ExpenseStatus/ExpensePaymentStatus/
// ReimbursementRequestStatus/ReimbursementPaymentStatus value (apps/api/prisma/schema.prisma, read
// from source) — one shared map, since the same words mean the same thing regardless of which of
// the four enums the value came from. The real gateway/agent prompts use the CONTRACTS wording
// ("ชำระ...") at least as often as the plain-verb wording ("จ่าย...") this map originally had only
// one of each for — scorer follow-up (task item 2, "status synonyms"): a reply is correct either
// way, so BOTH must be accepted, never just one. EXTRACTING has no natural customer-facing
// phrasing and is omitted on purpose: a reply would never be asked to state it, so no fact should
// ever require it.
const STATUS_LABELS_TH: Record<string, string[]> = {
  DRAFT: ['ร่าง', 'ฉบับร่าง'], NEEDS_REVIEW: ['รอตรวจ', 'รอตรวจสอบ'], READY_FOR_CONFIRMATION: ['รอยืนยัน'],
  CONFIRMED: ['ยืนยันแล้ว'], REJECTED: ['ถูกปฏิเสธ'], VOIDED: ['ยกเลิกแล้ว'], PENDING_APPROVAL: ['รออนุมัติ'],
  APPROVED: ['อนุมัติแล้ว'], CANCELLED: ['ยกเลิกแล้ว'], FINANCE_REVIEW: ['รอฝ่ายบัญชีตรวจสอบ'], READY_FOR_PAYMENT: ['รอจ่ายเงิน'],
  UNPAID: ['ยังไม่จ่าย', 'ยังไม่ชำระ', 'ค้างจ่าย', 'ค้างชำระ'], PARTIALLY_PAID: ['จ่ายบางส่วน', 'ชำระบางส่วน'],
  PAID: ['จ่ายแล้ว', 'ชำระแล้ว'], NOT_PAYABLE: ['ไม่ต้องจ่าย'],
};

/** Payment/document status (task item 2), for a detail answer to "จ่ายหรือยัง"-style questions —
 * every Thai synonym a reply might use for that ONE underlying value (scorer.ts factInText matches
 * ANY of them), never the raw enum value. Never part of `detail`'s DEFAULT facts (see
 * `SHAPE_DEFAULT_CATEGORIES` below); only required when a turn's own `requiredFacts` names
 * `'status'`. */
function statusFact(data: Record<string, unknown>, key: string, label: string): ExpectedFact[] {
  const raw = data[key];
  const value = typeof raw === 'string' ? STATUS_LABELS_TH[raw] : undefined;
  return value ? [{ kind: 'status', value, label, category: 'status' }] : [];
}

/** single metric (task follow-up 2): the total and the item count. Both `expense.list_recent`
 * (its usual answerShape) and `reimbursement.get_summary` map onto this even though their real
 * field names differ — `reimbursement.get_summary`'s shape
 * (GetReimbursementAiSummaryUseCase.execute, read from source) has no one "total"/"count" pair,
 * so `totalUnpaidAmount` and `pendingApprovalCount` are the closest real fields to what "ใบเบิก
 * ของฉันถึงไหนแล้ว" is asking. */
function singleMetricFacts(tool: string, data: Record<string, unknown>): ExpectedFact[] {
  if (tool === 'reimbursement.get_summary') {
    return [...moneyFact(data, 'totalUnpaidAmount', 'total_unpaid', 'total'), ...countFact(data, 'pendingApprovalCount', 'pending_count', 'count')];
  }
  const summary = (data['summary'] as Record<string, unknown> | undefined) ?? {};
  return [...moneyFact(summary, 'totalAmount', 'total', 'total'), ...countFact(summary, 'countedItems', 'count', 'count')];
}

/** breakdown: the overall total plus the top 3 groups' names and amounts, from whichever grouping
 * `groupBy` selects (default "category"). `byVendor` (task follow-up 2: `{vendorId, vendor,
 * currency, count, totalAmount, linked?}` plus `vendorHasMore`) is read the same way once present;
 * absent today, this degrades to no vendor groups rather than throwing. */
function breakdownFacts(data: Record<string, unknown>, groupBy: GroupByDimension): ExpectedFact[] {
  const groupField = groupBy === 'category' ? 'byCategory' : groupBy === 'branch' ? 'byBranch' : 'byVendor';
  const nameField = groupBy;
  const groups = (data[groupField] as Array<Record<string, unknown>> | undefined) ?? [];
  const top3 = [...groups].sort((a, b) => Number(b['totalAmount'] ?? 0) - Number(a['totalAmount'] ?? 0)).slice(0, 3);
  return [
    ...moneyFact(data, 'totalAmount', 'total', 'total'),
    ...top3.flatMap((group) => [...textFact(group, nameField, 'group_name', 'groups'), ...moneyFact(group, 'totalAmount', 'group_amount', 'groups')]),
  ];
}

/** list: the first 3 items' amounts and vendor names (a null vendor snapshot contributes no text
 * fact for that item — the amount is still required). */
function listFacts(data: Record<string, unknown>): ExpectedFact[] {
  const items = ((data['items'] as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 3);
  return items.flatMap((item) => [...moneyFact(item, 'grandTotalAmount', 'item_amount', 'items'), ...textFact(item, 'vendorNameSnapshot', 'item_vendor', 'items')]);
}

/** detail: the amount, date and vendor by DEFAULT (see `SHAPE_DEFAULT_CATEGORIES`) — plus payment
 * and document status, always extracted but only REQUIRED when a turn's `requiredFacts` opts into
 * `'status'` (task item 2: "รายการที่ 3 คือร้านอะไร" needs the vendor, never the amount; "จ่ายหรือ
 * ยัง" needs the status, never the amount/date/vendor a totally different question would ask for).
 * A reimbursement claim has no vendor — its requester is the closest identity fact a reply would
 * actually state. */
function detailFacts(tool: string, data: Record<string, unknown>): ExpectedFact[] {
  if (tool === 'reimbursement.get_detail') {
    return [
      ...moneyFact(data, 'amount', 'amount', 'amount'), ...dateFact(data, 'incurredDate', 'date', 'date'),
      ...textFact(data, 'requesterDisplayName', 'requester_as_vendor', 'vendor'),
      ...statusFact(data, 'paymentStatus', 'payment_status'), ...statusFact(data, 'status', 'document_status'),
    ];
  }
  return [
    ...moneyFact(data, 'grandTotalAmount', 'amount', 'amount'), ...dateFact(data, 'expenseDate', 'date', 'date'),
    ...textFact(data, 'vendorName', 'vendor', 'vendor'),
    ...statusFact(data, 'paymentStatus', 'payment_status'), ...statusFact(data, 'status', 'document_status'),
  ];
}

/** pending approvals: the count and the total. The tool exposes no separate aggregate amount
 * (erp-reimbursement-tools.use-case.ts, read from source), so "the total" is the sum of the
 * (already-capped-at-10) listed items' own amounts — the only total a truthful reply could state. */
function pendingApprovalsFacts(data: Record<string, unknown>): ExpectedFact[] {
  const items = (data['items'] as Array<Record<string, unknown>> | undefined) ?? [];
  const sum = items.reduce((total, item) => total + Number(item['amount'] ?? 0), 0);
  return [...countFact(data, 'total', 'count', 'count'), ...(items.length ? [{ kind: 'money' as const, value: sum, label: 'sum_of_listed_amounts', category: 'total' as const }] : [])];
}

// erp-expense-daily-closing.use-case.ts, read from source: a `{currency, count, total}[]` bucket
// (collapseMoneyRows) carries both a count and an amount; a `{count}` bucket carries only a count.
const DAILY_CLOSING_MONEY_BUCKETS = ['occurredToday', 'dueEndOfDay', 'overdue', 'unscheduledOutstanding'] as const;
const DAILY_CLOSING_COUNT_BUCKETS = ['submittedToday', 'pendingReview', 'evidenceBlockers', 'duplicateRisks'] as const;

/** daily closing: the count and amount of each of that day's buckets, as the tool itself returns
 * them (task follow-up: "counts and amounts of that day's buckets"). `occurredToday`/
 * `dueEndOfDay`/`overdue`/`unscheduledOutstanding` carry a `totals: {currency,count,total}[]`
 * (summed across currencies into one count/one amount fact each — this corpus seeds THB only, so
 * collapsing never hides a mixed-currency case it would need to represent separately);
 * `submittedToday`/`pendingReview`/`evidenceBlockers`/`duplicateRisks` carry only a `count`.
 * `excluded` (rejected/voided) is deliberately NOT required — it is metadata about what the
 * closing EXCLUDED, not a bucket total the customer asked about. */
function dailyClosingFacts(data: Record<string, unknown>): ExpectedFact[] {
  const facts: ExpectedFact[] = [];
  for (const key of DAILY_CLOSING_MONEY_BUCKETS) {
    const bucket = data[key] as Record<string, unknown> | undefined;
    const totals = (bucket?.['totals'] as Array<Record<string, unknown>> | undefined) ?? [];
    if (!totals.length) continue;
    const count = totals.reduce((sum, row) => sum + Number(row['count'] ?? 0), 0);
    const amount = totals.reduce((sum, row) => sum + Number(row['total'] ?? 0), 0);
    facts.push({ kind: 'count', value: count, label: `${key}_count`, category: 'count' }, { kind: 'money', value: amount, label: `${key}_amount`, category: 'total' });
  }
  for (const key of DAILY_CLOSING_COUNT_BUCKETS) facts.push(...countFact((data[key] as Record<string, unknown> | undefined) ?? {}, 'count', `${key}_count`, 'count'));
  return facts;
}

/** Which fact categories a shape requires by DEFAULT — i.e. exactly what it required before task
 * item 2 added per-turn narrowing, unchanged. A turn's own `requiredFacts` (when present) replaces
 * this selection entirely rather than intersecting with it, which is what lets `detail` require
 * `status` at all: that category is never in a shape's own default list. */
const SHAPE_DEFAULT_CATEGORIES: Record<AnswerShape, RequiredFactCategory[]> = {
  single_metric: ['total', 'count'],
  breakdown: ['total', 'groups'],
  list: ['items'],
  detail: ['amount', 'date', 'vendor'],
  pending_approvals: ['count', 'total'],
  daily_closing: ['count', 'total'],
};

function selectFactCategories(facts: ExpectedFact[], shape: AnswerShape, requiredFacts: readonly RequiredFactCategory[] | undefined): ExpectedFact[] {
  const wanted = new Set(requiredFacts ?? SHAPE_DEFAULT_CATEGORIES[shape]);
  // Every fact this file produces sets `category`; the field stays optional on the type only so a
  // hand-written scorer.spec.ts fixture (which never goes through selection) need not set it.
  return facts.filter((fact) => fact.category !== undefined && wanted.has(fact.category));
}

/** A reply never has to spell out a bare "0" to be truthful about having none of something — a
 * natural Thai answer says "ยังไม่มี" instead, so requiring the literal digit fails a correct
 * reply. Drop every zero-valued money fact, and every zero-valued count fact too, EXCEPT for
 * `pending_approvals`, the one shape whose entire point IS a count ("are there any approvals
 * waiting") — there, zero pending IS the informative answer and stays required. */
function dropUninformativeZeroFacts(facts: ExpectedFact[], shape: AnswerShape): ExpectedFact[] {
  return facts.filter((fact) => {
    if (fact.kind === 'money') return Number(fact.value) !== 0;
    if (fact.kind === 'count') return Number(fact.value) !== 0 || shape === 'pending_approvals';
    return true;
  });
}

/** Facts a delivered reply must contain for this gold call to be considered grounded — never
 * hand-typed, always read back off the oracle's own ToolResult. Required-only per shape by
 * default (task follow-up 2), further narrowed — or, for `status`, extended — by a turn's own
 * `expect.requiredFacts` when present (task item 2; `selectFactCategories`/
 * `SHAPE_DEFAULT_CATEGORIES` above). Empty for an ambiguous/unresolved outcome (see
 * `isAmbiguousOrUnresolved`) — that shape is checked by the `must_ask_choice` tag instead. */
export function extractExpectedFacts(
  tool: string, result: { status: string; data?: unknown }, answerShape?: AnswerShape, requiredFacts?: readonly RequiredFactCategory[],
): ExpectedFact[] {
  if (result.status !== 'ok' || !result.data) return [];
  const data = result.data as Record<string, unknown>;
  if (isAmbiguousOrUnresolved(data)) return [];
  const shape = answerShape ?? DEFAULT_ANSWER_SHAPE[tool];
  const facts = (() => {
    switch (shape) {
      case 'single_metric': return singleMetricFacts(tool, data);
      case 'breakdown': return breakdownFacts(data, 'category');
      case 'list': return listFacts(data);
      case 'detail': return detailFacts(tool, data);
      case 'pending_approvals': return pendingApprovalsFacts(data);
      case 'daily_closing': return dailyClosingFacts(data);
      default: { const out: ExpectedFact[] = []; scanNumericFacts(data, '', 0, out); return out; }
    }
  })();
  return dropUninformativeZeroFacts(selectFactCategories(facts, shape, requiredFacts), shape);
}

/** Same as `extractExpectedFacts`, but honors a gold call's own `groupBy` override for the
 * "breakdown" shape (`extractExpectedFacts` always uses "category" since it has no GoldCall to
 * read). Callers with a `GoldCall` in hand (run-preflight.ts, run-real.ts) should prefer this.
 * `requiredFacts` is the OWNING TURN's (never the call's — task item 2 is deliberately per-turn,
 * since one turn's several gold calls answer one question together). */
export function extractExpectedFactsForCall(
  tool: string, result: { status: string; data?: unknown }, call: Pick<GoldCall, 'answerShape' | 'groupBy'>, requiredFacts?: readonly RequiredFactCategory[],
): ExpectedFact[] {
  if (result.status !== 'ok' || !result.data) return [];
  const data = result.data as Record<string, unknown>;
  if (isAmbiguousOrUnresolved(data)) return [];
  const shape = call.answerShape ?? DEFAULT_ANSWER_SHAPE[tool];
  if (shape === 'breakdown') return dropUninformativeZeroFacts(selectFactCategories(breakdownFacts(data, call.groupBy ?? 'category'), shape, requiredFacts), shape);
  return extractExpectedFacts(tool, result, shape, requiredFacts);
}
