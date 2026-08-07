import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { gotoCompany, json } from './harness/e2e-utils';

type NotificationPage = { items: unknown[] };
type Preference = { enabledChannels: string[]; enabledTriggerKeys: string[] };
type Rule = { id: string; name?: string; status?: string };

test.describe('NOTIF — notifications', () => {
  test('NOTIF-01 @smoke notifications list renders', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/notifications');
    await expect(authedPage.getByRole('heading', { name: /ศูนย์การแจ้งเตือน|Notifications/i })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /อ่านทั้งหมด|Read all/i })).toBeVisible();
    // Scoped to main: the sidebar carries "ตั้งค่าบริษัท" and a "ตั้งค่าใบรับรองแทนใบเสร็จ"
    // dropdown item, so an unscoped /ตั้งค่า/ matches three links and trips strict mode.
    await expect(authedPage.locator('main').getByRole('link', { name: /ตั้งค่า|Preferences|Settings/i })).toBeVisible();
  });

  test('NOTIF-02 @p1 preferences form renders and API exposes channels', async ({ authedPage, api, companyId }) => {
    await gotoCompany(authedPage, companyId, '/notifications/preferences');
    await expect(authedPage.getByRole('heading', { name: /ตั้งค่าการแจ้งเตือน|Notification settings/i })).toBeVisible();
    await expect(authedPage.getByText(/Web|LINE/i).first()).toBeVisible();
    await expectNoClientError(authedPage);

    const prefs = await json<Preference>(await api.get(`companies/${companyId}/notification-preferences`));
    expect(Array.isArray(prefs.enabledChannels)).toBe(true);
  });

  test('NOTIF-03 @p1 rules list renders', async ({ authedPage, api, companyId }) => {
    await gotoCompany(authedPage, companyId, '/notifications/rules');
    await expect(authedPage.getByRole('heading', { name: /กฎการแจ้งเตือน|Notification rules/i })).toBeVisible();
    await expect(authedPage.getByText(/เปิดใช้งาน|ปิดใช้งาน|Enabled|Disabled/i).first()).toBeVisible();

    const rules = await json<Rule[]>(await api.get(`companies/${companyId}/notification-rules`));
    expect(Array.isArray(rules)).toBe(true);
  });

  test('NOTIF-04 @p1 notifications API returns items array', async ({ api, companyId }) => {
    const body = await json<NotificationPage>(await api.get(`companies/${companyId}/notifications?pageSize=5`));
    expect(Array.isArray(body.items)).toBe(true);
  });
});
