import { hasAiSuggestionSourceAccess } from '@watchdog-bms/contracts';
import type { Page } from '@playwright/test';
import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { gotoCompany, json } from './harness/e2e-utils';

type Suggestion = { id: string; title: string; status: string };
type SuggestionPage = { items?: Suggestion[]; data?: Suggestion[] };

async function canOpenHub(page: Page, companyId: string): Promise<boolean> {
  const response = await page.request.get('/api/v1/auth/me', { headers: { 'X-Company-Id': companyId } });
  expect(response.ok()).toBeTruthy();
  const { permissions } = await response.json() as { permissions: string[] };
  return hasAiSuggestionSourceAccess(permissions) && permissions.some(permission => ['ai.suggestion.read', 'ai.suggestion.read_own'].includes(permission));
}

async function expectForbidden(page: Page) {
  await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: /^กลับไป/ })).toBeVisible();
  await expect(page.locator('a[href$="/ai-suggestions"]')).toHaveCount(0);
  await expectNoClientError(page);
}

test.describe('AISUG — AI suggestions', () => {
  test('AISUG-01 @smoke AI suggestions inbox renders with provider disabled or empty state', async ({ authedPage, companyId }) => {
    const allowed = await canOpenHub(authedPage, companyId);
    await gotoCompany(authedPage, companyId, '/ai-suggestions');
    if (!allowed) { await expectForbidden(authedPage); return; }
    await expect(authedPage.getByRole('heading', { name: /คำแนะนำจาก AI|AI Suggestions/i })).toBeVisible();
    await expect(authedPage.getByRole('link', { name: 'AI แนะนำ', exact: true })).toBeVisible();
    await expect(authedPage.getByText(/โหมดผู้ให้บริการ AI|ไม่มีคำแนะนำ|suggestion/i).first()).toBeVisible();
  });

  test('AISUG-02 @p1 opens a seeded suggestion when one exists', async ({ authedPage, api, companyId }) => {
    if (!await canOpenHub(authedPage, companyId)) {
      await gotoCompany(authedPage, companyId, '/ai-suggestions');
      await expectForbidden(authedPage); return;
    }
    const body = await json<SuggestionPage>(await api.get(`companies/${companyId}/ai/suggestions?pageSize=10`));
    const suggestions = body.items ?? body.data ?? [];
    await gotoCompany(authedPage, companyId, '/ai-suggestions');
    if (suggestions.length === 0) {
      await expect(authedPage.getByText(/ไม่มีคำแนะนำ|No suggestions/i).first()).toBeVisible();
      return;
    }

    await authedPage.getByText(suggestions[0].title).first().click();
    await expect(authedPage.getByText(suggestions[0].title).first()).toBeVisible();
    await expect(authedPage.getByText(/ความเสี่ยง|risk|confidence|สร้างร่าง|ปิดคำแนะนำ/i).first()).toBeVisible();
    await expectNoClientError(authedPage);
  });
});
