import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: {} }; };
require.extensions['.svg'] = m => { m.exports = () => null; };
const api = mutable('./expenses.api');
const policy = mutable('./expense-capture-policy');
const toast = mutable('@/common/components/toast/use-toast');
const { CategoryManagePanel } = require('./ExpensesWorkspacePanels');
const noop = () => {};

test('a late category read cannot undo a saved switch and reads after cleanup do nothing', async () => {
  const active = [{ id: 'a', companyId: 'co', name: 'หมวดทดสอบ', status: 'ACTIVE' }];
  const archived = [{ ...active[0], status: 'ARCHIVED' }];
  const pending: Array<(value: any[]) => void> = [];
  const read = mock.method(api, 'listManageCategories', () => new Promise<any[]>(resolve => { pending.push(resolve); }));
  const write = mock.method(api, 'updateExpenseCategory', async () => {});
  const capture = mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE' }));
  const notifications = mock.method(toast, 'useToast', () => ({ success: noop, warning: noop, error: noop }));
  const view = certificateHarness(() => h(CategoryManagePanel, { companyId: 'co', createOpen: false, onCreateOpenChange: noop }));
  const refs: any[] = [];
  const render = (effects = false) => {
    let index = 0;
    const ref = mock.method(require('react'), 'useRef', (value: any) => refs[index++] ?? (refs[index - 1] = { current: value }));
    try { return view.render(effects); } finally { ref.mock.restore(); }
  };
  try {
    render(true); render(true);
    pending[1]!(active); await view.settle(); render();
    view.find('button', p => p.role === 'switch').onClick(); await view.settle();
    pending[2]!(archived); await view.settle(); render();
    assert.equal(view.find('button', p => p.role === 'switch')['aria-checked'], false);
    pending[0]!(active); await view.settle(); render();
    assert.equal(view.find('button', p => p.role === 'switch')['aria-checked'], false);
    render(true); view.cleanup();
    const before = [...view.state];
    pending[3]!(active); await view.settle();
    assert.deepEqual(view.state, before);
  } finally { view.cleanup(); read.mock.restore(); write.mock.restore(); capture.mock.restore(); notifications.mock.restore(); }
});

test('category switches and tax codes follow the single writer lock while only the saving row is busy', async () => {
  const categories = ['a', 'b'].map(id => ({ id, companyId: 'co', name: `หมวด ${id}`, status: 'ACTIVE', defaultInputTaxCode: null }));
  let finish!: () => void;
  const write = mock.method(api, 'updateExpenseCategory', () => new Promise<void>(resolve => { finish = resolve; }));
  const read = mock.method(api, 'listManageCategories', async () => categories);
  const capture = mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'FULL' }));
  const notifications = mock.method(toast, 'useToast', () => ({ success: noop, warning: noop, error: noop }));
  const view = certificateHarness(() => h(CategoryManagePanel, { companyId: 'co', createOpen: false, onCreateOpenChange: noop }), [[], '', categories, false, null, null, null]);
  try {
    view.render(); view.find('button', p => p.role === 'switch' && p['aria-label'] === 'ใช้หมวดหมู่ หมวด a').onClick();
    view.render();
    for (const { props } of view.nodes.filter(node => node.tag === 'button' && node.props.role === 'switch')) {
      assert.equal(props.disabled, true);
      assert.equal(props['aria-busy'], props['aria-label'] === 'ใช้หมวดหมู่ หมวด a');
    }
    for (const { props } of view.nodes.filter(node => node.tag === 'ThemedSelect' && node.props['aria-label'])) assert.equal(props.disabled, true);
    assert.equal(write.mock.callCount(), 1);
    finish(); await view.settle(); view.render();
    assert.equal(view.find('button', p => p.role === 'switch' && p['aria-label'] === 'ใช้หมวดหมู่ หมวด b').disabled, false);
  } finally { write.mock.restore(); read.mock.restore(); capture.mock.restore(); notifications.mock.restore(); }
});

test('category load failures offer retry, keep typed input and recover the list', async () => {
  let finish!: (value: any[]) => void;
  const read = mock.method(api, 'listManageCategories', () => new Promise<any[]>(resolve => { finish = resolve; }));
  const capture = mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE' }));
  const notifications = mock.method(toast, 'useToast', () => ({ success: noop, warning: noop, error: noop }));
  const view = certificateHarness(() => h(CategoryManagePanel, { companyId: 'co', createOpen: false, onCreateOpenChange: noop }), [[], '', [], false, 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง', null, null, 'ชื่อที่ยังกรอก']);
  try {
    assert.match(view.render(), /ลองอีกครั้ง/);
    view.find('ErrorState').onRetry();
    assert.match(view.render(), /กำลังโหลด/);
    assert.equal(view.state[7], 'ชื่อที่ยังกรอก');
    assert.equal(read.mock.callCount(), 1);
    finish([{ id: 'c', companyId: 'co', name: 'หมวดที่โหลดใหม่', status: 'ACTIVE' }]);
    await view.settle();
    const html = view.render();
    assert.match(html, /หมวดที่โหลดใหม่/);
    assert.doesNotMatch(html, /เชื่อมต่อไม่ได้|โหลดไม่สำเร็จ/);
  } finally { view.cleanup(); read.mock.restore(); capture.mock.restore(); notifications.mock.restore(); }
});
