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
import { ATTEMPT_ID, CAMPAIGN_ID, CAMPAIGN_NAME, FIXED_NOW, READ_ONLY, STARTER_RULES, addCampaign, addMonths, apiError, apiMessage, completeDraft, defaultCustomerWorld, failNext, forbidden, heldTicket,
  heldTicketView, inDays, inMs, installAdminRoutes, installCustomerRoutes, invoiceItem, newAdminWorld, newShopStatus, openOperation, paidShopStatus, promotionRows, promotionUnavailableAnswer,
  promotionUse, publishedCampaign, reportCompany, reportPage, thaiDateTime, thaiDay, trialShopStatus, type AdminWorld, type CustomerWorld } from './billing-promotion.fixture';

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
    await expect(choice).toContainText('ใช้ได้ครั้งละ 1 อย่างต่อการซื้อ สิ่งที่ไม่ได้เลือกจะไม่ถูกใช้');
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

  // DEFECT FXE-D6 (phone only: at 1280 the block is on the first screen): after "เลือกแพ็กเกจนี้" the review opens on the document box, the tax lines and a big "ชำระวันนี้ ฿249.00"; the block
  // that says what the promotion gives (paid and free time, receipts) starts at the very bottom of a 390x844 first screen (28% of it in view). BillingPage.tsx:832 renders it after the VAT sentence.
  (width === 390 ? test.fixme : test)(`PROMO-02 the review's first screen already shows what the promotion gives (the promotion block is in view without scrolling) at ${width}px`, async ({ authedPage: page, companyId }) => {
    const w = defaultCustomerWorld(companyId);
    await openChooser(page, w, width);
    await buyStarter(page).click();
    await expect(promoReviewOf(page)).toBeVisible();
    await page.waitForTimeout(600);
    await expect(promoReviewOf(page)).toBeInViewport({ ratio: 0.5 });
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
    const open = { paymentState: 'PENDING', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, canCancelCheckout: true,
      promotion: promotionUse({ state: 'RESERVED', paidEnd: null, benefitEnd: null, renewalSetupState: 'PENDING', expectedNextChargeAt: null }) } as const;
    const w = reason === 'PURCHASE_KIND_UNSUPPORTED'
      ? defaultCustomerWorld(companyId, paidShopStatus(companyId, { promotions: promotionRows(reason), availablePurchaseModes: ['CARD_AUTO'] }))
      : defaultCustomerWorld(companyId, newShopStatus(companyId, { promotions: promotionRows(reason), ...(reason === 'IN_PROGRESS' ? open : {}) }));
    if (reason === 'PURCHASE_KIND_UNSUPPORTED') w.purchase = 'REPEAT';
    if (reason === 'IN_PROGRESS') {
      await installCustomerRoutes(page, w);
      await openAt(page, width, `/companies/${companyId}/billing`);
      await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toContainText('จองสิทธิ์โปรโมชั่นไว้ให้รายการชำระนี้แล้ว');
      await settle(page, info, width, 'promo04-in-progress-overview');
      await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    } else await openChooser(page, w, width);
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
  const w = defaultCustomerWorld(companyId, paidShopStatus(companyId, { renewalMode: 'CARD_ONCE', subscriptionState: 'NONE', nextChargeAt: null, paidThrough: previous, termEndsAt: previous,
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
    // the other tab already opened a payment holding the right: the next status read shows it
    w.status = newShopStatus(companyId, { promotions: promotionRows('IN_PROGRESS'), paymentState: 'PENDING', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, canCancelCheckout: true,
      promotion: promotionUse({ state: 'RESERVED', paidEnd: null, benefitEnd: null, renewalSetupState: 'PENDING', expectedNextChargeAt: null }) });
    await confirmCheckout(page);
    const lost = page.getByRole('alert').filter({ hasText: 'โปรโมชั่นที่เลือกไว้ใช้ไม่ได้แล้ว' });
    await expect(lost).toBeVisible();
    await expect(lost).toContainText(REASON.IN_PROGRESS);
    await expect(lost).toContainText('เปิดรายการเดิมที่ค้างอยู่ด้านล่างเพื่อชำระต่อ ไม่ต้องเริ่มรายการใหม่');
    await expect(lost.getByRole('button', { name: 'ตรวจสอบรายการใหม่' })).toHaveCount(0);
    await expect(reviewOf(page)).toHaveCount(0);
    await expect(regionNamed(page, 'เลือกแพ็กเกจ')).toHaveCount(0);
    // "below": the open payment and its way back are on the page
    await expect(page.getByRole('button', { name: 'กลับไปยังรายการเดิม', exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toContainText('จองสิทธิ์โปรโมชั่นไว้ให้รายการชำระนี้แล้ว');
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

  // DEFECT FXE-D2: the notice is rendered above the tabs (BillingPage.tsx:505) and nothing scrolls to it. After a refused quote the buyer is ~1000px below it;
  // after a refused checkout the effect at BillingPage.tsx:130 scrolls to the chooser heading, which sits below the notice, so the notice ends up under the sticky header.
  for (const refused of ['quote', 'checkout'] as const) test.fixme(`PROMO-05 the lost-promotion notice is on screen after the ${refused} is refused (a person can see it) at ${width}px`, async ({ authedPage: page, companyId }) => {
    const w = defaultCustomerWorld(companyId);
    if (refused === 'quote') w.quoteOverride = n => n === 1 ? promotionUnavailableAnswer('CAP_FULL') : undefined; else w.checkoutOverride = n => n === 1 ? promotionUnavailableAnswer('CHANGED') : undefined;
    await openChooser(page, w, width);
    await buyStarter(page).click();
    if (refused === 'checkout') await confirmCheckout(page);
    const lost = page.getByRole('alert').filter({ hasText: 'โปรโมชั่นที่เลือกไว้ใช้ไม่ได้แล้ว' });
    await expect(lost).toBeVisible();
    await page.waitForTimeout(600);
    expect((await inViewNow(lost)).visibleToBuyer).toBe(true);
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
    await expect(choice.locator('p')).toHaveText(['ใช้ได้ครั้งละ 1 อย่างต่อการซื้อ สิ่งที่ไม่ได้เลือกจะไม่ถูกใช้', 'ลดเฉพาะบิลแรก รอบถัดไปคิดราคาเต็ม งานเดียวกันใช้ได้ร้านละครั้ง']);
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
    await expect(page.getByRole('button', { name: 'ตรวจผลการชำระเงินอีกครั้ง', exact: true })).toHaveCount(state.recheck ? 1 : 0);
    await expect(page.getByRole('heading', { name: 'แพ็กเกจปัจจุบัน', exact: true })).toBeVisible();
    await expect(regionNamed(page, 'สถานะแพ็กเกจ')).toContainText(until);
    await settle(page, info, width, `promo08-${state.key.toLowerCase()}`);
  });
}

for (const width of WIDTHS) {
  test(`PROMO-08 a payment still open holds the right: "reserved", never worded as used at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { paymentState: 'PENDING', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, canCancelCheckout: true, allowedActions: [], promotions: undefined,
      promotion: promotionUse({ state: 'RESERVED', paidEnd: null, benefitEnd: null, renewalSetupState: 'PENDING', expectedNextChargeAt: null }) }));
    await openOverview(page, w, width);
    const block = page.getByRole('status', { name: 'สถานะโปรโมชั่น' });
    await expect(block.locator('p')).toHaveText(['จองสิทธิ์โปรโมชั่นไว้ให้รายการชำระนี้แล้ว', nameLine, 'สิทธิ์จะเริ่มใช้เมื่อชำระเงินสำเร็จ']);
    await expect(block).not.toContainText(/ใช้สิทธิ์โปรโมชั่นแล้ว|ใช้ได้ถึง/);
    await expect(page.getByRole('button', { name: 'กลับไปยังรายการเดิม', exact: true })).toBeVisible();
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
      await expect(page.getByRole('button', { name: 'ตรวจผลการชำระเงินอีกครั้ง', exact: true })).toBeVisible();
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

  // Round 2: an open payment the reconciler expired before it ever started is refused on "กลับไปยังรายการเดิม" with its own sentence ("เริ่มรายการใหม่"), and the right is back.
  test(`PROMO-08 resuming a payment that never started says so in plain Thai, and the shop can start again with the promotion at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    const open = { paymentState: 'PENDING', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, canCancelCheckout: true, allowedActions: ['new_sales'],
      promotion: promotionUse({ state: 'RESERVED', paidEnd: null, benefitEnd: null, renewalSetupState: 'PENDING', expectedNextChargeAt: null }) } as const;
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { ...open, allowedActions: [...open.allowedActions], promotions: undefined }));
    w.resumeOverride = () => ({ status: 409, json: { code: 'BILLING_CHECKOUT_NOT_STARTED', message: 'Checkout was never started' } });
    await openOverview(page, w, width);
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toContainText('จองสิทธิ์โปรโมชั่นไว้ให้รายการชำระนี้แล้ว');
    // the reconciler has expired it by the time the buyer taps: the next read shows a free shop and the right back on offer
    w.status = newShopStatus(companyId, { promotions: promotionRows() });
    await page.getByRole('button', { name: 'กลับไปยังรายการเดิม', exact: true }).click();
    const banner = page.getByRole('alert').filter({ hasText: 'รายการชำระเงินนี้ยังไม่ได้เริ่ม ระบบยกเลิกให้แล้ว กรุณาเริ่มรายการใหม่' });
    await expect(banner).toBeVisible();
    await page.waitForTimeout(500);
    wire(info, 'resume-refused-position', width, await inViewNow(banner));
    await firstScreen(page, info, width, 'promo08r2-resume-refused-first-screen');
    await settle(page, info, width, 'promo08r2-resume-not-started');
    // "ลองใหม่" in the banner reads the status again: the dead payment and its reserved right are gone, the shop can choose
    await banner.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toHaveCount(0);
    await page.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).first().click();
    await expect(starterOf(page).getByRole('region', { name: 'โปรโมชั่น เริ่มต้น (STARTER)' })).toBeVisible();
  });

  // DEFECT FXE-D9: the refusal says "ระบบยกเลิกให้แล้ว กรุณาเริ่มรายการใหม่", but `action()`'s catch (BillingPage.tsx:260) only shows the banner: the page keeps the cancelled payment, its
  // "จองสิทธิ์โปรโมชั่นไว้ให้รายการชำระนี้แล้ว" block and "กลับไปยังรายการเดิม" until the buyer finds "ลองใหม่" in the banner. Fix: read the status again when the code is BILLING_CHECKOUT_NOT_STARTED.
  test.fixme(`PROMO-08 after "ยังไม่ได้เริ่ม" the page reads the status itself: the cancelled payment and its reserved right are gone without another tap at ${width}px`, async ({ authedPage: page, companyId }) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { paymentState: 'PENDING', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, canCancelCheckout: true, promotions: undefined,
      promotion: promotionUse({ state: 'RESERVED', paidEnd: null, benefitEnd: null, renewalSetupState: 'PENDING', expectedNextChargeAt: null }) }));
    w.resumeOverride = () => ({ status: 409, json: { code: 'BILLING_CHECKOUT_NOT_STARTED', message: 'Checkout was never started' } });
    await openOverview(page, w, width);
    w.status = newShopStatus(companyId, { promotions: promotionRows() });
    await page.getByRole('button', { name: 'กลับไปยังรายการเดิม', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'รายการชำระเงินนี้ยังไม่ได้เริ่ม' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'สถานะโปรโมชั่น' })).toHaveCount(0);
  });

  // DEFECT FXE-D10 (the same class as D2, for the page's ordinary red banner): the error banner is the first thing on the page (BillingPage.tsx:485) and nothing scrolls to it. After a refused
  // "กลับไปยังรายการเดิม" the buyer is down at that button, the banner is 315px above the 390x844 viewport (177px at 1280), and nothing visibly happens. Same fix as D2: scroll and focus it.
  test.fixme(`PROMO-08 the red error banner is on screen after a refused "กลับไปยังรายการเดิม" (a person can see it) at ${width}px`, async ({ authedPage: page, companyId }) => {
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { paymentState: 'PENDING', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, canCancelCheckout: true, promotions: undefined,
      promotion: promotionUse({ state: 'RESERVED', paidEnd: null, benefitEnd: null, renewalSetupState: 'PENDING', expectedNextChargeAt: null }) }));
    w.resumeOverride = () => ({ status: 409, json: { code: 'BILLING_CHECKOUT_NOT_STARTED', message: 'Checkout was never started' } });
    await openOverview(page, w, width);
    await page.getByRole('button', { name: 'กลับไปยังรายการเดิม', exact: true }).click();
    const banner = page.getByRole('alert').filter({ hasText: 'รายการชำระเงินนี้ยังไม่ได้เริ่ม' });
    await expect(banner).toBeVisible();
    await page.waitForTimeout(500);
    expect((await inViewNow(banner)).visibleToBuyer).toBe(true);
  });

  test(`PROMO-08 a payment that failed leaves the return page without any word about a reserved right at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    // the API no longer sends `promotion` for a RESERVED right on a FAILED / EXPIRED attempt (status carries none either: the right went back)
    const w = defaultCustomerWorld(companyId, newShopStatus(companyId, { paymentState: 'FAILED', attemptId: ATTEMPT_ID, reference: ATTEMPT_ID, promotions: promotionRows() }));
    w.attempt = { attemptId: ATTEMPT_ID, state: 'EXPIRED', errorCode: null, observedAt: FIXED_NOW, paymentState: 'FAILED', applyState: 'NONE', invoiceReference: null };
    await openOverview(page, w, width, `/billing/return?attempt=${ATTEMPT_ID}`);
    await expect(page.getByRole('heading', { name: 'รายการชำระเงินนี้ไม่สำเร็จ', exact: true })).toBeVisible();
    await expect(page.getByText(/จองสิทธิ์|สิทธิ์โปรโมชั่น|ใช้สิทธิ์โปรโมชั่นแล้ว/)).toHaveCount(0);
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
    await expect(active.locator('dd').nth(1)).toHaveText('เริ่มต้น (STARTER) · รายเดือน · เริ่มต้น (STARTER) · รายปี');
    await expect(articleOf(page, 'ร่าง Starter ธ.ค.').locator('dd').nth(1)).toHaveText('เริ่มต้น (STARTER) · รายเดือน');
    await expect(articleOf(page, 'Starter แถมเดือน ต.ค. 2569').getByRole('link')).toHaveAttribute('href', '/system/billing/campaigns/camp-active');
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
  // DEFECT FXE-D5: the row's title link is `inline-flex` with no way to break a long word (BillingCampaignsPage.tsx:96); a 120-character internal name (the allowed maximum)
  // pushes the whole page to 1121px wide at 390px. Fix: add `max-w-full [overflow-wrap:anywhere]` to that link.
  test.fixme(`PROMO-09 the longest internal name (120 characters, no spaces) stays inside the list row at ${width}px`, async ({ page }, info) => {
    await adminOpen(page, longNameWorld(), width, '/system/billing/campaigns');
    await expect(articleOf(page, LONG_INTERNAL)).toBeVisible();
    await settle(page, info, width, 'promo09-long-names-list');
  });

  test(`PROMO-09 the longest internal and customer-facing names (no spaces) stay inside the detail page at ${width}px`, async ({ page }, info) => {
    await adminOpen(page, longNameWorld(), width, '/system/billing/campaigns/camp-long');
    await expect(page.getByRole('heading', { name: LONG_INTERNAL, level: 1 })).toBeVisible();
    await settle(page, info, width, 'promo09-long-names-detail');
  });
}

for (const width of WIDTHS) {
  // DEFECT FXE-D8 (1280 only): at 1280 the three filter columns give the cycle select 193px (BillingCampaignsPage.tsx:59, `sm:grid-cols-[2fr_1fr_1fr_auto]`), and "เริ่มต้น (STARTER) · รายปี" is cut to
  // "เริ่มต้น (STARTER) …" — the one word that says which cycle is filtered (รายเดือน / รายปี) is the one that disappears.
  (width === 1280 ? test.fixme : test)(`PROMO-09 the cycle filter still shows which cycle is chosen (the selected text is not cut off) at ${width}px`, async ({ page }) => {
    const w = everyStatusWorld();
    await adminOpen(page, w, width, '/system/billing/campaigns');
    const select = page.getByRole('combobox', { name: 'แพ็กเกจและรอบ', exact: true });
    await chooseThemedOption(page, select, 'เริ่มต้น (STARTER) · รายปี');
    const cut = await select.evaluate(el => [el, ...Array.from(el.querySelectorAll('*'))].filter(node => getComputedStyle(node).overflowX !== 'visible' && node.scrollWidth > node.clientWidth + 1).length);
    expect(cut, 'elements whose text is cut off').toBe(0);
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
    const resume = region(page, 'เปิดใช้แคมเปญ');
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
