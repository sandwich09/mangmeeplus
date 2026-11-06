import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { validateCorpus, validateWorkflowCorpus, flattenTurns, parseFailedConversationIds, selectConversations, type Corpus } from './types';

const HERE = dirname(fileURLToPath(import.meta.url));

it('accepts only message classifier labels as an optional workflow manifest setting', () => {
  const corpus = JSON.parse(readFileSync(resolve(HERE, 'corpus.workflow.sample.json'), 'utf8'));
  corpus.classifierLabels = 'messages';
  assert.doesNotThrow(() => validateWorkflowCorpus(corpus));
  corpus.classifierLabels = 'buttons';
  assert.throws(() => validateWorkflowCorpus(corpus), /WORKFLOW_CLASSIFIER_LABELS/);
});

describe('free actor model-free turns (owner 2026-11-05)', () => {
  const corpus = (expect: Record<string, unknown>) => ({ version: 2, seed: 'free-answer', status: 'draft', conversations: [{
    id: 'free-reader', category: 'read', journeyKind: 'typed', actors: [{ key: 'reader', company: 'A', role: 'OWNER', branchScope: 'all', freeSourceDrafts: true }],
    tasks: [], turns: [{ user: 'ดูใบที่อัปโหลด', expect }],
  }] });
  it('keeps a free refusal valid only with zero model calls', () => {
    const expect = { card: 'refusal', maxModelCalls: 0, refusal: { reason: 'free', wayOut: ['เมนูหลัก'] } };
    assert.doesNotThrow(() => validateWorkflowCorpus(corpus(expect)));
    assert.throws(() => validateWorkflowCorpus(corpus({ ...expect, maxModelCalls: 1 })), /free_zero_model/);
  });
  it('accepts a model-free answer without knowledge, due date, preview or refusal', () => {
    const expect = { card: 'answer', maxModelCalls: 0, tags: { must_answer: true, must_not_refuse: true } };
    assert.doesNotThrow(() => validateWorkflowCorpus(corpus(expect)));
    for (const extra of [
      { knowledge: { cardId: 'vat', version: 1, requiredFacts: [], forbiddenFacts: [], allowedNumericFacts: [] } },
      { dueDate: { formType: 'PND3', monthOffset: 0 } }, { preview: { action: 'pay', target: 'expense' } },
      { refusal: { reason: 'permission', wayOut: ['เมนูหลัก'] } }, { card: 'question' },
    ]) assert.throws(() => validateWorkflowCorpus(corpus({ ...expect, ...extra })), /free_zero_model/);
    for (const maxModelCalls of [undefined, 1])
      assert.throws(() => validateWorkflowCorpus(corpus({ ...expect, maxModelCalls })), /free_zero_model/);
  });
});

function validConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1', company: 'A', role: 'OWNER',
    turns: [{ user: 'เดือนนี้จ่ายไปเท่าไหร่', category: '1', expect: { calls: [{ tool: 'expense.list_recent', input: { period: { $period: 'this_month_to_date' } } }] } }],
    ...overrides,
  };
}

describe('validateCorpus', () => {
  it('accepts the checked-in sample corpus', () => {
    const corpus = JSON.parse(readFileSync(resolve(HERE, 'corpus.sample.json'), 'utf8'));
    assert.doesNotThrow(() => validateCorpus(corpus));
  });

  it('accepts a minimal valid corpus', () => {
    const corpus: Corpus = { version: 1, conversations: [validConversation() as never] };
    assert.doesNotThrow(() => validateCorpus(corpus));
  });

  it('accepts a must_ask_choice tag alongside calls', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'ค่าน้ำมันเท่าไหร่คะ', category: '6', expect: {
        calls: [{ tool: 'expense.list_recent', input: { categoryName: 'น้ำมัน' } }],
        tags: { must_ask_choice: true },
      } }],
    })] };
    assert.doesNotThrow(() => validateCorpus(corpus));
  });

  it('accepts a tag-only turn with no calls', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'สวัสดีค่ะ', category: '19', expect: { tags: { no_tool: true, must_answer: true } } }],
    })] };
    assert.doesNotThrow(() => validateCorpus(corpus));
  });

  it('accepts a $fromShownItems reference and alternatives', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'รายการแรกคืออะไร', category: '8', expect: { calls: [
        { tool: 'expense.get_detail', input: { expenseId: { $fromShownItems: 0 } }, alternatives: [{ tool: 'expense.get_detail', input: { expenseId: { $fromShownItems: 0 } } }] },
      ] } }],
    })] };
    assert.doesNotThrow(() => validateCorpus(corpus));
  });

  it('rejects a wrong version', () => {
    assert.throws(() => validateCorpus({ version: 2, conversations: [validConversation()] }), /version/);
  });

  it('rejects an empty conversations array', () => {
    assert.throws(() => validateCorpus({ version: 1, conversations: [] }));
  });

  it('rejects a duplicate conversation id', () => {
    const corpus = { version: 1, conversations: [validConversation(), validConversation()] };
    assert.throws(() => validateCorpus(corpus), /duplicate/);
  });

  it('rejects an unknown role', () => {
    const corpus = { version: 1, conversations: [validConversation({ role: 'CEO' })] };
    assert.throws(() => validateCorpus(corpus), /role/);
  });

  it('rejects an unknown company', () => {
    const corpus = { version: 1, conversations: [validConversation({ company: 'C' })] };
    assert.throws(() => validateCorpus(corpus), /company/);
  });

  it('rejects a turn with neither calls nor tags', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'สวัสดีค่ะ', category: '19', expect: {} }],
    })] };
    assert.throws(() => validateCorpus(corpus), /calls\/tags/);
  });

  it('rejects a gold call missing a tool name', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'x', category: '1', expect: { calls: [{ input: {} }] } }],
    })] };
    assert.throws(() => validateCorpus(corpus), /tool/);
  });

  it('accepts a gold call with a valid answerShape and groupBy', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'x', category: '7', expect: { calls: [{ tool: 'expense.list_recent', input: {}, answerShape: 'list' }] } },
        { user: 'y', category: '5', expect: { calls: [{ tool: 'expense.get_breakdown', input: {}, answerShape: 'breakdown', groupBy: 'vendor' }] } },
        { user: 'z', category: '13', expect: { calls: [{ tool: 'expense.get_daily_closing', input: {}, answerShape: 'daily_closing' }] } }],
    })] };
    assert.doesNotThrow(() => validateCorpus(corpus));
  });

  it('rejects an unknown answerShape or groupBy', () => {
    const badShape = { version: 1, conversations: [validConversation({
      turns: [{ user: 'x', category: '1', expect: { calls: [{ tool: 'expense.list_recent', input: {}, answerShape: 'summary' }] } }],
    })] };
    assert.throws(() => validateCorpus(badShape), /answerShape/);
    const badGroup = { version: 1, conversations: [validConversation({
      turns: [{ user: 'x', category: '4', expect: { calls: [{ tool: 'expense.get_breakdown', input: {}, groupBy: 'region' }] } }],
    })] };
    assert.throws(() => validateCorpus(badGroup), /groupBy/);
  });

  it('rejects an unsupported gold input value', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'x', category: '1', expect: { calls: [{ tool: 'expense.list_recent', input: { branchId: { nested: true } } }] } }],
    })] };
    assert.throws(() => validateCorpus(corpus), /unsupported value/);
  });

  it('rejects an unknown period token', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'x', category: '1', expect: { calls: [{ tool: 'expense.list_recent', input: { period: { $period: 'next_month' } } }] } }],
    })] };
    assert.throws(() => validateCorpus(corpus), /unsupported value/);
  });

  it('accepts known {{...}} date placeholders in user text', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'เดือน{{last_month_th}} {{last_month_be_year}} จ่ายไปเท่าไหร่คะ', category: '1', expect: { tags: { must_answer: true } } }],
    })] };
    assert.doesNotThrow(() => validateCorpus(corpus));
  });

  it('rejects an unknown {{...}} placeholder in user text', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: '{{next_month_th}} จ่ายไปเท่าไหร่คะ', category: '1', expect: { tags: { must_answer: true } } }],
    })] };
    assert.throws(() => validateCorpus(corpus), /unknown placeholder/);
  });

  it('rejects an unknown tag key', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'x', category: '19', expect: { tags: { unexpected_tag: true } } }],
    })] };
    assert.throws(() => validateCorpus(corpus), /unknown tag/);
  });

  it('rejects an unknown top-level field (no silent typos)', () => {
    const corpus = { version: 1, conversations: [validConversation({ extra: 'nope' })] };
    assert.throws(() => validateCorpus(corpus), /unknown field/);
  });

  it('accepts a turn with a valid expect.requiredFacts (task item 2)', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'รายการที่ 3 คือร้านอะไรครับ', category: '8', expect: {
        calls: [{ tool: 'expense.get_detail', input: { expenseId: { $fromShownItems: 2 } } }], requiredFacts: ['vendor', 'date'],
      } }],
    })] };
    assert.doesNotThrow(() => validateCorpus(corpus));
  });

  it('rejects an unknown requiredFacts category', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'x', category: '8', expect: {
        calls: [{ tool: 'expense.get_detail', input: {} }], requiredFacts: ['vendor', 'not-a-real-category'],
      } }],
    })] };
    assert.throws(() => validateCorpus(corpus), /requiredFacts.*must be one of/);
  });

  it('rejects an empty requiredFacts array (omit the field instead)', () => {
    const corpus = { version: 1, conversations: [validConversation({
      turns: [{ user: 'x', category: '8', expect: { calls: [{ tool: 'expense.get_detail', input: {} }], requiredFacts: [] } }],
    })] };
    assert.throws(() => validateCorpus(corpus), /requiredFacts: must be a non-empty array/);
  });
});

describe('validateWorkflowCorpus M1b', () => {
  const paid = { version: 2, seed: 'synthetic', status: 'draft', conversations: [{ id: 'paid-c', category: 'expense', journeyKind: 'button',
    actors: [{ key: 'owner', company: 'C', role: 'OWNER', branchScope: 'all' }],
    tasks: [{ id: 'pay', kind: 'expense_pay', startTurn: 0, endTurn: 1, confirmTurn: 1, goldTerminal: { effect: 'EXPENSE_PAID', records: [
      { table: 'ExpensePayment', ref: '$created:pay', paidAmount: '12.50', paidDate: '2026-11-04', paymentMethod: 'CASH' },
    ] }, minimalTurns: 2, completable: true }],
    turns: [{ as: { key: 'owner' }, user: 'จ่ายรายการนี้', expect: { preview: { action: 'pay', target: '$seed:expense' } } }, { as: { key: 'owner' }, press: 'ยืนยัน', expect: {} }],
  }] };

  it('accepts a write task whose preview precedes its confirmation turn', () => {
    assert.doesNotThrow(() => validateWorkflowCorpus(paid));
  });

  it('requires a confirmation turn and the matching preview on a write task', () => {
    const malformed = structuredClone(paid);
    delete malformed.conversations[0].tasks[0].confirmTurn;
    assert.throws(() => validateWorkflowCorpus(malformed), /confirmTurn_required/);
  });

  it('rejects a preview only on the confirmation turn and names the conversation and turn', () => {
    const malformed = structuredClone(paid);
    malformed.conversations[0].turns[1].expect = malformed.conversations[0].turns[0].expect;
    malformed.conversations[0].turns[0].expect = {};
    assert.throws(() => validateWorkflowCorpus(malformed), /paid-c.*turns\[0\].*preview_before_confirm.*confirmTurn 1/);
  });

  it('rejects a write task with no preview before confirmation', () => {
    const malformed = structuredClone(paid);
    malformed.conversations[0].turns[0].expect = {};
    assert.throws(() => validateWorkflowCorpus(malformed), /paid-c.*turns\[0\].*preview_before_confirm/);
  });

  it('keeps collection-phase records and all three paid-effect table pairings', () => {
    for (const [effect, table] of [['EXPENSE_PAID', 'ExpensePayment'], ['REIMBURSEMENT_PAID', 'ReimbursementPayment'], ['VOUCHER_PAID', 'DisbursementVoucher']] as const) {
      const corpus = structuredClone(paid);
      const terminal = corpus.conversations[0].tasks[0].goldTerminal;
      terminal.effect = effect;
      const record = { ...terminal.records[0], table, phase: 'collect' };
      terminal.records = [record];
      assert.doesNotThrow(() => validateWorkflowCorpus(corpus));
      terminal.records[0].table = 'ExpenseRecord';
      assert.throws(() => validateWorkflowCorpus(corpus), /paid_record_fields/);
    }
  });

  it('requires all paid-record fields and keeps the turn press-only without calls', () => {
    const malformed = structuredClone(paid);
    delete malformed.conversations[0].tasks[0].goldTerminal.records[0].paymentMethod;
    assert.throws(() => validateWorkflowCorpus(malformed), /paid_record_fields/);
  });

  it('validates the oracle sample with expense payment, derived claim approval, and voucher payment', () => {
    const corpus = JSON.parse(readFileSync(resolve(HERE, 'corpus.workflow.oracle-sample.json'), 'utf8'));
    validateWorkflowCorpus(corpus);
    const writeTasks = corpus.conversations.flatMap(conversation => conversation.tasks).filter(task => task.confirmTurn !== undefined);
    assert.deepEqual(writeTasks.map(task => task.goldTerminal.effect), ['EXPENSE_PAID', 'REIMBURSEMENT_APPROVED', 'VOUCHER_PAID']);
    assert.ok(writeTasks[1].goldTerminal.records.some(record => record.table === 'ReimbursementApprovalStep' && record.ref.startsWith('$child:')));
  });
});

describe('flattenTurns', () => {
  it('carries the conversation and turn index alongside each turn, in order', () => {
    const corpus: Corpus = { version: 1, conversations: [
      validConversation({ id: 'a', turns: [{ user: 'one', category: '1', expect: { tags: { no_tool: true } } }, { user: 'two', category: '2', expect: { tags: { no_tool: true } } }] }) as never,
      validConversation({ id: 'b' }) as never,
    ] };
    const flat = flattenTurns(corpus);
    assert.deepEqual(flat.map((row) => [row.conversation.id, row.turnIndex, row.turn.user]), [
      ['a', 0, 'one'], ['a', 1, 'two'], ['b', 0, 'เดือนนี้จ่ายไปเท่าไหร่'],
    ]);
  });
});

describe('parseFailedConversationIds', () => {
  it('de-duplicates a conversation with more than one failing turn, in first-seen order', () => {
    const evidence = { summary: { failures: [
      { conversationId: 'b-manager-approvals' }, { conversationId: 'a-owner-monthly-flow' }, { conversationId: 'b-manager-approvals' },
    ] } };
    assert.deepEqual(parseFailedConversationIds(evidence), ['b-manager-approvals', 'a-owner-monthly-flow']);
  });

  it('returns an empty list for a fully-passing run', () => {
    assert.deepEqual(parseFailedConversationIds({ summary: { failures: [] } }), []);
  });
});

describe('selectConversations', () => {
  const corpus: Corpus = { version: 1, conversations: [
    validConversation({ id: 'a' }) as never, validConversation({ id: 'b' }) as never, validConversation({ id: 'c' }) as never,
  ] };

  it('returns every conversation, unchanged, when no subset was requested', () => {
    assert.deepEqual(selectConversations(corpus, null), corpus.conversations);
  });

  it('keeps only the requested ids, in the CORPUS\'s own order (not the request order)', () => {
    const selected = selectConversations(corpus, ['c', 'a']);
    assert.deepEqual(selected.map((conversation) => conversation.id), ['a', 'c']);
  });

  it('throws on a misspelled/stale id rather than silently running fewer conversations', () => {
    assert.throws(() => selectConversations(corpus, ['a', 'does-not-exist']), /does-not-exist/);
  });
});

describe('M3 tuning corpus and Q5 gold', () => {
  const load = () => JSON.parse(readFileSync(resolve(HERE, 'corpus.workflow.tuning.json'), 'utf8'));
  it('validates 80 conversations, 240 turns, 60% typed, all 14 starts and 30 whole Q5 pairs', async () => {
    const { buildWorkflowSeed } = await import('./seed');
    const { validateWorkflowPreflight } = await import('./run-preflight');
    const corpus = load(), now = new Date('2026-12-04T04:00:00Z');
    const coverage = validateWorkflowPreflight(corpus, buildWorkflowSeed(now, corpus.conversations.flatMap((row: any) => row.actors)), now);
    assert.ok(coverage.conversations >= 80 && coverage.turns >= 240);
    assert.ok(corpus.conversations.filter((row: any) => row.journeyKind === 'typed').length / coverage.conversations >= 0.6);
    const q5 = corpus.conversations.filter((row: any) => row.category === 'Q5');
    assert.equal(q5.length, 30);
    assert.ok(q5.every((row: any) => row.turns.length === 2 && row.turns.every((turn: any) => turn.expect.knowledge || turn.expect.refusal)));
    const kinds = ['reimbursement_claim','reimbursement_submit','reimbursement_cancel','approvals','reimbursement_reject','reimbursement_pay','expense_submit','expense_confirm','expense_delete','expense_void','expense_pay','payment_voucher','wht_certificate','substitute_receipt'];
    for (const kind of kinds) assert.ok(corpus.conversations.filter((row: any) => row.category === kind).length >= 3, kind);
    for (const role of ['OWNER','MANAGER','STAFF','ACCOUNTANT','AUDITOR_READONLY']) assert.ok(corpus.conversations.filter((row: any) => row.actors.some((actor: any) => actor.role === role)).length >= 5, role);
    const paidInputs = new Set(corpus.conversations.filter((row: any) => !row.actors.some((actor: any) => actor.freeSourceDrafts)).map((row: any) => row.turns[0].user));
    for (const row of corpus.conversations.filter((row: any) => row.category === 'free-boundary')) {
      assert.ok(row.actors.every((actor: any) => actor.freeSourceDrafts) && row.turns.every((turn: any) => turn.expect.maxModelCalls === 0));
      assert.ok(paidInputs.has(row.turns[0].user), `matched paid question: ${row.id}`);
    }
  });
  it('rejects missing card versions, malformed periods and free typed model admission', () => {
    const noVersion = load(); delete noVersion.conversations[0].turns[0].expect.knowledge.version;
    assert.throws(() => validateWorkflowCorpus(noVersion), /Q5-01.*knowledge.card/);
    const badPeriod = load(); badPeriod.conversations[20].turns[0].expect.dueDate.monthOffset = 2;
    assert.throws(() => validateWorkflowCorpus(badPeriod), /Q5-21.*dueDate/);
    const free = load(); free.conversations.find((row: any) => row.category === 'free-boundary').turns[0].expect.maxModelCalls = 1;
    assert.throws(() => validateWorkflowCorpus(free), /free_zero_model_refusal/);
    const mixed = load(); mixed.conversations.push({ ...mixed.conversations[0], id: 'mixed-paid-A', actors: [{ key: 'owner-a', company: 'A', role: 'OWNER', branchScope: 'all' }] });
    assert.throws(() => validateWorkflowCorpus(mixed), /MIXED_FREE_PAID_SEED:A/);
  });
  it('M-R14 retains all 20 knowledge/package conversations whole in the unchanged source corpora', async () => {
    const { createHash } = await import('node:crypto');
    const sourceHashes = {
      tuning: 'deaa8929da9b3b64ca9d66eed1a24ba5ff90d08384f76a547ceaa5423442430c',
      heldout: 'b283f988bea122e579302bafa0ac7665268a6bc04543c8e57d9e7fc92587af7e',
      sample: '7eafc96fc107176359dca7020bf12b49867407b22ae8f842ba3be65b1c6d035b',
    };
    const ids = [
      'T-120-b-staff-knowledge-vat','T-126-b-accountant-knowledge-vatregister','T-128-b-staff-knowledge-vatinout',
      'T-130-a-owner-outofpackage-invoice','T-131-b-manager-outofpackage-stock','T-132-a-accountant-outofpackage-sales',
      'T-133-b-owner-outofpackage-payroll','T-134-a-manager-outofpackage-bank','T-135-b-staff-outofpackage-po',
      'T-136-a-auditor-outofpackage-plreport','T-137-b-accountant-outofpackage-bankbalance','T-138-a-owner-outofpackage-receivable',
      'T-139-b-manager-outofpackage-wht','T-140-a-staff-outofpackage-stockmovement',
      'H-owner-outofpackage-invoice','H-manager-outofpackage-report','H-accountant-outofpackage-procurement','H-staff-outofpackage-stock',
      'H-auditor-general-vat','A-accountant-help-and-scope',
    ];
    const conversations = Object.entries(sourceHashes).flatMap(([name, expected]) => {
      const source = readFileSync(resolve(HERE, `corpus.${name}.json`), 'utf8');
      assert.equal(createHash('sha256').update(source).digest('hex'), expected, name);
      const corpus = JSON.parse(source); validateCorpus(corpus); return corpus.conversations;
    });
    for (const id of ids) assert.equal(conversations.filter((row: any) => row.id === id).length, 1, id);
  });
});

describe('M3 round 3 optional schema extensions', () => {
  const corpus = () => ({ version: 2, seed: 'r3', status: 'draft', conversations: [{ id: 'decline', category: 'expense', journeyKind: 'typed',
    actors: [{ key: 'owner', company: 'B', role: 'OWNER', branchScope: 'all' }], turns: [{ user: 'จ่ายรายการนี้', expect: { preview: { action: 'pay', target: '$seed:expense' } } }, { press: 'ไม่ทำ', expect: { label: 'ไม่ทำ' } }],
    tasks: [{ id: 'decline', kind: 'expense_pay', startTurn: 0, endTurn: 1, previewTurn: 0, goldTerminal: { effect: 'DECLINED', records: [] }, minimalTurns: 2, completable: true }] }] });
  it('allows an explicit preview turn only on DECLINED and requires its preview inside the task', () => {
    assert.doesNotThrow(() => validateWorkflowCorpus(corpus()));
    for (const value of [-1, 2, 0.5]) { const bad = corpus(); bad.conversations[0].tasks[0].previewTurn = value; assert.throws(() => validateWorkflowCorpus(bad), /previewTurn/); }
    const missing = corpus(); missing.conversations[0].turns[0].expect = {} as any; assert.throws(() => validateWorkflowCorpus(missing), /previewTurn/);
    const answered = corpus(); answered.conversations[0].tasks[0].goldTerminal.effect = 'ANSWERED'; assert.throws(() => validateWorkflowCorpus(answered), /previewTurn/);
    const unnamed = corpus(); delete (unnamed.conversations[0].tasks[0] as any).previewTurn; assert.throws(() => validateWorkflowCorpus(unnamed), /previewTurn_required/, 'a declined card needs its turn');
  });
  it('allows missing company/role only for unlinked actors and confines creator-only to paid B', () => {
    const unknown = corpus(); unknown.conversations[0].actors = [{ key: 'unknown', kind: 'unlinked' }] as any;
    assert.doesNotThrow(() => validateWorkflowCorpus(unknown));
    const ordinary = structuredClone(unknown); delete (ordinary.conversations[0].actors[0] as any).kind; assert.throws(() => validateWorkflowCorpus(ordinary), /actor_scope/);
    const extra = structuredClone(unknown); (extra.conversations[0].actors[0] as any).company = 'B'; assert.throws(() => validateWorkflowCorpus(extra), /unlinked/);
    const creator = corpus(); Object.assign(creator.conversations[0].actors[0], { kind: 'creator-only', role: 'STAFF' }); assert.doesNotThrow(() => validateWorkflowCorpus(creator));
    Object.assign(creator.conversations[0].actors[0], { freeSourceDrafts: true }); assert.throws(() => validateWorkflowCorpus(creator), /creator_only/);
  });
});

it('M3 round 3 preflight resolves unlinked actors without inventing tenant access', async () => {
  const { buildWorkflowSeed } = await import('./seed');
  const { validateWorkflowPreflight } = await import('./run-preflight');
  const actors = [{ key: 'new-line-user', kind: 'unlinked' }] as const;
  const corpus = { version: 2, seed: 'before-link', status: 'draft', conversations: [{ id: 'unlinked', category: 'boundary', journeyKind: 'typed', actors,
    turns: [{ user: 'สวัสดี', expect: { maxModelCalls: 0 } }], tasks: [] }] } as any;
  const now = new Date('2026-11-05T04:00:00Z'), seed = buildWorkflowSeed(now, [...actors]);
  assert.equal(validateWorkflowPreflight(corpus, seed, now).actorAssignments, 1);
  corpus.conversations[0].turns[0].expect.dueDate = { formType: 'PND3', monthOffset: 0 };
  assert.throws(() => validateWorkflowPreflight(corpus, seed, now), /UNLINKED_PRIVATE_GOLD/);
});

describe('permission-refusal workflow gold', () => {
  const refusal = { card: 'refusal', refusal: { reason: 'permission', wayOut: ['เจ้าของกิจการ'] } };
  const corpus = (kind: string, actor: Record<string, unknown> = { key: 'auditor', company: 'C', role: 'AUDITOR_READONLY', branchScope: 'all' }) => ({
    version: 2, seed: 'permission-gold', status: 'draft', conversations: [{ id: `permission-${kind}`, category: kind, journeyKind: 'typed', actors: [actor],
      tasks: [{ id: 'task', kind, startTurn: 0, endTurn: 0, minimalTurns: 1, completable: false, goldTerminal: { effect: 'REFUSED', records: [] } }],
      turns: [{ user: 'ทำรายการนี้', expect: structuredClone(refusal) }] }],
  });

  it('rejects the old auditor self-service refusals for claim, submit and own cancellation', async () => {
    const tuning = JSON.parse(readFileSync(resolve(HERE, 'corpus.workflow.tuning.json'), 'utf8'));
    const { FREE_EXPENSE_CHAT_REPLY } = await import('../../apps/api/src/modules/line-ai/domain/logic/free-expense-line.logic');
    const { scoreWorkflowAnswer } = await import('./scorer');
    for (const kind of ['reimbursement_claim', 'reimbursement_submit', 'reimbursement_cancel']) {
      const id = `M3-${kind}-permission`;
      const current = tuning.conversations.find((row: any) => row.id === id);
      assert.doesNotThrow(() => validateWorkflowCorpus({ ...tuning, conversations: [current] }));
      for (const turn of current.turns) {
        assert.equal(turn.expect.maxModelCalls, 0);
        assert.equal(turn.expect.refusal.reason, 'free');
        assert.equal(scoreWorkflowAnswer(turn.expect, { deliveredText: FREE_EXPENSE_CHAT_REPLY, calls: [] }).ok, true);
      }
      const old = structuredClone(current);
      old.actors = [{ key: 'auditor-c', company: 'C', role: 'AUDITOR_READONLY', branchScope: 'all' }];
      for (const turn of old.turns) {
        turn.expect.refusal = { reason: 'permission', wayOut: ['เจ้าของกิจการ', 'เปิดเว็บ'] };
        delete turn.expect.maxModelCalls;
        delete turn.expect.tags.must_mention_any;
      }
      assert.throws(() => validateWorkflowCorpus({ ...tuning, conversations: [old] }),
        new RegExp(`${id}.*turns\\[0\\].*permission_refusal_contradicts_grant`));
    }
  });

  it('accepts a record refusal when the role holds the permission but this record does not allow it', () => {
    const assigned = corpus('approvals', { key: 'manager', company: 'C', role: 'MANAGER', branchScope: 'all' });
    assert.throws(() => validateWorkflowCorpus(assigned), /permission_refusal_contradicts_grant:approvals/);
    (assigned.conversations[0].turns[0].expect.refusal as { reason: string }).reason = 'record';
    assert.doesNotThrow(() => validateWorkflowCorpus(assigned));
  });

  it('checks the acting actor on each refusal turn and skips kinds without one permission', () => {
    const valid = corpus('expense_confirm');
    assert.doesNotThrow(() => validateWorkflowCorpus(valid));
    valid.conversations[0].actors.push({ key: 'owner', company: 'C', role: 'OWNER', branchScope: 'all' });
    (valid.conversations[0].turns as any[]).push({ as: { key: 'owner' }, user: 'ยืนยันรายการนี้', expect: structuredClone(refusal) });
    valid.conversations[0].tasks[0].endTurn = 1;
    assert.throws(() => validateWorkflowCorpus(valid), /turns\[1\].*permission_refusal_contradicts_grant.*expense.confirm/);
    for (const kind of ['open', 'unclear'])
      assert.doesNotThrow(() => validateWorkflowCorpus(corpus(kind, { key: 'owner', company: 'C', role: 'OWNER', branchScope: 'all' })));
  });

  it('uses the creator-only seed role and package entitlement filtering', async () => {
    assert.doesNotThrow(() => validateWorkflowCorpus(corpus('reimbursement_claim', { key: 'creator', kind: 'creator-only', company: 'B', role: 'STAFF', branchScope: 'all' })));
    const { ROLE_GRANTS } = await import('../../apps/api/src/modules/auth/permission-registry');
    const { TIER_FEATURE_PRESETS } = await import('../../packages/contracts/src/menu-entitlements');
    const { filterPermissionsByEntitlement } = await import('../../apps/api/src/modules/employee-access/domain/logic/feature-gate.logic');
    assert.ok(ROLE_GRANTS.OWNER.includes('wht.certificate.issue'));
    assert.ok(!filterPermissionsByEntitlement([...ROLE_GRANTS.OWNER], new Set(TIER_FEATURE_PRESETS.STARTER_249)).includes('wht.certificate.issue'));
    assert.doesNotThrow(() => validateWorkflowCorpus(corpus('wht_certificate', { key: 'owner-a', company: 'A', role: 'OWNER', branchScope: 'all' })));
    assert.throws(() => validateWorkflowCorpus(corpus('wht_certificate', { key: 'owner-c', company: 'C', role: 'OWNER', branchScope: 'all' })), /permission_refusal_contradicts_grant/);
  });
});
