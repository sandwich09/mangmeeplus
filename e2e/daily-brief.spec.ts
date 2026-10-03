import { test, expect } from './harness/fixtures';
import type { Locator } from '@playwright/test';
import { gotoCompany } from './harness/e2e-utils';

async function linkUrl(link: Locator) {
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  return new URL(href!, 'http://localhost');
}

test.describe('BRIEF — dashboard daily brief', () => {
  test('BRIEF-01 @p2 renders widgets with honest deep-link parameter shapes', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/dashboard');
    const monthBrief = authedPage.waitForResponse((res) =>
      res.url().includes(`/companies/${companyId}/crm/daily-brief`)
      && new URL(res.url()).searchParams.get('period') === 'month',
    );
    await authedPage.getByRole('button', { name: 'เดือนนี้' }).click();
    await monthBrief;
    // The summary has been a closed section since 2026-09-17: its cards exist only once it is opened.
    await authedPage.getByText('สรุปงานลูกค้าและการขาย').click();
    await expect(authedPage.getByText('สรุปงานลูกค้า (CRM)', { exact: true })).toBeVisible();

    const overdue = await linkUrl(authedPage.getByRole('link', { name: /รอตอบเกินกำหนด/ }));
    expect(overdue.pathname).toBe(`/companies/${companyId}/inbox`);
    expect(Object.fromEntries(overdue.searchParams)).toEqual({ overdue: 'true' });

    const unanswered = await linkUrl(authedPage.getByRole('link', { name: /ยังไม่ได้ตอบ/ }));
    expect(unanswered.pathname).toBe(`/companies/${companyId}/inbox`);
    expect(Object.fromEntries(unanswered.searchParams)).toEqual({ unanswered: 'true' });

    // No tag param by design: the widget counts complaint AND escalation tags
    // case-insensitively while the inbox tag filter is exact — a tag link would
    // hide counted conversations (joint-review fix 511a6b13).
    const complaints = await linkUrl(authedPage.getByRole('link', { name: /ข้อร้องเรียนยังไม่จบ/ }));
    expect(complaints.pathname).toBe(`/companies/${companyId}/inbox`);
    expect(Object.fromEntries(complaints.searchParams)).toEqual({});

    const pipeline = await linkUrl(authedPage.getByRole('link', { name: /มูลค่าดีลเปิด/ }));
    expect(pipeline.pathname).toBe(`/companies/${companyId}/crm`);
    expect(Object.fromEntries(pipeline.searchParams)).toEqual({ tab: 'pipeline' });

    const quotations = await linkUrl(authedPage.getByRole('link', { name: /ใบเสนอรอลูกค้าตอบรับ/ }));
    expect(quotations.pathname).toBe(`/companies/${companyId}/sales-documents`);
    expect(Object.fromEntries(quotations.searchParams)).toEqual({ documentType: 'QUOTATION' });
    expect(quotations.searchParams.has('status')).toBe(false);
    expect(quotations.searchParams.has('overdue')).toBe(false);

    const reports = await linkUrl(authedPage.getByRole('link', { name: /ตอบครั้งแรกเฉลี่ย เดือนนี้/ }));
    expect(reports.pathname).toBe(`/companies/${companyId}/crm-reports`);
    expect(Object.fromEntries(reports.searchParams)).toEqual({ period: 'month' });
  });

  // Browser check 2026-10-03: "ยังไม่ได้ตอบ" counted by the customer's owner and opened the whole inbox (owner 7 against
  // 14 chats). The card now opens the inbox's own unanswered list for the same viewer: its number is that list's total,
  // and the list's chip is on and in view, also on a phone, where it sits past the strip's edge.
  for (const width of [390, 1280]) {
    test(`BRIEF-02 @p2 ${width}px "ยังไม่ได้ตอบ" opens a list of exactly its number of chats, its chip on and in view`, async ({ authedPage, companyId }) => {
      await authedPage.setViewportSize({ width, height: 900 });
      await gotoCompany(authedPage, companyId, '/dashboard');
      await authedPage.getByText('สรุปงานลูกค้าและการขาย').click();
      const card = authedPage.getByRole('link', { name: /ยังไม่ได้ตอบ/ });
      const count = Number((await card.innerText()).match(/\d+/)?.[0]);
      const list = authedPage.waitForResponse((res) => res.url().includes(`/companies/${companyId}/crm/conversations?`)
        && new URL(res.url()).searchParams.get('unanswered') === 'true');
      await card.click();
      await expect(authedPage).toHaveURL(new RegExp(`/companies/${companyId}/inbox\\?unanswered=true$`));
      expect((await (await list).json()).total).toBe(count);
      if (count > 0) await expect(authedPage.getByRole('button', { name: `ยังไม่ได้ตอบ ${count}` })).toBeInViewport({ ratio: 1 });
    });
  }
});
