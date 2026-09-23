/**
 * Sales console (spec §12, plan Phase 2) end to end at 390 px — the width a เซลล์ actually works at.
 *
 * The journey, in one test because each leg is the previous leg's output:
 *   หัวหน้า signs in → creates a เซลล์ (one-time password shown once on screen)
 *   → that เซลล์ signs in with it and is forced to change it
 *   → เซลล์ creates a deal for a seeded shop and sends it for approval
 *   → หัวหน้า approves it, and the shop's deal is APPROVED with an expiry.
 *
 * The two starting accounts are seeded by `apps/api/prisma/seed.ts` (`SEED_SALES_AGENTS`).
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { WEB_BASE_URL, ensureBrowserLegalAcceptance } from './harness/auth';

const LEAD = { username: 'qa.mangmee.lead', password: 'Qa@MangmeeLead123' };
const PHONE = { width: 390, height: 844 };

/** Sign in through the real BFF route, exactly as a human does, and land on the console. */
async function signIn(browser: Browser, username: string, password: string): Promise<Page> {
  const context = await browser.newContext({ viewport: PHONE });
  const res = await context.request.post(`${WEB_BASE_URL}/api/auth/login`, {
    data: { username, password, remember: true },
  });
  expect(res.ok(), `login as ${username} failed (${res.status()}): ${await res.text()}\n`
    + 'Re-seed the DB — SEED_SALES_AGENTS is repaired on every seed run.').toBe(true);
  return context.newPage();
}

test.describe('SALES — ทีมขายมั่งมี console', () => {
  test('SALES-01 @p1 lead creates an agent, the agent creates a deal, the lead approves it', async ({ browser }) => {
    const leadPage = await signIn(browser, LEAD.username, LEAD.password);
    // Fresh seed writes no legal-acceptance rows — every /sales/* route redirects there first.
    await ensureBrowserLegalAcceptance(leadPage.context());

    // ── the console is the landing area, and /system stays closed to it (S07) ──
    await leadPage.goto(`${WEB_BASE_URL}/sales/deals`);
    await expect(leadPage.getByRole('heading', { name: 'ดีล' })).toBeVisible();
    await leadPage.goto(`${WEB_BASE_URL}/system/partners`);
    // SystemAccessDenied renders both a heading and a description containing "ไม่มีสิทธิ์" —
    // .first() avoids a strict-mode violation from the regex matching both.
    await expect(leadPage.getByText(/ไม่มีสิทธิ์|ไม่ได้รับอนุญาต/).first()).toBeVisible();

    // ── create a เซลล์ and capture the one-time password (Q3/S28) ──
    const username = `e2e.sales.${Date.now()}`;
    await leadPage.goto(`${WEB_BASE_URL}/sales/team`);
    await leadPage.getByRole('button', { name: 'เพิ่มบัญชี' }).click();
    await leadPage.getByLabel('ชื่อผู้ใช้').fill(username);
    await leadPage.getByLabel('ชื่อที่แสดง').fill('E2E เซลล์');
    await leadPage.getByRole('button', { name: 'สร้างบัญชี' }).click();

    await expect(leadPage.getByText('แสดงครั้งเดียว')).toBeVisible();
    const temporaryPassword = (await leadPage.getByTestId('sales-temporary-password').innerText()).trim();
    expect(temporaryPassword.length).toBeGreaterThan(5);

    // ── the new เซลล์ signs in and is forced through the password gate ──
    const newPassword = `E2e@Sales${Date.now()}`;
    const agentContext = await browser.newContext({ viewport: PHONE });
    const loginRes = await agentContext.request.post(`${WEB_BASE_URL}/api/auth/login`, {
      data: { username, password: temporaryPassword, remember: true },
    });
    expect(loginRes.ok()).toBe(true);
    expect(((await loginRes.json()) as { passwordChangeRequired?: boolean }).passwordChangeRequired).toBe(true);

    const agentPage = await agentContext.newPage();
    await agentPage.goto(`${WEB_BASE_URL}/sales/deals`);
    await expect(agentPage).toHaveURL(/\/change-password/);
    await agentPage.locator('input[name="new-password"]').fill(newPassword);
    await agentPage.locator('input[name="confirm-password"]').fill(newPassword);
    await agentPage.getByRole('button', { name: /บันทึก|เปลี่ยนรหัสผ่าน/ }).click();
    await expect(agentPage).not.toHaveURL(/\/change-password/, { timeout: 15_000 });
    // ChangePasswordPage ends the session on success by design (see its handleSubmit) and sends
    // the browser to /login. Sign back in through the real form rather than a parallel API call —
    // a raw context.request.post here races the login page's own client-side session check over
    // the same refresh token and trips reuse-detection ("Session is expired or revoked"); driving
    // the page itself (line-recovery.spec.ts's proven pattern) leaves only one thing logging in.
    await expect(agentPage).toHaveURL(/\/login/);
    await agentPage.locator('#login-identifier').fill(username);
    await agentPage.locator('#login-password').fill(newPassword);
    await agentPage.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await expect(agentPage).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await ensureBrowserLegalAcceptance(agentContext);

    // ── the เซลล์ builds a deal for a seeded shop ──
    await agentPage.goto(`${WEB_BASE_URL}/sales/deals/new`);
    // "Room45" is the seeded demo workspace's BRANCH name, not a Company — the picker
    // (sales-company-search.service.ts) only matches Company.name/registeredName/id, so it
    // never matches on a fresh seed. The seeded tenant's own name is "WatchDog Local Company"
    // (apps/api/prisma/seed.ts DEFAULT_COMPANY).
    await agentPage.getByLabel('ร้านค้า').fill('WatchDog Local');
    await agentPage.getByRole('button', { name: /WatchDog Local/ }).first().click();
    await agentPage.getByLabel(/ราคาที่ลูกค้าจ่าย/).fill('4990');
    await agentPage.getByLabel('จำนวนเดือน').fill('12');
    await agentPage.getByLabel('โน้ตถึงลูกค้า').fill('ข้อเสนอพิเศษสำหรับร้านคุณ');
    await agentPage.getByLabel('เหตุผลภายใน').fill('ลูกค้าเก่า ต่อสัญญา 1 ปี');
    await agentPage.getByRole('button', { name: 'ส่งอนุมัติ' }).click();
    // The success notice lives in /sales/deals/new's own component state, but the very next line
    // of SalesDealFormPage's persist() calls router.replace to /sales/deals/[id] — a SEPARATE route
    // component (apps/web/app/sales/deals/[id]/page.tsx) — which unmounts the "new" page before the
    // notice can ever be seen (confirmed via the API trace: the submit call itself succeeds, 200,
    // PENDING_APPROVAL). Assert the state that survives the navigation instead of the lost toast.
    await expect(agentPage).not.toHaveURL(/\/sales\/deals\/new/, { timeout: 15_000 });
    await expect(agentPage.getByText('รออนุมัติ')).toBeVisible();
    // A เซลล์ may never approve, their own deal least of all (D2).
    await expect(agentPage.getByRole('button', { name: 'อนุมัติ', exact: true })).toHaveCount(0);
    const dealUrl = agentPage.url();

    // ── the หัวหน้า sees it in งานของฉัน and approves ──
    await leadPage.goto(`${WEB_BASE_URL}/sales/my-work`);
    await expect(leadPage.getByText('รอคุณอนุมัติ').first()).toBeVisible();

    await leadPage.goto(dealUrl);
    await leadPage.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    // The confirmation lives in the modal, which portals to <body> — scope to it rather than
    // relying on document order to tell the two identically-named buttons apart.
    await leadPage.getByRole('dialog').getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await expect(leadPage.getByText(/อนุมัติแล้ว ระบบแจ้งเจ้าของร้าน/)).toBeVisible({ timeout: 15_000 });
    await expect(leadPage.getByText('ข้อเสนอใช้ได้ถึง')).toBeVisible();

    // 390 px: no horizontal overflow anywhere on the journey's last screen.
    const overflow = await leadPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await leadPage.context().close();
    await agentContext.close();
  });
});
