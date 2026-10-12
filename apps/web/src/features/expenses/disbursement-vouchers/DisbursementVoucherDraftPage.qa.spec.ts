import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { disbursementVoucherSteps } from './disbursement-voucher-journey.logic';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./DisbursementVoucherDraftPage.tsx');
const payees = read('./DisbursementVoucherPayeePicker.tsx');
const expenses = read('./DisbursementVoucherExpensePicker.tsx');
const css = read('./disbursement-voucher-form.module.css');
const route = read('../../../../app/(workspace)/companies/[companyId]/expenses/disbursement-vouchers/new/page.tsx');

test('steps run who then what then details and Back changes only the step', () => {
  assert.deepEqual(disbursementVoucherSteps('DRAFT').map(step => [step.label, step.state]), [['เลือกรายการ', 'current'], ['อนุมัติ', 'upcoming'], ['จ่าย', 'upcoming'], ['ใบสำคัญจ่าย', 'upcoming']]);
  assert.match(page, /<ThemedSteps steps=\{disbursementVoucherSteps\('DRAFT'\)\}/);
  assert.match(page, /create_progress/);
  assert.doesNotMatch(page, /buildDisbursementDraftSteps|ThemedSteps steps=\{[^}]*step\)/);
  assert.match(page, /onClick=\{\(\) => setStep\(previous => previous - 1\)\}/);
  assert.match(page, /step === 0 \?[\s\S]+step === 1 \?/);
});
test('prepare is required and the hidden-menu card makes no source request except to validate a named draft', () => {
  assert.match(page, /canPrepareDisbursementVoucher\(permissions\)/);
  assert.match(page, /if \(!canPrepare\) return <><ForbiddenState/);
  assert.match(page, /if \(!canPrepare \|\| !entryOpen && !draftId\) return/);
  assert.match(page, /detail\.header\.status !== 'DRAFT' \|\| !detail\.actions\.edit/);
  assert.match(page, /if \(!entryOpen && !draftId/);
  assert.match(route, /disbursementVoucherWebEntry === true/);
  assert.match(route, /draftId=\{typeof query\.draft === 'string'[\s\S]*expenseId=\{typeof query\.expenseId === 'string'/);
  assert.doesNotMatch(route, /canOpenDisbursementVoucherWeb|redirect\(/);
});
test('expense entry picks its server group and the expense while edits restore version and typed fields', () => {
  assert.match(page, /available\.find\(row => row\.expenseId === expenseId\)/);
  assert.match(page, /available\.filter\(row => row\.payeeKey === key\)/);
  assert.match(page, /entry!\.selectable \? \{ \[entry!\.expenseId\]: initialAmount/);
  assert.match(page, /expectedVersion: version/);
  assert.match(page, /detail\.header\.note \?\? ''/);
});
test('server-fed payee search is debounced, paged and uses whole-row touch targets instead of a select', () => {
  assert.match(payees, /listDisbursementPayees\(companyId, \{ search, page, pageSize: 20 \}\)/);
  assert.match(payees, /window\.setTimeout/);
  assert.match(payees, /}, 300\)/);
  assert.match(payees, /setPage\(value => value \+ 1\)/);
  assert.match(css, /\.payeeRow[^}]*min-height: 44px/);
  assert.doesNotMatch(payees, /<select|<SelectField|searchable/);
});
test('payee cases show nothing, a warning, or a confirmation tick that gates Next', () => {
  assert.match(page, /rule === 'warning' && <p[\s\S]*?same_name_warning/);
  assert.match(page, /rule === 'confirm' && <label[\s\S]*?type="checkbox"/);
  assert.match(page, /rule !== 'confirm' \|\| fields\.payeeConfirmed/);
  assert.match(page, /disbursement_payee_confirmation_required'\) \{ setForceConfirmation\(true\); setStep\(1\)/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.same_name_warning'], 'รายการเหล่านี้ไม่มีเลขผู้เสียภาษี ระบบรวมให้เพราะชื่อร้านตรงกัน โปรดตรวจว่าเป็นร้านเดียวกัน');
  assert.equal(workspaceDictionary.th['expenses.disbursement.confirm_payee'], 'รายการที่เลือกมีชื่อหรือเลขผู้เสียภาษีของผู้ขายไม่ตรงกัน ติ๊กเพื่อยืนยันว่าทั้งหมดจ่ายให้ผู้รับเงินรายเดียวกัน');
});
test('the bottom bar counts and totals selected rows with one fixed full-width primary button', () => {
  const bar = page.slice(page.indexOf('<div className={styles.bottomBar}'), page.indexOf('{otherOpen &&'));
  assert.match(bar, /Object\.keys\(amounts\)\.length/);
  assert.match(bar, /baht\(total\)/);
  assert.equal([...bar.matchAll(/cx\(btnClass, styles\.primary\)/g)].length, 1);
  assert.match(bar, /step === 1 \? !validSelection : !canSave/);
  assert.match(css, /\.bottomBar[^}]*position: fixed;[^}]*bottom: 0/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.primary[^}]*width: 100%;[^}]*min-height: 44px/);
  assert.doesNotMatch(page + css, /100v[h]|h[-]screen|requestId=/);
});
test('amount errors sit by the box, unavailable rows show server reasons, and other expenses use a guarded sheet', () => {
  assert.match(expenses, /error=\{error \?\? undefined\}/);
  assert.match(expenses, /disabled=\{disabled \|\| !row\.selectable\}/);
  assert.match(expenses, /disbursementExpenseReasonMessage\(row\.reasonCode/);
  assert.match(expenses, /expenses\.disbursement\.wht_hint/);
  assert.match(expenses, /<Modal open[\s\S]*?closeOnBackdrop=\{false\}/);
  assert.match(expenses, /row\.vendorName\.trim\(\) !== payeeName\?\.trim\(\)/);
});
test('saving locks duplicate presses, retains fields on failure and exposes a reload for a stale version', () => {
  assert.match(page, /if \(!canSave \|\| saveLock\.current\) return false/);
  assert.match(page, /nextDraftCommand\(command\.current, false/);
  const refusal = page.slice(page.indexOf('    } catch (failure) {\n      setSaveError'), page.indexOf('  const navigation ='));
  assert.doesNotMatch(refusal, /setFields|setAmounts|setRows/);
  assert.match(refusal, /disbursement_version_conflict'\) setStale\(true\)/);
  assert.match(page, /stale && <button[\s\S]*?setReload/);
  assert.match(page, /toast\.success\(t\('expenses\.disbursement\.saved_draft'/);
  assert.doesNotMatch(page, /bankAccount|recipientAccount|submitDisbursement|approveDisbursement|payDisbursement/);
});

test('the final create step sends after saving, keeps draft save secondary, and reuses the document command dialog', () => {
  const bottom = page.slice(page.indexOf('<div className={styles.bottomBar}'), page.indexOf('{otherOpen &&'));
  assert.match(bottom, /step === 2 && <button[\s\S]*?save_draft/);
  assert.match(bottom, /sendAfterSave\(\)/);
  assert.match(page, /await save\(false, false\)/);
  assert.match(page, /getDisbursementVoucher\(companyId, savedId\)/);
  assert.match(page, /detail\.actions\.submitAndApprove \? 'selfApprove' : 'submit'/);
  assert.match(page, /<DisbursementVoucherCommandDialog/);
  assert.match(page, /onSuccess=\{\(\) => router\.push\(`/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.send_to_approver'], 'ส่งให้ผู้อนุมัติ');
});


test('session refresh keeps the loaded draft form and permission loss still renders the leave dialog', () => {
  assert.match(page, /if \(loadedContext\.current === context\) return/);
  assert.match(page, /canPrepare && \(entryOpen \|\| Boolean\(draftId\)\)/);
  assert.match(page, /if \(!canPrepare\) return <>.*?<ForbiddenState \/>.*?navigation\.dialog/);
});


test('an empty search uses existing no-result copy rather than claiming the shop has no outstanding expenses', () => {
  assert.match(payees, /search\.trim\(\) \? 'list\.no_results' : 'expenses\.disbursement\.empty_payees'/);
  assert.match(payees, /description=\{search\.trim\(\) \? ''/);
  assert.match(expenses, /search\.trim\(\) \? 'list\.no_results' : 'expenses\.disbursement\.empty_payees'/);
});

test('planned date uses the clearable Thai picker and keeps civil-date save values', () => {
  assert.match(page, /<ThemedDate id="disbursement-planned-date" name="plannedPayDate"[^>]*allowClear value=\{fields.plannedPayDate\}/);
  assert.match(page, /onChange=\{event => changeFields\(\{ plannedPayDate: event.target.value \}\)\}/);
  assert.match(page, /fields.plannedPayDate \? \{ plannedPayDate: fields.plannedPayDate \} : \{\}/);
  assert.doesNotMatch(page, /type="date"/);
  assert.match(page, /htmlFor="disbursement-planned-date"/);
  assert.match(page, /aria-describedby="disbursement-planned-date-hint"/);
});
test('planned payment method uses the same plain words in the form and document, with a named optional choice', () => {
  assert.equal(workspaceDictionary.th['expenses.disbursement.planned_method'], 'วิธีที่จะจ่าย');
  assert.equal(workspaceDictionary.th['expenses.disbursement.planned_method_unspecified'], 'ยังไม่ระบุ');
  assert.match(page, /<option value="">\{t\('expenses.disbursement.planned_method_unspecified', 'th'\)\}/);
  const detail = read('./DisbursementVoucherDocumentPage.tsx');
  assert.match(detail, /header.plannedMethod && <div><dt>\{t\('expenses.disbursement.planned_method', 'th'\)\}/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.paid_method'], 'วิธีจ่าย');
});
