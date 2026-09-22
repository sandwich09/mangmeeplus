import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpenseDraftReviewValues } from './expenses.model';
import { validateExpenseReview } from './expense-review-validation';
import { applyChargeKindChange, buildExpenseDraftReviewPayload, insertExpenseReviewLine, removeExpenseReviewLine } from './expenses.model';

const validValues = (): ExpenseDraftReviewValues => ({
  vendorNameSnapshot: 'บริษัท ตัวอย่าง จำกัด',
  vendorTaxIdSnapshot: '0100000000001',
  vendorAddressSnapshot: '',
  vendorBranchCodeSnapshot: '',
  vendorDocumentNumber: 'INV-1',
  expenseDate: '2026-07-31',
  vatMode: 'NO_VAT',
  lines: [{
    description: 'ค่าบริการ',
    quantity: '1',
    unitPrice: '100',
    discountAmount: '0',
    vatRate: '',
    whtRate: null,
    expenseCategoryId: null,
    accountHintKey: null,
    taxCategory: null,
  }],
});

const validate = (values: ExpenseDraftReviewValues, aiGrandTotal?: string) =>
  validateExpenseReview(values, { today: '2026-07-31', aiGrandTotal });

describe('validateExpenseReview', () => {
  it('accepts clean values', () => {
    assert.deepEqual(validate(validValues()), []);
  });

  it('requires a trimmed vendor name', () => {
    const values = validValues(); values.vendorNameSnapshot = '   ';
    assert.equal(validate(values).find((issue) => issue.field === 'vendorNameSnapshot')?.messageKey, 'expenses.v_vendor_required');
  });

  it('limits vendor names to 200 characters', () => {
    const values = validValues(); values.vendorNameSnapshot = 'ก'.repeat(201);
    assert.deepEqual(validate(values).find((issue) => issue.field === 'vendorNameSnapshot'), {
      field: 'vendorNameSnapshot', severity: 'error', messageKey: 'expenses.v_too_long', params: { max: '200' },
    });
  });

  it('requires a set tax id to contain exactly 13 digits after hyphens and spaces are removed', () => {
    const values = validValues(); values.vendorTaxIdSnapshot = '010-0000 00001';
    assert.equal(validate(values).find((issue) => issue.field === 'vendorTaxIdSnapshot')?.messageKey, 'expenses.v_tax_id_13');
    values.vendorTaxIdSnapshot = '';
    assert.equal(validate(values).some((issue) => issue.field === 'vendorTaxIdSnapshot'), false);
  });

  // Vendor address spec §8 (D5): one field, two different answers, and only one of them may stop a
  // save. AC04 turns on this split — a full tax invoice with no address stays confirmable.
  it('refuses an over-long seller address but only nudges a tax invoice that has none', () => {
    const tooLong = validValues(); tooLong.vendorAddressSnapshot = 'ก'.repeat(501);
    assert.deepEqual(validate(tooLong).find((issue) => issue.field === 'vendorAddressSnapshot'), {
      field: 'vendorAddressSnapshot', severity: 'error', messageKey: 'expenses.v_vendor_address_too_long',
    });
    const atLimit = validValues(); atLimit.vendorAddressSnapshot = `  ${'ก'.repeat(500)}  `;
    assert.equal(validate(atLimit).some((issue) => issue.field === 'vendorAddressSnapshot'), false,
      'exactly 500 after trimming is inside the limit');

    const blankOnInvoice = validateExpenseReview(validValues(), { today: '2026-07-31', sourceDocumentType: 'TAX_INVOICE' });
    assert.deepEqual(blankOnInvoice.find((issue) => issue.field === 'vendorAddressSnapshot'), {
      field: 'vendorAddressSnapshot', severity: 'warn', messageKey: 'expenses.v_vendor_address_tax_invoice',
    });
    // The page disables บันทึก off the ERROR count, so a warning here must leave it untouched.
    assert.deepEqual(blankOnInvoice.filter((issue) => issue.severity === 'error'), []);
    assert.equal(
      validateExpenseReview(validValues(), { today: '2026-07-31', sourceDocumentType: 'RECEIPT' })
        .some((issue) => issue.field === 'vendorAddressSnapshot'),
      false,
      'only a full tax invoice is nudged; nothing else mentions the address',
    );
  });

  it('limits document numbers to 50 characters', () => {
    const values = validValues(); values.vendorDocumentNumber = 'A'.repeat(51);
    assert.deepEqual(validate(values).find((issue) => issue.field === 'vendorDocumentNumber')?.params, { max: '50' });
  });

  it('requires a present, parseable YYYY-MM-DD expense date', () => {
    for (const expenseDate of ['', '2026-02-30', '31/07/2026']) {
      const values = validValues(); values.expenseDate = expenseDate;
      assert.equal(validate(values).find((issue) => issue.field === 'expenseDate')?.messageKey, 'expenses.v_date_required');
    }
  });

  it('rejects a future expense date', () => {
    const values = validValues(); values.expenseDate = '2026-08-01';
    assert.equal(validate(values).find((issue) => issue.field === 'expenseDate')?.messageKey, 'expenses.v_date_future');
  });

  it('warns when the expense date is more than five years old', () => {
    const values = validValues(); values.expenseDate = '2021-07-30';
    assert.deepEqual(validate(values).find((issue) => issue.field === 'expenseDate'), {
      field: 'expenseDate', severity: 'warn', messageKey: 'expenses.v_date_very_old',
    });
  });

  it('requires at least one line', () => {
    const values = validValues(); values.lines = [];
    assert.equal(validate(values).find((issue) => issue.field === 'lines')?.messageKey, 'expenses.v_lines_required');
  });

  it('requires a trimmed line description', () => {
    const values = validValues(); values.lines[0]!.description = ' ';
    assert.equal(validate(values).find((issue) => issue.field === 'lines.0.description')?.messageKey, 'expenses.v_description_required');
  });

  it('limits line descriptions to 200 characters', () => {
    const values = validValues(); values.lines[0]!.description = 'ก'.repeat(201);
    assert.deepEqual(validate(values).find((issue) => issue.field === 'lines.0.description')?.params, { max: '200' });
  });

  it('requires quantity to be numeric and greater than zero', () => {
    for (const [quantity, messageKey] of [['', 'expenses.v_number_invalid'], ['abc', 'expenses.v_number_invalid'], ['0', 'expenses.v_quantity_positive']] as const) {
      const values = validValues(); values.lines[0]!.quantity = quantity;
      assert.equal(validate(values).find((issue) => issue.field === 'lines.0.quantity')?.messageKey, messageKey);
    }
  });

  it('requires unit price to be numeric and non-negative', () => {
    for (const [unitPrice, messageKey] of [['abc', 'expenses.v_number_invalid'], ['-1', 'expenses.v_amount_negative']] as const) {
      const values = validValues(); values.lines[0]!.unitPrice = unitPrice;
      assert.equal(validate(values).find((issue) => issue.field === 'lines.0.unitPrice')?.messageKey, messageKey);
    }
  });

  it('requires discount to be numeric and non-negative', () => {
    for (const [discount, messageKey] of [['', 'expenses.v_number_invalid'], ['-1', 'expenses.v_amount_negative']] as const) {
      const values = validValues(); values.lines[0]!.discountAmount = discount;
      assert.equal(validate(values).find((issue) => issue.field === 'lines.0.discountAmount')?.messageKey, messageKey);
    }
  });

  it('rejects a discount above quantity times unit price', () => {
    const values = validValues(); values.lines[0]!.discountAmount = '100.01';
    assert.equal(validate(values).find((issue) => issue.field === 'lines.0.discountAmount')?.messageKey, 'expenses.v_discount_exceeds');
  });

  it('keeps VAT rate in the fraction range 0..1 when set', () => {
    const values = validValues(); values.lines[0]!.vatRate = '1.01';
    assert.equal(validate(values).find((issue) => issue.field === 'lines.0.vatRate')?.messageKey, 'expenses.v_rate_range');
  });

  // Spec §19g decision 1: the reported Starbucks draft — mode asserts VAT, no rate to compute it
  // with. The server blocks confirmation on the same condition, so the form must say so first.
  it('requires a VAT rate when the mode says VAT applies', () => {
    for (const vatMode of ['VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
      const values = validValues(); values.vatMode = vatMode; values.lines[0]!.vatRate = '';
      assert.deepEqual(validate(values).find((issue) => issue.field === 'lines.0.vatRate'), {
        field: 'lines.0.vatRate', severity: 'error', messageKey: 'expenses.v_vat_rate_required',
      }, vatMode);
    }
  });

  it('accepts an explicit zero rate and leaves non-VAT modes alone', () => {
    for (const vatMode of ['VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
      const zeroRated = validValues(); zeroRated.vatMode = vatMode; zeroRated.lines[0]!.vatRate = '0';
      assert.equal(validate(zeroRated).some((issue) => issue.field === 'lines.0.vatRate'), false);
    }

    for (const vatMode of ['NO_VAT', 'EXEMPT', 'NEEDS_REVIEW'] as const) {
      const values = validValues(); values.vatMode = vatMode; values.lines[0]!.vatRate = '';
      assert.equal(validate(values).some((issue) => issue.field === 'lines.0.vatRate'), false, vatMode);
    }
  });

  it('lets supported source evidence resolve a blank rate on save without guessing or changing inclusive gross', () => {
    for (const vatMode of ['VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
      for (const source of [
        { inputType: 'RATE', vatRatePercent: '7' },
        { inputType: 'AMOUNT', vatAmount: '1.64' },
        { inputType: 'AMOUNT', vatAmount: '0' },
        { inputType: 'BOTH', vatRatePercent: '7', vatAmount: '1.64' },
      ] as const) {
        const values = validValues();
        values.vatMode = vatMode; values.lines[0]!.unitPrice = '25'; values.vatSource = source;
        assert.equal(validate(values).some((issue) => issue.field === 'lines.0.vatRate'), false, `${vatMode}/${source.inputType}`);
        assert.equal(values.lines[0]!.vatRate, '', 'validation must not mutate a derived rate into reviewer input');
        assert.equal(values.lines[0]!.unitPrice, '25');
      }
    }
  });

  it('keeps unknown rates blocked for missing/invalid amount evidence and impossible derivations', () => {
    for (const vatMode of ['VAT_INCLUDED', 'VAT_EXCLUDED'] as const) {
      for (const vatAmount of ['', 'abc', '-1', '1.001', '100']) {
        const values = validValues(); values.vatMode = vatMode; values.lines[0]!.unitPrice = '25';
        values.vatSource = { inputType: 'AMOUNT', vatAmount };
        assert.equal(validate(values).some((issue) => issue.field === 'lines.0.vatRate'), true, `${vatMode}/${vatAmount}`);
      }
    }
  });

  it('does not apply a document amount to unknown lines mixed with known zero/positive rates', () => {
    for (const vatRate of ['0', '0.07']) {
      const values = validValues(); values.vatMode = 'VAT_INCLUDED';
      values.lines.push({ ...values.lines[0]!, vatRate });
      values.vatSource = { inputType: 'AMOUNT', vatAmount: '6.54' };
      assert.equal(validate(values).some((issue) => issue.field === 'lines.0.vatRate'), true);
      values.vatSource = { inputType: 'NONE', lines: [{ lineNumber: 1, inputType: 'AMOUNT', vatAmount: '6.54' }] };
      assert.equal(validate(values).some((issue) => issue.field === 'lines.0.vatRate'), false);
      assert.equal(values.lines[1]!.vatRate, vatRate);
    }
  });

  it('resolves only the line named by line-level source evidence', () => {
    const values = validValues(); values.vatMode = 'VAT_EXCLUDED'; values.lines.push({ ...values.lines[0]! });
    values.vatSource = { inputType: 'NONE', lines: [{ lineNumber: 2, inputType: 'RATE', vatRatePercent: '7' }] };
    assert.deepEqual(validate(values).filter((issue) => issue.messageKey === 'expenses.v_vat_rate_required').map((issue) => issue.field), ['lines.0.vatRate']);
  });

  it('keeps WHT rate in the fraction range 0..1 when set', () => {
    const values = validValues();
    values.lines.push({ ...values.lines[0]!, whtRate: '1.01' });
    values.lines[0]!.whtRate = 'abc';
    const issues = validate(values).filter((issue) => issue.field === 'whtRate');
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.messageKey, 'expenses.v_wht_percent');
  });

  it('validates WHT percent as 0..100 and exact baht as non-negative two-decimal input', () => {
    for (const inputType of ['RATE', 'AMOUNT'] as const) {
      for (const value of ['', '-1', '1.001', '1e2', 'NaN', '100000000000000']) {
        const values = validValues();
        values.whtInput = { inputType, value };
        assert.equal(validate(values).find((issue) => issue.field === 'whtInput.value')?.messageKey,
          inputType === 'RATE' ? 'expenses.v_wht_percent' : 'expenses.v_wht_amount', `${inputType}: ${value}`);
      }
      for (const value of ['0', '3', '30.50', '100']) {
        const values = validValues();
        values.whtInput = { inputType, value };
        assert.equal(validate(values).some((issue) => issue.field.startsWith('whtInput')), false, `${inputType}: ${value}`);
      }
    }
    const tooHigh = validValues(); tooHigh.whtInput = { inputType: 'RATE', value: '100.01' };
    assert.equal(validate(tooHigh).find((issue) => issue.field === 'whtInput.value')?.messageKey, 'expenses.v_wht_percent');
    const unknownUnit = validValues();
    unknownUnit.whtInput = { inputType: 'UNKNOWN', value: '3' } as unknown as ExpenseDraftReviewValues['whtInput'];
    assert.equal(validate(unknownUnit).find((issue) => issue.field === 'whtInput.inputType')?.messageKey, 'expenses.v_wht_unit');
  });

  it('checks the amount against the current pre-VAT base after price and discount edits', () => {
    for (const vatMode of ['NO_VAT', 'VAT_EXCLUDED', 'VAT_INCLUDED'] as const) {
      const values = validValues();
      values.vatMode = vatMode;
      values.lines[0]!.vatRate = vatMode === 'NO_VAT' ? '0' : '0.07';
      values.lines[0]!.unitPrice = vatMode === 'VAT_INCLUDED' ? '117' : '110';
      values.lines[0]!.discountAmount = '10';
      values.whtInput = { inputType: 'AMOUNT', value: '100' };
      assert.equal(validate(values).some((issue) => issue.field === 'whtInput.value'), false, vatMode);
      values.whtInput.value = '100.01';
      assert.equal(validate(values).find((issue) => issue.field === 'whtInput.value')?.messageKey, 'expenses.v_wht_exceeds_base', vatMode);
    }
    // The API, not a second client reconciler, owns accepted printed VAT and its exact base.
    const inclusive = validValues();
    inclusive.vatMode = 'VAT_INCLUDED'; inclusive.lines[0]!.unitPrice = '107'; inclusive.lines[0]!.vatRate = '0.07';
    inclusive.vatSource = { inputType: 'AMOUNT', vatAmount: '6.99' };
    inclusive.whtInput = { inputType: 'AMOUNT', value: '100.01' };
    assert.equal(validate(inclusive).some((issue) => issue.field === 'whtInput.value'), false);
    inclusive.whtInput.value = '107.01';
    assert.equal(validate(inclusive).find((issue) => issue.field === 'whtInput.value')?.messageKey, 'expenses.v_wht_exceeds_base');
  });

  it('uses pending WHT, including clearing to zero, instead of a stale saved total or line rate', () => {
    for (const inputType of ['RATE', 'AMOUNT'] as const) {
      const values = validValues();
      values.whtInput = { inputType, value: '3' };
      assert.equal(validate(values).find((issue) => issue.field === 'vendorEntityKindSnapshot')?.severity, 'error');
      values.lines[0]!.whtRate = '0.03';
      values.whtInput.value = '0';
      assert.equal(validateExpenseReview(values, { today: '2026-07-31', whtAmount: '3' })
        .some((issue) => issue.field === 'vendorEntityKindSnapshot'), false);
    }
  });

  it('requires zero for explicit zero VAT treatment and keeps unknown included VAT blocking', () => {
    for (const vatTreatment of ['ZERO_RATED', 'EXEMPT', 'NON_VAT'] as const) {
      const values = validValues(); values.vatMode = 'VAT_INCLUDED';
      values.lines[0]!.vatTreatment = vatTreatment;
      values.lines[0]!.vatRate = '0.07';
      assert.equal(validate(values).find((issue) => issue.messageKey === 'expenses.v_vat_treatment_zero')?.field, 'lines.0.vatRate');
      values.lines[0]!.vatRate = '0';
      assert.equal(validate(values).some((issue) => issue.field === 'lines.0.vatRate'), false);
    }
    const unknown = validValues(); unknown.vatMode = 'VAT_INCLUDED'; unknown.lines[0]!.unitPrice = '25';
    unknown.whtInput = { inputType: 'AMOUNT', value: '0' };
    assert.equal(validate(unknown).find((issue) => issue.field === 'lines.0.vatRate')?.messageKey, 'expenses.v_vat_rate_required');
  });

  it('warns when the computed total differs from the AI total by more than 0.01', () => {
    assert.equal(validate(validValues(), '100.005').some((issue) => issue.field === 'total'), false);
    assert.equal(validate(validValues(), '100.01').some((issue) => issue.field === 'total'), false);
    assert.deepEqual(validate(validValues(), '100.02').find((issue) => issue.field === 'total'), {
      field: 'total', severity: 'warn', messageKey: 'expenses.v_total_mismatch', params: { computed: '100.00', ai: '100.02' },
    });
  });

  for (const [vatMode, vatRate, aiGrandTotal] of [
    ['VAT_EXCLUDED', '', '100'],
    ['VAT_EXCLUDED', '0.07', '107'],
    ['VAT_INCLUDED', '', '100'],
    ['VAT_INCLUDED', '0.07', '100'],
  ] as const) {
    it(`uses shared totals for ${vatMode} with ${vatRate || 'a blank rate'}`, () => {
      const values = validValues();
      values.vatMode = vatMode;
      values.lines[0]!.vatRate = vatRate;
      assert.equal(validate(values, aiGrandTotal).some((issue) => issue.field === 'total'), false);
    });
  }

  it('blocks an all-zero bill but still allows a free line beside a paid line', () => {
    const values = validValues();
    values.lines[0]!.unitPrice = '0';
    values.lines.push({ ...values.lines[0]!, description: 'ของแถม' });
    assert.deepEqual(validate(values).find((issue) => issue.field === 'total'), {
      field: 'total', severity: 'error', messageKey: 'expenses.v_total_zero',
    });

    values.lines[1]!.unitPrice = '100';
    assert.equal(validate(values).some((issue) => issue.messageKey === 'expenses.v_total_zero'), false);
  });

  // RA-18 mirror of `validateConfirm`: the payee's taxpayer class decides ภ.ง.ด.3 vs ภ.ง.ด.53, so a
  // withholding expense must not reach a confirm the API will refuse.
  it('requires the payee taxpayer class once the expense withholds tax', () => {
    const payeeIssue = (values: ExpenseDraftReviewValues, whtAmount?: string) =>
      validateExpenseReview(values, { today: '2026-07-31', whtAmount })
        .find((issue) => issue.field === 'vendorEntityKindSnapshot');

    // No withholding anywhere — the class is not asked for.
    assert.equal(payeeIssue(validValues()), undefined);
    assert.equal(payeeIssue(validValues(), '0.00'), undefined);

    // Withheld via a line rate.
    const byLineRate = validValues(); byLineRate.lines[0]!.whtRate = '0.03';
    assert.deepEqual(payeeIssue(byLineRate), {
      field: 'vendorEntityKindSnapshot', severity: 'error', messageKey: 'expenses.v_payee_kind_required',
    });
    byLineRate.vendorEntityKindSnapshot = 'INDIVIDUAL';
    assert.equal(payeeIssue(byLineRate), undefined);

    // Withheld via the stored total, with the rate no longer on the editable line.
    assert.equal(payeeIssue(validValues(), '3.00')?.severity, 'error');
    const classified = validValues(); classified.vendorEntityKindSnapshot = 'JURISTIC';
    assert.equal(payeeIssue(classified, '3.00'), undefined);

    // '' is the "ยังไม่ระบุ" option, not a choice.
    const blank = validValues(); blank.vendorEntityKindSnapshot = '';
    assert.equal(payeeIssue(blank, '3.00')?.severity, 'error');
  });

  // WHT certificate system issuance plan §1.2 (S2): same last-moment rule, mirrored for the income
  // category a 50 ทวิ certificate needs to print.
  it('requires the income category once the expense withholds tax', () => {
    const categoryIssue = (values: ExpenseDraftReviewValues, whtAmount?: string) =>
      validateExpenseReview(values, { today: '2026-07-31', whtAmount })
        .find((issue) => issue.field === 'whtCategoryCode');

    assert.equal(categoryIssue(validValues()), undefined);
    assert.equal(categoryIssue(validValues(), '0.00'), undefined);

    assert.deepEqual(categoryIssue(validValues(), '3.00'), {
      field: 'whtCategoryCode', severity: 'error', messageKey: 'expenses.v_wht_category_required',
    });
    const classified = validValues(); classified.whtCategoryCode = 'CAT1';
    assert.equal(categoryIssue(classified, '3.00'), undefined);

    // '' is the "ยังไม่ระบุ" option, not a choice.
    const blank = validValues(); blank.whtCategoryCode = '';
    assert.equal(categoryIssue(blank, '3.00')?.severity, 'error');
  });

  it('keeps line issue indexes stable', () => {
    const values = validValues();
    values.lines = Array.from({ length: 4 }, (_, index) => ({ ...values.lines[0]!, description: `line ${index + 1}` }));
    values.lines[3]!.quantity = 'abc';
    assert.equal(validate(values).find((issue) => issue.field === 'lines.3.quantity')?.messageKey, 'expenses.v_number_invalid');
  });
});

// Owner report 2026-08-28: "0400" was accepted by the form and refused by the server. The form asked
// JavaScript ("is Number('0400') finite?" — yes, 400); the server asked for the Decimal(18,4) shape.
// A person typing an amount now learns at the field, not after pressing save.
describe('amount fields reject the shapes the server rejects', () => {
  const formatIssues = (unitPrice: string) => {
    const values = validValues();
    values.lines[0]!.unitPrice = unitPrice;
    return validate(values).filter((issue) => issue.messageKey === 'expenses.v_number_format');
  };

  it('refuses a leading zero, which used to sail all the way through to the save', () => {
    for (const bad of ['0400', '007', '00.5']) assert.equal(formatIssues(bad).length, 1, bad);
  });

  it('refuses the other malformed shapes the server refuses', () => {
    // '-5' keeps its own clearer "negative" message and '1e3' its "not a number" one; this check is
    // only for what those two miss — a value JavaScript is happy with that the column will not take.
    for (const bad of ['.5', '1.23456']) assert.equal(formatIssues(bad).length, 1, bad);
  });

  it('still accepts what a person legitimately types', () => {
    for (const good of ['400', '0.400', '0', '4.00', '1234.5678']) assert.equal(formatIssues(good).length, 0, good);
  });
});

/**
 * Spec §5.1 as the reviewer meets it: an additional charge is one printed amount that sits after
 * the goods, and only ปัดเศษ may be a deduction. The API refuses a payload that breaks any of these,
 * so catching it here is the difference between a field note and a 400 after pressing save.
 */
describe('additional charge lines', () => {
  const withLines = (lines: ExpenseDraftReviewValues['lines']): ExpenseDraftReviewValues =>
    ({ ...validValues(), vatMode: 'VAT_EXCLUDED', lines });
  const product = (overrides: Partial<ExpenseDraftReviewValues['lines'][number]> = {}) => ({
    ...validValues().lines[0]!, description: 'อาหาร', quantity: '1', unitPrice: '1520', discountAmount: '0', vatRate: '0.07', ...overrides,
  });
  const charge = (overrides: Partial<ExpenseDraftReviewValues['lines'][number]> = {}) =>
    product({ description: 'ค่าบริการ 10%', chargeKind: 'SERVICE_CHARGE', unitPrice: '152', ...overrides });
  const fields = (values: ExpenseDraftReviewValues) =>
    validateExpenseReview(values, { today: '2026-09-05' }).filter((issue) => issue.severity === 'error').map((issue) => issue.field);

  it('accepts goods followed by a service charge', () => {
    assert.deepEqual(fields(withLines([product(), charge()])), []);
  });

  it('accepts a negative ปัดเศษ row and refuses a negative charge of any other kind', () => {
    assert.deepEqual(fields(withLines([product(), charge({ chargeKind: 'ROUNDING', unitPrice: '-0.50', vatRate: '0' })])), []);
    const issues = validateExpenseReview(withLines([product(), charge({ unitPrice: '-0.50' })]), { today: '2026-09-05' });
    assert.equal(issues.find((issue) => issue.field === 'lines.1.unitPrice')?.messageKey, 'expenses.v_charge_amount_positive');
  });

  it('refuses a zero charge of any kind, ปัดเศษ included', () => {
    for (const chargeKind of ['SERVICE_CHARGE', 'ROUNDING'] as const) {
      assert.equal(
        validateExpenseReview(withLines([product(), charge({ chargeKind, unitPrice: '0', vatRate: '0' })]), { today: '2026-09-05' })
          .find((issue) => issue.field === 'lines.1.unitPrice')?.messageKey,
        'expenses.v_charge_amount_positive',
        chargeKind,
      );
    }
  });

  it('keeps the plain negative-amount message on an ordinary product line', () => {
    assert.equal(
      validateExpenseReview(withLines([product({ unitPrice: '-1' })]), { today: '2026-09-05' })
        .find((issue) => issue.field === 'lines.0.unitPrice')?.messageKey,
      'expenses.v_amount_negative',
    );
  });

  it('refuses a charge with a quantity, and a charge above a product', () => {
    assert.equal(
      validateExpenseReview(withLines([product(), charge({ quantity: '2', unitPrice: '76' })]), { today: '2026-09-05' })
        .find((issue) => issue.field === 'lines.1.quantity')?.messageKey,
      'expenses.v_charge_quantity_one',
    );
    assert.equal(
      validateExpenseReview(withLines([charge(), product()]), { today: '2026-09-05' })
        .find((issue) => issue.field === 'lines.0.chargeKind')?.messageKey,
      'expenses.v_charge_order',
    );
  });

  it('counts the charge into the total the AI figure is compared against', () => {
    // 1,520 goods + 152 charge + 7% VAT = 1,789.04. Without the charge in the total the reviewer
    // would be warned that a correctly entered bill disagrees with the receipt.
    assert.deepEqual(
      validateExpenseReview(withLines([product(), charge()]), { today: '2026-09-05', aiGrandTotal: '1789.04' }),
      [],
    );
    assert.equal(
      validateExpenseReview(withLines([product(), charge()]), { today: '2026-09-05', aiGrandTotal: '1626.40' })[0]?.messageKey,
      'expenses.v_total_mismatch',
    );
  });
});

/**
 * Spec §5.1 line ordering, exercised rather than asserted against the page's source. An additional
 * charge must sort after every product, so adding a PRODUCT inserts it before the charges: appending
 * would build the one payload shape the API refuses, and the reviewer would only meet the refusal on
 * save. `vatSource.lines` is keyed by line number, so it has to shift with the insert.
 */
describe('review line ordering', () => {
  const base = (): ExpenseDraftReviewValues => ({
    ...validValues(),
    vatMode: 'VAT_EXCLUDED',
    lines: [
      { ...validValues().lines[0]!, description: 'อาหาร', unitPrice: '1520', vatRate: '0.07' },
      { ...validValues().lines[0]!, description: 'ค่าบริการ 10%', chargeKind: 'SERVICE_CHARGE', unitPrice: '152', vatRate: '0.07' },
    ],
  });

  it('inserts a new product before the charges and appends a new charge', () => {
    const withProduct = insertExpenseReviewLine(base(), null);
    assert.deepEqual(withProduct.lines.map((line) => line.chargeKind ?? null), [null, null, 'SERVICE_CHARGE']);
    assert.equal(withProduct.lines[1]!.description, '');

    const withCharge = insertExpenseReviewLine(base(), 'DELIVERY');
    assert.deepEqual(withCharge.lines.map((line) => line.chargeKind ?? null), [null, 'SERVICE_CHARGE', 'DELIVERY']);
    assert.equal(withCharge.lines[2]!.description, 'ค่าส่ง', 'the new row is named by its kind');
  });

  it('produces a payload the API ordering rule accepts, whatever was added last', () => {
    let values = base();
    for (const kind of [null, 'DELIVERY', null, 'TIP'] as const) values = insertExpenseReviewLine(values, kind);
    const payload = buildExpenseDraftReviewPayload(values);
    const firstCharge = payload.lines!.findIndex((line) => line.chargeKind);
    const lastProduct = payload.lines!.reduce((last, line, index) => (line.chargeKind ? last : index), -1);
    assert.ok(firstCharge > lastProduct, `charges must follow products: ${JSON.stringify(payload.lines!.map((l) => l.chargeKind ?? null))}`);
    assert.deepEqual(payload.lines!.map((line) => line.lineNumber), [1, 2, 3, 4, 5, 6]);
  });

  /**
   * The payload states `chargeKind` on EVERY row, product rows included. The server reads an absent
   * kind as "keep what this row had", and adding a goods line renumbers everything under it — so a
   * payload that omits the field on products let a newly typed ของหวาน inherit the service charge it
   * displaced, and the save answered 200.
   */
  it('states the charge kind on every line, not only on the charges', () => {
    const payload = buildExpenseDraftReviewPayload(insertExpenseReviewLine(base(), null));
    assert.deepEqual(payload.lines!.map((line) => line.chargeKind), [null, null, 'SERVICE_CHARGE']);
    for (const line of payload.lines!) {
      assert.ok('chargeKind' in line, `line ${line.lineNumber} must carry the field even when null`);
    }
  });

  it('keeps vatSource line numbers pointing at the same rows across an insert and a remove', () => {
    const withSource: ExpenseDraftReviewValues = {
      ...base(),
      vatSource: { inputType: 'RATE', lines: [
        { lineNumber: 1, inputType: 'RATE', vatRatePercent: '7' },
        { lineNumber: 2, inputType: 'RATE', vatRatePercent: '7' },
      ] },
    };
    // A product goes in at index 1, so the charge that was line 2 becomes line 3.
    const inserted = insertExpenseReviewLine(withSource, null);
    assert.deepEqual(inserted.vatSource!.lines!.map((line) => line.lineNumber), [1, 2, 3]);
    assert.equal(inserted.vatSource!.lines!.find((line) => line.lineNumber === 3)!.vatRatePercent, '7');
    assert.equal(inserted.vatSource!.lines!.find((line) => line.lineNumber === 2)!.inputType, 'NONE', 'the new row starts with no source');

    const removed = removeExpenseReviewLine(inserted, 1);
    assert.deepEqual(removed.vatSource!.lines!.map((line) => line.lineNumber), [1, 2]);
    assert.deepEqual(removed.lines.map((line) => line.chargeKind ?? null), [null, 'SERVICE_CHARGE']);
  });

  it('renames an untouched charge row with its kind and leaves the reviewer wording alone', () => {
    const untouched = { ...base().lines[1]!, description: 'ค่าบริการ' };
    assert.equal(applyChargeKindChange(untouched, 'DELIVERY').description, 'ค่าส่ง');
    assert.equal(applyChargeKindChange({ ...untouched, description: '' }, 'TIP').description, 'ทิป');
    // Read off a bill, so it is not the default and must survive.
    assert.equal(applyChargeKindChange({ ...untouched, description: 'ค่าบริการ 10%' }, 'DELIVERY').description, 'ค่าบริการ 10%');
  });
});
