import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ATTACHMENT_UPLOAD_ACCEPT, IMAGE_UPLOAD_ACCEPT, classifyUploadSourceFile, prepareAttachmentUpload, uploadFileValidationError } from './upload-file.logic';
import { RECEIPT_UPLOAD_ACCEPT, SIGNATURE_UPLOAD_ACCEPT } from '@/features/expenses/expense-upload.logic';
import { submitSubstitutePaperFile, uploadExpenseEvidenceFile } from '@/features/expenses/expenses.api';
import { uploadReceiptFile, uploadClaimSignature, uploadSignedClaimFormCopy } from '@/features/reimbursements/reimbursements.api';
import { uploadAccountingDocumentSupporting } from '@/features/accounting-documents/accounting-documents.api';
import { uploadTradeTaxEvidenceAttachment } from '@/features/tax/transaction-tax.api';
import { classifyStatementFile, STATEMENT_UPLOAD_ACCEPT } from '@/features/banking/banking.logic';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const heic = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0, 109, 105, 102, 49, 104, 101, 105, 99]);
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalBitmap = globalThis.createImageBitmap;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete (globalThis as { document?: Document }).document;
  else globalThis.document = originalDocument;
  if (originalBitmap === undefined) delete (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  else globalThis.createImageBitmap = originalBitmap;
});

// The decoder is already shared with primary uploads. Stub browser pixels here to test the
// previously broken contract: conversion must precede intent, PUT, completion and checksum.
function browserPixels() {
  globalThis.createImageBitmap = (async () => ({ width: 4000, height: 3000, close() {} })) as typeof createImageBitmap;
  globalThis.document = {
    cookie: '',
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob: (callback: BlobCallback) => callback(new Blob([jpeg], { type: 'image/jpeg' })),
    }),
  } as unknown as Document;
}

describe('consistent upload sources', () => {
  it('uses the primary picker policy everywhere, keeping signatures image-only and statements text-capable', () => {
    assert.equal(ATTACHMENT_UPLOAD_ACCEPT, RECEIPT_UPLOAD_ACCEPT);
    assert.equal(IMAGE_UPLOAD_ACCEPT, SIGNATURE_UPLOAD_ACCEPT);
    for (const entry of ATTACHMENT_UPLOAD_ACCEPT.split(',')) assert.ok(STATEMENT_UPLOAD_ACCEPT.split(',').includes(entry));
    for (const [name, type] of [
      ['photo.HEIC', ''], ['photo.heic', 'image/heic'], ['photo.heif', 'image/heif'],
      ['photo.heic', 'image/heif-sequence'], ['photo.heif', 'image/heic-sequence'],
      ['photo.gif', 'image/gif'], ['photo.jpe', 'image/jpeg'], ['photo.jpg', 'image/jpg'],
    ]) {
      assert.notEqual(classifyUploadSourceFile({ name, type }), 'unsupported');
      assert.equal(classifyStatementFile(name, type), 'extractable');
      assert.notEqual(classifyUploadSourceFile({ name, type }, 'image'), 'unsupported');
    }
    for (const [name, type] of [['photo.svg', 'image/svg+xml'], ['photo.png', 'image/jpeg'], ['photo.heic', 'application/pdf'], ['photo.exe', 'image/jpeg']]) {
      assert.equal(classifyUploadSourceFile({ name, type }), 'unsupported');
    }
    assert.equal(classifyUploadSourceFile({ name: 'form.pdf', type: 'application/pdf' }, 'image'), 'unsupported');
    assert.notEqual(uploadFileValidationError({ name: 'photo.heic', type: 'image/heic' }), null, 'server-facing boundary stays strict');
  });

  it('preserves canonical PDF/PNG/JPEG bytes and rejects unsupported sources before requesting an intent', async () => {
    for (const [name, type, bytes] of [
      ['form.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.7')],
      ['photo.png', 'image/png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])],
      ['photo.jpeg', 'image/jpeg', jpeg],
    ] as const) {
      const file = new File([bytes], name, { type });
      assert.equal(await prepareAttachmentUpload(file), file);
    }
    globalThis.fetch = (async () => { throw new Error('must not request an intent'); }) as typeof fetch;
    await assert.rejects(uploadExpenseEvidenceFile('co', 'exp', 'br', new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }), 'expense.receipt.primary'), /รองรับเฉพาะไฟล์/);
    await assert.rejects(uploadClaimSignature('co', 'req', 'REQUESTER', new File(['pdf'], 'form.pdf', { type: 'application/pdf' })), /รองรับเฉพาะไฟล์/);
  });

  it('normalizes every source before the signed upload across primary replacement, evidence, forms, tax and accounting', async () => {
    browserPixels();
    const flows: Array<(file: File) => Promise<unknown>> = [
      ...(['expense.receipt.primary', 'expense.receipt.supporting', 'expense.payment.evidence'] as const)
        .map(purpose => (file: File) => uploadExpenseEvidenceFile('co', 'exp', 'br', file, purpose)),
      file => uploadReceiptFile('co', file, 'br'),
      file => uploadClaimSignature('co', 'req', 'REQUESTER', file),
      file => uploadSignedClaimFormCopy('co', 'req', file, 'br'),
      file => uploadTradeTaxEvidenceAttachment('co', 'br', file),
      file => uploadAccountingDocumentSupporting('co', 'doc', 'br', file),
      file => submitSubstitutePaperFile('co', 'exp', 'evidence', file, { expectedEvidenceUpdatedAt: '2026-09-14T00:00:00Z' } as Parameters<typeof submitSubstitutePaperFile>[4]),
    ];
    for (const [name, type, bytes] of [
      ['ios.HEIC', '', heic], ['ios.heif', 'image/heif', heic],
      ['line.jpg', 'image/jpeg', heic], ['photo.gif', 'image/gif', new TextEncoder().encode('GIF89a')],
      ['photo.jpe', 'image/jpeg', jpeg], ['photo.jpg', 'image/jpg', jpeg],
    ] as const) {
      for (const flow of flows) {
        let intents = 0; let puts = 0; let completions = 0;
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          if (init?.method === 'PUT') {
            puts++;
            assert.equal(intents, 1);
            const file = init.body as File;
            assert.equal(file.name, name.replace(/\.[^.]+$/, '.jpg'));
            assert.equal(file.type, 'image/jpeg');
            assert.equal(new Headers(init.headers).get('content-type'), 'image/jpeg');
            assert.equal(new Headers(init.headers).get('if-none-match'), '*');
            assert.deepEqual(new Uint8Array(await file.arrayBuffer()), jpeg);
            return new Response(null, { status: 200 });
          }
          const body = JSON.parse(String(init?.body));
          if (String(input).endsWith('upload-intent')) {
            intents++;
            assert.equal(body.originalFileName, name.replace(/\.[^.]+$/, '.jpg'));
            assert.equal(body.mimeType, 'image/jpeg');
            assert.equal(body.byteSize, jpeg.length);
            return Response.json({ attachmentId: 'att', uploadUrl: 'https://storage.test/file', uploadMethod: 'PUT', uploadHeaders: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' } });
          }
          if (String(input).endsWith('/complete') || String(input).endsWith('/submit')) {
            completions++;
            assert.equal(puts, 1);
            assert.equal(body.byteSize, jpeg.length);
            if (body.checksumSha256) assert.equal(body.checksumSha256, createHash('sha256').update(jpeg).digest('hex'));
          }
          return Response.json({ id: 'att' });
        }) as typeof fetch;
        await flow(new File([bytes], name, { type }));
        assert.deepEqual([intents, puts, completions], [1, 1, 1]);
      }
    }
  });
});
