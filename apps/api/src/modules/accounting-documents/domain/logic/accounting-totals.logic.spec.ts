import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLine,
  calculateDocumentTotals,
  calculatePaymentStatus,
  calculateOutstandingAmount,
  calculateUnappliedCredit,
} from './accounting-totals.logic';
import {
  calculateIncomeExpenseLedgerAmounts,
  calculateVatRegistrationAlert,
  categoryBreakdownMatches,
  ledgerBangkokInstantRange,
  mergeSignedCategoryAmounts,
  resolveIncomeExpenseLedgerPeriod,
  resolveVatRegistrationWatchPeriod,
} from './income-expense-ledger.logic';

describe('calculateLine', () => {
  it('VAT_EXCLUDED: adds VAT on top of taxable amount', () => {
    const r = calculateLine({ quantity: '2', unitPrice: '100', discountAmount: '0', vatRate: '7', vatMode: 'VAT_EXCLUDED', whtRate: '0' });
    assert.equal(r.taxableAmount, '200.00');
    assert.equal(r.vatAmount, '14.00');
    assert.equal(r.lineTotalAmount, '214.00');
  });

  it('VAT_INCLUDED: back-calculates taxable from total', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '107', vatRate: '7', vatMode: 'VAT_INCLUDED' });
    assert.equal(r.taxableAmount, '100.00');
    assert.equal(r.vatAmount, '7.00');
    assert.equal(r.lineTotalAmount, '107.00');
  });

  it('NO_VAT: zero VAT', () => {
    const r = calculateLine({ quantity: '3', unitPrice: '50', vatMode: 'NO_VAT' });
    assert.equal(r.vatAmount, '0.00');
    assert.equal(r.lineTotalAmount, '150.00');
  });

  it('applies discount before VAT', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '200', discountAmount: '50', vatRate: '7', vatMode: 'VAT_EXCLUDED' });
    assert.equal(r.taxableAmount, '150.00');
    assert.equal(r.vatAmount, '10.50');
    assert.equal(r.lineTotalAmount, '160.50');
  });

  it('calculates WHT on taxable amount', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '1000', vatMode: 'VAT_EXCLUDED', vatRate: '7', whtRate: '3' });
    assert.equal(r.whtAmount, '30.00');
  });

  it('discount cannot exceed line subtotal', () => {
    const r = calculateLine({ quantity: '1', unitPrice: '100', discountAmount: '9999', vatMode: 'NO_VAT' });
    assert.equal(r.taxableAmount, '0.00');
    assert.equal(r.lineTotalAmount, '0.00');
  });
});

describe('calculateDocumentTotals', () => {
  it('sums multiple lines correctly', () => {
    const lines = [
      { lineSubtotalAmount: '200.00', discountAmount: '0.00', taxableAmount: '200.00', vatAmount: '14.00', whtAmount: '0.00', lineTotalAmount: '214.00' },
      { lineSubtotalAmount: '100.00', discountAmount: '10.00', taxableAmount: '90.00', vatAmount: '6.30', whtAmount: '0.00', lineTotalAmount: '96.30' },
    ];
    const t = calculateDocumentTotals(lines);
    assert.equal(t.subtotalAmount, '300.00');
    assert.equal(t.discountAmount, '10.00');
    assert.equal(t.taxableAmount, '290.00');
    assert.equal(t.vatAmount, '20.30');
    assert.equal(t.grandTotalAmount, '310.30');
  });

  it('returns zeros for empty lines', () => {
    const t = calculateDocumentTotals([]);
    assert.equal(t.grandTotalAmount, '0.00');
  });
});

describe('calculatePaymentStatus', () => {
  it('returns UNPAID when paid is 0', () => assert.equal(calculatePaymentStatus('1000.00', '0'), 'UNPAID'));
  it('returns PAID when fully paid', () => assert.equal(calculatePaymentStatus('500.00', '500.00'), 'PAID'));
  it('returns PARTIALLY_PAID when underpaid', () => assert.equal(calculatePaymentStatus('500.00', '250.00'), 'PARTIALLY_PAID'));
  it('returns PAID on overpayment scenario', () => assert.equal(calculatePaymentStatus('500.00', '600.00'), 'PAID'));
});

describe('calculateOutstandingAmount', () => {
  it('outstanding = grand - paid', () => assert.equal(calculateOutstandingAmount('1000.00', '300.00'), '700.00'));
  it('clamps at 0 when overpaid', () => assert.equal(calculateOutstandingAmount('100.00', '200.00'), '0.00'));
});

describe('calculateUnappliedCredit', () => {
  it('unapplied = payment - allocated', () => assert.equal(calculateUnappliedCredit('500.00', '300.00'), '200.00'));
  it('returns 0 when fully allocated', () => assert.equal(calculateUnappliedCredit('300.00', '300.00'), '0.00'));
  it('returns 0 when over-allocated (should not happen but clamps)', () => assert.equal(calculateUnappliedCredit('100.00', '200.00'), '0.00'));
});

describe('P27 income-expense ledger definitions', () => {
  it('uses the selected Bangkok month and shifts instant boundaries by UTC+7', () => {
    assert.deepEqual(resolveIncomeExpenseLedgerPeriod(undefined, undefined, '2026-08-26'), {
      from: '2026-08-01', to: '2026-08-26', timezone: 'Asia/Bangkok',
    });
    assert.equal(resolveIncomeExpenseLedgerPeriod('2026-08-31', '2026-08-01', '2026-08-26'), null);
    const range = ledgerBangkokInstantRange('2026-08-01', '2026-08-31');
    assert.equal(range.gte?.toISOString(), '2026-07-31T17:00:00.000Z');
    assert.equal(range.lt?.toISOString(), '2026-08-31T17:00:00.000Z');
  });

  it('keeps cash and document differences distinct and counts received WHT as settlement', () => {
    assert.deepEqual(calculateIncomeExpenseLedgerAmounts({
      positiveSales: '1300', creditSales: '100', receivedCash: '700', receivedWht: '30',
      receivableOutstanding: '470', recordedExpense: '500', paidExpense: '200',
    }), {
      salesDocumentTotal: '1200.00', receivedTotal: '730.00', withheldTaxTotal: '30.00',
      receivableOutstanding: '470.00', recordedExpenseTotal: '500.00', paidExpenseTotal: '200.00',
      cashDifference: '530.00', documentDifference: '700.00',
    });
  });

  it('subtracts credit notes by category and detects a header/line mismatch', () => {
    const rows = mergeSignedCategoryAmounts(
      [
        { categoryId: 'goods', label: 'ขายสินค้า', amount: '1000' },
        { categoryId: 'service', label: 'ค่าบริการ', amount: '300' },
      ],
      [{ categoryId: 'goods', label: 'ขายสินค้า', amount: '100' }],
    );
    assert.deepEqual(rows, [
      { categoryId: 'goods', label: 'ขายสินค้า', amount: '900.00' },
      { categoryId: 'service', label: 'ค่าบริการ', amount: '300.00' },
    ]);
    assert.equal(categoryBreakdownMatches('1200', rows), true);
    assert.equal(categoryBreakdownMatches('1199.99', rows), false);
  });

  it('uses exact product-warning boundaries without presenting them as a legal determination', () => {
    const period = { periodStart: '2026-01-01', periodEnd: '2026-08-27' };
    assert.equal(calculateVatRegistrationAlert({ status: 'NOT_REGISTERED', positiveSales: '1439999.99', creditSales: '0', ...period }), undefined);
    assert.deepEqual(calculateVatRegistrationAlert({ status: 'NOT_REGISTERED', positiveSales: '1440000.00', creditSales: '0', ...period }), {
      level: 'APPROACHING', periodBasis: 'ACCOUNTING_PERIOD', ...period, salesDocumentTotal: '1440000.00', thresholdAmount: '1800000.00',
    });
    assert.equal(calculateVatRegistrationAlert({ status: 'NOT_REGISTERED', positiveSales: '1799999.99', creditSales: '0', ...period })?.level, 'APPROACHING');
    assert.deepEqual(calculateVatRegistrationAlert({ status: 'NOT_REGISTERED', positiveSales: '1800000.00', creditSales: '0', ...period }), {
      level: 'REACHED', periodBasis: 'ACCOUNTING_PERIOD', ...period, salesDocumentTotal: '1800000.00', thresholdAmount: '1800000.00',
    });
    assert.equal(calculateVatRegistrationAlert({ status: 'NOT_REGISTERED', positiveSales: '1800010.01', creditSales: '10', ...period })?.level, 'REACHED');
    assert.equal(calculateVatRegistrationAlert({ status: 'REGISTERED', positiveSales: '9999999', creditSales: '0', ...period }), undefined);
    assert.equal(calculateVatRegistrationAlert({ status: 'UNKNOWN', positiveSales: '9999999', creditSales: '0', ...period }), undefined);
  });

  it('uses the configured accounting year instead of assuming every company follows the calendar year', () => {
    assert.deepEqual(resolveVatRegistrationWatchPeriod('2026-08-27', 12), {
      periodBasis: 'ACCOUNTING_PERIOD', periodStart: '2026-01-01', periodEnd: '2026-08-27',
    });
    assert.deepEqual(resolveVatRegistrationWatchPeriod('2026-02-01', 3), {
      periodBasis: 'ACCOUNTING_PERIOD', periodStart: '2025-04-01', periodEnd: '2026-02-01',
    });
    assert.deepEqual(resolveVatRegistrationWatchPeriod('2026-08-27', 3), {
      periodBasis: 'ACCOUNTING_PERIOD', periodStart: '2026-04-01', periodEnd: '2026-08-27',
    });
    assert.equal(resolveVatRegistrationWatchPeriod('2026-08-27', 13), null);
  });
});
