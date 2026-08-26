/**
 * Orphaned LINE webhook recovery + event-log retention.
 *
 * The buffer accepts a message, writes its `received` row, acks LINE 200, and keeps the payload
 * in process memory. A hard exit (SIGKILL/OOM/crash, or a shutdown drain that times out) between
 * the ack and the turn therefore loses the message with nothing able to redeliver it: LINE only
 * retries un-acked events, and the payload is gone with the process. This sweep replays those
 * rows from `payloadJson` through the SAME buffer, so fragment joining, ordering, dedup, the
 * reply-token→push fallback, and the dispatch-failure notice all behave exactly as on the live
 * path. It never invents an answer and never re-runs a turn that already reached an outcome.
 *
 * Runs from the LINE AI ledger worker's minute tick (worker-token internal endpoint).
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { LineMessageBufferService, type LineBufferEnvelope } from '../line-message-buffer.service';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS } from '../../domain/logic/line-message-buffer.logic';
import { emitLineAiTerminalOutcome } from '../../domain/logic/line-ai-terminal-outcome.logic';
import { LineReplyAdapter, type LineReplyMessage } from '../../infrastructure/line-reply.adapter';

/** Past this age the employee has moved on; answering an hour-old question is worse than not
 *  answering it. Reaching it means the sweep itself was down, so the row is parked for ops
 *  instead of replayed. It is also the retry bound: a row that keeps failing ages out here. */
export const ORPHAN_REPLAY_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_SWEEP_BATCH = 50;
const MAX_PURGE_BATCH = 500;

/** Claim stamp for an outcome replay. Deliberately `RETRYABLE_`-prefixed so it lands back in the
 *  SECOND arm of the sweep query below: a pod that dies between the claim and the push leaves a row
 *  the next tick picks up again, and the age bound is what finally parks it. */
const OUTCOME_REPLAY_CLAIM = 'RETRYABLE_OUTCOME_REPLAY';

/** Own data again, but a row rewritten by hand must not take the sweep down — and it must never be
 *  pushed half-formed, because these bytes go straight to a person's chat. */
export function parseOutcomeMessages(value: unknown): LineReplyMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const messages = value as Array<Partial<LineReplyMessage>>;
  const valid = messages.every((message) => (message?.type === 'text' && typeof (message as { text?: unknown }).text === 'string')
    || (message?.type === 'flex' && typeof (message as { altText?: unknown }).altText === 'string'
      && !!(message as { contents?: unknown }).contents));
  return valid ? (value as LineReplyMessage[]) : null;
}

export type OrphanSweepResult = {
  replayed: number;
  expired: number;
  skipped: number;
  purged: number;
};

/** Own data, but a hand-edited or truncated row must not take the sweep down. */
export function parseBufferEnvelope(value: unknown): LineBufferEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Partial<LineBufferEnvelope>;
  const item = envelope.item as Partial<LineBufferEnvelope['item']> | undefined;
  if (typeof envelope.chatId !== 'string' || !envelope.chatId) return null;
  if (typeof envelope.lineUserId !== 'string' || !envelope.lineUserId) return null;
  if (typeof envelope.messagingChannelId !== 'string') return null;
  if (!item || typeof item.webhookEventId !== 'string' || typeof item.replyToken !== 'string') return null;
  if (item.kind === 'text') return typeof item.text === 'string' ? (envelope as LineBufferEnvelope) : null;
  if (item.kind === 'media') return typeof item.lineMessageId === 'string' ? (envelope as LineBufferEnvelope) : null;
  return null;
}

@Injectable()
export class RecoverOrphanLineEventsUseCase {
  private readonly logger = new Logger(RecoverOrphanLineEventsUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly buffer: LineMessageBufferService,
    private readonly lineReply: LineReplyAdapter,
  ) {}

  async execute(batchSize = 20): Promise<OrphanSweepResult> {
    const now = Date.now();
    const rows = await this.prisma.client.lineWebhookEventLog.findMany({
      where: {
        payloadJson: { not: Prisma.DbNull },
        createdAt: { lte: new Date(now - LINE_BUFFER_ORPHAN_REPROCESS_MS) },
        // Only rows the employee never heard from. `errorCode: null` is doing real work here:
        // executeReceiptUpload and the media-download path answer with ERROR_REPLY and then
        // release the row as RETRYABLE_*, so sweeping those would send a second error message
        // every minute. It also bounds replay — the stamp below is itself a RETRYABLE_ code, and
        // acceptEvent clears it only once the buffer has actually taken the message back.
        OR: [
          // Never dispatched, or dispatched by a process that died mid-turn.
          { status: 'received', errorCode: null },
          // Parked by the buffer's dispatch-failure path when even the fallback message could
          // not be sent — that row still owes the user something.
          { status: 'delivery_pending', errorCode: { startsWith: 'RETRYABLE_' } },
          // Claimed for a fallback response, then the process died before recording whether that
          // response reached LINE. Replaying is deliberately at-least-once and keeps it visible.
          { status: 'response_ready', errorCode: { startsWith: 'RETRYABLE_' } },
          // §8.3 replay arm. An in-turn delivery failure parks the row as `delivery_pending` with a
          // `LINE_DELIVERY_*` / `LINE_OUTCOME_*` code, and until now NOTHING swept those — the turn
          // simply ended undelivered. With the flag on they are claimable again, and the rendered
          // outcome persisted before that failed send is what gets pushed. Default-off drops the arm
          // from the query entirely, so the sweep selects exactly the rows it selects today.
          ...(this.config.lineAiTerminalOutcomeReplayEnabled
            ? [{ status: 'delivery_pending', errorCode: { startsWith: 'LINE_' } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(batchSize, 1), MAX_SWEEP_BATCH),
    });

    // One query for the batch, and only when the lane is on. `deliveredAt: null` is the guard that
    // makes replay idempotent across ticks: an outcome LINE already accepted is never sent twice.
    const outcomes = this.config.lineAiTerminalOutcomeReplayEnabled && rows.length > 0
      ? new Map((await this.prisma.client.lineTurnOutcome.findMany({
        where: { webhookEventId: { in: rows.map((row) => row.webhookEventId) }, deliveredAt: null },
        select: { webhookEventId: true, messagesJson: true },
      })).map((outcome) => [outcome.webhookEventId, outcome.messagesJson]))
      : new Map<string, unknown>();

    const result: OrphanSweepResult = { replayed: 0, expired: 0, skipped: 0, purged: 0 };
    const replayBefore = new Date(now - ORPHAN_REPLAY_MAX_AGE_MS);
    for (const row of rows) {
      const envelope = parseBufferEnvelope(row.payloadJson);
      if (!envelope) {
        await this.park(row, 'orphan_unreadable', 'ORPHAN_PAYLOAD_UNREADABLE');
        result.skipped += 1;
        continue;
      }
      if (row.createdAt < replayBefore) {
        await this.park(row, 'orphan_expired', 'ORPHAN_REPLAY_WINDOW_EXPIRED');
        result.expired += 1;
        continue;
      }
      // §8.3: the outcome for this turn is already decided and durable, so the retry REPLAYS it and
      // must not go back through the buffer — re-routing the same input can compute a different
      // answer and lose the facts the original turn accepted. Rows without an outcome (the flag was
      // off when they ran, or the outcome write itself failed) keep the legacy input replay below,
      // which is the only honest recovery when there is nothing recorded to send.
      //
      // PR #238 review R2: LINE_OUTCOME_NOT_RECORDED is the one code where a stored outcome must
      // NOT be trusted — it marks a turn whose outcome-of-record could not be updated in-turn, so
      // whatever the table still holds is the SUPERSEDED payload (concretely: the Flex LINE just
      // rejected, whose text replacement failed to persist). Pushing it would resend the refused
      // bytes; legacy input replay below recomputes the turn and its upsert overwrites the stale row.
      const outcome = row.errorCode === 'LINE_OUTCOME_NOT_RECORDED'
        ? undefined
        : outcomes.get(row.webhookEventId);
      if (outcome !== undefined) {
        result[await this.replayOutcome(row, envelope, outcome)] += 1;
        continue;
      }
      // CAS on the exact row state that was read: only one sweeper (or pod) may hand a row back
      // to a buffer, otherwise the employee gets the same answer twice.
      const claimed = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { id: row.id, status: row.status, errorCode: row.errorCode },
        // `received` + RETRYABLE_ is what LineMessageBufferService.acceptEvent reclaims.
        data: { status: 'received', errorCode: 'RETRYABLE_ORPHAN_REPLAY', processedAt: null },
      });
      if (claimed.count !== 1) {
        result.skipped += 1;
        continue;
      }
      try {
        await this.buffer.enqueue(envelope);
        result.replayed += 1;
      } catch (err) {
        // Left reclaimable on purpose: the next tick retries until the age bound parks it.
        this.logger.warn({ msg: 'line_orphan_replay_failed', webhookEventId: row.webhookEventId, error: (err as Error).message });
        result.skipped += 1;
      }
    }

    result.purged = await this.purgeExpiredEvents(now);
    if (result.replayed + result.expired + result.skipped > 0) {
      this.logger.log({ msg: 'line_orphan_sweep', ...result });
    }
    if (result.replayed + result.expired > 0) {
      await this.audit.log({
        actorType: 'SYSTEM',
        actorRefId: 'line-orphan-sweep',
        action: 'ai.line.orphan_sweep',
        targetType: 'LineWebhookEvent',
        requestId: randomUUID(),
        result: 'SUCCESS',
        riskLevel: 'LOW',
        metadataJson: { replayed: result.replayed, expired: result.expired, skipped: result.skipped },
      }).catch(() => {});
    }
    return result;
  }

  /**
   * §8.3 exact replay: PUSH the stored messages, byte for byte, with no reply token and no routing.
   *
   * Push, not reply, because the reply token is why we are here — it is expired or was already spent.
   * The chat to push into comes from the same `payloadJson` envelope the legacy branch replays
   * through (`chatId` is exactly what the live path uses as `pushTargetId`), so the raw LINE ids stay
   * in the one column that already holds them and the outcome row carries none.
   *
   * Claim/CAS mechanics are the existing ones: one conditional UPDATE on the exact state that was
   * read, so two sweepers cannot both push; the claim stamp is `RETRYABLE_`-prefixed so a crash after
   * it is picked up on the next tick; and the age bound above is what ends the retry loop.
   */
  private async replayOutcome(
    row: { id: string; status: string; errorCode: string | null; webhookEventId: string },
    envelope: LineBufferEnvelope,
    messagesJson: unknown,
  ): Promise<'replayed' | 'skipped'> {
    const messages = parseOutcomeMessages(messagesJson);
    if (!messages) {
      await this.park(row, 'orphan_unreadable', 'ORPHAN_OUTCOME_UNREADABLE');
      return 'skipped';
    }
    const claimed = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { id: row.id, status: row.status, errorCode: row.errorCode },
      data: { status: 'delivery_pending', errorCode: OUTCOME_REPLAY_CLAIM, processedAt: null },
    });
    if (claimed.count !== 1) return 'skipped';

    await this.prisma.client.lineTurnOutcome.updateMany({
      where: { webhookEventId: row.webhookEventId },
      data: { attempts: { increment: 1 } },
    }).catch(() => null);

    let delivered = false;
    try {
      delivered = await this.lineReply.sendPush(envelope.chatId, messages) === 'ok';
    } catch (err) {
      this.logger.warn({ msg: 'line_outcome_replay_failed', webhookEventId: row.webhookEventId, error: (err as Error).message });
    }
    if (!delivered) {
      // Left claimed and `delivery_pending` on purpose: still retryable, still visible, still owed.
      this.logger.warn({ msg: 'line_outcome_replay_undelivered', webhookEventId: row.webhookEventId });
      return 'skipped';
    }
    // Delivery is the ONLY thing that closes the turn, and only against the claim this sweeper won.
    await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { id: row.id, status: 'delivery_pending', errorCode: OUTCOME_REPLAY_CLAIM },
      data: { status: 'completed', errorCode: null, processedAt: new Date(), payloadJson: Prisma.DbNull },
    });
    await this.prisma.client.lineTurnOutcome.updateMany({
      where: { webhookEventId: row.webhookEventId, deliveredAt: null },
      data: { deliveredAt: new Date() },
    }).catch(() => null);
    this.logger.log({ msg: 'line_outcome_replayed', webhookEventId: row.webhookEventId, messageCount: messages.length });
    emitLineAiTerminalOutcome(this.logger, { webhookEventId: row.webhookEventId, status: 'completed' });
    return 'replayed';
  }

  /** Terminal, and the payload goes with it — an unreplayable row must not keep raw chat ids. */
  private async park(
    row: { id: string; status: string; errorCode: string | null; webhookEventId: string },
    status: string,
    errorCode: string,
  ): Promise<void> {
    const parked = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { id: row.id, status: row.status, errorCode: row.errorCode },
      data: { status, errorCode, processedAt: new Date(), payloadJson: Prisma.DbNull },
    }).catch(() => ({ count: 0 }));
    if (parked.count === 1) {
      this.logger.warn({ msg: 'line_orphan_parked', webhookEventId: row.webhookEventId, status, errorCode });
      emitLineAiTerminalOutcome(this.logger, { webhookEventId: row.webhookEventId, status, errorCode });
    }
  }

  /** This table had no retention at all: it is the dedup ledger for every LINE event ever
   *  received. Same window as the other AI data so there is one knob, not two. */
  private async purgeExpiredEvents(now: number): Promise<number> {
    const before = new Date(now - this.config.aiDataRetentionDays * 24 * 60 * 60 * 1000);
    const expired = await this.prisma.client.lineWebhookEventLog.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_PURGE_BATCH,
    });
    if (expired.length === 0) return 0;
    const deleted = await this.prisma.client.lineWebhookEventLog.deleteMany({
      where: { id: { in: expired.map((row) => row.id) } },
    });
    return deleted.count;
  }
}
