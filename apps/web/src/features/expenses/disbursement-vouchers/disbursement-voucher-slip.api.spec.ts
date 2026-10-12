import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import { subscribeToastBus } from '@/common/feedback/toast-bus';
import { uploadDisbursementVoucherSlip, attachDisbursementVoucherSlip, fetchDisbursementVoucherSlipBlob, payDisbursementVoucher } from './disbursement-vouchers.api';
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => { globalThis.fetch = originalFetch; if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete (globalThis as Record<string, unknown>)['window']; });
const file = () => new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], 'สลิป.jpg', { type: 'image/jpeg' });
test('wrong type, empty or over ten megabytes refuses with server copy before any request', async () => {
  let calls = 0; globalThis.fetch = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  for (const bad of [new File(['x'], 'file.txt', { type: 'text/plain' }), new File([], 'empty.jpg', { type: 'image/jpeg' }), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })]) {
    await assert.rejects(() => uploadDisbursementVoucherSlip('shop', 'doc', bad), { message: DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_slip_invalid });
  }
  assert.equal(calls, 0);
});
test('claim uploader runs intent, storage and completion in order, then paid attachment replaces the pointer', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith('slip-upload-intent')) return Response.json({ attachmentId: 'attachment', uploadUrl: 'https://storage.example.test/slip', uploadMethod: 'PUT', uploadHeaders: { 'If-None-Match': '*' } });
    if (url.includes('storage.example')) return new Response(null, { status: 200 });
    return Response.json({ header: { id: 'doc' }, slip: { attachmentId: 'attachment' } });
  }) as typeof fetch;
  const id = await uploadDisbursementVoucherSlip('shop', 'doc', file());
  await attachDisbursementVoucherSlip('shop', 'doc', id);
  assert.deepEqual(calls.map(c => c.url), ['/api/v1/companies/shop/disbursement-vouchers/doc/slip-upload-intent', 'https://storage.example.test/slip', '/api/v1/companies/shop/disbursement-vouchers/doc/slip-uploads/attachment/complete', '/api/v1/companies/shop/disbursement-vouchers/doc/slip']);
  assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { originalFileName: 'สลิป.jpg', mimeType: 'image/jpeg', byteSize: 4 });
  assert.equal(calls[1]!.init!.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[2]!.init!.body as string), { byteSize: 4 });
  assert.deepEqual(JSON.parse(calls[3]!.init!.body as string), { attachmentId: 'attachment' });
});
test('pay carries the uploaded id only when chosen, and slip refusals never automatically toast', async () => {
  (globalThis as Record<string, unknown>)['window'] = {};
  const bodies: any[] = [], events: unknown[] = [];
  const unsubscribe = subscribeToastBus(event => events.push(event));
  globalThis.fetch = (async (_, init) => { bodies.push(JSON.parse(init!.body as string)); return bodies.length < 3 ? Response.json({}) : Response.json({ code: 'disbursement_slip_not_owned' }, { status: 400 }); }) as typeof fetch;
  try {
    await payDisbursementVoucher('shop', 'doc', { commandId: 'one', expectedVersion: 2 });
    await payDisbursementVoucher('shop', 'doc', { commandId: 'two', expectedVersion: 2, slipAttachmentId: 'attachment' });
    await assert.rejects(() => attachDisbursementVoucherSlip('shop', 'doc', 'attachment'));
    assert.equal('slipAttachmentId' in bodies[0], false); assert.equal(bodies[1].slipAttachmentId, 'attachment'); assert.deepEqual(events, []);
  } finally { unsubscribe(); }
});
test('viewing resolves a fresh authenticated slip URL each time and uses the claim checked preview helper', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input); calls.push(url);
    if (url.endsWith('/slip')) return Response.json({ downloadUrl: 'https://storage.example.test/view' });
    return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'Content-Type': 'image/jpeg' } });
  }) as typeof fetch;
  for (let n = 0; n < 2; n++) assert.equal((await fetchDisbursementVoucherSlipBlob('shop', 'doc')).type, 'image/jpeg');
  assert.equal(calls.filter(url => url.endsWith('/slip')).length, 2);
});
