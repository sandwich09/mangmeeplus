import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Local browser evidence only: instrument platform APIs, never add test modes to production.
const base = process.env.BASE_URL ?? 'http://127.0.0.1:43841';
const dir = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await context.newPage();
const results = [];
const errors = [];
const backend = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const url = new URL(request.url());
  if (url.searchParams.has('_rsc') || url.pathname.startsWith('/_next/')) return;
  if (url.pathname.startsWith('/api/') || ['fetch', 'xhr'].includes(request.resourceType())) backend.push(request.url());
});
await context.addInitScript(() => {
  const probe = window.__ghostProbe = { writes: [], randomValues: [], randomCalls: [], shares: [], copies: [], urls: [], revoked: [], audio: [], rejections: [], shareMode: 'success', clipboardMode: 'success' };
  addEventListener('unhandledrejection', event => probe.rejections.push(String(event.reason)));
  for (const name of ['setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[name];
    Storage.prototype[name] = function (...args) { probe.writes.push([name, ...args]); return original.apply(this, args); };
  }
  const random = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = array => {
    if (array instanceof Uint32Array && array.length === 1 && probe.randomValues.length) {
      array[0] = probe.randomValues.shift();
      probe.randomCalls.push(array[0]);
      return array;
    }
    return random(array);
  };
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => !!data.files?.length });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async data => {
    probe.shares.push({ title: data.title, text: data.text, url: data.url, files: await Promise.all((data.files ?? []).map(async file => {
      const bitmap = await createImageBitmap(file);
      return { name: file.name, type: file.type, size: file.size, width: bitmap.width, height: bitmap.height };
    })) });
    if (probe.shareMode === 'cancel') throw new DOMException('cancelled by browser probe', 'AbortError');
    if (probe.shareMode === 'fail') throw new Error('native sharing unavailable in browser probe');
  } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
    if (probe.clipboardMode === 'fail') throw new DOMException('clipboard denied in browser probe', 'NotAllowedError');
    probe.copies.push(text);
  } } });
  const createUrl = URL.createObjectURL.bind(URL);
  URL.createObjectURL = object => { const url = createUrl(object); probe.urls.push(url); return url; };
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = url => { probe.revoked.push(url); return revoke(url); };
  const Audio = window.AudioContext;
  if (Audio) window.AudioContext = new Proxy(Audio, { construct(target, args) {
    const audio = Reflect.construct(target, args, target);
    const record = { audio, sources: [], gains: [], closes: 0 };
    probe.audio.push(record);
    for (const method of ['createBufferSource', 'createOscillator']) {
      const create = audio[method].bind(audio);
      audio[method] = (...args) => {
        const source = create(...args);
        const item = { source, method, starts: 0, stops: 0, disconnects: 0 };
        for (const method of ['start', 'stop', 'disconnect']) {
          const original = source[method].bind(source);
          source[method] = (...args) => { item[method === 'disconnect' ? 'disconnects' : `${method}s`]++; return original(...args); };
        }
        record.sources.push(item);
        return source;
      };
    }
    const gain = audio.createGain.bind(audio);
    audio.createGain = (...args) => { const result = gain(...args); record.gains.push(result); return result; };
    const close = audio.close.bind(audio);
    audio.close = () => { record.closes++; return close(); };
    return audio;
  } });
});

const game = page.locator('[data-halloween-game]');
const dialog = page.locator('.home-halloween-dialog');
const open = async (path = '/halloween', width = 390, height = 844, motion = 'no-preference', preview = true) => {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: motion });
  const url = new URL(path, base);
  if (preview && url.pathname.startsWith('/halloween') && !url.searchParams.has('preview')) {
    url.searchParams.set('preview', 'events'); url.searchParams.set('event', 'halloween');
  }
  const response = await page.goto(url.href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return response;
};
const probe = async () => page.evaluate(() => ({
  writes: window.__ghostProbe.writes, randomCalls: window.__ghostProbe.randomCalls,
  shares: window.__ghostProbe.shares, copies: window.__ghostProbe.copies,
  urls: window.__ghostProbe.urls, revoked: window.__ghostProbe.revoked,
  rejections: window.__ghostProbe.rejections,
  audio: window.__ghostProbe.audio.map(({ audio, sources, gains, closes }) => ({
    state: audio.state, currentTime: audio.currentTime, closes,
    sources: sources.map(({ source, method, starts, stops, disconnects }) => ({
      method, starts, stops, disconnects, loop: source.loop ?? false, type: source.type,
      frequency: source.frequency?.value,
      peak: source.buffer ? source.buffer.getChannelData(0).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0) : undefined,
    })), gains: gains.map(gain => gain.gain.value),
  })),
}));
const overflow = async label => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: page overflow`);
  // Rotated decorative rings intentionally extend into the clipped stage; controls/text must fit.
  const outside = await game.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    return [...el.querySelectorAll('button,a,input,textarea,h2,p,label')].filter(node => {
      if (node.closest('[aria-hidden=true]') || !node.getClientRects().length) return false;
      const box = node.getBoundingClientRect();
      return box.left < bounds.left - 1 || box.right > bounds.right + 1;
    }).map(node => node.textContent);
  });
  assert.deepEqual(outside, [], `${label}: visible controls/text fit the game`);
};
const screenshot = name => page.screenshot({ path: `${dir}${name}.png`, fullPage: true });
const button = name => game.getByRole('button', { name, exact: true });
const choose = async values => page.evaluate(values => { window.__ghostProbe.randomValues = [...values]; }, values);
const waitState = expected => page.waitForFunction(expected => document.querySelector('[data-halloween-game]')?.getAttribute('data-halloween-game') === expected, expected);
const cardId = () => game.getAttribute('data-card-id');
const draw = async bucket => {
  await choose([bucket]);
  await button('เผยร่างของฉัน').click();
  await waitState('drawing');
  assert.equal(await button('ข้ามเอฟเฟกต์').count(), 0, 'no skip control');
  await waitState('revealed');
};
const focusInside = async () => {
  const controls = await dialog.locator('button:enabled, a[href], select, input, textarea').count();
  for (const key of [...Array(controls + 2).fill('Tab'), ...Array(controls + 2).fill('Shift+Tab')]) {
    await page.keyboard.press(key);
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, `dialog focus contains ${key}`);
  }
};
const sameActions = async selector => {
  const boxes = await game.locator(selector).evaluateAll(nodes => nodes.map(el => {
    const { width, height } = el.getBoundingClientRect(); return { width, height };
  }));
  assert.ok(boxes.length > 1, `${selector}: action group exists`);
  assert.ok(boxes.every(box => Math.abs(box.width - boxes[0].width) < 1 && Math.abs(box.height - boxes[0].height) < 1), `${selector}: equal button dimensions ${JSON.stringify(boxes)}`);
  return boxes;
};

try {
  for (const [width, height] of [[360, 800], [390, 844], [1280, 900], [812, 375]]) {
    console.log(`viewport ${width}x${height}`);
    assert.equal((await open('/halloween', width, height)).status(), 200);
    await waitState('ready');
    assert.equal((await probe()).audio.length, 0, 'standalone has no audio before gesture');
    await overflow(`${width} ready`);
    if ([390, 1280].includes(width)) await screenshot(`ready-${width}`);
    await choose([4294967000, 10]);
    // Two synchronous presses exercise the event guard, rather than two separate journeys.
    await button('เผยร่างของฉัน').evaluate(el => { el.click(); el.click(); });
    await waitState('drawing');
    assert.deepEqual((await probe()).randomCalls, [4294967000, 10], 'reject incomplete tail; repeated press does not draw twice');
    await overflow(`${width} drawing`);
    if ([390, 1280].includes(width)) await screenshot(`drawing-${width}`);
    assert.equal(await button('ข้ามเอฟเฟกต์').count(), 0, 'no skip control');
    await waitState('revealed');
    assert.equal(await cardId(), '01-krasue', 'reveal keeps the initially selected card');
    await button('แชร์ภาพ').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[data-halloween-share] button')?.disabled);
    await page.waitForTimeout(800);
    await overflow(`${width} result`);
    results.push({ viewport: `${width}x${height}`, shareActions: await sameActions('.home-halloween-share-actions button'), resultActions: await sameActions('[data-halloween-result-actions] button') });
    if ([390, 1280].includes(width)) await screenshot(`result-${width}`);
    if (width === 812) await screenshot('result-landscape');
    const snapshot = await probe();
    assert.deepEqual(snapshot.writes, [], 'draw has no storage writes');
    assert.deepEqual(snapshot.rejections, [], 'draw has no unhandled rejections');
  }

  console.log('sharing and export');
  // Native payloads are captured locally; no social app is opened or posted to.
  await open();
  await draw(10);
  await page.waitForFunction(() => !document.querySelector('[data-halloween-share] button')?.disabled);
  const resultId = await cardId();
  for (const [format, width, height] of [['สตอรี่ 9:16', 1080, 1920]]) {
    assert.equal(await game.getByRole('radio').count(), 0, 'story needs no format picker');
    await button('แชร์ภาพ').click();
    await page.waitForFunction(() => document.querySelector('[data-halloween-share] [role="status"]')?.textContent?.includes('ส่งภาพไปยังแอป'));
    const payload = (await probe()).shares.at(-1);
    assert.equal(payload.url, 'https://mangmeeplus.com');
    assert.match(payload.title, /กระสือ/);
    assert.match(payload.text, /https:\/\/mangmeeplus.com/);
    assert.doesNotMatch(payload.text, /mangmeeplus.com\/halloween/);
    assert.deepEqual(payload.files.map(({ type, width, height }) => ({ type, width, height })), [{ type: 'image/jpeg', width, height }]);
    assert.ok(payload.files[0].size > 10000);
    const download = page.waitForEvent('download');
    await button('บันทึกภาพ').click();
    const file = await download;
    assert.equal(file.suggestedFilename(), 'mangmee-01-krasue.png');
    const originalPath = `${dir}${file.suggestedFilename()}`;
    await file.saveAs(originalPath);
    const originalBytes = readFileSync(originalPath);
    assert.deepEqual(originalBytes, readFileSync('apps/web/public/home/events/halloween/cards/01-krasue.png'), 'save is byte-identical original artwork');
    assert.deepEqual([originalBytes.readUInt32BE(16), originalBytes.readUInt32BE(20)], [1122, 1402]);
    results.push({ exported: payload, savedOriginal: { name: file.suggestedFilename(), width: 1122, height: 1402, byteIdentical: true } });
  }
  for (const mode of ['cancel', 'fail']) {
    await page.evaluate(mode => { window.__ghostProbe.shareMode = mode; }, mode);
    await button('แชร์ภาพ').click();
    const status = game.locator('[data-halloween-share] [role="status"]');
    await status.filter({ hasText: mode === 'cancel' ? 'ปิดเมนูแชร์แล้ว' : 'แชร์ไม่สำเร็จ' }).waitFor();
    assert.equal(await cardId(), resultId, `${mode} preserves card`);
    await screenshot(`share-${mode}-390`);
  }
  const failedShareDownload = page.waitForEvent('download');
  await button('บันทึกภาพเพื่อแชร์').click();
  const failedShareFile = await failedShareDownload;
  assert.match(failedShareFile.suggestedFilename(), /story-9x16\.jpg$/);
  await failedShareFile.saveAs(`${dir}${failedShareFile.suggestedFilename()}`);
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  await button('คัดลอกข้อความและลิงก์').click();
  await button('บันทึกภาพเพื่อแชร์').waitFor();
  await game.getByText('แชร์ภาพไม่ได้ในอุปกรณ์นี้ กดบันทึกภาพเพื่อแชร์ แล้วเลือกแอปที่ต้องการ', { exact: true }).waitFor();
  const fallbackDownload = page.waitForEvent('download');
  await button('บันทึกภาพเพื่อแชร์').click();
  const fallbackFile = await fallbackDownload;
  assert.match(fallbackFile.suggestedFilename(), /story-9x16\.jpg$/);
  await fallbackFile.saveAs(`${dir}${fallbackFile.suggestedFilename()}`);
  await sameActions('.home-halloween-share-actions button');
  await button('คัดลอกข้อความและลิงก์').click();
  assert.match((await probe()).copies.at(-1), /กระสือ/);
  await page.evaluate(() => { window.__ghostProbe.clipboardMode = 'fail'; });
  await button('คัดลอกข้อความและลิงก์').click();
  await game.locator('textarea').waitFor();
  assert.match(await game.locator('textarea').inputValue(), /https:\/\/mangmeeplus.com/);
  await page.waitForFunction(() => document.activeElement === document.querySelector('[data-halloween-share] textarea'));
  assert.equal(await cardId(), resultId);
  const facebook = game.getByRole('link', { name: 'แชร์ลิงก์บน Facebook', exact: true });
  assert.equal(new URL(await facebook.getAttribute('href')).searchParams.get('u'), 'https://mangmeeplus.com');
  await screenshot('share-fallback-390');
  results.push({ share: 'native story payload, download, cancellation, failure, absence, clipboard and manual fallback preserve result' });

  await open();
  await page.route('**/home/events/halloween/cards/01-krasue.png', route => route.abort());
  await draw(10);
  await button('โหลดภาพอีกครั้ง').waitFor();
  assert.equal(await button('บันทึกภาพ').isEnabled(), true, 'original save stays available when story preparation fails');
  const callsBeforeReload = (await probe()).randomCalls;
  await page.unroute('**/home/events/halloween/cards/01-krasue.png');
  await button('โหลดภาพอีกครั้ง').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-halloween-game] img')].some(image => image.src.endsWith('/01-krasue.png') && image.complete && image.naturalWidth > 0));
  assert.equal(await cardId(), '01-krasue');
  assert.deepEqual((await probe()).randomCalls, callsBeforeReload, 'image reload keeps the immutable result');
  await choose([370]);
  await button('เผยร่างอีกครั้ง').click();
  await waitState('drawing');
  assert.equal(await button('ข้ามเอฟเฟกต์').count(), 0, 'no skip control');
  await waitState('revealed');
  assert.equal(await cardId(), '09-dracula', 'retry allows a fresh independent draw');
  results.push({ retry: 'failed image reload preserves result, replay draws independently' });

  console.log('reveal themes');
  const themes = [
    [10, 'thai', '01-krasue'], [370, 'western', '09-dracula'], [595, 'japanese', '14-sadako'],
    [820, 'chinese', '19-jiangshi'], [910, 'korean', '21-chonggak-gwishin'], [0, 'secret', '23-mangmee-secret'],
  ];
  for (const [bucket, theme, id] of themes) {
    await open();
    await choose([bucket]);
    await button('เผยร่างของฉัน').click();
    await waitState('drawing');
    await page.waitForTimeout(theme === 'secret' ? 3200 : 1000);
    assert.equal(await game.getAttribute('data-region'), theme);
    await screenshot(`${theme}-drawing-390`);
    assert.equal(await button('ข้ามเอฟเฟกต์').count(), 0, 'no skip control');
    await waitState('revealed');
    assert.equal(await cardId(), id);
    const audio = (await probe()).audio;
    assert.ok(audio.some(context => context.sources.some(source => source.starts > 0)), `${theme}: source starts after gesture`);
    if (theme === 'secret') { await page.waitForTimeout(1200); await screenshot('secret-result-390'); }
    results.push({ theme, card: id, audio });
  }

  // A synthetic visibility event exercises real AudioContext suspension/resumption without stealing user focus.
  await open();
  await choose([10]);
  await button('เผยร่างของฉัน').click();
  await waitState('drawing');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.__ghostProbe.audio.every(({audio}) => audio.state === 'suspended'));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.__ghostProbe.audio.every(({audio}) => audio.state === 'running'));
  assert.equal(await button('ข้ามเอฟเฟกต์').count(), 0, 'no skip control');
  results.push({ audioVisibility: 'real contexts suspend/resume on synthetic document visibility events; closed contexts never revive' });

  // Verify both timed completions with no skip control and prompt reduced-motion completion.
  for (const [bucket, minimum, maximum] of [[10, 4000, 6500], [0, 7000, 9500]]) {
    await open();
    await choose([bucket]);
    const started = Date.now();
    await button('เผยร่างของฉัน').click();
    await waitState('revealed');
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= minimum && elapsed < maximum, `reveal duration ${elapsed}ms`);
    results.push({ timedBucket: bucket, elapsed });
  }
  await open('/halloween', 390, 844, 'reduce');
  await choose([10]);
  const started = Date.now();
  await button('เผยร่างของฉัน').click();
  await waitState('revealed');
  assert.ok(Date.now() - started < 1500, 'reduced motion reveals promptly');
  assert.equal(await page.evaluate(() => document.getAnimations().some(animation => animation.playState === 'running')), false, 'reduced motion has no running animation');

  console.log('modal lifecycle');
  // Modal controls include social links and manual copy, as well as the original door controls.
  await open('/?preview=events&event=halloween');
  const entry = page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true });
  await entry.click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('[data-halloween-door="ghost"]').click();
  await waitState('ready');
  await draw(10);
  await page.waitForFunction(() => !document.querySelector('[data-halloween-share] button')?.disabled);
  await focusInside();
  await page.evaluate(() => { window.__ghostProbe.clipboardMode = 'fail'; });
  await button('คัดลอกข้อความและลิงก์').click();
  await game.locator('textarea').waitFor();
  await focusInside();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await entry.evaluate(el => document.activeElement === el), true, 'close restores entry focus');
  await page.waitForTimeout(100);
  assert.ok((await probe()).audio.every(record => record.state === 'closed'), 'closing modal closes all audio');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.ok((await probe()).audio.every(record => record.state === 'closed'), 'visibility cannot resurrect closed audio');
  const afterClose = await probe();
  assert.ok(afterClose.urls.every(url => afterClose.revoked.includes(url)), 'closing revokes prepared files');
  results.push({ modal: 'keyboard containment includes social icons and manual copy, Escape restores focus, audio and URLs cleaned' });

  await entry.click();
  await dialog.locator('[data-halloween-door="ghost"]').click();
  await choose([10]);
  await button('เผยร่างของฉัน').click();
  await waitState('drawing');
  await page.getByRole('button', { name: 'ปิดกิจกรรม', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(4700);
  await entry.click();
  await dialog.locator('[data-halloween-door="ghost"]').click();
  await waitState('ready');
  assert.equal(await cardId(), null, 'closed draw cannot finish into a reopened game');
  await button('เลือกประตูอื่น').click();
  await dialog.locator('[data-halloween-door="candy"]').click();
  await dialog.locator('[data-halloween-intro="candy"]').waitFor();
  await dialog.getByRole('button', { name: 'เลือกประตูอื่น', exact: true }).click();
  await dialog.locator('[data-halloween-door="escape"]').click();
  await dialog.locator('[data-halloween-intro="escape"]').waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  results.push({ lifecycle: 'close during drawing cancels stale reveal; reopen resets; back and other doors remain usable' });

  const tools = page.locator('.home-event-tools');
  if (await tools.getAttribute('open') === null) await tools.locator('summary').click();
  await page.locator('#home-event-pause').check();
  await entry.click();
  await dialog.locator('[data-halloween-door="ghost"]').click();
  await choose([0]);
  const pausedStart = Date.now();
  await button('เผยร่างของฉัน').click();
  await waitState('revealed');
  assert.ok(Date.now() - pausedStart < 1500, 'existing pause preference reveals promptly');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  results.push({ motion: 'reduced motion and existing event pause reveal promptly' });

  for (const [path, title, image] of [
    ['/halloween', 'กระจกเผยร่างผี', 'back-standard.png'],
    ['/halloween/01-krasue', 'กระสือ', '01-krasue.png'],
    ['/halloween/23-mangmee-secret', 'น้องมั่งมี', '23-mangmee-secret.png'],
  ]) {
    assert.equal((await open(path)).status(), 200);
    assert.match(await page.title(), new RegExp(title));
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `https://mangmeeplus.com${path}`);
    assert.match(await page.locator('meta[property="og:image"]').first().getAttribute('content'), new RegExp(image.replace('.', '\\.')));
    if (path !== '/halloween') {
      assert.equal((await probe()).randomCalls.length, 0, 'shared card preview does not draw');
      await game.getByText('เพื่อนส่งร่างนี้มาให้คุณ', { exact: true }).waitFor();
    }
  }
  // Next streams notFound() with HTTP 200 after the dynamic root layout (documented framework behavior).
  // Assert the rendered rejection and noindex, rather than assuming a non-streamed HTTP response.
  await open('/halloween/not-a-card');
  await page.getByRole('heading', { name: /ไม่พบหน้านี้|Page not found/ }).waitFor();
  assert.equal(await game.count(), 0, 'unknown cards never mount a game');
  assert.ok(await page.locator('meta[name=robots][content*=noindex]').count());
  results.push({ invalidCard: '404 UI + noindex; Next streamed notFound response uses HTTP 200' });
  // Turning the single homepage theme off also blocks every direct game/card entry point.
  for (const path of ['/?preview=events&event=default', '/?preview=events&event=christmas']) {
    await open(path);
    assert.equal(await page.locator('[data-halloween-activity]').count(), 0, 'inactive theme has no event entrance');
    assert.equal(await game.count(), 0);
    assert.equal((await probe()).audio.length, 0);
  }
  await page.screenshot({path: `${dir}theme-disabled-390.png`});
  for (const path of ['/halloween?preview=events&event=default', '/halloween/01-krasue?preview=events&event=default', '/halloween/23-mangmee-secret?preview=events&event=christmas', '/halloween', '/halloween/01-krasue']) {
    await open(path, 390, 844, 'no-preference', false);
    await page.getByRole('heading', { name: /ไม่พบหน้านี้|Page not found/ }).waitFor();
    assert.equal(await game.count(), 0, 'inactive or unavailable theme blocks direct game/card URLs');
    assert.equal((await probe()).audio.length, 0, 'blocked activity creates no audio');
    assert.ok(await page.locator('meta[name=robots][content*=noindex]').count());
  }
  results.push({ themeGate: 'off/unknown themes hide entry and block game, ordinary and secret URLs; unavailable server theme fails closed; no game audio created' });
  assert.deepEqual(await context.cookies(), [], 'no cookies added');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  assert.deepEqual(backend, [], 'no feature backend calls');
  writeFileSync(`${dir}browser-results.json`, JSON.stringify({ status: 'pass', base, results, errors, backend, audioLimit: 'Inspected real Web Audio context/source signal and cleanup in headless Chrome; no physical speaker listening claim.' }, null, 2));
  console.log(JSON.stringify({ status: 'pass', checks: results.length }));
} catch (error) {
  await screenshot('failure').catch(() => {});
  writeFileSync(`${dir}browser-results.json`, JSON.stringify({ status: 'fail', error: error.stack, results, errors, backend }, null, 2));
  throw error;
} finally {
  await browser.close();
}
