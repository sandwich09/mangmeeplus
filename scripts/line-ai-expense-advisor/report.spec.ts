import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deliveredReplyForReport, gatewayCoverageForReport, renderReport, summarizeLatencyByLane } from './report';
import { summarizeScores, type TurnScore, type WorkflowMetrics } from './scorer';
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

  it('says it is a subset run, and names the selected ids and why, when subset is given', () => {
    const passing: TurnScore[] = [{ conversationId: 'conv-1', turnIndex: 0, category: '1', passed: true, reasons: [] }];
    const report = renderReport({
      sourceCommit: 'abc123', now: NOW, summary: summarizeScores(passing), scores: passing, corpus, turnEvidence: [],
      subset: { onlyIds: ['conv-1'], description: 'an explicit MANGMEE_EVAL_ONLY list' },
    });
    assert.match(report, /Subset run/);
    assert.match(report, /conv-1/);
    assert.match(report, /an explicit MANGMEE_EVAL_ONLY list/);
  });

  it('says nothing about a subset when none was requested', () => {
    const passing: TurnScore[] = [{ conversationId: 'conv-1', turnIndex: 0, category: '1', passed: true, reasons: [] }];
    const report = renderReport({ sourceCommit: 'abc123', now: NOW, summary: summarizeScores(passing), scores: passing, corpus, turnEvidence: [] });
    assert.doesNotMatch(report, /Subset run/);
  });

  it('counts turns with machine tokens and breaks them down by kind (task item D3)', () => {
    const withTokens: TurnScore[] = [
      { conversationId: 'conv-1', turnIndex: 0, category: '1', passed: false, reasons: ['machine_token:iso_date'] },
      { conversationId: 'conv-1', turnIndex: 1, category: '1', passed: false, reasons: ['machine_token:iso_date', 'machine_token:markdown'] },
    ];
    const report = renderReport({ sourceCommit: 'abc123', now: NOW, summary: summarizeScores(withTokens), scores: withTokens, corpus, turnEvidence: [] });
    assert.match(report, /Turns with machine tokens.*\| 2 \(iso_date: 2, markdown: 1\) \|/);
  });

  it('reports zero turns with machine tokens, and "none" for the breakdown, when there are none', () => {
    const passing: TurnScore[] = [{ conversationId: 'conv-1', turnIndex: 0, category: '1', passed: true, reasons: [] }];
    const report = renderReport({ sourceCommit: 'abc123', now: NOW, summary: summarizeScores(passing), scores: passing, corpus, turnEvidence: [] });
    assert.match(report, /Turns with machine tokens.*\| 0 \(none\) \|/);
  });

  it('renders the latency-by-lane table with n, p50, p95, max, over-threshold counts and cost (task item D5)', () => {
    const passing: TurnScore[] = [{ conversationId: 'conv-1', turnIndex: 0, category: '1', passed: true, reasons: [] }];
    const turnEvidence = [fakeEvidence({ acceptedAtMs: 0, modelWorkCompletedAtMs: 1000, providerUsage: [{ usageTag: 'line.intake-route', costSatang: 50 }] })];
    const report = renderReport({ sourceCommit: 'abc123', now: NOW, summary: summarizeScores(passing), scores: passing, corpus, turnEvidence });
    assert.match(report, /## Latency by lane/);
    assert.match(report, /\| fast \| 1 \| 1000 \| 1000 \| 1000 \| 0 \| 0 \| 0\.50 \|/);
  });

  it('renders the workflow before/after table from §10 when workflow metrics are supplied', () => {
    const metrics = {
      W3: { passed: 9, total: 10 }, W5: { byKind: { expense: { providerExact: '300', completedTasks: 2, costPerCompletedTask: '150' } } },
      W6: { wrongApplied: 1, wrongPreview: 2 }, W8: { '0': { p50: 1250, p95: 2000 } }, W13: { candidateExact: '120', baselineExact: '200' },
    } as WorkflowMetrics;
    const report = renderReport({ sourceCommit: 'abc123', now: NOW, summary: summarizeScores(scores), scores, corpus, turnEvidence: [], workflowSummary: { before: metrics, after: metrics, ready: 'ตรวจแล้ว', remaining: 'ยังต้องวัด' } });
    assert.match(report, /\| ต้นทุนต่องานที่เสร็จ \| 1\.50 บาท \| 1\.50 บาท \|/);
    assert.match(report, /\| ต้นทุนรวมชุดงานเดียวกัน \| 1\.20 บาท \| 1\.20 บาท \|/);
    assert.match(report, /\| งานจบโดยไม่ติด \| 90% \| 90% \|/);
    assert.match(report, /\| ทำผิดรายการ \| 3 ครั้ง \| 3 ครั้ง \|/);
    assert.match(report, /พร้อมแล้ว: ตรวจแล้ว[\s\S]*ยังเหลือ: ยังต้องวัด/);
  });
});

describe('summarizeLatencyByLane (task item D5)', () => {
  it('buckets a turn with ONLY line.intake-route usage as "fast"', () => {
    const turnEvidence = [fakeEvidence({ acceptedAtMs: 0, modelWorkCompletedAtMs: 900, providerUsage: [{ usageTag: 'line.intake-route', costSatang: 50 }] })];
    const [fast, full, other] = summarizeLatencyByLane(turnEvidence);
    assert.deepEqual(fast, { lane: 'fast', n: 1, p50: 900, p95: 900, max: 900, over15s: 0, over30s: 0, costThb: 0.5 });
    assert.equal(full!.n, 0);
    assert.equal(other!.n, 0);
  });

  it('buckets a turn that reached line.loop or line.compose as "full", even alongside intake-route', () => {
    const turnEvidence = [
      fakeEvidence({ turnIndex: 0, acceptedAtMs: 0, modelWorkCompletedAtMs: 20_000, providerUsage: [{ usageTag: 'line.intake-route', costSatang: 30 }, { usageTag: 'line.loop', costSatang: 300 }] }),
      fakeEvidence({ turnIndex: 1, acceptedAtMs: 0, modelWorkCompletedAtMs: 40_000, providerUsage: [{ usageTag: 'line.compose', costSatang: 200 }] }),
    ];
    const [, full] = summarizeLatencyByLane(turnEvidence);
    assert.equal(full!.n, 2);
    assert.equal(full!.over15s, 2);
    assert.equal(full!.over30s, 1);
    assert.equal(full!.max, 40_000);
    assert.equal(full!.costThb, 5.3);
  });

  it('buckets anything else (e.g. OCR-only tags) as "other", and skips a turn with no provider usage at all', () => {
    const turnEvidence = [
      fakeEvidence({ turnIndex: 0, acceptedAtMs: 0, modelWorkCompletedAtMs: 500, providerUsage: [{ usageTag: 'ocr.receipt.extract', costSatang: 10 }] }),
      fakeEvidence({ turnIndex: 1, providerUsage: [] }),
    ];
    const [fast, full, other] = summarizeLatencyByLane(turnEvidence);
    assert.equal(fast!.n, 0);
    assert.equal(full!.n, 0);
    assert.equal(other!.n, 1);
    assert.equal(other!.costThb, 0.1);
  });

  it('excludes a turn with no modelWorkCompletedAtMs from the latency samples but still counts its cost', () => {
    const turnEvidence = [fakeEvidence({ modelWorkCompletedAtMs: null, providerUsage: [{ usageTag: 'line.intake-route', costSatang: 75 }] })];
    const [fast] = summarizeLatencyByLane(turnEvidence);
    assert.equal(fast!.n, 0);
    assert.equal(fast!.costThb, 0.75);
  });
});
