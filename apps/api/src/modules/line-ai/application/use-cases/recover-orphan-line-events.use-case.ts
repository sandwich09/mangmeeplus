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

/** Past this age the employee has moved on; answering an hour-old question is worse than not
 *  answering it. Reaching it means the sweep itself was down, so the row is parked for ops
 *  instead of replayed. It is also the retry bound: a row that keeps failing ages out here. */
export const ORPHAN_REPLAY_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_SWEEP_BATCH = 50;
const MAX_PURGE_BATCH = 500;

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
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(batchSize, 1), MAX_SWEEP_BATCH),
    });

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

  /** Terminal, and the payload goes with it — an unreplayable row must not keep raw chat ids. */
  private async park(
    row: { id: string; status: string; errorCode: string | null; webhookEventId: string },
    status: string,
    errorCode: string,
  ): Promise<void> {
    await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { id: row.id, status: row.status, errorCode: row.errorCode },
      data: { status, errorCode, processedAt: new Date(), payloadJson: Prisma.DbNull },
    }).catch(() => {});
    this.logger.warn({ msg: 'line_orphan_parked', webhookEventId: row.webhookEventId, status, errorCode });
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
