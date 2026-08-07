import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationBadgeText,
  severityColor,
  severityLabel,
  visibleNotificationChildLinks,
} from './dashboard-notifications.logic';

describe('visibleNotificationChildLinks', () => {
  it('shows only settings endpoints the session can manage', () => {
    assert.deepEqual(
      visibleNotificationChildLinks(['notification.preference.manage']),
      ['preferences'],
    );
    assert.deepEqual(
      visibleNotificationChildLinks(['notification.rule.manage']),
      ['rules'],
    );
  });

  it('keeps source order and ignores notification centre read access', () => {
    assert.deepEqual(
      visibleNotificationChildLinks([
        'notification.rule.manage',
        'notification.preference.manage',
      ]),
      ['preferences', 'rules'],
    );
    assert.deepEqual(visibleNotificationChildLinks(['notification.read']), []);
  });
});

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

describe('severity presentation', () => {
  it('labels every severity in Thai with a distinct tone class', () => {
    const severities = ['critical', 'action', 'insight', 'info'] as const;
    const labels = severities.map(severityLabel);
    assert.deepEqual(labels, ['วิกฤต', 'ต้องดำเนินการ', 'ข้อมูลเชิงลึก', 'แจ้งเพื่อทราบ']);
    assert.equal(new Set(severities.map(severityColor)).size, severities.length);
  });
});
