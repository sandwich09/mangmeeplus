import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }; };
require.extensions['.svg'] = (module: any) => { module.exports = () => null; };
const parties = mutable('../counterparties/counterparties.api');
const api = mutable('./expenses.api');
const policy = mutable('./expense-capture-policy');
const modal = mutable('@/common/components/modal/Modal');
const { ExpensePayeeField } = require('./ExpensePayeeField');
const { ManualExpensePanel } = require('./ExpensesPages');
const { ExpenseReviewRequestDialog } = require('./ExpenseReviewRequestDialog');
const noop = () => {};

test('manual payee suggestions reuse counterparty search only with its read right and selecting one links the draft', async () => {
  const oldWindow = (globalThis as any).window;
  (globalThis as any).window = { setTimeout: (fn: any) => { fn(); return 1; }, clearTimeout: noop };
  let searched = 0; let chosen: any;
  const list = mock.method(parties, 'listCounterparties', async (_company: string, query: any) => { searched++; assert.deepEqual(query, { page: 1, search: 'ร้าน' }); return { data: [{ id: 'shop', displayName: 'ร้านกาแฟ', taxId: null }] }; });
  try {
    for (const canRead of [false, true]) {
      const view = certificateHarness(() => h(ExpensePayeeField, { companyId: 'co', value: { name: 'ร้าน' }, canRead, disabled: false, onChange: (value: any) => { chosen = value; } }));
      view.render(true); await view.settle(); view.find('input').onFocus(); view.render();
      assert.equal(searched, canRead ? 1 : 0);
      if (canRead) { view.find('button', p => p.role === 'option').onClick(); assert.deepEqual(chosen, { name: 'ร้านกาแฟ', id: 'shop' }); }
      view.find('input').onChange({ target: { value: 'ชื่อใหม่' } }); assert.deepEqual(chosen, { name: 'ชื่อใหม่' }, 'typing detaches the selected registry id');
      view.cleanup();
    }
  } finally { list.mock.restore(); (globalThis as any).window = oldWindow; }
});
test('seller suggestions show eight left-aligned choices, keyboard movement and Escape dismissal', async () => {
  const oldWindow = (globalThis as any).window;
  (globalThis as any).window = { setTimeout: (fn: any) => { fn(); return 1; }, clearTimeout: noop };
  const list = mock.method(parties, 'listCounterparties', async () => ({ data: Array.from({ length: 19 }, (_, i) => ({ id: String(i), displayName: `ร้าน ${i}` })) }));
  const view = certificateHarness(() => h(ExpensePayeeField, { companyId: 'co', value: { name: 'ร้าน' }, canRead: true, disabled: false, onChange: noop }));
  try {
    view.render(true); await view.settle(); view.find('input').onFocus();
    const html = view.render(); assert.equal((html.match(/role="option"/g) ?? []).length, 8);
    assert.match(html, /ชื่อผู้ขาย/); assert.match(html, /ร้านหรือคนที่รับเงิน/); assert.match(html, /text-left/);
    let focused = -1;
    const options = Array.from({ length: 8 }, (_, i) => ({ focus: () => { focused = i; } }));
    const key = view.find('div', p => p.role === 'listbox').onKeyDown;
    key({ key: 'ArrowDown', preventDefault: noop, target: options[0], currentTarget: { querySelectorAll: () => options } }); assert.equal(focused, 1);
    key({ key: 'ArrowUp', preventDefault: noop, target: options[0], currentTarget: { querySelectorAll: () => options } }); assert.equal(focused, 7);
    key({ key: 'Escape', preventDefault: noop }); assert.doesNotMatch(view.render(), /role="option"/);
  } finally { view.cleanup(); list.mock.restore(); (globalThis as any).window = oldWindow; }
});
test('manual create sends an optional typed seller or the selected counterparty without creating registry rows', async () => {
  const capture = mock.method(policy, 'useExpenseCapturePolicy', () => ({ mode: 'SIMPLE' }));
  const bodies: any[] = []; const created = mock.method(api, 'createExpenseDraft', async (_company: string, body: any) => { bodies.push(body); return { id: 'saved' }; });
  try {
    for (const payee of [{ name: '' }, { name: '  ชื่อใหม่  ' }, { name: 'ร้านเดิม', id: 'shop' }]) {
      const view = certificateHarness(() => h(ManualExpensePanel, { companyId: 'co', branchId: 'b1', canAttachReceipt: false, entryClosed: false, permissions: [], onSuccess: noop }), [payee, '2026-10-13', [{ description: 'กาแฟ', quantity: '1', unitPrice: '120', discountAmount: '0' }]]);
      view.render(); await view.find('form').onSubmit({ preventDefault: noop });
      const body = bodies.at(-1); assert.equal(body.vendorNameSnapshot, payee.name.trim() || undefined); assert.equal(body.vendorCounterpartyId, 'id' in payee ? payee.id : undefined);
    }
    assert.equal(bodies.length, 3);
  } finally { capture.mock.restore(); created.mock.restore(); }
});
test('review request with one candidate shows the name and one send button; many candidates get searchable choices', () => {
  const transport = mock.method(modal, 'Modal', (props: any) => h('section', null, props.children, props.footer));
  try {
    const sole = certificateHarness(() => h(ExpenseReviewRequestDialog, { open: true, people: [{ userId: 'checker', displayName: 'ผู้ตรวจ' }], selected: 'checker', busy: false, error: null, onChoose: noop, onSend: async () => {}, onClose: noop, onRetry: noop }));
    const html = sole.render(); assert.match(html, /ผู้ตรวจ/); assert.equal(sole.nodes.filter((node: any) => node.tag === 'button').length, 1); assert.match(html, /ส่งให้ตรวจ/);
    const many = certificateHarness(() => h(ExpenseReviewRequestDialog, { open: true, people: Array.from({ length: 7 }, (_, i) => ({ userId: String(i), displayName: `ผู้ตรวจ ${i}` })), selected: '6', busy: false, error: null, onChoose: noop, onSend: async () => {}, onClose: noop, onRetry: noop }));
    assert.match(many.render(), /ค้นชื่อ/); many.find('input', p => p.type === 'search').onChange({ target: { value: 'ไม่มี' } }); assert.match(many.render(), /ผู้ตรวจ 6/);
  } finally { transport.mock.restore(); }
});
