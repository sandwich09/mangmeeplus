import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineAiReconciliationReport, type LineAiReconciliationRow } from './line-ai-reconciliation.logic';

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
      row('pending', 'delivery_pending', 'LINE_DELIVERY_FAILED_OTHER', true),
      row('failed', 'orphan_expired', 'ORPHAN_REPLAY_WINDOW_EXPIRED'),
    ]);

    assert.equal(report.acceptedInboundCount, 9);
    assert.equal(report.terminalOutcomeCount, 9);
    assert.equal(report.reconciliationDelta, 0);
    assert.deepEqual(Object.values(report.outcomeCounts), [1, 1, 1, 1, 1, 1, 1, 1, 1]);
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
