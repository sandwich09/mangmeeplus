/** Read-only producer for the exact PRODUCTION_A5_VERIFICATION_EVIDENCE_PATH input. */
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import {
  A5_PRODUCTION_READER_ROLE,
  resolveA5TargetEnvironment,
  stableJson,
} from '../../src/scripts/a5-readonly-evidence.logic';
import {
  parseProductionA5ReviewedManifest,
  type ProductionA5BudgetObservation,
  type ProductionA5CloneChildRef,
  type ProductionA5CloneRehearsal,
  type ProductionA5ExecutedMigrationSet,
  type ProductionA5Stage,
  type ProductionA5VerificationEvidence,
} from '../../src/scripts/production-a5-evidence.logic';
import { assertNoProductionA5AwsCredentials } from '../../src/scripts/production-a5-evidence.pg';
import {
  buildProductionA5PostVerificationEvidence,
  buildProductionA5PreVerificationEvidence,
  runProductionA5ReviewedInvariantPhase,
  validateProductionA5PostDeploymentVerificationEvidence,
} from './invariant-runner';
import { readProductionA5RepositoryMigrationFiles } from './reviewed-manifest';

const MAX_INPUT_BYTES = 32 * 1024 * 1024;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') throw new Error(`production_a5_${name.toLowerCase()}_required`);
  return value;
}

function readJson(path: string, label: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_INPUT_BYTES) {
    throw new Error(`production_a5_${label}_file_invalid`);
  }
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error(`production_a5_${label}_json_invalid`); }
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`production_a5_${label}_invalid`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  if (stableJson(Object.keys(value).sort()) !== stableJson([...expected].sort())) {
    throw new Error(`production_a5_${label}_keys_invalid`);
  }
}

function stageOf(value: string): ProductionA5Stage {
  if (!['PRE_MUTATION', 'POST_MIGRATION', 'POST_DEPLOYMENT'].includes(value)) {
    throw new Error('production_a5_invariant_stage_invalid');
  }
  return value as ProductionA5Stage;
}

function sourceAppliedMigrationsHashOf(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('production_a5_source_applied_migrations_hash_invalid');
  }
  return value;
}

async function main(): Promise<void> {
  if (process.env['DATABASE_URL']) throw new Error('production_a5_writer_secret_present');
  assertNoProductionA5AwsCredentials(process.env);
  if (resolveA5TargetEnvironment(process.env) !== 'production') {
    throw new Error('production_a5_target_must_be_production');
  }
  const stage = stageOf(requiredEnv('PRODUCTION_A5_STAGE'));
  const files = readProductionA5RepositoryMigrationFiles();
  const manifest = parseProductionA5ReviewedManifest(
    readJson(requiredEnv('PRODUCTION_A5_REVIEWED_MANIFEST_PATH'), 'reviewed_manifest'),
    files,
  );
  const context = objectOf(
    readJson(requiredEnv('PRODUCTION_A5_INVARIANT_CONTEXT_PATH'), 'invariant_context'),
    'invariant_context',
  );
  let evidence: ProductionA5VerificationEvidence;

  const databaseUrl = requiredEnv('A5_READONLY_DATABASE_URL');
  const parsedUrl = new URL(databaseUrl);
  if (decodeURIComponent(parsedUrl.username) !== A5_PRODUCTION_READER_ROLE || parsedUrl.password === '') {
    throw new Error('production_a5_reader_url_invalid');
  }
  for (const forbidden of ['host', 'port', 'user', 'dbname']) {
    if (parsedUrl.searchParams.has(forbidden)) throw new Error('production_a5_reader_url_override_invalid');
  }
  if (/\b(?:role|session_authorization|search_path)\s*=/i.test(
    decodeURIComponent(parsedUrl.searchParams.get('options') ?? ''),
  )) throw new Error('production_a5_reader_url_role_override_invalid');
  if ((parsedUrl.searchParams.get('schema') ?? 'public') !== 'public'
    || manifest.catalogScope.schema !== 'public') {
    throw new Error('production_a5_invariant_schema_must_be_public');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const runPostInvariants = () => prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.$executeRawUnsafe('SET LOCAL search_path = pg_catalog, public');
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '300000ms'");
    const schemaResults = await runProductionA5ReviewedInvariantPhase(tx, manifest, 'POST_SCHEMA');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '300000ms'");
    const dataResults = await runProductionA5ReviewedInvariantPhase(tx, manifest, 'POST_DATA');
    return [schemaResults, dataResults] as const;
  }, { maxWait: 10_000, timeout: 620_000 });
  try {
    if (stage === 'PRE_MUTATION') {
        exactKeys(context, [
          'sourceAppliedMigrationsHash', 'cloneRehearsal', 'cloneRehearsalRef',
        ], 'pre_invariant_context');
        const preconditionResults = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
          await tx.$executeRawUnsafe('SET LOCAL search_path = pg_catalog, public');
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '300000ms'");
          return runProductionA5ReviewedInvariantPhase(tx, manifest, 'PRE');
        }, { maxWait: 10_000, timeout: 320_000 });
        evidence = buildProductionA5PreVerificationEvidence({
          manifest,
          sourceAppliedMigrationsHash: sourceAppliedMigrationsHashOf(context['sourceAppliedMigrationsHash']),
          preconditionResults,
          cloneRehearsal: context['cloneRehearsal'] as ProductionA5CloneRehearsal,
          cloneRehearsalRef: context['cloneRehearsalRef'] as ProductionA5CloneChildRef,
        });
    } else if (stage === 'POST_MIGRATION') {
        exactKeys(context, [
          'sourceAppliedMigrationsHash', 'preMutationVerificationEvidence',
          'executedMigrations', 'executionBudgetResults',
        ], 'post_migration_context');
        const [postSchemaResults, postDataResults] = await runPostInvariants();
        evidence = buildProductionA5PostVerificationEvidence({
          manifest,
          sourceAppliedMigrationsHash: sourceAppliedMigrationsHashOf(context['sourceAppliedMigrationsHash']),
          preMutationVerificationEvidence: context['preMutationVerificationEvidence'],
          postSchemaResults,
          postDataResults,
          executedMigrations: context['executedMigrations'] as ProductionA5ExecutedMigrationSet,
          executionBudgetResults: context['executionBudgetResults'] as ProductionA5BudgetObservation[],
        });
    } else {
      exactKeys(context, [
        'sourceAppliedMigrationsHash', 'postMigrationVerificationEvidence',
      ], 'post_deployment_context');
      const [postSchemaResults, postDataResults] = await runPostInvariants();
      evidence = validateProductionA5PostDeploymentVerificationEvidence({
        manifest,
        sourceAppliedMigrationsHash: sourceAppliedMigrationsHashOf(context['sourceAppliedMigrationsHash']),
        postMigrationVerificationEvidence: context['postMigrationVerificationEvidence'],
      });
      if (stableJson(postSchemaResults) !== stableJson(evidence.postSchemaResults)
        || stableJson(postDataResults) !== stableJson(evidence.postDataResults)) {
        throw new Error('production_a5_post_deployment_invariant_rerun_mismatch');
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const bytes = `${stableJson(evidence)}\n`;
  writeFileSync(requiredEnv('PRODUCTION_A5_VERIFICATION_EVIDENCE_PATH'), bytes, { mode: 0o600, flag: 'wx' });
  process.stdout.write(bytes);
}

main().catch(() => {
  console.error('Production A5 invariant evidence failed: production_a5_invariant_evidence_failed');
  process.exitCode = 1;
});
