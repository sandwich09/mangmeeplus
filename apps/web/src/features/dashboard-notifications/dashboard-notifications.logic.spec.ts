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
