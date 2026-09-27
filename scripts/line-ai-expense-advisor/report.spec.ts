import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deliveredReplyForReport, gatewayCoverageForReport, renderReport } from './report';
import { summarizeScores, type TurnScore } from './scorer';
import type { Corpus } from './types';
import type { RuntimeTurnEvidence } from '../line-ai-reliability-runtime';

const NOW = new Date('2026-09-27T06:00:00.000Z');

function fakeEvidence(overrides: Partial<RuntimeTurnEvidence> = {}): RuntimeTurnEvidence {
  return {
    scenarioId: 'conv-1', repeat: 0, turnIndex: 0, user: 'เดือนนี้จ่ายไปเท่าไหร่แล้วคะ', attachmentIds: [],
    companyId: 'company-a', sourceSnapshot: 'A-OWNER', snapshotDigest: 'digest', webBaseUrl: 'https://web.eval.test',
    acceptedAtMs: 1000, modelWorkCompletedAtMs: 2000,
    receipts: [], toolResults: [], gatewayResponses: [], webhookEvents: [], providerUsage: [], reservations: [],
    reviewState: { before: { draftActions: [], conversations: [], truncated: false }, after: { draftActions: [], conversations: [], truncated: false } },
    delivery: { requiredBatchIds: [], accepted: [], status: 'ACCEPTED' } as unknown as RuntimeTurnEvidence['delivery'],
    ...overrides,
  };
}

function textReceipt(text: string) {
  return { messages: [{ type: 'text', text }], at: 1500, receiptId: 'r1', path: '/v2/bot/message/reply', payloadHash: 'hash' };
}

function flexReceipt(altText: string) {
  return { messages: [{ type: 'flex', altText, contents: {} }], at: 1500, receiptId: 'r2', path: '/v2/bot/message/reply', payloadHash: 'hash' };
}

describe('deliveredReplyForReport', () => {
  it('reads a plain text receipt', () => {
    const evidence = fakeEvidence({ receipts: [textReceipt('เดือนนี้จ่ายไป 1,200.00 บาทค่ะ')] });
    assert.equal(deliveredReplyForReport(evidence), 'เดือนนี้จ่ายไป 1,200.00 บาทค่ะ');
  });

  it("reads a Flex message's altText", () => {
    const evidence = fakeEvidence({ receipts: [flexReceipt('มี 2 รายการที่รออนุมัติ')] });
    assert.equal(deliveredReplyForReport(evidence), 'มี 2 รายการที่รออนุมัติ');
  });

  it('truncates to the given max length', () => {
    const evidence = fakeEvidence({ receipts: [textReceipt('ก'.repeat(700))] });
    const reply = deliveredReplyForReport(evidence, 600);
    assert.equal(reply.length, 601); // 600 chars + the truncation ellipsis character
    assert.ok(reply.endsWith('…'));
  });

  it('says so when no evidence was captured', () => {
    assert.match(deliveredReplyForReport(undefined), /no evidence captured/);
  });

  it('says so when evidence exists but nothing was delivered', () => {
    assert.match(deliveredReplyForReport(fakeEvidence({ receipts: [] })), /no reply delivered/);
  });
});

describe('gatewayCoverageForReport', () => {
  it('reads status/reasonCode off a requestLineTurn-shaped gateway response', () => {
    const evidence = fakeEvidence({
      gatewayResponses: [{
        method: 'requestLineTurn', requestId: 'req-1', startedAtMs: 0, completedAtMs: 1,
        response: { semanticCoverage: [{ index: 0, status: 'denied', reasonCode: 'PERMISSION_DENIED' }, { index: 1, status: 'handled' }] },
      }],
    });
    assert.deepEqual(gatewayCoverageForReport(evidence), [{ index: 0, status: 'denied', reasonCode: 'PERMISSION_DENIED' }, { index: 1, status: 'handled' }]);
  });

  it('returns an empty array for a response with no semanticCoverage', () => {
    const evidence = fakeEvidence({ gatewayResponses: [{ method: 'requestLineIntakeRoute', requestId: 'r', startedAtMs: 0, completedAtMs: 1, response: {} }] });
    assert.deepEqual(gatewayCoverageForReport(evidence), []);
  });

  it('returns an empty array when no evidence was captured', () => {
    assert.deepEqual(gatewayCoverageForReport(undefined), []);
  });
});

describe('renderReport', () => {
  const corpus: Corpus = {
    version: 1,
    conversations: [{
      id: 'conv-1', company: 'A', role: 'OWNER',
      turns: [
        { user: 'เดือนนี้จ่ายไปเท่าไหร่แล้วคะ', category: '1', expect: { calls: [{ tool: 'expense.list_recent', input: {} }] } },
        { user: 'แล้วยืนยันแล้วล่ะ', category: '1', expect: { calls: [{ tool: 'expense.list_recent', input: { documentStatus: 'CONFIRMED' } }] } },
      ],
    }],
  };
  const scores: TurnScore[] = [
    { conversationId: 'conv-1', turnIndex: 0, category: '1', passed: true, reasons: [] },
    { conversationId: 'conv-1', turnIndex: 1, category: '1', passed: false, reasons: ['missing_fact:money:1200.00'] },
  ];

  it('includes the delivered reply for every turn of a failing transcript, tools called, and gateway coverage', () => {
    const turnEvidence = [
      fakeEvidence({ turnIndex: 0, receipts: [textReceipt('เดือนนี้จ่ายไป 1,200.00 บาทค่ะ')] }),
      fakeEvidence({
        turnIndex: 1, receipts: [textReceipt('เดี๋ยวเช็คให้ค่ะ')],
        toolResults: [{ tool: 'expense.list_recent', input: { documentStatus: 'CONFIRMED' }, startedAtMs: 0, completedAtMs: 1 }],
        gatewayResponses: [{ method: 'requestLineTurn', requestId: 'req-2', startedAtMs: 0, completedAtMs: 1, response: { semanticCoverage: [{ index: 0, status: 'handled' }] } }],
      }),
    ];
    const report = renderReport({ sourceCommit: 'abc123', now: NOW, summary: summarizeScores(scores), scores, corpus, turnEvidence });

    assert.match(report, /0\. \*\*user:\*\* เดือนนี้จ่ายไปเท่าไหร่แล้วคะ\n {3}\*\*assistant:\*\* เดือนนี้จ่ายไป 1,200\.00 บาทค่ะ/);
    assert.match(report, /1\. \*\*user:\*\* แล้วยืนยันแล้วล่ะ\n {3}\*\*assistant:\*\* เดี๋ยวเช็คให้ค่ะ/);
    assert.match(report, /Tools called \(this turn\): `expense\.list_recent`: \{"documentStatus":"CONFIRMED"\}/);
    assert.match(report, /Gateway coverage \(this turn\): handled/);
  });

  it('reports "_none_" tools and "_none reported_" coverage when the failing turn made no gateway calls', () => {
    const turnEvidence = [
      fakeEvidence({ turnIndex: 0, receipts: [textReceipt('เดือนนี้จ่ายไป 1,200.00 บาทค่ะ')] }),
      fakeEvidence({ turnIndex: 1, receipts: [] }),
    ];
    const report = renderReport({ sourceCommit: 'abc123', now: NOW, summary: summarizeScores(scores), scores, corpus, turnEvidence });
    assert.match(report, /Tools called \(this turn\): _none_/);
    assert.match(report, /Gateway coverage \(this turn\): _none reported_/);
  });

  it('still renders a passing-only report with no Failures section content', () => {
    const passing: TurnScore[] = [{ conversationId: 'conv-1', turnIndex: 0, category: '1', passed: true, reasons: [] }];
    const report = renderReport({ sourceCommit: 'abc123', now: NOW, summary: summarizeScores(passing), scores: passing, corpus, turnEvidence: [] });
    assert.match(report, /_none_/);
  });
});
