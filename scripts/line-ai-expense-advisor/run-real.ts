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
 * corpus's `expect` uses tool/tag gold for v1 and workflow gold for v2) and writes JSON evidence
 * plus a markdown report.
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
 * CLI: --classifier-labels=messages uses message-only W1, as does a v2 corpus's
 *      classifierLabels: 'messages'. The button baseline is recorded for every v2 run.
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
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLineReliabilityRuntime, validateRuntimeFixtureOperations, type ReliabilityRuntimeManifest, type RuntimeReplayFixture, type RuntimeSourceSnapshot, type RuntimeTurnEvidence } from '../line-ai-reliability-runtime';
import { reliabilityDigest, type ReliabilityFixture } from '../line-ai-reliability-fixtures';
import { validateCorpus, validateWorkflowCorpus, flattenTurns, selectConversations, parseFailedConversationIds, type Corpus, type EvalCompany, type WorkflowCorpus } from './types';
import { buildCompanySeed, buildWorkflowSeed, resolveWorkflowActor, type CompanySeed, type WorkflowSeed } from './seed';
import { scoreWorkflowCorpus, summarizeScores } from './scorer';
import { collectGoldResults, scoreAllTurns } from './gold-oracle-pass';
import { gitHeadSha } from './oracle';
import { ROLE_GRANTS } from '../../apps/api/src/modules/auth/permission-registry';
import { filterPermissionsByEntitlement } from '../../apps/api/src/modules/employee-access/domain/logic/feature-gate.logic';
import { TIER_FEATURE_PRESETS } from '../../packages/contracts/src/menu-entitlements';
import { renderUserText } from './template';
import { renderReport, renderWorkflowReport } from './report';
import { appendJsonLine, capRejectionCount, captureSpend, installEvalGuard, readJsonLines, type EvalPgClient } from './eval-spend';
import { validateWorkflowPreflight } from './run-preflight';
import { workflowAttemptsFromEvidence } from './run-rescore';

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

export type EvalProgress = { startedAt: string; completedConversationIds: string[]; completedAttempts: Record<string, string>; inFlightConversationId: string | null; inFlightAttemptId: string | null };
export function checkpointPaths(progressPath: string) {
  const base = progressPath.replace(/\.progress\.json$/, '');
  return { turnsPath: `${base}.turns.jsonl`, spendPath: `${base}.spend.jsonl`, evidencePath: `${base}.evidence.json`, reportPath: `${base}.report.md` };
}
function writeProgress(path: string, progress: EvalProgress): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(progress, null, 2));
  const fd = openSync(temporary, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
}
function defaultProgress(startedAt: Date): EvalProgress {
  return { startedAt: startedAt.toISOString(), completedConversationIds: [], completedAttempts: {}, inFlightConversationId: null, inFlightAttemptId: null };
}
function completeAttemptEvidence(rows: RuntimeTurnEvidence[], complete: Record<string, string>): RuntimeTurnEvidence[] {
  const latest = new Map<string, RuntimeTurnEvidence & { attemptId?: string }>();
  for (const row of rows as Array<RuntimeTurnEvidence & { attemptId?: string }>) latest.set(`${row.scenarioId}\u0000${row.attemptId}\u0000${row.turnIndex}`, row);
  return [...latest.values()].filter(row => {
    const attemptId = (row as RuntimeTurnEvidence & { attemptId?: string }).attemptId;
    return attemptId && complete[row.scenarioId] === attemptId;
  });
}

export type SubsetSelection = { onlyIds: string[]; description: string };

/** Task item "re-run a subset": MANGMEE_EVAL_ONLY is either a comma-separated list of conversation
 * ids, or — with MANGMEE_EVAL_ONLY_FAILED=1 — a path to a previous run's *.evidence.json, in which
 * case every conversation that had a failing turn in it is re-run. Always whole conversations
 * (selectConversations, types.ts): a follow-up turn needs its own history, never a single turn run
 * in isolation. `null` means no subset was requested — every conversation in the corpus runs. */
function resolveSubsetSelection(environment = process.env): SubsetSelection | null {
  const only = environment['MANGMEE_EVAL_ONLY'];
  if (!only) return null;
  if (environment['MANGMEE_EVAL_ONLY_FAILED'] === '1') {
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

export function buildWorkflowReplay(corpus: WorkflowCorpus, seed: WorkflowSeed, now: Date) {
  const snapshots: Record<string, RuntimeSourceSnapshot> = {};
  const fixtures = corpus.conversations.map((conversation): RuntimeReplayFixture => {
    const firstActor = conversation.actors.find(actor => actor.key === (conversation.turns[0]?.as?.key ?? conversation.actors[0]!.key))!;
    const first = resolveWorkflowActor(firstActor, seed);
    const company = first.kind === 'unlinked' ? seed.companies.B : Object.values(seed.companies).find(row => row.companyId === first.companyId)!;
    const enabledFeatures = seed.rows.filter(row => row.model === 'companyFeatureEntitlement' && row.data.companyId === company.companyId && row.data.enabled).map(row => String(row.data.featureKey));
    const roles = new Set(seed.rows.filter(row => row.model === 'membershipRole' && row.data.membershipId === first.membershipId).map(row => row.data.roleId));
    const grants = new Set(seed.rows.filter(row => row.model === 'rolePermission' && roles.has(row.data.roleId)).map(row => row.data.permissionId));
    const permissions = filterPermissionsByEntitlement(seed.rows.filter(row => row.model === 'permission' && grants.has(row.data.id)).map(row => String(row.data.key)), new Set(enabledFeatures)).sort();
    snapshots[conversation.id] = { rows: seed.rows, lineUserId: first.lineUserId, assets: {},
      actors: Object.fromEntries(conversation.actors.map(actor => [actor.key, resolveWorkflowActor(actor, seed)])) };
    return {
      id: conversation.id, familyId: conversation.id, split: 'development', language: 'th', paraphrase: false, fixedRegression: false,
      capabilities: ['C01'], provenance: { kind: 'synthetic', sourceId: conversation.id, consentRef: null, reviewedBy: null, reviewedAt: null },
      fixture: { clock: now.toISOString(), timezone: 'Asia/Bangkok', company: company.companyId,
        actor: first.userId ?? `unlinked-${firstActor.key}`, channelKind: 'USER', messagingChannelId: company.messagingChannelId,
        membership: first.membershipId ?? null, chat: first.lineUserId, permissions, branches: first.branchIds ?? [], enabledFeatures,
        sourceSnapshot: conversation.id, taskRevision: null, previewRevision: null }, assets: [],
      turns: conversation.turns.map((turn, index) => {
        validateRuntimeFixtureOperations(turn.fixture ?? []);
        if (turn.pressFrom?.actor) assert.equal(turn.pressFrom.actor.key, conversation.turns[turn.pressFrom.turn]!.as?.key ?? conversation.actors[0]!.key,
          `WORKFLOW_RUNTIME_PRESS_ACTOR_MISMATCH:${conversation.id}:${index}`);
        return { user: renderUserText(turn.user ?? turn.press!, now), attachmentIds: [],
          pressFrom: turn.as?.key ?? conversation.actors[0]!.key,
          ...(turn.pressFrom ? { pressOrigin: { turn: turn.pressFrom.turn, actor: turn.pressFrom.actor?.key } } : {}),
          ...(turn.fixture ? { fixture: turn.fixture } : {}),
          ...(turn.press ? { action: { type: 'postback' as const, label: turn.press } } : {}),
          expect: { outcomes: ['answered', 'partial', 'needs_input', 'access_denied', 'unsupported_action', 'feature_unavailable'],
            toolInputs: [], requiredFacts: [], requiredEffects: [], forbiddenEffects: [], requiredDelivery: 'ACCEPTED',
            maxModelCalls: turn.expect.maxModelCalls ?? 4, deadlineMs: 30_000 } };
      }),
    };
  });
  return { fixtures, snapshots, snapshotDigests: Object.fromEntries(Object.entries(snapshots).map(([key, snapshot]) => [key, reliabilityDigest(snapshot)])) };
}

export async function runReal(dependencies: {
  environment?: NodeJS.ProcessEnv;
  pg?: EvalPgClient & { connect(): Promise<void>; end(): Promise<void> };
  runtime?: typeof runLineReliabilityRuntime;
  oracle?: typeof collectGoldResults;
} = {}): Promise<void> {
  const environment = dependencies.environment ?? process.env;
  const secretsPath = environment['MANGMEE_EVAL_SECRETS_PATH'] ?? SECRETS_PATH;
  const corpusPath = environment['MANGMEE_EVAL_CORPUS'] ?? CORPUS_PATH;
  const redisUrl = environment['MANGMEE_EVAL_REDIS_URL'] ?? REDIS_URL;
  const outputDir = environment['MANGMEE_EVAL_OUTPUT_DIR'];
  const gatewayUrl = environment['MANGMEE_EVAL_GATEWAY_URL'];
  const resumePath = environment['MANGMEE_EVAL_RESUME'];
  assert.ok(outputDir || resumePath, 'MANGMEE_EVAL_OUTPUT_DIR or MANGMEE_EVAL_RESUME is required');
  assert.ok(gatewayUrl, 'MANGMEE_EVAL_GATEWAY_URL is required (start it with launch-gateway.mjs first)');
  const secrets = JSON.parse(readFileSync(secretsPath, 'utf8')) as { databaseUrl: string };
  const databaseUrl = new URL(secrets.databaseUrl);
  databaseUrl.pathname = `/${DB_NAME}`;
  databaseUrl.searchParams.set('schema', 'public');
  const apiRoot = resolve(REPO_ROOT, 'apps/api');
  const requireApi = createRequire(resolve(apiRoot, 'package.json'));
  const { Client } = requireApi('pg') as { Client: new (opts: { connectionString: string }) => import('./eval-spend').EvalPgClient & { connect(): Promise<void>; end(): Promise<void> } };
  const pg = dependencies.pg ?? new Client({ connectionString: databaseUrl.toString() });
  await pg.connect();
  try {
    const progress: EvalProgress = resumePath ? JSON.parse(readFileSync(resumePath, 'utf8')) as EvalProgress : defaultProgress(new Date());
    assert.ok(!Number.isNaN(Date.parse(progress.startedAt)) && Array.isArray(progress.completedConversationIds), 'EVAL_PROGRESS_INVALID');
    const progressPath = resumePath ?? resolve(outputDir!, `${new Date(progress.startedAt).toISOString().replace(/[:.]/g, '-')}.progress.json`);
    const paths = checkpointPaths(progressPath);
    mkdirSync(dirname(progressPath), { recursive: true });
    writeProgress(progressPath, progress);
    const maxThb = environment['MANGMEE_EVAL_MAX_THB'];
    assert.ok(maxThb, 'MANGMEE_EVAL_MAX_THB is required');
    await installEvalGuard(pg, databaseUrl.toString(), maxThb);
    await captureSpend(pg, databaseUrl.toString(), paths.spendPath, progress.inFlightAttemptId ?? 'startup');

    const fullCorpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as Corpus | WorkflowCorpus;
    if (fullCorpus.version === 2) validateWorkflowCorpus(fullCorpus);
    else validateCorpus(fullCorpus);
    if (fullCorpus.version === 2) writeFileSync(paths.spendPath, '', { flag: 'a' });
    const subset = resolveSubsetSelection(environment);
    const requested = fullCorpus.version === 2
      ? { ...fullCorpus, conversations: selectConversations(fullCorpus, subset?.onlyIds ?? null) }
      : { ...fullCorpus, conversations: selectConversations(fullCorpus, subset?.onlyIds ?? null) };
    const corpus = { ...requested, conversations: requested.conversations.filter(row => !progress.completedConversationIds.includes(row.id)) } as Corpus | WorkflowCorpus;
    const now = new Date(progress.startedAt);
    const companies: Record<EvalCompany, CompanySeed> = { A: buildCompanySeed('A', now), B: buildCompanySeed('B', now), C: buildCompanySeed('C', now) };
    const workflowSeed = fullCorpus.version === 2 ? buildWorkflowSeed(now, fullCorpus.conversations.flatMap(row => row.actors)) : undefined;
    if (fullCorpus.version === 2) validateWorkflowPreflight(fullCorpus, workflowSeed!, now);
    const replay = corpus.version === 2 ? buildWorkflowReplay(corpus, workflowSeed!, now)
      : { ...buildSnapshots(corpus, companies), fixtures: buildFixtures(corpus, companies, now) };
    const { snapshots, snapshotDigests, fixtures } = replay;
    const gatewayManifestPath = resolve(dirname(progressPath), 'gateway.manifest.json');
    const gatewayManifest = JSON.parse(readFileSync(gatewayManifestPath, 'utf8')) as { transport: 'bedrock' | 'anthropic-api'; modelId?: string };
    assert.ok(['bedrock', 'anthropic-api'].includes(gatewayManifest.transport), 'EVAL_GATEWAY_TRANSPORT_MISSING');
    if (gatewayManifest.modelId?.toLowerCase().includes('haiku-5-5')) assert.equal(gatewayManifest.transport, 'bedrock', 'EVAL_PHASE_C_BEDROCK_REQUIRED');
    const model = { provider: gatewayManifest.transport === 'bedrock' ? 'bedrock' : 'anthropic-api', modelIds: [], transport: gatewayManifest.transport, runtime: 'strands-local' };
    const sourceCommit = gitHeadSha(REPO_ROOT);
    const manifest: ReliabilityRuntimeManifest = {
      version: 2, corpus: { version: 2, seed: corpus.version === 2 ? corpus.seed : 'mangmee-ai-expense-advisor-sample-v1', status: corpus.version === 2 ? corpus.status : 'draft', fixtures }, snapshots, snapshotDigests,
      versions: { sourceCommit, schema: sha256File('apps/api/prisma/schema.prisma'), prompt: reliabilityDigest([
        'apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts', 'apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts',
      ].map(sha256File)), registry: sha256File('packages/contracts/src/ai-tools.ts'), model: reliabilityDigest(model), price: sha256File('apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts') },
      apiPort: API_PORT, gatewayUrl, databaseUrl: databaseUrl.toString(), redisUrl,
      environment: { ...PRODUCTION_AI_ENV.api, LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES: DETERMINISTIC_FAMILIES }, repeats: 1, cohort: '1000', bootstrapLaunchGates: true,
    };
    const goldPass = await (dependencies.oracle ?? collectGoldResults)(REPO_ROOT, fullCorpus.version === 2 ? fullCorpus : requested, workflowSeed?.companies ?? companies, databaseUrl.toString(), redisUrl, secretsPath, now,
      () => captureSpend(pg, databaseUrl.toString(), paths.spendPath, progress.inFlightAttemptId ?? 'oracle').then(() => undefined));
    const turnCounts = new Map<string, number>(), attemptByConversation = new Map<string, string>();
    let capReached = false;
    let capCount = await capRejectionCount(pg);
    const result = corpus.conversations.length ? await (dependencies.runtime ?? runLineReliabilityRuntime)(manifest, REPO_ROOT, {
      onBeforeReset: async (conversation, attemptId) => {
        await captureSpend(pg, databaseUrl.toString(), paths.spendPath, attemptId);
        if (capReached) throw new Error('EVAL_CAP_REACHED');
        attemptByConversation.set(conversation.id, attemptId);
        progress.inFlightConversationId = conversation.id; progress.inFlightAttemptId = attemptId;
        writeProgress(progressPath, progress);
      },
      onBeforeTurn: async () => {
        const current = await capRejectionCount(pg);
        if (current !== capCount) { capReached = true; capCount = current; throw new Error('EVAL_CAP_REACHED'); }
      },
      onTurn: async evidence => {
        const attemptId = attemptByConversation.get(evidence.scenarioId);
        assert.ok(attemptId, 'EVAL_ATTEMPT_MISSING');
        appendJsonLine(paths.turnsPath, { ...evidence, attemptId });
        turnCounts.set(evidence.scenarioId, (turnCounts.get(evidence.scenarioId) ?? 0) + 1);
        const next = await capRejectionCount(pg);
        if (next !== capCount) { capReached = true; capCount = next; throw new Error('EVAL_CAP_REACHED'); }
      },
      onConversationComplete: async (conversation, attemptId) => {
        if (capReached || turnCounts.get(conversation.id) !== requested.conversations.find(row => row.id === conversation.id)?.turns.length) return;
        progress.completedConversationIds = [...new Set([...progress.completedConversationIds, conversation.id])];
        progress.completedAttempts[conversation.id] = attemptId;
        progress.inFlightConversationId = null; progress.inFlightAttemptId = null;
        writeProgress(progressPath, progress);
      },
    }) : { records: [], turnEvidence: [], runtimeDiagnostics: [] };
    for (const evidence of result.turnEvidence) {
      const attemptId = attemptByConversation.get(evidence.scenarioId);
      if (attemptId) appendJsonLine(paths.turnsPath, { ...evidence, attemptId });
    }
    for (const row of result.records) if (!row.error && row.traces.length === requested.conversations.find(item => item.id === row.scenarioId)?.turns.length) {
      progress.completedConversationIds = [...new Set([...progress.completedConversationIds, row.scenarioId])];
      const attemptId = attemptByConversation.get(row.scenarioId);
      if (attemptId) progress.completedAttempts[row.scenarioId] = attemptId;
      if (progress.inFlightConversationId === row.scenarioId) { progress.inFlightConversationId = null; progress.inFlightAttemptId = null; }
    }
    await captureSpend(pg, databaseUrl.toString(), paths.spendPath, progress.inFlightAttemptId ?? 'final');
    writeProgress(progressPath, progress);
    const allEvidence = readJsonLines<RuntimeTurnEvidence & { attemptId?: string }>(paths.turnsPath);
    const completedEvidence = completeAttemptEvidence(allEvidence, progress.completedAttempts);
    const completedCorpus = { ...requested, conversations: requested.conversations.filter(row => progress.completedConversationIds.includes(row.id)) } as Corpus | WorkflowCorpus;
    const completedPositions = completedCorpus.conversations.flatMap(conversation => conversation.turns.map((_, turnIndex) => ({ conversation, turnIndex })));
    const actualModel = { ...model, modelIds: [...new Set(allEvidence.flatMap(row => (row.providerUsage as Array<{ modelId?: string }>).map(call => call.modelId).filter((id): id is string => !!id)))] };
    const safeManifest = { ...manifest, databaseUrl: '[redacted]', gatewayUrl: '[redacted-local]' };
    if (capReached) {
      writeFileSync(paths.evidencePath, JSON.stringify({ startedAt: progress.startedAt, sourceCommit, model: actualModel, manifest: safeManifest, status: 'CAP_REACHED', progress, turnEvidence: allEvidence, spend: readJsonLines(paths.spendPath), runtimeDiagnostics: result.runtimeDiagnostics }, null, 2));
      console.log(JSON.stringify({ event: 'CAP_REACHED', evidencePath: paths.evidencePath, progressPath })); process.exitCode = 2; return;
    }
    const incomplete = requested.version === 2 ? requested.conversations.some(row => !progress.completedConversationIds.includes(row.id))
      : progress.completedConversationIds.length < requested.conversations.length;
    if (incomplete || completedPositions.some(({ conversation, turnIndex }) => !completedEvidence.some(row => row.scenarioId === conversation.id && row.turnIndex === turnIndex))) {
      writeFileSync(paths.evidencePath, JSON.stringify({ startedAt: progress.startedAt, sourceCommit, model: actualModel, manifest: safeManifest, status: 'FAILED_RESUMABLE', progress, turnEvidence: allEvidence, runtimeDiagnostics: result.runtimeDiagnostics }, null, 2));
      throw new Error(`EVAL_FAILED_RESUMABLE:${progress.inFlightConversationId ?? 'unknown'}`);
    }
    if (completedCorpus.version === 2) {
      const classifierLabels = process.argv.includes('--classifier-labels=messages') ? 'messages' : completedCorpus.classifierLabels;
      const ids = new Set(completedCorpus.conversations.map(row => row.id));
      const attempts = workflowAttemptsFromEvidence(completedCorpus, allEvidence.filter(row => ids.has(row.scenarioId)), progress.completedAttempts);
      const workflowMetrics = scoreWorkflowCorpus({ corpus: completedCorpus, attempts, now, classifierLabels, includeButtonBaseline: true });
      const failures = completedCorpus.conversations.filter(conversation => {
        const metrics = scoreWorkflowCorpus({ corpus: { ...completedCorpus, conversations: [conversation] },
          attempts: attempts.filter(attempt => attempt.conversationId === conversation.id), now, classifierLabels, includeButtonBaseline: true });
        return metrics.W1.passed < metrics.W1.total || metrics.W2.passed < metrics.W2.total || metrics.W3.passed < metrics.W3.total
          || metrics.W6.wrongApplied > 0 || metrics.W6.wrongPreview > 0 || metrics.W9.invalidCalls > 0 || metrics.W12.machineTokenTurns > 0
          || metrics.W14.timeouts > 0 || metrics.W15.rejectedAndCharged > 0 || metrics.answerChecks?.some(check => !check.ok)
          || metrics.buttonBaseline && metrics.buttonBaseline.passed < metrics.buttonBaseline.total;
      }).map(conversation => ({ conversationId: conversation.id }));
      const summary = { unit: 'conversation', total: completedCorpus.conversations.length,
        passed: completedCorpus.conversations.length - failures.length, failed: failures.length, failures };
      writeFileSync(paths.evidencePath, JSON.stringify({ startedAt: progress.startedAt, sourceCommit, model: actualModel, manifest: safeManifest,
        corpusVersion: 2, classifierLabels, includeButtonBaseline: true, subset: subset ?? undefined, progress, workflowMetrics, summary,
        turnEvidence: allEvidence, spend: readJsonLines(paths.spendPath), runtimeDiagnostics: result.runtimeDiagnostics }, null, 2));
      writeFileSync(paths.reportPath, renderWorkflowReport({ sourceCommit, now, corpus: completedCorpus, metrics: workflowMetrics, subset: subset ?? undefined }));
      console.log(JSON.stringify({ event: 'real_run_done', evidencePath: paths.evidencePath, reportPath: paths.reportPath, ...summary }));
      process.exitCode = summary.failed > 0 ? 1 : 0;
      return;
    }
    const completedFlat = flattenTurns(completedCorpus);
    const scores = scoreAllTurns(completedFlat, completedEvidence, goldPass, now), summary = summarizeScores(scores);
    writeFileSync(paths.evidencePath, JSON.stringify({ startedAt: progress.startedAt, sourceCommit, model: actualModel, manifest: safeManifest, subset: subset ?? undefined,
      progress, scores, summary, turnEvidence: allEvidence, spend: readJsonLines(paths.spendPath), runtimeDiagnostics: result.runtimeDiagnostics }, null, 2));
    writeFileSync(paths.reportPath, renderReport({ sourceCommit, now, summary, scores, corpus: completedCorpus, turnEvidence: completedEvidence, subset: subset ?? undefined }));
    console.log(JSON.stringify({ event: 'real_run_done', evidencePath: paths.evidencePath, reportPath: paths.reportPath, total: summary.total, passed: summary.passed, failed: summary.failed }));
    process.exitCode = summary.failed > 0 ? 1 : 0;
  } finally { await pg.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runReal().catch((error) => {
    console.error(JSON.stringify({ event: 'real_run_failed', message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
