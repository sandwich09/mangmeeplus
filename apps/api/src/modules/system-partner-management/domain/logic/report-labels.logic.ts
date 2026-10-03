import {
  REPORT_CLASSIFICATIONS,
  REPORT_INDUSTRY_GROUPS,
  REPORT_INDUSTRY_MAPPED_BUSINESS_TYPE_CODES,
  isReportClassification,
  type PartnerReportClassificationFilter,
  type PartnerReportIndustryGroupFilter,
  type ReportClassification,
} from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';

/**
 * The executive report's labels on a company (executive spec §12.2, §15, §16.1). Company/partner
 * management owns them; the report build and the admin list read them through these two functions,
 * so "unclassified" means one thing on the admin page and in the report.
 */

/** The platform company is INTERNAL whatever its row says; any other company is what the admin chose (null = not yet). */
export function reportClassificationOf(company: { id: string; reportClassification: string | null }): ReportClassification | null {
  if (company.id === PLATFORM_TENANT_ID) return 'INTERNAL';
  return isReportClassification(company.reportClassification) ? company.reportClassification : null;
}

/** The list filters as conditions on Company, matching `reportClassificationOf` and the report's mapping exactly. */
export function reportLabelWhere(filter: { reportClassification?: PartnerReportClassificationFilter; reportIndustryGroup?: PartnerReportIndustryGroupFilter }):
  Prisma.CompanyWhereInput[] {
  const where: Prisma.CompanyWhereInput[] = [];
  const classification = filter.reportClassification ?? 'ALL';
  if (classification === 'INTERNAL') where.push({ OR: [{ id: PLATFORM_TENANT_ID }, { reportClassification: 'INTERNAL' }] });
  else if (classification === 'UNCLASSIFIED') {
    where.push({ id: { not: PLATFORM_TENANT_ID }, OR: [{ reportClassification: null }, { reportClassification: { notIn: [...REPORT_CLASSIFICATIONS] } }] });
  } else if (classification !== 'ALL') where.push({ id: { not: PLATFORM_TENANT_ID }, reportClassification: classification });
  if (filter.reportIndustryGroup === 'UNSET') {
    where.push({ OR: [{ reportIndustryGroup: null }, { reportIndustryGroup: { notIn: REPORT_INDUSTRY_GROUPS.map((group) => group.key) } }] });
    where.push({ OR: [{ businessTypeCode: null }, { businessTypeCode: { notIn: [...REPORT_INDUSTRY_MAPPED_BUSINESS_TYPE_CODES] } }] });
  }
  return where;
}
