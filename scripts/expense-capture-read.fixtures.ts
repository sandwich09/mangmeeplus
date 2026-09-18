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
};

export type FixtureSpec = {
  id: string;
  proves: string;
  kind: 'text-pdf' | 'scan-pdf' | 'big-page-pdf';
  documents: PlannedDocument[];
  /** Pages of the produced file. For a text PDF this is how the items are laid out. */
  pages: number;
  expectSuspectedMissingPages: boolean;
};

/** Deterministic line items: the price ladder is fixed, so the expected total is a fact, not a guess. */
export function plannedItems(count: number, offset = 0): PlannedItem[] {
  const names = ['Cement bag', 'Steel rod 9mm', 'Paint white 5L', 'PVC pipe 2in', 'Wire roll 30m', 'Sand sack', 'Gravel sack', 'Tile box'];
  return Array.from({ length: count }, (_, index) => ({
    description: `${names[(index + offset) % names.length]} ${String(index + offset + 1).padStart(2, '0')}`,
    quantity: ((index + offset) % 3) + 1,
    unitPrice: new Decimal(35 + ((index + offset) % 11) * 15).toFixed(2),
  }));
}

/** Σ quantity × unitPrice, to two decimals. The document prints exactly this as its TOTAL. */
export function plannedTotal(items: readonly PlannedItem[]): string {
  return items
    .reduce((sum, item) => sum.add(new Decimal(item.unitPrice).mul(item.quantity)), new Decimal(0))
    .toFixed(2);
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
  ];
}

export type FixtureExpectation = {
  id: string;
  documents: number;
  items: number;
  /** One printed TOTAL per document, in the document order of the fixture. */
  totals: string[];
  pages: number;
  suspectedMissingPages: boolean;
};

export function expectationOf(spec: FixtureSpec): FixtureExpectation {
  return {
    id: spec.id,
    documents: spec.documents.length,
    items: spec.documents.reduce((sum, document) => sum + document.items.length, 0),
    totals: spec.documents.map((document) => plannedTotal(document.items)),
    pages: spec.pages,
    suspectedMissingPages: spec.expectSuspectedMissingPages,
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
 * expected one to the satang.
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
  };
}

/** The printed lines of one document, split into `pages` pages: header first, TOTAL last. */
export function documentPageLines(document: PlannedDocument, pages: number): string[][] {
  const body = document.items.map((item, index) =>
    `${String(index + 1).padStart(3, ' ')}  ${item.description.padEnd(22, ' ')}  ${String(item.quantity).padStart(3, ' ')}  `
    + `${item.unitPrice.padStart(9, ' ')}  ${new Decimal(item.unitPrice).mul(item.quantity).toFixed(2).padStart(10, ' ')}`);
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
      ' No  Description               Qty  Unit Price      Amount',
      ...slice,
    ];
    if (page === pages - 1) {
      lines.push('', `TOTAL ${plannedTotal(document.items)} THB`, 'Paid by cash. Thank you.');
    } else {
      lines.push('', '(continued on the next page)');
    }
    out.push(lines);
  }
  return out;
}
