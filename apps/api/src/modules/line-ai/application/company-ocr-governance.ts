import { currentCapacityOverride } from '../../system-partner-management/domain/logic/plan-capacity';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS, isReceiptOcrRetryableFailure } from '@watchdog-bms/contracts';
import { safeLineErrorDetails } from '../infrastructure/line-reply.adapter';
import type { PrismaService } from '../../../common/database/prisma.service';
import { effectiveMonthlySlipLimit } from '../../system-partner-management/domain/logic/receipt-quota.logic';
import { bangkokMonthKey } from './company-ai-usage-meter';
import { paidReceiptBalance } from '../../billing/application/billing-receipt-grants';

// Outlast one 55s media route plus the full receipt provider chain and upload bookkeeping.
export const LINE_RECEIPT_RETRY_LEASE_MS = AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS + 105_000;
export const LINE_RECEIPT_RETRY_LEASE_CODE = 'LINE_OCR_RETRY_ACTIVE';
export const LINE_RECEIPT_RETRY_WAIT_CODE = 'RETRYABLE_OCR_ADMISSION_WAIT';

const logger = new Logger('CompanyOcrGovernance');

export type CompanyOcrSourceRoute = 'receipt-ocr-web' | 'receipt-ocr-line' | 'bank-statement-extract';

/**
 * P10-L §15.1: the routes the COMMERCIAL slip ceiling applies to. A bank statement is an accounting
 * import, not one of the receipts the shop bought, so it answers to the ops brake alone.
 */
const PLAN_QUOTA_ROUTES = new Set<CompanyOcrSourceRoute>(['receipt-ocr-web', 'receipt-ocr-line']);

/** The commercial allowance excludes bank statements; the operational aggregate still includes them. */
export function countReceiptOcrAdmissions(db: Pick<PrismaService['client'], 'companyOcrUsageEvent'>, companyId: string, monthKey?: string): Promise<number> {
  return db.companyOcrUsageEvent.count({ where: { companyId, ...(monthKey ? { monthKey } : {}), sourceRoute: { in: [...PLAN_QUOTA_ROUTES] } } });
}

export type CompanyOcrAdmissionIdentity = { eventId: string; monthKey: string };

/** Fired once per company-month while the plan ceiling is measured but not enforced. */
const PLAN_WOULD_BLOCK_ACTION = 'plan.receipt_quota.would_block';

export type CompanyOcrAdmission =
  | ({ allowed: true; usedCount: number; monthlyLimit: number | null } & CompanyOcrAdmissionIdentity)
  | { allowed: false; reason: 'disabled' }
  | { allowed: false; reason: 'exceeded'; usedCount: number; monthlyLimit: number }
  /** The shop's plan ran out, not the platform's ops brake — a sales moment, not an outage. */
  | { allowed: false; reason: 'plan_exceeded'; usedCount: number; monthlyLimit: number; tierKey: string | null }
  | { allowed: false; reason: 'plan_inactive' }
  | { allowed: false; reason: 'duplicate' }
  | { allowed: false; reason: 'unavailable' };

export type CompanyOcrErrorCode =
  | 'OCR_FEATURE_DISABLED'
  | 'OCR_MONTHLY_LIMIT_EXCEEDED'
  | 'OCR_REQUEST_ALREADY_ADMITTED'
  | 'OCR_QUOTA_UNAVAILABLE'
  | 'RECEIPT_QUOTA_EXCEEDED'
  | 'BILLING_ACCESS_INACTIVE';

export function companyOcrErrorCode(decision: Exclude<CompanyOcrAdmission, { allowed: true }>): CompanyOcrErrorCode {
  if (decision.reason === 'disabled') return 'OCR_FEATURE_DISABLED';
  if (decision.reason === 'exceeded') return 'OCR_MONTHLY_LIMIT_EXCEEDED';
  if (decision.reason === 'plan_exceeded') return 'RECEIPT_QUOTA_EXCEEDED';
  if (decision.reason === 'plan_inactive') return 'BILLING_ACCESS_INACTIVE';
  if (decision.reason === 'duplicate') return 'OCR_REQUEST_ALREADY_ADMITTED';
  return 'OCR_QUOTA_UNAVAILABLE';
}

/** The one code both lanes translate into the customer-facing "your plan ran out" answer. */
export const RECEIPT_QUOTA_ERROR_CODE: CompanyOcrErrorCode = 'RECEIPT_QUOTA_EXCEEDED';

/**
 * What the reply needs to name a number: how many document reads this company/month has, and the
 * ceiling its plan allows. Read from the SAME qualifying events admission counts, so the trial's
 * "อ่านครั้งที่ n จาก 15" agrees with commercial enforcement. Operational totals include bank statements.
 */
export async function receiptQuotaSnapshot(
  prisma: PrismaService,
  companyId: string,
  monthKey: string = bangkokMonthKey(),
  now: Date = new Date(),
): Promise<{ usedCount: number; planLimit: number | null; tierKey: string | null; cadence?: 'PAID_GRANTS'; expiresAt?: string | null }> {
  const [usedCount, term] = await Promise.all([
    countReceiptOcrAdmissions(prisma.client, companyId, monthKey),
    prisma.client.companyPlanTerm.findUnique({
      where: { companyId },
      select: { capacityOverride: true, tierKey: true, monthlySlipLimit: true, warmupUntil: true, warmupSlipLimit: true, billingReceiptAccountId: true, termEndsAt: true, termDisabledAt: true },
    }),
  ]);
  if (term?.billingReceiptAccountId) {
    const balance = await paidReceiptBalance(prisma.client, companyId, term.billingReceiptAccountId, now);
    return { usedCount: balance.used, planLimit: balance.limit, tierKey: currentCapacityOverride(term)?.tierKey ?? term.tierKey,
      cadence: 'PAID_GRANTS', expiresAt: balance.expiresAt?.toISOString() ?? null };
  }
  return {
    usedCount,
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

/** Extraction failures release customer allowance. Only explicit governance decisions are excluded.
 * Provider usage stays in the separate AI ledger; an absent response means unknown spend, not zero. */
export function isOcrRetryableProviderFailure(response: { status?: string; errorCode?: string }): boolean {
  return isReceiptOcrRetryableFailure(response);
}

/**
 * Spec §3.7: the quota card is a service message sent ONCE when the ceiling is actually hit, not a
 * daily nag. The claim IS the conditional write, so two receipts that hit the wall in the same
 * second still produce one card.
 *
 * The null branch is spelled out rather than left to `{ not: monthKey }`: in SQL `column <> value`
 * is NULL — not true — for a NULL column, and a shop that has never been notified is exactly the
 * row this has to match.
 */
/**
 * Undo a claim whose card never reached the shop (F5). Narrow on purpose — it only clears the month
 * it claimed, so a concurrent turn that has already moved the marker to a LATER month is not
 * rewound. Best-effort: a failure leaves the month claimed, which costs one card, not correctness.
 */
export async function releaseReceiptQuotaNotice(
  prisma: PrismaService,
  companyId: string,
  monthKey: string,
): Promise<void> {
  try {
    await prisma.client.companyPlanTerm.updateMany({
      where: { companyId, quotaNoticeSentMonthKey: monthKey },
      data: { quotaNoticeSentMonthKey: null },
    });
  } catch (error) {
    logger.warn({ msg: 'receipt.quota.notice_release_failed', companyId, monthKey, ...safeLineErrorDetails(error) });
  }
}

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
    logger.warn({ msg: 'receipt.quota.notice_claim_failed', companyId, monthKey, ...safeLineErrorDetails(error) });
    return false;
  }
}

/**
 * The one OCR admission seam. A transaction advisory lock serializes the config read, request
 * fence and monthly increment for one company/month; no concurrent caller can overshoot by one.
 *
 * The commercial ceiling counts only indexed receipt-route events under this same lock. The
 * operational ceiling uses the all-route aggregate; each refusal names the policy that bound.
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
    /** Server-owned orphan event only; a duplicate admission alone never authorizes another read. */
    retryWebhookEventId?: string;
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
        select: { id: true, monthKey: true, createdAt: true, billingReceiptGrantId: true },
      });
      if (replay) {
        const cutoff = new Date(Date.now() - LINE_RECEIPT_RETRY_LEASE_MS);
        if (input.sourceRoute !== 'receipt-ocr-line' || !input.retryWebhookEventId || replay.createdAt > cutoff) return { allowed: false, reason: 'duplicate' } as const;
        const owner = await tx.lineWebhookEventLog.findUnique({ where: { webhookEventId: input.retryWebhookEventId } });
        const envelope = owner?.payloadJson as { item?: { lineMessageId?: string; companyIdAtAcceptance?: string } } | null;
        if (!owner || owner.status !== 'received' || owner.errorCode !== null || !owner.processedAt
          || owner.processedAt <= cutoff || envelope?.item?.lineMessageId !== input.requestId
          || (owner.companyId ?? envelope?.item?.companyIdAtAcceptance) !== input.companyId) return { allowed: false, reason: 'duplicate' } as const;
        const [captured, active] = await Promise.all([
          tx.expenseRecord.findFirst({ where: { companyId: input.companyId, lineMessageId: input.requestId }, select: { id: true } }),
          tx.lineWebhookEventLog.findFirst({ where: { companyId: input.companyId, status: 'received',
            errorCode: LINE_RECEIPT_RETRY_LEASE_CODE, processedAt: { gt: cutoff },
            payloadJson: { path: ['item', 'lineMessageId'], equals: input.requestId } }, select: { id: true } }),
        ]);
        if (captured || active) return { allowed: false, reason: 'duplicate' } as const;
        const policy = await tx.companyAiConfiguration.findUnique({ where: { companyId: input.companyId }, select: { ocrEnabled: true, ocrMonthlyLimit: true } });
        if (policy?.ocrEnabled === false) return { allowed: false, reason: 'disabled' } as const;
        if (replay.billingReceiptGrantId) {
          const [grant, term, company] = await Promise.all([
            tx.billingReceiptGrant.findUnique({ where: { id: replay.billingReceiptGrantId } }),
            tx.companyPlanTerm.findUnique({ where: { companyId: input.companyId } }),
            tx.company.findUnique({ where: { id: input.companyId }, select: { status: true } }),
          ]);
          const now = new Date();
          if (!grant || !term || company?.status !== 'ACTIVE' || term.termDisabledAt || term.termEndsAt <= now
            || grant.revokedAt || grant.expiresAt <= now || grant.availableAt > now
            || grant.companyId !== input.companyId || grant.billingAccountId !== term.billingReceiptAccountId) {
            return { allowed: false, reason: 'plan_inactive' } as const;
          }
        }
        const claimed = await tx.lineWebhookEventLog.updateMany({
          where: { id: owner.id, status: 'received', errorCode: null, processedAt: owner.processedAt },
          data: { errorCode: LINE_RECEIPT_RETRY_LEASE_CODE, companyId: input.companyId, processedAt: new Date() },
        });
        if (claimed.count !== 1) return { allowed: false, reason: 'duplicate' } as const;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ocr-quota:${input.companyId}:${replay.monthKey}`}))`;
        const usage = await tx.companyOcrMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId: input.companyId, monthKey: replay.monthKey } }, select: { usedCount: true } });
        // Same input/month, new execution generation: an old worker's delayed release cannot credit this retry.
        const resumed = await tx.companyOcrUsageEvent.update({ where: { id: replay.id }, data: { id: randomUUID() }, select: { id: true } });
        await tx.auditLog.create({ data: { companyId: input.companyId, actorType: 'SYSTEM', actorRefId: 'receipt-ocr-admission',
          action: 'receipt.ocr.admission.resumed', targetType: 'company_ocr_usage_event', targetId: resumed.id,
          requestId: input.retryWebhookEventId, result: 'SUCCESS', riskLevel: 'LOW',
          metadataJson: { operationId: input.requestId, monthKey: replay.monthKey, previousEventId: replay.id } } });
        return { allowed: true, eventId: resumed.id, monthKey: replay.monthKey, usedCount: usage.usedCount, monthlyLimit: policy?.ocrMonthlyLimit ?? null } as const;
      }

      const configuration = await tx.companyAiConfiguration.findUnique({
        where: { companyId: input.companyId },
        select: { ocrEnabled: true, ocrMonthlyLimit: true, receiptQuotaEnforced: true },
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
      let billingReceiptGrantId: string | undefined;
      if (PLAN_QUOTA_ROUTES.has(input.sourceRoute)) {
        const term = await tx.companyPlanTerm.findUnique({
          where: { companyId: input.companyId },
          select: { capacityOverride: true, tierKey: true, monthlySlipLimit: true, warmupUntil: true, warmupSlipLimit: true, billingReceiptAccountId: true, termEndsAt: true, termDisabledAt: true },
        });
        if (term?.billingReceiptAccountId) {
          const company = await tx.company.findUnique({ where: { id: input.companyId }, select: { status: true } });
          const now = new Date();
          if (company?.status !== 'ACTIVE' || term.termDisabledAt || term.termEndsAt <= now) return { allowed: false, reason: 'plan_inactive' } as const;
          const balance = await paidReceiptBalance(tx, input.companyId, term.billingReceiptAccountId, now);
          if (!balance.nextGrantId) return { allowed: false, reason: 'plan_exceeded', usedCount: balance.used, monthlyLimit: balance.limit, tierKey: currentCapacityOverride(term)?.tierKey ?? term.tierKey } as const;
          billingReceiptGrantId = balance.nextGrantId;
        } else {
          const planLimit = effectiveMonthlySlipLimit(term, new Date());
          const receiptCount = planLimit === null ? 0 : await countReceiptOcrAdmissions(tx, input.companyId, monthKey);
          if (planLimit !== null && receiptCount >= planLimit) {
            if ((configuration?.receiptQuotaEnforced ?? input.enforceReceiptQuota) === true) {
              return { allowed: false, reason: 'plan_exceeded', usedCount: receiptCount, monthlyLimit: planLimit, tierKey: term?.tierKey ?? null } as const;
            }
            // Rollout mode: the read still happens, and the shop is told nothing. Read the marker
            // under the lock so the once-per-month decision cannot race itself.
            const audited = await tx.auditLog.findFirst({
              where: { requestId: planWouldBlockKey(input.companyId, monthKey) },
              select: { id: true },
            });
            wouldBlock = { usedCount: receiptCount, planLimit, tierKey: term?.tierKey ?? null, audited: audited !== null };
          }
        }
      }

      const event = await tx.companyOcrUsageEvent.create({
        data: {
          companyId: input.companyId,
          monthKey,
          sourceRoute: input.sourceRoute,
          requestId: input.requestId,
          ...(billingReceiptGrantId ? { billingReceiptGrantId } : {}),
        },
        select: { id: true },
      });
      const aggregate = await tx.companyOcrMonthlyUsage.upsert({
        where: { companyId_monthKey: { companyId: input.companyId, monthKey } },
        create: { companyId: input.companyId, monthKey, usedCount: 1 },
        update: { usedCount: { increment: 1 } },
        select: { usedCount: true },
      });
      return { allowed: true, eventId: event.id, monthKey, usedCount: aggregate.usedCount, monthlyLimit } as const;
    });
    if (wouldBlock) await recordPlanQuotaWouldBlock(prisma, input, monthKey, wouldBlock);
    return admission;
  } catch (error) {
    logger.warn({
      msg: 'ocr.quota.unavailable',
      companyId: input.companyId,
      sourceRoute: input.sourceRoute,
      requestId: input.requestId,
      ...safeLineErrorDetails(error),
    });
    return { allowed: false, reason: 'unavailable' };
  }
}

/** Deterministic and indexed (`AuditLog @@index([requestId])`), so it IS the once-per-month key. */
const planWouldBlockKey = (companyId: string, monthKey: string) => `plan-quota-${companyId}-${monthKey}`;

/**
 * Rollout evidence for the month production runs `RECEIPT_QUOTA_ENFORCED=false` (spec §15.1: the
 * flag exists because this ceiling is the first limit every EXISTING shop would ever meet). Every
 * read past the plan ceiling is logged; the first one each month also leaves an audit row.
 *
 * Post-commit and swallowing, exactly like `AuditService.log(entry)` without a tx: the admission is
 * already durable, and observability must never turn a granted read into a refusal. That makes the
 * row BEST-EFFORT — the dedupe read commits before the write, and there is no unique constraint
 * behind it, so a company can end up with more than one row in a month. Read the rollout as
 * `count(distinct "companyId")` over `action = 'plan.receipt_quota.would_block'`, never as a row
 * count, and treat a missing row as "not proven", not as "did not happen".
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
    logger.warn({ msg: 'plan.receipt_quota.audit_failed', companyId: input.companyId, monthKey, ...safeLineErrorDetails(error) });
  }
}

/**
 * Compensates admission after a proven pre-provider refusal or a system failure before a usable
 * receipt result. Customer entitlement is separate from provider spend; usage rows are retained.
 * The same locks as admission make the event deletion and aggregate decrement atomic and safe
 * against a concurrent retry. Missing events are an idempotent success.
 */
export async function releaseCompanyOcrAdmission(
  prisma: PrismaService,
  input: {
    companyId: string;
    sourceRoute: CompanyOcrSourceRoute;
    requestId: string;
    /** A delayed credit cannot consume a replacement attempt. */
    eventId: string;
    reason?: 'SYSTEM_FAILURE_NO_USABLE_RESULT';
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
        if (event.id !== input.eventId) return true;

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ocr-quota:${input.companyId}:${event.monthKey}`}))`;
        const aggregate = await tx.companyOcrMonthlyUsage.updateMany({
          where: { companyId: input.companyId, monthKey: event.monthKey, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
        if (aggregate.count !== 1) throw new Error('OCR_QUOTA_AGGREGATE_MISSING');
        if (input.reason) await tx.auditLog.create({
          data: { companyId: input.companyId, actorType: 'SYSTEM', actorRefId: 'receipt-ocr-admission',
            action: 'receipt.ocr.admission.compensated', targetType: 'company_ocr_usage_event', targetId: event.id,
            requestId: `ocr-compensation-${event.id}`, result: 'SUCCESS', riskLevel: 'LOW',
            metadataJson: { sourceRoute: input.sourceRoute, operationId: input.requestId, monthKey: event.monthKey, reason: input.reason } },
        });
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
    eventId: input.eventId,
    ...safeLineErrorDetails(lastError),
  });
  return false;
}
