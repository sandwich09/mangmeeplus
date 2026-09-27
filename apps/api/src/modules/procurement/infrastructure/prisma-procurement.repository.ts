import { Injectable, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  SupplierRecord, SupplierBankAccountRecord,
  PurchaseRequestRecord, PurchaseRequestLineRecord,
  PurchaseOrderRecord, PurchaseOrderLineRecord,
  GoodsReceiptRecord, GoodsReceiptLineRecord,
  VendorBillRecord, VendorBillLineRecord,
  SupplierPaymentRecord, SupplierPaymentAllocationRecord,
  PurchaseApprovalEventRecord, ProcurementApprovalPolicyRecord,
} from '../domain/models/procurement.model';
import { round2, SETTLE_EPSILON, vendorBillTaxSourceChecksum } from '../domain/logic/procurement.logic';
// A pure function, not a provider: the handoff prefill and the ภ.ง.ด. event must report the same
// income base, and procurement already depends on tax for the handoff use case.
import { deriveWhtIncomeBase } from '../../tax/domain/logic/wht-report.logic';
import { civilDate, civilDayRangeToUtc, civilInstantDayRangeToUtc, civilPeriodKey, coerceCivilDate, exclusiveEndOfDay } from '@watchdog-bms/contracts';
import { branchScopeWhere, type BranchScopes } from '../../data-model-core/domain/logic/branch.logic';
import { resolveTransactionBranchId, requireTransactionBranchId } from '../../data-model-core/application/services/transaction-branch';
import { buildCounterpartyAddressV2, counterpartyAddressText } from '../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import { findAttachmentLinkConflict } from '../../data-model-core/domain/logic/attachment.logic';

export type ProcurementDocumentKind = 'PURCHASE_REQUEST' | 'PURCHASE_ORDER' | 'GOODS_RECEIPT' | 'VENDOR_BILL' | 'SUPPLIER_PAYMENT';

type RelatedProcurementDocumentIds = Record<ProcurementDocumentKind, Set<string>>;

function decimal(v: unknown): string {
  return v != null ? String(v) : '0';
}

// GENERATED journal identities a vendor bill can own: the plain commercial
// entry, the PP36 commercial variant, and the PP36 tax entry (which reuses
// 'procurement.vendor_bill' with a payment-date sourceEventType).
const VENDOR_BILL_JOURNAL_SOURCE_TYPES = ['procurement.vendor_bill', 'procurement.vendor_bill.commercial'];

// Flipped copy of a generated journal line for a nested REVERSAL create.
// companyId is inherited through the compound journalEntry relation — Prisma 7
// rejects it as an explicit scalar in this nested create.
function reversalJournalLineData(line: any) {
  return {
    accountId: line.accountId, branchId: line.branchId, lineNumber: line.lineNumber,
    description: `[REVERSAL] ${line.description ?? ''}`, debitAmount: line.creditAmount, creditAmount: line.debitAmount,
    currency: line.currency, sourceType: line.sourceType, sourceId: line.sourceId, taxCode: line.taxCode,
    componentKey: line.componentKey, taxCodeDefinitionId: line.taxCodeDefinitionId,
    externalTaxCodeSnapshot: line.externalTaxCodeSnapshot, taxProfileKeySnapshot: line.taxProfileKeySnapshot,
    taxProfileVersionSnapshot: line.taxProfileVersionSnapshot, roundingModeSnapshot: line.roundingModeSnapshot,
    roundingScaleSnapshot: line.roundingScaleSnapshot, taxAmountToleranceSnapshot: line.taxAmountToleranceSnapshot,
    taxRegimeSnapshot: line.taxRegimeSnapshot,
    taxDirectionSnapshot: line.taxDirectionSnapshot, taxTreatmentSnapshot: line.taxTreatmentSnapshot,
    taxContextSnapshot: line.taxContextSnapshot, taxRateSnapshot: line.taxRateSnapshot,
    sourceCurrencySnapshot: line.sourceCurrencySnapshot, taxCurrencySnapshot: line.taxCurrencySnapshot,
    exchangeRateSnapshot: line.exchangeRateSnapshot, exchangeRateSourceSnapshot: line.exchangeRateSourceSnapshot,
    exchangeRateDateSnapshot: line.exchangeRateDateSnapshot, taxBaseAmount: line.taxBaseAmount,
    transactionTaxAmount: line.transactionTaxAmount, claimabilitySnapshot: line.claimabilitySnapshot,
    accountRuleVersionSnapshot: line.accountRuleVersionSnapshot, reportRuleVersionSnapshot: line.reportRuleVersionSnapshot,
    taxEvidenceReviewStatus: line.taxEvidenceReviewStatus, reportContributionsJson: line.reportContributionsJson ?? undefined,
  };
}

function vendorBillLineTaxSnapshotData(preview: import('@watchdog-bms/contracts').ResolveTransactionTaxPreviewDto) {
  const snapshot = preview.snapshot;
  return {
    taxCodeDefinitionId: snapshot.taxCodeDefinitionId,
    externalTaxCodeSnapshot: snapshot.externalTaxCode,
    taxProfileKeySnapshot: snapshot.taxProfileKey,
    taxProfileVersionSnapshot: snapshot.taxProfileVersion,
    roundingModeSnapshot: snapshot.roundingMode,
    roundingScaleSnapshot: snapshot.roundingScale,
    taxAmountToleranceSnapshot: snapshot.taxAmountTolerance,
    taxRegimeSnapshot: snapshot.taxRegime as any,
    taxDirectionSnapshot: snapshot.taxDirection as any,
    taxTreatmentSnapshot: snapshot.taxTreatment as any,
    taxContextSnapshot: snapshot.taxContext as any,
    taxRateSnapshot: snapshot.taxRate,
    sourceCurrencySnapshot: snapshot.sourceCurrency,
    taxCurrencySnapshot: snapshot.taxCurrency,
    exchangeRateSnapshot: snapshot.exchangeRate,
    exchangeRateSourceSnapshot: snapshot.exchangeRateSource,
    exchangeRateDateSnapshot: snapshot.exchangeRateDate ? new Date(snapshot.exchangeRateDate) : null,
    vatRate: ['VAT', 'IMPORT_VAT'].includes(snapshot.taxRegime ?? '') ? snapshot.taxRate : null,
    taxBaseAmount: snapshot.taxBaseAmount,
    transactionTaxAmount: snapshot.taxAmount,
    claimabilitySnapshot: snapshot.claimability as any,
    accountRuleVersionSnapshot: snapshot.accountRuleVersion,
    reportRuleVersionSnapshot: snapshot.reportRuleVersion,
    taxEvidenceReviewStatus: snapshot.evidenceStatus as any,
    taxComponentsJson: preview.components as any,
    accountAssignmentsJson: preview.components.flatMap((component) => component.accountAssignments) as any,
  };
}

export type Pp36PaymentRecognitionInput = {
  vendorBillId: string;
  lineId: string;
  sourceTaxBaseAmount: string;
  expectedBillPaidAmount: string;
  expectedBillOutstandingAmount: string;
  expectedBillTaxSourceChecksum: string;
  evidenceIds: string[];
  preview: import('@watchdog-bms/contracts').ResolveTransactionTaxPreviewDto;
};

export type VendorBillTaxFinalizer = (input: { db: any; bill: VendorBillRecord }) => Promise<Array<{
  lineId: string;
  preview: import('@watchdog-bms/contracts').ResolveTransactionTaxPreviewDto;
}>>;

@Injectable()
export class PrismaProcurementRepository {
  async resolveCreateBranchId(companyId: string, scopes: { branchIds?: string[] }, selectedBranchId?: string | null): Promise<string> {
    return resolveTransactionBranchId(this.prisma.client, companyId, scopes, selectedBranchId);
  }

  constructor(private readonly prisma: PrismaService) {}

  async branchExists(companyId: string, branchId: string): Promise<boolean> {
    return (await this.prisma.client.branch.count({ where: { id: branchId, companyId, status: 'ACTIVE' } })) === 1;
  }

  // ---- Supplier ----

  async createSupplierWithCounterparty(
    companyId: string,
    data: {
      displayName: string; legalName?: string; taxId?: string; branchCode?: string;
      email?: string; phone?: string; addressJson?: Record<string, unknown>;
      supplierCode?: string; supplierType?: string; vatRegistered?: boolean;
      defaultVatMode?: string; defaultInputVatClaimStatus?: string;
      defaultWhtCategoryCode?: string; defaultPaymentTermsDays?: number;
      defaultExpenseCategoryKey?: string; defaultAccountHint?: string;
      defaultCurrency?: string; contactName?: string;
    },
    createdByUserId: string,
  ): Promise<SupplierRecord> {
    // CON-9: `addressJson` here is whatever shape the supplier form posted, and it used to be
    // copied straight into `billingAddressJson` — the column the counterparty screen and every
    // printed document read. Route it through the v2 helper so the column holds one shape with a
    // provenance saying where it came from. Readers still tolerate the legacy shape
    // (`counterpartyAddressText`), because every row written before today still has it.
    const addressText = counterpartyAddressText(data.addressJson ?? null);
    const billingAddressJson = addressText
      ? buildCounterpartyAddressV2({ addressText, source: 'PROCUREMENT', userId: createdByUserId, at: new Date().toISOString() })
      : undefined;
    return this.prisma.client.$transaction(async (tx) => {
      const counterparty = await tx.accountingCounterparty.create({
        data: {
          companyId,
          type: 'VENDOR' as any,
          displayName: data.displayName,
          legalName: data.legalName,
          taxId: data.taxId,
          branchCode: data.branchCode,
          email: data.email,
          phone: data.phone,
          billingAddressJson: billingAddressJson as any,
          createdByUserId,
        },
      });

      const supplier = await tx.supplierProfile.create({
        data: {
          companyId,
          counterpartyId: counterparty.id,
          supplierCode: data.supplierCode,
          supplierType: (data.supplierType ?? 'JURISTIC_PERSON') as any,
          displayNameSnapshot: data.displayName,
          legalNameSnapshot: data.legalName,
          taxId: data.taxId,
          branchCode: data.branchCode,
          vatRegistered: data.vatRegistered,
          defaultVatMode: data.defaultVatMode as any,
          defaultInputVatClaimStatus: data.defaultInputVatClaimStatus as any,
          defaultWhtCategoryCode: data.defaultWhtCategoryCode,
          defaultPaymentTermsDays: data.defaultPaymentTermsDays,
          defaultExpenseCategoryKey: data.defaultExpenseCategoryKey,
          defaultAccountHint: data.defaultAccountHint,
          defaultCurrency: data.defaultCurrency ?? 'THB',
          contactName: data.contactName,
          email: data.email,
          phone: data.phone,
          addressJson: data.addressJson as any,
          createdByUserId,
        },
      });
      return this.toSupplierRecord(supplier);
    });
  }

  async updateSupplier(companyId: string, supplierId: string, data: Partial<{
    supplierCode: string; supplierType: string; displayName: string; legalName: string;
    taxId: string; branchCode: string; vatRegistered: boolean; defaultVatMode: string;
    defaultInputVatClaimStatus: string; defaultWhtCategoryCode: string;
    defaultPaymentTermsDays: number; defaultExpenseCategoryKey: string;
    defaultAccountHint: string; defaultCurrency: string; contactName: string;
    email: string; phone: string; addressJson: Record<string, unknown>;
    status: string; onHoldReason: string;
  }>, updatedByUserId: string): Promise<SupplierRecord> {
    const existing = await this.prisma.client.supplierProfile.findUnique({ where: { id: supplierId } });
    if (!existing || existing.companyId !== companyId) throw new NotFoundException('Supplier not found');

    const row = await this.prisma.client.supplierProfile.update({
      where: { id: supplierId },
      data: {
        supplierCode: data.supplierCode,
        supplierType: data.supplierType as any,
        displayNameSnapshot: data.displayName,
        legalNameSnapshot: data.legalName,
        taxId: data.taxId,
        branchCode: data.branchCode,
        vatRegistered: data.vatRegistered,
        defaultVatMode: data.defaultVatMode as any,
        defaultInputVatClaimStatus: data.defaultInputVatClaimStatus as any,
        defaultWhtCategoryCode: data.defaultWhtCategoryCode,
        defaultPaymentTermsDays: data.defaultPaymentTermsDays,
        defaultExpenseCategoryKey: data.defaultExpenseCategoryKey,
        defaultAccountHint: data.defaultAccountHint,
        defaultCurrency: data.defaultCurrency,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        addressJson: data.addressJson as any,
        status: data.status as any,
        onHoldReason: data.onHoldReason,
        updatedByUserId,
      },
    });
    return this.toSupplierRecord(row);
  }

  async findSupplierById(companyId: string, supplierId: string): Promise<SupplierRecord | null> {
    const row = await this.prisma.client.supplierProfile.findUnique({ where: { id: supplierId } });
    if (!row || row.companyId !== companyId) return null;
    return this.toSupplierRecord(row);
  }

  /**
   * The catalog is global and unscoped by company on purpose — these are statutory RD categories,
   * not per-tenant data. ACTIVE only: DRAFT means no accountant has vouched for the rate yet.
   */
  async findActiveWhtIncomeCategory(code: string): Promise<{ code: string; defaultRate: string } | null> {
    const row = await this.prisma.client.whtIncomeCategory.findUnique({ where: { code }, select: { code: true, defaultRate: true, status: true } });
    return row && row.status === 'ACTIVE' ? { code: row.code, defaultRate: String(row.defaultRate) } : null;
  }

  async listSuppliers(companyId: string, filter: { status?: string; supplierType?: string; taxId?: string; search?: string; page?: number; pageSize?: number }): Promise<{ data: SupplierRecord[]; total: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, filter.pageSize ?? 20);
    const where: any = { companyId, ...(filter.status && { status: filter.status }), ...(filter.supplierType && { supplierType: filter.supplierType }), ...(filter.taxId && { taxId: filter.taxId }), ...(filter.search && { displayNameSnapshot: { contains: filter.search, mode: 'insensitive' } }) };
    const [rows, total] = await Promise.all([
      this.prisma.client.supplierProfile.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { displayNameSnapshot: 'asc' } }),
      this.prisma.client.supplierProfile.count({ where }),
    ]);
    return { data: rows.map((r) => this.toSupplierRecord(r)), total };
  }

  // ---- Supplier Bank Account ----

  async createSupplierBankAccount(companyId: string, supplierId: string, data: { bankName: string; bankCode?: string; accountName: string; accountNumberLast4: string; branchName?: string; isDefault?: boolean }, createdByUserId: string): Promise<SupplierBankAccountRecord> {
    const supplier = await this.prisma.client.supplierProfile.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.companyId !== companyId) throw new NotFoundException('Supplier not found');
    const row = await this.prisma.client.supplierBankAccount.create({
      data: { companyId, supplierId, bankName: data.bankName, bankCode: data.bankCode, accountName: data.accountName, accountNumberLast4: data.accountNumberLast4, branchName: data.branchName, isDefault: data.isDefault ?? false, createdByUserId },
    });
    return this.toBankAccountRecord(row);
  }

  async listSupplierBankAccounts(companyId: string, supplierId: string): Promise<SupplierBankAccountRecord[]> {
    const rows = await this.prisma.client.supplierBankAccount.findMany({ where: { companyId, supplierId, status: 'ACTIVE' } });
    return rows.map((r) => this.toBankAccountRecord(r));
  }

  async findSupplierBankAccountById(companyId: string, supplierId: string, id: string): Promise<SupplierBankAccountRecord | null> {
    const row = await this.prisma.client.supplierBankAccount.findFirst({ where: { id, companyId, supplierId, status: 'ACTIVE' } });
    return row ? this.toBankAccountRecord(row) : null;
  }

  private async relatedProcurementDocumentIds(
    companyId: string,
    userId: string,
    scopes: BranchScopes = {},
  ): Promise<RelatedProcurementDocumentIds> {
    const ids: RelatedProcurementDocumentIds = {
      PURCHASE_REQUEST: new Set(), PURCHASE_ORDER: new Set(), GOODS_RECEIPT: new Set(),
      VENDOR_BILL: new Set(), SUPPLIER_PAYMENT: new Set(),
    };
    const scoped = (where: Record<string, unknown>) => ({
      companyId,
      AND: [branchScopeWhere(scopes), where],
    });
    const [requests, orders, receipts, bills, payments, events, auditActors, matches, allocations] = await Promise.all([
      this.prisma.client.purchaseRequest.findMany({
        where: scoped({ OR: [
          { requesterUserId: userId }, { createdByUserId: userId }, { updatedByUserId: userId },
          { approvedByUserId: userId }, { rejectedByUserId: userId },
        ] }) as any,
        select: { id: true },
      }),
      this.prisma.client.purchaseOrder.findMany({
        where: scoped({ OR: [
          { createdByUserId: userId }, { updatedByUserId: userId }, { approvedByUserId: userId },
          { rejectedByUserId: userId }, { issuedByUserId: userId }, { cancelledByUserId: userId },
          { closedByUserId: userId },
        ] }) as any,
        select: { id: true },
      }),
      this.prisma.client.goodsReceipt.findMany({
        where: scoped({ OR: [
          { receivedByUserId: userId }, { createdByUserId: userId }, { updatedByUserId: userId },
          { voidedByUserId: userId },
        ] }) as any,
        select: { id: true },
      }),
      this.prisma.client.vendorBill.findMany({
        where: scoped({ OR: [
          { createdByUserId: userId }, { updatedByUserId: userId }, { approvedByUserId: userId },
          { voidedByUserId: userId }, { taxEvidenceReviewedByUserId: userId },
        ] }) as any,
        select: { id: true },
      }),
      this.prisma.client.supplierPayment.findMany({
        where: scoped({ OR: [
          { createdByUserId: userId }, { updatedByUserId: userId }, { recordedByUserId: userId },
          { voidedByUserId: userId },
        ] }) as any,
        select: { id: true },
      }),
      this.prisma.client.purchaseApprovalEvent.findMany({
        where: { companyId, actorUserId: userId },
        select: { sourceType: true, sourceId: true },
      }),
      this.prisma.client.auditLog.findMany({
        where: {
          companyId, actorUserId: userId, result: 'SUCCESS',
          targetType: { in: ['purchase_request', 'purchase_order', 'goods_receipt', 'vendor_bill', 'supplier_payment'] },
        },
        select: { targetType: true, targetId: true },
      }),
      this.prisma.client.vendorBillMatch.findMany({
        where: { companyId, overriddenByUserId: userId },
        select: { vendorBillId: true },
      }),
      this.prisma.client.supplierPaymentAllocation.findMany({
        where: { companyId, OR: [{ createdByUserId: userId }, { pp36ReversedByUserId: userId }] },
        select: { supplierPaymentId: true, vendorBillId: true },
      }),
    ]);
    for (const row of requests) ids.PURCHASE_REQUEST.add(row.id);
    for (const row of orders) ids.PURCHASE_ORDER.add(row.id);
    for (const row of receipts) ids.GOODS_RECEIPT.add(row.id);
    for (const row of bills) ids.VENDOR_BILL.add(row.id);
    for (const row of payments) ids.SUPPLIER_PAYMENT.add(row.id);

    const eventSeeds: Partial<Record<ProcurementDocumentKind, string[]>> = {};
    for (const event of events) {
      const kind = event.sourceType as ProcurementDocumentKind;
      if (kind !== 'PURCHASE_REQUEST' && kind !== 'PURCHASE_ORDER' && kind !== 'VENDOR_BILL') continue;
      (eventSeeds[kind] ??= []).push(event.sourceId);
    }
    const auditKind: Record<string, ProcurementDocumentKind> = {
      purchase_request: 'PURCHASE_REQUEST', purchase_order: 'PURCHASE_ORDER', goods_receipt: 'GOODS_RECEIPT',
      vendor_bill: 'VENDOR_BILL', supplier_payment: 'SUPPLIER_PAYMENT',
    };
    for (const audit of auditActors) {
      const kind = auditKind[audit.targetType];
      if (kind && audit.targetId) (eventSeeds[kind] ??= []).push(audit.targetId);
    }
    const billSeeds = [...matches.map((row) => row.vendorBillId), ...allocations.map((row) => row.vendorBillId), ...(eventSeeds.VENDOR_BILL ?? [])];
    const paymentSeeds = [...allocations.map((row) => row.supplierPaymentId), ...(eventSeeds.SUPPLIER_PAYMENT ?? [])];
    const [eventRequests, eventOrders, eventReceipts, eventBills, allocationPayments] = await Promise.all([
      this.prisma.client.purchaseRequest.findMany({ where: scoped({ id: { in: eventSeeds.PURCHASE_REQUEST ?? [] } }) as any, select: { id: true } }),
      this.prisma.client.purchaseOrder.findMany({ where: scoped({ id: { in: eventSeeds.PURCHASE_ORDER ?? [] } }) as any, select: { id: true } }),
      this.prisma.client.goodsReceipt.findMany({ where: scoped({ id: { in: eventSeeds.GOODS_RECEIPT ?? [] } }) as any, select: { id: true } }),
      this.prisma.client.vendorBill.findMany({ where: scoped({ id: { in: billSeeds } }) as any, select: { id: true } }),
      this.prisma.client.supplierPayment.findMany({ where: scoped({ id: { in: paymentSeeds } }) as any, select: { id: true } }),
    ]);
    for (const row of eventRequests) ids.PURCHASE_REQUEST.add(row.id);
    for (const row of eventOrders) ids.PURCHASE_ORDER.add(row.id);
    for (const row of eventReceipts) ids.GOODS_RECEIPT.add(row.id);
    for (const row of eventBills) ids.VENDOR_BILL.add(row.id);
    for (const row of allocationPayments) ids.SUPPLIER_PAYMENT.add(row.id);

    let frontier: RelatedProcurementDocumentIds = {
      PURCHASE_REQUEST: new Set(ids.PURCHASE_REQUEST), PURCHASE_ORDER: new Set(ids.PURCHASE_ORDER),
      GOODS_RECEIPT: new Set(ids.GOODS_RECEIPT), VENDOR_BILL: new Set(ids.VENDOR_BILL),
      SUPPLIER_PAYMENT: new Set(ids.SUPPLIER_PAYMENT),
    };
    while (Object.values(frontier).some((set) => set.size > 0)) {
      const [requestLinks, orderLinks, receiptLinks, billLinks, paymentLinks] = await Promise.all([
        this.prisma.client.purchaseRequest.findMany({
          where: scoped({ id: { in: [...frontier.PURCHASE_REQUEST] } }) as any,
          select: { convertedPurchaseOrderId: true },
        }),
        this.prisma.client.purchaseOrder.findMany({
          where: scoped({ id: { in: [...frontier.PURCHASE_ORDER] } }) as any,
          select: { sourcePurchaseRequestId: true },
        }),
        this.prisma.client.goodsReceipt.findMany({
          where: scoped({ id: { in: [...frontier.GOODS_RECEIPT] } }) as any,
          select: { purchaseOrderId: true },
        }),
        this.prisma.client.vendorBill.findMany({
          where: scoped({ id: { in: [...frontier.VENDOR_BILL] } }) as any,
          select: { purchaseOrderId: true, goodsReceiptId: true },
        }),
        this.prisma.client.supplierPaymentAllocation.findMany({
          where: { companyId, OR: [
            { vendorBillId: { in: [...frontier.VENDOR_BILL] } },
            { supplierPaymentId: { in: [...frontier.SUPPLIER_PAYMENT] } },
          ] },
          select: { supplierPaymentId: true, vendorBillId: true },
        }),
      ]);
      const requestCandidates = orderLinks.flatMap((row) => row.sourcePurchaseRequestId ? [row.sourcePurchaseRequestId] : []);
      const orderCandidates = [
        ...requestLinks.flatMap((row) => row.convertedPurchaseOrderId ? [row.convertedPurchaseOrderId] : []),
        ...receiptLinks.map((row) => row.purchaseOrderId),
        ...billLinks.flatMap((row) => row.purchaseOrderId ? [row.purchaseOrderId] : []),
      ];
      const receiptCandidates = billLinks.flatMap((row) => row.goodsReceiptId ? [row.goodsReceiptId] : []);
      const relatedBillIds = paymentLinks.map((row) => row.vendorBillId);
      const relatedPaymentIds = paymentLinks.map((row) => row.supplierPaymentId);
      const [nextRequests, nextOrders, nextReceipts, nextBills, nextPayments] = await Promise.all([
        this.prisma.client.purchaseRequest.findMany({
          where: scoped({ OR: [
            { id: { in: requestCandidates } },
            { convertedPurchaseOrderId: { in: [...frontier.PURCHASE_ORDER] } },
          ] }) as any,
          select: { id: true },
        }),
        this.prisma.client.purchaseOrder.findMany({
          where: scoped({ OR: [
            { id: { in: orderCandidates } },
            { sourcePurchaseRequestId: { in: [...frontier.PURCHASE_REQUEST] } },
          ] }) as any,
          select: { id: true },
        }),
        this.prisma.client.goodsReceipt.findMany({
          where: scoped({ OR: [
            { id: { in: receiptCandidates } },
            { purchaseOrderId: { in: [...frontier.PURCHASE_ORDER] } },
          ] }) as any,
          select: { id: true },
        }),
        this.prisma.client.vendorBill.findMany({
          where: scoped({ OR: [
            { id: { in: relatedBillIds } },
            { purchaseOrderId: { in: [...frontier.PURCHASE_ORDER] } },
            { goodsReceiptId: { in: [...frontier.GOODS_RECEIPT] } },
          ] }) as any,
          select: { id: true },
        }),
        this.prisma.client.supplierPayment.findMany({
          where: scoped({ id: { in: relatedPaymentIds } }) as any,
          select: { id: true },
        }),
      ]);
      const next: RelatedProcurementDocumentIds = {
        PURCHASE_REQUEST: new Set(), PURCHASE_ORDER: new Set(), GOODS_RECEIPT: new Set(),
        VENDOR_BILL: new Set(), SUPPLIER_PAYMENT: new Set(),
      };
      const add = (kind: ProcurementDocumentKind, rows: Array<{ id: string }>) => {
        for (const row of rows) if (!ids[kind].has(row.id)) {
          ids[kind].add(row.id);
          next[kind].add(row.id);
        }
      };
      add('PURCHASE_REQUEST', nextRequests);
      add('PURCHASE_ORDER', nextOrders);
      add('GOODS_RECEIPT', nextReceipts);
      add('VENDOR_BILL', nextBills);
      add('SUPPLIER_PAYMENT', nextPayments);
      frontier = next;
    }
    return ids;
  }

  async isProcurementDocumentRelatedToUser(
    companyId: string,
    kind: ProcurementDocumentKind,
    documentId: string,
    userId: string,
    scopes: BranchScopes = {},
  ): Promise<boolean> {
    return (await this.relatedProcurementDocumentIds(companyId, userId, scopes))[kind].has(documentId);
  }

  // ---- Purchase Request ----

  async createPurchaseRequest(companyId: string, data: {
    branchId?: string; neededByDate?: Date; supplierId?: string; reason?: string; budgetCode?: string; currency?: string;
    subtotalAmount: string; discountAmount: string; taxableAmount: string; vatAmount: string; whtEstimateAmount?: string; grandTotalAmount: string;
    lines: { lineNumber: number; lineType?: string; productId?: string; description: string; unitName?: string; requestedQuantity: string; estimatedUnitPrice: string; discountAmount: string; vatMode: string; vatRate?: string; vatAmount: string; lineSubtotalAmount: string; lineTotalAmount: string; accountHint?: string; inventoryLocationId?: string }[];
  }, createdByUserId: string): Promise<PurchaseRequestRecord> {
    requireTransactionBranchId(data.branchId);
    const row = await this.prisma.client.purchaseRequest.create({
      data: {
        companyId, branchId: data.branchId, neededByDate: data.neededByDate, supplierId: data.supplierId,
        reason: data.reason, budgetCode: data.budgetCode, currency: data.currency ?? 'THB',
        subtotalAmount: data.subtotalAmount, discountAmount: data.discountAmount,
        taxableAmount: data.taxableAmount, vatAmount: data.vatAmount,
        whtEstimateAmount: data.whtEstimateAmount, grandTotalAmount: data.grandTotalAmount,
        requesterUserId: createdByUserId, createdByUserId,
        lines: { create: data.lines.map((ln) => ({ companyId, lineNumber: ln.lineNumber, lineType: (ln.lineType ?? 'STOCK') as any, productId: ln.productId, description: ln.description, unitName: ln.unitName, requestedQuantity: ln.requestedQuantity, estimatedUnitPrice: ln.estimatedUnitPrice, discountAmount: ln.discountAmount, vatMode: ln.vatMode as any, vatRate: ln.vatRate, vatAmount: ln.vatAmount, lineSubtotalAmount: ln.lineSubtotalAmount, lineTotalAmount: ln.lineTotalAmount, accountHint: ln.accountHint, inventoryLocationId: ln.inventoryLocationId })) },
      },
      include: { lines: true },
    });
    return this.toPurchaseRequestRecord(row);
  }

  async findPurchaseRequestById(companyId: string, id: string): Promise<PurchaseRequestRecord | null> {
    const row = await this.prisma.client.purchaseRequest.findUnique({ where: { id }, include: { lines: true } });
    if (!row || row.companyId !== companyId) return null;
    return this.toPurchaseRequestRecord(row);
  }

  async listPurchaseRequests(companyId: string, filter: { status?: string; requesterUserId?: string; supplierId?: string; branchId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number; relatedUserId?: string }, scopes: BranchScopes = {}): Promise<{ data: PurchaseRequestRecord[]; total: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, filter.pageSize ?? 20);
    const relatedIds = filter.relatedUserId ? await this.relatedProcurementDocumentIds(companyId, filter.relatedUserId, scopes) : undefined;
    const where: any = { companyId, AND: [branchScopeWhere(scopes), {
      ...(filter.status && { status: filter.status }), ...(filter.requesterUserId && { requesterUserId: filter.requesterUserId }),
      ...(filter.supplierId && { supplierId: filter.supplierId }), ...(filter.branchId && { branchId: filter.branchId }),
      ...(filter.fromDate || filter.toDate ? { createdAt: civilInstantDayRangeToUtc(filter.fromDate, filter.toDate) } : {}),
      ...(relatedIds && { id: { in: [...relatedIds.PURCHASE_REQUEST] } }),
    }] };
    const [rows, total] = await Promise.all([this.prisma.client.purchaseRequest.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }), this.prisma.client.purchaseRequest.count({ where })]);
    return { data: rows.map((r) => this.toPurchaseRequestRecord(r)), total };
  }

  async updatePurchaseRequestStatus(companyId: string, id: string, status: string, extra?: { requestNumber?: string; submittedAt?: Date; approvedByUserId?: string; approvedAt?: Date; rejectedByUserId?: string; rejectedAt?: Date; approvalNote?: string; convertedPurchaseOrderId?: string; updatedByUserId?: string }): Promise<PurchaseRequestRecord> {
    const row = await this.prisma.client.purchaseRequest.update({ where: { id }, data: { status: status as any, ...extra }, include: { lines: true } });
    return this.toPurchaseRequestRecord(row);
  }

  async appendPurchaseApprovalEvent(companyId: string, sourceType: string, sourceId: string, action: string, actorUserId: string, note?: string, thresholdSnapshotJson?: Record<string, unknown>): Promise<void> {
    await this.prisma.client.purchaseApprovalEvent.create({ data: { companyId, sourceType: sourceType as any, sourceId, action: action as any, actorUserId, note, thresholdSnapshotJson: thresholdSnapshotJson as any } });
  }

  async listPurchaseApprovalEvents(companyId: string, sourceType: string, sourceId: string): Promise<PurchaseApprovalEventRecord[]> {
    const rows = await this.prisma.client.purchaseApprovalEvent.findMany({
      where: { companyId, sourceType: sourceType as any, sourceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id, companyId: row.companyId, sourceType: row.sourceType as PurchaseApprovalEventRecord['sourceType'],
      sourceId: row.sourceId, action: row.action as PurchaseApprovalEventRecord['action'], actorUserId: row.actorUserId,
      note: row.note ?? undefined, thresholdSnapshotJson: (row.thresholdSnapshotJson as Record<string, unknown> | null) ?? undefined,
      createdAt: row.createdAt,
    }));
  }

  // ---- H-07 approval policy ----

  private toProcurementApprovalPolicyRecord(row: any): ProcurementApprovalPolicyRecord {
    return {
      id: row.id, companyId: row.companyId,
      allowSelfApproval: row.allowSelfApproval,
      dualApprovalThresholdAmount: row.dualApprovalThresholdAmount != null ? String(row.dualApprovalThresholdAmount) : null,
      createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  async getProcurementApprovalPolicy(companyId: string): Promise<ProcurementApprovalPolicyRecord | null> {
    const row = await this.prisma.client.procurementApprovalPolicy.findUnique({ where: { companyId } });
    return row ? this.toProcurementApprovalPolicyRecord(row) : null;
  }

  async upsertProcurementApprovalPolicy(companyId: string, data: { allowSelfApproval?: boolean; dualApprovalThresholdAmount?: string | null }, actorUserId: string): Promise<ProcurementApprovalPolicyRecord> {
    const row = await this.prisma.client.procurementApprovalPolicy.upsert({
      where: { companyId },
      create: {
        companyId,
        allowSelfApproval: data.allowSelfApproval ?? false,
        dualApprovalThresholdAmount: data.dualApprovalThresholdAmount ?? null,
        createdByUserId: actorUserId,
      },
      update: {
        ...(data.allowSelfApproval !== undefined ? { allowSelfApproval: data.allowSelfApproval } : {}),
        ...(data.dualApprovalThresholdAmount !== undefined ? { dualApprovalThresholdAmount: data.dualApprovalThresholdAmount } : {}),
        updatedByUserId: actorUserId,
      },
    });
    return this.toProcurementApprovalPolicyRecord(row);
  }

  // ---- Purchase Order ----

  async createPurchaseOrder(companyId: string, data: {
    supplierId: string; branchId?: string; orderDate: Date; expectedDeliveryDate?: Date; paymentTermsDays?: number;
    currency?: string; matchingMode?: string; sourcePurchaseRequestId?: string;
    subtotalAmount: string; discountAmount: string; taxableAmount: string; vatAmount: string; whtEstimateAmount?: string; grandTotalAmount: string;
    outstandingAmount: string;
    supplierSnapshotJson?: Record<string, unknown>;
    lines: { lineNumber: number; lineType?: string; productId?: string; description: string; unitName?: string; orderedQuantity: string; unitPrice: string; discountAmount: string; vatMode: string; vatRate?: string; vatAmount: string; whtCategoryCode?: string; whtRate?: string; whtEstimateAmount?: string; lineSubtotalAmount: string; lineTotalAmount: string; accountHint?: string; inventoryLocationId?: string; sourcePurchaseRequestLineId?: string }[];
  }, createdByUserId: string): Promise<PurchaseOrderRecord> {
    requireTransactionBranchId(data.branchId);
    const create = (db: any) => db.purchaseOrder.create({
      data: {
        companyId, supplierId: data.supplierId, branchId: data.branchId, orderDate: data.orderDate,
        expectedDeliveryDate: data.expectedDeliveryDate, paymentTermsDays: data.paymentTermsDays,
        currency: data.currency ?? 'THB', matchingMode: (data.matchingMode ?? 'THREE_WAY_PO_RECEIPT_BILL') as any,
        sourcePurchaseRequestId: data.sourcePurchaseRequestId,
        subtotalAmount: data.subtotalAmount, discountAmount: data.discountAmount,
        taxableAmount: data.taxableAmount, vatAmount: data.vatAmount,
        whtEstimateAmount: data.whtEstimateAmount, grandTotalAmount: data.grandTotalAmount,
        outstandingAmount: data.outstandingAmount, supplierSnapshotJson: data.supplierSnapshotJson as any,
        createdByUserId,
        lines: { create: data.lines.map((ln) => ({ companyId, lineNumber: ln.lineNumber, lineType: (ln.lineType ?? 'STOCK') as any, productId: ln.productId, description: ln.description, unitName: ln.unitName, orderedQuantity: ln.orderedQuantity, unitPrice: ln.unitPrice, discountAmount: ln.discountAmount, vatMode: ln.vatMode as any, vatRate: ln.vatRate, vatAmount: ln.vatAmount, whtCategoryCode: ln.whtCategoryCode, whtRate: ln.whtRate, whtEstimateAmount: ln.whtEstimateAmount, lineSubtotalAmount: ln.lineSubtotalAmount, lineTotalAmount: ln.lineTotalAmount, accountHint: ln.accountHint, inventoryLocationId: ln.inventoryLocationId, sourcePurchaseRequestLineId: ln.sourcePurchaseRequestLineId })) },
      },
      include: { lines: true },
    });
    const row = data.sourcePurchaseRequestId
      ? await this.prisma.client.$transaction(async (tx) => {
        const source = await tx.purchaseRequest.findFirst({
          where: {
            id: data.sourcePurchaseRequestId,
            companyId,
            status: 'APPROVED',
            convertedPurchaseOrderId: null,
          },
          include: { lines: { select: { id: true } } },
        });
        const sourceLineIds = new Set(source?.lines.map((line) => line.id) ?? []);
        const convertedLineIds = data.lines.map((line) => line.sourcePurchaseRequestLineId);
        if (
          !source
          || (source.branchId && source.branchId !== data.branchId)
          || (source.supplierId && source.supplierId !== data.supplierId)
          || source.currency !== (data.currency ?? 'THB')
          || convertedLineIds.some((id) => !id || !sourceLineIds.has(id))
          || convertedLineIds.length !== sourceLineIds.size
          || new Set(convertedLineIds).size !== sourceLineIds.size
        ) {
          throw new ConflictException('purchase_request_conversion_source_changed');
        }
        const created = await create(tx);
        const converted = await tx.purchaseRequest.updateMany({
          where: {
            id: data.sourcePurchaseRequestId,
            companyId,
            status: 'APPROVED',
            convertedPurchaseOrderId: null,
          },
          data: {
            status: 'CONVERTED',
            convertedPurchaseOrderId: created.id,
            updatedByUserId: createdByUserId,
          },
        });
        if (converted.count !== 1) throw new ConflictException('purchase_request_conversion_conflict');
        return created;
      }, { isolationLevel: 'Serializable' })
      : await create(this.prisma.client);
    return this.toPurchaseOrderRecord(row);
  }

  async findPurchaseOrderById(companyId: string, id: string): Promise<PurchaseOrderRecord | null> {
    const row = await this.prisma.client.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!row || row.companyId !== companyId) return null;
    return this.toPurchaseOrderRecord(row);
  }

  async listPurchaseOrders(companyId: string, filter: { status?: string; supplierId?: string; branchId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number; relatedUserId?: string }, scopes: BranchScopes = {}): Promise<{ data: PurchaseOrderRecord[]; total: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, filter.pageSize ?? 20);
    const relatedIds = filter.relatedUserId ? await this.relatedProcurementDocumentIds(companyId, filter.relatedUserId, scopes) : undefined;
    const where: any = { companyId, AND: [branchScopeWhere(scopes), {
      ...(filter.status && { status: filter.status }), ...(filter.supplierId && { supplierId: filter.supplierId }),
      ...(filter.branchId && { branchId: filter.branchId }),
      ...(filter.fromDate || filter.toDate ? { orderDate: civilDayRangeToUtc(filter.fromDate, filter.toDate) } : {}),
      ...(relatedIds && { id: { in: [...relatedIds.PURCHASE_ORDER] } }),
    }] };
    const [rows, total] = await Promise.all([this.prisma.client.purchaseOrder.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }), this.prisma.client.purchaseOrder.count({ where })]);
    return { data: rows.map((r) => this.toPurchaseOrderRecord(r)), total };
  }

  async aggregatePurchaseOrders(
    companyId: string,
    filter: { branchId?: string; fromDate: string; toDate: string },
    scopes: BranchScopes = {},
  ): Promise<{
    asOf: Date;
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    byCurrency: Array<{ currency: string; count: number; totalAmount: string }>;
  }> {
    const where: any = {
      companyId,
      AND: [branchScopeWhere(scopes), {
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
        orderDate: civilDayRangeToUtc(filter.fromDate, filter.toDate),
      }],
    };
    return this.prisma.client.$transaction(async (tx) => {
      const [stamp, byStatusRows, byCurrencyRows, company] = await Promise.all([
        tx.$queryRaw<Array<{ asOf: Date }>>`SELECT transaction_timestamp() AS "asOf"`,
        tx.purchaseOrder.groupBy({ by: ['status'], where, _count: true }),
        tx.purchaseOrder.groupBy({ by: ['currency'], where, _count: true, _sum: { grandTotalAmount: true } }),
        tx.company.findUnique({ where: { id: companyId }, select: { baseCurrency: true } }),
      ]);
      return {
        asOf: stamp[0]?.asOf ?? new Date(),
        total: byStatusRows.reduce((sum, row) => sum + row._count, 0),
        byStatus: byStatusRows.map((row) => ({ status: row.status, count: row._count })),
        byCurrency: byCurrencyRows.length > 0 ? byCurrencyRows.map((row) => ({
          currency: row.currency,
          count: row._count,
          totalAmount: String(row._sum.grandTotalAmount ?? '0'),
        })) : [{ currency: company?.baseCurrency ?? 'THB', count: 0, totalAmount: '0' }],
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async updatePurchaseOrderStatus(companyId: string, id: string, status: string, extra?: Record<string, unknown>): Promise<PurchaseOrderRecord> {
    const row = await this.prisma.client.purchaseOrder.update({ where: { id }, data: { status: status as any, ...(extra as any) }, include: { lines: true } });
    return this.toPurchaseOrderRecord(row);
  }

  async setPurchaseOrderNumber(companyId: string, id: string, purchaseOrderNumber: string, issuedByUserId: string): Promise<PurchaseOrderRecord> {
    const row = await this.prisma.client.purchaseOrder.update({
      where: { id },
      data: { purchaseOrderNumber, status: 'ISSUED' as any, issuedByUserId, issuedAt: new Date() },
      include: { lines: true },
    });
    return this.toPurchaseOrderRecord(row);
  }

  // ---- Goods Receipt ----

  async createGoodsReceipt(companyId: string, data: {
    purchaseOrderId: string; supplierId: string; branchId?: string; receivedAt: Date;
    note?: string; supplierSnapshotJson?: Record<string, unknown>;
    lines: { purchaseOrderLineId: string; lineNumber: number; lineType?: string; productId?: string; description: string; inventoryLocationId?: string; orderedQuantity: string; previouslyReceivedQuantity: string; receivedQuantity: string; acceptedQuantity: string; rejectedQuantity?: string; unitName?: string; varianceReason?: string }[];
  }, receivedByUserId: string): Promise<GoodsReceiptRecord> {
    requireTransactionBranchId(data.branchId);
    const row = await this.prisma.client.goodsReceipt.create({
      data: {
        companyId, purchaseOrderId: data.purchaseOrderId, supplierId: data.supplierId,
        branchId: data.branchId, receivedAt: data.receivedAt, note: data.note,
        supplierSnapshotJson: data.supplierSnapshotJson as any,
        receivedByUserId, createdByUserId: receivedByUserId,
        lines: { create: data.lines.map((ln) => ({ companyId, purchaseOrderLineId: ln.purchaseOrderLineId, lineNumber: ln.lineNumber, lineType: (ln.lineType ?? 'STOCK') as any, productId: ln.productId, description: ln.description, inventoryLocationId: ln.inventoryLocationId, orderedQuantity: ln.orderedQuantity, previouslyReceivedQuantity: ln.previouslyReceivedQuantity, receivedQuantity: ln.receivedQuantity, acceptedQuantity: ln.acceptedQuantity, rejectedQuantity: ln.rejectedQuantity ?? '0', unitName: ln.unitName, varianceReason: ln.varianceReason })) },
      },
      include: { lines: true },
    });
    return this.toGoodsReceiptRecord(row);
  }

  async findGoodsReceiptById(companyId: string, id: string): Promise<GoodsReceiptRecord | null> {
    const row = await this.prisma.client.goodsReceipt.findUnique({ where: { id }, include: { lines: true } });
    if (!row || row.companyId !== companyId) return null;
    return this.toGoodsReceiptRecord(row);
  }

  async listGoodsReceipts(companyId: string, filter: { status?: string; purchaseOrderId?: string; supplierId?: string; branchId?: string; page?: number; pageSize?: number; relatedUserId?: string }, scopes: BranchScopes = {}): Promise<{ data: GoodsReceiptRecord[]; total: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, filter.pageSize ?? 20);
    const relatedIds = filter.relatedUserId ? await this.relatedProcurementDocumentIds(companyId, filter.relatedUserId, scopes) : undefined;
    const where: any = { companyId, AND: [branchScopeWhere(scopes), {
      ...(filter.status && { status: filter.status }), ...(filter.purchaseOrderId && { purchaseOrderId: filter.purchaseOrderId }),
      ...(filter.supplierId && { supplierId: filter.supplierId }), ...(filter.branchId && { branchId: filter.branchId }),
      ...(relatedIds && { id: { in: [...relatedIds.GOODS_RECEIPT] } }),
    }] };
    const [rows, total] = await Promise.all([this.prisma.client.goodsReceipt.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { receivedAt: 'desc' } }), this.prisma.client.goodsReceipt.count({ where })]);
    return { data: rows.map((r) => this.toGoodsReceiptRecord(r)), total };
  }

  // Posting a goods receipt is one transaction: the CAS status claim, the
  // STOCK_IN movement per stock line with its line pointer, and the
  // purchase-order received-quantity roll-forward commit or roll back together.
  // The old post loop ran each movement in its own transaction and the PO
  // quantities in a second pass, so a line that failed mid-way left stock added
  // against a receipt that never finished posting — the mirror of the void gap.
  // Authority for the inventory write is procurement.goods_receipt.post, the
  // same way a void writes reversing movements under the receipt's void
  // permission: routing through CreateMovementUseCase would 403 a poster
  // lacking inventory.movement.create after the status claim had committed.
  async postGoodsReceiptWithInventory(
    companyId: string,
    id: string,
    goodsReceiptNumber: string,
    movementBatchRef: string,
    actorUserId: string,
    movementNumbers: Record<string, string | undefined> = {},
  ): Promise<{ goodsReceipt: GoodsReceiptRecord; movements: Array<{ lineId: string; movementId: string }> }> {
    const result = await (this.prisma.client as any).$transaction(async (tx: any) => {
      const claimed = await tx.goodsReceipt.updateMany({
        where: { id, companyId, status: 'DRAFT' },
        data: { status: 'POSTED', goodsReceiptNumber, inventoryMovementBatchRef: movementBatchRef, postingStatus: 'posted', updatedByUserId: actorUserId },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: 'goods_receipt_changed', message: 'Goods receipt changed before post. Reload and retry.' });
      const row = await tx.goodsReceipt.findFirstOrThrow({ where: { id, companyId }, include: { lines: true } });

      const movements: Array<{ lineId: string; movementId: string }> = [];
      for (const line of row.lines) {
        // Every line rolls the PO forward, service lines included, because the
        // void rollback mirrors this line for line. `increment` keeps the
        // arithmetic in the column's Decimal under the row lock instead of
        // round-tripping the quantity through a float.
        await tx.purchaseOrderLine.updateMany({
          where: { id: line.purchaseOrderLineId, companyId },
          data: { receivedQuantity: { increment: line.acceptedQuantity } },
        });
        if (line.lineType !== 'STOCK' || !line.productId || !line.inventoryLocationId) continue;
        if (new Decimal(decimal(line.acceptedQuantity)).lte(0)) continue;
        // The caller validated the product and location of the lines it saw and
        // reserved a movement number for each. A stock line that appeared since
        // then has been through neither, so the post fails closed rather than
        // moving stock for an unchecked product, location, or branch scope.
        if (!Object.hasOwn(movementNumbers, line.id)) {
          throw new ConflictException({ code: 'goods_receipt_changed', message: 'Goods receipt lines changed before post. Reload and retry.' });
        }
        const movement = await tx.stockMovement.create({ data: {
          companyId, movementNumber: movementNumbers[line.id], productId: line.productId,
          locationId: line.inventoryLocationId, movementType: 'STOCK_IN', direction: 'IN',
          quantity: line.acceptedQuantity, reason: `Goods receipt ${goodsReceiptNumber}`,
          referenceType: 'goods_receipt', referenceId: id, actorUserId,
        } });
        await tx.goodsReceiptLine.update({ where: { id: line.id }, data: { inventoryMovementId: movement.id } });
        movements.push({ lineId: line.id, movementId: movement.id });
      }
      return { goodsReceipt: row, movements };
    }, { isolationLevel: 'Serializable' });
    return { goodsReceipt: this.toGoodsReceiptRecord(result.goodsReceipt), movements: result.movements };
  }

  // Goods-receipt void is a true reversal executed in one transaction: the CAS
  // status claim, the reversing STOCK_OUT movements, and the purchase-order
  // received-quantity rollback commit or roll back together (spec section 10).
  // The stockMovement table — not the line's inventoryMovementId pointer —
  // decides what still needs reversing, so a post that created a movement but
  // failed to record the pointer is still reversed exactly once. The write stays
  // in this transaction rather than going through CreateMovementUseCase because
  // the status claim, the reversal and the PO rollback have to commit as one —
  // the same reason a vendor-bill void writes its ledger journals inline.
  // Authority is procurement.goods_receipt.void; note the inventory port would
  // additionally demand inventory.movement.create, which pack.procurement.goods_receipt_post
  // does not grant (the post path has that same exposure already).
  async voidGoodsReceiptTrueReversal(
    companyId: string,
    id: string,
    voidedByUserId: string,
    voidReason: string,
  ): Promise<{ goodsReceipt: GoodsReceiptRecord; reversalMovements: Array<{ originalMovementId: string; reversalMovementId: string }> }> {
    const result = await (this.prisma.client as any).$transaction(async (tx: any) => {
      const claimed = await tx.goodsReceipt.updateMany({
        where: { id, companyId, status: 'POSTED' },
        data: { status: 'VOIDED', voidedByUserId, voidedAt: new Date(), voidReason, postingStatus: 'reversed', updatedByUserId: voidedByUserId },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: 'goods_receipt_changed', message: 'Goods receipt changed before void. Reload and retry.' });
      const row = await tx.goodsReceipt.findFirstOrThrow({ where: { id, companyId }, include: { lines: true } });

      const movements = await tx.stockMovement.findMany({
        where: { companyId, referenceType: 'goods_receipt', referenceId: id },
        select: { id: true, productId: true, locationId: true, quantity: true, direction: true, reversesMovementId: true },
      });
      // A movement carrying reversesMovementId is the authoritative "already
      // reversed" marker, mirroring the REVERSAL journal row on bill voids.
      const reversedMovementIds = new Set(movements.filter((m: any) => m.reversesMovementId).map((m: any) => m.reversesMovementId));
      const reversalMovements: Array<{ originalMovementId: string; reversalMovementId: string }> = [];
      for (const movement of movements) {
        if (movement.direction !== 'IN' || reversedMovementIds.has(movement.id)) continue;
        await this.assertReversibleStock(tx, companyId, movement);
        // ponytail: no reserved movementNumber — the inventory module already
        // treats it as optional (CreateMovementUseCase nulls it when the
        // sequence is missing) and readers fall back to the id. Reserve one
        // here if reversal movements ever need their own document number.
        const reversal = await tx.stockMovement.create({ data: {
          companyId, productId: movement.productId, locationId: movement.locationId,
          movementType: 'STOCK_OUT', direction: 'OUT', quantity: movement.quantity,
          reason: `[VOID ${row.goodsReceiptNumber ?? id}] ${voidReason ?? ''}`.trim(),
          referenceType: 'goods_receipt', referenceId: id,
          reversesMovementId: movement.id, actorUserId: voidedByUserId,
        } });
        reversalMovements.push({ originalMovementId: movement.id, reversalMovementId: reversal.id });
      }

      // Posting incremented the PO line for every receipt line (service and
      // non-stock included), so the rollback mirrors it line for line. Clamped
      // at zero: a PO line can never owe back more than it counted as received.
      for (const line of row.lines) {
        const poLine = await tx.purchaseOrderLine.findFirst({ where: { id: line.purchaseOrderLineId, companyId }, select: { id: true, receivedQuantity: true } });
        if (!poLine) continue;
        const rolledBack = Decimal.max(0, new Decimal(decimal(poLine.receivedQuantity)).sub(decimal(line.acceptedQuantity)));
        await tx.purchaseOrderLine.update({ where: { id: poLine.id }, data: { receivedQuantity: rolledBack.toFixed(4) } });
      }
      return { goodsReceipt: row, reversalMovements };
    }, { isolationLevel: 'Serializable' });
    return { goodsReceipt: this.toGoodsReceiptRecord(result.goodsReceipt), reversalMovements: result.reversalMovements };
  }

  // Same advisory-lock + movement-sum guard the inventory module applies to its
  // own outbound movements, taken on the identical lock key so a concurrent
  // stock issue and this reversal serialize against each other. Reversing more
  // than is on hand would drive the balance negative, so the void fails closed
  // with the spec's `inventory_reversal_unavailable`.
  private async assertReversibleStock(tx: any, companyId: string, movement: { productId: string; locationId: string; quantity: unknown }): Promise<void> {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${companyId}:${movement.productId}:${movement.locationId}`);
    const rows = await tx.stockMovement.groupBy({
      by: ['direction'],
      where: { companyId, productId: movement.productId, locationId: movement.locationId },
      _sum: { quantity: true },
    });
    let available = new Decimal(0);
    for (const row of rows) {
      const qty = new Decimal(decimal(row._sum?.quantity));
      available = row.direction === 'IN' ? available.add(qty) : available.sub(qty);
    }
    const requested = new Decimal(decimal(movement.quantity));
    if (requested.gt(available)) {
      throw new ConflictException({
        code: 'inventory_reversal_unavailable',
        message: `Cannot reverse goods receipt: stock on hand for this product/location is ${available.toFixed(4)}, reversal needs ${requested.toFixed(4)}. Adjust stock or issue a correction receipt.`,
      });
    }
  }

  // ---- Vendor Bill ----

  async createVendorBill(companyId: string, data: {
    supplierId: string; branchId?: string; purchaseOrderId?: string; goodsReceiptId?: string;
    billDate: Date; dueDate: Date; receivedDate?: Date; paymentTermsDays?: number;
    currency?: string; vatMode?: string; supplierDocumentNumber?: string;
    taxInvoiceNumber?: string; taxInvoiceDate?: Date; whtCategoryCode?: string; whtRate?: string;
    pp36Candidate?: boolean; attachmentId?: string;
    subtotalAmount: string; discountAmount: string; taxableAmount: string; vatAmount: string;
    inputVatClaimStatus?: string; whtAmount: string; grandTotalAmount: string; netPayableAmount: string;
    supplierSnapshotJson?: Record<string, unknown>;
    matchingMode?: string;
    lines: { lineNumber: number; lineType?: string; productId?: string; description: string; unitName?: string; quantity: string; unitPrice: string; discountAmount: string; vatMode: string; vatRate?: string; vatAmount: string; inputVatClaimStatus?: string; whtCategoryCode?: string; whtRate?: string; whtAmount: string; lineSubtotalAmount: string; lineTotalAmount: string; accountHint?: string; assetCandidate?: boolean; purchaseOrderLineId?: string }[];
  }, createdByUserId: string): Promise<VendorBillRecord> {
    requireTransactionBranchId(data.branchId);
    const row = await (this.prisma.client as any).$transaction(async (tx: any) => {
      if (!await tx.supplierProfile.findFirst({ where: { id: data.supplierId, companyId, status: 'ACTIVE' }, select: { id: true } })) {
        throw new ConflictException('supplier_not_active_or_outside_company');
      }
      if (data.branchId && !await tx.branch.findFirst({ where: { id: data.branchId, companyId, status: 'ACTIVE' }, select: { id: true } })) {
        throw new ConflictException('branch_not_active_or_outside_company');
      }
      const purchaseOrder = data.purchaseOrderId ? await tx.purchaseOrder.findFirst({ where: {
        id: data.purchaseOrderId, companyId, supplierId: data.supplierId, branchId: data.branchId ?? null,
        currency: data.currency ?? 'THB', status: { in: ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'PARTIALLY_BILLED'] },
      }, select: { id: true, lines: { select: { id: true } } } }) : null;
      if (data.purchaseOrderId && !purchaseOrder) throw new ConflictException('purchase_order_reference_changed');
      const allowedPoLines = new Set((purchaseOrder?.lines ?? []).map((line: any) => line.id));
      if (data.lines.some((line) => line.purchaseOrderLineId && !allowedPoLines.has(line.purchaseOrderLineId))) throw new ConflictException('purchase_order_line_reference_changed');
      const goodsReceipt = data.goodsReceiptId ? await tx.goodsReceipt.findFirst({ where: {
        id: data.goodsReceiptId, companyId, supplierId: data.supplierId, branchId: data.branchId ?? null,
        purchaseOrderId: data.purchaseOrderId, status: 'POSTED',
      }, select: { id: true } }) : null;
      if (data.goodsReceiptId && !goodsReceipt) throw new ConflictException('goods_receipt_reference_changed');
      if (data.supplierDocumentNumber) {
        const duplicate = await tx.vendorBill.findFirst({ where: { companyId, supplierId: data.supplierId, supplierDocumentNumber: data.supplierDocumentNumber }, select: { id: true } });
        if (duplicate) throw new ConflictException('duplicate_supplier_document_number');
      }
      return tx.vendorBill.create({
      data: {
        companyId, supplierId: data.supplierId, branchId: data.branchId,
        purchaseOrderId: data.purchaseOrderId, goodsReceiptId: data.goodsReceiptId,
        billDate: data.billDate, dueDate: data.dueDate, receivedDate: data.receivedDate,
        paymentTermsDays: data.paymentTermsDays, currency: data.currency ?? 'THB',
        vatMode: (data.vatMode ?? 'NO_VAT') as any, supplierDocumentNumber: data.supplierDocumentNumber,
        taxInvoiceNumber: data.taxInvoiceNumber, taxInvoiceDate: data.taxInvoiceDate,
        whtCategoryCode: data.whtCategoryCode, whtRate: data.whtRate,
        pp36Candidate: data.pp36Candidate ?? false, attachmentId: data.attachmentId,
        subtotalAmount: data.subtotalAmount, discountAmount: data.discountAmount,
        taxableAmount: data.taxableAmount, vatAmount: data.vatAmount,
        inputVatClaimStatus: (data.inputVatClaimStatus ?? 'NEEDS_REVIEW') as any,
        whtAmount: data.whtAmount, grandTotalAmount: data.grandTotalAmount,
        netPayableAmount: data.netPayableAmount, outstandingAmount: data.netPayableAmount,
        matchingMode: (data.purchaseOrderId ? data.matchingMode ?? 'THREE_WAY_PO_RECEIPT_BILL' : 'NONE') as any,
        supplierSnapshotJson: data.supplierSnapshotJson as any,
        createdByUserId,
        lines: { create: data.lines.map((ln) => ({ companyId, lineNumber: ln.lineNumber, lineType: (ln.lineType ?? 'STOCK') as any, productId: ln.productId, description: ln.description, unitName: ln.unitName, quantity: ln.quantity, unitPrice: ln.unitPrice, discountAmount: ln.discountAmount, vatMode: ln.vatMode as any, vatRate: ln.vatRate, vatAmount: ln.vatAmount, inputVatClaimStatus: (ln.inputVatClaimStatus ?? 'NEEDS_REVIEW') as any, whtCategoryCode: ln.whtCategoryCode, whtRate: ln.whtRate, whtAmount: ln.whtAmount, lineSubtotalAmount: ln.lineSubtotalAmount, lineTotalAmount: ln.lineTotalAmount, accountHint: ln.accountHint, assetCandidate: ln.assetCandidate, purchaseOrderLineId: ln.purchaseOrderLineId })) },
      },
      include: { lines: true },
      });
    }, { isolationLevel: 'Serializable' });
    return this.toVendorBillRecord(row);
  }

  async deleteDraftVendorBill(companyId: string, id: string): Promise<void> {
    await this.prisma.client.vendorBill.deleteMany({ where: { id, companyId, status: { in: ['DRAFT', 'NEEDS_REVIEW'] as any } } });
  }

  async saveVendorBillLineTaxSnapshots(companyId: string, vendorBillId: string, rows: Array<{
    lineId: string;
    preview: import('@watchdog-bms/contracts').ResolveTransactionTaxPreviewDto;
  }>): Promise<void> {
    await this.prisma.client.$transaction(rows.map(({ lineId, preview }) => this.prisma.client.vendorBillLine.updateMany({
      where: { id: lineId, companyId, vendorBillId },
      data: vendorBillLineTaxSnapshotData(preview) as any,
    })));
  }

  async finalizeVendorBillApprovalCas(input: {
    companyId: string;
    id: string;
    expectedStatus: 'PENDING_APPROVAL';
    expectedUpdatedAt: Date;
    expectedSourceChecksum: string;
    actorUserId: string;
    approvedAt: Date;
  }, finalizeTax: VendorBillTaxFinalizer): Promise<{ bill: VendorBillRecord; finalized: Array<{
    lineId: string;
    preview: import('@watchdog-bms/contracts').ResolveTransactionTaxPreviewDto;
  }> }> {
    const client = this.prisma.client as any;
    const row = await client.$transaction(async (tx: any) => {
      const current = await tx.vendorBill.findFirst({ where: { id: input.id, companyId: input.companyId }, include: { lines: true } });
      if (!current || current.status !== input.expectedStatus) throw new ConflictException('vendor_bill_approval_source_status_changed');
      if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new ConflictException('vendor_bill_approval_source_version_changed');
      const currentBill = this.toVendorBillRecord(current);
      if (vendorBillTaxSourceChecksum(currentBill) !== input.expectedSourceChecksum) throw new ConflictException('vendor_bill_approval_source_checksum_changed');

      const currentLines = new Map((currentBill.lines ?? []).map((line) => [line.id, line]));
      const finalized = await finalizeTax({ db: tx, bill: currentBill });
      const expectedFinalLineIds = (currentBill.lines ?? []).filter((line) => {
        if (!line.taxSnapshot?.taxCodeDefinitionId && !line.taxSnapshot?.externalTaxCode) return false;
        return (line.taxSnapshot.taxContext ?? (currentBill.pp36Candidate ? 'IMPORT_SERVICE' : 'DOMESTIC_PURCHASE')) !== 'IMPORT_SERVICE';
      }).map((line) => line.id);
      if (finalized.length !== expectedFinalLineIds.length || new Set(finalized.map(({ lineId }) => lineId)).size !== finalized.length
        || finalized.some(({ lineId, preview }) => !currentLines.has(lineId) || !expectedFinalLineIds.includes(lineId)
          || preview.errors.length || !preview.sourceChecksum || !preview.configurationChecksum)) {
        throw new ConflictException('vendor_bill_approval_tax_line_changed');
      }

      const evidenceIds = [...new Set(finalized.flatMap(({ preview }) => preview.snapshot.evidenceRefs ?? []))];
      const evidenceRows = evidenceIds.length ? await tx.tradeTaxEvidence.findMany({ where: {
        companyId: input.companyId,
        id: { in: evidenceIds },
        status: 'VERIFIED',
        reviewedByUserId: { not: null },
        reviewedAt: { not: null },
      } }) : [];
      const evidenceById = new Map(evidenceRows.map((evidence: any) => [evidence.id, evidence]));
      for (const { lineId, preview } of finalized) {
        const refs = preview.snapshot.evidenceRefs ?? [];
        const matching = refs.map((id) => evidenceById.get(id)).filter(Boolean) as any[];
        if (matching.length !== new Set(refs).size || matching.some((evidence) => evidence.sourceType !== 'procurement.vendor_bill'
          || evidence.sourceId !== input.id
          || (evidence.sourceLineId && evidence.sourceLineId !== lineId)
          || evidence.transactionContext !== preview.snapshot.taxContext
          || (evidence.branchId ?? null) !== (current.branchId ?? null))) {
          throw new ConflictException('vendor_bill_approval_tax_evidence_changed');
        }
        if (preview.snapshot.taxContext === 'DOMESTIC_PURCHASE' && ['CLAIMABLE', 'PENDING_EVIDENCE'].includes(preview.snapshot.claimability)) {
          if (!current.attachmentId || current.taxEvidenceReviewStatus !== 'VERIFIED'
            || !matching.some((evidence) => evidence.evidenceType === 'TAX_INVOICE'
              && Array.isArray(evidence.attachmentIdsJson) && evidence.attachmentIdsJson.includes(current.attachmentId))) {
            throw new ConflictException('vendor_bill_approval_tax_invoice_evidence_changed');
          }
        }
      }
      if (current.taxEvidenceRequired) {
        const attachment = current.attachmentId ? await tx.attachmentObject.findFirst({ where: {
          id: current.attachmentId, companyId: input.companyId, status: 'ACTIVE',
          ...(current.branchId ? { OR: [{ branchId: current.branchId }, { branchId: null }] } : { branchId: null }),
        }, select: { id: true } }) : null;
        if (!attachment) throw new ConflictException('vendor_bill_approval_tax_attachment_changed');
      }

      const formTypes = [...new Set(finalized.flatMap(({ preview }) => preview.components
        .flatMap((component) => component.reportContributions.map((contribution) => contribution.formType)))
        .filter((formType) => ['PP30', 'PP36', 'CUSTOMS_SUPPORT'].includes(formType)))];
      if (formTypes.length) {
        const periodKey = civilPeriodKey(coerceCivilDate(current.billDate));
        const periods = await tx.taxPeriod.findMany({ where: { companyId: input.companyId, periodKey, formType: { in: formTypes } }, select: { formType: true, status: true } });
        const locked = periods.find((period: any) => ['FILED', 'PAID', 'CLOSED'].includes(String(period.status)));
        if (locked) throw new ConflictException(`vendor_bill_approval_tax_period_locked:${locked.formType}:${periodKey}`);
      }

      for (const { lineId, preview } of finalized) {
        const changed = await tx.vendorBillLine.updateMany({
          where: { id: lineId, companyId: input.companyId, vendorBillId: input.id },
          data: vendorBillLineTaxSnapshotData(preview),
        });
        if (changed.count !== 1) throw new ConflictException('vendor_bill_approval_tax_line_changed');
      }
      const changed = await tx.vendorBill.updateMany({
        where: { id: input.id, companyId: input.companyId, status: input.expectedStatus, updatedAt: input.expectedUpdatedAt },
        data: { status: 'APPROVED', approvedByUserId: input.actorUserId, approvedAt: input.approvedAt, updatedByUserId: input.actorUserId },
      });
      if (changed.count !== 1) throw new ConflictException('vendor_bill_approval_source_version_changed');
      const approved = await tx.vendorBill.findFirstOrThrow({ where: { id: input.id, companyId: input.companyId }, include: { lines: true } });
      return { bill: this.toVendorBillRecord(approved), finalized };
    }, { isolationLevel: 'Serializable' });
    return row;
  }

  async updateVendorBillPostingStatus(companyId: string, id: string, data: {
    postingStatus: 'pending' | 'posted' | 'posting_error' | 'reversed'; journalEntryId?: string | null; postingError?: string | null;
  }): Promise<void> {
    await this.prisma.client.vendorBill.updateMany({ where: { id, companyId }, data: data as any });
  }

  async countVendorBillPostingBlockers(companyId: string, fromDate: Date, toDate: Date): Promise<{ pending: number; errors: number }> {
    const where = { companyId, billDate: { gte: fromDate, lt: exclusiveEndOfDay(toDate) }, status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] as any[] } };
    const [pending, errors] = await Promise.all([
      this.prisma.client.vendorBill.count({ where: { ...where, postingStatus: 'pending' as any } }),
      this.prisma.client.vendorBill.count({ where: { ...where, postingStatus: 'posting_error' as any } }),
    ]);
    return { pending, errors };
  }

  async findVendorBillById(companyId: string, id: string, db: any = this.prisma.client): Promise<VendorBillRecord | null> {
    const row = await db.vendorBill.findUnique({ where: { id }, include: { lines: true } });
    if (!row || row.companyId !== companyId) return null;
    return this.toVendorBillRecord(row);
  }

  async isActiveVendorBillAttachment(companyId: string, attachmentId: string | undefined, branchId?: string): Promise<boolean> {
    if (!attachmentId) return false;
    return Boolean(await this.prisma.client.attachmentObject.findFirst({
      where: {
        id: attachmentId,
        companyId,
        status: 'ACTIVE',
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : { branchId: null }),
      },
      select: { id: true },
    }));
  }

  async updateVendorBillTaxEvidenceState(companyId: string, id: string, data: {
    taxInvoiceNumber?: string;
    taxInvoiceDate?: Date;
    attachmentId?: string;
    taxEvidenceRequired: boolean;
    taxEvidenceReviewStatus: 'DRAFT' | 'REVIEW_REQUIRED' | 'VERIFIED' | 'REJECTED';
    reviewIssues: string[];
    taxEvidenceReviewedByUserId?: string | null;
    taxEvidenceReviewedAt?: Date | null;
    updatedByUserId: string;
  }): Promise<VendorBillRecord> {
    const row = await (this.prisma.client as any).$transaction(async (tx: any) => {
      const existing = await tx.vendorBill.findFirst({ where: { id, companyId }, select: { id: true } });
      if (!existing) throw new NotFoundException('Vendor bill not found');
      const updated = await tx.vendorBill.update({
        where: { id },
        data: {
          taxInvoiceNumber: data.taxInvoiceNumber,
          taxInvoiceDate: data.taxInvoiceDate,
          attachmentId: data.attachmentId,
          taxEvidenceRequired: data.taxEvidenceRequired,
          taxEvidenceReviewStatus: data.taxEvidenceReviewStatus,
          taxReviewIssuesJson: data.reviewIssues,
          taxEvidenceReviewedByUserId: data.taxEvidenceReviewedByUserId,
          taxEvidenceReviewedAt: data.taxEvidenceReviewedAt,
          inputVatClaimStatus: data.taxEvidenceRequired
            ? data.taxEvidenceReviewStatus === 'VERIFIED' ? 'CLAIMABLE' : 'NEEDS_REVIEW'
            : undefined,
          updatedByUserId: data.updatedByUserId,
        },
        include: { lines: true },
      });
      if (data.taxEvidenceRequired) {
        await tx.vendorBillLine.updateMany({
          where: { companyId, vendorBillId: id, claimabilitySnapshot: { in: ['CLAIMABLE', 'PENDING_EVIDENCE'] } },
          data: { inputVatClaimStatus: data.taxEvidenceReviewStatus === 'VERIFIED' ? 'CLAIMABLE' : 'NEEDS_REVIEW' },
        });
      }
      const tradeEvidenceKey = `vendor-bill-tax-invoice:${id}`;
      if (data.taxEvidenceRequired && data.taxEvidenceReviewStatus === 'VERIFIED') {
        if (!updated.taxInvoiceNumber || !updated.taxInvoiceDate || !updated.attachmentId || !data.taxEvidenceReviewedByUserId || !data.taxEvidenceReviewedAt) {
          throw new ConflictException('vendor_bill_verified_tax_evidence_incomplete');
        }
        const activeAttachment = await tx.attachmentObject.findFirst({ where: {
          id: updated.attachmentId, companyId, status: 'ACTIVE',
          ...(updated.branchId ? { OR: [{ branchId: updated.branchId }, { branchId: null }] } : { branchId: null }),
        }, select: { id: true } });
        if (!activeAttachment) throw new ConflictException('vendor_bill_verified_tax_attachment_changed');
        await tx.tradeTaxEvidence.upsert({
          where: { companyId_idempotencyKey: { companyId, idempotencyKey: tradeEvidenceKey } },
          create: {
            companyId, branchId: updated.branchId, idempotencyKey: tradeEvidenceKey,
            transactionContext: 'DOMESTIC_PURCHASE', sourceType: 'procurement.vendor_bill', sourceId: id,
            sourceLineId: null, evidenceType: 'TAX_INVOICE', referenceNumber: updated.taxInvoiceNumber.trim(),
            evidenceDate: updated.taxInvoiceDate, currency: updated.currency, attachmentIdsJson: [updated.attachmentId],
            status: 'VERIFIED', createdByUserId: data.updatedByUserId,
            reviewedByUserId: data.taxEvidenceReviewedByUserId, reviewedAt: data.taxEvidenceReviewedAt,
          },
          update: {
            branchId: updated.branchId, referenceNumber: updated.taxInvoiceNumber.trim(), evidenceDate: updated.taxInvoiceDate,
            currency: updated.currency, attachmentIdsJson: [updated.attachmentId], status: 'VERIFIED',
            reviewedByUserId: data.taxEvidenceReviewedByUserId, reviewedAt: data.taxEvidenceReviewedAt,
          },
        });
      } else {
        await tx.tradeTaxEvidence.updateMany({
          where: { companyId, idempotencyKey: tradeEvidenceKey },
          data: {
            status: data.taxEvidenceReviewStatus === 'REJECTED' ? 'REJECTED' : 'REVIEW_REQUIRED',
            reviewedByUserId: data.taxEvidenceReviewStatus === 'REJECTED' ? data.taxEvidenceReviewedByUserId : null,
            reviewedAt: data.taxEvidenceReviewStatus === 'REJECTED' ? data.taxEvidenceReviewedAt : null,
          },
        });
      }
      if (data.attachmentId) {
        const conflict = await findAttachmentLinkConflict(tx, {
          companyId, attachmentId: data.attachmentId, targetType: 'procurement.vendor_bill',
        });
        if (conflict) throw new UnprocessableEntityException(conflict);
        await tx.attachmentLink.createMany({
          data: [{ companyId, attachmentId: data.attachmentId, targetType: 'procurement.vendor_bill', targetId: id, purpose: 'tax_invoice', linkedByUserId: data.updatedByUserId }],
          skipDuplicates: true,
        });
      }
      return await tx.vendorBill.findUnique({ where: { id }, include: { lines: true } }) ?? updated;
    });
    return this.toVendorBillRecord(row);
  }

  async listVendorBills(companyId: string, filter: { status?: string; supplierId?: string; purchaseOrderId?: string; matchingStatus?: string; postingStatus?: string; branchId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number; relatedUserId?: string }, scopes: BranchScopes = {}): Promise<{ data: VendorBillRecord[]; total: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, filter.pageSize ?? 20);
    const relatedIds = filter.relatedUserId ? await this.relatedProcurementDocumentIds(companyId, filter.relatedUserId, scopes) : undefined;
    const where: any = { companyId, AND: [branchScopeWhere(scopes), {
      ...(filter.status && { status: filter.status }), ...(filter.supplierId && { supplierId: filter.supplierId }),
      ...(filter.purchaseOrderId && { purchaseOrderId: filter.purchaseOrderId }), ...(filter.matchingStatus && { matchingStatus: filter.matchingStatus }),
      ...(filter.postingStatus && { postingStatus: filter.postingStatus }),
      ...(filter.branchId && { branchId: filter.branchId }),
      ...(filter.fromDate || filter.toDate ? { billDate: civilDayRangeToUtc(filter.fromDate, filter.toDate) } : {}),
      ...(relatedIds && { id: { in: [...relatedIds.VENDOR_BILL] } }),
    }] };
    const [rows, total] = await Promise.all([this.prisma.client.vendorBill.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { billDate: 'desc' } }), this.prisma.client.vendorBill.count({ where })]);
    return { data: rows.map((r) => this.toVendorBillRecord(r)), total };
  }

  async updateVendorBillStatus(companyId: string, id: string, status: string, extra?: Record<string, unknown>): Promise<VendorBillRecord> {
    // H-04: VOIDED is intentionally not handled here — voids must go through
    // voidVendorBillTrueReversal so the GL reversal and status change stay atomic.
    if (status === 'VOIDED') throw new UnprocessableEntityException('Use voidVendorBillTrueReversal for voids');
    const row = await this.prisma.client.vendorBill.update({ where: { id }, data: { status: status as any, ...(extra as any) }, include: { lines: true } });
    return this.toVendorBillRecord(row);
  }

  async updateVendorBillMatchingStatus(companyId: string, id: string, matchingStatus: string, varianceAmount: string): Promise<VendorBillRecord> {
    const row = await this.prisma.client.vendorBill.update({ where: { id }, data: { matchingStatus: matchingStatus as any, matchingVarianceAmount: varianceAmount }, include: { lines: true } });
    return this.toVendorBillRecord(row);
  }

  async overrideVendorBillMatch(companyId: string, id: string, overrideReason: string, overriddenByUserId: string): Promise<VendorBillRecord> {
    const row = await this.prisma.client.vendorBill.update({ where: { id }, data: { matchingStatus: 'OVERRIDDEN' as any, matchingOverrideReason: overrideReason }, include: { lines: true } });
    await this.prisma.client.vendorBillMatch.updateMany({ where: { companyId, vendorBillId: id }, data: { matchStatus: 'OVERRIDDEN' as any, overrideReason, overriddenByUserId, overriddenAt: new Date() } });
    return this.toVendorBillRecord(row);
  }

  async updateVendorBillPaid(companyId: string, id: string, additionalPaidAmount: string): Promise<void> {
    const bill = await this.prisma.client.vendorBill.findUnique({ where: { id } });
    if (!bill || bill.companyId !== companyId) return;
    const paid = Decimal.max(0, new Decimal(String(bill.paidAmount)).add(additionalPaidAmount));
    const outstanding = Decimal.max(0, new Decimal(String(bill.netPayableAmount)).sub(paid));
    const newStatus = paid.isZero() ? 'APPROVED' : outstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID';
    await this.prisma.client.vendorBill.update({ where: { id }, data: { paidAmount: paid.toFixed(4), outstandingAmount: outstanding.toFixed(4), status: newStatus as any } });
  }

  async listVendorBillJournalsForReversal(companyId: string, id: string): Promise<Array<{ id: string; periodKey: string }>> {
    const rows = await this.prisma.client.journalEntry.findMany({ where: {
      companyId, sourceId: id, sourceType: { in: VENDOR_BILL_JOURNAL_SOURCE_TYPES }, entryType: 'GENERATED', status: 'POSTED',
    }, select: { id: true, period: { select: { periodKey: true } } } });
    return rows.map((row) => ({ id: row.id, periodKey: row.period.periodKey }));
  }

  // H-04: vendor-bill void is a true reversal — the CAS status claim and the
  // GL reversal commit or roll back together. The journal table (not the
  // postingStatus pointer) decides whether a reversing entry is needed, the
  // original stays POSTED so POSTED-only reports net to zero, and a locked
  // accounting or PP30 period fails the whole void closed.
  async voidVendorBillTrueReversal(
    companyId: string,
    id: string,
    actorUserId: string,
    reason: string,
    reversalEntryNumbers: Record<string, string> = {},
  ): Promise<{ bill: VendorBillRecord; reversalJournals: Array<{ originalJournalId: string; reversalJournalId: string }> }> {
    const result = await (this.prisma.client as any).$transaction(async (tx: any) => {
      const claimed = await tx.vendorBill.updateMany({
        where: { id, companyId, status: 'APPROVED', paidAmount: 0 },
        data: { status: 'VOIDED', voidedByUserId: actorUserId, voidedAt: new Date(), voidReason: reason, updatedByUserId: actorUserId },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: 'vendor_bill_changed', message: 'Vendor bill changed before void. Reload and retry.' });
      const bill = await tx.vendorBill.findFirstOrThrow({ where: { id, companyId } });

      const journals = await tx.journalEntry.findMany({
        where: { companyId, sourceId: id, sourceType: { in: VENDOR_BILL_JOURNAL_SOURCE_TYPES }, entryType: 'GENERATED' },
        include: { period: true, lines: { orderBy: { lineNumber: 'asc' } } },
      });
      // A REVERSAL row is the authoritative "already reversed" marker (one per
      // source identity by unique constraint) — e.g. a manual journal reverse.
      const priorReversals = await tx.journalEntry.findMany({
        where: { companyId, sourceId: id, sourceType: { in: VENDOR_BILL_JOURNAL_SOURCE_TYPES }, entryType: 'REVERSAL' },
        select: { reversalOfJournalEntryId: true },
      });
      const reversedJournalIds = new Set(priorReversals.map((row: any) => row.reversalOfJournalEntryId));
      const taxRelevant = new Decimal(decimal(bill.vatAmount)).gt(0);
      const reversalJournals: Array<{ originalJournalId: string; reversalJournalId: string }> = [];
      const now = new Date();
      for (const journal of journals) {
        if (reversedJournalIds.has(journal.id)) continue;
        if (journal.status !== 'POSTED') {
          throw new UnprocessableEntityException(`Generated journal ${journal.entryNumber} is ${journal.status}; resolve its posting state before voiding`);
        }
        const entryNumber = reversalEntryNumbers[journal.id];
        if (!entryNumber) throw new ConflictException({ code: 'posting_state_changed', message: 'Posting state changed while voiding. Retry the void.' });
        if (!['OPEN', 'REOPENED'].includes(journal.period.status)) {
          throw new ConflictException({ code: 'accounting_period_locked', message: `Accounting period ${journal.period.periodKey} is not open; reopen it before voiding.` });
        }
        if (taxRelevant) {
          const lockedTaxPeriod = await tx.taxPeriod.findFirst({
            where: { companyId, formType: 'PP30', periodKey: journal.period.periodKey, status: { in: ['FILED', 'PAID', 'CLOSED'] } },
            select: { id: true },
          });
          if (lockedTaxPeriod) {
            throw new ConflictException({ code: 'tax_period_locked', message: `PP30/${journal.period.periodKey} is locked; use an adjustment or amended filing workflow.` });
          }
        }
        // @@unique([companyId, sourceType, sourceId, entryType]) makes a second
        // REVERSAL for this source identity abort the transaction.
        const reversal = await tx.journalEntry.create({ data: {
          companyId, periodId: journal.periodId, entryNumber, entryType: 'REVERSAL',
          sourceType: journal.sourceType, sourceId: journal.sourceId, reversalOfJournalEntryId: journal.id,
          status: 'POSTED', entryDate: journal.entryDate, postedAt: now, postedByUserId: actorUserId,
          memo: `[VOID ${bill.vendorBillNumber ?? bill.id}] ${reason}`, createdByUserId: actorUserId,
          lines: { create: journal.lines.map((line: any) => reversalJournalLineData(line)) },
        } });
        // Original stays POSTED: reports count POSTED entries only, so it nets
        // to zero against the reversal instead of double-subtracting.
        reversalJournals.push({ originalJournalId: journal.id, reversalJournalId: reversal.id });
      }
      if (reversalJournals.length || reversedJournalIds.size) {
        await tx.vendorBill.update({ where: { id }, data: { postingStatus: 'reversed', postingError: null } });
      }
      const row = await tx.vendorBill.findFirstOrThrow({ where: { id, companyId }, include: { lines: true } });
      return { bill: row, reversalJournals };
    }, { isolationLevel: 'Serializable' });
    return { bill: this.toVendorBillRecord(result.bill), reversalJournals: result.reversalJournals };
  }

  // ---- Supplier Payment ----

  async findSupplierPaymentByIdempotencyKey(companyId: string, idempotencyKey: string): Promise<SupplierPaymentRecord | null> {
    const row = await this.prisma.client.supplierPayment.findFirst({ where: { companyId, idempotencyKey }, include: { allocations: true } });
    return row ? this.toSupplierPaymentRecord(row) : null;
  }

  async findVerifiedPp36PaymentEvidence(
    companyId: string,
    vendorBillId: string,
    branchId: string | undefined,
    vendorBillLineIds: string[],
    evidenceIds: string[],
  ): Promise<Array<{ id: string; sourceLineId?: string }>> {
    if (!evidenceIds.length) return [];
    const [rows, bindings] = await Promise.all([
      (this.prisma.client as any).tradeTaxEvidence.findMany({ where: {
        companyId, id: { in: evidenceIds }, branchId: branchId ?? null,
        sourceType: 'procurement.vendor_bill', sourceId: vendorBillId,
        OR: [{ sourceLineId: null }, { sourceLineId: { in: vendorBillLineIds } }],
        transactionContext: 'IMPORT_SERVICE', evidenceType: 'PAYMENT_EVIDENCE', status: 'VERIFIED',
        reviewedByUserId: { not: null }, reviewedAt: { not: null },
      }, select: { id: true, sourceLineId: true } }),
      (this.prisma.client as any).pp36PaymentEvidenceBinding.findMany({ where: { evidenceId: { in: evidenceIds } }, select: { evidenceId: true } }),
    ]);
    const consumed = new Set(bindings.map((row: any) => row.evidenceId));
    return rows.filter((row: any) => !consumed.has(row.id)).map((row: any) => ({ id: row.id, sourceLineId: row.sourceLineId ?? undefined }));
  }

  async createSupplierPayment(companyId: string, data: {
    supplierId: string; branchId?: string; paymentDate: Date; method: string; currency?: string;
    idempotencyKey?: string;
    paymentNumber?: string; grossAmount: string; whtAmount?: string; whtCategoryCode?: string; whtRate?: string; netPaidAmount: string;
    bankAccountRef?: string; supplierBankAccountId?: string; externalReference?: string; note?: string;
    supplierSnapshotJson?: Record<string, unknown>;
    allocations: { vendorBillId: string; amount: string; whtAmount?: string; pp36PaymentEvidenceIds?: string[] }[];
  }, createdByUserId: string, taxRecognitions: Pp36PaymentRecognitionInput[] = []): Promise<SupplierPaymentRecord> {
    if (data.paymentNumber) {
      const existing = await this.prisma.client.supplierPayment.findFirst({ where: { companyId, paymentNumber: data.paymentNumber }, include: { allocations: true } });
      if (existing) return this.toSupplierPaymentRecord(existing);
    }
    requireTransactionBranchId(data.branchId);
    const allocatedAmount = data.allocations.reduce((acc, allocation) => acc.add(allocation.amount), new Decimal(0));
    // Against the gross, because allocations clear debt rather than move cash. Measuring the
    // unapplied remainder against netPaid would report a withheld payment as over-applied.
    const unappliedAmount = new Decimal(data.grossAmount).sub(allocatedAmount);

    let row: any;
    try {
      row = await this.prisma.client.$transaction(async (tx) => {
      // Snapshot fields are selected so a withheld-tax payment can prefill its 50 ทวิ handoff below
      // without a second round trip.
      const supplier = await tx.supplierProfile.findFirst({
        where: { id: data.supplierId, companyId, status: 'ACTIVE' },
        select: { id: true, supplierType: true, displayNameSnapshot: true, legalNameSnapshot: true, taxId: true, branchCode: true, addressJson: true },
      });
      if (!supplier) throw new ConflictException('supplier_not_active_or_outside_company');
      if (data.branchId && !(await tx.branch.findFirst({ where: { id: data.branchId, companyId, status: 'ACTIVE' }, select: { id: true } }))) {
        throw new ConflictException('payment_branch_not_active_or_outside_company');
      }
      if (data.supplierBankAccountId && !(await tx.supplierBankAccount.findFirst({ where: { id: data.supplierBankAccountId, companyId, supplierId: data.supplierId, status: 'ACTIVE' }, select: { id: true } }))) {
        throw new ConflictException('supplier_bank_account_not_active_or_outside_supplier');
      }
      const allocationIds = data.allocations.map((allocation) => allocation.vendorBillId);
      if (new Set(allocationIds).size !== allocationIds.length) throw new ConflictException('duplicate_vendor_bill_allocation');
      const payment = await tx.supplierPayment.create({
        data: {
          companyId, supplierId: data.supplierId, branchId: data.branchId, idempotencyKey: data.idempotencyKey,
          paymentNumber: data.paymentNumber,
          paymentDate: data.paymentDate, method: data.method as any, currency: data.currency ?? 'THB',
          grossAmount: data.grossAmount, whtAmount: data.whtAmount ?? '0',
          whtCategoryCode: data.whtCategoryCode ?? null, whtRate: data.whtRate ?? null,
          netPaidAmount: data.netPaidAmount,
          allocatedAmount: allocatedAmount.toFixed(4), unappliedAmount: unappliedAmount.toFixed(4),
          bankAccountRef: data.bankAccountRef, supplierBankAccountId: data.supplierBankAccountId,
          externalReference: data.externalReference, note: data.note,
          supplierSnapshotJson: data.supplierSnapshotJson as any,
          status: 'RECORDED' as any, recordedByUserId: createdByUserId, recordedAt: new Date(),
          postingStatus: 'pending' as any, createdByUserId,
          allocations: { create: data.allocations.map((allocation) => ({ companyId, vendorBillId: allocation.vendorBillId, amount: allocation.amount, whtAmount: allocation.whtAmount, allocatedAt: new Date(), createdByUserId })) },
        },
        include: { allocations: true },
      });
      // The payer withheld tax, so the payee is owed a 50 ทวิ. The system always records a durable,
      // prefilled handoff in the SAME transaction as the settlement, so the obligation can never be
      // lost by a later failure — issuing the certificate (system or external) is a separate,
      // explicit action the user takes afterward from the handoff panel, never automatic here. The
      // payment itself is never blocked by an unissued certificate (spec:299, spec:205).
      if (new Decimal(data.whtAmount ?? '0').gt(0)) {
        await createWhtHandoffForPayment(tx, { companyId, payment, supplier, data, createdByUserId });
      }
      for (const allocation of data.allocations) {
        const bill = await tx.vendorBill.findFirst({ where: { id: allocation.vendorBillId, companyId }, include: { lines: true } });
        if (!bill || !['APPROVED', 'PARTIALLY_PAID'].includes(String(bill.status))) throw new ConflictException('vendor_bill_not_payable');
        if (bill.supplierId !== data.supplierId) throw new ConflictException('vendor_bill_supplier_mismatch');
        if ((bill.branchId ?? null) !== (data.branchId ?? null)) throw new ConflictException('vendor_bill_branch_mismatch');
        if (bill.currency !== (data.currency ?? 'THB')) throw new ConflictException('vendor_bill_currency_mismatch');
        const amount = new Decimal(allocation.amount);
        const outstanding = new Decimal(String(bill.outstandingAmount));
        // §19d: allow up to half a satang of overshoot on pre-policy 4dp bills.
        if (amount.lte(0) || amount.sub(outstanding).gt(SETTLE_EPSILON)) throw new ConflictException('vendor_bill_allocation_conflict');
        const recognitions = taxRecognitions.filter((recognition) => recognition.vendorBillId === bill.id);
        if (recognitions.some((recognition) => !new Decimal(recognition.expectedBillPaidAmount).eq(bill.paidAmount)
          || !new Decimal(recognition.expectedBillOutstandingAmount).eq(bill.outstandingAmount)
          || recognition.expectedBillTaxSourceChecksum !== vendorBillTaxSourceChecksum(this.toVendorBillRecord(bill)))) {
          throw new ConflictException('pp36_recognition_source_changed');
        }
        const paid = new Decimal(String(bill.paidAmount)).add(amount);
        // §19d settle: outstanding re-rounds to satang, so sub-satang pre-policy
        // residue (capped at half a satang by the guard above) reads PAID.
        const remaining = round2(Decimal.max(0, outstanding.sub(amount)));
        await tx.vendorBill.update({ where: { id: bill.id }, data: {
          paidAmount: paid.toFixed(4), outstandingAmount: remaining.toFixed(4),
          status: (remaining.isZero() ? 'PAID' : 'PARTIALLY_PAID') as any,
        } });
      }
      if (taxRecognitions.length) {
        const periodKey = civilPeriodKey(civilDate(data.paymentDate));
        const taxPeriod = await tx.taxPeriod.upsert({
          where: { companyId_formType_periodKey: { companyId, formType: 'PP36', periodKey } },
          create: { companyId, taxType: 'VAT', formType: 'PP36', periodKey, status: 'OPEN' }, update: {},
        });
        if (['FILED', 'PAID', 'CLOSED'].includes(String(taxPeriod.status))) throw new ConflictException('pp36_tax_period_locked');
        const byAllocation = new Map<string, Array<Pp36PaymentRecognitionInput & { recognitionKey: string }>>();
        for (const recognition of taxRecognitions) {
          const allocation = payment.allocations.find((item) => item.vendorBillId === recognition.vendorBillId);
          if (!allocation) throw new ConflictException('pp36_payment_allocation_changed');
          const line = await tx.vendorBillLine.findFirst({ where: { id: recognition.lineId, companyId, vendorBillId: recognition.vendorBillId }, select: { id: true } });
          if (!line) throw new ConflictException('pp36_tax_snapshot_source_changed');
          const evidence = await tx.tradeTaxEvidence.findMany({ where: {
            companyId, id: { in: recognition.evidenceIds }, branchId: data.branchId ?? null,
            sourceType: 'procurement.vendor_bill', sourceId: recognition.vendorBillId,
            OR: [{ sourceLineId: null }, { sourceLineId: recognition.lineId }],
            transactionContext: 'IMPORT_SERVICE', evidenceType: 'PAYMENT_EVIDENCE', status: 'VERIFIED',
            reviewedByUserId: { not: null }, reviewedAt: { not: null },
          }, select: { id: true } });
          if (evidence.length !== new Set(recognition.evidenceIds).size) throw new ConflictException('pp36_payment_evidence_changed');
          const recognitionKey = `${allocation.id}:${recognition.lineId}`;
          const entries = byAllocation.get(allocation.id) ?? [];
          entries.push({ ...recognition, recognitionKey });
          byAllocation.set(allocation.id, entries);
          const output = recognition.preview.components.find((component) => component.componentKey === 'PP36_OUTPUT');
          const pending = recognition.preview.components.find((component) => component.componentKey === 'PP36_INPUT');
          if (!output || !pending || pending.snapshot.claimability !== 'PENDING_EVIDENCE') throw new ConflictException('pp36_recognition_snapshot_invalid');
          const idempotencyKey = createHash('sha256').update([companyId, payment.id, recognitionKey, 'PP36_OUTPUT'].join('|')).digest('hex');
          await tx.taxEvent.create({ data: {
            companyId, branchId: data.branchId, taxPeriodId: taxPeriod.id, idempotencyKey,
            eventType: 'VAT_OUTPUT', status: 'ACTIVE', sourceType: 'procurement.supplier_payment.pp36', sourceId: payment.id,
            sourceLineId: recognition.lineId, sourceLineKey: recognitionKey, sourceEventType: 'procurement.supplier_payment.pp36_payment',
            sourceHash: idempotencyKey, periodKey, eventDate: data.paymentDate,
            taxableBase: output.snapshot.taxBaseAmount, taxAmount: output.snapshot.taxAmount, currency: output.snapshot.taxCurrency,
            componentKey: 'PP36_OUTPUT', taxCodeDefinitionId: output.snapshot.taxCodeDefinitionId,
            externalTaxCodeSnapshot: output.snapshot.externalTaxCode, taxProfileKeySnapshot: output.snapshot.taxProfileKey,
            taxProfileVersionSnapshot: output.snapshot.taxProfileVersion, roundingModeSnapshot: output.snapshot.roundingMode,
            roundingScaleSnapshot: output.snapshot.roundingScale, taxAmountToleranceSnapshot: output.snapshot.taxAmountTolerance,
            taxRegimeSnapshot: output.snapshot.taxRegime as any,
            taxDirectionSnapshot: output.snapshot.taxDirection as any, taxTreatmentSnapshot: output.snapshot.taxTreatment as any,
            taxContextSnapshot: output.snapshot.taxContext as any, taxRateSnapshot: output.snapshot.taxRate,
            sourceCurrencySnapshot: output.snapshot.sourceCurrency, taxCurrencySnapshot: output.snapshot.taxCurrency,
            exchangeRateSnapshot: output.snapshot.exchangeRate, exchangeRateSourceSnapshot: output.snapshot.exchangeRateSource,
            exchangeRateDateSnapshot: output.snapshot.exchangeRateDate ? new Date(output.snapshot.exchangeRateDate) : null,
            claimabilitySnapshot: output.snapshot.claimability as any, accountRuleVersionSnapshot: output.snapshot.accountRuleVersion,
            reportRuleVersionSnapshot: output.snapshot.reportRuleVersion, taxEvidenceReviewStatus: output.snapshot.evidenceStatus as any,
            reportContributionsJson: output.reportContributions as any, accountAssignmentsJson: output.accountAssignments as any,
          } });
        }
        for (const [allocationId, recognitions] of byAllocation) {
          const evidenceIds = [...new Set(recognitions.flatMap((item) => item.evidenceIds))];
          for (const evidenceId of evidenceIds) {
            await tx.pp36PaymentEvidenceBinding.create({ data: { companyId, supplierPaymentId: payment.id, supplierPaymentAllocationId: allocationId, evidenceId } });
          }
          await tx.supplierPaymentAllocation.update({ where: { id: allocationId }, data: {
            pp36RecognitionStatus: 'ACTIVE',
            pp36RecognitionJson: recognitions.map((item) => ({
              recognitionKey: item.recognitionKey, vendorBillLineId: item.lineId,
              sourceTaxBaseAmount: item.sourceTaxBaseAmount, evidenceIds: item.evidenceIds, preview: item.preview,
            })) as any,
          } });
        }
      }
      return taxRecognitions.length
        ? tx.supplierPayment.findUniqueOrThrow({ where: { id: payment.id }, include: { allocations: true } })
        : payment;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (data.idempotencyKey) {
        const raced = await this.prisma.client.supplierPayment.findFirst({ where: { companyId, idempotencyKey: data.idempotencyKey }, include: { allocations: true } });
        if (raced) return this.toSupplierPaymentRecord(raced);
      }
      throw error;
    }
    return this.toSupplierPaymentRecord(row);
  }

  async findSupplierPaymentById(companyId: string, id: string): Promise<SupplierPaymentRecord | null> {
    const row = await this.prisma.client.supplierPayment.findUnique({ where: { id }, include: { allocations: true } });
    if (!row || row.companyId !== companyId) return null;
    return this.toSupplierPaymentRecord(row);
  }

  async updateSupplierPaymentPostingStatus(companyId: string, id: string, data: {
    postingStatus: 'pending' | 'posted' | 'posting_error' | 'reversed'; journalEntryId?: string | null;
  }): Promise<void> {
    await this.prisma.client.supplierPayment.updateMany({ where: { id, companyId }, data: data as any });
  }

  async countSupplierPaymentPostingBlockers(companyId: string, fromDate: Date, toDate: Date): Promise<{ pending: number; errors: number }> {
    const where = { companyId, paymentDate: { gte: fromDate, lt: exclusiveEndOfDay(toDate) }, status: 'RECORDED' as any };
    const [pending, errors, activePp36Allocations] = await Promise.all([
      this.prisma.client.supplierPayment.count({ where: { ...where, postingStatus: { in: ['pending', 'not_required'] as any[] } } }),
      this.prisma.client.supplierPayment.count({ where: { ...where, postingStatus: 'posting_error' as any } }),
      this.prisma.client.supplierPaymentAllocation.findMany({ where: {
        companyId, pp36RecognitionStatus: 'ACTIVE', supplierPayment: where,
      }, select: { supplierPaymentId: true }, distinct: ['supplierPaymentId'] }),
    ]);
    const pp36PaymentIds = activePp36Allocations.map((allocation) => allocation.supplierPaymentId);
    const postedPp36 = pp36PaymentIds.length ? await this.prisma.client.journalEntry.findMany({ where: {
      companyId, sourceType: 'procurement.supplier_payment.pp36', sourceId: { in: pp36PaymentIds }, status: 'POSTED',
    }, select: { sourceId: true } }) : [];
    const postedIds = new Set(postedPp36.map((journal) => journal.sourceId));
    return { pending: pending + pp36PaymentIds.filter((paymentId) => !postedIds.has(paymentId)).length, errors };
  }

  async listSupplierPayments(companyId: string, filter: { status?: string; supplierId?: string; method?: string; postingStatus?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number; relatedUserId?: string }, scopes: BranchScopes = {}): Promise<{ data: SupplierPaymentRecord[]; total: number }> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, filter.pageSize ?? 20);
    const relatedIds = filter.relatedUserId ? await this.relatedProcurementDocumentIds(companyId, filter.relatedUserId, scopes) : undefined;
    const where: any = { companyId, AND: [branchScopeWhere(scopes), {
      ...(filter.status && { status: filter.status }), ...(filter.supplierId && { supplierId: filter.supplierId }),
      ...(filter.method && { method: filter.method }), ...(filter.postingStatus && { postingStatus: filter.postingStatus }),
      ...(filter.fromDate || filter.toDate ? { paymentDate: civilDayRangeToUtc(filter.fromDate, filter.toDate) } : {}),
      ...(relatedIds && { id: { in: [...relatedIds.SUPPLIER_PAYMENT] } }),
    }] };
    const [rows, total] = await Promise.all([this.prisma.client.supplierPayment.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { paymentDate: 'desc' }, include: { allocations: true } }), this.prisma.client.supplierPayment.count({ where })]);
    return { data: rows.map((r) => this.toSupplierPaymentRecord(r)), total };
  }

  async listSupplierPaymentJournalsForReversal(companyId: string, id: string): Promise<Array<{ id: string; periodKey: string }>> {
    const rows = await this.prisma.client.journalEntry.findMany({ where: {
      companyId, sourceId: id, sourceType: { in: ['procurement.supplier_payment', 'procurement.supplier_payment.pp36'] }, status: 'POSTED',
    }, select: { id: true, period: { select: { periodKey: true } } } });
    return rows.map((row) => ({ id: row.id, periodKey: row.period.periodKey }));
  }

  async voidSupplierPayment(
    companyId: string,
    id: string,
    voidedByUserId: string,
    voidReason: string,
    reversalEntryNumbers: Record<string, string> = {},
  ): Promise<{ payment: SupplierPaymentRecord; reversalJournals: Array<{ originalJournalId: string; reversalJournalId: string }> }> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const payment = await tx.supplierPayment.findFirst({ where: { id, companyId }, include: { allocations: true } });
      if (!payment) throw new NotFoundException('Supplier payment not found');
      if (payment.status === 'VOIDED') return { payment, reversalJournals: [] };
      if (payment.status !== 'RECORDED') throw new ConflictException('supplier_payment_not_voidable');
      const activeAllocations = payment.allocations.filter((allocation: any) => allocation.pp36RecognitionStatus === 'ACTIVE');
      const recognitions = activeAllocations.flatMap((allocation: any) => Array.isArray(allocation.pp36RecognitionJson) ? allocation.pp36RecognitionJson : []);
      const recognitionLineIds = new Set(recognitions.map((recognition: any) => recognition.vendorBillLineId));
      const unversionedAllocationIds = payment.allocations.filter((allocation: any) => !allocation.pp36RecognitionStatus).map((allocation) => allocation.vendorBillId);
      if (unversionedAllocationIds.length) {
        const legacyPp36Bills = await tx.vendorBill.findMany({ where: { id: { in: unversionedAllocationIds }, companyId, pp36Candidate: true }, select: { id: true } });
        if (legacyPp36Bills.length) throw new ConflictException('pp36_legacy_payment_reversal_requires_migration');
      }

      if (recognitionLineIds.size) {
        const adjustments = await tx.taxAdjustment.findMany({ where: { companyId, adjustmentType: 'CORRECTION' }, select: { metadataJson: true } });
        const releasedClaim = adjustments.some((adjustment: any) => adjustment.metadataJson?.kind === 'PP36_INPUT_CLAIM_RELEASE'
          && recognitionLineIds.has(adjustment.metadataJson.vendorBillLineId)
          && (!adjustment.metadataJson.supplierPaymentId || adjustment.metadataJson.supplierPaymentId === payment.id));
        if (releasedClaim) throw new ConflictException('pp36_input_claim_already_released_requires_amendment');
      }

      const taxEvents = await tx.taxEvent.findMany({ where: {
        companyId, sourceType: 'procurement.supplier_payment.pp36', sourceId: id, status: 'ACTIVE',
      }, include: { taxPeriod: true } });
      if (taxEvents.some((event) => ['FILED', 'PAID', 'CLOSED'].includes(String(event.taxPeriod.status)))) {
        throw new ConflictException('pp36_tax_period_locked_requires_amendment');
      }

      // ── Withholding (ภ.ง.ด.3/53) ──────────────────────────────────────────
      // Separate from the PP36 events above: different sourceType, different forms, and a period
      // that locks independently. Once ภ.ง.ด. has been filed the withholding is a submitted legal
      // fact, so a plain void is refused and an amendment is required instead.
      const whtEvents = await tx.taxEvent.findMany({ where: {
        companyId, sourceType: 'procurement.supplier_payment', sourceId: id, status: 'ACTIVE',
        eventType: { in: ['WHT_PND3', 'WHT_PND53'] },
      }, include: { taxPeriod: true } });
      if (whtEvents.some((event: any) => ['FILED', 'PAID', 'CLOSED'].includes(String(event.taxPeriod.status)))) {
        throw new ConflictException('wht_tax_period_locked_requires_amendment');
      }
      // The 50 ทวิ obligation. An UNLINKED handoff is just a to-do the void makes obsolete, so it is
      // cancelled below. One that already carries a certificate is different: a legal document
      // exists in the payee's hands, and silently voiding the payment underneath it would leave the
      // system disagreeing with a document the RD has. That needs a human, not a status flip.
      const issuedHandoffs = await tx.whtCertificateHandoff.count({ where: {
        companyId, sourcePaymentType: 'procurement.supplier_payment', sourcePaymentId: id,
        status: { in: ['EXTERNAL_LINKED', 'SYSTEM_ISSUED'] },
      } });
      if (issuedHandoffs > 0) throw new ConflictException('wht_certificate_linked_requires_review');

      const journals = await tx.journalEntry.findMany({ where: {
        companyId, sourceId: id, sourceType: { in: ['procurement.supplier_payment', 'procurement.supplier_payment.pp36'] }, status: { in: ['DRAFT', 'POSTED'] },
      }, include: { period: true, lines: { orderBy: { lineNumber: 'asc' } } } });
      if (journals.some((journal) => journal.status !== 'POSTED')) throw new ConflictException('supplier_payment_journal_draft_must_be_resolved');
      if (journals.some((journal) => journal.period.status !== 'OPEN')) throw new ConflictException('supplier_payment_accounting_period_locked');
      const reversalJournals: Array<{ originalJournalId: string; reversalJournalId: string }> = [];
      const now = new Date();
      for (const journal of journals) {
        const entryNumber = reversalEntryNumbers[journal.id];
        if (!entryNumber) throw new ConflictException('supplier_payment_reversal_number_missing');
        const reversal = await tx.journalEntry.create({ data: {
          companyId, periodId: journal.periodId, entryNumber, entryType: 'REVERSAL',
          sourceType: journal.sourceType, sourceId: journal.sourceId, reversalOfJournalEntryId: journal.id,
          status: 'POSTED', entryDate: journal.entryDate, postedAt: now, postedByUserId: voidedByUserId,
          memo: `[VOID ${payment.paymentNumber ?? payment.id}] ${voidReason}`, createdByUserId: voidedByUserId,
          lines: { create: journal.lines.map((line) => reversalJournalLineData(line)) },
        } });
        // Original stays POSTED: reports count POSTED entries only, so it nets
        // to zero against the reversal instead of double-subtracting.
        reversalJournals.push({ originalJournalId: journal.id, reversalJournalId: reversal.id });
      }

      if (taxEvents.length) {
        await tx.taxEvent.updateMany({ where: { id: { in: taxEvents.map((event) => event.id) } }, data: { status: 'REVERSED' } });
        for (const taxPeriodId of [...new Set(taxEvents.map((event) => event.taxPeriodId))]) {
          await tx.taxAdjustment.create({ data: {
            companyId, taxPeriodId, adjustmentType: 'REVERSAL', reason: `PP36_PAYMENT_VOID:${payment.id}`,
            adjustedByUserId: voidedByUserId, metadataJson: { kind: 'PP36_PAYMENT_REVERSAL', supplierPaymentId: payment.id, reason: voidReason, taxEventIds: taxEvents.filter((event) => event.taxPeriodId === taxPeriodId).map((event) => event.id) },
          } });
        }
      }
      if (whtEvents.length) {
        await tx.taxEvent.updateMany({ where: { id: { in: whtEvents.map((event: any) => event.id) } }, data: { status: 'REVERSED' } });
        for (const taxPeriodId of [...new Set(whtEvents.map((event: any) => event.taxPeriodId))]) {
          await tx.taxAdjustment.create({ data: {
            companyId, taxPeriodId, adjustmentType: 'REVERSAL', reason: `WHT_PAYMENT_VOID:${payment.id}`,
            adjustedByUserId: voidedByUserId, metadataJson: { kind: 'WHT_PAYMENT_REVERSAL', supplierPaymentId: payment.id, reason: voidReason, taxEventIds: whtEvents.filter((event: any) => event.taxPeriodId === taxPeriodId).map((event: any) => event.id) },
          } });
        }
      }
      // The withholding never happened, so neither does the certificate the payee was owed. Left
      // REQUIRED it would sit in the AP panel forever, asking someone to issue a 50 ทวิ for a
      // payment that no longer exists. Scoped to REQUIRED so a concurrent link wins instead of
      // being overwritten — the count guard above already refused that case, and this keeps the
      // write honest if one lands between the two statements. Only a withheld payment can have a
      // handoff at all, so a plain void skips the statement entirely.
      if (new Decimal(String(payment.whtAmount ?? '0')).gt(0)) {
        await tx.whtCertificateHandoff.updateMany({
          where: { companyId, sourcePaymentType: 'procurement.supplier_payment', sourcePaymentId: id, status: 'REQUIRED' },
          data: { status: 'CANCELLED' },
        });
      }
      if (activeAllocations.length) {
        await tx.supplierPaymentAllocation.updateMany({ where: { id: { in: activeAllocations.map((allocation) => allocation.id) } }, data: {
          pp36RecognitionStatus: 'REVERSED', pp36ReversedAt: now, pp36ReversedByUserId: voidedByUserId, pp36ReversalReason: voidReason,
        } });
      }
      for (const allocation of payment.allocations) {
        const bill = await tx.vendorBill.findFirst({ where: { id: allocation.vendorBillId, companyId } });
        if (!bill) throw new ConflictException('vendor_bill_missing_during_payment_void');
        const paid = Decimal.max(0, new Decimal(String(bill.paidAmount)).sub(allocation.amount));
        // §19d: outstanding re-rounds to satang so pre-policy 4dp residue stays
        // consistent with the settle rule after a void.
        const outstanding = round2(Decimal.max(0, new Decimal(String(bill.netPayableAmount)).sub(paid)));
        await tx.vendorBill.update({ where: { id: bill.id }, data: {
          paidAmount: paid.toFixed(4), outstandingAmount: outstanding.toFixed(4),
          status: (paid.isZero() ? 'APPROVED' : outstanding.isZero() ? 'PAID' : 'PARTIALLY_PAID') as any,
        } });
      }
      const voided = await tx.supplierPayment.update({ where: { id }, data: {
        status: 'VOIDED' as any, voidedByUserId, voidedAt: now, voidReason, postingStatus: 'reversed' as any,
      }, include: { allocations: true } });
      return { payment: voided, reversalJournals };
    });
    return { payment: this.toSupplierPaymentRecord(result.payment), reversalJournals: result.reversalJournals };
  }

  // ---- AP Aging ----

  async getApAgingData(companyId: string, asOfDate: Date, supplierId?: string): Promise<{ vendorBillId: string; supplierId: string; dueDate: Date; outstandingAmount: string; currency: string }[]> {
    const where: any = { companyId, status: { in: ['APPROVED', 'PARTIALLY_PAID'] as any[] }, ...(supplierId && { supplierId }) };
    const bills = await this.prisma.client.vendorBill.findMany({ where, select: { id: true, supplierId: true, dueDate: true, outstandingAmount: true, currency: true } });
    return bills.map((b) => ({ vendorBillId: b.id, supplierId: b.supplierId, dueDate: b.dueDate, outstandingAmount: decimal(b.outstandingAmount), currency: b.currency }));
  }

  // ---- Supplier Statement ----

  async getSupplierStatementData(companyId: string, supplierId: string, fromDate?: Date, toDate?: Date): Promise<{ bills: { id: string; billDate: Date; vendorBillNumber?: string; netPayableAmount: string }[]; payments: { id: string; paymentDate: Date; paymentNumber?: string; netPaidAmount: string }[] }> {
    const dateRange = { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) };
    const [bills, payments] = await Promise.all([
      this.prisma.client.vendorBill.findMany({ where: { companyId, supplierId, ...(fromDate || toDate ? { billDate: dateRange } : {}) }, orderBy: { billDate: 'asc' }, select: { id: true, billDate: true, vendorBillNumber: true, netPayableAmount: true } }),
      this.prisma.client.supplierPayment.findMany({ where: { companyId, supplierId, status: { not: 'VOIDED' as any }, ...(fromDate || toDate ? { paymentDate: dateRange } : {}) }, orderBy: { paymentDate: 'asc' }, select: { id: true, paymentDate: true, paymentNumber: true, netPaidAmount: true } }),
    ]);
    return { bills: bills.map((b) => ({ id: b.id, billDate: b.billDate, vendorBillNumber: b.vendorBillNumber ?? undefined, netPayableAmount: decimal(b.netPayableAmount) })), payments: payments.map((p) => ({ id: p.id, paymentDate: p.paymentDate, paymentNumber: p.paymentNumber ?? undefined, netPaidAmount: decimal(p.netPaidAmount) })) };
  }

  // ---- Mappers ----

  private toSupplierRecord(row: any): SupplierRecord {
    return {
      id: row.id, companyId: row.companyId, counterpartyId: row.counterpartyId,
      supplierCode: row.supplierCode ?? undefined, supplierType: row.supplierType,
      displayNameSnapshot: row.displayNameSnapshot, legalNameSnapshot: row.legalNameSnapshot ?? undefined,
      taxId: row.taxId ?? undefined, branchCode: row.branchCode ?? undefined,
      vatRegistered: row.vatRegistered ?? undefined, defaultVatMode: row.defaultVatMode ?? undefined,
      defaultInputVatClaimStatus: row.defaultInputVatClaimStatus ?? undefined,
      defaultWhtCategoryCode: row.defaultWhtCategoryCode ?? undefined,
      defaultPaymentTermsDays: row.defaultPaymentTermsDays ?? undefined,
      defaultExpenseCategoryKey: row.defaultExpenseCategoryKey ?? undefined,
      defaultAccountHint: row.defaultAccountHint ?? undefined,
      defaultCurrency: row.defaultCurrency, contactName: row.contactName ?? undefined,
      email: row.email ?? undefined, phone: row.phone ?? undefined,
      addressJson: row.addressJson as Record<string, unknown> ?? undefined,
      status: row.status, onHoldReason: row.onHoldReason ?? undefined,
      createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toBankAccountRecord(row: any): SupplierBankAccountRecord {
    return { id: row.id, companyId: row.companyId, supplierId: row.supplierId, bankName: row.bankName, bankCode: row.bankCode ?? undefined, accountName: row.accountName, accountNumberLast4: row.accountNumberLast4, branchName: row.branchName ?? undefined, isDefault: row.isDefault, status: row.status, createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  private toPurchaseRequestLineRecord(row: any): PurchaseRequestLineRecord {
    return { id: row.id, companyId: row.companyId, purchaseRequestId: row.purchaseRequestId, lineNumber: row.lineNumber, lineType: row.lineType, productId: row.productId ?? undefined, skuSnapshot: row.skuSnapshot ?? undefined, description: row.description, unitName: row.unitName ?? undefined, requestedQuantity: decimal(row.requestedQuantity), estimatedUnitPrice: decimal(row.estimatedUnitPrice), discountAmount: decimal(row.discountAmount), vatMode: row.vatMode, vatRate: row.vatRate != null ? decimal(row.vatRate) : undefined, vatAmount: decimal(row.vatAmount), lineSubtotalAmount: decimal(row.lineSubtotalAmount), lineTotalAmount: decimal(row.lineTotalAmount), accountHint: row.accountHint ?? undefined, inventoryLocationId: row.inventoryLocationId ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  private toPurchaseRequestRecord(row: any): PurchaseRequestRecord {
    return { id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined, requestNumber: row.requestNumber ?? undefined, status: row.status, requesterUserId: row.requesterUserId, neededByDate: row.neededByDate ?? undefined, supplierId: row.supplierId ?? undefined, supplierSnapshotJson: row.supplierSnapshotJson as any, reason: row.reason ?? undefined, budgetCode: row.budgetCode ?? undefined, currency: row.currency, subtotalAmount: decimal(row.subtotalAmount), discountAmount: decimal(row.discountAmount), taxableAmount: decimal(row.taxableAmount), vatAmount: decimal(row.vatAmount), whtEstimateAmount: row.whtEstimateAmount != null ? decimal(row.whtEstimateAmount) : undefined, grandTotalAmount: decimal(row.grandTotalAmount), submittedAt: row.submittedAt ?? undefined, approvedByUserId: row.approvedByUserId ?? undefined, approvedAt: row.approvedAt ?? undefined, rejectedByUserId: row.rejectedByUserId ?? undefined, rejectedAt: row.rejectedAt ?? undefined, approvalNote: row.approvalNote ?? undefined, convertedPurchaseOrderId: row.convertedPurchaseOrderId ?? undefined, createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt, lines: row.lines?.map((l: any) => this.toPurchaseRequestLineRecord(l)) };
  }

  private toPurchaseOrderLineRecord(row: any): PurchaseOrderLineRecord {
    return { id: row.id, companyId: row.companyId, purchaseOrderId: row.purchaseOrderId, sourcePurchaseRequestLineId: row.sourcePurchaseRequestLineId ?? undefined, lineNumber: row.lineNumber, lineType: row.lineType, productId: row.productId ?? undefined, skuSnapshot: row.skuSnapshot ?? undefined, description: row.description, unitName: row.unitName ?? undefined, orderedQuantity: decimal(row.orderedQuantity), receivedQuantity: decimal(row.receivedQuantity), billedQuantity: decimal(row.billedQuantity), unitPrice: decimal(row.unitPrice), discountAmount: decimal(row.discountAmount), vatMode: row.vatMode, vatRate: row.vatRate != null ? decimal(row.vatRate) : undefined, vatAmount: decimal(row.vatAmount), whtCategoryCode: row.whtCategoryCode ?? undefined, whtRate: row.whtRate != null ? decimal(row.whtRate) : undefined, whtEstimateAmount: row.whtEstimateAmount != null ? decimal(row.whtEstimateAmount) : undefined, lineSubtotalAmount: decimal(row.lineSubtotalAmount), lineTotalAmount: decimal(row.lineTotalAmount), accountHint: row.accountHint ?? undefined, inventoryLocationId: row.inventoryLocationId ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  private toPurchaseOrderRecord(row: any): PurchaseOrderRecord {
    return { id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined, purchaseOrderNumber: row.purchaseOrderNumber ?? undefined, status: row.status, supplierId: row.supplierId, supplierSnapshotJson: row.supplierSnapshotJson as any, sourcePurchaseRequestId: row.sourcePurchaseRequestId ?? undefined, orderDate: row.orderDate, expectedDeliveryDate: row.expectedDeliveryDate ?? undefined, paymentTermsDays: row.paymentTermsDays ?? undefined, currency: row.currency, subtotalAmount: decimal(row.subtotalAmount), discountAmount: decimal(row.discountAmount), taxableAmount: decimal(row.taxableAmount), vatAmount: decimal(row.vatAmount), whtEstimateAmount: row.whtEstimateAmount != null ? decimal(row.whtEstimateAmount) : undefined, grandTotalAmount: decimal(row.grandTotalAmount), receivedAmount: decimal(row.receivedAmount), billedAmount: decimal(row.billedAmount), outstandingAmount: decimal(row.outstandingAmount), matchingMode: row.matchingMode, postingStatus: row.postingStatus, taxSyncStatus: row.taxSyncStatus, issuedByUserId: row.issuedByUserId ?? undefined, issuedAt: row.issuedAt ?? undefined, approvedByUserId: row.approvedByUserId ?? undefined, approvedAt: row.approvedAt ?? undefined, rejectedByUserId: row.rejectedByUserId ?? undefined, rejectedAt: row.rejectedAt ?? undefined, cancelledByUserId: row.cancelledByUserId ?? undefined, cancelledAt: row.cancelledAt ?? undefined, cancelReason: row.cancelReason ?? undefined, closedByUserId: row.closedByUserId ?? undefined, closedAt: row.closedAt ?? undefined, closeReason: row.closeReason ?? undefined, createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt, lines: row.lines?.map((l: any) => this.toPurchaseOrderLineRecord(l)) };
  }

  private toGoodsReceiptLineRecord(row: any): GoodsReceiptLineRecord {
    return { id: row.id, companyId: row.companyId, goodsReceiptId: row.goodsReceiptId, purchaseOrderLineId: row.purchaseOrderLineId, lineNumber: row.lineNumber, lineType: row.lineType, productId: row.productId ?? undefined, description: row.description, inventoryLocationId: row.inventoryLocationId ?? undefined, orderedQuantity: decimal(row.orderedQuantity), previouslyReceivedQuantity: decimal(row.previouslyReceivedQuantity), receivedQuantity: decimal(row.receivedQuantity), acceptedQuantity: decimal(row.acceptedQuantity), rejectedQuantity: decimal(row.rejectedQuantity), unitName: row.unitName ?? undefined, inventoryMovementId: row.inventoryMovementId ?? undefined, varianceReason: row.varianceReason ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  private toGoodsReceiptRecord(row: any): GoodsReceiptRecord {
    return { id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined, goodsReceiptNumber: row.goodsReceiptNumber ?? undefined, status: row.status, purchaseOrderId: row.purchaseOrderId, supplierId: row.supplierId, supplierSnapshotJson: row.supplierSnapshotJson as any, receivedAt: row.receivedAt, receivedByUserId: row.receivedByUserId, note: row.note ?? undefined, inventoryMovementBatchRef: row.inventoryMovementBatchRef ?? undefined, postingStatus: row.postingStatus, voidedByUserId: row.voidedByUserId ?? undefined, voidedAt: row.voidedAt ?? undefined, voidReason: row.voidReason ?? undefined, createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt, lines: row.lines?.map((l: any) => this.toGoodsReceiptLineRecord(l)) };
  }

  private toVendorBillLineRecord(row: any): VendorBillLineRecord {
    const taxSnapshot = row.taxCodeDefinitionId || row.externalTaxCodeSnapshot ? {
      taxCodeDefinitionId: row.taxCodeDefinitionId ?? null, externalTaxCode: row.externalTaxCodeSnapshot ?? null,
      taxProfileKey: row.taxProfileKeySnapshot ?? null, taxProfileVersion: row.taxProfileVersionSnapshot ?? null,
      roundingMode: row.roundingModeSnapshot ?? undefined, roundingScale: row.roundingScaleSnapshot ?? undefined,
      taxAmountTolerance: row.taxAmountToleranceSnapshot?.toString() ?? undefined,
      taxRegime: row.taxRegimeSnapshot ?? null, taxDirection: row.taxDirectionSnapshot ?? null,
      taxTreatment: row.taxTreatmentSnapshot ?? null, taxContext: row.taxContextSnapshot ?? null,
      taxRate: row.taxRateSnapshot?.toString() ?? '0', sourceCurrency: row.sourceCurrencySnapshot ?? 'THB',
      taxCurrency: row.taxCurrencySnapshot ?? 'THB', exchangeRate: row.exchangeRateSnapshot?.toString() ?? '1',
      exchangeRateSource: row.exchangeRateSourceSnapshot ?? 'FUNCTIONAL_CURRENCY', exchangeRateDate: row.exchangeRateDateSnapshot?.toISOString?.().slice(0, 10) ?? '',
      taxBaseAmount: row.taxBaseAmount?.toString() ?? '0',
      taxAmount: row.transactionTaxAmount?.toString() ?? '0', claimability: row.claimabilitySnapshot ?? 'NOT_APPLICABLE',
      evidenceStatus: row.taxEvidenceReviewStatus ?? 'REVIEW_REQUIRED', accountRuleVersion: row.accountRuleVersionSnapshot ?? null,
      reportRuleVersion: row.reportRuleVersionSnapshot ?? null,
    } : undefined;
    return { id: row.id, companyId: row.companyId, vendorBillId: row.vendorBillId, purchaseOrderLineId: row.purchaseOrderLineId ?? undefined, goodsReceiptLineId: row.goodsReceiptLineId ?? undefined, lineNumber: row.lineNumber, lineType: row.lineType, productId: row.productId ?? undefined, skuSnapshot: row.skuSnapshot ?? undefined, description: row.description, unitName: row.unitName ?? undefined, quantity: decimal(row.quantity), unitPrice: decimal(row.unitPrice), discountAmount: decimal(row.discountAmount), vatMode: row.vatMode, vatRate: row.vatRate != null ? decimal(row.vatRate) : undefined, vatAmount: decimal(row.vatAmount), inputVatClaimStatus: row.inputVatClaimStatus, whtCategoryCode: row.whtCategoryCode ?? undefined, whtRate: row.whtRate != null ? decimal(row.whtRate) : undefined, whtAmount: decimal(row.whtAmount), lineSubtotalAmount: decimal(row.lineSubtotalAmount), lineTotalAmount: decimal(row.lineTotalAmount), accountHint: row.accountHint ?? undefined, assetCandidate: row.assetCandidate ?? undefined, taxSnapshot, taxComponents: Array.isArray(row.taxComponentsJson) ? row.taxComponentsJson : undefined, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  private toVendorBillRecord(row: any): VendorBillRecord {
    return { id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined, vendorBillNumber: row.vendorBillNumber ?? undefined, supplierDocumentNumber: row.supplierDocumentNumber ?? undefined, status: row.status, supplierId: row.supplierId, supplierSnapshotJson: row.supplierSnapshotJson as any, purchaseOrderId: row.purchaseOrderId ?? undefined, goodsReceiptId: row.goodsReceiptId ?? undefined, billDate: row.billDate, receivedDate: row.receivedDate ?? undefined, dueDate: row.dueDate, paymentTermsDays: row.paymentTermsDays ?? undefined, currency: row.currency, vatMode: row.vatMode, subtotalAmount: decimal(row.subtotalAmount), discountAmount: decimal(row.discountAmount), taxableAmount: decimal(row.taxableAmount), vatAmount: decimal(row.vatAmount), inputVatClaimStatus: row.inputVatClaimStatus, whtCategoryCode: row.whtCategoryCode ?? undefined, whtRate: row.whtRate != null ? decimal(row.whtRate) : undefined, whtAmount: decimal(row.whtAmount), grandTotalAmount: decimal(row.grandTotalAmount), netPayableAmount: decimal(row.netPayableAmount), paidAmount: decimal(row.paidAmount), outstandingAmount: decimal(row.outstandingAmount), matchingMode: row.matchingMode, matchingStatus: row.matchingStatus, matchingVarianceAmount: decimal(row.matchingVarianceAmount), matchingOverrideReason: row.matchingOverrideReason ?? undefined, taxInvoiceNumber: row.taxInvoiceNumber ?? undefined, taxInvoiceDate: row.taxInvoiceDate ?? undefined, pp36Candidate: row.pp36Candidate, attachmentId: row.attachmentId ?? undefined, taxEvidenceRequired: row.taxEvidenceRequired ?? false, taxEvidenceReviewStatus: row.taxEvidenceReviewStatus ?? 'DRAFT', reviewIssues: Array.isArray(row.taxReviewIssuesJson) ? row.taxReviewIssuesJson.filter((item: unknown): item is string => typeof item === 'string') : [], taxEvidenceReviewedByUserId: row.taxEvidenceReviewedByUserId ?? undefined, taxEvidenceReviewedAt: row.taxEvidenceReviewedAt ?? undefined, postingStatus: row.postingStatus, taxSyncStatus: row.taxSyncStatus, journalEntryId: row.journalEntryId ?? undefined, postingError: row.postingError ?? undefined, approvedByUserId: row.approvedByUserId ?? undefined, approvedAt: row.approvedAt ?? undefined, voidedByUserId: row.voidedByUserId ?? undefined, voidedAt: row.voidedAt ?? undefined, voidReason: row.voidReason ?? undefined, createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt, lines: row.lines?.map((l: any) => this.toVendorBillLineRecord(l)) };
  }

  private toSupplierPaymentRecord(row: any): SupplierPaymentRecord {
    const allocations = row.allocations?.map((a: any) => ({
      id: a.id, companyId: a.companyId, supplierPaymentId: a.supplierPaymentId, vendorBillId: a.vendorBillId,
      amount: decimal(a.amount), whtAmount: a.whtAmount != null ? decimal(a.whtAmount) : undefined,
      pp36RecognitionJson: Array.isArray(a.pp36RecognitionJson) ? a.pp36RecognitionJson : undefined,
      pp36RecognitionStatus: a.pp36RecognitionStatus ?? undefined,
      pp36ReversedAt: a.pp36ReversedAt ?? undefined, pp36ReversedByUserId: a.pp36ReversedByUserId ?? undefined,
      pp36ReversalReason: a.pp36ReversalReason ?? undefined,
      allocatedAt: a.allocatedAt, createdByUserId: a.createdByUserId, createdAt: a.createdAt,
    }));
    return { id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined, paymentNumber: row.paymentNumber ?? undefined, status: row.status, supplierId: row.supplierId, supplierSnapshotJson: row.supplierSnapshotJson as any, paymentDate: row.paymentDate, method: row.method, currency: row.currency, grossAmount: decimal(row.grossAmount), whtAmount: decimal(row.whtAmount), whtCategoryCode: row.whtCategoryCode ?? undefined, whtRate: row.whtRate != null ? decimal(row.whtRate) : undefined, netPaidAmount: decimal(row.netPaidAmount), allocatedAmount: decimal(row.allocatedAmount), unappliedAmount: decimal(row.unappliedAmount), bankAccountRef: row.bankAccountRef ?? undefined, supplierBankAccountId: row.supplierBankAccountId ?? undefined, externalReference: row.externalReference ?? undefined, note: row.note ?? undefined, postingStatus: row.postingStatus, taxSyncStatus: row.taxSyncStatus, pp36RecognitionStatus: allocations?.some((a: any) => a.pp36RecognitionStatus === 'ACTIVE') ? 'ACTIVE' : allocations?.some((a: any) => a.pp36RecognitionStatus === 'REVERSED') ? 'REVERSED' : undefined, journalEntryId: row.journalEntryId ?? undefined, recordedByUserId: row.recordedByUserId ?? undefined, recordedAt: row.recordedAt ?? undefined, voidedByUserId: row.voidedByUserId ?? undefined, voidedAt: row.voidedAt ?? undefined, voidReason: row.voidReason ?? undefined, createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt, allocations };
  }
}

/**
 * Records the durable EXTERNAL_CERTIFICATE_REQUIRED handoff for a settled supplier payment that
 * withheld tax, inside the settlement transaction.
 *
 * Prefill is best-effort by design: every field is copied from what the system already holds, and
 * anything it cannot truly derive stays null rather than being invented (spec:208). An operator
 * filling one genuinely-unknown field is correct; a fabricated income category on a legal document
 * is not.
 */
async function createWhtHandoffForPayment(tx: any, input: {
  companyId: string;
  payment: { id: string; branchId?: string | null };
  supplier: { id: string; supplierType?: string | null; displayNameSnapshot?: string | null; legalNameSnapshot?: string | null; taxId?: string | null; branchCode?: string | null; addressJson?: unknown };
  data: { grossAmount: string; whtAmount?: string; whtCategoryCode?: string; whtRate?: string; paymentDate: Date; branchId?: string };
  createdByUserId: string;
}): Promise<void> {
  const { companyId, payment, supplier, data } = input;
  const withheldAmount = String(data.whtAmount ?? '0');
  const [company, category, payerBranch] = await Promise.all([
    tx.company.findUnique({ where: { id: companyId }, select: { name: true, registeredName: true, taxId: true, addressJson: true } }),
    data.whtCategoryCode ? tx.whtIncomeCategory.findUnique({ where: { code: data.whtCategoryCode }, select: { nameTh: true } }) : Promise.resolve(null),
    data.branchId ? tx.branch.findUnique({ where: { companyId_id: { companyId, id: data.branchId } }, select: { taxBranchCode: true } }) : Promise.resolve(null),
  ]);
  const prefill = {
    payerSnapshot: {
      companyName: company?.registeredName ?? company?.name ?? 'Unknown company',
      taxId: company?.taxId ?? null,
      branchCode: payerBranch?.taxBranchCode ?? null,
      address: company?.addressJson ? JSON.stringify(company.addressJson) : null,
    },
    payeeSnapshot: {
      name: supplier.legalNameSnapshot ?? supplier.displayNameSnapshot ?? 'Unknown payee',
      taxId: supplier.taxId ?? null,
      address: supplier.addressJson ? JSON.stringify(supplier.addressJson) : null,
      branchCode: supplier.branchCode ?? null,
    },
    // The RD form follows the payee's taxpayer class. Only these two classes map to a form with
    // certainty; anything else is left for the operator rather than guessed.
    formType: supplier.supplierType === 'JURISTIC_PERSON' ? 'PND53'
      : supplier.supplierType === 'INDIVIDUAL' ? 'PND3' : null,
    // The payment now carries the withholding decision itself, so the category and rate are real
    // recorded facts rather than blanks for the operator to reconstruct.
    incomeCategoryCode: data.whtCategoryCode ?? null,
    incomeCategoryName: category?.nameTh ?? null,
    whtRate: data.whtRate ?? null,
    // The income withheld on, not the settlement total — the payment gross includes VAT, which is
    // not income to the payee. Keeping this consistent with the ภ.ง.ด. event is why the derivation
    // is shared (deriveWhtIncomeBase) instead of written out at each site.
    grossAmount: deriveWhtIncomeBase(withheldAmount, data.whtRate) ?? String(data.grossAmount),
    withheldAmount,
    paymentDate: data.paymentDate.toISOString(),
  };
  await tx.whtCertificateHandoff.create({
    data: {
      companyId,
      status: 'REQUIRED',
      sourcePaymentType: 'procurement.supplier_payment',
      sourcePaymentId: payment.id,
      payeeId: supplier.id,
      // The PAYEE's tax branch code, for the certificate itself...
      branchCode: supplier.branchCode ?? null,
      // ...and the INTERNAL branch that made the payment, so the handoff can be attributed and
      // filtered by branch. Attribution only — no AP surface authorizes on branch today.
      sourceBranchId: data.branchId ?? null,
      sourceFeatureKey: 'procurement',
      taxPeriodId: null,
      taxEventIdsJson: [],
      prefillSnapshotJson: prefill,
      prefillSnapshotHash: createHash('sha256').update(JSON.stringify(prefill)).digest('hex'),
      availabilityVectorJson: { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE', state: 'CLOSED' },
      creationCommandId: `wht-cert:${companyId}:procurement.supplier_payment:${payment.id}:${supplier.id}`,
      payloadFingerprint: createHash('sha256').update(JSON.stringify(prefill)).digest('hex'),
    },
  });
}
