import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import type { ExpenseRecord, Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { branchScopeWhere, isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { findLiveClaimOf } from '../../infrastructure/expense-void-blocker';
import { assertFundingMutation, lockFundingEvidence } from '../../infrastructure/substitute-funding.guard';
import { findLinkedDataBlocker, recheckExpensesReferencing } from './delete-expense.use-case';
import { assertExpenseReceiptFileStateAllowed } from './expense-upload.use-case';
import { decideLinePaymentEvidencePairing, equalPaymentAmount, LINE_PAYMENT_EDITABLE_STATUSES, LINE_PAYMENT_EVIDENCE_VOID_REASON,
  LINE_PAYMENT_EVIDENCE_WINDOW_MS, LINE_PAYMENT_RECEIPT_TYPES, type LinePaymentEvidenceCandidate } from '../../domain/logic/line-payment-evidence.logic';

type LinkState = { receiptId: string; attachmentId: string; operationId: string; originalStatus: 'DRAFT' | 'NEEDS_REVIEW'; state: 'LINKED' | 'UNDONE' };
export type LinePaymentEvidenceResult = { kind: 'LINKED'; slipId: string; receiptId: string; operationId: string }
  | { kind: 'ASK'; slipId: string; candidates: LinePaymentEvidenceCandidate[] }
  | { kind: 'NONE'; slipId: string };
const metadata = (row: ExpenseRecord) => (row.sourceChannelMetadataJson ?? {}) as Record<string, any>;
const linkState = (row: ExpenseRecord) => metadata(row).linePaymentEvidence as LinkState | undefined;
const permission = (permissions: string[]) => ['expense.receipt.upload', 'expense.receipt.line_upload', 'expense.update'].some(key => permissions.includes(key));

/** One active expense, with the original slip retained in VOIDED for exact, OCR-free undo. */
@Injectable()
export class LinkLinePaymentEvidenceUseCase {
  constructor(private readonly prisma: PrismaService, private readonly repo: PrismaExpenseRepository,
    private readonly attachments: PrismaAttachmentRepository, private readonly audit: AuditService,
    private readonly permissions: PermissionResolverService) {}

  private async access(ctx: RequestContext): Promise<RequestContext> {
    if (ctx.authProvider !== 'line' || !permission(ctx.permissions)) throw new ForbiddenException('Missing expense evidence permission.');
    const current = await this.permissions.resolveAccess(ctx.userId, ctx.companyId);
    const user = await this.prisma.client.user.findFirst({ where: { id: ctx.userId, status: 'ACTIVE' }, select: { id: true } });
    if (!user || current.companyId !== ctx.companyId || ctx.membershipId && current.membershipId !== ctx.membershipId
      || !permission(current.permissions)) throw new ForbiddenException('Expense evidence access changed.');
    return { ...ctx, permissions: current.permissions, scopes: current.scopes };
  }

  private assertOwner(ctx: RequestContext, chatKeyHash: string, row: ExpenseRecord | null): asserts row is ExpenseRecord {
    if (!row) throw new NotFoundException('LINE capture not found.');
    if (!chatKeyHash || row.companyId !== ctx.companyId || row.createdByUserId !== ctx.userId || row.captureSource !== 'LINE_UPLOAD'
      || !row.lineMessageId || metadata(row).chatKeyHash !== chatKeyHash || !isBranchInScope(ctx.scopes ?? {}, row.branchId)) {
      throw new ForbiddenException('Expense is outside this LINE capture scope.');
    }
  }

  private candidate(row: ExpenseRecord, hasPaymentEvidence: boolean): LinePaymentEvidenceCandidate {
    const summary = (row.aiVerificationSummaryJson ?? {}) as Record<string, any>;
    // OCR may leave expenseDate at today's placeholder. Only the extracted, accepted day counts.
    const fields = summary.recognizedFields ?? row.aiVerifiedFieldsJson as Record<string, any> | null;
    const documentDay = typeof fields?.expenseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(fields.expenseDate)
      && !summary.missingFields?.includes('expenseDate') && fields.expenseDate === row.expenseDate.toISOString().slice(0, 10)
      ? fields.expenseDate : null;
    return { id: row.id, companyId: row.companyId, chatKeyHash: metadata(row).chatKeyHash,
      createdAt: row.createdAt, amount: row.grandTotalAmount.toString(), currency: row.currency,
      documentDay, vendorName: row.vendorNameSnapshot, status: row.status, hasPaymentEvidence };
  }

  private async rows(ctx: RequestContext, chatKeyHash: string, since: Date, until?: Date, db: Prisma.TransactionClient = this.prisma.client) {
    return db.expenseRecord.findMany({ where: { companyId: ctx.companyId, createdByUserId: ctx.userId,
      captureSource: 'LINE_UPLOAD', lineMessageId: { not: null }, sourceChannelMetadataJson: { path: ['chatKeyHash'], equals: chatKeyHash },
      createdAt: { gte: since, ...(until ? { lte: until } : {}) }, ...branchScopeWhere(ctx.scopes ?? {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }

  private async decision(ctx: RequestContext, chatKeyHash: string, slip: ExpenseRecord, db: Prisma.TransactionClient) {
    const nearby = await this.rows(ctx, chatKeyHash, new Date(slip.createdAt.getTime() - LINE_PAYMENT_EVIDENCE_WINDOW_MS),
      new Date(slip.createdAt.getTime() + LINE_PAYMENT_EVIDENCE_WINDOW_MS), db);
    const receipts = nearby.filter(row => LINE_PAYMENT_RECEIPT_TYPES.includes(row.sourceDocumentType ?? ''));
    const links = receipts.length ? await db.attachmentLink.findMany({ where: { companyId: ctx.companyId,
      targetType: 'expense.record', targetId: { in: receipts.map(row => row.id) }, purpose: 'expense.payment.evidence' }, select: { targetId: true } }) : [];
    return decideLinePaymentEvidencePairing(this.candidate(slip, false), receipts.map(row => this.candidate(row, links.some(link => link.targetId === row.id))));
  }

  async forCapture(ctx: RequestContext, chatKeyHash: string, expenseId: string): Promise<LinePaymentEvidenceResult> {
    if (!permission(ctx.permissions)) return { kind: 'NONE', slipId: expenseId };
    ctx = await this.access(ctx);
    const row = await this.prisma.client.expenseRecord.findFirst({ where: { id: expenseId, companyId: ctx.companyId } });
    this.assertOwner(ctx, chatKeyHash, row);
    if (row.sourceDocumentType === 'TRANSFER_SLIP') return this.link(ctx, chatKeyHash, row.id);
    // ponytail: reverse order is automatic only with one nearby slip; otherwise preserve both drafts.
    if (LINE_PAYMENT_RECEIPT_TYPES.includes(row.sourceDocumentType ?? '')) {
      const slips = (await this.rows(ctx, chatKeyHash, new Date(row.createdAt.getTime() - LINE_PAYMENT_EVIDENCE_WINDOW_MS),
        new Date(row.createdAt.getTime() + LINE_PAYMENT_EVIDENCE_WINDOW_MS)))
        .filter(item => item.sourceDocumentType === 'TRANSFER_SLIP' && ['DRAFT', 'NEEDS_REVIEW'].includes(item.status)
          && !metadata(item).linePaymentEvidenceSeparate && linkState(item)?.state !== 'UNDONE');
      if (slips.length === 1) return this.link(ctx, chatKeyHash, slips[0]!.id);
    }
    return { kind: 'NONE', slipId: expenseId };
  }

  async recent(ctx: RequestContext, chatKeyHash: string): Promise<LinePaymentEvidenceResult> {
    ctx = await this.access(ctx);
    const slip = (await this.rows(ctx, chatKeyHash, new Date(Date.now() - LINE_PAYMENT_EVIDENCE_WINDOW_MS)))
      .find(row => row.sourceDocumentType === 'TRANSFER_SLIP');
    return slip ? this.link(ctx, chatKeyHash, slip.id) : { kind: 'NONE', slipId: '' };
  }

  async choices(ctx: RequestContext, chatKeyHash: string, slipId: string): Promise<LinePaymentEvidenceResult> {
    ctx = await this.access(ctx);
    return this.prisma.client.$transaction(async tx => {
      const slip = await tx.expenseRecord.findFirst({ where: { id: slipId, companyId: ctx.companyId } });
      this.assertOwner(ctx, chatKeyHash, slip);
      if (slip.sourceDocumentType !== 'TRANSFER_SLIP' || !['DRAFT', 'NEEDS_REVIEW'].includes(slip.status)) throw new ConflictException('Slip changed.');
      const decision = await this.decision(ctx, chatKeyHash, slip, tx);
      return { kind: 'ASK', slipId, candidates: decision.candidates };
    });
  }

  async link(ctx: RequestContext, chatKeyHash: string, slipId: string, selectedReceiptId?: string): Promise<LinePaymentEvidenceResult> {
    ctx = await this.access(ctx);
    return this.prisma.client.$transaction(async tx => {
      // Same lock order as receipt append/delete and duplicate reconciliation.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:duplicate-reconciliation`}))`;
      const initial = await tx.expenseRecord.findFirst({ where: { id: slipId, companyId: ctx.companyId } });
      this.assertOwner(ctx, chatKeyHash, initial);
      const decision = await this.decision(ctx, chatKeyHash, initial, tx);
      const receiptId = selectedReceiptId ?? (decision.kind === 'AUTO' ? decision.receiptId : undefined);
      const prior = linkState(initial);
      if (initial.status === 'VOIDED' && initial.voidReason === LINE_PAYMENT_EVIDENCE_VOID_REASON && prior?.state === 'LINKED') {
        if (selectedReceiptId && prior.receiptId !== selectedReceiptId) throw new ConflictException('Slip already linked elsewhere.');
        const receipt = await tx.expenseRecord.findFirst({ where: { id: prior.receiptId, companyId: ctx.companyId } });
        this.assertOwner(ctx, chatKeyHash, receipt);
        const link = await tx.attachmentLink.findFirst({ where: { companyId: ctx.companyId, targetType: 'expense.record', targetId: prior.receiptId,
          attachmentId: prior.attachmentId, purpose: 'expense.payment.evidence' }, select: { id: true } });
        if (!link) throw new ConflictException('Evidence link has changed.');
        return { kind: 'LINKED', slipId, receiptId: prior.receiptId, operationId: prior.operationId };
      }
      if (initial.sourceDocumentType !== 'TRANSFER_SLIP') throw new ConflictException('Capture is not a transfer slip.');
      if (!selectedReceiptId && (metadata(initial).linePaymentEvidenceSeparate || prior?.state === 'UNDONE')) return { kind: 'NONE', slipId };
      if (!receiptId) return decision.kind === 'ASK' ? { kind: 'ASK', slipId, candidates: decision.candidates } : { kind: 'NONE', slipId };
      if (!decision.candidates.some(item => item.id === receiptId)) throw new ConflictException('Receipt is no longer an eligible candidate.');
      await lockFundingEvidence(tx, ctx.companyId, { expenseIds: [slipId, receiptId], attachmentIds: initial.primaryAttachmentId ? [initial.primaryAttachmentId] : [] });
      for (const id of [slipId, receiptId].sort()) {
        await tx.$executeRaw`SELECT id FROM "ExpenseRecord" WHERE id = ${id} AND "companyId" = ${ctx.companyId} FOR UPDATE`;
      }
      const slip = await tx.expenseRecord.findFirst({ where: { id: slipId, companyId: ctx.companyId } });
      const receipt = await tx.expenseRecord.findFirst({ where: { id: receiptId, companyId: ctx.companyId } });
      this.assertOwner(ctx, chatKeyHash, slip); this.assertOwner(ctx, chatKeyHash, receipt);
      this.assertEditable(receipt);
      await assertExpenseReceiptFileStateAllowed(ctx, receipt, 'append', tx);
      await assertExpenseReceiptFileStateAllowed(ctx, slip, 'append', tx);
      await assertFundingMutation(tx, ctx.companyId, receiptId, 'supersede');
      await assertFundingMutation(tx, ctx.companyId, slipId, 'supersede');
      if (!['DRAFT', 'NEEDS_REVIEW'].includes(slip.status) || slip.reviewedAt || slip.sourceDocumentType !== 'TRANSFER_SLIP'
        || !slip.primaryAttachmentId || slip.paidAmount.gt(0) || slip.paymentStatus !== 'UNPAID' || slip.postingStatus !== 'not_required'
        || slip.sourceReimbursementRequestId || slip.reservedByDisbursementVoucherId
        || await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId: ctx.companyId, expenseId: slipId }, select: { id: true } })
        || await findLiveClaimOf(tx, ctx.companyId, slip) || await findLinkedDataBlocker(tx, ctx.companyId, slipId)) {
        throw new ConflictException('Slip is no longer an uncommitted LINE draft.');
      }
      const fresh = await this.decision(ctx, chatKeyHash, slip, tx);
      if (!fresh.candidates.some(item => item.id === receiptId) || !selectedReceiptId && (fresh.kind !== 'AUTO'
        || fresh.receiptId !== receiptId || !equalPaymentAmount(slip.grandTotalAmount.toString(), receipt.grandTotalAmount.toString()))) {
        throw new ConflictException('Payment evidence candidates changed.');
      }
      const attachmentId = slip.primaryAttachmentId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${attachmentId}:attachment-retention`}))`;
      const file = await tx.attachmentObject.findFirst({ where: { id: attachmentId, companyId: ctx.companyId, uploadedByUserId: ctx.userId, status: 'ACTIVE' }, select: { id: true } });
      const hold = await this.attachments.findSubstituteEvidenceRetentionHold({ id: attachmentId, companyId: ctx.companyId }, tx);
      const sourceLinks = await tx.attachmentLink.findMany({ where: { companyId: ctx.companyId, targetType: 'expense.record', targetId: slipId }, select: { attachmentId: true, purpose: true } });
      if (!file || hold || sourceLinks.length !== 1 || sourceLinks[0]?.attachmentId !== attachmentId
        || sourceLinks[0]?.purpose !== 'expense.receipt.primary') throw new ConflictException('Slip evidence is unavailable or shared with other work.');
      await this.repo.linkAttachment(receiptId, attachmentId, 'expense.payment.evidence', ctx.companyId, ctx.userId, tx);
      const state: LinkState = { receiptId, attachmentId, operationId: randomUUID(), originalStatus: slip.status as LinkState['originalStatus'], state: 'LINKED' };
      await this.update(tx, ctx, receipt, {});
      await this.update(tx, ctx, slip, { status: 'VOIDED', voidedAt: new Date(), voidReason: LINE_PAYMENT_EVIDENCE_VOID_REASON,
        duplicateStatus: 'NO_MATCH', duplicateOfExpenseId: null, duplicateOverrideReason: null,
        sourceChannelMetadataJson: { ...metadata(slip), linePaymentEvidence: state } });
      await recheckExpensesReferencing(tx, ctx.companyId, slipId, ctx.userId);
      await tx.expenseDuplicateCandidate.deleteMany({ where: { companyId: ctx.companyId, OR: [{ expenseId: slipId }, { candidateExpenseId: slipId }] } });
      await this.log(tx, ctx, receiptId, 'link', slipId, state);
      return { kind: 'LINKED', slipId, receiptId, operationId: state.operationId };
    });
  }

  private assertEditable(receipt: ExpenseRecord) {
    if (!LINE_PAYMENT_EDITABLE_STATUSES.includes(receipt.status) || receipt.sourceReimbursementRequestId
      || receipt.reservedByDisbursementVoucherId) throw new ConflictException('Receipt is not editable.');
  }

  async undo(ctx: RequestContext, chatKeyHash: string, slipId: string, operationId: string): Promise<void> {
    ctx = await this.access(ctx);
    await this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:duplicate-reconciliation`}))`;
      const initial = await tx.expenseRecord.findFirst({ where: { id: slipId, companyId: ctx.companyId } });
      this.assertOwner(ctx, chatKeyHash, initial);
      const state = linkState(initial);
      if (!state || state.operationId !== operationId) throw new ConflictException('Evidence link has changed.');
      await lockFundingEvidence(tx, ctx.companyId, { expenseIds: [slipId, state.receiptId], attachmentIds: [state.attachmentId] });
      for (const id of [slipId, state.receiptId].sort()) {
        await tx.$executeRaw`SELECT id FROM "ExpenseRecord" WHERE id = ${id} AND "companyId" = ${ctx.companyId} FOR UPDATE`;
      }
      const slip = await tx.expenseRecord.findFirst({ where: { id: slipId, companyId: ctx.companyId } });
      const receipt = await tx.expenseRecord.findFirst({ where: { id: state.receiptId, companyId: ctx.companyId } });
      this.assertOwner(ctx, chatKeyHash, slip); this.assertOwner(ctx, chatKeyHash, receipt); this.assertEditable(receipt);
      if (linkState(slip)?.operationId !== operationId) throw new ConflictException('Evidence link has changed.');
      if (linkState(slip)?.state === 'UNDONE') return;
      await assertExpenseReceiptFileStateAllowed(ctx, receipt, 'append', tx);
      await assertFundingMutation(tx, ctx.companyId, receipt.id, 'supersede');
      await assertFundingMutation(tx, ctx.companyId, slipId, 'supersede');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${state.attachmentId}:attachment-retention`}))`;
      if (slip.status !== 'VOIDED' || slip.voidReason !== LINE_PAYMENT_EVIDENCE_VOID_REASON) throw new ConflictException('Slip changed.');
      if (await this.attachments.findSubstituteEvidenceRetentionHold({ id: state.attachmentId, companyId: ctx.companyId }, tx)
        || await findLiveClaimOf(tx, ctx.companyId, receipt)) throw new ConflictException('Evidence is now retained by another document.');
      const removed = await tx.attachmentLink.deleteMany({ where: { companyId: ctx.companyId, attachmentId: state.attachmentId,
        targetType: 'expense.record', targetId: receipt.id, purpose: 'expense.payment.evidence' } });
      if (removed.count !== 1) throw new ConflictException('Evidence link has changed.');
      await this.update(tx, ctx, receipt, {});
      await this.update(tx, ctx, slip, { status: state.originalStatus, voidedAt: null, voidReason: null,
        sourceChannelMetadataJson: { ...metadata(slip), linePaymentEvidence: { ...state, state: 'UNDONE' } } });
      await this.log(tx, ctx, receipt.id, 'undo', slipId, state);
    });
  }

  async separate(ctx: RequestContext, chatKeyHash: string, slipId: string): Promise<void> {
    ctx = await this.access(ctx);
    await this.prisma.client.$transaction(async tx => {
      const slip = await tx.expenseRecord.findFirst({ where: { id: slipId, companyId: ctx.companyId } });
      this.assertOwner(ctx, chatKeyHash, slip);
      if (slip.sourceDocumentType !== 'TRANSFER_SLIP' || !['DRAFT', 'NEEDS_REVIEW'].includes(slip.status)) throw new ConflictException('Slip changed.');
      await this.update(tx, ctx, slip, { sourceChannelMetadataJson: { ...metadata(slip), linePaymentEvidenceSeparate: true } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.update', targetType: 'expense_record',
        targetId: slipId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { operation: 'line_payment_evidence_separate' } }, tx);
    });
  }

  private async update(tx: Prisma.TransactionClient, ctx: RequestContext, row: ExpenseRecord, data: Prisma.ExpenseRecordUpdateManyMutationInput) {
    const result = await tx.expenseRecord.updateMany({ where: { id: row.id, companyId: ctx.companyId, updatedAt: row.updatedAt },
      data: { ...data, updatedByUserId: ctx.userId, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) } });
    if (result.count !== 1) throw new ConflictException('Expense changed.');
  }

  private async log(tx: Prisma.TransactionClient, ctx: RequestContext, receiptId: string, operation: string, slipId: string, state: LinkState) {
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.update', targetType: 'expense_record',
      targetId: receiptId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { operation: `line_payment_evidence_${operation}`, slipId, ...state } }, tx);
  }
}
