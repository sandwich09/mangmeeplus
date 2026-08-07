// The API answers business-rule failures in English (its messages double as
// operator/log text). This is the single seam where those reach a Thai screen.
// Unknown text passes through untouched — a raw English sentence is still more
// useful to the user and to support than a generic "เกิดข้อผิดพลาด".

/** Stable error codes, including the `code:detail` conflicts (matched by prefix). */
const CODE_LABELS: Record<string, string> = {
  // Permissions / scope
  insufficient_permissions: 'คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อเจ้าของร้าน',
  // Feature entitlement vs launch availability — two DISTINCT states (spec:65, spec:335).
  // "not enabled" = the company has not turned the feature on.
  feature_not_enabled: 'ยังไม่ได้เปิดฟีเจอร์นี้',
  // "temporarily unavailable" = purchased and on, but its route is closed while the system
  // prepares. Never phrase this as "ไม่ได้ซื้อ" — the customer already owns it.
  feature_temporarily_unavailable: 'ส่วนนี้ใช้งานชั่วคราวไม่ได้ ระบบกำลังเตรียมการ',
  reimbursement_upgrade_in_progress:
    'ระบบกำลังอัปเกรดส่วนเบิกค่าใช้จ่ายชั่วคราว ข้อมูลที่กรอกยังอยู่ กรุณารอประมาณ 1 นาทีแล้วลองอีกครั้ง',
  reimbursement_draft_changed:
    'ใบเบิกถูกแก้ไขหรือส่งอนุมัติแล้ว กรุณาเปิดรายการใหม่ ตรวจสอบข้อมูล แล้วลองอีกครั้ง',
  expense_auto_post_not_enabled: 'ต้องเปิดระบบบัญชีแยกประเภทและ Auto-post ค่าใช้จ่ายก่อน',
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
  ledger_account_invalid_for_bank: 'บัญชีที่ผูกกับธนาคารต้องเป็นบัญชีของบริษัทที่ใช้งานและลงรายการได้',
  output_tax_code_line_mismatch: 'Tax Code ที่หัวเอกสารไม่ตรงกับรายการภาษี กรุณาตรวจ Tax Code ก่อนบันทึก',
  posting_rule_missing: 'ยังไม่มีกฎลงบัญชีที่ผ่านการตรวจสำหรับเอกสารนี้ จึงยังไม่สร้างรายการบัญชี',
  // Expense confirmation CAS guards — all mean "reload and try again"
  expense_confirmation_source_status_changed: 'เอกสารถูกเปลี่ยนสถานะระหว่างยืนยัน กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  expense_confirmation_source_version_changed: 'เอกสารถูกแก้ไขระหว่างยืนยัน กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  expense_confirmation_source_checksum_changed: 'ข้อมูลเอกสารเปลี่ยนไประหว่างยืนยัน กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  expense_confirmation_substitute_evidence_changed: 'ใบรับรองแทนใบเสร็จเปลี่ยนไประหว่างยืนยัน กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  expense_confirmation_tax_line_changed: 'รายการภาษีเปลี่ยนไประหว่างยืนยัน กรุณาตรวจ Tax Code แล้วลองอีกครั้ง',
  expense_confirmation_tax_evidence_changed: 'หลักฐานภาษีเปลี่ยนไประหว่างยืนยัน กรุณาตรวจสอบแล้วลองอีกครั้ง',
  expense_confirmation_accounting_period_locked: 'งวดบัญชีของเอกสารนี้ปิดแล้ว ต้องเปิดงวดก่อนจึงจะยืนยันได้',
  expense_confirmation_tax_period_locked: 'งวดภาษีของเอกสารนี้ยื่นหรือปิดแล้ว จึงยืนยันเข้างวดนี้ไม่ได้',
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
  expense_stale_reload: 'เอกสารถูกแก้ไขหลังการตรวจ กรุณาเปิดใหม่ก่อนจัดทำใบรับรองแทนใบเสร็จ',
  // Void-path CAS guards
  posting_state_changed: 'สถานะการลงบัญชีเปลี่ยนระหว่างยกเลิกเอกสาร กรุณาลองอีกครั้ง',
  expense_changed: 'เอกสารถูกแก้ไขก่อนยกเลิก กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  accounting_period_locked: 'งวดบัญชีของเอกสารนี้ปิดแล้ว ต้องเปิดงวดก่อนจึงจะยกเลิกได้',
  tax_period_locked: 'งวดภาษีของเอกสารนี้ถูกล็อกแล้ว ให้ใช้การปรับปรุงหรือยื่นแบบเพิ่มเติมแทน',
};

/** Full English messages the user can actually hit in the expense/substitute journeys. */
const MESSAGE_LABELS: Record<string, string> = {
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
  'At least one original or supporting evidence attachment is required.':
    'ต้องเลือกหลักฐานต้นทางหรือหลักฐานประกอบอย่างน้อย 1 ไฟล์',
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
};

/** Parameterized sentences (status names, period keys) rendered with their parameter kept visible. */
const MESSAGE_PATTERNS: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Cannot confirm expense in status (\S+)\.$/,
    (m) => `ยืนยันลงบัญชีไม่ได้ในสถานะปัจจุบัน (${m[1]}) — ต้องตรวจเอกสารจนพร้อมยืนยันก่อน`],
  [/^Cannot prepare substitute evidence in status (\S+)\.$/,
    (m) => `จัดทำใบรับรองแทนใบเสร็จไม่ได้ในสถานะปัจจุบันของเอกสาร (${m[1]})`],
  [/^Accounting period (\S+) is not open; reopen it before voiding\.$/,
    (m) => `งวดบัญชี ${m[1]} ปิดอยู่ ต้องเปิดงวดก่อนจึงจะยกเลิกเอกสารได้`],
  [/^(\S+)\/(\S+) is locked; use an adjustment or amended filing workflow\.$/,
    (m) => `งวดภาษี ${m[1]} ${m[2]} ถูกล็อกแล้ว ให้ใช้การปรับปรุงหรือยื่นแบบเพิ่มเติมแทน`],
];

/** Generic last resort, so an unmapped failure still reads as Thai. */
const STATUS_LABELS: Record<number, string> = {
  401: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  403: CODE_LABELS['insufficient_permissions']!,
  404: 'ไม่พบข้อมูลที่ต้องการ',
  409: 'ข้อมูลถูกเปลี่ยนแปลงระหว่างทำรายการ กรุณาเปิดใหม่แล้วลองอีกครั้ง',
  500: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
};

/** Translates one API message/code. Returns null when nothing is known about it. */
export function translateApiError(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (MESSAGE_LABELS[text]) return MESSAGE_LABELS[text];
  if (CODE_LABELS[text]) return CODE_LABELS[text];
  // Conflicts carry their detail inline, e.g. `..._accounting_period_locked:2026-07`.
  const prefix = Object.keys(CODE_LABELS).find((code) => text.startsWith(`${code}:`));
  if (prefix) return CODE_LABELS[prefix]!;
  for (const [pattern, render] of MESSAGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return render(match);
  }
  return null;
}

/** Message for a caught API error: Thai when known, the original text otherwise. */
export function apiErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return 'เกิดข้อผิดพลาด';
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'string') {
    const byCode = translateApiError(code);
    if (byCode) return byCode;
  }
  const byMessage = translateApiError(e.message);
  if (byMessage) return byMessage;
  const status = (e as { status?: unknown }).status;
  // Only fall back to the status text when the message is the client's own
  // `API error <status>` placeholder — a real server sentence tells more.
  if (typeof status === 'number' && /^API error \d+$/.test(e.message)) {
    return STATUS_LABELS[status] ?? e.message;
  }
  return e.message || 'เกิดข้อผิดพลาด';
}
