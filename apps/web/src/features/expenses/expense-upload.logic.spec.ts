import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySignatureUploadFile,
  classifyUploadFile,
  detectReceiptImageByteKind,
  expenseExtractionRetryMode,
  expenseExtractionRetryRequestId,
  bangkokMonthKey,
  isReceiptQuotaBlocked,
  RECEIPT_QUOTA_ERROR_CODE,
  RECEIPT_UPLOAD_ACCEPT,
  SIGNATURE_UPLOAD_ACCEPT,
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

describe('OCR extraction retry', () => {
  it('reuses the request id after a lost response, but starts a fresh provider retry', () => {
    assert.equal(expenseExtractionRetryMode(null), 'same_request');
    assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode: 'AI_GATEWAY_ERROR_503' }), 'new_request');
    assert.equal(expenseExtractionRetryMode({ status: 'failed' }), 'new_request');
    assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode: 'OCR_FEATURE_DISABLED' }), 'none');
    assert.equal(expenseExtractionRetryMode({ status: 'failed', errorCode: 'OCR_MONTHLY_LIMIT_EXCEEDED' }), 'none');
    assert.equal(expenseExtractionRetryMode({ status: 'ok' }), 'none');
    assert.equal(expenseExtractionRetryRequestId('same_request', 'first-id', 'fresh-id'), 'first-id');
    assert.equal(expenseExtractionRetryRequestId('new_request', 'first-id', 'fresh-id'), 'fresh-id');
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
