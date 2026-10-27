import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from '@playwright/test';

const dir = fileURLToPath(new URL('.', import.meta.url));
const results = [];
for (const [engineName, engine, width, profile] of [
  ['chromium', chromium, 390, {}], ['chromium', chromium, 1280, {}], ['webkit-iphone', webkit, 390, devices['iPhone 16']],
]) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...profile, viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__bucket = 10;
      const random = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = values => {
        if (values instanceof Uint32Array && values.length === 1) { values[0] = window.__bucket; return values; }
        return random(values);
      };
      window.__motionFrames = [];
      const sample = time => {
        const flipper = document.querySelector('.halloween-reveal-flipper');
        if (flipper) {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(flipper).transform);
          window.__motionFrames.push({ time, angle: Math.atan2(-matrix.m13, matrix.m11) * 180 / Math.PI });
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    for (const [region, bucket, duration, samples, minimumTurns] of [
      ['thai', 10, 4500, [600, 2150, 3850], 4.5],
      ['secret', 0, 7500, [1000, 4400, 6850], 7.5],
    ]) {
      await page.goto('http://127.0.0.1:43841/?preview=events&event=halloween');
      await page.evaluate(() => document.fonts.ready);
      await page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true }).click();
      await page.locator('[data-halloween-door=ghost]').click();
      await page.evaluate(bucket => { window.__bucket = bucket; }, bucket);
      const start = Date.now();
      await page.getByRole('button', { name: 'เผยร่างของฉัน', exact: true }).click();
      const frames = [];
      for (const [index, target] of samples.entries()) {
        await page.waitForTimeout(Math.max(0, start + target - Date.now()));
        const frame = await page.locator('.halloween-reveal-flipper').evaluate(el => {
          const style = getComputedStyle(el);
          const matrix = new DOMMatrixReadOnly(style.transform);
          const front = el.querySelector('.halloween-reveal-front');
          const image = front.querySelector('img');
          return { m11: matrix.m11, m13: matrix.m13, transform: style.transform, transformStyle: style.transformStyle,
            animation: style.animationName, animationTime: el.getAnimations()[0]?.currentTime,
            frontBackface: getComputedStyle(front).backfaceVisibility, blur: getComputedStyle(image).filter,
            loaded: image.complete && image.naturalWidth > 0 && !image.hidden, image: image.getAttribute('src'),
            phase: el.closest('[data-halloween-game]').dataset.halloweenGame };
        });
        assert.equal(frame.phase, 'drawing');
        assert.equal(frame.transformStyle, 'preserve-3d');
        assert.equal(frame.frontBackface, 'hidden');
        if (index === 0) assert.ok(frame.m11 > .7, 'approved back faces viewer initially');
        if (index === 2) { assert.ok(frame.m11 < -1, 'final half-turn exposes selected front'); assert.ok(frame.loaded, 'front displayed before result'); assert.match(frame.blur, /^(none|blur\(0px\))$/, 'final artwork crisp'); }
        frame.elapsed = Date.now() - start;
        frames.push(frame);
        await page.locator('.home-halloween-dialog').screenshot({ path: `${dir}spin-${engineName}-${region}-${width}-${['back', 'fast', 'front'][index]}.png`, animations: 'allow' });
      }
      await page.waitForFunction(() => document.querySelector('[data-halloween-game]')?.dataset.halloweenGame === 'revealed');
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= duration && elapsed < duration + 1400, `natural duration ${elapsed}ms`);
      const motion = await page.evaluate(() => window.__motionFrames);
      // Screenshot work can drop RAF samples; allow one missed full rotation and floating-point epsilon.
      let degrees = 0;
      for (let i = 1; i < motion.length; i++) degrees += ((motion[i].angle - motion[i - 1].angle + 540) % 360) - 180;
      assert.ok(degrees / 360 >= minimumTurns - .05, `${region} observed multiple spins ${degrees / 360}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.getByRole('button', { name: 'ปิดกิจกรรม', exact: true }).click();
      results.push({ engine: engineName, width, region, elapsed, observedTurns: degrees / 360, sampledFrames: motion.length, frames });
      console.log(`PASS ${engineName} ${width} ${region}: ${Math.round(degrees / 360 * 100) / 100} turns then crispfront, ${elapsed}ms`);
    }
    // Existing reduced-motion preference remains a prompt, animation-free reveal.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true }).click();
    await page.locator('[data-halloween-door=ghost]').click();
    const stillStart = Date.now();
    await page.getByRole('button', { name: 'เผยร่างของฉัน', exact: true }).click();
    await page.locator('[data-halloween-game=revealed]').waitFor();
    assert.ok(Date.now() - stillStart < 1500);
    assert.equal(await page.locator('[data-halloween-game]').evaluate(el => el.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')), false);
    await page.getByRole('button', { name: 'ปิดกิจกรรม', exact: true }).click();
    await context.close();
  } finally { await browser.close(); }
}
writeFileSync(`${dir}reveal-motion-results.json`, JSON.stringify({ status: 'pass', results }, null, 2));
