import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  partnerAdjustmentReason,
  type PartnerAiBudgetBucket,
  type PartnerAiCreditHoldActionResultDto,
  type PartnerAiCreditHoldDto,
  type PartnerAiCreditHoldsDto,
  type PartnerAiRequestKind,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { bangkokMonthKey, previousBangkokMonthKey } from '../../../line-ai/application/company-ai-usage-meter';
import {
  acknowledgeAiBudgetBreach,
  chargeAiBudgetHoldAtBound,
  listAiBudgetCreditHolds,
  releaseAiBudgetHoldByOperator,
  sweepAiBudgetCompanyMonth,
  type AiBudgetCreditHoldRow,
  type AiBudgetOperatorDecision,
  type AiBudgetOperatorOutcome,
} from '../../../line-ai/application/company-ai-budget-reservation';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';

/** Every action body: the reason is the only field, and it is mandatory (hold spec §4.2). */
export type PartnerAiCreditHoldCommand = {
  companyId: string;
  reservationId: string;
  reason: string;
  requestingAdminUserId: string;
  requestId: string;
  /** Bangkok month seam: a test passes an explicit instant instead of mocking `Date` globally. */
  now?: Date;
};

const BUCKETS = new Set<PartnerAiBudgetBucket>(['CHAT', 'OCR']);
/** One page of the all-months list (add-on C11). */
export const AI_CREDIT_HOLDS_PAGE_SIZE = 100;

/** `<createdAt ISO>_<id>`: the list is ordered by exactly these two, newest first. */
function decodeCursor(value: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!value) return undefined;
  const cut = value.indexOf('_');
  const createdAt = new Date(value.slice(0, cut));
  if (cut < 1 || Number.isNaN(createdAt.getTime()) || !value.slice(cut + 1)) throw new UnprocessableEntityException('partner_ai_credit_holds_cursor_invalid');
  return { createdAt, id: value.slice(cut + 1) };
}
const REQUEST_KINDS = new Set<PartnerAiRequestKind>(['TEXT', 'IMAGE', 'OTHER']);

function toDto(row: AiBudgetCreditHoldRow): PartnerAiCreditHoldDto {
  return {
    id: row.id,
    // The column CHECK allows five statuses; only these two can reach this list.
    status: row.status === 'UNRESOLVED' ? 'UNRESOLVED' : 'SETTLED',
    kind: row.kind,
    stepKind: row.stepKind,
    // A stored value outside the pair reads as UNKNOWN rather than being asserted through.
    bucket: BUCKETS.has(row.bucket as PartnerAiBudgetBucket) ? (row.bucket as PartnerAiBudgetBucket) : 'UNKNOWN',
    sourceRoute: row.sourceRoute,
    requestKind: REQUEST_KINDS.has(row.requestKind as PartnerAiRequestKind)
      ? (row.requestKind as PartnerAiRequestKind) : 'UNKNOWN',
    upperBoundSatang: row.upperBoundSatang,
    settledCostSatang: row.settledCostSatang,
    monthKey: row.monthKey,
    createdAt: row.createdAt.toISOString(),
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    invocationKeyShort: row.invocationKeyShort,
  };
}

/**
 * The operator surface for held AI credit that no evidence will ever close (hold spec §4).
 *
 * Reading runs the SAME lazy sweep admission runs, for the current and the previous Bangkok month,
 * before listing: the sweep is lazy by design (it only runs inside a reserve for that
 * company-month), so a quiet company would otherwise show `DISPATCHED` rows that admission has
 * already decided are `UNRESOLVED`. It is idempotent — it only moves rows already past their own
 * thresholds — so calling it on every page load costs one short locked transaction per month.
 *
 * The three actions are money decisions. Each one validates the reason, refuses a locked company,
 * and then delegates to the reservation engine, which owns the advisory lock, the fenced
 * `updateMany` and the audit row that becomes the adjustment-history entry. Nothing here writes to
 * a reservation directly.
 */
@Injectable()
export class PartnerAiCreditHoldsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async read(input: { companyId: string; canManage: boolean; cursor?: string; now?: Date }): Promise<PartnerAiCreditHoldsDto> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: input.companyId }, select: { status: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${input.companyId}" not found.`);

    const now = input.now ?? new Date();
    const before = decodeCursor(input.cursor);
    // Add-on C11: a hold is found in whatever month it was pinned to, not only the last two. The
    // sweep is per company-month, so every month that still has a pre-terminal row is swept too.
    const live = await this.prisma.client.aiBudgetReservation.findMany({
      where: { companyId: input.companyId, status: { in: ['RESERVED', 'DISPATCHED'] } },
      distinct: ['monthKey'], select: { monthKey: true },
    });
    const monthKeys = [...new Set([bangkokMonthKey(now), previousBangkokMonthKey(now), ...live.map((row) => row.monthKey)])]
      .sort().reverse();
    // Sequentially: PrismaPg gives an interactive transaction one connection, and these are
    // separate short transactions that all take the same kind of lock.
    for (const monthKey of monthKeys) await sweepAiBudgetCompanyMonth(this.prisma, input.companyId, monthKey, now);

    const rows = await listAiBudgetCreditHolds(this.prisma, input.companyId, null,
      { take: AI_CREDIT_HOLDS_PAGE_SIZE + 1, ...(before ? { before } : {}) });
    const items = rows.slice(0, AI_CREDIT_HOLDS_PAGE_SIZE);
    const last = items[items.length - 1];
    return {
      canManage: input.canManage,
      companyLocked: partnerMetadataLockError(company.status) !== null,
      items: items.map(toDto),
      monthKeys,
      nextCursor: rows.length > AI_CREDIT_HOLDS_PAGE_SIZE && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
    };
  }

  release(cmd: PartnerAiCreditHoldCommand): Promise<PartnerAiCreditHoldActionResultDto> {
    return this.act(cmd, 'release', (decision) => releaseAiBudgetHoldByOperator(this.prisma, decision, {
      action: AuditAction.AI_CREDIT_HOLD_RELEASED,
    }));
  }

  chargeAtBound(cmd: PartnerAiCreditHoldCommand): Promise<PartnerAiCreditHoldActionResultDto> {
    return this.act(cmd, 'charge_at_bound', (decision) => chargeAiBudgetHoldAtBound(this.prisma, decision, {
      action: AuditAction.AI_CREDIT_HOLD_CHARGED_AT_BOUND,
    }));
  }

  acknowledgeBreach(cmd: PartnerAiCreditHoldCommand): Promise<PartnerAiCreditHoldActionResultDto> {
    return this.act(cmd, 'acknowledge_breach', (decision) => acknowledgeAiBudgetBreach(this.prisma, decision, {
      action: AuditAction.AI_CREDIT_BREACH_ACKNOWLEDGED,
    }));
  }

  /** The shared boundary: reason, company lock, then the engine — and the typed refusals the web
   *  translates. One place, so three routes cannot drift on any of it. */
  private async act(
    cmd: PartnerAiCreditHoldCommand,
    action: PartnerAiCreditHoldActionResultDto['action'],
    run: (decision: AiBudgetOperatorDecision) => Promise<AiBudgetOperatorOutcome>,
  ): Promise<PartnerAiCreditHoldActionResultDto> {
    const reason = partnerAdjustmentReason(cmd.reason);
    if (!reason) throw new UnprocessableEntityException('partner_adjustment_reason_required');

    const company = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId }, select: { status: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);
    const lockError = partnerMetadataLockError(company.status);
    if (lockError) throw new UnprocessableEntityException(lockError);

    const outcome = await run({
      reservationId: cmd.reservationId,
      companyId: cmd.companyId,
      actorUserId: cmd.requestingAdminUserId,
      requestId: cmd.requestId,
      reason,
      ...(cmd.now ? { now: cmd.now } : {}),
    });
    if (outcome.ok) return { id: cmd.reservationId, action, status: outcome.status, chargedSatang: outcome.chargedSatang };
    if (outcome.reason === 'not-found') {
      throw new NotFoundException({ code: 'partner_ai_credit_hold_not_found', message: 'partner_ai_credit_hold_not_found' });
    }
    if (outcome.reason === 'already-resolved') {
      throw new ConflictException({ code: 'partner_ai_credit_hold_already_resolved', message: 'partner_ai_credit_hold_already_resolved' });
    }
    if (outcome.reason === 'already-acknowledged') {
      throw new ConflictException({ code: 'partner_ai_credit_breach_already_acknowledged', message: 'partner_ai_credit_breach_already_acknowledged' });
    }
    // The engine already logged the cause with ids only. The operator gets a code they can retry on
    // rather than a stack trace, and nothing was written: every action is one fenced transaction.
    throw new UnprocessableEntityException({ code: 'partner_ai_credit_hold_action_failed', message: 'partner_ai_credit_hold_action_failed' });
  }
}
