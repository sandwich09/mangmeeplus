import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { PartnerCompanyDetailDto, UpdatePartnerProfileDto } from '@watchdog-bms/contracts';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
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
  ) {}

  async execute(cmd: UpdatePartnerProfileCommand): Promise<PartnerCompanyDetailDto> {
    const existing = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId },
      select: { id: true, status: true, name: true, brandName: true, timezone: true, locale: true, phone: true, email: true },
    });
    if (!existing) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    const lockError = partnerMetadataLockError(existing.status);
    if (lockError) throw new UnprocessableEntityException(lockError);

    const changedFields: string[] = [];
    const data: Record<string, unknown> = {};
    for (const field of ['name', 'brandName', 'timezone', 'locale', 'phone', 'email'] as const) {
      if (cmd[field] !== undefined && cmd[field] !== existing[field]) {
        data[field] = cmd[field];
        changedFields.push(field);
      }
    }

    await this.prisma.client.$transaction([
      this.prisma.client.company.update({ where: { id: cmd.companyId }, data }),
      this.prisma.client.auditLog.create({
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
      }),
    ]);

    return this.getDetail.execute(cmd.companyId);
  }
}
