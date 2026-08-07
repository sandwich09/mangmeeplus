import type { CrmConsentStatus, CrmCustomerLineIdentitySummary, CrmCustomerStatus, CrmCustomerSummary, CrmCustomerType, CrmDuplicateWarning } from '@watchdog-bms/contracts';

export const CUSTOMER_PAGE_SIZE = 10;

export type CustomerStatusFilter = 'all' | CrmCustomerStatus;

export const CUSTOMER_STATUS_FILTERS: { id: CustomerStatusFilter; label: string; c: string; bg: string }[] = [
  { id: 'all', label: 'ทั้งหมด', c: '#027A48', bg: '#D1FAE5' },
  { id: 'ACTIVE', label: 'ใช้งาน', c: '#027A48', bg: '#ECFDF3' },
  { id: 'INACTIVE', label: 'ไม่เคลื่อนไหว', c: '#475467', bg: '#F2F4F7' },
  { id: 'ARCHIVED', label: 'เก็บถาวร', c: '#B42318', bg: '#FEF3F2' },
  { id: 'MERGED', label: 'รวมข้อมูลแล้ว', c: '#6941C6', bg: '#F4F3FF' },
];

export const CUSTOMER_STATUS_META: Record<CrmCustomerStatus, { label: string; c: string; bg: string }> = {
  ACTIVE: { label: 'ใช้งาน', c: '#027A48', bg: '#ECFDF3' },
  INACTIVE: { label: 'ไม่เคลื่อนไหว', c: '#475467', bg: '#F2F4F7' },
  ARCHIVED: { label: 'เก็บถาวร', c: '#B42318', bg: '#FEF3F2' },
  MERGED: { label: 'รวมข้อมูลแล้ว', c: '#6941C6', bg: '#F4F3FF' },
};

export const CUSTOMER_TYPE_LABEL: Record<CrmCustomerType, string> = {
  PERSON: 'บุคคล',
  ORGANIZATION: 'องค์กร',
  UNKNOWN: 'ไม่ระบุประเภท',
};

export const CONSENT_STATUS_LABEL: Record<CrmConsentStatus, string> = {
  UNKNOWN: 'ยังไม่ทราบ',
  GRANTED: 'ยินยอม',
  REVOKED: 'ถอนความยินยอม',
  NOT_REQUIRED: 'ไม่จำเป็น',
};

export function customerStatusParam(filter: CustomerStatusFilter): CrmCustomerStatus | undefined {
  return filter === 'all' ? undefined : filter;
}

export function displayValue(value: string | undefined): string {
  return value?.trim() ? value : '—';
}

export type CustomerFormValues = {
  displayName: string;
  primaryPhone: string;
};

export type CustomerDuplicateMatch = {
  customer: CrmCustomerSummary;
  matchType: 'PHONE' | 'NAME';
};

export function normalizeCustomerPhone(value: string | undefined): string {
  let digits = (value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0066')) digits = digits.slice(2);
  const thai = digits.match(/^66(?:0)?([1-9]\d{7,8})$/);
  if (thai) return thai[1];
  if (/^0[1-9]\d{7,8}$/.test(digits)) return digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

function normalizeCustomerName(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase('th-TH').replace(/\s+/g, ' ');
}

export function validateCustomerForm(values: CustomerFormValues): Partial<Record<keyof CustomerFormValues, string>> {
  const errors: Partial<Record<keyof CustomerFormValues, string>> = {};
  if (!values.displayName.trim()) errors.displayName = 'กรุณากรอกชื่อลูกค้า';
  else if (values.displayName.trim().length > 160) errors.displayName = 'ชื่อลูกค้าต้องไม่เกิน 160 ตัวอักษร';
  const phone = normalizeCustomerPhone(values.primaryPhone);
  if (phone && (phone.length < 8 || phone.length > 15)) errors.primaryPhone = 'เบอร์โทรต้องมี 8–15 หลัก';
  return errors;
}

export function findCustomerDuplicateMatches(
  customers: CrmCustomerSummary[],
  values: CustomerFormValues,
  excludeCustomerId?: string,
): CustomerDuplicateMatch[] {
  const phone = normalizeCustomerPhone(values.primaryPhone);
  const name = normalizeCustomerName(values.displayName);
  return customers.flatMap<CustomerDuplicateMatch>((customer) => {
    if (customer.id === excludeCustomerId || customer.status === 'MERGED' || customer.status === 'ARCHIVED') return [];
    if (phone && normalizeCustomerPhone(customer.primaryPhone) === phone) return [{ customer, matchType: 'PHONE' as const }];
    if (name && normalizeCustomerName(customer.displayName) === name) return [{ customer, matchType: 'NAME' as const }];
    return [];
  });
}

export function lineIdentityText(identities: CrmCustomerLineIdentitySummary[], fallback: string): string {
  const identity = identities.find((item) => item.status === 'ACTIVE') ?? identities[0];
  if (!identity) return fallback;
  const status = identity.status === 'ACTIVE' ? 'เชื่อมแล้ว' : identity.status === 'UNFOLLOWED' ? 'เลิกติดตาม' : 'บล็อก';
  return `LINE ${identity.maskedProviderUserId} · ${status}${identity.verifiedLinkAt ? ' · ยืนยันแล้ว' : ''}`;
}

export function customerDuplicateErrorState(error: unknown): { restricted: boolean; warnings: CrmDuplicateWarning[] } | null {
  const candidate = error as { code?: unknown; details?: { warnings?: unknown } } | null;
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const warnings = Array.isArray(candidate?.details?.warnings)
    ? candidate.details.warnings.filter((warning): warning is CrmDuplicateWarning => {
        if (!warning || typeof warning !== 'object') return false;
        const row = warning as Partial<CrmDuplicateWarning>;
        return typeof row.customerId === 'string' && typeof row.displayName === 'string' && typeof row.matchType === 'string';
      })
    : [];
  if (code === 'duplicate_candidate_requires_manager_review' || warnings.some((warning) => warning.customerId === 'REDACTED')) {
    return { restricted: true, warnings: [] };
  }
  if (code === 'duplicate_customer_candidate') return { restricted: warnings.length === 0, warnings };
  return null;
}
