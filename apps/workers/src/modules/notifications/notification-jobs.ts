/**
 * Notification Job Definitions (Item 06)
 * Defines job types and payloads for BullMQ queues.
 * No framework dependencies — pure TypeScript types and helpers.
 */

export type NotificationJobKind =
  | 'snapshot.generate'
  | 'daily_owner_summary'
  | 'stock_low.scan'
  | 'delivery.process'
  | 'delivery.retry'
  | 'delivery.sweep'
  | 'snapshot.sweep'
  | 'stock_low.sweep'
  | 'daily_owner_summary.sweep';

export type SnapshotJobPayload = {
  companyId: string;
  periodKind: 'today' | 'week' | 'month';
  idempotencyKey: string;
};

export type DailyOwnerSummaryPayload = {
  companyId: string;
  periodKey: string; // e.g. "2026-06-25"
  idempotencyKey: string;
};

export type StockLowScanPayload = {
  companyId: string;
  idempotencyKey: string;
};

export type DeliveryProcessPayload = {
  companyId: string;
  deliveryId: string;
  channel: 'web' | 'line';
  idempotencyKey: string;
};

export type NotificationJobPayload =
  | { kind: 'snapshot.generate'; data: SnapshotJobPayload }
  | { kind: 'daily_owner_summary'; data: DailyOwnerSummaryPayload }
  | { kind: 'stock_low.scan'; data: StockLowScanPayload }
  | { kind: 'delivery.process'; data: DeliveryProcessPayload }
  | { kind: 'delivery.retry'; data: DeliveryProcessPayload }
  | { kind: 'delivery.sweep'; data: Record<string, never> }
  | { kind: 'snapshot.sweep'; data: Record<string, never> }
  | { kind: 'stock_low.sweep'; data: Record<string, never> }
  | { kind: 'daily_owner_summary.sweep'; data: Record<string, never> };

export const NOTIFICATION_QUEUE = 'notifications';

// Delivery sweep cadence (A4): the dispatcher that drains QUEUED web+LINE deliveries.
export const DELIVERY_SWEEP_INTERVAL_MS = 30_000;
export const SNAPSHOT_SWEEP_INTERVAL_MS = 15 * 60_000;
export const STOCK_LOW_SWEEP_INTERVAL_MS = 60 * 60_000;
export const DAILY_OWNER_SUMMARY_CRON = { pattern: '0 7 * * *', tz: 'Asia/Bangkok' } as const;

// Backoff helper reused from outbox pattern
export function computeNextAttemptAt(attemptCount: number): Date {
  const backoffMs = Math.min(Math.pow(2, attemptCount) * 30_000, 3_600_000); // max 1h
  return new Date(Date.now() + backoffMs);
}

// Idempotency key helpers
export function snapshotIdempotencyKey(companyId: string, periodKind: string, date: string): string {
  return `snapshot:${companyId}:${periodKind}:${date}`;
}

export function dailySummaryIdempotencyKey(companyId: string, periodKey: string): string {
  return `daily_summary:${companyId}:${periodKey}`;
}

export function stockLowIdempotencyKey(companyId: string, date: string): string {
  return `stock_low:${companyId}:${date}`;
}
