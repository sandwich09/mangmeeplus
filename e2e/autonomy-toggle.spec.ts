import { test, expect } from './harness/fixtures';
import { gotoCompany, json } from './harness/e2e-utils';

type Conversation = { id: string; autoReplyEnabled: boolean };
type ConversationPage = { items: Conversation[] };
type MessagingChannel = {
  id: string;
  displayName: string;
  autoReplyEnabled?: boolean;
  autoReplyDailyCap?: number;
};

test.describe('AUTON — AI autonomy toggles', () => {
  test('AUTON-01 @p2 per-conversation AI toggle persists across reload and API read-back', async ({ authedPage, api, companyId }) => {
    const conversations = await json<ConversationPage>(await api.get(`companies/${companyId}/crm/conversations?pageSize=5`));
    const conversation = conversations.items[0];
    expect(conversation, 'seeded conversation').toBeDefined();
    const original = conversation.autoReplyEnabled;

    try {
      await gotoCompany(authedPage, companyId, `/inbox?conversation=${conversation.id}`);
      const toggle = authedPage.getByRole('checkbox', { name: 'AI ตอบแชทนี้' });
      await expect(toggle).toBeChecked({ checked: original });
      // Controlled input: the checkbox flips only after the PUT round-trip, so
      // setChecked (which asserts an immediate state change) always throws here.
      await toggle.click();
      await expect.poll(async () =>
        (await json<Conversation>(await api.get(`companies/${companyId}/crm/conversations/${conversation.id}`))).autoReplyEnabled,
      ).toBe(!original);
      await expect(toggle).toBeChecked({ checked: !original });

      await authedPage.reload();
      await expect(authedPage.getByRole('checkbox', { name: 'AI ตอบแชทนี้' })).toBeChecked({ checked: !original });
    } finally {
      await json<Conversation>(await api.put(`companies/${companyId}/crm/conversations/${conversation.id}/auto-reply`, {
        data: { enabled: original },
      }));
    }
  });

  test('AUTON-02 @p2 LINE OA channel autonomy saves through settings and API', async ({ authedPage, api, companyId }) => {
    const channels = await json<MessagingChannel[]>(await api.get(`companies/${companyId}/crm/channels`));
    const channel = channels.find((item) => item.id === 'seed-room45-line-channel') ?? channels.find((item) => item.autoReplyEnabled !== undefined);
    expect(channel, 'seeded manageable LINE OA channel').toBeDefined();
    const originalEnabled = channel!.autoReplyEnabled!;
    const originalCap = channel!.autoReplyDailyCap!;
    const expectedEnabled = !originalEnabled;
    const expectedCap = originalCap + 1;

    try {
      await gotoCompany(authedPage, companyId, '/settings/line-oa');
      const channelCard = authedPage.getByRole('heading', { name: channel!.displayName, exact: true })
        .locator('..').locator('..').locator('..');
      await channelCard.getByRole('switch', { name: 'เปิดระบบตอบอัตโนมัติ' }).click();
      await channelCard.getByRole('spinbutton', { name: 'จำนวนตอบอัตโนมัติสูงสุดต่อวัน' }).fill(String(expectedCap));
      await channelCard.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click();
      await expect(channelCard.getByText('บันทึกการตั้งค่าระบบตอบอัตโนมัติแล้ว', { exact: true })).toBeVisible();

      const persisted = await json<MessagingChannel[]>(await api.get(`companies/${companyId}/crm/channels`));
      expect(persisted.find((item) => item.id === channel!.id)).toMatchObject({
        autoReplyEnabled: expectedEnabled,
        autoReplyDailyCap: expectedCap,
      });
    } finally {
      await json<MessagingChannel>(await api.patch(`companies/${companyId}/crm/channels/${channel!.id}/settings`, {
        data: { autoReplyEnabled: originalEnabled, autoReplyDailyCap: originalCap },
      }));
    }
  });
});
