import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RequestReceiptExtractionUseCase } from './expense-extraction.use-case';
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
        // Spec §5.1/§5.2: the real service always answers both, so the fake must too — a fake that
        // omits them lets the caller read `undefined` where production reads a decision.
        reviewReasons: [],
        dateVerified: true,
        ...options.applyResult,
      };
    }),
  };
  const audit = {
    log: mock.fn(async (entry: any) => { audits.push(entry); }),
  };
  const prisma = {
    client: {
      companyOcrMonthlyUsage: { findUnique: async () => options.used === undefined ? null : { usedCount: options.used } },
      companyPlanTerm: {
        findUnique: async () => options.planTerm
          ? { warmupUntil: null, warmupSlipLimit: null, ...options.planTerm }
          : null,
      },
    },
  } as any;
  const useCase = new RequestReceiptExtractionUseCase(repo as any, storage as any, client as any, applyService as any, audit as any, prisma);
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

    const result = await useCase.execute(ctx(['expense.ocr.request']), 'expense-1');

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
      const ocrAudit = audits.find((entry) => entry.action === 'expense.ocr.request');
      assert.deepEqual(ocrAudit.metadataJson.reasonCodes, ['MISSING_PAYMENT_EVIDENCE']);
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

  // P10-L §15.1 / review G-01. The ceiling is decided by `admitCompanyOcr` inside the OCR client;
  // this use case only has to turn its refusal into something the upload screen can act on.
  describe('receipt quota answer', () => {
    const quotaRefused = { status: 'failed', errorCode: 'RECEIPT_QUOTA_EXCEEDED' };
    const freeTrial = { tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 15 };

    it('answers 409 receipt_quota_exceeded, carrying the numbers the banner needs', async () => {
      const { useCase } = makeUseCase({ gatewayResult: quotaRefused, planTerm: freeTrial, used: 15 });

      await assert.rejects(
        () => useCase.execute(ctx(['expense.ocr.request']), 'expense-1'),
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
        () => useCase.execute(ctx(['expense.ocr.request']), 'expense-1'),
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
        () => tiered.execute(ctx(['expense.ocr.request']), 'expense-1'),
        (error: any) => {
          assert.match(error.getResponse().message, /15 ครั้ง/);
          assert.doesNotMatch(error.getResponse().message, /0 ครั้ง/);
          return true;
        },
      );
      // Nothing left to read the ceiling from at all: the sentence drops the number, never prints 0.
      await assert.rejects(
        () => useCase.execute(ctx(['expense.ocr.request']), 'expense-1'),
        (error: any) => {
          // The fixed "ใบเสร็จ 1 ใบ = 1 ครั้ง" rate clause stays; it is the CEILING that has no number.
          assert.doesNotMatch(error.getResponse().message, /อ่านรูปได้ \d+ ครั้ง/);
          assert.match(error.getResponse().message, /ครบตามจำนวน/);
          return true;
        },
      );
    });

    it('names the warm-up ceiling while that window is open', async () => {
      const { useCase } = makeUseCase({
        gatewayResult: quotaRefused,
        planTerm: { ...freeTrial, warmupUntil: new Date(Date.now() + 86_400_000), warmupSlipLimit: 10 },
        used: 10,
      });

      await assert.rejects(
        () => useCase.execute(ctx(['expense.ocr.request']), 'expense-1'),
        (error: any) => {
          assert.equal(error.getResponse().limit, 10);
          assert.match(error.getResponse().message, /10 ครั้ง/);
          return true;
        },
      );
    });

    it('audits the refusal rather than logging it as an extraction failure', async () => {
      const { useCase, audits } = makeUseCase({ gatewayResult: quotaRefused, planTerm: freeTrial, used: 15 });

      await useCase.execute(ctx(['expense.ocr.request']), 'expense-1').catch(() => undefined);

      const quotaAudit = audits.find((entry) => entry.metadataJson?.status === 'receipt_quota_exceeded');
      assert.ok(quotaAudit, 'the refusal is auditable on its own name');
      assert.equal(quotaAudit.metadataJson.errorCode, 'RECEIPT_QUOTA_EXCEEDED');
    });

    it('leaves every OTHER gateway failure on its existing "try again" path', async () => {
      const { useCase } = makeUseCase({
        gatewayResult: { status: 'failed', errorCode: 'OCR_MONTHLY_LIMIT_EXCEEDED' }, planTerm: freeTrial, used: 15,
      });

      assert.deepEqual(
        await useCase.execute(ctx(['expense.ocr.request']), 'expense-1'),
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
    const tx = {
      $executeRaw: async () => undefined,
      companyAiConfiguration: { findUnique: async () => ({ ocrEnabled: true, ocrMonthlyLimit: 10 }) },
      companyOcrUsageEvent: {
        findUnique: async ({ where }: any) => {
          const key = where.companyId_sourceRoute_requestId;
          return events.find((event) => event.companyId === key.companyId
            && event.sourceRoute === key.sourceRoute && event.requestId === key.requestId) ?? null;
        },
        create: async ({ data }: any) => {
          const event = { id: `event-${events.length + 1}`, ...data };
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
      auditLog: { findFirst: async () => null },
    };
    const prisma = {
      client: {
        companyAiConfiguration: { findUnique: async () => null },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
      },
    } as any;
    return { prisma, events, usedCount: () => usedCount };
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

  it('still keeps the read when the failure is a decision this system already made', async () => {
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
      assert.equal(state.usedCount(), 1, 'the provider read the image and said it was empty');
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
      companyOcrUsageEvent: { findUnique: async () => null },
      companyAiConfiguration: { findUnique: async () => ({ ocrEnabled: false, ocrMonthlyLimit: 10 }) },
      companyOcrMonthlyUsage: { findUnique: async () => null },
      companyPlanTerm: { findUnique: async () => null },
      auditLog: { findFirst: async () => null },
    };
    const prisma = {
      client: {
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
