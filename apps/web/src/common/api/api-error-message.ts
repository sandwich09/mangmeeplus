import { REIMBURSEMENT_PROJECTION_VOIDED_MESSAGE, DISBURSEMENT_VOUCHER_ERROR_WORDS, REIMBURSEMENT_PAYOUT_NAME_MISMATCH_THIRD_PARTY, REIMBURSEMENT_SAVED_PAYOUT_ERROR_WORDS } from '@watchdog-bms/contracts';
import { WHT_EXTERNAL_FILE, whtPayerIdentityMissingMessage, WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE, WHT_EXTERNAL_RECORD_WORDS, EXPENSE_VOID_CERTIFICATE_WORDS, REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS, WHT_CERTIFICATE_CORRECTION_WORDS, reimbursementCertificateCancellationMessage } from '@watchdog-bms/contracts';
import { EXPENSE_CORRECTION_WORDS, expenseCorrectionBlockerMessage, expenseReopenBlockerMessages, type ExpenseCorrectionCapabilities, type ExpenseCorrectionBlocker } from '@watchdog-bms/contracts';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import { REIMBURSEMENT_PAYMENT_REFERENCE_TEXT, PAYMENT_DATE_IN_FUTURE, REIMBURSEMENT_DUPLICATE_UNRESOLVED, reimbursementDuplicateSubmitNotice, REIMBURSEMENT_SELF_APPROVAL_DENIED, reimbursementDuplicateBlockNotice, SIGNATURE_FILE_TYPES_LABEL, SIGNATURE_FILE_REQUIRED_MESSAGE, SIGNATURE_FILE_TOO_LARGE_MESSAGE, UPLOAD_FILE_TYPE_MISMATCH_MESSAGE, COMPANY_TEAM_NOTE_WORDS as NOTE_WORDS } from '@watchdog-bms/contracts';
import { EXECUTIVE_WORDS as W, THAI_SYSTEM_ROLE_NAMES, EXECUTIVE_REASON_CODES, executiveSourceReasonText, type ExecutiveCoverage } from '@watchdog-bms/contracts';

import { SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS, EXECUTIVE_REPORT_LABELS, EXECUTIVE_UNKNOWN_LABEL } from '@watchdog-bms/contracts';

// The API answers business-rule failures in English (its messages double as
// operator/log text). This is the single seam where those reach a Thai screen.
// Reviewed mappings stay specific; unknown API diagnostics fail closed to an
// actionable Thai fallback while UI-authored local errors keep their copy.

/** Stable error codes, including the `code:detail` conflicts (matched by prefix). */
const CODE_LABELS: Record<string, string> = {
  WHT_ESTABLISHMENT_FORBIDDEN: 'ไม่มีสิทธิ์เปิดแบบของสาขานี้ เลือกสาขาที่เปิดได้',
  WHT_ESTABLISHMENT_INVALID: 'รหัสสาขาภาษีไม่ถูกต้อง เลือกสาขาอีกครั้ง',
  WHT_ESTABLISHMENT_REQUIRED: 'เดือนนี้มีหลายสาขาที่ยื่น เลือกสาขาก่อนดาวน์โหลดหรือบันทึกว่ายื่นแล้ว',
  WHT_PAYER_MODE_REQUIRED: 'มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี',
  WHT_BRANCH_HAS_NO_CODE: 'สาขายังไม่มีรหัสสาขาภาษี เปิดตั้งค่าสาขาแล้วกรอกรหัสก่อนดาวน์โหลดแบบ',

  WHT_PAYER_MODE_SHOP_NOT_FOUND: 'ไม่พบร้าน เปิดเลือกร้านแล้วลองอีกครั้ง',
  WHT_PAYER_MODE_MONTH_INVALID: 'เดือนที่เริ่มใช้ไม่ถูกต้อง เลือกเดือนอีกครั้ง',
  WHT_PAYER_MODE_FORBIDDEN: 'ไม่มีสิทธิ์บันทึกวิธีจ่าย ให้ผู้ที่แก้ไขข้อมูลร้านได้เป็นผู้บันทึก',
  WHT_PAYER_MODE_INVALID: 'วิธีจ่ายไม่ถูกต้อง เลือกผู้ที่จ่ายเงินและหักภาษีอีกครั้ง',
  WHT_PAYER_MODE_FILED: 'มีแบบที่ยื่นแล้วในช่วงที่เลือก เลือกเริ่มใช้ตั้งแต่เดือนที่ยังไม่ยื่น',
  WHT_PAYER_MODE_CHANGED: 'วิธีจ่ายเปลี่ยนระหว่างบันทึก เปิดข้อมูลล่าสุดแล้วลองอีกครั้ง',

  WHT_ACCOUNTANT_PREPARES: 'ผู้ทำบัญชีจัดทำแบบนี้เอง ดาวน์โหลดรายการให้ผู้ทำบัญชีแทน',
  WHT_PND2_SEPARATE: 'ประเภทนี้ต้องยื่น ภ.ง.ด.2 แยก ให้ผู้ทำบัญชีจัดทำแบบให้',
  wht_certificate_income_unsupported: 'ระบบยังออกหนังสือรับรอง 50 ทวิสำหรับประเภทนี้ไม่ได้ ให้ผู้ทำบัญชีทำนอกระบบแล้วจดเลขที่ไว้',
  WHT_FILING_FILE_RETAINED: 'ไฟล์นี้เป็นแบบภาษีที่เก็บไว้ ลบไม่ได้ เปิดหน้าภาษีหัก ณ ที่จ่ายเพื่อดาวน์โหลด',
  WHT_FILING_ROWS_UNCERTAIN: 'รายการของแบบที่ยื่นไว้ตรวจได้ไม่ครบ ให้ผู้ทำบัญชีเทียบกับแบบที่ยื่นจริง',
  WHT_FILING_CONFIRM_FORBIDDEN: 'ไม่มีสิทธิ์ยืนยันรายการของแบบ ให้ผู้ที่มีสิทธิ์จัดทำแบบภาษีตรวจและยืนยัน',
  WHT_FILING_FILE_UNAVAILABLE: 'เปิดแบบที่ยื่นไว้ไม่ได้ ลองอีกครั้งหรือติดต่อทีมงานมั่งมี',
  WHT_FILING_ALREADY_FILED: 'แบบนี้ยื่นแล้ว แก้แบบเดิมไม่ได้ ดาวน์โหลดแบบที่ยื่นไว้แทน',
  WHT_FILING_SEQUENCE_INVALID: 'แบบที่เลือกเปลี่ยนแล้ว เปิดข้อมูลเดือนนี้ใหม่แล้วเลือกแบบอีกครั้ง',
  WHT_FILING_CHANGED_AFTER_DOWNLOAD: 'มีรายการเปลี่ยนหลังดาวน์โหลดแบบ ดาวน์โหลดแบบใหม่ก่อนยื่น',
  PND3_FILING_REVIEW: 'ยังมีรายการที่ต้องแก้ไข เปิดรายการที่แจ้งไว้แล้วแก้ไขก่อนดาวน์โหลดแบบ',
  PND3_FILING_EMPTY: 'เดือนนี้ไม่มีรายการหักภาษี ดึงรายการล่าสุดก่อนดาวน์โหลดแบบ',
  PND3_FILING_MONTH: 'เดือนภาษีไม่ถูกต้อง เลือกเดือนแล้วดึงรายการล่าสุดอีกครั้ง',
  PND3_FILING_OVERDUE: 'พ้นกำหนดยื่นแล้ว ให้ผู้ทำบัญชีตรวจเงินเพิ่มและยื่นแบบกับกรมสรรพากร',
  PND3_FILING_BRANCHES: 'มีรายการจ่ายจากหลายสาขา ให้ผู้ทำบัญชีแยกแบบยื่นตามสาขา',
  PND3_FILING_BRANCH: 'ไม่พบสาขาที่จ่าย เปิดรายการจ่ายแล้วตรวจสาขา',
  PND3_FILING_PAYER: 'ข้อมูลร้านยังไม่ครบหรือยาวเกินช่องแบบภาษี เปิดข้อมูลร้านแล้วตรวจชื่อ เลขผู้เสียภาษี 13 หลัก สาขา 5 หลัก และที่อยู่',
  PND3_FILING_EVENT: 'รายการจ่ายไม่ตรงแบบหรือเดือนภาษี หรือไม่ได้ใช้เงินบาท เปิดรายจ่ายแล้วตรวจแบบ เดือน และสกุลเงิน',
  PND3_FILING_PAYEE: 'ข้อมูลผู้รับเงินยังไม่ครบหรือยาวเกินช่องแบบภาษี เปิดรายจ่ายแล้วตรวจชื่อ เลขผู้เสียภาษี 13 หลัก ที่อยู่ และสาขา 5 หลักถ้ามี',
  PND3_FILING_CATEGORY: 'ยังไม่พบประเภทเงินได้ในรายการของระบบ เปิดรายจ่ายแล้วเลือกจ่ายค่าอะไรอีกครั้ง',
  PND3_FILING_AMOUNT: 'ยอดหักภาษีไม่ตรงกับยอดจ่ายและอัตรา เปิดรายจ่ายแล้วตรวจยอดจ่าย อัตราภาษี และยอดหักภาษีให้ครบและตรงกัน',
  PND3_FILING_KIND: 'ยังไม่ได้ยืนยันว่าผู้รับเงินเป็นบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน',
  PND3_FILING_SOURCE: 'รายการต้นทางยังใช้กับแบบนี้ไม่ได้ ให้ผู้ทำบัญชีตรวจรายการและจัดทำแบบยื่น',
  PND53_FILING_REVIEW: 'ยังมีรายการที่ต้องแก้ไข เปิดรายการที่แจ้งไว้แล้วแก้ไขก่อนดาวน์โหลดแบบ',
  PND53_FILING_EMPTY: 'เดือนนี้ไม่มีรายการหักภาษี ดึงรายการล่าสุดก่อนดาวน์โหลดแบบ',
  PND53_FILING_MONTH: 'เดือนภาษีไม่ถูกต้อง เลือกเดือนแล้วดึงรายการล่าสุดอีกครั้ง',
  PND53_FILING_OVERDUE: 'พ้นกำหนดยื่นแล้ว ให้ผู้ทำบัญชีตรวจเงินเพิ่มและยื่นแบบกับกรมสรรพากร',
  PND53_FILING_BRANCHES: 'มีรายการจ่ายจากหลายสาขา ให้ผู้ทำบัญชีแยกแบบยื่นตามสาขา',
  PND53_FILING_BRANCH: 'ไม่พบสาขาที่จ่าย เปิดรายการจ่ายแล้วตรวจสาขา',
  PND53_FILING_PAYER: 'ข้อมูลร้านยังไม่ครบหรือยาวเกินช่องแบบภาษี เปิดข้อมูลร้านแล้วตรวจชื่อ เลขผู้เสียภาษี 13 หลัก สาขา 5 หลัก และที่อยู่',
  PND53_FILING_EVENT: 'รายการจ่ายไม่ตรงแบบหรือเดือนภาษี หรือไม่ได้ใช้เงินบาท เปิดรายจ่ายแล้วตรวจแบบ เดือน และสกุลเงิน',
  PND53_FILING_PAYEE: 'ข้อมูลผู้รับเงินยังไม่ครบหรือยาวเกินช่องแบบภาษี เปิดรายจ่ายแล้วตรวจชื่อ เลขผู้เสียภาษี 13 หลัก ที่อยู่ และสาขา 5 หลักถ้ามี',
  PND53_FILING_CATEGORY: 'ยังไม่พบประเภทเงินได้ในรายการของระบบ เปิดรายจ่ายแล้วเลือกจ่ายค่าอะไรอีกครั้ง',
  PND53_FILING_AMOUNT: 'ยอดหักภาษีไม่ตรงกับยอดจ่ายและอัตรา เปิดรายจ่ายแล้วตรวจยอดจ่าย อัตราภาษี และยอดหักภาษีให้ครบและตรงกัน',
  PND53_FILING_KIND: 'ยังไม่ได้ยืนยันว่าผู้รับเงินเป็นบริษัท เปิดคู่ค้าแล้วเลือกประเภทก่อน',
  PND53_FILING_SOURCE: 'รายการต้นทางยังใช้กับแบบนี้ไม่ได้ ให้ผู้ทำบัญชีตรวจรายการและจัดทำแบบยื่น',
  // Document commands have their own collision/payment retry words; expense void keeps its words.
  ...DISBURSEMENT_VOUCHER_ERROR_WORDS,
  // The numeric facts arrive in the server message. A code-only reply uses complete guidance.
  disbursement_amount_invalid: DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_invalid_input,
  disbursement_source_changed: DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_source_changed.replace('รายการ {number} ', 'รายการในใบนี้'),
  disbursement_payment_source_changed: DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_payment_source_changed.replace('รายการ {number} ', 'รายการในใบนี้'),
  ...REIMBURSEMENT_SAVED_PAYOUT_ERROR_WORDS,
  company_team_note_version_conflict: NOTE_WORDS.conflict,
  company_team_note_invalid: NOTE_WORDS.invalid,
  company_team_note_too_long: NOTE_WORDS.tooLong,
  company_team_note_read_denied: NOTE_WORDS.denied,
  company_team_note_edit_denied: NOTE_WORDS.editDenied,
  company_team_note_company_not_found: NOTE_WORDS.notFound,
  company_team_note_save_unconfirmed: NOTE_WORDS.saveUnknown,
  ...Object.fromEntries(EXECUTIVE_REASON_CODES.map(code => [code, executiveSourceReasonText(code)])),
  INVALID_INPUT: 'ข้อมูลไม่ถูกต้อง ตรวจสอบแล้วลองอีกครั้ง',
  EXECUTIVE_SNAPSHOT_EXPIRED: W.export.expired,
  EXECUTIVE_EXPORT_LIMIT_EXCEEDED: W.export.limit,
  EXECUTIVE_EXPORT_EMPTY: W.export.empty,
  EXECUTIVE_ACCESS_DENIED: 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้',
  ACCOUNT_NOT_FOUND: 'ไม่พบบัญชีผู้บริหาร',
  ACCOUNT_ALREADY_EXISTS: 'ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้แล้ว',
  ACCOUNT_REVOKED: 'บัญชีนี้ถูกปิดจากทางอื่นของระบบ หน้านี้เปิดคืนไม่ได้',
  ACCOUNT_PROTECTED: 'บัญชีผู้ดูแลระบบระงับหรือแก้สิทธิ์จากหน้านี้ไม่ได้',
  EXECUTIVE_QUERY_INVALID: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
  COMPANY_NOT_FOUND: 'ไม่พบบริษัทนี้ในรายงาน',
  SOURCE_UNAVAILABLE: 'ระบบยังอ่านข้อมูลส่วนนี้ไม่ได้ กรุณาลองใหม่ภายหลัง',
  ACTIVITY_HISTORY_INCOMPLETE: 'ข้อมูลการใช้งานไม่ครบ',
  PAYMENT_HISTORY_INCOMPLETE: 'ข้อมูลการชำระไม่ครบ',
  BILLING_SCAN_NOT_COMPLETE: 'ยอดเงินของเดือนนี้ยังอ่านไม่ครบ',
  UNMATCHED_MONEY: 'มีเงินที่ยังไม่ผูกบริษัท ยอดนี้ยังไม่อยู่ในยอดของบริษัทใด',
  PURCHASE_KIND_UNKNOWN: 'มีรายการเงินที่ยังไม่จัดประเภทการซื้อ',
  ADDON_NOT_ON_SALE: W.addOnNotSold,
  CLASSIFICATION_INCOMPLETE: 'ยังไม่ได้จัดประเภทบริษัทครบ',
  INDUSTRY_NOT_PROVIDED: EXECUTIVE_UNKNOWN_LABEL,
  HISTORY_BEFORE_COLLECTION: W.historyBeforeCollection,
  HISTORY_BEFORE_FIRST_BUILD: W.historyBeforeFirstBuild,
  SOURCE_ROWS_PURGED: W.sourceRowsPurged,
  SOURCE_STALE: 'ข้อมูลยังไม่ได้อัปเดต',
  NOT_YET_REGISTERED: 'บริษัทนี้ยังไม่สมัครในช่วงรายงานนี้',
  NOT_ENTITLED: EXECUTIVE_REPORT_LABELS.receiptAdoption.NOT_ENTITLED!,
  TOO_FEW_COMPANIES: W.fewCompanies,
  NO_POSITIVE_NET: W.noPositiveCompanies,
  BILLING_SOURCE_REVIEW: 'ข้อมูลการชำระต้องตรวจสอบ',
  MANUAL_TERM_NO_RECEIPT: W.manualTerm,
  LEGACY_NO_TERM: 'ร้านรุ่นก่อนมีระบบแพ็กเกจ ไม่มีข้อมูลการชำระ',
  RATE_LIMITED: 'เรียกดูถี่เกินไป รอสักครู่แล้วลองอีกครั้ง',
  EMAIL_ACCESS_INVALID: 'รหัสหมดอายุหรือใช้ไม่ได้แล้ว ขอรหัสทางอีเมลใหม่',
  EMAIL_ACCESS_EXISTING_ACCOUNT: 'อีเมลนี้มีบัญชีอยู่แล้ว เข้าสู่ระบบด้วยรหัสผ่านหรือ LINE ก่อน',
  EMAIL_SIGNUP_CHANGED: 'ข้อมูลบัญชีเปลี่ยนแล้ว เข้าสู่ระบบอีกครั้ง',
  EMAIL_SIGNUP_INPUT_INVALID: 'ตรวจชื่อร้าน ชื่อผู้ติดต่อ และเบอร์มือถืออีกครั้ง',
  EMAIL_LOGIN_NOT_ALLOWED: 'บัญชีผู้ดูแลระบบต้องใช้วิธีเข้าสู่ระบบเดิม',
  // setEmailLogin's own READY check (account-email-otp.service.ts) — surfaced now that the
  // coverage spec also discovers emailError(...) calls (item 14).
  EMAIL_VERIFICATION_REQUIRED: 'ยืนยันอีเมลของบัญชีก่อน จึงจะเปิดใช้การเข้าสู่ระบบด้วยอีเมลได้',
  external_signup_disabled: 'ตอนนี้ยังไม่เปิดรับสมัครใหม่ ติดต่อทีมงาน',

  BILLING_RECIPIENT_UPDATE_REQUIRED: 'ผู้รับเอกสารยังต้องยืนยัน เปิดอีเมลรับเอกสารแล้วตรวจและยืนยันก่อนตรวจยอดอีกครั้ง',
  BILLING_EMAIL_CHANGED: 'ข้อมูลอีเมลเปลี่ยนแล้ว ตรวจอีเมลรับเอกสารและรายการจ่ายเงินอีกครั้ง',
  // Purchase without setup (pr-d §3.3): only the recipient panel's "use my account email" path still asks for it.
  BILLING_EMAIL_VERIFICATION_REQUIRED: 'อีเมลบัญชียังไม่ยืนยัน ยืนยันอีเมลบัญชีหรือเลือกใช้อีเมลอื่นก่อนแก้ผู้รับเอกสาร',
  BILLING_EMAIL_UPDATE_PENDING: 'มีรายการแก้อีเมลรับเอกสารค้างอยู่ เปิดอีเมลรับเอกสารแล้วยืนยันหรือยกเลิกรายการเดิมก่อน',
  // Purchase without setup (pr-c §2.4, wording pr-d §2.3 ค): document recipient and resend.
  BILLING_RESEND_LIMIT: 'ส่งเอกสารใบนี้ซ้ำครบจำนวนแล้ว รอแล้วลองอีกครั้งหรือเปิดเอกสารจากประวัติแทน',
  BILLING_RESEND_UNAVAILABLE: 'ยังส่งเอกสารซ้ำไม่ได้ ตรวจอีเมลรับเอกสารและสถานะรายการแล้วลองอีกครั้ง',
  BILLING_RECIPIENT_UNAVAILABLE: 'ยังตั้งอีเมลรับเอกสารในส่วนนี้ไม่ได้ เลือกแพ็กเกจแล้วกรอกอีเมลที่หน้าจ่ายเงิน',
  BILLING_RECIPIENT_UNCHANGED: 'อีเมลนี้เป็นอีเมลรับเอกสารอยู่แล้ว ปิดส่วนแก้อีเมลเพื่อกลับไปดูรายการ',
  BILLING_RECIPIENT_PROOF_INVALID: 'การยืนยันอีเมลนี้หมดอายุหรือถูกใช้แล้ว ขอรหัสยืนยันใหม่',
  BILLING_RECIPIENT_BOUNCED: 'ส่งเอกสารไปอีเมลนี้ไม่ถึง แก้อีเมลรับเอกสารก่อนส่งอีกครั้ง',
  // Purchase without setup PR E (2026-09-27): admin document tools.
  BILLING_RECIPIENT_BUSY: 'บริษัทมีรายการซื้อ คำสั่งต่ออายุ หรือคำขอเปลี่ยนผู้รับของลูกค้าค้างอยู่ รอให้เสร็จก่อน',
  BILLING_RECIPIENT_NO_CUSTOMER: 'บริษัทนี้ยังไม่มีบัญชีลูกค้ากับผู้ให้บริการรับชำระเงิน จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน',
  BILLING_RECIPIENT_INVALID: 'รูปแบบอีเมลไม่ถูกต้อง',
  BILLING_LOOKUP_TOO_SHORT: 'เลขอ้างอิงต้องมีอย่างน้อย 8 ตัวอักษร',
  BILLING_LOOKUP_AMBIGUOUS: 'เลขอ้างอิงนี้ตรงหลายรายการ ให้ใช้เลขใบแจ้งหนี้หรือรหัสเต็ม',
  // A sales-event discount serial that no shop has used yet (sales-event spec SD-E20).
  BILLING_LOOKUP_EVENT_TICKET_UNUSED: 'ส่วนลดจากงานนี้ยังไม่ได้ใช้กับร้านใด จึงยังไม่มีร้านให้เปิดดู',
  EMAIL_OTP_REQUIRED: 'เปิดหน้านี้ใหม่เพื่อยืนยันอีเมลด้วยรหัสยืนยัน',
  EMAIL_REAUTH_REQUIRED: 'กรอกรหัสผ่านปัจจุบัน หรือยืนยันตัวตนผ่าน LINE อีกครั้ง',
  EMAIL_DELIVERY_UNAVAILABLE: 'ยังส่งรหัสไม่ได้ ลองอีกครั้งภายหลัง หรือติดต่อทีมงาน 098-256-5628',
  EMAIL_OTP_INVALID: 'รหัสไม่ถูกต้อง ตรวจรหัส 6 หลักจากอีเมลล่าสุด',
  EMAIL_OTP_EXPIRED: 'รหัสหมดอายุแล้ว ขอรหัสใหม่',
  EMAIL_OTP_ATTEMPTS_EXCEEDED: 'กรอกรหัสผิดครบจำนวนแล้ว ขอรหัสใหม่',
  EMAIL_OTP_RATE_LIMITED: 'ขอรหัสหรือกรอกรหัสผิดบ่อยเกินไป รอก่อนแล้วลองอีกครั้ง',
  EMAIL_CONFLICT: 'อีเมลนี้ใช้กับบัญชีอื่นแล้ว ใช้อีเมลอื่น หรือติดต่อทีมงาน',
  EMAIL_STATE_CHANGED: 'ข้อมูลอีเมลเปลี่ยนแล้ว ตรวจข้อมูลล่าสุดก่อนขอรหัสใหม่',
  EMAIL_OTP_TARGET_INVALID: 'กรอกอีเมลให้ถูกต้อง',
  EMAIL_ACCOUNT_UNAVAILABLE: 'บัญชีนี้ยืนยันอีเมลไม่ได้ ติดต่อทีมงาน',
  EMAIL_OTP_NOT_FOUND: 'ไม่พบคำขอยืนยันอีเมลนี้ เปิดหน้านี้ใหม่',
  ACCOUNT_REAUTH_REQUIRED: 'ยืนยันตัวตนอีกครั้งด้วยวิธีที่บัญชีรองรับ แล้วกลับมาตั้งรหัสผ่านภายใน 5 นาที',
  LAST_LOGIN_REQUIRED: 'ก่อนยกเลิกการผูก LINE ต้องมีรหัสผ่านสำรอง และมีชื่อผู้ใช้หรืออีเมลที่ยืนยันแล้ว',

  partner_plan_term_changed: 'มีการเปลี่ยนแพ็กเกจหรือวันใช้งานแล้ว โหลดข้อมูลล่าสุดและตรวจสอบก่อนบันทึกใหม่',
  partner_plan_term_command_required: 'โหลดข้อมูลแพ็กเกจล่าสุด แล้วตรวจสอบคำขอก่อนบันทึกอีกครั้ง',
  partner_plan_term_command_conflict: 'คำขอนี้ไม่ตรงกับรายการเดิม โหลดข้อมูลและประวัติล่าสุดก่อนเริ่มรายการใหม่',
  plan_branch_limit_exceeded: 'แพ็กเกจปัจจุบันรองรับจำนวนสาขาครบแล้ว หากต้องการเพิ่มสาขา กรุณาเปลี่ยนแพ็กเกจ',
  paid_plan_review_required: 'แพ็กเกจนี้มีรายการชำระเงิน เปิดหน้าปรับแพ็กเกจชั่วคราวจากการชำระเงินของบริษัทเพื่อตรวจและอนุมัติ',
  partner_adjustment_reason_required: 'กรุณาระบุเหตุผลที่ปรับ ตั้งแต่ 1 ถึง 500 ตัวอักษร',
  partner_ai_previous_value_required: 'โหลดข้อมูล AI ล่าสุดก่อนตรวจสอบและบันทึกอีกครั้ง',
  partner_ai_configuration_changed: 'มีผู้แก้การตั้งค่า AI แล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจสอบก่อนบันทึกใหม่',
  // Split CHAT/OCR budget policy (remediation spec §12.4). System-Admin surface only
  // (`system.partner_ai_model.manage`), so each line names the field to change rather than
  // restating the rule; the refused amounts travel as separate response fields, never in the text.
  partner_ai_budget_policy_invalid: 'ตรวจโหมดงบ เพดานแชต เพดานอ่านเอกสาร และเดือนที่เริ่มใช้ให้ถูกต้อง เพดานต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป',
  partner_ai_budget_split_caps_required: 'โหมดแยกเพดานต้องกรอกทั้งเพดานแชตและเพดานอ่านเอกสาร ใส่ 0 หากต้องการปิดส่วนนั้น',
  partner_ai_budget_effective_month_invalid: 'เลือกเดือนที่เริ่มใช้เป็นเดือนนี้หรือเดือนถัดไปเท่านั้น',
  partner_ai_budget_split_exceeds_total: 'ผลรวมเพดานแชตและอ่านเอกสารต้องไม่เกินเพดานความปลอดภัยของเดือน กรุณาลดเพดานหรือเพิ่มเพดานความปลอดภัยก่อนบันทึก',
  partner_ai_budget_total_below_split_allocation: 'เพดานความปลอดภัยใหม่ต่ำกว่าผลรวมเพดานที่ตั้งไว้ กรุณาลดเพดานทั้งที่ใช้อยู่และที่ตั้งให้เริ่มเดือนถัดไปก่อน แล้วจึงลดเพดานความปลอดภัย',
  partner_ai_budget_revision_required: 'โหลดข้อมูลเครดิต AI ล่าสุดก่อนตรวจสอบและบันทึกเพดานอีกครั้ง',
  partner_ai_budget_revision_conflict: 'ข้อมูลเครดิต AI ถูกแก้ไขจากที่อื่นหรือขึ้นเดือนใหม่แล้ว กรุณาโหลดใหม่และตรวจสอบก่อนบันทึก',
  partner_ai_budget_split_requires_next_month: 'บริษัทนี้มีค่าใช้จ่าย AI ในเดือนนี้แล้ว ให้ตั้งแยกเพดานให้มีผลเดือนถัดไป',
  partner_ai_budget_mode_change_next_month_only: 'การกลับไปไม่แยกเพดานทำได้เฉพาะเดือนถัดไป กรุณาเลือกเดือนที่เริ่มใช้เป็นเดือนถัดไป',
  partner_ai_budget_cap_below_bucket_spend: 'เพดานใหม่ต่ำกว่ายอดที่ส่วนนั้นใช้ไปแล้วในเดือนนี้ ให้ตั้งเพดานที่ลดลงให้มีผลเดือนถัดไป',
  // Phase E1b: a split hold is priced from the company's own model, so SPLIT is unusable without
  // one. Refused at SAVE time rather than letting the shop go quiet afterwards.
  partner_ai_budget_split_requires_model: 'โหมดแยกเพดานต้องตั้งรุ่น AI ของบริษัทก่อน เพราะวงเงินที่จองไว้คิดจากราคาของรุ่นนั้น กรุณาเปิดหัวข้อ เปลี่ยนรุ่น AI ของบริษัท เลือกรุ่นแล้วกดบันทึกที่หัวข้อนั้น จากนั้นกลับมาบันทึกการแยกเพดานอีกครั้ง',
  // Phase E1b sibling of the line above: the new TOTAL is below what this company has already
  // spent PLUS what is currently reserved for AI calls in flight this month. Nothing is clamped —
  // the operator raises the total, or waits for the reserved amount to settle.
  partner_ai_budget_total_below_committed: 'เพดานความปลอดภัยใหม่ต่ำกว่ายอดที่ใช้ไปแล้วบวกยอดที่กันไว้ของเดือนนี้ กรุณาตั้งเพดานให้ไม่น้อยกว่ายอดใช้บวกยอดที่กันไว้ หรือรอให้รายการที่กันไว้เสร็จก่อน',
  // Hold reconciliation (hold spec §4.2). Each one tells the operator what to do next, because the
  // list is refreshed automatically after any of these three — the row simply will not be there.
  partner_ai_credit_hold_not_found: 'ไม่พบรายการเครดิตที่กันไว้นี้ในบริษัทนี้ กรุณาโหลดรายการล่าสุดแล้วตรวจสอบอีกครั้ง',
  partner_ai_credit_hold_already_resolved: 'รายการนี้ถูกปิดไปแล้ว อาจมีผลการใช้จริงเข้ามาหรือมีผู้ดูแลอีกคนจัดการก่อน กรุณาโหลดรายการล่าสุดก่อนทำรายการใหม่',
  partner_ai_credit_breach_already_acknowledged: 'รายการใช้เกินที่กันไว้นี้ถูกรับทราบไปแล้ว กรุณาโหลดรายการล่าสุดเพื่อดูสถานะปัจจุบัน',
  partner_ai_credit_hold_action_failed: 'ทำรายการกับเครดิตที่กันไว้ไม่สำเร็จ ยังไม่มีการเปลี่ยนแปลงใด กรุณาโหลดรายการล่าสุดและลองอีกครั้ง',
  partner_ai_credit_holds_cursor_invalid: 'โหลดรายการหน้าถัดไปไม่สำเร็จ กรุณาโหลดรายการล่าสุดอีกครั้ง',
  platform_ai_budget_default_below_split_allocation: 'เครดิตเริ่มต้นใหม่ต่ำกว่าผลรวมเพดานของบริษัทที่ใช้เครดิตเริ่มต้น กรุณาแก้เพดานของบริษัทเหล่านั้น หรือตั้งเครดิตเฉพาะบริษัทก่อนลดเครดิตเริ่มต้น',
  CONTROL_OFFER_RECEIPTS_INVALID: 'ตรวจจำนวนใบเสร็จของแพ็กเกจ กรอกจำนวนเต็มตั้งแต่ 1 ถึง 178,956,970 ใบต่อรอบเดือน รายปีคูณ 12 ให้อัตโนมัติ',
  CONTROL_OFFER_PRICE_INVALID: 'ตรวจราคาของแพ็กเกจ ยอดรวมภาษีต้องอยู่ระหว่าง 10 ถึง 999,999.99 บาท และทศนิยมไม่เกิน 2 ตำแหน่ง',
  CONTROL_OFFER_CAPACITY_INVALID: 'กรอกเพดานสาขาและผู้ใช้ให้ครบทั้งสองช่อง เป็นจำนวนเต็มตั้งแต่ 1 ถึง 1,000 ผู้ใช้นับรวมเจ้าของ',
  email_reset_invalid: 'ลิงก์นี้หมดอายุ ถูกใช้แล้ว หรือข้อมูลบัญชีเปลี่ยน ขอลิงก์ตั้งรหัสผ่านใหม่',
  CONTROL_CONFIGURATION_CHECK_ACTIVE: 'มีรายการตรวจที่กำลังทำอยู่ โหลดประวัติแล้วเปิดรายการเดิมเพื่อดูผล',
  CONTROL_CONFIGURATION_CHECK_REVIEW: 'ยังบันทึกผลตรวจไม่ได้ โหลดการตั้งค่าล่าสุด ยกเลิกรายการเดิม แล้วเริ่มตรวจใหม่',
  LINE_CHANNEL_MIGRATION_REQUIRED: 'ใช้ Channel ID ปัจจุบัน การเปลี่ยนบัญชีทางการ LINE ต้องให้ผู้ดูแลระบบตรวจแผนย้ายบัญชีที่เชื่อมไว้ก่อน',
  LINE_CREDENTIAL_CHANGED: 'มีผู้แก้การตั้งค่า LINE แล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจสอบก่อนยืนยันใหม่',
  LINE_CREDENTIAL_KIND_UNSUPPORTED: 'หน้านี้รองรับเฉพาะข้อมูลรับรอง Messaging ของบัญชี LINE ปัจจุบัน กรุณากลับไปเลือกการตั้งค่าที่รองรับ',
  LINE_CREDENTIAL_RATE_LIMIT: 'ตรวจข้อมูลรับรอง LINE ถี่เกินไป กรุณารอสักครู่แล้วลองรายการเดิมอีกครั้ง',
  LINE_CREDENTIAL_UNAVAILABLE: 'อ่านการตั้งค่า LINE ไม่ได้ ให้ผู้ดูแลระบบตรวจการเชื่อมต่อแล้วลองรายการเดิมอีกครั้ง',
  LINE_REAUTH_FAILED: 'ยืนยันรหัสผ่านปัจจุบันไม่สำเร็จ กรุณาตรวจรหัสผ่านแล้วลองอีกครั้ง',
  LINE_TOKEN_CHANNEL_OR_EXPIRY: 'Token ไม่ตรงกับ Channel ปัจจุบันหรือใกล้หมดอายุ กรุณาใช้ Token ใหม่ของ Channel นี้จาก LINE Developers',
  LINE_TOKEN_CHECK_UNAVAILABLE: 'ยังตรวจ Token กับ LINE ไม่ได้ กรุณาโหลดสถานะล่าสุดแล้วลองอีกครั้ง',
  LINE_TOKEN_REJECTED: 'LINE ไม่ยอมรับ Token นี้ กรุณาใช้ short-lived หรือ long-lived token ของ Channel ปัจจุบันจาก LINE Developers',
  EMPLOYEE_BRANCH_SCOPE_UNAVAILABLE: 'แก้สาขาที่พนักงานมีสิทธิ์และสาขาเริ่มต้นให้ใช้งานได้ก่อน แล้วเปิดสิทธิ์อีกครั้ง',
  BILLING_RATE_LIMIT: 'ทำรายการถี่เกินไป รอสักครู่แล้วลองรายการเดิมอีกครั้ง',
  BILLING_NOT_CONFIGURED: 'ระบบรับเงินยังไม่พร้อม ติดต่อทีมงาน',
  CONTROL_ACTION_NOT_SUPPORTED: 'เปลี่ยนแพ็กเกจผ่านหน้ามั่งมี โดยใช้ตัวเลือกซื้อซ้ำและเปลี่ยนแพ็กเกจ',
  CONTROL_POLICY_NOT_READY: 'การตั้งค่ายังไม่ครบ บันทึกฉบับร่างแล้วเติมข้อมูลก่อนตรวจผลกระทบอีกครั้ง',
  CONTROL_IMPACT_NOT_READY: 'ตรวจผลกระทบจากฉบับร่างก่อนเปิดรายชื่อรายการที่เกี่ยวข้อง',
  CONTROL_GATE_POLICY_STALE: 'นโยบายเปลี่ยนแล้ว โหลดการตั้งค่าล่าสุดก่อนบันทึกหรือคัดลอกร่างค่าสวิตช์อีกครั้ง',
  CONTROL_PREVIEW_STALE: 'ข้อมูลเปลี่ยนหรือคำขอหมดอายุ โหลดข้อมูลล่าสุดและตรวจผลกระทบใหม่',
  BILLING_END_PACKAGE_NOT_CURRENT: 'รายการนี้ไม่ใช่การชำระของแพ็กเกจที่ร้านใช้งานอยู่ตอนนี้ จึงยุติแพ็กเกจจากรายการนี้ไม่ได้',
  BILLING_END_PACKAGE_AUTO_RENEW: 'ร้านนี้ยังเปิดต่ออายุอัตโนมัติอยู่ กรุณายกเลิกการต่ออายุก่อน แล้วจึงยุติแพ็กเกจ',
  BILLING_END_PACKAGE_PENDING: 'ร้านนี้มีรายการชำระเงินหรือแพ็กเกจล่วงหน้าที่ยังดำเนินการอยู่ ตรวจรายการนั้นให้เสร็จก่อน',
  BILLING_END_PACKAGE_NOT_REFUNDED: 'รายการนี้ยังคืนเงินไม่ครบเต็มจำนวน ยุติแพ็กเกจได้หลังคืนเงินครบแล้ว',
  CONTROL_SLA_REVIEW: 'ไม่พบเกณฑ์เวลาเดิม กรุณาระบุเวลาติดตามก่อนเปลี่ยนระดับความสำคัญ',
  CONTROL_SCHEDULE_TIME: 'เลือกเวลาล่วงหน้าอย่างน้อยหนึ่งนาทีและไม่เกินหนึ่งปี แล้วตรวจผลกระทบใหม่',
  CONTROL_SCHEDULE_NOT_DUE: 'ยังไม่ถึงเวลาที่อนุมัติไว้',
  CONTROL_SCHEDULE_REVIEW: 'ยังใช้ค่าตามกำหนดไม่ได้ ตรวจข้อมูลล่าสุดและสร้างฉบับร่างจากคำขอเดิมเพื่อขออนุมัติใหม่',
  CONTROL_REAUTH_REQUIRED: 'ยืนยันรหัสผ่านก่อน แล้วกดดำเนินการรายการเดิมอีกครั้ง',
  CONTROL_REAUTH_FAILED: 'ยืนยันรหัสผ่านไม่ได้ ตรวจสอบรหัสผ่านหรือใช้หน้ากู้บัญชี',
  BILLING_PLAN_CHANGE_REQUIRED: 'ยังซื้อหรือเปลี่ยนแพ็กเกจด้วยรายการนี้ไม่ได้ ตรวจการต่ออายุก่อนเลือกแพ็กเกจอีกครั้ง',
  CONTROL_SALES_COMPANY_INVALID: 'มีบริษัทที่ไม่พบแล้ว กรุณาเลือกบริษัทใหม่และตรวจผลกระทบอีกครั้ง',
  BILLING_COMPANY_SALES_CLOSED: 'ร้านนี้ยังซื้อหรือเปลี่ยนแพ็กเกจผ่านเว็บไม่ได้ ติดต่อทีมงาน',
  BILLING_SALES_CLOSED: 'ยังไม่เปิดรับเงินใหม่ ติดต่อทีมงาน',
  BILLING_QUOTE_STALE: 'รายการหมดอายุหรือข้อมูลเปลี่ยน เลือกแพ็กเกจแล้วตรวจยอดอีกครั้ง',
  BILLING_CAP_SELECTION_REQUIRED: 'สิทธิ์สาขาหรือผู้ใช้ยังไม่ตรงกับแพ็กเกจ เลือกสิทธิ์ที่จะใช้ต่อก่อนยืนยัน',
  // Purchase without setup (pr-d §2.3 ก, RV28): every `billingError('X')` has Thai here, so the package
  // page falls through to this map (billing-error-text.ts) instead of keeping a second copy.
  BILLING_CHECKOUT_PENDING: 'ระบบกำลังตรวจรายการจ่ายเงินเดิม รอสักครู่แล้วตรวจสถานะล่าสุด',
  BILLING_PURCHASE_PENDING: 'มีรายการจ่ายเงินเดิมที่ระบบกำลังตรวจอยู่ รอสักครู่แล้วลองอีกครั้ง',
  BILLING_COLLECTION_PENDING: 'มีรายการเกี่ยวกับการต่ออายุที่ยังไม่เสร็จ ตรวจการต่ออายุให้เสร็จก่อนซื้อเพิ่ม',
  BILLING_COLLECTION_CLOSED: 'ยังจัดการการต่ออายุผ่านเว็บไม่ได้ ติดต่อทีมงาน',
  BILLING_COLLECTION_REVIEW: 'ข้อมูลการต่ออายุยังใช้ทำรายการนี้ไม่ได้ ตรวจสถานะล่าสุดหรือติดต่อทีมงาน',
  BILLING_CONSENT_REQUIRED: 'ยังไม่ได้ยอมรับเงื่อนไข ติ๊กยอมรับเงื่อนไขก่อนจ่ายเงิน',
  BILLING_DOCUMENT_BINDING: 'ยังตรวจยืนยันข้อมูลเอกสารของรายการนี้ไม่ได้ ติดต่อทีมงาน',
  BILLING_EXISTING_SUBSCRIPTION: 'มีรายการจ่ายเงินเดิมที่ยังไม่จบ ตรวจสถานะรายการเดิมก่อนเริ่มรายการใหม่',
  BILLING_IDEMPOTENCY_CONFLICT: 'รายการนี้ถูกส่งซ้ำด้วยข้อมูลที่ต่างจากเดิม เปิดหน้านี้ใหม่แล้วเริ่มรายการอีกครั้ง',
  BILLING_IDEMPOTENCY_REQUIRED: 'ส่งข้อมูลรายการไม่ครบ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  // Not renewal-only any more: a first purchase can throw this too (item 11, 2026-09-29 review).
  BILLING_MAPPING_MISMATCH: 'ข้อมูลการจ่ายเงินยังตรวจยืนยันไม่ได้ ติดต่อทีมงาน',
  BILLING_MODE_CHANGE_PENDING: 'ยังเปลี่ยนวิธีจ่ายไม่ได้ ตรวจการต่ออายุและรายการเดิมก่อนเลือกวิธีจ่ายอีกครั้ง',
  BILLING_OFFER_UNAVAILABLE: 'แพ็กเกจนี้ยังซื้อไม่ได้ เลือกแพ็กเกจอื่น',
  BILLING_PACKAGE_STATE_INVALID: 'ข้อมูลแพ็กเกจเดิมยังใช้ทำรายการนี้ไม่ได้ ติดต่อทีมงาน',
  BILLING_PLAN_CHANGE_PENDING: 'มีแพ็กเกจที่จ่ายล่วงหน้ารอเริ่มใช้งานอยู่ ตรวจรายการเดิมในการต่ออายุ',
  BILLING_PRICE_MISMATCH: 'ยังยืนยันราคาแพ็กเกจไม่ได้ ลองอีกครั้งภายหลังหรือติดต่อทีมงาน',
  BILLING_REPEAT_REVIEW: 'รายการซื้อซ้ำยังต้องตรวจสอบ ติดต่อทีมงาน',
  BILLING_TAX_MISMATCH: 'ยังยืนยันข้อมูลภาษีของการจ่ายเงินไม่ได้ ลองอีกครั้งภายหลังหรือติดต่อทีมงาน',
  BILLING_UPGRADE_BOUNDARY: 'ใกล้วันเปลี่ยนรอบแล้ว ตรวจสถานะหลังเปลี่ยนรอบหรือติดต่อทีมงาน',
  BILLING_UPGRADE_GIFT_ONLY: 'เวลาที่เหลือของแพ็กเกจเป็นวันที่ทีมงานให้ไว้ ซื้อแพ็กเกจเดิมเพิ่มก่อนเลือกแพ็กเกจที่สูงขึ้น',
  BILLING_UPGRADE_BELOW_MINIMUM: 'ส่วนต่างต่ำกว่า 10.00 บาท เปลี่ยนแพ็กเกจเมื่อถึงรอบต่ออายุหรือติดต่อทีมงาน',
  BILLING_UPGRADE_REVIEW: 'ยังคำนวณส่วนต่างของแพ็กเกจนี้ไม่ได้ ติดต่อทีมงาน',
  PROMOTION_UNAVAILABLE: 'โปรโมชั่นนี้ใช้ไม่ได้แล้ว กรุณาตรวจสอบรายการใหม่',
  BILLING_CHECKOUT_NOT_STARTED: 'รายการจ่ายเงินนี้ยังไม่ได้เริ่ม กลับไปเลือกแพ็กเกจเพื่อเริ่มรายการใหม่',
  PROMOTION_UPGRADE_DEFERRED: 'แพ็กเกจนี้อยู่ในช่วงสิทธิ์โปรโมชั่น อัปเกรดได้หลังสิทธิ์ที่ซื้อไว้สิ้นสุด',
  BILLING_CHECKOUT_INVOICE_MISMATCH: 'หลักฐานการจ่ายเงินยังต้องตรวจสอบก่อนเปิดสิทธิ์ ติดต่อทีมงาน',
  BILLING_INVOICE_MISMATCH: 'หลักฐานใบแจ้งหนี้ยังต้องตรวจสอบก่อนเปิดสิทธิ์ ติดต่อทีมงาน',
  SPECIAL_PRICE_RETURN_REVIEW: 'ราคาพิเศษของร้านยังปรับกลับเป็นราคาปกติไม่ได้ ทีมงานกำลังตรวจสอบ',
  // These had Thai only on the package page; the shared map carries them now, same wording.
  BILLING_CADENCE_PENDING_CHANGE: 'มีรายการเปลี่ยนแพ็กเกจรอบถัดไป ตรวจและยกเลิกรายการนั้นในการต่ออายุก่อนซื้อรายปี',
  BILLING_REPEAT_NOT_READY: 'ยังซื้อซ้ำหรือเปลี่ยนแพ็กเกจระหว่างรอบไม่ได้ ติดต่อทีมงาน',
  BILLING_RESTART_REVIEW: 'ยังเริ่มแพ็กเกจใหม่ไม่ได้เพราะต้องตรวจรายการเดิม ติดต่อทีมงาน',
  BILLING_DOCUMENT_PENDING: 'เอกสารของรายการนี้ยังไม่พร้อมเปิด ลองอีกครั้งภายหลัง',
  BILLING_PORTAL_UNAVAILABLE: 'ยังเปิดหน้าแก้บัตรไม่ได้ ตรวจสถานะล่าสุดแล้วลองอีกครั้ง',
  BILLING_PORTAL_CONFIG_MISMATCH: 'หน้าแก้บัตรยังไม่พร้อมใช้งาน ติดต่อทีมงาน',
  BILLING_COMPANY_HELD: 'ร้านนี้ถูกพักใช้งาน ติดต่อทีมงาน',
  BILLING_SOURCE_REVIEW_REQUIRED: 'ข้อมูลการจ่ายเงินเดิมยังตรวจยืนยันไม่ได้ ติดต่อทีมงาน',
  BILLING_ENTITLEMENT_REVIEW_REQUIRED: 'ข้อมูลสิทธิ์เมนูเดิมยังไม่พร้อม ติดต่อทีมงาน',
  BILLING_REFUND_PENDING: 'มีรายการคืนเงินที่ยังตรวจไม่เสร็จ ตรวจสถานะล่าสุดหรือติดต่อทีมงาน',
  BILLING_NOT_READY: 'ยังไม่เปิดรับเงินใหม่ ติดต่อทีมงาน',
  // Operator copy (pr-d §2.3 จ): System Admin screens read these through apiErrorMessage.
  // Add-on plan PR B: adding or taking back add-on units (เพิ่มยอดให้ลูกค้า).
  CONTROL_ADDON_NOT_READY: 'ร้านนี้ยังรับยอดเพิ่มเติมชนิดนี้ไม่ได้ ร้านต้องมีแพ็กเกจที่ชำระแล้วก่อน',
  CONTROL_COMPANY_HELD: 'ร้านนี้ถูกพักใช้งานอยู่ ตรวจสถานะร้านก่อนทำรายการนี้',
  CONTROL_ASSIGNEE_REVIEW: 'ผู้รับงานหรือผู้สำรองไม่มีสิทธิ์ดูแลบริษัทนี้แล้ว กรุณาเลือกใหม่หรือคืนเคสเข้าคิว',
  CONTROL_CHECKOUT_OUTCOME_UNKNOWN: 'ยังยืนยันผลยุติหน้าชำระเงินเดิมไม่ได้ กรุณาตรวจรายการเดิมอีกครั้ง',
  CONTROL_CHECKOUT_SOURCE_CHANGED: 'ข้อมูลหน้าชำระเงินเดิมเปลี่ยนหรือยังไม่ครบ กรุณาตรวจรายการเดิมอีกครั้ง',
  CONTROL_COLLECTION_REVIEW: 'ข้อมูลการเก็บเงินเปลี่ยนหรือยังยืนยันไม่ได้ เปิดรายการเดิมเพื่อตรวจสอบ',
  CONTROL_EXPORT_CHANGED: 'ข้อมูลหรือสิทธิ์เปลี่ยนแล้ว โหลดประวัติล่าสุดก่อนดาวน์โหลดอีกครั้ง',
  CONTROL_FREE_DAYS_REVIEW: 'ยังปรับวันไม่ได้ ตรวจรายการต่ออายุเดิมแล้วลองรายการนี้อีกครั้ง',
  CONTROL_IDEMPOTENCY_CONFLICT: 'คำขอนี้ต่างจากรายการเดิม เปิดรายการเดิมเพื่อตรวจสอบ',
  CONTROL_INVOICE_IDENTITY_NOT_READY: 'ตั้งค่าเลขภาษีนี้เป็นค่าเริ่มต้นของเอกสารใน Stripe แล้วตรวจสอบใหม่',
  CONTROL_INVOICE_SOURCE_CHANGED: 'บัญชีหรือผลตรวจต้นทางเปลี่ยนแล้ว ยกเลิกคำสั่งเดิมและตรวจใหม่',
  CONTROL_INVOICE_TARGET_REQUIRED: 'เลือกใบเสร็จหรือผลตรวจใบแจ้งหนี้เดิมก่อน แล้วตรวจผลกระทบใหม่',
  CONTROL_ISSUER_REQUIRED: 'กรุณาระบุข้อมูลกิจการและเลขภาษีที่ตั้งค่าใน Stripe',
  CONTROL_OPERATION_IN_PROGRESS: 'มีคำสั่งเดิมที่ยังตรวจไม่จบ เปิดประวัติคำสั่งของบริษัทเพื่อดำเนินการต่อ',
  CONTROL_POLICY_NOT_SUPPORTED: 'นโยบายปัจจุบันให้เริ่มและชำระทันที รายการนี้จึงทำไม่ได้',
  CONTROL_PROMOTION_INVALID: 'ข้อมูลแคมเปญยังไม่ครบหรือไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
  CONTROL_PROMOTION_NOT_FOUND: 'ไม่พบแคมเปญนี้ กรุณาโหลดรายการแคมเปญใหม่',
  CONTROL_PROMOTION_ENDED: 'แคมเปญนี้จบแล้ว แก้ไขหรือเปิดใหม่ไม่ได้ กรุณาสร้างแคมเปญใหม่',
  CONTROL_PROMOTION_OVERLAP: 'มีแคมเปญอื่นของแพ็กเกจและรอบเดียวกันในช่วงเวลานี้แล้ว',
  CONTROL_PROMOTION_CAP_BELOW_USED: 'ลดจำนวนสิทธิ์ต่ำกว่าที่มีผู้จองหรือใช้ไปแล้วไม่ได้',
  CONTROL_PROMOTION_CATALOG_STALE: 'ราคาหรือโควตาของแพ็กเกจเปลี่ยนแล้ว กรุณาตรวจสอบตัวอย่างและเผยแพร่แคมเปญใหม่',
  CONTROL_PROVIDER_DISABLED: 'ยังไม่ได้ตั้งค่าบัญชีผู้ให้บริการ ติดต่อผู้ดูแลการเชื่อมต่อ',
  // The former 23h-unconfirmed rule of a recipient-email change. No longer raised by the API (2026-10-10, now CONTROL_RECIPIENT_NOT_CHANGED); kept for requests and audit rows that already carry it.
  CONTROL_RECIPIENT_AGED_UNKNOWN: 'ยังยืนยันผลกับ Stripe ไม่ได้เกิน 23 ชั่วโมง ให้ตรวจที่ Stripe ก่อนทำรายการต่อ',
  CONTROL_RECIPIENT_NOT_CHANGED: 'ตรวจกับผู้ให้บริการรับชำระเงินแล้ว อีเมลผู้รับเอกสารตอนนี้ไม่ใช่อีเมลใหม่ตามคำขอนี้ ถ้ายังต้องการเปลี่ยน ให้สร้างคำขอใหม่',
  CONTROL_REFUNDS_CLOSED: 'ยังไม่เปิดรับคำขอคืนเงิน ติดต่อผู้ดูแลการตั้งค่า',
  // No longer raised by the API (2026-10-10); kept for requests and audit rows that already carry it.
  CONTROL_REFUND_AGED_UNKNOWN: 'ยังยืนยันรายการเดิมไม่ได้ ให้เจ้าหน้าที่ตรวจ Stripe ก่อนดำเนินการต่อ',
  CONTROL_REFUND_CONFIG_REQUIRED: 'กำหนดวงเงินคืนเงินและขออนุมัตินโยบายก่อนเปิดการคืนเงิน',
  CONTROL_REFUND_LIMIT: 'ยอดนี้เกินวงเงินต่อคำขอ กรุณาติดต่อผู้ดูแลวงเงิน',
  CONTROL_REFUND_NOT_CREATED: 'ตรวจกับผู้ให้บริการรับชำระเงินแล้ว ไม่พบการคืนเงินของคำขอนี้ คำขอนี้จึงไม่ได้คืนเงิน ถ้ายังต้องการคืน ให้สร้างคำขอใหม่',
  CONTROL_REFUND_PROVIDER_REJECTED: 'ผู้ให้บริการรับชำระเงินไม่รับคำขอคืนเงินนี้ คำขอนี้จึงไม่ได้คืนเงิน ตรวจเหตุผลแล้วสร้างคำขอใหม่ได้',
  CONTROL_REFUND_SOURCE_CHANGED: 'หลักฐานการคืนเงินเปลี่ยนหรือยังไม่ครบ กรุณาตรวจรายการเดิมอีกครั้ง',
  CONTROL_SCAN_BUSY: 'มีงานตรวจที่ยังไม่จบ กรุณาเปิดงานเดิมก่อน',
  CONTROL_SCOPE_TARGET_INVALID: 'เลือกเจ้าหน้าที่ที่มีบทบาทระดับระบบสำหรับงานการเงินอยู่แล้ว ผู้ดูแลระบบมีขอบเขตทั้งหมดอยู่แล้ว',
  CONTROL_SCHEDULE_INVALID: 'กำหนดเวลาไม่ถูกต้อง กรุณาเลือกเวลาใหม่แล้วตรวจผลกระทบอีกครั้ง',
  CONTROL_NOTIFICATION_REVIEW: 'รายการส่งนี้ยังมีเงื่อนไขที่ต้องแก้ก่อน เปิดรายการส่งเดิมเพื่อตรวจสาเหตุ แล้วจึงสั่งอีกครั้ง',
  reimbursement_source_unavailable: 'ไม่พบค่าใช้จ่ายที่เลือกมาเบิก เลือกใหม่',
  reimbursement_source_currency_mismatch: 'สกุลเงินของค่าใช้จ่ายต้องตรงกับใบเบิก',
  reimbursement_source_already_settled: 'รายการนี้บันทึกบัญชี จ่ายเงิน หรือปิดรายการแล้ว จึงนำมาเบิกซ้ำไม่ได้',
  reimbursement_source_not_personal: 'ใบรับรองนี้ระบุว่าจ่ายด้วยเงินของร้าน จึงนำมาเบิกคืนพนักงานไม่ได้',
  reimbursement_source_not_issued: 'เซ็นและออกใบรับรองให้เสร็จก่อนนำมาเบิก',
  reimbursement_source_payer_unlinked: 'ผู้จ่ายบนกระดาษยังไม่ได้เชื่อมกับผู้เบิกในระบบ ตรวจผู้จ่ายก่อน',
  reimbursement_source_wrong_payer: 'ผู้เบิกต้องตรงกับพนักงานผู้สำรองจ่ายในหลักฐาน',
  reimbursement_source_tax_review_required: 'รายการนี้มีภาษีหัก ณ ที่จ่าย หรือภาษีซื้อที่ต้องตรวจ ให้ผู้ทำบัญชีจัดการภาษีที่รายการค่าใช้จ่ายก่อน',
  reimbursement_source_ambiguous: 'ไฟล์นี้เชื่อมกับค่าใช้จ่ายมากกว่าหนึ่งรายการ ตรวจหลักฐานต้นทางก่อน',
  reimbursement_source_changed: 'ข้อมูลค่าใช้จ่ายต้นทางเปลี่ยนแล้ว เปิดหน้าร่างใบเบิกใหม่ แล้วตรวจก่อนส่งอีกครั้ง',
  reimbursement_source_fields_mismatch: 'ยอดเงินและวันที่ในใบเบิกต้องตรงกับค่าใช้จ่ายต้นทาง ดึงข้อมูลล่าสุดอีกครั้ง',
  reimbursement_source_attachment_mismatch: 'ไฟล์ที่เลือกไม่ใช่หลักฐานของค่าใช้จ่ายนี้ เลือกใหม่',
  reimbursement_source_review_required: 'ใบเบิกเดิมยังไม่ได้เก็บข้อมูลต้นทาง แก้ไขร่างและดึงข้อมูลล่าสุดก่อนส่ง',
  reimbursement_requester_unavailable: 'ผู้เบิกต้องเป็นสมาชิกที่ใช้งานได้ในร้านและสาขานี้',
  substitute_paid_expense_amount_locked: 'รายการนี้จ่ายเงินแล้ว ถ้าต้องแก้ยอด ให้แก้ไขรายการจ่ายก่อน ข้อมูลอื่นของเอกสารยังแก้และเซ็นใหม่ได้',
  expense_receipt_removal_locked: 'นำใบเสร็จออกได้เฉพาะรายการร่างหรือรอตรวจสอบที่ยังไม่จ่ายเงินและยังไม่บันทึกบัญชี',
  // Buyer expense capture (งานรับหลักฐาน). Each one says what to do next: a group is a job the
  // user came back to finish, so a dead end here loses the evidence they already sent.
  expense_capture_group_revision_conflict: 'งานรับหลักฐานนี้เปลี่ยนไปแล้ว เปิดหน้านี้ใหม่แล้วทำรายการอีกครั้ง',
  expense_capture_group_closed: 'งานรับหลักฐานนี้ปิดแล้ว ถ้าต้องแนบหลักฐานเพิ่ม ให้เริ่มงานใหม่',
  expense_capture_group_exists: 'รายการนี้อยู่ในงานรับหลักฐานอยู่แล้ว เปิดงานเดิมเพื่อทำต่อ',
  expense_capture_file_state_invalid: 'ไฟล์นี้ถูกตัดออกหรือถูกปฏิเสธแล้ว แนบไฟล์ใหม่',
  expense_capture_file_detach_blocked: 'ไฟล์นี้เป็นหลักฐานของรายการค่าใช้จ่ายหรือใบรับรองแล้ว ถ้าต้องนำออก ให้จัดการที่รายการนั้นก่อน',
  expense_capture_handoff_active: 'งานนี้สร้างรายการค่าใช้จ่ายไปแล้ว จัดการที่รายการค่าใช้จ่ายนั้น',
  expense_capture_convert_ineligible: 'แยกเป็นกลุ่มหลักฐานได้เฉพาะรายการที่ยังไม่ยืนยัน ยังไม่จ่ายเงิน และยังไม่อยู่ในใบเบิกหรือใบรับรอง',
  expense_capture_no_evidence: 'ยังไม่มีไฟล์หลักฐานในงานนี้ แนบไฟล์ก่อน',
  expense_capture_read_pending: 'เก็บไฟล์แล้ว กำลังอ่านเอกสาร รอสักครู่แล้วเปิดดูอีกครั้ง',
  expense_capture_facts_unavailable: 'ยังไม่มีข้อมูลจากไฟล์นี้ กรอกข้อมูลเองได้',
  // W04a — แก้ข้อมูลที่อ่านได้, ตรวจส่วนบริษัท และยอมรับการจัดส่วน
  expense_capture_facts_patch_empty: 'ยังไม่มีการแก้ไขข้อมูล แก้ค่าที่ต้องการก่อนบันทึก',
  expense_capture_facts_patch_unsupported: 'ข้อมูลนี้ยังแก้ไม่ได้ แก้ได้เฉพาะรายการสินค้า ยอดเงิน วันที่ หรือผู้ออกเอกสาร',
  expense_capture_facts_patch_unknown_target: 'ไม่พบรายการที่จะแก้ในไฟล์นี้ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  expense_capture_facts_patch_invalid_amount: 'กรอกเป็นตัวเลข ทศนิยมไม่เกิน 4 ตำแหน่ง',
  expense_capture_facts_patch_too_large: 'แก้ไขพร้อมกันได้ไม่เกิน 200 รายการ แบ่งบันทึกเป็นหลายครั้ง',
  expense_capture_review_input_invalid: 'ข้อมูลที่ส่งมาใช้ไม่ได้ เปิดหน้านี้ใหม่แล้วเลือกอีกครั้ง',
  expense_capture_tax_review_forbidden: 'การตัดสินเรื่องภาษีต้องใช้สิทธิ์ผู้ตรวจสอบค่าใช้จ่าย ส่งให้ผู้มีสิทธิ์ตรวจ',
  expense_capture_payer_forbidden: 'การระบุผู้จ่ายเป็นคนอื่นต้องใช้สิทธิ์ผู้ตรวจสอบค่าใช้จ่าย',
  expense_capture_payer_invalid: 'ผู้จ่ายต้องเป็นสมาชิกที่ใช้งานอยู่ของร้านและอยู่ในสาขาของงานนี้',
  expense_capture_allocation_blocked: 'ยังมีรายการที่ต้องตรวจก่อน จึงจะยอมรับการจัดส่วนของร้านได้',
  expense_capture_allocation_not_current: 'การจัดส่วนนี้ไม่ใช่ฉบับล่าสุดแล้ว ตรวจส่วนของร้านอีกครั้ง',
  expense_capture_allocation_stale: 'ข้อมูลของงานนี้เปลี่ยนหลังคำนวณการจัดส่วน ตรวจส่วนของร้านอีกครั้ง',
  // Blockers ของการจัดส่วน (W04a): ข้อความในหน้ากลุ่มมาจาก server ส่วนนี้คือคำอธิบายกลาง
  expense_capture_review_required: 'ตรวจส่วนของร้านและผู้จ่ายก่อน จึงจะสร้างรายการค่าใช้จ่ายได้',
  expense_capture_business_use_required: 'ยังไม่ได้ระบุว่ารายการนี้ใช้สำหรับร้านทั้งหมดหรือมีของส่วนตัวด้วย',
  expense_capture_funding_route_required: 'ยังไม่ได้ระบุว่าร้านจ่ายเองหรือพนักงานสำรองจ่าย',
  expense_capture_payer_required: 'ยังไม่ได้ระบุผู้จ่าย เลือกสมาชิกที่เป็นผู้จ่ายจริง',
  expense_capture_item_amount_unknown: 'มีสินค้าที่เลือกเป็นของร้านแต่ยังอ่านยอดไม่ได้ กรอกยอดจากหลักฐาน',
  expense_capture_document_mismatch: 'ยอดในเอกสารยังไม่ตรงกัน ตรวจจุดที่ไม่ตรงก่อนทำต่อ',
  expense_capture_component_unclassified: 'มีรายการเงินในเอกสารที่ยังไม่รู้ว่าเป็นค่าอะไร ระบุให้ครบ',
  expense_capture_expense_date_required: 'ยังไม่มีวันที่ของรายการนี้ เลือกวันที่จ่ายหรือวันที่บนเอกสาร',
  expense_capture_currency_unsupported: 'เอกสารนี้เป็นสกุลเงินต่างประเทศ ระบบยังไม่รองรับการแปลงค่าเงิน เก็บข้อมูลไว้ได้แต่ยังสร้างรายการค่าใช้จ่ายไม่ได้',
  expense_capture_company_paid_personal_portion: 'ร้านจ่ายเต็มจำนวนแต่มีของส่วนตัวรวมอยู่ ระบบยังไม่รองรับการเรียกคืนส่วนตัวจากร้าน',
  expense_capture_totals_identity_failed: 'ยอดที่แบ่งได้ยังไม่ตรงกับยอดรวมของเอกสาร แจ้งทีมงานพร้อมรหัสอ้างอิง',
  expense_capture_tax_review_pending: 'รอตรวจภาษีก่อน จึงจะนำไปทำใบเบิกได้',
  // W05 — สร้างรายการค่าใช้จ่ายจากการจัดส่วนที่ยอมรับแล้ว และการสร้างใหม่
  expense_capture_handoff_consumed: 'รายการค่าใช้จ่ายที่สร้างจากงานนี้ถูกนำไปใช้แล้ว (จ่ายเงิน บันทึกบัญชี ใบเบิก หรือใบรับรอง) แก้ไขที่รายการค่าใช้จ่ายนั้นแทน',
  expense_capture_handoff_totals_invalid: 'ยอดของรายการที่จะสร้างยังไม่ตรงกับยอดที่ตรวจไว้ แจ้งทีมงานพร้อมรหัสอ้างอิง',
  expense_capture_handoff_blocked: 'ยังมีรายการที่ต้องตรวจก่อน จึงจะสร้างรายการค่าใช้จ่ายได้',
  expense_capture_no_company_portion: 'การจัดส่วนนี้สรุปว่าไม่มีส่วนของร้าน จึงไม่มีรายการค่าใช้จ่ายให้สร้าง',
  // Spec §16.4 / UXE-21 and UXE-22: changing or adding a receipt file. The first two are "someone
  // moved this while you were choosing" — the file you sent is not evidence of anything yet, so the
  // way out is to reopen the record. The third is a state that has to be handled where it happened.
  expense_revision_conflict: 'รายการนี้เปลี่ยนไปแล้ว เปิดหน้านี้ใหม่ก่อนทำต่อ',
  expense_receipt_replace_conflict: 'ไฟล์ใบเสร็จของรายการนี้ถูกเปลี่ยนไปแล้ว เปิดหน้านี้ใหม่ก่อนเปลี่ยนไฟล์อีกครั้ง',
  expense_wht_category_payee_mismatch: 'จ่ายค่าอะไรไม่ตรงกับผู้รับเงิน เลือกประเภทเงินได้ให้ตรง หรือแก้ช่องผู้รับเงินเป็นใครให้ถูกต้อง',
  expense_receipt_replace_locked: 'รายการนี้อยู่ในสถานะที่เปลี่ยนหรือแนบไฟล์ตรงนี้ไม่ได้ เปิดรายการเพื่อดูขั้นตอนที่ทำได้',
  expense_receipt_replace_operation_conflict: 'การเปลี่ยนไฟล์ครั้งนี้ถูกใช้กับไฟล์อื่นไปแล้ว เปิดหน้านี้ใหม่แล้วเลือกไฟล์อีกครั้ง',
  invalid_response: 'ระบบขัดข้องชั่วคราว ลองอีกครั้ง',
  duplicate_supplier_document_number: 'เลขที่เอกสารผู้ขายนี้ถูกบันทึกสำหรับผู้ขายรายนี้แล้ว ตรวจสอบบิลเดิมก่อนสร้างซ้ำ',
  // Permissions / scope
  insufficient_permissions: 'คุณไม่มีสิทธิ์ทำรายการนี้ ขอสิทธิ์จากเจ้าของกิจการหรือผู้ดูแลสิทธิ์',
  TRANSACTION_BRANCH_REQUIRED: 'เลือกสาขาของรายการก่อน',
  TRANSACTION_BRANCH_INVALID: 'ไม่พบสาขาที่ใช้งานได้ในร้านนี้ เลือกสาขาอีกครั้ง',
  REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH: 'ใบเสร็จหรือค่าใช้จ่ายต้องระบุสาขาเดียวกับใบเบิก',
  legal_acceptance_not_required: 'บัญชีนี้ไม่ต้องยอมรับเอกสารกฎหมาย',
  platform_access_closed: 'ระบบกำลังปรับปรุง ลองอีกครั้งภายหลัง',
  platform_access_open_unavailable: 'ยังเปิดระบบไม่ได้จนกว่า production release จะผ่านการตรวจสอบครบถ้วน',
  // P12-3b: a spent/expired LINE deep-link handoff — same line the /login notice shows.
  line_handoff_unavailable: 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว เข้าสู่ระบบเพื่อเปิดรายการนี้',
  // P10-L §3.5: the LIFF start page asks for a session and the handoff route is switched off.
  line_web_handoff_disabled: 'ตอนนี้เปิดหน้าเว็บจาก LINE ไม่ได้ เข้าสู่ระบบที่หน้าเว็บโดยตรง',
  // P10 claim page. Both are 409s the applicant can act on, and both used to collapse into the
  // generic "ข้อมูลถูกเปลี่ยนแปลงระหว่างทำรายการ" — which named neither the cause nor a way out
  // (Owner UAT 2026-08-31: an applicant with an existing account hit a dead end here).
  email_already_registered_use_existing_account:
    'อีเมลนี้มีบัญชีมั่งมีพลัสอยู่แล้ว เข้าสู่ระบบด้วยบัญชีเดิมเพื่อผูกร้านใหม่',
  username_taken: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว ตั้งชื่อผู้ใช้อื่น',
  line_signup_resolution_required: 'กรุณาเลือกผลคำขอ LINE ให้ชัดเจนก่อนบันทึก',
  line_signup_existing_shop_proof_required: 'ร้านที่เลือกไม่อยู่ในสิทธิ์ LINE ที่ตรวจสอบล่าสุด กรุณาโหลดรายการใหม่',
  line_signup_repeat_trial_grant_required: 'บัญชีนี้เคยทดลองใช้ฟรีแล้ว กรุณายืนยันสิทธิ์ทดลองเพิ่มหรือส่งไปรอจัดแพ็กเกจ',
  line_signup_trial_grant_note_required: 'กรุณาระบุเหตุผลที่ให้ทดลองใช้ฟรีเพิ่ม',
  line_signup_resolution_note_required: 'กรุณาระบุข้อมูลที่ต้องขอจากลูกค้าให้ครบในครั้งเดียว',
  line_signup_shared_contact_review_required: 'อีเมลติดต่อซ้ำ กรุณายืนยันว่าเป็นข้อมูลติดต่อร่วมกันและบันทึกสิ่งที่ตรวจแล้ว',
  line_signup_submission_conflict: 'ข้อมูลไม่ตรงกับคำขอ LINE เดิม กรุณาโหลดสถานะล่าสุดก่อนทำต่อ',
  line_signup_version_conflict: 'คำขอ LINE ถูกแก้ไขระหว่างทำรายการ กรุณาโหลดรายการล่าสุดแล้วตรวจสอบอีกครั้ง',
  line_signup_contact_update_not_allowed: 'สถานะปัจจุบันแก้อีเมลติดต่อไม่ได้ กรุณาโหลดสถานะล่าสุด',
  support_request_changed: 'เคสนี้ถูกแก้ไขโดยทีมงานหรือลูกค้าระหว่างทำรายการ กรุณาโหลดใหม่และตรวจอีกครั้ง',
  support_request_not_claimed: 'กรุณารับเคสนี้ก่อนตอบหรือปิดเคส',
  support_request_owned_by_other: 'เคสนี้มีทีมงานคนอื่นรับผิดชอบอยู่ กรุณารับช่วงต่อพร้อมระบุเหตุผล',
  support_reply_operation_id_invalid: 'ข้อมูลการส่งข้อความไม่ถูกต้อง กรุณาโหลดเคสใหม่',
  support_reply_previous_operation_id_invalid: 'ข้อมูลข้อความล่าสุดไม่ครบ กรุณาโหลดเคสใหม่',
  support_reply_operation_payload_changed: 'การลองส่งซ้ำต้องใช้ข้อความเดิม กรุณาโหลดเคสใหม่',
  support_reply_in_progress: 'มีข้อความของเคสนี้กำลังส่งอยู่ กรุณาโหลดสถานะล่าสุด',
  support_reply_retry_same_operation: 'กรุณาลองส่งข้อความเดิมด้วยรายการเดิมก่อนสร้างข้อความใหม่',
  support_queue_cursor_invalid: 'ตำแหน่งหน้ารายการไม่ถูกต้อง กรุณาโหลดรายการใหม่',
  support_reclaim_input_invalid: 'กรุณาระบุเหตุผลรับช่วงต่อให้ครบและไม่เกิน 500 ตัวอักษร',
  support_resolution_note_invalid: 'กรุณาระบุผลที่แก้ไขให้ลูกค้าให้ครบและไม่เกิน 500 ตัวอักษร',
  line_signup_retry_not_available: 'ขั้นตอนรับคำขอนี้ทำต่อไม่ได้แล้ว กรุณาโหลดสถานะล่าสุด',
  // Feature entitlement vs launch availability — two DISTINCT states (spec:65, spec:335).
  // "not enabled" = the company has not turned the feature on.
  feature_not_enabled: 'ยังไม่ได้เปิดฟีเจอร์นี้',
  // "temporarily unavailable" = purchased and on, but its route is closed while the system
  // prepares. Never phrase this as "ไม่ได้ซื้อ" — the customer already owns it.
  feature_temporarily_unavailable: 'ส่วนนี้ใช้งานชั่วคราวไม่ได้ ระบบกำลังเตรียมการ',
  reimbursement_upgrade_in_progress:
    'ระบบกำลังอัปเกรดส่วนเบิกค่าใช้จ่ายชั่วคราว ข้อมูลที่กรอกยังอยู่ รอประมาณ 1 นาทีแล้วลองอีกครั้ง',
  reimbursement_changed: 'ใบเบิกถูกแก้ไขระหว่างทำรายการ เปิดรายการใหม่แล้วลองอีกครั้ง',
  reimbursement_draft_changed:
    'ใบเบิกถูกแก้ไขหรือส่งอนุมัติแล้ว เปิดหน้านี้ใหม่ ตรวจข้อมูล แล้วลองอีกครั้ง',
  line_incurred_date_invalid: 'เลือกวันที่รายการเบิกให้ถูกต้อง',
  line_incurred_date_in_future: 'วันที่รายการเบิกต้องไม่เกินวันนี้ (เวลาไทย) แก้วันที่ก่อนส่งอนุมัติ',
  expense_auto_post_not_enabled: 'ต้องเปิดระบบบัญชีแยกประเภทและ Auto-post ค่าใช้จ่ายก่อน',
  // Onboarding bootstrap: the standard expense-category template names accounts the company's
  // chart does not offer, so no category was seeded. The operator cannot fix this from the screen.
  expense_category_account_unmapped:
    'ผังบัญชีเริ่มต้นยังไม่มีบัญชีที่หมวดค่าใช้จ่ายมาตรฐานต้องใช้ ระบบจึงยังไม่ได้สร้างหมวดค่าใช้จ่าย ติดต่อผู้ดูแลระบบ',
  platform_feature_not_disableable: 'ฟีเจอร์พื้นฐานของระบบปิดไม่ได้',
  feature_cascade_confirmation_required: 'ปิดฟีเจอร์นี้จะปิดฟีเจอร์ที่ต้องพึ่งพากันด้วย กรุณายืนยันก่อน',
  export_too_large: 'รายงานมีข้อมูลเกิน 5,000 แถว กรุณาลดช่วงข้อมูลแล้วลองใหม่',
  export_source_changed: 'ข้อมูลรายงานเปลี่ยนระหว่างสร้างไฟล์ กรุณาลองใหม่',
  export_result_incomplete: 'สร้างไฟล์ได้ไม่ครบทุกแถว กรุณาลองใหม่',
  report_entitlement_changed: 'สถานะฟีเจอร์รายงานเปลี่ยนระหว่างทำรายการ ระบบยังไม่ได้บันทึก กรุณาลองใหม่',
  report_artifact_authority_changed: 'สิทธิ์ดูข้อมูลของคุณเปลี่ยนไป จึงเปิดรายงานหรือไฟล์เดิมนี้ไม่ได้',
  report_export_expired: 'ไฟล์นี้หมดอายุแล้ว',
  report_export_not_ready: 'ไฟล์นี้ยังไม่พร้อมดาวน์โหลด',
  report_export_unavailable: 'ไม่พบไฟล์เดิม',
  report_export_integrity_failed: 'ตรวจสอบไฟล์ไม่ผ่าน ระบบจึงไม่ส่งไฟล์นี้',
  ai_suggestion_needs_data: 'คำแนะนำนี้ยังมีข้อมูลไม่ครบ จึงทำได้เฉพาะสร้างคำแนะนำใหม่หรือปิดคำแนะนำ',
  ai_source_draft_unavailable: 'คำแนะนำนี้ยังไม่มีร่างที่สร้างได้ กรุณาตรวจข้อมูลต้นทางหรือสร้างคำแนะนำใหม่',
  // The company's entitlement rows are not normalized yet, so EVERY entitlement command is
  // refused with zero writes (F1.5.1). Nothing changed and there is nothing for the operator
  // to do — the copy must not read as an error they can retry their way out of.
  company_entitlement_normalization_pending: 'ระบบกำลังเตรียมสิทธิ์ให้ ไม่ต้องดำเนินการ',
  entitlement_command_conflict: 'คำขอนี้ถูกใช้ไปแล้วด้วยข้อมูลอื่น กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  entitlement_set_version_conflict: 'แพ็กเกจถูกแก้ไขโดยผู้อื่นระหว่างบันทึก กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  ocr_config_version_conflict: 'การตั้งค่า OCR ถูกแก้ไขโดยผู้ดูแลคนอื่น ระบบยังไม่ได้บันทึก กรุณาโหลดค่าล่าสุดแล้วตรวจสอบอีกครั้ง',
  // The page reloads the partner detail itself on this 409, so the sentence asks for a check, not a reload.
  manual_expense_web_entry_version_conflict: 'ค่านี้ถูกเปลี่ยนไปแล้ว กรุณาตรวจค่าล่าสุดก่อนบันทึกอีกครั้ง',
  disbursement_voucher_web_entry_version_conflict: 'การตั้งค่านี้เปลี่ยนไปแล้ว กรุณาโหลดหน้านี้ใหม่แล้วลองอีกครั้ง',
  // P10-L §15.1: the monthly AI image-read ceiling. Worded as reads, not receipts, because the
  // admission charges every image the assistant looks at. The receipt itself was saved — only the
  // read was refused — so the copy says what still works before it says what to do about the
  // ceiling. No number: the browser's ApiError keeps only `code`, and a wrong count is worse than none.
  receipt_quota_exceeded: 'โควตาให้ AI อ่านรูปของเดือนนี้ครบแล้ว (ใบเสร็จ 1 ใบ = 1 ครั้ง) ยังกรอกรายการเองได้ตามปกติ หรือขอเปลี่ยนแพ็กเกจเพื่อเพิ่มจำนวนครั้งได้เลย',
  FREE_DOCUMENT_LIMIT_REACHED: 'ใช้สิทธิ์อ่านเอกสารฟรีของเดือนนี้ครบแล้ว ยังเปิดดูและแก้ร่างเดิมได้',
  FREE_DOCUMENTS_IN_FLIGHT: 'ระบบกำลังอ่านเอกสารที่ส่งไปก่อนหน้า กรุณารอผลก่อนส่งไฟล์ใหม่',
  FREE_MULTI_DOCUMENT_UNSUPPORTED: 'ไฟล์นี้มีเอกสารหลายฉบับ ระบบยังอ่านให้ไม่ได้ กรุณาส่งทีละฉบับ',
  entitlement_features_required: 'เลือกอย่างน้อยหนึ่งฟีเจอร์ก่อนบันทึก',
  entitlement_feature_invalid: 'ข้อมูลฟีเจอร์ไม่ถูกต้อง กรุณาโหลดหน้าใหม่',
  entitlement_feature_batch_too_large: 'จำนวนฟีเจอร์เกินรายการที่ระบบรองรับ กรุณาโหลดหน้าใหม่',
  entitlement_feature_duplicate: 'พบฟีเจอร์ซ้ำในคำขอ กรุณาโหลดหน้าใหม่',
  entitlement_feature_unknown: 'พบฟีเจอร์ที่ระบบไม่รู้จัก กรุณาโหลดหน้าใหม่',
  // Chart of accounts / posting readiness
  coa_template_not_found: 'ไม่พบ Template ผังบัญชีที่เลือก กรุณารีเฟรชแล้วลองใหม่',
  coa_template_invalid: 'Template ผังบัญชีไม่ผ่านการตรวจสอบ ระบบยังไม่เปลี่ยนข้อมูล',
  coa_template_checksum_mismatch: 'Template ผังบัญชีมีเวอร์ชันใหม่ กรุณา Preview ผลกระทบอีกครั้ง',
  coa_preview_changed: 'ผังบัญชีหรือข้อมูลอ้างอิงเปลี่ยนหลัง Preview กรุณาตรวจผลกระทบอีกครั้ง',
  coa_semantic_conflict: 'พบบัญชีรหัสเดียวกันแต่มีความหมายต่างกัน กรุณาตรวจรายการขัดแย้ง',
  coa_account_in_use_conflict: 'แทนที่บัญชีไม่ได้เพราะมีเอกสารหรือกฎใช้งานบัญชีนี้อยู่',
  coa_postcondition_failed: 'ตรวจผลหลังบันทึกผังบัญชีไม่ผ่าน ระบบยกเลิกการเปลี่ยนแปลงแล้ว',
  coa_posting_readiness_incomplete: 'ผังบัญชีหรือกฎลงบัญชียังไม่พร้อมสำหรับการลงบัญชีอัตโนมัติ',
  expense_belongs_to_reimbursement:
    'รายการนี้เป็นรายการค่าใช้จ่ายของใบเบิก จึงยกเลิก ปฏิเสธ หรือลบจากหน้ารายจ่ายไม่ได้ ให้ยกเลิกที่ใบเบิกในเมนูการเบิกจ่าย ระบบจะยกเลิกรายการนี้ให้เอง',
  expense_settled_via_reimbursement:
    'รายการนี้มาจากใบเบิก ระบบจะบันทึกการจ่ายให้เองเมื่อบันทึกจ่ายใบเบิก ไม่ต้องบันทึกจ่ายที่หน้านี้',
  branch_head_office_required: 'ปิดสาขานี้ไม่ได้ ร้านต้องมีสำนักงานใหญ่ที่ใช้งานอยู่อย่างน้อย 1 สาขา',
  branch_last_active_required: 'ปิดสาขานี้ไม่ได้ ร้านต้องมีสาขาที่ใช้งานอยู่อย่างน้อย 1 สาขา สร้างสาขาใหม่ก่อนแล้วค่อยปิดสาขานี้',
  branch_has_open_reimbursements: 'ปิดสาขานี้ไม่ได้ ยังมีใบเบิกของสาขานี้ค้างอยู่ ต้องจ่าย ไม่อนุมัติ หรือยกเลิกใบเบิกเหล่านั้นก่อน',
  branch_head_office_exists: 'ร้านนี้มีสำนักงานใหญ่อยู่แล้ว ร้านหนึ่งมีสำนักงานใหญ่ได้แห่งเดียว',
  ledger_account_invalid_for_bank: 'บัญชีที่ผูกกับธนาคารต้องเป็นบัญชีของบริษัทที่ใช้งานและลงรายการได้',
  // หน้าจับคู่รายการธนาคาร: รายการที่เลือกมาจากหน้าที่เปิดค้างไว้ และการจ่ายเงินคืนนั้นถูกยกเลิกไปแล้ว
  bank_match_payment_not_recorded: 'การจ่ายเงินคืนรายการนี้ถูกยกเลิกไปแล้ว จึงจับคู่ไม่ได้ กรุณากดรีเฟรชแล้วเลือกรายการอื่น',
  bank_match_state_changed: 'รายการนี้ถูกเปลี่ยนระหว่างจับคู่ กรุณากดรีเฟรชแล้วลองอีกครั้ง',
  output_tax_code_line_mismatch: 'รหัสภาษีที่หัวเอกสารไม่ตรงกับรายการภาษี กรุณาตรวจรหัสภาษีก่อนบันทึก',
  posting_rule_missing: 'ยังไม่มีกฎลงบัญชีที่ผ่านการตรวจสำหรับเอกสารนี้ จึงยังไม่สร้างรายการบัญชี',
  expense_correction_blocked: EXPENSE_CORRECTION_WORDS.unavailable,
  expense_disbursement_reserved: 'รายการนี้ถูกจองไว้ในใบเตรียมจ่าย ให้เปิดใบนั้นเพื่อตรวจสอบ หรือสอบถามผู้จัดทำก่อนทำรายการอีกครั้ง',
  expense_rejection_payments_recorded: expenseCorrectionBlockerMessage('recorded_payments'),
  expense_rejection_paid_balance: expenseCorrectionBlockerMessage('legacy_paid_balance'),
  expense_tax_source_changed: EXPENSE_CORRECTION_WORDS.sourceChanged,
  expense_payment_slip_invalid: 'ใช้ไฟล์นี้เป็นหลักฐานการจ่ายไม่ได้ แนบไฟล์ใหม่แล้วบันทึกจ่ายอีกครั้ง',
  expense_payment_correction_blocked: EXPENSE_CORRECTION_WORDS.unavailable,
  expense_paid_exceeds_payable: EXPENSE_CORRECTION_WORDS.paidExceedsPayable,
  wht_certificate_download_unavailable: EXPENSE_CORRECTION_WORDS.certificateUnavailable,
  expense_posting_source_changed: EXPENSE_CORRECTION_WORDS.sourceChanged,
  expense_wht_source_changed: EXPENSE_CORRECTION_WORDS.sourceChanged,
  expense_correction_source_changed: EXPENSE_CORRECTION_WORDS.sourceChanged,
  expense_payment_exceeds_outstanding: 'ยอดจ่ายต้องมากกว่า 0 และไม่เกินยอดคงเหลือที่ต้องจ่าย',
  expense_payment_changed: 'ยอดหรือสถานะการจ่ายเพิ่งถูกเปลี่ยน เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  expense_payment_already_cancelled: EXPENSE_CORRECTION_WORDS.paymentAlreadyCancelled,
  expense_payment_idempotency_conflict: 'ข้อมูลไม่ตรงกับรายการจ่ายที่บันทึกไว้ ตรวจประวัติการจ่ายก่อนบันทึกเป็นรายการใหม่',
  expense_payment_future_date: EXPENSE_CORRECTION_WORDS.futurePaymentDate,
  expense_payment_not_confirmed: EXPENSE_CORRECTION_WORDS.paymentOnUnconfirmed,
  expense_payment_date_already_confirmed: 'รายการจ่ายเปลี่ยนแล้ว เปิดรายการจ่ายใหม่เพื่อตรวจวันที่',
  expense_payment_invalid_date: 'วันที่จ่ายไม่ถูกต้อง เลือกวันที่จ่ายเงินจริงจากปฏิทิน',
  expense_payment_invalid_key: 'บันทึกรายการจ่ายไม่สำเร็จ เปิดหน้านี้ใหม่และตรวจประวัติการจ่ายก่อนบันทึกอีกครั้ง',
  expense_payment_invalid_method: 'เลือกวิธีจ่ายเงินจากรายการ',
  expense_payment_invalid_reference: 'ข้อมูลอ้างอิงการจ่ายต้องเป็นข้อความไม่เกิน 128 ตัวอักษร',
  claim_expense_settles_via_reimbursement: 'รายการที่มาจากใบเบิกต้องบันทึกการจ่ายผ่านขั้นตอนจ่ายคืนของใบเบิก',
  // Expense confirmation CAS guards — all mean "reload and try again"
  expense_confirmation_source_status_changed: 'เอกสารถูกเปลี่ยนสถานะระหว่างยืนยัน เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  expense_confirmation_source_version_changed: 'เอกสารถูกแก้ไขระหว่างยืนยัน เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  expense_confirmation_source_checksum_changed: 'ข้อมูลเอกสารเปลี่ยนไประหว่างยืนยัน เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  expense_confirmation_substitute_evidence_changed: 'ใบรับรองแทนใบเสร็จเปลี่ยนไประหว่างยืนยัน เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  expense_confirmation_tax_line_changed: 'รายการภาษีเปลี่ยนไประหว่างยืนยัน ตรวจรหัสภาษีแล้วลองอีกครั้ง',
  expense_confirmation_tax_evidence_changed: 'หลักฐานรายจ่ายเปลี่ยนไประหว่างยืนยัน ตรวจแล้วลองอีกครั้ง',
  expense_confirmation_accounting_period_locked: 'งวดบัญชีของเอกสารนี้ปิดแล้ว ต้องเปิดงวดก่อนจึงจะยืนยันได้',
  expense_confirmation_tax_period_locked: 'งวดภาษีของเอกสารนี้ยื่นหรือปิดแล้ว จึงยืนยันเข้างวดนี้ไม่ได้',
  EXPENSE_UPDATE_VERSION_REQUIRED: 'บันทึกไม่สำเร็จ เปิดหน้านี้ใหม่ก่อนบันทึกอีกครั้ง',
  EXPENSE_UPDATE_VERSION_INVALID: 'บันทึกไม่สำเร็จ เปิดหน้านี้ใหม่ก่อนบันทึกอีกครั้ง',
  EXPENSE_UPDATE_CONFLICT: 'รายการถูกแก้ไขไปแล้ว เปิดหน้านี้ใหม่ ตรวจข้อมูล แล้วบันทึกอีกครั้ง',
  duplicate_tax_id: 'เลขประจำตัวผู้เสียภาษีนี้ถูกใช้กับลูกค้ารายอื่นแล้ว กรุณาเปิดข้อมูลลูกค้าเดิมหรือแก้เลขให้ถูกต้อง',
  sale_price_invalid: 'ราคาขายไม่ถูกต้อง กรุณากรอกจำนวนตั้งแต่ 0 ขึ้นไป',
  period_closed: 'งวดบัญชีนี้ปิดแล้ว หากต้องลงรายการ กรุณาให้ผู้มีสิทธิ์เปิดงวดก่อน',
  transaction_tax_needs_review: 'ข้อมูลภาษีของรายการนี้ต้องได้รับการตรวจสอบก่อน เปิดขั้นตอนตรวจภาษีแล้วทำให้ครบ',
  NOTIFICATION_RETRY_REVIEW_REQUIRED: 'รายการแจ้งเตือนเปลี่ยนแล้วหรือเป็นการแจ้งเตือนแพ็กเกจ เปิดหน้านี้ใหม่และตรวจรายการเดิมก่อนส่งอีกครั้ง',
  EXPENSE_DRAFT_DELETED: 'รายการที่บันทึกไว้ถูกลบแล้ว กลับไปรายการค่าใช้จ่าย',
  EXPENSE_DRAFT_KEY_CONFLICT: 'ข้อมูลที่บันทึกไม่ตรงกับรายการเดิม กลับไปรายการค่าใช้จ่ายเพื่อตรวจก่อนบันทึกใหม่',
  EXPENSE_NUMBER_OWNER_CONFLICT: 'เลขรายจ่ายไม่ตรงกับทะเบียน ติดต่อผู้ดูแลเพื่อตรวจเลขรายจ่ายนี้',
  EXPENSE_SOURCE_DRAFT_INCOMPLETE: 'ยังส่งให้ตรวจหรือยืนยันไม่ได้ เติมข้อมูลบิลที่ยังขาดแล้วบันทึกร่างก่อน',
  EXPENSE_DOCUMENT_REVIEW_INCOMPLETE: 'เลือกประเภทเอกสาร และเลือกว่าใช้เป็นหลักฐานรายจ่ายได้ไหม แล้วกดบันทึกการตรวจ',
  EXPENSE_EVIDENCE_REVIEW_REQUIRED: 'บันทึกการตรวจหลักฐานล่าสุดก่อนยืนยัน ถ้าเลือกใช้ใบรับรองแทนใบเสร็จ ต้องทำใบรับรองให้เสร็จก่อน',
  EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED: 'ตรวจวันที่ในใบเสร็จที่ขั้นตรวจข้อมูล แล้วบันทึกก่อนส่งให้ตรวจหรือยืนยัน',
  EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED: 'ข้อมูลใบเสร็จเปลี่ยนไปแล้ว เปิดหน้านี้ใหม่ก่อนบันทึก',
  // Vendor address spec §8: a refusal on this field must name the fix, because the user is looking
  // at the paper and can act — "ตัดให้สั้นลง" / "5 หลัก" are the whole message.
  // Counterparty registry. `accounting-documents` is outside the launch modules the coverage audit
  // scans, so nothing would have caught these — and the counterparty screen shows all three.
  // Vendor-address spec §10: supplying the payee address a frozen 50 ทวิ prefill never had. The
  // `tax` module is outside `api-error-coverage.spec.ts`'s launch list, so nothing audits these —
  // they are here because both strings reach the AP screen.
  wht_handoff_address_not_editable: 'รายการนี้ออกหนังสือรับรองไปแล้ว ที่อยู่ที่พิมพ์ที่นี่จึงไม่มีผลกับเอกสารที่ออกไป แก้ที่อยู่ผู้รับเงินได้ที่หน้าคู่ค้า',
  wht_payer_identity_missing: whtPayerIdentityMissingMessage(['REGISTERED_NAME', 'TAX_ID', 'ADDRESS']),
  wht_correction_field_locked: WHT_CERTIFICATE_CORRECTION_WORDS.fieldLocked,
  wht_handoff_payee_address_missing: WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE,
  wht_handoff_payee_address_required: 'พิมพ์ที่อยู่ผู้รับเงินตามที่จะพิมพ์ลงหนังสือรับรอง',
  counterparty_conflict: 'มีคนแก้ข้อมูลคู่ค้านี้ไปแล้ว เปิดหน้านี้ใหม่แล้วบันทึกอีกครั้ง',
  counterparty_address_too_long: 'ที่อยู่ยาวเกิน 500 ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง',
  counterparty_branch_code_invalid: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00000 สำหรับสำนักงานใหญ่ หรือเว้นว่างไว้ก็ได้',
  EXPENSE_VENDOR_BRANCH_CODE_INVALID: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00000 สำหรับสำนักงานใหญ่ หรือเว้นว่างไว้ก็ได้',
  EXPENSE_VENDOR_ADDRESS_TOO_LONG: 'ที่อยู่ผู้ขายยาวเกิน 500 ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง',
  EXPENSE_VENDOR_NAME_INVALID: 'ชื่อผู้ขายไม่ถูกต้อง กรอกชื่อใหม่',
  EXPENSE_VENDOR_NAME_TOO_LONG: 'ชื่อผู้ขายยาวเกิน 200 ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง',
  expense_reviewer_ineligible: 'คนนี้ยืนยันรายจ่ายของสาขานี้ไม่ได้ เลือกคนอื่น',
  // Vendor-address §8 Slice 2: the confirm-with-reason on a tax invoice whose printed buyer does not
  // match the company registry. Both name the next step — reload for the first, a reason for the second.
  expense_buyer_match_not_mismatch: 'ผู้ซื้อบนใบนี้ไม่ได้ขึ้นว่าไม่ตรงทะเบียนแล้ว เปิดหน้านี้ใหม่เพื่อดูผลล่าสุด',
  expense_buyer_match_reason_required: 'พิมพ์เหตุผลที่ใบนี้ใช้ได้ ไม่เกิน 500 ตัวอักษร แล้วกดบันทึกอีกครั้ง',
  EXPENSE_PURPOSE_TEXT_INVALID: 'ใช้ช่องว่างหรือจุลภาคแทนเครื่องหมาย · ในช่อง “ซื้อไปใช้ทำอะไร” หรือเว้นช่องนี้ไว้ได้',
  EXPENSE_SOURCE_DRAFT_INVALID: 'ข้อมูลบางช่องไม่ถูกต้อง ตรวจวันที่ จำนวน ราคา และหมวดค่าใช้จ่ายแล้วลองอีกครั้ง',
  expense_source_line_identity_changed: 'รายการในบิลถูกแก้ไขระหว่างทำรายการ เปิดหน้านี้ใหม่ ตรวจข้อมูล แล้วบันทึกร่างอีกครั้ง',
  // Plan 13.11.B: a 400 body reaches the client as `code` only, so the amounts and the line to open
  // are shown on the VAT card itself (`expenseVatReconciliationMessage`). This says where to look.
  EXPENSE_VAT_RECONCILIATION_REQUIRED:
    'VAT จากเอกสารยังไม่ตรงกับที่ระบบคำนวณ ดูรายการที่ต้องตรวจในการ์ด VAT แล้วแก้ไข หรือเลือก “ใช้ยอดตามเอกสาร” พร้อมระบุเหตุผล',
  EXPENSE_VAT_OVERRIDE_INVALID:
    'ยังใช้ยอด VAT ตามเอกสารไม่ได้ ตรวจยอดต้นฉบับและอัตรา VAT ให้ครบ บันทึกข้อมูลล่าสุด แล้วเลือกรายการที่มี VAT เพื่อรับส่วนต่างพร้อมระบุเหตุผล',
  EXPENSE_VAT_TAX_TOLERANCE_REQUIRED:
    'VAT ตามเอกสารต่างเกินเกณฑ์ของรหัสภาษี ตรวจเอกสารและรหัสภาษีก่อนยืนยัน การเลือกใช้ยอดตามเอกสารข้ามเกณฑ์นี้ไม่ได้',
  EXPENSE_VAT_TAX_RATE_CONFLICT:
    'อัตรา VAT ของรายการไม่ตรงกับรหัสภาษี แก้อัตราหรือเลือกรหัสภาษีให้ตรงกับเอกสารก่อนยืนยัน',
  EXPENSE_VAT_OVERRIDE_STALE:
    'ข้อมูลค่าใช้จ่ายเปลี่ยนแล้ว เปิดหน้านี้ใหม่ ตรวจยอด VAT ล่าสุด แล้วเลือกใช้ยอดตามเอกสารอีกครั้ง',
  expense_confirmation_accepted_vat_changed:
    'ยอด VAT ขั้นสุดท้ายไม่ตรงกับยอดที่ยอมรับ ตรวจเอกสารและรหัสภาษีอีกครั้ง รายการนี้ยังไม่ได้ยืนยัน',
  EXPENSE_CHANGED_DURING_DELETE: 'รายการถูกแก้ไขระหว่างการลบ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  EXPENSE_NOT_DELETABLE: 'ลบได้เฉพาะรายการร่าง รายการที่ถูกปฏิเสธ หรือรายการรอยืนยันที่ยอดเป็น 0 และยังไม่จ่าย',
  EXPENSE_HAS_LINKED_DATA: 'ลบรายการไม่ได้ เพราะมีข้อมูลอื่นเชื่อมอยู่ ตรวจรายการที่เกี่ยวข้องก่อน',
  SUBSTITUTE_EVIDENCE_RETENTION_LOCKED: 'ลบไฟล์นี้ไม่ได้ เพราะใช้เป็นหลักฐานของใบรับรองแทนใบเสร็จที่เซ็นแล้ว',
  accounting_document_changed: 'เอกสารถูกแก้ไขหรือเปลี่ยนสถานะโดยผู้ใช้อื่น กรุณาโหลดข้อมูลใหม่ ตรวจสอบ แล้วจึงทำรายการอีกครั้ง',
  accounting_document_already_converted: 'ใบเสนอราคานี้ถูกแปลงเป็นเอกสารอื่นแล้ว กรุณาโหลดใหม่และตรวจสอบเอกสารที่สร้างไว้',
  accounting_active_receipt_must_be_voided: 'รายการนี้ออกใบเสร็จแล้ว กรุณายกเลิกใบเสร็จก่อน แล้วจึงยกเลิกการรับชำระ',
  accounting_active_child_document_must_be_voided: 'รายการนี้มีใบเสร็จหรือใบกำกับภาษีที่ยังใช้งานอยู่ กรุณายกเลิกเอกสารลูกก่อน แล้วจึงยกเลิกรายการต้นทาง',
  accounting_receipt_already_exists: 'ใบแจ้งหนี้นี้มีใบเสร็จที่ยังใช้งานอยู่แล้ว กรุณาเปิดใบเสร็จเดิมแทนการสร้างซ้ำ',
  accounting_tax_invoice_already_exists: 'เอกสารต้นทางนี้มีใบกำกับภาษีที่ยังใช้งานอยู่แล้ว กรุณาเปิดใบเดิมแทนการสร้างซ้ำ',
  quotation_command_conflict: 'คำสั่งนี้เคยใช้สร้างใบเสนอราคาด้วยรายละเอียดอื่นแล้ว กรุณาโหลดข้อมูลใหม่ก่อนลองอีกครั้ง',
  // Substitute-receipt lifecycle
  substitute_evidence_locks_lines: 'ใบรับรองแทนใบเสร็จที่เซ็นแล้วล็อกรายการไว้ ต้องจัดทำฉบับแก้ไขก่อนจึงจะแก้ได้',
  substitute_evidence_locks_expense: 'รายการนี้มีใบรับรองแทนใบเสร็จแล้ว จึงแก้ตรงนี้ไม่ได้ ให้แก้ผ่านการแก้ไขใบรับรอง',
  substitute_evidence_nonclaimable: 'ใบรับรองแทนใบเสร็จใช้ภาษีซื้อไม่ได้ เลือกหลักฐานรายจ่ายเป็น “ใช้ได้เมื่อมีหลักฐานอื่นประกอบ”',
  // The company answered "not registered" for this document's date. VAT paid is cost, not a claim.
  input_vat_no_vat_to_claim: 'เอกสารนี้ไม่มี VAT จึงใช้สิทธิภาษีซื้อไม่ได้ บันทึกรายจ่ายได้ตามเดิม',
  // Decision-condition codes are also recognized by the API code-coverage scanner.
  BUYER_MARK_UNDONE: 'ยกเลิกเครื่องหมายสิทธิภาษีซื้อแล้ว',
  DOCUMENT_TYPE_CHANGED: 'เปลี่ยนประเภทเอกสารแล้ว ตรวจสิทธิภาษีซื้ออีกครั้ง',
  input_vat_fixed: 'เอกสารนี้ใช้ภาษีซื้อไม่ได้ ตรวจประเภทเอกสารและข้อมูล VAT ก่อน',
  input_vat_reason_required: 'บอกเหตุผลที่ใช้ภาษีซื้อไม่ได้หรือเปลี่ยนสิทธิภาษีซื้อ ไม่เกิน 500 ตัวอักษร',
  input_vat_conditions_required: 'ติ๊กเงื่อนไขให้ครบก่อนเลือก “ใช้ได้ตามเงื่อนไข”',
  input_vat_attachment_required: 'แนบเอกสารก่อนเลือกใช้สิทธิภาษีซื้อ',
  input_vat_seller_tax_id_required: 'กรอกเลขผู้เสียภาษีผู้ขายให้ครบ 13 หลัก',
  input_vat_document_number_required: 'กรอกเลขที่เอกสารก่อนเลือกใช้สิทธิภาษีซื้อ',
  input_vat_usable_evidence_required: 'ตรวจหลักฐานรายจ่ายให้ใช้ได้ก่อนเลือกใช้สิทธิภาษีซื้อ',
  input_vat_company_identity_required: 'กรอกชื่อจดทะเบียนและเลขผู้เสียภาษีของร้านที่ตั้งค่าร้าน › ข้อมูลร้าน ก่อนใช้สิทธิภาษีซื้อ',
  input_vat_buyer_mismatch: 'ชื่อหรือเลขผู้เสียภาษีของร้านบนใบไม่ตรง ขอเอกสารที่ถูกต้องจากผู้ขาย',
  input_vat_buyer_confirmation_required: 'ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบ แล้วติ๊กยืนยันว่าตรงกับข้อมูลร้าน',
  input_vat_posted_journal_immutable: 'รายจ่ายนี้ลงบัญชีแล้ว จึงเปลี่ยนสิทธิภาษีซื้อไม่ได้ แม้กลับรายการบัญชีแล้ว',
  input_vat_expense_closed: 'รายจ่ายนี้ปิดแล้ว เปิดรายจ่ายที่ยังใช้งานเพื่อเลือกสิทธิภาษีซื้อ',
  expense_input_vat_decision_required: 'สิทธิภาษีซื้อกำหนดโดยระบบ บันทึกข้อมูลรายจ่ายได้โดยไม่ต้องส่งสิทธิภาษีซื้อ',
  input_vat_company_registration_unanswered: 'ตอบคำถาม “ร้านจดทะเบียน VAT หรือยัง” ที่ตั้งค่าร้าน › ข้อมูลร้าน ก่อนใช้สิทธิภาษีซื้อ',
  input_vat_not_available_company_not_vat_registered:
    'ร้านยังไม่ได้จดทะเบียน VAT ณ วันที่ของเอกสารนี้ จึงขอคืนภาษีซื้อไม่ได้ (VAT ที่จ่ายถือเป็นต้นทุน)',
  substitute_evidence_doc_type_locked: 'ประเภทเอกสารต้นฉบับถูกล็อกไว้ระหว่างที่ใบรับรองแทนใบเสร็จยังใช้งานอยู่',
  substitute_evidence_stale: 'ใบรับรองแทนใบเสร็จเปลี่ยนไปแล้ว เปิดหน้านี้ใหม่ก่อนยกเลิกหรือแก้ไข',
  substitute_evidence_expense_confirmed: 'ยกเลิกหรือแก้ใบรับรองแทนใบเสร็จได้เฉพาะเอกสารที่ยังไม่ยืนยันเท่านั้น',
  substitute_evidence_idempotency_conflict: 'มีการจัดทำใบรับรองด้วยข้อมูลอื่นไปแล้ว เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  substitute_funding_source_required: 'เลือกว่าร้านจ่ายเต็มจำนวนหรือพนักงานสำรองจ่ายเต็มจำนวน ถ้าเป็นใบรับรองเดิม ให้จัดทำฉบับแก้ไขและเซ็นใหม่',
  substitute_edit_requires_cancellation: 'เอกสารออกสมบูรณ์หรือบันทึกการจ่าย/บัญชีแล้ว ยกเลิกใบรับรองและจัดการรายการจ่าย บัญชี หรือใบเบิกที่เกี่ยวข้องก่อนแก้ไข',
  substitute_payment_month_confirmation_required: 'ยืนยันว่าจะเปลี่ยนเดือนที่จ่ายเงินโดยคงเลขเอกสารเดิม',
  substitute_facts_incomplete: 'ข้อมูลใบรับรองยังไม่ครบ แก้ไขใบรับรองเพื่อระบุผู้รับเงิน เหตุผล วัตถุประสงค์ และวันที่หรือวิธีจ่ายก่อนเซ็น ไม่ต้องยกเลิกเอกสาร',
  substitute_full_payment_required: 'รองรับเฉพาะร้านจ่ายเต็มจำนวนหรือพนักงานสำรองจ่ายเต็มจำนวน ตรวจข้อมูลและยืนยันการจ่ายให้ครบก่อนทำต่อ',
  substitute_existing_payment_details_mismatch: 'วันที่หรือวิธีจ่ายในใบรับรองไม่ตรงกับการจ่ายที่บันทึกไว้ ตรวจประวัติการจ่ายและยกเลิกใบรับรองก่อนสร้างใหม่ ถ้ารายการจ่ายเดิมผิด ให้ผู้มีสิทธิ์ยกเลิกรายจ่ายและกลับรายการก่อน',
  substitute_personal_settles_via_reimbursement: 'ใบรับรองนี้ระบุว่าพนักงานสำรองจ่ายแล้ว ให้คืนเงินพนักงานแยกต่างหากตามขั้นตอนการเงิน',
  substitute_source_has_live_claim: 'หลักฐานนี้เชื่อมกับใบเบิกที่ยังไม่จบ เปิดใบเบิกนั้นแล้วทำต่อที่ใบเบิก',
  substitute_correction_company_identity_changed: 'เลขผู้เสียภาษีของร้านเปลี่ยนจากใบรับรองเดิม ให้ผู้ดูแลหรือผู้ทำบัญชีตรวจข้อมูลร้านก่อนจัดทำฉบับแก้ไข',
  substitute_correction_financial_fields_locked: 'ฉบับแก้ไขนี้เปลี่ยนข้อมูลการเงินหรือหลักฐานเดิมไม่ได้ คงข้อมูลเดิมและแก้เฉพาะชื่อร้านหรือข้อมูลผู้เซ็นที่ต้องการ',
  substitute_correction_source_changed: 'ใบรับรองต้นทางหรือรายการค่าใช้จ่ายเปลี่ยนสถานะแล้ว เปิดหน้านี้ใหม่และตรวจก่อนจัดทำฉบับแก้ไข',
  substitute_snapshot_integrity_mismatch: 'ข้อมูลใบรับรองไม่ตรงกับข้อมูลที่บันทึกไว้ แจ้งทีมงานให้ตรวจก่อนทำต่อ',
  // W06 §12: ใบรับรองของรายการที่แยกมาจากกลุ่มหลักฐาน — เหตุผลที่ยังทำไม่ได้ พร้อมทางแก้
  substitute_capture_allocation_superseded: 'การจัดส่วนเปลี่ยนไปแล้ว สร้างรายการใหม่ก่อนทำใบรับรอง',
  substitute_capture_unpaid_evidence: 'หลักฐานของผู้ขายรายนี้ยังไม่แสดงว่าจ่ายเงินแล้ว (เช่น คำสั่งซื้อที่ยังรอจ่าย) จึงยังจัดทำใบรับรองแทนใบเสร็จไม่ได้ เพิ่มหลักฐานการจ่ายหรือยืนยันการจ่ายในกลุ่มหลักฐานก่อน',
  substitute_capture_document_mismatch: 'ยอดในเอกสารของผู้ขายรายนี้ยังไม่ตรงกัน ตรวจจุดที่ไม่ตรงในกลุ่มหลักฐานก่อนจัดทำใบรับรอง',
  substitute_capture_funding_route_mismatch: 'แหล่งเงินในใบรับรองต้องตรงกับผู้จ่ายที่ตรวจแล้วในกลุ่มหลักฐาน เลือกให้ตรงกันก่อน',
  substitute_combined_signing_denied: 'ยังไม่ได้ออกใบรับรอง เปิดหน้านี้ใหม่แล้วเซ็นตามขั้นตอนล่าสุด',
  substitute_paper_form_changed: 'ข้อมูลรายการหรือแบบฟอร์มเปลี่ยนแล้ว เปิดหน้านี้ใหม่และตรวจแบบฟอร์มก่อนทำต่อ',
  substitute_paper_submission_changed: 'เอกสารหรือฉบับที่ส่งตรวจเปลี่ยนแล้ว เปิดหน้านี้ใหม่และตรวจไฟล์ที่เซ็นอีกครั้ง',
  substitute_paper_upload_unavailable: 'ไฟล์ที่เซ็นนี้ยังใช้กับใบรับรองนี้ไม่ได้ เปิดหน้านี้ใหม่และอัปโหลดไฟล์อีกครั้ง',
  substitute_paper_upload_already_linked: 'ไฟล์นี้ถูกแนบใช้งานแล้ว อัปโหลดฉบับที่เซ็นสำหรับใบรับรองนี้ใหม่',
  expense_stale_reload: 'เอกสารถูกแก้ไขหลังการตรวจ เปิดหน้านี้ใหม่ก่อนจัดทำใบรับรองแทนใบเสร็จ',
  substitute_wet_signed_scan_not_linkable: 'แนบฟอร์มที่เซ็นด้วยมือไม่ได้ ต้องเป็นใบรับรองที่เตรียมไว้ ยังไม่มีภาพฟอร์ม และไฟล์ต้องเป็นรูปหรือ PDF ที่เปิดอ่านได้และไม่เกินจำนวนหน้าที่กำหนด',
  substitute_wet_signed_scan_checksum_mismatch: 'ภาพฟอร์มที่เซ็นด้วยมือไม่ตรงกับที่บันทึกไว้ตอนรับรอง แจ้งทีมงานก่อนใช้เอกสารนี้',
  substitute_print_history_unavailable: 'ไม่มีไฟล์หรือข้อมูลฉบับเดิมพอสำหรับพิมพ์เอกสาร ดูประวัติรายการ',
  substitute_print_artifact_unavailable: 'ไม่พบไฟล์เอกสารที่เก็บไว้ เปิดรายการอีกครั้ง ถ้ายังไม่พบ ให้แจ้งทีมงาน',
  substitute_certified_artifact_checksum_mismatch: 'ไฟล์ฉบับที่เซ็นไม่ตรงกับข้อมูลที่รับรองไว้ แจ้งทีมงานก่อนใช้เอกสารนี้',
  substitute_wet_signed_scan_not_renderable: 'ประกอบไฟล์เอกสารจากภาพฟอร์มที่เซ็นด้วยมือไม่ได้ แจ้งทีมงาน',
  LINE_RECEIPT_CONTINUATION_STALE:
    'รายการค่าใช้จ่ายถูกแก้ไขระหว่างส่งผลกลับใน LINE เปิดรายการล่าสุดแล้วตรวจก่อนทำต่อ',
  LINE_SUBSTITUTE_CONTINUATION_STALE:
    'รายการค่าใช้จ่ายหรือขั้นตอนจัดทำใบรับรองแทนใบเสร็จใน LINE เปลี่ยนไป เปิดรายการล่าสุดแล้วเริ่มขั้นตอนนี้ใหม่',
  expense_status_ineligible:
    'จัดทำใบรับรองแทนใบเสร็จได้เฉพาะรายการที่ยังเป็นร่าง อยู่ระหว่างตรวจ หรือพร้อมยืนยัน ตรวจสถานะรายการ',
  source_type_ineligible:
    'ประเภทเอกสารยังไม่ได้ตรวจ หรือเป็นประเภทที่ใช้ใบรับรองแทนใบเสร็จไม่ได้ ตรวจและเลือกประเภทเอกสารให้ถูกต้อง',
  check_bill_route_ineligible:
    'ทำขั้นตอนนี้ได้เฉพาะเช็กบิลที่จ่ายแล้วแต่ผู้ขายไม่มีใบเสร็จให้ กลับไปตรวจเอกสารและตอบเรื่องการจ่ายเงินก่อน',
  check_bill_route_required:
    'เปิดขั้นตอนจัดทำใบรับรองของรายการเดิม ยืนยันว่าจ่ายแล้วแต่ไม่มีใบเสร็จฉบับสุดท้าย และแนบหลักฐานการจ่ายแยกจากเช็กบิล',
  check_bill_payment_evidence_required:
    'เช็กบิลไม่ใช่หลักฐานการจ่าย แนบหลักฐานการจ่ายจริงแยกจากเช็กบิล แม้จ่ายเงินสด แล้วจัดทำใบรับรองของรายการเดิมต่อ',
  payment_evidence_required:
    'แนบหลักฐานการจ่ายจริงแยกจากเอกสารต้นทางก่อนจัดทำใบรับรอง',
  substitute_evidence_overlap:
    'ใช้ไฟล์เดียวกันเป็นทั้งเช็กบิลหรือเอกสารต้นทางและหลักฐานการจ่ายไม่ได้ เลือกหลักฐานการจ่ายคนละไฟล์',
  substitute_evidence_unavailable:
    'หลักฐานที่เลือกใช้กับรายการนี้ไม่ได้แล้ว เปิดหน้านี้ใหม่แล้วเลือกหรือแนบหลักฐานอีกครั้ง',
  substitute_payment_evidence_invalid:
    'แนบรูปหรือ PDF หลักฐานการจ่ายจริงในช่องหลักฐานการจ่าย โดยใช้คนละไฟล์กับเช็กบิลหรือเอกสารต้นทาง',
  substitute_expense_changed:
    'รายการถูกแก้ไขหลังตรวจ เปิดหน้านี้ใหม่ ตรวจข้อมูลล่าสุด แล้วจัดทำใบรับรองอีกครั้ง',
  valid_receipt_normal_path:
    'เอกสารนี้มีใบเสร็จหรือใบกำกับภาษีที่ใช้ได้ ให้ทำตามขั้นตอนปกติ ใบรับรองแทนใบเสร็จใช้ได้เมื่อต้นฉบับไม่มีหรือข้อมูลสำคัญไม่ครบเท่านั้น',
  classification_ineligible:
    'รูปนี้ไม่ใช่หลักฐานค่าใช้จ่ายที่รองรับหรืออ่านข้อมูลไม่ชัด แนบหลักฐานค่าใช้จ่ายที่อ่านได้และตรวจประเภทเอกสาร',
  document_kind_ineligible:
    'ใบเสนอราคา ใบสั่งซื้อ ใบนัดหมาย ใบจอง หรือรูปที่ไม่ใช่ค่าใช้จ่าย ใช้จัดทำใบรับรองแทนใบเสร็จไม่ได้ แนบหลักฐานค่าใช้จ่าย',
  currency_not_supported:
    'ตอนนี้ใบรับรองแทนใบเสร็จใช้ได้เฉพาะรายการเงินบาท',
  reviewed_total_required:
    'ตรวจและยืนยันยอดรวมที่มากกว่า 0 ก่อนจัดทำใบรับรองแทนใบเสร็จ',
  reviewed_items_required:
    'ตรวจและกรอกรายละเอียดรายการค่าใช้จ่ายให้ครบก่อนจัดทำใบรับรองแทนใบเสร็จ',
  reviewed_category_required:
    'ตรวจและเลือกหมวดค่าใช้จ่ายหรือบัญชีให้ครบก่อนจัดทำใบรับรองแทนใบเสร็จ',
  tax_evidence_review_required:
    'เลือกว่าใช้เป็นหลักฐานรายจ่ายได้ไหมก่อนจัดทำใบรับรองแทนใบเสร็จ',
  tax_evidence_nonclaimable:
    'ใบรับรองแทนใบเสร็จใช้ขอคืนภาษีซื้อไม่ได้ เลือกหลักฐานรายจ่ายเป็น “ใช้ได้เมื่อมีหลักฐานอื่นประกอบ” หรือขอใบแทนใบกำกับภาษีจากผู้ขาย',
  substitute_receipt_too_many_lines:
    `ใบรับรอง 1 ใบรองรับได้สูงสุด ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines} รายการ แยกบันทึกเป็นหลายรายการค่าใช้จ่ายและจัดทำคนละใบ`,
  substitute_receipt_line_description_too_long:
    `รายละเอียดค่าใช้จ่ายแต่ละรายการต้องไม่เกิน ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength} ตัวอักษร กลับไปย่อรายละเอียดก่อนทำต่อ`,
  substitute_receipt_too_many_evidence:
    `ใบรับรอง 1 ใบรองรับหลักฐานรวมได้สูงสุด ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments} ไฟล์ นำไฟล์ที่ไม่จำเป็นออก`,
  substitute_receipt_evidence_filename_too_long:
    `ชื่อไฟล์หลักฐานต้องไม่เกิน ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceFileNameLength} ตัวอักษร เปลี่ยนชื่อไฟล์ให้สั้นลงแล้วอัปโหลดใหม่`,
  // Void-path CAS guards
  posting_state_changed: 'สถานะการลงบัญชีเปลี่ยนระหว่างยกเลิกเอกสาร ลองอีกครั้ง',
  expense_changed: 'เอกสารถูกแก้ไขก่อนยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  expense_changed_retry: EXPENSE_VOID_CERTIFICATE_WORDS.changedRetry,
  certificate_issued: EXPENSE_VOID_CERTIFICATE_WORDS.taxWorkspaceCertificate,
  expense_correction_branch_forbidden: EXPENSE_CORRECTION_WORDS.branchForbidden,
  expense_correction_not_found: EXPENSE_CORRECTION_WORDS.notFound,
  expense_correction_permission_missing: EXPENSE_CORRECTION_WORDS.permissionDenied,
  expense_correction_web_required: EXPENSE_CORRECTION_WORDS.webRequired,
  expense_void_number_unavailable: EXPENSE_VOID_CERTIFICATE_WORDS.numberUnavailable,
  expense_void_permission_missing: EXPENSE_VOID_CERTIFICATE_WORDS.permissionDenied,
  expense_void_reason_required: EXPENSE_VOID_CERTIFICATE_WORDS.reasonRequired,
  wht_certificate_correction_no_changes: WHT_CERTIFICATE_CORRECTION_WORDS.noChanges,
  wht_certificate_number_duplicate: WHT_CERTIFICATE_CORRECTION_WORDS.numberDuplicate,
  wht_certificate_payee_address_required: WHT_CERTIFICATE_CORRECTION_WORDS.payeeAddressRequired,
  wht_certificate_payee_name_required: WHT_CERTIFICATE_CORRECTION_WORDS.payeeNameRequired,
  certificate_attestation_required: REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.attestationRequired,
  reimbursement_cancellation_certificate_attestation_required: REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.attestationRequired,
  reimbursement_cancellation_certificate_issued: REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.taxWorkspaceCertificate,
  reimbursement_cancellation_certificate_permission_missing: REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.permissionMissing({ kind: 'SYSTEM', number: null }),
  reimbursement_cancellation_tax_period_locked: 'ภาษีของรายจ่ายในใบเบิกนี้ถูกล็อกแล้ว จึงยกเลิกใบเบิกไม่ได้ ให้ผู้ทำบัญชีตรวจเรื่องการยื่นแบบเพิ่มเติมก่อน แล้วลองอีกครั้ง',
  certificate_permission_missing: EXPENSE_VOID_CERTIFICATE_WORDS.permissionMissing,
  expense_certificate_attestation_required: EXPENSE_VOID_CERTIFICATE_WORDS.attestationRequired,
  reimbursement_cancellation_wht_certificate_on_expense: reimbursementCertificateCancellationMessage(null),
  wht_certificate_on_expense: reimbursementCertificateCancellationMessage(null),
  accounting_period_locked: 'งวดบัญชีของเอกสารนี้ปิดแล้ว ต้องเปิดงวดก่อนจึงจะยกเลิกได้',
  tax_period_locked: 'งวดภาษีของเอกสารนี้ถูกล็อกแล้ว ให้ใช้การปรับปรุงหรือยื่นแบบเพิ่มเติมแทน',

  // ---- รายการเบิกจ่าย: ส่งใบเบิก ----
  missing_receipt:
    'มีรายการที่ยังไม่มีใบเสร็จ แนบใบเสร็จให้ครบก่อนส่งใบเบิก',
  missing_receipt_reason_required:
    'มีรายการที่ยังไม่แนบหลักฐาน กรอกเหตุผลที่ไม่มีใบเสร็จก่อนส่งใบเบิก',
  duplicate_unresolved: REIMBURSEMENT_DUPLICATE_UNRESOLVED,
  duplicate_confirmed: reimbursementDuplicateBlockNotice(['EXPENSE_CONFIRMED_DUPLICATE']),
  invalid_primary_attachment: 'ไฟล์แนบต้องเป็นไฟล์ที่ผู้เบิกอัปโหลดเองและยังใช้งานอยู่',
  invalid_linked_expense: 'รายการค่าใช้จ่ายที่ผูกไว้ไม่ใช่ของผู้เบิก หรือถูกลบไปแล้ว',
  invalid_status_transition: 'ใบเบิกอยู่ในสถานะที่ทำรายการนี้ไม่ได้ เปิดหน้านี้ใหม่',

  // ---- รายการเบิกจ่าย: อนุมัติ ----
  // สามโค้ดนี้แยกกันเพราะเหตุผลที่กดไม่ได้ต่างกัน และสิ่งที่ผู้ใช้ต้องทำต่อก็ต่างกัน
  not_eligible_approver: 'คุณไม่ได้อยู่ในขั้นอนุมัติปัจจุบันของใบเบิกนี้',
  not_assigned_approver: 'ใบเบิกนี้ถูกมอบหมายให้ผู้อนุมัติคนอื่นแล้ว',
  not_eligible_approver_role: 'บทบาทของคุณไม่ตรงกับผู้อนุมัติที่กำหนดไว้ในขั้นนี้',
  self_approval_denied: REIMBURSEMENT_SELF_APPROVAL_DENIED,
  rejection_reason_required: 'กรอกเหตุผลที่ไม่อนุมัติ',
  // อนุมัติหรือปฏิเสธใบที่ไม่ได้รออนุมัติแล้ว: บอกสิ่งที่อาจเกิดขึ้นและสิ่งที่ต้องทำ ไม่พิมพ์ชื่อสถานะของใบ
  reimbursement_not_awaiting_approval:
    'ใบนี้ไม่ได้รออนุมัติแล้ว จึงยังไม่ได้บันทึกการตัดสินของคุณ อาจมีผู้อนุมัติหรือไม่อนุมัติไปก่อน หรือใบเบิกถูกยกเลิกหรือเปิดกลับเป็นร่างไปแล้ว เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด',
  stale_approval_snapshot: 'ใบเบิกถูกแก้ไขหลังส่งอนุมัติ เปิดดูรายละเอียดใหม่ก่อนตัดสินใจ',
  // ลงนามในสิ่งที่เห็น: ใบเบิกถูกแก้หลังกดดูตัวอย่าง คำยืนยันเดิมจึงใช้ไม่ได้
  stale_claim_snapshot: 'ใบเบิกถูกแก้ไขหลังคุณเปิดดู เปิดใบเบิกใหม่ก่อนเซ็น',
  stale_finance_review_snapshot: 'ใบเบิกถูกแก้ไขระหว่างที่คุณตรวจ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  finance_approval_already_decided: 'ใบเบิกนี้ถูกอนุมัติจ่ายโดยผู้ตรวจการเงินคนอื่นแล้ว ให้ผู้ที่อนุมัติเป็นผู้กด "ทำต่อ"',
  finance_correction_reason_required: 'กรอกสิ่งที่ต้องการให้ผู้เบิกแก้ไข',
  finance_review_note_too_long: 'เหตุผลต้องไม่เกิน 500 ตัวอักษร',
  // โค้ดนี้ใช้กับข้อความสองแบบ: หมายเหตุของฝ่ายการเงิน (แสดงในใบเบิกและส่งไปในแจ้งเตือนของผู้เบิก) กับเหตุผลที่จ่าย
  // ต่างจากที่ระบุในใบ (แสดงในแถวการจ่าย ไม่ได้ส่งไปในแจ้งเตือน) ข้อความจึงบอกเฉพาะสิ่งที่จริงทั้งสองแบบ
  note_contains_account_number: 'อย่าพิมพ์เลขบัญชีหรือตัวเลขยาวตั้งแต่ 6 หลัก ถ้าต้องอ้างบัญชี บอกแค่ 4 ตัวท้าย',
  reimbursement_correction_has_payment: 'ใบเบิกนี้มีการจ่ายเงินแล้ว ต้องยกเลิกการจ่ายก่อนส่งกลับแก้ไข',
  reimbursement_correction_has_projection: 'ใบเบิกนี้สร้างรายการค่าใช้จ่ายแล้ว ยกเลิกใบเบิกแล้วทำใบใหม่',
  invalid_finance_decision: 'เลือกผลการตรวจของฝ่ายการเงินใหม่',
  duplicate_resolution_reason_required: 'กรอกเหตุผลที่ยืนยันว่าไม่ใช่รายการซ้ำ ไม่เกิน 500 ตัวอักษร',

  // ---- รายการเบิกจ่าย: บัญชีรับเงินคืน ----
  // ทุกข้อความบอกสิ่งที่ต้องทำต่อ และไม่มีส่วนใดของเลขบัญชี
  payout_method_required: 'ยังไม่ได้เลือกวิธีรับเงินคืน แก้ไขใบเบิกเพื่อเลือกรับเป็นเงินสดหรือระบุบัญชี หรือตั้งบัญชีรับเงินคืนประจำ แล้วส่งอนุมัติอีกครั้ง',
  // บัญชีของใบเบิกเรียกว่า "บัญชีรับเงิน" ทุกที่ ส่วน "บัญชีรับเงินคืน" คือบัญชีประจำของสมาชิก
  payout_destination_required: 'ยังไม่ได้ระบุบัญชีรับเงิน ระบุบัญชี หรือเลือกรับเป็นเงินสด',
  payout_destination_invalid: 'ข้อมูลบัญชีไม่ครบหรือรูปแบบไม่ถูกต้อง ตรวจธนาคาร ชื่อบัญชี และเลขบัญชี',
  // เว็บที่เปิดค้างไว้ก่อนอัปเดตยังไม่มีช่องยืนยัน จึงต้องบอกให้โหลดหน้าใหม่ด้วย
  payout_verification_required: 'ต้องยืนยันว่าตรวจบัญชีรับเงินแล้วก่อนอนุมัติ เปิดใบเบิกแล้วติ๊กยืนยันในขั้นอนุมัติ ถ้าไม่เห็นช่องยืนยัน เปิดหน้านี้ใหม่',
  payout_destination_changed: 'บัญชีรับเงินของใบนี้เปลี่ยนไปจากที่แสดงไว้ เปิดหน้านี้ใหม่ ตรวจบัญชีที่แสดงล่าสุด แล้วทำรายการอีกครั้ง',
  // ขั้นจ่ายเงิน: เว็บที่เปิดค้างไว้ก่อนอัปเดตยังไม่มีช่องยืนยันและช่องเหตุผล จึงบอกให้โหลดหน้าใหม่ด้วย
  payout_confirmation_required: 'ต้องยืนยันว่าโอนเข้าบัญชีที่แสดงแล้ว ติ๊กช่องยืนยันก่อนกดบันทึกจ่าย ถ้าไม่เห็นช่องยืนยัน เปิดหน้านี้ใหม่',
  // พูดถึงวิธีที่ระบุในใบ ไม่พูดว่าผู้เบิกขอ: คนที่ทำใบแทน หรือคนที่เลือกแทนผู้เบิกตอนใบถูกส่งกลับ อาจเป็นคนเลือกวิธีนั้น
  payment_method_mismatch_reason_required: 'วิธีจ่ายต่างจากที่ระบุในใบ กรอกเหตุผลก่อนกดบันทึกจ่าย ถ้าไม่เห็นช่องเหตุผล เปิดหน้านี้ใหม่',
  payout_reveal_denied: 'คุณไม่มีสิทธิ์ดูเลขบัญชีเต็มของใบนี้',
  payout_account_not_set: 'ยังไม่ได้ตั้งบัญชีรับเงินคืนประจำ',
  payout_account_edit_denied: `คุณตั้งบัญชีรับเงินคืนของคนนี้ไม่ได้ ให้เจ้าของบัญชีตั้งเอง หรือให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือ${THAI_SYSTEM_ROLE_NAMES.ADMIN}ตั้งให้`,
  payout_member_not_found: 'ไม่พบพนักงานคนนี้ในร้าน',
  // ระบบต้องแจ้งเจ้าของบัญชีทุกครั้งที่คนอื่นตั้งให้ และแจ้งได้เฉพาะสมาชิกที่ยังใช้งานอยู่
  payout_account_member_not_active: 'ตั้งบัญชีรับเงินคืนแทนได้เฉพาะเมื่อเจ้าของบัญชียังใช้งานระบบอยู่ เพราะระบบต้องแจ้งเจ้าของบัญชีทุกครั้ง เปิดใช้งานสมาชิกคนนี้ก่อน หรือให้เจ้าของบัญชีตั้งเองเมื่อเข้าใช้งานได้แล้ว',

  // ---- รายการเบิกจ่าย: ส่งกลับจากขั้นจ่ายเงินหลังอนุมัติ ----
  // ใบยังเป็นใบเดิม เลขที่เดิม เปลี่ยนได้เฉพาะวิธีรับเงินคืนและบัญชีรับเงิน ทุกข้อความไม่มีส่วนใดของเลขบัญชี
  // คำปฏิเสธเป็นประโยคตายตัวต่อรหัส ไม่รู้ว่าใบถืออะไรอยู่ จึงต้องจริงทุกกรณี: ใบที่ถูกส่งกลับอาจมีบัญชี ขอรับเป็นเงินสด
  // หรือยังไม่มีบัญชีเลย และคำตอบอาจเป็นบัญชีเดิมหรือเงินสด ทุกประโยคจึงไม่พูดว่า "แก้บัญชี"
  payout_correction_in_progress: 'ใบนี้ถูกส่งกลับเรื่องวิธีรับเงินคืน และยังไม่กลับมารอจ่าย จึงยังทำรายการนี้ไม่ได้ เปิดใบใหม่เพื่อดูว่าตอนนี้ใบรอใคร',
  payout_correction_not_allowed: 'ใบนี้ส่งกลับไม่ได้ในตอนนี้ ส่งกลับได้เฉพาะใบที่รอจ่ายและยังไม่ได้บันทึกจ่าย ถ้าบันทึกจ่ายแล้วต้องยกเลิกการจ่ายก่อน',
  payout_correction_denied: 'คุณไม่มีสิทธิ์ส่งกลับหรือเลือกวิธีรับเงินคืนของใบนี้',
  payout_correction_not_requested: 'ใบนี้ไม่ได้ถูกส่งกลับเรื่องวิธีรับเงินคืน เปิดใบใหม่เพื่อดูสถานะล่าสุด',
  payout_correction_name_mismatch_third_party: REIMBURSEMENT_PAYOUT_NAME_MISMATCH_THIRD_PARTY,
  payout_correction_reason_required: 'เลือกเหตุผลที่ส่งกลับ',
  payout_correction_note_too_long: 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร',

  // ---- รายการเบิกจ่าย: แบบฟอร์มและลายเซ็น ----
  // "ยังไม่มีเลขที่เอกสาร" คือเหตุผลจริงที่พิมพ์ไม่ได้ — บอกให้ตรง ไม่ใช่แค่ว่าสถานะไม่ถูก
  claim_form_requires_submitted: 'ต้องส่งอนุมัติให้ได้เลขที่ก่อน จึงจะพิมพ์ใบเบิกได้',
  claim_signature_role_not_eligible: 'คุณไม่ใช่ผู้มีสิทธิ์เซ็นในช่องนี้',
  claim_saved_signature_required: 'ยังไม่มีลายเซ็นของคุณ บันทึกลายเซ็นที่หน้าลายเซ็นของฉันก่อน บันทึกแล้วใช้เซ็นได้ทันที',
  claim_signature_must_be_png_or_jpeg_max_2mb: SIGNATURE_FILE_REQUIRED_MESSAGE,
  claim_signature_too_large: 'ไฟล์ลายเซ็นใหญ่เกิน 2 เมกะไบต์ ย่อขนาดแล้วอัปโหลดใหม่',
  claim_signature_attachment_invalid: 'ไม่พบไฟล์ลายเซ็นของคุณสำหรับใบเบิกนี้ อัปโหลดใหม่',
  claim_signature_upload_not_found: 'ไม่พบไฟล์ลายเซ็นที่กำลังอัปโหลด เลือกไฟล์ใหม่',
  claim_signature_bytes_mismatch: `ไฟล์ลายเซ็นไม่ใช่รูปภาพตามชนิดที่ระบุ อัปโหลด${SIGNATURE_FILE_TYPES_LABEL}`,
  claim_signature_checksum_mismatch: 'ไฟล์ลายเซ็นถูกเปลี่ยนหลังอัปโหลด เซ็นใหม่อีกครั้ง',
  claim_signature_unreadable: 'อ่านไฟล์ลายเซ็นในใบเบิกไม่ได้ เซ็นใหม่ในช่องนี้',
  claim_form_signed_copy_denied: 'คุณไม่มีสิทธิ์แนบใบเบิกที่เซ็นแล้วของใบนี้',
  claim_form_signed_copy_attachment_invalid: 'ไฟล์แนบไม่ถูกต้อง อัปโหลดใหม่',
  claim_form_signed_copy_must_be_pdf_or_image: 'ใบเบิกที่เซ็นแล้วต้องเป็นไฟล์ PDF หรือรูปภาพ',

  // หน้ารวมส่งชื่อตัวกรองที่ระบบไม่รู้จัก เกิดได้เมื่อเปิดหน้าเก่าค้างไว้ข้ามการอัปเดต
  reimbursement_list_bucket_invalid: 'ตัวกรองรายการนี้ใช้ไม่ได้ เปิดหน้านี้ใหม่แล้วเลือกตัวกรองอีกครั้ง',

  // ---- รายการเบิกจ่าย: จ่ายเงินและยกเลิก ----
  payment_date_invalid: 'วันที่จ่ายเงินไม่ถูกต้อง',
  payment_reference_required: REIMBURSEMENT_PAYMENT_REFERENCE_TEXT.requiredMessage,
  [PAYMENT_DATE_IN_FUTURE.code]: PAYMENT_DATE_IN_FUTURE.message,
  // ระบบรับเฉพาะการจ่ายเต็มยอดคงค้าง ทั้งสองข้อความจึงบอกยอดที่ต้องกรอก
  payment_amount_invalid: 'จำนวนเงินที่จ่ายต้องมากกว่า 0 กรอกยอดคงค้างของใบเบิกแล้วกดบันทึกจ่ายอีกครั้ง',
  payment_over_approved_amount: 'จำนวนเงินที่จ่ายเกินยอดคงค้างของใบเบิก แก้เป็นยอดคงค้างแล้วกดบันทึกจ่ายอีกครั้ง',
  payment_idempotency_key_invalid: 'บันทึกจ่ายไม่สำเร็จ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  reimbursement_payment_already_recorded:
    'ใบเบิกนี้บันทึกการจ่ายไปแล้วด้วยข้อมูลที่ต่างจากที่กรอก เปิดหน้านี้ใหม่แล้วตรวจ',
  reimbursement_payment_idempotency_conflict:
    'มีการบันทึกการจ่ายด้วยข้อมูลอื่นไปแล้ว เปิดหน้านี้ใหม่แล้วตรวจ',
  reimbursement_payment_changed: 'การจ่ายเงินถูกเปลี่ยนระหว่างทำรายการ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  reimbursement_payment_state_changed: 'การจ่ายเงินถูกเปลี่ยนระหว่างทำรายการ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  reimbursement_payment_number_conflict: 'เลขที่ใบจ่ายไม่ตรงกับที่จองไว้ ลองอีกครั้ง',
  // สลิปการจ่ายเงินคืน
  payment_slip_required: 'จ่ายด้วยการโอนต้องแนบสลิป',
  payment_slip_invalid: 'ไฟล์สลิปใช้ไม่ได้ เลือกไฟล์ PDF หรือรูปภาพที่รองรับ ขนาดไม่เกิน 10 เมกะไบต์ แล้วลองอีกครั้ง',
  // ไฟล์ที่เลือกจากใบเบิกที่เซ็นแล้วไม่ได้ผิดชนิดหรือขนาด แต่ถูกใช้เป็นหลักฐานของรายการอื่นอยู่ด้วย
  payment_slip_in_use_elsewhere: 'ไฟล์นี้ถูกใช้เป็นใบเสร็จหรือเอกสารของรายการอื่นด้วย จึงใช้เป็นสลิปไม่ได้ แนบสลิปเป็นไฟล์ใหม่',
  // A declared signed copy offered as the slip without the payer's confirmation (a page loaded before the
  // picker asked for it, or another client). Nothing was moved; the reloaded page warns first, then sends it.
  payment_slip_signed_copy_unconfirmed:
    'ไฟล์นี้ถูกยืนยันไว้ว่าเป็นใบเบิกที่เซ็นครบ จึงยังไม่ได้ใช้เป็นสลิป ถ้าไฟล์นี้คือสลิปจริง เปิดหน้านี้ใหม่แล้วเลือกไฟล์อีกครั้ง หน้าจอจะบอกก่อนว่าไฟล์จะย้ายออกจากใบเบิกที่เซ็นแล้วและย้ายกลับไม่ได้',
  payment_slip_limit_reached: 'การจ่ายหนึ่งครั้งแนบสลิปได้ไม่เกิน 5 ไฟล์',
  payment_slip_access_denied: 'คุณไม่มีสิทธิ์เปิดสลิปของใบเบิกนี้',
  reimbursement_payment_slip_retained: 'ไฟล์นี้เป็นสลิปการจ่ายเงินคืน จึงลบไม่ได้',
  reimbursement_document_number_unavailable: 'ขอเลขที่เอกสารไม่สำเร็จ ลองอีกครั้ง',
  void_reason_required: 'ระบุเหตุผลที่ยกเลิกการจ่าย',
  // การยกเลิกการจ่ายเลิกจับคู่กับธนาคารให้เอง ยกเว้นรายการที่อยู่ในรอบกระทบยอดที่เสร็จสิ้นแล้ว ซึ่งต้องเปิดรอบนั้นใหม่ก่อน
  reimbursement_payment_bank_reconciled:
    'การจ่ายนี้จับคู่กับรายการเดินบัญชีธนาคารในรอบกระทบยอดที่เสร็จสิ้นแล้ว กด "เปิดใหม่" ที่รอบกระทบยอดนั้นในหน้าบัญชีธนาคารและกระทบยอดก่อน แล้วจึงยกเลิกการจ่ายอีกครั้ง',
  // ลำดับงานจริง: ต้องลงบัญชีตั้งหนี้ก่อน แล้วจึงจ่าย — บอกลำดับ ไม่ใช่แค่บอกว่าทำไม่ได้
  reimbursement_accrual_not_posted: 'ต้องลงบัญชีตั้งหนี้ของใบเบิกให้เสร็จก่อน จึงจะบันทึกการจ่ายได้',
  reimbursement_duplicate_settlement_pending:
    'ใบเบิกนี้ยังมีคำเตือนรายการซ้ำค้างอยู่ ตรวจรายการซ้ำก่อนจ่ายเงิน',
  reimbursement_duplicate_projection_posting_mismatch:
    'สถานะรายการซ้ำกับสถานะการลงบัญชีไม่ตรงกัน ตรวจรายการซ้ำอีกครั้ง',
  // ใบที่กำลังยกเลิกและยังยกเลิกไม่เสร็จ (ผลตรวจ B3): บอกว่าใบอยู่ในสภาพไหน และต้องทำอะไรต่อ
  cancellation_reason_too_short: 'เหตุผลที่ยกเลิกใบเบิกต้องยาวอย่างน้อย 3 ตัวอักษร',
  reimbursement_cancellation_pending: 'ใบเบิกนี้กำลังถูกยกเลิกและยังยกเลิกไม่เสร็จ จึงทำรายการนี้ไม่ได้ เปิดหน้านี้ใหม่',
  reimbursement_cancellation_already_pending: 'มีการขอยกเลิกใบเบิกนี้ด้วยเหตุผลอื่นค้างอยู่ เปิดหน้านี้ใหม่',
  reimbursement_cancellation_state_changed: 'ใบเบิกถูกเปลี่ยนระหว่างยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  reimbursement_cancellation_in_progress: 'ระบบกำลังยกเลิกใบเบิกนี้อยู่ เปิดหน้านี้ใหม่อีกครั้ง',
  reimbursement_cancellation_not_pending: 'ใบเบิกนี้ไม่มีการยกเลิกที่ค้างอยู่แล้ว เปิดหน้านี้ใหม่',
  reimbursement_cancellation_partly_done: 'ระบบยกเลิกรายการค่าใช้จ่ายของใบนี้ไปบางส่วนแล้ว จึงถอนการยกเลิกไม่ได้ ต้องยกเลิกต่อให้เสร็จ',
  reimbursement_cancellation_intent_changed: 'การยกเลิกใบเบิกนี้ถูกถอนไปแล้ว เปิดหน้านี้ใหม่',
  // ใบที่ตัดสินแล้วแต่ระบบยังดำเนินการไม่เสร็จ (ผลตรวจ B4): ปุ่ม "ดำเนินการต่อ"
  reimbursement_resume_in_progress: 'ระบบกำลังทำรายการของใบนี้อยู่ เปิดหน้านี้ใหม่อีกครั้ง',
  reimbursement_resume_not_allowed: 'ผู้ที่กดทำต่อได้คือผู้อนุมัติใบนี้ หรือผู้มีสิทธิ์บันทึกจ่ายสำหรับใบที่ไม่ต้องอนุมัติ',
  reimbursement_resume_unavailable: 'ตอนนี้ยังกดทำต่อไม่ได้ ติดต่อทีมงาน',
  reimbursement_cancellation_has_payment: 'ใบเบิกที่จ่ายเงินไปแล้วยกเลิกไม่ได้ ต้องยกเลิกการจ่ายเงินก่อน',
  reimbursement_cancellation_projection_live:
    'ยังมีรายการค่าใช้จ่ายที่สร้างจากใบเบิกนี้ค้างอยู่ ต้องยกเลิกรายการเหล่านั้นก่อน',

  // ---- รายการเบิกจ่าย: รายการค่าใช้จ่ายที่ระบบสร้างจากใบเบิก ----
  // ผู้ใช้ไม่ได้สร้างรายการเหล่านี้เอง ระบบสร้างให้ตอนอนุมัติจ่าย ข้อความจึงต้องบอกว่ามันคืออะไร
  // ไม่ใช่แค่ว่า "projection" ผิด
  reimbursement_projection_voided: REIMBURSEMENT_PROJECTION_VOIDED_MESSAGE,
  reimbursement_projection_not_ready: 'รายการค่าใช้จ่ายที่ระบบสร้างจากใบเบิกยังไม่พร้อม ลองอีกครั้ง',
  reimbursement_projection_not_confirmed: 'รายการค่าใช้จ่ายที่ระบบสร้างจากใบเบิกยังไม่ได้ยืนยัน',
  reimbursement_projection_source_changed: 'รายการในใบเบิกถูกแก้ไขระหว่างทำรายการ เปิดหน้านี้ใหม่',
  reimbursement_projection_source_mismatch: 'ไม่พบรายการค่าใช้จ่ายที่ระบบสร้างจากใบเบิกนี้ เปิดหน้านี้ใหม่',
  reimbursement_projection_state_changed: 'รายการค่าใช้จ่ายถูกเปลี่ยนระหว่างทำรายการ เปิดหน้านี้ใหม่',
  reimbursement_projection_decision_changed: 'ขั้นอนุมัติของใบเบิกเปลี่ยนไประหว่างทำรายการ เปิดหน้านี้ใหม่',
  reimbursement_projection_branch_changed: 'สาขาของรายการเปลี่ยนไประหว่างทำรายการ เปิดหน้านี้ใหม่',
  reimbursement_projection_authority_mismatch: 'รายการค่าใช้จ่ายนี้ไม่ได้มาจากใบเบิกที่กำลังทำรายการอยู่',
  reimbursement_projection_requires_true_reversal:
    'รายการนี้ยืนยันลงบัญชีไปแล้ว ต้องยกเลิกแบบกลับรายการ ลบทิ้งเฉย ๆ ไม่ได้',

  // ---- ตั้งค่านโยบายการเบิกจ่าย ----
  approver_role_required: 'เลือกบทบาทที่จะรับผิดชอบอนุมัติใบเบิก',
  approver_role_not_eligible: 'บทบาทนี้ยังไม่มีสิทธิ์หรือพนักงานที่พร้อมอนุมัติ เลือกบทบาทอื่น',
  reimbursement_approver_not_ready: 'ยังไม่มีผู้อนุมัติที่รับผิดชอบใบเบิกนี้ ให้ผู้ดูแลตรวจบทบาท สิทธิ์ และสาขา แล้วส่งใหม่',
  internal_note_body_invalid: 'เขียนโน้ตไม่เกิน 2,000 ตัวอักษร',
  reimbursement_policy_inactive: `ร้านปิดรับใบเบิกใหม่ชั่วคราว ติดต่อ${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือ${THAI_SYSTEM_ROLE_NAMES.ADMIN}`,
  reimbursement_policy_changed: 'การตั้งค่าถูกแก้โดยคนอื่น ระบบยังไม่บันทึกค่าของคุณ กดโหลดค่าล่าสุดแล้วตรวจอีกครั้ง',
  duplicate_company_policy: 'พบนโยบายของร้านซ้ำกัน ระบบยังไม่บันทึก ติดต่อทีมงาน',
  invalid_reimbursement_policy_snapshot: 'ข้อมูลนโยบายของใบเบิกนี้ใช้ไม่ได้ ระบบจึงหยุดรายการไว้เพื่อความปลอดภัย ติดต่อทีมงาน',
  invalid_approver_mode: 'เลือกรูปแบบผู้อนุมัติใหม่',
  invalid_duplicate_policy: 'เลือกนโยบายรายการซ้ำใหม่',
  invalid_threshold: 'ยอดที่ต้องขออนุมัติต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',
  invalid_sla_hours: 'จำนวนชั่วโมงที่กำหนดต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',

  // ---- พนักงาน: เพิ่ม/แก้ไข ----
  // แต่ละโค้ดชี้ช่องที่ชนจริง เพราะหน้าเพิ่มพนักงานมีหลายช่องที่ต้องไม่ซ้ำ
  employee_identity_conflict: 'มีพนักงานที่ใช้เลขบัตรประชาชนหรือพาสปอร์ตนี้อยู่แล้ว',
  employee_draft_not_found: 'ไม่พบพนักงานนี้แล้ว เปิดหน้ารายชื่อพนักงานใหม่',
  employee_draft_not_deletable: 'ลบได้เฉพาะร่างพนักงานที่ยังไม่เสร็จ ตรวจสถานะล่าสุดอีกครั้ง',
  employee_phone_conflict: 'มีพนักงานที่ใช้เบอร์โทรศัพท์นี้อยู่แล้ว',
  employee_email_conflict: 'มีผู้ใช้ที่ใช้อีเมลนี้อยู่แล้ว',
  employee_username_conflict: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว ตั้งชื่อผู้ใช้อื่น',
  // ไม่ใช่ความผิดพลาด — เป็นทางแยกให้ผู้ใช้เลือกผูกบัญชีเดิม ข้อความจึงต้องไม่อ่านเหมือนถูกปฏิเสธ
  employee_existing_user: 'บัญชีนี้มีอยู่ในระบบแล้ว ยืนยันเพื่อเพิ่มเป็นพนักงานของร้านนี้',
  employee_email_must_differ: 'อีเมลสำหรับร้านนี้ต้องไม่ซ้ำกับอีเมลเข้าสู่ระบบของบัญชีเดิม',
  // สร้างบทบาทใหม่ด้วยชื่อที่ตรงกับบทบาทมาตรฐาน (เช่น Owner, System Admin, Manager)
  role_name_reserved: 'ชื่อนี้ซ้ำกับบทบาทมาตรฐานของระบบ ใช้ชื่ออื่น',
  // บันทึกบทบาทพร้อมกันหลายรายการจนระบบจัดลำดับให้บทบาทนี้ไม่ทัน ไม่มีอะไรซ้ำ และกดบันทึกอีกครั้งได้เลย
  role_key_allocation_failed: 'ยังไม่ได้สร้างบทบาทนี้ เพราะมีการบันทึกบทบาทอื่นในเวลาเดียวกัน กดบันทึกอีกครั้ง',

  // ---- คำขอเกี่ยวกับข้อมูล: ขั้นตอนที่ปกติต้องทำโดยคนละคนกับขั้นก่อนหน้า ----
  data_rights_second_admin_required: 'คุณเป็นผู้ทำขั้นตอนก่อนหน้านี้เอง และตอนนี้ระบบมีผู้ดูแลระบบอีกคน ขั้นตอนนี้จึงต้องให้ผู้ดูแลระบบอีกคนเป็นผู้ทำ กรุณาโหลดหน้านี้ใหม่',
  data_rights_single_admin_reason_required: 'กรุณาเขียนเหตุผลที่ทำขั้นตอนนี้ด้วยตนเองก่อนยืนยัน',
  data_rights_single_admin_reason_invalid: 'เหตุผลสั้นหรือไม่ชัดเจนเกินไป กรุณาเขียนเป็นประโยคอย่างน้อย 20 ตัวอักษร',
  data_rights_single_admin_not_applicable: 'ขั้นตอนก่อนหน้านี้มีผู้ดูแลระบบอีกคนเป็นผู้ทำ จึงไม่ต้องยืนยันแบบทำคนเดียว กรุณาโหลดหน้านี้ใหม่แล้วลองอีกครั้ง',
  postal_code_invalid: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 3-5 หลัก',

  // ---- สิทธิ์และการเปิดปิดฟีเจอร์ ----
  entitlement_exception_evidence_required: 'กรุณาระบุหลักฐานอ้างอิงก่อนปิดฟีเจอร์ที่มีฟีเจอร์อื่นพึ่งพาอยู่',
  entitlement_exception_not_found: 'ไม่พบรายการยกเว้นนี้แล้ว กรุณาโหลดหน้าใหม่',
  entitlement_exception_snapshot_conflict: 'ข้อมูลสิทธิ์เปลี่ยนไประหว่างบันทึก กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  entitlement_normalization_hash_changed: 'ข้อมูลสิทธิ์เปลี่ยนไประหว่างบันทึก ระบบยังไม่ได้บันทึก กรุณาลองใหม่',
  entitlement_command_id_required: 'ข้อมูลคำขอไม่ครบ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  entitlement_set_version_required: 'ข้อมูลเวอร์ชันแพ็กเกจไม่ครบ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  feature_cascade_incomplete: 'ยังมีฟีเจอร์ที่พึ่งพากันอยู่และยังไม่ได้ปิด กรุณาตรวจรายการที่ระบบแจ้งก่อนยืนยัน',

  // ---- เข้าสู่ระบบ / บัญชีผู้ใช้ ----
  password_change_required: 'ต้องเปลี่ยนรหัสผ่านก่อนเข้าใช้งาน',
  password_reuse: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม',
  current_password_required: 'กรอกรหัสผ่านปัจจุบันก่อนเปลี่ยนรหัสผ่าน',
  current_password_incorrect: 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
  company_membership_disabled: 'บัญชีของคุณในร้านนี้ถูกปิดใช้งาน ให้เจ้าของกิจการหรือผู้ดูแลร้านเปิดใช้งานให้อีกครั้ง',
  company_access_unavailable: `คุณไม่มีสิทธิ์เข้าใช้ร้านนี้แล้ว ติดต่อ${THAI_SYSTEM_ROLE_NAMES.OWNER}`,
  // P29: business routes are refused on access because the shop has no usable package. Data is
  // intact — the copy must not read as data loss, and the only move that helps is choosing a
  // package, not retrying. Neutral between the two reasons (spec R2): the code alone cannot tell a
  // term that ended from a shop that never had one, and "ครบกำหนด" is wrong for the second.
  company_term_expired: 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ เลือกแพ็กเกจเพื่อเริ่มใช้งาน ข้อมูลทั้งหมดยังอยู่ครบ',

  // ---- P10-L §8 admin support tools (system console; the reader is an operator, not a shop) ----
  // SEC-05: each says what to change, because the operator has the message in front of them.
  partner_line_message_empty: 'ยังไม่ได้พิมพ์ข้อความ',
  partner_line_message_too_long: 'ข้อความยาวเกิน 500 ตัวอักษร กรุณาย่อให้สั้นลง',
  partner_line_message_external_link: 'ใส่ลิงก์ได้เฉพาะเว็บของเราและ LIFF เท่านั้น กรุณาลบลิงก์ภายนอกออก',
  line_messaging_channel_not_configured: 'ยังไม่ได้ตั้งค่าช่องทาง LINE ของระบบ จึงส่งข้อความไม่ได้',
  package_change_request_not_found: 'ไม่พบคำขอเปลี่ยนแพ็กเกจนี้ อาจถูกดำเนินการไปแล้ว กรุณาโหลดหน้าใหม่',
  package_change_company_locked: 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ หากต้องการเปลี่ยนให้เอง กดต่ออายุในหน้าพาร์ทเนอร์ก่อน',
  partner_activation_term_locked: 'ร้านนี้ยังไม่มีแพ็กเกจหรือแพ็กเกจหมดอายุ จึงเปิดใช้งานจากที่นี่ไม่ได้ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ หรือกดต่ออายุในหมวดแพ็กเกจ',
  line_identity_changed: 'การเชื่อมต่อ LINE เปลี่ยนแล้ว เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  line_identity_review_required: 'การเชื่อมต่อ LINE เดิมต้องให้ผู้ดูแลตรวจ ติดต่อผู้ดูแลเพื่อออก QR เชื่อม LINE ใหม่',
  line_link_retry: 'ยังเชื่อม LINE ไม่สำเร็จ สแกน QR เดิมอีกครั้ง ถ้าหมดอายุ ให้ผู้ดูแลออก QR ใหม่',
  line_linked_elsewhere: 'LINE นี้เชื่อมกับบัญชีอื่นอยู่แล้ว เลือกได้ว่าจะรวมเป็นบัญชีเดียวหรือใช้แยกกันต่อ',
  // Provisioning refused the LINE identity by name instead of letting a unique violation become
  // "ข้อมูลซ้ำ" — an operator reading that had nothing to do next. Both say what to change.
  line_identity_already_linked: 'LINE ของผู้สมัครผูกกับบัญชีอื่นอยู่ ต้องปลดการเชื่อมในหน้าพาร์ทเนอร์ก่อน แล้วกดอนุมัติอีกครั้ง',
  line_identity_disabled: 'LINE ของผู้สมัครถูกปิดใช้งานอยู่ ต้องเปิดใช้งานก่อน แล้วกดอนุมัติอีกครั้ง',
  // Spec §4F account merge — same copy the welcome dialog's own map shows, so the message reads
  // identically wherever the code surfaces.
  merge_ticket_invalid: 'คำขอรวมบัญชีหมดอายุแล้ว กดปุ่ม เชื่อมกับ LINE อีกครั้ง แล้วเลือกรวมบัญชี',
  merge_ticket_expired: 'คำขอรวมบัญชีหมดอายุแล้ว กดปุ่ม เชื่อมกับ LINE อีกครั้ง แล้วเลือกรวมบัญชี',
  merge_ticket_not_yours: 'บัญชีที่เข้าใช้อยู่ไม่ตรงกับคำขอนี้ เข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
  merge_in_progress: 'กำลังรวมบัญชีอยู่ รอสักครู่แล้วเปิดหน้านี้ใหม่',
  merge_target_unavailable: 'บัญชีเดิมใช้งานไม่ได้ในตอนนี้ ติดต่อทีมงานมั่งมี 098-256-5628',
  merge_not_needed: 'สองบัญชีนี้เป็นบัญชีเดียวกันอยู่แล้ว ไม่ต้องรวม',
  // Review R05: fail closed. Two accounts hold different access to the same shop, and merging would
  // decide on its own which side wins — including closing a shop's only owner out of it.
  account_merge_role_conflict: 'รวมบัญชีไม่ได้ เพราะสิทธิ์ในร้านที่ซ้ำกันไม่ตรงกัน ติดต่อทีมงานมั่งมี 098-256-5628',
  // Review F7: the self-serve window does not restart, so near its end a resent link would die
  // between the inbox and the tap. An operator reissue has no age limit and does restart it.
  claim_window_almost_over: 'ลิงก์หมดเขตแล้ว ขอลิงก์ใหม่จากทีมงานที่ 098-256-5628',

  // ---- ยอมรับข้อกำหนดการใช้งาน ----
  legal_acceptance_required: 'ต้องยอมรับข้อกำหนดการใช้งานและรับทราบประกาศความเป็นส่วนตัวก่อนใช้งาน',
  legal_acceptance_confirmation_required: 'ติ๊กยืนยันให้ครบทุกข้อก่อน',
  legal_acceptance_challenge_stale: 'บทบาทของคุณหรือข้อความทางกฎหมายเปลี่ยนไป เปิดหน้านี้ใหม่และอ่านอีกครั้ง',
  legal_document_version_stale: 'เอกสารทางกฎหมายมีฉบับใหม่ เปิดหน้านี้ใหม่และอ่านฉบับปัจจุบันก่อนยืนยัน',
  legal_acceptance_challenge_invalid: 'ข้อมูลยืนยันการอ่านใช้ไม่ได้ เปิดหน้านี้ใหม่',
  legal_acceptance_locale_unavailable: 'ขณะนี้รองรับการยอมรับเอกสารเฉพาะฉบับภาษาไทย',
  // ทางเดียวที่ผู้ใช้ทำได้จริงคือติดต่อฝ่ายสนับสนุน — กดซ้ำไม่ช่วย จึงต้องไม่เขียนว่า "ลองใหม่"
  legal_acceptance_incomplete: 'หลักฐานการยอมรับไม่ครบ ติดต่อทีมงานก่อนทำต่อ',

  // ---- ข้อมูลร้านและบัญชีของฉัน (P10-L §15.4) ----
  // ลูกค้าที่เปิดร้านจาก LINE ไม่เคยมีรหัสผ่านมาก่อน ข้อความจึงต้องบอกทางไปต่อ ไม่ใช่แค่บอกว่าผิด
  email_belongs_to_other_account:
    'อีเมลนี้มีบัญชีอื่นใช้อยู่แล้ว ถ้าเป็นบัญชีของคุณเอง เข้าสู่ระบบด้วยบัญชีเดิมแล้วผูก LINE เข้ากับบัญชีนั้น',
  account_email_conflict: 'อีเมลนี้มีบัญชีอื่นใช้อยู่แล้ว ใช้อีเมลอื่น อีเมลบัญชีของคุณยังไม่เปลี่ยน',
  account_email_changed: 'อีเมลบัญชีถูกเปลี่ยนจากอีกหน้าหรืออุปกรณ์แล้ว เปิดหน้านี้ใหม่ก่อนแก้อีกครั้ง',
  account_email_verified: 'อีเมลบัญชีนี้ยืนยันแล้ว ใช้ขั้นตอนเปลี่ยนอีเมลที่ยืนยันแล้ว',
  account_line_required: 'แก้อีเมลบัญชีด้วยวิธีนี้ได้เฉพาะบัญชีที่เชื่อม LINE อยู่ เชื่อม LINE ก่อน',
  invalid_email: 'รูปแบบอีเมลไม่ถูกต้อง กรอกใหม่ เช่น somchai@gmail.com',
  password_already_set: 'บัญชีนี้มีรหัสผ่านอยู่แล้ว ใช้เมนูเปลี่ยนรหัสผ่านแทน',
  // ถ้ายังไม่มีทั้งอีเมลบัญชีและชื่อผู้ใช้ รหัสผ่านที่ตั้งไว้จะใช้เข้าระบบไม่ได้เลย
  username_required: 'บัญชีนี้ยังไม่มีอีเมลบัญชี ตั้งชื่อผู้ใช้ไว้ใช้คู่กับรหัสผ่าน',
  // ต้องบอกกติกาให้ครบ เพราะคนไทยจะพิมพ์ชื่อไทยเป็นอย่างแรก
  invalid_username: 'ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข จุด ขีด และขีดล่าง ยาว 4 ถึง 64 ตัว (ภาษาไทยใช้ไม่ได้)',
  // `username_taken` already has copy above, shared with the Flow B claim screen.
  // Same sentence the profile form shows before it submits (PHONE_ERROR_MESSAGE in
  // features/company-profile/company-profile.logic.ts): one rule must not have two wordings.
  account_display_name_invalid: 'ชื่อที่แสดงต้องมี 1–160 ตัว แก้ชื่อแล้วบันทึกอีกครั้ง',
  invalid_phone_number: 'เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678',
  partner_owner_name_invalid: 'กรุณากรอกชื่อ 1–160 ตัวอักษร โดยไม่มีอักขระควบคุม',
  partner_owner_name_unavailable: 'ไม่พบเจ้าของร้านที่แก้ชื่อได้ในบริษัทนี้ กรุณาโหลดข้อมูลใหม่',
  partner_owner_name_conflict: 'ชื่อบัญชีถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง',
  // spec §15.4.1 C: EMAIL_PROVIDER=disabled — the request is refused before a token exists,
  // rather than answering 202 over a letter that was never sent.
  email_delivery_unavailable: 'ตอนนี้ระบบยังส่งอีเมลยืนยันไม่ได้ ติดต่อทีมงาน โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com',

  // ---- ตั้งค่าบริษัทและ VAT ----
  // จนถึง L-E ข้อความนี้ชี้ไปหน้าที่ยังไม่มีอยู่จริง ตอนนี้มีแล้วจึงเรียกชื่อเมนูตรง ๆ
  company_tax_identity_incomplete: 'ข้อมูลผู้เสียภาษีของร้านยังไม่ครบ กรอกให้ครบที่ ตั้งค่า › ข้อมูลร้าน ก่อน',
  company_business_type_invalid: 'เลือกประเภทธุรกิจจากรายการของกรมพัฒนาธุรกิจการค้า หรือเลือกอื่น ๆ',
  company_business_type_other_required: 'ระบุประเภทธุรกิจอื่น ๆ',
  company_business_type_other_invalid: 'ระบุประเภทธุรกิจอื่น ๆ ไม่เกิน 200 ตัวอักษร',
  company_business_type_version_conflict: 'ประเภทธุรกิจถูกแก้ไขแล้ว เปิดหน้านี้ใหม่ก่อนบันทึกอีกครั้ง',
  identity_change_kind_not_allowed: 'ข้อมูลชนิดนี้แก้เองไม่ได้ ติดต่อทีมงาน',
  vat_registration_future_fact_conflict:
    'มีการบันทึกสถานะจดทะเบียน VAT ล่วงหน้าไว้แล้ว เลือกว่าจะแทนที่รายการเดิมหรือเก็บไว้',
  vat_registration_backdated_crosses_filed_period:
    'วันที่จดทะเบียน VAT ย้อนหลังคร่อมงวดที่ยื่นแบบไปแล้ว ตรวจกับผู้ทำบัญชีก่อนบันทึก',

  // ---- คิวคำขอสมัครใช้งาน (P10 Flow B) ----
  // ทั้งสองโค้ดมาจาก company-signup-core.service และโผล่ที่ปุ่มอนุมัติ/ปฏิเสธ/ส่งลิงก์ใหม่ในคิว
  // ทางแก้เดียวกันคือโหลดคิวใหม่ ข้อความจึงชี้ไปที่คิว ไม่ใช่ให้กดซ้ำ
  company_signup_request_not_found: 'ไม่พบคำขอสมัครนี้',
  // R07/F6: the MX lookup could not answer, which says nothing about the address the applicant
  // typed. It may not read as a typo — the only correct instruction is to send the same form again.
  email_domain_check_unavailable: 'ตรวจอีเมลไม่ได้ชั่วคราว รอสักครู่แล้วกดส่งคำขอสมัครอีกครั้ง',
  company_signup_concurrent_transition:
    'คำขอสมัครนี้เพิ่งเปลี่ยนสถานะ เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด',

  // ---- Sales console + ดีลพิเศษ (sales-deals spec §11, SALES_ERROR_CODES) ----
  // Read by a เซลล์ on a phone in front of a shop owner, so each line names the next move rather
  // than the rule that refused. Nothing here ever quotes a price or a shop's data.
  SALES_DEAL_STATE_CONFLICT: 'ดีลนี้ถูกแก้ไขจากที่อื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง',
  SALES_DEAL_SELF_APPROVAL: 'อนุมัติดีลของตัวเองไม่ได้ กรุณาให้หัวหน้าทีมเป็นผู้อนุมัติ',
  SALES_DEAL_EXPIRED: 'ข้อเสนอนี้หมดอายุแล้ว กรุณาสร้างดีลใหม่ให้ลูกค้า',
  SALES_DEAL_ALREADY_OPEN: 'ร้านนี้มีดีลที่ยังไม่ปิดอยู่แล้ว กรุณาเปิดดีลเดิมเพื่อแก้ไข หรือยกเลิกก่อนสร้างใหม่',
  SALES_COMPANY_NOT_FOUND: 'ไม่พบร้านค้านี้ในระบบแล้ว กรุณาค้นหาร้านใหม่อีกครั้ง',
  SALES_COMPANY_HAS_OPEN_REQUEST: 'ร้านนี้มีคำขอเปลี่ยนแพ็กเกจของลูกค้าค้างอยู่ กรุณาให้ผู้ดูแลระบบปิดคำขอนั้นก่อนอนุมัติดีล',
  SALES_CODE_UNKNOWN: 'ไม่พบรหัสเซลล์นี้ ตรวจสอบกับเซลล์ของคุณ',
  SALES_CODE_TAKEN: 'รหัสเซลล์นี้มีผู้ใช้แล้ว กรุณาตั้งรหัสอื่น',
  SALES_CODE_INVALID: 'รหัสเซลล์ต้องเป็นตัวอักษรอังกฤษตัวใหญ่หรือตัวเลข 3–6 ตัว',
  // RB-36: every sales route answers this to the suspended account itself, lead or เซลล์.
  SALES_AGENT_SUSPENDED: 'บัญชีทีมขายถูกระงับ กรุณาติดต่อหัวหน้าทีมหรือผู้ดูแลระบบให้เปิดใช้งานอีกครั้ง',
  SALES_AGENT_NOT_FOUND: 'ไม่พบบัญชีเซลล์นี้แล้ว กรุณาโหลดรายชื่อทีมใหม่',
  SALES_TEAM_LEAD_INVALID: 'หัวหน้าทีมที่เลือกใช้ไม่ได้ กรุณาเลือกหัวหน้าทีมจากรายการอีกครั้ง',
  SALES_AGENT_USERNAME_TAKEN: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว กรุณาตั้งชื่อผู้ใช้อื่น',
  SALES_REFERRAL_WINDOW_CLOSED: 'ร้านนี้เปิดมาเกิน 30 วันแล้ว จึงแก้ผู้แนะนำไม่ได้',
  // Phase 4 (§17.1 flags, §17.2 report). The ผู้ดูแลระบบ reading these only needs the next move.
  SALES_REPORT_RANGE_INVALID: 'ช่วงเดือนไม่ถูกต้อง กรุณาเลือกเดือนเริ่มต้นและเดือนสิ้นสุดใหม่',
  SALES_FLAG_REVIEW_INVALID: 'ตรวจรายการนี้ไม่ได้แล้ว กรุณาโหลดรายการที่ถูกธงใหม่',

  // Phase 5 (§17.3 / D-P5-3, D-P5-6). Both are waits, not mistakes: the price the shop pays every
  // cycle is still being prepared, or the deal has already been told when to end. Neither reader —
  // เซลล์ or เจ้าของร้าน — has anything to fix, so each sentence says what to expect instead.
  SALES_DEAL_PRICE_PENDING: 'ระบบกำลังเตรียมราคาของข้อเสนอนี้ กรุณารอสักครู่แล้วลองอีกครั้ง',
  SALES_DEAL_END_INVALID: 'จบดีลนี้ไม่ได้แล้ว กรุณาโหลดข้อมูลล่าสุดเพื่อดูสถานะและวันสิ้นสุดของดีล',

  // ส่วนลดจากงาน, console side (sales-event-discounts spec §7.3). A หัวหน้าทีม setting up a batch or a
  // เซลล์ at the booth reads these, so each names the next move. Never "ตั๋ว", never a code.
  SALES_EVENT_BATCH_INVALID: 'ข้อมูลชุดส่วนลดไม่ครบหรือไม่ถูกต้อง กรุณาตรวจแต่ละช่องแล้วบันทึกอีกครั้ง',
  SALES_EVENT_REWARD_REQUIRED: 'ใส่ส่วนลดมากกว่า 0 บาท',
  SALES_EVENT_DISCOUNT_TOO_HIGH: 'ส่วนลดสูงเกินราคาของบางแพ็กเกจที่เลือก ลดจำนวนส่วนลด หรือเอาแพ็กเกจนั้นออกจากแพ็กเกจที่ลดได้',
  SALES_EVENT_BATCH_STALE: 'ข้อมูลชุดส่วนลดเปลี่ยนไปแล้ว กรุณาโหลดใหม่',
  SALES_EVENT_NOT_FOUND: 'ไม่พบชุดส่วนลดหรือรายการส่วนลดนี้แล้ว กรุณากลับไปที่รายการส่วนลดจากงาน',
  SALES_EVENT_CLAIM_CLOSED: 'ชุดนี้ยังไม่ถึงเวลาเปิดรับ ปิดรับแล้ว หรือถูกพักไว้ จึงแสดง QR ไม่ได้',
  SALES_EVENT_ISSUE_FULL: 'ส่วนลดของชุดนี้ถูกแจกครบจำนวนแล้ว ถ้าต้องการแจกเพิ่ม ให้หัวหน้าทีมเพิ่มจำนวนแจกสูงสุด',
  SALES_EVENT_AGENT_INACTIVE: 'คุณไม่ได้เป็นผู้แจกของชุดนี้แล้ว จึงแสดง QR ไม่ได้ กรุณาติดต่อหัวหน้าทีม',
  SALES_EVENT_TICKET_NOT_REVOCABLE: 'ส่วนลดนี้กำลังชำระหรือใช้แล้ว เพิกถอนไม่ได้',
  // Package page (Owner 2026-09-29): the held discount the buyer picked cannot lower this payment.
  SALES_EVENT_TICKET_UNAVAILABLE: 'ส่วนลดที่เลือกใช้กับการจ่ายนี้ไม่ได้ กรุณาเลือกส่วนลดอื่นหรือไม่ใช้ครั้งนี้',
  // LINE claim (SD-B): the scan page shows its own copy; these cover any other surface.
  SALES_EVENT_QR_INVALID: 'QR นี้ใช้ไม่ได้ ขอ QR ของงานนี้จากทีมขายอีกครั้ง',
  SALES_EVENT_SELF_CLAIM: 'บัญชีทีมขายรับส่วนลดนี้ไม่ได้',

  // ---- ข้อเสนอพิเศษ on the customer's package page (spec §19.2, Phase 3) ----
  // The shop owner reads these, so each one says what happens next, never why the rule refused.
  BILLING_DEAL_EXPIRED: 'ข้อเสนอพิเศษนี้หมดอายุแล้ว เลือกแพ็กเกจปกติหรือติดต่อทีมงาน',
  BILLING_DEAL_NOT_FOUND: 'ไม่พบข้อเสนอพิเศษนี้ เปิดหน้านี้ใหม่หรือติดต่อทีมงาน',
  BILLING_DEAL_SNAPSHOT_MISMATCH: 'ข้อเสนอพิเศษนี้เปลี่ยนแล้ว เปิดหน้านี้ใหม่แล้วตรวจข้อเสนอก่อนจ่ายเงิน',
  CONTROL_DEAL_SUBSCRIPTION_REVIEW: 'ร้านนี้มีสมาชิกที่ยังใช้งานอยู่ ทีมงานจะติดต่อกลับเพื่อเปลี่ยนให้ สิทธิ์เดิมยังใช้ได้ตามปกติ',
  BILLING_MODE_NOT_READY: 'วิธีจ่ายที่เลือกยังใช้ไม่ได้ เลือกวิธีอื่นหรือติดต่อทีมงาน',
  // Q7/S34: the deal is already applied and the old subscription is being cancelled in the
  // background. Nothing for the shop to do, so the line says so rather than naming a failure.
  DEAL_SUBSCRIPTION_CANCEL_PENDING: 'กำลังยกเลิกสมาชิกเดิมให้ร้านคุณ แพ็กเกจใหม่ใช้งานได้แล้ว ไม่ต้องดำเนินการอะไรเพิ่ม',
  // ---- CRM ลูกค้า การจอง และโอกาสขาย ----
  accounting_counterparty_not_active_in_company: 'คู่ค้าทางบัญชีของลูกค้ารายนี้ไม่ได้ใช้งานแล้ว กรุณาเลือกหรือเชื่อมคู่ค้าใหม่',
  active_work_blocks_archive: 'ยังปิดการใช้งานลูกค้ารายนี้ไม่ได้ เพราะมีงานที่ยังไม่เสร็จ กรุณาปิดงานที่ค้างก่อน',
  activity_target_required: 'กรุณาเลือกลูกค้าหรือโอกาสขายที่เกี่ยวข้องกับกิจกรรมนี้',
  assignedToUserId_required: 'กรุณาเลือกผู้รับผิดชอบลีด',
  assignee_not_active_company_member: 'ผู้รับผิดชอบที่เลือกไม่ได้เป็นสมาชิกที่ใช้งานอยู่ กรุณาเลือกคนใหม่',
  booking_not_editable: 'การจองนี้แก้ไขไม่ได้ในสถานะปัจจุบัน กรุณาตรวจสถานะล่าสุด',
  branch_not_active_in_company: 'สาขาที่เลือกไม่ได้ใช้งานอยู่ในบริษัทนี้ กรุณาเลือกสาขาใหม่',
  branchId_required: 'กรุณาเลือกสาขา',
  cannot_merge_customer_into_itself: 'รวมลูกค้ารายเดียวกันเข้าหากันไม่ได้ กรุณาเลือกลูกค้าคนละรายการ',
  child_target_mismatch: 'ข้อมูลที่เลือกไม่ได้อยู่ภายใต้รายการหลักนี้ กรุณาโหลดข้อมูลใหม่แล้วเลือกอีกครั้ง',
  choose_existing_or_new_customer: 'กรุณาเลือกว่าจะใช้ลูกค้าเดิมหรือสร้างลูกค้าใหม่',
  contradictory_customer_provenance: 'ข้อมูลแหล่งที่มาของลูกค้าขัดกัน กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก',
  customer_ai_summary_not_permitted_for_projection: 'มุมมองข้อมูลปัจจุบันไม่อนุญาตให้สร้างสรุปลูกค้าด้วย AI กรุณาเปิดจากหน้ารายละเอียดลูกค้าที่มีสิทธิ์',
  customer_and_identity_ids_required: 'กรุณาเลือกลูกค้าและบัญชี LINE ที่ต้องการเชื่อม',
  customer_consent_revoked: 'ลูกค้าถอนความยินยอมแล้ว จึงสร้างหรือแก้การจองนี้ไม่ได้',
  customer_contact_not_permitted: 'คุณไม่มีสิทธิ์ดูข้อมูลติดต่อลูกค้ารายนี้ กรุณาติดต่อผู้ดูแลสิทธิ์',
  customer_detail_not_permitted: 'คุณไม่มีสิทธิ์ดูรายละเอียดลูกค้ารายนี้ กรุณาติดต่อผู้ดูแลสิทธิ์',
  customer_details_required: 'กรุณากรอกข้อมูลลูกค้าใหม่ให้ครบ หรือเลือกลูกค้าเดิม',
  customer_ids_required: 'กรุณาเลือกลูกค้าที่ต้องการดำเนินการ',
  customer_ltv_sort_not_permitted_for_projection: 'มุมมองข้อมูลปัจจุบันไม่อนุญาตให้เรียงตามมูลค่าลูกค้า กรุณาเปลี่ยนการเรียงลำดับ',
  customer_merge_conflict: 'ข้อมูลลูกค้าเปลี่ยนระหว่างรวมรายการ กรุณาโหลดข้อมูลล่าสุดและตรวจสอบอีกครั้ง',
  customer_mutation_not_permitted_for_projection: 'มุมมองข้อมูลปัจจุบันแก้ไขลูกค้าไม่ได้ กรุณาเปิดหน้ารายละเอียดลูกค้าที่มีสิทธิ์',
  customer_not_active: 'ลูกค้ารายนี้ไม่ได้ใช้งานแล้ว กรุณาเลือกลูกค้าที่ใช้งานอยู่',
  customer_owner_filter_not_permitted_for_projection: 'มุมมองข้อมูลปัจจุบันไม่รองรับการกรองตามผู้ดูแลลูกค้า กรุณาล้างตัวกรองนี้',
  customer_provenance_is_immutable: 'แหล่งที่มาของลูกค้าเปลี่ยนจากหน้านี้ไม่ได้ กรุณาใช้ขั้นตอนที่สร้างลูกค้ารายการนี้',
  customer_provenance_managed_by_lead_conversion: 'แหล่งที่มาของลูกค้ารายนี้ถูกกำหนดจากการแปลงลีดและแก้จากหน้านี้ไม่ได้',
  customer_search_not_permitted: 'คุณไม่มีสิทธิ์ค้นหาลูกค้าในมุมมองนี้ กรุณาติดต่อผู้ดูแลสิทธิ์',
  customerId_required: 'กรุณาเลือกลูกค้า',
  date_must_be_yyyy_mm_dd: 'วันที่ไม่ถูกต้อง กรุณาเลือกวันที่จากปฏิทิน',
  date_required: 'กรุณาระบุวันที่',
  deposit_exceeds_total: 'เงินมัดจำต้องไม่มากกว่ายอดรวมของการจอง',
  displayName_must_be_string: 'ชื่อลูกค้าไม่ถูกต้อง กรุณากรอกเป็นข้อความ',
  displayName_required: 'กรุณาระบุชื่อลูกค้า',
  displayName_too_long: 'ชื่อลูกค้ายาวเกินไป กรุณาย่อชื่อแล้วลองใหม่',
  dueAt_required: 'กรุณาระบุวันและเวลาที่ต้องติดตาม',
  duplicate_candidate_requires_manager_review: 'พบลูกค้าที่อาจซ้ำและต้องให้ผู้จัดการตรวจสอบก่อนสร้างรายการใหม่',
  duplicate_customer_candidate: 'พบลูกค้าที่อาจเป็นรายเดียวกัน กรุณาตรวจลูกค้าเดิมก่อนสร้างซ้ำ',
  duration_must_be_1_to_3_hours_in_30_minute_increments: 'ระยะเวลาจองต้องอยู่ระหว่าง 1 ถึง 3 ชั่วโมง และเพิ่มครั้งละ 30 นาที',
  existing_customer_not_active: 'ลูกค้าเดิมที่เลือกไม่ได้ใช้งานแล้ว กรุณาเลือกลูกค้าอื่นหรือเปิดใช้งานก่อน',
  expectedCurrentCustomerId_required: 'ข้อมูลลูกค้าปัจจุบันไม่ครบ กรุณาโหลดรายการใหม่ก่อนเชื่อมบัญชี',
  follow_up_target_required: 'กรุณาเลือกลูกค้าหรือโอกาสขายที่ต้องติดตาม',
  idempotency_key_reused: 'คำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาโหลดหน้าใหม่ก่อนลองอีกครั้ง',
  invalid_booking_buffer_minutes: 'เวลาพักระหว่างการจองไม่ถูกต้อง กรุณาเลือกค่าที่ระบบรองรับ',
  invalid_booking_status_transition: 'เปลี่ยนการจองไปยังสถานะนี้ไม่ได้ กรุณาตรวจสถานะล่าสุด',
  invalid_contact_input: 'ข้อมูลผู้ติดต่อไม่ถูกต้อง กรุณาตรวจชื่อ เบอร์โทร และอีเมล',
  invalid_createdByType: 'แหล่งที่มาของผู้สร้างลูกค้าไม่ถูกต้อง กรุณาโหลดหน้าใหม่',
  invalid_customer_input: 'ข้อมูลลูกค้าไม่ถูกต้อง กรุณาตรวจช่องที่กรอกแล้วลองใหม่',
  invalid_duplicateOverride: 'ตัวเลือกยืนยันลูกค้าซ้ำไม่ถูกต้อง กรุณาโหลดผลตรวจซ้ำใหม่',
  invalid_idempotencyKey: 'ข้อมูลอ้างอิงคำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  invalid_isPrimary: 'ตัวเลือกผู้ติดต่อหลักไม่ถูกต้อง กรุณาโหลดข้อมูลใหม่',
  invalid_lead_conversion_input: 'ข้อมูลแปลงลีดเป็นลูกค้าไม่ถูกต้อง กรุณาตรวจตัวเลือกอีกครั้ง',
  invalid_line_identity_link_input: 'ข้อมูลเชื่อมบัญชี LINE ไม่ถูกต้อง กรุณาเลือกลูกค้าและบัญชีใหม่',
  invalid_merge_input: 'ข้อมูลรวมลูกค้าไม่ถูกต้อง กรุณาเลือกลูกค้าหลักและลูกค้าที่จะรวมใหม่',
  invalid_override: 'ข้อมูลยืนยันการดำเนินการไม่ถูกต้อง กรุณาโหลดข้อมูลล่าสุด',
  invalid_ownerUserId: 'ผู้ดูแลที่เลือกไม่ถูกต้อง กรุณาเลือกสมาชิกที่ใช้งานอยู่',
  invalid_phone: 'เบอร์โทรศัพท์ไม่ถูกต้อง กรุณาตรวจตัวเลขและรูปแบบอีกครั้ง',
  invalid_pipeline: 'ขั้นตอนการขายที่เลือกไม่ถูกต้อง กรุณาเลือกจากรายการ',
  invalid_primaryEmail: 'อีเมลหลักไม่ถูกต้อง กรุณาตรวจรูปแบบอีเมล',
  invalid_primaryPhone: 'เบอร์โทรหลักไม่ถูกต้อง กรุณาตรวจตัวเลขและรูปแบบอีกครั้ง',
  invalid_result: 'ผลของกิจกรรมไม่ถูกต้อง กรุณาเลือกจากรายการ',
  invalid_scope: 'ขอบเขตข้อมูลไม่ถูกต้อง กรุณาเลือกใหม่',
  invalid_search: 'คำค้นหาไม่ถูกต้อง กรุณาปรับคำค้นแล้วลองใหม่',
  invalid_sortBy: 'ตัวเลือกเรียงลำดับไม่ถูกต้อง กรุณาเลือกใหม่',
  invalid_staff_booking_source: 'ข้อมูลพนักงานของการจองไม่ถูกต้อง กรุณาเลือกพนักงานใหม่',
  invalid_status: 'สถานะที่เลือกไม่ถูกต้อง กรุณาเลือกจากรายการ',
  invalid_taxId: 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก',
  invalid_tier: 'ระดับลูกค้าที่เลือกไม่ถูกต้อง กรุณาเลือกจากรายการ',
  lead_identity_required: 'กรุณาระบุชื่อหรือข้อมูลติดต่อของลีดอย่างน้อยหนึ่งรายการ',
  lead_not_converted: 'ลีดนี้ยังไม่ได้แปลงเป็นลูกค้า กรุณาแปลงลีดก่อนสร้างโอกาสขาย',
  line_identity_link_required: 'กรุณาเลือกบัญชี LINE ที่ต้องการเชื่อมกับลูกค้า',
  name_must_be_string: 'ชื่อไม่ถูกต้อง กรุณากรอกเป็นข้อความ',
  name_required: 'กรุณาระบุชื่อ',
  name_too_long: 'ชื่อยาวเกินไป กรุณาย่อชื่อแล้วลองใหม่',
  note_required: 'กรุณาระบุบันทึก',
  originSource_requires_trusted_ingestion: 'แหล่งที่มานี้บันทึกได้เฉพาะจากช่องทางที่ระบบตรวจสอบแล้ว กรุณาใช้ขั้นตอนนำเข้าที่เกี่ยวข้อง',
  owner_not_active_company_member: 'ผู้ดูแลที่เลือกไม่ได้เป็นสมาชิกที่ใช้งานอยู่ กรุณาเลือกคนใหม่',
  ownerUserId_required: 'กรุณาเลือกผู้ดูแลลูกค้า',
  reason_required: 'กรอกเหตุผล',
  reason_too_long: 'เหตุผลยาวเกินไป กรุณาระบุไม่เกินจำนวนที่กำหนด',
  serviceName_required: 'กรุณาระบุบริการที่จอง',
  snoozedUntil_required: 'กรุณาระบุวันที่ให้กลับมาแจ้งเตือน',
  staff_already_booked_in_this_window: 'พนักงานคนนี้มีการจองในช่วงเวลาเดียวกัน กรุณาเลือกเวลาอื่นหรือพนักงานคนอื่น',
  staff_not_company_member: 'พนักงานที่เลือกไม่ได้เป็นสมาชิกของบริษัท กรุณาเลือกใหม่',
  staffUserId_required: 'กรุณาเลือกพนักงานผู้ให้บริการ',
  status_not_allowed_on_create: 'ไม่ต้องกำหนดสถานะตอนสร้างลูกค้า ระบบจะตั้งสถานะเริ่มต้นให้',
  title_required: 'กรุณาระบุหัวข้องานติดตาม',
  use_customer_archive_or_merge_action: 'กรุณาใช้คำสั่งปิดการใช้งานหรือรวมลูกค้าแทนการแก้สถานะโดยตรง',
  use_lead_conversion_action: 'กรุณาใช้คำสั่งแปลงลีดเป็นลูกค้าแทนการแก้สถานะโดยตรง',

  // ---- สินค้าและคลัง ----
  booking_duration_invalid: 'ระยะเวลาจองของสินค้าหรือบริการไม่ถูกต้อง กรุณาระบุจำนวนนาทีที่มากกว่า 0',
  customer_visible_invalid: 'ตัวเลือกการแสดงสินค้าให้ลูกค้าไม่ถูกต้อง กรุณาเลือกใหม่',

  // ---- การลงบัญชีของฟีเจอร์ที่เปิด ----
  close_check_failed: 'ยังปิดงวดบัญชีไม่ได้ กรุณาแก้รายการที่ไม่ผ่านการตรวจสอบแล้วลองอีกครั้ง',
  company_mismatch: 'รายการต้นทางไม่ได้อยู่ในบริษัทนี้ กรุณาเปิดรายการจากบริษัทที่ถูกต้อง',
  expense_backfill_confirmation_required: 'ดูตัวอย่างและยืนยันก่อนลงบัญชีเอกสารย้อนหลัง',
  expense_not_confirmed: 'ลงบัญชีได้เฉพาะค่าใช้จ่ายที่ยืนยันแล้ว ยืนยันเอกสารก่อน',
  expense_payment_not_recorded: 'ยังลงบัญชีการจ่ายไม่ได้ เพราะรายการจ่ายค่าใช้จ่ายยังไม่ถูกบันทึก',
  functional_currency_fx_required: 'รายการสกุลเงินต่างประเทศต้องมีอัตราแลกเปลี่ยนที่ตรวจสอบแล้วก่อนลงบัญชี',
  journal_already_reversed: 'รายการบัญชีนี้ถูกกลับรายการแล้ว กรุณาตรวจประวัติแทนการทำซ้ำ',
  ledger_account_not_postable: 'บัญชีที่เลือกลงรายการไม่ได้หรือไม่ได้ใช้งาน กรุณาเลือกบัญชีใหม่',
  legacy_o0_tax_review_required: 'รายการภาษีอัตรา 0% ต้องระบุเหตุผลและใช้รหัสภาษีที่ตรวจสอบแล้วก่อนลงบัญชี',
  legacy_tax_snapshot_review_required: 'ข้อมูลภาษีเดิมยังไม่ผ่านการตรวจสอบ กรุณาตรวจรหัสภาษีของรายการก่อนลงบัญชี',
  manual_journal_account_not_available: 'บัญชีที่เลือกไม่พร้อมใช้งานหรืออยู่นอกบริษัท กรุณาเลือกใหม่',
  manual_journal_branch_not_available: 'สาขาที่เลือกไม่พร้อมใช้งานหรืออยู่นอกบริษัท กรุณาเลือกใหม่',
  manual_journal_provenance_forbidden: 'ข้อมูลต้นทางและข้อมูลภาษีของรายการบัญชีถูกกำหนดโดยระบบ กรุณาโหลดหน้าใหม่แล้วกรอกเฉพาะช่องที่แสดง',
  posting_unbalanced: 'ยอดเดบิตและเครดิตไม่เท่ากัน ตรวจรายการบัญชีก่อนบันทึก',
  // บันทึกการจ่ายเงินคืนในเดือนที่ปิดงวดแล้วไม่ได้: บอกผู้จ่ายว่าต้องทำอะไรต่อ
  reimbursement_payment_accounting_period_locked:
    'วันที่จ่ายอยู่ในงวดบัญชีที่ปิดแล้ว จึงบันทึกการจ่ายไม่ได้ ตรวจวันที่จ่ายอีกครั้ง หากจ่ายในวันนั้นจริง ให้ผู้มีสิทธิ์เปิดงวดบัญชีก่อนแล้วจึงบันทึกใหม่',
  reimbursement_payment_not_recorded: 'ยังลงบัญชีการจ่ายไม่ได้ เพราะรายการจ่ายคืนพนักงานยังไม่ถูกบันทึก',
  tax_functional_currency_mismatch: 'สกุลเงินของข้อมูลภาษีไม่ตรงกับสกุลเงินหลักของบริษัท ตรวจรายการภาษี',
  tax_period_filed: 'งวดภาษีนี้ยื่นแบบ ชำระ หรือปิดแล้ว ใช้ขั้นตอนปรับปรุงแบบก่อนเปิดงวดบัญชี',
  unsupported_posting_source: 'แหล่งที่มาของรายการนี้ไม่รองรับการลงบัญชีอัตโนมัติ กรุณาใช้เมนูบันทึกรายการบัญชีด้วยตนเอง',

  // ---- การตั้งค่าภาษี ----
  tax_code_import_blocked: 'ยังนำเข้ารหัสภาษีไม่ได้ แก้ข้อผิดพลาดในตัวอย่างก่อนยืนยัน',
  pp36_historical_tax_snapshot_changed: 'ข้อมูลภาษี ภ.พ.36 เดิมเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจสอบอีกครั้ง',
  overlapping_active_profile_identity: 'มีชุดตั้งค่าภาษีที่ใช้งานในช่วงเวลาเดียวกัน กรุณาปรับช่วงวันที่ไม่ให้ซ้อนกัน',
  overlapping_default_profile: 'มีชุดตั้งค่าภาษีเริ่มต้นในช่วงเวลาเดียวกัน กรุณาปรับช่วงวันที่ไม่ให้ซ้อนกัน',
  invalid_tax_code_definition: 'ข้อมูลรหัสภาษีไม่ถูกต้อง กรุณาตรวจรหัส อัตรา และเงื่อนไข',
  missing_account_rule: 'รหัสภาษีนี้ยังไม่มีกฎผูกบัญชีที่จำเป็น กรุณาตั้งค่าบัญชีให้ครบ',
  missing_report_rule: 'รหัสภาษีนี้ยังไม่มีกฎลงแบบภาษีที่จำเป็น กรุณาตั้งค่าช่องรายงานให้ครบ',
  invalid_account_rule: 'กฎผูกบัญชีภาษีไม่ถูกต้อง กรุณาตรวจบัญชี บทบาท และช่วงวันที่',
  account_rule_effective_window_incomplete: 'กรุณาระบุวันเริ่มและวันสิ้นสุดของกฎผูกบัญชีให้ครบทั้งคู่',
  invalid_report_rule: 'กฎลงแบบภาษีไม่ถูกต้อง กรุณาตรวจแบบ ช่อง และแหล่งยอด',
  report_rule_effective_window_incomplete: 'กรุณาระบุวันเริ่มและวันสิ้นสุดของกฎลงแบบภาษีให้ครบทั้งคู่',
  tax_profile_incomplete: 'ชุดตั้งค่าภาษียังไม่ครบ แก้รายการที่ระบบระบุก่อนเปิดใช้งาน',
  profile_has_no_definitions: 'ชุดตั้งค่าภาษียังไม่มีรหัสภาษี กรุณาเพิ่มอย่างน้อยหนึ่งรายการ',
  profile_already_active: 'ชุดตั้งค่าภาษีนี้เปิดใช้งานอยู่แล้ว กรุณาโหลดสถานะล่าสุด',
  profile_readiness_blockers_truncated: 'พบรายการที่ต้องแก้มากกว่าที่แสดง กรุณาแก้รายการที่เห็นแล้วตรวจความพร้อมอีกครั้ง',
  invalid_tax_code_semantics: 'ความหมายหรือเงื่อนไขของรหัสภาษีขัดกัน กรุณาตรวจประเภทภาษีและอัตรา',
  legacy_transaction_tax_remediation_blocked: 'ยังแก้ข้อมูลภาษีเดิมไม่ได้ เพราะมีรายการที่ต้องตรวจ กรุณาดำเนินการตามรายการตรวจสอบก่อน',
  wht_handoff_link_command_reused: 'การแนบหนังสือรับรองครั้งนี้ถูกใช้กับรายการอื่นแล้ว เปิดหน้านี้ใหม่',
  wht_handoff_external_record_no_changes: WHT_EXTERNAL_RECORD_WORDS.noChanges,
  wht_external_file_invalid: WHT_EXTERNAL_FILE.invalid,
  wht_external_file_read_denied: WHT_EXTERNAL_FILE.readFromRecord,
  wht_external_file_retained: WHT_EXTERNAL_FILE.retained,
  wht_handoff_external_record_invalid: WHT_EXTERNAL_RECORD_WORDS.invalid,
  wht_handoff_external_issued_date_future: WHT_EXTERNAL_RECORD_WORDS.futureDate,
  wht_handoff_external_remove_permission_denied: WHT_EXTERNAL_RECORD_WORDS.removePermissionDenied,
  wht_handoff_external_remove_reason_invalid: WHT_EXTERNAL_RECORD_WORDS.removeInvalid,
  wht_handoff_external_remove_request_invalid: WHT_EXTERNAL_RECORD_WORDS.removeRequestInvalid,
  wht_handoff_external_change_permission_denied: WHT_EXTERNAL_RECORD_WORDS.permissionDenied,
  wht_handoff_not_linkable: WHT_EXTERNAL_RECORD_WORDS.notLinkable,
  wht_handoff_already_linked: WHT_EXTERNAL_RECORD_WORDS.alreadyLinked,
  wht_certificate_payment_date_mismatch: 'วันที่จ่ายบนหนังสือรับรองไม่ตรงกับรายการจ่าย ตรวจวันที่ในรายการจ่ายก่อนบันทึก',
  wht_certificate_payment_already_issued: 'รายการจ่ายนี้มีหนังสือรับรองแล้ว เปิดหนังสือรับรองเดิมเพื่อดาวน์โหลดหรือแก้ไข',
  wht_certificate_payment_required: 'ยังไม่มีรายการจ่าย บันทึกการจ่ายก่อนออกหนังสือรับรอง 50 ทวิ',
  wht_certificate_payment_date_required: 'ยังไม่ทราบวันที่จ่ายเงินจริง เปิดรายการจ่ายแล้วระบุวันที่ก่อนออกหนังสือรับรอง 50 ทวิ',
  wht_certificate_payment_selection_required: 'รายการนี้จ่ายหลายครั้ง เลือกรายการจ่ายที่จะออกหนังสือรับรอง 50 ทวิ',
  wht_handoff_not_issuable: workspaceDictionary.th['wht.print_certificate_not_issuable'],
  wht_system_issuance_unavailable: 'ระบบยังไม่เปิดการออกหนังสือรับรองในระบบ',
  wht_handoff_form_type_unresolved: 'ระบุแบบ ภ.ง.ด. ไม่ได้ ตรวจว่าผู้รับเงินเป็นบริษัทหรือบุคคลธรรมดาก่อนออกหนังสือรับรอง',
  wht_handoff_income_category_missing: 'รายการนี้ยังไม่มีประเภทเงินได้หรืออัตราหัก ณ ที่จ่าย กรอกให้ครบก่อนออกหนังสือรับรอง',
  wht_certificate_issue_in_progress: 'กำลังออกเอกสารนี้อยู่ ลองอีกครั้ง',
  wht_certificate_not_correctable: 'แก้ไขหรือออกใบแทนไม่ได้ เพราะไม่ใช่หนังสือรับรองที่ระบบออกให้ เปิดหน้านี้ใหม่แล้วตรวจสถานะ',
  wht_certificate_already_superseded: 'หนังสือรับรองนี้ถูกแทนที่ไปแล้ว เปิดหน้านี้ใหม่',
  wht_system_correction_unavailable: 'ระบบยังไม่เปิดการแก้ไขหนังสือรับรองอัตโนมัติ',
  wht_certificate_correction_tax_period_locked: 'รายการนี้ยื่นภาษีแล้ว แก้ข้อเท็จจริงไม่ได้ ให้ยกเลิกเอกสารแล้วบันทึกใหม่ ให้ผู้ทำบัญชีแจ้งกรมสรรพากรเรื่องแบบเดิม',
  wht_system_replacement_unavailable: 'ระบบยังไม่เปิดการออกใบแทนอัตโนมัติ',
  wht_signature_attachment_required: 'อัปโหลดรูปลายเซ็นก่อนเปิดใช้การประทับอัตโนมัติ',
  tax_reviewer_role_required: 'รายการนี้ต้องให้ผู้ตรวจภาษีทำ ติดต่อผู้ที่ได้รับมอบหมาย',

  // ---- กล่องข้อความลูกค้าและ AI ช่วยตอบ ----
  invalid_amountEstimate: 'ยอดประมาณการไม่ถูกต้อง กรุณากรอกตัวเลขตั้งแต่ 0 ขึ้นไป',
  invalid_expectedCloseDate: 'วันที่คาดว่าจะปิดการขายไม่ถูกต้อง กรุณาเลือกวันที่จากปฏิทิน',
  CONVERSATION_HAS_NO_TEXT: 'บทสนทนานี้ยังไม่มีข้อความให้นำไปวิเคราะห์',
  text_required: 'กรุณาระบุข้อความ',
  kind_invalid: 'ประเภทข้อมูลไม่ถูกต้อง กรุณาเลือกจากรายการ',
  rating_invalid: 'คะแนนต้องอยู่ในช่วงที่กำหนด กรุณาเลือกใหม่',
  feedback_request_id_required: 'ไม่พบรายการคำแนะนำที่ต้องการให้คะแนน กรุณาโหลดข้อมูลใหม่',
  PROVIDER_UNKNOWN: 'ไม่พบผู้ให้บริการ AI ที่ตั้งค่าไว้ กรุณาติดต่อผู้ดูแลระบบ',
  INVALID_BROADCAST_TOPIC: 'หัวข้อข้อความประกาศไม่ถูกต้อง กรุณาเลือกหัวข้อใหม่',
  AI_BROADCAST_UNAVAILABLE: 'ยังสร้างข้อความประกาศด้วย AI ไม่ได้ กรุณาลองใหม่ภายหลังหรือเขียนข้อความเอง',
  AI_LLM_RATE_LIMITED: 'มีการใช้ AI ถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  channel_disabled: 'ช่องทาง LINE นี้ปิดใช้งานอยู่ กรุณาเปิดใช้งานก่อนส่งข้อความ',
  customer_unfollowed: 'ลูกค้าเลิกติดตามบัญชี LINE แล้ว จึงส่งข้อความหาไม่ได้',
  customer_unavailable: 'ลูกค้ารายนี้ไม่พร้อมใช้งาน กรุณาตรวจสถานะลูกค้าและบัญชี LINE',
  customer_360_not_permitted_for_projection: 'มุมมองข้อมูลปัจจุบันไม่อนุญาตให้เปิดภาพรวมลูกค้า กรุณาเปิดจากหน้ารายละเอียดที่มีสิทธิ์',
  not_a_payment_proof_candidate: 'ข้อความหรือไฟล์นี้ไม่ใช่หลักฐานการชำระที่ระบบรองรับ กรุณาเลือกรายการใหม่',
  channel_not_found: 'ไม่พบช่องทาง LINE นี้แล้ว กรุณาโหลดรายการช่องทางใหม่',
  identity_not_verified: 'บัญชี LINE ของลูกค้ายังไม่ผ่านการยืนยันตัวตน กรุณายืนยันก่อนดำเนินการต่อ',
  consent_required: 'ต้องได้รับความยินยอมจากลูกค้าก่อนดำเนินการนี้',

  line_support_state_changed: 'สถานะคำขอความช่วยเหลือ LINE เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด',
  // ---- AI และผู้ให้บริการ ----
  AI_MONTHLY_BUDGET_EXCEEDED: 'เครดิต AI ของเดือนนี้หมดแล้ว ยังทำรายการด้วยตนเองได้ หรือให้ผู้ดูแลปรับแพ็กเกจ',
  AI_BUDGET_BUSY: 'ระบบกำลังตรวจเครดิต AI ของรายการอื่น กรุณารอสักครู่แล้วลองใหม่',
  AI_BUDGET_UNAVAILABLE: 'ยังตรวจเครดิต AI ไม่ได้ กรุณาลองใหม่ภายหลังหรือทำรายการด้วยตนเอง',
  PROVIDER_BUDGET_EXHAUSTED: 'เครดิต AI ของเดือนนี้หมดแล้ว ยังตอบลูกค้าด้วยตนเองได้ หรือติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ',
  PROVIDER_DISABLED: 'ผู้ให้บริการ AI ถูกปิดใช้งาน กรุณาทำรายการด้วยตนเองหรือติดต่อผู้ดูแลระบบ',
  GATEWAY_UNREACHABLE: 'เชื่อมต่อบริการ AI ไม่ได้ชั่วคราว กรุณาลองใหม่ภายหลังหรือทำรายการด้วยตนเอง',
  NO_EVIDENCE: 'ยังไม่มีหลักฐานเพียงพอให้ AI สร้างคำแนะนำ กรุณาเพิ่มข้อมูลต้นทางก่อน',
  AI_GATEWAY_TIMEOUT: 'บริการ AI ใช้เวลานานเกินกำหนด กรุณาลองใหม่ภายหลังหรือทำรายการด้วยตนเอง',

  // ---- การชำระเงิน ----
  BILLING_COMPANY_PROFILE_REQUIRED: 'ข้อมูลร้านยังไม่ครบ เปิดข้อมูลร้านแล้วกรอกส่วนที่ขาดก่อนเลือกแพ็กเกจอีกครั้ง',
  BILLING_INPUT_INVALID: 'ข้อมูลรายการจ่ายเงินไม่ถูกต้อง ตรวจรายการแล้วลองอีกครั้ง',
};

// Several upload rejections differ only in which check caught the file; the user's next move is
// the same, so they share one sentence rather than four near-identical ones.
const UPLOAD_TYPE_MISMATCH =
  UPLOAD_FILE_TYPE_MISMATCH_MESSAGE;
const UPLOAD_QUOTA_EXCEEDED = 'มีไฟล์ที่ค้างอัปโหลดอยู่หลายรายการ อัปโหลดให้เสร็จหรือรอสักครู่แล้วลองอีกครั้ง';
const UPLOAD_CONTENT_REJECTED =
  'ระบบตรวจไฟล์นี้ไม่ผ่านความปลอดภัย จึงไม่รับไฟล์ ใช้ไฟล์อื่น หรือถ่ายรูป/สแกนเอกสารเป็นภาพแล้วอัปโหลดแทน';

/** Full English messages the user can actually hit in the expense/substitute journeys. */
const MESSAGE_LABELS: Record<string, string> = {
  'Withholding tax requires the payee taxpayer class (บุคคลธรรมดา / นิติบุคคล) before confirmation.': workspaceDictionary.th['expenses.v_payee_kind_required'],
  'Withholding tax requires the income category (ประเภทเงินได้) before confirmation.': workspaceDictionary.th['expenses.v_wht_category_required'],
  // Default-open feature messages that predate stable codes. Keep these exact and reviewed until
  // their APIs migrate; an unknown server sentence still falls through to the safe status copy.
  'LINE channel configuration is missing.': 'การเข้าสู่ระบบด้วย LINE ยังไม่พร้อม ติดต่อทีมงานเพื่อตรวจการตั้งค่า',
  'LINE Login channel is not configured.': 'การเข้าสู่ระบบด้วย LINE ยังไม่พร้อม ติดต่อทีมงานเพื่อตรวจการตั้งค่า',
  'Web base URL is not configured.': 'ระบบยังสร้างลิงก์กลับเข้าหน้าเว็บไม่ได้ ติดต่อทีมงานเพื่อตรวจการตั้งค่า',
  'This email is already being used by another account.': 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว ใช้อีเมลอื่นหรือเข้าสู่บัญชีเดิม',
  'This email is already verified for your account.': 'อีเมลนี้ยืนยันกับบัญชีของคุณแล้ว ไม่ต้องยืนยันซ้ำ',
  'Customer is not active': 'ลูกค้ารายนี้ไม่ได้ใช้งานแล้ว เลือกลูกค้าที่ใช้งานอยู่',
  'Customer is not editable': 'แก้ไขลูกค้ารายนี้ไม่ได้ในสถานะปัจจุบัน ตรวจสถานะล่าสุด',
  'Customer cannot be archived': 'ยังปิดการใช้งานลูกค้ารายนี้ไม่ได้ ตรวจงานที่ค้างอยู่',
  'Customer cannot be assigned': 'ยังเปลี่ยนผู้ดูแลลูกค้ารายนี้ไม่ได้ ตรวจสถานะล่าสุด',
  'Follow-up is closed': 'งานติดตามนี้ปิดแล้ว ตรวจประวัติแทนการแก้ไขซ้ำ',
  'Follow-up cannot be completed': 'ปิดงานติดตามนี้ไม่ได้ในสถานะปัจจุบัน โหลดข้อมูลล่าสุด',
  'Follow-up cannot be snoozed': 'เลื่อนงานติดตามนี้ไม่ได้ในสถานะปัจจุบัน โหลดข้อมูลล่าสุด',
  'Follow-up cannot be canceled': 'ยกเลิกงานติดตามนี้ไม่ได้ในสถานะปัจจุบัน โหลดข้อมูลล่าสุด',
  'Unknown conversation status': 'สถานะบทสนทนาไม่ถูกต้อง เลือกสถานะใหม่',
  'assignedToUserId must be a user id or null': 'ผู้รับผิดชอบบทสนทนาไม่ถูกต้อง เลือกใหม่หรือล้างผู้รับผิดชอบ',
  'assignedToUserId must be an active company member': 'ผู้รับผิดชอบต้องเป็นสมาชิกบริษัทที่ใช้งานอยู่ เลือกคนใหม่',
  'defaultBookingBranchId must belong to the company': 'สาขาเริ่มต้นของการจองต้องเป็นสาขาในบริษัทนี้ เลือกใหม่',
  'Channel Secret does not match this channel. Copy it from Basic settings of this Messaging API channel.':
    'Channel Secret ไม่ตรงกับช่องทางนี้ คัดลอกจาก Basic settings ของ LINE Developers แล้วลองอีกครั้ง',
  'This LINE channel is already connected.': 'ช่องทาง LINE นี้เชื่อมต่ออยู่แล้ว เปิดการตั้งค่าเดิมแทนการเชื่อมซ้ำ',
  'Channel is disabled': 'ช่องทาง LINE นี้ปิดใช้งานอยู่ เปิดใช้งานก่อนทำต่อ',
  'Invalid quiet hours format': 'ช่วงเวลางดแจ้งเตือนไม่ถูกต้อง เลือกเวลาเริ่มและเวลาสิ้นสุดใหม่',
  'legalIdentityVersion is stale; reload and retry': 'ข้อมูลผู้เสียภาษีถูกแก้ไขแล้ว เปิดหน้านี้ใหม่ก่อนบันทึกอีกครั้ง',
  'taxId must be 13 digits': 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก',
  // Legal-identity PATCH validation (company-identity.use-case.ts), hit from both the shop's own
  // settings page and the admin partner console (item 7, 2026-09-29 review).
  'registeredName must be 1-255 characters': 'ชื่อจดทะเบียนต้องมีความยาว 1–255 ตัวอักษร',
  'invalid addressJson': 'ที่อยู่ตามทะเบียนไม่ถูกต้องหรือกรอกไม่ครบ ตรวจที่อยู่ ตำบล/แขวง อำเภอ/เขต จังหวัด และรหัสไปรษณีย์ 5 หลัก',
  'at least one identity field must be supplied': 'กรอกอย่างน้อยหนึ่งช่อง: เลขผู้เสียภาษี ชื่อจดทะเบียน หรือที่อยู่ตามทะเบียน',
  'Exactly one employee role is required.': 'เลือกบทบาทพนักงานหนึ่งบทบาท',
  'Draft employee status can only be changed by completing the employee wizard.': 'พนักงานคนนี้ยังเป็นร่าง ทำขั้นตอนเพิ่มพนักงานให้ครบก่อนเปลี่ยนสถานะ',
  'Source draft cannot be read safely.': 'อ่านข้อมูลร่างไม่ครบ เปิดหน้านี้ใหม่ก่อนทำต่อ',
  'The scanned form attachment is not ACTIVE.': 'ไฟล์แบบฟอร์มที่สแกนใช้ไม่ได้แล้ว อัปโหลดไฟล์ใหม่',
  'กรุณาระบุวันที่จ่ายเงินที่ถูกต้อง': 'เลือกวันที่จ่ายเงินให้ถูกต้อง',
  'เอกสารเปลี่ยนแปลงหรือออกสมบูรณ์แล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไข':
    'เอกสารเปลี่ยนไปหรือออกสมบูรณ์แล้ว เปิดหน้านี้ใหม่ก่อนแก้ไข',
  'periodKey must be YYYY-MM': 'งวดไม่ถูกต้อง เลือกเดือนและปีใหม่',
  'Journal unbalanced': 'ยอดเดบิตและเครดิตไม่เท่ากัน กรุณาตรวจรายการบัญชีก่อนบันทึก',
  'Receipt changed before OCR could be saved': 'ใบเสร็จถูกแก้ไขระหว่างอ่านข้อมูล เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  'Suggestion has expired': 'คำแนะนำนี้หมดอายุแล้ว กรุณาสร้างคำแนะนำใหม่',
  'A source draft was already created for this action': 'คำแนะนำนี้สร้างร่างต้นทางแล้ว กรุณาเปิดร่างเดิมแทนการสร้างซ้ำ',
  'Source record changed after generation; regenerate or acknowledge': 'ข้อมูลต้นทางเปลี่ยนหลังสร้างคำแนะนำ กรุณาสร้างใหม่หรือยืนยันว่าตรวจแล้ว',
  'Template unavailable': 'ไม่พบแบบร่างที่ใช้สร้างรายการ กรุณาเลือกใหม่หรือติดต่อผู้ดูแลระบบ',
  'Invalid cursor': 'ตำแหน่งหน้ารายการไม่ถูกต้อง กลับไปหน้าแรกและเปิดหน้านี้ใหม่',
  'Email already in use by another user.': 'อีเมลนี้ถูกใช้โดยผู้ใช้อื่นแล้ว ใช้อีเมลอื่น',
  'Invalid idempotency key': 'ข้อมูลอ้างอิงรายการไม่ถูกต้อง เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  'Role is still assigned to active employees. Reassign before disabling.': 'บทบาทนี้ยังมีพนักงานใช้อยู่ ย้ายพนักงานไปบทบาทอื่นก่อนปิดใช้งาน',
  'Receipt access changed. Reload and check your permissions.': 'สิทธิ์ของคุณเปลี่ยนแล้ว เปิดหน้านี้ใหม่ ถ้ายังอัปโหลดไม่ได้ ขอสิทธิ์จากเจ้าของกิจการหรือผู้ดูแลสิทธิ์',
  'Signature access changed.': 'สิทธิ์ของคุณเปลี่ยนแล้ว เปิดหน้านี้ใหม่ก่อนบันทึกลายเซ็นอีกครั้ง',
  'Signature belongs to another owner.': 'บันทึกลายเซ็นนี้ไม่ได้ ใช้รูปที่คุณอัปโหลดเอง',
  'Expense revision unavailable. Reload before uploading.': 'ยังตรวจข้อมูลล่าสุดไม่ได้ เปิดหน้านี้ใหม่ก่อนอัปโหลดอีกครั้ง',
  'Expense changed. Reload and review before uploading again.': 'รายการถูกแก้ไขแล้ว เปิดหน้านี้ใหม่และตรวจข้อมูลก่อนอัปโหลดอีกครั้ง',
  'WHT amount cannot exceed the accepted pre-VAT amount.': 'ยอดภาษีหัก ณ ที่จ่ายเกินฐานที่ใช้คำนวณ ตรวจยอดและฐานภาษี',
  'WHT amount cannot exceed the document total or leave a negative payable.': 'ยอดภาษีหัก ณ ที่จ่ายเกินยอดเอกสาร ตรวจยอดและฐานภาษี',
  'Sales cannot approve their own quotation issue request': 'ผู้ส่งขออนุมัติไม่สามารถอนุมัติใบเสนอราคาของตนเองได้ กรุณาให้ผู้มีสิทธิ์คนอื่นอนุมัติ',
  'Tax branch code must be 5 digits.': 'รหัสสาขาภาษีต้องเป็นตัวเลข 5 หลัก หรือเว้นว่างหากไม่มี',
  'Branch code must be 1-20 uppercase alphanumeric characters, underscores, or hyphens.': 'รหัสสาขาต้องยาว 1–20 ตัว ใช้ตัวอักษรอังกฤษพิมพ์ใหญ่ ตัวเลข ขีดกลาง หรือขีดล่างเท่านั้น',
  'Duplicate value: a record with the same unique field(s) already exists. Fields: companyId, supplierId, supplierDocumentNumber':
    CODE_LABELS['duplicate_supplier_document_number']!,
  'Insufficient permissions.': CODE_LABELS['insufficient_permissions']!,
  'Access denied': CODE_LABELS['insufficient_permissions']!,
  'Branch is outside your assigned branch scope.': 'รายการนี้อยู่นอกสาขาที่คุณได้รับมอบหมาย',
  // หน้าพนักงานล็อกตัวเลือกสาขาไว้ให้แล้ว ข้อความนี้มีไว้สำหรับหน้าที่เปิดค้างก่อนข้อมูลเปลี่ยน
  "Cannot assign access outside the requester's branch scope.": `เปลี่ยนสาขาของพนักงานคนนี้ไม่ได้ เพราะพนักงานอยู่ในสาขาที่บัญชีของคุณเข้าไม่ถึง หรือสาขาที่เลือกอยู่นอกสาขาของคุณ ติดต่อ${THAI_SYSTEM_ROLE_NAMES.OWNER}`,
  'Expense requires a receipt attachment or a missing receipt reason.':
    'ต้องแนบไฟล์ใบเสร็จ หรือระบุเหตุผลที่ไม่มีใบเสร็จ ก่อนยืนยันเอกสาร',
  'Every VAT-bearing expense line requires a server-resolved Tax Code snapshot before confirmation.':
    'ทุกรายการที่มี VAT ต้องเลือกรหัสภาษีก่อนยืนยันเอกสาร',
  'Expense confirmation is available on the authenticated web only.':
    'ยืนยันเอกสารได้จากหน้าเว็บที่เข้าสู่ระบบแล้วเท่านั้น',
  'A current issued ใบรับรองแทนใบเสร็จรับเงิน artifact is required; a text reason or legacy timestamp is not sufficient.':
    'ต้องมีใบรับรองแทนใบเสร็จฉบับที่ออกแล้ว การระบุเหตุผลเป็นข้อความอย่างเดียวยังไม่พอ',
  'Internal substitute evidence must remain supporting-only and non-claimable for input VAT.':
    'เอกสารที่ใช้ใบรับรองแทนใบเสร็จ ต้องเป็นหลักฐานประกอบ และขอคืนภาษีซื้อไม่ได้',
  'A receipt or tax invoice is eligible only when it is unavailable or materially incomplete; a valid document must use the normal path.':
    'ใบเสร็จหรือใบกำกับภาษีที่สมบูรณ์อยู่แล้ว ใช้ใบรับรองแทนใบเสร็จไม่ได้ — ใบรับรองใช้เฉพาะกรณีขอใบเสร็จไม่ได้หรือใบเสร็จไม่ครบสาระสำคัญ',
  'Configure substitute-receipt approvers and cash evidence policy in company settings before preparation.':
    'ต้องตั้งค่าผู้อนุมัติและนโยบายหลักฐานเงินสดในหน้าตั้งค่าร้านก่อน จึงจะจัดทำใบรับรองแทนใบเสร็จได้',
  'The payer cannot approve their own substitute receipt.':
    'ผู้จ่ายเงินอนุมัติใบรับรองของตัวเองไม่ได้ ต้องให้ผู้มีสิทธิ์อนุมัติคนอื่นเป็นผู้อนุมัติ',
  'You are not a currently configured substitute-receipt approver for this branch.':
    'คุณไม่ได้ถูกกำหนดเป็นผู้อนุมัติใบรับรองแทนใบเสร็จของสาขานี้',
  'The same file cannot serve as both source/supporting evidence and payment evidence.':
    'ไฟล์เดียวกันใช้เป็นทั้งหลักฐานต้นทางและหลักฐานการจ่ายไม่ได้ ต้องแนบคนละไฟล์',
  'Current company policy requires separate payment evidence for cash expenses. Supersede and prepare a new version.':
    'ร้านกำหนดให้รายการเงินสดต้องมีหลักฐานการจ่ายแยกไฟล์ ยกเลิกฉบับนี้แล้วจัดทำฉบับใหม่',
  'The reviewed preview no longer matches. Generate and review a new preview before signing.':
    'ตัวอย่างที่ตรวจไว้ไม่ตรงกับฉบับปัจจุบัน สร้างและตรวจตัวอย่างใหม่ก่อนเซ็น',
  'Cannot reach the authentication service. Please try again.':
    'เชื่อมต่อระบบไม่ได้ ลองอีกครั้ง',
  // Substitute-receipt eligibility (the rest of the กติกาใบแทน family)
  'Legacy substitute markers and unreviewed source types are not eligible.':
    'เอกสารที่ใช้เครื่องหมายใบแทนแบบเก่า หรือยังไม่ได้ตรวจประเภทเอกสาร ใช้ใบรับรองแทนใบเสร็จไม่ได้',
  'Quotation, order-only, appointment, booking, reservation, non-business, unreadable, or ambiguous images are not eligible.':
    'ใบเสนอราคา ใบสั่งซื้อ ใบนัด การจอง เอกสารที่ไม่ใช่ธุรกิจ หรือรูปที่อ่านไม่ได้/กำกวม ใช้ใบรับรองแทนใบเสร็จไม่ได้',
  'A finance override does not make a quotation, order, appointment, booking, reservation, or non-expense image eligible for substitute evidence.':
    'แม้การเงินจะยืนยันประเภทเอกสารแทน AI แล้ว ใบเสนอราคา/ใบสั่งซื้อ/ใบนัด/การจอง หรือรูปที่ไม่ใช่ค่าใช้จ่าย ก็ยังใช้ใบรับรองแทนใบเสร็จไม่ได้',
  'ใบรับรองแทนใบเสร็จรับเงิน currently supports THB expenses only.':
    'ใบรับรองแทนใบเสร็จรับเงินรองรับเฉพาะรายการสกุลเงินบาท',
  'A positive reviewed total is required.': 'ยอดรวมที่ตรวจแล้วต้องมากกว่า 0',
  [`A substitute receipt supports at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines} expense lines.`]:
    CODE_LABELS['substitute_receipt_too_many_lines']!,
  [`Each substitute-receipt expense description must be at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength} characters.`]:
    CODE_LABELS['substitute_receipt_line_description_too_long']!,
  [`A substitute receipt supports at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments} linked evidence files.`]:
    CODE_LABELS['substitute_receipt_too_many_evidence']!,
  [`Each linked evidence file name must be at most ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceFileNameLength} characters.`]:
    CODE_LABELS['substitute_receipt_evidence_filename_too_long']!,
  'Reviewed expense item details are required.': 'ต้องตรวจและกรอกรายละเอียดรายการค่าใช้จ่ายให้ครบก่อน',
  'A reviewed expense category or account hint is required.': 'ต้องเลือกหมวดค่าใช้จ่ายที่ตรวจแล้วก่อน',
  'Tax evidence status must be reviewed first.': 'ต้องเลือกก่อนว่าใช้เป็นหลักฐานรายจ่ายได้ไหม',
  'Internal substitute evidence cannot preserve input VAT. Set it to supporting/non-claimable or request an issuer-created replacement tax invoice.':
    'ใบรับรองแทนที่ออกภายในใช้รักษาภาษีซื้อไม่ได้ ให้ตั้งเป็นหลักฐานประกอบ/ขอคืนไม่ได้ หรือขอใบแทนใบกำกับภาษีจากผู้ขาย',
  // Substitute-receipt prepare / certify / approve
  'Invalid substitute receipt reasonCode.': 'เลือกเหตุผลที่ออกใบรับรองแทนใบเสร็จจากรายการ',
  'Expense changed after review. Reload before preparing substitute evidence.':
    'เอกสารถูกแก้ไขหลังการตรวจ เปิดหน้านี้ใหม่ก่อนจัดทำใบรับรองแทนใบเสร็จ',
  'The selected payer is not an active company member in this branch.':
    'ผู้จ่ายเงินที่เลือกไม่ใช่สมาชิกที่ใช้งานอยู่ในสาขานี้',
  'No configured approver with expense.confirm is eligible for this branch and distinct from the selected payer.':
    'ไม่มีผู้อนุมัติที่ตั้งค่าไว้ซึ่งมีสิทธิ์ยืนยันเอกสารในสาขานี้และเป็นคนละคนกับผู้จ่ายเงิน',
  'Every evidence attachment must be ACTIVE and linked to this expense.':
    'ไฟล์หลักฐานทุกไฟล์ต้องยังใช้งานอยู่และผูกกับเอกสารนี้',
  'Payment evidence must be an image/PDF linked with purpose expense.payment.evidence.':
    'หลักฐานการจ่ายต้องเป็นรูปภาพ/PDF ที่แนบไว้ในช่องหลักฐานการจ่ายเท่านั้น',
  'Payment method is required.': 'เลือกวิธีจ่ายเงิน',
  'Payment date is required because the payer certifies an amount already paid for company business.':
    'เลือกวันที่จ่ายเงิน เพราะผู้จ่ายรับรองยอดที่จ่ายไปแล้ว',
  'Linked source/payment evidence changed. Finance must prepare a new version.':
    'หลักฐานที่ผูกไว้ถูกเปลี่ยน การเงินต้องจัดทำฉบับใหม่',
  'Expense details changed after preparation. Finance must prepare a new version.':
    'ข้อมูลเอกสารถูกแก้ไขหลังจัดทำ การเงินต้องจัดทำฉบับใหม่',
  'The payer must acknowledge the certification statement.': 'ผู้จ่ายต้องยอมรับคำรับรองก่อนเซ็น',
  'The approver must acknowledge approval.': 'ผู้อนุมัติต้องยอมรับการอนุมัติก่อน',
  'The payer must certify an immutable snapshot before approval.': 'ผู้จ่ายเงินต้องเซ็นรับรองก่อนจึงจะอนุมัติได้',
  'The certified payer signature checksum is missing.': 'ไม่พบข้อมูลตรวจสอบลายเซ็นของผู้จ่ายที่รับรองแล้ว จัดทำฉบับใหม่',
  'Approval must acknowledge the current payer-certified artifact checksum.':
    'เอกสารฉบับที่ผู้จ่ายเซ็นถูกเปลี่ยน เปิดตรวจฉบับล่าสุดก่อนอนุมัติ',
  'The payer signature changed after certification.': 'ลายเซ็นผู้จ่ายถูกเปลี่ยนหลังการรับรอง จัดทำฉบับใหม่',
  'Certified snapshot checksum is invalid.': 'ข้อมูลรับรองใช้ไม่ได้ จัดทำฉบับใหม่',
  'Substitute evidence changed. Reload before cancelling or correcting it.':
    'ใบรับรองแทนใบเสร็จเปลี่ยนไปแล้ว เปิดหน้านี้ใหม่ก่อนยกเลิกหรือแก้ไข',
  'Only an unconfirmed expense can cancel or replace substitute evidence.':
    'ยกเลิกหรือแก้ใบรับรองแทนใบเสร็จได้เฉพาะเอกสารที่ยังไม่ยืนยันเท่านั้น',
  'Substitute evidence changed while superseding.': 'ใบรับรองแทนใบเสร็จถูกเปลี่ยนระหว่างยกเลิกฉบับ เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  'Idempotency key was already used with different substitute-receipt data.':
    'มีการจัดทำใบรับรองด้วยข้อมูลอื่นไปแล้ว เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  // Signature uploads (certify/approve)
  'Per-certificate signature must be a PNG/JPEG file up to 2 MB.': SIGNATURE_FILE_REQUIRED_MESSAGE,
  'Pending signature upload not found for this signer.': 'ไม่พบไฟล์ลายเซ็นที่กำลังอัปโหลดของผู้เซ็นคนนี้ เลือกไฟล์ใหม่',
  'Signature bytes do not match the declared PNG/JPEG MIME type.': 'ไฟล์ลายเซ็นไม่ใช่รูปภาพตามชนิดที่ระบุ',
  'Signature image must be at most 2 MB.': SIGNATURE_FILE_TOO_LARGE_MESSAGE,
  'Signature checksum does not match storage.': 'ไฟล์ลายเซ็นถูกเปลี่ยนหลังอัปโหลด เซ็นใหม่อีกครั้ง',
  // Confirm rules beyond the receipt slot
  'Expense has unresolved duplicate warning. Dismiss or override before confirming.':
    'มีคำเตือนรายการซ้ำที่ยังไม่จัดการ ตรวจรายการซ้ำก่อนยืนยันเอกสาร',
  'Finance permission required to confirm expense without receipt attachment.':
    'ต้องมีสิทธิ์ฝ่ายการเงินจึงจะยืนยันเอกสารที่ไม่มีใบเสร็จแนบได้',
  'Expense date is required for confirmation.': 'ต้องระบุวันที่ค่าใช้จ่ายก่อนยืนยันเอกสาร',
  'Grand total amount is invalid.': 'ยอดรวมต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',
  'A receipt, substitute receipt, or supporting-only document cannot retain a Tax Code.':
    'ใบเสร็จ ใบรับรองแทน หรือหลักฐานประกอบ ใช้รหัสภาษีไม่ได้ (ต้องเป็นใบกำกับภาษี)',
  'A receipt, substitute receipt, or supporting-only document cannot claim input VAT.':
    'ใบเสร็จ ใบรับรองแทน หรือหลักฐานประกอบ ขอคืนภาษีซื้อไม่ได้',
  'Domestic input VAT requires a reviewed TAX_INVOICE with usable tax evidence.':
    'ภาษีซื้อในประเทศต้องมีใบกำกับภาษีที่ตรวจแล้วและหลักฐานใช้ทางภาษีได้',
  'Domestic input VAT requires an attached tax invoice, supplier tax ID, and tax invoice number.':
    'ภาษีซื้อในประเทศต้องแนบใบกำกับภาษี พร้อมเลขผู้เสียภาษีผู้ขายและเลขที่ใบกำกับภาษี',
  'This document is classified as non-expense. Finance must explicitly override the source document type before advancing.':
    'AI จัดเอกสารนี้เป็น "ไม่ใช่ค่าใช้จ่าย" การเงินต้องยืนยันประเภทเอกสารเองก่อนทำต่อ',
  // Non-expense classification override
  'No unresolved non-expense classification to override.': 'ไม่มีผลการจัดประเภทที่ค้างให้ยืนยันแล้ว',
  'Select a reviewed expense source document type before overriding the classification.':
    'เลือกประเภทเอกสารที่ตรวจแล้วก่อนยืนยันแทนผลของ AI',
  'Classification override reason is required and must not exceed 500 characters.':
    'ต้องระบุเหตุผลการยืนยันประเภทเอกสาร ไม่เกิน 500 ตัวอักษร',
  'Re-run document classification before overriding this expense.': 'ให้ AI อ่านเอกสารใหม่ก่อนยืนยันประเภทเอกสาร',
  'Remove the existing Tax Code lines before classifying this document as a receipt, substitute receipt, or supporting-only evidence.':
    'นำรหัสภาษีออกจากรายการก่อนจัดประเภทเอกสารเป็นใบเสร็จ/ใบรับรองแทน/หลักฐานประกอบ',
  // Void / payment
  'Posting state changed while voiding. Retry the void.': 'สถานะการลงบัญชีเปลี่ยนระหว่างยกเลิกเอกสาร ลองอีกครั้ง',
  'Expense changed before void. Reload and retry.': 'เอกสารถูกแก้ไขก่อนยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
  'Void reason must be at least 3 characters': 'เหตุผลการยกเลิกต้องยาวอย่างน้อย 3 ตัวอักษร',
  'Paid amount must be between 0 and net payable amount.': 'ยอดจ่ายต้องอยู่ระหว่าง 0 ถึงยอดสุทธิที่ต้องจ่าย',
  // Document numbers (เลขที่เอกสาร)
  'Idempotency key already used with different document sequence parameters.':
    'ขอเลขที่เอกสารซ้ำกับครั้งก่อนแต่ข้อมูลไม่ตรงกัน ลองอีกครั้ง',
  'Document sequence is disabled or missing.': 'เลขรันเอกสารประเภทนี้ถูกปิดใช้งานหรือยังไม่ได้ตั้งค่า',
  'Document number not found.': 'ไม่พบเลขที่เอกสาร',
  'Only RESERVED document numbers can be committed.': 'เลขที่เอกสารไม่อยู่ในสถานะจอง จึงยืนยันเลขไม่ได้ ลองอีกครั้ง',
  'Only RESERVED document numbers can be cancelled.': 'เลขที่เอกสารไม่อยู่ในสถานะจอง จึงยกเลิกเลขไม่ได้',
  'Only COMMITTED document numbers can be voided.': 'เลขที่เอกสารยังไม่ถูกยืนยัน จึงเพิกถอนเลขไม่ได้',
  // Attachment access
  'Attachment not found.': 'ไม่พบไฟล์แนบ',
  'Attachment is not accessible.': 'ไฟล์แนบนี้ไม่พร้อมให้เข้าถึง',
  'Attachment is outside your assigned branch scope.': 'ไฟล์แนบนี้อยู่นอกสาขาที่คุณได้รับสิทธิ์',
  'Attachment must be ACTIVE in the current company.': 'ไฟล์แนบนี้ถูกลบหรือยกเลิกไปแล้ว',
  'Attachment must be ACTIVE to link.': 'ไฟล์แนบนี้ถูกลบหรือยกเลิกไปแล้ว จึงนำมาผูกกับเอกสารไม่ได้',
  'Attachment target not found.': 'ไม่พบเอกสารปลายทางที่จะแนบไฟล์',
  'Attachment target or purpose is not permitted.': 'แนบไฟล์เข้ากับเอกสารหรือช่องนี้ไม่ได้',
  'Unsupported attachment target or purpose.': 'แนบไฟล์เข้ากับเอกสารหรือช่องนี้ไม่ได้',

  // ---- อัปโหลดไฟล์ ----
  // ทั้งหมดนี้เคยยุบเป็น "ระบบขัดข้อง" ก่อนถึงตัวแปล ผู้ใช้จึงกดอัปโหลดไฟล์เดิมซ้ำไปเรื่อย ๆ
  // แต่ละข้อความต้องบอกให้ชัดว่าไฟล์เดิมใช้ไม่ได้ และต้องทำอะไรแทน
  'Uploaded file exceeds size limit.': 'ไฟล์ใหญ่เกินที่ระบบรับได้ ย่อขนาดหรือแยกไฟล์แล้วอัปโหลดใหม่',
  'Uploaded object was not found in storage.': 'อัปโหลดไฟล์ไม่สำเร็จ เลือกไฟล์แล้วอัปโหลดอีกครั้ง',
  'Uploaded object size does not match attachment metadata.': 'ไฟล์ที่อัปโหลดไม่ตรงกับข้อมูลที่แจ้งไว้ อัปโหลดใหม่',
  'Uploaded bytes do not match attachment metadata.': 'ไฟล์ที่อัปโหลดไม่ตรงกับข้อมูลที่แจ้งไว้ อัปโหลดใหม่',
  'Uploaded object MIME type does not match attachment metadata.': UPLOAD_TYPE_MISMATCH,
  'Uploaded bytes have an unexpected MIME type.': UPLOAD_TYPE_MISMATCH,
  'File signature does not match the declared MIME type.': UPLOAD_TYPE_MISMATCH,
  'Upload URL has already been used.': 'ลิงก์อัปโหลดนี้ถูกใช้ไปแล้ว เริ่มอัปโหลดใหม่',
  'Attachment upload was already completed or is no longer pending.': 'ไฟล์นี้อัปโหลดเสร็จแล้วหรือหมดอายุ เริ่มอัปโหลดใหม่',
  'Attachment is not in PENDING_UPLOAD state.': 'ไฟล์นี้อัปโหลดเสร็จแล้วหรือหมดอายุ เริ่มอัปโหลดใหม่',
  'Pending upload quota exceeded.': UPLOAD_QUOTA_EXCEEDED,
  'Pending upload quota exceeded. Complete or wait for existing upload intents to expire.': UPLOAD_QUOTA_EXCEEDED,
  // การอัปโหลดซ้ำด้วยไฟล์เดิมล้มเหมือนเดิมเสมอ ข้อความจึงห้ามชวนให้ลองใหม่ ต้องบอกให้เปลี่ยนไฟล์
  'Malware scan rejected the attachment.': UPLOAD_CONTENT_REJECTED,
  'Malware test signature detected.': UPLOAD_CONTENT_REJECTED,
  'Active content is not allowed in attachments.': UPLOAD_CONTENT_REJECTED,
  'Active PDF content is not allowed.':
    'ไฟล์ PDF นี้มีคำสั่งอัตโนมัติฝังอยู่ ระบบจึงไม่รับ สั่งพิมพ์เป็น PDF ใหม่ หรือถ่ายรูป/สแกนเป็นภาพแล้วอัปโหลดแทน',
  'PDF object count exceeds the parser safety limit.':
    'ไฟล์ PDF นี้ซับซ้อนเกินกว่าที่ระบบตรวจได้ แยกเป็นไฟล์ย่อย หรือสแกนเป็นภาพแล้วอัปโหลดแทน',
  'Raw substitute-receipt signatures are never available through generic attachment downloads.':
    'ไฟล์ลายเซ็นดาวน์โหลดแยกไม่ได้ ให้เปิดดูจากใบรับรองแทนใบเสร็จแทน',
};

/** Parameterized sentences (status names, period keys) rendered with their parameter kept visible. */
const MESSAGE_PATTERNS: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Category name already exists: /, () => 'มีหมวดหมู่ชื่อนี้แล้ว ใช้ชื่ออื่น'],
  [/^Tax branch code ".*" already exists in this company\.$/, () => 'รหัสสาขาภาษีนี้ถูกใช้ในร้านแล้ว ตรวจสาขาเดิมหรือใช้รหัสอื่น'],
  [/^Branch code ".*" already exists in this company\.$/, () => 'รหัสสาขานี้ถูกใช้ในร้านแล้ว ใช้รหัสอื่น'],
  [/^Cannot confirm expense in status (\S+)\.$/,
    () => 'ยืนยันค่าใช้จ่ายไม่ได้ในสถานะปัจจุบัน เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด'],
  [/^Cannot prepare substitute evidence in status (\S+)\.$/,
    () => 'จัดทำใบรับรองแทนใบเสร็จไม่ได้ในสถานะปัจจุบัน เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด'],
  // Plan 13.11.B: "ยังไม่แน่ใจ" saves as a draft but blocks confirmation, and the block names the line.
  [/^The VAT mode says VAT applies but line (\d+) has no VAT rate\./,
    (m) => `รายการที่ ${m[1]} ยังไม่ได้เลือกว่ามี VAT หรือไม่มี เลือกให้ครบทุกรายการก่อนยืนยัน`],
  [/^Accounting period (\S+) is not open; reopen it before voiding\.$/,
    (m) => `งวดบัญชี ${m[1]} ปิดอยู่ ต้องเปิดงวดก่อนจึงจะยกเลิกเอกสารได้`],
  [/^(\S+)\/(\S+) is locked; use an adjustment or amended filing workflow\.$/,
    (m) => `งวดภาษี ${m[1]} ${m[2]} ถูกล็อกแล้ว ให้ใช้การปรับปรุงหรือยื่นแบบเพิ่มเติมแทน`],
  // partner-lock.logic.ts: DISABLED/ARCHIVED companies freeze profile/features/AI model (item 7).
  [/^Company is (DISABLED|ARCHIVED): profile, features, and AI model are read-only\. Only lifecycle transitions are allowed\.$/,
    (m) => `บริษัทนี้อยู่ในสถานะ${m[1] === 'DISABLED' ? 'ปิดใช้งาน' : 'เก็บถาวร'} แก้ไขข้อมูลบริษัท สิทธิ์การใช้งาน และรุ่น AI ไม่ได้ ทำได้เฉพาะเปลี่ยนสถานะบริษัทเท่านั้น`],
];

/** Generic last resort, so an unmapped failure still reads as Thai. */
const STATUS_LABELS: Record<number, string> = {
  400: 'ทำรายการต่อไม่ได้ ตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง',
  401: workspaceDictionary.th['error.session_expired'],
  403: CODE_LABELS['insufficient_permissions']!,
  404: 'ไม่พบข้อมูลที่ต้องการ',
  409: 'รายการนี้ทำต่อไม่ได้ในสถานะปัจจุบัน เปิดหน้านี้ใหม่แล้วตรวจอีกครั้ง',
  // 413/429/503 มาจาก proxy หรือ rate limiter ซึ่งไม่ส่ง code มาด้วย เดิมจึงตกไปเป็น "API error 429"
  // ดิบ ๆ ทั้งที่เป็นสามสถานการณ์ที่ผู้ใช้ทำอะไรต่อได้ต่างกันชัดเจน
  413: 'ไฟล์หรือข้อมูลที่ส่งมีขนาดใหญ่เกินไป ลดขนาดแล้วลองอีกครั้ง',
  422: 'ทำรายการต่อไม่ได้ ตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง',
  429: 'ทำรายการถี่เกินไป รอสักครู่แล้วลองอีกครั้ง',
  500: 'ระบบขัดข้องชั่วคราว ลองอีกครั้ง',
  502: 'เชื่อมต่อระบบไม่ได้ชั่วคราว ลองอีกครั้ง',
  503: 'บริการที่จำเป็นยังไม่พร้อมใช้งาน ลองอีกครั้งภายหลัง ถ้ายังไม่ได้ ให้ติดต่อทีมงาน',
  504: 'ระบบตอบช้าเกินไป ลองอีกครั้ง',
};

const KIND_LABELS: Record<string, string> = {
  network: 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง',
  network_error: 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง',
  validation: STATUS_LABELS[400]!,
  unauthorized: STATUS_LABELS[401]!,
  forbidden: STATUS_LABELS[403]!,
  not_found: STATUS_LABELS[404]!,
  rate_limited: STATUS_LABELS[429]!,
  server_error: STATUS_LABELS[500]!,
};

const API_KINDS = new Set([...Object.keys(KIND_LABELS), 'unknown']);
const OTHER_CLIENT_ERROR = 'ทำรายการไม่สำเร็จ ตรวจข้อมูลแล้วลองอีกครั้ง';
const GENERIC_API_ERROR = 'ทำรายการไม่สำเร็จ ลองอีกครั้ง';

/** Report reasons use the same source words as the workbook; API errors keep their error wording. */
export function executiveReasonMessage(code: string, coverage?: ExecutiveCoverage, months: readonly string[] = []): string {
  return EXECUTIVE_REASON_CODES.includes(code as typeof EXECUTIVE_REASON_CODES[number]) ? executiveSourceReasonText(code, months, coverage) : apiErrorMessage({ code });
}

/** Translates one API message/code. Returns null when nothing is known about it. */
export function translateApiError(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (MESSAGE_LABELS[text]) return MESSAGE_LABELS[text];
  if (CODE_LABELS[text]) return CODE_LABELS[text];
  // Line validation can join multiple failures; the toast names the first date to fix.
  const incurredDate = /^(line_incurred_date_(?:invalid|in_future)):([1-9]\d?)(?:,|$)/.exec(text);
  if (incurredDate) return `รายการที่ ${incurredDate[2]}: ${CODE_LABELS[incurredDate[1]!]}`;
  // Conflicts carry their detail inline, e.g. `..._accounting_period_locked:2026-07`.
  const prefix = Object.keys(CODE_LABELS).find((code) => text.startsWith(`${code}:`));
  if (prefix) return CODE_LABELS[prefix]!;
  // Only these customer-authored quota sentences are safe to pass through; unknown diagnostics stay hidden.
  if (/^แพ็กเกจปัจจุบัน(?:สร้างได้สูงสุด \d+ สาขา|เพิ่มพนักงานได้สูงสุด \d+ คน) — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ$/.test(text)) return text;
  const planField = /^(branchLimit|employeeLimit|monthlySlipLimit|warningDays|termDays) must be a whole number of at least 1\.$/.exec(text);
  if (planField) {
    const labels: Record<string, string> = { branchLimit: 'จำนวนสาขา', employeeLimit: 'จำนวนพนักงาน', monthlySlipLimit: 'สลิปต่อเดือน', warningDays: 'วันแจ้งเตือนล่วงหน้า', termDays: 'จำนวนวันที่ใช้งาน' };
    return `${labels[planField[1]!]}ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`;
  }
  for (const [pattern, render] of MESSAGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return render(match);
  }
  return null;
}

// The substitute workflow shares these codes with LINE; never display raw server diagnostics.
const SUBSTITUTE_ERROR_LABELS_EN: Record<string, string> = {
  check_bill_route_required: 'Open the substitute-receipt wizard for the same expense, confirm payment without a final receipt, and attach separate proof of payment.',
  check_bill_route_ineligible: 'This route is only for a paid check bill without a final receipt. Reload and review the source document before continuing.',
  check_bill_payment_evidence_required: 'A check bill is not proof of payment. Attach separate proof of actual payment, including cash, then continue with the same expense.',
  payment_evidence_required: 'Attach proof of actual payment separate from the source document before preparing the certificate.',
  substitute_evidence_overlap: 'The source document and payment proof cannot be the same file. Select separate proof of payment.',
  substitute_evidence_unavailable: 'Selected evidence is no longer available for this expense. Reload the expense and select or upload evidence again.',
  substitute_payment_evidence_invalid: 'Upload a separate image or PDF of actual payment in the payment-evidence field. The check bill or source document cannot serve as payment proof.',
  substitute_expense_changed: 'The expense changed after review. Reload the same expense, review the latest details, and prepare again.',
  expense_stale_reload: 'The expense changed after review. Reload the same expense before preparing the certificate.',
  expense_status_ineligible: 'Only draft, in-review, or ready-for-confirmation expenses can be prepared. Review the current expense status.',
  source_type_ineligible: 'Review the source document type on the same expense before preparing a certificate.',
  valid_receipt_normal_path: 'A usable receipt or tax invoice belongs in the normal receipt flow. A substitute is only for an unavailable or materially incomplete original.',
  classification_ineligible: 'This document is not supported expense evidence. Attach readable expense evidence and review its classification.',
  document_kind_ineligible: 'Quotations, purchase orders, appointments, bookings, and non-expense images cannot support a substitute receipt. Attach appropriate expense evidence.',
  currency_not_supported: 'Substitute receipts currently support THB expenses only.',
  reviewed_total_required: 'Review and confirm an expense total greater than zero before preparing.',
  reviewed_items_required: 'Review and complete all expense item descriptions before preparing.',
  reviewed_category_required: 'Review and select the expense category or account before preparing.',
  tax_evidence_review_required: 'Complete the tax-evidence review on the same expense before preparing.',
  tax_evidence_nonclaimable: 'Substitute receipts cannot support input VAT claims. Use non-claimable supporting evidence or request a replacement tax invoice.',
};

/**
 * The stable error code a caught error carries, or null.
 *
 * A Nest `UnprocessableEntityException({ code })` arrives with the code on the response body, so it
 * can sit either on the error or one level down in `details`. Callers that branch on a code use this
 * rather than reading `.code` themselves — a screen that checked only the top level would silently
 * stop reacting the day the shape changed, and the message below would still translate correctly,
 * hiding the break.
 */
export function apiErrorCode(e: unknown): string | null {
  const error = e as { code?: unknown; details?: unknown } | null | undefined;
  const details = error?.details && typeof error.details === 'object'
    ? error.details as { code?: unknown }
    : undefined;
  const code = error?.code ?? details?.code;
  return typeof code === 'string' ? code : null;
}

/** Customer copy for a caught error; raw API diagnostics remain on the original object. */
export function apiErrorMessage(e: unknown, locale: 'th' | 'en' = 'th'): string {
  const error = e as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    kind?: unknown;
    details?: unknown;
    retryAfterSeconds?: unknown;
    duplicateReasons?: unknown;
    duplicatePhase?: unknown;
    claimStatus?: unknown;
    canCancel?: unknown;
  } | null | undefined;
  const details = error?.details && typeof error.details === 'object'
    ? error.details as typeof error
    : undefined;
  const code = apiErrorCode(e);
  if (code === 'wht_payer_identity_missing' || code === 'expense_receipt_replace_locked' || code === 'input_vat_fixed' || code === 'input_vat_reason_required') {
    const sentence = details?.message ?? error?.message;
    if (typeof sentence === 'string' && /[ก-๙]/.test(sentence)) return sentence;
  }
  if (code && /^PND(?:3|53)_FILING_/.test(code) && Object.hasOwn(CODE_LABELS, code)) {
    const sentence = details?.message ?? error?.message;
    if (typeof sentence === 'string' && /[ก-๙]/.test(sentence)) return sentence;
  }
  if (code && code !== 'disbursement_amount_invalid' && Object.hasOwn(DISBURSEMENT_VOUCHER_ERROR_WORDS, code)) {
    const sentence = details?.message ?? error?.message;
    if (typeof sentence === 'string' && /[ก-๙]/.test(sentence) && !/[{}]/.test(sentence)) return sentence;
  }
  if (code === 'disbursement_amount_invalid') {
    const sentence = details?.message ?? error?.message;
    if (typeof sentence === 'string' && /^ยอดของรายการ .+ ต้องมากกว่า 0 และไม่เกินยอดค้างจ่าย \d+(?:\.\d+)?$/.test(sentence)) return sentence;
  }
  if (code === 'duplicate_confirmed') {
    const status = details?.claimStatus ?? error?.claimStatus;
    return reimbursementDuplicateBlockNotice(['EXPENSE_CONFIRMED_DUPLICATE'], false, {
      status: typeof status === 'string' ? status : undefined,
      canCancel: (details?.canCancel ?? error?.canCancel) === true,
    });
  }
  if (code === 'duplicate_unresolved') {
    const reasons = details?.duplicateReasons ?? error?.duplicateReasons;
    const phase = details?.duplicatePhase ?? error?.duplicatePhase;
    const knownReasons = Array.isArray(reasons) ? reasons.filter((reason): reason is string => typeof reason === 'string') : [];
    return phase === 'SUBMIT' ? reimbursementDuplicateSubmitNotice(knownReasons) : phase === 'PAYMENT' ? reimbursementDuplicateBlockNotice(knownReasons) : REIMBURSEMENT_DUPLICATE_UNRESOLVED;
  }
  if (code === 'plan_branch_limit_exceeded') {
    const capacity = details?.details && typeof details.details === 'object'
      ? details.details as { limit?: unknown }
      : undefined;
    if (typeof capacity?.limit === 'number' && Number.isInteger(capacity.limit) && capacity.limit >= 1) {
      return `แพ็กเกจปัจจุบันรองรับ ${capacity.limit} สาขา และใช้งานครบแล้ว หากต้องการเพิ่มสาขา กรุณาเปลี่ยนแพ็กเกจ`;
    }
  }
  // A short, bounded wait is worth naming; a long one (a resend limit resets tomorrow) is not —
  // BILLING_RESEND_LIMIT keeps its own instruction to open the document while waiting.
  if (code === 'BILLING_RATE_LIMIT' || code === 'EMAIL_OTP_RATE_LIMITED') {
    const seconds = details?.retryAfterSeconds ?? error?.retryAfterSeconds;
    if (typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= 300) {
      return code === 'BILLING_RATE_LIMIT' ? `ทำรายการถี่เกินไป รอ ${seconds} วินาที แล้วลองรายการเดิมอีกครั้ง`
        : `${CODE_LABELS[code]} (ลองใหม่ได้ใน ${seconds} วินาที)`;
    }
  }
  if (String(code).startsWith('reimbursement_cancellation_') || (/^(expense_|wht_)/.test(String(code)) && translateApiError(String(code))) || ['certificate_permission_missing', 'certificate_issued', 'posting_unresolved', 'posting_state_changed', 'accounting_period_locked', 'tax_period_locked', 'tax_period_filed'].includes(String(code))) {
    const message = details?.message ?? error?.message;
    if (typeof message === 'string' && /[ก-๙]/.test(message)) return message;
  }
  if (code === 'reimbursement_cancellation_wht_certificate_on_expense') {
    const number = (details ?? error) as { certificateNumber?: unknown } | undefined;
    return reimbursementCertificateCancellationMessage(typeof number?.certificateNumber === 'string' ? number.certificateNumber : null);
  }
  if (code === 'expense_correction_blocked' || code === 'expense_payment_correction_blocked') {
    const payload = (details ?? error) as Partial<ExpenseCorrectionCapabilities> & { blockers?: unknown; blocker?: unknown } | undefined;
    const blockers = Array.isArray(payload?.blockers) ? payload.blockers : [payload?.blocker];
    const messages = code === 'expense_correction_blocked'
      ? expenseReopenBlockerMessages({ ...payload, canReopen: false, reopenBlockers: blockers.filter((b): b is ExpenseCorrectionBlocker => typeof b === 'string') } as ExpenseCorrectionCapabilities)
      : blockers.filter((b): b is ExpenseCorrectionBlocker => typeof b === 'string').map(b => expenseCorrectionBlockerMessage(b, 'cancelPayment'));
    return messages.length ? messages.join('\n') : EXPENSE_CORRECTION_WORDS.unavailable;
  }
  if (typeof code === 'string') {
    if (locale === 'en' && SUBSTITUTE_ERROR_LABELS_EN[code]) return SUBSTITUTE_ERROR_LABELS_EN[code]!;
    const byCode = translateApiError(code);
    if (byCode) return byCode;
  }
  const message = e instanceof Error
    ? e.message
    : typeof error?.message === 'string'
      ? error.message
      : typeof details?.message === 'string'
        ? details.message
        : '';
  const byMessage = translateApiError(message);
  if (byMessage) return byMessage;

  const status = typeof error?.status === 'number'
    ? error.status
    : typeof error?.statusCode === 'number'
      ? error.statusCode
      : typeof details?.status === 'number'
        ? details.status
        : typeof details?.statusCode === 'number'
          ? details.statusCode
          : undefined;
  if (status !== undefined) {
    if (STATUS_LABELS[status]) return STATUS_LABELS[status]!;
    if (status >= 400 && status < 500) return OTHER_CLIENT_ERROR;
    if (status >= 500 && status < 600) return STATUS_LABELS[500]!;
    return GENERIC_API_ERROR;
  }

  const kind = typeof error?.kind === 'string'
    ? error.kind
    : typeof details?.kind === 'string'
      ? details.kind
      : undefined;
  if (kind && KIND_LABELS[kind]) return KIND_LABELS[kind]!;
  if (e instanceof TypeError) return GENERIC_API_ERROR;
  if (typeof code === 'string' || (kind && API_KINDS.has(kind)) || error?.details !== undefined) {
    return GENERIC_API_ERROR;
  }
  return e instanceof Error && e.message ? e.message : GENERIC_API_ERROR;
}
