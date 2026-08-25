/**
 * Offline question-phrasing golden set for the compiled prepared-lane families.
 * Spec: docs/specs/mangmee-brain-real-answers-spec.md §5 (F1, F2), §8.3 ("คำถามจริง ≥ 20 แบบ/ภาษา ต่อ family").
 *
 * WHAT THIS IS: an EXPECTATION MANIFEST — the phrasings a family must cover and the ones it must NOT
 * claim, written down before any run. It is NOT provider evidence: nothing here calls a provider, the
 * gateway, the API, a database, or LINE. A hosted/UAT run routes these questions and hands its rows to
 * `scoreBrainFamilyQuestions`; only that run is evidence, and only for the SHA/environment it names.
 *
 * Root-scripts harness, same boundary rule as `line-ai-latency-autonomy.corpus.ts` and
 * `expense-category.golden.ts`: app code and app tests must NEVER import this file (that cross-boundary
 * import is what broke the gateway image build before). The compiled formatter registry in
 * `apps/ai-gateway/.../prepared-simple-read-formatter.ts` stays the authority on family keys; the two
 * literals below are a copy for offline scoring, and the gateway spec is what proves the real set.
 *
 * A family key here means only "this phrasing must reach that compiled family". Being compiled is not
 * being active: the operator allowlist is empty by default and each family still needs its own blind
 * pairwise eval before activation (plan Phase 5 gate).
 */

export const BRAIN_FAMILY_QUESTIONS_EVIDENCE_CLASS = 'expectation-manifest' as const;

export type BrainFamilyKey =
  | 'expense.list_recent::single_metric'
  | 'accounting.get_summary::list'
  | 'expense.get_daily_closing::single_metric';

export const F1_EXPENSE_SUMMARY: BrainFamilyKey = 'expense.list_recent::single_metric';
export const F2_ACCOUNTING_RECORDS: BrainFamilyKey = 'accounting.get_summary::list';
/** Owner decision 2026-08-26: "เงินเข้า–ออกวันนี้" is narrowed to the EXPENSE side ("ค่าใช้จ่ายวันนี้")
 *  and served by the existing daily-closing tool — no revenue tool exists yet, so revenue-side and
 *  profit questions belong to no family and must fall back (see FALLBACKS). */
export const F3_EXPENSE_TODAY: BrainFamilyKey = 'expense.get_daily_closing::single_metric';

/** §8.3 gate: at least this many phrasings per family PER LANGUAGE before a family's routing is scored. */
export const BRAIN_FAMILY_MIN_PHRASINGS_PER_LANGUAGE = 20;

export type BrainFamilyQuestionFixture = {
  id: string;
  /** The family under test. */
  familyKey: BrainFamilyKey;
  language: 'th' | 'en';
  question: string;
  /** The family the turn must be served by — `null` means it must NOT be served by a compiled family
   *  at all (the turn falls back to the full agentic path). Never "whichever family answers". */
  expectedFamilyKey: BrainFamilyKey | null;
  /** Why a `null` row must fall back. Positives need no note. */
  note?: string;
};

const rows = (
  familyKey: BrainFamilyKey,
  language: 'th' | 'en',
  prefix: string,
  questions: readonly string[],
): BrainFamilyQuestionFixture[] =>
  questions.map((question, index) => ({
    id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    familyKey,
    language,
    question,
    expectedFamilyKey: familyKey,
  }));

// ── F1 — สรุปค่าใช้จ่าย (expense.list_recent, current month by default) ──────────────────────────
const F1_TH = [
  'สรุปค่าใช้จ่าย',
  'สรุปค่าใช้จ่ายเดือนนี้',
  'เดือนนี้ใช้เงินไปเท่าไหร่',
  'ค่าใช้จ่ายเดือนนี้เท่าไหร่',
  'ขอสรุปค่าใช้จ่ายเดือนนี้หน่อย',
  'ยอดค่าใช้จ่ายรวมเดือนนี้',
  'เดือนนี้จ่ายไปทั้งหมดเท่าไร',
  'ค่าใช้จ่ายทั้งหมดตอนนี้เท่าไหร่',
  'รวมค่าใช้จ่ายเดือนนี้ให้หน่อย',
  'ดูค่าใช้จ่ายเดือนนี้',
  'สรุปรายจ่ายเดือนนี้',
  'รายจ่ายเดือนนี้เท่าไหร่',
  'เดือนนี้มีค่าใช้จ่ายกี่บาท',
  'ขอยอดรายจ่ายรวมของเดือนนี้',
  'ค่าใช้จ่ายวันที่ 1 ถึง 15 สิงหาคม เท่าไหร่',
  'สรุปค่าใช้จ่ายเดือนกรกฎาคม',
  'ค่าใช้จ่ายสัปดาห์นี้รวมเท่าไหร่',
  'เดือนที่แล้วใช้จ่ายไปเท่าไหร่',
  'ขอตัวเลขค่าใช้จ่ายเดือนนี้',
  'สรุปจำนวนเงินที่ใช้จ่ายเดือนนี้',
] as const;

const F1_EN = [
  'Summarize expenses',
  'How much did we spend this month?',
  'Total expenses this month',
  'What are our expenses this month?',
  'Give me the expense summary',
  'Expense total for this month',
  'How much have we spent so far this month?',
  "Show me this month's expenses",
  "What's the total spend this month?",
  'Monthly expense summary please',
  'Company expenses for this month',
  'Total spending for August',
  'Expenses from 1 to 15 August',
  'What did we spend last month?',
  'Sum of expenses this week',
  'Expense figures for this month',
  'How much in expenses is recorded this month?',
  'Give me total expenses for the current month',
  'Spend summary for this month',
  'What is our expense total right now?',
] as const;

// ── F2 — สรุปรายการเดือนนี้ (accounting.get_summary, counts + totals per document type) ──────────
const F2_TH = [
  'สรุปรายการเดือนนี้',
  'สรุปรายการเอกสารเดือนนี้',
  'เดือนนี้มีเอกสารกี่ใบ',
  'สรุปเอกสารบัญชีเดือนนี้',
  'เดือนนี้ออกเอกสารไปทั้งหมดกี่ใบ',
  'ขอสรุปเอกสารบัญชีของเดือนนี้',
  'เดือนนี้มีรายการทั้งหมดกี่รายการ',
  'สรุปรายการทั้งเดือนให้หน่อย',
  'รายการเดือนนี้เป็นยังไงบ้าง',
  'สรุปเอกสารแยกตามประเภทเดือนนี้',
  'เดือนนี้มีเอกสารแต่ละประเภทกี่ใบ',
  'ขอตัวเลขเอกสารบัญชีเดือนนี้',
  'สรุปรายการเดือนสิงหาคม',
  'สรุปรายการวันที่ 1 ถึง 15 สิงหาคม',
  'เดือนที่แล้วมีเอกสารกี่ใบ',
  'สรุปเอกสารที่ออกในเดือนนี้',
  'เดือนนี้ออกเอกสารรวมมูลค่าเท่าไหร่',
  'ขอสรุปยอดเอกสารบัญชีเดือนนี้',
  'ดูสรุปรายการเดือนนี้',
  'สรุปจำนวนเอกสารบัญชีเดือนนี้',
] as const;

const F2_EN = [
  "Summarize this month's records",
  'How many accounting documents this month?',
  'Accounting document summary for this month',
  'What documents did we issue this month?',
  "Give me this month's document summary",
  'Total documents issued this month',
  'Summary of records for this month',
  'How many invoices and receipts this month?',
  'Document counts by type this month',
  'Show the accounting summary for this month',
  "This month's accounting records summary",
  'How many documents do we have this month?',
  'Accounting documents from 1 to 15 August',
  'Document summary for August',
  "Last month's document summary",
  "Break down this month's documents by type",
  'Give me the totals per document type this month',
  'What is our document count for the current month?',
  'Records issued this month, summarized',
  'Monthly accounting document totals',
] as const;

// ── F3 — ค่าใช้จ่ายวันนี้ (expense.get_daily_closing, one day, expense side only) ────────────────
const F3_TH = [
  'ค่าใช้จ่ายวันนี้',
  'วันนี้ใช้เงินไปเท่าไหร่',
  'วันนี้จ่ายอะไรไปบ้าง',
  'สรุปวันนี้',
  'รายจ่ายวันนี้',
  'สรุปค่าใช้จ่ายวันนี้',
  'วันนี้มีค่าใช้จ่ายเท่าไหร่',
  'วันนี้จ่ายไปเท่าไร',
  'ขอสรุปรายจ่ายของวันนี้',
  'วันนี้ใช้จ่ายไปกี่บาท',
  'ค่าใช้จ่ายวันนี้กี่บาท',
  'ปิดร้านวันนี้มีค่าใช้จ่ายเท่าไหร่',
  'สรุปปิดร้านวันนี้',
  'วันนี้มีบิลอะไรเข้ามาบ้าง',
  'วันนี้ค้างจ่ายเท่าไหร่',
  'วันนี้จ่ายแล้วเท่าไหร่ ยังไม่จ่ายเท่าไหร่',
  'ดูค่าใช้จ่ายของวันนี้หน่อย',
  'คชจวันนี้เท่าไหร่',
  'วันนี้เสียเงินไปเท่าไหร่',
  'สรุปรายจ่ายวันนี้ให้หน่อย',
] as const;

const F3_EN = [
  'Today expenses',
  'How much did we spend today?',
  "What's today's expense total?",
  'Summarize today',
  "Today's spending",
  'How much money went out today?',
  'Expenses for today',
  'What did we pay today?',
  'Give me the daily expense closing',
  "Today's expense summary please",
  'How much have we spent today?',
  'Daily closing for today',
  'Show me expenses recorded today',
  'How much is unpaid from today?',
  'Paid and unpaid today',
  'Expense total today',
  'What bills came in today?',
  'Spend today',
  'Close out today expenses',
  'How many expense records today?',
] as const;

/**
 * Phrasings that must NOT be served by the family under test. A branch-scoped question is here by
 * DESIGN, not by omission: `FORBIDDEN_INPUT_KEY` in `packages/contracts/src/line-ai-prepared-plan.ts`
 * rejects any `branchId` in a proposed input, so a branch-scoped prepared plan never parses and the turn
 * always falls back to the full agentic path. No compiled family may claim those questions.
 */
const FALLBACKS: BrainFamilyQuestionFixture[] = [
  { id: 'f1-th-neg-01', familyKey: F1_EXPENSE_SUMMARY, language: 'th', question: 'ค่าใช้จ่ายวันนี้เป็นยังไงบ้าง', expectedFamilyKey: null, note: 'one-day operational closing = expense.get_daily_closing, not the period total' },
  { id: 'f1-th-neg-02', familyKey: F1_EXPENSE_SUMMARY, language: 'th', question: 'ค่าใช้จ่ายเดือนนี้แยกตามหมวดหมู่', expectedFamilyKey: null, note: 'grouping by category = expense.get_breakdown' },
  { id: 'f1-th-neg-03', familyKey: F1_EXPENSE_SUMMARY, language: 'th', question: 'ค่าใช้จ่ายสาขาสีลมเดือนนี้เท่าไหร่', expectedFamilyKey: null, note: 'branch-scoped: a branchId input is rejected by the plan parser, so the turn falls back' },
  { id: 'f1-th-neg-04', familyKey: F1_EXPENSE_SUMMARY, language: 'th', question: 'อนุมัติค่าใช้จ่ายรายการนี้ให้หน่อย', expectedFamilyKey: null, note: 'mutation — never a prepared read' },
  { id: 'f1-en-neg-01', familyKey: F1_EXPENSE_SUMMARY, language: 'en', question: 'How much did we spend today?', expectedFamilyKey: null, note: 'one-day closing tool' },
  { id: 'f1-en-neg-02', familyKey: F1_EXPENSE_SUMMARY, language: 'en', question: 'Expenses by category this month', expectedFamilyKey: null, note: 'breakdown tool' },
  { id: 'f1-en-neg-03', familyKey: F1_EXPENSE_SUMMARY, language: 'en', question: 'Expenses for the Silom branch this month', expectedFamilyKey: null, note: 'branch-scoped input is rejected by the plan parser' },
  { id: 'f2-th-neg-01', familyKey: F2_ACCOUNTING_RECORDS, language: 'th', question: 'ขอดูใบแจ้งหนี้ล่าสุด 5 ใบ', expectedFamilyKey: null, note: 'recent document list = accounting.list_recent_documents' },
  { id: 'f2-th-neg-02', familyKey: F2_ACCOUNTING_RECORDS, language: 'th', question: 'เอกสารของสาขาสีลมเดือนนี้มีกี่ใบ', expectedFamilyKey: null, note: 'branch-scoped input is rejected by the plan parser' },
  { id: 'f2-th-neg-03', familyKey: F2_ACCOUNTING_RECORDS, language: 'th', question: 'ยกเลิกเอกสารใบนี้ให้หน่อย', expectedFamilyKey: null, note: 'mutation — never a prepared read' },
  { id: 'f2-en-neg-01', familyKey: F2_ACCOUNTING_RECORDS, language: 'en', question: 'Show me the last 5 invoices', expectedFamilyKey: null, note: 'recent document list tool' },
  { id: 'f2-en-neg-02', familyKey: F2_ACCOUNTING_RECORDS, language: 'en', question: 'How many documents did the Silom branch issue?', expectedFamilyKey: null, note: 'branch-scoped input is rejected by the plan parser' },
  { id: 'f3-th-neg-01', familyKey: F3_EXPENSE_TODAY, language: 'th', question: 'เงินเข้าวันนี้เท่าไหร่', expectedFamilyKey: null, note: 'revenue side has no tool yet (owner 2026-08-26) — must fall back, never answered from expenses' },
  { id: 'f3-th-neg-02', familyKey: F3_EXPENSE_TODAY, language: 'th', question: 'วันนี้ขายได้เท่าไร รับเงินมาเท่าไหร่', expectedFamilyKey: null, note: 'receipts/revenue side — no compiled family' },
  { id: 'f3-th-neg-03', familyKey: F3_EXPENSE_TODAY, language: 'th', question: 'กำไรเดือนนี้เท่าไหร่', expectedFamilyKey: null, note: 'profit is neither cash movement nor an expense total' },
  { id: 'f3-th-neg-04', familyKey: F3_EXPENSE_TODAY, language: 'th', question: 'เงินเข้าออกวันนี้ของสาขาสีลม', expectedFamilyKey: null, note: 'revenue side AND branch-scoped: the plan parser rejects branch keys' },
  { id: 'f3-th-neg-05', familyKey: F3_EXPENSE_TODAY, language: 'th', question: 'ยอดเงินในบัญชีธนาคารตอนนี้เท่าไหร่', expectedFamilyKey: null, note: 'no bank feed (P18) — the answer must never come from recorded entries' },
  { id: 'f3-en-neg-01', familyKey: F3_EXPENSE_TODAY, language: 'en', question: 'How much money came in today?', expectedFamilyKey: null, note: 'revenue side has no tool yet' },
  { id: 'f3-en-neg-02', familyKey: F3_EXPENSE_TODAY, language: 'en', question: 'What is our profit this month?', expectedFamilyKey: null, note: 'profit is not an expense total' },
  { id: 'f3-en-neg-03', familyKey: F3_EXPENSE_TODAY, language: 'en', question: "Today's expenses for the Silom branch", expectedFamilyKey: null, note: 'branch-scoped input is rejected by the plan parser' },
  { id: 'f3-en-neg-04', familyKey: F3_EXPENSE_TODAY, language: 'en', question: "What's our bank balance right now?", expectedFamilyKey: null, note: 'no bank feed (P18)' },
];

export const BRAIN_FAMILY_QUESTION_FIXTURES: readonly BrainFamilyQuestionFixture[] = [
  ...rows(F1_EXPENSE_SUMMARY, 'th', 'f1-th', F1_TH),
  ...rows(F1_EXPENSE_SUMMARY, 'en', 'f1-en', F1_EN),
  ...rows(F2_ACCOUNTING_RECORDS, 'th', 'f2-th', F2_TH),
  ...rows(F2_ACCOUNTING_RECORDS, 'en', 'f2-en', F2_EN),
  ...rows(F3_EXPENSE_TODAY, 'th', 'f3-th', F3_TH),
  ...rows(F3_EXPENSE_TODAY, 'en', 'f3-en', F3_EN),
  ...FALLBACKS,
];

/** One row of a hosted/UAT routing run: which compiled family actually served the question (`null` =
 *  the turn fell back to the full agentic path). */
export type BrainFamilyQuestionRunResult = {
  questionId: string;
  routedFamilyKey: string | null;
};

export type BrainFamilyQuestionScore = {
  scored: number;
  matched: number;
  accuracy: number;
  mismatches: Array<{ questionId: string; expected: string | null; routed: string | null }>;
  /** Per family+language coverage, so a gate cannot be claimed from one language's rows. */
  coverage: Array<{ familyKey: BrainFamilyKey; language: 'th' | 'en'; phrasings: number; scored: number; matched: number; accuracy: number }>;
  coverageComplete: boolean;
  questionsWithoutResult: string[];
  resultsWithoutQuestion: string[];
};

const rate = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/** Score a routing run against the manifest. Pure: it reads the rows a runner collected, nothing else. */
export function scoreBrainFamilyQuestions(
  results: readonly BrainFamilyQuestionRunResult[],
  fixtures: readonly BrainFamilyQuestionFixture[] = BRAIN_FAMILY_QUESTION_FIXTURES,
): BrainFamilyQuestionScore {
  const byQuestion = new Map(results.map((result) => [result.questionId, result] as const));
  const questionsWithoutResult: string[] = [];
  const mismatches: BrainFamilyQuestionScore['mismatches'] = [];
  const buckets = new Map<string, { familyKey: BrainFamilyKey; language: 'th' | 'en'; phrasings: number; scored: number; matched: number }>();
  let scored = 0;
  let matched = 0;

  for (const fixture of fixtures) {
    const bucketKey = `${fixture.familyKey}::${fixture.language}`;
    const bucket = buckets.get(bucketKey)
      ?? { familyKey: fixture.familyKey, language: fixture.language, phrasings: 0, scored: 0, matched: 0 };
    // Coverage counts the phrasings a family must SERVE; a fallback row is a control, not coverage.
    if (fixture.expectedFamilyKey !== null) bucket.phrasings += 1;
    buckets.set(bucketKey, bucket);

    const result = byQuestion.get(fixture.id);
    if (!result) {
      questionsWithoutResult.push(fixture.id);
      continue;
    }
    byQuestion.delete(fixture.id);
    scored += 1;
    bucket.scored += 1;
    if (result.routedFamilyKey === fixture.expectedFamilyKey) {
      matched += 1;
      bucket.matched += 1;
    } else {
      mismatches.push({ questionId: fixture.id, expected: fixture.expectedFamilyKey, routed: result.routedFamilyKey });
    }
  }

  const coverage = [...buckets.values()]
    .map((bucket) => ({ ...bucket, accuracy: rate(bucket.matched, bucket.scored) }))
    .sort((left, right) => left.familyKey.localeCompare(right.familyKey) || left.language.localeCompare(right.language));

  return {
    scored,
    matched,
    accuracy: rate(matched, scored),
    mismatches,
    coverage,
    coverageComplete: coverage.every((bucket) => bucket.phrasings >= BRAIN_FAMILY_MIN_PHRASINGS_PER_LANGUAGE),
    questionsWithoutResult,
    resultsWithoutQuestion: [...byQuestion.keys()],
  };
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** Human-readable report for the manifest. Always stamped: these rows are expectations, and a run only
 *  becomes evidence when the report names the SHA/environment it came from. */
export function formatBrainFamilyQuestionsReport(score: BrainFamilyQuestionScore, runLabel = 'unlabelled run'): string {
  const lines = [
    `# Brain family question routing — ${runLabel}`,
    'EXPECTATION MANIFEST, NOT PROVIDER EVIDENCE: the fixtures are the expected routing, written offline.'
    + ' Numbers below describe one run; cite them only with the SHA/environment that produced them.',
    `routing accuracy: ${percent(score.accuracy)} (${score.matched}/${score.scored})`,
  ];
  if (!score.coverageComplete) {
    lines.push(`COVERAGE INCOMPLETE: every family needs ≥ ${BRAIN_FAMILY_MIN_PHRASINGS_PER_LANGUAGE} phrasings per language (spec §8.3).`);
  }
  lines.push(
    ...score.coverage.map(({ familyKey, language, phrasings, scored, matched, accuracy }) =>
      `  ${familyKey} [${language}]: ${matched}/${scored} = ${percent(accuracy)} (${phrasings} phrasings)`),
    score.mismatches.length ? 'mismatches (expected -> routed):' : 'mismatches: none',
    ...score.mismatches.map(({ questionId, expected, routed }) =>
      `  ${questionId}: ${expected ?? '(fallback)'} -> ${routed ?? '(fallback)'}`),
  );
  if (score.questionsWithoutResult.length) lines.push(`questions without a result: ${score.questionsWithoutResult.join(', ')}`);
  if (score.resultsWithoutQuestion.length) lines.push(`results without a question: ${score.resultsWithoutQuestion.join(', ')}`);
  return lines.join('\n');
}
