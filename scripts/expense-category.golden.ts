/**
 * Offline golden set + scorer for the receipt reporting-category suggestion.
 * Spec: docs/specs/mangmee-brain-real-answers-spec.md §3 (S1-R1, S1-R2, S1-R6), §7 G7, §8.1.
 *
 * Data and pure functions only. This file calls no provider, gateway, API, database, or LINE code:
 * the suggestions it scores come from a separate hosted UAT intake / provider run that uses the same
 * config as UAT (S1-R2), and that runner hands its rows to `scoreExpenseCategoryGolden`.
 *
 * Root-scripts harness, same boundary rule as `line-ai-latency-autonomy.corpus.ts`: app code and app
 * tests must NEVER import this file (that cross-boundary import is what broke the image build before).
 *
 * G7 (PDPA / business confidentiality): fixtures carry sanitized stage-1 OCR text only — no images, no
 * customer PII, and tax ids / phone numbers masked. Every STARTER row below is a synthetic placeholder
 * written for shape, not a real business document, so all of them are `ownerConfirmed: false`. The real
 * 30+ rows arrive from the Owner/accountant with per-row sign-off (spec §10.3, §10.4).
 */
import {
  RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE,
  type ReceiptOcrRequest,
} from '../packages/contracts/src/line-ai.js';

/** Same shape the API sends to the gateway as the active catalogue, so fixtures cannot drift from it. */
export type ExpenseCategoryGoldenCatalogue = NonNullable<ReceiptOcrRequest['activeCategories']>;

export type ExpenseCategoryGoldenFixture = {
  id: string;
  language: 'th' | 'en';
  /** Sanitized stage-1 OCR text, exactly as the gateway would receive it. Masked identifiers only. */
  sanitizedOcrText: string;
  /** Active company/global catalogue snapshot for this document. Empty catalogue = suggestion must be omitted. */
  activeCategories: ExpenseCategoryGoldenCatalogue;
  /** Answer key: an id from this row's own catalogue, or null when the expected behaviour is to omit. */
  expectedCategoryId: string | null;
  /** false until the Owner/accountant signs the row off (spec §10.3). Only confirmed rows count for a baseline. */
  ownerConfirmed: boolean;
  notes?: string;
};

/** One row of a hosted/provider run: what the model actually suggested for one fixture. */
export type ExpenseCategoryRunResult = {
  fixtureId: string;
  suggestedCategoryId: string | null;
  confidence: number | null;
};

export type ExpenseCategoryConfusion = {
  expectedCategoryId: string | null;
  suggestedCategoryId: string | null;
  count: number;
};

/**
 * PR #238 review T0: the only rows a BASELINE may use are owner-confirmed fixtures that actually
 * produced an evaluated result — a confirmed label without a run result proves nothing, and a
 * synthetic starter row must never contaminate a published number.
 */
export type ExpenseCategoryBaselineMetrics = {
  /** |owner-confirmed ∩ has-result| — the denominator of every baseline number below. */
  evaluatedFixtures: number;
  /** Owner-confirmed fixtures the run produced no result for. Each one blocks baselineReady. */
  confirmedFixturesWithoutResult: readonly string[];
  suggestion: { correct: number; incorrect: number; accuracy: number };
  autoFill: { threshold: number; attempted: number; correct: number; accuracy: number; coverage: number };
  omitted: number;
  omitRate: number;
};

export type ExpenseCategoryGoldenScore = {
  /**
   * DIAGNOSTICS over every evaluated fixture, synthetic starters included: scoredFixtures,
   * suggestion, autoFill, omitted/omitRate, confusions describe the harness run, never the
   * product. Publishable numbers live only in `baseline` below.
   */
  scoredFixtures: number;
  ownerConfirmedFixtures: number;
  /**
   * S1-R6 gate: true only when at least EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES
   * owner-confirmed fixtures have an evaluated result AND no confirmed fixture is missing one
   * (confirmedFixturesWithoutResult is empty). Both legs matter: the count stops a thin sample,
   * and the empty-missing-list stops cherry-picking — with 31 confirmed rows, dropping the one
   * hard failure must not produce a publishable 30-row baseline.
   */
  baselineReady: boolean;
  /** Baseline metrics over the owner-confirmed ∩ evaluated intersection only. */
  baseline: ExpenseCategoryBaselineMetrics;
  /** correct counts a matching id AND a correctly omitted suggestion; correct + incorrect = scoredFixtures. */
  suggestion: { correct: number; incorrect: number; accuracy: number };
  /** `attempted` = rows the API auto-fill gate would have filled; accuracy is its precision, coverage its reach. */
  autoFill: { threshold: number; attempted: number; correct: number; accuracy: number; coverage: number };
  /** Behaviour rate, not an accuracy: a right omit is also correct, a wrong omit is also incorrect. */
  omitted: number;
  omitRate: number;
  confusions: readonly ExpenseCategoryConfusion[];
  fixturesWithoutResult: readonly string[];
  resultsWithoutFixture: readonly string[];
};

/** S1-R1: "at least 30 real receipts", owner-confirmed, before any number is called a baseline. */
export const EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES = 30;

/** Placeholder catalogue for the starter rows. Sample ids only — not any company's real catalogue. */
const STARTER_CATALOGUE: ExpenseCategoryGoldenCatalogue = [
  { id: 'sample-category-fuel', name: 'ค่าน้ำมันเชื้อเพลิง' },
  { id: 'sample-category-office-supplies', name: 'ค่าวัสดุสำนักงาน' },
  { id: 'sample-category-utilities', name: 'ค่าสาธารณูปโภค' },
  { id: 'sample-category-travel', name: 'ค่าเดินทาง' },
];

const STARTER_NOTE = 'STARTER placeholder: synthetic text written for harness shape, not a real document.';

/**
 * Starter rows only — they prove the harness runs end to end and pin the fixture shape. They are NOT a
 * baseline set: replace/extend them with the Owner-confirmed receipts before reporting any accuracy.
 */
export const EXPENSE_CATEGORY_GOLDEN_FIXTURES: readonly ExpenseCategoryGoldenFixture[] = Object.freeze([
  {
    id: 'starter-th-fuel',
    language: 'th',
    sanitizedOcrText: [
      'ใบเสร็จรับเงิน',
      'ร้านตัวอย่าง A (ข้อมูลตัวอย่าง ไม่ใช่เอกสารจริง)',
      'เลขประจำตัวผู้เสียภาษี [masked]',
      'วันที่ 01/08/2569',
      'น้ำมันดีเซล 20 ลิตร',
      'รวมทั้งสิ้น 800.00 บาท',
      'ชำระเงินสด',
    ].join('\n'),
    activeCategories: STARTER_CATALOGUE,
    expectedCategoryId: 'sample-category-fuel',
    ownerConfirmed: false,
    notes: `${STARTER_NOTE} Vendor+item both point at one catalogue row.`,
  },
  {
    id: 'starter-th-office-supplies',
    language: 'th',
    sanitizedOcrText: [
      'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ',
      'ร้านตัวอย่าง B เครื่องเขียน (ข้อมูลตัวอย่าง)',
      'เลขประจำตัวผู้เสียภาษี [masked]',
      'กระดาษถ่ายเอกสาร A4 จำนวน 2 รีม 260.00',
      'ปากกาลูกลื่น จำนวน 10 ด้าม 90.00',
      'รวมทั้งสิ้น 350.00',
      'ชำระแล้ว',
    ].join('\n'),
    activeCategories: STARTER_CATALOGUE,
    expectedCategoryId: 'sample-category-office-supplies',
    ownerConfirmed: false,
    notes: `${STARTER_NOTE} Multi-line item block, single expected category for the whole document.`,
  },
  {
    id: 'starter-en-utilities',
    language: 'en',
    sanitizedOcrText: [
      'RECEIPT',
      'Sample Utility Provider (synthetic sample, not a real document)',
      'Tax ID [masked]',
      'Service period: July 2026',
      'Electricity charge 1,240.00',
      'Total 1,240.00',
      'PAID',
    ].join('\n'),
    activeCategories: STARTER_CATALOGUE,
    expectedCategoryId: 'sample-category-utilities',
    ownerConfirmed: false,
    notes: `${STARTER_NOTE} English row: the answer key is language-independent.`,
  },
  {
    id: 'starter-th-empty-catalogue-omit',
    language: 'th',
    sanitizedOcrText: [
      'ใบเสร็จรับเงิน',
      'ร้านตัวอย่าง C (ข้อมูลตัวอย่าง)',
      'ค่าบริการทำความสะอาด 1 ครั้ง',
      'รวมทั้งสิ้น 1,500.00',
      'ชำระแล้ว',
    ].join('\n'),
    activeCategories: [],
    expectedCategoryId: null,
    ownerConfirmed: false,
    notes: `${STARTER_NOTE} Empty catalogue: the prompt requires omission + "category" in missingFields.`,
  },
  {
    id: 'starter-th-unsupported-omit',
    language: 'th',
    sanitizedOcrText: [
      'ใบเสร็จรับเงิน',
      'ร้านตัวอย่าง D (ข้อมูลตัวอย่าง)',
      'สินค้าเบ็ดเตล็ด',
      'รวมทั้งสิ้น 120.00',
      'ชำระเงินสด',
    ].join('\n'),
    activeCategories: STARTER_CATALOGUE,
    expectedCategoryId: null,
    ownerConfirmed: false,
    notes: `${STARTER_NOTE} Catalogue present but nothing clearly supported: omission is the correct answer.`,
  },
]);

/**
 * G7 sanitization guard for fixture text. Flags digit groups that read as a Thai 13-digit tax id or a
 * 9–10 digit phone number once separators are stripped; money, dates, and quantities stay untouched.
 * ponytail: pattern-level check only — it cannot see names or addresses, which stay a human review step.
 */
export function findPiiLikeSpans(text: string): string[] {
  return (text.match(/\d(?:[\d\s-]*\d)?/g) ?? []).filter((span) => {
    const digits = span.replace(/[\s-]/g, '');
    return digits.length === 13 || (digits.length >= 9 && digits.length <= 10 && digits.startsWith('0'));
  });
}

const rate = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/**
 * Pure scorer for one run (S1-R2): suggestion accuracy, auto-fill accuracy at the contract threshold,
 * omit rate, and expected→suggested confusion counts. No model call, no I/O.
 */
export function scoreExpenseCategoryGolden(
  results: readonly ExpenseCategoryRunResult[],
  fixtures: readonly ExpenseCategoryGoldenFixture[] = EXPENSE_CATEGORY_GOLDEN_FIXTURES,
): ExpenseCategoryGoldenScore {
  const byFixture = new Map<string, ExpenseCategoryRunResult>();
  for (const result of results) {
    if (byFixture.has(result.fixtureId)) throw new Error(`duplicate run result for fixture ${result.fixtureId}`);
    byFixture.set(result.fixtureId, result);
  }

  const confusions = new Map<string, ExpenseCategoryConfusion>();
  const fixturesWithoutResult: string[] = [];
  const confirmedFixturesWithoutResult: string[] = [];
  let scored = 0;
  let correct = 0;
  let omitted = 0;
  let attempted = 0;
  let autoFillCorrect = 0;
  // PR #238 review T0: baseline counters run over the owner-confirmed ∩ evaluated intersection
  // ONLY — starter rows and unevaluated confirmed labels stay in the diagnostics.
  let baselineScored = 0;
  let baselineCorrect = 0;
  let baselineOmitted = 0;
  let baselineAttempted = 0;
  let baselineAutoFillCorrect = 0;

  for (const fixture of fixtures) {
    const result = byFixture.get(fixture.id);
    if (!result) {
      fixturesWithoutResult.push(fixture.id);
      if (fixture.ownerConfirmed) confirmedFixturesWithoutResult.push(fixture.id);
      continue;
    }
    byFixture.delete(fixture.id);
    scored += 1;

    const suggested = result.suggestedCategoryId;
    const matches = suggested === fixture.expectedCategoryId;
    if (matches) {
      correct += 1;
    } else {
      const key = `${fixture.expectedCategoryId ?? ''} ${suggested ?? ''}`;
      const row = confusions.get(key);
      if (row) row.count += 1;
      else confusions.set(key, {
        expectedCategoryId: fixture.expectedCategoryId,
        suggestedCategoryId: suggested,
        count: 1,
      });
    }
    if (suggested === null) omitted += 1;

    // Mirrors the API gate in receipt-ocr-apply.service.ts: a finite confidence at or above the contract threshold.
    const autoFills = suggested !== null
      && typeof result.confidence === 'number'
      && Number.isFinite(result.confidence)
      && result.confidence >= RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE;
    if (autoFills) {
      attempted += 1;
      if (matches) autoFillCorrect += 1;
    }

    if (fixture.ownerConfirmed) {
      baselineScored += 1;
      if (matches) baselineCorrect += 1;
      if (suggested === null) baselineOmitted += 1;
      if (autoFills) {
        baselineAttempted += 1;
        if (matches) baselineAutoFillCorrect += 1;
      }
    }
  }

  const ownerConfirmedFixtures = fixtures.filter(({ ownerConfirmed }) => ownerConfirmed).length;

  return {
    scoredFixtures: scored,
    ownerConfirmedFixtures,
    baselineReady: baselineScored >= EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES
      && confirmedFixturesWithoutResult.length === 0,
    baseline: {
      evaluatedFixtures: baselineScored,
      confirmedFixturesWithoutResult,
      suggestion: { correct: baselineCorrect, incorrect: baselineScored - baselineCorrect, accuracy: rate(baselineCorrect, baselineScored) },
      autoFill: {
        threshold: RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE,
        attempted: baselineAttempted,
        correct: baselineAutoFillCorrect,
        accuracy: rate(baselineAutoFillCorrect, baselineAttempted),
        coverage: rate(baselineAttempted, baselineScored),
      },
      omitted: baselineOmitted,
      omitRate: rate(baselineOmitted, baselineScored),
    },
    suggestion: { correct, incorrect: scored - correct, accuracy: rate(correct, scored) },
    autoFill: {
      threshold: RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE,
      attempted,
      correct: autoFillCorrect,
      accuracy: rate(autoFillCorrect, attempted),
      coverage: rate(attempted, scored),
    },
    omitted,
    omitRate: rate(omitted, scored),
    confusions: [...confusions.values()].sort((left, right) =>
      right.count - left.count
      || (left.expectedCategoryId ?? '').localeCompare(right.expectedCategoryId ?? '')
      || (left.suggestedCategoryId ?? '').localeCompare(right.suggestedCategoryId ?? '')),
    fixturesWithoutResult,
    resultsWithoutFixture: [...byFixture.keys()],
  };
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const categoryLabel = (id: string | null): string => id ?? '(omitted)';

/**
 * Human-readable report for the manifest. Any run whose fixture set is not yet owner-confirmed is
 * stamped NOT-A-BASELINE, because S1-R6 forbids publishing an accuracy number before the baseline exists.
 */
export function formatExpenseCategoryGoldenReport(
  score: ExpenseCategoryGoldenScore,
  runLabel = 'unlabelled run',
): string {
  const lines = [`# Expense category golden report — ${runLabel}`];
  if (!score.baselineReady) {
    lines.push(
      score.baseline.confirmedFixturesWithoutResult.length > 0
        // Not only a count problem: every confirmed row must be evaluated, or a run could publish
        // by quietly dropping its hard failures (selection bias).
        ? `NOT-A-BASELINE: ${score.baseline.confirmedFixturesWithoutResult.length} owner-confirmed`
          + ` fixture(s) have no evaluated result (listed below) and only ${score.baseline.evaluatedFixtures}/`
          + `${EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES} are evaluated. Every confirmed row must be`
          + ' evaluated before any number is a baseline (spec S1-R1/S1-R6).'
        : `NOT-A-BASELINE: only ${score.baseline.evaluatedFixtures}/${EXPENSE_CATEGORY_GOLDEN_MIN_CONFIRMED_FIXTURES}`
          + ' owner-confirmed fixtures have an evaluated result (spec S1-R1; a confirmed label without a run'
          + ' result proves nothing). The numbers below describe the harness, not the product — do not'
          + ' publish them as accuracy (S1-R6).',
    );
  } else {
    const { baseline } = score;
    lines.push(
      `BASELINE (owner-confirmed ∩ evaluated, n=${baseline.evaluatedFixtures}):`,
      `  suggestion accuracy: ${percent(baseline.suggestion.accuracy)} (${baseline.suggestion.correct} correct, ${baseline.suggestion.incorrect} incorrect)`,
      `  auto-fill >= ${baseline.autoFill.threshold}: accuracy ${percent(baseline.autoFill.accuracy)} (${baseline.autoFill.correct}/${baseline.autoFill.attempted}), coverage ${percent(baseline.autoFill.coverage)}`,
      `  omit rate: ${percent(baseline.omitRate)} (${baseline.omitted})`,
    );
  }
  if (score.baseline.confirmedFixturesWithoutResult.length) {
    lines.push(`owner-confirmed fixtures without a result: ${score.baseline.confirmedFixturesWithoutResult.join(', ')}`);
  }
  lines.push(
    'diagnostics (every evaluated fixture, synthetic starters included — never publishable):',
    `scored fixtures: ${score.scoredFixtures}`,
    `suggestion accuracy: ${percent(score.suggestion.accuracy)} (${score.suggestion.correct} correct, ${score.suggestion.incorrect} incorrect)`,
    `auto-fill >= ${score.autoFill.threshold}: accuracy ${percent(score.autoFill.accuracy)} (${score.autoFill.correct}/${score.autoFill.attempted}), coverage ${percent(score.autoFill.coverage)}`,
    `omit rate: ${percent(score.omitRate)} (${score.omitted})`,
    score.confusions.length ? 'confusion (expected -> suggested):' : 'confusion (expected -> suggested): none',
    ...score.confusions.map(({ expectedCategoryId, suggestedCategoryId, count }) =>
      `  ${categoryLabel(expectedCategoryId)} -> ${categoryLabel(suggestedCategoryId)}: ${count}`),
  );
  if (score.fixturesWithoutResult.length) lines.push(`fixtures without a result: ${score.fixturesWithoutResult.join(', ')}`);
  if (score.resultsWithoutFixture.length) lines.push(`results without a fixture: ${score.resultsWithoutFixture.join(', ')}`);
  return lines.join('\n');
}
