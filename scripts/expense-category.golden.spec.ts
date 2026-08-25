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

  it('reports NOT-A-BASELINE until 30 owner-confirmed fixtures exist', () => {
    assert.ok(EXPENSE_CATEGORY_GOLDEN_FIXTURES.length >= 3, 'the starter set still has to exercise the harness');
    // Flips only when the Owner-confirmed set actually lands; until then the report may not claim accuracy.
    const starters = scoreExpenseCategoryGolden([], EXPENSE_CATEGORY_GOLDEN_FIXTURES);
    assert.ok(starters.ownerConfirmedFixtures < EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES);
    assert.equal(starters.baselineReady, false);
    assert.match(formatExpenseCategoryGoldenReport(starters, 'starter set'), /NOT-A-BASELINE/);

    const confirmed = Array.from(
      { length: EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES },
      (_unused, index) => miniFixture(`confirmed-${index}`, 'cat-a'),
    );
    const ready = scoreExpenseCategoryGolden([], confirmed);
    assert.equal(ready.ownerConfirmedFixtures, EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES);
    assert.equal(ready.baselineReady, true);
    assert.equal(/NOT-A-BASELINE/.test(formatExpenseCategoryGoldenReport(ready, 'signed set')), false);

    const oneShort = scoreExpenseCategoryGolden([], confirmed.slice(1));
    assert.equal(oneShort.baselineReady, false);
  });
});
