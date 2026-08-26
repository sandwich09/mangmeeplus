export type FailureMatrixCoverage = 'LIVE' | 'PARTIAL' | 'PLANNED';
export type FailureMatrixSeverity = 'WARNING' | 'HIGH' | 'CRITICAL';

export type FailureMatrixEvidence = Readonly<{ path: string; token: string }>;

export type CustomerJourneyFailureCase = Readonly<{
  key: string;
  severity: FailureMatrixSeverity;
  owner: string;
  coverage: FailureMatrixCoverage;
  detection: string | null;
  alarm: string | null;
  runbookAnchor: string;
  recovery: string | null;
  noDuplicateInvariant: string | null;
  evidence: readonly FailureMatrixEvidence[];
  gap: string | null;
}>;

const RUNBOOK = 'docs/runbooks/customer-journey-signal-triage.md';

/**
 * P9-2 source-of-truth matrix. LIVE means detect, alert, diagnose and safe recovery/no-duplicate
 * behavior all have executable source evidence. PARTIAL and PLANNED are deliberate release gaps.
 */
export const CUSTOMER_JOURNEY_FAILURE_MATRIX = [
  {
    key: 'api-timeout-5xx', severity: 'CRITICAL', owner: 'platform-operations', coverage: 'LIVE',
    detection: 'API request log: msg=request AND status>=500',
    alarm: '*-api-5xx-high', runbookAnchor: `${RUNBOOK}#api-timeout-and-5xx`,
    recovery: 'Diagnose by requestId, then roll back or forward-fix the immutable release.',
    noDuplicateInvariant: 'Synthetic probe is read-only; a business mutation is retried only after durable source-state reconciliation.',
    evidence: [
      { path: 'apps/api/src/common/middleware/request-logger.middleware.spec.ts', token: 'captures a 500 response for the API alarm' },
      { path: 'infra/monitoring/runtime-alarms.spec.sh', token: 'api-5xx-high' },
    ], gap: null,
  },
  {
    key: 'redis-rate-limit-unavailable', severity: 'HIGH', owner: 'platform-security', coverage: 'LIVE',
    detection: 'api.rate_limit.store_degraded with root riskLevel=HIGH',
    alarm: '*-security', runbookAnchor: `${RUNBOOK}#redis-rate-limit-unavailable`,
    recovery: 'Local limiter keeps the API available while Redis connectivity is restored.',
    noDuplicateInvariant: 'The limiter transition performs no business mutation and emits once per degraded edge.',
    evidence: [
      { path: 'apps/api/src/common/logger/security-event-emitters.spec.ts', token: 'alarms on the transition, not once per request' },
      { path: 'infra/prod-ecs-express/deploy.sh', token: 'security-high-risk' },
    ], gap: null,
  },
  {
    key: 'outbox-backlog-dead', severity: 'CRITICAL', owner: 'accounting-platform', coverage: 'PARTIAL',
    detection: 'outbox.dead_rows with root riskLevel=HIGH plus durable DEAD state',
    alarm: '*-security', runbookAnchor: `${RUNBOOK}#outbox-worker-drain`,
    recovery: 'Stalled PROCESSING rows are fenced and reclaimed; DEAD rows require a future governed reconciler.',
    noDuplicateInvariant: 'Atomic claim token fencing and idempotent inbox ingestion prevent concurrent duplicate completion.',
    evidence: [
      { path: 'apps/api/src/modules/workflow/application/use-cases/workflow-outbox-drain.use-case.spec.ts', token: 'logs DEAD rows each sweep at HIGH risk' },
      { path: 'apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-outbox.repository.spec.ts', token: 'never resurrects DEAD' },
    ], gap: 'No approved DEAD-row replay/reconciliation path exists yet; detect and diagnose are live, recovery is not.',
  },
  {
    key: 'ses-hard-bounce-provider-outage', severity: 'CRITICAL', owner: 'growth-platform', coverage: 'PLANNED',
    detection: null, alarm: null, runbookAnchor: `${RUNBOOK}#claim-email-delivery`, recovery: null,
    noDuplicateInvariant: 'P11 requires one outbox eventKey per signup request and suppression-aware resend policy.',
    evidence: [
      { path: 'docs/specs/mangmee-email-delivery-claim-spec-th.md', token: 'SES adapter NOT FOUND' },
    ], gap: 'P11 SES adapter, attempt state, delivery-event consumer and provider configuration are not implemented.',
  },
  {
    key: 'line-invalid-signature', severity: 'HIGH', owner: 'identity-access', coverage: 'LIVE',
    detection: 'line.webhook.signature_invalid with root riskLevel=HIGH',
    alarm: '*-security', runbookAnchor: `${RUNBOOK}#line-invalid-signature`,
    recovery: 'Reject before enqueue; correct the channel secret and replay only the original signed provider event.',
    noDuplicateInvariant: 'A forged request enqueues zero events; provider redelivery keeps the original webhook event identity.',
    evidence: [
      { path: 'apps/api/src/modules/auth/line-webhook.controller.spec.ts', token: 'rejects invalid signature before enqueueing' },
      { path: 'infra/prod-ecs-express/deploy.sh', token: 'security-high-risk' },
    ], gap: null,
  },
  {
    key: 'line-provider-error', severity: 'CRITICAL', owner: 'ai-experience', coverage: 'LIVE',
    detection: 'line.ai.terminal terminalClass=delivery_pending|failed_terminal',
    alarm: '*-ai-ocr-failure-high', runbookAnchor: `${RUNBOOK}#line-provider-error`,
    recovery: 'Keep the original ledger item pending and use its governed drain/orphan recovery path.',
    noDuplicateInvariant: 'Delivery recovery reuses the durable LINE ledger item; it does not create a second business turn.',
    evidence: [
      { path: 'apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', token: 'keeps a failed deterministic rich reply in delivery_pending' },
      { path: 'apps/api/src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.spec.ts', token: 'never pushes a stored outcome twice when another sweeper won the claim' },
      { path: 'infra/monitoring/runtime-alarms.sh', token: '$.terminalClass = "failed_terminal"' },
    ], gap: null,
  },
  {
    key: 'ocr-hosted-ai-timeout-fallback', severity: 'CRITICAL', owner: 'accounting-ai', coverage: 'LIVE',
    detection: 'receipt OCR gateway unreachable/error or ai.provider.failure',
    alarm: '*-ai-ocr-failure-high', runbookAnchor: `${RUNBOOK}#receipt-ocr`,
    recovery: 'Return a reviewable failed/not-configured result and retry only the OCR suggestion boundary.',
    noDuplicateInvariant: 'OCR failure writes no accounting fields; human review and explicit confirmation remain authoritative.',
    evidence: [
      { path: 'apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts', token: 'returns a reviewable failure when the OCR gateway is unreachable' },
      { path: 'apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts', token: 'AgentCore timeout retains the signed expected identity' },
      { path: 'infra/monitoring/runtime-alarms.spec.sh', token: 'ai-ocr-failure-high' },
    ], gap: null,
  },
  {
    key: 'db-audit-outbox-failure', severity: 'CRITICAL', owner: 'platform-operations', coverage: 'PARTIAL',
    detection: 'audit.persist.failed riskLevel=CRITICAL and durable outbox FAILED/DEAD state',
    alarm: '*-security', runbookAnchor: `${RUNBOOK}#database-audit-and-outbox-failure`,
    recovery: 'Audit retry is bounded to one; outbox failures back off and terminalize at DEAD.',
    noDuplicateInvariant: 'Post-commit audit failure never turns a committed mutation into a 500; outbox completion is claim-token fenced.',
    evidence: [
      { path: 'apps/api/src/modules/audit/audit.service.spec.ts', token: 'post-commit mode never throws and emits audit.persist.failed' },
      { path: 'apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-outbox.repository.spec.ts', token: 'marks as DEAD after 5 attempts' },
    ], gap: 'Audit/outbox detection and bounded retry are live; governed DEAD-row recovery remains absent.',
  },
  {
    key: 'provisioning-partial-failure', severity: 'CRITICAL', owner: 'growth-platform', coverage: 'PLANNED',
    detection: null, alarm: null, runbookAnchor: `${RUNBOOK}#tenant-provision`, recovery: null,
    noDuplicateInvariant: 'P10 requires signupRequestId-bound, once-only company provisioning.',
    evidence: [
      { path: 'docs/specs/mangmee-external-signup-contract-spec-th.md', token: 'PROVISIONING_FAILED' },
    ], gap: 'P10 external signup state machine and provisioning orchestrator are not implemented.',
  },
] as const satisfies readonly CustomerJourneyFailureCase[];
