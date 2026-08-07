import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { gotoCompany, json } from './harness/e2e-utils';

type Conversation = { id: string; customerDisplayName?: string; status?: string; autoReplyEnabled: boolean };
type ConversationPage = { items: Conversation[] };
type Customer = { id: string; displayName: string; tier?: string };
// Customer identity management wrapped list items in a projection envelope.
type CustomerPage = { items: { projection: string; customer: Customer }[] };
type MessagingChannel = {
  id: string;
  displayName: string;
  lineChannelId: string;
  autoReplyEnabled?: boolean;
  autoReplyDailyCap?: number;
};

test.describe('CRM — inbox, customers, payment proofs', () => {
  test('CRM-01 @smoke conversation inbox renders seeded conversations', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inbox');
    await expect(authedPage.getByText(/กล่องข้อความ|Inbox/i).first()).toBeVisible();
    await expect(authedPage.getByText(/คุณพิม|คุณจอย/).first()).toBeVisible();
    await expect(authedPage.getByText(/ใหม่|กำลังคุย|รอลูกค้า|New|Open/i).first()).toBeVisible();
  });

  test('CRM-02 @p1 opens a conversation thread with composer', async ({ authedPage, api, companyId }) => {
    const body = await json<ConversationPage>(await api.get(`companies/${companyId}/crm/conversations?pageSize=5`));
    expect(body.items.length).toBeGreaterThan(0);

    await gotoCompany(authedPage, companyId, '/inbox');
    const name = body.items[0].customerDisplayName ?? '';
    if (name) await authedPage.getByText(name).first().click();
    else await authedPage.locator('main button, main a').first().click();
    await expect(authedPage.getByRole('textbox', { name: /พิมข้อความ|พิมพ์ข้อความ|message/i }).first()).toBeVisible();
    await expectNoClientError(authedPage);
  });

  test('CRM-03 @p1 NEW status filter applies without client error', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inbox');
    await authedPage.getByRole('button', { name: /ใหม่|New/i }).first().click();
    await expect(authedPage.getByText(/ใหม่|New/i).first()).toBeVisible();
    await expectNoClientError(authedPage);
  });

  test('CRM-04 @p1 CRM pipeline renders stages and deals', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/crm');
    await expect(authedPage.getByRole('heading', { name: /CRM และการขาย|CRM/i })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /ไปป์ไลน์|Pipeline/i })).toBeVisible();
    await expect(authedPage.getByText(/ดีล|Deal|Pipeline|Lead/i).first()).toBeVisible();
  });

  test('CRM-05 @p1 seeded customer 360 renders profile tabs', async ({ authedPage, api, companyId }) => {
    const customers = await json<CustomerPage>(await api.get(`companies/${companyId}/crm/customers?pageSize=10`));
    expect(customers.items.length).toBeGreaterThan(0);
    const customer = customers.items[0].customer;

    await gotoCompany(authedPage, companyId, `/crm/customers/${customer.id}`);
    await expect(authedPage.getByRole('heading', { name: new RegExp(customer.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
    for (const label of [/ภาพรวม|Overview/i, /ไทม์ไลน์|Timeline/i, /การสนทนา|Conversation/i, /ดีล|Deal/i]) {
      await expect(authedPage.getByText(label).first()).toBeVisible();
    }
  });

  test('CRM-06 @p1 payment-proof review page renders', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/crm/payment-proofs');
    await expect(authedPage.getByRole('heading', { name: /หลักฐานการชำระเงิน|Payment proofs/i })).toBeVisible();
    await expect(authedPage.getByText(/รอตรวจสอบ|ยังไม่มี|review/i).first()).toBeVisible();
  });

  test('CRM-07 @p1 persists seeded LINE OA autonomy settings', async ({ authedPage, api, companyId }) => {
    const channels = await json<MessagingChannel[]>(await api.get(`companies/${companyId}/crm/channels`));
    const channel = channels.find((item) => item.id === 'seed-room45-line-channel');
    expect(channel, 'seeded Room45 LINE OA channel').toBeDefined();
    expect(channel!.autoReplyEnabled, 'crm.channel.manage exposes auto-reply toggle').toBeDefined();
    expect(channel!.autoReplyDailyCap, 'crm.channel.manage exposes auto-reply cap').toBeDefined();

    const originalEnabled = channel!.autoReplyEnabled!;
    const originalCap = channel!.autoReplyDailyCap!;
    const expectedEnabled = !originalEnabled;
    const expectedCap = originalCap + 1;

    try {
      await gotoCompany(authedPage, companyId, '/settings/line-oa');
      const channelCard = authedPage.getByRole('heading', { name: channel!.displayName, exact: true })
        .locator('..').locator('..').locator('..');
      const enabled = channelCard.getByRole('switch', { name: 'เปิดระบบตอบอัตโนมัติ' });
      const cap = channelCard.getByRole('spinbutton', { name: 'จำนวนตอบอัตโนมัติสูงสุดต่อวัน' });
      const save = channelCard.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true });
      await expect(save).toBeEnabled();
      await enabled.click();
      await cap.fill(String(expectedCap));
      await save.click();
      await expect(channelCard.getByText('บันทึกการตั้งค่าระบบตอบอัตโนมัติแล้ว')).toBeVisible();

      await authedPage.reload();
      const reloadedCard = authedPage.getByRole('heading', { name: channel!.displayName, exact: true })
        .locator('..').locator('..').locator('..');
      await expect(reloadedCard.getByRole('switch', { name: 'เปิดระบบตอบอัตโนมัติ' })).toBeChecked({ checked: expectedEnabled });
      await expect(reloadedCard.getByRole('spinbutton', { name: 'จำนวนตอบอัตโนมัติสูงสุดต่อวัน' })).toHaveValue(String(expectedCap));

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

  test('CRM-08 @p1 customers API returns seeded customers', async ({ api, companyId }) => {
    const customers = await json<CustomerPage>(await api.get(`companies/${companyId}/crm/customers?pageSize=10`));
    expect(customers.items.length).toBeGreaterThan(0);
    expect(customers.items.some((item) => item.customer.displayName)).toBe(true);
  });

  test('CRM-09 @p1 toggles autonomous AI for one conversation from the inbox header', async ({ authedPage, api, companyId }) => {
    const conversations = await json<ConversationPage>(await api.get(`companies/${companyId}/crm/conversations?pageSize=5`));
    const conversation = conversations.items[0];
    expect(conversation, 'seeded conversation').toBeDefined();
    const originalEnabled = conversation.autoReplyEnabled;

    try {
      await gotoCompany(authedPage, companyId, `/inbox?conversation=${conversation.id}`);
      const toggle = authedPage.getByRole('checkbox', { name: 'AI ตอบแชทนี้' });
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeChecked({ checked: originalEnabled });
      // Controlled input: the checkbox flips only after the PUT round-trip —
      // setChecked asserts an immediate flip and races it (same as AUTON-01).
      await toggle.click();
      await expect(toggle).toBeChecked({ checked: !originalEnabled });
      if (originalEnabled) {
        await expect(authedPage.getByText('AI ปิดอยู่ (แชทนี้) — พนักงานตอบเอง')).toBeVisible();
      }

      const persisted = await json<Conversation>(await api.get(`companies/${companyId}/crm/conversations/${conversation.id}`));
      expect(persisted.autoReplyEnabled).toBe(!originalEnabled);
      await expectNoClientError(authedPage);
    } finally {
      await json<Conversation>(await api.put(`companies/${companyId}/crm/conversations/${conversation.id}/auto-reply`, {
        data: { enabled: originalEnabled },
      }));
    }
  });

  test.skip('LIFF-REGISTER @p2 blocked: AUTH_PROVIDER=dev does not stub LineLoginVerifierAdapter; customer-register requires a real LINE idToken verified by api.line.me', async () => {});
});
