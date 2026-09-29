/**
 * Sales-event report (docs/specs/sales-event-discounts-spec-th.md §10, SD-E18).
 *
 * Counts the tickets ISSUED in the month range, per event → batch → เซลล์, and what the discount
 * path gave away. It is a separate figure on purpose: `SalesAttribution` is never read or written
 * here, so a ticket can never become sales credit (SD-Q3). Scope is the report's own rule
 * (`visibleAgents`, spec §9): a lead and SYSTEM_ADMIN see every team, optionally narrowed.
 * No LINE identity and no document number leaves this service.
 */
import { Injectable } from '@nestjs/common';
import type { SalesEventReport } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { aggregateEventReport, emptyEventReportFigures } from '../domain/sales-event-report.logic';
import { SalesReportsService, salesReportRange, type SalesReportQuery } from './sales-reports.service';

/** ponytail: an in-memory fold over at most this many tickets; move to SQL GROUP BY if events grow past it. */
const TICKET_ROW_LIMIT = 5_000;

@Injectable()
export class SalesEventReportsService {
  constructor(private readonly prisma: PrismaService, private readonly reports: SalesReportsService) {}

  async report(ctx: RequestContext, query: SalesReportQuery): Promise<SalesEventReport> {
    const range = salesReportRange(query);
    const salesUserIds = await this.reports.visibleAgents(ctx, query);
    const tickets = salesUserIds === null ? [] : await this.prisma.client.salesEventTicket.findMany({
      where: { createdAt: { gte: range.start, lt: range.end }, ...(salesUserIds ? { salesUserId: { in: salesUserIds } } : {}) },
      select: { batchId: true, salesUserId: true, state: true, redeemedAs: true, expiresAt: true,
        discountSatang: true, appliedDiscountSatang: true, invoiceId: true },
      orderBy: { createdAt: 'desc' },
      take: TICKET_ROW_LIMIT + 1,
    });
    const rows = tickets.slice(0, TICKET_ROW_LIMIT);
    if (rows.length === 0) return { from: range.from, to: range.to, events: [], totals: emptyEventReportFigures(), truncated: false };
    // Only a USED first-bill discount has a bill whose money belongs in this report.
    const invoiceIds = rows.flatMap((row) => row.state === 'USED' && row.redeemedAs === 'DISCOUNT' && row.invoiceId ? [row.invoiceId] : []);
    const [batches, invoices, agents] = await Promise.all([
      this.prisma.client.salesEventBatch.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.batchId))] } },
        select: { id: true, eventName: true, batchName: true } }),
      invoiceIds.length === 0 ? [] : this.prisma.client.billingInvoice.findMany({ where: { id: { in: invoiceIds } },
        select: { id: true, paidSatang: true, refundedSatang: true } }),
      this.reports.agentIndex(rows.map((row) => row.salesUserId)),
    ]);
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const report = aggregateEventReport(
      rows.map((row) => ({ ...row, invoice: row.invoiceId ? invoiceById.get(row.invoiceId) ?? null : null })),
      new Map(batches.map((batch) => [batch.id, batch])),
      (userId) => agents.get(userId)?.displayName ?? '',
      new Date(),
    );
    return { from: range.from, to: range.to, ...report, truncated: tickets.length > TICKET_ROW_LIMIT };
  }
}
