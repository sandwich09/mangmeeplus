import type {
  CompanyIdentityControl,
  CompanyIdentityReadiness,
  UserLegalIdentityChangeKind,
} from '@watchdog-bms/contracts';

export type IdentityField = 'taxId' | 'registeredName' | 'addressJson';

/**
 * Which `changeKind` this edit must be sent as.
 *
 * Deliberately the same table as the server's `allowedChangeKinds`
 * (`apps/api/src/modules/data-model-core/domain/logic/company-legal-identity.logic.ts`), because
 * the form has to know *before* it submits which extra fields the change needs — a correction
 * reason, or a legal effective date. Getting it wrong is a 422 shown to someone who did nothing
 * wrong, so `company-profile.logic.spec.ts` pins this table against that one.
 *
 * Where the server allows two kinds, this picks the lighter one: a shop owner filling in a blank
 * field is correcting a record, not restructuring a company.
 */
export function identityChangeKind(
  control: Pick<CompanyIdentityControl, 'captureWindowOpen' | 'authoritativeLatched' | 'fieldLatched'>,
  changedFields: readonly IdentityField[],
): UserLegalIdentityChangeKind {
  if (control.captureWindowOpen) return 'INITIAL_CAPTURE';
  if (changedFields.includes('taxId')) return 'LEGAL_CHANGE';
  if (control.authoritativeLatched) return 'LEGAL_CHANGE';
  const touchesLatched = changedFields.some(
    (field) => (field === 'registeredName' || field === 'addressJson') && control.fieldLatched[field],
  );
  return touchesLatched ? 'LEGAL_CHANGE' : 'CORRECTION';
}

export type ChecklistItemKey = 'identity' | 'address' | 'email' | 'password';

export type ChecklistItem = {
  key: ChecklistItemKey;
  label: string;
  /** Section anchor on the profile page. */
  hash: string;
  done: boolean;
};

/**
 * The non-blocking "what is still missing" list (spec §15.4). Company facts come from the same
 * `readiness.identity.reasons` the API already computes, so the card cannot disagree with the
 * page it links to. `vat_status_unanswered` is deliberately not an item: the spec lists four.
 */
export function profileChecklist(input: {
  readiness: CompanyIdentityReadiness | undefined;
  emailVerified: boolean;
  hasPassword: boolean;
}): ChecklistItem[] {
  const reasons = input.readiness?.identity?.reasons ?? [];
  const missing = (...keys: string[]) => keys.some((key) => reasons.includes(key as never));

  return [
    {
      key: 'identity',
      label: 'เลขผู้เสียภาษีและชื่อจดทะเบียน',
      hash: '#shop',
      done: !missing('tax_id_missing', 'tax_id_invalid', 'registered_name_missing'),
    },
    { key: 'address', label: 'ที่อยู่ร้าน', hash: '#shop', done: !missing('company_address_incomplete') },
    { key: 'email', label: 'อีเมลกันหลุด', hash: '#account', done: input.emailVerified },
    { key: 'password', label: 'รหัสผ่านสำรอง', hash: '#account', done: input.hasPassword },
  ];
}

/** The card exists to be finished and then disappear; a full list is noise on a working screen. */
export function checklistIsComplete(items: readonly ChecklistItem[]): boolean {
  return items.every((item) => item.done);
}

export const COMPANY_PROFILE_PATH = '/settings/profile';

export function companyProfileHref(companyId: string, hash = ''): string {
  return `/companies/${companyId}${COMPANY_PROFILE_PATH}${hash}`;
}

/** Thai mobile: exactly 10 digits starting 0, however the owner spaced it. Mirrors the API. */
export function isThaiMobileInput(value: string): boolean {
  return /^0\d{9}$/.test(value.replace(/[^0-9]/g, ''));
}

/** 13 digits, matching `normalizeTaxId` + `THAI_TAX_ID` on the API. */
export function isThaiTaxIdInput(value: string): boolean {
  return /^\d{13}$/.test(value.replace(/[^0-9]/g, ''));
}
