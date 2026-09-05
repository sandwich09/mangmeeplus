import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateExpenseDraftAmounts, type ExpenseDraftAmountLine } from './expense-draft-amount-validation.logic';

const line = (overrides: Partial<ExpenseDraftAmountLine> = {}): ExpenseDraftAmountLine => ({
  lineNumber: 1,
  quantity: '1',
  unitPrice: '100',
  discountAmount: '0',
  ...overrides,
});

describe('create expense Decimal(18,4) boundary validation', () => {
  it('accepts exact decimal strings, blank draft rates, and free-of-charge lines', () => {
    assert.equal(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT',
      lines: [line({ unitPrice: '99999999999999.99', vatRate: '  ', whtRate: null })],
    }), null);
    assert.equal(validateExpenseDraftAmounts({ vatMode: 'NO_VAT', lines: [line({ unitPrice: '0.0000' })] }), null);
    assert.equal(validateExpenseDraftAmounts({ vatMode: 'NO_VAT', lines: [] }), null);
  });

  it('rejects non-decimal shapes, exponent notation, overprecision, and input overflow', () => {
    for (const [field, value] of [
      ['quantity', '-1'],
      ['quantity', '0'],
      ['quantity', '01'],
      ['quantity', '1e3'],
      ['unitPrice', 'NaN'],
      ['unitPrice', '1.00001'],
      ['unitPrice', '100000000000000'],
      ['discountAmount', '-0.01'],
    ] as const) {
      const error = validateExpenseDraftAmounts({ vatMode: 'NO_VAT', lines: [line({ [field]: value })] });
      assert.ok(error, `expected ${field}=${value} to be rejected`);
    }
    assert.match(validateExpenseDraftAmounts({ vatMode: 'NO_VAT', lines: {} as any }) ?? '', /must be an array/);
    assert.match(validateExpenseDraftAmounts({ vatMode: 'NO_VAT', lines: [null] }) ?? '', /fields are required/);
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'VAT_EXCLUDED', lines: [line({ vatRate: 0.07 as any })],
    }) ?? '', /VAT rate/);
  });

  it('accepts explicit zero treatments only with a known zero VAT rate', () => {
    for (const vatTreatment of ['ZERO_RATED', 'EXEMPT', 'NON_VAT'] as const) {
      assert.equal(validateExpenseDraftAmounts({
        vatMode: 'VAT_EXCLUDED', lines: [line({ vatRate: '0.0000', vatTreatment })],
      }), null);
      for (const vatRate of ['0.07', '', '  ', null, undefined]) {
        assert.match(validateExpenseDraftAmounts({
          vatMode: 'VAT_INCLUDED', lines: [line({ vatRate, vatTreatment })],
        }) ?? '', /requires an explicit zero VAT rate/);
      }
    }
    for (const vatTreatment of ['', 'STANDARD', 'exempt', 0, {}, []]) {
      assert.match(validateExpenseDraftAmounts({
        vatMode: 'VAT_EXCLUDED', lines: [line({ vatRate: '0', vatTreatment: vatTreatment as any })],
      }) ?? '', /VAT treatment must be/);
    }
    assert.equal(validateExpenseDraftAmounts({
      vatMode: 'VAT_EXCLUDED', lines: [line({ vatRate: '0', vatTreatment: null })],
    }), null, 'historical zero rates need not invent a tax treatment');
  });

  it('rejects a line whose satang-rounded result exceeds Decimal(18,4)', () => {
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT',
      lines: [line({ unitPrice: '99999999999999.9999' })],
    }) ?? '', /calculated amount exceeds/);

    assert.match(validateExpenseDraftAmounts({
      vatMode: 'VAT_EXCLUDED',
      lines: [line({ unitPrice: '99999999999999.99', vatRate: '0.07' })],
    }) ?? '', /calculated amount exceeds/);
  });

  it('rejects aggregate header overflow even when every line fits', () => {
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT',
      lines: [
        line({ lineNumber: 1, unitPrice: '60000000000000' }),
        line({ lineNumber: 2, unitPrice: '60000000000000' }),
      ],
    }) ?? '', /aggregate amount exceeds/);
  });

  it('rejects a discount above subtotal and rates outside the stored fractional range', () => {
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT', lines: [line({ unitPrice: '10', discountAmount: '10.0001' })],
    }) ?? '', /discount cannot exceed/);
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'VAT_EXCLUDED', lines: [line({ vatRate: '1.0001' })],
    }) ?? '', /VAT rate/);
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT', lines: [line({ whtRate: '0.00001' })],
    }) ?? '', /WHT rate/);
  });
});

/**
 * Spec §5.1: an additional charge is one printed amount that sits after the goods, and only a
 * ROUNDING row may be a deduction. These rules are the persistence boundary — the LINE lane, the
 * OCR apply and the web review all reach the database through this function.
 */
describe('additional charge line rules', () => {
  const charge = (overrides: Partial<ExpenseDraftAmountLine> = {}): ExpenseDraftAmountLine =>
    line({ lineNumber: 2, chargeKind: 'SERVICE_CHARGE', quantity: '1', unitPrice: '152', ...overrides });

  it('accepts the BHC bill: goods then a service charge, and the totals identity holds', () => {
    assert.equal(validateExpenseDraftAmounts({
      vatMode: 'VAT_EXCLUDED',
      lines: [line({ lineNumber: 1, unitPrice: '1520', vatRate: '0.07' }), charge({ vatRate: '0.07' })],
    }), null);
  });

  it('accepts a negative ROUNDING row and nothing else negative', () => {
    assert.equal(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT',
      lines: [line({ lineNumber: 1, unitPrice: '100.50' }), charge({ chargeKind: 'ROUNDING', unitPrice: '-0.50' })],
    }), null);
    for (const kind of ['SERVICE_CHARGE', 'DELIVERY', 'PACKAGING', 'PLATFORM_FEE', 'TIP', 'OTHER'] as const) {
      assert.match(validateExpenseDraftAmounts({
        vatMode: 'NO_VAT', lines: [line({ lineNumber: 1 }), charge({ chargeKind: kind, unitPrice: '-0.50' })],
      }) ?? '', /only ROUNDING may be negative/, kind);
    }
    // Zero is not an amount a document printed as a charge either.
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT', lines: [line({ lineNumber: 1 }), charge({ unitPrice: '0' })],
    }) ?? '', /only ROUNDING may be negative/);
  });

  it('keeps a minus sign out of ordinary product lines', () => {
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT', lines: [line({ unitPrice: '-0.50' })],
    }) ?? '', /unit price must be non-negative/);
  });

  it('requires quantity 1 so the unit price is the printed amount', () => {
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT', lines: [line({ lineNumber: 1 }), charge({ quantity: '2', unitPrice: '76' })],
    }) ?? '', /must have quantity 1/);
  });

  it('requires every charge to sort after every product line', () => {
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT',
      lines: [charge({ lineNumber: 1 }), line({ lineNumber: 2, unitPrice: '1520' })],
    }) ?? '', /must come after every product line/);
  });

  it('refuses a charge kind the schema does not have', () => {
    assert.match(validateExpenseDraftAmounts({
      vatMode: 'NO_VAT', lines: [charge({ lineNumber: 1, chargeKind: 'TRUCK_FEE' as never })],
    }) ?? '', /charge kind must be one of/);
  });
});
