import { Injectable, Logger, Optional } from '@nestjs/common';
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
import { LineReplyAdapter } from '../../infrastructure/line-reply.adapter';
import { LineHandoffLinkService } from '../line-handoff-link.service';

/** The outbox event a finished capture read emits (contracts owns the string; see appendix §3). */
export const LINE_CAPTURE_READ_FINISHED_EVENT_TYPE = EXPENSE_CAPTURE_READ_FINISHED_EVENT_TYPE;

const WORKER_ID = 'line-capture-result-notifier';
const MAX_BATCH = 25;

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
        const outcome = await this.notify(event.companyId, event.payloadJson);
        result[outcome] += 1;
        // One push per job: the event key is the fence, and `markPublished` CASes on the claim.
        await this.outbox.markPublished({ id: event.id, claimToken: event.claimToken ?? null });
      } catch (error) {
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
  ): Promise<'pushed' | 'skipped'> {
    if (!companyId) return 'skipped';
    // Appendix §25: both lanes queue `ownerType EXPENSE` jobs now, so this is the live path. The
    // group path below still serves rows that were queued before 2026-09-19.
    if (readString(payload, 'ownerType') === 'EXPENSE') return this.notifyExpense(companyId, payload);
    const groupId = readString(payload, 'groupId');
    if (!groupId) return 'skipped';
    const snapshot = await this.captureLine.readFinishedSnapshot(companyId, groupId);
    // LINE-only: a WEB group's result belongs to the page the customer is already looking at.
    if (!snapshot || snapshot.group.intakeChannel !== 'LINE') return 'skipped';

    const access = await this.resolveRecipient(companyId, snapshot.group);
    if (!access) {
      // Park as undelivered rather than push: the person this result belongs to no longer has the
      // access it was produced under (appendix §3 "access re-checked").
      await this.recordDelivery(companyId, snapshot.group.createdByUserId, groupId, snapshot, false, null);
      return 'skipped';
    }

    // Appendix §25: the group page is withdrawn, so a legacy group's result points at the expense
    // list. New rows never reach here — both lanes queue `ownerType EXPENSE` jobs.
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses`);
    const composed = this.composeReply(snapshot, payload, link);
    if (!composed) return 'skipped';
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
    const handed = composed.done && !composed.nr && (readNumber(payload, 'documentCount') ?? 1) <= 1
      ? await this.autoHandoffReply(companyId, groupId, snapshot.group.createdByUserId)
      : null;
    if (handed) text = handed.text;

    const message = {
      ...this.lineReply.buildTextMessage(text),
      quickReply: buildStaffCompletionQuickReply({
        permissions: access.permissions,
        entitledFeatureKeys: access.entitledFeatureKeys,
        isOwner: access.roles.includes('OWNER'),
      }),
    };
    const outgoing = this.handoffLinks
      ? await this.handoffLinks.wrapOutgoingLineContent(
        { userId: snapshot.group.createdByUserId, companyId, lineUserId: access.lineUserId, surface: 'line_capture_result' },
        [message],
      )
      : [message];
    const delivery = await this.lineReply.sendPush(access.pushTargetId, outgoing, `capture:${groupId}`)
      .catch(() => 'failed_other' as const);
    await this.recordDelivery(
      companyId, snapshot.group.createdByUserId, groupId, snapshot, delivery === 'ok', handed?.expenseId ?? null,
    );
    if (delivery !== 'ok') return 'skipped';
    return 'pushed';
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
  ): Promise<'pushed' | 'skipped'> {
    const expenseId = readString(payload, 'expenseId');
    if (!expenseId) return 'skipped';
    const snapshot = await this.captureLine.readFinishedExpenseSnapshot(companyId, expenseId);
    // LINE-only: a WEB upload's result belongs to the page the customer is already looking at.
    if (!snapshot || snapshot.expense.captureSource !== 'LINE_UPLOAD') return 'skipped';

    const access = await this.resolveRecipient(companyId, {
      createdByUserId: snapshot.expense.createdByUserId,
      lineChatKeyHash: snapshot.expense.lineChatKeyHash,
      linePushTargetId: snapshot.expense.linePushTargetId,
    });
    const link = absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${expenseId}`);
    if (!access) {
      await this.recordExpenseDelivery(companyId, expenseId, snapshot.jobs, false);
      return 'skipped';
    }

    let composed = this.composeExpenseReply(companyId, snapshot, payload, link);
    if (!composed) return 'skipped';
    // §18.4 NR07: a confirmed non-business image is evidence of nothing, and the draft this lane
    // created at intake carries no money yet — so it is removed rather than left as a phantom row.
    if (composed.nr === 'NR07') {
      const removed = await this.deleteEmptyDraft(companyId, expenseId, readString(payload, 'jobId') ?? null)
        .catch(() => false);
      // Not removed = no longer empty: someone already filled the draft in, so it is their record
      // now and "จึงไม่ได้สร้างรายการ" would be false. Say what is true, and link it.
      if (!removed) composed = { text: CAPTURE_READ_PARTIAL_REPLY(link), nr: null };
    }

    const message = {
      ...this.lineReply.buildTextMessage(composed.text),
      quickReply: buildStaffCompletionQuickReply({
        permissions: access.permissions,
        entitledFeatureKeys: access.entitledFeatureKeys,
        isOwner: access.roles.includes('OWNER'),
      }),
    };
    const outgoing = this.handoffLinks
      ? await this.handoffLinks.wrapOutgoingLineContent(
        { userId: snapshot.expense.createdByUserId, companyId, lineUserId: access.lineUserId, surface: 'line_capture_result' },
        [message],
      )
      : [message];
    const delivery = await this.lineReply.sendPush(access.pushTargetId, outgoing, `capture:${expenseId}`)
      .catch(() => 'failed_other' as const);
    await this.recordExpenseDelivery(companyId, expenseId, snapshot.jobs, delivery === 'ok');
    return delivery === 'ok' ? 'pushed' : 'skipped';
  }

  /** §3 / §17.6 / §18.4 / §25, for the expense lane. */
  private composeExpenseReply(
    companyId: string,
    snapshot: NonNullable<Awaited<ReturnType<ExpenseCaptureLineUseCase['readFinishedExpenseSnapshot']>>>,
    payload: Record<string, unknown>,
    link: string,
  ): { text: string; nr: LineNonReceiptCase | null } | null {
    const status = readString(payload, 'status') ?? snapshot.jobs[0]?.status ?? null;
    if (!status) return null;
    if (status === 'FAILED') return { text: CAPTURE_READ_FAILED_REPLY(link), nr: null };
    if (status === 'PARTIAL') return { text: CAPTURE_READ_PARTIAL_REPLY(link), nr: null };
    if (status === 'PAUSED') {
      const paused = snapshot.jobs.find((job) => job.status === 'PAUSED')?.pausedReason
        ?? readString(payload, 'pausedReason') ?? null;
      return { text: CAPTURE_READ_PAUSED_REPLY(link, paused), nr: null };
    }
    if (status !== 'DONE') return null;

    // §18.4: a classification the reader is SURE about gets its own sentence — the read succeeded,
    // so NR09's failure copy would be a lie. The draft exists, so the copy says so (`capturedDraft`).
    const classification = readClassification(payload);
    const nr = classification ? classifyNonReceiptCase(classification) : null;
    if (nr && nr !== 'NR06') {
      return {
        nr,
        text: nonReceiptReply(nr, {
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
      return { text: CAPTURE_READ_PARTIAL_REPLY(link), nr: null };
    }
    if (splitIds.length > 0) {
      return {
        nr: null,
        text: formatCaptureSplitReply({
          documentCount: readNumber(payload, 'documentCount') ?? splitIds.length + 1,
          links: [link, ...splitIds.map((id) => absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${id}`))],
        }),
      };
    }
    // One document: the receipt card a LINE photo prints today, read off the draft itself.
    return {
      nr: null,
      text: formatCaptureAutoHandoffReply({
        link,
        vendorName: snapshot.expense.vendorNameSnapshot,
        amount: snapshot.expense.grandTotalAmount,
        currency: snapshot.expense.currency,
        documentTypeLabel: snapshot.expense.sourceDocumentType
          ? SOURCE_DOCUMENT_TYPE_LABELS[snapshot.expense.sourceDocumentType as keyof typeof SOURCE_DOCUMENT_TYPE_LABELS] ?? null : null,
        expenseDate: snapshot.expense.expenseDate,
      }),
    };
  }

  /**
   * §18.4 NR07: remove the draft this lane created at intake, the way `DeleteExpenseUseCase` would —
   * its file links go, a file nothing else links is retired, the record goes, and an audit row says
   * a SYSTEM rule did it. Guarded on everything that would make it more than an empty draft: a
   * zero-total DRAFT/NEEDS_REVIEW row with no payment, no posting and no reimbursement behind it.
   * Anything else is left alone (`false`) and the customer keeps the record.
   */
  private async deleteEmptyDraft(companyId: string, expenseId: string, jobId: string | null): Promise<boolean> {
    return this.prisma.client.$transaction(async (tx) => {
      const deleted = await tx.expenseRecord.deleteMany({
        where: {
          companyId, id: expenseId, status: { in: ['DRAFT', 'NEEDS_REVIEW'] },
          grandTotalAmount: 0, paidAmount: 0, postingStatus: 'not_required',
          sourceReimbursementRequestId: null,
        },
      });
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
    group: { createdByUserId: string; lineChatKeyHash: string | null; linePushTargetId: string | null },
  ): Promise<{ pushTargetId: string; lineUserId: string; permissions: string[]; roles: string[]; entitledFeatureKeys: ReadonlySet<string> | null } | null> {
    const userId = group.createdByUserId;
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId }, select: { status: true, aiAssistantOptOutAt: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.aiAssistantOptOutAt) return null;
    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { userId, provider: 'LINE', status: 'ACTIVE' },
      select: { providerUserId: true },
    });
    if (!identity?.providerUserId) return null;
    const pushTargetId = group.linePushTargetId ?? identity.providerUserId;
    if (group.lineChatKeyHash && hashMessagePreview(pushTargetId) !== group.lineChatKeyHash) return null;
    let access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>;
    try {
      access = await this.permissionResolver.resolveAccess(userId, companyId);
    } catch {
      return null;
    }
    const mayCapture = ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create']
      .some((permission) => access.permissions.includes(permission));
    if (!mayCapture) return null;
    const entitled = await loadEntitledFeatureKeys(this.prisma, companyId).catch(() => null);
    if (entitled && !entitled.has('expenses')) return null;
    return {
      pushTargetId, lineUserId: identity.providerUserId, permissions: access.permissions,
      roles: access.roles, entitledFeatureKeys: entitled,
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
  ): Promise<{ text: string; expenseId: string } | null> {
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
      select: { vendorNameSnapshot: true, grandTotalAmount: true, currency: true, sourceDocumentType: true, expenseDate: true },
    }).catch(() => null);
    return {
      expenseId: result.expenseId,
      text: formatCaptureAutoHandoffReply({
        link: absoluteWebLink(this.config.webBaseUrl, `/companies/${companyId}/expenses/${result.expenseId}`),
        vendorName: expense?.vendorNameSnapshot ?? null,
        amount: expense?.grandTotalAmount === undefined || expense?.grandTotalAmount === null ? null : String(expense.grandTotalAmount),
        currency: expense?.currency ?? null,
        documentTypeLabel: expense?.sourceDocumentType
          ? SOURCE_DOCUMENT_TYPE_LABELS[expense.sourceDocumentType] ?? null : null,
        expenseDate: expense?.expenseDate ?? null,
      }),
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
