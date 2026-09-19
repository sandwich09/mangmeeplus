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
 * Spec §17.6 (W02-web). A read that ENDED without reading the document offers no way to read it
 * again: the file is saved and the way on is this form. Both reread buttons therefore hang off
 * `readAgainAllowed`, which is the tested rule in expense-capture-status.logic.spec.ts.
 */
test('neither reread button survives a terminal read failure or an error notice', () => {
  assert.equal((source.match(/readAgainAllowed/g) ?? []).length, 3, 'one rule, both buttons, one definition');
  assert.doesNotMatch(source, /\{canExtract && \(\s*<button/);
  assert.match(source, /captureReadAgainAllowed\(\{\s*canExtract, readStatus: readState\?\.status \?\? null, noticeTone: notice\?\.tone \?\? null,/);
  for (const key of ['expenses.extract_failed', 'expenses.upload_extract_failed_suffix', 'expenses.extract_no_attachment'] as const) {
    assert.doesNotMatch(workspaceDictionary.th[key], /อ่านเอกสารอีกครั้ง|ลองอ่าน/, key);
  }
  assert.match(workspaceDictionary.th['expenses.extract_failed'], /เก็บไฟล์ไว้แล้ว/);
});

test('the read state is shown beside the file, not only as a toast', () => {
  const notices = source.slice(source.indexOf('const noticesBlock = ('), source.indexOf('const postingCard'));
  assert.match(notices, /readNotice && \(readNotice\.tone === 'error'/);
  assert.match(notices, /aiMap\?\.\['sourceStale'\] === true && <InfoBanner message=\{t\('expenses\.capture\.source_stale'/);
  assert.doesNotMatch(notices, /toast\./, 'a persisted notice, not a toast that scrolls away');
});

test('polling follows the durable job and never starts a read of its own', () => {
  assert.match(source, /if \(!detail\?\.primaryAttachmentId\) return;/);
  assert.match(source, /getExpenseReadStatus\(companyId, expenseId\)/);
  assert.match(source, /if \(file\?\.status === 'DONE' && file\.applied !== false\) void load\(\);/);
  assert.match(source, /}, 3_000\);/);
});

/** Spec §16.4: the two file intents, each with the identity the server checks. */
test('replace carries the revision, the expected primary and a reused operation id', () => {
  const replace = source.slice(source.indexOf('const attachPrimaryReceipt'), source.indexOf('const appendSupportingReceipt'));
  assert.match(replace, /intent: 'replace'/);
  assert.match(replace, /expectedUpdatedAt: detail\.updatedAt/);
  assert.match(replace, /expectedPrimaryAttachmentId: detail\.primaryAttachmentId/);
  assert.match(replace, /operationId,/);
  assert.match(source, /const key = `\$\{intent\}:\$\{revision\}:\$\{file\.name\}:\$\{file\.size\}`/);
});

test('append adds supporting evidence and never names a primary to swap', () => {
  const append = source.slice(source.indexOf('const appendSupportingReceipt'), source.indexOf('const splitIntoCaptureGroup'));
  assert.match(append, /'expense\.receipt\.supporting'/);
  assert.match(append, /intent: 'append', expectedUpdatedAt: detail\.updatedAt, operationId/);
  assert.doesNotMatch(append, /expectedPrimaryAttachmentId/);
});

test('a conflict offers the latest data instead of a silent retry', () => {
  assert.match(source, /code === 'expense_revision_conflict' \|\| code === 'expense_receipt_replace_conflict'/);
  assert.match(source, /\{error && conflictReload && \(/);
  assert.match(source, /expenses\.capture\.reload_latest/);
});

test('more than one document in a file offers the split, not another read', () => {
  // W07-int: the READ JOB decides it whenever there is one — the API derives `multiDocument` from
  // the assembled observation, which is the same fact that stopped the apply. The OCR
  // classification stays only for the synchronous single-image lane, which has no job at all.
  assert.match(source, /readState\s*\?\s*readState\.multiDocument === true/);
  assert.match(source, /contentKind === 'MULTI_DOCUMENT'/);
  // …and a DONE the API says was NOT applied does not send the page to re-read an unchanged draft.
  assert.match(source, /file\?\.status === 'DONE' && file\.applied !== false/);
  assert.match(source, /convertExpenseToCaptureGroup\(companyId, expenseId, \{ expectedUpdatedAt: detail\.updatedAt \}\)/);
  assert.match(source, /expenses\.capture\.split_to_group/);
  assert.match(workspaceDictionary.th['expenses.capture.multi_document'], /มากกว่า 1 ฉบับ/);
});

/**
 * Spec §5.1: the goods subtotal stops including the additional charges, so the money card only adds
 * up if it shows them — between the discount and the tax base, in the order the arithmetic runs.
 * Dropping the row would leave a card whose numbers silently disagree with themselves.
 */
test('the money card shows the additional charges between the discount and the tax base', () => {
  const rows = [...source.matchAll(/<MoneyRow label=\{t\('(expenses\.[a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(rows.slice(0, 4), [
    'expenses.subtotal', 'expenses.discount', 'expenses.charges_section', 'expenses.taxable_base_ex_vat',
  ]);
  assert.match(source, /calculatedAdjustmentAmount/);
  assert.match(source, /printedRounding !== 0 && <MoneyRow/);
  assert.match(source, /chargesTotal !== 0 && <MoneyRow/);
  for (const locale of ['th', 'en'] as const) {
    assert.ok(workspaceDictionary[locale]['expenses.charges_total'].trim().length > 0);
  }
  // Customer-facing Thai carries no "+" characters (spec §3).
  for (const key of ['expenses.charges_total', 'expenses.charges_section', 'expenses.add_charge', 'expenses.no_charges'] as const) {
    assert.doesNotMatch(workspaceDictionary.th[key], /\+/, key);
  }
});

/**
 * §5.1 read side. The money rows are the stored header while the lines are stored separately, so a
 * record written before that rule — or by anything bypassing the draft use-cases — can have the two
 * disagree. Printing the header alone would state a total its own lines contradict.
 */
test('the money card warns when the stored record does not add up', () => {
  assert.match(source, /detail\.totalsIdentity\?\.ok === false && \(/);
  assert.match(source, /t\('expenses\.totals_identity_warning', locale\)/);
  // Branch on `ok`: a subtotal-only drift has a correct grand total and therefore a zero gap.
  assert.doesNotMatch(source, /totalsIdentity\.gapAmount\s*(!==|===|>|<)/);
  for (const locale of ['th', 'en'] as const) {
    assert.ok(workspaceDictionary[locale]['expenses.totals_identity_warning'].trim().length > 0);
  }
  assert.doesNotMatch(workspaceDictionary.th['expenses.totals_identity_warning'], /\+/);
});
