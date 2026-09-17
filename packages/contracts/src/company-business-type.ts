import { DBD_TSIC_ACTIVITIES } from './dbd-tsic-master.js';
export { DBD_TSIC_ACTIVITIES } from './dbd-tsic-master.js';

export const COMPANY_BUSINESS_TYPE_OTHER_MAX = 200;
export type CompanyBusinessType = { code: string | null; other: string | null; version: number };
export type PatchCompanyBusinessTypeRequest = {
  expectedVersion: number;
  code: string | null;
  other?: string | null;
};

const labels = new Map(DBD_TSIC_ACTIVITIES.map((row) => [row.code, row.label]));

export function normalizeCompanyBusinessType(code: unknown, other: unknown): Pick<CompanyBusinessType, 'code' | 'other'> {
  if (code !== null && (typeof code !== 'string' || (code !== 'OTHER' && !labels.has(code)))) {
    throw new Error('company_business_type_invalid');
  }
  if (other != null && (typeof other !== 'string' || other.trim().length > COMPANY_BUSINESS_TYPE_OTHER_MAX)) {
    throw new Error('company_business_type_other_invalid');
  }
  const text = typeof other === 'string' ? other.trim() : '';
  if (code === 'OTHER' && !text) throw new Error('company_business_type_other_required');
  return { code, other: code === 'OTHER' ? text : null };
}

export function companyBusinessTypeLabel(value?: Pick<CompanyBusinessType, 'code' | 'other'> | null): string {
  if (!value?.code) return 'ยังไม่ระบุ';
  if (value.code === 'OTHER') return value.other ? `อื่น ๆ — ${value.other}` : 'อื่น ๆ';
  const label = labels.get(value.code);
  return label ? `${value.code} — ${label}` : value.code;
}
