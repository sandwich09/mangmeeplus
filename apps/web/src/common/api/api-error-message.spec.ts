import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { apiErrorMessage, translateApiError } from './api-error-message';

test('billing rate limit displays only the bounded wait and preserves a route to retry', () => {
  const error = (seconds: unknown) => Object.assign(new Error('internal diagnostic'), { status: 429, code: 'BILLING_RATE_LIMIT', details: { retryAfterSeconds: seconds } });
  assert.equal(apiErrorMessage(error(31)), 'ทำรายการถี่เกินไป กรุณารอ 31 วินาที แล้วลองรายการเดิมอีกครั้ง');
  for (const invalid of ['secret', 0, -1, 301, NaN, 1.5]) assert.equal(apiErrorMessage(error(invalid)), 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองรายการเดิมอีกครั้ง');
  assert.match(apiErrorMessage({ code: 'CONTROL_ACTION_NOT_SUPPORTED' }), /หน้ามั่งมี/);
});

const apiError = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);

test('explains document VAT acceptance without suggesting a bypass of Tax Code rules', () => {
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_VAT_TAX_TOLERANCE_REQUIRED' })), /เกินเกณฑ์ของ Tax Code/);
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_VAT_TAX_RATE_CONFLICT' })), /อัตรา VAT ของรายการไม่ตรง/);
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_VAT_OVERRIDE_INVALID' })), /ตรวจยอดต้นฉบับและอัตรา VAT/);
});

test('explains stale draft removal without a misleading generic concurrency error', () => {
  assert.equal(apiErrorMessage(apiError('Internal diagnostic', { status: 404, code: 'employee_draft_not_found' })),
    'ไม่พบพนักงานนี้แล้ว กรุณาโหลดรายชื่อพนักงานใหม่');
  assert.equal(apiErrorMessage(apiError('Internal diagnostic', { status: 409, code: 'employee_draft_not_deletable' })),
    'ลบได้เฉพาะร่างพนักงานที่ยังไม่เสร็จสิ้น กรุณาตรวจสอบสถานะล่าสุด');
});

test('explains source-draft validation, completion, and item races in plain Thai', () => {
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_SOURCE_DRAFT_INVALID' })), /ตรวจวันที่ จำนวน ราคา/);
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_SOURCE_DRAFT_INCOMPLETE' })), /ยังส่งตรวจหรือยืนยันไม่ได้/);
  assert.equal(apiErrorMessage(apiError('Internal diagnostic', { status: 400, code: 'EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED' })), 'ตรวจวันที่ในใบเสร็จที่ขั้นตรวจข้อมูล แล้วบันทึกก่อนส่งตรวจหรือยืนยันค่ะ');
  assert.match(apiErrorMessage(apiError('Conflict', { status: 409, code: 'expense_source_line_identity_changed' })), /เปิดรายการใหม่/);
  const purposeError = apiErrorMessage(apiError('Validation failed.', { statusCode: 400, code: 'EXPENSE_PURPOSE_TEXT_INVALID' }));
  assert.match(purposeError, /ซื้อไปใช้ทำอะไร/);
  assert.match(purposeError, /เว้นช่องนี้ไว้ได้/);
  assert.doesNotMatch(purposeError, /EXPENSE_|โหลด/);
});

test('distinguishes a wrong current password from an expired session', () => {
  assert.equal(apiErrorMessage(apiError('Current password is incorrect.', {
    status: 400, code: 'current_password_incorrect',
  })), 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  assert.equal(apiErrorMessage(apiError('No active session.', { status: 401 })),
    'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
});

test('explains missing and invalid transaction source branches in plain Thai', () => {
  assert.equal(apiErrorMessage(apiError('Unprocessable Entity', { status: 422, code: 'TRANSACTION_BRANCH_REQUIRED' })),
    'กรุณาระบุสาขาของรายการก่อนดำเนินการ');
  assert.equal(apiErrorMessage(apiError('Unprocessable Entity', { status: 422, code: 'TRANSACTION_BRANCH_INVALID' })),
    'ไม่พบสาขาที่ใช้งานได้ในบริษัทนี้ กรุณาเลือกสาขาอีกครั้ง');
});

test('explains only supplier source-number duplicates without relabeling unrelated conflicts', () => {
  const expected = 'เลขที่เอกสารผู้ขายนี้ถูกบันทึกสำหรับผู้ขายรายนี้แล้ว กรุณาตรวจสอบบิลเดิมก่อนสร้างซ้ำ';
  assert.equal(apiErrorMessage(apiError('duplicate_supplier_document_number', { status: 409 })), expected);
  assert.equal(apiErrorMessage(apiError('Conflict', { status: 409, code: 'duplicate_supplier_document_number' })), expected);
  assert.equal(apiErrorMessage(apiError(
    'Duplicate value: a record with the same unique field(s) already exists. Fields: companyId, supplierId, supplierDocumentNumber',
    { status: 409 },
  )), expected);
  assert.equal(apiErrorMessage(apiError('Conflict', { status: 409 })),
    'รายการนี้ดำเนินการต่อไม่ได้ในสถานะปัจจุบัน กรุณาโหลดข้อมูลล่าสุดและตรวจสอบอีกครั้ง');
  assert.equal(apiErrorMessage(apiError(
    'Duplicate value: a record with the same unique field(s) already exists. Fields: companyId, taxInvoiceNumber',
    { status: 409 },
  )), 'รายการนี้ดำเนินการต่อไม่ได้ในสถานะปัจจุบัน กรุณาโหลดข้อมูลล่าสุดและตรวจสอบอีกครั้ง');
});

test('translates a known API sentence to Thai', () => {
  assert.equal(
    apiErrorMessage(apiError('Expense requires a receipt attachment or a missing receipt reason.', { status: 400 })),
    'ต้องแนบไฟล์ใบเสร็จ หรือระบุเหตุผลที่ไม่มีใบเสร็จ ก่อนยืนยันลงบัญชี',
  );
});

test('explains duplicate category, branch validation, and quotation self-approval in context', () => {
  assert.equal(
    apiErrorMessage(apiError('Category name already exists: Travel', { status: 409 })),
    'มีหมวดหมู่ชื่อนี้แล้ว กรุณาใช้ชื่ออื่น',
  );
  assert.match(apiErrorMessage(apiError('Tax branch code must be 5 digits.', { status: 400 })), /ตัวเลข 5 หลัก/);
  assert.match(apiErrorMessage(apiError('Tax branch code "00001" already exists in this company.', { status: 409 })), /ถูกใช้ในบริษัทแล้ว/);
  assert.match(apiErrorMessage(apiError('Sales cannot approve their own quotation issue request', { status: 403 })), /ไม่สามารถอนุมัติใบเสนอราคาของตนเอง/);
});

test('prefers the error code over the message', () => {
  const message = apiErrorMessage(apiError('Signed substitute evidence locks expense lines.', {
    status: 409, code: 'substitute_evidence_locks_lines',
  }));
  assert.match(message, /^ใบรับรองแทนใบเสร็จที่ลงนามแล้วล็อกรายการไว้/);
});

test('matches a conflict code that carries its detail inline', () => {
  assert.equal(
    translateApiError('expense_confirmation_accounting_period_locked:2026-07'),
    'งวดบัญชีของเอกสารนี้ปิดแล้ว ต้องเปิดงวดก่อนจึงจะยืนยันได้',
  );
});

test('translates chart-template and posting-readiness failures', () => {
  assert.match(translateApiError('coa_preview_changed')!, /Preview/);
  assert.match(translateApiError('coa_semantic_conflict')!, /รหัสเดียวกัน/);
  assert.match(translateApiError('coa_posting_readiness_incomplete')!, /ยังไม่พร้อม/);
  assert.match(translateApiError('ledger_account_invalid_for_bank')!, /ธนาคาร/);
  assert.match(translateApiError('output_tax_code_line_mismatch')!, /Tax Code/);
  assert.match(translateApiError('posting_rule_missing')!, /ยังไม่มีกฎลงบัญชี/);
});

test('translates partial-payment validation and settlement-route failures', () => {
  assert.match(translateApiError('expense_payment_exceeds_outstanding')!, /ไม่เกินยอดคงเหลือ/);
  assert.match(translateApiError('expense_payment_changed')!, /โหลดรายการใหม่/);
  assert.match(translateApiError('expense_payment_idempotency_conflict')!, /ตรวจประวัติการจ่าย/);
  assert.match(translateApiError('expense_payment_invalid_date')!, /ปฏิทิน/);
  assert.match(translateApiError('expense_payment_invalid_key')!, /ตรวจประวัติการจ่าย/);
  assert.match(translateApiError('expense_payment_invalid_method')!, /เลือกวิธีจ่ายเงิน/);
  assert.match(translateApiError('expense_payment_invalid_reference')!, /128/);
  assert.match(translateApiError('claim_expense_settles_via_reimbursement')!, /ผ่านขั้นตอนจ่ายคืนของใบเบิก/);
});

test('fails closed to the status copy for every unknown API message', () => {
  assert.equal(apiErrorMessage(apiError('API error 403', { status: 403 })), 'คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อผู้ดูแลสิทธิ์ของบริษัท');
  assert.equal(
    apiErrorMessage(apiError('A sentence nobody mapped yet.', { status: 400 })),
    'ทำรายการต่อไม่ได้ กรุณาตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง',
  );
  assert.equal(apiErrorMessage(apiError('unknown conflict', { status: 409 })),
    'รายการนี้ดำเนินการต่อไม่ได้ในสถานะปัจจุบัน กรุณาโหลดข้อมูลล่าสุดและตรวจสอบอีกครั้ง');
  assert.equal(apiErrorMessage(apiError('unknown outage', { status: 503 })),
    'บริการที่จำเป็นยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง หากยังพบปัญหาให้ติดต่อทีมงาน');
});

test('hides the exact unknown-property validation diagnostic and retains no technical token', () => {
  const message = apiErrorMessage(apiError('property visibility should not exist', {
    status: 400,
    details: {
      statusCode: 400,
      message: ['property visibility should not exist'],
      error: 'Bad Request',
    },
  }));
  assert.equal(message, 'ทำรายการต่อไม่ได้ กรุณาตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง');
  assert.doesNotMatch(message, /visibility|property|should not exist|Bad Request|API error/i);
});

test('uses specific business guidance for confirmed system-wide gaps', () => {
  const cases = [
    ['duplicate_tax_id', /เลขประจำตัวผู้เสียภาษี.*ลูกค้ารายอื่น/],
    ['sale_price_invalid', /ราคาขาย.*ตั้งแต่ 0/],
    ['period_closed', /งวดบัญชี.*เปิดงวด/],
    ['transaction_tax_needs_review', /ตรวจภาษี/],
    ['NOTIFICATION_RETRY_REVIEW_REQUIRED', /ตรวจรายการเดิม/],
    ['BILLING_NOT_CONFIGURED', /ระบบรับชำระเงินยังไม่พร้อม/],
  ] as const;
  for (const [code, expected] of cases) {
    const message = apiErrorMessage(apiError('internal diagnostic', { status: 422, code }));
    assert.match(message, expected, code);
    assert.doesNotMatch(message, /internal|snake_case|หน้าจอไม่ตรง/);
  }
});

test('keeps common default-open feature errors specific while legacy APIs migrate to codes', () => {
  for (const [raw, expected] of [
    ['Customer is not active', /ลูกค้ารายนี้ไม่ได้ใช้งาน/],
    ['Invalid quiet hours format', /ช่วงเวลางดแจ้งเตือน/],
    ['Exactly one employee role is required.', /หนึ่งบทบาท/],
    ['taxId must be 13 digits', /13 หลัก/],
    ['Channel is disabled', /LINE.*ปิดใช้งาน/],
    ['Suggestion has expired', /หมดอายุ.*สร้างคำแนะนำใหม่/],
    ['Invalid idempotency key', /ข้อมูลอ้างอิงรายการ/],
  ] as const) {
    const message = apiErrorMessage(apiError(raw, { status: 422 }));
    assert.match(message, expected, raw);
  }
});

test('uses the validation fallback for a second unknown validation array from details', () => {
  const message = apiErrorMessage(apiError('internalFlag must be a boolean', {
    details: { statusCode: 422, message: ['internalFlag must be a boolean'] },
  }));
  assert.equal(message, 'ทำรายการต่อไม่ได้ กรุณาตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง');
  assert.doesNotMatch(message, /internalFlag|boolean/i);
});

test('supports statusCode and hides unknown 5xx diagnostics', () => {
  assert.equal(
    apiErrorMessage(apiError('permission implementation detail', { statusCode: 403 })),
    'คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อผู้ดูแลสิทธิ์ของบริษัท',
  );
  assert.equal(
    apiErrorMessage(apiError('Internal server error', { statusCode: 500 })),
    'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  );
});

test('maps boundary-tagged network errors without guessing from TypeError', () => {
  const expected = 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  assert.equal(apiErrorMessage(apiError('Network request failed.', { kind: 'network_error' })), expected);
  const arbitraryTypeError = apiErrorMessage(new TypeError('Cannot read properties of undefined'));
  assert.equal(arbitraryTypeError, 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
  assert.notEqual(arbitraryTypeError, expected);
  assert.doesNotMatch(arbitraryTypeError, /undefined|properties/i);
});

test('maps malformed successful responses to safe server copy', () => {
  assert.equal(
    apiErrorMessage(apiError('Invalid API response.', { kind: 'server_error', code: 'invalid_response' })),
    'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  );
});

test('keeps reviewed local non-API validation copy unchanged', () => {
  assert.equal(apiErrorMessage(new Error('กรุณาเลือกไฟล์ PNG หรือ JPEG')), 'กรุณาเลือกไฟล์ PNG หรือ JPEG');
});

test('unknown stable codes never reach the user as snake_case', () => {
  const message = apiErrorMessage(apiError('some_new_rule', { code: 'some_new_rule' }));
  assert.equal(message, 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
  assert.doesNotMatch(message, /some_new_rule/);
});

test('translates LINE signup recovery failures without exposing backend codes', () => {
  const cases: Record<string, RegExp> = {
    line_signup_resolution_required: /เลือกผลคำขอ LINE/,
    line_signup_existing_shop_proof_required: /สิทธิ์ LINE/,
    line_signup_repeat_trial_grant_required: /ทดลองใช้ฟรี/,
    line_signup_trial_grant_note_required: /เหตุผล/,
    line_signup_resolution_note_required: /ข้อมูลที่ต้องขอ/,
    line_signup_shared_contact_review_required: /ข้อมูลติดต่อร่วมกัน/,
    line_signup_submission_conflict: /คำขอ LINE เดิม/,
    line_signup_version_conflict: /โหลดรายการล่าสุด/,
    line_signup_contact_update_not_allowed: /แก้อีเมลติดต่อไม่ได้/,
    line_signup_retry_not_available: /โหลดสถานะล่าสุด/,
  };
  for (const [code, expected] of Object.entries(cases)) {
    const message = apiErrorMessage(apiError(code, { status: 409, code }));
    assert.match(message, expected, code);
    assert.doesNotMatch(message, /line_signup_/i, code);
  }
});

test('translates the document-number 409 family', () => {
  assert.equal(
    translateApiError('Only COMMITTED document numbers can be voided.'),
    'เลขที่เอกสารยังไม่ถูกยืนยัน จึงเพิกถอนเลขไม่ได้',
  );
});

test('renders parameterized sentences with the parameter kept visible', () => {
  assert.equal(
    translateApiError('Cannot confirm expense in status DRAFT.'),
    'ยืนยันลงบัญชีไม่ได้ในสถานะปัจจุบัน (DRAFT) — ต้องตรวจเอกสารจนพร้อมยืนยันก่อน',
  );
  assert.match(translateApiError('Accounting period 2026-07 is not open; reopen it before voiding.')!, /2026-07/);
  assert.match(translateApiError('PP30/2026-07 is locked; use an adjustment or amended filing workflow.')!, /PP30 2026-07/);
});

test('translates the substitute-receipt eligibility refusals', () => {
  const refusal = translateApiError(
    'A receipt or tax invoice is eligible only when it is unavailable or materially incomplete; a valid document must use the normal path.',
  );
  assert.ok(refusal);
  assert.match(refusal!, /ใบรับรองแทนใบเสร็จ/);

  for (const [code, expected] of [
    ['expense_status_ineligible', /ตรวจสถานะรายการ/],
    ['source_type_ineligible', /เลือกประเภทเอกสาร/],
    ['valid_receipt_normal_path', /ขั้นตอนปกติ/],
    ['classification_ineligible', /แนบหลักฐานค่าใช้จ่าย/],
    ['document_kind_ineligible', /ใช้จัดทำ.*ไม่ได้/],
    ['currency_not_supported', /เงินบาท \(THB\)/],
    ['reviewed_total_required', /ยืนยันยอดรวม/],
    ['reviewed_items_required', /รายละเอียดรายการค่าใช้จ่าย/],
    ['reviewed_category_required', /เลือกหมวดค่าใช้จ่ายหรือบัญชี/],
    ['tax_evidence_review_required', /ตรวจสถานะหลักฐานภาษี/],
    ['tax_evidence_nonclaimable', /ขอคืนภาษีซื้อไม่ได้/],
    ['LINE_RECEIPT_CONTINUATION_STALE', /เปิดรายการล่าสุด/],
    ['LINE_SUBSTITUTE_CONTINUATION_STALE', /เริ่มขั้นตอนนี้ใหม่/],
  ] as const) {
    assert.match(translateApiError(code)!, expected, code);
  }
});

test('maps substitute-receipt render limits to stable actionable Thai copy', () => {
  const lines = apiErrorMessage(apiError('layout rejected', {
    status: 400, code: 'substitute_receipt_too_many_lines',
  }));
  assert.match(lines, /สูงสุด 8 รายการ/);
  assert.match(lines, /แยก/);
  assert.match(translateApiError('substitute_receipt_line_description_too_long')!, /200 ตัวอักษร/);
  assert.match(translateApiError('substitute_receipt_too_many_evidence')!, /สูงสุด 8 ไฟล์/);
  assert.match(translateApiError('substitute_receipt_evidence_filename_too_long')!, /255 ตัวอักษร/);
});

test('unknown input passes through', () => {
  assert.equal(translateApiError('something_unmapped'), null);
  assert.equal(apiErrorMessage('not an error'), 'เกิดข้อผิดพลาด');
});

test('maps feature entitlement absence to its own Thai sentence', () => {
  assert.equal(translateApiError('feature_not_enabled'), 'ยังไม่ได้เปิดฟีเจอร์นี้');
  // A 403 body carrying the code must not fall through to the generic 403 permission text.
  assert.equal(
    apiErrorMessage(apiError('API error 403', { status: 403, code: 'feature_not_enabled' })),
    'ยังไม่ได้เปิดฟีเจอร์นี้',
  );
});

test('purchased-but-temporarily-unavailable is a DISTINCT sentence, never "ไม่ได้ซื้อ"', () => {
  const unavailable = translateApiError('feature_temporarily_unavailable');
  assert.equal(unavailable, 'ส่วนนี้ใช้งานชั่วคราวไม่ได้ ระบบกำลังเตรียมการ');
  assert.notEqual(unavailable, translateApiError('feature_not_enabled'));
  assert.doesNotMatch(unavailable!, /ไม่ได้ซื้อ/);
  assert.doesNotMatch(unavailable!, /ยังไม่ได้เปิด/);
  assert.equal(
    apiErrorMessage(apiError('API error 403', { status: 403, code: 'feature_temporarily_unavailable' })),
    'ส่วนนี้ใช้งานชั่วคราวไม่ได้ ระบบกำลังเตรียมการ',
  );
});

test('maps the bounded reimbursement upgrade refusal without telling users to re-enter data', () => {
  const message = apiErrorMessage(apiError('API error 503', {
    status: 503,
    code: 'reimbursement_upgrade_in_progress',
  }));
  assert.equal(
    message,
    'ระบบกำลังอัปเกรดส่วนเบิกค่าใช้จ่ายชั่วคราว ข้อมูลที่กรอกยังอยู่ กรุณารอประมาณ 1 นาทีแล้วลองอีกครั้ง',
  );
  assert.match(message, /ข้อมูลที่กรอกยังอยู่/);
  assert.doesNotMatch(message, /กรอกใหม่|ย้ายข้อมูล/);
});

test('maps a reimbursement edit/submit race to a reload-and-review instruction', () => {
  assert.equal(
    apiErrorMessage(apiError('Reimbursement draft changed.', {
      status: 409,
      code: 'reimbursement_draft_changed',
    })),
    'ใบเบิกถูกแก้ไขหรือส่งอนุมัติแล้ว กรุณาเปิดรายการใหม่ ตรวจสอบข้อมูล แล้วลองอีกครั้ง',
  );
});

test('maps an expense draft edit race to a reload-and-review instruction', () => {
  assert.equal(
    apiErrorMessage(apiError('Expense was changed by another user.', {
      status: 409,
      code: 'EXPENSE_UPDATE_CONFLICT',
    })),
    'รายการถูกแก้ไขโดยผู้ใช้อื่น กรุณาโหลดข้อมูลใหม่ ตรวจสอบ แล้วจึงบันทึกอีกครั้ง',
  );
});

test('maps an accounting document edit/issue race to a reload-and-review instruction', () => {
  assert.equal(
    apiErrorMessage(apiError('Document changed after it was loaded.', {
      status: 409,
      code: 'accounting_document_changed',
    })),
    'เอกสารถูกแก้ไขหรือเปลี่ยนสถานะโดยผู้ใช้อื่น กรุณาโหลดข้อมูลใหม่ ตรวจสอบ แล้วจึงทำรายการอีกครั้ง',
  );
});

test('maps a conflicting quotation conversion to the persisted-target instruction', () => {
  assert.equal(
    apiErrorMessage(apiError('Quotation already has a different converted document.', {
      status: 409,
      code: 'accounting_document_already_converted',
    })),
    'ใบเสนอราคานี้ถูกแปลงเป็นเอกสารอื่นแล้ว กรุณาโหลดใหม่และตรวจสอบเอกสารที่สร้างไว้',
  );
});

test('explains the receipt-first order before voiding a received payment', () => {
  assert.equal(
    apiErrorMessage(apiError('Void the active receipt before voiding its payment.', {
      status: 422,
      code: 'accounting_active_receipt_must_be_voided',
    })),
    'รายการนี้ออกใบเสร็จแล้ว กรุณายกเลิกใบเสร็จก่อน แล้วจึงยกเลิกการรับชำระ',
  );
  assert.equal(
    apiErrorMessage(apiError('Void the active receipt or tax invoice before voiding its source document.', {
      status: 422,
      code: 'accounting_active_child_document_must_be_voided',
    })),
    'รายการนี้มีใบเสร็จหรือใบกำกับภาษีที่ยังใช้งานอยู่ กรุณายกเลิกเอกสารลูกก่อน แล้วจึงยกเลิกรายการต้นทาง',
  );
  assert.equal(
    apiErrorMessage(apiError('Invoice already has an active receipt.', {
      status: 409,
      code: 'accounting_receipt_already_exists',
    })),
    'ใบแจ้งหนี้นี้มีใบเสร็จที่ยังใช้งานอยู่แล้ว กรุณาเปิดใบเสร็จเดิมแทนการสร้างซ้ำ',
  );
  assert.equal(
    apiErrorMessage(apiError('Source document already has an active tax invoice.', {
      status: 409,
      code: 'accounting_tax_invoice_already_exists',
    })),
    'เอกสารต้นทางนี้มีใบกำกับภาษีที่ยังใช้งานอยู่แล้ว กรุณาเปิดใบเดิมแทนการสร้างซ้ำ',
  );
});

test('explains a changed CRM quotation retry without exposing an internal command code', () => {
  assert.equal(
    apiErrorMessage(apiError('quotation_command_conflict', { status: 409, code: 'quotation_command_conflict' })),
    'คำสั่งนี้เคยใช้สร้างใบเสนอราคาด้วยรายละเอียดอื่นแล้ว กรุณาโหลดข้อมูลใหม่ก่อนลองอีกครั้ง',
  );
});

test('maps the entitlement command conflicts and cascade preview', () => {
  assert.match(translateApiError('entitlement_set_version_conflict')!, /เปิดใหม่/);
  assert.match(translateApiError('entitlement_command_conflict')!, /ข้อมูลอื่น/);
  assert.match(translateApiError('feature_cascade_confirmation_required')!, /ยืนยัน/);
  assert.match(translateApiError('platform_feature_not_disableable')!, /ปิดไม่ได้/);
  assert.match(translateApiError('expense_auto_post_not_enabled')!, /Auto-post/);
  assert.match(translateApiError('entitlement_feature_duplicate')!, /ฟีเจอร์ซ้ำ/);
  assert.match(translateApiError('entitlement_features_required')!, /อย่างน้อยหนึ่ง/);
});

test('maps bounded report export failures to friendly Thai', () => {
  assert.equal(
    translateApiError('export_too_large'),
    'รายงานมีข้อมูลเกิน 5,000 แถว กรุณาลดช่วงข้อมูลแล้วลองใหม่',
  );
  assert.match(translateApiError('export_source_changed')!, /ลองใหม่/);
  assert.match(translateApiError('export_result_incomplete')!, /ไม่ครบทุกแถว/);
  assert.match(translateApiError('report_export_expired')!, /หมดอายุ/);
  assert.match(translateApiError('report_export_unavailable')!, /ไม่พบไฟล์เดิม/);
  assert.match(translateApiError('report_export_integrity_failed')!, /ตรวจสอบไฟล์ไม่ผ่าน/);
  assert.match(translateApiError('report_entitlement_changed')!, /ยังไม่ได้บันทึก/);
  assert.match(translateApiError('report_artifact_authority_changed')!, /สิทธิ์ดูข้อมูล/);
});

test('maps AI needs-data and no-source safety refusals to actionable Thai', () => {
  assert.match(translateApiError('ai_suggestion_needs_data')!, /ข้อมูลไม่ครบ/);
  assert.match(translateApiError('ai_source_draft_unavailable')!, /ยังไม่มีร่าง/);
});

test('guides incomplete or stale evidence review back to the review action', () => {
  for (const code of ['EXPENSE_DOCUMENT_REVIEW_INCOMPLETE', 'EXPENSE_EVIDENCE_REVIEW_REQUIRED']) {
    const message = apiErrorMessage(apiError('Internal diagnostic', { status: 400, code }));
    assert.match(message, /บันทึกการตรวจ/);
    assert.doesNotMatch(message, /EXPENSE_|Internal diagnostic/);
  }
});


test('preserves only known quota messages and translates positive plan limits', () => {
  for (const message of [
    'แพ็กเกจปัจจุบันสร้างได้สูงสุด 1 สาขา — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ',
    'แพ็กเกจปัจจุบันเพิ่มพนักงานได้สูงสุด 2 คน — ติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ',
  ]) assert.equal(apiErrorMessage(apiError(message, { status: 422 })), message);
  assert.match(apiErrorMessage(apiError('branchLimit must be a whole number of at least 1.', { status: 422 })), /จำนวนสาขา.*1/);
  assert.doesNotMatch(apiErrorMessage(apiError('ข้อมูลภายใน database secret', { status: 422 })), /database|secret/);
});

test('uses the stable branch-capacity code and bounded package details', () => {
  assert.equal(apiErrorMessage(apiError('private diagnostic', {
    status: 422,
    code: 'plan_branch_limit_exceeded',
    details: { code: 'plan_branch_limit_exceeded', details: { limit: 2, active: 2 } },
  })), 'แพ็กเกจปัจจุบันรองรับ 2 สาขา และใช้งานครบแล้ว หากต้องการเพิ่มสาขา กรุณาเปลี่ยนแพ็กเกจ');
  assert.match(apiErrorMessage(apiError('private diagnostic', {
    status: 422,
    code: 'plan_branch_limit_exceeded',
  })), /รองรับจำนวนสาขาครบแล้ว/);
});


test('offer configuration bounds give specific Thai fields and preserve private diagnostics',()=>{
  assert.match(apiErrorMessage({code:'CONTROL_OFFER_PRICE_INVALID',message:'private provider debug'}),/ยอดรวมภาษี.*10.*999,999.99/);
  assert.match(apiErrorMessage({code:'CONTROL_OFFER_RECEIPTS_INVALID',message:'private quota debug'}),/จำนวนเต็ม.*รายปีคูณ 12/);
});


// Owner 2026-09-20 (spec R2): the same code answers a shop whose term ran out and a shop that
// never had a package, and the API cannot tell the client which — so the one sentence both read
// may not claim anything ended, and must name the move that actually unblocks them.
test('explains a locked shop without claiming a package ran out or data was lost', () => {
  const message = apiErrorMessage(apiError('Forbidden', { status: 403, code: 'company_term_expired' }));
  assert.equal(message, 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ เลือกแพ็กเกจเพื่อเริ่มใช้งาน ข้อมูลทั้งหมดยังอยู่ครบ');
  assert.doesNotMatch(message, /ครบกำหนด|company_term_expired/);
});
