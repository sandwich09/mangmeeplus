import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RequestReceiptExtractionUseCase } from './expense-extraction.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';

const baseExpense = {
  id: 'expense-1',
  companyId: 'company-1',
  status: 'NEEDS_REVIEW',
  createdByUserId: 'uploader-1',
  primaryAttachmentId: 'attachment-1',
};

const baseAttachment = {
  id: 'attachment-1',
  bucket: 'receipts',
  objectKey: 'company-1/receipt.jpg',
  mimeType: 'image/jpeg',
  byteSize: 1234,
};

function classification(documentKind = 'RECEIPT', overrides: Record<string, unknown> = {}) {
  return {
    contentKind: 'DOCUMENT',
    documentFamily: 'EXPENSE_EVIDENCE',
    documentKind,
    businessDirection: 'PURCHASE_EXPENSE',
    transactionState: 'PAID',
    evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.95,
    evidenceSignals: ['receipt'],
    amountSignals: ['321.00'],
    settlementSignals: ['paid'],
    missingRequiredSignals: [],
    contradictionSignals: [],
    requiresClarification: false,
    ...overrides,
  };
}

function ctx(permissions: string[], userId = 'user-1'): RequestContext {
  return {
    requestId: 'request-1',
    authSubject: userId,
    userId,
    companyId: 'company-1',
    membershipId: 'membership-1',
    roles: [],
    permissions,
    scopes: {},
    authProvider: 'watchdog',
  };
}

function makeUseCase(options: {
  expense?: Record<string, unknown> | null;
  attachment?: Record<string, unknown> | null;
  gatewayResult?: Record<string, unknown>;
  applyResult?: Record<string, unknown>;
} = {}) {
  const updates: any[] = [];
  const applyCalls: any[] = [];
  const audits: any[] = [];
  const repo = {
    findById: mock.fn(async () => options.expense === undefined ? baseExpense : options.expense),
    findReceiptExtractionAttachment: mock.fn(async () => options.attachment === undefined ? baseAttachment : options.attachment),
    listCategories: mock.fn(async () => [
      { id: 'cat-meals', name: 'ค่าอาหาร', status: 'ACTIVE' },
      { id: 'cat-travel', name: 'ค่าเดินทาง', status: 'ACTIVE' },
    ]),
    updateExpense: mock.fn(async (input: any) => { updates.push(input); return input; }),
  };
  const storage = {
    getObject: mock.fn(async (_input?: unknown) => ({ bytes: Buffer.from('receipt'), mimeType: 'image/jpeg' })),
  };
  const client = {
    extract: mock.fn(async (_request?: unknown) => options.gatewayResult ?? { status: 'not_configured' }),
  };
  const applyService = {
    apply: mock.fn(async (...args: any[]) => {
      applyCalls.push(args);
      return {
        candidatesCreated: 0,
        categoryId: null,
        categoryName: null,
        categoryAutoFilled: false,
        chargeReconciliationStatus: 'SUMMARY_LINE',
        chargesApplied: 0,
        ...options.applyResult,
      };
    }),
  };
  const audit = {
    log: mock.fn(async (entry: any) => { audits.push(entry); }),
  };
  const useCase = new RequestReceiptExtractionUseCase(repo as any, storage as any, client as any, applyService as any, audit as any);
  return { useCase, repo, storage, client, updates, applyCalls, audits };
}

describe('RequestReceiptExtractionUseCase', () => {
  it('allows OCR request, review, or the uploader with receipt upload permission, but denies other staff', async () => {
    for (const allowed of [
      ctx(['expense.ocr.request']),
      ctx(['expense.review']),
      ctx(['expense.receipt.upload'], 'uploader-1'),
    ]) {
      const { useCase } = makeUseCase({ attachment: null });
      assert.deepEqual(await useCase.execute(allowed, 'expense-1'), { status: 'no_attachment' });
    }

    const { useCase } = makeUseCase({ attachment: null });
    await assert.rejects(
      () => useCase.execute(ctx(['expense.receipt.upload'], 'other-staff'), 'expense-1'),
      { name: 'ForbiddenException' },
    );
  });

  it('sends PDF receipts to the gateway (the web upload accepts PDF)', async () => {
    const { useCase, storage, client } = makeUseCase({
      attachment: { ...baseAttachment, mimeType: 'application/pdf', objectKey: 'company-1/receipt.pdf' },
    });

    await useCase.execute(ctx(['expense.ocr.request']), 'expense-1');
    assert.equal(storage.getObject.mock.callCount(), 1);
    assert.equal(client.extract.mock.callCount(), 1);
    assert.equal((client.extract.mock.calls[0]!.arguments[0] as any).attachment.mimeType, 'application/pdf');
  });

  it('returns unsupported for a PDF past the Bedrock document ceiling, and for other media types', async () => {
    for (const attachment of [
      { ...baseAttachment, mimeType: 'application/pdf', byteSize: 4_000_001 },
      { ...baseAttachment, mimeType: 'image/gif' },
    ]) {
      const { useCase, storage, client } = makeUseCase({ attachment });

      assert.deepEqual(await useCase.execute(ctx(['expense.ocr.request']), 'expense-1'), { status: 'unsupported' });
      assert.equal(storage.getObject.mock.callCount(), 0);
      assert.equal(client.extract.mock.callCount(), 0);
    }
  });

  it('returns no_attachment when the draft has no primary receipt', async () => {
    const { useCase, storage, client } = makeUseCase({ attachment: null });

    assert.deepEqual(await useCase.execute(ctx(['expense.review']), 'expense-1'), { status: 'no_attachment' });
    assert.equal(storage.getObject.mock.callCount(), 0);
    assert.equal(client.extract.mock.callCount(), 0);
  });

  it('passes through not_configured without applying or writing fields', async () => {
    const { useCase, repo, applyCalls } = makeUseCase({ gatewayResult: { status: 'not_configured' } });

    assert.deepEqual(await useCase.execute(ctx(['expense.ocr.request']), 'expense-1'), { status: 'not_configured' });
    assert.equal(applyCalls.length, 0);
    assert.equal(repo.updateExpense.mock.callCount(), 0);
  });

  it('applies successful fields, writes the review summary, and audits without raw storage data', async () => {
    const modelLineage = [{
      provider: 'bedrock',
      modelId: 'apac.amazon.nova-pro-v1:0',
      region: 'ap-southeast-1',
      purpose: 'receipt_ocr_extract',
    }];
    const fields = {
      vendorName: 'ร้านทดสอบ',
      grandTotalAmount: '321.00',
      missingFields: ['documentNumber'],
      confidence: 0.91,
    };
    const requestContext = ctx(['expense.ocr.request']);
    const { useCase, storage, client, updates, applyCalls, audits } = makeUseCase({
      gatewayResult: { status: 'ok', fields, classification: classification(), modelLineage },
    });

    const result = await useCase.execute(requestContext, 'expense-1');

    assert.deepEqual(result, { status: 'ok', fields, missingFields: ['documentNumber', 'category'], classification: classification() });
    assert.deepEqual(storage.getObject.mock.calls[0]?.arguments, [{ bucket: 'receipts', objectKey: 'company-1/receipt.jpg' }]);
    assert.equal((client.extract.mock.calls[0]?.arguments[0] as any).attachment.contentBase64, 'cmVjZWlwdA==');
    assert.deepEqual((client.extract.mock.calls[0]?.arguments[0] as any).activeCategories, [
      { id: 'cat-meals', name: 'ค่าอาหาร' },
      { id: 'cat-travel', name: 'ค่าเดินทาง' },
    ]);
    // The apply carries the version read BEFORE the model call, so a correction that lands
    // during the round trip makes the result stale instead of overwriting the user's edit.
    assert.deepEqual(applyCalls[0], [requestContext, 'expense-1', fields, {}]);
    assert.deepEqual(updates[0].aiVerificationSummaryJson, {
      status: 'OCR_EXTRACTED_NEEDS_REVIEW',
      recognizedFields: fields,
      classification: {
        contentKind: 'DOCUMENT',
        documentFamily: 'EXPENSE_EVIDENCE',
        documentKind: 'RECEIPT',
        businessDirection: 'PURCHASE_EXPENSE',
        transactionState: 'PAID',
        evidenceRoles: ['EXPENSE_SUPPORT'],
        confidence: 0.95,
        missingRequiredSignals: [],
        contradictionSignals: [],
        requiresClarification: false,
      },
      missingFields: ['documentNumber', 'category'],
      duplicateWarning: false,
      chargeReconciliation: { status: 'SUMMARY_LINE', chargesApplied: 0 },
      nextAction: 'review_in_web',
    });
    assert.deepEqual(audits.at(-1), {
      companyId: 'company-1',
      actorUserId: 'user-1',
      action: 'expense.ocr.request',
      targetType: 'expense_record',
      targetId: 'expense-1',
      requestId: 'request-1',
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: {
        attachmentId: 'attachment-1',
        status: 'ok',
        recognizedFieldCount: 4,
        documentKind: 'RECEIPT',
        modelLineage,
        reasonCodes: [],
      },
    });
    assert.equal(JSON.stringify(result).includes('contentBase64'), false);
    assert.equal(JSON.stringify(result).includes('objectKey'), false);
  });

  it('removes category from missing fields when the shared apply service accepts a suggestion', async () => {
    const fields = {
      grandTotalAmount: '321.00',
      categorySuggestion: {
        expenseCategoryId: 'cat-meals',
        confidence: 0.92,
        evidenceSignals: ['ร้านกาแฟ'],
      },
      missingFields: ['documentNumber', 'category'],
    };
    const { useCase, updates } = makeUseCase({
      gatewayResult: { status: 'ok', fields, classification: classification() },
      applyResult: {
        categoryId: 'cat-meals',
        categoryName: 'ค่าอาหาร',
        categoryAutoFilled: true,
      },
    });

    const result = await useCase.execute(ctx(['expense.ocr.request']), 'expense-1');

    assert.deepEqual(result.missingFields, ['documentNumber']);
    assert.deepEqual(updates[0].aiVerificationSummaryJson.missingFields, ['documentNumber']);
    assert.deepEqual(updates[0].aiVerificationSummaryJson.chargeReconciliation, {
      status: 'SUMMARY_LINE',
      chargesApplied: 0,
    });
  });

  // Spec §19g decision 1: the reported Starbucks slip. The draft is still created and the gross is
  // still right, but the reviewer has to be told the rate is missing rather than shown a silent zero.
  it('reports vatRate as missing when a VAT-mode document had no readable rate', async () => {
    const fields = { grandTotalAmount: '180.00', vatMode: 'VAT_INCLUDED' as const, missingFields: ['vatAmount'] };
    const { useCase, updates } = makeUseCase({ gatewayResult: { status: 'ok', fields, classification: classification('RECEIPT', { amountSignals: ['180.00'] }) } });

    const result = await useCase.execute(ctx(['expense.ocr.request']), 'expense-1');

    assert.ok(result.missingFields?.includes('vatRate'), `expected vatRate in ${JSON.stringify(result.missingFields)}`);
    assert.ok(updates[0].aiVerificationSummaryJson.missingFields.includes('vatRate'));
  });

  it('does not report vatRate as missing once the printed VAT proves the rate', async () => {
    const fields = {
      vatMode: 'VAT_INCLUDED' as const, taxableAmount: '168.22', vatAmount: '11.78', grandTotalAmount: '180.00',
      missingFields: ['documentNumber', 'vatRate'],
    };
    const { useCase } = makeUseCase({
      gatewayResult: { status: 'ok', fields, classification: classification('RECEIPT', { amountSignals: ['180.00'] }) },
    });

    const result = await useCase.execute(ctx(['expense.ocr.request']), 'expense-1');

    assert.equal(result.missingFields?.includes('vatRate'), false);
  });

  it('defaults the source document type and tax evidence from the AI classification while unclassified', async () => {
    const fields = { vendorName: 'ร้านกาแฟ', vendorTaxId: '0105551234567', documentNumber: 'INV-9', grandTotalAmount: '321.00' };
    const { useCase, updates } = makeUseCase({
      gatewayResult: { status: 'ok', fields, classification: classification('TAX_INVOICE') },
    });

    await useCase.execute(ctx(['expense.ocr.request']), 'expense-1');

    assert.equal(updates[0].sourceDocumentType, 'TAX_INVOICE');
    assert.equal(updates[0].taxEvidenceStatus, 'USABLE_FOR_TAX');
    assert.equal(updates[0].taxEvidenceReasonCode, 'VALID_TAX_INVOICE_FIELDS');
  });

  it('maps supplier bill classification to the review document type', async () => {
    const { useCase, updates } = makeUseCase({
      gatewayResult: { status: 'ok', fields: { grandTotalAmount: '321.00' }, classification: classification('SUPPLIER_INVOICE_OR_BILL') },
    });

    await useCase.execute(ctx(['expense.ocr.request']), 'expense-1');

    assert.equal(updates[0].sourceDocumentType, 'SUPPLIER_BILL');
    assert.equal(updates[0].taxEvidenceStatus, 'NEEDS_REVIEW');
  });

  it('keeps a reviewer-chosen document type on re-extraction', async () => {
    const { useCase, updates } = makeUseCase({
      expense: { ...baseExpense, sourceDocumentType: 'RECEIPT' },
      gatewayResult: { status: 'ok', fields: { grandTotalAmount: '321.00' }, classification: classification('TAX_INVOICE') },
    });

    await useCase.execute(ctx(['expense.ocr.request']), 'expense-1');

    assert.equal('sourceDocumentType' in updates[0], false);
    assert.equal('taxEvidenceStatus' in updates[0], false);
  });

  it('keeps the explicit draft and attachment but applies no fields for non-expense classifications', async () => {
    for (const documentKind of ['QUOTATION', 'ORDER_OR_CHECK_BILL', 'APPOINTMENT_CARD', 'BOOKING_CONFIRMATION', 'NON_FINANCIAL_IMAGE']) {
      const detected = classification(documentKind, {
        evidenceSignals: ['bounded display evidence'],
        missingRequiredSignals: ['MISSING_PAYMENT_EVIDENCE'],
      });
      const { useCase, repo, updates, applyCalls, audits } = makeUseCase({
        gatewayResult: { status: 'ok', fields: { vendorName: 'ไม่ควรถูกเขียน', grandTotalAmount: '500' }, classification: detected },
      });

      const fields = { vendorName: 'ไม่ควรถูกเขียน', grandTotalAmount: '500' };
      assert.deepEqual(await useCase.execute(ctx(['expense.ocr.request']), 'expense-1'), {
        status: 'not_expense_document',
        classification: detected,
        fields,
      });
      assert.equal(applyCalls.length, 0, documentKind);
      assert.equal(repo.updateExpense.mock.callCount(), 1, documentKind);
      assert.equal(updates[0].aiVerificationSummaryJson.status, 'NOT_EXPENSE_DOCUMENT');
      // Read values survive as a reviewer-facing suggestion, but never as a draft mutation:
      // the update carries no vendor/total field of its own.
      assert.deepEqual(updates[0].aiVerificationSummaryJson.suggestedFields, fields, documentKind);
      assert.equal('vendorNameSnapshot' in updates[0], false, documentKind);
      assert.equal('grandTotalAmount' in updates[0], false, documentKind);
      assert.equal(updates[0].aiVerificationSummaryJson.classification.documentKind, documentKind);
      assert.equal('evidenceSignals' in updates[0].aiVerificationSummaryJson.classification, false);
      assert.deepEqual(audits.at(-1).metadataJson.reasonCodes, ['MISSING_PAYMENT_EVIDENCE']);
    }
  });

  it('does not apply fields when classification is missing or the total is not positive', async () => {
    const missingClassification = makeUseCase({ gatewayResult: { status: 'ok', fields: { grandTotalAmount: '100' } } });
    assert.deepEqual(await missingClassification.useCase.execute(ctx(['expense.ocr.request']), 'expense-1'), { status: 'failed' });
    assert.equal(missingClassification.applyCalls.length, 0);

    const missingTotal = makeUseCase({
      gatewayResult: { status: 'ok', fields: { vendorName: 'ร้านค้า', grandTotalAmount: '0' }, classification: classification() },
    });
    assert.equal((await missingTotal.useCase.execute(ctx(['expense.ocr.request']), 'expense-1')).status, 'not_expense_document');
    assert.equal(missingTotal.applyCalls.length, 0);
  });

  it('rejects extraction after the expense is confirmed', async () => {
    const { useCase, storage, client } = makeUseCase({
      expense: { ...baseExpense, status: 'CONFIRMED' },
    });

    await assert.rejects(
      () => useCase.execute(ctx(['expense.ocr.request']), 'expense-1'),
      { name: 'ConflictException' },
    );
    assert.equal(storage.getObject.mock.callCount(), 0);
    assert.equal(client.extract.mock.callCount(), 0);
  });
});
