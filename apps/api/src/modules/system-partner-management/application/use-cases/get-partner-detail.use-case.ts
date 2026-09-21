import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import {
  PLATFORM_INVARIANT_FEATURE_KEYS,
  COMPANY_LEGAL_ADDRESS_KEYS,
  parentFeatureKey,
  type LineContextHealth,
  type PartnerCompanyDetailDto,
  type SignupDiscoverySource,
  type SalesReferralSource,
} from '@watchdog-bms/contracts';
import { isCurrentEntitlementNormalization } from '../../../employee-access/application/normalize-entitlements';
import { CompanyVatRegistrationUseCase } from '../../../data-model-core/application/use-cases/company-vat-registration.use-case';

const PLATFORM_DISABLE_REASON = 'ฟีเจอร์พื้นฐานของระบบปิดไม่ได้';

@Injectable()
export class GetPartnerDetailUseCase {
  constructor(
    private readonly prisma: PrismaService,
    // Reused rather than re-reading the facts here: one accessor, one answer. The admin console
    // and the company's own VAT endpoint must never disagree about a company's status.
    private readonly vatRegistration: CompanyVatRegistrationUseCase,
  ) {}

  async execute(companyId: string): Promise<PartnerCompanyDetailDto> {
    // ponytail: explicit select — zero business-table fields fetched
    const c = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        registeredName: true,
        brandName: true,
        taxId: true,
        addressJson: true,
        businessTypeCode: true,
        businessTypeOther: true,
        businessTypeVersion: true,
        timezone: true,
        locale: true,
        baseCurrency: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
        activatedAt: true,
        disabledAt: true,
        archivedAt: true,
        // D6 attribution. The agent's NAME comes from User; nothing from SalesAgentProfile except
        // the public sales code — no payroll PII ever reaches this console view (S10).
        referralSalesUserId: true,
        referredAt: true,
        referralSource: true,
        signupRequests: {
          // Read the original company-linked signup, including completed/archived shops.
          // A later return-to-existing request must not replace acquisition attribution.
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { discoverySource: true, discoverySourceOther: true },
        },
        featureEntitlements: {
          select: { featureKey: true, enabled: true, updatedAt: true },
          orderBy: { featureKey: 'asc' },
        },
        aiConfiguration: { select: { modelId: true, updatedAt: true } },
        entitlementSet: { select: { setVersion: true } },
        entitlementNormalization: {
          select: { status: true, normalizerVersion: true, cohortKind: true },
        },
        memberships: {
          where: { status: 'ACTIVE' },
          select: {
            userId: true,
            user: {
              select: {
                externalIdentities: {
                  where: { provider: 'LINE', status: 'ACTIVE' },
                  select: { providerUserId: true },
                },
              },
            },
          },
        },
      },
    });

    if (!c) throw new NotFoundException(`Partner company "${companyId}" not found.`);

    const signup = c.signupRequests[0];
    const address = c.addressJson && typeof c.addressJson === 'object' && !Array.isArray(c.addressJson) ? c.addressJson : {};

    const vat = await this.vatRegistration.get(companyId);
    const vatRegistration = {
      status: vat.status,
      ...(vat.effectiveFrom ? { effectiveFrom: vat.effectiveFrom } : {}),
      version: vat.version,
    };

    // Compute lineContextHealth from membership + LINE identities
    const linkedLineUserIds = c.memberships
      .flatMap((m) => m.user.externalIdentities.map((e) => e.providerUserId));

    let lineContextHealth: LineContextHealth = 'UNLINKED';
    if (linkedLineUserIds.length > 0) {
      // Check if any linked LINE user has multiple memberships (needs selection)
      const multiCompanyUsers = await this.prisma.client.companyMembership.groupBy({
        by: ['userId'],
        where: { userId: { in: c.memberships.map((m) => m.userId) }, status: 'ACTIVE' },
        _count: { companyId: true },
        having: { companyId: { _count: { gt: 1 } } },
      });
      const multiIds = new Set(multiCompanyUsers.map((r) => r.userId));
      const needsSelection = c.memberships.some((m) => multiIds.has(m.userId));
      lineContextHealth = needsSelection ? 'NEEDS_COMPANY_SELECTION' : 'LINKED';
    }

    // Resolved after the main read: a company whose credited agent was since deleted shows no
    // referral rather than a half-filled one the console cannot act on.
    const referralAgent = c.referralSalesUserId
      ? await this.prisma.client.salesAgentProfile.findUnique({
        where: { userId: c.referralSalesUserId }, select: { userId: true, salesCode: true },
      })
      : null;
    const referralUser = referralAgent
      ? await this.prisma.client.user.findUnique({ where: { id: referralAgent.userId }, select: { displayName: true } })
      : null;
    const referralSales: PartnerCompanyDetailDto['referralSales'] = referralAgent
      ? {
        userId: referralAgent.userId,
        displayName: referralUser?.displayName ?? '',
        salesCode: referralAgent.salesCode,
        referredAt: c.referredAt?.toISOString() ?? null,
        source: (c.referralSource as SalesReferralSource | null) ?? 'SIGNUP_CODE',
      }
      : null;

    return {
      id: c.id,
      name: c.name,
      addressJson: Object.fromEntries(COMPANY_LEGAL_ADDRESS_KEYS
        .filter((key) => typeof address[key] === 'string')
        .map((key) => [key, address[key]])),
      businessType: { code: c.businessTypeCode ?? null, other: c.businessTypeOther ?? null, version: c.businessTypeVersion ?? 0 },
      discoverySource: (signup?.discoverySource as SignupDiscoverySource | null) ?? undefined,
      discoverySourceOther: signup?.discoverySource === 'OTHER' ? signup.discoverySourceOther ?? undefined : undefined,
      referralSales,
      vatRegistration,
      registeredName: c.registeredName ?? undefined,
      brandName: c.brandName ?? undefined,
      taxId: c.taxId ?? undefined,
      timezone: c.timezone,
      locale: c.locale,
      baseCurrency: c.baseCurrency,
      phone: c.phone ?? undefined,
      email: c.email ?? undefined,
      status: c.status as PartnerCompanyDetailDto['status'],
      createdAt: c.createdAt.toISOString(),
      activatedAt: c.activatedAt?.toISOString(),
      disabledAt: c.disabledAt?.toISOString(),
      archivedAt: c.archivedAt?.toISOString(),
      featureEntitlements: c.featureEntitlements.map((feature) => {
        // Freeze-in-place (owner decision 2026-08-04): every sellable family may be switched off —
        // it stops working and its data stays dormant — so the only row the screen must lock is a
        // platform invariant — the family itself or any submenu of it, exactly as the command refuses.
        const platformInvariant = PLATFORM_INVARIANT_FEATURE_KEYS.includes(parentFeatureKey(feature.featureKey));
        return {
          featureKey: feature.featureKey,
          enabled: feature.enabled,
          updatedAt: feature.updatedAt.toISOString(),
          canDisable: !platformInvariant,
          ...(platformInvariant ? { disableReason: PLATFORM_DISABLE_REASON } : {}),
        };
      }),
      // A current normalizer pass creates this row. `0` also matches the command's safe lazy-root
      // compatibility path if an older normalized company is missing it.
      setVersion: c.entitlementSet?.setVersion ?? 0,
      aiConfiguration: c.aiConfiguration
        ? { modelId: c.aiConfiguration.modelId, updatedAt: c.aiConfiguration.updatedAt.toISOString() }
        : undefined,
      lineContextHealth,
      // The command imports this exact predicate too; a stale version or missing cohort can never
      // make the screen editable while the write path still refuses it.
      entitlementNormalizationPending: !isCurrentEntitlementNormalization(c.entitlementNormalization),
    };
  }
}
