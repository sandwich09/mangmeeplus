// Local Chromium proof of the real sibling bundle. Never submits a lead or payment.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(process.env.MANGMEE_WEB_ROOT ?? '../mangmee_web');
const output = resolve(process.env.MARKETING_EVIDENCE_DIR ?? 'test-results/stripe-marketing-2026-09-11');
await mkdir(output, { recursive: true });
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const template = JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
for (const source of [html, template]) {
  const metadata = JSON.parse(source.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(metadata['@graph'].find(row => row['@type'] === 'SoftwareApplication').offers, undefined);
}
assert.ok(!template.includes('ได้ทุกเมื่อ — มีผลรอบบิลถัดไป'));
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.woff2': 'font/woff2' })[extname(file)] ?? 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const posts = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().method() === 'POST') posts.push(route.request().url());
      if (new URL(route.request().url()).origin === origin) return route.continue();
      return route.abort();
    });
    await page.goto(origin);
    const pricing = page.locator('#pricing');
    await expect(pricing).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('#ai-splash')).toBeHidden();
    await pricing.scrollIntoViewIfNeeded();
    const offers = pricing.locator('[data-offer-key]');
    await expect(offers).toHaveCount(5);
    assert.deepEqual(await offers.evaluateAll(rows => rows.map(row => row.dataset.offerKey)), ['FREE_TRIAL', 'STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999']);
    await expect(pricing.locator('[data-offer-key="FREE_TRIAL"]')).toContainText('1 สาขา · พนักงาน 2 คน · อ่านสลิปอัตโนมัติ 15 ใบ/เดือน');
    for (const [key, price, limits, slips] of [
      ['STARTER_249', '฿249', '1 สาขา · พนักงาน 2 คน', '30 ใบ/เดือน'],
      ['BASIC_499', '฿499', '2 สาขา · พนักงาน 5 คน', '50 ใบ/เดือน'],
      ['PRO_999', '฿999', '5 สาขา · พนักงาน 10 คน', '100 ใบ/เดือน'],
      ['ENTERPRISE_1999', '฿1,999', '10 สาขา · พนักงาน 30 คน', '2,000 ใบ/เดือน'],
    ]) {
      const card = pricing.locator(`[data-offer-key="${key}"]`);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toHaveCSS('opacity', '1');
      for (const text of [price, limits, slips]) await expect(card).toContainText(text);
      await expect(card.getByRole('button', { name: 'เร็ว ๆ นี้', exact: true })).toBeDisabled();
      assert.equal(await card.getByRole('button').evaluate(button => button.disabled), true);
      await expect(card.getByRole('button')).toHaveAttribute('aria-describedby', 'paid-offers-unavailable');
      assert.ok(!(await card.textContent()).includes('ทดลองใช้ฟรี'));
    }
    const heading = pricing.getByRole('heading', { name: 'แพ็กเกจที่เหมาะกับร้านคุณ', exact: true });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toHaveCSS('opacity', '1');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}px`);
    await pricing.screenshot({ path: `${output}/pricing-${width}.png` });
    const trial = pricing.getByRole('button', { name: 'ขอทดลองใช้ 30 วัน', exact: true });
    await trial.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('ลงทะเบียนทดลองใช้งานระบบ', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/trial-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByText('ลงทะเบียนทดลองใช้งานระบบ', { exact: true })).toHaveCount(0);
    assert.deepEqual(posts, [], 'no form submission, Stripe or external messaging');
    assert.deepEqual(errors, [], 'no client runtime errors');
    results.push({ width, status: 'PASS', catalog: 5, paidDisabled: 4, trialKeyboard: 'PASS', externalPostCount: posts.length });
    await page.close();
  }
  if (process.env.MARKETING_FAILURE_PROOF === '1') {
    for (const width of [1440, 390]) for (const form of ['trial', 'contact']) {
      for (const outcome of ['offline', '500', 'malformed', 'refused', 'success']) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = []; let posts = 0;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
          const req = route.request();
          if (req.method() === 'POST') {
            assert.equal(req.url(), 'https://api.web3forms.com/submit'); posts++;
            if (outcome === 'offline') return route.abort();
            return route.fulfill({ status: outcome === '500' ? 500 : 200,
              body: outcome === 'malformed' ? 'not-json' : JSON.stringify({ success: outcome === 'success' }),
              contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } });
          }
          return new URL(req.url()).origin === origin ? route.continue() : route.abort();
        });
        await page.goto(origin); await expect(page.locator('#ai-splash')).toBeHidden({ timeout: 45_000 });
        if (form === 'trial') {
          await page.locator('#pricing').getByRole('button', { name: 'ขอทดลองใช้ 30 วัน', exact: true }).click();
          await page.getByPlaceholder('ชื่อจดทะเบียนบริษัท หรือชื่อร้านค้า').fill('Local test shop');
          await page.getByPlaceholder('เช่น ร้านเสริมสวย ร้านอาหาร ร้านค้าปลีก').fill('ร้านค้าปลีก');
          await page.locator('input[name="vatreg"]').last().check();
          await page.getByPlaceholder('อีเมล', { exact: true }).fill('local-proof@example.test');
          await page.getByPlaceholder('0812345678', { exact: true }).fill('0812345678');
          await page.getByText('ส่งคำขอทดลองใช้', { exact: true }).click();
        } else {
          await page.locator('a[href="mailto:contact@mangmeeplus.com"]').first().click();
          await page.getByPlaceholder('ชื่อ-นามสกุล').fill('Local proof');
          await page.getByPlaceholder('name@example.com', { exact: true }).fill('local-proof@example.test');
          await page.getByPlaceholder('สอบถามเรื่องอะไร บอกรายละเอียดสั้นๆ ได้เลย').fill('Local intercepted proof only');
          await page.getByText('ส่งข้อความ', { exact: true }).click();
        }
        const success = page.getByText(form === 'trial' ? 'ส่งคำขอทดลองใช้แล้ว' : 'ส่งข้อความเรียบร้อยแล้ว', { exact: true });
        if (outcome === 'success') await expect(success).toBeVisible();
        else {
          await expect(page.getByText('ยังส่งข้อมูลไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองอีกครั้ง หรือติดต่อ 098-256-5628', { exact: true })).toBeVisible();
          await expect(success).toHaveCount(0);
          await expect(page.getByPlaceholder(form === 'trial' ? 'ชื่อจดทะเบียนบริษัท หรือชื่อร้านค้า' : 'ชื่อ-นามสกุล')).toHaveValue(form === 'trial' ? 'Local test shop' : 'Local proof');
          if (outcome === 'offline') await page.screenshot({ path: `${output}/${form}-failure-${width}.png` });
        }
        assert.equal(posts, 1); assert.deepEqual(errors, []);
        results.push({ width, form, outcome, status: 'PASS', externalDelivery: false });
        await page.close();
      }
    }
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ mode: 'REAL_LOCAL_MARKETING_BUNDLE', results, stripePayment: 'NOT_RUN', leadSubmission: process.env.MARKETING_FAILURE_PROOF === '1' ? 'SIMULATED_PROVIDER_RESPONSE' : 'NOT_RUN' }, null, 2) + '\n');
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
