export const ATTACHMENT_UPLOAD_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
export const IMAGE_UPLOAD_ACCEPT = '.png,.jpg,.jpeg,image/png,image/jpeg';
export const GENERIC_UPLOAD_ERROR_MESSAGE = 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง';
export const UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE =
  'ไฟล์ที่อัปโหลดไม่ตรงกับประเภทไฟล์ที่ระบุ กรุณาตรวจสอบและอัปโหลดไฟล์ที่ถูกต้อง';

const MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

type UploadFileDescriptor = Pick<File, 'name' | 'type'>;
export type UploadFilePolicy = 'attachment' | 'image';

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
    || error.message.startsWith('รองรับเฉพาะไฟล์ ')
  ) {
    return error.message;
  }
  return /mime[\s_-]*type/i.test(error.message)
    ? UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE
    : GENERIC_UPLOAD_ERROR_MESSAGE;
}

export async function withGenericUploadError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(uploadErrorMessage(error));
  }
}
