/** Cross-repo bundle + real public BFF/API. A LIVE display fixture is explicit; no live Stripe calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { BillingCatalog } from '@watchdog-bms/contracts';

export async function checkBillingMarketing(input: { page: Page; appOrigin: string; directory: string; evidenceDir: string; expectedPro?:{monthlySatang:number;annualSatang:number;annualReceipts:number;branches?:number;members?:number} }) {
  const expected=input.expectedPro??{monthlySatang:99900,annualSatang:999000,annualReceipts:1200};
  const price=(satang:number)=>`฿${(satang/100).toLocaleString('th-TH',{maximumFractionDigits:2})}`;
  const html = await readFile(resolve(input.directory, 'index.html'));
  const script = await readFile(resolve(input.directory, 'billing-catalog.js'));
  const server = createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/billing-catalog.js') { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', req.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    res.end(req.url === '/' ? html : script);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`, page = input.page;
  let displayFixture: 'TEST' | 'LIVE' | 'CHANGED' | 'STALE' | 'ERROR' = 'TEST';
  let catalogRequests = 0;
  const cases: string[] = [];
  const catalogRoute = 'https://mangmeeplus.com/api/public/billing/catalog';
  const pickerRoute = 'https://mangmeeplus.com/billing/companies**';
  await page.route(catalogRoute, async route => {
    catalogRequests++;
    const upstream = await fetch(`${input.appOrigin}/api/public/billing/catalog`);
    assert.equal(upstream.status, 200); assert.equal(upstream.headers.get('access-control-allow-origin'), '*');
    assert.match(upstream.headers.get('cache-control') ?? '', /no-store/);
    const catalog = await upstream.json() as BillingCatalog;
    // R1: the catalog no longer advertises a trial block (Owner 2026-09-20).
    assert.equal(catalog.mode, 'TEST'); assert.equal(catalog.trial, undefined);
    assert.doesNotMatch(JSON.stringify(catalog), /customerId|priceIds|secret|billingEmail|stripeAccountId/);
    if (displayFixture !== 'TEST') catalog.mode = 'LIVE'; // Display-only fixture, never provider mode.
    if (displayFixture === 'CHANGED') catalog.catalogRevision = '0'.repeat(64);
    if (displayFixture === 'STALE') catalog.validUntil = new Date(Date.now() - 1000).toISOString();
    await route.fulfill({ status: displayFixture === 'ERROR' ? 503 : 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(catalog) });
  });
  await page.route(pickerRoute, route => route.fulfill({ status: 302, headers: { location: `${input.appOrigin}${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}` } }));
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const pricing = page.locator('#pricing'), pro = pricing.locator('[data-offer-key="PRO_999"]'), enterprise = pricing.locator('[data-offer-key="ENTERPRISE_1999"]');
    await pro.getByText(price(expected.monthlySatang), { exact: true }).waitFor();
    assert.equal(await pro.getByRole('button').isDisabled(), true, 'TEST mode cannot sell through public marketing');
    assert.match(await pricing.locator('#free-trial-offer').innerText(), /7 เมนู.*15 ใบ/);
    assert.doesNotMatch(await pricing.innerText(), /ซื้อเฉพาะใบ|ซื้อใบเพิ่ม/);
    await pricing.getByRole('button', { name: 'รายปี', exact: true }).click();
    await pro.getByText(price(expected.annualSatang), { exact: true }).waitFor();
    assert.ok((await pro.innerText()).includes(expected.annualReceipts.toLocaleString('th-TH')));assert.match(await pro.innerText(), /ทั้งก้อนทันที/);
    assert.ok((await pro.innerText()).includes(`${expected.branches??5} สาขา · ${expected.members??10} บัญชีผู้ใช้รวมเจ้าของ`));
    assert.match(await enterprise.innerText(), /Coming soon/);
    assert.equal(await enterprise.getByRole('button').isDisabled(), true);
    cases.push('marketing-actual-bundle-public-bff-trial-seven-annual-upfront-test-sales-closed');
    const reload = async () => {
      const previous = catalogRequests;
      await Promise.all([page.waitForResponse(response => response.url() === catalogRoute),
        pricing.getByRole('button', { name: 'ตรวจสอบราคาอีกครั้ง', exact: true }).click()]);
      assert.ok(catalogRequests > previous);
    };
    displayFixture = 'LIVE'; await reload(); await pro.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).waitFor();
    displayFixture = 'CHANGED';
    await pro.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    await pricing.getByRole('status').filter({ hasText: 'ราคา หรือเงื่อนไขเปลี่ยนแล้ว' }).waitFor();
    assert.equal(new URL(page.url()).origin, origin, 'revision change requires another review');
    cases.push('marketing-revision-change-before-click-stays-on-review');
    for (const fault of ['ERROR', 'STALE'] as const) {
      displayFixture = fault; await reload();
      await pricing.getByRole('status').filter({ hasText: 'ตรวจสอบราคาปัจจุบันไม่ได้' }).waitFor();
      assert.equal(await pro.getByRole('button').isDisabled(), true);
      displayFixture = 'LIVE'; await reload(); await pro.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).waitFor();
    }
    cases.push('marketing-unavailable-stale-fail-closed-and-retry-recovers');
    await page.setViewportSize({ width: 390, height: 844 });
    await pricing.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${input.evidenceDir}/${input.expectedPro?'marketing-offer-terms-mobile.png':'marketing-annual-mobile.png'}`, fullPage: false });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await enterprise.getByRole('button').isDisabled(), true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await pro.getByRole('button', { name: 'เลือกแพ็กเกจ', exact: true }).click();
    await page.waitForURL(`${input.appOrigin}/billing/companies?offer=PRO_999&interval=year`);
    await page.getByRole('heading', { name: 'เลือกบริษัทที่จะจัดการแพ็กเกจ', exact: true }).waitFor();
    cases.push('marketing-mobile-and-paid-intent-to-real-authenticated-company-picker');
    return cases;
  } finally {
    await page.unroute(catalogRoute); await page.unroute(pickerRoute);
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  }
}

/** Actual marketing bundle → fixed app signup; assistance remains a separate, unsubmitted lead. */
export async function checkEmailSignupMarketing(input: { page: Page; appOrigin: string; directory: string; evidenceDir: string }) {
  const html = await readFile(resolve(input.directory, 'index.html'));
  const script = await readFile(resolve(input.directory, 'billing-catalog.js'));
  const server = createServer((req, res) => {
    if (!['/', '/billing-catalog.js'].includes(req.url ?? '')) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', req.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    res.end(req.url === '/' ? html : script);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const page = input.page, catalog = 'https://mangmeeplus.com/api/public/billing/catalog', signup = 'https://mangmeeplus.com/signup';
  await page.route(catalog, async route => route.fulfill({ status: 503, body: '{}' }));
  await page.route(signup, route => route.fulfill({ status: 302, headers: { location: `${input.appOrigin}/signup` } }));
  try {
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'ให้ทีมงานช่วยสมัคร', exact: true }).click();
    await page.locator('.tmodal').waitFor();
    assert.equal(new URL(page.url()).hostname, '127.0.0.1');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const start = page.locator('#free-trial-offer').getByRole('button', { name: 'เริ่มใช้ฟรี 30 วัน', exact: true });
    await start.focus(); await page.keyboard.press('Enter');
    await page.waitForURL(`${input.appOrigin}/signup`);
    await page.getByRole('link', { name: 'สมัครด้วยรหัสทางอีเมล ไม่ต้องตั้งรหัสผ่าน', exact: true }).click();
    await page.getByLabel('อีเมลของคุณ', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/email-access');
    return ['marketing actual bundle keyboard CTA→real app signup→email signup; separate assistance form without lead submission'];
  } finally {
    await page.unroute(catalog); await page.unroute(signup);
    await new Promise<void>(done => server.close(() => done()));
  }
}
