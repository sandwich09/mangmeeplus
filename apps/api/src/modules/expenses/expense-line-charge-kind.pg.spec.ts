/**
 * `ExpenseLine.chargeKind` against real PostgreSQL.
 *
 * Two things no in-memory fake can answer. First, whether migration
 * `20260905160000_expense_line_charge_kind` actually applies — the enum type has to exist before
 * the column can reference it, and a fake that stores a plain string would report green against a
 * database that rejects every write. Second, whether a charge row survives the round trip with its
 * kind intact, which is what `subtotalAmount` now depends on: the whole point of the column is that
 * the tax base counts an additional charge exactly once, and a kind that comes back null silently
 * turns a service charge back into a product line.
 *
 * Run with (the scratch database this was proved on, or the local docker one):
 *   EXPENSE_CHARGE_KIND_TEST_DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms_chargekind_scratch?schema=public' \
 *     npx tsx --test src/modules/expenses/expense-line-charge-kind.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { EXPENSE_LINE_CHARGE_KINDS, expenseLineCharges } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { calcDocumentTotals, calcLineTotals, expenseTotalsIdentityError } from './domain/logic/expense-totals.logic';

const databaseUrl = process.env['EXPENSE_CHARGE_KIND_TEST_DATABASE_URL'];

describe('expense line charge kind on real PostgreSQL', { skip: !databaseUrl }, () => {
  it('applies the migration and round-trips a charge line whose totals satisfy the identity', async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
    // Localhost alone is NOT proof of a local database: the production access recipe port-forwards
    // prod to 127.0.0.1 through SSM. This spec writes rows, so it also requires a database whose
    // name says it is the local docker one (or a scratch copy of it) before it creates anything.
    assert.match(url.pathname, /^\/watchdog_bms(_[a-z0-9_]+)?$/, 'refusing to write to anything but the local docker database');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `chargekind-${randomUUID().slice(0, 8)}`;

    try {
      // The migration itself: without the enum type and column this read throws, and no amount of
      // application code can make the write below succeed.
      const [{ labels }] = await client.$queryRawUnsafe<{ labels: string[] }[]>(
        `SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
           FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'ExpenseLineChargeKind'`,
      );
      assert.deepEqual(labels, [...EXPENSE_LINE_CHARGE_KINDS]);

      // A restaurant bill exactly like the UAT 2026-09-03 one: 1,520.00 of food, a 10% service
      // charge, 7% VAT on both.
      const vatMode = 'VAT_EXCLUDED' as const;
      const rows = [
        { lineNumber: 1, chargeKind: null, description: 'อาหาร', quantity: '1', unitPrice: '1520' },
        { lineNumber: 2, chargeKind: 'SERVICE_CHARGE' as const, description: 'ค่าบริการ 10%', quantity: '1', unitPrice: '152' },
      ];
      const lines = rows.map((row) => ({
        ...row,
        totals: calcLineTotals({ quantity: row.quantity, unitPrice: row.unitPrice, vatRate: '0.07', vatMode }),
      }));
      const totals = calcDocumentTotals({ lines: lines.map((line) => ({ ...line.totals, chargeKind: line.chargeKind })) });
      assert.equal(expenseTotalsIdentityError({ vatMode, lines: lines.map((line) => ({ ...line.totals, chargeKind: line.chargeKind })), totals }), null);
      // The charge is in the base and out of the goods subtotal — the reason the column exists.
      assert.equal(totals.subtotalAmount, '1520.0000');
      assert.equal(totals.taxableAmount, '1672.0000');
      assert.equal(totals.vatAmount, '117.0400');
      assert.equal(totals.grandTotalAmount, '1789.0400');

      await client.company.create({ data: { id: `${tag}-co`, name: 'Charge Kind Test' } });
      await client.user.create({ data: { id: `${tag}-user`, displayName: 'Charge Kind Test' } });
      const expense = await client.expenseRecord.create({
        data: {
          id: `${tag}-exp`, companyId: `${tag}-co`, createdByUserId: `${tag}-user`,
          expenseDate: new Date('2026-09-03T00:00:00.000Z'), vatMode, ...totals,
          lines: {
            create: lines.map((line) => ({
              companyId: `${tag}-co`, lineNumber: line.lineNumber, description: line.description,
              chargeKind: line.chargeKind, quantity: line.quantity, unitPrice: line.unitPrice,
              taxableAmount: line.totals.taxableAmount, vatRate: '0.07', vatAmount: line.totals.vatAmount,
              lineSubtotalAmount: line.totals.lineSubtotalAmount, lineTotalAmount: line.totals.lineTotalAmount,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      assert.deepEqual(expense.lines.map((line) => line.chargeKind), [null, 'SERVICE_CHARGE']);
      assert.deepEqual(
        expenseLineCharges(expense.lines.map((line) => ({
          chargeKind: line.chargeKind, lineSubtotalAmount: line.lineSubtotalAmount.toString(), vatAmount: line.vatAmount.toString(),
        }))),
        // Prisma Decimal stringifies without trailing zeros, exactly as the repository's `mapLine` does.
        [{ kind: 'SERVICE_CHARGE', label: 'ค่าบริการ', amount: '152', vatAmount: '10.64' }],
      );

      // ROUNDING is the one kind the column may carry below zero, and Decimal(18,4) is signed.
      const rounding = await client.expenseLine.create({
        data: {
          companyId: `${tag}-co`, expenseId: expense.id, lineNumber: 3, description: 'ปัดเศษ',
          chargeKind: 'ROUNDING', quantity: '1', unitPrice: '-0.5',
          taxableAmount: '-0.5', vatAmount: '0', lineSubtotalAmount: '-0.5', lineTotalAmount: '-0.5',
        },
      });
      assert.equal(rounding.lineSubtotalAmount.toString(), '-0.5');

      await assert.rejects(
        client.expenseLine.create({
          data: {
            companyId: `${tag}-co`, expenseId: expense.id, lineNumber: 4, description: 'ไม่มีชนิดนี้',
            chargeKind: 'TRUCK_FEE' as never, quantity: '1', unitPrice: '1',
          },
        }),
        (error: unknown) => error instanceof Error,
        'the database, not only the application, refuses a charge kind outside the enum',
      );
    } finally {
      await client.expenseLine.deleteMany({ where: { companyId: `${tag}-co` } });
      await client.expenseRecord.deleteMany({ where: { companyId: `${tag}-co` } });
      await client.company.deleteMany({ where: { id: `${tag}-co` } });
      await client.user.deleteMany({ where: { id: `${tag}-user` } });
      await client.$disconnect();
    }
  });
});
