/**
 * CRM AI Gateway internal HTTP client.
 * Sends server-derived context only; never imports the LINE AI client.
 */
import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  AiUsageEntry,
  CrmBookingExtractRequest,
  CrmBookingExtractResult,
  CrmBroadcastGenerateRequest,
  CrmBroadcastGenerateResult,
  CrmConversationSummaryRequest,
  CrmConversationSummaryResult,
  CrmCustomerIntakeRequest,
  CrmCustomerIntakeResult,
  CrmCustomerProfileExtractRequest,
  CrmCustomerProfileExtractResult,
  CrmInsightsRequest,
  CrmInsightsResult,
  CrmReplyDraftRequest,
  CrmReplyDraftResult,
} from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { resolveCompanyAiModelPolicy } from '../../line-ai/application/company-ai-model-policy';
import { classifyAiUsageRequest, companyAiBudgetRefusal, recordCompanyAiUsage, runWithCompanyAiBudgetAdmission } from '../../line-ai/application/company-ai-usage-meter';

@Injectable()
export class CrmAiGatewayClient {
  private readonly logger = new Logger(CrmAiGatewayClient.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly rateLimits?: RedisRateLimitService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async requestCrmSummary(request: CrmConversationSummaryRequest): Promise<CrmConversationSummaryResult> {
    return this.postInternal<CrmConversationSummaryResult>('/internal/ai/crm-summary', request, request.requestId);
  }

  async requestCrmReplyDraft(request: CrmReplyDraftRequest): Promise<CrmReplyDraftResult> {
    return this.postInternal<CrmReplyDraftResult>('/internal/ai/crm-reply-draft', request, request.requestId);
  }

  async requestCrmIntake(request: CrmCustomerIntakeRequest): Promise<CrmCustomerIntakeResult> {
    return this.postInternal<CrmCustomerIntakeResult>('/internal/ai/crm-intake', request, request.requestId);
  }

  async requestCustomerProfileExtract(request: CrmCustomerProfileExtractRequest): Promise<CrmCustomerProfileExtractResult> {
    return this.postInternal<CrmCustomerProfileExtractResult>('/internal/ai/crm-customer-profile-extract', request, request.requestId);
  }

  async requestCrmBookingExtract(request: CrmBookingExtractRequest): Promise<CrmBookingExtractResult> {
    return this.postInternal<CrmBookingExtractResult>('/internal/ai/crm-booking-extract', request, request.requestId);
  }

  async requestCrmInsights(request: CrmInsightsRequest): Promise<CrmInsightsResult> {
    return this.postInternal<CrmInsightsResult>('/internal/ai/crm-insights', request, request.requestId);
  }

  async requestBroadcastGenerate(request: CrmBroadcastGenerateRequest): Promise<CrmBroadcastGenerateResult> {
    return this.postInternal<CrmBroadcastGenerateResult>('/internal/ai/crm-broadcast', request, request.requestId);
  }

  private async postInternal<T>(path: string, request: unknown, requestId: string): Promise<T> {
    const companyId = (request as any)?.companyId ?? (request as any)?.userContext?.companyId;
    if (this.rateLimits) {
      if (!companyId) throw new Error('AI_RATE_LIMIT_COMPANY_REQUIRED');
      const decision = await this.rateLimits.consume('ai-llm-company', companyId, this.config.aiLlmMaxPerCompany, this.config.aiRateLimitWindowSeconds);
      if (!decision.allowed) throw new HttpException(
        { code: 'AI_LLM_RATE_LIMITED', retryAfterSeconds: decision.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!this.prisma || !companyId) return this.postAdmitted<T>(path, request, requestId, companyId);
    const admission = await runWithCompanyAiBudgetAdmission(
      this.prisma,
      this.config,
      this.rateLimits,
      companyId,
      (monthKey) => this.postAdmitted<T>(path, request, requestId, companyId, monthKey),
    );
    if (admission.allowed) return admission.value;
    // Same typed code + scope the LINE seam throws (spec §9.1), from the one shared mapper.
    throw new HttpException(companyAiBudgetRefusal(admission), HttpStatus.TOO_MANY_REQUESTS);
  }

  private async postAdmitted<T>(
    path: string,
    request: unknown,
    requestId: string,
    companyId: string | undefined,
    budgetMonthKey?: string,
  ): Promise<T> {
    const url = `${this.config.aiGatewayInternalUrl}${path}`;
    const secret = this.config.aiGatewayInternalSecret;
    if (!secret) {
      this.logger.error({ msg: 'AI Gateway internal secret missing', requestId });
      throw new Error('AI_GATEWAY_INTERNAL_SECRET_NOT_CONFIGURED');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Internal-Secret': secret,
    };

    // One resolution per CRM action; an unapproved tenant model throws and fails the action closed.
    const modelPolicy = this.prisma && companyId
      ? await resolveCompanyAiModelPolicy(this.prisma, companyId, this.config.approvedAiModelIds)
      : undefined;
    const governedRequest = { ...(request as Record<string, unknown>), ...(modelPolicy && { modelPolicy }) };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(governedRequest),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.error({ msg: 'AI Gateway request failed', error: (err as Error).message, requestId });
      throw new Error('AI_GATEWAY_TIMEOUT');
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      this.logger.error({ msg: 'AI Gateway error response', status: response.status, requestId, body: errText.slice(0, 200) });
      throw new Error(`AI_GATEWAY_ERROR:${response.status}`);
    }

    let result: T;
    try {
      result = (await response.json()) as T;
    } catch (err) {
      this.logger.error({ msg: 'AI Gateway bad JSON response', error: (err as Error).message, requestId });
      throw new Error('AI_GATEWAY_BAD_RESPONSE');
    }

    // sourceRoute from the path: 'crm-summary', 'crm-reply-draft', … Metering must never
    // fail a CRM action the model already ran (spec §6.7).
    if (this.prisma && companyId) {
      try {
        await recordCompanyAiUsage(
          this.prisma,
          this.config,
          {
            companyId, sourceRoute: path.replace('/internal/ai/', ''), requestId, monthKey: budgetMonthKey,
            // CRM AI is text-only reasoning over inbox threads; never a document read (§12.2).
            ...classifyAiUsageRequest(path.replace('/internal/ai/', ''), 'text'),
          },
          (result as { usage?: AiUsageEntry[] })?.usage,
        );
      } catch (err) {
        this.logger.warn({ msg: 'ai.usage.record_failed', path, requestId, error: (err as Error).message });
      }
    }
    return result;
  }
}
