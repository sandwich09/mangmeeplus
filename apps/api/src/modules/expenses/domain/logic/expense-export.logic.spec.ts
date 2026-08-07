import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNTANT_INDEX_COLUMNS, ACCOUNTANT_INDEX_SUMMARY_COLUMNS } from '@watchdog-bms/contracts';
import { buildAccountantIndexCsv, buildAccountantIndexRow } from './expense-export.logic';

// The accountant export must NOT follow the expense capture mode.
//
// The index CSV is the machine-key contract for system-to-system consumers, read by column
// position; and a zero VAT column in the XLSX is a true statement — it is what an accounting
// office reads as evidence there was no input VAT, not a leftover to tidy away. Hiding the tax
// fields in the capture UI makes those columns *look* like debris, which is exactly why this
// test exists: a file that leaves the system must not change shape because a form did.
const nonVatExpense = {
  companyName: 'ร้านตัวอย่าง', companyTaxId: null, branchCode: null,
  expenseId: 'exp-1', expenseNumber: 'EXP-202608-00001', status: 'CONFIRMED',
  captureSource: 'WEB_MANUAL', sourceDocumentType: 'RECEIPT' as const,
  taxEvidenceStatus: 'NOT_TAX_EVIDENCE' as const, taxEvidenceReasonCode: null,
  postingStatus: 'POSTED', postingError: null, journalEntryNumber: 'JV-1',
  uploadedAt: '2026-08-05T03:00:00.000Z', expenseDate: '2026-08-05',
  requesterName: null, uploaderName: null, reviewerName: null,
  vendorNameSnapshot: 'ร้านกาแฟ', vendorTaxIdSnapshot: null, vendorBranchCodeSnapshot: null,
  vendorDocumentNumber: null, categoryName: 'ค่าอาหารและเครื่องดื่ม', accountHintKey: null,
  description: 'กาแฟ', quantity: '1',
  subtotalAmount: '65.00', discountAmount: '0.00', taxableAmount: '65.00',
  vatAmount: '0.00', whtAmount: '0.00', grandTotalAmount: '65.00',
  netPayableAmount: '65.00', paidAmount: '65.00', outstandingAmount: '0.00',
  paymentMethod: 'CASH', paidAt: '2026-08-05', paymentReference: null,
  substituteReceiptRef: null, primaryAttachmentId: null, attachments: [],
  webUrl: 'https://example.invalid/e/exp-1', notes: null,
};

describe('accountant index is independent of expense capture mode', () => {
  it('keeps every tax column for an expense with no VAT', () => {
    const row = buildAccountantIndexRow(nonVatExpense);

    for (const column of ['taxable_amount', 'vat_amount', 'wht_amount', 'tax_evidence_status'] as const) {
      assert.ok(column in row, `${column} must stay in the index row`);
    }
    assert.equal(row.vat_amount, '0.00');
    assert.equal(row.tax_evidence_status, 'NOT_TAX_EVIDENCE');
  });

  it('writes the CSV in the full fixed column order, tax columns included', () => {
    const [header] = buildAccountantIndexCsv([buildAccountantIndexRow(nonVatExpense)]).split('\n');

    assert.equal(header, ACCOUNTANT_INDEX_COLUMNS.join(','));
    assert.ok(ACCOUNTANT_INDEX_COLUMNS.includes('vat_amount'));
  });

  it('keeps vat_amount in the summary column set the UI downloads by default', () => {
    assert.ok(ACCOUNTANT_INDEX_SUMMARY_COLUMNS.includes('vat_amount'));
  });
});
