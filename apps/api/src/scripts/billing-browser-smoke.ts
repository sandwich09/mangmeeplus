/** Optional local browser layer for billing-http-smoke; never intercepts application/API routes. */
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { openSync, closeSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import type { BillingConfigurationOperation } from '@watchdog-bms/contracts';

export async function startBillingBrowser(input: { apiOrigin: string; token: string; companyId: string }) {
  const root = process.cwd(), evidenceDir = resolve(process.env.BILLING_BROWSER_EVIDENCE_DIR ?? `/tmp/mangmee-billing-browser-evidence-${process.pid}`);
  mkdirSync(evidenceDir, { recursive: true });
  const port = await new Promise<number>((done, reject) => {
    const server = createServer(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') return reject(new Error('No port'));
      server.close(() => done(address.port)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  // Each server has a different API origin; never reuse another server's compiled routes/rewrites.
  const distDir = `.next/billing-browser-${process.pid}-${port}`;
  const log = openSync(`${evidenceDir}/next.log`, 'w', 0o600);
  const child = spawn(process.execPath, [resolve(root, 'apps/web/node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: resolve(root, 'apps/web'), env: { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', NEXT_DIST_DIR: distDir,
      INTERNAL_API_URL: `${input.apiOrigin}/v1`, NEXT_PUBLIC_API_BASE_URL: `${input.apiOrigin}/v1`, WEB_BASE_URL: origin }, stdio: ['ignore', log, log],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const stop=async()=>{
    if(child.exitCode===null&&child.signalCode===null){
      const closed=once(child,'close',{signal:AbortSignal.timeout(10000)});child.kill('SIGTERM');
      try{await closed;}catch{if(child.exitCode===null&&child.signalCode===null){const killed=once(child,'close');child.kill('SIGKILL');await killed;}}
    }
    closeSync(log);
    rmSync(resolve(root, 'apps/web', distDir), { recursive: true, force: true });
  };

  try {
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Next dev exited');
      try { const response=await fetch(`${origin}/login`, { signal: AbortSignal.timeout(4000) }); if(response.ok){ready = true; break;} } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    if (!ready) throw new Error('Next dev readiness timed out');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    context.setDefaultTimeout(30000);
    context.setDefaultNavigationTimeout(60000);
    await context.addCookies([{ name: 'watchdog_token', value: input.token, url: origin, httpOnly: true, sameSite: 'Lax' },
      { name: 'watchdog_csrf', value: 'synthetic-billing-csrf', url: origin, sameSite: 'Lax' }]);
    const page = await context.newPage();
    // Stripe's hosted UI is outside the simulated provider boundary; app APIs remain entirely real.
    await page.route('https://checkout.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Synthetic Stripe Checkout</h1>' }));
    await page.goto(`${origin}/companies/${input.companyId}/billing?channel=line`, { waitUntil: 'domcontentloaded' });
    return { page, origin, evidenceDir, close: async () => { try{await browser?.close();}finally{await stop();} } };
  } catch (error) { try{await browser?.close();}finally{await stop();} throw error; }
}

export async function selectBillingOption(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

export async function clickBillingConfiguration(page: Page, label: string) {
  const pending = page.waitForResponse(response => response.request().method() === 'POST'
    && /\/system\/billing\/configuration-(drafts|changes)(\/|$)/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: label, exact: true }).click();
  const response = await pending;
  assert.ok(response.ok(), `configuration action returned ${response.status()}`);
  return await response.json() as BillingConfigurationOperation;
}

export async function confirmBillingPassword(page: Page, password: string) {
  const input = page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true });
  if (await input.isVisible()) {
    await input.fill(password);
    await page.getByRole('button', { name: 'ยืนยันรหัสผ่าน', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'ยืนยันตัวตนแล้ว' }).waitFor();
  }
}
