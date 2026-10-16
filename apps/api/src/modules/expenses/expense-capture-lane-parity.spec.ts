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

  it('prints the size and the limit the same way the web does: `{size} เมกะไบต์ … {limit} เมกะไบต์`', () => {
    const text = fileAttemptAnswer({
      ref: '1', messageType: 'file', fileNameSanitized: 'bill.pdf',
      stage: 'DOWNLOAD', reasonCode: 'oversize_declared', outcome: 'REJECTED',
      declaredFileSize: OVER, measuredByteSize: null,
      capability: { maxBytes: LIMIT, allowedMimeTypes: ['application/pdf'], pdfAutomaticRead: true },
      createdAt: new Date('2026-09-19T03:00:00.000Z'),
    });
    // One decimal, both numbers — `captureMegabytes` on the web prints exactly these two strings
    // for the same bytes (`expense-capture-upload.logic.spec.ts`).
    assert.match(text, /ขนาด 10\.0 เมกะไบต์/);
    assert.match(text, /เกินขนาดที่ระบบรับได้ 10\.0 เมกะไบต์/);
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


it('LINE PDF persistence invokes the shared upload guards before queuing the web capture reader', async () => {
  const { ProcessLineWebhookUseCase } = await import('../line-ai/application/use-cases/process-line-webhook.use-case');
  const flow = Object.create(ProcessLineWebhookUseCase.prototype) as any;
  const calls: string[] = [];
  const ctx = { companyId: 'company', userId: 'user', requestId: 'request', permissions: ['expense.receipt.line_upload'] };
  const original = Buffer.from('%PDF fixture original');
  flow.initReceiptUpload = { execute: async (context: unknown, input: any) => {
    assert.equal(context, ctx); assert.equal(input.mimeType, 'application/pdf'); calls.push('init');
    return { expenseId: 'expense', attachmentId: 'attachment', uploadRequired: true };
  } };
  flow.uploadLineMedia = async (_intent: unknown, media: any) => { assert.equal(media.bytes, original); calls.push('store-original'); };
  flow.completeReceiptUpload = { execute: async (context: unknown) => { assert.equal(context, ctx); calls.push('complete'); return { updatedAt: new Date(0) }; } };
  flow.captureLine = { queueExpenseRead: async (input: any) => {
    assert.equal(input.companyId, ctx.companyId); assert.equal(input.expenseId, 'expense');
    assert.equal(input.attachmentId, 'attachment'); assert.equal(input.expectedSourceUpdatedAt.getTime(), 0);
    calls.push('shared-capture-job'); return 'job';
  } };
  flow.captureOwnerMetadata = () => ({}); flow.expenseCaptureLink = () => '/expense';
  const result = await flow.persistLineFileExpense(ctx, {}, { caption: '', media: { bytes: original, mimeType: 'application/pdf', fileName: 'bill.pdf', byteSize: original.length } });
  assert.equal(result.readJobId, 'job');
  assert.deepEqual(calls, ['init', 'store-original', 'complete', 'shared-capture-job']);
});

it('OCR-C LINE file and pending-PDF receipt paths queue one ordinary capture job without receipt-ocr', async () => {
  const { ProcessLineWebhookUseCase } = await import('../line-ai/application/use-cases/process-line-webhook.use-case');
  const { ExpenseCaptureLineUseCase } = await import('./application/use-cases/expense-capture-line.use-case');
  const { hashMessagePreview } = await import('../line-ai/domain/logic/line-ai-classifier.logic');
  for (const pending of [false, true]) {
    const jobs: any[] = [], calls: string[] = [], replies: string[] = [];
    const flow = Object.create(ProcessLineWebhookUseCase.prototype) as any;
    const event = { webhookEventId: 'evt', lineMessageId: 'msg', lineUserId: 'Uuser', messageType: 'file' };
    const ctx = { requestId: 'req', companyId: 'company', userId: 'user', membershipId: 'member', scopes: {} };
    const access = { membershipId: 'member', permissions: ['expense.receipt.line_upload'], roles: [], scopes: {} };
    const saved = { id: 'expense', companyId: 'company', createdByUserId: 'user', captureSource: 'LINE_UPLOAD',
      primaryAttachmentId: 'attachment', updatedAt: new Date(0), sourceChannelMetadataJson: { chatKeyHash: hashMessagePreview('Uuser') } };
    let exists = false;
    flow.expenseRepo = { findByLineMessageId: async () => exists ? saved : null,
      resolveCreateBranchId: async () => 'branch',
      createExpense: async () => { exists = true; calls.push('draft'); return saved; },
      findByIdWithRelations: async (_company: string, _id: string, _db: unknown, scopes: unknown) => { assert.equal(scopes, access.scopes); return saved; } };
    flow.completeReceiptDraft = async () => { calls.push('guarded-link'); return false; };
    flow.audit = { log: async () => undefined };
    flow.initReceiptUpload = { execute: async () => { calls.push('init'); return { expenseId: 'expense', attachmentId: 'attachment' }; } };
    flow.uploadLineMedia = async () => { calls.push('original'); };
    flow.completeReceiptUpload = { execute: async () => { calls.push('complete'); return saved; } };
    flow.captureLine = Object.create(ExpenseCaptureLineUseCase.prototype);
    flow.captureLine.capture = { client: {}, findLiveJobForAttachment: async () => jobs[0] ?? null,
      createReadJob: async (_db: unknown, input: any) => { calls.push('capture-job'); const job = { id: 'job', ...input }; jobs.push(job); return job; } };
    flow.captureLine.runner = { kick: () => undefined };
    flow.resolveLineCaptureBranchId = async () => 'branch'; flow.captureOwnerMetadata = () => ({});
    flow.expenseCaptureLink = () => '/expense'; flow.recordIntakeAttempt = async () => undefined;
    flow.deliverCompletedReply = async (_event: unknown, text: string) => { replies.push(text); };
    flow.persistIntakeTurn = async () => undefined; flow.updateEventLog = async () => undefined;
    flow.recordDeliveredReceiptContinuation = async () => undefined;
    flow.prisma = { client: { attachmentObject: { findFirst: async ({ where }: any) => {
      assert.deepEqual(where, { id: 'attachment', companyId: 'company', uploadedByUserId: 'user', status: 'ACTIVE' });
      return { checksumSha256: 'bytes' };
    } }, lineIntakePendingMedia: { updateMany: async () => undefined } } };
    flow.aiGateway = { requestReceiptOcr: async () => assert.fail('whole PDFs must not reach receipt-ocr') };
    if (pending) {
      const media = { id: 'pending', attachmentId: 'attachment', lineMessageId: 'msg', mimeType: 'application/pdf' };
      for (let retry = 0; retry < 2; retry++) await flow.resolvePendingMediaAsReceipt(event, 'req', 'user', 'company', access, media, 'บันทึกใบนี้');
      assert.deepEqual(calls, ['draft', 'guarded-link', 'capture-job', 'guarded-link']);
    } else {
      await flow.captureLineFile({ event, ctx, access, companyId: 'company', userId: 'user', caption: '',
        media: { bytes: Buffer.from('%PDF original'), mimeType: 'application/pdf', byteSize: 13, fileName: 'invoice.pdf', checksumSha256: 'bytes' } });
      assert.deepEqual(calls, ['init', 'original', 'complete', 'capture-job']);
    }
    assert.equal(jobs.length, 1); assert.equal(jobs[0].ownerType, 'EXPENSE');
    assert.equal(jobs[0].companyId, 'company'); assert.equal(jobs[0].attachmentId, 'attachment');
    assert.equal(jobs[0].expectedSourceUpdatedAt.getTime(), 0);
    assert.ok(replies.every(text => /กำลังอ่านเอกสาร/.test(text)));
  }
});
