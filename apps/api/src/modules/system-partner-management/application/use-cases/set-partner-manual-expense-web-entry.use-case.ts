import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PartnerManualExpenseWebEntryDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { manualExpenseWebEntryState } from '../../domain/logic/manual-expense-web-entry.logic';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
import { lockPlanTermCompany } from '../lock-plan-term-company';

export type SetPartnerManualExpenseWebEntryCommand = {
  companyId: string;
  enabled: boolean;
  expectedVersion: number;
  requestingAdminUserId: string;
  requestId: string;
};

/**
 * Absolute desired state, like SetPartnerOcrConfigUseCase: asking for the value the company already
 * has is a no-op (so a repeated press or a retry after a lost response is safe), and a real change
 * is written with its audit row in one transaction behind the setting's own version.
 *
 * Deliberately touches nothing else. The setting is not an entitlement (spec §5.2): no entitlement
 * row, set version, transition or run-off, no LINE conversation state, no billing.
 */
@Injectable()
export class SetPartnerManualExpenseWebEntryUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: SetPartnerManualExpenseWebEntryCommand): Promise<PartnerManualExpenseWebEntryDto> {
    if (typeof cmd.enabled !== 'boolean') throw new UnprocessableEntityException('enabled must be a boolean.');
    if (!Number.isInteger(cmd.expectedVersion) || cmd.expectedVersion < 0) {
      throw new UnprocessableEntityException('expectedVersion must be a non-negative integer.');
    }

    return this.prisma.client.$transaction(async (tx) => {
      // The company row is the lock: it orders two admins pressing at once, and this command
      // against a lifecycle change of the same company.
      await lockPlanTermCompany(tx, cmd.companyId);
      const company = await tx.company.findUnique({ where: { id: cmd.companyId }, select: { id: true, status: true } });
      if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);
      const lockError = partnerMetadataLockError(company.status);
      if (lockError) throw new UnprocessableEntityException(lockError);

      const before = manualExpenseWebEntryState(await tx.companyWebEntrySetting.findUnique({
        where: { companyId: cmd.companyId },
        select: { manualExpenseEntryEnabled: true, version: true },
      }));
      if (before.enabled === cmd.enabled) return before;
      if (before.version !== cmd.expectedVersion) {
        throw new ConflictException({
          code: 'manual_expense_web_entry_version_conflict',
          message: 'The setting changed after it was loaded. Reload before saving again.',
          currentVersion: before.version,
        });
      }

      const saved = await tx.companyWebEntrySetting.upsert({
        where: { companyId: cmd.companyId },
        create: {
          companyId: cmd.companyId,
          manualExpenseEntryEnabled: cmd.enabled,
          version: 1,
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        update: {
          manualExpenseEntryEnabled: cmd.enabled,
          version: { increment: 1 },
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        select: { manualExpenseEntryEnabled: true, version: true },
      });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_manual_expense_web_entry.update',
          targetType: 'company',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'MEDIUM',
          metadataJson: {
            entryPoint: 'SYSTEM_PARTNER_ADMIN',
            fromEnabled: before.enabled,
            toEnabled: saved.manualExpenseEntryEnabled,
            fromVersion: before.version,
            toVersion: saved.version,
          },
        },
      });

      return manualExpenseWebEntryState(saved);
    });
  }
}
