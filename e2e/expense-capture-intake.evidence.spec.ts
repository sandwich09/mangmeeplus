/**
 * Appendix §25 evidence (W09): what the shop SEES on the three lanes, photographed at the two
 * evidence widths — `desktop-1440` and `iphone13-chromium` (390 px). Runs only under the evidence
 * projects (`testMatch: /evidence\.spec\.ts/`); the acceptance itself is
 * `expense-capture-intake.spec.ts`, and the two share `harness/expense-capture.ts`.
 *
 * Output: docs/qa/evidence/marketplace-buyer-expense-capture-2026-09-19/w09/<subject>-<width>.png
 * plus captured-<width>.json (horizontal overflow, measured; console/page errors, asserted empty).
 * Every capture is a fullPage screenshot of the real page; nothing is mocked in the browser.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './harness/fixtures';
import { ensureBrowserLegalAcceptance } from './harness/auth';
import { gotoCompany } from './harness/e2e-utils';
import {
  cleanupSplitPair, openUploadPanel, PDF, PNG, prismaClient, removeQueuedRead, seedQueuedRead, seedSplitPair,
  watchCreatedDrafts, type SplitPair,
} from './harness/expense-capture';

const OUT_DIR = resolve('docs/qa/evidence/marketplace-buyer-expense-capture-2026-09-19/w09');

type Captured = { subject: string; url: string; overflowPx: number; consoleErrors: string[]; pageErrors: string[] };

function watchErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    // A 4xx the page itself handles (a 404 probe, a refused read) is not an application error.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  return { consoleErrors, pageErrors };
}

async function capture(page: Page, subject: string, manifest: Captured[], errors: { consoleErrors: string[]; pageErrors: string[] }) {
  const width = page.viewportSize()?.width ?? 0;
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(OUT_DIR, `${subject}-${width}.png`), fullPage: true });
  manifest.push({ subject, url: page.url(), overflowPx, consoleErrors: [...errors.consoleErrors], pageErrors: [...errors.pageErrors] });
  if (width <= 430) expect(overflowPx, `${subject}: no horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  errors.consoleErrors.length = 0;
  errors.pageErrors.length = 0;
}

test.describe('appendix §25 evidence — the three lanes, photographed', () => {
  test('captures the upload panel, the list, the review page and the auto-split notice', async ({ authedPage: page, api, companyId }) => {
    test.setTimeout(600_000);
    const width = page.viewportSize()?.width ?? 0;
    const manifest: Captured[] = [];
    const errors = watchErrors(page);
    const client = prismaClient();
    let pair: SplitPair | null = null;
    try {
      // 1. Several files in the ORDINARY panel: one row per file, no group, no question.
      const createdIds = watchCreatedDrafts(page);
      await openUploadPanel(page, api, companyId);
      const tag = randomUUID().slice(0, 8);
      await page.locator('input[type=file].hidden').first().setInputFiles([
        { name: `w09-a-${tag}.png`, mimeType: 'image/png', buffer: PNG },
        { name: `w09-b-${tag}.png`, mimeType: 'image/png', buffer: PNG },
        { name: `w09-c-${tag}.pdf`, mimeType: 'application/pdf', buffer: PDF },
      ]);
      await expect(page.locator('[data-capture-file-list] li')).toHaveCount(3);
      await capture(page, 'upload-three-files-picked', manifest, errors);

      // 2. Sent one at a time; the landing is the list with the newest highlighted.
      await page.getByRole('button', { name: /ส่งไฟล์ทั้งหมด|ให้ AI อ่านใบเสร็จ/ }).click();
      await page.waitForURL(/\/expenses\?highlight=/, { timeout: 280_000 });
      await expect(page.locator('[data-highlighted="true"]:visible').first()).toBeVisible();
      await capture(page, 'list-after-three-files', manifest, errors);
      const created = await createdIds();
      expect(created.length).toBe(3);

      // 3. The PDF draft's review page while its read is queued, then after the engine's own verdict
      //    (§17.6). The real job finished in milliseconds (no provider) with the verdict this stack
      //    can give — PARTIAL — so the queued state is photographed from a job the worker has not
      //    claimed yet, which is then withdrawn so the page falls back to the engine's real result.
      //    Nothing about the verdict is staged.
      const pdfExpenseId = created.at(-1)!;
      const queuedJobId = await seedQueuedRead(client, companyId, pdfExpenseId);
      await gotoCompany(page, companyId, `/expenses/${pdfExpenseId}`);
      await expect(page.getByText(/เก็บไฟล์แล้ว กำลังอ่านเอกสาร|อ่านแล้ว \d+ จาก \d+ หน้า/).first()).toBeVisible({ timeout: 30_000 });
      await capture(page, 'review-pdf-reading', manifest, errors);
      await removeQueuedRead(client, companyId, queuedJobId);
      await expect(page.getByText(/อ่านข้อมูลไม่สำเร็จ|อ่านข้อมูลได้บางส่วน|ยังอ่านข้อมูลไม่ครบ/).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: /อ่านเอกสารอีกครั้ง|ลองอ่าน/ })).toHaveCount(0);
      await capture(page, 'review-pdf-read-ended', manifest, errors);

      // 4. One file that held two documents: the engine split it; the page only says so, with links.
      pair = await seedSplitPair(client, companyId);
      await gotoCompany(page, companyId, `/expenses/${pair.ownerId}`);
      await expect(page.locator('[data-capture-auto-split]')).toBeVisible({ timeout: 30_000 });
      await capture(page, 'review-auto-split-notice', manifest, errors);
      // The sticky action bar of the review page repaints over the middle of a fullPage capture, so
      // the notice itself is also cropped on its own — the sentence and its link, unobstructed.
      await page.locator('[data-capture-auto-split]').screenshot({ path: resolve(OUT_DIR, `review-auto-split-notice-crop-${width}.png`) });

      // 5. The legacy single image, unchanged: one file, one draft, the detail page.
      const singleIds = watchCreatedDrafts(page);
      await openUploadPanel(page, api, companyId);
      await page.locator('input[type=file].hidden').first().setInputFiles({
        name: `w09-single-${tag}.png`, mimeType: 'image/png', buffer: PNG,
      });
      await page.getByRole('button', { name: 'ให้ AI อ่านใบเสร็จ', exact: true }).click();
      await page.waitForURL(/\/expenses\/(?!upload$)[^/?#]+$/, { timeout: 150_000 });
      expect((await singleIds()).length).toBe(1);
      await capture(page, 'review-single-image', manifest, errors);

      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(resolve(OUT_DIR, `captured-${width}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
      for (const row of manifest) {
        expect(row.pageErrors, `${row.subject}: no uncaught error`).toEqual([]);
        expect(row.consoleErrors, `${row.subject}: no application console error`).toEqual([]);
      }
    } finally {
      await cleanupSplitPair(client, companyId, pair);
      await client.$disconnect();
    }
  });
});
