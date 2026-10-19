import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { roleDisplayName, roleKeyDisplayName } from '@/features/employee-access/role-picker.logic';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isActiveNavSubItem, isPointerArrival, lineLinkMenuRow, revealScrollDelta, type SidebarSubItemRef } from './app-sidebar.logic';

const shellDir = dirname(fileURLToPath(import.meta.url));

describe('isActiveNavSubItem', () => {
  it('uses the longest matching sibling href', () => {
    const subItems: SidebarSubItemRef[] = [
      { key: 'expenses.list', href: '/companies/co/expenses' },
      { key: 'expenses.upload', href: '/companies/co/expenses/upload' },
    ];

    assert.equal(isActiveNavSubItem('/companies/co/expenses/upload', undefined, subItems[0], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/expenses/upload', undefined, subItems[1], subItems), true);
  });

  it('uses the longest matching href across submenu parents', () => {
    const subItems: SidebarSubItemRef[] = [
      { key: 'settings.overview', href: '/companies/co/settings' },
      { key: 'roles.permissions', href: '/companies/co/settings/permissions' },
      { key: 'lineoa', href: '/companies/co/settings/line-oa' },
    ];

    assert.equal(isActiveNavSubItem('/companies/co/settings/line-oa', 'lineoa', subItems[0], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/settings/line-oa', 'lineoa', subItems[2], subItems), true);
    assert.equal(isActiveNavSubItem('/companies/co/settings/permissions', 'roles', subItems[0], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/settings/permissions', 'roles', subItems[1], subItems), true);
    assert.equal(isActiveNavSubItem('/companies/co/settings', 'settings', subItems[0], subItems), true);
    assert.equal(isActiveNavSubItem('/companies/co/settings', 'settings', subItems[1], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/settings', 'settings', subItems[2], subItems), false);
  });

  // 2026-10-13: adding or editing an employee has no row of its own; the route names the list row, and the settings
  // overview (a prefix of that address) must not light beside it.
  it('lights only the row the route names when a page has no row of its own', () => {
    const subItems: SidebarSubItemRef[] = [
      { key: 'settings.overview', href: '/companies/co/settings' },
      { key: 'roles.individual', href: '/companies/co/settings/access-overview' },
      { key: 'roles.permissions', href: '/companies/co/settings/permissions' },
    ];
    const lit = (pathname: string, activeKey?: string) => subItems.filter((sub) => isActiveNavSubItem(pathname, activeKey, sub, subItems)).map((sub) => sub.key);

    assert.deepEqual(lit('/companies/co/settings/employees', 'roles.individual'), ['roles.individual']);
    assert.deepEqual(lit('/companies/co/settings/access-overview'), ['roles.individual']);
    assert.deepEqual(lit('/companies/co/settings', 'settings'), ['settings.overview']);
  });
});

describe('revealScrollDelta', () => {
  const root = { top: 100, bottom: 500 };
  it('does not move an active item that is already visible', () => {
    assert.equal(revealScrollDelta(root, { top: 120, bottom: 160 }), 0);
  });
  it('moves only enough to reveal an item above or below the viewport', () => {
    assert.equal(revealScrollDelta(root, { top: 70, bottom: 110 }), -30);
    assert.equal(revealScrollDelta(root, { top: 480, bottom: 540 }), 40);
  });
});

describe('collapsed sidebar layout', () => {
  it('keeps main content fixed while hover expansion overlays it', () => {
    const source = readFileSync(join(shellDir, 'WorkspaceShell.tsx'), 'utf8');
    assert.match(source, /: isExpanded\s*\? 'lg:ml-\[289px\]'/);
    assert.doesNotMatch(source, /isExpanded \|\| isHovered/);
  });
});

describe('collapsed sidebar hover', () => {
  // What the browser reports to the sidebar once its collapse button was pressed with the pointer resting on it
  // (real look, 2026-10-02): the press takes the button and every label out of the page, and the pointer is reported
  // again as one more mouseenter — in Chromium 149 coming from the removed element, in WebKit 26.5 from nowhere.
  const removedElement = { isConnected: false };
  const elementOfThePage = { isConnected: true };

  it('stays collapsed when the collapse button is pressed with the pointer on the sidebar', () => {
    assert.equal(isPointerArrival(removedElement, true), false);
    assert.equal(isPointerArrival(null, true), false);
  });

  it('opens when the pointer has left and comes back', () => {
    // A leave lowers the flag; any entry counts then, also one from outside the window, where the sidebar's edge is.
    assert.equal(isPointerArrival(elementOfThePage, false), true);
    assert.equal(isPointerArrival(null, false), true);
    // WebKit reports no leave when the removed label was all that lay under the pointer: arriving from the page is proof enough.
    assert.equal(isPointerArrival(elementOfThePage, true), true);
  });

  it('closes the same way from the keyboard: by where the pointer rests, never by focus', () => {
    const source = readFileSync(join(shellDir, 'AppSidebar.tsx'), 'utf8');
    // Enter or Space on the focused button is this same click; what counts is whether the pointer is on the sidebar.
    assert.match(source, /closedUnderPointerRef\.current = isExpanded && Boolean\(event\.currentTarget\.closest\('aside'\)\?\.matches\(':hover'\)\);\s+setIsHovered\(false\);\s+toggleSidebar\(\);/);
    assert.match(source, /if \(!isPointerArrival\(event\.nativeEvent\.relatedTarget as Node \| null, closedUnderPointerRef\.current\)\) return;/);
    assert.match(source, /onMouseLeave=\{\(\) => \{\s+closedUnderPointerRef\.current = false;/);
    assert.match(source, /\$\{isExpanded \|\| isMobileOpen \|\| isHovered \? 'w-\[min\(289px,85vw\)\] lg:w-\[289px\]' : 'w-\[86px\]'\}/);
  });
});

describe('workspace account menu placement', () => {
  it('uses the authenticated custom role name rather than the user-menu caption', () => {
    const source = readFileSync(join(shellDir, 'AppSidebar.tsx'), 'utf8');
    assert.ok(source.includes('userRoleNames?.[role]?.trim()'));
    assert.ok(!source.includes("roleLabelKey[role] ?? 'shell.user_menu'"));
  });
  it('keeps account actions in the sidebar footer and out of the header', () => {
    const sidebarSource = readFileSync(join(shellDir, 'AppSidebar.tsx'), 'utf8');
    const headerSource = readFileSync(join(shellDir, 'AppHeader.tsx'), 'utf8');

    assert.match(sidebarSource, /id="sidebar-user-menu"/);
    assert.match(sidebarSource, /shell\.reset_password/);
    // One LINE row, not two: the OAuth start action carries the lineLinkMenuRow state gate.
    assert.match(sidebarSource, /lineLinkMenuRow/);
    assert.match(sidebarSource, /line-login\/start/);
    assert.doesNotMatch(sidebarSource, /issueSelfLineLinkToken/);
    assert.match(sidebarSource, /logoutCurrentSession/);
    assert.doesNotMatch(headerSource, /shell\.user_menu|shell\.reset_password|logoutCurrentSession/);
  });
});

describe('lineLinkMenuRow', () => {
  it('keeps the row disabled while the lazy account-security fetch is in flight', () => {
    // "Unknown" must not read as "not linked": in the fetch window an already-linked user
    // could otherwise start the re-link the owner directive forbids. The row still renders
    // immediately — the menu never blocks on the call — it just is not clickable yet.
    assert.deepEqual(lineLinkMenuRow(null), {
      labelKey: 'shell.line_link.action',
      badgeKey: null,
      disabled: true,
    });
  });

  it('offers the link action with the amber not-linked badge', () => {
    assert.deepEqual(lineLinkMenuRow({ lineLinked: false }), {
      labelKey: 'shell.line_link.action',
      badgeKey: 'shell.line_link.badge_unlinked',
      disabled: false,
    });
  });

  it('renders an already-linked account as a disabled row (owner directive 2026-09-01)', () => {
    // Re-link and unlink stay admin-console actions: an accidental tap here would sever a
    // working identity and burn LINE OA push quota.
    assert.deepEqual(lineLinkMenuRow({ lineLinked: true }), {
      labelKey: 'shell.line_link.linked_title',
      badgeKey: 'shell.line_link.badge_linked',
      disabled: true,
    });
  });
});

(globalThis as typeof globalThis & { React: typeof React }).React = React;
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const { SidebarProvider } = require('./SidebarContext') as typeof import('./SidebarContext');
const { default: AppSidebar } = require('./AppSidebar') as typeof import('./AppSidebar');
const sidebar = (key: string, name: string, locale: 'th' | 'en' = 'th') => renderToStaticMarkup(
  React.createElement(SidebarProvider, null, React.createElement(AppSidebar, {
    navItems: [], locale, userName: 'สมชาย', userRoles: [key], userRoleNames: { [key]: name },
  })),
);

describe('sidebar standard-role names', () => {
  it('renders the same Thai name as employee pickers for every standard role, with no stored English name', () => {
    const stored = { OWNER: 'Owner', SYSTEM_ADMIN: 'System Admin', COMPANY_VIEW: 'Company owner', ADMIN: 'Admin',
      MANAGER: 'Manager', HR: 'HR', SALES: 'Sales', INVENTORY: 'Inventory', FINANCE: 'Finance', ACCOUNTANT: 'Accountant',
      MARKETING: 'Marketing', STAFF: 'Staff', AUDITOR_READONLY: 'Auditor (Read-only)', MANGMEE_SALES_LEAD: 'Mangmee Sales Lead', MANGMEE_SALES: 'Mangmee Sales' };
    for (const [key, name] of Object.entries(stored)) {
      const html = sidebar(key, name);
      assert.ok(html.includes(roleKeyDisplayName(key)), key);
      assert.equal(html.includes(`>${name}<`), false, key);
    }
  });

  it('preserves company-named copies and custom roles while translating unnamed standard copies', () => {
    for (const key of ['ADMIN', 'ACCOUNTANT', 'AUDITOR_READONLY', 'CUSTOM']) {
      assert.ok(sidebar(key, 'ผู้ช่วยประจำบริษัท').includes('ผู้ช่วยประจำบริษัท'), key);
    }
    assert.ok(sidebar('ACCOUNTANT', 'Accountant').includes(roleDisplayName({ key: 'ACCOUNTANT', name: 'Accountant', isSystem: false })));
    assert.ok(sidebar('ACCOUNTANT', 'Accountant', 'en').includes('Accountant'));
  });
});

it('FIX-Q2 failed account status explains the disabled LINE action and offers a local reload', async () => {
  const runtime = require('react') as typeof React;
  const originalState = runtime.useState, originalEffect = runtime.useEffect, originalCreate = runtime.createElement, originalFetch = globalThis.fetch;
  const states: any[] = [], effects: Array<{ work: () => any; deps?: any[] }> = [];
  let cursor = 0, buttons: any[] = [], calls = 0;
  Reflect.set(runtime, 'useState', (initial: any) => {
    const i = cursor++, state = (originalState as any)(initial);
    if (!(i in states)) states[i] = i === 5 ? true : state[0];
    return [states[i], (next: any) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
  });
  Reflect.set(runtime, 'useEffect', (work: () => any, deps?: any[]) => { effects.push({ work, deps }); });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'button') buttons.push({ props, children });
    return (originalCreate as any)(type, props, ...children);
  });
  globalThis.fetch = async () => { if (++calls === 1) return new Response('{}', { status: 503 }); return new Response(JSON.stringify({ lineLinked: false })); };
  const render = () => { cursor = 0; effects.length = 0; buttons = []; return sidebar('OWNER', 'Owner'); };
  const flushRead = async () => { const effect = effects.find(effect => effect.work.toString().includes('getAccountSecurityState')); assert.ok(effect); effect.work(); await new Promise(resolve => setImmediate(resolve)); };
  try {
    render(); await flushRead();
    const html = render(); assert.match(html, /โหลดสถานะบัญชีไม่ได้/);
    const retry = buttons.find(button => button.children.includes('ลองอีกครั้ง')); assert.ok(retry);
    retry.props.onClick(); render(); await flushRead();
    assert.doesNotMatch(render(), /โหลดสถานะบัญชีไม่ได้/);
    const line = buttons.find(button => button.props.onClick?.toString().includes('line-login')); assert.ok(line); assert.equal(line.props.disabled, false);
    assert.equal(calls, 2);
  } finally {
    Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'useEffect', originalEffect); Reflect.set(runtime, 'createElement', originalCreate); globalThis.fetch = originalFetch;
  }
});

it('FIX-Q2 mobile drawer wraps keyboard focus and marks the page behind it inert', () => {
  const runtime = require('react') as typeof React;
  const originalState = runtime.useState, originalCreate = runtime.createElement;
  let stateIndex = 0;
  let drawer: any, background: any;
  Reflect.set(runtime, 'useState', (initial: any) => { const state = (originalState as any)(initial); return [stateIndex++ === 1 ? true : state[0], state[1]]; });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    if (type === 'aside') drawer = props;
    if (type === 'div' && props?.className?.includes('min-h-dvh')) background = props;
    return (originalCreate as any)(type, props, ...children);
  });
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    const { WorkspaceShell } = require('./WorkspaceShell') as typeof import('./WorkspaceShell');
    renderToStaticMarkup(React.createElement(WorkspaceShell, { locale: 'th', userName: 'สมชาย', children: React.createElement('button', null, 'เนื้อหา') }));
    assert.equal(background.inert, true); assert.equal(drawer['aria-modal'], true);
    assert.equal(typeof drawer.onKeyDown, 'function');
    let focus = '', prevented = false;
    const first = { focus: () => { focus = 'first'; }, getClientRects: () => [1], closest: () => null };
    const last = { focus: () => { focus = 'last'; }, getClientRects: () => [1], closest: () => null };
    const hidden = { focus: () => { focus = 'hidden'; }, getClientRects: () => [] };
    const target = { querySelectorAll: () => [first, last, hidden] };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: last } });
    drawer.onKeyDown({ key: 'Tab', shiftKey: false, currentTarget: target, preventDefault: () => { prevented = true; } });
    assert.equal(focus, 'first'); assert.equal(prevented, true);
    (globalThis.document as any).activeElement = first;
    drawer.onKeyDown({ key: 'Tab', shiftKey: true, currentTarget: target, preventDefault() {} }); assert.equal(focus, 'last');
    const source = readFileSync(join(shellDir, 'AppSidebar.tsx'), 'utf8');
    assert.match(source, /useDialogFocus\(isMobileOpen, sidebarRef\)/);
  } finally {
    Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'createElement', originalCreate);
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});

it('phone drawer closes through its close button, Escape and every menu link, and a repeated backdrop dismissal stays closed', () => {
  const runtime = require('react') as typeof React;
  const originalState = runtime.useState, originalEffect = runtime.useEffect, originalCreate = runtime.createElement, originalStore = runtime.useSyncExternalStore;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const Link = require('next/link').default;
  const { WorkspaceShell } = require('./WorkspaceShell') as typeof import('./WorkspaceShell');
  const states: any[] = [], nodes: Array<{ type: any; props: any; children: any[] }> = [], effects: Array<() => any> = [];
  let cursor = 0;
  Reflect.set(runtime, 'useSyncExternalStore', () => false); // phone, without hover
  Reflect.set(runtime, 'useState', (initial: any) => {
    const i = cursor++, pair = (originalState as any)(initial);
    if (!(i in states)) states[i] = pair[0];
    return [states[i], (next: any) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
  });
  Reflect.set(runtime, 'useEffect', (work: () => any) => { effects.push(work); });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    nodes.push({ type, props, children });
    return (originalCreate as any)(type, props, ...children);
  });
  const render = () => {
    cursor = 0; nodes.length = 0; effects.length = 0;
    return renderToStaticMarkup(React.createElement(PathnameContext.Provider, { value: '/current' }, React.createElement(WorkspaceShell, { locale: 'th', userName: 'สมชาย', children: 'เนื้อหา', showAccountSecurity: true,
      accountLinks: [{ key: 'account', href: '/account', label: 'บัญชีของฉัน' }],
      navItems: [{ key: 'home', label: 'หน้าแรก', href: '/current', icon: null, group: 'main' },
        { key: 'expenses', label: 'ค่าใช้จ่าย', icon: null, group: 'main', subItems: [{ key: 'list', label: 'รายการ', href: '/current/child' }] }] })));
  };
  const closed = () => {
    assert.equal(states[1], false);
    render();
    const aside = nodes.find(node => node.type === 'aside')!.props;
    assert.equal(aside['aria-hidden'], true); assert.equal(aside.inert, true); assert.equal(aside.role, undefined);
    assert.equal(nodes.find(node => node.type === 'div' && node.props?.className?.includes('min-h-dvh'))!.props.inert, undefined);
  };
  const open = () => {
    render();
    nodes.find(node => node.type === 'button' && node.props?.['aria-label'] === 'สลับเมนู')!.props.onClick();
    render(); assert.equal(states[1], true);
  };
  try {
    open();
    const backdrop = nodes.find(node => node.type === 'div' && node.props?.className?.includes('inset-0 z-40'))!.props;
    nodes.find(node => node.type === 'button' && node.children.includes('ปิดเมนู'))!.props.onClick();
    closed();
    backdrop.onClick(); // a trailing dismissal must never reopen the drawer
    closed();
    open();
    let keydown: any;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener: (_: string, listener: any) => { keydown = listener; }, removeEventListener() {} } });
    const escape = effects.find(work => work.toString().includes('closeOnEscape')); assert.ok(escape);
    const cleanup = escape();
    keydown({ key: 'Enter' }); assert.equal(states[1], true);
    keydown({ key: 'Escape' }); closed(); cleanup();
    for (const href of ['/', '/current', '/current/child', '/account', '/change-password']) {
      open(); states[5] = true; render(); // user menu open as well
      const link = nodes.find(node => node.type === Link && node.props?.href === href); assert.ok(link, href);
      link.props.onClick?.();
      const drawer = nodes.find(node => node.type === 'aside')!.props;
      assert.equal(typeof drawer.onClick, 'function', `${href} closes even when the route does not change`);
      drawer.onClick({ target: { closest: (selector: string) => selector === 'a[href]' ? link : null } });
      closed();
    }
  } finally {
    Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'useEffect', originalEffect);
    Reflect.set(runtime, 'createElement', originalCreate); Reflect.set(runtime, 'useSyncExternalStore', originalStore);
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});

it('phone drawer keeps the close target still through focus wrapping and pointer arrival, for 100 open-close cycles', () => {
  const runtime = require('react') as typeof React;
  const originalState = runtime.useState, originalCreate = runtime.createElement, originalStore = runtime.useSyncExternalStore;
  const globals = ['document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const { WorkspaceShell } = require('./WorkspaceShell') as typeof import('./WorkspaceShell');
  const states: any[] = [], nodes: Array<{ type: any; props: any; children: any[] }> = [];
  let cursor = 0;
  const document = { activeElement: null as any };
  // A narrow Chromium window still has a mouse: hover is supported while the desktop breakpoint is false.
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: (query: string) => ({ matches: query === '(hover: hover)' }) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Reflect.set(runtime, 'useSyncExternalStore', (_subscribe: any, snapshot: () => any) => snapshot());
  Reflect.set(runtime, 'useState', (initial: any) => {
    const i = cursor++, pair = (originalState as any)(initial);
    if (!(i in states)) states[i] = pair[0];
    return [states[i], (next: any) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
  });
  Reflect.set(runtime, 'createElement', (type: any, props: any, ...children: any[]) => {
    nodes.push({ type, props, children });
    return (originalCreate as any)(type, props, ...children);
  });
  const render = () => {
    cursor = 0; nodes.length = 0;
    renderToStaticMarkup(React.createElement(WorkspaceShell, { locale: 'th', children: 'เนื้อหา' }));
  };
  const headerLayout = () => nodes.find(node => node.type === 'div' && node.props?.className?.startsWith('py-6 flex items-center'))!.props.className
    .split(/\s+/).filter((name: string) => !name.startsWith('lg:')).join(' ');
  const control = () => {
    const node = { isConnected: true, tagName: 'BUTTON', getClientRects: () => [1], closest: () => null, focus: () => { document.activeElement = node; } };
    return node;
  };
  try {
    for (let i = 0; i < 100; i++) {
      render();
      nodes.find(node => node.type === 'button' && node.props?.['aria-label'] === 'สลับเมนู')!.props.onClick();
      render(); assert.equal(states[1], true);
      const drawer = nodes.find(node => node.type === 'aside')!.props;
      const first = control(), last = control(); first.focus();
      const key = (shiftKey: boolean) => drawer.onKeyDown({ key: 'Tab', shiftKey, currentTarget: { querySelectorAll: () => [first, last] }, preventDefault() {} });
      key(true); assert.equal(document.activeElement, last);
      key(false); assert.equal(document.activeElement, first);
      const beforePointer = headerLayout();
      drawer.onMouseEnter({ nativeEvent: { relatedTarget: { isConnected: true } } });
      render();
      assert.equal(headerLayout(), beforePointer, `cycle ${i}: the close button must not move between pointer arrival and click`);
      assert.equal(states[2], false, 'a phone drawer must not enter desktop hover expansion');
      nodes.find(node => node.type === 'button' && node.children.includes('ปิดเมนู'))!.props.onClick();
      render();
      assert.equal(states[1], false);
      const closed = nodes.find(node => node.type === 'aside')!.props;
      assert.equal(closed['aria-hidden'], true); assert.equal(closed.inert, true); assert.equal(closed.role, undefined);
      assert.equal(nodes.find(node => node.type === 'div' && node.props?.className?.includes('min-h-dvh'))!.props.inert, undefined);
    }
  } finally {
    Reflect.set(runtime, 'useState', originalState); Reflect.set(runtime, 'createElement', originalCreate); Reflect.set(runtime, 'useSyncExternalStore', originalStore);
    for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
