import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from '../expense-certificate-test-harness';
import { emptyDisbursementAccount } from './disbursement-voucher-account.logic';
const css = require.extensions['.css'], svg = require.extensions['.svg'];
require.extensions['.css'] = (m: any) => { m.exports = {}; };
require.extensions['.svg'] = (m: any) => { m.exports = () => null; };
const navigation = mutable('next/navigation');
const toast = mutable('@/common/components/toast');
const leave = mutable('@/common/components/unsaved-navigation/use-unsaved-navigation');
const modal = mutable('@/common/components/modal');
const api = mutable('./disbursement-vouchers/disbursement-vouchers.api');
const supporting = mutable('./disbursement-vouchers/DisbursementVoucherSupportingFiles');
const { DisbursementVoucherOtherExpenses } = require('./DisbursementVoucherExpensePicker');
const { useDisbursementSendKind } = require('./use-disbursement-send-kind');
const { DisbursementVoucherDraftPage } = require('./DisbursementVoucherDraftPage');
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const row = { expenseId: 'a', expenseNumber: 'EXP-1', expenseDate: '2026-10-15', branchId: 'branch', payeeKey: 'payee',
  vendorName: 'ร้าน ก', payeeKeyKind: 'NAME', vendorTaxId: null, description: 'ค่าซ่อม', outstandingAmount: '1940.00',
  grandTotalAmount: '2000.00', netPayableAmount: '1940.00', whtAmount: '60.00', selectable: true, reasonCode: null, reservation: null };
const payee = { payeeKey: 'payee', displayName: 'ร้าน ก' };
const fields = { ...emptyDisbursementAccount, payeeName: 'ร้าน ก', plannedPayDate: '', plannedMethod: '', note: '', payeeConfirmed: false };
function setup(step: number, selected = true, draftId?: string, entryOpen = true, permissions = ['expense.disbursement.prepare']) {
  const mocks = [
    mock.method(supporting, 'DisbursementVoucherSupportingFiles', () => h('div', { 'data-component': 'DisbursementVoucherSupportingFiles' })),
    mock.method(navigation, 'useRouter', () => ({ push() {}, replace() {} })),
    mock.method(toast, 'useToast', () => ({ success() {} })),
    mock.method(leave, 'useUnsavedNavigation', () => ({ dialog: null, allowNavigation() {} })),
    mock.method(modal, 'Modal', (props: any) => h('section', {}, props.title, props.children, props.footer)),
    mock.method(api, 'listDisbursementPayableExpenses', async () => [row]),
  ];
  const state: unknown[] = [];
  state[0] = draftId ? 'PV-1' : null; state[7] = step; state[8] = payee; state[9] = [row];
  state[10] = selected ? { a: '1940.00' } : {}; state[11] = fields; state[14] = false;
  const view = certificateHarness(() => h(DisbursementVoucherDraftPage, { companyId: 'shop', permissions, entryOpen, draftId }), state);
  return { ...view, close: () => mocks.reverse().forEach(m => m.mock.restore()) };
}
test('payee tap advances directly; changing a selected payee waits for confirmation and cancel keeps the items', async () => {
  const view = setup(0, false);
  try {
    let html = view.render(); assert.doesNotMatch(html, /ถัดไป|ขั้น 1 จาก 3/);
    view.find('DisbursementVoucherPayeePicker').onChoose({ payeeKey: 'new', displayName: 'ร้าน ข' });
    await view.settle(); assert.equal(view.state[7], 1);
    view.state[7] = 0; view.state[8] = payee; view.state[10] = { a: '1940.00' };
    view.render(); view.find('DisbursementVoucherPayeePicker').onChoose({ payeeKey: 'other', displayName: 'ร้าน ค' });
    html = view.render(); assert.match(html, /เปลี่ยนผู้รับเงิน รายการที่เลือกไว้จะถูกล้าง/);
    assert.deepEqual(view.state[10], { a: '1940.00' });
    view.find('button', p => p.children.includes('ไม่เปลี่ยน')).onClick();
    assert.equal(view.state[1], null); assert.deepEqual(view.state[10], { a: '1940.00' });
  } finally { view.close(); }
});
test('empty selection Next remains usable and focuses its inline error; select all selects and clears', () => {
  const view = setup(1, false);
  const oldRaf = globalThis.requestAnimationFrame, oldDocument = globalThis.document;
  let focused = '';
  (globalThis as any).requestAnimationFrame = (fn: any) => { fn(); return 0; };
  (globalThis as any).document = { getElementById(id: string) { focused = id; return null; } };
  try {
    view.state[9] = [row, { ...row, expenseId: 'b' }];
    view.render();
    const next = view.find('button', p => p.children.includes('ถัดไป'));
    assert.equal(next.disabled, false); next.onClick();
    assert.equal(focused, 'disbursement-expenses'); assert.match(view.render(), /เลือกอย่างน้อย 1 รายการ/);
    view.find('DisbursementVoucherExpenseRows').onSelectAll(true);
    assert.deepEqual(view.state[10], { a: '1940.00', b: '1940.00' });
    view.render(); view.find('DisbursementVoucherExpenseRows').onSelectAll(false);
    assert.deepEqual(view.state[10], {});
  } finally { (globalThis as any).requestAnimationFrame = oldRaf; (globalThis as any).document = oldDocument; view.close(); }
});
test('select all over the voucher limit selects the 30 oldest bills and says the rest go on another voucher', () => {
  const view = setup(1, false);
  try {
    // Listed newest first, as the picker shows them: e1 is the newest bill.
    view.state[9] = Array.from({ length: 31 }, (_, i) => ({ ...row, expenseId: `e${i + 1}`, expenseNumber: `EXP-${String(31 - i).padStart(2, '0')}` }));
    view.render(); view.find('DisbursementVoucherExpenseRows').onSelectAll(true);
    const selected = view.state[10] as Record<string, string>;
    assert.equal(Object.keys(selected).length, 30);
    assert.equal(selected.e1, undefined, 'the newest bill waits for the next voucher');
    assert.match(view.render(), /รวมได้ไม่เกิน 30 รายการ แบ่งรายการที่เหลือไปทำอีกใบ/);
    view.find('DisbursementVoucherExpenseRows').onSelectAll(false);
    assert.deepEqual(view.state[10], {});
  } finally { view.close(); }
});
test('draft save is available at every selected step and on edit; details show money and only transfer account fields', () => {
  for (const step of [0, 1, 2]) {
    const view = setup(step);
    try { view.render(); assert.equal(view.find('button', p => p.children.includes('บันทึกร่าง')).disabled, false); }
    finally { view.close(); }
  }
  const view = setup(2, true, 'draft');
  try {
    let html = view.render();
    assert.match(html, /แก้ไขใบเตรียมจ่าย PV-1/); assert.match(html, /ยอดที่จะจ่าย/); assert.match(html, /1,940.00/);
    assert.match(html, /ธนาคาร/); assert.doesNotMatch(html, /฿|ไม่บังคับ ใช้เรียงใบ/);
    for (const plannedMethod of ['CASH', 'CHEQUE']) {
      view.state[11] = { ...fields, plannedMethod }; html = view.render(); assert.doesNotMatch(html, /บัญชีผู้รับเงิน/);
    }
    view.state[10] = {}; view.render(); assert.equal(view.find('button', p => p.children.includes('บันทึกร่าง')).disabled, false);
  } finally { view.close(); }
});

test('create and edit notes start at two lines with a local minimum height override', () => {
  for (const draftId of [undefined, 'draft']) {
    const view = setup(2, true, draftId);
    try {
      const textarea = view.render().match(/<textarea[^>]*>/)![0];
      assert.match(textarea, /rows="2"/); assert.match(textarea, /!min-h-16/);
    } finally { view.close(); }
  }
});

test('other-name bills are added with confirmation, marked and removable; normal rows only uncheck', () => {
  const view = setup(1);
  const other = { ...row, expenseId: 'other', payeeKey: 'other', vendorName: 'ร้าน อีกชื่อ' };
  try {
    view.render(); view.find('button', p => p.children.includes('เพิ่มบิลที่บันทึกไว้คนละชื่อ')).onClick();
    view.render(); view.find('DisbursementVoucherOtherExpenses').onAdd([other]);
    let html = view.render(); assert.match(html, /ชื่อบนบิล: ร้าน อีกชื่อ/); assert.match(html, /เอาออก/);
    assert.equal((view.state[11] as any).payeeConfirmed, true);
    view.find('DisbursementVoucherExpenseRows').onToggle(row);
    assert.equal((view.state[9] as any[]).length, 2);
    view.render(); view.find('DisbursementVoucherExpenseRows').onRemove(other);
    assert.deepEqual((view.state[9] as any[]).map(r => r.expenseId), ['a']);
    assert.equal((view.state[10] as any).other, undefined);
    assert.equal((view.state[11] as any).payeeConfirmed, false);
  } finally { view.close(); }
});

test('other-name dialog stages checkboxes, states the confirmation by the add button, cancels unchanged and adds the selected bill', () => {
  const modalMock = mock.method(modal, 'Modal', (props: any) => h('section', {}, props.title, props.children, props.footer));
  const added: any[] = []; let closes = 0;
  const other = { ...row, expenseId: 'other', payeeKey: 'other', vendorName: 'ร้าน อีกชื่อ', vendorInvoiceNumber: 'INV-9' };
  const view = certificateHarness(() => h(DisbursementVoucherOtherExpenses, { companyId: 'shop', amounts: { a: '1940.00' }, branchId: 'branch', payeeName: 'ร้าน ก', onAdd: (rows: any[]) => added.push(rows), onClose: () => { closes++; } }), ['', [other], false, null, 0]);
  try {
    let html = view.render(); assert.match(html, /ร้าน อีกชื่อ.*1,940.00.*EXP-1.*INV-9/); assert.match(html, />เพิ่มรายการ</); assert.doesNotMatch(html, /เพิ่ม 0 รายการ/);
    view.find('DisbursementVoucherExpenseRows').onToggle(other);
    html = view.render(); assert.match(html, /เพิ่ม 1 รายการ/); assert.match(html, /บิลที่เลือกจ่ายให้ ร้าน ก รายเดียวกัน/); assert.doesNotMatch(html, /type="checkbox"[^>]*disbursement-payee-confirm/); assert.deepEqual(added, []);
    const add = () => view.find('button', p => /^เพิ่ม( \d+ |)รายการ$/.test(p.children.join(''))).onClick();
    view.find('button', p => p.children.includes('ยกเลิก')).onClick(); assert.equal(closes, 1); assert.deepEqual(added, []);
    add(); assert.deepEqual(added, [[other]]);
  } finally { modalMock.mock.restore(); }
});
test('send entry skips the chooser only for the sole eligible self approver; failed reads keep the chooser', async () => {
  for (const [canSelf, people, expected] of [
    [true, [{ userId: 'me', displayName: 'ฉัน' }], 'selfApprove'],
    [true, [{ userId: 'me', displayName: 'ฉัน' }, { userId: 'other', displayName: 'คนอื่น' }], 'submit'],
    [false, [{ userId: 'other', displayName: 'คนอื่น' }], 'submit'],
    [false, [{ userId: 'one' }, { userId: 'two' }], 'submit'],
    [true, null, 'submit'],
  ] as const) {
    const read = mock.method(api, 'listDisbursementApprovers', async () => { if (!people) throw new Error('read failed'); return people; });
    const Entry = () => h('span', {}, useDisbursementSendKind('shop', 'branch', canSelf, 'me'));
    const view = certificateHarness(() => h(Entry));
    try { view.render(true); await view.settle(); assert.match(view.render(), new RegExp(`>${expected}<`)); }
    finally { view.cleanup(); read.mock.restore(); }
  }
});

test('confirmation recovery keeps existing bills visible and fixed even when the other-name search is empty', () => {
  const modalMock = mock.method(modal, 'Modal', (props: any) => h('section', {}, props.title, props.children, props.footer));
  const view = certificateHarness(() => h(DisbursementVoucherOtherExpenses, { companyId: 'shop', amounts: { a: '1940.00' }, initialRows: [row], onAdd() {}, onClose() {} }), ['', [], false, null, 0]);
  try {
    const html = view.render(); assert.match(html, /ร้าน ก/); assert.match(html, />ยืนยัน</);
    assert.equal(view.find('DisbursementVoucherExpenseRows').disabled, true);
  } finally { modalMock.mock.restore(); }
});

test('new first step has no draft bar before both a payee and an item are selected; edit keeps draft save', () => {
  for (const draftId of [undefined, 'draft']) for (const hasPayee of [false, true]) for (const selected of [false, true]) {
    const view = setup(0, selected, draftId);
    if (!hasPayee) view.state[8] = null;
    try {
      const html = view.render(); const available = Boolean(draftId || hasPayee && selected);
      assert.equal(html.includes('data-testid="disbursement-draft-bottom-bar"'), available);
      assert.equal(view.nodes.some(node => node.tag === 'button' && node.props.children.includes('บันทึกร่าง')), available);
    } finally { view.close(); }
  }
});


test('VOUCHER-CLOSED an existing draft explains that editing is closed and links to its list', () => {
  for (const permissions of [['expense.disbursement.prepare', 'expense.disbursement.read'], ['expense.disbursement.read']]) {
    const view = setup(2, true, 'saved-draft', false, permissions);
    try {
      const html = view.render();
      assert.match(html, /ปิดการทำใบเตรียมจ่ายแล้ว ร่างนี้ทำต่อไม่ได้/);
      assert.match(html, /href="\/companies\/shop\/expenses\/disbursement-vouchers"/);
      assert.doesNotMatch(html, /หน้านี้ยังไม่ได้เปิดใช้|บันทึกร่าง|ส่งอนุมัติ/);
    } finally { view.close(); }
  }
});
