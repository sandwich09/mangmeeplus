import { translateApiError } from '@/common/api/api-error-message';
import {
  todayCivilDate,
  normalizeCompanyBusinessType,
  type CompanyBusinessType,
  type PatchCompanyBusinessTypeRequest,
  COMPANY_PROFILE_ACCOUNT_HASH,
  COMPANY_PROFILE_SHOP_HASH,
  type CompanyIdentityControl,
  type CompanyIdentityReadiness,
  type UserLegalIdentityChangeKind,
  type VatFactStatus,
  type VatRegistrationStatus,
  type CompanyLegalAddress,
} from '@watchdog-bms/contracts';

/** The tax detour accepts an origin key, never a URL supplied in the address. */
export function withholdingProfileReturnPath(companyId: string, search: string): string | null {
  return new URLSearchParams(search).get('from') === 'withholding' ? `/companies/${encodeURIComponent(companyId)}/tax/withholding` : null;
}

export function companyProfileReturnLabel(path: string | null): string {
  if (path?.includes('#expense-input-vat-')) return 'กลับไปตรวจ VAT สำหรับยื่นภาษี';
  return path?.includes('/expenses/substitute-receipts/') ? 'กลับไปทำใบรับรอง' : 'กลับไปออกหนังสือรับรอง';
}

export type IdentityField = 'taxId' | 'registeredName' | 'addressJson';

export function companyProfileReturnPath(companyId: string, search: string): string | null {
  const path = new URLSearchParams(search).get('returnTo');
  const prefix = `/companies/${encodeURIComponent(companyId)}/`;
  if (!path?.startsWith(prefix)) return null;
  const url = new URL(path, 'https://profile.invalid');
  return url.origin === 'https://profile.invalid' && url.pathname.startsWith(prefix) ? `${url.pathname}${url.search}${url.hash}` : null;
}

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

/**
 * The ids the page actually renders, and the only values a fragment may resolve to.
 *
 * An allow-list rather than "strip the #": the hash is whatever the URL says, so anything that
 * reaches `getElementById` should be one of ours. `#javascript:…` and friends resolve to null.
 */
export const COMPANY_PROFILE_SECTION_IDS = ['shop', 'vat-status', 'account'] as const;
export type CompanyProfileSectionId = (typeof COMPANY_PROFILE_SECTION_IDS)[number];

export function sectionIdFromHash(hash: string | null | undefined): CompanyProfileSectionId | null {
  const id = (hash ?? '').replace(/^#/, '');
  return (COMPANY_PROFILE_SECTION_IDS as readonly string[]).includes(id)
    ? (id as CompanyProfileSectionId)
    : null;
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
  /**
   * §15.4.1 C. On `EMAIL_PROVIDER=disabled` the อีเมลกันหลุด item can never be ticked, so the list
   * could never finish and the card could never disappear. Only an explicit `false` drops it: an
   * API that predates the field leaves the item where it was.
   */
  emailDeliveryEnabled?: boolean;
}): ChecklistItem[] {
  const reasons = input.readiness?.identity?.reasons ?? [];
  const missing = (...keys: string[]) => keys.some((key) => reasons.includes(key as never));

  return [
    {
      key: 'identity',
      label: 'เลขผู้เสียภาษีและชื่อจดทะเบียน',
      hash: COMPANY_PROFILE_SHOP_HASH,
      done: !missing('tax_id_missing', 'tax_id_invalid', 'registered_name_missing'),
    },
    { key: 'address', label: 'ที่อยู่ร้าน', hash: COMPANY_PROFILE_SHOP_HASH, done: !missing('company_address_incomplete') },
    ...(input.emailDeliveryEnabled === false
      ? []
      : [{ key: 'email' as const, label: 'อีเมลกันหลุด', hash: COMPANY_PROFILE_ACCOUNT_HASH, done: input.emailVerified }]),
    { key: 'password', label: 'รหัสผ่านสำรอง', hash: COMPANY_PROFILE_ACCOUNT_HASH, done: input.hasPassword },
  ];
}

/** The card exists to be finished and then disappear; a full list is noise on a working screen. */
export function checklistIsComplete(items: readonly ChecklistItem[]): boolean {
  return items.every((item) => item.done);
}

// Re-exported from contracts, where it lives so the API can deep-link the day-7 กันหลุด nudge
// at the same page (L-B). Two copies of a path is how a link rots.
export {
  COMPANY_PROFILE_SETTINGS_PATH,
  COMPANY_PROFILE_ACCOUNT_HASH,
  companyProfilePath as companyProfileHref,
} from '@watchdog-bms/contracts';

const ADDRESS_LABELS: Record<string, string> = {
  line1: 'ที่อยู่ (บ้านเลขที่ ถนน)',
  line2: 'ที่อยู่เพิ่มเติม',
  subdistrict: 'ตำบล / แขวง',
  district: 'อำเภอ / เขต',
  province: 'จังหวัด',
  postalCode: 'รหัสไปรษณีย์',
};

/**
 * `PATCH …/identity` rejects a bad address with `{ message: 'invalid addressJson', details: [...] }`
 * and NO error code, so `apiErrorMessage` can only fall back to a generic sentence — which told a
 * shop owner to reload the page when the real answer was "you left จังหวัด empty". This turns the
 * server's per-field strings into the Thai names of the boxes on screen.
 */
export function addressErrorMessages(error: unknown): string[] {
  // authedApiFetch keeps the WHOLE response body as `error.details` (`{ message, details, requestId }`),
  // so the API's per-field array sits one level deeper — as PartnerDetailPage reads `details.details`.
  const details = (error as { details?: { details?: unknown } } | null | undefined)?.details?.details;
  if (!Array.isArray(details)) return [];
  const messages: string[] = [];
  for (const entry of details) {
    if (typeof entry !== 'string') continue;
    const label = ADDRESS_LABELS[/^addressJson\.([A-Za-z0-9]+)/.exec(entry)?.[1] ?? ''];
    if (!label) continue;
    // Only `is required` means "you left it blank". `must be a string` and
    // `is not an allowed field` are shape errors — telling the owner to fill in a box they already
    // filled in would send them to fix the wrong thing.
    const text = /\d+ digits/.test(entry) ? `${label} ต้องเป็นตัวเลข 5 หลัก`
      : /is required/.test(entry) ? `กรอก${label}`
        : `${label} ค่าไม่ถูกต้อง`;
    if (!messages.includes(text)) messages.push(text);
  }
  return messages;
}

const CHECKOUT_ADDRESS_KEYS = ['line1', 'line2', 'subdistrict', 'district', 'province', 'postalCode'] as const;

/** The boxes Stripe Checkout actually filled; a box it left empty is not part of what it offers. */
function checkoutAddressFilled(address: CompanyLegalAddress): Partial<CompanyLegalAddress> {
  return Object.fromEntries(CHECKOUT_ADDRESS_KEYS.map((key) => [key, (address[key] ?? '').trim()]).filter(([, value]) => value));
}

/**
 * DQ5: the address typed at Stripe Checkout, offered to the shop form. Stripe has no sub-district, so
 * the fill clears ตำบล/แขวง instead of keeping one that belongs to another address — the owner picks it
 * again under the new district. Filling the form saves nothing; the owner still reviews and saves.
 */
export function checkoutAddressToForm(address: CompanyLegalAddress): Partial<CompanyLegalAddress> {
  return { ...checkoutAddressFilled(address), subdistrict: '' };
}

export function checkoutAddressText(address: CompanyLegalAddress): string {
  return Object.values(checkoutAddressFilled(address)).join(' ');
}

/** Whether the offer would change anything in the form at all (the cleared sub-district aside). */
export function checkoutAddressDiffers(address: CompanyLegalAddress, form: Record<string, string | null | undefined>): boolean {
  return Object.entries(checkoutAddressFilled(address)).some(([key, value]) => (form[key] ?? '').trim() !== value);
}

/** Every required box left blank — the state a shop that has never filled in an address is in. */
export function addressIsBlank(address: Record<string, string | null | undefined>): boolean {
  return Object.values(address).every((value) => (value ?? '').trim() === '');
}

/**
 * Whether this edit actually changes the address.
 *
 * A shop that has never entered one starts with every box empty, and treating that as a change
 * submitted an all-blank address the server rejects — which meant an owner filling in only their
 * tax id could never save it at all. Blank-and-was-never-set is not an edit.
 */
export function addressChanged(
  next: Record<string, string | null | undefined>,
  current: Record<string, unknown> | null,
): boolean {
  if (addressIsBlank(next)) return false;
  if (current === null) return true;
  return Object.keys(ADDRESS_LABELS).some(
    (key) => ((next[key] ?? '') as string).trim() !== ((current[key] ?? '') as string),
  );
}

// ─── Checklist card cache (F7) ───────────────────────────────────────────────
//
// Two GETs on every dashboard mount, forever, is the cost of a card that cannot finish: while SES
// is sandboxed the email item never completes, so the "hidden when complete" exit never fires.

export const CHECKLIST_CACHE_TTL_MS = 10 * 60 * 1000;
/** "ไว้ก่อน" is an answer, not a postponement of one screen — it holds for a week. */
export const CHECKLIST_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type CacheEntry = { at: number; items: readonly ChecklistItem[] };

export function checklistCacheKey(companyId: string): string {
  return `watchdog.profileChecklist.${companyId}`;
}

/**
 * The 10-minute cache is a per-tab convenience and belongs in sessionStorage; a 7-day "ไว้ก่อน"
 * stored there dies with the tab, so the card the owner just dismissed is back on the next visit.
 * The dismissal is the answer to a question — it goes in localStorage.
 */
export function checklistDismissKey(companyId: string): string {
  return `watchdog.profileChecklistDismissed.${companyId}`;
}

export function readChecklistDismissal(storage: StorageLike | undefined, companyId: string, now: number = Date.now()): boolean {
  if (!storage) return false;
  try {
    const until = Number(storage.getItem(checklistDismissKey(companyId)));
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

export function dismissChecklistFor(storage: StorageLike | undefined, companyId: string, now: number = Date.now()): void {
  if (!storage) return;
  try {
    storage.setItem(checklistDismissKey(companyId), String(now + CHECKLIST_DISMISS_MS));
  } catch { /* nothing to do: the card reappears on the next mount */ }
}

/** After a save the cached answer is a lie — the item the owner just completed still reads missing. */
export function clearChecklistCache(storage: StorageLike | undefined, companyId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(checklistCacheKey(companyId));
  } catch { /* the entry expires on its own within CHECKLIST_CACHE_TTL_MS */ }
}

/**
 * `items` = render these without fetching. `null` = nothing usable, go and read.
 *
 * A complete list is served like any other and every reader asks `checklistIsComplete` for itself:
 * the old `'hidden'` sentinel was a second spelling of the same answer, and it could not carry the
 * items the sidebar indicator needs.
 *
 * Every access is wrapped: a browser in private mode throws on `getItem`, and a dashboard must
 * not fail to render because a cache it does not need was unavailable.
 */
export function readChecklistCache(
  storage: StorageLike | undefined,
  companyId: string,
  now: number = Date.now(),
): ChecklistItem[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(checklistCacheKey(companyId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (typeof entry?.at !== 'number' || now - entry.at > CHECKLIST_CACHE_TTL_MS) return null;
    if (!Array.isArray(entry.items)) return null;
    return [...entry.items];
  } catch {
    return null;
  }
}

export function writeChecklistCache(
  storage: StorageLike | undefined,
  companyId: string,
  items: readonly ChecklistItem[],
  now: number = Date.now(),
): void {
  if (!storage) return;
  try {
    storage.setItem(checklistCacheKey(companyId), JSON.stringify({ at: now, items } satisfies CacheEntry));
  } catch { /* private mode: the card simply refetches next time */ }
}

/** Who has a signature of their own to manage: one rule for the card on the account tab and the row in the user menu. */
export const OWN_SIGNATURE_PERMISSIONS: readonly string[] = ['expense.signature.self_manage', 'expense.review', 'expense.confirm', 'expense.signature.manage'];

/** Exported so `buildShopSave` can tell "nothing to send" from a real validation problem. */
export const NO_CHANGES_MESSAGE = 'ยังไม่ได้แก้อะไร';
/** Shown under the tax number field, in the field's own words (thai-ux-standard §1.6). */
export const SHOP_NAME_ERROR_MESSAGE = 'ชื่อร้านต้องมี 1 ถึง 200 ตัวอักษร แก้ชื่อร้านแล้วบันทึกอีกครั้ง';
export const TAX_ID_ERROR_MESSAGE = 'เลขผู้เสียภาษีต้องมี 13 หลัก';

export type ShopForm = { displayName?: string; registeredName: string; taxId: string; address: Record<string, string | null | undefined>; businessTypeCode?: string; businessTypeOther?: string };
export type CurrentIdentity = { displayName?: string; registeredName: string | null; taxId: string | null; addressJson: Record<string, unknown> | null; businessType?: CompanyBusinessType } | null;

/**
 * The exact PATCH body this form should send, or the Thai reason it should not send one.
 *
 * Pure and exported so the request shape is pinned by a test rather than by reading JSX: the
 * fields it omits matter as much as the ones it includes. Sending an untouched field is what made
 * a blank address travel with a tax id and take the whole save down with it.
 */
export function buildIdentityPatch(
  control: Pick<CompanyIdentityControl, 'legalIdentityVersion' | 'captureWindowOpen' | 'authoritativeLatched' | 'fieldLatched'>,
  current: CurrentIdentity,
  form: ShopForm,
  // NOT the UTC date: the server validates `effectiveFrom` against `todayCivilDate(company.timezone)`,
  // so between 00:00 and 07:00 ICT a UTC date is yesterday — silently back-dating a CRITICAL-audited
  // legal record by a day.
  today: string = todayCivilDate('Asia/Bangkok'),
): { body: Record<string, unknown> } | { error: string } {
  const displayName = form.displayName?.trim();
  if (displayName !== undefined && (!displayName || displayName.length > 200)) return { error: SHOP_NAME_ERROR_MESSAGE };
  const displayNameChanged = displayName !== undefined && displayName !== current?.displayName;
  const taxId = form.taxId.replace(/[^0-9]/g, '');
  const registeredName = form.registeredName.trim();

  const fields: IdentityField[] = [];
  if (taxId !== (current?.taxId ?? '')) fields.push('taxId');
  if (registeredName !== (current?.registeredName ?? '')) fields.push('registeredName');
  if (addressChanged(form.address, current?.addressJson ?? null)) fields.push('addressJson');

  if (fields.length === 0 && !displayNameChanged) return { error: NO_CHANGES_MESSAGE };
  if (fields.includes('taxId') && taxId !== '' && !isThaiTaxIdInput(taxId)) {
    return { error: TAX_ID_ERROR_MESSAGE };
  }

  const changeKind = fields.length === 0 ? 'CORRECTION' : identityChangeKind(control, fields);
  return {
    body: {
      expectedLegalIdentityVersion: control.legalIdentityVersion,
      changeKind,
      ...(displayNameChanged ? { displayName } : {}),
      ...(fields.includes('taxId') ? { taxId } : {}),
      ...(fields.includes('registeredName') ? { registeredName } : {}),
      ...(fields.includes('addressJson')
        ? {
            addressJson: {
              line1: (form.address['line1'] ?? '').trim(),
              line2: (form.address['line2'] ?? '').trim() || null,
              subdistrict: (form.address['subdistrict'] ?? '').trim(),
              district: (form.address['district'] ?? '').trim(),
              province: (form.address['province'] ?? '').trim(),
              postalCode: (form.address['postalCode'] ?? '').trim(),
            },
          }
        : {}),
      // The server demands these for the heavier kinds; a shop owner filling in a blank field
      // should not have to learn the vocabulary, so the page answers for them.
      ...(changeKind === 'CORRECTION' ? { correctionReason: 'TYPO', note: 'แก้ไขจากหน้าข้อมูลร้าน' } : {}),
      ...(changeKind === 'LEGAL_CHANGE' ? { effectiveFrom: today } : {}),
    },
  };
}

/**
 * Everything one press of "บันทึกข้อมูลร้าน" has to send, or the Thai reason it sends nothing.
 *
 * UAT 2026-09-06: the VAT `<select>` saved on change and then re-read the page's data, which
 * re-seeded the identity boxes from the server — so answering the VAT question wiped the
 * ชื่อจดทะเบียน / เลขภาษี / ที่อยู่ the owner had typed but not yet saved. The answer is now form
 * state like any other and travels with the same button, which also means the
 * "ยังไม่มีอะไรเปลี่ยนค่ะ" guard has to count it.
 *
 * `UNKNOWN` is never sent: the option is disabled because a shop cannot un-answer the question.
 */
export function buildShopSave(
  control: Pick<CompanyIdentityControl, 'legalIdentityVersion' | 'captureWindowOpen' | 'authoritativeLatched' | 'fieldLatched'>,
  current: CurrentIdentity,
  form: ShopForm,
  vat: { current: VatRegistrationStatus; chosen: VatRegistrationStatus },
  today?: string,
): { identityPatch: Record<string, unknown> | null; vatStatus: VatFactStatus | null; businessTypePatch?: PatchCompanyBusinessTypeRequest } | { error: string } {
  let businessTypePatch: PatchCompanyBusinessTypeRequest | undefined;
  if (form.businessTypeCode !== undefined) {
    let value;
    try { value = normalizeCompanyBusinessType(form.businessTypeCode || null, form.businessTypeOther); }
    catch (error) {
      const code = (error as Error).message;
      return { error: code === 'company_business_type_other_required' ? 'ระบุประเภทธุรกิจอื่น ๆ'
        : code === 'company_business_type_other_invalid' ? 'ระบุประเภทธุรกิจอื่น ๆ ไม่เกิน 200 ตัวอักษร'
          : translateApiError('company_business_type_invalid')! };
    }
    if (value.code !== (current?.businessType?.code ?? null) || value.other !== (current?.businessType?.other ?? null)) {
      businessTypePatch = { ...value, expectedVersion: current?.businessType?.version ?? 0 };
    }
  }
  const business = businessTypePatch ? { businessTypePatch } : {};
  const vatStatus = vat.chosen !== 'UNKNOWN' && vat.chosen !== vat.current ? vat.chosen : null;
  const patch = buildIdentityPatch(control, current, form, today);
  if ('error' in patch) {
    // A real validation problem stops the whole press: saving the VAT answer while telling the
    // owner their tax id is wrong is the half-saved state this change exists to remove.
    if (patch.error !== NO_CHANGES_MESSAGE) return patch;
    return vatStatus || businessTypePatch ? { identityPatch: null, vatStatus, ...business } : { error: NO_CHANGES_MESSAGE };
  }
  return { identityPatch: patch.body, vatStatus, ...business };
}

export type EmailSectionMode = 'unavailable' | 'edit' | 'pending' | 'verified' | 'unverified' | 'none';

/**
 * Chooses the account-email block. A LINE-linked owner can save or correct an unverified account
 * email even when delivery is disabled; mail availability only controls the verification action.
 */
export function emailSectionMode(
  account: {
    email: string | null;
    emailDeliveryEnabled?: boolean;
    pendingEmail: string | null;
    emailVerified: boolean;
    lineLinked: boolean;
  } | null,
  editing: boolean,
): EmailSectionMode {
  if (!account) return 'none';
  if (account.lineLinked && !account.emailVerified) {
    if (editing || !account.email) return 'edit';
    return 'unverified';
  }
  if (account.emailDeliveryEnabled === false) return 'unavailable';
  if (editing) return 'edit';
  if (account.pendingEmail) return 'pending';
  return account.emailVerified ? 'verified' : 'none';
}

/**
 * §15.4.1 D. The old hint ended "เว้นว่างไว้ก็ได้ถ้าไม่อยากให้เก็บ", which the Owner read as an
 * instruction to omit the leading 0. Say the rule, show one, and put the clear action on a button.
 */
export const PHONE_HINT = 'ใส่เบอร์มือถือ 10 หลัก เช่น 0812345678';
export const PHONE_ERROR_MESSAGE = 'เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678';

/** Mirrors `USERNAME_PATTERN` in `apps/api/.../account-profile.use-case.ts`; both reject `สมชาย`. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{4,64}$/;
export const INVALID_USERNAME_MESSAGE = translateApiError('invalid_username')!;

export type AccountLoginState = { username: string | null; email?: string | null; emailVerified: boolean } | null;

/**
 * Whether a first password must come with a username.
 *
 * `PasswordLoginUseCase` finds the account by username OR its stored account email. An account
 * with neither would get a credential nothing can log in with, and the second attempt is refused as
 * `password_already_set` — so it would be unusable and unfixable.
 */
export function usernameFieldRequired(account: AccountLoginState): boolean {
  return account !== null && !account.username && !account.email;
}

/** The Thai reason this password form cannot be submitted yet, or null. */
export function passwordFormError(
  account: AccountLoginState,
  form: { password: string; confirmPassword: string; username: string },
): string | null {
  if (form.password.length < 8) return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว';
  if (form.password !== form.confirmPassword) return 'รหัสผ่านสองช่องไม่ตรงกัน';
  if (usernameFieldRequired(account) && !form.username.trim()) {
    return 'ตั้งชื่อผู้ใช้ด้วย ใช้คู่กับรหัสผ่านตอนเข้าจากคอมพิวเตอร์';
  }
  // Same rule as the server, so a Thai name is named as the problem here rather than coming back
  // as a generic English sentence from the API.
  const desired = form.username.trim().toLowerCase();
  if (desired && !USERNAME_PATTERN.test(desired)) return INVALID_USERNAME_MESSAGE;
  return null;
}

/** Thai mobile: exactly 10 digits starting 0, however the owner spaced it. Mirrors the API. */
export function isThaiMobileInput(value: string): boolean {
  return /^0\d{9}$/.test(value.replace(/[^0-9]/g, ''));
}

/** 13 digits, matching `normalizeTaxId` + `THAI_TAX_ID` on the API. */
export function isThaiTaxIdInput(value: string): boolean {
  return /^\d{13}$/.test(value.replace(/[^0-9]/g, ''));
}
