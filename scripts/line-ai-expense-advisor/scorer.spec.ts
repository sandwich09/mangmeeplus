import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  callMatchesGold, factInText, moneyTextVariants, scoreFacts, scoreTags, scoreToolCalls, scoreTurn, summarizeScores,
  type CapturedEvidence,
} from './scorer';
import { extractExpectedFacts, extractExpectedFactsForCall } from './oracle';
import type { Turn } from './types';

const NOW = new Date('2026-09-27T06:00:00.000Z'); // 13:00 Bangkok, 27 Sep 2026

function evidence(overrides: Partial<CapturedEvidence> = {}): CapturedEvidence {
  return { toolCalls: [], deliveredText: '', latencyMs: 1000, modelCalls: 1, costSatang: 50, ...overrides };
}

describe('moneyTextVariants', () => {
  it('formats a fractional amount with and without thousands separators', () => {
    assert.deepEqual(moneyTextVariants('21580.5').sort(), ['21,580.50', '21580.50'].sort());
  });

  it('adds a no-decimal form for a whole amount, matching the ".00 optional" rule', () => {
    const variants = moneyTextVariants(900);
    assert.ok(variants.includes('900.00'));
    assert.ok(variants.includes('900'));
  });

  it('does not add a no-decimal form for a fractional amount', () => {
    const variants = moneyTextVariants('152.50');
    assert.ok(!variants.includes('152'));
  });

  it('treats 0 / 0.00 / 0.0000 as the same value, any Thai-acceptable formatting', () => {
    for (const zero of [0, '0', '0.00', '0.0000']) {
      const variants = moneyTextVariants(zero);
      assert.ok(variants.includes('0.00'), `moneyTextVariants(${JSON.stringify(zero)}) should include '0.00'`);
      assert.ok(variants.includes('0'), `moneyTextVariants(${JSON.stringify(zero)}) should include '0'`);
    }
  });
});

describe('factInText', () => {
  it('finds a money fact via any accepted formatting', () => {
    assert.ok(factInText({ kind: 'money', value: '21580.50' }, 'ยอดรวมเดือนนี้ 21,580.50 บาท'));
    assert.ok(factInText({ kind: 'money', value: 900 }, 'มีค่าร่างรวม 900 บาท'));
  });

  it('does not find a fact that is genuinely absent', () => {
    assert.equal(factInText({ kind: 'money', value: '999.00' }, 'ยอดรวมเดือนนี้ 21,580.50 บาท'), false);
  });

  it('finds a count fact as a plain integer', () => {
    assert.ok(factInText({ kind: 'count', value: 12 }, 'มีทั้งหมด 12 รายการ'));
  });

  it('finds a required zero-valued money fact in any Thai-acceptable formatting', () => {
    assert.ok(factInText({ kind: 'money', value: '0.0000' }, 'ยอดคงเหลือ 0 บาท'));
    assert.ok(factInText({ kind: 'money', value: 0 }, 'ยอดคงเหลือ 0.00 บาท'));
  });
});

describe('scoreFacts', () => {
  it('passes when every fact is present and reports each miss otherwise', () => {
    const text = 'ยอดรวม 1,000.00 บาท จำนวน 5 รายการ';
    assert.equal(scoreFacts([{ kind: 'money', value: '1000.00' }, { kind: 'count', value: 5 }], text).ok, true);
    const result = scoreFacts([{ kind: 'money', value: '1000.00' }, { kind: 'count', value: 99 }], text);
    assert.equal(result.ok, false);
    assert.deepEqual(result.reasons, ['missing_fact:count:99']);
  });
});

describe('extractExpectedFacts: a correct zero never has to be spelled out', () => {
  it('drops a zero-valued money fact but keeps a non-zero count (reimbursement.get_summary)', () => {
    // "มี 2 รายการที่รออนุมัติ ... ยังไม่มีรายการที่อนุมัติแล้วรอจ่าย" is a correct, complete
    // answer that never writes a literal "0" for the unpaid total — requiring it was the bug.
    const facts = extractExpectedFacts('reimbursement.get_summary', { status: 'ok', data: { totalUnpaidAmount: '0.0000', pendingApprovalCount: 2 } });
    assert.deepEqual(facts, [{ kind: 'count', value: 2, label: 'pending_count' }]);
  });

  it('drops a zero-valued count fact for a shape whose primary metric is not that count (single_metric)', () => {
    const facts = extractExpectedFacts('expense.list_recent', { status: 'ok', data: { summary: { totalAmount: '500.00', countedItems: 0 } } });
    assert.deepEqual(facts, [{ kind: 'money', value: '500.00', label: 'total' }]);
  });

  it('keeps a zero count for pending_approvals, the one shape whose whole point IS that count', () => {
    const facts = extractExpectedFacts('reimbursement.list_pending_approvals', { status: 'ok', data: { total: 0, items: [] } });
    assert.deepEqual(facts, [{ kind: 'count', value: 0, label: 'count' }]);
  });

  it('drops a zero overall total from a breakdown, via extractExpectedFactsForCall', () => {
    const facts = extractExpectedFactsForCall('expense.get_breakdown', { status: 'ok', data: { totalAmount: 0, byCategory: [] } }, {});
    assert.deepEqual(facts, []);
  });
});

describe('callMatchesGold', () => {
  it('does not confuse a full calendar month (periodKey) with "up to today" (fromDate/toDate)', () => {
    const actual = { tool: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-27' } };
    const gold = { tool: 'expense.list_recent', input: { periodKey: '2026-09' } };
    // periodKey '2026-09' resolves to the FULL month (2026-09-01..2026-09-30), which is NOT the
    // same range as fromDate/toDate up to "today" (2026-09-27) — this must NOT match.
    assert.equal(callMatchesGold(actual, gold, NOW), false);
  });

  it('treats an explicit fromDate/toDate and the equivalent periodKey as the same call', () => {
    const actual = { tool: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-30' } };
    const gold = { tool: 'expense.list_recent', input: { periodKey: '2026-09' } };
    assert.equal(callMatchesGold(actual, gold, NOW), true);
  });

  it('treats an omitted period as the tool default, matching this_month_to_date explicitly sent', () => {
    const actual = { tool: 'expense.list_recent', input: { documentStatus: 'CONFIRMED' } };
    const gold = { tool: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-27', documentStatus: 'CONFIRMED' } };
    assert.equal(callMatchesGold(actual, gold, NOW), true);
  });

  it('ignores a field gold does not mention (permissive toward extra filters)', () => {
    const actual = { tool: 'expense.list_recent', input: { branchId: 'branch-a-1' } };
    const gold = { tool: 'expense.list_recent', input: {} };
    assert.equal(callMatchesGold(actual, gold, NOW), true);
  });

  it('rejects a mismatched tool name even with identical input', () => {
    const actual = { tool: 'expense.get_breakdown', input: { documentStatus: 'CONFIRMED' } };
    const gold = { tool: 'expense.list_recent', input: { documentStatus: 'CONFIRMED' } };
    assert.equal(callMatchesGold(actual, gold, NOW), false);
  });

  it('rejects a mismatched filter value', () => {
    const actual = { tool: 'expense.list_recent', input: { paymentStatus: 'PAID' } };
    const gold = { tool: 'expense.list_recent', input: { paymentStatus: 'UNPAID' } };
    assert.equal(callMatchesGold(actual, gold, NOW), false);
  });

  describe('category/vendor/branch names: judged by what the API resolved, not by raw text', () => {
    it('matches when gold used a name and the model used the id, but both resolved to the same category', () => {
      const gold = { tool: 'expense.list_recent', input: { categoryName: 'น้ำมัน' }, result: { status: 'ok', data: { queryApplied: { filters: { categoryId: 'category-a-fuel' } } } } };
      const actual = { tool: 'expense.list_recent', input: { categoryId: 'category-a-fuel' }, result: { status: 'ok', data: { queryApplied: { filters: { categoryId: 'category-a-fuel' } } } } };
      assert.equal(callMatchesGold(actual, gold, NOW), true);
    });

    it('rejects two different paraphrases that resolved to different categories', () => {
      const gold = { tool: 'expense.list_recent', input: { categoryName: 'ค่าน้ำมัน' }, result: { status: 'ok', data: { queryApplied: { filters: { categoryId: 'category-a-fuel' } } } } };
      const actual = { tool: 'expense.list_recent', input: { categoryName: 'ค่าออฟฟิศ' }, result: { status: 'ok', data: { queryApplied: { filters: { categoryId: 'category-a-office' } } } } };
      assert.equal(callMatchesGold(actual, gold, NOW), false);
    });

    it('matches a branch given by name against a branch given by id once both resolved the same branchId', () => {
      const gold = { tool: 'expense.get_breakdown', input: { branchId: 'สาขาสีลม' }, result: { status: 'ok', data: { queryApplied: { branch: { branchId: 'branch-b-2' } } } } };
      const actual = { tool: 'expense.get_breakdown', input: { branchId: 'branch-b-2' }, result: { status: 'ok', data: { queryApplied: { branch: { branchId: 'branch-b-2' } } } } };
      assert.equal(callMatchesGold(actual, gold, NOW), true);
    });

    it('matches when both sides came back ambiguous, comparing the outcome kind rather than an id', () => {
      const gold = { tool: 'expense.list_recent', input: { vendorName: 'สมใจ' }, result: { status: 'ok', data: { vendorAmbiguous: 'สมใจ', availableVendors: [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }] } } };
      const actual = { tool: 'expense.list_recent', input: { vendorName: 'สมใจ' }, result: { status: 'ok', data: { vendorAmbiguous: 'สมใจ', availableVendors: [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }] } } };
      assert.equal(callMatchesGold(actual, gold, NOW), true);
    });

    it('rejects gold ambiguous against actual resolved (different outcome kinds)', () => {
      const gold = { tool: 'expense.list_recent', input: { vendorName: 'สมใจ' }, result: { status: 'ok', data: { vendorAmbiguous: 'สมใจ', availableVendors: [] } } };
      const actual = { tool: 'expense.list_recent', input: { vendorId: 'v1' }, result: { status: 'ok', data: { queryApplied: { filters: { vendorId: 'v1' } } } } };
      assert.equal(callMatchesGold(actual, gold, NOW), false);
    });

    it('falls back to raw text comparison when neither side has a result (e.g. a bare unit test)', () => {
      const gold = { tool: 'expense.list_recent', input: { categoryId: 'category-a-fuel' } };
      const actualMatch = { tool: 'expense.list_recent', input: { categoryId: 'category-a-fuel' } };
      const actualMismatch = { tool: 'expense.list_recent', input: { categoryId: 'category-a-office' } };
      assert.equal(callMatchesGold(actualMatch, gold, NOW), true);
      assert.equal(callMatchesGold(actualMismatch, gold, NOW), false);
    });
  });
});

describe('scoreToolCalls', () => {
  it('passes when every gold call is satisfied, in any order', () => {
    const gold = [
      { tool: 'expense.list_recent', input: { documentStatus: 'CONFIRMED' } },
      { tool: 'expense.get_breakdown', input: {} },
    ];
    const actual = [
      { tool: 'expense.get_breakdown', input: { branchId: 'branch-a-1' } },
      { tool: 'expense.list_recent', input: { documentStatus: 'CONFIRMED' } },
    ];
    assert.equal(scoreToolCalls(gold, actual, NOW).ok, true);
  });

  it('accepts an alternative call in place of the primary one', () => {
    const gold = [{ tool: 'expense.get_detail', input: { expenseId: 'expense-1' }, alternatives: [{ tool: 'expense.get_detail', input: { expenseId: 'expense-1', locale: 'th' } }] }];
    const actual = [{ tool: 'expense.get_detail', input: { expenseId: 'expense-1', locale: 'th' } }];
    assert.equal(scoreToolCalls(gold, actual, NOW).ok, true);
  });

  it('fails and names the missing call when a gold call was never made', () => {
    const result = scoreToolCalls([{ tool: 'reimbursement.get_summary', input: {} }], [], NOW);
    assert.equal(result.ok, false);
    assert.equal(result.reasons.length, 1);
    assert.match(result.reasons[0]!, /reimbursement\.get_summary/);
  });

  it('threads goldResults[i] through to the matching name-based gold call at that index', () => {
    const gold = [{ tool: 'expense.list_recent', input: { categoryName: 'น้ำมัน' } }];
    const goldResults = [{ status: 'ok', data: { queryApplied: { filters: { categoryId: 'category-a-fuel' } } } }];
    const actual = [{ tool: 'expense.list_recent', input: { categoryId: 'category-a-fuel' }, result: { status: 'ok', data: { queryApplied: { filters: { categoryId: 'category-a-fuel' } } } } }];
    assert.equal(scoreToolCalls(gold, actual, NOW, goldResults).ok, true);
  });
});

describe('scoreTags', () => {
  it('passes a well-behaved no_tool/must_answer turn', () => {
    const result = scoreTags({ no_tool: true, must_answer: true }, evidence({ deliveredText: 'ถ่ายใบเสร็จให้ชัด แล้วส่งเข้าแชทได้เลยค่ะ' }));
    assert.equal(result.ok, true);
  });

  it('flags a tool call when no_tool is required', () => {
    const result = scoreTags({ no_tool: true }, evidence({ toolCalls: [{ tool: 'expense.list_recent', input: {} }] }));
    assert.equal(result.ok, false);
    assert.match(result.reasons[0]!, /no_tool_violated/);
  });

  it('flags an empty reply when must_answer is required', () => {
    assert.equal(scoreTags({ must_answer: true }, evidence({ deliveredText: '' })).ok, false);
  });

  it('flags a canned refusal when must_not_refuse is required', () => {
    const result = scoreTags({ must_not_refuse: true }, evidence({ deliveredText: 'ขอโทษค่ะ น้องมั่งมียังไม่แน่ใจว่าหมายถึงอะไร' }));
    assert.equal(result.ok, false);
  });

  it('requires at least one of must_mention_any', () => {
    assert.equal(scoreTags({ must_mention_any: ['แพ็กเกจ', 'รายจ่าย'] }, evidence({ deliveredText: 'ตอนนี้ช่วยเรื่องแพ็กเกจไม่ได้ค่ะ' })).ok, true);
    assert.equal(scoreTags({ must_mention_any: ['แพ็กเกจ', 'รายจ่าย'] }, evidence({ deliveredText: 'ไม่แน่ใจค่ะ' })).ok, false);
  });

  it('fails on a must_not_claim phrase actually present', () => {
    assert.equal(scoreTags({ must_not_claim: ['จ่ายครบแล้ว'] }, evidence({ deliveredText: 'รายการนี้จ่ายครบแล้วค่ะ' })).ok, false);
  });

  it('fails when a forbidden tool was called', () => {
    const result = scoreTags({ forbidden_tools: ['sales.get_sales_summary'] }, evidence({ toolCalls: [{ tool: 'sales.get_sales_summary', input: {} }] }));
    assert.equal(result.ok, false);
  });

  describe('must_ask_choice', () => {
    const offeredChoices = ['ร้านสมใจ', 'ร้านสมใจการค้า'];

    it('passes when the reply names at least two offered choices and asks which one', () => {
      const result = scoreTags({ must_ask_choice: true }, evidence({
        offeredChoices, deliveredText: 'หมายถึงร้านสมใจ หรือร้านสมใจการค้าคะ หมายถึงร้านไหนคะ',
      }));
      assert.equal(result.ok, true);
    });

    it('fails when fewer than 2 offered choices are named', () => {
      const result = scoreTags({ must_ask_choice: true }, evidence({ offeredChoices, deliveredText: 'หมายถึงร้านสมใจใช่ไหมคะ หมายถึงร้านไหนคะ' }));
      assert.equal(result.ok, false);
      assert.match(result.reasons[0]!, /fewer_than_2_names_mentioned/);
    });

    it('fails when no question marker is present even though both names are mentioned', () => {
      const result = scoreTags({ must_ask_choice: true }, evidence({ offeredChoices, deliveredText: 'มีร้านสมใจ และร้านสมใจการค้า สองร้านค่ะ' }));
      assert.equal(result.ok, false);
      assert.match(result.reasons[0]!, /no_question_marker/);
    });
  });
});

describe('scoreTurn', () => {
  const ctx = { conversationId: 'conv-1', turnIndex: 0 };

  it('passes a data turn whose call and facts both match', () => {
    const turn: Turn = { user: 'เดือนนี้จ่ายไปเท่าไหร่', category: '1', expect: { calls: [{ tool: 'expense.list_recent', input: { period: { $period: 'this_month_to_date' } } }] } };
    const result = scoreTurn(ctx, turn, evidence({ toolCalls: [{ tool: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-27' } }], deliveredText: 'เดือนนี้จ่ายไป 1,200.00 บาทค่ะ' }), [{ kind: 'money', value: '1200.00' }], NOW);
    assert.equal(result.passed, true);
  });

  it('fails a data turn when the fact is missing from the reply even though the call matched', () => {
    const turn: Turn = { user: 'เดือนนี้จ่ายไปเท่าไหร่', category: '1', expect: { calls: [{ tool: 'expense.list_recent', input: {} }] } };
    const result = scoreTurn(ctx, turn, evidence({ toolCalls: [{ tool: 'expense.list_recent', input: {} }], deliveredText: 'เดี๋ยวเช็คให้ค่ะ' }), [{ kind: 'money', value: '1200.00' }], NOW);
    assert.equal(result.passed, false);
    assert.ok(result.reasons.some((reason) => reason.startsWith('missing_fact')));
  });

  it('scores a tag-only turn without needing any tool call or facts', () => {
    const turn: Turn = { user: 'สวัสดีค่ะ', category: '19', expect: { tags: { no_tool: true, must_answer: true } } };
    const result = scoreTurn(ctx, turn, evidence({ deliveredText: 'สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ' }), [], NOW);
    assert.equal(result.passed, true);
  });
});

describe('summarizeScores', () => {
  it('aggregates pass counts by category and lists failures', () => {
    const scores = [
      { conversationId: 'a', turnIndex: 0, category: '1', passed: true, reasons: [] },
      { conversationId: 'a', turnIndex: 1, category: '1', passed: false, reasons: ['missing_fact:money:1'] },
      { conversationId: 'b', turnIndex: 0, category: '19', passed: true, reasons: [] },
    ];
    const summary = summarizeScores(scores);
    assert.equal(summary.total, 3);
    assert.equal(summary.passed, 2);
    assert.equal(summary.failed, 1);
    assert.deepEqual(summary.byCategory['1'], { total: 2, passed: 1 });
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0]!.conversationId, 'a');
  });
});
