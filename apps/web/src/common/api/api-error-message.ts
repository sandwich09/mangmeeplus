import { SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS } from '@watchdog-bms/contracts';

// The API answers business-rule failures in English (its messages double as
// operator/log text). This is the single seam where those reach a Thai screen.
// Reviewed mappings stay specific; unknown API diagnostics fail closed to an
// actionable Thai fallback while UI-authored local errors keep their copy.

/** Stable error codes, including the `code:detail` conflicts (matched by prefix). */
const CODE_LABELS: Record<string, string> = {
  EMAIL_ACCESS_INVALID: 'รหัสหมดอายุหรือใช้ไม่ได้แล้ว กรุณาขอรหัสทางอีเมลใหม่',
  EMAIL_ACCESS_EXISTING_ACCOUNT: 'กรุณาเข้าสู่บัญชีเดิมด้วยรหัสผ่านหรือ LINE ก่อน',
  EMAIL_SIGNUP_CHANGED: 'ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาเข้าสู่ระบบอีกครั้ง',
  EMAIL_SIGNUP_INPUT_INVALID: 'กรุณาตรวจชื่อร้าน ชื่อผู้ติดต่อ และเบอร์มือถืออีกครั้ง',
  EMAIL_LOGIN_NOT_ALLOWED: 'บัญชีผู้ดูแลระบบต้องใช้วิธีเข้าสู่ระบบเดิม',
  // setEmailLogin's own READY check (account-email-otp.service.ts) — surfaced now that the
  // coverage spec also discovers emailError(...) calls (item 14).
  EMAIL_VERIFICATION_REQUIRED: 'กรุณายืนยันอีเมลของบัญชีให้เรียบร้อยก่อน จึงจะเปิดใช้การเข้าสู่ระบบด้วยอีเมลได้',
  external_signup_disabled: 'ขณะนี้ยังไม่เปิดรับสมัครใหม่ กรุณาติดต่อทีมงาน',

  BILLING_RECIPIENT_UPDATE_REQUIRED: 'กรุณาตรวจและยืนยันเปลี่ยนผู้รับเอกสารของบริษัทนี้ด้านบน แล้วตรวจสรุปการชำระเงินใหม่',
  BILLING_EMAIL_CHANGED: 'ข้อมูลอีเมลเปลี่ยนแล้ว กรุณาตรวจผู้รับเอกสารและสรุปรายการใหม่',
  // Purchase without setup (pr-d §3.3): only the recipient panel's "use my account email" path still asks for it.
  BILLING_EMAIL_VERIFICATION_REQUIRED: 'การเปลี่ยนผู้รับเอกสารด้วยอีเมลบัญชีต้องยืนยันอีเมลบัญชีก่อน หรือเลือก "ใช้อีเมลอื่น" เพื่อยืนยันด้วยรหัสที่ส่งไปอีเมลนั้น',
  BILLING_EMAIL_UPDATE_PENDING: 'มีคำขอเปลี่ยนอีเมลรับเอกสารค้างอยู่ กรุณายืนยันหรือยกเลิกคำขอในแท็บการต่ออายุและชำระเงินก่อนเริ่มรายการใหม่',
  // Purchase without setup (pr-c §2.4, wording pr-d §2.3 ค): document recipient and resend.
  BILLING_RESEND_LIMIT: 'วันนี้ส่งเอกสารใบนี้ซ้ำครบจำนวนที่กำหนดแล้ว ลองใหม่ได้พรุ่งนี้ หรือเปิดเอกสารจากหน้านี้ได้ทันที',
  BILLING_RESEND_UNAVAILABLE: 'ยังส่งเอกสารใบนี้ซ้ำไม่ได้ ตรวจว่าตั้งอีเมลรับเอกสารแล้ว และรายการชำระเสร็จแล้ว',
  BILLING_RECIPIENT_UNAVAILABLE: 'ตั้งอีเมลรับเอกสารได้ตั้งแต่เริ่มซื้อแพ็กเกจ ไม่ต้องรอชำระเงินเสร็จ',
  BILLING_RECIPIENT_UNCHANGED: 'อีเมลนี้เป็นอีเมลรับเอกสารปัจจุบันอยู่แล้ว ไม่ต้องเปลี่ยน',
  BILLING_RECIPIENT_PROOF_INVALID: 'การยืนยันอีเมลนี้หมดอายุหรือถูกใช้แล้ว กรุณาขอรหัสยืนยันใหม่',
  BILLING_RECIPIENT_BOUNCED: 'อีเมลรับเอกสารปัจจุบันส่งไม่ถึง กรุณาแก้อีเมลรับเอกสารก่อน แล้วจึงส่งเอกสารซ้ำ',
  // Purchase without setup PR E (2026-09-27): admin document tools.
  BILLING_RECIPIENT_BUSY: 'บริษัทมีรายการซื้อ คำสั่งต่ออายุ หรือคำขอเปลี่ยนผู้รับของลูกค้าค้างอยู่ รอให้เสร็จก่อน',
  BILLING_RECIPIENT_NO_CUSTOMER: 'บริษัทนี้ยังไม่มีบัญชีลูกค้าใน Stripe จึงยังไม่มีผู้รับเอกสารให้เปลี่ยน',
  BILLING_RECIPIENT_INVALID: 'รูปแบบอีเมลไม่ถูกต้อง',
  BILLING_LOOKUP_TOO_SHORT: 'เลขอ้างอิงต้องมีอย่างน้อย 8 ตัวอักษร',
  BILLING_LOOKUP_AMBIGUOUS: 'เลขอ้างอิงนี้ตรงหลายรายการ ให้ใช้เลขใบแจ้งหนี้หรือรหัสเต็ม',
  // A sales-event discount serial that no shop has used yet (sales-event spec SD-E20).
  BILLING_LOOKUP_EVENT_TICKET_UNUSED: 'ส่วนลดจากงานนี้ยังไม่ได้ใช้กับร้านใด จึงยังไม่มีร้านให้เปิดดู',
  EMAIL_OTP_REQUIRED: 'กรุณาโหลดหน้านี้ใหม่เพื่อยืนยันอีเมลด้วยรหัส OTP',
  EMAIL_REAUTH_REQUIRED: 'กรุณากรอกรหัสผ่านปัจจุบัน หรือยืนยันตัวตนผ่าน LINE อีกครั้ง',
  EMAIL_DELIVERY_UNAVAILABLE: 'ยังส่งรหัสไม่ได้ กรุณาลองใหม่ภายหลัง หรือติดต่อทีมงาน 098-256-5628',
  EMAIL_OTP_INVALID: 'รหัสไม่ถูกต้อง กรุณาตรวจรหัส 6 หลักจากอีเมลล่าสุด',
  EMAIL_OTP_EXPIRED: 'รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่',
  EMAIL_OTP_ATTEMPTS_EXCEEDED: 'กรอกรหัสผิดครบจำนวนแล้ว กรุณาขอรหัสใหม่',
  EMAIL_OTP_RATE_LIMITED: 'ขอรหัสหรือกรอกรหัสผิดบ่อยเกินไป กรุณารอก่อนลองใหม่',
  EMAIL_CONFLICT: 'อีเมลนี้ใช้กับบัญชีอื่นแล้ว กรุณาใช้อีเมลอื่น หรือติดต่อทีมงาน',
  EMAIL_STATE_CHANGED: 'ข้อมูลอีเมลเปลี่ยนแล้ว กรุณาตรวจข้อมูลล่าสุดก่อนขอรหัสใหม่',
  EMAIL_OTP_TARGET_INVALID: 'กรุณาระบุอีเมลให้ถูกต้อง',
  EMAIL_ACCOUNT_UNAVAILABLE: 'บัญชีนี้ไม่สามารถยืนยันอีเมลได้ กรุณาติดต่อทีมงาน',
  EMAIL_OTP_NOT_FOUND: 'ไม่พบคำขอยืนยันอีเมลนี้ กรุณาโหลดข้อมูลล่าสุด',
  ACCOUNT_REAUTH_REQUIRED: 'กรุณายืนยันตัวตนอีกครั้งด้วยวิธีที่บัญชีรองรับ แล้วกลับมาตั้งรหัสผ่านภายใน 5 นาที',
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
  email_reset_invalid: 'ลิงก์นี้หมดอายุ ถูกใช้แล้ว หรือข้อมูลบัญชีเปลี่ยน กรุณาขอลิงก์กู้รหัสผ่านใหม่',
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
  EMPLOYEE_BRANCH_SCOPE_UNAVAILABLE: 'กรุณาแก้สาขาที่พนักงานมีสิทธิ์และสาขาเริ่มต้นให้ใช้งานได้ ก่อนเปิดสิทธิ์อีกครั้ง',
  BILLING_RATE_LIMIT: 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองรายการเดิมอีกครั้ง',
  BILLING_NOT_CONFIGURED: 'ระบบรับชำระเงินยังไม่พร้อม กรุณาติดต่อทีมงานเพื่อตรวจการตั้งค่าก่อนลองใหม่',
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
  BILLING_PLAN_CHANGE_REQUIRED: 'เลือกแพ็กเกจและรอบชำระจากหน้าจัดการแพ็กเกจ แล้วตรวจผลกระทบก่อนยืนยัน',
  CONTROL_SALES_COMPANY_INVALID: 'มีบริษัทที่ไม่พบแล้ว กรุณาเลือกบริษัทใหม่และตรวจผลกระทบอีกครั้ง',
  BILLING_COMPANY_SALES_CLOSED: 'ยังไม่เปิดรับรายการซื้อใหม่สำหรับบริษัทนี้ กรุณาติดต่อทีมงาน คุณยังตรวจสอบรายการเดิมได้',
  BILLING_SALES_CLOSED: 'ยังไม่เปิดรับชำระเงินใหม่ กรุณาติดต่อทีมงาน',
  BILLING_QUOTE_STALE: 'รายการหมดอายุหรือข้อมูลเปลี่ยน กรุณาเลือกราคาและยืนยันใหม่',
  BILLING_CAP_SELECTION_REQUIRED: 'จำนวนสาขาหรือผู้ใช้เกินแพ็กเกจที่เลือก กรุณาเลือกสิทธิ์ที่จะใช้ต่อก่อนยืนยัน',
  // Purchase without setup (pr-d §2.3 ก, RV28): every `billingError('X')` has Thai here, so the package
  // page falls through to this map (billing-error-text.ts) instead of keeping a second copy.
  BILLING_CHECKOUT_PENDING: 'ระบบกำลังตรวจรายการชำระเงินเดิมกับ Stripe กรุณารอสักครู่แล้วกดอัปเดตข้อมูล',
  BILLING_PURCHASE_PENDING: 'มีรายการชำระเงินเดิมที่ระบบกำลังตรวจอยู่ กรุณารอสักครู่แล้วลองใหม่',
  BILLING_COLLECTION_PENDING: 'มีคำสั่งเรื่องการต่ออายุที่ยังไม่เสร็จ กรุณาตรวจในแท็บการต่ออายุและชำระเงินให้เสร็จก่อนซื้อเพิ่ม',
  BILLING_COLLECTION_CLOSED: 'ยังจัดการการต่ออายุผ่านเว็บไม่ได้ในตอนนี้ กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง',
  BILLING_COLLECTION_REVIEW: 'ข้อมูลการต่ออายุเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วเริ่มคำสั่งใหม่ หากยังไม่ได้ให้ติดต่อทีมงานพร้อมเลขอ้างอิง',
  BILLING_CONSENT_REQUIRED: 'กรุณาติ๊กยอมรับเงื่อนไขก่อนไปชำระเงิน',
  BILLING_DOCUMENT_BINDING: 'ข้อมูลรายการนี้ยังยืนยันกับ Stripe ไม่ได้ กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง',
  BILLING_EXISTING_SUBSCRIPTION: 'มีรายการชำระเงินเดิมที่ยังไม่จบ กรุณาตรวจสถานะรายการเดิมก่อนเริ่มรายการใหม่',
  BILLING_IDEMPOTENCY_CONFLICT: 'รายการนี้ถูกส่งซ้ำด้วยข้อมูลที่ต่างจากเดิม กรุณาโหลดหน้าใหม่แล้วเริ่มรายการอีกครั้ง',
  BILLING_IDEMPOTENCY_REQUIRED: 'ส่งรายการไม่ครบ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  // Not renewal-only any more: a first purchase can throw this too (item 11, 2026-09-29 review).
  BILLING_MAPPING_MISMATCH: 'ข้อมูลการชำระเงินของร้านไม่ตรงกับ Stripe กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง',
  BILLING_MODE_CHANGE_PENDING: 'เปลี่ยนวิธีชำระเงินได้เมื่อแพ็กเกจปัจจุบันสิ้นสุด ตอนนี้เลือกวิธีชำระแบบเดิม หรือรอให้ครบกำหนดก่อน',
  BILLING_OFFER_UNAVAILABLE: 'แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน กรุณาเลือกแพ็กเกจอื่น',
  BILLING_PACKAGE_STATE_INVALID: 'ข้อมูลแพ็กเกจเดิมของบริษัทต้องให้ทีมงานตรวจก่อน กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง',
  BILLING_PLAN_CHANGE_PENDING: 'มีแพ็กเกจที่ชำระล่วงหน้ารอเริ่มใช้งานอยู่ กรุณาตรวจรายการเดิมในแท็บการต่ออายุและชำระเงิน',
  BILLING_PRICE_MISMATCH: 'ราคาในระบบไม่ตรงกับ Stripe กรุณาลองใหม่ภายหลัง หากยังไม่ได้ให้ติดต่อทีมงาน',
  BILLING_REPEAT_REVIEW: 'รายการซื้อซ้ำต้องให้ทีมงานตรวจก่อน กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง',
  BILLING_TAX_MISMATCH: 'การตั้งค่าภาษีของระบบยังไม่พร้อม กรุณาลองใหม่ภายหลัง หรือติดต่อทีมงาน',
  BILLING_UPGRADE_BOUNDARY: 'ใกล้วันเปลี่ยนรอบแล้ว กรุณาตรวจสถานะใหม่หลังเปลี่ยนรอบ หรือติดต่อทีมงาน',
  BILLING_UPGRADE_GIFT_ONLY: 'เวลาที่เหลือของแพ็กเกจเป็นวันที่ทีมงานให้ไว้ กรุณาซื้อแพ็กเกจเดิมเพิ่มก่อน แล้วจึงเปลี่ยนเป็นแพ็กเกจที่สูงขึ้น',
  BILLING_UPGRADE_REVIEW: 'ข้อมูลส่วนต่างของแพ็กเกจต้องให้ทีมงานตรวจก่อน กรุณาติดต่อทีมงานพร้อมเลขอ้างอิง',
  BILLING_CHECKOUT_INVOICE_MISMATCH: 'หลักฐานการชำระเงินของรายการนี้ต้องให้ทีมงานตรวจก่อนเปิดสิทธิ์ กรุณาดูสถานะรายการเดิม',
  BILLING_INVOICE_MISMATCH: 'หลักฐานใบแจ้งหนี้ของรายการนี้ต้องให้ทีมงานตรวจก่อนเปิดสิทธิ์ กรุณาดูสถานะรายการเดิม',
  SPECIAL_PRICE_RETURN_REVIEW: 'ราคาพิเศษของร้านยังปรับกลับเป็นราคาปกติไม่ได้ ทีมงานกำลังตรวจสอบ',
  // These had Thai only on the package page; the shared map carries them now, same wording.
  BILLING_CADENCE_PENDING_CHANGE: 'มีรายการเปลี่ยนแพ็กเกจรอบถัดไป กรุณาตรวจสอบและยกเลิกรายการนั้นในแท็บการต่ออายุและชำระเงิน ก่อนซื้อรายปี',
  BILLING_REPEAT_NOT_READY: 'การซื้อซ้ำหรือเปลี่ยนแพ็กเกจระหว่างรอบยังไม่เปิดให้บริการ กรุณาติดต่อทีมงาน หรือรอให้แพ็กเกจปัจจุบันสิ้นสุดแล้วซื้อใหม่',
  BILLING_RESTART_REVIEW: 'ต้องตรวจสมาชิกหรือยอดค้างเดิมก่อนเริ่มแพ็กเกจใหม่ กรุณาติดต่อทีมงานพร้อมเลขบริษัท',
  BILLING_DOCUMENT_PENDING: 'Stripe กำลังเตรียมเอกสาร กรุณาลองเปิดอีกครั้ง',
  BILLING_PORTAL_UNAVAILABLE: 'ยังเปิดหน้าแก้บัตรไม่ได้ กรุณาโหลดสถานะล่าสุดแล้วลองอีกครั้ง',
  BILLING_PORTAL_CONFIG_MISMATCH: 'ทีมงานต้องตรวจการตั้งค่าหน้าแก้บัตรก่อน กรุณาติดต่อทีมงาน',
  BILLING_COMPANY_HELD: 'ร้านนี้ถูกพักใช้งานโดยผู้ดูแล กรุณาติดต่อทีมงาน',
  BILLING_SOURCE_REVIEW_REQUIRED: 'ข้อมูลการชำระเงินเดิมของบริษัทนี้ยังไม่ตรงกัน กรุณาติดต่อทีมงานก่อนเริ่มรายการใหม่',
  BILLING_ENTITLEMENT_REVIEW_REQUIRED: 'ข้อมูลสิทธิ์เมนูเดิมยังไม่พร้อม กรุณาติดต่อทีมงานก่อนชำระเงิน',
  BILLING_REFUND_PENDING: 'กำลังตรวจสอบคำขอคืนเงิน จึงยังซื้อหรือเปลี่ยนแพ็กเกจไม่ได้ กรุณาโหลดสถานะล่าสุดหรือติดต่อทีมงาน',
  BILLING_NOT_READY: 'ยังไม่เปิดรับชำระเงินใหม่ กรุณาติดต่อทีมงาน',
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
  CONTROL_PROVIDER_DISABLED: 'ยังไม่ได้ตั้งค่าบัญชีผู้ให้บริการ ติดต่อผู้ดูแลการเชื่อมต่อ',
  // Mirrors CONTROL_REFUND_AGED_UNKNOWN below, same 23h-unconfirmed rule for a recipient-email change.
  CONTROL_RECIPIENT_AGED_UNKNOWN: 'ยังยืนยันผลกับ Stripe ไม่ได้เกิน 23 ชั่วโมง ให้ตรวจที่ Stripe ก่อนทำรายการต่อ',
  CONTROL_REFUNDS_CLOSED: 'ยังไม่เปิดรับคำขอคืนเงิน ติดต่อผู้ดูแลการตั้งค่า',
  CONTROL_REFUND_AGED_UNKNOWN: 'ยังยืนยันรายการเดิมไม่ได้ ให้เจ้าหน้าที่ตรวจ Stripe ก่อนดำเนินการต่อ',
  CONTROL_REFUND_CONFIG_REQUIRED: 'กำหนดวงเงินคืนเงินและขออนุมัตินโยบายก่อนเปิดการคืนเงิน',
  CONTROL_REFUND_LIMIT: 'ยอดนี้เกินวงเงินต่อคำขอ กรุณาติดต่อผู้ดูแลวงเงิน',
  CONTROL_REFUND_SOURCE_CHANGED: 'หลักฐานการคืนเงินเปลี่ยนหรือยังไม่ครบ กรุณาตรวจรายการเดิมอีกครั้ง',
  CONTROL_SCAN_BUSY: 'มีงานตรวจที่ยังไม่จบ กรุณาเปิดงานเดิมก่อน',
  CONTROL_SCOPE_TARGET_INVALID: 'เลือกเจ้าหน้าที่ที่มีบทบาทระดับระบบสำหรับงานการเงินอยู่แล้ว ผู้ดูแลระบบมีขอบเขตทั้งหมดอยู่แล้ว',
  CONTROL_SCHEDULE_INVALID: 'กำหนดเวลาไม่ถูกต้อง กรุณาเลือกเวลาใหม่แล้วตรวจผลกระทบอีกครั้ง',
  CONTROL_NOTIFICATION_REVIEW: 'รายการส่งนี้ยังมีเงื่อนไขที่ต้องแก้ก่อน เปิดรายการส่งเดิมเพื่อตรวจสาเหตุ แล้วจึงสั่งอีกครั้ง',
  reimbursement_source_unavailable: 'ไม่พบค่าใช้จ่ายต้นทางที่เปิดได้ กรุณาเลือกใหม่',
  reimbursement_source_currency_mismatch: 'สกุลเงินของค่าใช้จ่ายต้องตรงกับใบเบิก',
  reimbursement_source_already_settled: 'รายการนี้บันทึกบัญชี จ่ายเงิน หรือปิดรายการแล้ว จึงนำมาเบิกซ้ำไม่ได้',
  reimbursement_source_not_personal: 'ใบรับรองนี้ระบุว่าบริษัทจ่าย จึงนำมาเบิกคืนพนักงานไม่ได้',
  reimbursement_source_not_issued: 'กรุณาลงนามและออกใบรับรองให้เรียบร้อยก่อนนำมาเบิก',
  reimbursement_source_payer_unlinked: 'ผู้จ่ายบนกระดาษยังไม่ได้เชื่อมกับผู้รับเงินคืนในระบบ กรุณาตรวจสอบตัวผู้จ่ายก่อน',
  reimbursement_source_wrong_payer: 'ผู้รับเงินคืนต้องตรงกับพนักงานผู้สำรองจ่ายในหลักฐาน',
  reimbursement_source_tax_review_required: 'รายการนี้มีภาษีหัก ณ ที่จ่าย หรือภาษีซื้อที่ต้องตรวจสอบ กรุณาให้บัญชีจัดการภาษีผ่านรายการค่าใช้จ่ายก่อน',
  reimbursement_source_ambiguous: 'ไฟล์นี้เชื่อมกับค่าใช้จ่ายมากกว่าหนึ่งรายการ กรุณาตรวจสอบหลักฐานต้นทางก่อน',
  reimbursement_source_changed: 'ข้อมูลค่าใช้จ่ายต้นทางเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดในหน้าร่างใบเบิก และตรวจสอบก่อนส่งใหม่',
  reimbursement_source_fields_mismatch: 'ยอดเงินและวันที่ในใบเบิกต้องตรงกับค่าใช้จ่ายต้นทาง กรุณาดึงข้อมูลล่าสุด',
  reimbursement_source_attachment_mismatch: 'ไฟล์ที่เลือกไม่ใช่หลักฐานของค่าใช้จ่ายนี้ กรุณาเลือกใหม่',
  reimbursement_source_review_required: 'ใบเบิกเดิมยังไม่ได้เก็บข้อมูลต้นทาง กรุณาแก้ไขร่างและดึงข้อมูลล่าสุดก่อนส่ง',
  reimbursement_requester_unavailable: 'ผู้รับเงินคืนต้องเป็นสมาชิกที่ใช้งานได้ในบริษัทและสาขานี้',
  substitute_paid_expense_amount_locked: 'รายการนี้จ่ายเงินแล้ว หากต้องแก้ยอดให้ดำเนินการแก้ไขรายการจ่ายก่อน ข้อมูลเอกสารอื่นยังแก้และลงนามใหม่ได้',
  expense_receipt_removal_locked: 'นำใบเสร็จออกได้เฉพาะรายการฉบับร่างหรือรอตรวจสอบที่ยังไม่จ่ายเงินและยังไม่บันทึกบัญชี',
  // Buyer expense capture (งานรับหลักฐาน). Each one says what to do next: a group is a job the
  // user came back to finish, so a dead end here loses the evidence they already sent.
  expense_capture_group_revision_conflict: 'งานรับหลักฐานนี้เปลี่ยนไปแล้ว กรุณาเปิดข้อมูลล่าสุดแล้วทำรายการอีกครั้ง',
  expense_capture_group_closed: 'งานรับหลักฐานนี้ปิดแล้ว หากต้องแนบหลักฐานเพิ่ม กรุณาเริ่มงานใหม่',
  expense_capture_group_exists: 'รายการนี้อยู่ในงานรับหลักฐานอยู่แล้ว กรุณาเปิดงานเดิมเพื่อทำต่อ',
  expense_capture_file_state_invalid: 'ไฟล์นี้ถูกตัดออกหรือถูกปฏิเสธแล้ว กรุณาแนบไฟล์ใหม่',
  expense_capture_file_detach_blocked: 'ไฟล์นี้เป็นหลักฐานของรายการค่าใช้จ่ายหรือใบรับรองแล้ว หากต้องนำออกให้จัดการที่รายการนั้นก่อน',
  expense_capture_handoff_active: 'งานนี้สร้างรายการค่าใช้จ่ายไปแล้ว กรุณาจัดการที่รายการค่าใช้จ่ายนั้น',
  expense_capture_convert_ineligible: 'แยกเป็นกลุ่มหลักฐานได้เฉพาะรายการที่ยังไม่ยืนยัน ยังไม่จ่ายเงิน และยังไม่อยู่ในใบเบิกหรือใบรับรอง',
  expense_capture_no_evidence: 'ยังไม่มีไฟล์หลักฐานในงานนี้ กรุณาแนบไฟล์',
  expense_capture_read_pending: 'เก็บไฟล์แล้ว กำลังอ่านเอกสาร กรุณารอสักครู่แล้วเปิดดูอีกครั้ง',
  expense_capture_facts_unavailable: 'ยังไม่มีข้อมูลจากไฟล์นี้ กดกรอกข้อมูลต่อเพื่อบันทึกด้วยตัวเองได้',
  // W04a — แก้ข้อมูลที่อ่านได้, ตรวจส่วนบริษัท และยอมรับการจัดส่วน
  expense_capture_facts_patch_empty: 'ยังไม่มีการแก้ไขข้อมูล กรุณาแก้ค่าที่ต้องการก่อนบันทึก',
  expense_capture_facts_patch_unsupported: 'แก้ไขข้อมูลนี้ยังไม่รองรับ กรุณาแก้เฉพาะรายการสินค้า ยอดเงิน วันที่ หรือผู้ออกเอกสาร',
  expense_capture_facts_patch_unknown_target: 'ไม่พบรายการที่จะแก้ในไฟล์นี้ กรุณาเปิดข้อมูลล่าสุดแล้วลองใหม่',
  expense_capture_facts_patch_invalid_amount: 'กรุณากรอกตัวเลขให้ถูกต้อง ใช้ทศนิยมได้ไม่เกิน 4 ตำแหน่ง',
  expense_capture_facts_patch_too_large: 'แก้ไขพร้อมกันได้ไม่เกิน 200 รายการ กรุณาแบ่งบันทึกเป็นหลายครั้ง',
  expense_capture_review_input_invalid: 'ข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาเปิดข้อมูลล่าสุดแล้วเลือกใหม่อีกครั้ง',
  expense_capture_tax_review_forbidden: 'การตัดสินเรื่องภาษีต้องใช้สิทธิ์ผู้ตรวจสอบค่าใช้จ่าย กรุณาส่งให้ผู้มีสิทธิ์ตรวจ',
  expense_capture_payer_forbidden: 'การระบุผู้จ่ายเป็นคนอื่นต้องใช้สิทธิ์ผู้ตรวจสอบค่าใช้จ่าย',
  expense_capture_payer_invalid: 'ผู้จ่ายต้องเป็นสมาชิกที่ใช้งานอยู่ของบริษัทและอยู่ในสาขาของงานนี้',
  expense_capture_allocation_blocked: 'ยังมีรายการที่ต้องตรวจก่อน จึงจะยอมรับการจัดส่วนของบริษัทได้',
  expense_capture_allocation_not_current: 'การจัดส่วนนี้ไม่ใช่ฉบับล่าสุดแล้ว กรุณากดตรวจส่วนของบริษัทอีกครั้ง',
  expense_capture_allocation_stale: 'ข้อมูลของงานนี้เปลี่ยนหลังคำนวณการจัดส่วน กรุณากดตรวจส่วนของบริษัทอีกครั้ง',
  // Blockers ของการจัดส่วน (W04a): ข้อความในหน้ากลุ่มมาจาก server ส่วนนี้คือคำอธิบายกลาง
  expense_capture_review_required: 'ตรวจส่วนของบริษัทและผู้จ่ายก่อน จึงจะสร้างรายการค่าใช้จ่ายได้',
  expense_capture_business_use_required: 'ยังไม่ได้ระบุว่ารายการนี้ใช้สำหรับบริษัททั้งหมดหรือมีของส่วนตัวด้วย',
  expense_capture_funding_route_required: 'ยังไม่ได้ระบุว่าบริษัทจ่ายเองหรือพนักงานสำรองจ่าย',
  expense_capture_payer_required: 'ยังไม่ได้ระบุผู้จ่าย กรุณาเลือกสมาชิกที่เป็นผู้จ่ายจริง',
  expense_capture_item_amount_unknown: 'มีสินค้าที่เลือกเป็นของบริษัทแต่ยังอ่านยอดไม่ได้ กรุณากรอกยอดจากหลักฐาน',
  expense_capture_document_mismatch: 'ยอดในเอกสารยังไม่ตรงกัน กรุณาตรวจจุดที่ไม่ตรงก่อนทำต่อ',
  expense_capture_component_unclassified: 'มีรายการเงินในเอกสารที่ยังไม่ทราบความหมาย กรุณาระบุว่าเป็นค่าอะไร',
  expense_capture_expense_date_required: 'ยังไม่มีวันที่ของรายการนี้ กรุณาเลือกวันที่จ่ายหรือวันที่บนเอกสาร',
  expense_capture_currency_unsupported: 'เอกสารนี้เป็นสกุลเงินต่างประเทศ ระบบยังไม่รองรับการแปลงค่าเงิน เก็บข้อมูลไว้ได้แต่ยังสร้างรายการค่าใช้จ่ายไม่ได้',
  expense_capture_company_paid_personal_portion: 'บริษัทจ่ายเต็มจำนวนแต่มีของส่วนตัวรวมอยู่ ยังไม่รองรับการเรียกคืนส่วนตัวจากบริษัท',
  expense_capture_totals_identity_failed: 'ยอดที่แบ่งได้ยังไม่ตรงกับยอดรวมของเอกสาร กรุณาแจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิง',
  expense_capture_tax_review_pending: 'รอตรวจภาษีก่อน จึงจะนำไปทำใบเบิกได้',
  // W05 — สร้างรายการค่าใช้จ่ายจากการจัดส่วนที่ยอมรับแล้ว และการสร้างใหม่
  expense_capture_handoff_consumed: 'รายการค่าใช้จ่ายที่สร้างจากงานนี้ถูกนำไปใช้แล้ว (จ่ายเงิน บันทึกบัญชี ใบเบิก หรือใบรับรอง) กรุณาแก้ไขที่รายการค่าใช้จ่ายนั้นแทน',
  expense_capture_handoff_totals_invalid: 'ยอดของรายการที่จะสร้างยังไม่ตรงกับยอดที่ตรวจไว้ กรุณาแจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิง',
  expense_capture_handoff_blocked: 'ยังมีรายการที่ต้องตรวจก่อน จึงจะสร้างรายการค่าใช้จ่ายได้',
  expense_capture_no_company_portion: 'การจัดส่วนนี้สรุปว่าไม่มีส่วนของบริษัท จึงไม่มีรายการค่าใช้จ่ายให้สร้าง',
  // Spec §16.4 / UXE-21 and UXE-22: changing or adding a receipt file. The first two are "someone
  // moved this while you were choosing" — the file you sent is not evidence of anything yet, so the
  // way out is to reopen the record. The third is a state that has to be handled where it happened.
  expense_revision_conflict: 'รายการนี้มีการเปลี่ยนแปลง กรุณาเปิดข้อมูลล่าสุดก่อนทำต่อ',
  expense_receipt_replace_conflict: 'ไฟล์ใบเสร็จของรายการนี้ถูกเปลี่ยนไปแล้ว กรุณาเปิดข้อมูลล่าสุดก่อนเปลี่ยนไฟล์อีกครั้ง',
  expense_receipt_replace_locked: 'สถานะของรายการนี้ไม่อนุญาตให้เปลี่ยนหรือแนบไฟล์ตรงนี้ กรุณาเปิดรายการเดิมเพื่อดำเนินการตามขั้นตอนที่รองรับ',
  expense_receipt_replace_operation_conflict: 'รายการเปลี่ยนไฟล์นี้ถูกใช้กับไฟล์อื่นไปแล้ว กรุณาเปิดข้อมูลล่าสุดแล้วเลือกไฟล์อีกครั้ง',
  invalid_response: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  duplicate_supplier_document_number: 'เลขที่เอกสารผู้ขายนี้ถูกบันทึกสำหรับผู้ขายรายนี้แล้ว กรุณาตรวจสอบบิลเดิมก่อนสร้างซ้ำ',
  // Permissions / scope
  insufficient_permissions: 'คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อผู้ดูแลสิทธิ์ของบริษัท',
  TRANSACTION_BRANCH_REQUIRED: 'กรุณาระบุสาขาของรายการก่อนดำเนินการ',
  TRANSACTION_BRANCH_INVALID: 'ไม่พบสาขาที่ใช้งานได้ในบริษัทนี้ กรุณาเลือกสาขาอีกครั้ง',
  REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH: 'ใบเสร็จหรือค่าใช้จ่ายต้องระบุสาขาเดียวกับคำขอเบิก',
  legal_acceptance_not_required: 'บัญชีนี้ไม่ต้องยอมรับเอกสารกฎหมาย',
  platform_access_closed: 'ระบบกำลังปรับปรุง กรุณาลองใหม่ภายหลัง',
  platform_access_open_unavailable: 'ยังเปิดระบบไม่ได้จนกว่า production release จะผ่านการตรวจสอบครบถ้วน',
  // P12-3b: a spent/expired LINE deep-link handoff — same line the /login notice shows.
  line_handoff_unavailable: 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาเข้าสู่ระบบเพื่อเปิดรายการนี้',
  // P10-L §3.5: the LIFF start page asks for a session and the handoff route is switched off.
  line_web_handoff_disabled: 'ตอนนี้เปิดหน้าเว็บจาก LINE ไม่ได้ กรุณาเข้าสู่ระบบที่เว็บแอปโดยตรง',
  // P10 claim page. Both are 409s the applicant can act on, and both used to collapse into the
  // generic "ข้อมูลถูกเปลี่ยนแปลงระหว่างทำรายการ" — which named neither the cause nor a way out
  // (Owner UAT 2026-08-31: an applicant with an existing account hit a dead end here).
  email_already_registered_use_existing_account:
    'อีเมลนี้มีบัญชีมั่งมีพลัสอยู่แล้ว กรุณาเข้าสู่ระบบด้วยบัญชีเดิมเพื่อผูกร้านใหม่',
  username_taken: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาตั้งชื่อผู้ใช้อื่น',
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
    'ระบบกำลังอัปเกรดส่วนเบิกค่าใช้จ่ายชั่วคราว ข้อมูลที่กรอกยังอยู่ กรุณารอประมาณ 1 นาทีแล้วลองอีกครั้ง',
  reimbursement_changed: 'คำขอเบิกถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง',
  reimbursement_draft_changed:
    'ใบเบิกถูกแก้ไขหรือส่งอนุมัติแล้ว กรุณาเปิดรายการใหม่ ตรวจสอบข้อมูล แล้วลองอีกครั้ง',
  line_incurred_date_invalid: 'กรุณาระบุวันที่รายการเบิกให้ถูกต้อง',
  line_incurred_date_in_future: 'วันที่รายการเบิกต้องไม่เกินวันนี้ (เวลาไทย) กรุณาแก้ไขวันที่ก่อนส่งอนุมัติ',
  expense_auto_post_not_enabled: 'ต้องเปิดระบบบัญชีแยกประเภทและ Auto-post ค่าใช้จ่ายก่อน',
  // Onboarding bootstrap: the standard expense-category template names accounts the company's
  // chart does not offer, so no category was seeded. The operator cannot fix this from the screen.
  expense_category_account_unmapped:
    'ผังบัญชีเริ่มต้นยังไม่มีบัญชีที่หมวดค่าใช้จ่ายมาตรฐานต้องใช้ ระบบจึงยังไม่ได้สร้างหมวดค่าใช้จ่าย กรุณาติดต่อผู้ดูแลระบบ',
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
  // P10-L §15.1: the monthly AI image-read ceiling. Worded as reads, not receipts, because the
  // admission charges every image the assistant looks at. The receipt itself was saved — only the
  // read was refused — so the copy says what still works before it says what to do about the
  // ceiling. No number: the browser's ApiError keeps only `code`, and a wrong count is worse than none.
  receipt_quota_exceeded: 'โควตาให้ AI อ่านรูปของเดือนนี้ครบแล้ว (ใบเสร็จ 1 ใบ = 1 ครั้ง) ยังกรอกรายการเองได้ตามปกติ หรือขอเปลี่ยนแพ็กเกจเพื่อเพิ่มจำนวนครั้งได้เลย',
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
  expense_settled_via_reimbursement:
    'รายการนี้มาจากการเบิกคืนพนักงาน ระบบจะบันทึกการชำระให้อัตโนมัติเมื่อบันทึกจ่ายใบเบิก — ไม่ต้องบันทึกชำระที่หน้านี้',
  branch_head_office_required: 'ปิดสาขานี้ไม่ได้ — บริษัทต้องมีสำนักงานใหญ่ที่ใช้งานอยู่อย่างน้อย 1 สาขา',
  branch_last_active_required: 'ปิดสาขานี้ไม่ได้ — บริษัทต้องมีสาขาที่ใช้งานอยู่อย่างน้อย 1 สาขา สร้างสาขาใหม่ก่อนแล้วค่อยปิดสาขานี้',
  branch_has_open_reimbursements: 'ปิดสาขานี้ไม่ได้ — ยังมีใบเบิกของสาขานี้ค้างอยู่ ต้องจ่ายหรือปิดใบเบิกให้เรียบร้อยก่อน',
  branch_head_office_exists: 'บริษัทนี้มีสำนักงานใหญ่อยู่แล้ว หนึ่งบริษัทมีสำนักงานใหญ่ได้เพียงแห่งเดียว',
  ledger_account_invalid_for_bank: 'บัญชีที่ผูกกับธนาคารต้องเป็นบัญชีของบริษัทที่ใช้งานและลงรายการได้',
  // หน้าจับคู่รายการธนาคาร: รายการที่เลือกมาจากหน้าที่เปิดค้างไว้ และการจ่ายเงินคืนนั้นถูกยกเลิกไปแล้ว
  bank_match_payment_not_recorded: 'การจ่ายเงินคืนรายการนี้ถูกยกเลิกไปแล้ว จึงจับคู่ไม่ได้ กรุณากดรีเฟรชแล้วเลือกรายการอื่น',
  bank_match_state_changed: 'รายการนี้ถูกเปลี่ยนระหว่างจับคู่ กรุณากดรีเฟรชแล้วลองอีกครั้ง',
  output_tax_code_line_mismatch: 'Tax Code ที่หัวเอกสารไม่ตรงกับรายการภาษี กรุณาตรวจ Tax Code ก่อนบันทึก',
  posting_rule_missing: 'ยังไม่มีกฎลงบัญชีที่ผ่านการตรวจสำหรับเอกสารนี้ จึงยังไม่สร้างรายการบัญชี',
  expense_payment_exceeds_outstanding: 'ยอดจ่ายต้องมากกว่า 0 และไม่เกินยอดคงเหลือที่ต้องจ่าย',
  expense_payment_changed: 'ยอดหรือสถานะการจ่ายถูกเปลี่ยนระหว่างบันทึก กรุณาโหลดรายการใหม่แล้วลองอีกครั้ง',
  expense_payment_idempotency_conflict: 'ข้อมูลไม่ตรงกับรายการจ่ายที่บันทึกไว้ กรุณาตรวจประวัติการจ่ายก่อนแก้ไขเป็นรายการใหม่',
  expense_payment_invalid_date: 'วันที่จ่ายไม่ถูกต้อง กรุณาเลือกวันที่จ่ายเงินจริงจากปฏิทิน',
  expense_payment_invalid_key: 'ข้อมูลสำหรับยืนยันรายการจ่ายไม่ถูกต้อง กรุณาเปิดรายการใหม่และตรวจประวัติการจ่ายก่อนบันทึก',
  expense_payment_invalid_method: 'วิธีจ่ายเงินไม่ถูกต้อง กรุณาเลือกวิธีจ่ายเงินจากรายการ',
  expense_payment_invalid_reference: 'ข้อมูลอ้างอิงการจ่ายต้องเป็นข้อความไม่เกิน 128 ตัวอักษร',
  claim_expense_settles_via_reimbursement: 'รายการที่มาจากใบเบิกต้องบันทึกการจ่ายผ่านขั้นตอนจ่ายคืนของใบเบิก',
  // Expense confirmation CAS guards — all mean "reload and try again"
  expense_confirmation_source_status_changed: 'เอกสารถูกเปลี่ยนสถานะระหว่างยืนยัน กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  expense_confirmation_source_version_changed: 'เอกสารถูกแก้ไขระหว่างยืนยัน กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  expense_confirmation_source_checksum_changed: 'ข้อมูลเอกสารเปลี่ยนไประหว่างยืนยัน กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  expense_confirmation_substitute_evidence_changed: 'ใบรับรองแทนใบเสร็จเปลี่ยนไประหว่างยืนยัน กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  expense_confirmation_tax_line_changed: 'รายการภาษีเปลี่ยนไประหว่างยืนยัน กรุณาตรวจ Tax Code แล้วลองอีกครั้ง',
  expense_confirmation_tax_evidence_changed: 'หลักฐานภาษีเปลี่ยนไประหว่างยืนยัน กรุณาตรวจสอบแล้วลองอีกครั้ง',
  expense_confirmation_accounting_period_locked: 'งวดบัญชีของเอกสารนี้ปิดแล้ว ต้องเปิดงวดก่อนจึงจะยืนยันได้',
  expense_confirmation_tax_period_locked: 'งวดภาษีของเอกสารนี้ยื่นหรือปิดแล้ว จึงยืนยันเข้างวดนี้ไม่ได้',
  EXPENSE_UPDATE_VERSION_REQUIRED: 'ข้อมูลเวอร์ชันเอกสารหายไป กรุณาโหลดรายการใหม่ก่อนบันทึก',
  EXPENSE_UPDATE_VERSION_INVALID: 'ข้อมูลเวอร์ชันเอกสารไม่ถูกต้อง กรุณาโหลดรายการใหม่ก่อนบันทึก',
  EXPENSE_UPDATE_CONFLICT: 'รายการถูกแก้ไขโดยผู้ใช้อื่น กรุณาโหลดข้อมูลใหม่ ตรวจสอบ แล้วจึงบันทึกอีกครั้ง',
  duplicate_tax_id: 'เลขประจำตัวผู้เสียภาษีนี้ถูกใช้กับลูกค้ารายอื่นแล้ว กรุณาเปิดข้อมูลลูกค้าเดิมหรือแก้เลขให้ถูกต้อง',
  sale_price_invalid: 'ราคาขายไม่ถูกต้อง กรุณากรอกจำนวนตั้งแต่ 0 ขึ้นไป',
  period_closed: 'งวดบัญชีนี้ปิดแล้ว หากต้องลงรายการ กรุณาให้ผู้มีสิทธิ์เปิดงวดก่อน',
  transaction_tax_needs_review: 'ข้อมูลภาษีของรายการนี้ต้องได้รับการตรวจสอบก่อน กรุณาเปิดขั้นตอนตรวจภาษีแล้วดำเนินการให้ครบ',
  NOTIFICATION_RETRY_REVIEW_REQUIRED: 'รายการแจ้งเตือนเปลี่ยนแล้วหรือเป็นการแจ้งเตือนแพ็กเกจ กรุณาโหลดข้อมูลใหม่และตรวจรายการเดิมก่อนลองส่งอีกครั้ง',
  EXPENSE_DRAFT_DELETED: 'รายการที่บันทึกไว้ถูกลบแล้ว กรุณากลับไปหน้ารายการค่าใช้จ่าย',
  EXPENSE_DRAFT_KEY_CONFLICT: 'ข้อมูลที่ส่งบันทึกไม่ตรงกับรายการเดิม กรุณากลับไปหน้ารายการค่าใช้จ่ายเพื่อตรวจสอบก่อนบันทึกใหม่',
  EXPENSE_NUMBER_OWNER_CONFLICT: 'เลขรายจ่ายไม่ตรงกับทะเบียน กรุณาติดต่อผู้ดูแลเพื่อตรวจสอบเลขรายจ่ายนี้',
  EXPENSE_SOURCE_DRAFT_INCOMPLETE: 'ยังส่งตรวจหรือยืนยันไม่ได้ กรุณาเติมข้อมูลบิลที่ยังขาดแล้วเก็บร่างก่อน',
  EXPENSE_DOCUMENT_REVIEW_INCOMPLETE: 'ตรวจประเภทเอกสาร สถานะภาษี และหลักฐานที่เลือก แล้วกดบันทึกการตรวจ',
  EXPENSE_EVIDENCE_REVIEW_REQUIRED: 'บันทึกการตรวจหลักฐานล่าสุดก่อนยืนยัน หากเลือกใช้ใบแทน ต้องทำใบแทนให้สมบูรณ์ก่อน',
  EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED: 'ตรวจวันที่ในใบเสร็จที่ขั้นตรวจข้อมูล แล้วบันทึกก่อนส่งตรวจหรือยืนยันค่ะ',
  EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED: 'ข้อมูลใบเสร็จเปลี่ยนไปแล้ว กรุณาโหลดรายการใหม่ก่อนบันทึก',
  // Vendor address spec §8: a refusal on this field must name the fix, because the user is looking
  // at the paper and can act — "ตัดให้สั้นลง" / "5 หลัก" are the whole message.
  // Counterparty registry. `accounting-documents` is outside the launch modules the coverage audit
  // scans, so nothing would have caught these — and the counterparty screen shows all three.
  // Vendor-address spec §10: supplying the payee address a frozen 50 ทวิ prefill never had. The
  // `tax` module is outside `api-error-coverage.spec.ts`'s launch list, so nothing audits these —
  // they are here because both strings reach the AP screen.
  wht_handoff_address_not_editable: 'รายการนี้ออกหนังสือรับรองไปแล้ว ที่อยู่ที่พิมพ์ที่นี่จึงไม่มีผลกับเอกสารที่ออกไป แก้ที่อยู่ผู้รับเงินได้ที่หน้าคู่ค้า',
  wht_handoff_payee_address_required: 'กรุณาพิมพ์ที่อยู่ผู้รับเงินตามที่จะพิมพ์ลงหนังสือรับรอง',
  counterparty_conflict: 'มีคนแก้ข้อมูลคู่ค้านี้ไปแล้ว โหลดหน้านี้ใหม่แล้วบันทึกอีกครั้ง',
  counterparty_address_too_long: 'ที่อยู่ยาวเกิน 500 ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง',
  counterparty_branch_code_invalid: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00000 สำหรับสำนักงานใหญ่ หรือเว้นว่างไว้ก็ได้',
  EXPENSE_VENDOR_BRANCH_CODE_INVALID: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00000 สำหรับสำนักงานใหญ่ หรือเว้นว่างไว้ก็ได้',
  EXPENSE_VENDOR_ADDRESS_TOO_LONG: 'ที่อยู่ผู้ขายยาวเกิน 500 ตัวอักษร ตัดให้สั้นลงแล้วบันทึกอีกครั้ง',
  // Vendor-address §8 Slice 2: the confirm-with-reason on a tax invoice whose printed buyer does not
  // match the company registry. Both name the next step — reload for the first, a reason for the second.
  expense_buyer_match_not_mismatch: 'ผู้ซื้อบนใบนี้ไม่ได้ขึ้นว่าไม่ตรงทะเบียนแล้ว โหลดหน้านี้ใหม่เพื่อดูผลล่าสุด',
  expense_buyer_match_reason_required: 'กรุณาพิมพ์เหตุผลที่ใบนี้ใช้ได้ ไม่เกิน 500 ตัวอักษร แล้วกดบันทึกอีกครั้ง',
  EXPENSE_PURPOSE_TEXT_INVALID: 'กรุณาใช้ช่องว่างหรือจุลภาคแทนเครื่องหมาย · ในช่อง “ซื้อไปใช้ทำอะไร” หรือเว้นช่องนี้ไว้ได้',
  EXPENSE_SOURCE_DRAFT_INVALID: 'ข้อมูลร่างบางช่องไม่ถูกต้อง กรุณาตรวจวันที่ จำนวน ราคา และหมวดค่าใช้จ่ายแล้วลองอีกครั้ง',
  expense_source_line_identity_changed: 'รายการในบิลถูกแก้ไขระหว่างทำรายการ กรุณาเปิดรายการใหม่ ตรวจสอบ แล้วจึงเก็บร่างอีกครั้ง',
  // Plan 13.11.B: a 400 body reaches the client as `code` only, so the amounts and the line to open
  // are shown on the VAT card itself (`expenseVatReconciliationMessage`). This says where to look.
  EXPENSE_VAT_RECONCILIATION_REQUIRED:
    'VAT จากเอกสารยังไม่ตรงกับที่ระบบคำนวณ กรุณาดูรายการที่ต้องตรวจในการ์ด VAT แล้วแก้ไข หรือเลือก “ใช้ยอดตามเอกสาร” พร้อมระบุเหตุผล',
  EXPENSE_VAT_OVERRIDE_INVALID:
    'ยังใช้ยอด VAT ตามเอกสารไม่ได้ กรุณาตรวจยอดต้นฉบับและอัตรา VAT ให้ครบ บันทึกข้อมูลล่าสุด แล้วเลือกรายการที่มี VAT เพื่อรับส่วนต่างพร้อมระบุเหตุผล',
  EXPENSE_VAT_TAX_TOLERANCE_REQUIRED:
    'VAT ตามเอกสารต่างเกินเกณฑ์ของ Tax Code กรุณาตรวจเอกสารและ Tax Code ก่อนยืนยัน การเลือกใช้ยอดตามเอกสารไม่สามารถข้ามเกณฑ์ภาษีนี้ได้',
  EXPENSE_VAT_TAX_RATE_CONFLICT:
    'อัตรา VAT ของรายการไม่ตรงกับ Tax Code กรุณาแก้อัตราหรือเลือก Tax Code ให้ตรงกับเอกสารก่อนยืนยัน',
  EXPENSE_VAT_OVERRIDE_STALE:
    'ข้อมูลค่าใช้จ่ายเปลี่ยนแล้ว กรุณาโหลดใหม่ ตรวจยอด VAT ล่าสุด แล้วเลือกใช้ยอดตามเอกสารอีกครั้ง',
  expense_confirmation_accepted_vat_changed:
    'ยอด VAT ขั้นสุดท้ายไม่ตรงกับยอดที่ยอมรับ กรุณาตรวจเอกสารและ Tax Code อีกครั้ง ยังไม่มีการยืนยันรายการ',
  EXPENSE_CHANGED_DURING_DELETE: 'รายการถูกแก้ไขระหว่างการลบ กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง',
  EXPENSE_NOT_DELETABLE: 'ลบรายการค่าใช้จ่ายนี้ไม่ได้ในสถานะปัจจุบัน กรุณาตรวจสอบสถานะเอกสาร',
  EXPENSE_HAS_LINKED_DATA: 'ลบรายการไม่ได้ เพราะมีข้อมูลอื่นเชื่อมโยงอยู่ กรุณาตรวจสอบรายการที่เกี่ยวข้องก่อน',
  SUBSTITUTE_EVIDENCE_RETENTION_LOCKED: 'ลบไฟล์นี้ไม่ได้ เพราะใช้เป็นหลักฐานของใบรับรองแทนใบเสร็จที่ลงนามแล้ว',
  accounting_document_changed: 'เอกสารถูกแก้ไขหรือเปลี่ยนสถานะโดยผู้ใช้อื่น กรุณาโหลดข้อมูลใหม่ ตรวจสอบ แล้วจึงทำรายการอีกครั้ง',
  accounting_document_already_converted: 'ใบเสนอราคานี้ถูกแปลงเป็นเอกสารอื่นแล้ว กรุณาโหลดใหม่และตรวจสอบเอกสารที่สร้างไว้',
  accounting_active_receipt_must_be_voided: 'รายการนี้ออกใบเสร็จแล้ว กรุณายกเลิกใบเสร็จก่อน แล้วจึงยกเลิกการรับชำระ',
  accounting_active_child_document_must_be_voided: 'รายการนี้มีใบเสร็จหรือใบกำกับภาษีที่ยังใช้งานอยู่ กรุณายกเลิกเอกสารลูกก่อน แล้วจึงยกเลิกรายการต้นทาง',
  accounting_receipt_already_exists: 'ใบแจ้งหนี้นี้มีใบเสร็จที่ยังใช้งานอยู่แล้ว กรุณาเปิดใบเสร็จเดิมแทนการสร้างซ้ำ',
  accounting_tax_invoice_already_exists: 'เอกสารต้นทางนี้มีใบกำกับภาษีที่ยังใช้งานอยู่แล้ว กรุณาเปิดใบเดิมแทนการสร้างซ้ำ',
  quotation_command_conflict: 'คำสั่งนี้เคยใช้สร้างใบเสนอราคาด้วยรายละเอียดอื่นแล้ว กรุณาโหลดข้อมูลใหม่ก่อนลองอีกครั้ง',
  // Substitute-receipt lifecycle
  substitute_evidence_locks_lines: 'ใบรับรองแทนใบเสร็จที่ลงนามแล้วล็อกรายการไว้ ต้องจัดทำ version แก้ไขก่อนจึงจะแก้ได้',
  substitute_evidence_locks_expense: 'ใบรับรองแทนใบเสร็จที่ลงนามแล้วล็อกข้อมูลเอกสารไว้ ต้องจัดทำ version แก้ไขก่อนจึงจะแก้ได้',
  substitute_evidence_nonclaimable: 'เอกสารที่ใช้ใบรับรองแทนใบเสร็จ ขอคืนภาษีซื้อไม่ได้และใช้เป็นหลักฐานภาษีไม่ได้',
  // The company answered "not registered" for this document's date. VAT paid is cost, not a claim.
  input_vat_not_available_company_not_vat_registered:
    'บริษัทยังไม่ได้จดทะเบียน VAT ณ วันที่ของเอกสารนี้ จึงขอคืนภาษีซื้อไม่ได้ (VAT ที่จ่ายถือเป็นต้นทุน)',
  substitute_evidence_doc_type_locked: 'ประเภทเอกสารต้นฉบับถูกล็อกไว้ระหว่างที่ใบรับรองแทนใบเสร็จยังใช้งานอยู่',
  substitute_evidence_stale: 'ใบรับรองแทนใบเสร็จถูกเปลี่ยนแปลง กรุณาเปิดใหม่ก่อนยกเลิกหรือแก้ไข',
  substitute_evidence_expense_confirmed: 'ยกเลิกหรือแก้ใบรับรองแทนใบเสร็จได้เฉพาะเอกสารที่ยังไม่ยืนยันเท่านั้น',
  substitute_evidence_idempotency_conflict: 'มีการจัดทำใบรับรองด้วยข้อมูลอื่นไปแล้ว กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  substitute_funding_source_required: 'กรุณาระบุว่าบริษัทจ่ายเต็มจำนวนหรือพนักงานสำรองจ่ายเต็มจำนวน หากเป็นใบรับรองเดิมให้จัดทำฉบับแก้ไขและลงนามใหม่',
  substitute_edit_requires_cancellation: 'เอกสารออกสมบูรณ์หรือบันทึกการจ่าย/บัญชีแล้ว กรุณายกเลิกใบแทนและจัดการรายการจ่าย บัญชี หรือคำขอเบิกที่เกี่ยวข้องก่อนแก้ไข',
  substitute_payment_month_confirmation_required: 'กรุณายืนยันเปลี่ยนเดือนที่จ่ายเงินโดยคงเลขเอกสารเดิม',
  substitute_facts_incomplete: 'ข้อมูลใบแทนยังไม่ครบ เลือกแก้ไขข้อมูลใบแทนเพื่อระบุผู้รับเงิน เหตุผล วัตถุประสงค์ และวันที่หรือวิธีจ่ายก่อนลงนาม ไม่ต้องยกเลิกเอกสาร',
  substitute_full_payment_required: 'รองรับเฉพาะบริษัทจ่ายเต็มจำนวนหรือพนักงานสำรองจ่ายเต็มจำนวน กรุณาตรวจข้อมูลและยืนยันการจ่ายให้ครบก่อนดำเนินการต่อ',
  substitute_existing_payment_details_mismatch: 'วันที่หรือวิธีจ่ายในใบรับรองไม่ตรงกับการจ่ายที่บันทึกไว้ กรุณาตรวจประวัติการจ่ายและยกเลิกใบแทนก่อนสร้างใหม่ หากรายการจ่ายเดิมผิด ให้ผู้มีสิทธิ์ยกเลิกรายจ่ายและกลับรายการก่อน',
  substitute_personal_settles_via_reimbursement: 'ใบรับรองนี้ระบุว่าพนักงานจ่ายร้านแล้ว กรุณาดำเนินการคืนเงินให้พนักงานแยกตามขั้นตอนการเงิน',
  substitute_source_has_live_claim: 'หลักฐานนี้เชื่อมกับคำขอเบิกที่ยังดำเนินการอยู่ กรุณาเปิดและดำเนินการผ่านคำขอเบิกเดิม',
  substitute_correction_company_identity_changed: 'เลขผู้เสียภาษีของบริษัทเปลี่ยนจากใบรับรองเดิม กรุณาให้ผู้ดูแลหรือฝ่ายบัญชีตรวจสอบข้อมูลบริษัทก่อนจัดทำฉบับแก้ไข',
  substitute_correction_financial_fields_locked: 'ฉบับแก้ไขนี้เปลี่ยนข้อมูลการเงินหรือหลักฐานเดิมไม่ได้ กรุณาคงข้อมูลเดิมและแก้เฉพาะชื่อบริษัทหรือข้อมูลผู้ลงนามที่ต้องการ',
  substitute_correction_source_changed: 'ใบรับรองต้นทางหรือรายการค่าใช้จ่ายเปลี่ยนสถานะแล้ว กรุณาเปิดรายการล่าสุดและตรวจสอบก่อนจัดทำฉบับแก้ไข',
  substitute_snapshot_integrity_mismatch: 'ข้อมูลใบรับรองไม่ตรงกับข้อมูลที่บันทึกไว้ กรุณาแจ้งผู้ดูแลระบบให้ตรวจสอบก่อนดำเนินการต่อ',
  // W06 §12: ใบรับรองของรายการที่แยกมาจากกลุ่มหลักฐาน — เหตุผลที่ยังทำไม่ได้ พร้อมทางแก้
  substitute_capture_allocation_superseded: 'การจัดส่วนเปลี่ยนไปแล้ว กรุณาสร้างรายการใหม่ก่อนทำใบรับรอง',
  substitute_capture_unpaid_evidence: 'หลักฐานของร้านนี้ยังไม่แสดงว่าจ่ายเงินแล้ว (เช่น คำสั่งซื้อที่ยังรอชำระ) จึงยังจัดทำใบรับรองแทนใบเสร็จไม่ได้ กรุณาเพิ่มหลักฐานการจ่ายหรือยืนยันการจ่ายในกลุ่มหลักฐานก่อน',
  substitute_capture_document_mismatch: 'ยอดในเอกสารของร้านนี้ยังไม่ตรงกัน กรุณาตรวจจุดที่ไม่ตรงในกลุ่มหลักฐานก่อนจัดทำใบรับรอง',
  substitute_capture_funding_route_mismatch: 'แหล่งเงินในใบรับรองต้องตรงกับผู้จ่ายที่ตรวจแล้วในกลุ่มหลักฐาน กรุณาเลือกให้ตรงกันก่อน',
  substitute_paper_form_changed: 'ข้อมูลรายการหรือแบบฟอร์มเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุดและตรวจแบบฟอร์มก่อนดำเนินการต่อ',
  substitute_paper_submission_changed: 'เอกสารหรือฉบับที่ส่งตรวจเปลี่ยนแล้ว กรุณาเปิดรายการล่าสุดและตรวจไฟล์ลงนามอีกครั้ง',
  substitute_paper_upload_unavailable: 'ไฟล์ลงนามนี้ยังไม่พร้อมใช้กับใบรับรองนี้ กรุณาเปิดรายการล่าสุดและอัปโหลดไฟล์อีกครั้ง',
  substitute_paper_upload_already_linked: 'ไฟล์นี้ถูกแนบใช้งานแล้ว กรุณาอัปโหลดฉบับลงนามสำหรับใบรับรองนี้ใหม่',
  expense_stale_reload: 'เอกสารถูกแก้ไขหลังการตรวจ กรุณาเปิดใหม่ก่อนจัดทำใบรับรองแทนใบเสร็จ',
  substitute_wet_signed_scan_not_linkable: 'แนบฟอร์มที่เซ็นด้วยมือไม่ได้ ต้องเป็นใบรับรองที่เตรียมไว้ ยังไม่มีภาพฟอร์ม และไฟล์ต้องเป็นรูปหรือ PDF ที่เปิดอ่านได้และไม่เกินจำนวนหน้าที่กำหนด',
  substitute_wet_signed_scan_checksum_mismatch: 'ภาพฟอร์มที่เซ็นด้วยมือไม่ตรงกับค่าตรวจสอบที่บันทึกไว้ตอนรับรอง กรุณาแจ้งผู้ดูแลระบบก่อนใช้เอกสารนี้',
  substitute_print_history_unavailable: 'ไม่มีไฟล์หรือข้อมูลฉบับเดิมเพียงพอสำหรับพิมพ์เอกสาร กรุณาดูประวัติรายการ',
  substitute_print_artifact_unavailable: 'ไม่พบไฟล์เอกสารที่เก็บไว้ กรุณาเปิดรายการอีกครั้ง หากยังไม่พบให้แจ้งผู้ดูแลระบบ',
  substitute_certified_artifact_checksum_mismatch: 'ไฟล์ฉบับลงนามไม่ตรงกับข้อมูลที่รับรองไว้ กรุณาแจ้งผู้ดูแลระบบก่อนใช้เอกสารนี้',
  substitute_wet_signed_scan_not_renderable: 'ประกอบไฟล์เอกสารจากภาพฟอร์มที่เซ็นด้วยมือไม่ได้ กรุณาแจ้งผู้ดูแลระบบ',
  LINE_RECEIPT_CONTINUATION_STALE:
    'รายการค่าใช้จ่ายถูกแก้ไขระหว่างส่งผลกลับใน LINE กรุณาเปิดรายการล่าสุดแล้วตรวจสอบก่อนทำต่อ',
  LINE_SUBSTITUTE_CONTINUATION_STALE:
    'รายการค่าใช้จ่ายหรือขั้นตอนจัดทำใบรับรองแทนใบเสร็จใน LINE เปลี่ยนไป กรุณาเปิดรายการล่าสุดแล้วเริ่มขั้นตอนนี้ใหม่',
  expense_status_ineligible:
    'จัดทำใบรับรองแทนใบเสร็จได้เฉพาะรายการที่ยังเป็นร่าง อยู่ระหว่างตรวจ หรือพร้อมยืนยัน กรุณาตรวจสถานะรายการ',
  source_type_ineligible:
    'ประเภทเอกสารต้นทางยังไม่ผ่านการตรวจหรือไม่รองรับใบรับรองแทนใบเสร็จ กรุณาตรวจและเลือกประเภทเอกสารให้ถูกต้อง',
  check_bill_route_ineligible:
    'ทำขั้นตอนนี้ได้เฉพาะเช็กบิลที่จ่ายแล้วแต่ร้านไม่มีใบเสร็จ กรุณากลับไปตรวจเอกสารและตอบเรื่องการจ่ายเงินก่อน',
  check_bill_route_required:
    'เปิดขั้นตอนจัดทำใบรับรองของรายการเดิม ยืนยันว่าจ่ายแล้วแต่ไม่มีใบเสร็จฉบับสุดท้าย และแนบหลักฐานการชำระเงินแยกจากเช็กบิล',
  check_bill_payment_evidence_required:
    'เช็กบิลไม่ใช่หลักฐานการจ่าย กรุณาแนบหลักฐานการชำระเงินจริงแยกจากเช็กบิล แม้จ่ายเงินสด แล้วจัดทำใบรับรองของรายการเดิมต่อ',
  payment_evidence_required:
    'กรุณาแนบหลักฐานการชำระเงินจริงแยกจากเอกสารต้นทางก่อนจัดทำใบรับรอง',
  substitute_evidence_overlap:
    'ใช้ไฟล์เดียวกันเป็นทั้งเช็กบิลหรือเอกสารต้นทางและหลักฐานชำระเงินไม่ได้ กรุณาเลือกหลักฐานการจ่ายคนละไฟล์',
  substitute_evidence_unavailable:
    'หลักฐานที่เลือกไม่มีพร้อมใช้ในรายการนี้ กรุณาโหลดรายการใหม่แล้วเลือกหรือแนบหลักฐานอีกครั้ง',
  substitute_payment_evidence_invalid:
    'กรุณาแนบรูปหรือ PDF หลักฐานการชำระเงินจริงในช่องหลักฐานการจ่าย โดยใช้คนละไฟล์กับเช็กบิลหรือเอกสารต้นทาง',
  substitute_expense_changed:
    'รายการถูกแก้ไขหลังตรวจ กรุณาโหลดรายการเดิมใหม่ ตรวจข้อมูลล่าสุด แล้วจัดทำใบรับรองอีกครั้ง',
  valid_receipt_normal_path:
    'เอกสารนี้มีใบเสร็จหรือใบกำกับภาษีที่ใช้ได้ ให้ดำเนินการตามขั้นตอนปกติ ใบรับรองแทนใบเสร็จใช้ได้เมื่อต้นฉบับไม่มีหรือข้อมูลสำคัญไม่ครบเท่านั้น',
  classification_ineligible:
    'รูปนี้ไม่ใช่หลักฐานค่าใช้จ่ายที่รองรับหรืออ่านข้อมูลไม่ชัด กรุณาแนบหลักฐานค่าใช้จ่ายที่อ่านได้และตรวจประเภทเอกสาร',
  document_kind_ineligible:
    'ใบเสนอราคา ใบสั่งซื้อ ใบนัดหมาย ใบจอง หรือรูปที่ไม่ใช่ค่าใช้จ่าย ใช้จัดทำใบรับรองแทนใบเสร็จไม่ได้ กรุณาแนบหลักฐานค่าใช้จ่าย',
  currency_not_supported:
    'ขณะนี้ใบรับรองแทนใบเสร็จรองรับเฉพาะรายการสกุลเงินบาท (THB)',
  reviewed_total_required:
    'กรุณาตรวจสอบและยืนยันยอดรวมที่มากกว่า 0 ก่อนจัดทำใบรับรองแทนใบเสร็จ',
  reviewed_items_required:
    'กรุณาตรวจสอบและกรอกรายละเอียดรายการค่าใช้จ่ายให้ครบก่อนจัดทำใบรับรองแทนใบเสร็จ',
  reviewed_category_required:
    'กรุณาตรวจสอบและเลือกหมวดค่าใช้จ่ายหรือบัญชีให้ครบก่อนจัดทำใบรับรองแทนใบเสร็จ',
  tax_evidence_review_required:
    'กรุณาตรวจสถานะหลักฐานภาษีให้เสร็จก่อนจัดทำใบรับรองแทนใบเสร็จ',
  tax_evidence_nonclaimable:
    'ใบรับรองแทนใบเสร็จใช้ขอคืนภาษีซื้อไม่ได้ กรุณาเปลี่ยนสถานะเป็นเอกสารประกอบที่ไม่ขอคืนภาษี หรือขอใบกำกับภาษีฉบับทดแทนจากผู้ออกเอกสาร',
  substitute_receipt_too_many_lines:
    `ใบรับรอง 1 ใบรองรับได้สูงสุด ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines} รายการ กรุณาแยกบันทึกเป็นหลายรายการค่าใช้จ่ายและจัดทำคนละใบ`,
  substitute_receipt_line_description_too_long:
    `รายละเอียดค่าใช้จ่ายแต่ละรายการต้องไม่เกิน ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength} ตัวอักษร กรุณากลับไปย่อรายละเอียดก่อนดำเนินการต่อ`,
  substitute_receipt_too_many_evidence:
    `ใบรับรอง 1 ใบรองรับหลักฐานรวมได้สูงสุด ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments} ไฟล์ กรุณานำไฟล์ที่ไม่จำเป็นออก`,
  substitute_receipt_evidence_filename_too_long:
    `ชื่อไฟล์หลักฐานต้องไม่เกิน ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceFileNameLength} ตัวอักษร กรุณาเปลี่ยนชื่อไฟล์ให้สั้นลงแล้วอัปโหลดใหม่`,
  // Void-path CAS guards
  posting_state_changed: 'สถานะการลงบัญชีเปลี่ยนระหว่างยกเลิกเอกสาร กรุณาลองอีกครั้ง',
  expense_changed: 'เอกสารถูกแก้ไขก่อนยกเลิก กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  accounting_period_locked: 'งวดบัญชีของเอกสารนี้ปิดแล้ว ต้องเปิดงวดก่อนจึงจะยกเลิกได้',
  tax_period_locked: 'งวดภาษีของเอกสารนี้ถูกล็อกแล้ว ให้ใช้การปรับปรุงหรือยื่นแบบเพิ่มเติมแทน',

  // ---- รายการเบิกจ่าย: ส่งใบเบิก ----
  missing_receipt:
    'ยังส่งไม่ได้ตามนโยบายใบเสร็จของบริษัท กรุณาเปิดรายละเอียดเพื่อแนบใบเสร็จหรือแก้ไขคำขอ',
  missing_receipt_reason_required:
    'มีรายการที่ยังไม่แนบหลักฐาน กรุณาระบุเหตุผลที่ไม่มีใบเสร็จก่อนส่งใบเบิก',
  duplicate_unresolved: 'ระบบพบใบเบิกที่อาจซ้ำกับรายการเดิม นโยบายบริษัทกำหนดให้ตรวจสอบก่อนจึงจะส่งได้',
  invalid_primary_attachment: 'ไฟล์แนบต้องเป็นไฟล์ที่ผู้ขอเบิกอัปโหลดเองและยังใช้งานอยู่',
  invalid_linked_expense: 'รายการค่าใช้จ่ายที่ผูกไว้ไม่ใช่ของผู้ขอเบิก หรือถูกลบไปแล้ว',
  invalid_status_transition: 'สถานะปัจจุบันของใบเบิกทำรายการนี้ไม่ได้ กรุณาโหลดรายการใหม่',

  // ---- รายการเบิกจ่าย: อนุมัติ ----
  // สามโค้ดนี้แยกกันเพราะเหตุผลที่กดไม่ได้ต่างกัน และสิ่งที่ผู้ใช้ต้องทำต่อก็ต่างกัน
  not_eligible_approver: 'คุณไม่ได้อยู่ในขั้นอนุมัติปัจจุบันของใบเบิกนี้',
  not_assigned_approver: 'ใบเบิกนี้ถูกมอบหมายให้ผู้อนุมัติคนอื่นแล้ว',
  not_eligible_approver_role: 'บทบาทของคุณไม่ตรงกับผู้อนุมัติที่กำหนดไว้ในขั้นนี้',
  self_approval_denied: 'อนุมัติใบเบิกของตนเองไม่ได้ ต้องให้ผู้มีสิทธิ์อนุมัติคนอื่นเป็นผู้อนุมัติ',
  rejection_reason_required: 'กรุณาระบุเหตุผลการไม่อนุมัติ',
  stale_approval_snapshot: 'ข้อมูลใบเบิกที่ใช้อนุมัติไม่ครบ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง',
  // ลงนามในสิ่งที่เห็น: ใบเบิกถูกแก้หลังกดดูตัวอย่าง คำยืนยันเดิมจึงใช้ไม่ได้
  stale_claim_snapshot: 'ใบเบิกถูกแก้ไขหลังจากที่คุณกดดูตัวอย่าง กรุณาตรวจฉบับล่าสุดอีกครั้งก่อนลงนาม',
  stale_finance_review_snapshot: 'ใบเบิกถูกแก้ไขระหว่างตรวจสอบ กรุณาเปิดรายการใหม่แล้วลองอีกครั้ง',
  finance_approval_already_decided: 'ใบเบิกนี้ถูกอนุมัติจ่ายโดยผู้อื่นไปแล้ว กรุณาโหลดรายการใหม่',
  finance_correction_reason_required: 'กรุณาระบุข้อมูลที่ต้องการให้ผู้เบิกแก้ไข',
  finance_review_note_too_long: 'เหตุผลต้องไม่เกิน 500 ตัวอักษร',
  // ข้อความนี้ถูกส่งไปในแจ้งเตือนของผู้เบิก ทั้งบนเว็บและ LINE จึงห้ามมีเลขบัญชี
  note_contains_account_number: 'อย่าพิมพ์เลขบัญชีในช่องนี้ เพราะข้อความนี้จะถูกส่งไปในแจ้งเตือน เลขที่เอกสารของระบบและยอดเงินที่ตามด้วยคำว่าบาทพิมพ์ได้ ตัวเลขอื่นที่ยาวตั้งแต่ 6 หลักให้ย่อหรือเว้นไว้ แล้วให้ผู้เบิกดูในใบเบิก',
  reimbursement_correction_has_payment: 'คำขอนี้มีการจ่ายเงินแล้ว ต้องยกเลิกการจ่ายก่อนส่งกลับแก้ไข',
  reimbursement_correction_has_projection: 'คำขอนี้สร้างรายการค่าใช้จ่ายแล้ว กรุณายกเลิกคำขอและบันทึกใหม่',
  invalid_finance_decision: 'ผลการตรวจสอบของฝ่ายการเงินไม่ถูกต้อง กรุณาเลือกใหม่',
  duplicate_resolution_reason_required: 'กรุณาระบุเหตุผลที่ยืนยันว่าไม่ใช่รายการซ้ำ',

  // ---- รายการเบิกจ่าย: บัญชีรับเงินคืน ----
  // ทุกข้อความบอกสิ่งที่ต้องทำต่อ และไม่มีส่วนใดของเลขบัญชี
  payout_method_required: 'ยังไม่ได้เลือกวิธีรับเงินคืน แก้ไขคำขอเพื่อเลือกรับเป็นเงินสดหรือระบุบัญชี หรือตั้งบัญชีรับเงินคืนประจำ แล้วส่งอนุมัติอีกครั้ง',
  payout_destination_required: 'ยังไม่ได้ระบุบัญชีรับเงินคืน ระบุบัญชี หรือเลือกรับเป็นเงินสด',
  payout_destination_invalid: 'ข้อมูลบัญชีไม่ครบหรือรูปแบบไม่ถูกต้อง กรุณาตรวจธนาคาร ชื่อบัญชี และเลขบัญชี',
  // เว็บที่เปิดค้างไว้ก่อนอัปเดตยังไม่มีช่องยืนยัน จึงต้องบอกให้โหลดหน้าใหม่ด้วย
  payout_verification_required: 'ต้องยืนยันว่าตรวจบัญชีรับเงินแล้วก่อนอนุมัติ เปิดใบเบิกแล้วติ๊กยืนยันในขั้นอนุมัติ ถ้าไม่เห็นช่องยืนยัน กรุณาโหลดหน้าใหม่',
  payout_destination_changed: 'บัญชีรับเงินของใบนี้เปลี่ยนไปจากที่แสดงไว้ กรุณาเปิดใบใหม่ ตรวจบัญชีที่แสดงล่าสุด แล้วทำรายการอีกครั้ง',
  payout_reveal_denied: 'คุณไม่มีสิทธิ์ดูเลขบัญชีเต็มของใบนี้',
  payout_account_not_set: 'ยังไม่ได้ตั้งบัญชีรับเงินคืนประจำ',
  payout_account_edit_denied: 'คุณตั้งบัญชีรับเงินคืนของคนนี้ไม่ได้ ให้เจ้าของบัญชีตั้งเอง หรือให้เจ้าของกิจการหรือผู้ดูแลบริษัทตั้งให้',
  payout_member_not_found: 'ไม่พบพนักงานคนนี้ในบริษัท',
  // ระบบต้องแจ้งเจ้าของบัญชีทุกครั้งที่คนอื่นตั้งให้ และแจ้งได้เฉพาะสมาชิกที่ยังใช้งานอยู่
  payout_account_member_not_active: 'ตั้งบัญชีรับเงินคืนแทนได้เฉพาะเมื่อเจ้าของบัญชียังใช้งานระบบอยู่ เพราะระบบต้องแจ้งเจ้าของบัญชีทุกครั้ง เปิดใช้งานสมาชิกคนนี้ก่อน หรือให้เจ้าของบัญชีตั้งเองเมื่อเข้าใช้งานได้แล้ว',

  // ---- รายการเบิกจ่าย: แบบฟอร์มและลายเซ็น ----
  // "ยังไม่มีเลขที่เอกสาร" คือเหตุผลจริงที่พิมพ์ไม่ได้ — บอกให้ตรง ไม่ใช่แค่ว่าสถานะไม่ถูก
  claim_form_requires_submitted: 'พิมพ์แบบฟอร์มได้หลังส่งใบเบิกแล้ว เพราะใบร่างยังไม่มีเลขที่เอกสาร',
  claim_signature_role_not_eligible: 'คุณไม่ได้อยู่ในรายชื่อผู้ลงนามของใบเบิกนี้',
  claim_saved_signature_required: 'ยังไม่มีลายเซ็นที่พร้อมใช้งาน กรุณาบันทึกและรออนุมัติลายเซ็นก่อน',
  claim_signature_must_be_png_or_jpeg_max_2mb: 'ไฟล์ลายเซ็นต้องเป็น PNG หรือ JPEG ขนาดไม่เกิน 2 MB',
  claim_signature_too_large: 'ไฟล์ลายเซ็นใหญ่เกิน 2 MB กรุณาย่อขนาดแล้วอัปโหลดใหม่',
  claim_signature_attachment_invalid: 'ไม่พบไฟล์ลายเซ็นของคุณสำหรับใบเบิกนี้ กรุณาอัปโหลดใหม่',
  claim_signature_upload_not_found: 'ไม่พบไฟล์ลายเซ็นที่กำลังอัปโหลด กรุณาเลือกไฟล์ใหม่',
  claim_signature_bytes_mismatch: 'ไฟล์ลายเซ็นไม่ใช่รูปภาพตามชนิดที่ระบุ กรุณาอัปโหลดไฟล์ PNG หรือ JPEG',
  claim_signature_checksum_mismatch: 'ไฟล์ลายเซ็นถูกเปลี่ยนหลังอัปโหลด กรุณาลงนามใหม่',
  claim_signature_unreadable: 'อ่านไฟล์ลายเซ็นไม่ได้ กรุณาอัปโหลดไฟล์ใหม่',
  claim_form_signed_copy_denied: 'คุณไม่มีสิทธิ์แนบสำเนาแบบฟอร์มที่ลงนามแล้วของใบเบิกนี้',
  claim_form_signed_copy_attachment_invalid: 'ไฟล์ที่แนบต้องเป็นไฟล์ที่คุณอัปโหลดเองและยังใช้งานอยู่',
  claim_form_signed_copy_must_be_pdf_or_image: 'สำเนาแบบฟอร์มที่ลงนามต้องเป็นไฟล์ PDF หรือรูปภาพ',

  // หน้ารวมส่งชื่อตัวกรองที่ระบบไม่รู้จัก เกิดได้เมื่อเปิดหน้าเก่าค้างไว้ข้ามการอัปเดต
  reimbursement_list_bucket_invalid: 'ตัวกรองรายการนี้ใช้ไม่ได้ กรุณาโหลดหน้าใหม่แล้วเลือกตัวกรองอีกครั้ง',

  // ---- รายการเบิกจ่าย: จ่ายเงินและยกเลิก ----
  payment_date_invalid: 'วันที่จ่ายเงินไม่ถูกต้อง',
  payment_idempotency_key_invalid: 'ข้อมูลอ้างอิงการจ่ายเงินไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  reimbursement_payment_already_recorded:
    'ใบเบิกนี้บันทึกการจ่ายไปแล้วด้วยข้อมูลที่ต่างจากที่กรอก กรุณาโหลดรายการใหม่แล้วตรวจสอบ',
  reimbursement_payment_idempotency_conflict:
    'มีการบันทึกการจ่ายด้วยข้อมูลอื่นไปแล้ว กรุณาโหลดรายการใหม่แล้วตรวจสอบ',
  reimbursement_payment_changed: 'การจ่ายเงินถูกเปลี่ยนระหว่างทำรายการ กรุณาโหลดรายการใหม่แล้วลองอีกครั้ง',
  reimbursement_payment_state_changed: 'การจ่ายเงินถูกเปลี่ยนระหว่างทำรายการ กรุณาโหลดรายการใหม่แล้วลองอีกครั้ง',
  reimbursement_payment_number_conflict: 'เลขที่ใบจ่ายไม่ตรงกับที่จองไว้ กรุณาลองใหม่อีกครั้ง',
  // สลิปการจ่ายเงินคืน
  payment_slip_required: 'จ่ายด้วยการโอนต้องแนบสลิป',
  payment_slip_invalid: 'ไฟล์สลิปใช้ไม่ได้ เลือกไฟล์ PDF หรือรูปภาพ ขนาดไม่เกิน 10 MB แล้วลองใหม่',
  payment_slip_limit_reached: 'การจ่ายหนึ่งครั้งแนบสลิปได้ไม่เกิน 5 ไฟล์',
  payment_slip_access_denied: 'คุณไม่มีสิทธิ์เปิดสลิปของใบเบิกนี้',
  reimbursement_payment_slip_retained: 'ไฟล์นี้เป็นสลิปการจ่ายเงินคืน จึงลบไม่ได้',
  reimbursement_document_number_unavailable: 'ขอเลขที่เอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
  void_reason_required: 'กรุณาระบุเหตุผลการยกเลิกการจ่ายเงิน',
  // การยกเลิกการจ่ายเลิกจับคู่กับธนาคารให้เอง ยกเว้นรายการที่อยู่ในรอบกระทบยอดที่เสร็จสิ้นแล้ว ซึ่งต้องเปิดรอบนั้นใหม่ก่อน
  reimbursement_payment_bank_reconciled:
    'การจ่ายนี้จับคู่กับรายการเดินบัญชีธนาคารในรอบกระทบยอดที่เสร็จสิ้นแล้ว กรุณากด "เปิดใหม่" ที่รอบกระทบยอดนั้นในหน้าบัญชีธนาคารและกระทบยอดก่อน แล้วจึงยกเลิกการจ่ายอีกครั้ง',
  // ลำดับงานจริง: ต้องลงบัญชีตั้งหนี้ก่อน แล้วจึงจ่าย — บอกลำดับ ไม่ใช่แค่บอกว่าทำไม่ได้
  reimbursement_accrual_not_posted: 'ต้องลงบัญชีตั้งหนี้ของใบเบิกให้เสร็จก่อน จึงจะบันทึกการจ่ายได้',
  reimbursement_duplicate_settlement_pending:
    'ใบเบิกนี้ยังมีคำเตือนรายการซ้ำที่ค้างอยู่ กรุณาตรวจสอบก่อนจ่ายเงิน',
  reimbursement_duplicate_projection_posting_mismatch:
    'สถานะรายการซ้ำกับสถานะการลงบัญชีไม่สอดคล้องกัน กรุณาตรวจสอบรายการซ้ำอีกครั้ง',
  reimbursement_cancellation_pending: 'ใบเบิกนี้มีคำขอยกเลิกค้างอยู่ กรุณาโหลดรายการใหม่',
  reimbursement_cancellation_already_pending: 'มีคำขอยกเลิกใบเบิกนี้ด้วยเหตุผลอื่นค้างอยู่ กรุณาโหลดรายการใหม่',
  reimbursement_cancellation_state_changed: 'ใบเบิกถูกเปลี่ยนระหว่างยกเลิก กรุณาโหลดรายการใหม่แล้วลองอีกครั้ง',
  reimbursement_cancellation_intent_changed: 'คำขอยกเลิกถูกเปลี่ยนโดยผู้อื่น กรุณาโหลดรายการใหม่',
  reimbursement_cancellation_has_payment: 'ใบเบิกที่จ่ายเงินไปแล้วยกเลิกไม่ได้ ต้องยกเลิกการจ่ายเงินก่อน',
  reimbursement_cancellation_projection_live:
    'ยังมีรายการค่าใช้จ่ายที่สร้างจากใบเบิกนี้ค้างอยู่ ต้องยกเลิกรายการเหล่านั้นก่อน',

  // ---- รายการเบิกจ่าย: รายการค่าใช้จ่ายที่ระบบสร้างจากใบเบิก ----
  // ผู้ใช้ไม่ได้สร้างรายการเหล่านี้เอง ระบบสร้างให้ตอนอนุมัติจ่าย ข้อความจึงต้องบอกว่ามันคืออะไร
  // ไม่ใช่แค่ว่า "projection" ผิด
  reimbursement_projection_not_ready: 'รายการค่าใช้จ่ายที่ระบบสร้างจากใบเบิกยังไม่พร้อม กรุณาลองใหม่อีกครั้ง',
  reimbursement_projection_not_confirmed: 'รายการค่าใช้จ่ายที่ระบบสร้างจากใบเบิกยังไม่ได้ยืนยันลงบัญชี',
  reimbursement_projection_source_changed: 'รายการในใบเบิกถูกแก้ไขระหว่างดำเนินการ กรุณาโหลดรายการใหม่',
  reimbursement_projection_source_mismatch: 'ไม่พบรายการค่าใช้จ่ายที่ระบบสร้างจากใบเบิกนี้ กรุณาโหลดรายการใหม่',
  reimbursement_projection_state_changed: 'รายการค่าใช้จ่ายถูกเปลี่ยนระหว่างดำเนินการ กรุณาโหลดรายการใหม่',
  reimbursement_projection_decision_changed: 'ขั้นอนุมัติของใบเบิกเปลี่ยนไประหว่างทำรายการ กรุณาโหลดรายการใหม่',
  reimbursement_projection_branch_changed: 'สาขาของรายการเปลี่ยนไประหว่างดำเนินการ กรุณาโหลดรายการใหม่',
  reimbursement_projection_authority_mismatch: 'รายการค่าใช้จ่ายนี้ไม่ได้มาจากใบเบิกที่กำลังทำรายการอยู่',
  reimbursement_projection_requires_true_reversal:
    'รายการนี้ยืนยันลงบัญชีไปแล้ว ต้องยกเลิกแบบกลับรายการ ลบทิ้งเฉย ๆ ไม่ได้',

  // ---- ตั้งค่านโยบายการเบิกจ่าย ----
  approver_role_required: 'กรุณาเลือกบทบาทที่จะรับผิดชอบอนุมัติใบเบิก',
  approver_role_not_eligible: 'บทบาทนี้ยังไม่มีสิทธิ์หรือพนักงานที่พร้อมอนุมัติ กรุณาเลือกบทบาทอื่น',
  reimbursement_approver_not_ready: 'ยังไม่มีผู้อนุมัติที่รับผิดชอบใบเบิกนี้ กรุณาให้ผู้ดูแลตรวจบทบาท สิทธิ์ และสาขา แล้วส่งใหม่',
  internal_note_body_invalid: 'กรุณาเขียนโน้ตไม่เกิน 2,000 ตัวอักษร',
  reimbursement_policy_inactive: 'บริษัทปิดรับใบเบิกใหม่ชั่วคราว กรุณาติดต่อผู้ดูแลบริษัท',
  reimbursement_policy_changed: 'นโยบายถูกแก้ไขโดยผู้ใช้อื่น ระบบยังไม่บันทึกค่าของคุณ กรุณาโหลดค่าล่าสุดแล้วตรวจสอบอีกครั้ง',
  duplicate_company_policy: 'พบนโยบายบริษัทซ้ำ ระบบยังไม่บันทึก กรุณาติดต่อผู้ดูแลระบบ',
  invalid_reimbursement_policy_snapshot: 'ข้อมูลนโยบายของใบเบิกนี้ไม่สมบูรณ์ ระบบจึงหยุดรายการไว้เพื่อความปลอดภัย กรุณาติดต่อผู้ดูแลระบบ',
  invalid_approver_mode: 'รูปแบบผู้อนุมัติไม่ถูกต้อง กรุณาเลือกใหม่',
  invalid_duplicate_policy: 'นโยบายรายการซ้ำไม่ถูกต้อง กรุณาเลือกใหม่',
  invalid_threshold: 'ยอดที่ต้องขออนุมัติต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',
  invalid_sla_hours: 'จำนวนชั่วโมงที่กำหนดต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป',

  // ---- พนักงาน: เพิ่ม/แก้ไข ----
  // แต่ละโค้ดชี้ช่องที่ชนจริง เพราะหน้าเพิ่มพนักงานมีหลายช่องที่ต้องไม่ซ้ำ
  employee_identity_conflict: 'มีพนักงานที่ใช้เลขบัตรประชาชนหรือพาสปอร์ตนี้อยู่แล้ว',
  employee_draft_not_found: 'ไม่พบพนักงานนี้แล้ว กรุณาโหลดรายชื่อพนักงานใหม่',
  employee_draft_not_deletable: 'ลบได้เฉพาะร่างพนักงานที่ยังไม่เสร็จสิ้น กรุณาตรวจสอบสถานะล่าสุด',
  employee_phone_conflict: 'มีพนักงานที่ใช้เบอร์โทรศัพท์นี้อยู่แล้ว',
  employee_email_conflict: 'มีผู้ใช้ที่ใช้อีเมลนี้อยู่แล้ว',
  employee_username_conflict: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว กรุณาตั้งชื่อผู้ใช้อื่น',
  // ไม่ใช่ความผิดพลาด — เป็นทางแยกให้ผู้ใช้เลือกผูกบัญชีเดิม ข้อความจึงต้องไม่อ่านเหมือนถูกปฏิเสธ
  employee_existing_user: 'บัญชีนี้มีอยู่ในระบบแล้ว กรุณายืนยันเพื่อเพิ่มเป็นพนักงานของบริษัทนี้',
  employee_email_must_differ: 'อีเมลบริษัทต้องไม่ซ้ำกับอีเมลที่ใช้เข้าสู่ระบบของบัญชีเดิม',
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
  current_password_required: 'กรุณากรอกรหัสผ่านปัจจุบันก่อนเปลี่ยนรหัสผ่าน',
  current_password_incorrect: 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
  company_access_unavailable: 'คุณไม่มีสิทธิ์เข้าใช้บริษัทนี้แล้ว กรุณาติดต่อเจ้าของร้าน',
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
  line_identity_changed: 'การเชื่อมต่อ LINE เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง',
  line_identity_review_required: 'การเชื่อมต่อ LINE เดิมต้องให้ผู้ดูแลตรวจสอบ กรุณาติดต่อผู้ดูแลเพื่อออก QR เชื่อม LINE ใหม่',
  line_link_retry: 'ยังเชื่อม LINE ไม่สำเร็จ กรุณาลองสแกน QR เดิมอีกครั้ง หากหมดอายุให้ผู้ดูแลออก QR ใหม่',
  line_linked_elsewhere: 'LINE นี้เชื่อมกับบัญชีอื่นอยู่แล้ว เลือกได้ว่าจะรวมเป็นบัญชีเดียวหรือใช้แยกกันต่อ',
  // Provisioning refused the LINE identity by name instead of letting a unique violation become
  // "ข้อมูลซ้ำ" — an operator reading that had nothing to do next. Both say what to change.
  line_identity_already_linked: 'LINE ของผู้สมัครผูกกับบัญชีอื่นอยู่ ต้องปลดการเชื่อมในหน้าพาร์ทเนอร์ก่อน แล้วกดอนุมัติอีกครั้ง',
  line_identity_disabled: 'LINE ของผู้สมัครถูกปิดใช้งานอยู่ ต้องเปิดใช้งานก่อน แล้วกดอนุมัติอีกครั้ง',
  // Spec §4F account merge — same copy the welcome dialog's own map shows, so the message reads
  // identically wherever the code surfaces.
  merge_ticket_invalid: 'คำขอรวมบัญชีหมดอายุแล้ว กดปุ่มเชื่อมบัญชี LINE อีกครั้งเพื่อเริ่มใหม่',
  merge_ticket_expired: 'คำขอรวมบัญชีหมดอายุแล้ว กดปุ่มเชื่อมบัญชี LINE อีกครั้งเพื่อเริ่มใหม่',
  merge_ticket_not_yours: 'บัญชีที่เข้าใช้อยู่ไม่ตรงกับคำขอนี้ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
  merge_in_progress: 'กำลังรวมบัญชีอยู่ กรุณารอสักครู่แล้วเปิดหน้านี้ใหม่',
  merge_target_unavailable: 'บัญชีเดิมใช้งานไม่ได้ในตอนนี้ ติดต่อ 098-256-5628',
  merge_not_needed: 'สองบัญชีนี้เป็นบัญชีเดียวกันอยู่แล้ว ไม่ต้องรวม',
  // Review R05: fail closed. Two accounts hold different access to the same shop, and merging would
  // decide on its own which side wins — including closing a shop's only owner out of it.
  account_merge_role_conflict: 'รวมบัญชีไม่ได้ เพราะสองบัญชีมีสิทธิ์ในร้านเดียวกันไม่ตรงกัน ติดต่อ 098-256-5628 เพื่อให้ทีมงานจัดสิทธิ์ให้ก่อน',
  // Review F7: the self-serve window does not restart, so near its end a resent link would die
  // between the inbox and the tap. An operator reissue has no age limit and does restart it.
  claim_window_almost_over: 'ลิงก์หมดเขตแล้ว ขอลิงก์ใหม่จากทีมงานที่ 098-256-5628',

  // ---- ยอมรับข้อกำหนดการใช้งาน ----
  legal_acceptance_required: 'ต้องยอมรับข้อกำหนดการใช้งานและรับทราบประกาศความเป็นส่วนตัวก่อนใช้งาน',
  legal_acceptance_confirmation_required: 'กรุณาติ๊กยืนยันให้ครบทุกข้อก่อนกดยอมรับ',
  legal_acceptance_challenge_stale: 'บทบาทของคุณหรือข้อความทางกฎหมายเปลี่ยนไป กรุณาโหลดหน้าใหม่และอ่านอีกครั้ง',
  legal_document_version_stale: 'เอกสารทางกฎหมายมีฉบับใหม่ กรุณาโหลดหน้าใหม่และอ่านฉบับปัจจุบันก่อนยอมรับ',
  legal_acceptance_challenge_invalid: 'ข้อมูลยืนยันการอ่านไม่ถูกต้อง กรุณาโหลดหน้าใหม่',
  legal_acceptance_locale_unavailable: 'ขณะนี้รองรับการยอมรับเอกสารเฉพาะฉบับภาษาไทย',
  // ทางเดียวที่ผู้ใช้ทำได้จริงคือติดต่อฝ่ายสนับสนุน — กดซ้ำไม่ช่วย จึงต้องไม่เขียนว่า "ลองใหม่"
  legal_acceptance_incomplete: 'หลักฐานการยอมรับไม่สมบูรณ์ กรุณาติดต่อฝ่ายสนับสนุนก่อนดำเนินการต่อ',

  // ---- ข้อมูลร้านและบัญชีของฉัน (P10-L §15.4) ----
  // ลูกค้าที่เปิดร้านจาก LINE ไม่เคยมีรหัสผ่านมาก่อน ข้อความจึงต้องบอกทางไปต่อ ไม่ใช่แค่บอกว่าผิด
  email_belongs_to_other_account:
    'อีเมลนี้มีบัญชีอื่นใช้อยู่แล้ว ถ้าเป็นบัญชีของคุณเอง กรุณาเข้าสู่ระบบด้วยบัญชีเดิมแล้วผูก LINE เข้ากับบัญชีนั้น',
  account_email_conflict: 'อีเมลนี้มีบัญชีอื่นใช้อยู่แล้ว กรุณาใช้อีเมลอื่น อีเมลบัญชีของคุณยังไม่เปลี่ยน',
  account_email_changed: 'อีเมลบัญชีถูกเปลี่ยนจากอีกหน้าหรืออุปกรณ์แล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้อีกครั้ง',
  account_email_verified: 'อีเมลบัญชีนี้ยืนยันแล้ว กรุณาใช้ขั้นตอนเปลี่ยนอีเมลที่ยืนยันแล้ว',
  account_line_required: 'แก้อีเมลบัญชีด้วยวิธีนี้ได้เฉพาะบัญชีที่เชื่อม LINE อยู่ กรุณาเชื่อม LINE ก่อน',
  invalid_email: 'รูปแบบอีเมลไม่ถูกต้อง กรุณากรอกใหม่ เช่น somchai@gmail.com',
  password_already_set: 'บัญชีนี้มีรหัสผ่านอยู่แล้ว กรุณาใช้เมนูเปลี่ยนรหัสผ่านแทน',
  // ถ้ายังไม่มีทั้งอีเมลบัญชีและชื่อผู้ใช้ รหัสผ่านที่ตั้งไว้จะใช้เข้าระบบไม่ได้เลย
  username_required: 'บัญชีนี้ยังไม่มีอีเมลบัญชี กรุณาตั้งชื่อผู้ใช้ไว้ใช้คู่กับรหัสผ่าน',
  // ต้องบอกกติกาให้ครบ เพราะคนไทยจะพิมพ์ชื่อไทยเป็นอย่างแรก
  invalid_username: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 จุด ขีด และขีดล่าง ยาว 4 ถึง 64 ตัว (ภาษาไทยใช้ไม่ได้ค่ะ)',
  // `username_taken` already has copy above, shared with the Flow B claim screen.
  // Same sentence the profile form shows before it submits (PHONE_ERROR_MESSAGE in
  // features/company-profile/company-profile.logic.ts): one rule must not have two wordings.
  invalid_phone_number: 'เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678',
  partner_owner_name_invalid: 'กรุณากรอกชื่อ 1–160 ตัวอักษร โดยไม่มีอักขระควบคุม',
  partner_owner_name_unavailable: 'ไม่พบเจ้าของร้านที่แก้ชื่อได้ในบริษัทนี้ กรุณาโหลดข้อมูลใหม่',
  partner_owner_name_conflict: 'ชื่อบัญชีถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง',
  // spec §15.4.1 C: EMAIL_PROVIDER=disabled — the request is refused before a token exists,
  // rather than answering 202 over a letter that was never sent.
  email_delivery_unavailable: 'ตอนนี้ระบบยังส่งอีเมลยืนยันไม่ได้ค่ะ ติดต่อทีมงาน โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com',

  // ---- ตั้งค่าบริษัทและ VAT ----
  // จนถึง L-E ข้อความนี้ชี้ไปหน้าที่ยังไม่มีอยู่จริง ตอนนี้มีแล้วจึงเรียกชื่อเมนูตรง ๆ
  company_tax_identity_incomplete: 'ข้อมูลผู้เสียภาษีของบริษัทยังไม่ครบ กรุณากรอกให้ครบที่ ตั้งค่า › ข้อมูลร้านและบัญชีของฉัน ก่อน',
  company_business_type_invalid: 'เลือกประเภทธุรกิจจากรายการ DBD หรือเลือกอื่น ๆ',
  company_business_type_other_required: 'กรุณาระบุประเภทธุรกิจอื่น ๆ',
  company_business_type_other_invalid: 'ระบุประเภทธุรกิจอื่น ๆ ไม่เกิน 200 ตัวอักษร',
  company_business_type_version_conflict: 'ประเภทธุรกิจถูกแก้ไขแล้ว กรุณาโหลดหน้าใหม่ก่อนบันทึกอีกครั้ง',
  identity_change_kind_not_allowed: 'ข้อมูลชนิดนี้แก้เองไม่ได้ กรุณาติดต่อฝ่ายสนับสนุน',
  vat_registration_future_fact_conflict:
    'มีการบันทึกสถานะจดทะเบียน VAT ล่วงหน้าไว้แล้ว กรุณาเลือกว่าจะแทนที่รายการเดิมหรือไม่',
  vat_registration_backdated_crosses_filed_period:
    'วันที่จดทะเบียน VAT ย้อนหลังคร่อมงวดที่ยื่นแบบไปแล้ว กรุณาตรวจสอบกับผู้ทำบัญชีก่อนบันทึก',

  // ---- คิวคำขอสมัครใช้งาน (P10 Flow B) ----
  // ทั้งสองโค้ดมาจาก company-signup-core.service และโผล่ที่ปุ่มอนุมัติ/ปฏิเสธ/ส่งลิงก์ใหม่ในคิว
  // ทางแก้เดียวกันคือโหลดคิวใหม่ ข้อความจึงชี้ไปที่คิว ไม่ใช่ให้กดซ้ำ
  company_signup_request_not_found: 'ไม่พบคำขอสมัครนี้แล้ว กรุณาโหลดคิวคำขอใหม่',
  // R07/F6: the MX lookup could not answer, which says nothing about the address the applicant
  // typed. It may not read as a typo — the only correct instruction is to send the same form again.
  email_domain_check_unavailable: 'ตรวจอีเมลไม่ได้ชั่วคราว กรุณากดส่งคำขออีกครั้ง ลองใหม่ในอีกสักครู่',
  company_signup_concurrent_transition:
    'คำขอนี้ถูกดำเนินการโดยผู้ดูแลคนอื่นระหว่างทำรายการ กรุณาโหลดคิวคำขอใหม่แล้วตรวจสถานะล่าสุด',

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
  SALES_AGENT_SUSPENDED: 'บัญชีเซลล์นี้ถูกระงับอยู่ กรุณาติดต่อผู้ดูแลระบบให้เปิดใช้งานก่อน',
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
  BILLING_DEAL_EXPIRED: 'ข้อเสนอพิเศษนี้หมดอายุแล้ว กรุณาติดต่อทีมขายเพื่อขอข้อเสนอใหม่ คุณยังเลือกแพ็กเกจปกติได้',
  BILLING_DEAL_NOT_FOUND: 'ไม่พบข้อเสนอพิเศษนี้แล้ว กรุณาโหลดหน้านี้ใหม่ หรือติดต่อทีมขาย',
  BILLING_DEAL_SNAPSHOT_MISMATCH: 'ข้อเสนอพิเศษนี้เปลี่ยนแล้ว กรุณาโหลดหน้านี้ใหม่เพื่อดูข้อเสนอล่าสุดก่อนชำระเงิน',
  CONTROL_DEAL_SUBSCRIPTION_REVIEW: 'ร้านนี้มีสมาชิกที่ยังใช้งานอยู่ ทีมงานจะติดต่อกลับเพื่อเปลี่ยนให้ สิทธิ์เดิมยังใช้ได้ตามปกติ',
  BILLING_MODE_NOT_READY: 'ยังไม่เปิดวิธีชำระเงินที่เลือก กรุณาเลือกวิธีอื่น หรือติดต่อทีมงาน',
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
  invalid_taxId: 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง กรุณากรอกตัวเลข 13 หลัก',
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
  reason_required: 'กรุณาระบุเหตุผล',
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
  expense_backfill_confirmation_required: 'กรุณาดูตัวอย่างและยืนยันก่อนลงบัญชีเอกสารย้อนหลัง',
  expense_not_confirmed: 'ลงบัญชีได้เฉพาะค่าใช้จ่ายที่ยืนยันแล้ว กรุณายืนยันเอกสารก่อน',
  expense_payment_not_recorded: 'ยังลงบัญชีการจ่ายไม่ได้ เพราะรายการจ่ายค่าใช้จ่ายยังไม่ถูกบันทึก',
  functional_currency_fx_required: 'รายการสกุลเงินต่างประเทศต้องมีอัตราแลกเปลี่ยนที่ตรวจสอบแล้วก่อนลงบัญชี',
  journal_already_reversed: 'รายการบัญชีนี้ถูกกลับรายการแล้ว กรุณาตรวจประวัติแทนการทำซ้ำ',
  ledger_account_not_postable: 'บัญชีที่เลือกลงรายการไม่ได้หรือไม่ได้ใช้งาน กรุณาเลือกบัญชีใหม่',
  legacy_o0_tax_review_required: 'รายการภาษีอัตรา 0% ต้องระบุเหตุผลและใช้ Tax Code ที่ตรวจสอบแล้วก่อนลงบัญชี',
  legacy_tax_snapshot_review_required: 'ข้อมูลภาษีเดิมยังไม่ผ่านการตรวจสอบ กรุณาตรวจ Tax Code ของรายการก่อนลงบัญชี',
  manual_journal_account_not_available: 'บัญชีที่เลือกไม่พร้อมใช้งานหรืออยู่นอกบริษัท กรุณาเลือกใหม่',
  manual_journal_branch_not_available: 'สาขาที่เลือกไม่พร้อมใช้งานหรืออยู่นอกบริษัท กรุณาเลือกใหม่',
  manual_journal_provenance_forbidden: 'ข้อมูลต้นทางและข้อมูลภาษีของรายการบัญชีถูกกำหนดโดยระบบ กรุณาโหลดหน้าใหม่แล้วกรอกเฉพาะช่องที่แสดง',
  posting_unbalanced: 'ยอดเดบิตและเครดิตไม่เท่ากัน กรุณาตรวจรายการบัญชีก่อนบันทึก',
  reimbursement_payment_not_recorded: 'ยังลงบัญชีการจ่ายไม่ได้ เพราะรายการจ่ายคืนพนักงานยังไม่ถูกบันทึก',
  tax_functional_currency_mismatch: 'สกุลเงินของข้อมูลภาษีไม่ตรงกับสกุลเงินหลักของบริษัท กรุณาตรวจรายการภาษี',
  tax_period_filed: 'งวดภาษีนี้ยื่นแบบ ชำระ หรือปิดแล้ว กรุณาใช้ขั้นตอนปรับปรุงแบบก่อนเปิดงวดบัญชี',
  unsupported_posting_source: 'แหล่งที่มาของรายการนี้ไม่รองรับการลงบัญชีอัตโนมัติ กรุณาใช้เมนูบันทึกรายการบัญชีด้วยตนเอง',

  // ---- การตั้งค่าภาษี ----
  tax_code_import_blocked: 'ยังนำเข้า Tax Code ไม่ได้ กรุณาแก้ข้อผิดพลาดในตัวอย่างก่อนยืนยัน',
  pp36_historical_tax_snapshot_changed: 'ข้อมูลภาษี ภ.พ.36 เดิมเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจสอบอีกครั้ง',
  overlapping_active_profile_identity: 'มีชุดตั้งค่าภาษีที่ใช้งานในช่วงเวลาเดียวกัน กรุณาปรับช่วงวันที่ไม่ให้ซ้อนกัน',
  overlapping_default_profile: 'มีชุดตั้งค่าภาษีเริ่มต้นในช่วงเวลาเดียวกัน กรุณาปรับช่วงวันที่ไม่ให้ซ้อนกัน',
  invalid_tax_code_definition: 'ข้อมูล Tax Code ไม่ถูกต้อง กรุณาตรวจรหัส อัตรา และเงื่อนไข',
  missing_account_rule: 'Tax Code นี้ยังไม่มีกฎผูกบัญชีที่จำเป็น กรุณาตั้งค่าบัญชีให้ครบ',
  missing_report_rule: 'Tax Code นี้ยังไม่มีกฎลงแบบภาษีที่จำเป็น กรุณาตั้งค่าช่องรายงานให้ครบ',
  invalid_account_rule: 'กฎผูกบัญชีภาษีไม่ถูกต้อง กรุณาตรวจบัญชี บทบาท และช่วงวันที่',
  account_rule_effective_window_incomplete: 'กรุณาระบุวันเริ่มและวันสิ้นสุดของกฎผูกบัญชีให้ครบทั้งคู่',
  invalid_report_rule: 'กฎลงแบบภาษีไม่ถูกต้อง กรุณาตรวจแบบ ช่อง และแหล่งยอด',
  report_rule_effective_window_incomplete: 'กรุณาระบุวันเริ่มและวันสิ้นสุดของกฎลงแบบภาษีให้ครบทั้งคู่',
  tax_profile_incomplete: 'ชุดตั้งค่าภาษียังไม่ครบ กรุณาแก้รายการที่ระบบระบุก่อนเปิดใช้งาน',
  profile_has_no_definitions: 'ชุดตั้งค่าภาษียังไม่มี Tax Code กรุณาเพิ่มอย่างน้อยหนึ่งรายการ',
  profile_already_active: 'ชุดตั้งค่าภาษีนี้เปิดใช้งานอยู่แล้ว กรุณาโหลดสถานะล่าสุด',
  profile_readiness_blockers_truncated: 'พบรายการที่ต้องแก้มากกว่าที่แสดง กรุณาแก้รายการที่เห็นแล้วตรวจความพร้อมอีกครั้ง',
  invalid_tax_code_semantics: 'ความหมายหรือเงื่อนไขของ Tax Code ขัดกัน กรุณาตรวจประเภทภาษีและอัตรา',
  legacy_transaction_tax_remediation_blocked: 'ยังแก้ข้อมูลภาษีเดิมไม่ได้ เพราะมีรายการที่ต้องตรวจ กรุณาดำเนินการตามรายการตรวจสอบก่อน',
  wht_handoff_link_command_reused: 'คำขอแนบหนังสือรับรองนี้ถูกใช้กับรายการอื่นแล้ว กรุณาโหลดงานใหม่',
  wht_handoff_not_linkable: 'สถานะของงานนี้ยังแนบหนังสือรับรองไม่ได้ กรุณาตรวจสถานะล่าสุด',
  wht_handoff_already_linked: 'หนังสือรับรองนี้ถูกแนบไว้แล้ว กรุณาตรวจเอกสารที่เชื่อมอยู่',
  wht_handoff_not_issuable: 'สถานะของรายการนี้เปลี่ยนไปแล้ว ไม่สามารถพิมพ์เอกสารทวิ 50 ได้ในตอนนี้ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  wht_system_issuance_unavailable: 'ระบบยังไม่เปิดการออกหนังสือรับรองอัตโนมัติ',
  wht_handoff_form_type_unresolved: 'ไม่สามารถระบุแบบ ภ.ง.ด. ได้ กรุณาตรวจสอบประเภทผู้รับเงินก่อนออกเอกสาร',
  wht_handoff_income_category_missing: 'ไม่มีข้อมูลประเภทเงินได้/อัตราหัก ณ ที่จ่ายในรายการนี้ กรุณากรอกให้ครบก่อนออกเอกสาร',
  wht_certificate_issue_in_progress: 'กำลังออกเอกสารนี้อยู่ กรุณาลองใหม่อีกครั้ง',
  wht_certificate_not_correctable: 'แก้ไข/ออกใบแทนไม่ได้ เพราะไม่ใช่เอกสารที่ระบบออกให้ กรุณาโหลดหน้าใหม่แล้วตรวจสถานะ',
  wht_certificate_already_superseded: 'หนังสือรับรองนี้ถูกแทนที่ไปแล้ว กรุณาโหลดข้อมูลใหม่',
  wht_system_correction_unavailable: 'ระบบยังไม่เปิดการแก้ไขหนังสือรับรองอัตโนมัติ',
  wht_certificate_correction_tax_period_locked: 'งวดภาษีของหนังสือรับรองนี้ปิดแล้ว ไม่สามารถแก้ไขยอด/อัตรา/หมวดเงิน/วันที่ได้ กรุณาทำรายการแก้ไขทางบัญชีแยกต่างหาก',
  wht_system_replacement_unavailable: 'ระบบยังไม่เปิดการออกใบแทนอัตโนมัติ',
  wht_signature_attachment_required: 'กรุณาอัปโหลดรูปลายเซ็นก่อนเปิดใช้การประทับอัตโนมัติ',
  tax_reviewer_role_required: 'รายการนี้ต้องให้ผู้ตรวจภาษีดำเนินการ กรุณาติดต่อผู้ที่ได้รับมอบหมาย',

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
  BILLING_COMPANY_PROFILE_REQUIRED: 'กรุณากรอกข้อมูลบริษัทให้ครบก่อนซื้อแพ็กเกจ',
  BILLING_INPUT_INVALID: 'ข้อมูลรายการชำระเงินไม่ถูกต้อง กรุณาตรวจรายการแล้วลองใหม่',
};

// Several upload rejections differ only in which check caught the file; the user's next move is
// the same, so they share one sentence rather than four near-identical ones.
const UPLOAD_TYPE_MISMATCH =
  'ไฟล์นี้มีชนิดไฟล์ไม่ตรงกับข้อมูลภายใน ระบบจึงแนบไม่ได้ กรุณาเลือกไฟล์ใหม่ หรือบันทึกเป็น PDF/JPG/PNG แล้วลองอีกครั้ง';
const UPLOAD_QUOTA_EXCEEDED = 'มีไฟล์ที่ค้างอัปโหลดอยู่หลายรายการ กรุณาอัปโหลดให้เสร็จหรือรอสักครู่แล้วลองใหม่';
const UPLOAD_CONTENT_REJECTED =
  'ระบบตรวจไฟล์นี้ไม่ผ่านความปลอดภัย จึงไม่รับไฟล์ กรุณาใช้ไฟล์อื่น หรือถ่ายรูป/สแกนเอกสารเป็นภาพแล้วอัปโหลดแทน';

/** Full English messages the user can actually hit in the expense/substitute journeys. */
const MESSAGE_LABELS: Record<string, string> = {
  // Default-open feature messages that predate stable codes. Keep these exact and reviewed until
  // their APIs migrate; an unknown server sentence still falls through to the safe status copy.
  'LINE channel configuration is missing.': 'ระบบเข้าสู่ระบบด้วย LINE ยังไม่พร้อม กรุณาติดต่อทีมงานเพื่อตรวจการตั้งค่า',
  'LINE Login channel is not configured.': 'ระบบเข้าสู่ระบบด้วย LINE ยังไม่พร้อม กรุณาติดต่อทีมงานเพื่อตรวจการตั้งค่า',
  'Web base URL is not configured.': 'ระบบยังสร้างลิงก์กลับเข้าหน้าเว็บไม่ได้ กรุณาติดต่อทีมงานเพื่อตรวจการตั้งค่า',
  'This email is already being used by another account.': 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว กรุณาใช้อีเมลอื่นหรือเข้าสู่บัญชีเดิม',
  'This email is already verified for your account.': 'อีเมลนี้ยืนยันกับบัญชีของคุณแล้ว ไม่ต้องยืนยันซ้ำ',
  'Customer is not active': 'ลูกค้ารายนี้ไม่ได้ใช้งานแล้ว กรุณาเลือกลูกค้าที่ใช้งานอยู่',
  'Customer is not editable': 'แก้ไขลูกค้ารายนี้ไม่ได้ในสถานะปัจจุบัน กรุณาตรวจสถานะล่าสุด',
  'Customer cannot be archived': 'ยังปิดการใช้งานลูกค้ารายนี้ไม่ได้ กรุณาตรวจงานที่ค้างอยู่',
  'Customer cannot be assigned': 'ยังเปลี่ยนผู้ดูแลลูกค้ารายนี้ไม่ได้ กรุณาตรวจสถานะล่าสุด',
  'Follow-up is closed': 'งานติดตามนี้ปิดแล้ว กรุณาตรวจประวัติแทนการแก้ไขซ้ำ',
  'Follow-up cannot be completed': 'ปิดงานติดตามนี้ไม่ได้ในสถานะปัจจุบัน กรุณาโหลดข้อมูลล่าสุด',
  'Follow-up cannot be snoozed': 'เลื่อนงานติดตามนี้ไม่ได้ในสถานะปัจจุบัน กรุณาโหลดข้อมูลล่าสุด',
  'Follow-up cannot be canceled': 'ยกเลิกงานติดตามนี้ไม่ได้ในสถานะปัจจุบัน กรุณาโหลดข้อมูลล่าสุด',
  'Unknown conversation status': 'สถานะบทสนทนาไม่ถูกต้อง กรุณาเลือกสถานะใหม่',
  'assignedToUserId must be a user id or null': 'ผู้รับผิดชอบบทสนทนาไม่ถูกต้อง กรุณาเลือกใหม่หรือล้างผู้รับผิดชอบ',
  'assignedToUserId must be an active company member': 'ผู้รับผิดชอบต้องเป็นสมาชิกบริษัทที่ใช้งานอยู่ กรุณาเลือกคนใหม่',
  'defaultBookingBranchId must belong to the company': 'สาขาเริ่มต้นของการจองต้องเป็นสาขาในบริษัทนี้ กรุณาเลือกใหม่',
  'Channel Secret does not match this channel. Copy it from Basic settings of this Messaging API channel.':
    'Channel Secret ไม่ตรงกับช่องทางนี้ กรุณาคัดลอกจาก Basic settings ของ LINE Developers แล้วลองใหม่',
  'This LINE channel is already connected.': 'ช่องทาง LINE นี้เชื่อมต่ออยู่แล้ว กรุณาเปิดการตั้งค่าเดิมแทนการเชื่อมซ้ำ',
  'Channel is disabled': 'ช่องทาง LINE นี้ปิดใช้งานอยู่ กรุณาเปิดใช้งานก่อนดำเนินการต่อ',
  'Invalid quiet hours format': 'ช่วงเวลางดแจ้งเตือนไม่ถูกต้อง กรุณาเลือกเวลาเริ่มและเวลาสิ้นสุดใหม่',
  'legalIdentityVersion is stale; reload and retry': 'ข้อมูลผู้เสียภาษีถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง',
  'taxId must be 13 digits': 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก',
  // Legal-identity PATCH validation (company-identity.use-case.ts), hit from both the shop's own
  // settings page and the admin partner console (item 7, 2026-09-29 review).
  'registeredName must be 1-255 characters': 'ชื่อจดทะเบียนต้องมีความยาว 1–255 ตัวอักษร',
  'invalid addressJson': 'ที่อยู่ตามทะเบียนไม่ถูกต้องหรือกรอกไม่ครบ กรุณาตรวจที่อยู่ ตำบล/แขวง อำเภอ/เขต จังหวัด และรหัสไปรษณีย์ 5 หลัก',
  'at least one identity field must be supplied': 'กรุณาระบุอย่างน้อยหนึ่งช่อง: เลขผู้เสียภาษี ชื่อจดทะเบียน หรือที่อยู่ตามทะเบียน',
  'Exactly one employee role is required.': 'กรุณาเลือกบทบาทพนักงานหนึ่งบทบาท',
  'Draft employee status can only be changed by completing the employee wizard.': 'พนักงานรายนี้ยังเป็นฉบับร่าง กรุณาทำขั้นตอนเพิ่มพนักงานให้ครบก่อนเปลี่ยนสถานะ',
  'Source draft cannot be read safely.': 'อ่านข้อมูลร่างต้นทางไม่ครบ กรุณาโหลดรายการใหม่ก่อนดำเนินการต่อ',
  'The scanned form attachment is not ACTIVE.': 'ไฟล์แบบฟอร์มที่สแกนไม่ได้ใช้งานแล้ว กรุณาอัปโหลดไฟล์ใหม่',
  'กรุณาระบุวันที่จ่ายเงินที่ถูกต้อง': 'กรุณาระบุวันที่จ่ายเงินที่ถูกต้อง',
  'เอกสารเปลี่ยนแปลงหรือออกสมบูรณ์แล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไข':
    'เอกสารเปลี่ยนแปลงหรือออกสมบูรณ์แล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไข',
  'periodKey must be YYYY-MM': 'งวดไม่ถูกต้อง กรุณาเลือกเดือนและปีใหม่',
  'Journal unbalanced': 'ยอดเดบิตและเครดิตไม่เท่ากัน กรุณาตรวจรายการบัญชีก่อนบันทึก',
  'Receipt changed before OCR could be saved': 'ใบเสร็จถูกแก้ไขระหว่างอ่านข้อมูล กรุณาเปิดใบเสร็จล่าสุดแล้วลองใหม่',
  'Suggestion has expired': 'คำแนะนำนี้หมดอายุแล้ว กรุณาสร้างคำแนะนำใหม่',
  'A source draft was already created for this action': 'คำแนะนำนี้สร้างร่างต้นทางแล้ว กรุณาเปิดร่างเดิมแทนการสร้างซ้ำ',
  'Source record changed after generation; regenerate or acknowledge': 'ข้อมูลต้นทางเปลี่ยนหลังสร้างคำแนะนำ กรุณาสร้างใหม่หรือยืนยันว่าตรวจแล้ว',
  'Template unavailable': 'ไม่พบแบบร่างที่ใช้สร้างรายการ กรุณาเลือกใหม่หรือติดต่อผู้ดูแลระบบ',
  'Invalid cursor': 'ตำแหน่งหน้ารายการไม่ถูกต้อง กรุณากลับไปหน้าแรกและโหลดใหม่',
  'Email already in use by another user.': 'อีเมลนี้ถูกใช้โดยผู้ใช้อื่นแล้ว กรุณาใช้อีเมลอื่น',
  'Invalid idempotency key': 'ข้อมูลอ้างอิงรายการไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  'Receipt access changed. Reload and check your permissions.': 'สิทธิ์ใช้งานเปลี่ยนแล้ว โหลดข้อมูลล่าสุด หากยังอัปโหลดไม่ได้ ให้ติดต่อผู้ดูแลบริษัท',
  'Signature access changed.': 'สิทธิ์ใช้งานเปลี่ยนแล้ว โหลดข้อมูลล่าสุดก่อนบันทึกลายเซ็นอีกครั้ง',
  'Signature belongs to another owner.': 'บันทึกลายเซ็นนี้ไม่ได้ กรุณาใช้รูปที่คุณอัปโหลดเอง',
  'Expense revision unavailable. Reload before uploading.': 'ยังตรวจข้อมูลล่าสุดไม่ได้ โหลดรายการใหม่ก่อนอัปโหลดอีกครั้ง',
  'Expense changed. Reload and review before uploading again.': 'รายการถูกแก้ไขแล้ว โหลดข้อมูลล่าสุดและตรวจสอบก่อนอัปโหลดอีกครั้ง',
  'WHT amount cannot exceed the accepted pre-VAT amount.': 'ยอดภาษีหัก ณ ที่จ่ายเกินฐานที่ใช้คำนวณ กรุณาตรวจยอดและฐานภาษี',
  'WHT amount cannot exceed the document total or leave a negative payable.': 'ยอดภาษีหัก ณ ที่จ่ายเกินยอดเอกสาร กรุณาตรวจยอดและฐานภาษี',
  'Sales cannot approve their own quotation issue request': 'ผู้ส่งขออนุมัติไม่สามารถอนุมัติใบเสนอราคาของตนเองได้ กรุณาให้ผู้มีสิทธิ์คนอื่นอนุมัติ',
  'Tax branch code must be 5 digits.': 'รหัสสาขาภาษีต้องเป็นตัวเลข 5 หลัก หรือเว้นว่างหากไม่มี',
  'Branch code must be 1-20 uppercase alphanumeric characters, underscores, or hyphens.': 'รหัสสาขาต้องยาว 1–20 ตัว ใช้ A–Z, 0–9, ขีดกลาง หรือขีดล่างเท่านั้น',
  'Duplicate value: a record with the same unique field(s) already exists. Fields: companyId, supplierId, supplierDocumentNumber':
    CODE_LABELS['duplicate_supplier_document_number']!,
  'Insufficient permissions.': CODE_LABELS['insufficient_permissions']!,
  'Access denied': CODE_LABELS['insufficient_permissions']!,
  'Branch is outside your assigned branch scope.': 'รายการนี้อยู่นอกสาขาที่คุณได้รับมอบหมาย',
  // หน้าพนักงานล็อกตัวเลือกสาขาไว้ให้แล้ว ข้อความนี้มีไว้สำหรับหน้าที่เปิดค้างก่อนข้อมูลเปลี่ยน
  "Cannot assign access outside the requester's branch scope.": 'เปลี่ยนสาขาของพนักงานคนนี้ไม่ได้ เพราะพนักงานอยู่ในสาขาที่บัญชีของคุณเข้าไม่ถึง หรือสาขาที่เลือกอยู่นอกสาขาของคุณ กรุณาติดต่อเจ้าของร้าน',
  'Expense requires a receipt attachment or a missing receipt reason.':
    'ต้องแนบไฟล์ใบเสร็จ หรือระบุเหตุผลที่ไม่มีใบเสร็จ ก่อนยืนยันลงบัญชี',
  'Every VAT-bearing expense line requires a server-resolved Tax Code snapshot before confirmation.':
    'ทุกบรรทัดที่มี VAT ต้องเลือก Tax Code ก่อนยืนยันลงบัญชี',
  'Expense confirmation is available on the authenticated web only.':
    'ยืนยันลงบัญชีได้จากหน้าเว็บที่เข้าสู่ระบบแล้วเท่านั้น',
  'A current issued ใบรับรองแทนใบเสร็จรับเงิน artifact is required; a text reason or legacy timestamp is not sufficient.':
    'ต้องมีใบรับรองแทนใบเสร็จรับเงินฉบับที่ออกเรียบร้อยแล้ว การระบุเหตุผลเป็นข้อความอย่างเดียวยังไม่พอ',
  'Internal substitute evidence must remain supporting-only and non-claimable for input VAT.':
    'เอกสารที่ใช้ใบรับรองแทนใบเสร็จ ต้องเป็นหลักฐานประกอบ และขอคืนภาษีซื้อไม่ได้',
  'A receipt or tax invoice is eligible only when it is unavailable or materially incomplete; a valid document must use the normal path.':
    'ใบเสร็จหรือใบกำกับภาษีที่สมบูรณ์อยู่แล้ว ใช้ใบรับรองแทนใบเสร็จไม่ได้ — ใบรับรองใช้เฉพาะกรณีขอใบเสร็จไม่ได้หรือใบเสร็จไม่ครบสาระสำคัญ',
  'Configure substitute-receipt approvers and cash evidence policy in company settings before preparation.':
    'ต้องตั้งค่าผู้อนุมัติและนโยบายหลักฐานเงินสดในหน้าตั้งค่าบริษัทก่อน จึงจะจัดทำใบรับรองแทนใบเสร็จได้',
  'The payer cannot approve their own substitute receipt.':
    'ผู้จ่ายเงินอนุมัติใบรับรองของตนเองไม่ได้ ต้องให้ผู้มีสิทธิอนุมัติคนอื่นเป็นผู้อนุมัติ',
  'You are not a currently configured substitute-receipt approver for this branch.':
    'คุณไม่ได้ถูกกำหนดเป็นผู้อนุมัติใบรับรองแทนใบเสร็จของสาขานี้',
  'The same file cannot serve as both source/supporting evidence and payment evidence.':
    'ไฟล์เดียวกันใช้เป็นทั้งหลักฐานต้นทางและหลักฐานการจ่ายไม่ได้ ต้องแนบคนละไฟล์',
  'Current company policy requires separate payment evidence for cash expenses. Supersede and prepare a new version.':
    'นโยบายบริษัทกำหนดให้รายการเงินสดต้องมีหลักฐานการจ่ายแยกไฟล์ กรุณายกเลิก version นี้แล้วจัดทำ version ใหม่',
  'The reviewed preview no longer matches. Generate and review a new preview before signing.':
    'ตัวอย่างที่ตรวจไว้ไม่ตรงกับฉบับปัจจุบัน กรุณาสร้างและตรวจตัวอย่างใหม่ก่อนลงนาม',
  'Cannot reach the authentication service. Please try again.':
    'เชื่อมต่อระบบยืนยันตัวตนไม่ได้ กรุณาลองใหม่อีกครั้ง',
  // Substitute-receipt eligibility (the rest of the กติกาใบแทน family)
  'Legacy substitute markers and unreviewed source types are not eligible.':
    'เอกสารที่ใช้เครื่องหมายใบแทนแบบเก่า หรือยังไม่ได้ตรวจประเภทเอกสาร ใช้ใบรับรองแทนใบเสร็จไม่ได้',
  'Quotation, order-only, appointment, booking, reservation, non-business, unreadable, or ambiguous images are not eligible.':
    'ใบเสนอราคา ใบสั่งซื้อ ใบนัด การจอง เอกสารที่ไม่ใช่ธุรกิจ หรือรูปที่อ่านไม่ได้/กำกวม ใช้ใบรับรองแทนใบเสร็จไม่ได้',
  'A finance override does not make a quotation, order, appointment, booking, reservation, or non-expense image eligible for substitute evidence.':
    'แม้การเงินจะยืนยันประเภทเอกสารแทน AI แล้ว ใบเสนอราคา/ใบสั่งซื้อ/ใบนัด/การจอง หรือรูปที่ไม่ใช่ค่าใช้จ่าย ก็ยังใช้ใบรับรองแทนใบเสร็จไม่ได้',
  'ใบรับรองแทนใบเสร็จรับเงิน currently supports THB expenses only.':
    'ใบรับรองแทนใบเสร็จรับเงินรองรับเฉพาะรายการสกุลเงินบาท (THB)',
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
  'Tax evidence status must be reviewed first.': 'ต้องตรวจสถานะหลักฐานภาษีก่อน',
  'Internal substitute evidence cannot preserve input VAT. Set it to supporting/non-claimable or request an issuer-created replacement tax invoice.':
    'ใบรับรองแทนที่ออกภายในใช้รักษาภาษีซื้อไม่ได้ ให้ตั้งเป็นหลักฐานประกอบ/ขอคืนไม่ได้ หรือขอใบแทนใบกำกับภาษีจากผู้ขาย',
  // Substitute-receipt prepare / certify / approve
  'Invalid substitute receipt reasonCode.': 'เหตุผลการออกใบรับรองแทนใบเสร็จไม่ถูกต้อง',
  'Expense changed after review. Reload before preparing substitute evidence.':
    'เอกสารถูกแก้ไขหลังการตรวจ กรุณาเปิดใหม่ก่อนจัดทำใบรับรองแทนใบเสร็จ',
  'The selected payer is not an active company member in this branch.':
    'ผู้จ่ายเงินที่เลือกไม่ใช่สมาชิกที่ใช้งานอยู่ในสาขานี้',
  'No configured approver with expense.confirm is eligible for this branch and distinct from the selected payer.':
    'ไม่มีผู้อนุมัติที่ตั้งค่าไว้ซึ่งมีสิทธิ์ยืนยันลงบัญชีในสาขานี้และเป็นคนละคนกับผู้จ่ายเงิน',
  'Every evidence attachment must be ACTIVE and linked to this expense.':
    'ไฟล์หลักฐานทุกไฟล์ต้องยังใช้งานอยู่และผูกกับเอกสารนี้',
  'Payment evidence must be an image/PDF linked with purpose expense.payment.evidence.':
    'หลักฐานการจ่ายต้องเป็นรูปภาพ/PDF ที่แนบไว้ในช่องหลักฐานการจ่ายเท่านั้น',
  'Payment method is required.': 'กรุณาระบุวิธีการจ่ายเงิน',
  'Payment date is required because the payer certifies an amount already paid for company business.':
    'กรุณาระบุวันที่จ่ายเงิน เพราะผู้จ่ายรับรองยอดที่ได้จ่ายไปแล้ว',
  'Linked source/payment evidence changed. Finance must prepare a new version.':
    'หลักฐานที่ผูกไว้ถูกเปลี่ยน การเงินต้องจัดทำ version ใหม่',
  'Expense details changed after preparation. Finance must prepare a new version.':
    'ข้อมูลเอกสารถูกแก้ไขหลังจัดทำ การเงินต้องจัดทำ version ใหม่',
  'The payer must acknowledge the certification statement.': 'ผู้จ่ายต้องยอมรับคำรับรองก่อนลงนาม',
  'The approver must acknowledge approval.': 'ผู้อนุมัติต้องยอมรับการอนุมัติก่อน',
  'The payer must certify an immutable snapshot before approval.': 'ผู้จ่ายเงินต้องลงนามรับรองก่อนจึงจะอนุมัติได้',
  'The certified payer signature checksum is missing.': 'ไม่พบข้อมูลตรวจสอบลายเซ็นของผู้จ่ายที่รับรองแล้ว กรุณาจัดทำ version ใหม่',
  'Approval must acknowledge the current payer-certified artifact checksum.':
    'เอกสารฉบับที่ผู้จ่ายลงนามถูกเปลี่ยน กรุณาเปิดตรวจฉบับล่าสุดก่อนอนุมัติ',
  'The payer signature changed after certification.': 'ลายเซ็นผู้จ่ายถูกเปลี่ยนหลังการรับรอง กรุณาจัดทำ version ใหม่',
  'Certified snapshot checksum is invalid.': 'ข้อมูลรับรองไม่สมบูรณ์ กรุณาจัดทำ version ใหม่',
  'Substitute evidence changed. Reload before cancelling or correcting it.':
    'ใบรับรองแทนใบเสร็จถูกเปลี่ยนแปลง กรุณาเปิดใหม่ก่อนยกเลิกหรือแก้ไข',
  'Only an unconfirmed expense can cancel or replace substitute evidence.':
    'ยกเลิกหรือแก้ใบรับรองแทนใบเสร็จได้เฉพาะเอกสารที่ยังไม่ยืนยันเท่านั้น',
  'Substitute evidence changed while superseding.': 'ใบรับรองแทนใบเสร็จถูกเปลี่ยนระหว่างยกเลิก version กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  'Idempotency key was already used with different substitute-receipt data.':
    'มีการจัดทำใบรับรองด้วยข้อมูลอื่นไปแล้ว กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  // Signature uploads (certify/approve)
  'Per-certificate signature must be a PNG/JPEG file up to 2 MB.': 'ไฟล์ลายเซ็นต้องเป็น PNG/JPEG ขนาดไม่เกิน 2 MB',
  'Pending signature upload not found for this signer.': 'ไม่พบไฟล์ลายเซ็นที่กำลังอัปโหลดของผู้ลงนามนี้ กรุณาเลือกไฟล์ใหม่',
  'Signature bytes do not match the declared PNG/JPEG MIME type.': 'ไฟล์ลายเซ็นไม่ใช่รูปภาพตามชนิดที่ระบุ',
  'Signature image must be at most 2 MB.': 'ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB',
  'Signature checksum does not match storage.': 'ไฟล์ลายเซ็นถูกเปลี่ยนแปลงหลังอัปโหลด กรุณาลงนามใหม่',
  // Confirm rules beyond the receipt slot
  'Expense has unresolved duplicate warning. Dismiss or override before confirming.':
    'มีคำเตือนรายการซ้ำที่ยังไม่จัดการ กรุณาตรวจสอบรายการซ้ำก่อนยืนยันลงบัญชี',
  'Finance permission required to confirm expense without receipt attachment.':
    'ต้องมีสิทธิ์ฝ่ายการเงินจึงจะยืนยันเอกสารที่ไม่มีใบเสร็จแนบได้',
  'Expense date is required for confirmation.': 'ต้องระบุวันที่ค่าใช้จ่ายก่อนยืนยันลงบัญชี',
  'Grand total amount is invalid.': 'ยอดรวมไม่ถูกต้อง',
  'A receipt, substitute receipt, or supporting-only document cannot retain a Tax Code.':
    'ใบเสร็จ ใบรับรองแทน หรือหลักฐานประกอบ ใช้ Tax Code ไม่ได้ (ต้องเป็นใบกำกับภาษี)',
  'A receipt, substitute receipt, or supporting-only document cannot claim input VAT.':
    'ใบเสร็จ ใบรับรองแทน หรือหลักฐานประกอบ ขอคืนภาษีซื้อไม่ได้',
  'Domestic input VAT requires a reviewed TAX_INVOICE with usable tax evidence.':
    'ภาษีซื้อในประเทศต้องมีใบกำกับภาษีที่ตรวจแล้วและหลักฐานใช้ทางภาษีได้',
  'Domestic input VAT requires an attached tax invoice, supplier tax ID, and tax invoice number.':
    'ภาษีซื้อในประเทศต้องแนบใบกำกับภาษี พร้อมเลขผู้เสียภาษีผู้ขายและเลขที่ใบกำกับภาษี',
  'This document is classified as non-expense. Finance must explicitly override the source document type before advancing.':
    'AI จัดเอกสารนี้เป็น "ไม่ใช่ค่าใช้จ่าย" การเงินต้องยืนยันประเภทเอกสารเองก่อนดำเนินการต่อ',
  // Non-expense classification override
  'No unresolved non-expense classification to override.': 'ไม่มีผลการจัดประเภทที่ค้างให้ยืนยันแล้ว',
  'Select a reviewed expense source document type before overriding the classification.':
    'กรุณาเลือกประเภทเอกสารที่ตรวจแล้วก่อนยืนยันแทนผลของ AI',
  'Classification override reason is required and must not exceed 500 characters.':
    'ต้องระบุเหตุผลการยืนยันประเภทเอกสาร ไม่เกิน 500 ตัวอักษร',
  'Re-run document classification before overriding this expense.': 'กรุณาสั่งให้ AI อ่านเอกสารใหม่ก่อนยืนยันประเภทเอกสาร',
  'Remove the existing Tax Code lines before classifying this document as a receipt, substitute receipt, or supporting-only evidence.':
    'กรุณานำ Tax Code ออกจากรายการก่อนจัดประเภทเอกสารเป็นใบเสร็จ/ใบรับรองแทน/หลักฐานประกอบ',
  // Void / payment
  'Posting state changed while voiding. Retry the void.': 'สถานะการลงบัญชีเปลี่ยนระหว่างยกเลิกเอกสาร กรุณาลองอีกครั้ง',
  'Expense changed before void. Reload and retry.': 'เอกสารถูกแก้ไขก่อนยกเลิก กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  'Void reason must be at least 3 characters': 'เหตุผลการยกเลิกต้องยาวอย่างน้อย 3 ตัวอักษร',
  'Paid amount must be between 0 and net payable amount.': 'ยอดจ่ายต้องอยู่ระหว่าง 0 ถึงยอดสุทธิที่ต้องจ่าย',
  // Document numbers (เลขที่เอกสาร)
  'Idempotency key already used with different document sequence parameters.':
    'คำขอเลขเอกสารซ้ำกับคำขอก่อนหน้าแต่ข้อมูลไม่ตรงกัน กรุณาลองใหม่อีกครั้ง',
  'Document sequence is disabled or missing.': 'เลขรันเอกสารประเภทนี้ถูกปิดใช้งานหรือยังไม่ได้ตั้งค่า',
  'Document number not found.': 'ไม่พบเลขที่เอกสาร',
  'Only RESERVED document numbers can be committed.': 'เลขที่เอกสารไม่อยู่ในสถานะจอง จึงยืนยันเลขไม่ได้ กรุณาลองใหม่อีกครั้ง',
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
  'Uploaded file exceeds size limit.': 'ไฟล์มีขนาดใหญ่เกินที่ระบบรองรับ กรุณาย่อขนาดหรือแยกไฟล์แล้วอัปโหลดใหม่',
  'Uploaded object was not found in storage.': 'อัปโหลดไฟล์ไม่สำเร็จ กรุณาเลือกไฟล์แล้วอัปโหลดใหม่อีกครั้ง',
  'Uploaded object size does not match attachment metadata.': 'ไฟล์ที่อัปโหลดไม่ตรงกับข้อมูลที่แจ้งไว้ กรุณาอัปโหลดใหม่',
  'Uploaded bytes do not match attachment metadata.': 'ไฟล์ที่อัปโหลดไม่ตรงกับข้อมูลที่แจ้งไว้ กรุณาอัปโหลดใหม่',
  'Uploaded object MIME type does not match attachment metadata.': UPLOAD_TYPE_MISMATCH,
  'Uploaded bytes have an unexpected MIME type.': UPLOAD_TYPE_MISMATCH,
  'File signature does not match the declared MIME type.': UPLOAD_TYPE_MISMATCH,
  'Upload URL has already been used.': 'ลิงก์อัปโหลดนี้ถูกใช้ไปแล้ว กรุณาเริ่มอัปโหลดใหม่',
  'Attachment upload was already completed or is no longer pending.': 'ไฟล์นี้อัปโหลดเสร็จแล้วหรือหมดอายุ กรุณาเริ่มอัปโหลดใหม่',
  'Attachment is not in PENDING_UPLOAD state.': 'ไฟล์นี้อัปโหลดเสร็จแล้วหรือหมดอายุ กรุณาเริ่มอัปโหลดใหม่',
  'Pending upload quota exceeded.': UPLOAD_QUOTA_EXCEEDED,
  'Pending upload quota exceeded. Complete or wait for existing upload intents to expire.': UPLOAD_QUOTA_EXCEEDED,
  // การอัปโหลดซ้ำด้วยไฟล์เดิมล้มเหมือนเดิมเสมอ ข้อความจึงห้ามชวนให้ลองใหม่ ต้องบอกให้เปลี่ยนไฟล์
  'Malware scan rejected the attachment.': UPLOAD_CONTENT_REJECTED,
  'Malware test signature detected.': UPLOAD_CONTENT_REJECTED,
  'Active content is not allowed in attachments.': UPLOAD_CONTENT_REJECTED,
  'Active PDF content is not allowed.':
    'ไฟล์ PDF นี้มีเนื้อหาที่รันโค้ดได้ ระบบจึงไม่รับ กรุณาสั่งพิมพ์เป็น PDF ใหม่ หรือถ่ายรูป/สแกนเป็นภาพแล้วอัปโหลดแทน',
  'PDF object count exceeds the parser safety limit.':
    'ไฟล์ PDF นี้ซับซ้อนเกินกว่าที่ระบบตรวจสอบได้ กรุณาแยกเป็นไฟล์ย่อย หรือสแกนเป็นภาพแล้วอัปโหลดแทน',
  'Raw substitute-receipt signatures are never available through generic attachment downloads.':
    'ไฟล์ลายเซ็นดาวน์โหลดแยกไม่ได้ ให้เปิดดูจากใบรับรองแทนใบเสร็จแทน',
};

/** Parameterized sentences (status names, period keys) rendered with their parameter kept visible. */
const MESSAGE_PATTERNS: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Category name already exists: /, () => 'มีหมวดหมู่ชื่อนี้แล้ว กรุณาใช้ชื่ออื่น'],
  [/^Tax branch code ".*" already exists in this company\.$/, () => 'รหัสสาขาภาษีนี้ถูกใช้ในบริษัทแล้ว กรุณาตรวจสอบสาขาเดิมหรือใช้รหัสอื่น'],
  [/^Branch code ".*" already exists in this company\.$/, () => 'รหัสสาขานี้ถูกใช้ในบริษัทแล้ว กรุณาใช้รหัสอื่น'],
  [/^Cannot confirm expense in status (\S+)\.$/,
    (m) => `ยืนยันลงบัญชีไม่ได้ในสถานะปัจจุบัน (${m[1]}) — ต้องตรวจเอกสารจนพร้อมยืนยันก่อน`],
  [/^Cannot prepare substitute evidence in status (\S+)\.$/,
    (m) => `จัดทำใบรับรองแทนใบเสร็จไม่ได้ในสถานะปัจจุบันของเอกสาร (${m[1]})`],
  // Plan 13.11.B: "ยังไม่แน่ใจ" saves as a draft but blocks confirmation, and the block names the line.
  [/^The VAT mode says VAT applies but line (\d+) has no VAT rate\./,
    (m) => `รายการที่ ${m[1]} ยังไม่ได้ระบุว่ามี VAT หรือไม่ กรุณาเลือกให้ครบทุกรายการก่อนยืนยัน`],
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
  400: 'ทำรายการต่อไม่ได้ กรุณาตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง',
  401: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  403: CODE_LABELS['insufficient_permissions']!,
  404: 'ไม่พบข้อมูลที่ต้องการ',
  409: 'รายการนี้ดำเนินการต่อไม่ได้ในสถานะปัจจุบัน กรุณาโหลดข้อมูลล่าสุดและตรวจสอบอีกครั้ง',
  // 413/429/503 มาจาก proxy หรือ rate limiter ซึ่งไม่ส่ง code มาด้วย เดิมจึงตกไปเป็น "API error 429"
  // ดิบ ๆ ทั้งที่เป็นสามสถานการณ์ที่ผู้ใช้ทำอะไรต่อได้ต่างกันชัดเจน
  413: 'ไฟล์หรือข้อมูลที่ส่งมีขนาดใหญ่เกินไป กรุณาลดขนาดแล้วลองใหม่',
  422: 'ทำรายการต่อไม่ได้ กรุณาตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง',
  429: 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
  500: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  502: 'เชื่อมต่อระบบไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้ง',
  503: 'บริการที่จำเป็นยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง หากยังพบปัญหาให้ติดต่อทีมงาน',
  504: 'ระบบตอบกลับช้าเกินกำหนด กรุณาลองใหม่อีกครั้ง',
};

const KIND_LABELS: Record<string, string> = {
  network: 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  network_error: 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  validation: STATUS_LABELS[400]!,
  unauthorized: STATUS_LABELS[401]!,
  forbidden: STATUS_LABELS[403]!,
  not_found: STATUS_LABELS[404]!,
  rate_limited: STATUS_LABELS[429]!,
  server_error: STATUS_LABELS[500]!,
};

const API_KINDS = new Set([...Object.keys(KIND_LABELS), 'unknown']);
const OTHER_CLIENT_ERROR = 'ทำรายการไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง';
const GENERIC_API_ERROR = 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง';

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
  } | null | undefined;
  const details = error?.details && typeof error.details === 'object'
    ? error.details as typeof error
    : undefined;
  const code = apiErrorCode(e);
  if (code === 'plan_branch_limit_exceeded') {
    const capacity = details?.details && typeof details.details === 'object'
      ? details.details as { limit?: unknown }
      : undefined;
    if (typeof capacity?.limit === 'number' && Number.isInteger(capacity.limit) && capacity.limit >= 1) {
      return `แพ็กเกจปัจจุบันรองรับ ${capacity.limit} สาขา และใช้งานครบแล้ว หากต้องการเพิ่มสาขา กรุณาเปลี่ยนแพ็กเกจ`;
    }
  }
  // A short, bounded wait is worth naming; a long one (a resend limit resets tomorrow) is not —
  // BILLING_RESEND_LIMIT's own text already says "ลองใหม่ได้พรุ่งนี้", so it never takes this branch.
  if (code === 'BILLING_RATE_LIMIT' || code === 'EMAIL_OTP_RATE_LIMITED') {
    const seconds = details?.retryAfterSeconds ?? error?.retryAfterSeconds;
    if (typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 1 && seconds <= 300) {
      return code === 'BILLING_RATE_LIMIT' ? `ทำรายการถี่เกินไป กรุณารอ ${seconds} วินาที แล้วลองรายการเดิมอีกครั้ง`
        : `${CODE_LABELS[code]} (ลองใหม่ได้ใน ${seconds} วินาที)`;
    }
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
  return e instanceof Error && e.message ? e.message : 'เกิดข้อผิดพลาด';
}
