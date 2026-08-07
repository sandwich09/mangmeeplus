import type { CrmCampaignMetrics } from '@watchdog-bms/contracts';

/**
 * Metrics available before a LINE Insight sync exists. `providerAcceptedCount`
 * means LINE returned a successful API response; it must never be labelled as
 * delivered/opened. Reply and attribution also remain unavailable until their
 * explicit correlation pipelines are implemented.
 */
export function unsyncedCampaignMetrics(input: {
  targetedCount: number;
  eligibleCount: number;
  providerAcceptedCount: number;
}): CrmCampaignMetrics {
  const count = (value: number) => ({ value, source: 'MANGMEE' as const });
  const unsupported = () => ({ value: null, source: 'UNSUPPORTED' as const, reason: 'NOT_SUPPORTED' as const });
  const notSynced = () => ({ value: null, source: 'LINE_INSIGHT' as const, reason: 'NOT_SYNCED' as const });
  return {
    targeted: count(input.targetedCount),
    eligible: count(input.eligibleCount),
    accepted: count(input.providerAcceptedCount),
    delivered: notSynced(),
    open: notSynced(),
    click: notSynced(),
    reply: unsupported(),
    attribution: unsupported(),
  };
}
