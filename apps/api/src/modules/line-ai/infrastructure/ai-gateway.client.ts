/**
 * AI Gateway internal HTTP client.
 * Sends server-derived context only; never raw LINE secrets or user tokens.
 */
import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import {
  LINE_TOOL_REGISTRY,
  LINE_AI_ACTOR_DELEGATIONS_PER_TOOL,
  hasToolFeature,
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
import { recordCompanyAiUsage, runWithCompanyAiBudgetAdmission } from '../application/company-ai-usage-meter';

const LINE_TURN_TIMEOUT_MS = 120_000;
const LINE_INTAKE_TIMEOUT_MS = 30_000;
const RECEIPT_OCR_TIMEOUT_MS = 120_000;

export class AiGatewayRequestError extends Error {
  constructor(public readonly code: 'AI_GATEWAY_TIMEOUT' | 'AI_GATEWAY_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'AiGatewayRequestError';
  }
}

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
    await this.assertRateLimit('llm', request.userContext.companyId);
    const { internalUserId: userId, companyId, membershipId, permissions, entitledFeatureKeys } = request.userContext;
    const entitled = entitledFeatureKeys === undefined
      ? undefined
      : entitledFeatureKeys === null ? null : new Set(entitledFeatureKeys);
    const actorDelegations = Object.fromEntries(
      (permissions.includes('ai.tool.invoke') ? LINE_TOOL_REGISTRY : [])
        .filter((tool) => hasToolPermissions(tool, permissions)
          && (entitled === undefined || hasToolFeature(tool, entitled)))
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
    return this.runBudgeted(
      request.userContext.companyId,
      (monthKey) => this.postInternal<LineAiTurnResponse>(
        '/internal/ai/line-turn',
        { ...request, actorDelegations },
        request.requestId,
        LINE_TURN_TIMEOUT_MS,
        monthKey,
      ),
    );
  }

  async requestReceiptOcr(request: ReceiptOcrRequest): Promise<ReceiptOcrResponse> {
    const companyId = (request as any).companyId ?? (request as any).userContext?.companyId;
    await this.assertRateLimit('ocr', companyId);
    return this.runBudgeted(
      companyId,
      (monthKey) => this.postInternal<ReceiptOcrResponse>(
        '/internal/ai/receipt-ocr',
        request,
        request.requestId,
        RECEIPT_OCR_TIMEOUT_MS,
        monthKey,
      ),
    );
  }

  /** LINE Intake Router: semantic route plan before intake dispatch. */
  async requestLineIntakeRoute(request: LineIntakeRouteRequest): Promise<LineIntakeRoutePlan> {
    const companyId = (request as any).companyId ?? (request as any).userContext?.companyId;
    await this.assertRateLimit('llm', companyId);
    return this.runBudgeted(
      companyId,
      (monthKey) => this.postInternal<LineIntakeRoutePlan>(
        '/internal/ai/line-intake-route',
        request,
        request.requestId,
        LINE_INTAKE_TIMEOUT_MS,
        monthKey,
      ),
    );
  }

  private async assertRateLimit(kind: 'llm' | 'ocr', companyId: string | undefined): Promise<void> {
    if (this.rateLimits) {
      if (!companyId) throw new Error('AI_RATE_LIMIT_COMPANY_REQUIRED');
      const max = kind === 'ocr' ? this.config.aiOcrMaxPerCompany : this.config.aiLlmMaxPerCompany;
      const decision = await this.rateLimits.consume(`ai-${kind}-company`, companyId, max, this.config.aiRateLimitWindowSeconds);
      if (!decision.allowed) throw new HttpException(
        { code: `AI_${kind.toUpperCase()}_RATE_LIMITED`, retryAfterSeconds: decision.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async runBudgeted<T>(companyId: string | undefined, action: (monthKey?: string) => Promise<T>): Promise<T> {
    if (!this.prisma || !companyId) return action();
    const admission = await runWithCompanyAiBudgetAdmission(this.prisma, this.config, this.rateLimits, companyId, action);
    if (admission.allowed) return admission.value;
    const body = admission.reason === 'busy'
      ? { code: 'AI_BUDGET_BUSY', retryAfterSeconds: admission.retryAfterSeconds }
      : { code: admission.reason === 'exceeded' ? 'AI_MONTHLY_BUDGET_EXCEEDED' : 'AI_BUDGET_UNAVAILABLE' };
    throw new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
  }

  private async postInternal<T>(
    path: string,
    request: unknown,
    requestId: string,
    timeoutMs: number,
    budgetMonthKey?: string,
  ): Promise<T> {
    const url = `${this.config.aiGatewayInternalUrl}${path}`;
    const secret = this.config.aiGatewayInternalSecret;
    if (!secret) {
      throw new AiGatewayRequestError('AI_GATEWAY_UNAVAILABLE', 'AI Gateway is not configured');
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
      const name = (err as { name?: string }).name;
      throw new AiGatewayRequestError(
        name === 'TimeoutError' || name === 'AbortError' ? 'AI_GATEWAY_TIMEOUT' : 'AI_GATEWAY_UNAVAILABLE',
        name === 'TimeoutError' || name === 'AbortError' ? 'AI Gateway request timed out' : 'AI Gateway is unavailable',
      );
    }

    if (!response.ok) {
      // The downstream response must never be able to reflect delegation material into logs.
      this.logger.error({ msg: 'AI Gateway error response', status: response.status, requestId });
      throw new AiGatewayRequestError('AI_GATEWAY_UNAVAILABLE', `AI Gateway returned HTTP ${response.status}`);
    }

    const result = (await response.json()) as T;
    // One seam for all three routes ('line-turn' | 'receipt-ocr' | 'line-intake-route');
    // sourceRoute comes from the path, the tenant from the request envelope.
    await this.meterUsage(
      path.replace('/internal/ai/', ''),
      (request as any)?.companyId ?? (request as any)?.userContext?.companyId,
      requestId,
      (result as { usage?: AiUsageEntry[] })?.usage,
      budgetMonthKey,
    );
    return result;
  }

  /** Metering must never fail an AI action the user already paid for (spec §6.7). */
  private async meterUsage(
    sourceRoute: string,
    companyId: string | undefined,
    requestId: string,
    usage: AiUsageEntry[] | undefined,
    monthKey?: string,
  ): Promise<void> {
    if (!this.prisma || !companyId) return;
    try {
      await recordCompanyAiUsage(this.prisma, this.config, { companyId, sourceRoute, requestId, monthKey }, usage);
    } catch (err) {
      this.logger.warn({ msg: 'ai.usage.record_failed', sourceRoute, requestId, error: (err as Error).message });
    }
  }
}
