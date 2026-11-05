#!/usr/bin/env -S node --import tsx
/**
 * Offline rescore (task item "re-run a subset"'s sibling: re-score after a scorer or corpus fix,
 * paying for NO model call at all). Given a saved run-real.ts `*.evidence.json`, re-runs ONLY the
 * gold oracle pass (DB truncate+seed + the compiled API as an in-process application context — no
 * HTTP listener, no AI Gateway, no LINE webhook, no model) against the CURRENT corpus, then
 * re-scores the SAVED `turnEvidence` with the CURRENT scorer.ts, and writes a new report next to
 * the input evidence file.
 *
 * This is how the controller confirms a scorer/oracle fix (e.g. T-068's resolved-input fix) against
 * a real captured run WITHOUT re-paying for Bedrock calls: the model's actual replies never change,
 * only how correctly they get scored.
 *
 * `now` is taken from the SAVED evidence's own `startedAt`, never today's real clock — the oracle's
 * gold facts (e.g. "this month's total") are only comparable to what the model actually saw if the
 * re-seed reproduces the SAME civil date the original run used.
 *
 * The saved evidence must come from the SAME corpus conversations, matched by id (task
 * requirement): every `turnEvidence[].scenarioId` must name a conversation that still exists, by
 * id, in the CURRENT corpus — reuses `selectConversations`' own check (types.ts), which throws on
 * a stale/renamed id rather than silently scoring fewer turns than the evidence actually has.
 *
 * Usage: node_modules/.bin/tsx scripts/line-ai-expense-advisor/run-rescore.ts
 * Required env:
 *   MANGMEE_EVAL_EVIDENCE   path to a previous run's *.evidence.json
 * Optional env:
 *   MANGMEE_EVAL_CORPUS         default scripts/line-ai-expense-advisor/corpus.sample.json
 *   MANGMEE_EVAL_SECRETS_PATH   default /tmp/mangmee-latency-pilot-20260927/runtime-secrets.json
 *   MANGMEE_EVAL_REDIS_URL      default redis://127.0.0.1:16389/13
 * CLI: --classifier-labels=messages opts into message-only W1 and the separate button baseline.
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCorpus, validateWorkflowCorpus, flattenTurns, selectConversations, type Corpus, type EvalCompany, type WorkflowCorpus } from './types';
import { buildCompanySeed, type CompanySeed } from './seed';
import { scoreWorkflowCorpus, summarizeScores, type WorkflowRunAttempt, type WorkflowTurnEvidence } from './scorer';
import { collectGoldResults, deliveredKnowledgeCards, scoreAllTurns, toCapturedEvidence } from './gold-oracle-pass';
import { gitHeadSha, observedWorkflowTerminals } from './oracle';
import { renderReport, renderWorkflowReport } from './report';
import type { RuntimeTurnEvidence } from '../line-ai-reliability-runtime';
import { captureSpend, installEvalGuard } from './eval-spend';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SECRETS_PATH = process.env['MANGMEE_EVAL_SECRETS_PATH'] ?? '/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json';
const DB_NAME = 'watchdog_ai_reliability_replay_expense_advisor';
const CORPUS_PATH = process.env['MANGMEE_EVAL_CORPUS'] ?? resolve(REPO_ROOT, 'scripts/line-ai-expense-advisor/corpus.sample.json');
const REDIS_URL = process.env['MANGMEE_EVAL_REDIS_URL'] ?? 'redis://127.0.0.1:16389/13';

/** The minimal shape of a run-real.ts `*.evidence.json` this script actually reads. */
export type SavedEvidenceFile = {
  startedAt: string;
  sourceCommit: string;
  turnEvidence: Array<RuntimeTurnEvidence & { attemptId?: string }>;
  classifierLabels?: 'messages';
  includeButtonBaseline?: boolean;
  progress?: { completedAttempts: Record<string, string> };
  subset?: { onlyIds: string[]; description: string };
};

/** Rebuild the v2 scorer input from the persisted turn snapshots; no API/oracle reads are needed. */
export function workflowAttemptsFromEvidence(corpus: WorkflowCorpus, rows: SavedEvidenceFile['turnEvidence'], completedAttempts?: Record<string, string>): WorkflowRunAttempt[] {
  const grouped = new Map<string, Array<RuntimeTurnEvidence & { attemptId?: string }>>();
  for (const row of rows) if (row.attemptId) {
    const key = `${row.scenarioId}\u0000${row.attemptId}`;
    grouped.set(key, [...(grouped.get(key) ?? []).filter(existing => existing.turnIndex !== row.turnIndex), row]);
  }
  return [...grouped.values()].map(turnRows => {
    turnRows.sort((a, b) => a.turnIndex - b.turnIndex);
    const first = turnRows[0]!;
    const conversation = corpus.conversations.find(row => row.id === first.scenarioId)!;
    const finalSnapshot = turnRows.at(-1)?.businessSnapshot;
    const finalDrafts = [...(finalSnapshot?.business.ReimbursementDraftAction ?? []), ...(finalSnapshot?.collectionState.ReimbursementDraftAction ?? [])];
    const turns: WorkflowTurnEvidence[] = turnRows.map(row => {
      const reservations = row.reservations as Array<Record<string, any>>;
      const usage = row.providerUsage as Array<Record<string, any>>;
      const calls = usage.map(call => {
        const reservation = reservations.find(item => item.invocationKey === call.invocationKey);
        const pricing = reservation?.pricingSnapshot as Record<string, any> | undefined;
        const heldEvidence = reservation?.evidenceJson as Record<string, any> | undefined;
        return { tag: String(call.usageTag ?? ''), modelId: String(call.modelId ?? ''), ok: call.ok === true,
          errorCode: typeof call.errorCode === 'string' ? call.errorCode : undefined,
          tokens: { input: Number(call.inputTokens ?? 0), output: Number(call.outputTokens ?? 0), cacheRead: Number(call.cacheReadInputTokens ?? 0), cacheWrite: Number(call.cacheWriteInputTokens ?? 0) },
          externalUnits: heldEvidence?.externalUnits, tariff: pricing?.tariff,
          recordedCostSatang: Number(call.costSatang ?? 0), basis: call.usageBasis === 'PROVIDER_REPORTED' ? 'measured' as const : 'estimated' as const };
      });
      const classify = row.gatewayResponses.find(call => call.method === 'requestLineWorkflowClassify')?.response as Record<string, any> | undefined;
      const receipts = row.receipts.flatMap(receipt => Array.isArray(receipt.messages) ? receipt.messages as Array<Record<string, any>> : []);
      const deliveredActions = receipts.flatMap(message => Array.isArray(message.quickReply?.items)
        ? message.quickReply.items.map((item: Record<string, any>) => ({ type: 'choice', label: item.action?.label ?? item.label })) : []);
      const latencyMs = row.receipts.length ? Math.max(...row.receipts.map(receipt => receipt.at)) - row.acceptedAtMs : null;
      const expect = conversation.turns[row.turnIndex]?.expect;
      const actorKey = conversation.turns[row.turnIndex]?.as?.key ?? conversation.actors[0]?.key;
      const freeAnswer = expect?.card === 'answer' && !expect.refusal && conversation.actors.find(actor => actor.key === actorKey)?.freeSourceDrafts;
      const answerGold = expect?.knowledge || expect?.dueDate || expect?.refusal || freeAnswer;
      const previews = (row.workflowPreviews ?? []).map(preview => {
        const applied = preview.draftActionId && finalDrafts.find(draft => draft.id === preview.draftActionId && draft.requestId);
        return applied ? { ...preview, target: applied.requestId } : preview;
      });
      const tasks = row.workflowTasks ?? [];
      const observed = observedWorkflowTerminals(row.unintendedEffects ?? [], row.businessSnapshotBefore?.business ?? {}, row.businessSnapshot?.business ?? {});
      if (row.delivery?.status === 'ACCEPTED') {
        if (tasks.some(task => task.status === 'DECLINED')) observed.push('DECLINED');
        if (tasks.some(task => task.status === 'REFUSED')) observed.push('REFUSED');
        if (!observed.length && tasks.some(task => task.status === 'COMPLETED' && ['read', 'open', 'smalltalk'].includes(task.kind))) observed.push('ANSWERED');
      }
      const workflow = tasks.at(-1);
      return { attemptId: row.attemptId!, conversationId: row.scenarioId, turnIndex: row.turnIndex, actorKey: row.pressFrom ?? conversation.turns[row.turnIndex]?.as?.key ?? conversation.actors[0]?.key ?? '',
        inputKind: row.inputKind ?? 'message', classifier: classify ? { label: classify.label, confidence: classify.confidence, schemaValid: classify.schemaValid, timedOut: classify.timedOut } : undefined,
        calls, effects: (row.unintendedEffects ?? []).map(effect => ({ kind: effect.kind, recordId: effect.recordId })),
        businessSnapshot: row.businessSnapshot ?? { business: {}, collectionState: {} }, unintendedEffects: (row.unintendedEffects ?? []).map(effect => ({ kind: effect.kind, recordId: effect.recordId })),
        deliveredActions: [...deliveredActions, ...previews.map(preview => ({ type: 'preview', preview }))], preview: previews[0], latencyMs, deliveredText: receipts.flatMap(message => typeof message.text === 'string' ? [message.text] : []).join('\n'),
        ...(observed.length ? { terminalEffect: observed[0], terminalEffects: [...new Set(observed)] } : {}),
        ...(workflow ? { workflowKind: workflow.kind, targetId: workflow.sourceId ?? undefined, deadEnd: workflow.deadEnd === true } : {}),
        ...(row.webhookEvents.some(event => (event as { status?: string }).status === 'free_expense_month_summary') && row.delivery?.status === 'ACCEPTED' && row.receipts.length ? { terminalEffect: 'ANSWERED' } : {}),
        ...(row.action && !row.replayFailure ? { pressedLabel: row.action.label } : {}),
        ...(row.replayFailure ? { deadEnd: true } : {}),
        ...(answerGold ? { deliveredCards: deliveredKnowledgeCards(row), deliveredText: toCapturedEvidence(row).deliveredTextExcludingQuickReplies,
          textModelAttempts: Math.max(row.gatewayResponses.length, reservations.length),
          toolCalls: row.toolResults.map(call => ({ tool: call.tool, input: call.input as Record<string, unknown> })) } : {}) };
    });
    const turnIndexes = new Set(turns.map(turn => turn.turnIndex));
    return { attemptId: first.attemptId!, conversationId: first.scenarioId, turns,
      complete: (!completedAttempts || completedAttempts[first.scenarioId] === first.attemptId)
        && turnIndexes.size === conversation.turns.length && conversation.turns.every((_, index) => turnIndexes.has(index)) };
  });
}

/** Every distinct conversation id the saved evidence covers, in first-seen order — pure, so it is
 * testable without touching the filesystem or the DB. */
export function scenarioIdsIn(turnEvidence: readonly RuntimeTurnEvidence[]): string[] {
  return [...new Set(turnEvidence.map((row) => row.scenarioId))];
}

/** Where the new report lands: next to the input evidence file (task requirement), named so it
 * cannot collide with — or be mistaken for — the original run's own `.report.md`. Pure string/path
 * logic, no filesystem access, so it is directly testable. */
export function rescoreReportPath(evidencePath: string, now: Date): string {
  const dir = dirname(evidencePath);
  const base = evidencePath.replace(/\.evidence\.json$/, '').split('/').pop();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return resolve(dir, `${base}.rescore-${stamp}.report.md`);
}

/** Restricts the CURRENT corpus to exactly the conversations the saved evidence covers — reusing
 * `selectConversations`' own "no conversation with that id" throw (types.ts) as THIS task's
 * required check ("the saved evidence must come from the same corpus conversations, match by
 * id"), wrapped with a clearer, rescore-specific message. */
function corpusForRescore(corpus: Corpus, evidencePath: string, turnEvidence: readonly RuntimeTurnEvidence[]): Corpus {
  const ids = scenarioIdsIn(turnEvidence);
  try {
    return { ...corpus, conversations: selectConversations(corpus, ids) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${evidencePath}'s evidence does not match ${CORPUS_PATH} (a conversation was renamed/removed?): ${reason}`);
  }
}

async function main(): Promise<void> {
  const evidencePath = process.env['MANGMEE_EVAL_EVIDENCE'];
  assert.ok(evidencePath, 'MANGMEE_EVAL_EVIDENCE is required (path to a previous run-real.ts *.evidence.json)');
  assert.ok(statSync(evidencePath).size <= 128 * 1024 * 1024,
    'EVAL_EVIDENCE_TOO_LARGE: resume its progress.json to compact the turns checkpoint before rescoring');

  const saved = JSON.parse(readFileSync(evidencePath, 'utf8')) as SavedEvidenceFile;
  assert.ok(Array.isArray(saved.turnEvidence) && saved.turnEvidence.length > 0, `${evidencePath}: no turnEvidence to rescore`);
  assert.ok(typeof saved.startedAt === 'string' && !Number.isNaN(Date.parse(saved.startedAt)), `${evidencePath}: missing/invalid startedAt`);

  const rawCorpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as unknown;
  if ((rawCorpus as { version?: unknown }).version === 2) {
    validateWorkflowCorpus(rawCorpus);
    const fullCorpus = rawCorpus as WorkflowCorpus;
    const corpus = { ...fullCorpus, conversations: selectConversations(fullCorpus, saved.subset?.onlyIds ?? null) };
    const ids = new Set(corpus.conversations.map(row => row.id));
    const attempts = workflowAttemptsFromEvidence(corpus, saved.turnEvidence.filter(row => ids.has(row.scenarioId)), saved.progress?.completedAttempts);
    const metrics = scoreWorkflowCorpus({ corpus, attempts, now: new Date(saved.startedAt),
      classifierLabels: process.argv.includes('--classifier-labels=messages') ? 'messages' : saved.classifierLabels ?? corpus.classifierLabels,
      includeButtonBaseline: saved.includeButtonBaseline });
    const reportPath = rescoreReportPath(evidencePath, new Date());
    writeFileSync(reportPath, renderWorkflowReport({ sourceCommit: saved.sourceCommit, now: new Date(saved.startedAt), corpus, metrics, subset: saved.subset }));
    console.log(JSON.stringify({ event: 'workflow_rescore_done', reportPath, attempts: attempts.length, completeAttempts: attempts.filter(attempt => attempt.complete).length }));
    return;
  }

  const secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8')) as { databaseUrl: string };
  const databaseUrl = new URL(secrets.databaseUrl);
  databaseUrl.pathname = `/${DB_NAME}`;
  databaseUrl.searchParams.set('schema', 'public');
  const maxThb = process.env['MANGMEE_EVAL_MAX_THB'];
  assert.ok(maxThb, 'MANGMEE_EVAL_MAX_THB is required before the oracle reset');
  const apiRoot = resolve(REPO_ROOT, 'apps/api'), requireApi = createRequire(resolve(apiRoot, 'package.json'));
  const { Client } = requireApi('pg') as { Client: new (opts: { connectionString: string }) => import('./eval-spend').EvalPgClient & { connect(): Promise<void>; end(): Promise<void> } };
  const pg = new Client({ connectionString: databaseUrl.toString() });
  await pg.connect();
  try {
  await installEvalGuard(pg, databaseUrl.toString(), maxThb);
  const spendPath = evidencePath.replace(/\.evidence\.json$/, '.spend.jsonl');
  const attemptId = (saved.turnEvidence[0] as RuntimeTurnEvidence & { attemptId?: string }).attemptId ?? 'rescore';
  await captureSpend(pg, databaseUrl.toString(), spendPath, attemptId);

  const fullCorpus = rawCorpus as Corpus;
  validateCorpus(fullCorpus);
  const corpus = corpusForRescore(fullCorpus, evidencePath, saved.turnEvidence);
  const flat = flattenTurns(corpus);

  // The ORIGINAL run's clock, never today's — resolveGoldCallInput's `$period` resolution (e.g.
  // "this month") is only comparable to what the model actually saw if re-seeding reproduces the
  // SAME civil date, which is why this cannot simply be `new Date()`.
  const now = new Date(saved.startedAt);
  const companies: Record<EvalCompany, CompanySeed> = { A: buildCompanySeed('A', now), B: buildCompanySeed('B', now) };

  console.log(JSON.stringify({ event: 'rescore_start', evidencePath, conversations: corpus.conversations.length, turns: flat.length, now: now.toISOString() }));
  const goldPass = await collectGoldResults(REPO_ROOT, corpus, companies, databaseUrl.toString(), REDIS_URL, SECRETS_PATH, now,
    () => captureSpend(pg, databaseUrl.toString(), spendPath, attemptId).then(() => undefined));
  await captureSpend(pg, databaseUrl.toString(), spendPath, attemptId);
  const scores = scoreAllTurns(flat, saved.turnEvidence, goldPass, now);
  const summary = summarizeScores(scores);

  const reportPath = rescoreReportPath(evidencePath, new Date());
  writeFileSync(reportPath, renderReport({
    sourceCommit: gitHeadSha(REPO_ROOT), now, summary, scores, corpus, turnEvidence: saved.turnEvidence,
    rescoredFrom: { evidencePath, sourceCommit: saved.sourceCommit, startedAt: saved.startedAt },
  }));

  console.log(JSON.stringify({ event: 'rescore_done', reportPath, total: summary.total, passed: summary.passed, failed: summary.failed }));
  process.exitCode = summary.failed > 0 ? 1 : 0;
  } finally { await pg.end(); }
}

// Guarded so run-rescore.spec.ts can import this file's pure exports (scenarioIdsIn,
// rescoreReportPath) without also kicking off a real DB-touching main() run.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'rescore_failed', message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
