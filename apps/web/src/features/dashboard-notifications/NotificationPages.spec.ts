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
      // 2026-10-13: the page carries the bell's own name (thai-ux-standard §1.1), and "mark all" is drawn only while
      // something is unread (§2.9), so the empty render has the heading and the source has the action.
      assert.match(html, /<h1[^>]*>การแจ้งเตือน<\/h1>/);
      assert.match(centerSource, /items\.some\(isUnreadNotification\) && \(\s*<button[\s\S]*?ทำเป็นอ่านแล้วทั้งหมด/);
      assert.match(html, /ยังไม่ได้อ่าน/);
      assert.match(html, />ทั้งหมด<\/button>/);
      assert.doesNotMatch(html, /href="[^"]*\/(?:settings\/notifications|notifications\/rules)"/);
      assert.doesNotMatch(html, />\s*(?:ตั้งค่า|กฎ)\s*<\//);
    }
  });

  it('does not grant center access from management permissions alone', () => {
    const html = renderCenter(['notification.preference.manage', 'notification.rule.manage']);
    assert.doesNotMatch(html, />การแจ้งเตือน<|ทำเป็นอ่านแล้วทั้งหมด|ยังไม่ได้อ่าน/);
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

describe('notification rules wording', () => {
  it('does not print trigger keys or machine channel names', () => {
    assert.doesNotMatch(centerSource, /rule\.description|rule\.triggerKey/);
    // Channel names reach the rule card through notificationRuleDetailText, which uses notificationRuleChannelsText.
    assert.match(centerSource, /notificationRuleDetailText\(rule\)/);
    assert.doesNotMatch(centerSource, /channel === 'web' \? 'Web'/);
    assert.doesNotMatch(centerSource, /Web ยังบันทึกทุกแจ้งเตือนเสมอ/);
  });

  it('uses native time controls instead of showing API-format time examples', () => {
    assert.equal((centerSource.match(/type="time"/g) ?? []).length, 2);
    assert.doesNotMatch(centerSource, /placeholder="(?:22:00|07:00)"/);
  });
});

it('W4 every notification title wraps fully while the row keeps its minimum height and unread mark', () => {
  // 2026-10-13: the title has the row's full width, is bold while unread and keeps document numbers whole (`withUnits`).
  const title = centerSource.match(/<p className=\{`([^`]+)`\}>\{withUnits\(item\.title\)\}<\/p>/)![1]!;
  assert.doesNotMatch(title, /line-clamp|truncate/);
  assert.match(title, /break-words/);
  assert.match(centerSource, /relative flex items-start gap-2 p-3/);
  assert.doesNotMatch(centerSource.match(/<div key=\{item.id\}[^>]+>/)![0], /h-\[|max-h-|overflow-hidden/);
  assert.match(centerSource, /isUnreadNotification\(item\)/);
});

it('bell titles have two lines so different document numbers remain distinguishable', () => {
  const title = bellSource.match(/<div className=\{`([^`]+)`\}>\{item.title\}<\/div>/)![1]!;
  assert.match(title, /line-clamp-2/); assert.doesNotMatch(title, /truncate/);
});

it('only the newest tab request fills the centre, so a slower earlier answer cannot replace the chosen list', () => {
  assert.match(centerSource, /const request = \+\+latestRequest\.current;/);
  assert.match(centerSource, /\.then\(\(res\) => \{ if \(request !== latestRequest\.current\) return; setItems\(res\.items\)/);
  assert.match(centerSource, /\.catch\(\(err: unknown\) => \{ if \(request !== latestRequest\.current\) return;/);
});

it('offers server-filtered waiting, unread and all tabs in the centre and bell', () => {
  const html = renderCenter(['notification.read']);
  for (const label of ['ยังรออยู่', 'ยังไม่ได้อ่าน', 'ทั้งหมด']) {
    assert.ok(html.includes(label)); assert.ok(bellSource.includes(label));
  }
  for (const source of [centerSource, bellSource]) {
    assert.match(source, /waiting: filter === 'waiting' \? true : undefined/);
    assert.match(source, /read: filter === 'unread' \? false : undefined/);
  }
  assert.match(bellSource, /waiting: result.items, earlier: \[\]/, 'retain read waiting work and resolved all-tab rows returned by the server');
  assert.doesNotMatch(bellSource, /bellNotifications\(/);
  assert.match(bellSource, /revision === loadRevision.current/, 'a slower response cannot replace a newer filter');
});
