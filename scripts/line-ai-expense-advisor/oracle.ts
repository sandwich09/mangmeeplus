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
import { resolvePeriodToken } from './period';
import type { AnswerShape, GoldCall, GoldInputValue, GroupByDimension } from './types';
import type { ExpectedFact } from './scorer';

export type ShownItem = { index: number; id: string; date: string | null; label: string };

export type ActorContext = { userId: string; companyId: string };

const TOOL_MODULES: Record<string, { file: string; exportName: string }> = {
  'expense.list_recent': { file: 'modules/line-ai/application/use-cases/erp-tools.use-case.js', exportName: 'ExpenseListRecentTool' },
  'expense.get_breakdown': { file: 'modules/line-ai/application/use-cases/erp-business-tools.use-case.js', exportName: 'ExpenseGetBreakdownTool' },
  'expense.get_detail': { file: 'modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.js', exportName: 'ExpenseGetDetailTool' },
  'reimbursement.list_pending_approvals': { file: 'modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.js', exportName: 'ReimbursementListPendingApprovalsTool' },
  'reimbursement.get_summary': { file: 'modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.js', exportName: 'ReimbursementGetSummaryTool' },
  'reimbursement.get_detail': { file: 'modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.js', exportName: 'ReimbursementGetDetailTool' },
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
    if (MONEY_KEY.test(keyHint)) out.push({ kind: 'money', value: value as string | number, label: keyHint });
    else if (COUNT_KEY.test(keyHint)) out.push({ kind: 'count', value: value as string | number, label: keyHint });
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
  'reimbursement.get_summary': 'single_metric',
  'reimbursement.get_detail': 'detail',
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

function moneyFact(data: Record<string, unknown>, key: string, label: string): ExpectedFact[] {
  return data[key] != null ? [{ kind: 'money', value: data[key] as string | number, label }] : [];
}
function countFact(data: Record<string, unknown>, key: string, label: string): ExpectedFact[] {
  return data[key] != null ? [{ kind: 'count', value: data[key] as string | number, label }] : [];
}
function textFact(data: Record<string, unknown>, key: string, label: string): ExpectedFact[] {
  return data[key] ? [{ kind: 'text', value: String(data[key]), label }] : [];
}
function dateFact(data: Record<string, unknown>, key: string, label: string): ExpectedFact[] {
  return data[key] ? [{ kind: 'date', value: String(data[key]), label }] : [];
}

/** single metric (task follow-up 2): the total and the item count. Both `expense.list_recent`
 * (its usual answerShape) and `reimbursement.get_summary` map onto this even though their real
 * field names differ — `reimbursement.get_summary`'s shape
 * (GetReimbursementAiSummaryUseCase.execute, read from source) has no one "total"/"count" pair,
 * so `totalUnpaidAmount` and `pendingApprovalCount` are the closest real fields to what "ใบเบิก
 * ของฉันถึงไหนแล้ว" is asking. */
function singleMetricFacts(tool: string, data: Record<string, unknown>): ExpectedFact[] {
  if (tool === 'reimbursement.get_summary') {
    return [...moneyFact(data, 'totalUnpaidAmount', 'total_unpaid'), ...countFact(data, 'pendingApprovalCount', 'pending_count')];
  }
  const summary = (data['summary'] as Record<string, unknown> | undefined) ?? {};
  return [...moneyFact(summary, 'totalAmount', 'total'), ...countFact(summary, 'countedItems', 'count')];
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
    ...moneyFact(data, 'totalAmount', 'total'),
    ...top3.flatMap((group) => [...textFact(group, nameField, 'group_name'), ...moneyFact(group, 'totalAmount', 'group_amount')]),
  ];
}

/** list: the first 3 items' amounts and vendor names (a null vendor snapshot contributes no text
 * fact for that item — the amount is still required). */
function listFacts(data: Record<string, unknown>): ExpectedFact[] {
  const items = ((data['items'] as Array<Record<string, unknown>> | undefined) ?? []).slice(0, 3);
  return items.flatMap((item) => [...moneyFact(item, 'grandTotalAmount', 'item_amount'), ...textFact(item, 'vendorNameSnapshot', 'item_vendor')]);
}

/** detail: the amount, date and vendor. A reimbursement claim has no vendor — its requester is the
 * closest identity fact a reply would actually state. */
function detailFacts(tool: string, data: Record<string, unknown>): ExpectedFact[] {
  if (tool === 'reimbursement.get_detail') {
    return [...moneyFact(data, 'amount', 'amount'), ...dateFact(data, 'incurredDate', 'date'), ...textFact(data, 'requesterDisplayName', 'requester_as_vendor')];
  }
  return [...moneyFact(data, 'grandTotalAmount', 'amount'), ...dateFact(data, 'expenseDate', 'date'), ...textFact(data, 'vendorName', 'vendor')];
}

/** pending approvals: the count and the total. The tool exposes no separate aggregate amount
 * (erp-reimbursement-tools.use-case.ts, read from source), so "the total" is the sum of the
 * (already-capped-at-10) listed items' own amounts — the only total a truthful reply could state. */
function pendingApprovalsFacts(data: Record<string, unknown>): ExpectedFact[] {
  const items = (data['items'] as Array<Record<string, unknown>> | undefined) ?? [];
  const sum = items.reduce((total, item) => total + Number(item['amount'] ?? 0), 0);
  return [...countFact(data, 'total', 'count'), ...(items.length ? [{ kind: 'money' as const, value: sum, label: 'sum_of_listed_amounts' }] : [])];
}

/** Facts a delivered reply must contain for this gold call to be considered grounded — never
 * hand-typed, always read back off the oracle's own ToolResult. Required-only per shape (task
 * follow-up 2); everything else about the result is optional and not checked. Empty for an
 * ambiguous/unresolved outcome (see `isAmbiguousOrUnresolved`) — that shape is checked by the
 * `must_ask_choice` tag instead. */
export function extractExpectedFacts(tool: string, result: { status: string; data?: unknown }, answerShape?: AnswerShape): ExpectedFact[] {
  if (result.status !== 'ok' || !result.data) return [];
  const data = result.data as Record<string, unknown>;
  if (isAmbiguousOrUnresolved(data)) return [];
  const shape = answerShape ?? DEFAULT_ANSWER_SHAPE[tool];
  switch (shape) {
    case 'single_metric': return singleMetricFacts(tool, data);
    case 'breakdown': return breakdownFacts(data, 'category');
    case 'list': return listFacts(data);
    case 'detail': return detailFacts(tool, data);
    case 'pending_approvals': return pendingApprovalsFacts(data);
    default: { const facts: ExpectedFact[] = []; scanNumericFacts(data, '', 0, facts); return facts; }
  }
}

/** Same as `extractExpectedFacts`, but honors a gold call's own `groupBy` override for the
 * "breakdown" shape (`extractExpectedFacts` always uses "category" since it has no GoldCall to
 * read). Callers with a `GoldCall` in hand (run-preflight.ts, run-real.ts) should prefer this. */
export function extractExpectedFactsForCall(tool: string, result: { status: string; data?: unknown }, call: Pick<GoldCall, 'answerShape' | 'groupBy'>): ExpectedFact[] {
  if (result.status !== 'ok' || !result.data) return [];
  const data = result.data as Record<string, unknown>;
  if (isAmbiguousOrUnresolved(data)) return [];
  const shape = call.answerShape ?? DEFAULT_ANSWER_SHAPE[tool];
  if (shape === 'breakdown') return breakdownFacts(data, call.groupBy ?? 'category');
  return extractExpectedFacts(tool, result, shape);
}
