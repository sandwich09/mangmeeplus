/**
 * Observations → the legacy draft fields (appendix §3, `expense-capture-fields.logic.ts`).
 *
 * This is the layer between what the reader SAW and what the reviewer is shown, so it is where the
 * two W10 money defects have to be proven end to end: the FlowAccount line discount the summary
 * repeats (D1) and the 7-Eleven N/V summary block whose VAT never reached the draft (D2). Every
 * shape below is copied from the real 2026-09-19 reads of the public templates recorded in
 * `docs/research/expense-capture-read-benchmark-2026-09-19.md` §6 — nothing here is invented, and
 * `assembleCaptureObservations` runs for real so the API-side normalisation is part of the proof.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  BusinessDocumentClassification,
  ExpenseCaptureComponentObservation,
  ExpenseCaptureDocumentObservation,
  ExpenseCaptureItemObservation,
  ExpenseCaptureObservations,
  ExpenseCaptureTotalObservation,
} from '@watchdog-bms/contracts';
import { assembleCaptureObservations } from './expense-capture-assembly.logic';
import { captureFieldsFromObservations } from './expense-capture-fields.logic';

const classification = (documentKind: BusinessDocumentClassification['documentKind']): BusinessDocumentClassification => ({
  contentKind: 'DOCUMENT',
  documentFamily: 'EXPENSE_EVIDENCE',
  documentKind,
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
});

const item = (over: Partial<ExpenseCaptureItemObservation> & Pick<ExpenseCaptureItemObservation, 'id'>): ExpenseCaptureItemObservation => ({
  documentRef: 'd1', description: 'สินค้า', event: 'sale', evidenceSpan: 'span', ...over,
});

const component = (over: Partial<ExpenseCaptureComponentObservation> & Pick<ExpenseCaptureComponentObservation, 'id' | 'role'>): ExpenseCaptureComponentObservation => ({
  documentRef: 'd1', label: 'ส่วนประกอบ', scope: 'document', appliedStatus: 'applied', evidenceSpan: 'span', ...over,
});

const total = (kind: ExpenseCaptureTotalObservation['kind'], amount: string): ExpenseCaptureTotalObservation =>
  ({ documentRef: 'd1', kind, amount, evidenceSpan: `${kind} ${amount}` });

function mapping(
  document: Partial<ExpenseCaptureDocumentObservation>,
  over: Partial<ExpenseCaptureObservations>,
) {
  const observations: ExpenseCaptureObservations = {
    documents: [{
      ref: 'd1', pageIndexes: [0], kind: 'TAX_INVOICE', family: 'EXPENSE_EVIDENCE',
      issuer: { name: 'ผู้ขายตัวอย่าง', taxId: '0105558096348' }, documentNumber: 'INV-1',
      documentDate: '2025-02-27', currency: 'THB', classification: classification('TAX_INVOICE'),
      ...document,
    }],
    items: [], components: [], totals: [], payments: [], refunds: [],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
    ...over,
  };
  const assembled = assembleCaptureObservations([{ id: 'w1', pageIndexes: [0], observations }], { pageCount: 1 });
  return { assembled, mapped: captureFieldsFromObservations(assembled) };
}

describe('capture draft fields — W10 D1: FlowAccount line discount repeated in the summary', () => {
  const summary = (): ExpenseCaptureComponentObservation[] => [
    component({ id: 'c1', role: 'summary', label: 'รวมเป็นเงิน', amount: '12,500.00', evidenceSpan: 'รวมเป็นเงิน: 12,500.00 บาท' }),
    component({ id: 'c2', role: 'applied_discount', label: 'ส่วนลด', amount: '625.00', evidenceSpan: 'ส่วนลด: 625.00 บาท' }),
    component({ id: 'c3', role: 'summary', label: 'จำนวนเงินหลังหักส่วนลด', amount: '11,875.00', evidenceSpan: 'จำนวนเงินหลังหักส่วนลด: 11,875.00 บาท' }),
    component({ id: 'c4', role: 'tax_included', label: 'ภาษีมูลค่าเพิ่ม 7%', amount: '776.87', evidenceSpan: 'ภาษีมูลค่าเพิ่ม 7%: 776.87 บาท' }),
    component({ id: 'c5', role: 'summary', label: 'ราคาไม่รวมภาษีมูลค่าเพิ่ม', amount: '11,098.13', evidenceSpan: 'ราคาไม่รวมภาษีมูลค่าเพิ่ม: 11,098.13 บาท' }),
  ];

  it('carries the printed subtotal, discount, VAT and total onto the draft, with BOTH item rows', () => {
    const { assembled, mapped } = mapping({ documentNumber: 'INV2025020003' }, {
      items: [
        item({ id: '0:1', description: 'เมล็ดกาแฟคั่วเข้ม', quantity: '30', unitPrice: '250.00', amount: '7,125.00', evidenceSpan: '30 | 250.00 | 5 % | 7,125.00' }),
        item({ id: '0:2', description: 'เมล็ดกาแฟคั่วอ่อน', quantity: '20', unitPrice: '250.00', amount: '4,750.00', evidenceSpan: '20 | 250.00 | 5 % | 4,750.00' }),
      ],
      components: summary(),
      totals: [total('merchandise', '12,500.00'), total('document_total', '11,875.00')],
    });
    assert.equal(assembled.reconciliation[0]!.status, 'reconciled');
    assert.equal(assembled.reconciliation[0]!.discountAlreadyInRows, true);
    assert.ok(mapped);
    assert.equal(mapped.fields.subtotalAmount, '12,500.00');
    assert.equal(mapped.fields.discountAmount, '625.00');
    assert.equal(mapped.fields.vatAmount, '776.87');
    assert.equal(mapped.fields.vatMode, 'VAT_INCLUDED');
    assert.equal(mapped.fields.grandTotalAmount, '11,875.00');
    assert.equal(mapped.fields.lines?.length, 2, 'the breakdown the document printed survives');
    assert.deepEqual(mapped.fields.lines?.map((line) => line.unitPrice), ['250.00', '250.00']);
    assert.ok(!mapped.fields.missingFields?.includes('lines'));
  });

  it('the single-row form maps the same money (the draft keeps its summary line there)', () => {
    const { assembled, mapped } = mapping({}, {
      items: [item({ id: '1:1', description: 'เมล็ดกาแฟดำเข้ม 500 ถุง', quantity: '50', unitPrice: '250.00', amount: '11,875.00' })],
      components: summary(),
      totals: [total('merchandise', '12,500.00'), total('document_total', '11,875.00')],
    });
    assert.equal(assembled.reconciliation[0]!.status, 'reconciled');
    assert.ok(mapped);
    assert.equal(mapped.fields.subtotalAmount, '12,500.00');
    assert.equal(mapped.fields.discountAmount, '625.00');
    assert.equal(mapped.fields.grandTotalAmount, '11,875.00');
    // One printed row is not a breakdown (§4.3 of the OCR spec), so `lines` is reported missing.
    assert.equal(mapped.fields.lines, undefined);
    assert.ok(mapped.fields.missingFields?.includes('lines'));
  });
});

describe('capture draft fields — W10 D2: the 7-Eleven N/V summary block', () => {
  const sevenEleven = () => mapping(
    { kind: 'TAX_INVOICE', issuer: { name: 'บมจ. ซีพี ออลล์', taxId: '0107542000011', branchCode: '15888' }, documentNumber: 'H158886612200001', documentDate: '2023-12-20' },
    {
      items: [
        item({ id: '0:1', description: 'กล้วยหอมทอง', quantity: '1', amount: '20.00' }),
        item({ id: '0:2', description: 'ไข่ไก่ต้มสุกตรา ซีพี', quantity: '1', amount: '9.00', taxMarker: 'N' }),
        item({ id: '0:3', description: 'ถั่วรวม 5 ชนิดพร้อมทาน', quantity: '1', amount: '18.00' }),
        item({ id: '0:4', description: 'แก้วน้ำ-L 22 Oz', quantity: '1', amount: '25.00' }),
        item({ id: '0:5', description: '7Game สะสมบาท 30 วัน', quantity: '1', amount: '8.00' }),
      ],
      // Exactly the roles the real read chose: the non-VAT goods as a discount, the VAT as a summary.
      components: [
        component({ id: 'c1', role: 'summary', label: 'มูลค่าสินค้ารวม', amount: '80.00', evidenceSpan: 'มูลค่าสินค้ารวม: 80.00' }),
        component({ id: 'c2', role: 'applied_discount', label: 'หักส่วนลด', amount: '0.00', evidenceSpan: 'หักส่วนลด: 0.00' }),
        component({ id: 'c3', role: 'applied_discount', label: 'ส่วนลดที่ได้ทั้งหมด', amount: '0.00', evidenceSpan: 'ส่วนลดที่ได้ทั้งหมด: 0.00' }),
        component({ id: 'c4', role: 'applied_discount', label: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม', amount: '9.00', evidenceSpan: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม: 9.00' }),
        component({ id: 'c5', role: 'summary', label: 'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม', amount: '66.36', evidenceSpan: 'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม: 66.36' }),
        component({ id: 'c6', role: 'summary', label: 'ภาษีมูลค่าเพิ่ม', amount: '4.64', evidenceSpan: 'ภาษีมูลค่าเพิ่ม: 4.64' }),
        component({ id: 'c7', role: 'tax_included', label: 'มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม', amount: '71.00', evidenceSpan: 'มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม: 71.00' }),
      ],
      totals: [total('merchandise', '80.00'), total('document_total', '80.00')],
    },
  );

  it('the printed VAT reaches the reviewer and the basket reconciles', () => {
    const { assembled, mapped } = sevenEleven();
    assert.equal(assembled.reconciliation[0]!.status, 'reconciled', 'was mismatch −9');
    assert.ok(mapped);
    assert.equal(mapped.fields.vatAmount, '4.64', 'was empty: the VAT row came back as a summary');
    assert.equal(mapped.fields.grandTotalAmount, '80.00');
    assert.equal(mapped.fields.subtotalAmount, '80.00');
    assert.ok(!mapped.fields.missingFields?.includes('vatAmount'));
  });

  it('the N-flagged goods never become a discount on the draft', () => {
    const { mapped } = sevenEleven();
    assert.ok(mapped);
    assert.equal(mapped.fields.discountAmount, undefined, '0.00 + 0.00 is what the bill printed');
    assert.ok(!mapped.fields.missingFields?.includes('discountAmount'));
    assert.equal(mapped.fields.lines?.length, 5, 'and every N/V row stays a row');
  });

  it('a real ส่วนลด row on the same layout still lands in the discount slot', () => {
    const { mapped } = mapping({}, {
      items: [item({ id: '0:1', amount: '60.00' }), item({ id: '0:2', amount: '20.00' })],
      components: [
        component({ id: 'c1', role: 'summary', label: 'มูลค่าสินค้ารวม', amount: '80.00', evidenceSpan: 'มูลค่าสินค้ารวม: 80.00' }),
        component({ id: 'c2', role: 'applied_discount', label: 'หักส่วนลด', amount: '5.00', evidenceSpan: 'หักส่วนลด: 5.00' }),
        component({ id: 'c3', role: 'applied_discount', label: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม', amount: '9.00', evidenceSpan: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม: 9.00' }),
      ],
      totals: [total('merchandise', '80.00'), total('document_total', '75.00')],
    });
    assert.ok(mapped);
    assert.equal(mapped.fields.discountAmount, '5.00', 'one printed discount, not two');
  });
});

describe('capture draft fields — controller review of W10: a photographed summary block shifted by one row', () => {
  it('writes the grand total, invents no VAT, and the mislabelled discount never reaches the draft', async () => {
    const { verifyDiscountAmount } = await import('../../application/services/receipt-ocr-apply.service');
    const shifted: ExpenseCaptureComponentObservation[] = [
      component({ id: 'c1', role: 'summary', label: 'มูลค่าสินค้ารวม', amount: '80', evidenceSpan: 'มูลค่าสินค้ารวม 80' }),
      component({ id: 'c2', role: 'applied_discount', label: 'หักส่วนลด', amount: '0.00', evidenceSpan: 'หักส่วนลด 0.00' }),
      component({ id: 'c3', role: 'applied_discount', label: 'ส่วนลดที่ได้ทั้งหมด', amount: '9.00', evidenceSpan: 'ส่วนลดที่ได้ทั้งหมด 9.00' }),
      component({ id: 'c4', role: 'summary', label: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม', amount: '66.36', evidenceSpan: 'สินค้าไม่เสียภาษีมูลค่าเพิ่ม 66.36' }),
      component({ id: 'c5', role: 'summary', label: 'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม', amount: '4.64', evidenceSpan: 'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม 4.64' }),
      component({ id: 'c6', role: 'tax_included', label: 'ภาษีมูลค่าเพิ่ม', amount: '71.00', evidenceSpan: 'ภาษีมูลค่าเพิ่ม 71.00' }),
      component({ id: 'c7', role: 'summary', label: 'มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม', amount: '80.00', evidenceSpan: 'มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม 80.00' }),
    ];
    const { mapped } = mapping({ issuer: { name: 'บมจ. ซีพี ออลล์', taxId: '0107542000011' }, documentNumber: 'H158886612200001' }, {
      items: [
        item({ id: '0:1', description: 'กล้วยหอมทอง', quantity: '1', amount: '20.00' }),
        item({ id: '0:2', description: 'ไข่ไก่ต้มสุกตราซีพี', quantity: '1', amount: '9.00', taxMarker: 'N' }),
        item({ id: '0:3', description: 'ถั่วรวม 5 ชนิด', quantity: '1', amount: '18.00' }),
        item({ id: '0:4', description: 'แก้วน้ำแข็ง', quantity: '1', amount: '25.00' }),
        item({ id: '0:5', description: '7Game สะสมบาท', quantity: '1', amount: '8.00' }),
        item({ id: '0:6', description: 'น้ำเต้าหู้', quantity: '1', amount: '0.00', taxMarker: 'N' }),
      ],
      components: shifted,
      totals: [total('merchandise', '80'), total('document_total', '80.00')],
    });
    assert.ok(mapped);
    assert.equal(mapped.fields.grandTotalAmount, '80.00');
    assert.equal(mapped.fields.vatAmount, undefined, '71.00 is the VAT-inclusive subtotal, not the VAT');
    assert.equal(mapped.fields.vatMode, 'NEEDS_REVIEW');
    // The apply path's own arithmetic drops the 9.00 the shifted block called a discount.
    const verified = verifyDiscountAmount(mapped.fields);
    assert.equal(verified.discountAmount, undefined);
    assert.equal(verified.grandTotalAmount, '80.00');
  });
});

/**
 * Owner 2026-09-29 ("หมวดหมู่ AI ควรจับได้เลย"): the PDF lane now carries the photo reader's category
 * pick onto the draft fields, where `receipt-ocr-apply` applies it by the same rule as a photo.
 */
describe('capture draft fields — the document category', () => {
  const pick = { expenseCategoryId: 'cat-freight', confidence: 0.94, evidenceSignals: ['ค่าจัดส่งพัสดุ'] };

  it('hands the document category to the apply unchanged', () => {
    const { mapped } = mapping({ categorySuggestion: pick }, { totals: [total('document_total', '120.00')] });
    assert.deepEqual(mapped?.fields.categorySuggestion, pick);
  });

  it('adds none when the read named none', () => {
    const { mapped } = mapping({}, { totals: [total('document_total', '120.00')] });
    assert.ok(mapped);
    assert.equal('categorySuggestion' in mapped.fields, false);
  });

  it('keeps the first window\'s pick for a document continued in a later window, and takes a later one when the first named none', () => {
    const page = (ref: string, over: Partial<ExpenseCaptureDocumentObservation>): ExpenseCaptureObservations => ({
      documents: [{
        ref, pageIndexes: [ref === 'a' ? 0 : 1], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
        issuer: { name: 'ขนส่งตัวอย่าง' }, documentNumber: 'SHP-1', classification: classification('RECEIPT'), ...over,
      }],
      items: [], components: [], totals: [], payments: [], refunds: [],
      completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [], notes: [] },
    });
    const later = { ...pick, expenseCategoryId: 'cat-other' };
    const kept = assembleCaptureObservations([
      { id: 'w1', pageIndexes: [0], observations: page('a', { categorySuggestion: pick }) },
      { id: 'w2', pageIndexes: [1], observations: page('b', { continuationOfRef: 'a', categorySuggestion: later }) },
    ], { pageCount: 2 });
    assert.equal(kept.documents.length, 1);
    assert.deepEqual(kept.documents[0]!.categorySuggestion, pick);
    const filled = assembleCaptureObservations([
      { id: 'w1', pageIndexes: [0], observations: page('a', {}) },
      { id: 'w2', pageIndexes: [1], observations: page('b', { continuationOfRef: 'a', categorySuggestion: later }) },
    ], { pageCount: 2 });
    assert.deepEqual(filled.documents[0]!.categorySuggestion, later);
  });
});

it('R10 Q2: a two-page invoice uses its header date; no printed date leaves the capture field missing', () => {
  for (const date of ['2026-09-26', undefined]) {
    const header = mapping({ documentDate: date }, {}).assembled;
    const first: ExpenseCaptureObservations = { documents: header.documents, items: [], components: [], totals: [], payments: [], refunds: [],
      completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] } };
    const footer = structuredClone(first); footer.documents[0]!.documentDate = undefined; footer.documents[0]!.pageIndexes = [1];
    footer.documents[0]!.continuationOfRef = 'd1'; footer.totals = [total('document_total', '599586')];
    const assembled = assembleCaptureObservations([{ id: 'w1', pageIndexes: [0], observations: first }, { id: 'w2', pageIndexes: [1], observations: footer }], { pageCount: 2 });
    const result = captureFieldsFromObservations(assembled)!;
    assert.equal(result.fields.expenseDate, date); assert.equal(result.fields.missingFields?.includes('expenseDate'), !date);
  }
});

describe('Fix-up 16 capture branch and signed rounding', () => {
  // Actual F2 assembled document JSON, including the printed branch designation.
  const F2 = {"ref":"d1","kind":"TAX_INVOICE","buyer":{"name":"บริษัท ร้านตัวอย่าง เอ จำกัด (สำนักงานใหญ่)","taxId":"0105569001238"},"family":"EXPENSE_EVIDENCE","issuer":{"name":"บริษัท ฟู้ดแพคเกจจิ้ง จำกัด","taxId":"0105540445561","address":"9 ซอยเพชรเกษม 81 แขวงหนองค้างพลู เขตหนองแขม กรุงเทพฯ 10160","branchCode":"สำนักงานใหญ่","storefront":"บริษัท ฟู้ดแพคเกจจิ้ง จำกัด"},"currency":"THB","pageIndexes":[0,1],"printedPage":{"of":2,"number":1},"documentDate":"2026-10-03","printedPages":[1,2],"classification":{"confidence":0.9,"contentKind":"DOCUMENT","documentKind":"TAX_INVOICE","amountSignals":["6,303.68","6,660.40","6,876.90","14,193.20","17,864.07","จำนวนเงินรวมทั้งสิ้น 181,116.77","รวมเป็นเงิน 169,268.01","ภาษีมูลค่าเพิ่ม 7% 11,848.76"],"evidenceRoles":["EXPENSE_SUPPORT","TAX_EVIDENCE_CANDIDATE"],"documentFamily":"EXPENSE_EVIDENCE","evidenceSignals":["ใบแจ้งหนี้ / ใบกำกับภาษี","ต้นฉบับ (Original)","เลขที่ INV-6910-0301","เลขประจำตัวผู้เสียภาษีอากร 0105540445561","จำนวนเงินรวมทั้งสิ้น 181,116.77","ภาษีมูลค่าเพิ่ม 7% 11,848.76"],"transactionState":"DUE","businessDirection":"PURCHASE_EXPENSE","settlementSignals":["ครบกำหนด 02/11/2569","ชำระโดย: โอนเงินเข้าบัญชี ธนาคารตัวอย่าง xxx-x-x1001-x"],"contradictionSignals":[],"requiresClarification":false,"missingRequiredSignals":[]},"documentNumber":"INV-6910-0301","categorySuggestion":{"confidence":0.6,"evidenceSignals":["กล่องลูกฟูก 3 ชั้น เบอร์ C","เทปกาว OPP ใส 2 นิ้ว","บับเบิ้ลกันกระแทก 65 ซม.","สติกเกอร์ฉลากความร้อน","กระดาษคราฟท์"],"expenseCategoryId":"category-a-office"}};
  for (const [printed, expected] of [['สำนักงานใหญ่', '00000'], ['Head office', '00000'], ['สาขาที่ 3', '00003'], ['Branch 17', '00017'], ['', undefined], ['unknown', undefined]]) {
    it(`O5: maps printed branch ${printed} to ${expected}`, () => {
      const { mapped } = mapping({ ...F2, issuer: { ...F2.issuer, branchCode: printed } } as any, {});
      assert.equal(mapped?.fields.vendorBranchCode, expected);
    });
  }
  it('O1: carries a signed printed rounding component with zero VAT', () => {
    const { mapped } = mapping({}, { components: [component({ id: 'rounding', role: 'charge', label: 'สตางค์ปัดเศษ', amount: '-0.44', evidenceSpan: 'สตางค์ปัดเศษ -0.44' })] });
    assert.deepEqual(mapped?.fields.additionalCharges, [{ kind: 'ROUNDING', description: 'สตางค์ปัดเศษ', amount: '-0.44', vatRate: '0', evidenceSignal: 'สตางค์ปัดเศษ -0.44' }]);
  });
});
