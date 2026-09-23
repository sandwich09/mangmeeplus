// ─── "ข้อมูลร้านและบัญชีของฉัน" page location (P10-L §15.4) ────────────────────
//
// The web app serves this page; the API has to be able to point at it — the day-7 "กันหลุด"
// nudge (§3.6) deep-links straight to the account section through the handoff seam. That reuse
// crosses the api↔web boundary, which is where the shared-constants guideline says the value
// stops being module-local. Relative on purpose: an absolute link must be built by joining this
// to `WEB_BASE_URL` server-side (spec §15.2 ⑤ — never from a client-supplied header).

/** Path under `/companies/:companyId`, as the settings menu and route-permission rules key it. */
export const COMPANY_PROFILE_SETTINGS_PATH = '/settings/profile';

/** Section anchors on that page. `#account` is what the กันหลุด nudge wants. */
export const COMPANY_PROFILE_SHOP_HASH = '#shop';
export const COMPANY_PROFILE_ACCOUNT_HASH = '#account';

/** Web path for one company's profile page, optionally anchored at a section. */
export function companyProfilePath(companyId: string, hash: string = ''): string {
  return `/companies/${companyId}${COMPANY_PROFILE_SETTINGS_PATH}${hash}`;
}

/** What the day-7 กันหลุด card should send the owner to: email, phone and backup password. */
export function companyProfileAccountPath(companyId: string): string {
  return companyProfilePath(companyId, COMPANY_PROFILE_ACCOUNT_HASH);
}
