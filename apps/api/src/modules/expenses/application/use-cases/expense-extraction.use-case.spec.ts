import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RequestReceiptExtractionUseCase } from './expense-extraction.use-case';
import { GetExpenseUseCase } from './expense-draft.use-case';
import { ReceiptOcrClient } from '../../infrastructure/receipt-ocr.client';
import type { RequestContext } from '@watchdog-bms/contracts';
import { __resetCompanyAiBudgetCache } from '../../../line-ai/application/company-ai-usage-meter';

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

/** The capture repository the PDF lane writes its job row through. */
function makeCaptureStub() {
  const jobs: any[] = [];
  return {
    jobs,
    client: {},
    findLiveJobForAttachment: mock.fn(async (_db: unknown, input: any) => jobs.find((job) =>
      job.expenseId === input.expenseId && job.attachmentId === input.attachmentId
      && job.attachmentChecksum === input.attachmentChecksum) ?? null),
    createReadJob: mock.fn(async (_db: unknown, input: any) => {
      const job = { id: `job-${jobs.length + 1}`, status: 'QUEUED', ...input };
      jobs.push(job);
      return job;
    }),
  };
}

function makeRunnerStub() {
  const kicked: string[] = [];
  return { kicked, kick: (jobId: string) => { kicked.push(jobId); } };
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
  /** P10-L §15.1: what `receiptQuotaSnapshot` reads back when naming the numbers in a 409. */
  planTerm?: { tierKey: string; monthlySlipLimit: number; warmupUntil?: Date | null; warmupSlipLimit?: number | null } | null;
  used?: number;
  free?: boolean;
  related?: boolean;
} = {}) {
  const updates: any[] = [];
  const applyCalls: any[] = [];
  const audits: any[] = [];
  const repo = {
    findById: mock.fn(async () => options.expense === undefined ? baseExpense : options.expense),
    findByIdWithRelations: mock.fn(async (companyId: string, expenseId: string) => {
      const expense = options.expense === undefined ? baseExpense : options.expense;
      return expense?.companyId === companyId && expense.id === expenseId ? expense : null;
    }),
    isUserRelatedToExpense: mock.fn(async () => options.related ?? false),
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
        committedUpdatedAt: new Date('2026-09-15T00:00:00.001Z'),
        candidatesCreated: 0,
        categoryId: null,
        categoryName: null,
        categoryAutoFilled: false,
        chargeReconciliationStatus: 'SUMMARY_LINE',
        chargesApplied: 0,
        // Spec §5.1/§5.2: the real service always answers both, so the fake must too — a fake that
        // omits them lets the caller read `undefined` where production reads a decision.
        reviewReasons: [],
        dateVerified: true,
        dateAssumed: false,
        dateStatus: 'verified',
        ...options.applyResult,
      };
    }),
  };
  const audit = {
    log: mock.fn(async (entry: any) => { audits.push(entry); }),
  };
  const prisma = {
    client: {
      company: { findUnique: async () => null },
      billingReceiptGrant: { findMany: async () => [] },
      companyOcrUsageEvent: { count: async () => options.used ?? 0 },
      companyPlanTerm: {
        findUnique: async () => options.planTerm
          ? { warmupUntil: null, warmupSlipLimit: null, ...options.planTerm }
          : null,
      },
    },
  } as any;
  if (options.free) {
    Object.assign(prisma.client, {
      company: { findUnique: async () => ({ status: 'ACTIVE', planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0) } }) },
      billingAccount: { findMany: async () => [] },
      billingInvoice: { findFirst: async () => null },
      billingReceiptGrant: { findFirst: async () => null },
      packageChangeRequest: { findFirst: async () => null },
      salesAttribution: { findUnique: async () => null },
    });
    Object.assign(repo, { commercialAccessDb: prisma.client });
  }
  const capture = makeCaptureStub();
  const runner = makeRunnerStub();
  const useCase = new RequestReceiptExtractionUseCase(repo as any, storage as any, client as any, applyService as any, audit as any, prisma, capture as any, runner as any, new GetExpenseUseCase(repo as any));
  return { useCase, repo, storage, client, applyService, audit, updates, applyCalls, audits, capture, runner };
}

describe('RequestReceiptExtractionUseCase', () => {
  it('allows readable OCR requests, review, or creator upload access, and hides inaccessible records', async () => {
    for (const allowed of [
      ctx(['expense.read', 'expense.ocr.request']),
      ctx(['expense.review']),
      ctx(['expense.receipt.upload'], 'uploader-1'),
    ]) {
      const { useCase } = makeUseCase({ attachment: null });
      assert.deepEqual(await useCase.execute(allowed, 'expense-1'), { status: 'no_attachment' });
    }

    const { useCase } = makeUseCase({ attachment: null });
    await assert.rejects(
      () => useCase.execute(ctx(['expense.receipt.upload'], 'other-staff'), 'expense-1'),
      { name: 'NotFoundException' },
    );
  });

  // Appendix §3/§4.1: a PDF is no longer one synchronous provider call. The request queues a
  // durable read job and answers immediately, and the 4,000,000-byte gate is gone — a 9 MB scan
  // is exactly the document the customer was promised would be read (spec §16.7).
  it('queues a capture read job for a PDF primary instead of calling the gateway', async () => {
    const { useCase, storage, client, capture, runner } = makeUseCase({
      attachment: { ...baseAttachment, mimeType: 'application/pdf', objectKey: 'company-1/receipt.pdf', byteSize: 9_900_000, checksumSha256: 'sha-pdf' },
    });

    const result = await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');
    assert.equal(result.status, 'ok');
    assert.ok(result.readJobId, 'the review page needs the job id to poll');
    assert.equal(result.readStatus, 'QUEUED');
    assert.equal(storage.getObject.mock.callCount(), 0, 'the request must not read 10 MB of bytes');
    assert.equal(client.extract.mock.callCount(), 0, 'no synchronous provider call');
    assert.equal(capture.jobs.length, 1);
    assert.equal(capture.jobs[0].ownerType, 'EXPENSE');
    assert.equal(capture.jobs[0].attachmentChecksum, 'sha-pdf');
    assert.deepEqual(runner.kicked, [result.readJobId]);
  });

  /**
   * A01 / IG13 (W08). The capture wave routed PDFs to a durable job. An IMAGE — the shape every
   * existing receipt in production has — must stay on the synchronous path it has always used:
   * one provider call, applied in the same request, and no capture row of any kind.
   */
  it('leaves the image lane on the synchronous path, with no capture job (A01)', async () => {
    const { useCase, storage, client, capture, runner, applyCalls } = makeUseCase({
      gatewayResult: { status: 'ok', fields: { vendorName: 'ร้านทดสอบ', grandTotalAmount: '321.00', missingFields: [], confidence: 0.9 }, classification: classification() },
    });

    const result = await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');

    assert.equal(result.status, 'ok');
    assert.equal(result.readJobId, undefined, 'nothing to poll: the answer is in this response');
    assert.equal(storage.getObject.mock.callCount(), 1, 'the bytes are read here, as before');
    assert.equal(client.extract.mock.callCount(), 1, 'one synchronous provider call, as before');
    assert.equal(applyCalls.length, 1, 'and it is applied to the draft in the same request');
    assert.deepEqual(capture.jobs, [], 'no read job');
    assert.deepEqual(runner.kicked, [], 'and the capture runner is never started');
  });

  it('reuses the live job for the same PDF instead of buying a second OCR read', async () => {
    const { useCase, capture, runner } = makeUseCase({
      attachment: { ...baseAttachment, mimeType: 'application/pdf', checksumSha256: 'sha-pdf' },
    });
    const first = await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');
    const second = await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');
    assert.equal(second.readJobId, first.readJobId);
    assert.equal(capture.jobs.length, 1, 'one file, one job, one admitted read');
    assert.equal(runner.kicked.length, 2, 'a retry still nudges the runner');
  });

  it('returns unsupported for media types the reader does not handle', async () => {
    for (const attachment of [
      { ...baseAttachment, mimeType: 'image/gif' },
      { ...baseAttachment, mimeType: 'image/jpeg', byteSize: 10_000_001 },
    ]) {
      const { useCase, storage, client } = makeUseCase({ attachment });

      assert.deepEqual(await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'), { status: 'unsupported' });
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

    assert.deepEqual(await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'), { status: 'not_configured' });
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
    const requestContext = ctx(['expense.read', 'expense.ocr.request']);
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
    assert.deepEqual(applyCalls[0], [requestContext, 'expense-1', fields, { ocrDocumentType: 'RECEIPT' }]);
    assert.deepEqual(updates[0].aiVerificationSummaryJson, {
      status: 'OCR_EXTRACTED_NEEDS_REVIEW',
      extractionRequestId: 'request-1', extractionAttachmentId: 'attachment-1',
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
      // Spec §5.2: stored on every capture so the list, the review page and the export can each
      // say what the date is without re-deriving it.
      dateStatus: 'verified',
      nextAction: 'review_in_web',
    });
    assert.deepEqual(audits.find((entry) => entry.action === 'expense.ocr.request'), {
      companyId: 'company-1',
      actorUserId: 'user-1',
      action: 'expense.ocr.request',
      targetType: 'expense_record',
      targetId: 'expense-1',
      requestId: 'request-1',
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: {
        channel: 'web',
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

  // Owner 2026-08-29: a $200.00 USD invoice was recorded as 200 บาท. The read now reports the
  // document's currency, and it must reach the draft the review page reads — inside the extraction
  // JSON the whole field result already rides in, with the amount still copied, never converted.
  it('carries the document currency onto the draft without converting the amount', async () => {
    const fields = { vendorName: 'Acme Inc.', grandTotalAmount: '200.00', currency: 'USD', confidence: 0.9 };
    const { useCase, updates } = makeUseCase({
      gatewayResult: {
        status: 'ok',
        fields,
        classification: classification('TAX_INVOICE', { amountSignals: ['200.00'] }),
      },
    });

    const result = await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');

    assert.equal(result.status, 'ok');
    assert.equal(updates[0].aiVerificationSummaryJson.recognizedFields.currency, 'USD');
    assert.equal(updates[0].aiVerificationSummaryJson.recognizedFields.grandTotalAmount, '200.00');
    // No FX anywhere: the record keeps its own THB-based currency column untouched.
    assert.equal('currency' in updates[0], false);
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

    const result = await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');

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

    const result = await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');

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

    const result = await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');

    assert.equal(result.missingFields?.includes('vatRate'), false);
  });

  it('defaults the source document type and tax evidence from the AI classification while unclassified', async () => {
    const fields = { vendorName: 'ร้านกาแฟ', vendorTaxId: '0105551234567', documentNumber: 'INV-9', grandTotalAmount: '321.00' };
    const { useCase, updates } = makeUseCase({
      gatewayResult: { status: 'ok', fields, classification: classification('TAX_INVOICE') },
    });

    await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');

    assert.equal(updates[0].sourceDocumentType, 'TAX_INVOICE');
    assert.equal(updates[0].taxEvidenceStatus, 'USABLE_FOR_TAX');
    assert.equal(updates[0].taxEvidenceReasonCode, 'VALID_TAX_INVOICE_FIELDS');
  });

  it('maps supplier bill classification to the review document type', async () => {
    const { useCase, updates } = makeUseCase({
      gatewayResult: { status: 'ok', fields: { grandTotalAmount: '321.00' }, classification: classification('SUPPLIER_INVOICE_OR_BILL') },
    });

    await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');

    assert.equal(updates[0].sourceDocumentType, 'SUPPLIER_BILL');
    assert.equal(updates[0].taxEvidenceStatus, 'NEEDS_REVIEW');
  });

  it('keeps a reviewer-chosen document type on re-extraction', async () => {
    const { useCase, updates } = makeUseCase({
      expense: { ...baseExpense, sourceDocumentType: 'RECEIPT' },
      gatewayResult: { status: 'ok', fields: { grandTotalAmount: '321.00' }, classification: classification('TAX_INVOICE') },
    });

    await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');

    assert.equal('sourceDocumentType' in updates[0], false);
    assert.equal('taxEvidenceStatus' in updates[0], false);
  });

  it('keeps the explicit draft and attachment but applies no fields for non-expense classifications', async () => {
    for (const documentKind of ['QUOTATION', 'ORDER_OR_CHECK_BILL', 'APPOINTMENT_CARD', 'BOOKING_CONFIRMATION', 'NON_FINANCIAL_IMAGE']) {
      const detected = classification(documentKind, {
        documentFamily: documentKind === 'NON_FINANCIAL_IMAGE' ? 'NON_BUSINESS' : ['APPOINTMENT_CARD', 'BOOKING_CONFIRMATION'].includes(documentKind) ? 'SCHEDULING_DOCUMENT' : 'COMMERCIAL_DOCUMENT',
        evidenceSignals: ['bounded display evidence'],
        missingRequiredSignals: ['MISSING_PAYMENT_EVIDENCE'],
      });
      const { useCase, repo, updates, applyCalls, audits } = makeUseCase({
        gatewayResult: { status: 'ok', fields: { vendorName: 'ไม่ควรถูกเขียน', grandTotalAmount: '500' }, classification: detected },
      });

      const fields = { vendorName: 'ไม่ควรถูกเขียน', grandTotalAmount: '500' };
      assert.deepEqual(await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'), {
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
      const ocrAudit = audits.find((entry) => entry.action === 'expense.ocr.request');
      assert.deepEqual(ocrAudit.metadataJson.reasonCodes, ['MISSING_PAYMENT_EVIDENCE']);
    }
  });

  it('does not apply fields when classification is missing or the total is not positive', async () => {
    const missingClassification = makeUseCase({ gatewayResult: { status: 'ok', fields: { grandTotalAmount: '100' } } });
    assert.deepEqual(await missingClassification.useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'), { status: 'failed' });
    assert.equal(missingClassification.applyCalls.length, 0);

    const missingTotal = makeUseCase({
      gatewayResult: { status: 'ok', fields: { vendorName: 'ร้านค้า', grandTotalAmount: '0' }, classification: classification() },
    });
    assert.deepEqual(await missingTotal.useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'), { status: 'failed', errorCode: 'OCR_UNUSABLE_RESULT' });
    assert.equal(missingTotal.updates[0].aiVerificationSummaryJson.status, 'OCR_FAILED');
    assert.deepEqual(missingTotal.updates[0].aiVerificationSummaryJson.recognizedFields, { vendorName: 'ร้านค้า', grandTotalAmount: '0' });
    assert.equal(missingTotal.applyCalls.length, 0);
  });

  it('rejects extraction after the expense is confirmed', async () => {
    const { useCase, storage, client } = makeUseCase({
      expense: { ...baseExpense, status: 'CONFIRMED' },
    });

    await assert.rejects(
      () => useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'),
      { name: 'ConflictException' },
    );
    assert.equal(storage.getObject.mock.callCount(), 0);
    assert.equal(client.extract.mock.callCount(), 0);
  });

  // P10-L §15.1 / review G-01. The ceiling is decided by `admitCompanyOcr` inside the OCR client;
  // this use case only has to turn its refusal into something the upload screen can act on.
  describe('receipt quota answer', () => {
    const quotaRefused = { status: 'failed', errorCode: 'RECEIPT_QUOTA_EXCEEDED' };
    const freeTrial = { tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 15 };

    it('answers 409 receipt_quota_exceeded, carrying the numbers the banner needs', async () => {
      const { useCase } = makeUseCase({ gatewayResult: quotaRefused, planTerm: freeTrial, used: 15 });

      await assert.rejects(
        () => useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'),
        (error: any) => {
          assert.equal(error.name, 'ConflictException');
          assert.equal(error.getStatus(), 409);
          const body = error.getResponse();
          assert.equal(body.code, 'receipt_quota_exceeded');
          assert.equal(body.count, 15);
          assert.equal(body.limit, 15);
          assert.equal(body.tierKey, 'FREE_TRIAL_15');
          assert.match(body.monthKey, /^\d{4}-\d{2}$/);
          // A2-02: `tierKey` was dropped, so a trial shop was handed the paying-tier sentence.
          assert.equal(
            body.message,
            'ช่วงทดลองให้ AI อ่านรูปได้ 15 ครั้ง ตอนนี้ครบแล้วค่ะ (ใบเสร็จ 1 ใบ = 1 ครั้ง) ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย',
          );
          return true;
        },
      );
    });

    it('gives a PAYING tier its own sentence, not the trial one', async () => {
      const { useCase } = makeUseCase({
        gatewayResult: quotaRefused,
        planTerm: { tierKey: 'STARTER_249', monthlySlipLimit: 30 },
        used: 30,
      });

      await assert.rejects(
        () => useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'),
        (error: any) => {
          assert.equal(
            error.getResponse().message,
            'แพ็กเกจของคุณให้ AI อ่านรูปได้ 30 ครั้งต่อเดือน ตอนนี้ครบแล้วค่ะ (ใบเสร็จ 1 ใบ = 1 ครั้ง) ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย',
          );
          return true;
        },
      );
    });

    it('falls back to the tier preset rather than printing "0 ครั้ง" (residual-4)', async () => {
      // The term row vanished between the admission and the reply. The tier still knows its own
      // ceiling, and 15 is a true number where 0 would read as a broken product.
      const { useCase } = makeUseCase({ gatewayResult: quotaRefused, planTerm: null, used: 15 });
      const { useCase: tiered } = makeUseCase({
        gatewayResult: quotaRefused,
        planTerm: { tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 0 },
        used: 15,
      });

      await assert.rejects(
        () => tiered.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'),
        (error: any) => {
          assert.match(error.getResponse().message, /15 ครั้ง/);
          assert.doesNotMatch(error.getResponse().message, /0 ครั้ง/);
          return true;
        },
      );
      // Nothing left to read the ceiling from at all: the sentence drops the number, never prints 0.
      await assert.rejects(
        () => useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'),
        (error: any) => {
          // The fixed "ใบเสร็จ 1 ใบ = 1 ครั้ง" rate clause stays; it is the CEILING that has no number.
          assert.doesNotMatch(error.getResponse().message, /อ่านรูปได้ \d+ ครั้ง/);
          assert.match(error.getResponse().message, /ครบตามจำนวน/);
          return true;
        },
      );
    });

    it('names the full trial ceiling despite a persisted warmup-ten window', async () => {
      const { useCase } = makeUseCase({
        gatewayResult: quotaRefused,
        planTerm: { ...freeTrial, warmupUntil: new Date(Date.now() + 86_400_000), warmupSlipLimit: 10 },
        used: 15,
      });

      await assert.rejects(
        () => useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'),
        (error: any) => {
          assert.equal(error.getResponse().limit, 15);
          assert.match(error.getResponse().message, /15 ครั้ง/);
          return true;
        },
      );
    });

    it('audits the refusal rather than logging it as an extraction failure', async () => {
      const { useCase, audits } = makeUseCase({ gatewayResult: quotaRefused, planTerm: freeTrial, used: 15 });

      await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1').catch(() => undefined);

      const quotaAudit = audits.find((entry) => entry.metadataJson?.status === 'receipt_quota_exceeded');
      assert.ok(quotaAudit, 'the refusal is auditable on its own name');
      assert.equal(quotaAudit.metadataJson.errorCode, 'RECEIPT_QUOTA_EXCEEDED');
    });

    it('leaves every OTHER gateway failure on its existing "try again" path', async () => {
      const { useCase } = makeUseCase({
        gatewayResult: { status: 'failed', errorCode: 'OCR_MONTHLY_LIMIT_EXCEEDED' }, planTerm: freeTrial, used: 15,
      });

      assert.deepEqual(
        await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'),
        { status: 'failed', errorCode: 'OCR_MONTHLY_LIMIT_EXCEEDED' },
      );
    });
  });
});

describe('ReceiptOcrClient failure boundary', () => {
  const request = {
    requestId: 'ocr-fault-1', companyId: 'company-1', attachmentId: 'attachment-1',
    mimeType: 'image/jpeg', bytesBase64: Buffer.from('receipt').toString('base64'), activeCategories: [],
  } as any;

  function readyPrisma() {
    const events: any[] = [];
    let usedCount = 0;
    let eventSequence = 0;
    const providerUsage: any[] = [];
    const tx = {
      $executeRaw: async () => undefined,
      company: { findUnique: async () => null },
      companyAiConfiguration: { findUnique: async () => ({ ocrEnabled: true, ocrMonthlyLimit: 10 }) },
      companyOcrUsageEvent: {
        findUnique: async ({ where }: any) => {
          const key = where.companyId_sourceRoute_requestId;
          return events.find((event) => event.companyId === key.companyId
            && event.sourceRoute === key.sourceRoute && event.requestId === key.requestId) ?? null;
        },
        create: async ({ data }: any) => {
          const event = { id: `event-${++eventSequence}`, ...data };
          events.push(event);
          return event;
        },
        delete: async ({ where }: any) => events.splice(events.findIndex((event) => event.id === where.id), 1)[0],
      },
      companyOcrMonthlyUsage: {
        findUnique: async () => usedCount ? { usedCount } : null,
        upsert: async () => ({ usedCount: ++usedCount }),
        updateMany: async () => { usedCount -= 1; return { count: 1 }; },
      },
      // P10-L §15.1: no CompanyPlanTerm row = grandfathered unlimited, so every ops-brake
      // expectation in this block is unchanged by the commercial layer above it.
      companyPlanTerm: { findUnique: async () => null },
      auditLog: { findFirst: async () => null, create: async () => ({}) },
      aiUsageEvent: { createMany: async ({ data }: any) => { providerUsage.push(...data); return { count: data.length }; } },
      companyAiMonthlyUsage: { upsert: async ({ create }: any) => ({ costSatang: create.costSatang }) },
    };
    const prisma = {
      client: {
        company: { findUnique: async () => null },
        companyAiConfiguration: { findUnique: async () => null },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
      },
    } as any;
    return { prisma, events, providerUsage, usedCount: () => usedCount };
  }

  it('R6 free unusable OCR preserves allowance and usable persistence consumes once', async () => {
    for (const scenario of ['unusable', 'stale', 'usable'] as const) {
      const state = readyPrisma();
      const monthKey = '2026-10';
      const event: any = { id: 'free-event', companyId: 'company-1', monthKey, sourceRoute: 'receipt-ocr-web', requestId: 'request-1', quotaSource: 'FREE_MONTHLY_3', succeededAt: null };
      state.events.push(event);
      const tx: any = await state.prisma.client.$transaction(async (tx: any) => tx);
      tx.companyOcrUsageEvent.findMany = async () => state.events;
      tx.companyOcrUsageEvent.updateMany = async () => { if (!event.succeededAt) event.succeededAt = new Date(); return { count: 1 }; };
      const h = makeUseCase({ free: true, expense: { ...baseExpense, status: 'DRAFT' } });
      const extract = { extract: async (_request: any, options: any) => {
        options.onAdmitted({ ...event, eventId: event.id });
        return scenario === 'unusable' ? { status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT' }
          : { status: 'ok', classification: classification(), fields: { grandTotalAmount: '321.00' } };
      } };
      h.applyService.apply.mock.mockImplementation(async (...args: any[]): Promise<any> => {
        if (scenario === 'stale') return { staleSkipped: true };
        await args[3].onUsablePersisted(tx);
        return { committedUpdatedAt: new Date(), reviewReasons: [], dateVerified: true, dateStatus: 'verified' };
      });
      const useCase = new RequestReceiptExtractionUseCase(h.repo as any, h.storage as any, extract as any, h.applyService as any,
        h.audit as any, state.prisma, h.capture as any, h.runner as any, new GetExpenseUseCase(h.repo as any));
      for (const key of ['company', 'billingAccount', 'billingInvoice', 'billingReceiptGrant', 'packageChangeRequest', 'salesAttribution']) state.prisma.client[key] = (h.repo as any).commercialAccessDb[key];
      await useCase.execute(ctx(['expense.receipt.upload'], 'uploader-1'), 'expense-1');
      assert.equal(state.events.length, scenario === 'usable' ? 1 : 0, JSON.stringify({ scenario, audits: h.audits, calls: h.applyService.apply.mock.calls.length }));
      assert.equal(!!event.succeededAt, scenario === 'usable', scenario);
    }
  });

  for (const scenario of ['empty', 'malformed', 'missing_classification', 'missing_fields', 'unreadable', 'apply_failure', 'summary_failure', 'stale_apply', 'success', 'notification_failure', 'generic_image'] as const) {
    it(`real web client + use case admission settles ${scenario} by the persisted result`, async () => {
      __resetCompanyAiBudgetCache();
      const originalFetch = globalThis.fetch;
      const state = readyPrisma();
      const usage = [{ tag: 'receipt-ocr', modelId: 'anthropic.claude-sonnet-4-6', ok: true, inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 }];
      const result: any = { status: 'ok', classification: classification(), fields: { grandTotalAmount: '321.00', vendorName: 'Synthetic shop' }, usage };
      if (scenario === 'empty') Object.assign(result, { status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT' });
      if (scenario === 'missing_classification') delete result.classification;
      if (scenario === 'missing_fields') delete result.fields;
      if (scenario === 'unreadable') result.classification = classification('NEEDS_REVIEW', { contentKind: 'UNREADABLE' });
      if (scenario === 'generic_image') result.classification = classification('NON_FINANCIAL_IMAGE', { contentKind: 'NON_DOCUMENT_IMAGE', documentFamily: 'NON_BUSINESS', businessDirection: 'UNKNOWN' });
      globalThis.fetch = (async () => new Response(scenario === 'malformed' ? '{bad json' : JSON.stringify(result))) as any;
      try {
        const fixture = makeUseCase({ applyResult: scenario === 'stale_apply' ? { staleSkipped: true } : undefined });
        if (scenario === 'apply_failure') fixture.applyService.apply.mock.mockImplementation(async () => { throw new Error('synthetic apply failure'); });
        if (scenario === 'summary_failure') fixture.repo.updateExpense.mock.mockImplementation(async () => { throw new Error('synthetic persist failure'); });
        if (scenario === 'notification_failure') fixture.audit.log.mock.mockImplementation(async (entry: any) => { if (entry.action === 'expense.ocr.request') throw new Error('synthetic post-save audit failure'); });
        const client = new ReceiptOcrClient({ aiGatewayInternalSecret: 'synthetic', aiGatewayInternalUrl: 'http://ai.invalid', aiMonthlyBudgetSatang: 1_000_000, aiThbPerUsd: 35, isProduction: false } as any, undefined, state.prisma);
        const useCase = new RequestReceiptExtractionUseCase(fixture.repo as any, fixture.storage as any, client, fixture.applyService as any, fixture.audit as any, state.prisma, fixture.capture as any, fixture.runner as any, new GetExpenseUseCase(fixture.repo as any));
        await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1').catch(() => undefined);
        const retained = ['success', 'summary_failure', 'notification_failure', 'generic_image'].includes(scenario);
        assert.equal(state.usedCount(), retained ? 1 : 0, scenario);
        assert.equal(state.events.length, retained ? 1 : 0, 'fence matches retained commercial use');
        if (scenario !== 'malformed') {
          assert.equal(state.providerUsage.length, 1, 'provider usage survives customer compensation');
          assert.ok(state.providerUsage[0].costSatang > 0);
        }
        if (scenario === 'success') {
          assert.equal(fixture.updates[0].aiVerificationSummaryJson.extractionRequestId, 'request-1');
          assert.equal(fixture.updates[0].aiVerificationSummaryJson.extractionAttachmentId, 'attachment-1');
        }
      } finally { globalThis.fetch = originalFetch; }
    });
  }

  it('returns a reviewable failure when the OCR gateway is unreachable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => { throw new Error('synthetic timeout'); }) as any;
    try {
      const state = readyPrisma();
      const client = new ReceiptOcrClient({
        aiGatewayInternalSecret: 'internal-secret', aiGatewayInternalUrl: 'http://ai.invalid',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, undefined, state.prisma);
      assert.deepEqual(await client.extract(request), {
        status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps provider 5xx distinct and does not fabricate extracted fields', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => new Response('', { status: 503 })) as any;
    try {
      const state = readyPrisma();
      const client = new ReceiptOcrClient({
        aiGatewayInternalSecret: 'internal-secret', aiGatewayInternalUrl: 'http://ai.invalid',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, undefined, state.prisma);
      assert.deepEqual(await client.extract(request), {
        status: 'failed', errorCode: 'AI_GATEWAY_ERROR_503',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // P10-L §15.1 residual-1. `expenseExtractionRetryMode` sends a non-`OCR_` failure back under a
  // FRESH request id, which buys a second admission — so holding the first one billed a flaky
  // minute of ours as two of a 15-read trial's reads.
  it('charges ONE read when a flaky provider call is retried', async () => {
    __resetCompanyAiBudgetCache();
    const originalFetch = globalThis.fetch;
    const config = {
      aiGatewayInternalSecret: 'internal-secret', aiGatewayInternalUrl: 'http://ai.invalid',
      aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
    } as any;
    try {
      const state = readyPrisma();
      const client = new ReceiptOcrClient(config, undefined, state.prisma);

      globalThis.fetch = mock.fn(async () => new Response('', { status: 503 })) as any;
      assert.deepEqual(await client.extract(request), { status: 'failed', errorCode: 'AI_GATEWAY_ERROR_503' });
      assert.equal(state.usedCount(), 0, 'the flaky attempt handed its read back');
      assert.equal(state.events.length, 0, 'and left no fence behind for the retry to trip on');

      // The upload screen's 'new_request' retry, with a fresh id, exactly as the browser sends it.
      __resetCompanyAiBudgetCache();
      globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({ status: 'ok', fields: {} }))) as any;
      const retried = await new ReceiptOcrClient(config, undefined, state.prisma)
        .extract({ ...request, requestId: `${request.requestId}-retry` });
      assert.equal(retried.status, 'ok');
      assert.equal(state.usedCount(), 1, 'one upload, one read — not two');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('releases empty OCR output even though its code starts with OCR_', async () => {
    // `OCR_*` codes are refusals a retry cannot change, so they are NOT compensated — that is the
    // line between "our flakiness" and "the answer".
    __resetCompanyAiBudgetCache();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({
      status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT',
    }))) as any;
    try {
      const state = readyPrisma();
      const client = new ReceiptOcrClient({
        aiGatewayInternalSecret: 'internal-secret', aiGatewayInternalUrl: 'http://ai.invalid',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, undefined, state.prisma);
      assert.equal((await client.extract(request)).errorCode, 'OCR_EMPTY_OUTPUT');
      assert.equal(state.usedCount(), 0, 'an empty image result is not a usable read');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('releases a pre-provider gateway 401 but keeps quota for contradictory success JSON', async () => {
    __resetCompanyAiBudgetCache();
    const originalFetch = globalThis.fetch;
    try {
      const rejected = readyPrisma();
      globalThis.fetch = mock.fn(async () => new Response('', { status: 401 })) as any;
      const rejectedClient = new ReceiptOcrClient({
        aiGatewayInternalSecret: 'stale-secret', aiGatewayInternalUrl: 'http://ai.invalid',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, undefined, rejected.prisma);
      assert.deepEqual(await rejectedClient.extract(request), {
        status: 'failed', errorCode: 'AI_GATEWAY_ERROR_401',
      });
      assert.equal(rejected.events.length, 0);
      assert.equal(rejected.usedCount(), 0);

      const contradictory = readyPrisma();
      globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({
        status: 'ok', errorCode: 'PROVIDER_CONFIG_MISSING', fields: {},
      }))) as any;
      const contradictoryClient = new ReceiptOcrClient({
        aiGatewayInternalSecret: 'internal-secret', aiGatewayInternalUrl: 'http://ai.invalid',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, undefined, contradictory.prisma);
      assert.equal((await contradictoryClient.extract(request)).status, 'ok');
      assert.equal(contradictory.events.length, 1);
      assert.equal(contradictory.usedCount(), 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails closed before fetch when the company OCR switch is off', async () => {
    __resetCompanyAiBudgetCache();
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => { fetchCalls += 1; return new Response('{}'); }) as any;
    const tx = {
      $executeRaw: async () => undefined,
      company: { findUnique: async () => null },
      companyOcrUsageEvent: { findUnique: async () => null },
      companyAiConfiguration: { findUnique: async () => ({ ocrEnabled: false, ocrMonthlyLimit: 10 }) },
      companyOcrMonthlyUsage: { findUnique: async () => null },
      companyPlanTerm: { findUnique: async () => null },
      auditLog: { findFirst: async () => null, create: async () => ({}) },
    };
    const prisma = {
      client: {
        company: { findUnique: async () => null },
        companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang: null }) },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
      },
    } as any;
    try {
      const client = new ReceiptOcrClient({
        aiGatewayInternalSecret: 'internal-secret', aiGatewayInternalUrl: 'http://ai.invalid',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, undefined, prisma);
      assert.deepEqual(await client.extract(request), {
        status: 'failed', errorCode: 'OCR_FEATURE_DISABLED',
      });
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not count a read when the provider credential is missing', async () => {
    __resetCompanyAiBudgetCache();
    let quotaTransactions = 0;
    const prisma = {
      client: {
        company: { findUnique: async () => null },
        companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang: null }) },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        $transaction: async () => { quotaTransactions += 1; throw new Error('unexpected OCR admission'); },
      },
    } as any;
    const client = new ReceiptOcrClient({
      aiGatewayInternalSecret: undefined,
      aiMonthlyBudgetSatang: 1_000_000,
      isProduction: false,
    } as any, undefined, prisma);

    assert.deepEqual(await client.extract(request), {
      status: 'not_configured', errorCode: 'AI_GATEWAY_SECRET_MISSING',
    });
    assert.equal(quotaTransactions, 0);
  });

  it('releases the OCR event and aggregate when a PDF provider is unsupported', async () => {
    __resetCompanyAiBudgetCache();
    const state = readyPrisma();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({
      status: 'not_configured', errorCode: 'PDF_PROVIDER_UNSUPPORTED',
    }))) as any;
    try {
      const client = new ReceiptOcrClient({
        aiGatewayInternalSecret: 'internal-secret', aiGatewayInternalUrl: 'http://ai.invalid',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, undefined, state.prisma);
      const result = await client.extract({ ...request, mimeType: 'application/pdf' });
      assert.deepEqual(result, { status: 'not_configured', errorCode: 'PDF_PROVIDER_UNSUPPORTED' });
      assert.equal(state.events.length, 0);
      assert.equal(state.usedCount(), 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not admit quota when local tenant model policy resolution fails', async () => {
    __resetCompanyAiBudgetCache();
    let quotaTransactions = 0;
    let fetchCalls = 0;
    const prisma = {
      client: {
        company: { findUnique: async () => null },
        companyAiConfiguration: { findUnique: async () => { throw new Error('POLICY_DB_DOWN'); } },
        $transaction: async () => { quotaTransactions += 1; },
      },
    } as any;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => { fetchCalls += 1; return new Response('{}'); }) as any;
    try {
      const client = new ReceiptOcrClient({
        aiGatewayInternalSecret: 'internal-secret', aiGatewayInternalUrl: 'http://ai.invalid',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, undefined, prisma);
      await assert.rejects(() => client.extract(request), /POLICY_DB_DOWN/);
      assert.equal(quotaTransactions, 0);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});


it('keeps human evidence choices/history on OCR reread without acknowledging the new extraction', async () => {
  const assessment = { route: 'ALTERNATIVE_EVIDENCE', receiptProblem: 'LOST', attachmentIds: ['attachment-1'], reason: 'User reason' };
  const review = { version: 2, reviewedByUserId: 'reviewer', reviewedAt: '2026-08-14', fingerprint: 'old' };
  for (const documentKind of ['RECEIPT', 'ORDER_OR_CHECK_BILL']) {
    const h = makeUseCase({
      expense: { ...baseExpense, aiVerificationSummaryJson: { documentEvidenceDraft: assessment, documentReview: review, extractionRequestId: 'old-request' } },
      gatewayResult: { status: 'ok', fields: { grandTotalAmount: '321.00', vendorName: 'ร้านทดสอบ', missingFields: [] }, classification: classification(documentKind) },
    });
    await h.useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');
    assert.deepEqual(h.updates[0].aiVerificationSummaryJson.documentEvidenceDraft, assessment);
    assert.deepEqual(h.updates[0].aiVerificationSummaryJson.documentReview, review);
    assert.equal(h.updates[0].aiVerificationSummaryJson.extractionRequestId, 'request-1');
  }
});

describe('receipt date provenance survives extraction summaries', () => {
  it('retains the explicit user resolution after a successful extraction', async () => {
    const dateResolution = { expenseDate: '2026-09-12', resolvedByUserId: 'uploader-1', resolvedAt: '2026-09-17T00:00:00Z' };
    const { useCase, updates } = makeUseCase({ expense: { ...baseExpense, aiVerificationSummaryJson: { dateStatus: 'verified', dateResolution } },
      gatewayResult: { status: 'ok', fields: { grandTotalAmount: '321.00' }, classification: classification() } });
    await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');
    assert.deepEqual(updates[0].aiVerificationSummaryJson.dateResolution, dateResolution);
    assert.equal(updates[0].aiVerificationSummaryJson.dateStatus, 'verified');
  });
  it('keeps an unknown document date unknown when the image is not an expense', async () => {
    const { useCase, updates } = makeUseCase({ expense: { ...baseExpense, aiVerificationSummaryJson: { dateStatus: 'unverified', missingFields: ['expenseDate'] } },
      gatewayResult: { status: 'ok', fields: {}, classification: classification('OTHER', { contentKind: 'NON_DOCUMENT', documentFamily: 'OTHER', businessDirection: 'UNKNOWN' }) } });
    await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');
    assert.equal(updates[0].aiVerificationSummaryJson.dateStatus, 'unverified');
  });
});

/**
 * Remediation spec §9.1/§9.2 (B-03). A money refusal is a decision, not a read failure: the file and
 * the draft stay exactly as they were, the result carries the typed code AND the scope, and the
 * reason is written onto the saved summary so a reload (or a resumed attempt) reports the same
 * answer instead of asking the gate again under today's budget.
 */
describe('RequestReceiptExtractionUseCase – company AI money refusals (spec §9.1)', () => {
  const priorSummary = {
    status: 'OCR_EXTRACTED_NEEDS_REVIEW',
    extractionRequestId: 'older-request',
    extractionAttachmentId: 'attachment-1',
    recognizedFields: { vendorName: 'ร้านเดิม' },
    dateStatus: 'verified',
  };

  for (const [code, scope] of [
    ['AI_MONTHLY_BUDGET_EXCEEDED', 'TOTAL'],
    ['AI_BUDGET_INSUFFICIENT', 'TOTAL'],
    ['AI_BUDGET_UNAVAILABLE', undefined],
  ] as const) {
    it(`returns the typed reason and stores it without touching the draft: ${code}`, async () => {
      const { useCase, updates, audits } = makeUseCase({
        expense: { ...baseExpense, updatedAt: new Date('2026-09-15T00:00:00Z'), aiVerificationSummaryJson: priorSummary },
        gatewayResult: { status: 'failed', errorCode: code, ...(scope ? { budgetScope: scope } : {}) },
      });

      const result = await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');

      assert.deepEqual(result, { status: 'failed', errorCode: code, ...(scope ? { budgetScope: scope } : {}) });
      assert.equal(updates.length, 1, 'exactly one write: the reason, nothing else');
      const summary = updates[0].aiVerificationSummaryJson;
      // Nothing an earlier read or a reviewer put there is cleared (B-03).
      assert.equal(summary.recognizedFields.vendorName, 'ร้านเดิม');
      assert.equal(summary.status, 'OCR_EXTRACTED_NEEDS_REVIEW');
      assert.equal(summary.dateStatus, 'verified');
      assert.equal(summary.extractionRequestId, 'older-request', 'the last SUCCESSFUL read still owns these');
      assert.deepEqual(
        { ...summary.aiBudgetRefusal, at: undefined },
        { errorCode: code, ...(scope ? { budgetScope: scope } : {}), extractionRequestId: 'request-1', extractionAttachmentId: 'attachment-1', at: undefined },
      );
      assert.equal(updates[0].aiVerificationStatus, undefined, 'a refused read does not restate the review state');
      assert.equal(audits.find((entry) => entry.action === 'expense.ocr.request').metadataJson.errorCode, code);
      // Internal money never reaches the tenant-visible result or the saved summary.
      assert.equal(/satang|budgetSatang/i.test(JSON.stringify([result, summary])), false);
    });
  }

  it('never fails the request when the summary write loses an optimistic lock', async () => {
    const { useCase, repo } = makeUseCase({
      expense: { ...baseExpense, updatedAt: new Date('2026-09-15T00:00:00Z') },
      gatewayResult: { status: 'failed', errorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' },
    });
    repo.updateExpense = mock.fn(async () => { throw new Error('RECORD_CHANGED'); }) as any;

    assert.deepEqual(await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'), {
      status: 'failed', errorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL',
    });
  });

  it('leaves an ordinary read failure alone — no summary write, no budget words', async () => {
    const { useCase, updates } = makeUseCase({
      expense: { ...baseExpense, updatedAt: new Date('2026-09-15T00:00:00Z') },
      gatewayResult: { status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT' },
    });

    assert.deepEqual(await useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1'), { status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT' });
    assert.deepEqual(updates, []);
  });
});

it('R10 Q5c: web extraction also tells the shared apply that a new source is payment evidence', async () => {
  const h = makeUseCase({ expense: { ...baseExpense, sourceDocumentType: 'NEEDS_REVIEW' },
    gatewayResult: { status: 'ok', classification: classification('TRANSFER_SLIP', { documentFamily: 'PAYMENT_EVIDENCE', businessDirection: 'UNKNOWN' }),
      fields: { vendorName: 'TEST FOODS CO', grandTotalAmount: '321.00' } } });
  await h.useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');
  assert.equal(h.applyCalls.length, 1); assert.equal(h.applyCalls[0][3].sourceDocumentType, 'TRANSFER_SLIP');
});


it('R11 T2: re-extracting a slip on an existing receipt passes OCR classification without replacing reviewer type', async () => {
  const h = makeUseCase({ expense: { ...baseExpense, sourceDocumentType: 'RECEIPT' },
    gatewayResult: { status: 'ok', classification: classification('TRANSFER_SLIP', { documentFamily: 'PAYMENT_EVIDENCE', businessDirection: 'UNKNOWN' }),
      fields: { vendorName: 'TEST FOODS CO', grandTotalAmount: '321.00' } } });
  await h.useCase.execute(ctx(['expense.read', 'expense.ocr.request']), 'expense-1');
  assert.equal(h.applyCalls.length, 1);
  assert.equal(h.applyCalls[0][3].ocrDocumentType, 'TRANSFER_SLIP');
  assert.equal(h.applyCalls[0][3].sourceDocumentType, undefined);
});


it('R3 extraction enforces detail scope before any side effect', async () => {
  for (const mimeType of ['image/jpeg', 'application/pdf']) {
    for (const scenario of ['branch', 'tenant', 'missing', 'ocr-only', 'own-other', 'related-other', 'free-branch', 'free-other', 'free-state'] as const) {
      const free = scenario.startsWith('free-');
      const expense = scenario === 'missing' ? null : { ...baseExpense, branchId: scenario.endsWith('branch') ? 'branch-b' : 'branch-a',
        ...(scenario === 'tenant' ? { companyId: 'other-company' } : {}),
        ...(free ? { status: 'DRAFT' } : {}),
        ...(free && scenario !== 'free-other' ? { createdByUserId: 'user-1' } : {}),
        ...(scenario === 'free-state' ? { status: 'READY_FOR_CONFIRMATION' } : {}) };
      const h = makeUseCase({ expense, free, attachment: { ...baseAttachment, mimeType } });
      const permissions = scenario === 'ocr-only' ? ['expense.ocr.request']
        : scenario === 'own-other' ? ['expense.read_own', 'expense.ocr.request']
        : scenario === 'related-other' ? ['expense.read_related', 'expense.ocr.request']
        : scenario === 'free-branch' ? ['expense.receipt.upload']
        : free ? ['expense.read', 'expense.ocr.request'] : ['expense.review'];
      const actor = { ...ctx(permissions), scopes: { branchIds: ['branch-a'] } };
      await assert.rejects(() => h.useCase.execute(actor, 'expense-1'), (error: any) => error.getStatus() === (scenario === 'free-other' ? 403 : 404), scenario);
      for (const spy of [h.repo.findReceiptExtractionAttachment, h.storage.getObject, h.client.extract, h.repo.updateExpense, h.applyService.apply, h.capture.findLiveJobForAttachment, h.capture.createReadJob]) assert.equal(spy.mock.callCount(), 0, scenario);
      assert.deepEqual(h.capture.jobs, [], scenario);
      assert.deepEqual(h.runner.kicked, [], scenario);
    }
  }
  for (const [permissions, userId, related, free] of [
    [['expense.review'], 'user-1', false, false],
    [['expense.receipt.upload'], 'uploader-1', false, false],
    [['expense.read_own', 'expense.ocr.request'], 'uploader-1', false, false],
    [['expense.read_related', 'expense.ocr.request'], 'user-1', true, false],
    [['expense.receipt.upload'], 'uploader-1', false, true],
  ] as const) {
    const h = makeUseCase({ expense: { ...baseExpense, branchId: 'branch-a' }, attachment: null, related, free });
    assert.equal((await h.useCase.execute({ ...ctx([...permissions], userId), scopes: { branchIds: ['branch-a'] } }, 'expense-1')).status, 'no_attachment');
  }
  const freeDraft = makeUseCase({ free: true, expense: { ...baseExpense, branchId: 'branch-a', status: 'DRAFT' }, attachment: null });
  assert.equal((await freeDraft.useCase.execute({ ...ctx(['expense.receipt.upload'], 'uploader-1'), scopes: { branchIds: ['branch-a'] } }, 'expense-1')).status, 'no_attachment');
  const readOnly = makeUseCase();
  await assert.rejects(() => readOnly.useCase.execute(ctx(['expense.read']), 'expense-1'), (error: any) => error.getStatus() === 403);
  const broken = makeUseCase();
  const failure = new Error('database unavailable');
  broken.repo.findByIdWithRelations.mock.mockImplementation(async () => { throw failure; });
  await assert.rejects(() => broken.useCase.execute(ctx(['expense.review']), 'expense-1'), (error) => error === failure);
});
