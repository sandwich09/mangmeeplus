import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '../../../common/i18n/workspace-dictionary';

const source = readFileSync(new URL('./ExpenseCaptureGroupPage.tsx', import.meta.url), 'utf8');
const facts = readFileSync(new URL('./CaptureFactsSection.tsx', import.meta.url), 'utf8');
const allocation = readFileSync(new URL('./CaptureAllocationSection.tsx', import.meta.url), 'utf8');
const list = readFileSync(new URL('./ExpenseCaptureListPage.tsx', import.meta.url), 'utf8');
const route = readFileSync(
  new URL('../../../../app/(workspace)/companies/[companyId]/expenses/capture/[groupId]/page.tsx', import.meta.url),
  'utf8',
);
const listRoute = readFileSync(
  new URL('../../../../app/(workspace)/companies/[companyId]/expenses/capture/page.tsx', import.meta.url),
  'utf8',
);

/**
 * Appendix §11 / spec §8. These are page-shape rules the type system cannot hold: a button that
 * drops below 44px, a second column at 390px, a pre-selected answer, or an affordance decided by
 * the client instead of by the server's `allowedActions` all compile perfectly.
 */
test('the route renders the page for its own company and group, and tells it who is asking', () => {
  assert.match(route, /ExpenseCaptureGroupPage/);
  assert.match(route, /companyId=\{companyId\}/);
  assert.match(route, /groupId=\{groupId\}/);
  // The payer question and the tax block need the viewer; the server re-checks both.
  assert.match(route, /userId=\{session\?\.userId \?\? ''\}/);
  assert.match(route, /permissions=\{session\?\.permissions \?\? \[\]\}/);
  assert.match(listRoute, /ExpenseCaptureListPage companyId=\{companyId\}/);
});

test('every mutation affordance comes from the server allowedActions, not from the client', () => {
  assert.match(source, /const may = \(action: ExpenseCaptureAction\) => group\.allowedActions\.includes\(action\)/);
  for (const action of ['add_file', 'detach_file', 'close', 'handoff']) {
    assert.match(source, new RegExp(`may\\('${action}'\\)`), `${action} is not gated by the server`);
  }
  // The review and the acceptance are gated inside their own section, from the same list.
  assert.match(allocation, /group\.allowedActions\.includes\('review'\)/);
  assert.match(allocation, /group\.allowedActions\.includes\('accept_allocation'\)/);
  assert.match(source, /canEdit=\{may\('review'\)\}/);
  // A read-only account is told so, instead of being shown buttons that 403.
  assert.match(source, /expenses\.capture\.read_only/);
});

test('mobile first: one column, 18px Thai body, 44px controls', () => {
  assert.match(source, /className="flex flex-col gap-4 text-lg leading-8 text-gray-800"/);
  for (const [name, file] of [['page', source], ['allocation', allocation], ['list', list]] as const) {
    assert.doesNotMatch(file, /overflow-x-auto|whitespace-nowrap|min-w-\[/, `${name} scrolls sideways at 390px`);
    assert.doesNotMatch(file, /grid-cols-2|md:grid-cols/, `${name} is not a single column`);
  }
  // The one wide thing on the page is the item table, and it scrolls INSIDE its own box.
  assert.match(facts, /overflow-x-auto">\s*<table className="w-full min-w-\[/);
  // The two big answers share one class helper, which carries the same floor.
  assert.match(allocation, /const optionClass = \(selected: boolean\) => cx\(\s*'min-h-11/);
  for (const [name, file, least] of [['page', source, 4], ['facts', facts, 2], ['allocation', allocation, 4], ['list', list, 1]] as const) {
    const buttons = file.match(/<button[\s\S]{0,400}?>/g) ?? [];
    assert.ok(buttons.length >= least, `${name} has its actions`);
    for (const button of buttons) {
      assert.match(button, /min-h-11|className=\{optionClass\(/, `a control below 44px in ${name}: ${button.slice(0, 80)}`);
    }
  }
});

test('the facts and the split are rendered from the group the server sent', () => {
  assert.match(source, /<CaptureFactsSection/);
  assert.match(source, /<CaptureAllocationSection/);
  assert.match(source, /group=\{group\}/);
  assert.match(source, /viewerUserId=\{userId\}/);
  assert.match(source, /canReview=\{permissions\.includes\('expense\.review'\)\}/);
});

test('no answer is chosen for the user: business use starts at whatever the server recorded', () => {
  assert.match(allocation, /useState<ExpenseCaptureBusinessUse>\(group\.businessUse\)/);
  assert.match(allocation, /useState<ExpenseCaptureFundingRoute>\(group\.fundingRoute\)/);
  assert.doesNotMatch(allocation, /useState<ExpenseCaptureBusinessUse>\('ALL_COMPANY'\)/);
  // Both options are rendered unselected while the answer is UNKNOWN.
  assert.match(allocation, /aria-pressed=\{businessUse === 'ALL_COMPANY'\}/);
  assert.match(allocation, /aria-pressed=\{businessUse === 'MIXED'\}/);
});

test('the payer is never defaulted to the uploader', () => {
  assert.match(allocation, /useState<string>\(group\.payerUserId \?\? ''\)/);
  // "ฉัน" is only filled in when the person themselves answers "พนักงานสำรองจ่าย".
  assert.match(allocation, /setFundingRoute\('EMPLOYEE'\); setPayerUserId\(\(current\) => current \|\| viewerUserId\)/);
  assert.doesNotMatch(allocation, /payerUserId: createdByUserId|addedByUserId/);
});

test('what must be resolved is visible before the button that acts on it', () => {
  const blockers = source.indexOf('expenses.capture.blockers_title');
  const primary = source.indexOf("may('handoff')");
  assert.ok(blockers > 0 && primary > blockers, 'the blocker list must come before the primary action');
  assert.match(source, /expenses\.capture\.blocker_way_out_label/);
});

test('a handoff states what it creates, retries as the same batch, and never guesses an unknown result', () => {
  assert.match(source, /handoff_confirm_message/);
  assert.match(source, /idempotencyRef\.current = \{ allocationId, key: crypto\.randomUUID\(\) \}/);
  assert.match(source, /idempotencyKey: idempotencyRef\.current\.key/);
  // UXE-24: an unknown outcome re-reads the group instead of offering the button again.
  assert.match(source, /status === undefined \|\| status >= 500.*handoff_unknown|setHandoff\(\{ kind: 'unknown' \}\); await load\(\);/s);
  assert.match(source, /status === 404/);
  assert.match(workspaceDictionary.th['expenses.capture.handoff_unknown'], /กำลังตรวจสอบผลรายการ/);
});

test('polling follows the job and stops when it ends — it never asks for another read', () => {
  assert.match(source, /if \(!reading\) return;/);
  assert.match(source, /}, 3_000\);/);
  assert.match(source, /getExpenseCaptureGroupReadStatus\(companyId, groupId\)/);
  assert.doesNotMatch(source, /requestExpenseExtraction/, 'a status page never starts a read');
});

// The retired AI-money phrases are swept across the whole product source by
// `api-error-coverage.spec.ts`; repeating them here would only add this file to its allowlist.
test('no reread offer on this page', () => {
  for (const file of [source, facts, allocation, list]) {
    assert.doesNotMatch(file, /อ่านเอกสารอีกครั้ง|อ่านใหม่/);
  }
});

test('"เก็บไว้ก่อน" navigates and says so — it is not the name of a mutation', () => {
  const keep = source.slice(source.indexOf('const keepForLater'), source.indexOf('const openPreview'));
  assert.doesNotMatch(keep, /await |closeExpenseCaptureGroup|detachExpenseCaptureFile/);
  assert.match(keep, /router\.push\(`\/companies\/\$\{companyId\}\/expenses`\)/);
  assert.match(workspaceDictionary.th['expenses.capture.kept_toast'], /ยังไม่ได้สร้างรายการค่าใช้จ่าย/);
});

test('the electronic line stays "not checked" (D09) in both locales', () => {
  assert.match(source, /expenses\.capture\.electronic_not_checked/);
  assert.match(workspaceDictionary.th['expenses.capture.electronic_not_checked'], /ยังไม่ได้ตรวจสอบ/);
  assert.doesNotMatch(workspaceDictionary.th['expenses.capture.electronic_not_checked'], /ผ่าน|ถูกต้อง/);
  assert.doesNotMatch(workspaceDictionary.en['expenses.capture.electronic_not_checked'], /verified|passed/i);
});

test('an amount nobody read is "ไม่ทราบ", never 0', () => {
  assert.match(facts, /raw === undefined \|\| raw === null \|\| raw === '' \? unknown : baht\(raw\)/);
  assert.equal(workspaceDictionary.th['expenses.capture.unknown_value'], 'ไม่ทราบ');
  assert.match(workspaceDictionary.th['expenses.capture.edit_facts_hint'], /ไม่ใช่ 0/);
});

test('the binding copy of spec §3 and §13.4 is on the page', () => {
  assert.equal(workspaceDictionary.th['expenses.capture.business_use_all'], 'ใช้สำหรับบริษัททั้งหมด');
  assert.equal(workspaceDictionary.th['expenses.capture.business_use_mixed'], 'มีของส่วนตัวด้วย');
  assert.equal(workspaceDictionary.th['expenses.capture.question_payer'], 'ใครเป็นคนจ่ายรายการนี้');
  assert.match(workspaceDictionary.th['expenses.capture.summary_documents'], /พบ \{documents\} ร้าน • \{items\} รายการ/);
  assert.match(workspaceDictionary.th['expenses.capture.tax_note'], /ระบบไม่เปลี่ยนค่าให้เอง/);
  assert.match(workspaceDictionary.th['expenses.capture.accept_hint'], /เปลี่ยนคำตอบภายหลังต้องคำนวณใหม่/);
  assert.match(workspaceDictionary.th['expenses.capture.no_company_portion_result'], /เก็บหลักฐานไว้โดยไม่สร้างรายการ/);
  assert.match(workspaceDictionary.th['expenses.capture.after_handoff_note'], /คำนวณใหม่ได้เมื่อรายการยังไม่ถูกใช้/);
});

test('403 and a load failure get the shared states, not a blank page', () => {
  assert.match(source, /<ForbiddenState locale=\{locale\} \/>/);
  assert.match(source, /<ErrorState locale=\{locale\}/);
  assert.match(list, /<ForbiddenState locale=\{locale\} \/>/);
});

test('a revision conflict offers the latest data instead of a second attempt (UXE-21)', () => {
  assert.match(allocation, /expense_capture_group_revision_conflict/);
  assert.match(allocation, /expenses\.capture\.reload_latest/);
  // A blocked acceptance lists the codes the server refused on (422).
  assert.match(allocation, /blockedCodes/);
  assert.match(allocation, /translateApiError\(code\) \?\? code/);
});
