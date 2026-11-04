import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const css = readFileSync(new URL('../../../../app/globals.css', import.meta.url), 'utf8');
const h = React.createElement;

test('the page frame is unchanged unless a page asks for the reading width or a back link', async () => {
  const { MangmeePage } = await import('./MangmeePage');
  const plain = renderToStaticMarkup(h(MangmeePage, { title: 'รายการค่าใช้จ่าย', eyebrow: 'การเงินและบัญชี', children: 'เนื้อหา' }));
  assert.equal(plain, '<div class="mangmee-page"><div class="mangmee-page-header"><div class="min-w-0"><div data-breadcrumb="true" class="mangmee-eyebrow">การเงินและบัญชี</div><h1 class="mangmee-page-title">รายการค่าใช้จ่าย</h1></div></div>เนื้อหา</div>');
});

test('every page fills the content area; back puts the way back above the title, with or without an eyebrow', async () => {
  const { MangmeePage } = await import('./MangmeePage');
  const back = h('a', { href: '/settings' }, 'กลับไปตั้งค่า');
  const html = renderToStaticMarkup(h(MangmeePage, { title: 'ข้อมูลร้าน', back, children: 'ฟอร์ม' }));
  assert.match(html, /^<div class="mangmee-page">/);
  assert.match(html, /<div class="min-w-0"><div class="mangmee-page-back"><a href="\/settings">กลับไปตั้งค่า<\/a><\/div><h1 class="mangmee-page-title">ข้อมูลร้าน<\/h1>/);
  assert.doesNotMatch(html, /mangmee-eyebrow/);
  // Owner 2026-10-13 ("ทำไมไม่ทำเต็มจอ"): the frame has no narrow or centred variant, in the markup or in the CSS.
  assert.doesNotMatch(html, /data-width/);
  assert.doesNotMatch(css, /\.mangmee-page\[data-width|\.mangmee-page \{[^}]*max-width/);
  assert.doesNotMatch(readFileSync(new URL('./MangmeePage.tsx', import.meta.url), 'utf8'), /\bwidth\??:/);
});

test('LIST-1 two metrics share a row from 640px and keep their notes on phones', async () => {
  const { MetricGrid } = await import('./MetricGrid');
  const items = [{ key: 'total', label: 'ยอดค่าใช้จ่ายตามวันที่เอกสาร', value: '100.00', note: '2 รายการ รวมร่าง', dot: 'bg-brand-500' },
    { key: 'outstanding', label: 'ค้างจ่ายที่ยืนยันแล้ว', value: '50.00', note: 'เกินกำหนด ฿50.00 · 1 ใบ', dot: 'bg-gray-400' }];
  const html = renderToStaticMarkup(h(MetricGrid, { items, columns: 2 }));
  assert.match(html, /sm:grid-cols-2/); assert.doesNotMatch(html, /sm:grid-cols-3|hidden sm:block/);
  for (const item of items) { assert.ok(html.includes(item.label)); assert.ok(html.includes(item.note)); }
});

test('phone page titles wrap unbroken names in both shared headers', () => {
  assert.match(css, /\.mangmee-page-title\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  for (const path of ['./MangmeePage.tsx', '../page/PageHeader.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /<h1 className="mangmee-page-title">\{title\}<\/h1>/);
  }
  const voucherCss = readFileSync(new URL('../../../features/expenses/disbursement-vouchers/disbursement-vouchers.module.css', import.meta.url), 'utf8');
  assert.doesNotMatch(voucherCss, /:global\(\.mangmee-page-title\)/);
});
