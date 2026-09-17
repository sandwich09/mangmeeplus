import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  civilDateToUtcDate,
  todayCivilDate,
  normalizeCompanyBusinessType,
  type PatchCompanyBusinessTypeRequest,
  utcDateToCivilDate,
  type CompanyIdentityResponse,
  type CompanyLegalAddress,
  type PatchCompanyIdentityRequest,
} from '@watchdog-bms/contracts';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  allowedChangeKinds,
  changedIdentityFields,
  fieldLatchFromRevisions,
  normalizeTaxId,
  rejectLegalIdentityChange,
  validateLegalAddress,
  type LegalIdentityField,
} from '../../domain/logic/company-legal-identity.logic';
import {
  sellerIdentityComplete,
  sellerIdentityCompleteHO,
  taxInvoiceEligible,
} from '../../domain/logic/company-tax-readiness.logic';
import { effectiveVatStatus } from '../../domain/logic/company-vat-registration.logic';
import { maskTaxId } from '../../domain/logic/identity-reconciliation.logic';

/**
 * Company legal tax identity (spec §4.4).
 *
 * The response is assembled per permission and a section the caller may not see is ABSENT from
 * the DTO — not null, not an empty object. `readiness.vat` missing means "you cannot see this";
 * `readiness.vat.eligible === false` means "this company cannot issue". Step 5 of the wizard
 * renders them differently, and collapsing them would tell a permission-less user their company
 * is not allowed to issue tax invoices, which nobody established.
 */
@Injectable()
export class CompanyIdentityUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(ctx: RequestContext, companyId: string): Promise<CompanyIdentityResponse> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: {
        id: true, name: true, registeredName: true, taxId: true, addressJson: true,
        businessTypeCode: true, businessTypeOther: true, businessTypeVersion: true,
        legalIdentityVersion: true, legalIdentityCaptureCompletedAt: true, lastLegalChangeEffectiveDate: true,
        legalIdentityAuthoritativeAt: true, legalIdentityAuthoritativeReason: true, legalIdentityAuthoritativeRef: true,
        tinExistsStatus: true, tinExistsAt: true, vatDetailStatus: true, vatDetailAt: true,
        vatDetailSelectedBranchCode: true, verificationLastAttemptStatus: true, verificationLastAttemptAt: true,
        timezone: true,
      },
    });
    if (!company) throw new NotFoundException(`Company ${companyId} not found`);

    const [revisions, branches, facts, prompt, vatState] = await Promise.all([
      this.prisma.client.companyLegalIdentityRevision.findMany({
        where: { companyId },
        orderBy: { legalIdentityVersion: 'asc' },
        select: { legalIdentityVersion: true, changeKind: true, snapshotJson: true },
      }),
      this.prisma.client.branch.findMany({
        where: { companyId },
        select: { id: true, name: true, type: true, status: true, isVatEstablishment: true, taxBranchCode: true, addressJson: true },
      }),
      this.prisma.client.companyVatRegistrationFact.findMany({
        where: { companyId },
        select: { id: true, status: true, effectiveFrom: true, effectiveTo: true, supersededAt: true, answeredAt: true },
        // Same order as the VAT endpoint's own load. Two readers of one fact history must not
        // disagree because they sorted differently.
        orderBy: [{ effectiveFrom: 'asc' }, { answeredAt: 'asc' }],
      }),
      this.prisma.client.vatRegistrationPrompt.findFirst({ where: { companyId, resolvedAt: { not: null } } }),
      this.prisma.client.companyVatRegistrationState.findUnique({ where: { companyId } }),
    ]);

    const can = (key: string) => ctx.permissions.includes(key);
    const today = todayCivilDate(company.timezone);
    const factRows = facts.map((fact) => ({
      id: fact.id,
      status: fact.status,
      effectiveFrom: utcDateToCivilDate(fact.effectiveFrom),
      effectiveTo: fact.effectiveTo ? utcDateToCivilDate(fact.effectiveTo) : null,
      supersededAt: fact.supersededAt,
      answeredAt: fact.answeredAt,
    }));
    const vatStatus = effectiveVatStatus(factRows, today);
    const promptResolved = prompt !== null;
    const readinessBranches = branches.map((branch) => ({ ...branch, addressJson: branch.addressJson }));
    const identityReadiness = sellerIdentityCompleteHO(company, readinessBranches, promptResolved);

    // The control block always ships: the wizard needs the version as its compare-and-set token
    // and the latch booleans to decide which change kinds to offer. It carries no identity value.
    const response: CompanyIdentityResponse = {
      control: {
        legalIdentityVersion: company.legalIdentityVersion,
        captureWindowOpen: company.legalIdentityCaptureCompletedAt === null,
        authoritativeLatched: company.legalIdentityAuthoritativeAt !== null,
        fieldLatched: fieldLatchFromRevisions(revisions),
      },
      readiness: {
        identity: {
          complete: identityReadiness.complete,
          // A caller who cannot read the VAT section must not learn its state through a reason.
          reasons: can('company.vat_registration.read')
            ? identityReadiness.reasons
            : identityReadiness.reasons.filter((reason) => reason !== 'vat_status_unanswered'),
        },
      },
    };

    response.identity = can('company.legal_identity.read')
      ? {
          masked: false,
          businessType: { code: company.businessTypeCode ?? null, other: company.businessTypeOther ?? null, version: company.businessTypeVersion ?? 0 },
          displayName: company.name,
          registeredName: company.registeredName,
          taxId: company.taxId,
          addressJson: (company.addressJson as CompanyLegalAddress | null) ?? null,
          lastLegalChangeEffectiveDate: company.lastLegalChangeEffectiveDate
            ? utcDateToCivilDate(company.lastLegalChangeEffectiveDate)
            : null,
          legalIdentityAuthoritativeAt: company.legalIdentityAuthoritativeAt?.toISOString() ?? null,
          legalIdentityAuthoritativeReason: company.legalIdentityAuthoritativeReason,
          legalIdentityAuthoritativeRef: company.legalIdentityAuthoritativeRef,
          tinExistsStatus: company.tinExistsStatus,
          tinExistsAt: company.tinExistsAt?.toISOString() ?? null,
          vatDetailStatus: company.vatDetailStatus,
          vatDetailAt: company.vatDetailAt?.toISOString() ?? null,
          vatDetailSelectedBranchCode: company.vatDetailSelectedBranchCode,
          verificationLastAttemptStatus: company.verificationLastAttemptStatus,
          verificationLastAttemptAt: company.verificationLastAttemptAt?.toISOString() ?? null,
        }
      : {
          masked: true,
          displayName: company.name,
          registeredName: company.registeredName,
          taxIdLast4: maskTaxId(company.taxId),
          addressProvince: ((company.addressJson as Record<string, unknown> | null)?.province as string) ?? null,
        };

    if (can('company.vat_registration.read')) {
      const current = factRows.find(
        (fact) => !fact.supersededAt && fact.effectiveFrom <= today && (fact.effectiveTo === null || today < fact.effectiveTo),
      );
      response.vatRegistration = {
        status: vatStatus,
        ...(current ? { effectiveFrom: current.effectiveFrom } : {}),
        ...(current?.effectiveTo ? { effectiveTo: current.effectiveTo } : {}),
        version: vatState?.version ?? 0,
        vatRegistered: vatStatus === 'REGISTERED',
        vatEffectiveDate: current?.effectiveFrom ?? null,
      };
      response.readiness.vat = { eligible: taxInvoiceEligible(vatStatus), status: vatStatus };
    }

    if (can('company.branch.read')) {
      response.branches = branches.map((branch) => ({
        branchId: branch.id,
        name: branch.name,
        isVatEstablishment: branch.isVatEstablishment,
        taxBranchCode: branch.taxBranchCode,
        hasOwnAddress: branch.addressJson !== null,
        isHeadOffice: branch.type === 'HEAD_OFFICE',
        isActive: branch.status === 'ACTIVE',
      }));
      response.readiness.branches = {
        headOfficeReady: identityReadiness.complete,
        incompleteEstablishmentBranchIds: branches
          .filter(
            (branch) =>
              branch.status === 'ACTIVE' &&
              branch.isVatEstablishment &&
              !sellerIdentityComplete(company, branch, promptResolved).complete,
          )
          .map((branch) => branch.id),
      };
    }

    return response;
  }

  async patchBusinessType(ctx: RequestContext, companyId: string, body: PatchCompanyBusinessTypeRequest) {
    let value;
    try { value = normalizeCompanyBusinessType(body.code, body.other); }
    catch (error) { throw new UnprocessableEntityException({ code: (error as Error).message }); }
    if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 0) {
      throw new UnprocessableEntityException('expectedVersion must be a non-negative integer');
    }
    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.company.updateMany({
        where: { id: companyId, businessTypeVersion: body.expectedVersion },
        data: { businessTypeCode: value.code, businessTypeOther: value.other, businessTypeVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('company_business_type_version_conflict');
      await this.audit.log({
        companyId, actorUserId: ctx.userId, action: 'company.business_type.update',
        targetType: 'company', targetId: companyId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'LOW',
        metadataJson: { businessTypeVersion: body.expectedVersion + 1, otherProvided: value.other !== null },
      }, tx);
      return { ...value, version: body.expectedVersion + 1 };
    });
  }

  async patch(ctx: RequestContext, companyId: string, body: PatchCompanyIdentityRequest) {
    const normalized = this.normalizeBody(body);

    return this.prisma.client.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: {
          taxId: true, registeredName: true, addressJson: true, timezone: true,
          legalIdentityVersion: true, legalIdentityCaptureCompletedAt: true,
          lastLegalChangeEffectiveDate: true, legalIdentityAuthoritativeAt: true,
        },
      });
      if (!company) throw new NotFoundException(`Company ${companyId} not found`);
      if (company.legalIdentityVersion !== body.expectedLegalIdentityVersion) {
        throw new ConflictException('legalIdentityVersion is stale; reload and retry');
      }

      const revisions = await tx.companyLegalIdentityRevision.findMany({
        where: { companyId },
        orderBy: { legalIdentityVersion: 'asc' },
        select: { legalIdentityVersion: true, changeKind: true, snapshotJson: true },
      });

      const changedFields = changedIdentityFields(company, normalized);
      const context = {
        changedFields,
        captureWindowOpen: company.legalIdentityCaptureCompletedAt === null,
        authoritativeLatched: company.legalIdentityAuthoritativeAt !== null,
        fieldLatched: fieldLatchFromRevisions(revisions),
        lastLegalChangeEffectiveDate: company.lastLegalChangeEffectiveDate
          ? utcDateToCivilDate(company.lastLegalChangeEffectiveDate)
          : null,
        today: todayCivilDate(company.timezone),
      };

      const rejection = rejectLegalIdentityChange(body, context);
      if (rejection) {
        throw new UnprocessableEntityException(
          rejection.code === 'identity_change_kind_not_allowed'
            ? {
                code: 'identity_change_kind_not_allowed',
                message: rejection.reason,
                details: { allowedChangeKinds: allowedChangeKinds(context) },
              }
            : rejection.reason,
        );
      }

      const nextVersion = company.legalIdentityVersion + 1;
      const taxIdChanged = changedFields.includes('taxId');
      const nextIdentity = {
        taxId: normalized.taxId ?? company.taxId,
        registeredName: normalized.registeredName ?? company.registeredName,
        addressJson: (normalized.addressJson ?? company.addressJson ?? null) as CompanyLegalAddress | null,
      };

      await tx.company.update({
        where: { id: companyId },
        data: {
          ...(normalized.taxId !== undefined ? { taxId: normalized.taxId } : {}),
          ...(normalized.registeredName !== undefined ? { registeredName: normalized.registeredName } : {}),
          ...(normalized.addressJson !== undefined ? { addressJson: normalized.addressJson as Prisma.InputJsonValue } : {}),
          legalIdentityVersion: nextVersion,
          ...(body.changeKind === 'LEGAL_CHANGE'
            ? { lastLegalChangeEffectiveDate: civilDateToUtcDate(body.effectiveFrom!) }
            : {}),
          // A new number invalidates every verification of the old one. The authoritative latch
          // is deliberately NOT cleared: the evidence happened, whatever the row says today.
          ...(taxIdChanged
            ? {
                tinExistsStatus: null, tinExistsAt: null, tinSubjectHmac: null, tinSubjectHmacKeyVersion: null,
                vatDetailStatus: null, vatDetailAt: null, vatDetailSelectedBranchCode: null, vatDetailSnapshotJson: Prisma.DbNull,
                verificationLastAttemptStatus: null, verificationLastAttemptAt: null,
              }
            : {}),
        },
      });

      // Documented legacy mirror, Release A through B1 only (§4.5). Only the tax id and the
      // actor: the profile also holds branch policy, period and reviewer settings that this
      // route has no business overwriting.
      if (normalized.taxId !== undefined) {
        await tx.companyTaxProfile.upsert({
          where: { companyId },
          create: { companyId, taxId: normalized.taxId, updatedByUserId: ctx.userId },
          update: { taxId: normalized.taxId, updatedByUserId: ctx.userId },
        });
      }

      const revision = await tx.companyLegalIdentityRevision.create({
        data: {
          companyId,
          legalIdentityVersion: nextVersion,
          snapshotJson: nextIdentity as unknown as Prisma.InputJsonValue,
          changeKind: body.changeKind,
          effectiveFrom: body.changeKind === 'LEGAL_CHANGE' ? civilDateToUtcDate(body.effectiveFrom!) : null,
          correctionReason: body.changeKind === 'CORRECTION' ? body.correctionReason : null,
          note: body.note ?? null,
          evidenceRef: body.evidenceRef ?? null,
          actorUserId: ctx.userId,
        },
        select: { id: true },
      });

      // Safe keys only (§15): last four of each number, which fields moved, never a raw value.
      await this.audit.log(
        {
          companyId,
          actorUserId: ctx.userId,
          action: 'company.legal_identity.update',
          targetType: 'company',
          targetId: companyId,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            changeKind: body.changeKind,
            changedFields,
            subjectLast4Prev: maskTaxId(company.taxId),
            subjectLast4Next: maskTaxId(nextIdentity.taxId),
            registeredNameChanged: changedFields.includes('registeredName'),
            addressFieldsChanged: changedFields.includes('addressJson'),
          },
        },
        tx,
      );

      return { legalIdentityVersion: nextVersion, revisionId: revision.id };
    });
  }

  /**
   * Closes the capture window (§4.4). Write-once and idempotent: closing an already-closed
   * window answers 200 with the same body rather than 409, because a double-click on the last
   * step of a wizard is not a conflict.
   */
  async completeCapture(ctx: RequestContext, companyId: string, expectedLegalIdentityVersion: number) {
    return this.prisma.client.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: {
          taxId: true, registeredName: true, addressJson: true,
          legalIdentityVersion: true, legalIdentityCaptureCompletedAt: true,
        },
      });
      if (!company) throw new NotFoundException(`Company ${companyId} not found`);
      if (company.legalIdentityCaptureCompletedAt !== null) {
        return { legalIdentityVersion: company.legalIdentityVersion, captureWindowOpen: false as const };
      }
      if (company.legalIdentityVersion !== expectedLegalIdentityVersion) {
        throw new ConflictException('legalIdentityVersion is stale; reload and retry');
      }

      const [branches, prompt] = await Promise.all([
        tx.branch.findMany({
          where: { companyId },
          select: { id: true, type: true, status: true, isVatEstablishment: true, taxBranchCode: true, addressJson: true },
        }),
        tx.vatRegistrationPrompt.findFirst({ where: { companyId, resolvedAt: { not: null } } }),
      ]);
      const readiness = sellerIdentityCompleteHO(company, branches, prompt !== null);
      if (!readiness.complete) {
        // Closing the window over incomplete data would strand the company: INITIAL_CAPTURE is
        // refused forever afterwards, so the missing pieces could only be added as legal changes.
        throw new UnprocessableEntityException({
          code: 'company_tax_identity_incomplete',
          message: 'the company identity is not complete yet',
          details: { reasons: readiness.reasons },
        });
      }

      const updated = await tx.company.updateMany({
        where: { id: companyId, legalIdentityCaptureCompletedAt: null },
        data: { legalIdentityCaptureCompletedAt: new Date() },
      });
      if (updated.count > 0) {
        await this.audit.log(
          {
            companyId,
            actorUserId: ctx.userId,
            action: 'company.legal_identity.capture_completed',
            targetType: 'company',
            targetId: companyId,
            requestId: ctx.requestId,
            result: 'SUCCESS',
            riskLevel: 'CRITICAL',
            metadataJson: { closedBy: 'USER_CONFIRM' },
          },
          tx,
        );
      }
      return { legalIdentityVersion: company.legalIdentityVersion, captureWindowOpen: false as const };
    });
  }

  private normalizeBody(body: PatchCompanyIdentityRequest): {
    taxId?: string;
    registeredName?: string;
    addressJson?: CompanyLegalAddress;
  } {
    const normalized: { taxId?: string; registeredName?: string; addressJson?: CompanyLegalAddress } = {};
    if (body.taxId !== undefined) {
      const digits = normalizeTaxId(body.taxId);
      if (!/^\d{13}$/.test(digits)) throw new UnprocessableEntityException('taxId must be 13 digits');
      normalized.taxId = digits;
    }
    if (body.registeredName !== undefined) {
      const trimmed = body.registeredName.trim();
      if (!trimmed || trimmed.length > 255) {
        throw new UnprocessableEntityException('registeredName must be 1-255 characters');
      }
      normalized.registeredName = trimmed;
    }
    if (body.addressJson !== undefined) {
      const result = validateLegalAddress(body.addressJson);
      if (!result.ok) throw new UnprocessableEntityException({ message: 'invalid addressJson', details: result.errors });
      normalized.addressJson = result.value;
    }
    if (Object.keys(normalized).length === 0) {
      throw new UnprocessableEntityException('at least one identity field must be supplied');
    }
    return normalized;
  }
}

export type { LegalIdentityField };
