import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_INTAKE_ROUTE_INTENTS } from '@watchdog-bms/contracts';
import {
  EXPLICIT_EMPLOYEE_PAID_PHRASES,
  LINE_AI_SEMANTIC_COVERAGE_CASES,
  LINE_AI_SUBSTITUTE_ROUTING_CORPUS,
  SEMANTIC_COVERAGE_MINIMUMS,
  SUBSTITUTE_ROUTING_CATEGORY_MINIMUMS,
  semanticCoverageBuckets,
  type SemanticCoverageBucket,
  type SubstituteRouteCase,
} from './line-ai-substitute-routing.corpus';

const SUB = 'SUBSTITUTE_RECEIPT_CONTINUATION';
/** The reimbursement rows whose text states outright that the user advanced the money. */
const STRONG_CLAIM_ROWS = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.filter((row) => row.expectedSemanticOutcome === 'REIMBURSEMENT_CLAIM');
/** Routes that would start or mutate something — no question/negation/out-of-scope gold label may be one. */
const COMMAND_INTENTS = ['EXPENSE_DOCUMENT_CAPTURE', 'EXPENSE_DRAFT_CONTINUATION', 'EXPENSE_CAPTURE_CORRECTION', SUB, 'REIMBURSEMENT_REQUEST_START'];
const byCategory = (c: SubstituteRouteCase['category']) => LINE_AI_SUBSTITUTE_ROUTING_CORPUS.filter((row) => row.category === c);
const inBucket = (b: SemanticCoverageBucket) => LINE_AI_SEMANTIC_COVERAGE_CASES.filter((row) => semanticCoverageBuckets(row).includes(b));

// INTEGRITY-ONLY: the tests in both describes below pin the frozen manifest's SHAPE, its §14.1 coverage
// minimums and its safety invariants. They are NOT provider or full-flow evidence, and they observe no
// domain mutation — actual routing agreement is measured by the offline operator-language provider runner
// over LINE_AI_PROTECTED_EVAL_CASE_IDS (evidence pending absent credentials).
describe('substitute-routing corpus — frozen protected manifest (integrity-only)', () => {
  it('holds at least 40 unique Thai/English cases', () => {
    assert.ok(LINE_AI_SUBSTITUTE_ROUTING_CORPUS.length >= 40, `expected >=40, got ${LINE_AI_SUBSTITUTE_ROUTING_CORPUS.length}`);
    assert.equal(new Set(LINE_AI_SUBSTITUTE_ROUTING_CORPUS.map((r) => r.id)).size, LINE_AI_SUBSTITUTE_ROUTING_CORPUS.length, 'ids unique');
    assert.ok(LINE_AI_SUBSTITUTE_ROUTING_CORPUS.some((r) => r.language === 'th'));
    assert.ok(LINE_AI_SUBSTITUTE_ROUTING_CORPUS.some((r) => r.language === 'en'));
  });

  it('meets every required category minimum (no post-hoc trimming)', () => {
    for (const [category, min] of Object.entries(SUBSTITUTE_ROUTING_CATEGORY_MINIMUMS)) {
      assert.ok(byCategory(category as SubstituteRouteCase['category']).length >= min, `${category} needs >= ${min}`);
    }
    // The UAT dead-end paraphrase is present and routes to the substitute continuation.
    assert.ok(byCategory('uat_paraphrase').every((r) => r.expectedIntent === SUB && r.expectsSubstituteDispatch));
  });

  it('confirmation invariant: a NON-canonical semantic start dispatches but writes NOTHING (confirm first)', () => {
    // Every UAT paraphrase, and every non-canonical/English start, must confirm before a workflow write —
    // only the exact canonical command (and continue/pause/cancel/unavailable-canonical) may write.
    for (const row of byCategory('uat_paraphrase')) {
      assert.equal(row.expectsWorkflowWrite, false, `${row.id}: a paraphrase start must confirm (ledger only), not write`);
      assert.equal(row.expectsSubstituteDispatch, true, `${row.id}: it still dispatches to produce the confirmation`);
    }
    // English and loose-form starts confirm too.
    for (const id of ['start-en', 'start-th-2', 'receipt-unavailable-th', 'receipt-available-th']) {
      const row = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((r) => r.id === id)!;
      assert.equal(row.expectsWorkflowWrite, false, `${id}: non-canonical start confirms, no write`);
    }
    // The exact canonical explicit start DOES open directly.
    assert.equal(LINE_AI_SUBSTITUTE_ROUTING_CORPUS.find((r) => r.id === 'start-th')!.expectsWorkflowWrite, true);
  });

  it('every expectedIntent is a known contract intake intent (no invented routes)', () => {
    for (const row of LINE_AI_SUBSTITUTE_ROUTING_CORPUS) {
      assert.ok((LINE_INTAKE_ROUTE_INTENTS as readonly string[]).includes(row.expectedIntent), `${row.id}: ${row.expectedIntent}`);
    }
  });

  it('protected negatives NEVER route to or dispatch the substitute continuation and never write', () => {
    const negatives = LINE_AI_SUBSTITUTE_ROUTING_CORPUS.filter((r) => r.protectedNegative);
    assert.ok(negatives.length >= 15, 'a meaningful protected-negative set');
    for (const row of negatives) {
      assert.notEqual(row.expectedIntent, SUB, `${row.id} must not route to substitute`);
      assert.equal(row.expectsSubstituteDispatch, false, `${row.id} must not dispatch substitute`);
      assert.equal(row.expectsWorkflowWrite, false, `${row.id} must not write`);
    }
    // The two headline negatives are covered.
    assert.ok(LINE_AI_SUBSTITUTE_ROUTING_CORPUS.some((r) => r.message.includes('ค่ากาแฟ 65 บาท') && r.openSubstitute && r.expectedIntent === 'EXPENSE_DOCUMENT_CAPTURE'));
    assert.ok(byCategory('payment_voucher').length >= 3 && byCategory('reimbursement').length >= 3);
  });

  it('0-write gate: questions / negatives / denied / reads never expect a workflow write', () => {
    const zeroWrite: SubstituteRouteCase['category'][] = ['definition', 'negation', 'side_question', 'unrelated_expense', 'payment_voucher', 'reimbursement', 'status', 'multiple_targets', 'low_confidence', 'denied', 'ordinary_expense', 'reimbursement_read', 'question_not_command', 'claim_negation', 'stock_withdrawal', 'advance'];
    for (const row of LINE_AI_SUBSTITUTE_ROUTING_CORPUS) {
      if (zeroWrite.includes(row.category)) {
        assert.equal(row.expectsWorkflowWrite, false, `${row.id} (${row.category}) must be 0-write`);
      }
    }
    // Denied cases still DISPATCH (so the use case can reject) but write nothing.
    for (const row of byCategory('denied')) {
      assert.equal(row.expectsSubstituteDispatch, true, `${row.id} dispatches so the use case can deny`);
      assert.equal(row.expectsWorkflowWrite, false, `${row.id} rejects BEFORE any save`);
    }
  });

  it('write/dispatch invariants: a write implies a dispatch, and a dispatch implies substitute route or UNAVAILABLE fallback', () => {
    for (const row of LINE_AI_SUBSTITUTE_ROUTING_CORPUS) {
      if (row.expectsWorkflowWrite) assert.equal(row.expectsSubstituteDispatch, true, `${row.id}: write needs dispatch`);
      if (row.expectsSubstituteDispatch) {
        assert.ok(row.expectedIntent === SUB || row.category === 'unavailable', `${row.id}: dispatch only on substitute route or UNAVAILABLE fallback`);
      }
    }
  });

  it('UNAVAILABLE fallback catches ONLY canonical names, never a paraphrase (safe fail-closed)', () => {
    const rows = byCategory('unavailable');
    assert.ok(rows.some((r) => r.expectsSubstituteDispatch && r.message.includes('ใบรับรองแทนใบเสร็จ')), 'canonical name still dispatches on UNAVAILABLE');
    assert.ok(rows.some((r) => !r.expectsSubstituteDispatch && r.protectedNegative), 'a paraphrase cannot start on UNAVAILABLE');
  });

  it('reimbursement rows own REIMBURSEMENT_REQUEST_START with the semantic pair their own text supports, and 0 writes', () => {
    const rows = byCategory('reimbursement');
    assert.ok(rows.length >= 14, `reimbursement needs >= 14 rows (§14.1 th 10 + en 4), got ${rows.length}`);
    for (const row of rows) {
      assert.equal(row.expectedIntent, 'REIMBURSEMENT_REQUEST_START', `${row.id}: a claim owns its own route`);
      // Protected relative to SUBSTITUTE only — the pinned intent is still exact-scored by the runner.
      assert.equal(row.protectedNegative, true, `${row.id}: still never the substitute receipt`);
      assert.equal(row.expectsSubstituteDispatch, false, `${row.id}: no substitute dispatch`);
      assert.equal(row.expectsWorkflowWrite, false, `${row.id}: a claim route writes nothing in this release`);
      // Both fields or neither: the runner scores semanticOutcome and fundingSource as one pair.
      assert.ok(row.expectedSemanticOutcome && row.expectedFundingSource, `${row.id}: pins the FULL semantic pair`);
    }
    // A bare or greeting-mixed claim states no payer, so only the fail-closed pair is safe (both members veto
    // every mutation). Pinning anything stronger here would license expense capture off a guess.
    for (const row of rows.filter((r) => r.expectedSemanticOutcome !== 'REIMBURSEMENT_CLAIM')) {
      assert.equal(row.expectedSemanticOutcome, 'AMBIGUOUS', `${row.id}: a bare/mixed เบิก is ambiguous`);
      assert.equal(row.expectedFundingSource, 'UNKNOWN', `${row.id}: a bare/mixed เบิก never states who paid`);
    }
    // The adversarial complement: an ALL-ambiguous corpus would also pass a router that never reads the payer
    // at all, so several rows say outright that the user advanced the money and must score as the strong pair.
    assert.ok(STRONG_CLAIM_ROWS.length >= 4, `explicit employee-paid claims present, got ${STRONG_CLAIM_ROWS.length}`);
    for (const row of STRONG_CLAIM_ROWS) {
      assert.equal(row.expectedFundingSource, 'EMPLOYEE_PAID', `${row.id}: the payer IS stated — the router must read it`);
      // Mechanical guard against a strong pair pinned onto text that never states self-payment.
      assert.ok(EXPLICIT_EMPLOYEE_PAID_PHRASES.some((phrase) => row.message.includes(phrase)),
        `${row.id}: only a literal self-payment span licenses REIMBURSEMENT_CLAIM/EMPLOYEE_PAID`);
    }
    assert.ok(STRONG_CLAIM_ROWS.some((row) => row.message === 'สำรองจ่ายค่ารถ 120 บาท ขอเบิกคืน'), 'the original frozen strong row is kept');
    // The exact UAT mixed row: a greeting wrapped around a claim is business, not the 0-call greeting lane.
    const mixed = rows.find((row) => row.message === 'สวัสดีเบิกค่าโดยสารหน่อย');
    assert.ok(mixed, 'the exact mixed greeting + claim UAT row is present');
    assert.equal(mixed.expectedIntent, 'REIMBURSEMENT_REQUEST_START');
    assert.equal(mixed.style, 'mixed_casual_business');
  });

  it('provider-scoring contract: outage-only rows are structural-only; negatives score by "not substitute"', () => {
    // The `unavailable` rows model a provider OUTAGE (expected UNSUPPORTED) — a healthy provider replay
    // cannot reproduce them, so the operator-language runner SKIPS them (they live only in this
    // structural coverage). Every other row is provider-eligible.
    const outageOnly = byCategory('unavailable');
    assert.ok(outageOnly.length >= 2 && outageOnly.every((r) => r.expectedIntent === 'UNSUPPORTED'),
      'outage rows expect UNSUPPORTED and are the only structural-only (not provider-scored) rows');
    // Most protected negatives are accepted for ANY safe non-substitute route, so the runner scores them by
    // "actualIntent !== SUBSTITUTE_RECEIPT_CONTINUATION", not one pinned intent (e.g. a payment voucher
    // may safely be CLARIFY or MUTATION_REQUEST_REFUSAL). The exceptions are the categories whose exact
    // route the uat-correctness-latency contract pins (§7.2 table / §16): those carry the semantic pair.
    const exactScoredCategories: SubstituteRouteCase['category'][] = ['reimbursement', 'reimbursement_read', 'ordinary_expense', 'unrelated_expense'];
    for (const row of LINE_AI_SUBSTITUTE_ROUTING_CORPUS.filter((r) => r.protectedNegative)) {
      assert.notEqual(row.expectedIntent, SUB, `${row.id}: a negative's pinned intent must be a non-substitute safe route`);
      assert.equal(Boolean(row.expectedSemanticOutcome), Boolean(row.expectedFundingSource), `${row.id}: semantic fields always come as a pair`);
      if (row.expectedSemanticOutcome) {
        assert.ok(exactScoredCategories.includes(row.category), `${row.id}: only an exact-scored category may pin a semantic pair`);
      }
    }
  });
});

// The uat-correctness-latency §14.1 semantic dataset, proven mechanically over the SAME frozen corpus.
describe('substitute-routing corpus — §14.1 expense-vs-reimbursement semantic coverage', () => {
  it('holds at least 48 uniquely-identified semantic rows', () => {
    assert.ok(LINE_AI_SEMANTIC_COVERAGE_CASES.length >= 48, `§14.1 needs >= 48 semantic rows, got ${LINE_AI_SEMANTIC_COVERAGE_CASES.length}`);
    const ids = LINE_AI_SEMANTIC_COVERAGE_CASES.map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length, 'semantic row ids are unique');
    assert.equal(new Set(LINE_AI_SUBSTITUTE_ROUTING_CORPUS.map(({ id }) => id)).size, LINE_AI_SUBSTITUTE_ROUTING_CORPUS.length, 'corpus ids are unique');
    assert.equal(new Set(LINE_AI_SUBSTITUTE_ROUTING_CORPUS.map(({ message }) => message)).size, LINE_AI_SUBSTITUTE_ROUTING_CORPUS.length, 'no duplicated message pads the count');
  });

  it('meets every §14.1 bucket minimum, including the Thai/English split of claim starts', () => {
    for (const [bucket, min] of Object.entries(SEMANTIC_COVERAGE_MINIMUMS)) {
      const rows = inBucket(bucket as SemanticCoverageBucket);
      assert.ok(rows.length >= min, `${bucket} needs >= ${min}, got ${rows.length}`);
    }
    assert.ok(inBucket('reimbursement_start_th').every((r) => r.language === 'th'));
    assert.ok(inBucket('reimbursement_start_en').every((r) => r.language === 'en'));
    // All four §14.1 noise kinds are present, not six rows of one kind.
    const styles = new Set(LINE_AI_SEMANTIC_COVERAGE_CASES.map((r) => r.style).filter(Boolean));
    assert.deepEqual([...styles].sort(), ['colloquial', 'mixed_casual_business', 'multi_bubble', 'typo']);
    // A multi-bubble row is represented the way the buffer joins bubbles (joinGroupText → '\n').
    assert.ok(LINE_AI_SEMANTIC_COVERAGE_CASES.filter((r) => r.style === 'multi_bubble').every((r) => r.message.includes('\n')));
  });

  it('every semantic row is a routing expectation with ZERO substitute workflow write', () => {
    for (const row of LINE_AI_SEMANTIC_COVERAGE_CASES) {
      if (row.category === 'uat_paraphrase' || row.category === 'start') continue; // the substitute rows own their route
      assert.equal(row.protectedNegative, true, `${row.id}: a semantic negative`);
      assert.equal(row.expectsSubstituteDispatch, false, `${row.id}: never dispatches the substitute continuation`);
      assert.equal(row.expectsWorkflowWrite, false, `${row.id}: zero workflow write`);
    }
  });

  it('the two wrong-domain directions are both pinned: a claim is never capture, a spend note is never a claim', () => {
    for (const row of inBucket('reimbursement_start_th').concat(inBucket('reimbursement_start_en'))) {
      assert.notEqual(row.expectedIntent, 'EXPENSE_DOCUMENT_CAPTURE', `${row.id}: a claim must never become an ExpenseRecord`);
    }
    for (const row of inBucket('ordinary_expense_negative')) {
      assert.equal(row.expectedIntent, 'EXPENSE_DOCUMENT_CAPTURE', `${row.id}: an ordinary spend note still captures, never becomes a claim`);
      // Under `reimbursementSemantic` the server's isSemanticContradiction rewrites ANY capture whose pair
      // is not BUSINESS_EXPENSE + COMPANY_PAID into a CLARIFY. So the pair is the ROUTE CONTRACT for every
      // capture row — leaving it unpinned would let a replay score capture + UNKNOWN as agreement for an
      // answer the dispatcher turns into a question. It classifies the expense room, not the real payer.
      assert.equal(row.expectedSemanticOutcome, 'BUSINESS_EXPENSE', `${row.id}: capture requires BUSINESS_EXPENSE`);
      assert.equal(row.expectedFundingSource, 'COMPANY_PAID', `${row.id}: capture requires COMPANY_PAID`);
    }
  });

  it('reads stay reads, and questions / negations / stock / advance never carry a command gold label', () => {
    for (const row of inBucket('reimbursement_read')) {
      assert.equal(row.expectedIntent, 'BUSINESS_READ_QUESTION', `${row.id}: §7.2 pins the read route`);
    }
    const neverCommand = [...inBucket('question_not_command'), ...inBucket('claim_negation'), ...inBucket('stock_withdrawal'), ...inBucket('advance'), ...inBucket('payment_voucher')];
    for (const row of neverCommand) {
      assert.ok(!COMMAND_INTENTS.includes(row.expectedIntent), `${row.id}: ${row.expectedIntent} would start or mutate something`);
    }
  });
});
