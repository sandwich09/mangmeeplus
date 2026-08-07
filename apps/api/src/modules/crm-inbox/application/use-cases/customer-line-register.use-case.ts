import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LineLoginVerifierAdapter } from '../../../auth/infrastructure/line-login-verifier.adapter';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { PrismaCrmRepository } from '../../../crm/infrastructure/prisma-crm.repository';
import { CUSTOMER_PLACEHOLDER_NAME, PDPA_CONSENT_NOTICE_TEXT } from '../../domain/crm-inbox.constants';
import type { CompanyMessagingChannelRecord, CrmChannelIdentityRecord } from '../../domain/models/crm-inbox.model';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';

const SYSTEM_ACTOR = 'system';
const CUSTOMER_DISPLAY_NAME_MAX_LENGTH = 160;

@Injectable()
export class CustomerLineRegisterUseCase {
  constructor(
    private readonly verifier: LineLoginVerifierAdapter,
    private readonly inboxRepo: PrismaCrmInboxRepository,
    private readonly crmRepo: PrismaCrmRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(input: {
    idToken: string;
    lineChannelId: string;
    consentGranted: boolean;
    ipAddress?: string;
    requestId?: string;
  }): Promise<{ customerId: string; alreadyRegistered: boolean }> {
    const requestId = input.requestId ?? randomUUID();
    let channel: CompanyMessagingChannelRecord | null = null;
    let customerId: string | undefined;

    try {
      if (!input.consentGranted) throw new BadRequestException('consent_required');

      const { subject: providerUserId, name } = await this.verifier.verify(input.idToken);
      channel = await this.inboxRepo.findActiveChannelByLineChannelId(input.lineChannelId);
      if (!channel) throw new NotFoundException('channel_not_found');

      const existing = await this.inboxRepo.findIdentity(channel.id, providerUserId);
      const result = existing
        ? await this.registerExisting(channel, existing)
        : await this.registerNew(channel, providerUserId, name);
      customerId = result.customerId;

      await this.audit.log({
        companyId: channel.companyId,
        actorType: 'CRM_CUSTOMER',
        actorRefId: customerId,
        action: AuditAction.ACCESS_CRM_CUSTOMER_SELF_REGISTER_SUCCESS,
        targetType: 'crm_customer',
        targetId: customerId,
        requestId,
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: { lineChannelId: input.lineChannelId, alreadyRegistered: result.alreadyRegistered },
      });

      return result;
    } catch (error) {
      await this.audit.log({
        companyId: channel?.companyId,
        actorType: customerId ? 'CRM_CUSTOMER' : 'SYSTEM',
        actorRefId: customerId ?? 'crm-self-register',
        action: AuditAction.ACCESS_CRM_CUSTOMER_SELF_REGISTER_FAILURE,
        targetType: 'crm_customer',
        targetId: customerId,
        requestId,
        result: 'FAILED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason: error instanceof Error ? error.message : String(error), lineChannelId: input.lineChannelId },
      });
      throw error;
    }
  }

  private async registerExisting(
    channel: CompanyMessagingChannelRecord,
    identity: CrmChannelIdentityRecord,
  ): Promise<{ customerId: string; alreadyRegistered: boolean }> {
    const now = new Date();
    const result = await this.inboxRepo.registerExistingIdentityConsent({
      companyId: channel.companyId,
      channelId: channel.id,
      identityId: identity.id,
      now,
      consentNote: PDPA_CONSENT_NOTICE_TEXT,
      updatedByUserId: SYSTEM_ACTOR,
    });
    return { customerId: result.customerId, alreadyRegistered: true };
  }

  private async registerNew(
    channel: CompanyMessagingChannelRecord,
    providerUserId: string,
    verifiedName?: string,
  ): Promise<{ customerId: string; alreadyRegistered: boolean }> {
    const now = new Date();
    try {
      const { customer } = await this.crmRepo.createLineCustomerAndIdentity({
        customer: {
          companyId: channel.companyId,
          displayName: verifiedName?.trim().slice(0, CUSTOMER_DISPLAY_NAME_MAX_LENGTH) || CUSTOMER_PLACEHOLDER_NAME,
          customerType: 'UNKNOWN',
          status: 'ACTIVE',
          source: 'LINE',
          consentStatus: 'GRANTED',
          consentUpdatedAt: now,
          consentNote: PDPA_CONSENT_NOTICE_TEXT,
          createdByUserId: SYSTEM_ACTOR,
        },
        identity: {
          channelId: channel.id,
          provider: 'LINE_OA',
          providerUserId,
          verifiedLinkAt: now,
          verifiedLinkVia: 'LIFF',
          status: 'ACTIVE',
        },
      });
      return { customerId: customer.id, alreadyRegistered: false };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const winner = await this.inboxRepo.findIdentity(channel.id, providerUserId);
        if (winner) return this.registerExisting(channel, winner);
      }
      throw error;
    }
  }
}
