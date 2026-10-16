import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext, PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';

(globalThis as any).React = React;
const previousSvgLoader = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const { IndividualPermissionsPrototypePage } = require('./IndividualPermissionsPrototypePage');
if (previousSvgLoader) require.extensions['.svg'] = previousSvgLoader;
else delete require.extensions['.svg'];
const runtime = require('react') as typeof React;

async function withCard(permissions: string[], run: (render: () => string, open: () => Promise<void>, calls: string[]) => Promise<void>, accountDisplayName?: string) {
  const originalState = runtime.useState;
  const originalCreate = runtime.createElement;
  const originalFetch = globalThis.fetch;
  const states: unknown[] = [];
  let cursor = 0;
  let injectedEmployees = false;
  let toggle: ((event: unknown) => Promise<void>) | undefined;
  const calls: string[] = [];
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const index = cursor++;
    const [value] = (originalState as any)(initial);
    if (!(index in states)) {
      states[index] = value;
      if (Array.isArray(initial) && !injectedEmployees) {
        injectedEmployees = true;
        states[index] = [{ id: 'profile', userId: 'member', displayName: 'มีนา ใจดี', accountDisplayName, nickname: 'STAFF', roles: [], status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES', branchScopeBranchIds: [] }];
      }
      if (initial === true) states[index] = false;
    }
    return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'details' && props?.onToggle) toggle = props.onToggle;
    return (originalCreate as any)(type, props, ...children);
  });
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ displayName: 'มีนา ใจดี', history: [
      { id: 'latest', changedAt: '2026-10-13T02:00:00Z', oldName: 'มีนา', newName: 'มีนา ใจดี', changedByName: 'เจ้าของร้าน' },
      { id: 'earlier', changedAt: '2026-10-12T02:00:00Z', oldName: 'ชื่อเก่า', newName: 'มีนา', changedByName: 'มีนา' },
    ] }), { status: 200 });
  };
  const noop = () => undefined;
  const render = () => {
    cursor = 0;
    return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { push: noop, replace: noop, prefetch: noop } as any },
      React.createElement(PathnameContext.Provider, { value: '/companies/shop/settings/access-overview' },
        React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams('person=profile') },
          React.createElement(ToastContext.Provider, { value: { success: noop, warning: noop, error: noop } },
            React.createElement(IndividualPermissionsPrototypePage, { companyId: 'shop', viewerPermissions: permissions }))))));
  };
  try { await run(render, async () => { assert.ok(toggle, 'the mounted card has a lazy history disclosure'); await toggle({ currentTarget: { open: true } }); }, calls); }
  finally { Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'createElement', originalCreate); globalThis.fetch = originalFetch; }
}

test('mounted employee card lazily requests scoped name history and shows dates, changes and actors newest first', async () => {
  await withCard(['access.employee.read', 'access.employee.update'], async (render, open, calls) => {
    const closed = render();
    assert.equal((closed.match(/ประวัติการแก้ชื่อ/g) ?? []).length, 1);
    assert.equal(calls.length, 0);
    assert.match(closed, /มีนา ใจดี/);
    assert.doesNotMatch(closed, />STAFF</);
    await open();
    const html = render();
    assert.match(calls[0], /\/v1\/auth\/account\/display-name\?companyId=shop&userId=member$/);
    assert.equal(calls.length, 1);
    assert.match(html, /มีนา → มีนา ใจดี/);
    assert.match(html, /แก้โดย เจ้าของร้าน/);
    assert.match(html, /dateTime="2026-10-13T02:00:00Z"/);
    assert.ok(html.indexOf('มีนา → มีนา ใจดี') < html.indexOf('ชื่อเก่า → มีนา'));
    await open(); assert.equal(calls.length, 1);
  });
});

test('a reader without employee update sees no history disclosure and makes no history request', async () => {
  await withCard(['access.employee.read'], async (render, _open, calls) => {
    assert.doesNotMatch(render(), /ประวัติการแก้ชื่อ/);
    assert.equal(calls.length, 0);
  });
});


test('an empty history says so only after opening and reading the mounted disclosure', async () => {
  await withCard(['access.employee.update'], async (render, open) => {
    globalThis.fetch = async () => new Response(JSON.stringify({ displayName: 'มีนา', history: [] }), { status: 200 });
    assert.doesNotMatch(render(), /ยังไม่มีการแก้ชื่อ/);
    await open();
    assert.match(render(), /ยังไม่มีการแก้ชื่อ/);
  });
});


test('employee list, detail and permission heading show the live account name only when it differs from the shop name', async () => {
  for (const accountName of ['ชื่อใหม่ของมีนา', 'มีนา ใจดี', undefined]) {
    await withCard(['access.employee.read'], async render => {
      const html = render();
      assert.match(html, /สิทธิ์ของ มีนา ใจดี/);
      assert.equal((html.match(/ชื่อที่แสดง: /g) ?? []).length, accountName === 'ชื่อใหม่ของมีนา' ? 3 : 0);
      if (accountName === 'ชื่อใหม่ของมีนา') assert.equal((html.match(/ชื่อที่แสดง: ชื่อใหม่ของมีนา/g) ?? []).length, 3);
    }, accountName);
  }
});
