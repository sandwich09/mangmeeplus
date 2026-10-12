import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
const source = readFileSync(new URL('./use-unsaved-navigation.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./unsaved-navigation.module.css', import.meta.url), 'utf8');
test('leave dialog uses the fixed copy, refuses backdrop dismissal and has safe-area footer padding', () => {
  for (const [key, sentence] of [['title', 'ยังไม่ได้บันทึกใบนี้'], ['description', 'ถ้าออกตอนนี้ รายการที่เลือกไว้จะหาย'], ['stay', 'อยู่ต่อ'], ['discard', 'ไม่บันทึกและออก'], ['save_leave', 'บันทึกฉบับร่างและออก']] as const) assert.equal(workspaceDictionary.th[`common.unsaved.${key}`], sentence);
  assert.match(source, /closeOnBackdrop=\{false\}/);
  assert.match(css, /padding-bottom: env\(safe-area-inset-bottom\)/);
});
test('Stay drops the pending navigation, Discard leaves, and Save leaves only after successful valid save', () => {
  assert.match(source, /const stay = \(\) => \{ if \(!options\.saving\) \{ pending\.current = null; setOpen\(false\)/);
  assert.match(source, /const finishLeave = \(\) => \{[\s\S]*?allowNavigation\(\); setOpen\(false\)/);
  assert.match(source, /options\.canSave && <button/);
  assert.match(source, /if \(!latest\.current\.canSave \|\| latest\.current\.saving\) return/);
  assert.match(source, /if \(await latest\.current\.onSave\(\)\) finishLeave\(\)/);
  assert.match(source, /options\.error && <p role="alert"/);
});
test('ordinary in-app links and Back are guarded while closing the tab uses beforeunload', () => {
  assert.match(source, /document\.addEventListener\('click', click, true\)/);
  assert.match(source, /window\.addEventListener\('popstate', back, true\)/);
  assert.match(source, /window\.addEventListener\('beforeunload', unload\)/);
  assert.match(source, /event\.preventDefault\(\); event\.returnValue = ''/);
  assert.match(source, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(source, /anchor\.hasAttribute\('download'\)/);
  assert.match(source, /window\.history\.forward\(\)/);
  assert.match(source, /window\.history\.go\(-2\)/);
});

test('saved-draft edits supply a truthful title while a new draft keeps the default', () => {
  const draft = readFileSync(new URL('../../../features/expenses/disbursement-vouchers/DisbursementVoucherDraftPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /title=\{options.title \?\? t\('common.unsaved.title'/);
  assert.match(draft, /title: draftId \? t\('expenses.disbursement.leave_edit_title', 'th'\) : undefined/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.leave_edit_title'], 'ยังไม่ได้บันทึกสิ่งที่แก้');
  assert.equal(workspaceDictionary.th['common.unsaved.title'], 'ยังไม่ได้บันทึกใบนี้');
});
