/**
 * R11/Q4/S33 — what a sales agent may learn about a shop: its name, whether it has a package,
 * which one, its province and when it signed up. Nothing else. No revenue, no receipts, no owner
 * contact, no business tables at all.
 *
 * Every call is audited LOW with the query string, so "who looked up which shops" is answerable.
 */
import { Injectable } from '@nestjs/common';
import {
  billingOffer,
  planTermState,
  SALES_COMPANY_SEARCH_LIMIT,
  SALES_COMPANY_SEARCH_MIN_CHARS,
  SALES_DEAL_BASE_TIERS,
  type PlanTermStateInput,
  type PlanTierKey,
  type SalesDealBaseTier,
  type SalesCompanySearchDto,
  type SalesCompanySearchItem,
  type SalesDealStatus,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/application/audit.service';
import { PLATFORM_SEAT_EXEMPT_ROLE } from '../../system-partner-management/application/plan-term-limit';
import { DEAL_KIND, derivedDealStatus } from '../domain/sales-deal.logic';
import { salesBadRequest, salesNotFound } from './sales-context';

/**
 * The catalog list price the deal form compares against (S31 warning), per month.
 *
 * A shop on no package, on the free trial, or on a tier the catalog no longer sells falls back to
 * the honest first paid step — the same STARTER_249 default `nextPlanTierKey` uses.
 *
 * ponytail: reads the code catalog rather than the stored BillingPolicy. If the Owner ever sets
 * `offerTerms`, this drifts from the real catalog price; the upgrade path is to pass the active
 * policy into `billingOffer`. Every other caller in the repo reads it the same way.
 */
function catalogMonthlyPriceFor(tierKey: string | undefined): number {
  const base = SALES_DEAL_BASE_TIERS.includes(tierKey as SalesDealBaseTier)
    ? tierKey as SalesDealBaseTier : 'STARTER_249';
  return billingOffer(base, 'month').priceSatang;
}

function provinceOf(addressJson: unknown): string | null {
  const province = (addressJson as { province?: unknown } | null)?.province;
  return typeof province === 'string' && province.trim() ? province.trim() : null;
}

@Injectable()
export class SalesCompanySearchService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async search(
    query: string,
    actor: { userId: string; requestId: string },
  ): Promise<SalesCompanySearchDto> {
    const q = (query ?? '').trim();
    if (q.length < SALES_COMPANY_SEARCH_MIN_CHARS || q.length > 120) {
      throw salesBadRequest('SALES_COMPANY_NOT_FOUND', `พิมพ์ชื่อร้านอย่างน้อย ${SALES_COMPANY_SEARCH_MIN_CHARS} ตัวอักษร`);
    }

    // ponytail: explicit select — never touch business tables (the list-partners rule).
    const companies = await this.prisma.client.company.findMany({
      where: {
        status: { in: ['ACTIVE', 'DISABLED'] },
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { registeredName: { contains: q, mode: 'insensitive' } },
          { id: q },
        ],
      },
      take: SALES_COMPANY_SEARCH_LIMIT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true, name: true, addressJson: true, createdAt: true,
        planTerm: { select: { tierKey: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } },
      },
    });

    const items = await this.decorate(companies, new Date());

    // Q4: the search itself is the audited event — the rows it returned are not sensitive, but
    // "this agent swept the customer list" is exactly what an operator would want to see.
    await this.audit.log({
      actorUserId: actor.userId, action: 'sales.company.searched', targetType: 'Company',
      requestId: actor.requestId, result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { query: q, matched: items.length },
    });
    return { items };
  }

  /** The same limited view for one shop, used by the deal form and by deal reads. */
  async one(companyId: string): Promise<SalesCompanySearchItem> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: {
        id: true, name: true, addressJson: true, createdAt: true,
        planTerm: { select: { tierKey: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } },
      },
    });
    if (!company) throw salesNotFound('SALES_COMPANY_NOT_FOUND', 'ไม่พบร้านนี้ในระบบ');
    const [item] = await this.decorate([company], new Date());
    return item!;
  }

  /** S31: the two counts the deal preview compares against the deal's limits. */
  async usage(companyId: string): Promise<{ branchCount: number; employeeCount: number }> {
    const [branchCount, employeeCount] = await Promise.all([
      this.prisma.client.branch.count({ where: { companyId, status: 'ACTIVE' } }),
      // Identical shape to assertEmployeeLimit, so the preview and the gate can never disagree.
      this.prisma.client.companyMembership.count({
        where: { companyId, status: 'ACTIVE', roles: { none: { role: PLATFORM_SEAT_EXEMPT_ROLE } } },
      }),
    ]);
    return { branchCount, employeeCount };
  }

  private async decorate(
    companies: ReadonlyArray<{ id: string; name: string; addressJson: unknown; createdAt: Date; planTerm: PlanTermStateInput | null }>,
    now: Date,
  ): Promise<SalesCompanySearchItem[]> {
    if (companies.length === 0) return [];
    // One batched read: "does this shop already have a deal in flight" is the single fact the
    // agent needs to avoid starting a second one and hitting SALES_DEAL_ALREADY_OPEN.
    const openDeals = await this.prisma.client.packageChangeRequest.findMany({
      where: {
        companyId: { in: companies.map((company) => company.id) },
        kind: DEAL_KIND,
        status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] },
      },
      select: { id: true, companyId: true, status: true, offerExpiresAt: true },
    });
    const dealByCompany = new Map(openDeals.map((deal) => [deal.companyId, deal]));
    // S31 needs the shop's current branch/user counts on the SEARCH row too, so the deal form can
    // warn before a deal exists. Capped at SALES_COMPANY_SEARCH_LIMIT rows, and it reuses `usage`
    // verbatim so the picker and the saved deal can never count seats by different rules.
    const usageByCompany = new Map(await Promise.all(
      companies.map(async (company) => [company.id, await this.usage(company.id)] as const),
    ));

    return companies.map((company): SalesCompanySearchItem => {
      const deal = dealByCompany.get(company.id);
      // An APPROVED deal past its window is not an open deal any more, even before the sweep.
      const status: SalesDealStatus | null = deal ? derivedDealStatus(deal, now) : null;
      const stillOpen = status !== null && status !== 'EXPIRED';
      const usage = usageByCompany.get(company.id) ?? { branchCount: 0, employeeCount: 0 };
      return {
        companyId: company.id,
        name: company.name,
        accessState: planTermState(company.planTerm, now),
        tierKey: (company.planTerm?.tierKey as PlanTierKey | undefined) ?? null,
        province: provinceOf(company.addressJson),
        createdAt: company.createdAt.toISOString(),
        openDealId: stillOpen ? deal!.id : null,
        openDealStatus: stillOpen ? status : null,
        branchCount: usage.branchCount,
        employeeCount: usage.employeeCount,
        catalogMonthlyPriceSatang: catalogMonthlyPriceFor(company.planTerm?.tierKey ?? undefined),
      };
    });
  }
}
