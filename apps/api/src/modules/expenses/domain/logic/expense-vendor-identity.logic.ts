/**
 * The two printed-vendor-identity fields that need a rule before they touch a column, kept out of
 * the DTO layer on purpose: `PATCH :expenseId` and `PATCH :expenseId/review-fields` both take the
 * imported contract type, which reaches the global ValidationPipe as metatype `Object` and is
 * skipped (`expense.dtos.ts` header), so a decorator there would validate nothing. Every writer —
 * web review, LINE, internal reviewer saves — goes through `UpdateExpenseDraftUseCase`, which is
 * where this runs.
 *
 * Pure and error-returning like the other `*-validation.logic` here; the use case turns the result
 * into the module's `BadRequestException({ code, message })`.
 */

// CON-8 lives in one place: `vendor-counterparty-match.logic.ts` owns `normalizeBranchCode`, and
// storage must agree with the vendor matcher on what a branch code is, or the same shop matches
// under one path and misses under the other. (Cross-module domain import, same direction the
// expenses DTOs already take.)
import { normalizeBranchCode } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';

/** Vendor address spec §6: the column is VARCHAR(500). §8 says an over-long address is refused with
 *  a way forward ("ตัดให้สั้นลง"), never silently truncated — the tail of an address is evidence. */
export const EXPENSE_VENDOR_ADDRESS_MAX_LENGTH = 500;

export type ExpenseVendorIdentityInput = {
  vendorNameSnapshot?: string;
  vendorBranchCodeSnapshot?: string | null;
  vendorAddressSnapshot?: string | null;
};

export type ExpenseVendorIdentityResult = {
  /** Exactly the keys the caller supplied, normalized: blank is `null`, never `''` or `'00000'`. */
  fields: ExpenseVendorIdentityInput;
  error: { code: string; message: string } | null;
};

export function expenseVendorIdentityFields(input: ExpenseVendorIdentityInput): ExpenseVendorIdentityResult {
  const fields: ExpenseVendorIdentityInput = {};
  if (input.vendorNameSnapshot !== undefined) {
    if (typeof input.vendorNameSnapshot !== 'string') return { fields, error: { code: 'EXPENSE_VENDOR_NAME_INVALID', message: 'ชื่อผู้ขายไม่ถูกต้อง กรอกชื่อใหม่' } };
    const name = input.vendorNameSnapshot.trim();
    if (name.length > 200) return { fields, error: { code: 'EXPENSE_VENDOR_NAME_TOO_LONG', message: 'ชื่อผู้ขายยาวเกิน 200 ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง' } };
    fields.vendorNameSnapshot = name;
  }
  if (input.vendorBranchCodeSnapshot !== undefined) {
    const branchCode = normalizeBranchCode(input.vendorBranchCodeSnapshot);
    // The matcher may normalize a malformed code to null silently; a form may not. D5: the one
    // thing this must never do is drop what somebody typed without saying so.
    if (!branchCode && String(input.vendorBranchCodeSnapshot ?? '').trim()) {
      return { fields, error: { code: 'EXPENSE_VENDOR_BRANCH_CODE_INVALID',
        message: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00000 สำหรับสำนักงานใหญ่ หรือเว้นว่างไว้ก็ได้' } };
    }
    fields.vendorBranchCodeSnapshot = branchCode;
  }
  if (input.vendorAddressSnapshot !== undefined) {
    const address = (input.vendorAddressSnapshot ?? '').trim();
    if (address.length > EXPENSE_VENDOR_ADDRESS_MAX_LENGTH) {
      return { fields, error: { code: 'EXPENSE_VENDOR_ADDRESS_TOO_LONG',
        message: `ที่อยู่ผู้ขายยาวเกิน ${EXPENSE_VENDOR_ADDRESS_MAX_LENGTH} ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง` } };
    }
    fields.vendorAddressSnapshot = address || null;
  }
  return { fields, error: null };
}
