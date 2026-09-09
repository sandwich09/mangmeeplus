import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ToastContext } from '@/common/components/toast/use-toast';
import { readFileSync } from 'node:fs';

const centerSource = readFileSync(new URL('./NotificationPages.tsx', import.meta.url), 'utf8');
const bellSource = readFileSync(new URL('./NotificationBell.tsx', import.meta.url), 'utf8');

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const previousSvgLoader = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const { NotificationCenterPage } = require('./NotificationPages') as typeof import('./NotificationPages');
if (previousSvgLoader) require.extensions['.svg'] = previousSvgLoader;
else delete require.extensions['.svg'];

function renderCenter(permissions: string[]): string {
  const noop = () => undefined;
  return renderToStaticMarkup(React.createElement(
    AppRouterContext.Provider,
    { value: { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, bfcacheId: 'test' } },
    React.createElement(
      ToastContext.Provider,
      { value: { success: noop, warning: noop, error: noop } },
      React.createElement(NotificationCenterPage, { companyId: 'company-1', permissions }),
    ),
  ));
}

describe('notification center header', () => {
  it('keeps read actions and filters without settings/rules links, even with management grants', () => {
    for (const permissions of [
      ['notification.read'],
      ['notification.read', 'notification.preference.manage', 'notification.rule.manage'],
    ]) {
      const html = renderCenter(permissions);
      assert.match(html, /ศูนย์การแจ้งเตือน/);
      assert.match(html, /อ่านทั้งหมด/);
      assert.match(html, /ยังไม่ได้อ่าน/);
      assert.match(html, />ทั้งหมด<\/button>/);
      assert.doesNotMatch(html, /href="[^"]*\/(?:settings\/notifications|notifications\/rules)"/);
      assert.doesNotMatch(html, />\s*(?:ตั้งค่า|กฎ)\s*<\//);
    }
  });

  it('does not grant center access from management permissions alone', () => {
    const html = renderCenter(['notification.preference.manage', 'notification.rule.manage']);
    assert.doesNotMatch(html, /ศูนย์การแจ้งเตือน|อ่านทั้งหมด|ยังไม่ได้อ่าน/);
    assert.match(html, /ไม่มีสิทธิ์/);
  });
});

describe('notification mutation integrity', () => {
  it('updates center and bell state only after a successful API mutation', () => {
    assert.match(centerSource, /await markRead\(companyId, id\);\s*setItems/);
    assert.match(centerSource, /catch \(err\) \{\s*setError\(apiErrorMessage\(err\)\)/);
    assert.doesNotMatch(centerSource, /mark(?:Read|AllRead).*\.catch\(\(\) => null\)/);
    assert.match(bellSource, /await markAllRead\(companyId\);\s*setItems/);
    assert.match(bellSource, /catch \(err\) \{\s*toast\.error\(err\)/);
  });
});
