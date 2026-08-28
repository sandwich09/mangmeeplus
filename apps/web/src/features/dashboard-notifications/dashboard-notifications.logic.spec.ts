import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
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

describe('severity presentation', () => {
  it('labels every severity in Thai with a distinct tone class', () => {
    const severities = ['critical', 'action', 'insight', 'info'] as const;
    const labels = severities.map(severityLabel);
    assert.deepEqual(labels, ['วิกฤต', 'ต้องดำเนินการ', 'ข้อมูลเชิงลึก', 'แจ้งเพื่อทราบ']);
    assert.equal(new Set(severities.map(severityColor)).size, severities.length);
  });
});
