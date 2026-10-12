import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
const manual = source.slice(source.indexOf('function ManualExpensePanel('), source.indexOf('// ── Hub'));

test('manual entry allows each mobile grid track and its contents to shrink at 320 and 300 px', () => {
  assert.match(manual, /<form[^>]*className="grid min-w-0 grid-cols-\[minmax\(0,1fr\)\] gap-4 lg:grid-cols-\[minmax\(0,1fr\)_320px\]"/);
  assert.equal((manual.match(/grid min-w-0 grid-cols-\[minmax\(0,1fr\)\] gap-3/g) ?? []).length, 2);
  assert.match(manual, /grid min-w-0 grid-cols-\[minmax\(0,1fr\)\] gap-3 p-3 sm:grid-cols-3/);
  assert.match(manual, /<div className="min-w-0 space-y-4">/);
  assert.match(manual, /<div className="min-w-0 lg:sticky lg:top-4 lg:self-start">/);
  assert.match(manual, /<ThemedFile className="flex-wrap \[&>span:last-child\]:max-w-full"/);
  assert.doesNotMatch(manual, /overflow-x-hidden/);
});

test('manual entry says the title once and keeps only short, useful hints', () => {
  assert.match(source, /title=\{t\(meta\.labelKey, locale\)\}/);
  assert.match(source, /description=\{manualNotEnabled \? undefined : t\(meta\.descKey, locale\)\}/);
  assert.doesNotMatch(manual, /expenses\.manual_title|expenses\.manual_intro/);
  assert.doesNotMatch(manual, /expenses\.manual_document_helper|expenses\.manual_items_helper/);
  assert.doesNotMatch(manual, /ตรวจวันที่ให้ตรงกับเอกสารก่อนบันทึก/);
  assert.match(manual, /expenses\.manual_date_helper/);
  assert.match(manual, /expenses\.manual_receipt_helper/);
  assert.match(manual, /expenses\.manual_service_charge_helper/);
});
