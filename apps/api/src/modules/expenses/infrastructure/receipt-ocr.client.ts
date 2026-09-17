import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { AiModelPolicy, ReceiptOcrRequest, ReceiptOcrResponse } from '@watchdog-bms/contracts';
import { AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS } from '@watchdog-bms/contracts';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { safeLineErrorDetails } from '../../line-ai/infrastructure/line-reply.adapter';
import { PrismaService } from '../../../common/database/prisma.service';
import { resolveCompanyAiModelPolicy } from '../../line-ai/application/company-ai-model-policy';
import { classifyAiUsageRequest, companyAiBudgetRefusal, recordCompanyAiUsage, runWithCompanyAiBudgetAdmission, type AiRequestContent } from '../../line-ai/application/company-ai-usage-meter';
import { cancelAiBudgetStep, type AiBudgetCancelProof, type ReservedAiBudgetStep } from '../../line-ai/application/company-ai-budget-reservation';
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

/**
 * A receipt read is OCR either way; the KIND still reports a PDF honestly as OTHER.
 *
 * Optional chaining is load-bearing, not defensive noise: this is evaluated while ASSEMBLING the
 * budget step, before admission has decided anything, and a request that would be refused by the
 * rate limit, the missing secret, the model policy or the money gate may legitimately never carry
 * an attachment. Reading it eagerly turned seven of those refusals into a `TypeError`.
 */
const receiptOcrContent = (request: ReceiptOcrRequest): AiRequestContent =>
  request.attachment?.mimeType === 'application/pdf' ? 'document' : 'image';

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
      (monthKey, hold) => this.extractOcrAdmitted(request, modelPolicy, monthKey, options.onAdmitted, hold),
      undefined,
      {
        // ADR 0013 §4: the client's own extraction request id IS the logical attempt — the upload
        // screen reuses it for a lost response and rotates it for an explicit re-read, which is
        // exactly the attempt boundary money must follow. No LINE id, no prompt text.
        stepKind: 'receipt-ocr', attemptKey: `receipt-web:${request.requestId}`,
        sourceRoute: 'receipt-ocr', modelId: modelPolicy?.modelId ?? '', requestId: request.requestId,
        ...classifyAiUsageRequest('receipt-ocr', receiptOcrContent(request)),
      },
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
    hold?: ReservedAiBudgetStep,
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
    if (!admission.allowed) {
      // The money hold was taken BEFORE this count/switch/plan gate (ADR 0013 §5). The gate refusing
      // here is proof that no provider call started, so this exact hold is released — and only it.
      await this.releaseHold(hold, 'ocr_admission_refused');
      return { status: 'failed', errorCode: companyOcrErrorCode(admission) };
    }
    onAdmitted?.(admission);
    let result: ReceiptOcrResponse;
    try {
      result = await this.extractAdmitted(request, modelPolicy, budgetMonthKey, hold);
    } catch (error) {
      this.logger.warn({ msg: 'receipt OCR response invalid', requestId: request.requestId, ...safeLineErrorDetails(error) });
      result = { status: 'failed', errorCode: 'OCR_JSON_PARSE_FAILED' };
    }
    // Two reasons to hand the read back. `isOcrPreProviderRefusal` proves no provider ran.
    // `isOcrRetryableProviderFailure` does not — but the upload screen retries it under a fresh
    // request id, which buys a second admission, so keeping this one charges a 15-read trial twice
    // for one flaky upload (P10-L §15.1 residual-1).
    if (isOcrPreProviderRefusal(result) || isOcrRetryableProviderFailure(result)) {
      // R-05: ONLY the pre-provider proof releases money. `isOcrRetryableProviderFailure` says the
      // provider may well have run and cost real money, so it refunds the customer's READ COUNT
      // below and never touches the hold — `releaseCompanyOcrAdmission` cannot reach a reservation.
      if (isOcrPreProviderRefusal(result)) await this.releaseHold(hold, 'gateway_pre_provider_refusal');
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

  /** The one place this seam may release money, and only with a proof that no provider ran. */
  private async releaseHold(hold: ReservedAiBudgetStep | undefined, proof: AiBudgetCancelProof): Promise<void> {
    if (hold) await cancelAiBudgetStep(this.prisma, { reservationId: hold.id, ownerToken: hold.ownerToken, proof });
  }

  private async extractAdmitted(
    request: ReceiptOcrRequest,
    modelPolicy: AiModelPolicy | undefined,
    budgetMonthKey?: string,
    hold?: ReservedAiBudgetStep,
  ): Promise<ReceiptOcrResponse> {
    const secret = this.config.aiGatewayInternalSecret!;
    const governedRequest = { ...request, ...(modelPolicy && { modelPolicy }), ...(hold && { budgetEnvelope: hold.envelope }) };
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
          ...(hold && { invocationKey: hold.invocationKey }),
          ...classifyAiUsageRequest('receipt-ocr', receiptOcrContent(request)),
        },
        result.usage,
      );
    } catch (err) {
      this.logger.warn({ msg: 'ai.usage.record_failed', requestId: request.requestId, ...safeLineErrorDetails(err) });
    }
    return result;
  }
}
