import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, devices, webkit } from '@playwright/test';
import { readHalloweenProvenance } from '../../../apps/web/src/features/public-home/home-halloween-provenance.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:43841';
const profiles = [
  ['chromium-390', chromium, { viewport: { width: 390, height: 844 }, hasTouch: true }, 'no-preference'],
  ['chromium-1280', chromium, { viewport: { width: 1280, height: 900 } }, 'no-preference'],
  ['android-chromium', chromium, devices['Pixel 7'], 'no-preference'],
  ['webkit-iphone', webkit, devices['iPhone 16'], 'reduce'],
];
const results = [];

for (const [name, engine, profile, reducedMotion] of profiles) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...profile, acceptDownloads: true, reducedMotion, timezoneId: 'Asia/Bangkok' });
    await context.addInitScript(() => { window.__escapeNow = 1_800_000_000_000; Date.now = () => window.__escapeNow; });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?preview=events&event=halloween&previewGame=escape`, { waitUntil: 'load' });
    const game = page.locator('[data-halloween-escape-game=ready]');
    await game.waitFor();
    assert.equal(await page.getByRole('heading', { name: 'คฤหาสน์ไร้ทางออก', exact: true }).isVisible(), true);
    assert.match(await game.innerText(), /60 วินาที.*ตอบผิด เวลาหาย 5 วินาที/s);
    await page.getByRole('button', { name: 'เข้าคฤหาสน์', exact: true }).click();
    await page.locator('[data-halloween-escape-game=playing]').waitFor();

    const wrongPortrait = page.locator('.halloween-portraits button:not(.is-different)').first();
    await wrongPortrait.click();
    await page.waitForFunction(() => document.querySelector('.halloween-escape-status>span:nth-child(2) b')?.textContent === '55');
    assert.match(await page.locator('.halloween-escape-message').innerText(), /เวลาหาย 5 วินาที/);
    await page.locator('.halloween-portraits .is-different').click();
    await page.locator('.halloween-candle-sequence').waitFor();
    const sequence = await page.locator('.halloween-candle-sequence span').evaluateAll(elements => elements.map(element => element.className));
    await page.locator('.halloween-candle-buttons').waitFor();
    for (const className of sequence) await page.locator(`.halloween-candle-buttons .${className}`).click();
    await page.locator('.halloween-key-buttons').waitFor();
    const clueText = await page.locator('.halloween-escape-clues').innerText();
    const keyButtons = await page.locator('.halloween-key-buttons button').all();
    let answer;
    for (const candidate of keyButtons) {
      const label = await candidate.getAttribute('aria-label');
      if (label && clueText.includes(label.replace('กุญแจ', '').replace(/ (สี(?:อำพัน|ม่วง|เขียว))$/, '')) && clueText.includes(label.match(/สี(?:อำพัน|ม่วง|เขียว)/)?.[0] ?? '')) answer = candidate;
    }
    assert.ok(answer, `${name}: the two visible clues identify one key`);
    await answer.click();
    await page.locator('[data-halloween-escape-game=result]').waitFor();
    await page.waitForFunction(() => !document.querySelector('.home-halloween-share-primary')?.disabled);

    const layout = await page.evaluate(() => ({
      viewport: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      root: (() => { const box = document.querySelector('[data-halloween-escape-game]')?.getBoundingClientRect(); return box && { left: box.left, right: box.right }; })(),
      social: [...document.querySelectorAll('.home-halloween-share-platforms button')].map(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }; }),
    }));
    assert.ok(layout.pageWidth <= layout.viewport, `${name}: no horizontal overflow`);
    assert.ok(layout.root.left >= -1 && layout.root.right <= layout.viewport + 1, `${name}: game stays inside viewport`);
    assert.ok(layout.social.every(target => target.width >= 44 && target.height >= 44), `${name}: share targets stay touch friendly`);

    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'บันทึกภาพ', exact: true }).click();
    const download = await pending;
    const path = await download.path();
    const bytes = await readFile(path);
    const dimensions = await page.evaluate(async base64 => {
      const image = new Image();
      image.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: 'image/jpeg' }));
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, bytes.toString('base64'));
    assert.deepEqual(dimensions, { width: 1080, height: 1920 });
    const provenance = readHalloweenProvenance(bytes);
    assert.equal(provenance?.source, 'https://mangmeeplus.com');
    assert.match(provenance?.cardId ?? '', /^escape-/);
    assert.deepEqual(errors, [], `${name}: no page errors`);
    results.push({ name, version: browser.version(), reducedMotion, layout, dimensions, provenance, errors });
  } finally { await browser.close(); }
}

console.log(JSON.stringify({ status: 'pass', limitation: 'Desktop engines with Pixel 7 and iPhone 16 profiles; not physical phones or installed social apps.', results }, null, 2));
