/**
 * The arithmetic and the scoring behind the paid capture-read benchmark.
 *
 * A benchmark that grades itself is only worth what its grader is worth: if `plannedTotal` and the
 * printed TOTAL ever disagree, every "totals 1/1" in the research note is meaningless. These cases
 * cost nothing and run in CI; the run they grade costs real money and never does.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpenseCaptureAssembledObservations } from '@watchdog-bms/contracts';
import {
  documentPageLines, expectationOf, fixtureSpecs, plannedItems, plannedTotal, scoreFixture,
} from './expense-capture-read.fixtures';

const assembled = (over: Partial<ExpenseCaptureAssembledObservations> = {}): ExpenseCaptureAssembledObservations => ({
  documents: [], items: [], components: [], totals: [], payments: [], refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
  reconciliation: [], multiDocument: false,
  ...over,
});
const total = (documentRef: string, amount: string) =>
  ({ documentRef, kind: 'document_total' as const, amount, evidenceSpan: `TOTAL ${amount}` });

describe('capture-read fixtures', () => {
  it('prints the total it claims to expect, to the satang', () => {
    for (const spec of fixtureSpecs()) {
      const expectation = expectationOf(spec);
      spec.documents.forEach((document, index) => {
        const pages = documentPageLines(document, Math.max(1, Math.floor(spec.pages / spec.documents.length)));
        const printed = pages.flat().find((line) => line.startsWith('TOTAL '));
        assert.equal(printed, `TOTAL ${expectation.totals[index]} THB`, `${spec.id} document ${index + 1}`);
      });
    }
  });

  it('prints every item exactly once across the pages of its document', () => {
    for (const spec of fixtureSpecs()) {
      const perDocument = Math.max(1, Math.floor(spec.pages / spec.documents.length));
      for (const document of spec.documents) {
        const lines = documentPageLines(document, perDocument).flat();
        for (const item of document.items) {
          assert.equal(lines.filter((line) => line.includes(item.description)).length, 1,
            `${spec.id}: ${item.description}`);
        }
      }
    }
  });

  it('prints the missing-page evidence UXE-15 needs, and only on that fixture', () => {
    const missing = fixtureSpecs().find((spec) => spec.id === 'FX-PDF-MISSING-01')!;
    const printed = documentPageLines(missing.documents[0]!, missing.pages)
      .map((page) => page.find((line) => line.startsWith('Page ')));
    assert.deepEqual(printed, ['Page 1 of 3', 'Page 3 of 3'], 'a two-page file that says it has three');
    assert.equal(expectationOf(missing).suspectedMissingPages, true);

    const ordinary = fixtureSpecs().find((spec) => spec.id === 'FX-PDF-02')!;
    assert.deepEqual(
      documentPageLines(ordinary.documents[0]!, 2).map((page) => page.find((line) => line.startsWith('Page '))),
      ['Page 1 of 2', 'Page 2 of 2'],
    );
    assert.equal(expectationOf(ordinary).suspectedMissingPages, false);
  });

  it('adds the price ladder up with decimals, not floats', () => {
    assert.equal(plannedTotal([{ description: 'x', quantity: 3, unitPrice: '0.10' }]), '0.30');
    assert.equal(plannedTotal(plannedItems(3)), plannedTotal(plannedItems(3)), 'and it is deterministic');
    assert.notEqual(plannedTotal(plannedItems(3)), plannedTotal(plannedItems(3, 1)), 'the offset really shifts the ladder');
  });

  it('gives every fixture a unique id and a non-empty acceptance pointer', () => {
    const specs = fixtureSpecs();
    assert.equal(new Set(specs.map((spec) => spec.id)).size, specs.length);
    for (const spec of specs) assert.match(spec.proves, /A\d\d|UXE-\d\d/);
  });
});

describe('capture-read scoring', () => {
  const expectation = expectationOf(fixtureSpecs().find((spec) => spec.id === 'FX-PDF-MULTI-03')!);

  it('matches totals by value, so a differently ordered read still scores 3/3', () => {
    const score = scoreFixture(expectation, assembled({
      documents: [1, 2, 3].map((index) => ({ ref: `r${index}`, pageIndexes: [index - 1] })) as never,
      totals: [total('r1', expectation.totals[2]!), total('r2', expectation.totals[0]!), total('r3', expectation.totals[1]!)],
    }));
    assert.equal(score.totalsMatched, 3);
    assert.equal(score.totalsExpected, 3);
    assert.equal(score.documentsFound, 3);
  });

  it('does not let one right answer pay for two identical expectations', () => {
    const twins = { ...expectation, totals: ['100.00', '100.00'] };
    assert.equal(scoreFixture(twins, assembled({ totals: [total('r1', '100.00')] })).totalsMatched, 1);
    assert.equal(scoreFixture(twins, assembled({ totals: [total('r1', '100.00'), total('r2', '100.00')] })).totalsMatched, 2);
  });

  it('accepts the thousands separator a receipt prints, and refuses a near miss', () => {
    const one = { ...expectation, totals: ['1335.00'] };
    assert.equal(scoreFixture(one, assembled({ totals: [total('r1', '1,335.00')] })).totalsMatched, 1);
    assert.equal(scoreFixture(one, assembled({ totals: [total('r1', '1335.01')] })).totalsMatched, 0);
    assert.equal(scoreFixture(one, assembled({ totals: [total('r1', 'ประมาณ 1335')] })).totalsMatched, 0);
  });

  it('counts only document totals, never a subtotal the page also printed', () => {
    const one = { ...expectation, totals: ['1335.00'] };
    const score = scoreFixture(one, assembled({
      totals: [{ documentRef: 'r1', kind: 'merchandise', amount: '1335.00', evidenceSpan: 'Subtotal' } as never],
    }));
    assert.equal(score.totalsMatched, 0);
    assert.deepEqual(score.totalsFound, []);
  });

  it('reports the reconciliation and the missing-page verdict beside what was expected', () => {
    const score = scoreFixture({ ...expectation, suspectedMissingPages: true }, assembled({
      reconciliation: [{ documentRef: 'r1', status: 'mismatch', difference: '2.00', suspectedMissingPages: true }],
    }));
    assert.deepEqual(score.reconciliation, [{ documentRef: 'r1', status: 'mismatch', difference: '2.00' }]);
    assert.equal(score.suspectedMissingPages, true);
    assert.equal(score.suspectedMissingPagesExpected, true);
  });
});
