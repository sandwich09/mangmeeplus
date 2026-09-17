import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { AiModelPolicy, ReceiptOcrRequest, ReceiptOcrResponse } from '@watchdog-bms/contracts';
import { AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS } from '@watchdog-bms/contracts';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { safeLineErrorDetails } from '../../line-ai/infrastructure/line-reply.adapter';
import { PrismaService } from '../../../common/database/prisma.service';
import { resolveCompanyAiModelPolicy } from '../../line-ai/application/company-ai-model-policy';
import { classifyAiUsageRequest, companyAiBudgetRefusal, recordCompanyAiUsage, runWithCompanyAiBudgetAdmission } from '../../line-ai/application/company-ai-usage-meter';
import {
  type CompanyOcrAdmissionIdentity,
  admitCompanyOcr,
  companyOcrErrorCode,
  isOcrPreProviderRefusal,
  isOcrRetryableProviderFailure,
  releaseCompanyOcrAdmission,
} from '../../line-ai/application/company-ocr-governance';

// 4 x 45s of gateway provider chain + 15s margin. MUST outlast the gateway: aborting first returns
// AI_GATEWAY_UNREACHABLE, which releases the OCR admission as a retryable failure AND loses the
// response body that carries the usage the meter bills from — so the provider spend would land on
// neither meter, and the trial AI budget is calibrated from both.
const EXTRACT_TIMEOUT_MS = AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS;

@Injectable()
export class ReceiptOcrClient {
  private readonly logger = new Logger(ReceiptOcrClient.name);

  constructor(
    private readonly config: AppConfigService,
    @Inject(RedisRateLimitService) private readonly rateLimits: RedisRateLimitService | undefined,
    private readonly prisma: PrismaService,
  ) {}

  async extract(request: ReceiptOcrRequest, options: { onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void } = {}): Promise<ReceiptOcrResponse> {
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
      (monthKey) => this.extractOcrAdmitted(request, modelPolicy, monthKey, options.onAdmitted),
    );
    if (admission.allowed) return admission.value;
    // Refused BEFORE `admitCompanyOcr`, so no OCR read was counted and there is nothing to release.
    // The scope rides along so the web notice can say which ceiling closed (spec §9.1).
    const refusal = companyAiBudgetRefusal(admission);
    return { status: 'failed', errorCode: refusal.code, budgetScope: refusal.budgetScope };
  }

  private async extractOcrAdmitted(
    request: ReceiptOcrRequest,
    modelPolicy: AiModelPolicy | undefined,
    budgetMonthKey?: string,
    onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void,
  ): Promise<ReceiptOcrResponse> {
    const admission = await admitCompanyOcr(this.prisma, {
      companyId: request.companyId,
      sourceRoute: 'receipt-ocr-web',
      // One explicit web extraction attempt, including a lost-response retry, uses one request id.
      // A deliberate re-read or a failed provider retry gets a fresh id; fencing on the attachment
      // would prevent the customer from ever retrying an unreadable source.
      requestId: request.requestId,
      monthKey: budgetMonthKey,
      // P10-L §15.1: the plan slip ceiling is always measured here; this flag decides whether it refuses.
      enforceReceiptQuota: this.config.receiptQuotaEnforced,
    });
    if (!admission.allowed) return { status: 'failed', errorCode: companyOcrErrorCode(admission) };
    onAdmitted?.(admission);
    let result: ReceiptOcrResponse;
    try {
      result = await this.extractAdmitted(request, modelPolicy, budgetMonthKey);
    } catch (error) {
      this.logger.warn({ msg: 'receipt OCR response invalid', requestId: request.requestId, ...safeLineErrorDetails(error) });
      result = { status: 'failed', errorCode: 'OCR_JSON_PARSE_FAILED' };
    }
    // Two reasons to hand the read back. `isOcrPreProviderRefusal` proves no provider ran.
    // `isOcrRetryableProviderFailure` does not — but the upload screen retries it under a fresh
    // request id, which buys a second admission, so keeping this one charges a 15-read trial twice
    // for one flaky upload (P10-L §15.1 residual-1).
    if (isOcrPreProviderRefusal(result) || isOcrRetryableProviderFailure(result)) {
      const released = await releaseCompanyOcrAdmission(this.prisma, {
        companyId: request.companyId,
        sourceRoute: 'receipt-ocr-web',
        requestId: request.requestId,
        eventId: admission.eventId,
        ...(isOcrPreProviderRefusal(result) ? {} : { reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT' as const }),
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
      this.logger.error({ msg: 'receipt OCR gateway unreachable', ...safeLineErrorDetails(err), requestId: request.requestId });
      return { status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE' };
    }

    if (!response.ok) {
      this.logger.error({ msg: 'receipt OCR gateway error', status: response.status, requestId: request.requestId });
      return { status: 'failed', errorCode: `AI_GATEWAY_ERROR_${response.status}` };
    }

    const result = (await response.json()) as ReceiptOcrResponse;
    // Same route name as the LINE lane's OCR seam, different flow — both record.
    try {
      await recordCompanyAiUsage(
        this.prisma,
        this.config,
        {
          companyId: request.companyId, sourceRoute: 'receipt-ocr', requestId: request.requestId, monthKey: budgetMonthKey,
          ...classifyAiUsageRequest('receipt-ocr', request.attachment.mimeType === 'application/pdf' ? 'document' : 'image'),
        },
        result.usage,
      );
    } catch (err) {
      this.logger.warn({ msg: 'ai.usage.record_failed', requestId: request.requestId, ...safeLineErrorDetails(err) });
    }
    return result;
  }
}
