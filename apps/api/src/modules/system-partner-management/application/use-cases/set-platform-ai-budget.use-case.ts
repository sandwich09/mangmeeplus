import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { PlatformAiBudgetDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { invalidateCompanyAiBudgetConfiguration } from '../../../line-ai/application/company-ai-usage-meter';

/** Single-row table (spec §7.3): the platform has exactly one budget configuration. */
const PLATFORM_CONFIG_ID = 'platform';

export type SetPlatformAiBudgetCommand = {
  monthlyBudgetSatang: number;
  ceilingSatang: number;
  requestingAdminUserId: string;
  requestId: string;
};

/**
 * Write half of the platform AI budget settings page (metering spec §7.9). Mirrors
 * `SetPartnerAiModelUseCase`: validate, then upsert + a CRITICAL audit row carrying before/after
 * for both fields inside ONE transaction. Admission reads current settings in every process;
 * invalidate cached observations without releasing any active AI admission.
 */
@Injectable()
export class SetPlatformAiBudgetUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: SetPlatformAiBudgetCommand): Promise<PlatformAiBudgetDto> {
    for (const [field, value] of [
      ['monthlyBudgetSatang', cmd.monthlyBudgetSatang],
      ['ceilingSatang', cmd.ceilingSatang],
    ] as const) {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new UnprocessableEntityException(`${field} must be a whole number of satang.`);
      }
      if (value < 1) {
        throw new UnprocessableEntityException(
          `${field} must be at least 1 satang. Switching AI off is a feature entitlement (ai_line_assistant), not a budget of zero.`,
        );
      }
    }
    // The same rule `validateProductionConfig` enforces on the env pair — a ceiling below the
    // default would reject the platform's own default on every per-company write.
    if (cmd.ceilingSatang < cmd.monthlyBudgetSatang) {
      throw new UnprocessableEntityException(
        `ceilingSatang ${cmd.ceilingSatang} must be greater than or equal to monthlyBudgetSatang ${cmd.monthlyBudgetSatang}.`,
      );
    }

    const saved = await this.prisma.client.$transaction(async (tx) => {
      // Also fences company override writes against a concurrently lowered platform ceiling.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'platform-ai-budget'}))`;
      const existing = await tx.platformAiBudgetConfig.findUnique({
        where: { id: PLATFORM_CONFIG_ID },
        select: { monthlyBudgetSatang: true, ceilingSatang: true },
      });
      const result = await tx.platformAiBudgetConfig.upsert({
        where: { id: PLATFORM_CONFIG_ID },
        create: {
          id: PLATFORM_CONFIG_ID,
          monthlyBudgetSatang: cmd.monthlyBudgetSatang,
          ceilingSatang: cmd.ceilingSatang,
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        update: {
          monthlyBudgetSatang: cmd.monthlyBudgetSatang,
          ceilingSatang: cmd.ceilingSatang,
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        select: { monthlyBudgetSatang: true, ceilingSatang: true },
      });

      // CRITICAL: this row is the spend cap every company without an override inherits.
      // A first write is recorded as a transition from the env fallbacks (null before).
      await tx.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.platform_ai_budget.update',
          targetType: 'platform_ai_budget',
          targetId: PLATFORM_CONFIG_ID,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            fromMonthlyBudgetSatang: existing?.monthlyBudgetSatang ?? null,
            toMonthlyBudgetSatang: result.monthlyBudgetSatang,
            fromCeilingSatang: existing?.ceilingSatang ?? null,
            toCeilingSatang: result.ceilingSatang,
          },
        },
      });

      return result;
    });

    invalidateCompanyAiBudgetConfiguration();

    return {
      monthlyBudgetSatang: saved.monthlyBudgetSatang,
      ceilingSatang: saved.ceilingSatang,
      source: { monthlyBudgetSatang: 'db', ceilingSatang: 'db' },
      envDefaults: {
        monthlyBudgetSatang: this.config.aiMonthlyBudgetSatang,
        ceilingSatang: this.config.aiMonthlyBudgetSatangCeiling,
      },
    };
  }
}
