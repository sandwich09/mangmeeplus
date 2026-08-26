import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAccountingDocumentMoneyInput,
  validateAccountingPaymentAllocation,
  validateAccountingPaymentMoneyInput,
} from './accounting-money-validation.logic';

const payment = (amount: string, overrides: Record<string, unknown> = {}) => ({
  direction: 'RECEIVED' as const,
  method: 'BANK_TRANSFER' as const,
  amount,
  paidAt: '2026-07-18T10:00:00.000Z',
  ...overrides,
});

const document = (unitPrice: string, overrides: Record<string, unknown> = {}) => ({
  documentType: 'INVOICE' as const,
  documentDate: '2026-07-18',
  vatMode: 'NO_VAT' as const,
  lines: [{ lineNumber: 1, description: 'Service', quantity: '1', unitPrice, ...overrides }],
});

describe('H-05 accounting money business validation', () => {
  it('rejects non-positive, non-finite, exponent, precision, and bound overflow payments', () => {
    for (const value of ['-1', '0', '0.00', 'NaN', 'Infinity', '1e3', '0.001', '100000000000000.00']) {
      assert.ok(validateAccountingPaymentMoneyInput(payment(value)), `expected ${value} to be rejected`);
    }
    assert.equal(validateAccountingPaymentMoneyInput(payment('99999999999999.99')), null);
  });

  it('rejects invalid document money while accepting the upper safe boundary', () => {
    for (const value of ['-1', '0', 'NaN', 'Infinity', '1e3', '0.001', '100000000000000.00']) {
      assert.ok(validateAccountingDocumentMoneyInput(document(value)), `expected ${value} to be rejected`);
    }
    assert.equal(validateAccountingDocumentMoneyInput(document('99999999999999.99')), null);
    assert.ok(validateAccountingDocumentMoneyInput(document('100.00', { quantity: '10000000000000' })));
    assert.ok(validateAccountingDocumentMoneyInput(document('100.00', { discountAmount: '100.00' })));
    assert.ok(validateAccountingDocumentMoneyInput(document('100.00', { vatRate: '100.0001' })));
    assert.ok(validateAccountingDocumentMoneyInput({ ...document('100.00'), currency: 'USD' }));
    assert.ok(validateAccountingDocumentMoneyInput({
      ...document('60000000000000.00'),
      lines: [
        { lineNumber: 1, description: 'A', quantity: '1', unitPrice: '60000000000000.00' },
        { lineNumber: 2, description: 'B', quantity: '1', unitPrice: '60000000000000.00' },
      ],
    }));
  });

  it('allows overpayment as unapplied credit but rejects invalid allocation direction and target state', () => {
    const overpayment = payment('150.00', { counterpartyId: 'customer-1', allocateToDocumentId: 'doc-1' });
    const target = {
      documentType: 'INVOICE', status: 'ISSUED', currency: 'THB',
      counterpartyId: 'customer-1', outstandingAmount: '100.00',
    };
    assert.equal(validateAccountingPaymentAllocation(overpayment, target), null);
    assert.ok(validateAccountingPaymentAllocation({ ...overpayment, direction: 'PAID' }, target));
    assert.ok(validateAccountingPaymentAllocation(overpayment, { ...target, status: 'DRAFT' }));
    assert.ok(validateAccountingPaymentAllocation(overpayment, { ...target, documentType: 'QUOTATION' }));
    assert.ok(validateAccountingPaymentAllocation(overpayment, { ...target, currency: 'USD' }));
    assert.ok(validateAccountingPaymentAllocation(overpayment, { ...target, counterpartyId: 'customer-2' }));
    assert.ok(validateAccountingPaymentAllocation({ ...overpayment, counterpartyId: undefined }, target));
    assert.ok(validateAccountingPaymentAllocation(overpayment, { ...target, outstandingAmount: '0.00' }));
  });
});

// Tax a customer withheld from us settles the document without ever reaching the bank, so it has
// its own rules: it only makes sense on money coming in, and only against a specific document.
describe('withheld tax on a received payment', () => {
  const target = {
    documentType: 'INVOICE', status: 'ISSUED', currency: 'THB',
    counterpartyId: 'customer-1', outstandingAmount: '1070.00',
  };
  const withheld = (overrides: Record<string, unknown> = {}) =>
    payment('1040.00', { idempotencyKey: 'payment_retry_001', whtAmount: '30.00', counterpartyId: 'customer-1', allocateToDocumentId: 'doc-1', ...overrides });

  it('accepts cash plus withholding that exactly settles the document', () => {
    assert.equal(validateAccountingPaymentMoneyInput(withheld()), null);
    assert.equal(validateAccountingPaymentAllocation(withheld(), target), null);
  });

  it('leaves a payment with no withholding behaving exactly as before', () => {
    const plain = payment('1070.00', { idempotencyKey: 'payment_retry_002', counterpartyId: 'customer-1', allocateToDocumentId: 'doc-1' });
    assert.equal(validateAccountingPaymentMoneyInput(plain), null);
    assert.equal(validateAccountingPaymentAllocation(plain, target), null);
    // Cash alone may still overshoot and become an unapplied credit.
    assert.equal(validateAccountingPaymentAllocation(payment('2000.00', { counterpartyId: 'customer-1', allocateToDocumentId: 'doc-1' }), target), null);
  });

  it('refuses withholding on money going out or floating free of a document', () => {
    // Tax withheld on a payment WE make belongs to the supplier-payment flow.
    assert.ok(validateAccountingPaymentMoneyInput(withheld({ direction: 'PAID' })));
    assert.ok(validateAccountingPaymentMoneyInput(withheld({ allocateToDocumentId: undefined })));
  });

  it('refuses a malformed withheld amount', () => {
    assert.ok(validateAccountingPaymentMoneyInput(withheld({ whtAmount: '-1.00' })));
    assert.ok(validateAccountingPaymentMoneyInput(withheld({ whtAmount: '30.001' })));
  });

  it('refuses cash plus withholding beyond the outstanding, unlike cash alone', () => {
    assert.ok(validateAccountingPaymentAllocation(withheld({ amount: '1060.00' }), target));
  });
});
