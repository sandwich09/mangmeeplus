import { Injectable } from '@nestjs/common';
import { lineIntakeContactComplete } from '../domain/line-signup.logic';
import type {
  LineSignupEligibleCompanyDto,
  LineSignupIntent,
  LineSignupReviewResolution,
  LineSignupStatusDto,
  PlanTermLockReason,
  SignupDiscoverySource,
} from '@watchdog-bms/contracts';
import type { CompanySignupRequest } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { LineIdTokenService } from '../../auth/application/line-id-token.service';
import { AuthRateLimitService } from '../../auth/application/auth-rate-limit.service';
import { isBusinessHours } from '../domain/business-hours.logic';
import { SIGNUP_SOURCE_LINE_OA } from '../domain/company-signup.logic';
import { canManagePlan } from '../../access-control/domain/logic/plan-manager.logic';
import { planTermLockReason } from '../../system-partner-management/domain/logic/plan-term.logic';

export type VerifiedLineSignupIdentity = Readonly<{ providerUserId: string; channelId: string }>;

const INTAKE_STATES = new Set(['RECEIVED', 'VALIDATED']);
const EDITABLE_STATES = new Set(['RECEIVED', 'VALIDATED', 'PENDING_REVIEW']);
const RESOLUTIONS = new Set<LineSignupReviewResolution>([
  'NEW_SHOP', 'RETURN_EXISTING', 'REQUEST_INFO', 'PLAN_REVIEW',
]);

/** Shared by GET, submit, and correction so every LIFF render receives the same truth. */
export async function lineSignupStatusForVerified(
  prisma: PrismaService,
  config: AppConfigService,
  verified: VerifiedLineSignupIdentity,
  now = new Date(),
  selectedRequestId?: string,
): Promise<LineSignupStatusDto> {
  const identity = await prisma.client.externalIdentity.findFirst({
    where: {
      provider: 'LINE',
      providerUserId: verified.providerUserId,
      providerChannelId: verified.channelId,
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
    },
    select: { userId: true },
  });
  const [request, memberships] = await Promise.all([
    prisma.client.companySignupRequest.findFirst({
      where: {
        ...(selectedRequestId ? { id: selectedRequestId } : {}),
        source: SIGNUP_SOURCE_LINE_OA,
        lineProviderUserId: verified.providerUserId,
        lineChannelId: verified.channelId,
      },
      orderBy: { createdAt: 'desc' },
    }),
    identity
      ? prisma.client.companyMembership.findMany({
          where: {
            userId: identity.userId,
            status: 'ACTIVE',
            roles: { some: { role: { status: 'ACTIVE' } } },
            OR: [
              { company: { status: 'ACTIVE' } },
              { company: { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } } },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: {
            companyId: true,
            company: { select: { name: true, status: true, planTerm: { select: { termStartAt: true, termEndsAt: true, renewCount: true } } } },
            // Only what `canManagePlan` reads; the `some` filter above already keeps ACTIVE roles.
            roles: { where: { role: { status: 'ACTIVE' } }, select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } },
          },
        })
      : Promise.resolve([]),
  ]);
  const businessHours = isBusinessHours(now, {
    days: config.lineSignupBusinessDays,
    hours: config.lineSignupBusinessHours,
  });
  const eligibleCompanies: LineSignupEligibleCompanyDto[] = memberships.map((membership) => {
    const locked = membership.company.status !== 'ACTIVE';
    return {
      companyId: membership.companyId,
      companyName: membership.company.name,
      status: locked ? 'EXPIRED' as const : 'ACTIVE' as const,
      canEnter: !locked,
      // R-C2 (§18.2): display fields for a locked shop only, so an ACTIVE row keeps its exact shape.
      ...(locked ? {
        lockReason: membership.company.planTerm ? planTermLockReason(membership.company.planTerm) : 'trial_ended' as const,
        canManagePlan: canManagePlan(membership.roles),
      } : {}),
    };
  });
  return {
    progress: request ? toProgress(request, identity !== null, businessHours, verified, eligibleCompanies) : null,
    eligibleCompanies,
  };
}

function toProgress(
  request: CompanySignupRequest,
  existingAccount: boolean,
  businessHours: boolean,
  verified: VerifiedLineSignupIdentity,
  eligibleCompanies: Array<{ companyId: string; canEnter: boolean; lockReason?: PlanTermLockReason }>,
) {
  const resolution = RESOLUTIONS.has(request.reviewResolution as LineSignupReviewResolution)
    ? request.reviewResolution as LineSignupReviewResolution
    : undefined;
  const intent: LineSignupIntent = request.lineSignupIntent === 'ADD_SHOP' ? 'ADD_SHOP' : 'FIRST_SHOP';
  const storedEntryCompanyId = resolution === 'RETURN_EXISTING'
    ? request.resolvedExistingCompanyId
    : request.companyId;
  const entryCompanyId = storedEntryCompanyId
    && eligibleCompanies.some((company) => company.companyId === storedEntryCompanyId && company.canEnter)
    ? storedEntryCompanyId
    : undefined;
  // The same stored shop when it exists but is locked: the page names the next step (choose a
  // package) instead of "cannot enter". Display only — `entryCompanyId` above stays the grant.
  const lockedEntryCompanyId = !entryCompanyId && storedEntryCompanyId
    && eligibleCompanies.some((company) => company.companyId === storedEntryCompanyId && !company.canEnter && company.lockReason)
    ? storedEntryCompanyId
    : undefined;
  const sideEffectsStarted = request.companyId !== null
    || request.resolvedExistingCompanyId !== null
    || request.provisioningAttemptId !== null;
  return {
    requestId: request.id,
    submissionId: lineSubmissionIdFromExternalId(request.externalSignupId, verified),
    version: request.version,
    state: request.state,
    companyName: request.companyName,
    phoneNumber: request.phoneNumber ?? '',
    contactEmail: request.contactEmail ?? '',
    ...(request.referralCode ? { referralCode: request.referralCode } : {}),
    discoverySource: (request.discoverySource as SignupDiscoverySource | null) ?? undefined,
    discoverySourceOther: request.discoverySource === 'OTHER' ? request.discoverySourceOther ?? undefined : undefined,
    intent,
    ...(resolution ? { resolution } : {}),
    ...(resolution === 'REQUEST_INFO' && request.resolutionNote
      ? { requestedInformation: request.resolutionNote }
      : {}),
    existingAccount,
    businessHours,
    canRetryIntake: !sideEffectsStarted && resolution === undefined
      && lineIntakeContactComplete(request) && INTAKE_STATES.has(request.state),
    canUpdateContactEmail: !sideEffectsStarted && !request.autoApproved
      && request.reviewResolution !== 'NEW_SHOP' && EDITABLE_STATES.has(request.state),
    companyCreated: request.companyId !== null,
    ...(entryCompanyId ? { entryCompanyId } : {}),
    ...(lockedEntryCompanyId ? { lockedEntryCompanyId } : {}),
  };
}

export function lineSubmissionIdFromExternalId(
  externalSignupId: string,
  verified: VerifiedLineSignupIdentity,
): string {
  const prefix = `line:${verified.channelId}:${verified.providerUserId}:`;
  return externalSignupId.startsWith(prefix) ? externalSignupId.slice(prefix.length) : externalSignupId;
}

/**
 * P10-L “สถานะของฉัน”. The token proves the account; the response can therefore include its own
 * editable request fields and live memberships, while never revealing an email-matched stranger.
 */
@Injectable()
export class GetLineSignupStatusUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly lineIdToken: LineIdTokenService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  async execute(idToken: string, now = new Date()): Promise<LineSignupStatusDto> {
    const verified = await this.lineIdToken.verify(idToken);
    await this.rateLimit.assertLineSignupReadUserAllowed(verified.providerUserId);
    return lineSignupStatusForVerified(this.prisma, this.config, verified, now);
  }
}
