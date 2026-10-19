import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyDashboardPage } from './DashboardPages';
import { ExpenseMonthsCard } from './ExpenseMonthsCard';

(globalThis as any).React = React;
const runtime = require('react') as typeof React;
const snapshot = { id: 'snapshot', companyId: 'shop', periodKind: 'month', generatedAt: '2026-10-18T00:00:00.000Z',
  widgets: [{ key: 'expense_summary', title: 'รายจ่าย', metrics: [
    { key: 'expense_total_in_period', label: 'รายจ่าย', value: 12345.67, unit: 'บาท', freshness: 'fresh' },
    { key: 'expense_pending_review', label: 'รอตรวจ', value: 7, unit: 'ใบ', freshness: 'fresh' },
  ] }] };

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
