/**
 * Internal AI Gateway endpoints for the CRM customer-facing AI family (spec §25).
 * Protected by X-Internal-Secret; called only by the ERP Core API. The gateway runs the
 * model on the bounded context the API supplies — it never reads the database and holds
 * zero ERP tools. Boundary (hard): this controller is registered in the gateway app module
 * and is NEVER imported by LineAiModule (or vice versa); routes are namespaced `crm-*`.
 */
import { Controller, Post, Body, Headers, BadRequestException, HttpCode, Logger, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiUsageInterceptor } from '../../common/usage/ai-usage.interceptor';
import { Public } from '../../common/security/public.decorator';
import { assertInternalSecret } from '../../common/security/internal-secret';
import { AiGatewayConfigService } from '../../common/config/ai-gateway-config.service';
import { createProvider } from '../line-ai/infrastructure/provider/provider.factory';
import { CrmBookingExtractUseCase } from './use-cases/crm-booking-extract.use-case';
import { CrmIntakeUseCase } from './use-cases/crm-intake.use-case';
import { CrmReplyDraftUseCase } from './use-cases/crm-reply-draft.use-case';
import { CrmTrustScoreUseCase } from './use-cases/crm-trust-score.use-case';
import { CrmSummaryUseCase } from './use-cases/crm-summary.use-case';
import { CrmInsightsUseCase } from './use-cases/crm-insights.use-case';
import { CrmBroadcastUseCase } from './use-cases/crm-broadcast.use-case';
import { CrmCustomerProfileExtractUseCase } from './use-cases/crm-customer-profile-extract.use-case';
import type {
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
  CrmTrustScoreRequest,
  CrmTrustScoreResult,
} from '@watchdog-bms/contracts';

@ApiTags('internal')
@Controller('internal/ai')
@UseInterceptors(AiUsageInterceptor)
export class CrmCustomerAiInternalController {
  private readonly logger = new Logger(CrmCustomerAiInternalController.name);

  constructor(
    private readonly config: AiGatewayConfigService,
    private readonly bookingExtract: CrmBookingExtractUseCase,
    private readonly intake: CrmIntakeUseCase,
    private readonly replyDraft: CrmReplyDraftUseCase,
    private readonly trustScore: CrmTrustScoreUseCase,
    private readonly summary: CrmSummaryUseCase,
    private readonly insights: CrmInsightsUseCase,
    private readonly broadcast: CrmBroadcastUseCase,
    private readonly customerProfileExtract: CrmCustomerProfileExtractUseCase,
  ) {}

  @Public()
  @Post('crm-booking-extract')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: extract a CRM booking slot (API service only)' })
  async crmBookingExtract(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: CrmBookingExtractRequest,
  ): Promise<CrmBookingExtractResult> {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    if (
      !isRequestId(body?.requestId) ||
      !isMessageWindow(body?.window) ||
      typeof body?.consent !== 'string' ||
      !isYyyyMmDd(body?.todayBangkok) ||
      !isCatalogList(body?.catalog)
    ) {
      throw new BadRequestException('Invalid booking-extract payload.');
    }
    this.logger.log({ msg: 'CRM booking extract received', requestId: body.requestId });
    return this.bookingExtract.execute(createProvider(this.config, { modelId: body.modelPolicy?.modelId }), body);
  }

  @Public()
  @Post('crm-intake')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: classify a CRM customer turn (API service only)' })
  async crmIntake(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: CrmCustomerIntakeRequest,
  ): Promise<CrmCustomerIntakeResult> {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    if (!isRequestId(body?.requestId) || !isMessageWindow(body?.window)) {
      throw new BadRequestException('Invalid intake payload.');
    }
    this.logger.log({ msg: 'CRM intake received', requestId: body.requestId });
    return this.intake.execute(createProvider(this.config, { modelId: body.modelPolicy?.modelId }), body);
  }

  @Public()
  @Post('crm-customer-profile-extract')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: extract an editable CRM customer profile suggestion (API service only)' })
  async crmCustomerProfileExtract(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: CrmCustomerProfileExtractRequest,
  ): Promise<CrmCustomerProfileExtractResult> {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    if (
      !isRequestId(body?.requestId) ||
      typeof body?.text !== 'string' ||
      body.text.trim().length < 2 ||
      body.text.length > 2_000 ||
      !(body.locale === undefined || (typeof body.locale === 'string' && body.locale.length <= 20))
    ) {
      throw new BadRequestException('Invalid customer-profile-extract payload.');
    }
    this.logger.log({ msg: 'CRM customer profile extract received', requestId: body.requestId });
    return this.customerProfileExtract.execute(createProvider(this.config, { modelId: body.modelPolicy?.modelId }), {
      ...body,
      text: body.text.trim(),
    });
  }

  @Public()
  @Post('crm-reply-draft')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: compose a CRM reply draft (API service only)' })
  async crmReplyDraft(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: CrmReplyDraftRequest,
  ): Promise<CrmReplyDraftResult> {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    if (
      !isRequestId(body?.requestId) ||
      !isMessageWindow(body?.window) ||
      !body?.brand ||
      !isTemplateList(body?.templates) ||
      !isCatalogList(body?.catalog) ||
      !(body?.mode === 'STAFF_ASSIST' || body?.mode === 'AUTONOMOUS') ||
      !(body?.tone === undefined || (typeof body.tone === 'string' && body.tone.length <= 100))
    ) {
      throw new BadRequestException('Invalid reply-draft payload.');
    }
    this.logger.log({ msg: 'CRM reply draft received', requestId: body.requestId, mode: body.mode });
    return this.replyDraft.execute(createProvider(this.config, { modelId: body.modelPolicy?.modelId }), body);
  }

  @Public()
  @Post('crm-trust-score')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: score CRM customer trust from deterministic signals (API service only)' })
  // Dormant: narrative-only wiring comes with 8C (§27); the deterministic score never comes from here.
  async crmTrustScore(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: CrmTrustScoreRequest,
  ): Promise<CrmTrustScoreResult> {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    if (!isRequestId(body?.requestId) || !body?.signals || typeof body.signals !== 'object') {
      throw new BadRequestException('Invalid trust-score payload.');
    }
    this.logger.log({ msg: 'CRM trust score received', requestId: body.requestId });
    return this.trustScore.execute(createProvider(this.config, { modelId: body.modelPolicy?.modelId }), body);
  }

  @Public()
  @Post('crm-summary')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: summarize a CRM conversation for staff (API service only)' })
  async crmSummary(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: CrmConversationSummaryRequest,
  ): Promise<CrmConversationSummaryResult> {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    if (!isRequestId(body?.requestId) || !isMessageWindow(body?.window)) {
      throw new BadRequestException('Invalid summary payload.');
    }
    this.logger.log({ msg: 'CRM summary received', requestId: body.requestId });
    return this.summary.execute(createProvider(this.config, { modelId: body.modelPolicy?.modelId }), body);
  }

  @Public()
  @Post('crm-insights')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: extract CRM conversation insights for staff (API service only)' })
  async crmInsights(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: CrmInsightsRequest,
  ): Promise<CrmInsightsResult> {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    if (!isRequestId(body?.requestId) || !isMessageWindow(body?.window) || typeof body?.consent !== 'string') {
      throw new BadRequestException('Invalid insights payload.');
    }
    this.logger.log({ msg: 'CRM insights received', requestId: body.requestId });
    return this.insights.execute(createProvider(this.config, { modelId: body.modelPolicy?.modelId }), body);
  }

  @Public()
  @Post('crm-broadcast')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: draft LINE broadcast copy candidates (API service only)' })
  async crmBroadcast(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: CrmBroadcastGenerateRequest,
  ): Promise<CrmBroadcastGenerateResult> {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    if (!isRequestId(body?.requestId) || typeof body?.topic !== 'string' || typeof body?.tone !== 'string') {
      throw new BadRequestException('Invalid broadcast payload.');
    }
    this.logger.log({ msg: 'CRM broadcast received', requestId: body.requestId });
    return this.broadcast.execute(createProvider(this.config, { modelId: body.modelPolicy?.modelId }), body);
  }
}

// Trust-boundary validation: reject malformed payloads with a clean 400 rather than letting a
// null/non-object array element crash the agent into a 500. The API is trusted but not infallible.
function isRequestId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isMessageWindow(w: unknown): boolean {
  return (
    Array.isArray(w) &&
    w.every(
      (m) =>
        m !== null &&
        typeof m === 'object' &&
        typeof (m as Record<string, unknown>).role === 'string' &&
        typeof (m as Record<string, unknown>).text === 'string',
    )
  );
}

function isTemplateList(t: unknown): boolean {
  return (
    Array.isArray(t) &&
    t.every(
      (x) =>
        x !== null &&
        typeof x === 'object' &&
        typeof (x as Record<string, unknown>).title === 'string' &&
        typeof (x as Record<string, unknown>).body === 'string',
    )
  );
}

function isCatalogList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        typeof (item as Record<string, unknown>).kind === 'string' &&
        typeof (item as Record<string, unknown>).unit === 'string',
    )
  );
}

function isYyyyMmDd(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
