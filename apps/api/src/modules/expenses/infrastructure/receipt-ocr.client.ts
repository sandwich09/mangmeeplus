import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { ReceiptOcrRequest, ReceiptOcrResponse } from '@watchdog-bms/contracts';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { resolveCompanyAiModelPolicy } from '../../line-ai/application/company-ai-model-policy';
import { assertCompanyAiBudget, recordCompanyAiUsage } from '../../line-ai/application/company-ai-usage-meter';

const EXTRACT_TIMEOUT_MS = 120_000;

@Injectable()
export class ReceiptOcrClient {
  private readonly logger = new Logger(ReceiptOcrClient.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly rateLimits?: RedisRateLimitService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async extract(request: ReceiptOcrRequest): Promise<ReceiptOcrResponse> {
    if (this.rateLimits) {
      const companyId = (request as any).companyId ?? (request as any).userContext?.companyId;
      if (!companyId) return { status: 'failed', errorCode: 'AI_RATE_LIMIT_COMPANY_REQUIRED' };
      const decision = await this.rateLimits.consume('ai-ocr-company', companyId, this.config.aiOcrMaxPerCompany, this.config.aiRateLimitWindowSeconds);
      if (!decision.allowed) return { status: 'failed', errorCode: 'AI_OCR_RATE_LIMITED' };
    }
    // Monthly cap after the per-window limiter, still ahead of the gateway call (spec §6.6).
    if (this.prisma) {
      const budget = await assertCompanyAiBudget(this.prisma, this.config, request.companyId);
      if (!budget.allowed) {
        return { status: 'failed', errorCode: budget.reason === 'exceeded' ? 'AI_MONTHLY_BUDGET_EXCEEDED' : 'AI_BUDGET_UNAVAILABLE' };
      }
    }
    const secret = this.config.aiGatewayInternalSecret;
    if (!secret) return { status: 'not_configured', errorCode: 'AI_GATEWAY_SECRET_MISSING' };

    const modelPolicy = this.prisma
      ? await resolveCompanyAiModelPolicy(this.prisma, request.companyId, this.config.approvedAiModelIds)
      : undefined;
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
      return { status: 'failed', errorCode: `AI_GATEWAY_ERROR_${response.status}` };
    }

    const result = (await response.json()) as ReceiptOcrResponse;
    // Same route name as the LINE lane's OCR seam, different flow — both record.
    if (this.prisma) {
      try {
        await recordCompanyAiUsage(
          this.prisma,
          this.config,
          { companyId: request.companyId, sourceRoute: 'receipt-ocr', requestId: request.requestId },
          result.usage,
        );
      } catch (err) {
        this.logger.warn({ msg: 'ai.usage.record_failed', requestId: request.requestId, error: (err as Error).message });
      }
    }
    return result;
  }
}
