// Promotion screens (starter-249 bonus-month promotion) in a real browser: the customer package page and the Admin campaign console.
//
// What is real: the Next app, the seeded owner session (customer page) and the seeded system admin signing in through the login form (Admin pages, whose /system layout
// checks the session on the server). What is simulated: Billing and the campaign API, with `page.route` (see billing-promotion.fixture.ts; every body is typed with the
// contract types). Every state runs at 390 (the primary device) and 1280 on a fixed clock (12:00 Bangkok on 9 Oct 2026), and leaves a full-page picture, readable
// tiles of it, a first-screen picture where the first screen matters, and an audit record (machine tokens, boxes past the edge, small targets, clipped text) in test-results/.
// The requests the page sent are asserted, and written next to the pictures (test-results/<test>/wire-*.json; PROMO_E2E_RECORDS=<file> also appends them to one file).
//
// `test.fixme` marks a product defect (named FXE-D<n> in the comment above it); it becomes a plain `test` when the defect is fixed.
// Run (local only, like billing-admin-menu-ux.spec.ts): a migrated and seeded database, Redis, then
//   pnpm exec playwright test e2e/billing-promotion.spec.ts --project=chromium
import { appendFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './harness/fixtures';
import { SEED_USERS, ensureBrowserLegalAcceptance, expectNoClientError } from './harness/auth';
import { chooseThemedOption } from './harness/e2e-utils';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { BillingPromotionUse, BillingStatus } from '@watchdog-bms/contracts';
import { ATTEMPT_ID, CAMPAIGN_ID, CAMPAIGN_NAME, FIXED_NOW, READ_ONLY, STARTER_RULES, addCampaign, addMonths, apiError, apiMessage, completeDraft, defaultCustomerWorld, deferredShopStatus, failNext, forbidden, heldTicket,
  heldTicketView, inDays, inMs, installAdminRoutes, installCustomerRoutes, invoiceItem, newAdminWorld, newShopStatus, openOperation, openPaymentStatus, paidShopStatus, promotionRows, promotionUnavailableAnswer,
  promotionUse, publishedCampaign, qrShopStatus, reportCompany, reportPage, thaiDateTime, thaiDay, trialShopStatus, type AdminWorld, type CustomerWorld } from './billing-promotion.fixture';

// Every state below runs at the phone (390, the primary device) and at the desktop (1280), on a fixed clock (12:00 Bangkok on 9 Oct 2026).
test.use({ timezoneId: 'Asia/Bangkok' });
const WIDTHS = [390, 1280] as const;
const money = (satang: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(satang / 100);

/* ---------------------------------------------------------------- invariants every state carries ---------------------------------------------------------------- */

const HIDE_DEV_BADGE = 'nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }';

async function fits(page: Page, width: number) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  // name the culprits in the failure: the widest boxes that reach past the edge
  const culprits = scrollWidth <= width ? [] : await page.evaluate(edge => Array.from(document.querySelectorAll('main *, [role="main"] *')).filter(el => el.getBoundingClientRect().right > edge + 1 && !el.closest('.sr-only'))
    .slice(0, 6).map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')} right=${Math.round(el.getBoundingClientRect().right)} «${(el.textContent ?? '').trim().slice(0, 30)}»`), width);
  expect(scrollWidth, `page-level horizontal overflow; reaching past the edge: ${culprits.join(' | ')}`).toBeLessThanOrEqual(width);
}
/** Open a page on the fixed clock at one width. */
async function openAt(page: Page, width: number, url: string) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await page.goto(url);
}

type Audit = { machineTokens: string[]; offscreen: string[]; tinyTargets: string[]; clippedText: string[]; smallText: string[] };
/** What a careful reviewer's eye catches that an assertion on one sentence does not: machine tokens, boxes past the edge, targets too small to tap, clipped text. */
async function audit(page: Page, width: number): Promise<Audit> {
  return page.evaluate(viewport => {
    const root = document.querySelector('main, [role="main"], #workspace-main') ?? document.body;
    const shown = (el: Element) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden], [aria-hidden="true"]'); };
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} «${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48)}»`;
    const out: Audit = { machineTokens: [], offscreen: [], tinyTargets: [], clippedText: [], smallText: [] };
    const text = (root as HTMLElement).innerText ?? '';
    for (const pattern of [/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, /\b(?:undefined|NaN|null)\b|\[object|\{\{/g])
      for (const hit of text.match(pattern) ?? []) out.machineTokens.push(hit);
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el), own = Array.from(el.childNodes).some(node => node.nodeType === 3 && (node.textContent ?? '').trim());
      if (cs.position !== 'fixed' && (r.right > viewport + 1 || r.left < -1) && !el.closest('.sr-only')) out.offscreen.push(name(el));
      if (el.matches('button, a[href], summary, [role="button"], [role="combobox"], select, input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]), label') && !el.closest('.sr-only')) {
        const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
        if (r.height < 40 && !inline) out.tinyTargets.push(`${Math.round(r.width)}x${Math.round(r.height)} ${name(el)}`);
      }
      if (own && ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) out.clippedText.push(name(el));
      if (own && parseFloat(cs.fontSize) < 12) out.smallText.push(`${cs.fontSize} ${name(el)}`);
    }
    return out;
  }, width);
}

/** Pictures: the whole page, plus readable tiles of it (a 3000px phone page is unreadable in one image). */
async function pictures(page: Page, info: TestInfo, width: number, name: string) {
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  // A sticky header is drawn where the page was scrolled to; from the top it sits where a person sees it first.
  await page.evaluate(() => { window.scrollTo(0, 0); for (const el of Array.from(document.querySelectorAll('*'))) if (el.scrollTop) el.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true });
  const height = await page.evaluate(() => document.documentElement.scrollHeight), tile = width < 600 ? 1100 : 1000;
  for (let y = 0, i = 0; y < height && i < 8; y += tile, i++)
    await page.screenshot({ path: info.outputPath(`${name}-${width}-t${i}.png`), fullPage: true, clip: { x: 0, y, width, height: Math.min(tile, height - y) } });
}
/** What the buyer sees first, without scrolling (the promotion hidden below the fold on a phone is a finding). */
async function firstScreen(page: Page, info: TestInfo, width: number, name: string) {
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.screenshot({ path: info.outputPath(`${name}-${width}-viewport.png`) });
}
async function settle(page: Page, info: TestInfo, width: number, name: string) {
  await expectNoClientError(page);
  await fits(page, width);
  const found = await audit(page, width);
  expect(found.machineTokens, 'enum keys, ids, ISO timestamps or JS values on screen').toEqual([]);
  record(info, 'audit', name, width, found);
  await pictures(page, info, width, name);
}
/** One JSON file per record next to the pictures, and, with PROMO_E2E_RECORDS=<file>, one line per record in a shared log (the list reporter prints neither stdout nor attachments). */
function record(info: TestInfo, kind: 'audit' | 'wire', name: string, width: number, data: unknown) {
  writeFileSync(info.outputPath(`${kind}-${name}-${width}.json`), JSON.stringify(data, null, 2));
  if (process.env['PROMO_E2E_RECORDS']) appendFileSync(process.env['PROMO_E2E_RECORDS'], `${JSON.stringify({ kind, name, width, data })}\n`);
}
/** The requests the page sent. */
function wire(info: TestInfo, name: string, width: number, data: unknown) { record(info, 'wire', name, width, data); }

/* ---------------------------------------------------------------- customer page helpers ---------------------------------------------------------------- */

const regionNamed = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const reviewOf = (page: Page) => regionNamed(page, 'ยืนยันซื้อแพ็กเกจ');
const promoReviewOf = (page: Page) => regionNamed(page, 'โปรโมชั่นที่ใช้ในรายการนี้');
const cardOf = (page: Page, title: string) => regionNamed(page, 'เลือกแพ็กเกจ').locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const starterOf = (page: Page) => cardOf(page, 'เริ่มต้น (STARTER)');
const buyStarter = (page: Page) => starterOf(page).getByRole('button', { name: /^(เลือกแพ็กเกจนี้|ซื้อแพ็กเกจเดิมเพิ่ม)$/ });
/** The Thai sentence the page says for a promotion that cannot be taken (billing-promotion.ts REASON_TEXT). */
const REASON: Record<string, string> = {
  ALREADY_USED: 'ร้านนี้ใช้สิทธิ์โปรโมชั่นนี้แล้ว', CAP_FULL: 'สิทธิ์โปรโมชั่นครบจำนวนแล้ว', IN_PROGRESS: 'มีรายการชำระที่ใช้สิทธิ์นี้ค้างอยู่ เปิดรายการเดิมเพื่อชำระต่อ',
  PAUSED: 'โปรโมชั่นนี้หยุดรับสิทธิ์ชั่วคราว', PURCHASE_KIND_UNSUPPORTED: 'โปรโมชั่นนี้ยังใช้กับการซื้อแบบนี้ไม่ได้', CHANGED: 'เงื่อนไขโปรโมชั่นเปลี่ยนแล้ว',
};

/** The note under the three-way choice (billing-promotion.ts PROMOTION_ONE_PER_PURCHASE). UAT 2026-10-10: it no longer says "สิ่งที่ไม่ได้เลือกจะไม่ถูกใช้", which was false for a package with no promotion. */
const CHOICE_NOTE = 'ใช้ได้ครั้งละ 1 อย่างต่อการซื้อ โปรโมชั่นใช้ได้เฉพาะแพ็กเกจที่แสดงโปรโมชั่น แพ็กเกจอื่นซื้อตามที่แสดงไว้ที่แพ็กเกจนั้น';

/** The right a shop holds while its Checkout is open (`status.promotion`): reserved, nothing used yet. */
const RESERVED_USE = promotionUse({ state: 'RESERVED', paidEnd: null, benefitEnd: null, renewalSetupState: 'PENDING', expectedNextChargeAt: null });

/** Open the package page and the chooser behind "เลือกแพ็กเกจ" / "ซื้อหรือเปลี่ยนแพ็กเกจ". */
async function openChooser(page: Page, w: CustomerWorld, width: number, info?: TestInfo, shot?: string) {
  await installCustomerRoutes(page, w);
  await openAt(page, width, `/companies/${w.companyId}/billing`);
  await page.getByRole('button', { name: /^(เลือกแพ็กเกจ|ซื้อหรือเปลี่ยนแพ็กเกจ)$/ }).click();
  await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toBeVisible();
  if (info && shot) await firstScreen(page, info, width, shot);
}
async function openOverview(page: Page, w: CustomerWorld, width: number, path = '/billing') {
  await installCustomerRoutes(page, w);
  await openAt(page, width, `/companies/${w.companyId}${path}`);
}
const confirmCheckout = async (page: Page, accept = true) => {
  if (accept) await reviewOf(page).getByRole('checkbox').check();
  await reviewOf(page).getByRole('button', { name: 'ยืนยันและไปหน้าชำระเงิน', exact: true }).click();
};

/* ================================================================ 1. the card, the chooser ================================================================ */

for (const width of WIDTHS) {
  test(`PROMO-01 an available promotion shows on Starter month and year only, with the benefit chooser at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    await openChooser(page, w, width, info, 'promo01-first-screen');
    const promo = starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' });
    await expect(promo).toBeVisible();
    await expect(promo).toContainText(CAMPAIGN_NAME);
    await expect(promo).toContainText('249 บาท ได้ 2 เดือน');
    await expect(promo).toContainText('ชำระ 1 เดือน แถมฟรี 1 เดือน');
    await expect(promo).toContainText('ใบเสร็จ 60 ใบ (รวมแถม 30 ใบ) ได้ทันทีเมื่อชำระสำเร็จ');
    await expect(promo).toContainText('ใช้ได้ครั้งเดียวต่อร้าน');
    await expect(promo).toContainText('โปรโมชั่นสิ้นสุด 31 ตุลาคม 2569 เวลา 23:59 น.');
    await expect(regionNamed(page, 'เลือกแพ็กเกจ').getByRole('region', { name: /^โปรโมชั่น / })).toHaveCount(1);
    const choice = regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้');
    await expect(choice.getByRole('radio', { name: /ใช้โปรโมชั่น/ })).toBeChecked();
    await expect(choice).toContainText(`ใช้โปรโมชั่น ${CAMPAIGN_NAME}`);
    await expect(choice).toContainText('ซื้อแบบปกติ');
    await expect(choice).toContainText(CHOICE_NOTE);
    await expect(choice).not.toContainText('สิ่งที่ไม่ได้เลือกจะไม่ถูกใช้');
    await settle(page, info, width, 'promo01-month');

    await page.getByRole('button', { name: 'รายปี', exact: true }).click();
    const yearly = starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' });
    await expect(yearly).toContainText('2,490 บาท ได้ 13 เดือน');
    await expect(yearly).toContainText('ชำระ 12 เดือน แถมฟรี 1 เดือน');
    await expect(yearly).toContainText('ใบเสร็จ 390 ใบ (รวมแถม 30 ใบ) ได้ทันทีเมื่อชำระสำเร็จ');
    await expect(regionNamed(page, 'เลือกแพ็กเกจ').getByRole('region', { name: /^โปรโมชั่น / })).toHaveCount(1);
    await expect(choice.getByRole('radio', { name: /ใช้โปรโมชั่น/ })).toBeChecked();
    await settle(page, info, width, 'promo01-year');
    expect(w.log.quotes).toEqual([]);
  });
}

/** The longest name an Admin may give a campaign (80 characters, here without a single space) must not push a phone page sideways. */
const LONG_NAME = 'Starter'.padEnd(80, 'x');
for (const width of WIDTHS) {
  test(`PROMO-01 the longest customer-facing campaign name (80 characters, no spaces) stays inside the card, the chooser and the review at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { promotions: promotionRows(null, { displayName: LONG_NAME }) }));
    await openChooser(page, w, width);
    await expect(starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toContainText(LONG_NAME);
    await settle(page, info, width, 'promo01-long-name-chooser');
    await buyStarter(page).click();
    await expect(promoReviewOf(page)).toContainText(`โปรโมชั่น ${LONG_NAME}`);
    await settle(page, info, width, 'promo01-long-name-review');
  });
}

// FXE-D14 (open): the test above passes because `<main>` clips (overflow-x: clip), so the page never scrolls sideways. At 390px the same name still stretches the choice box's content to 658px and the plan
// cards' content to 580px: the name, the note under the choice and the cards' right edge are cut off at the screen edge. The review is fine. It becomes a plain `test` when the chooser wraps the name.
for (const width of WIDTHS) (width < 600 ? test.fixme : test)(`PROMO-01 the longest customer-facing campaign name leaves no box of the chooser past the screen edge, not only no page scroll at ${width}px`, async ({ authedPage: page, companyId }) => {
  const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { promotions: promotionRows(null, { displayName: LONG_NAME }) }));
  await openChooser(page, w, width);
  expect((await audit(page, width)).offscreen, 'boxes reaching past the screen edge').toEqual([]);
});

/* ================================================================ 2. choosing the promotion: the review and the checkout ================================================================ */

for (const width of WIDTHS) for (const interval of ['month', 'year'] as const) {
  test(`PROMO-02 choosing the promotion (${interval}) quotes it, reviews the paid and free time and checks out with the quote id only at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId), months = interval === 'year' ? 12 : 1, price = interval === 'year' ? 249_000 : 24_900;
    const paidEnd = addMonths(FIXED_NOW, months), benefitEnd = addMonths(FIXED_NOW, months + 1), total = interval === 'year' ? 390 : 60, base = total - 30;
    await openChooser(page, w, width);
    if (interval === 'year') await page.getByRole('button', { name: 'รายปี', exact: true }).click();
    await buyStarter(page).click();
    const review = reviewOf(page), promo = promoReviewOf(page);
    await expect(promo).toBeVisible();
    await firstScreen(page, info, width, `promo02-${interval}-first-screen`);
    // the wire: the one benefit, the campaign it names, and the held discount explicitly declined
    expect(w.log.quotes).toEqual([{ offerKey: 'STARTER_249', interval, purchaseMode: 'CARD_AUTO', benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN_ID, eventDiscountChoice: 'DECLINE' }]);
    wire(info, `quote-promotion-${interval}`, width, w.log.quotes[0]);
    await expect(page.getByRole('heading', { name: `ยืนยันซื้อ เริ่มต้น (STARTER) ${interval === 'year' ? 'รายปี' : 'รายเดือน'}`, exact: true })).toBeVisible();
    const row = (label: string) => promo.locator('dl > div').filter({ has: page.locator('dt', { hasText: label }) }).locator('dd');
    await expect(promo).toContainText(`โปรโมชั่น ${CAMPAIGN_NAME}`);
    await expect(row('ช่วงที่ชำระ')).toHaveText(`${thaiDay(FIXED_NOW)} – ${thaiDay(paidEnd)}`);
    await expect(row('ช่วงแถมฟรี')).toHaveText(`${thaiDay(paidEnd)} – ${thaiDay(benefitEnd)}`);
    await expect(row('ใช้ได้ถึง')).toHaveText(thaiDay(benefitEnd));
    await expect(row('ใบเสร็จ')).toHaveText(`${base} + แถม 30 = ${total} ใบ`);
    await expect(promo.getByText(/^รอบถัดไปเรียกเก็บวันที่/)).toHaveText(`รอบถัดไปเรียกเก็บวันที่ ${thaiDay(benefitEnd)} ราคาปกติ ${money(price)} (ตัดบัตรอัตโนมัติ)`);
    await expect(promo).toContainText('วันที่ทั้งหมดเป็นการประมาณ ระบบจะยืนยันวันจริงเมื่อชำระสำเร็จ');
    await expect(review).toContainText(`ชำระวันนี้ ${money(price)}`);
    await expect(review).toContainText(`รับโควตา ${total} ใบ`);
    // one length of time on the page: the normal "1 เดือน / 12 เดือน" sentence is not there beside the promotion
    await expect(review).not.toContainText(/ใช้งานได้ (1|12) เดือน/);
    await settle(page, info, width, `promo02-${interval}-review`);

    await confirmCheckout(page);
    await page.waitForURL(/checkout\.stripe\.com/);
    // the checkout names the quote and the consent, nothing about the benefit
    expect(w.log.checkouts).toHaveLength(1);
    expect(w.log.checkouts[0]!.body).toEqual({ quoteId: 'quote-1', consentRevision: 'billing-v2', accepted: true, channel: 'web' });
    expect(w.log.checkouts[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
    wire(info, `checkout-promotion-${interval}`, width, w.log.checkouts[0]);
  });
}

for (const width of WIDTHS) {
  test(`PROMO-02 the review follows the payment mode: next charge for a card, a QR bill for PromptPay renewal, none for one-time at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId), benefitEnd = addMonths(FIXED_NOW, 2), nextLine = () => promoReviewOf(page).getByText(/^รอบถัดไปเรียกเก็บวันที่/);
    await openChooser(page, w, width);
    await buyStarter(page).click();
    await expect(nextLine()).toHaveText(`รอบถัดไปเรียกเก็บวันที่ ${thaiDay(benefitEnd)} ราคาปกติ ${money(24_900)} (ตัดบัตรอัตโนมัติ)`);
    await page.getByRole('button', { name: 'กลับไปเลือกแพ็กเกจ', exact: true }).click();
    await page.getByRole('button', { name: 'วิธีชำระอื่น' }).click();
    await page.getByRole('radio', { name: 'พร้อมเพย์ QR · สแกนบิลทุกงวด' }).check();
    await buyStarter(page).click();
    await expect(nextLine()).toHaveText(`รอบถัดไปเรียกเก็บวันที่ ${thaiDay(benefitEnd)} ราคาปกติ ${money(24_900)} (ออกบิล QR ให้สแกน)`);
    await settle(page, info, width, 'promo02-promptpay-renew-review');
    await page.getByRole('button', { name: 'กลับไปเลือกแพ็กเกจ', exact: true }).click();
    await page.getByRole('radio', { name: 'พร้อมเพย์ QR · จ่ายครั้งเดียว' }).check();
    await buyStarter(page).click();
    await expect(promoReviewOf(page)).toBeVisible();
    await expect(nextLine()).toHaveCount(0);
    await expect(reviewOf(page)).toContainText('จ่ายครั้งเดียว ไม่มีการตัดเงินงวดถัดไป');
    await expect(promoReviewOf(page).getByText('ช่วงแถมฟรี')).toBeVisible();
    await settle(page, info, width, 'promo02-promptpay-once-review');
    expect(w.log.quotes.map(quote => quote.purchaseMode)).toEqual(['CARD_AUTO', 'PROMPTPAY_RENEW', 'PROMPTPAY_ONCE']);
    for (const quote of w.log.quotes) expect(quote).toMatchObject({ benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN_ID, eventDiscountChoice: 'DECLINE' });
    wire(info, 'quotes-by-mode', width, w.log.quotes);
  });
}

for (const width of WIDTHS) {
  // FXE-D4 (fixed in round 2): a card that takes the promotion says its months and receipts once, in the promotion block; the plain lines (30 / 360 receipts, "ใช้งาน 12 เดือน · ประหยัด",
  // "เฉลี่ยเดือนละ") are for a normal purchase and come back when the buyer picks it. Another package keeps them whatever the buyer picked.
  test(`PROMO-01 a card that takes the promotion states months and receipts once; the plain lines return when the buyer picks normal at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    await openChooser(page, w, width);
    const starter = starterOf(page), promo = starter.getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' });
    await expect(promo).toContainText('ใบเสร็จ 60 ใบ (รวมแถม 30 ใบ) ได้ทันทีเมื่อชำระสำเร็จ');
    await expect(starter).not.toContainText('30 ใบ ได้ทันทีเมื่อชำระสำเร็จ');
    await expect(starter).toContainText('ชำระรายเดือน');
    await expect(starter).toContainText('1 สาขา · 2 ผู้ใช้');
    await expect(cardOf(page, 'เติบโต (BASIC)')).toContainText('50 ใบ ได้ทันทีเมื่อชำระสำเร็จ');
    await settle(page, info, width, 'promo01r2-month-promoted');
    await page.getByRole('button', { name: 'รายปี', exact: true }).click();
    await expect(promo).toContainText('2,490 บาท ได้ 13 เดือน');
    await expect(promo).toContainText('ใบเสร็จ 390 ใบ (รวมแถม 30 ใบ) ได้ทันทีเมื่อชำระสำเร็จ');
    for (const plain of ['360 ใบ ได้ทันทีเมื่อชำระสำเร็จ', 'ใช้งาน 12 เดือน', 'ประหยัด', 'เฉลี่ยเดือนละ']) await expect(starter, plain).not.toContainText(plain);
    const basic = cardOf(page, 'เติบโต (BASIC)');
    await expect(basic).toContainText('600 ใบ ได้ทันทีเมื่อชำระสำเร็จ');
    await expect(basic).toContainText(`ใช้งาน 12 เดือน · ประหยัด ${money(99_800)}`);
    await expect(basic).toContainText(`เฉลี่ยเดือนละ ${money(41_583)}`);
    await settle(page, info, width, 'promo01r2-year-promoted');
    await regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้').getByRole('radio', { name: 'ซื้อแบบปกติ' }).check();
    await expect(starter).toContainText('360 ใบ ได้ทันทีเมื่อชำระสำเร็จ');
    await expect(starter).toContainText(`ใช้งาน 12 เดือน · ประหยัด ${money(49_800)}`);
    await expect(starter).toContainText(`เฉลี่ยเดือนละ ${money(20_750)}`);
    await expect(promo).toContainText('ครั้งนี้ไม่ได้เลือกใช้โปรโมชั่นนี้');
    await settle(page, info, width, 'promo01r2-year-normal');
  });

  // FXE-D6 (fixed in round 3, by order only): a review with a promotion reads the rights sentence, the tax line, "ชำระวันนี้", the VAT sentence, THEN the promotion block, then the held discount that
  // is not used, then "ข้อมูลออกเอกสาร"; a plain review keeps its order. At 390x844 the price and the promotion block are in the first screen.
  test(`PROMO-02 the review's first screen already shows what the promotion gives (the promotion block is in view without scrolling) at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    await openChooser(page, w, width);
    await buyStarter(page).click();
    await expect(promoReviewOf(page)).toBeVisible();
    await page.waitForTimeout(600);
    await expect(promoReviewOf(page)).toBeInViewport({ ratio: 0.5 });
    // the order down the page: the price, then the promotion, then the document box
    const top = (locator: Locator) => locator.evaluate(el => Math.round(el.getBoundingClientRect().top + window.scrollY));
    const price = await top(reviewOf(page).getByText(/^ชำระวันนี้/).first()), promo = await top(promoReviewOf(page)), documents = await top(reviewOf(page).getByLabel('ข้อมูลออกเอกสาร', { exact: true }));
    expect(price, 'the price comes before the promotion block').toBeLessThan(promo);
    expect(promo, 'the promotion block comes before the document box').toBeLessThan(documents);
    await firstScreen(page, info, width, 'promo02r3-promo-review-first-screen');
    wire(info, 'promo-review-first-screen', width, await promoReviewOf(page).evaluate(el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: window.innerHeight }; }));
  });

  // FXE-D7 (fixed in round 2): the history row of a promotion purchase carries one more line — the free time and the bonus receipts — while the invoice's own number, amount and date stay.
  test(`PROMO-08 the payment history row of a promotion purchase says the free time and the bonus receipts at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, paidShopStatus(companyId, { promotion: promotionUse() }));
    const paidEnd = addMonths(FIXED_NOW, 1);
    w.history = [invoiceItem({ promotion: { displayName: CAMPAIGN_NAME, paidEnd, benefitEnd, bonusReceiptUnits: 30 } }), invoiceItem({ id: 'plain-invoice', number: 'PLAIN-0001', createdAt: addMonths(FIXED_NOW, -2) })];
    await openOverview(page, w, width);
    await page.getByRole('button', { name: 'ประวัติ', exact: true }).click();
    const rows = regionNamed(page, 'ประวัติการชำระเงิน').locator('article');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('p')).toHaveText([`PROMO-0001 · ${money(24_900)} · ${thaiDay(FIXED_NOW)}`, `โปรโมชั่น ${CAMPAIGN_NAME} · แถมฟรี ${thaiDay(paidEnd)} – ${thaiDay(benefitEnd)} · ใบเสร็จเพิ่ม 30 ใบ`]);
    // an invoice with no promotion reads as before
    await expect(rows.nth(1).locator('p')).toHaveText([`PLAIN-0001 · ${money(24_900)} · ${thaiDay(addMonths(FIXED_NOW, -2))}`]);
    await expect(rows.nth(0).getByRole('link', { name: 'ดูเอกสาร', exact: true })).toBeVisible();
    await settle(page, info, width, 'promo08r2-history');
  });
}

/* ================================================================ 3. "ซื้อแบบปกติ" on a promoted card ================================================================ */

for (const width of WIDTHS) {
  test(`PROMO-03 choosing the normal purchase on a promoted card quotes NORMAL, with no promotion rows in the review at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    await openChooser(page, w, width);
    await regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้').getByRole('radio', { name: 'ซื้อแบบปกติ' }).check();
    // the card still advertises the promotion, and says plainly that this purchase does not use it
    const promo = starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' });
    await expect(promo).toContainText('ครั้งนี้ไม่ได้เลือกใช้โปรโมชั่นนี้');
    await settle(page, info, width, 'promo03-chooser-normal');
    await buyStarter(page).click();
    await expect(reviewOf(page)).toBeVisible();
    expect(w.log.quotes).toEqual([{ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO', benefitChoice: 'NORMAL' }]);
    wire(info, 'quote-normal-on-promoted-card', width, w.log.quotes[0]);
    await expect(promoReviewOf(page)).toHaveCount(0);
    await expect(reviewOf(page)).toContainText(`ชำระวันนี้ ${money(24_900)}`);
    await expect(reviewOf(page)).toContainText('รับโควตา 30 ใบ');
    await expect(reviewOf(page)).not.toContainText(/โปรโมชั่น|แถม|60 ใบ/);
    await settle(page, info, width, 'promo03-review-normal');
    await confirmCheckout(page);
    await page.waitForURL(/checkout\.stripe\.com/);
    expect(w.log.checkouts[0]!.body).toEqual({ quoteId: 'quote-1', consentRevision: 'billing-v2', accepted: true, channel: 'web' });
  });

  test(`PROMO-03 a shop still on a legacy trial reads the length of the new package: 1 month normally, 2 months with the promotion at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, trialShopStatus(companyId, { promotions: promotionRows() }));
    w.source = 'TRIAL';
    await openChooser(page, w, width);
    await regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้').getByRole('radio', { name: 'ซื้อแบบปกติ' }).check();
    await buyStarter(page).click();
    await expect(reviewOf(page)).toContainText('ชำระสำเร็จแล้ว ใช้งานได้ 1 เดือน พร้อมโควตา 30 ใบ');
    await expect(promoReviewOf(page)).toHaveCount(0);
    await settle(page, info, width, 'promo03-trial-normal-review');
    await page.getByRole('button', { name: 'กลับไปเลือกแพ็กเกจ', exact: true }).click();
    await regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้').getByRole('radio', { name: /ใช้โปรโมชั่น/ }).check();
    await buyStarter(page).click();
    await expect(reviewOf(page)).toContainText('ชำระสำเร็จแล้ว ใช้งานได้ 2 เดือน (ชำระ 1 เดือน แถมฟรี 1 เดือน)');
    await expect(reviewOf(page)).not.toContainText('ใช้งานได้ 1 เดือน');
    await settle(page, info, width, 'promo03-trial-promotion-review');
  });
}

for (const width of WIDTHS) {
  test(`PROMO-03 the promotion radio is on but the buyer taps another package: a normal quote for that package, no promotion in its review at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    await openChooser(page, w, width);
    await expect(regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้').getByRole('radio', { name: /ใช้โปรโมชั่น/ })).toBeChecked();
    await cardOf(page, 'เติบโต (BASIC)').getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ยืนยันซื้อ เติบโต (BASIC) รายเดือน', exact: true })).toBeVisible();
    // a card with no promotion and no ticket is asked for exactly as before: a normal purchase, no benefit field
    expect(w.log.quotes).toEqual([{ offerKey: 'BASIC_499', interval: 'month', purchaseMode: 'CARD_AUTO' }]);
    wire(info, 'quote-other-package-with-promotion-radio-on', width, w.log.quotes[0]);
    await expect(promoReviewOf(page)).toHaveCount(0);
    await expect(reviewOf(page)).toContainText(`ชำระวันนี้ ${money(49_900)}`);
    await expect(reviewOf(page)).not.toContainText(/โปรโมชั่น|แถม/);
    await settle(page, info, width, 'promo03-other-package-review');
  });
}

/* ================================================================ 4. a promotion that cannot be taken ================================================================ */

for (const reason of ['ALREADY_USED', 'CAP_FULL', 'IN_PROGRESS', 'PAUSED', 'PURCHASE_KIND_UNSUPPORTED'] as const) for (const width of WIDTHS) {
  test(`PROMO-04 ${reason}: the card says why in plain Thai and the normal buy button still works at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    // The API computes the rows only where the shop can buy, and a Checkout of its own removes `new_sales` (billing.service.ts status()), so a row that says IN_PROGRESS is the moment after
    // a payment ended and before its right is released. The card says why and the normal purchase stays open. A status that still names the open payment is section 9's.
    const w = reason === 'PURCHASE_KIND_UNSUPPORTED'
      ? defaultCustomerWorld(companyId, paidShopStatus(companyId, { promotions: promotionRows(reason), availablePurchaseModes: ['CARD_AUTO'] }))
      : defaultCustomerWorld(companyId, newShopStatus(companyId, { promotions: promotionRows(reason) }));
    if (reason === 'PURCHASE_KIND_UNSUPPORTED') w.purchase = 'REPEAT';
    await openChooser(page, w, width);
    await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toBeVisible();
    const starter = starterOf(page);
    await expect(starter.getByRole('note').filter({ hasText: REASON[reason] })).toBeVisible();
    // an unavailable promotion is not advertised as if it were open, and no benefit is offered to choose
    await expect(starter.getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toHaveCount(0);
    await expect(starter).not.toContainText('ได้ 2 เดือน');
    await expect(regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้')).toHaveCount(0);
    await settle(page, info, width, `promo04-${reason.toLowerCase()}-chooser`);
    await page.getByRole('button', { name: 'รายปี', exact: true }).click();
    await expect(starterOf(page).getByRole('note').filter({ hasText: REASON[reason] })).toBeVisible();
    await page.getByRole('button', { name: 'รายเดือน', exact: true }).click();
    // the normal purchase is never closed by the promotion: the request carries no benefit field and the review is the plain one
    await expect(buyStarter(page)).toBeEnabled();
    await buyStarter(page).click();
    await expect(reviewOf(page)).toBeVisible();
    expect(w.log.quotes).toEqual([{ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO' }]);
    wire(info, `quote-with-${reason.toLowerCase()}-row`, width, w.log.quotes[0]);
    await expect(promoReviewOf(page)).toHaveCount(0);
    await expect(reviewOf(page)).not.toContainText(/โปรโมชั่น|แถมฟรี/);
    await settle(page, info, width, `promo04-${reason.toLowerCase()}-review`);
  });
}

/** A one-time Starter that is still running: the only paid shop that may take the promotion (a repeat on the same offer, paid once). */
const repeatWorld = (companyId: string) => {
  const previous = '2026-10-25T05:00:00.000Z';
  // A one-time package has no subscription to manage (`allowedActions` is just `new_sales`), and a paid shop's finished attempt is no longer the account's active one.
  const w = defaultCustomerWorld(companyId, paidShopStatus(companyId, { renewalMode: 'CARD_ONCE', subscriptionState: 'NONE', nextChargeAt: null, paidThrough: previous, termEndsAt: previous, allowedActions: ['new_sales'],
    availablePurchaseModes: ['CARD_ONCE', 'PROMPTPAY_ONCE'], enabledPurchaseModes: ['CARD_ONCE', 'PROMPTPAY_ONCE'], usage: { used: 10, limit: 30, remaining: 20, cadence: 'PAID_GRANTS', resetsAt: null, expiresAt: previous },
    promotions: [...promotionRows().slice(0, 1), ...promotionRows('PURCHASE_KIND_UNSUPPORTED').slice(1)] }));
  w.purchase = 'REPEAT';
  return { w, previous };
};

for (const width of WIDTHS) {
  test(`PROMO-02 a one-time Starter that is still running buys the same package again with the promotion: the new end date follows the old one at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const { w, previous } = repeatWorld(companyId), benefitEnd = addMonths(previous, 2);
    await openChooser(page, w, width);
    await expect(starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toContainText('249 บาท ได้ 2 เดือน');
    await buyStarter(page).click();
    const review = reviewOf(page), promo = promoReviewOf(page);
    await expect(promo).toBeVisible();
    expect(w.log.quotes).toEqual([{ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_ONCE', benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN_ID, eventDiscountChoice: 'DECLINE' }]);
    const row = (label: string) => promo.locator('dl > div').filter({ has: page.locator('dt', { hasText: label }) }).locator('dd');
    await expect(row('ช่วงที่ชำระ')).toHaveText(`${thaiDay(previous)} – ${thaiDay(addMonths(previous, 1))}`);
    await expect(row('ช่วงแถมฟรี')).toHaveText(`${thaiDay(addMonths(previous, 1))} – ${thaiDay(benefitEnd)}`);
    // the three tiles: today's payment, the quota added, the new end — all in the promotion's terms
    await expect(review).toContainText(`ชำระวันนี้${money(24_900)}`);
    await expect(review).toContainText('โควตาที่เพิ่ม60 ใบ');
    await expect(review).toContainText(`วันหมดอายุใหม่${thaiDay(benefitEnd)}ต่อจากเดิม ${thaiDay(previous)}`);
    await expect(promo.getByText(/^รอบถัดไปเรียกเก็บ/)).toHaveCount(0);
    await settle(page, info, width, 'promo02-repeat-review');
  });

  // FXE-D3 (fixed in round 2, in the web): `purchase.projectedRemainingReceipts` counts the base 30 only (the API tells the bonus in `promotion`), so the page adds the bonus: 20 left + 60 bought = 80.
  test(`PROMO-02 a repeat purchase with the promotion: "หลังซื้อคงเหลือประมาณ" counts the bonus receipts too at ${width}px`, async ({ authedPage: page, companyId }) => {
    const { w } = repeatWorld(companyId);
    await openChooser(page, w, width);
    await buyStarter(page).click();
    await expect(promoReviewOf(page)).toBeVisible();
    await expect(reviewOf(page)).toContainText('โควตาที่เพิ่ม60 ใบ');
    await expect(reviewOf(page)).toContainText('หลังซื้อคงเหลือประมาณ 80 ใบ');
    await expect(reviewOf(page)).not.toContainText('หลังซื้อคงเหลือประมาณ 50 ใบ');
  });

  // FXE-D3 (the trial-carry-over rows): the package row names the bonus, and the total adds it: (30 + 30 bonus) + 12 carried over = 72.
  test(`PROMO-03 a legacy trial that hands over receipts: the package row says "รวมแถม 30 ใบ" and the total adds the bonus at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, trialShopStatus(companyId, { promotions: promotionRows() }));
    w.source = 'TRIAL'; w.trialCarryoverUnits = 12;
    await openChooser(page, w, width);
    await buyStarter(page).click();
    const review = reviewOf(page), rows = review.locator('dl').filter({ has: page.locator('dt', { hasText: 'ยกยอดจากทดลองใช้' }) });
    await expect(rows.locator('dt')).toHaveText(['โควตาแพ็กเกจ (รวมแถม 30 ใบ)', 'ยกยอดจากทดลองใช้', 'รวมหลังชำระสำเร็จโดยประมาณ']);
    await expect(rows.locator('dd')).toHaveText(['60 ใบ', '12 ใบ', '72 ใบ']);
    await expect(review).toContainText('ชำระสำเร็จแล้ว ใช้งานได้ 2 เดือน (ชำระ 1 เดือน แถมฟรี 1 เดือน)');
    await settle(page, info, width, 'promo03r2-trial-carryover-review');
    // the same shop buying normally: the package row is the plain 30
    await page.getByRole('button', { name: 'กลับไปเลือกแพ็กเกจ', exact: true }).click();
    await regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้').getByRole('radio', { name: 'ซื้อแบบปกติ' }).check();
    await buyStarter(page).click();
    const plain = reviewOf(page).locator('dl').filter({ has: page.locator('dt', { hasText: 'ยกยอดจากทดลองใช้' }) });
    await expect(plain.locator('dt')).toHaveText(['โควตาแพ็กเกจ', 'ยกยอดจากทดลองใช้', 'รวมหลังชำระสำเร็จโดยประมาณ']);
    await expect(plain.locator('dd')).toHaveText(['30 ใบ', '12 ใบ', '42 ใบ']);
  });
}

for (const width of WIDTHS) {
  // Round 2: the page re-reads its status at the end of each promotion on offer, so a campaign that ends by the clock stops being offered without a click.
  test(`PROMO-04 a campaign that ends by the clock stops being offered on the card without a click at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { promotions: promotionRows(null, { endsAt: inMs(3_000) }) }));
    await openChooser(page, w, width);
    const promo = starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' });
    await expect(promo).toBeVisible();
    await expect(regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้')).toBeVisible();
    const reads = w.log.statusReads;
    // the campaign is over on the server now; nobody clicks anything
    w.status = { ...w.status, promotions: undefined };
    await expect(promo).toHaveCount(0, { timeout: 15_000 });
    await expect(regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้')).toHaveCount(0);
    expect(w.log.statusReads).toBeGreaterThan(reads);
    await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toBeVisible();
    await expect(buyStarter(page)).toBeEnabled();
    await settle(page, info, width, 'promo04r2-campaign-ended-by-clock');
  });
}

/* ================================================================ 5. the promotion is lost between the card and the payment ================================================================ */

for (const width of WIDTHS) {
  test(`PROMO-05 PROMOTION_UNAVAILABLE on the quote: our sentence for the reason, no red banner, re-quote on request, nothing bought at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    w.quoteOverride = n => n === 1 ? promotionUnavailableAnswer('CAP_FULL') : undefined;
    await openChooser(page, w, width);
    // the last place fills while the buyer is reading the card
    w.status = { ...w.status, promotions: promotionRows('CAP_FULL') };
    await buyStarter(page).click();
    const lost = page.getByRole('alert').filter({ hasText: 'โปรโมชั่นที่เลือกไว้ใช้ไม่ได้แล้ว' });
    await expect(lost).toBeVisible();
    await expect(lost).toContainText(REASON.CAP_FULL);
    await expect(lost).toContainText('ถ้าซื้อต่อ จะไม่ได้เวลาและใบเสร็จแถมจากโปรโมชั่น กรุณาตรวจสอบรายการใหม่ก่อนชำระ');
    await expect(lost).not.toContainText(apiMessage('CAP_FULL'));
    await expect(page.locator('[role="alert"].bg-red-50')).toHaveCount(0);
    await expect(reviewOf(page)).toHaveCount(0);
    expect(w.log.quotes).toHaveLength(1);
    expect(w.log.quotes[0]).toMatchObject({ benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN_ID });
    expect(w.log.checkouts).toEqual([]);
    await expect(starterOf(page).getByRole('note').filter({ hasText: REASON.CAP_FULL })).toBeVisible();
    await settle(page, info, width, 'promo05-lost-on-quote');
    await lost.getByRole('button', { name: 'ตรวจสอบรายการใหม่', exact: true }).click();
    // the second quote is a plain one (the row is gone), shown for review, and still nothing was paid
    await expect(reviewOf(page)).toBeVisible();
    await expect(lost).toHaveCount(0);
    expect(w.log.quotes).toHaveLength(2);
    expect(w.log.quotes[1]).toEqual({ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO' });
    wire(info, 'requote-after-loss-on-quote', width, w.log.quotes);
    await expect(promoReviewOf(page)).toHaveCount(0);
    await expect(reviewOf(page)).toContainText(`ชำระวันนี้ ${money(24_900)}`);
    await expect(reviewOf(page)).toContainText('รับโควตา 30 ใบ');
    expect(w.log.checkouts).toEqual([]);
    await settle(page, info, width, 'promo05-requote-review');
  });

  test(`PROMO-05 PROMOTION_UNAVAILABLE at payment (conditions changed): the old quote is dropped and the new one is read again before any payment at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    w.checkoutOverride = n => n === 1 ? promotionUnavailableAnswer('CHANGED') : undefined;
    await openChooser(page, w, width);
    await buyStarter(page).click();
    await expect(promoReviewOf(page)).toBeVisible();
    await confirmCheckout(page);
    const lost = page.getByRole('alert').filter({ hasText: 'โปรโมชั่นที่เลือกไว้ใช้ไม่ได้แล้ว' });
    await expect(lost).toBeVisible();
    await expect(lost).toContainText(REASON.CHANGED);
    await expect(lost).toContainText('กรุณาตรวจสอบรายการใหม่ แล้วอ่านเวลา ใบเสร็จ และราคาอีกครั้งก่อนชำระ');
    await expect(lost).not.toContainText(apiMessage('CHANGED'));
    await expect(page.locator('[role="alert"].bg-red-50')).toHaveCount(0);
    await expect(reviewOf(page)).toHaveCount(0);
    expect(w.log.checkouts).toHaveLength(1);
    await settle(page, info, width, 'promo05-lost-at-payment');
    await lost.getByRole('button', { name: 'ตรวจสอบรายการใหม่', exact: true }).click();
    // the promotion is still on the card, so the new quote asks for it again — a new quote id, unchecked consent, no payment yet
    await expect(promoReviewOf(page)).toBeVisible();
    await expect(lost).toHaveCount(0);
    expect(w.log.quotes).toHaveLength(2);
    expect(w.log.quotes[1]).toMatchObject({ benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN_ID });
    await expect(reviewOf(page).getByRole('checkbox')).not.toBeChecked();
    expect(w.log.checkouts).toHaveLength(1);
    await confirmCheckout(page);
    await page.waitForURL(/checkout\.stripe\.com/);
    expect(w.log.checkouts).toHaveLength(2);
    expect(w.log.checkouts[1]!.body).toMatchObject({ quoteId: 'quote-2' });
    wire(info, 'checkouts-after-changed', width, w.log.checkouts);
  });

  test(`PROMO-05 PROMOTION_UNAVAILABLE because a payment is already open: no re-quote offered, the open payment is the way on at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    w.checkoutOverride = n => n === 1 ? promotionUnavailableAnswer('IN_PROGRESS') : undefined;
    await openChooser(page, w, width);
    await buyStarter(page).click();
    await expect(promoReviewOf(page)).toBeVisible();
    // the other tab already opened a payment holding the right: the next status read shows it. An open Checkout removes `new_sales` and the promotion rows, so there is no chooser, only the payment.
    w.status = openPaymentStatus(newShopStatus(companyId, { promotions: promotionRows() }), { promotion: RESERVED_USE });
    await confirmCheckout(page);
    const lost = page.getByRole('alert').filter({ hasText: 'โปรโมชั่นที่เลือกไว้ใช้ไม่ได้แล้ว' });
    await expect(lost).toBeVisible();
    await expect(lost).toContainText(REASON.IN_PROGRESS);
    await expect(lost).toContainText('เปิดรายการเดิมที่ค้างอยู่ด้านล่างเพื่อชำระต่อ ไม่ต้องเริ่มรายการใหม่');
    await expect(lost.getByRole('button', { name: 'ตรวจสอบรายการใหม่' })).toHaveCount(0);
    await expect(reviewOf(page)).toHaveCount(0);
    await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toHaveCount(0);
    // "below": the open payment and its way on are on the page, in the one titled block (the right is told in it, not in a second box)
    const block = regionNamed(page, 'มีรายการชำระเงินที่ยังไม่เสร็จ');
    await expect(block).toBeVisible();
    await expect(block.getByRole('button', { name: 'ชำระเงินต่อ', exact: true })).toBeVisible();
    await expect(block).toContainText(`จองสิทธิ์โปรโมชั่น ${CAMPAIGN_NAME} ไว้ให้รายการนี้แล้ว สิทธิ์เริ่มใช้เมื่อชำระเงินสำเร็จ`);
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(เลือกแพ็กเกจ|ซื้อหรือเปลี่ยนแพ็กเกจ)$/ })).toHaveCount(0);
    expect(w.log.quotes).toHaveLength(1);
    await settle(page, info, width, 'promo05-lost-in-progress');
  });
}

/** Is the lost-promotion notice where the buyer is looking? Measured, not assumed: scroll position, the notice's box, and whether a person could really see it (hit-tested, so a sticky header over it counts as hidden). */
const inViewNow = (lost: Locator) => lost.evaluate(el => {
  const r = el.getBoundingClientRect(), top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
  const hit = bottom > top ? document.elementFromPoint(r.left + Math.min(r.width / 2, 120), (top + bottom) / 2) : null;
  return { scrollY: Math.round(window.scrollY), top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: window.innerHeight, visibleToBuyer: !!hit && el.contains(hit) };
});

for (const width of WIDTHS) {
  test(`PROMO-05 where the lost-promotion notice lands: the buyer pressed a card button (quote) or the pay button (checkout) at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    w.quoteOverride = n => n === 1 ? promotionUnavailableAnswer('CAP_FULL') : undefined;
    w.checkoutOverride = n => n === 1 ? promotionUnavailableAnswer('CHANGED') : undefined;
    await openChooser(page, w, width);
    const lost = page.getByRole('alert').filter({ hasText: 'โปรโมชั่นที่เลือกไว้ใช้ไม่ได้แล้ว' });
    // (1) the quote is refused: the buyer is down at the card they pressed
    await buyStarter(page).scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => Math.round(window.scrollY));
    await buyStarter(page).click();
    await expect(lost).toBeVisible();
    await page.waitForTimeout(600);
    const onQuote = { pressedAtScrollY: before, ...await inViewNow(lost) };
    await firstScreen(page, info, width, 'promo05-after-quote-refused');
    // (2) the checkout is refused: the buyer is at the bottom of the review
    await lost.getByRole('button', { name: 'ปิดข้อความนี้', exact: true }).click();
    await buyStarter(page).click();
    await expect(promoReviewOf(page)).toBeVisible();
    await reviewOf(page).getByRole('checkbox').check();
    await reviewOf(page).getByRole('button', { name: 'ยืนยันและไปหน้าชำระเงิน', exact: true }).scrollIntoViewIfNeeded();
    const beforePay = await page.evaluate(() => Math.round(window.scrollY));
    await reviewOf(page).getByRole('button', { name: 'ยืนยันและไปหน้าชำระเงิน', exact: true }).click();
    await expect(lost).toBeVisible();
    await page.waitForTimeout(600);
    const onCheckout = { pressedAtScrollY: beforePay, ...await inViewNow(lost) };
    await firstScreen(page, info, width, 'promo05-after-checkout-refused');
    wire(info, 'lost-notice-position', width, { onQuote, onCheckout });
  });

  // FXE-D2 (fixed in round 3): the notice takes a ref, focus and a `scrollIntoView` under the sticky header, declared after the chooser-heading scroll so it has the last word. After a refused
  // quote the buyer was ~1000px below it; after a refused checkout the heading scroll left it under the header. Now a person sees it whichever button was refused.
  for (const refused of ['quote', 'checkout'] as const) test(`PROMO-05 the lost-promotion notice is on screen after the ${refused} is refused (a person can see it) at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId);
    if (refused === 'quote') w.quoteOverride = n => n === 1 ? promotionUnavailableAnswer('CAP_FULL') : undefined; else w.checkoutOverride = n => n === 1 ? promotionUnavailableAnswer('CHANGED') : undefined;
    await openChooser(page, w, width);
    await buyStarter(page).click();
    if (refused === 'checkout') await confirmCheckout(page);
    const lost = page.getByRole('alert').filter({ hasText: 'โปรโมชั่นที่เลือกไว้ใช้ไม่ได้แล้ว' });
    await expect(lost).toBeVisible();
    await page.waitForTimeout(600);
    const seen = await inViewNow(lost);
    expect(seen.visibleToBuyer, JSON.stringify(seen)).toBe(true);
    // not hidden under the sticky header, and it holds the keyboard focus, so it is announced
    expect(seen.top, JSON.stringify(seen)).toBeGreaterThanOrEqual(0);
    await expect(lost).toBeFocused();
    wire(info, `lost-notice-on-screen-after-${refused}`, width, seen);
    await firstScreen(page, info, width, `promo05r3-lost-notice-on-screen-after-${refused}`);
  });
}

/* ================================================================ 6 and 7. shops without a promotion: the page as before ================================================================ */

/** A shop that holds a promotion AND a sales-event ticket: one benefit per purchase (Q4), chosen on the page and switchable on the review. */
for (const width of WIDTHS) {
  test(`PROMO-06 a shop with a promotion and a held discount chooses exactly one: three options, the review shows the chosen one and the switch says what replaces what at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { eventDiscount: heldTicket() }));
    w.heldDiscount = heldTicketView();
    await openChooser(page, w, width, info, 'promo06b-first-screen');
    const choice = regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้');
    await expect(choice.getByRole('radio')).toHaveCount(3);
    await expect(choice.getByRole('radio').nth(0)).toBeChecked();
    await expect(choice.locator('label').nth(1)).toContainText('ส่วนลดจากงาน งานสัมมนาร้านค้า −50 บาท · ใช้ได้ถึง 31 ธันวาคม 2569');
    await expect(choice.locator('label').nth(2)).toHaveText('ซื้อแบบปกติ');
    await expect(choice.locator('p')).toHaveText([CHOICE_NOTE, 'ลดเฉพาะบิลแรก รอบถัดไปคิดราคาเต็ม งานเดียวกันใช้ได้ร้านละครั้ง']);
    // the card of the promoted package shows the promotion, and not the discount that is not picked
    await expect(starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toBeVisible();
    await expect(starterOf(page)).not.toContainText('ส่วนลดจากงาน งานสัมมนาร้านค้า −50 บาท');
    await settle(page, info, width, 'promo06b-chooser');
    await buyStarter(page).click();
    await expect(promoReviewOf(page)).toBeVisible();
    // the held discount is on the review as "not used this time", with the way to swap
    const discount = reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' });
    await expect(discount).toContainText('ไม่ใช้ส่วนลดจากงานครั้งนี้ · ส่วนลดยังเป็นของคุณถึง 31 ธันวาคม 2569');
    await expect(discount.getByRole('button', { name: 'ใช้ส่วนลดแทนโปรโมชั่น', exact: true })).toBeVisible();
    await expect(reviewOf(page)).toContainText(`ชำระวันนี้ ${money(24_900)}`);
    await settle(page, info, width, 'promo06b-review-promotion');
    await discount.getByRole('button', { name: 'ใช้ส่วนลดแทนโปรโมชั่น', exact: true }).click();
    await expect(reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' }).getByRole('button', { name: 'ไม่ใช้ส่วนลดครั้งนี้', exact: true })).toBeVisible();
    await expect(promoReviewOf(page)).toHaveCount(0);
    await expect(reviewOf(page)).toContainText(`ชำระวันนี้ ${money(19_900)}`);
    await expect(reviewOf(page)).not.toContainText(/โปรโมชั่น|แถมฟรี/);
    expect(w.log.quotes).toHaveLength(2);
    expect(w.log.quotes[0]).toEqual({ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO', benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN_ID, eventDiscountChoice: 'DECLINE' });
    expect(w.log.quotes[1]).toEqual({ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO', benefitChoice: 'EVENT_DISCOUNT', eventDiscountChoice: 'USE' });
    wire(info, 'quotes-promotion-then-discount', width, w.log.quotes);
    await settle(page, info, width, 'promo06b-review-discount');
    // and back: the discount review offers the way back to nothing but a normal purchase
    await reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' }).getByRole('button', { name: 'ไม่ใช้ส่วนลดครั้งนี้', exact: true }).click();
    await expect(reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' }).getByRole('button', { name: 'ใช้ส่วนลด', exact: true })).toBeVisible();
    expect(w.log.quotes[2]).toEqual({ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO', benefitChoice: 'NORMAL', eventDiscountChoice: 'DECLINE' });
  });
}

// UAT 2026-10-10 (plan R19): with "ใช้โปรโมชั่น" on by default, a package with no promotion still shows its held discount and is quoted with it; once the buyer picks the promotion on purpose, it does not.
// The note under the choice says exactly this (CHOICE_NOTE): the promotion only on the packages that show it, any other package as its own card shows.
for (const width of WIDTHS) {
  test(`PROMO-06 the note under the choice is true for a package with no promotion: its card shows the held discount and the quote applies it; after picking the promotion on purpose the card shows none and the quote declines it at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { eventDiscount: heldTicket() }));
    w.heldDiscount = heldTicketView();
    await openChooser(page, w, width);
    const choice = regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้'), basic = cardOf(page, 'เติบโต (BASIC)');
    await expect(choice).toContainText(CHOICE_NOTE);
    await expect(choice.getByRole('radio').nth(0)).toBeChecked();
    // the default: the promoted package takes the promotion, the other package keeps what its card shows
    await expect(starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toBeVisible();
    await expect(basic.getByRole('region', { name: /^โปรโมชั่น / })).toHaveCount(0);
    await expect(basic).toContainText('ส่วนลดจากงาน งานสัมมนาร้านค้า −50 บาท');
    await basic.getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
    await expect(reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' })).toContainText('ส่วนลดจากงาน งานสัมมนาร้านค้า');
    await expect(reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' }).getByRole('button', { name: 'ไม่ใช้ส่วนลดครั้งนี้', exact: true })).toBeVisible();
    await expect(promoReviewOf(page)).toHaveCount(0);
    expect(w.log.quotes).toEqual([{ offerKey: 'BASIC_499', interval: 'month', purchaseMode: 'CARD_AUTO', eventDiscountChoice: 'USE' }]);
    await settle(page, info, width, 'promo06c-other-package-default');
    // the promotion picked on purpose (normal first, then the promotion, so the radio really changes): the other package shows no discount and is quoted without it
    await page.getByRole('button', { name: 'กลับไปเลือกแพ็กเกจ', exact: true }).click();
    await choice.getByRole('radio').nth(2).check();
    await choice.getByRole('radio').nth(0).check();
    await expect(basic).not.toContainText('ส่วนลดจากงาน งานสัมมนาร้านค้า −50 บาท');
    await basic.getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
    await expect(reviewOf(page)).toBeVisible();
    expect(w.log.quotes.at(-1)).toEqual({ offerKey: 'BASIC_499', interval: 'month', purchaseMode: 'CARD_AUTO', eventDiscountChoice: 'DECLINE' });
    wire(info, 'quotes-other-package', width, w.log.quotes);
  });
}

const TICKET_BOX = {
  legend: 'ส่วนลดจากงาน', ticket: 'ส่วนลดจากงาน งานสัมมนาร้านค้า −50 บาท · ใช้ได้ถึง 31 ธันวาคม 2569', decline: 'ไม่ใช้ครั้งนี้',
  notes: ['ใช้ได้ครั้งละ 1 ส่วนลดต่อการจ่าย ส่วนลดที่ไม่ได้เลือกยังเก็บไว้ใช้ครั้งถัดไปได้', 'ลดเฉพาะบิลแรก รอบถัดไปคิดราคาเต็ม งานเดียวกันใช้ได้ร้านละครั้ง'],
};
const ticketOnlyWorld = (companyId: string) => {
  const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { promotions: undefined, eventDiscount: heldTicket() }));
  w.heldDiscount = heldTicketView();
  return w;
};

for (const width of WIDTHS) {
  test(`PROMO-06 a shop holding only a sales-event ticket sees the discount box exactly as origin/main shows it, and its quote request is recorded at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = ticketOnlyWorld(companyId);
    await openChooser(page, w, width, info, 'promo06-first-screen');
    // origin/main: one section "ส่วนลดจากงาน" — legend, one radio per held ticket, "ไม่ใช้ครั้งนี้", the two notes — and nothing about a promotion
    const box = regionNamed(page, 'ส่วนลดจากงาน');
    await expect(box).toBeVisible();
    await expect(box.locator('legend')).toHaveText(TICKET_BOX.legend);
    await expect(box.getByRole('radio')).toHaveCount(2);
    await expect(box.locator('label')).toHaveText([TICKET_BOX.ticket, TICKET_BOX.decline]);
    await expect(box.locator('p')).toHaveText(TICKET_BOX.notes);
    await expect(box.getByRole('radio').first()).toBeChecked();
    await expect(page.getByText(/โปรโมชั่น|ซื้อแบบปกติ|สิทธิ์ที่ใช้ในการซื้อครั้งนี้/)).toHaveCount(0);
    await expect(starterOf(page)).toContainText('ส่วนลดจากงาน งานสัมมนาร้านค้า −50 บาท');
    await settle(page, info, width, 'promo06-chooser');
    await buyStarter(page).click();
    await expect(reviewOf(page)).toBeVisible();
    const used = w.log.quotes[0]!;
    // what the buyer reads for the discount in the review, as origin/main prints it
    const section = reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' });
    await expect(section.locator('dt')).toHaveText(['ราคาแพ็กเกจ', 'ส่วนลดจากงาน งานสัมมนาร้านค้า']);
    await expect(section.locator('dd')).toHaveText([money(24_900), `−${money(5_000)}`]);
    await expect(section).toContainText('ส่วนลดใช้กับบิลแรกเท่านั้น งานเดียวกันใช้ได้ร้านละครั้ง');
    await expect(section.getByRole('button', { name: 'ไม่ใช้ส่วนลดครั้งนี้', exact: true })).toBeVisible();
    await expect(reviewOf(page)).toContainText(`ชำระวันนี้ ${money(19_900)}`);
    await expect(promoReviewOf(page)).toHaveCount(0);
    await settle(page, info, width, 'promo06-review');
    await section.getByRole('button', { name: 'ไม่ใช้ส่วนลดครั้งนี้', exact: true }).click();
    await expect(reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' }).getByRole('button', { name: 'ใช้ส่วนลด', exact: true })).toBeVisible();
    const declined = w.log.quotes[1]!;
    // THE WIRE: origin/main's own request (offerKey, interval, purchaseMode and eventDiscountChoice USE / DECLINE), byte for byte
    wire(info, 'ticket-only-quotes', width, { use: used, decline: declined });
    expect(used).toEqual({ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO', eventDiscountChoice: 'USE' });
    expect(declined).toEqual({ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO', eventDiscountChoice: 'DECLINE' });
  });

  // FXE-D1 (fixed in round 2): a card with no AVAILABLE promotion row sends origin/main's request, whatever the shop holds. The browser asserts the cells of the unit table
  // (billing-promotion.spec.ts) a buyer can reach: ticket only (the review switch and the radio), a row that only says why not, and a promotion on Starter while the buyer taps Basic.
  test(`PROMO-06 a ticket-only shop's quote request is exactly the legacy one (eventDiscountChoice only, no benefitChoice), from the review switch and from the radio at ${width}px`, async ({ authedPage: page, companyId }) => {
    const w = ticketOnlyWorld(companyId);
    await openChooser(page, w, width);
    await buyStarter(page).click();
    await expect(reviewOf(page)).toBeVisible();
    await reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' }).getByRole('button', { name: 'ไม่ใช้ส่วนลดครั้งนี้', exact: true }).click();
    await expect(reviewOf(page).getByRole('button', { name: 'ใช้ส่วนลด', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'กลับไปเลือกแพ็กเกจ', exact: true }).click();
    // the radio: "ไม่ใช้ครั้งนี้" declines, the ticket's own radio takes it again
    await regionNamed(page, 'ส่วนลดจากงาน').getByRole('radio', { name: 'ไม่ใช้ครั้งนี้' }).check();
    await buyStarter(page).click();
    await expect(reviewOf(page).getByRole('button', { name: 'ใช้ส่วนลด', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'กลับไปเลือกแพ็กเกจ', exact: true }).click();
    await regionNamed(page, 'ส่วนลดจากงาน').getByRole('radio', { name: /ส่วนลดจากงาน งานสัมมนาร้านค้า/ }).check();
    await buyStarter(page).click();
    await expect(reviewOf(page).getByRole('button', { name: 'ไม่ใช้ส่วนลดครั้งนี้', exact: true })).toBeVisible();
    const legacy = { offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO' };
    expect(w.log.quotes).toEqual([{ ...legacy, eventDiscountChoice: 'USE' }, { ...legacy, eventDiscountChoice: 'DECLINE' }, { ...legacy, eventDiscountChoice: 'DECLINE' }, { ...legacy, eventDiscountChoice: 'USE' }]);
    for (const quote of w.log.quotes) expect(quote).not.toHaveProperty('benefitChoice');
  });

  test(`PROMO-06 a held discount beside a promotion row that only says why not still sends the legacy request at ${width}px`, async ({ authedPage: page, companyId }) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { promotions: promotionRows('ALREADY_USED'), eventDiscount: heldTicket() }));
    w.heldDiscount = heldTicketView();
    await openChooser(page, w, width);
    await expect(starterOf(page).getByRole('note').filter({ hasText: REASON.ALREADY_USED })).toBeVisible();
    await expect(regionNamed(page, 'ส่วนลดจากงาน')).toBeVisible();
    await expect(regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้')).toHaveCount(0);
    await buyStarter(page).click();
    await expect(reviewOf(page).getByRole('region', { name: 'ส่วนลดจากงาน' })).toContainText(`ส่วนลดจากงาน งานสัมมนาร้านค้า`);
    expect(w.log.quotes).toEqual([{ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO', eventDiscountChoice: 'USE' }]);
  });

  test(`PROMO-06 a promotion on Starter and a held discount: Basic gets the legacy request, Starter the benefit the buyer chose at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { eventDiscount: heldTicket() }));
    w.heldDiscount = heldTicketView();
    await openChooser(page, w, width);
    const choice = regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้');
    const tap = async (title: string) => {
      await cardOf(page, title).getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true }).click();
      await expect(reviewOf(page)).toBeVisible();
      await page.getByRole('button', { name: 'กลับไปเลือกแพ็กเกจ', exact: true }).click();
      await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toBeVisible();
    };
    // nothing touched: the promotion radio is the default, Starter has the promotion and Basic has only the held discount, which lowers it
    await expect(cardOf(page, 'เติบโต (BASIC)')).toContainText('ส่วนลดจากงาน งานสัมมนาร้านค้า −50 บาท');
    await settle(page, info, width, 'promo06r2-basic-with-ticket-chooser');
    await tap('เติบโต (BASIC)');
    // the buyer picks the promotion on purpose (the radio looks checked from the start, so choose another first) and taps Basic: no promotion there, and the discount stays unspent (main's own word)
    await choice.getByRole('radio', { name: 'ซื้อแบบปกติ' }).check();
    await choice.getByRole('radio', { name: /ใช้โปรโมชั่น/ }).check();
    await expect(cardOf(page, 'เติบโต (BASIC)')).not.toContainText('ส่วนลดจากงาน งานสัมมนาร้านค้า −50 บาท');
    await tap('เติบโต (BASIC)');
    await tap('เริ่มต้น (STARTER)');
    await choice.getByRole('radio', { name: /ส่วนลดจากงาน/ }).check();
    await tap('เริ่มต้น (STARTER)');
    await choice.getByRole('radio', { name: 'ซื้อแบบปกติ' }).check();
    await tap('เริ่มต้น (STARTER)');
    await tap('เติบโต (BASIC)');
    const base = { interval: 'month', purchaseMode: 'CARD_AUTO' };
    expect(w.log.quotes).toEqual([
      { ...base, offerKey: 'BASIC_499', eventDiscountChoice: 'USE' },
      { ...base, offerKey: 'BASIC_499', eventDiscountChoice: 'DECLINE' },
      { ...base, offerKey: 'STARTER_249', benefitChoice: 'PROMOTION', promotionCampaignId: CAMPAIGN_ID, eventDiscountChoice: 'DECLINE' },
      { ...base, offerKey: 'STARTER_249', benefitChoice: 'EVENT_DISCOUNT', eventDiscountChoice: 'USE' },
      { ...base, offerKey: 'STARTER_249', benefitChoice: 'NORMAL', eventDiscountChoice: 'DECLINE' },
      { ...base, offerKey: 'BASIC_499', eventDiscountChoice: 'DECLINE' },
    ]);
    wire(info, 'quotes-promotion-and-ticket-by-card', width, w.log.quotes);
  });

  test(`PROMO-07 a shop with neither a promotion nor a ticket: no new section, no new field, the same review as before at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { promotions: undefined }));
    await openChooser(page, w, width);
    await expect(regionNamed(page, 'สิทธิ์ที่ใช้ในการซื้อครั้งนี้')).toHaveCount(0);
    await expect(regionNamed(page, 'ส่วนลดจากงาน')).toHaveCount(0);
    await expect(page.getByText(/โปรโมชั่น|ส่วนลดจากงาน|ซื้อแบบปกติ|ไม่ใช้ครั้งนี้/)).toHaveCount(0);
    await expect(regionNamed(page, 'เลือกแพ็กเกจ').getByRole('region', { name: /^โปรโมชั่น / })).toHaveCount(0);
    await settle(page, info, width, 'promo07-chooser');
    await buyStarter(page).click();
    await expect(reviewOf(page)).toBeVisible();
    expect(w.log.quotes).toEqual([{ offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_AUTO' }]);
    wire(info, 'quote-no-promotion-no-ticket', width, w.log.quotes[0]);
    await expect(promoReviewOf(page)).toHaveCount(0);
    await expect(reviewOf(page)).toContainText(`ชำระวันนี้ ${money(24_900)}`);
    await expect(reviewOf(page)).toContainText('รับโควตา 30 ใบ');
    await expect(reviewOf(page)).not.toContainText(/โปรโมชั่น|แถม|ส่วนลด/);
    await settle(page, info, width, 'promo07-review');
    await confirmCheckout(page);
    await page.waitForURL(/checkout\.stripe\.com/);
    expect(w.log.checkouts[0]!.body).toEqual({ quoteId: 'quote-1', consentRevision: 'billing-v2', accepted: true, channel: 'web' });
  });
}

/* ================================================================ 8. after the payment ================================================================ */

const benefitEnd = addMonths(FIXED_NOW, 2), until = thaiDay(benefitEnd), bonusLine = 'แถมฟรี 1 เดือน · ใบเสร็จเพิ่ม 30 ใบ', nameLine = `โปรโมชั่น ${CAMPAIGN_NAME}`;
type AfterPayment = { key: string; use: BillingPromotionUse; status: Partial<BillingStatus>; title: string; lines: string[]; recheck: boolean };
const AFTER_PAYMENT: AfterPayment[] = [
  { key: 'READY', use: promotionUse({ renewalSetupState: 'READY' }), status: { subscriptionState: 'active' },
    title: 'ใช้สิทธิ์โปรโมชั่นแล้ว', lines: [nameLine, `ใช้ได้ถึง ${until}`, `ตั้งต่ออายุแล้ว รอบถัดไปเรียกเก็บวันที่ ${until}`, bonusLine], recheck: false },
  { key: 'PENDING', use: promotionUse({ renewalSetupState: 'PENDING' }), status: { subscriptionState: 'NONE', nextChargeAt: null, allowedActions: [] },
    title: 'ใช้สิทธิ์โปรโมชั่นแล้ว', lines: [nameLine, `ชำระแล้ว ใช้ได้ถึง ${until} กำลังตั้งค่ารอบถัดไป ไม่ต้องชำระซ้ำ`, bonusLine], recheck: true },
  { key: 'REVIEW', use: promotionUse({ renewalSetupState: 'REVIEW' }), status: { subscriptionState: 'NONE', nextChargeAt: null, allowedActions: [] },
    title: 'ใช้สิทธิ์โปรโมชั่นแล้ว', lines: [nameLine, `ใช้ได้ถึง ${until}`, 'ชำระแล้ว ทีมงานกำลังตรวจการตั้งรอบถัดไป ไม่ต้องชำระซ้ำ', bonusLine], recheck: false },
  { key: 'NOT_REQUIRED', use: promotionUse({ renewalSetupState: 'NOT_REQUIRED', expectedNextChargeAt: null }), status: { renewalMode: 'CARD_ONCE', subscriptionState: 'NONE', nextChargeAt: null },
    title: 'ใช้สิทธิ์โปรโมชั่นแล้ว', lines: [nameLine, `ใช้ได้ถึง ${until}`, bonusLine], recheck: false },
  { key: 'CANCELLED', use: promotionUse({ renewalSetupState: 'CANCELLED', expectedNextChargeAt: null }), status: { cancelAtPeriodEnd: true, nextChargeAt: null },
    title: 'ใช้สิทธิ์โปรโมชั่นแล้ว', lines: [nameLine, `ใช้ได้ถึง ${until}`, bonusLine], recheck: false },
];

for (const width of WIDTHS) for (const state of AFTER_PAYMENT) {
  test(`PROMO-08 after payment, ${state.key}: the status says what was used, until when and what happens next at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, paidShopStatus(companyId, { promotion: state.use, ...state.status }));
    w.history = [invoiceItem({ promotion: { displayName: CAMPAIGN_NAME, paidEnd: addMonths(FIXED_NOW, 1), benefitEnd, bonusReceiptUnits: 30 } })];
    await openOverview(page, w, width);
    const block = page.getByRole('status', { name: 'สถานะโปรโมชั่น' });
    await expect(block).toBeVisible();
    await expect(block.locator('p').first()).toHaveText(state.title);
    await expect(block.locator('p')).toHaveText([state.title, ...state.lines]);
    await expect(block).not.toContainText(/จองสิทธิ์|เมื่อชำระเงินสำเร็จ/);
    // a renewal still being set up brings the existing "check again" button and never an invitation to pay again
    await expect(page.getByRole('button', { name: 'ตรวจผลการชำระเงิน', exact: true })).toHaveCount(state.recheck ? 1 : 0);
    await expect(regionNamed(page, 'ตรวจผลการชำระเงิน')).toHaveCount(state.recheck ? 1 : 0);
    await expect(page.getByRole('heading', { name: 'แพ็กเกจปัจจุบัน', exact: true })).toBeVisible();
    await expect(regionNamed(page, 'สถานะแพ็กเกจ')).toContainText(until);
    await settle(page, info, width, `promo08-${state.key.toLowerCase()}`);
  });
}

for (const width of WIDTHS) {
  test(`PROMO-08 a payment still open holds the right: "reserved", never worded as used at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, openPaymentStatus(newShopStatus(companyId, { promotions: promotionRows() }), { promotion: RESERVED_USE }));
    await openOverview(page, w, width);
    // the right is told once, in the block of the payment that holds it; the separate green box says nothing for a reserved right
    const block = regionNamed(page, 'มีรายการชำระเงินที่ยังไม่เสร็จ');
    await expect(block.locator(':scope > p')).toHaveText(['เปิดหน้าชำระเงินไว้แล้ว แต่ระบบยังไม่ได้รับผลการชำระเงิน', `จองสิทธิ์โปรโมชั่น ${CAMPAIGN_NAME} ไว้ให้รายการนี้แล้ว สิทธิ์เริ่มใช้เมื่อชำระเงินสำเร็จ`]);
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toHaveCount(0);
    await expect(block).not.toContainText(/ใช้สิทธิ์โปรโมชั่นแล้ว|ใช้ได้ถึง/);
    await expect(block.getByRole('button', { name: 'ชำระเงินต่อ', exact: true })).toBeVisible();
    await settle(page, info, width, 'promo08-reserved');
  });

  for (const stage of ['applied', 'applying'] as const) {
    test(`PROMO-08 the return page after Stripe (${stage}) tells the right the attempt itself holds at ${width}px`, async ({ authedPage: page, companyId }, info) => {
      const applied = stage === 'applied';
      const use = applied ? promotionUse({ renewalSetupState: 'PENDING' }) : promotionUse({ paidEnd: null, benefitEnd: null, renewalSetupState: 'PENDING', expectedNextChargeAt: null });
      const status = applied ? paidShopStatus(companyId, { promotion: use, subscriptionState: 'NONE', nextChargeAt: null, allowedActions: [] })
        : newShopStatus(companyId, { paymentState: 'PAID', applyState: 'PENDING', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, allowedActions: [], promotions: undefined, promotion: use });
      const w = defaultCustomerWorld(companyId, status);
      w.attempt = { attemptId: ATTEMPT_ID, state: 'OPEN', errorCode: null, observedAt: FIXED_NOW, paymentState: 'PAID', applyState: applied ? 'APPLIED' : 'PENDING', invoiceReference: 'PROMO-0001', promotion: use };
      await openOverview(page, w, width, `/billing/return?attempt=${ATTEMPT_ID}`);
      const block = page.getByRole('status', { name: 'สถานะโปรโมชั่น' });
      await expect(block).toBeVisible();
      await expect(page.getByRole('heading', { name: applied ? 'ชำระแล้ว เปิดใช้งานแล้ว' : 'ชำระแล้ว กำลังตรวจสอบการเปิดสิทธิ์', exact: true })).toBeVisible();
      await expect(block).toContainText('ใช้สิทธิ์โปรโมชั่นแล้ว');
      await expect(block).toContainText('กำลังตั้งค่ารอบถัดไป ไม่ต้องชำระซ้ำ');
      await expect(block).not.toContainText('จองสิทธิ์');
      // money received (or the renewal still being set up): the block with its one quiet check, never a way to pay again or to throw the payment away
      await expect(regionNamed(page, applied ? 'ตรวจผลการชำระเงิน' : 'ระบบได้รับเงินแล้ว ไม่ต้องชำระซ้ำ').getByRole('button')).toHaveText(['ตรวจผลการชำระเงิน']);
      await expect(page.getByRole('button', { name: 'ตรวจผลการชำระเงิน', exact: true })).toBeVisible();
      for (const gone of ['ชำระเงินต่อ', 'ยกเลิกรายการนี้', 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่']) await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
      for (const invitation of ['เลือกแพ็กเกจใหม่', 'เลือกแพ็กเกจ', 'ซื้อหรือเปลี่ยนแพ็กเกจ']) await expect(page.getByRole('button', { name: invitation, exact: true })).toHaveCount(0);
      await settle(page, info, width, `promo08-return-${stage}`);
    });
  }

  // Round 2: "ใช้สิทธิ์โปรโมชั่นแล้ว … ใช้ได้ถึง" is told only while the package runs; an ended, lapsed or held shop is not "using" a right that already has its end date.
  for (const access of ['EXPIRED', 'HELD'] as const) test(`PROMO-08 a shop whose access is ${access} is not told it is using a right that already has an end date at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const lapsed = access === 'EXPIRED';
    const w = defaultCustomerWorld(companyId, paidShopStatus(companyId, { accessState: access, promotion: promotionUse(), attemptId: null, reference: null, allowedActions: lapsed ? ['new_sales'] : [],
      ...(lapsed ? { lockReason: 'trial_ended' as const, termEndsAt: inDays(-3), paidThrough: inDays(-3), subscriptionState: 'canceled', nextChargeAt: null } : {}) }));
    await openOverview(page, w, width);
    await expect(page.getByRole('heading', { name: lapsed ? 'แพ็กเกจหมดอายุแล้ว' : 'แพ็กเกจปัจจุบัน', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toHaveCount(0);
    await expect(page.getByText(/ใช้สิทธิ์โปรโมชั่นแล้ว|แถมฟรี 1 เดือน · ใบเสร็จเพิ่ม 30 ใบ/)).toHaveCount(0);
    await settle(page, info, width, `promo08r2-access-${access.toLowerCase()}`);
  });

  // An open payment the reconciler expired before it ever started is refused on "ชำระเงินต่อ" with its own sentence ("เริ่มรายการใหม่"), and the right is back.
  // FXE-D9 (fixed in round 3): the page reads the status itself, so the dead payment, its block and its reserved right go while the banner stays. FXE-D10 (fixed in round 3): the banner is brought into view.
  const neverStarted = { status: 409, json: { code: 'BILLING_CHECKOUT_NOT_STARTED', message: 'Checkout was never started' } };
  const neverStartedBanner = (page: Page) => page.getByRole('alert').filter({ hasText: 'รายการชำระเงินนี้ยังไม่ได้เริ่ม ระบบยกเลิกให้แล้ว กรุณาเริ่มรายการใหม่' });
  const openForResume = (companyId: string) => {
    const free = newShopStatus(companyId, { promotions: promotionRows() }), w = defaultCustomerWorld(companyId, openPaymentStatus(free, { promotion: RESERVED_USE }));
    w.resumeOverride = () => neverStarted;
    return { w, free };
  };
  test(`PROMO-08 resuming a payment that never started says so in plain Thai, the page reads the status itself, and the shop can start again with the promotion at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const { w, free } = openForResume(companyId);
    await openOverview(page, w, width);
    const block = regionNamed(page, 'มีรายการชำระเงินที่ยังไม่เสร็จ');
    await expect(block).toContainText(`จองสิทธิ์โปรโมชั่น ${CAMPAIGN_NAME} ไว้ให้รายการนี้แล้ว`);
    // the reconciler has expired it by the time the buyer taps: the next read shows a free shop and the right back on offer
    w.status = free;
    await block.getByRole('button', { name: 'ชำระเงินต่อ', exact: true }).click();
    const banner = neverStartedBanner(page);
    await expect(banner).toBeVisible();
    await page.waitForTimeout(500);
    const seen = await inViewNow(banner);
    expect(seen.visibleToBuyer, JSON.stringify(seen)).toBe(true);
    wire(info, 'resume-refused-position', width, { ...seen, requests: w.log.calls });
    // no second tap: the dead payment and its block are gone, the banner is still there, and the way to choose a package is open
    await expect(block).toHaveCount(0);
    await expect(banner).toBeVisible();
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toHaveCount(0);
    await firstScreen(page, info, width, 'promo08r3-resume-refused-first-screen');
    await settle(page, info, width, 'promo08r3-resume-not-started');
    await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    await expect(starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toBeVisible();
  });

  test(`PROMO-08 after "ยังไม่ได้เริ่ม" the page reads the status itself: the cancelled payment and its reserved right are gone without another tap at ${width}px`, async ({ authedPage: page, companyId }) => {
    const { w, free } = openForResume(companyId);
    await openOverview(page, w, width);
    await expect(regionNamed(page, 'มีรายการชำระเงินที่ยังไม่เสร็จ')).toBeVisible();
    const reads = w.log.statusReads;
    w.status = free;
    await regionNamed(page, 'มีรายการชำระเงินที่ยังไม่เสร็จ').getByRole('button', { name: 'ชำระเงินต่อ', exact: true }).click();
    await expect(neverStartedBanner(page)).toBeVisible();
    await expect(regionNamed(page, 'มีรายการชำระเงินที่ยังไม่เสร็จ')).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true })).toBeVisible();
    expect(w.log.statusReads).toBeGreaterThan(reads);
    expect(w.log.resumes).toBe(1);
  });

  // The same for the answers that also mean "this payment is over": the payment to end is gone (404), or the request found it changed (CONTROL_PREVIEW_STALE).
  for (const refusal of [{ name: '404 on ending it', via: 'cancel' as const, answer: { status: 404, json: { statusCode: 404, message: 'Not Found' } } },
    { name: 'CONTROL_PREVIEW_STALE on resuming it', via: 'resume' as const, answer: { status: 409, json: { code: 'CONTROL_PREVIEW_STALE', message: 'stale' } } }])
    test(`PROMO-08 a payment that is over (${refusal.name}): the banner is on screen and the page reads the status itself at ${width}px`, async ({ authedPage: page, companyId }) => {
      const { w, free } = openForResume(companyId);
      if (refusal.via === 'cancel') w.cancelOverride = () => refusal.answer; else w.resumeOverride = () => refusal.answer;
      await openOverview(page, w, width);
      const block = regionNamed(page, 'มีรายการชำระเงินที่ยังไม่เสร็จ');
      await expect(block).toBeVisible();
      w.status = free;
      await block.getByRole('button', { name: refusal.via === 'cancel' ? 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่' : 'ชำระเงินต่อ', exact: true }).click();
      const banner = page.locator('[role="alert"].bg-red-50');
      await expect(banner).toBeVisible();
      await page.waitForTimeout(500);
      expect((await inViewNow(banner)).visibleToBuyer).toBe(true);
      await expect(block).toHaveCount(0);
      await expect(banner).toBeVisible();
      await expect(page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true })).toBeVisible();
    });

  // FXE-D10 (fixed in round 3): the red banner takes a ref, focus and the header scroll margin, and is brought into view only when it is not already visible. After a refused "ชำระเงินต่อ" the buyer is at that
  // button, the banner was 315px above the 390x844 viewport (177px at 1280) and nothing visibly happened. Here the status still names the open payment, so the block stays beside the banner.
  test(`PROMO-08 the red error banner is on screen after a refused "ชำระเงินต่อ" (a person can see it) at ${width}px`, async ({ authedPage: page, companyId }) => {
    const { w } = openForResume(companyId);
    await openOverview(page, w, width);
    await regionNamed(page, 'มีรายการชำระเงินที่ยังไม่เสร็จ').getByRole('button', { name: 'ชำระเงินต่อ', exact: true }).click();
    const banner = neverStartedBanner(page);
    await expect(banner).toBeVisible();
    await page.waitForTimeout(500);
    const seen = await inViewNow(banner);
    expect(seen.visibleToBuyer, JSON.stringify(seen)).toBe(true);
    await expect(banner).toBeFocused();
  });

  test(`PROMO-08 a payment that failed leaves the return page without any word about a reserved right at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    // the API no longer sends `promotion` for a RESERVED right on a FAILED / EXPIRED attempt (status carries none either: the right went back)
    // A finished attempt is no longer the account's active one: the status names none (`paymentState` NONE), the rows are back, and the return page reads the attempt itself.
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { promotions: promotionRows() }));
    w.attempt = { attemptId: ATTEMPT_ID, state: 'EXPIRED', errorCode: null, observedAt: FIXED_NOW, paymentState: 'FAILED', applyState: 'NONE', invoiceReference: null };
    await openOverview(page, w, width, `/billing/return?attempt=${ATTEMPT_ID}`);
    await expect(page.getByRole('heading', { name: 'รายการชำระเงินนี้ไม่สำเร็จ', exact: true })).toBeVisible();
    await expect(page.getByText(/จองสิทธิ์|สิทธิ์โปรโมชั่น|ใช้สิทธิ์โปรโมชั่นแล้ว/)).toHaveCount(0);
    // the last result stays checkable, and the way to a new purchase is open
    await expect(regionNamed(page, 'ผลการชำระเงินล่าสุด').getByRole('button')).toHaveText(['ตรวจผลการชำระเงิน']);
    // the promotion is on offer again for the next try
    await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).first().click();
    await expect(starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toBeVisible();
    await settle(page, info, width, 'promo08r2-return-failed');
  });

  test(`PROMO-08 the higher packages explain the date instead of offering an immediate upgrade at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, paidShopStatus(companyId, { promotion: promotionUse(), upgradeDeferredUntil: benefitEnd, availablePurchaseModes: ['CARD_AUTO'] }));
    w.purchase = 'REPEAT';
    await openChooser(page, w, width);
    const note = `อัปเกรดได้หลังวันที่ ${until} เพราะแพ็กเกจปัจจุบันยังมีเวลาโปรโมชั่นที่ใช้ไม่หมด`;
    for (const title of ['เติบโต (BASIC)', 'มืออาชีพ (PRO)', 'ธุรกิจ (ENTERPRISE)']) {
      await expect(cardOf(page, title).getByRole('note').filter({ hasText: note })).toBeVisible();
      await expect(cardOf(page, title).getByRole('button', { name: 'เลือกแพ็กเกจนี้', exact: true })).toBeDisabled();
    }
    await expect(starterOf(page).getByRole('note').filter({ hasText: 'อัปเกรดได้หลังวันที่' })).toHaveCount(0);
    await expect(starterOf(page).getByRole('button', { name: 'ซื้อแพ็กเกจเดิมเพิ่ม', exact: true })).toBeEnabled();
    await expect(starterOf(page)).toContainText('แพ็กเกจปัจจุบัน');
    await settle(page, info, width, 'promo08-upgrade-deferred');
  });

  // UAT 2026-10-10: right after a successful purchase the live API reports `purchaseBlockCode` for a card shop whose promotion still has time (BILLING_REPEAT_NOT_READY, with `upgradeDeferredUntil`) and for
  // a shop that pays a QR bill every period (BILLING_PLAN_CHANGE_REQUIRED). The amber alert with a reference for the team and a "ตรวจสถานะล่าสุด" button read as a failure to someone who had just paid.
  // Now (billing-promotion.ts purchaseBlockQuiet): one quiet line inside the package card; every other code, and these two in any other state, keep the alert.
  const QUIET_CARD = `ซื้อหรือเปลี่ยนแพ็กเกจได้หลังวันที่ ${until} เพราะแพ็กเกจปัจจุบันยังมีเวลาโปรโมชั่นที่ใช้ไม่หมด`;
  const QUIET_QR = 'แพ็กเกจปัจจุบันชำระด้วยบิล QR ทุกงวด ซื้อหรือเปลี่ยนแพ็กเกจใหม่ได้เมื่อรอบปัจจุบันสิ้นสุด หรือจัดการบิลในแท็บการต่ออายุและชำระเงิน';
  const amberAlert = (page: Page) => page.locator('[role="alert"].bg-amber-50');
  for (const shop of [{ key: 'card auto-renew', status: deferredShopStatus, line: QUIET_CARD }, { key: 'QR bill every period', status: qrShopStatus, line: QUIET_QR }] as const)
    test(`PROMO-08 a ${shop.key} shop right after paying: no amber alert, one quiet line in the package card, no reference for the team and no "ตรวจสถานะล่าสุด" at ${width}px`, async ({ authedPage: page, companyId }, info) => {
      const w = defaultCustomerWorld(companyId, shop.status(companyId));
      await openOverview(page, w, width);
      const card = regionNamed(page, 'สถานะแพ็กเกจ');
      await expect(card.getByRole('heading', { name: 'แพ็กเกจปัจจุบัน', exact: true })).toBeVisible();
      await expect(card.getByRole('note').filter({ hasText: shop.line })).toHaveCount(1);
      await expect(card.getByRole('note').filter({ hasText: shop.line })).toHaveText(shop.line);
      await expect(amberAlert(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'ตรวจสถานะล่าสุด', exact: true })).toHaveCount(0);
      await expect(page.getByText('เลขอ้างอิงสำหรับแจ้งทีมงาน')).toHaveCount(0);
      // the QR shop's line is its own sentence, never the promotion's date, even though the status also carries the date
      if (shop.key !== 'card auto-renew') await expect(card).not.toContainText('หลังวันที่');
      await firstScreen(page, info, width, `promo08q-${shop.key.split(' ')[0]}-first-screen`);
      await settle(page, info, width, `promo08q-${shop.key.split(' ')[0]}`);
    });

  // The same code in a state that is not "active, paid, applied, no payment in flight" keeps the alert exactly as before: its sentence, the reference for the team and the check button.
  test(`PROMO-08 the same block code on a shop whose last charge failed keeps the amber alert, with its reference and its button, and no quiet line at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, deferredShopStatus(companyId, { paymentState: 'FAILED', subscriptionState: 'past_due' }));
    await openOverview(page, w, width);
    const alert = amberAlert(page);
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText('การซื้อซ้ำหรือเปลี่ยนแพ็กเกจระหว่างรอบยังไม่เปิดให้บริการ');
    await expect(alert).toContainText('เลขอ้างอิงสำหรับแจ้งทีมงาน: ');
    await expect(alert.getByRole('button', { name: 'ตรวจสถานะล่าสุด', exact: true })).toBeVisible();
    await expect(regionNamed(page, 'สถานะแพ็กเกจ').getByRole('note').filter({ hasText: 'ซื้อหรือเปลี่ยนแพ็กเกจได้หลังวันที่' })).toHaveCount(0);
    await settle(page, info, width, 'promo08q-failed-keeps-alert');
  });

  // UAT 2026-10-10: the green note on the package tab gave "ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ …" to a shop that is sent a QR bill each period. The note appears for the same shops as before; its second half follows the way the shop renews.
  const HELD = `คุณมีส่วนลดจากงาน งานสัมมนาร้านค้า ลด 50 บาท ตอนจ่ายค่าแพ็กเกจ (ใช้ได้ถึง ${thaiDay('2026-12-31T16:59:00.000Z')})`;
  for (const shop of [{ key: 'a card auto-renew shop', status: deferredShopStatus, why: 'ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ ส่วนลดจากงานยังใช้กับรอบตัดเงินอัตโนมัติไม่ได้' },
    { key: 'a QR bill every period shop', status: qrShopStatus, why: 'ร้านนี้ต่ออายุด้วยบิล QR ทุกงวด ส่วนลดจากงานยังใช้กับบิล QR รอบต่ออายุไม่ได้' }] as const)
    test(`PROMO-08 the held-discount note for ${shop.key} says why in its own words at ${width}px`, async ({ authedPage: page, companyId }, info) => {
      const w = defaultCustomerWorld(companyId, shop.status(companyId));
      w.heldDiscount = { ...heldTicketView(), path: 'CREDIT' };
      await openOverview(page, w, width);
      const note = page.getByRole('note').filter({ hasText: 'คุณมีส่วนลดจากงาน' });
      await expect(note).toHaveCount(1);
      await expect(note).toHaveText(`${HELD} · ${shop.why}`);
      const other = shop.why.includes('QR') ? /ตัดเงินอัตโนมัติ/ : /QR|บิล/;
      await expect(note).not.toContainText(other);
      await settle(page, info, width, `promo08q-held-note-${shop.why.includes('QR') ? 'qr' : 'card'}`);
    });
}

/* ================================================================ 9. a payment that is started and not finished: ONE titled block, in order ================================================================ */

// `billing-pending-payment.ts` decides what the package page shows for a payment of the shop that is unfinished, in flight or being checked (its spec's state table is the specification).
// These tests put every state a buyer can reach through the simulated status in a browser, at 390 and 1280. Round 4: while a payment waits for the buyer or the provider the block LEADS the card
// and its words are the card's heading (said once); received money and a last result keep the card's own heading and give the block a title. Then: the sentence that says what is waiting, an
// ORDERED list of choices each tied to the line that says what it does, at most one green button on the whole screen, what gave way (the generic "choose a package", its invitation, the pointers,
// the no-package box, the amber alert, the old "ยังยืนยันผลไม่ได้" paragraph, the banner's green button), and the reference for the team last in the card.
// The simulated status is what the API sends while a Checkout is open: no `new_sales`, no promotion rows, `purchaseBlockCode` BILLING_CHECKOUT_PENDING (see openPaymentStatus).

const OPEN_TITLE = 'มีรายการชำระเงินที่ยังไม่เสร็จ', RECEIVED_TITLE = 'ระบบได้รับเงินแล้ว ไม่ต้องชำระซ้ำ', LAST_TITLE = 'ผลการชำระเงินล่าสุด';
const WAITING_HEADING = 'กำลังรอผลการชำระเงินจากผู้ให้บริการรับชำระเงิน', CHECKING_HEADING = 'กำลังตรวจสอบรายการชำระเงิน', REGION_CHECK = 'ตรวจผลการชำระเงิน';
const AUTO = 'ระบบตรวจผลให้อัตโนมัติ ไม่ต้องชำระซ้ำ', ASKING = 'ระบบถามผู้ให้บริการรับชำระเงินอยู่ ยังไม่ต้องเริ่มรายการใหม่', CONTACT = 'ถ้าตรวจแล้วยังไม่ชัดเจน ให้ติดต่อทีมงานพร้อมเลขอ้างอิง';
const UNPAID_PAGE = 'เปิดหน้าชำระเงินไว้แล้ว แต่ระบบยังไม่ได้รับผลการชำระเงิน';
const RESERVED_LINE = `จองสิทธิ์โปรโมชั่น ${CAMPAIGN_NAME} ไว้ให้รายการนี้แล้ว สิทธิ์เริ่มใช้เมื่อชำระเงินสำเร็จ`;
const RIGHT_BACK = 'สิทธิ์โปรโมชั่นที่จองไว้จะถูกคืน เลือกใช้ใหม่ได้ถ้าโปรโมชั่นยังเปิดอยู่';
const PACKAGE_KEPT = 'แพ็กเกจที่ใช้อยู่ไม่เปลี่ยน';
const CHECK_CAUTION = 'ระบบยังยืนยันผลจากผู้ให้บริการรับชำระเงินไม่ได้ กดตรวจก่อนชำระใหม่ เพื่อไม่ให้ชำระซ้ำ';
const CONTINUE_CAUTION = 'ใช้เมื่อแน่ใจว่ายังไม่ได้ชำระ เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ';
const GENERIC_BUTTON = /^(เลือกแพ็กเกจ|ซื้อหรือเปลี่ยนแพ็กเกจ)$/;
const INVITATIONS = ['เลือกแพ็กเกจเพื่อเริ่มใช้งาน', 'เลือกแพ็กเกจเพื่อใช้งานต่อ'];
/** The names a block is called by (a screen reader's region), the labels the four old loose buttons wore, and the words that left the screen in round 4. */
const BLOCK_NAMES = [OPEN_TITLE, RECEIVED_TITLE, CHECKING_HEADING, LAST_TITLE, WAITING_HEADING, REGION_CHECK];
const OLD_LABELS = ['กลับไปยังรายการเดิม', 'ตรวจผลการชำระเงินอีกครั้ง', 'เลือกแพ็กเกจใหม่', 'ยุติรายการที่ยังไม่ชำระ', 'ยืนยันยุติหน้าชำระเงิน', 'ยังไม่ยุติ'];
const GONE_TEXT = ['มีรายการชำระเงินที่ยังไม่เสร็จ ดูตัวเลือกด้านล่าง', 'กำลังตรวจรายการชำระเงิน ยังไม่ต้องเริ่มรายการใหม่', 'ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนชำระใหม่ หรือติดต่อทีมงานพร้อมเลขอ้างอิง',
  'ผู้ให้บริการรับชำระเงินแจ้งว่าการเก็บเงินครั้งล่าสุดไม่สำเร็จ'];
/** The shell's banner on every page of the billing area — the package page, the return page (UAT 2026-10-10: it still said "· เลือกแพ็กเกจเพื่อเริ่มใช้งาน" above "ชำระเงินต่อ"), the invoice pages — is only what is the matter: no "เลือกแพ็กเกจ" in the sentence, no green button. */
const BANNER_NONE = 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้', BANNER_EXPIRED = 'แพ็กเกจของร้านหมดอายุแล้ว';

type Step = { label: string; captions: string[]; green?: true };
/** `heading` = the card's own h2, which the block leads (a payment open, awaited or being checked); `title` = the block's own h3 (received money, a last result). The block is named by whichever it has. */
type Block = { heading: string | null; title: string | null; intro: string[]; steps: Step[] };
const blockName = (block: Block) => block.heading ?? block.title ?? REGION_CHECK;
const CONTINUE_OPEN: Step = { label: 'ชำระเงินต่อ', green: true, captions: ['เปิดหน้าชำระเงินเดิมเพื่อจ่ายให้เสร็จ'] };
const CHECK_CLAIM: Step = { label: 'ชำระแล้ว ตรวจผลการชำระเงิน', captions: ['กดเมื่อจ่ายเงินแล้วแต่หน้านี้ยังไม่เปลี่ยน'] };
const cancelOneTap = (...more: string[]): Step => ({ label: 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่', captions: ['รายการเดิมจะถูกยกเลิก', ...more] });
const cancelAsking = (...more: string[]): Step => ({ label: 'ยกเลิกรายการนี้', captions: ['ระบบจะตรวจผลกับผู้ให้บริการรับชำระเงินก่อน จึงเลือกแพ็กเกจใหม่ได้', ...more] });
const checkOnly = (caption: string, green = false): Step => ({ label: 'ตรวจผลการชำระเงิน', captions: [caption], ...(green ? { green: true as const } : {}) });

/** The block as a buyer reads it, top to bottom: the heading of the card it leads (or its own title), the sentences that say what is waiting, then the choices in order, each a button tied to the line that says what it does. */
async function expectBlock(page: Page, block: Block) {
  const region = regionNamed(page, blockName(block)), card = regionNamed(page, 'สถานะแพ็กเกจ');
  await expect(region).toHaveCount(1);
  // the words of the payment are said ONCE: the card's heading (and the block right under it) or the block's own title, never a pointer, never twice
  if (block.heading || block.title) await expect(page.getByText(blockName(block), { exact: true }), 'said once').toHaveCount(1);
  if (block.heading) {
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(block.heading);
    await expect(card.locator(':scope > *').nth(1), 'the block leads the card, right under its heading').toHaveAttribute('aria-label', block.heading);
  }
  await expect(region.getByRole('heading')).toHaveText(block.title ? [block.title] : []);
  await expect(region.locator(':scope > p')).toHaveText(block.intro);
  const items = region.locator(':scope > ol > li');
  await expect(items, 'the choices').toHaveCount(block.steps.length);
  for (const [index, step] of block.steps.entries()) {
    const item = items.nth(index), button = item.getByRole('button').first();
    await expect(button, `choice ${index + 1}`).toHaveText(step.label);
    await expect(item.locator('p[id]'), `the lines under "${step.label}"`).toHaveText(step.captions);
    await expect(button, `"${step.label}" is described by its lines`).toHaveAccessibleDescription(step.captions.join(' '));
    await expect(button).toBeEnabled();
  }
  return region;
}
/** Buttons and links that wear the brand green (the primary control, solid or a gradient of it), by their text. 'main' = the page's own content, 'screen' = everything a buyer sees, the shell's banner included. */
const greenControls = (page: Page, scope: 'main' | 'screen' = 'main') => page.evaluate(where => {
  const root = where === 'main' ? document.querySelector('main, [role="main"], #workspace-main') ?? document.body : document.body;
  return Array.from(root.querySelectorAll('button, a')).filter(el => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || el.closest('[hidden]')) return false;
    const style = getComputedStyle(el), paint = style.backgroundImage.includes('gradient') ? style.backgroundImage : style.backgroundColor;
    const [red, green, blue] = (paint.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/) ?? []).slice(1).map(Number);
    return red !== undefined && green !== undefined && blue !== undefined && green > red + 40 && green > blue + 20;
  }).map(el => (el.textContent ?? '').trim());
}, scope);
/** The reference for the team is support information, not a step: the very last thing in the package card, collapsed, after the block. */
async function expectReferenceLast(page: Page, blockName: string | null) {
  const card = regionNamed(page, 'สถานะแพ็กเกจ'), last = card.locator(':scope > *').last();
  expect(await last.evaluate(el => el.tagName)).toBe('DETAILS');
  await expect(last.locator('summary')).toHaveText('เลขอ้างอิงสำหรับแจ้งทีมงาน');
  await expect(last).not.toHaveAttribute('open', '');
  if (blockName) {
    const order = await card.evaluate((root, name) => { const children = Array.from(root.children); return { block: children.findIndex(el => el.getAttribute('aria-label') === name), last: children.length - 1 }; }, blockName);
    expect(order.block, 'the block is a child of the card, before the reference').toBeGreaterThanOrEqual(0);
    expect(order.block).toBeLessThan(order.last);
  }
}

const freeShop = (companyId: string) => newShopStatus(companyId, { promotions: promotionRows() });
/** A shop with a Checkout of its own open (and the promotion right reserved for it unless said otherwise); ending the payment gives back `free`. */
function openWorld(companyId: string, free: BillingStatus, over: Partial<BillingStatus> = {}, reserved = true): CustomerWorld {
  const w = defaultCustomerWorld(companyId, openPaymentStatus(free, { ...(reserved ? { promotion: RESERVED_USE } : {}), ...over }));
  w.afterCancel = free;
  return w;
}
const returnAttempt = (over: Partial<NonNullable<CustomerWorld['attempt']>> = {}): NonNullable<CustomerWorld['attempt']> =>
  ({ attemptId: ATTEMPT_ID, state: 'OPEN', errorCode: null, observedAt: FIXED_NOW, paymentState: 'PENDING', applyState: 'NONE', invoiceReference: null, ...over });
const RETURN_PAGE = `/billing/return?attempt=${ATTEMPT_ID}`;
/** A one-time Starter that is still running and buys the same package again with the promotion: the shop whose package facts stay on screen while its payment is open. */
const runningShopWorld = (companyId: string, over: Partial<BillingStatus> = {}) => {
  const { w: free, previous } = repeatWorld(companyId), w = openWorld(companyId, { ...free.status, allowedActions: ['new_sales'] }, over);
  w.purchase = 'REPEAT';
  return { w, previous };
};

// `banner` = the sentence of the shell's banner for a shop with no package (never a green button there); `noBox` = no "แพ็กเกจ / ยังไม่มีแพ็กเกจ" box under the heading (the badge already says it);
// `hint` = the invitation that stays where no payment is in flight; `promoBox` = the promotion's own green box; `reference` = the collapsed reference for the team, last in the card.
type PendingCase = { key: string; title: string; world: (companyId: string) => CustomerWorld; route?: string; block: Block | null; hint?: string; generic: boolean; promoBox: boolean; reference: boolean;
  banner: string | null; noBox?: boolean; facts?: string[] };
const PENDING_CASES: PendingCase[] = [
  { key: 'open-reserved', title: 'an unpaid payment page is open and holds the promotion, the shop has no package yet (the owner\'s screen)', world: c => openWorld(c, freeShop(c)),
    block: { heading: OPEN_TITLE, title: null, intro: [UNPAID_PAGE, RESERVED_LINE], steps: [CONTINUE_OPEN, CHECK_CLAIM, cancelOneTap(RIGHT_BACK)] },
    generic: false, promoBox: false, reference: true, banner: BANNER_NONE, noBox: true },
  { key: 'open-plain', title: 'the same without a promotion', world: c => openWorld(c, newShopStatus(c, { promotions: undefined }), {}, false),
    block: { heading: OPEN_TITLE, title: null, intro: [UNPAID_PAGE], steps: [CONTINUE_OPEN, CHECK_CLAIM, cancelOneTap()] },
    generic: false, promoBox: false, reference: true, banner: BANNER_NONE, noBox: true },
  { key: 'open-running', title: 'the same for a shop whose package runs: its facts stay, and the cancel choice says the package does not change', world: c => runningShopWorld(c).w,
    block: { heading: OPEN_TITLE, title: null, intro: [UNPAID_PAGE, RESERVED_LINE], steps: [CONTINUE_OPEN, CHECK_CLAIM, cancelOneTap(RIGHT_BACK, PACKAGE_KEPT)] },
    generic: false, promoBox: false, reference: true, banner: null, facts: ['เริ่มต้น (STARTER)', thaiDay('2026-10-25T05:00:00.000Z'), '20 ใบ', 'จ่ายครั้งเดียว'] },
  { key: 'unknown', title: 'the outcome is unknown: the check leads, paying again only when sure, ending asks first', world: c => openWorld(c, freeShop(c), { paymentState: 'UNKNOWN' }),
    block: { heading: OPEN_TITLE, title: null, intro: ['ระบบยังยืนยันผลการชำระเงินรายการนี้ไม่ได้', RESERVED_LINE],
      steps: [checkOnly(CHECK_CAUTION, true), { label: 'ชำระเงินต่อ', captions: [CONTINUE_CAUTION] }, cancelAsking(`ถ้ายังไม่ได้ชำระ ${RIGHT_BACK}`)] },
    generic: false, promoBox: false, reference: true, banner: BANNER_NONE, noBox: true },
  { key: 'action-required', title: 'the payment page needs one more step: continue first', world: c => openWorld(c, freeShop(c), { paymentState: 'ACTION_REQUIRED' }, false),
    block: { heading: OPEN_TITLE, title: null, intro: ['การชำระเงินรายการนี้ยังต้องทำขั้นตอนเพิ่มที่หน้าชำระเงิน'],
      steps: [{ label: 'ชำระเงินต่อ', green: true, captions: ['เปิดหน้าชำระเงินเดิมเพื่อทำขั้นตอนที่เหลือให้เสร็จ'] },
        { label: 'ตรวจผลการชำระเงิน', captions: ['กดเมื่อทำขั้นตอนที่หน้าชำระเงินเสร็จแล้วแต่หน้านี้ยังไม่เปลี่ยน'] }, cancelAsking()] },
    generic: false, promoBox: false, reference: true, banner: BANNER_NONE, noBox: true },
  { key: 'waiting', title: 'back from the payment page and the first answer is pending: the heading says it, the block adds that the page checks by itself, and one quiet check', route: RETURN_PAGE,
    world: c => { const w = openWorld(c, freeShop(c)); w.attempt = returnAttempt({ promotion: RESERVED_USE }); return w; },
    block: { heading: WAITING_HEADING, title: null, intro: [AUTO, RESERVED_LINE], steps: [checkOnly('กดเมื่ออยากให้ตรวจผลทันที')] },
    generic: false, promoBox: false, reference: true, banner: BANNER_NONE, noBox: true },
  { key: 'waiting-running', title: 'the same for a shop whose package runs: the same words, there is no second version', route: RETURN_PAGE,
    world: c => { const { w } = runningShopWorld(c); w.attempt = returnAttempt({ promotion: RESERVED_USE }); return w; },
    block: { heading: WAITING_HEADING, title: null, intro: [AUTO, RESERVED_LINE], steps: [checkOnly('กดเมื่ออยากให้ตรวจผลทันที')] },
    generic: false, promoBox: false, reference: true, banner: null },
  { key: 'received-applying', title: 'the money is received and the package is being applied: the check alone, never a way to pay again',
    world: c => defaultCustomerWorld(c, newShopStatus(c, { paymentState: 'PAID', applyState: 'PENDING', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, canCancelCheckout: false, purchaseBlockCode: 'BILLING_CHECKOUT_PENDING',
      allowedActions: [], promotions: undefined })),
    block: { heading: null, title: RECEIVED_TITLE, intro: [], steps: [checkOnly('กดเมื่ออยากตรวจผลล่าสุด')] },
    generic: false, promoBox: false, reference: true, banner: BANNER_NONE, noBox: true },
  { key: 'received-renewal', title: 'paid and running, the renewal is still being set up: the promotion\'s own box says it, the block has no title and the check alone',
    world: c => defaultCustomerWorld(c, paidShopStatus(c, { promotion: promotionUse({ renewalSetupState: 'PENDING' }), subscriptionState: 'NONE', nextChargeAt: null, allowedActions: [] })),
    block: { heading: null, title: null, intro: [], steps: [checkOnly('กดเมื่ออยากตรวจผลล่าสุด')] },
    generic: false, promoBox: true, reference: false, banner: null, facts: ['แพ็กเกจปัจจุบัน'] },
  { key: 'last-result-failed', title: 'a renewal charge failed (past due): the card heading says so, the block is the check alone',
    world: c => defaultCustomerWorld(c, paidShopStatus(c, { paymentState: 'FAILED', subscriptionState: 'past_due', allowedActions: ['portal_payment_method', 'portal_cancel_subscription'] })),
    block: { heading: null, title: LAST_TITLE, intro: [], steps: [checkOnly('กดเมื่อจ่ายเงินแล้ว เพื่อตรวจผลล่าสุดอีกครั้ง')] },
    generic: false, promoBox: false, reference: true, banner: null, facts: ['เรียกเก็บเงินไม่สำเร็จ'] },
  { key: 'checking', title: 'a payment is in flight and has no page to resume or end yet: the heading says it is being checked, the block says do not start another',
    world: c => openWorld(c, freeShop(c), { canCancelCheckout: false }, false),
    block: { heading: CHECKING_HEADING, title: null, intro: [ASKING], steps: [checkOnly('กดเพื่อให้ระบบตรวจผลล่าสุดกับผู้ให้บริการรับชำระเงิน')] },
    generic: false, promoBox: false, reference: true, banner: BANNER_NONE, noBox: true },
  { key: 'last-result-old-paid', title: 'an old paid record on a shop whose package ran out: the check stays, and the way to a new purchase stays too', hint: 'เลือกแพ็กเกจเพื่อใช้งานต่อ',
    world: c => defaultCustomerWorld(c, paidShopStatus(c, { accessState: 'EXPIRED', lockReason: 'trial_ended', termEndsAt: inDays(-3), paidThrough: inDays(-3), subscriptionState: 'canceled', nextChargeAt: null,
      allowedActions: ['new_sales'], promotions: promotionRows() })),
    block: { heading: null, title: LAST_TITLE, intro: [], steps: [checkOnly('ให้ระบบถามผู้ให้บริการรับชำระเงินอีกครั้งว่ามีผลล่าสุดหรือไม่')] },
    generic: true, promoBox: false, reference: true, banner: BANNER_EXPIRED },
  { key: 'none', title: 'no payment at all: exactly the single button, as before', world: c => defaultCustomerWorld(c), block: null, hint: 'เลือกแพ็กเกจเพื่อเริ่มใช้งาน', generic: true, promoBox: false, reference: false, banner: BANNER_NONE },
];

for (const width of WIDTHS) for (const state of PENDING_CASES) {
  test(`PENDING ${state.key}: ${state.title} at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = state.world(companyId);
    await openOverview(page, w, width, state.route);
    const card = regionNamed(page, 'สถานะแพ็กเกจ');
    await expect(card).toBeVisible();
    if (state.block) await expectBlock(page, state.block);
    else await expect(page.getByRole('region', { name: new RegExp(`^(${BLOCK_NAMES.join('|')})$`) })).toHaveCount(0);
    // the old loose buttons are gone in every state
    for (const old of OLD_LABELS) await expect(page.getByRole('button', { name: old, exact: true }), old).toHaveCount(0);
    // the generic "choose a package" button exists only where no payment is open or in flight
    await expect(page.getByRole('button', { name: GENERIC_BUTTON })).toHaveCount(state.generic ? 1 : 0);
    // what gave way in round 4: the pointers, the old paragraph, the intro of a failed block, the amber alert, the no-package box while a payment is in flight
    if (state.hint) await expect(page.getByText(state.hint, { exact: true })).toBeVisible();
    if (state.block && !state.generic) for (const invitation of INVITATIONS) await expect(page.getByText(invitation, { exact: true }), invitation).toHaveCount(0);
    for (const gone of GONE_TEXT) await expect(page.getByText(gone, { exact: true }), gone).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'ระบบกำลังตรวจรายการชำระเงินเดิม' }), 'the amber "checking" alert').toHaveCount(0);
    if (state.noBox) await expect(card.locator('dt', { hasText: /^แพ็กเกจ$/ }), 'the no-package box').toHaveCount(0);
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' }), 'the separate promotion box').toHaveCount(state.promoBox ? 1 : 0);
    // the shell's banner: only what is the matter (an exact match, so no " · เลือกแพ็กเกจ…" after it), and never a "เลือกแพ็กเกจ" link on the package page or the return page
    if (state.banner) await expect(page.getByText(state.banner, { exact: true }), 'the banner').toBeVisible();
    await expect(page.getByRole('link', { name: 'เลือกแพ็กเกจ', exact: true }), 'the banner\'s button').toHaveCount(0);
    for (const fact of state.facts ?? []) await expect(card).toContainText(fact);
    // at most one green button on the WHOLE screen (the shell's banner included), and it is the one the block (or, with no payment, the page) leads with
    const wanted = [...(state.block?.steps.filter(step => step.green).map(step => step.label) ?? [])];
    if (state.generic) wanted.push((await page.getByRole('button', { name: GENERIC_BUTTON }).textContent())!.trim());
    expect(await greenControls(page, 'screen'), 'solid green controls on the whole screen').toEqual(wanted);
    expect(wanted.length).toBeLessThanOrEqual(1);
    if (state.reference) await expectReferenceLast(page, state.block ? blockName(state.block) : null);
    else await expect(page.getByText('เลขอ้างอิงสำหรับแจ้งทีมงาน', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    // The owner's state: where the first choice ends, measured at the top of the page (the first screen is what a buyer sees before scrolling).
    if (state.key === 'open-reserved') {
      const box = (await ownerBlock(page).getByRole('button', { name: 'ชำระเงินต่อ', exact: true }).boundingBox())!, height = page.viewportSize()!.height, bottom = Math.round(box.y + box.height);
      wire(info, 'continue-button-box', width, { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), bottom, viewportHeight: height, insideFirstScreen: bottom <= height });
      // measured in round 4: at 390x844 it ends at y=819 and at 1280x900 at y=607, so the first choice is on the first screen at both widths (this local stack also shows the preview button and the TEST badge)
      expect(bottom, `"ชำระเงินต่อ" ends inside the ${width}x${height} first screen`).toBeLessThanOrEqual(height);
    }
    await firstScreen(page, info, width, `pending-${state.key}`);
    await settle(page, info, width, `pending-${state.key}`);
  });
}

// ---- pressing each choice sends the request it always sent, and the answer is where the buyer is looking ----

const sent = (w: CustomerWorld) => w.log.calls.map(({ method, path, body }) => ({ method, path, body }));
const ownerWorld = (companyId: string) => openWorld(companyId, freeShop(companyId));
const ownerBlock = (page: Page) => regionNamed(page, OPEN_TITLE);

for (const width of WIDTHS) {
  test(`PENDING the owner's state, "ชำระเงินต่อ": resumes the same payment and goes to its payment page at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = ownerWorld(companyId);
    await openOverview(page, w, width);
    await ownerBlock(page).getByRole('button', { name: 'ชำระเงินต่อ', exact: true }).click();
    await page.waitForURL(/checkout\.stripe\.com/);
    expect(sent(w)).toEqual([{ method: 'POST', path: `/attempts/${ATTEMPT_ID}/resume`, body: {} }]);
    expect(w.log.calls[0]!.key).toBeNull();
    wire(info, 'press-continue-resume-request', width, w.log.calls);
  });

  test(`PENDING the owner's state, "ชำระแล้ว ตรวจผลการชำระเงิน": asks the provider for the result and says so right under the choice, then "อัปเดตข้อมูล" shows the paid package at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = ownerWorld(companyId);
    await openOverview(page, w, width);
    const block = ownerBlock(page), reads = w.log.statusReads, text = 'ส่งคำขอตรวจสอบแล้ว ยังไม่ใช่ผลยืนยันการชำระเงิน กดอัปเดตข้อมูลเพื่อดูผลภายหลัง';
    await block.getByRole('button', { name: 'ชำระแล้ว ตรวจผลการชำระเงิน', exact: true }).click();
    const notice = block.getByRole('status').filter({ hasText: text });
    await expect(notice).toBeVisible();
    expect(sent(w)).toEqual([{ method: 'POST', path: '/refresh', body: {} }]);
    wire(info, 'press-check-refresh-request', width, w.log.calls);
    await page.waitForTimeout(600);
    wire(info, 'press-check-notice-position', width, await inViewNow(notice));
    // the answer sits inside the choice that was pressed (the second), with its own "อัปเดตข้อมูล"; the status was read again straight away
    const second = block.locator(':scope > ol > li').nth(1);
    await expect(second).toContainText(text);
    await expect(second.getByRole('button', { name: 'อัปเดตข้อมูล', exact: true })).toBeVisible();
    expect(w.log.statusReads).toBeGreaterThan(reads);
    await firstScreen(page, info, width, 'pending-owner-after-check');
    await settle(page, info, width, 'pending-owner-after-check');
    // the money arrived meanwhile: "อัปเดตข้อมูล" shows the paid package, and the block is gone
    w.status = paidShopStatus(companyId, { promotion: promotionUse() }); w.attempt = null;
    await second.getByRole('button', { name: 'อัปเดตข้อมูล', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'แพ็กเกจปัจจุบัน', exact: true })).toBeVisible();
    await expect(block).toHaveCount(0);
  });

  test(`PENDING the owner's state, "ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่": ends the payment in one tap, gives the right back, says so in sight and opens the choice at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = ownerWorld(companyId);
    await openOverview(page, w, width);
    await ownerBlock(page).getByRole('button', { name: 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่', exact: true }).click();
    const notice = page.getByRole('status').filter({ hasText: 'ยกเลิกรายการเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย' });
    await expect(notice).toBeVisible();
    expect(sent(w)).toEqual([{ method: 'POST', path: `/attempts/${ATTEMPT_ID}/cancel`, body: {} }]);
    expect(w.log.calls[0]!.key).toBeNull();
    wire(info, 'press-cancel-request', width, w.log.calls);
    // the payment, its block and its reserved right are gone; the choice of packages is open and the promotion is on offer again
    await expect(ownerBlock(page)).toHaveCount(0);
    await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toBeVisible();
    await expect(starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toBeVisible();
    await page.waitForTimeout(600);
    wire(info, 'press-cancel-notice-position', width, await inViewNow(notice));
    await firstScreen(page, info, width, 'pending-owner-after-cancel');
    await settle(page, info, width, 'pending-owner-after-cancel');
  });

  // UAT 2026-10-10: for 3-5 seconds after the cancel succeeded the notice "ยกเลิกรายการเดิมแล้ว …" stood above the old block ("มีรายการชำระเงินที่ยังไม่เสร็จ", the reserved right, the three choices) until the read that
  // follows landed. The status on screen is stale the moment the call succeeds, so the page draws its loading line instead of the card until a fresher status arrives. Here that read is held back, so the
  // moment is on screen for as long as the test wants to look at it (the fixture's `statusHold`); both ways of ending a payment, at both widths.
  const ended = (page: Page) => page.getByRole('status').filter({ hasText: /ยกเลิกรายการ(?:เดิม)?แล้ว เลือกแพ็กเกจใหม่ได้/ });
  const staleButtons = (page: Page) => page.getByRole('button', { name: /^(ชำระเงินต่อ|ชำระแล้ว ตรวจผลการชำระเงิน|ตรวจผลการชำระเงิน|ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่|ยกเลิกรายการนี้|ยืนยันยกเลิกรายการนี้)$/ });
  for (const way of ['one tap', 'confirmed'] as const)
    test(`PENDING ending the payment (${way}): while the read after it is on its way the old block is not on screen beside the notice, and the chooser opens when it lands at ${width}px`, async ({ authedPage: page, companyId }, info) => {
      const w = way === 'one tap' ? ownerWorld(companyId) : openWorld(companyId, freeShop(companyId), { paymentState: 'UNKNOWN' });
      let release!: () => void;
      w.statusHold = new Promise<void>(resolve => { release = resolve; });
      await openOverview(page, w, width);
      const block = ownerBlock(page);
      await expect(block).toBeVisible();
      if (way === 'one tap') await block.getByRole('button', { name: 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่', exact: true }).click();
      else { await block.getByRole('button', { name: 'ยกเลิกรายการนี้', exact: true }).click(); await block.getByRole('button', { name: 'ยืนยันยกเลิกรายการนี้', exact: true }).click(); }
      await expect(ended(page)).toBeVisible();
      // the notice is up and the read has not answered: the block and every choice of it are gone, the loading line stands where the card was
      await expect(block).toHaveCount(0);
      await expect(staleButtons(page)).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'กำลังตรวจสอบสิทธิ์และรายการชำระเงิน' })).toBeVisible();
      await expect(page.getByText('มีรายการชำระเงินที่ยังไม่เสร็จ', { exact: true })).toHaveCount(0);
      await page.waitForTimeout(1500);
      await expect(block).toHaveCount(0);
      await expect(ended(page)).toBeVisible();
      await firstScreen(page, info, width, `pending-${way.replace(' ', '-')}-while-ending`);
      release();
      // the answer lands: the card the status describes, the chooser open, the notice still in sight
      await expect(page.getByRole('status').filter({ hasText: 'กำลังตรวจสอบสิทธิ์และรายการชำระเงิน' })).toHaveCount(0);
      await expect(block).toHaveCount(0);
      if (way === 'one tap') await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toBeVisible(); else await expect(page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true })).toBeVisible();
      await expect(ended(page)).toBeVisible();
      await settle(page, info, width, `pending-${way.replace(' ', '-')}-after-ending`);
    });

  // FXE-D12 (fixed in web round 4): the answer of the check ("ส่งคำขอตรวจสอบแล้ว …", with its own "อัปเดตข้อมูล") is one status container with a ref, focus and a `scrollIntoView({ block: 'nearest' })` like the other
  // notices. At 1280x900 the choice sits at the bottom of the first screen without any scrolling (its button ends at y=891 of 900), so the answer used to land at y=931, below the fold. Here the button is
  // put at the bottom edge of the screen (the worst place, and the natural one on a desktop).
  test(`PENDING the owner's state: the answer of "ชำระแล้ว ตรวจผลการชำระเงิน" is in sight even when the button was at the bottom edge of the screen at ${width}px`, async ({ authedPage: page, companyId }) => {
    const w = ownerWorld(companyId);
    await openOverview(page, w, width);
    const block = ownerBlock(page), button = block.getByRole('button', { name: 'ชำระแล้ว ตรวจผลการชำระเงิน', exact: true });
    await button.evaluate(el => { window.scrollBy(0, el.getBoundingClientRect().bottom - window.innerHeight + 8); });
    await button.click();
    const notice = block.getByRole('status').filter({ hasText: 'ส่งคำขอตรวจสอบแล้ว' });
    await expect(notice).toBeVisible();
    await page.waitForTimeout(600);
    const seen = await inViewNow(notice);
    expect(seen.visibleToBuyer, JSON.stringify(seen)).toBe(true);
  });

  // FXE-D13 (fixed in web round 4): after the one-tap cancel the choice of packages opens a read later and its heading scrolled past the notice that says so ("ยกเลิกรายการเดิมแล้ว …"; it ended 63px above
  // a 390x844 screen, 91px above 1280x900); the reopening now bumps a counter in the same batch so the notice effect runs again and is the last to scroll.
  test(`PENDING the owner's state: the notice after "ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่" is still in sight once the choice of packages has opened at ${width}px`, async ({ authedPage: page, companyId }) => {
    const w = ownerWorld(companyId);
    await openOverview(page, w, width);
    await ownerBlock(page).getByRole('button', { name: 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่', exact: true }).click();
    const notice = page.getByRole('status').filter({ hasText: 'ยกเลิกรายการเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย' });
    await expect(notice).toBeVisible();
    await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toBeVisible();
    await page.waitForTimeout(600);
    const seen = await inViewNow(notice);
    expect(seen.visibleToBuyer, JSON.stringify(seen)).toBe(true);
  });

  // FXE-D11 (fixed in web round 4): the shell's banner for a shop with no package kept its own green "เลือกแพ็กเกจ" and "… เลือกแพ็กเกจเพื่อเริ่มใช้งาน" on the package page while a payment was open or its money
  // received: the first and biggest green button of the screen at 390, above "ชำระเงินต่อ". On every billing page it is now only what is the matter, with no button (UAT 2026-10-10: the return page too).
  for (const key of ['open-reserved', 'received-applying'] as const) test(`PENDING ${key}: the shell's banner does not offer a second "เลือกแพ็กเกจ": one green button on the whole screen at ${width}px`, async ({ authedPage: page, companyId }) => {
    const state = PENDING_CASES.find(item => item.key === key)!;
    await openOverview(page, state.world(companyId), width);
    await expectBlock(page, state.block!);
    expect(await greenControls(page, 'screen'), 'green controls on the whole screen, the shell included').toEqual(state.block!.steps.filter(step => step.green).map(step => step.label));
  });

  test(`PENDING outcome unknown: ending asks first, "ยังไม่ยกเลิก" leaves everything as it was, "ยืนยันยกเลิกรายการนี้" ends it and says so in sight at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = openWorld(companyId, freeShop(companyId), { paymentState: 'UNKNOWN' });
    await openOverview(page, w, width);
    const block = ownerBlock(page), end = block.getByRole('button', { name: 'ยกเลิกรายการนี้', exact: true }), ask = block.locator(':scope > ol > li').nth(2);
    await end.click();
    await expect(ask).toContainText('ยกเลิกรายการนี้ใช่ไหม? ระบบจะตรวจผลกับผู้ให้บริการรับชำระเงินก่อน จึงเริ่มเลือกแพ็กเกจใหม่ได้');
    await expect(ask.getByRole('button')).toHaveText(['ยืนยันยกเลิกรายการนี้', 'ยังไม่ยกเลิก']);
    expect(w.log.cancels, 'asking sends nothing').toBe(0);
    await settle(page, info, width, 'pending-unknown-asking');
    await ask.getByRole('button', { name: 'ยังไม่ยกเลิก', exact: true }).click();
    await expect(end).toBeVisible();
    await expect(ask.locator('p[id]')).toHaveCount(2);
    expect(w.log.cancels).toBe(0);
    await end.click();
    await ask.getByRole('button', { name: 'ยืนยันยกเลิกรายการนี้', exact: true }).click();
    const notice = page.getByRole('status').filter({ hasText: 'ยกเลิกรายการแล้ว เลือกแพ็กเกจใหม่ได้' });
    await expect(notice).toBeVisible();
    expect(sent(w)).toEqual([{ method: 'POST', path: `/attempts/${ATTEMPT_ID}/cancel`, body: {} }]);
    wire(info, 'press-cancel-confirmed-request', width, w.log.calls);
    await expect(block).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    const seen = await inViewNow(notice);
    wire(info, 'press-cancel-confirmed-notice-position', width, seen);
    expect(seen.visibleToBuyer, JSON.stringify(seen)).toBe(true);
    await firstScreen(page, info, width, 'pending-unknown-after-cancel');
  });

  test(`PENDING back from the payment page and waiting: the one choice asks the provider and says so right under itself at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = openWorld(companyId, freeShop(companyId));
    w.attempt = returnAttempt({ promotion: RESERVED_USE });
    await openOverview(page, w, width, RETURN_PAGE);
    const block = regionNamed(page, WAITING_HEADING);
    await expect(block).toBeVisible();
    const before = w.log.refreshes;
    await block.getByRole('button', { name: 'ตรวจผลการชำระเงิน', exact: true }).click();
    const notice = block.getByRole('status').filter({ hasText: 'ส่งคำขอตรวจสอบแล้ว' });
    await expect(notice).toBeVisible();
    await expect.poll(() => w.log.refreshes).toBeGreaterThan(before);
    await page.waitForTimeout(600);
    const seen = await inViewNow(notice);
    expect(seen.visibleToBuyer, JSON.stringify(seen)).toBe(true);
    wire(info, 'press-waiting-check', width, { seen, requests: w.log.calls.filter(call => call.path === '/refresh') });
    await expect(block.getByRole('button', { name: 'อัปเดตข้อมูล', exact: true })).toBeVisible();
    await settle(page, info, width, 'pending-waiting-after-check');
  });

  // The choices of every other open state send the same requests as the owner's: the check asks the provider (refresh), "ชำระเงินต่อ" resumes the same payment, whatever the state says about them.
  for (const key of ['action-required', 'unknown'] as const) test(`PENDING ${key}: "ตรวจผลการชำระเงิน" asks the provider and "ชำระเงินต่อ" resumes the same payment, the same requests as ever at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = PENDING_CASES.find(item => item.key === key)!.world(companyId);
    await openOverview(page, w, width);
    const block = ownerBlock(page);
    await block.getByRole('button', { name: 'ตรวจผลการชำระเงิน', exact: true }).click();
    await expect(block.getByRole('status').filter({ hasText: 'ส่งคำขอตรวจสอบแล้ว ยังไม่ใช่ผลยืนยันการชำระเงิน' })).toBeVisible();
    expect(sent(w)).toEqual([{ method: 'POST', path: '/refresh', body: {} }]);
    await block.getByRole('button', { name: 'ชำระเงินต่อ', exact: true }).click();
    await page.waitForURL(/checkout\.stripe\.com/);
    expect(sent(w)).toEqual([{ method: 'POST', path: '/refresh', body: {} }, { method: 'POST', path: `/attempts/${ATTEMPT_ID}/resume`, body: {} }]);
    wire(info, `press-${key}-requests`, width, w.log.calls);
  });

  // A shop whose package runs and that opened a payment for the same package again: ending that payment sends the same request, the package is not touched, and the promotion is on offer again.
  test(`PENDING a shop whose package runs: ending the extra payment is the same one-tap request, the right is back and the same package can be bought again at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const { w } = runningShopWorld(companyId);
    await openOverview(page, w, width);
    await ownerBlock(page).getByRole('button', { name: 'ยกเลิกรายการนี้ แล้วเลือกแพ็กเกจใหม่', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'ยกเลิกรายการเดิมแล้ว เลือกแพ็กเกจใหม่ได้เลย' })).toBeVisible();
    expect(sent(w)).toEqual([{ method: 'POST', path: `/attempts/${ATTEMPT_ID}/cancel`, body: {} }]);
    wire(info, 'press-running-cancel-request', width, w.log.calls);
    await expect(ownerBlock(page)).toHaveCount(0);
    await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toBeVisible();
    await expect(buyStarter(page)).toBeEnabled();
    await expect(starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toBeVisible();
    await expect(starterOf(page)).toContainText('แพ็กเกจปัจจุบัน');
  });

  // The wait for the payment page's answer gives up after 3 minutes: the block changes from the quiet check to the full set, the check first (the buyer may well have paid).
  test(`PENDING the wait for the answer gave up (3 minutes): the check leads, paying again only when sure at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = openWorld(companyId, freeShop(companyId));
    w.attempt = returnAttempt({ promotion: RESERVED_USE });
    await installCustomerRoutes(page, w);
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.clock.install({ time: new Date(FIXED_NOW) });
    await page.goto(`/companies/${companyId}${RETURN_PAGE}`);
    await expect(regionNamed(page, WAITING_HEADING)).toBeVisible();
    await page.clock.fastForward(185_000);
    await expectBlock(page, { heading: OPEN_TITLE, title: null, intro: [`กลับจากหน้าชำระเงินแล้ว แต่ระบบยังยืนยันผลการชำระเงินไม่ได้ ${CONTACT}`, RESERVED_LINE],
      steps: [checkOnly(CHECK_CAUTION, true), { label: 'ชำระเงินต่อ', captions: [CONTINUE_CAUTION] }, cancelOneTap(RIGHT_BACK)] });
    // the old paragraph beside the block is gone: the way out (the team) is said once, in the block's first sentence
    await expect(page.getByText('ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการเดิมก่อนชำระใหม่ หรือติดต่อทีมงานพร้อมเลขอ้างอิง', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: GENERIC_BUTTON })).toHaveCount(0);
    expect(await greenControls(page)).toEqual(['ตรวจผลการชำระเงิน']);
    await firstScreen(page, info, width, 'pending-gave-up');
    await settle(page, info, width, 'pending-gave-up');
  });
}

/* ================================================================ Admin: /system/billing/campaigns ================================================================ */

/** The seeded system admin signs in through the real form (the /system layout checks the session on the server); the campaign API is simulated. */
async function adminOpen(page: Page, w: AdminWorld, width: number, path: string) {
  await installAdminRoutes(page, w);
  await page.goto('/login');
  await page.locator('#login-identifier').fill(SEED_USERS.systemAdmin.username);
  await page.locator('#login-password').fill(SEED_USERS.systemAdmin.password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
  await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/|system\/)/);
  await ensureBrowserLegalAcceptance(page.context());
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await page.goto(path);
}
const callsTo = (w: AdminWorld, method: string, pattern: RegExp) => w.calls.filter(call => call.method === method && pattern.test(call.path));
const KEY = /^billing-campaign-draft-[0-9a-f-]{36}$/;
/** Two causes share this code: the campaign's own fields, and a catalog that no longer matches the template (which editing the campaign cannot fix). */
const INVALID_TEXT = 'ข้อมูลแคมเปญไม่ตรงกับแบบตั้งต้น ตรวจชื่อ ช่วงเวลา และรอบที่เลือก อีกสาเหตุคือแพ็กเกจเริ่มต้นไม่ตรงกับแบบตั้งต้น ซึ่งใช้ได้เฉพาะเมื่อราคารายเดือน 249 บาท และใบเสร็จ 30 ใบต่อเดือน 360 ใบต่อปี เรื่องนี้แก้ที่แคมเปญไม่ได้ เมื่อแก้ครบแล้วให้ตรวจสอบก่อนเปิดอีกครั้ง';
const articleOf = (page: Page, name: string) => page.getByRole('article', { name, exact: true });

/** One campaign in each of the seven statuses the list can show. */
function everyStatusWorld(over: Partial<Parameters<typeof newAdminWorld>[0]> = {}): AdminWorld {
  const w = newAdminWorld(over);
  const base = (internalName: string, displayName: string, over2: Partial<ReturnType<typeof publishedCampaign>> = {}) =>
    publishedCampaign({ campaignId: `camp-${internalName}`, internalName, displayName, ...over2 });
  const draftOnly = completeDraft('camp-draft', { internalName: 'ร่าง Starter ธ.ค.', displayName: 'โปรปลายปี', rules: STARTER_RULES.slice(0, 1) });
  addCampaign(w, { campaignId: 'camp-draft', draft: { operationId: 'd1', version: 1, values: draftOnly } });
  addCampaign(w, { campaignId: 'camp-await', draft: { operationId: 'd2', version: 1, values: completeDraft('camp-await', { internalName: 'รออนุมัติ พ.ย.', displayName: 'โปร พ.ย.' }) },
    operation: openOperation({ state: 'AWAITING_APPROVAL', allowedActions: ['approve', 'cancel'] }) });
  addCampaign(w, { campaignId: 'camp-scheduled', published: base('ตั้งเวลา Black Friday', 'โปร Black Friday', { startsAt: '2026-11-20T03:00:00.000Z', endsAt: '2026-11-30T16:59:00.000Z', cap: 50 }) });
  addCampaign(w, { campaignId: 'camp-active', published: base('Starter แถมเดือน ต.ค. 2569', CAMPAIGN_NAME, { cap: 100 }), usage: { reserved: 3, consumed: 42 } });
  addCampaign(w, { campaignId: 'camp-paused', published: base('พักไว้ก่อน ก.ย.', 'โปร ก.ย.', { paused: true, cap: null, startsAt: '2026-09-15T03:00:00.000Z', endsAt: '2026-10-20T16:59:00.000Z' }), usage: { reserved: 0, consumed: 12 } });
  addCampaign(w, { campaignId: 'camp-ended', published: base('จบแล้ว ส.ค.', 'โปร ส.ค.', { endedAt: '2026-08-31T10:00:00.000Z', startsAt: '2026-08-01T03:00:00.000Z', endsAt: '2026-08-31T16:59:00.000Z', cap: 30 }), usage: { reserved: 0, consumed: 30 } });
  addCampaign(w, { campaignId: 'camp-stale', published: base('ราคาเปลี่ยน ต.ค.', 'โปรราคาเก่า', { cap: 20 }), stale: true, usage: { reserved: 1, consumed: 4 } });
  return w;
}
const EVERY_STATUS = [
  { title: 'ร่าง Starter ธ.ค.', label: 'ร่าง', usage: 'ยังไม่เปิดให้ใช้สิทธิ์' }, { title: 'รออนุมัติ พ.ย.', label: 'รออนุมัติ', usage: 'ยังไม่เปิดให้ใช้สิทธิ์' },
  { title: 'ตั้งเวลา Black Friday', label: 'ตั้งเวลาแล้ว', usage: '0 / 50' }, { title: 'Starter แถมเดือน ต.ค. 2569', label: 'กำลังใช้งาน', usage: '45 / 100' },
  { title: 'พักไว้ก่อน ก.ย.', label: 'พัก', usage: '12 / ไม่จำกัด' }, { title: 'จบแล้ว ส.ค.', label: 'จบแล้ว', usage: '30 / 30' }, { title: 'ราคาเปลี่ยน ต.ค.', label: 'ต้องตรวจแพ็กเกจใหม่', usage: '5 / 20' },
] as const;

for (const width of WIDTHS) {
  test(`PROMO-09 the list: empty state, create link, TEST marker at ${width}px`, async ({ page }, info) => {
    const w = newAdminWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns');
    await expect(page.getByRole('heading', { name: 'แคมเปญโปรโมชั่น', level: 1 })).toBeVisible();
    await expect(page.getByText('ยังไม่มีแคมเปญโปรโมชั่น', { exact: true })).toBeVisible();
    await expect(page.getByText('โหมดทดสอบ · ไม่มีการรับเงินจริง', { exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'แสดง 0 จาก 0 แคมเปญ' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'สร้างแคมเปญ', exact: true }).first()).toHaveAttribute('href', '/system/billing/campaigns/new');
    await expect(page.getByRole('search')).toHaveCount(0);
    await settle(page, info, width, 'promo09-empty');
  });

  test(`PROMO-09 the list: a row in every status, Thai labels, Thai-time window, used / cap, TEST marker at ${width}px`, async ({ page }, info) => {
    const w = everyStatusWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns');
    await expect(page.getByRole('status').filter({ hasText: 'แสดง 7 จาก 7 แคมเปญ' })).toBeVisible();
    for (const item of EVERY_STATUS) {
      const row = articleOf(page, item.title);
      await expect(row, item.title).toBeVisible();
      await expect(row.locator('span').filter({ hasText: new RegExp(`^${item.label}$`) })).toBeVisible();
      await expect(row.locator('span').filter({ hasText: 'โหมดทดสอบ' })).toBeVisible();
      await expect(row.locator('dd').nth(2)).toHaveText(item.usage);
    }
    const active = articleOf(page, 'Starter แถมเดือน ต.ค. 2569');
    await expect(active).toContainText(`ชื่อที่ลูกค้าเห็น: ${CAMPAIGN_NAME}`);
    await expect(active.locator('dd').nth(0)).toHaveText(`${thaiDateTime('2026-10-01T03:00:00.000Z')} ถึง ${thaiDateTime('2026-10-31T16:59:00.000Z')}`);
    await expect(active.locator('dd').nth(1)).toHaveText('เริ่มต้น (STARTER) · รายเดือนและรายปี');
    await expect(articleOf(page, 'ร่าง Starter ธ.ค.').locator('dd').nth(1)).toHaveText('เริ่มต้น (STARTER) · รายเดือน');
    await expect(articleOf(page, 'Starter แถมเดือน ต.ค. 2569').getByRole('link')).toHaveAttribute('href', '/system/billing/campaigns/camp-active');
    // the TEST chip is neutral (white, gray border): it never wears the amber of a status chip such as "พัก"
    const chip = (title: string, text: RegExp) => articleOf(page, title).locator('span').filter({ hasText: text }).evaluate(el => { const style = getComputedStyle(el); return { background: style.backgroundColor, border: style.borderTopColor }; });
    const testChip = await chip('พักไว้ก่อน ก.ย.', /^โหมดทดสอบ/), pausedChip = await chip('พักไว้ก่อน ก.ย.', /^พัก$/);
    expect(testChip.background).toBe('rgb(255, 255, 255)');
    expect(pausedChip.background).not.toBe(testChip.background);
    for (const item of EVERY_STATUS) expect(await chip(item.title, /^โหมดทดสอบ/), item.title).toEqual(testChip);
    wire(info, 'chips', width, { test: testChip, paused: pausedChip });
    await settle(page, info, width, 'promo09-every-status');
  });

  test(`PROMO-09 the list: a LIVE campaign never looks like a TEST one at ${width}px`, async ({ page }, info) => {
    const w = everyStatusWorld({ mode: 'LIVE' });
    await adminOpen(page, w, width, '/system/billing/campaigns');
    await expect(page.getByText('ใช้งานจริง · ลูกค้าจ่ายเงินจริง', { exact: true })).toBeVisible();
    await expect(articleOf(page, 'Starter แถมเดือน ต.ค. 2569').locator('span').filter({ hasText: 'ใช้งานจริง' })).toBeVisible();
    await expect(page.getByText(/โหมดทดสอบ/)).toHaveCount(0);
    await settle(page, info, width, 'promo09-live');
  });

  // UAT 2026-10-10: an ACTIVE campaign with cap 5 and 5 rights used still said "ร้านที่เข้าเงื่อนไขเลือกใช้สิทธิ์ตอนซื้อแพ็กเกจได้", while every shop gets CAP_FULL. Used + reserved >= cap says the rights are
  // all taken (billing-campaigns.logic.ts campaignCapFullText), on the list row and on the detail page alike, and a reservation among them is told with what its cancel gives back.
  const ALL_TAKEN = 'สิทธิ์ครบจำนวนแล้ว (5 จาก 5) ร้านที่ยังไม่ได้จองสิทธิ์เลือกใช้โปรโมชั่นนี้ไม่ได้ ส่วนการซื้อแพ็กเกจแบบปกติเป็นไปตามเดิม';
  const RESERVED_TOLD = ' มี 1 สิทธิ์ที่จองไว้กับรายการชำระที่ยังไม่เสร็จ รายการที่ถูกยกเลิกจะคืนสิทธิ์ให้ร้านอื่นใช้ได้';
  const STILL_OPEN = 'ร้านที่เข้าเงื่อนไขเลือกใช้สิทธิ์ตอนซื้อแพ็กเกจได้';
  test(`PROMO-09 an active campaign with every right taken says so on the list and on the detail page; one with a right left still says shops can choose it at ${width}px`, async ({ page }, info) => {
    const w = newAdminWorld();
    const capped = (campaignId: string, internalName: string, usage: { reserved: number; consumed: number }) =>
      addCampaign(w, { campaignId, published: publishedCampaign({ campaignId, internalName, cap: 5 }), usage });
    capped('camp-full', 'Starter สิทธิ์เต็ม', { reserved: 0, consumed: 5 });
    capped('camp-held', 'Starter จองครบ', { reserved: 1, consumed: 4 });
    capped('camp-left', 'Starter ยังเหลือสิทธิ์', { reserved: 1, consumed: 3 });
    await adminOpen(page, w, width, '/system/billing/campaigns');
    await expect(page.getByRole('status').filter({ hasText: 'แสดง 3 จาก 3 แคมเปญ' })).toBeVisible();
    const full = articleOf(page, 'Starter สิทธิ์เต็ม'), held = articleOf(page, 'Starter จองครบ'), left = articleOf(page, 'Starter ยังเหลือสิทธิ์');
    await expect(full.locator('dd').nth(2)).toHaveText('5 / 5');
    await expect(full.locator('p').filter({ hasText: 'สิทธิ์ครบจำนวนแล้ว' })).toHaveText(ALL_TAKEN);
    await expect(held.locator('dd').nth(2)).toHaveText('5 / 5');
    await expect(held.locator('p').filter({ hasText: 'สิทธิ์ครบจำนวนแล้ว' })).toHaveText(ALL_TAKEN + RESERVED_TOLD);
    await expect(left.locator('dd').nth(2)).toHaveText('4 / 5');
    await expect(left).not.toContainText('สิทธิ์ครบจำนวนแล้ว');
    await settle(page, info, width, 'promo09-cap-full-list');
    for (const [id, text] of [['camp-full', ALL_TAKEN], ['camp-held', ALL_TAKEN + RESERVED_TOLD]] as const) {
      await page.goto(`/system/billing/campaigns/${id}`);
      await expect(page.getByText('กำลังใช้งาน', { exact: true }).first()).toBeVisible();
      await expect(page.locator('p.bg-gray-50').filter({ hasText: 'สิทธิ์ครบจำนวนแล้ว' })).toHaveText(text);
      await expect(page.getByText(STILL_OPEN, { exact: true })).toHaveCount(0);
      await settle(page, info, width, `promo09-cap-full-detail-${id}`);
    }
    await page.goto('/system/billing/campaigns/camp-left');
    await expect(page.getByText(STILL_OPEN, { exact: true })).toBeVisible();
    await expect(page.getByText('สิทธิ์ครบจำนวนแล้ว')).toHaveCount(0);
  });

  test(`PROMO-09 the list: search and the two filters narrow it, clear brings it back at ${width}px`, async ({ page }, info) => {
    const w = everyStatusWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns');
    const shown = page.getByRole('status').filter({ hasText: /^แสดง \d+ จาก 7 แคมเปญ$/ });
    await page.getByLabel('ค้นหาชื่อแคมเปญ').fill('black');
    await expect(shown).toHaveText('แสดง 1 จาก 7 แคมเปญ');
    await expect(articleOf(page, 'ตั้งเวลา Black Friday')).toBeVisible();
    await page.getByLabel('ค้นหาชื่อแคมเปญ').fill('โปร ก.ย.');
    await expect(shown).toHaveText('แสดง 1 จาก 7 แคมเปญ');
    await expect(articleOf(page, 'พักไว้ก่อน ก.ย.')).toBeVisible();
    await page.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
    await expect(shown).toHaveText('แสดง 7 จาก 7 แคมเปญ');
    await chooseThemedOption(page, page.getByRole('combobox', { name: 'สถานะ', exact: true }), 'พัก');
    await expect(shown).toHaveText('แสดง 1 จาก 7 แคมเปญ');
    await settle(page, info, width, 'promo09-filter-status');
    await page.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
    await chooseThemedOption(page, page.getByRole('combobox', { name: 'แพ็กเกจและรอบ', exact: true }), 'เริ่มต้น (STARTER) · รายปี');
    // the draft that only covers the monthly cycle is not a yearly campaign
    await expect(shown).toHaveText('แสดง 6 จาก 7 แคมเปญ');
    await expect(articleOf(page, 'ร่าง Starter ธ.ค.')).toHaveCount(0);
    await page.getByLabel('ค้นหาชื่อแคมเปญ').fill('ไม่มีชื่อนี้');
    await expect(page.getByText('ไม่พบแคมเปญตามตัวกรองนี้', { exact: true })).toBeVisible();
    await settle(page, info, width, 'promo09-no-match');
    await page.getByRole('button', { name: 'ล้างตัวกรอง' }).last().click();
    await expect(shown).toHaveText('แสดง 7 จาก 7 แคมเปญ');
  });

  test(`PROMO-09 the list: "สร้างแคมเปญ" only with the policy permission at ${width}px`, async ({ page }, info) => {
    const w = everyStatusWorld({ capabilities: READ_ONLY });
    // a view-only caller may not approve the request that is waiting either (the request's own answer for this caller lists nothing)
    w.campaigns.find(item => item.campaignId === 'camp-await')!.operation = openOperation({ state: 'AWAITING_APPROVAL', allowedActions: [] });
    await adminOpen(page, w, width, '/system/billing/campaigns');
    await expect(page.getByRole('status').filter({ hasText: 'แสดง 7 จาก 7 แคมเปญ' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'สร้างแคมเปญ' })).toHaveCount(0);
    await expect(page.getByText('บัญชีนี้ดูแคมเปญได้อย่างเดียว การสร้างแคมเปญต้องมีสิทธิ์ “ตั้งนโยบาย”')).toBeVisible();
    await settle(page, info, width, 'promo09-read-only');
  });

  test(`PROMO-09 the list: a load error offers a retry, a 403 does not, a closed billing system says so at ${width}px`, async ({ page }, info) => {
    const w = everyStatusWorld();
    // sticky: `next dev` runs a mount effect twice, and the first answer is thrown away
    failNext(w, 'GET promotion-campaigns', apiError(500, 'INTERNAL_SERVER_ERROR', 'boom'), true);
    await adminOpen(page, w, width, '/system/billing/campaigns');
    const alert = page.getByRole('alert').filter({ hasText: 'โหลดข้อมูลแคมเปญไม่ได้ กรุณาลองใหม่' });
    await expect(alert).toBeVisible();
    await expect(page.getByRole('link', { name: 'สร้างแคมเปญ' })).toHaveCount(0);
    await settle(page, info, width, 'promo09-load-error');
    w.faults.clear();
    await alert.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'แสดง 7 จาก 7 แคมเปญ' })).toBeVisible();
    await expect(alert).toHaveCount(0);

    failNext(w, 'GET promotion-campaigns', forbidden(), true);
    await page.getByRole('button', { name: 'โหลดรายการใหม่', exact: true }).click();
    const denied = page.getByRole('alert').filter({ hasText: 'บัญชีนี้ไม่มีสิทธิ์ดูแคมเปญโปรโมชั่น ต้องมีสิทธิ์ดูข้อมูลการชำระเงินระดับระบบ' });
    await expect(denied).toBeVisible();
    await expect(denied.getByRole('button')).toHaveCount(0);
    await settle(page, info, width, 'promo09-forbidden');

    w.faults.clear();
    w.mode = 'DISABLED';
    await page.reload();
    await expect(page.getByText('ยังไม่เปิดใช้การชำระเงินในระบบนี้ จึงยังสร้างหรือใช้แคมเปญไม่ได้', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'สร้างแคมเปญ' })).toHaveCount(0);
    await settle(page, info, width, 'promo09-disabled');
  });
}

const longNameWorld = () => {
  const w = newAdminWorld();
  addCampaign(w, { campaignId: 'camp-long', published: publishedCampaign({ campaignId: 'camp-long', internalName: LONG_INTERNAL, displayName: LONG_NAME }), usage: { reserved: 0, consumed: 1 } });
  return w;
};
const LONG_INTERNAL = 'Internal'.padEnd(120, 'y');
for (const width of WIDTHS) {
  // FXE-D5 (fixed in round 3): the row's title link wraps (`max-w-full [overflow-wrap:anywhere]`); a 120-character internal name (the allowed maximum) pushed the whole page to 1121px wide at 390px.
  test(`PROMO-09 the longest internal name (120 characters, no spaces) stays inside the list row at ${width}px`, async ({ page }, info) => {
    await adminOpen(page, longNameWorld(), width, '/system/billing/campaigns');
    const row = articleOf(page, LONG_INTERNAL);
    await expect(row).toBeVisible();
    // every box of the row, the long name and the customer-facing name included, ends inside the row's own box
    const outside = await row.evaluate(el => { const edge = el.getBoundingClientRect().right + 1; return Array.from(el.querySelectorAll('*')).filter(child => child.getBoundingClientRect().right > edge).map(child => (child.textContent ?? '').slice(0, 30)); });
    expect(outside, 'boxes past the right edge of the row').toEqual([]);
    await settle(page, info, width, 'promo09-long-names-list');
  });

  test(`PROMO-09 the longest internal and customer-facing names (no spaces) stay inside the detail page at ${width}px`, async ({ page }, info) => {
    await adminOpen(page, longNameWorld(), width, '/system/billing/campaigns/camp-long');
    await expect(page.getByRole('heading', { name: LONG_INTERNAL, level: 1 })).toBeVisible();
    await settle(page, info, width, 'promo09-long-names-detail');
  });
}

for (const width of WIDTHS) {
  // FXE-D8 (fixed in round 3): the filter row gives the cycle select room from 1280px (two columns below that) and both selects wrap a label instead of cutting it, so the word that says which
  // cycle is filtered (รายเดือน / รายปี) is always on screen.
  test(`PROMO-09 the cycle filter still shows which cycle is chosen (the selected text is not cut off) at ${width}px`, async ({ page }, info) => {
    const w = everyStatusWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns');
    const select = page.getByRole('combobox', { name: 'แพ็กเกจและรอบ', exact: true });
    await chooseThemedOption(page, select, 'เริ่มต้น (STARTER) · รายปี');
    const cut = await select.evaluate(el => [el, ...Array.from(el.querySelectorAll('*'))].filter(node => getComputedStyle(node).overflowX !== 'visible' && node.scrollWidth > node.clientWidth + 1).length);
    expect(cut, 'elements whose text is cut off').toBe(0);
    await expect(select).toContainText('เริ่มต้น (STARTER) · รายปี');
    await fits(page, width);
    await pictures(page, info, width, 'promo09-cycle-filter');
  });
}

/* ---------------------------------------------------------------- 10. create ---------------------------------------------------------------- */

for (const width of WIDTHS) {
  test(`PROMO-10 the Starter template form, an incomplete draft is sent right and lists what is missing, then lands on the detail page at ${width}px`, async ({ page }, info) => {
    const w = newAdminWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns/new');
    const form = page.getByRole('form', { name: 'สร้างแคมเปญใหม่' });
    await expect(page.getByRole('heading', { name: 'สร้างแคมเปญโปรโมชั่น', level: 1 })).toBeVisible();
    await expect(page.getByText('แบบตั้งต้น “ซื้อแพ็กเกจแถมเดือน” สำหรับแพ็กเกจเริ่มต้น: ซื้อรายเดือนได้ 2 เดือน ซื้อรายปีได้ 13 เดือน พร้อมใบเสร็จแถม')).toBeVisible();
    await expect(page.getByText('โหมดทดสอบ · ไม่มีการรับเงินจริง', { exact: true })).toBeVisible();
    await expect(form).toContainText('การบันทึกร่างยังไม่เปิดแคมเปญให้ลูกค้า');
    await expect(form.getByRole('checkbox', { name: /เริ่มต้น \(STARTER\) · รายเดือน/ })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: /เริ่มต้น \(STARTER\) · รายปี/ })).toBeChecked();
    await expect(form).toContainText('ซื้อ 1 เดือน แถม 1 เดือน = 2 เดือน · ใบเสร็จ 30 + 30 = 60 ใบ');
    await expect(form).toContainText('ซื้อ 12 เดือน แถม 1 เดือน = 13 เดือน · ใบเสร็จ 360 + 30 = 390 ใบ');
    await expect(form).toContainText('การซ้อนสิทธิ์: ใช้ร่วมกับส่วนลดกิจกรรมหรือดีลไม่ได้ ร้านเลือกได้อย่างเดียวต่อหนึ่งรายการซื้อ');
    await settle(page, info, width, 'promo10-form-empty');

    await form.getByLabel('ชื่อภายใน').fill('โปรทดสอบ ต.ค.');
    await form.getByLabel('เหตุผลที่บันทึกครั้งนี้').fill('ทดสอบบันทึกร่างที่ยังไม่ครบ');
    await form.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(page).toHaveURL(/\/system\/billing\/campaigns\/camp-new-1$/);
    const [save] = callsTo(w, 'POST', /^promotion-campaign-drafts$/);
    expect(save!.body).toEqual({ values: { type: 'BONUS_MONTHS', description: null, internalName: 'โปรทดสอบ ต.ค.', rules: STARTER_RULES }, reason: 'ทดสอบบันทึกร่างที่ยังไม่ครบ' });
    expect(save!.body).not.toHaveProperty('campaignId');
    expect(save!.key).toMatch(KEY);
    wire(info, 'draft-save-incomplete', width, save);
    await expect(page.getByRole('status').filter({ hasText: 'บันทึกร่างแล้ว ยังไม่เปิดแคมเปญให้ลูกค้า' })).toBeVisible();
    const missing = page.getByText('ร่างยังไม่ครบ', { exact: true }).locator('xpath=..');
    await expect(missing.locator('li')).toHaveText(['ยังไม่ได้กรอกชื่อที่ลูกค้าเห็น', 'ยังไม่ได้ตั้งเวลาเริ่ม', 'ยังไม่ได้ตั้งเวลาสิ้นสุด', 'ยังไม่ได้เลือกจำนวนสิทธิ์สูงสุด กรอกจำนวน หรือเลือก "ไม่จำกัด"']);
    await expect(page.getByText('ร่าง', { exact: true }).first()).toBeVisible();
    // an incomplete draft cannot be sent to review
    await expect(page.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true })).toHaveCount(0);
    await settle(page, info, width, 'promo10-saved-incomplete');
  });

  test(`PROMO-10 a complete form: the calendar, the Thai-time fields, the cap, and the body that is sent at ${width}px`, async ({ page }, info) => {
    const w = newAdminWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns/new');
    const form = page.getByRole('form', { name: 'สร้างแคมเปญใหม่' });
    await form.getByLabel('ชื่อภายใน').fill('Starter แถมเดือน พ.ย.');
    await form.getByLabel('คำอธิบาย (ไม่บังคับ)').fill('โปรสำหรับร้านใหม่ช่วงปลายปี');
    await form.getByLabel('ชื่อที่ลูกค้าเห็น').fill(CAMPAIGN_NAME);
    await form.getByRole('checkbox', { name: /รายปี/ }).uncheck();
    await form.getByRole('combobox', { name: 'เริ่มรับสิทธิ์ วันที่' }).click();
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.screenshot({ path: info.outputPath(`promo10-calendar-open-${width}-viewport.png`) });
    await page.getByRole('button', { name: '15', exact: true }).click();
    await form.getByLabel('เริ่มรับสิทธิ์ เวลา').fill('09:00');
    await form.getByRole('combobox', { name: 'สิ้นสุดรับสิทธิ์ วันที่' }).click();
    await page.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click();
    await page.getByRole('button', { name: '14', exact: true }).click();
    await form.getByLabel('สิ้นสุดรับสิทธิ์ เวลา').fill('23:59');
    // the cap rows are 44px targets (the "จำกัดไม่เกิน" row used to be as high as its text)
    for (const name of ['ไม่จำกัด', 'จำกัดไม่เกิน']) {
      const row = form.locator('label').filter({ has: page.getByRole('radio', { name, exact: true }) });
      expect((await row.boundingBox())!.height, `${name} row`).toBeGreaterThanOrEqual(44);
    }
    await form.getByRole('radio', { name: 'จำกัดไม่เกิน' }).check();
    await form.getByLabel('จำนวนสิทธิ์สูงสุด', { exact: true }).fill('100');
    await form.getByLabel('เหตุผลที่บันทึกครั้งนี้').fill('เปิดโปรปลายปี');
    await settle(page, info, width, 'promo10-form-filled');
    await form.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(page).toHaveURL(/\/system\/billing\/campaigns\/camp-new-1$/);
    const [save] = callsTo(w, 'POST', /^promotion-campaign-drafts$/);
    expect(save!.body).toEqual({ values: { type: 'BONUS_MONTHS', description: 'โปรสำหรับร้านใหม่ช่วงปลายปี', internalName: 'Starter แถมเดือน พ.ย.', displayName: CAMPAIGN_NAME,
      rules: STARTER_RULES.slice(0, 1), startsAt: '2026-10-15T02:00:00.000Z', endsAt: '2026-11-14T16:59:00.000Z', cap: 100 }, reason: 'เปิดโปรปลายปี' });
    wire(info, 'draft-save-complete', width, save);
    await expect(page.getByText('ร่างยังไม่ครบ', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true })).toBeVisible();
    await settle(page, info, width, 'promo10-saved-complete');
  });

  test(`PROMO-10 the form refuses what cannot be sent, a failed save keeps what was typed and a retry keeps its key at ${width}px`, async ({ page }, info) => {
    const w = newAdminWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns/new');
    const form = page.getByRole('form', { name: 'สร้างแคมเปญใหม่' });
    await form.getByLabel('ชื่อภายใน').fill('โปรที่พิมพ์ไว้');
    await form.getByLabel('คำอธิบาย (ไม่บังคับ)').fill('คำอธิบายที่พิมพ์ไว้');
    // no reason and half a date: nothing is sent, and the form says what to fix next to the field
    await form.getByLabel('เริ่มรับสิทธิ์ เวลา').fill('09:00');
    await form.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(form.getByRole('alert').filter({ hasText: 'กรอกวันที่และเวลาให้ครบและถูกต้อง เช่น 09:00 (เวลาประเทศไทย)' })).toBeVisible();
    await expect(form.getByRole('alert').filter({ hasText: 'กรอกเหตุผลที่บันทึกครั้งนี้ ระบบเก็บไว้ในประวัติการเปลี่ยนแปลง' })).toBeVisible();
    expect(callsTo(w, 'POST', /drafts/)).toHaveLength(0);
    await settle(page, info, width, 'promo10-form-problems');
    await form.getByLabel('เริ่มรับสิทธิ์ เวลา').fill('');
    await form.getByLabel('เหตุผลที่บันทึกครั้งนี้').fill('บันทึกร่างแรก');
    // a lost response, then a refusal, then success
    failNext(w, 'POST promotion-campaign-drafts', { status: 503, body: { message: 'Service Unavailable' } });
    await form.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'ยังยืนยันผลไม่ได้ โหลดข้อมูลล่าสุดเพื่อตรวจ หรือกดทำรายการเดิมอีกครั้ง ระบบจะไม่ทำซ้ำให้' })).toBeVisible();
    await expect(form.getByLabel('ชื่อภายใน')).toHaveValue('โปรที่พิมพ์ไว้');
    await expect(form.getByLabel('คำอธิบาย (ไม่บังคับ)')).toHaveValue('คำอธิบายที่พิมพ์ไว้');
    await expect(form.getByLabel('เหตุผลที่บันทึกครั้งนี้')).toHaveValue('บันทึกร่างแรก');
    await expect(page).toHaveURL(/\/campaigns\/new$/);
    await settle(page, info, width, 'promo10-save-unconfirmed');
    failNext(w, 'POST promotion-campaign-drafts', apiError(400, 'CONTROL_PROMOTION_INVALID'));
    await form.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: INVALID_TEXT })).toBeVisible();
    await form.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(page).toHaveURL(/\/system\/billing\/campaigns\/camp-new-1$/);
    const keys = callsTo(w, 'POST', /^promotion-campaign-drafts$/).map(call => call.key);
    // the same command (a lost answer) keeps its key; after a refusal it is a new command
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    for (const key of keys) expect(key).toMatch(KEY);
    wire(info, 'draft-save-keys', width, keys);
  });
}

/* ---------------------------------------------------------------- 11. a complete draft: preview, review, password, submit, approve ---------------------------------------------------------------- */

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const exactly = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const draftWorld = (over: Partial<Parameters<typeof newAdminWorld>[0]> = {}) => {
  const w = newAdminWorld(over);
  addCampaign(w, { campaignId: 'camp-new', draft: { operationId: 'draft-1', version: 3, values: completeDraft('camp-new', { startsAt: '2026-10-08T03:00:00.000Z', endsAt: '2026-10-31T16:59:00.000Z', cap: 200 }) } });
  return w;
};

for (const width of WIDTHS) {
  test(`PROMO-11 a complete draft: the preview cards, "ตรวจสอบก่อนเปิด", the password, submit and approve with the right bodies, then it is active at ${width}px`, async ({ page }, info) => {
    const w = draftWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    await expect(page.getByRole('heading', { name: 'Starter แถมเดือน พ.ย. 2569', level: 1 })).toBeVisible();
    await expect(page.getByText(`ชื่อที่ลูกค้าเห็น: ${CAMPAIGN_NAME}`)).toBeVisible();
    await expect(page.getByText('บันทึกร่างไว้เท่านั้น ลูกค้ายังไม่เห็นและใช้สิทธิ์ไม่ได้ ตรวจตัวอย่างแล้วยืนยันเปิดเมื่อพร้อม')).toBeVisible();
    const terms = region(page, 'ร่างที่กำลังแก้');
    await expect(terms).toContainText('ยังไม่มีผลกับลูกค้า จนกว่าจะตรวจสอบก่อนเปิดและยืนยัน');
    const fact = (label: string) => terms.locator('dl > div').filter({ has: page.locator('dt', { hasText: exactly(label) }) }).locator('dd');
    await expect(fact('ชื่อภายใน')).toHaveText('Starter แถมเดือน พ.ย. 2569');
    await expect(fact('เริ่มต้น (STARTER) · รายเดือน')).toHaveText('แถม 1 เดือน + ใบเสร็จ 30 ใบ');
    await expect(fact('เริ่มต้น (STARTER) · รายปี')).toHaveText('แถม 1 เดือน + ใบเสร็จ 30 ใบ');
    await expect(fact('เริ่ม')).toHaveText(thaiDateTime('2026-10-08T03:00:00.000Z'));
    await expect(fact('สิ้นสุด')).toHaveText(thaiDateTime('2026-10-31T16:59:00.000Z'));
    await expect(fact('จำนวนสิทธิ์สูงสุด')).toHaveText('200 สิทธิ์');
    const preview = region(page, 'ตัวอย่างเมื่อเปิดแคมเปญ');
    const month = preview.getByRole('article', { name: 'เริ่มต้น (STARTER) · รายเดือน' }), year = preview.getByRole('article', { name: 'เริ่มต้น (STARTER) · รายปี' });
    const monthEnd = addMonths(FIXED_NOW, 1), monthFree = addMonths(FIXED_NOW, 2), yearEnd = addMonths(FIXED_NOW, 12), yearFree = addMonths(FIXED_NOW, 13);
    await expect(month.locator('dd').nth(0)).toHaveText('249 บาท');
    await expect(month.locator('dd').nth(1)).toHaveText('จ่าย 1 เดือน + แถม 1 เดือน = 2 เดือน');
    await expect(month.locator('dd').nth(2)).toHaveText('ใบเสร็จ 30 + 30 = 60 ใบ');
    await expect(month.locator('dd').nth(3)).toHaveText(`ถ้าจ่ายวันที่ ${thaiDateTime(FIXED_NOW)} จ่ายถึง ${thaiDateTime(monthEnd)} และแถมถึง ${thaiDateTime(monthFree)}`);
    await expect(month.locator('dd').nth(4)).toHaveText(`249 บาท เมื่อครบ ${thaiDateTime(monthFree)} (เฉพาะแบบต่ออายุอัตโนมัติ)`);
    await expect(year.locator('dd').nth(0)).toHaveText('2,490 บาท');
    await expect(year.locator('dd').nth(1)).toHaveText('จ่าย 12 เดือน + แถม 1 เดือน = 13 เดือน');
    await expect(year.locator('dd').nth(2)).toHaveText('ใบเสร็จ 360 + 30 = 390 ใบ');
    await expect(year.locator('dd').nth(3)).toHaveText(`ถ้าจ่ายวันที่ ${thaiDateTime(FIXED_NOW)} จ่ายถึง ${thaiDateTime(yearEnd)} และแถมถึง ${thaiDateTime(yearFree)}`);
    await firstScreen(page, info, width, 'promo11-first-screen');
    await settle(page, info, width, 'promo11-draft');

    const publish = region(page, 'เปิดใช้แคมเปญ');
    const review = publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true });
    await expect(review).toBeDisabled();
    await publish.getByLabel('เหตุผล').fill('เปิดโปรเดือนตุลาคม');
    await review.click();
    const [previewCall] = callsTo(w, 'POST', /^promotion-campaigns\/camp-new\/preview$/);
    expect(previewCall!.body).toEqual({ expectedVersion: 7, draftVersion: 3, action: 'PUBLISH', reason: 'เปิดโปรเดือนตุลาคม' });
    wire(info, 'preview-publish', width, previewCall);
    await expect(publish).toContainText('ตรวจตัวอย่างแล้ว ส่งคำขอเพื่อให้ผู้อนุมัติยืนยัน');
    await expect(publish).toContainText('เหตุผลที่ระบุ: เปิดโปรเดือนตุลาคม');
    await expect(publish).toContainText(`ใช้คำขอได้ถึง ${thaiDateTime(inMs(600_000))}`);
    await expect(publish).toContainText('ยืนยันโดยผู้ดูแลระบบคนเดียว');
    const submit = publish.getByRole('button', { name: 'ส่งคำขอ', exact: true });
    await expect(submit).toBeDisabled();
    await expect(publish.getByRole('button', { name: 'ยกเลิกคำขอ', exact: true })).toBeEnabled();
    await settle(page, info, width, 'promo11-previewed');

    const password = region(page, 'ยืนยันรหัสผ่าน');
    await password.getByLabel('รหัสผ่านปัจจุบัน').fill('wrong-password');
    await password.getByRole('button', { name: 'ยืนยันรหัสผ่าน', exact: true }).click();
    await expect(password.getByRole('alert')).toContainText('ยืนยันรหัสผ่านไม่ได้ ตรวจสอบรหัสผ่านหรือใช้หน้ากู้บัญชี');
    await password.getByLabel('รหัสผ่านปัจจุบัน').fill('correct-password');
    await password.getByRole('button', { name: 'ยืนยันรหัสผ่าน', exact: true }).click();
    await expect(publish.getByRole('status').filter({ hasText: `ยืนยันตัวตนแล้ว ดำเนินการได้ถึง ${thaiDateTime(inMs(300_000))}` })).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.click();
    const operationId = previewCall && w.campaigns[0]!.operation!.id;
    const [submitCall] = callsTo(w, 'POST', /\/submit$/);
    expect(submitCall!.body).toEqual({ expectedVersion: 1, previewHash: 'h'.repeat(64) });
    expect(submitCall!.key).toBe(`billing-config-${operationId}`);
    await expect(publish).toContainText('ส่งคำขอแล้ว รอยืนยันเปิดใช้');
    const approve = publish.getByRole('button', { name: 'อนุมัติและเปิดใช้', exact: true });
    await expect(approve).toBeEnabled();
    await settle(page, info, width, 'promo11-submitted');
    await approve.click();
    const [approveCall] = callsTo(w, 'POST', /\/approve$/);
    expect(approveCall!.body).toEqual({ expectedVersion: 2, previewHash: 'h'.repeat(64) });
    expect(approveCall!.key).toBeNull();
    wire(info, 'submit-approve', width, { submit: submitCall, approve: approveCall });
    await expect(page.getByRole('status').filter({ hasText: 'ดำเนินการแล้ว แคมเปญมีผลตามเวลาที่ตั้งไว้' })).toBeVisible();
    await expect(page.getByText('กำลังใช้งาน', { exact: true }).first()).toBeVisible();
    await expect(region(page, 'เงื่อนไขที่ใช้อยู่')).toBeVisible();
    await expect(page.getByRole('button', { name: 'พักแคมเปญ', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'จบแคมเปญ', exact: true })).toBeVisible();
    await settle(page, info, width, 'promo11-active');
  });
}

for (const width of WIDTHS) {
  test(`PROMO-10 editing a live campaign starts a draft beside the live terms; the draft can be discarded at ${width}px`, async ({ page }, info) => {
    const w = activeWorld();
    await adminOpen(page, w, width, `/system/billing/campaigns/${CAMPAIGN_ID}`);
    await region(page, 'ร่างที่กำลังแก้').getByRole('button', { name: 'แก้เงื่อนไข', exact: true }).click();
    const form = page.getByRole('form', { name: 'แก้ร่างแคมเปญ' });
    await expect(page.getByRole('heading', { name: 'แก้เงื่อนไขเป็นร่างใหม่', exact: true })).toBeVisible();
    await expect(form).toContainText('การแก้ไขจะสร้างเป็นร่างใหม่ เงื่อนไขที่ใช้อยู่ตอนนี้ยังไม่เปลี่ยน');
    await expect(form.getByLabel('ชื่อภายใน')).toHaveValue('Starter แถมเดือน ต.ค. 2569');
    await expect(form.getByLabel('เริ่มรับสิทธิ์ เวลา')).toHaveValue('10:00');
    await expect(form.getByLabel('สิ้นสุดรับสิทธิ์ เวลา')).toHaveValue('23:59');
    await expect(form.getByLabel('จำนวนสิทธิ์สูงสุด', { exact: true })).toHaveValue('100');
    await expect(form).toContainText('ตอนนี้นับไปแล้ว 15 สิทธิ์ ตั้งให้ไม่น้อยกว่านี้');
    await settle(page, info, width, 'promo10-edit-live');
    await form.getByLabel('จำนวนสิทธิ์สูงสุด', { exact: true }).fill('150');
    await form.getByLabel('เหตุผลที่บันทึกครั้งนี้').fill('เพิ่มจำนวนสิทธิ์');
    await form.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'บันทึกร่างแล้ว ยังไม่เปิดแคมเปญให้ลูกค้า' })).toBeVisible();
    const [save] = callsTo(w, 'POST', /^promotion-campaign-drafts$/);
    // no draftVersion: this is the first draft of a published campaign; the id names the campaign being changed
    expect(save!.body).toEqual({ campaignId: CAMPAIGN_ID, reason: 'เพิ่มจำนวนสิทธิ์', values: { type: 'BONUS_MONTHS', description: 'โปรเปิดตัวสำหรับร้านใหม่', internalName: 'Starter แถมเดือน ต.ค. 2569',
      displayName: CAMPAIGN_NAME, rules: STARTER_RULES, startsAt: '2026-10-01T03:00:00.000Z', endsAt: '2026-10-31T16:59:00.000Z', cap: 150 } });
    expect(save!.key).toMatch(KEY);
    wire(info, 'draft-save-edit-live', width, save);
    // the live terms stay; the draft is shown beside them
    await expect(region(page, 'เงื่อนไขที่ใช้อยู่').locator('dd').filter({ hasText: '100 สิทธิ์' })).toBeVisible();
    await expect(region(page, 'ร่างที่กำลังแก้').locator('dd').filter({ hasText: '150 สิทธิ์' })).toBeVisible();
    await settle(page, info, width, 'promo10-live-and-draft');
    await page.getByRole('button', { name: 'ยกเลิกร่าง', exact: true }).click();
    await page.getByRole('button', { name: 'ยืนยันยกเลิกร่างนี้', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'ยกเลิกร่างแล้ว เงื่อนไขที่ใช้อยู่ไม่เปลี่ยน' })).toBeVisible();
    const [discard] = callsTo(w, 'POST', /\/discard$/);
    expect(discard!.body).toEqual({ draftVersion: 1 });
    await expect(region(page, 'เงื่อนไขที่ใช้อยู่').locator('dd').filter({ hasText: '100 สิทธิ์' })).toBeVisible();
    await expect(region(page, 'ร่างที่กำลังแก้').getByRole('button', { name: 'แก้เงื่อนไข', exact: true })).toBeVisible();
  });

  test(`PROMO-10 discarding a draft that was never published leaves the campaign list at ${width}px`, async ({ page }) => {
    const w = draftWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    await page.getByRole('button', { name: 'ยกเลิกร่าง', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ไม่ยกเลิก', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ยืนยันยกเลิกร่างนี้', exact: true }).click();
    await expect(page).toHaveURL(/\/system\/billing\/campaigns$/);
    expect(callsTo(w, 'POST', /\/discard$/)[0]!.body).toEqual({ draftVersion: 3 });
    await expect(page.getByText('ยังไม่มีแคมเปญโปรโมชั่น', { exact: true })).toBeVisible();
  });
}

/* ---------------------------------------------------------------- 12. an active campaign: pause, resume, end ---------------------------------------------------------------- */

const activeWorld = (over: Partial<Parameters<typeof newAdminWorld>[0]> = {}) => {
  const w = newAdminWorld({ reauthUntil: inMs(300_000), ...over });
  addCampaign(w, { campaignId: CAMPAIGN_ID, published: publishedCampaign(), usage: { reserved: 3, consumed: 12 } });
  return w;
};
const CLOSE = { pause: /^billing-campaign-pause-[0-9a-f-]{36}$/, end: /^billing-campaign-end-[0-9a-f-]{36}$/ };

for (const width of WIDTHS) {
  test(`PROMO-12 pause: the confirmation counts the open payments, needs a reason, a lost answer keeps its key, then "กลับมาเปิด" sends a RESUME preview at ${width}px`, async ({ page }, info) => {
    const w = activeWorld();
    await adminOpen(page, w, width, `/system/billing/campaigns/${CAMPAIGN_ID}`);
    await expect(page.getByText('กำลังใช้งาน', { exact: true }).first()).toBeVisible();
    await expect(region(page, 'เงื่อนไขที่ใช้อยู่')).toBeVisible();
    await expect(page.getByRole('button', { name: 'แก้เงื่อนไข', exact: true })).toBeVisible();
    await settle(page, info, width, 'promo12-active');
    await page.getByRole('button', { name: 'พักแคมเปญ', exact: true }).click();
    const confirm = page.getByRole('group', { name: 'พักแคมเปญนี้' });
    await expect(confirm).toContainText('มีรายการชำระค้าง 3 รายการที่จะยังได้รับสิทธิ์ตามเดิม');
    await expect(confirm).toContainText('ร้านที่ยังไม่ได้จองสิทธิ์จะใช้สิทธิ์ไม่ได้ทันที แต่ซื้อแพ็กเกจปกติได้ตามเดิม กลับมาเปิดได้ภายในช่วงเวลาเดิม และจำนวนที่ใช้ไปแล้วไม่ถูกล้าง');
    await expect(confirm.getByText(/จบแล้วกลับมาเปิด/)).toHaveCount(0);
    const go = confirm.getByRole('button', { name: 'ยืนยันพักแคมเปญ', exact: true });
    await expect(go).toBeDisabled();
    await settle(page, info, width, 'promo12-pause-confirm');
    await confirm.getByLabel('เหตุผล').fill('พักเพื่อตรวจราคา');
    await expect(go).toBeEnabled();
    failNext(w, 'POST promotion-campaigns/:id/pause', { status: 503, body: { message: 'Service Unavailable' } });
    await go.click();
    await expect(page.getByRole('alert').filter({ hasText: 'ยังยืนยันผลไม่ได้ โหลดข้อมูลล่าสุดเพื่อตรวจ หรือกดทำรายการเดิมอีกครั้ง ระบบจะไม่ทำซ้ำให้' })).toBeVisible();
    await expect(confirm).toBeVisible();
    await expect(confirm.getByLabel('เหตุผล')).toHaveValue('พักเพื่อตรวจราคา');
    const versionBefore = w.settingsVersion;
    await go.click();
    await expect(page.getByRole('status').filter({ hasText: 'พักแคมเปญแล้ว' })).toBeVisible();
    const pauses = callsTo(w, 'POST', /\/pause$/);
    expect(pauses).toHaveLength(2);
    expect(pauses[0]!.body).toEqual({ expectedVersion: versionBefore, reason: 'พักเพื่อตรวจราคา' });
    expect(pauses[1]!.body).toEqual(pauses[0]!.body);
    expect(pauses[0]!.key).toMatch(CLOSE.pause);
    expect(pauses[1]!.key).toBe(pauses[0]!.key);
    wire(info, 'pause', width, pauses[1]);
    await expect(page.getByText('พัก', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ไม่รับสิทธิ์ใหม่ รายการที่จองไว้แล้วยังได้รับสิทธิ์ตามเดิม กลับมาเปิดได้ภายในช่วงเวลาเดิม')).toBeVisible();
    await expect(page.getByRole('button', { name: 'พักแคมเปญ', exact: true })).toHaveCount(0);
    await settle(page, info, width, 'promo12-paused');

    // resume: a RESUME preview, no draft version, the same publish workflow
    // a paused campaign with no draft: the section is named for what it does, and what a person reads as its heading is what a screen reader calls the region
    await expect(region(page, 'เปิดใช้แคมเปญ')).toHaveCount(0);
    const resume = region(page, 'กลับมาเปิดแคมเปญ');
    await expect(resume.getByRole('heading', { name: 'กลับมาเปิดแคมเปญ', level: 2 })).toBeVisible();
    await expect(resume.getByRole('button', { name: 'กลับมาเปิด', exact: true })).toBeDisabled();
    await resume.getByLabel('เหตุผล').fill('ตรวจราคาเสร็จแล้ว');
    await resume.getByRole('button', { name: 'กลับมาเปิด', exact: true }).click();
    const [resumeCall] = callsTo(w, 'POST', /\/preview$/);
    expect(resumeCall!.body).toEqual({ expectedVersion: w.settingsVersion, action: 'RESUME', reason: 'ตรวจราคาเสร็จแล้ว' });
    wire(info, 'resume-preview', width, resumeCall);
    await expect(resume).toContainText('ตรวจตัวอย่างแล้ว ส่งคำขอเพื่อให้ผู้อนุมัติยืนยัน');
    await settle(page, info, width, 'promo12-resume-previewed');
    await resume.getByRole('button', { name: 'ส่งคำขอ', exact: true }).click();
    await resume.getByRole('button', { name: 'อนุมัติและเปิดใช้', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'ดำเนินการแล้ว แคมเปญมีผลตามเวลาที่ตั้งไว้' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'พักแคมเปญ', exact: true })).toBeVisible();
  });

  test(`PROMO-12 end: the confirmation says it is final, needs a reason, sends the right body and an ended campaign has no actions at ${width}px`, async ({ page }, info) => {
    const w = activeWorld();
    await adminOpen(page, w, width, `/system/billing/campaigns/${CAMPAIGN_ID}`);
    await page.getByRole('button', { name: 'จบแคมเปญ', exact: true }).click();
    const confirm = page.getByRole('group', { name: 'จบแคมเปญนี้' });
    await expect(confirm).toContainText('มีรายการชำระค้าง 3 รายการที่จะยังได้รับสิทธิ์ตามเดิม');
    await expect(confirm).toContainText('ร้านที่ยังไม่ได้จองสิทธิ์จะใช้สิทธิ์ไม่ได้ทันที ประวัติและรายงานยังเปิดดูได้');
    await expect(confirm).toContainText('จบแล้วกลับมาเปิดด้วยแคมเปญนี้ไม่ได้ ถ้าจะจัดรอบใหม่ต้องสร้างแคมเปญใหม่');
    const go = confirm.getByRole('button', { name: 'ยืนยันจบแคมเปญ', exact: true });
    await expect(go).toBeDisabled();
    await settle(page, info, width, 'promo12-end-confirm');
    await confirm.getByRole('button', { name: 'ไม่ดำเนินการ', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await page.getByRole('button', { name: 'จบแคมเปญ', exact: true }).click();
    await confirm.getByLabel('เหตุผล').fill('จบโปรก่อนกำหนด');
    const version = w.settingsVersion;
    await go.click();
    await expect(page.getByRole('status').filter({ hasText: 'จบแคมเปญแล้ว' })).toBeVisible();
    const [end] = callsTo(w, 'POST', /\/end$/);
    expect(end!.body).toEqual({ expectedVersion: version, reason: 'จบโปรก่อนกำหนด' });
    expect(end!.key).toMatch(CLOSE.end);
    wire(info, 'end', width, end);
    await expect(page.getByText('จบแล้ว', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ปิดรับสิทธิ์แล้ว ดูประวัติได้ แต่เปิดใหม่ด้วยแคมเปญเดิมไม่ได้ ถ้าจะจัดรอบใหม่ต้องสร้างแคมเปญใหม่')).toBeVisible();
    await expect(region(page, 'เงื่อนไขของแคมเปญที่จบแล้ว')).toContainText(`จบเมื่อ ${thaiDateTime(FIXED_NOW)}`);
    await expect(region(page, 'เงื่อนไขของแคมเปญที่จบแล้ว')).toContainText('ปิดรับสิทธิ์แล้ว เก็บไว้ให้ดูเป็นประวัติ เวลาแสดงเป็นเวลาประเทศไทย');
    await expect(region(page, 'เงื่อนไขที่ใช้อยู่')).toHaveCount(0);
    for (const name of ['พักแคมเปญ', 'จบแคมเปญ', 'กลับมาเปิด', 'ตรวจสอบก่อนเปิด', 'แก้เงื่อนไข', 'แก้ร่าง', 'ส่งคำขอ']) await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0);
    await expect(region(page, 'พักหรือจบแคมเปญ')).toHaveCount(0);
    await settle(page, info, width, 'promo12-ended');
  });
}

/* ---------------------------------------------------------------- 13. the usage report ---------------------------------------------------------------- */

const reportWorld = (over: Partial<Parameters<typeof newAdminWorld>[0]> = {}) => {
  const w = newAdminWorld(over);
  const first = reportPage({ companies: [reportCompany(1), reportCompany(2, { state: 'RESERVED', consumedAt: null, benefitAppliedAt: null, paidEnd: null, benefitEnd: null, invoiceHref: null }),
    reportCompany(3, { refund: 'FULL', entitlementAdjustmentState: 'PENDING' })] });
  const second = reportPage({ companies: [reportCompany(4, { state: 'RELEASED', consumedAt: null, benefitAppliedAt: null, releasedAt: inDays(-1), paidEnd: null, benefitEnd: null, invoiceHref: null }),
    reportCompany(5, { refund: 'PARTIAL', entitlementAdjustmentState: 'NOT_REQUIRED', attemptHref: 'javascript:alert(1)', invoiceHref: 'https://evil.example/invoices/1' })] });
  addCampaign(w, { campaignId: CAMPAIGN_ID, published: publishedCampaign(), usage: { reserved: 2, consumed: 13 }, report: [first, second] });
  return w;
};

for (const width of WIDTHS) {
  test(`PROMO-13 the report: counts, free months and receipts, money with the finance permission, company rows with links and "ดูเพิ่ม" at ${width}px`, async ({ page }, info) => {
    const w = reportWorld();
    await adminOpen(page, w, width, `/system/billing/campaigns/${CAMPAIGN_ID}`);
    const report = region(page, 'รายงานการใช้สิทธิ์');
    const rows = report.locator('ul.space-y-3 > li');
    await expect(rows).toHaveCount(3);
    const count = (label: string) => report.locator('dl > div').filter({ has: page.locator('dt', { hasText: exactly(label) }) }).locator('dd');
    await expect(report).toContainText(`ข้อมูล ณ ${thaiDateTime(FIXED_NOW)}`);
    const expectedCounts: [string, string][] = [['สิทธิ์ที่ใช้แล้ว (รวมที่คืนเงิน)', '13'], ['สิทธิ์ที่ยังใช้งานอยู่', '11'], ['กำลังชำระ (จองสิทธิ์ไว้)', '2'], ['ชำระแล้ว รอเปิดสิทธิ์', '1'],
      ['เปิดสิทธิ์แล้ว', '12'], ['ยกเลิกก่อนชำระ', '3'], ['มีการคืนเงิน', '1'], ['คืนเงินเต็มจำนวน', '1']];
    for (const [label, value] of expectedCounts) await expect(count(label), label).toHaveText(value);
    await expect(count('เดือนฟรีที่ให้ไปแล้ว')).toHaveText('12 เดือน');
    await expect(count('ใบเสร็จแถมที่ให้ไปแล้ว')).toHaveText('360 ใบ');
    await expect(count('เงินที่รับจริง')).toHaveText('3,213 บาท');
    await expect(count('เงินที่คืนแล้ว')).toHaveText('249 บาท');
    await expect(report).toContainText('เดือนฟรีไม่นับเป็นรายได้ เงินที่รับจริงคือยอดที่ร้านจ่ายตามราคาปกติของรอบที่ซื้อเท่านั้น และการคืนเงินไม่ทำให้จำนวนสิทธิ์ที่ใช้แล้วลดลง');
    await expect(rows.nth(0)).toContainText('ร้านทดสอบหมายเลข 1');
    await expect(rows.nth(0)).toContainText('ใช้สิทธิ์แล้ว');
    await expect(rows.nth(0).getByRole('link', { name: 'ดูรายการชำระเงินของ ร้านทดสอบหมายเลข 1' })).toHaveAttribute('href', '/system/billing/companies/company-1/checkouts/att-1');
    await expect(rows.nth(0).getByRole('link', { name: 'ดูใบแจ้งหนี้ของ ร้านทดสอบหมายเลข 1' })).toHaveAttribute('href', '/system/billing/companies/company-1/invoices/inv-1');
    await expect(rows.nth(1)).toContainText('กำลังชำระ (จองสิทธิ์ไว้)');
    await expect(rows.nth(1).getByRole('link', { name: /ใบแจ้งหนี้/ })).toHaveCount(0);
    await expect(rows.nth(2)).toContainText('คืนเงินเต็มจำนวน');
    await expect(rows.nth(2)).toContainText('รอยุติสิทธิ์ที่ยังไม่ใช้');
    await settle(page, info, width, 'promo13-report');
    await report.getByRole('button', { name: 'ดูเพิ่ม', exact: true }).click();
    await expect(rows).toHaveCount(5);
    await expect(report.getByRole('button', { name: 'ดูเพิ่ม', exact: true })).toHaveCount(0);
    await expect(rows.nth(3)).toContainText('ยกเลิกก่อนชำระ คืนสิทธิ์แล้ว');
    await expect(rows.nth(4)).toContainText('คืนเงินบางส่วน เวลาและใบเสร็จคงเดิม');
    // a link the API sends is followed only inside the Admin console
    await expect(rows.nth(4).getByRole('link')).toHaveCount(0);
    expect(callsTo(w, 'GET', /\/report\?cursor=p1$/)).toHaveLength(1);
    await settle(page, info, width, 'promo13-report-more');
  });

  test(`PROMO-13 the report without the finance permission says why the money is missing, and failures keep what is shown at ${width}px`, async ({ page }, info) => {
    const w = reportWorld({ capabilities: READ_ONLY });
    await adminOpen(page, w, width, `/system/billing/campaigns/${CAMPAIGN_ID}`);
    const report = region(page, 'รายงานการใช้สิทธิ์'), rows = report.locator('ul.space-y-3 > li');
    await expect(rows).toHaveCount(3);
    await expect(report).toContainText('เงินที่รับจริงและเงินที่คืนแล้ว');
    await expect(report).toContainText('แสดงเมื่อบัญชีมีสิทธิ์ “ดูยอดเงิน”');
    await expect(report).not.toContainText(/3,213|249 บาท|0 บาท/);
    await settle(page, info, width, 'promo13-report-no-money');
    failNext(w, 'GET promotion-campaigns/:id/report', { status: 503, body: { message: 'Service Unavailable' } });
    await report.getByRole('button', { name: 'ดูเพิ่ม', exact: true }).click();
    await expect(report.getByRole('alert')).toContainText('ยังยืนยันผลไม่ได้ โหลดข้อมูลล่าสุดเพื่อตรวจ หรือกดทำรายการเดิมอีกครั้ง ระบบจะไม่ทำซ้ำให้');
    await expect(rows).toHaveCount(3);
    await report.getByRole('button', { name: 'ดูเพิ่ม', exact: true }).click();
    await expect(rows).toHaveCount(5);
    failNext(w, 'GET promotion-campaigns/:id/report', apiError(500, 'INTERNAL_SERVER_ERROR'), true);
    await report.getByRole('button', { name: 'โหลดรายงานใหม่', exact: true }).click();
    await expect(report.getByRole('alert')).toContainText('โหลดข้อมูลแคมเปญไม่ได้ กรุณาลองใหม่');
    await expect(rows).toHaveCount(0);
    w.faults.clear();
    await report.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
    await expect(rows).toHaveCount(3);
    w.campaigns[0]!.report = [reportPage({ counts: { reserved: 0, paidAwaitingApply: 0, applied: 0, releasedBeforePay: 0, refunded: 0, fullyRefunded: 0, rightsActive: 0 }, bonusMonthsGranted: 0, bonusReceiptUnitsGranted: 0, companies: [] })];
    await report.getByRole('button', { name: 'โหลดรายงานใหม่', exact: true }).click();
    await expect(report.getByText('ยังไม่มีร้านที่ขอใช้สิทธิ์', { exact: true })).toBeVisible();
    await settle(page, info, width, 'promo13-report-empty');
  });
}

/* ---------------------------------------------------------------- 14. errors: a Thai sentence and a way forward ---------------------------------------------------------------- */

for (const width of WIDTHS) {
  test(`PROMO-14 stale version on preview: the Thai sentence, and the latest data is loaded for another review at ${width}px`, async ({ page }, info) => {
    const w = draftWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    const publish = region(page, 'เปิดใช้แคมเปญ');
    await publish.getByLabel('เหตุผล').fill('เปิดโปร');
    w.settingsVersion = 9;
    failNext(w, 'POST promotion-campaigns/:id/preview', apiError(409, 'CONTROL_PREVIEW_STALE'));
    const reads = callsTo(w, 'GET', /^promotion-campaigns\/camp-new$/).length;
    await publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'ข้อมูลเปลี่ยนไประหว่างที่เปิดหน้านี้ หรือคำขอหมดอายุ ระบบโหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจสอบอีกครั้งก่อนดำเนินการต่อ' })).toBeVisible();
    await expect.poll(() => callsTo(w, 'GET', /^promotion-campaigns\/camp-new$/).length).toBeGreaterThan(reads);
    // way forward: review again with the version just loaded
    await publish.getByLabel('เหตุผล').fill('เปิดโปรอีกครั้ง');
    await publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true }).click();
    const previews = callsTo(w, 'POST', /\/preview$/);
    expect(previews.at(-1)!.body).toMatchObject({ expectedVersion: 9, action: 'PUBLISH' });
    await settle(page, info, width, 'promo14-stale');
  });

  test(`PROMO-14 password needed: the page goes back to asking for it at ${width}px`, async ({ page }, info) => {
    const w = draftWorld({ reauthUntil: inMs(300_000) });
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    const publish = region(page, 'เปิดใช้แคมเปญ');
    await publish.getByLabel('เหตุผล').fill('เปิดโปร');
    await publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true }).click();
    await expect(publish.getByRole('status').filter({ hasText: 'ยืนยันตัวตนแล้ว' })).toBeVisible();
    // the server no longer accepts the confirmation it gave a moment ago
    failNext(w, 'POST configuration-changes/:id/submit', apiError(403, 'CONTROL_REAUTH_REQUIRED'));
    await publish.getByRole('button', { name: 'ส่งคำขอ', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'ยืนยันรหัสผ่านก่อน แล้วกดดำเนินการรายการเดิมอีกครั้ง' })).toBeVisible();
    await expect(region(page, 'ยืนยันรหัสผ่าน').getByLabel('รหัสผ่านปัจจุบัน')).toBeVisible();
    await expect(publish.getByRole('status').filter({ hasText: 'ยืนยันตัวตนแล้ว' })).toHaveCount(0);
    await settle(page, info, width, 'promo14-reauth-required');
  });

  const REFUSALS = [
    { key: 'cap', code: 'CONTROL_PROMOTION_CAP_BELOW_USED', text: 'จำนวนสิทธิ์สูงสุดต่ำกว่าจำนวนที่ร้านจองและใช้ไปแล้ว ตั้งให้ไม่น้อยกว่านั้น หรือเลือก "ไม่จำกัด"' },
    { key: 'overlap', code: 'CONTROL_PROMOTION_OVERLAP', text: 'มีแคมเปญอื่นของแพ็กเกจและรอบเดียวกันในช่วงเวลานี้อยู่แล้ว เลื่อนช่วงเวลาหรือจบแคมเปญเดิมก่อน' },
    { key: 'catalog', code: 'CONTROL_PROMOTION_CATALOG_STALE', text: 'ราคา โควตา หรือภาษีของแพ็กเกจเปลี่ยนไปแล้ว ตรวจสอบตัวอย่างใหม่ก่อนเปิดแคมเปญ' },
    { key: 'invalid', code: 'CONTROL_PROMOTION_INVALID', text: INVALID_TEXT },
  ] as const;
  for (const refusal of REFUSALS) test(`PROMO-14 refused on preview (${refusal.key}): the Thai sentence, the draft stays and can be edited at ${width}px`, async ({ page }, info) => {
    const w = draftWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    const publish = region(page, 'เปิดใช้แคมเปญ');
    await publish.getByLabel('เหตุผล').fill('เปิดโปร');
    failNext(w, 'POST promotion-campaigns/:id/preview', apiError(409, refusal.code));
    await publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: refusal.text });
    await expect(alert).toBeVisible();
    await expect(page.getByRole('button', { name: 'แก้ร่าง', exact: true })).toBeEnabled();
    await expect(publish.getByLabel('เหตุผล')).toHaveValue('เปิดโปร');
    await settle(page, info, width, `promo14-${refusal.key}`);
  });

  test(`PROMO-14 a catalog blocker on the preview rows stops the review and names the fix at ${width}px`, async ({ page }, info) => {
    const w = draftWorld();
    // the server compares offer signatures: the monthly rule no longer matches the catalog
    w.blockers = { month: ['CONTROL_PROMOTION_CATALOG_STALE'] };
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    const month = region(page, 'ตัวอย่างเมื่อเปิดแคมเปญ').getByRole('article', { name: 'เริ่มต้น (STARTER) · รายเดือน' });
    await expect(month.getByRole('alert')).toContainText('ราคา โควตา หรือภาษีของแพ็กเกจเปลี่ยนไปแล้ว ตรวจสอบตัวอย่างใหม่ก่อนเปิดแคมเปญ');
    await expect(region(page, 'ตัวอย่างเมื่อเปิดแคมเปญ').getByRole('article', { name: 'เริ่มต้น (STARTER) · รายปี' }).getByRole('alert')).toHaveCount(0);
    const publish = region(page, 'เปิดใช้แคมเปญ');
    await publish.getByLabel('เหตุผล').fill('เปิดโปร');
    await expect(publish).toContainText('ตัวอย่างพบเรื่องที่ต้องแก้ก่อนเปิด ตามรายการด้านบน');
    await expect(publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'แก้ร่าง', exact: true })).toBeEnabled();
    await settle(page, info, width, 'promo14-blocker');
  });

  test(`PROMO-14 a live campaign whose catalog moved says so on every row, stops taking new rights (the shop buys normally) and offers "แก้เงื่อนไข" at ${width}px`, async ({ page }, info) => {
    const w = activeWorld();
    w.campaigns[0]!.stale = true;
    w.blockers = { month: ['CONTROL_PROMOTION_CATALOG_STALE'], year: ['CONTROL_PROMOTION_CATALOG_STALE'] };
    await adminOpen(page, w, width, `/system/billing/campaigns/${CAMPAIGN_ID}`);
    await expect(page.getByText('ต้องตรวจแพ็กเกจใหม่', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ราคา โควตา หรือภาษีของแพ็กเกจเปลี่ยนไปจากตอนเปิดแคมเปญ ระบบจึงหยุดรับสิทธิ์ใหม่ (ซื้อแพ็กเกจปกติได้) แก้เงื่อนไขแล้วตรวจตัวอย่างใหม่ก่อนเปิดอีกครั้ง')).toBeVisible();
    const preview = region(page, 'ตัวอย่างเมื่อเปิดแคมเปญ');
    await expect(preview.getByRole('alert')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'แก้เงื่อนไข', exact: true })).toBeEnabled();
    await settle(page, info, width, 'promo14-live-catalog-stale');
  });

  test(`PROMO-14 not found, a campaign ended elsewhere, and a permission that disappears while the page is open at ${width}px`, async ({ page }, info) => {
    const w = activeWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-does-not-exist');
    const missing = page.getByRole('alert').filter({ hasText: 'ไม่พบแคมเปญนี้ อาจถูกยกเลิกร่างไปแล้ว กลับไปรายการแคมเปญเพื่อดูข้อมูลล่าสุด' });
    await expect(missing).toBeVisible();
    await expect(missing.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'กลับรายการแคมเปญ', exact: true })).toHaveAttribute('href', '/system/billing/campaigns');
    await settle(page, info, width, 'promo14-not-found');

    await page.goto(`/system/billing/campaigns/${CAMPAIGN_ID}`);
    await page.getByRole('button', { name: 'พักแคมเปญ', exact: true }).click();
    const confirm = page.getByRole('group', { name: 'พักแคมเปญนี้' });
    await confirm.getByLabel('เหตุผล').fill('พักโปร');
    failNext(w, 'POST promotion-campaigns/:id/pause', apiError(409, 'CONTROL_PROMOTION_ENDED'));
    await confirm.getByRole('button', { name: 'ยืนยันพักแคมเปญ', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'แคมเปญนี้จบแล้ว แก้ไข พัก หรือเปิดใหม่ไม่ได้ ถ้าจะจัดรอบใหม่ให้สร้างแคมเปญใหม่' })).toBeVisible();
    await settle(page, info, width, 'promo14-ended-elsewhere');

    failNext(w, 'POST promotion-campaigns/:id/pause', forbidden());
    await confirm.getByRole('button', { name: 'ยืนยันพักแคมเปญ', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ หรือสิทธิ์เพิ่งถูกเปลี่ยน โหลดหน้านี้ใหม่เพื่อดูสิทธิ์ล่าสุด' })).toBeVisible();
    // the buttons that need the permission are gone even though the page was loaded with them
    await expect(page.getByRole('button', { name: 'ยืนยันพักแคมเปญ', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'แก้เงื่อนไข', exact: true })).toHaveCount(0);
    await expect(page.getByText('บัญชีนี้ดูแคมเปญได้อย่างเดียว การแก้ไข เปิด พัก และจบแคมเปญต้องมีสิทธิ์ “ตั้งนโยบาย”')).toBeVisible();
    await settle(page, info, width, 'promo14-permission-gone');
  });
}

/* ================================================================ Round 2: the Admin screens stop at an open request and say what is true ================================================================ */

/** A complete draft whose publication request is open: PREVIEW (its owner may submit or cancel) or AWAITING_APPROVAL (an approver may approve; its owner may cancel). */
function requestWorld(state: 'PREVIEW' | 'AWAITING_APPROVAL', over: { world?: Parameters<typeof newAdminWorld>[0]; actions?: ('submit' | 'approve' | 'cancel')[]; expiresAt?: string; sourceVersion?: number } = {}) {
  const w = newAdminWorld({ reauthUntil: inMs(300_000), ...over.world });
  const record = addCampaign(w, { campaignId: 'camp-new', draft: { operationId: 'draft-1', version: 3, values: completeDraft('camp-new', { startsAt: '2026-10-08T03:00:00.000Z', endsAt: '2026-10-31T16:59:00.000Z', cap: 200 }) } });
  record.operation = openOperation({ state, reason: 'เปิดโปรเดือนตุลาคม', allowedActions: over.actions ?? (state === 'PREVIEW' ? ['submit', 'cancel'] : ['approve', 'cancel']),
    sourceVersion: over.sourceVersion ?? w.settingsVersion, ...(over.expiresAt ? { expiresAt: over.expiresAt } : {}) });
  return { w, record };
}
const LOCKED = 'มีคำขอเปิดแคมเปญค้างอยู่ จึงแก้หรือยกเลิกร่างไม่ได้ ต้องกด “ยกเลิกคำขอ” ก่อน';
const LOCKED_FOR_OWNER = 'มีคำขอเปิดแคมเปญค้างอยู่ จึงแก้หรือยกเลิกร่างไม่ได้ ต้องให้ผู้ส่งคำขอกด “ยกเลิกคำขอ” ก่อน';

for (const width of WIDTHS) {
  for (const state of ['PREVIEW', 'AWAITING_APPROVAL'] as const) test(`PROMO-11 while a request is open (${state}) the draft cannot be edited or discarded, and says why; cancelling the request frees it at ${width}px`, async ({ page }, info) => {
    const { w } = requestWorld(state);
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    const draft = region(page, 'ร่างที่กำลังแก้'), publish = region(page, 'เปิดใช้แคมเปญ');
    await expect(draft.getByRole('note')).toHaveText(LOCKED);
    await expect(draft.getByRole('button', { name: 'แก้ร่าง', exact: true })).toBeDisabled();
    await expect(draft.getByRole('button', { name: 'ยกเลิกร่าง', exact: true })).toBeDisabled();
    await expect(publish.getByRole('button', { name: 'ยกเลิกคำขอ', exact: true })).toBeEnabled();
    await expect(publish).toContainText(state === 'PREVIEW' ? 'ตรวจตัวอย่างแล้ว ส่งคำขอเพื่อให้ผู้อนุมัติยืนยัน' : 'ส่งคำขอแล้ว รอยืนยันเปิดใช้');
    await expect(publish).toContainText(`ใช้คำขอได้ถึง ${thaiDateTime(inMs(600_000))}`);
    await settle(page, info, width, `promo11r2-request-open-${state.toLowerCase()}`);
    await publish.getByRole('button', { name: 'ยกเลิกคำขอ', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'ยกเลิกคำขอแล้ว ยังไม่มีการเปลี่ยนแปลงกับแคมเปญ' })).toBeVisible();
    await expect(draft.getByRole('note')).toHaveCount(0);
    await expect(draft.getByRole('button', { name: 'แก้ร่าง', exact: true })).toBeEnabled();
    await expect(draft.getByRole('button', { name: 'ยกเลิกร่าง', exact: true })).toBeEnabled();
    await expect(publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true })).toBeVisible();
    expect(callsTo(w, 'POST', /\/cancel$/)).toHaveLength(1);
    await settle(page, info, width, 'promo11r2-request-cancelled');
  });

  test(`PROMO-11 a request someone else must cancel says so in the draft's lock sentence, and a paused campaign's "แก้เงื่อนไข" is locked too at ${width}px`, async ({ page }) => {
    // an approver who may also manage, but is not the one who sent the request: no "ยกเลิกคำขอ" of their own
    const { w } = requestWorld('AWAITING_APPROVAL', { actions: ['approve'] });
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    await expect(region(page, 'ร่างที่กำลังแก้').getByRole('note')).toHaveText(LOCKED_FOR_OWNER);
    await expect(region(page, 'ร่างที่กำลังแก้').getByRole('button', { name: 'แก้ร่าง', exact: true })).toBeDisabled();
    // a RESUME request on a paused campaign with no draft: "แก้เงื่อนไข" waits for it as well
    const paused = newAdminWorld({ reauthUntil: inMs(300_000) });
    const record = addCampaign(paused, { campaignId: CAMPAIGN_ID, published: publishedCampaign({ paused: true }) });
    record.operation = openOperation({ state: 'PREVIEW', allowedActions: ['submit', 'cancel'], sourceVersion: paused.settingsVersion });
    await installAdminRoutes(page, paused);
    await page.goto(`/system/billing/campaigns/${CAMPAIGN_ID}`);
    await expect(region(page, 'ร่างที่กำลังแก้').getByRole('note')).toHaveText(LOCKED);
    await expect(region(page, 'ร่างที่กำลังแก้').getByRole('button', { name: 'แก้เงื่อนไข', exact: true })).toBeDisabled();
  });

  // A request that can no longer go on: expired, the billing settings moved after the preview, or the server already answered stale. Only "ยกเลิกคำขอ" is offered, with one sentence that leads out.
  const DEAD = [
    { key: 'expired', build: () => requestWorld('PREVIEW', { expiresAt: inMs(-60_000) }), note: `คำขอนี้หมดอายุเมื่อ ${thaiDateTime(inMs(-60_000))} ยกเลิกคำขอนี้แล้วตรวจสอบก่อนเปิดอีกครั้ง` },
    { key: 'settings-moved', build: () => requestWorld('AWAITING_APPROVAL', { sourceVersion: 5 }), note: 'คำขอนี้ใช้ต่อไม่ได้แล้ว เพราะข้อมูลเปลี่ยนไปหลังตรวจสอบก่อนเปิด ยกเลิกคำขอนี้แล้วตรวจสอบก่อนเปิดอีกครั้ง' },
  ] as const;
  for (const dead of DEAD) test(`PROMO-14 a request that is ${dead.key} offers only "ยกเลิกคำขอ" and one sentence that leads out at ${width}px`, async ({ page }, info) => {
    const { w } = dead.build();
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    const publish = region(page, 'เปิดใช้แคมเปญ');
    await expect(publish.getByRole('alert')).toHaveText(dead.note);
    await expect(publish.getByRole('button')).toHaveText(['ยกเลิกคำขอ']);
    await expect(publish.getByText(/^ใช้คำขอได้ถึง/)).toHaveCount(0);
    await expect(region(page, 'ยืนยันรหัสผ่าน')).toHaveCount(0);
    await expect(region(page, 'ร่างที่กำลังแก้').getByRole('note')).toHaveText(LOCKED);
    await settle(page, info, width, `promo14r2-dead-request-${dead.key}`);
    await publish.getByRole('button', { name: 'ยกเลิกคำขอ', exact: true }).click();
    await expect(publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true })).toBeVisible();
    await expect(region(page, 'ร่างที่กำลังแก้').getByRole('button', { name: 'แก้ร่าง', exact: true })).toBeEnabled();
  });

  test(`PROMO-14 a request the server answered stale is not offered again as it is: only "ยกเลิกคำขอ", then a new review at ${width}px`, async ({ page }, info) => {
    const { w } = requestWorld('AWAITING_APPROVAL');
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-new');
    const publish = region(page, 'เปิดใช้แคมเปญ');
    await expect(publish.getByRole('button', { name: 'อนุมัติและเปิดใช้', exact: true })).toBeEnabled();
    failNext(w, 'POST configuration-changes/:id/approve', apiError(409, 'CONTROL_PREVIEW_STALE'));
    await publish.getByRole('button', { name: 'อนุมัติและเปิดใช้', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'ข้อมูลเปลี่ยนไประหว่างที่เปิดหน้านี้ หรือคำขอหมดอายุ ระบบโหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจสอบอีกครั้งก่อนดำเนินการต่อ' })).toBeVisible();
    // the server leaves the request as it was; the page no longer offers it
    await expect(publish.getByRole('alert').filter({ hasText: 'คำขอนี้ใช้ต่อไม่ได้แล้ว เพราะข้อมูลเปลี่ยนไปหลังตรวจสอบก่อนเปิด ยกเลิกคำขอนี้แล้วตรวจสอบก่อนเปิดอีกครั้ง' })).toBeVisible();
    await expect(publish.getByRole('button')).toHaveText(['ยกเลิกคำขอ']);
    expect(callsTo(w, 'POST', /\/approve$/)).toHaveLength(1);
    await settle(page, info, width, 'promo14r2-answered-stale');
    await publish.getByRole('button', { name: 'ยกเลิกคำขอ', exact: true }).click();
    await publish.getByLabel('เหตุผล').fill('เปิดโปรอีกครั้ง');
    await publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true }).click();
    await expect(publish).toContainText('ตรวจตัวอย่างแล้ว ส่งคำขอเพื่อให้ผู้อนุมัติยืนยัน');
    await expect(publish.getByRole('button', { name: 'ส่งคำขอ', exact: true })).toBeEnabled();
  });

  test(`PROMO-11 "กลับมาเปิด" is not held back by the gaps of a draft: it reopens the published terms at ${width}px`, async ({ page }, info) => {
    const w = newAdminWorld({ reauthUntil: inMs(300_000) });
    addCampaign(w, { campaignId: CAMPAIGN_ID, published: publishedCampaign({ paused: true }), draft: { operationId: 'draft-gaps', version: 2, values: { campaignId: CAMPAIGN_ID, type: 'BONUS_MONTHS', internalName: 'ร่างที่ยังไม่ครบ' } } });
    await adminOpen(page, w, width, `/system/billing/campaigns/${CAMPAIGN_ID}`);
    await expect(region(page, 'ร่างที่กำลังแก้')).toContainText('ร่างยังไม่ครบ');
    const publish = region(page, 'เปิดใช้แคมเปญ');
    await expect(publish.getByRole('button', { name: 'ตรวจสอบก่อนเปิด', exact: true })).toHaveCount(0);
    const resume = publish.getByRole('button', { name: 'กลับมาเปิด', exact: true });
    await expect(resume).toBeDisabled();
    await publish.getByLabel('เหตุผล').fill('ตรวจราคาเสร็จแล้ว');
    await expect(resume).toBeEnabled();
    await expect(publish.getByText(/ร่างยังไม่ครบ เติมข้อมูล|ตัวอย่างพบเรื่องที่ต้องแก้/)).toHaveCount(0);
    await settle(page, info, width, 'promo11r2-resume-with-draft-gaps');
    await resume.click();
    const [call] = callsTo(w, 'POST', /\/preview$/);
    expect(call!.body).toEqual({ expectedVersion: w.settingsVersion, action: 'RESUME', reason: 'ตรวจราคาเสร็จแล้ว' });
    wire(info, 'resume-preview-with-draft-gaps', width, call);
    await expect(publish).toContainText('ตรวจตัวอย่างแล้ว ส่งคำขอเพื่อให้ผู้อนุมัติยืนยัน');
  });

  test(`PROMO-12 the published terms are worded for the status: ใช้อยู่, ตั้งเวลาไว้, พักไว้, จบแล้ว, เผยแพร่ไว้ at ${width}px`, async ({ page }, info) => {
    const w = newAdminWorld();
    const note = (text: string) => `${text} เวลาแสดงเป็นเวลาประเทศไทย`;
    const cases = [
      { id: 'camp-active', status: 'กำลังใช้งาน', title: 'เงื่อนไขที่ใช้อยู่', note: note('ลูกค้าเห็นและใช้สิทธิ์ตามเงื่อนไขนี้') },
      { id: 'camp-scheduled', status: 'ตั้งเวลาแล้ว', title: 'เงื่อนไขที่ตั้งเวลาไว้', note: note('ยังไม่ถึงเวลาเริ่ม ลูกค้ายังใช้สิทธิ์ตามเงื่อนไขนี้ไม่ได้') },
      { id: 'camp-paused', status: 'พัก', title: 'เงื่อนไขที่พักไว้', note: note('ตอนนี้ลูกค้าใช้สิทธิ์ใหม่ตามเงื่อนไขนี้ไม่ได้ รายการที่จองสิทธิ์ไว้แล้วยังได้รับตามเดิม') },
      { id: 'camp-ended', status: 'จบแล้ว', title: 'เงื่อนไขของแคมเปญที่จบแล้ว', note: note('ปิดรับสิทธิ์แล้ว เก็บไว้ให้ดูเป็นประวัติ') },
      { id: 'camp-stale', status: 'ต้องตรวจแพ็กเกจใหม่', title: 'เงื่อนไขที่เผยแพร่ไว้', note: note('ระบบหยุดรับสิทธิ์ใหม่ เพราะราคา โควตา หรือภาษีของแพ็กเกจเปลี่ยนไปจากตอนเปิดแคมเปญ') },
    ] as const;
    addCampaign(w, { campaignId: 'camp-active', published: publishedCampaign({ campaignId: 'camp-active' }) });
    addCampaign(w, { campaignId: 'camp-scheduled', published: publishedCampaign({ campaignId: 'camp-scheduled', startsAt: '2026-11-20T03:00:00.000Z', endsAt: '2026-11-30T16:59:00.000Z' }) });
    addCampaign(w, { campaignId: 'camp-paused', published: publishedCampaign({ campaignId: 'camp-paused', paused: true }) });
    addCampaign(w, { campaignId: 'camp-ended', published: publishedCampaign({ campaignId: 'camp-ended', endedAt: '2026-10-05T10:00:00.000Z' }) });
    addCampaign(w, { campaignId: 'camp-stale', published: publishedCampaign({ campaignId: 'camp-stale' }), stale: true });
    await adminOpen(page, w, width, '/system/billing/campaigns/camp-active');
    for (const item of cases) {
      if (item.id !== 'camp-active') await page.goto(`/system/billing/campaigns/${item.id}`);
      const terms = region(page, item.title);
      await expect(terms, item.id).toBeVisible();
      await expect(terms.locator('p').first()).toHaveText(item.note);
      await expect(page.getByText(item.status, { exact: true }).first()).toBeVisible();
      await settle(page, info, width, `promo12r2-terms-${item.id.replace('camp-', '')}`);
    }
  });

  test(`PROMO-09 the permission note: a view-only account, and a reviewer who may approve but not manage (list and detail) at ${width}px`, async ({ page }, info) => {
    // view-only: nothing waits for it
    const viewOnly = newAdminWorld({ capabilities: READ_ONLY });
    addCampaign(viewOnly, { campaignId: CAMPAIGN_ID, published: publishedCampaign() });
    await adminOpen(page, viewOnly, width, '/system/billing/campaigns');
    await expect(page.getByText('บัญชีนี้ดูแคมเปญได้อย่างเดียว การสร้างแคมเปญต้องมีสิทธิ์ “ตั้งนโยบาย”', { exact: true })).toBeVisible();
    await page.goto(`/system/billing/campaigns/${CAMPAIGN_ID}`);
    await expect(page.getByText('บัญชีนี้ดูแคมเปญได้อย่างเดียว การแก้ไข เปิด พัก และจบแคมเปญต้องมีสิทธิ์ “ตั้งนโยบาย”', { exact: true })).toBeVisible();
    for (const name of ['พักแคมเปญ', 'จบแคมเปญ', 'แก้เงื่อนไข']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await settle(page, info, width, 'promo09r2-note-view-only');
    // approver: a request waits for this account to approve, which it may do; it may not manage
    const approver = newAdminWorld({ capabilities: READ_ONLY });
    const record = addCampaign(approver, { campaignId: 'camp-new', draft: { operationId: 'draft-1', version: 3, values: completeDraft('camp-new', { startsAt: '2026-10-08T03:00:00.000Z', endsAt: '2026-10-31T16:59:00.000Z', cap: 200 }) } });
    record.operation = openOperation({ state: 'AWAITING_APPROVAL', allowedActions: ['approve'], sourceVersion: approver.settingsVersion, initiatorUserId: 'someone-else' });
    await installAdminRoutes(page, approver);
    await page.goto('/system/billing/campaigns');
    await expect(page.getByText('บัญชีนี้อนุมัติคำขอเปิดแคมเปญที่ส่งมาแล้วได้ แต่การสร้างแคมเปญต้องมีสิทธิ์ “ตั้งนโยบาย”', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'สร้างแคมเปญ' })).toHaveCount(0);
    await settle(page, info, width, 'promo09r2-note-approver-list');
    await page.goto('/system/billing/campaigns/camp-new');
    await expect(page.getByText('บัญชีนี้อนุมัติคำขอเปิดแคมเปญที่ส่งมาแล้วได้ แต่การแก้ไข เปิด พัก และจบแคมเปญต้องมีสิทธิ์ “ตั้งนโยบาย”', { exact: true })).toBeVisible();
    await expect(region(page, 'เปิดใช้แคมเปญ').getByRole('button', { name: 'อนุมัติและเปิดใช้', exact: true })).toBeDisabled();
    await expect(region(page, 'ยืนยันรหัสผ่าน')).toBeVisible();
    await expect(region(page, 'ร่างที่กำลังแก้').getByRole('button')).toHaveCount(0);
    await settle(page, info, width, 'promo09r2-note-approver-detail');
  });
}
