import { ConflictException } from '@nestjs/common';
import type { FreeExpenseAllowance } from '@watchdog-bms/contracts';
export type { FreeExpenseAllowance } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { bangkokMonthKey } from './company-ai-usage-meter';

export const FREE_EXPENSE_QUOTA_SOURCE = 'FREE_MONTHLY_3' as const;
export const FREE_EXPENSE_MONTHLY_LIMIT = 3;

type QuotaDb = Pick<PrismaService['client'], 'companyOcrUsageEvent'>;

/** Bangkok midnight at the start of the next calendar month, represented as UTC. */
export function freeExpenseQuotaResetAt(monthKey: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new Error('INVALID_OCR_MONTH_KEY');
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year!, month!, 1, -7)).toISOString();
}

/** Pending reservations occupy slots, but only persisted usable results are printed as used. */
export async function readFreeExpenseAllowance(db: QuotaDb, companyId: string, monthKey: string): Promise<FreeExpenseAllowance> {
  const where = { companyId, monthKey, quotaSource: FREE_EXPENSE_QUOTA_SOURCE };
  // One statement keeps success/reservation counts consistent during completion or refund.
  const events = await db.companyOcrUsageEvent.findMany({ where, select: { succeededAt: true } });
  const admitted = events.length;
  const usedCount = events.filter((event) => event.succeededAt !== null).length;
  return { source: FREE_EXPENSE_QUOTA_SOURCE, monthKey, limit: FREE_EXPENSE_MONTHLY_LIMIT, usedCount,
    inFlightCount: admitted - usedCount, remainingCount: Math.max(0, FREE_EXPENSE_MONTHLY_LIMIT - admitted),
    resetAt: freeExpenseQuotaResetAt(monthKey) };
}

export function freeExpenseAllowanceSnapshot(prisma: PrismaService, companyId: string, monthKey = bangkokMonthKey()): Promise<FreeExpenseAllowance> {
  return readFreeExpenseAllowance(prisma.client, companyId, monthKey);
}

/** Call only AFTER a usable result has been persisted. Identity and original month/source are frozen. */
export async function completeCompanyOcrAdmission(prisma: PrismaService, input: {
  companyId: string; sourceRoute: string; requestId: string; eventId: string;
}): Promise<{ completed: boolean; freeAllowance?: FreeExpenseAllowance }> {
  return prisma.client.$transaction((tx) => completeCompanyOcrAdmissionWithinTransaction(tx, input));
}

/** Join the source writer's transaction so durable facts and successful quota commit together. */
export async function completeCompanyOcrAdmissionWithinTransaction(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof completeCompanyOcrAdmission>[1],
): Promise<{ completed: boolean; freeAllowance?: FreeExpenseAllowance }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${input.companyId}`}))`;
  const event = await tx.companyOcrUsageEvent.findUnique({ where: { companyId_sourceRoute_requestId: {
    companyId: input.companyId, sourceRoute: input.sourceRoute, requestId: input.requestId,
  } } });
  if (!event || event.id !== input.eventId) throw new ConflictException({ code: 'OCR_ADMISSION_STALE', message: 'The document read attempt is no longer current.' });
  if (event.quotaSource !== FREE_EXPENSE_QUOTA_SOURCE) return { completed: true };
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ocr-quota:${input.companyId}:${event.monthKey}`}))`;
  await tx.companyOcrUsageEvent.updateMany({ where: { id: event.id, companyId: input.companyId, succeededAt: null },
    data: { succeededAt: new Date() } });
  return { completed: true, freeAllowance: await readFreeExpenseAllowance(tx, input.companyId, event.monthKey) };
}

/** Claim only from the successful source count, never from an admission or a blocked fourth file. */
export async function claimFreeExpenseQuotaNotice(prisma: PrismaService, companyId: string, monthKey: string, now = new Date()): Promise<boolean> {
  // A delayed old-month result must not announce that the current month is exhausted.
  if (monthKey !== bangkokMonthKey(now)) return false;
  return prisma.client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${companyId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ocr-quota:${companyId}:${monthKey}`}))`;
    if ((await readFreeExpenseAllowance(tx, companyId, monthKey)).usedCount < FREE_EXPENSE_MONTHLY_LIMIT) return false;
    const claimed = await tx.companyPlanTerm.updateMany({ where: { companyId, OR: [
      { freeQuotaNoticeSentMonthKey: null }, { freeQuotaNoticeSentMonthKey: { not: monthKey } },
    ] }, data: { freeQuotaNoticeSentMonthKey: monthKey } });
    return claimed.count === 1;
  });
}

export async function releaseFreeExpenseQuotaNotice(prisma: PrismaService, companyId: string, monthKey: string): Promise<void> {
  await prisma.client.companyPlanTerm.updateMany({ where: { companyId, freeQuotaNoticeSentMonthKey: monthKey },
    data: { freeQuotaNoticeSentMonthKey: null } });
}
