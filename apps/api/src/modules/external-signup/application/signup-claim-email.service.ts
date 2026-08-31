import { Inject, Injectable } from '@nestjs/common';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { AUTH_MAILER_TOKEN, type AuthMailerPort } from '../../auth/domain/ports/auth-mailer.port';
import { AccountClaimTokenService } from './account-claim-token.service';
import { CLAIM_REMINDER_AFTER_HOURS } from '../domain/account-claim.logic';

/** P11 F-EM-2. Reserved for this consumer: the generic workflow drain must exclude it. */
export const ACCOUNT_CLAIM_EMAIL_EVENT_TYPE = 'email.account_claim.requested';
export const SIGNUP_REJECTION_NOTICE_EVENT_TYPE = 'email.signup_rejected.requested';
const CLAIM_EMAIL_WORKER_ID = 'signup-claim-email-worker';

/** Why an email is being queued. Only `approve` uses the spec's bare dedupe key. */
export type ClaimEmailReason = 'approve' | 'resend' | 'reissue' | 'reminder';

export type ClaimEmailDrainResult = {
  claimed: number;
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

  /** Spec §4D: an optional, per-case rejection notice. Body deliberately reveals no reason. */
  async enqueueRejectionNotice(signupRequestId: string, now = new Date()): Promise<void> {
    await this.outbox.append({
      eventType: SIGNUP_REJECTION_NOTICE_EVENT_TYPE,
      aggregateType: 'CompanySignupRequest',
      aggregateId: signupRequestId,
      eventKey: `email:signup_rejected:${signupRequestId}`,
      priority: 'NORMAL',
      payloadJson: {
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        data: { signupRequestId },
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
      eventTypes: [ACCOUNT_CLAIM_EMAIL_EVENT_TYPE],
    });

    let sent = 0;
    let failed = 0;
    for (const event of events) {
      const signupRequestId = readSignupRequestId(event.payloadJson);
      try {
        if (!signupRequestId) throw new Error('missing_signup_request_id');
        await this.sendClaimEmail(signupRequestId);
        sent += 1;
        await this.settle(event.id, event.claimToken ?? null, null);
      } catch (error) {
        failed += 1;
        const code = errorCode(error);
        this.logger.error({
          event: 'signup.claim_email.send_failed',
          riskLevel: 'HIGH',
          signupRequestId,
          outboxEventId: event.id,
          errorCode: code,
        }, 'signup.claim_email.send_failed');
        await this.settle(event.id, event.claimToken ?? null, code);
      }
    }
    return { claimed: events.length, sent, failed, reclaimed, dead };
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

  private async sendClaimEmail(signupRequestId: string): Promise<void> {
    const request = await this.prisma.client.companySignupRequest.findUnique({
      where: { id: signupRequestId },
      select: { id: true, state: true, contactEmail: true, companyName: true },
    });
    if (!request) throw new Error('signup_request_not_found');
    // A request that moved on (claimed, rejected, suspended) must not receive a stale link.
    if (request.state !== 'EMAIL_PENDING') return;

    const { rawToken, expiresAt } = await this.tokens.mint(request.id);
    const messageId = await this.mailer.sendAccountClaim({
      toEmail: request.contactEmail,
      companyName: request.companyName,
      rawToken,
      expiresAt,
      lineOaAddUrl: officialLineOaAddUrl(),
    });
    // Only after a successful send: this timestamp is what the reminder sweep counts from, and the
    // SES message id is the only handle a later bounce/complaint event has on this row (spec §4D).
    await this.prisma.client.companySignupRequest.update({
      where: { id: request.id },
      data: { claimEmailLastSentAt: new Date(), claimEmailSesMessageId: messageId },
    });
  }

  /** A lost lease means another claimer owns the row; log it, never throw (P0-4). */
  private async settle(id: string, claimToken: string | null, errorCode: string | null): Promise<void> {
    const written = errorCode
      ? await this.outbox.markFailed({
        id, claimToken, error: errorCode, expectedEventType: ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
      })
      : await this.outbox.markPublished({
        id, claimToken, expectedEventType: ACCOUNT_CLAIM_EMAIL_EVENT_TYPE,
      });
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

/**
 * Central OA add-friend link. Read from the environment rather than the shared config schema: it is
 * a public URL with a safe empty default, and an unset value simply drops one line from the email
 * instead of blocking the only message an approved applicant receives.
 */
export function officialLineOaAddUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.LINE_OA_ADD_URL?.trim() ?? '';
}

function readSignupRequestId(payload: Record<string, unknown>): string | null {
  const data = payload?.data;
  if (!data || typeof data !== 'object') return null;
  const value = (data as Record<string, unknown>).signupRequestId;
  return typeof value === 'string' && value ? value : null;
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 160) || 'claim_email_failed';
}
