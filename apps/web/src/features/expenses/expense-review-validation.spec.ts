import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpenseDraftReviewValues } from './expenses.model';
import { validateExpenseReview } from './expense-review-validation';

const validValues = (): ExpenseDraftReviewValues => ({
  vendorNameSnapshot: 'บริษัท ตัวอย่าง จำกัด',
  vendorTaxIdSnapshot: '0100000000001',
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
    assert.equal(issues[0]?.messageKey, 'expenses.v_rate_range');
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

  it('keeps line issue indexes stable', () => {
    const values = validValues();
    values.lines = Array.from({ length: 4 }, (_, index) => ({ ...values.lines[0]!, description: `line ${index + 1}` }));
    values.lines[3]!.quantity = 'abc';
    assert.equal(validate(values).find((issue) => issue.field === 'lines.3.quantity')?.messageKey, 'expenses.v_number_invalid');
  });
});
