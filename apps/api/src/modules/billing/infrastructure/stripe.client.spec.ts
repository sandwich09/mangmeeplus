import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { STRIPE_API_VERSION } from '@watchdog-bms/contracts';
import { StripeClient, StripeRequestError, safeStripeUrl, verifyStripeSignature } from './stripe.client';

const config = { billingMode: 'test', stripeAccountId: 'acct_Synthetic', stripeSecretKey: 'sk_test_synthetic' } as any;
test('Stripe request pins account mode, API version, key and serialized nested checkout fields', async () => {
  let call: { url: string; init: RequestInit } | undefined;
  const client = new StripeClient(config, (async (url, init) => { call = { url: String(url), init: init! }; return new Response(JSON.stringify({ id: 'cs_Synthetic', livemode: false })); }) as typeof fetch);
  await client.request('POST', '/checkout/sessions', { mode: 'subscription', line_items: [{ price: 'price_Synthetic', quantity: 1 }] }, 'synthetic-command');
  assert.equal(call!.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(new Headers(call!.init.headers).get('Stripe-Version'), STRIPE_API_VERSION);
  assert.equal(new Headers(call!.init.headers).get('Idempotency-Key'), 'synthetic-command');
  assert.equal(call!.init.redirect, 'error');
  assert.equal(new URLSearchParams(String(call!.init.body)).get('line_items[0][quantity]'), '1');
});
test('successful wrong-mode response stays UNKNOWN: it cannot release a purchase reservation', async () => {
  const client = new StripeClient(config, (async () => new Response(JSON.stringify({ id: 'cs_Synthetic', livemode: true }))) as typeof fetch);
  await assert.rejects(client.request('POST', '/checkout/sessions'), (e: unknown) => e instanceof StripeRequestError && e.outcome === 'UNKNOWN' && e.code === 'mode_mismatch');
});
test('transport and server failures are ambiguous; explicit rejection and rate limit are distinct', async () => {
  for (const [status, outcome] of [[500, 'UNKNOWN'], [400, 'REJECTED'], [429, 'RETRY']] as const) {
    const client = new StripeClient(config, (async () => new Response(JSON.stringify({ error: { message: 'provider-secret-must-not-leak' } }), { status })) as typeof fetch);
    await assert.rejects(client.request('POST', '/checkout/sessions'), (e: unknown) => e instanceof StripeRequestError && e.outcome === outcome && !e.message.includes('provider-secret'));
  }
  const client = new StripeClient(config, (async () => { throw new Error('socket'); }) as typeof fetch);
  await assert.rejects(client.request('POST', '/checkout/sessions'), (e: unknown) => e instanceof StripeRequestError && e.outcome === 'UNKNOWN');
});
test('pagination must finish and use a progressing cursor before reconciliation trusts the set', async () => {
  let calls = 0;
  const client = new StripeClient(config, (async () => { calls++; return new Response(JSON.stringify({ data: [{ id: 'in_same' }], has_more: true })); }) as typeof fetch);
  await assert.rejects(client.list('/invoices', {}), /list_cursor_invalid/); assert.equal(calls, 2);
});
test('signatures require exact body, fresh timestamp and one timestamp; rotated signatures are supported', () => {
  const raw = Buffer.from('{"id":"evt_test"}'), now = Date.now(), t = Math.floor(now / 1000), secret = 'whsec_synthetic';
  const hash = createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
  const header = `t=${t},v1=${'0'.repeat(64)},v1=${hash}`;
  assert.equal(verifyStripeSignature(raw, header, secret, now), true);
  assert.equal(verifyStripeSignature(Buffer.from('{}'), header, secret, now), false);
  assert.equal(verifyStripeSignature(raw, header, secret, now + 301000), false);
  assert.equal(verifyStripeSignature(raw, `${header},t=${t}`, secret, now), false);
});
test('provider destinations reject lookalikes, credentials, custom ports and wrong surface', () => {
  for (const url of ['http://pay.stripe.com/x', 'https://pay.stripe.com.attacker.test/x', 'https://user@pay.stripe.com/x', 'https://pay.stripe.com:444/x', 'javascript:alert(1)']) assert.equal(safeStripeUrl(url, 'document'), null);
  assert.equal(safeStripeUrl('https://checkout.stripe.com/x', 'document'), null);
  assert.equal(safeStripeUrl('https://invoice.stripe.com/x', 'document'), 'https://invoice.stripe.com/x');
});
