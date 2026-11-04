import { test, expect } from '../harness/fixtures';
import { FIRST_SIGHT } from './journey-kit';

for (const width of [375, 390, 1280, 1440, 1556]) test(`public home fits ${width}px and offers LINE signup and login without a session`, async ({ page, urls }) => {
  await page.context().clearCookies();
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ขายได้ทุกวัน แต่จ่ายไปเท่าไรไม่รู้?', FIRST_SIGHT);
  await expect(page.locator('header').getByRole('link', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible();
  await expect(page.locator('header').getByRole('link', { name: 'เข้าสู่ระบบ', exact: true })).toHaveAttribute('href', '/login');
  if (width < 768) {
    await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'เมนูมือถือ' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'เมนูมือถือ' })).not.toBeVisible();
  }
  const hero = page.locator('#top');
  await expect(hero.getByRole('link', { name: /เริ่มใช้งานผ่าน LINE/ })).toBeVisible();
  await expect(hero.getByRole('link', { name: /เริ่มใช้งานผ่าน LINE/ })).toHaveAttribute('href', 'https://lin.ee/U5oRBx1');
  await expect(async () => {
    const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.width);
  }).toPass();
  const pause = hero.getByRole('button', { name: 'หยุดวิดีโอ' });
  await pause.click();
  const strip = hero.locator('.reel-strip');
  const stopped = await strip.evaluate(el => getComputedStyle(el).transform);
  // The same button is renamed once paused, so find it by its new name.
  await expect(hero.getByRole('button', { name: 'เล่นวิดีโอ' })).toBeVisible();
  await expect.poll(() => strip.evaluate(el => getComputedStyle(el).animationPlayState)).toBe('paused');
  await expect.poll(() => strip.evaluate(el => getComputedStyle(el).transform)).toBe(stopped);
  await page.getByRole('button', { name: 'ขยายภาพใบเบิกค่าใช้จ่าย', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'ตัวอย่างใบเบิกค่าใช้จ่าย' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('#pricing').getByRole('button', { name: 'จ่ายรายปี' }).click();
  await expect(page.locator('#pricing .plans')).toContainText('19,990');
  // The package guide asks one question at a time (น้องมั่งมี's step-by-step chooser).
  const guide = page.locator('#package-guide');
  for (const answer of ['3 - 5 คน', 'ไม่เกิน 30 ใบ', '1 สาขา', 'ไม่ต้องทำเอง']) await guide.getByRole('button', { name: answer, exact: true }).click();
  await expect(guide.locator('#chooser-question')).toContainText('น้องแนะนำแพ็กเกจเติบโตค่ะ');
  const reportFaq = page.locator('.faq details').filter({ has: page.getByText('แพ็กเกจมีรายงานให้เรียกดูไหม?', { exact: true }) });
  await reportFaq.locator('summary').click();
  await expect(reportFaq.locator('p')).toContainText('รายงานไม่รวมในแพ็กที่ขาย');
  await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)).toPass();

  await page.goto('/llms.txt');
  await expect(page.locator('body')).toContainText('Receipt and expense software for Thai shops');
  await page.goto('/llms-full.txt');
  await expect(page.locator('body')).toContainText('ร้านที่เข้าเกณฑ์ใช้ฟรีส่งเอกสารเพื่อเก็บร่างได้ตามสิทธิ์');
  await expect(page.locator('body')).toContainText('ยังยืนยันเอกสาร บันทึกจ่าย หรือส่งออกไม่ได้');
  await expect(page.locator('body')).toContainText('Eligible never-paid shops can send expense documents and keep drafts within their free allowance.');
  await expect(page.locator('body')).toContainText('ร้านที่เคยซื้อแพ็กเกจแล้วหมดอายุไม่อยู่ในสิทธิ์ใช้ฟรีนี้');
  await expect(page.locator('body')).toContainText('ตรวจ VAT ก่อนใช้ตอนยื่นภาษี');
  await expect(page.locator('body')).toContainText("ยอดที่อ่านได้จากเอกสาร ยังไม่ได้แปลว่าใช้ตอนยื่นภาษีได้");
  await expect(page.locator('body')).toContainText("เลือก “จ่ายค่าอะไร” แล้วใช้ยอดก่อน VAT คูณอัตราที่แสดง");
  await expect(page.locator('body')).toContainText("ขึ้นกับเอกสารและเงื่อนไขของรายการ ดูคำตอบ “ใช้ VAT ตอนยื่นภาษี” ในรายการนั้น มีตัวจริงแต่ยังไม่มีรูป เลือก “มีตัวจริง ยังไม่ได้แนบรูป” แล้วแนบทีหลังได้");
  await expect(page.locator('body')).toContainText("ร้านที่มีเมนูภาษีหัก ณ ที่จ่าย เปิดเดือนที่ต้องการ ตรวจผู้รับเงินให้ครบ แล้วส่งออก ภ.ง.ด.53 ไปยื่น การยื่นแยกจากการออก 50 ทวิ");
  await expect(page.locator('body')).toContainText('VAT นี้ใช้ตอนยื่นภาษีได้ไหม');

  const advisorUrl = new URL('auth/line/package-advisor-page', `${urls.api.replace(/\/$/, '')}/`).href;
  let failCatalogOnce = true;
  await page.route('**/v1/billing/catalog', async route => {
    if (failCatalogOnce) { failCatalogOnce = false; await route.fulfill({ status: 503, json: {} }); }
    else await route.continue();
  });
  await page.goto(advisorUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ช่วยดูแพ็กเกจที่เหมาะกับร้าน');
  await expect(page.locator('#advisor-intro')).toHaveText('มั่งมีขอรู้จักร้านอีกนิดนะคะ มีคำถามสั้น ๆ 4 ข้อ จะได้ช่วยดูว่าแพ็กเกจไหนเหมาะกับงานที่ร้านใช้จริง');
  await expect(page.locator('#advisor-empty')).toContainText('ยังอ่านข้อมูลแพ็กเกจไม่ได้');
  await page.getByRole('button', { name: 'ลองอ่านแพ็กเกจอีกครั้ง', exact: true }).click();
  await expect(page.locator('#advisor-step')).toBeVisible();
  const catalogResponse = await page.request.get(new URL('billing/catalog', `${urls.api.replace(/\/$/, '')}/`).href);
  expect(catalogResponse.ok()).toBe(true);
  const catalog = await catalogResponse.json();
  await page.locator('#advisor-options').getByRole('radio').first().click();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  for (const [answer, nextLabel] of [['ยังไม่แน่ใจ', 'ถัดไป'], ['อ่านและเก็บใบเสร็จ', 'ถัดไป'], ['กระดาษหรือสมุด', 'ดูคำแนะนำ']] as const) {
    await page.locator('#advisor-options').getByRole('radio', { name: answer, exact: true }).click();
    await page.getByRole('button', { name: nextLabel, exact: true }).click();
  }
  if (catalog.offers.some((offer: { interval: string; availability: string; featureKeys: string[] }) => offer.interval === 'month' && offer.availability === 'AVAILABLE' && offer.featureKeys.includes('expenses'))) {
    await expect(page.locator('#advisor-result')).toBeVisible();
    await expect(page.locator('#advisor-result-reason')).toContainText('จากที่คุณเล่า มั่งมีแนะนำแพ็กเกจนี้ค่ะ');
    await expect(page.locator('#advisor-result-reason')).toContainText('ยังไม่ระบุจำนวนใบเสร็จ');
    await expect(page.locator('#advisor-result-reason')).toContainText('เริ่มจากถ่ายใบเสร็จและเก็บรายการไว้ดูในที่เดียว');
  } else {
    await expect(page.locator('#advisor-empty')).toContainText('ยังไม่พบแพ็กเกจที่เปิดขายและรองรับครบ');
    await expect(page.getByRole('button', { name: 'กลับไปแก้คำตอบ', exact: true })).toBeVisible();
  }
  const receiptUrl = await page.locator('body').getAttribute('data-oa-add-url');
  if (receiptUrl) {
    await page.route(receiptUrl, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<p>กลับถึง LINE แล้ว</p>' }));
    await page.getByRole('link', { name: 'กลับไปส่งใบเสร็จ', exact: true }).click();
    await expect(page).toHaveURL(receiptUrl);
  } else {
    await page.getByRole('link', { name: 'กลับไปส่งใบเสร็จ', exact: true }).click();
    await expect(page.locator('#advisor-status')).toHaveText('กลับไปที่แชท LINE เพื่อส่งใบเสร็จได้เลยค่ะ');
  }
});
