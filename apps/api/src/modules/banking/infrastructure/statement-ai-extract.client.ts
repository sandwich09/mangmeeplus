/**
 * Banking → AI Gateway internal client for statement OCR (scans/photos only;
 * text PDFs never reach the gateway — spec §20). Mirrors the line-ai
 * AiGatewayClient transport: internal secret header, bounded timeout,
 * fail-closed on transport errors.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { AiModelPolicy, BankStatementAiExtractRequest, BankStatementAiExtractResponse } from '@watchdog-bms/contracts';
import { AI_BANK_STATEMENT_MAX_PROVIDER_CALLS, aiGatewayClientTimeoutMs } from '@watchdog-bms/contracts';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { resolveCompanyAiModelPolicy } from '../../line-ai/application/company-ai-model-policy';
import { classifyAiUsageRequest, companyAiBudgetRefusal, recordCompanyAiUsage, runWithCompanyAiBudgetAdmission } from '../../line-ai/application/company-ai-usage-meter';
import { cancelAiBudgetStep, type AiBudgetCancelProof, type ReservedAiBudgetStep } from '../../line-ai/application/company-ai-budget-reservation';
import {
  admitCompanyOcr,
  companyOcrErrorCode,
  isOcrPreProviderHttpStatus,
  isOcrPreProviderRefusal,
  releaseCompanyOcrAdmission,
} from '../../line-ai/application/company-ocr-governance';

// 2 x 45s of gateway provider chain (stage-1 read, then one extraction call) + 15s margin. Same
// rule as the receipt callers: aborting before the gateway finishes loses the response body that
// `recordCompanyAiUsage` bills from, so the provider spend would be paid for and never metered.
// This route is outside the plan slip ceiling, so there is no admission to refund — but the money
// leak is identical, and 60s could not contain a 90s chain.
const EXTRACT_TIMEOUT_MS = aiGatewayClientTimeoutMs(AI_BANK_STATEMENT_MAX_PROVIDER_CALLS);

@Injectable()
export class StatementAiExtractClient {
  private readonly logger = new Logger(StatementAiExtractClient.name);

  constructor(
    private readonly config: AppConfigService,
    @Inject(RedisRateLimitService) private readonly rateLimits: RedisRateLimitService | undefined,
    private readonly prisma: PrismaService,
  ) {}

  async extract(request: BankStatementAiExtractRequest): Promise<BankStatementAiExtractResponse> {
    if (this.rateLimits) {
      const decision = await this.rateLimits.consume('ai-ocr-company', request.companyId, this.config.aiOcrMaxPerCompany, this.config.aiRateLimitWindowSeconds);
      if (!decision.allowed) return { status: 'failed', errorCode: 'AI_OCR_RATE_LIMITED' };
    }
    if (!this.config.aiGatewayInternalSecret) {
      return { status: 'not_configured', errorCode: 'AI_GATEWAY_SECRET_MISSING' };
    }
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
      (monthKey, hold) => this.extractOcrAdmitted(request, modelPolicy, monthKey, hold),
      undefined,
      {
        // ADR 0013 §4: the import's own request id is the logical attempt for a statement read.
        stepKind: 'bank-statement', attemptKey: `statement:${request.requestId}`,
        sourceRoute: 'bank-statement-extract', modelId: modelPolicy?.modelId ?? '', requestId: request.requestId,
        ...classifyAiUsageRequest('bank-statement-extract', 'image'),
      },
    );
    if (admission.allowed) return admission.value;
    // Refused BEFORE `admitCompanyOcr`: no OCR read counted, nothing to release, uploaded source
    // untouched. The scope rides along so the import screen can name the ceiling (spec §9.1).
    const refusal = companyAiBudgetRefusal(admission);
    return { status: 'failed', errorCode: refusal.code, budgetScope: refusal.budgetScope };
  }

  private async extractOcrAdmitted(
    request: BankStatementAiExtractRequest,
    modelPolicy: AiModelPolicy | undefined,
    budgetMonthKey?: string,
    hold?: ReservedAiBudgetStep,
  ): Promise<BankStatementAiExtractResponse> {
    const admission = await admitCompanyOcr(this.prisma, {
      companyId: request.companyId,
      sourceRoute: 'bank-statement-extract',
      requestId: request.requestId,
      monthKey: budgetMonthKey,
    });
    if (!admission.allowed) {
      // The hold was taken before this gate; the gate refusing is proof no provider call started.
      await this.releaseHold(hold, 'ocr_admission_refused');
      return { status: 'failed', errorCode: companyOcrErrorCode(admission) };
    }
    const result = await this.extractAdmitted(request, modelPolicy, budgetMonthKey, admission.eventId, hold);
    if (isOcrPreProviderRefusal(result)) {
      await this.releaseHold(hold, 'gateway_pre_provider_refusal');
      const released = await releaseCompanyOcrAdmission(this.prisma, {
        companyId: request.companyId,
        sourceRoute: 'bank-statement-extract',
        requestId: request.requestId,
        eventId: admission.eventId,
      });
      if (!released) return { status: 'failed', errorCode: 'OCR_QUOTA_UNAVAILABLE' };
    }
    return result;
  }

  /** The one place this seam may release money, and only with a proof that no provider ran (R-05). */
  private async releaseHold(hold: ReservedAiBudgetStep | undefined, proof: AiBudgetCancelProof): Promise<void> {
    if (hold) await cancelAiBudgetStep(this.prisma, { reservationId: hold.id, ownerToken: hold.ownerToken, proof });
  }

  private async extractAdmitted(
    request: BankStatementAiExtractRequest,
    modelPolicy: AiModelPolicy | undefined,
    budgetMonthKey: string | undefined,
    eventId: string,
    hold?: ReservedAiBudgetStep,
  ): Promise<BankStatementAiExtractResponse> {
    const secret = this.config.aiGatewayInternalSecret!;
    const governedRequest = { ...request, ...(modelPolicy && { modelPolicy }), ...(hold && { budgetEnvelope: hold.envelope }) };
    let response: Response;
    try {
      response = await fetch(`${this.config.aiGatewayInternalUrl}/internal/ai/bank-statement-extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify(governedRequest),
        signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error({ msg: 'statement extract gateway unreachable', error: (err as Error).message, requestId: request.requestId });
      return { status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE' };
    }

    if (!response.ok) {
      this.logger.error({ msg: 'statement extract gateway error', status: response.status, requestId: request.requestId });
      if (isOcrPreProviderHttpStatus(response.status)) {
        // A locally observed 4xx from the gateway proves it refused before any provider call.
        await this.releaseHold(hold, 'gateway_pre_provider_refusal');
        const released = await releaseCompanyOcrAdmission(this.prisma, {
          companyId: request.companyId,
          sourceRoute: 'bank-statement-extract',
          requestId: request.requestId,
          eventId,
        });
        if (!released) return { status: 'failed', errorCode: 'OCR_QUOTA_UNAVAILABLE' };
      }
      return { status: 'failed', errorCode: `AI_GATEWAY_ERROR_${response.status}` };
    }

    const result = (await response.json()) as BankStatementAiExtractResponse;
    try {
      await recordCompanyAiUsage(
        this.prisma,
        this.config,
        {
          companyId: request.companyId, sourceRoute: 'bank-statement-extract', requestId: request.requestId, monthKey: budgetMonthKey,
          ...(hold && { invocationKey: hold.invocationKey }),
          // The contract admits JPEG/PNG only, so this seam is always an image read.
          ...classifyAiUsageRequest('bank-statement-extract', 'image'),
        },
        result.usage,
      );
    } catch (err) {
      this.logger.warn({ msg: 'ai.usage.record_failed', requestId: request.requestId, error: (err as Error).message });
    }
    return result;
  }
}
