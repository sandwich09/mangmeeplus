import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineAiReconciliationReport, type LineAiReconciliationRow } from './line-ai-reconciliation.logic';
import { LINE_AI_TERMINAL_CLASSES } from './line-ai-terminal-outcome.logic';

const row = (
  webhookEventId: string,
  status: string,
  errorCode: string | null = null,
  payloadPresent = false,
): LineAiReconciliationRow => ({ webhookEventId, status, errorCode, payloadPresent });

describe('LINE AI persisted-state reconciliation', () => {
  it('reconciles one accepted inbound to exactly one bounded final snapshot class', () => {
    const report = buildLineAiReconciliationReport([
      row('delivered', 'completed'),
      row('clarify', 'clarification_required'),
      row('batched', 'batched'),
      row('permission', 'forbidden', 'LINE_AI_FORBIDDEN'),
      row('disabled', 'feature_disabled', 'LINE_AI_UNSUPPORTED_MODULE'),
      row('provider', 'provider_unavailable', 'LINE_AI_PROVIDER_UNAVAILABLE'),
      row('timeout', 'ai_error', 'LINE_AI_AI_TIMEOUT'),
      // Remediation spec §9.3: the company's monthly AI money ran out and the card was delivered.
      // A policy refusal answered correctly is its own snapshot class, not an outage.
      row('budget', 'ai_budget_exceeded', 'AI_MONTHLY_BUDGET_EXCEEDED'),
      row('pending', 'delivery_pending', 'LINE_DELIVERY_FAILED_OTHER', true),
      row('failed', 'orphan_expired', 'ORPHAN_REPLAY_WINDOW_EXPIRED'),
    ]);

    assert.equal(report.acceptedInboundCount, 10);
    assert.equal(report.terminalOutcomeCount, 10);
    assert.equal(report.reconciliationDelta, 0);
    // One row per bounded class, in the class list's own order.
    assert.equal(Object.keys(report.outcomeCounts).length, LINE_AI_TERMINAL_CLASSES.length);
    assert.deepEqual(Object.values(report.outcomeCounts), LINE_AI_TERMINAL_CLASSES.map(() => 1));
    assert.equal(report.outcomeCounts.budget_refusal, 1);
    // The point of the class: a delivered money refusal carries its own reason, so it never lands in
    // the unexplained-failure bucket the AI-outage alarm reads.
    assert.deepEqual(report.violations.unexplainedFailedTerminalRefs, []);
    assert.equal(report.reconciled, true);
  });

  it('keeps delivery truth ahead of the money reason', () => {
    // A refusal the customer never received must still look pending, even carrying the budget code,
    // and it keeps the replay payload `delivery_pending` alone is allowed to hold.
    const report = buildLineAiReconciliationReport([
      row('undelivered-budget', 'delivery_pending', 'AI_MONTHLY_BUDGET_EXCEEDED', true),
    ]);

    assert.equal(report.outcomeCounts.delivery_pending, 1);
    assert.equal(report.outcomeCounts.budget_refusal, 0);
    assert.deepEqual(report.violations.terminalPayloadRefs, []);
    assert.equal(report.reconciled, true);
  });

  it('fails on in-flight rows, duplicate ids, terminal payloads and unexplained statuses together', () => {
    const report = buildLineAiReconciliationReport([
      row('still-running', 'response_ready', null, true),
      row('duplicate', 'completed'),
      row('duplicate', 'completed'),
      row('payload-leak', 'completed', null, true),
      row('unknown', 'new_terminal_without_reason'),
    ]);

    assert.equal(report.reconciled, false);
    assert.equal(report.reconciliationDelta, 1);
    assert.equal(report.violations.unreconciledEventRefs.length, 1);
    assert.equal(report.violations.duplicateEventRefs.length, 1);
    assert.equal(report.violations.terminalPayloadRefs.length, 1);
    assert.equal(report.violations.unexplainedFailedTerminalRefs.length, 1);
  });

  it('returns only hashed event references', () => {
    const rawId = 'provider-event-id-must-not-leak';
    const report = buildLineAiReconciliationReport([row(rawId, 'received', null, true)]);
    assert.equal(JSON.stringify(report).includes(rawId), false);
    assert.match(report.violations.unreconciledEventRefs[0] ?? '', /^[0-9a-f]{16}$/);
  });
});
