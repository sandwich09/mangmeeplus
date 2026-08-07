import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { gotoCompany, json } from './harness/e2e-utils';

type WorkflowTemplate = { key: string; name: string; description?: string; status?: string };

test.describe('WF — workflow', () => {
  test('WF-01 @smoke workflow page renders seeded template catalog', async ({ authedPage, api, companyId }) => {
    const templates = await json<WorkflowTemplate[]>(await api.get(`companies/${companyId}/workflow/templates`));
    expect(templates.length).toBeGreaterThan(0);

    await gotoCompany(authedPage, companyId, '/workflow');
    await expect(authedPage.getByRole('heading', { name: /Workflow Automation|ระบบอัตโนมัติ/i })).toBeVisible();
    await expect(authedPage.getByText(templates[0].name).first()).toBeVisible();
  });

  test('WF-02 @p1 opens a workflow template definition', async ({ authedPage, api, companyId }) => {
    const templates = await json<WorkflowTemplate[]>(await api.get(`companies/${companyId}/workflow/templates`));
    await gotoCompany(authedPage, companyId, '/workflow');
    await authedPage.getByText(templates[0].name).first().click();
    await expect(authedPage.getByText(/เงื่อนไข|Condition|Action|การทำงาน/i).first()).toBeVisible();
    await expectNoClientError(authedPage);
  });
});
