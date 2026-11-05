import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  callMatchesGold, factInText, factsForMatchedCandidate, moneyTextVariants, scoreFacts, scoreMachineTokens, scoreTags, scoreToolCalls, scoreTurn, summarizeScores,
  providerCostExact, classifyCacheState, scoreWorkflowTask, selectLatestCompleteAttempt, workflowAttemptCostTotal, scoreWorkflowCorpus,
  type CapturedEvidence, type ExpectedFact,
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

describe('workflow measurement M1b', () => {
  it('computes every tariff part exactly, then checks the paired HALF_UP satang total', () => {
    const cost = providerCostExact({
      tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, externalUnits: 1,
      tariff: { usdPerMTok: { input: 0.5, output: 0, cacheRead: 0, cacheWrite: 0 }, thbPerUsd: 30,
        externalUsdPerUnit: 0.002, searchContentInputTokensPerUnit: 2000 },
      recordedCostSatang: 9,
    });
    assert.equal(cost.exactSatang, '9.0015');
    assert.equal(cost.roundedSatang, 9);
    assert.equal(cost.roundingMatches, true);
  });

  it('separates cache cohorts and treats collectionState as non-business for M-R6', () => {
    assert.equal(classifyCacheState({ cacheRead: 0, cacheWrite: 12 }), 'cold');
    assert.equal(classifyCacheState({ cacheRead: 12, cacheWrite: 0 }), 'warm');
    assert.equal(classifyCacheState({ cacheRead: 12, cacheWrite: 2 }), 'mixed');
    const task = { id: 'draft', kind: 'reimbursement', startTurn: 0, endTurn: 2, confirmTurn: 2,
      goldTerminal: { effect: 'REIMBURSEMENT_DRAFT_SAVED', records: [] }, minimalTurns: 2, completable: true } as any;
    const scores = scoreWorkflowTask(task, [{ turnIndex: 1, businessSnapshot: { business: {}, collectionState: { ReimbursementDraftAction: [{ id: 'a', status: 'COLLECTING' }] } }, unintendedEffects: [] }]);
    assert.equal(scores.wrongApplied, 0);
    assert.equal(scores.wrongPreview, 0);
  });

  it('scores only the latest complete attempt while keeping spend from every attempt', () => {
    const attempts = [
      { attemptId: 'a1', complete: false, providerCostExact: '4.25' },
      { attemptId: 'a2', complete: true, providerCostExact: '2.10' },
      { attemptId: 'a3', complete: true, providerCostExact: '3.20' },
    ];
    assert.equal(selectLatestCompleteAttempt(attempts)?.attemptId, 'a3');
    assert.equal(workflowAttemptCostTotal(attempts), '9.55');
  });

  it('counts every typed attempt in W13 and excludes button-only conversations', () => {
    const corpus = { version: 2, seed: 'x', status: 'draft', conversations: [
      { id: 'typed', category: 'expense', journeyKind: 'typed', actors: [], tasks: [], turns: [] },
      { id: 'button', category: 'expense', journeyKind: 'button', actors: [], tasks: [], turns: [] },
    ] } as any;
    const call = (providerCostExact: string) => ({ tag: 'classifier', modelId: 'm', ok: true, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, providerCostExact });
    const turn = (conversationId: string, calls: any[]) => ({ attemptId: 'a', conversationId, turnIndex: 0, actorKey: 'owner', inputKind: 'message', calls, effects: [],
      businessSnapshot: { business: {}, collectionState: {} }, unintendedEffects: [], deliveredActions: [], latencyMs: null });
    const metrics = scoreWorkflowCorpus({ corpus, attempts: [
      { attemptId: 'failed', conversationId: 'typed', complete: false, turns: [turn('typed', [call('1')])] },
      { attemptId: 'complete', conversationId: 'typed', complete: true, turns: [turn('typed', [call('2')])] },
      { attemptId: 'button', conversationId: 'button', complete: true, turns: [turn('button', [call('8')])] },
    ] as any });
    assert.equal(metrics.W13.candidateExact, '3');
    assert.equal(metrics.attemptSpendExact, '11');
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

  describe('status: the plain-verb AND the contracts wording are both accepted (task item 2)', () => {
    it('UNPAID: ยังไม่จ่าย / ยังไม่ชำระ / ค้างจ่าย / ค้างชำระ', () => {
      const fact: ExpectedFact = { kind: 'status', value: ['ยังไม่จ่าย', 'ยังไม่ชำระ', 'ค้างจ่าย', 'ค้างชำระ'] };
      assert.ok(factInText(fact, 'สถานะ: ยังไม่จ่าย'));
      assert.ok(factInText(fact, 'สถานะการชำระ: ยังไม่ชำระ'));
      assert.ok(factInText(fact, 'ยังค้างจ่ายอยู่ค่ะ'));
      assert.ok(factInText(fact, 'ค้างชำระอยู่นะคะ'));
      assert.equal(factInText(fact, 'จ่ายแล้วค่ะ'), false);
    });

    it('PAID: จ่ายแล้ว / ชำระแล้ว', () => {
      const fact: ExpectedFact = { kind: 'status', value: ['จ่ายแล้ว', 'ชำระแล้ว'] };
      assert.ok(factInText(fact, 'รายการนี้จ่ายแล้วค่ะ'));
      assert.ok(factInText(fact, 'ชำระแล้วเรียบร้อยค่ะ'));
    });

    it('PARTIALLY_PAID: จ่ายบางส่วน / ชำระบางส่วน', () => {
      const fact: ExpectedFact = { kind: 'status', value: ['จ่ายบางส่วน', 'ชำระบางส่วน'] };
      assert.ok(factInText(fact, 'จ่ายบางส่วนแล้วค่ะ'));
      assert.ok(factInText(fact, 'ชำระบางส่วนแล้วค่ะ'));
    });

    it('NEEDS_REVIEW: รอตรวจ / รอตรวจสอบ', () => {
      const fact: ExpectedFact = { kind: 'status', value: ['รอตรวจ', 'รอตรวจสอบ'] };
      assert.ok(factInText(fact, 'อยู่ระหว่างรอตรวจค่ะ'));
      assert.ok(factInText(fact, 'รอตรวจสอบอยู่ค่ะ'));
    });

    it('DRAFT: ร่าง / ฉบับร่าง', () => {
      const fact: ExpectedFact = { kind: 'status', value: ['ร่าง', 'ฉบับร่าง'] };
      assert.ok(factInText(fact, 'ยังเป็นร่างอยู่ค่ะ'));
      assert.ok(factInText(fact, 'เป็นฉบับร่างค่ะ'));
    });

    it('CONFIRMED: ยืนยันแล้ว', () => {
      assert.ok(factInText({ kind: 'status', value: ['ยืนยันแล้ว'] }, 'รายการนี้ยืนยันแล้วค่ะ'));
    });

    it('fails when none of the synonyms are present', () => {
      assert.equal(factInText({ kind: 'status', value: ['จ่ายแล้ว', 'ชำระแล้ว'] }, 'ยังไม่ชำระค่ะ'), false);
    });
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
    assert.deepEqual(facts, [{ kind: 'count', value: 2, label: 'pending_count', category: 'count' }]);
  });

  it('drops a zero-valued count fact for a shape whose primary metric is not that count (single_metric)', () => {
    const facts = extractExpectedFacts('expense.list_recent', { status: 'ok', data: { summary: { totalAmount: '500.00', countedItems: 0 } } });
    assert.deepEqual(facts, [{ kind: 'money', value: '500.00', label: 'total', category: 'total' }]);
  });

  it('keeps a zero count for pending_approvals, the one shape whose whole point IS that count', () => {
    const facts = extractExpectedFacts('reimbursement.list_pending_approvals', { status: 'ok', data: { total: 0, items: [] } });
    assert.deepEqual(facts, [{ kind: 'count', value: 0, label: 'count', category: 'count' }]);
  });

  it('drops a zero overall total from a breakdown, via extractExpectedFactsForCall', () => {
    const facts = extractExpectedFactsForCall('expense.get_breakdown', { status: 'ok', data: { totalAmount: 0, byCategory: [] } }, {});
    assert.deepEqual(facts, []);
  });
});

describe('callMatchesGold', () => {
  it('treats a CURRENT-month periodKey and "up to today" as equivalent — no future-dated data exists (task item 3)', () => {
    const actual = { tool: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-27' } };
    const gold = { tool: 'expense.list_recent', input: { periodKey: '2026-09' } };
    // periodKey '2026-09' resolves to the FULL month (2026-09-01..2026-09-30); NOW is 27 Sep 2026,
    // so "the whole month" and "the month so far" return identical rows today — this DOES match.
    assert.equal(callMatchesGold(actual, gold, NOW), true);
  });

  it('does NOT relax a PAST month: a genuinely truncated range still fails', () => {
    const actual = { tool: 'expense.list_recent', input: { fromDate: '2026-08-01', toDate: '2026-08-27' } };
    const gold = { tool: 'expense.list_recent', input: { periodKey: '2026-08' } };
    // August 2026 is already fully elapsed by NOW (27 Sep 2026) — periodKey resolves to its full
    // range 2026-08-01..2026-08-31, and a call that stops at the 27th is missing real data, not
    // "no future data yet". The relaxation above only ever applies to the CURRENT month.
    assert.equal(callMatchesGold(actual, gold, NOW), false);
  });

  it('prefers the tool\'s own resolved queryApplied.period over re-deriving one client-side', () => {
    const period = { startDate: '2026-09-01', endDate: '2026-09-27' };
    const actual = {
      tool: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-27' },
      result: { status: 'ok', data: { queryApplied: { period } } },
    };
    const gold = {
      tool: 'expense.list_recent', input: { periodKey: '2026-09' },
      result: { status: 'ok', data: { queryApplied: { period } } },
    };
    assert.equal(callMatchesGold(actual, gold, NOW), true);
  });

  it('queryApplied.period mismatch fails even when the raw inputs look alike', () => {
    const actual = {
      // A different START date is never relaxed (D1 only relaxes a truncated END date within the
      // current month) — this still proves a genuinely different resolved range fails, even though
      // both sides' raw input is the identical periodKey "2026-09".
      tool: 'expense.list_recent', input: { periodKey: '2026-09' },
      result: { status: 'ok', data: { queryApplied: { period: { startDate: '2026-09-05', endDate: '2026-09-27' } } } },
    };
    const gold = {
      tool: 'expense.list_recent', input: { periodKey: '2026-09' },
      result: { status: 'ok', data: { queryApplied: { period: { startDate: '2026-09-01', endDate: '2026-09-30' } } } },
    };
    assert.equal(callMatchesGold(actual, gold, NOW), false);
  });

  it('D1: the current-month relaxation also applies once BOTH sides have a captured queryApplied.period', () => {
    // Gold ran list_recent explicitly bounded to today (month-to-date); actual ran get_breakdown
    // with periodKey "2026-09", which the API resolved to the FULL month — no future-dated data
    // exists, so these queried identical rows today (T-009-a t0/t1/t2, T-052-a t0). Before D1 this
    // failed because callMatchesGold compared the two RESOLVED endDates for exact equality.
    const actual = {
      tool: 'expense.get_breakdown', input: { periodKey: '2026-09' },
      result: { status: 'ok', data: { queryApplied: { period: { startDate: '2026-09-01', endDate: '2026-09-30' } } } },
    };
    const gold = {
      tool: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-27' },
      result: { status: 'ok', data: { queryApplied: { period: { startDate: '2026-09-01', endDate: '2026-09-27' } } } },
    };
    assert.equal(callMatchesGold(actual, gold, NOW), true);
  });

  it('D1: a genuinely truncated PAST month still fails on the RESOLVED path too', () => {
    // Mirrors the raw-input "does NOT relax a PAST month" case above, but with both queryApplied
    // periods captured — August 2026 is already fully elapsed by NOW (27 Sep 2026), so a truncated
    // August range is missing real data, not "no future data yet", on either comparison path.
    const actual = {
      tool: 'expense.get_breakdown', input: { periodKey: '2026-08' },
      result: { status: 'ok', data: { queryApplied: { period: { startDate: '2026-08-01', endDate: '2026-08-27' } } } },
    };
    const gold = {
      tool: 'expense.get_breakdown', input: { periodKey: '2026-08' },
      result: { status: 'ok', data: { queryApplied: { period: { startDate: '2026-08-01', endDate: '2026-08-31' } } } },
    };
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

  describe('T-068: a gold call\'s expenseId must be RESOLVED before scoring, never the raw marker', () => {
    // "รายการที่ 3 คือร้านอะไร" — the model correctly called get_detail on the 3rd shown item.
    const actual = [{ tool: 'expense.get_detail', input: { expenseId: 'expense-company-a-13' } }];

    it('fails to match an unresolved { $fromShownItems } marker object (String(obj) is "[object Object]") — the bug', () => {
      const gold = [{ tool: 'expense.get_detail', input: { expenseId: { $fromShownItems: 2 } } }];
      assert.equal(scoreToolCalls(gold, actual, NOW).ok, false);
    });

    it('matches once the marker has been resolved to the same id the model used — the fix (run-real.ts scores resolvedCallsByTurn, never turn.expect.calls verbatim)', () => {
      const gold = [{ tool: 'expense.get_detail', input: { expenseId: 'expense-company-a-13' } }];
      assert.equal(scoreToolCalls(gold, actual, NOW).ok, true);
    });
  });

  describe('expense.get_breakdown as an equivalent tool for an expense.list_recent total', () => {
    const gold = [{ tool: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-27' } }];
    const goldResults = [{ status: 'ok', data: { summary: { totalAmount: '1500.00', countedItems: 3 } } }];

    it('accepts it when the period/filters match and the reply states the gold total', () => {
      const actual = [{ tool: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-27' } }];
      const deliveredText = 'เดือนนี้จ่ายไปทั้งหมด 1,500.00 บาท แยกตามหมวดได้ดังนี้ ค่าน้ำมัน 500 บาท';
      assert.equal(scoreToolCalls(gold, actual, NOW, goldResults, deliveredText).ok, true);
    });

    it('rejects it when the reply never actually states the gold total', () => {
      const actual = [{ tool: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-27' } }];
      const deliveredText = 'แยกตามหมวดได้ดังนี้ ค่าน้ำมัน 500 บาท ค่าออฟฟิศ 300 บาท';
      assert.equal(scoreToolCalls(gold, actual, NOW, goldResults, deliveredText).ok, false);
    });

    it('rejects it when its period does not resolve to the same range as gold', () => {
      const actual = [{ tool: 'expense.get_breakdown', input: { periodKey: '2026-08' } }];
      const deliveredText = 'เดือนนี้จ่ายไปทั้งหมด 1,500.00 บาท';
      assert.equal(scoreToolCalls(gold, actual, NOW, goldResults, deliveredText).ok, false);
    });

    it('is not reversible: a get_breakdown gold call is never satisfied by a plain list_recent call', () => {
      const breakdownGold = [{ tool: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-27' } }];
      const breakdownGoldResults = [{ status: 'ok', data: { totalAmount: '1500.00', byCategory: [] } }];
      const actual = [{ tool: 'expense.list_recent', input: { fromDate: '2026-09-01', toDate: '2026-09-27' } }];
      const deliveredText = 'เดือนนี้จ่ายไปทั้งหมด 1,500.00 บาท';
      assert.equal(scoreToolCalls(breakdownGold, actual, NOW, breakdownGoldResults, deliveredText).ok, false);
    });

    it('does not apply when list_recent asked for a "list" shape rather than a total', () => {
      const listShapeGold = [{ ...gold[0]!, answerShape: 'list' as const }];
      const actual = [{ tool: 'expense.get_breakdown', input: { fromDate: '2026-09-01', toDate: '2026-09-27' } }];
      const deliveredText = 'ยอดรวม 1,500.00 บาท';
      assert.equal(scoreToolCalls(listShapeGold, actual, NOW, goldResults, deliveredText).ok, false);
    });
  });

  describe('expense.get_breakdown as an equivalent tool for an ambiguous/unresolved name (task item D2)', () => {
    // T-063-b: "เดือนนี้จ่ายสมใจไปเท่าไหร่คะ" — gold's own vendorName resolution came back ambiguous,
    // so there is no total (goldTotalAmountFact is null) for the reply to state at all; the
    // clarifying question itself is checked separately by the turn's own must_ask_choice tag.
    const ambiguousVendor = { vendorAmbiguous: 'สมใจ', availableVendors: [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }] };
    const gold = [{ tool: 'expense.list_recent', input: { vendorName: 'สมใจ', fromDate: '2026-09-01', toDate: '2026-09-27' } }];
    const goldResults = [{ status: 'ok', data: { ...ambiguousVendor, queryApplied: { period: { startDate: '2026-09-01', endDate: '2026-09-27' } } } }];

    it('accepts a get_breakdown call whose resolution outcome matches gold\'s (never on a total that does not exist)', () => {
      const actual = [{
        tool: 'expense.get_breakdown', input: { vendorName: 'สมใจ', fromDate: '2026-09-01', toDate: '2026-09-27' },
        result: { status: 'ok', data: { ...ambiguousVendor, queryApplied: { period: { startDate: '2026-09-01', endDate: '2026-09-27' } } } },
      }];
      const deliveredText = 'หมายถึงร้านไหนคะ ร้านสมใจ, ร้านสมใจการค้า';
      assert.equal(scoreToolCalls(gold, actual, NOW, goldResults, deliveredText).ok, true);
    });

    it('still rejects a get_breakdown call that resolved DIFFERENTLY (resolved id vs ambiguous)', () => {
      const actual = [{
        tool: 'expense.get_breakdown', input: { vendorId: 'v1', fromDate: '2026-09-01', toDate: '2026-09-27' },
        result: { status: 'ok', data: { queryApplied: { filters: { vendorId: 'v1' }, period: { startDate: '2026-09-01', endDate: '2026-09-27' } } } },
      }];
      assert.equal(scoreToolCalls(gold, actual, NOW, goldResults, '').ok, false);
    });
  });
});

describe('factsForMatchedCandidate', () => {
  // T-101: "เดือนนี้มีรายการค้างจัดการเยอะไหมคะ" legitimately means drafts OR needs-review.
  const call = {
    tool: 'expense.list_recent',
    input: { period: { $period: 'this_month_to_date' }, documentStatus: 'DRAFT' },
    alternatives: [{ tool: 'expense.list_recent', input: { period: { $period: 'this_month_to_date' }, documentStatus: 'NEEDS_REVIEW' } }],
  };
  const draftFacts: ExpectedFact[] = [{ kind: 'money', value: '500.00', label: 'total' }, { kind: 'count', value: 2, label: 'count' }];
  const needsReviewFacts: ExpectedFact[] = [{ kind: 'money', value: '900.00', label: 'total' }, { kind: 'count', value: 3, label: 'count' }];
  const candidates = [
    { tool: 'expense.list_recent', input: { documentStatus: 'DRAFT' }, facts: draftFacts },
    { tool: 'expense.list_recent', input: { documentStatus: 'NEEDS_REVIEW' }, facts: needsReviewFacts },
  ];

  it('checks the PRIMARY\'s facts when the model called the primary interpretation (DRAFT)', () => {
    const actual = [{ tool: 'expense.list_recent', input: { documentStatus: 'DRAFT' } }];
    assert.deepEqual(factsForMatchedCandidate(call, candidates, actual, NOW), draftFacts);
  });

  it('checks the ALTERNATIVE\'s facts when the model called that interpretation (NEEDS_REVIEW) instead', () => {
    const actual = [{ tool: 'expense.list_recent', input: { documentStatus: 'NEEDS_REVIEW' } }];
    assert.deepEqual(factsForMatchedCandidate(call, candidates, actual, NOW), needsReviewFacts);
  });

  it('falls back to the primary\'s facts when neither candidate matches (a genuinely wrong call)', () => {
    const actual = [{ tool: 'expense.list_recent', input: { documentStatus: 'CONFIRMED' } }];
    assert.deepEqual(factsForMatchedCandidate(call, candidates, actual, NOW), draftFacts);
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

  // UAT 2026-09-29: "สวัสดีจ้า" got the general fallback and a non-empty stock line used to pass must_answer.
  it('flags a stock non-answer, like the general fallback, when must_answer is required', () => {
    const result = scoreTags({ no_tool: true, must_answer: true },
      evidence({ deliveredText: 'ขอโทษค่ะ น้องมั่งมียังตอบข้อนี้ไม่ได้ ลองพิมพ์ถามอีกครั้งได้เลยนะคะ' }));
    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes('must_answer_violated:stock_non_answer'));
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

describe('scoreMachineTokens (task item D3)', () => {
  it('passes ordinary Thai text, including a money amount', () => {
    assert.equal(scoreMachineTokens('เดือนนี้จ่ายไป 1,200.00 บาทค่ะ').ok, true);
  });

  it('flags markdown: bold, a table, a heading, and a code block', () => {
    assert.deepEqual(scoreMachineTokens('ปกติ **หนาว** นะคะ').reasons, ['machine_token:markdown']);
    assert.deepEqual(scoreMachineTokens('| หมวด | จำนวนเงิน | สัดส่วน |\n|---|---|---|').reasons, ['machine_token:markdown']);
    assert.deepEqual(scoreMachineTokens('# หัวข้อ').reasons, ['machine_token:markdown']);
    assert.deepEqual(scoreMachineTokens('```code```').reasons, ['machine_token:markdown']);
  });

  it('does not mistake a pipe-separated line that neither starts nor ends with | for a table', () => {
    // Real run-4 example: no leading/trailing "|", so this is NOT the table shape — it is still
    // flagged, but only for its internal keys and ISO dates below, never for markdown.
    const result = scoreMachineTokens('expense_total: 3367 THB | expense_incurred_date | exclude_rejected_voided | 2026-09-01 ถึง 2026-09-28');
    assert.ok(!result.reasons.includes('machine_token:markdown'));
  });

  it('flags internal keys and ISO dates together, one reason per kind (real run-4 example)', () => {
    const result = scoreMachineTokens('expense_total: 3367 THB | expense_incurred_date | exclude_rejected_voided | 2026-09-01 ถึง 2026-09-28');
    assert.equal(result.ok, false);
    assert.deepEqual(result.reasons.sort(), ['machine_token:internal_key', 'machine_token:iso_date']);
  });

  it('flags queryApplied/statusBasis/dateBasis as internal keys', () => {
    assert.deepEqual(scoreMachineTokens('queryApplied ใช้ statusBasis และ dateBasis').reasons, ['machine_token:internal_key']);
  });

  it('flags an uppercase status enum as a whole word, case-sensitively, but never a vendor name like Grab', () => {
    assert.deepEqual(scoreMachineTokens('(สถานะ PAID)').reasons, ['machine_token:status_enum']);
    assert.equal(scoreMachineTokens('Grab: 1,944.50 บาท').ok, true);
  });

  it('flags every listed status enum word', () => {
    for (const word of ['PAID', 'UNPAID', 'PARTIALLY_PAID', 'NEEDS_REVIEW', 'DRAFT', 'CONFIRMED', 'REJECTED', 'VOIDED', 'READY_FOR_CONFIRMATION']) {
      assert.ok(scoreMachineTokens(`สถานะ ${word} ค่ะ`).reasons.includes('machine_token:status_enum'), `expected ${word} to be flagged`);
    }
  });

  it('flags an English status gloss in parentheses, case-insensitively', () => {
    assert.deepEqual(scoreMachineTokens('ฉบับร่างนี้ (Draft) ค่ะ').reasons, ['machine_token:status_gloss']);
    assert.deepEqual(scoreMachineTokens('ฉบับร่างนี้ (draft) ค่ะ').reasons, ['machine_token:status_gloss']);
    assert.deepEqual(scoreMachineTokens('รายการนี้ (Needs Review) ค่ะ').reasons, ['machine_token:status_gloss']);
  });

  it('flags an ISO date but never a Thai-formatted date', () => {
    assert.deepEqual(scoreMachineTokens('ข้อมูล ณ 2026-09-28').reasons, ['machine_token:iso_date']);
    assert.equal(scoreMachineTokens('ข้อมูล ณ 28 ก.ย. 2569').ok, true);
  });

  it('flags a version label like (v1, ...)', () => {
    const result = scoreMachineTokens('ฉบับร่างต่างจากยืนยันแล้วอย่างไร (v1, 2026-09-27)');
    assert.equal(result.ok, false);
    // The date inside the version label is independently a real ISO date too — both fire.
    assert.deepEqual(result.reasons.sort(), ['machine_token:iso_date', 'machine_token:version_label']);
  });

  it('strips a URL before matching, even one containing dashes that look like a date', () => {
    assert.equal(scoreMachineTokens('ดูรายละเอียดที่ https://example.com/report-2026-09-28 นะคะ').ok, true);
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

  describe('D3: the machine-token check runs on EVERY turn, unconditionally', () => {
    it('fails an otherwise-passing tag-only turn whose reply leaks a machine token', () => {
      const turn: Turn = { user: 'สวัสดีค่ะ', category: '19', expect: { tags: { no_tool: true, must_answer: true } } };
      const result = scoreTurn(ctx, turn, evidence({ deliveredText: 'สวัสดีค่ะ (สถานะ PAID)' }), [], NOW);
      assert.equal(result.passed, false);
      assert.ok(result.reasons.includes('machine_token:status_enum'));
    });

    it('fails an otherwise-passing data turn whose reply leaks a machine token', () => {
      const turn: Turn = { user: 'เดือนนี้จ่ายไปเท่าไหร่', category: '1', expect: { calls: [{ tool: 'expense.list_recent', input: {} }] } };
      const result = scoreTurn(ctx, turn, evidence({
        toolCalls: [{ tool: 'expense.list_recent', input: {} }], deliveredText: 'เดือนนี้จ่ายไป 1,200.00 บาทค่ะ ข้อมูล ณ 2026-09-28',
      }), [{ kind: 'money', value: '1200.00' }], NOW);
      assert.equal(result.passed, false);
      assert.deepEqual(result.reasons, ['machine_token:iso_date']);
    });

    it('judges deliveredTextExcludingQuickReplies, not deliveredText, when both are present', () => {
      // Simulates a machine token that exists only inside a quick-reply item's own text/label
      // (already stripped out of the "excluding" variant) — it must NOT fail the turn.
      const turn: Turn = { user: 'สวัสดีค่ะ', category: '19', expect: { tags: { no_tool: true, must_answer: true } } };
      const result = scoreTurn(ctx, turn, evidence({
        deliveredText: 'สวัสดีค่ะ (สถานะ PAID)', deliveredTextExcludingQuickReplies: 'สวัสดีค่ะ',
      }), [], NOW);
      assert.equal(result.passed, true);
    });
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

// Q5 gold is opt-in: existing advisor turns keep their exact scoring contract.
describe('M3 Q5 answer gold', () => {
  it('checks the delivered card version, required/forbidden facts and every numeric fact', async () => {
    const { scoreWorkflowAnswer } = await import('./scorer');
    const expect = { knowledge: { cardId: 'wht.calculation', version: 4, requiredFacts: ['ก่อน VAT'], forbiddenFacts: ['ใช้อัตราเดียวทุกกรณี'], allowedNumericFacts: [] } };
    const evidence = { deliveredText: 'หัก ณ ที่จ่ายคิดอย่างไร\nใช้ยอดก่อน VAT คูณอัตราที่เลือก', deliveredCards: [{ id: 'wht.calculation', version: 4 }], calls: [] };
    assert.deepEqual(scoreWorkflowAnswer(expect, evidence), { ok: true, reasons: [] });
    assert.equal(scoreWorkflowAnswer(expect, { ...evidence, deliveredCards: [{ id: 'wht.calculation', version: 3 }] }).ok, false);
    assert.equal(scoreWorkflowAnswer(expect, { ...evidence, deliveredText: 'ยอดก่อน VAT ใช้อัตราเดียวทุกกรณี' }).ok, false);
    assert.equal(scoreWorkflowAnswer(expect, { ...evidence, deliveredText: 'ยอดก่อน VAT คูณ 3%' }).ok, false);
    assert.equal(scoreWorkflowAnswer(expect, { ...evidence, deliveredText: 'ยอดก่อน VAT คูณ ๓%' }).ok, false);
    assert.equal(scoreWorkflowAnswer(expect, { ...evidence, deliveredCards: [] }).ok, false);
  });
  it('requires a due date proved by its seed period, not a date invented in the gold', async () => {
    const { scoreWorkflowAnswer } = await import('./scorer');
    const expected = { dueDate: { formType: 'PND3', monthOffset: 1 } } as const;
    assert.equal(scoreWorkflowAnswer(expected, { deliveredText: 'ภ.ง.ด.3 ครบวันที่ 7 ม.ค. 2570', calls: [] }, { dueDate: '2027-01-07' }).ok, true);
    assert.equal(scoreWorkflowAnswer(expected, { deliveredText: 'ภ.ง.ด.3 ครบวันที่ 7 ธ.ค. 2569', calls: [] }, { dueDate: '2027-01-07' }).ok, false);
    assert.equal(scoreWorkflowAnswer(expected, { deliveredText: 'ภ.ง.ด.3 ครบวันที่ 7 ม.ค. 2570', calls: [] }).ok, false);
  });
  it('free typed refusals enforce zero model calls and carry a way out', async () => {
    const { scoreWorkflowAnswer } = await import('./scorer');
    const expected = { maxModelCalls: 0, refusal: { reason: 'free', wayOut: ['แพ็กเกจ'] } } as const;
    assert.equal(scoreWorkflowAnswer(expected, { deliveredText: 'ร้านนี้ยังใช้คำถามไม่ได้ เปิดแพ็กเกจได้', calls: [] }).ok, true);
    assert.equal(scoreWorkflowAnswer(expected, { deliveredText: 'ร้านนี้ยังใช้คำถามไม่ได้', calls: [] }).ok, false);
    assert.equal(scoreWorkflowAnswer(expected, { deliveredText: 'เปิดแพ็กเกจได้', calls: [{}] }).ok, false);
    assert.equal(scoreWorkflowAnswer(expected, { deliveredText: 'ร้านนี้ยังใช้คำถามไม่ได้ เปิดแพ็กเกจได้', calls: [], textModelAttempts: 1 }).ok, false);
  });
});

it('M3 rescores every unchanged legacy conversation byte-identically for empty, ordinary and adverse evidence', async () => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  // Pinned from the untouched HEAD scorer before this change; no model-generated evidence.
  const hashes = {
    heldout: 'daec946bf0f7f023fdb1b2df77f6ad2a4e720de545a49ad09cfd5432782164cc',
    sample: '3d2b4c78e01fa8bbe11e00fa667ca784d0504c40329830de5cdc70094dac6833',
    tuning: 'a0db7d2611048de5704f3f4c9a02eec36a52ef6e45e1a92c0883c9e32d10c4f1',
  };
  for (const [name, hash] of Object.entries(hashes)) {
    const corpus = JSON.parse(readFileSync(new URL(`./corpus.${name}.json`, import.meta.url), 'utf8'));
    const scores = corpus.conversations.flatMap((conversation: any) => conversation.turns.flatMap((turn: Turn, turnIndex: number) => [
      evidence({ deliveredText: '', modelCalls: 0, latencyMs: null, costSatang: 0 }),
      evidence({ toolCalls: (turn.expect.calls ?? []).map(call => ({ tool: call.tool, input: call.input })), deliveredText: 'รับทราบ ' + (turn.expect.tags?.must_mention_any ?? []).join(' ') + ' ยอด 1000 บาท', modelCalls: 2, latencyMs: 400, costSatang: 7 }),
      evidence({ toolCalls: [{ tool: 'unexpected.fixture', input: {} }], deliveredText: 'ยังดึงข้อมูลส่วนนี้ไม่ได้ ' + (turn.expect.tags?.must_not_claim ?? []).join(' '), modelCalls: 1, latencyMs: 900, costSatang: 11 }),
    ].map(captured => scoreTurn({ conversationId: conversation.id, turnIndex }, turn, captured, [], new Date('2026-11-04T04:00:00Z')))));
    assert.equal(createHash('sha256').update(JSON.stringify(scores)).digest('hex'), hash, name);
  }
});

it('M3 retains the existing W1 label denominator for Tier 0 buttons', () => {
  const corpus = { version: 2, seed: 'x', status: 'draft', conversations: [{ id: 'button', category: 'expense', journeyKind: 'typed', actors: [], tasks: [],
    turns: [{ press: 'อนุมัติ', expect: { tier: 0, label: 'อนุมัติ', maxModelCalls: 0 } }] }] } as any;
  assert.deepEqual(scoreWorkflowCorpus({ corpus, attempts: [] }).W1, { passed: 0, total: 1 });
});

it('M3 round 3 excludes press labels from opt-in classifier W1 and checks the actual button baseline', () => {
  const corpus = { version: 2, seed: 'new-corpus', status: 'draft', conversations: [{ id: 'typed', category: 'expense', journeyKind: 'typed', actors: [], tasks: [], turns: [
    { user: 'อนุมัติใบเบิก', expect: { label: 'approvals' } }, { press: 'อนุมัติ', expect: { label: 'อนุมัติ' } },
  ] }] } as any;
  const turns = [0, 1].map(turnIndex => ({ attemptId: 'one', conversationId: 'typed', turnIndex, actorKey: 'owner', inputKind: turnIndex ? 'postback' : 'message',
    calls: [], effects: [], businessSnapshot: { business: {}, collectionState: {} }, unintendedEffects: [], deliveredActions: [], latencyMs: null,
    classifier: { label: turnIndex ? 'irrelevant-model-label' : 'approvals' }, ...(turnIndex ? { pressedLabel: 'อนุมัติ' } : {}) }));
  const input = { corpus, classifierLabels: 'messages', attempts: [{ attemptId: 'one', conversationId: 'typed', complete: true, turns }] } as any;
  const result = scoreWorkflowCorpus(input);
  assert.deepEqual(result.W1, { passed: 1, total: 1 });
  assert.deepEqual(result.buttonBaseline, { passed: 1, total: 1 });
  turns[1].pressedLabel = 'ปุ่มอื่น'; assert.deepEqual(scoreWorkflowCorpus(input).buttonBaseline, { passed: 0, total: 1 });
  assert.deepEqual(scoreWorkflowCorpus({ ...input, classifierLabels: undefined }).W1, { passed: 1, total: 2 });
});

it('M3 round 3 scores an earlier created record in a later task using conversation bindings', () => {
  const first = { id: 'create', kind: 'reimbursement_claim', startTurn: 0, endTurn: 1, confirmTurn: 1, goldTerminal: { effect: 'REIMBURSEMENT_DRAFT_SAVED', records: [{ table: 'ReimbursementRequest', ref: '$created:create', status: 'DRAFT' }] }, minimalTurns: 2, completable: true };
  const later = { id: 'submit', kind: 'reimbursement_submit', startTurn: 2, endTurn: 3, confirmTurn: 3, goldTerminal: { effect: 'REIMBURSEMENT_SUBMITTED', records: [{ table: 'ReimbursementRequest', ref: '$created:create', status: 'PENDING_APPROVAL' }] }, minimalTurns: 2, completable: true };
  const previews = [{ action: 'create', target: '$created:create' }, { action: 'submit', target: '$created:create' }];
  const corpus = { version: 2, seed: 'new', status: 'draft', conversations: [{ id: 'c', category: 'claim', journeyKind: 'typed', actors: [], tasks: [later, first], turns: [
    { user: 'สร้างใบเบิก', expect: { preview: previews[0] } }, { press: 'บันทึกร่าง', expect: {} }, { user: 'ส่งอนุมัติ', expect: { preview: previews[1] } }, { press: 'ส่งอนุมัติ', expect: {} },
  ] }] } as any;
  const turns = [0, 1, 2, 3].map(turnIndex => ({ attemptId: 'one', conversationId: 'c', turnIndex, actorKey: 'owner', inputKind: 'message', calls: [], effects: [], deliveredActions: [], latencyMs: null,
    businessSnapshot: { business: { ReimbursementRequest: turnIndex ? [{ id: 'created', status: turnIndex === 3 ? 'PENDING_APPROVAL' : 'DRAFT' }] : [] }, collectionState: {} },
    unintendedEffects: turnIndex === 1 ? [{ kind: 'ReimbursementRequest.create', recordId: 'created' }] : turnIndex === 3 ? [{ kind: 'ReimbursementRequest.update', recordId: 'created' }] : [],
    ...(turnIndex % 2 === 0 ? { preview: { ...previews[turnIndex / 2], target: 'created' } } : {}), terminalEffect: turnIndex === 1 ? 'REIMBURSEMENT_DRAFT_SAVED' : turnIndex === 3 ? 'REIMBURSEMENT_SUBMITTED' : undefined }));
  const result = scoreWorkflowCorpus({ corpus, attempts: [{ attemptId: 'one', conversationId: 'c', complete: true, turns }] } as any);
  assert.deepEqual(result.W6, { wrongApplied: 0, wrongPreview: 0 }); assert.deepEqual(result.W3, { passed: 2, total: 2 });
});

it('M3 round 3 preserves legacy metrics for every visible workflow corpus', async () => {
  const { readFileSync } = await import('node:fs'), { createHash } = await import('node:crypto');
  const hashes = { 'oracle-sample': 'e39f9943c4c469b56d8a93f61a87b9cbd72797890a86c769aefee8e52cd6cb6c',
    sample: '96109ae2b5640eaacd8cbec3742b10e30943a4adbe7b0658f20427ba41ff0640', tuning: 'f5ec5116b68195b2413e259f95c9714aeea4a777ad1582ed75b5c355401fd6b4' };
  for (const [name, expected] of Object.entries(hashes)) {
    const corpus = JSON.parse(readFileSync(new URL(`./corpus.workflow.${name}.json`, import.meta.url), 'utf8'));
    const attempts = corpus.conversations.map((conversation: any) => ({ attemptId: 'complete', conversationId: conversation.id, complete: true,
      turns: conversation.turns.map((turn: any, turnIndex: number) => ({ attemptId: 'complete', conversationId: conversation.id, turnIndex, actorKey: conversation.actors[0].key,
        inputKind: turn.press ? 'postback' : 'message', calls: [], effects: [], businessSnapshot: { business: {}, collectionState: {} }, unintendedEffects: [], deliveredActions: [], deliveredText: 'รับทราบ',
        latencyMs: 100, terminalEffect: 'ANSWERED', classifier: { label: turn.expect.label } })) }));
    assert.equal(createHash('sha256').update(JSON.stringify(scoreWorkflowCorpus({ corpus, attempts }))).digest('hex'), expected, name);
  }
});

it('M3 round 3 corpus scoring accepts only the correct named declined preview with zero writes', () => {
  const task = { id: 'declined', kind: 'expense_pay', startTurn: 0, endTurn: 1, previewTurn: 0, goldTerminal: { effect: 'DECLINED', records: [] }, minimalTurns: 2, completable: true };
  const preview = { action: 'pay', target: '$seed:expense', amount: '100.00' };
  const corpus = { version: 2, seed: 'declined', status: 'draft', conversations: [{ id: 'declined', category: 'expense', journeyKind: 'typed', actors: [], tasks: [task],
    turns: [{ user: 'จ่ายรายการนี้', expect: { preview } }, { press: 'ไม่ทำ', expect: { label: 'ไม่ทำ' } }] }] } as any;
  const turns = [0, 1].map(turnIndex => ({ attemptId: 'one', conversationId: 'declined', turnIndex, actorKey: 'owner', inputKind: 'message', calls: [], effects: [],
    businessSnapshot: { business: {}, collectionState: {} }, unintendedEffects: [], deliveredActions: [], latencyMs: null,
    ...(turnIndex === 0 ? { preview: { ...preview, target: 'expense' } } : { terminalEffect: 'DECLINED' }) })) as any[];
  const input = { corpus, attempts: [{ attemptId: 'one', conversationId: 'declined', complete: true, turns }] };
  assert.deepEqual(scoreWorkflowCorpus(input).W6, { wrongApplied: 0, wrongPreview: 0 });
  assert.deepEqual(scoreWorkflowCorpus(input).W3, { passed: 1, total: 1 });
  turns[0].preview.target = 'other'; assert.equal(scoreWorkflowCorpus(input).W6.wrongPreview, 1);
  turns[0].preview.target = 'expense'; turns[1].unintendedEffects = [{ kind: 'ExpenseRecord.delete', recordId: 'expense' }];
  assert.equal(scoreWorkflowCorpus(input).W6.wrongApplied, 1);
});
