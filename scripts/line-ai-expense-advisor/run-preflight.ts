#!/usr/bin/env -S node --import tsx
/**
 * Preflight: create/migrate the eval DB if needed, seed it, run every gold call in the corpus
 * through the oracle, and print a coverage summary. No gateway, no model, no Bedrock call.
 *
 * Usage: node_modules/.bin/tsx scripts/line-ai-expense-advisor/run-preflight.ts
 * Env:
 *   MANGMEE_EVAL_SECRETS_PATH  default /tmp/mangmee-latency-pilot-20260927/runtime-secrets.json
 *   MANGMEE_EVAL_REDIS_URL     default redis://127.0.0.1:16389/13
 *   MANGMEE_EVAL_CORPUS        default scripts/line-ai-expense-advisor/corpus.sample.json
 *   MANGMEE_EVAL_SKIP_BUILD    "true" to skip the `pnpm build` step (dist already fresh)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCorpus, validateWorkflowCorpus, flattenTurns, type Corpus, type WorkflowCorpus } from './types';
import { buildCompanySeed, buildWorkflowSeed, resolveWorkflowActor, type WorkflowSeed, applySeedRows, truncateAllTables, SHARED_ACCESS_ROWS, type CompanySeed, type PgClientLike } from './seed';
import { bootOracle, resolveGoldCallInput, resolveKnowledgeGold, resolveWorkflowDueDate, extractShownItems, extractExpectedFactsForCall, extractOfferedChoices, gitHeadSha, type ShownItem } from './oracle';
import { renderUserText } from './template';
import { collectGoldResults } from './gold-oracle-pass';
import { captureSpend, installEvalGuard } from './eval-spend';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SECRETS_PATH = process.env['MANGMEE_EVAL_SECRETS_PATH'] ?? '/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json';
const DB_NAME = 'watchdog_ai_reliability_replay_expense_advisor';
const CORPUS_PATH = process.env['MANGMEE_EVAL_CORPUS'] ?? resolve(REPO_ROOT, 'scripts/line-ai-expense-advisor/corpus.sample.json');
const REDIS_URL = process.env['MANGMEE_EVAL_REDIS_URL'] ?? 'redis://127.0.0.1:16389/13';

export function resolveWorkflowSeedRef(ref: string, seeds: Record<'A' | 'B' | 'C', CompanySeed> | WorkflowSeed): Record<string, unknown> {
  assert.ok(ref.startsWith('$seed:'), 'WORKFLOW_SEED_REFERENCE_REQUIRED');
  const key = ref.slice('$seed:'.length);
  const rows = 'rows' in seeds ? seeds.rows : Object.values(seeds).flatMap(company => company.rows);
  const row = rows.find(candidate => candidate.data.id === key)
    ?? rows.filter(candidate => candidate.model === 'reimbursementRequest').map(candidate => ({ model: 'reimbursementLine', data: { ...candidate.data, id: `rbl_${candidate.data.id}` } })).find(candidate => candidate.data.id === key);
  assert.ok(row, `WORKFLOW_SEED_REFERENCE_UNKNOWN:${key}`);
  return row.data;
}

export function validateWorkflowPreflight(corpus: WorkflowCorpus, seeds: Record<'A' | 'B' | 'C', CompanySeed> | WorkflowSeed, now = new Date()) {
  const rows = 'rows' in seeds ? seeds.rows : Object.values(seeds).flatMap(company => company.rows);
  const seedKeys = new Set(rows.map(row => String(row.data.id ?? '')));
  for (const row of rows) if (row.model === 'reimbursementRequest') seedKeys.add(`rbl_${row.data.id}`);
  validateWorkflowCorpus(corpus, seedKeys);
  let presses = 0, seedReferences = 0, actorAssignments = 0;
  for (const conversation of corpus.conversations) for (const turn of conversation.turns) {
    const actor = turn.as ? conversation.actors.find(row => row.key === turn.as!.key) : conversation.actors[0];
    assert.ok(actor, `WORKFLOW_ACTOR_MISSING:${conversation.id}`);
    if (actor.kind === 'unlinked') {
      assert.ok('actors' in seeds, 'WORKFLOW_UNLINKED_SEED_REQUIRED');
      resolveWorkflowActor(actor, seeds); actorAssignments++;
      assert.ok(!turn.expect.knowledge && !turn.expect.dueDate, `WORKFLOW_UNLINKED_PRIVATE_GOLD:${conversation.id}`);
      if (turn.press) presses++;
      continue;
    }
    const company = ('companies' in seeds ? seeds.companies : seeds)[actor.company];
    if (actor.kind === 'creator-only') assert.ok('actors' in seeds, 'WORKFLOW_CREATOR_ONLY_SEED_REQUIRED');
    if ('actors' in seeds) resolveWorkflowActor(actor, seeds);
    assert.ok(company.users[actor.role], `WORKFLOW_ACTOR_SEED_MISSING:${conversation.id}:${actor.key}`);
    if (actor.branchScope !== 'all') assert.ok(actor.branchScope.branches.every(branch => company.branchIds.includes(branch)), `WORKFLOW_BRANCH_SCOPE_UNKNOWN:${actor.key}`);
    actorAssignments++;
    if (turn.expect.knowledge) resolveKnowledgeGold(turn.expect.knowledge);
    if (turn.expect.dueDate) resolveWorkflowDueDate(turn.expect.dueDate, rows, company.companyId, now);
    if (turn.press) presses++;
    for (const task of conversation.tasks) for (const record of task.goldTerminal.records) if (record.ref.startsWith('$seed:')) {
      resolveWorkflowSeedRef(record.ref, seeds); seedReferences++;
    }
    for (const op of turn.fixture ?? []) if (op.op === 'mutate') {
      assert.ok(seedKeys.has(op.seedKey), `WORKFLOW_FIXTURE_SEED_UNKNOWN:${op.seedKey}`);
      resolveWorkflowSeedRef(`$seed:${op.seedKey}`, seeds);
    }
  }
  return { conversations: corpus.conversations.length, turns: corpus.conversations.reduce((sum, row) => sum + row.turns.length, 0), presses, actorAssignments, seedReferences };
}

function withDatabase(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

async function ensureDatabase(adminUrl: string, name: string, requireApi: NodeJS.Require): Promise<void> {
  assert.match(name, /^watchdog_ai_reliability_replay_[a-z0-9_]+$/, 'refusing to touch a database outside the replay prefix');
  const { Client } = requireApi('pg') as { Client: new (opts: { connectionString: string }) => { connect(): Promise<void>; end(): Promise<void>; query(sql: string, params?: unknown[]): Promise<{ rowCount: number }> } };
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

async function withPgClient<T>(databaseUrl: string, requireApi: NodeJS.Require, run: (client: PgClientLike) => Promise<T>): Promise<T> {
  const { Client } = requireApi('pg') as { Client: new (opts: { connectionString: string }) => PgClientLike & { connect(): Promise<void>; end(): Promise<void> } };
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try { return await run(client); } finally { await client.end(); }
}

async function main(): Promise<void> {
  console.log(JSON.stringify({ event: 'preflight_start', db: DB_NAME, corpus: CORPUS_PATH }));
  const rawCorpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as unknown;
  const now = new Date();
  const seeds: Record<'A' | 'B' | 'C', CompanySeed> = { A: buildCompanySeed('A', now), B: buildCompanySeed('B', now), C: buildCompanySeed('C', now) };
  if ((rawCorpus as { version?: unknown }).version === 2) {
    const workflowCorpus = rawCorpus as WorkflowCorpus;
    const coverage = validateWorkflowPreflight(workflowCorpus, buildWorkflowSeed(now, workflowCorpus.conversations.flatMap(conversation => conversation.actors)), now);
    if (process.argv.includes('--validate-only')) { console.log(JSON.stringify({ event: 'workflow_preflight_valid', ...coverage })); return; }
  } else {
    validateCorpus(rawCorpus);
    if (process.argv.includes('--validate-only')) { console.log(JSON.stringify({ event: 'legacy_preflight_valid' })); return; }
  }
  const maxThb = process.env['MANGMEE_EVAL_MAX_THB'];
  assert.ok(maxThb, 'MANGMEE_EVAL_MAX_THB is required before a database reset');
  const secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8')) as { databaseUrl: string };
  const apiRoot = resolve(REPO_ROOT, 'apps/api');
  const requireApi = createRequire(resolve(apiRoot, 'package.json'));

  await ensureDatabase(secrets.databaseUrl, DB_NAME, requireApi);
  const databaseUrl = withDatabase(secrets.databaseUrl, DB_NAME);

  console.log(JSON.stringify({ event: 'migrate_start' }));
  execFileSync(resolve(apiRoot, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit',
  });

  const spendPath = process.env['MANGMEE_EVAL_SPEND_PATH'] ?? '/tmp/mangmee-latency-pilot-20260927/preflight.spend.jsonl';
  await withPgClient(databaseUrl, requireApi, async client => {
    await installEvalGuard(client, databaseUrl, maxThb);
    await captureSpend(client, databaseUrl, spendPath, 'preflight');
  });

  const compiledEntry = resolve(apiRoot, 'dist/apps/api/src/app.module.js');
  if (process.env['MANGMEE_EVAL_SKIP_BUILD'] !== 'true' || !existsSync(compiledEntry)) {
    console.log(JSON.stringify({ event: 'build_start', target: '@watchdog-bms/api...' }));
    execFileSync('pnpm', ['--filter', '@watchdog-bms/api...', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }
  assert.ok(existsSync(compiledEntry), `compiled API entry missing after build: ${compiledEntry}`);

  if ((rawCorpus as { version?: unknown }).version === 2) {
    const pass = await collectGoldResults(REPO_ROOT, rawCorpus as WorkflowCorpus, seeds, databaseUrl, REDIS_URL, SECRETS_PATH, now,
      () => withPgClient(databaseUrl, requireApi, client => captureSpend(client, databaseUrl, spendPath, 'preflight-oracle')).then(() => undefined));
    console.log(JSON.stringify({ event: 'workflow_oracle_pass', ...pass.workflowValidation }));
    return;
  }

  console.log(JSON.stringify({ event: 'truncate_start' }));
  await withPgClient(databaseUrl, requireApi, truncateAllTables);

  const oracle = await bootOracle({ repoRoot: REPO_ROOT, databaseUrl, redisUrl: REDIS_URL, secretsPath: SECRETS_PATH });
  try {
    console.log(JSON.stringify({ event: 'seed_start' }));
    const companies = seeds;
    // SHARED_ACCESS_ROWS is the identical prefix of every company's `rows` (see seed.ts) — seeded
    // once here since preflight shares one un-truncated database across both companies, unlike
    // real-mode's per-fixture reset+reseed, where each company's `rows` must stay self-contained.
    await applySeedRows(oracle.prisma as never, SHARED_ACCESS_ROWS);
    for (const company of Object.values(companies)) await applySeedRows(oracle.prisma as never, company.rows.slice(SHARED_ACCESS_ROWS.length));
    console.log(JSON.stringify({
      event: 'seed_done',
      companyA: { companyId: companies.A.companyId, branches: companies.A.branchIds.length },
      companyB: { companyId: companies.B.companyId, branches: companies.B.branchIds.length },
      companyC: { companyId: companies.C.companyId, branches: companies.C.branchIds.length },
    }));

    const corpus = rawCorpus as Corpus;
    validateCorpus(corpus);
    const flat = flattenTurns(corpus);

    let dataTurns = 0;
    let tagOnlyTurns = 0;
    let hardErrors = 0;
    let factsExtracted = 0;
    let renderedTurns = 0;
    let choiceResultsSeen = 0;
    const byCategory = new Map<string, { total: number; ok: number }>();
    const byToolStatus = new Map<string, number>();
    const errorDetails: Array<{ conversationId: string; turnIndex: number; tool: string; error: string }> = [];
    const priorShownItemsByConversation = new Map<string, ShownItem[]>();

    for (const { conversation, turnIndex, turn } of flat) {
      const bucket = byCategory.get(turn.category) ?? { total: 0, ok: 0 };
      bucket.total += 1;
      byCategory.set(turn.category, bucket);
      try {
        // Renders {{this_month_th}}-style placeholders with the SAME function run-real.ts uses,
        // from the SAME clock — preflight has no model to send this text to, but rendering it here
        // still proves the corpus's own placeholders are well-formed (validateCorpus already
        // checked they are KNOWN; this checks they actually resolve) before a real run pays for it.
        renderUserText(turn.user, now);
        renderedTurns += 1;
      } catch (error) {
        hardErrors += 1;
        errorDetails.push({ conversationId: conversation.id, turnIndex, tool: 'renderUserText', error: error instanceof Error ? error.message : String(error) });
      }
      if (!turn.expect.calls?.length) { tagOnlyTurns += 1; bucket.ok += 1; continue; }
      dataTurns += 1;
      const company = companies[conversation.company];
      const actor = company.users[conversation.role];
      const ctx = await oracle.resolveActorContext({ userId: actor.userId, companyId: company.companyId });
      let priorShownItems = priorShownItemsByConversation.get(conversation.id) ?? [];
      let turnOk = true;
      for (const call of turn.expect.calls) {
        try {
          const resolvedInput = resolveGoldCallInput(call, now, priorShownItems);
          const result = await oracle.invoke(call.tool, ctx, resolvedInput) as { status: string; data?: unknown };
          byToolStatus.set(result.status, (byToolStatus.get(result.status) ?? 0) + 1);
          const shown = extractShownItems(call.tool, result);
          if (shown.length) priorShownItems = shown;
          factsExtracted += extractExpectedFactsForCall(call.tool, result, call, turn.expect.requiredFacts).length;
          // Exercises the ambiguous/unresolved detection path (task item 3) even though today's
          // seeded data never triggers it — proves extractOfferedChoices does not throw on a
          // normal "ok" result, ahead of Track C's categoryName/vendorName resolution landing.
          if (extractOfferedChoices(result)) choiceResultsSeen += 1;
        } catch (error) {
          turnOk = false;
          hardErrors += 1;
          errorDetails.push({ conversationId: conversation.id, turnIndex, tool: call.tool, error: error instanceof Error ? error.message : String(error) });
        }
      }
      priorShownItemsByConversation.set(conversation.id, priorShownItems);
      if (turnOk) bucket.ok += 1;
    }

    console.log(JSON.stringify({
      event: 'preflight_coverage',
      sourceCommit: gitHeadSha(REPO_ROOT),
      conversations: corpus.conversations.length,
      turns: flat.length,
      dataTurns, tagOnlyTurns, hardErrors, factsExtracted, renderedTurns, choiceResultsSeen,
      byCategory: Object.fromEntries(byCategory),
      byToolStatus: Object.fromEntries(byToolStatus),
      errorDetails,
    }, null, 2));

    if (hardErrors > 0) process.exitCode = 1;
  } finally {
    await oracle.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'preflight_failed', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }));
    process.exitCode = 1;
  });
}
