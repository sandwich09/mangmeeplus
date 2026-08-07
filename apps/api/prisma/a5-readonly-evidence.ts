/** Aggregate-only, database-zero-write A5-RO evidence. No tenant identifiers are emitted. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { A5_READER_ROLE, collectA5ReadonlyEvidence } from '../src/scripts/a5-readonly-evidence.logic';

async function main(): Promise<void> {
  const databaseUrl = process.env['A5_READONLY_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
  const targetEnvironment = process.env['DEPLOY_ENV'] ?? process.env['DEPLOY_ENVIRONMENT'] ?? '';
  const sourceCommit = (process.env['GIT_SHA'] ?? '').trim();
  if (targetEnvironment !== 'uat') throw new Error('A5-RO evidence is UAT-only');
  if (databaseUrl === '') throw new Error('A5_READONLY_DATABASE_URL or DATABASE_URL is required');
  const parsed = new URL(databaseUrl);
  if (decodeURIComponent(parsed.username) !== A5_READER_ROLE) {
    throw new Error(`A5-RO evidence must connect as ${A5_READER_ROLE}`);
  }
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('GIT_SHA must be one full lowercase commit SHA');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const evidence = await collectA5ReadonlyEvidence({
      prisma,
      schema: parsed.searchParams.get('schema') ?? 'public',
      migrationsDirectory: resolve(__dirname, 'migrations'),
      generatedAt: new Date().toISOString(),
      sourceCommit,
    });
    const json = `${JSON.stringify(evidence, null, 2)}\n`;
    const artifactPath = process.env['A5_ARTIFACT_PATH'] ?? '/tmp/a5-readonly-evidence.json';
    writeFileSync(artifactPath, json, { mode: 0o600 });
    process.stdout.write(json);
    // A completed observation is a successful task even when it says STOP. The controller retains
    // this full artifact, parses f2PrecheckReady, and refuses APPLY with the recorded blockers.
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // This task reads tenant-bearing rows to aggregate them. Failure text from a decoder or driver
  // is therefore never evidence output: emit only a bounded machine code, not the raw message.
  const candidate = error && typeof error === 'object'
    ? ((error as { code?: unknown }).code ?? (error as { name?: unknown }).name)
    : null;
  const safeCode = typeof candidate === 'string' && /^[A-Za-z0-9_]+$/.test(candidate)
    ? candidate.slice(0, 80)
    : 'a5_readonly_unknown_error';
  console.error(`A5-RO evidence failed: ${safeCode}`);
  process.exitCode = 1;
});
