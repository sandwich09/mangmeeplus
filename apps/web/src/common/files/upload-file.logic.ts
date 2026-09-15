import { translateApiError } from '../api/api-error-message';

export const ATTACHMENT_UPLOAD_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.jpe,.heic,.heif,.gif,application/pdf,image/png,image/jpeg,image/jpg,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/gif';
export const IMAGE_UPLOAD_ACCEPT =
  '.png,.jpg,.jpeg,.jpe,.heic,.heif,.gif,image/png,image/jpeg,image/jpg,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/gif';
export const GENERIC_UPLOAD_ERROR_MESSAGE = 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง';
export const UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE =
  'ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ กรุณาเลือกไฟล์ใหม่ หรือบันทึกเป็น PDF/JPG/PNG แล้วลองอีกครั้ง';
export const UPLOAD_IMAGE_READ_ERROR_MESSAGE =
  'ระบบอ่านรูปนี้ไม่ได้ กรุณาเลือกรูปใหม่ หรือบันทึกเป็น JPG/PNG แล้วลองอีกครั้ง';
export const UPLOAD_HEIC_CONVERSION_ERROR_MESSAGE =
  'แปลงรูป HEIC/HEIF ไม่สำเร็จ กรุณาบันทึกรูปเป็น JPG/PNG แล้วลองอีกครั้ง';
export const UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE =
  'รองรับเฉพาะไฟล์ PDF, JPG/JPEG, PNG, HEIC/HEIF และ GIF';

const MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

type UploadFileDescriptor = Pick<File, 'name' | 'type'>;
export type UploadFilePolicy = 'attachment' | 'image';
export type UploadSourceFileKind = 'image' | 'pdf' | 'heic' | 'unsupported';

/** Browser sources are normalized before the strict server upload contract below. */
export function classifyUploadSourceFile(file: UploadFileDescriptor, policy: UploadFilePolicy = 'attachment'): UploadSourceFileKind {
  const mime = file.type.toLowerCase();
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (extension === 'pdf' && (!mime || mime === 'application/pdf')) return policy === 'image' ? 'unsupported' : 'pdf';
  if (['heic', 'heif'].includes(extension ?? '') && (!mime || ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'].includes(mime))) return 'heic';
  if (
    (['jpg', 'jpeg', 'jpe'].includes(extension ?? '') && (!mime || mime === 'image/jpeg' || mime === 'image/jpg'))
    || (extension === 'png' && (!mime || mime === 'image/png'))
    || (extension === 'gif' && (!mime || mime === 'image/gif'))
  ) return 'image';
  return 'unsupported';
}

export function uploadSourceFileValidationError(file: UploadFileDescriptor, policy: UploadFilePolicy = 'attachment'): string | null {
  return classifyUploadSourceFile(file, policy) === 'unsupported'
    ? policy === 'image' ? 'รองรับเฉพาะไฟล์ JPG/JPEG, PNG, HEIC/HEIF และ GIF' : UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE
    : null;
}

export async function prepareAttachmentUpload(file: File, policy: UploadFilePolicy = 'attachment'): Promise<File> {
  return withGenericUploadError(async () => {
    // Reuse the established browser decoder; load it only when a user selects a file.
    const { prepareReceiptFile, prepareSignatureFile } = await import('@/features/expenses/expense-upload.logic');
    const prepared = await (policy === 'image' ? prepareSignatureFile(file) : prepareReceiptFile(file));
    assertAllowedUploadFile(prepared.file, policy);
    return prepared.file;
  });
}

export function attachmentMimeTypeForFileName(fileName: string): string | undefined {
  const extension = /^.+\.([^.]+)$/.exec(fileName.trim())?.[1]?.toLowerCase();
  return extension ? MIME_TYPE_BY_EXTENSION[extension] : undefined;
}

export function uploadFileValidationError(
  file: UploadFileDescriptor,
  policy: UploadFilePolicy = 'attachment',
): string | null {
  const expectedMimeType = attachmentMimeTypeForFileName(file.name);
  if (!expectedMimeType || (policy === 'image' && expectedMimeType === 'application/pdf')) {
    return policy === 'image'
      ? 'รองรับเฉพาะไฟล์ PNG, JPG และ JPEG'
      : 'รองรับเฉพาะไฟล์ PDF, PNG, JPG และ JPEG';
  }
  if (file.type.toLowerCase() !== expectedMimeType) {
    return UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE;
  }
  return null;
}

export function assertAllowedUploadFile(
  file: UploadFileDescriptor,
  policy: UploadFilePolicy = 'attachment',
): void {
  const error = uploadFileValidationError(file, policy);
  if (error) throw new Error(error);
}

export function uploadErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC_UPLOAD_ERROR_MESSAGE;
  if (
    error.message === GENERIC_UPLOAD_ERROR_MESSAGE
    || error.message === UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE
    || error.message === UPLOAD_IMAGE_READ_ERROR_MESSAGE
    || error.message === UPLOAD_HEIC_CONVERSION_ERROR_MESSAGE
    || error.message === UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE
    || error.message.startsWith('รองรับเฉพาะไฟล์ ')
  ) {
    return error.message;
  }
  if (error.message === 'HEIC_DECODE_UNSUPPORTED') return UPLOAD_HEIC_CONVERSION_ERROR_MESSAGE;
  if (['IMAGE_DECODE_FAILED', 'IMAGE_ENCODE_FAILED', 'CANVAS_UNSUPPORTED'].includes(error.message)) {
    return UPLOAD_IMAGE_READ_ERROR_MESSAGE;
  }
  if (error.message === 'UNSUPPORTED_UPLOAD_FILE') return UPLOAD_RECEIPT_SOURCE_UNSUPPORTED_ERROR_MESSAGE;
  if (/mime[\s_-]*type/i.test(error.message)) return UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE;
  // Every other server answer used to collapse into "ระบบขัดข้อง" before it ever reached the
  // translator — a quarantined scan, a size limit, a rate limit and a checksum mismatch all read
  // the same, so the only move the message suggested was retrying the identical bytes. Ask the
  // translator first — by code as well as message, since `withGenericUploadError` rewraps the
  // error and the code would otherwise be dropped — and keep the generic line as a real last resort.
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    const byCode = translateApiError(code);
    if (byCode) return byCode;
  }
  return translateApiError(error.message) ?? GENERIC_UPLOAD_ERROR_MESSAGE;
}

export async function withGenericUploadError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const safe = new Error(uploadErrorMessage(error));
    // Keep only the stable machine code. Screens still receive sanitized Thai copy, while a
    // feature allowlist (for example statement OCR governance) can choose the right recovery path.
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string') Object.assign(safe, { code });
    throw safe;
  }
}
