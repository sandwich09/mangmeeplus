import { HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ReimbursementClaimFormPreview, ReimbursementClaimSignatureRole, RequestContext } from '@watchdog-bms/contracts';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import type { ReimbursementClaimSignatureRecord, ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';
import { isLineEvidenced, byLineNo } from '../../domain/logic/reimbursement.logic';
import { parseReimbursementPolicySnapshot } from '../../domain/reimbursement.constants';
import {
  claimFormLayout,
  renderReimbursementClaimFormSvg,
  renderReimbursementClaimFormPages,
  type ClaimFormSigner,
  type ReimbursementClaimFormSnapshot,
} from '../../domain/logic/claim-form.logic';
import { assertCanReadRequest } from './reimbursement-request.use-case';
import { loadOwnedClaimSignature } from './reimbursement-claim-signature.use-case';

/**
 * Preview of the printable ใบเบิกค่าใช้จ่าย. Rendered on demand, returned inline
 * and never stored: the paper file is produced by the user's own browser print,
 * and re-rendering always reflects the claim's current state.
 */
@Injectable()
export class PreviewReimbursementClaimFormUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
  ) {}

  async execute(ctx: RequestContext, requestId: string): Promise<ReimbursementClaimFormPreview> {
    const req = await this.repo.findRequestById(ctx.companyId, requestId, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // Same read guard as GET detail — printing exposes nothing the drawer does not.
    await assertCanReadRequest(ctx, req, this.repo);
    // The document number is what makes this a document. A draft never has one,
    // and neither does a claim cancelled straight out of DRAFT — printing either
    // would produce a form with a blank เลขที่เอกสาร.
    if (req.status === 'DRAFT' || !req.requestNo) throw new UnprocessableEntityException('claim_form_requires_submitted');

    const snapshot = await this.buildSnapshot(ctx.companyId, req);
    const svg = renderReimbursementClaimFormSvg(snapshot);
    const pages = renderReimbursementClaimFormPages(snapshot);
    return {
      svgDataUrl: `data:image/svg+xml;base64,${svg.toString('base64')}`,
      pageSvgDataUrls: pages.map((page) => `data:image/svg+xml;base64,${page.toString('base64')}`),
      checksumSha256: createHash('sha256').update(svg).digest('hex'),
    };
  }

  private async buildSnapshot(companyId: string, req: ReimbursementRequestRecord): Promise<ReimbursementClaimFormSnapshot> {
    const steps = req.approvalSteps ?? [];
    const payments = req.payments ?? [];
    const lines = req.lines ?? [];
    // Latest APPROVED step and latest non-voided payment are the ones that signed.
    const approvedStep = steps
      .filter((step) => step.status === 'APPROVED' && !!step.decidedAt)
      .sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())[0];
    const payment = payments
      .filter((row) => row.status === 'RECORDED')
      .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
      .at(-1);
    const financeReviewed = req.financeReviewStatus === 'APPROVED_FOR_PAYMENT' && !!req.financeReviewedAt
      ? req.financeReviewedByUserId
      : undefined;
    const policySnapshot = parseReimbursementPolicySnapshot(req.approvalPolicySnapshotJson);

    const [company, names, signatureImages, paymentSlips] = await Promise.all([
      this.repo.getClaimFormCompanyContext(companyId, req.branchId ?? null),
      this.repo.getUserDisplayNames(companyId, [
        approvedStep?.decisionByUserId,
        financeReviewed,
        payment?.paidByUserId,
      ].filter((id): id is string => !!id)),
      this.loadSignatureImages(companyId, req.id, req.claimSignatures ?? []),
      // The slips of the payment the form prints, read the way the claim page reads them.
      payment ? this.repo.listPaymentSlips(companyId, [payment.id]) : undefined,
    ]);
    const signer = (userId: string | undefined, at: Date | undefined, role: ReimbursementClaimSignatureRole): ClaimFormSigner | null =>
      (userId && at
        ? {
            name: names[userId] ?? userId,
            at: at.toISOString(),
            ...(signatureImages[role] ? { signatureDataUrl: signatureImages[role]! } : {}),
          }
        : null);

    return {
      requestNo: req.requestNo ?? '-',
      submittedAt: req.submittedAt?.toISOString() ?? null,
      currency: req.currency,
      totalAmount: req.amount,
      reason: req.reason,
      requesterName: req.requesterDisplayNameSnapshot,
      company,
      lines: byLineNo(lines).map((line) => ({
        lineNo: line.lineNo,
        incurredDate: line.incurredDate.toISOString(),
        description: line.description,
        purpose: line.purpose ?? null,
        amount: line.amount,
        ...(line.sourceExpenseSnapshot && { sourceReference: [
          line.sourceExpenseSnapshot.seller.name,
          line.sourceExpenseSnapshot.seller.documentNumber,
          line.sourceExpenseSnapshot.certificate?.documentNumber,
        ].filter(Boolean).join(' · ') }),
      })),
      hasReceiptEvidence: lines.some(isLineEvidenced),
      missingReceiptReason: req.missingReceiptReason ?? null,
      approvalDecisionNote: policySnapshot?.requiresApproval === false ? 'ไม่ต้องอนุมัติตามนโยบาย' : null,
      layout: claimFormLayout(req.claimSignatures),
      repayment: payment
        ? {
            paidAt: payment.paidAt.toISOString(),
            method: payment.paymentMethod,
            reference: payment.paymentReference ?? null,
            recordedByName: names[payment.paidByUserId] ?? payment.paidByUserId,
          }
        : null,
      hasPaymentEvidence: !!payment && (paymentSlips?.[payment.id]?.length ?? 0) > 0,
      selfApproved: approvedStep?.decisionByUserId === req.requesterUserId,
      ...(req.status === 'CANCELLED' ? { cancellation: { reason: req.rejectionReason ?? null } } : {}),
      signers: {
        requester: req.submittedAt
          ? {
              name: req.requesterDisplayNameSnapshot,
              at: req.submittedAt.toISOString(),
              ...(signatureImages.REQUESTER ? { signatureDataUrl: signatureImages.REQUESTER } : {}),
            }
          : null,
        // A rejected/pending claim was never approved, so its approver block stays blank for wet ink.
        approver: signer(approvedStep?.decisionByUserId, approvedStep?.decidedAt, 'APPROVER'),
        accounting: signer(financeReviewed, req.financeReviewedAt, 'FINANCE_REVIEW'),
        finance: signer(payment?.paidByUserId, payment?.paidAt, 'PAYER'),
      },
    };
  }

  /**
   * Stored signatures resolve to data URLs at render time — magic bytes and
   * checksum are verified on every load, so a tampered image fails the print
   * rather than reaching paper.
   *
   * A signature that cannot be read (object missing, storage down, checksum
   * moved) is a document problem, not a server fault: it fails the print with a
   * stable 422 naming the role instead of a 500. Loads run one at a time so a
   * failure cannot leave sibling loads rejecting unobserved.
   */
  private async loadSignatureImages(
    companyId: string,
    requestId: string,
    signatures: ReimbursementClaimSignatureRecord[],
  ): Promise<Partial<Record<ReimbursementClaimSignatureRole, string>>> {
    const loaded: [ReimbursementClaimSignatureRole, string][] = [];
    for (const signature of signatures) {
      try {
        const image = await loadOwnedClaimSignature(
          this.repo, this.storage, companyId, signature.signatureAttachmentId,
          signature.signedByUserId, requestId, signature.role,
        );
        loaded.push([signature.role, image.dataUrl]);
      } catch (error) {
        throw new UnprocessableEntityException({
          // The role rides in `message` so the drawer banner can name the block.
          message: ['claim_signature_unreadable', signature.role],
          code: 'claim_signature_unreadable',
          role: signature.role,
          // Our own loader codes are safe to echo; storage internals are not.
          reason: error instanceof HttpException ? error.message : 'storage_unreadable',
        });
      }
    }
    return Object.fromEntries(loaded);
  }
}
