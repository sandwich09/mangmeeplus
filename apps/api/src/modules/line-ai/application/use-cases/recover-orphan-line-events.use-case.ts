import { parsePackagePurchaseControl } from '../line-package-purchase.service';
import { parseExpenseActionControl } from '../line-expense-action.service';
import { LineDocumentQaWorker } from '../line-document-qa.worker';
import { LineDocumentQaService } from '../line-document-qa.service';
import { parseLineReimbursementDraftControl } from '../line-reimbursement-draft.service';
import { parseLineAiInputEvidence } from '@watchdog-bms/contracts';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';
import { LineLedgerDeliveryService } from '../line-ledger-delivery.service';
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
import { Inject, Injectable, Logger } from '@nestjs/common';
import { LineReadEvidenceService } from '../line-read-evidence.service';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaExpenseCaptureRepository } from '../../../expenses/infrastructure/prisma-expense-capture.repository';
import { LineMessageBufferService, type LineBufferEnvelope } from '../line-message-buffer.service';
import { LINE_RECEIPT_RETRY_LEASE_CODE, LINE_RECEIPT_RETRY_LEASE_MS, LINE_RECEIPT_RETRY_WAIT_CODE } from '../company-ocr-governance';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS } from '../../domain/logic/line-message-buffer.logic';
import { isLineDraftPreviewId } from '../../domain/logic/line-staff-menu.logic';
import { emitLineAiTerminalOutcome } from '../../domain/logic/line-ai-terminal-outcome.logic';
import { LineReplyAdapter, parseOutcomeMessages, repairLegacyOutcomePreview, safeLineErrorDetails } from '../../infrastructure/line-reply.adapter';

/** Past this age the employee has moved on; answering an hour-old question is worse than not
 *  answering it. Reaching it means the sweep itself was down, so the row is parked for ops
 *  instead of replayed. It is also the retry bound: a row that keeps failing ages out here. */
export const ORPHAN_REPLAY_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_SWEEP_BATCH = 50;
const MAX_PURGE_BATCH = 500;
/** Capture appendix §8: one tick walks at most this many groups, each of which costs a handful of
 *  small queries plus one `markDeleted` transaction per file. */
const MAX_CAPTURE_RETENTION_GROUPS = 100;
/** Written into `ExpenseCaptureFile.detachedReason`, the same column a human detach uses. */
export const CAPTURE_RETENTION_DETACH_REASON = 'retention';

/** Claim stamp for an outcome replay. Deliberately `RETRYABLE_`-prefixed so it lands back in the
 *  SECOND arm of the sweep query below: a pod that dies between the claim and the push leaves a row
 *  the next tick picks up again, and the age bound is what finally parks it. */
const OUTCOME_REPLAY_CLAIM = 'RETRYABLE_OUTCOME_REPLAY';

export { parseOutcomeMessages } from '../../infrastructure/line-reply.adapter';

export type OrphanSweepResult = {
  replayed: number;
  expired: number;
  skipped: number;
  purged: number;
  /** Capture appendix §8 / D08: files of no-handoff groups deleted in this tick. */
  captureFilesPurged: number;
};

/** Own data, but a hand-edited or truncated row must not take the sweep down. */
export function parseBufferEnvelope(value: unknown): LineBufferEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Partial<LineBufferEnvelope>;
  const item = envelope.item as Partial<LineBufferEnvelope['item']> | undefined;
  if (typeof envelope.chatId !== 'string' || !envelope.chatId) return null;
  if (typeof envelope.lineUserId !== 'string' || !envelope.lineUserId) return null;
  if (typeof envelope.messagingChannelId !== 'string') return null;
  if (envelope.channelKind !== undefined && !['USER', 'GROUP', 'ROOM'].includes(envelope.channelKind)) return null;
  if (!item || typeof item.webhookEventId !== 'string' || typeof item.replyToken !== 'string') return null;
  if ('language' in item && item.language !== undefined && item.language !== 'th' && item.language !== 'en') return null;
  if (item.kind === 'text') {
    if (typeof item.text !== 'string') return null;
    if ('inputEvidence' in item && !parseLineAiInputEvidence(item.inputEvidence, item.text)) return null;
    if ('packagePurchaseControl' in item && !parsePackagePurchaseControl(item.packagePurchaseControl)) return null;
    if ('expenseActionControl' in item && !parseExpenseActionControl(item.expenseActionControl)) return null;
    if ('reimbursementDraftControl' in item && !parseLineReimbursementDraftControl(item.reimbursementDraftControl)) return null;
    if ('answerDeliveryControl' in item) {
      const control = item.answerDeliveryControl;
      if (!control || !['continue', 'cancel'].includes(control.action) || !/^[a-f0-9]{64}$/.test(control.planId) || (control.action === 'continue' && control.next !== 2)) return null;
    }
    if ('draftUpdatePreviewId' in item && !isLineDraftPreviewId(item.draftUpdatePreviewId)) return null;
    return envelope as LineBufferEnvelope;
  }
  if (item.kind === 'media') return typeof item.lineMessageId === 'string' ? (envelope as LineBufferEnvelope) : null;
  return null;
}

@Injectable()
export class RecoverOrphanLineEventsUseCase {
  @Inject(LineDocumentQaWorker) private readonly documentQaWorker!: LineDocumentQaWorker;
  @Inject(LineDocumentQaService) private readonly documentQa!: LineDocumentQaService;
  private readonly logger = new Logger(RecoverOrphanLineEventsUseCase.name);
  @Inject(ProcessLineWebhookUseCase) private readonly webhook!: ProcessLineWebhookUseCase;
  @Inject(LineLedgerDeliveryService) private readonly deliveryPlans!: LineLedgerDeliveryService;
  @Inject(LineReadEvidenceService) private readonly readEvidence!: LineReadEvidenceService;
  // Property injection, like `readEvidence` above: the five constructor arguments are what every
  // existing caller and spec already passes.
  @Inject(PrismaAttachmentRepository) private readonly attachments!: PrismaAttachmentRepository;
  @Inject(PrismaExpenseCaptureRepository) private readonly capture!: PrismaExpenseCaptureRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly buffer: LineMessageBufferService,
    private readonly lineReply: LineReplyAdapter,
  ) {}

  async execute(batchSize = 20): Promise<OrphanSweepResult> {
    await this.documentQaWorker?.drain().catch(() => ({ claimed: 0 }));
    await this.webhook?.recoverDocumentQaResults?.().catch(() => 0);
    await this.documentQa?.purgeExpired().catch(() => 0);
    const now = Date.now();
    const rows = await this.prisma.client.lineWebhookEventLog.findMany({
      where: {
        payloadJson: { not: Prisma.DbNull },
        createdAt: { lte: new Date(now - LINE_BUFFER_ORPHAN_REPROCESS_MS) },
        AND: [{ OR: [{ processedAt: null }, { processedAt: { lte: new Date(now - LINE_BUFFER_ORPHAN_REPROCESS_MS) } }] }],
        // Only rows the employee never heard from. `errorCode: null` is doing real work here:
        // executeReceiptUpload and the media-download path answer with ERROR_REPLY and then
        // release the row as RETRYABLE_*, so sweeping those would send a second error message
        // every minute. It also bounds replay — the stamp below is itself a RETRYABLE_ code, and
        // acceptEvent clears it only once the buffer has actually taken the message back.
        OR: [
          // Existing v2 obligations are always read, even after new-write flags are disabled.
          { status: 'delivery_pending', turnOutcome: { is: { presentationKind: 'delivery_plan_v2' } } },
          // Never dispatched, or dispatched by a process that died mid-turn.
          { status: 'received', errorCode: null },
          { status: 'received', errorCode: LINE_RECEIPT_RETRY_LEASE_CODE, processedAt: { lte: new Date(now - LINE_RECEIPT_RETRY_LEASE_MS) } },
          { status: 'received', errorCode: LINE_RECEIPT_RETRY_WAIT_CODE, processedAt: { lte: new Date(now - LINE_RECEIPT_RETRY_LEASE_MS) } },
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

    // Read pending AND accepted outcomes. A crash after API acceptance but before event bookkeeping
    // must reconcile the event without rerouting or sending the already accepted result.
    const outcomes = rows.length > 0
      ? new Map((await this.prisma.client.lineTurnOutcome.findMany({
        where: { webhookEventId: { in: rows.map((row) => row.webhookEventId) } },
        select: { webhookEventId: true, messagesJson: true, authorizationJson: true, deliveredAt: true, presentationKind: true, deliveryPlan: { select: { id: true } } },
      })).map((outcome) => [outcome.webhookEventId, outcome]))
      : new Map<string, { messagesJson: unknown; authorizationJson: unknown; deliveredAt: Date | null; presentationKind?: string; deliveryPlan?: { id: string } | null }>();

    const result: OrphanSweepResult = { replayed: 0, expired: 0, skipped: 0, purged: 0, captureFilesPurged: 0 };
    const replayBefore = new Date(now - ORPHAN_REPLAY_MAX_AGE_MS);
    for (const row of rows) {
      if (row.deliveryOwnerId?.startsWith('ledger:')) { result.skipped += 1; continue; }
      // Still queued or mid-turn in this process (a photo behind a slow read passes the 2-minute mark):
      // replaying it would acknowledge and read it a second time (UAT 2026-09-29).
      if (this.buffer.holds(row.webhookEventId)) { result.skipped += 1; continue; }
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
      const outcome = outcomes.get(row.webhookEventId);
      if (!this.config.lineAiTerminalOutcomeReplayEnabled && outcome && outcome.presentationKind !== 'delivery_plan_v2') { result.skipped += 1; continue; }
      if (outcome && row.errorCode === 'LINE_API_ACCEPTED') {
        await this.prisma.client.lineTurnOutcome.updateMany({
          where: { webhookEventId: row.webhookEventId, deliveredAt: null }, data: { deliveredAt: new Date() },
        });
        await this.park(row, 'completed', 'LINE_OUTCOME_ALREADY_ACCEPTED');
        result.skipped += 1;
        continue;
      }
      if (outcome?.deliveredAt) {
        // The send committed before event bookkeeping did: never recompute an accepted turn.
        await this.park(row, 'completed', 'LINE_OUTCOME_ALREADY_ACCEPTED');
        result.skipped += 1;
        continue;
      }
      if (outcome?.presentationKind === 'delivery_plan_v2') {
        if (!outcome.deliveryPlan) { await this.park(row, 'delivery_failed', 'LINE_OUTCOME_RECOVERY_REQUIRED'); result.skipped += 1; continue; }
        const delivered = await this.webhook.replayDeliveryPlan(outcome.deliveryPlan.id, { webhookEventId: row.webhookEventId, replyToken: '', lineUserId: envelope.lineUserId, pushTargetId: envelope.chatId, messagingChannelId: envelope.messagingChannelId });
        if (delivered === 'ok') { await this.park(row, 'completed', 'LINE_OUTCOME_ALREADY_ACCEPTED'); result.replayed += 1; }
        else result.skipped += 1;
        continue;
      }
      if (outcome) {
        result[await this.replayOutcome(row, envelope, outcome.messagesJson, outcome.authorizationJson)] += 1;
        continue;
      }
      if (row.status === 'delivery_pending' && row.errorCode?.startsWith('LINE_')) {
        // A business mutation may already have committed. Missing delivery storage is an ops
        // repair, not permission to rerun the user's operation.
        await this.park(row, 'delivery_failed', 'LINE_OUTCOME_RECOVERY_REQUIRED');
        result.skipped += 1;
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
        // Owner 2026-09-30 ("ทุกกรณีที่ระบบรับไว้ก่อน"): a message this system accepted before the AI credit
        // ran out is still owed its answer, so the replay may pass the cap (never an admin's closure).
        await this.buffer.enqueue(envelope, true);
        result.replayed += 1;
      } catch (err) {
        // Left reclaimable on purpose: the next tick retries until the age bound parks it.
        this.logger.warn({ msg: 'line_orphan_replay_failed', webhookEventId: row.webhookEventId, ...safeLineErrorDetails(err) });
        result.skipped += 1;
      }
    }

    await this.deliveryPlans?.sweepPlans(new Date(now));
    result.purged = await this.purgeExpiredEvents(now);
    result.captureFilesPurged = await this.purgeExpiredCaptureData(now);
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
    row: { id: string; status: string; errorCode: string | null; webhookEventId: string; processedAt: Date | null },
    envelope: LineBufferEnvelope,
    messagesJson: unknown,
    authorizationJson: unknown,
  ): Promise<'replayed' | 'skipped'> {
    let messages = parseOutcomeMessages(messagesJson);
    // These oversized previews were rejected locally before any provider attempt. Repair only
    // that representation; a possibly accepted network payload must retain its retry identity.
    if (!messages && row.errorCode === 'LINE_OUTCOME_NOT_RECORDED') {
      messages = repairLegacyOutcomePreview(messagesJson);
      if (messages) {
        const repaired = await this.prisma.client.lineTurnOutcome.updateMany({
          where: { webhookEventId: row.webhookEventId, deliveredAt: null, messagesJson: { equals: messagesJson as Prisma.InputJsonValue } },
          data: { messagesJson: messages as unknown as Prisma.InputJsonValue },
        });
        if (repaired.count !== 1) return 'skipped';
      }
    }
    if (!messages) {
      await this.park(row, 'orphan_unreadable', 'ORPHAN_OUTCOME_UNREADABLE');
      return 'skipped';
    }
    if (row.errorCode === 'LINE_OUTCOME_REPRESENTATION_PENDING') {
      messages = messages.map((message) => message.type === 'flex'
        ? { type: 'text' as const, text: message.canonicalText ?? message.altText, ...(message.quickReply ? { quickReply: message.quickReply } : {}) }
        : message);
      const replaced = await this.prisma.client.lineTurnOutcome.updateMany({
        where: { webhookEventId: row.webhookEventId, deliveredAt: null, messagesJson: { equals: messagesJson as Prisma.InputJsonValue } },
        data: { messagesJson: messages as unknown as Prisma.InputJsonValue, presentationKind: 'text_fallback' },
      });
      if (replaced.count !== 1) return 'skipped';
    }
    const claimedAt = new Date();
    const claimed = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { id: row.id, status: row.status, errorCode: row.errorCode, processedAt: row.processedAt,
        OR: [{ deliveryOwnerId: null }, { deliveryOwnerId: 'webhook' }] },
      data: { status: 'delivery_pending', errorCode: OUTCOME_REPLAY_CLAIM, processedAt: claimedAt, deliveryOwnerId: 'webhook' },
    });
    if (claimed.count !== 1) return 'skipped';

    await this.prisma.client.lineTurnOutcome.updateMany({
      where: { webhookEventId: row.webhookEventId },
      data: { attempts: { increment: 1 } },
    }).catch(() => null);

    const authorized = await this.readEvidence.verifyDelivery(authorizationJson, {
      webhookEventId: row.webhookEventId, lineUserId: envelope.lineUserId, chatId: envelope.chatId, channelId: envelope.messagingChannelId,
    }).catch(() => false);
    // A slow read cannot let an expired claimant send after another worker took ownership.
    const fenced = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { id: row.id, status: 'delivery_pending', errorCode: OUTCOME_REPLAY_CLAIM, processedAt: claimedAt },
      data: authorized ? { processedAt: new Date() } : { status: 'delivery_failed', errorCode: 'LINE_OUTCOME_REAUTHORIZATION_REQUIRED', processedAt: new Date(), payloadJson: Prisma.DbNull },
    });
    if (fenced.count !== 1) return 'skipped';
    if (!authorized) {
      await this.audit.log({ actorType: 'SYSTEM', actorRefId: 'line-orphan-sweep', action: 'ai.line.delivery.denied',
        targetType: 'LineWebhookEvent', targetId: row.webhookEventId, requestId: row.webhookEventId,
        result: 'DENIED', riskLevel: 'HIGH', metadataJson: { reason: 'outcome_reauthorization_required' } }).catch(() => {});
      const notice = [this.lineReply.buildTextMessage('ยังยืนยันข้อมูลหรือสิทธิ์ของคำตอบเดิมไม่ได้ กรุณาเปิดเว็บเพื่อตรวจรายการหรือถามใหม่ หากส่งรายการไว้แล้วให้ตรวจในเว็บก่อนส่งซ้ำค่ะ')];
      await this.lineReply.sendPush(envelope.chatId, notice, `${row.webhookEventId}:reauthorize`).catch(() => 'failed_other');
      return 'skipped';
    }

    // Same recipient, payload and operation key as the FIRST push, including reply fallback.
    let delivery: Awaited<ReturnType<LineReplyAdapter['sendPush']>> = 'failed_other';
    try {
      delivery = await this.lineReply.sendPush(envelope.chatId, messages, row.webhookEventId);
    } catch (err) {
      this.logger.warn({ msg: 'line_outcome_replay_failed', webhookEventId: row.webhookEventId, ...safeLineErrorDetails(err) });
    }
    if (delivery === 'failed_permanent' || delivery === 'failed_flex') {
      await this.park({ ...row, status: 'delivery_pending', errorCode: OUTCOME_REPLAY_CLAIM }, 'delivery_failed', 'LINE_DELIVERY_FAILED_PERMANENT');
      return 'skipped';
    }
    const delivered = delivery === 'ok';
    if (!delivered) {
      // Left claimed and `delivery_pending` on purpose: still retryable, still visible, still owed.
      this.logger.warn({ msg: 'line_outcome_replay_undelivered', webhookEventId: row.webhookEventId });
      return 'skipped';
    }
    await this.prisma.client.lineTurnOutcome.updateMany({
      where: { webhookEventId: row.webhookEventId, deliveredAt: null },
      data: { deliveredAt: new Date() },
    });
    await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { id: row.id, status: 'delivery_pending', errorCode: OUTCOME_REPLAY_CLAIM },
      data: { status: 'completed', errorCode: null, processedAt: new Date(), payloadJson: Prisma.DbNull },
    });
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
    const proofs = await this.prisma.client.lineReadEvidence.findMany({ where: { createdAt: { lt: before } }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: MAX_PURGE_BATCH });
    if (proofs.length) await this.prisma.client.lineReadEvidence.deleteMany({ where: { id: { in: proofs.map(row => row.id) } } });
    const deliveries = await this.prisma.client.lineLedgerDelivery.findMany({ where: { createdAt: { lt: before } }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: MAX_PURGE_BATCH });
    if (deliveries.length) await this.prisma.client.lineLedgerDelivery.deleteMany({ where: { id: { in: deliveries.map(row => row.id) } } });
    // Capture appendix §2.2: the pre-capture intake diagnostic ages out in the SAME sweep and the
    // same window as the webhook log it explains. It holds no payload, but it is still a record of
    // what a customer sent, so it must not outlive the event.
    const attempts = await this.prisma.client.lineIntakeAttempt.findMany({ where: { createdAt: { lt: before } }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: MAX_PURGE_BATCH });
    if (attempts.length) await this.prisma.client.lineIntakeAttempt.deleteMany({ where: { id: { in: attempts.map(row => row.id) } } });
    const tasks = await this.prisma.client.lineAiTaskRun.findMany({ where: { startedAt: { lt: before } },
      select: { id: true }, orderBy: { startedAt: 'asc' }, take: MAX_PURGE_BATCH });
    if (tasks.length) await this.prisma.client.lineAiTaskRun.deleteMany({ where: { id: { in: tasks.map(row => row.id) } } });
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

  /**
   * Capture appendix §8 / D08 — the retention half of the capture group.
   *
   * Two things age out on the same window (`EXPENSE_CAPTURE_RETENTION_DAYS`, default 90):
   *
   * 1. `linePushTargetId`, the raw chat id the group's read result is pushed into. Clearing it only
   *    makes the push fall back to the sender's own 1:1 chat; nothing else on the group changes.
   * 2. The evidence itself, for a group that never became a financial document. A group is eligible
   *    when it is `CLOSED_NO_HANDOFF`, `CANCELLED`, or still `OPEN` and untouched for the window —
   *    a `HANDED_OFF` group is excluded by that list, so its derived sources' receipts are never in
   *    scope here. Within an eligible group only a file that NOTHING financial points at is deleted:
   *    an `expense.receipt.*` link means a derived expense (or a converted single expense) owns
   *    those bytes, and `markDeleted` itself refuses a certified substitute-receipt retention hold
   *    or a live reimbursement claim (A35/A60 — "หลักฐานที่ source/certificate อ้างยังดูได้"). Those
   *    refusals are expected traffic, not errors, so the file is simply left for a later tick.
   *
   * The file row then becomes `DETACHED` with reason `retention` and its read jobs are cancelled,
   * exactly as a human detach does, so a late worker result cannot apply to bytes that are gone.
   */
  private async purgeExpiredCaptureData(now: number): Promise<number> {
    const retentionDays = Number(this.config.expenseCaptureRetentionDays);
    // A missing or malformed window must never turn into `updatedAt < Invalid Date`, which Prisma
    // rejects and which would take the whole orphan sweep down with it. No window, no purge.
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
    const before = new Date(now - retentionDays * 24 * 60 * 60 * 1000);
    const staleTargets = await this.prisma.client.expenseCaptureGroup.findMany({
      where: { linePushTargetId: { not: null }, updatedAt: { lt: before } },
      select: { id: true }, orderBy: { updatedAt: 'asc' }, take: MAX_PURGE_BATCH,
    });
    if (staleTargets.length) {
      await this.prisma.client.expenseCaptureGroup.updateMany({
        where: { id: { in: staleTargets.map((row) => row.id) } }, data: { linePushTargetId: null },
      });
    }

    const groups = await this.prisma.client.expenseCaptureGroup.findMany({
      where: { status: { in: ['CLOSED_NO_HANDOFF', 'CANCELLED', 'OPEN'] }, updatedAt: { lt: before } },
      select: { id: true, companyId: true },
      orderBy: { updatedAt: 'asc' }, take: MAX_CAPTURE_RETENTION_GROUPS,
    });
    let purged = 0;
    for (const group of groups) {
      const files = await this.prisma.client.expenseCaptureFile.findMany({
        where: { companyId: group.companyId, groupId: group.id, uploadState: { not: 'DETACHED' } },
        select: { id: true, attachmentId: true }, orderBy: { position: 'asc' },
      });
      const deleted: string[] = [];
      for (const file of files) {
        const financial = await this.prisma.client.attachmentLink.findFirst({
          where: {
            companyId: group.companyId, attachmentId: file.attachmentId,
            targetType: 'expense.record', purpose: { startsWith: 'expense.receipt.' },
          },
          select: { id: true },
        });
        if (financial) continue;
        try {
          await this.attachments.markDeleted({ id: file.attachmentId, companyId: group.companyId });
        } catch {
          continue; // a retention hold, a live claim, or bytes already gone — leave the row alone
        }
        await this.capture.markFileDetached(this.prisma.client, {
          companyId: group.companyId, fileId: file.id, reason: CAPTURE_RETENTION_DETACH_REASON,
        });
        await this.capture.cancelJobsForFile(this.prisma.client, group.companyId, file.id);
        deleted.push(file.id);
      }
      if (deleted.length === 0) continue;
      purged += deleted.length;
      // Ids and counts only — never a file name or anything read off the customer's document.
      await this.audit.log({
        companyId: group.companyId,
        actorType: 'SYSTEM',
        actorRefId: 'line-orphan-sweep',
        action: AuditAction.EXPENSE_CAPTURE_GROUP_RETENTION_PURGE,
        targetType: 'expense_capture_group',
        targetId: group.id,
        requestId: randomUUID(),
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: { fileIds: deleted, fileCount: deleted.length, retentionDays: this.config.expenseCaptureRetentionDays },
      }).catch(() => {});
    }
    if (purged > 0) this.logger.log({ msg: 'expense_capture_retention_purge', groups: groups.length, files: purged });
    return purged;
  }
}
