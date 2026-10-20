import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyDashboardPage } from './DashboardPages';
import { ExpenseMonthsCard } from './ExpenseMonthsCard';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { addCivilDays, todayCivilDate } from '@watchdog-bms/contracts';

(globalThis as any).React = React;
const runtime = require('react') as typeof React;
const snapshot = { id: 'snapshot', companyId: 'shop', periodKind: 'month', generatedAt: '2026-10-18T00:00:00.000Z',
  widgets: [{ key: 'expense_summary', title: 'รายจ่าย', metrics: [
    { key: 'expense_total_in_period', label: 'รายจ่าย', value: 12345.67, unit: 'บาท', freshness: 'fresh' },
    { key: 'expense_pending_review', label: 'รอตรวจ', value: 7, unit: 'ใบ', freshness: 'fresh' },
    { key: 'expense_unpaid_outstanding', label: 'ค้างจ่ายที่ยืนยันแล้ว (ทุกช่วงเวลา)', value: 6842.12, unit: 'บาท', freshness: 'fresh' },
  ] }] };

test('UAT-Q1 home names the all-month outstanding balance and includes partially paid expenses', () => {
  const original = runtime.useState;
  let index = 0;
  Reflect.set(runtime, 'useState', (initial: any) => {
    const state = (original as any)(initial), i = index++;
    return [i === 1 ? snapshot : i === 2 ? false : state[0], state[1]];
  });
  try {
    const html = renderToStaticMarkup(React.createElement(CompanyDashboardPage, { companyId: 'shop', permissions: ['expense.read'], displayName: 'สมชาย' }));
    assert.match(html, />ค้างจ่ายทั้งหมด</);
    assert.match(html, /รายจ่ายยืนยันแล้วทุกเดือน รวมที่จ่ายบางส่วน/);
    assert.match(html, />6,842\.12</);
    assert.doesNotMatch(html, /฿|ยืนยันแล้ว ยังไม่ได้จ่าย/);
  } finally { Reflect.set(runtime, 'useState', original); }
});

for (const loading of [false, true]) test(`FIX-Q2 home period change hides stale totals before and during the request: ${loading}`, () => {
  const original = runtime.useState;
  let index = 0;
  Reflect.set(runtime, 'useState', (initial: any) => {
    const state = (original as any)(initial), i = index++;
    return [i === 0 ? 'week' : i === 1 ? snapshot : i === 2 ? loading : state[0], state[1]];
  });
  try {
    const html = renderToStaticMarkup(React.createElement(CompanyDashboardPage, { companyId: 'shop', permissions: ['expense.read'], displayName: 'สมชาย' }));
    assert.match(html, /aria-pressed="true"[^>]*>สัปดาห์นี้/);
    assert.doesNotMatch(html, /12,345\.67/);
    assert.match(html, /กำลังโหลดรายจ่าย/);
  } finally { Reflect.set(runtime, 'useState', original); }
});

for (const data of [null, { year: 2025, months: [], years: [2025, 2026] }]) test(`FIX-Q2 monthly chart shows loading instead of zero amounts for ${data ? 'a changed year' : 'the first read'}`, () => {
  const original = runtime.useState;
  let index = 0;
  Reflect.set(runtime, 'useState', (initial: any) => {
    const state = (original as any)(initial), i = index++;
    return [i === 0 ? 2026 : i === 1 ? data : state[0], state[1]];
  });
  try {
    const html = renderToStaticMarkup(React.createElement(ExpenseMonthsCard, { companyId: 'shop' }));
    assert.match(html, /กำลังโหลดรายจ่ายรายเดือน/);
    assert.doesNotMatch(html, /role="img"|รวม 0\.00 บาท/);
  } finally { Reflect.set(runtime, 'useState', original); }
});

test('HOME-RANGE opens dates, refreshes automatically with custom bounds, hides stale totals and refuses invalid ranges', async () => {
  const originals = { useState: runtime.useState, useRef: runtime.useRef, useEffect: runtime.useEffect, createElement: runtime.createElement, fetch: globalThis.fetch };
  const range = { customStart: '2026-09-01', customEnd: '2026-09-30' };
  const state: any[] = ['month', snapshot, false, false, null, 0, range];
  const dates = new Map<string, (event: { target: { value: string } }) => void>();
  let cursor = 0, refCursor = 0, select: (() => void) | undefined, week: (() => void) | undefined, load: (() => void) | undefined, crmPeriod = '';
  const refs: any[] = [];
  const requests: URL[] = [];
  Reflect.set(runtime, 'useState', (initial: any) => {
    const original = originals.useState(initial), index = cursor++;
    return index < state.length ? [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }] : original;
  });
  Reflect.set(runtime, 'useRef', (initial: any) => {
    const original = originals.useRef(initial), index = refCursor++;
    return index < 3 ? refs[index] ?? (refs[index] = original) : original;
  });
  Reflect.set(runtime, 'useEffect', (effect: () => void, deps?: any[]) => { if (deps?.length === 2 && ['month', 'custom'].includes(deps[1])) load = effect; });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === ThemedDate) dates.set(props['aria-label'], props.onChange);
    if (type === 'button' && children[0] === 'เลือกวันที่') select = props.onClick;
    if (type === 'button' && children[0] === 'สัปดาห์นี้') week = props.onClick;
    if (typeof type === 'function' && type.name === 'CrmDailyBriefCard') crmPeriod = props.periodKind;
    return (originals.createElement as any)(type, props, ...children);
  });
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://local'); requests.push(url);
    const start = url.searchParams.get('customStart')!, end = url.searchParams.get('customEnd')!;
    return Response.json({ ...snapshot, periodKind: 'custom', periodStart: `${addCivilDays(start, -1)}T17:00:00.000Z`, periodEnd: `${end}T16:59:59.999Z` });
  };
  const render = () => {
    cursor = 0; refCursor = 0; dates.clear();
    return renderToStaticMarkup(React.createElement(CompanyDashboardPage, { companyId: 'shop', permissions: ['expense.read', 'crm.inbox.read'], displayName: 'สมชาย' }));
  };
  const flush = async () => { load!(); await new Promise(resolve => setImmediate(resolve)); };
  try {
    assert.doesNotMatch(render(), /aria-label="ตั้งแต่"/);
    assert.ok(week); week(); render();
    assert.ok(select); select();
    let html = render();
    assert.equal(crmPeriod, 'week', 'CRM keeps the last preset instead of receiving custom without bounds');
    assert.match(html, /role="combobox"[^>]*aria-label="ตั้งแต่"/);
    assert.match(html, /role="combobox"[^>]*aria-label="ถึง"/);
    await flush();
    html = render();
    assert.match(html.replace(/<[^>]*>/g, ''), /รายจ่าย 1 ก\.ย\. – 30 ก\.ย\. 2569/);
    assert.match(html, />12,345\.67</); assert.match(html, />6,842\.12</); assert.match(html, /ใบเสร็จรอตรวจ/);
    assert.equal(requests[0]!.searchParams.get('periodKind'), 'custom');
    assert.equal(requests[0]!.searchParams.get('customStart'), range.customStart);
    assert.equal(requests[0]!.searchParams.get('customEnd'), range.customEnd);
    dates.get('ตั้งแต่')!({ target: { value: '2026-09-02' } });
    html = render();
    assert.doesNotMatch(html, />12,345\.67</, 'the old range cannot appear under the new label');
    assert.match(html, />6,842\.12</, 'the all-time unpaid balance stays visible while the range loads');
    await flush(); render();
    assert.equal(requests.at(-1)!.searchParams.get('customStart'), '2026-09-02');
    dates.get('ถึง')!({ target: { value: '2026-09-15' } }); render(); await flush(); render();
    assert.equal(requests.at(-1)!.searchParams.get('customEnd'), '2026-09-15');
    const count = requests.length;
    dates.get('ถึง')!({ target: { value: '2026-08-31' } }); html = render(); await flush();
    assert.match(html, /ถึงต้องไม่ก่อนตั้งแต่/); assert.doesNotMatch(html, />12,345\.67</);
    assert.equal(requests.length, count);
    dates.get('ถึง')!({ target: { value: addCivilDays(todayCivilDate(), 1) } }); html = render(); await flush();
    assert.match(html, /ถึงต้องไม่เกินวันนี้/); assert.equal(requests.length, count);
    assert.match(html, /id="home-customEnd"[^>]*aria-describedby="home-customEnd-error"[^>]*aria-invalid="true"/);
    // CoreText + bundled Plex Thai 400 at 14px: longest label 53.872px + 16px padding.
    // Owner 2026-10-20 dropped ไตรมาสนี้: four tabs, one row. Page + card gutters are 64px at 375px.
    assert.ok(53.872 + 16 < (375 - 64 - 24) / 4);
    assert.match(html, /grid grid-cols-4 gap-2 sm:gap-2\.5/);
    assert.doesNotMatch(html, />ไตรมาสนี้</);
    assert.equal((html.match(/class="mangmee-home-tab !min-h-11 min-w-0 sm:!min-h-10"/g) ?? []).length, 4);
    // Widest date at 16px is 94.02525px; icon/gap/padding/3px border need another 55px.
    assert.ok((375 - 66 - 12) / 2 < 94.02525 + 55);
    assert.ok((390 - 66 - 12) / 2 > 94.02525 + 55);
    assert.match(html, /grid grid-cols-1 gap-3 min-\[390px\]:grid-cols-2/);
  } finally {
    Reflect.set(runtime, 'useState', originals.useState); Reflect.set(runtime, 'useRef', originals.useRef); Reflect.set(runtime, 'useEffect', originals.useEffect);
    Reflect.set(runtime, 'createElement', originals.createElement); globalThis.fetch = originals.fetch;
  }
});
