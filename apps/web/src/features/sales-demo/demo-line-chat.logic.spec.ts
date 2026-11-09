import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  demoFileError, demoPollDelay, demoSendBlocked, handleDemoAction, latestDemoActions, loadDemoMessages,
  mergeDemoItems, pollDemoChat, reconcileDemoPending, sendDemoMessage,
  type DemoChatItem, type DemoChatPage, type PendingDemoMessage,
} from './demo-line-chat.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';

afterEach(() => mock.restoreAll());
const item = (id: string, createdAt = id): DemoChatItem => ({ id, createdAt, direction: 'in', messages: [{ type: 'text', text: id }] });
const page: DemoChatPage = { items: [], cursor: 'next/cursor', waiting: false, credit: { remaining: 80, total: 80 }, reads: { used: 0, limit: 3 } };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('merging deduplicates IDs, updates items and keeps chronological and stable tie order', () => {
  const updated = { ...item('b', '2'), messages: [{ type: 'text' as const, text: 'updated' }] };
  assert.deepEqual(mergeDemoItems([item('b', '2'), item('c', '2')], [item('a', '1'), updated, item('d', '2')]), [item('a', '1'), updated, item('c', '2'), item('d', '2')]);
});

test('optimistic sends reconcile by the returned server ID, including history arriving before POST completes', () => {
  const pending: PendingDemoMessage[] = [{ localId: 'local', serverId: 'server', createdAt: '1', payload: { text: 'hello' }, text: 'hello', status: 'sent' }];
  assert.deepEqual(reconcileDemoPending(pending, [item('server')]), []);
  assert.deepEqual(reconcileDemoPending(pending, [{ ...item('server'), direction: 'out' }]), pending);
  assert.equal(reconcileDemoPending([{ ...pending[0], serverId: undefined, status: 'failed' }], []).length, 1);
});

test('poll interval follows waiting and the last-send 60-second boundary', () => {
  assert.equal(demoPollDelay(true, -Infinity, 90_000), 1500);
  assert.equal(demoPollDelay(false, 1, 60_000), 1500);
  assert.equal(demoPollDelay(false, 0, 60_000), 10_000);
  assert.equal(demoPollDelay(false, -Infinity), 10_000);
});

test('poll loads history, follows the cursor and waiting, wakes on send and stops on close', async () => {
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 0;
  mock.method(globalThis, 'setTimeout', ((callback: () => void, delay: number) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; }) as any);
  mock.method(globalThis, 'clearTimeout', ((id: number) => timers.delete(id)) as any);
  const requests: { url: string; signal: AbortSignal }[] = [];
  mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    requests.push({ url: String(input), signal: init.signal });
    return Response.json({ ...page, waiting: requests.length === 1 });
  });
  const pages: DemoChatPage[] = [];
  const polling = pollDemoChat('shop/id', result => pages.push(result), error => assert.fail(String(error)), { current: -Infinity });
  await settle();
  assert.equal(requests[0].url, '/api/v1/companies/shop%2Fid/demo-chat/messages');
  assert.equal(pages[0].waiting, true);
  assert.equal(timers.get(1)?.delay, 1500);
  timers.delete(1); // Simulate a fired browser timeout.
  polling.wake();
  await settle();
  assert.match(requests[1].url, /\?after=next%2Fcursor$/);
  assert.equal(pages[1].waiting, false);
  assert.equal(timers.get(2)?.delay, 10_000);
  polling.stop();
  assert.equal(timers.size, 0);
  assert.equal(requests[1].signal.aborted, true);
  polling.wake();
  await settle();
  assert.equal(requests.length, 2);
});

test('closing during a read ignores its result and schedules no later request', async () => {
  let resolve!: (response: Response) => void;
  mock.method(globalThis, 'fetch', () => new Promise<Response>(done => { resolve = done; }));
  const onPage = mock.fn();
  const timer = mock.method(globalThis, 'setTimeout', (() => 0) as any);
  const polling = pollDemoChat('demo', onPage, error => assert.fail(String(error)), { current: 0 });
  polling.stop();
  resolve(Response.json(page));
  await settle();
  assert.equal(onPage.mock.callCount(), 0);
  assert.equal(timer.mock.callCount(), 0);
});

test('expiry stops polling and network failures schedule another read', async () => {
  const errors: unknown[] = [];
  const timer = mock.method(globalThis, 'setTimeout', (() => 0) as any);
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({ code: 'demo_link_expired' }, { status: 410 }));
  const expired = pollDemoChat('demo', () => assert.fail('Unexpected page'), error => errors.push(error), { current: 0 });
  await settle();
  assert.equal((errors[0] as any).status, 410);
  assert.equal(timer.mock.callCount(), 0);
  expired.stop();
  fetch.mock.mockImplementation(async () => { throw new TypeError('offline'); });
  const offline = pollDemoChat('demo', () => assert.fail('Unexpected page'), error => errors.push(error), { current: -Infinity });
  await settle();
  assert.equal(timer.mock.calls[0].arguments[1], 10_000);
  offline.stop();
});

test('message, postback, camera and safe URI actions share the correct dispatch', () => {
  const send = mock.fn(), pickFile = mock.fn(), navigate = mock.fn(), external = mock.fn();
  const handlers = { send, pickFile, navigate, external, origin: 'https://mangmeeplus.com' };
  handleDemoAction({ type: 'message', label: 'ถาม', text: 'เดือนนี้' }, handlers);
  handleDemoAction({ type: 'postback', label: 'ยืนยัน', data: 'action=confirm', displayText: 'ยืนยันแล้ว' }, handlers);
  handleDemoAction({ type: 'postback', label: 'ยืนยัน', data: 'data-only' }, handlers);
  assert.deepEqual(send.mock.calls.map(call => call.arguments[0]), [{ text: 'เดือนนี้' }, { postbackData: 'action=confirm', displayText: 'ยืนยันแล้ว' }, { postbackData: 'data-only', displayText: 'ยืนยัน' }]);
  handleDemoAction({ type: 'camera' }, handlers);
  handleDemoAction({ type: 'cameraRoll' }, handlers);
  assert.equal(pickFile.mock.callCount(), 2);
  for (const uri of ['/companies/demo/expenses?a=1#row', 'https://mangmeeplus.com/companies/demo', 'https://mangmeeplus.com/companies/demo/expenses?openExternalBrowser=1#line']) handleDemoAction({ type: 'uri', label: 'เปิด', uri }, handlers);
  assert.deepEqual(navigate.mock.calls.map(call => call.arguments[0]), ['/companies/demo/expenses?a=1#row', '/companies/demo', '/companies/demo/expenses#line']);
  handleDemoAction({ type: 'uri', label: 'นอกเว็บ', uri: 'https://example.org' }, handlers);
  for (const uri of ['javascript:alert(1)', 'data:text/html,bad']) handleDemoAction({ type: 'uri', label: 'เปิด', uri }, handlers);
  assert.equal(external.mock.callCount(), 1);
});

test('only latest outbound item supplies quick replies, and an outbound without chips clears them', () => {
  const outbound: DemoChatItem = { ...item('reply'), direction: 'out', messages: [{ type: 'text', text: 'hi', quickReply: { items: [{ action: { type: 'message', label: 'ต่อ', text: 'ต่อ' } }] } }] };
  assert.equal(latestDemoActions([outbound, item('visitor')])[0].label, 'ต่อ');
  assert.deepEqual(latestDemoActions([outbound, { ...outbound, id: 'new', messages: [{ type: 'text', text: 'done' }] }]), []);
});

test('API sends JSON and multipart through the authenticated BFF with exact paths and field', async () => {
  const calls: any[] = [];
  mock.method(globalThis, 'fetch', async (input: any, init: any) => { calls.push({ input, init }); return Response.json(init.method === 'POST' ? { id: 'accepted' } : page, { status: init.method === 'POST' ? 202 : 200 }); });
  await loadDemoMessages('demo');
  await sendDemoMessage('demo', { text: 'hello' });
  await sendDemoMessage('demo', { postbackData: 'data', displayText: 'confirm' });
  const file = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' });
  await sendDemoMessage('demo', file);
  assert.equal(calls[0].input, '/api/v1/companies/demo/demo-chat/messages');
  assert.equal(calls[1].init.body, '{"text":"hello"}');
  assert.equal(calls[2].init.body, '{"postbackData":"data","displayText":"confirm"}');
  assert.equal(calls[3].input, '/api/v1/companies/demo/demo-chat/files');
  assert.equal(calls[3].init.body.get('file').name, file.name);
  assert.equal(calls[3].init.headers['Content-Type'], undefined);
  assert.ok(calls.every(call => call.init.credentials === 'include'));
});

test('file validation accepts supported formats up to 10 MB and rejects unsupported or oversized input', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']) assert.equal(demoFileError(new File(['ok'], 'receipt', { type })), null);
  assert.equal(demoFileError(new File(['ok'], 'receipt.HEIC')), null);
  assert.ok(demoFileError(new File(['bad'], 'receipt.svg', { type: 'image/svg+xml' })));
  assert.equal(demoFileError(new File([new Uint8Array(10 * 1024 * 1024)], 'receipt.pdf', { type: 'application/pdf' })), null);
  assert.match(demoFileError(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'receipt.pdf', { type: 'application/pdf' }))!, /10 MB/);
});

test('send guard covers in-flight, expired and exhausted credit states', () => {
  assert.equal(demoSendBlocked(false, false, 80), false);
  assert.equal(demoSendBlocked(true, false, 80), true);
  assert.equal(demoSendBlocked(false, true, 80), true);
  assert.equal(demoSendBlocked(false, false, 0), true);
});

// Owner 2026-11-09: the quota is set per link, so the copy no longer names 3.
test('read-limit API copy says the quota is used up and points to a real shop', () => {
  assert.equal(apiErrorMessage({ status: 403, code: 'demo_read_limit_reached' }), 'ลิงก์ทดลองนี้อ่านเอกสารครบจำนวนแล้วค่ะ เปิดร้านจริงฟรีเพื่อส่งต่อได้เลยนะคะ');
});
