import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';

const source = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');

test('expense confirmation toast does not promise ledger posting', () => {
  assert.match(source, /ยืนยันเอกสารเรียบร้อยแล้ว/);
  assert.doesNotMatch(source, /ยืนยันและลงบัญชีเรียบร้อยแล้ว/);
  assert.doesNotMatch(workspaceDictionary.th['expenses.no_receipt_banner'], /ลงบัญชี/);
  for (const key of ['expenses.substitute_wizard.done_next_confirm', 'expenses.substitute_wizard.back_to_expense'] as const) {
    assert.doesNotMatch(workspaceDictionary.th[key], /บัญชี/);
    assert.doesNotMatch(workspaceDictionary.en[key], /accounting|post/i);
  }
});

test('substitute receipt waiting copy does not claim unverified LINE delivery', () => {
  assert.doesNotMatch(workspaceDictionary.th['expenses.substitute_wizard.waiting_help'], /ส่ง.*LINE.*แล้ว/);
  assert.doesNotMatch(workspaceDictionary.en['expenses.substitute_wizard.waiting_help'], /sent.*LINE notification/);
  for (const locale of ['th', 'en'] as const) {
    assert.match(workspaceDictionary[locale]['expenses.substitute_wizard.waiting_help'], /ลิงก์|link/);
  }
});

test('duplicate guidance does not tell a read-only resolver to click an unavailable action', () => {
  assert.doesNotMatch(workspaceDictionary.th['expenses.duplicate_action_required'], /ต้องกด/);
  assert.match(workspaceDictionary.th['expenses.duplicate_action_required'], /ผู้มีสิทธิ์/);
  assert.doesNotMatch(workspaceDictionary.en['expenses.duplicate_action_required'], /you must click/i);
  assert.match(workspaceDictionary.en['expenses.duplicate_action_required'], /authorized reviewer/i);
});

test('confirmed duplicate copy distinguishes the final decision from an unresolved warning', () => {
  assert.match(source, /const isConfirmedDuplicate = detail\.duplicateStatus === 'CONFIRMED_DUPLICATE'/);
  assert.match(source, /isConfirmedDuplicate \? 'expenses\.duplicate_confirmed_title' : 'expenses\.duplicate_warning_title'/);
  assert.match(source, /isConfirmedDuplicate \? 'expenses\.duplicate_confirmed_block' : 'expenses\.duplicate_action_required'/);
  assert.match(source, /hasDuplicates, isConfirmedDuplicate, needsReceiptOrSubstitute/);
  assert.equal((source.match(/title=\{confirmBlockedText \?\? undefined\}/g) ?? []).length, 2);
  assert.equal((source.match(/\{confirmBlockedNotice\}/g) ?? []).length, 2);
  assert.match(source, /\{duplicateBlockMessage\}<\/p>/);
  assert.match(workspaceDictionary.th['expenses.duplicate_confirmed_block'], /ไม่สามารถยืนยันค่าใช้จ่ายซ้ำได้/);
  assert.match(workspaceDictionary.en['expenses.duplicate_confirmed_block'], /cannot be confirmed again/);
});

/**
 * Spec §5.1: the goods subtotal stops including the additional charges, so the money card only adds
 * up if it shows them — between the discount and the tax base, in the order the arithmetic runs.
 * Dropping the row would leave a card whose numbers silently disagree with themselves.
 */
test('the money card shows the additional charges between the discount and the tax base', () => {
  const rows = [...source.matchAll(/<MoneyRow label=\{t\('(expenses\.[a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(rows.slice(0, 4), [
    'expenses.subtotal', 'expenses.discount', 'expenses.charges_total', 'expenses.taxable_base_ex_vat',
  ]);
  assert.match(source, /const chargesTotal = \(detail\.charges \?\? \[\]\)\.reduce/);
  assert.match(source, /\{chargesTotal !== 0 && <MoneyRow/, 'a zero-charge bill keeps the card it had');
  for (const locale of ['th', 'en'] as const) {
    assert.ok(workspaceDictionary[locale]['expenses.charges_total'].trim().length > 0);
  }
  // Customer-facing Thai carries no "+" characters (spec §3).
  for (const key of ['expenses.charges_total', 'expenses.charges_section', 'expenses.add_charge', 'expenses.no_charges'] as const) {
    assert.doesNotMatch(workspaceDictionary.th[key], /\+/, key);
  }
});
