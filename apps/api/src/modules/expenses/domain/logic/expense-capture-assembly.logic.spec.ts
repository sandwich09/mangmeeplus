/**
 * The arithmetic and the merging of appendix §4.4, against the acceptance cases of spec §10.
 *
 * Every row here is a real shape the corpus shows: a checkout that already includes shipping in
 * its subtotal (A25), the same order panel photographed twice (A26), a void that cancels a row
 * (A52), cash 500 with 432 change (A49), a coupon for next time (A29), two receipts in one file
 * (A54) and a document that says it is page 1 of 3 in a two-page file (A82).
 */
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import type {
  BusinessDocumentClassification,
  ExpenseCaptureComponentObservation,
  ExpenseCaptureDocumentObservation,
  ExpenseCaptureItemObservation,
  ExpenseCaptureObservations,
  ExpenseCaptureTotalObservation,
} from '@watchdog-bms/contracts';
import { assembleCaptureObservations, planWindows } from './expense-capture-assembly.logic';
import { isExpenseExtractionEligible } from './expense-document.logic';

describe('complete capture extraction windows', () => {
  it('keeps every long-page character and the bottom total with original offsets', () => {
    const text = 'item 1.00\n'.repeat(1700) + 'TOTAL 1700.00';
    const windows = planWindows({ '2': { text } });
    assert.ok(windows.length > 1);
    assert.equal(windows.flatMap(window => window.pages).map(page => page.text).join(''), text);
    let offset = 0;
    for (const page of windows.flatMap(window => window.pages)) {
      assert.equal(page.sourceOffset ?? 0, offset); assert.equal(page.pageIndex, 2);
      assert.equal(text.slice(offset, offset + page.text.length), page.text); offset += page.text.length;
    }
    assert.ok(windows.at(-1)!.pages.at(-1)!.text.endsWith('TOTAL 1700.00'));
  });
  it('retains an oversized indivisible line for explicit refusal rather than claiming its prefix is complete', () => {
    const text = 'ก'.repeat(15000);
    assert.equal(planWindows({ '0': { text } })[0]!.pages[0]!.text, text);
  });
});

const classification: BusinessDocumentClassification = {
  contentKind: 'DOCUMENT',
  documentFamily: 'EXPENSE_EVIDENCE',
  documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE',
  transactionState: 'PAID',
  evidenceRoles: ['EXPENSE_SUPPORT'],
  confidence: 0.9,
  evidenceSignals: [],
  amountSignals: [],
  settlementSignals: [],
  missingRequiredSignals: [],
  contradictionSignals: [],
  requiresClarification: false,
};

function document(over: Partial<ExpenseCaptureDocumentObservation> = {}): ExpenseCaptureDocumentObservation {
  return {
    ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
    issuer: { name: 'ร้านตัวอย่าง' }, documentNumber: 'INV-1', classification, ...over,
  };
}

const item = (over: Partial<ExpenseCaptureItemObservation> & Pick<ExpenseCaptureItemObservation, 'id'>): ExpenseCaptureItemObservation => ({
  documentRef: 'd1', description: 'สินค้า', event: 'sale', evidenceSpan: 'span', ...over,
});

const component = (over: Partial<ExpenseCaptureComponentObservation> & Pick<ExpenseCaptureComponentObservation, 'id' | 'role' | 'scope'>): ExpenseCaptureComponentObservation => ({
  documentRef: 'd1', label: 'ส่วนประกอบ', appliedStatus: 'applied', evidenceSpan: 'span', ...over,
});

const total = (kind: ExpenseCaptureTotalObservation['kind'], amount: string, documentRef = 'd1'): ExpenseCaptureTotalObservation =>
  ({ documentRef, kind, amount, evidenceSpan: `${kind} ${amount}` });

function observations(over: Partial<ExpenseCaptureObservations> = {}): ExpenseCaptureObservations {
  return {
    documents: [document()], items: [], components: [], totals: [], payments: [], refunds: [],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
    ...over,
  };
}

const assemble = (windows: ExpenseCaptureObservations[], pageCount = 1) =>
  assembleCaptureObservations(windows.map((value, index) => ({ id: `w${index + 1}`, pageIndexes: [...new Set(value.documents.flatMap(document => document.pageIndexes).concat(value.completeness.pagesCovered))], observations: value })), { pageCount });

it('D2: assembled classification keeps missing settlement, real review, contradictions, gaps and mismatches blocking', () => {
  const first = observations({ documents: [document({ classification: { ...classification, transactionState: 'DUE', requiresClarification: true,
    missingRequiredSignals: ['HUMAN_REVIEW_REQUIRED'] } })], items: [item({ id: '0:1', amount: '50.00' })] });
  const last = observations({ documents: [document({ pageIndexes: [1], continuationOfRef: 'd1', kind: 'SUPPLIER_INVOICE_OR_BILL', issuer: {},
    classification: { ...classification, documentKind: 'SUPPLIER_INVOICE_OR_BILL', transactionState: 'DUE', settlementSignals: [] } })],
    items: [item({ id: '1:1', amount: '50.00' })], totals: [total('document_total', '100.00')],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [1], notes: [] } });
  const merged = assemble([first, last], 2);
  assert.equal(merged.documents[0]!.classification.requiresClarification, false);
  assert.equal(isExpenseExtractionEligible(merged.documents[0]!.classification, '100.00', true), false, 'a total is never proof that a receipt is paid');
  const unpaidHeader = structuredClone(first), paidFooter = structuredClone(last);
  unpaidHeader.documents[0]!.classification.missingRequiredSignals.push('MISSING_PAYMENT_EVIDENCE');
  paidFooter.documents[0]!.classification = { ...paidFooter.documents[0]!.classification, transactionState: 'PAID',
    settlementSignals: ['ชำระแล้ว 100.00'], missingRequiredSignals: ['MISSING_VENDOR'], requiresClarification: true };
  const settled = assemble([unpaidHeader, paidFooter], 2).documents[0]!;
  assert.equal(settled.classification.documentKind, 'RECEIPT', 'the footer inherits the first header kind');
  assert.equal(settled.issuer!.name, 'ร้านตัวอย่าง');
  assert.equal(settled.classification.requiresClarification, false);
  assert.equal(isExpenseExtractionEligible(settled.classification, '100.00', true), true, 'assembled header and actual later payment evidence resolve both missing signals');
  for (const defect of ['review', 'contradiction', 'mismatch', 'gap', 'unreadable', 'truncated']) {
    const a = structuredClone(first), b = structuredClone(last);
    if (defect === 'review') b.documents[0]!.classification = { ...b.documents[0]!.classification, requiresClarification: true, missingRequiredSignals: ['HUMAN_REVIEW_REQUIRED'] };
    if (defect === 'contradiction') b.documents[0]!.classification.contradictionSignals = ['CONTRADICTORY_SIGNALS'];
    if (defect === 'mismatch') b.totals[0]!.amount = '120.00';
    if (defect === 'unreadable') b.completeness.unreadableRows = 1;
    if (defect === 'truncated') b.completeness.itemsTruncated = true;
    const out = assemble([a, b], defect === 'gap' ? 3 : 2);
    assert.equal(out.documents[0]!.classification.requiresClarification, true, defect);
  }
});

describe('OCR-C benchmark VAT and issuer identity', () => {
  for (const [subtotal, vat, grand] of [
    ['560,360.75', '39,225.25', '599,586.00'], ['796,262.25', '55,738.36', '852,000.61'],
    ['1,050,447.00', '73,531.29', '1,123,978.29'], ['1,670,195.75', '116,913.70', '1,787,109.45'],
  ]) it(`reconciles the printed exclusive VAT ${vat} once`, () => {
    for (const inclusive of [false, true]) {
      const result = assemble([observations({ items: [item({ id: 'p0', amount: inclusive ? grand : subtotal })],
        totals: [total('merchandise', subtotal!), total('tax', vat!), total('document_total', grand!)] })]);
      assert.equal(result.reconciliation[0]!.status, 'reconciled');
      assert.equal(result.reconciliation[0]!.difference, '0');
    }
  });

  it('keeps real exclusive VAT differences visible and never invents missing tax', () => {
    const read = observations({ items: [item({ id: 'p0', amount: '99.00' })],
      components: [component({ id: 'vat', role: 'tax_additional', scope: 'document', amount: '7.00' })],
      totals: [total('tax', '7.00'), total('document_total', '107.00')] });
    assert.equal(assemble([read]).reconciliation[0]!.computedTotal, '106');
    assert.equal(assemble([read]).reconciliation[0]!.difference, '-1');
    read.components = []; read.totals = [total('document_total', '107.00')];
    assert.equal(assemble([read]).reconciliation[0]!.status, 'mismatch');
    assert.equal(assemble([read]).reconciliation[0]!.computedTotal, '99');
  });

  it('retains first valid identity and evidence through later name-only, blank and invalid windows', () => {
    const proof = { attachmentId: 'a', checksumSha256: 'a'.repeat(64), pageIndex: 0,
      localSpan: { start: 0, end: 13 }, rawValue: '0105473325385', role: 'document:issuer.taxId' };
    const header = observations({ documents: [document({ issuer: { name: 'บริษัท ออฟฟิศซัพพลายจำลอง จำกัด',
      taxId: '0105473325385', branchCode: 'สำนักงานใหญ่', address: '326/24 ถนนจำลอง' }, fieldEvidence: { 'issuer.taxId': proof } })] });
    const later = (issuer: ExpenseCaptureDocumentObservation['issuer'], page: number) => observations({
      documents: [document({ pageIndexes: [page], continuationOfRef: 'd1', issuer })],
    });
    const result = assemble([header, later({ name: 'บริษัท ออฟฟิศซัพพลายจำลอง จำกัด' }, 1),
      later({ taxId: '', branchCode: '', address: '' }, 2), later({ taxId: '123' }, 3)], 4);
    assert.deepEqual(result.documents[0]!.issuer, header.documents[0]!.issuer);
    assert.deepEqual(result.documents[0]!.fieldEvidence?.['issuer.taxId'], proof);
    assert.equal(result.documents[0]!.classification.requiresClarification, false);
    const repaired = assemble([later({ name: 'บริษัท ออฟฟิศซัพพลายจำลอง จำกัด', taxId: '123', address: '' }, 0), header]);
    assert.equal(repaired.documents[0]!.issuer.taxId, '0105473325385');
    assert.equal(repaired.documents[0]!.issuer.address, '326/24 ถนนจำลอง');
  });

  it('flags a different valid continuation tax ID without mixing or replacing the issuer', () => {
    const first = observations({ documents: [document({ issuer: { name: 'บริษัท ออฟฟิศซัพพลายจำลอง จำกัด', taxId: '0105473325385' } })] });
    const next = observations({ documents: [document({ pageIndexes: [1], continuationOfRef: 'd1',
      issuer: { taxId: '0105453059060', address: 'ที่อยู่คนละบริษัท' } })] });
    const result = assemble([first, next], 2).documents[0]!;
    assert.equal(result.issuer.taxId, '0105473325385'); assert.equal(result.issuer.address, undefined);
    assert.equal(result.classification.requiresClarification, true);
    assert.ok(result.classification.contradictionSignals.includes('CONTRADICTORY_SIGNALS'));
    assert.equal(first.documents[0]!.classification.requiresClarification, false, 'raw window remains unchanged');
  });
});

it('split-page source ids retain both rows and deduplicate only the same source row', () => {
  const head = observations({ items: [item({ id: 'item:p0:s10:e20', amount: '10.00' })] });
  const tail = observations({ items: [item({ id: 'item:p0:s14000:e14010', amount: '20.00' })], totals: [total('document_total', '30.00')] });
  const result = assemble([head, tail, structuredClone(head)]);
  assert.equal(result.items.length, 2); assert.equal(result.reconciliation[0]!.status, 'reconciled');
});

it('reclassified and derived fields preserve printed locators with their final field roles', () => {
  const proof = (role: string, rawValue: string) => ({ attachmentId: 'a', checksumSha256: 'a'.repeat(64), pageIndex: 0, localSpan: { start: 0, end: rawValue.length }, rawValue, role });
  const result = assemble([observations({ components: [
    component({ id: 'goods', role: 'applied_discount', scope: 'document', label: 'มูลค่าก่อนภาษี', amount: '100.00', evidenceSpan: 'มูลค่าก่อนภาษี 100.00', fieldEvidence: { amount: proof('applied_discount:amount', '100.00'), label: proof('applied_discount:label', 'มูลค่าก่อนภาษี') } }),
    component({ id: 'vat', role: 'tax_included', scope: 'document', label: 'VAT 7%', amount: '7.00', evidenceSpan: 'VAT 7% 7.00', fieldEvidence: { amount: proof('tax_included:amount', '7.00'), label: proof('tax_included:label', 'VAT 7%') } }),
  ], totals: [total('document_total', '107.00')] })]);
  assert.equal(result.components[0]!.role, 'summary'); assert.equal(result.components[0]!.fieldEvidence!.amount!.role, 'summary:amount');
  assert.deepEqual(result.totals.find(row => row.kind === 'tax')!.fieldEvidence, { amount: proof('tax:amount', '7.00') });
});

describe('capture assembly — money', () => {
  it('A25: a subtotal that already includes shipping is not added to the shipping charge again', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '600.00' }), item({ id: '0:2', amount: '400.00' })],
      components: [component({ id: 'c1', role: 'charge', scope: 'shipping', label: 'ค่าจัดส่ง', amount: '50.00' })],
      // The printed "merchandise" line on this panel INCLUDES shipping; the item rows do not.
      totals: [total('merchandise', '1050.00'), total('document_total', '1050.00')],
    })]);
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
    assert.equal(result.reconciliation[0]!.computedTotal, '1050');
  });

  it('A26: the same order panel read twice yields one document and one set of totals', () => {
    const panel = observations({
      items: [item({ id: '0:1', amount: '100.00' })],
      components: [component({ id: 'c1', role: 'applied_discount', scope: 'order', label: 'ส่วนลด', amount: '10.00' })],
      totals: [total('document_total', '90.00')],
    });
    const result = assemble([panel, JSON.parse(JSON.stringify(panel)) as ExpenseCaptureObservations]);
    assert.equal(result.documents.length, 1);
    assert.equal(result.totals.length, 1);
    assert.equal(result.components.length, 1, 'a footer discount printed on both pages is one discount');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  });

  it('A26: two different orders in one checkout stay two documents', () => {
    const result = assemble([observations({
      documents: [
        document({ ref: 'd1', documentNumber: 'ORD-1', issuer: { name: 'ร้าน ก' } }),
        document({ ref: 'd2', documentNumber: 'ORD-2', issuer: { name: 'ร้าน ข' } }),
      ],
      items: [item({ id: '0:1', amount: '10.00' }), item({ id: '0:2', documentRef: 'd2', amount: '20.00' })],
      totals: [total('document_total', '10.00'), total('document_total', '20.00', 'd2')],
    })]);
    assert.equal(result.documents.length, 2);
    assert.equal(result.multiDocument, true);
    assert.deepEqual(result.reconciliation.map((row) => row.status), ['reconciled', 'reconciled']);
  });

  it('A27: same-name rows are two purchases and a zero-price gift changes no total', () => {
    const result = assemble([observations({
      items: [
        item({ id: '0:1', description: 'น้ำดื่ม', amount: '12.00' }),
        item({ id: '0:2', description: 'น้ำดื่ม', amount: '12.00' }),
        item({ id: '0:3', description: 'ของแถม', amount: '0.00', event: 'zero_price_promo' }),
      ],
      totals: [total('document_total', '24.00')],
    })]);
    assert.equal(result.items.length, 3, 'never dedupe by description');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  });

  it('A28: one row the page never priced leaves the document unprovable, not 0', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '10.00' }), item({ id: '0:2' })],
      totals: [total('document_total', '10.00')],
    })]);
    assert.equal(result.reconciliation[0]!.status, 'insufficient');
    assert.equal(result.reconciliation[0]!.computedTotal, undefined);
    assert.equal(result.reconciliation[0]!.documentTotal, '10');
  });

  it('A29: a coupon for next time reduces nothing', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '100.00' })],
      components: [component({ id: 'c1', role: 'future_reward', scope: 'document', label: 'คูปองครั้งหน้า 50', amount: '50.00' })],
      totals: [total('document_total', '100.00')],
    })]);
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  });

  it('A49: cash 500 with 432 change is a purchase of 68', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '68.00' })],
      components: [
        component({ id: 'c1', role: 'tender', scope: 'document', label: 'เงินสด', amount: '500.00' }),
        component({ id: 'c2', role: 'change', scope: 'document', label: 'เงินทอน', amount: '432.00' }),
      ],
      totals: [total('document_total', '68.00')],
    })]);
    assert.equal(result.reconciliation[0]!.computedTotal, '68');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  });

  it('A50: an order discount printed on two pages is subtracted once', () => {
    const first = observations({
      items: [item({ id: '0:1', amount: '100.00' })],
      components: [component({ id: 'c1', role: 'applied_discount', scope: 'order', label: 'ส่วนลดท้ายบิล', amount: '10.00' })],
    });
    const second = observations({
      documents: [document({ pageIndexes: [1] })],
      components: [component({ id: 'c9', role: 'applied_discount', scope: 'order', label: 'ส่วนลดท้ายบิล', amount: '10.00' })],
      totals: [total('document_total', '90.00')],
    });
    const result = assemble([first, second], 2);
    assert.equal(result.components.length, 1);
    assert.equal(result.reconciliation[0]!.computedTotal, '90');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  });

  it('A52: a linked void cancels its row, an unlinked negative row does not', () => {
    const linked = assemble([observations({
      items: [
        item({ id: '0:1', amount: '59.00' }),
        item({ id: '0:2', amount: '-59.00', event: 'void', linkedItemId: '0:1' }),
        item({ id: '0:3', amount: '53.00' }),
      ],
      totals: [total('document_total', '53.00')],
    })]);
    assert.equal(linked.reconciliation[0]!.computedTotal, '53');
    assert.equal(linked.reconciliation[0]!.status, 'reconciled');

    const unlinked = assemble([observations({
      items: [
        item({ id: '0:1', amount: '59.00' }),
        item({ id: '0:2', amount: '-59.00', event: 'void' }),
        item({ id: '0:3', amount: '53.00' }),
      ],
      totals: [total('document_total', '53.00')],
    })]);
    assert.equal(unlinked.reconciliation[0]!.computedTotal, '112', 'evidence, not inference');
    assert.equal(unlinked.reconciliation[0]!.status, 'mismatch');
  });

  it('A53: a printed pack size and tax code survive and never become a rate', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '120.00', packSize: '6', taxMarker: '1', quantity: '2' })],
      totals: [total('document_total', '120.00')],
    })]);
    assert.equal(result.items[0]!.taxMarker, '1');
    assert.equal(result.items[0]!.packSize, '6');
    assert.equal(result.items[0]!.quantity, '2');
  });

  it('A54: two receipts of different shops in one file stay two documents', () => {
    const result = assemble([
      observations({
        documents: [document({ ref: 'd1', issuer: { name: 'ร้าน ก' }, documentNumber: 'A-1' })],
        items: [item({ id: '0:1', amount: '10.00' })],
        totals: [total('document_total', '10.00')],
      }),
      observations({
        documents: [document({ ref: 'd1', issuer: { name: 'ร้าน ข' }, documentNumber: 'B-1', pageIndexes: [1] })],
        items: [item({ id: '1:1', amount: '20.00' })],
        totals: [total('document_total', '20.00')],
      }),
    ], 2);
    assert.equal(result.documents.length, 2);
    assert.equal(result.multiDocument, true);
    assert.notEqual(result.documents[0]!.ref, result.documents[1]!.ref, 'refs stay unique across windows');
  });

  it('a mismatch is reported, never balanced away with an invented rounding', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '100.00' })],
      totals: [total('document_total', '103.00')],
    })]);
    assert.equal(result.reconciliation[0]!.status, 'mismatch');
    assert.equal(result.reconciliation[0]!.difference, '-3');
    assert.equal(result.components.length, 0, 'no balancing component is created');
  });

  it('stays reconciled inside the 0.05 satang tolerance and fails outside it', () => {
    const inside = assemble([observations({
      items: [item({ id: '0:1', amount: '100.04' })], totals: [total('document_total', '100.00')],
    })]);
    const outside = assemble([observations({
      items: [item({ id: '0:1', amount: '100.06' })], totals: [total('document_total', '100.00')],
    })]);
    assert.equal(inside.reconciliation[0]!.status, 'reconciled');
    assert.equal(outside.reconciliation[0]!.status, 'mismatch');
  });
});

describe('capture assembly — pages and documents', () => {
  it('A77: a header page, item pages and a final total assemble into one document', () => {
    const result = assemble([
      observations({
        documents: [document({ ref: 'd1', pageIndexes: [0], printedPage: { number: 1, of: 3 } })],
        items: [item({ id: '0:1', amount: '40.00' })],
      }),
      observations({
        documents: [document({ ref: 'dX', pageIndexes: [1], continuationOfRef: 'd1', printedPage: { number: 2, of: 3 } })],
        items: [item({ id: '1:1', documentRef: 'dX', amount: '60.00' })],
      }),
      observations({
        documents: [document({ ref: 'dY', pageIndexes: [2], continuationOfRef: 'd1', printedPage: { number: 3, of: 3 } })],
        totals: [total('document_total', '100.00', 'dY')],
      }),
    ], 3);
    assert.equal(result.documents.length, 1);
    assert.deepEqual(result.documents[0]!.pageIndexes, [0, 1, 2]);
    assert.equal(result.items.length, 2);
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
    assert.equal(result.reconciliation[0]!.suspectedMissingPages, false);
  });

  it('A81: page coverage is the union of what the windows reported', () => {
    const result = assemble([
      observations({ completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0, 1], notes: ['page 1 read'] } }),
      observations({
        documents: [document({ pageIndexes: [2] })],
        completeness: { itemsTruncated: true, unreadableRows: 2, pagesCovered: [2], notes: ['page 1 read', 'row unreadable'] },
      }),
    ], 3);
    assert.deepEqual(result.completeness.pagesCovered, [0, 1, 2]);
    assert.equal(result.completeness.itemsTruncated, true);
    assert.equal(result.completeness.unreadableRows, 2);
    assert.deepEqual(result.completeness.notes, ['page 1 read', 'row unreadable']);
  });

  it('A82: 1 of 3 and 3 of 3 in a two-page file is a suspected missing page', () => {
    const result = assemble([
      observations({ documents: [document({ printedPage: { number: 1, of: 3 } })] }),
      observations({ documents: [document({ pageIndexes: [1], printedPage: { number: 3, of: 3 } })] }),
    ], 2);
    assert.equal(result.documents.length, 1, 'same issuer and number: one document over two pages');
    assert.equal(result.reconciliation[0]!.suspectedMissingPages, true);
  });

  it('A82: a printed 2 of 2 covered by both pages is not missing anything', () => {
    const result = assemble([
      observations({ documents: [document({ printedPage: { number: 1, of: 2 } })] }),
      observations({ documents: [document({ pageIndexes: [1], printedPage: { number: 2, of: 2 } })] }),
    ], 2);
    assert.equal(result.reconciliation[0]!.suspectedMissingPages, false);
  });

  /**
   * W08 benchmark defect, 2026-09-19. ONE window that covers the whole document is the normal case,
   * and it carries ONE `printedPage`. Until `printedPages` was actually produced, a complete
   * 20-page receipt read in one window claimed page 1 of 20 and nineteen holes — UXE-15 telling a
   * customer to find pages that are all there.
   */
  it('A82: one window that saw every printed page of a complete document reports nothing missing', () => {
    const complete = assemble([observations({
      documents: [document({ pageIndexes: [0, 1], printedPage: { number: 1, of: 2 }, printedPages: [1, 2] })],
    })], 2);
    assert.equal(complete.reconciliation[0]!.suspectedMissingPages, false);

    const holed = assemble([observations({
      documents: [document({ pageIndexes: [0, 1], printedPage: { number: 1, of: 3 }, printedPages: [1, 3] })],
    })], 2);
    assert.equal(holed.reconciliation[0]!.suspectedMissingPages, true, 'and a real gap is still a gap');
  });

  it('a blank page contributes nothing and does not make the file multi-document', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '10.00' })],
      totals: [total('document_total', '10.00')],
      completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0, 1], notes: ['page 2 blank'] },
    })], 2);
    assert.equal(result.multiDocument, false);
    assert.equal(result.documents.length, 1);
  });

  it('two documents of the SAME shop without numbers are never merged on the name alone', () => {
    const result = assemble([
      observations({ documents: [document({ ref: 'd1', documentNumber: undefined })], items: [item({ id: '0:1', amount: '10.00' })] }),
      observations({ documents: [document({ ref: 'd1', documentNumber: undefined, pageIndexes: [1] })], items: [item({ id: '1:1', amount: '20.00' })] }),
    ], 2);
    assert.equal(result.documents.length, 2);
    assert.equal(result.multiDocument, true);
  });
});

/**
 * W10 D1 — the per-line discount that the summary repeats.
 *
 * Every shape below is copied from the real 2026-09-19 reads of the two public FlowAccount templates
 * (`docs/research/expense-capture-read-benchmark-2026-09-19.md` §6): the row's money column is
 * already net of its printed 5 % line discount, and the summary prints the same 625.00 again.
 */
describe('capture assembly — W10 D1: a line discount repeated in the summary', () => {
  const flowAccountSummary = (): ExpenseCaptureComponentObservation[] => [
    component({ id: 'c1', role: 'summary', scope: 'document', label: 'รวมเป็นเงิน', amount: '12,500.00', evidenceSpan: 'รวมเป็นเงิน: 12,500.00 บาท' }),
    component({ id: 'c2', role: 'applied_discount', scope: 'document', label: 'ส่วนลด', amount: '625.00', evidenceSpan: 'ส่วนลด: 625.00 บาท' }),
    component({ id: 'c3', role: 'summary', scope: 'document', label: 'จำนวนเงินหลังหักส่วนลด', amount: '11,875.00', evidenceSpan: 'จำนวนเงินหลังหักส่วนลด: 11,875.00 บาท' }),
    component({ id: 'c4', role: 'tax_included', scope: 'document', label: 'ภาษีมูลค่าเพิ่ม 7%', amount: '776.87', evidenceSpan: 'ภาษีมูลค่าเพิ่ม 7%: 776.87 บาท' }),
    component({ id: 'c5', role: 'summary', scope: 'document', label: 'ราคาไม่รวมภาษีมูลค่าเพิ่ม', amount: '11,098.13', evidenceSpan: 'ราคาไม่รวมภาษีมูลค่าเพิ่ม: 11,098.13 บาท' }),
  ];

  it('FlowAccount ใบกำกับภาษีเต็มรูป: the printed 625 is subtracted ONCE, not twice', () => {
    const result = assemble([observations({
      documents: [document({ kind: 'TAX_INVOICE', issuer: { name: 'บริษัท โฟลว์แอคเคาท์ ทดสอบ จำกัด', taxId: '0105558096348' }, documentNumber: 'INV2025020003' })],
      items: [item({ id: '1:1', description: 'เมล็ดกาแฟดำเข้ม 500 ถุง', quantity: '50', unitPrice: '250.00', amount: '11,875.00',
        evidenceSpan: '| 1 | เมล็ดกาแฟดำเข้ม 500 ถุง | 50 | 250.00 | 5 % | 11,875.00 |' })],
      components: flowAccountSummary(),
      totals: [total('merchandise', '12,500.00'), total('document_total', '11,875.00')],
    })]);
    assert.equal(result.reconciliation[0]!.computedTotal, '11875', 'was 11250 — the 625 came off twice');
    assert.equal(result.reconciliation[0]!.difference, '0');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
    assert.equal(result.reconciliation[0]!.discountAlreadyInRows, true, 'and the row says why');
  });

  it('FlowAccount อย่างย่อ: the printed "รวมเป็นเงิน" carries the proof when no merchandise total is read', () => {
    const result = assemble([observations({
      documents: [document({ kind: 'ABBREVIATED_TAX_INVOICE', documentNumber: 'CA2025020012' })],
      items: [item({ id: '0:1', description: 'เมล็ดกาแฟคั่วเข้ม', quantity: '50', amount: '11,875.00', evidenceSpan: 'เมล็ดกาแฟคั่วเข้ม | 50 | 11,875.00' })],
      components: flowAccountSummary(),
      totals: [total('document_total', '11,875.00')],
    })]);
    assert.equal(result.reconciliation[0]!.computedTotal, '11875');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
    assert.equal(result.reconciliation[0]!.discountAlreadyInRows, true);
  });

  it('two rows of the same layout reconcile the same way', () => {
    const result = assemble([observations({
      items: [
        item({ id: '0:1', description: 'เมล็ดกาแฟคั่วเข้ม', quantity: '30', unitPrice: '250.00', amount: '7,125.00' }),
        item({ id: '0:2', description: 'เมล็ดกาแฟคั่วอ่อน', quantity: '20', unitPrice: '250.00', amount: '4,750.00' }),
      ],
      components: flowAccountSummary(),
      totals: [total('merchandise', '12,500.00'), total('document_total', '11,875.00')],
    })]);
    assert.equal(result.reconciliation[0]!.computedTotal, '11875');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  });

  it('GROSS rows still have the document discount subtracted (the Royal Pizza layout)', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '524.00' }), item({ id: '0:2', amount: '298.00' })],
      components: [component({ id: 'c1', role: 'applied_discount', scope: 'document', label: 'ส่วนลดพนักงาน', amount: '25.00', evidenceSpan: 'ส่วนลดพนักงาน 25.00' })],
      totals: [total('merchandise', '822.00'), total('document_total', '797.00')],
    })]);
    assert.equal(result.reconciliation[0]!.computedTotal, '797');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
    assert.equal(result.reconciliation[0]!.discountAlreadyInRows, undefined, 'the rows were not net of it');
  });

  it('infers nothing: net rows with NO printed pre-discount figure stay a reported mismatch', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '11,875.00' })],
      components: [component({ id: 'c2', role: 'applied_discount', scope: 'document', label: 'ส่วนลด', amount: '625.00', evidenceSpan: 'ส่วนลด 625.00' })],
      totals: [total('document_total', '11,875.00')],
    })]);
    assert.equal(result.reconciliation[0]!.status, 'mismatch');
    assert.equal(result.reconciliation[0]!.discountAlreadyInRows, undefined);
  });
});

/**
 * W10 D2 — the retail N/V summary block, copied from the real 2026-09-19 read of the CP ALL
 * 7-Eleven full-form ใบเสร็จรับเงิน/ใบกำกับภาษี (§6 of the research note). The reader filed
 * "สินค้าไม่เสียภาษีมูลค่าเพิ่ม" as a discount (`mismatch −9`) and the VAT amount as a summary, so the
 * reviewer's VAT field stayed empty. Lotus's, Big C and Makro print the same split.
 */
describe('capture assembly — W10 D2: non-VAT goods are not a discount', () => {
  const sevenElevenItems = (): ExpenseCaptureItemObservation[] => [
    item({ id: '0:1', description: 'กล้วยหอมทอง', quantity: '1', amount: '20.00' }),
    item({ id: '0:2', description: 'ไข่ไก่ต้มสุกตรา ซีพี', quantity: '1', amount: '9.00', taxMarker: 'N' }),
    item({ id: '0:3', description: 'ถั่วรวม 5 ชนิดพร้อมทาน', quantity: '1', amount: '18.00' }),
    item({ id: '0:4', description: 'แก้วน้ำ-L 22 Oz', quantity: '1', amount: '25.00' }),
    item({ id: '0:5', description: '7Game สะสมบาท 30 วัน', quantity: '1', amount: '8.00' }),
  ];
  /** The printed block, with the roles the real read chose for it. */
  const sevenElevenSummary = (discount = '0.00'): ExpenseCaptureComponentObservation[] => [
    component({ id: 'c1', role: 'summary', scope: 'document', label: 'มูลค่าสินค้ารวม', amount: '80.00', evidenceSpan: 'มูลค่าสินค้ารวม: 80.00' }),
    component({ id: 'c2', role: 'applied_discount', scope: 'document', label: 'หักส่วนลด', amount: discount, evidenceSpan: `หักส่วนลด: ${discount}` }),
    component({ id: 'c3', role: 'applied_discount', scope: 'document', label: 'ส่วนลดที่ได้ทั้งหมด', amount: '0.00', evidenceSpan: 'ส่วนลดที่ได้ทั้งหมด: 0.00' }),
    component({ id: 'c4', role: 'applied_discount', scope: 'document', label: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม', amount: '9.00', evidenceSpan: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม: 9.00' }),
    component({ id: 'c5', role: 'summary', scope: 'document', label: 'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม', amount: '66.36', evidenceSpan: 'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม: 66.36' }),
    component({ id: 'c6', role: 'summary', scope: 'document', label: 'ภาษีมูลค่าเพิ่ม', amount: '4.64', evidenceSpan: 'ภาษีมูลค่าเพิ่ม: 4.64' }),
    component({ id: 'c7', role: 'tax_included', scope: 'document', label: 'มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม', amount: '71.00', evidenceSpan: 'มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม: 71.00' }),
  ];

  it('the N-flagged goods line stops taking 9.00 off a basket that balances', () => {
    const result = assemble([observations({
      documents: [document({ kind: 'TAX_INVOICE', issuer: { name: 'บมจ. ซีพี ออลล์', taxId: '0107542000011', branchCode: '15888' }, documentNumber: 'H158886612200001' })],
      items: sevenElevenItems(),
      components: sevenElevenSummary(),
      totals: [total('merchandise', '80.00'), total('document_total', '80.00')],
    })]);
    assert.equal(result.components.find((row) => row.id === 'c4')!.role, 'summary', 'never a discount');
    assert.equal(result.components.find((row) => row.id === 'c7')!.role, 'summary', 'and never the VAT amount');
    assert.equal(result.reconciliation[0]!.computedTotal, '80', 'was 71 — the non-VAT goods were subtracted');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  });

  it('the printed VAT amount becomes the document tax total the reviewer sees', () => {
    const result = assemble([observations({
      items: sevenElevenItems(), components: sevenElevenSummary(),
      totals: [total('merchandise', '80.00'), total('document_total', '80.00')],
    })]);
    const tax = result.totals.filter((row) => row.kind === 'tax');
    assert.equal(tax.length, 1);
    assert.equal(tax[0]!.amount, '4.64');
    assert.equal(tax[0]!.evidenceSpan, 'ภาษีมูลค่าเพิ่ม: 4.64', 'with the span it was read from');
  });

  it('a real ส่วนลด row on the same layout is still subtracted', () => {
    const result = assemble([observations({
      items: sevenElevenItems(), components: sevenElevenSummary('5.00'),
      totals: [total('merchandise', '80.00'), total('document_total', '75.00')],
    })]);
    assert.equal(result.components.find((row) => row.id === 'c2')!.role, 'applied_discount');
    assert.equal(result.reconciliation[0]!.computedTotal, '75');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  });

  it('controller review: a discount whose label mentions a tax phrase stays a discount', () => {
    // "ส่วนลดก่อนภาษี" is a discount qualified by ก่อนภาษี, not a goods subtotal: re-filing it as a
    // summary would drop real money from the reconciliation and from the draft.
    const summary = sevenElevenSummary('5.00').map((row) => (row.id === 'c2'
      ? { ...row, label: 'ส่วนลดก่อนภาษี', evidenceSpan: 'ส่วนลดก่อนภาษี: 5.00' }
      : row));
    const result = assemble([observations({
      items: sevenElevenItems(), components: summary,
      totals: [total('merchandise', '80.00'), total('document_total', '75.00')],
    })]);
    assert.equal(result.components.find((row) => row.id === 'c2')!.role, 'applied_discount');
    assert.equal(result.components.find((row) => row.id === 'c4')!.role, 'summary', 'the N goods line is still re-filed');
    assert.equal(result.reconciliation[0]!.computedTotal, '75');
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  });

  it('controller review: a discount row is never taken as the VAT total', () => {
    const summary = [
      ...sevenElevenSummary(),
      component({ id: 'c8', role: 'applied_discount', scope: 'document', label: 'ส่วนลด VAT 7%', amount: '3.00', evidenceSpan: 'ส่วนลด VAT 7%: 3.00' }),
    ];
    const result = assemble([observations({
      items: sevenElevenItems(), components: summary,
      totals: [total('merchandise', '80.00'), total('document_total', '77.00')],
    })]);
    const tax = result.totals.filter((row) => row.kind === 'tax');
    assert.deepEqual(tax.map((row) => row.amount), ['4.64'], 'the bare VAT row, not the discount, is the tax');
    assert.equal(result.components.find((row) => row.id === 'c8')!.role, 'applied_discount');
  });

  it('controller review: a photographed block that came back shifted by one row is reported, and no VAT is invented', () => {
    // What the Bedrock replay of the 7-Eleven photo returned: every summary label paired with the
    // NEXT row's amount. The rows meet the printed total on their own, so the "discount" of 9.00 is
    // not money still to come off; and 71.00 is above what 7 % of an 80-baht basket could be.
    const shifted: ExpenseCaptureComponentObservation[] = [
      component({ id: 'c1', role: 'summary', scope: 'document', label: 'มูลค่าสินค้ารวม', amount: '80', evidenceSpan: 'มูลค่าสินค้ารวม 80' }),
      component({ id: 'c2', role: 'applied_discount', scope: 'document', label: 'หักส่วนลด', amount: '0.00', evidenceSpan: 'หักส่วนลด 0.00' }),
      component({ id: 'c3', role: 'applied_discount', scope: 'document', label: 'ส่วนลดที่ได้ทั้งหมด', amount: '9.00', evidenceSpan: 'ส่วนลดที่ได้ทั้งหมด 9.00' }),
      component({ id: 'c4', role: 'summary', scope: 'document', label: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม', amount: '66.36', evidenceSpan: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม 66.36' }),
      component({ id: 'c5', role: 'summary', scope: 'document', label: 'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม', amount: '4.64', evidenceSpan: 'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม 4.64' }),
      component({ id: 'c6', role: 'tax_included', scope: 'document', label: 'ภาษีมูลค่าเพิ่ม', amount: '71.00', evidenceSpan: 'ภาษีมูลค่าเพิ่ม 71.00' }),
      component({ id: 'c7', role: 'summary', scope: 'document', label: 'มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม', amount: '80.00', evidenceSpan: 'มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม 80.00' }),
    ];
    const result = assemble([observations({
      items: [...sevenElevenItems(), item({ id: '0:6', description: 'น้ำเต้าหู้', quantity: '1', amount: '0.00', taxMarker: 'N' })],
      components: shifted,
      totals: [total('merchandise', '80'), total('document_total', '80.00')],
    })]);
    // The shifted "discount" is REPORTED (§4.4 infers nothing from rows that happen to meet the
    // total); the apply path's own discount normalisation keeps it off the draft. What must never
    // happen is an invented VAT.
    assert.equal(result.reconciliation[0]!.status, 'mismatch');
    assert.equal(result.reconciliation[0]!.difference, '-9');
    assert.deepEqual(result.totals.filter((row) => row.kind === 'tax'), [], '71.00 cannot be the VAT of an 80-baht basket');
  });

  it('a read that already found its own tax total keeps it', () => {
    const result = assemble([observations({
      items: sevenElevenItems(),
      components: sevenElevenSummary(),
      totals: [total('merchandise', '80.00'), total('tax', '4.64'), total('document_total', '80.00')],
    })]);
    assert.equal(result.totals.filter((row) => row.kind === 'tax').length, 1);
  });

  it('a charge whose printed label mentions VAT is still a charge', () => {
    const result = assemble([observations({
      items: [item({ id: '0:1', amount: '100.00' })],
      components: [component({ id: 'c1', role: 'charge', scope: 'shipping', label: 'ค่าจัดส่ง (รวมภาษีมูลค่าเพิ่ม)', amount: '50.00', evidenceSpan: 'ค่าจัดส่ง (รวมภาษีมูลค่าเพิ่ม) 50.00' })],
      totals: [total('document_total', '150.00')],
    })]);
    assert.equal(result.components[0]!.role, 'charge');
    assert.equal(result.reconciliation[0]!.computedTotal, '150');
  });
});

 it('merges shuffled pages deterministically: first header, all rows, latest printed totals', () => {
  const first = observations({ documents: [document({ issuer: { name: 'First header' } })], items: [item({ id: 'p0', amount: '10.00' })], totals: [total('document_total', '10.00'), total('tax', '0.70')] });
  const last = observations({ documents: [document({ pageIndexes: [2], continuationOfRef: 'd1', issuer: { name: 'Repeated header' } })], items: [item({ id: 'p2', amount: '30.00' })], totals: [total('document_total', '60.00'), total('tax', '4.20')] });
  const middle = observations({ documents: [document({ pageIndexes: [1], continuationOfRef: 'd1' })], items: [item({ id: 'p1', amount: '20.00' })] });
  const result = assembleCaptureObservations([{ id: 'w3', pageIndexes: [2], observations: last }, { id: 'w1', pageIndexes: [0], observations: first }, { id: 'w2', pageIndexes: [1], observations: middle }], { pageCount: 3 });
  assert.equal(result.documents[0]!.issuer!.name, 'First header');
  assert.deepEqual(result.items.map(row => row.id), ['p0', 'p1', 'p2']);
  assert.equal(result.totals.find(row => row.kind === 'document_total')!.amount, '60.00');
  assert.equal(result.totals.find(row => row.kind === 'tax')!.amount, '4.20');
 });

 it('plans one extraction page per call in physical page order', () => {
  const windows = planWindows({ '2': { text: 'last total' }, '0': { text: 'header' }, '1': { text: 'rows' } });
  assert.deepEqual(windows.map(window => window.pageIndexes), [[0], [1], [2]]);
 });

const livePdf = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/live-r10-pdf-excerpts.json'), 'utf8'));

it('R10 Q3: the printed 1,050,447 goods subtotal cannot be added again as a charge', () => {
  const rows = livePdf.rows.map((row: any) => item(row));
  for (const includeSubtotal of [false, true]) {
    const result = assemble([observations({ items: rows,
      components: [component({ id: 'subtotal-charge', role: 'charge', scope: 'document', label: 'รวมเงิน', amount: '1,050,447' }),
        component({ id: 'delivery', role: 'charge', scope: 'shipping', label: 'ค่าจัดส่ง', amount: '100' })],
      totals: [...(includeSubtotal ? [total('merchandise', '1,050,447')] : []), total('document_total', '1050547')] })]);
    assert.equal(result.items.length, 70); assert.deepEqual(result.components.map(row => row.id), ['delivery']);
    assert.equal(result.reconciliation[0]!.status, 'reconciled');
  }
  const printed = assemble([observations({ items: [item({ id: 'partial', amount: '10' })],
    components: [component({ id: 'subtotal', role: 'charge', scope: 'document', label: 'รวมเงิน', amount: '1,050,447' })],
    totals: [total('merchandise', '1050447'), total('document_total', '1050447')] })]);
  assert.equal(printed.components.length, 0); assert.equal(printed.reconciliation[0]!.status, 'mismatch', 'missing rows remain blocked');
});

it('R10 Q3: the recorded 70 rows plus a signature-only third window assemble without a false document or charge', () => {
  const windows = [0, 1, 2].map(page => ({ id: `w${page + 1}`, pageIndexes: [page], observations: observations({
    documents: page === 2 ? [] : [document({ pageIndexes: [page], documentDate: page === 0 ? '2026-08-16' : undefined,
      ...(page ? { continuationOfRef: 'd1' } : {}), classification: { ...classification, evidenceSignals: ['TAX INVOICE / RECEIPT'], amountSignals: [livePdf.total], settlementSignals: ['RECEIPT'], requiresClarification: page === 0, missingRequiredSignals: page === 0 ? ['HUMAN_REVIEW_REQUIRED'] : [] } })],
    items: livePdf.rows.filter((row: any) => row.pageIndex === page).map((row: any) => item(row)),
    components: page === 1 ? [component({ id: 'subtotal', label: 'รวมเงิน', role: 'charge', scope: 'document', amount: livePdf.subtotal }),
      component({ id: 'vat', label: 'ภาษีมูลค่าเพิ่ม 7%', role: 'tax_additional', scope: 'document', amount: livePdf.vat })] : [],
    totals: page === 1 ? [total('merchandise', livePdf.subtotal), total('tax', livePdf.vat), total('document_total', livePdf.total)] : [],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [page], notes: [] },
  }) }));
  const assembled = assembleCaptureObservations(windows, { pageCount: 3 });
  assert.deepEqual(assembled.completeness.pagesCovered, [0, 1, 2]); assert.equal(assembled.documents.length, 1);
  assert.equal(assembled.items.length, 70); assert.deepEqual(assembled.components.map(row => row.id), ['vat']);
  assert.equal(assembled.reconciliation[0]!.status, 'reconciled');
  assert.equal(assembled.documents[0]!.classification.requiresClarification, false);
  assert.equal(isExpenseExtractionEligible(assembled.documents[0]!.classification, livePdf.total, true), true);
});
