import assert from 'node:assert/strict';
import test from 'node:test';
import { unsyncedCampaignMetrics } from './crm-campaign-metrics.logic';

test('provider acceptance is never fabricated as delivery or engagement', () => {
  const metrics = unsyncedCampaignMetrics({ targetedCount: 120, eligibleCount: 100, providerAcceptedCount: 98 });
  assert.deepEqual(metrics.accepted, { value: 98, source: 'MANGMEE' });
  assert.deepEqual(metrics.delivered, { value: null, source: 'LINE_INSIGHT', reason: 'NOT_SYNCED' });
  assert.deepEqual(metrics.open, { value: null, source: 'LINE_INSIGHT', reason: 'NOT_SYNCED' });
  assert.deepEqual(metrics.click, { value: null, source: 'LINE_INSIGHT', reason: 'NOT_SYNCED' });
  assert.equal(metrics.reply.value, null);
  assert.equal(metrics.attribution.value, null);
});

test('zero accepted is a real zero while unavailable insight remains null', () => {
  const metrics = unsyncedCampaignMetrics({ targetedCount: 10, eligibleCount: 0, providerAcceptedCount: 0 });
  assert.equal(metrics.accepted.value, 0);
  assert.equal(metrics.delivered.value, null);
});
