import {
  REPORT_CLASSIFICATIONS, REPORT_INDUSTRY_GROUPS, PARTNER_REPORT_CLASSIFICATION_FILTERS, PARTNER_REPORT_INDUSTRY_GROUP_FILTERS,
  isReportClassification, isReportIndustryGroup, type PartnerReportClassificationFilter, type PartnerReportIndustryGroupFilter,
  type PartnerReportLabelsDto, type UpdatePartnerProfileDto,
} from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '../../common/i18n/thai-date';

export const REPORT_CLASSIFICATION_TITLE = 'ประเภทบริษัทสำหรับรายงาน';
export const REPORT_INDUSTRY_TITLE = 'กลุ่มธุรกิจสำหรับรายงาน';
export const reportLabelWords = {
  title: 'ข้อมูลสำหรับรายงานผู้บริหาร',
  explanation: 'ข้อมูลนี้แยกจากข้อมูลที่ร้านกรอก การพักหรือเก็บบริษัทถาวรไม่ปิดสิทธิ์แก้ข้อมูลสำหรับรายงาน',
  platform: 'บริษัทแพลตฟอร์มเป็นบริษัทของมั่งมีเสมอ',
  fallback: 'หากไม่ระบุกลุ่ม ระบบใช้กลุ่มจากประเภทธุรกิจที่ร้านกรอกเมื่อจับคู่ได้',
  effective: (label: string) => `กลุ่มที่รายงานใช้จากข้อมูลที่บันทึก: ${label}`,
  saved: 'บันทึกข้อมูลสำหรับรายงานแล้ว รายงานจะแสดงค่าที่แก้หลังอัปเดตข้อมูลรอบถัดไป',
  save: 'บันทึกข้อมูลสำหรับรายงาน', readOnly: 'คุณดูข้อมูลนี้ได้ แต่ไม่มีสิทธิ์แก้ไข',
};
const CLASSIFICATION_WORDS = { ALL: 'ทุกประเภท', CUSTOMER: 'ลูกค้าจริง', TEST: 'บริษัททดสอบ', INTERNAL: 'บริษัทของมั่งมี', DEMO: 'เดโม่', UNCLASSIFIED: 'ยังไม่ได้จัดประเภท' };
const UNSET = 'ไม่ระบุ';
export const classificationFilterOptions = PARTNER_REPORT_CLASSIFICATION_FILTERS.map(value => ({ value, label: CLASSIFICATION_WORDS[value] }));
export const industryFilterOptions = PARTNER_REPORT_INDUSTRY_GROUP_FILTERS.map(value => ({ value, label: value === 'ALL' ? 'ทุกกลุ่ม' : UNSET }));
export function classificationOptions(isPlatformCompany: boolean) {
  return isPlatformCompany ? [{ value: 'INTERNAL', label: CLASSIFICATION_WORDS.INTERNAL }]
    : [{ value: '', label: CLASSIFICATION_WORDS.UNCLASSIFIED }, ...REPORT_CLASSIFICATIONS.filter(value => value !== 'DEMO').map(value => ({ value, label: CLASSIFICATION_WORDS[value] }))];
}
export const industryOptions = [{ value: '', label: UNSET }, ...REPORT_INDUSTRY_GROUPS.map(group => ({ value: group.key, label: group.label }))];
export function reportIndustryLabel(key: PartnerReportLabelsDto['effectiveIndustryGroup']): string {
  return industryOptions.find(option => option.value === (key ?? ''))?.label ?? UNSET;
}
export function partnerReportFilters(params: Pick<URLSearchParams, 'get'>) {
  const classification = params.get('reportClassification') as PartnerReportClassificationFilter;
  const industry = params.get('reportIndustryGroup') as PartnerReportIndustryGroupFilter;
  return {
    reportClassification: PARTNER_REPORT_CLASSIFICATION_FILTERS.includes(classification) ? classification : 'ALL' as const,
    reportIndustryGroup: PARTNER_REPORT_INDUSTRY_GROUP_FILTERS.includes(industry) ? industry : 'ALL' as const,
  };
}
export function partnerListUrl(current: { toString(): string }, changes: Record<string, string>): string {
  const params = new URLSearchParams(current.toString());
  if (['q', 'status', 'reportClassification', 'reportIndustryGroup'].some(key => key in changes)) params.delete('page');
  for (const [key, value] of Object.entries(changes)) {
    if (!value || ((key === 'reportClassification' || key === 'reportIndustryGroup') && value === 'ALL')) params.delete(key);
    else params.set(key, value);
  }
  return `/system/partners${params.size ? `?${params}` : ''}`;
}
/** Labels only for every lifecycle: never mix frozen profile fields into the existing PATCH. */
export function partnerReportLabelBody(classification: string, industry: string, isPlatformCompany: boolean): UpdatePartnerProfileDto | null {
  if ((!isPlatformCompany && classification !== '' && !isReportClassification(classification)) || (industry !== '' && !isReportIndustryGroup(industry))) return null;
  return { reportClassification: isPlatformCompany ? 'INTERNAL' : isReportClassification(classification) ? classification : null,
    reportIndustryGroup: isReportIndustryGroup(industry) ? industry : null };
}
export function reportLabelEditedBy(actor: PartnerReportLabelsDto['classifiedBy'], at: string | undefined): string | null {
  return actor && at ? `แก้ล่าสุดโดย ${actor.displayName} เมื่อ ${formatThaiDateTime(at)}` : null;
}
