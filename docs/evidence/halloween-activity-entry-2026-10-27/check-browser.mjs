import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:43841';
const dir = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
const results = [];
const errors = [];
const requests = [];
const navigationRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const url = new URL(request.url());
  const path = url.pathname;
  if (url.searchParams.has('_rsc')) { navigationRequests.push(request.url()); return; }
  if (!path.startsWith('/_next/') && (['fetch', 'xhr'].includes(request.resourceType()) || path.startsWith('/api/'))) requests.push(request.url());
});
await page.addInitScript(() => {
  window.__storageWrites = [];
  for (const method of ['setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (...args) {
      window.__storageWrites.push(method);
      return original.apply(this, args);
    };
  }
});
await page.addInitScript(() => {
  const mode = new URL(location.href).searchParams.get('audio-test');
  window.__codexAudioProbe = { mode, contexts: [], rejections: [] };
  addEventListener('unhandledrejection', event => window.__codexAudioProbe.rejections.push(String(event.reason)));
  if (mode === 'unavailable') {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
    return;
  }
  const NativeAudioContext = window.AudioContext;
  if (!NativeAudioContext) return;
  window.AudioContext = new Proxy(NativeAudioContext, {
    construct(target, args) {
      const context = Reflect.construct(target, args, target);
      const record = { context, id: window.__codexAudioProbe.contexts.length + 1, sources: [], gains: [], resumeCalls: 0, closeCalls: 0 };
      window.__codexAudioProbe.contexts.push(record);
      const createBufferSource = context.createBufferSource.bind(context);
      context.createBufferSource = (...sourceArgs) => {
        const source = createBufferSource(...sourceArgs);
        const sourceRecord = { source, id: record.sources.length + 1, starts: 0, stops: 0 };
        const start = source.start.bind(source);
        const stop = source.stop.bind(source);
        source.start = (...args) => { sourceRecord.starts++; return start(...args); };
        source.stop = (...args) => { sourceRecord.stops++; return stop(...args); };
        record.sources.push(sourceRecord);
        return source;
      };
      const createGain = context.createGain.bind(context);
      context.createGain = (...gainArgs) => {
        const gain = createGain(...gainArgs);
        record.gains.push(gain);
        return gain;
      };
      const resume = context.resume.bind(context);
      context.resume = () => {
        record.resumeCalls++;
        return mode === 'reject-resume' ? Promise.reject(new Error('test resume rejection')) : resume();
      };
      const close = context.close.bind(context);
      context.close = () => { record.closeCalls++; return close(); };
      return context;
    },
  });
});

const activity = page.locator('[data-halloween-activity=""]');
const dialog = page.locator('.home-halloween-dialog');
const goHome = async (width, height, event = 'halloween', audioTest) => {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/?preview=events&event=${event}${audioTest ? `&audio-test=${audioTest}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.public-home').waitFor();
  await page.waitForLoadState('load');
};
const overflow = async label => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} overflow`);
const state = async () => ({
  local: await page.evaluate(() => Object.entries(localStorage).sort()),
  session: await page.evaluate(() => Object.entries(sessionStorage).sort()),
  cookies: (await context.cookies()).map(({ name, value, domain, path }) => ({ name, value, domain, path })),
  writes: await page.evaluate(() => [...window.__storageWrites]),
});
const audioState = async () => page.evaluate(() => window.__codexAudioProbe.contexts.map(record => ({
  id: record.id,
  state: record.context.state,
  currentTime: record.context.currentTime,
  resumeCalls: record.resumeCalls,
  closeCalls: record.closeCalls,
  sources: record.sources.map(({ id, starts, stops, source }) => ({
    id, starts, stops, loop: source.loop,
    bufferPeak: source.buffer ? source.buffer.getChannelData(0).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0) : 0,
  })),
  gains: record.gains.map(gain => gain.gain.value),
})));
const waitForAudio = async (count = 1) => page.waitForFunction(expected => {
  const records = window.__codexAudioProbe?.contexts ?? [];
  return records.length >= expected && records.at(-1)?.sources.length > 0;
}, count);
const waitForContext = async (count = 1) => page.waitForFunction(expected => (window.__codexAudioProbe?.contexts.length ?? 0) >= expected, count);
const waitForClosed = async count => page.waitForFunction(expected => {
  const records = window.__codexAudioProbe?.contexts ?? [];
  return records.length >= expected && records.slice(0, expected).every(record => record.context.state === 'closed');
}, count);
const activeSound = async count => {
  await waitForAudio(count);
  await page.waitForFunction(expected => window.__codexAudioProbe.contexts.at(-1).sources[0].starts > 0, count);
  const sounds = await audioState();
  const sound = sounds.at(-1);
  assert.equal(sound.state, 'running', 'AudioContext runs after the entry gesture');
  assert.equal(sound.sources.length, 1, 'one looping source is created');
  assert.equal(sound.sources[0].starts, 1);
  assert.equal(sound.sources[0].loop, true);
  assert.ok(sound.sources[0].bufferPeak > 0, 'loop buffer contains nonzero audio samples');
  assert.ok(sound.gains.some(gain => gain > 0 && gain <= 0.1), 'output gain stays quiet and nonzero');
  const time = sound.currentTime;
  await page.waitForFunction(previous => window.__codexAudioProbe.contexts.at(-1).context.currentTime > previous, time, { timeout: 2000 });
  return sounds.at(-1);
};
const assertNoArrowsOrMute = async () => {
  assert.doesNotMatch(await activity.innerText(), /[←→↗↘➜➝➞➤]/, 'no action arrows remain');
  assert.equal(await activity.locator('button').evaluateAll(buttons => buttons.some(button => /ปิดเสียง|ปิดเพลง|หยุดเพลง|mute/i.test(`${button.textContent} ${button.getAttribute('aria-label') ?? ''}`))), false, 'no mute control');
};

try {
  for (const [width, height] of [[360, 800], [390, 844], [768, 900], [1280, 900], [812, 375]]) {
    await goHome(width, height);
    assert.equal(await activity.count(), 1, `${width}: Halloween activity exists`);
    assert.deepEqual(await audioState(), [], `${width}: no audio context before entry`);
    await assertNoArrowsOrMute();
    const entry = page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true });
    await overflow(`${width} closed`);
    if (width === 390 || width === 1280) {
      const tools = page.locator('.home-event-tools');
      if (await tools.getAttribute('open') !== null) await tools.locator('summary').click();
      await page.screenshot({ path: `${dir}entry-${width}.png` });
    }
    await entry.click();
    await dialog.waitFor({ state: 'visible' });
    await activeSound();
    await assertNoArrowsOrMute();
    assert.deepEqual(await dialog.locator('[data-halloween-door]').evaluateAll(els => els.map(el => el.getAttribute('data-halloween-door'))), ['ghost', 'candy', 'escape']);
    for (const title of ['กระจกเผยร่างผี', 'คืนล่าลูกอมต้องสาป', 'คฤหาสน์ไร้ทางออก']) {
      assert.equal(await dialog.getByRole('button', { name: title, exact: true }).count(), 1, `${width}: ${title}`);
    }
    assert.equal(await dialog.getByText('Halloween นี้คุณจะเป็นผีอะไร?', { exact: true }).count(), 1, 'quiz descriptor keeps the Halloween question');
    await overflow(`${width} open`);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false, `${width} dialog content overflow`);
    if (width === 390 || width === 1280) await page.screenshot({ path: `${dir}chooser-${width}.png` });
    if (width === 812) {
      await page.screenshot({ path: `${dir}chooser-landscape.png` });
      await dialog.evaluate(el => el.scrollTo(0, el.scrollHeight));
      const close = page.getByRole('button', { name: 'ปิดกิจกรรม', exact: true });
      assert.equal(await close.isVisible(), true, 'short landscape close stays visible after scrolling');
      const closeBox = await close.boundingBox();
      assert.ok(closeBox.y >= 0 && closeBox.y + closeBox.height <= height, 'short landscape close stays in viewport');
      await close.click();
      await dialog.waitFor({ state: 'hidden' });
      await waitForClosed(1);
      assert.equal(await entry.evaluate(el => el === document.activeElement), true, 'landscape close restores entry focus');
    } else if (width !== 390) {
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await waitForClosed(1);
    }
    if (width !== 390) continue;

    const before = await state();
    const requestCount = requests.length;
    const ghost = dialog.locator('[data-halloween-door="ghost"]');
    assert.ok((await ghost.boundingBox()).height >= 44, 'mobile door target is touch sized');
    await ghost.tap();
    const intro = dialog.locator('[data-halloween-intro="ghost"]');
    await intro.waitFor({ state: 'visible' });
    assert.equal(await intro.getByRole('heading', { name: 'กระจกเผยร่างผี', exact: true }).count(), 1);
    assert.equal(await intro.getByText('เร็ว ๆ นี้', { exact: true }).count(), 1);
    await assertNoArrowsOrMute();
    assert.doesNotMatch(await dialog.innerText(), /รางวัล|แต้มสะสม|คะแนนสะสม|อันดับ|leaderboard/i, 'no reward or progress UI');
    await page.screenshot({ path: `${dir}intro-390.png` });
    for (const key of [...Array(8).fill('Tab'), ...Array(8).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, `focus stays in modal (${key}: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100))})`);
    }
    await dialog.getByRole('button', { name: 'เลือกประตูอื่น', exact: true }).click();
    await dialog.locator('[data-halloween-door="candy"]').click();
    await dialog.locator('[data-halloween-intro="candy"]').waitFor({ state: 'visible' });
    assert.deepEqual((await audioState()).map(({ id, sources }) => [id, sources.length]), [[1, 1]], 'door selection keeps the same source');
    await dialog.getByRole('button', { name: 'เลือกประตูอื่น', exact: true }).click();
    await dialog.locator('[data-halloween-door="escape"]').click();
    await dialog.locator('[data-halloween-intro="escape"]').waitFor({ state: 'visible' });
    assert.deepEqual((await audioState()).map(({ id, sources }) => [id, sources.length]), [[1, 1]], 'intro changes keep one source');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await waitForClosed(1);
    assert.equal(await entry.evaluate(el => el === document.activeElement), true, 'Escape restores entry focus');
    assert.deepEqual(await state(), before, 'activity leaves storage/cookies unchanged');
    assert.deepEqual(requests.slice(requestCount), [], 'opening/playing adds no fetch, XHR, or API request');

    await entry.click();
    await dialog.waitFor({ state: 'visible' });
    await activeSound(2);
    assert.deepEqual((await audioState()).map(({ id, state }) => [id, state]), [[1, 'closed'], [2, 'running']], 'reopen creates only one active loop');
    assert.equal(await dialog.locator('[data-halloween-intro]').count(), 0, 'reopening resets selected door');
    await page.getByRole('button', { name: 'ปิดกิจกรรม', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await waitForClosed(2);
    assert.equal(await entry.evaluate(el => el === document.activeElement), true, 'close restores entry focus');
    await entry.click();
    await dialog.waitFor({ state: 'visible' });
    await activeSound(3);
    assert.deepEqual((await audioState()).map(({ id, state }) => [id, state]), [[1, 'closed'], [2, 'closed'], [3, 'running']], 'backdrop reopen retains only one active loop');
    await page.mouse.click(4, 4);
    await dialog.waitFor({ state: 'hidden' });
    await waitForClosed(3);
    assert.equal(await entry.evaluate(el => el === document.activeElement), true, 'backdrop restores entry focus');
    results.push({ journey: 'touch, keyboard containment, all doors, reset, dismissal, focus, storage and requests pass' });
  }
  results.push({ responsiveWidths: '360, 390, 768, 1280 and 812x375; chooser and dialog fit without horizontal overflow' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await goHome(390, 844);
  await page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true }).click();
  await dialog.waitFor({ state: 'visible' });
  await activeSound();
  assert.equal(await page.evaluate(() => document.getAnimations().some(a => a.playState === 'running')), false, 'reduced motion stops animations');
  await page.keyboard.press('Escape');
  await waitForClosed(1);
  results.push({ reducedMotion: 'pass' });
  for (const event of ['default', 'unknown']) {
    await goHome(390, 844, event);
    assert.equal(await activity.count(), 0, `${event}: no activity`);
    assert.deepEqual(await audioState(), [], `${event}: no audio context`);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await goHome(1280, 900);
  const tools = page.locator('.home-event-tools');
  if (await tools.getAttribute('open') === null) await tools.locator('summary').click();
  const entry = page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true });
  await entry.click();
  await dialog.waitFor({ state: 'visible' });
  await activeSound();
  const character = dialog.locator('[data-halloween-door="ghost"] .home-halloween-doorframe img');
  assert.notEqual(await character.evaluate(el => getComputedStyle(el).animationPlayState), 'paused', 'door art animates when effects are enabled');
  await page.keyboard.press('Escape');
  await waitForClosed(1);
  await page.locator('#home-event-pause').check();
  await entry.click();
  await dialog.waitFor({ state: 'visible' });
  await activeSound(2);
  assert.equal(await character.evaluate(el => getComputedStyle(el).animationPlayState), 'paused', 'existing pause control pauses activity art');
  const pausedTransform = await character.evaluate(el => getComputedStyle(el).transform);
  await page.waitForTimeout(150);
  assert.equal(await character.evaluate(el => getComputedStyle(el).transform), pausedTransform, 'paused art remains still');
  await page.keyboard.press('Escape');
  await waitForClosed(2);
  results.push({ eventPause: 'pass' });

  await goHome(390, 844);
  const unmountEntry = page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true });
  await unmountEntry.click();
  await dialog.waitFor({ state: 'visible' });
  await activeSound();
  await page.locator('.home-event-tools nav[aria-label="เลือกธีมหน้าแรก"] a[href*="event=default"]').evaluate(el => el.click());
  await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('event') === 'default');
  await page.waitForFunction(() => !document.querySelector('[data-halloween-activity], [data-event-art]'));
  await waitForClosed(1);
  assert.equal(await page.locator('[data-halloween-activity], [data-event-art]').count(), 0, 'client route clears activity and event effects');
  await page.goto(`${base}/privacy`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('[data-halloween-activity], .home-event-tools, [data-event-art]').count(), 0, 'direct route has no activity or event effects');
  assert.deepEqual(await audioState(), [], 'direct non-home route creates no audio');
  results.push({ routeIsolation: 'client and direct navigation remove activity and effects' });

  await goHome(390, 844, 'halloween', 'unavailable');
  assert.deepEqual(await audioState(), [], 'unavailable AudioContext does not instantiate');
  await page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true }).click();
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.isVisible(), true, 'activity opens without AudioContext support');
  assert.deepEqual(await audioState(), []);
  assert.deepEqual(await page.evaluate(() => window.__codexAudioProbe.rejections), []);
  await page.getByRole('button', { name: 'ปิดกิจกรรม', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });

  await goHome(390, 844, 'halloween', 'reject-resume');
  await page.getByRole('button', { name: 'ร่วมกิจกรรม', exact: true }).click();
  await dialog.waitFor({ state: 'visible' });
  await waitForContext();
  await page.waitForFunction(() => window.__codexAudioProbe.contexts[0].resumeCalls > 0);
  assert.equal(await dialog.isVisible(), true, 'rejected resume does not block activity');
  assert.deepEqual(await page.evaluate(() => window.__codexAudioProbe.rejections), [], 'resume rejection is handled');
  await page.getByRole('button', { name: 'ปิดกิจกรรม', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await waitForClosed(1);
  results.push({ audio: 'native loop signal, quiet gain, gesture start, persistence across doors, all closes/unmount, repeat opens and audio fallback pass' });
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  writeFileSync(`${dir}browser-results.json`, JSON.stringify({
    status: 'pass', base, results, errors, requests, navigationRequests,
    audioLimit: 'Verified generated buffer samples, gain, running state and clock in headless Chrome; no physical speaker or headphone listening test.',
  }, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
