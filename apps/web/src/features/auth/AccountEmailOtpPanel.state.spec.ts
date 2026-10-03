import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountEmailOtpPanel } from './AccountEmailOtpPanel';
import type { AccountEmailOtpState } from './account-email-otp.api';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// Exercise the real component's effects and state across renders without a DOM/server or timers.
// This intentionally does not claim browser layout/focus coverage.
async function withPanel(run: (panel: {
  render: (account: object) => string;
  settle: () => Promise<void>;
  setServer: (next: Partial<AccountEmailOtpState>) => void;
  reads: () => number;
}) => Promise<void>) {
  const runtime = require('react') as typeof React;
  const originals = { useState: runtime.useState, useRef: runtime.useRef, useEffect: runtime.useEffect, useCallback: runtime.useCallback, useId: runtime.useId };
  const fetch = globalThis.fetch;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const noop = () => undefined;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setInterval: noop, clearInterval: noop, addEventListener: noop, removeEventListener: noop, location: { search: '' } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener: noop, removeEventListener: noop } });
  let server: AccountEmailOtpState = { email: 'owner@example.com', emailVerified: false, emailRequirement: 'UNVERIFIED', emailRevision: 0, hasPassword: false, emailLoginEnabled: false, lineLinked: true, serverNow: new Date().toISOString(), challenge: null };
  let reads = 0, cursor = 0;
  const slots: unknown[] = [], effects: Array<() => void> = [], cleanups: Array<() => void> = [];
  globalThis.fetch = async () => { reads++; return Response.json(server); };
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next: unknown) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  });
  Reflect.set(runtime, 'useRef', (current: unknown) => { const index = cursor++; return slots[index] ??= { current }; });
  Reflect.set(runtime, 'useId', () => 'panel');
  Reflect.set(runtime, 'useCallback', (callback: unknown) => { const index = cursor++; return slots[index] ??= callback; });
  Reflect.set(runtime, 'useEffect', (effect: () => void | (() => void), deps: unknown[]) => {
    const index = cursor++, previous = slots[index] as unknown[] | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) {
      slots[index] = deps;
      effects.push(() => { cleanups[index]?.(); const cleanup = effect(); if (cleanup) cleanups[index] = cleanup; });
    }
  });
  try {
    await run({
      render(account) {
        cursor = 0;
        // The extra prop compiles before the fix so the regression can run against old production.
        const props = { refreshKey: account };
        const element = AccountEmailOtpPanel(props as React.ComponentProps<typeof AccountEmailOtpPanel>);
        while (effects.length) effects.shift()!();
        return renderToStaticMarkup(element);
      },
      settle: async () => { await new Promise<void>(resolve => setImmediate(resolve)); },
      setServer: next => { server = { ...server, ...next }; },
      reads: () => reads,
    });
  } finally {
    cleanups.forEach(cleanup => cleanup());
    for (const [key, value] of Object.entries(originals)) Reflect.set(runtime, key, value);
    globalThis.fetch = fetch;
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else Reflect.deleteProperty(globalThis, 'window');
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else Reflect.deleteProperty(globalThis, 'document');
  }
}

for (const [name, update] of Object.entries({
  'password set': { hasPassword: true, emailRevision: 1 },
  'password changed': { hasPassword: true, emailRevision: 2 },
  'email verified': { emailVerified: true, emailRequirement: 'READY' },
  'email changed': { email: 'new@example.com', emailVerified: true, emailRequirement: 'READY' },
  'email login enabled': { emailVerified: true, emailRequirement: 'READY', emailLoginEnabled: true },
  'email login disabled': { emailVerified: true, emailRequirement: 'READY', emailLoginEnabled: false },
} satisfies Record<string, Partial<AccountEmailOtpState>>)) {
  test(`same-page account refresh reads current OTP state after ${name}`, async () => {
    await withPanel(async panel => {
      if (name === 'password changed') panel.setServer({ hasPassword: true });
      if (name === 'email login disabled') panel.setServer({ emailVerified: true, emailRequirement: 'READY', emailLoginEnabled: true });
      const firstAccount = {};
      panel.render(firstAccount); await panel.settle(); panel.render(firstAccount);
      assert.equal(panel.reads(), 1);
      panel.setServer(update);
      const refreshedAccount = {};
      panel.render(refreshedAccount); await panel.settle();
      const html = panel.render(refreshedAccount);
      assert.equal(panel.reads(), 2, 'refresh immediately, without waiting for polling/focus or remounting');
      if (update.hasPassword || update.emailLoginEnabled) assert.doesNotMatch(html, /หากต้องการ.*รหัสผ่านสำรอง/);
      if (update.email) assert.ok(html.includes(update.email));
      if (update.emailRequirement === 'READY') assert.match(html, /ยืนยันแล้ว/);
      if (update.emailLoginEnabled !== undefined) assert.ok(html.includes(update.emailLoginEnabled ? '>เปิดใช้งานอยู่<' : '>ยังไม่เปิดใช้งาน<'));
    });
  });
}

test('the profile page passes its existing account read as the refresh dependency', () => {
  const source = readFileSync(new URL('../company-profile/CompanyProfilePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /<AccountEmailOtpPanel[\s\S]*?refreshKey=\{account\}/);
  assert.doesNotMatch(source, /location\.reload\(/);
});

test('initial loading does not claim that the account has no email', async () => {
  await withPanel(async panel => {
    const html = panel.render({});
    assert.doesNotMatch(html, /ยังไม่ได้ผูกอีเมล/);
    assert.match(html, /โหลดข้อมูลอีเมลอีกครั้ง/);
  });
});
