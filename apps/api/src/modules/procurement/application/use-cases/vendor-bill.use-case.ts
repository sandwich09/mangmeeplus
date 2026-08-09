import { Injectable, ForbiddenException, NotFoundException, BadRequestException, UnprocessableEntityException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { CancelDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/cancel-document-number.use-case';
import { canTransitionVB, matchLine, buildTaxReviewIssues, d, decStr, round2, vendorBillTaxSourceChecksum, PROCUREMENT_APPROVAL_POLICY_DEFAULTS, canSelfApprove } from '../../domain/logic/procurement.logic';
import { civilPeriodKey, coerceCivilDate, LEDGER_SEQUENCE_KEY, PROCUREMENT_SEQUENCE_KEYS, todayCivilDate } from '@watchdog-bms/contracts';
import type { VendorBillRecord } from '../../domain/models/procurement.model';
import type { ResolveTransactionTaxPreviewDto, TaxEvidenceReviewStatus, TransactionTaxContext } from '@watchdog-bms/contracts';
import { TransactionTaxConfigUseCase } from '../../../tax/application/use-cases/transaction-tax-config.use-case';
import { assertProcurementBranchScope, PROCUREMENT_RELATED_READ_PERMISSIONS } from './procurement-access';

function requiresClaimableDomesticVatEvidence(bill: VendorBillRecord): boolean {
  return (bill.lines ?? []).some((line) => {
    if (Number(line.vatAmount) <= 0) return false;
    const context = line.taxSnapshot?.taxContext ?? (bill.pp36Candidate ? undefined : 'DOMESTIC_PURCHASE');
    const claimability = line.taxSnapshot?.claimability ?? (line.inputVatClaimStatus === 'NON_CLAIMABLE' ? 'NON_CLAIMABLE' : 'CLAIMABLE');
    return context === 'DOMESTIC_PURCHASE' && ['CLAIMABLE', 'PENDING_EVIDENCE'].includes(claimability);
  });
}

async function assessVendorBillTaxEvidence(
  repo: PrismaProcurementRepository,
  bill: VendorBillRecord,
  reviewStatus: TaxEvidenceReviewStatus = bill.taxEvidenceReviewStatus ?? 'DRAFT',
) {
  const required = requiresClaimableDomesticVatEvidence(bill);
  const supplier = required ? await repo.findSupplierById(bill.companyId, bill.supplierId) : undefined;
  const attachmentActive = required ? await repo.isActiveVendorBillAttachment(bill.companyId, bill.attachmentId, bill.branchId) : false;
  const issues = buildTaxReviewIssues({
    taxId: supplier?.taxId,
    vatRegistered: supplier?.vatRegistered,
    taxInvoiceNumber: bill.taxInvoiceNumber,
    taxInvoiceDate: bill.taxInvoiceDate,
    attachmentActive,
    vatAmount: bill.vatAmount,
    whtCategoryCode: bill.whtCategoryCode,
    whtRate: bill.whtRate,
    pp36Candidate: bill.pp36Candidate,
    inputVatClaimStatus: bill.inputVatClaimStatus,
    taxEvidenceRequired: required,
    taxEvidenceReviewStatus: reviewStatus,
  });
  return { required, issues, reviewStatus };
}

async function persistVendorBillTaxEvidenceAssessment(
  repo: PrismaProcurementRepository,
  bill: VendorBillRecord,
  actorUserId: string,
  assessment: Awaited<ReturnType<typeof assessVendorBillTaxEvidence>>,
) {
  const keepExistingReviewer = bill.taxEvidenceReviewStatus === assessment.reviewStatus && bill.taxEvidenceReviewedByUserId;
  return repo.updateVendorBillTaxEvidenceState(bill.companyId, bill.id, {
    taxInvoiceNumber: bill.taxInvoiceNumber,
    taxInvoiceDate: bill.taxInvoiceDate,
    attachmentId: bill.attachmentId,
    taxEvidenceRequired: assessment.required,
    taxEvidenceReviewStatus: assessment.reviewStatus,
    reviewIssues: assessment.issues,
    taxEvidenceReviewedByUserId: assessment.reviewStatus === 'VERIFIED' || assessment.reviewStatus === 'REJECTED' ? keepExistingReviewer || actorUserId : null,
    taxEvidenceReviewedAt: assessment.reviewStatus === 'VERIFIED' || assessment.reviewStatus === 'REJECTED' ? keepExistingReviewer ? bill.taxEvidenceReviewedAt ?? new Date() : new Date() : null,
    updatedByUserId: actorUserId,
  });
}

async function assertVendorBillTaxEvidenceReady(repo: PrismaProcurementRepository, bill: VendorBillRecord, actorUserId: string) {
  if (!requiresClaimableDomesticVatEvidence(bill)) return bill;
  const assessment = await assessVendorBillTaxEvidence(repo, bill);
  const assessedBill = assessment.required || assessment.issues.length
    ? await persistVendorBillTaxEvidenceAssessment(repo, bill, actorUserId, assessment)
    : bill;
  if (assessment.required && assessment.issues.length) {
    throw new UnprocessableEntityException({
      code: 'vendor_bill_tax_evidence_blocked',
      message: 'Claimable domestic VAT requires complete supplier tax-invoice evidence and a verified review before submit or approval.',
      blockers: assessment.issues,
    });
  }
  return assessedBill;
}

@Injectable()
export class CreateVendorBillUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly transactionTax: TransactionTaxConfigUseCase,
  ) {}

  async execute(ctx: RequestContext, dto: {
    supplierId: string; branchId?: string; purchaseOrderId?: string; goodsReceiptId?: string;
    billDate: Date; dueDate: Date; receivedDate?: Date; paymentTermsDays?: number;
    currency?: string; vatMode?: string; supplierDocumentNumber?: string;
    taxInvoiceNumber?: string; taxInvoiceDate?: Date; whtCategoryCode?: string; whtRate?: string;
    pp36Candidate?: boolean; attachmentId?: string;
    subtotalAmount?: string; discountAmount?: string; taxableAmount?: string; vatAmount?: string;
    inputVatClaimStatus?: string; whtAmount?: string; grandTotalAmount?: string; netPayableAmount?: string;
    supplierSnapshotJson?: Record<string, unknown>;
    matchingMode?: string;
    lines: { lineNumber: number; lineType?: string; productId?: string; description: string; unitName?: string; quantity: string; unitPrice: string; discountAmount?: string; vatMode?: string; vatRate?: string; vatAmount?: string; inputVatClaimStatus?: string; whtCategoryCode?: string; whtRate?: string; whtAmount?: string; lineSubtotalAmount?: string; lineTotalAmount?: string; accountHint?: string; assetCandidate?: boolean; purchaseOrderLineId?: string; taxCodeDefinitionId?: string; externalTaxCode?: string; transactionContext?: TransactionTaxContext; evidenceRefs?: string[]; authoritativeCustomsValue?: string; authoritativeDutyAmount?: string; authoritativeExciseAmount?: string; authoritativeOtherTaxAmount?: string; authoritativeImportVatAmount?: string }[];
  }): Promise<VendorBillRecord> {
    if (!ctx.permissions.includes('procurement.vendor_bill.create')) throw new ForbiddenException();
    if (!dto.purchaseOrderId && !ctx.permissions.includes('procurement.vendor_bill.direct_entry')) throw new ForbiddenException();

    const supplier = await this.repo.findSupplierById(ctx.companyId, dto.supplierId);
    if (!supplier) throw new BadRequestException('Supplier does not exist in this company');
    if (supplier.status !== 'ACTIVE') throw new BadRequestException('Supplier is not active');
    const purchaseOrder = dto.purchaseOrderId ? await this.repo.findPurchaseOrderById(ctx.companyId, dto.purchaseOrderId) : null;
    if (dto.purchaseOrderId && !purchaseOrder) throw new BadRequestException('Purchase order does not exist in this company');
    if (purchaseOrder && purchaseOrder.supplierId !== dto.supplierId) throw new BadRequestException('Purchase order does not belong to this supplier');
    if (purchaseOrder && !['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'PARTIALLY_BILLED'].includes(purchaseOrder.status)) throw new BadRequestException('Purchase order is not open for vendor billing');
    if (purchaseOrder && purchaseOrder.currency !== (dto.currency ?? 'THB')) throw new BadRequestException('Purchase order currency does not match the vendor bill currency');
    const goodsReceipt = dto.goodsReceiptId ? await this.repo.findGoodsReceiptById(ctx.companyId, dto.goodsReceiptId) : null;
    if (dto.goodsReceiptId && !goodsReceipt) throw new BadRequestException('Goods receipt does not exist in this company');
    if (goodsReceipt && goodsReceipt.supplierId !== dto.supplierId) throw new BadRequestException('Goods receipt does not belong to this supplier');
    if (goodsReceipt && goodsReceipt.status !== 'POSTED') throw new BadRequestException('Goods receipt must be POSTED before vendor billing');
    if (goodsReceipt && (!purchaseOrder || goodsReceipt.purchaseOrderId !== purchaseOrder.id)) throw new BadRequestException('Goods receipt does not belong to the referenced purchase order');

    const referenceBranchId = purchaseOrder?.branchId ?? goodsReceipt?.branchId;
    const branchId = dto.branchId ?? referenceBranchId;
    if (purchaseOrder && (purchaseOrder.branchId ?? null) !== (branchId ?? null)) throw new BadRequestException('Purchase order branch does not match the vendor bill branch');
    if (goodsReceipt && (goodsReceipt.branchId ?? null) !== (branchId ?? null)) throw new BadRequestException('Goods receipt branch does not match the vendor bill branch');
    if (branchId) {
      if (ctx.scopes?.branchIds && !ctx.scopes.branchIds.includes(branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
      if (!await this.repo.branchExists(ctx.companyId, branchId)) throw new BadRequestException('Branch does not exist in this company');
    } else if (ctx.scopes?.branchIds) {
      throw new ForbiddenException('A branch-scoped user must create the vendor bill in an assigned branch.');
    }
    if (dto.attachmentId && !await this.repo.isActiveVendorBillAttachment(ctx.companyId, dto.attachmentId, branchId)) {
      throw new UnprocessableEntityException({ code: 'vendor_bill_tax_attachment_invalid', message: 'Tax-invoice attachment must be active, company-owned, and inside the vendor bill branch scope.' });
    }
    if (purchaseOrder) {
      const purchaseOrderLineIds = new Set((purchaseOrder.lines ?? []).map((line) => line.id));
      if (dto.lines.some((line) => line.purchaseOrderLineId && !purchaseOrderLineIds.has(line.purchaseOrderLineId))) {
        throw new BadRequestException('Vendor bill line references a purchase-order line outside the referenced purchase order');
      }
    } else if (dto.lines.some((line) => line.purchaseOrderLineId)) {
      throw new BadRequestException('Direct vendor bill lines cannot reference purchase-order lines');
    }
    const trustedDto = {
      ...dto,
      branchId,
      matchingMode: purchaseOrder ? dto.matchingMode ?? purchaseOrder.matchingMode : 'NONE',
    };

    const preparedLines = [];
    const transactionContexts = new Set<TransactionTaxContext>();
    for (const raw of trustedDto.lines) {
      const quantity = raw.quantity || '1';
      const unitPrice = raw.unitPrice || '0';
      const discountAmount = raw.discountAmount ?? '0';
      const commercialAmount = round2(d(quantity).mul(unitPrice).minus(discountAmount));
      const context = raw.transactionContext ?? (trustedDto.pp36Candidate ? 'IMPORT_SERVICE' : 'DOMESTIC_PURCHASE');
      transactionContexts.add(context);
      const preview = raw.taxCodeDefinitionId || raw.externalTaxCode ? await this.transactionTax.resolveSourceTax(ctx, {
        branchId: trustedDto.branchId, sourceType: 'procurement.vendor_bill', sourceId: `draft:${ctx.requestId ?? ctx.userId}`, sourceLineId: `line:${raw.lineNumber}`,
        transactionContext: context, documentDate: trustedDto.billDate.toISOString(), currency: trustedDto.currency ?? 'THB',
        taxCodeDefinitionId: raw.taxCodeDefinitionId, externalTaxCode: raw.externalTaxCode,
        netAmount: decStr(commercialAmount), grossAmount: decStr(commercialAmount),
      }, 'DRAFT', undefined, context === 'IMPORT_SERVICE' ? 'SELF_ASSESSED' : 'INPUT', 'procurement') : undefined;
      preparedLines.push(authoritativeVendorBillLine(raw, preview, context));
    }
    if (transactionContexts.has('IMPORT_SERVICE') && transactionContexts.size > 1) {
      throw new BadRequestException({ code: 'pp36_mixed_context_not_supported', message: 'Imported-service PP36 lines must be placed on a separate vendor bill.' });
    }
    // §19d: recorded money is satang — re-round the document total sums.
    const subtotal = round2(preparedLines.reduce((sum, line) => sum.add(line.lineSubtotalAmount), d(0)));
    const discount = round2(preparedLines.reduce((sum, line) => sum.add(line.discountAmount), d(0)));
    const vat = round2(preparedLines.reduce((sum, line) => sum.add(line.vatAmount), d(0)));
    const wht = round2(preparedLines.reduce((sum, line) => sum.add(line.whtAmount), d(0)));
    const grand = round2(preparedLines.reduce((sum, line) => sum.add(line.lineTotalAmount), d(0)));
    const normalizedDto = {
      ...trustedDto, lines: preparedLines, subtotalAmount: decStr(subtotal), discountAmount: decStr(discount),
      taxableAmount: decStr(subtotal), vatAmount: decStr(vat), whtAmount: decStr(wht),
      grandTotalAmount: decStr(grand), netPayableAmount: decStr(round2(grand.minus(wht))),
    };
    let bill = await this.repo.createVendorBill(ctx.companyId, normalizedDto, ctx.userId);
    try {
      const snapshots = [];
      for (const line of bill.lines ?? []) {
        const selected = trustedDto.lines.find((candidate) => candidate.lineNumber === line.lineNumber);
        if (!selected?.taxCodeDefinitionId && !selected?.externalTaxCode) continue;
        const context = selected.transactionContext ?? (trustedDto.pp36Candidate ? 'IMPORT_SERVICE' : 'DOMESTIC_PURCHASE');
        snapshots.push({ lineId: line.id, preview: await this.transactionTax.resolveSourceTax(ctx, {
          branchId: trustedDto.branchId, sourceType: 'procurement.vendor_bill', sourceId: bill.id, sourceLineId: line.id,
          transactionContext: context, documentDate: trustedDto.billDate.toISOString(), currency: trustedDto.currency ?? 'THB',
          taxCodeDefinitionId: selected.taxCodeDefinitionId, externalTaxCode: selected.externalTaxCode,
          netAmount: line.lineSubtotalAmount, grossAmount: line.lineTotalAmount,
          enteredTaxAmount: ['IMPORT_SERVICE', 'IMPORT_GOODS'].includes(context) ? undefined : line.vatAmount,
          evidenceRefs: selected.evidenceRefs,
          authoritativeCustomsValue: selected.authoritativeCustomsValue, authoritativeDutyAmount: selected.authoritativeDutyAmount,
          authoritativeExciseAmount: selected.authoritativeExciseAmount, authoritativeOtherTaxAmount: selected.authoritativeOtherTaxAmount,
          authoritativeImportVatAmount: selected.authoritativeImportVatAmount,
        }, 'DRAFT', undefined, context === 'IMPORT_SERVICE' ? 'SELF_ASSESSED' : 'INPUT', 'procurement') });
      }
      if (snapshots.length) {
        await this.repo.saveVendorBillLineTaxSnapshots(ctx.companyId, bill.id, snapshots);
        bill = await this.repo.findVendorBillById(ctx.companyId, bill.id) ?? bill;
      }
    } catch (error) {
      await this.repo.deleteDraftVendorBill(ctx.companyId, bill.id);
      throw error;
    }

    const domesticEvidenceRequired = requiresClaimableDomesticVatEvidence(bill);
    const assessment = domesticEvidenceRequired ? await assessVendorBillTaxEvidence(this.repo, bill, 'REVIEW_REQUIRED') : undefined;
    const issues = assessment?.issues ?? buildTaxReviewIssues({ taxId: supplier.taxId, taxInvoiceNumber: trustedDto.taxInvoiceNumber, taxInvoiceDate: trustedDto.taxInvoiceDate, vatAmount: normalizedDto.vatAmount, whtCategoryCode: trustedDto.whtCategoryCode, whtRate: trustedDto.whtRate, pp36Candidate: trustedDto.pp36Candidate ?? false, inputVatClaimStatus: trustedDto.inputVatClaimStatus ?? 'NEEDS_REVIEW' });
    if (assessment) bill = await persistVendorBillTaxEvidenceAssessment(this.repo, bill, ctx.userId, assessment);
    if (issues.length > 0) {
      bill = await this.repo.updateVendorBillStatus(ctx.companyId, bill.id, 'NEEDS_REVIEW', { updatedByUserId: ctx.userId });
    }

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.vendor_bill.create', targetType: 'vendor_bill', targetId: bill.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { supplierId: trustedDto.supplierId, purchaseOrderId: trustedDto.purchaseOrderId, directEntry: !trustedDto.purchaseOrderId, grandTotalAmount: normalizedDto.grandTotalAmount, reviewIssues: issues } });
    return bill;
  }
}

@Injectable()
export class GetVendorBillUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<VendorBillRecord> {
    const canReadAll = ctx.permissions.includes('procurement.vendor_bill.read');
    const canReadRelated = ctx.permissions.includes(PROCUREMENT_RELATED_READ_PERMISSIONS.VENDOR_BILL);
    if (!canReadAll && !canReadRelated) throw new ForbiddenException();
    const bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!canReadAll && !await this.repo.isProcurementDocumentRelatedToUser(ctx.companyId, 'VENDOR_BILL', id, ctx.userId, ctx.scopes ?? {})) throw new ForbiddenException();
    return bill;
  }
}

@Injectable()
export class UpdateVendorBillTaxEvidenceUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, dto: { taxInvoiceNumber: string; taxInvoiceDate: Date; attachmentId: string }): Promise<VendorBillRecord> {
    if (!ctx.permissions.includes('procurement.vendor_bill.create')) throw new ForbiddenException();
    const bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!['DRAFT', 'NEEDS_REVIEW'].includes(bill.status)) throw new BadRequestException(`Cannot edit tax evidence from status ${bill.status}`);
    if (!requiresClaimableDomesticVatEvidence(bill)) throw new UnprocessableEntityException({ code: 'vendor_bill_tax_evidence_not_required', message: 'This vendor bill has no claimable domestic VAT line.' });
    const taxInvoiceNumber = dto.taxInvoiceNumber?.trim();
    if (!taxInvoiceNumber || !(dto.taxInvoiceDate instanceof Date) || Number.isNaN(dto.taxInvoiceDate.getTime()) || !dto.attachmentId) {
      throw new UnprocessableEntityException({ code: 'vendor_bill_tax_evidence_incomplete', message: 'Tax invoice number, date, and attachment are required.' });
    }
    if (!await this.repo.isActiveVendorBillAttachment(ctx.companyId, dto.attachmentId, bill.branchId)) {
      throw new UnprocessableEntityException({ code: 'vendor_bill_tax_attachment_invalid', message: 'Tax-invoice attachment must be active, company-owned, and inside the vendor bill branch scope.' });
    }
    const candidate = { ...bill, taxInvoiceNumber, taxInvoiceDate: dto.taxInvoiceDate, attachmentId: dto.attachmentId };
    const assessment = await assessVendorBillTaxEvidence(this.repo, candidate, 'REVIEW_REQUIRED');
    let updated = await persistVendorBillTaxEvidenceAssessment(this.repo, candidate, ctx.userId, assessment);
    if (updated.status === 'DRAFT') updated = await this.repo.updateVendorBillStatus(ctx.companyId, id, 'NEEDS_REVIEW', { updatedByUserId: ctx.userId });
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.vendor_bill.tax_evidence.update', targetType: 'vendor_bill', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { attachmentId: dto.attachmentId, reviewIssues: assessment.issues } });
    return updated;
  }
}

@Injectable()
export class ReviewVendorBillTaxEvidenceUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, status: 'VERIFIED' | 'REJECTED'): Promise<VendorBillRecord> {
    if (!ctx.permissions.includes('procurement.vendor_bill.approve')) throw new ForbiddenException();
    const bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!['DRAFT', 'NEEDS_REVIEW'].includes(bill.status)) throw new BadRequestException(`Cannot review tax evidence from status ${bill.status}`);
    if (!requiresClaimableDomesticVatEvidence(bill)) throw new UnprocessableEntityException({ code: 'vendor_bill_tax_evidence_not_required', message: 'This vendor bill has no claimable domestic VAT line.' });
    if (!['VERIFIED', 'REJECTED'].includes(status)) throw new BadRequestException('Tax evidence review status must be VERIFIED or REJECTED');
    if (status === 'VERIFIED' && bill.taxEvidenceReviewStatus === 'REJECTED') {
      throw new UnprocessableEntityException({ code: 'vendor_bill_tax_evidence_rejected', message: 'Rejected tax evidence must be updated before it can be verified.' });
    }
    if (status === 'VERIFIED') {
      // H-07: the maker cannot verify their own bill's tax evidence — the
      // approval path trusts VERIFIED as an independently reviewed fact.
      // Same OWNER/ADMIN/MANAGER exemption as the approve seam.
      const policy = await this.repo.getProcurementApprovalPolicy(ctx.companyId);
      if (!canSelfApprove(ctx.roles, policy?.allowSelfApproval ?? PROCUREMENT_APPROVAL_POLICY_DEFAULTS.allowSelfApproval)) {
        const trail = await this.repo.listPurchaseApprovalEvents(ctx.companyId, 'VENDOR_BILL', id);
        const lastSubmit = [...trail].reverse().find((event) => event.action === 'SUBMITTED');
        const makerUserId = lastSubmit?.actorUserId ?? bill.createdByUserId;
        if (ctx.userId === makerUserId) {
          throw new ForbiddenException({ code: 'vendor_bill_self_evidence_verify_blocked', message: 'The maker of a vendor bill cannot verify its own tax evidence. A different reviewer is required.' });
        }
      }
    }

    const assessment = await assessVendorBillTaxEvidence(this.repo, bill, status);
    if (status === 'VERIFIED' && assessment.issues.length) {
      const blocked = await assessVendorBillTaxEvidence(this.repo, bill, 'REVIEW_REQUIRED');
      await persistVendorBillTaxEvidenceAssessment(this.repo, bill, ctx.userId, blocked);
      throw new UnprocessableEntityException({
        code: 'vendor_bill_tax_evidence_blocked',
        message: 'Tax evidence cannot be verified while required supplier or tax-invoice evidence is incomplete.',
        blockers: assessment.issues,
      });
    }
    const updated = await persistVendorBillTaxEvidenceAssessment(this.repo, bill, ctx.userId, assessment);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: `procurement.vendor_bill.tax_evidence.${status.toLowerCase()}`, targetType: 'vendor_bill', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { status, reviewIssues: assessment.issues } });
    return updated;
  }
}

@Injectable()
export class ListVendorBillsUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, filter: { status?: string; supplierId?: string; purchaseOrderId?: string; matchingStatus?: string; postingStatus?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number }): Promise<{ data: VendorBillRecord[]; total: number; page: number; pageSize: number }> {
    const canReadAll = ctx.permissions.includes('procurement.vendor_bill.read');
    const canReadRelated = ctx.permissions.includes(PROCUREMENT_RELATED_READ_PERMISSIONS.VENDOR_BILL);
    if (!canReadAll && !canReadRelated) throw new ForbiddenException();
    const { data, total } = await this.repo.listVendorBills(ctx.companyId, {
      ...filter, ...(!canReadAll ? { relatedUserId: ctx.userId } : {}),
    }, ctx.scopes ?? {});
    return { data, total, page: filter.page ?? 1, pageSize: filter.pageSize ?? 20 };
  }
}

@Injectable()
export class MatchVendorBillUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string): Promise<VendorBillRecord> {
    if (!ctx.permissions.includes('procurement.vendor_bill.match')) throw new ForbiddenException();
    const bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!bill.purchaseOrderId) {
      await this.repo.updateVendorBillMatchingStatus(ctx.companyId, id, 'NOT_REQUIRED', '0');
      return this.repo.findVendorBillById(ctx.companyId, id) as Promise<VendorBillRecord>;
    }

    const po = await this.repo.findPurchaseOrderById(ctx.companyId, bill.purchaseOrderId);
    if (!po) throw new BadRequestException('Referenced purchase order not found');

    const gr = bill.goodsReceiptId ? await this.repo.findGoodsReceiptById(ctx.companyId, bill.goodsReceiptId) : null;

    let overallVariance = 0;
    let anyNotMatched = false;
    let anyVariance = false;

    for (const billLine of bill.lines ?? []) {
      if (!billLine.purchaseOrderLineId) continue;
      const poLine = po.lines?.find((l) => l.id === billLine.purchaseOrderLineId);
      if (!poLine) continue;
      const grLine = gr?.lines?.find((l) => l.purchaseOrderLineId === billLine.purchaseOrderLineId);
      const result = matchLine({
        poQuantity: poLine.orderedQuantity, poUnitPrice: poLine.unitPrice,
        billQuantity: billLine.quantity, billUnitPrice: billLine.unitPrice,
        grAcceptedQuantity: grLine?.acceptedQuantity,
        lineType: billLine.lineType,
        matchingMode: bill.matchingMode as any,
      });
      overallVariance += Number(result.amountVariance);
      if (result.status === 'NOT_MATCHED') anyNotMatched = true;
      if (result.status === 'MATCHED_WITH_VARIANCE') anyVariance = true;
    }

    const matchingStatus = anyNotMatched ? 'NOT_MATCHED' : anyVariance ? 'MATCHED_WITH_VARIANCE' : 'MATCHED';
    const updated = await this.repo.updateVendorBillMatchingStatus(ctx.companyId, id, matchingStatus, String(overallVariance));
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.vendor_bill.match', targetType: 'vendor_bill', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { matchingStatus, varianceAmount: overallVariance } });
    return updated;
  }
}

@Injectable()
export class OverrideVendorBillMatchUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, overrideReason: string): Promise<VendorBillRecord> {
    if (!ctx.permissions.includes('procurement.vendor_bill.match.override')) throw new ForbiddenException();
    const bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!['NOT_MATCHED', 'MATCHED_WITH_VARIANCE', 'BLOCKED'].includes(bill.matchingStatus)) {
      throw new BadRequestException(`Cannot override matching status ${bill.matchingStatus}`);
    }
    const updated = await this.repo.overrideVendorBillMatch(ctx.companyId, id, overrideReason, ctx.userId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.vendor_bill.match.override', targetType: 'vendor_bill', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { overrideReason } });
    return updated;
  }
}

@Injectable()
export class SubmitVendorBillUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<VendorBillRecord> {
    if (!ctx.permissions.includes('procurement.vendor_bill.create')) throw new ForbiddenException();
    let bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!canTransitionVB(bill.status, 'PENDING_APPROVAL')) throw new BadRequestException(`Cannot submit from status ${bill.status}`);
    bill = await assertVendorBillTaxEvidenceReady(this.repo, bill, ctx.userId);

    const now = new Date();
    const periodKey = civilPeriodKey(todayCivilDate(undefined, now));
    const reserved = await this.reserveNumber.execute({ companyId: ctx.companyId, documentType: PROCUREMENT_SEQUENCE_KEYS.VENDOR_BILL, periodKey, reservedByUserId: ctx.userId, idempotencyKey: `submit:${id}` });

    // H-07: record the submitter BEFORE the status change. A stray SUBMITTED
    // event on a still-DRAFT bill is harmless, but a PENDING_APPROVAL bill
    // with no SUBMITTED event would misattribute the submitter to the creator
    // and could re-open self-approval for the real submitter.
    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'VENDOR_BILL', id, 'SUBMITTED', ctx.userId);
    const updated = await this.repo.updateVendorBillStatus(ctx.companyId, id, 'PENDING_APPROVAL', { vendorBillNumber: reserved.documentNumber, updatedByUserId: ctx.userId });
    await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'vendor_bill', ownerId: id }, ctx.userId);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.vendor_bill.submit', targetType: 'vendor_bill', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { vendorBillNumber: reserved.documentNumber } });
    void this.outbox.append('vendor_bill.submitted', 'vendor_bill', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'vendor_bill', aggregateId: id, occurredAt: now.toISOString(), data: { billId: id, vendorBillNumber: reserved.documentNumber, status: 'PENDING_APPROVAL', grandTotalAmount: bill.grandTotalAmount } });
    return updated;
  }
}

@Injectable()
export class ApproveVendorBillUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService, private readonly transactionTax: TransactionTaxConfigUseCase) {}

  async execute(ctx: RequestContext, id: string, note?: string): Promise<VendorBillRecord> {
    if (!ctx.permissions.includes('procurement.vendor_bill.approve')) throw new ForbiddenException();
    let bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!canTransitionVB(bill.status, 'APPROVED')) throw new BadRequestException(`Cannot approve from status ${bill.status}`);
    bill = await assertVendorBillTaxEvidenceReady(this.repo, bill, ctx.userId);

    if (bill.matchingMode !== 'NONE' && !['MATCHED', 'NOT_REQUIRED', 'OVERRIDDEN'].includes(bill.matchingStatus)) {
      throw new BadRequestException(`Bill matching status is ${bill.matchingStatus}. Resolve matching before approval.`);
    }
    if ((bill.lines ?? []).some((line) => (Number(line.vatAmount) !== 0 || bill.pp36Candidate) && (!line.taxSnapshot || !line.taxComponents?.length))) {
      throw new BadRequestException('Every VAT/PP36 vendor-bill line requires a server-resolved Tax Code snapshot before approval.');
    }

    // H-07 maker-checker: the submitter of the current approval round cannot
    // approve their own bill (unless company policy explicitly allows it), and
    // bills at or above the dual-approval threshold need two approvers other
    // than the submitter.
    const [policy, trail] = await Promise.all([
      this.repo.getProcurementApprovalPolicy(ctx.companyId),
      this.repo.listPurchaseApprovalEvents(ctx.companyId, 'VENDOR_BILL', id),
    ]);
    const lastSubmitIndex = trail.map((event) => event.action).lastIndexOf('SUBMITTED');
    // Bills submitted before approval events existed fall back to the creator.
    const submitterUserId = lastSubmitIndex >= 0 ? trail[lastSubmitIndex]!.actorUserId : bill.createdByUserId;
    const allowSelfApprovalPolicy = policy?.allowSelfApproval ?? PROCUREMENT_APPROVAL_POLICY_DEFAULTS.allowSelfApproval;
    // OWNER/ADMIN/MANAGER may self-approve without a policy override — small
    // companies run on these roles doing everything (product decision).
    const allowSelfApproval = canSelfApprove(ctx.roles, allowSelfApprovalPolicy);
    if (!allowSelfApproval && ctx.userId === submitterUserId) {
      throw new ForbiddenException({ code: 'vendor_bill_self_approval_blocked', message: 'The submitter of a vendor bill cannot approve it. A different approver is required.' });
    }
    const dualThreshold = policy?.dualApprovalThresholdAmount ?? PROCUREMENT_APPROVAL_POLICY_DEFAULTS.dualApprovalThresholdAmount;
    const requiredApprovers = dualThreshold != null && d(bill.grandTotalAmount).gte(d(dualThreshold)) ? 2 : 1;
    // Approvals are pinned to the exact bill content they were given for: an
    // APPROVED event whose snapshot checksum differs (content edited after a
    // reject→resubmit, or an append that raced a resubmit into the new round)
    // never counts toward the quota.
    const sourceChecksum = vendorBillTaxSourceChecksum(bill);
    const priorApprovers = new Set(
      trail.slice(lastSubmitIndex + 1)
        .filter((event) => event.action === 'APPROVED' && (event.thresholdSnapshotJson as { sourceChecksum?: string } | undefined)?.sourceChecksum === sourceChecksum)
        .map((event) => event.actorUserId),
    );
    // The submitter never counts toward the dual-approval quota, even when
    // self-approval is allowed — the threshold promises two independent checkers.
    priorApprovers.delete(submitterUserId);
    const thresholdSnapshot = {
      requiredApprovers, dualApprovalThresholdAmount: dualThreshold,
      allowSelfApproval: allowSelfApprovalPolicy, selfApprovalRoleExempt: allowSelfApproval && !allowSelfApprovalPolicy,
      grandTotalAmount: bill.grandTotalAmount, submitterUserId, sourceChecksum,
      approvers: [...new Set([...priorApprovers, ctx.userId])],
    };
    const approvalAuditBase = { supplierId: bill.supplierId, netPayableAmount: bill.netPayableAmount, submitterUserId, sourceChecksum, selfApproved: ctx.userId === submitterUserId };
    if (requiredApprovers > 1) {
      if (ctx.userId === submitterUserId) {
        // Reachable only when allowSelfApproval=true: self-approval covers
        // single-approver bills, never the dual-approval quota.
        throw new ConflictException({ code: 'vendor_bill_dual_approval_pending', message: 'Bills at or above the dual-approval threshold need two approvers other than the submitter.' });
      }
      const approversWithCurrent = new Set([...priorApprovers, ctx.userId]);
      if (approversWithCurrent.size < requiredApprovers) {
        if (priorApprovers.has(ctx.userId)) {
          throw new ConflictException({ code: 'vendor_bill_dual_approval_pending', message: 'You already approved this bill. A second, different approver is required by the dual-approval policy.' });
        }
        await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'VENDOR_BILL', id, 'APPROVED', ctx.userId, note, thresholdSnapshot);
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.vendor_bill.approve', targetType: 'vendor_bill', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { ...approvalAuditBase, dualApproval: { recorded: approversWithCurrent.size, required: requiredApprovers, final: false } } });
        // submitterUserId + approverUserIds let the second-approval workflow
        // template notify the remaining eligible approvers and nobody else.
        void this.outbox.append('vendor_bill.approval_recorded', 'vendor_bill', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'vendor_bill', aggregateId: id, occurredAt: new Date().toISOString(), data: { billId: id, vendorBillNumber: bill.vendorBillNumber ?? null, status: bill.status, grandTotalAmount: bill.grandTotalAmount, recordedApprovers: approversWithCurrent.size, requiredApprovers, submitterUserId, approverUserIds: [...approversWithCurrent] } });
        return bill;
      }
    }

    const now = new Date();
    const { bill: updated, finalized } = await this.repo.finalizeVendorBillApprovalCas({
      companyId: ctx.companyId,
      id,
      expectedStatus: 'PENDING_APPROVAL',
      expectedUpdatedAt: bill.updatedAt,
      expectedSourceChecksum: vendorBillTaxSourceChecksum(bill),
      actorUserId: ctx.userId,
      approvedAt: now,
    }, async ({ db, bill: current }) => {
      // H-07: re-derive the dual-approval quota inside the Serializable
      // transaction — the pre-read trail may be stale by finalize time. The
      // CAS has already pinned the content (expectedSourceChecksum), so only
      // approvals of exactly this content count.
      if (requiredApprovers > 1) {
        const events = await db.purchaseApprovalEvent.findMany({
          where: { companyId: ctx.companyId, sourceType: 'VENDOR_BILL', sourceId: id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const submitIndex = events.map((event: { action: string }) => event.action).lastIndexOf('SUBMITTED');
        const roundSubmitter = submitIndex >= 0 ? events[submitIndex].actorUserId : current.createdByUserId;
        const confirmed = new Set(events.slice(submitIndex + 1)
          .filter((event: { action: string; thresholdSnapshotJson?: { sourceChecksum?: string } | null }) => event.action === 'APPROVED' && event.thresholdSnapshotJson?.sourceChecksum === sourceChecksum)
          .map((event: { actorUserId: string }) => event.actorUserId));
        confirmed.add(ctx.userId);
        confirmed.delete(roundSubmitter);
        if (confirmed.size < requiredApprovers) {
          throw new ConflictException({ code: 'vendor_bill_dual_approval_pending', message: 'The dual-approval quota is no longer met for this bill content. A second, different approver is required.' });
        }
      }
      const rows: Array<{ lineId: string; preview: ResolveTransactionTaxPreviewDto }> = [];
      for (const line of current.lines ?? []) {
        if (!line.taxSnapshot?.taxCodeDefinitionId && !line.taxSnapshot?.externalTaxCode) continue;
        const context = line.taxSnapshot.taxContext ?? (current.pp36Candidate ? 'IMPORT_SERVICE' : 'DOMESTIC_PURCHASE');
        // Imported-service VAT is recognized only when the supplier is paid.
        if (context === 'IMPORT_SERVICE') continue;
        const evidenceRefs = await this.transactionTax.listVerifiedEvidenceIdsForSource(ctx, {
          sourceType: 'procurement.vendor_bill', sourceId: current.id, sourceLineId: line.id,
          transactionContext: context, branchId: current.branchId,
          ...(context === 'DOMESTIC_PURCHASE' ? { evidenceTypes: ['TAX_INVOICE'] } : {}),
        }, db);
        rows.push({ lineId: line.id, preview: await this.transactionTax.resolveSourceTaxInTransaction(ctx, {
          branchId: current.branchId, sourceType: 'procurement.vendor_bill', sourceId: current.id, sourceLineId: line.id,
          transactionContext: context, documentDate: current.billDate.toISOString(), currency: current.currency,
          taxCodeDefinitionId: line.taxSnapshot.taxCodeDefinitionId ?? undefined,
          externalTaxCode: line.taxSnapshot.externalTaxCode ?? undefined,
          netAmount: line.lineSubtotalAmount, grossAmount: line.lineTotalAmount,
          enteredTaxAmount: context === 'IMPORT_GOODS' ? undefined : line.vatAmount,
          evidenceRefs,
        }, 'FINAL', db, undefined, 'INPUT', 'procurement') });
      }
      return rows;
    });
    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'VENDOR_BILL', id, 'APPROVED', ctx.userId, note, thresholdSnapshot);
    if (finalized.length) {
      const taxFacts = finalized.map(({ lineId, preview }) => ({
        sourceLineId: lineId,
        taxCodeDefinitionId: preview.snapshot.taxCodeDefinitionId,
        externalTaxCode: preview.snapshot.externalTaxCode,
        taxProfileKey: preview.snapshot.taxProfileKey,
        taxProfileVersion: preview.snapshot.taxProfileVersion,
        taxContext: preview.snapshot.taxContext,
        taxTreatment: preview.snapshot.taxTreatment,
        claimability: preview.snapshot.claimability,
        evidenceStatus: preview.snapshot.evidenceStatus,
        accountRuleVersion: preview.snapshot.accountRuleVersion,
        reportRuleVersion: preview.snapshot.reportRuleVersion,
        sourceChecksum: preview.sourceChecksum,
        configurationChecksum: preview.configurationChecksum,
      }));
      const checksum = createHash('sha256').update(JSON.stringify(taxFacts)).digest('hex');
      const periodKey = civilPeriodKey(coerceCivilDate(bill.billDate));
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.document_tax.finalize', targetType: 'vendor_bill', targetId: id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: { sourceType: 'procurement.vendor_bill', status: 'FINAL', periodKey, checksum, lines: taxFacts },
      });
      await this.outbox.append('tax.document_tax.finalized', 'vendor_bill', id, {
        companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'vendor_bill', aggregateId: id,
        occurredAt: now.toISOString(), data: { sourceType: 'procurement.vendor_bill', periodKey, checksum },
      });
    }
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.vendor_bill.approve', targetType: 'vendor_bill', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { ...approvalAuditBase, dualApproval: { recorded: requiredApprovers > 1 ? new Set([...priorApprovers, ctx.userId]).size : 1, required: requiredApprovers, final: true } } });
    void this.outbox.append('vendor_bill.approved', 'vendor_bill', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'vendor_bill', aggregateId: id, occurredAt: now.toISOString(), data: { status: 'APPROVED', netPayableAmount: bill.netPayableAmount, taxSyncStatus: 'pending' } });
    return updated;
  }
}

@Injectable()
export class GetVendorBillPostingSourceUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, id: string) {
    if (!ctx.permissions.includes('procurement.vendor_bill.read')) throw new ForbiddenException();
    const bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!['APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOIDED'].includes(bill.status)) throw new BadRequestException('Vendor bill is not finalized');
    return buildVendorBillPostingSource(bill);
  }
}

@Injectable()
export class GetVendorBillPp36PostingSourceUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, id: string) {
    if (!ctx.permissions.includes('procurement.vendor_bill.read')) throw new ForbiddenException();
    const bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (bill.status !== 'PAID') {
      throw new BadRequestException({ code: 'pp36_payment_not_finalized', message: 'PP36 posting is available only after the imported-service bill is fully paid.' });
    }
    return buildVendorBillPp36PostingSource(bill);
  }
}

export function buildVendorBillPostingSource(bill: VendorBillRecord) {
  const pp36 = bill.pp36Candidate || (bill.lines ?? []).some((line) => line.taxSnapshot?.taxContext === 'IMPORT_SERVICE');
  if (pp36 && (bill.lines ?? []).some((line) => line.taxSnapshot && line.taxSnapshot.taxContext !== 'IMPORT_SERVICE')) {
    throw new BadRequestException({ code: 'pp36_mixed_context_not_supported', message: 'Imported-service PP36 and non-PP36 tax lines cannot share one commercial posting source.' });
  }
  return {
    companyId: bill.companyId, branchId: bill.branchId,
    // A PP36 bill has two independent generated entries: commercial/AP at bill
    // date and self-assessed VAT at payment date. Separate source identities
    // preserve journal idempotency without conflating the periods.
    sourceType: pp36 ? 'procurement.vendor_bill.commercial' : 'procurement.vendor_bill', sourceId: bill.id,
    sourceEventType: bill.status === 'VOIDED' ? 'procurement.vendor_bill.voided' : 'procurement.vendor_bill.approved',
    idempotencyKey: `vendor-bill:${bill.status}:${bill.id}`, documentNumber: bill.vendorBillNumber,
    sourceDate: coerceCivilDate(bill.billDate), periodKey: civilPeriodKey(coerceCivilDate(bill.billDate)), currency: bill.currency,
    counterpartyId: bill.supplierId, totalAmount: bill.grandTotalAmount, taxTotal: bill.vatAmount,
    whtTotal: bill.whtAmount, paidAmount: bill.paidAmount,
    lines: (bill.lines ?? []).map((line) => ({ sourceLineId: line.id, description: line.description, quantity: line.quantity,
      netAmount: line.lineSubtotalAmount, vatAmount: line.vatAmount, whtAmount: line.whtAmount,
      accountHint: line.accountHint,
      taxSnapshot: line.taxSnapshot,
      taxComponents: pp36 ? [] : line.taxComponents })),
  };
}

export function buildVendorBillPp36PostingSource(bill: VendorBillRecord) {
  if (bill.status !== 'PAID') {
    throw new BadRequestException({ code: 'pp36_payment_not_finalized', message: 'PP36 tax posting requires a fully paid imported-service bill.' });
  }
  const lines = (bill.lines ?? []).map((line) => ({
    sourceLineId: line.id, description: line.description, quantity: line.quantity,
    netAmount: '0', vatAmount: '0', whtAmount: '0', accountHint: line.accountHint,
    taxSnapshot: line.taxSnapshot,
    taxComponents: (line.taxComponents ?? []).filter((component) => ['PP36_OUTPUT', 'PP36_INPUT'].includes(component.componentKey)),
  })).filter((line) => line.taxComponents.length > 0);
  const recognitionDates = new Set(lines.flatMap((line) => line.taxComponents.map((component) => component.snapshot.recognitionDate).filter(Boolean)));
  if (!lines.length || recognitionDates.size !== 1 || lines.some((line) => line.taxComponents.some((component) => !component.snapshot.recognitionDate))) {
    throw new BadRequestException({ code: 'pp36_payment_not_finalized', message: 'PP36 tax snapshots must be finalized with one payment recognition date.' });
  }
  const sourceDate = [...recognitionDates][0] as string;
  return {
    companyId: bill.companyId, branchId: bill.branchId, sourceType: 'procurement.vendor_bill', sourceId: bill.id,
    sourceEventType: 'procurement.vendor_bill.pp36_payment',
    idempotencyKey: `vendor-bill:pp36:${bill.status}:${bill.id}:${sourceDate}`,
    documentNumber: bill.vendorBillNumber, sourceDate, periodKey: civilPeriodKey(sourceDate), currency: 'THB',
    counterpartyId: bill.supplierId, totalAmount: '0', taxTotal: '0', whtTotal: '0', paidAmount: bill.paidAmount, lines,
  };
}

export function authoritativeVendorBillLine(
  raw: { quantity: string; unitPrice: string; discountAmount?: string; vatMode?: string; vatRate?: string; whtRate?: string; [key: string]: unknown },
  preview: import('@watchdog-bms/contracts').ResolveTransactionTaxPreviewDto | undefined,
  context: TransactionTaxContext,
) {
  // §19d: recorded line money is satang (2dp) at compute time; the tax
  // snapshot keeps its own policy-rounded values.
  const discountAmount = round2(d(raw.discountAmount ?? '0'));
  const commercialAmount = round2(d(raw.quantity || '1').mul(raw.unitPrice || '0').minus(discountAmount));
  const commercialVat = context === 'DOMESTIC_PURCHASE'
    ? round2(d(preview?.components.find((component) => component.componentKey === 'VAT')?.snapshot.taxAmount ?? 0).abs())
    : d(0);
  const base = preview ? round2(d(preview.snapshot.taxBaseAmount).abs()) : commercialAmount;
  const lineTotal = base.add(commercialVat);
  const whtAmount = raw.whtRate ? round2(base.mul(raw.whtRate).div(100)) : d(0);
  return {
    ...raw,
    discountAmount: decStr(discountAmount),
    vatMode: commercialVat.gt(0) ? (raw.vatMode ?? 'VAT_EXCLUDED') : (raw.vatMode ?? 'NO_VAT'),
    vatRate: preview?.snapshot.taxRate ?? raw.vatRate,
    vatAmount: decStr(commercialVat), whtAmount: decStr(whtAmount),
    lineSubtotalAmount: decStr(base), lineTotalAmount: decStr(lineTotal),
  } as any;
}

@Injectable()
export class RejectVendorBillUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, note: string): Promise<VendorBillRecord> {
    if (!ctx.permissions.includes('procurement.vendor_bill.approve')) throw new ForbiddenException();
    const bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!canTransitionVB(bill.status, 'REJECTED')) throw new BadRequestException(`Cannot reject from status ${bill.status}`);
    const updated = await this.repo.updateVendorBillStatus(ctx.companyId, id, 'REJECTED', { updatedByUserId: ctx.userId });
    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'VENDOR_BILL', id, 'REJECTED', ctx.userId, note);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.vendor_bill.reject', targetType: 'vendor_bill', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { note } });
    return updated;
  }
}

@Injectable()
export class VoidVendorBillUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly cancelNumber: CancelDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string, reason: string): Promise<VendorBillRecord> {
    if (!ctx.permissions.includes('procurement.vendor_bill.void')) throw new ForbiddenException();
    if (!reason?.trim() || reason.trim().length > 500) throw new BadRequestException('A void reason of 1-500 characters is required');
    const bill = await this.repo.findVendorBillById(ctx.companyId, id);
    if (!bill) throw new NotFoundException('Vendor bill not found');
    assertProcurementBranchScope(ctx, bill.branchId, 'Vendor bill');
    if (!canTransitionVB(bill.status, 'VOIDED')) throw new BadRequestException(`Cannot void from status ${bill.status}`);
    if (Number(bill.paidAmount) > 0) throw new BadRequestException('Cannot void a partially or fully paid bill');

    // H-04: reserve the reversal entry numbers outside the void transaction
    // (sequence rows commit independently); the transaction re-verifies the
    // posting state and fails closed if it changed in between.
    const journals = await this.repo.listVendorBillJournalsForReversal(ctx.companyId, id);
    const reservations = await Promise.all(journals.map(async (journal) => ({ journalId: journal.id, reservation: await this.reserveNumber.execute({
      companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY, periodKey: journal.periodKey,
      // Date.now() is deliberate: reserveNumber returns a matching-key row
      // regardless of its status, so a deterministic key would hand a retried
      // void the CANCELLED reservation from the failed attempt.
      idempotencyKey: `vendor-bill-void:${id}:${journal.id}:${Date.now()}`,
      reservedByUserId: ctx.userId,
    }) })));

    let result;
    try {
      result = await this.repo.voidVendorBillTrueReversal(
        ctx.companyId, id, ctx.userId, reason.trim(),
        Object.fromEntries(reservations.map((item) => [item.journalId, item.reservation.documentNumber])),
      );
    } catch (err) {
      // The reservations are still RESERVED here (commit happens only after a
      // successful reversal), so they must be cancelled — voidNumber accepts
      // COMMITTED numbers only and would mask the real error.
      await Promise.all(reservations.map((item) => this.cancelNumber.execute({ id: item.reservation.id, companyId: ctx.companyId }, ctx.userId).catch(() => undefined)));
      throw err;
    }
    await Promise.all(reservations.map((item) => {
      const reversalJournalId = result.reversalJournals.find((journal) => journal.originalJournalId === item.journalId)?.reversalJournalId;
      return reversalJournalId
        ? this.commitNumber.execute({ id: item.reservation.id, companyId: ctx.companyId, ownerType: 'journal_entry', ownerId: reversalJournalId }, ctx.userId)
        : this.cancelNumber.execute({ id: item.reservation.id, companyId: ctx.companyId }, ctx.userId);
    }));

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.vendor_bill.void', targetType: 'vendor_bill', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { reason: reason.trim(), supplierId: bill.supplierId, reversalJournals: result.reversalJournals } });
    void this.outbox.append('vendor_bill.voided', 'vendor_bill', id, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'vendor_bill', aggregateId: id,
      occurredAt: new Date().toISOString(), data: { status: 'VOIDED', reason: reason.trim(), reversalJournals: result.reversalJournals },
    });
    return result.bill;
  }
}
