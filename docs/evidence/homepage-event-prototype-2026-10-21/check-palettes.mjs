import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = 'http://127.0.0.1:43831/';
const dir = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ reducedMotion: 'reduce' });
page.setDefaultTimeout(10_000);
page.setDefaultNavigationTimeout(15_000);
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
try {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const baseline = JSON.parse(readFileSync(`${dir}baseline-${width}.json`, 'utf8'));
    for (const palette of ['forest', 'pumpkin', 'plum']) {
      await page.goto(`${base}?preview=events&event=halloween&palette=${palette}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('.public-home').getAttribute('data-home-palette'), palette);
      assert.equal(await page.locator('.pg').innerText(), baseline.text);
      const sections = await page.locator('.public-home main > section').evaluateAll(els => els.map(el => {
        const box = el.getBoundingClientRect();
        return { id: el.id, x: box.x, y: box.y, width: box.width, height: box.height };
      }));
      assert.deepEqual(sections, baseline.sections, `${palette} ${width}: unchanged layout`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.ok(await page.locator('.home-event-palettes a').evaluateAll(els => els.every(el => el.getBoundingClientRect().height >= 44)));
      await page.locator('.home-event-tools summary').click();
      await page.screenshot({ path: `${dir}palette-${palette}-${width}.png` });
      if (palette === 'plum') {
        assert.equal(await page.locator('.home-event-middle .home-event-star').count(), 8);
        assert.equal(await page.locator('.home-event-middle').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
        assert.match(await page.locator('#use').evaluate(el => getComputedStyle(el, '::before').backgroundImage), /linear-gradient/);
        assert.equal(await page.locator('.home-event-middle .home-event-star').first().evaluate(el => getComputedStyle(el).animationName), 'none', 'middle stars respect reduced motion');
        for (const selector of ['#pricing', '#use', '.mm', '.safe', '.close']) {
          await page.locator(selector).evaluate(el => scrollTo({ top: el.getBoundingClientRect().top + scrollY - 100, behavior: 'instant' }));
          await page.waitForLoadState('networkidle');
          await page.screenshot({ path: `${dir}palette-plum-${selector.slice(1)}-${width}.png` });
        }
      }
      results.push({ width, palette, content: 'identical', layout: 'identical', overflow: false });
    }
  }

  await page.goto(`${base}?preview=events&event=halloween`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.public-home').getAttribute('data-home-palette'), 'plum', 'Halloween defaults to the approved plum palette');
  for (const [name, palette] of [['ครีมฟักทอง', 'pumpkin'], ['ม่วงพลัม', 'plum'], ['เขียวป่า', 'forest']]) {
    await page.getByRole('link', { name, exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('palette') === palette);
    await page.waitForFunction(palette => document.querySelector('.public-home')?.getAttribute('data-home-palette') === palette, palette);
  }
  await page.getByRole('link', { name: 'ม่วงพลัม', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('palette') === 'plum');
  await page.getByRole('link', { name: 'ปกติ', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('event') === 'default');
  assert.equal(await page.locator('.public-home').getAttribute('data-home-palette'), null);
  assert.equal(await page.locator('[data-event-art]').count(), 0);
  await page.getByRole('link', { name: 'ฮาโลวีน', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('event') === 'halloween');
  assert.equal(await page.locator('.public-home').getAttribute('data-home-palette'), 'plum');
  await page.getByRole('button', { name: /^จ่ายรายปี/ }).click();
  assert.equal(await page.getByRole('button', { name: /^จ่ายรายปี/ }).getAttribute('aria-pressed'), 'true');
  await page.locator('.faq details summary').first().click();
  assert.equal(await page.locator('.faq details').first().getAttribute('open'), '');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#home-event-pause').check();
  assert.equal(await page.locator('.home-event-broom').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  assert.equal(await page.locator('.home-event-middle .home-event-star').first().evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  await page.locator('#home-event-pause').uncheck();
  for (const query of ['palette=unknown', 'palette=plum&palette=pumpkin']) {
    await page.goto(`${base}?preview=events&event=halloween&${query}`);
    assert.equal(await page.locator('.public-home').getAttribute('data-home-palette'), 'plum');
  }
  await page.goto(`${base}?event=halloween&palette=plum`);
  assert.equal(await page.locator('.public-home').getAttribute('data-home-palette'), null);
  assert.equal(await page.locator('.home-event-tools, [data-event-art]').count(), 0);
  assert.deepEqual(errors, []);
  writeFileSync(`${dir}palette-results.json`, JSON.stringify({ status: 'pass', results, selection: 'client swatches, normal restore, retained choice and fallback pass', interactions: 'pricing, FAQ and pause pass', errors }, null, 2));
  console.log('Palette comparisons, baseline parity, selection/fallback and interactions passed.');
} finally { await browser.close(); }
