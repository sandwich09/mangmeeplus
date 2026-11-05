/**
 * Offline rescore helpers and the real-run entry point's checkpoint flow. The workflow replay
 * uses an in-memory database, oracle and gateway, then runs the offline rescore CLI on its files.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { scenarioIdsIn, rescoreReportPath, workflowAttemptsFromEvidence } from './run-rescore';
import { scoreAllTurns } from './gold-oracle-pass';
import type { RuntimeTurnEvidence } from '../line-ai-reliability-runtime';

describe('workflow real-run entry point', () => {
  it('runs the oracle payment sample through checkpoints and a stub gateway, then rescores identical saved evidence', async () => {
    const { runReal } = await import('./run-real');
    const { scoreWorkflowCorpus } = await import('./scorer');
    const { selectRuntimePostback, runtimeDeliveryEvidence, runtimeDeliveredPreviews, runtimeBusinessEffects } = await import('../line-ai-reliability-runtime');
    const root = mkdtempSync(join(tmpdir(), 'workflow-real-stub-'));
    const previousExitCode = process.exitCode;
    const corpus = JSON.parse(readFileSync(new URL('./corpus.workflow.oracle-sample.json', import.meta.url), 'utf8'));
    corpus.classifierLabels = 'messages';
    const selectedCorpus = { ...structuredClone(corpus), conversations: corpus.conversations.filter((row: any) => row.id === 'M2-expense-payment-oracle') };
    const corpusPath = join(root, 'corpus.json'), secretsPath = join(root, 'synthetic-config.json');
    writeFileSync(corpusPath, JSON.stringify(corpus));
    writeFileSync(secretsPath, JSON.stringify({ databaseUrl: 'postgresql://synthetic:synthetic@127.0.0.1:15440/watchdog_ai_reliability_replay_expense_advisor' }));
    writeFileSync(join(root, 'gateway.manifest.json'), JSON.stringify({ transport: 'bedrock' }));
    const queries: string[] = [], gatewayInputs: any[] = [];
    let runtimeRuns = 0, oracleRuns = 0, capCounter = 0, interruptFirstRun = true, capNextRun = false, wrongWriteNext = false;
    const pg = { async connect() {}, async end() {}, async query(sql: string) {
      queries.push(sql);
      return { rows: sql.includes('current_database()') ? [{ name: 'watchdog_ai_reliability_replay_expense_advisor' }]
        : sql.includes('cap_rejections') && sql.startsWith('SELECT') ? [{ value: capCounter }] : [] };
    } };
    const previewEntry = { expenseId: 'workflow-expense-b-9', preview: { action: 'RECORD_PAYMENT', token: 'stub-token',
      record: { amount: '1000.00', vendorName: 'ผู้รับเงินนอกคู่ค้า' }, payment: { paymentMethod: 'CASH', paidAt: '2026-11-04T00:00:00.000Z' } } };
    const renderStubPreview = (entry: any) => ({ type: 'flex', altText: 'ตรวจรายการ', contents: { amount: entry.preview.record.amount,
      footer: { action: { type: 'postback', label: 'บันทึกจ่าย', data: 'action=expense_action_confirm&token=stub-token' } } } });
    const stubGateway = (input: { text: string; actor: string; postback?: string }) => {
      gatewayInputs.push(input);
      return input.postback ? [{ type: 'text', text: 'ยืนยันแล้ว' }] : [renderStubPreview(previewEntry)];
    };
    const environment = { MANGMEE_EVAL_OUTPUT_DIR: root, MANGMEE_EVAL_GATEWAY_URL: 'http://127.0.0.1:19205/v1',
      MANGMEE_EVAL_SECRETS_PATH: secretsPath, MANGMEE_EVAL_CORPUS: corpusPath, MANGMEE_EVAL_MAX_THB: '1',
      MANGMEE_EVAL_ONLY: selectedCorpus.conversations[0].id };
    const oracle = async (...args: any[]) => {
      oracleRuns++;
      assert.equal(args[1].version, 2);
      assert.equal(args[1].conversations.length, 4, 'the oracle retains the full seed actor set');
      const captures = queries.filter(sql => sql.includes('FROM public."AiBudgetReservation"')).length;
      await args[7]();
      assert.ok(queries.filter(sql => sql.includes('FROM public."AiBudgetReservation"')).length > captures, 'captureSpend precedes oracle truncate');
      queries.push('ORACLE_TRUNCATE');
      return { resultsByTurn: new Map(), factsByTurn: new Map(), resolvedCallsByTurn: new Map(), alternativeFactsByTurn: new Map(), workflowValidation: { seedDigest: 'stub', actorAssignments: 2, goldRecords: 1, previews: 1 } };
    };
    const runtime = async (manifest: any, _repo: string, hooks: any) => {
      runtimeRuns++;
      const turns: any[] = [];
      const wrongWrite = wrongWriteNext; wrongWriteNext = false;
      assert.equal(manifest.corpus.fixtures.length, 1, 'ONLY selects a whole conversation');
      const fixture = manifest.corpus.fixtures[0], snapshot = manifest.snapshots[fixture.fixture.sourceSnapshot];
      assert.equal(fixture.turns[0].pressFrom, 'owner-b');
      assert.equal(fixture.turns[1].pressFrom, 'owner-b');
      assert.equal(fixture.fixture.company, 'company-b');
      assert.equal(fixture.fixture.actor, snapshot.actors['owner-b'].userId);
      const captures = queries.filter(sql => sql.includes('FROM public."AiBudgetReservation"')).length;
      await hooks.onBeforeReset(fixture, `stub-attempt-${runtimeRuns}`);
      assert.ok(queries.filter(sql => sql.includes('FROM public."AiBudgetReservation"')).length > captures, 'captureSpend precedes runtime truncate');
      queries.push('RUNTIME_TRUNCATE');
      let preceding: unknown;
      for (const [turnIndex, turn] of fixture.turns.entries()) {
        await hooks.onBeforeTurn(fixture, turnIndex, `stub-attempt-${runtimeRuns}`);
        const messages = stubGateway({ text: turn.user, actor: turn.pressFrom,
          ...(turn.action ? { postback: selectRuntimePostback(preceding, turn.action.label) } : {}) });
        const receipt = { messages, at: 10 + turnIndex, receiptId: `stub-${turnIndex}` };
        const paidAmount = wrongWrite ? '999.00' : '1000.00';
        const before = { ExpenseRecord: [{ id: 'workflow-expense-b-9', status: 'CONFIRMED', paymentStatus: 'UNPAID', paidAmount: '0.00' }], ExpensePayment: [] };
        const after = turnIndex ? { ExpenseRecord: [{ id: 'workflow-expense-b-9', status: 'CONFIRMED', paymentStatus: wrongWrite ? 'PARTIALLY_PAID' : 'PAID', paidAmount }],
          ExpensePayment: [{ id: 'stub-payment', expenseId: 'workflow-expense-b-9', status: 'RECORDED', amount: paidAmount, paidAt: '2026-11-04T00:00:00.000Z', paymentMethod: 'CASH' }] } : before;
        const evidence = { ...fakeEvidence(fixture.id, turnIndex), user: turn.user, inputKind: turn.action?.type ?? 'message', action: turn.action,
          pressFrom: turn.pressFrom, companyId: 'company-b', sourceSnapshot: fixture.fixture.sourceSnapshot, snapshotDigest: manifest.snapshotDigests[fixture.fixture.sourceSnapshot],
          receipts: [receipt], webhookEvents: [{ status: 'completed' }],
          delivery: runtimeDeliveryEvidence([], [{ id: `outcome-${turnIndex}`, messagesJson: messages, deliveredAt: new Date() }], [receipt]),
          businessSnapshotBefore: { business: before, collectionState: {} }, businessSnapshot: { business: after, collectionState: {} },
          workflowPreviews: runtimeDeliveredPreviews([receipt], [previewEntry], renderStubPreview),
          workflowTasks: [{ kind: 'expense_pay', status: turnIndex ? 'COMPLETED' : 'OPEN', sourceId: 'workflow-expense-b-9', deadEnd: false }],
          unintendedEffects: runtimeBusinessEffects(before, after) };
        turns.push(evidence);
        if (capNextRun) { capCounter++; capNextRun = false; }
        try { await hooks.onTurn(evidence); }
        catch (error) { if ((error as Error).message === 'EVAL_CAP_REACHED') return { records: [], turnEvidence: [], runtimeDiagnostics: [] }; throw error; }
        if (interruptFirstRun) { interruptFirstRun = false; throw new Error('SIMULATED_CRASH'); }
        preceding = messages;
      }
      await hooks.onConversationComplete(fixture, `stub-attempt-${runtimeRuns}`);
      return { records: [], turnEvidence: turns, runtimeDiagnostics: [] };
    };
    try {
      await assert.rejects(runReal({ environment, pg, oracle: oracle as any, runtime: runtime as any }), /SIMULATED_CRASH/);
      const progressPath = join(root, readdirSync(root).find(name => name.endsWith('.progress.json'))!);
      assert.equal(JSON.parse(readFileSync(progressPath, 'utf8')).inFlightAttemptId, 'stub-attempt-1');
      await runReal({ environment: { ...environment, MANGMEE_EVAL_RESUME: progressPath }, pg, oracle: oracle as any, runtime: runtime as any });
      const evidencePath = join(root, readdirSync(root).find(name => name.endsWith('.evidence.json'))!);
      const saved = JSON.parse(readFileSync(evidencePath, 'utf8'));
      assert.equal(saved.corpusVersion, 2);
      assert.equal(saved.turnEvidence.length, 5, 'abandoned turn plus append and final evidence remain readable through deduplication');
      assert.ok(saved.turnEvidence.every((row: any) => row.providerUsage.length === 0));
      assert.equal(saved.progress.completedAttempts[selectedCorpus.conversations[0].id], 'stub-attempt-2');
      assert.deepEqual(workflowAttemptsFromEvidence(selectedCorpus, saved.turnEvidence, saved.progress.completedAttempts).map(attempt => attempt.complete), [false, true]);
      assert.equal(saved.workflowMetrics.W13.candidateExact, '0');
      assert.equal(saved.workflowMetrics.W6.wrongApplied, 0);
      assert.deepEqual(saved.workflowMetrics.W6, { wrongApplied: 0, wrongPreview: 0 });
      assert.deepEqual(saved.workflowMetrics.W3, { passed: 1, total: 1 });
      assert.equal(saved.summary.failed, 0);
      assert.equal(readFileSync(evidencePath.replace('.evidence.json', '.spend.jsonl'), 'utf8'), '');
      assert.deepEqual(saved.workflowMetrics.buttonBaseline, { passed: 1, total: 1 });
      assert.deepEqual(saved.workflowMetrics, scoreWorkflowCorpus({ corpus: selectedCorpus, now: new Date(saved.startedAt), classifierLabels: 'messages',
        attempts: workflowAttemptsFromEvidence(selectedCorpus, saved.turnEvidence, saved.progress.completedAttempts) }));
      const reportPath = evidencePath.replace('.evidence.json', '.report.md');
      assert.match(readFileSync(reportPath, 'utf8'), /\| W15 \|/);
      assert.match(readFileSync(reportPath, 'utf8'), /\| buttonBaseline \|/);
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/line-ai-expense-advisor/run-rescore.ts'], {
        cwd: process.cwd(), env: { ...process.env, MANGMEE_EVAL_EVIDENCE: evidencePath, MANGMEE_EVAL_CORPUS: corpusPath }, stdio: 'pipe',
      });
      const rescored = readFileSync(join(root, readdirSync(root).find(name => name.includes('.rescore-'))!), 'utf8');
      assert.deepEqual(JSON.parse(rescored.match(/```json\n([\s\S]*?)\n```/)![1]!), saved.workflowMetrics);
      await runReal({ environment: { ...environment, MANGMEE_EVAL_RESUME: progressPath }, pg, oracle: oracle as any, runtime: runtime as any });
      assert.equal(runtimeRuns, 2, 'resume skips the completed workflow');
      assert.equal(oracleRuns, 3);
      assert.deepEqual(gatewayInputs.map(input => input.actor), ['owner-b', 'owner-b', 'owner-b']);
      assert.equal(gatewayInputs[2].postback, 'action=expense_action_confirm&token=stub-token');
      wrongWriteNext = true;
      await runReal({ environment, pg, oracle: oracle as any, runtime: runtime as any });
      const wrongPath = join(root, readdirSync(root).filter(name => name.endsWith('.evidence.json')).sort().at(-1)!);
      const wrong = JSON.parse(readFileSync(wrongPath, 'utf8'));
      assert.equal(wrong.workflowMetrics.W3.passed, 0);
      assert.equal(wrong.workflowMetrics.W6.wrongApplied, 2);
      assert.equal(wrong.workflowMetrics.W5.byKind.expense_pay.completedTasks, 0);
      await runReal({ environment: { ...environment, MANGMEE_EVAL_ONLY: wrongPath, MANGMEE_EVAL_ONLY_FAILED: '1' }, pg, oracle: oracle as any, runtime: runtime as any });
      assert.equal(runtimeRuns, 4, 'ONLY_FAILED selects the whole failed conversation');
      capNextRun = true;
      await runReal({ environment, pg, oracle: oracle as any, runtime: runtime as any });
      const capPath = join(root, readdirSync(root).filter(name => name.endsWith('.evidence.json')).sort().at(-1)!);
      const capped = JSON.parse(readFileSync(capPath, 'utf8'));
      assert.equal(capped.status, 'CAP_REACHED');
      assert.equal(capped.workflowMetrics, undefined, 'cap-rejected attempts are not scored');
      assert.equal(capped.progress.inFlightAttemptId, 'stub-attempt-5');
    } finally { process.exitCode = previousExitCode; rmSync(root, { recursive: true, force: true }); }
  });

  it('builds one three-company seed for free, unlinked, creator-only and branch-limited actors', async () => {
    const { buildWorkflowReplay } = await import('./run-real');
    const { buildWorkflowSeed } = await import('./seed');
    const { validateWorkflowPreflight } = await import('./run-preflight');
    const now = new Date(), actors = [
      { key: 'stranger', kind: 'unlinked' },
      { key: 'creator', kind: 'creator-only', company: 'B', role: 'STAFF', branchScope: 'all' },
      { key: 'free-owner', company: 'A', role: 'OWNER', branchScope: 'all', freeSourceDrafts: true },
      { key: 'limited-manager', company: 'B', role: 'MANAGER', branchScope: { branches: ['branch-b-1'] } },
    ];
    const corpus = { version: 2, seed: 'actors', status: 'draft', conversations: actors.map(actor => ({ id: actor.key, category: 'boundary', journeyKind: 'typed', actors: [actor], tasks: [],
      turns: [{ user: 'สวัสดี', expect: { card: 'refusal', maxModelCalls: 0, ...(actor.freeSourceDrafts ? { refusal: { reason: 'free', wayOut: ['เมนูหลัก'] } } : {}) } }] })) } as any;
    const seed = buildWorkflowSeed(now, actors as any);
    validateWorkflowPreflight(corpus, seed, now);
    const replay = buildWorkflowReplay(corpus, seed, now);
    assert.equal(new Set(seed.rows.filter(row => row.model === 'company').map(row => row.data.id)).size, 3);
    assert.equal(replay.fixtures[0].fixture.membership, null);
    assert.equal(replay.snapshots.stranger.actors!.stranger.kind, 'unlinked');
    assert.ok(replay.fixtures[1].fixture.permissions.includes('expense.create'));
    assert.ok(['expense.read', 'expense.read_own', 'expense.read_related'].every(permission => !replay.fixtures[1].fixture.permissions.includes(permission)));
    assert.deepEqual(replay.fixtures[3].fixture.branches, ['branch-b-1']);
    assert.ok(Object.values(replay.snapshots).every(snapshot => snapshot.rows === seed.rows));
    const withFixture = structuredClone(corpus);
    withFixture.conversations[1].turns[0].fixture = [{ op: 'setCredit', state: 'exhausted' }];
    withFixture.conversations[1].turns.push({ user: 'คำถามถัดมา', expect: {} },
      { as: { key: 'creator' }, press: 'ยืนยัน', pressFrom: { turn: 0, actor: { key: 'creator' } }, expect: {} });
    const configured = buildWorkflowReplay(withFixture, seed, now).fixtures[1];
    assert.equal(configured.turns[0].fixture?.[0].op, 'setCredit');
    assert.deepEqual(configured.turns[2].pressOrigin, { turn: 0, actor: 'creator' });
    withFixture.conversations[1].turns[0].fixture = [{ op: 'unknown' }];
    assert.throws(() => buildWorkflowReplay(withFixture, seed, now), /REPLAY_FIXTURE_OP_UNKNOWN/);
  });

  it('keeps the v1 runner on the legacy oracle, scorer and report path', async () => {
    const { runReal } = await import('./run-real');
    const { summarizeScores } = await import('./scorer');
    const { renderReport } = await import('./report');
    const { flattenTurns } = await import('./types');
    const root = mkdtempSync(join(tmpdir(), 'legacy-real-stub-')), previousExitCode = process.exitCode;
    const corpus = { version: 1, conversations: [{ id: 'legacy', company: 'A', role: 'OWNER', turns: [{ user: 'สวัสดี', category: 'general', expect: { tags: { no_tool: true, must_answer: true } } }] }] } as any;
    const corpusPath = join(root, 'corpus.json'), secretsPath = join(root, 'synthetic-config.json');
    writeFileSync(corpusPath, JSON.stringify(corpus));
    writeFileSync(secretsPath, JSON.stringify({ databaseUrl: 'postgresql://synthetic:synthetic@127.0.0.1:15440/watchdog_ai_reliability_replay_expense_advisor' }));
    writeFileSync(join(root, 'gateway.manifest.json'), JSON.stringify({ transport: 'bedrock' }));
    const goldPass = { resultsByTurn: new Map(), factsByTurn: new Map(), resolvedCallsByTurn: new Map(), alternativeFactsByTurn: new Map() };
    const evidence = { ...fakeEvidence('legacy', 0), user: 'สวัสดี', receipts: [{ messages: [{ type: 'text', text: 'สวัสดีค่ะ' }], at: 10, receiptId: 'stub' }] } as any;
    try {
      await runReal({ environment: { MANGMEE_EVAL_OUTPUT_DIR: root, MANGMEE_EVAL_GATEWAY_URL: 'http://127.0.0.1:19205/v1',
        MANGMEE_EVAL_CORPUS: corpusPath, MANGMEE_EVAL_SECRETS_PATH: secretsPath, MANGMEE_EVAL_MAX_THB: '1' },
        pg: { async connect() {}, async end() {}, async query(sql: string) { return { rows: sql.includes('current_database()') ? [{ name: 'watchdog_ai_reliability_replay_expense_advisor' }] : [] }; } },
        oracle: async (...args: any[]) => { assert.equal(args[1].version, 1); await args[7](); return goldPass; },
        runtime: async (manifest, _repo, hooks) => {
          const fixture = manifest.corpus.fixtures[0]!;
          assert.equal(fixture.fixture.sourceSnapshot, 'A-OWNER');
          assert.equal(manifest.snapshots['A-OWNER']!.actors, undefined);
          await hooks?.onBeforeReset?.(fixture, 'legacy-attempt');
          await hooks?.onTurn?.(evidence);
          await hooks?.onConversationComplete?.(fixture, 'legacy-attempt');
          return { records: [], turnEvidence: [], runtimeDiagnostics: [] };
        },
      });
      const evidencePath = join(root, readdirSync(root).find(name => name.endsWith('.evidence.json'))!);
      const saved = JSON.parse(readFileSync(evidencePath, 'utf8'));
      const scores = scoreAllTurns(flattenTurns(corpus), saved.turnEvidence, goldPass, new Date(saved.startedAt));
      assert.deepEqual(saved.scores, scores);
      assert.deepEqual(saved.summary, summarizeScores(scores));
      assert.equal(saved.workflowMetrics, undefined);
      assert.equal(readFileSync(evidencePath.replace('.evidence.json', '.report.md'), 'utf8'), renderReport({
        corpus, sourceCommit: saved.sourceCommit, now: new Date(saved.startedAt), scores, summary: saved.summary, turnEvidence: saved.turnEvidence,
      }));
    } finally { process.exitCode = previousExitCode; rmSync(root, { recursive: true, force: true }); }
  });
});

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
  it('counts an accepted free_expense_month_summary as an answered task with Flex text and model evidence', () => {
    const corpus = { conversations: [{ id: 'free', actors: [{ key: 'reader', freeSourceDrafts: true }], turns: [{ expect: { card: 'answer', maxModelCalls: 0 } }] }] } as any;
    const row = { ...fakeEvidence('free', 0), attemptId: 'one', webhookEvents: [{ status: 'free_expense_month_summary' }],
      receipts: [{ messages: [{ type: 'flex', contents: { type: 'text', text: 'ยังไม่ยืนยัน 100 บาท' } }], at: 10, receiptId: 'reply' }],
      gatewayResponses: [{ method: 'requestLineIntakeRoute', response: {} }] } as any;
    const turn = workflowAttemptsFromEvidence(corpus, [row])[0].turns[0];
    assert.equal(turn.terminalEffect, 'ANSWERED');
    assert.match(turn.deliveredText!, /ยังไม่ยืนยัน 100 บาท/);
    assert.equal(turn.textModelAttempts, 1);
    for (const overrides of [{ receipts: [] }, { delivery: { status: 'INCOMPLETE' } }, { webhookEvents: [{ status: 'free_expense_ai_not_allowed' }] }])
      assert.equal(workflowAttemptsFromEvidence(corpus, [{ ...row, ...overrides }])[0].turns[0].terminalEffect, undefined);
  });
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

describe('attempt spend attribution', () => {
  it('excludes previous-run rows, keeps original attempt ownership and appends only changed invocation states', async () => {
    const { captureSpend, readJsonLines } = await import('./eval-spend');
    const root = mkdtempSync(join(tmpdir(), 'spend-attribution-')), path = join(root, 'spend.jsonl');
    const databaseUrl = 'postgresql://test:test@127.0.0.1:15440/watchdog_ai_reliability_replay_spend';
    let rows: any[] = [{ invocationKey: 'old-run', status: 'SETTLED', upperBoundSatang: 449, evidenceJson: { customerChargedSatang: 449 } }];
    let guardedTotal: string | undefined;
    const pg = { async query(sql: string, values?: unknown[]) {
      if (sql.startsWith('UPDATE eval_guard.ledger_satang')) guardedTotal = String(values?.[0]);
      return { rows: sql.includes('current_database()') ? [{ name: 'watchdog_ai_reliability_replay_spend' }]
        : sql.includes('FROM public."AiBudgetReservation"') ? rows : [] };
    } };
    try {
      await captureSpend(pg, databaseUrl, path, 'previousRun', 'previousRun');
      assert.equal(guardedTotal, '0');
      await captureSpend(pg, databaseUrl, path, 'oracle');
      assert.equal(readJsonLines(path).length, 1, 'the oracle cannot duplicate startup rows');
      rows = [{ invocationKey: 'first', status: 'DISPATCHED', upperBoundSatang: 20 }];
      await captureSpend(pg, databaseUrl, path, 'attempt-1');
      rows = [{ invocationKey: 'first', status: 'SETTLED', upperBoundSatang: 20, evidenceJson: { customerChargedSatang: 10 } },
        { invocationKey: 'second', status: 'SETTLED', upperBoundSatang: 30, evidenceJson: { customerChargedSatang: 25 } }];
      await captureSpend(pg, databaseUrl, path, 'attempt-2');
      await captureSpend(pg, databaseUrl, path, 'final');
      const ledger = readJsonLines<any>(path);
      assert.equal(ledger.length, 4, 'only the settlement appends a second state for an existing key');
      assert.deepEqual(ledger.map(row => [row.invocationKey, row.attemptId]),
        [['old-run', 'previousRun'], ['first', 'attempt-1'], ['first', 'attempt-1'], ['second', 'attempt-2']]);
      assert.equal(ledger[0].scope, 'previousRun');
      assert.equal(guardedTotal, '37');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});


describe('smoke-run endings and spend', () => {
  it('exits complete, scored-failure, cap and infrastructure-failure children with flushed checkpoints and correctly owned spend', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-smoke-endings-'));
    const child = join(root, 'stub.cjs');
    writeFileSync(child, String.raw`
      const {writeFileSync} = require('node:fs');
      const {join} = require('node:path');
      const {runRealCli} = require(process.cwd()+'/scripts/line-ai-expense-advisor/run-real.ts');
      const {resolveRuntimePostback} = require(process.cwd()+'/scripts/line-ai-reliability-runtime.ts');
      const root = process.argv[2], mode = process.argv[3];
      const free = mode === 'missing';
      const actor = {key:'owner',company:free?'A':'B',role:'OWNER',branchScope:'all',...(free?{freeSourceDrafts:true}:{})};
      const expect = {card:'answer',maxModelCalls:0};
      const corpus = {version:2,seed:'smoke',status:'draft',classifierLabels:'messages',conversations:[
        {id:'first',category:'read',journeyKind:'typed',actors:[actor],tasks:[{id:'read-first',kind:'read',startTurn:0,endTurn:2,
          minimalTurns:3,completable:true,goldTerminal:{effect:'ANSWERED',records:[]}}],turns:[
            {user:'ดูรายการ',expect},{press:'ไปต่อ',pressFrom:{turn:0},expect:{...expect,label:'ไปต่อ'}},{user:'ดูสรุป',expect}]},
        {id:'second',category:'read',journeyKind:'typed',actors:[actor],tasks:[{id:'read-second',kind:'read',startTurn:0,endTurn:0,
          minimalTurns:1,completable:true,goldTerminal:{effect:'ANSWERED',records:[]}}],turns:[{user:'ดูรายการ',expect}]}]};
      const corpusPath = join(root,'corpus.json'), secretsPath = join(root,'synthetic.json');
      writeFileSync(corpusPath,JSON.stringify(corpus));
      writeFileSync(secretsPath,JSON.stringify({databaseUrl:'postgresql://test:test@127.0.0.1:15440/watchdog_ai_reliability_replay_expense_advisor'}));
      writeFileSync(join(root,'gateway.manifest.json'),JSON.stringify({transport:'bedrock'}));
      let rows=[{invocationKey:'leftover',status:'SETTLED',upperBoundSatang:449,evidenceJson:{customerChargedSatang:449}}], cap=0;
      const sent=[];
      const pg={async connect(){},async end(){writeFileSync(join(root,'pg-ended'),'yes');},async query(sql,args){
        if(sql.startsWith('UPDATE eval_guard.ledger_satang'))writeFileSync(join(root,'guard-total'),String(args[0]));
        return {rows:sql.includes('current_database()')?[{name:'watchdog_ai_reliability_replay_expense_advisor'}]
          :sql.includes('FROM public."AiBudgetReservation"')?structuredClone(rows)
          :sql.startsWith('SELECT')&&sql.includes('cap_rejections')?[{value:cap}]:[]};}};
      const oracle=async(...args)=>{await args[7]();rows=[];return {resultsByTurn:new Map(),factsByTurn:new Map(),resolvedCallsByTurn:new Map(),alternativeFactsByTurn:new Map()};};
      const runtime=async(manifest,repo,hooks)=>{
        const evidence=[];
        for(const fixture of manifest.corpus.fixtures){
          const attemptId='attempt-'+fixture.id;
          await hooks.onBeforeReset(fixture,attemptId); rows=[];
          let blocked, previous=[];
          for(const [turnIndex,turn] of fixture.turns.entries()){
            await hooks.onBeforeTurn(fixture,turnIndex,attemptId);
            if(turnIndex===0)rows.push({invocationKey:fixture.id,status:'SETTLED',upperBoundSatang:30,
              evidenceJson:{customerChargedSatang:fixture.id==='first'?10:20}});
            if(mode==='failure')throw new Error('STUB_DATABASE_DOWN');
            const selected=!blocked&&turn.action?resolveRuntimePostback(previous,turn.action.label):undefined;
            const replayFailure=blocked?{reason:'turn_unreached',turnIndex,blockedByTurnIndex:blocked.turnIndex}
              :selected?.failure?{reason:selected.failure,turnIndex}:undefined;
            if(selected?.failure)blocked=replayFailure;
            const action=data=>({type:'postback',label:'ไปต่อ',data});
            const messages=replayFailure?[]:[{type:'text',text:'แสดงรายการแล้วค่ะ'},
              ...(fixture.id==='first'&&turnIndex===0&&mode!=='missing'?[{type:'flex',contents:{footer:{contents:
                [action('first-card'),...(mode==='ambiguous'?[action('different-card')]:[])]}}}]:[])];
            if(!replayFailure)sent.push({conversationId:fixture.id,turnIndex});
            const row={scenarioId:fixture.id,repeat:0,turnIndex,user:turn.user,attachmentIds:[],inputKind:turn.action?.type??'message',action:turn.action,
              pressFrom:'owner',companyId:fixture.fixture.company,sourceSnapshot:fixture.id,snapshotDigest:manifest.snapshotDigests[fixture.id],
              acceptedAtMs:0,modelWorkCompletedAtMs:0,receipts:messages.length?[{messages,at:10,receiptId:fixture.id+'-'+turnIndex}]:[],
              toolResults:[],gatewayResponses:[],webhookEvents:free?[{status:'free_expense_month_summary'}]:[],providerUsage:[],reservations:[],
              reviewState:{before:{draftActions:[],conversations:[],truncated:false},after:{draftActions:[],conversations:[],truncated:false}},
              businessSnapshot:{business:{},collectionState:{}},unintendedEffects:[],workflowTasks:replayFailure?[]:[{kind:'read',status:'COMPLETED'}],
              delivery:{status:replayFailure?'NONE':'ACCEPTED'},...(replayFailure?{replayFailure}:{})};
            evidence.push(row);
            if(mode==='cap')cap++;
            try{await hooks.onTurn(row);}catch(error){if(error.message==='EVAL_CAP_REACHED')return {records:[],turnEvidence:[],runtimeDiagnostics:[]};throw error;}
            previous=messages;
          }
          await hooks.onConversationComplete(fixture,attemptId);
        }
        writeFileSync(join(root,'sent.json'),JSON.stringify(sent));
        return {records:[],turnEvidence:evidence,runtimeDiagnostics:[]};
      };
      setInterval(()=>{},1000); // A leaked third-party handle must not keep the CLI alive.
      void runRealCli({environment:{MANGMEE_EVAL_OUTPUT_DIR:root,MANGMEE_EVAL_GATEWAY_URL:'http://127.0.0.1:19205/v1',
        MANGMEE_EVAL_SECRETS_PATH:secretsPath,MANGMEE_EVAL_CORPUS:corpusPath,MANGMEE_EVAL_MAX_THB:'1'},pg,oracle,runtime});
    `);
    try {
      for (const mode of ['complete', 'missing', 'ambiguous', 'cap', 'failure']) {
        const directory = join(root, mode);
        mkdirSync(directory);
        const result = spawnSync(process.execPath, ['--import', 'tsx', child, directory, mode], { cwd: process.cwd(), timeout: 6000, encoding: 'utf8' });
        assert.equal(result.error, undefined, `${mode} must exit without a parent kill`);
        assert.equal(result.status, mode === 'complete' ? 0 : mode === 'cap' ? 2 : 1, result.stderr);
        assert.equal(readFileSync(join(directory, 'pg-ended'), 'utf8'), 'yes');
        const evidencePath = join(directory, readdirSync(directory).find(name => name.endsWith('.evidence.json'))!);
        const saved = JSON.parse(readFileSync(evidencePath, 'utf8'));
        assert.ok(readFileSync(evidencePath.replace('.evidence.json', '.report.md'), 'utf8').length);
        assert.equal(saved.previousRun.length, 1);
        assert.equal(saved.previousRun[0].invocationKey, 'leftover');
        assert.equal(saved.previousRun[0].scope, 'previousRun');
        assert.ok(saved.spend.every((row: any) => row.attemptId === `attempt-${row.invocationKey}`));
        assert.equal(readFileSync(join(directory, 'guard-total'), 'utf8'), ['cap', 'failure'].includes(mode) ? '11' : '32');
        const ledger = readFileSync(evidencePath.replace('.evidence.json', '.spend.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        assert.equal(ledger.length, ['cap', 'failure'].includes(mode) ? 2 : 3, 'oracle/final capture must not duplicate rows');
        if (mode === 'cap' || mode === 'failure') {
          assert.equal(saved.status, mode === 'cap' ? 'CAP_REACHED' : 'FAILED_RESUMABLE');
          continue;
        }
        assert.equal(saved.status, 'COMPLETE');
        assert.deepEqual(saved.progress.completedConversationIds, ['first', 'second']);
        assert.equal(saved.summary.passed, mode === 'complete' ? 2 : 1);
        assert.equal(saved.summary.failed, mode === 'complete' ? 0 : 1);
        if (mode !== 'complete') {
          const failed = saved.turnEvidence.find((row: any) => row.scenarioId === 'first' && row.turnIndex === 1);
          assert.equal(failed.replayFailure.reason, mode === 'missing' ? 'press_target_not_delivered' : 'press_target_ambiguous');
          assert.equal(saved.summary.failures[0].reasons[0].turnIndex, 1);
          assert.equal(saved.turnEvidence.find((row: any) => row.scenarioId === 'first' && row.turnIndex === 2).replayFailure.reason, 'turn_unreached');
          assert.deepEqual(JSON.parse(readFileSync(join(directory, 'sent.json'), 'utf8')),
            [{ conversationId: 'first', turnIndex: 0 }, { conversationId: 'second', turnIndex: 0 }]);
        }
        const corpus = JSON.parse(readFileSync(join(directory, 'corpus.json'), 'utf8'));
        const { scoreWorkflowCorpus } = await import('./scorer');
        assert.deepEqual(scoreWorkflowCorpus({ corpus, attempts: workflowAttemptsFromEvidence(corpus, saved.turnEvidence, saved.progress.completedAttempts),
          now: new Date(saved.startedAt), classifierLabels: 'messages', includeButtonBaseline: true }), saved.workflowMetrics);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
