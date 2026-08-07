import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXPENSE_PENDING_STATUSES } from '@watchdog-bms/contracts';
import { ExpenseSummaryProvider } from './expense-summary.provider';

const PERIOD = { periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-08-31T23:59:59Z') };

function makeSut(opts: {
  confirmedTotal?: string | number;
  pendingReview?: number;
  outstanding?: string | number;
  throws?: boolean;
} = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const expenseRecord = {
    aggregate: async (args: any) => {
      if (opts.throws) throw new Error('db down');
      calls.push(args.where);
      return args._sum?.outstandingAmount
        ? { _sum: { outstandingAmount: opts.outstanding ?? 0 } }
        : { _sum: { grandTotalAmount: opts.confirmedTotal ?? 0 }, _count: { _all: 0 } };
    },
    count: async (args: any) => {
      if (opts.throws) throw new Error('db down');
      calls.push(args.where);
      return opts.pendingReview ?? 0;
    },
  };
  const prisma = { client: { expenseRecord } } as any;
  return { provider: new ExpenseSummaryProvider(prisma), calls };
}

const input = () => ({ companyId: 'c1', ...PERIOD });

describe('ExpenseSummaryProvider', () => {
  it('declares the Expenses entitlement and the single key that may read the card', () => {
    const { provider } = makeSut();
    assert.equal(provider.featureKey, 'expenses');
    // expense.read_own must never unlock company-wide totals.
    assert.deepEqual([...provider.readPermissions], ['expense.read']);
  });

  it('returns period totals, pending review count and outstanding', async () => {
    const { provider, calls } = makeSut({ confirmedTotal: '1250.5000', pendingReview: 3, outstanding: '400.0000' });
    const [widget] = await provider.collectMetrics(input());

    assert.equal(widget.unavailableReason, undefined);
    assert.equal(widget.module, 'expenses');
    assert.deepEqual(
      widget.metrics.map((m) => [m.key, m.value, m.severity]),
      [
        ['expense_total_in_period', 1250.5, 'normal'],
        ['expense_pending_review', 3, 'warning'],
        ['expense_unpaid_outstanding', 400, 'warning'],
      ],
    );
    // The money metric is period-scoped; the two worklist metrics are current-state.
    assert.deepEqual((calls[0] as any).expenseDate, { gte: PERIOD.periodStart, lte: PERIOD.periodEnd });
    assert.equal((calls[1] as any).expenseDate, undefined);
    assert.equal((calls[2] as any).expenseDate, undefined);
  });

  it('counts ใบเสร็จรอตรวจ from DRAFT onward, by the shared rule the expenses list uses', async () => {
    const { provider, calls } = makeSut({ pendingReview: 4 });
    await provider.collectMetrics(input());

    // The drift this guards: the list counted DRAFT and this card did not, so the same Thai word
    // reported different numbers on two screens. Both now read the contracts constant.
    assert.deepEqual((calls[1] as any).status, { in: [...EXPENSE_PENDING_STATUSES] });
    assert.deepEqual([...EXPENSE_PENDING_STATUSES], ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']);
  });

  it('stays normal severity when there is nothing pending or outstanding', async () => {
    const { provider } = makeSut({ confirmedTotal: 0, pendingReview: 0, outstanding: 0 });
    const [widget] = await provider.collectMetrics(input());
    assert.deepEqual(widget.metrics.map((m) => m.severity), ['normal', 'normal', 'normal']);
  });

  it('degrades to an unavailable widget instead of throwing when the query fails', async () => {
    const { provider } = makeSut({ throws: true });
    const [widget] = await provider.collectMetrics(input());
    assert.equal(widget.unavailableReason, 'ข้อมูลค่าใช้จ่ายไม่พร้อมใช้งาน');
  });
});
