/**
 * AI Gateway internal HTTP client.
 * Sends server-derived context only; never raw LINE secrets or user tokens.
 */
import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import {
  LINE_TOOL_REGISTRY,
  LINE_AI_ACTOR_DELEGATIONS_PER_TOOL,
  hasToolPermissions,
  type AiUsageEntry,
  type LineAiTurnRequest,
  type LineAiTurnResponse,
  type LineIntakeRoutePlan,
  type LineIntakeRouteRequest,
  type ReceiptOcrRequest,
  type ReceiptOcrResponse,
} from '@watchdog-bms/contracts';
import { ActorDelegationService } from './actor-delegation.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { assertCompanyAiBudget, recordCompanyAiUsage } from '../application/company-ai-usage-meter';

const LINE_TURN_TIMEOUT_MS = 120_000;
const LINE_INTAKE_TIMEOUT_MS = 30_000;
const RECEIPT_OCR_TIMEOUT_MS = 120_000;

@Injectable()
export class AiGatewayClient {
  private readonly logger = new Logger(AiGatewayClient.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly actorDelegation: ActorDelegationService,
    private readonly rateLimits?: RedisRateLimitService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async requestLineTurn(request: LineAiTurnRequest): Promise<LineAiTurnResponse> {
    await this.assertBudget('llm', request.userContext.companyId);
    const { internalUserId: userId, companyId, membershipId, permissions } = request.userContext;
    const actorDelegations = Object.fromEntries(
      (permissions.includes('ai.tool.invoke') ? LINE_TOOL_REGISTRY : [])
        .filter((tool) => hasToolPermissions(tool, permissions))
        .map((tool) => [
          tool.name,
          Array.from({ length: LINE_AI_ACTOR_DELEGATIONS_PER_TOOL }, () =>
            this.actorDelegation.issue({
              userId,
              companyId,
              membershipId,
              requestId: request.requestId,
              toolName: tool.name,
            })),
        ]),
    );
    return this.postInternal<LineAiTurnResponse>(
      '/internal/ai/line-turn',
      { ...request, actorDelegations },
      request.requestId,
      LINE_TURN_TIMEOUT_MS,
    );
  }

  async requestReceiptOcr(request: ReceiptOcrRequest): Promise<ReceiptOcrResponse> {
    await this.assertBudget('ocr', (request as any).companyId ?? (request as any).userContext?.companyId);
    return this.postInternal<ReceiptOcrResponse>(
      '/internal/ai/receipt-ocr',
      request,
      request.requestId,
      RECEIPT_OCR_TIMEOUT_MS,
    );
  }

  /** LINE Intake Router: semantic route plan before intake dispatch. */
  async requestLineIntakeRoute(request: LineIntakeRouteRequest): Promise<LineIntakeRoutePlan> {
    await this.assertBudget('llm', (request as any).companyId ?? (request as any).userContext?.companyId);
    return this.postInternal<LineIntakeRoutePlan>(
      '/internal/ai/line-intake-route',
      request,
      request.requestId,
      LINE_INTAKE_TIMEOUT_MS,
    );
  }

  private async assertBudget(kind: 'llm' | 'ocr', companyId: string | undefined): Promise<void> {
    if (this.rateLimits) {
      if (!companyId) throw new Error('AI_RATE_LIMIT_COMPANY_REQUIRED');
      const max = kind === 'ocr' ? this.config.aiOcrMaxPerCompany : this.config.aiLlmMaxPerCompany;
      const decision = await this.rateLimits.consume(`ai-${kind}-company`, companyId, max, this.config.aiRateLimitWindowSeconds);
      if (!decision.allowed) throw new HttpException(
        { code: `AI_${kind.toUpperCase()}_RATE_LIMITED`, retryAfterSeconds: decision.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Monthly cap after the per-window limiter, still ahead of the gateway call (spec §6.6).
    // No retryAfterSeconds: a monthly cap has no meaningful retry window, unlike the per-minute
    // bucket above — the caller waits for the next Bangkok month or a budget raise.
    if (!this.prisma || !companyId) return;
    const budget = await assertCompanyAiBudget(this.prisma, this.config, companyId);
    if (!budget.allowed) throw new HttpException(
      { code: budget.reason === 'exceeded' ? 'AI_MONTHLY_BUDGET_EXCEEDED' : 'AI_BUDGET_UNAVAILABLE' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async postInternal<T>(
    path: string,
    request: unknown,
    requestId: string,
    timeoutMs: number,
  ): Promise<T> {
    const url = `${this.config.aiGatewayInternalUrl}${path}`;
    const secret = this.config.aiGatewayInternalSecret;
    if (!secret) {
      throw new Error('AI_GATEWAY_INTERNAL_SECRET_NOT_CONFIGURED');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Secret in header, not logged
      'X-Internal-Secret': secret,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      this.logger.error({ msg: 'AI Gateway request failed', error: (err as Error).message, requestId });
      throw new Error('AI_GATEWAY_TIMEOUT');
    }

    if (!response.ok) {
      // The downstream response must never be able to reflect delegation material into logs.
      this.logger.error({ msg: 'AI Gateway error response', status: response.status, requestId });
      throw new Error(`AI_GATEWAY_ERROR:${response.status}`);
    }

    const result = (await response.json()) as T;
    // One seam for all three routes ('line-turn' | 'receipt-ocr' | 'line-intake-route');
    // sourceRoute comes from the path, the tenant from the request envelope.
    await this.meterUsage(
      path.replace('/internal/ai/', ''),
      (request as any)?.companyId ?? (request as any)?.userContext?.companyId,
      requestId,
      (result as { usage?: AiUsageEntry[] })?.usage,
    );
    return result;
  }

  /** Metering must never fail an AI action the user already paid for (spec §6.7). */
  private async meterUsage(
    sourceRoute: string,
    companyId: string | undefined,
    requestId: string,
    usage: AiUsageEntry[] | undefined,
  ): Promise<void> {
    if (!this.prisma || !companyId) return;
    try {
      await recordCompanyAiUsage(this.prisma, this.config, { companyId, sourceRoute, requestId }, usage);
    } catch (err) {
      this.logger.warn({ msg: 'ai.usage.record_failed', sourceRoute, requestId, error: (err as Error).message });
    }
  }
}
