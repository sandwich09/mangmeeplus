import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE } from '../packages/contracts/src/line-ai.js';
import {
  EXPENSE_CATEGORY_GOLDEN_FIXTURES,
  EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES,
  findPiiLikeSpans,
  formatExpenseCategoryGoldenReport,
  scoreExpenseCategoryGolden,
  type ExpenseCategoryGoldenFixture,
} from './expense-category.golden';

const MINI_CATALOGUE = [
  { id: 'cat-a', name: 'A' },
  { id: 'cat-b', name: 'B' },
  { id: 'cat-c', name: 'C' },
  { id: 'cat-d', name: 'D' },
];

const miniFixture = (
  id: string,
  expectedCategoryId: string | null,
  ownerConfirmed = true,
): ExpenseCategoryGoldenFixture => ({
  id,
  language: 'th',
  sanitizedOcrText: 'ใบเสร็จตัวอย่าง รวมทั้งสิ้น 100.00',
  activeCategories: MINI_CATALOGUE,
  expectedCategoryId,
  ownerConfirmed,
});

describe('expense category golden harness', () => {
  it('keeps every fixture sanitized, uniquely identified, and answerable from its own catalogue', () => {
    const ids = new Set<string>();
    for (const fixture of EXPENSE_CATEGORY_GOLDEN_FIXTURES) {
      assert.equal(ids.has(fixture.id), false, `${fixture.id} is duplicated`);
      ids.add(fixture.id);
      assert.ok(['th', 'en'].includes(fixture.language), `${fixture.id} has an unknown language`);
      assert.ok(fixture.sanitizedOcrText.trim().length > 0, `${fixture.id} has empty sanitized OCR text`);

      const catalogueIds = new Set<string>();
      for (const category of fixture.activeCategories) {
        assert.ok(category.id.trim() && category.name.trim(), `${fixture.id} has an empty catalogue entry`);
        assert.equal(catalogueIds.has(category.id), false, `${fixture.id} repeats catalogue id ${category.id}`);
        catalogueIds.add(category.id);
      }
      if (fixture.expectedCategoryId !== null) {
        assert.ok(
          catalogueIds.has(fixture.expectedCategoryId),
          `${fixture.id} expects ${fixture.expectedCategoryId}, which is not in its own catalogue`,
        );
      }

      // G7: sanitized text carries no tax id / phone number.
      assert.deepEqual(findPiiLikeSpans(fixture.sanitizedOcrText), [], `${fixture.id} still contains identifier-like digits`);
    }

    // The sanitization guard must actually fire, otherwise the assertions above are vacuous.
    assert.deepEqual(
      findPiiLikeSpans('เลขประจำตัวผู้เสียภาษี 0-9940-0016-30-11 โทร 02-123-4567'),
      ['0-9940-0016-30-11', '02-123-4567'],
    );
    assert.deepEqual(findPiiLikeSpans('รวมทั้งสิ้น 1,240.00 วันที่ 01/08/2569'), []);
  });

  it('scores suggestion, auto-fill, omit rate, and confusion against hand-computed cases', () => {
    const fixtures = [
      miniFixture('f1-correct-high', 'cat-a'),
      miniFixture('f2-wrong-high', 'cat-b'),
      miniFixture('f3-correct-low', 'cat-c'),
      miniFixture('f4-correct-omit', null),
      miniFixture('f5-wrong-omit', 'cat-d'),
      miniFixture('f6-no-result', 'cat-a'),
    ];
    const score = scoreExpenseCategoryGolden([
      { fixtureId: 'f1-correct-high', suggestedCategoryId: 'cat-a', confidence: 0.9 },
      { fixtureId: 'f2-wrong-high', suggestedCategoryId: 'cat-a', confidence: 0.9 },
      { fixtureId: 'f3-correct-low', suggestedCategoryId: 'cat-c', confidence: 0.5 },
      { fixtureId: 'f4-correct-omit', suggestedCategoryId: null, confidence: null },
      { fixtureId: 'f5-wrong-omit', suggestedCategoryId: null, confidence: null },
      { fixtureId: 'ghost', suggestedCategoryId: 'cat-a', confidence: 0.9 },
    ], fixtures);

    assert.equal(score.scoredFixtures, 5);
    assert.deepEqual(score.suggestion, { correct: 3, incorrect: 2, accuracy: 0.6 });
    assert.deepEqual(score.autoFill, {
      threshold: RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE,
      attempted: 2,
      correct: 1,
      accuracy: 0.5,
      coverage: 0.4,
    });
    assert.equal(score.omitted, 2);
    assert.equal(score.omitRate, 0.4);
    assert.deepEqual(score.confusions, [
      { expectedCategoryId: 'cat-b', suggestedCategoryId: 'cat-a', count: 1 },
      { expectedCategoryId: 'cat-d', suggestedCategoryId: null, count: 1 },
    ]);
    assert.deepEqual(score.fixturesWithoutResult, ['f6-no-result']);
    assert.deepEqual(score.resultsWithoutFixture, ['ghost']);

    // Same expected->suggested mistake twice is one confusion row with count 2.
    const repeated = scoreExpenseCategoryGolden([
      { fixtureId: 'r1', suggestedCategoryId: 'cat-a', confidence: 0.9 },
      { fixtureId: 'r2', suggestedCategoryId: 'cat-a', confidence: 0.9 },
    ], [miniFixture('r1', 'cat-b'), miniFixture('r2', 'cat-b')]);
    assert.deepEqual(repeated.confusions, [{ expectedCategoryId: 'cat-b', suggestedCategoryId: 'cat-a', count: 2 }]);

    // The auto-fill gate mirrors the API: `>=` threshold, finite confidence only.
    const atThreshold = scoreExpenseCategoryGolden(
      [{ fixtureId: 'edge', suggestedCategoryId: 'cat-a', confidence: RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE }],
      [miniFixture('edge', 'cat-a')],
    );
    assert.equal(atThreshold.autoFill.attempted, 1);
    const belowThreshold = scoreExpenseCategoryGolden(
      [{ fixtureId: 'edge', suggestedCategoryId: 'cat-a', confidence: RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE - 0.01 }],
      [miniFixture('edge', 'cat-a')],
    );
    assert.equal(belowThreshold.autoFill.attempted, 0);
    assert.equal(belowThreshold.suggestion.correct, 1, 'a below-threshold suggestion still counts as a suggestion');
    const notFinite = scoreExpenseCategoryGolden(
      [{ fixtureId: 'edge', suggestedCategoryId: 'cat-a', confidence: Number.NaN }],
      [miniFixture('edge', 'cat-a')],
    );
    assert.equal(notFinite.autoFill.attempted, 0);

    // Empty run: rates are 0, never NaN.
    const empty = scoreExpenseCategoryGolden([], []);
    assert.deepEqual(
      [empty.suggestion.accuracy, empty.autoFill.accuracy, empty.autoFill.coverage, empty.omitRate],
      [0, 0, 0, 0],
    );

    assert.throws(
      () => scoreExpenseCategoryGolden([
        { fixtureId: 'f1-correct-high', suggestedCategoryId: 'cat-a', confidence: 0.9 },
        { fixtureId: 'f1-correct-high', suggestedCategoryId: 'cat-b', confidence: 0.9 },
      ], fixtures),
      /duplicate run result/,
    );
  });

  it('sources the auto-fill threshold from packages/contracts instead of restating it', () => {
    const source = readFileSync(new URL('./expense-category.golden.ts', import.meta.url), 'utf8');
    assert.match(source, /from '\.\.\/packages\/contracts\/src\/line-ai\.js'/);
    assert.equal(/RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE\s*=/.test(source), false, 'the harness must not redefine the threshold');
    assert.equal(/0\.85/.test(source), false, 'the harness must not hardcode the threshold value');
    assert.equal(
      scoreExpenseCategoryGolden([], EXPENSE_CATEGORY_GOLDEN_FIXTURES).autoFill.threshold,
      RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE,
    );
  });

  it('reports NOT-A-BASELINE until 30 owner-confirmed fixtures are confirmed AND evaluated (PR #238 T0)', () => {
    assert.ok(EXPENSE_CATEGORY_GOLDEN_FIXTURES.length >= 3, 'the starter set still has to exercise the harness');
    const starters = scoreExpenseCategoryGolden([], EXPENSE_CATEGORY_GOLDEN_FIXTURES);
    assert.ok(starters.ownerConfirmedFixtures < EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES);
    assert.equal(starters.baselineReady, false);
    assert.match(formatExpenseCategoryGoldenReport(starters, 'starter set'), /NOT-A-BASELINE/);

    const confirmed = Array.from(
      { length: EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES },
      (_unused, index) => miniFixture(`confirmed-${index}`, 'cat-a'),
    );
    const allResults = confirmed.map((fixture) => ({ fixtureId: fixture.id, suggestedCategoryId: 'cat-a', confidence: 0.9 }));

    // The bug this test pins down: 30 confirmed LABELS with one evaluated result used to publish a
    // "ready" 100% baseline. Confirmed-but-unevaluated rows must block readiness, listed by id.
    const partial = scoreExpenseCategoryGolden(allResults.slice(0, 1), confirmed);
    assert.equal(partial.ownerConfirmedFixtures, EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES);
    assert.equal(partial.baselineReady, false, 'labels alone are not evidence');
    assert.equal(partial.baseline.evaluatedFixtures, 1);
    assert.equal(partial.baseline.confirmedFixturesWithoutResult.length, EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES - 1);
    assert.match(formatExpenseCategoryGoldenReport(partial, 'partial run'), /NOT-A-BASELINE/);
    assert.match(formatExpenseCategoryGoldenReport(partial, 'partial run'), /owner-confirmed fixtures without a result/);

    // No results at all: the labels are confirmed, the baseline is still not evidence.
    const noResults = scoreExpenseCategoryGolden([], confirmed);
    assert.equal(noResults.baselineReady, false);

    const ready = scoreExpenseCategoryGolden(allResults, confirmed);
    assert.equal(ready.baselineReady, true);
    assert.equal(ready.baseline.evaluatedFixtures, EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES);
    const readyReport = formatExpenseCategoryGoldenReport(ready, 'signed set');
    assert.equal(/NOT-A-BASELINE/.test(readyReport), false);
    assert.match(readyReport, /BASELINE \(owner-confirmed ∩ evaluated/);

    const oneShort = scoreExpenseCategoryGolden(allResults.slice(1), confirmed.slice(1));
    assert.equal(oneShort.baselineReady, false);
  });

  it('keeps synthetic starter rows out of the baseline while they stay in diagnostics (PR #238 T0)', () => {
    const confirmed = Array.from(
      { length: EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES },
      (_unused, index) => miniFixture(`confirmed-${index}`, 'cat-a'),
    );
    const starter = miniFixture('starter-noise', 'cat-b', false);
    const results = [
      // Every confirmed row answered correctly with auto-fill confidence…
      ...confirmed.map((fixture) => ({ fixtureId: fixture.id, suggestedCategoryId: 'cat-a', confidence: 0.9 })),
      // …and one synthetic starter answered WRONG with high confidence.
      { fixtureId: 'starter-noise', suggestedCategoryId: 'cat-a', confidence: 0.9 },
    ];
    const score = scoreExpenseCategoryGolden(results, [...confirmed, starter]);

    assert.equal(score.baselineReady, true);
    // Baseline: the starter's wrong answer must not dilute the published numbers…
    assert.equal(score.baseline.suggestion.accuracy, 1);
    assert.equal(score.baseline.autoFill.accuracy, 1);
    assert.equal(score.baseline.evaluatedFixtures, EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES);
    // …while diagnostics still see it, so the harness run itself stays debuggable.
    assert.equal(score.scoredFixtures, EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES + 1);
    assert.equal(score.suggestion.incorrect, 1);
  });
});
