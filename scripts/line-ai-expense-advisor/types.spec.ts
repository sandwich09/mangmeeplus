import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { validateCorpus, validateWorkflowCorpus, flattenTurns, parseFailedConversationIds, selectConversations, type Corpus } from './types';

const HERE = dirname(fileURLToPath(import.meta.url));

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
    turns: [{ as: { key: 'owner' }, user: 'จ่ายรายการนี้', expect: {} }, { as: { key: 'owner' }, press: 'ยืนยัน', expect: { preview: { action: 'pay', target: '$seed:expense' } } }],
  }] };

  it('accepts company C, multiple actors, a press turn, and a paid record with amount, date and method', () => {
    assert.doesNotThrow(() => validateWorkflowCorpus(paid));
  });

  it('requires a confirmation turn and the matching preview on a write task', () => {
    const malformed = structuredClone(paid);
    delete malformed.conversations[0].tasks[0].confirmTurn;
    assert.throws(() => validateWorkflowCorpus(malformed), /confirmTurn_required/);
  });

  it('requires all paid-record fields and keeps the turn press-only without calls', () => {
    const malformed = structuredClone(paid);
    delete malformed.conversations[0].tasks[0].goldTerminal.records[0].paymentMethod;
    assert.throws(() => validateWorkflowCorpus(malformed), /paid_record_fields/);
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
