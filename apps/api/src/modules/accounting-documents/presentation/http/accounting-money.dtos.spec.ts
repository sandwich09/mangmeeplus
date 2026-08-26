import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import { CreateAccountingDocumentDto, CreateAccountingPaymentDto, RecordSimpleIncomeDto, UpdateAccountingDocumentDto } from './accounting-money.dtos';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

const validPayment = {
  direction: 'RECEIVED', method: 'BANK_TRANSFER', amount: '100.00',
  paidAt: '2026-07-18T10:00:00.000Z', allocateToDocumentId: 'doc-1',
};
const validDocument = {
  documentType: 'INVOICE', documentDate: '2026-07-18', currency: 'THB', vatMode: 'NO_VAT',
  lines: [{ lineNumber: 1, description: 'Service', quantity: '1.0000', unitPrice: '100.00', discountAmount: '0.00' }],
};
const validSimpleIncome = {
  idempotencyKey: 'income_retry_001', documentDate: '2026-07-18', vatMode: 'NO_VAT', paymentMethod: 'CASH',
  lines: [{ lineNumber: 1, description: 'Service', quantity: '1.0000', unitPrice: '100.00' }],
};

async function rejects(metatype: any, body: Record<string, unknown>) {
  await assert.rejects(
    () => pipe.transform(body, { type: 'body', metatype }),
    BadRequestException,
    `expected rejection for ${JSON.stringify(body)}`,
  );
}

describe('H-05 accounting money HTTP DTOs', () => {
  it('accepts valid payment and document payloads', async () => {
    assert.equal((await pipe.transform(validPayment, { type: 'body', metatype: CreateAccountingPaymentDto })).amount, '100.00');
    assert.equal((await pipe.transform(validDocument, { type: 'body', metatype: CreateAccountingDocumentDto })).lines.length, 1);
    assert.equal((await pipe.transform(validSimpleIncome, { type: 'body', metatype: RecordSimpleIncomeDto })).paymentMethod, 'CASH');
    assert.equal((await pipe.transform({ expectedUpdatedAt: '2026-08-09T10:00:00.000Z', note: 'แก้ไข' }, { type: 'body', metatype: UpdateAccountingDocumentDto })).note, 'แก้ไข');
    assert.equal((await pipe.transform({ ...validDocument, idempotencyKey: 'invoice-page-001' }, { type: 'body', metatype: CreateAccountingDocumentDto })).idempotencyKey, 'invoice-page-001');
  });

  it('rejects negative, zero, non-finite, exponent, precision, and bound overflow money at the boundary', async () => {
    for (const amount of ['-1', '0', '0.00', 'NaN', 'Infinity', '1e3', '0.001', '100000000000000.00']) {
      await rejects(CreateAccountingPaymentDto, { ...validPayment, amount });
      await rejects(CreateAccountingDocumentDto, {
        ...validDocument,
        lines: [{ ...validDocument.lines[0], unitPrice: amount }],
      });
    }
  });

  it('rejects invalid enums, dates, currency, nested values, and unknown fields', async () => {
    await rejects(CreateAccountingPaymentDto, { ...validPayment, direction: 'TRANSFERRED' });
    await rejects(CreateAccountingPaymentDto, { ...validPayment, paidAt: 'not-a-date' });
    await rejects(CreateAccountingPaymentDto, { ...validPayment, companyId: 'other-company' });
    await rejects(CreateAccountingDocumentDto, { ...validDocument, currency: 'USD' });
    await rejects(CreateAccountingDocumentDto, { ...validDocument, lines: [{ ...validDocument.lines[0], quantity: '0' }] });
    await rejects(CreateAccountingDocumentDto, { ...validDocument, lines: [{ ...validDocument.lines[0], vatAmount: '999.00' }] });
    await rejects(CreateAccountingDocumentDto, { ...validDocument, idempotencyKey: 'short' });
    await rejects(CreateAccountingDocumentDto, { ...validDocument, payloadFingerprint: 'client-must-not-send-this' });
    await rejects(UpdateAccountingDocumentDto, { note: 'missing version' });
    await rejects(UpdateAccountingDocumentDto, { expectedUpdatedAt: 'not-a-date', note: 'bad version' });
    await rejects(UpdateAccountingDocumentDto, { expectedUpdatedAt: '2026-08-09', note: 'version needs an instant' });
    await rejects(UpdateAccountingDocumentDto, { expectedUpdatedAt: '2026-08-09T10:00:00.000Z', lines: [{ ...validDocument.lines[0], quantity: '0' }] });
    await rejects(RecordSimpleIncomeDto, { ...validSimpleIncome, idempotencyKey: 'short' });
    await rejects(RecordSimpleIncomeDto, { ...validSimpleIncome, lines: [] });
    await rejects(RecordSimpleIncomeDto, { ...validSimpleIncome, paymentMethod: 'CRYPTO' });
  });
});
