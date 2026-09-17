/**
 * Internal-only money seam for the AI Gateway (ADR 0013 §4/§6/§7).
 *
 * Two endpoints, the `internal-tools.controller.ts` pattern exactly: `@Public()` plus the shared
 * `X-Internal-Secret`, no tenant/user authentication and no bypass beyond what the existing
 * internal routes already have. The Gateway still has NO database access — it asks for the next
 * invocation of an attempt the API already owns, and it posts that invocation's evidence back.
 *
 * Nothing but ids, counters and typed codes is logged or returned: no prompt text, no cap, no
 * balance, no owner token (the fencing token never leaves the API).
 *
 * Until Phase E1c the gateway calls neither route — SPLIT cannot be activated — but the seam is
 * registered and boot-tested here so E1c is a gateway-only change.
 */
import { Body, Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AI_BUDGET_REFUSAL_CODES, aiBudgetStepBounds, type AiBudgetScope } from '@watchdog-bms/contracts';
import { Public } from '../../../../common/security/public.decorator';
import { assertInternalSecret } from '../../../../common/security/secret-compare';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PrismaService } from '../../../../common/database/prisma.service';
import {
  markAiBudgetStepDispatched,
  reserveAiBudgetStep,
  settleAiBudgetStep,
} from '../../application/company-ai-budget-reservation';

/** `YYYY-MM`, Asia/Bangkok — the pinned month of the parent attempt, never the gateway's clock. */
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

class AiBudgetStepDto {
  @IsString() @IsNotEmpty() @MaxLength(64) companyId!: string;
  @IsString() @IsNotEmpty() @MaxLength(256) attemptKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) stepKind!: string;
  /** The API owns ordinal 0; the gateway may only ask for the ones AFTER it. */
  @IsInt() @Min(1) @Max(64) ordinal!: number;
  @IsString() @IsNotEmpty() @MaxLength(7) monthKey!: string;
}

class AiBudgetSettleUsageDto {
  @IsString() @IsNotEmpty() @MaxLength(128) modelId!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) tag!: string;
  @IsBoolean() ok!: boolean;
  @IsInt() @Min(0) inputTokens!: number;
  @IsInt() @Min(0) outputTokens!: number;
  @IsInt() @Min(0) cacheReadInputTokens!: number;
  @IsInt() @Min(0) cacheWriteInputTokens!: number;
  /** 'PROVIDER_REPORTED' | 'CONSERVATIVE_ESTIMATE'; anything else is stored as unknown. */
  @IsString() @IsOptional() @MaxLength(32) usageBasis?: string;
}

class AiBudgetSettleDto {
  @IsString() @IsNotEmpty() @MaxLength(512) invocationKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) sourceRoute!: string;
  @IsString() @IsOptional() @MaxLength(128) requestId?: string;
  @ValidateNested() @Type(() => AiBudgetSettleUsageDto) usage!: AiBudgetSettleUsageDto;
}

@ApiTags('internal')
@Controller('internal/ai')
export class InternalAiBudgetController {
  private readonly logger = new Logger(InternalAiBudgetController.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Reserves AND dispatches the next invocation of an attempt the API already admitted (spec
   * §12.3: multi-call routes ask before each further step; there is no implicit allowance).
   *
   * Everything that decides money comes from the PARENT reservation, never from this body: the
   * bucket, the pinned month, the source route, the model and the FX the parent was priced at. The
   * body only names which attempt and which call index.
   */
  @Public()
  @Post('budget-step')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reserve the next provider invocation of an existing attempt' })
  async budgetStep(@Headers('x-internal-secret') secret: string | undefined, @Body() body: AiBudgetStepDto) {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    const bounds = aiBudgetStepBounds(body.stepKind);
    // An undeclared step kind, a bad month key, or a call past the chain's declared ceiling: all
    // three mean "no provable bound for this invocation", which is `unavailable`, never a money
    // answer. Same code and the same `step_call_budget_exhausted` reason the engine itself gives.
    if (!bounds || !MONTH_KEY.test(body.monthKey) || body.ordinal >= bounds.maxCalls) {
      return this.refuse('unavailable', 'TOTAL');
    }

    const parent = await this.prisma.client.aiBudgetReservation.findFirst({
      where: { companyId: body.companyId, monthKey: body.monthKey, attemptKey: body.attemptKey, stepKind: body.stepKind },
      orderBy: { createdAt: 'asc' },
      select: { bucket: true, sourceRoute: true, pricingSnapshot: true },
    });
    if (!parent) return this.refuse('unavailable', 'TOTAL');
    const snapshot = (parent.pricingSnapshot ?? {}) as { modelId?: unknown; thbPerUsd?: unknown; thbPerUsdSource?: unknown };
    const modelId = typeof snapshot.modelId === 'string' ? snapshot.modelId : '';
    const thbPerUsd = Number(snapshot.thbPerUsd);

    const outcome = await reserveAiBudgetStep(this.prisma, this.config, {
      companyId: body.companyId, monthKey: body.monthKey, bucket: parent.bucket as 'CHAT' | 'OCR',
      stepKind: body.stepKind, attemptKey: body.attemptKey, ordinal: body.ordinal,
      sourceRoute: parent.sourceRoute, modelId, thbPerUsd,
      thbPerUsdSource: typeof snapshot.thbPerUsdSource === 'string' ? snapshot.thbPerUsdSource : 'reservation',
    });
    if (!outcome.ok) {
      this.logger.warn({ msg: 'ai.budget.step_refused', companyId: body.companyId, stepKind: body.stepKind,
        ordinal: body.ordinal, reason: outcome.reason });
      // A duplicate ask is never a second execution: the gateway holds, it does not re-run (R-03).
      if (outcome.reason === 'already_claimed') return this.refuse('busy', 'TOTAL');
      return this.refuse(outcome.reason, outcome.budgetScope);
    }
    // The DISPATCHED mark commits before the gateway is told it may call the provider.
    if (!await markAiBudgetStepDispatched(this.prisma, outcome.reservation.id, outcome.reservation.ownerToken)) {
      return this.refuse('unavailable', 'TOTAL');
    }
    return { ok: true, envelope: outcome.reservation.envelope };
  }

  /**
   * Invocation evidence -> ledger, exactly once (ADR 0013 §5). Driven by the gateway rather than by
   * the outer HTTP response, so a parser error after the provider, a partial chain or a lost
   * response cannot turn real provider cost into zero.
   */
  @Public()
  @Post('budget-settle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Settle one provider invocation from its usage evidence' })
  async budgetSettle(@Headers('x-internal-secret') secret: string | undefined, @Body() body: AiBudgetSettleDto) {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    const result = await settleAiBudgetStep(this.prisma, {
      invocationKey: body.invocationKey,
      entry: {
        modelId: body.usage.modelId, tag: body.usage.tag, ok: body.usage.ok,
        inputTokens: body.usage.inputTokens, outputTokens: body.usage.outputTokens,
        cacheReadInputTokens: body.usage.cacheReadInputTokens,
        cacheWriteInputTokens: body.usage.cacheWriteInputTokens,
        ...(body.usage.usageBasis ? { usageBasis: body.usage.usageBasis } : {}),
      } as never,
      meta: { sourceRoute: body.sourceRoute, requestId: body.requestId },
    });
    if (result !== 'settled' && result !== 'duplicate') {
      this.logger.warn({ msg: 'ai.budget.settle_rejected', sourceRoute: body.sourceRoute, result });
    }
    return { result };
  }

  /** The typed vocabulary every seam already understands (spec §9.1) — never a message or a number. */
  private refuse(reason: 'exceeded' | 'insufficient' | 'unavailable' | 'busy', budgetScope: AiBudgetScope) {
    return { ok: false, code: AI_BUDGET_REFUSAL_CODES[reason], budgetScope };
  }
}
