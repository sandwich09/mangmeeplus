import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IncomeExpenseLedgerEntry } from '@watchdog-bms/contracts';
import {
  canExportLedger,
  canReceiveLedgerPayment,
  canStartLedgerIncomeFlow,
  isLedgerEntryOverdue,
  ledgerBarWidth,
  ledgerMonthPeriod,
  ledgerReceivePaymentBlocker,
  vatRegistrationAlertCopy,
  visibleLedgerEntryTypes,
} from './income-expense-ledger.logic';

describe('income expense ledger UI logic', () => {
  it('uses today for the current month and the civil month end for a past month', () => {
    assert.deepEqual(ledgerMonthPeriod('2026-08', '2026-08-26'), { month: '2026-08', from: '2026-08-01', to: '2026-08-26' });
    assert.deepEqual(ledgerMonthPeriod('2024-02', '2026-08-26'), { month: '2024-02', from: '2024-02-01', to: '2024-02-29' });
    assert.equal(ledgerMonthPeriod('2099-01', '2026-08-26').month, '2026-08');
  });

  it('shows only tabs that the user can actually read', () => {
    assert.deepEqual(visibleLedgerEntryTypes(['expense.read']), ['EXPENSE']);
    assert.deepEqual(visibleLedgerEntryTypes(['accounting.document.read']), ['INCOME', 'RECEIVABLE']);
    assert.deepEqual(visibleLedgerEntryTypes(['accounting.document.read', 'expense.read']), ['ALL', 'INCOME', 'RECEIVABLE', 'EXPENSE']);
  });

  it('requires export and read permission for every selected side', () => {
    const all = ['accounting.document.read', 'accounting.document.export', 'expense.read', 'expense.export'];
    assert.equal(canExportLedger('ALL', all), true);
    assert.equal(canExportLedger('ALL', all.slice(0, 2)), false);
    assert.equal(canExportLedger('INCOME', all.slice(0, 2)), true);
    assert.equal(canExportLedger('EXPENSE', ['expense.read', 'expense.export']), true);
  });

  it('shows the income action only when the user can complete the whole flow', () => {
    const permissions = [
      'accounting.document.read', 'accounting.invoice.create', 'accounting.invoice.issue',
      'accounting.payment.create', 'accounting.receipt.issue', 'company.vat_registration.read',
    ];
    assert.equal(canStartLedgerIncomeFlow(permissions), true);
    assert.equal(canStartLedgerIncomeFlow(permissions.filter((permission) => permission !== 'company.vat_registration.read')), false);
    assert.equal(canStartLedgerIncomeFlow(permissions.filter((permission) => permission !== 'accounting.document.read')), false);
  });

  it('keeps category bars bounded and visible for non-zero values', () => {
    assert.equal(ledgerBarWidth('25', 100), 25);
    assert.equal(ledgerBarWidth('1', 100), 4);
    assert.equal(ledgerBarWidth('-200', 100), 100);
    assert.equal(ledgerBarWidth('bad', 100), 0);
  });

  it('blocks invalid or over-settling received payments before the API call', () => {
    const valid = { amount: '970.00', whtAmount: '30.00', outstandingAmount: '1000.00', paidOn: '2026-08-27', today: '2026-08-27' };
    assert.equal(ledgerReceivePaymentBlocker(valid), '');
    assert.match(ledgerReceivePaymentBlocker({ ...valid, amount: '0' }), /มากกว่า 0/);
    assert.match(ledgerReceivePaymentBlocker({ ...valid, amount: '970.001' }), /2 ตำแหน่ง/);
    assert.match(ledgerReceivePaymentBlocker({ ...valid, whtAmount: '30.01' }), /ไม่เกินยอดค้าง/);
    assert.match(ledgerReceivePaymentBlocker({ ...valid, paidOn: '2026-08-28' }), /ไม่เกินวันนี้/);
  });

  it('marks only unpaid documents past their due date as overdue', () => {
    assert.equal(isLedgerEntryOverdue('2026-08-26', '2026-08-27', '1.00'), true);
    assert.equal(isLedgerEntryOverdue('2026-08-27', '2026-08-27', '1.00'), false);
    assert.equal(isLedgerEntryOverdue('2026-08-26', '2026-08-27', '0.00'), false);
    assert.equal(isLedgerEntryOverdue(undefined, '2026-08-27', '1.00'), false);
  });

  it('offers receive payment only when the current source can pass the payment API', () => {
    const entry = { id: 'doc-1', side: 'INCOME', sourceType: 'accounting_document', date: '2026-08-27', categoryLabels: [], status: 'ISSUED', amount: '100.00', outstandingAmount: '100.00', evidenceHref: '/doc-1' } satisfies IncomeExpenseLedgerEntry;
    assert.equal(canReceiveLedgerPayment(entry, ['accounting.payment.create']), true);
    assert.equal(canReceiveLedgerPayment(entry, []), false);
    assert.equal(canReceiveLedgerPayment({ ...entry, status: 'CREDITED' }, ['accounting.payment.create']), false);
    assert.equal(canReceiveLedgerPayment({ ...entry, outstandingAmount: '0.00' }, ['accounting.payment.create']), false);
  });

  it('uses plain Thai copy and the Buddhist year for both VAT threshold levels', () => {
    const period = { periodBasis: 'ACCOUNTING_PERIOD' as const, periodStart: '2026-01-01', periodEnd: '2026-08-27' };
    const approaching = vatRegistrationAlertCopy({ level: 'APPROACHING', ...period, salesDocumentTotal: '1440000.00', thresholdAmount: '1800000.00' });
    assert.match(approaching.title, /แตะ 80%/);
    assert.match(approaching.detail, /2569/);
    assert.match(approaching.detail, /1,440,000\.00/);
    assert.match(vatRegistrationAlertCopy({ level: 'REACHED', ...period, salesDocumentTotal: '1800000.00', thresholdAmount: '1800000.00' }).title, /แตะหรือเกิน/);
  });
});
