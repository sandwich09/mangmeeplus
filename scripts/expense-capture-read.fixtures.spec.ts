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
  documentPageLines, expectationOf, fixtureMimeType, fixtureSpecs, plannedDiscount, plannedItems,
  plannedRowAmounts, plannedTotal, plannedVat, printedDocumentTotal, printedTotalLine, scoreFixture,
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
        const printed = pages.flat().filter((line) => line === printedTotalLine(document));
        assert.equal(printed.length, 1, `${spec.id} document ${index + 1}: one printed final total`);
        assert.ok(printed[0]!.includes(expectation.totals[index]!), `${spec.id}: ${printed[0]}`);
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

  /**
   * W10 D1. The fixture only proves anything if the two printed money columns really disagree the way
   * the FlowAccount template's do: the rows NET of their 5 % discount, the summary repeating the same
   * total once. If they ever agreed, the reader could pass §4.4 without the fix.
   */
  it('FX-PDF-DISCOUNT-NET-01 prints rows already net of a discount the summary repeats', () => {
    const spec = fixtureSpecs().find((row) => row.id === 'FX-PDF-DISCOUNT-NET-01')!;
    const document = spec.documents[0]!;
    const gross = plannedTotal(document.items);
    const discount = plannedDiscount(document);
    const net = printedDocumentTotal(document);
    assert.ok(Number(discount) > 0, 'a fixture with no discount proves nothing');
    assert.equal(Number(net).toFixed(2), (Number(gross) - Number(discount)).toFixed(2),
      'rows + summary discount = the printed pre-discount subtotal');
    const lines = documentPageLines(document, 1)[0]!;
    // Both columns are on the page, so a read that subtracts the discount twice lands 625 low.
    assert.ok(lines.some((line) => line.includes(`รวมเป็นเงิน`) && line.includes(gross)));
    assert.ok(lines.some((line) => line.includes('ส่วนลด 5 %') && line.includes(discount)));
    assert.ok(lines.some((line) => line.includes('จำนวนเงินรวมทั้งสิ้น') && line.includes(net)));
    // And every row prints its NET amount beside the gross unit price it was computed from.
    plannedRowAmounts(document).forEach((amount, index) => {
      const row = lines.find((line) => line.includes(document.items[index]!.description))!;
      assert.ok(row.includes(amount), `row ${index + 1} must print its net amount: ${row}`);
      assert.ok(row.includes(document.items[index]!.unitPrice), `and its printed unit price: ${row}`);
    });
  });

  /** W10 D2: the summary block must add up the way a 7-Eleven full form's does, to the satang. */
  it('FX-PDF-RETAIL-NV-01 prints an N/V split whose own summary block balances', () => {
    const spec = fixtureSpecs().find((row) => row.id === 'FX-PDF-RETAIL-NV-01')!;
    const document = spec.documents[0]!;
    const total = printedDocumentTotal(document);
    const vat = plannedVat(document);
    const lines = documentPageLines(document, 1)[0]!;
    const amountOf = (label: string) => {
      const line = lines.find((row) => row.trimStart().startsWith(label))!;
      assert.ok(line, `the block must print ${label}`);
      return Number(line.replace(label, '').trim());
    };
    const nonVat = amountOf('สินค้าไม่เสียภาษีมูลค่าเพิ่ม');
    assert.ok(nonVat > 0, 'the N rows are what the reader mistook for a discount');
    assert.equal(amountOf('ภาษีมูลค่าเพิ่ม').toFixed(2), Number(vat).toFixed(2));
    assert.equal(
      (amountOf('มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม') + Number(vat)).toFixed(2),
      amountOf('มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม').toFixed(2),
      'goods before VAT + VAT = goods with VAT',
    );
    assert.equal((amountOf('มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม') + nonVat).toFixed(2), Number(total).toFixed(2),
      'and that plus the non-VAT goods is the printed total');
    assert.equal(amountOf('หักส่วนลด'), 0, 'the layout prints a zero discount, which is not a discount');
    // Every row carries its own printed flag, which is what the legend explains.
    assert.equal(lines.filter((line) => / [NV]$/.test(line)).length, document.items.length);
  });

  /** W10 D3: the low-resolution lane is an IMAGE, which is the only lane with no text layer. */
  it('FX-IMG-SMALL-01 is an image fixture, and every other fixture is still a PDF', () => {
    const specs = fixtureSpecs();
    assert.equal(fixtureMimeType(specs.find((row) => row.id === 'FX-IMG-SMALL-01')!), 'image/jpeg');
    assert.deepEqual(
      specs.filter((row) => fixtureMimeType(row) === 'image/jpeg').map((row) => row.id),
      ['FX-IMG-SMALL-01'],
    );
    const document = specs.find((row) => row.id === 'FX-IMG-SMALL-01')!.documents[0]!;
    const lines = documentPageLines(document, 1)[0]!;
    assert.ok(lines.some((line) => line.includes(printedDocumentTotal(document))),
      'the totals block that went missing on the real 896-px screenshot is on the page');
    assert.ok(lines.some((line) => line.includes('ภาษีมูลค่าเพิ่ม')));
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

  /** W10: the two figures the old scorer had no slot for, and the reconciliation count beside them. */
  it('scores the printed discount and VAT the W10 layouts turn on', () => {
    const want = { ...expectation, totals: ['11875.00'], discounts: ['625.00'], vats: ['776.87'], reconciledDocuments: 1 };
    const right = scoreFixture(want, assembled({
      components: [
        { id: 'c1', documentRef: 'r1', label: 'ส่วนลด', amount: '625.00', role: 'applied_discount', scope: 'document', appliedStatus: 'applied', evidenceSpan: 'ส่วนลด 625.00' },
        { id: 'c2', documentRef: 'r1', label: 'ภาษีมูลค่าเพิ่ม 7%', amount: '776.87', role: 'tax_included', scope: 'document', appliedStatus: 'applied', evidenceSpan: 'VAT 776.87' },
      ],
      totals: [total('r1', '11875.00')],
      reconciliation: [{ documentRef: 'r1', status: 'reconciled', suspectedMissingPages: false }],
    }));
    assert.equal(right.discountsMatched, 1);
    assert.equal(right.discountsExpected, 1);
    assert.equal(right.vatMatched, 1);
    assert.equal(right.reconciledDocuments, 1);
    assert.equal(right.reconciledDocumentsExpected, 1);

    // The D2 failure mode: the VAT came back as a summary, so nothing scores it.
    const missed = scoreFixture(want, assembled({
      components: [{ id: 'c1', documentRef: 'r1', label: 'ภาษีมูลค่าเพิ่ม', amount: '776.87', role: 'summary', scope: 'document', appliedStatus: 'applied', evidenceSpan: 'VAT' }],
      reconciliation: [{ documentRef: 'r1', status: 'mismatch', difference: '-625', suspectedMissingPages: false }],
    }));
    assert.equal(missed.vatMatched, 0);
    assert.equal(missed.discountsMatched, 0);
    assert.equal(missed.reconciledDocuments, 0);
  });

  it('does not grade a zero discount or a document that prints no VAT', () => {
    const want = { ...expectation, discounts: ['0.00', '0.00'], vats: ['0.00'] };
    const score = scoreFixture(want, assembled());
    assert.equal(score.discountsExpected, 0);
    assert.equal(score.vatExpected, 0);
    assert.equal(score.discountsMatched, 0);
  });

  it('accepts the tax TOTAL the assembly derives from a printed VAT row', () => {
    const want = { ...expectation, vats: ['4.64'] };
    const score = scoreFixture(want, assembled({ totals: [{ documentRef: 'r1', kind: 'tax', amount: '4.64', evidenceSpan: 'ภาษีมูลค่าเพิ่ม: 4.64' }] }));
    assert.equal(score.vatMatched, 1);
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
