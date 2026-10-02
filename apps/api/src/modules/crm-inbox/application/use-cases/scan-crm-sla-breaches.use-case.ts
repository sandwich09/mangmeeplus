import { Injectable, Logger } from '@nestjs/common';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import type { CrmConversationRecord } from '../../domain/models/crm-inbox.model';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';

const SYSTEM_ACTOR = 'system';
const NOOP_SHADOW = {
  startSweep: () => ({ record: async () => undefined, flush: async () => ({}) }),
} as unknown as LaunchShadowProbe;

/**
 * First-response SLA breach scanner (spec §15). Worker-triggered global sweep:
 * marks `slaBreachedAt` (race-safe — a staff reply between query and mark
 * wins), emits `crm.conversation.sla_breached` to the outbox, and notifies
 * the assignee + inbox managers through the item 06 notification center.
 */
@Injectable()
export class ScanCrmSlaBreachesUseCase {
  private readonly logger = new Logger(ScanCrmSlaBreachesUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly outbox: OutboxAppendService,
    private readonly createNotification: CreateOrUpdateNotificationEventUseCase,
    private readonly shadow: LaunchShadowProbe = NOOP_SHADOW,
  ) {}

  async execute(limit = 200): Promise<{ scanned: number; breached: number }> {
    const now = new Date();
    const candidates = await this.repo.findSlaBreachCandidates(now, limit);
    if (candidates.length === 0) return { scanned: 0, breached: 0 };
    const shadow = this.shadow.startSweep(SHADOW_SURFACES.crmSlaScan);
    try {
      for (const companyId of new Set(candidates.map((candidate) => candidate.companyId))) {
        await shadow.record(companyId, 'crm');
      }

      // One managers/names lookup per company, not per conversation.
      const managersByCompany = new Map<string, string[]>();
      const namesByCompany = new Map<string, Map<string, string>>();
      for (const companyId of new Set(candidates.map((c) => c.companyId))) {
        managersByCompany.set(companyId, await this.repo.findInboxManagerUserIds(companyId));
        const customerIds = candidates.filter((c) => c.companyId === companyId).map((c) => c.customerId);
        namesByCompany.set(companyId, await this.repo.findCustomerDisplayNames(companyId, customerIds));
      }

      let breached = 0;
      for (const conv of candidates) {
        const marked = await this.repo.withLiveCustomerDataLock(
          { companyId: conv.companyId, customerId: conv.customerId, conversationId: conv.id },
          async () => {
            if (!(await this.repo.markSlaBreached(conv.id, now))) return false;
            await this.outbox.append('crm.conversation.sla_breached', 'crm_conversation', conv.id, {
              companyId: conv.companyId,
              actorUserId: SYSTEM_ACTOR,
              aggregateType: 'crm_conversation',
              aggregateId: conv.id,
              occurredAt: now.toISOString(),
              data: {
                customerId: conv.customerId,
                assignedToUserId: conv.assignedToUserId,
                firstResponseDueAt: conv.firstResponseDueAt?.toISOString() ?? null,
              },
            });
            try {
              await this.notifyBreach(conv, managersByCompany, namesByCompany, now);
            } catch (error) {
              // The breach mark + outbox event already landed; a notification
              // failure must never abort the rest of the sweep.
              this.logger.warn({ msg: 'SLA breach notification failed', conversationId: conv.id, error: (error as Error).message });
            }
            return true;
          },
        );
        if (marked) breached += 1;
      }

      return { scanned: candidates.length, breached };
    } finally {
      await shadow.flush();
    }
  }

  private async notifyBreach(
    conv: CrmConversationRecord,
    managersByCompany: Map<string, string[]>,
    namesByCompany: Map<string, Map<string, string>>,
    now: Date,
  ): Promise<void> {
    const recipients = new Set(managersByCompany.get(conv.companyId) ?? []);
    if (conv.assignedToUserId) recipients.add(conv.assignedToUserId);
    if (recipients.size === 0) return;

    const customerName = namesByCompany.get(conv.companyId)?.get(conv.customerId) ?? 'ลูกค้า LINE';
    const overdueMinutes = conv.firstResponseDueAt
      ? Math.max(1, Math.round((now.getTime() - conv.firstResponseDueAt.getTime()) / 60_000))
      : 0;
    const inboxHref = `/companies/${conv.companyId}/inbox`;

    await this.createNotification.execute({
      companyId: conv.companyId,
      triggerKey: 'crm_sla_breach',
      sourceModule: 'crm_inbox',
      sourceType: 'crm_conversation',
      sourceId: conv.id,
      severity: 'action',
      title: `ลูกค้ารอตอบเกินกำหนด: ${customerName}`,
      body: `ยังไม่มีการตอบกลับแรกถึงลูกค้า (เกินกำหนดมา ${overdueMinutes} นาที)`,
      deepLinkHref: inboxHref,
      sourceRefs: [
        {
          module: 'crm_inbox',
          sourceType: 'crm_conversation',
          sourceId: conv.id,
          label: customerName,
          href: inboxHref,
          permissionKey: 'crm.inbox.read',
        },
      ],
      recipientUserIds: [...recipients],
    });
  }
}
