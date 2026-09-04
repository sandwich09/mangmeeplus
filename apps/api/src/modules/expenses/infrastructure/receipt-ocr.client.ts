import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { AiModelPolicy, ReceiptOcrRequest, ReceiptOcrResponse } from '@watchdog-bms/contracts';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { resolveCompanyAiModelPolicy } from '../../line-ai/application/company-ai-model-policy';
import { recordCompanyAiUsage, runWithCompanyAiBudgetAdmission } from '../../line-ai/application/company-ai-usage-meter';
import {
  admitCompanyOcr,
  companyOcrErrorCode,
  isOcrPreProviderHttpStatus,
  isOcrPreProviderRefusal,
  isOcrRetryableProviderFailure,
  releaseCompanyOcrAdmission,
} from '../../line-ai/application/company-ocr-governance';

const EXTRACT_TIMEOUT_MS = 120_000;

@Injectable()
export class ReceiptOcrClient {
  private readonly logger = new Logger(ReceiptOcrClient.name);

  constructor(
    private readonly config: AppConfigService,
    @Inject(RedisRateLimitService) private readonly rateLimits: RedisRateLimitService | undefined,
    private readonly prisma: PrismaService,
  ) {}

  async extract(request: ReceiptOcrRequest): Promise<ReceiptOcrResponse> {
    if (this.rateLimits) {
      const companyId = (request as any).companyId ?? (request as any).userContext?.companyId;
      if (!companyId) return { status: 'failed', errorCode: 'AI_RATE_LIMIT_COMPANY_REQUIRED' };
      const decision = await this.rateLimits.consume('ai-ocr-company', companyId, this.config.aiOcrMaxPerCompany, this.config.aiRateLimitWindowSeconds);
      if (!decision.allowed) return { status: 'failed', errorCode: 'AI_OCR_RATE_LIMITED' };
    }
    if (!this.config.aiGatewayInternalSecret) {
      return { status: 'not_configured', errorCode: 'AI_GATEWAY_SECRET_MISSING' };
    }
    // Policy is local readiness. Resolve it before reserving quota so a stale/unapproved tenant
    // model can never consume an OCR read without a provider call.
    const modelPolicy = await resolveCompanyAiModelPolicy(
      this.prisma,
      request.companyId,
      this.config.approvedAiModelIds,
    );
    const admission = await runWithCompanyAiBudgetAdmission(
      this.prisma,
      this.config,
      this.rateLimits,
      request.companyId,
      (monthKey) => this.extractOcrAdmitted(request, modelPolicy, monthKey),
    );
    if (admission.allowed) return admission.value;
    return {
      status: 'failed',
      errorCode: admission.reason === 'exceeded' ? 'AI_MONTHLY_BUDGET_EXCEEDED'
        : admission.reason === 'busy' ? 'AI_BUDGET_BUSY'
        : 'AI_BUDGET_UNAVAILABLE',
    };
  }

  private async extractOcrAdmitted(
    request: ReceiptOcrRequest,
    modelPolicy: AiModelPolicy | undefined,
    budgetMonthKey?: string,
  ): Promise<ReceiptOcrResponse> {
    const admission = await admitCompanyOcr(this.prisma, {
      companyId: request.companyId,
      sourceRoute: 'receipt-ocr-web',
      // TODO(P10-L follow-up): the LINE lane fences on `attachment.id`, so one photo is one read
      // however often it is redelivered. The web lane deliberately fences on `requestId` instead,
      // and it CANNOT simply switch: two live flows mint a fresh id for the same attachment on
      // purpose — `expenseExtractionRetryMode` → 'new_request' (expense-upload.logic.ts:27, driven
      // at ExpensesPages.tsx:321) retries a transient gateway failure, and the review screen's
      // re-read (ExpenseReviewPage.tsx:392) sends no id at all. Fencing on the attachment would
      // answer both with `OCR_REQUEST_ALREADY_ADMITTED` forever, turning one bad provider call into
      // a receipt that can never be read. The gap that leaves is a shop re-pressing "อ่านใบเสร็จ"
      // to spend its own monthly allowance — visible, self-inflicted and bounded by the ceiling.
      // Closing it properly needs a per-attachment read budget (e.g. N re-reads per attachment,
      // then duplicate), which is its own decision and its own slice.
      requestId: request.requestId,
      monthKey: budgetMonthKey,
      // P10-L §15.1: the plan slip ceiling is always measured here; this flag decides whether it refuses.
      enforceReceiptQuota: this.config.receiptQuotaEnforced,
    });
    if (!admission.allowed) return { status: 'failed', errorCode: companyOcrErrorCode(admission) };
    const result = await this.extractAdmitted(request, modelPolicy, budgetMonthKey);
    // Two reasons to hand the read back. `isOcrPreProviderRefusal` proves no provider ran.
    // `isOcrRetryableProviderFailure` does not — but the upload screen retries it under a fresh
    // request id, which buys a second admission, so keeping this one charges a 15-read trial twice
    // for one flaky upload (P10-L §15.1 residual-1).
    if (isOcrPreProviderRefusal(result) || isOcrRetryableProviderFailure(result)) {
      const released = await releaseCompanyOcrAdmission(this.prisma, {
        companyId: request.companyId,
        sourceRoute: 'receipt-ocr-web',
        requestId: request.requestId,
      });
      // A pre-provider refusal that cannot be compensated must not look like a free read. A
      // retryable failure keeps its own error: the retry will admit afresh either way, and
      // replacing a truthful "the gateway is down" with a quota word would misdirect the shop.
      if (!released && isOcrPreProviderRefusal(result)) return { status: 'failed', errorCode: 'OCR_QUOTA_UNAVAILABLE' };
    }
    return result;
  }

  private async extractAdmitted(
    request: ReceiptOcrRequest,
    modelPolicy: AiModelPolicy | undefined,
    budgetMonthKey?: string,
  ): Promise<ReceiptOcrResponse> {
    const secret = this.config.aiGatewayInternalSecret!;
    const governedRequest = { ...request, ...(modelPolicy && { modelPolicy }) };
    let response: Response;
    try {
      response = await fetch(`${this.config.aiGatewayInternalUrl}/internal/ai/receipt-ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify(governedRequest),
        signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error({ msg: 'receipt OCR gateway unreachable', error: (err as Error).message, requestId: request.requestId });
      return { status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE' };
    }

    if (!response.ok) {
      this.logger.error({ msg: 'receipt OCR gateway error', status: response.status, requestId: request.requestId });
      if (isOcrPreProviderHttpStatus(response.status)) {
        const released = await releaseCompanyOcrAdmission(this.prisma, {
          companyId: request.companyId,
          sourceRoute: 'receipt-ocr-web',
          requestId: request.requestId,
        });
        if (!released) return { status: 'failed', errorCode: 'OCR_QUOTA_UNAVAILABLE' };
      }
      return { status: 'failed', errorCode: `AI_GATEWAY_ERROR_${response.status}` };
    }

    const result = (await response.json()) as ReceiptOcrResponse;
    // Same route name as the LINE lane's OCR seam, different flow — both record.
    try {
      await recordCompanyAiUsage(
        this.prisma,
        this.config,
        { companyId: request.companyId, sourceRoute: 'receipt-ocr', requestId: request.requestId, monthKey: budgetMonthKey },
        result.usage,
      );
    } catch (err) {
      this.logger.warn({ msg: 'ai.usage.record_failed', requestId: request.requestId, error: (err as Error).message });
    }
    return result;
  }
}
