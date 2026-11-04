/**
 * run-rescore.ts's main() needs a real DB/oracle boot (like run-preflight.ts/run-real.ts, neither
 * of which has a spec file) — but scenarioIdsIn/rescoreReportPath are pure, and directly implicated
 * in "the saved evidence must come from the same corpus conversations, match by id" and "writing a
 * new report next to it" (task requirements), so they are tested here in isolation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scenarioIdsIn, rescoreReportPath, workflowAttemptsFromEvidence } from './run-rescore';
import { scoreAllTurns } from './gold-oracle-pass';
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

describe('workflowAttemptsFromEvidence (M1c)', () => {
  it('rescores the saved businessSnapshot rows in one complete attempt per conversation', () => {
    const corpus = { version: 2, seed: 'synthetic', status: 'draft', conversations: [{ id: 'workflow-1', category: 'expense', journeyKind: 'typed',
      actors: [{ key: 'owner', company: 'A', role: 'OWNER', branchScope: 'all' }], tasks: [], turns: [{ user: 'show', expect: {} }, { press: 'continue', expect: { label: 'continue' } }] }] } as any;
    const first = { ...fakeEvidence('workflow-1', 0), attemptId: 'attempt-1', businessSnapshot: { business: { ExpenseRecord: [{ id: 'seed-1', status: 'READY' }] }, collectionState: {} }, unintendedEffects: [] } as any;
    const second = { ...fakeEvidence('workflow-1', 1), attemptId: 'attempt-1', businessSnapshot: { business: { ExpenseRecord: [{ id: 'seed-1', status: 'CONFIRMED' }] }, collectionState: {} }, unintendedEffects: [] } as any;
    const attempts = workflowAttemptsFromEvidence(corpus, [first, second]);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.complete, true);
    assert.deepEqual(attempts[0]!.turns[1]!.businessSnapshot.business.ExpenseRecord, [{ id: 'seed-1', status: 'CONFIRMED' }]);
  });
});

describe('legacy advisor evidence (M1c)', () => {
  it('keeps the prior scorer result when rescore evidence has no attempt or business snapshot', () => {
    const conversation = { id: 'legacy-1', company: 'A', role: 'OWNER', turns: [
      { category: 'general', user: 'ตอบสั้น ๆ', expect: { tags: { no_tool: true } } },
    ] } as any;
    const evidence = { ...fakeEvidence('legacy-1', 0), receipts: [{ messages: [{ type: 'text', text: 'รับทราบแล้ว' }], at: 20, receiptId: 'reply' }] };
    const scores = scoreAllTurns([{ conversation, turnIndex: 0, turn: conversation.turns[0] }], [evidence], {
      resultsByTurn: new Map(), factsByTurn: new Map(), resolvedCallsByTurn: new Map(), alternativeFactsByTurn: new Map(),
    }, new Date('2026-11-04T00:00:00.000Z'));
    assert.deepEqual(scores, [{ conversationId: 'legacy-1', turnIndex: 0, category: 'general', passed: true, reasons: [] }]);
  });
});

describe('M3 delivered knowledge evidence', () => {
  it('uses accepted audited ids/versions and Flex body text, never an offered card alone', async () => {
    const { deliveredKnowledgeCards } = await import('./gold-oracle-pass');
    const row = { ...fakeEvidence('q5', 0), receipts: [{ messages: [{ type: 'flex', contents: { type: 'text', text: 'ใบเบิกคืออะไร\nสำรองจ่ายให้ร้าน' } }], at: 20, receiptId: 'reply' }],
      gatewayResponses: [{ response: { sourceRefs: [{ entityType: 'approved_product_help', entityId: 'mangmee-product-help:7:reimbursement.meaning:6', label: 'ใบเบิกคืออะไร', permissionChecked: true }] } }] } as any;
    assert.deepEqual(deliveredKnowledgeCards(row), [{ id: 'reimbursement.meaning', version: 6 }]);
    assert.deepEqual(deliveredKnowledgeCards({ ...row, receipts: [] }), []);
    assert.deepEqual(deliveredKnowledgeCards({ ...row, receipts: [{ messages: [{ type: 'text', text: 'ยังเปิดใบเบิกคืออะไรไม่ได้ ให้เจ้าของกิจการตรวจสิทธิ์' }] }] }), []);
    assert.deepEqual(deliveredKnowledgeCards({ ...row, delivery: { status: 'INCOMPLETE' } }), []);
    assert.deepEqual(deliveredKnowledgeCards({ ...row, gatewayResponses: [{ response: { selectedKnowledgeCardIds: ['reimbursement.meaning'] } }] }), []);
    const corpus = { conversations: [{ id: 'q5', actors: [{ key: 'owner' }], turns: [{ expect: { knowledge: { cardId: 'reimbursement.meaning', version: 6 } } }] }] } as any;
    const attempts = workflowAttemptsFromEvidence(corpus, [{ ...row, attemptId: 'one' }]);
    assert.deepEqual(attempts[0].turns[0].deliveredCards, [{ id: 'reimbursement.meaning', version: 6 }]);
    assert.match(attempts[0].turns[0].deliveredText!, /สำรองจ่ายให้ร้าน/);
  });
});
