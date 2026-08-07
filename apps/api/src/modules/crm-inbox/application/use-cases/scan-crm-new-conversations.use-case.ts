import { Injectable, Logger } from '@nestjs/common';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { NEW_CONVERSATION_SCAN_LIMIT, NEW_CONVERSATION_SCAN_WINDOW_MS } from '../../domain/crm-inbox.constants';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';

const NOOP_SHADOW = {
  startSweep: () => ({ record: async () => undefined, flush: async () => ({}) }),
} as unknown as LaunchShadowProbe;

/**
 * New-conversation notification scan (A4). Worker-triggered: finds recently-created,
 * still-unassigned, still-unanswered conversations and alerts inbox managers so a new
 * LINE chat gets picked up fast. Dedup + cooldown in the notification center collapse
 * the short overlapping scan window to a single alert per conversation; an ageing
 * unassigned chat is escalated separately by the SLA breach scanner. Mirrors
 * ScanCrmSlaBreachesUseCase; a notification failure never aborts the sweep.
 */
@Injectable()
export class ScanCrmNewConversationsUseCase {
  private readonly logger = new Logger(ScanCrmNewConversationsUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly createNotification: CreateOrUpdateNotificationEventUseCase,
    private readonly shadow: LaunchShadowProbe = NOOP_SHADOW,
  ) {}

  async execute(limit = NEW_CONVERSATION_SCAN_LIMIT): Promise<{ scanned: number; notified: number }> {
    const now = new Date();
    const candidates = await this.repo.findNewUnassignedConversations(now, NEW_CONVERSATION_SCAN_WINDOW_MS, limit);
    if (candidates.length === 0) return { scanned: 0, notified: 0 };
    const shadow = this.shadow.startSweep(SHADOW_SURFACES.crmNewConversationScan);
    try {
      for (const companyId of new Set(candidates.map((candidate) => candidate.companyId))) {
        await shadow.record(companyId, 'crm');
      }

      const managersByCompany = new Map<string, string[]>();
      const namesByCompany = new Map<string, Map<string, string>>();
      for (const companyId of new Set(candidates.map((c) => c.companyId))) {
        managersByCompany.set(companyId, await this.repo.findInboxManagerUserIds(companyId));
        const customerIds = candidates.filter((c) => c.companyId === companyId).map((c) => c.customerId);
        namesByCompany.set(companyId, await this.repo.findCustomerDisplayNames(companyId, customerIds));
      }

      let notified = 0;
      for (const conv of candidates) {
        const recipients = managersByCompany.get(conv.companyId) ?? [];
        if (recipients.length === 0) continue;
        const customerName = namesByCompany.get(conv.companyId)?.get(conv.customerId) ?? 'ลูกค้า LINE';
        const inboxHref = `/companies/${conv.companyId}/inbox`;
        try {
          const result = await this.repo.withLiveCustomerDataLock(
            { companyId: conv.companyId, customerId: conv.customerId, conversationId: conv.id },
            () => this.createNotification.execute({
              companyId: conv.companyId,
              triggerKey: 'crm_new_conversation',
              sourceModule: 'crm_inbox',
              sourceType: 'crm_conversation',
              sourceId: conv.id,
              severity: 'action',
              title: `แชทใหม่จาก ${customerName}`,
              body: 'มีลูกค้าทักเข้ามาใหม่ ยังไม่มีผู้รับผิดชอบ',
              deepLinkHref: inboxHref,
              sourceRefs: [
                { module: 'crm_inbox', sourceType: 'crm_conversation', sourceId: conv.id, label: customerName, href: inboxHref, permissionKey: 'crm.inbox.read' },
              ],
              recipientUserIds: recipients,
            }),
          );
          if (result && (!('skipped' in result) || !result.skipped)) notified += 1;
        } catch (error) {
          this.logger.warn({ msg: 'new-conversation notification failed', conversationId: conv.id, error: (error as Error).message });
        }
      }

      return { scanned: candidates.length, notified };
    } finally {
      await shadow.flush();
    }
  }
}
