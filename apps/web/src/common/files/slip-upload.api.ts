import { REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES } from '@watchdog-bms/contracts';
import { authedApiFetch } from '../api/authed-fetch';
import { prepareAttachmentUpload, uploadSourceFileValidationError } from './upload-file.logic';
import { uploadReceiptFile } from '@/features/expenses/expenses.api';

/** The claim's three-step uploader, shared with document slips. */
export async function uploadPaymentSlip(endpoint: string, file: File, invalid: { code: string; message: string }, suppressErrorToast = false): Promise<string> {
  const refuse = () => { throw Object.assign(new Error(invalid.message), { code: invalid.code }); };
  if (uploadSourceFileValidationError(file) || file.size <= 0 || file.size > REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES) refuse();
  const prepared = await prepareAttachmentUpload(file);
  if (prepared.size > REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES) refuse();
  const intent = await authedApiFetch<{ attachmentId: string; uploadUrl: string; uploadMethod: string; uploadHeaders: Record<string, string> }>(
    `${endpoint}/slip-upload-intent`, { method: 'POST', body: JSON.stringify({ originalFileName: prepared.name, mimeType: prepared.type, byteSize: prepared.size }), suppressErrorToast });
  await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, prepared, intent.uploadHeaders);
  await authedApiFetch(`${endpoint}/slip-uploads/${encodeURIComponent(intent.attachmentId)}/complete`, {
    method: 'POST', body: JSON.stringify({ byteSize: prepared.size }), suppressErrorToast,
  });
  return intent.attachmentId;
}
