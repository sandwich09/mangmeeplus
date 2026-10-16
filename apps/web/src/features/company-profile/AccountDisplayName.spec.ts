import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';
import { ToastContext } from '@/common/components/toast/use-toast';
const api = mutable('@/features/company-profile/company-profile.api');
const svg = require.extensions['.svg'];
require.extensions['.svg'] = (m) => { m.exports = () => null; };
const { AccountDisplayName } = require('./AccountDisplayName');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const data = { displayName: 'ชื่อเดิม', history: [] };
function form() {
  return certificateHarness(() => h(ToastContext.Provider, { value: { success() {}, error() {}, warning() {} } }, h(AccountDisplayName, { companyId: 'co' })), [data, 'ชื่อใหม่', false, '']);
}

test('saving publishes the server-confirmed name immediately for mounted account-name readers', async () => {
  const original = globalThis.window, target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  let detail: unknown;
  target.addEventListener(api.ACCOUNT_NAME_CHANGED_EVENT, (event: Event) => { detail = (event as CustomEvent).detail; });
  const save = mock.method(api, 'setMyDisplayName', async () => ({ ...data, displayName: 'ชื่อใหม่' }));
  const view = form();
  try {
    view.render(); view.find('form').onSubmit({ preventDefault() {} }); await view.settle();
    assert.deepEqual(detail, { displayName: 'ชื่อใหม่' });
    assert.equal(view.state[1], 'ชื่อใหม่');
  } finally { view.cleanup(); save.mock.restore(); Object.defineProperty(globalThis, 'window', { configurable: true, value: original }); }
});

test('rate-limit refusal stays on the name field with the wait and keeps the typed name', async () => {
  for (const [seconds, message] of [[61, 'บันทึกบ่อยเกินไป ลองอีกครั้งใน 2 นาที'], [undefined, 'บันทึกบ่อยเกินไป ลองอีกครั้งภายหลัง']] as const) {
    const save = mock.method(api, 'setMyDisplayName', async () => { throw { status: 429, details: { retryAfterSeconds: seconds } }; });
    const view = form();
    try {
      view.render(); view.find('form').onSubmit({ preventDefault() {} }); await view.settle();
      const html = view.render(); assert.match(html, new RegExp(message));
      assert.equal(view.state[1], 'ชื่อใหม่'); assert.equal(view.find('TextField').error, message);
      assert.equal(view.find('button', p => p.type === 'submit').disabled, false);
    } finally { view.cleanup(); save.mock.restore(); }
  }
});


test('the shared name updates menu and greeting readers, survives stale props, and does not leak to another user', () => {
  const { AccountNameScope, useAccountDisplayName } = require('./AccountNameScope');
  const original = globalThis.window, target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  let userId = 'one';
  function Reader({ label }: { label: string }) { return h('p', null, label, ':', useAccountDisplayName('stale page')); }
  const view = certificateHarness(() => h(AccountNameScope, { userId, displayName: 'ชื่อเดิม' }, h(Reader, { label: 'menu' }), h(Reader, { label: 'greeting' })));
  try {
    view.render(true);
    target.dispatchEvent(new CustomEvent(api.ACCOUNT_NAME_CHANGED_EVENT, { detail: { displayName: 'ชื่อใหม่' } }));
    const html = view.render(); assert.match(html, /menu:ชื่อใหม่/); assert.match(html, /greeting:ชื่อใหม่/);
    assert.doesNotMatch(html, /ชื่อเดิม|stale page/);
    userId = 'two'; assert.match(view.render(), /menu:ชื่อเดิม/);
    view.cleanup(); const before = view.state[0];
    target.dispatchEvent(new CustomEvent(api.ACCOUNT_NAME_CHANGED_EVENT, { detail: { displayName: 'late' } }));
    assert.equal(view.state[0], before);
  } finally { view.cleanup(); Object.defineProperty(globalThis, 'window', { configurable: true, value: original }); }
});

test('a late initial name read cannot replace typed text or a successful save', async () => {
  const original = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { localStorage: { getItem: () => null } }) });
  for (const saveFirst of [false, true]) {
    let resolve!: (value: unknown) => void;
    const read = mock.method(api, 'getDisplayNameHistory', () => new Promise(done => { resolve = done; }));
    const save = mock.method(api, 'setMyDisplayName', async () => ({ ...data, displayName: 'ชื่อใหม่' }));
    const view = form();
    try {
      view.render(true);
      if (saveFirst) { view.find('form').onSubmit({ preventDefault() {} }); await view.settle(); }
      else view.find('TextField').onChange({ target: { value: 'กำลังแก้ชื่อ' } });
      resolve(data); await view.settle();
      assert.equal(view.state[1], saveFirst ? 'ชื่อใหม่' : 'กำลังแก้ชื่อ');
    } finally { view.cleanup(); read.mock.restore(); save.mock.restore(); }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: original });
});


test('the workspace menu and home greeting consume the same name scope', () => {
  const shell = readFileSync(new URL('../web-core-workspace/WorkspaceLayout.tsx', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../web-core-workspace/components/WorkspaceDashboardPage.tsx', import.meta.url), 'utf8');
  assert.match(shell, /<AccountNameScope userId=\{props.session.userId\}/);
  assert.equal((shell.match(/const displayName = useAccountDisplayName\(session.displayName/g) ?? []).length, 2);
  assert.equal((shell.match(/userName=\{stripThaiTitlePrefix\(displayName\)/g) ?? []).length, 2);
  assert.match(home, /displayName=\{useAccountDisplayName\(displayName\)\}/);
});

test('name reads and edits send the current shop as auth context instead of the first membership', async () => {
  const requests: RequestInit[] = [];
  const fetch = mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => { requests.push(init!); return new Response(JSON.stringify(data)); });
  try {
    await api.getDisplayNameHistory('no-package-shop');
    await api.setMyDisplayName('no-package-shop', 'ชื่อใหม่');
    assert.equal(requests.length, 2);
    for (const request of requests) assert.equal(new Headers(request.headers).get('x-company-id'), 'no-package-shop');
  } finally { fetch.mock.restore(); }
});

test('a refused name read remains a local retry state and does not repeat on render', async () => {
  const read = mock.method(api, 'getDisplayNameHistory', async () => { throw { status: 403 }; });
  const view = certificateHarness(() => h(ToastContext.Provider, { value: { success() {}, error() {}, warning() {} } }, h(AccountDisplayName, { companyId: 'co' })));
  try {
    view.render(true); await view.settle(); view.render(); view.render();
    assert.equal(read.mock.callCount(), 1);
    assert.ok(view.find('ErrorState').description);
    view.find('ErrorState').onRetry(); await view.settle();
    assert.equal(read.mock.callCount(), 2);
  } finally { view.cleanup(); read.mock.restore(); }
});
