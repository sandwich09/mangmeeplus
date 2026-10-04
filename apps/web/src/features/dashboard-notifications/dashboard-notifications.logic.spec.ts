import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as logic from './dashboard-notifications.logic';
import {
  dashboardMetricValueText,
  notificationRuleChannelsText,
  notificationBadgeText,
  severityColor,
  severityLabel,
  visibleNotifications,
  isUnreadNotification,
  notificationBodyText,
  notificationTag,
} from './dashboard-notifications.logic';

describe('notificationBadgeText', () => {
  it('hides the badge at zero or invalid counts', () => {
    assert.equal(notificationBadgeText(0), null);
    assert.equal(notificationBadgeText(-1), null);
    assert.equal(notificationBadgeText(Number.NaN), null);
  });

  it('shows the exact count up to 99 then caps', () => {
    assert.equal(notificationBadgeText(1), '1');
    assert.equal(notificationBadgeText(99), '99');
    assert.equal(notificationBadgeText(100), '99+');
  });
});

describe('visibleNotifications', () => {
  const notification = (id: string, read: boolean) => ({
    id, companyId: 'c1', triggerKey: 'test', severity: 'info' as const, title: id, body: '', createdAt: '2026-08-28T00:00:00.000Z',
    sourceModule: 'test', status: 'open' as const, read, deliveryChannels: ['web' as const],
  });

  it('removes newly-read rows from unread without hiding them from all', () => {
    const items = [notification('unread', false), notification('read', true)];
    assert.deepEqual(visibleNotifications(items, 'unread').map((item) => item.id), ['unread']);
    assert.deepEqual(visibleNotifications(items, 'all').map((item) => item.id), ['unread', 'read']);
  });

  // Found 2026-10-05: a claim notice the server had resolved (the claim was paid) came back with no read time. The badge and
  // the unread list left it out, yet the bell drew it with the unread dot and tint, under a sentence asking for the payment.
  it('never treats a resolved notice as unread, whatever its read time says', () => {
    const resolved = { ...notification('resolved', false), status: 'resolved' as const, body: 'ยอด 680.00 บาท · รอคุณบันทึกการจ่ายเงิน' };
    const open = { ...notification('open', false), body: 'ยอด 650.00 บาท' };
    assert.equal(isUnreadNotification(resolved), false); assert.equal(isUnreadNotification({ ...resolved, read: true }), false);
    assert.equal(isUnreadNotification(open), true); assert.equal(isUnreadNotification({ ...open, read: true }), false);
    assert.deepEqual(visibleNotifications([resolved, open], 'unread').map((item) => item.id), ['open']);
    assert.deepEqual(visibleNotifications([resolved, open], 'all').map((item) => item.id), ['resolved', 'open']);
  });

  it('leaves the sentence written when the notice was raised out of a resolved notice: it can ask for what is already done', () => {
    const body = 'ยอด 680.00 บาท · รอคุณบันทึกการจ่ายเงิน';
    assert.equal(notificationBodyText({ status: 'resolved', body }), '');
    assert.equal(notificationBodyText({ status: 'open', body }), body);
    assert.equal(notificationBodyText({ status: 'open', body: '' }), '');
  });

  it('tags a resolved notice as done in the neutral colour, not in the colour that asks for action', () => {
    assert.deepEqual(notificationTag({ status: 'resolved', severity: 'action' }), { label: 'ดำเนินการแล้ว', tone: severityColor('info') });
    assert.deepEqual(notificationTag({ status: 'open', severity: 'action' }), { label: 'ต้องดำเนินการ', tone: severityColor('action') });
    for (const file of ['NotificationBell.tsx', 'NotificationPages.tsx']) assert.doesNotMatch(readFileSync(join(__dirname, file), 'utf8'), /ดำเนินการแล้ว|severityColor\(item/, file);
  });

  it('is the one rule both screens draw from: dot, tint, bold title, dimming, mark-as-read and mark-all', () => {
    for (const file of ['NotificationBell.tsx', 'NotificationPages.tsx']) {
      const page = readFileSync(join(__dirname, file), 'utf8');
      assert.doesNotMatch(page, /item\.read|!n\.read|item\.body/, file);
      assert.match(page, /isUnreadNotification/, file); assert.match(page, /notificationBodyText\(item\)/, file);
    }
    const bell = readFileSync(join(__dirname, 'NotificationBell.tsx'), 'utf8'), centre = readFileSync(join(__dirname, 'NotificationPages.tsx'), 'utf8');
    assert.match(bell, /\{unread && <span aria-hidden className="ml-auto h-2 w-2 shrink-0 rounded-full bg-brand-500" \/>\}/); assert.match(bell, /\$\{unread \? 'bg-brand-25\/50' : ''\}/);
    assert.match(bell, /if \(!isUnreadNotification\(item\)\) return;/);
    assert.match(centre, /\$\{isUnreadNotification\(item\) \? '' : 'opacity-60'\}/); assert.match(centre, /!items\.some\(isUnreadNotification\)/); assert.match(centre, /read=\{!isUnreadNotification\(item\)\}/);
  });
});

describe('dashboard stock metric display', () => {
  it('formats stock timestamps and counts for Thai readers', () => {
    assert.equal(dashboardMetricValueText({ key: 'last_movement_at', label: 'การเคลื่อนไหวล่าสุด', value: '2026-10-02T01:23:00.000Z', freshness: 'fresh' }), '2 ต.ค. 2569 08:23 น.');
    assert.equal(dashboardMetricValueText({ key: 'low_stock_count', label: 'สินค้าต่ำกว่าจุดสั่งซื้อ', value: 12345, unit: 'รายการ', freshness: 'fresh' }), '12,345 รายการ');
  });
});

describe('notification rule channels', () => {
  it('reuses the Thai web-channel dictionary term and keeps LINE', () => {
    assert.equal(notificationRuleChannelsText(['web', 'line']), 'เว็บ, LINE');
  });
});

describe('severity presentation', () => {
  it('labels every severity in Thai with a distinct tone class', () => {
    const severities = ['critical', 'action', 'insight', 'info'] as const;
    const labels = severities.map(severityLabel);
    assert.deepEqual(labels, ['สำคัญ', 'ต้องดำเนินการ', 'ข้อมูลเชิงลึก', 'แจ้งเพื่อทราบ']);
    assert.equal(new Set(severities.map(severityColor)).size, severities.length);
  });
});

// A rule that lists no channel read "ช่องทาง:  ·". Delivery follows each person's own channel settings, so the
// part is left out rather than claiming the rule has no way to reach anyone.
describe('notification rule detail line', () => {
  const lineOf = (logic as unknown as { notificationRuleDetailText?: (rule: { channels: string[]; cooldownMinutes: number }) => string }).notificationRuleDetailText;

  it('leaves the channel part out when the rule lists none', () => {
    assert.equal(typeof lineOf, 'function', 'notificationRuleDetailText');
    assert.equal(lineOf!({ channels: [], cooldownMinutes: 60 }), 'พักการแจ้งเตือน 60 นาที');
    assert.equal(lineOf!({ channels: ['line'], cooldownMinutes: 1440 }), 'ช่องทาง: LINE · พักการแจ้งเตือน 1,440 นาที');
  });

  it('is the line the rules page shows', () => {
    const page = readFileSync(join(__dirname, 'NotificationPages.tsx'), 'utf8');
    assert.match(page, /notificationRuleDetailText\(rule\)/);
    assert.doesNotMatch(page, /ช่องทาง: \{notificationRuleChannelsText/);
  });
});
