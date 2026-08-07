import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { LEDGER_SEQUENCE_KEY, PROCUREMENT_SEQUENCE_KEYS } from '@watchdog-bms/contracts';
import { d, SETTLE_EPSILON, vendorBillTaxSourceChecksum } from '../../domain/logic/procurement.logic';
import type { SupplierPaymentRecord } from '../../domain/models/procurement.model';
import { WhtCertificateHandoffUseCase } from '../../../tax/application/use-cases/wht-certificate-handoff.use-case';
import type { LedgerSourcePostingInput, ResolveTransactionTaxPreviewDto } from '@watchdog-bms/contracts';
import { TransactionTaxConfigUseCase } from '../../../tax/application/use-cases/transaction-tax-config.use-case';
import { formatTransactionTaxAmount } from '../../../tax/domain/logic/transaction-tax.logic';

@Injectable()
export class CreateSupplierPaymentUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly transactionTax: TransactionTaxConfigUseCase,
    private readonly whtHandoffs: WhtCertificateHandoffUseCase,
  ) {}

  async execute(ctx: RequestContext, dto: {
    idempotencyKey?: string;
    supplierId: string; branchId?: string; paymentDate: Date; method: string; currency?: string;
    grossAmount: string; whtAmount?: string; whtCategoryCode?: string; whtRate?: string; netPaidAmount: string;
    bankAccountRef?: string; supplierBankAccountId?: string; externalReference?: string; note?: string;
    supplierSnapshotJson?: Record<string, unknown>;
    allocations: { vendorBillId: string; amount: string; whtAmount?: string; pp36PaymentEvidenceIds?: string[] }[];
  }): Promise<SupplierPaymentRecord> {
    if (!ctx.permissions.includes('procurement.supplier_payment.create')) throw new ForbiddenException();
    // Recording a supplier payment releases funds, so it demands the CRITICAL
    // release key on top of create. NOTE (GAP-03, 2026-07-29): both checks hit
    // the SAME actor on the SAME call — this is a second lock, not a
    // preparer/releaser split. A true two-step release flow is backlog.
    if (!ctx.permissions.includes('procurement.supplier_payment.release')) throw new ForbiddenException('Missing permission: procurement.supplier_payment.release');

    const paymentDate = dto.paymentDate instanceof Date ? dto.paymentDate : new Date(dto.paymentDate);
    if (Number.isNaN(paymentDate.getTime())) throw new BadRequestException('paymentDate is invalid');
    const idempotencyKey = dto.idempotencyKey?.trim() || ctx.requestId;
    if (!idempotencyKey || idempotencyKey.length > 128) throw new BadRequestException('A payment idempotency key of at most 128 characters is required');
    if (idempotencyKey) {
      const existing = await this.repo.findSupplierPaymentByIdempotencyKey(ctx.companyId, idempotencyKey);
      if (existing) return existing;
    }
    const supplier = await this.repo.findSupplierById(ctx.companyId, dto.supplierId);
    if (!supplier) throw new BadRequestException('Supplier does not exist in this company');
    if (supplier.status !== 'ACTIVE') throw new BadRequestException('Supplier is not active for payment');
    if (dto.branchId) {
      if (ctx.scopes?.branchIds && !ctx.scopes.branchIds.includes(dto.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
      if (!await this.repo.branchExists(ctx.companyId, dto.branchId)) throw new BadRequestException('Branch does not exist in this company');
    } else if (ctx.scopes?.branchIds) {
      throw new ForbiddenException('A branch-scoped user must create the supplier payment in an assigned branch.');
    }
    if (dto.supplierBankAccountId && !await this.repo.findSupplierBankAccountById(ctx.companyId, dto.supplierId, dto.supplierBankAccountId)) {
      throw new BadRequestException('Supplier bank account is not active or does not belong to this supplier');
    }
    const allocationIds = dto.allocations.map((allocation) => allocation.vendorBillId);
    if (new Set(allocationIds).size !== allocationIds.length) throw new BadRequestException('Duplicate vendor bill allocations are not allowed');
    const paymentCurrency = dto.currency ?? 'THB';

    // A withheld payment is a withholding DECISION, not just a smaller number: the 50 ทวิ names the
    // income category and the ภ.ง.ด. attachment groups by category and rate. Neither is derivable
    // from a payment header, so both are required up front rather than left for someone to
    // reconstruct later from a settled row.
    const whtTotal = d(dto.whtAmount ?? '0');
    if (whtTotal.lt(0)) throw new BadRequestException('whtAmount cannot be negative');
    if (whtTotal.gt(0)) {
      if (!dto.whtCategoryCode?.trim()) throw new BadRequestException('whtCategoryCode is required when tax is withheld');
      if (!dto.whtRate) throw new BadRequestException('whtRate is required when tax is withheld');
      // The rate is a PERCENT here. Zero would make the income base (withheld / rate) undefined,
      // and the sync derives that base rather than reusing the VAT-inclusive payment gross.
      const rate = d(dto.whtRate);
      if (rate.lte(0) || rate.gt(100)) throw new BadRequestException('whtRate must be a percentage greater than 0 and at most 100');
      // The category is printed on the 50 ทวิ and groups the ภ.ง.ด. attachment, so a free-typed
      // code would put an unverified label on a legal document. DRAFT rows count as absent: the
      // catalog ships unverified and an accountant activates what they have checked.
      if (!await this.repo.findActiveWhtIncomeCategory(dto.whtCategoryCode.trim())) {
        throw new BadRequestException({
          code: 'wht_income_category_not_active',
          message: `WHT income category ${dto.whtCategoryCode} is not active; an accountant must verify and activate it first`,
        });
      }
    }

    // Validate allocations and finalize PP36 snapshots before any payment-side mutation.
    let allocatedTotal = d('0');
    let allocatedWht = d('0');
    const taxRecognitions: Array<{
      vendorBillId: string; lineId: string; sourceTaxBaseAmount: string;
      expectedBillPaidAmount: string; expectedBillOutstandingAmount: string; expectedBillTaxSourceChecksum: string;
      evidenceIds: string[]; preview: ResolveTransactionTaxPreviewDto;
    }> = [];
    for (const alloc of dto.allocations) {
      const bill = await this.repo.findVendorBillById(ctx.companyId, alloc.vendorBillId);
      if (!bill) throw new BadRequestException(`Vendor bill ${alloc.vendorBillId} not found`);
      if (bill.supplierId !== dto.supplierId) throw new BadRequestException(`Vendor bill ${alloc.vendorBillId} does not belong to supplier ${dto.supplierId}`);
      if ((bill.branchId ?? null) !== (dto.branchId ?? null)) throw new BadRequestException(`Vendor bill ${alloc.vendorBillId} branch does not match the payment branch`);
      if (bill.currency !== paymentCurrency) throw new BadRequestException(`Vendor bill ${alloc.vendorBillId} currency does not match the payment currency`);
      if (!['APPROVED', 'PARTIALLY_PAID'].includes(bill.status)) throw new BadRequestException(`Vendor bill ${alloc.vendorBillId} is not in a payable status`);
      const amount = d(alloc.amount);
      if (amount.lte(0)) throw new BadRequestException(`Allocation for vendor bill ${alloc.vendorBillId} must be greater than zero`);
      // §19d: pre-policy bills store 4dp outstanding (e.g. 579.9958); paying the
      // printed satang amount may overshoot by under half a satang and must
      // settle, not reject. Anything above that is a real overpayment.
      if (amount.sub(d(bill.outstandingAmount)).gt(SETTLE_EPSILON)) throw new BadRequestException(`Allocation for vendor bill ${alloc.vendorBillId} exceeds outstanding amount`);
      const allocWht = d(alloc.whtAmount ?? '0');
      if (allocWht.lt(0)) throw new BadRequestException(`Allocation for vendor bill ${alloc.vendorBillId} cannot withhold a negative amount`);
      // Withholding the whole allocation would pay the vendor nothing while still clearing the debt.
      if (allocWht.gte(amount)) throw new BadRequestException(`Allocation for vendor bill ${alloc.vendorBillId} cannot withhold its entire amount`);
      // A bill whose own whtAmount is set already deducted the tax at accrual: its netPayable, and
      // therefore its outstanding, is the after-tax figure. Withholding again here would take the
      // tax twice — once from the vendor, once from the ledger — and over-report it to the RD.
      if (allocWht.gt(0) && d(bill.whtAmount ?? '0').gt(0)) {
        throw new BadRequestException({
          code: 'wht_double_withholding',
          message: `Vendor bill ${alloc.vendorBillId} already withheld tax when it was recorded; do not withhold again on payment`,
        });
      }
      allocatedWht = allocatedWht.add(allocWht);
      const pp36 = bill.pp36Candidate || (bill.lines ?? []).some((line) => line.taxSnapshot?.taxContext === 'IMPORT_SERVICE');
      if (pp36) {
        const evidenceIds = [...new Set(alloc.pp36PaymentEvidenceIds ?? [])];
        if (!evidenceIds.length) throw new BadRequestException({ code: 'pp36_payment_evidence_required', message: 'Each PP36 payment allocation requires exact verified PAYMENT_EVIDENCE.' });
        const pp36Lines = (bill.lines ?? []).filter((line) => line.taxSnapshot?.taxContext === 'IMPORT_SERVICE');
        const evidence = await this.repo.findVerifiedPp36PaymentEvidence(ctx.companyId, bill.id, bill.branchId, pp36Lines.map((line) => line.id), evidenceIds);
        if (evidence.length !== evidenceIds.length) {
          throw new BadRequestException({ code: 'pp36_payment_evidence_invalid', message: 'PAYMENT_EVIDENCE must be verified, unused, and bound to this vendor bill, branch, and source line.' });
        }
        const paidBefore = d(bill.paidAmount);
        const payable = d(bill.netPayableAmount);
        const expectedBillTaxSourceChecksum = vendorBillTaxSourceChecksum(bill);
        if (payable.lte(0)) throw new BadRequestException({ code: 'pp36_payable_invalid', message: 'PP36 recognition requires a positive vendor-bill net payable amount.' });
        // §19d half-satang settle: sub-satang residue still counts as final.
        const finalPayment = d(bill.outstandingAmount).sub(amount).lt(SETTLE_EPSILON);
        for (const line of bill.lines ?? []) {
          if (line.taxSnapshot?.taxContext !== 'IMPORT_SERVICE') continue;
          if (!line.taxSnapshot.taxCodeDefinitionId && !line.taxSnapshot.externalTaxCode) {
            throw new BadRequestException({ code: 'pp36_tax_snapshot_missing', message: `Vendor bill line ${line.id} has no server-resolved PP36 Tax Code.` });
          }
          const evidenceRefs = evidence.filter((item) => !item.sourceLineId || item.sourceLineId === line.id).map((item) => item.id);
          if (!evidenceRefs.length) throw new BadRequestException({ code: 'pp36_payment_evidence_invalid', message: `Vendor bill line ${line.id} has no exact verified PAYMENT_EVIDENCE for this payment.` });
          const fullSourceBase = d(line.lineSubtotalAmount).abs().toDecimalPlaces(4);
          const previousSourceBase = fullSourceBase.mul(paidBefore).div(payable).toDecimalPlaces(4);
          const targetSourceBase = finalPayment
            ? fullSourceBase
            : fullSourceBase.mul(paidBefore.add(amount)).div(payable).toDecimalPlaces(4);
          const sourceTaxBaseAmount = targetSourceBase.sub(previousSourceBase).toFixed(4);
          if (d(sourceTaxBaseAmount).lte(0)) throw new BadRequestException({ code: 'pp36_recognition_amount_invalid', message: 'PP36 payment produced no remaining tax base to recognize.' });
          const roundingPolicy = {
            roundingMode: line.taxSnapshot.roundingMode,
            roundingScale: line.taxSnapshot.roundingScale,
            taxAmountTolerance: line.taxSnapshot.taxAmountTolerance,
          };
          const fullTaxBaseAmount = d(line.taxSnapshot.taxBaseAmount).abs();
          const fullTaxAmount = d(line.taxSnapshot.taxAmount).abs();
          const cumulativeTaxBase = (paidAmount: ReturnType<typeof d>) => d(formatTransactionTaxAmount(fullTaxBaseAmount.mul(paidAmount).div(payable), roundingPolicy));
          const cumulativeTax = (paidAmount: ReturnType<typeof d>) => d(formatTransactionTaxAmount(fullTaxAmount.mul(paidAmount).div(payable), roundingPolicy));
          const previousTaxBaseAmount = cumulativeTaxBase(paidBefore);
          const targetTaxBaseAmount = finalPayment ? fullTaxBaseAmount : cumulativeTaxBase(paidBefore.add(amount));
          const recognizedTaxBaseAmount = formatTransactionTaxAmount(targetTaxBaseAmount.sub(previousTaxBaseAmount), roundingPolicy);
          const previousTaxAmount = cumulativeTax(paidBefore);
          const targetTaxAmount = finalPayment ? fullTaxAmount : cumulativeTax(paidBefore.add(amount));
          const recognizedTaxAmount = formatTransactionTaxAmount(targetTaxAmount.sub(previousTaxAmount), roundingPolicy);
          taxRecognitions.push({
            vendorBillId: bill.id, lineId: line.id, sourceTaxBaseAmount,
            expectedBillPaidAmount: bill.paidAmount, expectedBillOutstandingAmount: bill.outstandingAmount, expectedBillTaxSourceChecksum,
            evidenceIds: evidenceRefs, preview: await this.transactionTax.resolveSourceTax(ctx, {
            branchId: bill.branchId, sourceType: 'procurement.vendor_bill', sourceId: bill.id, sourceLineId: line.id,
            transactionContext: 'IMPORT_SERVICE', documentDate: bill.billDate.toISOString(), paymentDate: paymentDate.toISOString(),
            currency: bill.currency, taxCodeDefinitionId: line.taxSnapshot.taxCodeDefinitionId ?? undefined,
            externalTaxCode: line.taxSnapshot.externalTaxCode ?? undefined,
            netAmount: sourceTaxBaseAmount, grossAmount: sourceTaxBaseAmount, evidenceRefs,
          }, 'FINAL', undefined, 'SELF_ASSESSED', 'procurement', {
            authoritativeSelfAssessedTaxBaseAmount: recognizedTaxBaseAmount,
            authoritativeSelfAssessedTaxAmount: recognizedTaxAmount,
            historicalSnapshot: line.taxSnapshot,
          }) });
        }
      }
      allocatedTotal = allocatedTotal.add(amount);
    }
    // Allocations clear DEBT, so they sum to the gross — the withheld part settles the bill just as
    // surely as the cash does, it simply goes to the RD instead of the vendor. This used to compare
    // against netPaid, which is identical whenever nothing is withheld (every caller before this
    // change) but would reject a withheld payment as an underpayment.
    if (!allocatedTotal.eq(d(dto.grossAmount))) {
      throw new BadRequestException('Supplier overpayment or unapplied payment is not allowed');
    }
    // Checked even when the header withholds nothing: otherwise an allocation could carry tax the
    // header never declared, and the certificate and ledger would disagree with the allocations.
    if (!allocatedWht.eq(whtTotal)) {
      throw new BadRequestException('Allocation withholding must add up to the payment whtAmount');
    }
    if (!d(dto.grossAmount).sub(whtTotal).eq(d(dto.netPaidAmount))) {
      throw new BadRequestException('netPaidAmount must equal grossAmount minus whtAmount');
    }

    const now = new Date();
    const periodKey = paymentDate.toISOString().slice(0, 7);
    const reserved = await this.reserveNumber.execute({ companyId: ctx.companyId, documentType: PROCUREMENT_SEQUENCE_KEYS.PAYMENT, periodKey, reservedByUserId: ctx.userId, idempotencyKey: `pay:${ctx.companyId}:${idempotencyKey}` });

    // A payment that withheld tax owes the payee a 50 ทวิ. Ask the control plane whether the system
    // may issue it; a CLOSED route never blocks the payment (spec:299), it only decides that the
    // certificate becomes an external handoff created atomically with the settlement below.
    const whtSystemIssuanceOpen = await this.whtHandoffs.isSystemIssuanceOpen();

    const payment = await this.repo.createSupplierPayment(ctx.companyId, { ...dto, paymentDate, paymentNumber: reserved.documentNumber, idempotencyKey }, ctx.userId, taxRecognitions, { whtSystemIssuanceOpen });
    await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'supplier_payment', ownerId: payment.id }, ctx.userId);

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.supplier_payment.create', targetType: 'supplier_payment', targetId: payment.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { supplierId: dto.supplierId, paymentNumber: reserved.documentNumber, netPaidAmount: dto.netPaidAmount, method: dto.method, allocationCount: dto.allocations.length } });
    void this.outbox.append('supplier_payment.recorded', 'supplier_payment', payment.id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'supplier_payment', aggregateId: payment.id, occurredAt: now.toISOString(), data: { status: 'RECORDED', supplierId: dto.supplierId, paymentNumber: reserved.documentNumber, netPaidAmount: dto.netPaidAmount, taxSyncStatus: 'pending' } });
    return payment;
  }
}

@Injectable()
export class GetSupplierPaymentUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<SupplierPaymentRecord> {
    if (!ctx.permissions.includes('procurement.supplier_payment.read')) throw new ForbiddenException();
    const payment = await this.repo.findSupplierPaymentById(ctx.companyId, id);
    if (!payment) throw new NotFoundException('Supplier payment not found');
    return payment;
  }
}

export function buildSupplierPaymentPostingSource(payment: SupplierPaymentRecord): LedgerSourcePostingInput {
  if (payment.status !== 'RECORDED') throw new BadRequestException(`Cannot post supplier payment with status ${payment.status}`);
  const sourceDate = payment.paymentDate.toISOString();
  const lines = (payment.allocations ?? []).map((allocation) => ({
    sourceLineId: allocation.id,
    description: `ชำระ Vendor Bill ${allocation.vendorBillId}`,
    netAmount: allocation.amount,
  }));
  return {
    companyId: payment.companyId,
    branchId: payment.branchId,
    sourceType: 'procurement.supplier_payment',
    sourceId: payment.id,
    sourceEventType: 'accounting.payment.made',
    idempotencyKey: `supplier-payment:${payment.id}:recorded`,
    documentNumber: payment.paymentNumber,
    sourceDate,
    periodKey: sourceDate.slice(0, 7),
    currency: payment.currency,
    counterpartyId: payment.supplierId,
    // The debt cleared, not the cash paid: AP must be debited by the full amount the bills were
    // settled for, or the withheld part stays open against the vendor forever. `whtTotal` is what
    // lets the posting engine split the credit side between cash and the RD liability.
    totalAmount: payment.grossAmount,
    taxTotal: '0',
    whtTotal: payment.whtAmount,
    lines: lines.length > 0 ? lines : [{ sourceLineId: payment.id, description: payment.note ?? payment.paymentNumber ?? payment.id, netAmount: payment.grossAmount }],
    payment: { paymentDate: sourceDate, method: payment.method, amount: payment.netPaidAmount, reference: payment.externalReference },
  };
}

export function buildSupplierPaymentPp36PostingSource(payment: SupplierPaymentRecord): LedgerSourcePostingInput {
  if (payment.status !== 'RECORDED') throw new BadRequestException(`Cannot post PP36 for supplier payment with status ${payment.status}`);
  const recognitions = (payment.allocations ?? []).flatMap((allocation) => allocation.pp36RecognitionStatus === 'ACTIVE'
    ? (allocation.pp36RecognitionJson ?? []).map((recognition) => ({ allocation, recognition })) : []);
  if (!recognitions.length) throw new BadRequestException({ code: 'pp36_payment_recognition_missing', message: 'Supplier payment has no active immutable PP36 recognition snapshots.' });
  const taxCurrencies = new Set(recognitions.map(({ recognition }) => recognition.preview.snapshot.taxCurrency));
  if (taxCurrencies.size !== 1) throw new BadRequestException({ code: 'mixed_currency_tax_snapshot', message: 'PP36 recognition snapshots must use one functional currency.' });
  const sourceDate = payment.paymentDate.toISOString();
  return {
    companyId: payment.companyId, branchId: payment.branchId,
    sourceType: 'procurement.supplier_payment.pp36', sourceId: payment.id,
    sourceEventType: 'procurement.supplier_payment.pp36_payment',
    idempotencyKey: `supplier-payment:pp36:${payment.id}`,
    documentNumber: payment.paymentNumber, sourceDate, periodKey: sourceDate.slice(0, 7),
    currency: [...taxCurrencies][0]!, counterpartyId: payment.supplierId,
    totalAmount: '0', taxTotal: '0', whtTotal: '0', paidAmount: payment.netPaidAmount,
    lines: recognitions.map(({ allocation, recognition }) => ({
      sourceLineId: recognition.recognitionKey,
      description: `PP36 payment ${payment.paymentNumber ?? payment.id} / bill ${allocation.vendorBillId}`,
      netAmount: '0', vatAmount: '0', whtAmount: '0',
      taxSnapshot: recognition.preview.snapshot,
      taxComponents: recognition.preview.components.filter((component) => ['PP36_OUTPUT', 'PP36_INPUT'].includes(component.componentKey)),
    })),
  };
}

@Injectable()
export class GetSupplierPaymentPostingSourceUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<LedgerSourcePostingInput> {
    if (!ctx.permissions.includes('procurement.supplier_payment.read')) throw new ForbiddenException();
    const payment = await this.repo.findSupplierPaymentById(ctx.companyId, id);
    if (!payment) throw new NotFoundException('Supplier payment not found');
    if (payment.branchId && ctx.scopes?.branchIds && !ctx.scopes.branchIds.includes(payment.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    return buildSupplierPaymentPostingSource(payment);
  }
}

@Injectable()
export class GetSupplierPaymentPp36PostingSourceUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<LedgerSourcePostingInput> {
    if (!ctx.permissions.includes('procurement.supplier_payment.read')) throw new ForbiddenException();
    const payment = await this.repo.findSupplierPaymentById(ctx.companyId, id);
    if (!payment) throw new NotFoundException('Supplier payment not found');
    if (payment.branchId && ctx.scopes?.branchIds && !ctx.scopes.branchIds.includes(payment.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    return buildSupplierPaymentPp36PostingSource(payment);
  }
}

@Injectable()
export class ListSupplierPaymentsUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, filter: { status?: string; supplierId?: string; method?: string; postingStatus?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number }): Promise<{ data: SupplierPaymentRecord[]; total: number; page: number; pageSize: number }> {
    if (!ctx.permissions.includes('procurement.supplier_payment.read')) throw new ForbiddenException();
    const { data, total } = await this.repo.listSupplierPayments(ctx.companyId, filter);
    return { data, total, page: filter.page ?? 1, pageSize: filter.pageSize ?? 20 };
  }
}

@Injectable()
export class VoidSupplierPaymentUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string, reason: string): Promise<SupplierPaymentRecord> {
    if (!ctx.permissions.includes('procurement.supplier_payment.void')) throw new ForbiddenException();
    if (!reason?.trim() || reason.trim().length > 500) throw new BadRequestException('A void reason of 1-500 characters is required');
    const payment = await this.repo.findSupplierPaymentById(ctx.companyId, id);
    if (!payment) throw new NotFoundException('Supplier payment not found');
    if (payment.status === 'VOIDED') return payment;
    if (payment.status !== 'RECORDED') throw new BadRequestException(`Cannot void payment with status ${payment.status}`);
    if (payment.pp36RecognitionStatus === 'ACTIVE' && !ctx.permissions.includes('tax.review_issue.resolve')) throw new ForbiddenException('Missing permission: tax.review_issue.resolve');
    const journals = await this.repo.listSupplierPaymentJournalsForReversal(ctx.companyId, id);
    if (journals.length && !ctx.permissions.includes('journal.entry.reverse')) throw new ForbiddenException('Missing permission: journal.entry.reverse');
    const reservations = await Promise.all(journals.map(async (journal) => ({ journalId: journal.id, reservation: await this.reserveNumber.execute({
      companyId: ctx.companyId, documentType: LEDGER_SEQUENCE_KEY, periodKey: journal.periodKey,
      reservedByUserId: ctx.userId, idempotencyKey: `supplier-payment-void:${id}:${journal.id}`,
    }) })));
    const { payment: voided, reversalJournals } = await this.repo.voidSupplierPayment(
      ctx.companyId, id, ctx.userId, reason.trim(), Object.fromEntries(reservations.map((item) => [item.journalId, item.reservation.documentNumber])),
    );
    await Promise.all(reservations.map((item) => this.commitNumber.execute({
      id: item.reservation.id, companyId: ctx.companyId, ownerType: 'journal_entry',
      ownerId: reversalJournals.find((journal) => journal.originalJournalId === item.journalId)?.reversalJournalId,
    }, ctx.userId)));

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.supplier_payment.void', targetType: 'supplier_payment', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { reason: reason.trim(), supplierId: payment.supplierId, netPaidAmount: payment.netPaidAmount, reversalJournals } });
    void this.outbox.append('supplier_payment.voided', 'supplier_payment', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'supplier_payment', aggregateId: id, occurredAt: new Date().toISOString(), data: { status: 'VOIDED' } });
    return voided;
  }
}
