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
    await expect(authedPage.getByText('สรุปงานลูกค้า (CRM)', { exact: true })).toBeVisible();

    const overdue = await linkUrl(authedPage.getByRole('link', { name: /เกิน SLA/ }));
    expect(overdue.pathname).toBe(`/companies/${companyId}/inbox`);
    expect(Object.fromEntries(overdue.searchParams)).toEqual({ overdue: 'true' });

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
});
