/**
 * LINE AI turn ledger on Redis Streams (item 10F, ADR 0010).
 *
 * Ordered, ack-based completion state per chat: a `turn` entry is appended BEFORE the gateway
 * call (crash durability — an unacked turn is re-run by the reclaim worker) and `sub_request`
 * entries are appended AFTER the coverage critic (needs_user → waiting_user, uncovered →
 * pending). Entries are consumed into the group's PEL immediately on append, so the PEL is
 * always exactly the set of open (unacked) work; XAUTOCLAIM with a min-idle window is the
 * whole reclaim story.
 *
 * Appending/acknowledging still degrades to a logged no-op on Redis failure. Reading an open
 * question fails closed: an unavailable question must not turn a bare answer into a new capture.
 * Redis holds operational state only; the Postgres audit log remains the
 * source of truth (`ai.line.ledger.*` mirror on every transition).
 *
 * DEMOTED for money (uat-correctness-latency spec §8.3). An unavailable Redis
 * question must block financial continuation because a Redis
 * outage makes "no open question" and "an open question I cannot read" look identical — and
 * the second must never let a follow-up amount be merged or written. An open clarification
 * here is therefore a BOUNDED REFERENCE only: `valueCandidates` and `clarifyQuestion` are
 * wording/context snapshots, never the source of truth for an amount. The durable half lives
 * in `LineIntakeStateRepository` (Postgres, CAS + TTL + owner binding), which fails CLOSED, and
 * behind `LINE_AI_INTAKE_STATE_MODE=on` that state — not this stream — decides whether a
 * financial continuation may proceed.
 *
 * Entries are DATA, never instructions (prompt-injection rule); they are re-permission-checked
 * at execution time by the drain use case — a stored entry is never permission truth.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { LineAiBusinessSubject, LineAiCoverageItem, LineAiOpenClarification, LineAiValueCandidates, LineIntakeRouteIntent } from '@watchdog-bms/contracts';
import { LINE_AI_BUSINESS_SUBJECTS, LINE_AI_CONTEXT_WINDOW_MINUTES, asIntakeRouteIntent } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/application/audit.service';
import { hashMessagePreview } from '../domain/logic/line-ai-classifier.logic';
import { ConsumptionMarkerUnavailableError, findConsumedClarificationIds, type MarkerTransactionClient } from './line-ai-consumption-marker';

export const LEDGER_GROUP = 'lineai-turn';
export const LINE_CLARIFICATION_SOURCE_MAX_BYTES = 16384;
const KEY_PREFIX = 'lineai:ledger:';
const APPEND_CONSUMER = 'appender';
const PENDING_SCAN_COUNT = 50;

/** The Redis surface the ledger uses — ioredis satisfies it; specs inject an in-memory fake. */
export type LedgerRedis = {
  xgroup(...args: Array<string | number>): Promise<unknown>;
  xadd(...args: Array<string | number>): Promise<string | null>;
  xack(key: string, group: string, id: string): Promise<number>;
  xreadgroup(...args: Array<string | number>): Promise<unknown>;
  xautoclaim(...args: Array<string | number>): Promise<unknown>;
  xrange(key: string, start: string, end: string, ...args: Array<string | number>): Promise<Array<[string, string[]]>>;
  xpending(...args: Array<string | number>): Promise<unknown>;
  expire(key: string, seconds: number): Promise<number>;
  scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>;
  quit(): Promise<unknown>;
};

export type LedgerEntryKind = 'turn' | 'sub_request';
export type LedgerEntryState = 'pending' | 'waiting_user';

export type LedgerEntry = {
  id: string;
  key: string;
  companyId: string;
  chatKey: string;
  kind: LedgerEntryKind;
  turnId: string;
  webhookEventId: string;
  messagingChannelId?: string;
  userId: string;
  text: string;
  intent?: string;
  agent?: string;
  subject?: LineAiBusinessSubject;
  state?: LedgerEntryState;
  clarifyQuestion?: string;
  /** Intake route the clarified request was on — inherited deterministically on the answer. */
  clarifyForIntent?: LineIntakeRouteIntent;
  /** The TRUSTED intake route this turn was on, carried so a reclaimed turn reaches the gateway with
   *  the same provenance the live turn had. Without it a drained turn loses the only thing that can
   *  tell "in the system, not on LINE yet" from "out of scope" (spec §5.3). Re-validated on read. */
  intakeIntent?: LineIntakeRouteIntent;
  /** Correction-target shortlist the question named; wording snapshot only, never authorization. */
  candidateExpenseIds?: string[];
  /** Opaque, bounded server proof. Never forwarded to the model; the webhook validates it. */
  sourceContext?: string;
  /** The already-stored file this question was asked about (see LineAiOpenClarification). */
  pendingMedia?: LedgerPendingMedia;
  valueCandidates?: LineAiValueCandidates;
  createdAt: string;
};

/** Handle to a file the customer already sent and the server still holds, carried on a clarify. */
export type LedgerPendingMedia = { pendingMediaId: string; attachmentId: string; mimeType: string };

export type LedgerSubRequestInput = {
  text: string;
  state: LedgerEntryState;
  intent?: string;
  agent?: string;
  subject?: LineAiBusinessSubject;
  clarifyQuestion?: string;
  clarifyForIntent?: LineIntakeRouteIntent;
  candidateExpenseIds?: string[];
  sourceContext?: string;
  pendingMedia?: LedgerPendingMedia;
};

export function ledgerKey(companyId: string, chatKey: string): string {
  return `${KEY_PREFIX}${companyId}:${chatKey}`;
}

export function parseLedgerKey(key: string): { companyId: string; chatKey: string } | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const rest = key.slice(KEY_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;
  return { companyId: rest.slice(0, separator), chatKey: rest.slice(separator + 1) };
}

export function fieldsToEntry(key: string, id: string, fields: string[]): LedgerEntry | null {
  const parsedKey = parseLedgerKey(key);
  if (!parsedKey) return null;
  const map: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) map[fields[i]] = fields[i + 1];
  if ((map['kind'] !== 'turn' && map['kind'] !== 'sub_request') || !map['turnId'] || !map['userId']) return null;
  let valueCandidates: LineAiValueCandidates | undefined;
  if (map['valueCandidates']) {
    try { valueCandidates = JSON.parse(map['valueCandidates']) as LineAiValueCandidates; } catch { valueCandidates = undefined; }
  }
  const candidateExpenseIds = (map['candidateExpenseIds'] ?? '').split(',').filter((id) => id.length > 0);
  // All three or none: a partially written trio would hand the dispatcher an id it cannot resolve.
  const pendingMedia = map['pendingMediaId'] && map['pendingMediaAttachmentId'] && map['pendingMediaMimeType']
    ? { pendingMediaId: map['pendingMediaId'], attachmentId: map['pendingMediaAttachmentId'], mimeType: map['pendingMediaMimeType'] }
    : undefined;
  return {
    id,
    key,
    companyId: parsedKey.companyId,
    chatKey: parsedKey.chatKey,
    kind: map['kind'],
    turnId: map['turnId'],
    webhookEventId: map['webhookEventId'] ?? '',
    ...(map['messagingChannelId'] ? { messagingChannelId: map['messagingChannelId'] } : {}),
    userId: map['userId'],
    text: map['text'] ?? '',
    ...(map['intent'] ? { intent: map['intent'] } : {}),
    ...(map['agent'] ? { agent: map['agent'] } : {}),
    ...(LINE_AI_BUSINESS_SUBJECTS.includes(map['subject'] as LineAiBusinessSubject) ? { subject: map['subject'] as LineAiBusinessSubject } : {}),
    ...(map['state'] === 'pending' || map['state'] === 'waiting_user' ? { state: map['state'] } : {}),
    ...(map['clarifyQuestion'] ? { clarifyQuestion: map['clarifyQuestion'] } : {}),
    ...(asIntakeRouteIntent(map['clarifyForIntent']) ? { clarifyForIntent: asIntakeRouteIntent(map['clarifyForIntent']) } : {}),
    ...(asIntakeRouteIntent(map['intakeIntent']) ? { intakeIntent: asIntakeRouteIntent(map['intakeIntent']) } : {}),
    ...(candidateExpenseIds.length > 0 ? { candidateExpenseIds } : {}),
    ...(map['sourceContext'] && Buffer.byteLength(map['sourceContext'], 'utf8') <= LINE_CLARIFICATION_SOURCE_MAX_BYTES ? { sourceContext: map['sourceContext'] } : {}),
    ...(pendingMedia ? { pendingMedia } : {}),
    ...(valueCandidates ? { valueCandidates } : {}),
    createdAt: map['createdAt'] ?? '',
  };
}

@Injectable()
export class LineAiLedgerService implements OnModuleDestroy {
  private readonly logger = new Logger(LineAiLedgerService.name);
  private client: LedgerRedis | null = null;
  private clientFailed = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    /** Durable consumption markers live in Postgres; Redis acks are cleanup only (spec §8). */
    private readonly prisma: PrismaService,
  ) {}

  get enabled(): boolean {
    return this.config.lineAiLedgerEnabled;
  }

  /** Specs inject an in-memory fake here; production lazily connects ioredis. */
  attachClient(client: LedgerRedis): void {
    this.client = client;
    this.clientFailed = false;
  }

  private redis(): LedgerRedis | null {
    if (!this.enabled) return null;
    if (this.client) return this.client;
    if (this.clientFailed) return null;
    try {
      // Bounded failure so a dead Redis can never stall a LINE turn: commands queue briefly
      // while (re)connecting (offline queue ON — first-command-after-boot must not fail on a
      // healthy Redis), but every command hard-times-out and gives up after one retry.
      this.client = new Redis(this.config.redisUrl, {
        enableOfflineQueue: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        commandTimeout: 2000,
      }) as unknown as LedgerRedis;
      (this.client as unknown as { on?: (event: string, fn: (err: Error) => void) => void }).on?.('error', (err) => {
        this.logger.warn({ msg: 'ai.line.ledger.redis_error', error: err.message });
      });
    } catch (err) {
      this.clientFailed = true;
      this.logger.warn({ msg: 'ai.line.ledger.unavailable', error: (err as Error).message });
      return null;
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => {});
    this.client = null;
  }

  /** Append one `turn` entry BEFORE the gateway call. Returns the entry id, or null when the
   *  ledger is off/unavailable (fail-open: the turn proceeds unledgered). */
  async appendTurn(input: {
    companyId: string;
    chatKey: string;
    turnId: string;
    webhookEventId: string;
    messagingChannelId?: string;
    userId: string;
    text: string;
    valueCandidates?: LineAiValueCandidates;
    intakeIntent?: LineIntakeRouteIntent;
    now?: Date;
  }): Promise<string | null> {
    return this.append(input.companyId, input.chatKey, {
      kind: 'turn',
      turnId: input.turnId,
      webhookEventId: input.webhookEventId,
      ...(input.messagingChannelId ? { messagingChannelId: input.messagingChannelId } : {}),
      userId: input.userId,
      text: input.text,
      state: 'pending',
      ...(input.valueCandidates ? { valueCandidates: JSON.stringify(input.valueCandidates) } : {}),
      ...(input.intakeIntent ? { intakeIntent: input.intakeIntent } : {}),
    }, input.now ?? new Date(), input.turnId);
  }

  /** Append `sub_request` entries from critic verdicts / intake clarifies. */
  async appendSubRequests(input: {
    companyId: string;
    chatKey: string;
    turnId: string;
    webhookEventId: string;
    messagingChannelId?: string;
    userId: string;
    items: LedgerSubRequestInput[];
    now?: Date;
  }): Promise<void> {
    for (const item of input.items) {
      await this.append(input.companyId, input.chatKey, {
        kind: 'sub_request',
        turnId: input.turnId,
        webhookEventId: input.webhookEventId,
        ...(input.messagingChannelId ? { messagingChannelId: input.messagingChannelId } : {}),
        userId: input.userId,
        text: item.text,
        state: item.state,
        ...(item.intent ? { intent: item.intent } : {}),
        ...(item.agent ? { agent: item.agent } : {}),
        ...(item.subject ? { subject: item.subject } : {}),
        ...(item.clarifyQuestion ? { clarifyQuestion: item.clarifyQuestion } : {}),
        ...(item.clarifyForIntent ? { clarifyForIntent: item.clarifyForIntent } : {}),
        ...(item.candidateExpenseIds?.length ? { candidateExpenseIds: item.candidateExpenseIds.join(',') } : {}),
        ...(item.sourceContext && Buffer.byteLength(item.sourceContext, 'utf8') <= LINE_CLARIFICATION_SOURCE_MAX_BYTES ? { sourceContext: item.sourceContext } : {}),
        ...(item.pendingMedia ? {
          pendingMediaId: item.pendingMedia.pendingMediaId,
          pendingMediaAttachmentId: item.pendingMedia.attachmentId,
          pendingMediaMimeType: item.pendingMedia.mimeType,
        } : {}),
      }, input.now ?? new Date(), input.turnId);
    }
  }

  /** Derive sub_request items from coverage verdicts: needs_user waits for the user; uncovered
   *  becomes a pending follow-up. Covered items need no entry — they are already answered. */
  coverageToSubRequests(coverage: LineAiCoverageItem[] | undefined): LedgerSubRequestInput[] {
    return (coverage ?? [])
      .filter((c) => c.verdict === 'needs_user' || c.verdict === 'uncovered')
      .map((c) => ({
        text: c.request,
        state: c.verdict === 'needs_user' ? 'waiting_user' as const : 'pending' as const,
        ...(c.subject ? { subject: c.subject } : {}),
        ...(c.question ? { clarifyQuestion: c.question } : {}),
      }));
  }

  /** Confirmed outcome → XACK + audit mirror. Outcome names the audit action suffix
   *  (acked | followed_up | clarify_expired | parked | refused). */
  async ack(entry: Pick<LedgerEntry, 'key' | 'id' | 'companyId' | 'turnId' | 'kind'>, outcome: 'acked' | 'followed_up' | 'clarify_expired' | 'parked' | 'refused', metadata: Record<string, unknown> = {}): Promise<void> {
    const redis = this.redis();
    if (!redis) return;
    try {
      await redis.xack(entry.key, LEDGER_GROUP, entry.id);
      await this.mirror(entry.companyId, `ai.line.ledger.${outcome}`, entry.turnId, {
        entryId: entry.id,
        kind: entry.kind,
        ...metadata,
      }, outcome === 'refused' ? 'DENIED' : 'SUCCESS');
    } catch (err) {
      this.logger.warn({ msg: 'ai.line.ledger.ack_failed', entryId: entry.id, error: (err as Error).message });
    }
  }

  /** The chat's open waiting_user entries (bounded), for attachment to the next turn. Expired
   *  ones are skipped here; the drain owns expiry acks. */
  async openWaitingUser(
    companyId: string,
    chatKey: string,
    /** Group-chat isolation: only the asker may carry, answer, or consume their own clarification. */
    userId: string,
    now: Date = new Date(),
    limit = 3,
  ): Promise<Array<LineAiOpenClarification & { entry: LedgerEntry }>> {
    const redis = this.redis();
    if (!redis) {
      if (this.enabled) throw new ConsumptionMarkerUnavailableError(new Error('Clarification store unavailable'));
      return [];
    }
    const key = ledgerKey(companyId, chatKey);
    const windowMs = LINE_AI_CONTEXT_WINDOW_MINUTES * 60 * 1000;
    let open: Array<LineAiOpenClarification & { entry: LedgerEntry }>;
    try {
      const pending = await redis.xpending(key, LEDGER_GROUP, '-', '+', PENDING_SCAN_COUNT) as Array<[string, string, number, number]> | null;
      if (!pending || pending.length === 0) return [];
      open = [];
      for (const [id] of pending) {
        if (open.length >= limit) break;
        const rows = await redis.xrange(key, id, id);
        const row = rows?.[0];
        if (!row) continue;
        const entry = fieldsToEntry(key, row[0], row[1]);
        if (!entry || entry.kind !== 'sub_request' || entry.state !== 'waiting_user' || !entry.clarifyQuestion) continue;
        if (entry.userId !== userId) continue; // another member's question — never ours to answer
        const created = Date.parse(entry.createdAt);
        if (!Number.isFinite(created) || now.getTime() - created > windowMs) continue; // expired — drain acks it
        open.push({
          id: entry.id,
          question: entry.clarifyQuestion,
          text: entry.text,
          ...(entry.subject ? { subject: entry.subject } : {}),
          ...(entry.clarifyForIntent ? { clarifyForIntent: entry.clarifyForIntent } : {}),
          ...(entry.candidateExpenseIds?.length ? { candidateExpenseIds: entry.candidateExpenseIds } : {}),
          ...(entry.pendingMedia ? { pendingMedia: entry.pendingMedia } : {}),
          askedAt: entry.createdAt,
          entry,
        });
      }
    } catch (err) {
      // Preserve the distinction between no question and an unreadable question in every mode.
      this.logger.warn({ msg: 'ai.line.ledger.read_failed', error: (err as Error).message });
      throw new ConsumptionMarkerUnavailableError(err);
    }
    if (open.length === 0) return [];
    // Marker lookup does NOT fail open — it throws ConsumptionMarkerUnavailableError and the
    // dispatcher answers with the safe retry reply instead of entering an intake branch.
    const consumed = await findConsumedClarificationIds(this.prisma.client as unknown as MarkerTransactionClient, {
      companyId,
      ledgerStreamKey: key,
      entryIds: open.map((item) => item.id),
    });
    return open.filter((item) => !consumed.has(item.id));
  }

  /** Reclaim open entries across all ledger keys (drain path): XAUTOCLAIM stalled/new-ish
   *  entries older than min-idle, with per-entry delivery counts from XPENDING. */
  async claimOpenEntries(batchSize: number, minIdleMs: number): Promise<Array<{ entry: LedgerEntry; deliveryCount: number; idleMs: number }>> {
    const redis = this.redis();
    if (!redis) return [];
    const claimed: Array<{ entry: LedgerEntry; deliveryCount: number; idleMs: number }> = [];
    try {
      let cursor = '0';
      const keys: string[] = [];
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 100);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0' && keys.length < 200);

      for (const key of keys) {
        if (claimed.length >= batchSize) break;
        const res = await redis.xautoclaim(key, LEDGER_GROUP, 'drainer', minIdleMs, '0', 'COUNT', batchSize - claimed.length) as [string, Array<[string, string[]]>] | null;
        const entries = res?.[1] ?? [];
        if (entries.length === 0) continue;
        const pending = await redis.xpending(key, LEDGER_GROUP, '-', '+', PENDING_SCAN_COUNT) as Array<[string, string, number, number]> | null;
        const counts = new Map((pending ?? []).map(([id, , idle, count]) => [id, { idle, count }]));
        for (const [id, fields] of entries) {
          const entry = fieldsToEntry(key, id, fields);
          if (!entry) continue;
          const meta = counts.get(id);
          claimed.push({ entry, deliveryCount: meta?.count ?? 1, idleMs: meta?.idle ?? minIdleMs });
        }
      }
      return claimed;
    } catch (err) {
      this.logger.warn({ msg: 'ai.line.ledger.claim_failed', error: (err as Error).message });
      return claimed;
    }
  }

  private async append(companyId: string, chatKey: string, fields: Record<string, string>, now: Date, requestId: string): Promise<string | null> {
    const redis = this.redis();
    if (!redis) return null;
    const key = ledgerKey(companyId, chatKey);
    try {
      await redis.xgroup('CREATE', key, LEDGER_GROUP, '0', 'MKSTREAM').catch((err: Error) => {
        if (!String(err?.message).includes('BUSYGROUP')) throw err;
      });
      const channelId = fields.messagingChannelId || this.config.lineMessagingChannelId;
      const pairs = Object.entries({ ...fields, ...(channelId ? { messagingChannelId: channelId } : {}), createdAt: now.toISOString() }).flat();
      const id = await redis.xadd(key, 'MAXLEN', '~', this.config.lineAiLedgerMaxLen, '*', ...pairs);
      if (!id) return null;
      // Consume-on-append: the PEL is always exactly the set of unacked entries, which makes
      // XAUTOCLAIM(min-idle) the single reclaim mechanism for turns AND sub-requests.
      await redis.xreadgroup('GROUP', LEDGER_GROUP, APPEND_CONSUMER, 'COUNT', PENDING_SCAN_COUNT, 'STREAMS', key, '>');
      await redis.expire(key, this.config.lineAiLedgerTtlSeconds);
      await this.mirror(companyId, 'ai.line.ledger.appended', requestId, {
        entryId: id,
        kind: fields['kind'],
        state: fields['state'],
        chatKeyHash: hashMessagePreview(chatKey),
      });
      return id;
    } catch (err) {
      this.logger.warn({ msg: 'ai.line.ledger.append_failed', error: (err as Error).message });
      return null;
    }
  }

  private async mirror(companyId: string, action: string, requestId: string, metadataJson: Record<string, unknown>, result: 'SUCCESS' | 'DENIED' = 'SUCCESS'): Promise<void> {
    await this.audit.log({
      companyId,
      action,
      targetType: 'line_chat',
      requestId,
      result,
      riskLevel: 'LOW',
      metadataJson,
    }).catch(() => {});
  }
}
