/** Optional local browser layer for billing-http-smoke; never intercepts application/API routes. */
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

export async function startBillingBrowser(input: { apiOrigin: string; token: string; companyId: string }) {
  const root = process.cwd(), evidenceDir = '/tmp/mangmee-billing-browser-evidence';
  mkdirSync(evidenceDir, { recursive: true });
  const port = await new Promise<number>((done, reject) => {
    const server = createServer(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') return reject(new Error('No port'));
      server.close(() => done(address.port)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  const log = openSync(`${evidenceDir}/next.log`, 'w', 0o600);
  const child = spawn(process.execPath, [resolve(root, 'apps/web/node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: resolve(root, 'apps/web'), env: { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
      INTERNAL_API_URL: `${input.apiOrigin}/v1`, NEXT_PUBLIC_API_BASE_URL: `${input.apiOrigin}/v1`, WEB_BASE_URL: origin }, stdio: ['ignore', log, log],
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const stop=async()=>{
    if(child.exitCode===null&&child.signalCode===null){
      const closed=once(child,'close',{signal:AbortSignal.timeout(10000)});child.kill('SIGTERM');
      try{await closed;}catch{if(child.exitCode===null&&child.signalCode===null){const killed=once(child,'close');child.kill('SIGKILL');await killed;}}
    }
    closeSync(log);
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
    await context.addCookies([{ name: 'watchdog_token', value: input.token, url: origin, httpOnly: true, sameSite: 'Lax' },
      { name: 'watchdog_csrf', value: 'synthetic-billing-csrf', url: origin, sameSite: 'Lax' }]);
    const page = await context.newPage();
    // Stripe's hosted UI is outside the simulated provider boundary; app APIs remain entirely real.
    await page.route('https://checkout.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Synthetic Stripe Checkout</h1>' }));
    await page.goto(`${origin}/companies/${input.companyId}/billing?channel=line`, { waitUntil: 'domcontentloaded' });
    return { page, origin, evidenceDir, close: async () => { try{await browser?.close();}finally{await stop();} } };
  } catch (error) { try{await browser?.close();}finally{await stop();} throw error; }
}
