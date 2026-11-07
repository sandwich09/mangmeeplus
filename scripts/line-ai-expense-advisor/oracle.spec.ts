/**
 * oracle.ts mostly boots the real, compiled API (DB, Nest application context) — not something a
 * fast unit test should touch. `resolveGoldCallInput` (and the `$fromShownItems`/`$period` marker
 * resolution it does) is a pure, DB-free exception, and directly implicated in the T-068 bug
 * (run-real.ts scored a gold call's UNRESOLVED `{ $fromShownItems: 2 }` marker against the model's
 * resolved id string — this file pins the resolution this function must keep producing so that bug
 * cannot silently come back).
 */
import assert from 'node:assert/strict';

it('projects terminal effects from the shared business delta without trusting gold or unchanged statuses', async () => {
  const { observedWorkflowTerminals } = await import('./oracle');
  const before = { ExpenseRecord: [{ id: 'a', status: 'NEEDS_REVIEW' }, { id: 'b', status: 'CONFIRMED' }] };
  const after = { ExpenseRecord: [{ id: 'a', status: 'CONFIRMED' }, { id: 'b', status: 'CONFIRMED', amount: 10 }], ExpensePayment: [{ id: 'payment' }] };
  assert.deepEqual(observedWorkflowTerminals([{ kind: 'ExpenseRecord.update', recordId: 'a' }, { kind: 'ExpenseRecord.update', recordId: 'b' },
    { kind: 'ExpensePayment.create', recordId: 'payment' }], before, after), ['EXPENSE_CONFIRMED', 'EXPENSE_PAID']);
  assert.deepEqual(observedWorkflowTerminals([{ kind: 'ExpenseRecord.update', recordId: 'b' }], before, after), []);
  assert.deepEqual(observedWorkflowTerminals([{ kind: 'ExpensePayment.create', recordId: 'voided' }], {}, { ExpensePayment: [{ id: 'voided', status: 'VOIDED' }] }), []);
  const states = [
    ['ExpenseRecord', 'READY_FOR_CONFIRMATION', 'EXPENSE_MARKED_READY'], ['ExpenseRecord', 'VOIDED', 'EXPENSE_VOIDED'],
    ['ReimbursementRequest', 'DRAFT', 'REIMBURSEMENT_DRAFT_SAVED'], ['ReimbursementRequest', 'PENDING_APPROVAL', 'REIMBURSEMENT_SUBMITTED'],
    ['ReimbursementRequest', 'APPROVED', 'REIMBURSEMENT_APPROVED'], ['ReimbursementRequest', 'REJECTED', 'REIMBURSEMENT_REJECTED'],
    ['ReimbursementRequest', 'CANCELLED', 'REIMBURSEMENT_CANCELLED'], ['ReimbursementRequest', 'PAID', 'REIMBURSEMENT_PAID'],
    ['DisbursementVoucher', 'DRAFT', 'VOUCHER_CREATED'], ['DisbursementVoucher', 'PENDING_APPROVAL', 'VOUCHER_SUBMITTED'],
    ['DisbursementVoucher', 'APPROVED', 'VOUCHER_APPROVED'], ['DisbursementVoucher', 'PAID', 'VOUCHER_PAID'],
    ['WhtCertificate', 'ISSUED', 'WHT_ISSUED'], ['ExpenseSubstituteReceiptEvidence', 'PREPARED', 'SUBSTITUTE_PREPARED'],
  ];
  for (const [table, status, expected] of states) assert.deepEqual(observedWorkflowTerminals([{ kind: `${table}.create`, recordId: 'row' }], {},
    { [table!]: [{ id: 'row', status }] }), [expected]);
});

it('accepts an applied draft action only as a linked parent effect at confirmation', () => {
  const task = { id: 'claim', kind: 'reimbursement_claim', startTurn: 0, endTurn: 1, confirmTurn: 1, minimalTurns: 2, completable: true,
    goldTerminal: { effect: 'REIMBURSEMENT_DRAFT_SAVED', records: [{ table: 'ReimbursementRequest', ref: '$created:claim', status: 'DRAFT' }] } } as any;
  const preview = { action: 'reimbursement_draft_confirm', target: '$created:claim' };
  const turns = [{ turnIndex: 0, businessSnapshot: { business: {}, collectionState: {} }, unintendedEffects: [], preview: { ...preview, target: 'request' } },
    { turnIndex: 1, businessSnapshot: { business: { ReimbursementRequest: [{ id: 'request', status: 'DRAFT' }],
      ReimbursementDraftAction: [{ id: 'action', status: 'APPLIED', requestId: 'request' }] }, collectionState: {} },
      unintendedEffects: [{ kind: 'ReimbursementRequest.create', recordId: 'request' }, { kind: 'ReimbursementDraftAction.update', recordId: 'action' }] }] as any;
  assert.equal(checkWorkflowGold(task, turns, preview).wrongApplied, 0);
  turns[1].businessSnapshot.business.ReimbursementDraftAction[0].requestId = 'other';
  assert.equal(checkWorkflowGold(task, turns, preview).wrongApplied, 1);
});

it('scores every distinct delivered preview, including an extra wrong target on the expected turn', () => {
  const task = { id: 'decline', kind: 'expense_confirm', startTurn: 0, endTurn: 1, previewTurn: 0,
    goldTerminal: { effect: 'DECLINED', records: [] }, minimalTurns: 2, completable: true } as any;
  const preview = { action: 'CONFIRM', target: '$seed:one' };
  const correct = { action: 'CONFIRM', target: 'one' };
  const turn = { turnIndex: 0, businessSnapshot: { business: {}, collectionState: {} }, unintendedEffects: [], preview: correct,
    deliveredActions: [{ type: 'preview', preview: correct }, { type: 'preview', preview: { ...correct, target: 'other' } }] };
  assert.equal(checkWorkflowGold(task, [turn], preview).wrongPreview, 1);
  turn.deliveredActions[1]!.preview = { ...correct };
  assert.equal(checkWorkflowGold(task, [turn], preview).wrongPreview, 0);
});
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
      // Snapshot timestamps carry no zone: Bangkok midnight of the 28th is stored as 17:00 on the 27th (UTC).
      const zoneless = { ...row, paidAt: '2026-09-27T17:00:00' };
      assert.equal(checkWorkflowGold(goldTask, [{ turnIndex: 1, businessSnapshot: { business: { [table]: [zoneless] }, collectionState: {} }, unintendedEffects: [] }]).terminalMatches, true, `${table} zoneless`);
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

describe('M3 round 3 preview and conversation bindings', () => {
  const declined = { id: 'decline', kind: 'expense_pay', startTurn: 0, endTurn: 1, previewTurn: 0,
    goldTerminal: { effect: 'DECLINED', records: [] }, minimalTurns: 2, completable: true } as any;
  const preview = { action: 'pay', target: '$seed:expense', amount: '100.00' };
  const turn = (turnIndex: number, business: any = {}, unintendedEffects: any[] = [], actual?: any) => ({ turnIndex,
    businessSnapshot: { business, collectionState: {} }, unintendedEffects, ...(actual ? { preview: actual } : {}) });
  it('accepts the named declined preview and rejects a different target or every applied change', () => {
    const rows = [turn(0, {}, [], { action: 'pay', target: 'expense', amount: '100.0000' }), turn(1)];
    assert.deepEqual(checkWorkflowGold(declined, rows, preview), { wrongApplied: 0, wrongPreview: 0, terminalMatches: true, businessChanges: 0 });
    assert.equal(checkWorkflowGold(declined, [turn(0, {}, [], { ...preview, target: 'other' }), turn(1)], preview).wrongPreview, 1);
    assert.equal(checkWorkflowGold(declined, [...rows.slice(0, 1), turn(1, { ExpenseRecord: [{ id: 'expense' }] }, [{ kind: 'ExpenseRecord.update', recordId: 'expense' }])], preview).wrongApplied, 1);
    const withCollect = { ...declined, goldTerminal: { effect: 'DECLINED', records: [{ table: 'ExpenseRecord', ref: '$seed:expense', phase: 'collect' }] } };
    assert.equal(checkWorkflowGold(withCollect, [turn(0, { ExpenseRecord: [{ id: 'expense' }] }, [{ kind: 'ExpenseRecord.create', recordId: 'expense' }], preview), turn(1)], preview).wrongApplied, 1);
  });
  it('binds earlier created rows once per conversation despite later status changes and task ordering', async () => {
    const { bindWorkflowCreatedReferences } = await import('./oracle');
    const created = { id: 'new-claim', kind: 'reimbursement_claim', startTurn: 0, endTurn: 1, confirmTurn: 1,
      goldTerminal: { effect: 'REIMBURSEMENT_DRAFT_SAVED', records: [{ table: 'ReimbursementRequest', ref: '$created:new-claim', status: 'DRAFT' }] }, minimalTurns: 2, completable: true } as any;
    const submitted = { id: 'send-claim', kind: 'reimbursement_submit', startTurn: 2, endTurn: 3, confirmTurn: 3,
      goldTerminal: { effect: 'REIMBURSEMENT_SUBMITTED', records: [{ table: 'ReimbursementRequest', ref: '$created:new-claim', status: 'PENDING_APPROVAL' }] }, minimalTurns: 2, completable: true } as any;
    const rows = [turn(0), turn(1, { ReimbursementRequest: [{ id: 'new-row', status: 'DRAFT' }] }, [{ kind: 'ReimbursementRequest.create', recordId: 'new-row' }]),
      turn(2, { ReimbursementRequest: [{ id: 'new-row', status: 'DRAFT' }] }, [], { action: 'submit', target: 'new-row' }),
      turn(3, { ReimbursementRequest: [{ id: 'new-row', status: 'PENDING_APPROVAL' }] }, [{ kind: 'ReimbursementRequest.update', recordId: 'new-row' }])];
    const bindings = bindWorkflowCreatedReferences([submitted, created], rows, NOW);
    const result = checkWorkflowGold(submitted, rows, { action: 'submit', target: '$created:new-claim' }, NOW, bindings);
    assert.equal(result.terminalMatches, true); assert.equal(result.wrongApplied, 0); assert.equal(result.wrongPreview, 0);
    assert.equal(checkWorkflowGold(submitted, rows, undefined, NOW, {}).terminalMatches, false, 'another conversation cannot inherit the binding');
    assert.equal(checkWorkflowGold(submitted, [turn(2, {}, [], { action: 'submit', target: 'other' }), rows[3]!], { action: 'submit', target: '$created:new-claim' }, NOW, bindings).wrongPreview, 1);
    assert.deepEqual(bindWorkflowCreatedReferences([created], rows.map(row => ({ ...row, unintendedEffects: [] })), NOW), {}, 'a snapshot alone cannot prove creation');
    const deleted = { ...submitted, kind: 'expense_delete', goldTerminal: { effect: 'EXPENSE_DELETED', records: [{ table: 'ExpenseRecord', ref: '$created:draft' }] } } as any;
    const removed = [turn(2, { ExpenseRecord: [{ id: 'draft-row' }] }, [], { action: 'delete', target: 'draft-row' }), turn(3, {}, [{ kind: 'ExpenseRecord.delete', recordId: 'draft-row' }])];
    const removal = checkWorkflowGold(deleted, removed, { action: 'delete', target: '$created:draft' }, NOW, { 'ExpenseRecord:$created:draft': 'draft-row' });
    assert.equal(removal.terminalMatches, true); assert.equal(removal.wrongApplied, 0); assert.equal(removal.wrongPreview, 0);
    const withLine = [turn(2, { ExpenseRecord: [{ id: 'draft-row' }], ExpenseLine: [{ id: 'draft-row-line1', expenseId: 'draft-row' }, { id: 'other-line', expenseId: 'other' }] }, [], { action: 'delete', target: 'draft-row' }),
      turn(3, {}, [{ kind: 'ExpenseLine.delete', recordId: 'draft-row-line1' }, { kind: 'ExpenseRecord.delete', recordId: 'draft-row' }])];
    assert.equal(checkWorkflowGold(deleted, withLine, { action: 'delete', target: '$created:draft' }, NOW, { 'ExpenseRecord:$created:draft': 'draft-row' }).wrongApplied, 0, 'the deleted draft takes its own line');
    withLine[1]!.unintendedEffects.push({ kind: 'ExpenseLine.delete', recordId: 'other-line' });
    assert.equal(checkWorkflowGold(deleted, withLine, { action: 'delete', target: '$created:draft' }, NOW, { 'ExpenseRecord:$created:draft': 'draft-row' }).wrongApplied, 1, 'another expense line is still wrong');
  });
  it('scores an approval that moves the claim to payment and projects its expense as the gold claim', () => {
    const approve = { id: 'approve', kind: 'approvals', startTurn: 0, endTurn: 1, confirmTurn: 1, minimalTurns: 2, completable: true,
      goldTerminal: { effect: 'REIMBURSEMENT_APPROVED', records: [{ table: 'ReimbursementRequest', ref: '$seed:claim', status: 'APPROVED' }] } } as any;
    const after = { ReimbursementRequest: [{ id: 'claim', companyId: 'c', status: 'READY_FOR_PAYMENT' }],
      ExpenseRecord: [{ id: 'projection', companyId: 'c', status: 'CONFIRMED', sourceReimbursementRequestId: 'claim' }, { id: 'stray', companyId: 'c', sourceReimbursementRequestId: 'other' }],
      ExpenseLine: [{ id: 'projection-line', companyId: 'c', expenseId: 'projection' }] };
    const effects = [{ kind: 'ReimbursementRequest.update', recordId: 'claim' }, { kind: 'ExpenseRecord.create', recordId: 'projection' }, { kind: 'ExpenseLine.create', recordId: 'projection-line' }];
    const result = checkWorkflowGold(approve, [turn(0, { ReimbursementRequest: [{ id: 'claim', companyId: 'c', status: 'PENDING_APPROVAL' }] }), turn(1, after, effects)]);
    assert.equal(result.terminalMatches, true); assert.equal(result.wrongApplied, 0);
    assert.equal(checkWorkflowGold(approve, [turn(0), turn(1, after, [...effects, { kind: 'ExpenseRecord.create', recordId: 'stray' }])]).wrongApplied, 1, 'another claim projection is wrong');
  });
  it('scores a voucher submit that reserves the expense on its line as the gold voucher', () => {
    const submit = { id: 'submit', kind: 'payment_voucher', startTurn: 0, endTurn: 1, confirmTurn: 1, minimalTurns: 2, completable: true,
      goldTerminal: { effect: 'VOUCHER_SUBMITTED', records: [{ table: 'DisbursementVoucher', ref: '$created:create', status: 'PENDING_APPROVAL' }] } } as any;
    const after = { DisbursementVoucher: [{ id: 'voucher', companyId: 'c', status: 'PENDING_APPROVAL' }], DisbursementVoucherLine: [{ id: 'voucher-line', voucherId: 'voucher', expenseId: 'bill' }],
      ExpenseRecord: [{ id: 'bill', companyId: 'c', reservedByDisbursementVoucherId: 'voucher' }, { id: 'stray', companyId: 'c', reservedByDisbursementVoucherId: 'other' }] };
    const effects = [{ kind: 'DisbursementVoucher.update', recordId: 'voucher' }, { kind: 'DisbursementVoucherLine.update', recordId: 'voucher-line' }, { kind: 'ExpenseRecord.update', recordId: 'bill' }];
    const bindings = { 'DisbursementVoucher:$created:create': 'voucher' };
    const result = checkWorkflowGold(submit, [turn(0), turn(1, after, effects)], undefined, NOW, { ...bindings });
    assert.equal(result.terminalMatches, true); assert.equal(result.wrongApplied, 0);
    assert.equal(checkWorkflowGold(submit, [turn(0), turn(1, after, [...effects, { kind: 'ExpenseRecord.update', recordId: 'stray' }])], undefined, NOW, { ...bindings }).wrongApplied, 1, 'an expense reserved by another voucher is wrong');
  });
});

describe('M3 round 3 opt-in actors and seller truncation', () => {
  it('seeds an unlinked LINE identity without a company role and a paid creator without list-read grants', () => {
    const unlinked = { key: 'before-link', kind: 'unlinked' } as const;
    const creator = { key: 'paid-creator', kind: 'creator-only', company: 'B', role: 'STAFF', branchScope: 'all' } as const;
    const seed = buildWorkflowSeed(NOW, [unlinked, creator] as any);
    const unknown = resolveWorkflowActor(unlinked as any, seed) as any, paid = resolveWorkflowActor(creator as any, seed) as any;
    assert.ok(unknown.lineUserId.startsWith('U'));
    const claims = seed.rows.filter(row => row.model === 'reimbursementRequest' && row.data.companyId === paid.companyId);
    assert.ok(claims.length && claims.every(row => row.data.missingReceiptReason && row.data.receiptRequirementStatus === 'MISSING_WITH_REASON'), 'seeded claims pass the receipt gate');
    assert.equal(seed.rows.filter(row => row.model === 'reimbursementPolicy' && row.data.companyId === paid.companyId && row.data.allowMissingReceiptWithReason).length, 1);
    const ready = seed.rows.filter(row => row.model === 'expenseRecord' && row.data.companyId === paid.companyId && String(row.data.id).startsWith('workflow-expense-') && row.data.status === 'READY_FOR_CONFIRMATION');
    assert.ok(ready.length && ready.every(row => row.data.taxEvidenceStatus === 'SUPPORTING_ONLY' && row.data.aiVerificationSummaryJson?.documentEvidenceDraft?.originalDocumentAvailable === true), 'ready rows carry the reviewed original-paper route');
    assert.equal(unknown.companyId, undefined); assert.equal(unknown.role, undefined);
    assert.ok(!seed.rows.some(row => row.model === 'externalIdentity' && row.data.providerUserId === unknown.lineUserId && row.data.status === 'ACTIVE'));
    const grants = seed.rows.filter(row => row.model === 'membershipRole' && row.data.membershipId === paid.membershipId).map(row => row.data.roleId);
    const permissions = seed.rows.filter(row => row.model === 'rolePermission' && grants.includes(row.data.roleId)).map(row => row.data.permissionId);
    assert.ok(permissions.includes('perm-expense_create'));
    for (const permission of ['expense_read', 'expense_read_own', 'expense_read_related']) assert.ok(!permissions.includes(`perm-${permission}`));
    for (const status of ['DRAFT', 'NEEDS_REVIEW']) assert.ok(seed.rows.some(row => row.model === 'expenseRecord' && row.data.companyId === 'company-b' && row.data.createdByUserId === paid.userId && row.data.status === status));
    assert.equal(seed.companies.B.tierKey, 'PRO_999');
    assert.deepEqual(seed, buildWorkflowSeed(NOW, [unlinked, creator] as any));
    assert.equal(buildWorkflowSeed(NOW).actors['paid-creator'], undefined);
    assert.throws(() => resolveWorkflowActor(creator as any, buildWorkflowSeed(NOW)), /CREATOR_ONLY_SEED_MISSING/);
    assert.equal(seed.rows.filter(row => row.model === 'accountingCounterparty' && row.data.companyId === 'company-b' && row.data.displayName === 'ผู้ขายชื่อซ้ำ').length, 4);
  });
});

describe('created LINE claim gold', () => {
  const claim = () => {
    const task = { id: 'task', kind: 'reimbursement_claim', startTurn: 0, endTurn: 1, confirmTurn: 1, minimalTurns: 2, completable: true,
      goldTerminal: { effect: 'REIMBURSEMENT_DRAFT_SAVED', records: [{ table: 'ReimbursementRequest', ref: '$created:task',
        amount: '250.00', reason: 'ไปส่งเอกสารให้ร้าน', categoryName: 'ค่าเดินทาง' }] } } as any;
    const business = {
      ReimbursementRequest: [{ id: 'claim', companyId: 'company-c', status: 'DRAFT', amount: '250.0000', reason: 'ไปส่งเอกสารให้ร้าน', categoryKey: 'category-c-travel', categoryLabelSnapshot: null as string | null }],
      ReimbursementLine: [{ id: 'line', companyId: 'company-c', reimbursementRequestId: 'claim', lineNo: 1, amount: '250.0000',
        incurredDate: new Date('2026-11-06T04:00:00Z'), categoryLabelSnapshot: 'ค่าเดินทาง' as string | null, description: 'ค่าแท็กซี่' }],
      ReimbursementDraftAction: [{ id: 'action', companyId: 'company-c', status: 'APPLIED', requestId: 'claim' }],
    };
    const preview = { action: 'reimbursement_draft_confirm', target: '$created:task' };
    const turns = [{ turnIndex: 0, businessSnapshot: { business: {}, collectionState: {} }, unintendedEffects: [], preview: { ...preview, target: 'claim' } },
      { turnIndex: 1, businessSnapshot: { business, collectionState: {} }, unintendedEffects: [
        { kind: 'ReimbursementDraftAction.update', recordId: 'action' }, { kind: 'ReimbursementLine.create', recordId: 'line' },
        { kind: 'ReimbursementRequest.create', recordId: 'claim' },
      ] }] as any;
    return { task, business, turns, preview };
  };

  it('matches the reported 250-baht claim and accepts its created line and applied draft action', async () => {
    const { task, turns, preview } = claim();
    const expected = { wrongApplied: 0, wrongPreview: 0, terminalMatches: true, businessChanges: 3 };
    assert.deepEqual(checkWorkflowGold(task, turns, preview), expected);
    const { compactRuntimeTurnEvidence } = await import('../line-ai-reliability-runtime');
    const created = new Set<string>();
    assert.deepEqual(checkWorkflowGold(task, turns.map((turn: any) => compactRuntimeTurnEvidence(turn, task.goldTerminal.records, created)), preview), expected);
  });

  it('uses request snapshot, first matching line snapshot, then the seeded category key', () => {
    const { task, business, turns } = claim();
    business.ReimbursementRequest[0].categoryLabelSnapshot = 'ค่าเดินทาง';
    business.ReimbursementLine[0].categoryLabelSnapshot = 'ค่าออฟฟิศ';
    assert.equal(checkWorkflowGold(task, turns).terminalMatches, true);
    business.ReimbursementRequest[0].categoryLabelSnapshot = null;
    business.ReimbursementLine.unshift({ ...business.ReimbursementLine[0], id: 'later', lineNo: 2, categoryLabelSnapshot: 'ค่าเดินทาง' });
    assert.equal(checkWorkflowGold(task, turns).terminalMatches, false, 'lineNo 1 takes precedence over the array order');
    business.ReimbursementLine.splice(0, 1);
    business.ReimbursementLine[0].categoryLabelSnapshot = null;
    assert.equal(checkWorkflowGold(task, turns).terminalMatches, true);
    business.ReimbursementRequest[0].categoryKey = 'category-c-office';
    assert.equal(checkWorkflowGold(task, turns).terminalMatches, false, 'a different category key cannot satisfy the travel gold');
  });

  it('rejects new or changed lines during seeded claim approval and later approval of a previously created claim', () => {
    for (const ref of ['$seed:claim', '$created:previous-task']) for (const operation of ['create', 'update']) {
      const { task, business, turns } = claim();
      task.kind = 'approvals';
      task.goldTerminal = { effect: 'REIMBURSEMENT_APPROVED', records: [{ table: 'ReimbursementRequest', ref, status: 'APPROVED' }] };
      business.ReimbursementRequest[0].status = 'APPROVED';
      turns[1].unintendedEffects = [{ kind: 'ReimbursementRequest.update', recordId: 'claim' }, { kind: `ReimbursementLine.${operation}`, recordId: 'line' }];
      assert.equal(checkWorkflowGold(task, turns, undefined, undefined, { 'ReimbursementRequest:$created:previous-task': 'claim' }).wrongApplied, 1);
    }
  });

  it('rejects an orphan line, early writes and a line update outside the created-line exception', () => {
    const { task, business, turns } = claim();
    business.ReimbursementLine[0].reimbursementRequestId = 'other';
    assert.equal(checkWorkflowGold(task, turns).wrongApplied, 1);
    business.ReimbursementLine[0].reimbursementRequestId = 'claim';
    turns[1].unintendedEffects[1].kind = 'ReimbursementLine.update';
    assert.equal(checkWorkflowGold(task, turns).wrongApplied, 1);
    turns[1].unintendedEffects[1].kind = 'ReimbursementLine.create';
    turns[0].businessSnapshot = turns[1].businessSnapshot;
    turns[0].unintendedEffects = turns[1].unintendedEffects;
    turns[1].unintendedEffects = [];
    assert.equal(checkWorkflowGold(task, turns).wrongApplied, 3);
  });

  it('continues to count claim writes as wrong when the free-shop gold refuses the request', () => {
    const { task, business, turns } = claim();
    for (const rows of Object.values(business)) for (const row of rows) row.companyId = 'company-a';
    task.goldTerminal = { effect: 'REFUSED', records: [] };
    delete task.confirmTurn;
    assert.equal(checkWorkflowGold(task, turns).wrongApplied, 3);
  });
});

it('R14 a gold claim legacy fallback replacement allows only an identical line in the same turn', () => {
  const task: any = { id: 'edit', kind: 'reimbursement_claim', startTurn: 0, endTurn: 1, confirmTurn: 1, minimalTurns: 2, completable: true, goldTerminal: { effect: 'REIMBURSEMENT_DRAFT_SAVED', records: [{ table: 'ReimbursementRequest', ref: '$seed:claim', status: 'DRAFT' }] } };
  const values = { companyId: 'c', reimbursementRequestId: 'claim', lineNo: 1, incurredDate: '2026-11-05', description: 'ค่ารถ', purpose: null, amount: '85', categoryKey: 'travel', attachmentId: null, linkedExpenseId: null };
  const before: any = { turnIndex: 0, businessSnapshot: { business: { ReimbursementRequest: [{ id: 'claim', companyId: 'c', status: 'DRAFT' }], ReimbursementLine: [{ ...values, id: 'rbl_claim' }] } }, unintendedEffects: [] };
  const after: any = { turnIndex: 1, businessSnapshot: { business: { ReimbursementRequest: [{ id: 'claim', companyId: 'c', status: 'DRAFT' }], ReimbursementLine: [{ ...values, id: 'real-line' }] } }, unintendedEffects: [{ kind: 'ReimbursementLine.delete', recordId: 'rbl_claim' }, { kind: 'ReimbursementLine.create', recordId: 'real-line' }] };
  assert.equal(checkWorkflowGold(task, [before, after]).wrongApplied, 0);
  const legacyTime = structuredClone(before); legacyTime.businessSnapshot.business.ReimbursementLine[0].incurredDate = '2026-11-05T08:30:00.000Z';
  assert.equal(checkWorkflowGold(task, [legacyTime, after]).wrongApplied, 0);
  legacyTime.businessSnapshot.business.ReimbursementLine[0].incurredDate = '2026-11-04T18:30:00.000Z';
  assert.equal(checkWorkflowGold(task, [legacyTime, after]).wrongApplied, 0);
  legacyTime.businessSnapshot.business.ReimbursementLine[0].incurredDate = '2026-11-05T18:30:00.000Z';
  assert.equal(checkWorkflowGold(task, [legacyTime, after]).wrongApplied, 2);
  const changed = structuredClone(after); changed.businessSnapshot.business.ReimbursementLine[0].amount = '99';
  assert.equal(checkWorkflowGold(task, [before, changed]).wrongApplied, 2);
  const dateChanged = structuredClone(after); dateChanged.businessSnapshot.business.ReimbursementLine[0].incurredDate = '2026-11-06';
  assert.equal(checkWorkflowGold(task, [before, dateChanged]).wrongApplied, 2);
  const extra = structuredClone(after); extra.businessSnapshot.business.ReimbursementLine.push({ ...values, id: 'extra' });
  extra.unintendedEffects.push({ kind: 'ReimbursementLine.create', recordId: 'extra' });
  assert.equal(checkWorkflowGold(task, [before, extra]).wrongApplied, 1);
  assert.equal(checkWorkflowGold({ ...task, confirmTurn: 2 }, [before, after]).wrongApplied, 2);
});

it('R16 voucher payment allows only expense and payment effects linked by its own lines', () => {
  const task = { id: 'pay', kind: 'payment_voucher', startTurn: 0, endTurn: 1, confirmTurn: 1, minimalTurns: 2, completable: true,
    goldTerminal: { effect: 'VOUCHER_PAID', records: [{ table: 'DisbursementVoucher', ref: '$seed:voucher', status: 'PAID' }] } } as any;
  const business: any = { DisbursementVoucher: [{ id: 'voucher', companyId: 'c', status: 'PAID' }],
    DisbursementVoucherLine: [{ id: 'line', companyId: 'c', voucherId: 'voucher', expenseId: 'bill', expensePaymentId: 'payment' }],
    ExpenseRecord: [{ id: 'bill', companyId: 'c', paymentStatus: 'PAID' }], ExpensePayment: [{ id: 'payment', companyId: 'c', expenseId: 'bill' }] };
  const effects = [{ kind: 'DisbursementVoucher.update', recordId: 'voucher' }, { kind: 'DisbursementVoucherLine.update', recordId: 'line' },
    { kind: 'ExpenseRecord.update', recordId: 'bill' }, { kind: 'ExpensePayment.create', recordId: 'payment' }];
  const score = () => checkWorkflowGold(task, [{ turnIndex: 0, businessSnapshot: { business: {}, collectionState: {} }, unintendedEffects: [] },
    { turnIndex: 1, businessSnapshot: { business, collectionState: {} }, unintendedEffects: effects }] as any);
  assert.equal(score().wrongApplied, 0);
  delete business.DisbursementVoucherLine[0].expensePaymentId;
  business.DisbursementVoucherLine[0].coversPaymentId = 'payment';
  assert.equal(score().wrongApplied, 0);
  business.DisbursementVoucherLine[0].coversPaymentId = 'another-payment';
  assert.equal(score().wrongApplied, 1);
  business.DisbursementVoucherLine[0].expenseId = 'another-expense';
  assert.equal(score().wrongApplied, 2);
  business.DisbursementVoucherLine[0].expenseId = 'bill'; business.ExpenseRecord[0].companyId = 'foreign';
  assert.equal(score().wrongApplied, 2);
});

it('R17 gold reasons ignore only trailing Thai politeness particles', () => {
  const task: any = { id: 'reject', kind: 'reimbursement_reject', startTurn: 0, endTurn: 1, confirmTurn: 1, minimalTurns: 2, completable: true,
    goldTerminal: { effect: 'REIMBURSEMENT_REJECTED', records: [{ table: 'ReimbursementRequest', ref: '$seed:claim', status: 'REJECTED', reason: 'บันทึกซ้ำค่ะ' }] } };
  const business: any = { ReimbursementRequest: [{ id: 'claim', status: 'REJECTED', reason: 'บันทึกซ้ำ' }] };
  const turns: any = [{ turnIndex: 0, businessSnapshot: { business: {}, collectionState: {} }, unintendedEffects: [] },
    { turnIndex: 1, businessSnapshot: { business, collectionState: {} }, unintendedEffects: [{ kind: 'ReimbursementRequest.update', recordId: 'claim' }] }];
  assert.equal(checkWorkflowGold(task, turns).terminalMatches, true);
  business.ReimbursementRequest[0].reason = 'บันทึกคนละรายการ'; assert.equal(checkWorkflowGold(task, turns).terminalMatches, false);
});
