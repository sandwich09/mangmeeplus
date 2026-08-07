import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';

@Injectable()
export class PrismaCrmCampaignRepository {
  constructor(private readonly prisma: PrismaService) {}
  list(companyId: string) { return this.prisma.client.crmCampaign.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } }); }
  find(companyId: string, id: string) { return this.prisma.client.crmCampaign.findFirst({ where: { companyId, id } }); }
  create(data: Parameters<typeof this.prisma.client.crmCampaign.create>[0]['data']) { return this.prisma.client.crmCampaign.create({ data }); }
  update(companyId: string, id: string, data: Parameters<typeof this.prisma.client.crmCampaign.updateMany>[0]['data']) {
    return this.prisma.client.crmCampaign.updateMany({ where: { companyId, id }, data });
  }
  eligible(companyId: string, channelId: string, tier?: string) {
    return this.prisma.client.$queryRaw<Array<{ id: string; customerId: string; providerUserId: string; status: string; unfollowedAt: Date | null; consentStatus: string }>>`
      SELECT i.id, i."customerId", i."providerUserId", i.status::text, i."unfollowedAt", c."consentStatus"::text
      FROM "CrmChannelIdentity" i JOIN "CrmCustomer" c ON c.id=i."customerId" AND c."companyId"=i."companyId"
      WHERE i."companyId"=${companyId} AND i."channelId"=${channelId}
        AND (${tier ?? null}::text IS NULL OR c.tier::text=${tier ?? null})`;
  }
  snapshot(campaign: { id: string; companyId: string }, rows: Array<{ id: string; customerId: string; providerUserId: string; consentStatus: string }>) {
    return this.prisma.client.crmCampaignRecipient.createMany({ data: rows.map(r => ({ companyId: campaign.companyId, campaignId: campaign.id, customerId: r.customerId, channelIdentityId: r.id, providerUserId: r.providerUserId, consentSnapshot: r.consentStatus as never })), skipDuplicates: true });
  }
  due(limit = 50) { return this.prisma.client.crmCampaignRecipient.findMany({ where: { status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }], campaign: { status: { in: ['QUEUED','SENDING','PARTIAL'] } } }, include: { campaign: true }, take: limit, orderBy: { createdAt: 'asc' } }); }
  claim(id: string) { return this.prisma.client.crmCampaignRecipient.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'SENDING', attempts: { increment: 1 } } }); }
  recipient(id: string) { return this.prisma.client.crmCampaignRecipient.findUnique({ where: { id }, include: { channelIdentity: true, campaign: true } }); }
  currentConsent(companyId: string, customerId: string) { return this.prisma.client.crmCustomer.findFirst({ where: { companyId, id: customerId }, select: { consentStatus: true } }); }
  deliveryResult(id: string, ok: boolean, error?: string, retry = false) { return this.prisma.client.crmCampaignRecipient.update({ where: { id }, data: retry ? { status: 'PENDING', lastError: error, nextAttemptAt: new Date(Date.now() + 60_000) } : { status: ok ? 'DELIVERED' : 'FAILED', lastError: error, sentAt: ok ? new Date() : undefined } }); }
  async reconcile(campaignId: string) {
    const [delivered, failed, pending] = await Promise.all(['DELIVERED','FAILED','PENDING'].map(status => this.prisma.client.crmCampaignRecipient.count({ where: { campaignId, status: status as never } })));
    const status = pending ? 'SENDING' : delivered && failed ? 'PARTIAL' : delivered ? 'COMPLETED' : 'FAILED';
    return this.prisma.client.crmCampaign.update({ where: { id: campaignId }, data: { status, deliveredCount: delivered, failedCount: failed, ...(pending ? {} : { finishedAt: new Date() }) } });
  }
}
