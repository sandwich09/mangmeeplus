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
    key: 'line-login', lane: 'signup', stage: 'LINE login', owner: 'identity-access', coverage: 'LIVE',
    denominator: { name: 'journey.line.login.accepted', source: 'audit_record', selector: 'action=journey.line.login.accepted', timestampField: 'createdAt' },
    numerator: { name: 'journey.line.login.terminal', source: 'audit_record', selector: 'action=journey.line.login.terminal AND metadataJson.outcome=linked', timestampField: 'createdAt' },
    correlationKey: 'requestId', terminalOutcomeField: 'metadataJson.outcome',
    successTerminalValues: ['linked'], neutralTerminalValues: [],
    failureTerminalValues: ['unlinked', 'denied', 'not_found', 'conflict', 'rate_limited', 'rejected', 'failed'],
    latencyClock: { start: 'journey.line.login.accepted.createdAt', end: 'journey.line.login.terminal.createdAt', coverage: 'LIVE' },
    severity: 'WARNING', runbook: `${RUNBOOK}#line-login`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [
      { path: 'apps/api/src/modules/auth/application/use-cases/exchange-line-token.use-case.ts', token: "key: 'line-login'" },
      { path: 'apps/api/src/common/observability/customer-journey-audit.ts', token: 'exactly one terminal row' },
    ],
    gap: null,
  },
  {
    key: 'line-link', lane: 'signup', stage: 'LINE account link', owner: 'identity-access', coverage: 'LIVE',
    denominator: { name: 'journey.line.link.accepted', source: 'audit_record', selector: 'action=journey.line.link.accepted', timestampField: 'createdAt' },
    numerator: { name: 'journey.line.link.terminal', source: 'audit_record', selector: 'action=journey.line.link.terminal AND metadataJson.outcome=linked', timestampField: 'createdAt' },
    correlationKey: 'requestId', terminalOutcomeField: 'metadataJson.outcome',
    successTerminalValues: ['linked'], neutralTerminalValues: [],
    failureTerminalValues: ['denied', 'not_found', 'conflict', 'rate_limited', 'rejected', 'failed'],
    latencyClock: { start: 'journey.line.link.accepted.createdAt', end: 'journey.line.link.terminal.createdAt', coverage: 'LIVE' },
    severity: 'WARNING', runbook: `${RUNBOOK}#line-link`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [{ path: 'apps/api/src/modules/auth/application/use-cases/link-line-identity.use-case.ts', token: "key: 'line-link'" }],
    gap: null,
  },
  {
    key: 'receipt-intake', lane: 'accounting', stage: 'receipt intake to workflow', owner: 'accounting-platform', coverage: 'PARTIAL',
    denominator: { name: 'journey.receipt.intake.accepted', source: 'audit_record', selector: 'action=journey.receipt.intake.accepted', timestampField: 'createdAt' },
    numerator: { name: 'journey.receipt.intake.terminal', source: 'audit_record', selector: 'action=journey.receipt.intake.terminal AND metadataJson.outcome=uploaded', timestampField: 'createdAt' },
    correlationKey: 'requestId', terminalOutcomeField: 'metadataJson.outcome',
    successTerminalValues: ['uploaded'], neutralTerminalValues: [],
    failureTerminalValues: ['denied', 'not_found', 'conflict', 'rate_limited', 'rejected', 'failed'],
    latencyClock: { start: 'journey.receipt.intake.accepted.createdAt', end: 'journey.receipt.intake.terminal.createdAt', coverage: 'LIVE' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#receipt-intake`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [
      { path: 'apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts', token: "append('expense.receipt_uploaded'" },
      { path: 'apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts', token: "key: 'receipt-intake'" },
    ],
    gap: 'Completion calls are paired; an upload intent abandoned before the completion call still needs expiry reconciliation.',
  },
  {
    key: 'receipt-ocr', lane: 'ai', stage: 'receipt OCR', owner: 'accounting-ai', coverage: 'LIVE',
    denominator: { name: 'journey.receipt.ocr.accepted', source: 'audit_record', selector: 'action=journey.receipt.ocr.accepted', timestampField: 'createdAt' },
    numerator: { name: 'journey.receipt.ocr.terminal', source: 'audit_record', selector: 'action=journey.receipt.ocr.terminal AND metadataJson.outcome=ok', timestampField: 'createdAt' },
    correlationKey: 'requestId', terminalOutcomeField: 'metadataJson.outcome',
    successTerminalValues: ['ok'], neutralTerminalValues: ['not_expense_document'],
    failureTerminalValues: ['no_attachment', 'unsupported', 'not_configured', 'denied', 'not_found', 'conflict', 'rate_limited', 'rejected', 'failed'],
    latencyClock: { start: 'journey.receipt.ocr.accepted.createdAt', end: 'journey.receipt.ocr.terminal.createdAt', coverage: 'LIVE' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#receipt-ocr`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [{ path: 'apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts', token: "key: 'receipt-ocr'" }],
    gap: null,
  },
  {
    key: 'line-ai-answer', lane: 'ai', stage: 'LINE AI accepted to terminal answer', owner: 'ai-experience', coverage: 'LIVE',
    denominator: { name: 'line.ai.accepted', source: 'structured_log', selector: 'msg=line.ai.accepted', timestampField: 'logTimestamp' },
    numerator: { name: 'line.ai.terminal', source: 'structured_log', selector: 'msg=line.ai.terminal AND terminalClass=delivered', timestampField: 'logTimestamp' },
    correlationKey: 'webhookEventId', terminalOutcomeField: 'terminalClass',
    successTerminalValues: ['delivered'],
    // `budget_refusal` is NEUTRAL: the company's monthly AI money ran out, the turn said so and the
    // card was delivered. Counting it as a failure would page on a policy decision working exactly
    // as designed; counting it as success would hide that the shop got no answer (spec §9.3).
    neutralTerminalValues: ['clarification', 'intentional_noop', 'permission_refusal', 'feature_disabled', 'budget_refusal'],
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
    key: 'sales-confirmation', lane: 'accounting', stage: 'sales document issue', owner: 'accounting-platform', coverage: 'LIVE',
    denominator: { name: 'journey.sales.confirmation.accepted', source: 'audit_record', selector: 'action=journey.sales.confirmation.accepted', timestampField: 'createdAt' },
    numerator: { name: 'journey.sales.confirmation.terminal', source: 'audit_record', selector: 'action=journey.sales.confirmation.terminal AND metadataJson.outcome=issued', timestampField: 'createdAt' },
    correlationKey: 'requestId', terminalOutcomeField: 'metadataJson.outcome',
    successTerminalValues: ['issued'], neutralTerminalValues: [],
    failureTerminalValues: ['denied', 'not_found', 'conflict', 'rate_limited', 'rejected', 'failed'],
    latencyClock: { start: 'journey.sales.confirmation.accepted.createdAt', end: 'journey.sales.confirmation.terminal.createdAt', coverage: 'LIVE' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#sales-confirmation`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [{ path: 'apps/api/src/modules/accounting-documents/application/use-cases/document.use-case.ts', token: "key: 'sales-confirmation'" }],
    gap: null,
  },
  {
    key: 'expense-confirmation', lane: 'accounting', stage: 'expense confirmation', owner: 'accounting-platform', coverage: 'LIVE',
    denominator: { name: 'journey.expense.confirmation.accepted', source: 'audit_record', selector: 'action=journey.expense.confirmation.accepted', timestampField: 'createdAt' },
    numerator: { name: 'journey.expense.confirmation.terminal', source: 'audit_record', selector: 'action=journey.expense.confirmation.terminal AND metadataJson.outcome=confirmed', timestampField: 'createdAt' },
    correlationKey: 'requestId', terminalOutcomeField: 'metadataJson.outcome',
    successTerminalValues: ['confirmed'], neutralTerminalValues: [],
    failureTerminalValues: ['denied', 'not_found', 'conflict', 'rate_limited', 'rejected', 'failed'],
    latencyClock: { start: 'journey.expense.confirmation.accepted.createdAt', end: 'journey.expense.confirmation.terminal.createdAt', coverage: 'LIVE' },
    severity: 'CRITICAL', runbook: `${RUNBOOK}#expense-confirmation`, target: null,
    terminalCardinality: 'exactly_one_per_accepted_correlation',
    evidence: [{ path: 'apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts', token: "key: 'expense-confirmation'" }],
    gap: null,
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
