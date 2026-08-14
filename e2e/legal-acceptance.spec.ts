import type { APIResponse, Page } from '@playwright/test';
import { test, expect } from './harness/fixtures';
import { WEB_BASE_URL, type LegalAcceptanceStatus } from './harness/auth';
import { json } from './harness/e2e-utils';

type Role = { id: string; key: string; status: string };
type CreatedEmployee = {
  employeeId: string;
  username: string;
  temporaryPassword: string;
  mustChangePassword: boolean;
};

const CSRF_COOKIE = 'watchdog_csrf';
const CSRF_HEADER = 'x-csrf-token';

async function browserApiGet(page: Page, path: string, companyId: string): Promise<APIResponse> {
  return page.context().request.get(`${WEB_BASE_URL}/api/v1/${path.replace(/^\//, '')}`, {
    headers: { 'X-Company-Id': companyId },
  });
}

async function browserApiPost(
  page: Page,
  path: string,
  companyId: string,
  data: unknown,
): Promise<APIResponse> {
  const csrf = (await page.context().cookies(WEB_BASE_URL))
    .find((cookie) => cookie.name === CSRF_COOKIE)?.value;
  expect(csrf, `${CSRF_COOKIE} is present for a cookie-authenticated mutation`).toBeTruthy();
  return page.context().request.post(`${WEB_BASE_URL}/api/v1/${path.replace(/^\//, '')}`, {
    headers: {
      'X-Company-Id': companyId,
      Origin: new URL(WEB_BASE_URL).origin,
      [CSRF_HEADER]: csrf!,
    },
    data,
  });
}

async function submitLogin(page: Page, username: string, password: string): Promise<void> {
  await page.locator('#login-identifier').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
}

test.describe('LEGAL — explicit Terms acceptance and Privacy Notice acknowledgment', () => {
  test('LEGAL-01 @smoke gates a fresh member until the current release is explicitly confirmed', async ({
    api,
    companyId,
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
    const username = `e2e.legal.${suffix.slice(-16)}`;
    const changedPassword = `Legal@${suffix.slice(-10)}!`;
    let employeeId: string | null = null;

    try {
      const [terms, privacy, dataDeletion] = await Promise.all([
        request.get(`${WEB_BASE_URL}/terms`),
        request.get(`${WEB_BASE_URL}/privacy`),
        request.get(`${WEB_BASE_URL}/data-deletion`),
      ]);
      expect(terms.status(), 'Terms stay public before authentication').toBe(200);
      expect(await terms.text()).toMatch(/ข้อกำหนดการใช้งาน|Terms of Use/i);
      expect(privacy.status(), 'Privacy Notice stays public before authentication').toBe(200);
      expect(await privacy.text()).toMatch(/นโยบายความเป็นส่วนตัว|Privacy Notice/i);
      expect(dataDeletion.status(), 'Data Deletion Notice stays public before authentication').toBe(200);
      expect(await dataDeletion.text()).toMatch(/การลบบัญชีและข้อมูลส่วนบุคคล/);
      expect(await dataDeletion.text()).toMatch(/ไม่เกิน 90 วัน/);

      const roles = await json<Role[]>(await api.get(`companies/${companyId}/settings/roles`));
      const staffRole = roles.find((role) => role.key === 'STAFF' && role.status === 'ACTIVE');
      expect(staffRole, 'the seeded STAFF role is available for the disposable member').toBeTruthy();

      const created = await json<CreatedEmployee>(await api.post(`companies/${companyId}/settings/employees`, {
        data: {
          username,
          displayName: `E2E Legal ${suffix.slice(-6)}`,
          legalName: `E2E Legal ${suffix.slice(-6)}`,
          dateOfBirth: '1990-01-01',
          identityType: 'PASSPORT',
          identityNumber: `LEGAL${suffix.slice(-20)}`,
          phoneNumber: `08${suffix.slice(-8).padStart(8, '0')}`,
          roleIds: [staffRole!.id],
        },
      }));
      employeeId = created.employeeId;
      expect(created.mustChangePassword).toBe(true);
      expect(created.temporaryPassword).toBe('01011990');
      const completed = await api.post(`companies/${companyId}/settings/employees/${employeeId}/complete`);
      expect(completed.ok(), `activate disposable employee -> ${completed.status()}: ${await completed.text()}`).toBe(true);

      // Password ownership is established before clickwrap evidence can be recorded.
      await page.goto('/login');
      await submitLogin(page, username, created.temporaryPassword);
      await expect(page).toHaveURL(/\/change-password(?:\?|$)/);

      const pendingStatusRes = await browserApiGet(page, 'auth/legal-acceptance', companyId);
      expect(pendingStatusRes.ok(), `pending GET legal status -> ${pendingStatusRes.status()}`).toBe(true);
      const pendingStatus = (await pendingStatusRes.json()) as LegalAcceptanceStatus;
      expect(pendingStatus.required).toBe(true);

      const prematureAcceptance = await browserApiPost(page, 'auth/legal-acceptance', companyId, {
        termsVersion: pendingStatus.terms.version,
        privacyVersion: pendingStatus.privacy.version,
        statementVersion: pendingStatus.statementVersion,
        termsAccepted: true,
        privacyAcknowledged: true,
        capacityConfirmed: true,
        locale: 'th',
        displayChallenge: pendingStatus.displayChallenges.th,
      });
      expect(prematureAcceptance.status()).toBe(403);
      expect(await prematureAcceptance.json()).toMatchObject({ code: 'password_change_required' });

      await page.locator('input[name="current-password"]').fill(created.temporaryPassword);
      await page.locator('input[name="new-password"]').fill(changedPassword);
      await page.getByRole('button', { name: /เปลี่ยนรหัสผ่าน|Change password/i }).click();
      await expect(page).toHaveURL(/\/login(?:\?|$)/);

      // An unsafe next target must never survive the login -> legal gate -> business route chain.
      await page.goto(`/login?next=${encodeURIComponent('//evil.example/steal')}`);
      await submitLogin(page, username, changedPassword);
      await expect(page).toHaveURL(/\/legal-acceptance(?:\?|$)/);
      expect(page.url()).not.toContain('evil.example');

      const blocked = await browserApiGet(page, `companies/${companyId}/expenses?page=1&pageSize=1`, companyId);
      expect(blocked.status()).toBe(403);
      expect(await blocked.json()).toMatchObject({ code: 'legal_acceptance_required' });

      const requiredBoxes = page.locator('form input[type="checkbox"][required]');
      await expect(requiredBoxes).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) {
        await expect(requiredBoxes.nth(index)).not.toBeChecked();
        // The required mark is a document-typography class, not a Tailwind colour utility;
        // this assertion had been pinned to the pre-redesign markup and never re-checked.
        await expect(requiredBoxes.nth(index).locator('xpath=..').locator('span.doc-gate-required')).toHaveCount(1);
      }
      await expect(page.getByRole('link', { name: /เปิดอ่านเอกสารฉบับเต็ม|Read the full document/i })).toHaveCount(2);
      await expect(page.getByText(/ไม่ใช่การให้ความยินยอม|is not consent/i)).toBeVisible();

      await page.getByRole('button', { name: /ยืนยันและเริ่มใช้งาน|Confirm and start/i }).click();
      await expect(page.locator('#legal-acceptance-error')).toContainText(/กรุณายืนยัน|Please confirm/i);
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name))
        .toBe('termsAccepted');
      await expect(page).toHaveURL(/\/legal-acceptance(?:\?|$)/);

      const currentStatusRes = await browserApiGet(page, 'auth/legal-acceptance', companyId);
      expect(currentStatusRes.ok(), `current GET legal status -> ${currentStatusRes.status()}`).toBe(true);
      const current = (await currentStatusRes.json()) as LegalAcceptanceStatus;
      const stale = await browserApiPost(page, 'auth/legal-acceptance', companyId, {
        termsVersion: `${current.terms.version}-stale`,
        privacyVersion: current.privacy.version,
        statementVersion: current.statementVersion,
        termsAccepted: true,
        privacyAcknowledged: true,
        capacityConfirmed: true,
        locale: 'th',
        displayChallenge: current.displayChallenges.th,
      });
      expect(stale.status()).toBe(409);
      expect(await stale.json()).toMatchObject({
        code: 'legal_document_version_stale',
        current: {
          termsVersion: current.terms.version,
          privacyVersion: current.privacy.version,
          statementVersion: current.statementVersion,
        },
      });

      const staleChallenge = await browserApiPost(page, 'auth/legal-acceptance', companyId, {
        termsVersion: current.terms.version,
        privacyVersion: current.privacy.version,
        statementVersion: current.statementVersion,
        termsAccepted: true,
        privacyAcknowledged: true,
        capacityConfirmed: true,
        locale: 'th',
        displayChallenge: '0'.repeat(64),
      });
      expect(staleChallenge.status()).toBe(409);
      expect(await staleChallenge.json()).toMatchObject({ code: 'legal_acceptance_challenge_stale' });

      await page.locator('input[name="termsAccepted"]').check();
      await page.locator('input[name="privacyAcknowledged"]').check();
      await page.locator('input[name="capacityConfirmed"]').check();
      await page.getByRole('button', { name: /ยืนยันและเริ่มใช้งาน|Confirm and start/i }).click();

      await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/dashboard(?:\\?|$)`));
      expect(new URL(page.url()).origin).toBe(new URL(WEB_BASE_URL).origin);

      await page.reload();
      await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/dashboard(?:\\?|$)`));
      await expect(page).not.toHaveURL(/\/legal-acceptance/);

      const statusAfter = await browserApiGet(page, 'auth/legal-acceptance', companyId);
      expect(statusAfter.ok()).toBe(true);
      const acceptedStatus = (await statusAfter.json()) as LegalAcceptanceStatus;
      expect(acceptedStatus).toMatchObject({ required: false, companyId });
      expect(acceptedStatus.acceptedAt).toBeTruthy();

      const allowed = await browserApiGet(page, `companies/${companyId}/expenses?page=1&pageSize=1`, companyId);
      expect(allowed.ok(), `business API after acceptance -> ${allowed.status()}: ${await allowed.text()}`).toBe(true);
    } finally {
      if (employeeId) {
        const disabled = await api.post(`companies/${companyId}/settings/employees/${employeeId}/disable`, {
          data: { status: 'DISABLED', reason: 'E2E legal acceptance cleanup' },
        });
        expect(disabled.ok(), `disable disposable employee -> ${disabled.status()}: ${await disabled.text()}`).toBe(true);
      }
    }
  });
});
