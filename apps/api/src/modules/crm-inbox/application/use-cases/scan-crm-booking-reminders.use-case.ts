import { Injectable, Logger } from '@nestjs/common';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';
import { bookingReminderText, formatBookingWhen } from '../../../crm/domain/logic/crm-booking.logic';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { LineMessagingAdapter } from '../../infrastructure/line-messaging.adapter';
import type { LinePushResult } from '../../infrastructure/line-messaging.adapter';
import { MessagingChannelSecretsService } from './messaging-channel.use-case';
import {
  BOOKING_REMINDER_CLAIM_STALE_MS,
  BOOKING_REMINDER_LEAD_MS,
  BOOKING_REMINDER_MAX_ATTEMPTS,
  BOOKING_REMINDER_SCAN_LIMIT,
  BOOKING_TIMEZONE,
} from '../../domain/crm-inbox.constants';
import { computeReplySendBackoffAt, lineReplyRetryKeyForMessage, resolveReplySendOutcome } from '../../domain/logic/crm-inbox.logic';

/**
 * A7 appointment reminder sweep. A leased DB claim prevents overlap; failures release
 * with backoff, and a stable LINE retry key makes crash recovery idempotent.
 */
@Injectable()
export class ScanCrmBookingRemindersUseCase {
  private readonly logger = new Logger(ScanCrmBookingRemindersUseCase.name);

  constructor(
    private readonly crmRepo: PrismaCrmRepository,
    private readonly repo: PrismaCrmInboxRepository,
    private readonly secrets: MessagingChannelSecretsService,
    private readonly line: LineMessagingAdapter,
    private readonly createNotification: CreateOrUpdateNotificationEventUseCase,
  ) {}

  async execute(limit = BOOKING_REMINDER_SCAN_LIMIT): Promise<{ due: number; reminded: number; pushed: number }> {
    const now = new Date();
    const due = await this.crmRepo.findDueBookingReminders(
      now,
      BOOKING_REMINDER_LEAD_MS,
      limit,
      BOOKING_REMINDER_CLAIM_STALE_MS,
      BOOKING_REMINDER_MAX_ATTEMPTS,
    );
    let reminded = 0;
    let pushed = 0;
    for (const b of due) {
      if (!(await this.crmRepo.claimBookingReminder(b.id, now, BOOKING_REMINDER_CLAIM_STALE_MS, BOOKING_REMINDER_MAX_ATTEMPTS))) continue;
      reminded += 1;
      let push: LinePushResult | null = null;
      let failure: string | null = null;
      try {
        if (b.customerId) push = await this.pushToCustomer(b.id, b.companyId, b.customerId, b.serviceName, b.startAt);
        if (push?.ok) pushed += 1;
      } catch (error) {
        failure = 'line_api_unreachable';
        this.logger.warn({ msg: 'booking reminder customer push failed', bookingId: b.id, error: (error as Error).message });
      }
      try {
        await this.notifyStaff(b);
      } catch (error) {
        failure = failure ?? 'staff_notification_failed';
        this.logger.warn({ msg: 'booking reminder staff notify failed', bookingId: b.id, error: (error as Error).message });
      }
      if (push && !push.ok) failure = push.error;

      const attemptCountAfter = (b.reminderAttemptCount ?? 0) + 1;
      const lineOutcome = failure && failure !== 'staff_notification_failed'
        ? resolveReplySendOutcome({
            ok: false,
            error: failure,
            retryAfterSeconds: push && !push.ok ? push.retryAfterSeconds : undefined,
            attemptCountAfter,
            maxAttempts: BOOKING_REMINDER_MAX_ATTEMPTS,
            now,
          })
        : null;
      const nextAttemptAt = failure === 'staff_notification_failed'
        ? computeReplySendBackoffAt(attemptCountAfter, now)
        : lineOutcome?.status === 'PENDING'
          ? lineOutcome.nextAttemptAt
          : undefined;
      if (failure && nextAttemptAt && nextAttemptAt < b.startAt) {
        await this.crmRepo.releaseBookingReminderForRetry(b.id, now, nextAttemptAt, failure);
      } else {
        await this.crmRepo.completeBookingReminder(b.id, now, new Date(), failure ?? undefined);
      }
    }
    return { due: due.length, reminded, pushed };
  }

  private async pushToCustomer(
    bookingId: string,
    companyId: string,
    customerId: string,
    serviceName: string,
    startAt: Date,
  ): Promise<LinePushResult | null> {
    const push = await this.repo.withLiveCustomerLock(
      { companyId, customerId },
      async (identity, consentStatus) => {
        if (consentStatus === 'REVOKED') return null;
        const channel = await this.repo.findChannelById(companyId, identity.channelId);
        if (!channel || channel.status === 'DISABLED') return null;
        return this.line.pushTextMessage(
          this.secrets.decrypt(channel).accessToken,
          identity.providerUserId,
          bookingReminderText(serviceName, startAt, BOOKING_TIMEZONE),
          lineReplyRetryKeyForMessage(`booking-reminder:${bookingId}`),
        );
      },
    );
    return push ?? null;
  }

  private async notifyStaff(b: { id: string; companyId: string; customerId: string; customerName?: string; serviceName: string; startAt: Date; staffUserId?: string }): Promise<void> {
    await this.repo.withLiveCustomerDataLock(
      { companyId: b.companyId, customerId: b.customerId },
      async () => {
        const recipients = new Set(await this.repo.findInboxManagerUserIds(b.companyId));
        if (b.staffUserId) recipients.add(b.staffUserId);
        if (recipients.size === 0) return;
        let name = b.customerName ?? 'ลูกค้า';
        const names = await this.repo.findCustomerDisplayNames(b.companyId, [b.customerId]);
        name = names.get(b.customerId) ?? name;
        const href = `/companies/${b.companyId}/bookings`;
        await this.createNotification.execute({
          companyId: b.companyId,
          triggerKey: 'crm_booking_reminder',
          sourceModule: 'crm_inbox',
          sourceType: 'crm_booking',
          sourceId: b.id,
          severity: 'action',
          title: `นัดหมายใกล้ถึง: ${name}`,
          body: `${b.serviceName} เวลา ${formatBookingWhen(b.startAt, BOOKING_TIMEZONE)} น.`,
          deepLinkHref: href,
          sourceRefs: [{ module: 'crm_inbox', sourceType: 'crm_booking', sourceId: b.id, label: name, href, permissionKey: 'crm.booking.read' }],
          recipientUserIds: [...recipients],
        });
      },
    );
  }
}
