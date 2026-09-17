import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CRM_AI_CUSTOMER_RISKS,
  CRM_AI_MAX_WINDOW,
  CRM_AI_SENTIMENTS,
  isAiBudgetPermanentRefusal,
  type CrmAiCustomerRisk,
  type CrmAiSentiment,
  type CrmAiWindowMessage,
  type CrmConversationSummaryResult,
  type CrmCustomerProfileExtractResult,
  type CrmInsightsResult,
  type CrmReplyDraftResult,
  type CrmTrustFactor,
  type CrmTrustReadResult,
  type ProviderError,
  type RequestContext,
} from '@watchdog-bms/contracts';
import { assertConversationInScope, conversationReadActorScope } from '../crm-inbox-access';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { CrmAiContextRepository, type CrmAiWindowMessageRow } from '../../infrastructure/crm-ai-context.repository';
import { CrmAiGatewayClient } from '../../infrastructure/crm-ai-gateway.client';
import { knownAiBudgetRefusal } from '../../../line-ai/domain/logic/line-ai-terminal-outcome.logic';
import type { CrmConversationRecord } from '../../domain/models/crm-inbox.model';
import { trustTierOf } from '../../domain/logic/crm-ai-trust.logic';

type AssistContext = {
  requestId: string;
  conversation: CrmConversationRecord;
  window: CrmAiWindowMessage[];
};

type FeedbackInput = {
  kind?: string;
  rating?: string;
  comment?: string;
  requestId?: string;
};

const SENTIMENTS = new Set(CRM_AI_SENTIMENTS);
const RISKS = new Set(CRM_AI_CUSTOMER_RISKS);
const FEEDBACK_KINDS = new Set(['SUMMARY', 'REPLY_DRAFT', 'INSIGHTS']);
const FEEDBACK_RATINGS = new Set(['UP', 'DOWN']);

function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

function unavailable(requestId: string): { requestId: string; status: 'unavailable'; error: ProviderError } {
  return {
    requestId,
    status: 'unavailable',
    error: { code: 'PROVIDER_UNKNOWN', message: 'gateway_unreachable', retryable: true },
  };
}

async function callOrUnavailable<T>(
  requestId: string,
  logger: Logger,
  fn: () => Promise<T>,
): Promise<T | { requestId: string; status: 'unavailable'; error: ProviderError }> {
  try {
    return await fn();
  } catch (err) {
    // §9.4: the company's monthly AI MONEY is one of the things that lands here, and it is NOT a
    // transient outage — offering "ลองใหม่ได้อีกครั้ง" for it invites the operator to keep pressing a
    // button that cannot work this month. It keeps its own code and is never marked retryable.
    const budget = knownAiBudgetRefusal(err);
    logger.warn({ msg: 'crm-ai assist degraded to unavailable', requestId,
      ...(budget ? { budgetErrorCode: budget.code } : {}), error: (err as Error).message });
    if (budget && isAiBudgetPermanentRefusal(budget.code)) {
      return {
        requestId,
        status: 'unavailable',
        error: { code: 'PROVIDER_BUDGET_EXHAUSTED', message: budget.code, retryable: false,
          ...(budget.budgetScope ? { budgetScope: budget.budgetScope } : {}) },
      };
    }
    return unavailable(requestId);
  }
}

function clampLeadScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function trimLimited(value: unknown, max: number, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${label}_invalid`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new BadRequestException(`${label}_too_long`);
  return trimmed;
}

function codePointCap(value: string, max: number): string {
  return [...value].slice(0, max).join('');
}

function optionalModelField(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? codePointCap(value.trim(), max) : undefined;
}

function messageRole(message: CrmAiWindowMessageRow): CrmAiWindowMessage['role'] | null {
  if (message.direction === 'INBOUND') return 'CUSTOMER';
  if (message.deliveryStatus !== 'SENT' || message.authorType === 'SYSTEM') return null;
  return message.authorType === 'AI' ? 'AI' : 'STAFF';
}

export function toCrmAiWindow(messagesDesc: CrmAiWindowMessageRow[]): CrmAiWindowMessage[] {
  return messagesDesc
    .filter((m) => typeof m.contentText === 'string' && m.contentText.trim().length > 0)
    .filter((m) => messageRole(m) !== null)
    .slice(0, CRM_AI_MAX_WINDOW)
    .reverse()
    .map((m) => ({ role: messageRole(m)!, text: codePointCap(m.contentText!.trim(), 1000), at: m.createdAt.toISOString() }));
}

function trustFactorsOf(value: unknown): CrmTrustFactor[] | null {
  if (!Array.isArray(value)) return null;
  const factors = value.filter(
    (factor): factor is CrmTrustFactor =>
      typeof factor === 'object' &&
      factor !== null &&
      typeof (factor as { key?: unknown }).key === 'string' &&
      typeof (factor as { points?: unknown }).points === 'number',
  );
  return factors.length === value.length ? factors : null;
}

async function loadScopedConversation(
  ctx: RequestContext,
  conversationId: string,
  repo: PrismaCrmInboxRepository,
): Promise<CrmConversationRecord> {
  requirePermission(ctx, 'crm.ai.assist');
  const conversation = await repo.findConversationById(ctx.companyId, conversationId);
  if (!conversation) throw new NotFoundException('Conversation not found');
  assertConversationInScope(ctx, conversation);
  return conversation;
}

async function assembleAssistContext(
  ctx: RequestContext,
  conversationId: string,
  repo: PrismaCrmInboxRepository,
  context: CrmAiContextRepository,
): Promise<AssistContext> {
  const conversation = await loadScopedConversation(ctx, conversationId, repo);
  const window = toCrmAiWindow(await context.listRecentWindowMessages(ctx.companyId, conversation.id));
  if (window.length === 0) throw new UnprocessableEntityException('CONVERSATION_HAS_NO_TEXT');
  return { requestId: randomUUID(), conversation, window };
}

async function callForLiveAssist<T>(
  ctx: RequestContext,
  assist: AssistContext,
  repo: PrismaCrmInboxRepository,
  callback: () => Promise<T>,
): Promise<T> {
  let result: T | null;
  try {
    result = await repo.withLiveCustomerDataLock({
      companyId: ctx.companyId,
      customerId: assist.conversation.customerId,
      conversationId: assist.conversation.id,
      actorScope: conversationReadActorScope(ctx, assist.conversation),
    }, callback);
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === 'conversation_assignment_changed' || code === 'conversation_out_of_scope') {
      throw new ForbiddenException('Conversation is out of scope');
    }
    throw error;
  }
  if (result === null) throw new UnprocessableEntityException({ code: 'customer_not_active' });
  return result;
}

@Injectable()
export class CrmAiSummaryUseCase {
  private readonly logger = new Logger(CrmAiSummaryUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly context: CrmAiContextRepository,
    private readonly gateway: CrmAiGatewayClient,
  ) {}

  async execute(ctx: RequestContext, conversationId: string): Promise<CrmConversationSummaryResult> {
    const assist = await assembleAssistContext(ctx, conversationId, this.repo, this.context);
    const result = await callForLiveAssist(ctx, assist, this.repo, () =>
      callOrUnavailable(assist.requestId, this.logger, () =>
        this.gateway.requestCrmSummary({ requestId: assist.requestId, companyId: ctx.companyId, window: assist.window }),
      ),
    );
    if (result.status === 'ok' && typeof result.summaryText === 'string' && result.summaryText.trim()) {
      await this.context.saveConversationSummary(ctx.companyId, assist.conversation.id, result.summaryText, new Date());
    }
    return result;
  }
}

@Injectable()
export class CrmCustomerProfileExtractUseCase {
  private readonly logger = new Logger(CrmCustomerProfileExtractUseCase.name);

  constructor(private readonly gateway: CrmAiGatewayClient) {}

  async execute(
    ctx: RequestContext,
    input: { text?: unknown; locale?: unknown },
  ): Promise<CrmCustomerProfileExtractResult> {
    requirePermission(ctx, 'crm.customer.create');
    requirePermission(ctx, 'crm.ai.assist');
    const text = trimLimited(input?.text, 2_000, 'text');
    if (!text || [...text].length < 2) throw new BadRequestException('text_required');
    const locale = trimLimited(input?.locale, 20, 'locale');
    const requestId = randomUUID();
    const result = await callOrUnavailable(requestId, this.logger, () =>
      this.gateway.requestCustomerProfileExtract({ requestId, companyId: ctx.companyId, text, ...(locale ? { locale } : {}) }),
    );
    if (result.status !== 'ok') return result;

    // ERP Core re-validates model output even though the gateway already bounds it.
    const suggested = {
      displayName: optionalModelField(result.suggested?.displayName, 160),
      primaryPhone: optionalModelField(result.suggested?.primaryPhone, 40),
      primaryEmail: optionalModelField(result.suggested?.primaryEmail, 254),
      notes: optionalModelField(result.suggested?.notes, 500),
    };
    if (!suggested.displayName && !suggested.primaryPhone && !suggested.primaryEmail) {
      return { requestId, status: 'uncertain' };
    }
    return {
      requestId,
      status: 'ok',
      suggested,
      confidence: Number.isFinite(result.confidence) ? Math.max(0, Math.min(1, result.confidence)) : 0,
    };
  }
}

@Injectable()
export class CrmAiReplyDraftUseCase {
  private readonly logger = new Logger(CrmAiReplyDraftUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly context: CrmAiContextRepository,
    private readonly gateway: CrmAiGatewayClient,
  ) {}

  async execute(ctx: RequestContext, conversationId: string, input: { tone?: string } = {}): Promise<CrmReplyDraftResult> {
    const tone = trimLimited(input?.tone, 100, 'tone');
    const assist = await assembleAssistContext(ctx, conversationId, this.repo, this.context);
    const [company, channel, templates, catalog] = await Promise.all([
      this.context.findCompany(ctx.companyId),
      this.repo.findChannelById(ctx.companyId, assist.conversation.channelId),
      this.context.listActiveTemplateExamples(ctx.companyId),
      this.context.listCustomerVisibleCatalog(ctx.companyId),
    ]);
    if (!company) throw new NotFoundException('Company not found');
    if (!channel) throw new NotFoundException('Channel not found');

    return callForLiveAssist(ctx, assist, this.repo, () =>
      callOrUnavailable(assist.requestId, this.logger, () =>
        this.gateway.requestCrmReplyDraft({
          requestId: assist.requestId,
          companyId: ctx.companyId,
          mode: 'STAFF_ASSIST',
          window: assist.window,
          brand: { brandName: company.brandName ?? company.name, channelDisplayName: channel.displayName },
          templates: templates.map((t) => ({ title: t.title, body: t.bodyText })),
          catalog,
          ...(tone ? { tone } : {}),
        }),
      ),
    );
  }
}

@Injectable()
export class CrmAiInsightsUseCase {
  private readonly logger = new Logger(CrmAiInsightsUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly context: CrmAiContextRepository,
    private readonly gateway: CrmAiGatewayClient,
  ) {}

  async execute(ctx: RequestContext, conversationId: string): Promise<CrmInsightsResult> {
    const assist = await assembleAssistContext(ctx, conversationId, this.repo, this.context);
    const consent = await this.context.findCustomerConsent(ctx.companyId, assist.conversation.customerId);
    if (!consent) throw new NotFoundException('Customer not found');

    const result = await callForLiveAssist(ctx, assist, this.repo, () =>
      callOrUnavailable(assist.requestId, this.logger, () =>
        this.gateway.requestCrmInsights({ requestId: assist.requestId, companyId: ctx.companyId, window: assist.window, consent }),
      ),
    );
    if (result.status === 'ok' && SENTIMENTS.has(result.sentiment) && RISKS.has(result.risk)) {
      if (consent === 'REVOKED') {
        this.logger.log({ msg: 'crm-ai advisory persist skipped for revoked consent', requestId: assist.requestId });
      } else {
        await this.context.updateCustomerAdvisory(ctx.companyId, assist.conversation.customerId, {
          leadScore: clampLeadScore(result.leadScore),
          sentiment: result.sentiment as CrmAiSentiment,
          riskLevel: result.risk as CrmAiCustomerRisk,
        });
      }
    }
    return result;
  }
}

@Injectable()
export class CrmAiTrustReadUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly context: CrmAiContextRepository,
  ) {}

  async execute(ctx: RequestContext, conversationId: string): Promise<CrmTrustReadResult> {
    const conversation = await loadScopedConversation(ctx, conversationId, this.repo);
    const row = await this.context.findCustomerTrustRead(ctx.companyId, conversation.customerId);
    if (!row) throw new NotFoundException('Customer not found');
    return {
      trustScore: row.trustScore,
      tier: trustTierOf(row.trustScore),
      factors: trustFactorsOf(row.trustScoreFactorsJson),
      computedAt: row.trustScoreComputedAt?.toISOString() ?? null,
    };
  }
}

@Injectable()
export class CrmAiFeedbackUseCase {
  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly context: CrmAiContextRepository,
  ) {}

  async execute(ctx: RequestContext, conversationId: string, input: FeedbackInput): Promise<{ id: string; createdAt: Date }> {
    const conversation = await loadScopedConversation(ctx, conversationId, this.repo);
    if (!FEEDBACK_KINDS.has(input?.kind ?? '')) throw new BadRequestException('kind_invalid');
    if (!FEEDBACK_RATINGS.has(input?.rating ?? '')) throw new BadRequestException('rating_invalid');
    const comment = trimLimited(input?.comment, 1000, 'comment');
    const requestId = trimLimited(input?.requestId, 100, 'requestId');
    if (!requestId) throw new BadRequestException('feedback_request_id_required');
    const key = {
      conversationId: conversation.id,
      kind: input.kind as 'SUMMARY' | 'REPLY_DRAFT' | 'INSIGHTS',
      requestId,
      createdByUserId: ctx.userId,
    };
    try {
      return await this.context.saveLiveAssistFeedback({
        companyId: ctx.companyId,
        ...key,
        rating: input.rating as 'UP' | 'DOWN',
        comment,
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      if (code === 'conversation_not_found') throw new NotFoundException('Conversation not found');
      if (code === 'customer_not_active') throw new UnprocessableEntityException({ code });
      if (code === 'conversation_customer_changed') throw new UnprocessableEntityException({ code });
      throw err;
    }
  }
}
