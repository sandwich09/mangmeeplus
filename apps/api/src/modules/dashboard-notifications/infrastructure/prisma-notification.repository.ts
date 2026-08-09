import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  NotificationRuleRepositoryPort,
  NotificationEventRepositoryPort,
  NotificationRecipientRepositoryPort,
  NotificationDeliveryRepositoryPort,
  NotificationPreferenceRepositoryPort,
  AlertStateRepositoryPort,
  ListEventsFilter,
} from '../domain/ports/dashboard-notification.ports';
import type {
  NotificationRule, NotificationEvent, NotificationRecipient,
  NotificationDelivery, NotificationPreference, AlertState,
} from '../domain/models/notification.model';
import { DEFAULT_ENABLED_CHANNELS, IMPLEMENTED_TRIGGER_KEYS } from '../domain/models/notification.model';

/**
 * Keyset page for the three cursor-paginated lists here.
 *
 * They used to filter `id < cursor` while sorting by `createdAt desc` — a filter on one key and an
 * order on another. Whenever the two disagree, and cuid ids only approximate creation order across
 * processes, a row sorted after the cursor but with a larger id is skipped and one sorted before it
 * with a smaller id repeats. Page 2 of a notification list quietly lost items.
 *
 * `createdAt` is not unique either — a batch of recipients is written in the same millisecond — so
 * `id` is kept as the tiebreaker, which also makes it a valid Prisma cursor. `skip: 1` steps past
 * the cursor row itself.
 */
function keysetPage(cursor: string | undefined, pageSize: number) {
  return {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

function toRule(r: any): NotificationRule {
  return {
    ...r,
    severity: r.severity.toLowerCase(),
    status: r.status.toLowerCase(),
    digestPolicy: r.digestPolicy.toLowerCase(),
    conditionJson: r.conditionJson as Record<string, unknown>,
    recipientPolicyJson: r.recipientPolicyJson as Record<string, unknown>,
    channelPolicyJson: r.channelPolicyJson as Record<string, unknown>,
  };
}

function toEvent(r: any): NotificationEvent {
  const recipient = r.recipients?.[0];
  return {
    ...r,
    severity: r.severity.toLowerCase(),
    status: r.status.toLowerCase(),
    payloadJson: r.payloadJson as Record<string, unknown>,
    sourceRefsJson: r.sourceRefsJson as Record<string, unknown>,
    readAt: recipient?.readAt,
    dismissedAt: recipient?.dismissedAt,
  };
}

function toRecipient(r: any): NotificationRecipient {
  return { ...r, recipientReason: r.recipientReason };
}

function toDelivery(r: any): NotificationDelivery {
  return {
    ...r,
    channel: r.channel.toLowerCase(),
    status: r.status.toLowerCase(),
    metadataJson: r.metadataJson as Record<string, unknown>,
  };
}

function toPreference(r: any): NotificationPreference {
  return {
    ...r,
    enabledChannelsJson: r.enabledChannelsJson as string[],
    enabledTriggerKeysJson: r.enabledTriggerKeysJson as string[],
    digestFrequency: r.digestFrequency.toLowerCase(),
  };
}

function toAlertState(r: any): AlertState {
  return { ...r, status: r.status.toLowerCase() };
}

@Injectable()
export class PrismaNotificationRuleRepository implements NotificationRuleRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async list(companyId: string) { return (await this.prisma.client.notificationRule.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } })).map(toRule); }
  async findById(companyId: string, id: string) { const r = await this.prisma.client.notificationRule.findFirst({ where: { id, companyId } }); return r ? toRule(r) : null; }
  async findByTriggerKey(companyId: string, triggerKey: string) { const r = await this.prisma.client.notificationRule.findFirst({ where: { companyId, triggerKey } }); return r ? toRule(r) : null; }
  async update(companyId: string, id: string, data: Partial<NotificationRule>) {
    const r = await this.prisma.client.notificationRule.update({
      where: { id },
      data: {
        ...(data.status !== undefined && { status: data.status.toUpperCase() as any }),
        ...(data.severity !== undefined && { severity: data.severity.toUpperCase() as any }),
        ...(data.digestPolicy !== undefined && { digestPolicy: data.digestPolicy.toUpperCase() as any }),
        ...(data.cooldownMinutes !== undefined && { cooldownMinutes: data.cooldownMinutes }),
        ...(data.conditionJson !== undefined && { conditionJson: data.conditionJson as any }),
        ...(data.recipientPolicyJson !== undefined && { recipientPolicyJson: data.recipientPolicyJson as any }),
        ...(data.channelPolicyJson !== undefined && { channelPolicyJson: data.channelPolicyJson as any }),
      },
    });
    return toRule(r);
  }
}

@Injectable()
export class PrismaNotificationEventRepository implements NotificationEventRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async findByDedupKey(companyId: string, dedupKey: string) { const r = await this.prisma.client.notificationEvent.findFirst({ where: { companyId, dedupKey } }); return r ? toEvent(r) : null; }
  async findById(companyId: string, id: string) { const r = await this.prisma.client.notificationEvent.findFirst({ where: { id, companyId } }); return r ? toEvent(r) : null; }
  async list(companyId: string, userId: string, filter: ListEventsFilter) {
    const pageSize = filter.pageSize ?? 25;
    const recipientWhere: any = { userId, dismissedAt: null };
    if (filter.read === false) recipientWhere.readAt = null;
    if (filter.read === true) recipientWhere.readAt = { not: null };
    const where: any = { companyId, recipients: { some: recipientWhere } };
    if (filter.status) where.status = filter.status.toUpperCase();
    if (filter.severity) where.severity = filter.severity.toUpperCase();
    if (filter.triggerKey) where.triggerKey = filter.triggerKey;
    const rows = await this.prisma.client.notificationEvent.findMany({
      where,
      ...keysetPage(filter.cursor, pageSize),
      include: { recipients: { where: { userId }, take: 1 } },
    });
    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    return { items: items.map(toEvent), nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
  }
  async create(data: Omit<NotificationEvent, 'id' | 'createdAt' | 'updatedAt'>) {
    const r = await this.prisma.client.notificationEvent.create({
      data: {
        companyId: data.companyId,
        triggerKey: data.triggerKey,
        sourceModule: data.sourceModule,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        severity: data.severity.toUpperCase() as any,
        status: data.status.toUpperCase() as any,
        title: data.title,
        body: data.body,
        deepLinkHref: data.deepLinkHref,
        dedupKey: data.dedupKey,
        ruleId: data.ruleId,
        resolvedAt: data.resolvedAt,
        payloadJson: (data.payloadJson ?? {}) as any,
        sourceRefsJson: (data.sourceRefsJson ?? {}) as any,
      },
    });
    return toEvent(r);
  }
  async update(companyId: string, id: string, data: Partial<NotificationEvent>) {
    const r = await this.prisma.client.notificationEvent.update({
      where: { id },
      data: {
        ...(data.status !== undefined && { status: data.status.toUpperCase() as any }),
        ...(data.severity !== undefined && { severity: data.severity.toUpperCase() as any }),
        ...(data.lastSeenAt !== undefined && { lastSeenAt: data.lastSeenAt }),
        ...(data.resolvedAt !== undefined && { resolvedAt: data.resolvedAt }),
        ...(data.payloadJson !== undefined && { payloadJson: data.payloadJson as any }),
      },
    });
    return toEvent(r);
  }
}

@Injectable()
export class PrismaNotificationRecipientRepository implements NotificationRecipientRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async findByEventAndUser(eventId: string, userId: string) { const r = await this.prisma.client.notificationRecipient.findUnique({ where: { eventId_userId: { eventId, userId } } }); return r ? toRecipient(r) : null; }
  async listByUser(companyId: string, userId: string, filter: { read?: boolean; cursor?: string; pageSize?: number }) {
    const pageSize = filter.pageSize ?? 25;
    const where: any = { companyId, userId };
    if (filter.read === false) where.readAt = null;
    if (filter.read === true) where.readAt = { not: null };
    const rows = await this.prisma.client.notificationRecipient.findMany({ where, ...keysetPage(filter.cursor, pageSize), include: { event: true } });
    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    return { items: items.map(toRecipient), nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
  }
  /**
   * The workspace polls this every 60 seconds per open tab. It used to fetch every unread row with
   * its event joined and count them in JS, so the cost grew with the user's unread backlog — the
   * one number that grows fastest for exactly the users who ignore notifications.
   *
   * Counted from the event side because `(eventId, userId)` is unique on the recipient, so one
   * matching event is one unread row; that lets the database group by severity and return four
   * numbers instead of the whole backlog.
   */
  async countUnread(companyId: string, userId: string) {
    const groups = await this.prisma.client.notificationEvent.groupBy({
      by: ['severity'],
      where: { companyId, recipients: { some: { userId, readAt: null, dismissedAt: null } } },
      _count: { _all: true },
    });
    const count = (severity: string) => groups.find((group) => group.severity === severity)?._count._all ?? 0;
    return {
      total: groups.reduce((sum, group) => sum + group._count._all, 0),
      bySeverity: {
        critical: count('CRITICAL'), action: count('ACTION'),
        insight: count('INSIGHT'), info: count('INFO'),
      },
    };
  }
  async create(data: Omit<NotificationRecipient, 'id' | 'createdAt'>) { const r = await this.prisma.client.notificationRecipient.create({ data }); return toRecipient(r); }
  async update(companyId: string, id: string, data: Partial<NotificationRecipient>) { const r = await this.prisma.client.notificationRecipient.update({ where: { id }, data }); return toRecipient(r); }
  async markAllRead(companyId: string, userId: string) { const result = await this.prisma.client.notificationRecipient.updateMany({ where: { companyId, userId, readAt: null }, data: { readAt: new Date() } }); return result.count; }
}

@Injectable()
export class PrismaNotificationDeliveryRepository implements NotificationDeliveryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async findById(companyId: string, id: string) { const r = await this.prisma.client.notificationDelivery.findFirst({ where: { id, companyId } }); return r ? toDelivery(r) : null; }
  async listByCompany(companyId: string, filter: { channel?: string; status?: string; cursor?: string; pageSize?: number }) {
    const pageSize = filter.pageSize ?? 25;
    const where: any = { companyId };
    if (filter.channel) where.channel = filter.channel.toUpperCase();
    if (filter.status) where.status = filter.status.toUpperCase();
    const rows = await this.prisma.client.notificationDelivery.findMany({ where, ...keysetPage(filter.cursor, pageSize) });
    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    return { items: items.map(toDelivery), nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
  }
  async listQueued(companyId: string, limit: number) { const rows = await this.prisma.client.notificationDelivery.findMany({ where: { companyId, status: 'QUEUED' }, take: limit, orderBy: { createdAt: 'asc' } }); return rows.map(toDelivery); }
  /** Cross-company due deliveries for the sweep (A4): QUEUED and past their backoff. */
  async findDue(now: Date, limit: number): Promise<Array<{ id: string; companyId: string }>> {
    return this.prisma.client.notificationDelivery.findMany({
      where: { status: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      select: { id: true, companyId: true },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
  }
  async create(data: Omit<NotificationDelivery, 'id' | 'createdAt' | 'updatedAt'>) {
    const r = await this.prisma.client.notificationDelivery.create({
      data: {
        companyId: data.companyId,
        recipientId: data.recipientId,
        channel: data.channel.toUpperCase() as any,
        status: data.status.toUpperCase() as any,
        attemptCount: data.attemptCount,
        nextAttemptAt: data.nextAttemptAt,
        sentAt: data.sentAt,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
        providerMessageId: data.providerMessageId,
        metadataJson: (data.metadataJson ?? {}) as any,
      },
    });
    return toDelivery(r);
  }
  async update(companyId: string, id: string, data: Partial<NotificationDelivery>) {
    const r = await this.prisma.client.notificationDelivery.update({
      where: { id },
      data: {
        ...(data.status !== undefined && { status: data.status.toUpperCase() as any }),
        ...(data.attemptCount !== undefined && { attemptCount: data.attemptCount }),
        ...(data.nextAttemptAt !== undefined && { nextAttemptAt: data.nextAttemptAt }),
        ...(data.sentAt !== undefined && { sentAt: data.sentAt }),
        ...(data.errorCode !== undefined && { errorCode: data.errorCode }),
        ...(data.errorMessage !== undefined && { errorMessage: data.errorMessage }),
        ...(data.providerMessageId !== undefined && { providerMessageId: data.providerMessageId }),
        ...(data.metadataJson !== undefined && { metadataJson: data.metadataJson as any }),
      },
    });
    return toDelivery(r);
  }
}

@Injectable()
export class PrismaNotificationPreferenceRepository implements NotificationPreferenceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async findByUser(companyId: string, userId: string) { const r = await this.prisma.client.notificationPreference.findUnique({ where: { companyId_userId: { companyId, userId } } }); return r ? toPreference(r) : null; }
  async upsert(companyId: string, userId: string, data: Partial<NotificationPreference>) {
    const r = await this.prisma.client.notificationPreference.upsert({
      where: { companyId_userId: { companyId, userId } },
      update: {
        ...(data.enabledChannelsJson !== undefined && { enabledChannelsJson: data.enabledChannelsJson as any }),
        ...(data.enabledTriggerKeysJson !== undefined && { enabledTriggerKeysJson: data.enabledTriggerKeysJson as any }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.digestFrequency !== undefined && { digestFrequency: data.digestFrequency.toUpperCase() as any }),
        ...(data.quietHoursStart !== undefined && { quietHoursStart: data.quietHoursStart }),
        ...(data.quietHoursEnd !== undefined && { quietHoursEnd: data.quietHoursEnd }),
      },
      // A first save that only touches quiet hours must not silently opt the user out of
      // everything: the column defaults are `[]` (= suppress all) and arrayFromJson treats an
      // empty array as an explicit choice, not a missing value. So the CREATE path writes the
      // same defaults a user with no row already gets. An explicit [] from the user is still
      // honoured (?? only fills null/undefined), and UPDATE still leaves omitted fields alone.
      create: {
        companyId,
        userId,
        enabledChannelsJson: (data.enabledChannelsJson ?? DEFAULT_ENABLED_CHANNELS) as any,
        enabledTriggerKeysJson: (data.enabledTriggerKeysJson ?? IMPLEMENTED_TRIGGER_KEYS) as any,
        timezone: data.timezone ?? 'Asia/Bangkok',
        digestFrequency: (data.digestFrequency?.toUpperCase() ?? 'NONE') as any,
        quietHoursStart: data.quietHoursStart,
        quietHoursEnd: data.quietHoursEnd,
      },
    });
    return toPreference(r);
  }
}

@Injectable()
export class PrismaAlertStateRepository implements AlertStateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}
  async findByDedupKey(companyId: string, dedupKey: string) { const r = await this.prisma.client.alertState.findUnique({ where: { companyId_dedupKey: { companyId, dedupKey } } }); return r ? toAlertState(r) : null; }
  async upsert(companyId: string, dedupKey: string, data: Partial<AlertState>) {
    const r = await this.prisma.client.alertState.upsert({
      where: { companyId_dedupKey: { companyId, dedupKey } },
      update: { ...data, status: data.status?.toUpperCase() as any },
      create: { companyId, dedupKey, status: data.status?.toUpperCase() as any ?? 'ACTIVE', occurrenceCount: data.occurrenceCount ?? 1, lastTriggeredAt: data.lastTriggeredAt ?? new Date(), cooldownUntil: data.cooldownUntil },
    });
    return toAlertState(r);
  }
}
