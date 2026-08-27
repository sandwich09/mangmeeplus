import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../common/database/prisma.service';
import { bangkokMonthKey } from './company-ai-usage-meter';

const logger = new Logger('CompanyOcrGovernance');

export type CompanyOcrSourceRoute = 'receipt-ocr-web' | 'receipt-ocr-line' | 'bank-statement-extract';

export type CompanyOcrAdmission =
  | { allowed: true; monthKey: string; usedCount: number; monthlyLimit: number | null }
  | { allowed: false; reason: 'disabled' }
  | { allowed: false; reason: 'exceeded'; usedCount: number; monthlyLimit: number }
  | { allowed: false; reason: 'duplicate' }
  | { allowed: false; reason: 'unavailable' };

export type CompanyOcrErrorCode =
  | 'OCR_FEATURE_DISABLED'
  | 'OCR_MONTHLY_LIMIT_EXCEEDED'
  | 'OCR_REQUEST_ALREADY_ADMITTED'
  | 'OCR_QUOTA_UNAVAILABLE';

export function companyOcrErrorCode(decision: Exclude<CompanyOcrAdmission, { allowed: true }>): CompanyOcrErrorCode {
  if (decision.reason === 'disabled') return 'OCR_FEATURE_DISABLED';
  if (decision.reason === 'exceeded') return 'OCR_MONTHLY_LIMIT_EXCEEDED';
  if (decision.reason === 'duplicate') return 'OCR_REQUEST_ALREADY_ADMITTED';
  return 'OCR_QUOTA_UNAVAILABLE';
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
 * The one OCR admission seam. A transaction advisory lock serializes the config read, request
 * fence and monthly increment for one company/month; no concurrent caller can overshoot by one.
 */
export async function admitCompanyOcr(
  prisma: PrismaService,
  input: {
    companyId: string;
    sourceRoute: CompanyOcrSourceRoute;
    requestId: string;
    monthKey?: string;
  },
): Promise<CompanyOcrAdmission> {
  const monthKey = input.monthKey ?? bangkokMonthKey();
  try {
    return await prisma.client.$transaction(async (tx) => {
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
