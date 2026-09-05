import {
  todayCivilDate,
  COMPANY_PROFILE_ACCOUNT_HASH,
  COMPANY_PROFILE_SHOP_HASH,
  type CompanyIdentityControl,
  type CompanyIdentityReadiness,
  type UserLegalIdentityChangeKind,
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
    { key: 'email', label: 'อีเมลกันหลุด', hash: COMPANY_PROFILE_ACCOUNT_HASH, done: input.emailVerified },
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
  const details = (error as { details?: unknown } | null | undefined)?.details;
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
      : /is required/.test(entry) ? `กรุณากรอก ${label}`
        : `${label} ค่าไม่ถูกต้อง`;
    if (!messages.includes(text)) messages.push(text);
  }
  return messages;
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
 * `items` = render these without fetching. `'hidden'` = render nothing AND do not fetch.
 * `null` = nothing usable, go and read.
 *
 * Every access is wrapped: a browser in private mode throws on `getItem`, and a dashboard must
 * not fail to render because a cache it does not need was unavailable.
 */
export function readChecklistCache(
  storage: StorageLike | undefined,
  companyId: string,
  now: number = Date.now(),
): ChecklistItem[] | 'hidden' | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(checklistCacheKey(companyId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (typeof entry?.at !== 'number' || now - entry.at > CHECKLIST_CACHE_TTL_MS) return null;
    if (!Array.isArray(entry.items)) return null;
    return checklistIsComplete(entry.items) ? 'hidden' : [...entry.items];
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

export type ShopForm = { registeredName: string; taxId: string; address: Record<string, string | null | undefined> };
export type CurrentIdentity = { registeredName: string | null; taxId: string | null; addressJson: Record<string, unknown> | null } | null;

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
  const taxId = form.taxId.replace(/[^0-9]/g, '');
  const registeredName = form.registeredName.trim();

  const fields: IdentityField[] = [];
  if (taxId !== (current?.taxId ?? '')) fields.push('taxId');
  if (registeredName !== (current?.registeredName ?? '')) fields.push('registeredName');
  if (addressChanged(form.address, current?.addressJson ?? null)) fields.push('addressJson');

  if (fields.length === 0) return { error: 'ยังไม่มีอะไรเปลี่ยนค่ะ' };
  if (fields.includes('taxId') && taxId !== '' && !isThaiTaxIdInput(taxId)) {
    return { error: 'เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลักค่ะ' };
  }

  const changeKind = identityChangeKind(control, fields);
  return {
    body: {
      expectedLegalIdentityVersion: control.legalIdentityVersion,
      changeKind,
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

/** Mirrors `USERNAME_PATTERN` in `apps/api/.../account-profile.use-case.ts`; both reject `สมชาย`. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{4,64}$/;
export const INVALID_USERNAME_MESSAGE = 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 จุด ขีด และขีดล่าง ยาว 4 ถึง 64 ตัว (ภาษาไทยใช้ไม่ได้ค่ะ)';

export type AccountLoginState = { username: string | null; emailVerified: boolean } | null;

/**
 * Whether a first password must come with a username.
 *
 * `PasswordLoginUseCase` finds the account by username OR verified email. An account with
 * neither would get a credential nothing can log in with, and the second attempt is refused as
 * `password_already_set` — so it would be unusable and unfixable.
 */
export function usernameFieldRequired(account: AccountLoginState): boolean {
  return account !== null && !account.username && !account.emailVerified;
}

/** The Thai reason this password form cannot be submitted yet, or null. */
export function passwordFormError(
  account: AccountLoginState,
  form: { password: string; confirmPassword: string; username: string },
): string | null {
  if (form.password.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวค่ะ';
  if (form.password !== form.confirmPassword) return 'รหัสผ่านสองช่องยังไม่ตรงกันค่ะ';
  if (usernameFieldRequired(account) && !form.username.trim()) {
    return 'ตั้งชื่อผู้ใช้ด้วยนะคะ ไว้ใช้คู่กับรหัสผ่านตอนเข้าจากคอมพิวเตอร์';
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
