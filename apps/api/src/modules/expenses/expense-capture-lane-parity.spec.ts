/**
 * Three lanes, one answer (plan W02: "PDF limits/capability/error messages ตรงกันทั้งสามทาง",
 * "ทั้งสามทางรับ PDF 10 MiB", "status/reopen/retry").
 *
 * The three lanes are web NEW upload, web REPLACE (`extractAgain` after a replace) and LINE file.
 * Nothing stops them drifting except a test that puts their answers side by side, which is what
 * this file is: the same byte boundary, the same reason, the same numbers in the sentence, and the
 * same credit wording when a read stops for money.
 *
 * What is proven ELSEWHERE, deliberately, rather than copied in here:
 * - one read job per attachment+checksum however often the request repeats —
 *   `expense-extraction.use-case.spec.ts` ("reuses the live job for the same PDF") for both web
 *   lanes, which share `queueCaptureRead`, and `expense-capture.pg.spec.ts` ("stores a file once
 *   and queues one read job under two concurrent completions") for the group lane that the LINE
 *   file goes through;
 * - the web client's own gate and its Thai sentence — `expense-capture-upload.logic.spec.ts`
 *   asserts the SAME two numbers this file asserts for LINE, against the same dictionary entry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiConfigSchema } from '@watchdog-bms/config';
import { validateAttachmentMeta } from '../data-model-core/domain/logic/attachment.logic';
import { fileAttemptAnswer } from '../line-ai/domain/logic/line-file-attempt-answer.logic';
import { capturePausedReasonTh } from '../line-ai/domain/logic/line-non-receipt-reply.logic';

/** §4.1. One number, and it is the default — nothing in the product may carry its own copy. */
const LIMIT = 10_485_760;
const OVER = 10_485_761;

describe('three-lane parity: the 10 MiB PDF boundary (plan W02)', () => {
  it('is one configured number, not three constants', () => {
    assert.equal(apiConfigSchema.shape.UPLOAD_MAX_BYTES.parse(undefined), LIMIT,
      'the capability all three lanes read comes from this one default');
  });

  /**
   * Web NEW and web REPLACE both reserve their attachment through `CreateUploadIntentUseCase`,
   * which is the single place this runs; the LINE lane checks the same `uploadMaxBytes` against the
   * webhook's declared size before it fetches a byte. One function decides for all three.
   */
  it('accepts exactly 10,485,760 bytes of PDF and refuses one byte more', () => {
    assert.equal(validateAttachmentMeta('application/pdf', LIMIT, LIMIT), null);
    assert.ok(validateAttachmentMeta('application/pdf', OVER, LIMIT), 'one byte over is refused');
    // …and the refusal is about SIZE, not about PDFs: the 4 MiB PDF-only gate is gone (§4.1).
    assert.equal(validateAttachmentMeta('application/pdf', 9_900_000, LIMIT), null);
    assert.equal(validateAttachmentMeta('image/jpeg', LIMIT, LIMIT), null);
  });

  it('prints the size and the limit the same way the web does: `{size} MB … {limit} MB`', () => {
    const text = fileAttemptAnswer({
      ref: '1', messageType: 'file', fileNameSanitized: 'bill.pdf',
      stage: 'DOWNLOAD', reasonCode: 'oversize_declared', outcome: 'REJECTED',
      declaredFileSize: OVER, measuredByteSize: null,
      capability: { maxBytes: LIMIT, allowedMimeTypes: ['application/pdf'], pdfAutomaticRead: true },
      createdAt: new Date('2026-09-19T03:00:00.000Z'),
    });
    // One decimal, both numbers — `captureMegabytes` on the web prints exactly these two strings
    // for the same bytes (`expense-capture-upload.logic.spec.ts`).
    assert.match(text, /ขนาด 10\.0 MB/);
    assert.match(text, /เกินขนาดที่ระบบรับได้ 10\.0 MB/);
    assert.match(text, /จึงยังไม่ได้เก็บไฟล์นี้/, 'and it says the file was NOT kept');
  });
});

describe('three-lane parity: a read that stops for credit (plan W02)', () => {
  it('says "เครดิตสำหรับการอ่านเอกสารไม่พอ", in the wave-2 wording', () => {
    // The web says the same sentence through `expenses.capture.paused_ai_credit`; the dictionary
    // entry is asserted against this literal in `expense-capture-status.logic.spec.ts`.
    const sentence = 'เครดิตสำหรับการอ่านเอกสารไม่พอ';
    assert.equal(capturePausedReasonTh('ai_credit'), sentence);
    // Assembled at runtime: spelled out, the retired phrases would trip the repo-wide guard.
    const retired = ['\u0e07\u0e1a', '\u0e42\u0e04\u0e27\u0e15\u0e32'].map((word) => `${word} AI`);
    for (const word of retired) assert.ok(!sentence.includes(word));
  });
});
