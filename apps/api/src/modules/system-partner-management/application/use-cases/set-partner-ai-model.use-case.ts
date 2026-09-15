import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { __resetCompanyAiBudgetCache, resolvePlatformAiBudget } from '../../../line-ai/application/company-ai-usage-meter';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
import { lockPlanTermCompany } from '../lock-plan-term-company';

/**
 * Partial update (metering spec §7.7): an `undefined` field is left untouched, while an explicit
 * `monthlyBudgetSatang: null` clears the override back to the platform default. At least one of
 * the two must be present.
 */
export type SetPartnerAiModelCommand = {
  companyId: string;
  modelId?: string;
  monthlyBudgetSatang?: number | null;
  requestingAdminUserId: string;
  requestId: string;
};

export type SetPartnerAiModelResult = {
  companyId: string;
  /** null = inherits the platform default model (spec §6.8). */
  modelId: string | null;
  /** null = inherits `AI_MONTHLY_BUDGET_SATANG`. */
  monthlyBudgetSatang: number | null;
  updatedAt: string;
};

@Injectable()
export class SetPartnerAiModelUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: SetPartnerAiModelCommand): Promise<SetPartnerAiModelResult> {
    const setsModel = cmd.modelId !== undefined;
    const setsBudget = cmd.monthlyBudgetSatang !== undefined;
    if (!setsModel && !setsBudget) {
      throw new UnprocessableEntityException('Provide modelId, monthlyBudgetSatang, or both.');
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
      // Never clamp: the operator must see the ceiling they crossed (spec §7.7). The ceiling is
      // the effective one (platform settings row, else env) and it gates WRITES only — an
      // override made under a higher ceiling keeps enforcing as-is (spec §7.4, grandfathered).
      const { ceilingSatang: ceiling } = await resolvePlatformAiBudget(this.prisma, this.config);
      if (budget > ceiling) {
        throw new UnprocessableEntityException(
          `monthlyBudgetSatang ${budget} is above the platform ceiling of ${ceiling} satang.`,
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
      const existing = await tx.companyAiConfiguration.findUnique({
        where: { companyId: cmd.companyId }, select: { modelId: true, monthlyBudgetSatang: true },
      });
      const result = await tx.companyAiConfiguration.upsert({
        where: { companyId: cmd.companyId },
        // A field the caller did not send has no prior value on a fresh row: it starts inherited.
        create: {
          companyId: cmd.companyId,
          modelId: cmd.modelId ?? null,
          monthlyBudgetSatang: budget ?? null,
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        update: {
          ...(setsModel ? { modelId: cmd.modelId } : {}),
          ...(setsBudget ? { monthlyBudgetSatang: budget } : {}),
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        select: { companyId: true, modelId: true, monthlyBudgetSatang: true, updatedAt: true },
      });

      // CRITICAL, not HIGH: this row now also carries the spend cap (spec §7.7).
      // A cleared override is recorded as a transition to inherited (null).
      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_ai_model.update',
          targetType: 'company',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            source: 'ADMIN_ADJUSTMENT',
            entryPoint: 'SYSTEM_PARTNER_ADMIN',
            fromModelId: existing?.modelId ?? null,
            toModelId: result.modelId,
            fromMonthlyBudgetSatang: existing?.monthlyBudgetSatang ?? null,
            toMonthlyBudgetSatang: result.monthlyBudgetSatang,
          },
        },
      });

      return result;
    });

    // The meter caches the config half for 60s; drop it so the new cap binds on the next call.
    if (setsBudget) __resetCompanyAiBudgetCache();

    return {
      companyId: saved.companyId,
      modelId: saved.modelId,
      monthlyBudgetSatang: saved.monthlyBudgetSatang,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }
}
