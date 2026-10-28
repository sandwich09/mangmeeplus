import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from '@playwright/test';
import { readHalloweenProvenance } from '../../../apps/web/src/features/public-home/home-halloween-provenance.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:43841';
const dir = fileURLToPath(new URL('.', import.meta.url));
const deadline = Date.parse('2026-10-28T17:00:00Z');
const report = { status: 'running', base, results: [], limitation: 'Installed desktop WebKit with an iPhone profile and desktop Chromium with touch/mobile profiles; not physical phones or installed social apps.' };
const save = () => writeFileSync(`${dir}browser-results.json`, JSON.stringify(report, null, 2));
save();

function imageDimensions(page, bytes) {
  return page.evaluate(async data => {
    const blob = new Blob([Uint8Array.from(atob(data), character => character.charCodeAt(0))], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    } finally { URL.revokeObjectURL(url); }
  }, bytes.toString('base64'));
}

async function press(locator) {
  await locator.evaluate(button => {
    const props = Object.keys(button).find(key => key.startsWith('__reactProps'));
    button[props].onClick();
  });
}

async function openChooser(page) {
  await page.waitForTimeout(600);
  await press(page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true }));
  await page.waitForTimeout(300);
  await page.locator('.home-halloween-dialog').waitFor({ state: 'visible', timeout: 5_000 });
}

async function layout(page, label) {
  const value = await page.evaluate(() => {
    const game = document.querySelector('[data-halloween-candy-game]');
    const root = game?.getBoundingClientRect();
    const targets = [...document.querySelectorAll('.halloween-candy-target')].map(element => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    const social = [...document.querySelectorAll('.home-halloween-share-platforms button')].map(element => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height, name: element.getAttribute('aria-label') };
    });
    return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, root: root && { left: root.left, right: root.right }, targets, social };
  });
  assert.ok(value.pageWidth <= value.viewport, `${label}: no horizontal page overflow`);
  if (value.root) assert.ok(value.root.left >= -1 && value.root.right <= value.viewport + 1, `${label}: game stays in viewport`);
  assert.ok(value.targets.every(target => target.width >= 44 && target.height >= 44), `${label}: game targets are at least 44px`);
  assert.ok(value.social.every(target => target.width >= 44 && target.height >= 44), `${label}: social targets are at least 44px`);
  return value;
}

try {
  for (const [name, engine, profile, reducedMotion] of [
    ['chromium-390', chromium, { viewport: { width: 390, height: 844 }, hasTouch: true }, 'no-preference'],
    ['chromium-1280', chromium, { viewport: { width: 1280, height: 900 } }, 'no-preference'],
    ['android-chromium', chromium, devices['Pixel 7'], 'no-preference'],
    ['webkit-iphone', webkit, devices['iPhone 16'], 'reduce'],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ ...profile, acceptDownloads: true, reducedMotion, timezoneId: 'Asia/Bangkok' });
      await context.addInitScript(() => {
        Math.random = () => .7;
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/?preview=events&event=halloween`, { waitUntil: 'load' });
      await page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true }).waitFor();
      await openChooser(page);
      await page.evaluate(time => { window.__candyNow = time; Date.now = () => window.__candyNow; }, deadline - 1_000);
      await page.waitForTimeout(1_100);
      const candyDoor = page.locator('[data-halloween-door=candy]');
      assert.equal(await candyDoor.isDisabled(), true, `${name}: candy is locked before cutoff`);
      assert.match(await candyDoor.innerText(), /เปิดได้เมื่อครบเวลา/);
      await page.locator('.home-halloween-dialog').screenshot({ path: `${dir}${name}-locked.png` });
      await page.evaluate(time => { window.__candyNow = time; }, deadline);
      await page.waitForFunction(() => !document.querySelector('[data-halloween-door=candy]')?.disabled);
      assert.match(await candyDoor.innerText(), /พร้อมเล่น/);
      assert.equal(await page.locator('[data-halloween-door=escape]').isDisabled(), true, `${name}: third game remains locked`);
      await press(candyDoor);
      await page.locator('[data-halloween-candy-game=ready]').waitFor();
      assert.equal(await page.getByRole('heading', { name: 'คืนล่าลูกอมต้องสาป', exact: true }).isVisible(), true);
      assert.match(await page.locator('[data-halloween-candy-game=ready]').innerText(), /🍬 \+1 pt.*🎃 \+5 pt.*☠️ −3 pt.*กดไล่ผี.*ถ้าปล่อยผี −2 pt/s);
      await layout(page, `${name} ready`);
      await page.locator('.home-halloween-dialog').screenshot({ path: `${dir}${name}-ready.png` });

      const gameStart = deadline;
      await press(page.getByRole('button', { name: 'เริ่มล่าลูกอม', exact: true }));
      const playingGame = page.locator('[data-halloween-candy-game=playing]');
      await playingGame.waitFor();
      const pacing = [];
      for (const [elapsed, seconds, pace] of [[0, 30, 'normal'], [9_000, 21, 'normal'], [10_000, 20, 'rush'], [24_000, 6, 'rush'], [25_000, 5, 'storm']]) {
        await page.evaluate(time => { window.__candyNow = time; }, gameStart + elapsed);
        await page.waitForFunction(expected => document.querySelector('[data-halloween-candy-game=playing]')?.getAttribute('data-candy-pace') === expected.pace
          && document.querySelector('.halloween-candy-scorebar>span:nth-child(2) b')?.textContent === String(expected.seconds), { pace, seconds });
        pacing.push({ seconds, pace: await playingGame.getAttribute('data-candy-pace') });
      }
      await page.evaluate(time => { window.__candyNow = time; }, gameStart + 25_000);
      await page.waitForFunction(() => document.querySelector('.halloween-candy-scorebar')?.textContent?.includes('ลูกอมถล่ม!'));
      await page.locator('.halloween-candy-target').first().waitFor({ state: 'visible' });
      await page.waitForTimeout(650);
      const playLayout = await layout(page, `${name} playing`);
      assert.ok(playLayout.targets.length > 0, `${name}: storm shows a tappable target`);
      await page.locator('.home-halloween-dialog').screenshot({ path: `${dir}${name}-playing.png` });
      const candyTarget = page.locator('.halloween-candy-target.is-gold').first();
      await candyTarget.waitFor({ state: 'visible' });
      await press(candyTarget);
      await page.locator('[data-candy-burst=candy]').waitFor({ state: 'visible' });
      await page.evaluate(() => { Math.random = () => .95; });
      const ghostTarget = page.locator('.halloween-candy-target.is-thief').first();
      await ghostTarget.waitFor({ state: 'visible' });
      await press(ghostTarget);
      await page.locator('[data-candy-burst=bat]').waitFor({ state: 'visible' });
      await page.locator('.home-halloween-dialog').screenshot({ path: `${dir}${name}-tap-bursts.png` });
      await page.evaluate(() => { Math.random = () => .7; });
      const stopAt = Date.now() + 1_600;
      while (Date.now() < stopAt) {
        const target = page.locator('.halloween-candy-target.is-gold').first();
        if (await target.count()) await press(target).catch(() => {});
        await page.waitForTimeout(60);
      }
      if (name === 'chromium-390') await page.evaluate(() => {
        window.__candyShareCalls = [];
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        Object.defineProperty(navigator, 'share', { configurable: true, value: payload => {
          window.__candyShareCalls.push({ kind: 'share', fileCount: payload.files?.length, text: payload.text, url: payload.url });
          return Promise.resolve();
        } });
      });
      await page.evaluate(time => { window.__candyNow = time; }, gameStart + 31_000);
      await page.locator('[data-halloween-candy-game=finishing]').waitFor();
      assert.equal(await page.locator('.halloween-candy-finale img').isVisible(), true, `${name}: finale reveals the approved result artwork`);
      if (reducedMotion === 'no-preference') await page.waitForTimeout(900);
      await page.locator('.home-halloween-dialog').screenshot({ path: `${dir}${name}-finale.png` });
      await page.locator('[data-halloween-candy-game=result]').waitFor();
      const score = Number(await page.locator('.halloween-candy-heading span b').innerText().then(text => text.replace(/\D/g, '')));
      assert.ok(score >= 5, `${name}: tapping visible targets changes score`);
      await page.waitForFunction(() => !document.querySelector('.home-halloween-share-primary')?.disabled);
      const resultLayout = await layout(page, `${name} result`);
      assert.equal(resultLayout.social.length, 3, `${name}: three social icon actions`);
      if (name === 'chromium-390') {
        await press(page.getByRole('button', { name: 'แชร์ภาพด้วย Facebook', exact: true }));
        await page.waitForFunction(() => window.__candyShareCalls?.length === 1);
        const [shareCall] = await page.evaluate(() => window.__candyShareCalls);
        const title = score <= 10 ? 'มาขอลูกอม หรือมาชมบ้าน?' : score <= 25 ? 'นักล่าลูกอมฝึกหัด' : score <= 40 ? 'หวานจนผียังเรียกพี่' : 'ราชาแห่งคืนปล่อยผี';
        assert.deepEqual(shareCall, { kind: 'share', fileCount: 1, text: `ฉันเก็บลูกอมได้ ${score} คะแนน\n${title}\nกล้าทำลายสถิติฉันไหม?\nhttps://mangmeeplus.com/halloween`, url: 'https://mangmeeplus.com/halloween' });
      }
      await page.locator('.home-halloween-dialog').screenshot({ path: `${dir}${name}-result.png` });
      await page.locator('.home-halloween-dialog').evaluate(dialog => { dialog.scrollTop = dialog.scrollHeight; });
      await page.locator('.home-halloween-dialog').screenshot({ path: `${dir}${name}-result-share.png` });

      const pending = page.waitForEvent('download');
      await press(page.getByRole('button', { name: 'บันทึกภาพ', exact: true }));
      const download = await pending;
      const path = `${dir}${name}-${download.suggestedFilename()}`;
      await download.saveAs(path);
      const bytes = readFileSync(path);
      const dimensions = await imageDimensions(page, bytes);
      assert.deepEqual(dimensions, { width: 1080, height: 1920 }, `${name}: default share image is 9:16`);
      const provenance = readHalloweenProvenance(bytes);
      assert.equal(provenance?.source, 'https://mangmeeplus.com');
      assert.equal(provenance?.event, 'halloween');
      assert.equal(provenance?.variant, 'story');
      assert.match(provenance?.cardId ?? '', /^candy-/);

      await press(page.getByRole('button', { name: 'เล่นอีกครั้ง', exact: true }));
      await page.locator('[data-halloween-candy-game=countdown]').waitFor();
      await press(page.getByRole('button', { name: 'ปิดกิจกรรม', exact: true }));
      await page.locator('.home-halloween-dialog').waitFor({ state: 'hidden' });
      await page.waitForTimeout(1_100);
      assert.deepEqual(errors, [], `${name}: no browser errors`);
      report.results.push({ name, version: browser.version(), reducedMotion, pacing, score, playLayout, resultLayout, share: { path, dimensions, bytes: bytes.length, provenance }, errors });
      save();
    } finally { await browser.close(); }
  }
  report.status = 'pass';
  save();
  console.log(JSON.stringify({ status: report.status, engines: report.results.map(result => result.name) }));
} catch (error) {
  report.status = 'fail';
  report.error = error.stack;
  save();
  throw error;
}
