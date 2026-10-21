import { test, expect } from '../harness/fixtures';
import { FIRST_SIGHT } from './journey-kit';

for (const width of [375, 1440]) test(`public home fits ${width}px and offers LINE signup and login without a session`, async ({ page }) => {
  await page.context().clearCookies();
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ขายได้ทุกวัน แต่จ่ายไปเท่าไรไม่รู้?', FIRST_SIGHT);
  await expect(page.locator('header').getByRole('link', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible();
  await expect(page.locator('header').getByRole('link', { name: 'เข้าสู่ระบบ', exact: true })).toHaveAttribute('href', '/login');
  if (width === 375) {
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
  await page.getByText('ไม่แน่ใจว่าแพ็กเกจไหน? ตอบ 4 ข้อ', { exact: true }).click();
  await page.getByRole('button', { name: '3 - 5 คน', exact: true }).click();
  await expect(page.locator('.ch-res')).toContainText('แพ็กเกจที่เหมาะกับคำตอบ เติบโต');
  const reportFaq = page.locator('.faq details').filter({ has: page.getByText('แพ็กเกจมีรายงานให้เรียกดูไหม?', { exact: true }) });
  await reportFaq.locator('summary').click();
  await expect(reportFaq.locator('p')).toContainText('รายงานไม่รวมในแพ็กที่ขาย');
  await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)).toPass();
});
