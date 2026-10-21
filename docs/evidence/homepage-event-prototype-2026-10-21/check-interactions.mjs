import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = 'http://127.0.0.1:43831/?preview=events&event=halloween';
const dir = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const errors = [];
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390, isMobile: width === 390, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('.home-event-tools summary').click();
    const tap = (x, y) => width === 390 ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
    await tap(width / 2, 280);
    assert.equal(await page.locator('.home-event-bat').count(), 6, `${width}: native click/tap`);
    const initial = await page.locator('.home-event-bat').first().evaluate(el => getComputedStyle(el).transform);
    await page.waitForTimeout(180);
    assert.notEqual(await page.locator('.home-event-bat').first().evaluate(el => getComputedStyle(el).transform), initial, 'bats scatter');
    assert.equal(await page.locator('.home-event-interactions').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await page.screenshot({ path: `${dir}cozy-bats-${width}.png` });
    await page.waitForFunction(() => !document.querySelector('.home-event-burst'));
    console.log(`${width}: input, animation, expiry and cap pass`);
    for (let i = 0; i < 7; i++) await tap(width / 2, 280);
    assert.equal(await page.locator('.home-event-burst').count(), 3, 'rapid bursts capped');
    assert.equal(await page.locator('.home-event-bat').count(), 18);
    await page.waitForFunction(() => !document.querySelector('.home-event-burst'));

    if (width === 390) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 600 }] });
      for (const y of [560, 500, 440, 360]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y }] });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(await page.locator('.home-event-bat').count(), 0, 'swipe does not trigger burst');
      assert.ok(await page.evaluate(() => scrollY) > 0, 'swipe still scrolls');
      await cdp.detach();
    }

    let visible = 0;
    let hidden = 0;
    const positions = [];
    const scrollSamples = width === 390 ? Array.from({ length: 96 }, (_, i) => i * 160) : [0, 600, 1200, 2500, 4000, 6000, 9000, 12000, 15000];
    for (const y of scrollSamples) {
      await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), y);
      await page.waitForTimeout(80);
      const state = await page.locator('.home-event-slide-ghost').evaluate(el => {
        const rect = el.getBoundingClientRect();
        const opacity = getComputedStyle(el).opacity;
        const overlaps = [...document.querySelectorAll('.public-home .pg :is(h1,h2,h3,h4,p,a,button,summary,input,select,figure,li,dt,dd,img,.tbl,.docs-row,.card,.mbar), .home-event-tools')].filter(other => {
          const box = other.getBoundingClientRect();
          return box.width && box.height && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;
        });
        return { top: rect.top, opacity, overlap: overlaps.length, overflow: rect.right > innerWidth || rect.left < 0 };
      });
      positions.push(state.top);
      assert.equal(state.overflow, false);
      if (state.opacity === '1') {
        assert.equal(state.overlap, 0, `${width}: ghost avoids content at scroll ${y}`);
        visible++;
        if (visible === 1) await page.screenshot({ path: `${dir}cozy-scroll-ghost-${width}.png` });
      } else hidden++;
    }
    assert.ok(visible > 0, `${width}: ghost can be seen`);
    assert.ok(positions.at(-1) > positions[0], 'ghost slides downward with scroll');
    if (width === 390) assert.ok(hidden > 0, 'phone ghost hides near content');
    console.log(`${width}: ghost clearance pass (${visible} visible / ${hidden} hidden)`);

    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.locator('.home-event-tools summary').click();
    await tap(width / 2, 280);
    await page.locator('#home-event-pause').check();
    assert.equal(await page.locator('.home-event-bat').count(), 0, 'pause clears active bats');
    await tap(width / 2, 280);
    assert.equal(await page.locator('.home-event-bat').count(), 0, 'pause blocks new bats');
    assert.equal(await page.locator('.home-event-interactions').isVisible(), false);
    await page.locator('#home-event-pause').uncheck();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await tap(width / 2, 280);
    assert.equal(await page.locator('.home-event-bat').count(), 0, 'reduced motion blocks bats');
    assert.equal(await page.locator('.home-event-interactions').isVisible(), false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log(`${width}: pause and reduced motion pass`);

    await page.locator('.hero .acts a[href="#pricing"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.home-event-bat').count(), 0, 'keyboard link works without burst');
    await page.getByRole('button', { name: /^จ่ายรายปี/ }).click();
    assert.equal(await page.getByRole('button', { name: /^จ่ายรายปี/ }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.home-event-bat').count(), 6, 'button remains clickable with burst');
    console.log(`${width}: keyboard and existing control pass`);
    await page.locator('.home-event-tools a').filter({ hasText: 'ปกติ' }).click();
    await page.waitForURL(url => url.searchParams.get('event') === 'default');
    await tap(width / 2, 280);
    assert.equal(await page.locator('.home-event-interactions, .home-event-bat').count(), 0, 'theme switch removes effects');
    await page.locator('.home-event-tools a').filter({ hasText: 'ฮาโลวีน' }).click();
    await page.waitForURL(url => url.searchParams.get('event') === 'halloween');
    await tap(width / 2, 280);
    assert.equal(await page.locator('.home-event-bat').count(), 6, 'remount has one click listener');
    await page.locator('a[href="/login"]').first().click();
    await page.waitForURL('**/login');
    await tap(width / 2, 280);
    assert.equal(await page.locator('.home-event-interactions, .home-event-bat').count(), 0, 'navigation removes effects');
    results.push({ width, input: width === 390 ? 'touch + swipe' : 'mouse', visibleGhostSamples: visible, hiddenGhostSamples: hidden, status: 'pass' });
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${dir}interaction-results.json`, JSON.stringify({ status: 'pass', results, errors }, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); console.log('Browser closed.'); }
