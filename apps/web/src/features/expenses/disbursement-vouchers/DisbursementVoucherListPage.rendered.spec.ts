import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

(globalThis as any).React = React;
require.extensions['.svg'] = m => { m.exports = () => null; };
require.extensions['.css'] = m => { m.exports = { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) }; };
const apiPath = require.resolve('./disbursement-vouchers.api');
const api = { ...require(apiPath) }; require.cache[apiPath]!.exports = api;
const dialogPath = require.resolve('./DisbursementVoucherCommandDialog');
require(dialogPath);
require.cache[dialogPath]!.exports = { DisbursementVoucherCommandDialog: function DisbursementVoucherCommandDialog() { return null; } };
const { DisbursementVoucherListPage } = require('./DisbursementVoucherListPage');
const counts = { DRAFT: 1, PENDING_APPROVAL: 2, APPROVED: 3, PAID: 0, CANCELLED: 0 };
const row = { id: 'draft', documentNumber: null, status: 'DRAFT', origin: 'PREPARED', payeeName: 'ร้านทดสอบ', plannedPayDate: null, paidDate: null,
  createdAt: '2026-10-14T18:00:00Z', totalAmount: '1250.50', lineCount: 1, preparerName: 'สมใจ', primaryAction: 'submit', canDelete: true };
const result = { data: [row], counts, sums: { DRAFT: '1250.50', PENDING_APPROVAL: '2300.25', APPROVED: '4500.75', PAID: '0.00', CANCELLED: '0.00' }, total: 1, page: 1, pageSize: 10 };
function harness(initial: Record<string, any> = {}, permissions = ['expense.disbursement.read', 'expense.disbursement.prepare'], query = '', entryOpen = true) {
  const runtime = require('react');
  const names = [...readFileSync(new URL('./DisbursementVoucherListPage.tsx', import.meta.url), 'utf8').matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(m => m[1]);
  const state: any = { result, loading: false, ...initial }; const nodes: any[] = []; const routes: string[] = []; const effects: any[] = [];
  function render() {
    let i = 0; nodes.length = 0; effects.length = 0;
    const realState = runtime.useState, realCreate = runtime.createElement, realEffect = runtime.useEffect;
    runtime.useEffect = (effect: any) => { effects.push(effect); };
    runtime.useState = (init: any) => { const pair = realState(init), name = names[i++]; if (!name) return pair;
      if (!(name in state)) state[name] = pair[0]; return [state[name], (next: any) => { state[name] = typeof next === 'function' ? next(state[name]) : next; }]; };
    runtime.createElement = (tag: any, props: any, ...children: any[]) => { nodes.push({ tag: typeof tag === 'string' ? tag : tag?.name, props: { ...props, children } }); return realCreate(tag, props, ...children); };
    try { return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { push: (url: string) => routes.push(url), replace() {}, prefetch() {} } as any },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, React.createElement(DisbursementVoucherListPage, { companyId: 'shop', permissions, entryOpen })))); }
    finally { runtime.useState = realState; runtime.createElement = realCreate; runtime.useEffect = realEffect; }
  }
  return { render, state, nodes, routes, effects, setQuery: (value: string) => { query = value; } };
}

test('VOUCH-LIST renders flat metrics, six counted status buttons and ten-row paging without a range sentence', () => {
  const page = harness(); const html = page.render();
  assert.match(html, /mangmee-flat/);
  const grid = page.nodes.find(n => n.tag === 'MetricGrid');
  assert.equal(grid.props.columns, 2);
  assert.deepEqual(grid.props.items.map((item: any) => [item.label, item.value, item.unit, item.note]), [['รออนุมัติ', '2,300.25', 'บาท', '2 ใบ'], ['รอจ่าย', '4,500.75', 'บาท', '3 ใบ']]);
  assert.equal(page.nodes.filter(n => n.tag === 'button' && n.props['aria-pressed'] !== undefined).length, 6);
  assert.match(html, /role="group" aria-label="สถานะใบเตรียมจ่าย"/);
  assert.match(html, /grid-cols-2/); assert.match(html, /mangmee-home-tab/);
  assert.doesNotMatch(html, /แสดง 1-|อนุมัติแล้ว รอจ่าย/);
  const constants = require('./disbursement-vouchers.constants'); assert.equal(constants.DISBURSEMENT_VOUCHER_PAGE_SIZE, 10);
});

test('VOUCH-LIST rows show payee then number, short date and amount without a currency prefix', () => {
  const page = harness(); const html = page.render();
  const wide = html.split('data-testid="disbursement-voucher-table"')[1]!;
  assert.match(wide, /ผู้รับเงิน[\s\S]*วันที่[\s\S]*ยอดเงิน[\s\S]*สถานะ/);
  assert.match(wide, /ร้านทดสอบ[\s\S]*ยังไม่มีเลขที่[\s\S]*15 ต.ค. 2569[\s\S]*1,250.50/);
  assert.doesNotMatch(html, /จัดทำโดย|สมใจ/);
  assert.doesNotMatch(wide, /฿|1 รายการ|numberLink/);
  assert.match(wide, /grid-cols-\[minmax\(180px,1.6fr\)_minmax\(150px,1fr\)_minmax\(100px,0.7fr\)_minmax\(140px,1fr\)_44px\]/);
  assert.match(html, /ลบร่างใบเตรียมจ่ายนี้/);
  const readOnly = harness({ result: { ...result, data: [{ ...row, canDelete: false, lineCount: 2 }] } }).render();
  assert.doesNotMatch(readOnly, /ลบร่างใบเตรียมจ่ายนี้/); assert.match(readOnly, /2 รายการ/);
});

test('VOUCH-LIST approved row retains the payment deep link and never offers cancellation', () => {
  const page = harness({ result: { ...result, data: [{ ...row, status: 'APPROVED', primaryAction: 'pay', canDelete: false }] } });
  const html = page.render();
  assert.match(html, /#disbursement-voucher-pay/); assert.doesNotMatch(html, /ยกเลิกใบนี้/);
  const link = page.nodes.find(n => n.props.role === 'link');
  assert.ok(link); link.props.onKeyDown({ key: 'Enter', target: 'row', currentTarget: 'row', preventDefault() {} });
  assert.equal(page.routes[0], '/companies/shop/expenses/disbursement-vouchers/draft#disbursement-voucher-pay');
});

test('VOUCH-LIST delete loads current capabilities and reuses the document delete dialog', async () => {
  const detail = { header: { id: 'draft' }, actions: { delete: true } };
  const get = mock.method(api, 'getDisbursementVoucher', async (company: string, id: string) => { assert.equal(company, 'shop'); assert.equal(id, 'draft'); return detail; });
  try {
    const page = harness(); page.render();
    const trash = page.nodes.find(n => n.tag === 'IconBtn');
    let stopped = false; trash.props.onClick({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true); assert.deepEqual(page.routes, []);
    await Promise.resolve();
    const card = page.nodes.find(n => n.tag === 'DisbursementVoucherCard');
    await card.props.onDelete(); page.render();
    const dialog = page.nodes.find(n => n.tag === 'DisbursementVoucherCommandDialog');
    assert.equal(dialog.props.kind, 'delete'); assert.equal(dialog.props.detail, detail);
    dialog.props.onDeleted(); assert.equal(page.state.deleteDetail, null); assert.equal(page.state.retry, 1);
  } finally { get.mock.restore(); }
});

test('JFIX-2Q a response without sums keeps the create link and rows mounted and never invents totals', () => {
  for (const data of [[], [{ ...row, createdAt: undefined, canDelete: undefined }]]) {
    const page = harness({ result: { ...result, sums: undefined, data } });
    const html = page.render();
    assert.equal((html.match(/>สร้างใบเตรียมจ่าย<\/a>/g) ?? []).length, 1);
    assert.deepEqual(page.nodes.find(n => n.tag === 'MetricGrid').props.items.map((item: any) => item.value), ['—', '—']);
    if (data.length) { assert.match(html, /ร้านทดสอบ/); assert.doesNotMatch(html, /ลบร่างใบเตรียมจ่ายนี้/); }
  }
});

test('JFIX-2Q card and keyboard row links name the payee and document number', () => {
  const page = harness({ result: { ...result, data: [{ ...row, documentNumber: 'PV-202610-00001' }] } });
  const html = page.render();
  assert.equal((html.match(/aria-label="เปิด ร้านทดสอบ · PV-202610-00001"/g) ?? []).length, 2);
  const link = page.nodes.find(n => n.props.role === 'link');
  assert.equal(link.props.tabIndex, 0);
  link.props.onKeyDown({ key: 'Enter', target: 'row', currentTarget: 'row', preventDefault() {} });
  assert.equal(page.routes[0], '/companies/shop/expenses/disbursement-vouchers/draft');
});


test('VOUCH-LIST2 date sort is reachable on phone and wide, preserves filters, resets page and reaches the read', async () => {
  const calls: any[] = [];
  const read = mock.method(api, 'listDisbursementVouchers', async (_company: string, query: any) => { calls.push(query); return result; });
  try {
    const screen = harness({}, undefined, 'status=APPROVED&q=PV&page=3');
    let html = screen.render();
    assert.match(html, /เรียง: ใหม่ไปเก่า ↓/);
    screen.nodes.find(n => n.props['aria-label'] === 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่').props.onClick();
    const url = new URL(screen.routes[0], 'https://local');
    assert.equal(url.searchParams.get('order'), 'oldest'); assert.equal(url.searchParams.get('page'), null);
    assert.equal(url.searchParams.get('status'), 'APPROVED'); assert.equal(url.searchParams.get('q'), 'PV');
    screen.setQuery(url.search); html = screen.render();
    assert.match(html, /วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า/); assert.match(html, /เรียง: เก่าไปใหม่ ↑/);
    const cleanup = screen.effects[2](); await Promise.resolve(); cleanup?.();
    assert.deepEqual(calls, [{ status: 'APPROVED', q: 'PV', page: 1, pageSize: 10, order: 'oldest' }]);
    screen.nodes.find(n => n.props['aria-label'] === 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า').props.onClick();
    assert.equal(new URL(screen.routes[1], 'https://local').searchParams.get('order'), null);
  } finally { read.mock.restore(); }
});


test('VOUCHER-CLOSED reads existing vouchers, keeps document links and hides create and delete on phone and wide', async () => {
  const calls: unknown[] = [];
  const read = mock.method(api, 'listDisbursementVouchers', async (_company: string, query: unknown) => { calls.push(query); return result; });
  try {
    const page = harness({}, undefined, '', false);
    const html = page.render();
    assert.match(html, /ปิดการทำใบเตรียมจ่ายใหม่แล้ว ดูใบเดิมได้/);
    assert.match(html, /ร้านทดสอบ/);
    assert.doesNotMatch(html, /สร้างใบเตรียมจ่าย|ลบร่างใบเตรียมจ่ายนี้|หน้านี้ยังไม่ได้เปิดใช้/);
    assert.equal(page.nodes.some(n => n.tag === 'IconBtn'), false);
    assert.equal(page.nodes.find(n => n.tag === 'DisbursementVoucherCard').props.row.canDelete, false);
    assert.match(html, /href="\/companies\/shop\/expenses\/disbursement-vouchers\/draft"/);
    const cleanup = page.effects[2](); await new Promise(resolve => setImmediate(resolve)); cleanup?.();
    assert.equal(calls.length, 1, 'entry closure does not suppress the read');
  } finally { read.mock.restore(); }
});

test('VOUCHER-CLOSED shows the existing closed empty state only after all counts are zero', () => {
  const empty = { ...result, data: [], total: 0, counts: Object.fromEntries(Object.keys(counts).map(key => [key, 0])) };
  const html = harness({ result: empty }, undefined, '', false).render();
  assert.match(html, /หน้านี้ยังไม่ได้เปิดใช้สำหรับร้านของคุณ/);
  assert.match(html, /href="\/companies\/shop\/expenses"/);
  assert.doesNotMatch(html, /ปิดการทำใบเตรียมจ่ายใหม่แล้ว|สร้างใบเตรียมจ่าย/);
  const open = harness().render();
  assert.match(open, /สร้างใบเตรียมจ่าย|ลบร่างใบเตรียมจ่ายนี้/);
  assert.doesNotMatch(open, /ปิดการทำใบเตรียมจ่ายใหม่แล้ว/);
});

test('VOUCHER-CLOSED a search with zero matches still shows the existing-record list and clear-search action', async () => {
  const read = mock.method(api, 'listDisbursementVouchers', async (_company: string, query: any) => query.q
    ? { ...result, data: [], total: 0, counts: Object.fromEntries(Object.keys(counts).map(key => [key, 0])) } : result);
  try {
    const page = harness({}, undefined, 'q=missing', false);
    page.render(); page.effects[2](); await new Promise(resolve => setImmediate(resolve));
    const html = page.render();
    assert.match(html, /ไม่พบใบตามคำค้นนี้/);
    assert.doesNotMatch(html, /หน้านี้ยังไม่ได้เปิดใช้สำหรับร้านของคุณ/);
  } finally { read.mock.restore(); }
});
