/**
 * P10-L §15.1 (review G-01) — the monthly receipt counter behind `CompanyPlanTerm.monthlySlipLimit`.
 *
 * CAS mechanics are lifted verbatim from `prisma-crm-channel-cap.repository.ts`: create the counter
 * row with an empty update so a running count is never disturbed, then increment under
 * `count < limit` so exactly one caller wins per unit of remaining capacity. Exported as plain
 * functions over `PrismaService` rather than an injectable class, because both callers live in OTHER
 * modules (`line-ai`, `expenses`) — the same shape `plan-term-limit.ts` and `company-ocr-governance.ts`
 * already use for cross-module quota seams, and it needs no DI wiring to reach them.
 */
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { ReceiptQuotaTerm } from '../domain/logic/receipt-quota.logic';

const logger = new Logger('CompanyReceiptUsage');

/** `limit: null` is an unlimited (legacy, term-less) company; `count` is this month's total AFTER this call. */
export type ReceiptQuotaReservation = { allowed: boolean; count: number; limit: number | null };

/**
 * The term the ceiling is read from, or `null` for the grandfathered-unlimited company.
 *
 * ponytail: a store failure answers `null` — the same fail-open the reservation below takes, for the
 * same reason. It must be here rather than at each call site, because both lanes reach this from
 * inside a media turn that has already downloaded the customer's photo.
 */
export async function loadReceiptQuotaTerm(prisma: PrismaService, companyId: string): Promise<ReceiptQuotaTerm | null> {
  try {
    return await prisma.client.companyPlanTerm.findUnique({
      where: { companyId },
      select: { tierKey: true, monthlySlipLimit: true, warmupUntil: true, warmupSlipLimit: true },
    });
  } catch (error) {
    logger.warn({ msg: 'receipt.quota.term_unavailable', companyId, error: (error as Error).message });
    return null;
  }
}

/**
 * Reserve one slip for `requestId`, idempotently.
 *
 * - An entry that is still RESERVED or already CONSUMED returns its prior outcome and increments
 *   nothing: a LINE redelivery of the same photo, or a web retry of the same extraction, is ONE
 *   receipt. A RELEASED entry re-reserves, because release exists precisely so a read that never
 *   happened can be retried (same rule as `releaseCompanyOcrAdmission`).
 * - `enforce=false` still counts and still reports the numbers; only the `count < limit` predicate
 *   is dropped, so the production rollout can watch a month of real usage before it refuses anything.
 *
 * ponytail: fails OPEN on a store error — this is a commercial ceiling, not a security control or a
 * spend brake (the AI budget and `admitCompanyOcr` remain fail-closed above it), and refusing a
 * paying shop's receipt because the counter table hiccupped is the worse of the two failures.
 */
export async function reserveReceiptQuota(
  prisma: PrismaService,
  input: { companyId: string; monthKey: string; requestId: string; limit: number | null; enforce: boolean },
): Promise<ReceiptQuotaReservation> {
  const { companyId, monthKey, requestId, limit, enforce } = input;
  const blocking = enforce && limit !== null;
  try {
    return await prisma.client.$transaction(async (tx) => {
      const readCount = async () => (await tx.companyReceiptUsage.findUnique({
        where: { companyId_monthKey: { companyId, monthKey } },
        select: { count: true },
      }))?.count ?? 0;

      const entry = await tx.companyReceiptUsageEntry.findUnique({
        where: { requestId },
        select: { status: true },
      });
      if (entry && entry.status !== 'RELEASED') return { allowed: true, count: await readCount(), limit };

      await tx.companyReceiptUsage.upsert({
        where: { companyId_monthKey: { companyId, monthKey } },
        update: {},
        create: { companyId, monthKey, count: 0 },
      });
      // Postgres re-evaluates this predicate against the committed row a blocked writer waited for,
      // so two callers at `limit - 1` cannot both pass — the loser updates zero rows.
      const applied = await tx.companyReceiptUsage.updateMany({
        where: { companyId, monthKey, ...(blocking ? { count: { lt: limit! } } : {}) },
        data: { count: { increment: 1 } },
      });
      const count = await readCount();
      if (applied.count !== 1) return { allowed: false, count, limit };

      if (entry) await tx.companyReceiptUsageEntry.update({ where: { requestId }, data: { status: 'RESERVED', monthKey } });
      else await tx.companyReceiptUsageEntry.create({ data: { companyId, monthKey, requestId, status: 'RESERVED' } });
      return { allowed: true, count, limit };
    });
  } catch (error) {
    logger.warn({ msg: 'receipt.quota.unavailable', companyId, monthKey, requestId, error: (error as Error).message });
    return { allowed: true, count: 0, limit };
  }
}

/** Give the slip back — once. Only a live RESERVED entry decrements, so a repeated release is a no-op. */
export async function releaseReceiptQuota(prisma: PrismaService, requestId: string): Promise<void> {
  try {
    await prisma.client.$transaction(async (tx) => {
      const entry = await tx.companyReceiptUsageEntry.findUnique({
        where: { requestId },
        select: { companyId: true, monthKey: true, status: true },
      });
      if (!entry || entry.status !== 'RESERVED') return;
      // Floor at 0, same guard as the CRM channel cap: never decrement a row that is already empty.
      await tx.companyReceiptUsage.updateMany({
        where: { companyId: entry.companyId, monthKey: entry.monthKey, count: { gt: 0 } },
        data: { count: { decrement: 1 } },
      });
      await tx.companyReceiptUsageEntry.update({ where: { requestId }, data: { status: 'RELEASED' } });
    });
  } catch (error) {
    logger.warn({ msg: 'receipt.quota.release_failed', requestId, error: (error as Error).message });
  }
}

/** The read happened: the slip is spent and can no longer be released. */
export async function consumeReceiptQuota(prisma: PrismaService, requestId: string): Promise<void> {
  try {
    await prisma.client.companyReceiptUsageEntry.updateMany({
      where: { requestId, status: 'RESERVED' },
      data: { status: 'CONSUMED' },
    });
  } catch (error) {
    logger.warn({ msg: 'receipt.quota.consume_failed', requestId, error: (error as Error).message });
  }
}

/**
 * Spec §3.7: the quota card is a service message sent ONCE when the ceiling is actually hit, not a
 * daily nag. The claim is the conditional write itself, so two receipts that hit the wall in the
 * same second still produce one card.
 *
 * The null branch is spelled out rather than left to `{ not: monthKey }`: in SQL `column <> value`
 * is NULL — not true — for a NULL column, and a shop that has never been notified is exactly the
 * one this must match.
 */
export async function claimReceiptQuotaNotice(
  prisma: PrismaService,
  companyId: string,
  monthKey: string,
): Promise<boolean> {
  try {
    const { count } = await prisma.client.companyPlanTerm.updateMany({
      where: {
        companyId,
        OR: [{ quotaNoticeSentMonthKey: null }, { quotaNoticeSentMonthKey: { not: monthKey } }],
      },
      data: { quotaNoticeSentMonthKey: monthKey },
    });
    return count === 1;
  } catch (error) {
    logger.warn({ msg: 'receipt.quota.notice_claim_failed', companyId, monthKey, error: (error as Error).message });
    return false;
  }
}
