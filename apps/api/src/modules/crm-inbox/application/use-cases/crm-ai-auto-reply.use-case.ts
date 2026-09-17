import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { CrmAiContextRepository } from '../../infrastructure/crm-ai-context.repository';
import { CrmAiGatewayClient } from '../../infrastructure/crm-ai-gateway.client';
import { knownAiBudgetRefusal } from '../../../line-ai/domain/logic/line-ai-terminal-outcome.logic';
import { toCrmAiWindow } from './crm-ai-assist.use-case';
import {
  matchStandaloneGreeting,
  formatGreetingReply,
  PER_CONVERSATION_AUTO_REPLY_DAILY_CAP,
  bangkokDateString,
  formatBookingConfirm,
  formatSlotProposal,
  normalizeLinePlainText,
  evaluateCrmAutonomousOutboundPolicy,
  resolveConversationAutoReplyCount,
  resolvePublishedService,
  resolveRequestedBookingWindow,
  type CrmAutoReplyAgentPort,
  type CrmAutoReplyDecision,
  withinCap,
} from '../../domain/logic/crm-auto-reply.logic';
import { bangkokDayBounds } from '../../domain/logic/crm-daily-brief.logic';
import { bookingDayRange, computeFreeStartSlots, isSlotFree } from '../../../crm/domain/logic/crm-booking.logic';

const CONSENT_REVOKED_AT_LIVE_FENCE = Symbol('consent_revoked_at_live_fence');
const AI_PROVIDER_UNAVAILABLE = Symbol('ai_provider_unavailable');

@Injectable()
export class CrmAiAutoReplyUseCase implements CrmAutoReplyAgentPort {
  private readonly logger = new Logger(CrmAiAutoReplyUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly crmRepo: PrismaCrmRepository,
    private readonly config: AppConfigService,
    private readonly gateway: CrmAiGatewayClient,
    private readonly aiContext: CrmAiContextRepository,
    private readonly audit: AuditService,
  ) {}

  async evaluate(input: Parameters<CrmAutoReplyAgentPort['evaluate']>[0]): Promise<CrmAutoReplyDecision> {
    const requestId = randomUUID();
    let turnClass: string | undefined;
    try {
      if (!this.config.crmAutoReplyEnabled) return this.skip(input, requestId, 'DENIED', { sent: false, reason: 'global_disabled' });
      if (input.channel.status !== 'ACTIVE' || !input.channel.autoReplyEnabled) {
        return this.skip(input, requestId, 'DENIED', { sent: false, reason: 'channel_disabled' });
      }
      if (!input.conversation.autoReplyEnabled) {
        return this.skip(input, requestId, 'DENIED', { sent: false, reason: 'conversation_disabled' });
      }
      if (input.eventType !== 'message' || typeof input.contentText !== 'string' || input.contentText.trim().length === 0) {
        return this.skip(input, requestId, 'DENIED', { sent: false, reason: 'not_text' });
      }

      const consent = await this.aiContext.findCustomerConsent(input.channel.companyId, input.conversation.customerId);
      if (consent === null) return this.skip(input, requestId, 'FAILED', { sent: false, reason: 'context_unavailable' });
      if (consent === 'REVOKED') return this.skip(input, requestId, 'DENIED', { sent: false, reason: 'consent_revoked' });

      const countState = resolveConversationAutoReplyCount(input.conversation, input.receivedAt);
      if (countState.isNewWindow) {
        await this.repo.updateConversation(input.channel.companyId, input.conversation.id, {
          autoReplyCount: 0,
          autoReplyCheckedAt: input.receivedAt,
        });
      }
      if (!withinCap(countState.countToday, PER_CONVERSATION_AUTO_REPLY_DAILY_CAP)) {
        return this.skip(input, requestId, 'DENIED', { sent: false, reason: 'conversation_cap' });
      }

      const { dayStart } = bangkokDayBounds(input.receivedAt);
      const channelCount = await this.repo.countChannelAiOutboundMessagesSince(input.channel.companyId, input.channel.id, dayStart);
      if (!withinCap(channelCount, input.channel.autoReplyDailyCap)) {
        return this.skip(input, requestId, 'DENIED', { sent: false, reason: 'channel_cap' });
      }

      // Deterministic greeting fast-path: a standalone greeting gets a fixed reply
      // with no gateway call and no confidence gate (owner requirement). Placed
      // after all consent/cap gates but before intake so greetings never depend on
      // the model. A greeting carrying real content ("สวัสดี อยากถามราคา") does not
      // match and falls through to the AI below.
      const greetingLang = matchStandaloneGreeting(input.contentText ?? '');
      if (greetingLang) {
        return this.outbound(input, requestId, 'GREETING', formatGreetingReply(greetingLang), 'DETERMINISTIC');
      }

      const window = toCrmAiWindow(await this.aiContext.listRecentWindowMessages(input.channel.companyId, input.conversation.id));
      if (window.length === 0) {
        return this.skip(input, requestId, 'FAILED', { sent: false, reason: 'context_unavailable' });
      }

      const intake = await this.repo.withLiveCustomerDataLock(
        {
          companyId: input.channel.companyId,
          customerId: input.conversation.customerId,
          conversationId: input.conversation.id,
        },
        async (liveConsent) => {
          if (liveConsent === 'REVOKED') return CONSENT_REVOKED_AT_LIVE_FENCE;
          try {
            return await this.gateway.requestCrmIntake({ requestId, companyId: input.channel.companyId, window, consent: liveConsent });
          } catch {
            return AI_PROVIDER_UNAVAILABLE;
          }
        },
      );
      if (intake === CONSENT_REVOKED_AT_LIVE_FENCE) {
        return this.skip(input, requestId, 'DENIED', { sent: false, reason: 'consent_revoked' });
      }
      if (intake === AI_PROVIDER_UNAVAILABLE) {
        const catalog = await this.aiContext.listCustomerVisibleCatalog(input.channel.companyId);
        return this.outbound(input, requestId, 'QUESTION', this.publicFallback(catalog));
      }
      if (!intake) return this.skip(input, requestId, 'FAILED', { sent: false, reason: 'context_unavailable' });
      if (intake.status !== 'ok') {
        const catalog = await this.aiContext.listCustomerVisibleCatalog(input.channel.companyId);
        return this.outbound(input, requestId, 'QUESTION', this.publicFallback(catalog));
      }
      turnClass = intake.turnClass;
      // Gate A is a SPECIAL-ROUTING gate, not a reply/no-reply gate: only a
      // high-confidence classification may enter a higher-impact branch (booking
      // extraction, staff handoff, spam suppression). A low-confidence turn — of
      // any class — falls through to the ordinary AI reply so real questions are
      // never dropped, and a shaky BOOKING_REQUEST never enters booking extraction.
      if (intake.confidence >= this.config.crmAiMinConfidence) {
        // High-confidence spam is intentionally silent (no answer, no holding).
        if (turnClass === 'SPAM') {
          return this.skip(input, requestId, 'DENIED', { turnClass, sent: false, reason: 'spam_ignored', confidence: intake.confidence, gate: 'intake' });
        }
        if (turnClass === 'BOOKING_REQUEST') return this.evaluateBooking(input, requestId, turnClass, window);
        // A dispute / explicit human need routes to a person. The deterministic
        // holding message ("เจ้าหน้าที่จะรีบติดต่อกลับ") IS the staff-handoff ack —
        // reuse it (deduped, cap-exempt) rather than free-composing an AI reply
        // to a complaint. 'staff_handoff' is not in HOLDING_MESSAGE_BLOCKED_REASONS.
        if (turnClass === 'COMPLAINT' || turnClass === 'NEEDS_HUMAN') {
          return this.skip(input, requestId, 'DENIED', { turnClass, sent: false, reason: 'staff_handoff', confidence: intake.confidence, gate: 'intake' });
        }
      }

      const [company, templates, catalog] = await Promise.all([
        this.aiContext.findCompany(input.channel.companyId),
        this.aiContext.listAiApprovedTemplateExamples(input.channel.companyId),
        this.aiContext.listCustomerVisibleCatalog(input.channel.companyId),
      ]);
      if (!company) return this.skip(input, requestId, 'FAILED', { turnClass, sent: false, reason: 'company_not_found' });

      const reply = await this.repo.withLiveCustomerDataLock(
        {
          companyId: input.channel.companyId,
          customerId: input.conversation.customerId,
          conversationId: input.conversation.id,
        },
        async (liveConsent) => {
          if (liveConsent === 'REVOKED') return CONSENT_REVOKED_AT_LIVE_FENCE;
          try {
            return await this.gateway.requestCrmReplyDraft({
              requestId,
              companyId: input.channel.companyId,
              mode: 'AUTONOMOUS',
              window,
              brand: { brandName: company.brandName ?? company.name, channelDisplayName: input.channel.displayName },
              templates: templates.map((t) => ({ title: t.title, body: t.bodyText })),
              catalog,
            });
          } catch {
            return AI_PROVIDER_UNAVAILABLE;
          }
        },
      );
      if (reply === CONSENT_REVOKED_AT_LIVE_FENCE) {
        return this.skip(input, requestId, 'DENIED', { turnClass, sent: false, reason: 'consent_revoked' });
      }
      if (reply === AI_PROVIDER_UNAVAILABLE) {
        return this.outbound(input, requestId, turnClass ?? 'QUESTION', this.publicFallback(catalog));
      }
      if (!reply) return this.skip(input, requestId, 'FAILED', { turnClass, sent: false, reason: 'context_unavailable' });
      // Backward-compatible rolling deploy: the old gateway returned `refused`
      // for needsHuman=true. Treat it as the same review signal, never as a
      // provider failure eligible for a catalog fallback.
      if (reply.status === 'refused') {
        return this.outbound(input, requestId, turnClass ?? 'QUESTION', '', 'AI', true);
      }
      if (reply.status !== 'ok') {
        return this.outbound(input, requestId, turnClass ?? 'QUESTION', this.publicFallback(catalog));
      }
      // No reply-confidence gate: the gateway already downgrades a self-deferring
      // (needsHuman) or malformed draft to 'refused'/'uncertain' (handled above),
      // and confidence is only logged as telemetry. An empty draft still can't send.
      if (reply.needsHumanSignal) {
        return this.outbound(input, requestId, turnClass ?? 'QUESTION', reply.draftText, 'AI', true);
      }
      if (!reply.draftText.trim()) {
        return this.outbound(input, requestId, turnClass ?? 'QUESTION', this.publicFallback(catalog));
      }

      return this.outbound(input, requestId, turnClass ?? 'QUESTION', reply.draftText);
    } catch (error) {
      // §9.4: the company's AI money gate is one of the things that lands here. It is not retried by
      // this lane either way (one best-effort attempt per inbound message, no queue), but recording
      // it as a bare `exception` hid the one reason an operator can actually act on. The typed code
      // and scope are kept; nothing else about the outcome changes.
      const budget = knownAiBudgetRefusal(error);
      this.logger.warn({
        msg: 'CRM auto-reply skipped after best-effort failure',
        companyId: input.channel.companyId,
        conversationId: input.conversation.id,
        requestId,
        ...(budget ? { budgetErrorCode: budget.code } : {}),
        error: (error as Error).message,
      });
      return this.skip(input, requestId, 'FAILED', {
        turnClass, sent: false,
        reason: budget?.code ?? 'exception',
        ...(budget?.budgetScope ? { budgetScope: budget.budgetScope } : {}),
      });
    }
  }

  async classifyBookingConfirmation(input: {
    companyId: string;
    conversationId: string;
    customerId: string;
  }): Promise<'CONFIRM' | 'UNCLEAR'> {
    const consent = await this.aiContext.findCustomerConsent(input.companyId, input.customerId);
    if (!consent || consent === 'REVOKED') return 'UNCLEAR';
    const window = toCrmAiWindow(await this.aiContext.listRecentWindowMessages(input.companyId, input.conversationId));
    if (window.length === 0) return 'UNCLEAR';
    const result = await this.repo.withLiveCustomerDataLock(
      {
        companyId: input.companyId,
        customerId: input.customerId,
        conversationId: input.conversationId,
      },
      async (liveConsent) => liveConsent === 'REVOKED'
        ? CONSENT_REVOKED_AT_LIVE_FENCE
        : this.gateway.requestCrmIntake({
            requestId: randomUUID(),
            companyId: input.companyId,
            window,
            consent: liveConsent,
          }),
    );
    return result !== CONSENT_REVOKED_AT_LIVE_FENCE &&
      result?.status === 'ok' &&
      result.turnClass === 'CONFIRMATION' &&
      result.confidence >= this.config.crmAiMinConfidence
      ? 'CONFIRM'
      : 'UNCLEAR';
  }

  private async evaluateBooking(
    input: Parameters<CrmAutoReplyAgentPort['evaluate']>[0],
    requestId: string,
    turnClass: string,
    window: Parameters<CrmAiGatewayClient['requestCrmBookingExtract']>[0]['window'],
  ): Promise<CrmAutoReplyDecision> {
    const assignedStaffUserId = input.conversation.assignedToUserId;
    const assignedBranchId = assignedStaffUserId
      ? await this.crmRepo.findStaffDefaultBranch(input.channel.companyId, assignedStaffUserId)
      : null;
    let staffUserId = assignedStaffUserId && assignedBranchId ? assignedStaffUserId : null;
    let branchId = assignedBranchId;
    if (!staffUserId || !branchId) {
      const defaultStaffUserId = input.channel.defaultBookingStaffUserId;
      const defaultBranchId = input.channel.defaultBookingBranchId;
      const validDefaultPair = defaultStaffUserId && defaultBranchId
        ? await this.repo.hasActiveBookingStaffBranch(input.channel.companyId, defaultStaffUserId, defaultBranchId)
        : false;
      if (!validDefaultPair || !defaultStaffUserId || !defaultBranchId) {
        return this.skip(input, requestId, 'DENIED', { turnClass, sent: false, reason: 'no_booking_staff_branch' });
      }
      staffUserId = defaultStaffUserId;
      branchId = defaultBranchId;
    }

    const catalog = await this.aiContext.listCustomerVisibleCatalog(input.channel.companyId, 'SERVICE');
    if (catalog.length === 0) {
      return this.outbound(input, requestId, turnClass, 'ขอให้พนักงานช่วยตรวจสอบบริการและติดต่อกลับให้นะคะ', 'DETERMINISTIC');
    }
    const extract = await this.repo.withLiveCustomerDataLock(
        {
          companyId: input.channel.companyId,
          customerId: input.conversation.customerId,
          conversationId: input.conversation.id,
        },
      async (liveConsent) => liveConsent === 'REVOKED'
        ? CONSENT_REVOKED_AT_LIVE_FENCE
        : this.gateway.requestCrmBookingExtract({
            requestId,
            companyId: input.channel.companyId,
            window,
            consent: liveConsent,
            todayBangkok: bangkokDateString(input.receivedAt),
            catalog,
          }),
    );
    if (extract === CONSENT_REVOKED_AT_LIVE_FENCE) {
      return this.skip(input, requestId, 'DENIED', { turnClass, sent: false, reason: 'consent_revoked' });
    }
    if (!extract) return this.skip(input, requestId, 'FAILED', { turnClass, sent: false, reason: 'context_unavailable' });
    if (extract.status !== 'ok' || extract.confidence < this.config.crmAiMinConfidence) {
      return this.outbound(input, requestId, turnClass, 'รบกวนแจ้งวันและเวลาที่ต้องการจองอีกครั้งนะคะ', 'DETERMINISTIC');
    }

    const service = resolvePublishedService(catalog, extract.catalogItemId);
    if (!service) {
      const choices = catalog.slice(0, 5).map((item) => item.name).join(', ');
      return this.outbound(input, requestId, turnClass, `รบกวนเลือกบริการที่ต้องการก่อนนะคะ: ${choices}`, 'DETERMINISTIC');
    }
    const durationMinutes = service.bookingDurationMinutes ?? 60;
    const resolved = resolveRequestedBookingWindow(extract, input.receivedAt, durationMinutes);
    if (resolved.kind === 'invalid') {
      return this.outbound(input, requestId, turnClass, 'กรุณาเลือกวันและเวลาในอนาคต ช่วง 09:00-20:00 น. อีกครั้งนะคะ', 'DETERMINISTIC');
    }

    const day = bookingDayRange(extract.date);
    if (!day) return this.outbound(input, requestId, turnClass, 'รบกวนแจ้งวันและเวลาที่ต้องการจองอีกครั้งนะคะ', 'DETERMINISTIC');

    const existingBookings = await this.crmRepo.listBookingsForStaffOnDate({
      companyId: input.channel.companyId,
      branchId,
      staffUserId,
      rangeStart: day.rangeStart,
      rangeEnd: day.rangeEnd,
    });
    const bufferMinutes = await this.crmRepo.getBookingBufferMinutes(input.channel.companyId);

    if (resolved.kind === 'needs_time') {
      return this.outbound(
        input,
        requestId,
        turnClass,
        formatSlotProposal(computeFreeStartSlots({ date: extract.date, durationMinutes, existingBookings, now: input.receivedAt, bufferMinutes }), input.receivedAt),
        'DETERMINISTIC',
      );
    }

    if (!isSlotFree(resolved.startAt, resolved.endAt, existingBookings, bufferMinutes)) {
      return this.outbound(
        input,
        requestId,
        turnClass,
        formatSlotProposal(
          computeFreeStartSlots({ date: extract.date, durationMinutes, existingBookings, now: input.receivedAt, bufferMinutes }),
          input.receivedAt,
          true,
        ),
        'DETERMINISTIC',
      );
    }

    const serviceName = service.name;
    const servicePolicy = evaluateCrmAutonomousOutboundPolicy({
      draftText: serviceName,
      allowedDomains: this.config.crmAiOutboundAllowedDomains,
    });
    if (servicePolicy.action === 'review') {
      return this.skip(input, requestId, 'DENIED', {
        turnClass,
        sent: false,
        reason: `outbound_policy_${servicePolicy.reason}`,
        gate: 'outbound',
      });
    }
    return {
      action: 'book',
      requestId,
      turnClass,
      bookingInput: {
        branchId,
        staffUserId,
        serviceName,
        customerId: input.conversation.customerId,
        startAt: resolved.startAt,
        endAt: resolved.endAt,
        sourceConversationId: input.conversation.id,
      },
      confirmText: formatBookingConfirm(serviceName, resolved.startAt, resolved.endAt),
    };
  }

  private publicFallback(catalog: Awaited<ReturnType<CrmAiContextRepository['listCustomerVisibleCatalog']>>): string {
    const names = catalog.slice(0, 5).map((item) => item.name);
    if (names.length > 0) {
      const partial = catalog.length > names.length ? ` ${names.length} รายการแรกจาก ${catalog.length} รายการ` : '';
      return `ตอนนี้มีสินค้าและบริการ${partial}: ${names.join(', ')} ค่ะ สนใจรายการไหนแจ้งชื่อได้เลยนะคะ`;
    }
    return 'ขออภัยค่ะ ตอนนี้ยังไม่มีข้อมูลสาธารณะที่ตอบคำถามนี้ได้ รบกวนระบุรายละเอียดที่ต้องการอีกครั้งนะคะ';
  }

  private async outbound(
    input: Parameters<CrmAutoReplyAgentPort['evaluate']>[0],
    requestId: string,
    turnClass: string,
    draftText: string,
    replySource: 'AI' | 'DETERMINISTIC' = 'AI',
    modelNeedsHuman = false,
  ): Promise<CrmAutoReplyDecision> {
    const policy = evaluateCrmAutonomousOutboundPolicy({
      draftText,
      allowedDomains: this.config.crmAiOutboundAllowedDomains,
      modelNeedsHuman,
    });
    if (policy.action === 'review') {
      return this.skip(input, requestId, 'DENIED', {
        turnClass,
        sent: false,
        reason: `outbound_policy_${policy.reason}`,
        gate: 'outbound',
      });
    }
    return { action: 'send', requestId, turnClass, draftText: normalizeLinePlainText(draftText), replySource };
  }

  private async skip(
    input: Parameters<CrmAutoReplyAgentPort['evaluate']>[0],
    requestId: string,
    result: 'SUCCESS' | 'DENIED' | 'FAILED',
    metadataJson: { sent: false; reason: string; turnClass?: string; confidence?: number; gate?: string },
  ): Promise<CrmAutoReplyDecision> {
    // Autonomy decision observability: surface WHY a customer auto-reply was
    // skipped to stdout (audit rows live in the DB and are not operator-visible
    // in logs). result/reason mirror the audited metadata.
    console.log(JSON.stringify({
      msg: 'crm.autonomy.decision',
      result,
      reason: metadataJson.reason,
      turnClass: metadataJson.turnClass ?? null,
      confidence: metadataJson.confidence ?? null,
      gate: metadataJson.gate ?? null,
      minConfidence: this.config.crmAiMinConfidence,
      companyId: input.channel.companyId,
      conversationId: input.conversation.id,
      channelStatus: input.channel.status,
      requestId,
    }));
    await this.auditAutoReply(input.channel.companyId, input.conversation.id, requestId, result, metadataJson);
    return { action: 'skip', requestId, reason: metadataJson.reason, turnClass: metadataJson.turnClass };
  }

  private async auditAutoReply(
    companyId: string,
    conversationId: string,
    requestId: string,
    result: 'SUCCESS' | 'DENIED' | 'FAILED',
    metadataJson: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.log({
        companyId,
        actorType: 'SYSTEM',
        actorRefId: 'crm-auto-reply',
        action: 'crm.inbox.auto_reply',
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
}
