/**
 * run-rescore.ts's main() needs a real DB/oracle boot (like run-preflight.ts/run-real.ts, neither
 * of which has a spec file) — but scenarioIdsIn/rescoreReportPath are pure, and directly implicated
 * in "the saved evidence must come from the same corpus conversations, match by id" and "writing a
 * new report next to it" (task requirements), so they are tested here in isolation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scenarioIdsIn, rescoreReportPath } from './run-rescore';
import type { RuntimeTurnEvidence } from '../line-ai-reliability-runtime';

function fakeEvidence(scenarioId: string, turnIndex: number): RuntimeTurnEvidence {
  return {
    scenarioId, repeat: 0, turnIndex, user: 'x', attachmentIds: [], companyId: 'company-a',
    sourceSnapshot: 'A-OWNER', snapshotDigest: 'digest', acceptedAtMs: 0, modelWorkCompletedAtMs: null,
    receipts: [], toolResults: [], gatewayResponses: [], webhookEvents: [], providerUsage: [], reservations: [],
    reviewState: { before: { draftActions: [], conversations: [], truncated: false }, after: { draftActions: [], conversations: [], truncated: false } },
    delivery: { requiredBatchIds: [], accepted: [], status: 'ACCEPTED' } as unknown as RuntimeTurnEvidence['delivery'],
  };
}

describe('scenarioIdsIn', () => {
  it('lists every distinct conversation id, in first-seen order, one entry per conversation regardless of turn count', () => {
    const turnEvidence = [
      fakeEvidence('T-068-a-owner-list-third-item', 0), fakeEvidence('T-068-a-owner-list-third-item', 1),
      fakeEvidence('B-manager-approvals', 0),
    ];
    assert.deepEqual(scenarioIdsIn(turnEvidence), ['T-068-a-owner-list-third-item', 'B-manager-approvals']);
  });

  it('returns an empty list for empty evidence', () => {
    assert.deepEqual(scenarioIdsIn([]), []);
  });
});

describe('rescoreReportPath', () => {
  const NOW = new Date('2026-09-28T04:39:00.000Z');

  it('lands next to the input evidence file, never in a different directory', () => {
    const path = rescoreReportPath('/private/tmp/eval-runs/ordinal-2/2026-09-27T21-38-42-755Z.evidence.json', NOW);
    assert.equal(path, '/private/tmp/eval-runs/ordinal-2/2026-09-27T21-38-42-755Z.rescore-2026-09-28T04-39-00-000Z.report.md');
  });

  it('never collides with the original run\'s own .report.md', () => {
    const path = rescoreReportPath('/tmp/out/run.evidence.json', NOW);
    assert.ok(path.endsWith('.report.md'));
    assert.notEqual(path, '/tmp/out/run.report.md');
  });
});
