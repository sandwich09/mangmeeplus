import { expect, type APIRequestContext, type APIResponse, type Locator, type Page } from '@playwright/test';
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

/**
 * The company's first ACTIVE branch.
 *
 * The seeded company is multi-branch (`prisma/seed.ts` adds the Room45 branches beside Head
 * Office), so `resolveTransactionBranchId` refuses to default one and every transactional create
 * that names no branch comes back 422 `TRANSACTION_BRANCH_REQUIRED`
 * ('กรุณาเลือกสาขาของรายการก่อนบันทึก'). Only *root* creates need this: a document, payment or
 * receipt derived from a source inherits the source's branch.
 */
export async function firstActiveBranch(api: APIRequestContext, companyId: string) {
  const { items } = await json<{ items: Array<{ id: string; name: string; type: string }> }>(
    await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`),
  );
  expect(items[0], 'the seeded company must expose at least one ACTIVE branch').toBeTruthy();
  return items[0]!;
}

/**
 * Make the header's branch selector resolve to one branch before the app boots.
 *
 * Forms that carry no branch field of their own read `useBranchFilter()` (see the vendor-bill form
 * in `AccountsPayablePages.tsx`), which is blank until the person picks a branch, and the create
 * then 422s with TRANSACTION_BRANCH_REQUIRED on a multi-branch company. `WorkspaceScope.tsx`
 * restores that choice from localStorage on mount, so seeding the key is the same starting state a
 * returning user has. Register it before the page navigates.
 */
export async function useWorkspaceBranch(page: Page, companyId: string, branchId: string) {
  const { userId } = await json<{ userId: string }>(await page.request.get('/api/v1/auth/me', {
    headers: { 'X-Company-Id': companyId },
  }));
  await page.context().addInitScript(
    ([key, id]) => window.localStorage.setItem(key!, id!),
    [`watchdog.branchFilter.${companyId}.${userId}`, branchId],
  );
}

/**
 * Answer the company's VAT registration once, so accounting documents can be created at all.
 *
 * `prisma/seed.ts` fills only the deprecated `CompanyTaxProfile.vatRegistered` bit; the
 * authoritative source is `CompanyVatRegistrationFact`, which the seed never writes, so a freshly
 * seeded company reads UNKNOWN and `document.use-case.ts` / `record-simple-income.use-case.ts`
 * refuse every create with 'Company VAT registration status must be confirmed…'. This sits behind
 * the branch guard, which used to fire first and hide it.
 *
 * Idempotent, and safe under parallel workers: it answers only while the status is UNKNOWN, reuses
 * one commandId so a replay is a no-op, and treats a rejected write as "another worker won".
 */
export async function ensureVatRegistrationAnswered(api: APIRequestContext, companyId: string): Promise<void> {
  const path = `companies/${companyId}/vat-registration`;
  const current = await json<{ status: string; version: number }>(await api.get(path));
  if (current.status !== 'UNKNOWN') return;
  const written = await api.put(path, { data: {
    commandId: `e2e-vat-answer-${companyId}`.slice(0, 64),
    expectedVersion: current.version,
    command: { kind: 'UPSERT_FACT', status: 'REGISTERED', effectiveFrom: '2020-01-01' },
  } });
  if (written.ok()) return;
  const after = await json<{ status: string }>(await api.get(path));
  expect(after.status, `VAT registration is still UNKNOWN: ${await written.text()}`).not.toBe('UNKNOWN');
}
