import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_INTAKE_ROUTE_INTENTS } from '@watchdog-bms/contracts';
import {
  LINE_AI_SUBSTITUTE_ROUTING_CORPUS,
  SUBSTITUTE_ROUTING_CATEGORY_MINIMUMS,
  type SubstituteRouteCase,
} from './line-ai-substitute-routing.corpus';

const SUB = 'SUBSTITUTE_RECEIPT_CONTINUATION';
const byCategory = (c: SubstituteRouteCase['category']) => LINE_AI_SUBSTITUTE_ROUTING_CORPUS.filter((row) => row.category === c);

// INTEGRITY-ONLY: these 9 tests pin the frozen manifest's SHAPE and safety invariants. They are NOT
// provider or full-flow evidence — actual routing agreement is measured by the offline operator-language
// provider runner over LINE_AI_PROTECTED_EVAL_CASE_IDS (evidence pending absent credentials).
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
    const zeroWrite: SubstituteRouteCase['category'][] = ['definition', 'negation', 'side_question', 'unrelated_expense', 'payment_voucher', 'reimbursement', 'status', 'multiple_targets', 'low_confidence', 'denied', 'ordinary_expense'];
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

  it('provider-scoring contract: outage-only rows are structural-only; negatives score by "not substitute"', () => {
    // The `unavailable` rows model a provider OUTAGE (expected UNSUPPORTED) — a healthy provider replay
    // cannot reproduce them, so the operator-language runner SKIPS them (they live only in this
    // structural coverage). Every other row is provider-eligible.
    const outageOnly = byCategory('unavailable');
    assert.ok(outageOnly.length >= 2 && outageOnly.every((r) => r.expectedIntent === 'UNSUPPORTED'),
      'outage rows expect UNSUPPORTED and are the only structural-only (not provider-scored) rows');
    // Protected negatives are accepted for ANY safe non-substitute route, so the runner scores them by
    // "actualIntent !== SUBSTITUTE_RECEIPT_CONTINUATION", not one pinned intent (e.g. a payment voucher
    // may safely be CLARIFY or MUTATION_REQUEST_REFUSAL).
    for (const row of LINE_AI_SUBSTITUTE_ROUTING_CORPUS.filter((r) => r.protectedNegative)) {
      assert.notEqual(row.expectedIntent, SUB, `${row.id}: a negative's pinned intent must be a non-substitute safe route`);
    }
  });
});
