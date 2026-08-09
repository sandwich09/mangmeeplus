/**
 * Banking → AI Gateway internal client for statement OCR (scans/photos only;
 * text PDFs never reach the gateway — spec §20). Mirrors the line-ai
 * AiGatewayClient transport: internal secret header, bounded timeout,
 * fail-closed on transport errors.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { BankStatementAiExtractRequest, BankStatementAiExtractResponse } from '@watchdog-bms/contracts';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { resolveCompanyAiModelPolicy } from '../../line-ai/application/company-ai-model-policy';
import { recordCompanyAiUsage, runWithCompanyAiBudgetAdmission } from '../../line-ai/application/company-ai-usage-meter';

const EXTRACT_TIMEOUT_MS = 60_000;

@Injectable()
export class StatementAiExtractClient {
  private readonly logger = new Logger(StatementAiExtractClient.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly rateLimits?: RedisRateLimitService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async extract(request: BankStatementAiExtractRequest): Promise<BankStatementAiExtractResponse> {
    if (this.rateLimits) {
      const decision = await this.rateLimits.consume('ai-ocr-company', request.companyId, this.config.aiOcrMaxPerCompany, this.config.aiRateLimitWindowSeconds);
      if (!decision.allowed) return { status: 'failed', errorCode: 'AI_OCR_RATE_LIMITED' };
    }
    if (!this.prisma) return this.extractAdmitted(request);
    const admission = await runWithCompanyAiBudgetAdmission(
      this.prisma,
      this.config,
      this.rateLimits,
      request.companyId,
      (monthKey) => this.extractAdmitted(request, monthKey),
    );
    if (admission.allowed) return admission.value;
    return {
      status: 'failed',
      errorCode: admission.reason === 'exceeded' ? 'AI_MONTHLY_BUDGET_EXCEEDED'
        : admission.reason === 'busy' ? 'AI_BUDGET_BUSY'
        : 'AI_BUDGET_UNAVAILABLE',
    };
  }

  private async extractAdmitted(request: BankStatementAiExtractRequest, budgetMonthKey?: string): Promise<BankStatementAiExtractResponse> {
    const secret = this.config.aiGatewayInternalSecret;
    if (!secret) return { status: 'not_configured', errorCode: 'AI_GATEWAY_SECRET_MISSING' };

    const modelPolicy = this.prisma
      ? await resolveCompanyAiModelPolicy(this.prisma, request.companyId, this.config.approvedAiModelIds)
      : undefined;
    const governedRequest = { ...request, ...(modelPolicy && { modelPolicy }) };
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
      return { status: 'failed', errorCode: `AI_GATEWAY_ERROR_${response.status}` };
    }

    const result = (await response.json()) as BankStatementAiExtractResponse;
    if (this.prisma) {
      try {
        await recordCompanyAiUsage(
          this.prisma,
          this.config,
          { companyId: request.companyId, sourceRoute: 'bank-statement-extract', requestId: request.requestId, monthKey: budgetMonthKey },
          result.usage,
        );
      } catch (err) {
        this.logger.warn({ msg: 'ai.usage.record_failed', requestId: request.requestId, error: (err as Error).message });
      }
    }
    return result;
  }
}
