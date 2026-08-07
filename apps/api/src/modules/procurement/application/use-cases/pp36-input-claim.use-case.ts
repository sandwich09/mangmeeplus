import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { LedgerSourcePostingInput, RequestContext, TransactionTaxComponentPreview } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { assertPeriodUnlocked, formPeriodKey } from '../../../tax/domain/logic/tax-period.logic';
import { TransactionTaxConfigUseCase } from '../../../tax/application/use-cases/transaction-tax-config.use-case';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';

const KIND = 'PP36_INPUT_CLAIM_RELEASE';

type ClaimMetadata = {
  kind: typeof KIND;
  branchId: string | null;
  vendorBillId: string;
  vendorBillLineId: string;
  supplierPaymentId?: string;
  recognitionKey?: string;
  evidenceId: string;
  paymentRecognitionDate: string;
  claimDate: string;
  releaseReason: string;
  component: TransactionTaxComponentPreview;
};

function metadata(row: any): ClaimMetadata | null {
  const value = row?.metadataJson;
  return value?.kind === KIND && value?.component?.componentKey === 'PP36_INPUT' ? value as ClaimMetadata : null;
}

export function buildPp36InputClaimPostingSource(adjustment: any): LedgerSourcePostingInput {
  const value = metadata(adjustment);
  if (!value) throw new BadRequestException({ code: 'pp36_claim_release_invalid', message: 'Tax adjustment is not a PP36 input claim release.' });
  return {
    companyId: adjustment.companyId, branchId: value.branchId ?? undefined,
    sourceType: 'tax.pp36_input_claim', sourceId: adjustment.id,
    sourceEventType: 'tax.pp36_input_claim.released', idempotencyKey: `pp36-input-claim:${adjustment.id}`,
    documentNumber: adjustment.id, sourceDate: value.claimDate, periodKey: value.claimDate.slice(0, 7), currency: value.component.snapshot.taxCurrency,
    totalAmount: '0', taxTotal: '0', whtTotal: '0',
    lines: [{ sourceLineId: adjustment.id, description: 'Release PP36 input VAT from pending to claimable', netAmount: '0', vatAmount: '0', taxComponents: [value.component] }],
  };
}

@Injectable()
export class ReleasePp36InputVatClaimUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly procurement: PrismaProcurementRepository,
    private readonly transactionTax: TransactionTaxConfigUseCase,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  private get db(): any { return this.prisma.client as any; }

  async execute(ctx: RequestContext, input: { vendorBillId: string; vendorBillLineId: string; supplierPaymentId?: string; evidenceId: string; claimDate: string; reason: string }) {
    if (!ctx.permissions.includes('tax.review_issue.resolve')) throw new ForbiddenException('Missing permission: tax.review_issue.resolve');
    if (!input.reason?.trim() || input.reason.trim().length > 500) throw new BadRequestException('A release reason of 1-500 characters is required');
    const claimDate = new Date(input.claimDate);
    if (Number.isNaN(claimDate.getTime())) throw new BadRequestException('claimDate is invalid');
    const periodKey = formPeriodKey('PP30', claimDate);
    let attemptedReasonKey: string | undefined;
    let outcome: { adjustment: any; idempotent: boolean };
    try {
      outcome = await this.db.$transaction(async (tx: any) => {
        const bill = await this.procurement.findVendorBillById(ctx.companyId, input.vendorBillId, tx);
        if (!bill) throw new NotFoundException('Vendor bill not found');
        if (ctx.scopes.branchIds && bill.branchId && !ctx.scopes.branchIds.includes(bill.branchId)) throw new ForbiddenException('Vendor bill is outside the granted branch scope');
        const line = bill.lines?.find((item) => item.id === input.vendorBillLineId);
        if (!line) throw new NotFoundException('Vendor bill line not found');
        const allocationRows = await tx.supplierPaymentAllocation.findMany({ where: {
          companyId: ctx.companyId, vendorBillId: bill.id, pp36RecognitionStatus: 'ACTIVE',
          supplierPayment: { status: 'RECORDED', ...(input.supplierPaymentId ? { id: input.supplierPaymentId } : {}) },
        }, include: { supplierPayment: { select: { id: true } } } });
        const recognitionCandidates = allocationRows.flatMap((allocation: any) => (Array.isArray(allocation.pp36RecognitionJson) ? allocation.pp36RecognitionJson : [])
          .filter((item: any) => item.vendorBillLineId === line.id)
          .map((item: any) => ({ ...item, supplierPaymentId: allocation.supplierPayment.id })));
        if (recognitionCandidates.length > 1 && !input.supplierPaymentId) {
          throw new ConflictException({ code: 'pp36_payment_recognition_ambiguous', message: 'Select the supplier payment whose PP36 input VAT is being released.' });
        }
        const recognition = recognitionCandidates[0];
        if (!recognition && allocationRows.length) throw new ConflictException({ code: 'pp36_payment_recognition_missing', message: 'No active PP36 payment recognition exists for this source line.' });
        if (!recognition && bill.status !== 'PAID') throw new ConflictException({ code: 'pp36_payment_not_finalized', message: 'No payment-recognized PP36 input VAT exists for this line.' });
        const sourceComponents = recognition?.preview?.components ?? line.taxComponents ?? [];
        const pending = sourceComponents.find((component: TransactionTaxComponentPreview) => component.componentKey === 'PP36_INPUT');
        const output = sourceComponents.find((component: TransactionTaxComponentPreview) => component.componentKey === 'PP36_OUTPUT');
        if (!pending || !output || pending.snapshot.taxContext !== 'IMPORT_SERVICE'
          || pending.snapshot.claimability !== 'PENDING_EVIDENCE' || pending.accountRole !== 'INPUT_VAT_PENDING'
          || pending.accountAssignments.length !== 1 || pending.accountAssignments[0]?.accountRole !== 'INPUT_VAT_PENDING') {
          throw new ConflictException({ code: 'pp36_input_not_pending', message: 'This line has no eligible pending PP36 input VAT.' });
        }
        if (output.snapshot.evidenceStatus !== 'VERIFIED' || !output.snapshot.recognitionDate) {
          throw new ConflictException({ code: 'pp36_output_not_recognized', message: 'PP36 output liability has not been recognized at payment.' });
        }
        const evidence = await tx.tradeTaxEvidence.findFirst({ where: {
          id: input.evidenceId, companyId: ctx.companyId, branchId: bill.branchId ?? null,
          sourceType: 'procurement.vendor_bill', sourceId: bill.id, sourceLineId: line.id,
          transactionContext: 'IMPORT_SERVICE', evidenceType: 'PP36_RECEIPT', status: 'VERIFIED',
          reviewedByUserId: { not: null }, reviewedAt: { not: null },
        } });
        if (!evidence) throw new BadRequestException({ code: 'verified_pp36_receipt_required', message: 'A source-bound, reviewer-verified Revenue Department PP36 receipt is required.' });
        const paymentDate = new Date(output.snapshot.recognitionDate);
        if (claimDate < paymentDate || claimDate < new Date(evidence.evidenceDate)) {
          throw new BadRequestException({ code: 'pp36_claim_date_invalid', message: 'claimDate must be on or after both payment recognition and PP36 receipt dates.' });
        }
        const recognitionKey = recognition?.recognitionKey ?? line.id;
        const reasonKey = `${KIND}:${recognitionKey}`;
        attemptedReasonKey = reasonKey;
        const existing = await tx.taxAdjustment.findFirst({ where: { companyId: ctx.companyId, adjustmentType: 'CORRECTION', reason: reasonKey } });
        if (existing) return { adjustment: existing, idempotent: true };
        const evidenceRefs = recognition
          ? [...new Set([...(recognition.evidenceIds ?? []), evidence.id])]
          : await this.transactionTax.listVerifiedEvidenceIdsForSource(ctx, {
            sourceType: 'procurement.vendor_bill', sourceId: bill.id, sourceLineId: line.id,
            transactionContext: 'IMPORT_SERVICE', branchId: bill.branchId, evidenceTypes: ['PAYMENT_EVIDENCE', 'PP36_RECEIPT'],
          }, tx);
        const resolved = await this.transactionTax.resolveSourceTaxInTransaction(ctx, {
          branchId: bill.branchId, sourceType: 'procurement.vendor_bill', sourceId: bill.id, sourceLineId: line.id,
          transactionContext: 'IMPORT_SERVICE', documentDate: bill.billDate.toISOString(), paymentDate: output.snapshot.recognitionDate,
          currency: bill.currency, taxCodeDefinitionId: pending.snapshot.taxCodeDefinitionId ?? undefined,
          externalTaxCode: pending.snapshot.externalTaxCode ?? undefined,
          netAmount: recognition?.sourceTaxBaseAmount ?? line.lineSubtotalAmount,
          grossAmount: recognition?.sourceTaxBaseAmount ?? line.lineTotalAmount, evidenceRefs,
        }, 'FINAL', tx, undefined, 'SELF_ASSESSED', 'procurement', {
          authoritativeSelfAssessedTaxBaseAmount: pending.snapshot.taxBaseAmount,
          authoritativeSelfAssessedTaxAmount: pending.snapshot.taxAmount,
          historicalSnapshot: pending.snapshot,
        });
        const claimable = resolved.components.find((component) => component.componentKey === 'PP36_INPUT');
        if (!claimable || claimable.snapshot.evidenceStatus !== 'VERIFIED' || claimable.snapshot.claimability !== 'CLAIMABLE'
          || claimable.accountAssignments.length !== 1 || claimable.accountAssignments[0]?.accountRole !== 'PP36_INPUT_VAT_CLAIMABLE'
          || !claimable.reportContributions.some((entry) => entry.formType === 'PP30')) {
          throw new ConflictException({ code: 'pp36_claim_mapping_incomplete', message: 'Claimable account or PP30 mapping is not fully configured.' });
        }
        if (!new Decimal(claimable.snapshot.taxAmount).eq(pending.snapshot.taxAmount)
          || !new Decimal(claimable.snapshot.taxBaseAmount).eq(pending.snapshot.taxBaseAmount)) {
          throw new ConflictException({ code: 'pp36_claim_amount_changed', message: 'Claim release must not change the payment-recognized tax base or amount.' });
        }
        const component: TransactionTaxComponentPreview = {
          ...claimable,
          snapshot: { ...claimable.snapshot, recognitionDate: claimDate.toISOString(), evidenceRefs: [...new Set([...(claimable.snapshot.evidenceRefs ?? []), evidence.id])] },
          accountAssignments: [claimable.accountAssignments[0]!, { ...pending.accountAssignments[0]!, postingSide: 'CREDIT' }],
          reportContributions: claimable.reportContributions.filter((entry) => entry.formType === 'PP30'),
        };
        const idempotencyKey = createHash('sha256').update([ctx.companyId, KIND, recognitionKey].join('|')).digest('hex');
        const period = await tx.taxPeriod.upsert({
          where: { companyId_formType_periodKey: { companyId: ctx.companyId, formType: 'PP30', periodKey } },
          create: { companyId: ctx.companyId, taxType: 'VAT', formType: 'PP30', periodKey, status: 'OPEN' }, update: {},
        });
        try { assertPeriodUnlocked(period.status, 'PP30', periodKey); }
        catch { throw new ConflictException({ code: 'tax_period_locked', message: `PP30/${periodKey} is locked; use an amended filing workflow.` }); }
        const adjustment = await tx.taxAdjustment.create({ data: {
          companyId: ctx.companyId, taxPeriodId: period.id, adjustmentType: 'CORRECTION', reason: reasonKey, adjustedByUserId: ctx.userId,
          metadataJson: { kind: KIND, branchId: bill.branchId ?? null, vendorBillId: bill.id, vendorBillLineId: line.id,
            supplierPaymentId: recognition?.supplierPaymentId, recognitionKey,
            evidenceId: evidence.id, paymentRecognitionDate: output.snapshot.recognitionDate, claimDate: claimDate.toISOString(), releaseReason: input.reason.trim(), component },
        } });
        await tx.taxEvent.create({ data: {
          companyId: ctx.companyId, branchId: bill.branchId, taxPeriodId: period.id, idempotencyKey,
          eventType: 'VAT_INPUT', status: 'ACTIVE', sourceType: 'tax.pp36_input_claim', sourceId: adjustment.id,
          sourceLineId: adjustment.id, sourceLineKey: adjustment.id, sourceEventType: 'tax.pp36_input_claim.released',
          sourceHash: idempotencyKey, periodKey, eventDate: claimDate,
          taxableBase: component.snapshot.taxBaseAmount, taxAmount: component.snapshot.taxAmount, currency: component.snapshot.taxCurrency,
          componentKey: 'PP36_INPUT', taxCodeDefinitionId: component.snapshot.taxCodeDefinitionId,
          externalTaxCodeSnapshot: component.snapshot.externalTaxCode, taxProfileKeySnapshot: component.snapshot.taxProfileKey,
          taxProfileVersionSnapshot: component.snapshot.taxProfileVersion, roundingModeSnapshot: component.snapshot.roundingMode,
          roundingScaleSnapshot: component.snapshot.roundingScale, taxAmountToleranceSnapshot: component.snapshot.taxAmountTolerance,
          taxRegimeSnapshot: component.snapshot.taxRegime,
          taxDirectionSnapshot: component.snapshot.taxDirection, taxTreatmentSnapshot: component.snapshot.taxTreatment,
          taxContextSnapshot: component.snapshot.taxContext, taxRateSnapshot: component.snapshot.taxRate,
          sourceCurrencySnapshot: component.snapshot.sourceCurrency, taxCurrencySnapshot: component.snapshot.taxCurrency,
          exchangeRateSnapshot: component.snapshot.exchangeRate, exchangeRateSourceSnapshot: component.snapshot.exchangeRateSource,
          exchangeRateDateSnapshot: component.snapshot.exchangeRateDate ? new Date(component.snapshot.exchangeRateDate) : null,
          claimabilitySnapshot: component.snapshot.claimability, accountRuleVersionSnapshot: component.snapshot.accountRuleVersion,
          reportRuleVersionSnapshot: component.snapshot.reportRuleVersion, taxEvidenceReviewStatus: component.snapshot.evidenceStatus,
          reportContributionsJson: component.reportContributions, accountAssignmentsJson: component.accountAssignments,
        } });
        // L-10: written on `tx`, so the CRITICAL claim release and its audit row
        // commit or roll back together — a failed audit write aborts the claim.
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.pp36_input_claim.release', targetType: 'tax_adjustment', targetId: adjustment.id,
          requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { vendorBillId: input.vendorBillId, vendorBillLineId: input.vendorBillLineId, evidenceId: input.evidenceId, claimDate: claimDate.toISOString() } }, tx);
        return { adjustment, idempotent: false };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      const raced = attemptedReasonKey ? await this.db.taxAdjustment.findFirst({ where: { companyId: ctx.companyId, adjustmentType: 'CORRECTION', reason: attemptedReasonKey } }) : null;
      if (!raced) throw error;
      outcome = { adjustment: raced, idempotent: true };
    }
    if (outcome.idempotent) return { adjustmentId: outcome.adjustment.id, idempotent: true, postingSource: buildPp36InputClaimPostingSource(outcome.adjustment) };
    const adjustment = outcome.adjustment;
    await this.outbox.append('tax.pp36_input_claim.released', 'tax_adjustment', adjustment.id, { companyId: ctx.companyId, actorUserId: ctx.userId,
      requestId: ctx.requestId, aggregateType: 'tax_adjustment', aggregateId: adjustment.id, occurredAt: new Date().toISOString(),
      data: { vendorBillId: input.vendorBillId, vendorBillLineId: input.vendorBillLineId, evidenceId: input.evidenceId, claimDate: claimDate.toISOString(), periodKey } });
    return { adjustmentId: adjustment.id, idempotent: false, postingSource: buildPp36InputClaimPostingSource(adjustment) };
  }
}
