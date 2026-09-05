/**
 * Review R05. The merge dialog can only ask for consent it can describe, so the ticket route now
 * carries the plan: which shops move, which block the merge, and which way of signing in survives.
 * The ticket itself must still never leave the server.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../../../app/api/auth/account-merge/ticket/route';
import { ACCOUNT_MERGE_COOKIE, encodeAccountMergeCookie } from './account-merge-bff.logic';

const TICKET = 'merge-ticket-value-that-is-long-enough-0123456789';
const PREVIEW = {
  canMerge: false,
  keeps: { displayName: 'บัญชีเดิม', signInWith: ['line'] },
  closes: { displayName: 'บัญชีใหม่', username: 'somchai', signInWith: ['password'] },
  companies: [{ companyName: 'ร้านมั่งมี', outcome: 'blocked', reason: 'last_active_owner' }],
};

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function request(options: { signedIn?: boolean; offer?: boolean } = {}) {
  const cookies = [
    ...(options.offer === false ? [] : [`${ACCOUNT_MERGE_COOKIE}=${encodeAccountMergeCookie({
      ticket: TICKET,
      existingAccount: { displayName: 'บัญชีเดิม', companyNames: ['ร้านมั่งมี'] },
    })}`]),
    ...(options.signedIn === false ? [] : ['watchdog_token=header.payload.signature']),
  ];
  return new NextRequest('http://localhost:3000/api/auth/account-merge/ticket', {
    headers: new Headers({ cookie: cookies.join('; '), 'x-forwarded-for': '203.0.113.55, 172.71.14.9' }),
  });
}

describe('GET /api/auth/account-merge/ticket', () => {
  it('answers with the per-shop plan and never with the ticket', async () => {
    const sent: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(PREVIEW), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const response = await GET(request());
    const body = await response.json();

    assert.equal(body.ready, true);
    assert.deepEqual(body.preview, PREVIEW);
    assert.equal(JSON.stringify(body).includes(TICKET), false, 'the ticket must stay on the server');
    // The ticket travels in the body, and the visitor's chain travels with it (review R01/R06).
    assert.equal(sent.length, 1);
    assert.ok(sent[0]!.url.endsWith('/auth/account-merge/preview'));
    assert.equal(JSON.parse(sent[0]!.body).ticket, TICKET);
    assert.equal(sent[0]!.headers['x-forwarded-for'], '203.0.113.55, 172.71.14.9');
  });

  it('still opens the dialog when the preview cannot be fetched', async () => {
    globalThis.fetch = (async () => { throw new Error('unreachable'); }) as typeof fetch;

    const body = await (await GET(request())).json();

    assert.equal(body.ready, true, 'a live offer is still a live offer');
    assert.equal(body.preview, undefined);
  });

  it('says "no offer" without calling the API at all', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;

    const body = await (await GET(request({ offer: false }))).json();

    assert.deepEqual(body, { ready: false });
    assert.equal(called, false);
  });
});
