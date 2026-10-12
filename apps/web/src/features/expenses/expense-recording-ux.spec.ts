import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as model from './expenses.model';
import { t } from '@/common/i18n/workspace-i18n.logic';

const source = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
test('R4 branch gate starts neutral and locked controls route taps to the branch', () => {
  assert.match(source, /invalid=\{branchTouched && !createBranchId\}/);
  assert.match(source, /setBranchTouched\(true\)/);
  assert.match(source, /className=\{cx\('min-w-0', !createBranchId && 'pointer-events-none'\)\}/);
  assert.match(source, /เลือกสาขาก่อน จึงจะกรอกรายการได้/);
});
test('R4 income options keep rates and values, sort common payments first and other last', () => {
  const categories = ['อื่นๆ', 'ค่าโฆษณา', 'ค่าเช่า', 'ดอกเบี้ย', 'ค่าขนส่ง', 'ค่าบริการ'].map((nameTh, i) => ({ code: String(i), nameTh, defaultRate: '3.00', formType: 'PND53' }));
  const options = (model as any).expenseWhtCategoryOptions(categories);
  assert.deepEqual(options.map((row: any) => row.nameTh), ['ค่าบริการ', 'ค่าเช่า', 'ค่าขนส่ง', 'ค่าโฆษณา', 'ดอกเบี้ย', 'อื่นๆ']);
  assert.ok(options.every((row: any) => row.label === `${row.nameTh} · หัก 3%` && row.defaultRate === '3.00'));
  assert.equal(categories[0]!.nameTh, 'อื่นๆ');
});
test('R4 short labels and hints share the dictionary and web-only document/status labels', () => {
  assert.equal(t('expenses.payee_entity_kind', 'th'), 'ผู้รับเงินเป็นใคร');
  assert.equal(t('expenses.wht_income_category', 'th'), 'จ่ายค่าอะไร');
  assert.equal(model.PAYEE_ENTITY_KIND_LABELS.JURISTIC, 'บริษัท / ห้างหุ้นส่วน');
  assert.equal(model.PAYEE_ENTITY_KIND_LABELS.INDIVIDUAL, 'บุคคลธรรมดา');
  assert.equal(model.SOURCE_DOCUMENT_TYPE_LABELS.NEEDS_REVIEW, 'เลือกประเภทเอกสาร');
  assert.equal(model.EXPENSE_STATUS_LABELS.VOIDED, 'ยกเลิกแล้ว');
  assert.equal(t('expenses.wht_choice_hint', 'th'), 'เช่น ค่าบริการ ค่าเช่า ค่าขนส่ง · ซื้อสินค้าทั่วไปไม่ต้องหัก');
});
