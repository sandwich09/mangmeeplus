/**
 * PRE-INTEGRATION ONLY: real web/API/PostgreSQL, simulated payment outcome.
 * The test driver calls the existing ADMIN manual-renew route. There is no Stripe
 * Checkout, signature verification, invoice ledger or paid-period adapter here.
 * A pass proves the named existing access behavior, never Stripe payment E2E.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client';
import { hashPassword } from '../apps/api/src/modules/auth/domain/logic/password-credential.logic';
import { test as base, expect } from './harness/fixtures';
import {
  apiHeaders, ensureBearerLegalAcceptance, ensureBrowserLegalAcceptance,
  expectNoClientError, getDevToken, SEED_USERS,
} from './harness/auth';

const DAY = 86_400_000;
type CompanyStatus = 'ACTIVE' | 'DISABLED' | 'SUSPENDED' | 'ARCHIVED';
type Rig = {
  db: PrismaClient;
  companyId: string;
  otherCompanyId: string;
  expire: (status?: CompanyStatus, termDisabled?: boolean) => Promise<void>;
  outcome: (result: 'paid' | 'declined', requestId?: string) => Promise<void>;
  term: () => ReturnType<PrismaClient['companyPlanTerm']['findUniqueOrThrow']>;
  business: () => Promise<import('@playwright/test').APIResponse>;
  ownerRenew: () => Promise<import('@playwright/test').APIResponse>;
  notice: () => Promise<import('@playwright/test').APIResponse>;
  identity: (role: 'OWNER' | 'STAFF', acceptLegal?: boolean) => Promise<{ id: string; username: string; password: string; token: string }>;
};

function requireLocal(value: string, label: string): void {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error(`${label} must be loopback; this suite never targets remote services`);
  }
}

const test = base.extend<{ rig: Rig }>({
  rig: async ({ request, urls, authedPage }, use) => {
    requireLocal(urls.web, 'web');
    requireLocal(urls.api, 'API');
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) throw new Error('Set DATABASE_URL to the local test PostgreSQL');
    requireLocal(databaseUrl, 'database');
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const suffix = randomUUID();
    const userIds: string[] = [];
    const ids = [`e2e-billing-a-${suffix}`, `e2e-billing-b-${suffix}`];
    const [companyId, otherCompanyId] = ids as [string, string];
    const monthKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit',
    }).format(new Date()).slice(0, 7);
    try {
      const owner = await db.user.findFirstOrThrow({ where: { username: SEED_USERS.owner.username } });
      const ownerMembership = await db.companyMembership.findFirstOrThrow({
        where: { userId: owner.id, companyId: 'seed-local-company' },
        include: { roles: { include: { role: true } } },
      });
      const ownerRole = ownerMembership.roles.find(row => row.role.key === 'OWNER');
      if (!ownerRole) throw new Error('Local seed OWNER role is missing');
      for (const id of ids) {
        await db.company.create({ data: {
          id, name: `E2E Billing ${id === companyId ? 'A' : 'B'} ${suffix.slice(0, 8)}`,
          businessCategory: 'RETAIL',
          memberships: { create: { userId: owner.id, roles: { create: { roleId: ownerRole.roleId } } } },
        } });
        await db.companyPlanTerm.create({ data: {
          companyId: id, tierKey: 'BASIC_499', branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50,
          termStartAt: new Date(Date.now() - DAY), termEndsAt: new Date(Date.now() + DAY),
        } });
        await db.branch.create({ data: { companyId: id, code: 'EXISTING', name: 'Existing data', type: 'HEAD_OFFICE' } });
        await db.companyOcrMonthlyUsage.create({ data: { companyId: id, monthKey, usedCount: 7 } });
      }
      const ownerToken = await getDevToken(request);
      for (const id of ids) await ensureBearerLegalAcceptance(request, ownerToken, id);
      await ensureBrowserLegalAcceptance(authedPage.context(), companyId);
      const adminLogin = await request.post(`${urls.api}/auth/password/login`, {
        data: { username: SEED_USERS.systemAdmin.username, password: SEED_USERS.systemAdmin.password },
      });
      expect(adminLogin.ok(), 'local system admin login').toBe(true);
      const { accessToken: adminToken } = await adminLogin.json();
      const admin = await db.user.findFirstOrThrow({ where: { username: SEED_USERS.systemAdmin.username } });
      const adminMembership = await db.companyMembership.findFirstOrThrow({
        where: { userId: admin.id, roles: { some: { role: { key: 'SYSTEM_ADMIN' } } } },
      });
      await ensureBearerLegalAcceptance(request, adminToken, adminMembership.companyId);
      const renewUrl = `${urls.api}/system/partners/${companyId}/plan-term/renew`;
      await use({
        db, companyId, otherCompanyId,
        term: () => db.companyPlanTerm.findUniqueOrThrow({ where: { companyId } }),
        expire: async (status = 'ACTIVE', termDisabled = false) => {
          const expiredAt = new Date(Date.now() - DAY);
          await db.$transaction([
            db.companyPlanTerm.update({ where: { companyId }, data: {
              termEndsAt: expiredAt, termDisabledAt: termDisabled ? expiredAt : null,
            } }),
            db.company.update({ where: { id: companyId }, data: {
              status, disabledAt: status === 'DISABLED' ? expiredAt : null,
            } }),
          ]);
        },
        outcome: async (result, requestId = `simulated-payment-${randomUUID()}`) => {
          // ponytail: no fake gateway. This substitutes ONLY the decision to invoke
          // manual renewal; it cannot prove any Stripe authentication/collection logic.
          if (result === 'declined') return;
          const res = await request.post(renewUrl, {
            headers: { ...apiHeaders(adminToken, adminMembership.companyId), 'X-Request-Id': requestId },
            data: { days: 30 },
          });
          expect(res.status(), `manual-renew driver: ${await res.text()}`).toBe(200);
        },
        business: () => request.get(`${urls.api}/companies/${companyId}/branches`, {
          headers: apiHeaders(ownerToken, companyId),
        }),
        ownerRenew: () => request.post(renewUrl, {
          headers: apiHeaders(ownerToken, companyId), data: { days: 30 },
        }),
        notice: () => request.get(`${urls.api}/plan-term/notice`, {
          headers: apiHeaders(ownerToken, companyId),
        }),
        identity: async (key, acceptLegal = true) => {
          const role = await db.role.findFirstOrThrow({ where: { key } });
          const id = `e2e-billing-user-${randomUUID()}`;
          const username = `billing_${randomUUID().replaceAll('-', '')}`;
          const password = `Test-Billing-${randomUUID()}`;
          userIds.push(id);
          await db.user.create({ data: { id, username, displayName: `Billing ${key} fixture`,
            credential: { create: { passwordHash: hashPassword(password) } },
            memberships: { create: { companyId, roles: { create: { roleId: role.id } } } },
          } });
          const res = await request.post(`${urls.api}/auth/password/login`, { data: { username, password } });
          expect(res.status()).toBe(200);
          const { accessToken: token } = await res.json();
          if (acceptLegal) await ensureBearerLegalAcceptance(request, token, companyId);
          return { id, username, password, token };
        },
      });
    } finally {
      // Only this run's disposable IDs; never reset/reseed the shared local database.
      await db.lineWebHandoffToken.deleteMany({ where: { companyId: { in: ids } } });
      await db.auditLog.deleteMany({ where: { OR: [{ companyId: { in: ids } }, { targetId: { in: [...ids, ...userIds] } }, { actorUserId: { in: userIds } }] } });
      await db.company.deleteMany({ where: { id: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.$disconnect();
    }
  },
});

test.describe('Billing readiness — SIMULATED payment / real existing access stack', () => {
  test('BR01 expiry + decline stays blocked; success permits a real browser mutation', async ({ rig, authedPage }, testInfo) => {
    const beforeRoles = await rig.db.companyMembership.findMany({
      where: { companyId: rig.companyId }, include: { roles: true },
    });
    const otherTerm = await rig.db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: rig.otherCompanyId } });
    await rig.expire();
    const expired = await rig.term();
    expect((await rig.business()).status()).toBe(403);
    await rig.outcome('declined');
    expect((await rig.term()).termEndsAt).toEqual(expired.termEndsAt);
    await authedPage.goto(`/companies/${rig.companyId}/settings/branches?payment=success`);
    await expect(authedPage).toHaveURL(new RegExp(`/companies/${rig.companyId}/renew`));
    await expect(authedPage.getByRole('heading', {
      name: 'แพ็กเกจหมดอายุแล้ว', exact: true,
    })).toBeVisible();
    expect((await rig.business()).status(), 'browser success claim cannot renew a term').toBe(403);
    await authedPage.screenshot({ path: testInfo.outputPath('before-renew.png'), fullPage: true });

    await rig.outcome('paid');
    expect((await rig.business()).status()).toBe(200);
    await authedPage.goto(`/companies/${rig.companyId}/settings/branches`);
    await expect(authedPage.getByRole('heading', { name: 'สาขา', exact: true })).toBeVisible();
    await authedPage.getByRole('button', { name: '+ เพิ่มสาขา', exact: true }).click();
    await authedPage.getByLabel('รหัสสาขา (A-Z, 0-9)').fill('AFTERPAY');
    await authedPage.getByLabel('ชื่อสาขา', { exact: true }).fill('Created after simulated payment');
    await authedPage.getByRole('button', { name: 'บันทึกสาขาใหม่', exact: true }).click();
    await expect(authedPage.getByText('Created after simulated payment', { exact: true })).toBeVisible();
    expect(await rig.db.branch.count({ where: { companyId: rig.companyId, code: 'AFTERPAY' } })).toBe(1);
    expect(await rig.db.branch.count({ where: { companyId: rig.companyId, code: 'EXISTING' } })).toBe(1);
    expect((await rig.db.companyOcrMonthlyUsage.findFirstOrThrow({ where: { companyId: rig.companyId } })).usedCount).toBe(7);
    expect(await rig.db.companyMembership.findMany({
      where: { companyId: rig.companyId }, include: { roles: true },
    })).toEqual(beforeRoles);
    expect(await rig.db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: rig.otherCompanyId } })).toEqual(otherTerm);
    await expectNoClientError(authedPage);
    await authedPage.screenshot({ path: testInfo.outputPath('after-renew-write.png'), fullPage: true });
  });

  test('BR02 term-disabled company activates; sequential replay does not extend again', async ({ rig, authedPage }, testInfo) => {
    await rig.expire('DISABLED', true);
    expect((await rig.business()).status()).toBe(403);
    const requestId = `simulated-invoice-${randomUUID()}`;
    await rig.outcome('paid', requestId);
    const first = await rig.term();
    await rig.outcome('paid', requestId);
    expect(await rig.term()).toEqual(first);
    expect(first.renewCount).toBe(1);
    expect(first.termDisabledAt).toBeNull();
    expect((await rig.db.company.findUniqueOrThrow({ where: { id: rig.companyId } })).status).toBe('ACTIVE');
    expect(await rig.db.auditLog.count({ where: { requestId, action: 'system.company_plan_term.renew' } })).toBe(1);
    expect((await rig.business()).status()).toBe(200);
    await authedPage.goto(`/companies/${rig.companyId}/settings/branches`);
    await expect(authedPage.getByRole('heading', { name: 'สาขา', exact: true })).toBeVisible();
    await expectNoClientError(authedPage);
    await authedPage.screenshot({ path: testInfo.outputPath('reactivated.png'), fullPage: true });
  });

  for (const status of ['DISABLED', 'SUSPENDED', 'ARCHIVED'] as const) {
    test(`BR03 ${status} hold is preserved after simulated payment`, async ({ rig }) => {
      await rig.expire(status, status !== 'DISABLED');
      await rig.outcome('paid');
      expect((await rig.db.company.findUniqueOrThrow({ where: { id: rig.companyId } })).status).toBe(status);
      expect((await rig.business()).status()).toBe(403);
    });
  }

  test('BR04 company OWNER cannot invoke the admin renewal driver', async ({ rig }) => {
    const before = await rig.term();
    expect((await rig.ownerRenew()).status()).toBe(403);
    expect(await rig.term()).toEqual(before);
  });

  test('BR05 expired OWNER can read recovery notice after sweep disables company', async ({ rig }) => {
    await rig.expire('DISABLED', true);
    const res = await rig.notice();
    // Intentionally assert the required recovery behavior, not the known 403 defect.
    expect(res.status(), `R02 recovery route: ${await res.text()}`).toBe(200);
    expect(await res.json()).toMatchObject({ derivedState: 'EXPIRED', isOwner: true });
  });

  test('BR06 multi-company OWNER sees the selected expired company recovery screen', async ({ rig, authedPage }) => {
    await rig.expire('ACTIVE');
    const notice = await rig.notice();
    expect(notice.status()).toBe(200);
    expect(await notice.json()).toMatchObject({ derivedState: 'EXPIRED', isOwner: true });
    await authedPage.goto(`/companies/${rig.companyId}/renew`);
    await expect(authedPage.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
  });

  test('BR07/RG04 password login with only a term-disabled company reaches recovery and then real access', async ({ rig, browser, urls }, info) => {
    const user = await rig.identity('OWNER');
    await rig.expire('DISABLED', true);
    const ctx = await browser.newContext({ baseURL: urls.web });
    try {
      const login = await ctx.request.post('/api/auth/login', { data: { username: user.username, password: user.password } });
      expect(login.status()).toBe(200);
      const page = await ctx.newPage();
      await page.goto(`/companies/${rig.companyId}/renew`);
      await expect(page.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
      await expectNoClientError(page);
      await page.screenshot({ path: info.outputPath('single-company-recovery.png') });
      await rig.outcome('paid');
      await page.goto(`/companies/${rig.companyId}/settings/branches`);
      await expect(page.getByRole('heading', { name: 'สาขา', exact: true })).toBeVisible();
    } finally { await ctx.close(); }
  });

  test('BR08/RG04 staff recovery stays non-owner and cannot cross tenant, renew or use business routes', async ({ rig, request, urls, browser }) => {
    const staff = await rig.identity('STAFF');
    await rig.expire('DISABLED', true);
    const read = (id: string) => request.get(`${urls.api}/plan-term/notice`, { headers: apiHeaders(staff.token, id) });
    const res = await read(rig.companyId);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ isOwner: false, derivedState: 'EXPIRED' });
    expect((await read(rig.otherCompanyId)).status()).toBe(403);
    expect((await read('nonexistent-billing-company')).status()).toBe(403);
    expect((await request.post(`${urls.api}/system/partners/${rig.companyId}/plan-term/renew`, {
      headers: apiHeaders(staff.token, rig.companyId), data: { days: 30 },
    })).status()).toBe(403);
    expect((await request.get(`${urls.api}/companies/${rig.companyId}/branches`, { headers: apiHeaders(staff.token, rig.companyId) })).status()).toBe(403);
    const ctx = await browser.newContext({ baseURL: urls.web });
    try {
      expect((await ctx.request.post('/api/auth/login', { data: { username: staff.username, password: staff.password } })).status()).toBe(200);
      const page = await ctx.newPage();
      await page.goto(`/companies/${rig.companyId}/renew`);
      await expect(page.getByRole('heading', { name: 'บริษัทนี้พักการใช้งานชั่วคราว', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toHaveCount(0);
    } finally { await ctx.close(); }
    await rig.db.companyMembership.updateMany({ where: { userId: staff.id }, data: { status: 'DISABLED' } });
    expect((await read(rig.companyId)).status()).toBe(403);
  });

  for (const status of ['DISABLED', 'SUSPENDED', 'ARCHIVED'] as const) {
    test(`BR09/RG04 ${status} admin/security hold denies recovery and single-company login`, async ({ rig, request, urls }) => {
      const user = await rig.identity('OWNER');
      await rig.expire(status, status !== 'DISABLED');
      expect((await rig.notice()).status()).toBe(403);
      const login = await request.post(`${urls.api}/auth/password/login`, { data: { username: user.username, password: user.password } });
      expect(login.status()).toBe(403);
      expect((await rig.business()).status()).toBe(403);
    });
  }

  for (const [status, title] of [[401, 'กรุณาเข้าสู่ระบบอีกครั้ง'], [403, 'ไม่มีสิทธิ์ดูสถานะบริษัทนี้'], [500, 'โหลดสถานะไม่สำเร็จ']] as const) {
    test(`BR10/RG05 notice ${status} is an explicit error, never employee/no-term`, async ({ rig, authedPage }) => {
      await rig.expire();
      await authedPage.route('**/api/v1/plan-term/notice', route => route.fulfill({ status, contentType: 'application/json', body: '{}' }));
      await authedPage.goto(`/companies/${rig.companyId}/renew`);
      await expect(authedPage.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(authedPage.getByRole('heading', { name: 'บริษัทนี้พักการใช้งานชั่วคราว', exact: true })).toHaveCount(0);
      await authedPage.unroute('**/api/v1/plan-term/notice');
      if (status !== 401) {
        await authedPage.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
        await expect(authedPage.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
      } else await expect(authedPage.getByRole('link', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible();
    });
  }

  test('BR11/RG05 offline notice can retry; mobile OWNER controls are visible and keyboard accessible', async ({ rig, authedPage }, info) => {
    await rig.expire();
    await authedPage.setViewportSize({ width: 390, height: 844 });
    await authedPage.route('**/api/v1/plan-term/notice', route => route.abort('internetdisconnected'));
    await authedPage.goto(`/companies/${rig.companyId}/renew`);
    await expect(authedPage.getByRole('heading', { name: 'โหลดสถานะไม่สำเร็จ', exact: true })).toBeVisible();
    await authedPage.unroute('**/api/v1/plan-term/notice');
    const retry = authedPage.getByRole('button', { name: 'ลองใหม่', exact: true });
    await retry.focus();
    await authedPage.keyboard.press('Enter');
    await expect(authedPage.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
    expect(await authedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await authedPage.screenshot({ path: info.outputPath('mobile-recovery.png'), fullPage: true });
  });

  test('BR12/RG05 no term is a real usable-company state, not an error or employee suspension', async ({ rig, authedPage }) => {
    await rig.db.companyPlanTerm.delete({ where: { companyId: rig.companyId } });
    expect(await (await rig.notice()).json()).toBeNull();
    await authedPage.goto(`/companies/${rig.companyId}/renew`);
    await expect(authedPage.getByRole('heading', { name: 'บริษัทนี้ยังใช้งานได้ตามสิทธิ์', exact: true })).toBeVisible();
    expect((await rig.business()).status()).toBe(200);
  });

  test('BR13/RG04 expired company can accept current legal documents without opening business access', async ({ rig, request, urls }) => {
    const user = await rig.identity('OWNER', false);
    await rig.expire('DISABLED', true);
    const headers = apiHeaders(user.token, rig.companyId);
    const pending = await request.get(`${urls.api}/auth/legal-acceptance`, { headers });
    expect(pending.status()).toBe(200);
    expect(await pending.json()).toMatchObject({ required: true });
    await ensureBearerLegalAcceptance(request, user.token, rig.companyId);
    const accepted = await request.get(`${urls.api}/auth/legal-acceptance`, { headers });
    expect(await accepted.json()).toMatchObject({ required: false });
    expect((await request.get(`${urls.api}/plan-term/notice`, { headers })).status()).toBe(200);
    expect((await request.get(`${urls.api}/companies/${rig.companyId}/branches`, { headers })).status()).toBe(403);
  });

  test('BR14/RG05 switch A to B while A notice is delayed; back and refresh retain selected company', async ({ rig, authedPage }) => {
    await rig.expire();
    let release!: () => void;
    let delayed = 0;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const completions: Promise<void>[] = [];
    await authedPage.route('**/api/v1/plan-term/notice', async route => {
      if (route.request().headers()['x-company-id'] !== rig.companyId) return route.continue();
      const response = await route.fetch();
      delayed++;
      const completion = hold.then(async () => {
        // Full document navigation may cancel the old fetch; it must never change B's state.
        await route.fulfill({ response }).catch(() => undefined);
      });
      completions.push(completion);
      await completion;
    });
    try {
      await authedPage.goto(`/companies/${rig.companyId}/renew`);
      await expect.poll(() => delayed).toBeGreaterThan(0);
      await authedPage.getByRole('button', { name: 'สลับบริษัท', exact: true }).click();
      const other = await rig.db.company.findUniqueOrThrow({ where: { id: rig.otherCompanyId } });
      await authedPage.getByRole('button', { name: new RegExp(other.name) }).click();
      await expect(authedPage).toHaveURL(new RegExp(`/companies/${rig.otherCompanyId}/dashboard`));
      release();
      await Promise.all(completions);
      await expect(authedPage.getByRole('button', { name: 'สลับบริษัท', exact: true })).toContainText(other.name);
      await expect(authedPage.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toHaveCount(0);
      await authedPage.unroute('**/api/v1/plan-term/notice');
      await authedPage.goBack();
      await expect(authedPage).toHaveURL(new RegExp(`/companies/${rig.companyId}/renew`));
      await expect(authedPage.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
      await authedPage.reload();
      await expect(authedPage.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
    } finally { release(); }
  });

  test('BR15 no-package owner can fill and save company profile without a redirect', async ({ rig, authedPage, request, urls }) => {
    test.setTimeout(120_000);
    await rig.expire('DISABLED', true);
    const term = await rig.term();
    await rig.db.companyPlanTerm.update({ where: { companyId: rig.companyId }, data: { termStartAt: term.termEndsAt } });
    expect(await (await rig.notice()).json()).toMatchObject({ lockReason: 'no_package' });

    const profilePath = `/companies/${rig.companyId}/settings/profile`;
    await authedPage.goto(profilePath);
    await expect(authedPage.getByRole('heading', { name: 'ข้อมูลร้านและบัญชีของฉัน', exact: true })).toBeVisible();
    const navigations: string[] = [];
    authedPage.on('load', () => navigations.push(authedPage.url()));

    await authedPage.getByRole('combobox', { name: 'ประเภทธุรกิจ' }).click();
    await authedPage.getByRole('option', { name: 'อื่น ๆ' }).click();
    await authedPage.getByLabel('ระบุประเภทธุรกิจอื่น ๆ').fill('ร้านทดสอบ');
    await authedPage.getByLabel('ชื่อจดทะเบียน').fill('บริษัท ทดสอบ จำกัด');
    await authedPage.getByLabel('เลขผู้เสียภาษี').fill('0105558123456');
    const addressResponse = authedPage.waitForResponse(response =>
      response.url().includes(`/companies/${rig.companyId}/settings/address-master?postalCode=10330`));
    await authedPage.getByLabel('รหัสไปรษณีย์').fill('10330');
    const found = await addressResponse;
    expect(found.status()).toBe(200);
    const rows = await found.json() as Array<{ provinceTh: string; districtTh: string; subdistrictTh: string }>;
    if (rows[0]) {
      const first = rows[0];
      for (const [label, option] of [['จังหวัด', first.provinceTh], ['อำเภอ / เขต', first.districtTh], ['ตำบล / แขวง', first.subdistrictTh]]) {
        const field = authedPage.locator(`[id="${label.toLowerCase().trim().replace(/\s+/g, '-')}"]`);
        await field.click();
        await authedPage.getByRole('option', { name: option, exact: true }).click();
      }
    } else {
      await authedPage.getByLabel('จังหวัด').fill('กรุงเทพมหานคร');
      await authedPage.getByLabel('อำเภอ / เขต').fill('ปทุมวัน');
      await authedPage.getByLabel('ตำบล / แขวง').fill('ปทุมวัน');
    }
    await authedPage.getByLabel('ที่อยู่ (บ้านเลขที่ ถนน)').fill('123 ถนนตัวอย่าง');
    await authedPage.getByLabel('ที่อยู่เพิ่มเติม').fill('ชั้น 2');
    await authedPage.locator('#vat-status').click();
    await authedPage.getByRole('option', { name: 'ยังไม่ได้จดทะเบียน VAT' }).click();

    await expect(authedPage.getByLabel('ชื่อจดทะเบียน')).toHaveValue('บริษัท ทดสอบ จำกัด');
    await expect(authedPage.getByLabel('เลขผู้เสียภาษี')).toHaveValue('0105558123456');
    await expect(authedPage.getByLabel('รหัสไปรษณีย์')).toHaveValue('10330');
    await expect(authedPage.getByLabel('ที่อยู่เพิ่มเติม')).toHaveValue('ชั้น 2');
    await expect(authedPage).toHaveURL(new RegExp(`${profilePath}$`));
    expect(navigations).toEqual([]);

    const identityWrite = authedPage.waitForResponse(response => response.request().method() === 'PATCH'
      && response.url().endsWith(`/companies/${rig.companyId}/identity`));
    const businessWrite = authedPage.waitForResponse(response => response.request().method() === 'PATCH'
      && response.url().endsWith(`/companies/${rig.companyId}/identity/business-type`));
    const vatWrite = authedPage.waitForResponse(response => response.request().method() === 'PUT'
      && response.url().endsWith(`/companies/${rig.companyId}/vat-registration`));
    await authedPage.getByRole('button', { name: 'บันทึกข้อมูลร้าน', exact: true }).click();
    for (const response of await Promise.all([identityWrite, businessWrite, vatWrite])) {
      expect(response.status(), `${response.request().method()} ${response.url()}: ${await response.text()}`).toBe(200);
    }
    await expect(authedPage.getByText('บันทึกข้อมูลร้านแล้วค่ะ')).toBeVisible();
    await expect(authedPage).toHaveURL(new RegExp(`${profilePath}$`));
    expect(navigations).toEqual([]);

    await authedPage.getByRole('button', { name: 'บัญชีของฉัน', exact: true }).click();
    await authedPage.locator('details').filter({ hasText: 'เบอร์มือถือ' }).first().locator('summary').click();
    const phoneInput = authedPage.locator('input[id="เบอร์มือถือ"]');
    await phoneInput.fill('0812345678');
    await expect(phoneInput).toHaveValue('0812345678');
    const contactWrite = authedPage.waitForResponse(response => response.request().method() === 'PATCH'
      && response.url().endsWith('/auth/me/contact'));
    await authedPage.getByRole('button', { name: 'บันทึกเบอร์มือถือ', exact: true }).click();
    expect((await contactWrite).status()).toBe(200);
    await expect(authedPage.getByText('บันทึกเบอร์มือถือแล้วค่ะ')).toBeVisible();
    expect(navigations).toEqual([]);
    expect((await request.get(`${urls.api}/companies/${rig.companyId}/branches`, {
      headers: apiHeaders(await getDevToken(request), rig.companyId),
    })).status()).toBe(403);
    await expectNoClientError(authedPage);
  });
});

// Local setup substitutes LINE identity proof only. Exchange, cookies, guards and DB are real.
async function localLineHandoff(rig: Rig, userId: string, targetPath: string) {
  const providerUserId = `U${userId.replaceAll('-', '').slice(-32)}`;
  await rig.db.externalIdentity.upsert({
    where: { provider_providerChannelId_providerUserId: { provider: 'LINE', providerChannelId: 'e2e-local', providerUserId } },
    create: { userId, provider: 'LINE', providerChannelId: 'e2e-local', providerUserId }, update: { status: 'ACTIVE' },
  });
  const rawToken = randomBytes(24).toString('base64url');
  const token = { rawToken, tokenHash: createHash('sha256').update(rawToken).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60_000) };
  await rig.db.lineWebHandoffToken.create({ data: {
    tokenHash: token.tokenHash, expiresAt: token.expiresAt, userId, companyId: rig.companyId,
    lineUserId: providerUserId, targetPath, surface: 'liff_start',
  } });
  return token.rawToken;
}

async function submitSystemLogin(page: import('@playwright/test').Page) {
  await page.locator('#login-identifier').fill(SEED_USERS.systemAdmin.username);
  await page.locator('#login-password').fill(SEED_USERS.systemAdmin.password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
}

test.describe('BC existing admin web recovery — no Stripe or new control-suite claim', () => {
  for (const width of [1280, 390]) {
    test(`BC01 ${width}px expired admin cookie preserves partner deep link through web login`, async ({ rig, browser, urls }, info) => {
      const context = await browser.newContext({ baseURL: urls.web, viewport: { width, height: 900 } });
      try {
        await context.addCookies([{ name: 'watchdog_token', value: 'invalid-expired-token', url: urls.web }]);
        const page = await context.newPage();
        const keyErrors: string[] = [];
        page.on('console', message => { if (/same key|unique.*key/i.test(message.text())) keyErrors.push(message.text()); });
        const target = `/system/partners/${rig.companyId}?tab=billing&reference=local-proof`;
        await page.goto(target);
        await expect(page).toHaveURL(/\/login\?/);
        expect(new URL(page.url()).searchParams.get('next')).toBe(target);
        await submitSystemLogin(page);
        await expect(page).toHaveURL(`${urls.web}${target}`);
        await expect(page.getByRole('heading', { name: /E2E Billing A/ })).toBeVisible();
        await expect(page.getByRole('button', { name: 'ต่ออายุ', exact: true })).toBeVisible();
        await expectNoClientError(page);
        expect(keyErrors).toEqual([]);
        await page.screenshot({ path: info.outputPath('admin-return.png'), fullPage: true });
      } finally { await context.close(); }
    });
  }

  test('BC02 failed plan read retries the real API without changing the term', async ({ rig, browser, urls }, info) => {
    const context = await browser.newContext({ baseURL: urls.web, viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      const before = await rig.term();
      let reads = 0;
      let readUnavailable = true;
      const mutations: string[] = [];
      page.on('request', req => {
        if (req.url().includes(`/system/partners/${rig.companyId}/plan-term`) && req.method() !== 'GET') mutations.push(req.method());
      });
      await page.route(`**/api/v1/system/partners/${rig.companyId}/plan-term`, async route => {
        reads++;
        if (readUnavailable) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary read failure' }) });
        else await route.continue();
      });
      await page.goto(`/login?next=${encodeURIComponent(`/system/partners/${rig.companyId}`)}`);
      await submitSystemLogin(page);
      const retry = page.getByRole('button', { name: 'ลองโหลดแพ็กเกจอีกครั้ง' });
      await expect(retry).toBeVisible();
      await retry.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('read-error-with-exit.png') });
      expect(reads).toBeGreaterThan(0);
      const failedReads = reads;
      readUnavailable = false;
      await retry.click();
      await expect(page.getByRole('button', { name: 'ต่ออายุ', exact: true })).toBeVisible();
      await expect(retry).toHaveCount(0);
      expect(reads).toBe(failedReads + 1);
      expect(mutations).toEqual([]);
      expect(await rig.term()).toEqual(before);
      await expectNoClientError(page);
      await page.screenshot({ path: info.outputPath('read-recovered.png') });
    } finally { await context.close(); }
  });

  test('BC03 admin renew through web restores customer web and LINE bridge without service restart', async ({ rig, authedPage, browser, urls }, info) => {
    const user = await rig.identity('OWNER');
    await rig.expire('DISABLED', true);
    const target = `/companies/${rig.companyId}/settings/branches`;
    const handoff = await localLineHandoff(rig, user.id, target);
    const otherBefore = await rig.db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: rig.otherCompanyId } });
    const processes = () => Object.fromEntries([['api', urls.api], ['web', urls.web]].map(([key, url]) => [key,
      execFileSync('lsof', ['-t', `-iTCP:${new URL(url!).port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n').sort(),
    ]));
    const beforeProcesses = processes();
    const admin = await browser.newContext({ baseURL: urls.web });
    const line = await browser.newContext({ baseURL: urls.web });
    try {
      await authedPage.goto(`/companies/${rig.companyId}/renew`);
      await expect(authedPage.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
      const page = await admin.newPage();
      await page.goto(`/login?next=${encodeURIComponent(`/system/partners/${rig.companyId}`)}`);
      await submitSystemLogin(page);
      await page.getByRole('button', { name: 'ต่ออายุ', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'ต่ออายุ', exact: true }).click();
      await expect(page.getByText('ต่ออายุการใช้งานแล้ว', { exact: true })).toBeVisible();
      expect((await rig.term()).renewCount).toBe(1);
      expect((await rig.term()).termDisabledAt).toBeNull();
      expect((await rig.business()).status()).toBe(200);
      await page.reload();
      await expect(page.getByRole('button', { name: 'ต่ออายุ', exact: true })).toBeVisible();
      expect((await rig.term()).renewCount).toBe(1);
      await authedPage.goto(target);
      await expect(authedPage.getByRole('heading', { name: 'สาขา', exact: true })).toBeVisible();
      const linePage = await line.newPage();
      await linePage.goto(`/l/${handoff}`);
      await expect(linePage.getByRole('heading', { name: 'สาขา', exact: true })).toBeVisible();
      expect(await rig.db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: rig.otherCompanyId } })).toEqual(otherBefore);
      const afterProcesses = processes();
      expect(afterProcesses).toEqual(beforeProcesses);
      await info.attach('same-service-processes.json', { body: JSON.stringify({ before: beforeProcesses, after: afterProcesses }, null, 2), contentType: 'application/json' });
      await expectNoClientError(page); await expectNoClientError(authedPage); await expectNoClientError(linePage);
      await authedPage.screenshot({ path: info.outputPath('customer-web-after-admin-renew.png') });
      await linePage.screenshot({ path: info.outputPath('line-bridge-after-admin-renew.png') });
    } finally { await admin.close(); await line.close(); }
  });

  test('BC04 customer OWNER cannot enter platform admin or mutate another term', async ({ rig, authedPage }) => {
    const before = await rig.term();
    await authedPage.goto(`/system/partners/${rig.companyId}?tab=billing`);
    await expect(authedPage.getByRole('button', { name: 'ต่ออายุ', exact: true })).toHaveCount(0);
    await expect(authedPage.getByRole('heading', { name: /สิทธิ์|Access/i })).toBeVisible();
    expect((await rig.ownerRenew()).status()).toBe(403);
    expect(await rig.term()).toEqual(before);
    await expectNoClientError(authedPage);
  });
});

test.describe('GW web + LINE round trips — real local app, simulated LINE proof/payment', () => {
  test('GW01 signed-out return preserves company and query through password login', async ({ rig, browser, urls }) => {
    const user = await rig.identity('OWNER'); await rig.expire('DISABLED', true);
    const ctx = await browser.newContext({ baseURL: urls.web });
    try {
      await ctx.addCookies([{ name: 'watchdog_token', value: 'invalid-expired-token', url: urls.web }]);
      const page = await ctx.newPage();
      const target = `/companies/${rig.companyId}/renew?attemptId=local-proof&from=line`;
      await page.goto(target);
      await expect(page).toHaveURL(/\/login\?/);
      expect(new URL(page.url()).searchParams.get('next')).toBe(target);
      await page.locator('#login-identifier').fill(user.username);
      await page.locator('#login-password').fill(user.password);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(`${urls.web}${target}`);
      await expect(page.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
    } finally { await ctx.close(); }
  });

  test('GW02/GW04 LIFF gesture → separate browser → expired LINE-only owner → renewed access → fresh LINE entry', async ({ rig, browser, urls, request }, info) => {
    const user = await rig.identity('OWNER');
    await rig.db.userCredential.deleteMany({ where: { userId: user.id } });
    await rig.expire('DISABLED', true);
    const target = `/companies/${rig.companyId}/settings/branches`;
    const token = await localLineHandoff(rig, user.id, target);
    const liff = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const external = await browser.newContext({ baseURL: urls.web });
    const otherBefore = await rig.db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: rig.otherCompanyId } });
    try {
      await liff.route('https://static.line-scdn.net/liff/edge/2/sdk.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.__opened = []; window.liff = {
        init: async () => {}, isLoggedIn: () => true, isInClient: () => true,
        getIDToken: () => 'local.proof.fixture', getDecodedIDToken: () => ({exp: Date.now()/1000+3600}),
        openWindow: value => window.__opened.push(value)
      };` }));
      await liff.route(`${urls.api}/auth/line/liff/session`, route => route.fulfill({ json: { handoffUrl: `${urls.web}/l/${token}` } }));
      const bridge = await liff.newPage();
      await bridge.goto(`${urls.api}/auth/line/start-page`);
      const launch = bridge.getByRole('button', { name: 'เปิดหน้าเว็บ', exact: true });
      await expect(launch).toBeVisible();
      expect(await bridge.evaluate(() => (window as any).__opened.length)).toBe(0);
      await bridge.screenshot({ path: info.outputPath('liff-ready-390.png') });
      await launch.focus(); await bridge.keyboard.press('Enter');
      const opened = await bridge.evaluate(() => (window as any).__opened);
      expect(opened).toHaveLength(1); expect(opened[0].external).toBe(true);
      const page = await external.newPage(); await page.goto(opened[0].url);
      await expect(page).toHaveURL(`${urls.web}/companies/${rig.companyId}/renew`);
      await expect(page.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
      expect((await rig.business()).status()).toBe(403);
      expect((await liff.cookies(urls.web)).some(row => row.name.startsWith('watchdog_token'))).toBe(false);
      expect((await external.cookies()).some(row => row.name.startsWith('watchdog_token') && row.httpOnly)).toBe(true);
      expect((await request.post(`${urls.api}/auth/line/handoff/exchange`, { data: { token } })).status()).toBe(403);
      await rig.outcome('paid');
      const fresh = await localLineHandoff(rig, user.id, target);
      await page.goto(`${urls.web}/l/${fresh}`);
      await expect(page.getByRole('heading', { name: 'สาขา', exact: true })).toBeVisible();
      expect((await rig.business()).status()).toBe(200);
      expect(await rig.db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: rig.otherCompanyId } })).toEqual(otherBefore);
      await expectNoClientError(page);
      await page.screenshot({ path: info.outputPath('line-return-after-renew.png') });
    } finally { await liff.close(); await external.close(); }
  });

  for (const blocked of ['admin-hold', 'revoked-membership', 'unlinked'] as const) {
    test(`GW04 handoff rechecks ${blocked} after mint`, async ({ rig, request, urls }) => {
      const user = await rig.identity('OWNER');
      const token = await localLineHandoff(rig, user.id, `/companies/${rig.companyId}/renew`);
      if (blocked === 'admin-hold') await rig.expire('DISABLED', false);
      if (blocked === 'revoked-membership') await rig.db.companyMembership.updateMany({ where: { companyId: rig.companyId, userId: user.id }, data: { status: 'SUSPENDED' } });
      if (blocked === 'unlinked') await rig.db.externalIdentity.deleteMany({ where: { userId: user.id } });
      expect((await request.post(`${urls.api}/auth/line/handoff/exchange`, { data: { token } })).status()).toBe(403);
    });
  }
});
