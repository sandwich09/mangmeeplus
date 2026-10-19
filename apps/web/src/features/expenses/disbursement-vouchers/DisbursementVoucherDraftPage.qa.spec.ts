import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./DisbursementVoucherDraftPage.tsx');
const payees = read('./DisbursementVoucherPayeePicker.tsx');
const expenses = read('./DisbursementVoucherExpensePicker.tsx');
const css = read('./disbursement-voucher-form.module.css');
const route = read('../../../../app/(workspace)/companies/[companyId]/expenses/disbursement-vouchers/new/page.tsx');

test('steps run who then what then details and Back changes only the step', () => {
  assert.match(page, /<ThemedSteps steps=\{\(\['who', 'what', 'details'\] as const\).map/);
  assert.match(page, /index === step \? 'current' : index < step \? 'done' : 'upcoming'/);
  const bar = page.slice(page.indexOf('data-testid="disbursement-draft-bottom-bar"'));
  assert.match(bar, /<ActionGroup>[\s\S]*setStep\(previous => previous - 1\)/);
  assert.doesNotMatch(page, /create_progress/);
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
  assert.match(page, /available\.filter\(row => row\.payeeKey === first\.payeeKey && row\.selectable\)/);
  // A reopened draft drops saved lines that can no longer be paid, says which, and saves the removal next time.
  assert.match(page, /row\.expenseId === line\.expenseId && row\.selectable/);
  assert.match(page, /เอาออก \{droppedLines\.length\} รายการที่จ่ายไม่ได้แล้ว/);
  assert.match(page, /setDirty\(Boolean\(!detail\) \|\| dropped\.length > 0\)/);
  assert.match(page, /entry!\.selectable \? \{ \[entry!\.expenseId\]: initialAmount/);
  assert.match(page, /expectedVersion: version/);
  assert.match(page, /detail\.header\.note \?\? ''/);
});
test('server-fed payee search is debounced, paged and uses whole-row touch targets instead of a select', () => {
  assert.match(payees, /listDisbursementPayees\(companyId, \{ search, page, pageSize: 10 \}\)/);
  assert.match(payees, /window\.setTimeout/);
  assert.match(payees, /}, 300\)/);
  assert.match(payees, /<Pagination prominent page=\{page\} totalPages=\{totalPages\} onPageChange=\{setPage\}/);
  assert.doesNotMatch(payees, /load_more|setRows/);
  assert.match(css, /\.payeeRow[^}]*min-height: 44px/);
  assert.doesNotMatch(payees, /<select|<SelectField|searchable/);
});
test('payee cases show nothing, a warning, or a dialog confirmation that gates Next', () => {
  assert.match(page, /rule === 'warning' && <p[\s\S]*?same_name_warning/);
  // The add press is the confirmation; its sentence sits in the footer, which never scrolls away.
  assert.doesNotMatch(expenses, /disbursement-payee-confirm|need_confirm/);
  assert.match(expenses, /setRows\(data\.filter\(row => row\.selectable && !excludeIds/); // owner 2026-10-15: a bill that cannot be paid is not offered
  assert.match(expenses, /footer=\{<div className=\{styles.stack\}>[\s\S]*?confirm_payee/);
  assert.match(page, /rule === 'confirm' && !fields.payeeConfirmed\) \{ setStep\(1\); setOtherOpen\(true\)/); // the shared 44-px tick row
  assert.match(page, /rule !== 'confirm' \|\| fields\.payeeConfirmed/);
  assert.match(page, /disbursement_payee_confirmation_required'\) \{ setForceConfirmation\(true\); setStep\(1\)/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.same_name_warning'], 'รายการเหล่านี้ไม่มีเลขผู้เสียภาษี ระบบรวมให้เพราะชื่อร้านตรงกัน ตรวจว่าเป็นร้านเดียวกัน');
  assert.equal(workspaceDictionary.th['expenses.disbursement.confirm_payee'], 'บิลที่เลือกจ่ายให้ {name} รายเดียวกัน');
});
test('the bottom bar counts and totals selected rows with one fixed full-width primary button', () => {
  const bar = page.slice(page.indexOf('<div className={styles.bottomBar}'), page.indexOf('{pendingPayee &&'));
  assert.match(bar, /Object\.keys\(amounts\)\.length/);
  assert.match(bar, /amountText\(total\)/);
  // One filled button, last in the bar's one group: the shared group gives the buttons one size (a row when the names fit, the acting one on top when they stack).
  assert.equal([...bar.matchAll(/className=\{btnClass\}/g)].length, 1);
  assert.match(bar, /<ActionGroup>[\s\S]*?save_draft[\s\S]*?className=\{btnClass\}[\s\S]*?<\/ActionGroup>/);
  assert.match(bar, /if \(validateSelection\(\)\) setStep\(2\)/);
  assert.match(css, /\.bottomBar[^}]*position: fixed;[^}]*bottom: 0/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /\.primary /);
  assert.doesNotMatch(page + css, /100v[h]|h[-]screen|requestId=/);
});
test('amount errors sit by the box, unavailable rows show server reasons, and other expenses use a guarded sheet', () => {
  assert.match(expenses, /error=\{error \?\? undefined\}/);
  assert.match(expenses, /disabled=\{disabled \|\| !row\.selectable\}/);
  assert.match(expenses, /disbursementExpenseReasonMessage\(row\.reasonCode/);
  assert.match(expenses, /หัก ณ ที่จ่ายไว้แล้ว/);
  assert.match(expenses, /<Modal open[\s\S]*?closeOnBackdrop=\{false\}/);
  assert.match(expenses, /row\.vendorName\.trim\(\) !== payeeName\?\.trim\(\)/);
});
test('saving locks duplicate presses, retains fields on failure and exposes a reload for a stale version', () => {
  assert.match(page, /if \(saveLock\.current\) return false/);
  assert.match(page, /nextDraftCommand\(command\.current, false/);
  const refusal = page.slice(page.indexOf('    } catch (failure) {\n      setSaveError'), page.indexOf('  const navigation ='));
  assert.doesNotMatch(refusal, /setFields|setAmounts|setRows/);
  assert.match(refusal, /disbursement_version_conflict'\) setStale\(true\)/);
  assert.match(page, /stale && <button[\s\S]*?setReload/);
  assert.match(page, /toast\.success\(t\('expenses\.disbursement\.saved_draft'/);
  assert.doesNotMatch(page, /bankAccount|recipientAccount|submitDisbursement|approveDisbursement|payDisbursement/);
});

test('the final create step sends after saving, keeps draft save secondary, and reuses the document command dialog', () => {
  const bottom = page.slice(page.indexOf('<div className={styles.bottomBar}'), page.indexOf('{pendingPayee &&'));
  assert.match(bottom, /draftId \|\| payee && selectedRows.length > 0[\s\S]*?save_draft/);
  assert.match(bottom, /sendAfterSave\(\)/);
  assert.match(page, /await save\(false, false\)/);
  assert.match(page, /getDisbursementVoucher\(companyId, savedId\)/);
  assert.match(page, /detail\.actions\.submitAndApprove \? sendChoice : 'submit'/);
  assert.match(page, /<DisbursementVoucherCommandDialog/);
  assert.match(page, /onSuccess=\{\(\) => router\.push\(`/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.send_to_approver'], 'ส่งให้ผู้อนุมัติ');
});


test('session refresh keeps the loaded draft form and permission loss still renders the leave dialog', () => {
  assert.match(page, /if \(loadedContext\.current === context\) return/);
  assert.match(page, /canPrepare && \(entryOpen \|\| Boolean\(draftId\)\)/);
  assert.match(page, /if \(!canPrepare\) return <>.*?<ForbiddenState titleAs="h1" \/>.*?navigation\.dialog/);
});


test('an empty search uses existing no-result copy rather than claiming the shop has no outstanding expenses', () => {
  assert.match(payees, /search\.trim\(\) \? 'list\.no_results' : 'expenses\.disbursement\.empty_payees'/);
  assert.match(payees, /description=\{search\.trim\(\) \|\| excludedCount > 0 \? ''/);
  assert.match(expenses, /search\.trim\(\) \? 'list\.no_results' : 'expenses\.disbursement\.empty_payees'/);
});

test('planned date uses the clearable Thai picker and keeps civil-date save values', () => {
  assert.match(page, /<ThemedDate id="disbursement-planned-date" name="plannedPayDate"[^>]*allowClear value=\{fields.plannedPayDate\}/);
  assert.match(page, /onChange=\{event => changeFields\(\{ plannedPayDate: event.target.value \}\)\}/);
  assert.match(page, /fields.plannedPayDate \? \{ plannedPayDate: fields.plannedPayDate \} : \{\}/);
  assert.doesNotMatch(page, /type="date"/);
  assert.match(page, /htmlFor="disbursement-planned-date"/);
  assert.doesNotMatch(page, /disbursement-planned-date-hint/);
});
test('planned payment method uses the same plain words in the form and document, with a named optional choice', () => {
  assert.equal(workspaceDictionary.th['expenses.disbursement.planned_method'], 'วิธีที่จะจ่าย');
  assert.equal(workspaceDictionary.th['expenses.disbursement.planned_method_unspecified'], 'ยังไม่ระบุ');
  assert.match(page, /<option value="">\{t\('expenses.disbursement.planned_method_unspecified', 'th'\)\}/);
  const detail = read('./DisbursementVoucherDocumentPage.tsx');
  assert.match(detail, /header.plannedMethod && <div><dt>วิธีที่จะจ่าย<\/dt><dd>\{PAYMENT_METHOD_LABELS\[header.plannedMethod\]/);
  assert.equal(workspaceDictionary.th['expenses.disbursement.paid_method'], 'วิธีจ่าย');
});

test('expense entry can start at details while back still opens selection and the step bar stays complete', () => {
  assert.match(page, /setStep\(!detail && skipSingleExpenseSelection\(entry, group\) \? 2 : first \? 1 : 0\)/);
  assert.match(page, /setStep\(previous => previous - 1\)/);
});

test('date labels and controls use the same flex gap and shared input height as their neighbouring fields', () => {
  assert.match(page, /<div className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">\s*<label htmlFor="disbursement-planned-date"/);
  assert.match(page, /<ThemedDate id="disbursement-planned-date"[^>]*className=\{inputClass\}/);
  assert.match(read('./disbursement-vouchers.module.css'), /\.payDate \{ display: flex; flex-direction: column; gap: \.375rem;/);
  assert.match(read('./DisbursementVoucherPayCard.tsx'), /<ThemedDate id="disbursement-paid-date"[^>]*className=\{inputClass\}/);
});

test('owner concept removes step-one Next, confirms a payee change, and focuses selection instead of a dead Next', () => {
  assert.match(page, /className=\{cx\('mangmee-flat', styles.page\)\}/);
  assert.match(page, /onChoose=\{requestPayee\}/);
  assert.match(page, /chosen.payeeKey !== payee.payeeKey && Object.keys\(amounts\).length/);
  assert.match(page, /title="เปลี่ยนผู้รับเงิน รายการที่เลือกไว้จะถูกล้าง"/);
  assert.match(page, />ไม่เปลี่ยน</); assert.match(page, />เปลี่ยน</);
  assert.match(page, /step > 0 && <button type="button" className=\{btnClass\}/);
  assert.match(page, /focusMissing\(1, 'disbursement-expenses', 'เลือกอย่างน้อย 1 รายการ'\)/);
  assert.match(page, /focusExpenseField\(document.getElementById\(id\)\)/);
  assert.match(page, /<FormActionBar/);
  assert.match(page, /<MetricGrid columns=/);
  assert.match(page, /\['', 'BANK_TRANSFER'\].includes\(fields.plannedMethod\) && <div id="disbursement-account"/);
  assert.match(page, /แก้ไขใบเตรียมจ่าย/);
  assert.match(page, /getDisbursementPayeeAccount\(companyId, payee.payeeKey, lockedBranch/);
  assert.match(page, /previous.payeeAccountCleared \|\| previous.payeeAccountNumber \|\| previous.payeeAccountLast4 \|\| previous.payeeBankName \|\| previous.payeeAccountName \? previous/);
});
