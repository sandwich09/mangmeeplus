import { Injectable } from '@nestjs/common';
import { EXPENSE_PENDING_STATUSES } from '@watchdog-bms/contracts';
import type { DashboardWidget } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';

/**
 * Expense Summary Dashboard Provider
 * Mirrors InventoryHealthProvider: Prisma directly, read-only, company-scoped, no module import.
 */
@Injectable()
export class ExpenseSummaryProvider {
  readonly moduleKey = 'expenses';
  /** Whether these numbers are computed at all follows the company's Expenses entitlement. */
  readonly featureKey = 'expenses';
  /** Who may see the card once computed. `expense.read_own` is deliberately absent — these metrics
   *  aggregate every expense in the company, which an own-drafts-only role must not see. */
  readonly readPermissions: readonly string[] = ['expense.read'];

  constructor(private readonly prisma: PrismaService) {}

  async collectMetrics(input: {
    companyId: string;
    periodStart: Date;
    periodEnd: Date;
    /** Absent = company-wide. Present = exact branch match, so company-central (branchId null)
     *  rows appear under the combined view and under no individual branch (spec R4) — the same
     *  rule the Expenses list applies to an explicit selection. */
    branchIds?: string[];
  }): Promise<DashboardWidget[]> {
    const { companyId, periodStart, periodEnd, branchIds } = input;
    const computedAt = new Date().toISOString();

    try {
      const href = `/companies/${companyId}/expenses`;
      // ponytail: three counting queries, no shared scan. Fold into one groupBy if this shows up in slow logs.
      const [confirmedInPeriod, pendingReview, unpaid] = await Promise.all([
        this.prisma.client.expenseRecord.aggregate({
          where: { companyId, ...(branchIds && { branchId: { in: branchIds } }), status: 'CONFIRMED', expenseDate: { gte: periodStart, lte: periodEnd } },
          _sum: { grandTotalAmount: true },
          _count: { _all: true },
        }),
        // Owner decision 2026-08-05: counts from DRAFT onward, the same rule the expenses list
        // uses, so the two surfaces stop reporting different numbers for the same Thai word. The
        // metric stays current-state rather than period-scoped — period-scoping it would hide
        // stale unreviewed receipts, which is what this number exists to surface.
        this.prisma.client.expenseRecord.count({
          where: { companyId, ...(branchIds && { branchId: { in: branchIds } }), status: { in: [...EXPENSE_PENDING_STATUSES] } },
        }),
        this.prisma.client.expenseRecord.aggregate({
          where: { companyId, ...(branchIds && { branchId: { in: branchIds } }), status: 'CONFIRMED', paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
          _sum: { outstandingAmount: true },
        }),
      ]);

      const sourceRefs = [{ module: 'expenses', sourceType: 'expense', label: 'รายการค่าใช้จ่าย', href, permissionKey: 'expense.read' }];
      const periodTotal = Number(confirmedInPeriod._sum.grandTotalAmount ?? 0);
      const outstanding = Number(unpaid._sum.outstandingAmount ?? 0);

      const metrics: DashboardWidget['metrics'] = [
        {
          key: 'expense_total_in_period',
          label: 'ค่าใช้จ่ายที่ยืนยันแล้ว',
          value: periodTotal,
          unit: 'บาท',
          severity: 'normal',
          freshness: 'fresh',
          sourceRefs,
          computedAt,
        },
        {
          key: 'expense_pending_review',
          label: 'ใบเสร็จรอตรวจ',
          value: pendingReview,
          unit: 'รายการ',
          severity: pendingReview > 0 ? 'warning' : 'normal',
          freshness: 'fresh',
          sourceRefs,
          computedAt,
        },
        {
          key: 'expense_unpaid_outstanding',
          label: 'ยอดค้างชำระ',
          value: outstanding,
          unit: 'บาท',
          severity: outstanding > 0 ? 'warning' : 'normal',
          freshness: 'fresh',
          sourceRefs,
          computedAt,
        },
      ];

      return [{ key: 'expense_summary', title: 'ค่าใช้จ่ายและใบเสร็จ', kind: 'metric_card', module: 'expenses', metrics, href }];
    } catch {
      return [this.unavailableWidget()];
    }
  }

  private unavailableWidget(): DashboardWidget {
    return {
      key: 'expense_summary',
      title: 'ค่าใช้จ่ายและใบเสร็จ',
      kind: 'metric_card',
      module: 'expenses',
      metrics: [],
      unavailableReason: 'ข้อมูลค่าใช้จ่ายไม่พร้อมใช้งาน',
    };
  }
}
