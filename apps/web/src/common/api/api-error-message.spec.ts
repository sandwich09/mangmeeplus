import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { apiErrorMessage, translateApiError } from './api-error-message';
import { WHT_CERTIFICATE_CORRECTION_WORDS } from '@watchdog-bms/contracts';

test('FIX-R2 role-in-use conflicts explain reassignment instead of reporting duplicate data', () => {
  assert.equal(apiErrorMessage({ status: 409, message: 'Role is still assigned to active employees. Reassign before disabling.' }),
    'บทบาทนี้ยังมีพนักงานใช้อยู่ ย้ายพนักงานไปบทบาทอื่นก่อนปิดใช้งาน');
});

test('certificate commands keep the server Thai refusal before the code fallback', () => {
  for (const code of ['expense_changed', 'expense_changed_retry', 'expense_correction_permission_missing', 'expense_void_reason_required', 'expense_correction_blocked', 'expense_payment_correction_blocked', 'expense_wht_source_changed', 'certificate_permission_missing', 'certificate_issued', 'posting_unresolved', 'accounting_period_locked', 'tax_period_locked', 'tax_period_filed', 'expense_certificate_attestation_required', 'reimbursement_cancellation_certificate_permission_missing', 'reimbursement_cancellation_tax_period_locked', 'reimbursement_cancellation_accounting_period_locked', 'wht_certificate_not_correctable', 'wht_certificate_correction_tax_period_locked', 'wht_certificate_issue_in_progress', 'wht_handoff_not_issuable', 'wht_certificate_number_duplicate']) {
    const message = 'ยังทำรายการนี้ไม่ได้ กรุณาเปิดหน้านี้ใหม่เพื่อตรวจสอบข้อมูลล่าสุด';
    for (const nested of [false, true]) assert.equal(apiErrorMessage(nested ? { code, details: { code, message } } : { code, message }), message, code);
    assert.equal(apiErrorMessage({ code, message: 'Internal diagnostic' }), apiErrorMessage({ code }), code);
  }
  assert.equal(apiErrorMessage({ code: 'expense_changed' }), 'เอกสารถูกแก้ไขก่อนยกเลิก เปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
  assert.equal(translateApiError('wht_certificate_number_duplicate'), WHT_CERTIFICATE_CORRECTION_WORDS.numberDuplicate);
  assert.doesNotMatch(apiErrorMessage({ code: 'expense_unknown_diagnostic', message: 'เกิดข้อผิดพลาด REQUEST_ID_PRIVATE_123' }), /REQUEST_ID_PRIVATE_123/);
});

test('confirmed duplicate payment refusals say why and give the state-appropriate way out', () => {
  for (const nested of [false, true]) {
    const facts = { code: 'duplicate_confirmed', claimStatus: 'READY_FOR_PAYMENT', canCancel: true };
    const message = apiErrorMessage(nested ? { status: 422, details: facts } : facts);
    assert.match(message, /ใบเสร็จของใบเบิกนี้ได้รับการยืนยันว่าซ้ำ/);
    assert.match(message, /กดยกเลิกคำขอในหน้าใบเบิก/);
    assert.match(message, /ผู้เบิกส่งใบเบิกใหม่โดยไม่ใส่รายการซ้ำ/);
    assert.doesNotMatch(message, /ปลดรายการซ้ำ|อนุมัติจ่าย|[a-zA-Z_]/);
  }
  const partial = apiErrorMessage({ code: 'duplicate_confirmed', details: { claimStatus: 'PARTIALLY_PAID', canVoidPayment: false } });
  assert.match(partial, /ผู้มีสิทธิ์ยกเลิกการจ่ายของสาขานี้/);
  assert.doesNotMatch(partial, /กดยกเลิกคำขอ/);
  assert.match(translateApiError('duplicate_confirmed')!, /ไม่ใส่รายการซ้ำ/);
});

test('the payment-reference code asks for a cheque number or evidence', () => {
  assert.equal(translateApiError('payment_reference_required'), 'กรอกเลขที่เช็คหรือแนบหลักฐานการจ่าย');
  assert.equal(apiErrorMessage({ code: 'payment_reference_required' }), 'กรอกเลขที่เช็คหรือแนบหลักฐานการจ่าย');
});

test('the future-payment-date code displays the shared Thai refusal', () => {
  assert.equal(translateApiError('payment_date_in_future'), 'วันที่จ่ายเงินจริงต้องไม่เกินวันนี้');
  assert.equal(apiErrorMessage({ code: 'payment_date_in_future' }), 'วันที่จ่ายเงินจริงต้องไม่เกินวันนี้');
});

test('billing rate limit displays only the bounded wait and preserves a route to retry', () => {
  const error = (seconds: unknown) => Object.assign(new Error('internal diagnostic'), { status: 429, code: 'BILLING_RATE_LIMIT', details: { retryAfterSeconds: seconds } });
  assert.equal(apiErrorMessage(error(31)), 'ทำรายการถี่เกินไป รอ 31 วินาที แล้วลองรายการเดิมอีกครั้ง');
  for (const invalid of ['secret', 0, -1, 301, NaN, 1.5]) assert.equal(apiErrorMessage(error(invalid)), 'ทำรายการถี่เกินไป รอสักครู่แล้วลองรายการเดิมอีกครั้ง');
  assert.match(apiErrorMessage({ code: 'CONTROL_ACTION_NOT_SUPPORTED' }), /หน้ามั่งมี/);
});

test('resend and recipient-code limits keep their own sentence and add only a short wait', () => {
  const error = (code: string, seconds: unknown) => Object.assign(new Error('internal diagnostic'), { status: 429, code, details: { code, retryAfterSeconds: seconds } });
  assert.equal(apiErrorMessage(error('EMAIL_OTP_RATE_LIMITED', 60)), 'ขอรหัสหรือกรอกรหัสผิดบ่อยเกินไป รอก่อนแล้วลองอีกครั้ง (ลองใหม่ได้ใน 60 วินาที)');
  assert.equal(apiErrorMessage(error('BILLING_RESEND_LIMIT', 3600)), 'ส่งเอกสารใบนี้ซ้ำครบจำนวนแล้ว รอแล้วลองอีกครั้งหรือเปิดเอกสารจากประวัติแทน');
  assert.doesNotMatch(apiErrorMessage(error('BILLING_RESEND_LIMIT', 'soon')), /วินาที/);
  // item 12: a seconds count in the "worth naming" range (1-300) must still never grow the
  // "(ลองใหม่ได้ใน N วินาที)" suffix onto BILLING_RESEND_LIMIT — the resend limit keeps its own document-opening guidance.
  assert.equal(apiErrorMessage(error('BILLING_RESEND_LIMIT', 60)), 'ส่งเอกสารใบนี้ซ้ำครบจำนวนแล้ว รอแล้วลองอีกครั้งหรือเปิดเอกสารจากประวัติแทน');
});

const apiError = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);

test('explains document VAT acceptance without suggesting a bypass of Tax Code rules', () => {
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_VAT_TAX_TOLERANCE_REQUIRED' })), /เกินเกณฑ์ของรหัสภาษี/);
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_VAT_TAX_RATE_CONFLICT' })), /อัตรา VAT ของรายการไม่ตรง/);
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_VAT_OVERRIDE_INVALID' })), /ตรวจยอดต้นฉบับและอัตรา VAT/);
});

test('explains stale draft removal without a misleading generic concurrency error', () => {
  assert.equal(apiErrorMessage(apiError('Internal diagnostic', { status: 404, code: 'employee_draft_not_found' })),
    'ไม่พบพนักงานนี้แล้ว เปิดหน้ารายชื่อพนักงานใหม่');
  assert.equal(apiErrorMessage(apiError('Internal diagnostic', { status: 409, code: 'employee_draft_not_deletable' })),
    'ลบได้เฉพาะร่างพนักงานที่ยังไม่เสร็จ ตรวจสถานะล่าสุดอีกครั้ง');
});

test('explains source-draft validation, completion, and item races in plain Thai', () => {
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_SOURCE_DRAFT_INVALID' })), /ตรวจวันที่ จำนวน ราคา/);
  assert.match(apiErrorMessage(apiError('Bad Request', { status: 400, code: 'EXPENSE_SOURCE_DRAFT_INCOMPLETE' })), /ยังส่งให้ตรวจหรือยืนยันไม่ได้/);
  assert.equal(apiErrorMessage(apiError('Internal diagnostic', { status: 400, code: 'EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED' })), 'ตรวจวันที่ในใบเสร็จที่ขั้นตรวจข้อมูล แล้วบันทึกก่อนส่งให้ตรวจหรือยืนยัน');
  assert.match(apiErrorMessage(apiError('Conflict', { status: 409, code: 'expense_source_line_identity_changed' })), /เปิดหน้านี้ใหม่/);
  const purposeError = apiErrorMessage(apiError('Validation failed.', { statusCode: 400, code: 'EXPENSE_PURPOSE_TEXT_INVALID' }));
  assert.match(purposeError, /ซื้อไปใช้ทำอะไร/);
  assert.match(purposeError, /เว้นช่องนี้ไว้ได้/);
  assert.doesNotMatch(purposeError, /EXPENSE_|โหลด/);
});

test('distinguishes a wrong current password from an expired session', () => {
  assert.equal(apiErrorMessage(apiError('Current password is required for this password change.', {
    status: 400, code: 'current_password_required',
  })), 'กรอกรหัสผ่านปัจจุบันก่อนเปลี่ยนรหัสผ่าน');
  assert.equal(apiErrorMessage(apiError('Current password is incorrect.', {
    status: 400, code: 'current_password_incorrect',
  })), 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  assert.equal(apiErrorMessage(apiError('No active session.', { status: 401 })),
    'การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบใหม่');
});

test('explains missing and invalid transaction source branches in plain Thai', () => {
  assert.equal(apiErrorMessage(apiError('Unprocessable Entity', { status: 422, code: 'TRANSACTION_BRANCH_REQUIRED' })),
    'เลือกสาขาของรายการก่อน');
  assert.equal(apiErrorMessage(apiError('Unprocessable Entity', { status: 422, code: 'TRANSACTION_BRANCH_INVALID' })),
    'ไม่พบสาขาที่ใช้งานได้ในร้านนี้ เลือกสาขาอีกครั้ง');
});

test('explains only supplier source-number duplicates without relabeling unrelated conflicts', () => {
  const expected = 'เลขที่เอกสารผู้ขายนี้ถูกบันทึกสำหรับผู้ขายรายนี้แล้ว ตรวจสอบบิลเดิมก่อนสร้างซ้ำ';
  assert.equal(apiErrorMessage(apiError('duplicate_supplier_document_number', { status: 409 })), expected);
  assert.equal(apiErrorMessage(apiError('Conflict', { status: 409, code: 'duplicate_supplier_document_number' })), expected);
  assert.equal(apiErrorMessage(apiError(
    'Duplicate value: a record with the same unique field(s) already exists. Fields: companyId, supplierId, supplierDocumentNumber',
    { status: 409 },
  )), expected);
  assert.equal(apiErrorMessage(apiError('Conflict', { status: 409 })),
    'รายการนี้ทำต่อไม่ได้ในสถานะปัจจุบัน เปิดหน้านี้ใหม่แล้วตรวจอีกครั้ง');
  assert.equal(apiErrorMessage(apiError(
    'Duplicate value: a record with the same unique field(s) already exists. Fields: companyId, taxInvoiceNumber',
    { status: 409 },
  )), 'รายการนี้ทำต่อไม่ได้ในสถานะปัจจุบัน เปิดหน้านี้ใหม่แล้วตรวจอีกครั้ง');
});

test('translates a known API sentence to Thai', () => {
  assert.equal(
    apiErrorMessage(apiError('Expense requires a receipt attachment or a missing receipt reason.', { status: 400 })),
    'ต้องแนบไฟล์ใบเสร็จ หรือระบุเหตุผลที่ไม่มีใบเสร็จ ก่อนยืนยันเอกสาร',
  );
});

test('explains duplicate category, branch validation, and quotation self-approval in context', () => {
  assert.equal(
    apiErrorMessage(apiError('Category name already exists: Travel', { status: 409 })),
    'มีหมวดหมู่ชื่อนี้แล้ว ใช้ชื่ออื่น',
  );
  assert.match(apiErrorMessage(apiError('Tax branch code must be 5 digits.', { status: 400 })), /ตัวเลข 5 หลัก/);
  assert.match(apiErrorMessage(apiError('Tax branch code "00001" already exists in this company.', { status: 409 })), /ถูกใช้ในร้านแล้ว/);
  assert.match(apiErrorMessage(apiError('Sales cannot approve their own quotation issue request', { status: 403 })), /ไม่สามารถอนุมัติใบเสนอราคาของตนเอง/);
});

test('prefers the error code over the message', () => {
  const message = apiErrorMessage(apiError('Signed substitute evidence locks expense lines.', {
    status: 409, code: 'substitute_evidence_locks_lines',
  }));
  assert.match(message, /^ใบรับรองแทนใบเสร็จที่เซ็นแล้วล็อกรายการไว้/);
});

test('matches a conflict code that carries its detail inline', () => {
  assert.equal(
    translateApiError('expense_confirmation_accounting_period_locked:2026-07'),
    'งวดบัญชีของเอกสารนี้ปิดแล้ว ต้องเปิดงวดก่อนจึงจะยืนยันได้',
  );
});

test('a claim payment dated in a closed period tells the payer what to do, whatever the month', () => {
  const label = 'วันที่จ่ายอยู่ในงวดบัญชีที่ปิดแล้ว จึงบันทึกการจ่ายไม่ได้ ตรวจวันที่จ่ายอีกครั้ง หากจ่ายในวันนั้นจริง ให้ผู้มีสิทธิ์เปิดงวดบัญชีก่อนแล้วจึงบันทึกใหม่';
  assert.equal(translateApiError('reimbursement_payment_accounting_period_locked:2026-08'), label);
  // As the API answers it: a 409 whose message is the code with the month attached.
  assert.equal(apiErrorMessage(apiError('reimbursement_payment_accounting_period_locked:2026-08', { status: 409 })), label);
  assert.doesNotMatch(label, /[A-Za-z_]|\d{4}-\d{2}/, 'no code and no period key reaches the payer');
});

test('translates chart-template and posting-readiness failures', () => {
  assert.match(translateApiError('coa_preview_changed')!, /Preview/);
  assert.match(translateApiError('coa_semantic_conflict')!, /รหัสเดียวกัน/);
  assert.match(translateApiError('coa_posting_readiness_incomplete')!, /ยังไม่พร้อม/);
  assert.match(translateApiError('ledger_account_invalid_for_bank')!, /ธนาคาร/);
  assert.match(translateApiError('output_tax_code_line_mismatch')!, /รหัสภาษี/);
  assert.match(translateApiError('posting_rule_missing')!, /ยังไม่มีกฎลงบัญชี/);
});

test('translates partial-payment validation and settlement-route failures', () => {
  assert.match(translateApiError('expense_payment_exceeds_outstanding')!, /ไม่เกินยอดคงเหลือ/);
  assert.match(translateApiError('expense_payment_changed')!, /เปิดหน้านี้ใหม่/);
  assert.match(translateApiError('expense_payment_idempotency_conflict')!, /ตรวจประวัติการจ่าย/);
  assert.match(translateApiError('expense_payment_invalid_date')!, /ปฏิทิน/);
  assert.match(translateApiError('expense_payment_invalid_key')!, /ตรวจประวัติการจ่าย/);
  assert.match(translateApiError('expense_payment_invalid_method')!, /เลือกวิธีจ่ายเงิน/);
  assert.match(translateApiError('expense_payment_invalid_reference')!, /128/);
  assert.match(translateApiError('claim_expense_settles_via_reimbursement')!, /ผ่านขั้นตอนจ่ายคืนของใบเบิก/);
});

test('fails closed to the status copy for every unknown API message', () => {
  assert.equal(apiErrorMessage(apiError('API error 403', { status: 403 })), 'คุณไม่มีสิทธิ์ทำรายการนี้ ขอสิทธิ์จากเจ้าของกิจการหรือผู้ดูแลสิทธิ์');
  assert.equal(
    apiErrorMessage(apiError('A sentence nobody mapped yet.', { status: 400 })),
    'ทำรายการต่อไม่ได้ ตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง',
  );
  assert.equal(apiErrorMessage(apiError('unknown conflict', { status: 409 })),
    'รายการนี้ทำต่อไม่ได้ในสถานะปัจจุบัน เปิดหน้านี้ใหม่แล้วตรวจอีกครั้ง');
  assert.equal(apiErrorMessage(apiError('unknown outage', { status: 503 })),
    'บริการที่จำเป็นยังไม่พร้อมใช้งาน ลองอีกครั้งภายหลัง ถ้ายังไม่ได้ ให้ติดต่อทีมงาน');
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
  assert.equal(message, 'ทำรายการต่อไม่ได้ ตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง');
  assert.doesNotMatch(message, /visibility|property|should not exist|Bad Request|API error/i);
});

test('uses specific business guidance for confirmed system-wide gaps', () => {
  const cases = [
    ['duplicate_tax_id', /เลขประจำตัวผู้เสียภาษี.*ลูกค้ารายอื่น/],
    ['sale_price_invalid', /ราคาขาย.*ตั้งแต่ 0/],
    ['period_closed', /งวดบัญชี.*เปิดงวด/],
    ['transaction_tax_needs_review', /ตรวจภาษี/],
    ['NOTIFICATION_RETRY_REVIEW_REQUIRED', /ตรวจรายการเดิม/],
    ['BILLING_NOT_CONFIGURED', /ระบบรับเงินยังไม่พร้อม/],
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
  assert.equal(message, 'ทำรายการต่อไม่ได้ ตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง');
  assert.doesNotMatch(message, /internalFlag|boolean/i);
});

test('supports statusCode and hides unknown 5xx diagnostics', () => {
  assert.equal(
    apiErrorMessage(apiError('permission implementation detail', { statusCode: 403 })),
    'คุณไม่มีสิทธิ์ทำรายการนี้ ขอสิทธิ์จากเจ้าของกิจการหรือผู้ดูแลสิทธิ์',
  );
  assert.equal(
    apiErrorMessage(apiError('Internal server error', { statusCode: 500 })),
    'ระบบขัดข้องชั่วคราว ลองอีกครั้ง',
  );
});

test('maps boundary-tagged network errors without guessing from TypeError', () => {
  const expected = 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
  assert.equal(apiErrorMessage(apiError('Network request failed.', { kind: 'network_error' })), expected);
  const arbitraryTypeError = apiErrorMessage(new TypeError('Cannot read properties of undefined'));
  assert.equal(arbitraryTypeError, 'ทำรายการไม่สำเร็จ ลองอีกครั้ง');
  assert.notEqual(arbitraryTypeError, expected);
  assert.doesNotMatch(arbitraryTypeError, /undefined|properties/i);
});

test('maps malformed successful responses to safe server copy', () => {
  assert.equal(
    apiErrorMessage(apiError('Invalid API response.', { kind: 'server_error', code: 'invalid_response' })),
    'ระบบขัดข้องชั่วคราว ลองอีกครั้ง',
  );
});

test('keeps reviewed local non-API validation copy unchanged', () => {
  assert.equal(apiErrorMessage(new Error('กรุณาเลือกไฟล์ PNG หรือ JPEG')), 'กรุณาเลือกไฟล์ PNG หรือ JPEG');
});

test('unknown stable codes never reach the user as snake_case', () => {
  const message = apiErrorMessage(apiError('some_new_rule', { code: 'some_new_rule' }));
  assert.equal(message, 'ทำรายการไม่สำเร็จ ลองอีกครั้ง');
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

test('keeps human period references while hiding expense status enums', () => {
  assert.equal(
    translateApiError('Cannot confirm expense in status DRAFT.'),
    'ยืนยันค่าใช้จ่ายไม่ได้ในสถานะปัจจุบัน เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด',
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
    ['currency_not_supported', /เงินบาท/],
    ['reviewed_total_required', /ยืนยันยอดรวม/],
    ['reviewed_items_required', /รายละเอียดรายการค่าใช้จ่าย/],
    ['reviewed_category_required', /เลือกหมวดค่าใช้จ่ายหรือบัญชี/],
    ['tax_evidence_review_required', /ใช้เป็นหลักฐานรายจ่ายได้ไหม/],
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
  assert.equal(apiErrorMessage('not an error'), 'ทำรายการไม่สำเร็จ ลองอีกครั้ง');
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
    'ระบบกำลังอัปเกรดส่วนเบิกค่าใช้จ่ายชั่วคราว ข้อมูลที่กรอกยังอยู่ รอประมาณ 1 นาทีแล้วลองอีกครั้ง',
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
    'ใบเบิกถูกแก้ไขหรือส่งอนุมัติแล้ว เปิดหน้านี้ใหม่ ตรวจข้อมูล แล้วลองอีกครั้ง',
  );
});

test('maps an expense draft edit race to a reload-and-review instruction', () => {
  assert.equal(
    apiErrorMessage(apiError('Expense was changed by another user.', {
      status: 409,
      code: 'EXPENSE_UPDATE_CONFLICT',
    })),
    'รายการถูกแก้ไขไปแล้ว เปิดหน้านี้ใหม่ ตรวจข้อมูล แล้วบันทึกอีกครั้ง',
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

test('employee and claim refusals name the standard OWNER and ADMIN roles consistently', () => {
  assert.equal(translateApiError('company_access_unavailable'), 'คุณไม่มีสิทธิ์เข้าใช้ร้านนี้แล้ว ติดต่อเจ้าของกิจการ');
  assert.equal(translateApiError("Cannot assign access outside the requester's branch scope."), 'เปลี่ยนสาขาของพนักงานคนนี้ไม่ได้ เพราะพนักงานอยู่ในสาขาที่บัญชีของคุณเข้าไม่ถึง หรือสาขาที่เลือกอยู่นอกสาขาของคุณ ติดต่อเจ้าของกิจการ');
  assert.equal(translateApiError('payout_account_edit_denied'), 'คุณตั้งบัญชีรับเงินคืนของคนนี้ไม่ได้ ให้เจ้าของบัญชีตั้งเอง หรือให้เจ้าของกิจการหรือผู้ดูแลบริษัทตั้งให้');
  assert.equal(translateApiError('reimbursement_policy_inactive'), 'ร้านปิดรับใบเบิกใหม่ชั่วคราว ติดต่อเจ้าของกิจการหรือผู้ดูแลบริษัท');
});


test('claim self-approval refusal explains the frozen-policy way forward in the shared toast', () => {
  const text = apiErrorMessage({ code: 'self_approval_denied' });
  assert.match(text, /ให้ผู้อนุมัติคนอื่นตัดสิน/);
  assert.match(text, /เก็บนโยบายไว้ตอนส่ง/);
  assert.match(text, /เปิดกลับเป็นร่างและส่ง/);
});


test('duplicate refusal distinguishes submission from payment and rejects unknown reason tokens', () => {
  const payment = { code: 'duplicate_unresolved', details: { duplicatePhase: 'PAYMENT', duplicateReasons: ['EXPENSE_DOCUMENT', '__proto__', 'private-id'] } };
  assert.match(apiErrorMessage(payment), /เอกสารค่าใช้จ่ายของใบนี้อาจซ้ำกับเอกสารเดิม/);
  assert.doesNotMatch(apiErrorMessage(payment), /private-id|object Object|__proto__/);
  const submit = apiErrorMessage({ code: 'duplicate_unresolved', details: { duplicatePhase: 'SUBMIT', duplicateReasons: ['ATTACHMENT_CHECKSUM'] } });
  assert.match(submit, /ใช้ใบเสร็จเดียวกับคำขอเบิกอื่น/);
  assert.match(submit, /ยังส่งใบนี้ไม่ได้/);
  assert.doesNotMatch(submit, /ก่อนบันทึกจ่าย/);
});

test('duplicate finance-review guidance names its available decision instead of a payment-step button', async () => {
  const { reimbursementDuplicateBlockNotice } = await import('@watchdog-bms/contracts');
  const message = (reimbursementDuplicateBlockNotice as any)(['ATTACHMENT_CHECKSUM'], true);
  assert.match(message, /ผู้ตรวจการเงินที่มีสิทธิ์ปลดรายการซ้ำอนุมัติจ่าย/);
  assert.doesNotMatch(message, /กดปลดรายการซ้ำ/);
});

test('disbursement command refusals use the server Thai sentence and keep diagnostic fallbacks safe', () => {
  const sentence = 'ใบนี้ถูกแก้ไขจากที่อื่นแล้ว กรุณาเปิดใหม่ก่อนทำต่อ';
  for (const code of ['disbursement_version_conflict', 'disbursement_status_changed', 'disbursement_approver_ineligible']) {
    assert.equal(apiErrorMessage({ code, details: { message: sentence }, status: 409 }), sentence);
    assert.doesNotMatch(apiErrorMessage({ code, details: { message: 'Internal diagnostic' } }), /Internal diagnostic/);
  }
  assert.doesNotMatch(apiErrorMessage({ code: 'disbursement_source_changed', details: { message: 'รายการ {number} ถูกเปลี่ยนแปลง' } }), /\{number\}/);
});

test('C5 self-issued record refusals have their Thai fallback and keep the server sentence', () => {
  for (const [code, message] of [
    ['wht_handoff_not_linkable', 'บันทึกไม่ได้ เพราะมีผู้ออกหรือบันทึกหนังสือรับรองของรายจ่ายนี้ไปก่อนแล้ว หรือเอกสารถูกแก้ไขหรือยกเลิก เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด'],
    ['wht_handoff_already_linked', 'รายจ่ายนี้บันทึกหนังสือรับรองที่ทำนอกระบบไว้แล้ว ถ้าข้อมูลผิด ให้ใช้ "แก้ไขการบันทึก"'],
    ['wht_handoff_external_record_no_changes', 'ข้อมูลตรงกับที่บันทึกไว้อยู่แล้ว จึงไม่มีอะไรต้องแก้ไข'],
    ['wht_handoff_external_record_invalid', 'ข้อมูลที่บันทึกไม่ครบหรือไม่ถูกต้อง ตรวจเลขที่ วันที่ เลขอ้างอิง และหมายเหตุ แล้วบันทึกอีกครั้ง'],
    ['wht_handoff_external_issued_date_future', 'วันที่ทำใบต้องไม่เกินวันนี้ เลือกวันที่แล้วบันทึกอีกครั้ง'],
    ['wht_handoff_external_change_permission_denied', 'คุณไม่มีสิทธิ์แก้ไขการบันทึกหนังสือรับรองนี้ ให้ผู้ที่มีสิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบแก้ไขให้'],
  ]) {
    assert.equal(translateApiError(code), message);
    const server = 'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดหน้านี้ใหม่ก่อนบันทึก';
    assert.equal(apiErrorMessage({ code, details: { code, message: server } }), server);
  }
});


test('missing certificate addresses point to the same-screen entry with Thai code fallbacks', () => {
  for (const [code, message] of [
    ['wht_handoff_payee_address_missing', 'ยังไม่มีที่อยู่ผู้รับเงิน เพิ่มที่อยู่ผู้รับเงินก่อน แล้วกด “ออกหนังสือรับรอง 50 ทวิ” อีกครั้ง'],
    ['wht_certificate_payee_address_required', 'ยังไม่มีที่อยู่ผู้รับเงิน พิมพ์ที่อยู่ในแบบฟอร์มนี้ก่อนบันทึก'],
  ]) {
    assert.equal(apiErrorMessage({ code }), message); assert.equal(translateApiError(code!), message);
    assert.equal(apiErrorMessage({ code, message }), message);
  }
});


test('payer identity refusals keep each server sentence and have a Thai fallback', () => {
  for (const label of ['ชื่อจดทะเบียนของร้าน', 'ชื่อจดทะเบียน เลขผู้เสียภาษี และที่อยู่ของร้าน', 'เลขผู้เสียภาษีและที่อยู่ของร้าน', 'เลขผู้เสียภาษีของร้าน', 'ที่อยู่ของร้าน']) {
    const message = `ยังไม่มี${label} กรอกในหน้าข้อมูลร้านก่อน แล้วกด “ออกหนังสือรับรอง 50 ทวิ” อีกครั้ง`;
    assert.equal(apiErrorMessage({ code: 'wht_payer_identity_missing', message }), message);
  }
  assert.ok(apiErrorMessage({ code: 'wht_payer_identity_missing' }).includes('หน้าข้อมูลร้าน'));
});
test('locked certificate corrections have the contract sentence with the expense edit action', async () => {
  const { WHT_CERTIFICATE_CORRECTION_WORDS } = await import('@watchdog-bms/contracts');
  assert.equal(apiErrorMessage({ code: 'wht_correction_field_locked' }), WHT_CERTIFICATE_CORRECTION_WORDS.fieldLocked);
  assert.equal(apiErrorMessage({ code: 'wht_correction_field_locked', message: WHT_CERTIFICATE_CORRECTION_WORDS.fieldLocked }), WHT_CERTIFICATE_CORRECTION_WORDS.fieldLocked);
});

test('R4 expense confirmation maps payee and income requirements to the web question words', () => {
  assert.equal(translateApiError('Withholding tax requires the payee taxpayer class (บุคคลธรรมดา / นิติบุคคล) before confirmation.'), 'เลือกก่อนว่าผู้รับเงินเป็นบริษัทหรือบุคคลธรรมดา');
  assert.equal(translateApiError('Withholding tax requires the income category (ประเภทเงินได้) before confirmation.'), 'เลือก “จ่ายค่าอะไร” ก่อนยืนยันเอกสาร');
});

test('C15 removal failures have actionable Thai fallbacks and preserve the server sentence', async () => {
  const { WHT_EXTERNAL_RECORD_WORDS } = await import('@watchdog-bms/contracts');
  for (const [code, message] of [
    ['wht_handoff_external_remove_permission_denied', WHT_EXTERNAL_RECORD_WORDS.removePermissionDenied],
    ['wht_handoff_external_remove_reason_invalid', WHT_EXTERNAL_RECORD_WORDS.removeInvalid],
    ['wht_handoff_external_remove_request_invalid', WHT_EXTERNAL_RECORD_WORDS.removeRequestInvalid],
  ]) {
    assert.equal(translateApiError(code), message);
    assert.equal(apiErrorMessage({ code, details: { message } }), message);
  }
});


test('input VAT decision refusals keep the fixed reason and the reason-field instruction', () => {
  const message = 'ร้านไม่ได้จด VAT ณ วันที่ของเอกสาร บันทึกรายจ่ายได้โดยไม่ใช้สิทธิภาษีซื้อ';
  assert.equal(apiErrorMessage({ code: 'input_vat_fixed', message }), message);
  assert.equal(apiErrorMessage({ code: 'input_vat_reason_required', message: 'บอกเหตุผลที่ใช้ภาษีซื้อไม่ได้' }), 'บอกเหตุผลที่ใช้ภาษีซื้อไม่ได้');
  for (const code of ['input_vat_conditions_required', 'input_vat_attachment_required', 'input_vat_seller_tax_id_required', 'input_vat_document_number_required',
    'input_vat_usable_evidence_required', 'input_vat_buyer_mismatch', 'input_vat_buyer_confirmation_required', 'input_vat_posted_journal_immutable', 'input_vat_expense_closed']) {
    assert.match(apiErrorMessage({ code }), /[ก-๙]/);
    assert.doesNotMatch(apiErrorMessage({ code }), /กรุณา|ดำเนินการ/);
  }
});

test('a posted expense journal has no reopen shortcut for its VAT decision', () => {
  assert.equal(apiErrorMessage({ code: 'input_vat_posted_journal_immutable' }), 'รายจ่ายนี้ลงบัญชีแล้ว จึงเปลี่ยนสิทธิภาษีซื้อไม่ได้ แม้กลับรายการบัญชีแล้ว');
});

test('free expense read-limit refusal explains that existing drafts remain editable', () => {
  assert.equal(apiErrorMessage({ code: 'FREE_DOCUMENT_LIMIT_REACHED' }), 'ใช้สิทธิ์อ่านเอกสารฟรีของเดือนนี้ครบแล้ว ยังเปิดดูและแก้ร่างเดิมได้');
});
