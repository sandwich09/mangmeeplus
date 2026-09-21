import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineMessage } from './notification-delivery-adapters.js';
import {
  DAILY_OWNER_SUMMARY_CRON,
  DELIVERY_SWEEP_INTERVAL_MS,
  SNAPSHOT_SWEEP_INTERVAL_MS,
  STOCK_LOW_SWEEP_INTERVAL_MS,
  dailySummaryIdempotencyKey,
  stockLowIdempotencyKey,
  type NotificationJobPayload,
} from './notification-jobs.js';

describe('notification worker helpers', () => {
  it('builds bounded LINE alert text with web deep link', () => {
    const text = buildLineMessage({
      companyId: 'c1',
      triggerKey: 'stock_low',
      title: 'สต็อกต่ำ',
      body: 'SKU DEMO-001',
      severity: 'action',
      deepLinkHref: '/companies/c1/inventory/products/p1',
    });

    assert.match(text, /มั่งมีพลัส/);
    assert.match(text, /\/companies\/c1\/inventory\/products\/p1/);
    assert.doesNotMatch(text, /Bearer|token|secret/i);
  });

  it('labels critical LINE alerts as important without crisis wording', () => {
    const text = buildLineMessage({ companyId: 'c1', triggerKey: 'plan_term_expired', title: 'แพ็กเกจหมดอายุแล้ว', body: '', severity: 'critical' });
    assert.match(text, /สำคัญ/);
    assert.doesNotMatch(text, /วิกฤต/);
  });

  it('uses stable idempotency keys for recurring jobs', () => {
    assert.equal(dailySummaryIdempotencyKey('c1', '2026-06-25'), 'daily_summary:c1:2026-06-25');
    assert.equal(stockLowIdempotencyKey('c1', '2026-06-25'), 'stock_low:c1:2026-06-25');
  });

  it('registers the producer sweep job kinds', () => {
    const jobs: NotificationJobPayload[] = [
      { kind: 'snapshot.sweep', data: {} },
      { kind: 'stock_low.sweep', data: {} },
      { kind: 'daily_owner_summary.sweep', data: {} },
    ];
    assert.deepEqual(jobs.map((job) => job.kind), [
      'snapshot.sweep',
      'stock_low.sweep',
      'daily_owner_summary.sweep',
    ]);
  });

  it('uses the required notification job cadences', () => {
    assert.equal(DELIVERY_SWEEP_INTERVAL_MS, 30_000);
    assert.equal(SNAPSHOT_SWEEP_INTERVAL_MS, 15 * 60_000);
    assert.equal(STOCK_LOW_SWEEP_INTERVAL_MS, 60 * 60_000);
    assert.deepEqual(DAILY_OWNER_SUMMARY_CRON, { pattern: '0 7 * * *', tz: 'Asia/Bangkok' });
  });
});
