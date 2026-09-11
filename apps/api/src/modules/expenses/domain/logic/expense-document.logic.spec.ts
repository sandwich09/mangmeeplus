import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTaxEvidence, validateCaptureHints, isExpenseExtractionEligible, toSourceDocumentType, assessLineTextExpenseCapture } from './expense-document.logic';
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

  it('keeps a readable handwritten receipt as supporting evidence without requiring a substitute', () => {
    assert.deepEqual(deriveTaxEvidence({ sourceDocumentType: 'HANDWRITTEN_CASH_BILL', vendorName: 'ตลาด', grandTotalAmount: '3500' }),
      { taxEvidenceStatus: 'SUPPORTING_ONLY', taxEvidenceReasonCode: 'HANDWRITTEN_RECEIPT_REVIEW' });
    assert.equal(deriveTaxEvidence({ sourceDocumentType: 'HANDWRITTEN_CASH_BILL' }).taxEvidenceStatus, 'NEEDS_REVIEW');
    assert.equal(deriveTaxEvidence({ sourceDocumentType: 'EXPENSE_NOTE_TEXT' }).taxEvidenceStatus, 'SUPPORTING_ONLY');
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

describe('assessLineTextExpenseCapture', () => {
  const categories = new Map([['cat-travel', 'ค่าเดินทาง'], ['cat-meals', 'ค่าอาหาร']]);
  const assess = (
    messageText: string,
    hints: Parameters<typeof assessLineTextExpenseCapture>[1],
    groundingTexts: string[] = [],
    semanticBusinessExpenseConfirmed = false,
  ) => assessLineTextExpenseCapture(messageText, hints, categories, groundingTexts, { semanticBusinessExpenseConfirmed });

  // The UAT message as an ordinary company-spend note. It must NOT start with `เบิก…`: a claim to be
  // paid back is REIMBURSEMENT_REQUEST_START and leaves this route entirely, so it can never reach the
  // BUSINESS_EXPENSE + COMPANY_PAID guard these cases exercise. The purpose the model understood lives
  // in businessPurpose, not description.
  const UAT_MESSAGE = 'ค่ารถวินมอไซต์ 60 บาท ไปพบลูกค้า';
  const UAT_HINTS = { amount: '60', businessPurpose: 'ไปพบลูกค้า', expenseCategoryId: 'cat-travel' };

  it('accepts a grounded businessPurpose only behind the semantic guard', () => {
    const guarded = assess(UAT_MESSAGE, UAT_HINTS, [], true);
    assert.equal(guarded.eligible, true);
    assert.deepEqual(guarded.acceptedFields, ['amount', 'purpose']);
    assert.deepEqual(guarded.missingFields, []);
  });

  it('rejects the same grounded businessPurpose when the route was not verified as company-paid business spend', () => {
    const unguarded = assess(UAT_MESSAGE, UAT_HINTS);
    assert.equal(unguarded.eligible, false);
    // Default-off is the LEGACY gate, which has no field vocabulary at all: it reports no accepted,
    // missing or conflicting field, so the dispatcher asks the exact previous generic question.
    assert.deepEqual(unguarded.acceptedFields, []);
    assert.deepEqual(unguarded.missingFields, []);
    assert.deepEqual(unguarded.conflictingFields, []);
  });

  it('never lets an active category name stand in for a purpose', () => {
    // The category name is present verbatim in the text and the id is active; §8.1 still says no.
    const result = assess('ค่าเดินทาง 200 บาท', { amount: '200', expenseCategoryId: 'cat-travel' }, [], true);
    assert.equal(result.eligible, false);
    assert.deepEqual(result.missingFields, ['description', 'purpose']);
  });

  it('DEFAULT-OFF keeps the legacy category-as-purpose capture the same input is refused for when on', () => {
    // The one behaviour §8.1 removes. Off, the active category name found verbatim in the text IS the
    // purpose and the draft is created exactly as it always was — the new rule ships with its own flag.
    const legacy = assess('ค่าเดินทาง 200 บาท', { amount: '200', expenseCategoryId: 'cat-travel' });
    assert.equal(legacy.eligible, true);
    assert.deepEqual(legacy.acceptedFields, []);
  });

  it('DEFAULT-OFF still grounds an amount in the resolved clarification, and two amounts are not a conflict', () => {
    // Legacy searched message + grounding as ONE text and never compared amount counts. Both properties
    // are load-bearing for turns already in flight, so neither may change while the flag is off.
    const carried = assess('ไปพบลูกค้า', { amount: '60', description: 'ไปพบลูกค้า' }, ['ค่ารถวิน 60 บาท']);
    assert.equal(carried.eligible, true);
    const twoAmounts = assess('ค่าเดินทาง 200 บาท', { amount: '200', description: 'ค่าเดินทาง' }, ['ค่ารถวิน 60 บาท']);
    assert.equal(twoAmounts.eligible, true);
    assert.deepEqual(twoAmounts.conflictingFields, []);
  });

  it('asks for the amount instead of writing one carried only by an earlier clarification', () => {
    // §8.1 + the Redis-authority rule: the purpose typed THIS turn is accepted, but the `60` that exists
    // only in a prior clarification is not write authority while no durable neutral state backs it.
    const result = assess('ไปพบลูกค้า', { amount: '60', businessPurpose: 'ไปพบลูกค้า' }, ['ค่ารถวิน 60 บาท'], true);
    assert.equal(result.eligible, false);
    assert.deepEqual(result.acceptedFields, ['purpose'], 'the purpose is not asked for again');
    assert.deepEqual(result.missingFields, ['amount']);
    assert.deepEqual(result.conflictingFields, []);
  });

  it('reports a conflict — and creates nothing — when a follow-up amount does not say it is a correction', () => {
    const result = assess('ค่าเดินทาง 200 บาท', { amount: '200', description: 'ค่าเดินทาง' }, ['ค่ารถวิน 60 บาท'], true);
    assert.equal(result.eligible, false);
    assert.deepEqual(result.conflictingFields, ['amount']);
    assert.deepEqual(result.missingFields, [], 'the purpose is grounded; only the amount is unresolved');
  });

  it('lets the exact correction grammar clear the amount conflict, and still writes nothing without a purpose in it', () => {
    const result = assess('แก้ยอดเป็น 200 บาท', { amount: '200', description: 'ค่ารถวิน' }, ['ค่ารถวิน 60 บาท'], true);
    assert.deepEqual(result.conflictingFields, [], 'the correction resolves which amount is meant');
    assert.deepEqual(result.acceptedFields, ['amount']);
    // The description it would be written under exists ONLY in the earlier clarification, so the
    // correction is zero-write in this release too — it asks rather than reviving Redis text as authority.
    assert.equal(result.eligible, false);
    assert.deepEqual(result.missingFields, ['description', 'purpose']);
  });

  // The two shapes a user is most likely to type right after we offer the grammar. Neither orders the
  // change, so both amounts must stay on the table.
  it('treats a question about the correction grammar — and a refusal — as no correction at all', () => {
    for (const text of ['ถ้าแก้ยอดเป็น 200 บาทได้ไหม', 'ไม่แก้ยอดเป็น 200 บาท']) {
      const result = assess(text, { amount: '200', description: 'ค่ารถวิน' }, ['ค่ารถวิน 60 บาท'], true);
      assert.equal(result.eligible, false, text);
      assert.deepEqual(result.conflictingFields, ['amount'], text);
    }
  });

  // Judged over the joined text, `บาท` on the new 200 would have filtered the bare 60 out of the
  // candidate set — one amount left, no conflict, draft created silently at the wrong figure.
  it('still conflicts when only the newer amount carries a currency word', () => {
    const result = assess('ค่าเดินทาง 200 บาท', { amount: '200', description: 'ค่าเดินทาง' }, ['ค่ารถวิน 60'], true);
    assert.equal(result.eligible, false);
    assert.deepEqual(result.conflictingFields, ['amount']);
    assert.deepEqual(result.missingFields, []);
  });

  it('rejects a model amount that no deterministic candidate supports', () => {
    const result = assess('ค่ารถวิน 60 บาท ไปพบลูกค้า', { amount: '600', businessPurpose: 'ไปพบลูกค้า' }, [], true);
    assert.equal(result.eligible, false);
    assert.deepEqual(result.missingFields, ['amount']);
    assert.deepEqual(result.acceptedFields, ['purpose']);
  });

  it('ignores an incidental quantity beside the one currency-marked total', () => {
    const result = assess('ค่ากาแฟ 2 แก้ว 65 บาท', { amount: '65', description: 'ค่ากาแฟ' }, [], true);
    assert.equal(result.eligible, true);
    assert.deepEqual(result.conflictingFields, []);
  });

  it('a multi-bubble turn is ONE message, so both bubbles ground the write', () => {
    // The buffer joins bubbles with a newline before the route runs, so the amount and the purpose are
    // both "this message" — the current-turn rule bounds Redis history, not the user's own turn.
    const result = assess('ค่าเดินทาง 200 บาท\nวัตถุประสงค์ไปพบลูกค้า',
      { amount: '200', businessPurpose: 'ไปพบลูกค้า' }, [], true);
    assert.equal(result.eligible, true);
    assert.deepEqual(result.acceptedFields, ['amount', 'purpose']);
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
    additionalChargesAmount: '0',
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
