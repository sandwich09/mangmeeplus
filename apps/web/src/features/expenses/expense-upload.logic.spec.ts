import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableExpenseSessionStorage,
  classifySignatureUploadFile,
  classifyUploadFile,
  detectReceiptImageByteKind,
  readExpenseExtractionAttempt,
  recoveredExpenseExtraction,
  requestExpenseExtractionWithRecovery,
  writeExpenseExtractionAttempt,
  expenseExtractionRetryMode,
  expenseExtractionRetryRequestId,
  bangkokMonthKey,
  isReceiptQuotaBlocked,
  RECEIPT_QUOTA_ERROR_CODE,
  RECEIPT_UPLOAD_ACCEPT,
  SIGNATURE_UPLOAD_ACCEPT,
  shouldShowExtractionNotice,
} from './expense-upload.logic';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { mapResponseToApiError } from '@/common/api/api-error.logic';

describe('classifyUploadFile', () => {
  const cases = [
    ['receipt.jpeg', 'image/jpeg', 'image'],
    ['receipt.jpg', 'image/jpeg', 'image'],
    ['receipt.png', 'image/png', 'image'],
    ['receipt.pdf', 'application/pdf', 'pdf'],
    ['receipt.heic', 'image/heic', 'heic'],
    ['receipt.heif', 'image/heif', 'heic'],
    ['receipt.gif', 'image/gif', 'image'],
    ['receipt.jpe', 'image/jpeg', 'image'],
    ['receipt.jpg', 'image/jpg', 'image'],
    ['AIR_DROP.HEIC', '', 'heic'],
    ['receipt.jpg', '', 'image'],
    ['receipt.gif', '', 'image'],
    ['receipt.jpg', 'application/pdf', 'unsupported'],
    ['receipt.pdf', 'image/jpeg', 'unsupported'],
    ['receipt.svg', 'image/svg+xml', 'unsupported'],
    ['malware.exe', 'application/octet-stream', 'unsupported'],
  ] as const;

  for (const [name, type, expected] of cases) {
    it(`${name} (${type || 'no MIME'}) is ${expected}`, () => {
      assert.equal(classifyUploadFile(name, type), expected);
    });
  }

  it('offers every supported reimbursement receipt source to the file picker', () => {
    for (const value of ['.pdf', '.png', '.jpg', '.jpeg', '.jpe', '.heic', '.heif', '.gif', 'image/gif']) {
      assert.ok(RECEIPT_UPLOAD_ACCEPT.split(',').includes(value));
    }
  });
});

describe('extraction notice visibility', () => {
  it('keeps persistent allowance notices visible after OCR details load', () => {
    assert.equal(shouldShowExtractionNotice({ tone: 'info', persistent: true }, true), true);
    assert.equal(shouldShowExtractionNotice({ tone: 'info' }, true), false);
    assert.equal(shouldShowExtractionNotice({ tone: 'error' }, true), true);
  });
});

describe('OCR extraction retry', () => {
  it('reuses the request id after a lost response, but starts a fresh provider retry', () => {
    assert.equal(expenseExtractionRetryMode(null), 'same_request');
    assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode: 'AI_GATEWAY_ERROR_503' }), 'new_request');
    assert.equal(expenseExtractionRetryMode({ status: 'failed' }), 'new_request');
    for (const errorCode of ['OCR_EMPTY_OUTPUT', 'OCR_JSON_PARSE_FAILED']) assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode }), 'new_request');
    for (const errorCode of ['OCR_REQUEST_ALREADY_ADMITTED', 'OCR_QUOTA_UNAVAILABLE', 'RECEIPT_QUOTA_EXCEEDED']) assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode }), 'none');
    assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode: 'OCR_FEATURE_DISABLED' }), 'none');
    assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode: 'OCR_MONTHLY_LIMIT_EXCEEDED' }), 'none');
    assert.equal(expenseExtractionRetryMode({ status: 'ok' }), 'none');
    assert.equal(expenseExtractionRetryRequestId('same_request', 'first-id', 'fresh-id'), 'first-id');
    assert.equal(expenseExtractionRetryRequestId('new_request', 'first-id', 'fresh-id'), 'fresh-id');
  });

  const saved = (summary: Record<string, unknown>, attachmentId = 'att-1') => ({
    aiVerificationSummaryJson: summary,
    attachments: [{ id: attachmentId, purpose: 'expense.receipt.primary', status: 'ACTIVE' }],
    vendorNameSnapshot: 'ร้านเดิม',
    vendorDocumentNumber: 'R-1',
    expenseDate: '2026-09-07',
    grandTotalAmount: '120.00',
  } as any);

  it('recovers one persisted success after a lost response without a second provider request', async () => {
    const attempt = { requestId: 'ocr-1', attachmentId: 'att-1' };
    let requests = 0;
    const outcome = await requestExpenseExtractionWithRecovery({
      attempt,
      request: async () => { requests += 1; throw { kind: 'network_error' }; },
      read: async () => saved({
        status: 'OCR_EXTRACTED_NEEDS_REVIEW',
        extractionRequestId: 'ocr-1',
        extractionAttachmentId: 'att-1',
        recognizedFields: { vendorName: 'ร้านเดิม', grandTotalAmount: '120.00' },
        missingFields: ['expenseDate'],
      }),
      wait: async () => undefined,
    });

    assert.equal(requests, 1);
    assert.equal(outcome.result.status, 'ok');
    assert.equal(outcome.result.fields?.grandTotalAmount, '120.00');
    assert.equal(outcome.result.fields?.expenseDate, undefined, 'does not recover the placeholder record date as a paper fact');
    assert.deepEqual(outcome.result.missingFields, ['expenseDate']);
    assert.ok(outcome.recoveredDetail);
    assert.equal(outcome.pending, false);
  });

  it('refuses an old or differently attached summary and keeps a proven failure retriable', async () => {
    const attempt = { requestId: 'ocr-new', attachmentId: 'att-new' };
    for (const stale of [
      saved({ status: 'OCR_EXTRACTED_NEEDS_REVIEW' }, 'att-new'),
      saved({
        status: 'OCR_EXTRACTED_NEEDS_REVIEW',
        extractionRequestId: 'ocr-old',
        extractionAttachmentId: 'att-new',
      }, 'att-new'),
      saved({
        status: 'OCR_EXTRACTED_NEEDS_REVIEW',
        extractionRequestId: 'ocr-new',
        extractionAttachmentId: 'att-old',
      }, 'att-new'),
      saved({
        status: 'NOT_EXPENSE_DOCUMENT',
        extractionRequestId: 'ocr-new',
        extractionAttachmentId: 'att-new',
      }, 'att-new'),
      saved({
        status: 'OCR_FAILED',
        extractionRequestId: 'ocr-new',
        extractionAttachmentId: 'att-new',
      }, 'att-new'),
    ]) assert.equal(recoveredExpenseExtraction(stale, attempt), null);

    const requestIds: string[] = [];
    const outcome = await requestExpenseExtractionWithRecovery({
      attempt,
      request: async (requestId) => {
        requestIds.push(requestId);
        if (requestIds.length === 1) throw { kind: 'network_error' };
        return { status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT' };
      },
      read: async () => saved({ status: 'OCR_EXTRACTED_NEEDS_REVIEW' }, 'att-new'),
      wait: async () => undefined,
    });
    assert.deepEqual(requestIds, ['ocr-new', 'ocr-new']);
    assert.equal(outcome.result.status, 'failed');
    assert.equal(expenseExtractionRetryMode(outcome.result), 'new_request');
  });

  it('keeps a duplicate admission unresolved, then recovers before POST on resume', async () => {
    const attempt = { requestId: 'ocr-pending', attachmentId: 'att-1' };
    let persisted = false;
    const requestIds: string[] = [];
    const read = async () => saved(persisted ? {
      status: 'OCR_EXTRACTED_NEEDS_REVIEW',
      extractionRequestId: 'ocr-pending',
      extractionAttachmentId: 'att-1',
      recognizedFields: { vendorName: 'ร้านช้า' },
      missingFields: ['expenseDate'],
    } : { status: 'PROCESSING' });
    const first = await requestExpenseExtractionWithRecovery({
      attempt,
      request: async (requestId) => {
        requestIds.push(requestId);
        if (requestIds.length === 1) throw { kind: 'network_error' };
        return { status: 'failed', errorCode: 'OCR_REQUEST_ALREADY_ADMITTED' };
      },
      read,
      wait: async () => undefined,
    });
    assert.equal(first.pending, true);
    assert.deepEqual(requestIds, ['ocr-pending', 'ocr-pending']);

    persisted = true;
    const resumed = await requestExpenseExtractionWithRecovery({
      attempt,
      request: async (requestId) => {
        requestIds.push(requestId);
        throw new Error('must recover before another POST');
      },
      read,
      wait: async () => undefined,
      resume: true,
    });
    assert.equal(resumed.pending, false);
    assert.equal(resumed.result.fields?.vendorName, 'ร้านช้า');
    assert.deepEqual(requestIds, ['ocr-pending', 'ocr-pending']);
  });

  it('stores an uncertain attempt only inside its company, expense, and attachment scope', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const attempt = { requestId: 'ocr-1', attachmentId: 'att-1' };
    writeExpenseExtractionAttempt(storage, 'company-1', 'expense-1', attempt);
    assert.deepEqual(readExpenseExtractionAttempt(storage, 'company-1', 'expense-1', 'att-1'), attempt);
    assert.equal(readExpenseExtractionAttempt(storage, 'company-2', 'expense-1', 'att-1'), null);
    assert.equal(readExpenseExtractionAttempt(storage, 'company-1', 'expense-2', 'att-1'), null);
    assert.equal(readExpenseExtractionAttempt(storage, 'company-1', 'expense-1', 'att-2'), null);
    writeExpenseExtractionAttempt(storage, 'company-1', 'expense-1', null);
    assert.equal(readExpenseExtractionAttempt(storage, 'company-1', 'expense-1', 'att-1'), null);
  });

  it('keeps extraction usable when the browser blocks access to session storage', () => {
    const blocked = Object.defineProperty({}, 'sessionStorage', {
      get: () => { throw new DOMException('blocked', 'SecurityError'); },
    }) as { readonly sessionStorage: Storage };
    const storage = availableExpenseSessionStorage(blocked);
    assert.equal(storage, undefined);
    assert.equal(readExpenseExtractionAttempt(storage, 'company-1', 'expense-1', 'att-1'), null);
    assert.doesNotThrow(() => writeExpenseExtractionAttempt(storage, 'company-1', 'expense-1', {
      requestId: 'ocr-1', attachmentId: 'att-1',
    }));
  });
});

describe('signature image uploads', () => {
  for (const [name, type] of [
    ['signature.png', 'image/png'],
    ['signature.jpg', 'image/jpeg'],
    ['signature.jpg', 'image/jpg'],
    ['signature.jpeg', 'image/jpeg'],
    ['signature.jpe', 'image/jpeg'],
    ['signature.jpe', ''],
    ['signature.heic', 'image/heic'],
    ['signature.heif', 'image/heif'],
    ['signature.gif', 'image/gif'],
    ['signature.gif', ''],
  ] as const) {
    it(`accepts ${name} (${type || 'no MIME'})`, () => {
      assert.notEqual(classifySignatureUploadFile(name, type), 'unsupported');
    });
  }

  it('offers every supported type to the file picker', () => {
    for (const value of ['.png', '.jpg', '.jpeg', '.jpe', '.heic', '.heif', '.gif', 'image/gif']) {
      assert.ok(SIGNATURE_UPLOAD_ACCEPT.split(',').includes(value));
    }
  });
});

describe('detectReceiptImageByteKind', () => {
  it('recognizes verified JPEG and PNG containers', () => {
    assert.equal(detectReceiptImageByteKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), 'jpeg');
    // Owner 2026-11-08: a Galaxy S23 photo has a "SEFT" trailer after the end marker; keep it as the original JPEG.
    assert.equal(detectReceiptImageByteKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xd9, 0x53, 0x45, 0x46, 0x54])), 'jpeg');
    assert.equal(detectReceiptImageByteKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x02])), 'unknown');
    assert.equal(detectReceiptImageByteKind(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  });

  it('detects iPhone HEIC bytes even when file metadata says JPG', () => {
    const renamedHeic = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63]);
    assert.equal(detectReceiptImageByteKind(renamedHeic), 'heic');
  });

  it('does not pass a truncated JPEG through to the backend', () => {
    assert.equal(detectReceiptImageByteKind(Uint8Array.from([0xff, 0xd8, 0x00, 0x01])), 'unknown');
  });
});


/**
 * P10-L §15.1 (review F3). The upload panel latched the quota answer and then called `onSuccess`,
 * which routes to the review screen — the panel unmounted and took the banner and the disabled
 * button with it, so neither ever painted and the shop could walk back and upload again.
 */
describe('receipt quota latch', () => {
  const latch = { monthKey: '2026-09', message: 'โควตาให้ AI อ่านรูปของเดือนนี้ครบแล้ว' };

  it('blocks for the rest of the month it was raised in', () => {
    assert.equal(isReceiptQuotaBlocked(latch, '2026-09-05'), true);
    assert.equal(isReceiptQuotaBlocked(latch, '2026-09-30'), true, 'still the same ceiling on the last day');
  });

  it('clears itself when the month rolls over, with no reload', () => {
    // The ceiling resets on the 1st; a latch that outlived its month would lock a paying shop out.
    assert.equal(isReceiptQuotaBlocked(latch, '2026-10-01'), false);
    assert.equal(isReceiptQuotaBlocked(latch, '2026-08-31'), false, 'a clock moved backwards unblocks too');
  });

  it('never blocks when nothing was latched', () => {
    assert.equal(isReceiptQuotaBlocked(null, '2026-09-05'), false);
  });

  it('stamps the month from the company civil date the upload form already uses', () => {
    assert.equal(bangkokMonthKey('2026-09-05'), '2026-09');
    assert.equal(bangkokMonthKey('2026-01-31'), '2026-01');
  });

  it('recognises the API answer that raises it, end to end through the error mapper', async () => {
    // The 409 the extraction use case throws. `mapResponseToApiError` keeps only `code`, which is
    // exactly why the latch stamps the month itself instead of reading `monthKey` off the body.
    const response = new Response(
      JSON.stringify({
        statusCode: 409,
        code: RECEIPT_QUOTA_ERROR_CODE,
        message: 'plan ceiling reached',
        count: 15,
        limit: 15,
        monthKey: '2026-09',
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
    const error = await mapResponseToApiError(response);

    assert.equal(apiErrorCode(error), RECEIPT_QUOTA_ERROR_CODE);
    assert.equal((error as unknown as { monthKey?: string }).monthKey, undefined);
    // The banner shows reviewed Thai copy, never the server's own sentence.
    const shown = apiErrorMessage(error);
    assert.match(shown, /โควตาให้ AI อ่านรูป/);
    assert.doesNotMatch(shown, /plan ceiling reached/);
    assert.doesNotMatch(shown, /receipt_quota_exceeded/);
  });
});

/**
 * Remediation spec §9.2 (web) / B-03. The company's monthly AI MONEY is not a flaky read: retrying it
 * under a fresh request id only spends another admission against a gate that cannot open, and the
 * saved reason of the attempt that WAS refused must be what a resumed page reports.
 */
describe('company AI money refusals on the upload screen', () => {
  it('never re-reads against a closed money gate, but still retries plain contention', () => {
    for (const errorCode of ['AI_MONTHLY_BUDGET_EXCEEDED', 'AI_BUDGET_INSUFFICIENT', 'AI_BUDGET_UNAVAILABLE']) {
      assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode }), 'none', errorCode);
    }
    // Contention frees on its own; the one bounded retry this screen already performs is kept.
    assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode: 'AI_BUDGET_BUSY' }), 'new_request');
    // Unrelated failures keep the behaviour they had.
    assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT' }), 'new_request');
  });

  it('replays this attempt\'s own stored reason instead of asking today\'s budget', () => {
    const attempt = { requestId: 'ocr-refused', attachmentId: 'att-1' };
    const detail = {
      aiVerificationSummaryJson: {
        // An older read succeeded and still owns the top-level fields; the refusal is its own record.
        status: 'OCR_EXTRACTED_NEEDS_REVIEW',
        extractionRequestId: 'ocr-older',
        extractionAttachmentId: 'att-1',
        recognizedFields: { vendorName: 'ร้านเดิม' },
        aiBudgetRefusal: {
          errorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL',
          extractionRequestId: 'ocr-refused', extractionAttachmentId: 'att-1',
        },
      },
      attachments: [{ id: 'att-1', purpose: 'expense.receipt.primary', status: 'ACTIVE' }],
    };

    assert.deepEqual(recoveredExpenseExtraction(detail as any, attempt), {
      status: 'failed', errorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL',
    });
    // A DIFFERENT attempt must not inherit it, and the older success is still recoverable by its id.
    assert.equal(recoveredExpenseExtraction(detail as any, { requestId: 'ocr-other', attachmentId: 'att-1' }), null);
    assert.deepEqual(recoveredExpenseExtraction(detail as any, { requestId: 'ocr-older', attachmentId: 'att-1' }), {
      status: 'ok', fields: { vendorName: 'ร้านเดิม' },
    });
    // An unrecognised code is not turned into a refusal result.
    const bogus = { ...detail, aiVerificationSummaryJson: { ...detail.aiVerificationSummaryJson, aiBudgetRefusal: { ...detail.aiVerificationSummaryJson.aiBudgetRefusal, errorCode: 'SOMETHING_ELSE' } } };
    assert.equal(recoveredExpenseExtraction(bogus as any, attempt), null);
  });

  it('asks the server only once for a refused read', async () => {
    const requestIds: string[] = [];
    const outcome = await requestExpenseExtractionWithRecovery({
      attempt: { requestId: 'ocr-budget', attachmentId: 'att-1' },
      request: async (requestId: string) => {
        requestIds.push(requestId);
        return { status: 'failed', errorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' };
      },
      read: async () => { throw new Error('a refused read needs no recovery round trip'); },
      wait: async () => undefined,
    });
    assert.deepEqual(requestIds, ['ocr-budget']);
    assert.equal(expenseExtractionRetryMode(outcome.result), 'none', 'and the caller performs no second attempt');
  });
});
