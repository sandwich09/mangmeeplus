import { isVirtualDemoTarget } from '@watchdog-bms/contracts';
import { finishDocumentWaitingNotifications } from '../../infrastructure/document-notification-state';
import { reimbursementApprovalButtons, reimbursementPaymentButton } from '../../../line-ai/domain/logic/line-reimbursement-approval-control.logic';
import { LineMessagingCredentialsService } from '../../../../common/config/line-messaging-credentials.service';
import { lineMessagePreview } from '../../../line-ai/domain/logic/line-message-preview.logic';
import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaNotificationEventRepository } from '../../infrastructure/prisma-notification.repository';
import { PrismaNotificationRecipientRepository } from '../../infrastructure/prisma-notification.repository';
import { PrismaNotificationDeliveryRepository } from '../../infrastructure/prisma-notification.repository';
import { PrismaNotificationPreferenceRepository } from '../../infrastructure/prisma-notification.repository';
import { PrismaNotificationRuleRepository } from '../../infrastructure/prisma-notification.repository';
import { PrismaAlertStateRepository } from '../../infrastructure/prisma-notification.repository';
import { buildDedupKey, isInCooldown, computeCooldownUntil, isImplementedTrigger, isRetryable, isInQuietHours, resolveDeliveryOutcome, notificationSourceHref } from '../../domain/logic/notification.logic';
import type { NotificationSummaryDto, NotificationPreferenceDto, NotificationRuleDto, UnreadCountDto, UpdatePreferenceDto, UpdateRuleDto } from '@watchdog-bms/contracts';
import { withLineExternalBrowserLinks } from '@watchdog-bms/contracts';
import { ALWAYS_DELIVERED_TRIGGER_KEYS, IMPLEMENTED_TRIGGER_KEYS, MAX_DELIVERY_ATTEMPTS, DEFAULT_ENABLED_CHANNELS, DELIVERY_SWEEP_BATCH_LIMIT, notificationRuleDisplayName, isNotificationTriggerEntitled } from '../../domain/models/notification.model';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { Prisma } from '../../../../generated/prisma/client';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { sharedEntitlementLock } from '../../../feature-launch/application/execution-attempt.service';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { GenerateSnapshotUseCase } from './generate-snapshot.use-case';
import { webLink } from '../../../../common/http/web-link';

/** The delivery sweep is `dashboard_notifications` work; the delivery's own company owns it. */
const NOTIFICATION_FEATURE_KEY = 'dashboard_notifications';

// ---- Notification Center Use Cases ----

@Injectable()
export class ListNotificationsUseCase {
  constructor(private readonly events: PrismaNotificationEventRepository) {}
  async execute(ctx: RequestContext, companyId: string, filter: any) {
    if (!ctx.permissions.includes('notification.read')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    const { items, nextCursor } = await this.events.list(companyId, ctx.userId, filter);
    return { items: items.map(toSummary), nextCursor };
  }
}

@Injectable()
export class GetUnreadCountUseCase {
  constructor(private readonly recipients: PrismaNotificationRecipientRepository) {}
  async execute(ctx: RequestContext, companyId: string): Promise<UnreadCountDto> {
    if (!ctx.permissions.includes('notification.read')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    return this.recipients.countUnread(companyId, ctx.userId);
  }
}

@Injectable()
export class MarkReadUseCase {
  constructor(private readonly recipients: PrismaNotificationRecipientRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, companyId: string, notificationId: string) {
    if (!ctx.permissions.includes('notification.read')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    const r = await this.recipients.findByEventAndUser(notificationId, ctx.userId);
    if (!r || r.companyId !== companyId) throw new NotFoundException();
    return this.recipients.update(companyId, r.id, { readAt: new Date() });
  }
}

@Injectable()
export class MarkAllReadUseCase {
  constructor(private readonly recipients: PrismaNotificationRecipientRepository) {}
  async execute(ctx: RequestContext, companyId: string) {
    if (!ctx.permissions.includes('notification.read')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    const count = await this.recipients.markAllRead(companyId, ctx.userId);
    return { count };
  }
}

@Injectable()
export class DismissNotificationUseCase {
  constructor(private readonly recipients: PrismaNotificationRecipientRepository) {}
  async execute(ctx: RequestContext, companyId: string, notificationId: string) {
    if (!ctx.permissions.includes('notification.read')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    const r = await this.recipients.findByEventAndUser(notificationId, ctx.userId);
    if (!r || r.companyId !== companyId) throw new NotFoundException();
    return this.recipients.update(companyId, r.id, { dismissedAt: new Date() });
  }
}

// ---- Preferences Use Cases ----

@Injectable()
export class GetPreferenceUseCase {
  constructor(private readonly prefs: PrismaNotificationPreferenceRepository) {}
  async execute(ctx: RequestContext, companyId: string): Promise<NotificationPreferenceDto> {
    if (!ctx.permissions.includes('notification.preference.manage') && !ctx.permissions.includes('notification.read')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    const pref = await this.prefs.findByUser(companyId, ctx.userId);
    return pref
      ? { userId: ctx.userId, enabledChannels: pref.enabledChannelsJson as any, enabledTriggerKeys: pref.enabledTriggerKeysJson as any, quietHoursStart: pref.quietHoursStart ?? undefined, quietHoursEnd: pref.quietHoursEnd ?? undefined, timezone: pref.timezone, digestFrequency: pref.digestFrequency as any }
      : { userId: ctx.userId, enabledChannels: DEFAULT_ENABLED_CHANNELS as any, enabledTriggerKeys: IMPLEMENTED_TRIGGER_KEYS, timezone: 'Asia/Bangkok', digestFrequency: 'none' };
  }
}

@Injectable()
export class UpdatePreferenceUseCase {
  constructor(private readonly prefs: PrismaNotificationPreferenceRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, companyId: string, dto: UpdatePreferenceDto): Promise<NotificationPreferenceDto> {
    if (!ctx.permissions.includes('notification.preference.manage')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    if (dto.quietHoursStart && !/^\d{2}:\d{2}$/.test(dto.quietHoursStart)) throw new BadRequestException('Invalid quiet hours format');
    if (dto.quietHoursEnd && !/^\d{2}:\d{2}$/.test(dto.quietHoursEnd)) throw new BadRequestException('Invalid quiet hours format');
    const pref = await this.prefs.upsert(companyId, ctx.userId, {
      enabledChannelsJson: dto.enabledChannels as any ?? undefined,
      enabledTriggerKeysJson: dto.enabledTriggerKeys as any ?? undefined,
      quietHoursStart: dto.quietHoursStart,
      quietHoursEnd: dto.quietHoursEnd,
      timezone: dto.timezone,
      digestFrequency: dto.digestFrequency as any,
    });
    await this.audit.log({ companyId, actorUserId: ctx.userId, action: 'notification_preference.update', targetType: 'NotificationPreference', targetId: pref.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { enabledChannels: pref.enabledChannelsJson } });
    return { userId: ctx.userId, enabledChannels: pref.enabledChannelsJson as any, enabledTriggerKeys: pref.enabledTriggerKeysJson as any, quietHoursStart: pref.quietHoursStart ?? undefined, quietHoursEnd: pref.quietHoursEnd ?? undefined, timezone: pref.timezone, digestFrequency: pref.digestFrequency as any };
  }
}

// ---- Rule Use Cases ----

@Injectable()
export class ListRulesUseCase {
  constructor(private readonly rules: PrismaNotificationRuleRepository) {}
  async execute(ctx: RequestContext, companyId: string): Promise<NotificationRuleDto[]> {
    if (!ctx.permissions.includes('notification.rule.manage')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    return (await this.rules.list(companyId)).map(toRuleDto);
  }
}

@Injectable()
export class UpdateRuleUseCase {
  constructor(private readonly rules: PrismaNotificationRuleRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, companyId: string, ruleId: string, dto: UpdateRuleDto): Promise<NotificationRuleDto> {
    if (!ctx.permissions.includes('notification.rule.manage')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    const rule = await this.rules.findById(companyId, ruleId);
    if (!rule) throw new NotFoundException();
    if (dto.status === 'enabled' && !isImplementedTrigger(rule.triggerKey)) {
      throw new BadRequestException(`Trigger ${rule.triggerKey} is not supported yet`);
    }
    const updated = await this.rules.update(companyId, ruleId, { ...dto, updatedByUserId: ctx.userId });
    await this.audit.log({ companyId, actorUserId: ctx.userId, action: 'notification_rule.update', targetType: 'NotificationRule', targetId: ruleId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { triggerKey: rule.triggerKey } });
    return toRuleDto(updated);
  }
}

// ---- Delivery Retry ----

@Injectable()
export class RetryDeliveryUseCase {
  constructor(private readonly deliveries: PrismaNotificationDeliveryRepository, private readonly audit: AuditService) {}
  async execute(ctx: RequestContext, companyId: string, deliveryId: string) {
    if (!ctx.permissions.includes('notification.delivery.retry')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    const delivery = await this.deliveries.findById(companyId, deliveryId);
    if (!delivery) throw new NotFoundException();
    if (!isRetryable(delivery.status, delivery.attemptCount, MAX_DELIVERY_ATTEMPTS)) {
      throw new BadRequestException('Delivery is not retryable');
    }
    const updated = await this.deliveries.retryCompanyDelivery(companyId, deliveryId, delivery.updatedAt);
    if(!updated)throw new BadRequestException({code:'NOTIFICATION_RETRY_REVIEW_REQUIRED',message:'รายการเปลี่ยนแล้วหรือเป็นการแจ้งเตือนแพ็กเกจ กรุณาโหลดใหม่ หรือติดต่อผู้ดูแลการชำระเงินเพื่อตรวจรายการเดิม'});
    await this.audit.log({ companyId, actorUserId: ctx.userId, action: 'notification_delivery.retry', targetType: 'NotificationDelivery', targetId: deliveryId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    return updated;
  }
}

@Injectable()
export class ListDeliveriesUseCase {
  constructor(private readonly deliveries: PrismaNotificationDeliveryRepository) {}
  async execute(ctx: RequestContext, companyId: string, filter: any) {
    if (!ctx.permissions.includes('notification.delivery.read')) throw new ForbiddenException();
    if (ctx.companyId !== companyId) throw new ForbiddenException();
    return this.deliveries.listByCompany(companyId, filter);
  }
}

// ---- Internal Event Creation (used by workers) ----

@Injectable()
export class CreateOrUpdateNotificationEventUseCase {
  constructor(
    private readonly events: PrismaNotificationEventRepository,
    private readonly recipients: PrismaNotificationRecipientRepository,
    private readonly deliveries: PrismaNotificationDeliveryRepository,
    private readonly alertStates: PrismaAlertStateRepository,
    private readonly rules: PrismaNotificationRuleRepository,
    private readonly prisma: PrismaService,
  ) {}

  async finishDocumentWaiting(companyId: string, sourceType: string, sourceId: string) {
    await finishDocumentWaitingNotifications(this.prisma.client, companyId, sourceType, sourceId);
  }

  /** Join a state change to the existing durable event/recipient/delivery queue. No I/O egress. */
  async executeInTransaction(input: Parameters<CreateOrUpdateNotificationEventUseCase['execute']>[0], tx: Prisma.TransactionClient) {
    const key = buildDedupKey(input);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.companyId}:${key}`}, 0))`;
    const prisma = { client: tx } as PrismaService;
    return new CreateOrUpdateNotificationEventUseCase(
      new PrismaNotificationEventRepository(prisma), new PrismaNotificationRecipientRepository(prisma),
      new PrismaNotificationDeliveryRepository(prisma), new PrismaAlertStateRepository(prisma),
      new PrismaNotificationRuleRepository(prisma), prisma,
    ).execute(input);
  }

  async execute(input: {
    companyId: string;
    triggerKey: string;
    sourceModule: string;
    sourceType: string;
    sourceId?: string;
    severity: string;
    title: string;
    body: string;
    deepLinkHref?: string;
    sourceRefs?: unknown[];
    recipientUserIds: string[];
    periodKey?: string;
    /**
     * A newer notice of the same kind about the same record replaces the older ones: they stop
     * showing as current, and a push of theirs still queued is dropped at egress. Off unless asked
     * for, because other producers keep several periods open side by side.
     */
    supersedeEarlier?: boolean;
    /**
     * With `supersedeEarlier`: other kinds of notice about the same record that the new one replaces
     * as well. "Paid" and "payment voided" of one claim name each other here.
     */
    alsoSupersedeTriggerKeys?: readonly string[];
    /** Recipients who get this notice in the web bell only, with no LINE push. Everyone else gets both. */
    webOnlyRecipientUserIds?: string[];
  }) {
    if (!isNotificationTriggerEntitled(input.triggerKey, await loadEntitledFeatureKeys(this.prisma, input.companyId))) {
      return { event: undefined, skipped: true, reason: 'feature_not_enabled' };
    }
    const dedupKey = buildDedupKey({ companyId: input.companyId, triggerKey: input.triggerKey, sourceModule: input.sourceModule, sourceType: input.sourceType, sourceId: input.sourceId, periodKey: input.periodKey });
    const now = new Date();

    // Dedup: find existing open event
    const existing = await this.events.findByDedupKey(input.companyId, dedupKey);
    const rule = await this.rules.findByTriggerKey(input.companyId, input.triggerKey);

    // Cooldown check
    const alertState = await this.alertStates.findByDedupKey(input.companyId, dedupKey);
    const coolingDown = existing && alertState && isInCooldown(alertState.cooldownUntil, now);

    let event = existing;
    if (!event || (event.status !== 'open' && !coolingDown && !['plan_term', 'billing'].includes(input.sourceModule))) {
      event = await this.events.create({ companyId: input.companyId, triggerKey: input.triggerKey, sourceModule: input.sourceModule, sourceType: input.sourceType, sourceId: input.sourceId, severity: input.severity as any, title: input.title, body: input.body, payloadJson: {}, sourceRefsJson: { refs: input.sourceRefs ?? [] }, deepLinkHref: input.deepLinkHref, dedupKey, status: 'open', ruleId: rule?.id, firstSeenAt: now, lastSeenAt: now, resolvedAt: undefined });
      if (input.supersedeEarlier) await this.events.resolveEarlier(event, now, input.alsoSupersedeTriggerKeys);
    } else {
      await this.events.update(input.companyId, event.id, { lastSeenAt: now });
    }

    // Create recipient + delivery rows only for current company members. The
    // delivery worker re-checks this again at egress for lifecycle races.
    const activeRecipients = await this.prisma.client.companyMembership.findMany({
      where: {
        companyId: input.companyId,
        userId: { in: [...new Set(input.recipientUserIds)] },
        status: 'ACTIVE',
      },
      select: { userId: true },
    });
    for (const { userId } of activeRecipients) {
      const recipient = await this.recipients.findByEventAndUser(event.id, userId) ??
        await this.recipients.create({ eventId: event.id, companyId: input.companyId, userId, recipientReason: 'role', readAt: undefined, dismissedAt: undefined, snoozedUntil: undefined });
      await this.recipients.trackWaiting(recipient, event);
      // A retry repairs partial old event/recipient writes even during cooldown. Sent/failed
      // deliveries are owned by the existing delivery worker, never recreated by this producer.
      for (const channel of (input.webOnlyRecipientUserIds?.includes(userId) ? ['web'] : ['web', 'line']) as Array<'web' | 'line'>) {
        const delivery = await this.prisma.client.notificationDelivery.findFirst({
          where: { recipientId: recipient.id, channel: channel === 'web' ? 'WEB' : 'LINE' }, select: { id: true },
        });
        if (!delivery) await this.deliveries.create({ recipientId: recipient.id, companyId: input.companyId, channel, status: 'queued', attemptCount: 0, nextAttemptAt: now, sentAt: undefined, errorCode: undefined, errorMessage: undefined, providerMessageId: undefined, metadataJson: {} });
      }
    }

    if (coolingDown) return { event, skipped: true, reason: 'cooldown' };
    const cooldownMinutes = rule?.cooldownMinutes ?? 60;
    await this.alertStates.upsert(input.companyId, dedupKey, { status: 'cooling_down', occurrenceCount: (alertState?.occurrenceCount ?? 0) + 1, lastTriggeredAt: now, cooldownUntil: computeCooldownUntil(cooldownMinutes, now) });

    return { event, skipped: false };
  }
}

@Injectable()
export class CreateDailyOwnerSummaryUseCase {
  constructor(
    private readonly generateSnapshot: GenerateSnapshotUseCase,
    private readonly createEvent: CreateOrUpdateNotificationEventUseCase,
    private readonly prisma: PrismaService,
  ) {}

  async execute(ctx: RequestContext, companyId: string, periodKey: string) {
    const snapshot = await this.generateSnapshot.execute(ctx, companyId, { periodKind: 'today', forceGenerate: true });
    const recipients = await this.prisma.client.companyMembership.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        roles: { some: { role: { key: { in: ['OWNER', 'ADMIN'] } } } },
      },
      select: { userId: true },
    });

    return this.createEvent.execute({
      companyId,
      triggerKey: 'daily_owner_summary',
      sourceModule: 'dashboard',
      sourceType: 'snapshot',
      sourceId: periodKey,
      severity: 'info',
      title: 'สรุปธุรกิจประจำวัน',
      body: `แดชบอร์ดอัปเดตแล้ว ${snapshot.widgets.length} วิดเจ็ต`,
      deepLinkHref: `/companies/${companyId}/dashboard`,
      sourceRefs: [{ module: 'dashboard', sourceType: 'snapshot', sourceId: snapshot.id, label: 'แดชบอร์ด', href: `/companies/${companyId}/dashboard`, permissionKey: 'dashboard.read' }],
      recipientUserIds: recipients.map((r) => r.userId),
      periodKey,
    });
  }
}

@Injectable()
export class ProcessQueuedDeliveryUseCase {
  constructor(private readonly lineCredentials: LineMessagingCredentialsService,
    private readonly prisma: PrismaService,
    private readonly deliveries: PrismaNotificationDeliveryRepository,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async execute(companyId: string, deliveryId: string) {
    const delivery = await this.prisma.client.notificationDelivery.findFirst({
      where: { id: deliveryId, companyId },
      include: { recipient: { include: { event: true } } },
    });
    if (!delivery) throw new NotFoundException();
    // Billing owns its mode-bound, current-OWNER delivery and crash recovery.
    if (delivery.recipient.event.sourceModule === 'billing') return delivery;
    if (!['QUEUED', 'FAILED'].includes(delivery.status)) return delivery;
    if (!await this.checkTriggerEntitlement(this.prisma.client, delivery)) {
      return this.prisma.client.notificationDelivery.findFirst({ where: { id: deliveryId, companyId } });
    }

    if (delivery.channel === 'WEB') {
      return this.deliveries.update(companyId, deliveryId, {
        status: 'sent',
        attemptCount: delivery.attemptCount + 1,
        sentAt: new Date(),
        nextAttemptAt: undefined,
      });
    }

    const event = delivery.recipient.event;
    const preference = await this.prisma.client.notificationPreference.findUnique({
      where: { companyId_userId: { companyId, userId: delivery.recipient.userId } },
    });
    const enabledChannels = arrayFromJson(preference?.enabledChannelsJson, DEFAULT_ENABLED_CHANNELS);
    const enabledTriggers = arrayFromJson(preference?.enabledTriggerKeysJson, IMPLEMENTED_TRIGGER_KEYS);
    const severity = event.severity.toLowerCase();
    const quiet = isInQuietHours(new Date(), preference?.quietHoursStart ?? undefined, preference?.quietHoursEnd ?? undefined, preference?.timezone ?? 'Asia/Bangkok');

    // A saved list predates every trigger added after it; a notice the product owes is not dropped for that.
    const triggerEnabled = enabledTriggers.includes(event.triggerKey) || ALWAYS_DELIVERED_TRIGGER_KEYS.includes(event.triggerKey);
    if (!enabledChannels.includes('line') || !triggerEnabled || (quiet && severity !== 'critical')) {
      return this.deliveries.update(companyId, deliveryId, {
        status: 'suppressed',
        attemptCount: delivery.attemptCount + 1,
        errorCode: quiet ? 'QUIET_HOURS' : 'PREFERENCE_SUPPRESSED',
        errorMessage: quiet ? 'LINE suppressed by quiet hours' : 'LINE suppressed by notification preference',
      });
    }

    // Employee notifications ride the shared WatchDog OA. LINE userIds are
    // channel-scoped, so the identity MUST be resolved on the same channel the
    // config token belongs to — never on a per-company binding row.
    const token = (await this.lineCredentials.get()).accessToken;
    const configuredChannelId = this.config.lineMessagingChannelId;
    const identity = token && configuredChannelId
      ? await this.prisma.client.externalIdentity.findFirst({
        where: { userId: delivery.recipient.userId, provider: 'LINE', providerChannelId: configuredChannelId, status: 'ACTIVE' },
      })
      : null;

    // A demo owner's only LINE identity is the virtual demo chat (`demo-web`, `Vdemo…`); never push to it.
    if (identity && isVirtualDemoTarget(identity.providerUserId, identity.providerChannelId)) {
      console.info('[notification-delivery] demo outbound suppressed');
      return this.deliveries.update(companyId, deliveryId, { status: 'suppressed', attemptCount: delivery.attemptCount + 1, errorCode: 'DEMO_OUTBOUND_SUPPRESSED' });
    }
    if (!identity || !token || !configuredChannelId) {
      return this.deliveries.update(companyId, deliveryId, {
        status: 'skipped',
        attemptCount: delivery.attemptCount + 1,
        errorCode: 'NO_LINE_DELIVERY_TARGET',
        errorMessage: 'No linked LINE identity or channel access token',
      });
    }

    if (isCustomerLinkedCrmNotification(event)) {
      const crmAttempt = await this.pushCustomerLinkedCrmNotification(
        companyId,
        deliveryId,
        delivery.attemptCount,
        token,
        identity.providerUserId,
      );
      if (!crmAttempt) {
        // CAS-only cleanup: never overwrite an erasure suppression or another
        // worker's committed attempt/outcome.
        await this.prisma.client.notificationDelivery.updateMany({
          where: {
            id: deliveryId,
            companyId,
            status: { in: ['QUEUED', 'FAILED'] },
            attemptCount: delivery.attemptCount,
          },
          data: {
            status: 'SUPPRESSED',
            nextAttemptAt: null,
            errorCode: 'CUSTOMER_DATA_UNAVAILABLE',
            errorMessage: 'Customer-linked notification suppressed after lifecycle change',
            metadataJson: { personalDataUnavailable: true },
          },
        });
        return this.prisma.client.notificationDelivery.findFirst({ where: { id: deliveryId, companyId } });
      }
      if (crmAttempt.outcomeStatus === 'failed' && crmAttempt.severity === 'critical') {
        await this.audit.log({
          companyId,
          actorUserId: undefined,
          action: 'notification_delivery.critical_failed',
          targetType: 'NotificationDelivery',
          targetId: deliveryId,
          requestId: `delivery-${deliveryId}`,
          result: 'FAILED',
          riskLevel: 'HIGH',
          metadataJson: { errorCode: crmAttempt.errorCode },
        });
      }
      return crmAttempt.delivery;
    }

    const attempt = await this.pushClaimedNonCustomerLineNotification(
      companyId,
      deliveryId,
      delivery.attemptCount,
      token,
      identity.providerUserId,
    );
    if (!attempt) {
      return this.prisma.client.notificationDelivery.findFirst({ where: { id: deliveryId, companyId } });
    }
    if (attempt.outcomeStatus === 'failed' && attempt.severity === 'critical') {
      await this.audit.log({
        companyId,
        actorUserId: undefined,
        action: 'notification_delivery.critical_failed',
        targetType: 'NotificationDelivery',
        targetId: deliveryId,
        requestId: `delivery-${deliveryId}`,
        result: 'FAILED',
        riskLevel: 'HIGH',
        metadataJson: { errorCode: attempt.errorCode },
      });
    }
    return attempt.delivery;
  }

  /** CAS suppression retains history and cannot overwrite another worker's committed outcome. */
  private async checkTriggerEntitlement(db: any, delivery: any): Promise<boolean> {
    const entitled = await loadEntitledFeatureKeys({ client: db } as PrismaService, delivery.companyId);
    if (isNotificationTriggerEntitled(delivery.recipient.event.triggerKey, entitled)) return true;
    await db.notificationDelivery.updateMany({
      where: { id: delivery.id, companyId: delivery.companyId, status: { in: ['QUEUED', 'FAILED'] }, attemptCount: delivery.attemptCount },
      data: { status: 'SUPPRESSED', nextAttemptAt: null, errorCode: 'FEATURE_NOT_ENABLED' },
    });
    return false;
  }

  /** Claim + provider call + outcome settle are one transaction, so stale sweep
   * snapshots cannot double-push and a process crash rolls the claim back. */
  private async pushClaimedNonCustomerLineNotification(
    companyId: string,
    deliveryId: string,
    expectedAttemptCount: number,
    token: string,
    lineUserId: string,
  ): Promise<{
    delivery: any;
    outcomeStatus: string;
    severity: string;
    errorCode?: string;
  } | null> {
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$executeRaw(sharedEntitlementLock(companyId));
      const current = await tx.notificationDelivery.findFirst({
        where: { id: deliveryId, companyId, status: { in: ['QUEUED', 'FAILED'] }, attemptCount: expectedAttemptCount },
        include: { recipient: { include: { event: true } } },
      });
      if (!current || isCustomerLinkedCrmNotification(current.recipient.event)) return null;
      if (!await this.checkTriggerEntitlement(tx, current)) return null;

      const activeMemberships = await tx.$queryRaw`
        SELECT "id"
        FROM "CompanyMembership"
        WHERE "companyId" = ${companyId}
          AND "userId" = ${current.recipient.userId}
          AND "status" = 'ACTIVE'
        FOR UPDATE
      `;
      if (!Array.isArray(activeMemberships) || activeMemberships.length !== 1 || current.recipient.event.status !== 'OPEN') {
        const suppressed = await tx.notificationDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'SUPPRESSED',
            nextAttemptAt: null,
            errorCode: 'RECIPIENT_OR_EVENT_INACTIVE',
            errorMessage: 'Notification suppressed after recipient or event lifecycle change',
          },
        });
        return {
          delivery: suppressed,
          outcomeStatus: 'suppressed',
          severity: current.recipient.event.severity.toLowerCase(),
          errorCode: 'RECIPIENT_OR_EVENT_INACTIVE',
        };
      }

      const claimed = await tx.notificationDelivery.updateMany({
        where: {
          id: deliveryId,
          companyId,
          status: { in: ['QUEUED', 'FAILED'] },
          attemptCount: expectedAttemptCount,
        },
        data: { status: 'SENDING' },
      });
      if (claimed.count !== 1) return null;

      const event = current.recipient.event;
      const result = await pushLineMessage(token, lineUserId, buildLineMessage({
        companyId,
        triggerKey: event.triggerKey,
        title: event.title,
        body: event.body,
        severity: event.severity.toLowerCase(),
        deepLinkHref: notificationSourceHref(event),
        ...(event.triggerKey === 'workflow.reimbursement_pending_approval' && event.sourceType === 'reimbursement_request' && event.sourceId && this.config.aiGatewayInternalSecret ? { approvalButtons: reimbursementApprovalButtons(this.config.aiGatewayInternalSecret, companyId, current.recipient.userId, event.sourceId) } : {}),
        ...(['workflow.reimbursement_ready_for_payment', 'workflow.reimbursement_payment_sla_breach'].includes(event.triggerKey) && event.sourceType === 'reimbursement_request' && event.sourceId && this.config.aiGatewayInternalSecret ? { approvalButtons: [reimbursementPaymentButton(this.config.aiGatewayInternalSecret, companyId, current.recipient.userId, event.sourceId)] } : {}),
      }), deliveryId);
      const now = new Date();
      const attemptCountAfter = expectedAttemptCount + 1;
      const outcome = resolveDeliveryOutcome({
        resultStatus: result.status,
        errorCode: result.errorCode,
        attemptCountAfter,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        now,
      });
      const updated = await tx.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: outcome.status.toUpperCase(),
          attemptCount: attemptCountAfter,
          sentAt: result.status === 'sent' ? now : null,
          nextAttemptAt: outcome.nextAttemptAt ?? null,
          providerMessageId: result.providerMessageId ?? null,
          ...(event.triggerKey === 'workflow.reimbursement_pending_approval' ? { metadataJson: { ...(current.metadataJson as Record<string, unknown> ?? {}), reimbursementApprovalChatKeyHash: createHash('sha256').update(lineUserId, 'utf8').digest('hex').slice(0, 16) } } : {}),
          errorCode: result.errorCode ?? null,
          errorMessage: result.errorMessage ?? null,
        },
      });
      return {
        delivery: updated,
        outcomeStatus: outcome.status,
        severity: event.severity.toLowerCase(),
        errorCode: result.errorCode,
      };
    }, { maxWait: 5_000, timeout: 35_000 });
  }

  /**
   * Final egress fence for CRM notifications. The worker may have loaded a
   * title/body before a PDPA erasure started; re-reading the event only after
   * the per-customer lock makes the provider call linear with that erasure.
   */
  private async pushCustomerLinkedCrmNotification(
    companyId: string,
    deliveryId: string,
    expectedAttemptCount: number,
    token: string,
    lineUserId: string,
  ): Promise<{
    delivery: any;
    outcomeStatus: string;
    severity: string;
    errorCode?: string;
  } | null> {
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$executeRaw(sharedEntitlementLock(companyId));
      const beforeLock = await tx.notificationDelivery.findFirst({
        where: { id: deliveryId, companyId, status: { in: ['QUEUED', 'FAILED'] }, attemptCount: expectedAttemptCount },
        include: { recipient: { include: { event: true } } },
      });
      if (!beforeLock || !isDeliverableCustomerLinkedCrmNotification(beforeLock.recipient.event)) return null;
      const discoveredCustomerId = await crmNotificationCustomerId(tx, companyId, beforeLock.recipient.event);
      if (!discoveredCustomerId) return null;

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('crm-customer:' || ${companyId} || ':' || ${discoveredCustomerId}))::text`;

      const current = await tx.notificationDelivery.findFirst({
        where: { id: deliveryId, companyId, status: { in: ['QUEUED', 'FAILED'] }, attemptCount: expectedAttemptCount },
        include: { recipient: { include: { event: true } } },
      });
      if (!current || !isDeliverableCustomerLinkedCrmNotification(current.recipient.event)) return null;
      if (!await this.checkTriggerEntitlement(tx, current)) return null;
      const currentCustomerId = await crmNotificationCustomerId(tx, companyId, current.recipient.event);
      if (currentCustomerId !== discoveredCustomerId) return null;
      const customer = await tx.crmCustomer.findFirst({
        where: { id: currentCustomerId, companyId, status: 'ACTIVE', personalDataErasedAt: null },
        select: { id: true },
      });
      if (!customer) return null;

      const activeMemberships = await tx.$queryRaw`
        SELECT "id"
        FROM "CompanyMembership"
        WHERE "companyId" = ${companyId}
          AND "userId" = ${current.recipient.userId}
          AND "status" = 'ACTIVE'
        FOR UPDATE
      `;
      if (!Array.isArray(activeMemberships) || activeMemberships.length !== 1) return null;

      const claimed = await tx.notificationDelivery.updateMany({
        where: {
          id: deliveryId,
          companyId,
          status: { in: ['QUEUED', 'FAILED'] },
          attemptCount: expectedAttemptCount,
        },
        data: { status: 'SENDING' },
      });
      if (claimed.count !== 1) return null;

      const event = current.recipient.event;
      const result = await pushLineMessage(token, lineUserId, buildLineMessage({
        companyId,
        triggerKey: event.triggerKey,
        title: event.title,
        body: event.body,
        severity: event.severity.toLowerCase(),
        deepLinkHref: notificationSourceHref(event),
        ...(event.triggerKey === 'workflow.reimbursement_pending_approval' && event.sourceType === 'reimbursement_request' && event.sourceId && this.config.aiGatewayInternalSecret ? { approvalButtons: reimbursementApprovalButtons(this.config.aiGatewayInternalSecret, companyId, current.recipient.userId, event.sourceId) } : {}),
        ...(['workflow.reimbursement_ready_for_payment', 'workflow.reimbursement_payment_sla_breach'].includes(event.triggerKey) && event.sourceType === 'reimbursement_request' && event.sourceId && this.config.aiGatewayInternalSecret ? { approvalButtons: [reimbursementPaymentButton(this.config.aiGatewayInternalSecret, companyId, current.recipient.userId, event.sourceId)] } : {}),
      }), deliveryId);
      const now = new Date();
      const attemptCountAfter = expectedAttemptCount + 1;
      const outcome = resolveDeliveryOutcome({
        resultStatus: result.status,
        errorCode: result.errorCode,
        attemptCountAfter,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        now,
      });
      const updated = await tx.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: outcome.status.toUpperCase(),
          attemptCount: attemptCountAfter,
          sentAt: result.status === 'sent' ? now : null,
          nextAttemptAt: outcome.nextAttemptAt ?? null,
          providerMessageId: result.providerMessageId ?? null,
          ...(event.triggerKey === 'workflow.reimbursement_pending_approval' ? { metadataJson: { ...(current.metadataJson as Record<string, unknown> ?? {}), reimbursementApprovalChatKeyHash: createHash('sha256').update(lineUserId, 'utf8').digest('hex').slice(0, 16) } } : {}),
          errorCode: result.errorCode ?? null,
          errorMessage: result.errorMessage ?? null,
        },
      });
      return {
        delivery: updated,
        outcomeStatus: outcome.status,
        severity: event.severity.toLowerCase(),
        errorCode: result.errorCode,
      };
    }, { maxWait: 5_000, timeout: 35_000 });
  }
}

/**
 * Delivery sweep (A4). Cross-company: finds due QUEUED deliveries (web + line) and
 * processes each through ProcessQueuedDeliveryUseCase. This is the dispatcher that
 * was missing — nothing previously enqueued delivery jobs, so LINE pushes never left
 * the queue. Bounded per call; the worker re-fires to drain. One delivery's failure
 * never aborts the sweep.
 */
@Injectable()
export class ProcessDueNotificationDeliveriesUseCase {
  constructor(
    private readonly deliveries: PrismaNotificationDeliveryRepository,
    private readonly processDelivery: ProcessQueuedDeliveryUseCase,
    private readonly shadow: LaunchShadowProbe,
  ) {}

  async execute(limit = DELIVERY_SWEEP_BATCH_LIMIT): Promise<{ processed: number; failures: number }> {
    const due = await this.deliveries.findDue(new Date(), limit);
    let failures = 0;
    // SHADOW ONLY (plan §3 F1): launch availability remains observational. Module ownership is
    // enforced separately by ProcessQueuedDeliveryUseCase.
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.notificationsDeliverySweep);
    try {
      for (const d of due) {
        // Outside the catch below: the observation is about what the guard would have decided,
        // not about whether the delivery then succeeded.
        await sweep.record(d.companyId, NOTIFICATION_FEATURE_KEY);
        try {
          await this.processDelivery.execute(d.companyId, d.id);
        } catch {
          // A transient processing error must not abort the rest of the sweep; the
          // delivery stays QUEUED and the next sweep retries it.
          failures += 1;
        }
      }
    } finally {
      // `finally`, not a trailing await (piece 3 / codex r15 fix 11): the per-delivery catch covers
      // processing only, so a throw from `sweep.record` or the repository would otherwise drop the
      // whole batch's buffered counts with no bucket row and no persist_failed warn.
      await sweep.flush();
    }
    return { processed: due.length, failures };
  }
}

// ---- Helpers ----

function arrayFromJson(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
}

function isCustomerLinkedCrmNotification(event: any): boolean {
  return event?.sourceModule === 'crm_inbox'
    && ['crm_conversation', 'crm_booking'].includes(event?.sourceType)
    && typeof event?.sourceId === 'string';
}

function isDeliverableCustomerLinkedCrmNotification(event: any): boolean {
  return isCustomerLinkedCrmNotification(event) && event.status === 'OPEN';
}

async function crmNotificationCustomerId(tx: any, companyId: string, event: any): Promise<string | null> {
  if (event.sourceType === 'crm_conversation') {
    const row = await tx.crmConversation.findFirst({
      where: { id: event.sourceId, companyId },
      select: { customerId: true },
    });
    return row?.customerId ?? null;
  }
  if (event.sourceType === 'crm_booking') {
    const row = await tx.crmBooking.findFirst({
      where: { id: event.sourceId, companyId },
      select: { customerId: true },
    });
    return row?.customerId ?? null;
  }
  return null;
}

export function buildLineMessage(params: {
  approvalButtons?: Record<string, unknown>[];
  companyId: string;
  triggerKey?: string;
  title: string;
  body: string;
  severity: string;
  deepLinkHref?: string;
}): { type: 'flex'; altText: string; contents: Record<string, unknown> } {
  const severityLabel: Record<string, string> = {
    critical: '🔴 สำคัญ',
    action: '🟡 ต้องดำเนินการ',
    insight: '🔵 ข้อมูล',
    info: '⚪ แจ้งเตือน',
  };
  // Shared resolver: the previous fallback host (`app.watchdog.local`) does not resolve anywhere,
  // so a worker without WEB_BASE_URL/PUBLIC_BASE_URL pushed an unreachable link instead of a path.
  const href = params.deepLinkHref ?? `/companies/${params.companyId}/dashboard`;
  const deepLink = webLink(href);
  const buttonLabel = (params.triggerKey === 'plan_term_expiring' || params.triggerKey === 'plan_term_expired')
    && href.endsWith(`/companies/${params.companyId}/billing`) ? 'จัดการแพ็กเกจ' : 'เปิดรายการในเว็บ';
  const label = severityLabel[params.severity] ?? '📣 แจ้งเตือน';
  const title = Array.from(params.title.trim() || 'แจ้งเตือนจากมั่งมีพลัส').slice(0, 120).join('');
  const body = Array.from(params.body.trim()).slice(0, 1_000).join('');
  const altText = lineMessagePreview(`[มั่งมีพลัส] ${label} ${title} ${body}`);
  const canOpen = /^https:\/\//i.test(deepLink);

  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#22C55E', paddingAll: '16px',
        contents: [{ type: 'text', text: label, color: '#FFFFFF', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: title, color: '#1A2E22', weight: 'bold', size: 'md', wrap: true },
          ...(body ? [{ type: 'text', text: body, color: '#475467', size: 'sm', wrap: true }] : []),
        ],
      },
      ...(params.approvalButtons?.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: params.approvalButtons } } : canOpen ? {
        footer: {
          type: 'box', layout: 'vertical', paddingAll: '12px',
          contents: [{
            type: 'button', style: 'primary', color: '#15803D',
            action: { type: 'uri', label: buttonLabel, uri: deepLink },
          }],
        },
      } : {}),
    },
  };
}

function notificationLineRetryKey(deliveryId: string): string {
  const hex = createHash('sha256').update(`notification-delivery:${deliveryId}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export async function pushLineMessage(
  token: string,
  lineUserId: string,
  message: { type: 'flex'; altText: string; contents: Record<string, unknown> },
  deliveryId: string,
  channelId?: string,
) {
  if (isVirtualDemoTarget(lineUserId, channelId)) {
    console.info('[notification-delivery] demo outbound suppressed');
    return { status: 'suppressed' as const, errorCode: 'DEMO_OUTBOUND_SUPPRESSED' };
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Line-Retry-Key': notificationLineRetryKey(deliveryId),
      },
      // R-B1: exit-side only. `buildLineMessage` output is what billing-notifications.service.ts hashes
      // into its binding and what `notificationLineRetryKey` never sees — both stay stable.
      body: JSON.stringify({ to: lineUserId, messages: withLineExternalBrowserLinks([message]) }),
      signal: AbortSignal.timeout(30_000),
    });
    const acceptedRequestId = res.status === 409 ? res.headers.get('x-line-accepted-request-id') : null;
    if (res.ok || acceptedRequestId) {
      const body = (await res.json().catch(() => ({}))) as { sentMessages?: Array<{ id: string }> };
      return { status: 'sent' as const, providerMessageId: body.sentMessages?.[0]?.id ?? acceptedRequestId ?? undefined };
    }
    return { status: 'failed' as const, errorCode: res.status === 429 ? 'RATE_LIMIT' : `HTTP_${res.status}`, errorMessage: 'LINE push failed' };
  } catch {
    return { status: 'failed' as const, errorCode: 'NETWORK_ERROR', errorMessage: 'LINE push network error' };
  }
}

function toSummary(event: any): NotificationSummaryDto {
  const refs = (event.sourceRefsJson as any)?.refs ?? [];
  return {
    id: event.id,
    companyId: event.companyId,
    triggerKey: event.triggerKey,
    severity: event.severity,
    status: event.status,
    title: event.title,
    body: event.body,
    sourceRefs: refs,
    deepLinkHref: notificationSourceHref(event),
    createdAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt,
    readAt: event.readAt instanceof Date ? event.readAt.toISOString() : event.readAt,
    dismissedAt: event.dismissedAt instanceof Date ? event.dismissedAt.toISOString() : event.dismissedAt,
    deliveryChannels: ['web', 'line'],
  };
}

function toRuleDto(rule: any): NotificationRuleDto {
  return {
    id: rule.id,
    companyId: rule.companyId,
    triggerKey: rule.triggerKey,
    name: notificationRuleDisplayName(rule.triggerKey),
    severity: rule.severity,
    conditionJson: rule.conditionJson,
    recipientPolicyJson: rule.recipientPolicyJson,
    channelPolicyJson: rule.channelPolicyJson,
    cooldownMinutes: rule.cooldownMinutes,
    digestPolicy: rule.digestPolicy,
    status: rule.status,
  };
}
