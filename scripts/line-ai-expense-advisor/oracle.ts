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
import type { GoldCall, GoldInputValue } from './types';
import type { ExpectedFact } from './scorer';

export type ShownItem = { index: number; id: string; date: string | null; label: string };

export type ActorContext = { userId: string; companyId: string };

const TOOL_MODULES: Record<string, { file: string; exportName: string }> = {
  'expense.list_recent': { file: 'modules/line-ai/application/use-cases/erp-tools.use-case.js', exportName: 'ExpenseListRecentTool' },
  'expense.get_breakdown': { file: 'modules/line-ai/application/use-cases/erp-business-tools.use-case.js', exportName: 'ExpenseGetBreakdownTool' },
  'expense.get_detail': { file: 'modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.js', exportName: 'ExpenseGetDetailTool' },
  'reimbursement.list_pending_approvals': { file: 'modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.js', exportName: 'ReimbursementListPendingApprovalsTool' },
  'reimbursement.get_summary': { file: 'modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.js', exportName: 'ReimbursementGetSummaryTool' },
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
 * malformed/huge result cannot loop forever. Used as the fallback for a tool with no dedicated rule
 * below (e.g. reimbursement.get_summary, whose exact shape this oracle never had to hard-code). */
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

/** Facts a delivered reply must contain for this gold call to be considered grounded (task step 3:
 * totals/counts, top-group breakdown amounts, item-line amounts) — never hand-typed, always read
 * back off the oracle's own ToolResult. */
export function extractExpectedFacts(tool: string, result: { status: string; data?: unknown }): ExpectedFact[] {
  if (result.status !== 'ok' || !result.data) return [];
  const data = result.data as Record<string, unknown>;
  const facts: ExpectedFact[] = [];
  if (tool === 'expense.list_recent') {
    const summary = data['summary'] as Record<string, unknown> | undefined;
    if (summary?.['totalAmount'] != null) facts.push({ kind: 'money', value: summary['totalAmount'] as string, label: 'total' });
    if (summary?.['countedItems'] != null) facts.push({ kind: 'count', value: summary['countedItems'] as number, label: 'count' });
    for (const item of ((data['items'] as Array<Record<string, unknown>>) ?? []).slice(0, 10)) {
      if (item['grandTotalAmount'] != null) facts.push({ kind: 'money', value: item['grandTotalAmount'] as string, label: `item:${item['id']}` });
    }
    return facts;
  }
  if (tool === 'expense.get_breakdown') {
    if (data['totalAmount'] != null) facts.push({ kind: 'money', value: data['totalAmount'] as string, label: 'total' });
    if (data['totalCount'] != null) facts.push({ kind: 'count', value: data['totalCount'] as number, label: 'count' });
    for (const group of ((data['byCategory'] as Array<Record<string, unknown>>) ?? []).slice(0, 8)) {
      facts.push({ kind: 'money', value: group['totalAmount'] as string, label: `category:${group['category']}` });
    }
    return facts;
  }
  if (tool === 'expense.get_detail') {
    if (data['grandTotalAmount'] != null) facts.push({ kind: 'money', value: data['grandTotalAmount'] as string, label: 'total' });
    return facts;
  }
  if (tool === 'reimbursement.list_pending_approvals') {
    if (data['total'] != null) facts.push({ kind: 'count', value: data['total'] as number, label: 'count' });
    for (const item of ((data['items'] as Array<Record<string, unknown>>) ?? []).slice(0, 10)) {
      if (item['amount'] != null) facts.push({ kind: 'money', value: item['amount'] as string, label: `item:${item['id']}` });
    }
    return facts;
  }
  // reimbursement.get_summary and anything else: generic numeric scan (see scanNumericFacts).
  scanNumericFacts(data, '', 0, facts);
  return facts;
}
