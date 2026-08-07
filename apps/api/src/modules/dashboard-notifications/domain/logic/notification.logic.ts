// Pure domain logic for notifications — no framework, no Prisma, no HTTP

import type { NotificationSeverity, NotificationDeliveryStatus } from '../models/notification.model';
import {
  IMPLEMENTED_TRIGGER_KEYS,
  DELIVERY_BACKOFF_BASE_MS,
  DELIVERY_BACKOFF_MAX_MS,
  RETRYABLE_DELIVERY_ERROR_CODES,
} from '../models/notification.model';
import { SNAPSHOT_FRESH_THRESHOLD_MINUTES } from '../models/dashboard.model';

// ---- Dedup key ----

export function buildDedupKey(params: {
  companyId: string;
  triggerKey: string;
  sourceModule: string;
  sourceType: string;
  sourceId?: string;
  periodKey?: string;
}): string {
  const parts = [
    params.companyId,
    params.triggerKey,
    params.sourceModule,
    params.sourceType,
    params.sourceId ?? '_',
    params.periodKey ?? '_',
  ];
  return parts.join(':');
}

// ---- Cooldown ----

export function isInCooldown(cooldownUntil: Date | undefined | null, now: Date): boolean {
  if (!cooldownUntil) return false;
  return now < cooldownUntil;
}

export function computeCooldownUntil(cooldownMinutes: number, from: Date): Date {
  return new Date(from.getTime() + cooldownMinutes * 60_000);
}

// ---- Alert resolution ----

export function shouldResolveAlert(currentBalance: number, reorderPoint: number): boolean {
  return currentBalance > reorderPoint;
}

// ---- Quiet hours ----

// Returns true if current time is in quiet hours (suppresses non-critical LINE)
export function isInQuietHours(
  now: Date,
  quietStart: string | undefined,
  quietEnd: string | undefined,
  timezone: string,
): boolean {
  if (!quietStart || !quietEnd) return false;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const timeStr = formatter.format(now); // e.g. "23:30"
    const current = timeToMinutes(timeStr);
    const start = timeToMinutes(quietStart);
    const end = timeToMinutes(quietEnd);

    if (start <= end) {
      return current >= start && current < end;
    } else {
      // overnight: e.g. 22:00 - 07:00
      return current >= start || current < end;
    }
  } catch {
    return false;
  }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// ---- Channel eligibility ----

export function isChannelEligible(
  channel: 'web' | 'line',
  severity: NotificationSeverity,
  enabledChannels: string[],
  isQuietHours: boolean,
): boolean {
  if (!enabledChannels.includes(channel)) return false;
  if (channel === 'line' && isQuietHours && severity !== 'critical') return false;
  return true;
}

// ---- Severity ordering ----

const SEVERITY_ORDER: Record<NotificationSeverity, number> = {
  critical: 4,
  action: 3,
  insight: 2,
  info: 1,
};

export function compareSeverity(a: NotificationSeverity, b: NotificationSeverity): number {
  return SEVERITY_ORDER[b] - SEVERITY_ORDER[a];
}

// ---- Trigger support ----

export function isImplementedTrigger(triggerKey: string): boolean {
  return IMPLEMENTED_TRIGGER_KEYS.includes(triggerKey);
}

// ---- Dashboard freshness ----

export function computeFreshness(generatedAt: Date, now: Date): 'fresh' | 'stale' {
  const ageMinutes = (now.getTime() - generatedAt.getTime()) / 60_000;
  return ageMinutes <= SNAPSHOT_FRESH_THRESHOLD_MINUTES ? 'fresh' : 'stale';
}

// ---- Delivery retry eligibility ----

export function isRetryable(status: NotificationDeliveryStatus, attemptCount: number, maxAttempts: number): boolean {
  return status === 'failed' && attemptCount < maxAttempts;
}

/**
 * Whether a failed delivery's error code is transient and worth another attempt (A4).
 * Matches pushLineMessage's codes: RATE_LIMIT (429) / NETWORK_ERROR are retryable, and
 * HTTP_5xx server errors are retryable while HTTP_4xx (auth/bad request) is terminal.
 */
export function isRetryableDeliveryError(errorCode: string | undefined | null): boolean {
  if (!errorCode) return false;
  const httpMatch = /^HTTP_(\d{3})$/.exec(errorCode);
  if (httpMatch) return Number(httpMatch[1]) >= 500;
  return RETRYABLE_DELIVERY_ERROR_CODES.includes(errorCode);
}

/** Exponential backoff (base 30s, ×2 per prior attempt, capped 1h) from `from`. */
export function computeDeliveryBackoffAt(attemptCount: number, from: Date): Date {
  const backoffMs = Math.min(DELIVERY_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attemptCount)), DELIVERY_BACKOFF_MAX_MS);
  return new Date(from.getTime() + backoffMs);
}

/**
 * Decide the persisted outcome of a LINE delivery attempt (A4). Retryable errors with
 * attempts left stay QUEUED with a backoff nextAttemptAt so the sweep re-picks them;
 * exhausted or non-retryable errors go terminal FAILED.
 */
export function resolveDeliveryOutcome(input: {
  resultStatus: 'sent' | 'failed' | 'skipped' | 'suppressed';
  errorCode?: string | null;
  attemptCountAfter: number;
  maxAttempts: number;
  now: Date;
}): { status: NotificationDeliveryStatus; nextAttemptAt?: Date } {
  if (input.resultStatus !== 'failed') return { status: input.resultStatus };
  const canRetry = isRetryableDeliveryError(input.errorCode) && input.attemptCountAfter < input.maxAttempts;
  if (!canRetry) return { status: 'failed' };
  return { status: 'queued', nextAttemptAt: computeDeliveryBackoffAt(input.attemptCountAfter, input.now) };
}

// ---- Period boundaries ----

export function getPeriodBoundaries(
  kind: 'today' | 'week' | 'month' | 'quarter' | 'last_month' | 'custom',
  now: Date,
  timezone: string = 'Asia/Bangkok',
  customStart?: Date,
  customEnd?: Date,
): { periodStart: Date; periodEnd: Date } {
  if (kind === 'custom' && customStart && customEnd) {
    return { periodStart: customStart, periodEnd: customEnd };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = Number(parts.find((part) => part.type === 'year')!.value);
  const m = Number(parts.find((part) => part.type === 'month')!.value);
  const d = Number(parts.find((part) => part.type === 'day')!.value);
  const bangkokMidnight = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day, -7));
  const inclusiveEnd = (exclusiveEnd: Date) => new Date(exclusiveEnd.getTime() - 1);
  const startOfDay = bangkokMidnight(y, m, d);
  const endOfDay = inclusiveEnd(bangkokMidnight(y, m, d + 1));

  if (kind === 'today') {
    return { periodStart: startOfDay, periodEnd: endOfDay };
  }
  if (kind === 'week') {
    // Repo conventions differ intentionally: dashboard Mon-Sun Bangkok, bookings Sunday-anchored, brief trailing 7 days.
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const monday = bangkokMidnight(y, m, d - ((day + 6) % 7));
    return { periodStart: monday, periodEnd: inclusiveEnd(new Date(monday.getTime() + 7 * 86_400_000)) };
  }
  if (kind === 'month') {
    return { periodStart: bangkokMidnight(y, m, 1), periodEnd: inclusiveEnd(bangkokMidnight(y, m + 1, 1)) };
  }
  if (kind === 'quarter') {
    const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
    return { periodStart: bangkokMidnight(y, startMonth, 1), periodEnd: inclusiveEnd(bangkokMidnight(y, startMonth + 3, 1)) };
  }
  if (kind === 'last_month') {
    return { periodStart: bangkokMidnight(y, m - 1, 1), periodEnd: inclusiveEnd(bangkokMidnight(y, m, 1)) };
  }
  return { periodStart: startOfDay, periodEnd: endOfDay };
}
