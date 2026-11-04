import { withholdingFormFor } from '../../domain/logic/expense-payment-withholding.logic';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { AccountingDocumentSourceAdapter } from '../../infrastructure/adapters/accounting-document-source.adapter';
import { ExpenseSourceAdapter } from '../../infrastructure/adapters/expense-source.adapter';
import { SupplierPaymentSourceAdapter } from '../../infrastructure/adapters/supplier-payment-source.adapter';
import { formPeriodKey, assertPeriodUnlocked, makeReviewIssue, withholdingIssueDescription } from '../../domain/logic/tax-period.logic';
import { taxEventIdempotencyKey, computeSourceHash } from '../../domain/logic/tax-event.logic';
import { eWhtReducedRateOn } from '@watchdog-bms/contracts';
import type { TaxFormType } from '@watchdog-bms/contracts';

type SyncResult = {
  transactionTaxComponentsCreated: number;
  voidedComponentsSuperseded: number;
  vatOutputCreated: number;
  vatInputCreated: number;
  whtCreated: number;
  whtBankRemittedRecorded: number;
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

  private async withholdingForm(companyId: string, kind: string | null, juristicKind: string, date: Date, sourceType: string, sourceId: string, payeeName: string | null, incomeCategoryCode?: string | null, sourceLineKey?: string, bankRemitted = false): Promise<{ formType: 'PND2' | 'PND3' | 'PND53'; filingRoute: string } | null> {
    if (kind !== 'INDIVIDUAL' && kind !== juristicKind) {
      const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'WHT', formType: 'PND53', periodKey: formPeriodKey('PND53', date) });
      const issue = makeReviewIssue('WHT_PAYEE_KIND_UNKNOWN', { context: payeeName ?? undefined });
      await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: issue.severity, issueCode: issue.code, description: issue.description, sourceType, sourceId });
      // Remove the old PND53 fallback too; filed history remains under the existing period lock.
      await this.taxRepo.supersedeUnclassifiedWithholding(companyId, sourceType, sourceId);
      return null;
    }
    await this.taxRepo.resolveSourceIssues(companyId, 'WHT_PAYEE_KIND_UNKNOWN', sourceType, sourceId, undefined, ['PND2', 'PND3', 'PND53']);
    const category = incomeCategoryCode ? await this.taxRepo.prisma?.client?.whtIncomeCategory?.findUnique({ where: { code: incomeCategoryCode } }) : null;
    if (sourceType !== 'expense.record' && (category?.filingRoute === 'SEPARATE_PND2' || category?.filingRoute === 'ACCOUNTANT_PREPARES')) {
      for (const code of ['MISSING_TAX_ID', 'FUNCTIONAL_CURRENCY_FX_MISSING']) await this.taxRepo.resolveSourceIssues(companyId, code, sourceType, sourceId, undefined, ['PND2', 'PND3', 'PND53']);
    }
    const formType = withholdingFormFor(kind, category?.filingRoute)!;
    await this.taxRepo.supersedeUnclassifiedWithholding?.(companyId, sourceType, sourceId, `WHT_${formType}`, sourceLineKey, bankRemitted);
    return { formType, filingRoute: category?.filingRoute ?? 'SYSTEM_FILLS' };
  }

  async execute(companyId: string, since?: Date, scope: 'ALL' | 'WHT' | 'PND53' = 'ALL'): Promise<SyncResult> {
    const result: SyncResult = { transactionTaxComponentsCreated: 0, voidedComponentsSuperseded: 0, vatOutputCreated: 0, vatInputCreated: 0, whtCreated: 0, whtBankRemittedRecorded: 0, reviewIssuesCreated: 0, skippedLocked: 0 };
    const company = await this.taxRepo.prisma?.client?.company?.findUnique?.({ where: { id: companyId }, select: { baseCurrency: true } });
    if (!company && this.taxRepo instanceof PrismaTaxRepository) throw new Error('company_base_currency_missing');
    const baseCurrency = company?.baseCurrency?.toUpperCase() ?? 'THB';

    if (scope === 'ALL') {
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
        if (source.sourceType === 'expense.record' && eventType === 'VAT_INPUT'
          && (source.inputVatClaimStatus !== 'CLAIMABLE' || source.taxEvidenceStatus !== 'USABLE_FOR_TAX')) {
          if (existing) await this.taxRepo.supersedeEvent(existing.id);
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
          expectedExpenseConfirmedAt: source.sourceType === 'expense.record' ? source.confirmedAt : undefined,
          ...(source.sourceType === 'expense.record' && eventType === 'VAT_INPUT' && { expectedInputVatClaimStatus: source.inputVatClaimStatus, expectedTaxEvidenceStatus: source.taxEvidenceStatus }),
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
        expectedExpenseConfirmedAt: exp.confirmedAt, expectedInputVatClaimStatus: exp.inputVatClaimStatus, expectedTaxEvidenceStatus: exp.taxEvidenceStatus, sourceType: 'expense.record', sourceId: exp.id, sourceEventType: 'expense.confirmed', sourceHash: hash,
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

    }

    // ── WHT from confirmed expenses with whtAmount > 0 ────────────────────────
    const whtExpenses = await this.expenseSource.findConfirmedWithWhtByCompany(companyId, since);
    await this.taxRepo.retireObsoleteExpenseWithholding?.(companyId, whtExpenses);
    const pending = new Map<string, { sourceId: string; taxPeriodId: string; payee: string | null; needed: Set<string> }>();
    const review = (exp: (typeof whtExpenses)[number], taxPeriodId: string) => {
      const key = JSON.stringify([exp.id, taxPeriodId]);
      if (!pending.has(key)) pending.set(key, { sourceId: exp.id, taxPeriodId, payee: exp.vendorName, needed: new Set() });
      return pending.get(key)!;
    };
    const whtForms = ['PND2', 'PND3', 'PND53'] as const;
    for (const exp of whtExpenses) {
      if ((!exp.paymentId && parseFloat(exp.whtAmount) === 0) || parseFloat(exp.whtAmount) < 0 || parseFloat(exp.grossAmount) <= 0) continue;
      const sourceLineKey = exp.sourceLineKey ?? (exp.paymentId ? `payment:${exp.paymentId}` : '__HEADER__');
      const bankRemitted = exp.whtRemittance === 'E_WHT';
      if (await this.taxRepo.isWithholdingPaymentFiled?.(companyId, 'expense.record', exp.id, undefined, exp.paymentId ? sourceLineKey : undefined, bankRemitted)) { result.skippedLocked++; continue; }
      if (exp.payeeEntityKind !== 'INDIVIDUAL' && exp.payeeEntityKind !== 'JURISTIC') {
        if (!bankRemitted) {
          const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'WHT', formType: 'PND53', periodKey: formPeriodKey('PND53', exp.expenseDate) });
          review(exp, period.id).needed.add('WHT_PAYEE_KIND_UNKNOWN');
          await this.taxRepo.supersedeUnclassifiedWithholding(companyId, 'expense.record', exp.id);
        }
        continue;
      }
      const route = await this.withholdingForm(companyId, exp.payeeEntityKind, 'JURISTIC', exp.expenseDate, 'expense.record', exp.id, exp.vendorName, exp.incomeCategoryCode, sourceLineKey, bankRemitted);
      if (!route) continue;
      const { formType, filingRoute } = route;
      const eventType = formType === 'PND2' ? 'WHT_PND2' : formType === 'PND3' ? 'WHT_PND3' : 'WHT_PND53';
      const periodKey = formPeriodKey(formType, exp.expenseDate);
      if (!bankRemitted && formType !== 'PND2' && await this.taxRepo.isWithholdingPaymentFiled?.(companyId, 'expense.record', exp.id, { formType, periodKey }, exp.paymentId ? sourceLineKey : undefined)) { result.skippedLocked++; continue; }
      const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'WHT', formType, periodKey });
      if (bankRemitted) {
        for (const code of ['WHT_PAYEE_KIND_UNKNOWN', 'MISSING_TAX_ID', 'FUNCTIONAL_CURRENCY_FX_MISSING', 'WHT_RATE_MISMATCH']) {
          await this.taxRepo.resolveSourceIssues(companyId, code, 'expense.record', exp.id, undefined, whtForms);
        }
      } else {
        const rowReview = review(exp, period.id);
        if (Number(exp.whtRate) === 1 && eWhtReducedRateOn(exp.incomeCategoryCode, exp.expenseDate.toISOString().slice(0, 10))) rowReview.needed.add('WHT_RATE_MISMATCH');
        const missingFx = filingRoute === 'SYSTEM_FILLS' && exp.currency.toUpperCase() !== baseCurrency;
        const missingTaxId = filingRoute === 'SYSTEM_FILLS' && !exp.vendorTaxId;
        if (missingFx) rowReview.needed.add('FUNCTIONAL_CURRENCY_FX_MISSING');
        if (missingTaxId) rowReview.needed.add('MISSING_TAX_ID');
        try { if (formType === 'PND2') assertPeriodUnlocked(period.status, formType, periodKey); }
        catch { result.skippedLocked++; continue; }
        if (missingFx || missingTaxId) continue;
      }
      const hash = computeSourceHash({ sourceLineKey, paymentDate: exp.expenseDate.toISOString(), grossAmount: exp.grossAmount, whtAmount: exp.whtAmount, updatedAt: exp.updatedAt.toISOString(), incomeCategoryCode: exp.incomeCategoryCode,
        ...(bankRemitted ? { remittance: 'E_WHT' } : {}) });
      const idKey = taxEventIdempotencyKey(companyId, 'expense.record', exp.id, `${eventType}:${hash}`);
      const existing = await this.activeEvent(companyId, 'expense.record', exp.id, sourceLineKey, null, eventType, idKey);
      if (existing && existing.sourceHash === hash) continue;
      if (existing) await this.taxRepo.supersedeEvent(existing.id);
      await this.taxRepo.upsertEvent({
        companyId, branchId: exp.branchId, taxPeriodId: period.id, idempotencyKey: idKey, eventType, status: bankRemitted ? 'EXCLUDED' : 'ACTIVE',
        expectedExpenseConfirmedAt: exp.confirmedAt, sourceType: 'expense.record', sourceId: exp.id, sourceLineKey, sourceEventType: bankRemitted ? 'expense.wht.e_wht' : 'expense.wht', sourceHash: hash,
        periodKey, eventDate: exp.expenseDate, taxableBase: exp.grossAmount, taxAmount: exp.whtAmount, currency: exp.currency,
        vatMode: null, outputTaxCode: null, whtFormType: formType,
        payeeSnapshot: { name: exp.vendorName ?? '', taxId: exp.vendorTaxId, address: exp.vendorAddress ?? null, branchCode: exp.vendorBranchCode ?? null },
        incomeCategoryCode: exp.incomeCategoryCode ?? null, whtRate: exp.whtRate ?? null,
        grossAmount: exp.grossAmount, withheldAmount: exp.whtAmount, netPaidAmount: exp.paymentAmount ?? null,
        taxInvoiceNumber: null, reviewNote: null,
      });
      if (bankRemitted) result.whtBankRemittedRecorded++;
      else result.whtCreated++;
    }
    const desired = new Set<string>();
    for (const row of pending.values()) for (const code of ['WHT_PAYEE_KIND_UNKNOWN', 'MISSING_TAX_ID', 'FUNCTIONAL_CURRENCY_FX_MISSING', 'WHT_RATE_MISMATCH'] as const) {
      if (row.needed.has(code)) {
        desired.add(JSON.stringify([row.sourceId, row.taxPeriodId, code]));
        const issue = code === 'FUNCTIONAL_CURRENCY_FX_MISSING'
          ? { severity: 'BLOCKING' as const, description: withholdingIssueDescription(code, '', row.payee) }
          : makeReviewIssue(code, { context: row.payee ?? undefined });
        await this.taxRepo.createIssue({ companyId, taxPeriodId: row.taxPeriodId, severity: issue.severity, issueCode: code, description: issue.description, sourceType: 'expense.record', sourceId: row.sourceId });
        result.reviewIssuesCreated++;
      } else await this.taxRepo.resolveSourceIssues(companyId, code, 'expense.record', row.sourceId, row.taxPeriodId, whtForms);
    }
    await this.taxRepo.resolveStaleExpenseWithholdingIssues?.(companyId, desired);

    // ── WHT from recorded supplier payments that withheld tax (RA-20) ─────────
    // The same forms as the expense loop above, from the other seam: an expense withholds when the
    // money leaves, including each partial cash payment. They cannot double-count — a bill that
    // withheld at accrual is refused a second withholding at payment (wht_double_withholding).
    const whtPayments = await this.supplierPaymentSource.findRecordedWithWhtByCompany(companyId, since);
    for (const pay of whtPayments) {
      if (parseFloat(pay.whtAmount) <= 0) continue;
      if (await this.taxRepo.isWithholdingPaymentFiled?.(companyId, 'procurement.supplier_payment', pay.id)) { result.skippedLocked++; continue; }
      const route = await this.withholdingForm(companyId, pay.supplierType, 'JURISTIC_PERSON', pay.paymentDate, 'procurement.supplier_payment', pay.id, pay.payeeName, pay.incomeCategoryCode);
      if (!route) { result.reviewIssuesCreated++; continue; }
      const { formType, filingRoute } = route;
      const eventType = formType === 'PND2' ? 'WHT_PND2' : formType === 'PND3' ? 'WHT_PND3' : 'WHT_PND53';
      const periodKey = formPeriodKey(formType, pay.paymentDate);
      if (formType !== 'PND2' && await this.taxRepo.isWithholdingPaymentFiled?.(companyId, 'procurement.supplier_payment', pay.id, { formType, periodKey })) { result.skippedLocked++; continue; }
      const period = await this.taxRepo.upsertPeriod({ companyId, taxType: 'WHT', formType, periodKey });

      if (filingRoute === 'SYSTEM_FILLS' && pay.currency.toUpperCase() !== baseCurrency) {
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: 'BLOCKING', issueCode: 'FUNCTIONAL_CURRENCY_FX_MISSING', description: withholdingIssueDescription('FUNCTIONAL_CURRENCY_FX_MISSING', '', pay.payeeName), sourceType: 'procurement.supplier_payment', sourceId: pay.id });
        result.reviewIssuesCreated++;
        continue;
      }

      try { if (formType === 'PND2') assertPeriodUnlocked(period.status, formType, periodKey); }
      catch { result.skippedLocked++; continue; }

      if (filingRoute === 'SYSTEM_FILLS' && !pay.payeeTaxId) {
        const issue = makeReviewIssue('MISSING_TAX_ID', { context: pay.payeeName ?? pay.id });
        await this.taxRepo.createIssue({ companyId, taxPeriodId: period.id, severity: issue.severity, issueCode: issue.code, description: issue.description, sourceType: 'procurement.supplier_payment', sourceId: pay.id });
        result.reviewIssuesCreated++;
        continue;
      }

      await this.taxRepo.resolveSourceIssues(companyId, 'MISSING_TAX_ID', 'procurement.supplier_payment', pay.id, period.id);
      await this.taxRepo.resolveSourceIssues(companyId, 'FUNCTIONAL_CURRENCY_FX_MISSING', 'procurement.supplier_payment', pay.id, period.id);
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
