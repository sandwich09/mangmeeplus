/**
 * REFERENCE SPEC — copy this shape for new suites. Proves the harness fixtures work.
 *
 * Conventions demonstrated here (see e2e/HANDOFF.md §Conventions):
 *   - Import test/expect from harness/fixtures, not @playwright/test.
 *   - Navigate by URL (robust) — do NOT click Thai nav labels to move between modules.
 *   - Assert a stable landmark (heading / role) per page.
 *   - Run expectNoClientError() after each navigation as an invariant.
 *   - Use the `api` fixture for backend truth-checks alongside UI assertions.
 *
 * Maps to test cases: SMOKE-01..SMOKE-03 in e2e/TEST-CASES.md.
 */
import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';

test.describe('@smoke reference — ready modules render under real auth', () => {
  test('SMOKE-01 dashboard loads with generate action', async ({ authedPage, companyId }) => {
    await authedPage.goto(`/companies/${companyId}/dashboard`);
    await expect(authedPage.getByRole('button', { name: /รีเฟรช|สร้างใหม่|refresh|generate/i })).toBeVisible();
    await expectNoClientError(authedPage);
  });

  test('SMOKE-02 core financial modules render', async ({ authedPage, companyId }) => {
    await authedPage.goto(`/companies/${companyId}/inventory`);
    await authedPage.getByRole('link', { name: /Products/i }).click();
    await expect(authedPage.getByRole('heading', { name: /Products/i })).toBeVisible();
    await expectNoClientError(authedPage);

    await authedPage.goto(`/companies/${companyId}/accounting`);
    await expect(authedPage.getByRole('heading', { name: /Accounting documents/i })).toBeVisible();
    await expectNoClientError(authedPage);

    await authedPage.goto(`/companies/${companyId}/reports`);
    await expect(authedPage.getByRole('heading', { name: /^(รายงาน|Reports and BI|Reports)$/i })).toBeVisible();
    // The export-center aside repeats the dataset title per export row — first() keeps strict mode happy.
    await expect(authedPage.getByText('Trial Balance', { exact: true }).first()).toBeVisible();
    await expectNoClientError(authedPage);
  });

  test('SMOKE-03 API health + company are reachable', async ({ api, companyId }) => {
    const health = await api.get('health');
    expect(health.ok(), `GET /health -> ${health.status()}`).toBe(true);

    const me = await api.get('auth/me');
    expect(me.ok(), `GET /auth/me -> ${me.status()}`).toBe(true);
    const body = (await me.json()) as { companyId?: string };
    expect(body.companyId).toBe(companyId);
  });
});
