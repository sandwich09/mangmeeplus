import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as model from './expenses.model';
import { t } from '@/common/i18n/workspace-i18n.logic';

const source = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
test('review answers fit their available width and receipt fill controls share aligned label space', () => {
  assert.match(source, /grid-cols-\[repeat\(auto-fit,minmax\(min\(100%,14rem\),1fr\)\)\] items-start/);
  const fields = source.slice(source.indexOf('<div ref={documentFieldsRef}'), source.indexOf('{/* Spec S1-R4', source.indexOf('<div ref={documentFieldsRef}')));
  assert.equal((fields.match(/min-h-6[^"']*whitespace-nowrap/g) ?? []).length, 3);
  const fill = readFileSync(new URL('./ReceiptUploadResult.tsx', import.meta.url), 'utf8');
  assert.match(fill, /grid items-start gap-3 md:grid-cols-3/);
  assert.equal((fill.match(/mb-1 block min-h-6 text-sm font-medium/g) ?? []).length, 3);
});
test('R4 branch gate starts neutral and locked controls route taps to the branch', () => {
  assert.match(source, /invalid=\{!createBranchId && branchTouched\}/);
  assert.match(source, /invalid=\{!branchId && submitAttempted\}/);
  assert.match(source, /setBranchTouched\(true\)/);
  assert.match(source, /className=\{cx\('min-w-0', tab === 'manual' && !createBranchId && 'pointer-events-none'\)\}/);
  // Manual entry stays locked; a selected upload waits beside the branch field.
  assert.match(source, /if \(createBranchId \|\| tab !== 'manual'\) return/);
  assert.match(source, /toast.error\('เลือกสาขาก่อน จึงจะกรอกได้'\)/);
  assert.doesNotMatch(source, /onBranchWaitChange|เก็บรูปไว้แล้ว/);
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
