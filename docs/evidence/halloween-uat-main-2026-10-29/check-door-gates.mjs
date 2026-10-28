import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'https://uat.mangmeeplus.com';
const candy = Date.parse('2026-10-29T00:00:00+07:00');
const escape = Date.parse('2026-10-30T00:00:00+07:00');
const evidence = new URL('.', import.meta.url);

async function openChooser(page, url = `${base}/halloween`) {
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('.home-halloween-dialog').waitFor({ state: 'visible' });
}

async function setClock(page, value) {
  await page.evaluate(time => {
    window.__uatDoorNow = time;
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
  await page.waitForTimeout(50);
}

async function doorState(page, id) {
  return page.locator(`[data-halloween-door="${id}"]`).evaluate(element => {
    const style = getComputedStyle(element);
    return {
      disabled: element.disabled,
      filter: style.filter,
      cursor: style.cursor,
      backgroundColor: style.backgroundColor,
      text: element.textContent,
    };
  });
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const label = String(viewport.width);
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Bangkok', reducedMotion: 'reduce' });
    await context.addInitScript(initial => {
      window.__uatDoorNow = initial;
      Date.now = () => window.__uatDoorNow;
    }, candy - 1);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await openChooser(page, `${base}/halloween?previewGame=escape`);
    assert.equal(await page.locator('[data-halloween-escape-game]').count(), 0, `${label}: production ignores previewGame`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: no horizontal overflow`);

    const candyBefore = await doorState(page, 'candy');
    const escapeBeforeCandy = await doorState(page, 'escape');
    assert.equal(candyBefore.disabled, true, `${label}: candy disabled before cutoff`);
    assert.equal(escapeBeforeCandy.disabled, true, `${label}: escape disabled before candy cutoff`);
    assert.match(candyBefore.filter, /grayscale/, `${label}: locked candy is grey`);
    assert.equal(candyBefore.cursor, 'not-allowed', `${label}: locked candy cursor`);
    await page.locator('[data-halloween-door="candy"]').evaluate(element => element.click());
    assert.equal(await page.locator('[data-halloween-candy-game]').count(), 0, `${label}: disabled candy cannot open`);
    await page.screenshot({ path: new URL(`${label}-candy-before.png`, evidence).pathname, fullPage: true });

    await setClock(page, candy);
    await page.waitForFunction(() => !document.querySelector('[data-halloween-door="candy"]')?.disabled);
    const candyAt = await doorState(page, 'candy');
    const escapeAtCandy = await doorState(page, 'escape');
    assert.equal(candyAt.disabled, false, `${label}: candy opens at cutoff`);
    assert.equal(escapeAtCandy.disabled, true, `${label}: escape stays locked at candy cutoff`);
    await page.locator('[data-halloween-door="candy"]').click();
    await page.locator('[data-halloween-candy-game="ready"]').waitFor();
    await page.screenshot({ path: new URL(`${label}-candy-at.png`, evidence).pathname, fullPage: true });

    await setClock(page, escape - 1);
    await page.getByRole('button', { name: 'ปิดกิจกรรม' }).click();
    await openChooser(page);
    const escapeBefore = await doorState(page, 'escape');
    assert.equal(escapeBefore.disabled, true, `${label}: escape disabled before cutoff`);
    assert.match(escapeBefore.filter, /grayscale/, `${label}: locked escape is grey`);
    await page.locator('[data-halloween-door="escape"]').evaluate(element => element.click());
    assert.equal(await page.locator('[data-halloween-escape-game]').count(), 0, `${label}: disabled escape cannot open`);

    await setClock(page, escape);
    await page.waitForFunction(() => !document.querySelector('[data-halloween-door="escape"]')?.disabled);
    await page.locator('[data-halloween-door="escape"]').click();
    await page.locator('[data-halloween-escape-game="ready"]').waitFor();
    await page.screenshot({ path: new URL(`${label}-escape-at.png`, evidence).pathname, fullPage: true });
    assert.deepEqual(errors, [], `${label}: no browser errors`);
    results.push({ viewport, candyBefore, candyAt, escapeAtCandy, escapeBefore, errors });
    await context.close();

    const actualContext = await browser.newContext({ viewport, timezoneId: 'Asia/Bangkok', reducedMotion: 'reduce' });
    const actualPage = await actualContext.newPage();
    const actualErrors = [];
    actualPage.on('pageerror', error => actualErrors.push(error.message));
    await openChooser(actualPage);
    const actualCandy = await doorState(actualPage, 'candy');
    const actualEscape = await doorState(actualPage, 'escape');
    assert.equal(actualCandy.disabled, false, `${label}: candy is live after 29 Oct cutoff`);
    assert.equal(actualEscape.disabled, true, `${label}: escape remains locked on 29 Oct`);
    assert.match(actualEscape.filter, /grayscale/, `${label}: actual escape is grey`);
    assert.equal(await actualPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: actual page has no overflow`);
    assert.deepEqual(actualErrors, [], `${label}: actual page has no browser errors`);
    await actualPage.screenshot({ path: new URL(`${label}-actual-2026-10-29.png`, evidence).pathname, fullPage: true });
    results.at(-1).actual = { candy: actualCandy, escape: actualEscape, errors: actualErrors };
    await actualContext.close();
  }
  console.log(JSON.stringify({ status: 'pass', base, source: '56cdb4ee50bedf3f0c22451faf1583ffb6ec252c', results }, null, 2));
} finally {
  await browser.close();
}
