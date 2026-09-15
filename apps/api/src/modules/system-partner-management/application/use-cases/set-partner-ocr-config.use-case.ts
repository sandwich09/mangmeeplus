import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PartnerOcrConfigDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
import { lockPlanTermCompany } from '../lock-plan-term-company';

const OCR_MONTHLY_LIMIT_MAX = 1_000_000;

export type SetPartnerOcrConfigCommand = {
  companyId: string;
  enabled: boolean;
  receiptQuotaEnforced?: boolean | null;
  monthlyLimit: number | null;
  expectedVersion: number;
  requestingAdminUserId: string;
  requestId: string;
};

/** Absolute desired-state update: an exact retry becomes a no-op, while real changes are audited atomically. */
@Injectable()
export class SetPartnerOcrConfigUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: SetPartnerOcrConfigCommand): Promise<PartnerOcrConfigDto> {
    if (typeof cmd.enabled !== 'boolean') throw new UnprocessableEntityException('enabled must be a boolean.');
    if (cmd.receiptQuotaEnforced != null && typeof cmd.receiptQuotaEnforced !== 'boolean') {
      throw new UnprocessableEntityException('receiptQuotaEnforced must be a boolean or null.');
    }
    if (!Number.isInteger(cmd.expectedVersion) || cmd.expectedVersion < 0) {
      throw new UnprocessableEntityException('expectedVersion must be a non-negative integer.');
    }
    if (cmd.monthlyLimit !== null && (
      !Number.isInteger(cmd.monthlyLimit)
      || cmd.monthlyLimit < 1
      || cmd.monthlyLimit > OCR_MONTHLY_LIMIT_MAX
    )) {
      throw new UnprocessableEntityException(`monthlyLimit must be null or an integer from 1 to ${OCR_MONTHLY_LIMIT_MAX}.`);
    }

    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${cmd.companyId}`}))`;
      await lockPlanTermCompany(tx, cmd.companyId);

      const company = await tx.company.findUnique({
        where: { id: cmd.companyId },
        select: { id: true, status: true },
      });
      if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);
      const lockError = partnerMetadataLockError(company.status);
      if (lockError) throw new UnprocessableEntityException(lockError);

      const existing = await tx.companyAiConfiguration.findUnique({
        where: { companyId: cmd.companyId },
        select: { ocrEnabled: true, ocrMonthlyLimit: true, receiptQuotaEnforced: true, ocrConfigVersion: true, updatedAt: true },
      });
      const before = {
        enabled: existing?.ocrEnabled ?? true,
        monthlyLimit: existing?.ocrMonthlyLimit ?? null,
        receiptQuotaEnforced: existing?.receiptQuotaEnforced ?? null,
        version: existing?.ocrConfigVersion ?? 0,
      };
      const receiptQuotaEnforced = cmd.receiptQuotaEnforced === undefined ? before.receiptQuotaEnforced : cmd.receiptQuotaEnforced;
      if (before.enabled === cmd.enabled && before.monthlyLimit === cmd.monthlyLimit && before.receiptQuotaEnforced === receiptQuotaEnforced) {
        return { ...before, updatedAt: existing?.updatedAt.toISOString() ?? null };
      }
      if (before.version !== cmd.expectedVersion) {
        throw new ConflictException({
          code: 'ocr_config_version_conflict',
          message: 'OCR configuration changed after it was loaded. Reload before saving again.',
          currentVersion: before.version,
        });
      }

      const saved = await tx.companyAiConfiguration.upsert({
        where: { companyId: cmd.companyId },
        create: {
          companyId: cmd.companyId,
          modelId: null,
          monthlyBudgetSatang: null,
          ocrEnabled: cmd.enabled,
          ocrMonthlyLimit: cmd.monthlyLimit,
          receiptQuotaEnforced,
          ocrConfigVersion: 1,
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        update: {
          ocrEnabled: cmd.enabled,
          ocrMonthlyLimit: cmd.monthlyLimit,
          receiptQuotaEnforced,
          ocrConfigVersion: { increment: 1 },
          updatedBySystemAdminUserId: cmd.requestingAdminUserId,
        },
        select: { ocrEnabled: true, ocrMonthlyLimit: true, receiptQuotaEnforced: true, ocrConfigVersion: true, updatedAt: true },
      });

      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_ocr_config.update',
          targetType: 'company',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            source: 'ADMIN_ADJUSTMENT',
            entryPoint: 'SYSTEM_PARTNER_ADMIN',
            fromEnabled: before.enabled,
            toEnabled: saved.ocrEnabled,
            fromMonthlyLimit: before.monthlyLimit,
            toMonthlyLimit: saved.ocrMonthlyLimit,
            fromReceiptQuotaEnforced: before.receiptQuotaEnforced,
            toReceiptQuotaEnforced: saved.receiptQuotaEnforced ?? null,
            fromVersion: before.version,
            toVersion: saved.ocrConfigVersion,
          },
        },
      });

      return {
        enabled: saved.ocrEnabled,
        monthlyLimit: saved.ocrMonthlyLimit,
        receiptQuotaEnforced: saved.receiptQuotaEnforced ?? null,
        version: saved.ocrConfigVersion,
        updatedAt: saved.updatedAt.toISOString(),
      };
    });
  }
}
