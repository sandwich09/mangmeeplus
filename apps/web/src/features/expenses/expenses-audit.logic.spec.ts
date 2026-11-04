import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TAX_EVIDENCE_STATUS_LABELS, deriveExpenseAuditChecks } from './expenses.model';

type AuditInput = Parameters<typeof deriveExpenseAuditChecks>[0];

const base: AuditInput = {
  sourceDocumentType: 'TAX_INVOICE',
  vendorTaxIdSnapshot: '0105536112014',
  vendorNameSnapshot: 'บริษัท ตัวอย่าง จำกัด',
  vendorDocumentNumber: 'INV-2026-001',
  expenseDate: '2026-07-01',
  vatMode: 'VAT_EXCLUDED',
  taxableAmount: '100.00',
  vatAmount: '7.00',
  taxEvidenceStatus: 'USABLE_FOR_TAX',
  taxEvidenceReasonCode: null,
  duplicateStatus: 'NO_MATCH',
  aiVerificationSummaryJson: null,
  lines: [{ taxableAmount: '100.00', vatRate: '0.07' }],
};

// Spec §19g decision 5 compares recorded VAT against the document's OWN rate, so a document-level
// taxable override without a matching line would be describing an impossible document.
const check = (over: Partial<AuditInput>, key: string) => {
  const merged = { ...base, ...over };
  const lines = over.lines ?? [{ taxableAmount: merged.taxableAmount, vatRate: base.lines[0]!.vatRate }];
  return deriveExpenseAuditChecks({ ...merged, lines }).find((c) => c.key === key);
};

describe('deriveExpenseAuditChecks', () => {
  it('warns about an invalid seller checksum on ordinary receipts and non-VAT shops too', () => {
    for (const sourceDocumentType of ['RECEIPT', 'TAX_INVOICE'] as const) {
      assert.equal(check({ sourceDocumentType, vendorTaxIdSnapshot: '1234567890123', inputVatRight: { vatStatus: 'NOT_REGISTERED' } as any }, 'vendor_tax_id')?.status, 'warn');
    }
  });
  it('passes vendor tax id when exactly 13 digits', () => {
    const c = check({}, 'vendor_tax_id');
    assert.equal(c?.status, 'pass');
    assert.equal(c?.label, 'เลขผู้เสียภาษีผู้ขายครบ 13 หลัก');
  });

  it('warns on missing tax id for TAX_INVOICE but never asks a RECEIPT for tax-invoice details', () => {
    const invoice = check({ vendorTaxIdSnapshot: null }, 'vendor_tax_id');
    assert.equal(invoice?.status, 'warn');
    assert.equal(invoice?.label, 'ยังไม่มีเลขผู้เสียภาษีผู้ขาย');
    assert.equal(invoice?.detail, 'กรอกเลขผู้เสียภาษีผู้ขายให้ครบ 13 หลักก่อนตรวจ VAT สำหรับยื่นภาษี');

    const receipt = check({ vendorTaxIdSnapshot: '', sourceDocumentType: 'RECEIPT' }, 'vendor_tax_id');
    assert.equal(receipt, undefined);
  });

  it('accepts a tax id formatted with dashes as printed on Thai invoices', () => {
    assert.equal(check({ vendorTaxIdSnapshot: '0-1055-58096-34-8' }, 'vendor_tax_id')?.status, 'pass');
  });

  it('counts a complete tax id with a wrong check digit as a warning, not a blocker', () => {
    const c = check({ vendorTaxIdSnapshot: '1234567890123' }, 'vendor_tax_id');
    assert.equal(c?.status, 'warn');
    assert.equal(c?.label, 'เลขผู้เสียภาษีผู้ขายครบ 13 หลัก แต่ดูไม่ถูกต้อง');
  });

  it('flags a partial (non-13-digit) tax id as needing review, with a distinct label', () => {
    const c = check({ vendorTaxIdSnapshot: '12345' }, 'vendor_tax_id');
    assert.equal(c?.status, 'warn');
    assert.equal(c?.label, 'เลขผู้เสียภาษีผู้ขายไม่ครบ 13 หลัก — ตรวจทานจากเอกสาร');
  });

  it('passes VAT when it matches 7% of the taxable base within 5 satang', () => {
    assert.equal(check({}, 'vat_check')?.status, 'pass');
    assert.equal(check({ taxableAmount: '1000.00', vatAmount: '70.04' }, 'vat_check')?.status, 'pass');
  });

  it('informs (not warns) when the document consistently uses a non-7% rate', () => {
    const c = check({
      taxableAmount: '1000.00', vatAmount: '65.00',
      lines: [{ taxableAmount: '1000.00', vatRate: '0.065' }],
    }, 'vat_check');
    assert.equal(c?.status, 'info');
    assert.equal(c?.label, 'VAT คำนวณตามอัตราที่ระบุ (6.5%) ไม่ใช่ 7% มาตรฐาน');
  });

  // Spec §19g: the reported Starbucks draft — mode says VAT applies, no rate was ever read, and the
  // whole gross sat in the tax base. The old hardcoded-7% check called this a non-standard rate.
  it('warns when a VAT mode carries no rate at all, instead of calling it a non-standard rate', () => {
    const c = check({
      vatMode: 'VAT_INCLUDED', taxableAmount: '180.00', vatAmount: '0.00',
      lines: [{ taxableAmount: '180.00', vatRate: null }],
    }, 'vat_check');
    assert.equal(c?.status, 'warn');
    assert.equal(c?.label, 'โหมดเอกสารระบุว่ามี VAT แต่ยังไม่ได้ระบุอัตรา VAT');
  });

  it('warns when the recorded VAT contradicts the rate the document states', () => {
    const c = check({
      taxableAmount: '1000.00', vatAmount: '0.00',
      lines: [{ taxableAmount: '1000.00', vatRate: '0.07' }],
    }, 'vat_check');
    assert.equal(c?.status, 'warn');
    assert.equal(c?.label, 'ยอด VAT ไม่ตรงกับอัตราที่ระบุไว้ — ตรวจทานอีกครั้ง');
  });

  // A mixed-rate receipt (VAT-bearing goods + exempt items) is legitimate, not a mismatch.
  it('passes a mixed-rate document when the VAT total matches the per-line rates', () => {
    const c = check({
      taxableAmount: '300.00', vatAmount: '7.00',
      lines: [{ taxableAmount: '100.00', vatRate: '0.07' }, { taxableAmount: '200.00', vatRate: '0' }],
    }, 'vat_check');
    assert.equal(c?.status, 'info');
    assert.equal(c?.label, 'VAT คำนวณตามอัตราที่ระบุ (หลายอัตรา) ไม่ใช่ 7% มาตรฐาน');
  });

  it('skips the VAT check for NO_VAT mode or a zero taxable base', () => {
    assert.equal(check({ vatMode: 'NO_VAT' }, 'vat_check'), undefined);
    assert.equal(check({ taxableAmount: '0.00' }, 'vat_check'), undefined);
  });

  it('shows every saved tax answer in the exact words used by step 2', () => {
    for (const taxEvidenceStatus of ['USABLE_FOR_TAX', 'SUPPORTING_ONLY', 'NOT_TAX_EVIDENCE'] as const) {
      assert.equal(check({ taxEvidenceStatus }, 'tax_evidence')?.label, `หลักฐานรายจ่าย: ${TAX_EVIDENCE_STATUS_LABELS[taxEvidenceStatus]}`);
    }
  });

  it('marks SUPPORTING_ONLY evidence as info, not a warning', () => {
    const c = check({ taxEvidenceStatus: 'SUPPORTING_ONLY' }, 'tax_evidence');
    assert.equal(c?.status, 'info');
    assert.equal(c?.label, `หลักฐานรายจ่าย: ${TAX_EVIDENCE_STATUS_LABELS.SUPPORTING_ONLY}`);
  });

  // Spec §19h: an abbreviated invoice is complete, not deficient, so the generic supporting-only
  // wording would leave the reviewer hunting for a missing field that does not exist.
  it('explains an abbreviated tax invoice specifically instead of the generic supporting-only line', () => {
    const c = check({
      sourceDocumentType: 'ABBREVIATED_TAX_INVOICE',
      taxEvidenceStatus: 'SUPPORTING_ONLY',
      taxEvidenceReasonCode: 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE',
    }, 'tax_evidence');
    assert.equal(c?.status, 'info');
    assert.equal(c?.label, `หลักฐานรายจ่าย: ${TAX_EVIDENCE_STATUS_LABELS.SUPPORTING_ONLY}`);
    assert.match(c?.detail ?? '', /ขอใบกำกับภาษีเต็มรูปจากผู้ขาย/);
  });

  it('warns for pending evidence and surfaces the reason label as detail', () => {
    const c = check({ taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'MISSING_VENDOR_TAX_ID' }, 'tax_evidence');
    assert.equal(c?.status, 'warn');
    assert.equal(c?.label, 'หลักฐานรายจ่าย: รอตรวจ');
    assert.equal(c?.detail, 'ขาดเลขประจำตัวผู้เสียภาษีของผู้ขาย');
  });

  it('adds a duplicate warning only for unresolved duplicate statuses', () => {
    assert.equal(check({}, 'duplicate'), undefined);
    const c = check({ duplicateStatus: 'POSSIBLE_DUPLICATE' }, 'duplicate');
    assert.equal(c?.status, 'warn');
    assert.equal(c?.label, 'อาจเป็นรายการซ้ำ ต้องตรวจสอบก่อนยืนยัน');
    assert.equal(check({ duplicateStatus: 'CONFIRMED_DUPLICATE' }, 'duplicate')?.status, 'warn');
    assert.equal(check({ duplicateStatus: 'CONFIRMED_DUPLICATE' }, 'duplicate')?.label, 'ยืนยันแล้วว่าเป็นรายการซ้ำ ไม่สามารถยืนยันค่าใช้จ่ายซ้ำได้');
  });
});

describe('receiptless expense certificate summary', () => {
  const receiptless = (receiptProblem = 'NOT_AVAILABLE', certificate?: AuditInput['substituteReceiptEvidence']): AuditInput => ({ ...base,
    sourceDocumentType: 'EXPENSE_NOTE_TEXT', vendorTaxIdSnapshot: null, vendorDocumentNumber: null,
    substituteReceiptEvidence: certificate,
    aiVerificationSummaryJson: { documentReview: { assessment: { receiptProblem, route: 'SUBSTITUTE_RECEIPT', attachmentIds: [], reason: 'ร้านไม่มีใบเสร็จ' } } },
  });
  it('no receipt and no certificate says it has not been made, without invoice-only checks', () => {
    const checks = deriveExpenseAuditChecks(receiptless());
    assert.deepEqual(checks.find(c => c.key === 'receipt'), { key: 'receipt', status: 'warn', label: 'ไม่มีใบเสร็จ', detail: 'ยังไม่ได้ทำใบรับรองแทนใบเสร็จ' });
    assert.ok(!checks.some(c => ['vendor_tax_id', 'document_number', 'tax_evidence'].includes(c.key)));
  });
  it('no receipt with a waiting certificate names its number and actual waiting state', () => {
    for (const [status, label] of [['PREPARED', 'รอเซ็น'], ['PAYER_CERTIFIED', 'รออนุมัติ']] as const) {
      assert.deepEqual(deriveExpenseAuditChecks(receiptless('NOT_AVAILABLE', { status, documentNumber: 'SRC-01' })).find(c => c.key === 'receipt'),
        { key: 'receipt', status: 'warn', label: 'ไม่มีใบเสร็จ', detail: `ใบรับรองแทนใบเสร็จ SRC-01 · ${label}` });
    }
  });
  it('no receipt with an issued certificate passes and names the issued certificate', () => {
    assert.deepEqual(deriveExpenseAuditChecks(receiptless('NOT_AVAILABLE', { status: 'ISSUED', documentNumber: 'SRC-01' })).find(c => c.key === 'receipt'),
      { key: 'receipt', status: 'pass', label: 'ไม่มีใบเสร็จ', detail: 'ใบรับรองแทนใบเสร็จ SRC-01 · ออกแล้ว' });
  });
  it('lost receipt uses the saved answer and cancelled evidence requires a new certificate', () => {
    const checks = deriveExpenseAuditChecks(receiptless('LOST', { status: 'SUPERSEDED', documentNumber: 'SRC-01' }));
    assert.deepEqual(checks.find(c => c.key === 'receipt'), { key: 'receipt', status: 'warn', label: 'ใบเสร็จหาย', detail: 'ยังไม่ได้ทำใบรับรองแทนใบเสร็จ' });
    assert.ok(!checks.some(c => ['vendor_tax_id', 'document_number', 'tax_evidence'].includes(c.key)));
  });
  it('a normal receipt keeps its invoice, reference and saved tax-answer checks', () => {
    const checks = deriveExpenseAuditChecks(base);
    assert.ok(!checks.some(c => c.key === 'receipt'));
    for (const key of ['vendor_tax_id', 'document_number', 'tax_evidence']) assert.equal(checks.find(c => c.key === key)?.status, 'pass');
  });
});

it('a nonregistered shop never gets an input VAT tax-number warning, including full invoices', () => {
  for (const sourceDocumentType of ['TAX_INVOICE', 'RECEIPT'] as const) {
    const checks = deriveExpenseAuditChecks({ ...base, sourceDocumentType, vendorTaxIdSnapshot: null,
      inputVatRight: { status: 'NON_CLAIMABLE', fixed: true, reasonCode: 'COMPANY_NOT_VAT_REGISTERED_ON_DOCUMENT_DATE', vatStatus: 'NOT_REGISTERED', latestDecision: null } });
    assert.ok(!checks.some(row => row.key === 'vendor_tax_id'));
  }
});
