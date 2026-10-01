import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';
import { CreateAutonomousCrmBookingUseCase } from '../../../crm/application/use-cases/crm-booking.use-case';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { PrismaCrmChannelCapRepository } from '../../infrastructure/prisma-crm-channel-cap.repository';
import { PrismaCrmBookingProposalRepository } from '../../../crm/infrastructure/prisma-crm-booking-proposal.repository';
import { classifyConfirmationReply, isExpired } from '../../../crm/domain/logic/crm-booking-proposal.logic';
import type { CrmBookingProposalRecord } from '../../../crm/domain/ports/crm-booking-proposal-repository.port';
import { LineMessagingAdapter, type LinePushResult } from '../../infrastructure/line-messaging.adapter';
import { bangkokDayBounds } from '../../domain/logic/crm-daily-brief.logic';
import { MessagingChannelSecretsService } from './messaging-channel.use-case';
import type {
  CompanyMessagingChannelRecord,
  CrmAutonomyJobRecord,
  CrmChannelIdentityRecord,
  CrmConversationRecord,
  LineInboundEvent,
} from '../../domain/models/crm-inbox.model';
import {
  computeFirstResponseDueAt,
  effectiveInboxPolicy,
  inboundProviderMessageId,
  isDownloadableLineMedia,
  isSupportedInboundEvent,
  isUnsupportedLineMedia,
  lineReplyRetryKeyForMessage,
  mapLineMessageType,
  matchesUnsubscribeKeyword,
  previewText,
  resolveReplySendOutcome,
  shouldReopenConversation,
  statusAfterStaffReply,
} from '../../domain/logic/crm-inbox.logic';
import { AUTONOMY_JOB_BACKOFF_BASE_MS, REPLY_SEND_MAX_ATTEMPTS } from '../../domain/crm-inbox.constants';
import {
  bangkokDateString,
  type BookingContactField,
  CRM_AUTO_REPLY_AGENT,
  extractBookingContactReply,
  formatBookingContactQuestion,
  formatBookingConfirm,
  formatBookingReviewQuestion,
  formatSlotProposal,
  missingBookingContactFields,
  normalizeLinePlainText,
  type CrmAutoReplyAgentPort,
  type CrmAutoReplyDecision,
} from '../../domain/logic/crm-auto-reply.logic';
import { bookingDayRange, computeFreeStartSlots, looksLikeRescheduleRequest } from '../../../crm/domain/logic/crm-booking.logic';
import { normalizePhone } from '../../../crm/domain/logic/crm.logic';
import {
  canonicalAttachmentExtension,
  inspectAttachmentBytes,
  normalizeAttachmentMimeType,
  validateAttachmentFileName,
  validateAttachmentMeta,
} from '../../../data-model-core/domain/logic/attachment.logic';
import { AttachmentMalwareScanner } from '../../../data-model-core/infrastructure/attachment-malware-scanner';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';

// End customers are CRM contacts, not users: ingestion runs as the system
// actor and never creates any principal, session, or AI access.
const SYSTEM_ACTOR = 'system';
const LINE_REPLY_TOKEN_FRESH_MS = 55_000;
const HOLDING_MESSAGE_TEXT = 'ได้รับข้อความแล้วค่ะ เจ้าหน้าที่จะรีบติดต่อกลับนะคะ';
const HOLDING_MESSAGE_BLOCKED_REASONS = new Set([
  'global_disabled',
  'channel_disabled',
  'conversation_disabled',
  'not_text',
  'context_unavailable',
  'consent_revoked',
  'exception',
  // High-confidence spam is intentionally silent — no answer and no holding
  // acknowledgement (never invite more spam).
  'spam_ignored',
]);

type LineReplyTokenState = {
  value: string;
  receivedAt: number;
  consumed: boolean;
};

type AutonomyContext = {
  channel: CompanyMessagingChannelRecord;
  identity: CrmChannelIdentityRecord;
  conversation: CrmConversationRecord;
  contentText: string | null;
  eventType: string;
  receivedAt: Date;
  replyToken?: LineReplyTokenState;
  /** The inbound message that triggered this turn — the stable idempotency anchor for a booking proposal. */
  sourceMessageId: string;
};

type BookingReviewSnapshot = {
  serviceName: string;
  slotStart: string;
  slotEnd: string;
  branchId: string;
  branchName: string;
  customerName: string;
  customerPhone: string;
};

/** Bounded provider payload only — never the raw webhook body. */
function boundedContentJson(message: LineInboundEvent['message']): Record<string, unknown> | undefined {
  if (!message) return undefined;
  return {
    lineType: message.type,
    fileName: message.fileName,
    stickerId: message.stickerId,
    packageId: message.packageId,
    latitude: message.latitude,
    longitude: message.longitude,
    address: message.address,
  };
}

/** CUST-12: the honest answer while no reschedule flow exists — the assistant stops here and a
 *  human picks the conversation up, rather than quietly booking a second appointment. */
const RESCHEDULE_HANDOFF_REPLY = 'รับเรื่องแล้วค่ะ 🙏 เรื่องเลื่อน/ยกเลิกนัด เจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันให้อีกครั้งนะคะ';

@Injectable()
export class ProcessInboundLineMessageUseCase {
  private readonly logger = new Logger(ProcessInboundLineMessageUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly crmRepo: PrismaCrmRepository,
    private readonly createAutonomousBooking: CreateAutonomousCrmBookingUseCase,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly line: LineMessagingAdapter,
    private readonly outbox: OutboxAppendService,
    private readonly config: AppConfigService,
    private readonly malwareScanner: AttachmentMalwareScanner,
    private readonly audit: AuditService,
    private readonly channelCap: PrismaCrmChannelCapRepository,
    private readonly bookingProposals: PrismaCrmBookingProposalRepository,
    @Inject(CRM_AUTO_REPLY_AGENT) private readonly autoReply: CrmAutoReplyAgentPort,
  ) {}

  async execute(channel: CompanyMessagingChannelRecord, events: LineInboundEvent[]): Promise<void> {
    for (const event of events) {
      if (!isSupportedInboundEvent(event)) continue;
      try {
        await this.processEvent(channel, event);
      } catch (error) {
        this.logger.error({
          msg: 'CRM inbox inbound event failed',
          channelId: channel.id,
          eventType: event.type,
          error: (error as Error).message,
        });
      }
    }
  }

  private async processEvent(channel: CompanyMessagingChannelRecord, event: LineInboundEvent): Promise<void> {
    const providerUserId = event.source!.userId!;

    if (event.type === 'unfollow') {
      const identity = await this.repo.findIdentity(channel.id, providerUserId);
      if (identity && identity.status !== 'UNFOLLOWED') {
        await this.repo.updateIdentityLifecycleUnlessErased({
          companyId: channel.companyId,
          identityId: identity.id,
          expectedCustomerId: identity.customerId,
          status: 'UNFOLLOWED',
          unfollowedAt: new Date(),
        });
      }
      return;
    }

    // Redelivery short-circuit BEFORE any state mutation: a duplicate must not
    // reopen a resolved conversation or churn identities. The unique
    // (companyId, providerMessageId) constraint stays as the race backstop.
    const providerMessageId = inboundProviderMessageId(event);
    if (event.type === 'message' && providerMessageId) {
      const existing = await this.repo.findMessageByProviderId(channel.companyId, providerMessageId);
      if (existing) return;
    }

    const identity = await this.ensureIdentity(channel, providerUserId);
    if (event.type === 'follow') return; // identity + customer ensured; nothing else to record

    // message event
    const conversation = await this.resolveConversation(channel, identity);
    const contentText = event.message?.text ?? null;
    const now = new Date();
    const replyToken = event.replyToken && typeof event.receivedAt === 'number'
      ? { value: event.replyToken, receivedAt: event.receivedAt, consumed: false }
      : undefined;

    const created = await this.repo.appendInboundMessage(
      {
        companyId: channel.companyId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        visibility: 'CUSTOMER',
        authorType: 'CUSTOMER',
        messageType: mapLineMessageType(event.message?.type),
        contentText,
        // Owner decision 2026-07-06: video/audio land with an explicit fail
        // marker (no download) — voice-to-text comes first, some day.
        contentJson: isUnsupportedLineMedia(event.message?.type)
          ? { ...boundedContentJson(event.message), mediaError: 'media_type_unsupported' }
          : boundedContentJson(event.message),
        providerMessageId,
        webhookEventId: event.webhookEventId,
        deliveryStatus: 'DELIVERED',
        sentAt: event.timestamp ? new Date(event.timestamp) : now,
      },
      conversation.id,
      {
        lastMessageAt: now,
        lastInboundAt: now,
        lastMessagePreview: previewText(contentText) ?? `[${mapLineMessageType(event.message?.type)}]`,
        ...(conversation.status === 'WAITING_CUSTOMER' ? { status: 'OPEN' } : {}),
      },
    );

    if (!created) return; // duplicate delivery — already processed

    // Marketing opt-out is handled before AI/autonomy. The inbound message is
    // retained as evidence, while transactional booking/service messaging stays
    // governed independently by the tenant policy.
    if (event.message?.type === 'text') {
      const consentPolicy = await this.repo.getConsentPolicy(channel.companyId);
      if (matchesUnsubscribeKeyword(contentText, consentPolicy)) {
        const revoked = await this.repo.revokeMarketingConsent(channel.companyId, identity.customerId, now);
        if (revoked) {
          await this.audit.log({
            companyId: channel.companyId,
            // Not `actorUserId: SYSTEM_ACTOR`: that id is no User row, the FK rejects the insert and
            // `audit.log` never throws, so the record of a consent withdrawal was silently lost.
            actorType: 'SYSTEM',
            actorRefId: 'crm-line-inbound',
            action: 'crm.customer.marketing_consent.revoked',
            targetType: 'crm_customer',
            targetId: identity.customerId,
            requestId: event.webhookEventId ?? providerMessageId ?? randomUUID(),
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            metadataJson: {
              source: 'LINE_UNSUBSCRIBE_KEYWORD',
              transactionalMessagesRemainEnabled: consentPolicy.transactionalMessagesRemainEnabledAfterMarketingOptOut,
            },
          });
          if (consentPolicy.unsubscribeConfirmationText) {
            await this.sendAutonomousAutoReply(
              channel, identity, conversation, consentPolicy.unsubscribeConfirmationText,
              event.webhookEventId ?? randomUUID(), 'CONSENT', now, replyToken, 'unsubscribe_confirmation',
            );
          }
        }
        return;
      }
    }

    let autonomyJob: CrmAutonomyJobRecord | undefined;
    if (event.message?.type === 'text' && channel.status === 'ACTIVE') {
      try {
        autonomyJob = (await this.repo.createAutonomyJob({
          companyId: channel.companyId,
          conversationId: conversation.id,
          messageId: created.id,
          ...(replyToken ? { replyToken: replyToken.value, replyTokenAt: new Date(replyToken.receivedAt) } : {}),
        })) ?? undefined;
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        // A concurrent/redelivered webhook already created the durable job.
      }
    }

    // Autonomy observability: record whether a job was created for this message
    // and why (channel status snapshot + message type gate the creation).
    console.log(JSON.stringify({
      msg: 'crm.autonomy.job_gate',
      created: Boolean(autonomyJob),
      messageType: event.message?.type ?? null,
      channelStatus: channel.status,
      conversationId: conversation.id,
      messageId: created.id,
    }));

    // LINE retains message content only briefly — fetch now, in the background,
    // so a large transfer can never stall the webhook past LINE's deadline.
    if (event.message?.id && isDownloadableLineMedia(event.message.type)) {
      void this.storeInboundMedia(channel, identity, conversation, created.id, event.message);
    }

    await this.outbox.append('crm.conversation.message_received', 'crm_conversation', conversation.id, {
      companyId: channel.companyId,
      actorUserId: SYSTEM_ACTOR,
      aggregateType: 'crm_conversation',
      aggregateId: conversation.id,
      occurredAt: now.toISOString(),
      data: { messageId: created.id, customerId: conversation.customerId, channelId: channel.id },
    });

    if (autonomyJob) {
      const claimedAttempt = autonomyJob.attempts + 1;
      const claimedAt = new Date();
      if (await this.repo.claimAutonomyJob(autonomyJob, claimedAt)) {
        const claimedJob = {
          ...autonomyJob,
          status: 'PENDING',
          attempts: claimedAttempt,
          nextAttemptAt: null,
          updatedAt: claimedAt,
        } as CrmAutonomyJobRecord;
        void this.runAutonomyJob(claimedJob, async () => {
          const freshConversation = await this.repo.findConversationById(channel.companyId, conversation.id);
          if (!freshConversation) throw new Error('autonomy_conversation_not_found');
          return {
            channel,
            identity,
            conversation: freshConversation,
            contentText,
            eventType: event.type,
            receivedAt: now,
            replyToken,
            sourceMessageId: created.id,
          };
        });
      }
    }
  }

  /** Re-enters the same evaluation/send path for a worker-claimed durable job. */
  async retryAutonomyJob(job: CrmAutonomyJobRecord): Promise<void> {
    await this.runAutonomyJob(job, async () => {
      const conversation = await this.repo.findConversationById(job.companyId, job.conversationId);
      if (!conversation) throw new Error('autonomy_conversation_not_found');
      const message = await this.repo.findMessageInConversation(job.companyId, job.conversationId, job.messageId);
      if (!message) throw new Error('autonomy_context_not_found');
      const newerOutbound = await this.repo.findLatestCustomerOutboundMessage(
        job.companyId,
        job.conversationId,
        message.createdAt,
      );
      if (newerOutbound) return null;
      const [channel, identity] = await Promise.all([
        this.repo.findChannelById(job.companyId, conversation.channelId),
        this.repo.findIdentityById(job.companyId, conversation.channelIdentityId),
      ]);
      if (!channel || !identity) throw new Error('autonomy_context_not_found');
      return {
        channel,
        identity,
        conversation,
        contentText: message.contentText,
        eventType: 'message',
        receivedAt: message.sentAt ?? message.createdAt,
        replyToken: job.replyToken && job.replyTokenAt
          ? { value: job.replyToken, receivedAt: job.replyTokenAt.getTime(), consumed: false }
          : undefined,
        sourceMessageId: message.id,
      };
    });
  }

  private async runAutonomyJob(
    job: CrmAutonomyJobRecord,
    loadContext: () => Promise<AutonomyContext | null>,
  ): Promise<void> {
    try {
      const context = await loadContext();
      if (context) {
        await this.tryAutonomousAutoReply(
          context.channel,
          context.identity,
          context.conversation,
          context.contentText,
          context.eventType,
          context.receivedAt,
          context.sourceMessageId,
          context.replyToken,
        );
      }
      await this.repo.updateAutonomyJob(job.id, {
        status: 'DONE',
        attempts: job.attempts,
        nextAttemptAt: null,
        lastError: null,
      });
      await this.kickNextAutonomyJob(job.companyId, job.conversationId);
    } catch (error) {
      const failedAt = new Date();
      try {
        await this.repo.updateAutonomyJob(job.id, {
          status: 'FAILED',
          attempts: job.attempts,
          nextAttemptAt: new Date(failedAt.getTime() + AUTONOMY_JOB_BACKOFF_BASE_MS * (2 ** Math.max(0, job.attempts - 1))),
          lastError: (error as Error).message,
        });
      } catch (markError) {
        this.logger.error({ msg: 'CRM autonomy job status update failed', jobId: job.id, error: (markError as Error).message });
      }
    }
  }

  private async kickNextAutonomyJob(companyId: string, conversationId: string): Promise<void> {
    const next = await this.repo.findOldestRunnableAutonomyJob(companyId, conversationId, new Date());
    if (!next) return;
    const claimedAt = new Date();
    if (!await this.repo.claimAutonomyJob(next, claimedAt)) return;
    await this.retryAutonomyJob({
      ...next,
      status: 'PENDING',
      attempts: next.attempts + 1,
      nextAttemptAt: null,
      updatedAt: claimedAt,
    });
  }

  /**
   * CUST-02: resolve a pending booking proposal from the customer's reply.
   * Returns true when this turn was consumed (confirmed/cancelled), false when
   * there is nothing to resolve or the reply is UNCLEAR (fall through to a
   * normal autonomy evaluation). Booking commits ONLY from an explicit confirm.
   */

  /**
   * CUST-12 containment. Returns true when this turn was consumed by a staff handoff.
   *
   * The assistant cannot move a committed booking, so the only safe outcome is to stop, put the
   * conversation in front of a human, and say so. The flag, the audit row and the outbox event
   * share one transaction keyed on the inbound message id, so a retried job cannot double-flag.
   * The reply is sent afterwards and is allowed to fail: the escalation is already durable.
   */
  private async handleRescheduleHandoff(
    channel: CompanyMessagingChannelRecord,
    identity: CrmChannelIdentityRecord,
    conversation: CrmConversationRecord,
    sourceMessageId: string,
    receivedAt: Date,
    replyToken?: LineReplyTokenState,
  ): Promise<boolean> {
    if (!identity.customerId) return false;
    const booking = await this.crmRepo.findUpcomingBookedForConversation(
      channel.companyId, conversation.id, identity.customerId, receivedAt,
    );
    if (!booking) return false; // nothing committed to protect — normal evaluation still applies

    const requestId = randomUUID();
    await this.repo.updateConversation(channel.companyId, conversation.id, { status: 'OPEN', priority: 'HIGH' });
    await this.audit.log({
      companyId: channel.companyId,
      action: 'crm.booking.reschedule_handoff',
      targetType: 'crm_booking',
      targetId: booking.id,
      requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { conversationId: conversation.id, sourceMessageId, startAt: booking.startAt.toISOString() },
    });
    await this.outbox.append('crm.booking.reschedule_requested', 'crm_booking', booking.id, {
      companyId: channel.companyId,
      aggregateType: 'crm_booking',
      aggregateId: booking.id,
      // The helper derives the unique eventKey from requestId, so keying it on the inbound
      // message id is what makes a retried job append this event exactly once.
      requestId: sourceMessageId,
      occurredAt: receivedAt.toISOString(),
      data: { conversationId: conversation.id, bookingId: booking.id },
    });

    // Deterministic safety reply: the customer must not be left waiting on an assistant that
    // will never act. `holdingReason` keeps it out of the AI cap; a blocked channel simply
    // means the flag and audit stand without a reply.
    await this.sendAutonomousAutoReply(
      channel, identity, conversation, RESCHEDULE_HANDOFF_REPLY, requestId, 'BOOKING_REQUEST',
      receivedAt, replyToken, 'reschedule_handoff',
    ).catch((error) => {
      this.logger.warn({ msg: 'crm.booking.reschedule_handoff_reply_failed', error: (error as Error).message });
      return false;
    });
    return true;
  }

  private async tryResolveBookingProposal(
    channel: CompanyMessagingChannelRecord,
    identity: CrmChannelIdentityRecord,
    conversation: CrmConversationRecord,
    contentText: string,
    receivedAt: Date,
    replyToken?: LineReplyTokenState,
  ): Promise<boolean> {
    // Honor the same autonomy gates as evaluate(): with the global kill switch
    // off, a confirmation reply must never commit a booking.
    if (!this.config.crmAutoReplyEnabled) return false;
    // Re-resolve the channel from the DB rather than trusting the `channel`
    // snapshot captured when the job was enqueued — an operator may have disabled
    // the channel since. Kill-switch state at the commit boundary must be fresh.
    const freshChannel = await this.repo.findChannelById(channel.companyId, channel.id);
    if (!freshChannel || freshChannel.status !== 'ACTIVE' || !freshChannel.autoReplyEnabled) return false;
    const active = await this.bookingProposals.findActiveByConversation(channel.companyId, conversation.id);
    if (!active) return false;
    const fresh = await this.repo.findConversationById(channel.companyId, conversation.id);
    if (!fresh || !fresh.autoReplyEnabled) return false;
    if (isExpired(active, receivedAt)) {
      await this.bookingProposals.markStatus(channel.companyId, active.id, active.status, 'EXPIRED').catch(() => undefined);
      return false; // stale proposal: let a fresh evaluation handle this turn
    }
    // Only a delivered proposal is confirmable. A PROPOSED row whose question
    // was never delivered (capped/failed send), or a CONFIRMED/COMMITTING row
    // already mid-flight, is not resolved by this turn — so a stray affirmative
    // can never commit a slot the customer was never actually asked to confirm.
    if (active.status !== 'AWAITING_CONFIRMATION') return false;
    let intent = classifyConfirmationReply(contentText);
    let confirmedReview: BookingReviewSnapshot | null = null;
    let changedReviewPrompt: { text: string; contentJson: Record<string, unknown> } | null = null;
    let changedReviewReason: 'booking_contact_required' | 'booking_review_changed' | null = null;
    const latestBookingPrompt = await this.repo.findLatestBookingPromptMessage(channel.companyId, conversation.id, active.id);
    const contactFields = latestBookingPrompt?.contentJson?.['operationalType'] === 'BOOKING_CONTACT'
      ? this.bookingContactFields(latestBookingPrompt.contentJson?.['missingFields'])
      : [];
    if (intent !== 'CANCEL' && contactFields.length > 0) {
      const consumed = await this.handleBookingContactReply(
        channel,
        identity,
        fresh,
        active,
        contentText,
        contactFields,
        receivedAt,
        replyToken,
      );
      if (consumed) return true;
    }
    if (intent !== 'CANCEL' && latestBookingPrompt?.contentJson?.['operationalType'] === 'BOOKING_CONFIRMATION') {
      const currentPrompt = await this.buildBookingPrompt(channel.companyId, active, true);
      if (currentPrompt.contentJson['operationalType'] === 'BOOKING_CONTACT') {
        changedReviewPrompt = currentPrompt;
        changedReviewReason = 'booking_contact_required';
      } else {
        const deliveredReview = this.bookingReviewSnapshot(latestBookingPrompt.contentJson);
        const currentReview = this.bookingReviewSnapshot(currentPrompt.contentJson);
        if (!deliveredReview || !currentReview || !this.sameBookingReview(deliveredReview, currentReview)) {
          changedReviewPrompt = currentPrompt;
          changedReviewReason = 'booking_review_changed';
        } else {
          confirmedReview = currentReview;
        }
      }
    }
    if (intent === 'UNCLEAR' && this.autoReply.classifyBookingConfirmation) {
      try {
        intent = await this.autoReply.classifyBookingConfirmation({
          companyId: channel.companyId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
        });
      } catch (error) {
        this.logger.warn({
          msg: 'CRM booking semantic confirmation unavailable',
          conversationId: conversation.id,
          error: (error as Error).message,
        });
      }
    }
    if (intent === 'CONFIRM' && changedReviewPrompt && changedReviewReason) {
      const requestId = randomUUID();
      const delivered = await this.sendAwaitingBookingPrompt(
        channel, identity, fresh, active, changedReviewPrompt, requestId, receivedAt, replyToken,
      );
      await this.auditAutoReply(channel.companyId, fresh.id, requestId, delivered ? 'SUCCESS' : 'DENIED', {
        turnClass: 'BOOKING_REQUEST',
        sent: delivered,
        reason: changedReviewReason,
        proposalId: active.id,
      });
      return true;
    }
    if (intent === 'CONFIRM' && contactFields.length > 0) {
      const requestId = randomUUID();
      const prompt = {
        text: formatBookingContactQuestion(contactFields),
        contentJson: { operationalType: 'BOOKING_CONTACT', proposalId: active.id, missingFields: contactFields },
      };
      const delivered = await this.sendAwaitingBookingPrompt(
        channel, identity, fresh, active, prompt, requestId, receivedAt, replyToken,
      );
      await this.auditAutoReply(channel.companyId, fresh.id, requestId, delivered ? 'SUCCESS' : 'DENIED', {
        turnClass: 'BOOKING_REQUEST',
        sent: delivered,
        reason: 'booking_contact_required',
        proposalId: active.id,
      });
      return true;
    }
    if (intent === 'UNCLEAR') return false; // the customer may be asking something else

    const requestId = randomUUID();
    const bookingInput = {
      branchId: active.branchId ?? '',
      staffUserId: active.staffUserId ?? '',
      serviceName: active.serviceName ?? '',
      customerId: active.customerId,
      startAt: active.slotStart,
      endAt: active.slotEnd,
      sourceConversationId: active.conversationId,
    };

    if (intent === 'CANCEL') {
      try {
        if (!(await this.bookingProposals.markStatus(channel.companyId, active.id, active.status, 'CANCELLED'))) return true;
      } catch {
        return true; // a concurrent commit already moved it past a cancellable state
      }
      // CANCELLED is already durable — a notification throw (e.g. 'customer_personal_data_erased')
      // must not escape and skip the business-outcome audit. Contain it; audit the real sent. (G3)
      let notified = false;
      try {
        notified = await this.sendAutonomousAutoReply(channel, identity, fresh, 'ยกเลิกการจองให้แล้วนะคะ 🙏 หากต้องการนัดใหม่แจ้งได้เลยค่ะ', requestId, 'BOOKING_REQUEST', receivedAt, replyToken);
      } catch (sendError) {
        this.logger.warn({ msg: 'CRM booking cancel notification failed after cancel', proposalId: active.id, error: (sendError as Error).message });
      }
      await this.auditAutoReply(channel.companyId, fresh.id, requestId, 'SUCCESS', {
        turnClass: 'BOOKING_REQUEST', sent: notified, reason: 'booking_cancelled', proposalId: active.id,
      });
      return true;
    }

    // Hold the per-conversation ask lock across the provenance read + resolution so a
    // bare confirm waits for any in-flight sibling ask's question-visibility + stamp —
    // the ambiguity gate can no longer read stale provenance and book the wrong slot.
    // The lock covers up to the AWAITING→CONFIRMED CAS; the CONFIRMED→COMMITTING CAS and
    // the booking transaction run OUTSIDE it (the proposal is already claimed by the
    // CONFIRMED CAS, and supersede never touches a CONFIRMED row). (CUST-02)
    const confirmed = await this.bookingProposals.withAskLock(channel.companyId, conversation.id, async (tx) => {
      // R9: `active` was loaded BEFORE the lock was acquired — a preceding lock holder
      // (an in-flight ask, a supersede, or a denied re-ask that pre-stamped then
      // restored) may have changed the row while this confirm was queued. Re-read the
      // durable row now that we hold the lock (outer client is authoritative here:
      // every stamp writer holds this same lock, so nothing is in flight) and use IT
      // for the status guard, the provenance comparison, and the restoration value —
      // a stale snapshot must never decide the gate or clobber a legitimate stamp.
      const current = await this.bookingProposals.findById(channel.companyId, active.id);
      if (!current || current.status !== 'AWAITING_CONFIRMATION') return false; // superseded/expired while queued: consume, commit nothing
      // F3: commit only the proposal the customer most-recently actually saw asked. A
      // stale question delivered last (a superseded sibling), a tie, or this active
      // proposal never having been asked at all, makes "ยืนยัน" ambiguous — re-ask THIS
      // active proposal and commit nothing this turn, so a confirmation can never book a
      // slot the customer did not mean. Read the provenance ON the ask-lock tx so it is
      // atomic with the CONFIRMED claim below; compared against OTHER proposals' stamps
      // (the active's own no longer masks a sibling's) with a fail-closed `>=` tie.
      const otherLatest = await this.bookingProposals.findLatestQuestionSentAt(channel.companyId, conversation.id, active.id, tx);
      const ambiguousQuestion =
        !current.questionSentAt ||
        Boolean(otherLatest && otherLatest.getTime() >= current.questionSentAt.getTime());
      if (ambiguousQuestion || !confirmedReview) {
        // Pre-stamp THIS proposal on the OUTER client (durable) BEFORE the re-ask can be seen,
        // so a re-ask that IS delivered makes this (newest active) slot the one a later "ยืนยัน"
        // resolves — never a superseded sibling — and a death after the stamp keeps that. H1: a
        // re-ask that is NOT delivered must not keep the false stamp, or a later bare confirm
        // would book a slot whose corrective question never arrived — so capture the prior stamp
        // (from the in-lock row, never the pre-lock snapshot) and restore it on a non-delivered
        // send (fail-closed: at worst one more re-ask next "ยืนยัน", never a wrong commit).
        // Restoring is fail-closed in both subcases: even if the push actually reached the
        // customer despite a false-negative return, the older stamp only forces one more re-ask.
        const priorStamp = current.questionSentAt;
        await this.bookingProposals.recordQuestionSent(channel.companyId, active.id);
        // K1: the ask-lock liveness probe runs as preSend INSIDE the send's customer lock,
        // immediately before the push — a probe failure returns reasked=false (never throws) and
        // is reverted by the `!reasked` restore below. K2: a genuine send THROW (e.g.
        // 'customer_personal_data_erased') before delivery must also revert the pre-stamp — else a
        // later bare confirm resolves a slot whose corrective question never arrived — so restore
        // the prior stamp then rethrow so the durable job retry re-enters safely.
        let reasked: boolean;
        try {
          const prompt = await this.buildBookingPrompt(channel.companyId, active);
          reasked = await this.sendAutonomousAutoReply(
            channel,
            identity,
            fresh,
            prompt.text,
            requestId,
            'BOOKING_REQUEST',
            receivedAt,
            replyToken,
            undefined,
            () => this.bookingProposals.assertAskLockAlive(tx),
            false,
            prompt.contentJson,
          );
        } catch (sendError) {
          await this.bookingProposals.restoreQuestionSentAt(channel.companyId, active.id, priorStamp);
          throw sendError;
        }
        if (!reasked) await this.bookingProposals.restoreQuestionSentAt(channel.companyId, active.id, priorStamp);
        await this.auditAutoReply(channel.companyId, fresh.id, requestId, reasked ? 'SUCCESS' : 'DENIED', {
          turnClass: 'BOOKING_REQUEST',
          sent: reasked,
          reason: ambiguousQuestion ? 'ambiguous_question_reasked' : 'booking_review_required',
          proposalId: active.id,
        });
        return false;
      }

      // CONFIRM — final-boundary re-resolution: re-read the channel and conversation one
      // last time (OUTER client, reads only) immediately before the commit so a kill-switch
      // flip during the classify hop still aborts (fail-closed, no booking). The proposal is
      // left at HANDED_TO_STAFF for a human to complete.
      const [commitChannel, commitConversation] = await Promise.all([
        this.repo.findChannelById(channel.companyId, channel.id),
        this.repo.findConversationById(channel.companyId, conversation.id),
      ]);
      if (
        !commitChannel || commitChannel.status !== 'ACTIVE' || !commitChannel.autoReplyEnabled ||
        !commitConversation || !commitConversation.autoReplyEnabled
      ) {
        await this.bookingProposals.markStatus(channel.companyId, active.id, active.status, 'HANDED_TO_STAFF').catch(() => undefined);
        await this.auditAutoReply(channel.companyId, fresh.id, requestId, 'DENIED', {
          turnClass: 'BOOKING_REQUEST', sent: false, reason: 'autonomy_disabled_at_commit', proposalId: active.id,
        });
        return false;
      }

      // Claim the proposal ON the ask-lock tx: concurrent confirmations collapse to one
      // winner (CAS), and if the holder dies/expires before the tx commits this AWAITING→
      // CONFIRMED hop rolls back with it — no half-claimed proposal (fail-closed).
      return this.bookingProposals.markStatus(channel.companyId, active.id, 'AWAITING_CONFIRMATION', 'CONFIRMED', undefined, tx);
    });
    // Ambiguous re-ask, kill-switch handoff, or a lost CONFIRMED CAS all consume the turn.
    if (!confirmed) return true;
    if (!(await this.bookingProposals.markStatus(channel.companyId, active.id, 'CONFIRMED', 'COMMITTING'))) return true;
    try {
      // createAutonomousBooking re-validates active staff/branch/consent and the
      // slot under a transaction lock (CUST-04). The tx hooks couple the kill-switch
      // fence and the COMMITTING→BOOKED finalize to the booking write itself, so a
      // late disable (assertWithinTx) or a lost confirm race (finalizeWithinTx)
      // rolls the booking back — no orphan booking, no double-book.
      const booking = await this.createAutonomousBooking.execute(channel.companyId, bookingInput, {
        expectedCustomerContact: {
          displayName: confirmedReview!.customerName,
          primaryPhone: confirmedReview!.customerPhone,
        },
        assertWithinTx: (tx) => this.repo.assertAutonomyEnabledWithinTx(tx, channel.companyId, channel.id, conversation.id),
        finalizeWithinTx: (tx, bookingRow) => this.bookingProposals.finalizeBookedWithinTx(tx, channel.companyId, active.id, bookingRow.id),
      });
      // The booking is committed (the proposal is already BOOKED via finalizeWithinTx).
      // A notification failure — even a throw, e.g. 'customer_personal_data_erased' —
      // must NOT reach the commit-failure handler below and tell staff no booking
      // exists while the calendar holds one, so it is contained here and the outcome is
      // always audited SUCCESS. (F4/F8)
      let notified = false;
      try {
        notified = await this.sendAutonomousAutoReply(
          channel,
          identity,
          fresh,
          formatBookingConfirm(
            bookingInput.serviceName,
            active.slotStart,
            active.slotEnd,
            confirmedReview!.branchName,
            confirmedReview!.customerName,
            confirmedReview!.customerPhone,
          ),
          requestId,
          'BOOKING_REQUEST',
          receivedAt,
          replyToken,
        );
      } catch (sendError) {
        this.logger.warn({ msg: 'CRM booking confirm notification failed after commit', proposalId: active.id, bookingId: booking.id, error: (sendError as Error).message });
      }
      await this.auditAutoReply(channel.companyId, fresh.id, requestId, 'SUCCESS', {
        turnClass: 'BOOKING_REQUEST', sent: notified, reason: notified ? 'booked' : 'booked_not_notified', bookingId: booking.id, proposalId: active.id,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        await this.bookingProposals.markStatus(channel.companyId, active.id, 'COMMITTING', 'CONFLICTED');
        // CONFLICTED is already durable — slot-proposal formatting or the send throwing
        // must not escape and skip the business-outcome audit. Contain both; audit the
        // real sent boolean. (G3)
        let notified = false;
        try {
          const proposeText = await this.formatConflictSlotProposal(channel.companyId, bookingInput, receivedAt);
          notified = await this.sendAutonomousAutoReply(channel, identity, fresh, proposeText, requestId, 'BOOKING_REQUEST', receivedAt, replyToken);
        } catch (sendError) {
          this.logger.warn({ msg: 'CRM slot-taken proposal notification failed after conflict', proposalId: active.id, error: (sendError as Error).message });
        }
        await this.auditAutoReply(channel.companyId, fresh.id, requestId, 'SUCCESS', {
          turnClass: 'BOOKING_REQUEST', sent: notified, reason: 'slot_taken_proposed', proposalId: active.id,
        });
        return true;
      }
      if ((error as Error).message === 'booking_contact_required') {
        const reopened = await this.bookingProposals.markStatus(
          channel.companyId,
          active.id,
          'COMMITTING',
          'AWAITING_CONFIRMATION',
        );
        if (reopened) {
          // This path can only follow a detailed review that the customer already
          // confirmed. Preserve that reviewed name and request only contact data
          // that disappeared at the final transaction boundary.
          const prompt = await this.buildBookingPrompt(channel.companyId, active, true);
          const delivered = await this.sendAwaitingBookingPrompt(
            channel, identity, fresh, active, prompt, requestId, receivedAt, replyToken,
          );
          await this.auditAutoReply(channel.companyId, fresh.id, requestId, delivered ? 'SUCCESS' : 'DENIED', {
            turnClass: 'BOOKING_REQUEST',
            sent: delivered,
            reason: 'booking_contact_required',
            proposalId: active.id,
          });
        }
        return true;
      }
      if ((error as Error).message === 'booking_review_changed') {
        const reopened = await this.bookingProposals.markStatus(
          channel.companyId,
          active.id,
          'COMMITTING',
          'AWAITING_CONFIRMATION',
        );
        if (reopened) {
          const prompt = await this.buildBookingPrompt(channel.companyId, active, true);
          const delivered = await this.sendAwaitingBookingPrompt(
            channel, identity, fresh, active, prompt, requestId, receivedAt, replyToken,
          );
          await this.auditAutoReply(channel.companyId, fresh.id, requestId, delivered ? 'SUCCESS' : 'DENIED', {
            turnClass: 'BOOKING_REQUEST',
            sent: delivered,
            reason: 'booking_review_changed',
            proposalId: active.id,
          });
        }
        return true;
      }
      // A non-conflict failure at commit (consent revoked / staff inactive / infra
      // error / the in-txn kill-switch fence firing) must never strand the proposal
      // at COMMITTING — that would silently swallow later confirmations without ever
      // booking. Move it to a terminal staff-handoff (fail-closed: no booking) and
      // record why. 'autonomy_disabled_at_commit' is the kill-switch fence.
      await this.bookingProposals.markStatus(channel.companyId, active.id, 'COMMITTING', 'HANDED_TO_STAFF').catch(() => undefined);
      const disabledAtCommit = (error as Error).message === 'autonomy_disabled_at_commit';
      await this.auditAutoReply(channel.companyId, fresh.id, requestId, 'DENIED', {
        turnClass: 'BOOKING_REQUEST', sent: false,
        reason: disabledAtCommit ? 'autonomy_disabled_at_commit' : 'commit_failed_handed_to_staff',
        proposalId: active.id,
        ...(disabledAtCommit ? {} : { error: (error as Error).message }),
      });
    }
    return true;
  }

  private bookingContactFields(value: unknown): BookingContactField[] {
    if (!Array.isArray(value)) return [];
    return value.filter((field): field is BookingContactField => field === 'name' || field === 'phone');
  }

  private bookingReviewSnapshot(contentJson: Record<string, unknown> | undefined): BookingReviewSnapshot | null {
    const value = contentJson?.['bookingReview'];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const review = value as Record<string, unknown>;
    const keys: Array<keyof BookingReviewSnapshot> = [
      'serviceName', 'slotStart', 'slotEnd', 'branchId', 'branchName', 'customerName', 'customerPhone',
    ];
    if (keys.some((key) => typeof review[key] !== 'string' || !(review[key] as string).trim())) return null;
    return Object.fromEntries(keys.map((key) => [key, review[key]])) as BookingReviewSnapshot;
  }

  private sameBookingReview(left: BookingReviewSnapshot, right: BookingReviewSnapshot): boolean {
    return left.serviceName === right.serviceName &&
      left.slotStart === right.slotStart &&
      left.slotEnd === right.slotEnd &&
      left.branchId === right.branchId &&
      left.branchName === right.branchName &&
      left.customerName === right.customerName &&
      normalizePhone(left.customerPhone) === normalizePhone(right.customerPhone);
  }

  private async buildBookingPrompt(
    companyId: string,
    proposal: Pick<CrmBookingProposalRecord, 'id' | 'customerId' | 'serviceName' | 'branchId' | 'slotStart' | 'slotEnd'>,
    trustExistingName = false,
  ): Promise<{ text: string; contentJson: Record<string, unknown> }> {
    const [customer, branchName] = await Promise.all([
      this.crmRepo.findCustomerById(companyId, proposal.customerId),
      proposal.branchId ? this.crmRepo.findActiveBranchName(companyId, proposal.branchId) : Promise.resolve(null),
    ]);
    if (!customer) throw new Error('customer_not_found');
    const missingFields = missingBookingContactFields(customer, { trustExistingName });
    if (missingFields.length > 0) {
      return {
        text: formatBookingContactQuestion(missingFields),
        contentJson: { operationalType: 'BOOKING_CONTACT', proposalId: proposal.id, missingFields },
      };
    }
    if (!branchName || !proposal.branchId || !proposal.serviceName || !customer.primaryPhone) {
      throw new Error('booking_review_incomplete');
    }
    return {
      text: formatBookingReviewQuestion(
        proposal.serviceName,
        proposal.slotStart,
        proposal.slotEnd,
        branchName,
        customer.displayName,
        customer.primaryPhone,
      ),
      contentJson: {
        operationalType: 'BOOKING_CONFIRMATION',
        proposalId: proposal.id,
        bookingReview: {
          serviceName: proposal.serviceName,
          slotStart: proposal.slotStart.toISOString(),
          slotEnd: proposal.slotEnd.toISOString(),
          branchId: proposal.branchId,
          branchName,
          customerName: customer.displayName,
          customerPhone: customer.primaryPhone,
        } satisfies BookingReviewSnapshot,
      },
    };
  }

  private async sendAwaitingBookingPrompt(
    channel: CompanyMessagingChannelRecord,
    identity: CrmChannelIdentityRecord,
    conversation: CrmConversationRecord,
    proposal: CrmBookingProposalRecord,
    prompt: { text: string; contentJson: Record<string, unknown> },
    requestId: string,
    receivedAt: Date,
    replyToken?: LineReplyTokenState,
  ): Promise<boolean> {
    return this.bookingProposals.withAskLock(channel.companyId, conversation.id, async (tx) => {
      const current = await this.bookingProposals.findById(channel.companyId, proposal.id);
      if (!current || current.status !== 'AWAITING_CONFIRMATION') return false;
      const priorStamp = current.questionSentAt;
      await this.bookingProposals.recordQuestionSent(channel.companyId, proposal.id);
      let sent: boolean;
      try {
        sent = await this.sendAutonomousAutoReply(
          channel,
          identity,
          conversation,
          prompt.text,
          requestId,
          'BOOKING_REQUEST',
          receivedAt,
          replyToken,
          undefined,
          () => this.bookingProposals.assertAskLockAlive(tx),
          false,
          prompt.contentJson,
        );
      } catch (error) {
        await this.bookingProposals.restoreQuestionSentAt(channel.companyId, proposal.id, priorStamp);
        throw error;
      }
      if (!sent) await this.bookingProposals.restoreQuestionSentAt(channel.companyId, proposal.id, priorStamp);
      return sent;
    });
  }

  private async handleBookingContactReply(
    channel: CompanyMessagingChannelRecord,
    identity: CrmChannelIdentityRecord,
    conversation: CrmConversationRecord,
    proposal: CrmBookingProposalRecord,
    contentText: string,
    expectedFields: BookingContactField[],
    receivedAt: Date,
    replyToken?: LineReplyTokenState,
  ): Promise<boolean> {
    const contact = extractBookingContactReply(contentText, expectedFields);
    const isQuestion =
      /[?？]|(?:อะไร|ไหม|มั้ย|หรือเปล่า|กี่|เมื่อไหร่|ที่ไหน|ขาย|บริการ|ราคา|how|what|when|where)/iu.test(contentText);
    const looksLikeContact =
      Boolean(contact.displayName || contact.primaryPhone) ||
      (!isQuestion && /(?:ชื่อ|name|เบอร์|โทร)|\d{7,}/iu.test(contentText));
    if (!looksLikeContact) return false;

    const customer = await this.crmRepo.fillMissingBookingContact(channel.companyId, proposal.customerId, {
      displayName: contact.displayName,
      primaryPhone: contact.primaryPhone,
      lineProfileDisplayName: identity.displayName ?? undefined,
    });
    const remaining = expectedFields.filter((field) => (
      field === 'name'
        ? !contact.displayName
        : !normalizePhone(customer.primaryPhone)
    ));
    const prompt = remaining.length > 0
      ? {
          text: formatBookingContactQuestion(remaining),
          contentJson: { operationalType: 'BOOKING_CONTACT', proposalId: proposal.id, missingFields: remaining },
        }
      : await this.buildBookingPrompt(channel.companyId, proposal);
    const requestId = randomUUID();
    const delivered = await this.sendAwaitingBookingPrompt(
      channel, identity, conversation, proposal, prompt, requestId, receivedAt, replyToken,
    );
    await this.auditAutoReply(channel.companyId, conversation.id, requestId, delivered ? 'SUCCESS' : 'DENIED', {
      turnClass: 'BOOKING_REQUEST',
      sent: delivered,
      reason: remaining.length > 0 ? 'booking_contact_required' : 'booking_contact_collected',
      proposalId: proposal.id,
    });
    return true;
  }

  private async tryAutonomousAutoReply(
    channel: CompanyMessagingChannelRecord,
    identity: CrmChannelIdentityRecord,
    conversation: CrmConversationRecord,
    contentText: string | null,
    eventType: string,
    receivedAt: Date,
    sourceMessageId: string,
    replyToken?: LineReplyTokenState,
  ): Promise<void> {
    // CUST-12: a request to move or cancel an appointment that ALREADY EXISTS must never reach
    // autonomous booking — that path has no notion of the committed booking and would create a
    // second real one. Checked before proposal resolution, and against the booking table rather
    // than the proposal state machine, which can disagree with reality in both directions.
    if (looksLikeRescheduleRequest(contentText)
      && await this.handleRescheduleHandoff(channel, identity, conversation, sourceMessageId, receivedAt, replyToken)) {
      return;
    }

    // CUST-02: a reply to a pending booking proposal resolves it (confirm →
    // commit, cancel → drop) instead of a fresh autonomy evaluation. An
    // availability question (UNCLEAR) falls through to normal evaluation.
    if (typeof contentText === 'string' && contentText.trim().length > 0) {
      const resolved = await this.tryResolveBookingProposal(channel, identity, conversation, contentText, receivedAt, replyToken);
      if (resolved) return;
    }
    let decision: CrmAutoReplyDecision | undefined;
    try {
      decision = await this.autoReply.evaluate({
        channel,
        conversation,
        contentText,
        eventType,
        receivedAt,
      });
      const freshConversation = await this.repo.findConversationById(channel.companyId, conversation.id);
      if (!freshConversation) throw new Error('autonomy_conversation_not_found');
      if (!freshConversation.autoReplyEnabled) {
        if (decision.action !== 'skip' || decision.reason !== 'conversation_disabled') {
          await this.auditAutoReply(channel.companyId, conversation.id, decision.requestId, 'DENIED', {
            turnClass: decision.turnClass,
            sent: false,
            reason: 'conversation_disabled',
          });
        }
        return;
      }
      if (decision.action === 'skip' && decision.reason === 'exception') {
        throw new Error('autonomy_evaluate_failed');
      }
      console.log(JSON.stringify({
        msg: 'crm.autonomy.post_evaluate',
        action: decision.action,
        reason: decision.action === 'skip' ? decision.reason : null,
        turnClass: decision.turnClass ?? null,
        conversationId: conversation.id,
        requestId: decision.requestId,
      }));
      if (decision.action === 'send') {
        await this.sendAutonomousAutoReply(channel, identity, freshConversation, decision.draftText, decision.requestId, decision.turnClass, receivedAt, replyToken, undefined, undefined, decision.replySource === 'DETERMINISTIC');
      } else if (decision.action === 'book') {
        // CUST-02: never commit a booking from a single message. Persist a
        // proposal and ask the customer to confirm; the commit happens only on
        // an explicit confirmation reply resolved in tryResolveBookingProposal.
        const bi = decision.bookingInput;
        // Capture before the withAskLock closure: `decision` is a `let`, so its 'book'
        // narrowing does not carry into the nested async function.
        const { requestId: bookRequestId, turnClass: bookTurnClass } = decision;
        // createSuperseding atomically create-once-by-idempotencyKey AND (only when
        // fresh) supersedes earlier unconfirmed proposals under a per-conversation
        // lock — so a later "ยืนยัน" can only ever resolve this most-recent slot and
        // two concurrent evaluations can't race create against supersede.
        const { proposal, fresh } = await this.bookingProposals.createSuperseding({
          companyId: channel.companyId,
          conversationId: freshConversation.id,
          customerId: bi.customerId,
          serviceName: bi.serviceName,
          staffUserId: bi.staffUserId,
          branchId: bi.branchId,
          slotStart: bi.startAt,
          slotEnd: bi.endAt,
          expiresAt: new Date(receivedAt.getTime() + 30 * 60_000),
          sourceMessageId,
          // Fingerprint the slot so a re-inquiry about the *same* proposed slot
          // collapses to the open row (left intact, fresh=false), while a different
          // slot is a distinct proposal that supersedes it.
          idempotencyKey: [
            freshConversation.id,
            bi.startAt.toISOString(),
            bi.endAt.toISOString(),
            bi.serviceName,
            bi.staffUserId ?? '',
            bi.branchId ?? '',
          ].join('|'),
        });
        // Act only on a freshly-created row. An existing row — whether already
        // AWAITING (same-slot re-inquiry) or terminal (a stale fingerprint) — is
        // left untouched: no re-supersede of a valid proposal, no phantom question.
        if (fresh) {
          // Hold the per-conversation ask lock across question-visibility + stamp so a
          // confirm turn's provenance read cannot land in the gap between this question's
          // LINE push (externally visible) and its recordQuestionSent stamp. (CUST-02)
          await this.bookingProposals.withAskLock(channel.companyId, freshConversation.id, async (tx) => {
            // A concurrent evaluation may have superseded this row between createSuperseding
            // and here — only ask about a row that is still PROPOSED, so a question the
            // customer never should have seen is never the last one delivered. (F3)
            const current = await this.bookingProposals.findById(channel.companyId, proposal.id);
            if (current?.status === 'PROPOSED') {
              // Pre-stamp on the OUTER client (auto-commit, durable) BEFORE the question can
              // be seen: questionSentAt = "this ask became potentially visible during this lock
              // tenure". If the pod dies after the push but before the CAS, the stamp is already
              // durable → a later confirm reads it as a sibling → ambiguous → re-ask (fail-closed).
              // A stamped-but-undelivered PROPOSED row only makes OTHER confirms more conservative;
              // it stays PROPOSED (the CAS below fires only on a delivered send) and expires. (F3)
              await this.bookingProposals.recordQuestionSent(channel.companyId, proposal.id);
              // Advance to the confirmable state ONLY after the question is actually delivered.
              // A capped/failed send leaves the proposal at PROPOSED (not resolvable) to expire —
              // so a later stray "ok" can never commit a slot the customer never saw asked. K1: the
              // ask-lock liveness probe runs as preSend inside the send's customer lock, immediately
              // before the push — a probe failure returns delivered=false, so the CAS never runs and
              // the row stays PROPOSED (the pre-stamp is harmless/conservative) to expire (fail-closed).
              const prompt = await this.buildBookingPrompt(channel.companyId, proposal);
              const delivered = await this.sendAutonomousAutoReply(
                channel,
                identity,
                freshConversation,
                prompt.text,
                bookRequestId,
                bookTurnClass,
                receivedAt,
                replyToken,
                undefined,
                () => this.bookingProposals.assertAskLockAlive(tx),
                false,
                prompt.contentJson,
              );
              if (delivered && await this.bookingProposals.markStatus(channel.companyId, proposal.id, 'PROPOSED', 'AWAITING_CONFIRMATION')) {
                await this.auditAutoReply(channel.companyId, freshConversation.id, bookRequestId, 'SUCCESS', {
                  turnClass: bookTurnClass,
                  sent: true,
                  reason: 'booking_proposed',
                  proposalId: proposal.id,
                });
              }
            }
          });
        }
      } else if (!HOLDING_MESSAGE_BLOCKED_REASONS.has(decision.reason)) {
        const latestOutbound = await this.repo.findLatestCustomerOutboundMessage(channel.companyId, freshConversation.id);
        if (
          latestOutbound?.authorType !== 'SYSTEM' ||
          latestOutbound.deliveryStatus !== 'SENT' ||
          latestOutbound.contentJson?.['operationalType'] !== 'HOLDING'
        ) {
          await this.sendAutonomousAutoReply(
            channel,
            identity,
            freshConversation,
            HOLDING_MESSAGE_TEXT,
            decision.requestId,
            decision.turnClass ?? 'STAFF_PATH',
            receivedAt,
            replyToken,
            decision.reason,
          );
        }
      }
    } catch (error) {
      this.logger.warn({
        msg: 'CRM auto-reply skipped after best-effort failure',
        companyId: channel.companyId,
        conversationId: conversation.id,
        error: (error as Error).message,
      });
      if (decision?.action === 'send') {
        await this.auditAutoReply(channel.companyId, conversation.id, decision.requestId, 'FAILED', {
          turnClass: decision.turnClass,
          sent: false,
          reason: 'exception',
        });
      }
      throw error;
    }
  }

  private async formatConflictSlotProposal(
    companyId: string,
    bookingInput: Extract<CrmAutoReplyDecision, { action: 'book' }>['bookingInput'],
    now: Date,
  ): Promise<string> {
    const date = bangkokDateString(bookingInput.startAt);
    const day = bookingDayRange(date);
    if (!day) return formatSlotProposal([], now);
    const existingBookings = await this.crmRepo.listBookingsForStaffOnDate({
      companyId,
      branchId: bookingInput.branchId,
      staffUserId: bookingInput.staffUserId,
      rangeStart: day.rangeStart,
      rangeEnd: day.rangeEnd,
    });
    const durationMinutes = Math.round((bookingInput.endAt.getTime() - bookingInput.startAt.getTime()) / 60_000);
    const bufferMinutes = await this.crmRepo.getBookingBufferMinutes(companyId);
    return formatSlotProposal(computeFreeStartSlots({ date, durationMinutes, existingBookings, now, bufferMinutes }), now, true);
  }

  private async sendAutonomousAutoReply(
    channel: CompanyMessagingChannelRecord,
    identity: CrmChannelIdentityRecord,
    conversation: CrmConversationRecord,
    text: string,
    requestId: string,
    turnClass: string,
    now: Date,
    replyToken?: LineReplyTokenState,
    holdingReason?: string,
    // K1: an optional probe run at the provider boundary (inside the live customer lock,
    // immediately before the push). A throw is contained as a failed send, never propagated.
    preSend?: () => Promise<void>,
    // A deterministic template (greeting / staff-handoff ack): SYSTEM-authored and
    // not an AI draft, but — unlike a holding message — it consumes the AI cap and
    // counts as a real customer response (first-response, status, autoReplyCount).
    deterministic = false,
    contentJson?: Record<string, unknown>,
  ): Promise<boolean> {
    text = normalizeLinePlainText(text);
    const isHoldingMessage = holdingReason !== undefined;
    const isUnsubscribeConfirmation = holdingReason === 'unsubscribe_confirmation';
    const isSystemAuthored = isHoldingMessage || deterministic;
    const dayKey = bangkokDayBounds(now).dayStart.toISOString();
    // CUST-03 residual: re-check the kill switch at the send boundary for AI
    // messages — an operator disable during the evaluate/commit hops must abort
    // before we reserve cap or push. Holding messages are operational and exempt.
    if (!isHoldingMessage) {
      // Flag-first: skip the DB reads entirely when the global switch is off. Then
      // re-read BOTH the channel and the conversation toggle — a per-conversation
      // disable during the evaluate/commit hops must abort here too, not just a
      // channel-level one.
      const freshChannel = this.config.crmAutoReplyEnabled ? await this.repo.findChannelById(channel.companyId, channel.id) : null;
      const freshConversation = freshChannel ? await this.repo.findConversationById(channel.companyId, conversation.id) : null;
      if (
        !this.config.crmAutoReplyEnabled || !freshChannel || freshChannel.status !== 'ACTIVE' || !freshChannel.autoReplyEnabled ||
        !freshConversation || !freshConversation.autoReplyEnabled
      ) {
        await this.auditAutoReply(channel.companyId, conversation.id, requestId, 'DENIED', {
          turnClass, sent: false, reason: 'autonomy_disabled_at_send',
        }, 'crm.inbox.auto_reply');
        return false;
      }
    }
    // CUST-05: atomic channel-cap reservation at the send boundary. The
    // evaluate()-time channel count is advisory and can be raced by concurrent
    // turns during model latency; the reservation is the authoritative gate.
    // Holding messages are operational and excluded from the AI cap.
    if (!isHoldingMessage) {
      const reserved = await this.channelCap.tryReserve(channel.companyId, channel.id, dayKey, channel.autoReplyDailyCap);
      if (!reserved) {
        await this.auditAutoReply(channel.companyId, conversation.id, requestId, 'DENIED', {
          turnClass, sent: false, reason: 'channel_cap',
        }, 'crm.inbox.auto_reply');
        return false;
      }
    }
    const pending = await this.repo.appendOutboundMessage(
      {
        companyId: channel.companyId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        visibility: 'CUSTOMER',
        authorType: isSystemAuthored ? 'SYSTEM' : 'AI',
        messageType: 'TEXT',
        contentText: text,
        contentJson: contentJson ?? (isHoldingMessage
          ? { operationalType: 'HOLDING', reason: holdingReason }
          : deterministic
            ? { operationalType: turnClass === 'GREETING' ? 'GREETING' : 'DETERMINISTIC' }
            : undefined),
        aiDraftUsed: !isSystemAuthored,
        deliveryStatus: 'PENDING',
      },
      conversation.id,
      isHoldingMessage ? {} : { unreadCount: 0 },
    );

    const sendResult = await this.repo.withLiveCustomerLock(
      {
        companyId: channel.companyId,
        customerId: conversation.customerId,
        conversationId: conversation.id,
        channelIdentityId: identity.id,
      },
      async (liveIdentity, liveConsentStatus) => {
        if (liveConsentStatus === 'REVOKED' && !isUnsubscribeConfirmation) {
          return { ok: false, error: 'consent_revoked', retryAfterSeconds: undefined } as const;
        }
        // K1: run the ask-lock liveness probe (preSend) HERE — inside the live customer lock,
        // immediately before the provider call — so the lock cannot expire during the reserve/
        // append/lock stretch between a caller-side probe and the push. A probe failure is
        // plumbed as a failed send (never a throw): the !ok path below releases the reserved cap,
        // marks the message FAILED, audits, and returns false — keeping both ask callers fail-closed
        // (book: row stays PROPOSED, no CAS; re-ask: prior stamp restored).
        if (preSend) {
          try {
            await preSend();
          } catch {
            return { ok: false, error: 'ask_lock_lost', retryAfterSeconds: undefined } as const;
          }
        }
        const accessToken = this.secrets.decrypt(channel).accessToken;
        const replyTokenAgeMs = replyToken ? Date.now() - replyToken.receivedAt : Number.POSITIVE_INFINITY;
        let result: LinePushResult | undefined;
        if (replyToken && !replyToken.consumed && replyTokenAgeMs >= 0 && replyTokenAgeMs < LINE_REPLY_TOKEN_FRESH_MS) {
          replyToken.consumed = true;
          try {
            const reply = await this.line.replyTextMessage(accessToken, replyToken.value, text);
            if (reply.ok) result = reply;
          } catch {
            // Adapter calls are non-throwing; a test double or unexpected failure still falls back to push.
          }
        }
        return result ?? this.line.pushTextMessage(
          accessToken,
          liveIdentity.providerUserId,
          text,
          lineReplyRetryKeyForMessage(pending.id),
        );
      },
    );
    if (!sendResult) throw new Error('customer_personal_data_erased');
    const consentRevoked = !sendResult.ok && sendResult.error === 'consent_revoked';

    let message;
    if (sendResult.ok) {
      message = await this.repo.updateMessageDelivery(pending.id, { deliveryStatus: 'SENT', sentAt: now });
      if (!message) throw new Error('customer_personal_data_erased');
      await this.repo.updateConversation(channel.companyId, conversation.id, {
        lastMessageAt: now,
        lastOutboundAt: now,
        lastMessagePreview: previewText(text),
        ...(isHoldingMessage ? {} : {
          status: statusAfterStaffReply(conversation.status),
          ...(conversation.firstRespondedAt ? {} : { firstRespondedAt: now }),
          autoReplyCount: { increment: 1 },
          autoReplyCheckedAt: now,
        }),
      });
      await this.outbox.append('crm.conversation.message_sent', 'crm_conversation', conversation.id, {
        companyId: channel.companyId,
        actorUserId: SYSTEM_ACTOR,
        requestId,
        aggregateType: 'crm_conversation',
        aggregateId: conversation.id,
        occurredAt: now.toISOString(),
        data: { messageId: message.id, customerId: conversation.customerId, channelId: channel.id },
      });
    } else {
      // CUST-05: a failed send must not burn channel capacity — release the reservation.
      if (!isHoldingMessage) await this.channelCap.release(channel.companyId, channel.id, dayKey);
      const outcome = resolveReplySendOutcome({
        ok: false,
        error: sendResult.error,
        retryAfterSeconds: sendResult.retryAfterSeconds,
        attemptCountAfter: 1,
        maxAttempts: REPLY_SEND_MAX_ATTEMPTS,
        now,
      });
      message = await this.repo.updateMessageDelivery(pending.id, {
        deliveryStatus: outcome.status,
        deliveryError: sendResult.error,
        deliveryAttemptCount: 1,
        deliveryNextAttemptAt: outcome.nextAttemptAt ?? null,
      });
    }
    if (!message) throw new Error('customer_personal_data_erased');

    await this.auditAutoReply(channel.companyId, conversation.id, requestId, consentRevoked ? 'DENIED' : sendResult.ok ? 'SUCCESS' : 'FAILED', {
      turnClass,
      sent: sendResult.ok,
      reason: consentRevoked ? 'consent_revoked' : holdingReason ?? (sendResult.ok ? 'sent' : 'line_push_failed'),
      ...(isHoldingMessage ? { deliveryReason: consentRevoked ? 'consent_revoked' : sendResult.ok ? 'sent' : 'line_push_failed' } : {}),
      messageId: message.id,
      deliveryStatus: message.deliveryStatus,
      ...(sendResult.ok ? {} : { error: sendResult.error }),
    }, isHoldingMessage ? 'crm.inbox.holding_message' : 'crm.inbox.auto_reply');
    return sendResult.ok;
  }

  private async auditAutoReply(
    companyId: string,
    conversationId: string,
    requestId: string,
    result: 'SUCCESS' | 'DENIED' | 'FAILED',
    metadataJson: Record<string, unknown>,
    action = 'crm.inbox.auto_reply',
  ): Promise<void> {
    try {
      await this.audit.log({
        companyId,
        actorType: 'SYSTEM',
        actorRefId: 'crm-auto-reply',
        action,
        targetType: 'crm_conversation',
        targetId: conversationId,
        requestId,
        result,
        riskLevel: 'MEDIUM',
        metadataJson,
      });
    } catch (error) {
      this.logger.warn({ msg: 'CRM auto-reply audit failed', conversationId, requestId, error: (error as Error).message });
    }
  }

  /** Finds or creates the channel identity and its backing CRM customer. */
  private async ensureIdentity(
    channel: CompanyMessagingChannelRecord,
    providerUserId: string,
  ): Promise<CrmChannelIdentityRecord> {
    const existing = await this.repo.findIdentity(channel.id, providerUserId);
    if (existing) {
      if (existing.status === 'UNFOLLOWED') {
        return (await this.repo.updateIdentityLifecycleUnlessErased({
          companyId: channel.companyId,
          identityId: existing.id,
          expectedCustomerId: existing.customerId,
          status: 'ACTIVE',
          followedAt: new Date(),
          unfollowedAt: null,
        })) ?? existing;
      }
      return existing;
    }

    // Create with a fallback name immediately — the LINE profile fetch runs in
    // the background so a batch of first-time senders cannot stall the webhook
    // past LINE's response deadline.
    let customer: Awaited<ReturnType<PrismaCrmRepository['createLineCustomerAndIdentity']>>['customer'];
    let identity: CrmChannelIdentityRecord;
    try {
      const created = await this.crmRepo.createLineCustomerAndIdentity({
        customer: {
          companyId: channel.companyId,
          displayName: 'ลูกค้า LINE',
          customerType: 'UNKNOWN',
          status: 'ACTIVE',
          source: 'LINE',
          consentStatus: 'UNKNOWN',
          createdByUserId: SYSTEM_ACTOR,
        },
        identity: {
          channelId: channel.id,
          provider: 'LINE_OA',
          providerUserId,
          followedAt: new Date(),
          status: 'ACTIVE',
        },
      });
      customer = created.customer;
      const storedIdentity = await this.repo.findIdentityById(channel.companyId, created.identityId);
      if (!storedIdentity) throw new Error('created_line_identity_not_found');
      identity = storedIdentity;
    } catch (error) {
      // Concurrent first contact: another delivery created the identity between
      // our find and atomic create. The losing transaction rolls its customer
      // back, then this delivery reuses the winner so the message still lands.
      if ((error as { code?: string }).code === 'P2002') {
        const winner = await this.repo.findIdentity(channel.id, providerUserId);
        if (winner) return winner;
      }
      throw error;
    }

    void this.enrichIdentityProfile(channel, identity.id, customer.id);

    await this.outbox.append('crm.customer.created', 'crm_customer', customer.id, {
      companyId: channel.companyId,
      actorUserId: SYSTEM_ACTOR,
      aggregateType: 'crm_customer',
      aggregateId: customer.id,
      occurredAt: new Date().toISOString(),
      data: { source: 'LINE', channelId: channel.id },
    });

    return identity;
  }

  /**
   * Background media fetch + store; never blocks or fails ingestion. Failure
   * marks the message (mediaError) so the bubble shows an honest placeholder.
   * ponytail: no retry — redelivery skips existing rows; add a retry queue
   * when an API-side producer path exists (same deviation as reply send).
   */
  private async storeInboundMedia(
    channel: CompanyMessagingChannelRecord,
    identity: CrmChannelIdentityRecord,
    conversation: CrmConversationRecord,
    messageId: string,
    lineMessage: NonNullable<LineInboundEvent['message']>,
  ): Promise<void> {
    try {
      const result = await this.repo.withLiveCustomerLock(
        {
          companyId: channel.companyId,
          customerId: conversation.customerId,
          conversationId: conversation.id,
          channelIdentityId: identity.id,
        },
        async () => this.line.getMessageContent(
          this.secrets.decrypt(channel).accessToken,
          lineMessage.id!,
          this.config.uploadMaxBytes,
        ),
      );
      if (!result) return;
      if (!result.ok) {
        const marked = await this.repo.updateMessageContentJson(messageId, { ...boundedContentJson(lineMessage), mediaError: result.error });
        if (marked) this.logger.warn({ msg: 'CRM inbound media fetch failed', messageId, error: result.error });
        return;
      }
      const mimeType = normalizeAttachmentMimeType(result.mimeType, result.data);
      const extension = canonicalAttachmentExtension(mimeType);
      const originalFileName = lineMessage.fileName ?? `${lineMessage.type}-${lineMessage.id}.${extension ?? 'bin'}`;
      let rejectionReason = validateAttachmentMeta(mimeType, result.data.byteLength, this.config.uploadMaxBytes)
        ? 'METADATA_REJECTED'
        : validateAttachmentFileName(originalFileName, mimeType)
          ? 'EXTENSION_MIME_MISMATCH'
          : lineMessage.type === 'image' && mimeType !== 'image/jpeg' && mimeType !== 'image/png'
            ? 'MESSAGE_TYPE_MISMATCH'
            : inspectAttachmentBytes(mimeType, result.data)
              ? 'CONTENT_REJECTED'
              : null;
      if (!rejectionReason) {
        try {
          await this.malwareScanner.assertClean(result.data);
        } catch (error) {
          rejectionReason = (error as Error).message === 'MALWARE_DETECTED' ? 'MALWARE_DETECTED' : 'MALWARE_SCAN_FAILED';
        }
      }
      if (rejectionReason) {
        const mediaError = rejectionReason === 'MALWARE_SCAN_FAILED' ? 'media_scan_failed' : 'media_security_rejected';
        await this.repo.updateMessageContentJson(messageId, { ...boundedContentJson(lineMessage), mediaError });
        await this.audit.log({
          companyId: channel.companyId,
          actorType: 'SYSTEM',
          actorRefId: 'crm-line-inbound',
          action: 'attachment.upload.rejected',
          targetType: 'crm_message',
          targetId: messageId,
          requestId: lineMessage.id ?? messageId,
          result: 'DENIED',
          riskLevel: 'HIGH',
          metadataJson: { source: 'CRM_LINE_INBOUND', reason: rejectionReason, mimeType, byteSize: result.data.byteLength },
        });
        emitSecurityEvent(this.logger, SECURITY_EVENT.attachmentUploadRejected, 'HIGH', {
          companyId: channel.companyId,
          source: 'CRM_LINE_INBOUND',
          reason: rejectionReason,
          messageId,
        });
        return;
      }
      await this.repo.storeInboundMediaAttachment({
        attachmentId: randomUUID(),
        companyId: channel.companyId,
        messageId,
        originalFileName,
        mimeType,
        data: result.data,
        checksumSha256: createHash('sha256').update(result.data).digest('hex'),
      });
    } catch (error) {
      this.logger.warn({ msg: 'CRM inbound media store failed', messageId, error: (error as Error).message });
    }
  }

  /** Background name/avatar enrichment; never blocks or fails ingestion. */
  private async enrichIdentityProfile(
    channel: CompanyMessagingChannelRecord,
    identityId: string,
    customerId: string,
  ): Promise<void> {
    try {
      const profile = await this.repo.withLiveCustomerLock(
        { companyId: channel.companyId, customerId, channelIdentityId: identityId },
        async (liveIdentity) => this.line.getProfile(
          this.secrets.decrypt(channel).accessToken,
          liveIdentity.providerUserId,
        ),
      );
      if (!profile?.displayName && !profile?.pictureUrl) return;
      await this.repo.updateIdentityProfileUnlessErased({
        companyId: channel.companyId,
        identityId,
        expectedCustomerId: customerId,
        displayName: profile.displayName ?? null,
        pictureUrl: profile.pictureUrl ?? null,
        placeholderName: 'ลูกค้า LINE',
        updatedByUserId: SYSTEM_ACTOR,
      });
    } catch (error) {
      this.logger.warn({ msg: 'Profile enrichment failed', identityId, error: (error as Error).message });
    }
  }

  /** Latest conversation for the identity; reopen recent resolved ones, else create. */
  private async resolveConversation(
    channel: CompanyMessagingChannelRecord,
    identity: CrmChannelIdentityRecord,
  ): Promise<CrmConversationRecord> {
    const latest = await this.repo.findLatestConversationForIdentity(channel.companyId, identity.id);
    const now = new Date();

    if (latest && latest.status !== 'RESOLVED') return latest;

    // CrmInboxPolicy first-response clock (spec §22 defaults when no row).
    const policy = effectiveInboxPolicy(await this.repo.getInboxPolicy(channel.companyId));
    const firstResponseDueAt = computeFirstResponseDueAt(now, policy.firstResponseMinutes, policy.businessHours);

    if (latest && latest.status === 'RESOLVED' && latest.resolvedAt && shouldReopenConversation(latest.resolvedAt, now)) {
      return (await this.repo.reopenConversation(channel.companyId, latest.id, firstResponseDueAt)) ?? latest;
    }

    const result = await this.repo.createConversation({
      companyId: channel.companyId,
      channelId: channel.id,
      channelIdentityId: identity.id,
      status: 'NEW',
      firstResponseDueAt,
    });
    const created = result.conversation;

    if (result.created) {
      await this.outbox.append('crm.conversation.created', 'crm_conversation', created.id, {
        companyId: channel.companyId,
        actorUserId: SYSTEM_ACTOR,
        aggregateType: 'crm_conversation',
        aggregateId: created.id,
        occurredAt: now.toISOString(),
        data: { customerId: created.customerId, channelId: channel.id },
      });
    }

    return created;
  }
}
