import type { CompanyLegalAddress } from './company-tax-identity.js';

export const BILLING_PROFILE_FIELD_LABELS = {
  name: 'ชื่อร้านหรือชื่อจดทะเบียน', line1: 'ที่อยู่ (บ้านเลขที่ ถนน)',
  subdistrict: 'ตำบล / แขวง', district: 'อำเภอ / เขต', province: 'จังหวัด', postalCode: 'รหัสไปรษณีย์ 5 หลัก',
} as const;
export type BillingProfileField = keyof typeof BILLING_PROFILE_FIELD_LABELS;
export type BillingCompanyProfile = {
  name: string; nameSource: 'REGISTERED' | 'SHOP'; address: CompanyLegalAddress; missingFields: BillingProfileField[];
};
export type BillingCompanySource = { name?: string | null; registeredName?: string | null; addressJson?: unknown };

/** Purchase prerequisites are independent of the tax evidence/readiness latch. */
export function companyBillingProfile(company: BillingCompanySource): BillingCompanyProfile {
  const trim = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const raw = company.addressJson && typeof company.addressJson === 'object' && !Array.isArray(company.addressJson)
    ? company.addressJson as Record<string, unknown> : {};
  const registeredName = trim(company.registeredName), name = registeredName || trim(company.name);
  const address: CompanyLegalAddress = { line1: trim(raw.line1), line2: trim(raw.line2) || null,
    subdistrict: trim(raw.subdistrict), district: trim(raw.district), province: trim(raw.province), postalCode: trim(raw.postalCode) };
  const missingFields: BillingProfileField[] = [];
  if (!name) missingFields.push('name');
  for (const field of ['line1', 'subdistrict', 'district', 'province'] as const) if (!address[field]) missingFields.push(field);
  if (!/^\d{5}$/.test(address.postalCode)) missingFields.push('postalCode');
  return { name, nameSource: registeredName ? 'REGISTERED' : 'SHOP', address, missingFields };
}
