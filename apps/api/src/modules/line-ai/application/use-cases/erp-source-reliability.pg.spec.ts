import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import Decimal from 'decimal.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../generated/prisma/client';
import type { PrismaService } from '../../../../common/database/prisma.service';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { PrismaAccountingRepository } from '../../../accounting-documents/infrastructure/prisma-accounting.repository';
import { PrismaBankingRepository } from '../../../banking/infrastructure/prisma-banking.repository';

const url = process.env.BILLING_TEST_DATABASE_URL;

test('CI03-CI05 ERP source aggregate remains exact and snapshot-consistent on real PostgreSQL', { skip: !url }, async (t) => {
  const parsed = new URL(url!);
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok((parsed.port === '15439' && parsed.pathname === '/watchdog_bms_ai_reliability_20260927')
    || (parsed.port === '5432' && parsed.pathname === '/watchdog_postmark_ci'));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 10 }) });
  const tag = `erp-source-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-co`;
  const userId = `${tag}-user`;
  const branchA = `${tag}-a`;
  const branchB = `${tag}-b`;

  try {
    try { await client.$queryRaw`SELECT 1`; } catch (error) { return t.skip(`PostgreSQL unavailable: ${String(error)}`); }
    await client.company.create({ data: { id: companyId, name: 'ERP source reliability fixture' } });
    await client.user.create({ data: { id: userId, displayName: 'ERP source reliability fixture' } });
    await client.branch.createMany({ data: [
      { id: branchA, companyId, code: 'A', name: 'Branch A', createdByUserId: userId },
      { id: branchB, companyId, code: 'B', name: 'Branch B', createdByUserId: userId },
    ] });
    const base = {
      companyId, createdByUserId: userId, expenseDate: new Date('2026-09-15T00:00:00.000Z'),
      status: 'CONFIRMED' as const, subtotalAmount: '0', discountAmount: '0', taxableAmount: '0',
      vatAmount: '0', whtAmount: '0', netPayableAmount: '0', paidAmount: '0', outstandingAmount: '0',
    };
    await client.expenseRecord.createMany({ data: [
      { ...base, id: `${tag}-a-thb`, branchId: branchA, currency: 'THB', grandTotalAmount: '90071992547409.9300' },
      { ...base, id: `${tag}-a-usd`, branchId: branchA, currency: 'USD', grandTotalAmount: '12.3400' },
      { ...base, id: `${tag}-central`, branchId: null, currency: 'THB', grandTotalAmount: '100.0000' },
      { ...base, id: `${tag}-b`, branchId: branchB, currency: 'THB', grandTotalAmount: '200.0000' },
      { ...base, id: `${tag}-race`, branchId: branchA, currency: 'THB', grandTotalAmount: '1.0000' },
    ] });

    const repo = new PrismaExpenseRepository({ client } as PrismaService);
    const filter = { companyId, branchId: branchA, fromDate: '2026-09-01', toDate: '2026-09-30' };
    let stop = false;
    const writer = (async () => {
      let amount = '1.0000';
      while (!stop) {
        amount = amount === '1.0000' ? '2.0000' : '1.0000';
        await client.expenseRecord.update({ where: { id: `${tag}-race` }, data: { grandTotalAmount: amount } });
      }
    })();

    try {
      for (let index = 0; index < 12; index += 1) {
        const snapshot = await repo.readAiExpenseSummary(filter, { branchIds: [branchA, branchB] }, 2);
        assert.equal(snapshot.total, 3, 'selected Branch A excludes Branch B and central/null rows');
        assert.equal(snapshot.byCurrency.reduce((sum, row) => sum + row.count, 0), snapshot.total);
        assert.equal(snapshot.byStatus.reduce((sum, row) => sum + row.count, 0), snapshot.total);
        assert.deepEqual(snapshot.byCurrency.map((row) => row.currency).sort(), ['THB', 'USD'], 'mixed currencies stay separate');
        const thb = snapshot.byCurrency.find((row) => row.currency === 'THB')!;
        assert.ok([
          '90071992547410.93', '90071992547411.93',
        ].some((expected) => new Decimal(thb.totalAmount).eq(expected)), `unexpected exact THB sum ${thb.totalAmount}`);
        assert.equal(snapshot.items.every((row) => [`${tag}-a-thb`, `${tag}-a-usd`, `${tag}-race`].includes(row.id)), true);
        assert.equal(snapshot.hasMore, true);
        assert.ok(snapshot.nextCursorSource);
      }
    } finally {
      stop = true;
      await writer;
    }

    await client.expenseRecord.create({ data: { ...base, id: `${tag}-voided`, branchId: branchA,
      status: 'VOIDED', currency: 'THB', grandTotalAmount: '7.0000' } });
    const report = await repo.readReportSummary(filter, { branchIds: [branchA, branchB] });
    assert.equal(report.reduce((sum, row) => sum + row.count, 0), 4, 'all-status web/export population retains VOIDED');
    assert.equal(report.find(row => row.status === 'VOIDED')?.grandTotalAmount, '7.0000');
    assert.equal(report.find(row => row.currency === 'USD')?.grandTotalAmount, '12.3400');
    assert.ok(['90071992547410.9300', '90071992547411.9300'].includes(report.find(row => row.status === 'CONFIRMED' && row.currency === 'THB')!.grandTotalAmount));
    assert.equal((await repo.readAiExpenseSummary(filter, { branchIds: [branchA, branchB] }, 2)).total, 3,
      'AI default excludes VOIDED without changing the all-status report contract');
    assert.equal((await repo.readReportSummary({ ...filter, createdByUserId: 'other-user' }, { branchIds: [branchA] })).length, 0);

    const invoice = { companyId, branchId: branchA, documentType: 'INVOICE' as const,
      documentDate: new Date('2026-09-15T00:00:00Z'), currency: 'THB', vatMode: 'NO_VAT' as const,
      subtotalAmount: '90071992547409.93', taxableAmount: '90071992547409.93', grandTotalAmount: '90071992547409.93',
      outstandingAmount: '90071992547409.93', paidAmount: '0', paymentStatus: 'UNPAID' as const, createdByUserId: userId };
    await client.accountingDocument.createMany({ data: [
      ...(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'VOIDED'] as const).map(status => ({ ...invoice, id: `${tag}-invoice-${status}`, status })),
      { ...invoice, id: `${tag}-invoice-issued`, status: 'ISSUED' },
      { ...invoice, id: `${tag}-invoice-credited`, status: 'CREDITED', outstandingAmount: '0.07' },
      { ...invoice, id: `${tag}-invoice-usd`, status: 'ISSUED', currency: 'USD', outstandingAmount: '12.34' },
      { ...invoice, id: `${tag}-invoice-central`, status: 'ISSUED', branchId: null },
      { ...invoice, id: `${tag}-invoice-b`, status: 'ISSUED', branchId: branchB },
    ] });
    const receivables = await new PrismaAccountingRepository({ client } as PrismaService)
      .aggregateOpenReceivables({ companyId, branchId: branchA }, [branchA, branchB]);
    assert.equal(receivables.openCount, 3, 'receivables exclude drafts/unissued/voided, other branches and central rows');
    assert.deepEqual(receivables.items.map(row => row.id).sort(), [`${tag}-invoice-credited`, `${tag}-invoice-issued`, `${tag}-invoice-usd`].sort());
    assert.deepEqual(receivables.totalsByCurrency.sort((a, b) => a.currency.localeCompare(b.currency)), [
      { currency: 'THB', count: 2, outstandingAmount: '90071992547410.00' },
      { currency: 'USD', count: 1, outstandingAmount: '12.34' },
    ], 'issued receivables retain exact Decimal and separate currency totals');

    const accountA = await client.bankAccount.create({ data: {
      id: `${tag}-bank-a`, companyId, branchId: branchA, displayName: 'Bank A', currency: 'THB', createdByUserId: userId,
    } });
    await client.bankAccount.create({ data: {
      id: `${tag}-bank-b`, companyId, branchId: branchB, displayName: 'Bank B', currency: 'THB', createdByUserId: userId,
    } });
    await client.bankStatementLine.createMany({ data: [
      {
        id: `${tag}-line-unmatched`, companyId, bankAccountId: accountA.id, lineHash: `${tag}-hash-1`,
        postedDate: new Date('2026-09-20T00:00:00Z'), description: 'unmatched', direction: 'DEPOSIT',
        signedAmount: '10.0000', status: 'UNMATCHED', currency: 'THB', createdByUserId: userId,
      },
      {
        id: `${tag}-line-matched`, companyId, bankAccountId: accountA.id, lineHash: `${tag}-hash-2`,
        postedDate: new Date('2026-09-21T00:00:00Z'), description: 'matched', direction: 'WITHDRAWAL',
        signedAmount: '-2.0000', status: 'MATCHED', currency: 'THB', createdByUserId: userId,
      },
    ] });
    await client.bankAdjustment.create({ data: {
      id: `${tag}-adjustment`, companyId, bankAccountId: accountA.id, category: 'BANK_FEE', status: 'PENDING_APPROVAL',
      adjustmentDate: new Date('2026-09-21T00:00:00Z'), description: 'fee', signedAmount: '-1.0000', currency: 'THB', createdByUserId: userId,
    } });
    await client.bankReconciliationSession.createMany({ data: [
      {
        id: `${tag}-completed`, companyId, bankAccountId: accountA.id, sessionNumber: `${tag}-completed`,
        periodStartDate: new Date('2026-09-01T00:00:00Z'), periodEndDate: new Date('2026-09-20T00:00:00Z'),
        closingStatementBalanceAmount: '1234.5600', currency: 'THB', status: 'COMPLETED',
        completedAt: new Date('2026-09-20T02:00:00Z'), createdByUserId: userId,
      },
      {
        id: `${tag}-draft`, companyId, bankAccountId: accountA.id, sessionNumber: `${tag}-draft`,
        periodStartDate: new Date('2026-09-21T00:00:00Z'), periodEndDate: new Date('2026-09-21T00:00:00Z'),
        closingStatementBalanceAmount: '9999.0000', currency: 'THB', status: 'DRAFT', createdByUserId: userId,
      },
    ] });
    const bankSnapshot = await new PrismaBankingRepository({ client } as PrismaService)
      .readCashPositionSnapshot(companyId, [branchA]);
    assert.equal(bankSnapshot.accounts.length, 1, 'branch-scoped caller cannot discover Bank B');
    assert.deepEqual(bankSnapshot.accounts[0], {
      companyId, bankAccountId: accountA.id, bankAccountDisplayName: 'Bank A', currency: 'THB',
      lastReconciledDate: '2026-09-20T02:00:00.000Z', lastReconciledBalance: '1234.56',
      unreconciledLineCount: 1, unmatchedLineCount: 1, pendingAdjustmentCount: 1,
      lastStatementDate: '2026-09-21T00:00:00.000Z',
    });
  } finally {
    await client.company.deleteMany({ where: { id: companyId } }).catch(() => undefined);
    await client.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await client.$disconnect();
  }
});
