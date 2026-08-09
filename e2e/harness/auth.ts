/**
 * Shared auth harness for WatchDog-BMS E2E.
 *
 * Two auth paths, pick per test type:
 *
 *  1. loginViaDevBff(context)  — browser/UI tests.
 *     POSTs the web app's own BFF route `/api/auth/dev-login`, which exchanges the
 *     seeded OWNER dev token for a real httpOnly cookie session and sets the chunked
 *     `watchdog_token.*` + `watchdog_csrf` cookies on the browser context automatically.
 *     The helper then records the current test user's real clickwrap through the same-origin,
 *     CSRF-protected endpoint. This is the closest thing to a real login and is the DEFAULT for
 *     ordinary UI specs; legal-acceptance tests intentionally sign in without this helper.
 *
 *  2. getDevToken(request) + apiHeaders() — direct API assertions.
 *     Requests a raw bearer access token from the API dev endpoint for `request.get/post`, then
 *     records the current test user's clickwrap through the bearer-authenticated endpoint.
 *
 * Both are gated by AUTH_PROVIDER=dev / DEV_AUTH_ENABLED=true (local only; the API
 * 404s these outside APP_ENV=local). Never ships to prod.
 */
import { expect, type APIRequestContext, type BrowserContext } from '@playwright/test';

/** Narrow runtime view of the shared LegalAcceptanceStatusResponse contract used by E2E. */
export type LegalAcceptanceStatus = {
  required: boolean;
  acceptedAt: string | null;
  companyId: string;
  statementVersion: string;
  terms: { version: string };
  privacy: { version: string };
  displayChallenges: Record<'th' | 'en', string>;
};

type LegalAcceptanceInput = {
  termsVersion: string;
  privacyVersion: string;
  statementVersion: string;
  termsAccepted: true;
  privacyAcknowledged: true;
  capacityConfirmed: true;
  locale: 'th' | 'en';
  displayChallenge: string;
};

export const COMPANY_ID = process.env['E2E_COMPANY_ID'] ?? 'seed-local-company';

export const WEB_BASE_URL =
  process.env['E2E_WEB_BASE_URL'] ?? `http://127.0.0.1:${process.env['WEB_PORT'] ?? '3000'}`;

export const API_BASE_URL =
  process.env['E2E_API_BASE_URL'] ?? `http://127.0.0.1:${process.env['API_PORT'] ?? '3001'}/v1`;

const CSRF_COOKIE = 'watchdog_csrf';
const CSRF_HEADER = 'x-csrf-token';

type AuthMe = { companyId?: string | null };

function acceptanceInput(status: LegalAcceptanceStatus): LegalAcceptanceInput {
  return {
    termsVersion: status.terms.version,
    privacyVersion: status.privacy.version,
    statementVersion: status.statementVersion,
    termsAccepted: true,
    privacyAcknowledged: true,
    capacityConfirmed: true,
    locale: 'th',
    displayChallenge: status.displayChallenges.th,
  };
}

async function browserCompanyId(context: BrowserContext, companyId?: string | null): Promise<string> {
  if (companyId) return companyId;
  const me = await context.request.get(`${WEB_BASE_URL}/api/v1/auth/me`);
  expect(me.ok(), `cookie GET /auth/me failed (${me.status()}): ${await me.text()}`).toBe(true);
  const body = (await me.json()) as AuthMe;
  expect(body.companyId, 'authenticated company context is present').toBeTruthy();
  return body.companyId!;
}

/**
 * Complete the current clickwrap release for a cookie-authenticated test session.
 *
 * The browser path deliberately goes through the same-origin Next rewrite. Mutations carry both
 * sides of the double-submit CSRF check plus Origin; bypassing that boundary here would let every
 * UI fixture pass while the real acceptance form was broken. Already-current sessions are a no-op.
 */
export async function ensureBrowserLegalAcceptance(
  context: BrowserContext,
  companyId?: string | null,
): Promise<LegalAcceptanceStatus> {
  const resolvedCompanyId = await browserCompanyId(context, companyId);
  const endpoint = `${WEB_BASE_URL}/api/v1/auth/legal-acceptance`;
  const companyHeader = { 'X-Company-Id': resolvedCompanyId };
  const statusRes = await context.request.get(endpoint, { headers: companyHeader });
  expect(
    statusRes.ok(),
    `cookie GET /auth/legal-acceptance failed (${statusRes.status()}): ${await statusRes.text()}`,
  ).toBe(true);
  let status = (await statusRes.json()) as LegalAcceptanceStatus;
  if (!status.required) return status;

  const csrf = (await context.cookies(WEB_BASE_URL)).find((cookie) => cookie.name === CSRF_COOKIE)?.value;
  expect(csrf, `${CSRF_COOKIE} cookie is present after BFF login`).toBeTruthy();
  const mutationHeaders = {
    ...companyHeader,
    Origin: new URL(WEB_BASE_URL).origin,
    [CSRF_HEADER]: csrf!,
  };
  const accepted = await context.request.post(endpoint, {
    headers: mutationHeaders,
    data: acceptanceInput(status),
  });
  expect(
    accepted.ok(),
    `cookie POST /auth/legal-acceptance failed (${accepted.status()}): ${await accepted.text()}`,
  ).toBe(true);

  // Acceptance is checked from immutable DB evidence today, but refresh here too so fixtures keep
  // working if a later release also snapshots legal state into the access token.
  const refreshed = await context.request.post(`${WEB_BASE_URL}/api/auth/refresh`, {
    headers: { Origin: new URL(WEB_BASE_URL).origin, [CSRF_HEADER]: csrf! },
  });
  expect(
    refreshed.ok(),
    `session refresh after legal acceptance failed (${refreshed.status()}): ${await refreshed.text()}`,
  ).toBe(true);

  const verified = await context.request.get(endpoint, { headers: companyHeader });
  expect(
    verified.ok(),
    `verify GET /auth/legal-acceptance failed (${verified.status()}): ${await verified.text()}`,
  ).toBe(true);
  status = (await verified.json()) as LegalAcceptanceStatus;
  expect(status.required, 'legal acceptance is current after POST').toBe(false);
  return status;
}

/** Complete the clickwrap release for direct bearer-based API fixtures. */
export async function ensureBearerLegalAcceptance(
  request: APIRequestContext,
  token: string,
  companyId: string = COMPANY_ID,
): Promise<LegalAcceptanceStatus> {
  const endpoint = `${API_BASE_URL}/auth/legal-acceptance`;
  const headers = apiHeaders(token, companyId);
  const statusRes = await request.get(endpoint, { headers });
  expect(
    statusRes.ok(),
    `bearer GET /auth/legal-acceptance failed (${statusRes.status()}): ${await statusRes.text()}`,
  ).toBe(true);
  let status = (await statusRes.json()) as LegalAcceptanceStatus;
  if (!status.required) return status;

  const accepted = await request.post(endpoint, { headers, data: acceptanceInput(status) });
  expect(
    accepted.ok(),
    `bearer POST /auth/legal-acceptance failed (${accepted.status()}): ${await accepted.text()}`,
  ).toBe(true);

  const verified = await request.get(endpoint, { headers });
  expect(
    verified.ok(),
    `verify bearer GET /auth/legal-acceptance failed (${verified.status()}): ${await verified.text()}`,
  ).toBe(true);
  status = (await verified.json()) as LegalAcceptanceStatus;
  expect(status.required, 'bearer legal acceptance is current after POST').toBe(false);
  return status;
}

// Seeded identities (apps/api/prisma/seed.ts). Passwords are local-dev defaults.
export const SEED_USERS = {
  owner: { username: 'Owner', password: process.env['SEED_OWNER_PASSWORD'] ?? 'Owner@12345' },
  companyView: { username: 'Company', password: process.env['SEED_COMPANY_VIEW_PASSWORD'] ?? 'Company@123' },
  systemAdmin: {
    username: process.env['SEED_SYSTEM_ADMIN_USERNAME'] ?? 'thawatchai.watchdog',
    password: process.env['SEED_SYSTEM_ADMIN_PASSWORD'] ?? 'watchdogbms11',
  },
} as const;

/**
 * Authenticate a browser context as the seeded OWNER via the web BFF.
 * After this resolves, `context.newPage()` / any page in the context is logged in.
 */
export async function loginViaDevBff(context: BrowserContext): Promise<void> {
  const res = await context.request.post(`${WEB_BASE_URL}/api/auth/dev-login`, { data: {} });
  expect(
    res.ok(),
    `dev-login BFF failed (${res.status()}): ${await res.text()}\n` +
      `Is the web app up on ${WEB_BASE_URL} and the API on ${API_BASE_URL}?`,
  ).toBe(true);
  const body = (await res.json()) as { companyId?: string | null };
  await ensureBrowserLegalAcceptance(context, body.companyId);
}

/** Raw bearer access token for the seeded OWNER, for direct API calls. */
export async function getDevToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE_URL}/auth/dev/token`, { data: {} });
  expect(res.ok(), `dev token request failed (${res.status()}): ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { accessToken?: string };
  expect(body.accessToken, 'dev auth accessToken present').toBeTruthy();
  await ensureBearerLegalAcceptance(request, body.accessToken!, COMPANY_ID);
  return body.accessToken!;
}

/** Standard authed API headers. Company context header is required by the API for
 *  non-path-scoped endpoints (REQUIRE_COMPANY_CONTEXT=true, header X-Company-Id). */
export function apiHeaders(token: string, companyId: string = COMPANY_ID): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId };
}

/** Fails if any client-side auth/network error banner is visible on the page.
 *  Use as a lightweight invariant after every navigation. */
export async function expectNoClientError(page: import('@playwright/test').Page): Promise<void> {
  await expect(
    page.locator('text=/Request failed|Network request failed|Unauthorized|Forbidden|Something went wrong/i'),
  ).toHaveCount(0);
}
