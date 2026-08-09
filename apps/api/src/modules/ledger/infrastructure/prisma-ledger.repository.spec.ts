import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { PrismaLedgerRepository } from './prisma-ledger.repository';

function repoCapturingCreate() {
  const captured: { data?: any } = {};
  const prisma = {
    client: {
      journalEntry: {
        create: async ({ data }: any) => {
          captured.data = data;
          return { ...data, id: 'journal-1', lines: [] };
        },
      },
    },
  };
  return { repo: new PrismaLedgerRepository(prisma as any), captured };
}

const entry = (lines: any[]) => ({
  companyId: 'company-1', periodId: 'period-1', entryNumber: 'JV-1', entryType: 'MANUAL' as const,
  entryDate: new Date('2026-08-10T00:00:00.000Z'), createdByUserId: 'user-1', lines,
});

describe('PrismaLedgerRepository.createJournalEntry', () => {
  // The DTO accepts 14 integer digits and 4 decimals — 18 significant, matching Decimal(18,4).
  // float64 holds ~15-16, so routing the amount through parseFloat spent the difference. These
  // are the largest values the API already accepts, not hypothetical ones.
  it('writes the amount a caller sent, digit for digit', async () => {
    const { repo, captured } = repoCapturingCreate();
    await repo.createJournalEntry(entry([
      { accountId: 'acc-debit', debitAmount: '12345678901234.5678' },
      { accountId: 'acc-credit', creditAmount: '99999999999999.9999' },
    ]) as any);

    const [debit, credit] = captured.data.lines.create;
    assert.equal(debit.debitAmount, '12345678901234.5678');
    assert.equal(credit.creditAmount, '99999999999999.9999');
    // Same assertion stated as the thing that actually matters: no satang moved.
    assert.equal(new Decimal(debit.debitAmount).minus('12345678901234.5678').toString(), '0');
    assert.equal(new Decimal(credit.creditAmount).minus('99999999999999.9999').toString(), '0');
  });

  it('defaults the unused side of a line to zero', async () => {
    const { repo, captured } = repoCapturingCreate();
    await repo.createJournalEntry(entry([
      { accountId: 'acc-debit', debitAmount: '100.00' },
      { accountId: 'acc-credit', creditAmount: '100.00' },
    ]) as any);

    const [debit, credit] = captured.data.lines.create;
    assert.equal(debit.creditAmount, '0');
    assert.equal(credit.debitAmount, '0');
  });
});
