/**
 * Synthetic fixtures + accuracy scoring for `expense-capture-read-benchmark.ts` (appendix §13).
 *
 * Separate from the benchmark on purpose: the benchmark's module body runs a real, paid Bedrock
 * pass, so nothing may import it — while everything decided HERE is pure arithmetic and string
 * layout, and `expense-capture-read.fixtures.spec.ts` covers it for free.
 *
 * Synthetic only. Every issuer, tax id and item is invented here; no customer document, no
 * personal data and no LINE content ever reaches this file or the provider behind it.
 */
import Decimal from 'decimal.js';
import type { ExpenseCaptureAssembledObservations } from '@watchdog-bms/contracts';



export type PlannedItem = { description: string; quantity: number; unitPrice: string };
export type PlannedDocument = {
  ref: string;
  issuer: string;
  documentNumber: string;
  documentDate: string;
  items: PlannedItem[];
  /** Printed "page n of m" on every page of this document — the A82 / UXE-15 signal. */
  printedPages?: { of: number; only?: number[] };
  /**
   * W10 D1: a per-line discount column printed as this percent, with the SAME total repeated once in
   * the summary — the FlowAccount/PEAK/Leceipt layout every marketplace seller's e-tax tool produces.
   * The row's own money column is then already net of it.
   */
  lineDiscountPercent?: number;
  /** W10 D1/D2: VAT printed as already INSIDE the document total, at this percent. */
  vatIncludedPercent?: number;
  /** W10 D2: 1-based row numbers the page flags "N" (ไม่เสียภาษี). Every other row prints "V". */
  nonVatRows?: number[];
};

export type FixtureSpec = {
  id: string;
  proves: string;
  /** `low-res-scan` is an IMAGE attachment, not a PDF: the only lane with no text layer to fall back on. */
  kind: 'text-pdf' | 'scan-pdf' | 'big-page-pdf' | 'low-res-scan';
  documents: PlannedDocument[];
  /** Pages of the produced file. For a text PDF this is how the items are laid out. */
  pages: number;
  expectSuspectedMissingPages: boolean;
};

/** What a fixture's bytes ARE, so the benchmark hands the preprocessor the right media type. */
export function fixtureMimeType(spec: Pick<FixtureSpec, 'kind'>): 'application/pdf' | 'image/jpeg' {
  return spec.kind === 'low-res-scan' ? 'image/jpeg' : 'application/pdf';
}

/** Deterministic line items: the price ladder is fixed, so the expected total is a fact, not a guess. */
export function plannedItems(count: number, offset = 0): PlannedItem[] {
  const names = ['Cement bag', 'Steel rod 9mm', 'Paint white 5L', 'PVC pipe 2in', 'Wire roll 30m', 'Sand sack', 'Gravel sack', 'Tile box'];
  return Array.from({ length: count }, (_, index) => ({
    description: `${names[(index + offset) % names.length]} ${String(index + offset + 1).padStart(2, '0')}`,
    quantity: ((index + offset) % 3) + 1,
    unitPrice: new Decimal(35 + ((index + offset) % 11) * 15).toFixed(2),
  }));
}

/** Σ quantity × unitPrice, to two decimals — the GROSS goods figure ("รวมเป็นเงิน"). */
export function plannedTotal(items: readonly PlannedItem[]): string {
  return items
    .reduce((sum, item) => sum.add(new Decimal(item.unitPrice).mul(item.quantity)), new Decimal(0))
    .toFixed(2);
}

const round2 = (value: Decimal): Decimal => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * W10 D1: what each row prints in its own money column.
 *
 * With a line discount that is the row's NET amount, rounded per row exactly as a printing system
 * rounds it — so the summary discount below is the difference between the two printed columns and
 * never a figure this file computed a second way.
 */
export function plannedRowAmounts(document: PlannedDocument): string[] {
  const percent = new Decimal(document.lineDiscountPercent ?? 0);
  return document.items.map((item) => {
    const gross = new Decimal(item.unitPrice).mul(item.quantity);
    return round2(gross.minus(gross.mul(percent).div(100))).toFixed(2);
  });
}

/** The ONE discount the summary prints: gross minus what the rows actually printed. */
export function plannedDiscount(document: PlannedDocument): string {
  const gross = new Decimal(plannedTotal(document.items));
  const rows = plannedRowAmounts(document).reduce((sum, amount) => sum.add(amount), new Decimal(0));
  return round2(gross.minus(rows)).toFixed(2);
}

/** The N-flagged part of a retail basket (W10 D2), '0.00' when the page flags nothing. */
export function plannedNonVatGoods(document: PlannedDocument): string {
  const flagged = new Set(document.nonVatRows ?? []);
  return plannedRowAmounts(document)
    .reduce((sum, amount, index) => (flagged.has(index + 1) ? sum.add(amount) : sum), new Decimal(0))
    .toFixed(2);
}

/** The VAT the page prints as already inside its total: on the V rows only. '0.00' when none. */
export function plannedVat(document: PlannedDocument): string {
  const percent = new Decimal(document.vatIncludedPercent ?? 0);
  if (percent.isZero()) return '0.00';
  const taxed = new Decimal(printedDocumentTotal(document)).minus(plannedNonVatGoods(document));
  return round2(taxed.mul(percent).div(percent.plus(100))).toFixed(2);
}

/** What the document prints as its own final total: the rows as printed, nothing else. */
export function printedDocumentTotal(document: PlannedDocument): string {
  return plannedRowAmounts(document)
    .reduce((sum, amount) => sum.add(amount), new Decimal(0))
    .toFixed(2);
}

/**
 * The one line that carries the document's own printed total, so the renderer and the spec that
 * grades it can never disagree about which line that is.
 */
export function printedTotalLine(document: PlannedDocument): string {
  const total = printedDocumentTotal(document);
  if (document.nonVatRows) return `รวมเงินทั้งสิ้น                    ${total} บาท`;
  if (document.lineDiscountPercent) return `จำนวนเงินรวมทั้งสิ้น               ${total} บาท`;
  return `TOTAL ${total} THB`;
}

export function fixtureSpecs(): FixtureSpec[] {
  const doc = (ref: string, issuer: string, number: string, items: PlannedItem[], printedPages?: PlannedDocument['printedPages']): PlannedDocument => ({
    ref, issuer, documentNumber: number, documentDate: '2026-09-18', items, ...(printedPages ? { printedPages } : {}),
  });
  return [
    { id: 'FX-PDF-02', proves: 'A81/A77/A75', kind: 'text-pdf', pages: 2, expectSuspectedMissingPages: false,
      documents: [doc('d1', 'ACME MATERIALS CO LTD', 'R-2026-0002', plannedItems(8))] },
    { id: 'FX-PDF-05', proves: 'A81/A77', kind: 'text-pdf', pages: 5, expectSuspectedMissingPages: false,
      documents: [doc('d1', 'ACME MATERIALS CO LTD', 'R-2026-0005', plannedItems(20))] },
    { id: 'FX-PDF-10', proves: 'A81/A77/A79', kind: 'text-pdf', pages: 10, expectSuspectedMissingPages: false,
      documents: [doc('d1', 'ACME MATERIALS CO LTD', 'R-2026-0010', plannedItems(40))] },
    { id: 'FX-PDF-20', proves: 'A81/A79', kind: 'text-pdf', pages: 20, expectSuspectedMissingPages: false,
      documents: [doc('d1', 'ACME MATERIALS CO LTD', 'R-2026-0020', plannedItems(80))] },
    { id: 'FX-PDF-MULTI-03', proves: 'A65/A82/A54', kind: 'text-pdf', pages: 3, expectSuspectedMissingPages: false,
      documents: [
        doc('d1', 'ACME MATERIALS CO LTD', 'R-2026-1001', plannedItems(4)),
        doc('d2', 'BLUE RIVER HARDWARE', 'INV-7788', plannedItems(3, 4)),
        doc('d3', 'CHAO PHRAYA LOGISTICS', 'CPL-0042', plannedItems(2, 7)),
      ] },
    { id: 'FX-PDF-SCAN-05', proves: 'A75/A76', kind: 'scan-pdf', pages: 5, expectSuspectedMissingPages: false,
      documents: [doc('d1', 'ร้านวัสดุ เอ ซี เอ็ม อี', 'R-2026-3005', plannedItems(15))] },
    { id: 'FX-PDF-BIG-01', proves: 'A76', kind: 'big-page-pdf', pages: 1, expectSuspectedMissingPages: false,
      documents: [doc('d1', 'ร้านวัสดุ เอ ซี เอ็ม อี', 'R-2026-8500', plannedItems(10))] },
    { id: 'FX-PDF-MISSING-01', proves: 'UXE-15/A82', kind: 'text-pdf', pages: 2, expectSuspectedMissingPages: true,
      documents: [doc('d1', 'ACME MATERIALS CO LTD', 'R-2026-0333', plannedItems(6), { of: 3, only: [1, 3] })] },
    // W10 D1 — the FlowAccount/PEAK/Leceipt full form: a 5 % discount column inside each row amount
    // and the SAME total repeated once in the summary. §4.4 used to subtract it twice.
    // Rendered rather than native text: pdf-lib's standard fonts cannot encode Thai, and these
    // Thai summary labels ARE the layout under test (FX-PDF-SCAN-05 renders for the same reason).
    { id: 'FX-PDF-DISCOUNT-NET-01', proves: 'A50/A77', kind: 'scan-pdf', pages: 1, expectSuspectedMissingPages: false,
      documents: [{
        ...doc('d1', 'บริษัท กาแฟตัวอย่าง จำกัด (สำนักงานใหญ่)', 'INV-2026-0901', plannedItems(3)),
        lineDiscountPercent: 5, vatIncludedPercent: 7,
      }] },
    // W10 D2 — the 7-Eleven / Lotus's / Big C / Makro N/V split: non-VAT goods in the summary block,
    // which the reader filed as a discount, and a VAT row it filed as a summary.
    { id: 'FX-PDF-RETAIL-NV-01', proves: 'A53/A50', kind: 'scan-pdf', pages: 1, expectSuspectedMissingPages: false,
      documents: [{
        ...doc('d1', 'บมจ. ร้านสะดวกซื้อตัวอย่าง', 'H2026090100001', plannedItems(5)),
        vatIncludedPercent: 7, nonVatRows: [2, 4],
      }] },
    // W10 D3 — a 896-px screenshot, the size of the real Leceipt sample whose totals block came back
    // untranscribed and unflagged. Preprocessing must enlarge it before the reader ever sees it.
    { id: 'FX-IMG-SMALL-01', proves: 'A76/A75', kind: 'low-res-scan', pages: 1, expectSuspectedMissingPages: false,
      documents: [{
        ...doc('d1', 'บริษัท ผู้ขายตัวอย่าง จำกัด', 'TIV-2026-0001', plannedItems(3)),
        vatIncludedPercent: 7,
      }] },
  ];
}

export type FixtureExpectation = {
  id: string;
  documents: number;
  items: number;
  /** One printed final total per document, in the document order of the fixture. */
  totals: string[];
  pages: number;
  suspectedMissingPages: boolean;
  /** W10: the ONE summary discount each document prints; only a non-zero one is scored. */
  discounts: string[];
  /** W10: the VAT each document prints inside its total; only a non-zero one is scored. */
  vats: string[];
  /** W10: every fixture's rows meet its own printed total, so every one must come out reconciled. */
  reconciledDocuments: number;
};

export function expectationOf(spec: FixtureSpec): FixtureExpectation {
  return {
    id: spec.id,
    documents: spec.documents.length,
    items: spec.documents.reduce((sum, document) => sum + document.items.length, 0),
    totals: spec.documents.map((document) => printedDocumentTotal(document)),
    pages: spec.pages,
    suspectedMissingPages: spec.expectSuspectedMissingPages,
    discounts: spec.documents.map((document) => plannedDiscount(document)),
    vats: spec.documents.map((document) => plannedVat(document)),
    reconciledDocuments: spec.documents.length,
  };
}

// ── scoring ──────────────────────────────────────────────────────────────────

export type FixtureScore = {
  documentsFound: number;
  documentsExpected: number;
  itemsFound: number;
  itemsExpected: number;
  /** Expected totals that the read printed back somewhere in `totals`, to the satang. */
  totalsMatched: number;
  totalsExpected: number;
  totalsFound: string[];
  reconciliation: Array<{ documentRef: string; status: string; difference?: string }>;
  suspectedMissingPages: boolean;
  suspectedMissingPagesExpected: boolean;
  pagesCovered: number;
  itemsTruncated: boolean;
  /** W10 D1: printed summary discounts that came back as an order/document `applied_discount`. */
  discountsMatched: number;
  discountsExpected: number;
  /** W10 D2: printed VAT amounts that came back as a `tax` total or a tax component. */
  vatMatched: number;
  vatExpected: number;
  /** W10 D1/D2: documents whose own printed arithmetic came out `reconciled`. */
  reconciledDocuments: number;
  reconciledDocumentsExpected: number;
};

const satang = (value: string | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/,/g, '');
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? new Decimal(normalized).toFixed(2) : null;
};

/**
 * What the read got right, measured against the fixture the script itself printed.
 *
 * Totals are matched by VALUE, not by position: the model names its own document refs, so pairing
 * them by index would score a correct read as wrong whenever it happened to order two receipts the
 * other way round. A total counts as found when some `document_total` in the assembly equals the
 * expected one to the satang. W10's discount and VAT expectations are matched the same way, and a
 * zero expectation is not scored — a page that prints ส่วนลด 0.00 is not asking to be graded on it.
 */
export function scoreFixture(
  expected: FixtureExpectation,
  assembled: ExpenseCaptureAssembledObservations,
): FixtureScore {
  const printed = assembled.totals.filter((total) => total.kind === 'document_total')
    .map((total) => satang(total.amount)).filter((value): value is string => value !== null);
  const pool = [...printed];
  let totalsMatched = 0;
  for (const want of expected.totals) {
    const index = pool.indexOf(satang(want)!);
    if (index >= 0) { pool.splice(index, 1); totalsMatched += 1; }
  }
  const discountsWanted = expected.discounts.filter((amount) => Number(amount) !== 0);
  const discountsRead = assembled.components
    .filter((component) => component.role === 'applied_discount' && component.scope !== 'item')
    .map((component) => satang(component.amount));
  const vatWanted = expected.vats.filter((amount) => Number(amount) !== 0);
  const vatRead = [
    ...assembled.totals.filter((total) => total.kind === 'tax').map((total) => satang(total.amount)),
    ...assembled.components
      .filter((component) => component.role === 'tax_included' || component.role === 'tax_additional')
      .map((component) => satang(component.amount)),
  ];
  return {
    documentsFound: assembled.documents.length,
    documentsExpected: expected.documents,
    itemsFound: assembled.items.length,
    itemsExpected: expected.items,
    totalsMatched,
    totalsExpected: expected.totals.length,
    totalsFound: printed,
    reconciliation: assembled.reconciliation.map((row) => ({
      documentRef: row.documentRef, status: row.status,
      ...(row.difference ? { difference: row.difference } : {}),
    })),
    suspectedMissingPages: assembled.reconciliation.some((row) => row.suspectedMissingPages),
    suspectedMissingPagesExpected: expected.suspectedMissingPages,
    pagesCovered: new Set(assembled.completeness.pagesCovered).size,
    itemsTruncated: assembled.completeness.itemsTruncated,
    discountsMatched: matchedByValue(discountsWanted, discountsRead),
    discountsExpected: discountsWanted.length,
    vatMatched: matchedByValue(vatWanted, vatRead),
    vatExpected: vatWanted.length,
    reconciledDocuments: assembled.reconciliation.filter((row) => row.status === 'reconciled').length,
    reconciledDocumentsExpected: expected.reconciledDocuments,
  };
}

/** One right answer never pays for two expectations: each match consumes the value it matched. */
function matchedByValue(wanted: readonly string[], read: ReadonlyArray<string | null>): number {
  const pool = read.filter((value): value is string => value !== null);
  let matched = 0;
  for (const want of wanted) {
    const index = pool.indexOf(satang(want)!);
    if (index >= 0) { pool.splice(index, 1); matched += 1; }
  }
  return matched;
}

/**
 * The summary block a document prints under its rows (W10), ending with `printedTotalLine`.
 *
 * Every figure comes from the row amounts this file printed, so the block can never state a total the
 * rows do not reach. The wording is the wording of the real templates — that is the point of the
 * fixture: the FlowAccount/PEAK layout repeats its line discount here, and the retail layout prints
 * the N/V split whose goods subtotals the reader used to file as a discount and as the tax.
 */
export function summaryBlockLines(document: PlannedDocument): string[] {
  const label = (text: string, amount: string) => `${text.padEnd(34, ' ')}${amount.padStart(12, ' ')}`;
  const total = printedDocumentTotal(document);
  const vat = plannedVat(document);
  if (document.nonVatRows) {
    const nonVat = plannedNonVatGoods(document);
    const taxedWithVat = new Decimal(total).minus(nonVat);
    return [
      label('มูลค่าสินค้ารวม', total),
      label('หักส่วนลด', '0.00'),
      label('ส่วนลดที่ได้ทั้งหมด', '0.00'),
      label('สินค้าไม่เสียภาษีมูลค่าเพิ่ม', nonVat),
      label('มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม', taxedWithVat.minus(vat).toFixed(2)),
      label('ภาษีมูลค่าเพิ่ม', vat),
      label('มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม', taxedWithVat.toFixed(2)),
      printedTotalLine(document),
    ];
  }
  if (document.lineDiscountPercent) {
    return [
      label('รวมเป็นเงิน', plannedTotal(document.items)),
      label(`ส่วนลด ${document.lineDiscountPercent} %`, plannedDiscount(document)),
      label('จำนวนเงินหลังหักส่วนลด', total),
      label('ราคาไม่รวมภาษีมูลค่าเพิ่ม', new Decimal(total).minus(vat).toFixed(2)),
      label(`ภาษีมูลค่าเพิ่ม ${document.vatIncludedPercent ?? 7}%`, vat),
      printedTotalLine(document),
    ];
  }
  if (document.vatIncludedPercent) {
    return [
      label('รวมเป็นเงิน', total),
      label('ราคาไม่รวมภาษีมูลค่าเพิ่ม', new Decimal(total).minus(vat).toFixed(2)),
      label(`ภาษีมูลค่าเพิ่ม ${document.vatIncludedPercent}%`, vat),
      printedTotalLine(document),
    ];
  }
  return [printedTotalLine(document)];
}

/** The printed lines of one document, split into `pages` pages: header first, the total last. */
export function documentPageLines(document: PlannedDocument, pages: number): string[][] {
  const amounts = plannedRowAmounts(document);
  const discountColumn = document.lineDiscountPercent ? `${document.lineDiscountPercent} %`.padStart(6, ' ') : '';
  const body = document.items.map((item, index) =>
    `${String(index + 1).padStart(3, ' ')}  ${item.description.padEnd(22, ' ')}  ${String(item.quantity).padStart(3, ' ')}  `
    + `${item.unitPrice.padStart(9, ' ')}  ${discountColumn ? `${discountColumn}  ` : ''}${amounts[index]!.padStart(10, ' ')}`
    + (document.nonVatRows ? `  ${document.nonVatRows.includes(index + 1) ? 'N' : 'V'}` : ''));
  const perPage = Math.ceil(body.length / pages);
  const out: string[][] = [];
  for (let page = 0; page < pages; page += 1) {
    const slice = body.slice(page * perPage, (page + 1) * perPage);
    const printedNumber = document.printedPages?.only?.[page] ?? page + 1;
    const printedOf = document.printedPages?.of ?? pages;
    const lines = [
      document.issuer,
      `Tax ID 0105560012345    Receipt No ${document.documentNumber}    Date ${document.documentDate}`,
      `Page ${printedNumber} of ${printedOf}`,
      '',
      ` No  Description               Qty  Unit Price ${discountColumn ? ' Disc  ' : ''}     Amount`
        + (document.nonVatRows ? '  Tax' : ''),
      ...slice,
    ];
    if (page === pages - 1) {
      lines.push('', ...summaryBlockLines(document),
        document.nonVatRows ? 'N = ไม่เสียภาษีมูลค่าเพิ่ม   V = สินค้าที่มีภาษี 7%' : 'Paid by cash. Thank you.');
    } else {
      lines.push('', '(continued on the next page)');
    }
    out.push(lines);
  }
  return out;
}
