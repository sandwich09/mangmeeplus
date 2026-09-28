import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  todayCivilDate,
  utcDateToCivilDate,
  type PartnerCompanyDetailDto,
  type PatchCompanyIdentityRequest,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { CompanyIdentityUseCase } from '../../../data-model-core/application/use-cases/company-identity.use-case';
import {
  allowedChangeKinds,
  fieldLatchFromRevisions,
  type LegalIdentityField,
} from '../../../data-model-core/domain/logic/company-legal-identity.logic';
import { enqueueCustomerProfileSync } from '../../../billing/application/billing-company-profile';
import { partnerMetadataLockError } from '../../domain/logic/partner-lock.logic';
import { GetPartnerDetailUseCase } from './get-partner-detail.use-case';

export type UpdatePartnerIdentityCommand = {
  companyId: string;
  requestingAdminUserId: string;
  requestId: string;
  reason: string;
  supportRequestId?: string;
  body: PatchCompanyIdentityRequest;
};

const IDENTITY_FIELDS = ['taxId', 'registeredName', 'addressJson'] as const;

/**
 * Admin partner console: change the company's registered name, tax id and/or address (spec §18.2
 * R-E3, DQ9). Goes through `CompanyIdentityUseCase.patch` — the SAME single legal-identity writer
 * the company's own settings page uses (CAS on `legalIdentityVersion`, a
 * `CompanyLegalIdentityRevision` row, `company.legal_identity.update` CRITICAL audit) — with a
 * normal `changeKind`, not the reconciliation-repair path. Gated on
 * `system.identity_reconciliation.resolve` (DQ-E1=DQ9, Owner 2026-09-27), not
 * `system.partner_company.update`: legal identity is one path with revision/CAS/CRITICAL audit,
 * and this key already exists for System Admin.
 *
 * `CompanyIdentityUseCase.patch` reads only `ctx.userId`/`ctx.requestId` from its context param
 * (it never checks company membership — that is exactly why the customer-facing controller
 * (`company-identity.controller.ts`) gates it behind `assertRouteCompany`, which an admin route
 * must NOT do), so a synthetic context carrying only those two fields is enough and correct here —
 * the same pattern `billing-email-recipient.ts`'s `advance()` uses for its own worker-side call.
 */
@Injectable()
export class UpdatePartnerIdentityUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: CompanyIdentityUseCase,
    private readonly getDetail: GetPartnerDetailUseCase,
    private readonly config: AppConfigService,
  ) {}

  async execute(cmd: UpdatePartnerIdentityCommand): Promise<PartnerCompanyDetailDto> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: cmd.companyId },
      select: { status: true, planTerm: { select: { termDisabledAt: true } } },
    });
    if (!company) throw new NotFoundException(`Partner company "${cmd.companyId}" not found.`);
    const lockError = partnerMetadataLockError(company.status, Boolean(company.planTerm?.termDisabledAt));
    if (lockError) throw new UnprocessableEntityException(lockError);

    // 409 (stale legalIdentityVersion) and 422 (identity_change_kind_not_allowed / bad field
    // shape) from `patch` propagate unchanged — the console shows the same errors the company's
    // own settings page would.
    const { legalIdentityVersion, revisionId } = await this.identity.patch(
      { userId: cmd.requestingAdminUserId, requestId: cmd.requestId } as RequestContext,
      cmd.companyId,
      cmd.body,
    );

    await this.prisma.client.$transaction(async (tx) => {
      // Wrapped through AuditService-shaped sanitization by hand here (tx.auditLog.create, safe
      // keys only — no raw tax id/address/name value, matching CompanyIdentityUseCase's own audit).
      await tx.auditLog.create({
        data: {
          companyId: cmd.companyId,
          actorUserId: cmd.requestingAdminUserId,
          action: 'system.partner_company.identity_update',
          targetType: 'company',
          targetId: cmd.companyId,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            changeKind: cmd.body.changeKind,
            changedFields: IDENTITY_FIELDS.filter((field) => cmd.body[field] !== undefined),
            reason: cmd.reason,
            supportRequestId: cmd.supportRequestId ?? null,
            legalIdentityVersion,
            revisionId,
          },
        },
      });
      await enqueueCustomerProfileSync(tx, this.config, cmd.companyId, 'ปรับข้อมูลจดทะเบียนโดยทีมงาน',
        cmd.requestingAdminUserId, legalIdentityVersion);
    });

    return this.getDetail.execute(cmd.companyId);
  }

  /** For the console's GET: the version to echo back (CAS) and which change kinds to offer, without
   *  exposing the identity value itself (the detail read already carries the masked/full identity). */
  async getControl(companyId: string) {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { legalIdentityVersion: true, legalIdentityCaptureCompletedAt: true, lastLegalChangeEffectiveDate: true,
        legalIdentityAuthoritativeAt: true, timezone: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${companyId}" not found.`);
    const revisions = await this.prisma.client.companyLegalIdentityRevision.findMany({
      where: { companyId },
      orderBy: { legalIdentityVersion: 'asc' },
      select: { legalIdentityVersion: true, changeKind: true, snapshotJson: true },
    });
    const fieldLatched = fieldLatchFromRevisions(revisions);
    const context = {
      changedFields: [] as LegalIdentityField[],
      captureWindowOpen: company.legalIdentityCaptureCompletedAt === null,
      authoritativeLatched: company.legalIdentityAuthoritativeAt !== null,
      fieldLatched,
      lastLegalChangeEffectiveDate: company.lastLegalChangeEffectiveDate ? utcDateToCivilDate(company.lastLegalChangeEffectiveDate) : null,
      today: todayCivilDate(company.timezone),
    };
    return {
      legalIdentityVersion: company.legalIdentityVersion,
      captureWindowOpen: context.captureWindowOpen,
      authoritativeLatched: context.authoritativeLatched,
      fieldLatched,
      allowedChangeKinds: allowedChangeKinds(context),
    };
  }
}
