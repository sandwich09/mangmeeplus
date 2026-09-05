import { Inject, Injectable } from '@nestjs/common';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { webLink } from '../../../common/http/web-link';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { CreateOrUpdateNotificationEventUseCase } from '../../dashboard-notifications/application/use-cases/notification.use-cases';
import { pushSystemLineMessage } from '../../auth/infrastructure/system-line-push';

/**
 * Spec §4C: a new application reaches the System Admin queue immediately, so the operators have to
 * hear about it. Reserved for the signup drain — the generic workflow drain must exclude it.
 */
export const SIGNUP_PENDING_REVIEW_EVENT_TYPE = 'notify.signup_pending_review.requested';

/** The admin queue route (`apps/web/app/system/signup-requests/page.tsx`). */
export const SIGNUP_QUEUE_PATH = '/system/signup-requests';

/** Not in `IMPLEMENTED_TRIGGER_KEYS` on purpose — see `notify()`. */
const SIGNUP_PENDING_REVIEW_TRIGGER = 'signup_pending_review';

/** Owner copy. No plus sign anywhere in user-facing text: write "และ". */
export function signupPendingReviewMessage(companyName: string): string {
  return `มีคำขอสมัครใหม่: ${companyName} — เปิดคิวเพื่ออนุมัติ`;
}

@Injectable()
export class SignupAdminNotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: PrismaOutboxRepository,
    private readonly notifications: CreateOrUpdateNotificationEventUseCase,
    private readonly config: AppConfigService,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  /**
   * Called from the public submit path. It appends one row to the outbox in the same database the
   * request itself lives in and returns — a dead LINE OA, a dead notification rail or a slow push
   * can never reach the applicant's HTTP response.
   *
   * The key is the request id alone, so a re-submitted (replayed) application queues no second
   * announcement.
   */
  async enqueue(signupRequestId: string, now = new Date()): Promise<void> {
    await this.outbox.append({
      eventType: SIGNUP_PENDING_REVIEW_EVENT_TYPE,
      aggregateType: 'CompanySignupRequest',
      aggregateId: signupRequestId,
      eventKey: `notify:signup_pending_review:${signupRequestId}`,
      priority: 'HIGH',
      payloadJson: {
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        data: { signupRequestId },
      },
    });
  }

  /**
   * Consumer, driven by the signup outbox drain.
   *
   * Idempotency has one source: `CreateOrUpdateNotificationEventUseCase` dedupes on its own key and
   * answers `skipped` while the alert is cooling down. A redelivered event (lease reclaim, retry
   * after a partial failure) therefore creates no second dashboard row AND sends no second push,
   * because the LINE fan-out only runs when that call actually opened the notification.
   */
  async notify(signupRequestId: string): Promise<void> {
    const request = await this.prisma.client.companySignupRequest.findUnique({
      where: { id: signupRequestId },
      select: { id: true, state: true, companyName: true },
    });
    if (!request) throw new Error('signup_request_not_found');
    // Approved, rejected or withdrawn before the drain ran: the queue no longer needs announcing.
    if (request.state !== 'PENDING_REVIEW') return;

    const admins = await this.activeSystemAdmins();
    if (admins.length === 0) return;

    const message = signupPendingReviewMessage(request.companyName);
    let opened = false;
    // Grouped by company because the notification rail is company-scoped; in practice every system
    // admin sits in the one WatchDog System company, so this is a single call.
    for (const [companyId, userIds] of groupByCompany(admins)) {
      const result = await this.notifications.execute({
        companyId,
        triggerKey: SIGNUP_PENDING_REVIEW_TRIGGER,
        sourceModule: 'external_signup',
        sourceType: 'company_signup_request',
        sourceId: request.id,
        severity: 'action',
        title: `มีคำขอสมัครใหม่: ${request.companyName}`,
        body: 'เปิดคิวเพื่ออนุมัติ',
        deepLinkHref: SIGNUP_QUEUE_PATH,
        recipientUserIds: userIds,
      });
      if (!result.skipped) opened = true;
    }
    if (!opened) return;

    // The rail's own LINE channel stays suppressed for this trigger (the preference gate defaults to
    // IMPLEMENTED_TRIGGER_KEYS, which deliberately omits it), so this is the only push that goes out.
    await this.pushToLinkedAdmins(admins.map((admin) => admin.userId), `${message}\n${webLink(SIGNUP_QUEUE_PATH)}`);
  }

  /**
   * Public because it is also the answer to "who is the operator of record" for an application no
   * admin touched: an AUTO_FREE provisioning still has to name a real user in the onboarding run
   * and its audit rows, both of which are foreign keys. Ordered so that answer is stable.
   */
  async activeSystemAdmins(): Promise<Array<{ companyId: string; userId: string }>> {
    return this.prisma.client.companyMembership.findMany({
      where: {
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        roles: { some: { role: { key: 'SYSTEM_ADMIN' } } },
      },
      orderBy: { userId: 'asc' },
      select: { companyId: true, userId: true },
    });
  }

  /** Best-effort by contract: a LINE outage is logged, never thrown back into the drain. */
  private async pushToLinkedAdmins(userIds: string[], text: string): Promise<void> {
    const token = this.config.lineMessagingChannelAccessToken;
    if (!token) return;
    const identities = await this.prisma.client.externalIdentity.findMany({
      where: { userId: { in: userIds }, provider: 'LINE', status: 'ACTIVE' },
      select: { providerUserId: true },
    });
    // One admin may hold more than one identity row; the operator wants one message, not two.
    for (const providerUserId of new Set(identities.map((identity) => identity.providerUserId))) {
      const delivered = await pushSystemLineMessage(token, providerUserId, text);
      if (!delivered) {
        this.logger.warn(
          { event: 'signup.pending_review.line_push_failed', riskLevel: 'LOW' },
          'signup.pending_review.line_push_failed',
        );
      }
    }
  }
}

function groupByCompany(rows: Array<{ companyId: string; userId: string }>): Map<string, string[]> {
  const byCompany = new Map<string, string[]>();
  for (const row of rows) {
    const existing = byCompany.get(row.companyId);
    if (existing) existing.push(row.userId);
    else byCompany.set(row.companyId, [row.userId]);
  }
  return byCompany;
}
