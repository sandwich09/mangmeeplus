import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { apiErrorMessage, translateApiError } from './api-error-message';

const apiError = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);

test('translates a known API sentence to Thai', () => {
  assert.equal(
    apiErrorMessage(apiError('Expense requires a receipt attachment or a missing receipt reason.', { status: 400 })),
    'ต้องแนบไฟล์ใบเสร็จ หรือระบุเหตุผลที่ไม่มีใบเสร็จ ก่อนยืนยันลงบัญชี',
  );
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

test('falls back to the status text only for the client placeholder message', () => {
  assert.equal(apiErrorMessage(apiError('API error 403', { status: 403 })), 'คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อเจ้าของร้าน');
  // A real server sentence says more than the generic status text, so it stays.
  assert.equal(apiErrorMessage(apiError('A sentence nobody mapped yet.', { status: 400 })), 'A sentence nobody mapped yet.');
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
