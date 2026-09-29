import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS,
  EXPENSE_CAPTURE_CONTRACT_VERSION,
  type AiBudgetScope,
  type AiModelLineage,
  type AiModelPolicy,
  type ExpenseCaptureExtractRequest,
  type ExpenseCaptureExtractResponse,
  type ExpenseCaptureObservations,
  type ExpenseCaptureReadChunk,
  type ExpenseCaptureReadPage,
  type ExpenseCaptureReadRequest,
  type ExpenseCaptureReadResponse,
} from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { cancelAiBudgetStepIfGatewayUnspent, type ReservedAiBudgetStep } from '../../line-ai/application/company-ai-budget-reservation';
import { classifyAiUsageRequest, companyAiBudgetRefusal, recordCompanyAiUsage, runWithCompanyAiBudgetAdmission } from '../../line-ai/application/company-ai-usage-meter';
import { resolveCompanyAiModelPolicy } from '../../line-ai/application/company-ai-model-policy';
import { safeLineErrorDetails } from '../../line-ai/infrastructure/line-reply.adapter';

/** One capture call is ONE provider call, so the single-receipt chain's ceiling covers it. */
const CAPTURE_TIMEOUT_MS = AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS;

/** The usage-meter route both capture stages bill under; `OCR_SOURCE_ROUTES` buckets it as OCR. */
export const CAPTURE_USAGE_SOURCE_ROUTE = 'receipt-capture';

export type CaptureGatewayFailure = {
  status: 'failed' | 'not_configured';
  errorCode: string;
  budgetScope?: AiBudgetScope;
};

export type CaptureReadResult =
  | { status: 'ok'; pages: ExpenseCaptureReadPage[]; modelLineage?: AiModelLineage }
  | CaptureGatewayFailure;

export type CaptureExtractResult =
  | { status: 'ok'; observations: ExpenseCaptureObservations; modelLineage?: AiModelLineage }
  | CaptureGatewayFailure;

/**
 * The API half of the capture contract (appendix §4.3/§4.6).
 *
 * Copies the `ReceiptOcrClient` money pattern exactly, with ONE difference that matters: a capture
 * read is many provider calls for one customer document, so the MONEY is admitted per call
 * (`attemptKey = capture:<jobId>:<chunkId|windowId>`) while the customer's OCR READ COUNT is
 * admitted once per job by the runner. Neither seam may guess the other's answer.
 */
@Injectable()
export class ExpenseCaptureReadClient {
  private readonly logger = new Logger(ExpenseCaptureReadClient.name);

  constructor(
    private readonly config: AppConfigService,
    @Inject(RedisRateLimitService) private readonly rateLimits: RedisRateLimitService | undefined,
    private readonly prisma: PrismaService,
  ) {}

  /** Stage 1: transcribe one bounded chunk. */
  readChunk(input: {
    companyId: string;
    userId: string;
    requestId: string;
    jobId: string;
    fileLabel: string;
    chunk: ExpenseCaptureReadChunk;
  }): Promise<CaptureReadResult> {
    return this.call<CaptureReadResult, ExpenseCaptureReadResponse>({
      companyId: input.companyId,
      requestId: input.requestId,
      stepKind: 'receipt-capture-read',
      attemptKey: `capture:${input.jobId}:${input.chunk.id}`,
      content: input.chunk.kind === 'pdf' ? 'document' : 'image',
      path: '/internal/ai/capture-read',
      body: (modelPolicy, hold): ExpenseCaptureReadRequest => ({
        requestId: input.requestId,
        companyId: input.companyId,
        userId: input.userId,
        contractVersion: EXPENSE_CAPTURE_CONTRACT_VERSION,
        chunk: { ...input.chunk, fileLabel: input.fileLabel },
        ...(modelPolicy ? { modelPolicy } : {}),
        ...(hold ? { budgetEnvelope: hold.envelope } : {}),
      }),
      onOk: (response) => response.status === 'ok' && Array.isArray(response.pages)
        ? { status: 'ok', pages: response.pages, ...(response.modelLineage ? { modelLineage: response.modelLineage } : {}) }
        : null,
    });
  }

  /** Stage 2: one window of already-read text becomes observations. */
  extractWindow(input: {
    companyId: string;
    userId: string;
    requestId: string;
    jobId: string;
    windowId: string;
    window: ExpenseCaptureExtractRequest['window'];
    activeCategories?: Array<{ id: string; name: string }>;
  }): Promise<CaptureExtractResult> {
    return this.call<CaptureExtractResult, ExpenseCaptureExtractResponse>({
      companyId: input.companyId,
      requestId: input.requestId,
      stepKind: 'receipt-capture-extract',
      attemptKey: `capture:${input.jobId}:${input.windowId}`,
      content: 'text',
      path: '/internal/ai/capture-extract',
      body: (modelPolicy, hold): ExpenseCaptureExtractRequest => ({
        requestId: input.requestId,
        companyId: input.companyId,
        userId: input.userId,
        contractVersion: EXPENSE_CAPTURE_CONTRACT_VERSION,
        window: input.window,
        ...(input.activeCategories ? { activeCategories: input.activeCategories } : {}),
        ...(modelPolicy ? { modelPolicy } : {}),
        ...(hold ? { budgetEnvelope: hold.envelope } : {}),
      }),
      onOk: (response) => {
        if (response.status !== 'ok' || !response.observations) return null;
        return { status: 'ok', observations: response.observations, ...(response.modelLineage ? { modelLineage: response.modelLineage } : {}) };
      },
    });
  }

  /** The shared rate limit / policy / admission / post / settle path of `receipt-ocr.client.ts`. */
  private async call<TResult extends { status: string }, TResponse extends { status: string; errorCode?: string; budgetScope?: AiBudgetScope; usage?: unknown }>(
    input: {
      companyId: string;
      requestId: string;
      stepKind: 'receipt-capture-read' | 'receipt-capture-extract';
      attemptKey: string;
      content: 'text' | 'image' | 'document';
      path: string;
      body: (modelPolicy: AiModelPolicy | undefined, hold: ReservedAiBudgetStep | undefined) => unknown;
      onOk: (response: TResponse) => TResult | null;
    },
  ): Promise<TResult | CaptureGatewayFailure> {
    if (this.rateLimits) {
      // The same `ai-ocr-company` bucket as every other document read: a capture job must not be
      // able to out-shout the upload screen on a shop that is doing both.
      const decision = await this.rateLimits.consume(
        'ai-ocr-company', input.companyId, this.config.aiOcrMaxPerCompany, this.config.aiRateLimitWindowSeconds,
      );
      if (!decision.allowed) return { status: 'failed', errorCode: 'AI_OCR_RATE_LIMITED' };
    }
    if (!this.config.aiGatewayInternalSecret) {
      return { status: 'not_configured', errorCode: 'AI_GATEWAY_SECRET_MISSING' };
    }
    const modelPolicy = await resolveCompanyAiModelPolicy(this.prisma, input.companyId, this.config.approvedAiModelIds);
    const admission = await runWithCompanyAiBudgetAdmission(
      this.prisma,
      this.config,
      this.rateLimits,
      input.companyId,
      (monthKey, hold) => this.post<TResult, TResponse>(input, modelPolicy, monthKey, hold),
      'media',
      {
        stepKind: input.stepKind,
        attemptKey: input.attemptKey,
        sourceRoute: CAPTURE_USAGE_SOURCE_ROUTE,
        modelId: modelPolicy?.modelId ?? '',
        requestId: input.requestId,
        ...classifyAiUsageRequest(CAPTURE_USAGE_SOURCE_ROUTE, input.content),
      },
    );
    if (admission.allowed) return admission.value;
    // Refused before any provider ran: the job PAUSEs with the seam's own code, which is what
    // makes the reviewer read "เครดิตสำหรับการอ่านเอกสารไม่พอ" instead of "อ่านไม่สำเร็จ".
    const refusal = companyAiBudgetRefusal(admission);
    return { status: 'failed', errorCode: refusal.code, ...(refusal.budgetScope ? { budgetScope: refusal.budgetScope } : {}) };
  }

  private async post<TResult extends { status: string }, TResponse extends { status: string; errorCode?: string; budgetScope?: AiBudgetScope; usage?: unknown }>(
    input: {
      companyId: string;
      requestId: string;
      path: string;
      body: (modelPolicy: AiModelPolicy | undefined, hold: ReservedAiBudgetStep | undefined) => unknown;
      onOk: (response: TResponse) => TResult | null;
      content: 'text' | 'image' | 'document';
    },
    modelPolicy: AiModelPolicy | undefined,
    monthKey?: string,
    hold?: ReservedAiBudgetStep,
  ): Promise<TResult | CaptureGatewayFailure> {
    let response: Response;
    try {
      response = await fetch(`${this.config.aiGatewayInternalUrl}${input.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': this.config.aiGatewayInternalSecret! },
        body: JSON.stringify(input.body(modelPolicy, hold)),
        signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error({ msg: 'capture gateway unreachable', requestId: input.requestId, ...safeLineErrorDetails(error) });
      return { status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE' };
    }
    if (!response.ok) {
      this.logger.error({ msg: 'capture gateway error', status: response.status, requestId: input.requestId });
      return { status: 'failed', errorCode: `AI_GATEWAY_ERROR_${response.status}` };
    }
    let result: TResponse;
    try {
      result = (await response.json()) as TResponse;
    } catch (error) {
      this.logger.warn({ msg: 'capture gateway response invalid', requestId: input.requestId, ...safeLineErrorDetails(error) });
      return { status: 'failed', errorCode: 'OCR_JSON_PARSE_FAILED' };
    }
    // A refusal by the gateway's own money guard carries our code and no usage row, so this hold
    // provably paid for nothing and is released — exactly as the single-receipt seam does.
    await cancelAiBudgetStepIfGatewayUnspent(this.prisma, hold, {
      budgetCode: result.errorCode, usage: result.usage as never,
    });
    try {
      await recordCompanyAiUsage(
        this.prisma,
        this.config,
        {
          companyId: input.companyId, sourceRoute: CAPTURE_USAGE_SOURCE_ROUTE, requestId: input.requestId, monthKey,
          ...(hold && { invocationKey: hold.invocationKey }),
          ...classifyAiUsageRequest(CAPTURE_USAGE_SOURCE_ROUTE, input.content),
        },
        result.usage as never,
      );
    } catch (error) {
      this.logger.warn({ msg: 'ai.usage.record_failed', requestId: input.requestId, ...safeLineErrorDetails(error) });
    }
    const ok = result.status === 'ok' ? input.onOk(result) : null;
    if (ok) return ok;
    return {
      status: result.status === 'not_configured' ? 'not_configured' : 'failed',
      errorCode: result.errorCode ?? 'OCR_UNUSABLE_RESULT',
      ...(result.budgetScope ? { budgetScope: result.budgetScope } : {}),
    };
  }
}
