import { describe, it } from 'node:test';
// Run the shared date/CSV contract alongside its registered accountant-export neighbours.
import '../../../../common/export/thai-date.logic.spec';
import assert from 'node:assert/strict';
import { ACCOUNTANT_INDEX_COLUMNS, ACCOUNTANT_INDEX_SUMMARY_COLUMNS, ACCOUNTANT_WORKBOOK_COLUMNS } from '@watchdog-bms/contracts';
import type { ExpenseAttachmentPurpose } from '@watchdog-bms/contracts';
import { buildAccountantWorkbook, buildAccountantIndexCsv, buildAccountantIndexRow, buildManifestEntry, evidenceRef, exportSourceChannel, WET_SIGNED_SCAN_EVIDENCE_ROLE } from './expense-export.logic';

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

describe('accountant workbook v2 pure projection', () => {
  it('accountant workbook contains only the defined sold-export columns', async () => {
    const logic: any = await import('./expense-export.logic');
    assert.equal(typeof logic.buildAccountantWorkbook, 'function');
    const workbook = logic.buildAccountantWorkbook({ rows: [{ expense_number: 'EXP-1', grand_total_amount: '100', currency: 'THB', expense_status: 'CONFIRMED' }],
      payments: [], withholding: [], visible: { shopBranch: false, vouchers: false, certificates: false }, about: { ร้าน: 'ร้านทดสอบ' } });
    const xml = exportedSheet(workbook);
    assert.equal((xml.match(/<row r="1"[^>]*>.*?<\/row>/s)?.[0].match(/<c /g) ?? []).length, 25);
    for (const forbidden of ['posting_status', 'posting_error', 'journal_entry_number', 'เปิดไฟล์', 'ชื่อผู้ส่ง', 'ผู้ตรวจสิทธิภาษีซื้อ']) assert.ok(!xml.includes(forbidden));
    const sheets = exportedSheet(workbook, 'xl/workbook.xml');
    assert.match(sheets, /รายการค่าใช้จ่าย/); assert.match(sheets, /เกี่ยวกับไฟล์นี้/);
    assert.doesNotMatch(sheets, /name="การจ่าย"|name="หัก ณ ที่จ่าย"|name="ไฟล์ทั้งหมด"/);
    assert.match(exportedSheet(workbook, 'xl/worksheets/sheet2.xml'), /ช่องว่าง = ไม่มีข้อมูลนี้ในมั่งมี/);
  });

  it('accountant workbook exposes no app URLs or internal IDs and keeps Thai money and optional columns', async () => {
    const logic: any = await import('./expense-export.logic');
    const workbook = logic.buildAccountantWorkbook({ rows: [{ expense_number: 'EXP-1', currency: 'USD', grand_total_amount: '107.25',
      source_document_type: 'RECEIPT', expense_status: 'CONFIRMED', input_vat_right: 'CLAIMABLE', tax_evidence_status: 'USABLE_FOR_TAX',
      vendor_branch: '00000', shop_branch: 'สาขาทดสอบ', web_url: 'https://app.test/companies/c1234567890123456789012345' }],
      payments: [{ paid_at: '2026-10-13', paidAtConfirmed: false, amount: '107.25', currency: 'USD', payment_method: 'BANK_TRANSFER', voucher_numbers: 'PV-1' }],
      withholding: [{ paid_at: '2026-10-13', form_type: 'PND3', gross_amount: '100', withheld_amount: '3', currency: 'USD', status: 'FILED', certificate_numbers: 'WHT-1' }],
      files: [{ expenseNumber: 'EXP-1', kind: 'receipts', path: 'เอกสารค่าใช้จ่าย/EXP-1.jpg', part: 1 }], part: 1,
      visible: { shopBranch: true, vouchers: false, certificates: false }, about: {} });
    const xml = [1, 2, 3, 4, 5].map(n => exportedSheet(workbook, `xl/worksheets/sheet${n}.xml`)).join('');
    const cells = [...xml.matchAll(/<(?:t|f)[^>]*>(.*?)<\/(?:t|f)>/g)].map(match => match[1]).join(' ');
    assert.doesNotMatch(cells, /http|\/companies\/|c1234567890123456789012345|CONFIRMED|CLAIMABLE|USABLE_FOR_TAX|BANK_TRANSFER|PND3|FILED/);
    for (const word of ['ดอลลาร์สหรัฐ', 'ยืนยันแล้ว', 'สำนักงานใหญ่', 'โอนเงิน', 'ภ.ง.ด.3', 'ยื่นแล้ว', 'ยังไม่ยืนยัน (13 ต.ค. 2569)', 'สาขาของร้าน']) assert.ok(cells.includes(word), word);
    assert.ok(!cells.includes('เลขที่ใบสำคัญจ่าย')); assert.ok(!cells.includes('เลขที่หนังสือรับรอง 50 ทวิ'));
    assert.match(xml, /s="3"><v>107.25<\/v>/);
  });

  it('workbook retains unusual document dates and unread-date fallback', async () => {
    const logic: any = await import('./expense-export.logic');
    const xml = exportedSheet(logic.buildAccountantWorkbook({ rows: [
      { expense_number: 'OLD', document_date: '2005-01-02', uploaded_at: '2026-10-13', dateStatus: 'implausible' },
      { expense_number: 'UNREAD', document_date: '2026-10-13', dateStatus: 'unverified' }], payments: [], withholding: [], visible: {}, about: {} }));
    assert.match(xml, /2 ม.ค. 2548/); assert.match(xml, /วันที่เอกสารควรตรวจอีกครั้ง/); assert.match(xml, /ยังไม่ระบุ/);
  });

  it('workbook values use Thai labels including unknown values', async () => {
    const logic: any = await import('./expense-export.logic');
    const contracts = await import('@watchdog-bms/contracts');
    assert.deepEqual(contracts.EXPENSE_PAYMENT_METHOD_LABELS, { CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', CARD: 'บัตรเครดิต', CHEQUE: 'เช็ค', OTHER: 'อื่นๆ' });
    assert.equal(contracts.expenseCurrencyLabel('THB'), 'บาท');
    for (const code of ['ZZZ', '', 'not-currency']) assert.equal(contracts.expenseCurrencyLabel(code), 'สกุลเงินอื่น');
    for (const [key, labels] of [['source_document_type', contracts.SOURCE_DOCUMENT_TYPE_LABELS], ['expense_status', contracts.EXPENSE_STATUS_LABELS],
      ['input_vat_right', contracts.INPUT_VAT_RIGHT_LABELS], ['tax_evidence_status', contracts.TAX_EVIDENCE_STATUS_LABELS]] as const) {
      for (const [value, word] of Object.entries(labels)) {
        const xml = exportedSheet(logic.buildAccountantWorkbook({ rows: [{ [key]: value }], payments: [], withholding: [], visible: {}, about: {} }));
        assert.ok(xml.includes(word), `${key}: ${value}`);
      }
      const xml = exportedSheet(logic.buildAccountantWorkbook({ rows: [{ [key]: 'UNKNOWN_ENUM' }], payments: [], withholding: [], visible: {}, about: {} }));
      assert.match(xml, /อื่น ๆ/); assert.doesNotMatch(xml, /UNKNOWN_ENUM/);
    }
  });

  it('workbook structure follows branches and permissions, not monthly values', async () => {
    const logic: any = await import('./expense-export.logic');
    const contracts = await import('@watchdog-bms/contracts');
    const file = { expenseNumber: 'EXP-1', kind: 'substituteReceipts', path: 'ใบรับรองแทนใบเสร็จ/ใบปัจจุบัน.pdf', part: 2, version: 'current' };
    for (const visible of [{ shopBranch: false, vouchers: false, certificates: false }, { shopBranch: true, vouchers: true, certificates: true }]) {
      const workbook = logic.buildAccountantWorkbook({ rows: [{}], payments: [{}], withholding: [{}], visible, part: 1, about: {}, files: [file,
        { ...file, path: 'ใบรับรองแทนใบเสร็จ/ใบเดิม.pdf', part: 1, version: 'superseded', replacedBy: file.path },
        { ...file, path: 'ใบรับรองแทนใบเสร็จ/ใบยกเลิก.pdf', part: 1, version: 'superseded' }] });
      const xml = [1, 2, 3, 4].map(n => exportedSheet(workbook, `xl/worksheets/sheet${n}.xml`));
      assert.equal(xml[0].includes('สาขาของร้าน'), visible.shopBranch);
      assert.equal(xml[1].includes('เลขที่ใบสำคัญจ่าย'), visible.vouchers);
      assert.equal(xml[2].includes('เลขที่หนังสือรับรอง 50 ทวิ'), visible.certificates);
      for (const word of ['ฉบับที่ใช้อยู่', 'ฉบับเดิม (มีฉบับใหม่แทนแล้ว)', 'ยกเลิกแล้ว (ไม่มีฉบับใหม่)', 'อยู่ในชุดที่ 2:', 'ชุดที่']) assert.ok(xml[3].includes(word), word);
      const headers = [contracts.ACCOUNTANT_WORKBOOK_COLUMN_LABELS, contracts.ACCOUNTANT_PAYMENT_SHEET_COLUMN_LABELS, contracts.ACCOUNTANT_WITHHOLDING_SHEET_COLUMN_LABELS, contracts.ACCOUNTANT_FILES_SHEET_COLUMN_LABELS];
      for (const [i, labels] of headers.entries()) for (const [key, value] of Object.entries(labels)) {
        if (key === 'voucher_numbers' && !visible.vouchers || key === 'certificate_numbers' && !visible.certificates) continue;
        assert.ok(xml[i].includes(value), `${i}: ${value}`);
      }
    }
  });

  it('blank means absent or inapplicable, never hidden permission data; file links have four outcomes', async () => {
    const logic: any = await import('./expense-export.logic');
    const file = { expenseNumber: 'EXP-1', kind: 'receipts', path: 'เอกสารค่าใช้จ่าย/ใบ"หนึ่ง.jpg', part: 1 };
    assert.deepEqual(logic.primaryFileCell(file, 1), { value: file.path, formula: 'HYPERLINK("เอกสารค่าใช้จ่าย/ใบ""หนึ่ง.jpg","เอกสารค่าใช้จ่าย/ใบ""หนึ่ง.jpg")' });
    assert.equal(logic.primaryFileCell(file, 2), `อยู่ในชุดที่ 1: ${file.path}`);
    assert.equal(logic.primaryFileCell({ ...file, skippedReason: 'ไม่พบไฟล์' }, 1), 'ไม่ได้รวม: ไม่พบไฟล์');
    assert.equal(logic.primaryFileCell(undefined, 1), 'ไม่มีไฟล์');
    assert.equal(logic.vendorBranchLabel(null), ''); assert.equal(logic.vendorBranchLabel('00012'), 'สาขา 00012');
    assert.equal(logic.shopBranchLabel({ name: 'สยาม', isVatEstablishment: true, taxBranchCode: '00000' }), 'สยาม · สำนักงานใหญ่');
    assert.equal(logic.accountantNotes({ dateStatus: 'implausible', hasImage: false, evidenceNote: 'ตัวจริงอยู่กับผู้ขาย', taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReason: 'มีหลักฐานประกอบ', inputVatClaimStatus: 'NON_CLAIMABLE', inputVatReason: 'ใช้ส่วนตัว' }), 'วันที่เอกสารควรตรวจอีกครั้ง · ยังไม่มีรูปเอกสาร · หมายเหตุ: ตัวจริงอยู่กับผู้ขาย · มีหลักฐานประกอบ · สิทธิภาษีซื้อ: ใช้ส่วนตัว');
  });
});

describe('accountant index is independent of expense capture mode', () => {
  it('EVID-1 exports missing-image text and the evidence note without inventing where the original is kept', () => {
    for (const note of ['', 'อยู่กับผู้ทำบัญชี']) {
      const assessment = { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: [], reason: '', originalDocumentAvailable: true, note };
      const source = { ...nonVatExpense, sourceDocumentType: 'TAX_INVOICE' as const, taxEvidenceStatus: 'USABLE_FOR_TAX' as const, inputVatClaimStatus: 'CLAIMABLE' as const,
        aiVerificationSummaryJson: { documentEvidenceDraft: assessment } };
      const row = buildAccountantIndexRow(source);
      assert.equal(row.notes, ['ยังไม่มีรูปเอกสาร', note ? `หมายเหตุ: ${note}` : ''].filter(Boolean).join(' · '));
      assert.equal(row.input_vat_right, 'CLAIMABLE');
      assert.doesNotMatch(buildAccountantIndexCsv([row]), /ตัวจริงอยู่ที่ร้าน/);
      const xml = exportedSheet(buildAccountantWorkbook({ rows: [row], payments: [], withholding: [], visible: {}, about: {} }));
      assert.ok(xml.includes('ยังไม่มีรูปเอกสาร')); if (note) assert.ok(xml.includes(`หมายเหตุ: ${note}`));
    }
  });

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
    // order and nothing before them moved. GAP-7's `vendor_address` appended after them for the
    // same reason, which is why these offsets shifted by one and nothing else did.
    assert.deepEqual(ACCOUNTANT_INDEX_COLUMNS.slice(43, 45), ['additional_charges_amount', 'document_date_status']);
  });

  /**
   * GAP-7: a full tax invoice's seller address is on the paper the accounting office reconciles
   * against, and it was in no column of the file that leaves the system. Appended, never inserted —
   * `vendor_address` next to `vendor_tax_id` would move every column after it for CSV consumers
   * that read by position.
   */
  it('exports the printed seller address, empty for a row that has none', () => {
    const withAddress = buildAccountantIndexRow({
      ...nonVatExpense,
      vendorAddressSnapshot: '123/4 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
    });

    assert.equal(withAddress.vendor_address, '123/4 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110');
    // §8/AC12: rows written before the column existed still export, as an empty cell.
    assert.equal(buildAccountantIndexRow(nonVatExpense).vendor_address, '');
    assert.equal(ACCOUNTANT_INDEX_COLUMNS[48], 'vendor_address');
    const [header, body] = buildAccountantIndexCsv([withAddress]).split('\n');
    assert.equal(header!.split(',')[48], 'vendor_address');
    assert.equal(body!.split(',')[48], '123/4 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110');
  });

  it('writes the CSV in the full fixed column order, tax columns included', () => {
    const [header] = buildAccountantIndexCsv([buildAccountantIndexRow(nonVatExpense)]).split('\n');

    assert.equal(header, ACCOUNTANT_INDEX_COLUMNS.join(','));
    assert.ok(ACCOUNTANT_INDEX_COLUMNS.includes('vat_amount'));
  });

  it('uses the sent month and a blank document date when the date was not read', () => {
    for (const summary of [{ dateStatus: 'unverified' }, { missingFields: ['expenseDate'] }]) {
      const row = buildAccountantIndexRow({ ...nonVatExpense, expenseDate: '2026-09-30', uploadedAt: '2026-09-30T17:30:00Z', aiVerificationSummaryJson: summary });
      assert.equal(row.accounting_period, '2026-10');
      assert.equal(row.document_date, '');
    }
    const dated = buildAccountantIndexRow({ ...nonVatExpense, expenseDate: '2026-09-30', uploadedAt: '2026-10-02T03:00:00Z' });
    assert.equal(dated.accounting_period, '2026-09');
  });

  it('exports an unusual document in its printed month while retaining its review warning', () => {
    for (const date of ['2024-03-18', '2028-03-18']) {
      const row = buildAccountantIndexRow({ ...nonVatExpense, status: 'NEEDS_REVIEW', expenseDate: date,
        uploadedAt: '2026-10-28T17:30:00Z', aiVerificationSummaryJson: { dateStatus: 'implausible', missingFields: ['expenseDate'] } });
      assert.equal(row.accounting_period, date.slice(0, 7));
      assert.equal(row.document_date, date);
      assert.equal(row.document_date_status, 'implausible');
      assert.equal(row.expense_status, 'NEEDS_REVIEW');
    }
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

it('shared XLSX text cells remove invalid XML controls and flatten lines, and reject non-finite amounts and invalid sheet names', async () => {
  const { buildXlsx } = await import('../../../../common/export/xlsx.logic');
  const file = buildXlsx([['=1\u0001\t\r\nx', 12.34]], 'รายงาน');
  let xml = '';
  for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
    const size = file.readUInt32LE(offset + 18), nameLength = file.readUInt16LE(offset + 26), extraLength = file.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    if (file.subarray(offset + 30, offset + 30 + nameLength).toString() === 'xl/worksheets/sheet1.xml') xml = file.subarray(start, start + size).toString();
    offset = start + size;
  }
  assert.ok(xml);
  assert.ok(!xml.includes('\u0001')); assert.ok(xml.includes('=1   x')); assert.ok(xml.includes('<v>12.34</v>'));
  assert.throws(() => buildXlsx([[NaN]], 'รายงาน')); assert.throws(() => buildXlsx([[1]], 'invalid/name'));
});


it('labels the neutral no-receipt document in the sheet while preserving machine document types', () => {
  for (const receiptProblem of ['NOT_AVAILABLE', 'LOST']) {
    const row = buildAccountantIndexRow({ ...nonVatExpense, sourceDocumentType: 'EXPENSE_NOTE_TEXT',
      aiVerificationSummaryJson: { documentReview: { assessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem, reason: 'ไม่มีใบเสร็จ', attachmentIds: [] } } } });
    assert.equal(row.source_document_type, 'EXPENSE_NOTE_TEXT');
    assert.equal(row.sourceDocumentTypeLabel, 'ไม่มีใบเสร็จ');
    assert.match(buildAccountantIndexCsv([row]), /EXPENSE_NOTE_TEXT/);
    assert.ok(buildAccountantWorkbook({ rows: [row], payments: [], withholding: [], visible: {}, about: {} }).length > 0);
  }
  assert.equal(buildAccountantIndexRow({ ...nonVatExpense, sourceDocumentType: 'EXPENSE_NOTE_TEXT' }).sourceDocumentTypeLabel, undefined);
});

import { inflateRawSync } from 'node:zlib';
function exportedSheet(file: Buffer, part = 'xl/worksheets/sheet1.xml'): string {
  for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
    const size = file.readUInt32LE(offset + 18), nameLength = file.readUInt16LE(offset + 26), extraLength = file.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    if (file.subarray(offset + 30, offset + 30 + nameLength).toString() === part) {
      const bytes = file.subarray(start, start + size); return (file.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes).toString();
    }
    offset = start + size;
  }
  throw new Error('Missing worksheet');
}
it('appends the input VAT decision without moving any accounting import column; CSV keeps codes and Excel uses screen words', () => {
  const original = ["company_name", "company_tax_id", "branch_code", "accounting_period", "uploaded_at", "document_date", "expense_number", "expense_status", "source_channel", "source_document_type", "tax_evidence_status", "tax_evidence_reason", "posting_status", "posting_error", "journal_entry_number", "requester_name", "uploader_name", "reviewer_name", "vendor_name", "vendor_tax_id", "vendor_branch_code", "vendor_document_number", "category_name", "account_hint_key", "description", "quantity", "subtotal_amount", "discount_amount", "taxable_amount", "vat_amount", "wht_amount", "grand_total_amount", "net_payable_amount", "paid_amount", "outstanding_amount", "payment_method", "paid_at", "payment_reference", "substitute_receipt_ref", "primary_evidence_ref", "supporting_evidence_refs", "web_url", "notes", "additional_charges_amount", "document_date_status", "funding_source", "certifying_payer_name", "substitute_evidence_provenance", "vendor_address"];
  assert.deepEqual(ACCOUNTANT_INDEX_COLUMNS.slice(0, original.length), original);
  assert.deepEqual(ACCOUNTANT_INDEX_COLUMNS.slice(original.length), ['input_vat_right', 'input_vat_reason', 'input_vat_decided_by', 'input_vat_decided_at', 'voucher_numbers', 'wht_certificate_numbers', 'bundle_file_names']);
  const row = buildAccountantIndexRow({ ...nonVatExpense, inputVatClaimStatus: 'CLAIMABLE', taxEvidenceStatus: 'USABLE_FOR_TAX', taxEvidenceReasonCode: 'VALID_TAX_INVOICE_FIELDS',
    latestInputVatDecision: { reason: 'ใช้ในร้าน', decidedByName: 'ผู้ตรวจหนึ่ง', decidedAt: '2026-10-14T03:00:00.000Z' } } as any);
  assert.equal(row.input_vat_right, 'CLAIMABLE'); assert.equal(row.input_vat_reason, 'ใช้ในร้าน');
  assert.equal(row.input_vat_decided_by, 'ผู้ตรวจหนึ่ง'); assert.equal(row.input_vat_decided_at, '2026-10-14T03:00:00.000Z');
  assert.match(buildAccountantIndexCsv([row]), /CLAIMABLE,ใช้ในร้าน,ผู้ตรวจหนึ่ง,2026-10-14T03:00:00.000Z/);
  const xml = exportedSheet(buildAccountantWorkbook({ rows: [row], payments: [], withholding: [], visible: {}, about: {} }));
  for (const word of ['หลักฐานรายจ่าย', 'สิทธิภาษีซื้อ', 'ใช้ได้ตามเงื่อนไข']) assert.ok(xml.includes(word), word);
  assert.match(buildAccountantIndexCsv([row]), /VALID_TAX_INVOICE_FIELDS/);
  assert.doesNotMatch(xml, /ผู้ตรวจหนึ่ง|ข้อมูลใบกำกับภาษีครบถ้วน|เหตุผลหลักฐานรายจ่าย/);
  assert.doesNotMatch(xml, /CLAIMABLE|USABLE_FOR_TAX|VALID_TAX_INVOICE_FIELDS/);
});
it('exports waiting and fixed rights, and describes an old confirmed answer without inventing a reviewer', () => {
  for (const status of ['NEEDS_REVIEW', 'NON_CLAIMABLE'] as const) {
    const row = buildAccountantIndexRow({ ...nonVatExpense, inputVatClaimStatus: status } as any);
    assert.equal(row.input_vat_right, status); assert.equal(row.input_vat_decided_by, ''); assert.equal(row.input_vat_reason, '');
  }
  const legacy = buildAccountantIndexRow({ ...nonVatExpense, sourceDocumentType: 'TAX_INVOICE', inputVatClaimStatus: 'NON_CLAIMABLE', inputVatRecordedBeforeReview: true } as any);
  assert.equal(legacy.input_vat_right, 'NON_CLAIMABLE');
  assert.match(exportedSheet(buildAccountantWorkbook({ rows: [legacy], payments: [], withholding: [], visible: {}, about: {} })), /ไม่ได้ใช้ภาษีซื้อ \(บันทึกก่อนมีการตรวจสิทธิ\)/);
});

it('formats every accountant money cell as two-decimal numeric money across 3000 seeded rows', () => {
  let seed = 713;
  const rows = Array.from({ length: 3000 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const amount = (seed / 10000).toFixed(4);
    const row = buildAccountantIndexRow(nonVatExpense);
    for (const key of ACCOUNTANT_INDEX_COLUMNS) if (key.endsWith('_amount')) row[key] = amount;
    row.quantity = '1.005';
    return row;
  });
  {
    const columns = ACCOUNTANT_WORKBOOK_COLUMNS.filter(column => column !== 'primary_file');
    const workbook = buildAccountantWorkbook({ rows, payments: [], withholding: [], visible: {}, about: {} });
    const xml = exportedSheet(workbook);
    const styles = exportedSheet(workbook, 'xl/styles.xml');
    assert.match(styles, /numFmt numFmtId="164" formatCode="#,##0.00(?:;[^"]*)?"/);
    const cellStyles = styles.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/)![1]!.match(/<xf [^>]*>/g)!;
    assert.match(cellStyles[3]!, /numFmtId="164"/);
    const cells = [...xml.matchAll(/<c r="([A-Z]+)(\d+)" s="(\d+)"[^>]*><v>([^<]+)<\/v><\/c>/g)];
    const columnName = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : columnName(Math.floor(index / 26) - 1) + String.fromCharCode(65 + index % 26);
    let moneyCells = 0;
    for (const cell of cells) {
      const key = columns.find((_, i) => columnName(i) === cell[1])!;
      if (!key.endsWith('_amount')) { assert.equal(cell[3], '0'); continue; }
      assert.equal(cell[3], '3', `${key} needs the shared #,##0.00 money style`);
      assert.equal(Number(cell[4]), Number(rows[Number(cell[2]) - 2]![key as keyof (typeof rows)[number]]));
      moneyCells++;
    }
    assert.equal(moneyCells, rows.length * columns.filter(key => key.endsWith('_amount')).length);
  }
});
