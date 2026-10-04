import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as model from './expenses.model';
import type { ExpenseDraftReviewValues } from './expenses.model';
import { EXPENSE_REVIEW_STEP_WORDS, EXPENSE_WITHHOLDING_WORDS, type ExpenseWhtInput } from '@watchdog-bms/contracts';
import { validateExpenseReview } from './expense-review-validation';
import { workspaceDictionary } from '../../common/i18n/workspace-dictionary';
import { apiErrorMessage } from '../../common/api/api-error-message';

const source = readFileSync(new URL('./ExpensesPages.tsx', import.meta.url), 'utf8');
const edit = source.slice(source.indexOf('export function ExpenseReviewEditSection'), source.indexOf('// ── Detail (popup dialog)'));
const block = edit.slice(edit.indexOf('<fieldset data-testid="expense-withholding"'), edit.indexOf('</fieldset>', edit.indexOf('<fieldset data-testid="expense-withholding"')));
const words = workspaceDictionary.th as Record<string, string>;
const changeInput = (values: ExpenseDraftReviewValues, input: ExpenseWhtInput) => {
  const change = (model as unknown as { changeExpenseReviewWhtInput?: (v: ExpenseDraftReviewValues, i: ExpenseWhtInput) => ExpenseDraftReviewValues }).changeExpenseReviewWhtInput;
  assert.equal(typeof change, 'function', 'the UI needs a tested blank/clear transition');
  return change!(values, input);
};
const values = (): ExpenseDraftReviewValues => ({
  vendorNameSnapshot: 'ร้านทดสอบ', vendorTaxIdSnapshot: '', vendorAddressSnapshot: '', vendorBranchCodeSnapshot: '',
  vendorDocumentNumber: '1', expenseDate: '2026-10-04', vatMode: 'NO_VAT',
  lines: [{ description: 'ค่าบริการ', quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '',
    whtRate: '0.03', expenseCategoryId: null, accountHintKey: null, taxCategory: null }],
});

test('one phone-order block gates payee/category/unit/value/base/amount behind the withholding choice', () => {
  assert.ok(block, 'the whole withholding form is one fieldset');
  const fields = ['expenses.wht_choice', '{withholdingEnabled && (', 'expenses.payee_entity_kind',
    'expenses.wht_income_category', 'expenses.wht_input_unit', 'expense-wht-rate-', 'expenses.wht_base', 'expenses.wht'];
  let previous = -1;
  for (const field of fields) {
    const at = field === 'expenses.wht' ? block.lastIndexOf("t('expenses.wht',") : block.indexOf(field);
    assert.ok(at > previous, `${field} follows the previous field`);
    previous = at;
  }
  const outside = edit.replace(block, '');
  for (const key of ['expenses.payee_entity_kind', 'expenses.wht_income_category', 'expenses.wht_input_unit', 'expense-wht-rate-']) {
    assert.equal(outside.includes(key), false, `${key} appears only in the block`);
  }
  assert.doesNotMatch(block, /grid-cols-2/, 'withholding reads top to bottom at every width');
  assert.match(edit, /useState\(\(\) => expenseReviewWithholdsTax\(reviewValues\(detail\), detail.whtAmount\)\)/);
  assert.match(edit, /setWithholdingEnabled\(expenseReviewWithholdsTax\(reviewValues\(detail\), detail.whtAmount\)\)/, 'reload resets the choice from saved facts');
  assert.match(block, /disabled=\{!isMutable \|\| busy\}/, 'the read-only variant disables editing');
});

test('clearing either unit overrides old totals/rates, removes every withholding issue and sends explicit zero', () => {
  for (const inputType of ['RATE', 'AMOUNT'] as const) {
    for (const value of ['', '  ']) {
      const before = { ...values(), whtInput: { inputType, value: '3', baseAmount: '-1' } };
      assert.ok(validateExpenseReview(before, { today: '2026-10-04', whtAmount: '3' }).length > 0);
      const after = changeInput(before, { inputType, value });
      assert.equal(model.expenseReviewWithholdsTax(after, '3'), false);
      assert.deepEqual(validateExpenseReview(after, { today: '2026-10-04', whtAmount: '3' }), []);
      const payload = model.buildExpenseDraftReviewPayload(after);
      assert.deepEqual(payload.whtInput, { inputType, value: '0' });
      assert.ok(payload.lines!.every((line) => !('whtRate' in line)));
    }
  }
  // R1: only the หัก/ไม่หัก control changes the decision. Clearing the value used to flip it to ไม่หัก
  // mid-typing, hiding the block and dropping focus (owner report 2026-10-05).
  assert.equal((block.match(/setWithholdingEnabled\(/g) ?? []).length, 1);
  assert.doesNotMatch(block, /setWithholdingEnabled\(false\)/);
});

test('R2: only digits and one point are typed; leaving the field tidies a leading zero instead of refusing it', () => {
  assert.equal(model.sanitizeExpenseWhtTyping('-1'), '1');
  assert.equal(model.sanitizeExpenseWhtTyping('3a.5.2'), '3.52');
  for (const [typed, tidy] of [['03', '3'], ['00.5', '0.5'], ['.5', '0.5'], ['3.', '3'], ['0', '0'], ['', ''], ['10', '10']] as const) {
    assert.equal(model.normalizeExpenseWhtValue(typed), tidy, typed);
  }
  const typing = { ...values(), vendorEntityKindSnapshot: 'JURISTIC' as const, whtCategoryCode: 'SERVICE', whtInput: { inputType: 'RATE' as const, value: '03' } };
  assert.deepEqual(validateExpenseReview(typing, { today: '2026-10-04', withholdingChosen: true }), [], '"03" is 3 being typed, not an error');
  assert.deepEqual(model.buildExpenseDraftReviewPayload(typing).whtInput, { inputType: 'RATE', value: '3' });
  assert.match(block, /type="text"\s+inputMode="decimal"/);
  assert.match(block, /sanitizeExpenseWhtTyping\(event\.target\.value\)/);
  assert.match(block, /onBlur=\{\(\) => \{\s*setWhtValueFocused\(false\); setWhtReveal\(true\);[\s\S]*?normalizeExpenseWhtValue/);
  assert.match(edit, /whtValueTyping && issue\.field === 'whtInput\.value'/, 'an empty value is not red while it is being typed');
});

test('R3: หัก with a missing payee type, category or value is refused in block order and names the way out; 0 stays valid', () => {
  const chosen = (v: ExpenseDraftReviewValues) => validateExpenseReview(v, { today: '2026-10-04', withholdingChosen: true }).map((issue) => issue.field);
  const empty = { ...values(), whtInput: { inputType: 'RATE' as const, value: '' } };
  assert.deepEqual(chosen(empty), ['vendorEntityKindSnapshot', 'whtCategoryCode', 'whtInput.value']);
  assert.deepEqual(chosen({ ...empty, vendorEntityKindSnapshot: 'JURISTIC' }), ['whtCategoryCode', 'whtInput.value']);
  assert.deepEqual(chosen({ ...empty, vendorEntityKindSnapshot: 'JURISTIC', whtCategoryCode: 'SERVICE' }), ['whtInput.value']);
  assert.deepEqual(chosen({ ...empty, vendorEntityKindSnapshot: 'JURISTIC', whtCategoryCode: 'SERVICE', whtInput: { inputType: 'RATE', value: '0' } }), []);
  assert.deepEqual(validateExpenseReview(changeInput(empty, { inputType: 'RATE', value: '' }), { today: '2026-10-04', withholdingChosen: false }), [], 'ไม่หัก asks for none of it');
  assert.match(edit, /if \(whtHiddenError\) \{\s*setWhtReveal\(true\);[\s\S]*?return false;/, 'ถัดไป stays on the step instead of saving ไม่หัก');
  assert.equal(EXPENSE_WITHHOLDING_WORDS.wayOut(words['expenses.wht_no']!), 'เลือก “ไม่หัก” ถ้ารายการนี้ไม่ต้องหัก ณ ที่จ่าย');
  assert.equal((block.match(/\{whtWayOut\(/g) ?? []).length, 3, 'beside each field that can be the first missing one');
  assert.match(edit, /issue\.field === whtMissing\[0\]/, 'but printed once');
  assert.match(edit, /whtMissing\.indexOf\(issue\.field\) > 0/, 'only the first missing field is said: picking a category fills the rate');
});

test('R4 and R5: choosing หัก starts clean, and the footer and totals card only point to a withholding problem', () => {
  assert.match(block, /else setValues\(\(current\) => \(\{ \.\.\.current, whtInput: \{ inputType: 'RATE', value: '' \} \}\)\)/, 'empty, never the "0" that ไม่หัก stored');
  assert.match(block, /setWhtReveal\(!enabled\)/, 'no red until the reviewer leaves a field or presses ถัดไป');
  assert.match(edit, /firstBlockingIsWht \? null : firstBlockingMessage/);
  assert.match(edit, /useExpenseReviewTotals\([\s\S]*?blockingPointer, totalsRetry/);
});

test('choosing no withholding clears category/rate/base/legacy rates and issues while keeping the vendor snapshot', () => {
  const before = { ...values(), vendorEntityKindSnapshot: 'JURISTIC' as const, whtCategoryCode: 'SERVICE', whtRate: '3',
    whtInput: { inputType: 'AMOUNT' as const, value: '300', baseAmount: '-1' } };
  const after = changeInput(before, { inputType: 'RATE', value: '' });
  assert.deepEqual(after.whtInput, { inputType: 'RATE', value: '0' });
  assert.equal(after.whtCategoryCode, '');
  assert.equal(after.whtRate, '');
  assert.ok(after.lines.every((line) => line.whtRate === null));
  assert.equal(after.vendorEntityKindSnapshot, 'JURISTIC');
  assert.deepEqual(validateExpenseReview(after, { today: '2026-10-04', whtAmount: '3' }), []);
  assert.equal(model.buildExpenseDraftReviewPayload(after).whtCategoryCode, '');
  assert.equal(model.buildExpenseDraftReviewPayload(after).whtRate, '0', 'clear persisted certificate metadata as well as the computed amount');
  assert.match(block, /if \(!enabled\)[\s\S]*changeExpenseReviewWhtInput\(current, \{ inputType: 'RATE', value: '' \}\)/);
  assert.match(block, /setError\(null\)/, 'a failed save must not leave an old withholding error');
});

test('choosing a category fills the actual percent input as well as certificate metadata', () => {
  assert.match(block, /whtInput: \{ inputType: 'RATE', value: rate/);
  assert.match(block, /whtCategoryCode: code, whtRate: rate/);
});

test('totals preview omits certificate classification fields rejected by the existing DTO', () => {
  const hook = readFileSync(new URL('./useExpenseReviewTotals.ts', import.meta.url), 'utf8');
  const removed = hook.slice(hook.indexOf('const {'), hook.indexOf('...reviewPayload }'));
  assert.match(removed, /whtCategoryCode: _whtCategory/);
  assert.match(removed, /whtRate: _whtRate/);
  assert.doesNotMatch(removed, /whtInput:/, 'the actual withholding money input still reaches the calculator');
  const dto = readFileSync(new URL('../../../../api/src/modules/expenses/presentation/http/expense.dtos.ts', import.meta.url), 'utf8');
  const preview = dto.slice(dto.indexOf('export class ExpenseTotalsPreviewDto'), dto.indexOf('/** Shared upload-intent'));
  assert.doesNotMatch(preview, /whtCategoryCode|whtRate/);
  assert.match(preview, /whtInput\?: ExpenseWhtInput/);
});

test('typing zero before a decimal keeps the chosen category and base for a fractional rate or amount', () => {
  for (const inputType of ['RATE', 'AMOUNT'] as const) {
    const before = { ...values(), vendorEntityKindSnapshot: 'JURISTIC' as const, whtCategoryCode: 'SERVICE', whtRate: '3' };
    const zero = changeInput(before, { inputType, value: '0', baseAmount: '100' });
    assert.equal(zero.whtCategoryCode, 'SERVICE');
    assert.equal(zero.whtInput?.baseAmount, '100');
    const fraction = changeInput(zero, { inputType, value: '0.5', baseAmount: '100' });
    assert.equal(model.expenseReviewWithholdsTax(fraction), true);
    assert.deepEqual(validateExpenseReview(fraction, { today: '2026-10-04' }), []);
  }
  assert.doesNotMatch(block, /Number\(value\) === 0\) setWithholdingEnabled\(false\)/);
});

test('empty, loading and failed catalogs have distinct shared Thai guidance for editable and read-only views', () => {
  const empty = words['expenses.wht_categories_empty'];
  assert.ok(empty, 'empty catalog has an explanation');
  assert.match(empty, /ยังไม่มีประเภทเงินได้ที่เปิดใช้/);
  assert.match(empty, /ติดต่อทีมมั่งมี/);
  for (const key of ['expenses.wht_categories_empty', 'expenses.wht_categories_loading', 'expenses.wht_categories_failed']) {
    assert.ok(words[key]);
    assert.doesNotMatch(words[key]!, /[A-Za-z]/);
    assert.ok(block.includes(key), `${key} appears in the same block, including read-only`);
  }
  assert.match(block, /whtCategoriesState === 'ready'.*applicableWhtCategories.length === 0/);
  assert.match(edit, /setWhtCategoriesState\('error'\)/);
  assert.doesNotMatch(block, /isMutable &&[^\n]*wht_categories/, 'guidance is also visible without edit permission');
});

test('a saved category outside the current catalog displays a Thai label instead of its code', () => {
  assert.equal(words['expenses.wht_category_recorded'], 'ประเภทเงินได้ที่บันทึกไว้');
  assert.match(block, /!isMutable && values.whtCategoryCode && !applicableWhtCategories.some/);
  assert.match(block, /<option value=\{values.whtCategoryCode\}>\{t\('expenses.wht_category_recorded', locale\)\}/);
  assert.match(block, /const picked = applicableWhtCategories.find\([\s\S]*?if \(!picked\) return;/, 're-selecting the recorded fallback must not replace its amount with an invented rate');
});

test('withholding hints explain optional blanks and the actual base without English tokens', () => {
  assert.doesNotMatch(words['expenses.wht_base_hint']!, /[A-Za-z]/);
  assert.equal((workspaceDictionary.en as Record<string, string>)['expenses.wht_base_hint'], words['expenses.wht_base_hint'], 'employee guidance has one Thai wording source in either workspace locale');
  // A blank value is refused while หัก is chosen, so the value hints no longer promise "เว้นว่าง … เพื่อไม่หัก".
  for (const hint of [EXPENSE_WITHHOLDING_WORDS.percentHint, EXPENSE_WITHHOLDING_WORDS.amountHint]) {
    assert.doesNotMatch(hint, /[A-Za-z]|เว้นว่าง/);
    assert.match(hint, /ฐานหัก/);
  }
  assert.match(block, /EXPENSE_WITHHOLDING_WORDS\.amountHint : EXPENSE_WITHHOLDING_WORDS\.percentHint/);
  assert.doesNotMatch(block, /wht_percent_hint|wht_amount_hint/);
  assert.ok(block.indexOf('EXPENSE_WITHHOLDING_WORDS.percentHint') < block.indexOf("t('expenses.wht_base', locale)"), 'the value hint sits under the value, before the base field');
});

test('all printed certificate labels and stale-state notice share the 50 ทวิ wording source', () => {
  assert.equal(words['wht.print_certificate'], 'พิมพ์เอกสาร 50 ทวิ');
  const review = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  const ap = readFileSync(new URL('../accounts-payable/AccountsPayablePages.tsx', import.meta.url), 'utf8');
  assert.match(review, /t\('wht.print_certificate', locale\)/);
  assert.equal((ap.match(/workspaceDictionary.th\['wht.print_certificate'\]/g) ?? []).length, 2);
  assert.equal(apiErrorMessage({ code: 'wht_handoff_not_issuable' }), words['wht.print_certificate_not_issuable']);
  assert.ok(words['wht.print_certificate_not_issuable']?.includes(words['wht.print_certificate']!));
  const scan = (url: URL): void => {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
      if (entry.isDirectory()) scan(path);
      else if (/\.tsx?$/.test(entry.name)) assert.equal(readFileSync(path, 'utf8').includes('ทวิ' + ' 50'), false, path.pathname);
    }
  };
  scan(new URL('../../', import.meta.url));
});


test('income categories match the payee form and changing type clears an incompatible category', () => {
  const catalog = [
    { code: 'PERSON', nameTh: 'บุคคล', formType: 'PND3', defaultRate: '3' },
    { code: 'COMPANY', nameTh: 'บริษัท', formType: 'PND53', defaultRate: '3' },
  ];
  const filter = (model as any).expenseWhtCategoriesForPayee;
  const change = (model as any).changeExpensePayeeType;
  assert.equal(typeof filter, 'function'); assert.equal(typeof change, 'function');
  assert.deepEqual(filter(catalog, 'INDIVIDUAL').map((c: any) => c.code), ['PERSON']);
  assert.deepEqual(filter(catalog, 'JURISTIC').map((c: any) => c.code), ['COMPANY']);
  assert.deepEqual(filter(catalog, ''), []);
  const before = { ...values(), vendorEntityKindSnapshot: 'INDIVIDUAL', whtCategoryCode: 'PERSON' };
  assert.equal(change(before, 'JURISTIC', catalog).whtCategoryCode, '');
  assert.equal(change(before, 'INDIVIDUAL', catalog).whtCategoryCode, 'PERSON');
  assert.match(block, /changeExpensePayeeType/);
  assert.match(block, /applicableWhtCategories.map/);
  assert.match(block, /applicableWhtCategories.length === 0/);
});

test('the last step names the button actually shown and carries the amounts it asks the reviewer to check', () => {
  const review = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(review, /detail\.status === 'READY_FOR_CONFIRMATION'\s*\? canConfirm \? EXPENSE_REVIEW_STEP_WORDS\.thenConfirm : EXPENSE_REVIEW_STEP_WORDS\.sentAwaitingConfirm\s*: t\(STEP_HELPER_KEYS\[step\], locale\)/);
  assert.equal(EXPENSE_REVIEW_STEP_WORDS.thenConfirm, 'ดูสรุปทั้งหมดอีกครั้ง แล้วยืนยันเอกสาร');
  assert.doesNotMatch(EXPENSE_REVIEW_STEP_WORDS.sentAwaitingConfirm, /ส่งให้ผู้อนุมัติ/, 'already sent: it must not ask to send again');
  assert.match(review, /\{step === 'data' && moneyCard\}/);
  assert.match(review, /\{step === 'review' && moneyCard\}/, 'total, VAT, withholding and the amount to pay are on the last screen');
});
