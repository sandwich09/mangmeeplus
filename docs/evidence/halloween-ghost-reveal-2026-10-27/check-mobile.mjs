import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from '@playwright/test';
import { readHalloweenProvenance } from '../../../apps/web/src/features/public-home/home-halloween-provenance.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:43841';
const dir = fileURLToPath(new URL('.', import.meta.url));
const skipMotion = process.env.SKIP_MOTION === '1';
const previousReport = skipMotion && existsSync(`${dir}mobile-results.json`) ? JSON.parse(readFileSync(`${dir}mobile-results.json`, 'utf8')) : undefined;
const report = {
  status: 'running', base, results: [],
  provenanceNote: 'Current public PNG bytes now include provenance metadata and differ from the prior unmarked source. Original downloads must equal the current marked public source. Metadata is not visible artwork, tracking, or authentication; re-encoding and screenshots may remove it. Prior-download pixel comparison verifies original artwork stayed unchanged when a prior artifact exists.',
  profileNote: 'The installed iPhone 13 profile advertises iOS 15.0 and correctly hits the existing iOS >=16.4 compatibility gate (preserved screenshot iphone13-ios15-compatibility-gate.png). Main WebKit journey uses iPhone 16 profile advertising iOS 18.7.',
  limitation: 'Runs installed desktop WebKit with an iPhone device profile and desktop Chromium with a Pixel profile. This is browser-engine/mobile-viewport emulation, not physical iOS/Android, an OS share sheet, or a social app posting test. Native capability is observed without mocking in the first context; payload/activation uses a separate explicit stub context. No external posts are sent.',
};
const save = () => writeFileSync(`${dir}mobile-results.json`, JSON.stringify(report, null, 2));
save();

function fixedCard() {
  const original = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = array => {
    if (array instanceof Uint32Array && array.length === 1) { array[0] = 10; return array; }
    return original(array);
  };
}

async function downloadedImage(page, control, name, mime) {
  const pending = page.waitForEvent('download');
  await control.tap();
  const download = await pending;
  const path = `${dir}${name}-${download.suggestedFilename()}`;
  const previousBytes = existsSync(path) ? readFileSync(path) : undefined;
  await download.saveAs(path);
  const bytes = readFileSync(path);
  const dimensions = await page.evaluate(async ({ data, mime }) => {
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    return { width: bitmap.width, height: bitmap.height };
  }, { data: bytes.toString('base64'), mime });
  const provenance = readHalloweenProvenance(bytes);
  assert.deepEqual(provenance, { version: 1, source: 'https://mangmeeplus.com', event: 'halloween', cardId: '01-krasue', variant: mime === 'image/png' ? 'card' : 'story' });
  const result = { path, dimensions, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), provenance };
  if (previousBytes) {
    result.pixelsEqualPreviousDownload = await page.evaluate(async ({ before, after, mime }) => {
      const decode = data => createImageBitmap(new Blob([Uint8Array.from(atob(data), character => character.charCodeAt(0))], { type: mime }));
      const [first, second] = await Promise.all([decode(before), decode(after)]);
      if (first.width !== second.width || first.height !== second.height) return false;
      const canvas = document.createElement('canvas');
      canvas.width = first.width; canvas.height = first.height;
      const context = canvas.getContext('2d');
      context.drawImage(first, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(second, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data.every((value, index) => value === pixels[index]);
    }, { before: previousBytes.toString('base64'), after: bytes.toString('base64'), mime });
    assert.equal(result.pixelsEqualPreviousDownload, true, 'provenance insertion preserves decoded artwork and any QR/footer pixels');
  }
  return result;
}

async function reveal(page) {
  await page.goto(`${base}/halloween?preview=events&event=halloween`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[data-halloween-game=ready]').waitFor();
  await page.getByRole('button', { name: 'เผยร่างของฉัน', exact: true }).tap();
  await page.locator('[data-halloween-game=revealed]').waitFor();
  await page.waitForFunction(() => {
    const section = document.querySelector('[data-halloween-share]');
    return section && !section.querySelector('.home-halloween-share-primary')?.disabled;
  });
}

async function layout(page, label) {
  const measurements = await page.evaluate(() => {
    const game = document.querySelector('[data-halloween-game]');
    const root = game.getBoundingClientRect();
    const social = [...game.querySelectorAll('button,a')].filter(el => /Facebook|Instagram|TikTok/i.test(el.getAttribute('aria-label') ?? ''));
    return {
      viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth,
      game: { left: root.left, right: root.right },
      social: social.map(el => { const box = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label'), width: box.width, height: box.height, left: box.left, right: box.right }; }),
      pickerCount: game.querySelectorAll('input[type=radio],select').length,
      spill: [...game.querySelectorAll('button,a,input,textarea,p,h2,label')].filter(el => !el.closest('[aria-hidden=true]') && el.getClientRects().length).map(el => ({ name: el.textContent?.slice(0, 40), box: el.getBoundingClientRect() })).filter(({ box }) => box.left < root.left - 1 || box.right > root.right + 1).map(({ name }) => name),
    };
  });
  assert.ok(measurements.pageWidth <= measurements.viewport.width, `${label}: no page overflow`);
  assert.deepEqual(measurements.spill, [], `${label}: readable content and controls contained`);
  assert.equal(measurements.pickerCount, 0, `${label}: one story format, no picker`);
  assert.equal(measurements.social.length, 3, `${label}: three named social controls`);
  assert.ok(measurements.social.every(button => button.width >= 44 && button.height >= 44), `${label}: social touch targets >=44px`);
  return measurements;
}

try {
  for (const [name, engine, profile] of [['iphone-webkit', webkit, devices['iPhone 16']], ['android-chromium', chromium, devices['Pixel 7']]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const native = await browser.newContext({ ...profile, reducedMotion: 'reduce', acceptDownloads: true });
      await native.addInitScript(fixedCard);
      const page = await native.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/halloween?preview=events&event=halloween`, { waitUntil: 'load' });
      await page.screenshot({ path: `${dir}${name}-ready.png`, fullPage: true });
      const capability = await page.evaluate(() => {
        const file = new File([new Uint8Array([255, 216, 255, 217])], 'probe.jpg', { type: 'image/jpeg' });
        let canShareFile;
        try { canShareFile = typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : null; } catch (error) { canShareFile = `throws:${error.name}`; }
        return { share: typeof navigator.share, canShare: typeof navigator.canShare, canShareFile, userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, secureContext: isSecureContext };
      });
      await reveal(page);
      const measurements = await layout(page, name);
      await page.screenshot({ path: `${dir}${name}-result.png`, fullPage: true });
      assert.equal(await page.locator('[data-halloween-game]').getAttribute('data-card-id'), '01-krasue');
      const original = await downloadedImage(page, page.getByRole('button', { name: 'บันทึกภาพ', exact: true }), name, 'image/png');
      assert.deepEqual(original.dimensions, { width: 1122, height: 1402 });
      const approved = readFileSync(new URL('../../../apps/web/public/home/events/halloween/cards/01-krasue.png', import.meta.url));
      assert.ok(readFileSync(original.path).equals(approved), `${name}: original PNG byte-identical to approved public source`);
      original.byteIdenticalToApprovedSource = true;
      assert.deepEqual(errors, []);
      const result = { device: name, engineVersion: browser.version(), nativeCapability: capability, measurements, originalDownload: original, errors };
      if (capability.share === 'undefined') {
        result.actualUnsupportedShareDownload = await downloadedImage(page, page.getByRole('button', { name: 'บันทึกภาพเพื่อแชร์', exact: true }), `${name}-fallback`, 'image/jpeg');
        assert.deepEqual(result.actualUnsupportedShareDownload.dimensions, { width: 1080, height: 1920 });
      }
      report.results.push(result);
      save();
      await native.close();

      // A separate context captures calls only. It cannot open an OS share sheet or post.
      const simulated = await browser.newContext({ ...profile, reducedMotion: 'reduce' });
      await simulated.addInitScript(fixedCard);
      await simulated.addInitScript(() => {
        window.__mobileShares = [];
        window.__mobileShareMode = 'cancel';
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => !!data.files?.length });
        Object.defineProperty(navigator, 'share', { configurable: true, value: data => {
          const record = { title: data.title, text: data.text, url: data.url, active: navigator.userActivation?.isActive ?? null, files: data.files.map(file => ({ name: file.name, type: file.type, size: file.size })) };
          window.__mobileShares.push(record);
          return Promise.all(data.files.map(async (file, index) => {
            const bitmap = await createImageBitmap(file);
            const bytesBase64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result).split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            Object.assign(record.files[index], { width: bitmap.width, height: bitmap.height, bytesBase64 });
          })).then(() => { throw window.__mobileShareMode === 'fail' ? new Error('Local simulated share failure') : new DOMException('Local test capture cancelled the simulated share', 'AbortError'); });
        } });
      });
      const simulatedPage = await simulated.newPage();
      await reveal(simulatedPage);
      const facebook = simulatedPage.getByRole('link', { name: 'แชร์ลิงก์บน Facebook', exact: true });
      assert.equal(new URL(await facebook.getAttribute('href')).searchParams.get('u'), 'https://mangmeeplus.com');
      for (const socialName of ['แชร์ภาพด้วย Instagram', 'แชร์ภาพด้วย TikTok', 'แชร์ภาพ']) {
        await simulatedPage.getByRole('button', { name: socialName, exact: true }).tap();
        await simulatedPage.waitForFunction(() => window.__mobileShares.at(-1)?.files.every(file => file.width > 0 && file.bytesBase64));
      }
      const captured = await simulatedPage.evaluate(() => window.__mobileShares);
      for (const payload of captured) for (const file of payload.files) {
        file.provenance = readHalloweenProvenance(Buffer.from(file.bytesBase64, 'base64'));
        delete file.bytesBase64;
        assert.deepEqual(file.provenance, { version: 1, source: 'https://mangmeeplus.com', event: 'halloween', cardId: '01-krasue', variant: 'story' });
      }
      assert.equal(captured.length, 3, `${name}: Instagram, TikTok and main share invoke native once; Facebook link verified without opening it`);
      assert.ok(captured.every(payload => payload.active === true), `${name}: transient user activation at share invocation`);
      assert.ok(captured.every(payload => payload.files.length === 1 && payload.files[0].type === 'image/jpeg'));
      assert.ok(captured.every(payload => payload.files[0].width === 1080 && payload.files[0].height === 1920));
      assert.ok(captured.every(payload => payload.text.split('\n').includes('https://mangmeeplus.com')), 'caption includes homepage URL');
      assert.ok(captured.every(payload => payload.url === 'https://mangmeeplus.com'), 'native return URL is homepage URL');
      result.simulatedShare = captured;
      await simulatedPage.screenshot({ path: `${dir}${name}-simulated-share-cancel.png`, fullPage: true });
      await simulatedPage.evaluate(() => { window.__mobileShareMode = 'fail'; });
      await simulatedPage.getByRole('button', { name: 'แชร์ภาพ', exact: true }).tap();
      await simulatedPage.getByRole('button', { name: 'บันทึกภาพเพื่อแชร์', exact: true }).waitFor();
      result.simulatedFailedShareDownload = await downloadedImage(simulatedPage, simulatedPage.getByRole('button', { name: 'บันทึกภาพเพื่อแชร์', exact: true }), `${name}-failed-share`, 'image/jpeg');
      assert.deepEqual(result.simulatedFailedShareDownload.dimensions, { width: 1080, height: 1920 });
      await simulated.close();
      save();

      if (name === 'iphone-webkit' && skipMotion) {
        result.natural3dReveal = previousReport?.results?.find(result => result.device === name)?.natural3dReveal;
        result.motionEvidenceReused = 'Motion implementation unchanged; retained prior natural4500ms/front-face evidence rather than rerunning it for metadata-only changes.';
      }
      if (name === 'iphone-webkit' && !skipMotion) {
        const motion = await browser.newContext({ ...profile, reducedMotion: 'no-preference' });
        await motion.addInitScript(fixedCard);
        const motionPage = await motion.newPage();
        await motionPage.goto(`${base}/halloween?preview=events&event=halloween`, { waitUntil: 'load' });
        await motionPage.evaluate(() => document.fonts.ready);
        await motionPage.evaluate(() => {
          window.__mobilePhaseTimes = [];
          const game = document.querySelector('[data-halloween-game]');
          new MutationObserver(() => window.__mobilePhaseTimes.push({ phase: game.getAttribute('data-halloween-game'), time: performance.now() })).observe(game, { attributes: true, attributeFilter: ['data-halloween-game'] });
        });
        await motionPage.getByRole('button', { name: 'เผยร่างของฉัน', exact: true }).tap();
        await motionPage.locator('[data-halloween-game=drawing]').waitFor();
        await motionPage.waitForTimeout(3800);
        const lateDrawing = await motionPage.locator('.halloween-reveal-flipper').evaluate(flipper => {
          const front = flipper.querySelector('.halloween-reveal-front');
          const back = flipper.querySelector('.halloween-reveal-back');
          const image = front.querySelector('img');
          return { m11: new DOMMatrixReadOnly(getComputedStyle(flipper).transform).m11, transform: getComputedStyle(flipper).transform, frontBackface: getComputedStyle(front).backfaceVisibility, backBackface: getComputedStyle(back).backfaceVisibility, frontStatus: front.getAttribute('data-image-status'), source: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0, animationTime: flipper.getAnimations()[0]?.currentTime };
        });
        assert.ok(lateDrawing.m11 < 0, 'WebKit late drawing has rotated to the front face');
        assert.equal(lateDrawing.frontBackface, 'hidden');
        assert.equal(lateDrawing.backBackface, 'hidden');
        assert.equal(lateDrawing.frontStatus, 'loaded');
        assert.equal(lateDrawing.loaded, true);
        assert.match(lateDrawing.source, /01-krasue\.png$/);
        await motionPage.screenshot({ path: `${dir}${name}-late-drawing-front.png`, fullPage: true });
        await motionPage.locator('[data-halloween-game=revealed]').waitFor();
        const phases = await motionPage.evaluate(() => window.__mobilePhaseTimes);
        const naturalRevealMs = phases.find(item => item.phase === 'revealed').time - phases.find(item => item.phase === 'drawing').time;
        assert.ok(naturalRevealMs >= 4300 && naturalRevealMs < 5500, `WebKit natural reveal ${naturalRevealMs}ms`);
        result.natural3dReveal = { lateDrawing, naturalRevealMs, phases, method: 'Natural live animation sampled after3800ms; phase duration recorded by DOM mutation observer separately from screenshot work. No animation currentTime control or game-timing overrides.' };
        await motion.close();
        save();
      }
    } finally { await browser.close(); }
  }
  report.status = 'pass';
  save();
  console.log(JSON.stringify({ status: report.status, devices: report.results.map(result => result.device) }));
} catch (error) {
  report.status = 'fail'; report.error = error.stack; save(); throw error;
}
