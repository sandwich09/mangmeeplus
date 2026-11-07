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

// Owner 2026-11-06: two open boxes on every row looked broken. The row says the code once it is set; the
// boxes are in the edit dialog, for a built-in or historical category too.
test('office mapping lives in the edit dialog, the row shows only a set code, and free shops see no fields', () => {
  const categories = [{ id: 'a', companyId: 'co', name: 'หมวดทดสอบ', status: 'ACTIVE', accountantAccount: { accountCode: '5310', accountName: 'ค่ารับรอง' } },
    { id: 'old', companyId: null, name: 'หมวดเก่า', status: 'ACTIVE', referencedOnly: true }];
  const capture = mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE' }));
  const notifications = mock.method(toast, 'useToast', () => ({ success: noop, warning: noop, error: noop }));
  try {
    for (const freeExpenseDrafts of [false, true]) {
      const view = certificateHarness(() => h(CategoryManagePanel, { companyId: 'co', createOpen: false, onCreateOpenChange: noop, freeExpenseDrafts }), [[], '', categories, false, null, null, null]);
      const html = view.render();
      if (freeExpenseDrafts) { assert.doesNotMatch(html, /รหัสหมวดในไฟล์|ชื่อหมวดในไฟล์/); view.cleanup(); continue; }
      assert.equal(view.nodes.some(n => n.tag === 'input' && /ในไฟล์/.test(n.props['aria-label'] ?? '')), false);
      assert.ok(html.includes('รหัสหมวดในไฟล์ 5310 · ค่ารับรอง')); assert.ok(html.includes('หมวดเก่าที่ยังมีรายการ'));
      assert.equal(view.nodes.some(n => n.tag === 'button' && n.props.role === 'switch' && n.props['aria-label'] === 'ใช้หมวดหมู่ หมวดเก่า'), false);
      view.find('button', p => String(p.children).includes('แก้ชื่อ')).onClick(); view.render();
      assert.equal(view.find('input', p => p['aria-label'] === 'รหัสหมวดในไฟล์ หมวดทดสอบ').value, '5310');
      assert.equal(view.find('input', p => p['aria-label'] === 'ชื่อหมวดในไฟล์ หมวดทดสอบ').placeholder, 'เช่น ค่ารับรอง');
      view.cleanup();
    }
  } finally { capture.mock.restore(); notifications.mock.restore(); }
});

test('the edit dialog keeps input after a failed save, refuses half a code, and clears only when both fields are empty', async () => {
  const categories = [{ id: 'a', companyId: 'co', name: 'หมวดทดสอบ', status: 'ACTIVE' }];
  let attempts = 0; const calls: any[] = [];
  const write = mock.method(api, 'setCategoryAccountantAccount', async (...args: any[]) => { calls.push(args); if (++attempts === 1) throw new Error('unavailable'); return args[2]; });
  const clear = mock.method(api, 'clearCategoryAccountantAccount', async () => undefined);
  const capture = mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE' }));
  const notifications = mock.method(toast, 'useToast', () => ({ success: noop, warning: noop, error: noop }));
  const view = certificateHarness(() => h(CategoryManagePanel, { companyId: 'co', createOpen: false, onCreateOpenChange: noop }), [[], '', categories, false, null, null, null]);
  const field = (name: string) => view.find('input', p => p['aria-label'] === name + ' หมวดทดสอบ');
  const save = () => view.find('button', p => String(p.children).includes('บันทึก')).onClick();
  try {
    view.render(); view.find('button', p => String(p.children).includes('แก้ชื่อ')).onClick(); view.render();
    field('รหัสหมวดในไฟล์').onChange({ target: { value: '52031' } }); view.render();
    save(); await view.settle(); view.render(); assert.equal(view.find('ErrorBanner').message, 'กรอกทั้งรหัสและชื่อในไฟล์ หรือเว้นว่างทั้งสองช่อง'); assert.equal(calls.length, 0);
    field('ชื่อหมวดในไฟล์').onChange({ target: { value: 'ค่าเช่า' } }); view.render();
    save(); await view.settle(); view.render(); assert.ok(String(view.find('p', p => p.role === 'alert').children).includes('บันทึกไม่ได้ ข้อมูลยังอยู่'));
    assert.equal(field('รหัสหมวดในไฟล์').value, '52031'); assert.equal(field('ชื่อหมวดในไฟล์').value, 'ค่าเช่า');
    save(); await view.settle(); view.render();
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    view.find('button', p => String(p.children).includes('แก้ชื่อ')).onClick(); view.render();
    field('รหัสหมวดในไฟล์').onChange({ target: { value: '' } }); view.render();
    field('ชื่อหมวดในไฟล์').onChange({ target: { value: '' } }); view.render(); save(); await view.settle();
    assert.equal(clear.mock.callCount(), 1);
  } finally { view.cleanup(); write.mock.restore(); clear.mock.restore(); capture.mock.restore(); notifications.mock.restore(); }
});
