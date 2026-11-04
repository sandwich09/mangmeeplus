import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyncTaxEventsUseCase } from './sync-tax-events.use-case.js';

// These suites cover the document/expense seams; the supplier-payment WHT seam has its own file.
const noWhtPayments = { findRecordedWithWhtByCompany: async () => [] } as any;

function whtExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1',
    companyId: 'company-1',
    expenseDate: new Date('2026-07-13T00:00:00.000Z'),
    whtAmount: '30.0000',
    grossAmount: '1000.0000',
    vendorName: 'ผู้รับเงิน',
    vendorTaxId: '0100000000000',
    vendorBranchCode: '00003',
    payeeEntityKind: 'JURISTIC',
    incomeCategoryCode: 'SERVICE_FEE',
    whtRate: '3.0000',
    currency: 'THB',
    updatedAt: new Date('2026-07-13T10:00:00.000Z'),
    ...overrides,
  };
}

function harness(rows: Array<Record<string, unknown>>) {
  const events: any[] = [];
  const periods: any[] = [];
  const issues: any[] = [];
  const supersededSources: any[] = [];
  const taxRepo = {
    upsertPeriod: async (input: any) => { periods.push(input); return { id: `period-${input.formType}`, status: 'OPEN' }; },
    findActiveEventBySourceComponent: async () => null,
    supersedeEvent: async () => undefined,
    upsertEvent: async (input: any) => { events.push(input); },
    createIssue: async (input: any) => { if (!issues.some(i => i.status === 'OPEN' && i.sourceId === input.sourceId)) issues.push({ ...input, status: 'OPEN' }); },
    supersedeUnclassifiedWithholding: async (...args: any[]) => { supersededSources.push(args); },
    resolveSourceIssues: async (_company: string, code: string, _type: string, id: string) => { for (const issue of issues) if (issue.issueCode === code && issue.sourceId === id) issue.status = 'RESOLVED'; },
  } as any;
  const docSource = { findIssuedWithVatByCompany: async () => [] } as any;
  const expenseSource = {
    findConfirmedWithVatByCompany: async () => [],
    findConfirmedWithWhtByCompany: async () => rows,
  } as any;
  return { taxRepo, events, periods, issues, supersededSources, run: (scope: 'ALL' | 'WHT' | 'PND53' = 'ALL') => new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments).execute('company-1', undefined, scope) };
}

describe('accountant export shared WHT projection', () => {
  it('withholdingFormFor preserves every sync payee and filing-route decision', async () => {
    const logic: any = await import('../../domain/logic/expense-payment-withholding.logic');
    assert.equal(typeof logic.withholdingFormFor, 'function');
    for (const route of [undefined, 'SYSTEM_FILLS', 'ACCOUNTANT_PREPARES', 'SEPARATE_PND2']) {
      assert.equal(logic.withholdingFormFor('INDIVIDUAL', route), route === 'SEPARATE_PND2' ? 'PND2' : 'PND3');
      for (const kind of ['JURISTIC', 'JURISTIC_PERSON']) assert.equal(logic.withholdingFormFor(kind, route), 'PND53');
      for (const kind of [null, 'FOREIGN', 'GOVERNMENT', 'OTHER']) assert.equal(logic.withholdingFormFor(kind, route), null);
    }
  });

  function adapterFixture(overrides: Record<string, unknown> = {}) {
    const row = (id: string) => ({ id, companyId: 'company-1', status: 'CONFIRMED', expenseDate: new Date('2026-10-01'), updatedAt: new Date('2026-10-01'),
      vendorNameSnapshot: 'ผู้รับเงิน', vendorAddressSnapshot: 'กรุงเทพ', vendorEntityKindSnapshot: 'INDIVIDUAL', vendorCounterpartyId: null,
      whtAmount: '30', netPayableAmount: '970', taxableAmount: '1000', grandTotalAmount: '1000', whtRate: '3', whtCategoryCode: 'SERVICE_FEE',
      lines: [], payments: [1, 2].map(n => ({ id: `${id}-${n}`, amount: '485', status: 'RECORDED', paidAtConfirmed: true,
        paidAt: new Date(`2026-10-0${n}`), createdAt: new Date(`2026-10-0${n}`) })), ...overrides });
    const queries: any[] = [], otherQueries: string[] = [];
    const db = { expenseRecord: { findMany: async ({ where }: any) => { queries.push(where); return [row('A'), row('B')].filter(r => r.companyId === where.companyId && r.status === where.status && Number(r.whtAmount) > where.whtAmount.gt && (!where.id || where.id.in.includes(r.id))); } },
      whtFilingLine: { findMany: async () => { otherQueries.push('filing'); return []; } }, company: { findUnique: async () => { otherQueries.push('company'); return { timezone: 'Asia/Bangkok' }; } } };
    return { db, queries, otherQueries };
  }

  it('WHT selection distinguishes empty from omitted IDs', async () => {
    const { ExpenseSourceAdapter } = await import('../../infrastructure/adapters/expense-source.adapter');
    const f = adapterFixture(); const adapter: any = new ExpenseSourceAdapter({ client: f.db } as any);
    assert.deepEqual(await adapter.findConfirmedWithWhtByCompany('company-1', undefined, { expenseIds: [] }), []);
    assert.deepEqual(f.queries, []); assert.deepEqual(f.otherQueries, []);
    const selected = await adapter.findConfirmedWithWhtByCompany('company-1', undefined, { expenseIds: ['A'] });
    assert.deepEqual(selected.map((row: any) => [row.id, row.grossAmount, row.whtAmount]), [['A', '500', '15'], ['A', '500', '15']]);
    for (const args of [[], [undefined], [undefined, {}], [undefined, { expenseIds: undefined }]]) {
      const rows = await adapter.findConfirmedWithWhtByCompany('company-1', ...args);
      assert.deepEqual(rows.map((row: any) => row.id), ['A', 'A', 'B', 'B']);
      assert.ok(!('id' in f.queries.at(-1)!));
    }
    const h = harness([]); const calls: any[][] = [];
    await new SyncTaxEventsUseCase(h.taxRepo, { findIssuedWithVatByCompany: async () => [] } as any,
      { findConfirmedWithWhtByCompany: async (...args: any[]) => { calls.push(args); return []; } } as any, noWhtPayments).execute('company-1', undefined, 'WHT');
    assert.deepEqual(calls, [['company-1', undefined]], 'sync keeps two arguments');
  });

  it('shared projection preserves split rates, explicit base, amount-only tax and unconfirmed dates', async () => {
    const { ExpenseSourceAdapter } = await import('../../infrastructure/adapters/expense-source.adapter');
    const project = async (overrides: Record<string, unknown>) => {
      const f = adapterFixture(overrides); return new ExpenseSourceAdapter({ client: f.db } as any).findConfirmedWithWhtByCompany('company-1');
    };
    const legacy = await project({ whtAmount: '24', netPayableAmount: '976', lines: [
      { id: 'rent', taxableAmount: '300', whtAmount: '3', whtRate: '0.01', whtCategoryCode: 'RENT' },
      { id: 'service', taxableAmount: '700', whtAmount: '21', whtRate: '0.03', whtCategoryCode: 'SERVICE_FEE' }],
      payments: [{ id: 'p', amount: '976', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-10-02'), createdAt: new Date('2026-10-02') }] });
    assert.deepEqual(legacy.slice(0, 2).map(row => [row.grossAmount, row.whtAmount, row.whtRate]), [['300', '3', '1.0000'], ['700', '21', '3.0000']]);
    const explicit = await project({ whtAmount: '8.12', netPayableAmount: '991.88',
      whtInputJson: { inputType: 'RATE', value: '3', baseAmount: '270.50', origin: 'REVIEWER' },
      payments: [{ id: 'p', amount: '991.88', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-10-02'), createdAt: new Date('2026-10-02') }] });
    assert.equal(explicit.filter(row => row.id === 'A').reduce((sum, row) => sum + Number(row.grossAmount), 0), 270.50);
    const amount = await project({ whtInputJson: { inputType: 'AMOUNT', value: '30', baseAmount: '1000', origin: 'REVIEWER' } });
    assert.ok(amount.every(row => row.whtRate === null));
    assert.deepEqual(await project({ payments: [{ id: 'p', amount: '970', status: 'RECORDED', paidAtConfirmed: false, paidAt: new Date('2026-10-02'), createdAt: new Date('2026-10-02') }] }), []);
  });

  it('withholdingRowFaults keeps the existing Thai row faults', async () => {
    const validation: any = await import('../services/withholding-filing-validation');
    assert.equal(typeof validation.withholdingRowFaults, 'function');
    const event = { eventType: 'WHT_PND3', sourceType: 'expense.record', sourceId: 'A', payeeSnapshot: { name: 'สมชาย', taxId: '123', branchCode: '', address: null },
      incomeCategoryCode: 'SERVICE_FEE', whtRate: '3', grossAmount: '1000', withheldAmount: '30' };
    const context = { formType: 'PND3', categoryByCode: new Map([['SERVICE_FEE', { nameTh: 'ค่าบริการ', formType: 'PND3' }]]), sourceKind: 'INDIVIDUAL' };
    assert.deepEqual(validation.withholdingRowFaults(event, context), [{ reason: 'payee', detail: 'สมชาย: ข้อมูลผู้รับเงินยังขาด: ที่อยู่ · เลขผู้เสียภาษีต้องมี 13 หลัก · เปิดรายจ่ายหรือคู่ค้าแล้วแก้ไข' }]);
    assert.deepEqual(validation.withholdingRowFaults({ ...event, payeeSnapshot: { ...event.payeeSnapshot, taxId: '1234567890123', address: 'กรุงเทพ' } }, context), []);
    assert.deepEqual(validation.withholdingRowFaults({ ...event, eventType: 'WHT_PND2', incomeCategoryCode: 'INTEREST', payeeSnapshot: { ...event.payeeSnapshot, taxId: '1234567890123', address: 'กรุงเทพ' } },
      { ...context, formType: 'PND2', categoryByCode: new Map([['INTEREST', { nameTh: 'ดอกเบี้ย', formType: 'PND2' }]]) }), []);
  });
});

describe('SyncTaxEventsUseCase WHT form selection', () => {
  it('carries exact amount-only WHT into tax events without fabricating a reporting rate', async () => {
    const h = harness([whtExpense({ whtAmount: '30.01', grossAmount: '1234.56', whtRate: null })]);
    await h.run();
    assert.equal(h.events[0].withheldAmount, '30.01');
    assert.equal(h.events[0].grossAmount, '1234.56');
    assert.equal(h.events[0].whtRate, null);
  });
  it('files an individual payee on ภ.ง.ด.3', async () => {
    const h = harness([whtExpense({ payeeEntityKind: 'INDIVIDUAL' })]);

    const result = await h.run();

    assert.equal(result.whtCreated, 1);
    assert.deepEqual(h.periods, [{ companyId: 'company-1', taxType: 'WHT', formType: 'PND3', periodKey: '2026-07' }]);
    assert.equal(h.events[0].eventType, 'WHT_PND3');
    assert.equal(h.events[0].whtFormType, 'PND3');
  });

  it('files a juristic payee on ภ.ง.ด.53', async () => {
    const h = harness([whtExpense({ payeeEntityKind: 'JURISTIC' })]);

    await h.run();

    assert.equal(h.events[0].eventType, 'WHT_PND53');
    assert.equal(h.events[0].whtFormType, 'PND53');
  });

  it('holds unknown kinds for review and resolves the issue on the next classified sync', async () => {
    for (const kind of [null, 'FOREIGN', 'GOVERNMENT', 'OTHER']) {
      const row = whtExpense({ payeeEntityKind: kind, vendorName: null });
      const h = harness([row]);
      await h.run('WHT'); await h.run('WHT');
      assert.equal(h.events.length, 0);
      assert.deepEqual(h.supersededSources[0], ['company-1', 'expense.record', 'expense-1']);
      assert.equal(h.issues.length, 1);
      assert.equal(h.issues[0].taxPeriodId, 'period-PND53');
      assert.equal(h.issues[0].issueCode, 'WHT_PAYEE_KIND_UNKNOWN');
      assert.equal(h.issues[0].description, 'ยังไม่รู้ว่าผู้รับเงินเป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน');
      row.payeeEntityKind = 'INDIVIDUAL';
      await h.run('WHT');
      assert.equal(h.issues[0].status, 'RESOLVED');
      assert.equal(h.events[0].eventType, 'WHT_PND3');
    }
  });

  it('syncs both forms with WHT and the old PND53 scope while leaving VAT untouched', async () => {
    for (const scope of ['WHT', 'PND53'] as const) {
      const h = harness([whtExpense(), whtExpense({ id: 'individual', payeeEntityKind: 'INDIVIDUAL' })]);
      const result = await h.run(scope);
      assert.deepEqual(h.events.map(e => e.whtFormType), ['PND53', 'PND3']);
      assert.equal(result.vatInputCreated + result.vatOutputCreated, 0);
    }
  });

  it('creates no WHT period and no event for an expense that withholds nothing', async () => {
    const h = harness([whtExpense({ whtAmount: '0.0000', payeeEntityKind: 'INDIVIDUAL' })]);

    const result = await h.run();

    assert.equal(result.whtCreated, 0);
    assert.deepEqual(h.periods, []);
    assert.deepEqual(h.events, []);
  });
});

it('names the payee and the fix in Thai for missing tax IDs on both forms', async () => {
  for (const payeeEntityKind of ['INDIVIDUAL', 'JURISTIC']) {
    const h = harness([whtExpense({ payeeEntityKind, vendorTaxId: null, vendorName: 'สมชาย' })]);
    await h.run('WHT');
    assert.equal(h.issues[0].description, 'ยังไม่มีเลขผู้เสียภาษีของ สมชาย เปิดรายจ่ายหรือคู่ค้าแล้วกรอกเลขผู้เสียภาษี 13 หลัก');
  }
});

it('clears repaired tax ID and currency issues before creating the withholding event', async () => {
  for (const field of ['vendorTaxId', 'currency']) {
    const row = whtExpense(field === 'currency' ? { currency: 'USD' } : { vendorTaxId: null });
    const h = harness([row]); await h.run('WHT');
    assert.equal(h.issues.length, 1);
    row.vendorTaxId = '0100000000000'; row.currency = 'THB';
    await h.run('WHT');
    assert.equal(h.issues[0].status, 'RESOLVED'); assert.equal(h.events.length, 1);
  }
});

it('unknown-kind issue names the expense payee, with the original sentence when no name exists', async () => {
  for (const vendorName of ['สมชาย ใจดี', null, '   ']) {
    const h = harness([whtExpense({ payeeEntityKind: null, vendorName })]);
    await h.run('WHT');
    assert.equal(h.issues[0].description, vendorName?.trim()
      ? 'ยังไม่รู้ว่า สมชาย ใจดี เป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน'
      : 'ยังไม่รู้ว่าผู้รับเงินเป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน');
    assert.equal(h.events.length, 0);
  }
});

it('routes personal interest and dividends to PND2 without a PND3 event', async () => {
  for (const incomeCategoryCode of ['WHT_INTEREST', 'WHT_DIVIDEND_IND']) {
    const h = harness([whtExpense({ payeeEntityKind: 'INDIVIDUAL', incomeCategoryCode })]);
    h.taxRepo.prisma = { client: { whtIncomeCategory: { findUnique: async () => ({ formType: 'PND2', filingRoute: 'SEPARATE_PND2' }) } } };
    await h.run('WHT');
    assert.equal(h.events.length, 1); assert.equal(h.events[0].eventType, 'WHT_PND2');
    assert.equal(h.periods[0].formType, 'PND2'); assert.equal(h.periods[0].periodKey, '2026-07'); assert.deepEqual(h.issues, []);
  }
});

it('keeps accountant and PND2 payments even when the accountant must complete the payee tax ID', async () => {
  for (const filingRoute of ['ACCOUNTANT_PREPARES', 'SEPARATE_PND2']) {
    const h = harness([whtExpense({ payeeEntityKind: 'INDIVIDUAL', incomeCategoryCode: 'SPECIAL', vendorTaxId: null })]);
    h.taxRepo.prisma = { client: { whtIncomeCategory: { findUnique: async () => ({ formType: filingRoute === 'SEPARATE_PND2' ? 'PND2' : 'PND3', filingRoute }) } } };
    await h.run('WHT');
    assert.equal(h.events.length, 1); assert.deepEqual(h.issues, []);
  }
});

it('rerouting to PND2 clears obsolete form faults across periods, not only the new PND2 period', async () => {
  const h = harness([whtExpense({ payeeEntityKind: 'INDIVIDUAL', incomeCategoryCode: 'WHT_INTEREST' })]);
  h.taxRepo.prisma = { client: { whtIncomeCategory: { findUnique: async () => ({ formType: 'PND2', filingRoute: 'SEPARATE_PND2' }) } } };
  const cleared: any[] = [];
  h.taxRepo.resolveSourceIssues = async (...args: any[]) => { cleared.push(args); };
  await h.run('WHT');
  assert.deepEqual(h.supersededSources[0], ['company-1', 'expense.record', 'expense-1', 'WHT_PND2']);
  for (const code of ['MISSING_TAX_ID', 'FUNCTIONAL_CURRENCY_FX_MISSING']) assert.ok(cleared.some(args => args[1] === code && args.length === 4));
});

it('sync skips only the expense with a filed line while the other establishment remains open', async () => {
  const h = harness([whtExpense(), whtExpense({ id: 'expense-2' })]);
  h.taxRepo.isWithholdingPaymentFiled = async (company: string, type: string, id: string) => {
    assert.equal(company, 'company-1'); assert.equal(type, 'expense.record'); return id === 'expense-1';
  };
  const result = await h.run('WHT'); assert.equal(result.skippedLocked, 1);
  assert.deepEqual(h.events.map(e => e.sourceId), ['expense-2']);
});

it('expense sync keeps the legacy form locked while adding to a new-style filed form in the same month', async () => {
  const { filedWithholdingPaymentPeriods } = await import('../services/filed-withholding-payment');
  const h = harness([whtExpense({ id: 'legacy-person', payeeEntityKind: 'INDIVIDUAL' }), whtExpense({ id: 'new-company' })]);
  const db: any = { taxPeriod: { findMany: async ({ where }: any) => {
    const candidate = where.OR?.[1]; if (!candidate) return [];
    return [{ ...candidate, status: 'FILED', whtFilings: candidate.formType === 'PND3' ? [] : [{ id: 'frozen' }] }];
  } } };
  h.taxRepo.upsertPeriod = async (input: any) => ({ id: `p-${input.formType}`, status: 'FILED' });
  h.taxRepo.isWithholdingPaymentFiled = async (...args: any[]) => (await (filedWithholdingPaymentPeriods as any)(db, ...args)).length > 0;
  assert.equal((await h.run('WHT')).skippedLocked, 1);
  assert.deepEqual(h.events.map(e => e.sourceId), ['new-company']);
});

it('W2 keeps distinct payment events of the same expense, including a late payment', async () => {
  const h = harness([whtExpense({ paymentId: 'p1' }), whtExpense({ paymentId: 'p2' })]);
  await h.run('WHT');
  assert.deepEqual(h.events.map(e => e.sourceLineKey), ['payment:p1', 'payment:p2']);
  assert.notEqual(h.events[0].idempotencyKey, h.events[1].idempotencyKey);
});
it('W8 reconciles removed/unpaid/voided expense payment sources before recognition', async () => {
  const h = harness([]); let reconciled = false;
  h.taxRepo.retireObsoleteExpenseWithholding = async (_company: string, rows: any[]) => { assert.deepEqual(rows, []); reconciled = true; };
  await h.run('WHT'); assert.equal(reconciled, true);
});

it('W3 keeps a rounded zero-tax share so partial-payment income totals are exact', async () => {
  const h = harness([whtExpense({ paymentId: 'tiny', whtAmount: '0', grossAmount: '0.10' })]);
  await h.run('WHT'); assert.equal(h.events.length, 1); assert.equal(h.events[0].grossAmount, '0.10');
});

it('W8 retires unpaid/voided unfiled events but never mutates filed lines or their file', async () => {
  const { PrismaTaxRepository } = await import('../../infrastructure/repositories/prisma-tax.repository');
  const events = ['unpaid', 'voided', 'filed'].map(id => ({ id, sourceId: id, sourceType: 'expense.record', sourceLineKey: '__HEADER__', eventDate: new Date('2026-10-28'), taxPeriodId: id, periodKey: '2026-10', whtFormType: 'PND3' }));
  const retired: string[] = [];
  let sourceId = '';
  const db: any = { taxReviewIssue: { findMany: async () => [] }, $executeRaw: async () => 0, $queryRaw: async () => [],
    taxEvent: { findMany: async () => events, updateMany: async ({ where }: any) => { retired.push(where.id); return { count: 1 }; } },
    taxPeriod: { findMany: async ({ where }: any) => {
      if (where.whtFilings) { sourceId = where.whtFilings.some.lines.some.sourceId; return sourceId === 'filed' ? [{ formType: 'PND3', periodKey: '2026-10' }] : []; }
      return [];
    } }, $transaction: async (fn: any) => fn(db) };
  await new PrismaTaxRepository({ client: db } as any).retireObsoleteExpenseWithholding('c', []);
  assert.deepEqual(retired, ['unpaid', 'voided']);
});

it('W3 sync preserves each income line of the same payment as a distinct event', async () => {
  const h = harness(['rent', 'service'].map(line => whtExpense({ paymentId: 'p1', sourceLineKey: `payment:p1:line:${line}` })));
  await h.run('WHT');
  assert.deepEqual(h.events.map(e => e.sourceLineKey), ['payment:p1:line:rent', 'payment:p1:line:service']);
});


it('R10 source correction retires only obsolete WHT blockers', async () => {
  const { PrismaTaxRepository } = await import('../../infrastructure/repositories/prisma-tax.repository');
  const updates: any[] = [];
  const issues = ['PND3', 'PND53', 'PP30'].map(formType => ({ id: formType, companyId: 'c', sourceType: 'expense.record', sourceId: 'removed', issueCode: 'MISSING_TAX_ID', taxPeriodId: formType, taxPeriod: { formType, periodKey: '2026-09' } }));
  const db: any = { taxEvent: { findMany: async () => [] }, taxReviewIssue: {
    findMany: async ({ where }: any) => { assert.equal(where.companyId, 'c'); assert.equal(where.sourceType, 'expense.record'); assert.deepEqual(where.taxPeriod.formType.in, ['PND2', 'PND3', 'PND53']); return issues.filter(i => where.taxPeriod.formType.in.includes(i.taxPeriod.formType)); },
    updateMany: async (input: any) => { updates.push(input); },
  } };
  await new PrismaTaxRepository({ client: db } as any).retireObsoleteExpenseWithholding('c', []);
  assert.equal(updates.length, 2);
  for (const update of updates) {
    assert.equal(update.where.companyId, 'c'); assert.equal(update.where.sourceId, 'removed'); assert.equal(update.where.sourceType, 'expense.record');
    assert.ok(['PND3', 'PND53'].includes(update.where.taxPeriodId)); assert.equal(update.data.status, 'RESOLVED');
  }
});

it('R10 same-month form changes retire only the old-form source issues', async () => {
  const { PrismaTaxRepository } = await import('../../infrastructure/repositories/prisma-tax.repository');
  for (const [oldForm, newForm, kind] of [['PND3', 'PND53', 'JURISTIC'], ['PND53', 'PND3', 'INDIVIDUAL']] as const) {
    const issues = [oldForm, newForm, 'PP30'].map(formType => ({ id: formType, companyId: 'company-1', sourceType: 'expense.record', sourceId: 'expense-1',
      issueCode: 'MISSING_TAX_ID', taxPeriodId: formType, taxPeriod: { formType, periodKey: '2026-07' }, status: 'OPEN' }));
    const writes: any[] = [];
    const db: any = { taxEvent: { findMany: async () => [] }, whtIncomeCategory: { findMany: async () => [] }, taxReviewIssue: {
      findMany: async ({ where }: any) => issues.filter(i => where.taxPeriod.formType.in.includes(i.taxPeriod.formType)),
      updateMany: async ({ where, data }: any) => { writes.push(where); for (const i of issues) if (i.companyId === where.companyId && i.sourceId === where.sourceId && i.taxPeriodId === where.taxPeriodId) Object.assign(i, data); },
    } };
    await new PrismaTaxRepository({ client: db } as any).retireObsoleteExpenseWithholding('company-1', [whtExpense({ payeeEntityKind: kind, vendorTaxId: null })] as any);
    assert.equal(issues.find(i => i.id === oldForm)?.status, 'RESOLVED');
    assert.equal(issues.find(i => i.id === newForm)?.status, 'OPEN'); assert.equal(issues.find(i => i.id === 'PP30')?.status, 'OPEN');
    assert.equal(writes.length, 1); assert.equal(writes[0].companyId, 'company-1'); assert.equal(writes[0].sourceId, 'expense-1');
    assert.equal(writes[0].taxPeriodId, oldForm); assert.equal(writes[0].sourceType, 'expense.record');
  }
});
