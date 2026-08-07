import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import { CreateManualStatementLineDto, CreateReconciliationSessionDto } from './banking.dtos';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

const accepts = (metatype: any, body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype });

async function rejects(metatype: any, body: Record<string, unknown>, label?: string) {
  await assert.rejects(
    () => pipe.transform(body, { type: 'body', metatype }),
    BadRequestException,
    label ?? `expected rejection for ${JSON.stringify(body)}`,
  );
}

describe('CreateManualStatementLineDto', () => {
  const withdrawal = {
    lineHash: 'manual:2026-07-29:withdraw:1',
    postedDate: '2026-07-29',
    description: 'โอนออก ค่าสินค้า',
    direction: 'WITHDRAWAL',
    signedAmount: '-1500.00',
    debitAmount: '1500.00',
    currency: 'THB',
  };

  it('accepts a negative signedAmount — a withdrawal is signed money', async () => {
    const out = await accepts(CreateManualStatementLineDto, withdrawal);
    assert.equal(out.signedAmount, '-1500.00');
    assert.equal(out.direction, 'WITHDRAWAL');
  });

  it('accepts a deposit with a running balance and the optional descriptors', async () => {
    const out = await accepts(CreateManualStatementLineDto, {
      ...withdrawal, direction: 'DEPOSIT', signedAmount: '1500.00', debitAmount: undefined,
      creditAmount: '1500.00', runningBalanceAmount: '-250.00', valueDate: '2026-07-30',
      counterpartyName: 'ACME', bankReference: 'REF1', chequeNumber: '00123', rowNumber: 4,
      normalizedDescription: 'transfer in',
    });
    assert.equal(out.runningBalanceAmount, '-250.00', 'an overdrawn balance is legitimate');
  });

  it('rejects an unknown direction and a malformed amount or date', async () => {
    await rejects(CreateManualStatementLineDto, { ...withdrawal, direction: 'CREDIT' });
    await rejects(CreateManualStatementLineDto, { ...withdrawal, signedAmount: '(1,500.00)' });
    await rejects(CreateManualStatementLineDto, { ...withdrawal, postedDate: '29/07/2026' });
    await rejects(CreateManualStatementLineDto, { ...withdrawal, currency: 'baht' });
  });

  it('rejects the provenance fields the use case sets itself', async () => {
    // sourceType MANUAL, the account, the tenant, and the actor are all server-set —
    // a caller must not be able to pass a line off as imported.
    for (const poison of [{ sourceType: 'IMPORT' }, { importId: 'imp_1' }, { companyId: 'other' }, { bankAccountId: 'acct_other' }, { createdByUserId: 'someone' }, { status: 'MATCHED' }]) {
      await rejects(CreateManualStatementLineDto, { ...withdrawal, ...poison });
    }
  });
});

describe('CreateReconciliationSessionDto', () => {
  // BankingPages.tsx reconciliation form
  const valid = {
    bankAccountId: 'acct_1', periodStartDate: '2026-07-01', periodEndDate: '2026-07-31',
    openingStatementBalanceAmount: '0.00', closingStatementBalanceAmount: '12500.00', currency: 'THB',
  };

  it('accepts the reconciliation form payload', async () => {
    const out = await accepts(CreateReconciliationSessionDto, valid);
    assert.equal(out.closingStatementBalanceAmount, '12500.00');
  });

  it('accepts negative statement balances', async () => {
    const out = await accepts(CreateReconciliationSessionDto, { ...valid, openingStatementBalanceAmount: '-800.00' });
    assert.equal(out.openingStatementBalanceAmount, '-800.00');
  });

  it('rejects derived balances and status the session computes', async () => {
    for (const poison of [{ companyId: 'other' }, { status: 'COMPLETED' }, { reconciledBalanceAmount: '1' }, { createdByUserId: 'someone' }]) {
      await rejects(CreateReconciliationSessionDto, { ...valid, ...poison });
    }
  });

  it('requires the account, the period, and both balances', async () => {
    await rejects(CreateReconciliationSessionDto, { ...valid, bankAccountId: '' });
    await rejects(CreateReconciliationSessionDto, { ...valid, periodEndDate: undefined as unknown as string });
    await rejects(CreateReconciliationSessionDto, { ...valid, closingStatementBalanceAmount: 'n/a' });
  });
});
