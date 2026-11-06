import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, mock, test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { certificateHarness, h, mutable } from '@/features/expenses/expense-certificate-test-harness';
import type { DemoChatItem, DemoChatPage } from './demo-line-chat.logic';

require.extensions['.css'] = module => { module.exports = {}; };
const portals = mutable('react-dom');
const scrollLock = mutable('@/common/hooks/use-body-scroll-lock');
const dialogFocus = mutable('@/common/hooks/use-dialog-focus');
const logic = mutable('@/features/sales-demo/demo-line-chat.logic');
const toast = mutable('@/common/feedback/toast-bus');
const { DemoLineChat } = require('./DemoLineChat');
const descriptors = ['document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
afterEach(() => {
  mock.restoreAll();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const page: DemoChatPage = { items: [], cursor: null, waiting: false, credit: { remaining: 80, total: 80 }, reads: { used: 0, limit: 3 } };
function popup(wide = false, options: { open?: boolean; items?: DemoChatItem[]; page?: DemoChatPage | null; expired?: boolean; text?: string } = {}) {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body: {}, cookie: '', activeElement: null } });
  const external = mock.fn();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin: 'https://mangmeeplus.com' }, open: external,
    matchMedia: () => ({ matches: wide, addEventListener() {}, removeEventListener() {} }),
  } });
  mock.method(portals, 'createPortal', (children: any) => children);
  const lock = mock.method(scrollLock, 'useBodyScrollLock', () => undefined);
  mock.method(dialogFocus, 'useDialogFocus', () => undefined);
  const stop = mock.fn(), wake = mock.fn();
  const poll = mock.method(logic, 'pollDemoChat', () => ({ stop, wake }));
  const visits: string[] = [];
  const view = certificateHarness(() => h(AppRouterContext.Provider, { value: { push: (href: string) => visits.push(href) } as never },
    h(DemoLineChat, { companyId: 'demo' })), [true, wide, options.open ?? true, true, options.items ?? [], [], false, options.page === undefined ? page : options.page, options.expired ?? false, false, options.text ?? '', false, null]);
  return { ...view, visits, external, lock, poll, stop, wake };
}

test('launcher opens with the single local greeting and existing avatar asset', () => {
  const view = popup(false, { open: false });
  assert.match(view.render(), /demo-chat-unread/);
  view.find('button', props => props['aria-label'] === 'แชท LINE (จำลอง)').onClick();
  const html = view.render();
  assert.match(html, /role="dialog"/);
  assert.match(html, /สวัสดีค่ะ น้องมั่งมีเองนะคะ/);
  assert.match(html, /เครดิต 80\/80 · อ่านเอกสาร 0\/3/);
  assert.equal(view.state[3], false);
  const avatar = view.find('img', props => props.alt === 'มั่งมี');
  assert.ok(existsSync(resolve('public', avatar.src.slice(1))));
});

for (const wide of [false, true]) test(`URI chips navigate behind chat and minimise on phone at wide=${wide}`, () => {
  const items: DemoChatItem[] = [{ id: 'out', direction: 'out', createdAt: '1', messages: [{ type: 'text', text: 'ไปดู', quickReply: { items: [{ action: { type: 'uri', label: 'ดูในระบบ', uri: '/companies/demo/expenses' } }] } }] }];
  const view = popup(wide, { items });
  const html = view.render();
  assert.equal(view.lock.mock.calls.at(-1)!.arguments[0], !wide);
  assert.equal(html.includes('demo-chat-backdrop'), !wide);
  assert.match(html, wide ? /role="region"/ : /role="dialog"/);
  view.find('button', props => props.children.includes('ดูในระบบ')).onClick();
  assert.deepEqual(view.visits, ['/companies/demo/expenses']);
  assert.equal(view.state[2], wide);
  assert.deepEqual(view.state[4], items);
});

test('open starts polling, close stops it and minimised chat has no polling', () => {
  const view = popup(true);
  view.render(true);
  assert.equal(view.poll.mock.callCount(), 1);
  view.find('button', props => props['aria-label'] === 'ย่อแชทจำลอง').onClick();
  assert.doesNotMatch(view.render(true), /role="region"/);
  assert.equal(view.stop.mock.callCount(), 1);
  assert.equal(view.poll.mock.callCount(), 1);
  view.cleanup();
});

test('empty, loading, typing, expired, credit and read-limit input states', () => {
  let view = popup(true, { page: null });
  assert.match(view.render(), /กำลังโหลดบทสนทนา/);
  assert.doesNotMatch(view.render(), /สวัสดีค่ะ/);
  assert.equal(view.find('button', props => props.children.includes('ส่ง')).disabled, true);
  view = popup(true, { page: { ...page, waiting: true } });
  assert.match(view.render(), /น้องมั่งมีกำลังพิมพ์/);
  view = popup(true, { expired: true });
  assert.match(view.render(), /ลิงก์เดโม่นี้หมดอายุแล้วค่ะ/);
  assert.match(view.render(), /คุยกับทีมดูแล/);
  assert.doesNotMatch(view.render(), /<textarea/);
  view = popup(true, { text: 'hi', page: { ...page, credit: { remaining: 0, total: 80 } } });
  assert.match(view.render(), /เครดิตทดลองหมดแล้ว/);
  assert.equal(view.find('button', props => props.children.includes('ส่ง')).disabled, true);
  view = popup(true, { text: 'hi', page: { ...page, reads: { used: 3, limit: 3 } } });
  assert.match(view.render(), /อ่านเอกสารครบ 3 ใบแล้ว/);
  assert.equal(view.find('button', props => props['aria-label'] === 'แนบรูปหรือ PDF').disabled, true);
  assert.equal(view.find('button', props => props.children.includes('ส่ง')).disabled, false);
});

test('Enter sends optimistically, prevents a second send, then reconciles with history', async () => {
  let accept!: (result: { id: string }) => void;
  const send = mock.method(logic, 'sendDemoMessage', () => new Promise(done => { accept = done; }));
  const view = popup(false, { text: 'สวัสดี' });
  view.render(true);
  const input = view.find('textarea');
  const preventDefault = mock.fn();
  const enter = { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault };
  input.onKeyDown(enter); input.onKeyDown(enter);
  assert.equal(send.mock.callCount(), 1);
  assert.equal(view.state[6], true);
  assert.equal((view.state[5] as any[])[0].text, 'สวัสดี');
  // Poll wins the race against the POST response.
  view.poll.mock.calls[0].arguments[1]({ ...page, items: [{ id: 'server-id', direction: 'in', createdAt: '1', messages: [{ type: 'text', text: 'สวัสดี' }] }] });
  accept({ id: 'server-id' });
  await view.settle();
  const html = view.render();
  assert.deepEqual(view.state[5], []);
  assert.equal(view.state[6], false);
  assert.equal(view.state[10], '');
  assert.doesNotMatch(html, /สวัสดีค่ะ น้องมั่งมี/);
  assert.doesNotMatch(html, /คำถามลัด/);
  assert.match(html, /สวัสดี/);
  assert.equal(view.wake.mock.callCount(), 2);
  view.cleanup();
});

test('Shift+Enter and composing Enter preserve newline/input without sending', () => {
  const send = mock.method(logic, 'sendDemoMessage', async () => ({ id: 'id' }));
  const view = popup(false, { text: 'hello' });
  view.render();
  const input = view.find('textarea');
  input.onKeyDown({ key: 'Enter', shiftKey: true, nativeEvent: { isComposing: false }, preventDefault: assert.fail });
  input.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true }, preventDefault: assert.fail });
  assert.equal(send.mock.callCount(), 0);
});

test('network failure retains the optimistic bubble and retry sends its original payload', async () => {
  const send = mock.method(logic, 'sendDemoMessage', async () => { throw new TypeError('offline'); });
  const view = popup(true, { text: 'ถามอีกครั้ง' });
  view.render();
  view.find('button', props => props.children.includes('ส่ง')).onClick();
  await view.settle();
  assert.match(view.render(), /ส่งไม่สำเร็จ แตะเพื่อส่งอีกครั้ง/);
  send.mock.mockImplementation(async () => ({ id: 'accepted' }) as never);
  view.find('button', props => props.children.includes('ส่งไม่สำเร็จ แตะเพื่อส่งอีกครั้ง')).onClick();
  await view.settle();
  assert.doesNotMatch(view.render(), /ส่งไม่สำเร็จ แตะเพื่อส่งอีกครั้ง/);
  assert.deepEqual(send.mock.calls[1].arguments[1], { text: 'ถามอีกครั้ง' });
  assert.equal((view.state[5] as any[]).length, 1);
});

for (const [status, code, expected] of [[410, 'demo_link_expired', 'ลิงก์เดโม่นี้หมดอายุแล้วค่ะ'], [403, 'demo_read_limit_reached', 'อ่านเอกสารครบ 3 ใบแล้ว']] as const) test(`send failure ${status} shows the actionable input state`, async () => {
  mock.method(logic, 'sendDemoMessage', async () => { throw { status, code }; });
  const view = popup(true, { text: 'hello' });
  view.render();
  view.find('button', props => props.children.includes('ส่ง')).onClick();
  await view.settle();
  assert.match(view.render(), new RegExp(expected));
});

test('429 emits the requested toast and allows retry', async () => {
  mock.method(logic, 'sendDemoMessage', async () => { throw { status: 429 }; });
  const emit = mock.method(toast, 'emitToast', () => undefined);
  const view = popup(true, { text: 'hello' });
  view.render();
  view.find('button', props => props.children.includes('ส่ง')).onClick();
  await view.settle();
  assert.equal(emit.mock.calls[0].arguments[0].message, logic.DEMO_RATE_LIMIT);
  assert.match(view.render(), /ส่งไม่สำเร็จ แตะเพื่อส่งอีกครั้ง/);
});

test('file picker accepts images and PDF, shows filename immediately and retains file for retry', async () => {
  mock.method(logic, 'sendDemoMessage', async () => { throw new TypeError('offline'); });
  const view = popup(true);
  view.render();
  const fileInput = view.find('input', props => props.type === 'file');
  assert.equal(fileInput.accept, 'image/*,application/pdf');
  const file = new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' });
  const target = { files: [file], value: 'receipt.pdf' };
  fileInput.onChange({ target });
  assert.equal(target.value, '');
  assert.equal((view.state[5] as any[])[0].payload, file);
  await view.settle();
  assert.match(view.render(), /receipt.pdf/);
  assert.match(view.render(), /ส่งไม่สำเร็จ แตะเพื่อส่งอีกครั้ง/);
});

test('phone sheet minimises with a downward header swipe', () => {
  const view = popup(false);
  view.render();
  const header = view.find('header', props => props.className === 'demo-chat-header');
  header.onTouchStart({ touches: [{ clientY: 30 }] });
  header.onTouchEnd({ changedTouches: [{ clientY: 110 }] });
  assert.equal(view.state[2], false);
});

test('visitor image items without a URL show a file chip instead of a broken image', () => {
  const items: DemoChatItem[] = [{ id: 'in', direction: 'in', createdAt: '1', messages: [{ type: 'image', fileName: 'receipt.jpg' }, { type: 'file', fileName: 'invoice.pdf' }] }];
  const view = popup(true, { items });
  const html = view.render();
  assert.match(html, /📷 receipt.jpg/);
  assert.match(html, /📄 invoice.pdf/);
  assert.equal(view.nodes.filter(node => node.tag === 'img' && node.props.alt !== 'มั่งมี').length, 0);
});
