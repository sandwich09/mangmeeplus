import { E_WHT_WORDS } from './tax.js';
import { EXPENSE_CORRECTION_WORDS, type ExpensePaymentMethod } from './expenses.js';

export const DISBURSEMENT_VOUCHER_MAX_LINES = 30;

export const DISBURSEMENT_VOUCHER_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export type DisbursementVoucherStatus = (typeof DISBURSEMENT_VOUCHER_STATUSES)[number];
export const DISBURSEMENT_VOUCHER_ORIGINS = ['PREPARED', 'DIRECT_PAYMENT', 'REISSUED'] as const;
export type DisbursementVoucherOrigin = (typeof DISBURSEMENT_VOUCHER_ORIGINS)[number];
export const DISBURSEMENT_VOUCHER_PAYEE_BASES = ['SINGLE', 'TAX_ID', 'SAME_NAME', 'PREPARER_CONFIRMED'] as const;
export type DisbursementVoucherPayeeBasis = (typeof DISBURSEMENT_VOUCHER_PAYEE_BASES)[number];
export const DISBURSEMENT_VOUCHER_REVISION_DECISIONS = ['APPROVED', 'RETURNED', 'WITHDRAWN', 'CANCELLED'] as const;
export type DisbursementVoucherRevisionDecision = (typeof DISBURSEMENT_VOUCHER_REVISION_DECISIONS)[number];

/** A sentence template with facts to fill in; kept out of the plain words below, which hold no placeholders. */
const DISBURSEMENT_REMINDER_COOLDOWN_TEMPLATE = 'เพิ่งส่งเตือน {name} ไปเมื่อ {minutes} นาทีที่แล้ว ส่งได้อีกครั้งหลัง {time} น. หรือเลือกผู้อนุมัติคนอื่น';
const DISBURSEMENT_SOURCE_CHANGED_SELF_TEMPLATE = 'รายการ {number} ถูกเปลี่ยนแปลงหลังส่งอนุมัติ ใบนี้จึงอนุมัติไม่ได้ กด "กลับไปแก้" เพื่อตรวจรายการใหม่ หรือยกเลิกใบนี้';
const DISBURSEMENT_SOURCE_CHANGED_RETURN_TEMPLATE = 'รายการ {number} ถูกเปลี่ยนแปลงหลังส่งอนุมัติ ใบนี้จึงอนุมัติไม่ได้ กด "ส่งกลับให้แก้" พร้อมเหตุผลให้ผู้เตรียมตรวจรายการใหม่';

export const DISBURSEMENT_VOUCHER_WORDS = {
  title: 'ใบเตรียมจ่าย/ใบสำคัญจ่าย',
  beforePaid: 'ใบเตรียมจ่าย',
  oncePaid: 'ใบสำคัญจ่าย',
  description: 'ใบเดียว เลขเดียว: ก่อนจ่ายคือรายการที่จะจ่ายให้ผู้รับเงินรายหนึ่งและรออนุมัติ จ่ายแล้วคือใบสรุปว่าจ่ายเงินครั้งนี้เพื่อชำระอะไร',
  directPayment: 'บันทึกจ่ายโดยตรง',
  paymentSourceChangedSelf: 'รายการในใบนี้ถูกเปลี่ยนแปลงหลังอนุมัติ จึงบันทึกจ่ายไม่ได้ กด "กลับไปแก้" เพื่อตรวจรายการใหม่ หรือยกเลิกใบนี้',
  paymentSourceChangedAskEditor: 'รายการในใบนี้ถูกเปลี่ยนแปลงหลังอนุมัติ จึงบันทึกจ่ายไม่ได้ ให้ผู้เตรียมหรือผู้ส่งใบนี้กด "กลับไปแก้" เพื่อตรวจรายการใหม่ แล้วส่งอนุมัติอีกครั้ง',
  returnPermissionRequired: 'เฉพาะผู้มีสิทธิ์อนุมัติที่ไม่ได้เตรียมหรือส่งใบนี้เท่านั้นที่ส่งกลับให้แก้ได้ ให้ผู้เตรียมหรือผู้ส่งกด "กลับไปแก้" แทน',
  returnOwnDenied: 'ผู้อนุมัติที่ไม่ได้เตรียมหรือส่งใบนี้เท่านั้นที่ส่งกลับให้แก้ได้ กด "กลับไปแก้" แทน',
  recoveryOwnerRequired: 'ผู้เตรียมและผู้ส่งไม่ได้ใช้งานร้านนี้แล้ว เฉพาะเจ้าของกิจการที่กลับไปแก้หรือยกเลิกใบได้ ให้เจ้าของกิจการเปิดใบนี้',
  withdrawOthersDenied: 'เฉพาะผู้เตรียมหรือผู้ส่งใบนี้เท่านั้นที่กลับไปแก้ได้ ให้คนนั้นกลับไปแก้ใบนี้',
  cancelOthersDenied: 'เฉพาะผู้เตรียมหรือผู้ส่งใบนี้เท่านั้นที่ยกเลิกใบได้ ให้คนนั้นยกเลิกใบนี้',
  unnamedPayee: 'ไม่มีชื่อผู้รับเงิน',
  webSignInRequired: 'การเตรียมจ่ายใช้บัญชีที่เข้าผ่านไลน์ไม่ได้ ให้เข้าสู่ระบบด้วยบัญชีบนเว็บแล้วลองอีกครั้ง',
  preparePermissionRequired: 'คุณยังไม่มีสิทธิ์เตรียมจ่าย ให้ผู้ดูแลร้านเพิ่มสิทธิ์ก่อนแล้วลองอีกครั้ง',
  sourceQueryInvalid: 'ข้อมูลค้นหารายจ่ายไม่ถูกต้อง ให้เลือกผู้รับเงินหรือสาขา แล้วพิมพ์คำค้นใหม่',
} as const;

export const DISBURSEMENT_VOUCHER_CANCELLATION_WORDS = {
  payment: 'การจ่ายของรายการ {number} ถูกยกเลิก',
  expense: 'เอกสาร {number} ถูกยกเลิก',
} as const;

export const DISBURSEMENT_VOUCHER_PAYEE_BASIS_WORDS = {
  sameNameWarning: 'รายการเหล่านี้ไม่มีเลขผู้เสียภาษี ระบบรวมให้เพราะชื่อร้านตรงกัน โปรดตรวจว่าเป็นร้านเดียวกัน',
  sameNameNote: 'รวมจากชื่อร้านที่ตรงกัน (ไม่มีเลขผู้เสียภาษี)',
  preparerConfirmedNote: 'รวมด้วยการยืนยันของผู้จัดทำ {name}',
} as const;

export const DISBURSEMENT_VOUCHER_STATUS_LABELS: Record<DisbursementVoucherStatus, string> = {
  DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว รอจ่าย', PAID: 'จ่ายแล้ว', CANCELLED: 'ยกเลิกแล้ว',
};
export const DISBURSEMENT_VOUCHER_STATUS_TONES: Record<DisbursementVoucherStatus, 'grey' | 'yellow' | 'blue' | 'green' | 'soft_red'> = {
  DRAFT: 'grey', PENDING_APPROVAL: 'yellow', APPROVED: 'blue', PAID: 'green', CANCELLED: 'soft_red',
};
export type DisbursementExpenseReason = 'reserved' | 'claim' | 'personal_advance' | 'missing_branch' | 'foreign_currency' | 'not_confirmed' | 'no_balance';
export const DISBURSEMENT_EXPENSE_REASON_WORDS = {
  reserved: 'อยู่ในใบเตรียมจ่ายเลขที่ {number} แล้ว',
  reservedWithoutNumber: 'อยู่ในใบเตรียมจ่ายอีกใบที่รออนุมัติ',
  claim: 'รายการนี้อยู่ในใบเบิก ให้จ่ายผ่านใบเบิก',
  personal_advance: 'พนักงานจ่ายร้านไปแล้ว ให้คืนเงินพนักงานผ่านใบเบิก',
  missing_branch: 'รายการนี้ยังไม่มีสาขา เปิดรายจ่ายเพื่อระบุสาขาก่อน',
  foreign_currency: 'รายการนี้ไม่ใช่เงินบาท ยังรวมในใบเตรียมจ่ายไม่ได้',
  not_confirmed: 'รายการนี้ยังไม่ยืนยัน เปิดรายจ่ายและยืนยันก่อน',
  no_balance: 'รายการนี้ไม่มียอดค้างจ่าย ให้เลือกรายการอื่น',
} as const;
export function disbursementExpenseReasonMessage(reason: DisbursementExpenseReason, number?: string | null): string {
  return reason === 'reserved' ? number ? DISBURSEMENT_EXPENSE_REASON_WORDS.reserved.replace('{number}', number)
    : DISBURSEMENT_EXPENSE_REASON_WORDS.reservedWithoutNumber : DISBURSEMENT_EXPENSE_REASON_WORDS[reason];
}

export type DisbursementPayee = {
  allReserved?: boolean;
  payeeKey: string;
  displayName: string;
  taxId: string | null;
  expenseCount: number;
  totalOutstanding: string;
  selectableExpenseCount: number;
};

export const DISBURSEMENT_VOUCHER_PDF_PURPOSE = 'expense.disbursement_voucher.pdf';
export const DISBURSEMENT_VOUCHER_SUPPORTING_PURPOSE = 'expense.disbursement_voucher.supporting';
export const DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG = 'disbursement_voucher_supporting';
export type DisbursementVoucherSupportingFile = { id: string; name: string; mimeType: string; byteSize: number; uploadedByUserId: string; uploadedByName: string | null; uploadedAt: string };
export const DISBURSEMENT_VOUCHER_SLIP_PURPOSE = 'expense.disbursement_voucher.slip';
export const DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE = 'disbursement_voucher';
export const DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG = 'disbursement_voucher_slip';

export const DISBURSEMENT_VOUCHER_ERROR_WORDS = {
  disbursement_ewht_planned_method: E_WHT_WORDS['W-R1'],
  disbursement_reminder_cooldown: 'เพิ่งส่งเตือนผู้อนุมัติคนนี้ไป ยังส่งซ้ำไม่ได้ รอให้ครบหนึ่งชั่วโมงหรือเลือกผู้อนุมัติคนอื่น',
  disbursement_supporting_frozen: 'ใบนี้แก้ไฟล์ประกอบไม่ได้แล้ว เปิดใบนี้ใหม่เพื่อตรวจสถานะ',
  disbursement_supporting_missing: 'ไม่พบไฟล์ประกอบของใบนี้ เปิดใบนี้ใหม่เพื่อตรวจไฟล์',
  disbursement_supporting_invalid: 'เอกสารประกอบการจ่ายต้องเป็นรูปภาพหรือไฟล์ PDF ขนาดไม่เกิน 10 เมกะไบต์ เลือกไฟล์ใหม่',
  disbursement_supporting_not_owned: 'ไฟล์นี้ยังแนบกับใบนี้ไม่ได้ เลือกไฟล์แล้วอัปโหลดใหม่',
  disbursement_slip_missing: 'ใบนี้ยังไม่มีหลักฐานการจ่าย เปิดใบนี้เพื่อตรวจไฟล์ที่แนบ',
  disbursement_slip_invalid: 'หลักฐานการจ่ายต้องเป็นรูปภาพหรือไฟล์ PDF ขนาดไม่เกิน 10 เมกะไบต์ เลือกไฟล์ใหม่',
  disbursement_slip_not_owned: 'หลักฐานการจ่ายนี้ไม่ได้อัปโหลดสำหรับใบนี้ หรือยังอัปโหลดไม่เสร็จ อัปโหลดหลักฐานการจ่ายของใบนี้ใหม่',
  disbursement_slip_status: 'สถานะของใบนี้ยังแนบหลักฐานการจ่ายไม่ได้ แนบได้เมื่ออนุมัติแล้ว รอจ่าย หรือจ่ายแล้ว เปิดใบตรวจสถานะอีกครั้ง',
  disbursement_file_link_outside: 'ไฟล์ของใบเตรียมจ่าย/ใบสำคัญจ่ายใช้กับเอกสารอื่นไม่ได้ อัปโหลดไฟล์ใหม่สำหรับเอกสารนั้น',
  disbursement_slip_link_conflict: 'ไฟล์นี้ใช้กับเอกสารอื่นอยู่แล้ว จึงใช้เป็นหลักฐานการจ่ายของใบนี้ไม่ได้ อัปโหลดหลักฐานการจ่ายใหม่',
  disbursement_file_general_download_denied: 'ไฟล์ของใบเตรียมจ่าย/ใบสำคัญจ่ายต้องเปิดจากใบที่มีไฟล์นี้ เปิดใบแล้วดูไฟล์จากที่นั่น',
  disbursement_file_retained: 'ไฟล์ของใบเตรียมจ่าย/ใบสำคัญจ่ายลบจากหน้านี้ไม่ได้ ตรวจไฟล์จากใบที่เกี่ยวข้อง',
  disbursement_changed_retry: 'มีการทำรายการกับใบนี้หรือรายจ่ายในใบพร้อมกัน ระบบยังไม่ได้บันทึกสิ่งที่คุณเพิ่งทำ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  disbursement_payment_retry: 'บันทึกไม่สำเร็จ ยังไม่มีการบันทึกจ่ายรายการใด ลองอีกครั้ง',
  disbursement_account_number_invalid: 'เลขบัญชีผู้รับเงินต้องเป็นตัวเลข 6 ถึง 20 หลัก แก้เลขบัญชีแล้วลองอีกครั้ง',
  disbursement_account_bank_required: 'ยังไม่ได้ระบุธนาคารของบัญชีผู้รับเงิน เลือกธนาคารก่อนบันทึก',
  disbursement_account_source_denied: 'เปิดบัญชีจากใบเดิมไม่ได้ เลือกใช้บัญชีอื่นแล้วกรอกใหม่',
  disbursement_account_source_mismatch: 'บัญชีจากใบเดิมไม่ตรงกับผู้รับเงินนี้ เลือกใช้บัญชีอื่นแล้วกรอกใหม่',
  disbursement_account_missing: 'ใบนี้ไม่ได้ระบุบัญชีผู้รับเงิน เปิดใบนี้เพื่อตรวจวิธีจ่าย',
  disbursement_print_unsubmitted: 'ใบนี้ยังไม่ได้ส่งอนุมัติ จึงยังพิมพ์ไม่ได้ บันทึกแล้วส่งอนุมัติก่อน',
  disbursement_file_pending: 'บันทึกจ่ายแล้ว เอกสารกำลังจัดทำ',
  disbursement_signature_unavailable: 'อ่านลายเซ็นของคุณไม่ได้ ลองอีกครั้ง',
  disbursement_file_unavailable: 'ยังจัดทำไฟล์ใบสำคัญจ่ายไม่สำเร็จ การจ่ายและเลขใบยังอยู่ ลองดาวน์โหลดอีกครั้ง',
  expense_payment_cancelled_replay: EXPENSE_CORRECTION_WORDS.paymentReplayCancelled,
  disbursement_issue_claim: 'รายการนี้จ่ายผ่านใบเบิก จึงออกใบสำคัญจ่ายจากหน้านี้ไม่ได้ ดูหลักฐานการจ่ายได้ที่ใบเบิก',
  disbursement_issue_payment_cancelled: 'การจ่ายรายการนี้ถูกยกเลิกแล้ว จึงออกใบสำคัญจ่ายไม่ได้ เปิดรายจ่ายแล้วเลือกการจ่ายที่ยังมีผล',
  disbursement_issue_payment_not_found: 'ไม่พบการจ่ายที่เลือก ให้เปิดรายจ่ายใหม่และเลือกการจ่ายที่ยังมีผล',
  disbursement_reissue_empty: 'ไม่มีการจ่ายที่ยังมีผลเหลืออยู่ในใบนี้ จึงไม่ต้องออกใบใหม่',
  disbursement_invalid_input: 'ข้อมูลใบเตรียมจ่ายไม่ถูกต้อง ให้ตรวจรายการ วันที่และวิธีจ่าย แล้วลองบันทึกใหม่',
  disbursement_lines_required: 'ยังไม่ได้เลือกรายจ่าย ให้เลือกอย่างน้อย 1 รายการก่อนบันทึก',
  disbursement_too_many_lines: `ใบเตรียมจ่ายหนึ่งใบรวมได้ไม่เกิน ${DISBURSEMENT_VOUCHER_MAX_LINES} รายการ แบ่งรายการที่เหลือไปทำอีกใบ`,
  disbursement_duplicate_expense: 'เลือกรายจ่ายรายการเดิมซ้ำในใบเดียวกันไม่ได้ ให้เอารายการที่ซ้ำออกก่อน',
  disbursement_expense_unreadable: 'ไม่พบรายจ่ายที่เลือกหรือคุณไม่มีสิทธิ์อ่าน ให้เลือกรายจ่ายที่เปิดดูได้แล้วลองอีกครั้ง',
  disbursement_branch_mismatch: 'รายการที่เลือกอยู่คนละสาขา หนึ่งใบรวมได้เฉพาะรายการของสาขาเดียว ให้เลือกรายการจากสาขาเดียวกัน',
  disbursement_payee_confirmation_required: 'รายการที่เลือกมีชื่อหรือเลขผู้เสียภาษีของผู้ขายไม่ตรงกัน ถ้าเป็นผู้รับเงินรายเดียวกัน ให้ติ๊กยืนยันก่อน',
  disbursement_amount_invalid: 'ยอดของรายการ {number} ต้องมากกว่า 0 และไม่เกินยอดค้างจ่าย {outstanding} แก้ยอดแล้วบันทึกอีกครั้ง',
  disbursement_total_overflow: 'ยอดรวมของใบเตรียมจ่ายสูงเกินกว่าที่บันทึกได้ ให้แบ่งรายการไปทำอีกใบ',
  disbursement_version_conflict: 'ใบนี้ถูกแก้ไขจากที่อื่นแล้ว เปิดหน้านี้ใหม่ก่อนบันทึก',
  disbursement_not_draft: 'ใบนี้ไม่ใช่ร่าง จึงแก้ไขหรือลบไม่ได้ ให้เปิดใบเพื่อตรวจสถานะก่อน',
  disbursement_numbered_delete: 'ใบที่มีเลขแล้วลบไม่ได้ ให้ใช้ยกเลิกแทน',
  disbursement_command_conflict: 'ข้อมูลไม่ตรงกับคำสั่งที่บันทึกไว้ ให้เปิดใบตรวจข้อมูล แล้วใช้คำสั่งใหม่ถ้าต้องการแก้ไข',
  disbursement_permission_denied: 'คุณยังไม่มีสิทธิ์ทำรายการนี้ ให้ผู้ดูแลร้านเพิ่มสิทธิ์ก่อนแล้วลองอีกครั้ง',
  disbursement_line_session_denied: DISBURSEMENT_VOUCHER_WORDS.webSignInRequired,
  disbursement_not_found: 'ไม่พบใบเตรียมจ่ายที่เปิดดูได้ ให้กลับไปหน้ารายการแล้วเลือกใบใหม่',
  disbursement_status_changed: 'สถานะของใบนี้เปลี่ยนไปแล้ว เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด',
  disbursement_approver_ineligible: 'ผู้อนุมัติที่เลือกไม่มีสิทธิ์อนุมัติใบของสาขานี้แล้ว เลือกใหม่',
  disbursement_return_reason_required: 'เหตุผลที่ส่งกลับให้แก้สั้นเกินไป กรอกอย่างน้อย 3 ตัวอักษร',
  disbursement_cancel_reason_required: 'เหตุผลที่ยกเลิกสั้นเกินไป กรอกอย่างน้อย 3 ตัวอักษร',
  disbursement_source_changed: DISBURSEMENT_SOURCE_CHANGED_RETURN_TEMPLATE,
  disbursement_payment_source_changed: DISBURSEMENT_VOUCHER_WORDS.paymentSourceChangedAskEditor,
  disbursement_payment_key_conflict: 'พบรายการจ่ายของใบนี้อยู่แล้ว แต่ใบยังไม่แสดงว่าจ่ายแล้ว เปิดใบนี้ใหม่และตรวจประวัติการจ่ายก่อนลองอีกครั้ง',
  disbursement_payment_method_required: 'เลือกวิธีจ่ายก่อนบันทึก',
  disbursement_payment_total_changed: 'ยอดรวมของใบไม่ตรงกับรายการที่อนุมัติ จึงบันทึกจ่ายไม่ได้ ให้ผู้จัดทำหรือผู้อนุมัติตรวจยอดก่อนส่งอนุมัติอีกครั้ง',
  disbursement_payee_changed: 'ข้อมูลผู้รับเงินของรายการเปลี่ยนไป ให้กลับไปแก้ใบและตรวจผู้รับเงินก่อนส่งอนุมัติ',
  disbursement_branch_changed: 'สาขาของรายจ่ายเปลี่ยนไป ให้กลับไปแก้ใบและตรวจสาขาของรายการก่อนส่งอนุมัติ',
  disbursement_number_unavailable: 'ยังออกเลขใบเตรียมจ่ายไม่ได้ ให้ผู้ดูแลตรวจชุดเลขเอกสารแล้วลองส่งอีกครั้ง',
  disbursement_expense_reserved: DISBURSEMENT_EXPENSE_REASON_WORDS.reservedWithoutNumber,
  disbursement_expense_claim: DISBURSEMENT_EXPENSE_REASON_WORDS.claim,
  disbursement_expense_personal_advance: DISBURSEMENT_EXPENSE_REASON_WORDS.personal_advance,
  disbursement_expense_missing_branch: DISBURSEMENT_EXPENSE_REASON_WORDS.missing_branch,
  disbursement_expense_foreign_currency: DISBURSEMENT_EXPENSE_REASON_WORDS.foreign_currency,
  disbursement_expense_not_confirmed: DISBURSEMENT_EXPENSE_REASON_WORDS.not_confirmed,
  disbursement_expense_no_balance: DISBURSEMENT_EXPENSE_REASON_WORDS.no_balance,
} as const;
export type DisbursementVoucherErrorCode = keyof typeof DISBURSEMENT_VOUCHER_ERROR_WORDS;
export function disbursementVoucherError(code: DisbursementVoucherErrorCode, facts: Record<string, string> = {}) {
  const template = code === 'disbursement_reminder_cooldown' && facts.name ? (facts.minutes === '0' ? DISBURSEMENT_REMINDER_COOLDOWN_TEMPLATE.replace('เมื่อ {minutes} นาทีที่แล้ว', 'เมื่อสักครู่') : DISBURSEMENT_REMINDER_COOLDOWN_TEMPLATE) : code === 'disbursement_payment_source_changed' && facts.mayWithdraw === 'true' ? DISBURSEMENT_VOUCHER_WORDS.paymentSourceChangedSelf : code === 'disbursement_source_changed' && facts.mayWithdraw === 'true' ? DISBURSEMENT_SOURCE_CHANGED_SELF_TEMPLATE : DISBURSEMENT_VOUCHER_ERROR_WORDS[code];
  const message = template.replace(/\{(\w+)\}/g, (_, key: string) => facts[key] ?? '');
  // Bare-code readers use the generic sentence; the command names the affected expense.
  return { code, message: code === 'disbursement_payment_source_changed' && facts.number ? message.replace('รายการในใบนี้', `รายการ ${facts.number} `) : message };
}

export type CreateDisbursementVoucherDraftInput = {
  commandId: string;
  lines: { expenseId: string; amount: string }[];
  payeeName?: string;
  payeeBankName?: string; payeeAccountName?: string; payeeAccountNumber?: string; payeeAccountFromVoucherId?: string;
  payeeConfirmed?: boolean;
  plannedPayDate?: string;
  plannedMethod?: ExpensePaymentMethod;
  note?: string;
};
export type UpdateDisbursementVoucherDraftInput = CreateDisbursementVoucherDraftInput & { expectedVersion: number };
export type DisbursementVoucherCommandInput = { commandId: string; expectedVersion: number };
export type SubmitDisbursementVoucherInput = DisbursementVoucherCommandInput & { requestedApproverUserId?: string; approveNow?: boolean };
export type RemindDisbursementVoucherInput = DisbursementVoucherCommandInput & { approverUserId: string };
export type EndDisbursementVoucherInput = DisbursementVoucherCommandInput & { reason?: string };
export type IssueDisbursementVoucherInput = { commandId: string; expenseId: string; paymentId: string };
export type ReissueDisbursementVoucherInput = { commandId: string };
export type PayDisbursementVoucherInput = DisbursementVoucherCommandInput & { paidDate?: string; paymentMethod?: ExpensePaymentMethod; paidFromRef?: string; slipAttachmentId?: string };
export type DisbursementVoucherLifecycleAction = 'submit' | 'approve' | 'return' | 'withdraw' | 'cancel' | 'pay' | 'remind';
export type DisbursementVoucherActions = Record<'edit' | 'delete' | 'submit' | 'submitAndApprove' | 'approve' | 'return' | 'withdraw' | 'cancel' | 'pay' | 'remind', boolean>;
export type DisbursementVoucherPrimaryAction = 'submit' | 'approve' | 'pay' | 'view';
export type DisbursementVoucherHeader = {
  id: string; companyId: string; branchId: string; documentNumber: string | null; revision: number; status: DisbursementVoucherStatus;
  origin: DisbursementVoucherOrigin; replacesVoucherId: string | null;
  payeeName: string; payeeTaxId: string | null; payeeBranchCode: string | null; payeeBasis: DisbursementVoucherPayeeBasis;
  payeeConfirmedByUserId: string | null; preparedByUserId: string;
  payeeBankName: string | null; payeeAccountName: string | null; payeeAccountLast4: string | null; documentFileReady?: boolean;
  plannedPayDate: string | null; plannedMethod: ExpensePaymentMethod | null; paidDate: string | null;
  note: string | null; totalAmount: string; currency: string; version: number; createdAt: string; updatedAt: string;
  lastReminderToUserId?: string | null; lastReminderAt?: string | null; reminderCount?: number;
  submittedByUserId: string | null; submittedAt: string | null; requestedApproverUserId: string | null;
  approvedByUserId: string | null; approvedAt: string | null; selfApproved: boolean;
  returnedByUserId: string | null; returnedAt: string | null; returnReason: string | null;
  returnedByName?: string | null; cancelledByName?: string | null;
  cancelledAfterPaid: boolean; cancelledByUserId: string | null; cancelledAt: string | null; cancelReason: string | null; cancelSourceReason: string | null;
  paidRecordedAt: string | null; paidByUserId: string | null; paidMethod: ExpensePaymentMethod | null; paidFromRef: string | null;
};
export type DisbursementVoucherListQuery = { order?: 'newest' | 'oldest'; q?: string; status?: DisbursementVoucherStatus; branchId?: string; page?: number; pageSize?: number };
export type DisbursementVoucherListRow = Pick<DisbursementVoucherHeader, 'id' | 'documentNumber' | 'status' | 'origin' | 'payeeName' | 'plannedPayDate' | 'paidDate' | 'totalAmount' | 'createdAt'> & {
  canDelete: boolean; amountInEffect?: string | null; lineCount: number; primaryAction: DisbursementVoucherPrimaryAction;
};
export type DisbursementVoucherListPage = { data: DisbursementVoucherListRow[]; counts: Record<DisbursementVoucherStatus, number>; sums: Record<DisbursementVoucherStatus, string>; total: number; page: number; pageSize: number };
export type DisbursementVoucherDetail = {
  hasOwnSignature?: boolean;
  supportingFiles?: DisbursementVoucherSupportingFile[];
  header: DisbursementVoucherHeader;
  slip: { attachmentId: string; attachedByUserId: string; attachedByName: string | null; attachedAt: string } | null;
  canAttachSlip: boolean;
  lastReminderToName: string | null; nextReminderAt: string | null;
  canReissue: boolean; sourceChangedAfterPaid: boolean;
  reissuedVoucher: { id: string | null; documentNumber: string } | null; replacesVoucher: { id: string | null; documentNumber: string } | null;
  payeeConfirmerName: string | null;
  returnedByName: string | null; cancelledByName: string | null;
  preparerActive?: boolean; senderActive?: boolean;
  preparerName: string | null; submittedByName: string | null; requestedApproverName: string | null; approvedByName: string | null; paidByName: string | null;
  lines: (Pick<DisbursementPayableExpense, 'expenseId' | 'expenseNumber' | 'expenseDate' | 'vendorName' | 'vendorTaxId' | 'branchId' | 'grandTotalAmount' | 'whtAmount' | 'netPayableAmount' | 'outstandingAmount'> & { amount: string; position: number; expensePaymentId: string | null; paymentInEffect: boolean; description?: string | null; vendorInvoiceNumber?: string | null;
    whtRemittance: import('./tax.js').WhtRemittance | null; eWhtReducedRateApplied: boolean;
    withholdingCertificate: { state: 'NONE' | 'PENDING' | 'E_WHT' | 'SYSTEM_ISSUED' | 'EXTERNAL_LINKED'; number: string | null } })[];
  revisions: { revision: number; snapshotJson: unknown; snapshotHash: string; requestedApproverUserId: string | null; requestedApproverName: string | null; submittedByUserId: string; submittedByName: string | null; submittedAt: string; decision: DisbursementVoucherRevisionDecision | null; decidedByUserId: string | null; decidedByName: string | null; decidedAt: string | null; decisionReason: string | null;
    postApprovalAction: 'WITHDRAWN' | 'CANCELLED' | null; postApprovalByUserId: string | null; postApprovalByName: string | null; postApprovalAt: string | null; postApprovalReason: string | null }[];
  actions: DisbursementVoucherActions;
};
export type DisbursementPayeeQuery = { search?: string; branchId?: string; page?: number; pageSize?: number };
export type DisbursementPayeePage = { data: DisbursementPayee[]; total: number; page: number; pageSize: number; excludedExpenses?: Partial<Record<DisbursementExpenseReason, number>> };
export type DisbursementPayableExpenseQuery = { payeeKey?: string; search?: string; branchId?: string };
export type DisbursementExpenseReservation = { voucherId?: string | null; documentNumber: string | null; preparerName: string | null };
export type DisbursementPayableExpense = {
  whtRemittance: import('./tax.js').WhtRemittance | null;
  payeeKey: string;
  payeeKeyKind: 'TAX_ID' | 'NAME' | null;
  expenseId: string;
  expenseNumber: string | null;
  expenseDate: string;
  vendorName: string | null;
  vendorTaxId: string | null;
  branchId: string | null;
  description: string | null;
  vendorInvoiceNumber: string | null;
  branchName: string | null;
  grandTotalAmount: string;
  whtAmount: string;
  netPayableAmount: string;
  outstandingAmount: string;
  selectable: boolean;
  reasonCode: DisbursementExpenseReason | null;
  reservation: DisbursementExpenseReservation | null;
};

export const DISBURSEMENT_VOUCHER_NOTICE_WORDS = {
  pendingTitle: 'รออนุมัติ: ใบเตรียมจ่ายเลขที่ {number}',
  pendingBody: '{preparer} ส่งใบเตรียมจ่ายมาให้คุณตรวจและอนุมัติ จ่ายให้ {payee} ยอด {total} บาท',
  reminderTitle: 'เตือนอีกครั้ง: ใบเตรียมจ่ายเลขที่ {number} รออนุมัติ',
  reminderBody: '{preparer} ขอให้คุณตรวจและอนุมัติใบเตรียมจ่ายนี้ จ่ายให้ {payee} ยอด {total} บาท',
  approvedCannotPayBody: '{approver} อนุมัติแล้ว รอผู้มีสิทธิ์บันทึกจ่าย',
  payerTitle: 'รอคุณบันทึกจ่าย: ใบเตรียมจ่ายเลขที่ {number}',
  payerBody: 'จ่ายเงินให้ {payee} ยอด {total} บาท แล้วบันทึกว่าจ่ายแล้วที่ใบนี้',
  approvedTitle: 'อนุมัติแล้ว รอจ่าย: ใบเตรียมจ่ายเลขที่ {number}',
  approvedBody: '{approver} อนุมัติแล้ว จ่ายเงินให้ {payee} ยอด {total} บาท แล้วบันทึกว่าจ่ายแล้วที่ใบนี้',
  returnedTitle: 'ส่งกลับให้แก้: ใบเตรียมจ่ายเลขที่ {number}',
  returnedBody: '{approver} ส่งกลับให้แก้ เหตุผล: {reason} แก้แล้วส่งใหม่ได้ด้วยเลขที่เดิม',
  withdrawnBody: '{actor} นำใบกลับไปแก้{reasonSuffix} แก้แล้วส่งใหม่ได้ด้วยเลขที่เดิม',
  paidTitle: 'จ่ายแล้ว: ใบสำคัญจ่ายเลขที่ {number}',
  paidBody: '{payer} บันทึกว่าจ่ายให้ {payee} ยอด {total} บาท เมื่อ {date} ใบนี้เป็นใบสำคัญจ่ายแล้ว',
  cancelledTitle: 'ยกเลิก: ใบเลขที่ {number}',
  cancelledBody: '{actor} ยกเลิกใบนี้ เหตุผล: {reason} รายจ่ายในใบกลับไปเป็นยังไม่จ่าย',
  cancelledPartialBody: '{actor} ยกเลิกใบนี้ เหตุผล: {reason} การจ่ายที่บันทึกไว้ก่อนหน้านี้ยังอยู่',
  cancelledAfterPaidBody: 'ใบนี้ถูกยกเลิกเพราะ{reason} การจ่ายรายการอื่นในใบยังอยู่ ออกใบใหม่สำหรับการจ่ายที่เหลือได้ที่หน้าของใบ',
  cancelledNoPaymentBody: 'ใบนี้ถูกยกเลิกเพราะ{reason} ไม่มีการจ่ายที่ยังมีผลเหลืออยู่ในใบนี้',
} as const;


/** Exact four-decimal payout of the payments still in effect; source tax is never deducted again. */
export function disbursementVoucherPaymentAmount(original: string, lines: readonly { amount: string; paymentInEffect: boolean }[]) {
  const scaled = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  };
  const total = lines.filter(line => line.paymentInEffect).reduce((sum, line) => sum + scaled(line.amount), 0n);
  return { amount: `${total / 10000n}.${String(total % 10000n).padStart(4, '0')}`, excludesCancelled: total !== scaled(original) };
}

export type DisbursementPayeeAccount = { bankName: string | null; accountName: string | null; last4: string; sourceVoucherId: string };
