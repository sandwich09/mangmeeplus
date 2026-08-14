import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTaxEvidence, validateCaptureHints, isExpenseExtractionEligible, toSourceDocumentType } from './expense-document.logic';
import { buildAccountantIndexRow, buildAccountantIndexCsv, buildAccountantIndexXlsx, buildManifestEntry, accountingPeriod } from './expense-export.logic';
import { ACCOUNTANT_INDEX_COLUMNS, ACCOUNTANT_INDEX_SUMMARY_COLUMNS, type ExpenseAttachmentRef } from '@watchdog-bms/contracts';

describe('deriveTaxEvidence', () => {
  it('maps complete tax invoice to USABLE_FOR_TAX', () => {
    const result = deriveTaxEvidence({ sourceDocumentType: 'TAX_INVOICE', grandTotalAmount: '107', vendorTaxId: '0105558096348', vendorName: 'ผู้ขาย', documentNumber: 'INV-1' });
    assert.deepEqual(result, { taxEvidenceStatus: 'USABLE_FOR_TAX', taxEvidenceReasonCode: 'VALID_TAX_INVOICE_FIELDS' });
  });

  it('flags tax invoice missing vendor tax id as NEEDS_REVIEW', () => {
    const result = deriveTaxEvidence({ sourceDocumentType: 'TAX_INVOICE', grandTotalAmount: '107', vendorName: 'ผู้ขาย', documentNumber: 'INV-1' });
    assert.deepEqual(result, { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'MISSING_VENDOR_TAX_ID' });
  });

  // Spec §19h — the reported Starbucks slip: `TAX INVOICE(ABB)`, seller tax id and document number
  // both present, so the full-form branch would have called it USABLE_FOR_TAX. Revenue Code s.82/5
  // bars its input VAT regardless of how complete it is.
  it('maps a complete abbreviated tax invoice to SUPPORTING_ONLY, never USABLE_FOR_TAX', () => {
    const result = deriveTaxEvidence({
      sourceDocumentType: 'ABBREVIATED_TAX_INVOICE',
      grandTotalAmount: '180', vendorTaxId: '0105541008888', vendorName: 'Starbucks Coffee', documentNumber: '260/05-02-17420',
    });
    assert.deepEqual(result, {
      taxEvidenceStatus: 'SUPPORTING_ONLY',
      taxEvidenceReasonCode: 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE',
    });
  });

  it('still needs review for an abbreviated invoice with no readable amount', () => {
    const result = deriveTaxEvidence({ sourceDocumentType: 'ABBREVIATED_TAX_INVOICE', vendorName: 'Starbucks Coffee' });
    assert.deepEqual(result, { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'MISSING_MONETARY_AMOUNT' });
  });

  it('keeps the abbreviated invoice a known source document type', () => {
    assert.equal(toSourceDocumentType('ABBREVIATED_TAX_INVOICE'), 'ABBREVIATED_TAX_INVOICE');
  });

  it('maps transfer slip to SUPPORTING_ONLY payment evidence', () => {
    const result = deriveTaxEvidence({ sourceDocumentType: 'TRANSFER_SLIP', vendorName: 'ผู้รับเงิน' });
    assert.deepEqual(result, { taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'PAYMENT_EVIDENCE_ONLY' });
  });

  it('maps marketplace screenshot to SUPPORTING_ONLY', () => {
    const result = deriveTaxEvidence({ sourceDocumentType: 'MARKETPLACE_ORDER_SCREENSHOT' });
    assert.equal(result.taxEvidenceStatus, 'SUPPORTING_ONLY');
    assert.equal(result.taxEvidenceReasonCode, 'MARKETPLACE_SCREENSHOT_ONLY');
  });

  it('maps handwritten bill and text note to substitute-receipt policy', () => {
    for (const type of ['HANDWRITTEN_CASH_BILL', 'EXPENSE_NOTE_TEXT'] as const) {
      const result = deriveTaxEvidence({ sourceDocumentType: type });
      assert.equal(result.taxEvidenceStatus, 'SUPPORTING_ONLY');
      assert.equal(result.taxEvidenceReasonCode, 'HANDWRITTEN_OR_TEXT_NEEDS_SUBSTITUTE');
    }
  });

  it('keeps low-confidence and unknown types in NEEDS_REVIEW', () => {
    assert.equal(deriveTaxEvidence({ sourceDocumentType: 'RECEIPT', vendorName: 'x', documentNumber: 'r1', lowConfidence: true }).taxEvidenceStatus, 'NEEDS_REVIEW');
    assert.equal(deriveTaxEvidence({ sourceDocumentType: 'NEEDS_REVIEW' }).taxEvidenceStatus, 'NEEDS_REVIEW');
  });

  it('receipt without document number is SUPPORTING_ONLY, with number USABLE_FOR_TAX', () => {
    assert.equal(deriveTaxEvidence({ sourceDocumentType: 'RECEIPT', grandTotalAmount: '50', vendorName: 'ร้านกาแฟ' }).taxEvidenceStatus, 'SUPPORTING_ONLY');
    assert.equal(deriveTaxEvidence({ sourceDocumentType: 'RECEIPT', grandTotalAmount: '50', vendorName: 'ร้านกาแฟ', documentNumber: 'R-9' }).taxEvidenceStatus, 'USABLE_FOR_TAX');
  });

  it('never marks a receipt, tax invoice, or supplier bill usable without a positive total', () => {
    for (const sourceDocumentType of ['RECEIPT', 'TAX_INVOICE', 'SUPPLIER_BILL'] as const) {
      const result = deriveTaxEvidence({
        sourceDocumentType,
        grandTotalAmount: '0',
        vendorName: 'ผู้ขาย',
        vendorTaxId: '0105558096348',
        documentNumber: 'DOC-1',
      });
      assert.deepEqual(result, { taxEvidenceStatus: 'NEEDS_REVIEW', taxEvidenceReasonCode: 'MISSING_MONETARY_AMOUNT' });
    }
  });
});

describe('isExpenseExtractionEligible', () => {
  const classification = (documentKind: string, overrides: Record<string, unknown> = {}) => ({
    contentKind: 'DOCUMENT',
    documentFamily: 'EXPENSE_EVIDENCE',
    documentKind,
    businessDirection: 'PURCHASE_EXPENSE',
    transactionState: 'PAID',
    evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.95,
    evidenceSignals: [],
    amountSignals: ['123.45'],
    settlementSignals: ['PAID'],
    missingRequiredSignals: [],
    contradictionSignals: [],
    requiresClarification: false,
    ...overrides,
  } as any);

  it('accepts supported expense evidence only with a positive total', () => {
    // §19h: an abbreviated invoice cannot be credited, but it is still a real paid expense and must
    // reach a draft — barring it from extraction would lose the spend, not just the tax credit.
    for (const kind of ['RECEIPT', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE', 'SUPPLIER_INVOICE_OR_BILL', 'TRANSFER_SLIP', 'MARKETPLACE_ORDER', 'HANDWRITTEN_CASH_BILL']) {
      assert.equal(isExpenseExtractionEligible(classification(kind), '123.45'), true, kind);
      assert.equal(isExpenseExtractionEligible(classification(kind), '0'), false, `${kind} without total`);
    }
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT'), '100 บาท'), false);
  });

  it('rejects cross-domain, unreadable, multi-document, and clarification results', () => {
    for (const kind of ['QUOTATION', 'ORDER_OR_CHECK_BILL', 'APPOINTMENT_CARD', 'BOOKING_CONFIRMATION', 'NON_FINANCIAL_IMAGE']) {
      assert.equal(isExpenseExtractionEligible(classification(kind), '100'), false, kind);
    }
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { contentKind: 'UNREADABLE' }), '100'), false);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { contentKind: 'MULTI_DOCUMENT' }), '100'), false);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { requiresClarification: true }), '100'), false);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { transactionState: 'DUE' }), '123.45'), false);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { settlementSignals: [] }), '123.45'), false);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { amountSignals: ['999.00'] }), '123.45'), false);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { businessDirection: 'SALES_RECEIVABLE' }), '123.45'), false);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { businessDirection: 'SALES_RECEIVABLE' }), '123.45', true), false);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { businessDirection: 'UNKNOWN' }), '123.45'), false);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { businessDirection: 'UNKNOWN' }), '123.45', true), true);
    assert.equal(isExpenseExtractionEligible(classification('RECEIPT', { documentFamily: 'COMMERCIAL_DOCUMENT' }), '123.45'), false);
    assert.equal(isExpenseExtractionEligible(classification('TRANSFER_SLIP', { documentFamily: 'PAYMENT_EVIDENCE' }), '123.45'), true);
    assert.equal(isExpenseExtractionEligible(undefined, '100'), false);
  });
});

describe('toSourceDocumentType', () => {
  it('accepts known enum members and falls back to NEEDS_REVIEW', () => {
    assert.equal(toSourceDocumentType('TAX_INVOICE'), 'TAX_INVOICE');
    assert.equal(toSourceDocumentType('made-up-type'), 'NEEDS_REVIEW');
    assert.equal(toSourceDocumentType(undefined), 'NEEDS_REVIEW');
  });
});

describe('validateCaptureHints', () => {
  const active = new Set(['cat-travel', 'cat-meals']);

  it('inserts valid amount, date, and active category', () => {
    const result = validateCaptureHints(
      { amount: '65', expenseDate: '2026-07-01', expenseCategoryId: 'cat-meals', description: 'ค่ากาแฟ', sourceDocumentType: 'EXPENSE_NOTE_TEXT' },
      active,
    );
    assert.equal(result.amount, '65.0000');
    assert.equal(result.expenseDate, '2026-07-01');
    assert.equal(result.expenseCategoryId, 'cat-meals');
    assert.equal(result.sourceDocumentType, 'EXPENSE_NOTE_TEXT');
    assert.deepEqual(result.warnings, []);
  });

  it('rejects negative/invalid amounts and far-future dates', () => {
    const result = validateCaptureHints({ amount: '-10', expenseDate: '2099-01-01' }, active);
    assert.equal(result.amount, null);
    assert.equal(result.expenseDate, null);
    assert.ok(result.warnings.includes('invalid_amount'));
    assert.ok(result.warnings.includes('invalid_expense_date'));
  });

  it('refuses category ids outside the active configured catalogue', () => {
    const result = validateCaptureHints({ expenseCategoryId: 'cat-invented' }, active);
    assert.equal(result.expenseCategoryId, null);
    assert.ok(result.warnings.includes('category_not_active'));
  });

  it('parses comma-formatted amounts and bounds long text', () => {
    const result = validateCaptureHints({ amount: '1,234.50', description: 'x'.repeat(500) }, active);
    assert.equal(result.amount, '1234.5000');
    assert.equal(result.description?.length, 300);
  });

  it('falls back unknown vat mode and document type to NEEDS_REVIEW', () => {
    const result = validateCaptureHints({ vatMode: 'MAYBE', sourceDocumentType: 'INVOICE?' }, active);
    assert.equal(result.vatMode, 'NEEDS_REVIEW');
    assert.equal(result.sourceDocumentType, 'NEEDS_REVIEW');
    assert.ok(result.warnings.includes('unknown_source_document_type'));
  });
});

describe('accountant export logic', () => {
  const attachment: ExpenseAttachmentRef = {
    id: 'att-12345678',
    purpose: 'expense.receipt.primary',
    originalFileName: 'receipt.jpg',
    mimeType: 'image/jpeg',
    byteSize: 1024,
    checksumSha256: 'abc',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
  };

  const source = {
    companyName: 'บริษัท ทดสอบ จำกัด',
    companyTaxId: '0105558096348',
    branchCode: null,
    expenseId: 'exp-1',
    expenseNumber: 'EXP-2026-0001',
    status: 'CONFIRMED',
    captureSource: 'LINE_UPLOAD',
    sourceDocumentType: 'TAX_INVOICE' as const,
    taxEvidenceStatus: 'USABLE_FOR_TAX' as const,
    taxEvidenceReasonCode: 'VALID_TAX_INVOICE_FIELDS',
    postingStatus: 'posted',
    postingError: null,
    journalEntryNumber: 'JV-202607-00001',
    uploadedAt: '2026-07-01T10:00:00.000Z',
    expenseDate: '2026-06-28',
    requesterName: null,
    uploaderName: 'สมชาย',
    reviewerName: 'การเงิน',
    vendorNameSnapshot: 'ผู้ขาย, จำกัด',
    vendorTaxIdSnapshot: '1234567890123',
    vendorBranchCodeSnapshot: '00000',
    vendorDocumentNumber: 'INV-9',
    categoryName: 'ค่าอาหาร',
    accountHintKey: 'expense.meals',
    description: 'ค่ากาแฟ "พิเศษ"',
    quantity: '1',
    subtotalAmount: '100.0000',
    discountAmount: '0.0000',
    taxableAmount: '93.4579',
    vatAmount: '6.5421',
    whtAmount: '0.0000',
    grandTotalAmount: '100.0000',
    netPayableAmount: '100.0000',
    paidAmount: '0.0000',
    outstandingAmount: '100.0000',
    paymentMethod: null,
    paidAt: null,
    paymentReference: null,
    substituteReceiptRef: null,
    primaryAttachmentId: 'att-12345678',
    attachments: [attachment],
    webUrl: '/companies/c1/expenses/exp-1',
    notes: null,
  };

  it('builds an index row with every spec column present', () => {
    const row = buildAccountantIndexRow(source);
    for (const col of ACCOUNTANT_INDEX_COLUMNS) {
      assert.ok(col in row, `missing column ${col}`);
    }
    assert.equal(row.accounting_period, '2026-06');
    assert.equal(row.source_channel, 'LINE');
    assert.equal(row.primary_evidence_ref, 'EXP-2026-0001-12345678');
    assert.equal(row.posting_status, 'posted');
    assert.equal(row.journal_entry_number, 'JV-202607-00001');
  });

  it('derives accounting period from uploaded date when document date missing', () => {
    assert.equal(accountingPeriod(null, '2026-07-01T10:00:00.000Z'), '2026-07');
  });

  it('escapes CSV values containing commas and quotes, exact column order', () => {
    const csv = buildAccountantIndexCsv([buildAccountantIndexRow(source)]);
    const lines = csv.split('\n');
    assert.equal(lines[0], ACCOUNTANT_INDEX_COLUMNS.join(','));
    assert.ok(lines[1]?.includes('"ผู้ขาย, จำกัด"'));
    assert.ok(lines[1]?.includes('"ค่ากาแฟ ""พิเศษ"""'));
  });

  it('neutralizes spreadsheet formulas in exported business cells', () => {
    const csv = buildAccountantIndexCsv([buildAccountantIndexRow({ ...source, vendorNameSnapshot: '=WEBSERVICE("https://evil.example")' })]);
    assert.ok(csv.includes('"\'=WEBSERVICE(""https://evil.example"")"'));
  });

  it('builds a real xlsx: Thai headers, numeric amounts, summary column set by default', () => {
    const rows = [buildAccountantIndexRow(source)];
    const summary = buildAccountantIndexXlsx(rows, 'summary');
    // Entries are stored uncompressed, so the sheet XML is readable straight from the buffer.
    const sheet = summary.toString('utf8');

    assert.equal(summary.subarray(0, 2).toString('utf8'), 'PK');
    assert.ok(sheet.includes('<t xml:space="preserve">วันที่เอกสาร</t>'));
    assert.ok(sheet.includes('<t xml:space="preserve">ยอดรวม</t>'));
    assert.ok(!sheet.includes('grand_total_amount'));
    assert.ok(sheet.includes('<v>100</v>'), 'amounts must be numeric cells');
    assert.ok(sheet.includes('ยืนยันแล้ว'), 'status code must be shown in Thai');
    assert.ok(!sheet.includes('เลขผู้เสียภาษีบริษัท'), 'summary set stays short');
    assert.equal((sheet.match(/<row r="1">.*?<\/row>/s)?.[0].match(/<c /g) ?? []).length, ACCOUNTANT_INDEX_SUMMARY_COLUMNS.length);

    const full = buildAccountantIndexXlsx(rows, 'full').toString('utf8');
    assert.ok(full.includes('เลขผู้เสียภาษีบริษัท'));
    assert.equal((full.match(/<row r="1">.*?<\/row>/s)?.[0].match(/<c /g) ?? []).length, ACCOUNTANT_INDEX_COLUMNS.length);
  });

  it('builds manifest entries without object keys and with expiring download urls', () => {
    const entry = buildManifestEntry({
      expenseId: 'exp-1',
      expenseNumber: 'EXP-2026-0001',
      attachment,
      sourceDocumentType: 'TAX_INVOICE',
      taxEvidenceStatus: 'USABLE_FOR_TAX',
      downloadUrl: '/local-storage/download/tok',
      downloadUrlExpiresAt: '2026-07-01T10:05:00.000Z',
      webUrl: '/companies/c1/expenses/exp-1',
    });
    assert.equal(entry.evidence_ref, 'EXP-2026-0001-12345678');
    assert.equal(entry.file_name, 'receipt.jpg');
    assert.equal(entry.download_url_expires_at, '2026-07-01T10:05:00.000Z');
    assert.ok(!JSON.stringify(entry).includes('objectKey'));
  });
});
