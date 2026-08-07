import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotification, normalizeRule } from './dashboard-notifications.api';

describe('dashboard-notifications.api normalizers', () => {
  it('maps notification read state and source module from backend DTO', () => {
    const item = normalizeNotification({
      id: 'n1',
      companyId: 'c1',
      triggerKey: 'stock_low',
      severity: 'action',
      title: 'Low stock',
      body: 'SKU A',
      createdAt: '2026-06-25T00:00:00.000Z',
      readAt: '2026-06-25T01:00:00.000Z',
      sourceRefs: [{ module: 'inventory' }],
      deliveryChannels: ['web', 'line'],
    });

    assert.equal(item.read, true);
    assert.equal(item.sourceModule, 'inventory');
    assert.deepEqual(item.deliveryChannels, ['web', 'line']);
  });

  it('maps rule channels from channelPolicyJson', () => {
    const rule = normalizeRule({
      id: 'r1',
      companyId: 'c1',
      triggerKey: 'stock_low',
      name: 'Low Stock Alert',
      severity: 'action',
      conditionJson: {},
      recipientPolicyJson: {},
      channelPolicyJson: { channels: ['web', 'line'] },
      cooldownMinutes: 720,
      digestPolicy: 'none',
      status: 'enabled',
    });

    assert.equal(rule.label, 'Low Stock Alert');
    assert.deepEqual(rule.channels, ['web', 'line']);
  });
});
