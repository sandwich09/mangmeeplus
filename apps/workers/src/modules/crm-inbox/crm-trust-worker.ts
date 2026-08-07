import { type Worker } from 'bullmq';
import { startScanWorker } from '../../common/scan-worker.js';

const CRM_TRUST_QUEUE = 'crm-trust';
const TRUST_SCAN_INTERVAL_MS = 3_600_000;

type CrmTrustJobPayload = { kind: 'trust.scan' };

export function startCrmTrustWorker(redisUrl: string): Worker {
  return startScanWorker<CrmTrustJobPayload>({
    queueName: CRM_TRUST_QUEUE,
    kind: 'trust.scan',
    jobId: 'crm-trust-score-scan',
    intervalMs: TRUST_SCAN_INTERVAL_MS,
    path: '/internal/crm/trust-score-scan',
    failEvent: 'crm_trust_job_failed',
    redisUrl,
  });
}
