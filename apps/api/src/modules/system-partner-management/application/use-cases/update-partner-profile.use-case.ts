import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import type { PartnerCompanyDetailDto, UpdatePartnerProfileDto } from '@watchdog-bms/contracts';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
import { enqueueCustomerProfileSync } from '../../../billing/application/billing-company-profile';
import { GetPartnerDetailUseCase } from './get-partner-detail.use-case';

export type UpdatePartnerProfileCommand = UpdatePartnerProfileDto & {
  companyId: string;
  requestingAdminUserId: string;
  requestId: string;
};

@Injectable()
export class UpdatePartnerProfileUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly getDetail: GetPartnerDetailUseCase,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: UpdatePartnerProfileCommand): Promise<PartnerCompanyDetailDto> {
    const existing = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId },
      select: { id: true, status: true, name: true, brandName: true, timezone: true, locale: true, phone: true, email: true,
        planTerm: { select: { termDisabledAt: true } } },
    });
    if (!existing) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    // R-E3/RV26: a shop the sweep disabled for a run-out term may still have its own contact info
    // fixed (admin hold and ARCHIVED keep the full freeze).
    const lockError = partnerMetadataLockError(existing.status, Boolean(existing.planTerm?.termDisabledAt));
    if (lockError) throw new UnprocessableEntityException(lockError);

    const changedFields: string[] = [];
    const data: Record<string, unknown> = {};
    for (const field of ['name', 'brandName', 'timezone', 'locale', 'phone', 'email'] as const) {
      if (cmd[field] !== undefined && cmd[field] !== existing[field]) {
        data[field] = cmd[field];
        changedFields.push(field);
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.company.update({ where: { id: cmd.companyId }, data });
      await tx.auditLog.create({
        data: {
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_company.update',
          targetType: 'company',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'MEDIUM',
          metadataJson: { changedFields },
        },
      });
      // R-A2: Company.name is the billing profile's fallback name (companyBillingProfile) when
      // there is no registered name, so a display-name change may change what Stripe should show.
      // Company has no profile-version counter to key on, so the request id anchors idempotency
      // (a lost-response retry of the same PATCH carries the same requestId; the next edit does not).
      if (changedFields.includes('name')) {
        await enqueueCustomerProfileSync(tx, this.config, cmd.companyId, 'ปรับชื่อบริษัทโดยทีมงาน',
          cmd.requestingAdminUserId, `profile-${cmd.requestId}`);
      }
    });

    return this.getDetail.execute(cmd.companyId);
  }
}
