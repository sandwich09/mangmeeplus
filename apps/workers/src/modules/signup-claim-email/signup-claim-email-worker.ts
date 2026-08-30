import type { Worker } from 'bullmq';
import { startScanWorker } from '../../common/scan-worker.js';

/**
 * P10/P11 Flow B claim email. Two timers, both pointed at API-side endpoints: the send itself has
 * to run there, where the mailer adapter and its SES client live (mint-at-send, P11 F-EM-3).
 *
 * Drain every 30s so an approved applicant gets their only email promptly.
 */
export const SIGNUP_CLAIM_EMAIL_DRAIN_OPTIONS = {
  queueName: 'signup-claim-email',
  kind: 'signup-claim-email-drain',
  jobId: 'signup-claim-email-drain',
  intervalMs: 30_000,
  path: '/internal/signup-claim-email/drain',
  failEvent: 'signup_claim_email_drain_failed',
} as const;

/**
 * Reminder sweep every 15 min (spec §4D ①). The window it looks for is 24h wide, so the exact
 * cadence is not load-bearing — it only has to be finer than the window.
 */
export const SIGNUP_CLAIM_REMINDER_OPTIONS = {
  queueName: 'signup-claim-reminder',
  kind: 'signup-claim-reminder-sweep',
  jobId: 'signup-claim-reminder-sweep',
  intervalMs: 15 * 60_000,
  path: '/internal/signup-claim-email/reminder-sweep',
  failEvent: 'signup_claim_reminder_sweep_failed',
} as const;

export function startSignupClaimEmailWorker(redisUrl: string): Worker {
  return startScanWorker({ ...SIGNUP_CLAIM_EMAIL_DRAIN_OPTIONS, redisUrl });
}

export function startSignupClaimReminderWorker(redisUrl: string): Worker {
  return startScanWorker({ ...SIGNUP_CLAIM_REMINDER_OPTIONS, redisUrl });
}
