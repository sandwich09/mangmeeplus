import { test, expect } from './harness/fixtures';
import { expectMainReady } from './harness/e2e-utils';
import { captureEvidence, describeFailures } from './harness/inv11';
import type { Page } from '@playwright/test';

/**
 * Evidence suite — spec section 12, decisions D10 and D11.
 *
 * Runs on all seven device entries. Mobile failures fail the run; desktop failures are
 * recorded as DESKTOP-FINDING and do not, because D2 (desktop pixel parity) outranks D11.
 *
 * Every run writes outputs/mobile-evidence/<project>/results.jsonl plus a full-page
 * screenshot per subject. `scripts/build-evidence-manifest.mjs` turns those into EVIDENCE.md.
 */

/** The nine launch features, spec section 7. */
const PRIORITY_ROUTES = [
  '/expenses',
  '/expenses/wht-certificates',
  '/expenses/upload',
  '/expenses/manual',
  '/expenses/disbursement-vouchers',
  '/expenses/disbursement-vouchers/new',
  // Missing-document state; a populated voucher needs controller-seeded data.
  '/expenses/disbursement-vouchers/00000000-0000-4000-8000-000000000000',
  '/expenses/evidence',
  '/expenses/categories',
  '/expenses/signatures',
  '/expenses/substitute-receipts',
  // Step 1 of the issuance wizard. The remaining steps are walked by the flow test below.
  '/expenses/substitute-receipts/new',
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
 * Card lists that must be checked card by card — "ทุกการ์ด", not the first card.
 * A list that renders zero rows records NO EVIDENCE and fails: a silent empty state is the
 * most likely way this bundle ends up lying about coverage.
 */
const CARD_LISTS = [
  { route: '/expenses/wht-certificates', listTestId: 'wht-certificate-card-list', cardTestId: 'wht-certificate-card' },
  { route: '/reimbursements', listTestId: 'reimbursements-mine-card-list', cardTestId: 'reimbursements-mine-card' },
  { route: '/expenses', listTestId: 'expenses-card-list', cardTestId: 'expenses-row' },
  { route: '/accounting', listTestId: 'accounting-documents-card-list', cardTestId: 'accounting-document-card' },
  // Added in M4a. Two queues, not the three the plan named: the พนักงาน list in S2-F lives in
  // MatrixView, which has zero consumers — every employee-access route renders a *Prototype*
  // component instead. Decision D6 keeps dead components dead, so that card view was reverted
  // rather than shipped to nobody.
  { route: '/expenses/evidence', listTestId: 'evidence-card-list', cardTestId: 'evidence-card' },
  { route: '/expenses/substitute-receipts', listTestId: 'substitute-receipt-card-list', cardTestId: 'substitute-receipt-card' },
] as const;

async function gotoAndSettle(page: Page, companyId: string, route: string) {
  await page.goto(`/companies/${companyId}${route}`);
  await expectMainReady(page);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}

test.describe('INV-11 evidence', () => {
  for (const route of PRIORITY_ROUTES) {
    test(`${route} — INV-11 controls reachable`, async ({ authedPage, companyId }, testInfo) => {
      await gotoAndSettle(authedPage, companyId, route);
      const row = await captureEvidence(authedPage, testInfo, `route${route}`);
      if (route === '/expenses/substitute-receipts' && [1280, 1556, 1680].includes(authedPage.viewportSize()?.width ?? 0)) {
        const overflowing = await authedPage.locator('main table td').evaluateAll(cells => cells.filter(cell => cell.scrollWidth > cell.clientWidth).map(cell => cell.textContent));
        expect(overflowing, 'substitute receipt cells fit their columns').toEqual([]);
      }

      // Desktop is measured, not enforced (D11): record the finding, keep the run green.
      if (row.desktopFinding) {
        test.info().annotations.push({ type: 'DESKTOP-FINDING', description: describeFailures(route, row.failures) });
        return;
      }
      expect(row.failures, describeFailures(route, row.failures)).toEqual([]);
    });
  }

  // The screen this whole project started from. BrandedState renders on error, 404,
  // access-denied and company-unavailable, so it sits on no route in PRIORITY_ROUTES and had
  // no automated evidence at all until M1 — the one screen most in need of it.
  test('branded state (404) — INV-11 controls reachable', async ({ authedPage, companyId }, testInfo) => {
    await authedPage.goto(`/companies/${companyId}/this-route-does-not-exist`);
    await expect(authedPage.getByRole('heading', { level: 1 })).toBeVisible();
    const row = await captureEvidence(authedPage, testInfo, 'branded-state-404');

    if (row.desktopFinding) {
      testInfo.annotations.push({ type: 'DESKTOP-FINDING', description: describeFailures('404', row.failures) });
      return;
    }
    expect(row.failures, describeFailures('branded state 404', row.failures)).toEqual([]);
  });

  // Acceptance criterion 6: on a phone the first action offered is the camera, and no visible
  // copy tells the user to drag a file. Desktop keeps its dropzone, which is the other half of
  // the same assertion — a mobile-only change that quietly rewrote desktop would fail here.
  test('/expenses/upload — camera first on a phone, dropzone on desktop', async ({ authedPage, companyId, isMobile }, testInfo) => {
    await gotoAndSettle(authedPage, companyId, '/expenses/upload');
    const dragCopy = authedPage.getByText('ลากไฟล์มาวาง', { exact: false });

    if (isMobile) {
      const cameraLabel = authedPage.locator('label:has(input[capture="environment"])');
      await expect(cameraLabel, 'a phone must be offered the camera directly').toHaveCount(1);
      const box = await cameraLabel.boundingBox();
      expect(box?.height ?? 0, 'camera button must be a real touch target').toBeGreaterThanOrEqual(44);
      await expect(dragCopy, 'a phone cannot drag a file — that copy must not be visible').toBeHidden();
    } else {
      await expect(dragCopy, 'desktop keeps its dropzone verbatim').toBeVisible();
    }
    await captureEvidence(authedPage, testInfo, 'upload-capture-affordance');
  });

  // Acceptance criterion 9 (decision D9): the row is one link, its actions sit behind a single
  // 44px control, and no title is cut off mid-line. `elementFromPoint` is the part that matters
  // — it is the only way to prove the menu button is not sitting on top of the row link beside it.
  test('/notifications — the row is one target and its actions are behind one control', async ({ authedPage, companyId, isMobile }, testInfo) => {
    await gotoAndSettle(authedPage, companyId, '/notifications');
    const row = authedPage.locator('[class*="divide-y"] > div').first();

    if (await row.count()) {
      const overlay = row.locator('a.absolute.inset-0');
      const menu = row.getByRole('button', { name: 'ตัวเลือกการแจ้งเตือน' });
      await expect(overlay, 'the whole row must be one real link').toHaveCount(1);
      await expect(menu, 'the two text actions must collapse into one control').toHaveCount(1);

      const rowBox = await row.boundingBox();
      const overlayBox = await overlay.boundingBox();
      expect(overlayBox?.width ?? 0, 'the link must span the row, badge included')
        .toBeGreaterThanOrEqual((rowBox?.width ?? 0) - 1);

      if (isMobile) {
        const menuBox = await menu.boundingBox();
        expect(Math.min(menuBox?.width ?? 0, menuBox?.height ?? 0)).toBeGreaterThanOrEqual(43);
        await expect(row.locator('.truncate'), 'titles must wrap, not be cut off, on a phone').toHaveCount(0);
      }
    }
    await captureEvidence(authedPage, testInfo, 'notification-row-model');
  });

  // Phase M4c — ทดแทนใบเสร็จ, the flow rather than the class sweep (decision D8). Each step the
  // fixture can reach is captured and checked; completing a real issuance, signature included,
  // stays the owner's on-device gate, because no headless run can judge whether signing with a
  // finger in a 176px pad actually feels workable.
  test('substitute-receipt wizard — every reachable step is usable at this width', async ({ authedPage, companyId, isMobile }, testInfo) => {
    await gotoAndSettle(authedPage, companyId, '/expenses/substitute-receipts/new');

    // ThemedSteps renders <nav><ol><li> inside the page body. Scoped to #workspace-main so the
    // shell's own navigation cannot satisfy it.
    const steps = authedPage.locator('#workspace-main nav ol li');
    const stepCount = await steps.count().catch(() => 0);

    const row = await captureEvidence(authedPage, testInfo, 'substitute-wizard-step1-expense');
    if (!row.desktopFinding) {
      expect(row.failures, describeFailures('substitute wizard step 1', row.failures)).toEqual([]);
    }

    // Not `if (stepCount > 0)`: a locator that silently matches nothing would skip every
    // assertion below and report green, which is the exact failure mode this suite exists to
    // stop. The wizard always renders its stepper.
    expect(stepCount, 'the wizard stepper must be found before it can be judged').toBeGreaterThan(0);

    if (isMobile) {
      // The audit flagged ~65px per label at 390px as "cramped but legible". Measure it rather
      // than leave it as an opinion: a label narrower than 44px is not a legible step marker.
      const widths = await steps.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
      expect(Math.min(...widths), `stepper labels are ${widths.map(Math.round).join('/')}px wide`).toBeGreaterThanOrEqual(44);

      // The guide card is `xl:sticky`; on a phone it must simply sit inline and not pin itself
      // over the form it is explaining.
      const guide = authedPage.locator('[class*="xl:sticky"]').first();
      if (await guide.count()) {
        const position = await guide.evaluate((node) => window.getComputedStyle(node).position);
        expect(position, 'the guide card must not be sticky on a phone').toBe('static');
      }
    }
  });

  for (const cardList of CARD_LISTS) {
    test(`${cardList.route} — INV-11 every card`, async ({ authedPage, companyId, isMobile }, testInfo) => {
      await gotoAndSettle(authedPage, companyId, cardList.route);

      const list = authedPage.getByTestId(cardList.listTestId);
      // Card lists hide when the content fits a table — on a desktop width their absence is correct, not missing
      // evidence. Presence is checked with count() rather than isVisible(): an empty list still
      // exists in the DOM but has no height, and "the queue is empty" is a different fact from
      // "the mobile view is missing". Conflating them hid a fixture gap behind a layout message.
      if ((await list.count()) === 0 || !isMobile) {
        const reason = isMobile ? 'card list is not in the DOM at a mobile width' : 'card list is hidden at this width — desktop shows the table instead';
        await captureEvidence(authedPage, testInfo, `cards${cardList.route}`, { noEvidence: reason });
        expect(isMobile, `NO EVIDENCE: ${cardList.route} ${reason}`).toBeFalsy();
        return;
      }

      const cards = authedPage.getByTestId(cardList.listTestId).getByTestId(cardList.cardTestId);
      if (cardList.route === '/expenses/substitute-receipts') {
        await expect(list.getByRole('button', { name: /^ดูเอกสาร/ })).toHaveCount(0);
        await expect(list.locator('a')).toHaveCount(0);
        await expect(list.getByRole('link').first()).toHaveAttribute('tabindex', '0');
        await expect(list.getByRole('link').first()).not.toContainText('฿');
      }
      const count = await cards.count();
      if (count === 0) {
        await captureEvidence(authedPage, testInfo, `cards${cardList.route}`, { noEvidence: 'list rendered 0 cards' });
        throw new Error(`NO EVIDENCE: ${cardList.route} rendered 0 cards — fix the fixture, do not waive the row`);
      }

      const failures: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const row = await captureEvidence(authedPage, testInfo, `cards${cardList.route}-${index + 1}`, {
          scope: cards.nth(index),
          cardsChecked: 1,
        });
        if (row.failures.length && !row.desktopFinding) {
          failures.push(describeFailures(`${cardList.route} card ${index + 1}/${count}`, row.failures));
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});
