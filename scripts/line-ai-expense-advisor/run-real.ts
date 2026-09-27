#!/usr/bin/env -S node --import tsx
/**
 * Real mode (task step 5): NOT executed by this harness build — implemented for the controller to
 * run once a compiled gateway is already listening (see launch-gateway.mjs). Do NOT run this
 * script without a real, already-running AI Gateway process: it drives the SAME
 * `runLineReliabilityRuntime` a real model turn goes through, which means real Bedrock calls and
 * real satang cost.
 *
 * Sequentially replays every conversation in the corpus through the existing
 * scripts/line-ai-reliability-runtime.ts machinery — the compiled API in-process, signed LINE
 * webhooks, delivery capture via a fetch patch — then scores each turn with scorer.ts (never the
 * legacy financial-fact-oracle scorer that runtime.ts's own ReliabilityFixture shape implies; this
 * corpus's `expect` is the tool/tag format in types.ts) and writes JSON evidence plus a markdown
 * report.
 *
 * Usage: node_modules/.bin/tsx scripts/line-ai-expense-advisor/run-real.ts
 * Required env:
 *   MANGMEE_EVAL_OUTPUT_DIR       directory for <timestamp>.evidence.json and .report.md
 *   MANGMEE_EVAL_GATEWAY_URL      e.g. http://127.0.0.1:19205/v1 (launch-gateway.mjs prints this)
 * Optional env:
 *   MANGMEE_EVAL_SECRETS_PATH     default /tmp/mangmee-latency-pilot-20260927/runtime-secrets.json
 *   MANGMEE_EVAL_REDIS_URL        default redis://127.0.0.1:16389/13
 *   MANGMEE_EVAL_CORPUS           default scripts/line-ai-expense-advisor/corpus.sample.json
 *   MANGMEE_EVAL_API_PORT         default 19291
 *   MANGMEE_EVAL_DETERMINISTIC_RESPONSE_FAMILIES  default matches spec §5 R-L4's family list
 *   AI_GLOBAL_INFERENCE_PROFILE_APPROVED      default true (see note below)
 *   AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF  default 'mangmee-expense-advisor-eval-synthetic-only'
 *   APPROVED_AI_MODEL_IDS                     default adds 'global.anthropic.claude-sonnet-4-6'
 *   MANGMEE_EVAL_TURN_PAUSE_MS          default 1500 — sleep between turns of the same conversation
 *   MANGMEE_EVAL_CONVERSATION_PAUSE_MS  default 2000 — sleep between conversations
 *   MANGMEE_EVAL_ONLY         comma-separated conversation ids, OR (with ONLY_FAILED=1) a path to a
 *                             previous *.evidence.json — re-runs only those whole conversations
 *                             (never a single turn: a follow-up turn needs its own history)
 *   MANGMEE_EVAL_ONLY_FAILED  '1' to read MANGMEE_EVAL_ONLY as an evidence.json path and select
 *                             every conversation that had a failing turn in it
 *
 * MANGMEE_EVAL_TURN_PAUSE_MS/MANGMEE_EVAL_CONVERSATION_PAUSE_MS: `replayReliabilityCorpus` (shared
 * by every reliability replay, not just this eval) has no hook between its turn/fixture loop
 * iterations for a caller to pause in — the pause is therefore implemented one level down, inside
 * scripts/line-ai-reliability-runtime.ts's own `reset`/`turn` adapter methods (reset = between
 * conversations, turn = between turns), reading these same two env vars but defaulting to 0/off so
 * every OTHER caller of that shared runtime is unaffected unless it sets them itself.
 *
 * The three vars above exist to satisfy AiGatewayClient.issueLineReliabilityGrant(), which refuses
 * every turn with AI_BUDGET_UNAVAILABLE — before ever calling the Gateway — unless BOTH (a) the
 * resolved model id is in `this.config.approvedAiModelIds` (packages/config's schema default is
 * two `apac.*` models only) and (b), when that id starts with `global.`, the API's own config also
 * records the data-protection approval for that cross-border profile (schema default: not
 * approved). Probing the already-running eval Gateway's own
 * /internal/ai/line-reliability-capabilities showed it reports model
 * `global.anthropic.claude-sonnet-4-6` — outside the default approved list AND needing (b) — so
 * without all three vars every turn fell back to the "system is slow" LINE reply with zero Gateway
 * requests, never reaching the model. This corpus is synthetic-only (REPLAY_SYNTHETIC_ONLY), so the
 * approval is the eval's own, not a claim about production traffic. Override to match whatever a
 * future Gateway build actually reports.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLineReliabilityRuntime, type ReliabilityRuntimeManifest, type RuntimeSourceSnapshot, type RuntimeTurnEvidence } from '../line-ai-reliability-runtime';
import { reliabilityDigest, type ReliabilityFixture } from '../line-ai-reliability-fixtures';
import { validateCorpus, flattenTurns, selectConversations, parseFailedConversationIds, type Corpus, type EvalCompany } from './types';
import { buildCompanySeed, type CompanySeed } from './seed';
import { summarizeScores, type TurnScore } from './scorer';
import { collectGoldResults, scoreAllTurns } from './gold-oracle-pass';
import { gitHeadSha } from './oracle';
import { ROLE_GRANTS } from '../../apps/api/src/modules/auth/permission-registry';
import { filterPermissionsByEntitlement } from '../../apps/api/src/modules/employee-access/domain/logic/feature-gate.logic';
import { TIER_FEATURE_PRESETS } from '../../packages/contracts/src/menu-entitlements';
import { renderUserText } from './template';
import { renderReport } from './report';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SECRETS_PATH = process.env['MANGMEE_EVAL_SECRETS_PATH'] ?? '/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json';
const DB_NAME = 'watchdog_ai_reliability_replay_expense_advisor';
const CORPUS_PATH = process.env['MANGMEE_EVAL_CORPUS'] ?? resolve(REPO_ROOT, 'scripts/line-ai-expense-advisor/corpus.sample.json');
const REDIS_URL = process.env['MANGMEE_EVAL_REDIS_URL'] ?? 'redis://127.0.0.1:16389/13';
const API_PORT = Number(process.env['MANGMEE_EVAL_API_PORT'] ?? '19291');
// Production's non-secret AI settings, so a run measures what customers get (shared with launch-gateway.mjs).
const PRODUCTION_AI_ENV = JSON.parse(readFileSync(resolve(REPO_ROOT, 'scripts/line-ai-expense-advisor/production-ai-env.json'), 'utf8')) as { api: Record<string, string>; gateway: Record<string, string> };
const DETERMINISTIC_FAMILIES = process.env['MANGMEE_EVAL_DETERMINISTIC_RESPONSE_FAMILIES']
  ?? 'expense.list_recent::single_metric,expense.list_recent::list,expense.get_breakdown::list,expense.get_daily_closing::single_metric,reimbursement.list_pending_approvals::list,reimbursement.get_summary::single_metric';
// See the file header note: the in-process API this script boots needs its own record of the
// same global-inference-profile approval the already-running eval Gateway's model implies.
// `runLineReliabilityRuntime` only assigns ITS OWN hardcoded env keys onto process.env (never
// clears the rest), so setting these here, before it runs, is enough for the app it boots to see them.
process.env['AI_GLOBAL_INFERENCE_PROFILE_APPROVED'] ??= 'true';
process.env['AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF'] ??= 'mangmee-expense-advisor-eval-synthetic-only';
// packages/config's schema default (two `apac.*` models) does not include the model the
// already-running eval Gateway actually reports. Keep the default models AND add it, so a
// Gateway still pinned to an `apac.*` model keeps working too; only applies when nothing already
// overrode APPROVED_AI_MODEL_IDS (??= never evaluates this when it's already set).
process.env['APPROVED_AI_MODEL_IDS'] ??=
  'apac.anthropic.claude-3-5-sonnet-20241022-v2:0,apac.anthropic.claude-3-haiku-20240307-v1:0,global.anthropic.claude-sonnet-4-6';
// line-ai-reliability-runtime.ts reads these same two names (default 0/off there); this is the
// one real-mode caller that wants them on by default, to stay under the Bedrock account's
// throttling — see the file header note.
process.env['MANGMEE_EVAL_TURN_PAUSE_MS'] ??= '1500';
process.env['MANGMEE_EVAL_CONVERSATION_PAUSE_MS'] ??= '2000';

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(resolve(REPO_ROOT, path))).digest('hex');
}

export type SubsetSelection = { onlyIds: string[]; description: string };

/** Task item "re-run a subset": MANGMEE_EVAL_ONLY is either a comma-separated list of conversation
 * ids, or — with MANGMEE_EVAL_ONLY_FAILED=1 — a path to a previous run's *.evidence.json, in which
 * case every conversation that had a failing turn in it is re-run. Always whole conversations
 * (selectConversations, types.ts): a follow-up turn needs its own history, never a single turn run
 * in isolation. `null` means no subset was requested — every conversation in the corpus runs. */
function resolveSubsetSelection(): SubsetSelection | null {
  const only = process.env['MANGMEE_EVAL_ONLY'];
  if (!only) return null;
  if (process.env['MANGMEE_EVAL_ONLY_FAILED'] === '1') {
    const evidence = JSON.parse(readFileSync(resolve(REPO_ROOT, only), 'utf8'));
    return { onlyIds: parseFailedConversationIds(evidence), description: `conversations with a failing turn in ${only}` };
  }
  return { onlyIds: only.split(',').map((id) => id.trim()).filter(Boolean), description: 'an explicit MANGMEE_EVAL_ONLY list' };
}

// toCapturedEvidence/extractDeliveredText moved to gold-oracle-pass.ts, alongside scoreAllTurns
// (shared with run-rescore.ts — the same evidence shape, the same scoring loop, T-068's fix once).

/** One RuntimeSourceSnapshot per (company, role) actually used by the corpus: real-mode resets and
 * reseeds the WHOLE database between every fixture, so each conversation's actor needs a snapshot
 * whose `lineUserId` (see fetch-patch recipient check in runtime.ts) is THEIR OWN LINE id, even
 * though every snapshot for one company carries the identical `rows` (all 5 role users seeded
 * together, exactly like preflight — only the addressed recipient differs). */
function buildSnapshots(corpus: Corpus, companies: Record<EvalCompany, CompanySeed>): { snapshots: Record<string, RuntimeSourceSnapshot>; snapshotDigests: Record<string, string> } {
  const snapshots: Record<string, RuntimeSourceSnapshot> = {};
  for (const conversation of corpus.conversations) {
    const key = `${conversation.company}-${conversation.role}`;
    if (snapshots[key]) continue;
    const company = companies[conversation.company];
    snapshots[key] = { rows: company.rows, lineUserId: company.users[conversation.role].lineUserId, assets: {} };
  }
  const snapshotDigests = Object.fromEntries(Object.entries(snapshots).map(([key, snapshot]) => [key, reliabilityDigest(snapshot)]));
  return { snapshots, snapshotDigests };
}

function buildFixtures(corpus: Corpus, companies: Record<EvalCompany, CompanySeed>, now: Date): ReliabilityFixture[] {
  return corpus.conversations.map((conversation): ReliabilityFixture => {
    const company = companies[conversation.company];
    const actor = company.users[conversation.role];
    const tierFeatures = new Set(TIER_FEATURE_PRESETS[company.tierKey]);
    // Production permission resolution, not a hand-written union (spec §10) — the same helper the
    // real PrismaPermissionResolverRepository applies after loading a role's grant.
    const permissions = filterPermissionsByEntitlement([...(ROLE_GRANTS[conversation.role] ?? [])], tierFeatures).sort();
    return {
      id: conversation.id,
      familyId: conversation.id,
      split: 'development',
      language: 'th',
      paraphrase: false,
      fixedRegression: false,
      // No capability taxonomy maps spec §3's row numbers onto the v2.4 corpus's C01-C18 scheme;
      // this is a structural placeholder ONLY (validateReliabilityCorpus requires a nonempty,
      // matching-shape list) — see docs/qa/line-ai-expense-advisor-eval.md "known limitations".
      capabilities: ['C01'],
      provenance: { kind: 'synthetic', sourceId: conversation.id, consentRef: null, reviewedBy: null, reviewedAt: null },
      fixture: {
        clock: now.toISOString(), timezone: 'Asia/Bangkok', company: company.companyId, actor: actor.userId,
        channelKind: 'USER', messagingChannelId: company.messagingChannelId, membership: actor.membershipId,
        chat: actor.lineUserId, permissions, branches: [...company.branchIds], enabledFeatures: [...tierFeatures],
        sourceSnapshot: `${conversation.company}-${conversation.role}`, taskRevision: null, previewRevision: null,
      },
      assets: [],
      turns: conversation.turns.map((turn) => ({
        // Same renderer, same Bangkok "today" as preflight (template.ts) — a real customer types
        // month names and Buddhist years, so the model must see the same text preflight validated.
        user: renderUserText(turn.user, now),
        attachmentIds: [],
        expect: {
          // Permissive on purpose: this corpus's own scorer.ts (not the legacy financial-fact
          // scoreReliabilityTrace this shape was designed for) decides pass/fail from
          // `turnEvidence` below, using the turn's OWN `expect.calls`/`expect.tags`.
          outcomes: ['answered', 'partial', 'needs_input', 'access_denied', 'unsupported_action', 'feature_unavailable'],
          toolInputs: [], requiredFacts: [], requiredEffects: [], forbiddenEffects: [],
          requiredDelivery: 'ACCEPTED', maxModelCalls: 4, deadlineMs: 30_000,
        },
      })),
    };
  });
}

// collectGoldResults/turnKey moved to gold-oracle-pass.ts (shared with run-rescore.ts, which
// re-scores saved evidence against the SAME oracle pass with no gateway/model involved).

async function main(): Promise<void> {
  const outputDir = process.env['MANGMEE_EVAL_OUTPUT_DIR'];
  const gatewayUrl = process.env['MANGMEE_EVAL_GATEWAY_URL'];
  assert.ok(outputDir, 'MANGMEE_EVAL_OUTPUT_DIR is required');
  assert.ok(gatewayUrl, 'MANGMEE_EVAL_GATEWAY_URL is required (start it with launch-gateway.mjs first)');
  mkdirSync(outputDir, { recursive: true });

  const secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8')) as { databaseUrl: string };
  const databaseUrl = new URL(secrets.databaseUrl);
  databaseUrl.pathname = `/${DB_NAME}`;
  databaseUrl.searchParams.set('schema', 'public');

  const fullCorpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
  validateCorpus(fullCorpus);
  const subset = resolveSubsetSelection();
  const corpus: Corpus = subset ? { ...fullCorpus, conversations: selectConversations(fullCorpus, subset.onlyIds) } : fullCorpus;
  const flat = flattenTurns(corpus);

  const now = new Date();
  const companies: Record<EvalCompany, CompanySeed> = { A: buildCompanySeed('A', now), B: buildCompanySeed('B', now) };
  const { snapshots, snapshotDigests } = buildSnapshots(corpus, companies);
  const fixtures = buildFixtures(corpus, companies, now);

  console.log(JSON.stringify({ event: 'gold_oracle_pass_start' }));
  const goldPass = await collectGoldResults(REPO_ROOT, corpus, companies, databaseUrl.toString(), REDIS_URL, SECRETS_PATH, now);
  console.log(JSON.stringify({ event: 'gold_oracle_pass_done', turnsResolved: goldPass.resultsByTurn.size }));

  const sourceCommit = gitHeadSha(REPO_ROOT);
  const model = { provider: 'bedrock', modelId: 'global.anthropic.claude-sonnet-4-6', region: 'ap-southeast-1', transport: 'local-http', runtime: 'strands-local' };

  const manifest: ReliabilityRuntimeManifest = {
    version: 2,
    corpus: { version: 2, seed: 'mangmee-ai-expense-advisor-sample-v1', status: 'draft', fixtures },
    snapshots, snapshotDigests,
    versions: {
      sourceCommit,
      schema: sha256File('apps/api/prisma/schema.prisma'),
      prompt: reliabilityDigest([
        'apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts',
        'apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts',
      ].map(sha256File)),
      registry: sha256File('packages/contracts/src/ai-tools.ts'),
      model: reliabilityDigest(model),
      price: sha256File('apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts'),
    },
    apiPort: API_PORT, gatewayUrl, databaseUrl: databaseUrl.toString(), redisUrl: REDIS_URL,
    environment: { ...PRODUCTION_AI_ENV.api, LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES: DETERMINISTIC_FAMILIES },
    repeats: 1, cohort: '1000', bootstrapLaunchGates: true,
  };

  console.log(JSON.stringify({ event: 'real_run_start', conversations: fixtures.length, turns: flat.length, sourceCommit, subset: subset ?? undefined }));
  const result = await runLineReliabilityRuntime(manifest, REPO_ROOT);

  if (result.records.some((record: { error: string | null }) => record.error) || result.runtimeDiagnostics.length) {
    // The runtime keeps going per-fixture even after a failure (so one bad conversation does not
    // hide the rest), but that also means the FIRST sign of trouble is buried in these two arrays
    // rather than thrown — surface them before anything asserts on missing evidence, or the real
    // cause (e.g. a seed/fixture mismatch a replica reset caught) is lost behind a generic assert.
    console.error(JSON.stringify({
      event: 'real_run_diagnostics',
      recordErrors: result.records.filter((record: { error: string | null }) => record.error)
        .map((record: { scenarioId: string; repeat: number; error: string | null }) => ({ scenarioId: record.scenarioId, repeat: record.repeat, error: record.error })),
      runtimeDiagnostics: result.runtimeDiagnostics,
    }, null, 2));
  }

  // Checked up front, with the richer (live-replay-only) diagnostic pointer: scoreAllTurns itself
  // throws a plainer "no captured evidence" error, since run-rescore.ts's offline pass has no
  // `result.records`/`runtimeDiagnostics` to point at.
  for (const { conversation, turnIndex } of flat) {
    if (result.turnEvidence.some((row: RuntimeTurnEvidence) => row.scenarioId === conversation.id && row.turnIndex === turnIndex)) continue;
    const record = result.records.find((row: { scenarioId: string }) => row.scenarioId === conversation.id);
    throw new Error(`no captured evidence for ${conversation.id}#${turnIndex} — record error: ${record?.error ?? 'none'}; see the real_run_diagnostics line above for runtimeDiagnostics`);
  }
  const scores: TurnScore[] = scoreAllTurns(flat, result.turnEvidence, goldPass, now);
  const summary = summarizeScores(scores);

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const evidencePath = resolve(outputDir, `${stamp}.evidence.json`);
  const reportPath = resolve(outputDir, `${stamp}.report.md`);
  const safeManifest = { ...manifest, databaseUrl: '[redacted]', gatewayUrl: '[redacted-local]' };
  writeFileSync(evidencePath, JSON.stringify({ startedAt: now.toISOString(), sourceCommit, model, manifest: safeManifest, subset: subset ?? undefined, scores, summary, turnEvidence: result.turnEvidence, runtimeDiagnostics: result.runtimeDiagnostics }, null, 2));
  writeFileSync(reportPath, renderReport({ sourceCommit, now, summary, scores, corpus, turnEvidence: result.turnEvidence, subset: subset ?? undefined }));

  console.log(JSON.stringify({ event: 'real_run_done', evidencePath, reportPath, total: summary.total, passed: summary.passed, failed: summary.failed }));
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'real_run_failed', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
