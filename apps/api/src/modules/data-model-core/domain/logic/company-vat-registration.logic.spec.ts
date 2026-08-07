import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  effectiveVatStatus,
  mirrorBitFor,
  planVatFactChange,
  type VatFactPlan,
  type VatFactRejection,
  type VatFactRow,
} from './company-vat-registration.logic';

const TODAY = '2026-08-04';

function fact(overrides: Partial<VatFactRow> & Pick<VatFactRow, 'id' | 'effectiveFrom'>): VatFactRow {
  return { status: 'REGISTERED', effectiveTo: null, supersededAt: null, ...overrides };
}

/** The planner returns `VatFactPlan | VatFactRejection` and only the plan branch carries `kind`,
 *  so narrow here instead of reading it off the union. A rejection still fails the assertion —
 *  now with the rejection printed rather than an undefined comparison. */
function asPlan(result: VatFactPlan | VatFactRejection): VatFactPlan {
  assert.ok('kind' in result, `expected a plan, got rejection ${JSON.stringify(result)}`);
  return result;
}

describe('effectiveVatStatus', () => {
  // The reason the accessor exists instead of a boolean column: "we were never told" is a real
  // state, and answering NOT_REGISTERED for it would let the system decide a legal status.
  it('answers UNKNOWN when no fact covers the date', () => {
    assert.equal(effectiveVatStatus([], TODAY), 'UNKNOWN');
    assert.equal(effectiveVatStatus([fact({ id: 'f1', effectiveFrom: '2026-09-01' })], TODAY), 'UNKNOWN');
    assert.equal(
      effectiveVatStatus([fact({ id: 'f1', effectiveFrom: '2020-01-01', effectiveTo: '2026-01-01' })], TODAY),
      'UNKNOWN',
    );
  });

  it('reads the half-open interval, so the end date belongs to the next fact', () => {
    const facts = [
      fact({ id: 'f1', effectiveFrom: '2020-01-01', effectiveTo: '2026-08-04' }),
      fact({ id: 'f2', effectiveFrom: '2026-08-04', status: 'NOT_REGISTERED' }),
    ];
    assert.equal(effectiveVatStatus(facts, '2026-08-03'), 'REGISTERED');
    assert.equal(effectiveVatStatus(facts, '2026-08-04'), 'NOT_REGISTERED');
  });

  it('ignores superseded rows', () => {
    const facts = [
      fact({ id: 'f1', effectiveFrom: '2020-01-01' }),
      fact({ id: 'f2', effectiveFrom: '2026-01-01', status: 'NOT_REGISTERED', supersededAt: new Date() }),
    ];
    assert.equal(effectiveVatStatus(facts, TODAY), 'REGISTERED');
    assert.equal(mirrorBitFor(facts, TODAY), true);
  });
});

// Re-answering with the SAME effective date used to insert a second live fact over the first, so
// two rows covered the same day with opposite answers and the accessor's reply depended on the
// order the rows arrived in. Reachable from the ordinary "fix the answer I just gave" action, and
// it silently drove the wrong expense capture mode and refused legitimate input-VAT claims.
describe('same-date answers never leave overlapping live facts', () => {
  const existing = fact({ id: 'f1', effectiveFrom: TODAY, status: 'REGISTERED' });

  it('supersedes the fact it replaces instead of stacking on it', () => {
    const plan = asPlan(planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: TODAY },
      [existing],
      { today: TODAY },
    ));

    assert.equal(plan.kind, 'APPLY');
    assert.deepEqual(plan.kind === 'APPLY' ? plan.supersedeFactIds : [], ['f1']);
    // Closing it at its own start would leave the empty interval [F, F): invisible to the
    // accessor but still live, so a future-dated correction would 409 against a dead fact.
    assert.equal(plan.kind === 'APPLY' ? plan.closeFact : 'x', undefined);
  });

  it('still closes — not supersedes — a fact that started earlier', () => {
    const plan = asPlan(planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: TODAY },
      [fact({ id: 'f1', effectiveFrom: '2020-01-15' })],
      { today: TODAY },
    ));

    assert.deepEqual(plan.kind === 'APPLY' ? plan.supersedeFactIds : ['x'], []);
    assert.deepEqual(plan.kind === 'APPLY' ? plan.closeFact : null, { id: 'f1', effectiveTo: TODAY });
  });

  // A future-dated fact is governed by the replaceFactId rule (§5.3(1)-(2)) and never reaches the
  // overlap path, so the bug was only ever reachable at or before today — which is exactly where
  // "fix the answer I just gave" lands.
  it('leaves the future-fact conflict rule in charge of future dates', () => {
    const plan = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-09-01' },
      [fact({ id: 'f1', effectiveFrom: '2026-09-01' })],
      { today: TODAY },
    );
    assert.equal('code' in plan ? plan.code : 'plan', 'vat_registration_future_fact_conflict');
  });

  // §5.3(6) must survive the change: an identical answer is still nothing to record.
  it('keeps the same-status no-op', () => {
    const plan = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'REGISTERED', effectiveFrom: TODAY },
      [existing],
      { today: TODAY },
    );
    assert.equal('kind' in plan ? plan.kind : 'rejection', 'NO_OP');
  });
});

describe('effectiveVatStatus is deterministic when history overlaps anyway', () => {
  const older = { id: 'a', status: 'NOT_REGISTERED' as const, effectiveFrom: '2026-08-05', effectiveTo: null, supersededAt: null, answeredAt: new Date('2026-08-05T01:00:00Z') };
  const newer = { id: 'b', status: 'REGISTERED' as const, effectiveFrom: '2026-08-05', effectiveTo: null, supersededAt: null, answeredAt: new Date('2026-08-05T02:00:00Z') };

  it('answers the later of two same-start facts, whatever order they arrive in', () => {
    assert.equal(effectiveVatStatus([older, newer], '2026-08-05'), 'REGISTERED');
    assert.equal(effectiveVatStatus([newer, older], '2026-08-05'), 'REGISTERED');
  });

  it('falls back to a stable id order when answeredAt is missing or equal', () => {
    const a = { ...older, answeredAt: null };
    const b = { ...newer, answeredAt: null };
    assert.equal(effectiveVatStatus([a, b], '2026-08-05'), 'REGISTERED');
    assert.equal(effectiveVatStatus([b, a], '2026-08-05'), 'REGISTERED');
  });
});

describe('planVatFactChange — UPSERT_FACT', () => {
  it('inserts the first fact with nothing to close', () => {
    const plan = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'REGISTERED', effectiveFrom: '2020-01-15' },
      [],
      { today: TODAY },
    );
    assert.deepEqual(plan, {
      kind: 'APPLY',
      supersedeFactIds: [],
      closeFact: undefined,
      insertFact: { status: 'REGISTERED', effectiveFrom: '2020-01-15' },
    });
  });

  it('closes the covering interval at the new boundary', () => {
    const plan = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-08-04' },
      [fact({ id: 'f1', effectiveFrom: '2020-01-15' })],
      { today: TODAY },
    );
    assert.equal(asPlan(plan).kind, 'APPLY');
    assert.deepEqual((plan as any).closeFact, { id: 'f1', effectiveTo: '2026-08-04' });
  });

  // Fragmenting the history into intervals that describe no change makes every later reader
  // work harder for nothing, and makes "when did this change" unanswerable.
  it('is a no-op when the same status already covers the date with no gap', () => {
    const plan = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'REGISTERED', effectiveFrom: '2026-08-04' },
      [fact({ id: 'f1', effectiveFrom: '2020-01-15' })],
      { today: TODAY },
    );
    assert.equal(asPlan(plan).kind, 'NO_OP');
  });

  it('is NOT a no-op when an UNKNOWN gap separates the two', () => {
    const plan = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'REGISTERED', effectiveFrom: '2026-08-04' },
      [fact({ id: 'f1', effectiveFrom: '2020-01-15', effectiveTo: '2025-01-01' })],
      { today: TODAY },
    );
    assert.equal(asPlan(plan).kind, 'APPLY');
    assert.equal((plan as any).closeFact, undefined);
  });

  it('refuses a second future fact unless the pending one is named', () => {
    const facts = [fact({ id: 'f1', effectiveFrom: '2020-01-15' }), fact({ id: 'f2', effectiveFrom: '2026-09-01', status: 'NOT_REGISTERED' })];
    const blocked = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-10-01' },
      facts,
      { today: TODAY },
    );
    assert.equal((blocked as any).code, 'vat_registration_future_fact_conflict');

    const replaced = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-10-01', replaceFactId: 'f2' },
      facts,
      { today: TODAY },
    );
    assert.equal(asPlan(replaced).kind, 'APPLY');
    assert.deepEqual((replaced as any).supersedeFactIds, ['f2']);
    assert.deepEqual((replaced as any).closeFact, { id: 'f1', effectiveTo: '2026-10-01' });
  });

  it('rejects a replaceFactId that is not the latest pending future fact', () => {
    const rejection = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'REGISTERED', effectiveFrom: '2026-10-01', replaceFactId: 'f1' },
      [fact({ id: 'f1', effectiveFrom: '2020-01-15' })],
      { today: TODAY },
    );
    assert.equal((rejection as any).code, 'validation');
  });

  it('refuses a date more than a year out', () => {
    const rejection = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'REGISTERED', effectiveFrom: '2027-08-05' },
      [],
      { today: TODAY },
    );
    assert.equal((rejection as any).code, 'validation');
    assert.equal(
      asPlan(planVatFactChange({ kind: 'UPSERT_FACT', status: 'REGISTERED', effectiveFrom: '2027-08-04' }, [], { today: TODAY })).kind,
      'APPLY',
    );
  });

  it('refuses a backdated change that rewrites a filed period', () => {
    const rejection = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-01-15' },
      [fact({ id: 'f1', effectiveFrom: '2020-01-15' })],
      { today: TODAY, lockedPeriods: [{ from: '2026-01-01', to: '2026-02-01' }] },
    );
    assert.equal((rejection as any).code, 'vat_registration_backdated_crosses_filed_period');
  });

  // When thai_tax is off there are no TaxPeriod rows at all. The absence of evidence is not
  // evidence of a filing — the answer is recorded, with its audit trail, rather than refused.
  it('records the change when there are no known periods at all', () => {
    const plan = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-01-15' },
      [fact({ id: 'f1', effectiveFrom: '2020-01-15' })],
      { today: TODAY, lockedPeriods: [] },
    );
    assert.equal(asPlan(plan).kind, 'APPLY');
  });

  it('allows a backdated change that stops before every filed period', () => {
    const plan = planVatFactChange(
      { kind: 'UPSERT_FACT', status: 'NOT_REGISTERED', effectiveFrom: '2026-03-01' },
      [fact({ id: 'f1', effectiveFrom: '2020-01-15' })],
      { today: TODAY, lockedPeriods: [{ from: '2026-01-01', to: '2026-02-01' }] },
    );
    assert.equal(asPlan(plan).kind, 'APPLY');
  });
});

describe('planVatFactChange — CANCEL_FUTURE', () => {
  // The bug this closes: superseding the future fact alone leaves the previous interval ending
  // at a date that no longer means anything, so from that day the accessor answers UNKNOWN and
  // the company silently loses the ability to issue tax invoices.
  it('restores the previous fact to open-ended', () => {
    const facts = [
      fact({ id: 'f1', effectiveFrom: '2020-01-15', effectiveTo: '2026-09-01' }),
      fact({ id: 'f2', effectiveFrom: '2026-09-01', status: 'NOT_REGISTERED' }),
    ];
    const plan = planVatFactChange({ kind: 'CANCEL_FUTURE', replaceFactId: 'f2' }, facts, { today: TODAY });
    assert.deepEqual(plan, { kind: 'APPLY', supersedeFactIds: ['f2'], reopenFactId: 'f1' });
  });

  it('does not reopen a fact that was already closed before the cancelled one', () => {
    const facts = [
      fact({ id: 'f1', effectiveFrom: '2020-01-15', effectiveTo: '2024-01-01' }),
      fact({ id: 'f2', effectiveFrom: '2026-09-01', status: 'NOT_REGISTERED' }),
    ];
    const plan = planVatFactChange({ kind: 'CANCEL_FUTURE', replaceFactId: 'f2' }, facts, { today: TODAY });
    assert.equal((plan as any).reopenFactId, undefined);
  });

  it('rejects cancelling something that is not the latest pending future fact', () => {
    const rejection = planVatFactChange(
      { kind: 'CANCEL_FUTURE', replaceFactId: 'f1' },
      [fact({ id: 'f1', effectiveFrom: '2020-01-15' })],
      { today: TODAY },
    );
    assert.equal((rejection as any).code, 'validation');
  });
});
