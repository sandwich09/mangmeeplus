/**
 * LINE AI message buffer + per-chat serial dispatch.
 *
 * Sits between the webhook controller and ProcessLineWebhookUseCase:
 * - acks the webhook fast (enqueue = dedup + `received` log row + memory append),
 * - debounces multi-bubble utterances into one batch per chat,
 * - guarantees at most one batch is processing per chat (replies stay ordered),
 * - dispatches batch groups through the existing, unchanged turn pipeline.
 *
 * State is in-process memory by design; multi-instance windows (canary bakes,
 * scale-out) degrade to per-event behavior without corruption (spec §12).
 * Spec: docs/specs/line-ai-message-buffering-spec.md
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LINE_AI_ERROR_CODES } from '@watchdog-bms/contracts';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { AuditService } from '../../audit/application/audit.service';
import { LineReplyAdapter, type LineDeliveryResult } from '../infrastructure/line-reply.adapter';
import {
  LEGAL_ACCEPTANCE_REQUIRED_REPLY,
  ProcessLineWebhookUseCase,
} from './use-cases/process-line-webhook.use-case';
import type { LineTextEvent, LineReceiptUploadEvent } from './use-cases/process-line-webhook.use-case';
import { hashMessagePreview, parseLineCompanyCommand } from '../domain/logic/line-ai-classifier.logic';
import {
  bufferAtCapacity,
  fittingPrefixCount,
  joinGroupText,
  nextFlushDelayMs,
  segmentBatch,
  sortBatchItems,
  LINE_BUFFER_ORPHAN_REPROCESS_MS,
  LINE_BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS,
} from '../domain/logic/line-message-buffer.logic';
import type {
  LineBatchGroup,
  LineBufferItem,
  LineBufferTextItem,
  LineBufferMediaItem,
  LineBufferFlushTiming,
} from '../domain/logic/line-message-buffer.logic';

export type LineBufferIncomingItem =
  | {
      kind: 'text';
      webhookEventId: string;
      replyToken: string;
      text: string;
      lineMessageId?: string;
      timestamp: number;
    }
  | {
      kind: 'media';
      webhookEventId: string;
      replyToken: string;
      lineMessageId: string;
      messageType: 'image' | 'file';
      fileName?: string;
      fileSize?: number;
      timestamp: number;
    };

export type LineBufferEnvelope = {
  /** groupId ?? roomId ?? userId — replies/pushes must stay in the source chat. */
  chatId: string;
  lineUserId: string;
  messagingChannelId: string;
  item: LineBufferIncomingItem;
};

const RATE_LIMIT_REPLY = '⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า กรุณารอสักครู่แล้วส่งอีกครั้งนะคะ';
const DISPATCH_ERROR_REPLY = '⏳ ขออภัยค่ะ ระบบตอบกลับไม่ได้ชั่วคราว กรุณาลองส่งข้อความอีกครั้งนะคะ';

type ChatState = {
  chatId: string;
  lineUserId: string;
  messagingChannelId: string;
  /** Debouncing bubbles — not yet committed to a batch. */
  open: LineBufferItem[];
  firstOpenAt: number | null;
  debounceTimer: NodeJS.Timeout | null;
  /** Flushed batch waiting for the worker; absorbs later flushes until dequeued. */
  pending: LineBufferItem[] | null;
  processing: boolean;
  /** One rate-limit reply per congestion episode, not per dropped bubble. */
  overflowNotified: boolean;
  /** Current worker loop — awaited by the shutdown drain. */
  drain: Promise<void> | null;
};

@Injectable()
export class LineMessageBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(LineMessageBufferService.name);
  private readonly chats = new Map<string, ChatState>();
  private seq = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly lineReply: LineReplyAdapter,
    private readonly processWebhook: ProcessLineWebhookUseCase,
  ) {}

  private get timing(): LineBufferFlushTiming {
    return {
      debounceMs: this.config.lineAiBufferDebounceMs,
      maxWaitMs: this.config.lineAiBufferMaxWaitMs,
    };
  }

  /** Fast path called per webhook event BEFORE the 200 ack. Does dedup + the
   *  `received` log row (both DB-backed, ~ms) and appends to memory. All slow
   *  work (AI turns, replies) happens asynchronously on the worker loop. */
  async enqueue(envelope: LineBufferEnvelope): Promise<void> {
    // The legal gate must run before acceptEvent: its recoverable payload contains raw chat
    // text/reply tokens/media ids. Preflight receives identity coordinates only, so a pending
    // employee message never crosses the durable-payload boundary.
    const companyCommand = envelope.item.kind === 'text' && !!parseLineCompanyCommand(envelope.item.text);
    const legal = await this.processWebhook.preflightLegalAcceptance({
      lineUserId: envelope.lineUserId,
      messagingChannelId: envelope.messagingChannelId,
    });
    if (legal.status === 'required' && !companyCommand) {
      const shouldReply = await this.terminalizePendingLegalAcceptance(envelope, legal.companyId);
      if (shouldReply) await this.deliverLegalAcceptanceReply(envelope);
      return;
    }

    // Company-context controls intentionally remain available while acceptance is pending so a
    // multi-company user can switch to the intended membership. Their raw command/reply token is
    // memory-only; a crash may require the harmless control to be resent.
    const accepted = await this.acceptEvent(envelope, legal.status !== 'required');
    if (!accepted) return;
    // Everything below is synchronous: no interleaving between state reads and
    // writes, which is what keeps the buffer race-free on the event loop.
    try {
      this.appendAccepted(envelope);
    } catch (error) {
      // The event row exists but the payload never reached memory. Mark it
      // immediately reclaimable before returning non-2xx to LINE.
      await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId: envelope.item.webhookEventId, status: 'received' },
        // LINE gets a non-2xx and redelivers the payload, so the stored copy is dead weight.
        data: { errorCode: 'RETRYABLE_BUFFER_APPEND_FAILED', processedAt: null, payloadJson: Prisma.DbNull },
      }).catch(() => {});
      throw error;
    }
  }

  /** Create (or atomically convert) the event into a terminal dedup marker. The envelope is used
   * only in memory; none of its text, reply token, chat id, or media metadata enters payloadJson. */
  private async terminalizePendingLegalAcceptance(
    envelope: LineBufferEnvelope,
    companyId: string,
  ): Promise<boolean> {
    const webhookEventId = envelope.item.webhookEventId;
    const terminal = {
      companyId,
      status: 'legal_acceptance_required',
      errorCode: LINE_AI_ERROR_CODES.FORBIDDEN,
      processedAt: new Date(),
      payloadJson: Prisma.DbNull,
    } as const;
    try {
      await this.prisma.client.lineWebhookEventLog.create({
        data: {
          webhookEventId,
          lineUserIdHash: hashMessagePreview(envelope.lineUserId),
          eventType: 'message',
          ...terminal,
        },
      });
      return true;
    } catch {
      // Unique violation or DB hiccup: as with acceptEvent, only a durable row lets us ack safely.
    }

    const existing = await this.prisma.client.lineWebhookEventLog.findUnique({ where: { webhookEventId } });
    if (!existing) throw new Error('LINE_WEBHOOK_EVENT_NOT_DURABLE');
    if (existing.status !== 'received') return false;

    // Scrub a row written by an older replica/redelivery race before it can be replayed. The
    // downstream use case retains the same legal gate as defense in depth for an already-claimed
    // in-memory turn.
    const updated = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { webhookEventId, status: 'received' },
      data: terminal,
    });
    return updated.count === 1;
  }

  private async deliverLegalAcceptanceReply(envelope: LineBufferEnvelope): Promise<void> {
    const messages = [this.lineReply.buildTextMessage(LEGAL_ACCEPTANCE_REQUIRED_REPLY)];
    let result: LineDeliveryResult = await this.lineReply
      .sendReply(envelope.item.replyToken, messages)
      .catch(() => 'failed_other' as const);
    if (result === 'failed_token') {
      result = await this.lineReply
        .sendPush(envelope.chatId, messages)
        .catch(() => 'failed_other' as const);
    }
    if (result !== 'ok') {
      this.logger.warn({ msg: 'LINE legal acceptance reply delivery failed', result });
    }
  }

  /** Age-aware dedup (spec §9): terminal row → drop; young `received` row →
   *  in someone's buffer/turn → drop; old `received` row → orphaned by a crash,
   *  and the payload comes back either from a LINE redelivery or from the orphan
   *  sweep replaying `payloadJson` (spec §11.1) → accept. */
  private async acceptEvent(envelope: LineBufferEnvelope, persistPayload = true): Promise<boolean> {
    const webhookEventId = envelope.item.webhookEventId;
    // The payload rides the row this call already writes before the 200 ack — no extra query,
    // and it is what the orphan sweep replays when this process dies mid-turn.
    const payloadJson = persistPayload
      ? envelope as unknown as Prisma.InputJsonValue
      : Prisma.DbNull;
    try {
      await this.prisma.client.lineWebhookEventLog.create({
        data: {
          webhookEventId,
          lineUserIdHash: hashMessagePreview(envelope.lineUserId),
          eventType: 'message',
          status: 'received',
          payloadJson,
        },
      });
      return true;
    } catch {
      // Unique violation (row exists) or DB hiccup — inspect the row.
    }
    const existing = await this.prisma.client.lineWebhookEventLog.findUnique({ where: { webhookEventId } });
    if (!existing) {
      // Without the row there is no durable dedup/recovery marker. Reject the
      // webhook and let LINE redeliver instead of acknowledging data loss.
      throw new Error('LINE_WEBHOOK_EVENT_NOT_DURABLE');
    }
    if (existing.status !== 'received') return false;
    if (existing.errorCode?.startsWith('RETRYABLE_')) {
      const reclaimed = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId, status: 'received', errorCode: existing.errorCode },
        data: { errorCode: null, processedAt: null, payloadJson },
      });
      return reclaimed.count === 1;
    }
    const orphaned = Date.now() - (existing.processedAt ?? existing.createdAt).getTime() >= LINE_BUFFER_ORPHAN_REPROCESS_MS;
    if (!orphaned || persistPayload) return orphaned;
    const scrubbed = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { webhookEventId, status: 'received' },
      data: { payloadJson: Prisma.DbNull },
    });
    return scrubbed.count === 1;
  }

  private appendAccepted(envelope: LineBufferEnvelope): void {
    const key = `${envelope.chatId}:${envelope.lineUserId}`;
    let state = this.chats.get(key);
    if (!state) {
      state = {
        chatId: envelope.chatId,
        lineUserId: envelope.lineUserId,
        messagingChannelId: envelope.messagingChannelId,
        open: [],
        firstOpenAt: null,
        debounceTimer: null,
        pending: null,
        processing: false,
        overflowNotified: false,
        drain: null,
      };
      this.chats.set(key, state);
    }
    state.messagingChannelId = envelope.messagingChannelId;

    const incoming = envelope.item;
    const kind = incoming.kind === 'text' && parseLineCompanyCommand(incoming.text) ? 'command' : incoming.kind;
    const item = { ...incoming, kind, seq: this.seq++ } as LineBufferItem;

    // Command fast path: an idle chat gets /company handled with zero added
    // latency. A non-idle chat must keep send order (a company switch changes
    // the context of the query typed before it), so the command joins the
    // buffer and forces an immediate flush instead.
    const idle = state.open.length === 0 && !state.pending && !state.processing;
    if (item.kind === 'command' && idle) {
      state.pending = [item];
      this.kickWorker(key, state);
      return;
    }

    state.open.push(item);
    if (state.firstOpenAt === null) state.firstOpenAt = Date.now();

    if (item.kind === 'command' || bufferAtCapacity(state.open) || this.timing.debounceMs === 0) {
      this.flushOpen(key, state);
      return;
    }
    this.scheduleFlush(key, state);
  }

  private scheduleFlush(key: string, state: ChatState): void {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    const delay = nextFlushDelayMs(state.firstOpenAt ?? Date.now(), Date.now(), this.timing);
    if (delay <= 0) {
      state.debounceTimer = null;
      this.flushOpen(key, state);
      return;
    }
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      this.flushOpen(key, state);
    }, delay);
  }

  private flushOpen(key: string, state: ChatState): void {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    if (state.open.length === 0) {
      this.maybeCleanup(key, state);
      return;
    }
    const items = state.open;
    state.open = [];
    state.firstOpenAt = null;

    if (!state.pending) {
      state.pending = items;
    } else {
      // Merge-into-pending keeps queue depth structurally bounded (spec §7):
      // at most one processing batch + one pending batch + the open buffer.
      const fit = fittingPrefixCount(state.pending, items);
      state.pending.push(...items.slice(0, fit));
      const dropped = items.slice(fit);
      if (dropped.length > 0) this.handleOverflow(state, dropped);
    }
    this.kickWorker(key, state);
  }

  /** Reaching this needs ~40+ bubbles during one in-flight turn — flood, not
   *  normal use. Drop the newest, tell the user once, keep the audit trail. */
  private handleOverflow(state: ChatState, dropped: LineBufferItem[]): void {
    const droppedIds = dropped.map((item) => item.webhookEventId);
    void this.prisma.client.lineWebhookEventLog
      .updateMany({
        where: { webhookEventId: { in: droppedIds }, status: 'received' },
        data: { status: 'rate_limited', errorCode: 'RATE_LIMITED', processedAt: new Date(), payloadJson: Prisma.DbNull },
      })
      .catch(() => {});
    void this.audit
      .log({
        action: 'ai.line.flood_dropped',
        targetType: 'line_chat',
        requestId: randomUUID(),
        result: 'DENIED',
        riskLevel: 'LOW',
        metadataJson: { droppedCount: dropped.length },
      })
      .catch(() => {});
    this.logger.warn({ msg: 'LINE buffer overflow — bubbles dropped', droppedCount: dropped.length });
    if (!state.overflowNotified) {
      state.overflowNotified = true;
      const last = dropped[dropped.length - 1];
      void this.lineReply
        .sendReply(last.replyToken, [this.lineReply.buildTextMessage(RATE_LIMIT_REPLY)])
        .catch(() => {});
    }
  }

  private kickWorker(key: string, state: ChatState): void {
    if (state.processing || !state.pending) return;
    state.processing = true;
    state.drain = this.processLoop(key, state);
  }

  private async processLoop(key: string, state: ChatState): Promise<void> {
    try {
      while (state.pending) {
        const batch = state.pending;
        state.pending = null;
        state.overflowNotified = false;
        try {
          await this.dispatchBatch(state, batch);
        } catch (err) {
          this.logger.error({ msg: 'LINE buffer batch dispatch failed', error: (err as Error).message });
        }
      }
    } finally {
      // Runs synchronously with the loop exit, so a flush that lands between
      // the last pending-check and here is picked up by the re-kick below.
      state.processing = false;
      state.drain = null;
      if (state.pending) {
        this.kickWorker(key, state);
      } else {
        this.maybeCleanup(key, state);
      }
    }
  }

  private maybeCleanup(key: string, state: ChatState): void {
    if (state.open.length === 0 && !state.pending && !state.processing && !state.debounceTimer) {
      this.chats.delete(key);
    }
  }

  private async dispatchBatch(state: ChatState, batchItems: LineBufferItem[]): Promise<void> {
    const items = sortBatchItems(batchItems);
    const groups = segmentBatch(items);
    for (const group of groups) {
      try {
        await this.dispatchGroup(state, group);
      } catch (err) {
        this.logger.error({ msg: 'LINE buffer group dispatch failed', error: (err as Error).message });
        await this.deliverDispatchFailure(state, group);
      }
    }
  }

  /** Unexpected infra failures happen after the webhook has already been
   * acknowledged. Park the group durably and send one truthful fallback
   * instead of leaving it as an invisible `received` row forever. */
  private async deliverDispatchFailure(state: ChatState, group: LineBatchGroup): Promise<void> {
    const items = sortBatchItems(
      group.kind === 'command'
        ? [group.item]
        : group.kind === 'text'
          ? group.textItems
          : [...group.mediaItems, ...group.textItems],
    );
    const source = items.at(-1);
    if (!source) return;

    const existing = await this.prisma.client.lineWebhookEventLog
      .findUnique({ where: { webhookEventId: source.webhookEventId } })
      .catch(() => null);
    // The use case may already have recorded a more specific terminal or
    // delivery-pending result. Never overwrite or double-send that outcome.
    if (!existing || existing.status !== 'received') return;

    const ids = items.map((item) => item.webhookEventId);
    const parked = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { webhookEventId: { in: ids }, status: 'received' },
      data: {
        status: 'delivery_pending',
        errorCode: 'RETRYABLE_LINE_BUFFER_DISPATCH_FAILED',
        processedAt: null,
      },
    }).catch(() => ({ count: 0 }));
    if (parked.count === 0) return;

    const messages = [this.lineReply.buildTextMessage(DISPATCH_ERROR_REPLY)];
    let result: LineDeliveryResult = await this.lineReply
      .sendReply(source.replyToken, messages)
      .catch(() => 'failed_other' as const);
    if (result === 'failed_token') {
      result = await this.lineReply
        .sendPush(state.chatId, messages)
        .catch(() => 'failed_other' as const);
    }
    if (result !== 'ok') return;

    await this.prisma.client.lineWebhookEventLog.updateMany({
      where: {
        webhookEventId: { in: ids },
        status: 'delivery_pending',
        errorCode: 'RETRYABLE_LINE_BUFFER_DISPATCH_FAILED',
      },
      data: { status: 'unavailable_delivered', errorCode: null, processedAt: new Date(), payloadJson: Prisma.DbNull },
    }).catch(() => {});
  }

  private async dispatchGroup(state: ChatState, group: LineBatchGroup): Promise<void> {
    if (group.kind === 'command') {
      await this.processWebhook.execute(this.toTextEvent(state, [group.item]));
      return;
    }

    if (group.kind === 'text') {
      await this.dispatchTextTurn(state, group.textItems);
      return;
    }

    // Media group: the group's text rides along as caption for each media turn.
    // If the router says the text was a standalone question (defer_text from the
    // first media turn), remaining media run caption-less and the text gets its
    // own turn afterwards, so the question is still answered (spec §8).
    const caption = joinGroupText(group.textItems);
    let deferText = false;
    for (let index = 0; index < group.mediaItems.length; index++) {
      await this.startLoading(state);
      const media = group.mediaItems[index];
      const result = await this.processWebhook.executeReceiptUpload(
        this.toMediaEvent(state, media),
        deferText ? '' : caption,
      );
      if (index === 0 && result.outcome === 'defer_text') deferText = true;
    }
    if (deferText && group.textItems.length > 0) {
      await this.dispatchTextTurn(state, group.textItems);
    } else {
      await this.markBatched(group.textItems.map((item) => item.webhookEventId));
    }
  }

  private async dispatchTextTurn(state: ChatState, textItems: LineBufferTextItem[]): Promise<void> {
    await this.startLoading(state);
    const last = textItems[textItems.length - 1];
    await this.processWebhook.execute(this.toTextEvent(state, textItems));
    await this.markBatched(textItems.filter((item) => item !== last).map((item) => item.webhookEventId));
  }

  /** The synthesized turn carries the LAST bubble's event id + reply token
   *  (freshest token); earlier bubbles become `batched` members (spec §8). */
  private toTextEvent(state: ChatState, textItems: LineBufferTextItem[]): LineTextEvent {
    const last = textItems[textItems.length - 1];
    return {
      webhookEventId: last.webhookEventId,
      lineUserId: state.lineUserId,
      replyToken: last.replyToken,
      messageText: joinGroupText(textItems),
      messagingChannelId: state.messagingChannelId,
      lineMessageId: last.lineMessageId,
      pushTargetId: state.chatId,
    };
  }

  private toMediaEvent(state: ChatState, media: LineBufferMediaItem): LineReceiptUploadEvent {
    return {
      webhookEventId: media.webhookEventId,
      lineUserId: state.lineUserId,
      replyToken: media.replyToken,
      lineMessageId: media.lineMessageId,
      messageType: media.messageType,
      fileName: media.fileName,
      fileSize: media.fileSize,
      messagingChannelId: state.messagingChannelId,
      pushTargetId: state.chatId,
    };
  }

  /** Mark bubbles that were folded into a completed batched turn. Only rows
   *  still `received` — never clobber a terminal status. */
  private async markBatched(webhookEventIds: string[]): Promise<void> {
    if (webhookEventIds.length === 0) return;
    await this.prisma.client.lineWebhookEventLog
      .updateMany({
        where: { webhookEventId: { in: webhookEventIds }, status: 'received' },
        data: { status: 'batched', processedAt: new Date(), payloadJson: Prisma.DbNull },
      })
      .catch(() => {});
  }

  /** Typing indicator while a turn runs. One-on-one chats only (LINE limit).
   *  Awaited so the start can never race after the actual reply. */
  private async startLoading(state: ChatState): Promise<void> {
    if (!this.config.lineAiLoadingAnimationEnabled) return;
    if (state.chatId !== state.lineUserId) return;
    await this.lineReply.startLoadingAnimation(state.lineUserId).catch(() => {});
  }

  /** SIGTERM (every deploy): flush all open buffers and drain in-flight work,
   *  bounded so a hung call cannot block container stop past the ECS grace
   *  period. The HTTP server is already closed, so no new events arrive. */
  async onModuleDestroy(): Promise<void> {
    for (const [key, state] of this.chats) {
      this.flushOpen(key, state);
    }
    const drains = [...this.chats.values()].map((state) => state.drain).filter((d): d is Promise<void> => !!d);
    if (drains.length === 0) return;
    this.logger.log({ msg: 'LINE buffer shutdown drain', chats: drains.length });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), LINE_BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS);
    });
    const result = await Promise.race([Promise.all(drains).then(() => 'drained' as const), timeout]);
    clearTimeout(timer);
    if (result === 'timeout') {
      this.logger.warn({ msg: 'LINE buffer shutdown drain timed out', pendingChats: this.chats.size });
    }
  }
}
