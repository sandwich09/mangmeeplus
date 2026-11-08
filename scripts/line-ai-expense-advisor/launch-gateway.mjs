#!/usr/bin/env node
/**
 * Gateway launcher for real-mode replay (task step 5). NOT executed by this harness build — the
 * controller runs this once, waits for it to listen, then runs run-real.ts against it.
 *
 * Spawns the COMPILED AI Gateway (apps/ai-gateway/dist/apps/ai-gateway/src/main.js) with the same
 * non-secret env as the prior agent's launch-gateway-starter-owner.py reference
 * (/tmp/mangmee-latency-pilot-20260927/launch-gateway-starter-owner.py), pointed at THIS harness's
 * own database/Redis/port instead of that agent's. Never touches runtime-secrets.json's own
 * values beyond passing `gatewaySecret`/`delegationSigningKey` straight into the child's env.
 *
 * Usage: node scripts/line-ai-expense-advisor/launch-gateway.mjs
 * Requires AWS_PROFILE or a local Anthropic key file (real model calls once a conversation reaches it).
 * Optional env:
 *   MANGMEE_EVAL_ANTHROPIC_KEY_FILE      default ~/.config/mangmee/anthropic-api-key (takes precedence over AWS_PROFILE)
 *   MANGMEE_EVAL_SECRETS_PATH            default /tmp/mangmee-latency-pilot-20260927/runtime-secrets.json
 *   MANGMEE_EVAL_GATEWAY_PORT            default 19205
 *   MANGMEE_EVAL_API_PORT                default 19291 (must match run-real.ts's MANGMEE_EVAL_API_PORT)
 *   MANGMEE_EVAL_REDIS_URL               default redis://127.0.0.1:16389/13
 *   MANGMEE_EVAL_DETERMINISTIC_RESPONSE_FAMILIES  default matches spec §5 R-L4's family list
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SECRETS_PATH = process.env.MANGMEE_EVAL_SECRETS_PATH ?? '/tmp/mangmee-latency-pilot-20260927/runtime-secrets.json';
const DB_NAME = 'watchdog_ai_reliability_replay_expense_advisor';
const PORT = process.env.MANGMEE_EVAL_GATEWAY_PORT ?? '19205';
const API_PORT = process.env.MANGMEE_EVAL_API_PORT ?? '19291';
const REDIS_URL = process.env.MANGMEE_EVAL_REDIS_URL ?? 'redis://127.0.0.1:16389/13';
const OUTPUT_DIR = process.env.MANGMEE_EVAL_OUTPUT_DIR;
const DETERMINISTIC_FAMILIES = process.env.MANGMEE_EVAL_DETERMINISTIC_RESPONSE_FAMILIES
  ?? 'expense.list_recent::single_metric,expense.list_recent::list,expense.get_breakdown::list,expense.get_daily_closing::single_metric,reimbursement.list_pending_approvals::list,reimbursement.get_summary::single_metric';

const keyFile = (process.env.MANGMEE_EVAL_ANTHROPIC_KEY_FILE ?? '~/.config/mangmee/anthropic-api-key').replace(/^~\//, `${homedir()}/`);
let anthropicApiKey;
try {
  anthropicApiKey = readFileSync(keyFile, 'utf8').trim() || undefined;
} catch (err) {
  if (err.code !== 'ENOENT' && !process.env.AWS_PROFILE) {
    console.error(JSON.stringify({ event: 'gateway_launch_refused', reason: 'ANTHROPIC_KEY_FILE_UNREADABLE', keyFile }));
    process.exit(1);
  }
}
if (!process.env.AWS_PROFILE && !anthropicApiKey) {
  console.error(JSON.stringify({ event: 'gateway_launch_refused', reason: 'AWS_PROFILE_OR_ANTHROPIC_KEY_FILE_REQUIRED', keyFile }));
  process.exit(1);
}

const secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8'));
const databaseUrl = new URL(secrets.databaseUrl);
databaseUrl.pathname = `/${DB_NAME}`;
databaseUrl.searchParams.set('schema', 'public');

const env = {
  ...process.env,
  ANTHROPIC_API_KEY: anthropicApiKey,
  APP_ENV: 'local', NODE_ENV: 'test', SERVICE_NAME: 'line-ai-expense-advisor-eval-gateway',
  PORT, HOST: '127.0.0.1',
  AWS_SDK_LOAD_CONFIG: 'true', AWS_REGION: 'ap-southeast-1', AWS_EC2_METADATA_DISABLED: 'true',
  MODEL_PROVIDER: 'bedrock', BEDROCK_REGION: 'ap-southeast-1',
  BEDROCK_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
  DOCUMENT_AI_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
  APPROVED_AI_MODEL_IDS: 'global.anthropic.claude-sonnet-4-6,global.anthropic.claude-haiku-5-5',
  APPROVED_AI_PROVIDERS: 'bedrock', APPROVED_AI_REGIONS: 'ap-southeast-1',
  AI_GLOBAL_INFERENCE_PROFILE_APPROVED: 'true',
  AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF: 'DPO-2026-07-23-bedrock-global',
  LINE_AI_FUSED_PLAN_SHADOW_ENABLED: 'true', LINE_AI_PREPARED_SIMPLE_READ_ENABLED: 'true',
  LINE_AI_LEDGER_ENABLED: 'true', LINE_AI_RELIABILITY_V2_MODE: 'on',
  LINE_AI_PUBLIC_LOOKUP_ENABLED: 'false',
  LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES: DETERMINISTIC_FAMILIES,
  AI_GATEWAY_ENABLED: 'true', LINE_AI_AGENT_ORCHESTRATION_ENABLED: 'true',
  LINE_AI_AGENT_RUNTIME: 'strands-local', AI_GATEWAY_TRANSPORT: 'http',
  AI_GATEWAY_INTERNAL_URL: `http://127.0.0.1:${PORT}/v1`,
  ERP_CORE_INTERNAL_URL: `http://127.0.0.1:${API_PORT}/v1`,
  AI_GATEWAY_INTERNAL_SECRET: secrets.gatewaySecret,
  AI_ACTOR_DELEGATION_SIGNING_KEY: secrets.delegationSigningKey,
  DATABASE_URL: databaseUrl.toString(), REDIS_URL,
  RATE_LIMIT_ENABLED: 'false',
  S3_BUCKET: 'local-eval-only', S3_ENDPOINT: 'http://127.0.0.1:9',
  S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9', S3_ACCESS_KEY_ID: 'local-eval-only',
  S3_SECRET_ACCESS_KEY: 'local-eval-only', S3_FORCE_PATH_STYLE: 'true',
  WEB_BASE_URL: 'https://web.eval.test', LOG_LEVEL: process.env.MANGMEE_EVAL_LOG_LEVEL ?? 'warn',
  // Production's non-secret AI settings (shared with run-real.ts); the runtime stays strands-local.
  ...JSON.parse(readFileSync(resolve(REPO_ROOT, 'scripts/line-ai-expense-advisor/production-ai-env.json'), 'utf8')).gateway,
};

const entry = resolve(REPO_ROOT, 'apps/ai-gateway/dist/apps/ai-gateway/src/main.js');
if (!OUTPUT_DIR) {
  console.error(JSON.stringify({ event: 'gateway_launch_refused', reason: 'MANGMEE_EVAL_OUTPUT_DIR_REQUIRED_FOR_PROVENANCE' }));
  process.exit(1);
}
mkdirSync(OUTPUT_DIR, { recursive: true });
const transport = anthropicApiKey ? 'anthropic-api' : 'bedrock';
const gatewayManifestPath = resolve(OUTPUT_DIR, 'gateway.manifest.json');
writeFileSync(gatewayManifestPath, JSON.stringify({ transport, modelId: env.BEDROCK_MODEL_ID, region: env.BEDROCK_REGION,
  recordedAt: new Date().toISOString(), gatewayUrl: env.AI_GATEWAY_INTERNAL_URL }, null, 2));
console.log(JSON.stringify({
  event: 'gateway_launch', port: PORT, url: env.AI_GATEWAY_INTERNAL_URL, apiUrl: env.ERP_CORE_INTERNAL_URL, entry,
  transport, gatewayManifestPath,
}));
const child = spawn(process.execPath, [entry], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
