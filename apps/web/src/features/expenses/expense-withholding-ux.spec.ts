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
  assert.match(edit, /if \(saveIssueCount > 0\) \{[\s\S]*?setValidationRevealed\(true\); setWhtReveal\(true\);[\s\S]*?return false;/, 'ถัดไป stays on the step instead of saving ไม่หัก');
  assert.equal(EXPENSE_WITHHOLDING_WORDS.wayOut(words['expenses.wht_no']!), 'เลือก “ไม่หัก” ถ้ารายการนี้ไม่ต้องหัก ณ ที่จ่าย');
  assert.equal((block.match(/\{whtWayOut\(/g) ?? []).length, 3, 'beside each field that can be the first missing one');
  assert.match(edit, /issue\.field === whtMissing\[0\]/, 'but printed once');
  assert.doesNotMatch(edit, /whtMissing\.indexOf\(issue\.field\) > 0/, 'one Next reveals every missing answer');
});

test('R4 and R5: choosing หัก starts clean, and the footer and totals card only point to a withholding problem', () => {
  assert.match(block, /else setValues\(\(current\) => \(\{ \.\.\.current, whtRemittance: current\.whtRemittance \?\? 'PAYER_FILES', whtInput: \{ inputType: 'RATE', value: '' \} \}\)\)/, 'empty, never the "0" that ไม่หัก stored');
  assert.match(block, /setWhtReveal\(!enabled\)/, 'no red until the reviewer leaves a field or presses ถัดไป');
  assert.match(edit, /onValidationChange\?\.\(validationRevealed \? blockingIssueCount : 0, null\)/);
  assert.match(edit, /useExpenseReviewTotals\([\s\S]*?previewBlocker, totalsRetry/);
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
  assert.match(block, /changeExpenseReviewWhtCategory\(v, code, rate\)/);
  const changed = model.changeExpenseReviewWhtCategory(values(), 'WHT_SERVICE_3', '3');
  assert.equal(changed.whtCategoryCode, 'WHT_SERVICE_3'); assert.equal(changed.whtRate, '3'); assert.equal(changed.whtInput?.value, '3');
});

test('totals preview omits certificate classification fields rejected by the existing DTO', () => {
  const hook = readFileSync(new URL('./useExpenseReviewTotals.ts', import.meta.url), 'utf8');
  const removed = hook.slice(hook.indexOf('const {'), hook.indexOf('...reviewPayload }'));
  assert.match(removed, /whtCategoryCode: _whtCategory/);
  assert.match(removed, /whtRate: _whtRate/);
  assert.match(removed, /whtRemittance: _whtRemittance/);
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
  assert.match(empty, /ยังไม่มีรายการให้เลือก/);
  assert.match(empty, /ติดต่อทีมงานมั่งมี/);
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
  assert.equal(words['expenses.wht_category_recorded'], 'รายการที่จ่ายที่บันทึกไว้');
  assert.match(block, /!isMutable && values.whtCategoryCode && !applicableWhtCategories.some/);
  assert.match(block, /<option value=\{values.whtCategoryCode\}>\{t\('expenses.wht_category_recorded', locale\)\}/);
  assert.match(block, /const picked = applicableWhtCategories.find\([\s\S]*?if \(!picked\) return;/, 're-selecting the recorded fallback must not replace its amount with an invented rate');
});

test('withholding hints explain optional blanks and the actual base without English tokens', () => {
  assert.doesNotMatch(words['expenses.wht_base_hint']!, /[A-Za-z]/);
  assert.equal((workspaceDictionary.en as Record<string, string>)['expenses.wht_base_hint'], words['expenses.wht_base_hint'], 'employee guidance has one Thai wording source in either workspace locale');
  assert.equal(words['expenses.wht_rate_hint'], 'เช่น 3 คือหัก 3%');
  assert.match(block, /t\('expenses.wht_rate_hint', locale\)/);
  assert.doesNotMatch(block, /EXPENSE_WITHHOLDING_WORDS\.(percentHint|amountHint)/);
  assert.ok(block.indexOf("t('expenses.wht_rate_hint', locale)") < block.indexOf("t('expenses.wht_base', locale)"), 'the short rate hint stays beside its input');
});

test('all printed certificate labels and stale-state notice share the 50 ทวิ wording source', () => {
  assert.equal(words['wht.print_certificate'], 'ออกหนังสือรับรอง 50 ทวิ');
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
  assert.match(block, /expenseWhtCategoryOptions\(applicableWhtCategories\).map/);
  assert.match(block, /applicableWhtCategories.length === 0/);
});

test('the last step names the button actually shown and carries the amounts it asks the reviewer to check', () => {
  const review = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(review, /t\(STEP_HELPER_KEYS\[step\]/, 'DETAIL-1 keeps step names and removes the instruction box');
  assert.equal(EXPENSE_REVIEW_STEP_WORDS.thenConfirm, 'ดูสรุปอีกครั้ง แล้วยืนยัน');
  assert.equal(words['expenses.sent_awaiting_confirm'], 'ดูสรุปทั้งหมดอีกครั้ง เอกสารนี้ส่งให้ตรวจแล้ว รอผู้มีสิทธิ์ยืนยัน');
  assert.match(review, /\{step === 'data' && moneyCard\}/);
  assert.match(review, /\{step === 'review' && moneyCard\}/, 'total, VAT, withholding and the amount to pay are on the last screen');
});

test('incomplete withholding answers show a neutral prompt and keep saved amounts without a retry', () => {
  assert.match(edit, /whtMissing\.length > 0\s*\? 'เลือกให้ครบเพื่อคำนวณยอดหัก'/);
  const totals = readFileSync(new URL('./useExpenseReviewTotals.ts', import.meta.url), 'utf8');
  assert.match(totals, /withholdingIncomplete/);
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /currentPreview\.withholdingIncomplete/);
  assert.match(page, /currentPreview\?\.status === 'error' && !currentPreview\.withholdingIncomplete/);
  assert.match(page, /\(calculationPending \|\| calculationError\) && <p className="mt-2 text-xs text-gray-500">ยอดที่บันทึกไว้<\/p>/);
  assert.match(page, /setTotalsRetry\(\(n\) => n \+ 1\)/, 'complete answers still allow retry after a real calculation failure');
});

test('income routes explain the accountant hand-off and keep PND2 choices with individuals', async () => {
  const { whtFilingRouteHint } = await import('@watchdog-bms/contracts');
  const personal = { code: 'WHT_INTEREST', formType: 'PND2', filingRoute: 'SEPARATE_PND2' };
  assert.deepEqual(model.expenseWhtCategoriesForPayee([personal], 'INDIVIDUAL'), [personal]);
  assert.deepEqual(model.expenseWhtCategoriesForPayee([personal], 'JURISTIC'), []);
  assert.equal(whtFilingRouteHint(personal), 'ประเภทนี้ยื่น ภ.ง.ด.2 แยก ไม่อยู่ใน ภ.ง.ด.3');
  assert.equal(whtFilingRouteHint({ code: 'WHT_OTHER_JUR', formType: 'PND53', filingRoute: 'ACCOUNTANT_PREPARES' }), 'บอกผู้ทำบัญชีว่าเป็นเงินได้อะไร ผู้ทำบัญชีต้องจัดทำแบบของเดือนนี้เอง');
  assert.match(whtFilingRouteHint({ code: 'WHT_INTEREST_JUR', formType: 'PND53', filingRoute: 'ACCOUNTANT_PREPARES' })!, /ภ.ง.ด.53/);
  assert.equal(whtFilingRouteHint({ code: 'WHT_PRIZE', formType: 'PND3', filingRoute: 'SYSTEM_FILLS' }), null);
  assert.match(block, /whtFilingRouteHint/);
});

test('e-WHT category/channel changes autofill RATE only and clearing withholding sends null', () => {
  const change = (model as any).changeExpenseReviewRemittance;
  const category = (model as any).changeExpenseReviewWhtCategory;
  assert.equal(typeof change, 'function'); assert.equal(typeof category, 'function');
  const rate = { ...values(), whtCategoryCode: 'WHT_ADVERTISING_IND', whtInput: { inputType: 'RATE', value: '2' } } as ExpenseDraftReviewValues;
  assert.equal(change(rate, 'E_WHT', '2').whtInput.value, '1');
  assert.equal(change({ ...rate, expenseDate: '2028-01-01' }, 'E_WHT', '2').whtInput.value, '2');
  const amount = { ...rate, whtInput: { inputType: 'AMOUNT', value: '45' } } as ExpenseDraftReviewValues;
  assert.equal(change(amount, 'E_WHT', '2').whtInput.value, '45');
  assert.equal(category(amount, 'WHT_RENT_IND', '5').whtInput.value, '45');
  assert.equal(category({ ...rate, whtRemittance: 'E_WHT' } as any, 'WHT_RENT_IND', '5').whtInput.value, '1');
  assert.equal(model.buildExpenseDraftReviewPayload({ ...rate, whtRemittance: 'E_WHT' } as any).whtRemittance, 'E_WHT');
  assert.equal(model.buildExpenseDraftReviewPayload({ ...values(), lines: values().lines.map(line => ({ ...line, whtRate: null })), whtRemittance: 'E_WHT' } as any).whtRemittance, 'E_WHT', 'legacy amount-only withholding retains its saved channel');
  assert.equal(model.buildExpenseDraftReviewPayload(changeInput(rate, { inputType: 'RATE', value: '' })).whtRemittance, null);
});

test('e-WHT surface table uses one conditional hint and payment warnings never infer the channel', () => {
  const hint = (model as any).expenseRemittanceHint;
  const warning = (model as any).expenseEWhtPaymentWarning;
  assert.equal(typeof hint, 'function'); assert.equal(typeof warning, 'function');
  for (const [code, mode, date, expected] of [
    ['WHT_SERVICE_3', 'RATE', '2026-01-01', 'W-F5'], ['WHT_RENT_IND', 'RATE', '2026-01-01', 'W-F6'],
    ['WHT_RENT_IND', 'AMOUNT', '2026-01-01', null], ['WHT_TRANSPORT_IND', 'AMOUNT', '2026-01-01', 'W-F7'],
    ['WHT_OTHER_IND', 'RATE', '2026-01-01', 'W-F8'], ['WHT_RENT_IND', 'AMOUNT', '2028-01-01', 'W-F9'],
  ] as const) assert.equal(hint({ ...values(), expenseDate: date, whtCategoryCode: code, whtRemittance: 'E_WHT', whtInput: { inputType: mode, value: '1' } }), expected ? require('@watchdog-bms/contracts').E_WHT_WORDS[expected] : null);
  assert.equal(warning('E_WHT', 'WHT_ADVERTISING_IND', '1', '2028-01-01'), require('@watchdog-bms/contracts').E_WHT_WORDS['W-P2']);
  for (const args of [['PAYER_FILES', 'WHT_ADVERTISING_IND', '1', '2028-01-01'], ['E_WHT', 'WHT_TRANSPORT_IND', '1', '2028-01-01'], ['E_WHT', 'WHT_ADVERTISING_IND', '2', '2028-01-01'], ['E_WHT', 'WHT_ADVERTISING_IND', '1', '2026-01-01']]) assert.equal(warning(...args), null);
});

test('paid remittance controls stay out of free source drafts and hide the payer filing hint for bank remittance', () => {
  assert.match(block, /showRemittance && <label/);
  assert.match(block, /values.whtRemittance !== 'E_WHT' \? whtFilingRouteHint/);
  assert.equal(words['expenses.wht_remittance'], require('@watchdog-bms/contracts').E_WHT_WORDS['W-F1']);
});

test('cash-payment and substitute refusals retain the specified Thai recovery sentence', () => {
  const { E_WHT_WORDS } = require('@watchdog-bms/contracts');
  assert.equal(apiErrorMessage({ code: 'expense_ewht_cash_payment_exists' }), E_WHT_WORDS['W-R2']);
  assert.equal(apiErrorMessage({ code: 'substitute_receipt_ewht_payment_method' }), E_WHT_WORDS['W-R3']);
});

test('R18-R21 settings rows keep hidden-field defaults and replace the low-rate hint by authority', () => {
  const { E_WHT_WORDS } = require('@watchdog-bms/contracts');
  const payer = { ...values(), whtRemittance: 'PAYER_FILES', whtCategoryCode: 'WHT_ADVERTISING_IND', whtInput: { inputType: 'RATE', value: '1' } } as ExpenseDraftReviewValues;
  for (const canManage of [true, false]) {
    assert.equal((model.expenseRemittanceHint as any)(payer, { used: false, canManage }), E_WHT_WORDS[canManage ? 'W-F10o' : "W-F10o'"]);
    assert.equal((model.expenseRemittanceHint as any)(payer, { used: true, canManage }), E_WHT_WORDS['W-F10']);
  }
  assert.equal(model.buildExpenseDraftReviewPayload({ ...payer, whtRemittance: null }).whtRemittance, 'PAYER_FILES');
  assert.equal(model.buildExpenseDraftReviewPayload(changeInput(payer, { inputType: 'RATE', value: '' })).whtRemittance, null);
  assert.match(edit, /!freeExpenseDrafts && \(eWhtUsed \|\| detail.whtRemittance === 'E_WHT'\)/);
  assert.match(edit, /if \(freeExpenseDrafts\) return;/);
  assert.match(edit, /getExpenseEWhtSetting\(companyId\)/);
  assert.match(edit, /catch\(\(\) => \{ if \(active\) setEWhtUsed\(false\)/);
  assert.match(block, /E_WHT_WORDS\['W-F10o-link'\]/);
});
