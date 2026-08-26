import Decimal from 'decimal.js';
import type { CreateDocumentInput, CreatePaymentInput } from '../models/accounting.model';

// THB is the accounting-documents MVP currency. Its persisted money inputs use
// two decimal places and stay inside the Decimal(18,4) column's 14-digit integer bound.
export const ACCOUNTING_MONEY_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
export const POSITIVE_ACCOUNTING_MONEY_PATTERN = /^(?=.*[1-9])(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
export const POSITIVE_ACCOUNTING_QUANTITY_PATTERN = /^(?=.*[1-9])(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
export const ACCOUNTING_RATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/;
export const PAYMENT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const MAX_MONEY = new Decimal('99999999999999.99');

function decimal(value: string, pattern: RegExp): Decimal | null {
  if (typeof value !== 'string' || !pattern.test(value)) return null;
  const parsed = new Decimal(value);
  return parsed.isFinite() ? parsed : null;
}

export function validateAccountingDocumentMoneyInput(
  input: Omit<CreateDocumentInput, 'companyId' | 'createdByUserId'>,
): string | null {
  if ((input.currency ?? 'THB') !== 'THB') return 'Accounting documents currently support THB only';
  if (!Array.isArray(input.lines)) return 'Accounting document lines are required';

  let documentTotal = new Decimal(0);
  for (const line of input.lines) {
    const quantity = decimal(line.quantity, POSITIVE_ACCOUNTING_QUANTITY_PATTERN);
    if (!quantity) return `Line ${line.lineNumber} quantity must be positive with at most 4 decimal places`;

    const unitPrice = decimal(line.unitPrice, POSITIVE_ACCOUNTING_MONEY_PATTERN);
    if (!unitPrice) return `Line ${line.lineNumber} unit price must be a positive THB amount with at most 2 decimal places`;

    const discount = decimal(line.discountAmount ?? '0', ACCOUNTING_MONEY_PATTERN);
    if (!discount) return `Line ${line.lineNumber} discount must be a non-negative THB amount with at most 2 decimal places`;

    const subtotal = quantity.mul(unitPrice);
    if (subtotal.gt(MAX_MONEY)) return `Line ${line.lineNumber} amount exceeds the accounting money limit`;
    if (discount.gte(subtotal)) return `Line ${line.lineNumber} discount must be less than its subtotal`;

    let vatRate = new Decimal(0);
    for (const [label, value] of [['VAT', line.vatRate], ['WHT', line.whtRate]] as const) {
      if (value === undefined) continue;
      const rate = decimal(value, ACCOUNTING_RATE_PATTERN);
      if (!rate || rate.gt(100)) return `Line ${line.lineNumber} ${label} rate must be between 0 and 100 with at most 4 decimal places`;
      if (label === 'VAT') vatRate = rate;
    }
    const afterDiscount = subtotal.minus(discount);
    documentTotal = documentTotal.plus(input.vatMode === 'VAT_EXCLUDED'
      ? afterDiscount.mul(vatRate.div(100).plus(1))
      : afterDiscount);
    if (documentTotal.gt(MAX_MONEY)) return 'Document total exceeds the accounting money limit';
  }
  return null;
}

export function validateAccountingPaymentMoneyInput(
  input: Omit<CreatePaymentInput, 'companyId' | 'createdByUserId'>,
): string | null {
  if (input.allocateToDocumentId && !input.idempotencyKey) {
    return 'A retry key is required when allocating a payment to a document';
  }
  if (input.idempotencyKey && !PAYMENT_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    return 'Payment retry key must be 8-64 letters, numbers, underscores, or hyphens';
  }
  if (!decimal(input.amount, POSITIVE_ACCOUNTING_MONEY_PATTERN)) {
    return 'Payment amount must be a positive THB amount with at most 2 decimal places';
  }
  if ((input.currency ?? 'THB') !== 'THB') return 'Accounting payments currently support THB only';
  if (!['RECEIVED', 'PAID'].includes(input.direction)) return 'Unsupported payment direction';
  if (!['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'].includes(input.method)) return 'Unsupported payment method';
  if (typeof input.paidAt !== 'string' || !Number.isFinite(Date.parse(input.paidAt))) return 'Payment date must be a valid ISO date';
  const withheld = decimal(input.whtAmount ?? '0', ACCOUNTING_MONEY_PATTERN);
  if (!withheld) return 'Withheld tax must be a non-negative THB amount with at most 2 decimal places';
  if (withheld.gt(0)) {
    // We are the payee here. Tax withheld from a payment WE make is the procurement side's
    // business, and it settles a supplier bill, not one of our documents.
    if (input.direction !== 'RECEIVED') return 'Only a received payment can carry tax withheld from us';
    // Withheld tax is never a floating credit: it exists because a specific document was paid, and
    // the amount is only meaningful against that document's outstanding balance.
    if (!input.allocateToDocumentId) return 'A payment carrying withheld tax must be allocated to a document';
  }
  return null;
}

type AllocationTarget = {
  documentType: string;
  status: string;
  currency: string;
  counterpartyId?: string;
  outstandingAmount: string;
};

export function validateAccountingPaymentAllocation(
  input: Omit<CreatePaymentInput, 'companyId' | 'createdByUserId'>,
  target: AllocationTarget,
): string | null {
  if (input.direction !== 'RECEIVED') return 'Only received payments can be allocated to receivable documents';
  if (!['INVOICE', 'BILLING_NOTE', 'DEBIT_NOTE'].includes(target.documentType)) return `Payments cannot be allocated to ${target.documentType}`;
  if (target.status !== 'ISSUED') return 'Payments can only be allocated to issued documents';
  if (target.currency !== (input.currency ?? 'THB')) return 'Payment currency must match the target document';
  if ((input.counterpartyId ?? null) !== (target.counterpartyId ?? null)) {
    return 'Payment counterparty must match the target document';
  }
  const outstanding = decimal(target.outstandingAmount, ACCOUNTING_MONEY_PATTERN);
  if (!outstanding || outstanding.lte(0)) return 'Target document has no outstanding amount';
  const withheld = decimal(input.whtAmount ?? '0', ACCOUNTING_MONEY_PATTERN);
  if (!withheld) return 'Withheld tax must be a non-negative THB amount with at most 2 decimal places';
  if (withheld.gt(0)) {
    const cash = decimal(input.amount, POSITIVE_ACCOUNTING_MONEY_PATTERN);
    if (!cash) return 'Payment amount must be a positive THB amount with at most 2 decimal places';
    if (cash.plus(withheld).gt(outstanding)) return 'Payment and withheld tax together exceed the document outstanding amount';
  }
  return null;
}
