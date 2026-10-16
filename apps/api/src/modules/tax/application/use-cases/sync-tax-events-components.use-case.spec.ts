import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SyncTaxEventsUseCase } from './sync-tax-events.use-case.js';
import { ExpenseSourceAdapter } from '../../infrastructure/adapters/expense-source.adapter.js';

// These suites cover the document/expense seams; the supplier-payment WHT seam has its own file.
const noWhtPayments = { findRecordedWithWhtByCompany: async () => [] } as any;

const snapshot = (direction: 'OUTPUT' | 'SELF_ASSESSED', amount: string) => ({
  taxCodeDefinitionId: 'def-1', externalTaxCode: 'V3', taxProfileKey: 'TH-S4', taxProfileVersion: 2,
  taxRegime: 'VAT', taxDirection: direction, taxTreatment: 'REVERSE_CHARGE', taxContext: 'IMPORT_SERVICE',
  taxRate: '7', sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-08-02',
  taxBaseAmount: '100.00', taxAmount: amount, claimability: direction === 'OUTPUT' ? 'NOT_APPLICABLE' : 'CLAIMABLE',
  evidenceStatus: 'VERIFIED', accountRuleVersion: 3, reportRuleVersion: 4,
  recognitionDate: '2026-08-02', evidenceRefs: ['ev-pp36'],
});

describe('SyncTaxEventsUseCase transaction-tax components', () => {
  it('persists separate source-line PP36 components with immutable snapshots', async () => {
    const events: any[] = [];
    const taxRepo = {
      upsertPeriod: async (input: any) => ({ id: `period-${input.formType}`, status: 'OPEN' }),
      findEventByIdempotencyKey: async () => null,
      supersedeEvent: async () => undefined,
      upsertEvent: async (input: any) => { events.push(input); },
      createIssue: async () => undefined,
    } as any;
    const docSource = { findFinalizedTransactionTaxLines: async () => [], findIssuedWithVatByCompany: async () => [] } as any;
    const expenseSource = {
      findFinalizedTransactionTaxLines: async () => [{
        sourceType: 'procurement.vendor_bill', sourceId: 'bill-1', sourceLineId: 'line-1', companyId: 'c1', branchId: 'b1',
        sourceEventType: 'APPROVED', eventDate: new Date('2026-07-14'), currency: 'THB', vatMode: 'VAT_EXCLUDED', taxInvoiceNumber: 'INV-1', updatedAt: new Date('2026-07-14'),
        taxComponents: [
          { componentKey: 'PP36_OUTPUT', snapshot: snapshot('SELF_ASSESSED', '7.00'), accountRole: 'PP36_OUTPUT_VAT_PAYABLE', accountId: 'a1', accountAssignments: [{ accountRole: 'PP36_OUTPUT_VAT_PAYABLE', accountId: 'a1', postingSide: 'CREDIT', ruleVersion: 3 }], reportContributions: [{ formType: 'PP36', boxKey: 'tax_due', amountSource: 'TAX_AMOUNT', amount: '7.00' }] },
          { componentKey: 'PP36_INPUT', snapshot: snapshot('SELF_ASSESSED', '7.00'), accountRole: 'PP36_INPUT_VAT_CLAIMABLE', accountId: 'a2', accountAssignments: [{ accountRole: 'PP36_INPUT_VAT_CLAIMABLE', accountId: 'a2', postingSide: 'DEBIT', ruleVersion: 3 }], reportContributions: [{ formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT', amount: '7.00' }] },
        ],
      }],
      findConfirmedWithVatByCompany: async () => [], findConfirmedWithWhtByCompany: async () => [],
    } as any;
    const result = await new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments).execute('c1');
    assert.equal(result.transactionTaxComponentsCreated, 2);
    assert.deepEqual(events.map((event) => [event.sourceLineKey, event.componentKey, event.taxPeriodId]), [
      ['line-1', 'PP36_OUTPUT', 'period-PP36'], ['line-1', 'PP36_INPUT', 'period-PP30'],
    ]);
    assert.equal(events[0]?.taxSnapshot.taxProfileVersion, 2);
    assert.deepEqual(events.map((event) => event.periodKey), ['2026-08', '2026-08']);
  });

  it('does not create PP36 events before payment recognition date is finalized', async () => {
    const events: any[] = [];
    const taxRepo = {
      upsertPeriod: async () => { throw new Error('period must not be created'); },
      findEventByIdempotencyKey: async () => null,
      supersedeEvent: async () => undefined,
      upsertEvent: async (input: any) => { events.push(input); },
      createIssue: async () => undefined,
    } as any;
    const pendingSnapshot = { ...snapshot('SELF_ASSESSED', '7.00'), recognitionDate: undefined };
    const row = {
      sourceType: 'procurement.vendor_bill', sourceId: 'bill-1', sourceLineId: 'line-1', companyId: 'c1', branchId: 'b1',
      sourceEventType: 'APPROVED', eventDate: new Date('2026-07-14'), currency: 'THB', vatMode: 'VAT_EXCLUDED', taxInvoiceNumber: 'INV-1', updatedAt: new Date('2026-07-14'),
      taxComponents: [
        { componentKey: 'PP36_OUTPUT', snapshot: pendingSnapshot, accountAssignments: [], reportContributions: [] },
        { componentKey: 'PP36_INPUT', snapshot: pendingSnapshot, accountAssignments: [], reportContributions: [] },
      ],
    };
    const docSource = { findFinalizedTransactionTaxLines: async () => [], findIssuedWithVatByCompany: async () => [] } as any;
    const expenseSource = { findFinalizedTransactionTaxLines: async () => [row], findConfirmedWithVatByCompany: async () => [], findConfirmedWithWhtByCompany: async () => [] } as any;
    const result = await new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments).execute('c1');
    assert.equal(result.transactionTaxComponentsCreated, 0);
    assert.deepEqual(events, []);
  });

  it('creates only PP36 output while input VAT remains pending for a later claim release', async () => {
    const events: any[] = [];
    const fx = { sourceCurrency: 'USD', taxCurrency: 'THB', exchangeRate: '35', exchangeRateSource: 'BOT', exchangeRateDate: '2026-08-02' };
    const output = { ...snapshot('SELF_ASSESSED', '7.00'), ...fx };
    const pending = { ...snapshot('SELF_ASSESSED', '7.00'), ...fx, claimability: 'PENDING_EVIDENCE', evidenceStatus: 'REVIEW_REQUIRED' };
    const row = { sourceType: 'procurement.vendor_bill', sourceId: 'bill-1', sourceLineId: 'line-1', companyId: 'c1', branchId: 'b1',
      sourceEventType: 'PAID', eventDate: new Date('2026-07-14'), currency: 'USD', vatMode: 'NO_VAT', taxInvoiceNumber: null, updatedAt: new Date(),
      taxComponents: [
        { componentKey: 'PP36_OUTPUT', snapshot: output, accountAssignments: [{ accountRole: 'PP36_OUTPUT_VAT_PAYABLE', accountId: 'out', postingSide: 'CREDIT', ruleVersion: 1 }], reportContributions: [{ formType: 'PP36', boxKey: 'tax_due', amountSource: 'TAX_AMOUNT', amount: '7' }] },
        { componentKey: 'PP36_INPUT', snapshot: pending, accountAssignments: [{ accountRole: 'INPUT_VAT_PENDING', accountId: 'pending', postingSide: 'DEBIT', ruleVersion: 2 }], reportContributions: [] },
      ] };
    const taxRepo = { upsertPeriod: async () => ({ id: 'pp36-period', status: 'OPEN' }), findEventByIdempotencyKey: async () => null,
      upsertEvent: async (event: any) => { events.push(event); }, createIssue: async () => assert.fail('pending input must not create a blocking issue') } as any;
    const docSource = { findFinalizedTransactionTaxLines: async () => [], findIssuedWithVatByCompany: async () => [] } as any;
    const expenseSource = { findFinalizedTransactionTaxLines: async () => [row], findConfirmedWithVatByCompany: async () => [], findConfirmedWithWhtByCompany: async () => [] } as any;
    const result = await new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments).execute('c1');
    assert.equal(result.transactionTaxComponentsCreated, 1);
    assert.deepEqual(events.map((event) => [event.componentKey, event.currency]), [['PP36_OUTPUT', 'THB']]);
  });

  it('routes customs-assessed components to a functional-currency customs period', async () => {
    const events: any[] = [];
    const periods: any[] = [];
    const customsSnapshot = { ...snapshot('SELF_ASSESSED', '350.00'), taxRegime: 'CUSTOMS_DUTY', taxDirection: 'INPUT', taxTreatment: 'NONDEDUCTIBLE_CAPITALIZED', taxContext: 'IMPORT_GOODS', sourceCurrency: 'USD', taxCurrency: 'THB', exchangeRate: '35', exchangeRateSource: 'CUSTOMS_ENTRY', exchangeRateDate: '2026-07-14', recognitionDate: '2026-07-14' };
    const row = { sourceType: 'procurement.vendor_bill', sourceId: 'bill-customs', sourceLineId: 'line-customs', companyId: 'c1', branchId: null,
      sourceEventType: 'APPROVED', eventDate: new Date('2026-07-14'), currency: 'USD', vatMode: 'NO_VAT', taxInvoiceNumber: null, updatedAt: new Date(),
      taxComponents: [{ componentKey: 'CUSTOMS_DUTY', snapshot: customsSnapshot, accountAssignments: [{ accountRole: 'CUSTOMS_DUTY_PAYABLE', accountId: 'duty-payable', postingSide: 'CREDIT', ruleVersion: 1 }], reportContributions: [{ formType: 'CUSTOMS_SUPPORT', boxKey: 'customs_duty', amountSource: 'DUTY', amount: '350' }] }] };
    const taxRepo = { upsertPeriod: async (input: any) => { periods.push(input); return { id: 'customs-period', status: 'OPEN' }; }, findEventByIdempotencyKey: async () => null,
      upsertEvent: async (event: any) => { events.push(event); }, createIssue: async () => undefined } as any;
    const docSource = { findFinalizedTransactionTaxLines: async () => [], findIssuedWithVatByCompany: async () => [] } as any;
    const expenseSource = { findFinalizedTransactionTaxLines: async () => [row], findConfirmedWithVatByCompany: async () => [], findConfirmedWithWhtByCompany: async () => [] } as any;
    await new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments).execute('c1');
    assert.deepEqual(periods.map(({ taxType, formType }) => [taxType, formType]), [['CUSTOMS', 'CUSTOMS_SUPPORT']]);
    assert.deepEqual(events.map(({ eventType, currency }) => [eventType, currency]), [['CUSTOMS_ASSESSED', 'THB']]);
  });

  it('supersedes active component events on void but does not rewrite a locked tax period', async () => {
    const superseded: string[] = [];
    const issues: any[] = [];
    const component = { componentKey: 'VAT', snapshot: { ...snapshot('OUTPUT', '7.00'), recognitionDate: '2026-07-14' }, accountAssignments: [], reportContributions: [] };
    const row = { sourceType: 'accounting.document', sourceId: 'doc-1', sourceLineId: 'line-1', companyId: 'c1', branchId: null, sourceEventType: 'VOIDED', eventDate: new Date('2026-07-14'), currency: 'THB', vatMode: 'VAT_EXCLUDED', taxInvoiceNumber: 'T1', updatedAt: new Date(), taxComponents: [component] };
    let locked = false;
    const taxRepo = { upsertPeriod: async () => ({ id: 'p1', status: locked ? 'FILED' : 'OPEN' }), findEventByIdempotencyKey: async () => ({ id: 'e1', status: 'ACTIVE' }), supersedeEvent: async (id: string) => { superseded.push(id); }, upsertEvent: async () => undefined, createIssue: async (issue: any) => { issues.push(issue); } } as any;
    const docSource = { findVoidedTransactionTaxLines: async () => [row], findFinalizedTransactionTaxLines: async () => [], findIssuedWithVatByCompany: async () => [] } as any;
    const expenseSource = { findVoidedTransactionTaxLines: async () => [], findFinalizedTransactionTaxLines: async () => [], findConfirmedWithVatByCompany: async () => [], findConfirmedWithWhtByCompany: async () => [] } as any;
    const useCase = new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments);
    assert.equal((await useCase.execute('c1')).voidedComponentsSuperseded, 1);
    locked = true;
    assert.equal((await useCase.execute('c1')).skippedLocked, 1);
    assert.deepEqual(superseded, ['e1']);
    assert.equal(issues[0]?.issueCode, 'VOID_AFTER_TAX_PERIOD_LOCK');
  });

  it('creates a hash-versioned successor without reactivating the superseded event', async () => {
    const superseded: string[] = [];
    const created: any[] = [];
    const component = { componentKey: 'VAT', snapshot: snapshot('OUTPUT', '7.00'), accountAssignments: [], reportContributions: [] };
    const row = { sourceType: 'accounting.document', sourceId: 'doc-1', sourceLineId: 'line-1', companyId: 'c1', branchId: null, sourceEventType: 'ISSUED', eventDate: new Date('2026-07-14'), currency: 'THB', vatMode: 'VAT_EXCLUDED', taxInvoiceNumber: 'T1', updatedAt: new Date('2026-07-15'), taxComponents: [component] };
    const taxRepo = { upsertPeriod: async () => ({ id: 'p1', status: 'OPEN' }), findActiveEventBySourceComponent: async () => ({ id: 'old-event', status: 'ACTIVE', sourceHash: 'old-hash' }), findEventByIdempotencyKey: async () => null, supersedeEvent: async (id: string) => { superseded.push(id); }, upsertEvent: async (event: any) => { created.push(event); }, createIssue: async () => undefined } as any;
    const docSource = { findVoidedTransactionTaxLines: async () => [], findFinalizedTransactionTaxLines: async () => [row], findIssuedWithVatByCompany: async () => [] } as any;
    const expenseSource = { findVoidedTransactionTaxLines: async () => [], findFinalizedTransactionTaxLines: async () => [], findConfirmedWithVatByCompany: async () => [], findConfirmedWithWhtByCompany: async () => [] } as any;
    await new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments).execute('c1');
    assert.deepEqual(superseded, ['old-event']);
    assert.equal(created.length, 1);
    assert.notEqual(created[0]?.idempotencyKey, 'old-event');
  });

  it('opens a blocking issue when source tax facts change after the period is locked', async () => {
    const issues: any[] = [];
    const component = { componentKey: 'VAT', snapshot: snapshot('OUTPUT', '8.00'), accountAssignments: [], reportContributions: [] };
    const row = { sourceType: 'accounting.document', sourceId: 'doc-1', sourceLineId: 'line-1', companyId: 'c1', branchId: null,
      sourceEventType: 'ISSUED', eventDate: new Date('2026-07-14'), currency: 'THB', vatMode: 'VAT_EXCLUDED', taxInvoiceNumber: 'T1', updatedAt: new Date('2026-07-15'), taxComponents: [component] };
    const taxRepo = { upsertPeriod: async () => ({ id: 'p1', status: 'FILED' }),
      findActiveEventBySourceComponent: async () => ({ id: 'old-event', status: 'ACTIVE', sourceHash: 'old-hash' }),
      createIssue: async (issue: any) => { issues.push(issue); } } as any;
    const docSource = { findVoidedTransactionTaxLines: async () => [], findFinalizedTransactionTaxLines: async () => [row], findIssuedWithVatByCompany: async () => [] } as any;
    const expenseSource = { findVoidedTransactionTaxLines: async () => [], findFinalizedTransactionTaxLines: async () => [], findConfirmedWithVatByCompany: async () => [], findConfirmedWithWhtByCompany: async () => [] } as any;
    const result = await new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments).execute('c1');
    assert.equal(result.skippedLocked, 1);
    assert.equal(result.reviewIssuesCreated, 1);
    assert.equal(issues[0]?.issueCode, 'SOURCE_CHANGED_AFTER_TAX_PERIOD_LOCK');
  });
});

/**
 * Vendor-address Slice 2, controller review fix 1: the buyer-mismatch mark flips the expense HEADER to
 * NON_CLAIMABLE. The current decision gates both the header and immutable component paths;
 * components keep their original amounts, but waiting or refused VAT never enters ภ.พ.30.
 */
describe('header NON_CLAIMABLE against the two input-VAT paths', () => {
  const v7Component = {
    componentKey: 'VAT',
    snapshot: {
      taxCodeDefinitionId: 'def-v7', externalTaxCode: 'V7', taxProfileKey: 'WATCHDOG_TH_DOMESTIC_EXPENSE_V1', taxProfileVersion: 1,
      taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'CLAIMABLE', taxContext: 'DOMESTIC_PURCHASE', taxRate: '7',
      sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-09-04',
      taxBaseAmount: '100.00', taxAmount: '7.00', claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
    },
    accountAssignments: [{ accountRole: 'INPUT_VAT_CLAIMABLE', accountId: 'acc-1154', postingSide: 'DEBIT', ruleVersion: 1 }],
    reportContributions: [
      { formType: 'PP30', boxKey: 'box_6_eligible_purchases', amountSource: 'TAX_BASE', amount: '100.00' },
      { formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT', amount: '7.00' },
    ],
  };
  const markedExpense = (taxComponentsJson: unknown) => ({
    id: 'exp-1', companyId: 'c1', branchId: null, status: 'CONFIRMED', expenseDate: new Date('2026-09-04'), currency: 'THB',
    vatMode: 'VAT_EXCLUDED', vendorDocumentNumber: 'INV-9', updatedAt: new Date('2026-09-05'),
    inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'USABLE_FOR_TAX',
    vatAmount: '7', taxableAmount: '100', whtAmount: '0', grandTotalAmount: '107',
    lines: [{ id: 'line-1', lineNumber: 1, taxComponentsJson }],
  });
  // Honours the two `lines` predicates the adapter's queries actually send.
  const adapterOver = (expense: ReturnType<typeof markedExpense>) => {
    const hasComponents = expense.lines.some((line) => line.taxComponentsJson != null);
    return new ExpenseSourceAdapter({ client: {
      expenseRecord: { findMany: async ({ where }: any) => {
        if (where.status !== 'CONFIRMED' || !where.lines) return [];
        if (where.lines.none) return hasComponents ? [] : [expense];
        return hasComponents ? [expense] : [];
      } },
      vendorBill: { findMany: async () => [] },
    } } as any);
  };
  const run = async (expense: ReturnType<typeof markedExpense>) => {
    const events: any[] = [];
    const issues: any[] = [];
    const taxRepo = {
      upsertPeriod: async () => ({ id: 'pp30', status: 'OPEN' }), findEventByIdempotencyKey: async () => null,
      supersedeEvent: async () => undefined, upsertEvent: async (event: any) => { events.push(event); },
      createIssue: async (issue: any) => { issues.push(issue); },
    } as any;
    const docSource = { findFinalizedTransactionTaxLines: async () => [], findIssuedWithVatByCompany: async () => [] } as any;
    const result = await new SyncTaxEventsUseCase(taxRepo, docSource, adapterOver(expense), noWhtPayments).execute('c1');
    return { result, events, issues };
  };

  for (const inputVatClaimStatus of ['NEEDS_REVIEW', 'NON_CLAIMABLE', 'CLAIMABLE']) it(`component VAT follows the expense decision ${inputVatClaimStatus}`, async () => {
    const expense = { ...markedExpense([v7Component]), inputVatClaimStatus };
    const { result, events } = await run(expense);
    assert.equal(result.vatInputCreated, inputVatClaimStatus === 'CLAIMABLE' ? 1 : 0);
    assert.equal(events.length, inputVatClaimStatus === 'CLAIMABLE' ? 1 : 0);
    if (inputVatClaimStatus === 'CLAIMABLE') assert.deepEqual(events[0]?.reportContributions.map((c: any) => [c.boxKey, c.amount]),
      [['box_6_eligible_purchases', '100.00'], ['box_7_input_tax', '7.00']]);
  });

  it('does honour the header when no line carries a Tax Code component', async () => {
    const { result, events, issues } = await run(markedExpense(null));
    assert.equal(result.vatInputCreated, 0);
    assert.deepEqual(events, []);
    assert.equal(issues[0]?.issueCode, 'INPUT_VAT_NOT_CLAIMABLE');
  });
});


it('passes the expense snapshot revision into tax persistence so a concurrent correction cannot recreate events', async () => {
  const version = new Date('2026-08-02T01:00:00Z');
  const events: any[] = [];
  const taxRepo: any = { upsertPeriod: async () => ({ id: 'period', status: 'OPEN' }), findEventByIdempotencyKey: async () => null, upsertEvent: async (event: any) => events.push(event) };
  const expenseSource: any = { findConfirmedWithVatByCompany: async () => [], findConfirmedWithWhtByCompany: async () => [],
    findFinalizedTransactionTaxLines: async () => [{ sourceType: 'expense.record', inputVatClaimStatus: 'CLAIMABLE', taxEvidenceStatus: 'USABLE_FOR_TAX', sourceId: 'e1', sourceLineId: 'l1', eventDate: version, confirmedAt: version, updatedAt: new Date(version.getTime() + 1000), currency: 'THB', taxComponents: [{ componentKey: 'VAT', snapshot: { ...snapshot('SELF_ASSESSED', '7'), recognitionDate: '2026-08-02' }, accountAssignments: [], reportContributions: [] }] }] };
  await new SyncTaxEventsUseCase(taxRepo, { findIssuedWithVatByCompany: async () => [] } as any, expenseSource, noWhtPayments).execute('c1');
  assert.equal(events.length, 1); assert.equal(events[0].expectedExpenseConfirmedAt, version);
});
