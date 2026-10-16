import { filedLineCoversPayment } from './withholding-filing-state';
import { civilDate } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';

type PaymentPeriod = { formType: string; periodKey: string };
/** Frozen filed lines own new locks; an unfiled snapshot cannot release a legacy month lock. */
export async function filedWithholdingPaymentPeriods(db: Prisma.TransactionClient, companyId: string, sourceType: string, sourceId: string, paymentPeriod?: PaymentPeriod, sourceLineKey?: string) {
  const paymentPapers = sourceLineKey ? await db.whtFiling.findMany({ where: { companyId, status: 'FILED', lines: { some: { sourceType, sourceId } } }, include: { lines: true } }) : [];
  const filed = sourceLineKey ? paymentPapers.filter(p => p.lines.some(l => filedLineCoversPayment(l, { sourceType, sourceId, sourceLineKey }))) : await db.taxPeriod.findMany({ where: { companyId, formType: { in: ['PND3', 'PND53'] },
    whtFilings: { some: { companyId, status: 'FILED', lines: { some: { sourceType, sourceId } } } } },
    select: { formType: true, periodKey: true } });
  const paymentMonths: Prisma.TaxPeriodWhereInput[] = [];
  if (sourceType === 'expense.record' && db.expensePayment && db.company) {
    const [payments, company] = await Promise.all([
      db.expensePayment.findMany({ where: { companyId, expenseId: sourceId, status: 'RECORDED', paidAtConfirmed: true }, select: { paidAt: true } }),
      db.company.findUnique({ where: { id: companyId }, select: { timezone: true } }),
    ]);
    for (const p of payments) for (const formType of ['PND3', 'PND53'] as const) paymentMonths.push({ formType, periodKey: civilDate(p.paidAt, company?.timezone ?? 'Asia/Bangkok').slice(0, 7) });
  }
  const legacy = await db.taxPeriod.findMany({ where: { companyId, formType: { in: ['PND3', 'PND53'] },
    status: { in: ['FILED', 'PAID', 'CLOSED'] },
    OR: [{ taxEvents: { some: { sourceType, sourceId } } }, ...paymentMonths, ...(paymentPeriod ? [paymentPeriod as Prisma.TaxPeriodWhereInput] : [])],
  }, select: { formType: true, periodKey: true, status: true, whtFilings: { where: { status: 'FILED', OR: [{ lines: { some: {} } }, { rowsCertain: true }] }, select: { id: true } } } });
  return [...new Map([...filed, ...legacy.filter(p => ['FILED', 'PAID', 'CLOSED'].includes(p.status) && p.whtFilings?.length === 0)]
    .filter(p => p.formType === 'PND3' || p.formType === 'PND53')
    .map(p => [`${p.formType}:${p.periodKey}`, { formType: p.formType, periodKey: p.periodKey }])).values()];
}
