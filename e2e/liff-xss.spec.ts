import { test, expect } from './harness/fixtures';

function scriptSrcDirective(csp: string): string {
  return csp.split(';').find((directive) => directive.trim().startsWith('script-src')) ?? '';
}

test.describe('H-08 LIFF browser security', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://static.line-scdn.net/**', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: 'globalThis.liff={init:async()=>{},isLoggedIn:()=>false,login:()=>{}};',
    }));
  });

  test('closing-script payload cannot execute on employee or customer pages', async ({ page, urls }) => {
    const payload = '</script><script>globalThis.__h08_xss__="executed"</script>';
    for (const path of [
      `/auth/line/link-page/employee?token=${encodeURIComponent(payload)}`,
      `/auth/line/customer-register-page?lineChannelId=${encodeURIComponent(payload)}`,
    ]) {
      const response = await page.goto(`${urls.api}${path}`);
      expect(response?.ok()).toBe(true);
      const html = await response!.text();
      expect(html).not.toContain(payload);
      expect(html).not.toContain('__h08_xss__');
      expect(await page.evaluate(() => (globalThis as any).__h08_xss__)).toBeUndefined();

      const csp = response!.headers()['content-security-policy'] ?? '';
      expect(scriptSrcDirective(csp)).not.toContain("'unsafe-inline'");
      expect(response!.headers()['referrer-policy']).toBe('no-referrer');
      for (const script of await page.locator('script').all()) {
        expect(await script.getAttribute('src')).toBeTruthy();
        expect((await script.textContent())?.trim()).toBe('');
      }
    }
  });

  test('employee bearer query is not copied to any subresource request', async ({ page, urls }) => {
    const linkToken = 'A'.repeat(32);
    const requests: Array<{ url: string; headers: Record<string, string>; resourceType: string }> = [];
    page.on('request', (request) => requests.push({
      url: request.url(),
      headers: request.headers(),
      resourceType: request.resourceType(),
    }));

    const response = await page.goto(`${urls.api}/auth/line/link-page/employee?token=${linkToken}`);
    expect(response?.ok()).toBe(true);
    const subresources = requests.filter((request) => request.resourceType !== 'document');
    expect(subresources.length).toBeGreaterThan(0);
    for (const request of subresources) {
      expect(request.url).not.toContain(linkToken);
      expect(JSON.stringify(request.headers)).not.toContain(linkToken);
    }
  });
});
