import { parseLinePackageOffers } from '@watchdog-bms/contracts';
import { lineReplyLanguage } from '@watchdog-bms/contracts';
/**
 * AgentCore Runtime entry point – item 10B Phase 8.
 * Exposes GET /ping and POST /invocations per AgentCore HTTP protocol.
 * Runs standalone (no NestJS DI); constructs dependencies from env vars.
 *
 * Deployment: CodeZip/direct-code preferred (see agentcore.json).
 * Container/ECR fallback only when dependency size blocks CodeZip.
 *
 * LINE and web must never call this endpoint directly.
 * AI Gateway invokes this runtime server-side by ARN/id + qualifier.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import {
  lineChatAction,
  LINE_AI_ACTOR_DELEGATIONS_PER_TOOL,
  LINE_AI_CONTEXT_WINDOW_MINUTES,
  LINE_AI_CONTEXT_MAX_TURNS,
  LINE_AI_RUNTIME_CONTRACT_VERSION,
  AI_BUDGET_ESTIMATOR_VERSION_V2,
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
  parseLineAiPreparedPlan,
  parseLineAiTurnValueCandidates,
  verifyLineAiValueCandidatesV2,
  parseLineAiInputEvidence,
  parseLineAiResponsePreferences,
  parseLineAiTaskProjection,
  parseLineAiSemanticSubrequests, lineAiReplyClarifications, parseLineAiOpenClarifications,
  lineAiRetainedTaskSourceMatchesProjection,
  parseLineAiRetainedTaskSource,
  verifyLineAiRetainedTaskSource,
  parseAiBudgetGrantV2,
  aiBudgetV2RepairsBefore,
  extractValueCandidates,
  asIntakeRouteIntent,
} from '@watchdog-bms/contracts';
import type { LineAiPreparedPlan, LineAiReadMemory, LineAiReadMemoryShownItem, LineAiTurnRequest, LineIntakeRouteIntent } from '@watchdog-bms/contracts';
import type { AgentRunResult } from '../modules/line-ai/agents/agent-types';
import { drainUsage, runWithUsageContext, type BudgetRequestState } from '../common/usage/usage-context';
import { AI_BUDGET_V2_SUPPORTED } from '../common/usage/ai-budget-provider';

const PORT = parseInt(process.env['PORT'] ?? '8080', 10);
const MAX_CONTEXT_TURNS = LINE_AI_CONTEXT_MAX_TURNS;
const MAX_CONTEXT_TEXT_CHARS = 500;

/**
 * L-12: invocation bounds. This entrypoint runs standalone (no Nest, no config service), so the
 * limits are read straight from `process.env` under the same names and defaults the gateway config
 * schema declares (AGENTCORE_MAX_*). Read per call, not at module load, so nothing is hardcoded at
 * a call site and an operator can raise a limit without a code change.
 */
function limit(key: string, fallback: number): number {
  const parsed = Number(process.env[key]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
const maxBodyBytes = () => limit('AGENTCORE_MAX_BODY_BYTES', 1048576);
const maxMessageChars = () => limit('AGENTCORE_MAX_MESSAGE_CHARS', 8000);
const maxAttachments = () => limit('AGENTCORE_MAX_ATTACHMENTS', 10);
const maxConcurrentInvocations = () => limit('AGENTCORE_MAX_CONCURRENT_INVOCATIONS', 16);

export class PayloadTooLargeError extends Error {}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RuntimePayload = {
  turnId: string;
  companyId: string;
  userId: string;
 membershipId?: string;
  chatKeyHash?: string;
  branchIds?: string[];
  locationIds?: string[];
  roles?: string[];
  messageText: string;
  language?: 'th' | 'en';
  locale?: string;
  permissions?: string[];
  entitlementDeniedPermissions?: Record<string, string>;
  /** Company feature entitlements. Absent = legacy fail-open, same as an older gateway that does
   *  not send them; the artifact must keep answering, just without entitlement-exact copy.
   *  `null` is the explicit server-resolved "no entitlement rows" form of the same fail-open. */
  entitledFeatureKeys?: string[] | null;
  packageOffers?: LineAiTurnRequest['packageOffers'];
  actorDelegations?: Record<string, string[]>;
  modelPolicy?: LineAiTurnRequest['modelPolicy'];
  attachments?: unknown[];
  conversationContext?: LineAiTurnRequest['conversationContext'];
  openClarifications?: LineAiTurnRequest['openClarifications'];
  resolvedClarificationIds?: LineAiTurnRequest['resolvedClarificationIds'];
  inputEvidence?: LineAiTurnRequest['inputEvidence'];
  contractCapabilities?: LineAiTurnRequest['contractCapabilities'];
  budgetGrantV2?: LineAiTurnRequest['budgetGrantV2'];
  approvedKnowledge?: LineAiTurnRequest['approvedKnowledge'];
  selectedKnowledgeCardIds?: LineAiTurnRequest['selectedKnowledgeCardIds'];
  howToActionId?: LineAiTurnRequest['howToActionId'];
  taskProjection?: LineAiTurnRequest['taskProjection'];
  responsePreferences?: LineAiTurnRequest['responsePreferences'];
  semanticSubrequests?: LineAiTurnRequest['semanticSubrequests'];
  retainedTaskSource?: LineAiTurnRequest['retainedTaskSource'];
  valueCandidates?: LineAiTurnRequest['valueCandidates'];
  /** Optional additive fused plan (latency/autonomy §7); re-parsed and bounded here, never cast. */
  preparedPlan?: LineAiPreparedPlan;
  /** Trusted outer intake provenance; re-validated by explicit membership here, never cast. */
  intakeIntent?: LineIntakeRouteIntent;
};

type RuntimeOrchestrator = { run(req: LineAiTurnRequest): Promise<AgentRunResult> };
let runtimeOrchestrator: Promise<RuntimeOrchestrator> | undefined;

// ── Helpers ────────────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function boundedString(value: unknown, max = MAX_CONTEXT_TEXT_CHARS): string | undefined {
  return typeof value === 'string' && value ? value.slice(0, max) : undefined;
}

function parseConversationContext(value: unknown): LineAiTurnRequest['conversationContext'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const turns = Array.isArray(raw['recentTurns']) ? raw['recentTurns'] : [];
  const recentTurns = turns.slice(-MAX_CONTEXT_TURNS).flatMap((turn) => {
    if (!turn || typeof turn !== 'object') return [];
    const t = turn as Record<string, unknown>;
    const at = boundedString(t['at'], 64);
    if (!at) return [];
    const userMessagePreview = boundedString(t['userMessagePreview']);
    const assistantReplyPreview = boundedString(t['assistantReplyPreview']);
    const intent = boundedString(t['intent'], 64);
    const agent = boundedString(t['agent'], 64);
    return [{
      at,
      ...(userMessagePreview && { userMessagePreview }),
      ...(assistantReplyPreview && { assistantReplyPreview }),
      ...(intent && { intent }),
      ...(agent && { agent }),
      ...(typeof t['refused'] === 'boolean' && { refused: t['refused'] }),
    }];
  });
  if (recentTurns.length === 0) return undefined;
  const lastTurnAt = boundedString(raw['lastTurnAt'], 64);
  const summaryRaw = raw['deliveredExpenseSummary'];
  const deliveredExpenseSummary = summaryRaw && typeof summaryRaw === 'object' && !Array.isArray(summaryRaw)
    ? parseDeliveredExpenseSummary(summaryRaw)
    : undefined;
  const recentReads = Array.isArray(raw['recentReads']) ? parseRecentReads(raw['recentReads']) : undefined;
  return {
    windowMinutes: LINE_AI_CONTEXT_WINDOW_MINUTES,
    maxTurns: MAX_CONTEXT_TURNS,
    ...(lastTurnAt && { lastTurnAt }),
    recentTurns,
    ...(deliveredExpenseSummary ? { deliveredExpenseSummary } : {}),
    ...(recentReads ? { recentReads } : {}),
  };
}

// Spec §4 R-M2: at most 3, matching the API loader's own cap — bounded again here rather than cast,
// same as every other conversationContext field this parser rebuilds field-by-field.
const MAX_RECENT_READS = 3;
const MAX_SHOWN_ITEMS = 10;

function parseReadMemoryShownItem(value: unknown): LineAiReadMemoryShownItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = boundedString(raw['id'], 200);
  const label = boundedString(raw['label'], 200);
  if (typeof raw['ordinal'] !== 'number' || !Number.isSafeInteger(raw['ordinal']) || raw['ordinal'] < 1 || !id || !label) return undefined;
  const date = boundedString(raw['date'], 32);
  const kind = raw['kind'];
  return {
    ordinal: raw['ordinal'], id, label,
    ...(date && { date }),
    ...((kind === 'category' || kind === 'branch' || kind === 'vendor') && { kind }),
  };
}

/** R-M6: no amount field exists on LineAiReadMemory's type, so this parser — like every other field
 *  here — simply never has one to copy; there is no separate stripping step to keep correct. */
const CLAIM_FILTER_KEYS = new Set(['requester', 'requesterName', 'categoryName', 'round', 'status', 'paymentStatus', 'amountGt', 'amountGte', 'amountLt', 'amountLte']);

/** R22: the claim filters the API recorded for a claim summary, so "ของเขา"/"กลุ่มนั้น" repeats that query. Amount bounds
 *  describe the query, never a returned figure (R-M6). Any unknown key or malformed value drops the whole object. */
function parseClaimFilters(value: unknown): LineAiReadMemory['claimFilters'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key, item]) => !CLAIM_FILTER_KEYS.has(key) || typeof item !== 'string' || !item || item.length > 80
    || key === 'requester' && item !== 'me' || key.startsWith('amount') && !/^\d+(?:\.\d{1,2})?$/u.test(item))) return undefined;
  return Object.fromEntries(entries) as LineAiReadMemory['claimFilters'];
}

function parseReadMemoryEntry(value: unknown): LineAiReadMemory | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const tool = boundedString(raw['tool'], 128);
  const asOf = boundedString(raw['asOf'], 64);
  if (!tool || !asOf || !Number.isFinite(Date.parse(asOf))
    || (raw['answerShape'] !== 'single_metric' && raw['answerShape'] !== 'list')) return undefined;
  const periodRaw = raw['period'];
  const period = periodRaw && typeof periodRaw === 'object' && !Array.isArray(periodRaw)
    ? (() => {
      const p = periodRaw as Record<string, unknown>;
      return typeof p['fromDate'] === 'string' && isCivilDate(p['fromDate']) && typeof p['toDate'] === 'string' && isCivilDate(p['toDate'])
        ? { fromDate: p['fromDate'], toDate: p['toDate'] } : undefined;
    })()
    : undefined;
  const groupByRaw = raw['groupBy'];
  const groupBy = groupByRaw === 'category' || groupByRaw === 'branch' || groupByRaw === 'vendor' ? groupByRaw : undefined;
  const shownItemsRaw = Array.isArray(raw['shownItems']) ? raw['shownItems'].slice(0, MAX_SHOWN_ITEMS) : [];
  const shownItems = shownItemsRaw.flatMap((item) => {
    const parsed = parseReadMemoryShownItem(item);
    return parsed ? [parsed] : [];
  });
  const documentStatus = boundedString(raw['documentStatus'], 64);
  const paymentStatus = boundedString(raw['paymentStatus'], 64);
  const categoryId = boundedString(raw['categoryId'], 200);
  const categoryName = boundedString(raw['categoryName'], 200);
  const vendorId = boundedString(raw['vendorId'], 200);
  const vendorName = boundedString(raw['vendorName'], 200);
  const branchId = boundedString(raw['branchId'], 200);
  const branchName = boundedString(raw['branchName'], 200);
  const claimFilters = tool === 'reimbursement.get_summary' ? parseClaimFilters(raw['claimFilters']) : undefined;
  return {
    tool, answerShape: raw['answerShape'], asOf,
    ...(claimFilters && { claimFilters }),
    ...(period && { period }),
    ...(documentStatus && { documentStatus }),
    ...(paymentStatus && { paymentStatus }),
    ...(categoryId && { categoryId }),
    ...(categoryName && { categoryName }),
    ...(vendorId && { vendorId }),
    ...(vendorName && { vendorName }),
    ...(branchId && { branchId }),
    ...(branchName && { branchName }),
    ...(groupBy && { groupBy }),
    ...(shownItems.length > 0 && { shownItems }),
  };
}

function parseRecentReads(value: unknown[]): LineAiReadMemory[] | undefined {
  const entries = value.slice(0, MAX_RECENT_READS).flatMap((item) => {
    const parsed = parseReadMemoryEntry(item);
    return parsed ? [parsed] : [];
  });
  return entries.length > 0 ? entries : undefined;
}

function parseDeliveredExpenseSummary(value: unknown): NonNullable<LineAiTurnRequest['conversationContext']>['deliveredExpenseSummary'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const deliveredAt = boundedString(raw['deliveredAt'], 64);
  const ranges = Array.isArray(raw['ranges']) ? raw['ranges'] : [];
  if (raw['version'] !== 1 || !deliveredAt || !Number.isFinite(Date.parse(deliveredAt))
    || raw['statusBasis'] !== 'exclude_rejected_voided' || ranges.length === 0 || ranges.length > 24) return undefined;
  const parsed = ranges.flatMap((range) => {
    if (!range || typeof range !== 'object' || Array.isArray(range)) return [];
    const item = range as Record<string, unknown>;
    const fromDate = item['fromDate'], toDate = item['toDate'], branchId = item['branchId'];
    if (typeof fromDate !== 'string' || !isCivilDate(fromDate) || typeof toDate !== 'string' || !isCivilDate(toDate)
      || fromDate > toDate || !(branchId === null || (typeof branchId === 'string' && branchId.length <= 200))) return [];
    return [{ fromDate, toDate, branchId }];
  });
 return parsed.length === ranges.length
    ? { version: 1, deliveredAt, statusBasis: 'exclude_rejected_voided',
      ...(raw['continuationOfPrior'] === true ? { continuationOfPrior: true as const } : {}), ranges: parsed }
    : undefined;
}

function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseActorDelegations(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length === 0
    || entries.length > 128
    || entries.some(([toolName, tokens]) =>
      !toolName
      || !Array.isArray(tokens)
      || tokens.length === 0
      || tokens.length > LINE_AI_ACTOR_DELEGATIONS_PER_TOOL
      || tokens.some((token) => typeof token !== 'string' || !token || token.length > 4096))
  ) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string[]>;
}

function parseDeniedPermissions(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 512 || entries.some(([permission, feature]) =>
    !permission || permission.length > 200 || typeof feature !== 'string' || !feature || feature.length > 200)) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseEntitledFeatureKeys(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 256
    || value.some((key) => typeof key !== 'string' || !key || key.length > 200)) return undefined;
  return [...new Set(value as string[])];
}

/**
 * L-12: the byte cap is enforced *while streaming*, never after buffering. A declared
 * Content-Length over the cap is refused before a single `data` listener is attached, and a
 * chunked body is counted as it arrives and abandoned the moment it crosses the cap — so one large
 * POST can no longer buffer to heap and OOM the container.
 * Exported for the spec: the "without reading the body" claim is only checkable here.
 */
export async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new PayloadTooLargeError();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        // Stop pulling bytes (TCP backpressure) and stop counting: nothing more is buffered, and
        // the caller is free to discard the rest of the upload while it answers 413.
        req.off('data', onData);
        req.pause();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(Buffer.from(chunk));
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** How long the socket stays open draining an over-cap upload so the 413 can reach the client. */
const PAYLOAD_TOO_LARGE_LINGER_MS = 250;

/**
 * L-12: answer 413 *and* let the client see it. Destroying the socket while the client is still
 * uploading closes it with unread bytes queued, which is a TCP reset — and a reset discards the
 * response the client had already buffered, so the caller observes ECONNRESET instead of the 413
 * (measured on loopback with an 8 MB over-cap upload: 1/20 clients saw the 413 before this change,
 * 14–18/20 after). So: mark the connection closing, then discard — never buffer — whatever is still
 * in flight for a bounded window, and destroy on end-of-body or when the window expires.
 * Delivery is much likelier, not guaranteed: a client that keeps a large backlog in flight past the
 * window still gets reset, which is inherent to closing a socket with unread data.
 */
function answerPayloadTooLarge(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Connection', 'close');
  json(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
  req.resume();
  const stopLingering = setTimeout(() => req.destroy(), PAYLOAD_TOO_LARGE_LINGER_MS);
  req.on('end', () => { clearTimeout(stopLingering); req.destroy(); });
  res.on('close', () => clearTimeout(stopLingering));
}

// ── AgentCore invocation payload validation ────────────────────────────────────

/**
 * L-12: message text and prompt are bounded before the orchestrator sees them. Over-limit text is
 * rejected rather than silently truncated — a half-message answered as if whole is its own bug.
 */
function boundedMessageText(value: unknown, max = maxMessageChars()): string | undefined {
  return typeof value === 'string' && value && value.length <= max ? value : undefined;
}

function parseV2InputFields(p: Record<string, unknown>, messageText: string): Pick<RuntimePayload, 'inputEvidence' | 'contractCapabilities' | 'budgetGrantV2' | 'taskProjection' | 'responsePreferences' | 'semanticSubrequests' | 'retainedTaskSource' | 'openClarifications' | 'resolvedClarificationIds'> | null {
  const hasV2Field = p['inputEvidence'] !== undefined || p['budgetGrantV2'] !== undefined
    || p['contractCapabilities'] !== undefined || p['retainedTaskSource'] !== undefined;
  if (!hasV2Field) return {};
  const capabilities = p['contractCapabilities'];
  const evidence = parseLineAiInputEvidence(p['inputEvidence'], messageText);
  const grant = parseAiBudgetGrantV2(p['budgetGrantV2']);
  if (!Array.isArray(capabilities) || capabilities.length !== 2
    || !capabilities.includes('input-evidence-v2') || !capabilities.includes('budget-envelope-v2')
    || !evidence || !grant || evidence.turnKey !== grant.turnKey) return null;
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
  if (evidence.parts.some((part) => digest(part.rawText) !== part.rawSha256)
    || digest(evidence.parts.map((part) => part.rawText).join('\n')) !== evidence.joinedSha256) return null;
  const taskProjection = p['taskProjection'] === undefined ? undefined : parseLineAiTaskProjection(p['taskProjection']);
  const responsePreferences = p['responsePreferences'] === undefined ? undefined : parseLineAiResponsePreferences(p['responsePreferences']);
  const openClarifications = p['openClarifications'] === undefined ? undefined : parseLineAiOpenClarifications(p['openClarifications']);
  if (p['openClarifications'] !== undefined && !openClarifications) return null;
  const resolvedClarificationIds = p['resolvedClarificationIds'] === undefined ? undefined : Array.isArray(p['resolvedClarificationIds'])
    ? p['resolvedClarificationIds'].filter((id): id is string => typeof id === 'string' && !!openClarifications?.some(entry => entry.id === id)) : [];
  const semanticSubrequests = p['semanticSubrequests'] === undefined ? undefined
    : parseLineAiSemanticSubrequests(p['semanticSubrequests'], messageText, evidence, lineAiReplyClarifications(openClarifications, resolvedClarificationIds));
  const retainedTaskSource = p['retainedTaskSource'] === undefined ? undefined
    : parseLineAiRetainedTaskSource(p['retainedTaskSource']);
  if (p['taskProjection'] !== undefined && !taskProjection
    || p['responsePreferences'] !== undefined && !responsePreferences
    || p['semanticSubrequests'] !== undefined && !semanticSubrequests
    || p['retainedTaskSource'] !== undefined && (!retainedTaskSource
      || !lineAiRetainedTaskSourceMatchesProjection(retainedTaskSource, taskProjection, 'turn'))) return null;
  return { inputEvidence: evidence, contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'], budgetGrantV2: grant,
    ...(taskProjection ? { taskProjection } : {}), ...(responsePreferences ? { responsePreferences } : {}),
    ...(openClarifications ? { openClarifications } : {}), ...(resolvedClarificationIds ? { resolvedClarificationIds } : {}),
    ...(semanticSubrequests ? { semanticSubrequests } : {}), ...(retainedTaskSource ? { retainedTaskSource } : {}) };
}

/** L-12: `null` = over the attachment cap (reject the payload); a non-array stays tolerated as []. */
function boundedAttachments(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return [];
  return value.length > maxAttachments() ? null : value;
}

function boundedKnowledgeCardIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 5) return undefined;
  const ids = value.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(id));
  return ids.length === value.length && new Set(ids).size === ids.length ? ids : undefined;
}

export function validatePayload(body: unknown): RuntimePayload | null {
  if (typeof body !== 'object' || body === null) return null;
  const p = body as Record<string, unknown>;
  const attachments = boundedAttachments(p['attachments']);
  if (attachments === null) return null;
  if (typeof p['prompt'] === 'string' && p['prompt']) {
    const prompt = boundedMessageText(p['prompt'], p['inputEvidence'] !== undefined ? 12_000 : undefined);
    if (!prompt) return null;
    const v2 = parseV2InputFields(p, prompt);
    if (!v2) return null;
    const valueCandidates = parseLineAiTurnValueCandidates(p['valueCandidates'], prompt);
    const versionedCandidates = !!p['valueCandidates'] && typeof p['valueCandidates'] === 'object'
      && (p['valueCandidates'] as Record<string, unknown>)['version'] === 2;
    if (versionedCandidates && !valueCandidates) return null;
    return {
      turnId: typeof p['turnId'] === 'string' && p['turnId'] ? p['turnId'] : `playground-${Date.now()}`,
      companyId: typeof p['companyId'] === 'string' && p['companyId'] ? p['companyId'] : 'playground-company',
      userId: typeof p['userId'] === 'string' && p['userId'] ? p['userId'] : 'playground-user',
     membershipId: typeof p['membershipId'] === 'string' ? p['membershipId'] : undefined,
      chatKeyHash: typeof p['chatKeyHash'] === 'string' && /^[a-f0-9]{16,64}$/.test(p['chatKeyHash']) ? p['chatKeyHash'] : undefined,
      branchIds: Array.isArray(p['branchIds']) ? (p['branchIds'] as string[]) : undefined,
      locationIds: Array.isArray(p['locationIds']) ? (p['locationIds'] as string[]) : undefined,
      roles: Array.isArray(p['roles']) ? (p['roles'] as string[]) : undefined,
      messageText: prompt,
      locale: typeof p['locale'] === 'string' ? p['locale'] : 'th-TH',
      ...(p['language'] === 'th' || p['language'] === 'en' ? { language: p['language'] } : {}),
      permissions: Array.isArray(p['permissions']) ? (p['permissions'] as string[]) : [],
      entitlementDeniedPermissions: parseDeniedPermissions(p['entitlementDeniedPermissions']),
      entitledFeatureKeys: parseEntitledFeatureKeys(p['entitledFeatureKeys']),
      packageOffers: parseLinePackageOffers(p['packageOffers']),
      actorDelegations: parseActorDelegations(p['actorDelegations']),
      modelPolicy: parseModelPolicy(p['modelPolicy']),
      attachments,
      conversationContext: parseConversationContext(p['conversationContext']),
      ...v2,
      ...(lineChatAction(p['howToActionId']) ? { howToActionId: lineChatAction(p['howToActionId'])!.id } : {}),
      ...(p['approvedKnowledge'] === true ? { approvedKnowledge: true } : {}),
      ...(boundedKnowledgeCardIds(p['selectedKnowledgeCardIds']) ? { selectedKnowledgeCardIds: boundedKnowledgeCardIds(p['selectedKnowledgeCardIds']) } : {}),
      valueCandidates: versionedCandidates ? valueCandidates : valueCandidates
        ?? (p['valueCandidates'] ? extractValueCandidates(prompt, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })) : undefined),
      preparedPlan: parseLineAiPreparedPlan(p['preparedPlan'], v2?.inputEvidence ? { inputEvidence: v2.inputEvidence } : undefined),
      intakeIntent: asIntakeRouteIntent(p['intakeIntent']),
    };
  }
  if (typeof p['turnId'] !== 'string' || !p['turnId']) return null;
  if (typeof p['companyId'] !== 'string' || !p['companyId']) return null;
  if (typeof p['userId'] !== 'string' || !p['userId']) return null;
  const messageText = boundedMessageText(p['messageText'], p['inputEvidence'] !== undefined ? 12_000 : undefined);
  if (!messageText) return null;
  const v2 = parseV2InputFields(p, messageText);
  if (!v2) return null;
  const valueCandidates = parseLineAiTurnValueCandidates(p['valueCandidates'], messageText);
  const versionedCandidates = !!p['valueCandidates'] && typeof p['valueCandidates'] === 'object'
    && (p['valueCandidates'] as Record<string, unknown>)['version'] === 2;
  if (versionedCandidates && !valueCandidates) return null;
  return {
    turnId: p['turnId'],
    companyId: p['companyId'],
    userId: p['userId'],
   membershipId: typeof p['membershipId'] === 'string' ? p['membershipId'] : undefined,
    chatKeyHash: typeof p['chatKeyHash'] === 'string' && /^[a-f0-9]{16,64}$/.test(p['chatKeyHash']) ? p['chatKeyHash'] : undefined,
    branchIds: Array.isArray(p['branchIds']) ? (p['branchIds'] as string[]) : undefined,
    locationIds: Array.isArray(p['locationIds']) ? (p['locationIds'] as string[]) : undefined,
    roles: Array.isArray(p['roles']) ? (p['roles'] as string[]) : undefined,
    messageText,
    locale: typeof p['locale'] === 'string' ? p['locale'] : 'th-TH',
      ...(p['language'] === 'th' || p['language'] === 'en' ? { language: p['language'] } : {}),
    permissions: Array.isArray(p['permissions']) ? (p['permissions'] as string[]) : [],
    entitlementDeniedPermissions: parseDeniedPermissions(p['entitlementDeniedPermissions']),
    entitledFeatureKeys: parseEntitledFeatureKeys(p['entitledFeatureKeys']),
      packageOffers: parseLinePackageOffers(p['packageOffers']),
    actorDelegations: parseActorDelegations(p['actorDelegations']),
    modelPolicy: parseModelPolicy(p['modelPolicy']),
    attachments,
    conversationContext: parseConversationContext(p['conversationContext']),
    ...v2,
    ...(lineChatAction(p['howToActionId']) ? { howToActionId: lineChatAction(p['howToActionId'])!.id } : {}),
      ...(p['approvedKnowledge'] === true ? { approvedKnowledge: true } : {}),
    ...(boundedKnowledgeCardIds(p['selectedKnowledgeCardIds']) ? { selectedKnowledgeCardIds: boundedKnowledgeCardIds(p['selectedKnowledgeCardIds']) } : {}),
    valueCandidates: versionedCandidates ? valueCandidates : valueCandidates
      ?? (p['valueCandidates'] ? extractValueCandidates(messageText, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })) : undefined),
    preparedPlan: parseLineAiPreparedPlan(p['preparedPlan'], v2?.inputEvidence ? { inputEvidence: v2.inputEvidence } : undefined),
    intakeIntent: asIntakeRouteIntent(p['intakeIntent']),
  };
}

export function payloadToTurnRequest(p: RuntimePayload): LineAiTurnRequest {
  return {
    requestId: p.turnId,
    webhookEventId: p.turnId,
    messageText: p.messageText,
    language: p.language ?? lineReplyLanguage(p.messageText),
    messagePreviewHash: '',
    actorDelegations: p.actorDelegations,
    modelPolicy: p.modelPolicy,
    attachments: (p.attachments ?? []) as LineAiTurnRequest['attachments'],
    conversationContext: p.conversationContext,
    ...(p.openClarifications ? { openClarifications: p.openClarifications } : {}),
    ...(p.resolvedClarificationIds ? { resolvedClarificationIds: p.resolvedClarificationIds } : {}),
    ...(p.valueCandidates ? { valueCandidates: p.valueCandidates } : {}),
    ...(p.inputEvidence ? { inputEvidence: p.inputEvidence } : {}),
    ...(p.contractCapabilities ? { contractCapabilities: p.contractCapabilities } : {}),
    ...(p.budgetGrantV2 ? { budgetGrantV2: p.budgetGrantV2 } : {}),
    ...(p.howToActionId ? { howToActionId: p.howToActionId } : {}),
    ...(p.approvedKnowledge ? { approvedKnowledge: true } : {}),
    ...(p.selectedKnowledgeCardIds ? { selectedKnowledgeCardIds: p.selectedKnowledgeCardIds } : {}),
    ...(p.taskProjection ? { taskProjection: p.taskProjection } : {}),
    ...(p.responsePreferences ? { responsePreferences: p.responsePreferences } : {}),
    ...(p.semanticSubrequests ? { semanticSubrequests: p.semanticSubrequests } : {}),
    ...(p.retainedTaskSource ? { retainedTaskSource: p.retainedTaskSource } : {}),
    packageOffers: p.packageOffers,
    ...(p.entitledFeatureKeys && { entitledFeatureKeys: p.entitledFeatureKeys }),
    ...(p.preparedPlan ? { preparedPlan: p.preparedPlan } : {}),
    ...(p.intakeIntent ? { intakeIntent: p.intakeIntent } : {}),
    userContext: {
      lineUserId: '',
      internalUserId: p.userId,
      companyId: p.companyId,
     membershipId: p.membershipId ?? '',
      ...(p.chatKeyHash ? { chatKeyHash: p.chatKeyHash } : {}),
      permissions: p.permissions ?? [],
      entitlementDeniedPermissions: p.entitlementDeniedPermissions,
      entitledFeatureKeys: p.entitledFeatureKeys,
      roles: p.roles ?? [],
      ...(p.branchIds && { branchIds: p.branchIds }),
      ...(p.locationIds && { locationIds: p.locationIds }),
      locale: p.locale ?? 'th-TH',
    },
  };
}

function parseModelPolicy(value: unknown): LineAiTurnRequest['modelPolicy'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const modelId = (value as Record<string, unknown>)['modelId'];
  if (typeof modelId !== 'string' || !modelId || modelId.length > 300) return undefined;
  return { modelId };
}

type SecretReader = (secretId: string, region: string) => Promise<string | undefined>;

const readFromSecretsManager: SecretReader = async (id, awsRegion) => {
  const { GetSecretValueCommand, SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
  const result = await new SecretsManagerClient({ region: awsRegion }).send(new GetSecretValueCommand({ SecretId: id }));
  return result.SecretString;
};

// ECS injects secret material with `valueFrom`, so a task simply has the value in its
// environment. AgentCore has no equivalent - every variable it carries is literal and readable
// by anyone who can call GetAgentRuntime - so the runtime fetches its own secrets at boot from
// an ARN instead. The internal secret has a value variable and an ARN pointer.
async function resolveSecretInto(
  env: NodeJS.ProcessEnv,
  valueKey: string,
  sourceKey: string,
  read: SecretReader,
): Promise<void> {
  if (env[valueKey]) return;
  const secretId = env[sourceKey];
  if (!secretId) throw new Error(`${sourceKey} is required`);
  const secret = await read(secretId, env['AWS_REGION'] ?? env['BEDROCK_REGION'] ?? 'ap-southeast-1');
  if (!secret) throw new Error(`${valueKey} is empty`);
  env[valueKey] = secret;
}

export async function loadInternalSecret(
  env: NodeJS.ProcessEnv = process.env,
  getSecret?: SecretReader,
): Promise<void> {
  await resolveSecretInto(env, 'AI_GATEWAY_INTERNAL_SECRET', 'AI_GATEWAY_INTERNAL_SECRET_ARN', getSecret ?? readFromSecretsManager);
}

/**
 * Builds the orchestrator from this process's environment alone. Owner 2026-09-29 ("no more switches; always
 * on"): nothing on this path may read a LINE AI capability switch — the release copies the artifact's env
 * forward, and a stale copy once turned four prepared families into "ยังดึงข้อมูลไม่ได้" (UAT 2026-09-29).
 */
export async function createRuntimeOrchestrator(): Promise<RuntimeOrchestrator> {
  const [
    { aiGatewayConfigSchema },
    { AiGatewayConfigService },
    { ToolPolicyEnforcerService },
    { ErpToolClient },
    { OrchestratorAgent },
  ] = await Promise.all([
    import('@watchdog-bms/config'),
    import('../common/config/ai-gateway-config.service'),
    import('../common/ai/tool-policy-enforcer.service'),
    import('../modules/line-ai/infrastructure/erp-tool.client'),
    import('../modules/line-ai/agents/orchestrator.agent'),
  ]);

  const envResult = aiGatewayConfigSchema.safeParse(process.env);
  if (!envResult.success) {
    throw new Error(`Config error: ${envResult.error.message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = new (AiGatewayConfigService as any)() as InstanceType<typeof AiGatewayConfigService>;
  const policyEnforcer = new ToolPolicyEnforcerService(config);
  const erpTools = new ErpToolClient(config, policyEnforcer);
  return new OrchestratorAgent(erpTools, config);
}

async function getRuntimeOrchestrator(): Promise<RuntimeOrchestrator> {
  runtimeOrchestrator ??= (async () => {
    await loadInternalSecret();
    return createRuntimeOrchestrator();
  })();
  return runtimeOrchestrator;
}

// ── HTTP server factory (exported for testing) ─────────────────────────────────

async function handleInvocation(
  orchestrator: RuntimeOrchestrator,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const runtimeStartedAt = Date.now();
  const bodyReadStartedAt = runtimeStartedAt;
  let rawBody: string;
  try {
    rawBody = await readBody(req, maxBodyBytes());
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      answerPayloadTooLarge(req, res);
      return;
    }
    json(res, 400, { error: 'BODY_READ_ERROR' });
    return;
  }
  const bodyReadMs = Date.now() - bodyReadStartedAt;

  const validationStartedAt = Date.now();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    json(res, 400, { error: 'INVALID_JSON' });
    return;
  }

  // The gateway uses this IAM-authenticated probe only for an explicit LINE edit-capability
  // question. Report the flag from this separately deployed process without running the model.
  if (typeof body === 'object' && body !== null
    && (body as Record<string, unknown>)['lineDraftEditCapabilityProbe'] === true) {
    const sourceCommit = process.env['GIT_SHA'];
    const artifactSha256 = process.env['AGENTCORE_ARTIFACT_SHA256'];
    const serviceVersion = process.env['SERVICE_VERSION'];
    const runtimeIdentity = sourceCommit && artifactSha256 && serviceVersion
      ? { sourceCommit, artifactSha256, serviceVersion, contractVersion: LINE_AI_RUNTIME_CONTRACT_VERSION }
      : undefined;
    json(res, 200, {
      turnId: (body as Record<string, unknown>)['turnId'],
      replyText: '', plan: { status: 'UNROUTABLE', intents: [] }, durationMs: 0, refused: false,
      sourceRefs: [], webLinks: [], toolsInvoked: [],
      // Owner 2026-09-29: draft edit is always on — never read from this artifact's own environment,
      // which the release copies forward and which had gone stale (UAT 2026-09-29).
      lineDraftEditEnabled: true,
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
    });
    return;
  }

  if (typeof body === 'object' && body !== null
    && (body as Record<string, unknown>)['lineBudgetV2CapabilityProbe'] === true) {
    const sourceCommit = process.env['GIT_SHA'];
    const artifactSha256 = process.env['AGENTCORE_ARTIFACT_SHA256'];
    const serviceVersion = process.env['SERVICE_VERSION'];
    const runtimeIdentity = sourceCommit && artifactSha256 && serviceVersion
      ? { sourceCommit, artifactSha256, serviceVersion, contractVersion: LINE_AI_RUNTIME_CONTRACT_VERSION }
      : undefined;
    json(res, 200, {
      turnId: (body as Record<string, unknown>)['turnId'],
      replyText: '', plan: { status: 'UNROUTABLE', intents: [] }, durationMs: 0, refused: false,
      sourceRefs: [], webLinks: [], toolsInvoked: [],
      lineBudgetV2Capability: {
        supported: AI_BUDGET_V2_SUPPORTED === true,
        inputContractVersion: 2,
        providerOutputVersion: 2,
        budgetContractVersion: 2,
        profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
        estimatorVersion: AI_BUDGET_ESTIMATOR_VERSION_V2,
      },
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
    });
    return;
  }

  const payload = validatePayload(body);
  if (!payload) {
    json(res, 400, { error: 'INVALID_PAYLOAD', message: 'turnId, companyId, userId, and messageText are required' });
    return;
  }
  if (payload.valueCandidates && 'version' in payload.valueCandidates && payload.valueCandidates.version === 2) {
    const verified = payload.inputEvidence
      ? await verifyLineAiValueCandidatesV2(payload.valueCandidates, payload.inputEvidence)
      : undefined;
    if (!verified) {
      json(res, 400, { error: 'AI_CONTRACT_UNSUPPORTED' });
      return;
    }
    payload.valueCandidates = verified;
  }
  if (payload.retainedTaskSource) {
    const retained = await verifyLineAiRetainedTaskSource(payload.retainedTaskSource);
    if (!retained || !lineAiRetainedTaskSourceMatchesProjection(retained, payload.taskProjection, 'turn')) {
      json(res, 400, { error: 'AI_CONTRACT_UNSUPPORTED' });
      return;
    }
    payload.retainedTaskSource = retained;
  }
  const payloadValidationMs = Date.now() - validationStartedAt;

  try {
    const turnReq = payloadToTurnRequest(payload);
    // This entrypoint runs outside the gateway's HTTP stack, so it opens its own collector —
    // otherwise a rebuilt artifact would report no usage at all and the API could never meter the
    // agentcore runtime. An older artifact simply omits the field (metering spec §7.2).
    const orchestrationStartedAt = Date.now();
    const budget: BudgetRequestState | undefined = payload.inputEvidence && payload.budgetGrantV2
      ? { status: 'active-v2', grant: payload.budgetGrantV2, inputDigest: payload.inputEvidence.joinedSha256,
          sourceRoute: 'line-turn', requestId: payload.turnId, calls: payload.budgetGrantV2.nextOrdinal ?? 0,
          repairCount: aiBudgetV2RepairsBefore(payload.budgetGrantV2) }
      : undefined;
    const { result, usage } = await runWithUsageContext({ companyId: payload.companyId, ...(budget ? { budget } : {}) }, async () => {
      const run = await orchestrator.run(turnReq);
      return { result: run, usage: drainUsage() };
    });
    const orchestrationMs = Date.now() - orchestrationStartedAt;
    const sourceCommit = process.env['GIT_SHA'];
    const artifactSha256 = process.env['AGENTCORE_ARTIFACT_SHA256'];
    const serviceVersion = process.env['SERVICE_VERSION'];
    const runtimeIdentity = sourceCommit && artifactSha256 && serviceVersion
      ? { sourceCommit, artifactSha256, serviceVersion, contractVersion: LINE_AI_RUNTIME_CONTRACT_VERSION }
      : undefined;
    json(res, 200, {
      turnId: payload.turnId,
      replyText: result.replyText,
      plan: result.plan,
      durationMs: result.durationMs,
      refused: result.plan.status === 'UNROUTABLE',
      ...(result.plan.status === 'UNROUTABLE' && result.plan.refusals[0]?.reason
        ? { refusalReason: result.plan.refusals[0].reason }
        : {}),
      sourceRefs: result.sourceRefs,
      webLinks: result.webLinks,
      ...(result.presentation ? { presentation: result.presentation } : {}),
      ...(result.deterministicExpenseSummary ? { deterministicExpenseSummary: true } : {}),
      ...(result.deterministicExpenseCriterionConfirmation ? { deterministicExpenseCriterionConfirmation: true } : {}),
      ...(result.semanticCoverage ? { semanticCoverage: result.semanticCoverage } : {}),
      // AgentRunResult exposes sources only in aggregate; do not fabricate per-tool attribution.
      toolsInvoked: result.outputs.flatMap((output) => output.toolCalls),
      ...(usage.length > 0 ? { usage } : {}),
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
      stageDurationsMs: {
        bodyReadMs,
        payloadValidationMs,
        orchestrationMs,
        runtimeTotalMs: Date.now() - runtimeStartedAt,
      },
      modelCallCount: usage.length,
    });
  } catch (err) {
    console.error('[agentcore-runtime] invocation error:', (err as Error).message);
    json(res, 500, { error: 'INVOCATION_ERROR' });
  }
}

export function makeHttpServer(orchestrator: RuntimeOrchestrator) {
  // L-12: per-server in-flight counter. AgentCore fans out concurrent invocations, and each one
  // holds a model call open, so an unbounded count is a memory and cost amplifier.
  let inFlight = 0;
  return createServer(async (req, res) => {
    // GET /ping – health check required by AgentCore protocol.
    // L-13: liveness only; the internal service name is not an unauthenticated caller's business.
    if (req.method === 'GET' && req.url === '/ping') {
      json(res, 200, { status: 'ok' });
      return;
    }

    // POST /invocations – AgentCore invocation endpoint
    if (req.method === 'POST' && req.url === '/invocations') {
      if (inFlight >= maxConcurrentInvocations()) {
        json(res, 429, { error: 'TOO_MANY_CONCURRENT_INVOCATIONS' });
        return;
      }
      inFlight += 1;
      try {
        await handleInvocation(orchestrator, req, res);
      } finally {
        inFlight -= 1;
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });
}

// ── Standalone entry point ─────────────────────────────────────────────────────

export function startRuntime(): void {
  const server = makeHttpServer({ run: async (req) => (await getRuntimeOrchestrator()).run(req) });
  server.listen(PORT, () => {
    console.log(`[agentcore-runtime] listening on :${PORT}`);
  });
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  startRuntime();
}
