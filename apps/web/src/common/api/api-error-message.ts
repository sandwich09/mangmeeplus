import { SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS } from '@watchdog-bms/contracts';

// The API answers business-rule failures in English (its messages double as
// operator/log text). This is the single seam where those reach a Thai screen.
// Reviewed mappings stay specific; unknown API diagnostics fail closed to an
// actionable Thai fallback while UI-authored local errors keep their copy.

/** Stable error codes, including the `code:detail` conflicts (matched by prefix). */
const CODE_LABELS: Record<string, string> = {
  substitute_paid_expense_amount_locked: 'รายการนี้จ่ายเงินแล้ว หากต้องแก้ยอดให้ดำเนินการแก้ไขรายการจ่ายก่อน ข้อมูลเอกสารอื่นยังแก้และลงนามใหม่ได้',
  expense_receipt_removal_locked: 'นำใบเสร็จออกได้เฉพาะรายการฉบับร่างหรือรอตรวจสอบที่ยังไม่จ่ายเงินและยังไม่บันทึกบัญชี',
  invalid_response: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  duplicate_supplier_document_number: 'เลขที่เอกสารผู้ขายนี้ถูกบันทึกสำหรับผู้ขายรายนี้แล้ว กรุณาตรวจสอบบิลเดิมก่อนสร้างซ้ำ',
  // Permissions / scope
  insufficient_permissions: 'คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อเจ้าของร้าน',
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
  EXPENSE_SOURCE_DRAFT_INCOMPLETE: 'ยังส่งตรวจหรือยืนยันไม่ได้ กรุณาเติมข้อมูลบิลที่ยังขาดแล้วเก็บร่างก่อน',
  EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED: 'ตรวจวันที่ในใบเสร็จที่ขั้นตรวจข้อมูล แล้วบันทึกก่อนส่งตรวจหรือยืนยันค่ะ',
  EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED: 'ข้อมูลใบเสร็จเปลี่ยนไปแล้ว กรุณาโหลดรายการใหม่ก่อนบันทึก',
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
  substitute_facts_incomplete: 'ข้อมูลใบแทนยังไม่ครบ เลือกแก้ไขข้อมูลใบแทนเพื่อระบุผู้รับเงิน เหตุผล วัตถุประสงค์ และวันที่หรือวิธีจ่ายก่อนลงนาม ไม่ต้องยกเลิกเอกสาร',
  substitute_full_payment_required: 'รองรับเฉพาะบริษัทจ่ายเต็มจำนวนหรือพนักงานสำรองจ่ายเต็มจำนวน กรุณาตรวจข้อมูลและยืนยันการจ่ายให้ครบก่อนดำเนินการต่อ',
  substitute_existing_payment_details_mismatch: 'วันที่หรือวิธีจ่ายในใบรับรองไม่ตรงกับการจ่ายที่บันทึกไว้ กรุณาตรวจประวัติการจ่ายและแก้ข้อมูลให้ตรงกัน',
  substitute_personal_settles_via_reimbursement: 'ใบรับรองนี้ระบุว่าพนักงานจ่ายร้านแล้ว กรุณาดำเนินการคืนเงินให้พนักงานแยกตามขั้นตอนการเงิน',
  substitute_source_has_live_claim: 'หลักฐานนี้เชื่อมกับคำขอเบิกที่ยังดำเนินการอยู่ กรุณาเปิดและดำเนินการผ่านคำขอเบิกเดิม',
  substitute_correction_company_identity_changed: 'เลขผู้เสียภาษีของบริษัทเปลี่ยนจากใบรับรองเดิม กรุณาให้ผู้ดูแลหรือฝ่ายบัญชีตรวจสอบข้อมูลบริษัทก่อนจัดทำฉบับแก้ไข',
  substitute_correction_financial_fields_locked: 'ฉบับแก้ไขนี้เปลี่ยนข้อมูลการเงินหรือหลักฐานเดิมไม่ได้ กรุณาคงข้อมูลเดิมและแก้เฉพาะชื่อบริษัทหรือข้อมูลผู้ลงนามที่ต้องการ',
  substitute_correction_source_changed: 'ใบรับรองต้นทางหรือรายการค่าใช้จ่ายเปลี่ยนสถานะแล้ว กรุณาเปิดรายการล่าสุดและตรวจสอบก่อนจัดทำฉบับแก้ไข',
  substitute_snapshot_integrity_mismatch: 'ข้อมูลใบรับรองไม่ตรงกับข้อมูลที่บันทึกไว้ กรุณาแจ้งผู้ดูแลระบบให้ตรวจสอบก่อนดำเนินการต่อ',
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
  reimbursement_correction_has_payment: 'คำขอนี้มีการจ่ายเงินแล้ว ต้องยกเลิกการจ่ายก่อนส่งกลับแก้ไข',
  reimbursement_correction_has_projection: 'คำขอนี้สร้างรายการค่าใช้จ่ายแล้ว กรุณายกเลิกคำขอและบันทึกใหม่',
  invalid_finance_decision: 'ผลการตรวจสอบของฝ่ายการเงินไม่ถูกต้อง กรุณาเลือกใหม่',
  duplicate_resolution_reason_required: 'กรุณาระบุเหตุผลที่ยืนยันว่าไม่ใช่รายการซ้ำ',

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
  reimbursement_document_number_unavailable: 'ขอเลขที่เอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
  void_reason_required: 'กรุณาระบุเหตุผลการยกเลิกการจ่ายเงิน',
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
  current_password_incorrect: 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
  company_access_unavailable: 'คุณไม่มีสิทธิ์เข้าใช้บริษัทนี้แล้ว กรุณาติดต่อเจ้าของร้าน',
  // P29: the term ended, so business routes are refused on access. Data is intact — the copy must
  // not read as data loss, and the only move that helps is renewing, not retrying.
  company_term_expired: 'ร้านนี้ครบกำหนดใช้งานแล้ว ข้อมูลทั้งหมดยังอยู่ครบ ติดต่อ 098-256-5628 เพื่อใช้งานต่อ',

  // ---- P10-L §8 admin support tools (system console; the reader is an operator, not a shop) ----
  // SEC-05: each says what to change, because the operator has the message in front of them.
  partner_line_message_empty: 'ยังไม่ได้พิมพ์ข้อความ',
  partner_line_message_too_long: 'ข้อความยาวเกิน 500 ตัวอักษร กรุณาย่อให้สั้นลง',
  partner_line_message_external_link: 'ใส่ลิงก์ได้เฉพาะเว็บของเราและ LIFF เท่านั้น กรุณาลบลิงก์ภายนอกออก',
  line_messaging_channel_not_configured: 'ยังไม่ได้ตั้งค่าช่องทาง LINE ของระบบ จึงส่งข้อความไม่ได้',
  package_change_request_not_found: 'ไม่พบคำขอเปลี่ยนแพ็กเกจนี้ อาจถูกดำเนินการไปแล้ว กรุณาโหลดหน้าใหม่',
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
  // spec §15.4.1 C: EMAIL_PROVIDER=disabled — the request is refused before a token exists,
  // rather than answering 202 over a letter that was never sent.
  email_delivery_unavailable: 'ตอนนี้ระบบยังส่งอีเมลยืนยันไม่ได้ค่ะ ติดต่อทีมงาน โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com',

  // ---- ตั้งค่าบริษัทและ VAT ----
  // จนถึง L-E ข้อความนี้ชี้ไปหน้าที่ยังไม่มีอยู่จริง ตอนนี้มีแล้วจึงเรียกชื่อเมนูตรง ๆ
  company_tax_identity_incomplete: 'ข้อมูลผู้เสียภาษีของบริษัทยังไม่ครบ กรุณากรอกให้ครบที่ ตั้งค่า › ข้อมูลร้านและบัญชีของฉัน ก่อน',
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
];

/** Generic last resort, so an unmapped failure still reads as Thai. */
const STATUS_LABELS: Record<number, string> = {
  400: 'ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  401: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  403: CODE_LABELS['insufficient_permissions']!,
  404: 'ไม่พบข้อมูลที่ต้องการ',
  409: 'ข้อมูลถูกเปลี่ยนแปลงระหว่างทำรายการ กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  // 413/429/503 มาจาก proxy หรือ rate limiter ซึ่งไม่ส่ง code มาด้วย เดิมจึงตกไปเป็น "API error 429"
  // ดิบ ๆ ทั้งที่เป็นสามสถานการณ์ที่ผู้ใช้ทำอะไรต่อได้ต่างกันชัดเจน
  413: 'ไฟล์หรือข้อมูลที่ส่งมีขนาดใหญ่เกินไป กรุณาลดขนาดแล้วลองใหม่',
  422: 'ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  429: 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
  500: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  502: 'เชื่อมต่อระบบไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้ง',
  503: 'ระบบกำลังปรับปรุงหรือมีผู้ใช้งานหนาแน่น กรุณารอสักครู่แล้วลองใหม่',
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
  } | null | undefined;
  const details = error?.details && typeof error.details === 'object'
    ? error.details as typeof error
    : undefined;
  const code = apiErrorCode(e);
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
