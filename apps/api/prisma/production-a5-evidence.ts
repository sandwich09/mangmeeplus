/**
 * Production-only, aggregate-only FR-H H2 payload collector.
 *
 * Signing, artifact transport and prior-envelope verification stay in the controller. This process
 * accepts only the already-verified prior payload bytes + structured child ref and has no AWS or
 * writer credential path.
 */
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  A5_PRODUCTION_READER_ROLE,
  resolveA5SchemaProfile,
  resolveA5TargetEnvironment,
  stableJson,
} from '../src/scripts/a5-readonly-evidence.logic';
import {
  PRODUCTION_A5_STAGES,
  buildProductionA5Payload,
  parseProductionA5ReimbursementWriteQuiesce,
  parseProductionA5ReviewedManifest,
  parseProductionA5ServingBuilds,
  type ProductionA5ChildRef,
  type ProductionA5Stage,
  type ProductionA5VerificationEvidence,
  type VerifiedProductionA5Baseline,
} from '../src/scripts/production-a5-evidence.logic';
import {
  assertNoProductionA5AwsCredentials,
  collectProductionA5DatabaseSnapshot,
} from '../src/scripts/production-a5-evidence.pg';
import { readProductionA5RepositoryMigrationFiles } from './production-a5/reviewed-manifest';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') throw new Error(`production_a5_${name.toLowerCase()}_required`);
  return value;
}

function readBoundedFile(path: string, label: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_INPUT_BYTES) {
    throw new Error(`production_a5_${label}_file_invalid`);
  }
  return readFileSync(path, 'utf8');
}

function parseJson(bytes: string, label: string): unknown {
  try { return JSON.parse(bytes); } catch { throw new Error(`production_a5_${label}_json_invalid`); }
}

function baseline(prefix: 'PRE' | 'POST_MIGRATION'): VerifiedProductionA5Baseline {
  const refBytes = readBoundedFile(requiredEnv(`PRODUCTION_A5_${prefix}_REF_PATH`), `${prefix.toLowerCase()}_ref`);
  const payloadBytes = readBoundedFile(
    requiredEnv(`PRODUCTION_A5_${prefix}_PAYLOAD_PATH`),
    `${prefix.toLowerCase()}_payload`,
  );
  return {
    ref: parseJson(refBytes, `${prefix.toLowerCase()}_ref`) as ProductionA5ChildRef,
    payloadBytes,
  };
}

function assertBaselineInputs(stage: ProductionA5Stage): {
  preMutationBaseline?: VerifiedProductionA5Baseline;
  postMigrationBaseline?: VerifiedProductionA5Baseline;
} {
  const names = [
    'PRODUCTION_A5_PRE_REF_PATH',
    'PRODUCTION_A5_PRE_PAYLOAD_PATH',
    'PRODUCTION_A5_POST_MIGRATION_REF_PATH',
    'PRODUCTION_A5_POST_MIGRATION_PAYLOAD_PATH',
  ] as const;
  const present = (name: typeof names[number]) => Boolean(process.env[name]?.trim());
  if (stage === 'PRE_MUTATION') {
    if (names.some(present)) throw new Error('production_a5_pre_must_not_receive_baselines');
    return {};
  }
  if (!present(names[0]) || !present(names[1])) throw new Error('production_a5_pre_baseline_pair_required');
  const preMutationBaseline = baseline('PRE');
  if (stage === 'POST_MIGRATION') {
    if (present(names[2]) || present(names[3])) throw new Error('production_a5_post_migration_must_not_receive_post_baseline');
    return { preMutationBaseline };
  }
  if (!present(names[2]) || !present(names[3])) throw new Error('production_a5_post_migration_baseline_pair_required');
  return { preMutationBaseline, postMigrationBaseline: baseline('POST_MIGRATION') };
}

async function main(): Promise<void> {
  if (process.env['DATABASE_URL']) throw new Error('production_a5_writer_secret_present');
  assertNoProductionA5AwsCredentials(process.env);
  const environment = resolveA5TargetEnvironment(process.env);
  if (environment !== 'production') throw new Error('production_a5_target_must_be_production');

  const rawStage = requiredEnv('PRODUCTION_A5_STAGE');
  if (!PRODUCTION_A5_STAGES.includes(rawStage as ProductionA5Stage)) {
    throw new Error('production_a5_stage_invalid');
  }
  const stage = rawStage as ProductionA5Stage;
  const profile = resolveA5SchemaProfile(process.env, environment);
  const expectedProfile = stage === 'PRE_MUTATION' ? 'LEGACY_PRE_F1' : 'F1_CURRENT';
  if (profile !== expectedProfile) throw new Error('production_a5_stage_profile_mismatch');

  const sourceCommit = requiredEnv('GIT_SHA');
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('production_a5_source_commit_invalid');
  const databaseUrl = requiredEnv('A5_READONLY_DATABASE_URL');
  const parsedUrl = new URL(databaseUrl);
  if (decodeURIComponent(parsedUrl.username) !== A5_PRODUCTION_READER_ROLE || parsedUrl.password === '') {
    throw new Error('production_a5_reader_url_invalid');
  }
  for (const forbidden of ['host', 'port', 'user', 'dbname']) {
    if (parsedUrl.searchParams.has(forbidden)) throw new Error('production_a5_reader_url_override_invalid');
  }
  if (/\brole\s*=|\bsession_authorization\s*=/i.test(decodeURIComponent(parsedUrl.searchParams.get('options') ?? ''))) {
    throw new Error('production_a5_reader_url_role_override_invalid');
  }
  const schema = parsedUrl.searchParams.get('schema') ?? 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('production_a5_schema_invalid');

  const migrationFiles = readProductionA5RepositoryMigrationFiles();
  const manifest = parseProductionA5ReviewedManifest(parseJson(readBoundedFile(
    requiredEnv('PRODUCTION_A5_REVIEWED_MANIFEST_PATH'),
    'reviewed_manifest',
  ), 'reviewed_manifest'), migrationFiles);
  if (manifest.catalogScope.schema !== schema) throw new Error('production_a5_manifest_schema_mismatch');
  const servingBuilds = parseProductionA5ServingBuilds(parseJson(readBoundedFile(
    requiredEnv('PRODUCTION_A5_SERVING_BUILDS_PATH'),
    'serving_builds',
  ), 'serving_builds'));
  const verificationEvidence = parseJson(readBoundedFile(
    requiredEnv('PRODUCTION_A5_VERIFICATION_EVIDENCE_PATH'),
    'verification_evidence',
  ), 'verification_evidence') as ProductionA5VerificationEvidence;
  const reimbursementWriteQuiesce = parseProductionA5ReimbursementWriteQuiesce(
    parseJson(readBoundedFile(
      requiredEnv('PRODUCTION_A5_REIMBURSEMENT_QUIESCE_PATH'),
      'reimbursement_quiesce',
    ), 'reimbursement_quiesce'),
    stage,
    sourceCommit,
  );
  const baselines = assertBaselineInputs(stage);
  const outputPath = requiredEnv('PRODUCTION_A5_PAYLOAD_PATH');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const snapshot = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      return collectProductionA5DatabaseSnapshot(tx, { stage, schema, noTaskRole: true });
    }, { maxWait: 10_000, timeout: 120_000 });
    const payload = buildProductionA5Payload({
      stage,
      sourceCommit,
      manifest,
      migrationFiles,
      snapshot,
      verificationEvidence,
      reimbursementWriteQuiesce,
      servingBuilds,
      ...baselines,
    });
    const bytes = `${stableJson(payload)}\n`;
    writeFileSync(outputPath, bytes, { mode: 0o600, flag: 'wx' });
    process.stdout.write(bytes);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  // Database/decoder messages may include tenant-bearing values. Diagnostics stay bounded.
  console.error('Production A5 evidence failed: production_a5_evidence_failed');
  process.exitCode = 1;
});
