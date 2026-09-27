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
import { validateCorpus, flattenTurns, type Corpus } from './types';
import { buildCompanySeed, applySeedRows, SHARED_ACCESS_ROWS, type CompanySeed } from './seed';
import { bootOracle, resolveGoldCallInput, extractShownItems, extractExpectedFacts, gitHeadSha, type ShownItem } from './oracle';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SECRETS_PATH = process.env['MANGMEE_EVAL_SECRETS_PATH'] ?? '/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json';
const DB_NAME = 'watchdog_ai_reliability_replay_expense_advisor';
const CORPUS_PATH = process.env['MANGMEE_EVAL_CORPUS'] ?? resolve(REPO_ROOT, 'scripts/line-ai-expense-advisor/corpus.sample.json');
const REDIS_URL = process.env['MANGMEE_EVAL_REDIS_URL'] ?? 'redis://127.0.0.1:16389/13';

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

/** Idempotent re-run support: preflight seeds a fresh graph every time, so a leftover previous
 * attempt (partial seed, or the same corpus re-run) must be cleared first. Mirrors the truncate
 * step of `resetRuntimeFixtureDatabase` in scripts/line-ai-reliability-runtime.ts, inlined here
 * (rather than imported) so preflight does not drag in that file's whole Nest/webhook replay
 * machinery for one 10-line helper. */
async function truncateAllTables(databaseUrl: string, requireApi: NodeJS.Require): Promise<void> {
  const { Client } = requireApi('pg') as { Client: new (opts: { connectionString: string }) => { connect(): Promise<void>; end(): Promise<void>; query(sql: string): Promise<{ rows: Array<{ tablename: string }> }> } };
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'")).rows.map((row) => row.tablename);
    assert.ok(tables.length > 0, 'no tables found after migrate — refusing to seed an unmigrated database');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`TRUNCATE TABLE ${tables.map((name) => `"public"."${name}"`).join(',')} CASCADE`);
    await client.query('SET LOCAL session_replication_role = origin');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  console.log(JSON.stringify({ event: 'preflight_start', db: DB_NAME, corpus: CORPUS_PATH }));
  const secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8')) as { databaseUrl: string };
  const apiRoot = resolve(REPO_ROOT, 'apps/api');
  const requireApi = createRequire(resolve(apiRoot, 'package.json'));

  await ensureDatabase(secrets.databaseUrl, DB_NAME, requireApi);
  const databaseUrl = withDatabase(secrets.databaseUrl, DB_NAME);

  console.log(JSON.stringify({ event: 'migrate_start' }));
  execFileSync(resolve(apiRoot, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit',
  });

  const compiledEntry = resolve(apiRoot, 'dist/apps/api/src/app.module.js');
  if (process.env['MANGMEE_EVAL_SKIP_BUILD'] !== 'true' || !existsSync(compiledEntry)) {
    console.log(JSON.stringify({ event: 'build_start', target: '@watchdog-bms/api...' }));
    execFileSync('pnpm', ['--filter', '@watchdog-bms/api...', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }
  assert.ok(existsSync(compiledEntry), `compiled API entry missing after build: ${compiledEntry}`);

  console.log(JSON.stringify({ event: 'truncate_start' }));
  await truncateAllTables(databaseUrl, requireApi);

  const oracle = await bootOracle({ repoRoot: REPO_ROOT, databaseUrl, redisUrl: REDIS_URL, secretsPath: SECRETS_PATH });
  try {
    console.log(JSON.stringify({ event: 'seed_start' }));
    const now = new Date();
    const companies: Record<'A' | 'B', CompanySeed> = { A: buildCompanySeed('A', now), B: buildCompanySeed('B', now) };
    // SHARED_ACCESS_ROWS is the identical prefix of every company's `rows` (see seed.ts) — seeded
    // once here since preflight shares one un-truncated database across both companies, unlike
    // real-mode's per-fixture reset+reseed, where each company's `rows` must stay self-contained.
    await applySeedRows(oracle.prisma as never, SHARED_ACCESS_ROWS);
    for (const company of Object.values(companies)) await applySeedRows(oracle.prisma as never, company.rows.slice(SHARED_ACCESS_ROWS.length));
    console.log(JSON.stringify({
      event: 'seed_done',
      companyA: { companyId: companies.A.companyId, branches: companies.A.branchIds.length },
      companyB: { companyId: companies.B.companyId, branches: companies.B.branchIds.length },
    }));

    const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
    validateCorpus(corpus);
    const flat = flattenTurns(corpus);

    let dataTurns = 0;
    let tagOnlyTurns = 0;
    let hardErrors = 0;
    let factsExtracted = 0;
    const byCategory = new Map<string, { total: number; ok: number }>();
    const byToolStatus = new Map<string, number>();
    const errorDetails: Array<{ conversationId: string; turnIndex: number; tool: string; error: string }> = [];
    const priorShownItemsByConversation = new Map<string, ShownItem[]>();

    for (const { conversation, turnIndex, turn } of flat) {
      const bucket = byCategory.get(turn.category) ?? { total: 0, ok: 0 };
      bucket.total += 1;
      byCategory.set(turn.category, bucket);
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
          factsExtracted += extractExpectedFacts(call.tool, result).length;
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
      dataTurns, tagOnlyTurns, hardErrors, factsExtracted,
      byCategory: Object.fromEntries(byCategory),
      byToolStatus: Object.fromEntries(byToolStatus),
      errorDetails,
    }, null, 2));

    if (hardErrors > 0) process.exitCode = 1;
  } finally {
    await oracle.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'preflight_failed', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }));
  process.exitCode = 1;
});
