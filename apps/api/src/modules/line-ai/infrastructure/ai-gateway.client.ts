/**
 * AI Gateway internal HTTP client.
 * Sends server-derived context only; never raw LINE secrets or user tokens.
 */
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import {
  AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS,
  LINE_TOOL_REGISTRY,
  LINE_AI_ACTOR_DELEGATIONS_PER_TOOL,
  hasToolFeature,
  hasToolPermissions,
  parseLineAiPreparedPlan,
  type AiUsageEntry,
  type LineAiTurnRequest,
  type LineAiTurnResponse,
  type LineIntakeRoutePlan,
  type LineIntakeRouteRequest,
  type ReceiptOcrRequest,
  type ReceiptOcrResponse,
} from '@watchdog-bms/contracts';
import { safeLineErrorDetails } from './line-reply.adapter';
import { ActorDelegationService } from './actor-delegation.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  type AiRequestContent,
  classifyAiUsageRequest,
  recordCompanyAiUsage,
  retryBusyAdmission,
  runWithCompanyAiBudgetAdmission,
} from '../application/company-ai-usage-meter';
import { resolveCompanyAiModelPolicy } from '../application/company-ai-model-policy';
import {
  type CompanyOcrAdmissionIdentity,
  admitCompanyOcr,
  companyOcrErrorCode,
  isOcrPreProviderHttpStatus,
  isOcrPreProviderRefusal,
  isOcrRetryableProviderFailure,
  releaseCompanyOcrAdmission,
} from '../application/company-ocr-governance';

const LINE_TURN_TIMEOUT_MS = 120_000;
const LINE_INTAKE_TIMEOUT_MS = 30_000;
/** An intake carrying an image runs the gateway's DOCUMENT reader (45s budget there), so this
 *  caller must outlast it — otherwise the HTTP client aborts first and the provider-side fix is
 *  invisible. Kept strictly above the gateway budget plus request overhead (UAT 2026-08-27). */
const LINE_INTAKE_MEDIA_TIMEOUT_MS = 55_000;
// Same endpoint/provider chain as web. Outlast it to retain the usage response: an early transport
// abort has unknown provider cost even when its failed customer admission is released.
const RECEIPT_OCR_TIMEOUT_MS = AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS;

export class AiGatewayRequestError extends Error {
  constructor(
    public readonly code: 'AI_GATEWAY_TIMEOUT' | 'AI_GATEWAY_UNAVAILABLE',
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AiGatewayRequestError';
  }
}

/** A receipt read is OCR either way; the KIND still reports a PDF honestly as OTHER. */
const receiptOcrContent = (request: ReceiptOcrRequest): AiRequestContent =>
  request.attachment.mimeType === 'application/pdf' ? 'document' : 'image';

export type GovernedLineIntakeRoutePlan = LineIntakeRoutePlan & {
  /** Present only when a content-bearing LINE media request crossed the OCR governance seam. */
  ocrAdmission?: 'admitted' | 'denied';
  /**
   * The Bangkok month the admission was counted in, pinned by the budget lease rather than read off
   * the clock. The reply is built seconds later, and on the night of the 31st those seconds can land
   * in the next month — a fresh `bangkokMonthKey()` would then read the NEW month's aggregate and
   * tell a trial shop it was on read 1 of 15 immediately after spending its last one.
   */
  ocrMonthKey?: string;
  /** Prevents a denied/uncertain intake route from making a second image-provider call downstream. */
  ocrErrorCode?: string;
};

@Injectable()
export class AiGatewayClient {
  private readonly logger = new Logger(AiGatewayClient.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly actorDelegation: ActorDelegationService,
    @Inject(RedisRateLimitService) private readonly rateLimits: RedisRateLimitService | undefined,
    private readonly prisma: PrismaService,
  ) {}

  async requestLineTurn(request: LineAiTurnRequest, options: { busyWaitDeadlineMs?: number } = {}): Promise<LineAiTurnResponse> {
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
        // Inline bytes only: a storageKey-only attachment is not content the model receives.
        // The bucket stays CHAT either way (§12.2) — this only reports what was sent.
        !request.attachments?.some((a) => a.contentBase64) ? 'text'
          : request.attachments.some((a) => a.contentBase64 && a.mimeType !== 'application/pdf') ? 'image' : 'document',
      ),
      options.busyWaitDeadlineMs,
      request.attachments?.length ? 'media' : 'chat',
    );
  }

  async requestReceiptOcr(
    request: ReceiptOcrRequest,
    options: { ocrAlreadyAdmitted?: boolean; admissionIdentity?: CompanyOcrAdmissionIdentity; onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void; busyWaitDeadlineMs?: number } = {},
  ): Promise<ReceiptOcrResponse> {
    const companyId = request.companyId;
    await this.assertRateLimit('ocr', companyId);
    if (!this.config.aiGatewayInternalSecret) {
      return this.postInternal<ReceiptOcrResponse>(
        '/internal/ai/receipt-ocr', request, request.requestId, RECEIPT_OCR_TIMEOUT_MS,
        undefined, receiptOcrContent(request),
      );
    }
    const modelPolicy = await resolveCompanyAiModelPolicy(
      this.prisma,
      companyId,
      this.config.approvedAiModelIds,
    );
    const governedRequest = { ...request, ...(modelPolicy && { modelPolicy }) };
    return this.runBudgeted(
      companyId,
      (monthKey) => this.requestReceiptOcrAdmitted(governedRequest, monthKey, options),
      options.busyWaitDeadlineMs,
      'media',
    );
  }

  private async requestReceiptOcrAdmitted(
    request: ReceiptOcrRequest,
    budgetMonthKey?: string,
    options: { ocrAlreadyAdmitted?: boolean; admissionIdentity?: CompanyOcrAdmissionIdentity; onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void } = {},
  ): Promise<ReceiptOcrResponse> {
    let identity = options.admissionIdentity;
    if (!options.ocrAlreadyAdmitted) {
      const admission = await admitCompanyOcr(this.prisma, {
        companyId: request.companyId,
        sourceRoute: 'receipt-ocr-line',
        // LINE can redeliver one media message under a new webhook/request id. The attachment id is
        // the provider input identity, so it is the durable request fence and never burns quota twice.
        requestId: request.attachment.id,
        monthKey: budgetMonthKey,
        enforceReceiptQuota: this.config.receiptQuotaEnforced,
      });
      if (!admission.allowed) return { status: 'failed', errorCode: companyOcrErrorCode(admission) };
      identity = admission;
      options.onAdmitted?.(admission);
    }
    let result: ReceiptOcrResponse;
    try {
      result = await this.postInternal<ReceiptOcrResponse>(
        '/internal/ai/receipt-ocr',
        request,
        request.requestId,
        RECEIPT_OCR_TIMEOUT_MS,
        budgetMonthKey,
        receiptOcrContent(request),
      );
    } catch (error) {
      const status = error instanceof AiGatewayRequestError ? error.httpStatus : undefined;
      const refusal = status !== undefined && isOcrPreProviderHttpStatus(status);
      if (identity) {
        const released = await releaseCompanyOcrAdmission(this.prisma, {
          companyId: request.companyId,
          sourceRoute: 'receipt-ocr-line',
          requestId: request.attachment.id,
          eventId: identity.eventId,
          ...(refusal ? {} : { reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT' as const }),
        });
        if (!released) return { status: 'failed', errorCode: 'OCR_QUOTA_UNAVAILABLE' };
      }
      throw error;
    }
    // A system failure before usable fields can release customer admission. Provider usage was
    // recorded independently by postInternal and is never removed by this compensation.
    if (identity && (isOcrPreProviderRefusal(result) || isOcrRetryableProviderFailure(result))) {
      const released = await releaseCompanyOcrAdmission(this.prisma, {
        companyId: request.companyId,
        sourceRoute: 'receipt-ocr-line',
        requestId: request.attachment.id,
        eventId: identity.eventId,
        ...(isOcrRetryableProviderFailure(result) ? { reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT' as const } : {}),
      });
      if (!released) return { status: 'failed', errorCode: 'OCR_QUOTA_UNAVAILABLE' };
    }
    return result;
  }

  /** LINE Intake Router: semantic route plan before intake dispatch. */
  async requestLineIntakeRoute(request: LineIntakeRouteRequest, options: { busyWaitDeadlineMs?: number; retryWebhookEventId?: string; onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void } = {}): Promise<GovernedLineIntakeRoutePlan> {
    const companyId = (request as any).companyId ?? (request as any).userContext?.companyId;
    await this.assertRateLimit('llm', companyId);
    const media = request.attachments?.find((attachment) =>
      Boolean(attachment.contentBase64)
      && (attachment.mimeType === 'image/jpeg' || attachment.mimeType === 'image/png'));
    if (media) {
      if (!this.config.aiGatewayInternalSecret) {
        return {
          status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0,
          errorCode: 'ROUTER_UNREACHABLE', ocrAdmission: 'denied', ocrErrorCode: 'AI_GATEWAY_UNAVAILABLE',
        };
      }
      // Match the receipt OCR seam: a bad tenant policy is local readiness and must fail before
      // the durable document-read admission.
      await resolveCompanyAiModelPolicy(this.prisma, companyId, this.config.approvedAiModelIds);
    }
    const plan = await this.runBudgeted(
      companyId,
      (monthKey) => this.requestLineIntakeRouteAdmitted(request, media?.id, monthKey, options.retryWebhookEventId, options.onAdmitted),
      options.busyWaitDeadlineMs,
      media ? 'media' : 'chat',
    );
    // The AI Gateway is a separate service; its optional prepared plan is untrusted wire JSON. Re-bound
    // it here (discard an invalid plan) before the API ever forwards it into a LineAiTurnRequest.
    return plan.preparedPlan === undefined
      ? plan
      : { ...plan, preparedPlan: parseLineAiPreparedPlan(plan.preparedPlan) };
  }

  private async requestLineIntakeRouteAdmitted(
    request: LineIntakeRouteRequest,
    mediaId: string | undefined,
    budgetMonthKey?: string,
    retryWebhookEventId?: string,
    onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void,
  ): Promise<GovernedLineIntakeRoutePlan> {
    if (!mediaId) {
      return this.postInternal<LineIntakeRoutePlan>(
        '/internal/ai/line-intake-route', request, request.requestId, LINE_INTAKE_TIMEOUT_MS, budgetMonthKey, 'text',
      );
    }
    const admission = await admitCompanyOcr(this.prisma, {
      companyId: request.companyId,
      sourceRoute: 'receipt-ocr-line',
      requestId: mediaId,
      retryWebhookEventId,
      monthKey: budgetMonthKey,
      // The LINE lane's ONE document-read admission: the receipt OCR below runs with
      // `ocrAlreadyAdmitted`, so if the plan ceiling is not applied here it is not applied at all.
      enforceReceiptQuota: this.config.receiptQuotaEnforced,
    });
    if (!admission.allowed) {
      return {
        status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0,
        errorCode: 'ROUTER_UNREACHABLE', ocrAdmission: 'denied', ocrErrorCode: companyOcrErrorCode(admission),
      };
    }
    onAdmitted?.(admission);
    try {
      // `mediaId` is set only for a JPEG/PNG that crossed the governed image-intake seam, so the
      // whole call is an image read (and therefore OCR) — exactly the §12.2 rule, no re-derivation.
      const plan = await this.postInternal<LineIntakeRoutePlan>(
        '/internal/ai/line-intake-route', request, request.requestId, LINE_INTAKE_MEDIA_TIMEOUT_MS, budgetMonthKey, 'image',
      );
      if (plan.status === 'UNAVAILABLE') {
        if (plan.errorCode === 'PROVIDER_DISABLED' || plan.errorCode === 'PROVIDER_CONFIG_MISSING') {
          const released = await releaseCompanyOcrAdmission(this.prisma, {
            companyId: request.companyId,
            sourceRoute: 'receipt-ocr-line',
            requestId: mediaId,
            eventId: admission.eventId,
          });
          // The intake router and receipt extractor may use different providers. Once the router
          // proves it never called its provider and the fence is released, let receipt OCR admit
          // the image afresh instead of turning a router-only outage into a manual-only receipt.
          return released
            ? { ...plan, ocrAdmission: 'denied', ocrErrorCode: undefined }
            : { ...plan, ocrAdmission: 'admitted', ocrErrorCode: 'OCR_QUOTA_UNAVAILABLE', ocrMonthKey: admission.monthKey };
        }
        const released = await releaseCompanyOcrAdmission(this.prisma, {
          companyId: request.companyId, sourceRoute: 'receipt-ocr-line', requestId: mediaId, eventId: admission.eventId, reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT',
        });
        return { ...plan, ocrAdmission: released ? 'denied' : 'admitted',
          ocrErrorCode: released ? 'OCR_ROUTE_UNAVAILABLE' : 'OCR_QUOTA_UNAVAILABLE', ocrMonthKey: admission.monthKey };
      }
      return { ...plan, ocrAdmission: 'admitted', ocrMonthKey: admission.monthKey };
    } catch (error) {
      const status = error instanceof AiGatewayRequestError ? error.httpStatus : undefined;
      const refusal = status !== undefined && isOcrPreProviderHttpStatus(status);
      if (refusal) {
        const released = await releaseCompanyOcrAdmission(this.prisma, {
          companyId: request.companyId,
          sourceRoute: 'receipt-ocr-line',
          requestId: mediaId,
          eventId: admission.eventId,
        });
        return {
          status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0,
          errorCode: 'ROUTER_UNREACHABLE',
          ocrAdmission: released ? 'denied' : 'admitted',
          ocrErrorCode: released ? 'AI_GATEWAY_UNAVAILABLE' : 'OCR_QUOTA_UNAVAILABLE',
        };
      }
      // Customer admission measures usable receipt reads. Transport failure supplies no result;
      // release its fence exactly once, but do not fabricate or delete provider usage entries.
      const released = await releaseCompanyOcrAdmission(this.prisma, {
        companyId: request.companyId, sourceRoute: 'receipt-ocr-line', requestId: mediaId, eventId: admission.eventId, reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT',
      });
      this.logger.warn({ msg: 'line_ocr_no_usable_result', requestId: request.requestId,
        providerCost: 'unknown', ...safeLineErrorDetails(error) });
      return {
        status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0,
        errorCode: 'ROUTER_UNREACHABLE', ocrAdmission: released ? 'denied' : 'admitted',
        ocrErrorCode: released ? 'OCR_ROUTE_UNAVAILABLE' : 'OCR_QUOTA_UNAVAILABLE', ocrMonthKey: admission.monthKey,
      };
    }
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

  private async runBudgeted<T>(companyId: string | undefined, action: (monthKey?: string) => Promise<T>, busyWaitDeadlineMs?: number, laneKey?: 'chat' | 'media'): Promise<T> {
    if (!companyId) return action();
    const admission = await retryBusyAdmission(
      () => runWithCompanyAiBudgetAdmission(this.prisma, this.config, this.rateLimits, companyId, action, laneKey),
      busyWaitDeadlineMs,
    );
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
    /** What this caller put in the request, for the server-derived bucket/kind (spec §12.2). */
    content: AiRequestContent = 'text',
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
      this.logger.error({ msg: 'AI Gateway request failed', ...safeLineErrorDetails(err), requestId });
      const name = (err as { name?: string }).name;
      throw new AiGatewayRequestError(
        name === 'TimeoutError' || name === 'AbortError' ? 'AI_GATEWAY_TIMEOUT' : 'AI_GATEWAY_UNAVAILABLE',
        name === 'TimeoutError' || name === 'AbortError' ? 'AI Gateway request timed out' : 'AI Gateway is unavailable',
      );
    }

    if (!response.ok) {
      // The downstream response must never be able to reflect delegation material into logs.
      this.logger.error({ msg: 'AI Gateway error response', status: response.status, requestId });
      throw new AiGatewayRequestError(
        'AI_GATEWAY_UNAVAILABLE',
        `AI Gateway returned HTTP ${response.status}`,
        response.status,
      );
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
      content,
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
    content: AiRequestContent = 'text',
  ): Promise<void> {
    if (!companyId) return;
    try {
      await recordCompanyAiUsage(
        this.prisma,
        this.config,
        { companyId, sourceRoute, requestId, monthKey, ...classifyAiUsageRequest(sourceRoute, content) },
        usage,
      );
    } catch (err) {
      this.logger.warn({ msg: 'ai.usage.record_failed', sourceRoute, requestId, ...safeLineErrorDetails(err) });
    }
  }
}
