export const JOURNEY_METRIC_DIMENSION_ALLOWLIST = [
  'environment',
  'service',
  'journey',
  'stage',
  'outcome',
  'failureClass',
] as const;

export const JOURNEY_METRIC_FORBIDDEN_DIMENSIONS = [
  'companyId',
  'email',
  'taxId',
  'lineUserId',
  'providerUserId',
  'prompt',
  'documentId',
  'documentPayload',
] as const;

export type JourneyLane = 'ops' | 'ai' | 'signup' | 'accounting';
export type JourneySignalCoverage = 'LIVE' | 'PARTIAL' | 'PLANNED';
export type JourneySignalSeverity = 'DASHBOARD' | 'WARNING' | 'CRITICAL';
export type JourneySignalSource =
  | 'structured_log'
  | 'audit_record'
  | 'outbox_record'
  | 'provider_event'
  | 'domain_state';

export type JourneySignalEvidence = Readonly<{
  path: string;
  token: string;
}>;

export type JourneySignalPoint = Readonly<{
  name: string;
  source: JourneySignalSource;
  selector: string;
  timestampField: string;
}>;

export type CustomerJourneySignal = Readonly<{
  key: string;
  lane: JourneyLane;
  stage: string;
  owner: string;
  coverage: JourneySignalCoverage;
  denominator: JourneySignalPoint;
  numerator: JourneySignalPoint;
  correlationKey: string;
  terminalOutcomeField: string;
  successTerminalValues: readonly string[];
  neutralTerminalValues: readonly string[];
  failureTerminalValues: readonly string[];
  latencyClock: Readonly<{ start: string; end: string; coverage: JourneySignalCoverage }>;
  severity: JourneySignalSeverity;
  runbook: string;
  target: null;
  terminalCardinality: 'exactly_one_per_accepted_correlation';
  evidence: readonly JourneySignalEvidence[];
  gap: string | null;
}>;

const RUNBOOK = 'docs/runbooks/customer-journey-signal-triage.md';

/**
 * P9-0 is deliberately a truth catalogue, not an instrumentation claim. LIVE means both the
 * accepted population and terminal outcome can be derived today. PARTIAL names the exact gap;
 * PLANNED rows reserve a stable contract for P9-1 without pretending a dashboard already exists.
 * Targets remain null until a real customer-like baseline cohort has been observed.
 */
export const CUSTOMER_JOURNEY_SIGNALS = [
  {
    key: 'official-signup-receive', lane: 'signup', stage: 'official signup receive', owner: 'growth-platform', coverage: 'PLANNED',
    denominator: { name: 'growth.signup.received', source: 'structured_log', selector: 'msg=growth.signup.received', timestampField: 'receivedAt' },
    numerator: { name: 'growth.signup.terminal', source: 'structured_log', selector: 'msg=growth.signup.terminal AND outcome=stored', timestampField: 'terminalAt' },
    correlationKey: 'signupAttemptId', terminalOutcomeField: 'outcome',
    successTerminalValues: ['stored'], neutralTerminalValues: ['duplicate_replay'],
    failureTerminalValues: ['invalid_signature', 'invalid_payload', 'rate_limited', 'idempotency_conflict', 'storage_failed'],
    latencyClock: { start: 'growth.signup.received.receivedAt', end: 'growth.signup.terminal.terminalAt', coverage: 'PLANNED' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#official-signup-receive`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation', evidence: [], gap: 'P10-1 signed public ingress is not implemented.',
  },
  {
    key: 'owner-claim', lane: 'signup', stage: 'owner account claim', owner: 'identity-access', coverage: 'PLANNED',
    denominator: { name: 'growth.claim.accepted', source: 'structured_log', selector: 'msg=growth.claim.accepted', timestampField: 'acceptedAt' },
    numerator: { name: 'growth.claim.terminal', source: 'structured_log', selector: 'msg=growth.claim.terminal AND outcome=claimed', timestampField: 'terminalAt' },
    correlationKey: 'claimAttemptId', terminalOutcomeField: 'outcome',
    successTerminalValues: ['claimed'], neutralTerminalValues: [],
    failureTerminalValues: ['expired', 'revoked', 'replayed', 'credential_conflict', 'storage_failed'],
    latencyClock: { start: 'growth.claim.accepted.acceptedAt', end: 'growth.claim.terminal.terminalAt', coverage: 'PLANNED' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#owner-claim`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation', evidence: [], gap: 'P11 claim-token lifecycle is not implemented.',
  },
  {
    key: 'tenant-provision', lane: 'signup', stage: 'company provision', owner: 'growth-platform', coverage: 'PLANNED',
    denominator: { name: 'growth.provision.accepted', source: 'structured_log', selector: 'msg=growth.provision.accepted', timestampField: 'acceptedAt' },
    numerator: { name: 'growth.provision.terminal', source: 'structured_log', selector: 'msg=growth.provision.terminal AND outcome=provisioned', timestampField: 'terminalAt' },
    correlationKey: 'signupRequestId', terminalOutcomeField: 'outcome',
    successTerminalValues: ['provisioned'], neutralTerminalValues: ['already_provisioned'],
    failureTerminalValues: ['provisioning_failed', 'compensation_failed'],
    latencyClock: { start: 'growth.provision.accepted.acceptedAt', end: 'growth.provision.terminal.terminalAt', coverage: 'PLANNED' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#tenant-provision`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation', evidence: [], gap: 'P10 provision-once orchestration is not implemented.',
  },
  {
    key: 'claim-email-delivery', lane: 'signup', stage: 'SES claim email delivery', owner: 'growth-platform', coverage: 'PLANNED',
    denominator: { name: 'email.claim_delivery.accepted', source: 'provider_event', selector: 'event=email.claim_delivery.accepted', timestampField: 'acceptedAt' },
    numerator: { name: 'email.claim_delivery.terminal', source: 'domain_state', selector: 'outcome=delivered', timestampField: 'terminalAt' },
    correlationKey: 'deliveryAttemptId', terminalOutcomeField: 'outcome',
    successTerminalValues: ['delivered'], neutralTerminalValues: ['suppressed'],
    failureTerminalValues: ['rejected', 'hard_bounce', 'provider_failed', 'complaint'],
    latencyClock: { start: 'email.claim_delivery.accepted.acceptedAt', end: 'email.claim_delivery.terminal.terminalAt', coverage: 'PLANNED' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#claim-email-delivery`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation', evidence: [], gap: 'P11 SES attempt state and delivery-event consumer are not implemented.',
  },
  {
    key: 'line-login', lane: 'signup', stage: 'LINE login', owner: 'identity-access', coverage: 'PARTIAL',
    denominator: { name: 'auth.line_login.attempt', source: 'audit_record', selector: 'action IN (auth.login.exchange,auth.login.denied) AND channel=line', timestampField: 'createdAt' },
    numerator: { name: 'auth.line_login.success', source: 'audit_record', selector: 'action=auth.login.exchange AND authProvider=line AND result=SUCCESS', timestampField: 'createdAt' },
    correlationKey: 'requestId', terminalOutcomeField: 'result',
    successTerminalValues: ['SUCCESS'], neutralTerminalValues: [], failureTerminalValues: ['DENIED'],
    latencyClock: { start: 'auth.line_login.accepted.acceptedAt', end: 'auth.line_login.terminal.terminalAt', coverage: 'PLANNED' },
    severity: 'WARNING', runbook: `${RUNBOOK}#line-login`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [
      { path: 'apps/api/src/modules/auth/application/use-cases/exchange-line-token.use-case.ts', token: 'AuditAction.AUTH_LOGIN_DENIED' },
      { path: 'apps/api/src/modules/auth/application/use-cases/issue-token.use-case.ts', token: 'AuditAction.AUTH_LOGIN_EXCHANGE' },
    ],
    gap: 'Audit outcomes support counts, but no common accepted event or accepted-to-terminal latency clock exists.',
  },
  {
    key: 'line-link', lane: 'signup', stage: 'LINE account link', owner: 'identity-access', coverage: 'PARTIAL',
    denominator: { name: 'auth.line_link.attempt', source: 'audit_record', selector: 'action=auth.identity.link', timestampField: 'createdAt' },
    numerator: { name: 'auth.line_link.success', source: 'audit_record', selector: 'action=auth.identity.link AND result=SUCCESS', timestampField: 'createdAt' },
    correlationKey: 'requestId', terminalOutcomeField: 'result',
    successTerminalValues: ['SUCCESS'], neutralTerminalValues: [], failureTerminalValues: ['DENIED', 'FAILED'],
    latencyClock: { start: 'auth.line_link.accepted.acceptedAt', end: 'auth.line_link.terminal.terminalAt', coverage: 'PLANNED' },
    severity: 'WARNING', runbook: `${RUNBOOK}#line-link`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [{ path: 'apps/api/src/modules/auth/application/use-cases/link-line-identity.use-case.ts', token: 'AuditAction.AUTH_IDENTITY_LINK' }],
    gap: 'Current link audit is not emitted on every early return or exception and has no start clock.',
  },
  {
    key: 'receipt-intake', lane: 'accounting', stage: 'receipt intake to workflow', owner: 'accounting-platform', coverage: 'PARTIAL',
    denominator: { name: 'expense.receipt_uploaded', source: 'outbox_record', selector: 'eventType=expense.receipt_uploaded', timestampField: 'createdAt' },
    numerator: { name: 'expense.receipt_uploaded.published', source: 'outbox_record', selector: 'eventType=expense.receipt_uploaded AND status=PUBLISHED', timestampField: 'publishedAt' },
    correlationKey: 'eventKey', terminalOutcomeField: 'status',
    successTerminalValues: ['PUBLISHED'], neutralTerminalValues: [], failureTerminalValues: ['DEAD'],
    latencyClock: { start: 'OutboxEvent.createdAt', end: 'OutboxEvent.publishedAt|updatedAt', coverage: 'LIVE' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#receipt-intake`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [
      { path: 'apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts', token: "append('expense.receipt_uploaded'" },
      { path: 'apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-outbox.repository.ts', token: "status: 'PUBLISHED'" },
    ],
    gap: 'Coverage starts after upload completion; rejected/abandoned upload attempts still need an intake accepted/terminal pair.',
  },
  {
    key: 'receipt-ocr', lane: 'ai', stage: 'receipt OCR', owner: 'accounting-ai', coverage: 'PARTIAL',
    denominator: { name: 'expense.ocr.outcome', source: 'audit_record', selector: 'action=expense.ocr.request', timestampField: 'createdAt' },
    numerator: { name: 'expense.ocr.success', source: 'audit_record', selector: 'action=expense.ocr.request AND result=SUCCESS', timestampField: 'createdAt' },
    correlationKey: 'requestId', terminalOutcomeField: 'result',
    successTerminalValues: ['SUCCESS'], neutralTerminalValues: [], failureTerminalValues: ['FAILED'],
    latencyClock: { start: 'expense.ocr.accepted.acceptedAt', end: 'expense.ocr.terminal.terminalAt', coverage: 'PLANNED' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#receipt-ocr`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [{ path: 'apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts', token: "action: 'expense.ocr.request'" }],
    gap: 'Completion audit exists, but accepted event, duration, and stable failureClass are not emitted.',
  },
  {
    key: 'line-ai-answer', lane: 'ai', stage: 'LINE AI accepted to terminal answer', owner: 'ai-experience', coverage: 'LIVE',
    denominator: { name: 'line.ai.accepted', source: 'structured_log', selector: 'msg=line.ai.accepted', timestampField: 'logTimestamp' },
    numerator: { name: 'line.ai.terminal', source: 'structured_log', selector: 'msg=line.ai.terminal AND terminalClass=delivered', timestampField: 'logTimestamp' },
    correlationKey: 'webhookEventId', terminalOutcomeField: 'terminalClass',
    successTerminalValues: ['delivered'],
    neutralTerminalValues: ['clarification', 'intentional_noop', 'permission_refusal', 'feature_disabled'],
    failureTerminalValues: ['provider_unavailable', 'timeout', 'delivery_pending', 'failed_terminal'],
    latencyClock: { start: 'line.ai.accepted.logTimestamp', end: 'line.ai.terminal.logTimestamp', coverage: 'LIVE' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#line-ai-answer`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [
      { path: 'apps/api/src/modules/line-ai/application/line-message-buffer.service.ts', token: "msg: 'line.ai.accepted'" },
      { path: 'apps/api/src/modules/line-ai/domain/logic/line-ai-terminal-outcome.logic.ts', token: "msg: 'line.ai.terminal'" },
    ],
    gap: null,
  },
  {
    key: 'outbox-worker', lane: 'ops', stage: 'outbox worker drain', owner: 'platform-operations', coverage: 'LIVE',
    denominator: { name: 'outbox.created', source: 'outbox_record', selector: 'OutboxEvent created', timestampField: 'createdAt' },
    numerator: { name: 'outbox.published', source: 'outbox_record', selector: 'status=PUBLISHED', timestampField: 'publishedAt' },
    correlationKey: 'eventKey', terminalOutcomeField: 'status',
    successTerminalValues: ['PUBLISHED'], neutralTerminalValues: [], failureTerminalValues: ['DEAD'],
    latencyClock: { start: 'OutboxEvent.createdAt', end: 'OutboxEvent.publishedAt|updatedAt', coverage: 'LIVE' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#outbox-worker`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [
      { path: 'apps/api/prisma/schema.prisma', token: 'model OutboxEvent {' },
      { path: 'apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-outbox.repository.ts', token: "status: 'PUBLISHED'" },
      { path: 'apps/api/src/modules/workflow/application/use-cases/workflow-outbox-drain.use-case.ts', token: 'OUTBOX_DEAD_EVENT' },
    ],
    gap: null,
  },
  {
    key: 'sales-confirmation', lane: 'accounting', stage: 'sales document issue to outbox publication', owner: 'accounting-platform', coverage: 'PARTIAL',
    denominator: { name: 'accounting.sales.issued', source: 'outbox_record', selector: 'eventType=accounting.*.issued', timestampField: 'createdAt' },
    numerator: { name: 'accounting.sales.issued.published', source: 'outbox_record', selector: 'eventType=accounting.*.issued AND status=PUBLISHED', timestampField: 'publishedAt' },
    correlationKey: 'eventKey', terminalOutcomeField: 'status',
    successTerminalValues: ['PUBLISHED'], neutralTerminalValues: [], failureTerminalValues: ['DEAD'],
    latencyClock: { start: 'OutboxEvent.createdAt', end: 'OutboxEvent.publishedAt|updatedAt', coverage: 'LIVE' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#sales-confirmation`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [{ path: 'apps/api/src/modules/accounting-documents/application/use-cases/document.use-case.ts', token: 'accounting.${docType}.issued' }],
    gap: 'The downstream outbox lifecycle is measurable; rejected/failed issue attempts before commit lack a paired signal.',
  },
  {
    key: 'expense-confirmation', lane: 'accounting', stage: 'expense confirmation to outbox publication', owner: 'accounting-platform', coverage: 'PARTIAL',
    denominator: { name: 'expense.confirmed', source: 'outbox_record', selector: 'eventType=expense.confirmed', timestampField: 'createdAt' },
    numerator: { name: 'expense.confirmed.published', source: 'outbox_record', selector: 'eventType=expense.confirmed AND status=PUBLISHED', timestampField: 'publishedAt' },
    correlationKey: 'eventKey', terminalOutcomeField: 'status',
    successTerminalValues: ['PUBLISHED'], neutralTerminalValues: [], failureTerminalValues: ['DEAD'],
    latencyClock: { start: 'OutboxEvent.createdAt', end: 'OutboxEvent.publishedAt|updatedAt', coverage: 'LIVE' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#expense-confirmation`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [{ path: 'apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts', token: "eventType: 'expense.confirmed'" }],
    gap: 'The downstream outbox lifecycle is measurable; rejected/failed confirmation attempts before commit lack a paired signal.',
  },
] as const satisfies readonly CustomerJourneySignal[];

export type TerminalCardinalityResult = Readonly<{
  missing: readonly string[];
  duplicates: readonly string[];
  orphaned: readonly string[];
}>;

/** Correlation IDs are test/synthetic inputs only; this helper never reads tenant or payload data. */
export function reconcileTerminalCardinality(
  acceptedCorrelationIds: readonly string[],
  terminalCorrelationIds: readonly string[],
): TerminalCardinalityResult {
  const accepted = new Set(acceptedCorrelationIds);
  const terminalCounts = new Map<string, number>();
  for (const id of terminalCorrelationIds) terminalCounts.set(id, (terminalCounts.get(id) ?? 0) + 1);
  return {
    missing: [...accepted].filter((id) => !terminalCounts.has(id)).sort(),
    duplicates: [...terminalCounts].filter(([id, count]) => accepted.has(id) && count > 1).map(([id]) => id).sort(),
    orphaned: [...terminalCounts.keys()].filter((id) => !accepted.has(id)).sort(),
  };
}
