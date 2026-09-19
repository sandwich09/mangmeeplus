/**
 * Appendix §25 (owner decision 2026-09-19), end to end in a browser.
 *
 * The owner's condition for approving this wave was "flow เดิมต้องไม่พัง, flow ใหม่ต้อง e2e ได้".
 * The old flows are covered by the suites that already exist and were not edited; this file is the
 * new half:
 *
 *  - one image through the ordinary panel is still one draft, landing where it always did;
 *  - three files through the SAME panel are three drafts, sent one at a time, landing on the list
 *    with the newest highlighted — with no group, no second screen and no new question;
 *  - a PDF draft's review page follows its read job and, when the read ends badly, prints the
 *    §17.6 notice and offers NO re-read while the ordinary form still saves;
 *  - a multi-document outcome shows "พบเอกสาร N ใบ…" with links that open the drafts the engine
 *    created;
 *  - the withdrawn routes 404 instead of erroring, and nothing in the nav points at them.
 *
 * Seeding is synthetic and only ever writes into an explicitly named local database, the way
 * `receipt-draft-continuity.spec.ts` does; every request and every pixel is real. The pictures of
 * these screens are taken by `expense-capture-intake.evidence.spec.ts`.
 *
 * The stack this runs against must have its launch gates open (`prisma/sync-feature-launch-gates.ts`
 * after `prisma/seed.ts`): with the `expenses/DEFAULT` gate row absent every upload answers 403
 * `feature_temporarily_unavailable`, which reads on screen as "the panel does nothing".
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from './harness/fixtures';
import { ensureBrowserLegalAcceptance, expectNoClientError } from './harness/auth';
import { gotoCompany } from './harness/e2e-utils';
import {
  cleanupSplitPair, drainCaptureReads, expense, openUploadPanel, PDF, PNG, prismaClient, seedSplitPair,
  watchCreatedDrafts, WORKER_TOKEN, type SplitPair,
} from './harness/expense-capture';

test.describe('appendix §25 — capture intake with no new screens', () => {
  for (const width of [1280, 390] as const) {
    test(`@p1 one image through the panel is still one draft at ${width}px`, async ({ authedPage: page, api, companyId }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 900 });
      const createdIds = watchCreatedDrafts(page);
      await openUploadPanel(page, api, companyId);

      await page.locator('input[type=file].hidden').first().setInputFiles({
        name: `w09-single-${randomUUID().slice(0, 8)}.png`, mimeType: 'image/png', buffer: PNG,
      });
      await page.getByRole('button', { name: 'ให้ AI อ่านใบเสร็จ', exact: true }).click();

      // The landing a single receipt has always had: the detail page of the draft it created.
      await page.waitForURL(/\/expenses\/(?!upload$)[^/?#]+$/, { timeout: 150_000 });
      const created = await createdIds();
      expect(created.length, 'exactly one draft').toBe(1);
      expect(page.url()).toContain(created[0]!);
      const row = await expense(api, companyId, created[0]!);
      expect(row.captureSource).toBe('WEB_UPLOAD');
      expect(row.primaryAttachmentId).toBeTruthy();
      await expectNoClientError(page);
      // No withdrawn surface anywhere on the screen the shop lands on.
      await expect(page.getByText('กลุ่มหลักฐาน')).toHaveCount(0);
    });

    test(`@p1 three files are three ordinary drafts, landing on the list at ${width}px`, async ({ authedPage: page, api, companyId }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width, height: 900 });
      const createdIds = watchCreatedDrafts(page);
      await openUploadPanel(page, api, companyId);

      const tag = randomUUID().slice(0, 8);
      // One picker, several files — exactly what the owner asked the existing screen to keep doing.
      await page.locator('input[type=file].hidden').first().setInputFiles([
        { name: `w09-a-${tag}.png`, mimeType: 'image/png', buffer: PNG },
        { name: `w09-b-${tag}.png`, mimeType: 'image/png', buffer: PNG },
        { name: `w09-c-${tag}.pdf`, mimeType: 'application/pdf', buffer: PDF },
      ]);
      // The panel shows one row per file, in the same panel — no navigation, no new question.
      const fileRows = page.locator('[data-capture-file-list] li');
      await expect(fileRows).toHaveCount(3);
      await expect(page.getByText('ทำงานเดิมต่อ')).toHaveCount(0);
      await expect(page.getByText('แยกเป็นกลุ่มหลักฐาน')).toHaveCount(0);

      await page.getByRole('button', { name: /ส่งไฟล์ทั้งหมด|ให้ AI อ่านใบเสร็จ/ }).click();

      // The landing: the LIST, with the newest of the three highlighted.
      await page.waitForURL(/\/expenses\?highlight=/, { timeout: 280_000 });
      const created = await createdIds();
      expect(created.length, 'three files, three drafts').toBe(3);
      const rows = await Promise.all(created.map((id) => expense(api, companyId, id)));
      for (const row of rows) {
        expect(row.captureSource).toBe('WEB_UPLOAD');
        expect(row.primaryAttachmentId, 'every draft owns its own file').toBeTruthy();
      }
      expect(new Set(rows.map((row) => row.primaryAttachmentId)).size).toBe(3);
      const highlight = new URL(page.url()).searchParams.get('highlight');
      expect(highlight, 'the newest of the three is highlighted').toBe(created.at(-1));
      // The table row and the card both carry the mark; only the layout for this width is visible.
      await expect(page.locator('[data-highlighted="true"]:visible').first()).toBeVisible();
      await expectNoClientError(page);
      await expect(page.getByText('กลุ่มหลักฐาน')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'งานรับหลักฐาน' })).toHaveCount(0);
    });
  }

  test('@p1 the PDF draft follows its read job, then prints §17.6 with no re-read', async ({ authedPage: page, api, request, companyId }) => {
    test.skip(!WORKER_TOKEN, 'draining the read job needs WORKER_INTERNAL_TOKEN');
    test.setTimeout(240_000);
    const createdIds = watchCreatedDrafts(page);
    await openUploadPanel(page, api, companyId);
    await page.locator('input[type=file].hidden').first().setInputFiles({
      name: `w09-pdf-${randomUUID().slice(0, 8)}.pdf`, mimeType: 'application/pdf', buffer: PDF,
    });
    await page.getByRole('button', { name: 'ให้ AI อ่านใบเสร็จ', exact: true }).click();
    await page.waitForURL(/\/expenses\/(?!upload$)[^/?#]+$/, { timeout: 180_000 });
    const created = await createdIds();
    expect(created.length).toBe(1);
    const expenseId = created[0]!;

    // While the job is queued the page says the file is saved and being read — never that it
    // failed. On a stack with no AI provider the in-process kick finishes the job in milliseconds,
    // so the terminal §17.6 line may already be the first thing the page shows; both are truthful.
    await expect(page.getByText(/เก็บไฟล์แล้ว กำลังอ่านเอกสาร|อ่านแล้ว \d+ จาก \d+ หน้า|อ่านข้อมูลไม่สำเร็จ|อ่านข้อมูลได้บางส่วน|ยังอ่านข้อมูลไม่ครบ/).first()).toBeVisible();

    // `MODEL_PROVIDER=disabled` means the read ends badly, which is the §17.6 case; the drain is
    // what the scan worker would do, and a no-op when the kick already finished the job.
    await drainCaptureReads(request);

    await expect(page.getByText(/อ่านข้อมูลไม่สำเร็จ|อ่านข้อมูลได้บางส่วน|ยังอ่านข้อมูลไม่ครบ/).first())
      .toBeVisible({ timeout: 30_000 });
    // §17.6 forbids a re-read hung off an error.
    await expect(page.getByRole('button', { name: /อ่านเอกสารอีกครั้ง|ลองอ่าน/ })).toHaveCount(0);
    await expect(page.getByText('แยกเป็นกลุ่มหลักฐาน')).toHaveCount(0);
    await expectNoClientError(page);

    // The ordinary form is what carries on from here, and it still saves — through the same
    // CAS-fenced PATCH the review page uses (`expectedUpdatedAt` from the record it is showing).
    const current = await api.get(`companies/${companyId}/expenses/${expenseId}`);
    expect(current.status()).toBe(200);
    const { updatedAt } = await current.json() as { updatedAt: string };
    const saved = await api.patch(`companies/${companyId}/expenses/${expenseId}`, {
      data: { note: 'W09 กรอกมือหลังอ่านไม่สำเร็จ', expectedUpdatedAt: updatedAt },
    });
    expect(saved.status(), await saved.text()).toBeLessThan(300);
  });

  test('@p1 a multi-document read shows what was created, with links that work', async ({ authedPage: page, api, companyId }) => {
    const client = prismaClient();
    let pair: SplitPair | null = null;
    try {
      pair = await seedSplitPair(client, companyId);

      await ensureBrowserLegalAcceptance(page.context(), companyId);
      await gotoCompany(page, companyId, `/expenses/${pair.ownerId}`);
      const notice = page.locator('[data-capture-auto-split]');
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await expect(notice).toContainText('พบเอกสาร 2 ใบในไฟล์นี้');
      await expect(notice).toContainText('สร้างรายการเพิ่มให้แล้ว');
      // No button, no group: the work is done and the notice only says where it went.
      await expect(page.getByText('แยกเป็นกลุ่มหลักฐาน')).toHaveCount(0);
      await expect(page.getByText('จากกลุ่มหลักฐาน')).toHaveCount(0);

      await notice.getByRole('link').first().click();
      await page.waitForURL(new RegExp(`/expenses/${pair.siblingId}$`), { timeout: 30_000 });
      await expectNoClientError(page);
      // The sibling is a confirmable draft: it owns the shared file as its primary receipt.
      const sibling = await expense(api, companyId, pair.siblingId);
      expect(sibling.primaryAttachmentId).toBe(pair.attachmentId);

      // The API's own answer carries the same ids the page rendered.
      const status = await api.get(`companies/${companyId}/expenses/${pair.ownerId}/read-status`);
      expect(status.status()).toBe(200);
      const body = await status.json() as { files: Array<{ multiDocument?: boolean; documentCount?: number; splitExpenseIds?: string[] }> };
      expect(body.files[0]?.multiDocument).toBe(true);
      expect(body.files[0]?.documentCount).toBe(2);
      expect(body.files[0]?.splitExpenseIds).toEqual([pair.siblingId]);
    } finally {
      await cleanupSplitPair(client, companyId, pair);
      await client.$disconnect();
    }
  });

  test('@p1 the withdrawn routes render no capture screen, and the nav has no entry for them', async ({ authedPage: page, companyId }) => {
    await ensureBrowserLegalAcceptance(page.context(), companyId);
    // `/expenses/capture` is now just an expense id that does not exist — the detail page's own
    // not-found state, which is a page, not a stack. The deeper path has no route at all: 404.
    const shallow = await page.goto(`/companies/${companyId}/expenses/capture`);
    expect(shallow?.status()).toBeLessThan(500);
    await expectNoClientError(page);
    await expect(page.getByText('กลุ่มหลักฐาน')).toHaveCount(0);
    await expect(page.getByText('งานรับหลักฐาน')).toHaveCount(0);

    const deep = await page.goto(`/companies/${companyId}/expenses/capture/anything-at-all`);
    expect(deep?.status(), 'the group route is gone').toBe(404);
    await expectNoClientError(page);

    await gotoCompany(page, companyId, '/expenses');
    await expect(page.getByRole('link', { name: 'งานรับหลักฐาน' })).toHaveCount(0);
    expect(await page.locator('a[href*="/expenses/capture"]').count()).toBe(0);
  });
});
