import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { validateCorpus, flattenTurns, type Corpus } from './types';

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
        { user: 'y', category: '5', expect: { calls: [{ tool: 'expense.get_breakdown', input: {}, answerShape: 'breakdown', groupBy: 'vendor' }] } }],
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
