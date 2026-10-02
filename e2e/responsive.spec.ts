import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { expectMainReady, json } from './harness/e2e-utils';

const ROUTES = [
  '/dashboard',
  '/inbox',
  '/customers',
  '/bookings',
  '/sales-documents',
  '/crm-reports',
  '/settings/crm-catalog',
  '/inventory',
  '/inventory/products',
  '/inventory/locations',
  '/inventory/movements',
  '/inventory/reports/stock',
  '/expenses',
  '/expenses/upload',
  '/expenses/manual',
  '/expenses/categories',
  '/expenses/signatures',
  '/settings/substitute-receipt',
  '/expenses/evidence',
  '/reimbursements',
  '/journal',
  '/accounting',
  '/tax',
  '/reports',
  '/period-closing',
  '/settings/permissions',
  '/settings/access-overview',
  '/settings/employees',
  '/settings/po-approval',
  '/settings/discount-policy',
  '/settings/line-oa',
  '/settings',
  '/settings/accounting-tax-setup',
  '/settings/chart-of-accounts',
  '/settings/tax-codes',
  '/settings/tax-accounts',
  '/settings/branches',
  '/settings/security',
  '/crm',
  '/crm/payment-proofs',
  '/banking',
  '/accounts-payable',
  '/procurement',
  '/workflow',
  '/notifications',
  '/ai-suggestions',
] as const;

const CARD_VIEW_CASES = [
  {
    route: '/reimbursements',
    tableTestId: 'reimbursements-mine-table',
    cardListTestId: 'reimbursements-mine-card-list',
    cardTestId: 'reimbursements-mine-card',
    // A card opens the claim's journey page (reimbursement step journey, Phase 2).
    url: /\/reimbursements\/[^/?#]+$/,
    // 9, not 8. The header has carried nine columns since before this branch — the region is
    // byte-identical to origin/develop — so the constant had simply gone stale and the desktop
    // parity test was failing on develop too. Corrected rather than left red, since a test
    // nobody trusts is worse than no test.
    columnCount: 9,
    // The hub's lists switch by the width of their own card, and the nine-column table needs 1280 px of it:
    // on a 1280 px screen the side menu leaves 901 px, where the list is cards and no table scrolls sideways.
    desktopViewport: { width: 1920, height: 1080 },
  },
  {
    route: '/expenses',
    tableTestId: 'expenses-grid',
    cardListTestId: 'expenses-card-list',
    cardTestId: 'expenses-card',
    url: /\/expenses\/[^/?#]+$/,
    // Named, not counted: a bare 5 could not say that the expense number had been given a column of its own, the first.
    // The last is the action column, whose heading only a screen reader reads.
    columns: ['เลขรายจ่าย (EXP)', 'ผู้ขาย / หมวดหมู่', 'วันที่เอกสาร / เข้าระบบ', 'ยอดรวม', 'สถานะ', 'การทำงาน'],
  },
  {
    route: '/accounting',
    tableTestId: 'accounting-documents-table',
    cardListTestId: 'accounting-documents-card-list',
    cardTestId: 'accounting-document-card',
    url: /\/accounting\?documentId=[^&]+$/,
    columnCount: 7,
  },
] as const;

/**
 * The nine launch features (spec section 7). INV-5 used to sample two routes; acceptance
 * criterion 4 requires all of them, because the sub-16px fields the audit found live on
 * routes nobody was sampling.
 */
const PRIORITY_ROUTES = [
  '/expenses',
  '/expenses/upload',
  '/expenses/manual',
  '/expenses/evidence',
  '/expenses/categories',
  '/expenses/signatures',
  '/expenses/substitute-receipts',
  '/settings/substitute-receipt',
  '/reimbursements',
  '/dashboard',
  '/notifications',
  // NotificationPreferencesPage and NotificationRulesPage live on their own routes; the
  // sub-16px fields the audit found are here, not on /notifications.
  '/settings/notifications',
  '/notifications/rules',
  '/settings/employees',
  '/settings/permissions',
  '/settings',
] as const;

/**
 * Routes whose whole point is a form. A zero here is not "this page has no fields", it is
 * "the page did not render its form" — the silent-empty failure mode the spec calls out
 * (section 12.3). Fix the fixture; do not soften the assertion.
 */
const ROUTES_THAT_MUST_HAVE_FIELDS = new Set<string>([
  '/expenses/upload',
  '/expenses/manual',
  '/settings/substitute-receipt',
  '/settings/notifications',
]);

async function gotoAndSettle(page: Page, companyId: string, route: string) {
  await page.goto(`/companies/${companyId}${route}`);
  await expectMainReady(page);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}

async function expectNoZoomFields(page: Page, location: string, options: { requireFields?: boolean } = {}) {
  // Scoped to the page's own content: the shell header carries its own search input, so a
  // whole-page query reports "this route has fields" even when the route rendered nothing.
  // That made the requireFields guard below useless until it was scoped here.
  const main = page.locator('#workspace-main');
  const scope = (await main.count()) > 0 ? main : page.locator('body');
  const fields = scope.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):visible, select:visible, textarea:visible');
  if (options.requireFields === false) {
    // A list route with no form fields is a legitimate zero, not a silent pass: it is
    // annotated below so the run states it was checked rather than skipped.
    if ((await fields.count()) === 0) return 0;
  } else {
    await expect(fields.first(), `INV-5 ${location}: expected at least one visible form field`).toBeVisible();
  }
  const tooSmall = await fields.evaluateAll((elements) => elements.flatMap((element) => {
    const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
    return fontSize >= 16 ? [] : [{
      field: element.getAttribute('id') ?? element.getAttribute('name') ?? `${element.tagName.toLowerCase()}[type=${element.getAttribute('type') ?? 'text'}]`,
      fontSize,
    }];
  }));
  expect(tooSmall, `INV-5 ${location}: form fields below 16px trigger iOS focus zoom`).toEqual([]);
  return fields.count();
}

async function expectInViewport(selector: Locator, location: string) {
  await expect(selector).toBeVisible();
  const bounds = await selector.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
  });
  expect.soft(bounds.left, `INV-6 ${location}: popover left edge is outside the viewport`).toBeGreaterThanOrEqual(0);
  expect.soft(bounds.right, `INV-6 ${location}: popover right edge is outside the viewport`).toBeLessThanOrEqual(bounds.viewportWidth);
}

// RESPONSIVE_VIEWPORT=375x667 re-runs the mobile suite at the 375px floor (R5 matrix).
const viewportOverride = /^(\d+)x(\d+)$/.exec(process.env['RESPONSIVE_VIEWPORT'] ?? '');
if (viewportOverride) {
  test.use({ viewport: { width: Number(viewportOverride[1]), height: Number(viewportOverride[2]) } });
}

// P24-2a deliberately covers desktop too; the legacy mobile-only describe below must not skip it.
test.describe('P24-2a shared-shell targets', () => {
  for (const width of [360, 640, 768, 1023, 1024, 1280]) {
    test(`${width}px — 44px controls keep pointer and keyboard behavior`, async ({ authedPage, companyId }) => {
      await authedPage.setViewportSize({ width, height: 900 });
      await gotoAndSettle(authedPage, companyId, '/dashboard');
      const originalUrl = authedPage.url();
      const drawer = authedPage.locator('aside').first();
      const compact = width < 1024;
      const toggle = authedPage.locator(compact ? 'header' : 'aside').getByRole('button', { name: 'สลับเมนู', exact: true });
      const bell = authedPage.getByRole('button', { name: 'การแจ้งเตือน', exact: true });

      // Each fixture has a fresh page/context; also prove the initial desktop state in rendered pixels.
      if (!compact) await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(289);

      for (const [label, control] of [['menu toggle', toggle], ['notification bell', bell]] as const) {
        await expect(control, `${label} must exist before measuring`).toHaveCount(1);
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box?.width ?? 0, `${label} width at ${width}px`).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0, `${label} height at ${width}px`).toBeGreaterThanOrEqual(44);
        await expectInViewport(control, label);
      }

      const dimensions = await authedPage.evaluate(() => ({
        scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(dimensions.scrollWidth, 'expanded shell controls must not cause page overflow').toBeLessThanOrEqual(dimensions.viewportWidth + 1);

      await bell.click();
      await expect(bell).toHaveAttribute('aria-expanded', 'true');
      const panel = bell.locator('..').locator('div.fixed');
      await expect(panel).toBeVisible();
      await expectInViewport(panel, 'notification panel');
      await authedPage.keyboard.press('Escape');
      await expect(bell).toHaveAttribute('aria-expanded', 'false');
      await bell.press('Enter');
      await expect(bell).toBeFocused();
      await expect(bell).toHaveAttribute('aria-expanded', 'true');
      expect(await bell.evaluate((node) => window.getComputedStyle(node).boxShadow), 'keyboard focus stays visible').not.toBe('none');
      await authedPage.keyboard.press('Escape');
      await expect(bell).toHaveAttribute('aria-expanded', 'false');

      await toggle.click();
      if (compact) {
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(drawer).toHaveClass(/(?:^|\s)translate-x-0(?:\s|$)/);
        await authedPage.keyboard.press('Escape');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(toggle).toBeFocused();
        await authedPage.keyboard.press('Escape');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(drawer).toHaveClass(/(?:^|\s)-translate-x-full(?:\s|$)/);
        await expect(drawer).toBeHidden();
      } else {
        // Existing desktop collapse removes its trigger; restoring that focus is a separate P24 gap.
        // The desktop shell expands on hover: move off it before asserting the collapsed state.
        // It opens over the page, which stays where it is, so the page's heading lies under it: the pointer leaves for a
        // point of the page beyond the sidebar's 289 px, and reaches the heading once the sidebar has closed.
        const pageHeading = authedPage.getByRole('heading', { level: 1 });
        const leaveSidebar = () => authedPage.mouse.move(289 + 100, 450);
        await leaveSidebar();
        await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(86);
        await pageHeading.hover();
        if (await authedPage.evaluate(() => window.matchMedia('(hover: hover)').matches)) {
          await drawer.hover();
          await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(289);
          await leaveSidebar();
          await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(86);
        }
      }

      await expect(authedPage).toHaveURL(originalUrl);
      await expectNoClientError(authedPage);
    });
  }

  for (const width of [390, 1280]) {
    test(`${width}px — forced colors preserve keyboard focus outlines`, async ({ authedPage, companyId, browserName }) => {
      test.skip(browserName !== 'chromium', 'Windows-style forced-colors is verified with Chromium emulation.');
      await authedPage.setViewportSize({ width, height: 900 });
      await authedPage.emulateMedia({ forcedColors: 'active' });
      await gotoAndSettle(authedPage, companyId, '/dashboard');
      expect(await authedPage.evaluate(() => window.matchMedia('(forced-colors: active)').matches)).toBe(true);
      await authedPage.keyboard.press('Tab');
      const toggle = authedPage.locator(width < 1024 ? 'header' : 'aside').getByRole('button', { name: 'สลับเมนู', exact: true });
      const bell = authedPage.getByRole('button', { name: 'การแจ้งเตือน', exact: true });
      for (const control of [toggle, bell]) {
        await expect(control).toBeVisible();
        await control.focus();
        await expect(control).toBeFocused();
        const outline = await control.evaluate((node) => {
          const style = window.getComputedStyle(node);
          return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
        });
        expect(outline.style).not.toBe('none');
        expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
        expect(outline.color).not.toBe('rgba(0, 0, 0, 0)');
      }
      await expectNoClientError(authedPage);
    });
  }
});

test.describe('P24-2b scope-selector targets', () => {
  const retryName = 'โหลดข้อมูลไม่สำเร็จ · ลองใหม่';
  const companyUrl = '**/api/v1/auth/me/companies';
  const branchUrl = '**/api/v1/companies/*/branches?status=ACTIVE&pageSize=100';

  async function scopeFixtures(api: APIRequestContext, companyId: string) {
    const { data: companies } = await json<{ data: Array<{ companyId: string; companyName: string }> }>(await api.get('auth/me/companies'));
    const { items: branches } = await json<{ items: Array<{ id: string; name: string; type: string }> }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
    expect(companies.length, 'real memberships must expose a company switcher').toBeGreaterThanOrEqual(2);
    expect(branches.length, 'real branches must expose selectable options').toBeGreaterThanOrEqual(2);
    return { companies, branches };
  }

  async function target(control: Locator, label: string) {
    await expect(control, `${label}: no silent missing-control pass`).toHaveCount(1);
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect.soft(box?.width ?? 0, `${label}: width`).toBeGreaterThanOrEqual(44);
    expect.soft(box?.height ?? 0, `${label}: height`).toBeGreaterThanOrEqual(44);
    await expectInViewport(control, label);
    const hit = await control.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { matches: node.contains(top), covering: top?.outerHTML.slice(0, 240), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect.soft(hit.matches, `${label}: center is hit-testable ${JSON.stringify(hit)}`).toBe(true);
  }

  async function focus(control: Locator, forcedColors = false) {
    await control.focus();
    await expect(control).toBeFocused();
    const style = await control.evaluate((node) => {
      const css = getComputedStyle(node);
      return { shadow: css.boxShadow, outline: css.outlineStyle, width: css.outlineWidth, color: css.outlineColor };
    });
    if (forcedColors) {
      expect.soft(style.outline).not.toBe('none');
      expect.soft(parseFloat(style.width)).toBeGreaterThanOrEqual(2);
      expect.soft(style.color).not.toBe('rgba(0, 0, 0, 0)');
    } else expect.soft(style.shadow, 'keyboard focus ring').not.toBe('none');
  }

  async function noOverflow(page: Page) {
    expect.soft(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) - document.documentElement.clientWidth), 'scope controls do not widen the page').toBeLessThanOrEqual(1);
  }

  for (const width of [360, 390, 768, 1280]) {
    test(`${width}px — real membership/branch targets keep selection and keyboard behavior`, async ({ authedPage, api, companyId }, testInfo) => {
      const { companies, branches } = await scopeFixtures(api, companyId);
      await authedPage.setViewportSize({ width, height: width === 360 ? 740 : width === 390 ? 844 : 900 });
      await gotoAndSettle(authedPage, companyId, '/dashboard');
      const originalUrl = authedPage.url();
      const company = authedPage.getByRole('button', { name: 'สลับบริษัท', exact: true });
      const branch = authedPage.getByRole('button', { name: 'เลือกสาขา', exact: true });
      await expect(company).toContainText(companies.find((c) => c.companyId === companyId)!.companyName);
      await expect(branch).toHaveText('ทุกสาขา (รวม)');
      await authedPage.keyboard.press('Tab');
      for (const [label, trigger, count] of [['company', company, companies.length], ['branch', branch, branches.length + 1]] as const) {
        // Tab initially focuses the visible skip link; move focus off it before hit-testing the header.
        await focus(trigger);
        await target(trigger, label);
        await trigger.press('Enter');
        const popup = trigger.locator('..').locator('div.fixed');
        await expectInViewport(popup, `${label} popup`);
        await expect(popup).toBeInViewport({ ratio: 1 });
        const options = popup.getByRole('button');
        await expect(options).toHaveCount(count);
        for (let index = 0; index < count; index += 1) {
          await target(options.nth(index), `${label} option ${index}`);
          await focus(options.nth(index));
        }
        await noOverflow(authedPage);
        await testInfo.attach(`real-${label}-${width}px`, { body: await authedPage.screenshot(), contentType: 'image/png' });
        // Re-selecting current scope only closes the menu; it must not navigate or mutate.
        await popup.getByRole('button', { name: / ✓$/, exact: false }).press('Enter');
        await expect(popup).toHaveCount(0);
        await expect(authedPage).toHaveURL(originalUrl);
      }
      const pick = branches.find((b) => b.type === 'BRANCH');
      expect(pick, 'real non-HQ branch fixture').toBeDefined();
      await branch.click();
      const scopedRead = authedPage.waitForResponse((res) => res.url().includes('/dashboard?') && new URL(res.url()).searchParams.get('branchId') === pick!.id);
      await branch.locator('..').getByRole('button', { name: pick!.name, exact: true }).click();
      expect((await scopedRead).status()).toBe(200);
      await expect(branch).toHaveText(pick!.name);
      await authedPage.reload();
      await expect(branch).toHaveText(pick!.name);
      await branch.click();
      await branch.locator('..').getByRole('button', { name: 'ทุกสาขา (รวม)', exact: true }).click();
      await expect(branch).toHaveText('ทุกสาขา (รวม)');
      await expect(authedPage).toHaveURL(originalUrl);
      await noOverflow(authedPage);
      await expectNoClientError(authedPage);
    });

    test(`${width}px — mocked long display labels retain real IDs and fit targets/popups`, async ({ authedPage, companyId }, testInfo) => {
      const longLabel = ' ชื่อแสดงผลจำลองสำหรับตรวจหน้าจอเท่านั้น '.repeat(2) + 'LongUnbrokenDisplayLabel'.repeat(4);
      // Change display text only after a successful real read; no invented membership/permission.
      for (const url of [companyUrl, branchUrl]) await authedPage.route(url, async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const body = await response.json();
        if (url === companyUrl) body.data = body.data.map((row: { companyName: string }) => ({ ...row, companyName: row.companyName + longLabel }));
        else body.items = body.items.map((row: { name: string }, index: number) => ({ ...row, name: row.name + (index === 0 ? longLabel : '') }));
        await route.fulfill({ response, json: body });
      });
      await authedPage.setViewportSize({ width, height: width === 360 ? 740 : width === 390 ? 844 : 900 });
      await gotoAndSettle(authedPage, companyId, '/dashboard');
      for (const name of ['สลับบริษัท', 'เลือกสาขา']) {
        const trigger = authedPage.getByRole('button', { name, exact: true });
        await target(trigger, name);
        await trigger.click();
        const popup = trigger.locator('..').locator('div.fixed');
        await expectInViewport(popup, `${name} long-label popup`);
        await expect(popup).toBeInViewport({ ratio: 1 });
        const options = popup.getByRole('button');
        expect(await options.count(), 'long-label case must render options').toBeGreaterThanOrEqual(2);
        for (const option of await options.all()) {
          await target(option, 'long-label option');
          expect.soft(await option.evaluate((node) => node.scrollWidth - node.clientWidth), 'option text must wrap rather than be clipped').toBeLessThanOrEqual(1);
        }
        await noOverflow(authedPage);
        await testInfo.attach(`mock-display-only-${name}-${width}px`, { body: await authedPage.screenshot(), contentType: 'image/png' });
        await trigger.click();
        await expect(popup).toHaveCount(0);
      }
      await expectNoClientError(authedPage);
    });
  }

  for (const width of [360, 390, 1280]) for (const [kind, url, name, count] of [
    ['company', companyUrl, 'สลับบริษัท', 20],
    ['branch', branchUrl, 'เลือกสาขา', 100],
  ] as const) {
    test(`${width}px — synthetic long ${kind} menu scrolls to a valid last option (geometry only)`, async ({ authedPage, api, companyId }, testInfo) => {
      const { branches } = await scopeFixtures(api, companyId);
      const lastBranch = branches.find((row) => row.type === 'BRANCH')!;
      await authedPage.route(url, async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const body = await response.json();
        // Geometry fixture only: preserve every real ID/row; never select a synthetic ID.
        if (kind === 'company') {
          const rows = body.data as Array<{ companyId: string; companyName: string }>;
          const current = rows.find((row) => row.companyId === companyId)!;
          body.data = [...rows.filter((row) => row !== current),
            ...Array.from({ length: count - rows.length }, (_, index) => ({ ...current, companyId: `p24-geometry-company-${index}`, companyName: `บริษัทจำลองหน้าจอ ${index + 1}` })), current];
        } else {
          const rows = body.items as Array<{ id: string; name: string }>;
          const last = rows.find((row) => row.id === lastBranch.id)!;
          body.items = [...rows.filter((row) => row !== last),
            ...Array.from({ length: count - rows.length }, (_, index) => ({ ...last, id: `p24-geometry-branch-${index}`, name: `สาขาจำลองหน้าจอ ${index + 1}` })), last];
        }
        await route.fulfill({ response, json: body });
      });
      await authedPage.setViewportSize({ width, height: width === 360 ? 740 : width === 390 ? 844 : 900 });
      await gotoAndSettle(authedPage, companyId, '/dashboard');
      const originalUrl = authedPage.url();
      const trigger = authedPage.getByRole('button', { name, exact: true });
      await trigger.click();
      const popup = trigger.locator('..').locator('div.fixed');
      const options = popup.getByRole('button');
      await expect(options).toHaveCount(count + (kind === 'branch' ? 1 : 0));
      const geometry = await popup.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: box.height, viewportHeight: innerHeight, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflowY: getComputedStyle(node).overflowY };
      });
      await testInfo.attach(`mock-long-${kind}-${width}px-geometry`, { body: Buffer.from(JSON.stringify(geometry)), contentType: 'application/json' });
      await testInfo.attach(`mock-long-${kind}-${width}px-open`, { body: await authedPage.screenshot(), contentType: 'image/png' });
      expect(geometry.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewportHeight);
      expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
      await expect(popup).toBeInViewport({ ratio: 1 });
      const last = options.last();
      await authedPage.keyboard.press('Tab');
      await last.scrollIntoViewIfNeeded();
      expect(await popup.evaluate((node) => node.scrollTop), 'last option requires actual internal scrolling').toBeGreaterThan(0);
      await focus(last);
      await target(last, 'last valid long-menu option');
      await noOverflow(authedPage);
      await testInfo.attach(`mock-long-${kind}-${width}px-scrolled`, { body: await authedPage.screenshot(), contentType: 'image/png' });
      const scopedRead = kind === 'branch' ? authedPage.waitForResponse((res) => res.url().includes('/dashboard?') && new URL(res.url()).searchParams.get('branchId') === lastBranch.id) : null;
      await last.press('Enter');
      await expect(popup).toHaveCount(0);
      if (scopedRead) { expect((await scopedRead).status()).toBe(200); await expect(trigger).toHaveText(lastBranch.name); }
      await expect(authedPage).toHaveURL(originalUrl);
      await noOverflow(authedPage);
      await expectNoClientError(authedPage);
    });
  }

  for (const width of [360, 390, 1280]) {
    test(`${width}px — mocked lookup failures expose readable touch-sized retries and recover real options`, async ({ authedPage, companyId }, testInfo) => {
      let fail = true;
      const reads = { company: 0, branch: 0 };
      for (const [kind, url] of [['company', companyUrl], ['branch', branchUrl]] as const) await authedPage.route(url, async (route) => {
        reads[kind] += 1;
        if (fail) await route.fulfill({ status: 503, json: { statusCode: 503, message: 'Synthetic scope lookup failure', error: 'Service Unavailable' } });
        else await route.continue();
      });
      await authedPage.setViewportSize({ width, height: width === 360 ? 740 : width === 390 ? 844 : 900 });
      await gotoAndSettle(authedPage, companyId, '/dashboard');
      const retries = authedPage.locator('header').getByRole('button', { name: retryName, exact: true });
      await expect(retries).toHaveCount(2);
      await expect(authedPage.getByRole('button', { name: 'เลือกสาขา', exact: true })).toHaveCount(0);
      await authedPage.keyboard.press('Tab');
      for (const control of await retries.all()) {
        await focus(control);
        await target(control, 'lookup retry');
        await expect(control).toHaveAttribute('aria-label', retryName);
        await expect(control).toHaveAttribute('title', retryName);
        const visibleAction = width < 640 ? 'ลองใหม่' : retryName;
        const visibleCopy = control.getByText(visibleAction, { exact: true });
        await expect(visibleCopy).toBeVisible();
        await expect(control).toHaveAccessibleName(new RegExp(visibleAction, 'i'));
        expect(await visibleCopy.evaluate((node) => {
          const text = node.getBoundingClientRect();
          const button = node.closest('button')!.getBoundingClientRect();
          return text.left >= button.left && text.right <= button.right && text.top >= button.top && text.bottom <= button.bottom;
        }), 'the complete visible retry action fits inside its button').toBe(true);
      }
      await noOverflow(authedPage);
      await testInfo.attach(`mock-503-retries-${width}px`, { body: await authedPage.screenshot(), contentType: 'image/png' });
      const before = { ...reads };
      fail = false;
      await retries.first().press('Enter');
      await expect(authedPage.getByRole('button', { name: 'สลับบริษัท', exact: true })).toBeVisible();
      await expect(retries).toHaveCount(1);
      await retries.press('Enter');
      await expect(authedPage.getByRole('button', { name: 'เลือกสาขา', exact: true })).toBeVisible();
      expect(reads.company).toBeGreaterThan(before.company);
      expect(reads.branch).toBeGreaterThan(before.branch);
      await expect(retries).toHaveCount(0);
      await expectNoClientError(authedPage);
    });

    test(`${width}px — forced colors keep real controls and mocked retries visibly focused`, async ({ authedPage, companyId, browserName }) => {
      test.skip(browserName !== 'chromium', 'Forced-colors is Chromium emulation, not physical Windows evidence.');
      await authedPage.setViewportSize({ width, height: width === 360 ? 740 : width === 390 ? 844 : 900 });
      await authedPage.emulateMedia({ forcedColors: 'active' });
      await gotoAndSettle(authedPage, companyId, '/dashboard');
      expect(await authedPage.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
      await authedPage.keyboard.press('Tab');
      for (const name of ['สลับบริษัท', 'เลือกสาขา']) {
        const trigger = authedPage.getByRole('button', { name, exact: true });
        await focus(trigger, true);
        await target(trigger, name);
        await trigger.press('Enter');
        const popup = trigger.locator('..').locator('div.fixed');
        await expect(popup).toBeInViewport({ ratio: 1 });
        const options = popup.getByRole('button');
        expect(await options.count()).toBeGreaterThanOrEqual(2);
        for (const option of await options.all()) await focus(option, true);
        await trigger.press('Enter');
        await expect(popup).toHaveCount(0);
      }
      for (const url of [companyUrl, branchUrl]) await authedPage.route(url, (route) => route.fulfill({ status: 503, json: { statusCode: 503, message: 'Synthetic scope lookup failure', error: 'Service Unavailable' } }));
      await authedPage.reload();
      const retries = authedPage.locator('header').getByRole('button', { name: retryName, exact: true });
      await expect(retries).toHaveCount(2);
      await authedPage.keyboard.press('Tab');
      for (const control of await retries.all()) { await focus(control, true); await target(control, 'forced-colors retry'); }
    });
  }

  test('mocked 403 keeps branch choices hidden and company retry honest', async ({ authedPage, companyId }) => {
    await authedPage.route(branchUrl, (route) => route.fulfill({ status: 403, json: { statusCode: 403, message: 'Forbidden', error: 'Forbidden' } }));
    await authedPage.setViewportSize({ width: 390, height: 844 });
    await gotoAndSettle(authedPage, companyId, '/dashboard');
    await expect(authedPage.getByRole('button', { name: 'สลับบริษัท', exact: true })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: 'เลือกสาขา', exact: true })).toHaveCount(0);
    await expect(authedPage.locator('header').getByRole('button', { name: retryName, exact: true })).toHaveCount(0);
    await authedPage.route(companyUrl, (route) => route.fulfill({ status: 403, json: { statusCode: 403, message: 'Forbidden', error: 'Forbidden' } }));
    await authedPage.reload();
    const retry = authedPage.locator('header').getByRole('button', { name: retryName, exact: true });
    await target(retry, 'company 403 retry');
    await expect(authedPage.getByRole('button', { name: 'สลับบริษัท', exact: true })).toHaveCount(0);
    await expect(authedPage.getByRole('button', { name: 'เลือกสาขา', exact: true })).toHaveCount(0);
  });

  test('mocked single-branch scope stays a noninteractive label, not permission evidence', async ({ authedPage, api, companyId }) => {
    const { branches } = await scopeFixtures(api, companyId);
    const branch = branches.find((row) => row.type === 'BRANCH');
    expect(branch).toBeDefined();
    await authedPage.route('**/api/v1/auth/me', async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, scopes: { ...body.scopes, branchIds: [branch!.id] } } });
    });
    await gotoAndSettle(authedPage, companyId, '/dashboard');
    await expect(authedPage.locator('header').getByText(branch!.name, { exact: true })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: 'เลือกสาขา', exact: true })).toHaveCount(0);
    await expectNoClientError(authedPage);
  });
});

test.describe('Mobile responsive invariants', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(!isMobile, 'Responsive invariants run only in mobile-chromium.');
  });

  for (const route of ROUTES) {
    test(`${route} — INV-1, INV-2, INV-4`, async ({ authedPage, companyId }) => {
      await gotoAndSettle(authedPage, companyId, route);

      await test.step('INV-1 no page overflow', async () => {
        const dimensions = await authedPage.evaluate(() => ({
          scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
          viewportWidth: window.innerWidth,
        }));
        expect.soft(
          dimensions.scrollWidth,
          `INV-1 ${route}: scrollWidth ${dimensions.scrollWidth}px exceeds viewport ${dimensions.viewportWidth}px`,
        ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      });

      await test.step('INV-2 no clipped table', async () => {
        const clipped = await authedPage.locator('table, [data-testid="expenses-grid"]').evaluateAll((targets) =>
          targets.flatMap((target, index) => {
            const rect = target.getBoundingClientRect();
            const fitsViewport = rect.left >= -1 && rect.right <= window.innerWidth + 1;
            let ancestor: Element | null = target.matches('[data-testid="expenses-grid"]')
              ? target
              : target.parentElement;
            let hasHorizontalScroller = false;
            while (ancestor) {
              const overflowX = window.getComputedStyle(ancestor).overflowX;
              if (overflowX === 'auto' || overflowX === 'scroll') {
                hasHorizontalScroller = true;
                break;
              }
              ancestor = ancestor.parentElement;
            }
            return fitsViewport || hasHorizontalScroller
              ? []
              : [{ index, left: Math.round(rect.left), right: Math.round(rect.right) }];
          }),
        );
        expect.soft(
          clipped,
          `INV-2 ${route}: clipped table(s) ${clipped.map(({ index }) => index).join(', ')}`,
        ).toEqual([]);
      });

      await test.step('INV-4 no client error', async () => {
        await expectNoClientError(authedPage);
      });
    });
  }

  test('/settings/access-overview — permission summary keeps names and status readable', async ({ authedPage, companyId }) => {
    await gotoAndSettle(authedPage, companyId, '/settings/access-overview');

    const summary = authedPage.getByTestId('access-permission-summary');
    await expect(summary.getByTestId('access-permission-row').first()).toBeVisible();
    const dimensions = await summary.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(dimensions.scrollWidth, 'permission summary must not require horizontal scrolling').toBeLessThanOrEqual(dimensions.clientWidth + 1);

    const clippedLabels = await summary.getByTestId('access-permission-menu-label').evaluateAll((labels) => labels.flatMap((label) => {
      const style = window.getComputedStyle(label);
      return style.whiteSpace === 'nowrap' || style.textOverflow === 'ellipsis' ? [label.textContent] : [];
    }));
    expect(clippedLabels, 'permission menu labels must wrap instead of ellipsizing').toEqual([]);
    await expect(summary.getByTestId('access-permission-actions').locator('button, a, [role="button"], [tabindex]')).toHaveCount(0);
  });

  // Owner report 2026-10-02: the role's menu rights were a table with an 820 px minimum, so on a phone
  // only the menu names showed and the ticks had to be scrolled to sideways.
  test('/settings/permissions — a role’s menu rights are read without scrolling sideways', async ({ authedPage, companyId }) => {
    await gotoAndSettle(authedPage, companyId, '/settings/permissions');
    await expect(authedPage.getByRole('heading', { name: /^สิทธิ์เข้าถึงเมนู/ })).toBeVisible();

    const sidewaysScrollers = await authedPage.locator('main').evaluate((main) => [...main.querySelectorAll('*')].flatMap((node) => {
      const overflowX = window.getComputedStyle(node).overflowX;
      return (overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1
        ? [`${node.tagName.toLowerCase()} ${node.scrollWidth}px in ${node.clientWidth}px`]
        : [];
    }));
    expect(sidewaysScrollers, 'nothing on the role page may scroll sideways').toEqual([]);

    const rows = authedPage.getByTestId('role-permission-matrix').getByTestId('role-permission-row');
    await expect(rows.first()).toBeVisible();
    const pastTheEdge = await rows.evaluateAll((elements) => elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > window.innerWidth + 1 ? [element.textContent] : [];
    }));
    expect(pastTheEdge, 'every menu row and its rights stay inside the screen').toEqual([]);
  });

  test('INV-3 drawer works', async ({ authedPage, companyId }) => {
    await gotoAndSettle(authedPage, companyId, '/dashboard');

    const hamburger = authedPage.locator('header button[class*="lg:hidden"]');
    const drawer = authedPage.locator('aside').first();
    await expect(hamburger).toBeVisible();

    await hamburger.tap();
    await expect(drawer).toHaveClass(/translate-x-0/);
    expect.soft(
      await authedPage.evaluate(() => window.getComputedStyle(document.body).overflow),
      'INV-3 /dashboard: body scroll must be locked while the drawer is open',
    ).toBe('hidden');

    const backdrop = authedPage.locator('div[class~="fixed"][class~="inset-0"][class~="z-40"]');
    await expect(backdrop).toBeVisible();
    await backdrop.tap({
      position: { x: (authedPage.viewportSize()?.width ?? 412) - 8, y: 100 },
    });
    await expect(drawer).toHaveClass(/-translate-x-full/);

    await hamburger.tap();
    await expect(drawer).toHaveClass(/translate-x-0/);
    await authedPage.keyboard.press('Escape');
    expect.soft(
      await drawer.getAttribute('class'),
      'INV-3 /dashboard: Escape must close the drawer',
    ).toContain('-translate-x-full');
  });

  test('INV-3 expanded bottom accordion stays in the drawer viewport', async ({ authedPage, companyId }) => {
    await gotoAndSettle(authedPage, companyId, '/dashboard');

    const drawer = authedPage.locator('aside').first();
    await authedPage.locator('header button[class*="lg:hidden"]').tap();
    const guide = drawer.getByRole('button', { name: 'คู่มือการใช้งานระบบ' });
    await guide.tap();
    await expect(guide).toHaveAttribute('aria-expanded', 'true');

    const scrollRoot = drawer.locator('nav').locator('..');
    const lastGuide = drawer.getByRole('link', { name: 'การเบิกจ่ายและอนุมัติ' });
    await expect.poll(async () => {
      const [rootBox, triggerBox, lastGuideBox] = await Promise.all([
        scrollRoot.boundingBox(),
        guide.boundingBox(),
        lastGuide.boundingBox(),
      ]);
      return Boolean(rootBox && triggerBox && lastGuideBox
        && triggerBox.y >= rootBox.y - 1
        && lastGuideBox.y + lastGuideBox.height <= rootBox.y + rootBox.height + 1);
    }, { message: 'expanded guide and its last item must remain visible inside the sidebar scroller' }).toBe(true);
  });

  test('INV-5 login fields do not trigger iOS zoom', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#login-identifier')).toBeVisible();
    await expectNoZoomFields(page, '/login');
  });

  test('INV-5 expenses manual fields do not trigger iOS zoom', async ({ authedPage, companyId }) => {
    await gotoAndSettle(authedPage, companyId, '/expenses/manual');
    await expectNoZoomFields(authedPage, '/expenses/manual');
  });

  for (const route of PRIORITY_ROUTES) {
    test(`${route} — INV-5 no iOS zoom fields`, async ({ authedPage, companyId }, testInfo) => {
      await gotoAndSettle(authedPage, companyId, route);
      const fieldCount = await expectNoZoomFields(authedPage, route, {
        requireFields: ROUTES_THAT_MUST_HAVE_FIELDS.has(route),
      });
      testInfo.annotations.push({ type: 'INV-5', description: `${route}: ${fieldCount} visible field(s) checked` });
    });
  }

  test('INV-6 popovers stay inside the viewport', async ({ authedPage, companyId }) => {
    await gotoAndSettle(authedPage, companyId, '/dashboard');

    const notificationBell = authedPage.getByRole('button', { name: 'การแจ้งเตือน' });
    await notificationBell.tap();
    await expectInViewport(notificationBell.locator('..').locator('div.fixed'), 'notification bell');

    await gotoAndSettle(authedPage, companyId, '/expenses/evidence');

    const branchSelector = authedPage.getByRole('button', { name: 'เลือกสาขา' });
    await branchSelector.tap();
    await expectInViewport(branchSelector.locator('..').locator('div.fixed'), 'branch selector');
    await branchSelector.tap();

    const rightmostExpenseFilter = authedPage.locator('[role="combobox"]').last();
    await rightmostExpenseFilter.tap();
    await expectInViewport(authedPage.getByRole('listbox'), 'expenses filter');
  });

  test('INV-8 tab bars reachable', async ({ authedPage, companyId }) => {
    const cases = [
      { route: '/banking', label: 'รายการปรับปรุง' },
      { route: '/accounts-payable', label: 'AP Aging' },
      { route: '/procurement', label: 'ใบรับสินค้า (GR)' },
    ] as const;

    for (const { route, label } of cases) {
      await test.step(route, async () => {
        await gotoAndSettle(authedPage, companyId, route);

        const strip = authedPage.getByRole('button', { name: label, exact: true }).locator('..');
        const lastTab = strip.getByRole('button').last();
        await expect(lastTab).toHaveAccessibleName(label);
        await lastTab.scrollIntoViewIfNeeded();
        await lastTab.tap();

        await expect.soft(lastTab, `INV-8 ${route}: last tab must report selected state`).toHaveClass(/border-brand-600/);
        await expectNoClientError(authedPage);
      });
    }
  });

  for (const cardView of CARD_VIEW_CASES) {
    test(`${cardView.route} — INV-7 mobile card view`, async ({ authedPage, companyId }) => {
      await gotoAndSettle(authedPage, companyId, cardView.route);

      await expect(authedPage.getByTestId(cardView.tableTestId)).toBeHidden();
      await expect(authedPage.getByTestId(cardView.cardListTestId)).toBeVisible();
      const card = authedPage.getByTestId(cardView.cardTestId).first();
      await expect(card).toBeVisible();

      const dimensions = await authedPage.evaluate(() => ({
        scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
        viewportWidth: window.innerWidth,
      }));
      expect(
        dimensions.scrollWidth,
        `INV-7 ${cardView.route}: scrollWidth ${dimensions.scrollWidth}px exceeds viewport ${dimensions.viewportWidth}px`,
      ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);

      await card.click();
      await expect(authedPage).toHaveURL(cardView.url);
    });
  }
});

test.describe('Desktop card-view parity', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile === true, 'Desktop card-view parity runs only in chromium.');
    // A RESPONSIVE_VIEWPORT override shrinks every test in this file, so desktop
    // assertions would run at a mobile width and fail by design — skip them there.
    test.skip(Boolean(viewportOverride), 'Desktop parity is meaningless under a viewport override.');
  });

  for (const cardView of CARD_VIEW_CASES) {
    test(`${cardView.route} — INV-7 desktop table view`, async ({ authedPage, companyId }) => {
      if ('desktopViewport' in cardView) await authedPage.setViewportSize(cardView.desktopViewport);
      await gotoAndSettle(authedPage, companyId, cardView.route);

      const table = authedPage.getByTestId(cardView.tableTestId);
      await expect(table).toBeVisible();
      await expect(authedPage.getByTestId(cardView.cardListTestId)).toBeHidden();

      if (cardView.route === '/expenses') {
        await expect(table.locator('[class*="uppercase"][class*="tracking-wide"]').first().locator(':scope > div')).toHaveText(cardView.columns);
      } else {
        await expect(table.locator('th')).toHaveCount(cardView.columnCount);
      }
    });
  }
});
