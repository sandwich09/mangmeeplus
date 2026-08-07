import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateCrmCampaignInput, RequestContext, SendCrmCampaignInput } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { campaignContentHash, recipientEligibility } from '../../domain/logic/crm-campaign.logic';
import { unsyncedCampaignMetrics } from '../../domain/logic/crm-campaign-metrics.logic';
import { PrismaCrmCampaignRepository } from '../../infrastructure/prisma-crm-campaign.repository';
import { assertBroadcastEnabled, assertReleaseOneBroadcastPayload } from '../../domain/logic/crm-deferred-feature.logic';

const requirePermission = (ctx: RequestContext, key: string) => { if (!ctx.permissions.includes(key)) throw new ForbiddenException(`Missing permission: ${key}`); };
const dto = (r: any) => ({
  ...r,
  imageUrl: r.imageUrl ?? undefined,
  scheduledAt: r.scheduledAt?.toISOString(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  metrics: unsyncedCampaignMetrics({
    targetedCount: r.recipientCount ?? 0,
    eligibleCount: r.recipientCount ?? 0,
    // Legacy DB column `deliveredCount` currently records successful LINE API
    // acceptance. Expose the truthful meaning through metrics.accepted.
    providerAcceptedCount: r.deliveredCount ?? 0,
  }),
});

@Injectable()
export class CrmCampaignUseCase {
  constructor(private readonly repo: PrismaCrmCampaignRepository, private readonly audit: AuditService) {}
  async list(ctx: RequestContext) { assertBroadcastEnabled(); requirePermission(ctx, 'crm.campaign.read'); return (await this.repo.list(ctx.companyId)).map(dto); }
  async create(ctx: RequestContext, input: CreateCrmCampaignInput) {
    assertBroadcastEnabled();
    assertReleaseOneBroadcastPayload(input);
    requirePermission(ctx, 'crm.campaign.manage');
    const name = input.name?.trim(), messageText = input.messageText?.trim();
    if (!name || !messageText || messageText.length > 5000) throw new BadRequestException('Valid name and messageText (max 5000) are required');
    const record = await this.repo.create({ companyId: ctx.companyId, channelId: input.channelId, name, messageText, imageUrl: input.imageUrl, segmentJson: input.segment as any, contentHash: campaignContentHash(messageText, input.imageUrl), createdByUserId: ctx.userId });
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.campaign.create', targetType: 'crm_campaign', targetId: record.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH' });
    return dto(record);
  }
  async preview(ctx: RequestContext, id: string) {
    assertBroadcastEnabled();
    requirePermission(ctx, 'crm.campaign.manage'); const c = await this.repo.find(ctx.companyId, id); if (!c) throw new NotFoundException('Campaign not found');
    const identities = await this.repo.eligible(ctx.companyId, c.channelId, (c.segmentJson as any)?.tier);
    const states = identities.map(i => recipientEligibility({ consentStatus: i.consentStatus, identityStatus: i.status, unfollowedAt: i.unfollowedAt }));
    const eligibleCount = states.filter(s => s === 'ELIGIBLE').length;
    return { eligibleCount, excludedConsentCount: states.filter(s => s === 'SKIPPED_CONSENT').length, excludedUnreachableCount: states.filter(s => s === 'SKIPPED_UNREACHABLE').length, quotaSufficient: true };
  }
  async send(ctx: RequestContext, id: string, input: SendCrmCampaignInput) {
    assertBroadcastEnabled();
    assertReleaseOneBroadcastPayload(input);
    requirePermission(ctx, 'crm.campaign.send'); const c = await this.repo.find(ctx.companyId, id); if (!c) throw new NotFoundException('Campaign not found');
    if (!['DRAFT','READY','PARTIAL','FAILED'].includes(c.status)) throw new BadRequestException(`Campaign cannot send from ${c.status}`);
    const preview = await this.preview({ ...ctx, permissions: [...ctx.permissions, 'crm.campaign.manage'] }, id);
    if (!preview.eligibleCount) throw new BadRequestException('Campaign has no eligible recipients');
    const identities = await this.repo.eligible(ctx.companyId, c.channelId, (c.segmentJson as any)?.tier);
    await this.repo.snapshot(c, identities.filter(i => recipientEligibility({ consentStatus: i.consentStatus, identityStatus: i.status, unfollowedAt: i.unfollowedAt }) === 'ELIGIBLE'));
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : undefined;
    await this.repo.update(ctx.companyId, id, { status: scheduledAt && scheduledAt > new Date() ? 'SCHEDULED' : 'QUEUED', scheduledAt, recipientCount: preview.eligibleCount, sendIdempotencyKey: input.idempotencyKey, approvedByUserId: ctx.userId });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'crm.campaign.send', targetType: 'crm_campaign', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { recipientCount: preview.eligibleCount, scheduledAt: input.scheduledAt } });
    return dto((await this.repo.find(ctx.companyId, id))!);
  }
}
