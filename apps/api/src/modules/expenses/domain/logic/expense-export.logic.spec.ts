import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNTANT_INDEX_COLUMNS, ACCOUNTANT_INDEX_SUMMARY_COLUMNS } from '@watchdog-bms/contracts';
import type { ExpenseAttachmentPurpose } from '@watchdog-bms/contracts';
import { buildAccountantIndexCsv, buildAccountantIndexRow, buildManifestEntry, evidenceRef, exportSourceChannel, WET_SIGNED_SCAN_EVIDENCE_ROLE } from './expense-export.logic';

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
  additionalChargesAmount: '0',
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

  /**
   * Expense spec §5.1 moved the additional charges out of `subtotal_amount`. An accountant reads
   * this file by adding the columns up, so without a charges column a BHC-style bill would show
   * 1,520 goods against a 1,789.04 total with 269.04 unaccounted for. The column is TRAILING so
   * every existing position-based consumer keeps its offsets.
   */
  it('keeps the row additive once the charges leave the goods subtotal', () => {
    const row = buildAccountantIndexRow({
      ...nonVatExpense,
      subtotalAmount: '1520.00', discountAmount: '0.00', additionalChargesAmount: '152.00',
      taxableAmount: '1672.00', vatAmount: '117.04', grandTotalAmount: '1789.04',
    });
    const sum = (...values: string[]) => values.reduce((total, value) => total + Number(value), 0);
    assert.equal(row.additional_charges_amount, '152.00');
    assert.equal(
      sum(row.subtotal_amount, row.additional_charges_amount, row.vat_amount) - Number(row.discount_amount),
      Number(row.grand_total_amount),
    );
    // Both slices appended a column rather than inserting one, which is what keeps every existing
    // consumer's offsets intact — the point of the original assertion. Slice A's
    // `document_date_status` sorts after this one by name, so the pair sits at the tail in that
    // order and nothing before them moved.
    assert.deepEqual(ACCOUNTANT_INDEX_COLUMNS.slice(-5, -3), ['additional_charges_amount', 'document_date_status']);
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

describe('R11 — the hand-signed scan is part of the certificate, not supporting evidence', () => {
  const attachment = (id: string, purpose: ExpenseAttachmentPurpose) => ({
    id, purpose, originalFileName: `${id}.jpg`, mimeType: 'image/jpeg', byteSize: 10, checksumSha256: 'c',
    status: 'ACTIVE', createdAt: '2026-08-05T03:00:00.000Z',
  });

  it('keeps the scan out of supporting_evidence_refs', () => {
    const source = {
      ...nonVatExpense,
      primaryAttachmentId: 'att-primary',
      attachments: [
        attachment('att-primary', 'expense.receipt.primary'),
        attachment('att-slip', 'expense.payment.evidence'),
        attachment('att-scan', 'expense.review.evidence'),
      ],
      wetSignedScanAttachmentIds: ['att-scan'],
    };

    const refs = buildAccountantIndexRow(source).supporting_evidence_refs;

    assert.ok(refs.includes(evidenceRef(source.expenseNumber, source.expenseId, 'att-slip')));
    assert.equal(refs.includes(evidenceRef(source.expenseNumber, source.expenseId, 'att-scan')), false,
      'the signature page is not a second piece of evidence that the money was spent');
    // Without the certificate's own scan list nothing changes for every other expense.
    assert.ok(buildAccountantIndexRow({ ...source, wetSignedScanAttachmentIds: [] }).supporting_evidence_refs
      .includes(evidenceRef(source.expenseNumber, source.expenseId, 'att-scan')));
  });

  it('gives the scan its own manifest role instead of the shared certification-chain purpose', () => {
    const base = {
      expenseId: 'exp-1', expenseNumber: 'EXP-202608-00001',
      attachment: attachment('att-scan', 'expense.review.evidence'),
      sourceDocumentType: 'RECEIPT' as const, taxEvidenceStatus: 'NOT_TAX_EVIDENCE' as const,
      downloadUrl: 'https://example/d', downloadUrlExpiresAt: '2026-08-05T04:00:00.000Z',
      webUrl: '/companies/co-1/expenses/exp-1',
    };

    assert.equal(buildManifestEntry({ ...base, isWetSignedScan: true }).evidence_role, WET_SIGNED_SCAN_EVIDENCE_ROLE);
    assert.equal(buildManifestEntry(base).evidence_role, 'expense.review.evidence');
  });
});

/**
 * Capture appendix §5/A39: a derived source is an ordinary financial document in the export — no
 * new column, no parent row, and the only thing that changes is its evidence ref, which now names
 * the job two receipts were split out of. An ordinary expense's ref must not move by one byte, or
 * every package already delivered stops reconciling.
 */
describe('capture lineage in the accountant export', () => {
  it('leaves an ordinary expense ref exactly as it was', () => {
    assert.equal(evidenceRef('EXP-202608-00001', 'exp-1', 'attachment-01234567'), 'EXP-202608-00001-01234567');
    assert.equal(evidenceRef(null, 'exp-1', 'attachment-01234567'), 'exp-1-01234567');
    assert.equal(evidenceRef('EXP-1', 'exp-1', 'attachment-01234567', null), 'EXP-1-01234567');
  });

  it('names the capture group in a derived source ref, in both the index and the manifest', () => {
    const source = {
      ...nonVatExpense,
      captureGroupId: 'group-abcdefgh',
      primaryAttachmentId: 'att-primary-1',
      attachments: [
        { id: 'att-primary-1', purpose: 'expense.receipt.primary' as ExpenseAttachmentPurpose, originalFileName: 'a.pdf', mimeType: 'application/pdf', byteSize: 1, checksumSha256: null, status: 'ACTIVE', createdAt: '2026-08-05T03:00:00.000Z' },
        { id: 'att-support-2', purpose: 'expense.receipt.supporting' as ExpenseAttachmentPurpose, originalFileName: 'b.pdf', mimeType: 'application/pdf', byteSize: 1, checksumSha256: null, status: 'ACTIVE', createdAt: '2026-08-05T03:00:00.000Z' },
      ],
    };
    const row = buildAccountantIndexRow(source);

    assert.equal(row.primary_evidence_ref, 'EXP-202608-00001-rimary-1-gabcdefgh');
    assert.equal(row.supporting_evidence_refs, 'EXP-202608-00001-upport-2-gabcdefgh');
    // No new column: the group rides inside the ref the folder is keyed by (§5).
    assert.equal(Object.keys(row).some((key) => key.includes('capture_group')), false);

    const manifest = buildManifestEntry({
      expenseId: source.expenseId, expenseNumber: source.expenseNumber, captureGroupId: 'group-abcdefgh',
      attachment: source.attachments[0]!,
      sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'NOT_TAX_EVIDENCE',
      downloadUrl: 'https://example/d', downloadUrlExpiresAt: '2026-08-05T04:00:00.000Z',
      webUrl: '/companies/co-1/expenses/exp-1',
    });
    assert.equal(manifest.evidence_ref, row.primary_evidence_ref, 'the index row and the file must agree on the key');
  });

  it('never leaks a raw capture-source enum into the export channel column', () => {
    assert.equal(exportSourceChannel('LINE_UPLOAD'), 'LINE');
    assert.equal(exportSourceChannel('WEB_UPLOAD'), 'WEB');
    // A capture source added later is a storage enum, not an accountant-facing channel name.
    assert.equal(exportSourceChannel('SOME_FUTURE_LANE'), 'OTHER');
    assert.equal(buildAccountantIndexRow({ ...nonVatExpense, captureSource: 'SOME_FUTURE_LANE' }).source_channel, 'OTHER');
  });
});
