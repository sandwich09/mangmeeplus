import { Injectable, ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';
import { getAgingBucket, AGING_BUCKET_LABELS, d, decStr } from '../../domain/logic/procurement.logic';
import type { ApAgingResult, SupplierStatement } from '@watchdog-bms/contracts';

@Injectable()
export class GetApAgingUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, asOfDate?: string, supplierId?: string): Promise<ApAgingResult> {
    if (!ctx.permissions.includes('procurement.ap.report')) throw new ForbiddenException();
    const asOf = asOfDate ? new Date(asOfDate) : new Date();
    const rows = await this.repo.getApAgingData(ctx.companyId, asOf, supplierId);

    const supplierTotals = new Map<string, { not_due: string; '0_30': string; '31_60': string; '61_90': string; '91_plus': string; total: string }>();
    let grandTotal = d('0');

    for (const row of rows) {
      const bucket = getAgingBucket(row.dueDate, asOf);
      if (!supplierTotals.has(row.supplierId)) {
        supplierTotals.set(row.supplierId, { not_due: '0', '0_30': '0', '31_60': '0', '61_90': '0', '91_plus': '0', total: '0' });
      }
      const st = supplierTotals.get(row.supplierId)!;
      st[bucket] = decStr(d(st[bucket]).add(d(row.outstandingAmount)));
      st.total = decStr(d(st.total).add(d(row.outstandingAmount)));
      grandTotal = grandTotal.add(d(row.outstandingAmount));
    }

    const bucketDefs: { key: 'not_due' | '0_30' | '31_60' | '61_90' | '91_plus'; minDays: number; maxDays?: number }[] = [
      { key: 'not_due', minDays: -Infinity, maxDays: -1 },
      { key: '0_30', minDays: 0, maxDays: 30 },
      { key: '31_60', minDays: 31, maxDays: 60 },
      { key: '61_90', minDays: 61, maxDays: 90 },
      { key: '91_plus', minDays: 91 },
    ];
    const suppliers = Array.from(supplierTotals.entries()).map(([sid, st]) => ({
      supplierId: sid,
      supplierDisplayName: sid,
      currency: 'THB',
      totalOutstanding: st.total,
      buckets: bucketDefs.map(b => ({ label: AGING_BUCKET_LABELS[b.key], minDays: b.minDays === -Infinity ? 0 : b.minDays, maxDays: b.maxDays, amount: st[b.key], count: 0 })),
    }));

    return { asOfDate: asOf.toISOString().slice(0, 10), currency: 'THB', totalOutstanding: decStr(grandTotal), suppliers };
  }
}

@Injectable()
export class GetSupplierStatementUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, supplierId: string, fromDate?: string, toDate?: string): Promise<SupplierStatement> {
    if (!ctx.permissions.includes('procurement.ap.report')) throw new ForbiddenException();
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;
    const { bills, payments } = await this.repo.getSupplierStatementData(ctx.companyId, supplierId, from, to);

    let runningBalance = d('0');
    const rawEntries: { date: string; type: 'bill' | 'payment'; documentNumber?: string; amount: string; runningBalance: string }[] = [];

    for (const b of bills) {
      runningBalance = runningBalance.add(d(b.netPayableAmount));
      rawEntries.push({ date: b.billDate.toISOString().slice(0, 10), type: 'bill', documentNumber: b.vendorBillNumber, amount: b.netPayableAmount, runningBalance: decStr(runningBalance) });
    }
    for (const p of payments) {
      runningBalance = runningBalance.sub(d(p.netPaidAmount));
      rawEntries.push({ date: p.paymentDate.toISOString().slice(0, 10), type: 'payment', documentNumber: p.paymentNumber, amount: p.netPaidAmount, runningBalance: decStr(runningBalance) });
    }

    rawEntries.sort((a, b) => a.date.localeCompare(b.date));
    const entries = rawEntries.map(e => ({ date: e.date, type: e.type, documentNumber: e.documentNumber, description: e.type === 'bill' ? 'ใบวางบิล' : 'ชำระเงิน', amount: e.amount, runningBalance: e.runningBalance }));

    return { supplierId, supplierDisplayName: supplierId, fromDate: from?.toISOString().slice(0, 10), toDate: to?.toISOString().slice(0, 10), openingBalance: '0', closingBalance: decStr(runningBalance), currency: 'THB', entries };
  }
}
