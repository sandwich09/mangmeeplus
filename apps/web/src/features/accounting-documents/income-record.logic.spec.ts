import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACCOUNTING_CREDIT_NOTE_REASON_CODES, ACCOUNTING_DEBIT_NOTE_REASON_CODES, type AccountingPaymentMethod } from '@watchdog-bms/contracts';
import {
  buildCorrectionInput,
  buildInvoiceDraftInput,
  buildSimpleIncomeInput,
  canCreateIncomeInvoice,
  canIssueIncomeInvoice,
  canRecordReceivedIncome,
  computeIncomeTotals,
  CREDIT_NOTE_REASON_OPTIONS,
  DEBIT_NOTE_REASON_OPTIONS,
  correctionEligibility,
  correctionLineBasis,
  defaultVatChoiceForCategory,
  deriveVatMode,
  incomeSubmitBlocker,
  invoiceDraftIdempotencyKey,
  simpleIncomeIdempotencyKey,
  vatVisibilityFromStatus,
  type CorrectionSourceDocument,
  type IncomeFormSnapshot,
  type IncomeLineDraft,
} from './income-record.logic';

function line(overrides: Partial<IncomeLineDraft> = {}): IncomeLineDraft {
  return { description: 'ขายสินค้า', amount: '100', quantity: '1', revenueCategoryId: '', vatChoice: 'VAT7', discountAmount: '', ...overrides };
}

function form(overrides: Partial<IncomeFormSnapshot> = {}): IncomeFormSnapshot {
  return {
    mode: 'received',
    visibility: 'SHOWN',
    lines: [line()],
    priceIncludesVat: false,
    paymentMethod: 'CASH' as AccountingPaymentMethod,
    whtRate: '',
    documentDate: '2026-08-26',
    dueDate: '',
    ...overrides,
  };
}

describe('VAT defaults from category (spec §7.9 — never guessed)', () => {
  it('maps O7/OX/O0 and leaves unknown categories unselected', () => {
    assert.equal(defaultVatChoiceForCategory('O7'), 'VAT7');
    assert.equal(defaultVatChoiceForCategory('OX'), 'EXEMPT');
    assert.equal(defaultVatChoiceForCategory('O0'), 'ZERO');
    assert.equal(defaultVatChoiceForCategory(null), null);
    assert.equal(defaultVatChoiceForCategory(undefined), null);
  });

  it('hides VAT only for an answered NOT_REGISTERED', () => {
    assert.equal(vatVisibilityFromStatus('NOT_REGISTERED'), 'HIDDEN');
    assert.equal(vatVisibilityFromStatus('REGISTERED'), 'SHOWN');
    assert.equal(vatVisibilityFromStatus('UNKNOWN'), 'UNKNOWN');
  });
});

describe('deriveVatMode', () => {
  it('forces NO_VAT when the company is not VAT registered', () => {
    assert.equal(deriveVatMode(form({ visibility: 'HIDDEN', lines: [line({ vatChoice: null })] })), 'NO_VAT');
  });
  it('returns null while VAT status is loading or a line has no choice', () => {
    assert.equal(deriveVatMode(form({ visibility: 'LOADING' })), null);
    assert.equal(deriveVatMode(form({ visibility: 'ERROR' })), null);
    assert.equal(deriveVatMode(form({ lines: [line(), line({ vatChoice: null })] })), null);
  });
  it('does not guess whether a VAT7 price includes VAT', () => {
    assert.equal(deriveVatMode(form({ priceIncludesVat: null })), null);
  });
  it('uses the price mode when any line carries VAT 7%', () => {
    assert.equal(deriveVatMode(form({ priceIncludesVat: true })), 'VAT_INCLUDED');
    assert.equal(deriveVatMode(form({ priceIncludesVat: false })), 'VAT_EXCLUDED');
  });
  it('maps all-exempt to EXEMPT and anything else VAT-free to NO_VAT', () => {
    assert.equal(deriveVatMode(form({ lines: [line({ vatChoice: 'EXEMPT' }), line({ vatChoice: 'EXEMPT' })] })), 'EXEMPT');
    assert.equal(deriveVatMode(form({ lines: [line({ vatChoice: 'EXEMPT' }), line({ vatChoice: 'ZERO' })] })), 'NO_VAT');
  });
});

describe('computeIncomeTotals (preview of server decimal totals)', () => {
  it('adds 7% on top for excluded prices', () => {
    assert.deepEqual(computeIncomeTotals(form()), { taxable: 100, vat: 7, grand: 107, wht: 0, cash: 107 });
  });
  it('back-calculates included prices', () => {
    const totals = computeIncomeTotals(form({ priceIncludesVat: true, lines: [line({ amount: '107' })] }));
    assert.deepEqual(totals, { taxable: 100, vat: 7, grand: 107, wht: 0, cash: 107 });
  });
  it('rounds the included back-calculation half-up per line', () => {
    const totals = computeIncomeTotals(form({ priceIncludesVat: true, lines: [line({ amount: '50' })] }));
    assert.equal(totals.taxable, 46.73);
    assert.equal(totals.vat, 3.27);
  });
  it('keeps the mixed 7% + 0% golden case at 207 (Phase 3A proof)', () => {
    const totals = computeIncomeTotals(form({ lines: [line(), line({ vatChoice: 'ZERO' })] }));
    assert.deepEqual(totals, { taxable: 200, vat: 7, grand: 207, wht: 0, cash: 207 });
  });
  it('never charges VAT for a NOT_REGISTERED company, whatever the line says', () => {
    assert.deepEqual(computeIncomeTotals(form({ visibility: 'HIDDEN' })), { taxable: 100, vat: 0, grand: 100, wht: 0, cash: 100 });
  });
  it('applies discounts before VAT and withholding after', () => {
    const discounted = computeIncomeTotals(form({ lines: [line({ discountAmount: '20' })] }));
    assert.deepEqual(discounted, { taxable: 80, vat: 5.6, grand: 85.6, wht: 0, cash: 85.6 });
    const withheld = computeIncomeTotals(form({ whtRate: '3' }));
    assert.deepEqual(withheld, { taxable: 100, vat: 7, grand: 107, wht: 3, cash: 104 });
  });
  it('matches backend Decimal ROUND_HALF_UP when binary float falls below half a satang', () => {
    const totals = computeIncomeTotals(form({
      visibility: 'HIDDEN',
      lines: [line({ quantity: '0.0300', amount: '68.50', vatChoice: null })],
    }));
    assert.equal(totals.grand, 2.06);
  });
});

describe('incomeSubmitBlocker (disabled-with-reason, spec §7.2/§7.3)', () => {
  it('asks for the first line before anything else', () => {
    assert.equal(
      incomeSubmitBlocker(form({ lines: [line({ description: '', amount: '' })] })),
      'กรอกรายละเอียดและจำนวนเงินอย่างน้อย 1 รายการก่อนบันทึกได้',
    );
  });
  it('names the incomplete line', () => {
    assert.match(incomeSubmitBlocker(form({ lines: [line({ description: '', amount: '50' })] })) ?? '', /รายละเอียดของรายการที่ 1/);
    assert.match(incomeSubmitBlocker(form({ lines: [line({ amount: 'abc' })] })) ?? '', /จำนวนเงินของรายการที่ 1/);
    assert.match(incomeSubmitBlocker(form({ lines: [line({ discountAmount: '100' })] })) ?? '', /ส่วนลดของรายการที่ 1/);
  });
  it('blocks while the VAT registration answer is loading', () => {
    assert.match(incomeSubmitBlocker(form({ visibility: 'LOADING' })) ?? '', /สถานะจดทะเบียน VAT/);
    assert.match(incomeSubmitBlocker(form({ visibility: 'ERROR' })) ?? '', /กดลองใหม่/);
  });

  it('blocks when the company has not confirmed its VAT status', () => {
    assert.match(incomeSubmitBlocker(form({ visibility: 'UNKNOWN' })) ?? '', /ยังไม่ได้ยืนยัน/);
  });
  it('points at the exact line whose VAT is not chosen', () => {
    assert.equal(
      incomeSubmitBlocker(form({ lines: [line(), line({ vatChoice: null })] })),
      'เลือกวิธีคิด VAT ของรายการที่ 2 ก่อนยืนยัน',
    );
  });
  it('requires an explicit included/excluded answer for VAT7 prices', () => {
    assert.match(incomeSubmitBlocker(form({ priceIncludesVat: null })) ?? '', /รวม VAT/);
  });
  it('does not ask for VAT when the company is not registered', () => {
    assert.equal(incomeSubmitBlocker(form({ visibility: 'HIDDEN', lines: [line({ vatChoice: null })] })), null);
  });
  it('requires a payment method only in received mode', () => {
    assert.equal(incomeSubmitBlocker(form({ paymentMethod: null })), 'เลือกช่องทางรับเงินก่อนบันทึกได้');
    assert.equal(incomeSubmitBlocker(form({ mode: 'invoice', paymentMethod: null })), null);
  });
  it('rejects withholding that consumes the whole total', () => {
    assert.equal(
      incomeSubmitBlocker(form({ visibility: 'HIDDEN', whtRate: '100' })),
      'ยอดถูกหัก ณ ที่จ่ายต้องน้อยกว่ายอดรวม',
    );
  });
  it('rejects a due date before the document date', () => {
    assert.equal(
      incomeSubmitBlocker(form({ mode: 'invoice', paymentMethod: null, dueDate: '2026-08-20' })),
      'วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร',
    );
  });
  it('returns null when the form is complete', () => {
    assert.equal(incomeSubmitBlocker(form()), null);
  });
});

describe('buildSimpleIncomeInput', () => {
  it('maps only started lines, deriving vatMode and per-line vatRate from choices', () => {
    const input = buildSimpleIncomeInput(
      form({ lines: [line({ revenueCategoryId: 'cat-1' }), line({ description: '', amount: '' }), line({ vatChoice: 'ZERO', amount: '50' })] }),
      { idempotencyKey: 'k-123456789', note: 'ขายหน้าร้าน' },
    );
    assert.equal(input.vatMode, 'VAT_EXCLUDED');
    assert.equal(input.paymentMethod, 'CASH');
    assert.equal(input.note, 'ขายหน้าร้าน');
    assert.equal(input.counterpartyId, undefined);
    assert.equal(input.lines.length, 2);
    assert.deepEqual(input.lines[0], { lineNumber: 1, description: 'ขายสินค้า', quantity: '1', unitPrice: '100', vatRate: '7', revenueCategoryId: 'cat-1' });
    assert.deepEqual(input.lines[1], { lineNumber: 2, description: 'ขายสินค้า', quantity: '1', unitPrice: '50' });
  });
  it('omits vatRate entirely for a NOT_REGISTERED company', () => {
    const input = buildSimpleIncomeInput(form({ visibility: 'HIDDEN' }), { idempotencyKey: 'k-123456789' });
    assert.equal(input.vatMode, 'NO_VAT');
    assert.equal('vatRate' in input.lines[0]!, false);
  });
  it('refuses to build when a line has no VAT choice', () => {
    assert.throws(() => buildSimpleIncomeInput(form({ lines: [line({ vatChoice: null })] }), { idempotencyKey: 'k-123456789' }));
  });
  it('carries the due date only in the invoice draft body', () => {
    const body = buildInvoiceDraftInput(form({ mode: 'invoice', dueDate: '2026-09-10' }), { counterpartyId: 'cp-1' });
    assert.equal(body.documentType, 'INVOICE');
    assert.equal(body.dueDate, '2026-09-10');
    assert.equal(body.counterpartyId, 'cp-1');
    assert.equal(body.vatMode, 'VAT_EXCLUDED');
  });
});

describe('simpleIncomeIdempotencyKey', () => {
  const payload = (() => {
    const { idempotencyKey: _key, ...rest } = buildSimpleIncomeInput(form(), { idempotencyKey: 'x-00000000' });
    return rest;
  })();
  it('stays stable for one page-load intent even when the payload is edited', () => {
    const first = simpleIncomeIdempotencyKey('nonce-a', payload);
    assert.equal(simpleIncomeIdempotencyKey('nonce-a', payload), first);
    assert.notEqual(simpleIncomeIdempotencyKey('nonce-b', payload), first);
    const edited = { ...payload, lines: [{ ...payload.lines[0]!, unitPrice: '101' }] };
    assert.equal(simpleIncomeIdempotencyKey('nonce-a', edited), first);
  });
  it('matches the API key pattern', () => {
    assert.match(simpleIncomeIdempotencyKey('nonce-a', payload), /^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('invoiceDraftIdempotencyKey', () => {
  it('is stable for the page intent and separate from the received-income command', () => {
    assert.equal(invoiceDraftIdempotencyKey('page-1'), invoiceDraftIdempotencyKey('page-1'));
    assert.notEqual(invoiceDraftIdempotencyKey('page-1'), simpleIncomeIdempotencyKey('page-1', {} as never));
    assert.match(invoiceDraftIdempotencyKey('page-1'), /^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('permission gating (spec §7.2 row 1)', () => {
  const granular = ['accounting.invoice.create', 'accounting.invoice.issue', 'accounting.payment.create', 'accounting.receipt.issue'];
  it('received mode needs all four composite permissions', () => {
    assert.equal(canRecordReceivedIncome(granular), true);
    assert.equal(canRecordReceivedIncome(granular.filter((p) => p !== 'accounting.payment.create')), false);
    assert.equal(canRecordReceivedIncome(granular.filter((p) => p !== 'accounting.receipt.issue')), false);
  });
  it('accepts the accounting.document.* umbrella like the backend', () => {
    assert.equal(canRecordReceivedIncome(['accounting.document.create', 'accounting.document.issue', 'accounting.payment.create']), true);
  });
  it('invoice mode needs only its own create/issue', () => {
    assert.equal(canCreateIncomeInvoice(['accounting.invoice.create']), true);
    assert.equal(canCreateIncomeInvoice([]), false);
    assert.equal(canIssueIncomeInvoice(['accounting.invoice.issue']), true);
    assert.equal(canIssueIncomeInvoice(['accounting.invoice.create']), false);
  });
});

function taxInvoiceSource(overrides: Partial<CorrectionSourceDocument> = {}): CorrectionSourceDocument {
  return {
    id: 'doc-1',
    documentType: 'TAX_INVOICE',
    status: 'ISSUED',
    vatMode: 'VAT_EXCLUDED',
    vatAmount: '105.00',
    outputTaxCode: 'O7',
    counterpartyId: 'cp-9',
    lines: [
      { lineNumber: 1, description: 'สินค้า A', lineTotalAmount: '1070.00', vatAmount: '70.00', vatRate: '7', whtRate: '3', taxSnapshot: { externalTaxCode: 'O7' } },
      { lineNumber: 2, description: 'สินค้า B', lineTotalAmount: '535.00', vatAmount: '35.00', vatRate: '7', taxSnapshot: { externalTaxCode: 'O7' } },
    ],
    ...overrides,
  };
}

describe('correctionEligibility (spec F-LED-6 source rules)', () => {
  it('offers corrections on an issued TAX_INVOICE with snapshots', () => {
    assert.deepEqual(correctionEligibility(taxInvoiceSource()), { visible: true, enabled: true, reason: null });
  });
  it('disables with a reason when a snapshot is missing', () => {
    const result = correctionEligibility(taxInvoiceSource({ lines: [{ lineNumber: 1, description: 'x', lineTotalAmount: '100.00', vatAmount: '0.00' }] }));
    assert.equal(result.visible, true);
    assert.equal(result.enabled, false);
    assert.match(result.reason ?? '', /ข้อมูลภาษีของบางรายการไม่ครบ/);
  });
  it('allows a non-VAT INVOICE and blocks a VAT-bearing INVOICE', () => {
    const nonVat = correctionEligibility(taxInvoiceSource({
      documentType: 'INVOICE', vatMode: 'NO_VAT', vatAmount: '0.00', outputTaxCode: undefined,
      lines: [{ lineNumber: 1, description: 'x', lineTotalAmount: '300.00', vatAmount: '0.00' }],
    }));
    assert.deepEqual(nonVat, { visible: true, enabled: true, reason: null });
    const withVat = correctionEligibility(taxInvoiceSource({ documentType: 'INVOICE', outputTaxCode: undefined }));
    assert.equal(withVat.enabled, false);
    assert.match(withVat.reason ?? '', /ใบกำกับภาษี/);
  });
  it('hides corrections for drafts and non-correctable types', () => {
    assert.equal(correctionEligibility(taxInvoiceSource({ status: 'DRAFT' })).visible, false);
    assert.equal(correctionEligibility(taxInvoiceSource({ documentType: 'RECEIPT' })).visible, false);
  });
});

describe('correctionLineBasis', () => {
  it('strips VAT only for excluded pricing', () => {
    assert.equal(correctionLineBasis({ lineTotalAmount: '1070.00', vatAmount: '70.00' }, 'VAT_EXCLUDED'), '1000.00');
    assert.equal(correctionLineBasis({ lineTotalAmount: '107.00', vatAmount: '7.00' }, 'VAT_INCLUDED'), '107.00');
  });
});

describe('buildCorrectionInput (original → corrected → difference)', () => {
  it('builds a credit note from the per-line difference with inherited tax facts', () => {
    const result = buildCorrectionInput({
      mode: 'CREDIT_NOTE', source: taxInvoiceSource(), corrected: { 1: '800' },
      reasonCode: 'GOODS_RETURNED', reasonText: '', documentDate: '2026-08-26',
    });
    assert.ok('body' in result);
    assert.equal(result.diffTotal, 200);
    assert.equal(result.body.documentType, 'CREDIT_NOTE');
    assert.equal(result.body.sourceDocumentId, 'doc-1');
    assert.equal(result.body.sourceDocumentType, 'TAX_INVOICE');
    assert.equal(result.body.vatMode, 'VAT_EXCLUDED');
    assert.equal(result.body.outputTaxCode, 'O7');
    assert.equal(result.body.adjustmentReasonCode, 'GOODS_RETURNED');
    assert.deepEqual(result.body.lines, [
      { lineNumber: 1, description: 'สินค้า A', quantity: '1', unitPrice: '200.00', vatRate: '7', whtRate: '3', externalTaxCode: 'O7' },
    ]);
  });
  it('keeps untouched lines out and refuses an all-zero correction', () => {
    const result = buildCorrectionInput({
      mode: 'CREDIT_NOTE', source: taxInvoiceSource(), corrected: {},
      reasonCode: 'GOODS_RETURNED', reasonText: '', documentDate: '2026-08-26',
    });
    assert.ok('error' in result);
    assert.match(result.error, /ยังไม่มียอดที่เปลี่ยนแปลง/);
  });
  it('caps a credit line at its original amount', () => {
    const result = buildCorrectionInput({
      mode: 'CREDIT_NOTE', source: taxInvoiceSource(), corrected: { 1: '1200' },
      reasonCode: 'GOODS_RETURNED', reasonText: '', documentDate: '2026-08-26',
    });
    assert.ok('error' in result);
    assert.match(result.error, /ต้องไม่เกินยอดเดิม 1000\.00/);
  });
  it('uses the server-computed remaining amount after earlier corrections', () => {
    const result = buildCorrectionInput({
      mode: 'CREDIT_NOTE',
      source: taxInvoiceSource({
        status: 'CREDITED',
        lines: [{ ...taxInvoiceSource().lines[0]!, correctionBasisAmount: '600.00' }],
      }),
      corrected: { 1: '550' }, reasonCode: 'GOODS_RETURNED', reasonText: '', documentDate: '2026-08-26',
    });
    assert.ok('body' in result);
    assert.equal(result.body.lines[0]!.unitPrice, '50.00');
  });
  it('requires detail text for OTHER_PRESCRIBED and a reason from the right list', () => {
    const noText = buildCorrectionInput({
      mode: 'CREDIT_NOTE', source: taxInvoiceSource(), corrected: { 1: '800' },
      reasonCode: 'OTHER_PRESCRIBED', reasonText: ' ', documentDate: '2026-08-26',
    });
    assert.ok('error' in noText && /ระบุรายละเอียด/.test(noText.error));
    const wrongList = buildCorrectionInput({
      mode: 'DEBIT_NOTE', source: taxInvoiceSource(), corrected: { 1: '1200' },
      reasonCode: 'GOODS_RETURNED', reasonText: '', documentDate: '2026-08-26',
    });
    assert.ok('error' in wrongList && /ใช้กับเอกสารชนิดนี้ไม่ได้/.test(wrongList.error));
  });
  it('builds a debit note only when the corrected value is higher', () => {
    const increased = buildCorrectionInput({
      mode: 'DEBIT_NOTE', source: taxInvoiceSource(), corrected: { 1: '1200' },
      reasonCode: 'GOODS_PRICE_UNDERSTATED', reasonText: '', documentDate: '2026-08-26',
    });
    assert.ok('body' in increased);
    assert.equal(increased.body.lines[0]!.unitPrice, '200.00');
    const decreased = buildCorrectionInput({
      mode: 'DEBIT_NOTE', source: taxInvoiceSource(), corrected: { 1: '800' },
      reasonCode: 'GOODS_PRICE_UNDERSTATED', reasonText: '', documentDate: '2026-08-26',
    });
    assert.ok('error' in decreased && /ต้องไม่ต่ำกว่ายอดเดิม/.test(decreased.error));
  });
  it('sends no tax fields when correcting a non-VAT INVOICE', () => {
    const result = buildCorrectionInput({
      mode: 'CREDIT_NOTE',
      source: taxInvoiceSource({
        documentType: 'INVOICE', vatMode: 'NO_VAT', vatAmount: '0.00', outputTaxCode: undefined,
        lines: [{ lineNumber: 1, description: 'ค่าบริการ', lineTotalAmount: '300.00', vatAmount: '0.00' }],
      }),
      corrected: { 1: '250' }, reasonCode: 'SERVICE_DEFECT', reasonText: '', documentDate: '2026-08-26',
    });
    assert.ok('body' in result);
    assert.equal(result.body.outputTaxCode, undefined);
    assert.deepEqual(result.body.lines, [{ lineNumber: 1, description: 'ค่าบริการ', quantity: '1', unitPrice: '50.00' }]);
  });
});

describe('reason options mirror the backend legal allow-lists', () => {
  it('covers every code exactly, per document type', () => {
    assert.deepEqual([...CREDIT_NOTE_REASON_OPTIONS.map((option) => option.code)].sort(), [...ACCOUNTING_CREDIT_NOTE_REASON_CODES].sort());
    assert.deepEqual([...DEBIT_NOTE_REASON_OPTIONS.map((option) => option.code)].sort(), [...ACCOUNTING_DEBIT_NOTE_REASON_CODES].sort());
  });
});
