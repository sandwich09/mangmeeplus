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
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLineReliabilityRuntime, type ReliabilityRuntimeManifest, type RuntimeSourceSnapshot, type RuntimeTurnEvidence } from '../line-ai-reliability-runtime';
import { reliabilityDigest, type ReliabilityFixture } from '../line-ai-reliability-fixtures';
import { validateCorpus, flattenTurns, type Corpus, type EvalCompany } from './types';
import { buildCompanySeed, applySeedRows, truncateAllTables, SHARED_ACCESS_ROWS, type CompanySeed, type PgClientLike } from './seed';
import { scoreTurn, summarizeScores, type CapturedEvidence, type ExpectedFact, type ToolResultLike, type TurnScore } from './scorer';
import { bootOracle, resolveGoldCallInput, extractShownItems, extractExpectedFactsForCall, extractOfferedChoices, gitHeadSha, type ShownItem } from './oracle';
import { ROLE_GRANTS } from '../../apps/api/src/modules/auth/permission-registry';
import { filterPermissionsByEntitlement } from '../../apps/api/src/modules/employee-access/domain/logic/feature-gate.logic';
import { TIER_FEATURE_PRESETS } from '../../packages/contracts/src/menu-entitlements';
import { renderUserText } from './template';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SECRETS_PATH = process.env['MANGMEE_EVAL_SECRETS_PATH'] ?? '/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json';
const DB_NAME = 'watchdog_ai_reliability_replay_expense_advisor';
const CORPUS_PATH = process.env['MANGMEE_EVAL_CORPUS'] ?? resolve(REPO_ROOT, 'scripts/line-ai-expense-advisor/corpus.sample.json');
const REDIS_URL = process.env['MANGMEE_EVAL_REDIS_URL'] ?? 'redis://127.0.0.1:16389/13';
const API_PORT = Number(process.env['MANGMEE_EVAL_API_PORT'] ?? '19291');
const DETERMINISTIC_FAMILIES = process.env['MANGMEE_EVAL_DETERMINISTIC_RESPONSE_FAMILIES']
  ?? 'expense.list_recent::single_metric,expense.list_recent::list,expense.get_breakdown::list,expense.get_daily_closing::single_metric,reimbursement.list_pending_approvals::list,reimbursement.get_summary::single_metric';

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(resolve(REPO_ROOT, path))).digest('hex');
}

/** Every text a delivered LINE message could carry a fact in: a plain text bubble's `text`, and a
 * Flex message's `altText` plus any `text` node inside its `contents` tree. */
function extractDeliveredText(messages: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 12) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'text' || key === 'altText') && typeof child === 'string') parts.push(child);
      else visit(child, depth + 1);
    }
  };
  visit(messages, 0);
  return parts.join('\n');
}

function toCapturedEvidence(evidence: RuntimeTurnEvidence): CapturedEvidence {
  // `result` rides along on each captured call — the "one more scorer rule" category/vendor/branch
  // name-resolution equivalence check (scorer.ts resolvedOutcome) reads it directly off here.
  const toolCalls = evidence.toolResults.map((call) => ({ tool: call.tool, input: call.input as Record<string, unknown>, result: call.result as ToolResultLike | undefined }));
  const deliveredText = evidence.receipts.map((receipt) => extractDeliveredText(receipt.messages)).join('\n');
  const lastReceiptAt = evidence.receipts.length ? Math.max(...evidence.receipts.map((receipt) => receipt.at)) : null;
  const usage = evidence.providerUsage as Array<{ costSatang: number | null; usageBasis: string }>;
  const costSatang = usage.length && usage.every((row) => row.usageBasis === 'PROVIDER_REPORTED')
    ? usage.reduce((sum, row) => sum + (row.costSatang ?? 0), 0) : null;
  const offeredChoices = toolCalls.flatMap((call) => (call.result ? extractOfferedChoices(call.result) ?? [] : []));
  return {
    toolCalls, deliveredText,
    latencyMs: lastReceiptAt !== null ? lastReceiptAt - evidence.acceptedAtMs : null,
    modelCalls: usage.length, costSatang,
    offeredChoices,
  };
}

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

const turnKey = (conversationId: string, turnIndex: number) => `${conversationId}#${turnIndex}`;

/**
 * Runs every gold call in the corpus through the SAME real, in-process oracle preflight uses,
 * against a freshly truncated-and-reseeded copy of the eval database — BEFORE the live replay
 * starts (`runLineReliabilityRuntime` does its own truncate+reseed per fixture, so this pass's
 * seeded state is irrelevant to it once it begins; running the oracle first, and fully closing it,
 * also avoids any overlap with that function's own Nest app / fetch patching).
 *
 * This is the source of truth for two things "never hand-type expected numbers" requires:
 *  - `factsByTurn`: the facts a delivered reply must contain (extracted from the GOLD call's own
 *    result, not the model's possibly-wrong one);
 *  - `resultsByTurn`: the gold call's own resolved category/vendor/branch, for the "judge by what
 *    the API resolved" scorer rule (scorer.ts resolvedOutcome) — comparing a model's raw
 *    "น้ำมัน" against gold's raw "ค่าน้ำมัน" would never match on text, but both resolve to the
 *    same categoryId.
 */
async function collectGoldResults(
  corpus: Corpus, companies: Record<EvalCompany, CompanySeed>, databaseUrl: string, redisUrl: string, secretsPath: string, now: Date,
): Promise<{ resultsByTurn: Map<string, Array<ToolResultLike | undefined>>; factsByTurn: Map<string, ExpectedFact[]> }> {
  const apiRoot = resolve(REPO_ROOT, 'apps/api');
  const requireApi = createRequire(resolve(apiRoot, 'package.json'));
  const { Client } = requireApi('pg') as { Client: new (opts: { connectionString: string }) => PgClientLike & { connect(): Promise<void>; end(): Promise<void> } };
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try { await truncateAllTables(pg); } finally { await pg.end(); }

  const oracle = await bootOracle({ repoRoot: REPO_ROOT, databaseUrl, redisUrl, secretsPath });
  const resultsByTurn = new Map<string, Array<ToolResultLike | undefined>>();
  const factsByTurn = new Map<string, ExpectedFact[]>();
  try {
    await applySeedRows(oracle.prisma as never, SHARED_ACCESS_ROWS);
    for (const company of Object.values(companies)) await applySeedRows(oracle.prisma as never, company.rows.slice(SHARED_ACCESS_ROWS.length));

    for (const conversation of corpus.conversations) {
      const company = companies[conversation.company];
      const actor = company.users[conversation.role];
      const ctx = await oracle.resolveActorContext({ userId: actor.userId, companyId: company.companyId });
      let priorShownItems: ShownItem[] = [];
      for (const [turnIndex, turn] of conversation.turns.entries()) {
        if (!turn.expect.calls?.length) continue;
        const results: Array<ToolResultLike | undefined> = [];
        const facts: ExpectedFact[] = [];
        for (const call of turn.expect.calls) {
          const resolvedInput = resolveGoldCallInput(call, now, priorShownItems);
          const result = await oracle.invoke(call.tool, ctx, resolvedInput) as ToolResultLike;
          results.push(result);
          facts.push(...extractExpectedFactsForCall(call.tool, result, call));
          const shown = extractShownItems(call.tool, result);
          if (shown.length) priorShownItems = shown;
        }
        resultsByTurn.set(turnKey(conversation.id, turnIndex), results);
        factsByTurn.set(turnKey(conversation.id, turnIndex), facts);
      }
    }
  } finally {
    await oracle.close();
  }
  return { resultsByTurn, factsByTurn };
}

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

  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
  validateCorpus(corpus);
  const flat = flattenTurns(corpus);

  const now = new Date();
  const companies: Record<EvalCompany, CompanySeed> = { A: buildCompanySeed('A', now), B: buildCompanySeed('B', now) };
  const { snapshots, snapshotDigests } = buildSnapshots(corpus, companies);
  const fixtures = buildFixtures(corpus, companies, now);

  console.log(JSON.stringify({ event: 'gold_oracle_pass_start' }));
  const { resultsByTurn, factsByTurn } = await collectGoldResults(corpus, companies, databaseUrl.toString(), REDIS_URL, SECRETS_PATH, now);
  console.log(JSON.stringify({ event: 'gold_oracle_pass_done', turnsResolved: resultsByTurn.size }));

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
    environment: { LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES: DETERMINISTIC_FAMILIES },
    repeats: 1, cohort: '1000', bootstrapLaunchGates: true,
  };

  console.log(JSON.stringify({ event: 'real_run_start', conversations: fixtures.length, turns: flat.length, sourceCommit }));
  const result = await runLineReliabilityRuntime(manifest, REPO_ROOT);

  const scores: TurnScore[] = [];
  for (const { conversation, turnIndex, turn } of flat) {
    const evidence = result.turnEvidence.find((row: RuntimeTurnEvidence) => row.scenarioId === conversation.id && row.turnIndex === turnIndex);
    assert.ok(evidence, `no captured evidence for ${conversation.id}#${turnIndex}`);
    const captured = toCapturedEvidence(evidence);
    const key = turnKey(conversation.id, turnIndex);
    // Both come from collectGoldResults' independent oracle pass — never from the model's own
    // (possibly wrong) captured result, per "never hand-type expected numbers, always the oracle".
    const expectedFacts = factsByTurn.get(key) ?? [];
    const goldResults = resultsByTurn.get(key) ?? [];
    scores.push(scoreTurn({ conversationId: conversation.id, turnIndex }, turn, captured, expectedFacts, now, goldResults));
  }
  const summary = summarizeScores(scores);

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const evidencePath = resolve(outputDir, `${stamp}.evidence.json`);
  const reportPath = resolve(outputDir, `${stamp}.report.md`);
  const safeManifest = { ...manifest, databaseUrl: '[redacted]', gatewayUrl: '[redacted-local]' };
  writeFileSync(evidencePath, JSON.stringify({ startedAt: now.toISOString(), sourceCommit, model, manifest: safeManifest, scores, summary, turnEvidence: result.turnEvidence, runtimeDiagnostics: result.runtimeDiagnostics }, null, 2));
  writeFileSync(reportPath, renderReport({ sourceCommit, now, summary, scores, corpus }));

  console.log(JSON.stringify({ event: 'real_run_done', evidencePath, reportPath, total: summary.total, passed: summary.passed, failed: summary.failed }));
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

function renderReport(input: { sourceCommit: string; now: Date; summary: ReturnType<typeof summarizeScores>; scores: TurnScore[]; corpus: Corpus }): string {
  const { sourceCommit, now, summary, scores, corpus } = input;
  const byCategoryRows = Object.entries(summary.byCategory).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([category, row]) => `| ${category} | ${row.passed}/${row.total} |`).join('\n');
  const failureSections = summary.failures.map((failure) => {
    const conversation = corpus.conversations.find((row) => row.id === failure.conversationId)!;
    const turn = conversation.turns[failure.turnIndex]!;
    const transcript = conversation.turns.slice(0, failure.turnIndex + 1)
      .map((row, index) => `${index}. **user:** ${renderUserText(row.user, now)}`).join('\n');
    return `### ${failure.conversationId} turn ${failure.turnIndex} (category ${failure.category})\n\n`
      + `Transcript so far:\n\n${transcript}\n\nGold: \`${JSON.stringify(turn.expect)}\`\n\nReasons: ${failure.reasons.join(', ')}\n`;
  }).join('\n');
  return `# LINE AI expense-advisor eval report\n\n`
    + `- Source commit: \`${sourceCommit}\`\n- Run started: ${now.toISOString()}\n- Corpus: ${corpus.conversations.length} conversations, ${scores.length} turns\n\n`
    + `## Summary\n\n| | |\n|---|---|\n| Passed | ${summary.passed} |\n| Failed | ${summary.failed} |\n| Pass rate | ${(summary.passRate * 100).toFixed(1)}% |\n\n`
    + `## By category (spec §3 row)\n\n| Category | Passed/Total |\n|---|---|\n${byCategoryRows}\n\n`
    + `## Failures\n\n${failureSections || '_none_'}\n`;
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'real_run_failed', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
