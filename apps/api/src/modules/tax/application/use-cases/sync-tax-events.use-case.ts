import { Injectable, Logger } from '@nestjs/common';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { AccountingDocumentSourceAdapter } from '../../infrastructure/adapters/accounting-document-source.adapter';
import { ExpenseSourceAdapter } from '../../infrastructure/adapters/expense-source.adapter';
import { SupplierPaymentSourceAdapter } from '../../infrastructure/adapters/supplier-payment-source.adapter';
import { formPeriodKey, assertPeriodUnlocked, makeReviewIssue } from '../../domain/logic/tax-period.logic';
import { taxEventIdempotencyKey, computeSourceHash } from '../../domain/logic/tax-event.logic';
import type { TaxFormType } from '@watchdog-bms/contracts';

type SyncResult = {
  transactionTaxComponentsCreated: number;
  voidedComponentsSuperseded: number;
  vatOutputCreated: number;
  vatInputCreated: number;
  whtCreated: number;
  reviewIssuesCreated: number;
  skippedLocked: number;
};

export function signedOutputAmount(documentType: string, value: string): string {
  if (documentType !== 'CREDIT_NOTE' || /^-?0+(?:\.0+)?$/.test(value.trim())) return value;
  return value.startsWith('-') ? value : `-${value}`;
}

function componentEventType(component: any): 'VAT_OUTPUT' | 'VAT_INPUT' | 'VAT_EXEMPT' | 'CUSTOMS_ASSESSED' {
  return ['CUSTOMS_DUTY', 'EXCISE_TAX', 'OTHER_IMPORT_TAX'].includes(component.componentKey) ? 'CUSTOMS_ASSESSED'
    : component.snapshot.taxDirection === 'OUTPUT' || component.componentKey === 'PP36_OUTPUT'
      ? component.snapshot.taxTreatment === 'EXEMPT' ? 'VAT_EXEMPT' : 'VAT_OUTPUT'
      : 'VAT_INPUT';
}

function componentPeriod(component: any): { formType: TaxFormType; taxType: 'VAT' | 'CUSTOMS' } {
  if (component.componentKey === 'PP36_OUTPUT') return { formType: 'PP36', taxType: 'VAT' };
  if (['CUSTOMS_DUTY', 'EXCISE_TAX', 'OTHER_IMPORT_TAX'].includes(component.componentKey)) return { formType: 'CUSTOMS_SUPPORT', taxType: 'CUSTOMS' };
  return { formType: 'PP30', taxType: 'VAT' };
}

function hasRecognitionDate(component: any): boolean {
  return !['PP36_OUTPUT', 'PP36_INPUT'].includes(component.componentKey) || Boolean(component.snapshot?.recognitionDate);
}

@Injectable()
export class SyncTaxEventsUseCase {
  private readonly logger = new Logger(SyncTaxEventsUseCase.name);

  constructor(
    private readonly taxRepo: PrismaTaxRepository,
    private readonly docSource: AccountingDocumentSourceAdapter,
    private readonly expenseSource: ExpenseSourceAdapter,
    private readonly supplierPaymentSource: SupplierPaymentSourceAdapter,
  ) {}

  private async activeEvent(companyId: string, sourceType: string, sourceId: string, sourceLineKey: string, componentKey: string | null, eventType: string, versionKey: string) {
    const repo = this.taxRepo as any;
    return typeof repo.findActiveEventBySourceComponent === 'function'
      ? repo.findActiveEventBySourceComponent(companyId, sourceType, sourceId, sourceLineKey, componentKey, eventType)
      : this.taxRepo.findEventByIdempotencyKey(versionKey);
  }

  async execute(companyId: string, since?: Date): Promise<SyncResult> {
    const result: SyncResult = { transactionTaxComponentsCreated: 0, voidedComponentsSuperseded: 0, vatOutputCreated: 0, vatInputCreated: 0, whtCreated: 0, reviewIssuesCreated: 0, skippedLocked: 0 };
    const company = await this.taxRepo.prisma?.client?.company?.findUnique?.({ where: { id: companyId }, select: { baseCurrency: true } });
    if (!company && this.taxRepo instanceof PrismaTaxRepository) throw new Error('company_base_currency_missing');
    const baseCurrency = company?.baseCurrency?.toUpperCase() ?? 'THB';

    // ── Authoritative line/component snapshots (item 11B) ────────────────────
    const [documentLines, purchaseLines] = await Promise.all([
      this.docSource.findFinalizedTransactionTaxLines?.(companyId, since) ?? [],
      this.expenseSource.findFinalizedTransactionTaxLines?.(companyId, since) ?? [],
    ]);
    const [voidedDocumentLines, voidedPurchaseLines] = await Promise.all([
      this.docSource.findVoidedTransactionTaxLines?.(companyId, since) ?? [],
      this.expenseSource.findVoidedTransactionTaxLines?.(companyId, since) ?? [],
    ]);
    for (const source of [...voidedDocumentLines, ...voidedPurchaseLines]) for (const component of source.taxComponents) {
      if (!hasRecognitionDate(component)) continue;
      const { formType, taxType } = componentPeriod(component);
      const recognitionDate = component.snapshot.recognitionDate ? new Date(component.snapshot.recognitionDate) : source.eventDate;
      const periodKey = formPeriodKey(formType, recognitionDate);
      const period = await this.taxRepo.upsertPeriod({ companyId, taxType, formType, periodKey });
      try { assertPeriodUnlocked(period.status, formType, periodKey); }
      catch {
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'VOID_AFTER_TAX_PERIOD_LOCK', description: 'Voided source requires an amended/reversal tax flow because the original period is locked', sourceType: source.sourceType, sourceId: source.sourceId });
        result.reviewIssuesCreated++; result.skippedLocked++; continue;
      }
      const eventType = componentEventType(component);
      const idKey = taxEventIdempotencyKey(companyId, source.sourceType, `${source.sourceId}:${source.sourceLineId}:${component.componentKey}`, eventType);
      const existing = await this.activeEvent(companyId, source.sourceType, source.sourceId, source.sourceLineId, component.componentKey, eventType, idKey);
      if (existing?.status === 'ACTIVE') { await this.taxRepo.supersedeEvent(existing.id); result.voidedComponentsSuperseded++; }
    }
    for (const source of [...documentLines, ...purchaseLines]) {
      for (const component of source.taxComponents) {
        const snapshot = component.snapshot;
        if (!snapshot || snapshot.taxTreatment === 'NEEDS_REVIEW' || !hasRecognitionDate(component)) continue;
        const { formType, taxType } = componentPeriod(component);
        const recognitionDate = snapshot.recognitionDate ? new Date(snapshot.recognitionDate) : source.eventDate;
        const periodKey = formPeriodKey(formType, recognitionDate);
        const period = await this.taxRepo.upsertPeriod({ companyId, taxType, formType, periodKey });
        if (snapshot.taxCurrency?.toUpperCase() !== baseCurrency || snapshot.sourceCurrency?.toUpperCase() !== source.currency.toUpperCase()) {
          await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'FUNCTIONAL_CURRENCY_SNAPSHOT_INVALID', description: 'Tax component currency snapshot does not match the company functional currency or source document', sourceType: source.sourceType, sourceId: source.sourceId });
          result.reviewIssuesCreated++;
          continue;
        }
        const componentSourceId = `${source.sourceId}:${source.sourceLineId}:${component.componentKey}`;
        const eventType = componentEventType(component);
        const hash = computeSourceHash({ sourceLineId: source.sourceLineId, componentKey: component.componentKey, snapshot, accountAssignments: component.accountAssignments, reportContributions: component.reportContributions, updatedAt: source.updatedAt.toISOString() });
        const idKey = taxEventIdempotencyKey(companyId, source.sourceType, componentSourceId, `${eventType}:${hash}`);
        const existing = await this.activeEvent(companyId, source.sourceType, source.sourceId, source.sourceLineId, component.componentKey, eventType, idKey);
        try { assertPeriodUnlocked(period.status, formType, periodKey); }
        catch {
          if (!existing || existing.sourceHash !== hash) {
            await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'SOURCE_CHANGED_AFTER_TAX_PERIOD_LOCK', description: 'Source tax facts changed after the tax period was locked; use the controlled amendment/reversal flow', sourceType: source.sourceType, sourceId: source.sourceId });
            result.reviewIssuesCreated++;
          }
          result.skippedLocked++;
          continue;
        }
        if (component.componentKey === 'PP36_INPUT' && snapshot.claimability === 'PENDING_EVIDENCE') {
          // Payment recognizes the PP36 liability and parks input VAT in a G/L
          // pending account. PP30 starts only from the later immutable claim release.
          continue;
        }
        if (snapshot.evidenceStatus !== 'VERIFIED') {
          await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'TAX_EVIDENCE_NOT_VERIFIED', description: 'Finalized tax component is excluded until its evidence is verified', sourceType: source.sourceType, sourceId: source.sourceId });
          result.reviewIssuesCreated++;
          continue;
        }
        if (existing && existing.sourceHash === hash) continue;
        if (existing) await this.taxRepo.supersedeEvent(existing.id);
        const legacyCode = ['O7', 'O0', 'OX'].includes(snapshot.externalTaxCode ?? '') ? snapshot.externalTaxCode as 'O7' | 'O0' | 'OX' : null;
        await this.taxRepo.upsertEvent({
          companyId, branchId: source.branchId, taxPeriodId: period.id, idempotencyKey: idKey, eventType, status: 'ACTIVE',
          sourceType: source.sourceType, sourceId: source.sourceId, sourceLineId: source.sourceLineId, sourceLineKey: source.sourceLineId,
          componentKey: component.componentKey, taxSnapshot: snapshot, reportContributions: component.reportContributions,
          accountAssignments: component.accountAssignments, sourceEventType: source.sourceEventType, sourceHash: hash,
          periodKey, eventDate: recognitionDate, taxableBase: snapshot.taxBaseAmount, taxAmount: snapshot.taxAmount,
          currency: snapshot.taxCurrency,
          vatMode: source.vatMode, outputTaxCode: legacyCode, whtFormType: null, payeeSnapshot: null,
          incomeCategoryCode: null, whtRate: null, grossAmount: null, withheldAmount: null, netPaidAmount: null,
          taxInvoiceNumber: source.taxInvoiceNumber, reviewNote: snapshot.evidenceStatus === 'VERIFIED' ? null : 'tax_evidence_review_required',
        });
        result.transactionTaxComponentsCreated++;
        if (eventType === 'VAT_OUTPUT' || eventType === 'VAT_EXEMPT') result.vatOutputCreated++;
        else if (eventType === 'VAT_INPUT') result.vatInputCreated++;
      }
    }

    // ── VAT output from issued sales/tax invoices ─────────────────────────────
    const docs = await this.docSource.findIssuedWithVatByCompany(companyId, since);
    for (const doc of docs) {
      if (doc.outputTaxCode === 'O0') {
        const periodKey = formPeriodKey('PP30', doc.documentDate);
        const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'VAT', formType: 'PP30', periodKey });
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'AMBIGUOUS_LEGACY_O0', description: 'Legacy O0 requires explicit zero-rated context and verified evidence before tax-event sync', sourceType: 'accounting.document', sourceId: doc.id });
        result.reviewIssuesCreated++;
        continue;
      }
      const eventType = doc.outputTaxCode === 'OX' ? 'VAT_EXEMPT' : 'VAT_OUTPUT';
      const taxableBase = signedOutputAmount(doc.documentType, doc.taxableAmount);
      const taxAmount = signedOutputAmount(doc.documentType, doc.vatAmount);
      const periodKey = formPeriodKey('PP30', doc.documentDate);
      const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'VAT', formType: 'PP30', periodKey });

      if (doc.currency.toUpperCase() !== baseCurrency) {
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'FUNCTIONAL_CURRENCY_FX_MISSING', description: 'Legacy foreign-currency VAT must be remediated to an immutable functional-currency Tax Code snapshot', sourceType: 'accounting.document', sourceId: doc.id });
        result.reviewIssuesCreated++;
        continue;
      }

      try { assertPeriodUnlocked(period.status, 'PP30', periodKey); }
      catch { result.skippedLocked++; continue; }

      const hash = computeSourceHash({ outputTaxCode: doc.outputTaxCode, documentType: doc.documentType, vatAmount: taxAmount, taxableAmount: taxableBase, taxInvoiceId: doc.taxInvoiceId, updatedAt: doc.updatedAt.toISOString() });
      const idKey = taxEventIdempotencyKey(companyId, 'accounting.document', doc.id, `${eventType}:${hash}`);
      const existing = await this.activeEvent(companyId, 'accounting.document', doc.id, '__HEADER__', null, eventType, idKey);

      if (existing && existing.sourceHash === hash) continue;
      if (existing) await this.taxRepo.supersedeEvent(existing.id);

      await this.taxRepo.upsertEvent({
        companyId, taxPeriodId: period.id, idempotencyKey: idKey, eventType, status: 'ACTIVE',
        sourceType: 'accounting.document', sourceId: doc.id, sourceEventType: doc.documentType, sourceHash: hash,
        periodKey, eventDate: doc.documentDate,
        taxableBase, taxAmount, currency: doc.currency,
        vatMode: doc.vatMode, outputTaxCode: doc.outputTaxCode, whtFormType: null,
        payeeSnapshot: doc.counterpartyName ? { name: doc.counterpartyName, taxId: doc.counterpartyTaxId ?? null, address: doc.counterpartyAddress ?? null, branchCode: doc.branchCode } : null,
        incomeCategoryCode: null, whtRate: null, grossAmount: null, withheldAmount: null, netPaidAmount: null,
        taxInvoiceNumber: doc.documentNumber ?? doc.taxInvoiceId ?? null, reviewNote: null,
      });
      result.vatOutputCreated++;

      if (!doc.counterpartyTaxId) {
        const issue = makeReviewIssue('MISSING_TAX_ID', { context: doc.counterpartyName ?? doc.id });
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: issue.severity, issueCode: issue.code, description: issue.description, sourceType: 'accounting.document', sourceId: doc.id });
        result.reviewIssuesCreated++;
      }
    }

    // ── VAT input from confirmed eligible expenses ─────────────────────────────
    const expenses = await this.expenseSource.findConfirmedWithVatByCompany(companyId, since);
    for (const exp of expenses) {
      if (parseFloat(exp.vatAmount) <= 0) continue;
      const periodKey = formPeriodKey('PP30', exp.expenseDate);
      const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'VAT', formType: 'PP30', periodKey });

      if (exp.currency.toUpperCase() !== baseCurrency) {
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'FUNCTIONAL_CURRENCY_FX_MISSING', description: 'Legacy foreign-currency input VAT must be remediated to an immutable functional-currency Tax Code snapshot', sourceType: 'expense.record', sourceId: exp.id });
        result.reviewIssuesCreated++;
        continue;
      }

      try { assertPeriodUnlocked(period.status, 'PP30', periodKey); }
      catch { result.skippedLocked++; continue; }

      const hash = computeSourceHash({ vatAmount: exp.vatAmount, inputVatClaimStatus: exp.inputVatClaimStatus, taxEvidenceStatus: exp.taxEvidenceStatus, updatedAt: exp.updatedAt.toISOString() });
      const idKey = taxEventIdempotencyKey(companyId, 'expense.record', exp.id, `VAT_INPUT:${hash}`);
      const existing = await this.activeEvent(companyId, 'expense.record', exp.id, '__HEADER__', null, 'VAT_INPUT', idKey);

      if (exp.inputVatClaimStatus !== 'CLAIMABLE' || exp.taxEvidenceStatus !== 'USABLE_FOR_TAX') {
        if (existing) await this.taxRepo.supersedeEvent(existing.id);
        const issue = makeReviewIssue('INPUT_VAT_NOT_CLAIMABLE', { context: exp.id });
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: issue.severity, issueCode: issue.code, description: issue.description, sourceType: 'expense.record', sourceId: exp.id });
        result.reviewIssuesCreated++;
        continue;
      }

      if (existing && existing.sourceHash === hash) continue;
      if (existing) await this.taxRepo.supersedeEvent(existing.id);

      await this.taxRepo.upsertEvent({
        companyId, taxPeriodId: period.id, idempotencyKey: idKey, eventType: 'VAT_INPUT', status: 'ACTIVE',
        sourceType: 'expense.record', sourceId: exp.id, sourceEventType: 'expense.confirmed', sourceHash: hash,
        periodKey, eventDate: exp.expenseDate,
        taxableBase: exp.taxableAmount, taxAmount: exp.vatAmount, currency: exp.currency,
        vatMode: exp.vatMode, outputTaxCode: null, whtFormType: null,
        // `payeeSnapshot` is the counterparty of the event's own direction: the buyer on sell-side
        // events, the vendor here on the purchase side — name and taxId already worked that way, so
        // branchCode and address follow them. `TaxEvent.sellerBranchCode` stays for the sell side
        // (RA-17). GAP-2/§10: the address is the one printed on the document this event came from.
        payeeSnapshot: exp.vendorName ? { name: exp.vendorName, taxId: exp.vendorTaxId ?? null, address: exp.vendorAddress ?? null, branchCode: exp.vendorBranchCode ?? null } : null,
        incomeCategoryCode: null, whtRate: null, grossAmount: null, withheldAmount: null, netPaidAmount: null,
        taxInvoiceNumber: null, reviewNote: null,
      });
      result.vatInputCreated++;
    }

    // ── WHT from confirmed expenses with whtAmount > 0 ────────────────────────
    const whtExpenses = await this.expenseSource.findConfirmedWithWhtByCompany(companyId, since);
    for (const exp of whtExpenses) {
      if (parseFloat(exp.whtAmount) <= 0) continue;
      // RA-18: the RD form follows the payee's taxpayer class — บุคคลธรรมดา files ภ.ง.ด.3, นิติบุคคล files
      // ภ.ง.ด.53. A payee that review has not classified yet keeps PND53 as the documented fallback; a
      // 13-digit tax ID does not distinguish the two classes, so nothing is inferred from it.
      const formType: TaxFormType = exp.payeeEntityKind === 'INDIVIDUAL' ? 'PND3' : 'PND53';
      const eventType = formType === 'PND3' ? 'WHT_PND3' : 'WHT_PND53';
      const periodKey = formPeriodKey(formType, exp.expenseDate);
      const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'WHT', formType, periodKey });

      if (exp.currency.toUpperCase() !== baseCurrency) {
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'FUNCTIONAL_CURRENCY_FX_MISSING', description: 'Foreign-currency WHT requires an immutable functional-currency FX snapshot before reporting', sourceType: 'expense.record', sourceId: exp.id });
        result.reviewIssuesCreated++;
        continue;
      }

      try { assertPeriodUnlocked(period.status, formType, periodKey); }
      catch { result.skippedLocked++; continue; }

      if (!exp.vendorTaxId) {
        const issue = makeReviewIssue('MISSING_TAX_ID', { context: exp.vendorName ?? exp.id });
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: issue.severity, issueCode: issue.code, description: issue.description, sourceType: 'expense.record', sourceId: exp.id });
        result.reviewIssuesCreated++;
        continue;
      }

      const hash = computeSourceHash({ whtAmount: exp.whtAmount, updatedAt: exp.updatedAt.toISOString() });
      const idKey = taxEventIdempotencyKey(companyId, 'expense.record', exp.id, `${eventType}:${hash}`);
      // No cross-form cleanup is needed: the class is captured before confirmation and CONFIRMED only
      // transitions to VOIDED, so an expense cannot move between ภ.ง.ด.3 and ภ.ง.ด.53 after its first
      // sync. Adding a reclassification seam means superseding the other form's event *and* asserting
      // that form's period lock, like the two supersede sites above.
      const existing = await this.activeEvent(companyId, 'expense.record', exp.id, '__HEADER__', null, eventType, idKey);
      if (existing && existing.sourceHash === hash) continue;
      if (existing) await this.taxRepo.supersedeEvent(existing.id);

      await this.taxRepo.upsertEvent({
        companyId, taxPeriodId: period.id, idempotencyKey: idKey, eventType, status: 'ACTIVE',
        sourceType: 'expense.record', sourceId: exp.id, sourceEventType: 'expense.wht', sourceHash: hash,
        periodKey, eventDate: exp.expenseDate,
        taxableBase: exp.grossAmount, taxAmount: exp.whtAmount, currency: exp.currency,
        vatMode: null, outputTaxCode: null, whtFormType: formType,
        // §10: 50 ทวิ must print the payee's address. Empty stays empty — the handoff review page is
        // where it gets typed in; a missing address never stops the event being written.
        payeeSnapshot: { name: exp.vendorName ?? '', taxId: exp.vendorTaxId, address: exp.vendorAddress ?? null, branchCode: exp.vendorBranchCode ?? null },
        incomeCategoryCode: exp.incomeCategoryCode ?? null, whtRate: exp.whtRate ?? null,
        grossAmount: exp.grossAmount, withheldAmount: exp.whtAmount, netPaidAmount: null,
        taxInvoiceNumber: null, reviewNote: null,
      });
      result.whtCreated++;
    }

    // ── WHT from recorded supplier payments that withheld tax (RA-20) ─────────
    // The same forms as the expense loop above, from the other seam: an expense withholds when the
    // cost is captured, a payment when the money leaves. They cannot double-count — a bill that
    // withheld at accrual is refused a second withholding at payment (wht_double_withholding).
    const whtPayments = await this.supplierPaymentSource.findRecordedWithWhtByCompany(companyId, since);
    for (const pay of whtPayments) {
      if (parseFloat(pay.whtAmount) <= 0) continue;
      // Same rule as RA-18 on the expense side: the RD form follows the payee's taxpayer class, and
      // an unclassified payee keeps ภ.ง.ด.53 as the documented fallback rather than being guessed
      // at from a tax ID. FOREIGN payees also land here — ภ.ง.ด.54 is out of scope, so they surface
      // for review instead of silently taking a form that does not apply.
      const formType: TaxFormType = pay.supplierType === 'INDIVIDUAL' ? 'PND3' : 'PND53';
      const eventType = formType === 'PND3' ? 'WHT_PND3' : 'WHT_PND53';
      const periodKey = formPeriodKey(formType, pay.paymentDate);
      const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'WHT', formType, periodKey });

      if (pay.currency.toUpperCase() !== baseCurrency) {
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'FUNCTIONAL_CURRENCY_FX_MISSING', description: 'Foreign-currency WHT requires an immutable functional-currency FX snapshot before reporting', sourceType: 'procurement.supplier_payment', sourceId: pay.id });
        result.reviewIssuesCreated++;
        continue;
      }

      try { assertPeriodUnlocked(period.status, formType, periodKey); }
      catch { result.skippedLocked++; continue; }

      if (!pay.payeeTaxId) {
        const issue = makeReviewIssue('MISSING_TAX_ID', { context: pay.payeeName ?? pay.id });
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: issue.severity, issueCode: issue.code, description: issue.description, sourceType: 'procurement.supplier_payment', sourceId: pay.id });
        result.reviewIssuesCreated++;
        continue;
      }

      const hash = computeSourceHash({ whtAmount: pay.whtAmount, updatedAt: pay.updatedAt.toISOString() });
      const idKey = taxEventIdempotencyKey(companyId, 'procurement.supplier_payment', pay.id, `${eventType}:${hash}`);
      const existing = await this.activeEvent(companyId, 'procurement.supplier_payment', pay.id, '__HEADER__', null, eventType, idKey);
      if (existing && existing.sourceHash === hash) continue;
      if (existing) await this.taxRepo.supersedeEvent(existing.id);

      await this.taxRepo.upsertEvent({
        companyId, branchId: pay.branchId ?? undefined, taxPeriodId: period.id, idempotencyKey: idKey, eventType, status: 'ACTIVE',
        sourceType: 'procurement.supplier_payment', sourceId: pay.id, sourceEventType: 'procurement.supplier_payment.wht', sourceHash: hash,
        periodKey, eventDate: pay.paymentDate,
        // Falls back to the withheld amount only when the rate is missing (rows predating the
        // withholding decision fields); the attachment then shows a base review must correct,
        // never a VAT-inclusive settlement figure passed off as income.
        taxableBase: pay.grossAmount ?? pay.whtAmount, taxAmount: pay.whtAmount, currency: pay.currency,
        vatMode: null, outputTaxCode: null, whtFormType: formType,
        // GAP-2 / §10: a supplier payment has no printed document of ours to take an address from,
        // so this is the counterparty registry read via `SupplierProfile.counterparty` (adapter does
        // the query; this just takes what it found). Not part of `computeSourceHash` above — an
        // existing event keeps its frozen snapshot and there is no backfill (owner decision: new
        // amounts only), so a registry edit alone never re-syncs old events.
        payeeSnapshot: { name: pay.payeeName ?? '', taxId: pay.payeeTaxId, address: pay.payeeAddress ?? null, branchCode: pay.payeeBranchCode ?? null },
        incomeCategoryCode: pay.incomeCategoryCode ?? null, whtRate: pay.whtRate ?? null,
        grossAmount: pay.grossAmount ?? pay.whtAmount, withheldAmount: pay.whtAmount, netPaidAmount: null,
        taxInvoiceNumber: null, reviewNote: null,
      });
      result.whtCreated++;
    }

    this.logger.log(`[SyncTaxEvents] ${companyId}: components=${result.transactionTaxComponentsCreated} vatOut=${result.vatOutputCreated} vatIn=${result.vatInputCreated} wht=${result.whtCreated} issues=${result.reviewIssuesCreated} locked=${result.skippedLocked}`);
    return result;
  }
}
