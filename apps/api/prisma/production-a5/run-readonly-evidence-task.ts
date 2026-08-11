/**
 * Private one-shot production A5 reader.
 *
 * The ECS agent injects only A5_READONLY_DATABASE_URL from Secrets Manager. The container has no
 * task role and therefore cannot ask AWS for any other credential. Non-secret reviewed inputs are
 * gzip+base64 encoded in the immutable task definition and the only stdout is a bounded, digested
 * CloudWatch result frame reconstructed by the controller.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { stableJson } from '../../src/scripts/a5-readonly-evidence.logic';
import { assertNoProductionA5AwsCredentials } from '../../src/scripts/production-a5-evidence.pg';

const MAX_ENCODED_INPUT_BYTES = 60_000;
const MAX_DECODED_INPUT_BYTES = 8 * 1024 * 1024;
// Reserve room under the 1 MiB signed-envelope limit for controller-attested health/runtime facts.
const MAX_RESULT_BYTES = 700_000;
const RESULT_CHUNK_BYTES = 24_000;

type JsonObject = Record<string, unknown>;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') throw new Error(`production_a5_task_${name.toLowerCase()}_required`);
  return value;
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  if (stableJson(Object.keys(value).sort()) !== stableJson([...expected].sort())) {
    throw new Error(`production_a5_task_${label}_keys_invalid`);
  }
}

function objectOf(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`production_a5_task_${label}_invalid`);
  }
  return value as JsonObject;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${stableJson(value)}\n`, { mode: 0o600, flag: 'wx' });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd: '/app', env, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], timeout: 1_300_000,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error('production_a5_task_child_failed');
  }
}

function parseBundle(encoded: string): JsonObject {
  if (Buffer.byteLength(encoded) > MAX_ENCODED_INPUT_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('production_a5_task_bundle_encoding_invalid');
  }
  let decoded: Buffer;
  try {
    decoded = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: MAX_DECODED_INPUT_BYTES });
  } catch {
    throw new Error('production_a5_task_bundle_compression_invalid');
  }
  if (decoded.length <= 0 || decoded.length > MAX_DECODED_INPUT_BYTES) {
    throw new Error('production_a5_task_bundle_size_invalid');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(decoded.toString('utf8')); } catch {
    throw new Error('production_a5_task_bundle_json_invalid');
  }
  const bundle = objectOf(parsed, 'bundle');
  exactKeys(bundle, [
    'baselines', 'invariantContext', 'reimbursementWriteQuiesce', 'reviewedManifest',
    'schemaProfile', 'schemaVersion', 'servingBuilds', 'sourceCommit', 'stage',
  ], 'bundle');
  if (bundle['schemaVersion'] !== 1) throw new Error('production_a5_task_bundle_schema_invalid');
  return bundle;
}

function main(): void {
  if (process.env['DATABASE_URL']) throw new Error('production_a5_task_writer_secret_present');
  assertNoProductionA5AwsCredentials(process.env);
  const marker = requiredEnv('PRODUCTION_A5_RESULT_MARKER');
  if (!/^a5-prod-[1-9][0-9]*-a[1-9][0-9]*-(pre|post-migration|post-deployment)$/.test(marker)) {
    throw new Error('production_a5_task_result_marker_invalid');
  }
  const readerUrl = requiredEnv('A5_READONLY_DATABASE_URL');
  const parsedReader = new URL(readerUrl);
  if (decodeURIComponent(parsedReader.username) !== 'watchdog_a5_prod_ro' || parsedReader.password === '') {
    throw new Error('production_a5_task_reader_invalid');
  }
  const bundle = parseBundle(requiredEnv('PRODUCTION_A5_INPUT_BUNDLE_B64'));
  delete process.env['PRODUCTION_A5_INPUT_BUNDLE_B64'];

  const stage = String(bundle['stage'] ?? '');
  const sourceCommit = String(bundle['sourceCommit'] ?? '');
  const schemaProfile = String(bundle['schemaProfile'] ?? '');
  if (!['PRE_MUTATION', 'POST_MIGRATION', 'POST_DEPLOYMENT'].includes(stage)
      || !/^[0-9a-f]{40}$/.test(sourceCommit)
      || !['LEGACY_PRE_F1', 'F1_CURRENT'].includes(schemaProfile)
      || (stage === 'PRE_MUTATION') !== (schemaProfile === 'LEGACY_PRE_F1')) {
    throw new Error('production_a5_task_stage_binding_invalid');
  }
  if (requiredEnv('DEPLOY_ENV') !== 'production'
      || requiredEnv('A5_TARGET_ENVIRONMENT') !== 'production'
      || requiredEnv('PRODUCTION_A5_STAGE') !== stage
      || requiredEnv('GIT_SHA') !== sourceCommit
      || requiredEnv('A5_SCHEMA_PROFILE') !== schemaProfile) {
    throw new Error('production_a5_task_controller_binding_invalid');
  }
  const baselines = objectOf(bundle['baselines'], 'baselines');
  exactKeys(baselines, [
    'postMigrationPayload', 'postMigrationRef', 'preMutationPayload', 'preMutationRef',
  ], 'baselines');

  const work = `/tmp/${marker}`;
  mkdirSync(work, { mode: 0o700 });
  const paths = {
    manifest: `${work}/reviewed-manifest.json`, serving: `${work}/serving-builds.json`,
    quiesce: `${work}/reimbursement-quiesce.json`, context: `${work}/invariant-context.json`,
    verification: `${work}/verification-evidence.json`, payload: `${work}/payload.json`,
    preRef: `${work}/pre-ref.json`, prePayload: `${work}/pre-payload.json`,
    postRef: `${work}/post-ref.json`, postPayload: `${work}/post-payload.json`,
  };
  writeJson(paths.manifest, bundle['reviewedManifest']);
  writeJson(paths.serving, bundle['servingBuilds']);
  writeJson(paths.quiesce, bundle['reimbursementWriteQuiesce']);
  writeJson(paths.context, bundle['invariantContext']);

  const { PRODUCTION_A5_RESULT_MARKER: _marker, ...baseProcessEnv } = process.env;
  const childEnv: NodeJS.ProcessEnv = {
    ...baseProcessEnv,
    DEPLOY_ENV: 'production', A5_TARGET_ENVIRONMENT: 'production',
    A5_SCHEMA_PROFILE: schemaProfile, GIT_SHA: sourceCommit, PRODUCTION_A5_STAGE: stage,
    A5_READONLY_DATABASE_URL: readerUrl,
    PRODUCTION_A5_REVIEWED_MANIFEST_PATH: paths.manifest,
    PRODUCTION_A5_INVARIANT_CONTEXT_PATH: paths.context,
    PRODUCTION_A5_VERIFICATION_EVIDENCE_PATH: paths.verification,
  };
  run('/app/node_modules/.bin/tsx', [
    '--tsconfig', '/app/apps/api/tsconfig.json',
    '/app/apps/api/prisma/production-a5/run-reviewed-invariants.ts',
  ], childEnv);

  childEnv['PRODUCTION_A5_SERVING_BUILDS_PATH'] = paths.serving;
  childEnv['PRODUCTION_A5_REIMBURSEMENT_QUIESCE_PATH'] = paths.quiesce;
  childEnv['PRODUCTION_A5_PAYLOAD_PATH'] = paths.payload;
  if (stage !== 'PRE_MUTATION') {
    if (baselines['preMutationRef'] == null || baselines['preMutationPayload'] == null) {
      throw new Error('production_a5_task_pre_baseline_required');
    }
    writeJson(paths.preRef, baselines['preMutationRef']);
    writeJson(paths.prePayload, baselines['preMutationPayload']);
    childEnv['PRODUCTION_A5_PRE_REF_PATH'] = paths.preRef;
    childEnv['PRODUCTION_A5_PRE_PAYLOAD_PATH'] = paths.prePayload;
  } else if (baselines['preMutationRef'] != null || baselines['preMutationPayload'] != null) {
    throw new Error('production_a5_task_pre_baseline_forbidden');
  }
  if (stage === 'POST_DEPLOYMENT') {
    if (baselines['postMigrationRef'] == null || baselines['postMigrationPayload'] == null) {
      throw new Error('production_a5_task_post_baseline_required');
    }
    writeJson(paths.postRef, baselines['postMigrationRef']);
    writeJson(paths.postPayload, baselines['postMigrationPayload']);
    childEnv['PRODUCTION_A5_POST_MIGRATION_REF_PATH'] = paths.postRef;
    childEnv['PRODUCTION_A5_POST_MIGRATION_PAYLOAD_PATH'] = paths.postPayload;
  } else if (baselines['postMigrationRef'] != null || baselines['postMigrationPayload'] != null) {
    throw new Error('production_a5_task_post_baseline_forbidden');
  }
  run('/app/node_modules/.bin/tsx', [
    '--tsconfig', '/app/apps/api/tsconfig.json',
    '/app/apps/api/prisma/production-a5-evidence.ts',
  ], childEnv);
  delete childEnv['A5_READONLY_DATABASE_URL'];
  delete process.env['A5_READONLY_DATABASE_URL'];

  const payload = readFileSync(paths.payload);
  if (payload.length <= 0 || payload.length > MAX_RESULT_BYTES) {
    throw new Error('production_a5_task_result_size_invalid');
  }
  const canonical = `${stableJson(JSON.parse(payload.toString('utf8')))}\n`;
  if (!payload.equals(Buffer.from(canonical))) throw new Error('production_a5_task_result_noncanonical');
  const digest = createHash('sha256').update(payload).digest('hex');
  const encoded = payload.toString('base64');
  const chunks = Array.from({ length: Math.ceil(encoded.length / RESULT_CHUNK_BYTES) }, (_, index) =>
    encoded.slice(index * RESULT_CHUNK_BYTES, (index + 1) * RESULT_CHUNK_BYTES));
  chunks.forEach((chunk, index) => {
    process.stdout.write(`A5_PRODUCTION_RESULT ${marker} ${index + 1}/${chunks.length} ${digest} ${chunk}\n`);
  });
}

try {
  main();
} catch {
  console.error('Production A5 private reader failed: production_a5_private_reader_failed');
  process.exitCode = 1;
}
