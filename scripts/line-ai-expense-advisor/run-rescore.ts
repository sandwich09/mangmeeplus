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
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCorpus, flattenTurns, selectConversations, type Corpus, type EvalCompany } from './types';
import { buildCompanySeed, type CompanySeed } from './seed';
import { summarizeScores } from './scorer';
import { collectGoldResults, scoreAllTurns } from './gold-oracle-pass';
import { gitHeadSha } from './oracle';
import { renderReport } from './report';
import type { RuntimeTurnEvidence } from '../line-ai-reliability-runtime';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SECRETS_PATH = process.env['MANGMEE_EVAL_SECRETS_PATH'] ?? '/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json';
const DB_NAME = 'watchdog_ai_reliability_replay_expense_advisor';
const CORPUS_PATH = process.env['MANGMEE_EVAL_CORPUS'] ?? resolve(REPO_ROOT, 'scripts/line-ai-expense-advisor/corpus.sample.json');
const REDIS_URL = process.env['MANGMEE_EVAL_REDIS_URL'] ?? 'redis://127.0.0.1:16389/13';

/** The minimal shape of a run-real.ts `*.evidence.json` this script actually reads. */
export type SavedEvidenceFile = {
  startedAt: string;
  sourceCommit: string;
  turnEvidence: RuntimeTurnEvidence[];
};

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

  const saved = JSON.parse(readFileSync(evidencePath, 'utf8')) as SavedEvidenceFile;
  assert.ok(Array.isArray(saved.turnEvidence) && saved.turnEvidence.length > 0, `${evidencePath}: no turnEvidence to rescore`);
  assert.ok(typeof saved.startedAt === 'string' && !Number.isNaN(Date.parse(saved.startedAt)), `${evidencePath}: missing/invalid startedAt`);

  const secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8')) as { databaseUrl: string };
  const databaseUrl = new URL(secrets.databaseUrl);
  databaseUrl.pathname = `/${DB_NAME}`;
  databaseUrl.searchParams.set('schema', 'public');

  const fullCorpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
  validateCorpus(fullCorpus);
  const corpus = corpusForRescore(fullCorpus, evidencePath, saved.turnEvidence);
  const flat = flattenTurns(corpus);

  // The ORIGINAL run's clock, never today's — resolveGoldCallInput's `$period` resolution (e.g.
  // "this month") is only comparable to what the model actually saw if re-seeding reproduces the
  // SAME civil date, which is why this cannot simply be `new Date()`.
  const now = new Date(saved.startedAt);
  const companies: Record<EvalCompany, CompanySeed> = { A: buildCompanySeed('A', now), B: buildCompanySeed('B', now) };

  console.log(JSON.stringify({ event: 'rescore_start', evidencePath, conversations: corpus.conversations.length, turns: flat.length, now: now.toISOString() }));
  const goldPass = await collectGoldResults(REPO_ROOT, corpus, companies, databaseUrl.toString(), REDIS_URL, SECRETS_PATH, now);
  const scores = scoreAllTurns(flat, saved.turnEvidence, goldPass, now);
  const summary = summarizeScores(scores);

  const reportPath = rescoreReportPath(evidencePath, new Date());
  writeFileSync(reportPath, renderReport({
    sourceCommit: gitHeadSha(REPO_ROOT), now, summary, scores, corpus, turnEvidence: saved.turnEvidence,
    rescoredFrom: { evidencePath, sourceCommit: saved.sourceCommit, startedAt: saved.startedAt },
  }));

  console.log(JSON.stringify({ event: 'rescore_done', reportPath, total: summary.total, passed: summary.passed, failed: summary.failed }));
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

// Guarded so run-rescore.spec.ts can import this file's pure exports (scenarioIdsIn,
// rescoreReportPath) without also kicking off a real DB-touching main() run.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'rescore_failed', message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
