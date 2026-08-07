import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { LineLoginVerifierAdapter } from '../../../auth/infrastructure/line-login-verifier.adapter';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import {
  PrismaCrmPdpaSelfServiceRepository,
  type CrmCustomerDataExport,
  type CrmCustomerDataExportPage,
  type CrmErasureCase,
} from '../../infrastructure/prisma-crm-pdpa-self-service.repository';
import { retentionCutoffs } from '../../domain/logic/crm-pdpa-purge.logic';
import {
  PDPA_ERASED_DISPLAY_NAME,
  PDPA_PURGE_BATCH_LIMIT,
  PDPA_PURGED_CONTENT_MARKER,
} from '../../domain/crm-inbox.constants';
import { PrismaService } from '../../../../common/database/prisma.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { AppConfigService } from '../../../../common/config/app-config.service';

const CRM_CUSTOMER_CONSENT_WITHDRAW_NOTE = 'PDPA consent withdrawn by customer via LINE LIFF';

export interface CrmPdpaPurgeResult {
  textPurged: number;
  mediaPurged: number;
  previewsCleared: number;
  aiTurnsPurged: number;
  aiConversationsPurged: number;
}

/**
 * Time-based PDPA retention sweep (A6). Worker-triggered, cross-company, one bounded
 * batch per call — the worker re-fires so the backlog drains without a long-running
 * transaction. Redacts message text > 24 months and media blobs > 12 months, always
 * exempting finance-linked records. A summary system-audit row is written when
 * anything was purged (mirrors the sensitivity of the operation).
 */
@Injectable()
export class PurgeCrmPdpaUseCase {
  private readonly logger = new Logger(PurgeCrmPdpaUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async execute(limit = PDPA_PURGE_BATCH_LIMIT): Promise<CrmPdpaPurgeResult> {
    const now = new Date();
    const { textBefore, mediaBefore } = retentionCutoffs(now);

    const textPurged = await this.repo.purgeExpiredMessageText(textBefore, limit, PDPA_PURGED_CONTENT_MARKER);
    const previewsCleared = await this.repo.clearExpiredConversationPreviews(textBefore);
    const mediaPurged = await this.repo.purgeExpiredMedia(mediaBefore, limit, now, PDPA_PURGED_CONTENT_MARKER);
    const aiBefore = new Date(now.getTime() - this.config.aiDataRetentionDays * 24 * 60 * 60 * 1000);
    const { turns: aiTurnsPurged, conversations: aiConversationsPurged } = await this.repo.purgeExpiredAiData(aiBefore, limit);

    if (textPurged + mediaPurged + aiTurnsPurged + aiConversationsPurged > 0) {
      // System sweep: no per-company actor; companyId omitted (nullable in the schema).
      await this.audit.log({
        actorType: 'SYSTEM',
        actorRefId: 'crm-pdpa-sweep',
        action: 'crm.pdpa.purge_sweep',
        targetType: 'crm_pdpa',
        requestId: `pdpa-sweep-${now.toISOString()}`,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: {
          textPurged, mediaPurged, previewsCleared, aiTurnsPurged, aiConversationsPurged,
          textBefore: textBefore.toISOString(), mediaBefore: mediaBefore.toISOString(), aiBefore: aiBefore.toISOString(),
        },
      });
      this.logger.log({ msg: 'PDPA purge sweep', textPurged, mediaPurged, previewsCleared, aiTurnsPurged, aiConversationsPurged });
    }
    return { textPurged, mediaPurged, previewsCleared, aiTurnsPurged, aiConversationsPurged };
  }
}

export interface CrmCustomerErasureResult {
  customerId: string;
  messagesRedacted: number;
  mediaPurged: number;
  auditLogId: string;
  retainedFinanceAttachments: number;
}

/**
 * On-demand PDPA erasure — right-to-be-forgotten (A6). Redacts a single customer's
 * non-finance message content + media, scrubs their PII and LINE identity, and audits
 * the action (CRITICAL). Finance-linked records are legally retained. Idempotent:
 * re-running on an already-erased customer is a no-op that still audits.
 */
@Injectable()
export class EraseCrmCustomerUseCase {
  constructor(private readonly repo: PrismaCrmInboxRepository) {}

  async execute(ctx: RequestContext, customerId: string, reason?: string): Promise<CrmCustomerErasureResult> {
    let erased: Awaited<ReturnType<PrismaCrmInboxRepository['eraseCustomerData']>>;
    try {
      erased = await this.repo.eraseCustomerData({
        companyId: ctx.companyId,
        customerId,
        now: new Date(),
        marker: PDPA_PURGED_CONTENT_MARKER,
        erasedDisplayName: PDPA_ERASED_DISPLAY_NAME,
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        reason,
      });
    } catch (error) {
      if ((error as Error).message === 'customer_not_found') throw new NotFoundException('Customer not found');
      throw error;
    }
    const { messagesRedacted, mediaPurged, retainedFinanceAttachments } = erased;

    return { customerId: erased.customerId, messagesRedacted, mediaPurged, retainedFinanceAttachments, auditLogId: erased.auditLogId };
  }
}

export type CrmCustomerSelfServiceInput = {
  idToken: string;
  lineChannelId: string;
  requestId: string;
  ipAddress?: string;
  page?: CrmCustomerDataExportPage;
};

/**
 * CUST-08 — customer-initiated PDPA request lifecycle (self-service). Distinct from
 * the staff-initiated EraseCrmCustomerUseCase above: the actor is the CRM customer,
 * proven by a LIFF-verified LINE identity, and every action is audited as
 * actorType CRM_CUSTOMER / actorRefId=customerId (never a staff actorUserId).
 * Consent-withdrawal and export are fully self-contained here; the erasure PURGE
 * reuses the shipped erasure engine but is deferred to a coordinator serial step
 * (see requestErasure).
 */
@Injectable()
export class CrmCustomerSelfServiceUseCase {
  constructor(
    private readonly verifier: LineLoginVerifierAdapter,
    private readonly inboxRepo: PrismaCrmInboxRepository,
    private readonly selfService: PrismaCrmPdpaSelfServiceRepository,
    private readonly audit: AuditService,
  ) {}

  async withdrawConsent(input: CrmCustomerSelfServiceInput): Promise<{ customerId: string; consentStatus: 'REVOKED' }> {
    const { companyId, customerId } = await this.resolveVerifiedCustomer(input);
    const { updated } = await this.selfService.revokeConsent(companyId, customerId, new Date(), CRM_CUSTOMER_CONSENT_WITHDRAW_NOTE);
    if (!updated) throw new NotFoundException('Customer not found');
    await this.audit.log({
      companyId,
      actorType: 'CRM_CUSTOMER',
      actorRefId: customerId,
      action: AuditAction.ACCESS_CRM_CUSTOMER_SELF_CONSENT_WITHDRAW,
      targetType: 'crm_customer',
      targetId: customerId,
      requestId: input.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
    });
    // ponytail: pending autonomy jobs are NOT force-cancelled here — the live
    // consent fence in crm-ai-auto-reply already DENYs any reply for a REVOKED
    // customer, so a draining job cannot leak a message. Eager cancellation is a
    // cleanup optimization deferred to the coordinator (needs a CrmAutonomyJob
    // write on the autonomy-owned prisma-crm-inbox repo — signature in lane report).
    return { customerId, consentStatus: 'REVOKED' };
  }

  async exportData(input: CrmCustomerSelfServiceInput): Promise<CrmCustomerDataExport> {
    const { companyId, customerId } = await this.resolveVerifiedCustomer(input);
    const data = await this.selfService.exportCustomerData(companyId, customerId, input.page);
    if (!data) throw new NotFoundException('Customer not found');
    await this.audit.log({
      companyId,
      actorType: 'CRM_CUSTOMER',
      actorRefId: customerId,
      action: AuditAction.ACCESS_CRM_CUSTOMER_SELF_EXPORT,
      targetType: 'crm_customer',
      targetId: customerId,
      requestId: input.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: {
        conversations: data.conversations.length,
        messages: data.messages.length,
        bookings: data.bookings.length,
        pagination: data.pagination,
      },
    });
    return data;
  }

  async requestErasure(input: CrmCustomerSelfServiceInput & { reason?: string }): Promise<{
    customerId: string;
    caseId: string;
    status: string;
    requestedAt: Date;
    dueAt: Date;
  }> {
    const { companyId, customerId } = await this.resolveVerifiedCustomer(input);
    const requestCase = await this.selfService.createOrGetErasureCase(
      companyId,
      customerId,
      Boolean(input.reason?.trim()),
      new Date(),
    );
    await this.audit.log({
      companyId,
      actorType: 'CRM_CUSTOMER',
      actorRefId: customerId,
      action: AuditAction.ACCESS_CRM_CUSTOMER_SELF_ERASURE_REQUEST,
      targetType: 'crm_data_subject_request',
      targetId: requestCase.id,
      requestId: input.requestId,
      result: 'SUCCESS',
      riskLevel: 'CRITICAL',
      metadataJson: { customerId, reasonProvided: Boolean(input.reason?.trim()), status: requestCase.status },
    });
    return {
      customerId,
      caseId: requestCase.id,
      status: requestCase.status,
      requestedAt: requestCase.requestedAt,
      dueAt: requestCase.dueAt,
    };
  }

  async getErasureStatus(input: CrmCustomerSelfServiceInput & { caseId: string }): Promise<CrmErasureCase> {
    const { companyId, customerId } = await this.resolveVerifiedCustomer(input);
    const requestCase = await this.selfService.findErasureCase(companyId, customerId, input.caseId);
    if (!requestCase) throw new NotFoundException('Erasure request not found');
    return requestCase;
  }

  /**
   * Anti-spoof trust anchor: only a LIFF-verified, actively-linked LINE identity
   * resolves to a customer. verify() proves the id token; the identity must be an
   * ACTIVE, verifiedLinkAt-stamped link on an enabled channel. companyId is taken
   * from the channel, never from client input, so a caller cannot reach another
   * tenant's customer.
   */
  private async resolveVerifiedCustomer(input: CrmCustomerSelfServiceInput): Promise<{ companyId: string; customerId: string }> {
    const { subject: providerUserId } = await this.verifier.verify(input.idToken);
    const channel = await this.inboxRepo.findActiveChannelByLineChannelId(input.lineChannelId);
    if (!channel) throw new NotFoundException('channel_not_found');
    const identity = await this.inboxRepo.findIdentity(channel.id, providerUserId);
    if (!identity || identity.status !== 'ACTIVE' || identity.verifiedLinkAt === null) {
      throw new UnauthorizedException('identity_not_verified');
    }
    return { companyId: channel.companyId, customerId: identity.customerId };
  }
}

@Injectable()
export class ProcessCrmErasureRequestsUseCase {
  constructor(
    private readonly selfService: PrismaCrmPdpaSelfServiceRepository,
    private readonly inboxRepo: PrismaCrmInboxRepository,
    private readonly prisma: PrismaService,
    private readonly notifications: CreateOrUpdateNotificationEventUseCase,
    private readonly audit: AuditService,
  ) {}

  async execute(limit = 20): Promise<{ processed: number; completed: number; failed: number }> {
    let processed = 0;
    let completed = 0;
    let failed = 0;
    while (processed < Math.max(1, Math.min(limit, 100))) {
      const requestCase = await this.selfService.claimNextErasureCase(new Date());
      if (!requestCase) break;
      processed += 1;
      try {
        const erased = await this.inboxRepo.eraseCustomerData({
          companyId: requestCase.companyId,
          customerId: requestCase.customerId,
          now: new Date(),
          marker: PDPA_PURGED_CONTENT_MARKER,
          erasedDisplayName: PDPA_ERASED_DISPLAY_NAME,
          actorType: 'CRM_CUSTOMER',
          actorRefId: requestCase.customerId,
          requestId: `dsar:${requestCase.id}`,
        });
        await this.notifyOwners(requestCase, 'completed');
        await this.selfService.completeErasureCase(
          requestCase.id,
          erased.retainedFinanceAttachments > 0 ? 'COMPLETED_WITH_EXCEPTION' : 'COMPLETED',
          {
            customerId: erased.customerId,
            messagesRedacted: erased.messagesRedacted,
            mediaPurged: erased.mediaPurged,
            retainedFinanceAttachments: erased.retainedFinanceAttachments,
            auditLogId: erased.auditLogId,
          },
          new Date(),
        );
        completed += 1;
      } catch (error) {
        const code = error instanceof Error && error.message ? error.message : 'ERASURE_PROCESSING_FAILED';
        await this.selfService.failErasureCase(requestCase.id, requestCase.attemptCount, code, new Date());
        await this.audit.log({
          companyId: requestCase.companyId,
          actorType: 'SYSTEM',
          actorRefId: 'crm-pdpa-erasure-worker',
          action: 'crm.pdpa.erasure.failed',
          targetType: 'crm_data_subject_request',
          targetId: requestCase.id,
          requestId: `dsar:${requestCase.id}`,
          result: 'FAILED',
          riskLevel: 'HIGH',
          metadataJson: { attemptCount: requestCase.attemptCount, errorCode: code },
        });
        if (requestCase.attemptCount >= 5) {
          await this.notifyOwners(requestCase, 'failed').catch(() => undefined);
          failed += 1;
        }
      }
    }
    return { processed, completed, failed };
  }

  async replayAfterRestore(restoredSnapshotAt: Date): Promise<{
    requeued: number;
    processed: number;
    completed: number;
    failed: number;
  }> {
    if (!Number.isFinite(restoredSnapshotAt.getTime()) || restoredSnapshotAt > new Date()) {
      throw new Error('INVALID_RESTORE_SNAPSHOT_TIME');
    }
    const requeued = await this.selfService.requeueCompletedErasureCasesBefore(restoredSnapshotAt, new Date());
    return { requeued, ...(await this.execute(100)) };
  }

  private async notifyOwners(requestCase: CrmErasureCase, outcome: 'completed' | 'failed'): Promise<void> {
    const recipients = await this.prisma.client.companyMembership.findMany({
      where: {
        companyId: requestCase.companyId,
        status: 'ACTIVE',
        roles: { some: { role: { key: { in: ['OWNER', 'ADMIN'] } } } },
      },
      select: { userId: true },
    });
    if (recipients.length === 0) throw new Error('NO_PDPA_NOTIFICATION_RECIPIENT');
    await this.notifications.execute({
      companyId: requestCase.companyId,
      triggerKey: `crm_pdpa_erasure_${outcome}`,
      sourceModule: 'crm',
      sourceType: 'crm_data_subject_request',
      sourceId: requestCase.id,
      severity: outcome === 'completed' ? 'info' : 'critical',
      title: outcome === 'completed' ? 'ดำเนินการคำขอลบข้อมูลแล้ว' : 'คำขอลบข้อมูลต้องตรวจสอบ',
      body: outcome === 'completed'
        ? 'คำขอลบข้อมูลเสร็จสิ้นหรือเก็บเฉพาะข้อมูลที่กฎหมายกำหนด'
        : 'คำขอลบข้อมูลไม่สำเร็จหลังการลองซ้ำ กรุณาตรวจสอบทันที',
      recipientUserIds: recipients.map((recipient) => recipient.userId),
    });
  }
}
