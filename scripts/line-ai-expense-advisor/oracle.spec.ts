/**
 * oracle.ts mostly boots the real, compiled API (DB, Nest application context) — not something a
 * fast unit test should touch. `resolveGoldCallInput` (and the `$fromShownItems`/`$period` marker
 * resolution it does) is a pure, DB-free exception, and directly implicated in the T-068 bug
 * (run-real.ts scored a gold call's UNRESOLVED `{ $fromShownItems: 2 }` marker against the model's
 * resolved id string — this file pins the resolution this function must keep producing so that bug
 * cannot silently come back).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TOOL_MODULES, GOLD_TABLES, resolveGoldCallInput, extractExpectedFacts, checkWorkflowGold, resolveGoldRecord, type ShownItem } from './oracle';
import { buildWorkflowSeed, resolveWorkflowActor } from './seed';
import type { GoldCall } from './types';

const NOW = new Date('2026-09-27T06:00:00.000Z'); // 13:00 Bangkok, 27 Sep 2026

describe('M2 workflow seed', () => {
  it('builds a deterministic three-company snapshot with scoped and shared actors and boundary data', () => {
    const seed = buildWorkflowSeed(NOW);
    assert.deepEqual(seed, buildWorkflowSeed(NOW));
    const rows = (model: string) => seed.rows.filter(row => row.model === model).map(row => row.data);
    assert.equal(rows('company').length, 3);
    assert.ok(rows('expenseRecord').filter(row => row.companyId === 'company-b').length > 300);
    assert.ok(rows('reimbursementRequest').filter(row => row.companyId === 'company-b' && row.status === 'PENDING_APPROVAL').length > 300);
    assert.ok(rows('expenseRecord').filter(row => row.status === 'CONFIRMED' && row.paymentStatus === 'UNPAID' && new Date(String(row.expenseDate)).getTime() < NOW.getTime() - 90 * 86400000).length >= 3);
    assert.equal(seed.actors['limited-manager']!.branchIds.length, 1);
    assert.equal(seed.actors['dual-a']!.userId, seed.actors['dual-b']!.userId);
    assert.ok(rows('reimbursementApprovalStep').some(row => (row.assignedApproverUserIdsJson as string[] | undefined)?.includes('user-b-auditor_readonly')));
    assert.ok(rows('accountingCounterparty').filter(row => row.displayName === 'ผู้ขายชื่อซ้ำ').length >= 2);
    assert.ok(rows('companyAiConfiguration').some(row => row.companyId === 'company-c' && row.chatMonthlyBudgetSatang === 0));
    for (const companyId of ['company-a', 'company-b', 'company-c']) {
      for (const status of ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']) assert.ok(rows('expenseRecord').filter(row => row.companyId === companyId && row.status === status).length >= 3);
      for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED']) assert.ok(rows('disbursementVoucher').some(row => row.companyId === companyId && row.status === status));
    }
    assert.ok(rows('expenseRecord').filter(row => row.companyId === 'company-c' && row.status === 'CONFIRMED' && Number(row.whtAmount) > 0).length >= 2);
    for (const model of new Set(seed.rows.map(row => row.model))) {
      const ids = rows(model).flatMap(row => row.id ? [row.id] : []);
      assert.equal(new Set(ids).size, ids.length, `${model} ids are unique`);
    }
  });
  it('resolves an explicitly selected branch without widening its membership', () => {
    const actor = { key: 'c-branch-two', company: 'C', role: 'MANAGER', branchScope: { branches: ['branch-c-2'] } } as const;
    const seed = buildWorkflowSeed(NOW, [actor as any]);
    const resolved = resolveWorkflowActor(actor as any, seed);
    assert.deepEqual(resolved.branchIds, ['branch-c-2']);
    assert.deepEqual(seed.rows.filter(row => row.model === 'membershipBranchScope' && row.data.membershipId === resolved.membershipId).map(row => row.data.branchId), ['branch-c-2']);
  });
});

describe('M-R6 derived child rows obey confirmation turn', () => {
  const task = { id: 'approve', kind: 'reimbursement', startTurn: 0, endTurn: 1, confirmTurn: 1,
    goldTerminal: { effect: 'REIMBURSEMENT_APPROVED', records: [{ table: 'ReimbursementRequest', ref: '$seed:claim', status: 'APPROVED' }] }, minimalTurns: 2, completable: true } as any;
  const evidence = (parentId: string, turnIndex = 1) => [{ turnIndex, businessSnapshot: { business: {
    ReimbursementRequest: [{ id: 'claim', status: 'APPROVED' }],
    ReimbursementApprovalStep: [{ id: 'step', reimbursementRequestId: parentId, status: 'APPROVED', decisionByUserId: 'manager' }],
  }, collectionState: {} }, unintendedEffects: [{ kind: 'ReimbursementApprovalStep.update', recordId: 'step' }] }];
  it('accepts the approval step written by approving the gold claim', () => {
    assert.equal(checkWorkflowGold(task, evidence('claim')).wrongApplied, 0);
  });
  it('counts a child with no linked gold parent and a child changed before confirmation', () => {
    assert.equal(checkWorkflowGold(task, evidence('other')).wrongApplied, 1);
    assert.equal(checkWorkflowGold(task, evidence('claim', 0)).wrongApplied, 1);
  });
  it('checks explicit child values and the preceding confirmation preview', () => {
    const child = { table: 'ReimbursementApprovalStep', ref: '$child:$seed:claim:1', status: 'APPROVED', decisionBy: 'manager' } as const;
    const rows = evidence('claim');
    assert.equal(resolveGoldRecord(child, rows[0]!.businessSnapshot.business, task.goldTerminal.records)?.id, 'step');
    assert.equal(resolveGoldRecord({ table: 'ReimbursementLine', ref: '$child:$seed:claim:1' }, { ...rows[0]!.businessSnapshot.business,
      ReimbursementLine: [{ id: 'line', reimbursementRequestId: 'claim', lineNo: 1 }] }, task.goldTerminal.records)?.id, 'line');
    const withChild = { ...task, goldTerminal: { ...task.goldTerminal, records: [...task.goldTerminal.records, child] } };
    assert.equal(checkWorkflowGold(withChild, rows).terminalMatches, true);
    const wrongChild = { ...withChild, goldTerminal: { ...withChild.goldTerminal, records: [task.goldTerminal.records[0], { ...child, decisionBy: 'other' }] } };
    assert.equal(checkWorkflowGold(wrongChild, rows).terminalMatches, false);
    assert.equal(checkWorkflowGold(wrongChild, rows).wrongApplied, 1);
    assert.equal(checkWorkflowGold(withChild, rows, { action: 'approve', target: '$seed:claim' }).wrongPreview, 1);
    assert.equal(checkWorkflowGold(withChild, [{ ...rows[0], turnIndex: 0, unintendedEffects: [], preview: { action: 'approve', target: '$seed:claim' } }, ...rows], { action: 'approve', target: '$seed:claim' }).wrongPreview, 0);
    assert.equal(checkWorkflowGold(withChild, [{ ...rows[0], turnIndex: 0, unintendedEffects: [], preview: { action: 'approve', target: 'claim', amount: '100.0000' } }, ...rows], { action: 'approve', target: '$seed:claim', amount: '100.00' }).wrongPreview, 0);
  });
  it('requires a created record to come from this task instead of matching a seeded row', () => {
    const createdTask = { ...task, goldTerminal: { effect: 'REIMBURSEMENT_DRAFT_SAVED', records: [{ table: 'ReimbursementRequest', ref: '$created:approve', status: 'APPROVED' }] } } as any;
    const rows = evidence('claim');
    assert.equal(checkWorkflowGold(createdTask, [{ ...rows[0]!, unintendedEffects: [] }]).terminalMatches, false);
    assert.equal(checkWorkflowGold(createdTask, [{ ...rows[0]!, unintendedEffects: [{ kind: 'ReimbursementRequest.create', recordId: 'claim' }] }]).terminalMatches, true);
  });
  it('follows voucher, history and handoff parents and rejects unrelated child rows', () => {
    const records = [{ table: 'ExpenseRecord', ref: '$seed:expense' }, { table: 'ExpensePayment', ref: '$seed:payment' }] as any;
    const business = { ExpenseRecord: [{ id: 'expense' }], ExpensePayment: [{ id: 'payment' }],
      DisbursementVoucherLine: [{ id: 'line', expenseId: 'expense' }], WhtCertificateHistory: [{ id: 'history', expenseId: 'expense', handoffId: 'handoff' }],
      WhtCertificateHandoff: [{ id: 'handoff' }, { id: 'payment-handoff', sourcePaymentId: 'payment' }, { id: 'orphan' }] };
    const turn = { turnIndex: 1, businessSnapshot: { business, collectionState: {} }, unintendedEffects: [
      { kind: 'DisbursementVoucherLine.create', recordId: 'line' }, { kind: 'WhtCertificateHistory.create', recordId: 'history' },
      { kind: 'WhtCertificateHandoff.create', recordId: 'handoff' }, { kind: 'WhtCertificateHandoff.create', recordId: 'payment-handoff' },
    ] };
    const paymentTask = { ...task, goldTerminal: { effect: 'EXPENSE_PAID', records } };
    assert.equal(checkWorkflowGold(paymentTask, [turn]).wrongApplied, 0);
    assert.equal(checkWorkflowGold(paymentTask, [{ ...turn, unintendedEffects: [{ kind: 'WhtCertificateHandoff.create', recordId: 'orphan' }] }]).wrongApplied, 1);
  });
  it('checks declared columns on every GoldRecord table, including payment amount, Bangkok date and method', () => {
    for (const table of GOLD_TABLES) {
      const record = { table, ref: '$seed:row', status: 'expected' } as const;
      const snapshot = { [table]: [{ id: 'row', status: 'expected' }] };
      const goldTask = { ...task, goldTerminal: { ...task.goldTerminal, records: [record] } };
      assert.equal(checkWorkflowGold(goldTask, [{ turnIndex: 1, businessSnapshot: { business: snapshot, collectionState: {} }, unintendedEffects: [] }]).terminalMatches, true, table);
      snapshot[table]![0]!.status = 'wrong';
      assert.equal(checkWorkflowGold(goldTask, [{ turnIndex: 1, businessSnapshot: { business: snapshot, collectionState: {} }, unintendedEffects: [] }]).terminalMatches, false, table);
    }
    for (const table of ['ExpensePayment', 'ReimbursementPayment', 'DisbursementVoucher'] as const) {
      const record = { table, ref: '$seed:paid', paidAmount: '100.00', paidDate: '2026-09-28', paymentMethod: 'CASH' };
      const row = { id: 'paid', amount: '100.0000', paidAmount: '100.0000', totalAmount: '100.0000', paidAt: '2026-09-27T18:00:00Z', paidMethod: 'CASH', paymentMethod: 'CASH' };
      const goldTask = { ...task, goldTerminal: { ...task.goldTerminal, records: [record] } };
      assert.equal(checkWorkflowGold(goldTask, [{ turnIndex: 1, businessSnapshot: { business: { [table]: [row] }, collectionState: {} }, unintendedEffects: [] }]).terminalMatches, true, table);
    }
  });
});

const shownItems: ShownItem[] = [
  { index: 0, id: 'expense-company-a-15', date: '2026-09-16T04:00:00.000Z', label: 'ร้านสมใจการค้า' },
  { index: 1, id: 'expense-company-a-14', date: '2026-09-15T04:00:00.000Z', label: 'ร้านสมใจ' },
  { index: 2, id: 'expense-company-a-13', date: '2026-09-14T04:00:00.000Z', label: 'ไม่ระบุร้าน' },
];

describe('resolveGoldCallInput', () => {
  it('passes plain literal values through unchanged', () => {
    const call: GoldCall = { tool: 'expense.list_recent', input: { documentStatus: 'CONFIRMED', limit: 5 } };
    assert.deepEqual(resolveGoldCallInput(call, NOW, []), { documentStatus: 'CONFIRMED', limit: 5 });
  });

  it('spreads a { $period } marker into sibling fromDate/toDate keys, dropping the wrapper key', () => {
    const call: GoldCall = { tool: 'expense.list_recent', input: { period: { $period: 'this_month_to_date' } } };
    const resolved = resolveGoldCallInput(call, NOW, []);
    assert.deepEqual(resolved, { fromDate: '2026-09-01', toDate: '2026-09-27' });
    assert.ok(!('period' in resolved), 'the "period" wrapper key must not survive resolution');
  });

  it('resolves a { $fromShownItems } marker to that shown item\'s id (T-068)', () => {
    // "รายการที่ 3 คือร้านอะไร" after a list turn that showed [-15, -14, -13] — item 3 is index 2.
    const call: GoldCall = { tool: 'expense.get_detail', input: { expenseId: { $fromShownItems: 2 } } };
    assert.deepEqual(resolveGoldCallInput(call, NOW, shownItems), { expenseId: 'expense-company-a-13' });
  });

  it('throws when $fromShownItems points past the end of what was actually shown', () => {
    const call: GoldCall = { tool: 'expense.get_detail', input: { expenseId: { $fromShownItems: 9 } } };
    assert.throws(() => resolveGoldCallInput(call, NOW, shownItems), /no shown item at index 9/);
  });

  it('resolves a period, a literal, and a shown-item reference together in one call', () => {
    const call: GoldCall = { tool: 'expense.list_recent', input: { period: { $period: 'today' }, documentStatus: 'CONFIRMED', expenseId: { $fromShownItems: 0 } } };
    assert.deepEqual(resolveGoldCallInput(call, NOW, shownItems), {
      fromDate: '2026-09-27', toDate: '2026-09-27', documentStatus: 'CONFIRMED', expenseId: 'expense-company-a-15',
    });
  });
});

describe('extractExpectedFacts: task item 2 (per-turn requiredFacts)', () => {
  const detailData = {
    grandTotalAmount: '2081', expenseDate: '2026-09-14T04:00:00.000Z', vendorName: 'ร้านสมใจ',
    status: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID',
  };
  const detailResult = { status: 'ok', data: detailData };

  it('detail defaults to amount+date+vendor, unchanged from before this feature (no status)', () => {
    const facts = extractExpectedFacts('expense.get_detail', detailResult);
    assert.deepEqual(new Set(facts.map((f) => f.label)), new Set(['amount', 'date', 'vendor']));
  });

  it('"รายการที่ 3 คือร้านอะไร" — requiredFacts:[\'vendor\'] narrows to just the vendor', () => {
    const facts = extractExpectedFacts('expense.get_detail', detailResult, undefined, ['vendor']);
    assert.deepEqual(facts.map((f) => f.label), ['vendor']);
    assert.equal(facts[0]!.value, 'ร้านสมใจ');
  });

  it('requiredFacts:[\'vendor\',\'date\'] keeps both and drops amount', () => {
    const facts = extractExpectedFacts('expense.get_detail', detailResult, undefined, ['vendor', 'date']);
    assert.deepEqual(new Set(facts.map((f) => f.label)), new Set(['vendor', 'date']));
  });

  it('"จ่ายหรือยัง" — requiredFacts:[\'status\'] requires every Thai synonym for the payment/document status, never amount/date/vendor', () => {
    const facts = extractExpectedFacts('expense.get_detail', detailResult, undefined, ['status']);
    const sorted = [...facts].sort((a, b) => a.label!.localeCompare(b.label!));
    assert.deepEqual(sorted.map((f) => ({ kind: f.kind, value: f.value })), [
      { kind: 'status', value: ['ยืนยันแล้ว'] }, { kind: 'status', value: ['จ่ายบางส่วน', 'ชำระบางส่วน'] },
    ]);
  });

  it('other shapes keep their own defaults unchanged too (single_metric: total+count)', () => {
    const facts = extractExpectedFacts('expense.list_recent', { status: 'ok', data: { summary: { totalAmount: '500', countedItems: 3 } } });
    assert.deepEqual(new Set(facts.map((f) => f.label)), new Set(['total', 'count']));
  });
});


it('Exam D: every corpus gold alternative is wired, including approval backlog facts', async () => {
  const { readFileSync } = await import('node:fs');
  for (const name of ['sample', 'tuning', 'heldout']) {
    const corpus = JSON.parse(readFileSync(new URL(`./corpus.${name}.json`, import.meta.url), 'utf8'));
    const visit = (value: any): void => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') {
        if (typeof value.tool === 'string') assert.ok(TOOL_MODULES[value.tool], `${name}: ${value.tool}`);
        Object.values(value).forEach(visit);
      }
    };
    visit(corpus);
  }
  assert.equal(TOOL_MODULES['reimbursement.get_approval_backlog'].exportName, 'ReimbursementGetApprovalBacklogTool');
  const facts = extractExpectedFacts('reimbursement.get_approval_backlog', { status: 'ok', data: {
    total: 2, items: [{ amount: '350' }, { amount: '500' }] } });
  assert.ok(facts.some(fact => fact.kind === 'count' && fact.value === 2));
  assert.ok(facts.some(fact => fact.kind === 'money' && fact.value === 850));
});

describe('M3 free seed and tax-period gold', () => {
  it('uses the product never-paid predicate, while an exhausted paid company stays paid', async () => {
    const { isFreeExpenseDraftCompany } = await import('../../apps/api/src/modules/system-partner-management/application/free-expense-access');
    const actor = { key: 'free-owner', company: 'A', role: 'OWNER', branchScope: 'all', freeSourceDrafts: true } as const;
    const seed = buildWorkflowSeed(NOW, [actor]);
    assert.deepEqual(seed, buildWorkflowSeed(NOW, [actor]));
    const row = (model: string, companyId: string) => seed.rows.find(row => row.model === model && (row.data.companyId === companyId || row.data.id === companyId))?.data;
    const db = (companyId: string) => ({
      company: { findUnique: async () => ({ ...row('company', companyId), planTerm: row('companyPlanTerm', companyId) }) },
      billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null },
      billingReceiptGrant: { findFirst: async () => null }, packageChangeRequest: { findFirst: async () => null },
      salesAttribution: { findUnique: async () => null }, auditLog: { findFirst: async () => null },
    });
    assert.equal(await isFreeExpenseDraftCompany(db('company-a') as never, 'company-a', NOW), true);
    assert.equal(await isFreeExpenseDraftCompany(db('company-c') as never, 'company-c', NOW), false);
    assert.equal(buildWorkflowSeed(NOW).companies.A.tierKey, 'STARTER_249');
    assert.equal(seed.rows.filter(row => row.model === 'company').length, 3);
  });
  it('resolves both forms from the configured month or the next-month seventh, across a year boundary', async () => {
    const { resolveWorkflowDueDate } = await import('./oracle');
    const now = new Date('2026-12-04T04:00:00Z'), seed = buildWorkflowSeed(now);
    for (const formType of ['PND3', 'PND53'] as const) {
      assert.equal(resolveWorkflowDueDate({ formType, monthOffset: 0 }, seed.rows, 'company-c', now), '2027-01-12');
      assert.equal(resolveWorkflowDueDate({ formType, monthOffset: 1 }, seed.rows, 'company-c', now), '2027-02-07');
      assert.equal(resolveWorkflowDueDate({ formType, monthOffset: -1 }, seed.rows, 'company-c', now), '2026-12-07');
    }
    assert.throws(() => resolveWorkflowDueDate({ formType: 'PND3', monthOffset: 0 }, [], 'company-c', now), /TAX_PERIOD/);
  });
});

it('M3 knowledge gold rejects a fact or numeric allowance outside the reviewed card', async () => {
  const { resolveKnowledgeGold } = await import('./oracle');
  const gold = { cardId: 'wht.pnd53-due', version: 3, requiredFacts: ['ครบกำหนด'], forbiddenFacts: ['ยื่นให้แล้ว'], allowedNumericFacts: ['53', '7'] };
  assert.equal(resolveKnowledgeGold(gold).id, 'wht.pnd53-due');
  assert.throws(() => resolveKnowledgeGold({ ...gold, allowedNumericFacts: ['3'] }), /NUMBER_OUTSIDE_CARD/);
  assert.throws(() => resolveKnowledgeGold({ ...gold, requiredFacts: ['ยื่นให้แล้ว'] }), /FACT_OUTSIDE_CARD/);
  assert.throws(() => resolveKnowledgeGold({ ...gold, version: 999 }), /CARD_MISSING/);
});
