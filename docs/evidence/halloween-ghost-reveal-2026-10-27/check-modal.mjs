import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({channel:'chrome', headless:true});
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = values => { if (values instanceof Uint32Array && values.length === 1) { values[0] = 10; return values; } return random(values); };
    Object.defineProperty(navigator, 'canShare', {configurable:true, value: () => true});
    Object.defineProperty(navigator, 'share', {configurable:true, value: async () => {}});
  });
  for (const width of [390,1280]) {
    await page.setViewportSize({width,height:width===390?844:900});
    await page.goto('http://127.0.0.1:43841/?preview=events&event=halloween');
    await page.getByRole('button',{name:'ร่วมกิจกรรม',exact:true}).click();
    await page.locator('[data-halloween-door=ghost]').click();
    const dialog = page.locator('.home-halloween-dialog');
    await dialog.screenshot({path:`${dir}modal-ready-${width}.png`});
    await dialog.getByRole('button',{name:'เผยร่างของฉัน',exact:true}).click();
    assert.equal(await dialog.getByRole('button',{name:'ข้ามเอฟเฟกต์',exact:true}).count(),0);
    await page.waitForFunction(() => document.querySelector('[data-halloween-game]')?.getAttribute('data-halloween-game') === 'revealed');
    await page.waitForFunction(() => !document.querySelector('[data-halloween-share] button')?.disabled);
    await page.waitForTimeout(900);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth),false);
    await dialog.screenshot({path:`${dir}modal-result-${width}.png`});
    const close = dialog.getByRole('button',{name:'ปิดกิจกรรม',exact:true});
    await dialog.evaluate(el => el.scrollTop = el.scrollHeight);
    await close.click();
    await dialog.waitFor({state:'hidden'});
    await page.getByRole('link',{name:'ปกติ',exact:true}).click();
    await page.locator('[data-halloween-activity]').waitFor({state:'detached'});
    console.log(`PASS ${width}: modal ready/result, no overflow, sticky close, normal-theme removal`);
  }
} finally { await browser.close(); }
