/** Local runtime replay: real Nest/API/domain code and PostgreSQL; LINE is an explicit test sink.
 * Run through the existing operator replay CLI after building apps/api. Never imports an oracle
 * into the execution path. Missing concrete snapshots fail a case instead of returning expected data.
 */
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import type { ToolResult, SourceRef, LineAiTurnResponse, LineAiSemanticCoverageV2 } from '../packages/contracts/src/index';
import { classifyLineAiTerminalOutcome } from '../apps/api/src/modules/line-ai/domain/logic/line-ai-terminal-outcome.logic';
import { reliabilityDigest, replayReliabilityCorpus, type ReliabilityCorpus, type ReliabilityFixture, type ReliabilityReplayAdapter, type ReliabilityTurnTrace } from './line-ai-reliability-fixtures';
import type { ReliabilityAttempt } from './line-ai-reliability-evaluation';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../apps/api/src/common/pipes/validation-pipe.options';
import { hashMessagePreview } from '../apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.logic';
import { workflowCreditState } from './line-ai-expense-advisor/seed';
import type { WorkflowFixtureOp } from './line-ai-expense-advisor/types';
import { todayCivilDate } from '../packages/contracts/src/civil-date';

type JsonRow = Record<string, any>;
export type RuntimeReplayActor =
  | { kind: 'unlinked'; lineUserId: string; postbackLabels?: Record<number, string> }
  | { kind?: 'member' | 'creator-only'; companyId: string; userId: string; lineUserId?: string; role: string; runtimeRole?: string; branchIds: string[]; postbackLabels?: Record<number, string> };
export async function runtimeActorContext(actor: RuntimeReplayActor | undefined, fallback: { companyId: string; userId: string; lineUserId: string },
  resolveAccess: (userId: string, companyId: string) => Promise<{ roles: string[]; scopes: { branchIds: string[] } }>) {
  if (!actor) return fallback;
  if (actor.kind === 'unlinked') return { companyId: '', userId: '', lineUserId: actor.lineUserId };
  const access = await resolveAccess(actor.userId, actor.companyId);
  assert.ok(access.roles.includes(actor.runtimeRole ?? actor.role), 'REPLAY_ACTOR_ROLE_MISMATCH');
  assert.deepEqual([...access.scopes.branchIds].sort(), [...actor.branchIds].sort(), 'REPLAY_ACTOR_BRANCH_SCOPE_MISMATCH');
  return { companyId: actor.companyId, userId: actor.userId, lineUserId: actor.lineUserId ?? actor.userId };
}
export type RuntimeSourceSnapshot = {
  /** Ordered real Prisma create arguments; contains no expected result/tool response. */
  rows: Array<{ model: string; data: JsonRow }>;
  lineUserId: string;
  assets: Record<string, { path: string; sha256: string; mimeType: string }>;
  /** Exact button label to click on a later turn, selected only from the preceding accepted wire. */
  postbackLabels?: Record<number, string>;
  /** Optional workflow replay actors; omitted snapshots retain the original single-actor seed. */
  actors?: Record<string, RuntimeReplayActor>;
};
export type RuntimeReplayAction =
  | { type: 'postback'; label: string; pressFrom?: string }
  | { type: 'message'; label: string; text: string; pressFrom?: string }
  | { type: 'uri'; label: string; uri: string; pressFrom?: string }
  | { type: 'camera'; label: string; assetId: string; pressFrom?: string };
export type RuntimeReplayTurn = { action?: RuntimeReplayAction; pressFrom?: string; pressOrigin?: { turn: number; actor?: string }; fixture?: WorkflowFixtureOp[] };
export type RuntimeReplayFixture = ReliabilityFixture & { turns: Array<ReliabilityFixture['turns'][number] & RuntimeReplayTurn> };
export type RuntimeReplayCorpus = Omit<ReliabilityCorpus, 'fixtures'> & { fixtures: RuntimeReplayFixture[] };
export type ReliabilityRuntimeManifest = {
  version: 2; corpus: RuntimeReplayCorpus; snapshots: Record<string, RuntimeSourceSnapshot>;
  snapshotDigests: Record<string, string>; versions: ReliabilityTurnTrace['versions'];
  /** Explicit local gateway; it must call this API's local port for guarded tools/budgets. */
  apiPort: number; gatewayUrl: string; databaseUrl: string; redisUrl: string; localStorageEndpoint?: string;
  /** Non-secret runtime flags. Credentials come from the caller's environment, never this artifact. */
  environment: Record<string, string>; repeats: number; cohort: ReliabilityAttempt['cohort'];
  /** Opt-in ordinary SYSTEM baseline, using the real bootstrap; negative-gate fixtures leave this off. */
  bootstrapLaunchGates?: boolean;
};
export type RuntimeWireReceipt = { messages: unknown; at: number; receiptId: string; path: string; payloadHash: string };
export type RuntimeReplayFailure = { reason: 'press_target_not_delivered' | 'press_target_ambiguous' | 'turn_unreached'; turnIndex: number; blockedByTurnIndex?: number };
export type RuntimeTurnEvidence = {
  scenarioId: string; repeat: number; turnIndex: number; user: string; attachmentIds: string[];
  inputKind?: RuntimeReplayAction['type']; action?: RuntimeReplayAction; pressFrom?: string;
  companyId: string; sourceSnapshot: string; snapshotDigest: string; webBaseUrl?: string;
  acceptedAtMs: number; modelWorkCompletedAtMs: number | null;
  receipts: RuntimeWireReceipt[];
  toolResults: Array<{ tool: string; input: unknown; startedAtMs: number; completedAtMs: number; result?: ToolResult; failed?: true }>;
  gatewayResponses: Array<{ method: string; requestId: string; startedAtMs: number; completedAtMs: number; response: unknown }>;
  webhookEvents: unknown[]; providerUsage: unknown[]; reservations: unknown[];
  reviewState: { before: RuntimeReviewState; after: RuntimeReviewState };
  businessSnapshot?: { business: Record<string, JsonRow[]>; collectionState: Record<string, JsonRow[]> };
  businessSnapshotBefore?: { business: Record<string, JsonRow[]>; collectionState: Record<string, JsonRow[]> };
  workflowPreviews?: JsonRow[];
  workflowTasks?: JsonRow[];
  replayFailure?: RuntimeReplayFailure;
  unintendedEffects?: ReliabilityTurnTrace['effects'];
  delivery: ReliabilityTurnTrace['delivery'];
};
export type RuntimeReviewState = { draftActions: unknown[]; conversations: unknown[]; truncated: boolean };
/** Preserve the exact synthetic wire/result snapshot; later application mutation cannot rewrite evidence. */
export const captureRuntimeTurnEvidence = (value: RuntimeTurnEvidence): RuntimeTurnEvidence => structuredClone(value);
/** Never export arbitrary exception text: HTTP/Prisma errors can contain credentials or headers. */
export function runtimeFailureDiagnostic(error: unknown) {
  const value = error as { name?: unknown; code?: unknown; message?: unknown; meta?: { modelName?: unknown; target?: unknown } } | null;
  const safe = (item: unknown) => typeof item === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(item) ? item : undefined;
  return { name: safe(value?.name) ?? 'UnknownError', code: safe(value?.code),
    assertion: typeof value?.message === 'string' ? value.message.match(/\bREPLAY_[A-Z_]+\b/)?.[0] : undefined,
    model: safe(value?.meta?.modelName), target: Array.isArray(value?.meta?.target) ? value.meta.target.map(safe).filter(Boolean) : undefined };
}
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function runtimeAssetBytes(asset: RuntimeSourceSnapshot['assets'][string], repoRoot: string): Buffer<ArrayBuffer> {
  const path = resolve(repoRoot, asset.path); assert.ok(path.startsWith(resolve(repoRoot, 'docs/research') + sep), 'REPLAY_ASSET_PATH');
  const bytes = readFileSync(path); assert.equal(sha(bytes), asset.sha256, 'REPLAY_ASSET_BYTES_CHANGED'); return bytes;
}
export function runtimeAttachmentMessage(id: string, asset: RuntimeSourceSnapshot['assets'][string] | undefined, repoRoot: string) {
  assert.ok(asset, 'REPLAY_UNKNOWN_ASSET');
  const bytes = runtimeAssetBytes(asset, repoRoot);
  return asset.mimeType === 'application/pdf' ? { type: 'file', id, fileName: basename(asset.path), fileSize: bytes.length } : { type: 'image', id };
}
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
export function assertIsolatedReplayDatabase(value: string): void {
  const url = new URL(value);
  assert.ok(['postgresql:', 'postgres:'].includes(url.protocol) && LOCAL.has(url.hostname)
    && /^\/watchdog_ai_reliability_replay_[a-z0-9_]+$/.test(url.pathname)
    && (!url.searchParams.has('schema') || url.searchParams.get('schema') === 'public'), 'REPLAY_REQUIRES_DEDICATED_LOCAL_DATABASE');
}
/** Fixture cleanup only, on the advisory-lock connection in the dedicated local replay database.
 * Production append-only triggers remain installed and are active before seeds and business work.
 * SET LOCAL cannot escape this transaction, including a failed reset. Never use a pooled session SET.
 */
export async function resetRuntimeFixtureDatabase(connection: { query(sql: string): Promise<{ rows: any[] }> }, databaseUrl: string): Promise<void> {
  assertIsolatedReplayDatabase(databaseUrl);
  const expected = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  const origin = async () => assert.equal((await connection.query("SELECT current_setting('session_replication_role') AS role")).rows[0]?.role, 'origin', 'REPLAY_TRIGGER_STATE_NOT_ORIGIN');
  await connection.query('BEGIN');
  try {
    assert.equal((await connection.query('SELECT current_database() AS name')).rows[0]?.name, expected, 'REPLAY_DATABASE_CONNECTION_MISMATCH');
    await origin();
    const tables = (await connection.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'")).rows.map(row => row.tablename as string);
    assert.ok(tables.length && tables.every(name => /^[A-Za-z0-9_]+$/.test(name)), 'REPLAY_MIGRATIONS_REQUIRED');
    await connection.query('SET LOCAL session_replication_role = replica');
    await connection.query(`TRUNCATE TABLE ${tables.map(name => `"public"."${name}"`).join(',')} CASCADE`);
    await connection.query('SET LOCAL session_replication_role = origin');
    await origin();
    await connection.query('COMMIT');
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
  await origin();
}
const localUrl = (value: string, protocol: string) => { const url = new URL(value); assert.ok(url.protocol === protocol && LOCAL.has(url.hostname) && !url.username && !url.password, 'REPLAY_LOCAL_SERVICE_REQUIRED'); return url; };

export function runtimeDeliveryEvidence(plans: JsonRow[], outcomes: JsonRow[], receipts: Array<{ messages: unknown; at: number; receiptId: string }>): ReliabilityTurnTrace['delivery'] {
  const required: Array<{ id: string; wireHash: string; messages: unknown; acceptedId: string | null }> = [];
  for (const plan of plans) for (const batch of plan.planJson.batches) {
    const state = plan.batchStateJson.find((item: any) => item.batchId === batch.id);
    const wire = state?.variant === 'fallback' ? batch.fallback : batch.primary;
    required.push({ id: batch.id, wireHash: wire.wireHash, messages: wire.messages, acceptedId: state?.status === 'ACCEPTED' ? state.providerRequestId : null });
  }
  for (const outcome of outcomes) if (!plans.some(plan => plan.outcomeId === outcome.id)) {
    const messages = outcome.messagesJson.map((message: any) => { const { canonicalText: _, ...wire } = message; return wire; });
    required.push({ id: `outcome:${outcome.id}`, wireHash: reliabilityDigest(messages), messages, acceptedId: outcome.deliveredAt ? '*' : null });
  }
  const used = new Set<number>();
  const accepted = required.flatMap(batch => {
    const index = receipts.findIndex((receipt, i) => !used.has(i) && !!batch.acceptedId
      && (batch.acceptedId === '*' || batch.acceptedId === receipt.receiptId) && reliabilityDigest(batch.messages) === reliabilityDigest(receipt.messages));
    if (index < 0) return [];
    used.add(index); const receipt = receipts[index]!;
    return [{ batchId: batch.id, wireHash: batch.wireHash, acceptedAtMs: receipt.at, receiptId: receipt.receiptId }];
  });
  return { requiredBatchIds: required.map(batch => batch.id), accepted,
    status: required.length && accepted.length === required.length ? 'ACCEPTED' : required.length ? 'INCOMPLETE' : 'NONE' };
}

/** Nest reads method metadata after wrappers are installed; retain guards/routes/DTO validation. */
export function instrumentRuntimeMethod(target: any, method: string, instrument: (original: (...args: any[]) => Promise<any>, args: any[]) => Promise<any>) {
  const original = target[method], wrapper = function(this: any, ...args: any[]) { return instrument(original.bind(this), args); };
  const reflect = Reflect as any;
  for (const key of reflect.getMetadataKeys?.(original) ?? []) reflect.defineMetadata(key, reflect.getMetadata(key, original), wrapper);
  target[method] = wrapper;
}

export function resolveRuntimePostback(messages: unknown, label: string): { data?: string; failure?: 'press_target_not_delivered' | 'press_target_ambiguous' } {
  const choices = new Set<string>();
  const visit = (value: any, depth = 0): void => {
    if (!value || typeof value !== 'object' || depth > 30) return;
    if (value.type === 'postback' && value.label === label && typeof value.data === 'string') choices.add(value.data);
    else for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(messages);
  return choices.size === 1 ? { data: [...choices][0]! } : { failure: choices.size ? 'press_target_ambiguous' : 'press_target_not_delivered' };
}

export function selectRuntimePostback(messages: unknown, label: string): string {
  const selected = resolveRuntimePostback(messages, label);
  assert.ok(selected.data !== undefined, 'REPLAY_POSTBACK_NOT_UNIQUELY_DELIVERED');
  return selected.data;
}

/** Effects come from actual before/after rows, including writes that preceded a thrown timeout. */
export function runtimeDatabaseEffects(before: Record<string, JsonRow[]>, after: Record<string, JsonRow[]>) {
  const result: ReliabilityTurnTrace['effects'] = [];
  for (const table of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const old = new Map((before[table] ?? []).map(row => [String(row.id), row]));
    const next = new Map((after[table] ?? []).map(row => [String(row.id), row]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const from = old.get(id), to = next.get(id);
      if (reliabilityDigest(from ?? null) === reliabilityDigest(to ?? null)) continue;
      result.push({ kind: `${table}.${!from ? 'create' : !to ? 'delete' : 'update'}`, recordId: id,
        revision: to ? String(to.version ?? to.revision ?? to.updatedAt ?? reliabilityDigest(to)) : 'deleted',
        evidence: 'database_snapshot', evidenceHash: reliabilityDigest({ table, before: from ?? null, after: to ?? null }) });
    }
  }
  return result.sort((a, b) => `${a.kind}:${a.recordId}`.localeCompare(`${b.kind}:${b.recordId}`));
}
export const runtimeSourceId = (source: SourceRef): string => source.id ?? `${source.module}:${source.entityType}:${source.entityId ?? 'summary'}`;

/** Collect explicit typed field evidence only. A prose question needs independent semantic review. */
export function runtimeAskedSlots(result: JsonRow): string[] {
  return [...new Set([result, result.captureHints, result.reimbursementHints, result.correctionHints]
    .flatMap(value => Array.isArray(value?.missingFields) ? value.missingFields : [])
    .filter((value): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value)))];
}

/** Typed application outcomes only: never infer success from prose or the expected oracle. */
export function runtimeSemanticOutcome(coverage: LineAiSemanticCoverageV2[], events: Array<{ status: string; errorCode?: string | null }>, responses: LineAiTurnResponse[]): string {
  if (coverage.length) {
    if (coverage.every(item => item.status === 'handled')) return 'answered';
    if (coverage.some(item => item.status === 'handled')) return 'partial';
    if (coverage.some(item => item.status === 'needs_user')) return 'needs_input';
    if (coverage.some(item => item.status === 'denied')) return 'access_denied';
    return 'unsupported_action';
  }
  const reasons: Record<string, string> = { forbidden: 'access_denied', unlinked_user: 'access_denied', mutation_blocked: 'policy_blocked',
    unsupported_module: 'unsupported_action', unsupported_yet: 'unsupported_action', feature_disabled: 'feature_unavailable',
    ambiguous_company: 'needs_input', ai_timeout: 'temporarily_unavailable', tool_unavailable: 'temporarily_unavailable' };
  const refused = responses.filter(response => response.refused).at(-1);
  if (refused) return reasons[refused.refusalReason ?? ''] ?? `refusal:${refused.refusalReason ?? 'unknown'}`;
  const classes: Record<string, string> = { delivered: 'answered', clarification: 'needs_input', permission_refusal: 'access_denied',
    feature_disabled: 'feature_unavailable', timeout: 'temporarily_unavailable', provider_unavailable: 'temporarily_unavailable',
    budget_refusal: 'temporarily_unavailable' };
  const terminal = events.filter(event => event.status !== 'batched');
  const observed = [...new Set(terminal.map(event => event.status === 'free_expense_month_summary' ? 'answered'
    : classes[classifyLineAiTerminalOutcome(event.status, event.errorCode) ?? ''] ?? `event:${event.status}`))];
  return observed.length === 1 ? observed[0]! : observed.length ? observed.sort().join('+') : 'missing_terminal_event';
}

export function runtimeSourceFacts(results: ToolResult[], cited: Set<string>): ReliabilityTurnTrace['facts'] {
  const facts: ReliabilityTurnTrace['facts'] = [];
  for (const result of results) if (result.status === 'ok') for (const fact of result.facts ?? []) {
    if (fact.value === null || !['known', 'empty'].includes(fact.state)) continue;
    for (const ref of fact.sourceRefIds) if (cited.has(ref) && result.sourceRefs.some(source => runtimeSourceId(source) === ref && source.permissionChecked)) facts.push({
      metric: fact.metric, value: fact.value, unit: fact.unit, currency: fact.currency,
      period: JSON.stringify(fact.period), basis: `${fact.dateBasis}|${fact.statusBasis}`, sourceRef: ref, asOf: fact.asOf,
    });
  }
  return [...new Map(facts.map(fact => [reliabilityDigest(fact), fact])).values()];
}
// Every supported mutating business family is observed, not only the expected effect in the oracle.
const EFFECT_TABLES = ['ExpenseRecord', 'ExpensePayment', 'ExpenseLine', 'ExpenseSubstituteReceiptEvidence', 'ExpenseCaptureGroup', 'ExpenseCaptureFile',
  'ExpenseCaptureAllocation', 'ReimbursementRequest', 'ReimbursementLine', 'ReimbursementPayment', 'AccountingDocument', 'AccountingDocumentLine',
  'BankAdjustment', 'BankReconciliationMatch', 'PurchaseOrder', 'PurchaseOrderLine', 'SalesOrder', 'SalesOrderLine', 'StockMovement', 'CrmCustomer',
  'WorkflowTask', 'AttachmentObject', 'AttachmentLink', 'ReimbursementDraftAction', 'ReimbursementApprovalStep', 'DisbursementVoucher',
  'DisbursementVoucherLine', 'WhtCertificate', 'WhtCertificateHandoff', 'WhtCertificateHistory'];
const COLLECTION_STATE_STATUSES = new Set(['COLLECTING', 'PREVIEW', 'EXPIRED', 'CANCELLED']);
const EXPENSE_CONTINUATION_FIELDS = new Set(['sourceChannelMetadataJson', 'updatedAt', 'updatedByUserId']);

export const runtimeAttemptId = (scenarioId: string, repeat: number) => `${scenarioId}:${repeat}:${randomUUID()}`;
export const runtimeEventIdPrefix = (attemptId: string, turnIndex: number) => `replay-${sha(`${attemptId}:${turnIndex}`).slice(0, 20)}`;
export const runtimeAssetMessageId = (attemptId: string, turnIndex: number, assetId: string) => `${runtimeEventIdPrefix(attemptId, turnIndex)}-${assetId}`;

export function runtimeBusinessSnapshot(rows: Record<string, JsonRow[]>) {
  const business: Record<string, JsonRow[]> = {}, collectionState: Record<string, JsonRow[]> = {};
  for (const [table, entries] of Object.entries(rows)) {
    if (table === 'ReimbursementDraftAction') {
      const collecting = entries.filter(row => COLLECTION_STATE_STATUSES.has(row.status));
      const applied = entries.filter(row => !COLLECTION_STATE_STATUSES.has(row.status));
      if (collecting.length) collectionState[table] = structuredClone(collecting);
      if (applied.length) business[table] = structuredClone(applied);
      continue;
    }
    if (table === 'ExpenseRecord') {
      business[table] = entries.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !EXPENSE_CONTINUATION_FIELDS.has(key))));
      collectionState[table] = entries.map(row => ({ id: row.id, ...Object.fromEntries(Object.entries(row).filter(([key]) => EXPENSE_CONTINUATION_FIELDS.has(key))) }));
      continue;
    }
    business[table] = structuredClone(entries);
  }
  return { business, collectionState };
}

export function runtimeBusinessEffects(before: Record<string, JsonRow[]>, after: Record<string, JsonRow[]>) {
  return runtimeDatabaseEffects(before, after).filter(effect => {
    const id = effect.recordId, oldRow = (before[effect.kind.split('.')[0]!] ?? []).find(row => String(row.id) === id);
    const newRow = (after[effect.kind.split('.')[0]!] ?? []).find(row => String(row.id) === id);
    if (effect.kind.startsWith('ReimbursementDraftAction.'))
      return ![oldRow, newRow].filter(Boolean).every(row => COLLECTION_STATE_STATUSES.has(row!.status));
    if (effect.kind !== 'ExpenseRecord.update' || !oldRow || !newRow) return true;
    const changed = new Set([...Object.keys(oldRow), ...Object.keys(newRow)].filter(key => reliabilityDigest(oldRow[key] ?? null) !== reliabilityDigest(newRow[key] ?? null)));
    return !(changed.size === EXPENSE_CONTINUATION_FIELDS.size && [...changed].every(key => EXPENSE_CONTINUATION_FIELDS.has(key)));
  });
}

export async function resetRuntimeAfterHook<T>(onBeforeReset: ((conversation: ReliabilityFixture, attemptId: string) => Promise<void> | void) | undefined,
  conversation: ReliabilityFixture, attemptId: string, reset: () => Promise<T>): Promise<T> {
  await onBeforeReset?.(conversation, attemptId);
  return reset();
}

const FIXTURE_MODELS = { ExpenseRecord: 'expenseRecord', ReimbursementRequest: 'reimbursementRequest', DisbursementVoucher: 'disbursementVoucher' } as const;
export function validateRuntimeFixtureOperations(operations: WorkflowFixtureOp[]): void {
  for (const operation of operations) {
    assert.ok(['setCredit', 'expire', 'mutate'].includes(operation.op), 'REPLAY_FIXTURE_OP_UNKNOWN');
    if (operation.op === 'setCredit') assert.ok(['normal', 'exhausted'].includes(operation.state), 'REPLAY_FIXTURE_CREDIT_STATE');
    if (operation.op === 'expire') assert.ok(['expense-action', 'expense-action-applied', 'wf-choice', 'draft-preview'].includes(operation.store), 'REPLAY_FIXTURE_EXPIRY_STORE');
    if (operation.op === 'mutate') assert.ok(Object.hasOwn(FIXTURE_MODELS, operation.table) && operation.seedKey && operation.set && typeof operation.set === 'object', 'REPLAY_FIXTURE_MUTATE_TABLE');
  }
}

export async function executeRuntimeFixtureOperations(operations: WorkflowFixtureOp[], context: {
  databaseUrl: string; client: Record<string, any>; redis: { del(key: string): Promise<number> };
  companyId: string; userId: string; chatKeyHash: string; seedRows: RuntimeSourceSnapshot['rows'];
}): Promise<void> {
  assertIsolatedReplayDatabase(context.databaseUrl);
  validateRuntimeFixtureOperations(operations);
  for (const operation of operations) {
    if (operation.op === 'setCredit') {
      assert.ok(context.companyId, 'REPLAY_FIXTURE_COMPANY_REQUIRED');
      await context.client.companyAiConfiguration.update({ where: { companyId: context.companyId }, data: workflowCreditState(operation.state) });
    } else if (operation.op === 'mutate') {
      const model = FIXTURE_MODELS[operation.table];
      assert.ok(context.seedRows.some(row => row.model === model && row.data.id === operation.seedKey), 'REPLAY_FIXTURE_SEED_UNKNOWN');
      await context.client[model].update({ where: { id: operation.seedKey }, data: operation.set });
    } else {
      const chat = operation.store === 'draft-preview' ? context.chatKeyHash
        : `${operation.store === 'expense-action-applied' ? 'expense-action' : operation.store}:${context.chatKeyHash}`;
      // Same keys as LineDraftPreviewStore's previewKey/appliedKey, without loading its Nest decorators.
      const key = `line-ai:${operation.store === 'expense-action-applied' ? 'draft-applied' : 'draft-preview'}:${context.companyId}:${chat}`;
      await context.redis.del(key);
      if (operation.store === 'draft-preview') {
        const latest = await context.client.reimbursementDraftAction.findFirst({ where: { companyId: context.companyId, actorUserId: context.userId,
          chatKeyHash: context.chatKeyHash, status: { in: ['COLLECTING', 'PREVIEW'] } }, orderBy: { createdAt: 'desc' } });
        if (latest) await context.client.reimbursementDraftAction.update({ where: { id: latest.id }, data: { expiresAt: new Date(0) } });
      }
    }
  }
}

export function runtimePressReceipts(states: Array<{ pressFrom?: string; receipts: Array<{ messages: unknown }> }>, turnIndex: number, turn: RuntimeReplayTurn): unknown {
  const origin = turn.pressOrigin?.turn ?? turnIndex - 1;
  assert.ok(Number.isInteger(origin) && origin >= 0 && origin < turnIndex && states[origin], 'REPLAY_PRESS_ORIGIN_MISSING');
  if (turn.pressOrigin?.actor) assert.equal(states[origin]!.pressFrom, turn.pressOrigin.actor, 'REPLAY_PRESS_ORIGIN_ACTOR');
  return states[origin]!.receipts.map(receipt => receipt.messages);
}

/** Bind a delivered confirmation to its stored payload and the product's own card renderer. */
export function runtimeDeliveredPreviews(receipts: Array<{ messages: unknown }>, entries: JsonRow[], render: (entry: JsonRow) => unknown): JsonRow[] {
  const previews: JsonRow[] = [];
  for (const receipt of receipts) for (const message of Array.isArray(receipt.messages) ? receipt.messages : []) {
    const controls: URLSearchParams[] = [];
    const visit = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      if (value.type === 'postback' && typeof value.data === 'string') controls.push(new URLSearchParams(value.data));
      for (const child of Object.values(value)) if (typeof child === 'object') visit(child);
    };
    visit(message);
    const control = controls.find(params => ['expense_action_confirm', 'reimbursement_draft_confirm'].includes(params.get('action') ?? ''));
    if (!control) continue;
    const claim = control.get('action') === 'reimbursement_draft_confirm';
    const entry = entries.find(candidate => claim ? candidate.preview?.actionId === control.get('actionId')
      && String(candidate.preview.previewRevision) === control.get('previewRevision') && candidate.preview.confirmationDigest === control.get('confirmationDigest')
      : candidate.preview?.token === control.get('token'));
    const expected = entry && render(entry);
    const candidates = Array.isArray(expected) ? expected : [expected];
    const verified = candidates.some(candidate => candidate && reliabilityDigest(candidate.contents) === reliabilityDigest(message.contents) && candidate.altText === message.altText);
    if (!entry || !verified) { previews.push({ action: 'UNVERIFIED_PREVIEW', target: entry?.expenseId ?? '' }); continue; }
    const preview = entry.preview, payment = preview.payment ?? entry.claim?.payment ?? entry.voucher?.payment;
    const paidDate = payment?.paidAt ?? payment?.paidDate;
    previews.push({ action: claim ? 'reimbursement_draft_confirm' : preview.action,
      target: claim ? entry.requestId ?? preview.targetRef ?? preview.actionId : entry.voucher?.id ?? entry.expenseId,
      ...(claim ? { draftActionId: preview.actionId } : {}),
      ...(claim ? { amount: preview.after?.amount ?? preview.after?.totalAmount, reason: preview.after?.reason, payeeName: preview.after?.requesterDisplayName }
        : { amount: preview.record?.amount, payeeName: preview.record?.vendorName }),
      ...(preview.reason ? { reason: preview.reason } : {}), ...(payment?.paymentMethod ? { paymentMethod: payment.paymentMethod } : {}),
      ...(paidDate ? { paidDate: todayCivilDate('Asia/Bangkok', new Date(paidDate)) } : {}) });
  }
  return previews;
}

export async function runLineReliabilityRuntime(manifest: ReliabilityRuntimeManifest, repoRoot: string,
  hooks: { onTurn?: (evidence: RuntimeTurnEvidence) => Promise<void> | void;
    onBeforeReset?: (conversation: ReliabilityFixture, attemptId: string) => Promise<void> | void;
    onBeforeTurn?: (conversation: ReliabilityFixture, turnIndex: number, attemptId: string) => Promise<void> | void;
    onConversationComplete?: (conversation: ReliabilityFixture, attemptId: string) => Promise<void> | void } = {}) {
  assert.equal(manifest.version, 2); assertIsolatedReplayDatabase(manifest.databaseUrl);
  assert.ok(manifest.bootstrapLaunchGates === undefined || typeof manifest.bootstrapLaunchGates === 'boolean', 'REPLAY_INVALID_LAUNCH_BOOTSTRAP_FLAG');
  localUrl(manifest.gatewayUrl, 'http:'); const redisAddress = localUrl(manifest.redisUrl, 'redis:');
  assert.ok(/^\/(?:[1-9]|1[0-5])$/.test(redisAddress.pathname) && !['', '6379'].includes(redisAddress.port), 'REPLAY_DEDICATED_REDIS_DATABASE_REQUIRED');
  if (manifest.localStorageEndpoint) localUrl(manifest.localStorageEndpoint, 'http:');
  assert.ok(Number.isInteger(manifest.apiPort) && manifest.apiPort >= 1024 && manifest.apiPort <= 65535, 'REPLAY_PORT');
  assert.ok(manifest.corpus.fixtures.every(row => row.provenance.kind === 'synthetic'), 'REPLAY_SYNTHETIC_ONLY');
  for (const fixture of manifest.corpus.fixtures) for (const turn of fixture.turns) validateRuntimeFixtureOperations(turn.fixture ?? []);
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  assert.equal(manifest.versions.sourceCommit, sourceCommit, 'REPLAY_SOURCE_COMMIT_CHANGED');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim(), '', 'REPLAY_REQUIRES_COMMITTED_SOURCE');
  // The production capture/intake behaviour flags are named one by one (release 2026-09-29 carried-forward env).
  const allowedEnv = /^(?:LINE_AI_[A-Z0-9_]+|LINE_INTAKE_[A-Z0-9_]+|AI_MODEL_[A-Z0-9_]+|AI_GATEWAY_TRANSPORT|AI_GATEWAY_HOSTNAME|ATTACHMENT_STORAGE_PROVIDER|LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED|EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED|EXPENSE_DRAFT_NUMBERING_ENABLED|RECEIPT_QUOTA_ENFORCED|LINE_FREE_AI_BUDGET_SATANG|AI_OCR_MAX_PER_COMPANY|AI_LLM_MAX_PER_COMPANY)$/;
  for (const [key, value] of Object.entries(manifest.environment)) {
    assert.ok(allowedEnv.test(key) && !/TOKEN|SECRET|URL|HOSTNAME/.test(key), 'REPLAY_UNSAFE_ENV'); process.env[key] = value;
  }
  const secret = `replay-${randomUUID()}`;
  Object.assign(process.env, { APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'local', GIT_SHA: sourceCommit, NODE_ENV: 'test', SERVICE_NAME: 'line-reliability-replay', DATABASE_URL: manifest.databaseUrl,
    REDIS_URL: manifest.redisUrl, AI_GATEWAY_INTERNAL_URL: manifest.gatewayUrl, LINE_MESSAGING_CHANNEL_SECRET: secret, LINE_AI_BUFFER_DEBOUNCE_MS: manifest.cohort,
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'local-replay-sink', S3_BUCKET: 'local-replay-only', S3_ENDPOINT: manifest.localStorageEndpoint ?? 'http://127.0.0.1:9',
    S3_PUBLIC_ENDPOINT: manifest.localStorageEndpoint ?? 'http://127.0.0.1:9', S3_ACCESS_KEY_ID: 'local-replay-only', S3_SECRET_ACCESS_KEY: 'local-replay-only',
    AWS_EC2_METADATA_DISABLED: 'true', S3_FORCE_PATH_STYLE: 'true' });
  const apiRoot = resolve(repoRoot, 'apps/api'), compiled = resolve(apiRoot, 'dist/apps/api/src');
  const requireApi = createRequire(resolve(apiRoot, 'package.json'));
  const { Client } = requireApi('pg');
  const databaseLock = new Client({ connectionString: manifest.databaseUrl });
  const Redis = requireApi('ioredis');
  const redis = new Redis(manifest.redisUrl, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0 });
  const redisOwnerKey = 'reliability-runtime-database-owner', redisOwner = new URL(manifest.databaseUrl).pathname;
  const { NestFactory } = requireApi('@nestjs/core'), { Logger, ValidationPipe } = requireApi('@nestjs/common');
  const { PrismaService } = requireApi(resolve(compiled, 'common/database/prisma.service.js'));
  const { LineWebhookController } = requireApi(resolve(compiled, 'modules/auth/presentation/line-webhook.controller.js'));
  const { AiGatewayClient } = requireApi(resolve(compiled, 'modules/line-ai/infrastructure/ai-gateway.client.js'));
  const { InternalToolsController } = requireApi(resolve(compiled, 'modules/line-ai/presentation/http/internal-tools.controller.js'));
  const { PermissionResolverService } = requireApi(resolve(compiled, 'modules/access-control/application/permission-resolver.service.js'));
  const { LineDocumentQaWorker } = requireApi(resolve(compiled, 'modules/line-ai/application/line-document-qa.worker.js'));
  const { ExpenseCaptureReadRunnerService } = requireApi(resolve(compiled, 'modules/expenses/application/services/expense-capture-read-runner.service.js'));
  const { LineCaptureResultNotifierUseCase } = requireApi(resolve(compiled, 'modules/line-ai/application/use-cases/line-capture-result-notifier.use-case.js'));
  const { ProcessLineWebhookUseCase } = requireApi(resolve(compiled, 'modules/line-ai/application/use-cases/process-line-webhook.use-case.js'));
  const { AppConfigService } = requireApi(resolve(compiled, 'common/config/app-config.service.js'));
  const { AppModule } = requireApi(resolve(compiled, 'app.module.js'));
  const { buildExpenseActionCard } = requireApi(resolve(compiled, 'modules/line-ai/domain/logic/line-expense-action-card.logic.js'));
  const { buildReimbursementDraftMessages } = requireApi(resolve(compiled, 'modules/line-ai/domain/logic/line-reimbursement-draft-card.logic.js'));
  const { LineDraftPreviewStore } = requireApi(resolve(compiled, 'modules/expenses/application/services/line-draft-preview.store.js'));
  const originalFetch = globalThis.fetch;
  let app: any, client: any, current: ReliabilityFixture | undefined, snapshot: RuntimeSourceSnapshot | undefined, repeat = 0, attemptId = '', unsafeToReset = false;
  let selectedCompanyId = '', selectedActorId = '';
  let blockedPress: RuntimeReplayFailure | undefined;
  let executionFailed = false;
  let processingWebhook = 0;
  let active: { acceptedAt: number; eventIds: string[]; before: Record<string, JsonRow[]>; usageIds: Set<string>; tools: ReliabilityTurnTrace['tools']; results: ToolResult[];
    responses: LineAiTurnResponse[]; deliveryCoverage: LineAiSemanticCoverageV2[] | null; missing: string[]; requests: string[]; completedAt: number | null; errors: string[]; critical: string[]; receipts: RuntimeWireReceipt[];
    toolResults: RuntimeTurnEvidence['toolResults']; gatewayResponses: RuntimeTurnEvidence['gatewayResponses']; reviewBefore: RuntimeReviewState;
    inputKind?: RuntimeReplayAction['type']; action?: RuntimeReplayAction; pressFrom?: string; previewEntries: JsonRow[]; lineUserId: string; infrastructureError?: unknown } | undefined;
  let turnStates: Array<NonNullable<typeof active>> = [];
  const turnEvidence: RuntimeTurnEvidence[] = [];
  const runtimeDiagnostics: Array<{ scenarioId: string; repeat: number; phase: string; stage: string; error: ReturnType<typeof runtimeFailureDiagnostic> }> = [];
  let stage = 'initializing';
  // Opt-in pacing between turns/fixtures, to stay under a Bedrock account's throttling in a real
  // (non-fixture) replay. Both default to 0 (no pause, today's behavior) so every existing caller
  // that never sets these is unaffected — line-ai-expense-advisor's run-real.ts sets real-mode
  // defaults (1500ms/2000ms) for its own process before calling this function.
  const TURN_PAUSE_MS = Number(process.env['MANGMEE_EVAL_TURN_PAUSE_MS'] ?? '0');
  const CONVERSATION_PAUSE_MS = Number(process.env['MANGMEE_EVAL_CONVERSATION_PAUSE_MS'] ?? '0');
  const readEffects = async () => {
    const exists = await client.$queryRawUnsafe('SELECT tablename FROM pg_tables WHERE schemaname=\'public\'') as { tablename: string }[];
    const tables = new Set(exists.map(row => row.tablename)), output: Record<string, JsonRow[]> = {};
    for (const table of EFFECT_TABLES) if (tables.has(table)) output[table] = await client.$queryRawUnsafe(`SELECT row_to_json(t) AS row FROM "${table}" t`).then((rows: any[]) => rows.map(row => row.row));
    return output;
  };
  const pendingWork = async () => processingWebhook + (await client.lineDocumentQaJob.count({ where: { status: { in: ['QUEUED', 'READING'] } } }))
    + (await client.expenseCaptureReadJob.count({ where: { status: { in: ['QUEUED', 'PREPARING', 'READING'] } } }));
  const readReviewState = async (): Promise<RuntimeReviewState> => {
    assert.ok(current, 'REPLAY_NO_CURRENT_OWNER');
    const [draftActions, conversations] = await Promise.all([
      client.reimbursementDraftAction.findMany({ where: { companyId: selectedCompanyId, actorUserId: selectedActorId }, orderBy: { id: 'asc' }, take: 101 }),
      client.aiConversation.findMany({ where: { companyId: selectedCompanyId, userId: selectedActorId }, orderBy: { id: 'asc' }, take: 101 }),
    ]);
    return { draftActions: draftActions.slice(0, 100), conversations: conversations.slice(0, 100), truncated: draftActions.length > 100 || conversations.length > 100 };
  };
  globalThis.fetch = (async (input, init) => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'api.line.me') {
        if (!url.pathname.startsWith('/v2/bot/message/') && url.pathname !== '/v2/bot/chat/loading/start') throw new Error('REPLAY_LINE_ENDPOINT_BLOCKED');
        const receiptId = `sink-${randomUUID()}`;
        if (url.pathname !== '/v2/bot/chat/loading/start') {
          const body = JSON.parse(String(init?.body ?? '{}'));
          assert.ok(active && Array.isArray(body.messages), 'REPLAY_UNSCOPED_SEND');
          if (body.to !== undefined && body.to !== (current?.fixture.channelKind === 'USER' ? active.lineUserId : current?.fixture.chat)
            || body.replyToken !== undefined && !active.eventIds.some(id => body.replyToken === `${id}-token`)) {
            active.critical.push('cross_recipient_attempt'); throw new Error('REPLAY_WRONG_RECIPIENT');
          }
          active.receipts.push({ messages: structuredClone(body.messages), at: Date.now(), receiptId, path: url.pathname, payloadHash: reliabilityDigest(body) });
        }
        return new Response('{}', { status: 200, headers: { 'x-line-request-id': receiptId } });
      }
      if (url.hostname === 'api-data.line.me') {
        const id = decodeURIComponent(url.pathname.match(/\/message\/([^/]+)\/content$/)?.[1] ?? '');
        const asset = snapshot?.assets[id]; assert.ok(asset, 'REPLAY_UNKNOWN_ASSET');
        const bytes = runtimeAssetBytes(asset, repoRoot);
        return new Response(bytes, { status: 200, headers: { 'content-type': asset.mimeType } });
      }
      // Presigned uploads/readers also use the explicitly validated local storage endpoint.
      assert.ok([new URL(manifest.gatewayUrl).origin, `http://127.0.0.1:${manifest.apiPort}`,
        ...(manifest.localStorageEndpoint ? [new URL(manifest.localStorageEndpoint).origin] : [])].includes(url.origin), 'REPLAY_EXTERNAL_API_EGRESS_BLOCKED');
      const response = await originalFetch(input, init);
      if (response.status >= 500 && active) active.infrastructureError = new Error('REPLAY_LOCAL_SERVICE_UNAVAILABLE');
      return response;
    } catch (error) {
      if (active && !['AbortError', 'TimeoutError'].includes((error as Error).name)) active.infrastructureError = error;
      throw error;
    }
  }) as typeof fetch;
  const collect = async (row: ReliabilityFixture, turnIndex: number): Promise<ReliabilityTurnTrace> => {
    assert.ok(active, 'REPLAY_NO_ADMITTED_TURN');
    const state = active, turn = row.turns[turnIndex]!;
    const [after, usage, events, tasks, plans, outcomes, holds] = await Promise.all([readEffects(), client.aiUsageEvent.findMany(),
      client.lineWebhookEventLog.findMany({ where: { webhookEventId: { in: state.eventIds } } }),
      client.aiConversation.findMany({ where: { companyId: selectedCompanyId, userId: selectedActorId } }),
      client.lineDeliveryPlan.findMany({ where: { companyId: selectedCompanyId, createdAt: { gte: new Date(state.acceptedAt) } } }),
      client.lineTurnOutcome.findMany({ where: { webhookEventId: { in: state.eventIds } } }),
      client.aiBudgetReservation.findMany({ where: { createdAt: { gte: new Date(state.acceptedAt) } } })]);
    const calls = usage.filter((item: any) => !state.usageIds.has(item.id) && item.eventKind === 'MODEL_CALL');
    const unreported = holds.filter((hold: any) => ['DISPATCHED', 'UNRESOLVED', 'SETTLED'].includes(hold.status) && !calls.some((call: any) => call.invocationKey === hold.invocationKey));
    const cited = new Set(state.responses.flatMap(response => response.sourceRefs.filter(ref => ref.permissionChecked).map(runtimeSourceId)));
    const coverage = state.deliveryCoverage ?? state.responses.flatMap(response => response.semanticCoverage ?? []);
    const taskIds = tasks.flatMap((task: any) => task.taskStateJson?.tasks?.map((item: any) => item.taskId) ?? []);
    const outcome = runtimeSemanticOutcome(coverage, events, state.responses);
    const delivery = runtimeDeliveryEvidence(plans, outcomes, state.receipts);
    if (state.receipts.length && !delivery.requiredBatchIds.length) state.errors.push('no_frozen_delivery_requirement');
    if (unreported.length) state.errors.push('provider_usage_unobserved');
    const businessSnapshot = runtimeBusinessSnapshot(after);
    const workflowTasks = await client.lineAiTaskRun.findMany({ where: { id: { in: events.map((event: any) => event.taskRunId).filter(Boolean) } } });
    const chatKeyHash = hashMessagePreview(row.fixture.channelKind === 'USER' ? state.lineUserId : row.fixture.chat);
    const pending = await app.get(LineDraftPreviewStore).load(selectedCompanyId, `expense-action:${chatKeyHash}`);
    const entries = [...state.previewEntries, ...(pending ? [pending] : []), ...(after.ReimbursementDraftAction ?? []).filter(row => row.status === 'PREVIEW' && row.actorUserId === selectedActorId)
      .map(row => ({ ...row, preview: row.previewJson }))];
    const webBaseUrl = app.get(AppConfigService).webBaseUrl;
    const workflowPreviews = runtimeDeliveredPreviews(state.receipts, entries, entry => entry.preview?.actionId
      ? ['th', 'en'].flatMap(language => buildReimbursementDraftMessages({ status: 'preview', preview: entry.preview }, webBaseUrl ?? '', selectedCompanyId, [], undefined, language))
      : buildExpenseActionCard(entry.preview, undefined, entry.preview.language ?? 'th', webBaseUrl));
    const businessEffects = runtimeBusinessEffects(state.before, after);
    const changedRecords = new Set(businessEffects.map(effect => `${effect.kind.split('.')[0]}:${effect.recordId}`));
    const beforeBusiness = Object.fromEntries(Object.entries(runtimeBusinessSnapshot(state.before).business)
      .map(([table, rows]) => [table, rows.filter(record => changedRecords.has(`${table}:${record.id}`))]));
    const evidence = captureRuntimeTurnEvidence({ scenarioId: row.id, repeat, turnIndex, user: turn.user, attachmentIds: turn.attachmentIds,
      inputKind: state.inputKind ?? (turn.attachmentIds.length ? 'camera' : 'message'), ...(state.action ? { action: state.action } : {}), ...(state.pressFrom ? { pressFrom: state.pressFrom } : {}),
      companyId: selectedCompanyId, sourceSnapshot: row.fixture.sourceSnapshot, snapshotDigest: manifest.snapshotDigests[row.fixture.sourceSnapshot]!,
      webBaseUrl: app.get(AppConfigService).webBaseUrl, acceptedAtMs: state.acceptedAt, modelWorkCompletedAtMs: state.completedAt,
      receipts: state.receipts, toolResults: state.toolResults, gatewayResponses: state.gatewayResponses,
      webhookEvents: events.map(({ webhookEventId, eventType, status, errorCode, processedAt, createdAt }: any) => ({ webhookEventId, eventType, status, errorCode, processedAt, createdAt })),
      providerUsage: calls.map(({ id, requestId, invocationKey, sourceRoute, usageTag, modelId, ok, inputTokens, outputTokens, cacheReadInputTokens, cacheWriteInputTokens,
        costSatang, requestKind, budgetBucket, usageBasis, eventKind, pricingSnapshot, createdAt }: any) => ({ id, requestId, invocationKey, sourceRoute, usageTag, modelId, ok,
        inputTokens, outputTokens, cacheReadInputTokens, cacheWriteInputTokens, costSatang, requestKind, budgetBucket, usageBasis, eventKind, pricingSnapshot, createdAt })),
      reservations: holds.map(({ id, invocationKey, sourceRoute, stepKind, bucket, status, upperBoundSatang, settledCostSatang, usageBasis, pricingSnapshot, evidenceJson, createdAt, dispatchedAt, settledAt }: any) =>
        ({ id, invocationKey, sourceRoute, stepKind, bucket, status, upperBoundSatang, settledCostSatang, usageBasis, pricingSnapshot, evidenceJson, createdAt, dispatchedAt, settledAt })),
      reviewState: { before: state.reviewBefore, after: await readReviewState() }, businessSnapshot,
      businessSnapshotBefore: { business: beforeBusiness, collectionState: {} }, workflowPreviews, workflowTasks, unintendedEffects: businessEffects, delivery });
    if (evidence.reviewState.before.truncated || evidence.reviewState.after.truncated) state.errors.push('review_state_truncated');
    const previous = turnEvidence.findIndex(item => item.scenarioId === row.id && item.repeat === repeat && item.turnIndex === turnIndex);
    if (previous < 0) turnEvidence.push(evidence); else turnEvidence[previous] = evidence;
    await hooks.onTurn?.(evidence);
    return { inputDigest: reliabilityDigest({ user: turn.user, attachmentIds: turn.attachmentIds }), scopeDigest: reliabilityDigest(row.fixture),
      sourceSnapshot: row.fixture.sourceSnapshot, acceptedAtMs: state.acceptedAt, outcome, taskId: new Set(taskIds).size === 1 ? taskIds[0] : null,
      askedSlots: [...new Set(state.missing)], tools: state.tools, facts: runtimeSourceFacts(state.results, cited), effects: businessEffects,
      modelCalls: calls.length + unreported.length, costSatang: unreported.length || calls.some((item: any) => item.usageBasis !== 'PROVIDER_REPORTED') ? null : calls.reduce((sum: number, item: any) => sum + item.costSatang, 0),
      modelWorkCompletedAtMs: state.completedAt, delivery, falseRefusalOrHandoff: false, validationFailures: state.errors,
      criticalErrors: state.critical, versions: manifest.versions };
  };
  const adapter: ReliabilityReplayAdapter = {
    // A local LINE sink cannot prove native delivery even when the selected Gateway uses a live model.
    provenance: 'fixture',
    async reset(row, ordinal) {
      stage = 'quiescence';
      assert.equal(unsafeToReset, false, 'REPLAY_PREVIOUS_WORK_NOT_QUIESCENT');
      // `app` is only set once a PREVIOUS fixture ran — i.e. this is between conversations, never
      // before the very first one, exactly where a between-conversations pause belongs.
      if (app && CONVERSATION_PAUSE_MS > 0) { stage = 'conversation_pause'; await delay(CONVERSATION_PAUSE_MS); }
      if (app) { await app.close(); app = undefined; } active = undefined;
      turnStates = []; blockedPress = undefined; executionFailed = false;
      current = row; repeat = ordinal; snapshot = manifest.snapshots[row.fixture.sourceSnapshot];
      attemptId = runtimeAttemptId(row.id, ordinal);
      selectedCompanyId = row.fixture.company; selectedActorId = row.fixture.actor;
      assert.ok(snapshot && reliabilityDigest(snapshot) === manifest.snapshotDigests[row.fixture.sourceSnapshot], 'REPLAY_CONCRETE_SNAPSHOT_REQUIRED');
      const civil = (time: number) => new Intl.DateTimeFormat('en-CA', { timeZone: row.fixture.timezone }).format(time);
      assert.ok(snapshot.lineUserId && row.fixture.clock && civil(Date.parse(row.fixture.clock)) === civil(Date.now()), 'REPLAY_FIXTURE_BUSINESS_DATE_CHANGED');
      assert.ok(Object.keys(snapshot.assets).length === row.assets.length && Object.entries(snapshot.assets).every(([id, asset]) => row.assets.some(expected => expected.id === id && expected.sha256 === asset.sha256 && expected.mimeType === asset.mimeType)), 'REPLAY_ASSET_MANIFEST_MISMATCH');
      process.env.LINE_MESSAGING_CHANNEL_ID = row.fixture.messagingChannelId;
      Logger.overrideLogger(false);
      stage = 'nest_create';
      app = await NestFactory.create(AppModule, { abortOnError: false, logger: false, rawBody: true });
      client = app.get(PrismaService).client;
      stage = 'redis_reset';
      if (redis.status === 'wait') await redis.connect();
      const owner = await redis.get(redisOwnerKey);
      assert.ok(owner === redisOwner || owner === null && await redis.dbsize() === 0, 'REPLAY_REDIS_CONTAINS_OTHER_WORK');
      await redis.flushdb(); await redis.set(redisOwnerKey, redisOwner);
      stage = 'database_reset';
      await resetRuntimeAfterHook(hooks.onBeforeReset, row, attemptId,
        () => resetRuntimeFixtureDatabase(databaseLock, manifest.databaseUrl));
      for (const [index, seed] of snapshot.rows.entries()) { assert.ok(/^[a-z][A-Za-z0-9]*$/.test(seed.model) && typeof client[seed.model]?.create === 'function', 'REPLAY_INVALID_SEED_MODEL'); stage = `seed:${index}:${seed.model}`; await client[seed.model].create({ data: seed.data }); }
      if (manifest.bootstrapLaunchGates === true) {
        stage = 'launch_gate_bootstrap';
        const { seedLaunchGates } = requireApi(resolve(compiled, 'modules/feature-launch/application/seed-launch-gates.js'));
        await seedLaunchGates(app.get(PrismaService));
      }
      stage = 'seed_access_validation';
      instrumentRuntimeMethod(app.get(LineDraftPreviewStore), 'save', async (save, args) => {
        const saved = await save(...args);
        if (saved && active) active.previewEntries.push(structuredClone(args[0]));
        return saved;
      });
      const entitlementRows = await client.companyFeatureEntitlement.findMany({ where: { companyId: row.fixture.company }, select: { featureKey: true, enabled: true } });
      assert.ok(entitlementRows.length, 'REPLAY_EXPLICIT_ENTITLEMENT_SEED_REQUIRED');
      assert.deepEqual(entitlementRows.filter((item: any) => item.enabled).map((item: any) => item.featureKey).sort(),
        [...row.fixture.enabledFeatures].sort(), 'REPLAY_ENTITLEMENT_SEED_MISMATCH');
      if (!row.fixture.membership) assert.equal(await client.companyMembership.count({ where: {
        companyId: row.fixture.company, userId: row.fixture.actor, status: 'ACTIVE',
      } }), 0, 'REPLAY_UNLINKED_OR_REVOKED_SEED_MISMATCH');
      if (row.fixture.membership) {
        const access = await app.get(PermissionResolverService).resolveAccess(row.fixture.actor, row.fixture.company);
        assert.equal(access.membershipId, row.fixture.membership, 'REPLAY_MEMBERSHIP_SEED_MISMATCH');
        assert.deepEqual([...access.permissions].sort(), [...row.fixture.permissions].sort(), 'REPLAY_PERMISSION_SEED_MISMATCH');
        assert.deepEqual([...access.scopes.branchIds].sort(), [...row.fixture.branches].sort(), 'REPLAY_BRANCH_SEED_MISMATCH');
      }
      instrumentRuntimeMethod(app.get(InternalToolsController), 'invoke', async (invoke, args) => { const dto = args[2], state = active, startedAtMs = Date.now(); try { const result = await invoke(...args);
        state?.tools.push({ tool: dto.toolName, input: dto.input, resultHash: reliabilityDigest(result), status: result.status }); state?.results.push(result);
        state?.toolResults.push(structuredClone({ tool: dto.toolName, input: dto.input, startedAtMs, completedAtMs: Date.now(), result })); return result;
      } catch (error) { state?.tools.push({ tool: dto.toolName, input: dto.input, resultHash: reliabilityDigest({ failed: true }), status: 'error' });
        state?.toolResults.push(structuredClone({ tool: dto.toolName, input: dto.input, startedAtMs, completedAtMs: Date.now(), failed: true })); throw error; } });
      const gateway = app.get(AiGatewayClient);
      const webhook = app.get(ProcessLineWebhookUseCase);
      // response_ready clears the replay payload before delivery finishes. Do not move the
      // active receipt owner to the next turn while the real buffer handler is still running.
      for (const method of ['execute', 'executeReceiptUpload']) instrumentRuntimeMethod(webhook, method, async (original, args) => {
        processingWebhook++;
        try { return await original(...args); }
        catch (error) {
          active?.errors.push(`${method}_failed`);
          runtimeDiagnostics.push({ scenarioId: row.id, repeat, phase: 'webhook', stage: method, error: runtimeFailureDiagnostic(error) });
          throw error;
        } finally { processingWebhook--; }
      });
      instrumentRuntimeMethod(webhook, 'sendMessagesV2', async (original, args) => {
        const result = await original(...args);
        const coverage = webhook.semanticDelivery.get(args[0]);
        if (active && coverage) active.deliveryCoverage = structuredClone(coverage);
        return result;
      });
      for (const method of ['requestLineTurn', 'requestLinePublicGeneral', 'requestLineIntakeRoute', 'requestLineDocumentQa', 'requestLineWorkflowClassify']) {
        if (typeof gateway[method] !== 'function') continue;
        instrumentRuntimeMethod(gateway, method, async (original, args) => { const state = active, startedAtMs = Date.now(); if (state) state.requests.push(args[0].requestId); try { const result = await original(...args);
          if (state) { state.completedAt = Date.now(); if (Array.isArray(result.sourceRefs)) state.responses.push(result);
            state.gatewayResponses.push(structuredClone({ method, requestId: args[0].requestId, startedAtMs, completedAtMs: state.completedAt, response: result }));
            state.missing.push(...runtimeAskedSlots(result)); } return result;
        } catch (error) {
          state?.errors.push(`${method}_failed`);
          runtimeDiagnostics.push({ scenarioId: row.id, repeat, phase: 'gateway', stage: method, error: runtimeFailureDiagnostic(error) });
          throw error;
        } });
      }
      stage = 'nest_listen';
      app.setGlobalPrefix('v1'); app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS)); await app.listen(manifest.apiPort, '127.0.0.1');
    },
    async turn(row, turnIndex) {
      await hooks.onBeforeTurn?.(row, turnIndex, attemptId);
      // Not before the fixture's first turn — that gap is CONVERSATION_PAUSE_MS, taken in reset().
      if (turnIndex > 0 && TURN_PAUSE_MS > 0) { stage = 'turn_pause'; await delay(TURN_PAUSE_MS); }
      stage = `turn:${turnIndex}`;
      assert.equal(current?.id, row.id); assert.ok(snapshot && app);
      await redis.ping();
      active = undefined;
      const turn = row.turns[turnIndex]!, replayTurn = turn as typeof turn & RuntimeReplayTurn;
      const prefix = runtimeEventIdPrefix(attemptId, turnIndex), action = replayTurn.action;
      const actorKey = replayTurn.pressFrom ?? action?.pressFrom, actor = actorKey ? snapshot.actors?.[actorKey] : undefined;
      if (actorKey) assert.ok(actor, 'REPLAY_UNKNOWN_PRESS_ACTOR');
      const actorContext = await runtimeActorContext(actor, { companyId: row.fixture.company, userId: row.fixture.actor, lineUserId: snapshot.lineUserId },
        (userId, companyId) => app.get(PermissionResolverService).resolveAccess(userId, companyId));
      selectedCompanyId = actorContext.companyId;
      selectedActorId = actorContext.userId;
      if (!blockedPress) await executeRuntimeFixtureOperations(replayTurn.fixture ?? [], { databaseUrl: manifest.databaseUrl, client, redis,
        companyId: selectedCompanyId, userId: selectedActorId,
        chatKeyHash: hashMessagePreview(row.fixture.channelKind === 'USER' ? actorContext.lineUserId : row.fixture.chat), seedRows: snapshot.rows });
      const postbackLabel = action?.type === 'postback' ? action.label : (actor?.postbackLabels ?? snapshot.postbackLabels)?.[turnIndex];
      const selection = !blockedPress && postbackLabel ? resolveRuntimePostback(runtimePressReceipts(turnStates, turnIndex, replayTurn), postbackLabel) : undefined;
      const replayFailure: RuntimeReplayFailure | undefined = blockedPress ? { reason: 'turn_unreached', turnIndex, blockedByTurnIndex: blockedPress.turnIndex }
        : selection?.failure ? { reason: selection.failure, turnIndex } : undefined;
      if (selection?.failure) blockedPress = replayFailure;
      const postbackData = selection?.data;
      if (postbackLabel && !action) assert.ok(turn.user === postbackLabel && !turn.attachmentIds.length, 'REPLAY_POSTBACK_INPUT_MISMATCH');
      const source = { type: row.fixture.channelKind.toLowerCase(), userId: actorContext.lineUserId,
        ...(row.fixture.channelKind === 'GROUP' ? { groupId: row.fixture.chat } : row.fixture.channelKind === 'ROOM' ? { roomId: row.fixture.chat } : {}) };
      if (action?.type === 'uri' || replayFailure) {
        const at = Date.now(), before = await readEffects(), usageIds = new Set<string>((await client.aiUsageEvent.findMany({ select: { id: true } })).map((item: any) => item.id));
        const review = await readReviewState();
        const state = { acceptedAt: at, eventIds: [], before, usageIds, tools: [], results: [], responses: [], deliveryCoverage: null, missing: [], requests: [],
          completedAt: null, errors: [], critical: [], receipts: [], toolResults: [], gatewayResponses: [], reviewBefore: review, inputKind: action?.type ?? 'message', action, pressFrom: actorKey,
          previewEntries: [], lineUserId: actorContext.lineUserId } as NonNullable<typeof active>;
        active = state; turnStates.push(state);
        const delivery = runtimeDeliveryEvidence([], [], []), businessSnapshot = runtimeBusinessSnapshot(before);
        const evidence = captureRuntimeTurnEvidence({ scenarioId: row.id, repeat, turnIndex, user: turn.user, attachmentIds: turn.attachmentIds,
          inputKind: state.inputKind, action, ...(actorKey ? { pressFrom: actorKey } : {}), ...(replayFailure ? { replayFailure } : {}),
          companyId: selectedCompanyId, sourceSnapshot: row.fixture.sourceSnapshot, snapshotDigest: manifest.snapshotDigests[row.fixture.sourceSnapshot]!,
          webBaseUrl: app.get(AppConfigService).webBaseUrl, acceptedAtMs: at, modelWorkCompletedAtMs: null, receipts: [], toolResults: [], gatewayResponses: [],
          webhookEvents: [], providerUsage: [], reservations: [], reviewState: { before: review, after: review }, businessSnapshot, unintendedEffects: [], delivery });
        turnEvidence.push(evidence); await hooks.onTurn?.(evidence);
        return { inputDigest: reliabilityDigest({ user: turn.user, attachmentIds: turn.attachmentIds }), scopeDigest: reliabilityDigest(row.fixture),
          sourceSnapshot: row.fixture.sourceSnapshot, acceptedAtMs: at, outcome: replayFailure ? 'unreached' : 'web_handoff', taskId: null, askedSlots: [], tools: [], facts: [], effects: [],
          modelCalls: 0, costSatang: 0, modelWorkCompletedAtMs: null, delivery, falseRefusalOrHandoff: false, validationFailures: replayFailure ? [replayFailure.reason] : [], criticalErrors: [], versions: manifest.versions };
      }
      const assetIds = action?.type === 'camera' ? [action.assetId] : turn.attachmentIds;
      const messageText = action?.type === 'message' ? action.text : turn.user;
      const inputs = action?.type === 'postback' ? [{ type: 'postback', label: action.label }]
        : [...assetIds.map(id => runtimeAttachmentMessage(runtimeAssetMessageId(attemptId, turnIndex, id), snapshot!.assets[id], repoRoot)), ...(messageText ? [{ type: 'text', text: messageText, id: `${prefix}-text` }] : [])];
      const before = await readEffects(), usageIds = new Set<string>((await client.aiUsageEvent.findMany({ select: { id: true } })).map((item: any) => item.id));
      const at = Date.now();
      active = { acceptedAt: at, eventIds: inputs.map((_, index) => `${prefix}-${index}`), before, usageIds,
        tools: [], results: [], responses: [], deliveryCoverage: null, missing: [], requests: [], completedAt: null, errors: [], critical: [], receipts: [], toolResults: [], gatewayResponses: [], reviewBefore: await readReviewState(),
        inputKind: action?.type ?? (assetIds.length ? 'camera' : 'message'), action, pressFrom: actorKey, previewEntries: [], lineUserId: actorContext.lineUserId };
      turnStates.push(active);
      const body = { destination: row.fixture.messagingChannelId, events: inputs.map((message, index) => ({
        ...(postbackData ? { type: 'postback', postback: { data: postbackData } } : { type: 'message', message }),
        webhookEventId: active!.eventIds[index], replyToken: `${prefix}-${index}-token`, timestamp: at, source })) };
      const rawBody = Buffer.from(JSON.stringify(body));
      await app.get(LineWebhookController).lineWebhook({ body, rawBody, headers: { 'x-line-signature': createHmac('sha256', secret).update(rawBody).digest('base64') } });
      const deadline = Date.now() + Math.max(60_000, ...row.turns.map(item => item.expect.deadlineMs));
      let settled = false;
      while (Date.now() < deadline) {
        const events = await client.lineWebhookEventLog.findMany({ where: { webhookEventId: { in: active.eventIds } } });
        // Same durable QA worker used by the ordinary scheduled drain; no re-created jobs/grants.
        if (app.get(AppConfigService).lineAiDocumentQaEnabled) { await app.get(LineDocumentQaWorker).drain(); await app.get(ProcessLineWebhookUseCase).recoverDocumentQaResults(); }
        await app.get(ExpenseCaptureReadRunnerService).drain(); await app.get(LineCaptureResultNotifierUseCase).execute();
        if (!await pendingWork() && events.length === active.eventIds.length && events.every((event: any) => event.processedAt && !event.payloadJson)) { settled = true; break; }
        await delay(50);
      }
      if (!settled) throw new Error('REPLAY_TERMINAL_TIMEOUT');
      if (active.infrastructureError) throw active.infrastructureError;
      active.completedAt ??= Date.now(); return collect(row, turnIndex);
    },
    async afterFailure(row, index) {
      executionFailed = true;
      if (!active) return null; active.errors.push('runtime_execution_failed');
      // A timed-out fire-and-forget job cannot be allowed to write into the next reset snapshot.
      unsafeToReset = await pendingWork() > 0;
      if (unsafeToReset) active.critical.push('unresolved_background_work');
      return collect(row, index);
    },
    async finalize(row, traces) {
      stage = 'finalize';
      const receipts = turnStates.flatMap(state => state.receipts);
      for (const [index, trace] of traces.entries()) {
        const state = turnStates[index]!;
        const plans = await client.lineDeliveryPlan.findMany({ where: { companyId: row.fixture.company, createdAt: {
          gte: new Date(state.acceptedAt), ...(turnStates[index + 1] ? { lt: new Date(turnStates[index + 1]!.acceptedAt) } : {}),
        } } });
        const outcomes = await client.lineTurnOutcome.findMany({ where: { webhookEventId: { in: state.eventIds } } });
        trace.delivery = runtimeDeliveryEvidence(plans, outcomes, receipts);
        const evidence = turnEvidence.find(item => item.scenarioId === row.id && item.repeat === repeat && item.turnIndex === index);
        if (evidence) evidence.delivery = structuredClone(trace.delivery);
      }
      if (!executionFailed) await hooks.onConversationComplete?.(row, attemptId);
    },
  };
  for (const method of ['reset', 'turn', 'finalize'] as const) instrumentRuntimeMethod(adapter, method, async (original, args) => {
    try { return await original(...args); }
    catch (error) { runtimeDiagnostics.push({ scenarioId: args[0].id, repeat: method === 'reset' ? args[1] : repeat, phase: method, stage, error: runtimeFailureDiagnostic(error) }); throw error; }
  });
  try {
    await databaseLock.connect();
    const locked = await databaseLock.query("SELECT pg_try_advisory_lock(hashtext('line-reliability-runtime-reset')) AS locked");
    assert.equal(locked.rows[0]?.locked, true, 'REPLAY_DATABASE_IN_USE');
    const replay = await replayReliabilityCorpus(manifest.corpus, adapter, { repeats: manifest.repeats, cohort: manifest.cohort, cache: 'unknown', stopOnError: true });
    return { ...replay, turnEvidence, runtimeDiagnostics, boundary: { runtime: 'compiled_nest_api_postgres', line: 'synthetic_http_sink', nativeLineVerified: false, cacheStateVerified: false, activationEligible: false } };
  } finally { try { if (app) await app.close(); } finally { redis.disconnect(); await databaseLock.end(); globalThis.fetch = originalFetch; Logger.overrideLogger(true); } }
}
