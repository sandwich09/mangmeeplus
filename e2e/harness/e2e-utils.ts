import { expect, type APIResponse, type Locator, type Page } from '@playwright/test';
import { expectNoClientError } from './auth';

export function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Pick an option from a ThemedSelect (`common/components/field/ThemedSelect.tsx`): a
 * details/summary combobox whose option list is portaled and only exists while open, so
 * `selectOption()` — which needs a real <select> — cannot drive it. Open, then click the option.
 */
export async function chooseThemedOption(page: Page, trigger: Locator, optionName: string) {
  await trigger.click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

/** Mirrors `branchDisplayName` (web-core-workspace/branch-scope-label.logic.ts) in Thai. */
export function branchOptionName(branch: { name: string; type: string }) {
  return branch.name + (branch.type === 'HEAD_OFFICE' ? ' (สำนักงานใหญ่)' : '');
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
