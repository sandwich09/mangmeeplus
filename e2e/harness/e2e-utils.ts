import { expect, type APIResponse, type Page } from '@playwright/test';
import { expectNoClientError } from './auth';

export function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function gotoCompany(page: Page, companyId: string, path: string) {
  await page.goto(`/companies/${companyId}${path}`);
  await expectNoClientError(page);
}

export async function expectMainReady(page: Page) {
  await expect(page.locator('main, [role="main"], #workspace-main').first()).toBeVisible();
}

export async function expectOk(res: APIResponse) {
  if (!res.ok()) {
    expect(res.ok(), `${res.url()} -> ${res.status()}: ${await res.text()}`).toBe(true);
  }
}

export async function json<T>(res: APIResponse) {
  await expectOk(res);
  return (await res.json()) as T;
}
