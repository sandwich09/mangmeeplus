/**
 * Playwright fixtures for WatchDog-BMS E2E.
 *
 * Import `test` and `expect` from here instead of `@playwright/test` to get:
 *   - authedPage : a Page already logged in as the seeded OWNER (cookie session).
 *   - api        : an APIRequestContext pre-authed with bearer + X-Company-Id.
 *   - companyId  : the seeded company id ('seed-local-company').
 *   - urls       : { web, api } base URLs.
 *
 * Example:
 *   import { test, expect } from '../harness/fixtures';
 *   test('dashboard renders', async ({ authedPage, companyId }) => {
 *     await authedPage.goto(`/companies/${companyId}/dashboard`);
 *     await expect(authedPage.getByRole('button', { name: /สร้างใหม่|generate/i })).toBeVisible();
 *   });
 */
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  API_BASE_URL,
  COMPANY_ID,
  WEB_BASE_URL,
  apiHeaders,
  getDevToken,
  loginViaDevBff,
} from './auth';
import { getRoleToken, loginAs, type RoleKey } from './roles';
import { watchScreenFit } from './screen-fit';

type Fixtures = {
  companyId: string;
  urls: { web: string; api: string };
  authedPage: Page;
  api: APIRequestContext;
  /** A page logged in as any seeded QA role. Each call gets its own browser context,
   *  so one test can hold several roles at once (e.g. Finance certifies, Owner approves). */
  pageAs: (role: RoleKey) => Promise<Page>;
  /** An APIRequestContext carrying that role's bearer token + X-Company-Id. */
  apiAs: (role: RoleKey) => Promise<APIRequestContext>;
};

export const test = base.extend<Fixtures>({
  context: async ({ context }, use, info) => {
    const finish = watchScreenFit(context, info);
    await use(context);
    await finish();
  },
  companyId: async ({}, use) => {
    await use(COMPANY_ID);
  },

  urls: async ({}, use) => {
    await use({ web: WEB_BASE_URL, api: API_BASE_URL });
  },

  // A logged-in page. Auth is installed on the context before the page is handed over.
  authedPage: async ({ context }, use) => {
    await loginViaDevBff(context);
    const page = await context.newPage();
    await use(page);
    await page.close();
  },

  // A request context carrying the seeded OWNER bearer + company header.
  api: async ({ playwright, request }, use) => {
    const token = await getDevToken(request);
    const ctx = await playwright.request.newContext({
      baseURL: `${API_BASE_URL.replace(/\/$/, '')}/`,
      extraHTTPHeaders: apiHeaders(token),
    });
    await use(ctx);
    await ctx.dispose();
  },

  // Role-scoped browser sessions. A fresh context per role keeps cookies from colliding —
  // the auth cookies are chunked on one name, so two roles in one context overwrite each other.
  pageAs: async ({ browser, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent }, use, info) => {
    const opened: Page[] = [];
    const contexts: import('@playwright/test').BrowserContext[] = [];
    const finish: Array<() => Promise<void>> = [];
    await use(async (role: RoleKey) => {
      const context = await browser.newContext({ baseURL: WEB_BASE_URL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent });
      contexts.push(context);
      finish.push(watchScreenFit(context, info));
      await loginAs(context, role);
      const page = await context.newPage();
      opened.push(page);
      return page;
    });
    try { for (const check of finish) await check(); }
    finally {
      for (const page of opened) await page.close().catch(() => {});
      for (const context of contexts) await context.close().catch(() => {});
    }
  },

  apiAs: async ({ playwright, request }, use) => {
    const made: APIRequestContext[] = [];
    await use(async (role: RoleKey) => {
      const token = await getRoleToken(request, role);
      const ctx = await playwright.request.newContext({
        baseURL: `${API_BASE_URL.replace(/\/$/, '')}/`,
        extraHTTPHeaders: apiHeaders(token),
      });
      made.push(ctx);
      return ctx;
    });
    for (const ctx of made) await ctx.dispose().catch(() => {});
  },
});

export { expect };
