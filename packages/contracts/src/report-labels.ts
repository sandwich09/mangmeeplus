import { DBD_TSIC_ACTIVITIES } from './dbd-tsic-master.js';

/**
 * The report labels stored on a company for the executive report
 * (executive backend spec §12.2 and §15). The admin page, the partner API and the report build all
 * read these lists, so a value is spelled in one place.
 */

/** Who the company is to Mangmee. `null` on a company = not classified yet; only CUSTOMER is counted. */
export const REPORT_CLASSIFICATIONS = ['CUSTOMER', 'TEST', 'INTERNAL', 'DEMO'] as const;
export const CLASSIFICATION_WORDS = {
  ALL: 'ทุกประเภท', CUSTOMER: 'ลูกค้าจริง', TEST: 'บริษัททดสอบ',
  INTERNAL: 'บริษัทของมั่งมี', DEMO: 'เดโม่', UNCLASSIFIED: 'ยังไม่ได้จัดประเภท',
} as const;
export type ReportClassification = typeof REPORT_CLASSIFICATIONS[number];
export function isReportClassification(value: unknown): value is ReportClassification {
  return (REPORT_CLASSIFICATIONS as readonly unknown[]).includes(value);
}

/**
 * Version 1 of the readable industry groups, by the section (A–U) of the shop's DBD business type.
 * All 12 groups approved by the owner on 2026-10-03 ("ตามแนะนำหมด"). A change of content is a new
 * version, because the report keeps one mapping version per data set (`dimensionVersion`).
 */
export const REPORT_INDUSTRY_GROUP_VERSION = 1;
export const REPORT_INDUSTRY_GROUPS = [
  { key: 'RETAIL_WHOLESALE', label: 'ค้าปลีกและค้าส่ง', sections: ['G'] },
  { key: 'FOOD_ACCOMMODATION', label: 'ร้านอาหารและที่พัก', sections: ['I'] },
  { key: 'MANUFACTURING', label: 'การผลิต', sections: ['C'] },
  { key: 'CONSTRUCTION_PROPERTY', label: 'ก่อสร้างและอสังหาริมทรัพย์', sections: ['F', 'L'] },
  { key: 'TRANSPORT_LOGISTICS', label: 'ขนส่งและคลังสินค้า', sections: ['H'] },
  { key: 'PROFESSIONAL_BUSINESS', label: 'บริการวิชาชีพและบริการธุรกิจ', sections: ['M', 'N'] },
  { key: 'TECH_MEDIA', label: 'เทคโนโลยีและสื่อ', sections: ['J'] },
  { key: 'HEALTH_EDUCATION', label: 'สุขภาพและการศึกษา', sections: ['P', 'Q'] },
  { key: 'PERSONAL_LEISURE', label: 'บริการส่วนบุคคลและนันทนาการ', sections: ['R', 'S'] },
  { key: 'AGRICULTURE', label: 'เกษตร ประมง และป่าไม้', sections: ['A'] },
  { key: 'FINANCE', label: 'การเงินและประกันภัย', sections: ['K'] },
  { key: 'OTHER_INDUSTRY', label: 'กิจการอื่น', sections: ['B', 'D', 'E', 'O', 'T', 'U'] },
] as const;
export type ReportIndustryGroup = typeof REPORT_INDUSTRY_GROUPS[number]['key'];
export function isReportIndustryGroup(value: unknown): value is ReportIndustryGroup {
  return REPORT_INDUSTRY_GROUPS.some((group) => group.key === value);
}

const groupOfSection = new Map<string, ReportIndustryGroup>(
  REPORT_INDUSTRY_GROUPS.flatMap((group) => group.sections.map((section) => [section, group.key] as const)));
const groupOfCode = new Map<string, ReportIndustryGroup>(
  DBD_TSIC_ACTIVITIES.flatMap((row) => { const group = groupOfSection.get(row.section); return group ? [[row.code, group] as const] : []; }));

/** The group a shop's own business type falls in; null for none, "OTHER" and a code the mapping does not know. */
export function reportIndustryGroupOfBusinessType(code: string | null | undefined): ReportIndustryGroup | null {
  return (code && groupOfCode.get(code)) || null;
}
/** Every business type code that has a group, for a query that must find the companies without one. */
export const REPORT_INDUSTRY_MAPPED_BUSINESS_TYPE_CODES: readonly string[] = [...groupOfCode.keys()];

/** The report's group for a company: the admin's label first, then the mapping of the shop's own business type. */
export function reportIndustryGroupOf(company: { reportIndustryGroup?: string | null; businessTypeCode?: string | null }):
  { group: ReportIndustryGroup; source: 'ADMIN' | 'MAPPING' } | null {
  if (isReportIndustryGroup(company.reportIndustryGroup)) return { group: company.reportIndustryGroup, source: 'ADMIN' };
  const mapped = reportIndustryGroupOfBusinessType(company.businessTypeCode);
  return mapped ? { group: mapped, source: 'MAPPING' } : null;
}
