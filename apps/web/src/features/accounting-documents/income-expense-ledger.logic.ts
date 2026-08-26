import type { IncomeExpenseLedgerEntry, IncomeExpenseLedgerEntryType } from '@watchdog-bms/contracts';
import { isCivilDate } from '@watchdog-bms/contracts';

export type LedgerPermission = 'accounting.document.read' | 'accounting.document.export' | 'expense.read' | 'expense.export';

export function ledgerMonthPeriod(month: string, today: string) {
  const currentMonth = today.slice(0, 7);
  const selected = /^\d{4}-\d{2}$/.test(month) && month <= currentMonth ? month : currentMonth;
  const [year, monthNumber] = selected.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return {
    month: selected,
    from: `${selected}-01`,
    to: selected === currentMonth ? today : `${selected}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function visibleLedgerEntryTypes(permissions: readonly string[]): IncomeExpenseLedgerEntryType[] {
  const income = permissions.includes('accounting.document.read');
  const expense = permissions.includes('expense.read');
  return [
    ...(income && expense ? ['ALL' as const] : []),
    ...(income ? ['INCOME' as const, 'RECEIVABLE' as const] : []),
    ...(expense ? ['EXPENSE' as const] : []),
  ];
}

export function canExportLedger(type: IncomeExpenseLedgerEntryType, permissions: readonly string[]) {
  const income = permissions.includes('accounting.document.read') && permissions.includes('accounting.document.export');
  const expense = permissions.includes('expense.read') && permissions.includes('expense.export');
  if (type === 'EXPENSE') return expense;
  if (type === 'INCOME' || type === 'RECEIVABLE') return income;
  return income && expense;
}

export function canStartLedgerIncomeFlow(permissions: readonly string[]) {
  return [
    'accounting.document.read',
    'accounting.invoice.create',
    'accounting.invoice.issue',
    'accounting.payment.create',
    'accounting.receipt.issue',
    'company.vat_registration.read',
  ].every((permission) => permissions.includes(permission));
}

export function ledgerBarWidth(amount: string, maxAmount: number) {
  const value = Math.abs(Number(amount));
  if (!Number.isFinite(value) || value <= 0 || maxAmount <= 0) return 0;
  return Math.max(4, Math.min(100, (value / maxAmount) * 100));
}

function moneyCents(value: string, allowZero: boolean): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && (allowZero ? cents >= 0 : cents > 0) ? cents : null;
}

export function ledgerReceivePaymentBlocker(input: {
  amount: string;
  whtAmount: string;
  outstandingAmount: string;
  paidOn: string;
  today: string;
}): string {
  const amount = moneyCents(input.amount, false);
  if (amount === null) return 'กรอกยอดที่รับมากกว่า 0 และไม่เกิน 2 ตำแหน่ง';
  const wht = input.whtAmount ? moneyCents(input.whtAmount, true) : 0;
  if (wht === null) return 'ยอดถูกหัก ณ ที่จ่ายต้องไม่ติดลบและไม่เกิน 2 ตำแหน่ง';
  const outstanding = moneyCents(input.outstandingAmount, false);
  if (outstanding === null) return 'ยอดค้างของเอกสารไม่ถูกต้อง กรุณาโหลดใหม่';
  if (amount + wht > outstanding) return 'ยอดรับรวมยอดถูกหัก ณ ที่จ่ายต้องไม่เกินยอดค้าง';
  if (!isCivilDate(input.paidOn)) return 'เลือกวันที่รับเงินให้ถูกต้อง';
  if (input.paidOn > input.today) return 'วันที่รับเงินต้องไม่เกินวันนี้';
  return '';
}

export function isLedgerEntryOverdue(dueDate: string | undefined, today: string, outstandingAmount?: string) {
  return Boolean(dueDate && isCivilDate(dueDate) && dueDate < today && Number(outstandingAmount) > 0);
}

export function canReceiveLedgerPayment(entry: IncomeExpenseLedgerEntry, permissions: readonly string[]) {
  return permissions.includes('accounting.payment.create')
    && entry.side === 'INCOME'
    && entry.sourceType === 'accounting_document'
    && entry.status === 'ISSUED'
    && Number(entry.outstandingAmount) > 0;
}
