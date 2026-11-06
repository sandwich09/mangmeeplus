import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { isReportClassification, isReportIndustryGroup, type PartnerCompanyDetailDto, type UpdatePartnerProfileDto } from '@watchdog-bms/contracts';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
import { reportClassificationOf } from '../../domain/logic/report-labels.logic';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';
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
        reportClassification: true, reportIndustryGroup: true, planTerm: { select: { termDisabledAt: true } } },
    });
    if (!existing) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);

    // R-E3/RV26: a shop the sweep disabled for a run-out term may still have its own contact info
    // fixed (admin hold and ARCHIVED keep the full freeze). The report labels are not the shop's
    // metadata: every company is counted whatever its state, so a held or archived one is labelled too.
    const profileFields = ['name', 'brandName', 'timezone', 'locale', 'phone', 'email'] as const;
    const lockError = partnerMetadataLockError(existing.status, Boolean(existing.planTerm?.termDisabledAt));
    if (lockError && profileFields.some((field) => cmd[field] !== undefined)) throw new UnprocessableEntityException(lockError);

    const changedFields: string[] = [];
    const data: Record<string, unknown> = {};
    for (const field of profileFields) {
      if (cmd[field] !== undefined && cmd[field] !== existing[field]) {
        data[field] = cmd[field];
        changedFields.push(field);
      }
    }
    // Executive spec §12.2, §15 (Q16, Q26). Who chose the classification and when are kept on the row;
    // the audit row below records both labels' before and after.
    const labels: Record<string, { from: string | null; to: string | null }> = {};
    if (cmd.reportClassification !== undefined) {
      if (existing.reportClassification === 'DEMO' || (cmd.reportClassification !== null && (!isReportClassification(cmd.reportClassification) || cmd.reportClassification === 'DEMO'))) throw new UnprocessableEntityException('ประเภทบริษัทสำหรับรายงานไม่ถูกต้อง');
      if (cmd.companyId === PLATFORM_TENANT_ID && cmd.reportClassification !== 'INTERNAL') {
        throw new UnprocessableEntityException('บริษัทของระบบเป็นประเภทภายในเสมอ');
      }
      const before = reportClassificationOf(existing);
      if (cmd.reportClassification !== before || existing.reportClassification !== before) {
        Object.assign(data, { reportClassification: cmd.reportClassification, reportClassifiedAt: new Date(), reportClassifiedByUserId: cmd.requestingAdminUserId });
        changedFields.push('reportClassification');
        labels.reportClassification = { from: before, to: cmd.reportClassification };
      }
    }
    if (cmd.reportIndustryGroup !== undefined) {
      if (cmd.reportIndustryGroup !== null && !isReportIndustryGroup(cmd.reportIndustryGroup)) throw new UnprocessableEntityException('กลุ่มธุรกิจสำหรับรายงานไม่ถูกต้อง');
      if (cmd.reportIndustryGroup !== existing.reportIndustryGroup) {
        data.reportIndustryGroup = cmd.reportIndustryGroup;
        changedFields.push('reportIndustryGroup');
        labels.reportIndustryGroup = { from: existing.reportIndustryGroup, to: cmd.reportIndustryGroup };
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
          metadataJson: { changedFields, ...labels },
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
