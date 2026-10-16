import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupWhtEvents, computeWhtTotals, validateCertificateTotals, deriveWhtIncomeBase } from './wht-report.logic';

const baseEvent = {
  id: 'e1',
  whtFormType: 'PND53' as const,
  payeeSnapshot: { name: 'Vendor A', taxId: '0105512345678', address: null, branchCode: null },
  incomeCategoryCode: 'WHT_SERVICE',
  whtRate: '3.0000',
  grossAmount: '10000.0000',
  withheldAmount: '300.0000',
  netPaidAmount: '9700.0000',
  certificateNumber: 'WHT-001',
  sourceType: 'accounting.payment',
  sourceId: 'pay1',
  sourceEventType: null,
};

describe('groupWhtEvents', () => {
  it('preserves an unknown rate for amount-only WHT without changing accepted money', () => {
    const [group] = groupWhtEvents([{ ...baseEvent, whtRate: null, grossAmount: '1234.56', withheldAmount: '30.01' }]);
    assert.equal(group!.whtRate, null);
    assert.equal(group!.totalGross, '1234.5600');
    assert.equal(group!.totalWithheld, '30.0100');
  });
  it('groups two events from same payee+category+rate into one group', () => {
    const e2 = { ...baseEvent, id: 'e2', grossAmount: '5000.0000', withheldAmount: '150.0000', netPaidAmount: '4850.0000' };
    const groups = groupWhtEvents([baseEvent, e2]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.totalGross, '15000.0000');
    assert.equal(groups[0]!.totalWithheld, '450.0000');
    assert.ok(groups[0]!.certificateNumbers.includes('WHT-001'));
  });

  it('creates separate groups for different payees', () => {
    const e2 = { ...baseEvent, id: 'e2', payeeSnapshot: { name: 'Vendor B', taxId: '0125512345678', address: null, branchCode: null } };
    const groups = groupWhtEvents([baseEvent, e2]);
    assert.equal(groups.length, 2);
  });

  it('creates separate groups for different income categories', () => {
    const e2 = { ...baseEvent, id: 'e2', incomeCategoryCode: 'WHT_RENT' };
    const groups = groupWhtEvents([baseEvent, e2]);
    assert.equal(groups.length, 2);
  });
});

describe('computeWhtTotals', () => {
  it('sums gross and withheld across groups', () => {
    const groups = groupWhtEvents([baseEvent]);
    const totals = computeWhtTotals(groups, 0);
    assert.equal(totals.totalGross, '10000.0000');
    assert.equal(totals.totalWithheld, '300.0000');
    assert.equal(totals.payeeGroupCount, 1);
    assert.equal(totals.reviewIssueCount, 0);
  });
});

describe('validateCertificateTotals', () => {
  it('returns empty array when totals match', () => {
    const errors = validateCertificateTotals('10000.0000', '300.0000', '10000.0000', '300.0000');
    assert.equal(errors.length, 0);
  });
  it('returns error when gross mismatches', () => {
    const errors = validateCertificateTotals('9999.0000', '300.0000', '10000.0000', '300.0000');
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.includes('gross'));
  });
  it('returns error when withheld mismatches', () => {
    const errors = validateCertificateTotals('10000.0000', '299.0000', '10000.0000', '300.0000');
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.includes('withheld'));
  });
});

describe('deriveWhtIncomeBase', () => {
  it('recovers the income the tax was taken on', () => {
    assert.equal(deriveWhtIncomeBase('30', '3'), '1000.0000');
    assert.equal(deriveWhtIncomeBase('50.00', '5'), '1000.0000');
  });

  it('rounds to satang so base x rate matches the tax actually withheld', () => {
    // 3% of 333.33 is 9.9999 -> 10.00 withheld; the base must read back as the satang figure the
    // document shows, not 333.3333.
    assert.equal(deriveWhtIncomeBase('10', '3'), '333.3300');
  });

  it('returns null rather than a fabricated base when the rate is unusable', () => {
    // A zero or missing rate makes the base genuinely unknown. Null leaves it for review; any
    // number here would be invented, and it would be printed on a legal document.
    assert.equal(deriveWhtIncomeBase('30', null), null);
    assert.equal(deriveWhtIncomeBase('30', undefined), null);
    assert.equal(deriveWhtIncomeBase('30', '0'), null);
    assert.equal(deriveWhtIncomeBase('30', 'abc'), null);
  });
});


describe('withholding paying establishment foundation', () => {
  const branches = [
    { id: 'head', name: 'ร้านหลัก', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: null },
    { id: 'shop', name: 'สาขาตลาด', type: 'BRANCH', status: 'ACTIVE', taxBranchCode: '00002' },
    { id: 'old', name: 'สาขาเดิม', type: 'BRANCH', status: 'INACTIVE', taxBranchCode: '00003' },
    { id: 'missing', name: 'ยังไม่กรอกรหัส', type: 'BRANCH', status: 'ACTIVE', taxBranchCode: null },
  ];
  it('resolves both modes, no branch, missing codes, one active branch and inactive payment branches', async () => {
    const { resolveWhtEstablishment } = await import('./wht-payer-mode.logic');
    for (const [mode, branchId, expected] of [
      [null, 'shop', { kind: 'SHOP_HAS_NOT_ANSWERED' }],
      ['HEAD_OFFICE_PAYS_ALL', 'shop', { kind: 'ESTABLISHMENT', code: '00000', branchId: 'head', name: 'สำนักงานใหญ่' }],
      ['EACH_BRANCH_PAYS', 'shop', { kind: 'ESTABLISHMENT', code: '00002', branchId: 'shop', name: 'สาขาตลาด' }],
      ['EACH_BRANCH_PAYS', 'head', { kind: 'ESTABLISHMENT', code: '00000', branchId: 'head', name: 'สำนักงานใหญ่' }],
      ['EACH_BRANCH_PAYS', null, { kind: 'ESTABLISHMENT', code: '00000', branchId: 'head', name: 'สำนักงานใหญ่' }],
      ['EACH_BRANCH_PAYS', 'missing', { kind: 'BRANCH_HAS_NO_CODE', branchId: 'missing' }],
      ['EACH_BRANCH_PAYS', 'old', { kind: 'ESTABLISHMENT', code: '00003', branchId: 'old', name: 'สาขาเดิม' }],
    ] as const) assert.deepEqual(resolveWhtEstablishment(mode, branches, branchId), expected);
    assert.deepEqual(resolveWhtEstablishment(null, [branches[0], branches[2]], 'old'), { kind: 'ESTABLISHMENT', code: '00000', branchId: 'head', name: 'สำนักงานใหญ่' });
    assert.deepEqual(resolveWhtEstablishment('HEAD_OFFICE_PAYS_ALL', [{ ...branches[0], taxBranchCode: '00009' }, branches[1]], 'shop'), { kind: 'ESTABLISHMENT', code: '00009', branchId: 'head', name: 'สำนักงานใหญ่' });
  });
  it('uses the mode covering each month and ignores superseded answers without losing earlier months', async () => {
    const { whtPayerModeInForce, resolveWhtEstablishment } = await import('./wht-payer-mode.logic');
    const facts = [
      { id: 'a', mode: 'HEAD_OFFICE_PAYS_ALL', effectiveFromPeriodKey: '2026-01', supersededAt: null, answeredAt: new Date(1) },
      { id: 'b', mode: 'HEAD_OFFICE_PAYS_ALL', effectiveFromPeriodKey: '2026-09', supersededAt: new Date(3), answeredAt: new Date(2) },
      { id: 'c', mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-09', supersededAt: null, answeredAt: new Date(3) },
    ];
    assert.equal(whtPayerModeInForce(facts, '2025-12'), null);
    assert.deepEqual(resolveWhtEstablishment(whtPayerModeInForce(facts, '2026-08'), branches, 'shop'), { kind: 'ESTABLISHMENT', code: '00000', branchId: 'head', name: 'สำนักงานใหญ่' });
    assert.deepEqual(resolveWhtEstablishment(whtPayerModeInForce(facts, '2026-09'), branches, 'shop'), { kind: 'ESTABLISHMENT', code: '00002', branchId: 'shop', name: 'สาขาตลาด' });
  });
});


it('partitions papers without missing-code branches blocking another establishment and keeps unanswered legacy behavior', async () => {
  const { partitionWithholdingPayments } = await import('../../application/services/withholding-establishments');
  const branches = [{ id: 'h', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: null, name: 'ร้าน' },
    { id: 'b', type: 'BRANCH', status: 'ACTIVE', taxBranchCode: '00001', name: 'ตลาด' },
    { id: 'x', type: 'BRANCH', status: 'ACTIVE', taxBranchCode: null, name: 'ยังไม่มีรหัส' }];
  const events = branches.map(b => ({ id: b.id, branchId: b.id }));
  const facts = [{ id: 'f', mode: 'EACH_BRANCH_PAYS', effectiveFromPeriodKey: '2026-01', answeredAt: new Date(), supersededAt: null }];
  const result = partitionWithholdingPayments(events, branches, facts, '2026-09');
  assert.deepEqual(result.papers.map(p => [p.establishment.code, p.events.map(e => e.id)]), [['00000', ['h']], ['00001', ['b']]]);
  assert.deepEqual(result.unassigned.map(e => e.id), ['x']);
  assert.equal(result.unanswered, false);
  assert.equal(partitionWithholdingPayments(events, branches, [], '2026-09').unanswered, true);
  assert.equal(partitionWithholdingPayments([events[1]], branches, [], '2026-09').papers[0].establishment.code, '00001');
});
it('filed-payment lookup scopes its line to company/source and only FILED papers', async () => {
  const { filedWithholdingPaymentPeriods } = await import('../../application/services/filed-withholding-payment');
  let where: any;
  const db: any = { taxPeriod: { findMany: async (q: any) => { if (q.where.whtFilings?.some) where = q.where; return [{ formType: 'PND3', periodKey: '2026-09' }]; } } };
  assert.deepEqual(await filedWithholdingPaymentPeriods(db, 'co', 'expense.record', 'e'), [{ formType: 'PND3', periodKey: '2026-09' }]);
  assert.deepEqual(where, { companyId: 'co', formType: { in: ['PND3', 'PND53'] }, whtFilings: { some: { companyId: 'co', status: 'FILED', lines: { some: { sourceType: 'expense.record', sourceId: 'e' } } } } });
});

it('roll-up waits for every paper and every payment; filing one establishment leaves the month exported', async () => {
  const { rollUpWithholdingPeriod } = await import('../../application/services/withholding-establishments');
  const line = (id: string) => ({ sourceType: 'expense.record', sourceId: id });
  const papers = [{ status: 'FILED', lines: [line('one')] }, { status: 'EXPORTED', lines: [line('two')] }];
  const events = [line('one'), line('two')];
  const db: any = { expenseRecord: { findMany: async () => events.map(e => ({ id: e.sourceId })) }, whtFiling: { findMany: async () => papers }, taxEvent: { findMany: async () => events }, taxPeriod: { update: async () => {} } };
  assert.equal(await rollUpWithholdingPeriod(db, 'c', 'p'), 'EXPORTED');
  papers[1].status = 'FILED'; assert.equal(await rollUpWithholdingPeriod(db, 'c', 'p'), 'FILED');
  events.push(line('off-paper')); assert.equal(await rollUpWithholdingPeriod(db, 'c', 'p'), 'EXPORTED');
});
it('certificate prefill uses the resolved establishment and never refuses a missing branch code', async () => {
  const { withholdingPayerPrefill } = await import('../../application/services/withholding-establishments');
  const branches: any[] = [{ id: 'head', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: null, addressJson: 'wrong' }, { id: 'b', type: 'BRANCH', status: 'ACTIVE', taxBranchCode: '00002', addressJson: 'branch address' }];
  const fact = { mode: 'HEAD_OFFICE_PAYS_ALL', effectiveFromPeriodKey: '2026-01', supersededAt: null };
  const db: any = { branch: { findMany: async () => branches }, whtPayerModeFact: { findMany: async () => [fact] } };
  assert.deepEqual(await withholdingPayerPrefill(db, 'c', '2026-09', 'b', 'shop address'), { branchCode: '00000', address: 'shop address' });
  fact.mode = 'EACH_BRANCH_PAYS'; assert.deepEqual(await withholdingPayerPrefill(db, 'c', '2026-09', 'b', 'shop address'), { branchCode: '00002', address: 'branch address' });
  branches[1].taxBranchCode = null; assert.equal((await withholdingPayerPrefill(db, 'c', '2026-09', 'b', 'shop address')).branchCode, null);
});

it('legacy filed forms retain the month lock independently of new-style papers', async () => {
  const { filedWithholdingPaymentPeriods } = await import('../../application/services/filed-withholding-payment');
  for (const status of ['FILED', 'PAID', 'CLOSED']) {
    let legacyQuery: any;
    const db: any = { taxPeriod: { findMany: async (q: any) => {
      if (q.where.whtFilings?.some) return [];
      legacyQuery = q;
      return [{ formType: 'PND3', periodKey: '2026-09', status, whtFilings: [] },
        { formType: 'PND53', periodKey: '2026-09', status, whtFilings: [{ id: 'paper-with-lines' }] }];
    } } };
    assert.deepEqual(await filedWithholdingPaymentPeriods(db, 'co', 'expense.record', 'new', { formType: 'PND3', periodKey: '2026-09' }), [{ formType: 'PND3', periodKey: '2026-09' }]);
    assert.deepEqual(legacyQuery.where.OR, [{ taxEvents: { some: { sourceType: 'expense.record', sourceId: 'new' } } }, { formType: 'PND3', periodKey: '2026-09' }]);
    assert.deepEqual(legacyQuery.where.status.in, ['FILED', 'PAID', 'CLOSED']);
    assert.deepEqual(legacyQuery.select.whtFilings.where, { status: 'FILED', OR: [{ lines: { some: {} } }, { rowsCertain: true }] }, 'a confirmed empty legacy paper releases the month lock; an unfiled snapshot does not');
  }
});

it('additional papers exclude every filed source and number only after certain filed normal and additions', async () => {
  const { withholdingPaperPayments, openWithholdingSequence } = await import('../../application/services/withholding-filing-state');
  const events = ['normal', 'first', 'late'].map(sourceId => ({ sourceType: 'expense.record', sourceId }));
  const normal: any = { status: 'FILED', sequence: 0, rowsCertain: true, lines: [events[0]] };
  const first: any = { status: 'EXPORTED', sequence: 1, rowsCertain: true, lines: [events[1]] };
  assert.equal(openWithholdingSequence([]), 0);
  assert.equal(openWithholdingSequence([normal, first]), 1);
  assert.deepEqual(withholdingPaperPayments(events, [normal, first]), events.slice(1));
  first.status = 'FILED';
  assert.equal(openWithholdingSequence([normal, first]), 2);
  assert.deepEqual(withholdingPaperPayments(events, [normal, first]), [events[2]]);
  assert.equal(openWithholdingSequence([{ ...normal, rowsCertain: false }]), null);
  assert.deepEqual(normal.lines, [events[0]]);
});

it('cancelled filed rows keep their printed facts and identify re-recorded payees without netting', async () => {
  const { cancelledWithholdingRows, cancelledPayeeNames } = await import('../../application/services/withholding-filing-history');
  const payment = ['expense.record', 'old', '2026-09-01T00:00:00.000Z', null, 'THB', 'SERVICE', '1000', '30', '3', 'สมใจ', '1234567890123'];
  const papers: any[] = [{ id: 'filed', status: 'FILED', filedAt: new Date('2026-09-10'), formType: 'PND3', lines: [{ sourceType: 'expense.record', sourceId: 'old', lineJson: { payment } }] }];
  const before = JSON.stringify(papers);
  const db: any = { expenseRecord: { findMany: async () => [{ id: 'old', status: 'VOIDED', voidedAt: new Date('2026-09-11'), voidedByUserId: 'u1' }] } };
  const cancelled = await cancelledWithholdingRows(db, 'c', papers);
  assert.deepEqual(cancelled, [{ filingId: 'filed', sourceType: 'expense.record', sourceId: 'old', payeeName: 'สมใจ', payeeTaxId: '1234567890123', withheld: '30', cancelledAt: '2026-09-11T00:00:00.000Z', cancelledByUserId: 'u1', formType: 'PND3' }]);
  assert.deepEqual(cancelledPayeeNames(cancelled, [{ payeeSnapshot: { name: 'ชื่อใหม่', taxId: '1234567890123' } }]), ['สมใจ']);
  assert.deepEqual(cancelledPayeeNames(cancelled, [{ payeeSnapshot: { name: 'สมใจ', taxId: '9999999999999' } }]), ['สมใจ'], 'corrected taxpayer numbers still get the same-name warning');
  assert.deepEqual(cancelledPayeeNames(cancelled, [{ payeeSnapshot: { name: 'อื่น', taxId: '9999999999999' } }]), []);
  assert.equal(JSON.stringify(papers), before);
});

it('unanswered payer mode blocks only the form with several paying branches, in either direction', async () => {
  const { partitionWithholdingPayments } = await import('../../application/services/withholding-establishments');
  const branches = [{ id: 'h', type: 'HEAD_OFFICE', status: 'ACTIVE', taxBranchCode: null, name: 'ร้าน' },
    { id: 'b', type: 'BRANCH', status: 'ACTIVE', taxBranchCode: '00001', name: 'ตลาด' }];
  for (const blocked of ['PND3', 'PND53']) {
    const other = blocked === 'PND3' ? 'PND53' : 'PND3';
    const events = [{ branchId: 'h', eventType: `WHT_${blocked}` }, { branchId: 'b', eventType: `WHT_${blocked}` }, { branchId: 'h', eventType: `WHT_${other}` }];
    const result = partitionWithholdingPayments(events, branches, [], '2026-09');
    assert.deepEqual(result.unassigned, events.slice(0, 2));
    assert.deepEqual(result.papers.map(p => [p.establishment.code, p.events]), [['00000', [events[2]]]]);
  }
});

it('W5 excludes only the payment already filed; another payment on that expense is additional', async () => {
  const { withholdingPaperPayments } = await import('../../application/services/withholding-filing-state');
  const events = ['p1', 'p2'].map(id => ({ sourceType: 'expense.record', sourceId: 'expense', sourceLineKey: `payment:${id}` }));
  const papers = [{ status: 'FILED', rowsCertain: true, lines: [{ sourceType: 'expense.record', sourceId: 'expense', lineJson: { payment: [...Array(13).fill(null), 'payment:p1'] } }] }];
  assert.deepEqual(withholdingPaperPayments(events, papers), [events[1]]);
});

it('W8 keeps legacy document-month locks and also checks the actual payment month', async () => {
  const { filedWithholdingPaymentPeriods } = await import('../../application/services/filed-withholding-payment');
  const queries: any[] = [];
  const db: any = { company: { findUnique: async () => ({ timezone: 'Asia/Bangkok' }) },
    expensePayment: { findMany: async () => [{ paidAt: new Date('2026-11-04T18:00:00Z') }] },
    taxPeriod: { findMany: async (q: any) => { queries.push(q); return q.where.status ? [{ formType: 'PND3', periodKey: '2026-10', status: 'FILED', whtFilings: [] }, { formType: 'PND3', periodKey: '2026-11', status: 'FILED', whtFilings: [] }] : []; } } };
  assert.deepEqual(await filedWithholdingPaymentPeriods(db, 'co', 'expense.record', 'e', { formType: 'PND3', periodKey: '2026-10' }),
    [{ formType: 'PND3', periodKey: '2026-10' }, { formType: 'PND3', periodKey: '2026-11' }]);
  assert.ok(queries[1].where.OR.some((p: any) => p.periodKey === '2026-11'));
  assert.ok(queries[1].where.OR.some((p: any) => p.periodKey === '2026-10'));
});
it('W3 a voided filed payment adds a cancellation fact without editing the paper', async () => {
  const { cancelledWithholdingRows } = await import('../../application/services/withholding-filing-history');
  const papers: any[] = [{ id: 'paper', formType: 'PND3', status: 'FILED', filedAt: new Date('2026-11-07'), lines: [{ sourceType: 'expense.record', sourceId: 'e', lineJson: { payment: ['expense.record', 'e', '2026-10-28', null, 'THB', 'SERVICE', '100', '3', '3', 'สมชาย', null, null, null, 'payment:p'] } }] }];
  const before = JSON.stringify(papers);
  const db: any = { expenseRecord: { findMany: async () => [] }, expensePayment: { findMany: async () => [{ id: 'p', voidedAt: new Date('2026-11-08'), voidedByUserId: 'u' }] } };
  const [fact] = await cancelledWithholdingRows(db, 'co', papers);
  assert.equal(fact.payeeName, 'สมชาย'); assert.equal(fact.withheld, '3'); assert.equal(fact.cancelledByUserId, 'u');
  assert.equal(JSON.stringify(papers), before);
});

it('a previously filed aggregate payment covers its later per-income-line identities', async () => {
  const { filedLineCoversPayment } = await import('../../application/services/withholding-filing-state');
  const payment = Array(14).fill(null); payment[13] = 'payment:p';
  const line = { sourceType: 'expense.record', sourceId: 'e', lineJson: { payment } };
  assert.equal(filedLineCoversPayment(line, { sourceType: 'expense.record', sourceId: 'e', sourceLineKey: 'payment:p:line:rent' }), true);
  assert.equal(filedLineCoversPayment(line, { sourceType: 'expense.record', sourceId: 'e', sourceLineKey: 'payment:other:line:rent' }), false);
});
