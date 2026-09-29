// purchase-without-setup R-B5 (4), review 2026-09-29: `login_wall_from_line_link` counts how often a
// LINE link met the login wall. Most LINE notices link straight to the web with
// `openExternalBrowser=1` (the proxy keeps it in `next`), so that marker counts as much as
// `channel=line` does — and an auto-start that says where it came from (`from`) is always counted.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../../../app/api/auth/line-login/start/route';

const realFetch = globalThis.fetch;
const realInfo = console.info;
afterEach(() => { globalThis.fetch = realFetch; console.info = realInfo; });

async function start(query: Record<string, string>) {
  const logged: unknown[] = [];
  console.info = (line: string) => { logged.push(JSON.parse(line)); };
  globalThis.fetch = (async () => Response.json({ line: { available: true, channelId: 'test-channel' } })) as typeof fetch;
  const url = new URL('/api/auth/line-login/start', 'http://localhost:3000');
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await GET(new NextRequest(url, { headers: new Headers({ host: 'localhost:3000' }) }));
  return { response, logged };
}

describe('BFF /api/auth/line-login/start — login_wall_from_line_link', () => {
  it('counts a LINE notice link (openExternalBrowser=1 inside next) as a login wall from LINE', async () => {
    const { response, logged } = await start({ returnTo: '/companies/c/expenses/e1?openExternalBrowser=1', from: 'line-link', auto: '1' });
    assert.equal(response.status, 302, 'and still starts LINE login');
    assert.deepEqual(logged, [{ event: 'login_wall_from_line_link', from: 'line-link', auto: true, hasSession: false }]);
  });

  it('still counts channel=line on a manual tap, with no reason given', async () => {
    const { logged } = await start({ returnTo: '/companies/c/billing?channel=line' });
    assert.deepEqual(logged, [{ event: 'login_wall_from_line_link', from: null, auto: false, hasSession: false }]);
  });

  it('logs whenever `from` is present, and never echoes a reason it does not know', async () => {
    const { logged } = await start({ returnTo: '/companies/c/dashboard', from: '<script>' });
    assert.deepEqual(logged, [{ event: 'login_wall_from_line_link', from: null, auto: false, hasSession: false }]);
  });

  it('stays quiet for an ordinary sign-in', async () => {
    const { logged } = await start({ returnTo: '/companies/c/dashboard' });
    assert.deepEqual(logged, []);
  });
});
