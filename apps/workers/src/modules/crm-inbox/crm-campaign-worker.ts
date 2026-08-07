import { startScanWorker } from '../../common/scan-worker.js';

export function startCrmCampaignWorker(redisUrl: string) {
  return startScanWorker({ queueName: 'crm-campaign-delivery', kind: 'deliver', jobId: 'crm-campaign-delivery', intervalMs: 15_000, path: '/internal/crm/campaign-delivery-scan', failEvent: 'crm_campaign_delivery_failed', redisUrl });
}
