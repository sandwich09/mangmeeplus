import { Injectable } from '@nestjs/common';
import { PrismaCrmCampaignRepository } from '../../infrastructure/prisma-crm-campaign.repository';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { LineMessagingAdapter } from '../../infrastructure/line-messaging.adapter';
import { MessagingChannelSecretsService } from './messaging-channel.use-case';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { recipientEligibility } from '../../domain/logic/crm-campaign.logic';

/** Campaign delivery is an outbound CRM send; `crm` owns its launch route (F1.3 matrix). */
const CAMPAIGN_FEATURE_KEY = 'crm';

@Injectable()
export class DeliverCrmCampaignUseCase {
  constructor(private readonly campaigns: PrismaCrmCampaignRepository, private readonly inbox: PrismaCrmInboxRepository, private readonly secrets: MessagingChannelSecretsService, private readonly line: LineMessagingAdapter, private readonly shadow: LaunchShadowProbe) {}
  async execute() {
    const due = await this.campaigns.due(); let delivered = 0, failed = 0;
    // SHADOW ONLY (plan §3 F1): this sweep is a webhook/scanner path that never resolves
    // permissions, so it is entitlement-blind today. Record what the guard WOULD decide per
    // recipient, then deliver exactly as before. Nothing here branches on the result.
    const sweep = this.shadow.startSweep('crm.campaign.delivery');
    try {
      for (const item of due) {
        if (!(await this.campaigns.claim(item.id)).count) continue;
        const current = await this.campaigns.recipient(item.id); if (!current) continue;
        await sweep.record(current.companyId, CAMPAIGN_FEATURE_KEY);
        const customer = await this.campaigns.currentConsent(current.companyId, current.customerId);
        const policy = await this.inbox.getConsentPolicy(current.companyId);
        const eligibility = recipientEligibility({ consentStatus: customer?.consentStatus ?? 'REVOKED', identityStatus: current.channelIdentity.status, unfollowedAt: current.channelIdentity.unfollowedAt, marketingRequiresExplicitConsent: policy.marketingRequiresExplicitConsent });
        if (eligibility !== 'ELIGIBLE') { await this.campaigns.deliveryResult(item.id, false, eligibility); failed++; await this.campaigns.reconcile(item.campaignId); continue; }
        const channel = await this.inbox.findChannelById(current.companyId, current.campaign.channelId);
        if (!channel || channel.status !== 'ACTIVE') { await this.campaigns.deliveryResult(item.id, false, 'channel_unavailable', true); continue; }
        const result = await this.line.pushTextMessage(this.secrets.decrypt(channel).accessToken, current.providerUserId, current.campaign.messageText, current.retryKey);
        await this.campaigns.deliveryResult(item.id, result.ok, result.ok ? undefined : result.error, !result.ok && ['line_api_unreachable','line_api_429'].includes(result.error));
        result.ok ? delivered++ : failed++; await this.campaigns.reconcile(item.campaignId);
      }
    } finally {
      // `finally`, not a trailing await: an observation already recorded IS evidence, and a
      // repository/decryption error mid-sweep would otherwise drop it with no bucket row and no
      // persist_failed warn — later healthy sweeps would then make the view look normal while a
      // BLOCKING observation had silently vanished. `flush()` never throws (it swallows and warns),
      // so this cannot mask the original error. The hour is still stamped inside flush.
      await sweep.flush();
    }
    return { processed: due.length, delivered, failed };
  }
}
