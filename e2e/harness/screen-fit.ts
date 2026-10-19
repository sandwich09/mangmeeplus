import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

/** Runs in the page, without scrolling it or changing the person's current focus. */
export function screenOverflow() {
  const right = document.documentElement.clientWidth;
  return Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap(element => {
    if (element.closest('[aria-hidden="true"], [inert], .sr-only')) return [];
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    if (rect.width <= 1 || rect.height <= 1 || css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return [];
    if (rect.right <= right + 1) return [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return [];
      if (style.position === 'fixed' && parent.matches('aside, [data-drawer]') && (box.right <= 0 || box.left >= right)) return [];
      if (['auto', 'scroll'].includes(style.overflowX) && parent !== document.body && parent !== document.documentElement) return [];
      if (['hidden', 'clip'].includes(style.overflowY) && (box.height < 4 || rect.top >= box.bottom || rect.bottom <= box.top)) return [];
    }
    if (css.position === 'fixed' && element.matches('aside, [data-drawer]') && rect.left >= right) return [];
    return [`${element.tagName.toLowerCase()} ${JSON.stringify(element.textContent?.trim().slice(0, 80))}: right=${Math.round(rect.right)}, viewport=${right}`];
  });
}

export async function expectFitsScreen(page: Page, project = 'journeys-mobile') {
  if (project !== 'journeys-mobile') return;
  await expect.poll(() => page.evaluate(screenOverflow), { message: `Nothing leaves the right edge: ${page.url()}`, timeout: 5_000 }).toEqual([]);
}

/** Cover full navigation and SPA arrivals on every page in this context, including popups. */
export function watchScreenFit(context: BrowserContext, info: TestInfo) {
  const pending = new Set<Promise<void>>(), errors: unknown[] = [];
  const watch = (page: Page) => page.on('framenavigated', frame => {
    if (frame !== page.mainFrame() || page.url() === 'about:blank') return;
    const check = page.waitForLoadState('domcontentloaded').then(() => expectFitsScreen(page, info.project.name))
      .catch(error => { if (!page.isClosed()) errors.push(error); }).finally(() => pending.delete(check));
    pending.add(check);
  });
  if (info.project.name === 'journeys-mobile') {
    context.pages().forEach(watch);
    context.on('page', watch);
  }
  return async () => {
    context.off('page', watch);
    while (pending.size) await Promise.all(pending);
    if (errors.length) throw errors[0];
  };
}
