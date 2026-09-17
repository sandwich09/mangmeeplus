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
  type AiBudgetRefusalCode,
  type AiBudgetScope,
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
  companyAiBudgetRefusal,
  recordCompanyAiUsage,
  retryBusyAdmission,
  runWithCompanyAiBudgetAdmission,
  type CompanyAiBudgetStep,
} from '../application/company-ai-usage-meter';
import { resolveCompanyAiModelPolicy } from '../application/company-ai-model-policy';
import {
  aiBudgetAttemptHash,
  cancelAiBudgetStep,
  type AiBudgetCancelProof,
  type ReservedAiBudgetStep,
} from '../application/company-ai-budget-reservation';
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
  /**
   * Set ONLY when our own money gate refused this route (spec §9.1). The turn carries it instead of
   * collapsing to `ROUTER_UNREACHABLE`, so the reply says why and nothing downstream retries the
   * same closed gate. A provider error that merely looks similar never sets it.
   */
  budgetErrorCode?: AiBudgetRefusalCode;
  budgetScope?: AiBudgetScope;
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

  async requestLineTurn(
    request: LineAiTurnRequest,
    /** `retryOrdinal` is the ledger drain's `deliveryCount`: the same attempt, the next try. */
    options: { busyWaitDeadlineMs?: number; retryOrdinal?: number } = {},
  ): Promise<LineAiTurnResponse> {
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
    const turnContent: AiRequestContent = !request.attachments?.some((a) => a.contentBase64) ? 'text'
      : request.attachments.some((a) => a.contentBase64 && a.mimeType !== 'application/pdf') ? 'image' : 'document';
    return this.runBudgeted(
      request.userContext.companyId,
      (monthKey, hold) => this.postInternal<LineAiTurnResponse>(
        '/internal/ai/line-turn',
        { ...request, actorDelegations },
        request.requestId,
        LINE_TURN_TIMEOUT_MS,
        monthKey,
        // Inline bytes only: a storageKey-only attachment is not content the model receives.
        // The bucket stays CHAT either way (§12.2) — this only reports what was sent.
        turnContent,
        hold,
      ),
      options.busyWaitDeadlineMs,
      request.attachments?.length ? 'media' : 'chat',
      {
        // ADR 0013 §4: the ORIGINAL webhook event is the attempt, never the transport request id
        // (the drain mints a fresh one on every reclaim). A reclaim is the SAME attempt at the next
        // retry ordinal, bounded by the existing delivery cap, so the previous invocation keeps
        // holding its money until evidence arrives instead of being re-run for free.
        stepKind: 'line-turn',
        attemptKey: `line-text:${aiBudgetAttemptHash(request.webhookEventId)}${options.retryOrdinal ? `:r${options.retryOrdinal}` : ''}`,
        sourceRoute: 'line-turn', modelId: request.modelPolicy?.modelId ?? '', requestId: request.requestId,
        ...classifyAiUsageRequest('line-turn', turnContent),
      },
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
      (monthKey, hold) => this.requestReceiptOcrAdmitted(governedRequest, monthKey, options, hold),
      options.busyWaitDeadlineMs,
      'media',
      {
        // The ATTACHMENT id is the provider input identity of a LINE document read — already the
        // durable OCR request fence. Hashed: it is a LINE message id (spec §12.4).
        stepKind: 'receipt-ocr', attemptKey: `line-image:${aiBudgetAttemptHash(request.attachment.id)}`,
        sourceRoute: 'receipt-ocr', modelId: modelPolicy?.modelId ?? '', requestId: request.requestId,
        ...classifyAiUsageRequest('receipt-ocr', receiptOcrContent(request)),
      },
    );
  }

  private async requestReceiptOcrAdmitted(
    request: ReceiptOcrRequest,
    budgetMonthKey?: string,
    options: { ocrAlreadyAdmitted?: boolean; admissionIdentity?: CompanyOcrAdmissionIdentity; onAdmitted?: (identity: CompanyOcrAdmissionIdentity) => void } = {},
    hold?: ReservedAiBudgetStep,
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
      if (!admission.allowed) {
        // Money was held before this count/switch/plan gate; its refusal proves no provider ran.
        await this.releaseHold(hold, 'ocr_admission_refused');
        return { status: 'failed', errorCode: companyOcrErrorCode(admission) };
      }
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
        hold,
      );
    } catch (error) {
      const status = error instanceof AiGatewayRequestError ? error.httpStatus : undefined;
      const refusal = status !== undefined && isOcrPreProviderHttpStatus(status);
      // R-05: only the locally observed pre-provider 4xx releases money. A transport failure has
      // UNKNOWN provider cost, so its hold stays and becomes UNRESOLVED — never cancelled.
      if (refusal) await this.releaseHold(hold, 'gateway_pre_provider_refusal');
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
    if (isOcrPreProviderRefusal(result)) await this.releaseHold(hold, 'gateway_pre_provider_refusal');
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
    let modelPolicy: Awaited<ReturnType<typeof resolveCompanyAiModelPolicy>>;
    if (media) {
      if (!this.config.aiGatewayInternalSecret) {
        return {
          status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0,
          errorCode: 'ROUTER_UNREACHABLE', ocrAdmission: 'denied', ocrErrorCode: 'AI_GATEWAY_UNAVAILABLE',
        };
      }
      // Match the receipt OCR seam: a bad tenant policy is local readiness and must fail before
      // the durable document-read admission.
      modelPolicy = await resolveCompanyAiModelPolicy(this.prisma, companyId, this.config.approvedAiModelIds);
    }
    const plan = await this.runBudgeted(
      companyId,
      (monthKey, hold) => this.requestLineIntakeRouteAdmitted(request, media?.id, monthKey, options.retryWebhookEventId, options.onAdmitted, hold),
      options.busyWaitDeadlineMs,
      media ? 'media' : 'chat',
      {
        // A picture routes AND transcribes in ONE provider call, so the whole call is OCR (§12.2).
        // The LINE message id is the durable identity of that picture; the text lane uses the
        // ORIGINAL webhook event when the caller sends one (E1c closed that contract gap) and only
        // falls back to the transport request id for a caller that does not — a fallback a LINE
        // redelivery under a fresh request id would let buy a second hold.
        stepKind: media ? 'line-intake-image' : 'line-intake-text',
        attemptKey: media
          ? `line-image:${aiBudgetAttemptHash(media.id)}`
          : `line-text:${aiBudgetAttemptHash(request.webhookEventId ?? request.requestId)}`,
        sourceRoute: 'line-intake-route', modelId: modelPolicy?.modelId ?? '', requestId: request.requestId,
        ...classifyAiUsageRequest('line-intake-route', media ? 'image' : 'text'),
      },
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
    hold?: ReservedAiBudgetStep,
  ): Promise<GovernedLineIntakeRoutePlan> {
    if (!mediaId) {
      return this.postInternal<LineIntakeRoutePlan>(
        '/internal/ai/line-intake-route', request, request.requestId, LINE_INTAKE_TIMEOUT_MS, budgetMonthKey, 'text', hold,
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
      // Held money first, count second (ADR 0013 §5): this refusal proves no provider call started.
      await this.releaseHold(hold, 'ocr_admission_refused');
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
        '/internal/ai/line-intake-route', request, request.requestId, LINE_INTAKE_MEDIA_TIMEOUT_MS, budgetMonthKey, 'image', hold,
      );
      if (plan.status === 'UNAVAILABLE') {
        if (plan.errorCode === 'PROVIDER_DISABLED' || plan.errorCode === 'PROVIDER_CONFIG_MISSING') {
          // The two statuses that prove the router never reached its provider.
          await this.releaseHold(hold, 'gateway_pre_provider_refusal');
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
        await this.releaseHold(hold, 'gateway_pre_provider_refusal');
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

  /** The one place this client may release money, and only with a proof that no provider ran. */
  private async releaseHold(hold: ReservedAiBudgetStep | undefined, proof: AiBudgetCancelProof): Promise<void> {
    if (hold) await cancelAiBudgetStep(this.prisma, { reservationId: hold.id, ownerToken: hold.ownerToken, proof });
  }

  private async runBudgeted<T>(
    companyId: string | undefined,
    action: (monthKey?: string, hold?: ReservedAiBudgetStep) => Promise<T>,
    busyWaitDeadlineMs?: number,
    laneKey?: 'chat' | 'media',
    step?: CompanyAiBudgetStep,
  ): Promise<T> {
    if (!companyId) return action();
    const admission = await retryBusyAdmission(
      () => runWithCompanyAiBudgetAdmission(this.prisma, this.config, this.rateLimits, companyId, action, laneKey, step),
      busyWaitDeadlineMs,
    );
    if (admission.allowed) return admission.value;
    // The body carries the code AND the scope so callers never have to re-derive either from an
    // error string (spec §9.1). `companyAiBudgetRefusal` is the single source for both.
    throw new HttpException(companyAiBudgetRefusal(admission), HttpStatus.TOO_MANY_REQUESTS);
  }

  private async postInternal<T>(
    path: string,
    request: unknown,
    requestId: string,
    timeoutMs: number,
    budgetMonthKey?: string,
    /** What this caller put in the request, for the server-derived bucket/kind (spec §12.2). */
    content: AiRequestContent = 'text',
    /** SPLIT only: the hold this call runs inside. Its envelope rides on the wire (ADR 0013 §6);
     *  the owner token never does. An older gateway ignores the unknown field. */
    hold?: ReservedAiBudgetStep,
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
        body: JSON.stringify(hold ? { ...(request as Record<string, unknown>), budgetEnvelope: hold.envelope } : request),
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
      hold?.invocationKey,
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
    invocationKey?: string,
  ): Promise<void> {
    if (!companyId) return;
    try {
      await recordCompanyAiUsage(
        this.prisma,
        this.config,
        { companyId, sourceRoute, requestId, monthKey, ...(invocationKey && { invocationKey }), ...classifyAiUsageRequest(sourceRoute, content) },
        usage,
      );
    } catch (err) {
      this.logger.warn({ msg: 'ai.usage.record_failed', sourceRoute, requestId, ...safeLineErrorDetails(err) });
    }
  }
}
