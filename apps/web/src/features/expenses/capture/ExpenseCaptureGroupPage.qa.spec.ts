import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '../../../common/i18n/workspace-dictionary';

const source = readFileSync(new URL('./ExpenseCaptureGroupPage.tsx', import.meta.url), 'utf8');
const route = readFileSync(
  new URL('../../../../app/(workspace)/companies/[companyId]/expenses/capture/[groupId]/page.tsx', import.meta.url),
  'utf8',
);

/**
 * Appendix §11 / spec §8. These are page-shape rules the type system cannot hold: a button that
 * drops below 44px, a second column at 390px, or an affordance decided by the client instead of by
 * the server's `allowedActions` all compile perfectly.
 */
test('the route renders the page for its own company and group', () => {
  assert.match(route, /ExpenseCaptureGroupPage companyId=\{companyId\} groupId=\{groupId\}/);
});

test('every mutation affordance comes from the server allowedActions, not from the client', () => {
  assert.match(source, /const may = \(action: 'add_file' \| 'detach_file' \| 'close'\) => group\.allowedActions\.includes\(action\)/);
  for (const action of ['add_file', 'detach_file', 'close']) {
    assert.match(source, new RegExp(`may\\('${action}'\\)`), `${action} is not gated by the server`);
  }
  // A read-only account is told so, instead of being shown buttons that 403.
  assert.match(source, /expenses\.capture\.read_only/);
});

test('mobile first: one column, 18px Thai body, 44px controls', () => {
  assert.match(source, /className="flex flex-col gap-4 text-lg leading-8 text-gray-800"/);
  assert.doesNotMatch(source, /overflow-x-auto|whitespace-nowrap|min-w-\[/, 'no horizontal scroll at 390px');
  assert.doesNotMatch(source, /grid-cols-2|md:grid-cols/, 'the page stays a single column');
  const buttons = source.match(/<button[\s\S]{0,200}?>/g) ?? [];
  assert.ok(buttons.length >= 4, 'the page has its actions');
  for (const button of buttons) {
    assert.match(button, /min-h-11/, `a control below 44px: ${button.slice(0, 80)}`);
  }
});

test('the W04 slots exist and render nothing yet', () => {
  assert.match(source, /export function CaptureFactsSection[\s\S]{0,120}return null;/);
  assert.match(source, /export function CaptureAllocationSection[\s\S]{0,120}return null;/);
  assert.match(source, /<CaptureFactsSection group=\{group\} \/>/);
  assert.match(source, /<CaptureAllocationSection group=\{group\} \/>/);
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
  assert.doesNotMatch(source, /อ่านเอกสารอีกครั้ง|อ่านใหม่/);
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

test('403 and a load failure get the shared states, not a blank page', () => {
  assert.match(source, /<ForbiddenState locale=\{locale\} \/>/);
  assert.match(source, /<ErrorState locale=\{locale\}/);
});
