/**
 * LINE AI message buffer + per-chat serial dispatch.
 *
 * Sits between the webhook controller and ProcessLineWebhookUseCase:
 * - acks the webhook fast (enqueue = dedup + `received` log row + memory append),
 * - debounces multi-bubble utterances into one batch per chat,
 * - keeps text/commands ordered while slow uncaptioned receipt OCR uses its own serial lane,
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
import { staffMenuCommand } from '../domain/logic/line-staff-menu.logic';
import {
  buildLineAiApiTrace,
  bufferAtCapacity,
  debounceCohortMs,
  fittingPrefixCount,
  joinGroupText,
  lineWaitStatusText,
  nextFlushDelayMs,
  segmentBatch,
  sortBatchItems,
  LINE_BUFFER_ORPHAN_REPROCESS_MS,
  LINE_BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS,
  LINE_LOADING_KEEPALIVE_DELAY_MS,
  LINE_LOADING_RESTART_DELAY_MS,
  LINE_MEDIA_RECEIVED_TEXT,
  LINE_WAIT_STATUS_DELAY_MS,
} from '../domain/logic/line-message-buffer.logic';
import type {
  LineBatchGroup,
  LineBufferItem,
  LineBufferTextItem,
  LineBufferMediaItem,
  LineBufferFlushTiming,
} from '../domain/logic/line-message-buffer.logic';
import { emitLineAiTerminalOutcome } from '../domain/logic/line-ai-terminal-outcome.logic';

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
      /** Set only by durable orphan replay; fresh webhooks resolve and snapshot it below. */
      companyIdAtAcceptance?: string;
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

/** Accept-time loading request BOUND to one buffer/batch (never a global chat slot), so a later batch
 *  can neither overwrite it nor have it consumed by an earlier batch's turn. `consumed` makes exactly
 *  one content turn in its own batch await it. `firedDuringProcessing` records that a prior batch was
 *  still in flight when this request was made, so its spinner will be dismissed by that prior batch's
 *  final and this batch must re-show processing-start loading rather than suppress it. */
type BatchLoading = { promise: Promise<boolean>; webhookEventId: string; consumed: boolean; firedDuringProcessing: boolean };

type PendingMeta = { firstAcceptedAt: number; flushedAt: number; loading: BatchLoading | null };

type ChatState = {
  chatId: string;
  lineUserId: string;
  messagingChannelId: string;
  /** Effective debounce for this chat: the configured value, or the experiment cohort when the
   *  debounce experiment is on and this (company, chat) resolved to one. */
  debounceMs: number;
  /** Debouncing bubbles — not yet committed to a batch. */
  open: LineBufferItem[];
  /** Durable-acceptance instant of the first bubble in the open buffer — the timing anchor. */
  firstAcceptedAt: number | null;
  /** Logical timestamp the open buffer is scheduled to flush (from accepted times). Drives the
   *  deterministic gap<=debounce join / gap>debounce split on the next bubble; the backstop timer is
   *  armed strictly AFTER this, independent of timer-callback order. */
  scheduledFlushAt: number | null;
  debounceTimer: NodeJS.Timeout | null;
  /** Incremented on every (re)schedule; a fired timer whose captured generation is stale is ignored. */
  flushGeneration: number;
  /** Accept-time loading for the CURRENT open buffer; moves into pendingMeta.loading at flush so it
   *  rides with its own batch. */
  openLoading: BatchLoading | null;
  /** Flushed batch waiting for the worker; absorbs later flushes until dequeued. */
  pending: LineBufferItem[] | null;
  /** Ingress/queue timing + the bound accept-loading for the pending batch (spec §10/§12). */
  pendingMeta: PendingMeta | null;
  processing: boolean;
  /** One rate-limit reply per congestion episode, not per dropped bubble. */
  overflowNotified: boolean;
  /** Current worker loop — awaited by the shutdown drain. */
  drain: Promise<void> | null;
  /** Uncaptioned receipts stay serial with each other without blocking the main text/command lane. */
  mediaDrain: Promise<void> | null;
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

  private timingFor(state: ChatState): LineBufferFlushTiming {
    return {
      debounceMs: state.debounceMs,
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
    const publicCommand = envelope.item.kind === 'text' && staffMenuCommand(envelope.item.text);
    const legal = publicCommand === 'contact' || publicCommand === 'talk'
      ? { status: 'continue' as const, companyId: undefined }
      : await this.processWebhook.preflightLegalAcceptance({
          lineUserId: envelope.lineUserId,
          messagingChannelId: envelope.messagingChannelId,
          ...(envelope.item.kind === 'media' && envelope.item.companyIdAtAcceptance
            ? { companyIdAtAcceptance: envelope.item.companyIdAtAcceptance }
            : {}),
        });
    if (legal.status === 'required' && !companyCommand) {
      const shouldReply = await this.claimPendingLegalAcceptance(envelope, legal.companyId);
      if (shouldReply) {
        const delivery = await this.deliverLegalAcceptanceReply(envelope);
        if (delivery !== 'ok') {
          const released = await this.prisma.client.lineWebhookEventLog.updateMany({
            where: { webhookEventId: envelope.item.webhookEventId, status: 'response_ready' },
            data: {
              status: 'received', errorCode: 'RETRYABLE_LEGAL_REPLY_DELIVERY_FAILED',
              processedAt: null, payloadJson: Prisma.DbNull,
            },
          });
          if (released.count !== 1) throw new Error('LINE_LEGAL_REPLY_RELEASE_STATE_LOST');
          throw new Error('LINE_LEGAL_REPLY_DELIVERY_FAILED');
        }
        const terminal = await this.prisma.client.lineWebhookEventLog.updateMany({
          where: { webhookEventId: envelope.item.webhookEventId, status: 'response_ready' },
          data: {
            status: 'legal_acceptance_required', errorCode: LINE_AI_ERROR_CODES.FORBIDDEN,
            processedAt: new Date(), payloadJson: Prisma.DbNull,
          },
        });
        if (terminal.count !== 1) throw new Error('LINE_LEGAL_REPLY_TERMINAL_STATE_LOST');
        emitLineAiTerminalOutcome(this.logger, {
          webhookEventId: envelope.item.webhookEventId,
          companyId: legal.companyId,
          status: 'legal_acceptance_required',
          errorCode: LINE_AI_ERROR_CODES.FORBIDDEN,
        });
      }
      return;
    }

    // Company-context controls intentionally remain available while acceptance is pending so a
    // multi-company user can switch to the intended membership. Their raw command/reply token is
    // memory-only; a crash may require the harmless control to be resent.
    const companyIdAtAcceptance = envelope.item.kind === 'media'
      ? (envelope.item.companyIdAtAcceptance ?? legal.companyId)
      : undefined;
    const acceptedEnvelope = companyIdAtAcceptance
      ? { ...envelope, item: { ...envelope.item, companyIdAtAcceptance } }
      : envelope;
    const acceptedAt = await this.acceptEvent(acceptedEnvelope, legal.status !== 'required');
    if (acceptedAt === null) return;
    // Everything below is synchronous: no interleaving between state reads and
    // writes, which is what keeps the buffer race-free on the event loop.
    try {
      this.appendAccepted(acceptedEnvelope, acceptedAt, legal.companyId);
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

  /** Create (or atomically convert) the event into a delivery claim. The envelope is used
   * only in memory; none of its text, reply token, chat id, or media metadata enters payloadJson. */
  private async claimPendingLegalAcceptance(
    envelope: LineBufferEnvelope,
    companyId: string,
  ): Promise<boolean> {
    const webhookEventId = envelope.item.webhookEventId;
    const claimed = {
      companyId,
      status: 'response_ready',
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
          ...claimed,
        },
      });
      this.emitAccepted(webhookEventId);
      return true;
    } catch {
      // Unique violation or DB hiccup: as with acceptEvent, only a durable row lets us ack safely.
    }

    const existing = await this.prisma.client.lineWebhookEventLog.findUnique({ where: { webhookEventId } });
    if (!existing) throw new Error('LINE_WEBHOOK_EVENT_NOT_DURABLE');
    if (existing.status === 'response_ready' && existing.errorCode === LINE_AI_ERROR_CODES.FORBIDDEN) {
      const claimAgeMs = Date.now() - (existing.processedAt ?? existing.createdAt).getTime();
      if (claimAgeMs < LINE_BUFFER_ORPHAN_REPROCESS_MS) throw new Error('LINE_LEGAL_REPLY_IN_FLIGHT');
      const reclaimed = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: {
          webhookEventId,
          status: 'response_ready',
          errorCode: LINE_AI_ERROR_CODES.FORBIDDEN,
          processedAt: existing.processedAt,
        },
        data: claimed,
      });
      return reclaimed.count === 1;
    }
    if (existing.status !== 'received') return false;

    // Scrub a row written by an older replica/redelivery race before it can be replayed. The
    // downstream use case retains the same legal gate as defense in depth for an already-claimed
    // in-memory turn.
    const updated = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { webhookEventId, status: 'received' },
      data: claimed,
    });
    return updated.count === 1;
  }

  private async deliverLegalAcceptanceReply(envelope: LineBufferEnvelope): Promise<LineDeliveryResult> {
    const messages = [this.lineReply.buildTextMessage(LEGAL_ACCEPTANCE_REQUIRED_REPLY)];
    let result: LineDeliveryResult = await this.lineReply
      .sendReply(envelope.item.replyToken, messages)
      .catch(() => 'failed_other' as const);
    if (result === 'failed_token') {
      result = await this.lineReply
        .sendPush(envelope.chatId, messages)
        .catch(() => 'failed_other' as const);
    }
    if (result !== 'ok') this.logger.warn({ msg: 'LINE legal acceptance reply delivery failed', result });
    return result;
  }

  /** Age-aware dedup (spec §9): terminal row → drop; young `received` row →
   *  in someone's buffer/turn → drop; old `received` row → orphaned by a crash,
   *  and the payload comes back either from a LINE redelivery or from the orphan
   *  sweep replaying `payloadJson` (spec §11.1) → accept. */
  private async acceptEvent(envelope: LineBufferEnvelope, persistPayload = true): Promise<number | null> {
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
      this.emitAccepted(webhookEventId);
      // Exact durable-acceptance instant: captured only once the row is committed. Threaded onward
      // as the single anchor for the debounce boundary and API trace.
      return Date.now();
    } catch {
      // Unique violation (row exists) or DB hiccup — inspect the row.
    }
    const existing = await this.prisma.client.lineWebhookEventLog.findUnique({ where: { webhookEventId } });
    if (!existing) {
      // Without the row there is no durable dedup/recovery marker. Reject the
      // webhook and let LINE redeliver instead of acknowledging data loss.
      throw new Error('LINE_WEBHOOK_EVENT_NOT_DURABLE');
    }
    if (existing.status !== 'received') return null;
    if (existing.errorCode?.startsWith('RETRYABLE_')) {
      const reclaimed = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId, status: 'received', errorCode: existing.errorCode },
        data: { errorCode: null, processedAt: null, payloadJson },
      });
      return reclaimed.count === 1 ? Date.now() : null;
    }
    const orphaned = Date.now() - (existing.processedAt ?? existing.createdAt).getTime() >= LINE_BUFFER_ORPHAN_REPROCESS_MS;
    if (!orphaned) return null;
    if (persistPayload) {
      return Date.now();
    }
    const scrubbed = await this.prisma.client.lineWebhookEventLog.updateMany({
      where: { webhookEventId, status: 'received' },
      data: { payloadJson: Prisma.DbNull },
    });
    return scrubbed.count === 1 ? Date.now() : null;
  }

  private emitAccepted(webhookEventId: string): void {
    this.logger.log({ msg: 'line.ai.accepted', surface: 'employee_oa', webhookEventId });
  }

  private appendAccepted(envelope: LineBufferEnvelope, acceptedAt: number, companyId?: string): void {
    const key = `${envelope.chatId}:${envelope.lineUserId}`;
    let state = this.chats.get(key);
    if (!state) {
      state = {
        chatId: envelope.chatId,
        lineUserId: envelope.lineUserId,
        messagingChannelId: envelope.messagingChannelId,
        debounceMs: this.config.lineAiBufferDebounceMs,
        open: [],
        firstAcceptedAt: null,
        scheduledFlushAt: null,
        debounceTimer: null,
        flushGeneration: 0,
        openLoading: null,
        pending: null,
        pendingMeta: null,
        processing: false,
        overflowNotified: false,
        drain: null,
        mediaDrain: null,
      };
      this.chats.set(key, state);
    }
    state.messagingChannelId = envelope.messagingChannelId;

    const incoming = envelope.item;
    const lineCommand = incoming.kind === 'text'
      && (parseLineCompanyCommand(incoming.text) || staffMenuCommand(incoming.text));
    const kind = lineCommand ? 'command' : incoming.kind;
    const item = {
      ...incoming,
      kind,
      seq: this.seq++,
      acceptedAt,
      ...(incoming.kind === 'media' && companyId ? { companyIdAtAcceptance: companyId } : {}),
    } as LineBufferItem;

    // Deterministic boundary (spec §10): if the open buffer's scheduled flush already lies strictly
    // before this bubble's accepted time, the quiet window elapsed and the open buffer is its own
    // completed turn — flush it before this bubble opens a new one. Because the decision compares
    // accepted timestamps, gap == debounce joins and gap > debounce splits regardless of whether the
    // backstop timer callback has fired.
    if (state.open.length > 0 && state.scheduledFlushAt !== null && state.scheduledFlushAt < acceptedAt) {
      this.flushOpen(key, state);
    }

    // Command fast path: an idle chat gets /company handled with zero added
    // latency. A non-idle chat must keep send order (a company switch changes
    // the context of the query typed before it), so the command joins the
    // buffer and forces an immediate flush instead.
    const idle = state.open.length === 0 && !state.pending && !state.processing;
    if (item.kind === 'command' && idle) {
      state.pending = [item];
      state.pendingMeta = { firstAcceptedAt: acceptedAt, flushedAt: acceptedAt, loading: null };
      this.kickWorker(key, state);
      return;
    }

    state.open.push(item);
    if (state.firstAcceptedAt === null) {
      state.firstAcceptedAt = acceptedAt;
      // Freeze the debounce cohort when a NEW open batch starts and hold it for the whole batch. Cluster
      // is (company, CHAT) per spec §10 — keyed on chatId only, NOT the buffer key (chat+user, kept for
      // isolation): every user in one group/chat shares one cohort while their buffers stay independent,
      // and two users resolving DIFFERENT authoritative companies are different clusters. A later bubble
      // (even one that resolves a different/late company) must not silently re-assign an open batch;
      // an unresolved company (no companyId) stays on the configured debounce.
      state.debounceMs = debounceCohortMs({
        enabled: this.config.lineAiDebounceExperimentEnabled,
        secret: this.config.lineAiDebounceExperimentSecret,
        assignmentKey: companyId ? `${companyId}:${envelope.chatId}` : '',
        configuredMs: this.config.lineAiBufferDebounceMs,
      });
      // Request loading once, when a non-command bubble opens a NEW batch (no pending batch this
      // buffer would merge into), right after durable acceptance and before the debounce wait. The
      // promise is bound to THIS open buffer and rides into its own pending batch. Commands stay
      // immediate / no-loading.
      if (item.kind !== 'command' && state.pending === null) this.startLoadingOnAccept(state, item.webhookEventId);
    }

    if (item.kind === 'command' || bufferAtCapacity(state.open) || state.debounceMs === 0) {
      this.flushOpen(key, state);
      return;
    }
    this.scheduleFlush(key, state, acceptedAt);
  }

  /** Best-effort loading right after durable acceptance (spec §10). Default off; on, it is 1:1-only
   *  (LINE has no group loading) and the ack is never delayed (the promise is not awaited here). The
   *  request is BOUND to this open buffer (state.openLoading) and rides into its own pending batch, so
   *  a later batch never overwrites it. loading_accepted is emitted only when the batch's own first
   *  content turn consumes/awaits it (dispatchBatch), never here — so neither the request nor
   *  loading_accepted can be observed after that batch's final answer. */
  private startLoadingOnAccept(state: ChatState, webhookEventId: string): void {
    // Loading-on-accept is a SUB-feature of the master loading animation: both must be on. With the master
    // flag off there is no spinner anywhere (accept or processing-start), so this early accept path stays
    // dark too — no LINE loading request, no loading_started telemetry.
    if (!this.config.lineAiLoadingAnimationEnabled || !this.config.lineAiLoadingOnAcceptEnabled) return;
    if (state.chatId !== state.lineUserId) return;
    this.emitLoadingEvent('loading_started', webhookEventId);
    state.openLoading = {
      promise: this.lineReply.startLoadingAnimation(state.lineUserId).catch(() => false),
      webhookEventId,
      consumed: false,
      // A prior batch in flight will dismiss this spinner with its own final reply.
      firedDuringProcessing: state.processing || state.mediaDrain !== null,
    };
  }

  private emitLoadingEvent(event: 'loading_started' | 'loading_accepted', webhookEventId: string): void {
    try {
      this.logger.log({ msg: `line.ai.${event}`, surface: 'employee_oa', webhookEventId });
    } catch {
      // Telemetry cannot change the outcome it observes.
    }
  }

  private scheduleFlush(key: string, state: ChatState, acceptedAt: number): void {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    // The LOGICAL boundary is a pure function of accepted times (last bubble + debounce, capped by
    // first accepted + max-wait); the next bubble's arrival compares against it (join if <=, split if >).
    const anchor = state.firstAcceptedAt ?? acceptedAt;
    state.scheduledFlushAt = acceptedAt + nextFlushDelayMs(anchor, acceptedAt, this.timingFor(state));
    // Arm the quiet-buffer backstop STRICTLY AFTER the boundary (+1 ms) so a bubble arriving at exactly
    // the boundary (gap == debounce) still joins instead of racing a timer that fires on the boundary.
    const generation = ++state.flushGeneration;
    const fireAt = state.scheduledFlushAt + 1;
    const delay = Math.max(0, fireAt - Date.now());
    state.debounceTimer = setTimeout(() => {
      // Ownership check FIRST: a stale (superseded/cleared-but-already-queued) callback whose captured
      // generation no longer matches must not touch state — clearing state.debounceTimer here would
      // erase the LIVE schedule's timer reference. Only the callback that still owns the current
      // schedule proceeds and clears its own reference.
      if (generation !== state.flushGeneration) return;
      state.debounceTimer = null;
      if (state.open.length === 0) return;
      // Re-arm if the logical boundary has not genuinely passed yet (clock skew / early wake).
      if (state.scheduledFlushAt !== null && Date.now() <= state.scheduledFlushAt) {
        this.scheduleFlush(key, state, acceptedAt);
        return;
      }
      this.flushOpen(key, state);
    }, delay);
  }

  private flushOpen(key: string, state: ChatState): void {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    // Invalidate any already-queued backstop callback for the buffer being flushed.
    state.flushGeneration += 1;
    if (state.open.length === 0) {
      this.maybeCleanup(key, state);
      return;
    }
    const items = state.open;
    const firstAcceptedAt = state.firstAcceptedAt;
    const openLoading = state.openLoading;
    state.open = [];
    state.firstAcceptedAt = null;
    state.scheduledFlushAt = null;
    state.openLoading = null;

    if (!state.pending) {
      state.pending = items;
      // New batch enters the queue now, carrying THIS buffer's accept-loading. A later merge extends
      // this same already-queued batch and preserves both its timing anchor and its bound loading;
      // loading is only ever fired for a buffer that opens with no pending batch, so a merging buffer
      // never carries a second loading to overwrite it.
      state.pendingMeta = { firstAcceptedAt: firstAcceptedAt ?? items[0]?.acceptedAt ?? Date.now(), flushedAt: Date.now(), loading: openLoading };
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
    void Promise.all(droppedIds.map(async (webhookEventId) => {
      const updated = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId, status: 'received' },
        data: { status: 'rate_limited', errorCode: 'RATE_LIMITED', processedAt: new Date(), payloadJson: Prisma.DbNull },
      }).catch(() => ({ count: 0 }));
      if (updated.count === 1) {
        emitLineAiTerminalOutcome(this.logger, { webhookEventId, status: 'rate_limited', errorCode: 'RATE_LIMITED' });
      }
    }));
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
        const meta = state.pendingMeta;
        const dequeuedAt = Date.now();
        state.pending = null;
        state.pendingMeta = null;
        state.overflowNotified = false;
        try {
          await this.dispatchBatch(key, state, batch, meta, dequeuedAt);
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
    if (state.open.length === 0 && !state.pending && !state.processing && !state.mediaDrain && !state.debounceTimer) {
      this.chats.delete(key);
    }
  }

  private async dispatchBatch(
    key: string,
    state: ChatState,
    batchItems: LineBufferItem[],
    meta: ChatState['pendingMeta'] = null,
    dequeuedAtMs: number = Date.now(),
  ): Promise<void> {
    const items = sortBatchItems(batchItems);
    const groups = segmentBatch(items);
    // Consume THIS batch's own accept-loading exactly once, before ANY of its groups run — so the
    // request (and its loading_accepted) is ordered strictly before every final this batch delivers,
    // and a later batch's loading can never be consumed here.
    const loading = meta?.loading ?? null;
    const acceptLoadingShown = loading ? await this.consumeBatchLoading(loading) : false;
    // Skip the duplicate processing-start loading for the first content turn ONLY when the accept
    // request was shown AND its spinner is still up. If it was fired while a prior batch was
    // processing, that batch's final reply has since dismissed the spinner, so re-show it instead.
    let suppressContentLoading = acceptLoadingShown && !loading?.firedDuringProcessing;
    for (const group of groups) {
      const suppressLoading = suppressContentLoading && group.kind !== 'command';
      if (group.kind !== 'command') suppressContentLoading = false;
      if (group.kind === 'media' && group.textItems.length === 0) {
        this.queueMediaGroup(key, state, group, suppressLoading, meta);
        continue;
      }
      try {
        await this.dispatchGroup(state, group, suppressLoading);
      } catch (err) {
        this.logger.error({ msg: 'LINE buffer group dispatch failed', error: (err as Error).message });
        await this.deliverDispatchFailure(state, group);
      }
      this.emitApiTrace(state, group, meta, dequeuedAtMs);
    }
  }

  /** Media-only OCR has its own serial lane, so a slow document never freezes normal chat. */
  private queueMediaGroup(
    key: string,
    state: ChatState,
    group: Extract<LineBatchGroup, { kind: 'media' }>,
    suppressLoading: boolean,
    meta: ChatState['pendingMeta'],
  ): void {
    const previous = state.mediaDrain ?? Promise.resolve();
    let tracked: Promise<void>;
    tracked = previous.catch((err) => {
      this.logger.error({ msg: 'LINE media lane predecessor failed', error: (err as Error).message });
    }).then(async () => {
      const dequeuedAt = Date.now();
      try {
        await this.dispatchGroup(state, group, suppressLoading);
      } catch (err) {
        this.logger.error({ msg: 'LINE media lane dispatch failed', error: (err as Error).message });
        await this.deliverDispatchFailure(state, group);
      }
      this.emitApiTrace(state, group, meta, dequeuedAt);
    }).catch((err) => {
      // A fallback-delivery failure must not reject the lane and skip later receipts.
      this.logger.error({ msg: 'LINE media lane recovery failed', error: (err as Error).message });
    }).finally(() => {
      if (state.mediaDrain === tracked) {
        state.mediaDrain = null;
        this.maybeCleanup(key, state);
      }
    });
    state.mediaDrain = tracked;
  }

  /** Await a batch's accept-loading before its first final, once, and emit loading_accepted on success.
   *  Returns whether LINE accepted it (so the first content turn can decide to retry processing-start
   *  loading if it did not). */
  private async consumeBatchLoading(loading: BatchLoading): Promise<boolean> {
    if (loading.consumed) return false;
    loading.consumed = true;
    const accepted = await loading.promise;
    if (accepted) this.emitLoadingEvent('loading_accepted', loading.webhookEventId);
    return accepted;
  }

  /** Emit the API-owned ingress/buffer/queue trace leg for one dispatched turn (spec §12). Telemetry
   *  only: guarded so it can never affect the turn, correlated by webhookEventId without any raw
   *  message text or LINE user id. Downstream stage durations are the separate `line.ai.stage` events. */
  private emitApiTrace(
    state: ChatState,
    group: LineBatchGroup,
    meta: ChatState['pendingMeta'],
    dequeuedAtMs: number,
  ): void {
    try {
      const oneToOne = state.chatId === state.lineUserId;
      const primary = group.kind === 'command'
        ? group.item
        : group.kind === 'text'
          ? group.textItems.at(-1)
          : (group.mediaItems.at(-1) ?? group.textItems.at(-1));
      if (!primary) return;
      const trace = buildLineAiApiTrace({
        webhookEventId: primary.webhookEventId,
        oneToOne,
        segment: group.kind,
        firstAcceptedAtMs: meta?.firstAcceptedAt ?? null,
        flushedAtMs: meta?.flushedAt ?? dequeuedAtMs,
        dequeuedAtMs,
        // Per-SEGMENT truth: this batch's actual bound accept-loading request (not a config guess), and
        // never for a command segment — a command never requests loading even inside a batch that did.
        // `meta.loading` survives consumption (only `consumed` flips), so it stays accurate.
        loadingRequested: group.kind !== 'command' && meta?.loading != null,
      });
      this.logger.log({ msg: 'line.ai.api_trace', surface: 'employee_oa', ...trace });
    } catch {
      // Telemetry cannot change the outcome it observes.
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
    const claimedIds: string[] = [];
    for (const webhookEventId of ids) {
      const claimed = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId, status: 'received' },
        data: {
          status: 'response_ready',
          errorCode: 'RETRYABLE_LINE_BUFFER_DISPATCH_FAILED',
          processedAt: new Date(),
        },
      }).catch(() => ({ count: 0 }));
      if (claimed.count === 1) claimedIds.push(webhookEventId);
    }
    if (claimedIds.length === 0) return;

    const messages = [this.lineReply.buildTextMessage(DISPATCH_ERROR_REPLY)];
    let result: LineDeliveryResult = await this.lineReply
      .sendReply(source.replyToken, messages)
      .catch(() => 'failed_other' as const);
    if (result === 'failed_token') {
      result = await this.lineReply
        .sendPush(state.chatId, messages)
        .catch(() => 'failed_other' as const);
    }
    for (const webhookEventId of claimedIds) {
      const terminalStatus = result === 'ok' ? 'unavailable_delivered' : 'delivery_pending';
      const errorCode = result === 'ok' ? null : 'RETRYABLE_LINE_BUFFER_DISPATCH_FAILED';
      const terminal = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: {
          webhookEventId,
          status: 'response_ready',
          errorCode: 'RETRYABLE_LINE_BUFFER_DISPATCH_FAILED',
        },
        data: {
          status: terminalStatus,
          errorCode,
          processedAt: result === 'ok' ? new Date() : null,
          ...(result === 'ok' ? { payloadJson: Prisma.DbNull } : {}),
        },
      }).catch(() => ({ count: 0 }));
      if (terminal.count === 1) {
        emitLineAiTerminalOutcome(this.logger, { webhookEventId, status: terminalStatus, errorCode });
      }
    }
  }

  /** `suppressLoading` is true only for the batch's first content turn when the batch's accept-loading
   *  was already shown — it then skips the duplicate processing-start loading. */
  private async dispatchGroup(state: ChatState, group: LineBatchGroup, suppressLoading: boolean): Promise<void> {
    if (group.kind === 'command') {
      await this.processWebhook.execute(this.toTextEvent(state, [group.item]));
      return;
    }

    if (group.kind === 'text') {
      await this.dispatchTextTurn(state, group.textItems, suppressLoading);
      return;
    }

    // Media group: the group's text rides along as caption for each media turn.
    // If the router says the text was a standalone question (defer_text from the
    // first media turn), remaining media run caption-less and the text gets its
    // own turn afterwards, so the question is still answered (spec §8).
    const caption = joinGroupText(group.textItems);
    let deferText = false;
    for (let index = 0; index < group.mediaItems.length; index++) {
      const media = group.mediaItems[index];
      const result = await this.withWaitFeedback(
        state,
        LINE_MEDIA_RECEIVED_TEXT,
        (beforeReply) => this.processWebhook.executeReceiptUpload(
          { ...this.toMediaEvent(state, media), beforeReply },
          deferText ? '' : caption,
        ),
        // Only the very first media turn can reuse the batch's accept-loading; later turns re-show it.
        suppressLoading && index === 0,
        0,
        true,
      );
      if (index === 0 && result.outcome === 'defer_text') deferText = true;
    }
    if (deferText && group.textItems.length > 0) {
      await this.dispatchTextTurn(state, group.textItems, false);
    } else {
      await this.markBatched(group.textItems.map((item) => item.webhookEventId));
    }
  }

  private async dispatchTextTurn(state: ChatState, textItems: LineBufferTextItem[], suppressLoading: boolean): Promise<void> {
    const last = textItems[textItems.length - 1];
    const messageText = joinGroupText(textItems);
    const latestAcceptedAt = Math.max(...textItems.map((item) => item.acceptedAt));
    const statusDelayMs = Math.max(0, latestAcceptedAt + LINE_WAIT_STATUS_DELAY_MS - Date.now());
    await this.withWaitFeedback(
      state,
      lineWaitStatusText(messageText, last.webhookEventId),
      (beforeReply) => this.processWebhook.execute({ ...this.toTextEvent(state, textItems), beforeReply }),
      suppressLoading,
      statusDelayMs,
    );
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
      ...(media.companyIdAtAcceptance ? { companyIdAtAcceptance: media.companyIdAtAcceptance } : {}),
    };
  }

  /** Mark bubbles that were folded into a completed batched turn. Only rows
   *  still `received` — never clobber a terminal status. */
  private async markBatched(webhookEventIds: string[]): Promise<void> {
    for (const webhookEventId of webhookEventIds) {
      const updated = await this.prisma.client.lineWebhookEventLog.updateMany({
        where: { webhookEventId, status: 'received' },
        data: { status: 'batched', processedAt: new Date(), payloadJson: Prisma.DbNull },
      })
        .catch(() => ({ count: 0 }));
      if (updated.count === 1) {
        emitLineAiTerminalOutcome(this.logger, { webhookEventId, status: 'batched' });
      }
    }
  }

  /** Typing indicator while a turn runs. One-on-one chats only (LINE limit).
   *  Awaited so the start can never race after the actual reply. */
  private async startLoading(state: ChatState): Promise<void> {
    if (!this.config.lineAiLoadingAnimationEnabled) return;
    if (state.chatId !== state.lineUserId) return;
    await this.lineReply.startLoadingAnimation(state.lineUserId).catch(() => {});
  }

  /** Quick text turns use native loading only; genuinely slow turns get one varied status. Receipt OCR
   *  gets an immediate acknowledgement. Final delivery settles in-flight feedback to preserve order. */
  private async withWaitFeedback<T>(
    state: ChatState,
    statusText: string,
    turn: (beforeReply: () => Promise<void>) => Promise<T>,
    suppressLoading: boolean,
    statusDelayMs: number,
    statusWithoutLoading = false,
  ): Promise<T> {
    const finish = await this.startWaitFeedback(
      state,
      statusText,
      suppressLoading,
      statusDelayMs,
      statusWithoutLoading,
    );
    try {
      return await turn(finish);
    } finally {
      await finish();
    }
  }

  private async startWaitFeedback(
    state: ChatState,
    statusText: string,
    suppressLoading: boolean,
    statusDelayMs: number,
    statusWithoutLoading: boolean,
  ): Promise<() => Promise<void>> {
    // Loading and waiting feedback are 1:1 only; a group chat never shows either.
    if (state.chatId !== state.lineUserId) return async () => {};
    if (!this.config.lineAiLoadingAnimationEnabled && !statusWithoutLoading) return async () => {};

    // `suppressLoading` means this batch's accept-loading was actually SHOWN (LINE accepted it) and awaited
    // (in dispatchBatch) for this first content turn, and its spinner is still up — so skip the duplicate
    // processing-start request. Otherwise (flag off, LINE rejected the accept request, a prior batch
    // dismissed the spinner, or a later content turn) show the processing-start spinner now.
    if (!suppressLoading) await this.startLoading(state);
    let finished = false;
    let statusDelivery: Promise<void> | null = null;
    const restartDeliveries: Promise<void>[] = [];
    const restartTimers: NodeJS.Timeout[] = [];

    const deliverStatus = async () => {
      const delivered = await this.sendWaitStatus(state, statusText);
      if (!delivered || finished) return;
      // LINE dismisses loading when an OA bubble arrives. Restart after a short delivery cushion and
      // once more as a keepalive for slow devices; `settle` cancels both when the answer is ready.
      for (const delayMs of [LINE_LOADING_RESTART_DELAY_MS, LINE_LOADING_KEEPALIVE_DELAY_MS]) {
        restartTimers.push(setTimeout(() => {
          if (!finished) restartDeliveries.push(this.startLoading(state));
        }, delayMs));
      }
    };

    let statusTimer: NodeJS.Timeout | null = null;
    if (statusDelayMs === 0) {
      statusDelivery = deliverStatus();
    } else {
      statusTimer = setTimeout(() => {
        statusTimer = null;
        if (!finished) statusDelivery = deliverStatus();
      }, statusDelayMs);
    }

    return async () => {
      if (!finished) {
        finished = true;
        if (statusTimer) clearTimeout(statusTimer);
        for (const timer of restartTimers) clearTimeout(timer);
        statusTimer = null;
      }
      await statusDelivery;
      await Promise.all(restartDeliveries);
    };
  }

  private async sendWaitStatus(state: ChatState, text: string): Promise<boolean> {
    const result = await this.lineReply
      .sendPush(state.chatId, [this.lineReply.buildTextMessage(text)])
      .catch(() => 'failed_other' as const);
    if (result !== 'ok') {
      this.logger.warn({ msg: 'LINE waiting feedback delivery failed', result });
      return false;
    }
    return true;
  }

  /** SIGTERM (every deploy): flush all open buffers and drain in-flight work,
   *  bounded so a hung call cannot block container stop past the ECS grace
   *  period. The HTTP server is already closed, so no new events arrive. */
  async onModuleDestroy(): Promise<void> {
    for (const [key, state] of this.chats) {
      this.flushOpen(key, state);
    }
    const drainAll = async (): Promise<void> => {
      // A main drain can hand media to its detached lane after shutdown begins, so rescan until
      // both lanes are empty. The HTTP server is already closed and cannot enqueue more work.
      while (true) {
        const drains = [...new Set([...this.chats.values()]
          .flatMap((state) => [state.drain, state.mediaDrain])
          .filter((d): d is Promise<void> => !!d))];
        if (drains.length === 0) return;
        await Promise.all(drains);
      }
    };
    if (this.chats.size === 0) return;
    this.logger.log({ msg: 'LINE buffer shutdown drain', chats: this.chats.size });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), LINE_BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS);
    });
    const result = await Promise.race([drainAll().then(() => 'drained' as const), timeout]);
    clearTimeout(timer);
    if (result === 'timeout') {
      this.logger.warn({ msg: 'LINE buffer shutdown drain timed out', pendingChats: this.chats.size });
    }
  }
}
