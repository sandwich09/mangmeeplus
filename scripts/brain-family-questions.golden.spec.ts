import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAIN_FAMILY_MIN_PHRASINGS_PER_LANGUAGE,
  BRAIN_FAMILY_QUESTIONS_EVIDENCE_CLASS,
  BRAIN_FAMILY_QUESTION_FIXTURES,
  F1_EXPENSE_SUMMARY,
  F2_ACCOUNTING_RECORDS,
  F3_EXPENSE_TODAY,
  formatBrainFamilyQuestionsReport,
  scoreBrainFamilyQuestions,
  type BrainFamilyQuestionFixture,
} from './brain-family-questions.golden';

const FAMILIES = [F1_EXPENSE_SUMMARY, F2_ACCOUNTING_RECORDS, F3_EXPENSE_TODAY] as const;

describe('brain family question golden manifest', () => {
  it('keeps every fixture uniquely identified, non-empty, and in its declared language', () => {
    const ids = new Set<string>();
    const seen = new Set<string>();
    for (const fixture of BRAIN_FAMILY_QUESTION_FIXTURES) {
      assert.equal(ids.has(fixture.id), false, `${fixture.id} is duplicated`);
      ids.add(fixture.id);
      assert.ok(fixture.question.trim().length > 0, `${fixture.id} has an empty question`);
      const key = `${fixture.familyKey}::${fixture.question}`;
      assert.equal(seen.has(key), false, `${fixture.id} repeats a question of its own family`);
      seen.add(key);
      const hasThai = /[฀-๿]/.test(fixture.question);
      assert.equal(hasThai, fixture.language === 'th', `${fixture.id} does not match its declared language`);
      // Invariant 7: NFC, never NFKC (NFKC decomposes สระอำ and breaks anchored Thai matching).
      assert.equal(fixture.question, fixture.question.normalize('NFC'), `${fixture.id} is not NFC-normalized`);
      // Every expectation is either the family under test or an explicit, explained fallback.
      if (fixture.expectedFamilyKey === null) assert.ok(fixture.note, `${fixture.id} must say why it falls back`);
      else assert.equal(fixture.expectedFamilyKey, fixture.familyKey, `${fixture.id} expects another family`);
    }
    assert.ok(ids.size >= 2 * FAMILIES.length * BRAIN_FAMILY_MIN_PHRASINGS_PER_LANGUAGE, 'every family × both languages must be covered');
  });

  it('carries the §8.3 minimum phrasings per family PER LANGUAGE', () => {
    for (const familyKey of FAMILIES) {
      for (const language of ['th', 'en'] as const) {
        const count = BRAIN_FAMILY_QUESTION_FIXTURES
          .filter((f) => f.familyKey === familyKey && f.language === language && f.expectedFamilyKey !== null).length;
        assert.ok(count >= BRAIN_FAMILY_MIN_PHRASINGS_PER_LANGUAGE, `${familyKey} [${language}] has only ${count} phrasings`);
      }
    }
  });

  it('states, per family, the phrasings that must fall back instead of being claimed', () => {
    for (const familyKey of FAMILIES) {
      const fallbacks = BRAIN_FAMILY_QUESTION_FIXTURES.filter((f) => f.familyKey === familyKey && f.expectedFamilyKey === null);
      assert.ok(fallbacks.length >= 3, `${familyKey} needs fallback controls, not only positives`);
      // The branch-scope design tension is recorded, not papered over: `FORBIDDEN_INPUT_KEY` rejects a
      // branchId in a proposed input, so a branch-scoped question can never be served by a family.
      assert.ok(fallbacks.some((f) => /branch|สาขา/i.test(f.question)), `${familyKey} must expect branch-scoped questions to fall back`);
    }
    // Owner decision 2026-08-26: F3 answers the EXPENSE side only. Money-in, profit and bank-balance
    // questions have no tool yet, so they must fall back rather than be answered from expense numbers.
    const f3Fallbacks = BRAIN_FAMILY_QUESTION_FIXTURES.filter((f) => f.familyKey === F3_EXPENSE_TODAY && f.expectedFamilyKey === null);
    for (const pattern of [/เงินเข้า|came in/i, /กำไร|profit/i, /ธนาคาร|bank/i]) {
      assert.ok(f3Fallbacks.some((f) => pattern.test(f.question)), `F3 needs a ${String(pattern)} control`);
    }
  });

  it('scores a run per family and language, and names mismatches', () => {
    const fixtures: BrainFamilyQuestionFixture[] = [
      { id: 'a', familyKey: F1_EXPENSE_SUMMARY, language: 'th', question: 'สรุปค่าใช้จ่าย', expectedFamilyKey: F1_EXPENSE_SUMMARY },
      { id: 'b', familyKey: F1_EXPENSE_SUMMARY, language: 'en', question: 'Total expenses', expectedFamilyKey: F1_EXPENSE_SUMMARY },
      { id: 'c', familyKey: F1_EXPENSE_SUMMARY, language: 'th', question: 'ค่าใช้จ่ายสาขาสีลม', expectedFamilyKey: null, note: 'branch-scoped' },
      { id: 'd', familyKey: F2_ACCOUNTING_RECORDS, language: 'th', question: 'สรุปรายการเดือนนี้', expectedFamilyKey: F2_ACCOUNTING_RECORDS },
    ];
    const score = scoreBrainFamilyQuestions([
      { questionId: 'a', routedFamilyKey: F1_EXPENSE_SUMMARY },
      { questionId: 'b', routedFamilyKey: null },
      { questionId: 'c', routedFamilyKey: null },
      { questionId: 'e', routedFamilyKey: F1_EXPENSE_SUMMARY },
    ], fixtures);

    assert.equal(score.scored, 3);
    assert.equal(score.matched, 2);
    assert.deepEqual(score.mismatches, [{ questionId: 'b', expected: F1_EXPENSE_SUMMARY, routed: null }]);
    assert.deepEqual(score.questionsWithoutResult, ['d']);
    assert.deepEqual(score.resultsWithoutQuestion, ['e']);
    // A fallback row is a control, so it is scored but never counted as the family's coverage.
    const thF1 = score.coverage.find((row) => row.familyKey === F1_EXPENSE_SUMMARY && row.language === 'th');
    assert.equal(thF1?.phrasings, 1);
    assert.equal(thF1?.scored, 2);
    assert.equal(score.coverageComplete, false);
  });

  it('stamps its report as an expectation manifest, not provider evidence', () => {
    assert.equal(BRAIN_FAMILY_QUESTIONS_EVIDENCE_CLASS, 'expectation-manifest');
    const report = formatBrainFamilyQuestionsReport(scoreBrainFamilyQuestions([]), 'dry run');
    assert.match(report, /NOT PROVIDER EVIDENCE/);
    assert.match(report, /routing accuracy: 0\.0% \(0\/0\)/);
    // With no run rows at all, every fixture is reported as unscored rather than as a pass.
    assert.equal(scoreBrainFamilyQuestions([]).questionsWithoutResult.length, BRAIN_FAMILY_QUESTION_FIXTURES.length);
  });

  it('reports full per-language coverage for the shipped fixture set', () => {
    const score = scoreBrainFamilyQuestions(BRAIN_FAMILY_QUESTION_FIXTURES.map((fixture) => ({
      questionId: fixture.id, routedFamilyKey: fixture.expectedFamilyKey,
    })));
    assert.equal(score.coverageComplete, true);
    assert.equal(score.accuracy, 1);
    assert.equal(score.mismatches.length, 0);
    assert.match(formatBrainFamilyQuestionsReport(score, 'self-check'), /mismatches: none/);
  });
});
