import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PartnerDisbursementVoucherWebEntryDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW } from '../../domain/logic/manual-expense-web-entry.logic';
import { disbursementVoucherWebEntryState } from '../../domain/logic/disbursement-voucher-web-entry.logic';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
import { lockPlanTermCompany } from '../lock-plan-term-company';

export type SetPartnerDisbursementVoucherWebEntryCommand = {
  companyId: string;
  enabled: boolean;
  expectedVersion: number;
  requestingAdminUserId: string;
  requestId: string;
};

/** Controls only whether the web shows the document entrances; it is not an access or feature gate. */
@Injectable()
export class SetPartnerDisbursementVoucherWebEntryUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: SetPartnerDisbursementVoucherWebEntryCommand): Promise<PartnerDisbursementVoucherWebEntryDto> {
    if (typeof cmd.enabled !== 'boolean') throw new UnprocessableEntityException('enabled must be a boolean.');
    if (!Number.isInteger(cmd.expectedVersion) || cmd.expectedVersion < 0) {
      throw new UnprocessableEntityException('expectedVersion must be a non-negative integer.');
    }

    return this.prisma.client.$transaction(async (tx) => {
      await lockPlanTermCompany(tx, cmd.companyId);
      const company = await tx.company.findUnique({ where: { id: cmd.companyId }, select: { id: true, status: true } });
      if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);
      const lockError = partnerMetadataLockError(company.status);
      if (lockError) throw new UnprocessableEntityException(lockError);

      const before = disbursementVoucherWebEntryState(await tx.companyWebEntrySetting.findUnique({
        where: { companyId: cmd.companyId },
        select: { disbursementVoucherEntryEnabled: true, version: true },
      }));
      if (before.enabled === cmd.enabled) return before;
      if (before.version !== cmd.expectedVersion) {
        throw new ConflictException({
          code: 'disbursement_voucher_web_entry_version_conflict',
          message: 'การตั้งค่านี้เปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองบันทึกอีกครั้ง',
          currentVersion: before.version,
        });
      }

      const saved = await tx.companyWebEntrySetting.upsert({
        where: { companyId: cmd.companyId },
        create: {
          companyId: cmd.companyId,
          manualExpenseEntryEnabled: MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW,
          disbursementVoucherEntryEnabled: cmd.enabled,
          version: 1,
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        update: {
          disbursementVoucherEntryEnabled: cmd.enabled,
          version: { increment: 1 },
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        select: { disbursementVoucherEntryEnabled: true, version: true },
      });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_disbursement_voucher_web_entry.update',
          targetType: 'company',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'MEDIUM',
          metadataJson: {
            entryPoint: 'SYSTEM_PARTNER_ADMIN',
            fromEnabled: before.enabled,
            toEnabled: saved.disbursementVoucherEntryEnabled,
            fromVersion: before.version,
            toVersion: saved.version,
          },
        },
      });

      return disbursementVoucherWebEntryState(saved);
    });
  }
}
