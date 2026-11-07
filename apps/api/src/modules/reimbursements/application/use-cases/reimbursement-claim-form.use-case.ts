import { HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ReimbursementClaimFormPreview, ReimbursementClaimSignatureRole, RequestContext } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AuditService } from '../../../audit/application/audit.service';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import type { ClaimPayoutRecord } from '../../infrastructure/reimbursement-payout';
import { maskedPayoutHolderFacts } from '../../infrastructure/reimbursement-payout';
import type { ReimbursementClaimSignatureRecord, ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';
import { isLineEvidenced, byLineNo, claimApprovalStep, payoutCorrectionPhase, payoutCorrectionStatusLabel } from '../../domain/logic/reimbursement.logic';
import { hasPayoutSnapshot, openPayoutAccountNumber } from '../../domain/logic/payout-destination.logic';
import { parseReimbursementPolicySnapshot } from '../../domain/reimbursement.constants';
import {
  claimFormLayout,
  documentSignedVia,
  renderReimbursementClaimFormSvg,
  renderReimbursementClaimFormPages,
  type ClaimFormPayout,
  type ClaimFormSigner,
  type ReimbursementClaimFormSnapshot,
} from '../../domain/logic/claim-form.logic';
import { assertCanReadRequest, claimPayoutRevealGroup } from './reimbursement-request.use-case';
import { loadOwnedClaimSignature } from './reimbursement-claim-signature.use-case';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { renderSubstituteReceiptPdf, SUBSTITUTE_RECEIPT_PDF_LIMITS } from '../../../expenses/domain/logic/substitute-receipt-pdf.logic';

/**
 * Preview of the printable ใบเบิกค่าใช้จ่าย. Rendered on demand for whoever asked, returned inline
 * and never stored, cached or linked: the paper file is produced by the user's own browser print,
 * and re-rendering always reflects the claim's current state. Two people printing one claim each
 * get their own rendering, which is what lets the account number follow the reader (payout spec §17.1).
 */
@Injectable()
export class PreviewReimbursementClaimFormUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async executeSignedForExport(ctx: RequestContext, requestId: string, selectedExpenseIds: readonly string[],
    options: { render?: boolean; sourceLineIds?: ReadonlyMap<string, string | null>; exportedAt?: Date } = {}) {
    const { sourceLineIds } = options;
    const req = await this.repo.findRequestById(ctx.companyId, requestId, true);
    if (!req) throw new NotFoundException();
    await assertCanReadRequest(ctx, req, this.repo);
    const unavailable = (message: string) => ({ problem: { key: 'CLAIM_UNAVAILABLE' as const, message } });
    const lines = req.lines ?? [];
    const projections = await this.repo.listClaimProjections(ctx.companyId, req.id);
    const selected = new Set(selectedExpenseIds);
    const matched = projections.filter(projection => selected.has(projection.id) && projection.status !== 'VOIDED'
      && (projection.branchId ?? null) === (req.branchId ?? null)
      && lines.some(line => line.id === projection.sourceReimbursementLineId)
      && (!sourceLineIds || sourceLineIds.get(projection.id) === projection.sourceReimbursementLineId));
    if (matched.length !== selected.size) return unavailable('เปิดใบเบิกที่เซ็นแล้วไม่ได้');
    if (!lines.length || lines.some(line => !matched.some(projection => projection.sourceReimbursementLineId === line.id))) {
      return unavailable('ใบเบิกรวมรายการนอกชุดที่เลือก จึงไม่ได้รวมใบนี้');
    }
    if (req.status === 'DRAFT' || req.status === 'CANCELLED' || !req.requestNo) return unavailable('เปิดใบเบิกที่เซ็นแล้วไม่ได้');
    const copies = (await this.repo.listSignedClaimFormCopies(ctx.companyId, req.id))
      .filter(copy => copy.acknowledged && !copy.beforePayoutCorrection)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime() || a.attachmentId.localeCompare(b.attachmentId));
    const signed = documentSignedVia(req, copies.length > 0);
    if (copies.length) return { requestNo: req.requestNo, attachmentId: copies[0]!.attachmentId };
    if (signed !== 'DIGITAL') return { problem: { key: 'CLAIM_UNSIGNED' as const, message: 'ใบเบิกยังเซ็นไม่ครบ' } };
    if (options.render === false) return { requestNo: req.requestNo, mimeType: 'application/pdf' };
    const snapshot = await this.withAccountNumber(ctx, req, await this.buildSnapshot(ctx.companyId, req, true));
    const pdf = await PDFDocument.create();
    for (const svg of renderReimbursementClaimFormPages(snapshot)) {
      const source = await PDFDocument.load(await renderSubstituteReceiptPdf(svg, req.requestNo, { omitPageFooter: true }));
      for (const page of await pdf.copyPages(source, source.getPageIndices())) pdf.addPage(page);
    }
    const instant = options.exportedAt ?? new Date();
    pdf.setCreationDate(instant); pdf.setModificationDate(instant);
    return { requestNo: req.requestNo, mimeType: 'application/pdf', data: Buffer.from(await pdf.save()) };
  }

  async execute(ctx: RequestContext, requestId: string): Promise<ReimbursementClaimFormPreview> {
    const req = await this.repo.findRequestById(ctx.companyId, requestId, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // The claim's branch must be in the reader's scope, and the reader must hold `reimbursement.read`,
    // or `reimbursement.read_own` on their own claim, or `reimbursement.read_related` and be related to
    // it. Narrower than GET detail in one case: the detail also admits whoever the pending approval
    // step waits on after they lost every read permission; the print, like its route, does not.
    await assertCanReadRequest(ctx, req, this.repo);
    // The document number is what makes this a document. A draft never has one,
    // and neither does a claim cancelled straight out of DRAFT — printing either
    // would produce a form with a blank เลขที่เอกสาร.
    if (req.status === 'DRAFT' || !req.requestNo) throw new UnprocessableEntityException('claim_form_requires_submitted');

    // The number is asked for last: everything that can refuse this print has refused it by now, so a
    // row is written only for a print that goes on to carry the number.
    const snapshot = await this.withAccountNumber(ctx, req, await this.buildSnapshot(ctx.companyId, req));
    const svg = renderReimbursementClaimFormSvg(snapshot);
    const pages = renderReimbursementClaimFormPages(snapshot);
    return {
      svgDataUrl: `data:image/svg+xml;base64,${svg.toString('base64')}`,
      pageSvgDataUrls: pages.map((page) => `data:image/svg+xml;base64,${page.toString('base64')}`),
      checksumSha256: createHash('sha256').update(svg).digest('hex'),
    };
  }

  /**
   * Payout spec §17.1: whoever asked for THIS print gets the full account number when the "แสดงเลขบัญชี"
   * command would answer them. That command's own function decides (`claimPayoutRevealGroup`), nothing
   * the caller sends, and the print is recorded as that reveal is: one row, written before the decrypt,
   * saying the channel was the printed form. Anyone else who may read the claim gets the snapshot as it
   * was built, with the last 4 digits, and no row. The number goes to the renderer and nowhere else.
   * A form with no account line (cash, a legacy claim, the four-block form) asks nothing here.
   */
  private async withAccountNumber(
    ctx: RequestContext, req: ReimbursementRequestRecord, snapshot: ReimbursementClaimFormSnapshot,
  ): Promise<ReimbursementClaimFormSnapshot> {
    const payout = snapshot.payout;
    if (payout?.method !== 'BANK_TRANSFER') return snapshot;
    const group = await claimPayoutRevealGroup(ctx, req, this.repo);
    const secret = group && await this.repo.findClaimPayoutSecret(ctx.companyId, req.id, req.payoutDestinationVersion!);
    if (!secret) return snapshot;
    // No row, no number: the write is fail-closed and comes before the decrypt.
    const { accountNumberEncrypted, ...facts } = secret;
    await this.audit.logOrThrow({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payout.reveal',
      targetType: 'reimbursement_request', targetId: req.id, requestId: ctx.requestId, riskLevel: 'HIGH', result: 'SUCCESS',
      metadataJson: { group, channel: 'CLAIM_FORM_PRINT', ...facts },
    });
    return { ...snapshot, payout: { ...payout, accountNumber: openPayoutAccountNumber(accountNumberEncrypted, this.config.credentialEncryptionKey) } };
  }

  private async buildSnapshot(companyId: string, req: ReimbursementRequestRecord, verifySignatureImages = false): Promise<ReimbursementClaimFormSnapshot> {
    const steps = req.approvalSteps ?? [];
    const payments = req.payments ?? [];
    const lines = req.lines ?? [];
    // The approval the claim stands on and the latest non-voided payment are the ones that signed.
    // Nothing but this step feeds the ผู้อนุมัติ block, its signature and the same-person line, and it
    // is the claim's approver by the one rule the page, the reveal and the signing right ask
    // (`claimApprovalStep`): an approval of an earlier round, or one set aside because the claim's
    // payout account is being corrected (payout spec §14), is nobody's, and the block prints blank.
    const approvedStep = claimApprovalStep({ submittedAt: req.submittedAt, approvalSteps: steps });
    const correcting = !!payoutCorrectionPhase(req);
    const payment = payments
      .filter((row) => row.status === 'RECORDED')
      .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
      .at(-1);
    const financeReviewed = req.financeReviewStatus === 'APPROVED_FOR_PAYMENT' && !!req.financeReviewedAt
      ? req.financeReviewedByUserId
      : undefined;
    const policySnapshot = parseReimbursementPolicySnapshot(req.approvalPolicySnapshotJson);
    const layout = claimFormLayout(req.claimSignatures);
    // The claim's own frozen account version, masked: never the member's default account (invariant
    // I5). Not read for the four-block form, nor for a claim sent before claims carried one (spec
    // §15): those print as they always did, payment line included.
    // Nor while the account is being corrected: the form then says so instead of printing an account.
    const claimPayout = layout === 'TWO_SIGNERS' && hasPayoutSnapshot(req) && !correcting ? await this.repo.findClaimPayout(req) : undefined;
    const paidIntoVersion = claimPayout ? payment?.payoutDestinationVersion : undefined;

    const [company, names, signatureImages, paymentSlips, paymentDestinations] = await Promise.all([
      this.repo.getClaimFormCompanyContext(companyId, req.branchId ?? null),
      this.repo.getUserDisplayNames(companyId, [
        approvedStep?.decisionByUserId,
        financeReviewed,
        payment?.paidByUserId,
        claimPayout?.verifiedByUserId,
      ].filter((id): id is string => !!id)),
      this.loadSignatureImages(companyId, req.id, req.claimSignatures ?? [], verifySignatureImages),
      // The slips of the payment the form prints, read the way the claim page reads them.
      payment ? this.repo.listPaymentSlips(companyId, [payment.id]) : undefined,
      // The account that payment was confirmed into, from the version the payment itself stored.
      paidIntoVersion === undefined ? undefined : this.repo.listPaymentPayoutDestinations(companyId, req.id, [paidIntoVersion]),
    ]);
    // Spec §17.1: in a round the line reads what the claim waits for, for every reader, in the words of the
    // claim page's badge: by what the claim holds while it is with its requester, by what was answered while
    // it waits for approval. It carries no account, so nothing is decrypted for it and no reveal is recorded.
    const waitsFor = payoutCorrectionStatusLabel(req);
    const payout: ClaimFormPayout | undefined = waitsFor ? { method: 'CORRECTION_IN_PROGRESS', status: waitsFor } : claimFormPayout(claimPayout, names, req.requesterUserId);
    const paidInto = paidIntoVersion === undefined ? undefined : paymentDestinations?.[paidIntoVersion];
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
      layout,
      ...(payout && { payout }),
      repayment: payment
        ? {
            paidAt: payment.paidAt.toISOString(),
            method: payment.paymentMethod,
            reference: payment.paymentReference ?? null,
            recordedByName: names[payment.paidByUserId] ?? payment.paidByUserId,
            ...(paidInto && { paidInto: { kind: paidInto.payoutKind, accountLast4: paidInto.accountLast4 } }),
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
    verifyRenderable = false,
  ): Promise<Partial<Record<ReimbursementClaimSignatureRole, string>>> {
    const loaded: [ReimbursementClaimSignatureRole, string][] = [];
    for (const signature of signatures) {
      try {
        const image = await loadOwnedClaimSignature(
          this.repo, this.storage, companyId, signature.signatureAttachmentId,
          signature.signedByUserId, requestId, signature.role,
        );
        if (verifyRenderable) await sharp(Buffer.from(image.dataUrl.split(',')[1]!, 'base64'), { limitInputPixels: SUBSTITUTE_RECEIPT_PDF_LIMITS.maxRasterPixels }).raw().toBuffer();
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

/** The claim's masked payout record in the form's terms. Nothing it is given carries the full number. */
function claimFormPayout(payout: ClaimPayoutRecord | undefined, names: Record<string, string>, requesterUserId: string): ClaimFormPayout | undefined {
  if (payout?.payoutMethod === 'CASH') return { method: 'CASH' };
  // A sent claim paid by transfer always has its frozen row; without one there is no line to print.
  if (payout?.payoutMethod !== 'BANK_TRANSFER' || !payout.payoutKind || !payout.accountName || !payout.accountLast4) return undefined;
  const at = payout.verifiedAt?.toISOString();
  return {
    method: 'BANK_TRANSFER', kind: payout.payoutKind, bankName: payout.bankName ?? null,
    accountName: payout.accountName, accountLast4: payout.accountLast4,
    ...maskedPayoutHolderFacts(payout),
    // The same test the claim page makes: an attestation by the requester is their own confirmation
    // (spec §10.2), not a check by someone else, and is printed as such.
    verifier: !payout.verifiedByUserId || !at ? null
      : payout.verifiedByUserId === requesterUserId ? { byRequester: true, at }
        : { name: names[payout.verifiedByUserId] ?? payout.verifiedByUserId, at },
  };
}
