import type { LineReplyLanguage } from '../../domain/logic/line-language.logic';
import { LinkLinePaymentEvidenceUseCase } from '../../../expenses/application/use-cases/link-line-payment-evidence.use-case';
import { linePaymentEvidenceReply } from '../../domain/logic/line-payment-evidence-reply.logic';
import { isLineAiRolloutAllowed } from '@watchdog-bms/config';
import { LineConversationContextService, type LineConversationOwner } from '../line-conversation-context.service';
import { LineLedgerDeliveryService } from '../line-ledger-delivery.service';
import { buildLineDeliveryPlan, deliveryHash, lineDeliveryPlanId, parseLineDeliveryPlan, type DeliveryPlanV2 } from '../../domain/logic/line-delivery-plan.logic';
import { LineExpenseActionService, type ExpenseActionPreview } from '../line-expense-action.service';
import { lineDeliveryRecipientHash, resolvedLineDeliveryAccessFingerprint } from '../line-delivery-access';
import type { OutboxEventRecord } from '../../../data-model-core/domain/models/outbox.model';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EXPENSE_CAPTURE_READ_FINISHED_EVENT_TYPE, SOURCE_DOCUMENT_TYPE_LABELS, type RequestContext } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { PrismaOutboxRepository } from '../../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { AutoHandoffSingleDocumentCaptureUseCase } from '../../../expenses/application/use-cases/expense-capture-handoff.use-case';
import { ExpenseCaptureLineUseCase } from '../../../expenses/application/use-cases/expense-capture-line.use-case';
import { PrismaExpenseCaptureRepository } from '../../../expenses/infrastructure/prisma-expense-capture.repository';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { absoluteWebLink } from '../../../../common/http/web-link';
import { hashMessagePreview } from '../../domain/logic/line-ai-classifier.logic';
import { buildStaffCompletionQuickReply } from '../../domain/logic/line-staff-menu.logic';
import { asCompleteLineCard, buildExpenseDraftReviewCard, buildLineAssistantTextCardMessage, inheritCompleteLineBusinessAnswerPresentation, type LineExpenseDraftCardFacts } from '../../domain/logic/line-business-card.logic';
import {
  CAPTURE_READ_FAILED_REPLY,
  CAPTURE_READ_PARTIAL_REPLY,
  CAPTURE_READ_PAUSED_REPLY,
  classifyNonReceiptCase,
  formatCaptureAutoHandoffReply,
  formatCaptureReadFinishedReply,
  formatCaptureSplitReply,
  NON_RECEIPT_PERSISTING_CASES,
  nonReceiptReply,
  type LineNonReceiptCase,
} from '../../domain/logic/line-non-receipt-reply.logic';
import { LineReplyAdapter, type LineDeliveryResult, type LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { LineHandoffLinkService } from '../line-handoff-link.service';
import { claimFreeExpenseQuotaNotice, releaseFreeExpenseQuotaNotice, freeExpenseQuotaResetAt } from '../free-expense-quota';
import { freeExpenseQuotaNoticeTextTh, FREE_EXPENSE_MULTI_DOCUMENT_TEXT_TH, FREE_EXPENSE_IN_FLIGHT_TEXT_TH } from '../../../system-partner-management/domain/logic/receipt-quota.logic';

/** The outbox event a finished capture read emits (contracts owns the string; see appendix §3). */
export const LINE_CAPTURE_READ_FINISHED_EVENT_TYPE = EXPENSE_CAPTURE_READ_FINISHED_EVENT_TYPE;

const WORKER_ID = 'line-capture-result-notifier';
const MAX_BATCH = 25;

type NotificationOutcome = { kind: 'accepted' } | { kind: 'terminalSkip'; reason: 'NOT_LINE_SOURCE' | 'NO_NOTIFYABLE_RESULT' | 'NO_RECIPIENT_ACCESS' | 'GROUP_PRIVATE_DELIVERY_BLOCKED' | 'SOURCE_GONE' } | { kind: 'retryable' | 'unknown' | 'permanent'; code: string };
const skipped = (reason: Extract<NotificationOutcome, { kind: 'terminalSkip' }>['reason'] = 'NO_NOTIFYABLE_RESULT'): NotificationOutcome => ({ kind: 'terminalSkip', reason });
type CapturePreparation = { language?: LineReplyLanguage; event: OutboxEventRecord; owner: LineConversationOwner; epoch: number; accessFingerprint: string; lineUserId: string; context: RequestContext };
const deliveryOutcome = (result: LineDeliveryResult): NotificationOutcome => result === 'ok' ? { kind: 'accepted' } : result === 'failed_permanent' || result === 'failed_flex' ? { kind: 'permanent', code: 'LINE_PROVIDER_REJECTED' } : { kind: result === 'failed_other' ? 'unknown' : 'retryable', code: 'LINE_DELIVERY_NOT_ACCEPTED' };

export type LineCaptureResultDrainResult = {
  claimed: number;
  pushed: number;
  skipped: number;
  parked: number;
};

/**
 * Appendix §3 (LINE column) / §17.6 / §18.4: the ONE place a finished capture read becomes a LINE
 * message.
 *
 * It reads, it composes and it pushes. It never runs OCR, never creates a draft and never touches
 * money — a notification that could mutate is how a retry becomes a second expense. Access is
 * re-resolved at push time, exactly like the ledger drain: a user who has since been unlinked, lost
 * the company, or lost capture permission gets nothing, and the attempt records that the result was
 * never delivered so §17.5 can answer UXE-25 when they ask.
 */
@Injectable()
export class LineCaptureResultNotifierUseCase {
  private readonly logger = new Logger(LineCaptureResultNotifierUseCase.name);
  @Inject(LineLedgerDeliveryService) private readonly plans!: LineLedgerDeliveryService;
  @Inject(LineConversationContextService) private readonly contexts!: LineConversationContextService;
  private readonly prepared = new WeakMap<object, CapturePreparation>();
  @Inject(LinkLinePaymentEvidenceUseCase) private readonly paymentEvidence!: LinkLinePaymentEvidenceUseCase;
  @Inject(LineExpenseActionService) private readonly expenseActions!: LineExpenseActionService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly captureLine: ExpenseCaptureLineUseCase,
    private readonly captureRepo: PrismaExpenseCaptureRepository,
    private readonly lineReply: LineReplyAdapter,
    private readonly outbox: PrismaOutboxRepository,
    private readonly autoHandoff: AutoHandoffSingleDocumentCaptureUseCase,
    @Optional() private readonly handoffLinks?: LineHandoffLinkService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async execute(batchSize = MAX_BATCH): Promise<LineCaptureResultDrainResult> {
    const result: LineCaptureResultDrainResult = { claimed: 0, pushed: 0, skipped: 0, parked: 0 };
    const bounded = Math.max(1, Math.min(MAX_BATCH, Math.trunc(batchSize) || MAX_BATCH));
    const events = await this.outbox.claimBatch({
      batchSize: bounded, claimedBy: WORKER_ID, eventTypes: [LINE_CAPTURE_READ_FINISHED_EVENT_TYPE],
    });
    result.claimed = events.length;
    for (const event of events) {
      try {
        const outcome = await this.notify(event.companyId, event.payloadJson, event);
        if (outcome.kind !== 'accepted') await this.releaseUnplannedFreeNotice(event);
        const fence = { id: event.id, claimToken: event.claimToken ?? null, expectedEventType: LINE_CAPTURE_READ_FINISHED_EVENT_TYPE };
        if (outcome.kind === 'accepted' || outcome.kind === 'terminalSkip') {
          const settled = await this.outbox.markPublished(fence);
          if (!settled) { result.parked += 1; continue; }
          result[outcome.kind === 'accepted' ? 'pushed' : 'skipped'] += 1;
          if (outcome.kind === 'terminalSkip') this.logger.log({ msg: 'line.capture_result.terminal_skip', outboxEventId: event.id, reason: outcome.reason, delivered: false });
        } else {
          result.parked += 1;
          if (outcome.kind === 'permanent') await this.outbox.markDead({ ...fence, error: outcome.code });
          else if (outcome.code === 'WAITING_CONTINUATION') {
            const saved = await this.prisma.client.lineDeliveryPlan.findUnique({ where: { outboxEventId: event.id }, select: { expiresAt: true } });
            await this.outbox.markFailed({ ...fence, error: outcome.code, countsTowardMax: false, nextAvailableAt: saved?.expiresAt });
          } else await this.outbox.markFailed({ ...fence, error: outcome.code });
        }
      } catch (error) {
        await this.releaseUnplannedFreeNotice(event);
        result.parked += 1;
        this.logger.warn({
          msg: 'line.capture_result.push_failed', outboxEventId: event.id,
          errorCode: (error as Error)?.message?.slice(0, 120),
        });
        await this.outbox.markFailed({
          id: event.id, claimToken: event.claimToken ?? null,
          error: (error as Error)?.message?.slice(0, 200) ?? 'unknown',
        });
      }
    }
    return result;
  }

  private async notify(
    companyId: string | undefined,
    payload: Record<string, unknown>,
    event?: OutboxEventRecord,
  ): Promise<NotificationOutcome> {
    if (event?.headersJson?.lineDeliveryPlanVersion === 2) return this.replayCapturePlan(event);
    if (!companyId) return skipped('SOURCE_GONE');
    const owner = await this.captureLine.readLineDeliveryOwner(companyId, readString(payload, 'ownerType') === 'EXPENSE' ? { expenseId: readString(payload, 'expenseId') } : { groupId: readString(payload, 'groupId') });
    if (!owner) return skipped('SOURCE_GONE');
    if (!owner.sourceIsLine) return skipped('NOT_LINE_SOURCE');
    const privateAccess = await this.resolveRecipient(companyId, owner);
    if (!privateAccess) return skipped(owner.linePushTargetId?.startsWith('C') || owner.linePushTargetId?.startsWith('R') ? 'GROUP_PRIVATE_DELIVERY_BLOCKED' : 'NO_RECIPIENT_ACCESS');
    if (event && owner.ownerBinding && this.config.lineAiReliabilityV2Mode === 'on' && this.config.lineAiDeliveryPlanV2Enabled
      && isLineAiRolloutAllowed(this.config.lineAiReliabilityV2CompanyIds, companyId) && isLineAiRolloutAllowed(this.config.lineAiDeliveryPlanV2WriteCompanyIds, companyId)) {
      const binding = owner.ownerBinding;
      const fullOwner: LineConversationOwner = { companyId, userId: owner.createdByUserId, membershipId: binding.membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: binding.channelId, chatKeyHash: owner.lineChatKeyHash ?? '' };
      const context = await this.contexts.load(fullOwner);
      if (!context || context.row.id !== binding.conversationId || context.row.lifecycleEpoch !== binding.ownerEpoch || privateAccess.membershipId !== binding.membershipId) return skipped('NO_RECIPIENT_ACCESS');
      this.prepared.set(payload, { event, owner: fullOwner, epoch: binding.ownerEpoch, accessFingerprint: privateAccess.fingerprint, lineUserId: privateAccess.lineUserId,
        context: { requestId: event.id, authSubject: fullOwner.userId, authProvider: 'line', userId: fullOwner.userId, companyId, membershipId: binding.membershipId, roles: privateAccess.roles, permissions: privateAccess.permissions, scopes: privateAccess.scopes } });
    }

    // Appendix §25: both lanes queue `ownerType EXPENSE` jobs now, so this is the live path. The
    // group path below still serves rows that were queued before 2026-09-19.
    if (readString(payload, 'ownerType') === 'EXPENSE') return this.notifyExpense(companyId, payload);
    const groupId = readString(payload, 'groupId');
    if (!groupId) return skipped();
    const snapshot = await this.captureLine.readFinishedSnapshot(companyId, groupId);
    // LINE-only: a WEB group's result belongs to the page the customer is already looking at.
    if (!snapshot || snapshot.group.intakeChannel !== 'LINE') return skipped();

    const access = await this.resolveRecipient(companyId, snapshot.group);
    if (!access) {
      // Park as undelivered rather than push: the person this result belongs to no longer has the
      // access it was produced under (appendix §3 "access re-checked").
      await this.recordDelivery(companyId, snapshot.group.createdByUserId, groupId, snapshot, false, null);
      return skipped();
    }

    // Appendix §25: the group page is withdrawn, so a legacy group's result points at the expense
    // list. New rows never reach here — both lanes queue `ownerType EXPENSE` jobs.
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses`);
    const composed = this.composeReply(snapshot, payload, link);
    if (!composed) return skipped();
    let { text } = composed;
    // §18.4 NR07: a confirmed non-business image is not evidence of anything, so the work it opened
    // is closed. The bytes are NOT deleted — retention (§8) owns that, not a reply.
    if (composed.nr === 'NR07') {
      await this.captureLine.closeMergedGroup(
        systemContext(companyId, groupId, snapshot.group.createdByUserId), groupId, 'NON_BUSINESS_IMAGE',
      ).catch(() => false);
    }

    // §3.2: one file, one expense-eligible document, nothing to divide — the group becomes the same
    // NEEDS_REVIEW draft a LINE photo produces today, and the chat gets THAT summary. A classified
    // non-receipt (NR01–NR08) keeps its own sentence and never becomes an expense; everything the
    // use case refuses — multi-document, mismatch, unknown amounts — keeps the group link.
    const handed = !access.freeExpenseDrafts && readString(payload, 'quotaSource') !== 'FREE_MONTHLY_3' && composed.done && !composed.nr && (readNumber(payload, 'documentCount') ?? 1) <= 1
      ? await this.autoHandoffReply(companyId, groupId, snapshot.group.createdByUserId)
      : null;
    if (handed) text = handed.text;
    text += await this.freeNotice(companyId, payload, access.freeExpenseDrafts);

    const source = handed?.message ?? (readString(payload, 'status') === 'FAILED'
      ? buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, companyId)
      : this.lineReply.buildTextMessage(text));
    const message = inheritCompleteLineBusinessAnswerPresentation(source, {
      ...source,
      quickReply: buildStaffCompletionQuickReply({
        permissions: access.permissions,
        entitledFeatureKeys: access.entitledFeatureKeys,
        isOwner: access.roles.includes('OWNER'),
      }),
    });
    const outgoing = this.handoffLinks
      ? await this.handoffLinks.wrapOutgoingLineContent(
        { userId: snapshot.group.createdByUserId, companyId, lineUserId: access.lineUserId, surface: 'line_capture_result' },
        [message],
      )
      : [message];
    const delivery = await this.pushResult(access.pushTargetId, outgoing, `capture:${readString(payload, 'requestId') ?? groupId}`);
    await this.recordDelivery(
      companyId, snapshot.group.createdByUserId, groupId, snapshot, delivery === 'ok', handed?.expenseId ?? null,
    );
    return deliveryOutcome(delivery);
  }

  /**
   * The LINE document lane (appendix §25): the file is already an expense draft, so the push is
   * about a RECORD — today's receipt summary when one document was read, the split list when the
   * file held several, and the §17.6 sentences with the expense link when the read did not finish.
   *
   * It creates nothing and mutates nothing except an NR07 draft, which it deletes because a
   * confirmed non-business image may not leave a record behind (§18.4).
   */
  private async notifyExpense(
    companyId: string,
    payload: Record<string, unknown>,
  ): Promise<NotificationOutcome> {
    const expenseId = readString(payload, 'expenseId');
    if (!expenseId) return skipped();
    const snapshot = await this.captureLine.readFinishedExpenseSnapshot(companyId, expenseId);
    // LINE-only: a WEB upload's result belongs to the page the customer is already looking at.
    if (!snapshot || snapshot.expense.captureSource !== 'LINE_UPLOAD') return skipped();
    const language = snapshot.expense.language ?? 'th';
    const prepared = this.prepared.get(payload); if (prepared) prepared.language = language;

    const access = await this.resolveRecipient(companyId, {
      createdByUserId: snapshot.expense.createdByUserId,
      lineChatKeyHash: snapshot.expense.lineChatKeyHash,
      linePushTargetId: snapshot.expense.linePushTargetId, branchId: snapshot.expense.branchId,
    });
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
    if (!access) {
      await this.recordExpenseDelivery(companyId, expenseId, snapshot.jobs, false);
      return skipped();
    }

    let composed = this.composeExpenseReply(companyId, snapshot, payload, link);
    if (!composed) return skipped();
    // §18.4 NR07: a confirmed non-business image is evidence of nothing, and the draft this lane
    // created at intake carries no money yet — so it is removed rather than left as a phantom row.
    if (composed.nr === 'NR07') {
      const removed = await this.deleteEmptyDraft(companyId, expenseId, readString(payload, 'jobId') ?? null, this.prepared.has(payload))
        .catch(() => false);
      // Not removed = no longer empty: someone already filled the draft in, so it is their record
      // now and "จึงไม่ได้สร้างรายการ" would be false. Say what is true, and link it.
      if (!removed) composed = { text: CAPTURE_READ_PARTIAL_REPLY(link, language), nr: null };
      else if (this.prepared.has(payload)) composed = { text: 'ภาพนี้ไม่ใช่เอกสารธุรกิจ จึงยกเลิกร่างว่างที่เปิดไว้แล้วค่ะ', nr: 'NR07' };
    }

    let evidenceRecordIds: string[] = [];
    if (!access.freeExpenseDrafts && readString(payload, 'quotaSource') !== 'FREE_MONTHLY_3' && this.paymentEvidence && (readString(payload, 'status') ?? snapshot.jobs[0]?.status) === 'DONE'
      && readBoolean(payload, 'applied') !== false && snapshot.expense.lineChatKeyHash) {
      const pairing = await this.paymentEvidence.forCapture({ requestId: readString(payload, 'jobId') ?? `capture:${expenseId}`,
        authSubject: snapshot.expense.createdByUserId, userId: snapshot.expense.createdByUserId, companyId,
        membershipId: access.membershipId, roles: access.roles, permissions: access.permissions, scopes: access.scopes, authProvider: 'line' },
        snapshot.expense.lineChatKeyHash, expenseId);
      const message = linePaymentEvidenceReply(pairing, 0, language);
      if (message) {
        composed = { text: message.type === 'text' ? message.text : message.type === 'flex' ? message.canonicalText! : '', nr: null, message: message.type === 'flex' ? asCompleteLineCard(message) : message };
        evidenceRecordIds = pairing.kind === 'LINKED' ? [pairing.slipId, pairing.receiptId]
          : pairing.kind === 'ASK' ? [pairing.slipId, ...pairing.candidates.slice(0, 4).map(item => item.id)] : [];
      }
    }

    const notice = await this.freeNotice(companyId, payload, access.freeExpenseDrafts);
    if (notice) composed = { text: composed.text + notice, nr: composed.nr, message: this.lineReply.buildTextMessage(composed.text + notice) };
    const preparation = this.prepared.get(payload);
    if (preparation) {
      let confirmation: ExpenseActionPreview | undefined;
      if (!access.freeExpenseDrafts && readString(payload, 'quotaSource') !== 'FREE_MONTHLY_3' && !evidenceRecordIds.length && composed.message?.type === 'flex' && composed.draft) {
        try {
          const offered = await this.expenseActions?.preview(preparation.context, preparation.owner.chatKeyHash, { action: 'CONFIRM', expenseId }, true, undefined, language);
          if (offered?.preview) {
            const receipt = this.receiptReply(companyId, expenseId, snapshot.expense, offered.preview);
            if (receipt.message) { composed = { ...receipt, nr: null }; confirmation = offered.preview; }
          }
        } catch (error) {
          this.logger.warn({ msg: 'line.capture_result.confirm_preview_error', expenseId, errorCode: (error as Error)?.name });
          composed = { text: `${composed.text}\n${language === 'en' ? 'Review expense on web' : 'เปิดตรวจรายการในเว็บค่ะ'}: ${link}`, nr: null,
            message: this.lineReply.buildTextMessage(`${composed.text}\n${language === 'en' ? 'Review expense on web' : 'เปิดตรวจรายการในเว็บค่ะ'}: ${link}`) };
        }
      }
      const result = await this.saveCapturePlan(preparation, payload, composed.text, composed.nr === 'NR07' ? 'EMPTY_DRAFT_DELETED' : 'NONE', composed.message, evidenceRecordIds, confirmation);
      await this.recordExpenseDelivery(companyId, expenseId, snapshot.jobs, result.kind === 'accepted');
      return result;
    }
    const source = composed.message ?? this.lineReply.buildTextMessage(composed.text);
    const message = inheritCompleteLineBusinessAnswerPresentation(source, {
      ...source,
      quickReply: evidenceRecordIds.length ? source.quickReply : buildStaffCompletionQuickReply({
        permissions: access.permissions,
        entitledFeatureKeys: access.entitledFeatureKeys,
        isOwner: access.roles.includes('OWNER'),
      }, language),
    });
    const outgoing = this.handoffLinks
      ? await this.handoffLinks.wrapOutgoingLineContent(
        { userId: snapshot.expense.createdByUserId, companyId, lineUserId: access.lineUserId, surface: 'line_capture_result' },
        [message],
      )
      : [message];
    const delivery = await this.pushResult(access.pushTargetId, outgoing, `capture:${readString(payload, 'requestId') ?? expenseId}`);
    await this.recordExpenseDelivery(companyId, expenseId, snapshot.jobs, delivery === 'ok');
    return deliveryOutcome(delivery);
  }

  /** Reuse the wrapped canonical text, recipient and menu. Only a proved body rejection permits a
   *  different payload; the operation suffix separates its retry identity from the rejected card. */
  private async pushResult(to: string, messages: LineReplyMessage[], operationId: string): Promise<LineDeliveryResult> {
    const result = await this.lineReply.sendPush(to, messages, operationId).catch(() => 'failed_other' as const);
    if (result !== 'failed_flex' || !messages.some(message => message.type === 'flex' && message.canonicalText)) return result;
    const fallback: LineReplyMessage[] = messages.map(message => message.type === 'flex' && message.canonicalText
      ? { ...this.lineReply.buildTextMessage(message.canonicalText), ...(message.quickReply ? { quickReply: message.quickReply } : {}) }
      : message);
    return this.lineReply.sendPush(to, fallback, `${operationId}:text-fallback`).catch(() => 'failed_other' as const);
  }

  private async saveCapturePlan(preparation: CapturePreparation, payload: Record<string, unknown>, text: string, businessEffect: 'NONE' | 'EMPTY_DRAFT_DELETED', message?: LineReplyMessage, evidenceRecordIds: string[] = [], confirmation?: ExpenseActionPreview): Promise<NotificationOutcome> {
    const expenseId = readString(payload, 'expenseId'), jobId = readString(payload, 'jobId');
    if (!expenseId || !jobId || !preparation.event.claimToken) return { kind: 'permanent', code: 'CAPTURE_SOURCE_MISSING' };
    const recordIds = [...new Set([expenseId, ...readStringArray(payload, 'splitExpenseIds'), ...evidenceRecordIds])];
    const proof = await this.captureLine.readFinishedDeliveryProof(preparation.context, expenseId, jobId, recordIds);
    if (!proof) return { kind: 'permanent', code: 'CAPTURE_SOURCE_CHANGED' };
    const createdAt = preparation.event.createdAt, now = new Date(), expiresAt = new Date(Math.min(createdAt.getTime() + 60 * 60_000, confirmation ? Date.parse(confirmation.expiresAt) : Infinity)).toISOString();
    const record = proof.records.find(row => row.id === expenseId)!;
    const plan = buildLineDeliveryPlan({ language: preparation.language, producerKind: 'CAPTURE_OUTBOX', producerId: preparation.event.id, createdAt: createdAt.toISOString(), readyAt: now.toISOString(), expiresAt,
      firstDispatchDeadlineAt: expiresAt, control: confirmation ? { kind: 'EXPENSE_ACTION_CONFIRM', token: confirmation.token,
        expiresAt: confirmation.expiresAt, requiredItemIds: [`${lineDeliveryPlanId('CAPTURE_OUTBOX', preparation.event.id)}:item:0`] } : null,
      authorization: { v: 2, kind: 'PRIVATE', issuedAt: now.toISOString(), expiresAt, actor: { userId: preparation.owner.userId, companyId: preparation.owner.companyId,
        membershipId: preparation.owner.membershipId, requestId: preparation.event.id, accessFingerprint: preparation.accessFingerprint, channelId: preparation.owner.messagingChannelId,
        channel: 'line', channelKind: 'USER', recipientHash: lineDeliveryRecipientHash(preparation.lineUserId, preparation.lineUserId, preparation.owner.messagingChannelId), chatKeyHash: preparation.owner.chatKeyHash,
        conversationId: (await this.contexts.load(preparation.owner))!.row.id, ownerEpoch: preparation.epoch }, proofs: [{ id: 'capture', kind: 'CAPTURE_RESULT', expenseId, groupId: null, jobId,
          resultRevision: deliveryHash(proof), recordIds, businessEffect },
          ...(confirmation ? [{ id: 'confirmation', kind: 'EXPENSE_ACTION_PREVIEW', token: confirmation.token,
            requestId: preparation.context.requestId, previewHash: deliveryHash(confirmation), applied: false }] : [])] },
      businessResult: businessEffect === 'EMPTY_DRAFT_DELETED' ? null : { kind: 'EXPENSE_CAPTURE', operationKey: `capture:${expenseId}`, committedAt: record.createdAt.toISOString(), recordIds, resultingRevisions: proof.records.map(row => row.updatedAt.toISOString()) },
      answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'answer', text, required: true, sourceProofIds: ['capture'] }] },
      preferredMessages: [confirmation ? null : message ?? null], ...(confirmation ? { controlMessage: message } : {}) });
    const saved = await this.plans.savePlan({ kind: 'CAPTURE_OUTBOX', id: preparation.event.id, token: preparation.event.claimToken }, plan, new Date(createdAt.getTime() + this.config.aiDataRetentionDays * 86400000));
    if (!saved) return { kind: 'retryable', code: 'CAPTURE_LEASE_CHANGED' };
    return this.replayCapturePlan({ ...preparation.event, headersJson: { lineDeliveryPlanVersion: 2, lineDeliveryPlanId: saved.id } });
  }

  async verifyCaptureDeliveryPlan(plan: DeliveryPlanV2, recipient?: { lineUserId: string; pushTargetId?: string; messagingChannelId?: string }) {
    if (plan.producerKind !== 'CAPTURE_OUTBOX' || plan.authorization.kind !== 'PRIVATE' || Date.parse(plan.authorization.expiresAt) <= Date.now()) return null;
    const a = plan.authorization.actor, source = plan.authorization.proofs.find(proof => proof.kind === 'CAPTURE_RESULT');
    if (recipient && (recipient.messagingChannelId !== a.channelId || lineDeliveryRecipientHash(recipient.lineUserId, recipient.pushTargetId ?? recipient.lineUserId, recipient.messagingChannelId ?? '') !== a.recipientHash)) return null;
    if (!source || typeof source.expenseId !== 'string' || typeof source.jobId !== 'string' || !Array.isArray(source.recordIds)) return null;
    const metadata = await this.captureLine.readLineDeliveryOwner(a.companyId, { expenseId: source.expenseId });
    if (!metadata || metadata.createdByUserId !== a.userId || metadata.ownerBinding?.conversationId !== a.conversationId
      || metadata.ownerBinding?.ownerEpoch !== a.ownerEpoch || metadata.ownerBinding?.channelId !== a.channelId || metadata.ownerBinding?.membershipId !== a.membershipId) return null;
    const access = await this.resolveRecipient(a.companyId, metadata);
    if (!access || access.membershipId !== a.membershipId || access.fingerprint !== a.accessFingerprint || lineDeliveryRecipientHash(access.lineUserId, access.pushTargetId, a.channelId) !== a.recipientHash) return null;
    const owner: LineConversationOwner = { companyId: a.companyId, userId: a.userId, membershipId: a.membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: a.channelId, chatKeyHash: a.chatKeyHash };
    const current = await this.contexts.load(owner);
    if (!current || current.row.id !== a.conversationId || current.row.lifecycleEpoch !== a.ownerEpoch) return null;
    const ctx: RequestContext = { requestId: plan.producerId, authSubject: a.userId, authProvider: 'line', userId: a.userId, companyId: a.companyId, membershipId: a.membershipId, roles: access.roles, permissions: access.permissions, scopes: access.scopes };
    const proof = await this.captureLine.readFinishedDeliveryProof(ctx, source.expenseId, source.jobId, source.recordIds as string[]);
    if (!proof || deliveryHash(proof) !== source.resultRevision) return null;
    const confirmation = plan.authorization.proofs.find(proof => proof.kind === 'EXPENSE_ACTION_PREVIEW');
    if (confirmation) {
      if (typeof confirmation.requestId !== 'string' || typeof confirmation.token !== 'string' || typeof confirmation.previewHash !== 'string') return null;
      const pending = await this.expenseActions.pending(ctx, a.chatKeyHash, confirmation.requestId);
      if (!pending || pending.token !== confirmation.token || deliveryHash(pending) !== confirmation.previewHash) return null;
    }
    return access;
  }

  private async replayCapturePlan(event: OutboxEventRecord): Promise<NotificationOutcome> {
    if (!event.companyId || !event.claimToken || typeof event.headersJson?.lineDeliveryPlanId !== 'string') return { kind: 'permanent', code: 'LINE_OUTCOME_RECOVERY_REQUIRED' };
    const row = await this.prisma.client.lineDeliveryPlan.findUnique({ where: { outboxEventId: event.id } });
    const plan = parseLineDeliveryPlan(row?.planJson);
    if (!row || !plan || row.id !== event.headersJson.lineDeliveryPlanId || row.planHash !== deliveryHash(plan) || plan.authorization.kind !== 'PRIVATE') return { kind: 'permanent', code: 'LINE_OUTCOME_RECOVERY_REQUIRED' };
    if (row.status === 'ACCEPTED') return { kind: 'accepted' };
    if (['CANCELLED', 'REFUSED', 'EXPIRED'].includes(row.status)) return { kind: 'permanent', code: `LINE_PLAN_${row.status}` };
    if (row.status === 'WAITING_CONTINUATION') return { kind: 'retryable', code: 'WAITING_CONTINUATION' };
    for (let batch = 0; batch < 2; batch++) {
      const access = await this.verifyCaptureDeliveryPlan(plan);
      if (!access) {
        await this.prisma.client.lineDeliveryPlan.updateMany({ where: { id: row.id, status: { in: ['READY', 'UNKNOWN', 'WAITING_CONTINUATION'] } }, data: { status: 'REFUSED', cancelReason: 'AUTH_OR_SOURCE_CHANGED' } });
        return { kind: 'permanent', code: 'CAPTURE_ACCESS_OR_SOURCE_CHANGED' };
      }
      const claim = await this.plans.claimPlan(row.id, { kind: 'CAPTURE_OUTBOX', id: event.id, token: event.claimToken });
      if (!claim) return { kind: 'retryable', code: 'CAPTURE_LEASE_CHANGED' };
      const dispatch = await this.plans.beginPlanBatch(claim, 'PUSH'); if (!dispatch) return { kind: 'retryable', code: 'CAPTURE_NOT_DISPATCHABLE' };
      const frozen = plan.batches[dispatch.index]![claim.states[dispatch.index]!.variant]!;
      const result = await this.lineReply.sendFrozenV2({ channelId: plan.authorization.actor.channelId, transport: 'PUSH', target: access.pushTargetId, messages: frozen.messages, pushRetryKey: frozen.pushRetryKey, timeoutMs: dispatch.timeoutMs });
      if (!await this.plans.finishPlanBatch(claim, dispatch.index, result)) return { kind: 'unknown', code: 'CAPTURE_CHECKPOINT_LOST' };
      if (result.kind !== 'accepted') return { kind: result.kind === 'unknown' ? 'unknown' : result.rejection === 'PERMANENT' ? 'permanent' : 'retryable', code: result.code };
      if (claim.states.every(state => state.status === 'ACCEPTED')) return { kind: 'accepted' };
      if (dispatch.index === 1 && plan.batches.length === 3) return { kind: 'retryable', code: 'WAITING_CONTINUATION' };
    }
    return { kind: 'retryable', code: 'CAPTURE_MORE_BATCHES' };
  }

  private readonly freeNoticeClaims = new WeakMap<object, string>();

  private async freeNotice(companyId: string, payload: Record<string, unknown>, freeExpenseDrafts: boolean): Promise<string> {
    const allowance = payload.freeAllowance ?? (payload.data as Record<string, unknown> | undefined)?.freeAllowance;
    const raw = allowance && typeof allowance === 'object' ? allowance as Record<string, unknown> : null;
    const monthKey = readString(payload, 'quotaSource') === 'FREE_MONTHLY_3' && freeExpenseDrafts
      && raw?.source === 'FREE_MONTHLY_3' && raw.usedCount === 3 && typeof raw.monthKey === 'string'
      && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.monthKey) ? raw.monthKey : null;
    if (!monthKey || !await claimFreeExpenseQuotaNotice(this.prisma, companyId, monthKey)) return '';
    this.freeNoticeClaims.set(payload, monthKey);
    return `\n\n${freeExpenseQuotaNoticeTextTh(freeExpenseQuotaResetAt(monthKey))}`;
  }

  private async releaseUnplannedFreeNotice(event: OutboxEventRecord): Promise<void> {
    const monthKey = this.freeNoticeClaims.get(event.payloadJson);
    if (!monthKey || !event.companyId) return;
    // A frozen plan owns its original text across retries; keep its claim until that text delivers.
    if (this.prepared.has(event.payloadJson)
      && await this.prisma.client.lineDeliveryPlan.findUnique({ where: { outboxEventId: event.id }, select: { id: true } })) return;
    await releaseFreeExpenseQuotaNotice(this.prisma, event.companyId, monthKey);
    this.freeNoticeClaims.delete(event.payloadJson);
  }

  /** §3 / §17.6 / §18.4 / §25, for the expense lane. */
  private composeExpenseReply(
    companyId: string,
    snapshot: NonNullable<Awaited<ReturnType<ExpenseCaptureLineUseCase['readFinishedExpenseSnapshot']>>>,
    payload: Record<string, unknown>,
    link: string,
  ): { text: string; nr: LineNonReceiptCase | null; message?: LineReplyMessage; draft?: LineExpenseDraftCardFacts } | null {
    const language = snapshot.expense.language ?? 'th';
    const status = readString(payload, 'status') ?? snapshot.jobs[0]?.status ?? null;
    if (!status) return null;
    const refusal = freeCaptureRefusal(payload);
    if (refusal) return { text: refusal, nr: null };
    if (status === 'FAILED') {
      const text = CAPTURE_READ_FAILED_REPLY(link, language);
      return { text, nr: null, message: buildLineAssistantTextCardMessage(text, this.config.webBaseUrl, companyId, undefined, undefined, language) };
    }
    if (status === 'PARTIAL') return { text: CAPTURE_READ_PARTIAL_REPLY(link, language), nr: null };
    if (status === 'PAUSED') {
      const paused = snapshot.jobs.find((job) => job.status === 'PAUSED')?.pausedReason
        ?? readString(payload, 'pausedReason') ?? null;
      return { text: CAPTURE_READ_PAUSED_REPLY(link, paused, language), nr: null };
    }
    if (status !== 'DONE') return null;

    // §18.4: a classification the reader is SURE about gets its own sentence — the read succeeded,
    // so NR09's failure copy would be a lie. The draft exists, so the copy says so (`capturedDraft`).
    const classification = readClassification(payload);
    const nr = classification ? classifyNonReceiptCase(classification) : null;
    if (nr && nr !== 'NR06') {
      return {
        nr,
        text: nonReceiptReply(nr, { language,
          classification,
          ...(readString(payload, 'documentTotal') ? { amountLabel: readString(payload, 'documentTotal')! } : {}),
          ...(NON_RECEIPT_PERSISTING_CASES.includes(nr) ? { captureLink: link, capturedDraft: true } : {}),
        }),
      };
    }

    // §25: several documents in one file are already several drafts. Name the count and link them
    // all — the first is the record this push is about, the rest are what the split created.
    const splitIds = readStringArray(payload, 'splitExpenseIds');
    if (splitIds.length === 0 && readBoolean(payload, 'applied') === false) {
      // DONE, but NOT written onto the draft (a stale fence, or facts the eligibility gate refused):
      // the record is exactly as it was, so today's receipt card would print a zero total the
      // document never showed. §17.6's partial sentence is the truthful one — file kept, fill in.
      return { text: CAPTURE_READ_PARTIAL_REPLY(link, language), nr: null };
    }
    if (splitIds.length > 0) {
      return {
        nr: null,
        text: formatCaptureSplitReply({ language,
          documentCount: readNumber(payload, 'documentCount') ?? splitIds.length + 1,
          links: [link, ...splitIds.map((id) => absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${id}`))],
        }),
      };
    }
    // One document: the receipt card a LINE photo prints today, read off the draft itself.
    return { nr: null, ...this.receiptReply(companyId, snapshot.expense.id, snapshot.expense) };
  }

  private receiptReply(companyId: string, expenseId: string, expense: Partial<Pick<NonNullable<Awaited<ReturnType<ExpenseCaptureLineUseCase['readFinishedExpenseSnapshot']>>>['expense'],
    'status' | 'vendorNameSnapshot' | 'grandTotalAmount' | 'currency' | 'sourceDocumentType' | 'expenseDate' | 'vendorDocumentNumber' | 'categoryName' | 'vatAmount' | 'vatMode' | 'language'>>, confirmation?: ExpenseActionPreview): { text: string; message?: LineReplyMessage; draft?: LineExpenseDraftCardFacts } {
    const language = expense.language ?? 'th';
    const result = formatCaptureAutoHandoffReply({ language,
      expenseId, status: expense.status,
      link: absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`),
      vendorName: expense.vendorNameSnapshot, amount: expense.grandTotalAmount, currency: expense.currency,
      documentTypeLabel: expense.sourceDocumentType ? SOURCE_DOCUMENT_TYPE_LABELS[expense.sourceDocumentType as keyof typeof SOURCE_DOCUMENT_TYPE_LABELS] ?? null : null,
      expenseDate: expense.expenseDate, documentNumber: expense.vendorDocumentNumber,
      categoryName: expense.categoryName, vatAmount: expense.vatAmount, vatMode: expense.vatMode,
    });
    const message = result.draft && buildExpenseDraftReviewCard(result.text, result.draft, this.config.webBaseUrl, companyId, confirmation, undefined, language);
    return { text: message?.type === 'flex' ? message.canonicalText! : result.text, message, draft: result.draft };
  }

  /**
   * §18.4 NR07: remove the draft this lane created at intake, the way `DeleteExpenseUseCase` would —
   * its file links go, a file nothing else links is retired, the record goes, and an audit row says
   * a SYSTEM rule did it. Guarded on everything that would make it more than an empty draft: a
   * zero-total DRAFT/NEEDS_REVIEW row with no payment, no posting and no reimbursement behind it.
   * Anything else is left alone (`false`) and the customer keeps the record.
   */
  private async deleteEmptyDraft(companyId: string, expenseId: string, jobId: string | null, retainReceipt = false): Promise<boolean> {
    return this.prisma.client.$transaction(async (tx) => {
      if (retainReceipt && await tx.expenseRecord.findFirst({ where: { companyId, id: expenseId, status: 'VOIDED', voidReason: 'LINE_NR07_EMPTY_DRAFT' }, select: { id: true } })) return true;
      const job = jobId ? await tx.expenseCaptureReadJob.findFirst({
        where: { id: jobId, companyId, expenseId, ownerType: 'EXPENSE' }, select: { expectedSourceUpdatedAt: true },
      }) : null;
      // The upload itself sets updatedByUserId; the read job holds the exact intake revision instead.
      if (!job?.expectedSourceUpdatedAt) return false;
      const where = {
          companyId, id: expenseId, status: { in: ['DRAFT', 'NEEDS_REVIEW'] },
          grandTotalAmount: 0, paidAmount: 0, postingStatus: 'not_required' as const,
          sourceReimbursementRequestId: null,
          updatedAt: job.expectedSourceUpdatedAt, substituteReceiptEvidences: { none: {} },
        };
      const deleted = retainReceipt
        ? await tx.expenseRecord.updateMany({ where: { ...where, status: { in: ['DRAFT', 'NEEDS_REVIEW'] } }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: 'LINE_NR07_EMPTY_DRAFT', updatedByUserId: null } })
        : await tx.expenseRecord.deleteMany({ where: { ...where, status: { in: ['DRAFT', 'NEEDS_REVIEW'] } } });
      if (deleted.count !== 1) return false;
      const linkWhere = { companyId, targetType: 'expense.record', targetId: expenseId };
      const links = await tx.attachmentLink.findMany({ where: linkWhere, select: { attachmentId: true } });
      await tx.attachmentLink.deleteMany({ where: linkWhere });
      const retired: string[] = [];
      for (const attachmentId of [...new Set(links.map((link) => link.attachmentId))]) {
        // Shared bytes (an auto-split sibling, a reimbursement line) stay with whoever still holds them.
        const remaining = await tx.attachmentLink.count({ where: { companyId, attachmentId } });
        const claim = await tx.reimbursementLine.findFirst({ where: { companyId, attachmentId }, select: { id: true } });
        if (remaining > 0 || claim) continue;
        await tx.attachmentObject.updateMany({
          where: { id: attachmentId, companyId, status: { not: 'DELETED' } },
          data: { status: 'DELETED', deletedAt: new Date() },
        });
        retired.push(attachmentId);
      }
      await this.audit?.log({
        companyId, actorType: 'SYSTEM', actorRefId: 'line-capture-result-notifier',
        action: 'expense.delete', targetType: 'expense_record', targetId: expenseId,
        requestId: jobId ?? `capture:${expenseId}`, result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: { rule: 'nr07_non_business_document', jobId, attachmentIds: retired },
      }, tx).catch(() => undefined);
      return true;
    });
  }

  /** §17.5 needs the DELIVERY outcome separately from the read outcome (UXE-25). */
  private async recordExpenseDelivery(
    companyId: string,
    expenseId: string,
    jobs: ReadonlyArray<{ status: string }>,
    delivered: boolean,
  ): Promise<void> {
    const statuses = jobs.map((job) => job.status);
    const outcome = statuses.includes('FAILED') ? 'STORED_READ_FAILED' as const
      : statuses.includes('PARTIAL') || statuses.includes('PAUSED') ? 'STORED_READ_PARTIAL' as const
      : statuses.length > 0 && statuses.every((value) => value === 'DONE') ? 'STORED_READ_DONE' as const
      : 'STORED' as const;
    try {
      const rows = await this.prisma.client.lineIntakeAttempt.findMany({
        where: { companyId, targetType: 'expense', targetId: expenseId },
        orderBy: { createdAt: 'desc' }, take: 3, select: { id: true },
      });
      for (const row of rows) {
        await this.captureRepo.updateLineIntakeAttemptOutcome({
          id: row.id, outcome, stage: 'READ',
          reasonCode: delivered ? 'result_delivered' : 'LINE_DELIVERY_FAILED',
        });
      }
    } catch (error) {
      this.logger.warn({ msg: 'line.capture_result.attempt_not_updated', expenseId, errorCode: (error as Error)?.message?.slice(0, 120) });
    }
  }

  /**
   * The chat this result may be pushed into.
   *
   * `lineChatKeyHash` is a hash, so it can only ever CONFIRM a destination, never produce one. The
   * destination is `linePushTargetId`, the chat id the file arrived in — the same value the ledger
   * uses as `chatKey` — which makes a group-chat capture answerable in the group chat it came from.
   * A group with no stored target (everything captured before this column existed) falls back to
   * the sender's own 1:1 chat, and both are checked against the recorded hash before anything is
   * pushed: pushing a shop's expense summary into the wrong chat is not a mistake worth risking.
   */
  private async resolveRecipient(
    companyId: string,
    group: { createdByUserId: string; lineChatKeyHash: string | null; linePushTargetId: string | null; branchId?: string | null; ownerBinding?: { channelId: string } },
  ): Promise<{ pushTargetId: string; lineUserId: string; permissions: string[]; roles: string[]; entitledFeatureKeys: ReadonlySet<string> | null; membershipId: string; fingerprint: string; freeExpenseDrafts: boolean; scopes: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>['scopes'] } | null> {
    const userId = group.createdByUserId;
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId }, select: { status: true, aiAssistantOptOutAt: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.aiAssistantOptOutAt) return null;
    const channelId = group.ownerBinding?.channelId;
    if (channelId && channelId !== this.config.lineMessagingChannelId && !await this.prisma.client.lineChannelBinding.findFirst({ where: { companyId, messagingChannelId: channelId, status: 'ACTIVE', company: { status: 'ACTIVE' } }, select: { id: true } })) return null;
    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { userId, provider: 'LINE', status: 'ACTIVE', ...(channelId ? { providerChannelId: channelId } : {}) },
      select: { providerUserId: true },
    });
    if (!identity?.providerUserId) return null;
    const pushTargetId = group.linePushTargetId ?? identity.providerUserId;
    if (pushTargetId !== identity.providerUserId) return null;
    if (group.lineChatKeyHash && hashMessagePreview(pushTargetId) !== group.lineChatKeyHash) return null;
    let access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>;
    try {
      access = await this.permissionResolver.resolveAccess(userId, companyId);
    } catch {
      return null;
    }
    if (group.branchId !== undefined && !isBranchInScope(access.scopes ?? {}, group.branchId)) return null;
    const mayCapture = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create']
      .some((permission) => access.permissions.includes(permission));
    if (!mayCapture) return null;
    const entitled = await loadEntitledFeatureKeys(this.prisma, companyId);
    if (entitled && !entitled.has('expenses')) return null;
    return {
      pushTargetId, lineUserId: identity.providerUserId, permissions: access.permissions,
      roles: access.roles, freeExpenseDrafts: access.freeExpenseDrafts === true, entitledFeatureKeys: entitled, membershipId: access.membershipId, scopes: access.scopes, fingerprint: resolvedLineDeliveryAccessFingerprint(userId, companyId, access, entitled),
    };
  }

  /**
   * §3.2. Idempotent by construction: a second delivery of the same event finds the group already
   * `HANDED_OFF` and the use case answers `skipped: 'handoff_exists'`, so no replay can produce a
   * second expense. A throw is treated as "not handed off" — the transaction rolled back, and a
   * diagnostic must never cost the customer their result.
   */
  private async autoHandoffReply(
    companyId: string,
    groupId: string,
    createdByUserId: string,
  ): Promise<{ text: string; expenseId: string; message?: LineReplyMessage } | null> {
    const result = await this.autoHandoff
      .execute(systemContext(companyId, groupId, createdByUserId), groupId)
      .catch((error: unknown) => {
        this.logger.warn({
          msg: 'line.capture_result.auto_handoff_failed', groupId,
          errorCode: (error as Error)?.message?.slice(0, 120),
        });
        return { skipped: 'error' as const };
      });
    if (!('expenseId' in result)) return null;
    const expense = await this.prisma.client.expenseRecord.findFirst({
      where: { companyId, id: result.expenseId },
      select: { status: true, vendorNameSnapshot: true, grandTotalAmount: true, currency: true, sourceDocumentType: true, expenseDate: true,
        vendorDocumentNumber: true, expenseCategory: { select: { name: true } }, vatAmount: true, vatMode: true },
    }).catch(() => null);
    return {
      expenseId: result.expenseId,
      ...this.receiptReply(companyId, result.expenseId, { ...expense,
        grandTotalAmount: expense?.grandTotalAmount === undefined || expense?.grandTotalAmount === null ? null : String(expense.grandTotalAmount),
        vatAmount: expense?.vatAmount === undefined || expense?.vatAmount === null ? null : String(expense.vatAmount),
        categoryName: expense?.expenseCategory?.name ?? null }),
    };
  }

  /**
   * §3 / §17.6 / §18.4, in one function so §3.2's auto-handoff replaces one composition rather than
   * four. `observations` decides DONE's shape; everything else reads the job's own terminal state.
   */
  private composeReply(
    snapshot: NonNullable<Awaited<ReturnType<ExpenseCaptureLineUseCase['readFinishedSnapshot']>>>,
    payload: Record<string, unknown>,
    link: string,
  ): { text: string; nr: LineNonReceiptCase | null; done: boolean } | null {
    const statuses = snapshot.jobs.map((job) => job.status);
    const status = readString(payload, 'status')
      ?? (statuses.includes('FAILED') ? 'FAILED'
        : statuses.includes('PAUSED') ? 'PAUSED'
        : statuses.includes('PARTIAL') ? 'PARTIAL'
        : statuses.every((value) => value === 'DONE') && statuses.length > 0 ? 'DONE' : null);
    if (!status) return null;
    const refusal = freeCaptureRefusal(payload);
    if (refusal) return { text: refusal, nr: null, done: false };
    if (status === 'FAILED') return { text: CAPTURE_READ_FAILED_REPLY(link), nr: null, done: false };
    if (status === 'PARTIAL') return { text: CAPTURE_READ_PARTIAL_REPLY(link), nr: null, done: false };
    if (status === 'PAUSED') {
      const paused = snapshot.jobs.find((job) => job.status === 'PAUSED')?.pausedReason
        ?? readString(payload, 'pausedReason') ?? null;
      return { text: CAPTURE_READ_PAUSED_REPLY(link, paused), nr: null, done: false };
    }
    if (status !== 'DONE') return null;

    // §18.4: a classification the reader is SURE about gets its own sentence — the read succeeded,
    // so NR09's failure copy would be a lie. NR07 closes the group; nothing else does.
    const classification = readClassification(payload);
    const nr = classification ? classifyNonReceiptCase(classification) : null;
    if (nr && nr !== 'NR06') {
      return {
        nr, done: true,
        text: nonReceiptReply(nr, {
          classification,
          ...(readString(payload, 'documentTotal') ? { amountLabel: readString(payload, 'documentTotal')! } : {}),
          ...(NON_RECEIPT_PERSISTING_CASES.includes(nr) ? { captureLink: link } : {}),
        }),
      };
    }
    return {
      nr: null, done: true,
      text: formatCaptureReadFinishedReply({
        link,
        documentCount: readNumber(payload, 'documentCount') ?? Math.max(snapshot.observations, 1),
        issuerName: readString(payload, 'issuerName') ?? null,
        documentTotal: readString(payload, 'documentTotal') ?? null,
      }),
    };
  }

  /**
   * §17.5 needs the DELIVERY outcome separately from the read outcome (UXE-25), so the attempt row
   * for this group is updated with both. Best effort: a diagnostic may not sink a real push.
   */
  private async recordDelivery(
    companyId: string,
    userId: string,
    groupId: string,
    snapshot: NonNullable<Awaited<ReturnType<ExpenseCaptureLineUseCase['readFinishedSnapshot']>>>,
    delivered: boolean,
    /** §3.2: the group became one expense, so "ไฟล์เมื่อกี้…" must point at the record, not the work. */
    expenseId: string | null,
  ): Promise<void> {
    const statuses = snapshot.jobs.map((job) => job.status);
    const outcome = statuses.includes('FAILED') ? 'STORED_READ_FAILED' as const
      : statuses.includes('PARTIAL') || statuses.includes('PAUSED') ? 'STORED_READ_PARTIAL' as const
      : statuses.length > 0 && statuses.every((value) => value === 'DONE') ? 'STORED_READ_DONE' as const
      : 'STORED' as const;
    try {
      const rows = await this.prisma.client.lineIntakeAttempt.findMany({
        where: { companyId, targetType: 'capture_group', targetId: groupId },
        orderBy: { createdAt: 'desc' }, take: 3, select: { id: true },
      });
      for (const row of rows) {
        await this.captureRepo.updateLineIntakeAttemptOutcome({
          id: row.id, outcome, stage: 'READ',
          reasonCode: delivered ? 'result_delivered' : 'LINE_DELIVERY_FAILED',
          ...(expenseId ? { targetType: 'expense', targetId: expenseId } : {}),
        });
      }
    } catch (error) {
      this.logger.warn({ msg: 'line.capture_result.attempt_not_updated', userId, groupId, errorCode: (error as Error)?.message?.slice(0, 120) });
    }
  }
}

/**
 * The actor a background push acts as: the person whose work this is (§18.1 `createdByUserId`),
 * with no permissions of their own — every use case reached from here re-reads what it needs and
 * none of them is a permission-checked route.
 */
function systemContext(companyId: string, groupId: string, userId: string): RequestContext {
  return {
    requestId: `capture-result:${groupId}`, authSubject: userId, userId, companyId,
    membershipId: '', roles: [], permissions: [], scopes: {}, authProvider: 'line',
  };
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const direct = payload[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const data = payload['data'];
  if (data && typeof data === 'object') {
    const nested = (data as Record<string, unknown>)[key];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return undefined;
}

function readStringArray(payload: Record<string, unknown>, key: string): string[] {
  const direct = payload[key] ?? (payload['data'] as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(direct) ? direct.filter((value): value is string => typeof value === 'string' && value.length > 0) : [];
}

function readBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const direct = payload[key] ?? (payload['data'] as Record<string, unknown> | undefined)?.[key];
  return typeof direct === 'boolean' ? direct : undefined;
}

function readNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const direct = payload[key];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const data = payload['data'];
  if (data && typeof data === 'object') {
    const nested = (data as Record<string, unknown>)[key];
    if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
  }
  return undefined;
}

/** The classification W03 puts on the event, read defensively: an unknown shape is simply absent. */
function readClassification(payload: Record<string, unknown>): any {
  const direct = payload['classification'] ?? (payload['data'] as Record<string, unknown> | undefined)?.['classification'];
  if (!direct || typeof direct !== 'object' || Array.isArray(direct)) return null;
  const raw = direct as Record<string, unknown>;
  if (typeof raw['documentKind'] !== 'string' || typeof raw['contentKind'] !== 'string') return null;
  return {
    ...raw,
    missingRequiredSignals: Array.isArray(raw['missingRequiredSignals']) ? raw['missingRequiredSignals'] : [],
    contradictionSignals: Array.isArray(raw['contradictionSignals']) ? raw['contradictionSignals'] : [],
  };
}


function freeCaptureRefusal(payload: Record<string, unknown>): string | null {
  const code = readString(payload, 'errorCode');
  if (code === 'FREE_MULTI_DOCUMENT_UNSUPPORTED') return FREE_EXPENSE_MULTI_DOCUMENT_TEXT_TH;
  if (code === 'FREE_DOCUMENTS_IN_FLIGHT') return FREE_EXPENSE_IN_FLIGHT_TEXT_TH;
  if (code === 'FREE_DOCUMENT_LIMIT_REACHED') return 'เดือนนี้ใช้สิทธิ์อ่านฟรีครบ 3 ใบแล้วค่ะ จึงยังไม่ได้อ่านไฟล์นี้';
  return null;
}
