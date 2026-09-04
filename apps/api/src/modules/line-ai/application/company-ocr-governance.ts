import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../common/database/prisma.service';
import { effectiveMonthlySlipLimit } from '../../system-partner-management/domain/logic/receipt-quota.logic';
import { bangkokMonthKey } from './company-ai-usage-meter';

const logger = new Logger('CompanyOcrGovernance');

export type CompanyOcrSourceRoute = 'receipt-ocr-web' | 'receipt-ocr-line' | 'bank-statement-extract';

/**
 * P10-L §15.1: the routes the COMMERCIAL slip ceiling applies to. A bank statement is an accounting
 * import, not one of the receipts the shop bought, so it answers to the ops brake alone.
 */
const PLAN_QUOTA_ROUTES = new Set<CompanyOcrSourceRoute>(['receipt-ocr-web', 'receipt-ocr-line']);

/** Fired once per company-month while the plan ceiling is measured but not enforced. */
const PLAN_WOULD_BLOCK_ACTION = 'plan.receipt_quota.would_block';

export type CompanyOcrAdmission =
  | { allowed: true; monthKey: string; usedCount: number; monthlyLimit: number | null }
  | { allowed: false; reason: 'disabled' }
  | { allowed: false; reason: 'exceeded'; usedCount: number; monthlyLimit: number }
  /** The shop's plan ran out, not the platform's ops brake — a sales moment, not an outage. */
  | { allowed: false; reason: 'plan_exceeded'; usedCount: number; monthlyLimit: number; tierKey: string | null }
  | { allowed: false; reason: 'duplicate' }
  | { allowed: false; reason: 'unavailable' };

export type CompanyOcrErrorCode =
  | 'OCR_FEATURE_DISABLED'
  | 'OCR_MONTHLY_LIMIT_EXCEEDED'
  | 'OCR_REQUEST_ALREADY_ADMITTED'
  | 'OCR_QUOTA_UNAVAILABLE'
  | 'RECEIPT_QUOTA_EXCEEDED';

export function companyOcrErrorCode(decision: Exclude<CompanyOcrAdmission, { allowed: true }>): CompanyOcrErrorCode {
  if (decision.reason === 'disabled') return 'OCR_FEATURE_DISABLED';
  if (decision.reason === 'exceeded') return 'OCR_MONTHLY_LIMIT_EXCEEDED';
  if (decision.reason === 'plan_exceeded') return 'RECEIPT_QUOTA_EXCEEDED';
  if (decision.reason === 'duplicate') return 'OCR_REQUEST_ALREADY_ADMITTED';
  return 'OCR_QUOTA_UNAVAILABLE';
}

/** The one code both lanes translate into the customer-facing "your plan ran out" answer. */
export const RECEIPT_QUOTA_ERROR_CODE: CompanyOcrErrorCode = 'RECEIPT_QUOTA_EXCEEDED';

/**
 * What the reply needs to name a number: how many document reads this company/month has, and the
 * ceiling its plan allows. Read from the SAME aggregate the admission increments, so the trial's
 * "ใบที่ n จาก 15" and the admin console can never disagree.
 */
export async function receiptQuotaSnapshot(
  prisma: PrismaService,
  companyId: string,
  monthKey: string = bangkokMonthKey(),
  now: Date = new Date(),
): Promise<{ usedCount: number; planLimit: number | null; tierKey: string | null }> {
  const [usage, term] = await Promise.all([
    prisma.client.companyOcrMonthlyUsage.findUnique({
      where: { companyId_monthKey: { companyId, monthKey } },
      select: { usedCount: true },
    }),
    prisma.client.companyPlanTerm.findUnique({
      where: { companyId },
      select: { tierKey: true, monthlySlipLimit: true, warmupUntil: true, warmupSlipLimit: true },
    }),
  ]);
  return {
    usedCount: usage?.usedCount ?? 0,
    planLimit: effectiveMonthlySlipLimit(term, now),
    tierKey: term?.tierKey ?? null,
  };
}

/** Only exact status/code pairs that prove the gateway refused before any OCR provider ran. */
export function isOcrPreProviderRefusal(response: { status?: string; errorCode?: string }): boolean {
  if (response.status === 'not_configured') {
    return response.errorCode === 'PROVIDER_CONFIG_MISSING'
      || response.errorCode === 'PDF_PROVIDER_UNSUPPORTED';
  }
  if (response.status !== 'failed') return false;
  return response.errorCode === 'UNSUPPORTED_MIME_TYPE';
}

/** HTTP status is trusted only when observed locally, never when copied from a JSON errorCode. */
export const isOcrPreProviderHttpStatus = (status: number): boolean =>
  status === 400 || status === 401 || status === 403 || status === 404;

/**
 * Spec §3.7: the quota card is a service message sent ONCE when the ceiling is actually hit, not a
 * daily nag. The claim IS the conditional write, so two receipts that hit the wall in the same
 * second still produce one card.
 *
 * The null branch is spelled out rather than left to `{ not: monthKey }`: in SQL `column <> value`
 * is NULL — not true — for a NULL column, and a shop that has never been notified is exactly the
 * row this has to match.
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

/**
 * The one OCR admission seam. A transaction advisory lock serializes the config read, request
 * fence and monthly increment for one company/month; no concurrent caller can overshoot by one.
 *
 * P10-L §15.1 (review G-01) layered the COMMERCIAL ceiling here rather than beside it. Two monthly
 * counters would hand support and the admin console two different "receipts this month" numbers for
 * the same shop, so `CompanyPlanTerm.monthlySlipLimit` reads the aggregate this function already
 * keeps. The effective ceiling is `min(ocrMonthlyLimit ?? ∞, planLimit ?? ∞)`; which one bound is
 * the difference between an outage (`exceeded`) and a sales moment (`plan_exceeded`).
 */
export async function admitCompanyOcr(
  prisma: PrismaService,
  input: {
    companyId: string;
    sourceRoute: CompanyOcrSourceRoute;
    requestId: string;
    monthKey?: string;
    /** RECEIPT_QUOTA_ENFORCED. Off (the default) measures the plan ceiling without refusing on it. */
    enforceReceiptQuota?: boolean;
  },
): Promise<CompanyOcrAdmission> {
  const monthKey = input.monthKey ?? bangkokMonthKey();
  // Set inside the transaction, acted on after it commits: an observability write must not be able
  // to abort an admission, and inside a Postgres transaction a failed statement poisons the whole one.
  let wouldBlock: { usedCount: number; planLimit: number; tierKey: string | null; audited: boolean } | undefined;
  try {
    const admission = await prisma.client.$transaction(async (tx) => {
      // Shared with the Platform Admin write path. A disable/limit change and an admission can
      // never pass each other after reading different policy states.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${input.companyId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ocr-quota:${input.companyId}:${monthKey}`}))`;

      const replay = await tx.companyOcrUsageEvent.findUnique({
        where: {
          companyId_sourceRoute_requestId: {
            companyId: input.companyId,
            sourceRoute: input.sourceRoute,
            requestId: input.requestId,
          },
        },
        select: { id: true },
      });
      if (replay) return { allowed: false, reason: 'duplicate' } as const;

      const configuration = await tx.companyAiConfiguration.findUnique({
        where: { companyId: input.companyId },
        select: { ocrEnabled: true, ocrMonthlyLimit: true },
      });
      if (configuration?.ocrEnabled === false) return { allowed: false, reason: 'disabled' } as const;

      const current = await tx.companyOcrMonthlyUsage.findUnique({
        where: { companyId_monthKey: { companyId: input.companyId, monthKey } },
        select: { usedCount: true },
      });
      const usedCount = current?.usedCount ?? 0;
      const monthlyLimit = configuration?.ocrMonthlyLimit ?? null;
      if (monthlyLimit !== null && usedCount >= monthlyLimit) {
        return { allowed: false, reason: 'exceeded', usedCount, monthlyLimit } as const;
      }

      // The commercial layer. Checked AFTER the ops brake so the platform's own limit keeps its
      // existing code and copy when it is the lower of the two, and skipped entirely for bank
      // statements. No plan term row is unlimited — a company that predates P29 is grandfathered
      // (P29 spec §2 rule 7) and enforcing this ceiling must not be the day it notices.
      if (PLAN_QUOTA_ROUTES.has(input.sourceRoute)) {
        const term = await tx.companyPlanTerm.findUnique({
          where: { companyId: input.companyId },
          select: { tierKey: true, monthlySlipLimit: true, warmupUntil: true, warmupSlipLimit: true },
        });
        const planLimit = effectiveMonthlySlipLimit(term, new Date());
        if (planLimit !== null && usedCount >= planLimit) {
          if (input.enforceReceiptQuota === true) {
            return { allowed: false, reason: 'plan_exceeded', usedCount, monthlyLimit: planLimit, tierKey: term?.tierKey ?? null } as const;
          }
          // Rollout mode: the read still happens, and the shop is told nothing. Read the marker
          // under the lock so the once-per-month decision cannot race itself.
          const audited = await tx.auditLog.findFirst({
            where: { requestId: planWouldBlockKey(input.companyId, monthKey) },
            select: { id: true },
          });
          wouldBlock = { usedCount, planLimit, tierKey: term?.tierKey ?? null, audited: audited !== null };
        }
      }

      await tx.companyOcrUsageEvent.create({
        data: {
          companyId: input.companyId,
          monthKey,
          sourceRoute: input.sourceRoute,
          requestId: input.requestId,
        },
      });
      const aggregate = await tx.companyOcrMonthlyUsage.upsert({
        where: { companyId_monthKey: { companyId: input.companyId, monthKey } },
        create: { companyId: input.companyId, monthKey, usedCount: 1 },
        update: { usedCount: { increment: 1 } },
        select: { usedCount: true },
      });
      return { allowed: true, monthKey, usedCount: aggregate.usedCount, monthlyLimit } as const;
    });
    if (wouldBlock) await recordPlanQuotaWouldBlock(prisma, input, monthKey, wouldBlock);
    return admission;
  } catch (error) {
    logger.warn({
      msg: 'ocr.quota.unavailable',
      companyId: input.companyId,
      sourceRoute: input.sourceRoute,
      requestId: input.requestId,
      error: (error as Error).message,
    });
    return { allowed: false, reason: 'unavailable' };
  }
}

/** Deterministic and indexed (`AuditLog @@index([requestId])`), so it IS the once-per-month key. */
const planWouldBlockKey = (companyId: string, monthKey: string) => `plan-quota-${companyId}-${monthKey}`;

/**
 * Rollout evidence for the month production runs `RECEIPT_QUOTA_ENFORCED=false` (spec §15.1: the
 * flag exists because this ceiling is the first limit every EXISTING shop would ever meet). Every
 * read past the plan ceiling is logged; the first one each month also leaves an audit row, so
 * "how many shops would this have stopped, and when" is answerable before the switch is thrown.
 *
 * Post-commit and swallowing, exactly like `AuditService.log(entry)` without a tx: the admission is
 * already durable, and observability must never turn a granted read into a refusal.
 */
async function recordPlanQuotaWouldBlock(
  prisma: PrismaService,
  input: { companyId: string; sourceRoute: CompanyOcrSourceRoute; requestId: string },
  monthKey: string,
  wouldBlock: { usedCount: number; planLimit: number; tierKey: string | null; audited: boolean },
): Promise<void> {
  logger.warn({
    msg: 'plan.receipt_quota.would_block',
    companyId: input.companyId,
    sourceRoute: input.sourceRoute,
    monthKey,
    usedCount: wouldBlock.usedCount,
    planLimit: wouldBlock.planLimit,
    tierKey: wouldBlock.tierKey,
  });
  if (wouldBlock.audited) return;
  try {
    await prisma.client.auditLog.create({
      data: {
        companyId: input.companyId,
        actorType: 'SYSTEM',
        actorRefId: 'receipt-quota-rollout',
        action: PLAN_WOULD_BLOCK_ACTION,
        targetType: 'company_plan_term',
        targetId: input.companyId,
        requestId: planWouldBlockKey(input.companyId, monthKey),
        result: 'DENIED',
        riskLevel: 'LOW',
        metadataJson: {
          monthKey,
          sourceRoute: input.sourceRoute,
          usedCount: wouldBlock.usedCount,
          planLimit: wouldBlock.planLimit,
          tierKey: wouldBlock.tierKey,
        },
      },
    });
  } catch (error) {
    logger.warn({ msg: 'plan.receipt_quota.audit_failed', companyId: input.companyId, monthKey, error: (error as Error).message });
  }
}

/**
 * Compensates an admission only when the downstream gateway proves that no OCR provider ran.
 * The same locks as admission make the event deletion and aggregate decrement atomic and safe
 * against a concurrent retry. Missing events are an idempotent success.
 */
export async function releaseCompanyOcrAdmission(
  prisma: PrismaService,
  input: {
    companyId: string;
    sourceRoute: CompanyOcrSourceRoute;
    requestId: string;
  },
): Promise<boolean> {
  let lastError: unknown;
  const retryDelaysMs = [50, 250, 1_000];
  // A transient database interruption after a proven pre-provider refusal must not strand the
  // request fence. Retrying the whole transaction is safe: a committed first attempt leaves no
  // event, which is already an idempotent success on the next attempt.
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await prisma.client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${input.companyId}`}))`;
        const event = await tx.companyOcrUsageEvent.findUnique({
          where: {
            companyId_sourceRoute_requestId: {
              companyId: input.companyId,
              sourceRoute: input.sourceRoute,
              requestId: input.requestId,
            },
          },
          select: { id: true, monthKey: true },
        });
        if (!event) return true;

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ocr-quota:${input.companyId}:${event.monthKey}`}))`;
        const aggregate = await tx.companyOcrMonthlyUsage.updateMany({
          where: { companyId: input.companyId, monthKey: event.monthKey, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
        if (aggregate.count !== 1) throw new Error('OCR_QUOTA_AGGREGATE_MISSING');
        await tx.companyOcrUsageEvent.delete({ where: { id: event.id } });
        return true;
      });
    } catch (error) {
      lastError = error;
      const retryDelayMs = retryDelaysMs[attempt];
      if (retryDelayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  logger.warn({
    msg: 'ocr.quota.release_unavailable',
    riskLevel: 'HIGH',
    actionRequired: 'OCR_QUOTA_COMPENSATION_REQUIRED',
    attempts: retryDelaysMs.length + 1,
    companyId: input.companyId,
    sourceRoute: input.sourceRoute,
    requestId: input.requestId,
    error: (lastError as Error).message,
  });
  return false;
}
