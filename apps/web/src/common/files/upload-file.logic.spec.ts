import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERIC_UPLOAD_ERROR_MESSAGE,
  UPLOAD_HEIC_CONVERSION_ERROR_MESSAGE,
  UPLOAD_IMAGE_READ_ERROR_MESSAGE,
  UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE,
  UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE,
  attachmentMimeTypeForFileName,
  uploadErrorMessage,
  uploadFileValidationError,
  withGenericUploadError,
} from './upload-file.logic';

describe('web upload file policy', () => {
  it('maps every allowed extension to its exact MIME type', () => {
    assert.equal(attachmentMimeTypeForFileName('receipt.pdf'), 'application/pdf');
    assert.equal(attachmentMimeTypeForFileName('receipt.PNG'), 'image/png');
    assert.equal(attachmentMimeTypeForFileName('receipt.jpg'), 'image/jpeg');
    assert.equal(attachmentMimeTypeForFileName('receipt.JPEG'), 'image/jpeg');
  });

  it('accepts the complete attachment matrix', () => {
    for (const file of [
      { name: 'receipt.pdf', type: 'application/pdf' },
      { name: 'receipt.png', type: 'image/png' },
      { name: 'receipt.jpg', type: 'image/jpeg' },
      { name: 'receipt.jpeg', type: 'image/jpeg' },
    ]) {
      assert.equal(uploadFileValidationError(file), null);
    }
  });

  it('rejects SVG, unknown extensions, missing MIME, and MIME spoofing', () => {
    for (const file of [
      { name: 'receipt.svg', type: 'image/svg+xml' },
      { name: 'receipt.jpg.exe', type: 'image/jpeg' },
      { name: 'receipt.jpg', type: '' },
      { name: 'receipt.pdf', type: 'image/jpeg' },
      { name: 'receipt.png', type: 'image/jpeg' },
    ]) {
      assert.notEqual(uploadFileValidationError(file), null);
    }
  });

  it('keeps image-only inputs narrower than general attachments', () => {
    assert.notEqual(uploadFileValidationError({ name: 'signature.pdf', type: 'application/pdf' }, 'image'), null);
    assert.equal(uploadFileValidationError({ name: 'signature.jpeg', type: 'image/jpeg' }, 'image'), null);
  });

  it('translates MIME failures without exposing technical details', async () => {
    await assert.rejects(
      withGenericUploadError(() =>
        withGenericUploadError(async () => {
          throw new Error('File signature does not match the declared MIME type.');
        }),
      ),
      { message: UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE },
    );
    assert.equal(uploadErrorMessage(new Error('mimetype must be one of the allowed values')), UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE);
  });

  it('hides other technical upload failures behind one generic message', () => {
    assert.equal(uploadErrorMessage(new Error('ECONNRESET storage.internal')), GENERIC_UPLOAD_ERROR_MESSAGE);
    assert.equal(uploadErrorMessage(new Error(UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE)), UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE);
  });

  it('keeps a stable machine code while sanitizing the wrapped upload message', async () => {
    const source = Object.assign(new Error('database detail that must stay hidden'), { code: 'extract_ocr_disabled' });
    await assert.rejects(
      withGenericUploadError(async () => { throw source; }),
      (error: unknown) => (error as { code?: unknown }).code === 'extract_ocr_disabled'
        && (error as Error).message === GENERIC_UPLOAD_ERROR_MESSAGE,
    );
  });

  it('gives actionable copy for client-side receipt preparation failures', async () => {
    assert.equal(uploadErrorMessage(new Error('UNSUPPORTED_UPLOAD_FILE')), UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE);
    assert.equal(uploadErrorMessage(new Error('HEIC_DECODE_UNSUPPORTED')), UPLOAD_HEIC_CONVERSION_ERROR_MESSAGE);
    assert.equal(uploadErrorMessage(new Error('IMAGE_DECODE_FAILED')), UPLOAD_IMAGE_READ_ERROR_MESSAGE);
    await assert.rejects(
      withGenericUploadError(() => withGenericUploadError(async () => { throw new Error('IMAGE_DECODE_FAILED'); })),
      { message: UPLOAD_IMAGE_READ_ERROR_MESSAGE },
    );
  });
});

it('keeps the specific receipt replacement refusal through both upload wrappers', async () => {
  const message = 'รายจ่ายนี้บันทึกจ่ายแล้ว เปลี่ยนใบเสร็จหลักไม่ได้ ให้แนบเป็นหลักฐานเพิ่ม';
  for (const source of [
    Object.assign(new Error(message), { code: 'expense_receipt_replace_locked' }),
    Object.assign(new Error('Conflict'), { code: 'expense_receipt_replace_locked', details: { message } }),
  ]) {
    await assert.rejects(withGenericUploadError(() => withGenericUploadError(async () => { throw source; })),
      (error: any) => error.code === 'expense_receipt_replace_locked' && error.message === message && error.details === undefined);
  }
  await assert.rejects(withGenericUploadError(async () => {
    throw Object.assign(new Error('internal storage path'), { code: 'expense_receipt_replace_locked' });
  }), { message: 'รายการนี้อยู่ในสถานะที่เปลี่ยนหรือแนบไฟล์ตรงนี้ไม่ได้ เปิดรายการเพื่อดูขั้นตอนที่ทำได้' });
});
