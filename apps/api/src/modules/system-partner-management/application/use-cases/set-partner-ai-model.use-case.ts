import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  partnerAdjustmentReason,
  type PartnerAiBudgetPolicyDto,
  type PartnerAiBudgetPolicyInput,
  type SetPartnerAiModelDto,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { Prisma } from '../../../../generated/prisma/client';
import { invalidateCompanyAiBudgetConfiguration, resolvePlatformAiBudget, bangkokMonthKey } from '../../../line-ai/application/company-ai-usage-meter';
import {
  aiBudgetPolicyRevision,
  nextBangkokMonthKey,
  parsePendingBudgetPolicy,
  resolveAiBudgetPolicy,
  toPartnerAiBudgetPolicyDto,
  type AiBudgetPendingPolicy,
  type CompanyAiBudgetPolicyRow,
} from '../../../line-ai/application/company-ai-budget-policy';
import { readAiBudgetMonthSnapshot } from '../../../line-ai/application/company-ai-budget-reservation';
import { readAiCreditSalesReadiness } from '../../../line-ai/application/company-ai-budget-readiness';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
import { lockPlanTermCompany } from '../lock-plan-term-company';

/**
 * Partial update (metering spec §7.7): an `undefined` field is left untouched, while an explicit
 * `monthlyBudgetSatang: null` clears the override back to the platform default. At least one of
 * the three must be present.
 */
export type SetPartnerAiModelCommand = SetPartnerAiModelDto & {
  companyId: string;
  requestingAdminUserId: string;
  requestId: string;
  /**
   * Bangkok month seam (spec §12.5). Production always uses the wall clock; a test or a real-DB
   * check passes an explicit instant instead of mocking `Date` globally.
   */
  now?: Date;
};

export type SetPartnerAiModelResult = {
  companyId: string;
  /** null = inherits the platform default model (spec §6.8). */
  modelId: string | null;
  /** null = inherits `AI_MONTHLY_BUDGET_SATANG`. */
  monthlyBudgetSatang: number | null;
  updatedAt: string | null;
  /** The effective CHAT/OCR policy after this write — including the revision the next edit needs. */
  budgetPolicy: PartnerAiBudgetPolicyDto;
  /**
   * Add-on spec §5.3 (plan C6): the saved total leaves less room this month than the AI credit the
   * shop holds, so part of that credit cannot be used until the cap is raised or the month turns.
   * A warning, never a refusal. Absent when the shop is not cut over or nothing is short.
   */
  aiCreditWarning?: { headroomSatang: number; commercialUnits: number } | null;
};

/** What the write does to the stored policy; `null` = the policy is untouched. */
type PolicyChange = 'ACTIVE' | 'PENDING' | 'CANCEL_PENDING' | null;

const POLICY_SELECT = {
  budgetMode: true, chatMonthlyBudgetSatang: true, ocrMonthlyBudgetSatang: true,
  budgetConfigVersion: true, pendingBudgetPolicy: true,
} as const;

/** Scalar form for the audit metadata and the adjustment history (spec §12.4, review R-08). */
function pendingScalar(policy: AiBudgetPendingPolicy | null): string | null {
  return policy
    ? `${policy.mode}:${policy.chatMonthlyBudgetSatang}:${policy.ocrMonthlyBudgetSatang}:${policy.effectiveMonthKey}`
    : null;
}

const sameAllocation = (a: PartnerAiBudgetPolicyInput, b: { mode: string; chat: number | null; ocr: number | null }): boolean =>
  a.mode === b.mode && a.chatMonthlyBudgetSatang === b.chat && a.ocrMonthlyBudgetSatang === b.ocr;

@Injectable()
export class SetPartnerAiModelUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: SetPartnerAiModelCommand): Promise<SetPartnerAiModelResult> {
    const reason = partnerAdjustmentReason(cmd.reason);
    if (!reason) throw new UnprocessableEntityException('partner_adjustment_reason_required');
    const setsModel = cmd.modelId !== undefined;
    const setsBudget = cmd.monthlyBudgetSatang !== undefined;
    const setsPolicy = cmd.budgetPolicy !== undefined;
    if (!setsModel && !setsBudget && !setsPolicy) {
      throw new UnprocessableEntityException('Provide modelId, monthlyBudgetSatang, budgetPolicy, or a combination.');
    }

    const now = cmd.now ?? new Date();
    const monthKey = bangkokMonthKey(now);
    const nextMonthKey = nextBangkokMonthKey(now);
    // `null` = cancel a future pending policy; an object is the desired policy. Shape first, so a
    // malformed body never reaches the locks (and never reaches the JSON column).
    const desired = cmd.budgetPolicy == null ? null : parsePendingBudgetPolicy(cmd.budgetPolicy);
    if (setsPolicy && cmd.budgetPolicy !== null) {
      if (!desired) throw new UnprocessableEntityException('partner_ai_budget_policy_invalid');
      if (desired.mode === 'SPLIT' && (desired.chatMonthlyBudgetSatang === null || desired.ocrMonthlyBudgetSatang === null)) {
        throw new UnprocessableEntityException('partner_ai_budget_split_caps_required');
      }
      if (desired.effectiveMonthKey !== monthKey && desired.effectiveMonthKey !== nextMonthKey) {
        throw new UnprocessableEntityException('partner_ai_budget_effective_month_invalid');
      }
      // Owner 2026-09-29: no activation switch — SPLIT is savable whenever the money rules below hold.
    }

    const company = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId },
      select: { id: true, status: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    const lockError = partnerMetadataLockError(company.status);
    if (lockError) throw new UnprocessableEntityException(lockError);

    if (setsModel && !this.config.approvedAiModelIds.includes(cmd.modelId as string)) {
      throw new UnprocessableEntityException(`modelId "${cmd.modelId}" is not in the approved list.`);
    }

    const budget = cmd.monthlyBudgetSatang;
    if (setsBudget && budget !== null) {
      if (typeof budget !== 'number' || !Number.isInteger(budget)) {
        throw new UnprocessableEntityException('monthlyBudgetSatang must be a whole number of satang.');
      }
      if (budget < 1) {
        throw new UnprocessableEntityException(
          'monthlyBudgetSatang must be at least 1 satang. Switching AI off is a feature entitlement (ai_line_assistant), not a budget of zero.',
        );
      }

    }

    const saved = await this.prisma.client.$transaction(async (tx) => {
      // Share OCR's configuration lock: both controls upsert the same company row.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${cmd.companyId}`}))`;
      await lockPlanTermCompany(tx, cmd.companyId);
      const currentCompany = await tx.company.findUnique({
        where: { id: cmd.companyId }, select: { status: true },
      });
      if (!currentCompany) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);
      const currentLockError = partnerMetadataLockError(currentCompany.status);
      if (currentLockError) throw new UnprocessableEntityException(currentLockError);
      // A previous read may predate another Admin's save. Audit the actual committed predecessor.
      let existing = await tx.companyAiConfiguration.findUnique({
        where: { companyId: cmd.companyId },
        select: { modelId: true, monthlyBudgetSatang: true, updatedAt: true, ...POLICY_SELECT },
      });

      // R-07: a pending policy whose month has ARRIVED is already the effective policy. Write it
      // into the active columns first, so the predecessor this write compares and audits against
      // is the effective one — otherwise cancelling it here would look like a fall back to SHARED.
      const revisionBeforeActivation = aiBudgetPolicyRevision(existing, monthKey);
      const reached = parsePendingBudgetPolicy(existing?.pendingBudgetPolicy);
      const materialised = !!existing && !!reached && reached.effectiveMonthKey <= monthKey;
      if (existing && reached && materialised) {
        const before = this.auditPolicyFields(existing);
        existing = await tx.companyAiConfiguration.update({
          where: { companyId: cmd.companyId },
          data: {
            budgetMode: reached.mode,
            chatMonthlyBudgetSatang: reached.chatMonthlyBudgetSatang,
            ocrMonthlyBudgetSatang: reached.ocrMonthlyBudgetSatang,
            pendingBudgetPolicy: Prisma.DbNull,
            budgetConfigVersion: { increment: 1 },
          },
          select: { modelId: true, monthlyBudgetSatang: true, updatedAt: true, ...POLICY_SELECT },
        });
        await this.writeAudit(tx, cmd, reason, {
          ...before, ...this.auditPolicyFields(existing, 'to'),
          fromModelId: existing.modelId, toModelId: existing.modelId,
          fromMonthlyBudgetSatang: existing.monthlyBudgetSatang, toMonthlyBudgetSatang: existing.monthlyBudgetSatang,
          budgetPolicyEvent: 'PENDING_ACTIVATED',
        });
      }

      const row: CompanyAiBudgetPolicyRow = existing ?? {};
      const activeMode = row.budgetMode ?? 'SHARED';
      const activeChat = row.chatMonthlyBudgetSatang ?? null;
      const activeOcr = row.ocrMonthlyBudgetSatang ?? null;
      const pendingNow = parsePendingBudgetPolicy(row.pendingBudgetPolicy) ?? null;

      if ((setsModel && cmd.expectedModelId === undefined) || (setsBudget && cmd.expectedMonthlyBudgetSatang === undefined)) {
        throw new UnprocessableEntityException('partner_ai_previous_value_required');
      }
      if (setsPolicy && cmd.expectedBudgetRevision === undefined) {
        throw new UnprocessableEntityException('partner_ai_budget_revision_required');
      }

      // What this write would do to the stored policy — `null` when the desired state is already
      // the stored one, which is the exact-replay no-op (no version bump, no second audit row).
      let policyChange: PolicyChange = null;
      if (setsPolicy) {
        if (!desired) policyChange = pendingNow ? 'CANCEL_PENDING' : null;
        else if (desired.effectiveMonthKey === monthKey) {
          policyChange = sameAllocation(desired, { mode: activeMode, chat: activeChat, ocr: activeOcr }) ? null : 'ACTIVE';
        } else policyChange = pendingNow && sameAllocation(desired, {
          mode: pendingNow.mode, chat: pendingNow.chatMonthlyBudgetSatang, ocr: pendingNow.ocrMonthlyBudgetSatang,
        }) ? null : 'PENDING';
      }

      const modelSame = !setsModel || (existing?.modelId ?? null) === cmd.modelId;
      const budgetSame = !setsBudget || (existing?.monthlyBudgetSatang ?? null) === budget;
      if (modelSame && budgetSame && policyChange === null) {
        return { companyId: cmd.companyId, modelId: existing?.modelId ?? null, monthlyBudgetSatang: existing?.monthlyBudgetSatang ?? null,
          updatedAt: existing?.updatedAt ?? null, row, materialised };
      }
      if ((setsModel && (existing?.modelId ?? null) !== cmd.expectedModelId)
        || (setsBudget && (existing?.monthlyBudgetSatang ?? null) !== cmd.expectedMonthlyBudgetSatang)) {
        throw new ConflictException({ code: 'partner_ai_configuration_changed', message: 'partner_ai_configuration_changed' });
      }
      // The revision the operator's page was rendered from. Materialising an activated pending
      // policy is a storage detail they could not have seen, so the pre-activation fence is
      // accepted too; a page from ANOTHER month still carries another month key and conflicts.
      if (setsPolicy && ![aiBudgetPolicyRevision(row, monthKey), revisionBeforeActivation].includes(cmd.expectedBudgetRevision!)) {
        throw new ConflictException({ code: 'partner_ai_budget_revision_conflict', message: 'partner_ai_budget_revision_conflict' });
      }

      // The resulting state, which is what every money rule below is validated against.
      const nextActive = policyChange === 'ACTIVE' && desired
        ? { mode: desired.mode as string, chat: desired.chatMonthlyBudgetSatang, ocr: desired.ocrMonthlyBudgetSatang }
        : { mode: activeMode, chat: activeChat, ocr: activeOcr };
      const nextPending = policyChange === 'PENDING' ? desired
        : policyChange === 'CANCEL_PENDING' ? null : pendingNow;

      // Live effective total under the platform lock — the LAST lock of the canonical order
      // (spec §12.7). A model-only write on a SHARED company needs no total at all.
      const needsTotal = setsBudget || setsPolicy || nextActive.mode === 'SPLIT' || nextPending?.mode === 'SPLIT';
      let totalSatang = Number.MAX_SAFE_INTEGER; // inert: only a SPLIT allocation is compared to it
      const nextOverride = setsBudget ? budget ?? null : existing?.monthlyBudgetSatang ?? null;
      if (needsTotal) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'platform-ai-budget'}))`;
        // Canonical order (spec §12.7), taken LAST: this is the lock `reserveAiBudgetStep` and
        // `settleAiBudgetStep` hold, so a cap change and a live admission serialize instead of
        // reading different policy states. Same order in both, therefore no deadlock (R-06).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${cmd.companyId}:${monthKey}`}))`;
        const platform = await resolvePlatformAiBudget({ client: tx } as PrismaService, this.config, true);
        // The ceiling gates new writes; an exact replay above a later-lowered ceiling stays a no-op.
        if (setsBudget && budget != null && budget > platform.ceilingSatang) throw new UnprocessableEntityException(
          `monthlyBudgetSatang ${budget} is above the platform ceiling of ${platform.ceilingSatang} satang.`,
        );
        totalSatang = nextOverride ?? platform.monthlyBudgetSatang;
      }

      // `C + O <= T` for BOTH the resulting active and the resulting pending allocation. This is
      // the same rule from two directions: a policy that does not fit the total, and a total
      // lowered under an allocation that already fits. Neither is ever clamped (spec §12.4).
      for (const allocation of [nextActive, nextPending && {
        mode: nextPending.mode as string, chat: nextPending.chatMonthlyBudgetSatang, ocr: nextPending.ocrMonthlyBudgetSatang,
      }]) {
        if (!allocation || allocation.mode !== 'SPLIT') continue;
        if (allocation.chat === null || allocation.ocr === null) throw new UnprocessableEntityException('partner_ai_budget_split_caps_required');
        if (allocation.chat + allocation.ocr > totalSatang) {
          // Object form, like every other typed refusal here: a STABLE `code` the web translates and
          // the Thai-coverage spec can discover, with the numbers as separate fields instead of glued
          // into the sentence. This route is `system.partner_ai_model.manage` only, so the amounts are
          // an operator's to see — but they still never become the displayed string. Two literal
          // branches rather than a ternary inside `code:`, so the code stays greppable.
          const detail = { chatCapSatang: allocation.chat, ocrCapSatang: allocation.ocr, totalSatang };
          throw policyChange
            ? new UnprocessableEntityException({ code: 'partner_ai_budget_split_exceeds_total', message: 'partner_ai_budget_split_exceeds_total', ...detail })
            : new UnprocessableEntityException({ code: 'partner_ai_budget_total_below_split_allocation', message: 'partner_ai_budget_total_below_split_allocation', ...detail });
        }
      }

      // A SPLIT hold is priced from the company's OWN model (the envelope has to pin one), so a
      // company inheriting the platform default model refuses every AI call with
      // `AI_BUDGET_UNAVAILABLE`. The operator must learn that HERE, at save time, not from a shop
      // that went quiet after a save they were told succeeded.
      //
      // `modelId` can only be SET through this writer, never cleared: `null` is not in
      // `approvedAiModelIds` so the check above rejects it, `set-partner-ocr-config.use-case.ts`
      // writes `modelId: null` only in its CREATE branch (a fresh row is null anyway) and never in
      // its update, and `provision-signup.use-case.ts` upserts with `update: {}`. So this one gate
      // is enough — there is no other path that could null the model under a SPLIT policy.
      const nextModelId = setsModel ? cmd.modelId ?? null : existing?.modelId ?? null;
      if (nextModelId === null && (nextActive.mode === 'SPLIT' || nextPending?.mode === 'SPLIT')) {
        throw new UnprocessableEntityException({
          code: 'partner_ai_budget_split_requires_model',
          message: 'partner_ai_budget_split_requires_model',
        });
      }

      // Committed + held money for this company-month, read under the SAME lock admission takes.
      // Only needed when a SPLIT allocation or a SPLIT company's total is in play (spec §12.4/E-09).
      const splitInvolved = needsTotal && (nextActive.mode === 'SPLIT' || activeMode === 'SPLIT' || nextPending?.mode === 'SPLIT');
      const position = splitInvolved ? await readAiBudgetMonthSnapshot(tx, cmd.companyId, monthKey) : null;

      // Timing (spec §12.5 / E-08): legacy spend is never guessed into buckets, and money already
      // spent in a bucket can never be taken back out of it mid-month.
      if (policyChange === 'ACTIVE' && desired) {
        if (desired.mode === 'SPLIT' && activeMode !== 'SPLIT') {
          const used = await tx.companyAiMonthlyUsage.findUnique({
            where: { companyId_monthKey: { companyId: cmd.companyId, monthKey } },
            select: { costSatang: true, callCount: true },
          });
          if (used && (used.costSatang !== 0 || used.callCount !== 0)) {
            throw new UnprocessableEntityException('partner_ai_budget_split_requires_next_month');
          }
          // A company with an unresolved or in-flight hold has money committed under the OLD policy
          // that a fresh bucket allocation could not account for (spec §12.5).
          if ((position?.reserved.TOTAL ?? 0) > 0 || (position?.unresolvedHolds ?? 0) > 0) {
            throw new UnprocessableEntityException('partner_ai_budget_split_requires_next_month');
          }
        }
        if (desired.mode === 'SHARED' && activeMode === 'SPLIT') {
          throw new UnprocessableEntityException('partner_ai_budget_mode_change_next_month_only');
        }
        if (desired.mode === 'SPLIT' && activeMode === 'SPLIT') {
          // The HIGHER of the two truths about bucket spend, plus the live holds. The bucket
          // aggregate is what admission compares against, but it only starts at Phase E1b — a
          // company whose SPLIT month predates it has spend only in the event rows, so taking the
          // max keeps the floor honest in the transition month instead of letting a cap drop under
          // money that was already spent.
          const aggregate = position ? { CHAT: position.spent.CHAT, OCR: position.spent.OCR } : null;
          const events = await this.bucketSpend(tx, cmd.companyId, monthKey);
          const spent = {
            CHAT: Math.max(aggregate?.CHAT ?? 0, events.CHAT),
            OCR: Math.max(aggregate?.OCR ?? 0, events.OCR),
          };
          const held = position?.reserved ?? { CHAT: 0, OCR: 0 };
          if (desired.chatMonthlyBudgetSatang! < spent.CHAT + held.CHAT
            || desired.ocrMonthlyBudgetSatang! < spent.OCR + held.OCR) {
            throw new UnprocessableEntityException('partner_ai_budget_cap_below_bucket_spend');
          }
        }
      }
      // ...and the TOTAL likewise, for a company whose effective OR resulting mode is SPLIT. A
      // SHARED company keeps today's freedom to set any positive total (spec §12.4).
      if (position && (nextActive.mode === 'SPLIT' || activeMode === 'SPLIT')
        && totalSatang < position.spent.TOTAL + position.reserved.TOTAL) {
        // Object form with a plain string code, like the two branches above: the web Thai-coverage
        // spec discovers codes by pattern and cannot see a template literal or a ternary, and the
        // amounts travel as separate fields so they never become part of the displayed sentence.
        throw new UnprocessableEntityException({
          code: 'partner_ai_budget_total_below_committed',
          message: 'partner_ai_budget_total_below_committed',
          totalSatang, spentSatang: position.spent.TOTAL, reservedSatang: position.reserved.TOTAL,
        });
      }

      const policyWrite = policyChange === 'ACTIVE' && desired
        ? { budgetMode: desired.mode, chatMonthlyBudgetSatang: desired.chatMonthlyBudgetSatang, ocrMonthlyBudgetSatang: desired.ocrMonthlyBudgetSatang }
        : policyChange === 'PENDING' && desired ? { pendingBudgetPolicy: desired as unknown as Prisma.InputJsonValue }
        : policyChange === 'CANCEL_PENDING' ? { pendingBudgetPolicy: Prisma.DbNull }
        : {};
      const before = this.auditPolicyFields(existing);
      const result = await tx.companyAiConfiguration.upsert({
        where: { companyId: cmd.companyId },
        // A field the caller did not send has no prior value on a fresh row: it starts inherited.
        create: {
          companyId: cmd.companyId,
          modelId: cmd.modelId ?? null,
          monthlyBudgetSatang: budget ?? null,
          ...policyWrite,
          ...(policyChange ? { budgetConfigVersion: 1 } : {}),
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        update: {
          ...(setsModel ? { modelId: cmd.modelId } : {}),
          ...(setsBudget ? { monthlyBudgetSatang: budget } : {}),
          ...policyWrite,
          ...(policyChange ? { budgetConfigVersion: { increment: 1 } } : {}),
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        select: { companyId: true, modelId: true, monthlyBudgetSatang: true, updatedAt: true, ...POLICY_SELECT },
      });

      // Plan C6: read-only under the locks this write already holds (no lock added or reordered).
      const creditRow = needsTotal ? await tx.companyAiConfiguration.findUnique({ where: { companyId: cmd.companyId } }) : null;
      const credit = creditRow?.aiCreditCutoverAt
        ? await readAiCreditSalesReadiness(tx, { companyId: cmd.companyId, monthKey, at: now, row: creditRow, totalSatang, packUnits: 0 })
        : null;
      const aiCreditWarning = credit?.reason === 'TOTAL_HEADROOM'
        ? { headroomSatang: credit.headroomSatang, commercialUnits: credit.commercialUnits } : null;

      // CRITICAL, not HIGH: this row now also carries the spend cap (spec §7.7).
      // A cleared override is recorded as a transition to inherited (null).
      await this.writeAudit(tx, cmd, reason, {
        fromModelId: existing?.modelId ?? null,
        toModelId: result.modelId,
        fromMonthlyBudgetSatang: existing?.monthlyBudgetSatang ?? null,
        toMonthlyBudgetSatang: result.monthlyBudgetSatang,
        ...before,
        ...this.auditPolicyFields(result, 'to'),
      });

      return { ...result, row: result as CompanyAiBudgetPolicyRow, materialised, aiCreditWarning };
    });

    if (setsBudget || setsPolicy || saved.materialised) invalidateCompanyAiBudgetConfiguration();

    const policy = resolveAiBudgetPolicy({
      row: saved.row,
      totalSatang: await this.responseTotal(saved.row, saved.monthlyBudgetSatang),
      override: saved.monthlyBudgetSatang != null,
      monthKey,
    });
    return {
      companyId: cmd.companyId,
      modelId: saved.modelId,
      monthlyBudgetSatang: saved.monthlyBudgetSatang,
      updatedAt: saved.updatedAt?.toISOString() ?? null,
      budgetPolicy: toPartnerAiBudgetPolicyDto(policy),
      ...('aiCreditWarning' in saved && saved.aiCreditWarning ? { aiCreditWarning: saved.aiCreditWarning } : {}),
    };
  }

  /**
   * The total the RESPONSE's policy is resolved against. Only a split allocation is ever compared
   * to `T`, so the inherited platform default is read (through the meter's short cache) only when
   * the saved row actually carries one — a SHARED response cannot depend on the number at all.
   */
  private async responseTotal(row: CompanyAiBudgetPolicyRow, overrideSatang: number | null): Promise<number> {
    if (overrideSatang != null) return overrideSatang;
    const splitInvolved = row.budgetMode === 'SPLIT' || parsePendingBudgetPolicy(row.pendingBudgetPolicy) != null;
    return splitInvolved ? (await resolvePlatformAiBudget(this.prisma, this.config)).monthlyBudgetSatang : Number.MAX_SAFE_INTEGER;
  }

  /** Spend already committed to each bucket this month (Phase D1 metadata). UNKNOWN belongs to
   *  neither bucket — it still counts against the total, and is never guessed into one. */
  private async bucketSpend(tx: Prisma.TransactionClient, companyId: string, monthKey: string): Promise<{ CHAT: number; OCR: number }> {
    const rows = await tx.aiUsageEvent.groupBy({
      by: ['budgetBucket'], where: { companyId, monthKey }, _sum: { costSatang: true },
    });
    const of = (bucket: string) => rows.find((r) => r.budgetBucket === bucket)?._sum.costSatang ?? 0;
    return { CHAT: of('CHAT'), OCR: of('OCR') };
  }

  /** Scalar before/after pairs for the CRITICAL audit row and the adjustment history allowlist. */
  private auditPolicyFields(row: CompanyAiBudgetPolicyRow | null | undefined, direction: 'from' | 'to' = 'from') {
    const key = (field: string) => `${direction}${field[0]!.toUpperCase()}${field.slice(1)}`;
    return {
      [key('budgetMode')]: row?.budgetMode ?? 'SHARED',
      [key('chatMonthlyBudgetSatang')]: row?.chatMonthlyBudgetSatang ?? null,
      [key('ocrMonthlyBudgetSatang')]: row?.ocrMonthlyBudgetSatang ?? null,
      [key('budgetConfigVersion')]: row?.budgetConfigVersion ?? 0,
      [key('pendingBudgetPolicy')]: pendingScalar(parsePendingBudgetPolicy(row?.pendingBudgetPolicy) ?? null),
    };
  }

  private writeAudit(tx: Prisma.TransactionClient, cmd: SetPartnerAiModelCommand, reason: string, metadata: Record<string, unknown>) {
    return tx.auditLog.create({
      data: {
        companyId: cmd.companyId,
        actorUserId: cmd.requestingAdminUserId,
        action: 'system.partner_ai_model.update',
        targetType: 'company',
        targetId: cmd.companyId,
        requestId: cmd.requestId,
        result: 'SUCCESS',
        riskLevel: 'CRITICAL',
        metadataJson: { source: 'ADMIN_ADJUSTMENT', entryPoint: 'SYSTEM_PARTNER_ADMIN', reason, ...metadata },
      },
    });
  }
}
