/**
 * Shared auth harness for WatchDog-BMS E2E.
 *
 * Two auth paths, pick per test type:
 *
 *  1. loginViaDevBff(context)  — browser/UI tests.
 *     POSTs the web app's own BFF route `/api/auth/dev-login`, which exchanges the
 *     seeded OWNER dev token for a real httpOnly cookie session and sets the chunked
 *     `watchdog_token.*` + `watchdog_csrf` cookies on the browser context automatically.
 *     This is the closest thing to a real login and is the DEFAULT for UI specs.
 *
 *  2. getDevToken(request) + apiHeaders() — direct API assertions.
 *     Requests a raw bearer access token from the API dev endpoint for `request.get/post`.
 *
 * Both are gated by AUTH_PROVIDER=dev / DEV_AUTH_ENABLED=true (local only; the API
 * 404s these outside APP_ENV=local). Never ships to prod.
 */
import { expect, type APIRequestContext, type BrowserContext } from '@playwright/test';

export const COMPANY_ID = process.env['E2E_COMPANY_ID'] ?? 'seed-local-company';

export const WEB_BASE_URL =
  process.env['E2E_WEB_BASE_URL'] ?? `http://127.0.0.1:${process.env['WEB_PORT'] ?? '3000'}`;

export const API_BASE_URL =
  process.env['E2E_API_BASE_URL'] ?? `http://127.0.0.1:${process.env['API_PORT'] ?? '3001'}/v1`;

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
}

/** Raw bearer access token for the seeded OWNER, for direct API calls. */
export async function getDevToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE_URL}/auth/dev/token`, { data: {} });
  expect(res.ok(), `dev token request failed (${res.status()}): ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { accessToken?: string };
  expect(body.accessToken, 'dev auth accessToken present').toBeTruthy();
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
