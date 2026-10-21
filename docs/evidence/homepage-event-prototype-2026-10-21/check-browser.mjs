import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = 'http://127.0.0.1:43831';
const dir = fileURLToPath(new URL('.', import.meta.url));
const baseline = process.argv.includes('--baseline');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ reducedMotion: 'reduce' });
const page = await context.newPage();
const results = [];
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
try {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const capture = await page.locator('.public-home').evaluate(root => ({
      text: root.innerText,
      links: [...root.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]),
      sections: [...root.querySelectorAll('main > section')].map(el => {
        const box = el.getBoundingClientRect();
        return { id: el.id, x: box.x, y: box.y, width: box.width, height: box.height };
      }),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.equal(capture.overflow, false);
    if (baseline) {
      writeFileSync(`${dir}baseline-${width}.json`, JSON.stringify(capture, null, 2));
      await page.screenshot({ path: `${dir}baseline-home-${width}.png` });
      if (width === 1280) await page.screenshot({ path: `${dir}baseline-full-${width}.png`, fullPage: true });
    } else {
      assert.deepEqual(capture, JSON.parse(readFileSync(`${dir}baseline-${width}.json`, 'utf8')));
    }
    results.push({ width, baseline: baseline ? 'captured' : 'identical' });
  }
  if (!baseline) {
    for (const width of [360, 390, 768, 1280, 1536]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
      await page.goto(`${base}/?preview=events&event=halloween`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('.public-home').getAttribute('data-home-event'), 'halloween');
      assert.equal(await page.locator('[data-event-art]').count(), 6);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} overflow`);
      const actual = await page.locator('.public-home .pg').innerText();
      if (width === 390 || width === 1280) {
        const original = JSON.parse(readFileSync(`${dir}baseline-${width}.json`, 'utf8'));
        assert.equal(actual, original.text, `${width} content`);
        const sections = await page.locator('.public-home main > section').evaluateAll(els => els.map(el => {
          const box = el.getBoundingClientRect();
          return { id: el.id, x: box.x, y: box.y, width: box.width, height: box.height };
        }));
        assert.deepEqual(sections, original.sections, `${width} layout`);
      }
      await page.locator('.home-event-tools summary').click();
      await page.screenshot({ path: `${dir}cozy-home-${width}.png` });
      if (width === 390 || width === 1280) {
        await page.screenshot({ path: `${dir}cozy-full-${width}.png`, fullPage: true });
        await page.locator('#faq').evaluate(el => scrollTo(0, el.getBoundingClientRect().top + scrollY - 150));
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: `${dir}cozy-faq-${width}.png` });
        await page.locator('.foot').evaluate(el => scrollTo(0, el.getBoundingClientRect().top + scrollY - 200));
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: `${dir}cozy-footer-${width}.png` });
        if (width === 390) {
          await page.locator('.stage').evaluate(el => scrollTo(0, el.getBoundingClientRect().bottom + scrollY - 720));
          await page.waitForLoadState('networkidle');
          await page.screenshot({ path: `${dir}cozy-stage-${width}.png` });
        }
      }
      assert.equal(await page.locator('[data-event-art]').evaluateAll(els => els.every(el => getComputedStyle(el).pointerEvents === 'none')), true);
      assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.animationName?.startsWith('home-event-')).length), 0, 'reduced motion');
      results.push({ width, halloween: 'content/layout/overflow/reduced-motion pass' });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`${base}/?preview=events&event=halloween`, { waitUntil: 'networkidle' });
    const broom = page.locator('.home-event-broom');
    const before = await broom.evaluate(el => getComputedStyle(el).transform);
    await page.waitForTimeout(350);
    assert.notEqual(await broom.evaluate(el => getComputedStyle(el).transform), before, 'broom animates');
    await page.locator('#home-event-pause').check();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await broom.evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
    const paused = await broom.evaluate(el => getComputedStyle(el).transform);
    await page.waitForTimeout(350);
    assert.equal(await broom.evaluate(el => getComputedStyle(el).transform), paused, 'pause freezes the broom');
    await page.locator('.home-event-tools a').filter({ hasText: 'ปกติ' }).click();
    await page.waitForURL(url => url.searchParams.get('event') === 'default');
    assert.equal(await page.locator('[data-event-art]').count(), 0, 'client switch removes artwork');
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.animationName?.startsWith('home-event-')).length), 0, 'client switch removes event animation');
    await page.locator('.home-event-tools a').filter({ hasText: 'ฮาโลวีน' }).click();
    await page.waitForURL(url => url.searchParams.get('event') === 'halloween');
    await page.locator('#home-event-pause').uncheck();
    assert.equal(await page.locator('[data-event-art]').count(), 6);
    await page.locator('.hero .acts a[href="#pricing"]').click();
    await page.getByRole('button', { name: /^จ่ายรายปี/ }).click();
    assert.equal(await page.getByRole('button', { name: /^จ่ายรายปี/ }).getAttribute('aria-pressed'), 'true');
    await page.locator('.faq details').first().locator('summary').click();
    assert.equal(await page.locator('.faq details').first().getAttribute('open'), '');
    await page.getByRole('button', { name: /^ขยายภาพ/ }).first().click();
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    results.push({ interactions: 'animation/pause/client theme switch/pricing/FAQ/document dialog pass' });

    await page.goto(`${base}/?preview=events&event=unknown`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-event-art]').count(), 0);
    await page.goto(`${base}/?event=halloween`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-event-art], .home-event-tools').count(), 0);
    for (const path of ['/login', '/privacy']) {
      await page.goto(`${base}/?preview=events&event=halloween`, { waitUntil: 'networkidle' });
      const assetRequests = [];
      // Scrolling to the footer link may load the departing homepage's lazy artwork.
      const listener = req => { if (new URL(page.url()).pathname === path && req.url().includes('/home/events/')) assetRequests.push(req.url()); };
      page.on('request', listener);
      await page.locator(`a[href="${path}"]`).first().click();
      await page.waitForURL(`${base}${path}`);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.public-home, [data-event-art], .home-event-tools').count(), 0);
      assert.equal(assetRequests.length, 0, `${path} event assets`);
      await page.screenshot({ path: `${dir}isolation-${path.slice(1)}.png` });
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      assert.equal(assetRequests.length, 0, `${path} direct load event assets`);
      page.off('request', listener);
      results.push({ route: path, isolation: 'no event DOM or asset requests after navigation' });
    }
    assert.deepEqual(pageErrors, [], 'no uncaught browser errors');
    writeFileSync(`${dir}browser-results.json`, JSON.stringify({ status: 'pass', results, pageErrors }, null, 2));
  }
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
