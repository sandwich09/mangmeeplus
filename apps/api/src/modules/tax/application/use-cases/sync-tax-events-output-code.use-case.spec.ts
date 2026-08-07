import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signedOutputAmount, SyncTaxEventsUseCase } from './sync-tax-events.use-case.js';

// These suites cover the document/expense seams; the supplier-payment WHT seam has its own file.
const noWhtPayments = { findRecordedWithWhtByCompany: async () => [] } as any;

function outputDocument(id: string, documentType: string, outputTaxCode: 'O7' | 'OX' | 'O0', taxableAmount: string, vatAmount: string) {
  return {
    id,
    companyId: 'company-1',
    documentType,
    documentNumber: `DOC-${id}`,
    documentDate: new Date('2026-07-13T00:00:00.000Z'),
    vatMode: outputTaxCode === 'OX' ? 'EXEMPT' : outputTaxCode === 'O0' ? 'NO_VAT' : 'VAT_EXCLUDED',
    outputTaxCode,
    vatAmount,
    taxableAmount,
    grandTotalAmount: taxableAmount,
    taxInvoiceType: 'FULL',
    taxInvoiceId: null,
    counterpartyName: 'Customer',
    counterpartyTaxId: '0100000000000',
    branchCode: '00000',
    currency: 'THB',
    updatedAt: new Date('2026-07-13T10:00:00.000Z'),
  };
}

describe('SyncTaxEventsUseCase output Tax Code boundary', () => {
  it('maps O7/OX, signs credit notes, and review-gates ambiguous legacy O0', async () => {
    const events: any[] = [];
    const taxRepo = {
      upsertPeriod: async () => ({ id: 'period-1', status: 'OPEN' }),
      findEventByIdempotencyKey: async () => null,
      supersedeEvent: async () => undefined,
      upsertEvent: async (input: any) => { events.push(input); },
      createIssue: async () => undefined,
    } as any;
    const docSource = { findIssuedWithVatByCompany: async () => [
      outputDocument('tax-7', 'TAX_INVOICE', 'O7', '100.0000', '7.0000'),
      outputDocument('tax-x', 'TAX_INVOICE', 'OX', '50.0000', '0.0000'),
      outputDocument('tax-0', 'TAX_INVOICE', 'O0', '25.0000', '0.0000'),
      outputDocument('credit-7', 'CREDIT_NOTE', 'O7', '10.0000', '0.7000'),
    ] } as any;
    const expenseSource = {
      findConfirmedWithVatByCompany: async () => [],
      findConfirmedWithWhtByCompany: async () => [],
    } as any;

    const result = await new SyncTaxEventsUseCase(taxRepo, docSource, expenseSource, noWhtPayments).execute('company-1');

    assert.equal(result.vatOutputCreated, 3);
    assert.equal(result.reviewIssuesCreated, 1);
    assert.deepEqual(events.map((event) => [event.eventType, event.outputTaxCode, event.taxableBase, event.taxAmount]), [
      ['VAT_OUTPUT', 'O7', '100.0000', '7.0000'],
      ['VAT_EXEMPT', 'OX', '50.0000', '0.0000'],
      ['VAT_OUTPUT', 'O7', '-10.0000', '-0.7000'],
    ]);
  });

  it('does not double-negate a retried credit-note amount', () => {
    assert.equal(signedOutputAmount('CREDIT_NOTE', '-7.0000'), '-7.0000');
    assert.equal(signedOutputAmount('CREDIT_NOTE', '0.0000'), '0.0000');
  });
});
