import { Inject, Injectable } from '@nestjs/common';
import { SIGNUP_REJECTION_REASON_MAX_LENGTH } from '@watchdog-bms/contracts';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { AUTH_MAILER_TOKEN, type AuthMailerPort } from '../../auth/domain/ports/auth-mailer.port';
import { AccountClaimTokenService } from './account-claim-token.service';
import { CompanySignupCoreService } from './company-signup-core.service';
import { SIGNUP_PENDING_REVIEW_EVENT_TYPE, SignupAdminNotifyService } from './signup-admin-notify.service';
import {
  LINE_SIGNUP_PUSH_EVENT_TYPE, LINE_SUPPORT_NOTICE_EVENT_TYPE, LinePushThrottledError,
  LineSignupNotifyService, type LineSignupPushKind,
} from './line-signup-notify.service';
import { CLAIM_EXPIRY_AFTER_APPROVAL_DAYS, CLAIM_REMINDER_AFTER_HOURS } from '../domain/account-claim.logic';

/** P11 F-EM-2. Reserved for this consumer: the generic workflow drain must exclude it. */
export const ACCOUNT_CLAIM_EMAIL_EVENT_TYPE = 'email.account_claim.requested';
export const SIGNUP_REJECTION_NOTICE_EVENT_TYPE = 'email.signup_rejected.requested';
const CLAIM_EMAIL_WORKER_ID = 'signup-claim-email-worker';

/**
 * Every signup side effect this drain owns. One claim, one lease, one settle path — a second timer
 * would buy nothing but a second thing to forget to deploy. Anything listed here must also be
 * excluded from the generic workflow drain, or that drain claims it and "publishes" it into a void.
 */
const SIGNUP_OUTBOX_EVENT_TYPES = [
  ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
  SIGNUP_REJECTION_NOTICE_EVENT_TYPE,
  SIGNUP_PENDING_REVIEW_EVENT_TYPE,
  // P10-L: the LINE pushes ride the same lease, timer and settle path. A second drain would buy
  // nothing but a second thing to forget to deploy.
  LINE_SIGNUP_PUSH_EVENT_TYPE,
  LINE_SUPPORT_NOTICE_EVENT_TYPE,
] as const;

/** Reason recorded on the state row when the 30-day sweep parks an unclaimed approval (§4D ④). */
export const CLAIM_EXPIRY_FAILURE_CODE = 'claim_not_started';
const EXPIRY_SWEEP_ACTOR = 'signup-expiry-sweep';

/** Why an email is being queued. Only `approve` uses the spec's bare dedupe key. */
export type ClaimEmailReason = 'approve' | 'resend' | 'reissue' | 'reminder';

export type ClaimEmailDrainResult = {
  claimed: number;
  /** Events handled, not emails: the same counter covers the admin announcement's fan-out. */
  sent: number;
  failed: number;
  reclaimed: number;
  dead: number;
};

@Injectable()
export class SignupClaimEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: PrismaOutboxRepository,
    private readonly tokens: AccountClaimTokenService,
    private readonly core: CompanySignupCoreService,
    private readonly adminNotify: SignupAdminNotifyService,
    private readonly lineNotify: LineSignupNotifyService,
    @Inject(AUTH_MAILER_TOKEN) private readonly mailer: AuthMailerPort,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  /**
   * Queues the single Flow B email. The payload carries the request id and nothing else — no token,
   * no address, no company name (P11 F-EM-3 mint-at-send; evidence stays PII-free).
   *
   * The dedupe key differs by reason on purpose:
   *  - `approve` uses the spec's `email:claim:<id>`, so repeating the approve decision cannot queue
   *    a second email;
   *  - `reminder` uses a fixed `:reminder` suffix, which makes the one reminder exactly-once at the
   *    database level rather than only through the `claimReminderSentAt` flag;
   *  - `resend`/`reissue` add a minute bucket, so an impatient double-click collapses into one send
   *    while a genuine request a minute later still goes out.
   */
  async enqueue(signupRequestId: string, reason: ClaimEmailReason, now = new Date()): Promise<void> {
    await this.outbox.append({
      eventType: ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
      aggregateType: 'CompanySignupRequest',
      aggregateId: signupRequestId,
      eventKey: claimEmailEventKey(signupRequestId, reason, now),
      priority: 'HIGH',
      payloadJson: {
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        data: { signupRequestId, reminder: reason === 'reminder' },
      },
    });
  }

  /**
   * Spec §4D: an optional, per-case rejection notice. The letter never discloses the internal
   * review reason — `reason` is the admin's own paragraph, written for the applicant to read, and
   * it rides in the payload because it is the one thing the consumer cannot look up.
   */
  async enqueueRejectionNotice(signupRequestId: string, reason?: string, now = new Date()): Promise<void> {
    const trimmed = reason?.trim().slice(0, SIGNUP_REJECTION_REASON_MAX_LENGTH) || undefined;
    await this.outbox.append({
      eventType: SIGNUP_REJECTION_NOTICE_EVENT_TYPE,
      aggregateType: 'CompanySignupRequest',
      aggregateId: signupRequestId,
      eventKey: `email:signup_rejected:${signupRequestId}`,
      priority: 'NORMAL',
      payloadJson: {
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        data: { signupRequestId, ...(trimmed ? { reason: trimmed } : {}) },
      },
    });
  }

  /**
   * Consumer. Runs API-side rather than in the workers process because the mailer adapter, its SES
   * client and its config all live in this Nest container; the worker is the timer that pokes it.
   */
  async drain(batchSize = 10): Promise<ClaimEmailDrainResult> {
    const { reclaimed, dead } = await this.outbox.reclaimStalledProcessing();
    const events = await this.outbox.claimBatch({
      batchSize,
      claimedBy: CLAIM_EMAIL_WORKER_ID,
      eventTypes: [...SIGNUP_OUTBOX_EVENT_TYPES],
    });

    let sent = 0;
    let failed = 0;
    for (const event of events) {
      const signupRequestId = readSignupRequestId(event.payloadJson);
      try {
        // A support alert belongs to a PERSON, not to an application — it may have no signup row at
        // all (an unlinked stranger asking for help), so it is dispatched before the id check.
        if (event.eventType === LINE_SUPPORT_NOTICE_EVENT_TYPE) {
          await this.lineNotify.deliverSupportNotice(readPayloadString(event.payloadJson, 'companyId'));
        } else {
          if (!signupRequestId) throw new Error('missing_signup_request_id');
          await this.handle(event.eventType, signupRequestId, event.payloadJson);
        }
        sent += 1;
        await this.settle(event.id, event.claimToken ?? null, event.eventType, null);
      } catch (error) {
        failed += 1;
        const code = errorCode(error);
        this.logger.error({
          event: 'signup.claim_email.send_failed',
          riskLevel: 'HIGH',
          eventType: event.eventType,
          signupRequestId,
          outboxEventId: event.id,
          errorCode: code,
        }, 'signup.claim_email.send_failed');
        await this.settle(event.id, event.claimToken ?? null, event.eventType, code, error);
      }
    }
    return { claimed: events.length, sent, failed, reclaimed, dead };
  }

  /** Dispatch by event type. An unknown type throws, so it fails loudly instead of silently. */
  private async handle(
    eventType: string,
    signupRequestId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (eventType === ACCOUNT_CLAIM_EMAIL_EVENT_TYPE) return this.sendClaimEmail(signupRequestId);
    if (eventType === SIGNUP_REJECTION_NOTICE_EVENT_TYPE) {
      return this.sendRejectionEmail(signupRequestId, readRejectionReason(payload));
    }
    if (eventType === SIGNUP_PENDING_REVIEW_EVENT_TYPE) return this.adminNotify.notify(signupRequestId);
    if (eventType === LINE_SIGNUP_PUSH_EVENT_TYPE) {
      const kind = readPayloadString(payload, 'kind');
      if (!kind) throw new Error('missing_line_push_kind');
      return this.lineNotify.deliver(signupRequestId, kind as LineSignupPushKind);
    }
    throw new Error(`unhandled_signup_event_type:${eventType}`);
  }

  /**
   * Spec §4D ①: one reminder per request, 24h before the link dies. `claimReminderSentAt` is set
   * with a CAS on its own null value, so two concurrent sweeps still queue exactly one reminder.
   */
  async sweepReminders(now = new Date()): Promise<{ queued: number }> {
    const cutoff = new Date(now.getTime() - CLAIM_REMINDER_AFTER_HOURS * 3_600_000);
    const due = await this.prisma.client.companySignupRequest.findMany({
      where: {
        state: 'EMAIL_PENDING',
        claimReminderSentAt: null,
        claimEmailLastSentAt: { not: null, lt: cutoff },
      },
      select: { id: true },
      take: 100,
    });

    let queued = 0;
    for (const request of due) {
      const marked = await this.prisma.client.companySignupRequest.updateMany({
        where: { id: request.id, claimReminderSentAt: null },
        data: { claimReminderSentAt: now },
      });
      if (marked.count !== 1) continue;
      await this.enqueue(request.id, 'reminder', now);
      queued += 1;
    }
    return { queued };
  }

  /**
   * Spec §4D ④: an approval nobody acted on goes quiet after 30 days and leaves the main queue.
   * It is a park, not a dead end — `EXPIRED` keeps its one transition back to `EMAIL_PENDING`, and
   * the admin reissue path has no age limit at all.
   *
   * Idempotent and bounded: the transition runs through the core's advisory lock and version CAS, a
   * row already `EXPIRED` is a replay, and one pass never moves more than `take`. A row that raced
   * another writer is skipped rather than aborting the batch.
   */
  async sweepExpiredApprovals(now = new Date(), take = 100): Promise<{ expired: number }> {
    const cutoff = new Date(now.getTime() - CLAIM_EXPIRY_AFTER_APPROVAL_DAYS * 86_400_000);
    const due = await this.prisma.client.companySignupRequest.findMany({
      where: {
        state: { in: ['EMAIL_PENDING', 'EMAIL_FAILED'] },
        approvedAt: { not: null, lt: cutoff },
      },
      select: { id: true },
      take,
    });

    let expired = 0;
    for (const request of due) {
      try {
        const { replayed } = await this.core.advance(
          request.id, 'EXPIRED', EXPIRY_SWEEP_ACTOR, CLAIM_EXPIRY_FAILURE_CODE,
        );
        if (!replayed) expired += 1;
      } catch (error) {
        // A concurrent claim or reissue won the row. Nothing to fix: the next sweep re-reads state.
        this.logger.warn({
          event: 'signup.claim_expiry.skipped',
          signupRequestId: request.id,
          errorCode: errorCode(error),
        }, 'signup.claim_expiry.skipped');
      }
    }
    return { expired };
  }

  /**
   * Spec §4D: the opt-in rejection notice. Deliberately does NOT touch state — the request is
   * already `REJECTED` and a bounced or refused notice must never undo that decision. A failure
   * here surfaces as the drain's log line and a FAILED outbox row, nothing else.
   */
  private async sendRejectionEmail(signupRequestId: string, reason?: string): Promise<void> {
    const request = await this.prisma.client.companySignupRequest.findUnique({
      where: { id: signupRequestId },
      select: { state: true, contactEmail: true, companyName: true },
    });
    if (!request) throw new Error('signup_request_not_found');
    // Only a rejection may produce a rejection letter; a revived request must not receive one.
    if (request.state !== 'REJECTED') return;
    // P10-L: a LINE application has no address. Its rejection is a LINE push, not a letter, so
    // there is nothing to send here and nothing to retry — returning is the whole handling.
    if (!request.contactEmail) return;

    await this.mailer.sendSignupRejection({
      toEmail: request.contactEmail,
      companyName: request.companyName,
      ...(reason ? { reason } : {}),
    });
  }

  private async sendClaimEmail(signupRequestId: string): Promise<void> {
    const request = await this.prisma.client.companySignupRequest.findUnique({
      where: { id: signupRequestId },
      select: { id: true, state: true, contactEmail: true, companyName: true },
    });
    if (!request) throw new Error('signup_request_not_found');
    // A request that moved on (claimed, rejected, suspended) must not receive a stale link.
    if (request.state !== 'EMAIL_PENDING') return;
    // Belt and braces: a `line-oa` application can never reach EMAIL_PENDING (its transition table
    // has no EMAIL_* edge), so an addressless row here would be a bug — mint no token for it.
    if (!request.contactEmail) return;

    const { rawToken, expiresAt } = await this.tokens.mint(request.id);
    const messageId = await this.mailer.sendAccountClaim({
      toEmail: request.contactEmail,
      companyName: request.companyName,
      rawToken,
      expiresAt,
    });
    // Only after a successful send: this timestamp is what the reminder sweep counts from, and the
    // SES message id is the only handle a later bounce/complaint event has on this row (spec §4D).
    await this.prisma.client.companySignupRequest.update({
      where: { id: request.id },
      data: { claimEmailLastSentAt: new Date(), claimEmailSesMessageId: messageId },
    });
  }

  /** A lost lease means another claimer owns the row; log it, never throw (P0-4). */
  private async settle(
    id: string,
    claimToken: string | null,
    expectedEventType: string,
    errorCode: string | null,
    error?: unknown,
  ): Promise<void> {
    // G-07: LINE answering "not now, come back in N seconds" is a schedule, not a failure. Honour
    // it, and do not spend one of the row's five attempts — the OA's monthly quota resets on its
    // own timescale, and the default 2^n ladder would DEAD the "your shop is ready" push in about
    // two minutes for a condition nothing was wrong with.
    const throttle = error instanceof LinePushThrottledError ? error : null;
    const written = errorCode
      ? await this.outbox.markFailed({
        id,
        claimToken,
        error: errorCode,
        expectedEventType,
        ...(throttle ? {
          nextAvailableAt: new Date(Date.now() + throttle.retryAfterSeconds * 1000),
          countsTowardMax: false,
        } : {}),
      })
      : await this.outbox.markPublished({ id, claimToken, expectedEventType });
    if (!written) {
      this.logger.warn({ event: 'signup.claim_email.lost_lease', outboxEventId: id }, 'signup.claim_email.lost_lease');
    }
  }
}

export function claimEmailEventKey(signupRequestId: string, reason: ClaimEmailReason, now: Date): string {
  const base = `email:claim:${signupRequestId}`;
  if (reason === 'approve') return base;
  if (reason === 'reminder') return `${base}:reminder`;
  return `${base}:${reason}:${Math.floor(now.getTime() / 60_000)}`;
}

function readSignupRequestId(payload: Record<string, unknown>): string | null {
  return readPayloadString(payload, 'signupRequestId');
}

function readRejectionReason(payload: Record<string, unknown>): string | undefined {
  return readPayloadString(payload, 'reason') ?? undefined;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const data = payload?.data;
  if (!data || typeof data !== 'object') return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : null;
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 160) || 'claim_email_failed';
}
