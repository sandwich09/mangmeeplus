import { z } from 'zod';

const envBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}, z.boolean());

// ─── Base (all services) ───────────────────────────────────────────────────────

export const baseConfigSchema = z.object({
  APP_ENV: z.enum(['local', 'production']),
  // APP_ENV keeps deciding runtime/security mode. DEPLOY_ENVIRONMENT is the separate authoritative
  // deployment identity the launch control plane records (owner ruling 9): `local` is the safe
  // default so an unlabelled process can never claim to be uat/production.
  DEPLOY_ENVIRONMENT: z.enum(['local', 'uat', 'production']).default('local'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().min(1),
  SERVICE_VERSION: z.string().optional(),
  GIT_SHA: z.string().optional(),
  IMAGE_DIGEST: z.string().optional(),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().optional(),
  TRUST_PROXY: envBoolean.optional(),
});

export type AppEnv = z.infer<typeof baseConfigSchema>['APP_ENV'];
export type DeployEnvironment = 'local' | 'uat' | 'production';
export type DeploymentIdentity = { targetEnvironment: DeployEnvironment; buildReleaseId: string };

/** Recorded when no immutable build id was injected. Only ever legitimate locally. */
export const UNKNOWN_BUILD_RELEASE_ID = 'unknown-build';

/** The unvalidated read. Unrecognized values fall back to the least authority, never to trust. */
function readDeploymentIdentity(env: Record<string, string | undefined>): DeploymentIdentity {
  const declared = env['DEPLOY_ENVIRONMENT'];
  const targetEnvironment: DeployEnvironment = declared === 'uat' || declared === 'production' ? declared : 'local';
  const build = (env['GIT_SHA'] ?? env['IMAGE_DIGEST'] ?? '').trim();
  return { targetEnvironment, buildReleaseId: build.length > 0 ? build : UNKNOWN_BUILD_RELEASE_ID };
}

/**
 * The only two shapes an immutable build id may take, and the shapes this repo's deploy path
 * already produces: the full commit (`infra/docker/validate-production-manifest.sh` and
 * `run-release-task.sh` both assert `^[0-9a-f]{40}$`) or the image digest. A 12-char tag prefix,
 * an unreplaced `<GIT_SHA>` template (`infra/ai-gateway/task-definition.template.json` ships one),
 * or a truncated digest all *look* injected — they pass an "is it set" check and then record a
 * build id no audit can resolve back to one artifact, which is the same unattributable record
 * `unknown-build` would have written.
 */
const BUILD_ID_SHAPES = [
  ['GIT_SHA', /^[0-9a-f]{40}$/, 'the full 40-character lowercase commit sha, not a short prefix'],
  ['IMAGE_DIGEST', /^sha256:[0-9a-f]{64}$/, 'sha256: followed by 64 lowercase hex characters'],
] as const;

/**
 * F1.5.1 fail-close: `local` / `unknown-build` are the truthful answer for an unlabelled process,
 * and a truthful LIE for a production one. A production deploy that forgets to inject the identity
 * would otherwise record every launch-gate transition as environment `local` on build
 * `unknown-build` — an unattributable control-plane record that no later audit can repair. So the
 * process refuses to run rather than write one.
 */
function deploymentIdentityGaps(
  env: Record<string, string | undefined>,
  identity: DeploymentIdentity,
): string[] {
  const declared = env['DEPLOY_ENVIRONMENT'];
  const gaps: string[] = [];
  if (identity.targetEnvironment === 'local') {
    gaps.push(
      `DEPLOY_ENVIRONMENT must be "uat" or "production" when APP_ENV=production (got ${declared ? `"${String(declared)}"` : 'no value'})`,
    );
  }
  if (identity.buildReleaseId === UNKNOWN_BUILD_RELEASE_ID) {
    gaps.push('GIT_SHA or IMAGE_DIGEST must carry an immutable build id when APP_ENV=production');
  }
  for (const [key, shape, expected] of BUILD_ID_SHAPES) {
    // Key names and the expected shape only — a build id is not a secret, but the report this
    // feeds prints keys, never values.
    const value = String(env[key] ?? '').trim();
    if (value === '' || shape.test(value)) continue;
    gaps.push(/^<.*>$/.test(value)
      ? `${key} is still an unreplaced <...> template placeholder in production`
      : `${key} must be ${expected} when APP_ENV=production`);
  }
  return gaps;
}

/**
 * SERVER truth for the launch control plane (F1.5b P0-3): a caller may state what it *expects*,
 * never what the environment/build *is*.
 *
 * Throws under `APP_ENV=production` when the deployment identity was never injected. Every process
 * that records a gate transition resolves it through here — the API, and the release-task seeder,
 * which never constructs `AppConfigService` — so this, not the boot validator alone, is what makes
 * the rule inescapable.
 */
export function resolveDeploymentIdentity(env: Record<string, string | undefined>): DeploymentIdentity {
  const identity = readDeploymentIdentity(env);
  if (env['APP_ENV'] === 'production') {
    const gaps = deploymentIdentityGaps(env, identity);
    if (gaps.length > 0) {
      throw new Error(`Deployment identity is not injected:\n${gaps.map((gap) => `  - ${gap}`).join('\n')}`);
    }
  } else if (identity.targetEnvironment !== 'local') {
    // The mirror image of the gap above. APP_ENV decides the security mode; DEPLOY_ENVIRONMENT only
    // records which deployment this is. A process running local rules — dev auth on, production
    // validator skipped — that CLAIMS `uat` writes control-plane records indistinguishable from the
    // real UAT service's, so the claim is refused rather than trusted. `validateProductionConfig`
    // structurally cannot catch this: it is a no-op outside production.
    throw new Error(
      'Deployment identity is inconsistent:\n'
      + `  - DEPLOY_ENVIRONMENT="${identity.targetEnvironment}" requires APP_ENV=production `
      + `(got ${env['APP_ENV'] ? `"${String(env['APP_ENV'])}"` : 'no value'})`,
    );
  }
  return identity;
}

// ─── Approved AI model allowlist default (M-05) ───────────────────────────────

// M-05 requires geographic/single-region Bedrock inference profiles so a turn is
// not routed outside the approved processing region; validateProductionConfig
// rejects any `global.` entry. This default must therefore stay `global.`-free,
// and every entry must be INVOCABLE as an APAC profile in APPROVED_AI_REGIONS —
// not merely listed. `apac.anthropic.claude-sonnet-4-20250514-v1:0` is published
// in ap-southeast-1 but the provider marks it Legacy, and InvokeModel answers
// ResourceNotFoundException/"Access denied" for an account that has not used it in
// the last 30 days, so it must not sit in a default. Verified with a live
// InvokeModel probe per entry, not with `list-inference-profiles`. That makes
// claude-3-5-sonnet-20241022-v2 the newest usable APAC profile; every current
// model (sonnet-4-6, haiku-4-5, opus-5, sonnet-5) is `global.`-only, so raising
// this baseline needs AWS to publish an APAC profile — or the exception below.
//
// A newer `global.` profile may still be run, but only through the explicit,
// recorded exception below — never by relaxing this default or the rule. A
// `global.` profile lets Bedrock route a turn to any region worldwide, which for
// this product means personal data (customer names, phone numbers, LINE ids,
// receipt contents) crossing a border with no transfer mechanism recorded. That
// is a data-protection decision with a named owner, not a configuration default,
// so it fails closed and must be switched on deliberately per environment.
export const DEFAULT_APPROVED_AI_MODEL_IDS = [
  'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
  'apac.anthropic.claude-3-haiku-20240307-v1:0',
].join(',');

// ─── API service ───────────────────────────────────────────────────────────────

export const apiConfigSchema = baseConfigSchema.extend({
  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_SECRET_ARN: z.string().optional(),
  DATABASE_POOL_MIN: z.coerce.number().int().positive().default(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // S3 / uploads
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().default('ap-southeast-1'),
  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: envBoolean.optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10485760),
  UPLOAD_PENDING_MAX_BYTES_PER_COMPANY: z.coerce.number().int().positive().default(104857600),
  ALLOWED_UPLOAD_MIME_TYPES: z.string().default('application/pdf,image/png,image/jpeg'),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().max(65535).default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().positive().max(30000).default(5000),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(300).default(300),
  // HTTP security
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  HTTP_BODY_LIMIT: z.string().default('1mb'),
  SWAGGER_ENABLED: envBoolean.default(false),
  RATE_LIMIT_ENABLED: envBoolean.default(false),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  // One bounded production-upgrade safety switch. It is not a commercial feature flag:
  // reads stay available while reimbursement mutations are paused before DTO validation.
  REIMBURSEMENT_WRITE_QUIESCE: envBoolean.default(false),
  PRODUCTION_SERVING_MODE: z.enum(['live', 'maintenance_only']).optional(),
  // Auth
  AUTH_PROVIDER: z.enum(['line', 'dev']).default('dev'),
  DEV_AUTH_ENABLED: envBoolean.default(false),
  DEV_AUTH_SECRET: z.string().optional(),
  // L-03: known key so production boot can forbid it; the seed script fails closed without it.
  SEED_SYSTEM_ADMIN_PASSWORD: z.string().optional(),
  LINE_LOGIN_CHANNEL_ID: z.string().optional(),
  LINE_LOGIN_CHANNEL_SECRET: z.string().optional(),
  LINE_LIFF_ID: z.string().optional(),
  LINE_MESSAGING_CHANNEL_ID: z.string().optional(),
  LINE_MESSAGING_CHANNEL_SECRET: z.string().optional(),
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  // LINE AI message buffering (docs/specs/line-ai-message-buffering-spec.md §13)
  LINE_AI_BUFFER_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(2500),
  LINE_AI_BUFFER_MAX_WAIT_MS: z.coerce.number().int().positive().default(8000),
  LINE_AI_LOADING_ANIMATION_ENABLED: envBoolean.default(true),
  // Item 10F: LINE AI turn ledger on Redis Streams (ADR 0010; fail-open, default off)
  LINE_AI_LEDGER_ENABLED: envBoolean.default(false),
  LINE_AI_LEDGER_MAXLEN: z.coerce.number().int().positive().default(200),
  LINE_AI_LEDGER_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  LINE_AI_LEDGER_CLAIM_MIN_IDLE_MS: z.coerce.number().int().positive().default(120000),
  LINE_AI_LEDGER_DELIVERY_CAP: z.coerce.number().int().positive().default(3),
  AI_DATA_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).default(90),
  // L-08: the ERP executor is authoritative for AI mutation classification, so the API reads
  // the same switch the gateway does. Default off; production refuses true.
  AI_FINAL_MUTATION_ENABLED: envBoolean.default(false),
  CRM_AUTO_REPLY_ENABLED: envBoolean.default(false),
  CRM_AI_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  CRM_AI_OUTBOUND_ALLOWED_DOMAINS: z.string().default(''),
  WORKFLOW_WEBHOOK_ALLOWED_HOSTS: z.string().default(''),
  WEB_BASE_URL: z.string().url().optional(),
  WORKER_INTERNAL_TOKEN: z.string().optional(),
  AI_GATEWAY_INTERNAL_URL: z.string().url().default('http://localhost:3002'),
  AI_GATEWAY_INTERNAL_SECRET: z.string().optional(),
  AI_ACTOR_DELEGATION_SIGNING_KEY: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  WATCHDOG_JWT_ISSUER: z.string().optional(),
  WATCHDOG_JWT_AUDIENCE: z.string().optional(),
  WATCHDOG_JWT_SECRET_ARN: z.string().optional(),
  JWT_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(30),
  EMAIL_PROVIDER: z.enum(['disabled', 'ses']).default('disabled'),
  SES_REGION: z.string().optional(),
  SES_FROM_ADDRESS: z.string().email().optional(),
  PASSWORD_LOGIN_MAX_PER_IDENTIFIER: z.coerce.number().int().positive().default(5),
  PASSWORD_LOGIN_MAX_PER_IP: z.coerce.number().int().positive().default(20),
  PASSWORD_LOGIN_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  SESSION_REFRESH_MAX_PER_SESSION: z.coerce.number().int().positive().default(30),
  SESSION_REFRESH_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // L-01: grace window in which a rotated refresh token is a benign concurrent refresh
  // (shared BFF cookie across tabs) instead of reuse. 0 = strict, revoke on any replay.
  SESSION_REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(30),
  AI_LLM_MAX_PER_COMPANY: z.coerce.number().int().positive().default(60),
  AI_OCR_MAX_PER_COMPANY: z.coerce.number().int().positive().default(20),
  AI_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // Operator-owned FX rate used to price AI usage rows in satang at write time
  // (metering spec §7.4). Static by design: rows stay auditable and the rate is a lever,
  // not a market feed. Not an int — the THB/USD rate is fractional.
  AI_THB_PER_USD: z.coerce.number().positive().default(33),
  // Platform default monthly AI cap per company, in satang (metering spec §7.4). ฿2,000 is
  // ~2,800 employee questions or ~8,000 receipt scans at post-caching rates — well above
  // measured normal usage, so the cap bounds runaway cost without touching real work.
  AI_MONTHLY_BUDGET_SATANG: z.coerce.number().int().positive().default(200000),
  // Highest per-company override the operator may set, in satang (metering spec §7.4). Bounds
  // the blast radius of a mistyped budget; production refuses a ceiling below the default.
  AI_MONTHLY_BUDGET_SATANG_CEILING: z.coerce.number().int().positive().default(1000000),
  PASSWORD_RESET_REQUEST_MAX_PER_IDENTIFIER: z.coerce.number().int().positive().default(3),
  PASSWORD_RESET_REQUEST_MAX_PER_IP: z.coerce.number().int().positive().default(10),
  PASSWORD_RESET_REQUEST_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  PASSWORD_RESET_CONFIRM_MAX_PER_IP: z.coerce.number().int().positive().default(10),
  PASSWORD_RESET_CONFIRM_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  // L-06: fixed minimum response envelope so the unknown-vs-eligible identifier round-trip
  // difference is not observable. 0 disables the floor.
  PASSWORD_RESET_RESPONSE_MIN_MS: z.coerce.number().int().nonnegative().default(300),
  CUSTOMER_REGISTER_MAX_PER_IP_CHANNEL: z.coerce.number().int().positive().default(10),
  CUSTOMER_REGISTER_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  EMAIL_VERIFICATION_REQUEST_MAX_PER_USER: z.coerce.number().int().positive().default(3),
  EMAIL_VERIFICATION_REQUEST_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  EMAIL_VERIFICATION_CONFIRM_MAX_PER_IP: z.coerce.number().int().positive().default(10),
  EMAIL_VERIFICATION_CONFIRM_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  // RBAC / tenant
  REQUIRE_COMPANY_CONTEXT: envBoolean.default(true),
  COMPANY_CONTEXT_HEADER: z.string().default('X-Company-Id'),
  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['text', 'json']).default('json'),
  LOG_REDACTION_ENABLED: envBoolean.default(true),
  REQUEST_LOG_ENABLED: envBoolean.default(true),
  SQL_LOG_ENABLED: envBoolean.default(false),
  // Audit
  AUDIT_ENABLED: envBoolean.default(true),
  AUDIT_SINK: z.enum(['database']).default('database'),
  // Item 10A partner management
  CREDENTIAL_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  // Stable, dedicated HMAC root for irreversible PDPA identifiers. This must
  // rotate independently from reversible credential encryption keys.
  PDPA_PSEUDONYMIZATION_KEY: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS: z.string()
    .refine(
      (value) => value.trim() === '' || value.split(',').every((key) => /^[0-9a-f]{64}$/.test(key.trim())),
      'PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS must be comma-separated 64-character lowercase hex keys',
    )
    .default(''),
  APPROVED_AI_MODEL_IDS: z.string().default(DEFAULT_APPROVED_AI_MODEL_IDS),
  APPROVED_AI_PROVIDERS: z.string().default('bedrock,openai,typhoon'),
  APPROVED_AI_REGIONS: z.string().default('ap-southeast-1'),
  // envBoolean, not z.coerce.boolean(): coercion makes EVERY non-empty string true, so
  // an operator writing `=false` (as .env.example ships) would silently switch the
  // cross-border exception ON whenever an approval ref happened to be set. envBoolean
  // maps true/false and hard-fails anything else, so the control stays fail-closed.
  AI_GLOBAL_INFERENCE_PROFILE_APPROVED: envBoolean.default(false),
  AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF: z.string().optional(),
});

// ─── AI Gateway service ────────────────────────────────────────────────────────

export const aiGatewayConfigSchema = baseConfigSchema.extend({
  APPROVED_AI_MODEL_IDS: z.string().default(DEFAULT_APPROVED_AI_MODEL_IDS),
  APPROVED_AI_PROVIDERS: z.string().default('bedrock,openai,typhoon'),
  APPROVED_AI_REGIONS: z.string().default('ap-southeast-1'),
  // envBoolean, not z.coerce.boolean(): coercion makes EVERY non-empty string true, so
  // an operator writing `=false` (as .env.example ships) would silently switch the
  // cross-border exception ON whenever an approval ref happened to be set. envBoolean
  // maps true/false and hard-fails anything else, so the control stays fail-closed.
  AI_GLOBAL_INFERENCE_PROFILE_APPROVED: envBoolean.default(false),
  AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF: z.string().optional(),
  MODEL_PROVIDER: z.enum(['disabled', 'bedrock', 'openai']).default('disabled'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_PROCESSING_REGION: z.string().optional(),
  BEDROCK_REGION: z.string().optional(),
  BEDROCK_MODEL_ID: z.string().optional(),
  // Owner decision 2026-07-14: document understanding (receipt/bank-statement stage 2)
  // may use a stronger model than chat; unset falls back to BEDROCK_MODEL_ID.
  DOCUMENT_AI_MODEL_ID: z.string().optional(),
  // Item 09 follow-up: Typhoon OCR is the single receipt/tax-invoice OCR provider.
  TYPHOON_OCR_API_KEY: z.string().optional(),
  TYPHOON_PROCESSING_REGION: z.string().optional(),
  AI_GATEWAY_ENABLED: envBoolean.default(false),
  AI_AGENT_REGISTRY_ENABLED: envBoolean.default(false),
  AI_TOOL_POLICY_ENFORCED: envBoolean.default(true),
  AI_TOOL_AUDIT_ENABLED: envBoolean.default(true),
  AI_FINAL_MUTATION_ENABLED: envBoolean.default(false),
  AI_PROMPT_LOGGING_ENABLED: envBoolean.default(false),
  // M-01: the API issues at most eight single-use delegations for any one tool.
  AI_MAX_TOOL_CALLS: z.coerce.number().int().positive().max(8).default(8),
  AI_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // Item 10B: local agent orchestration
  LINE_AI_AGENT_ORCHESTRATION_ENABLED: envBoolean.default(false),
  LINE_AI_AGENT_RUNTIME: z.enum(['strands-local', 'disabled', 'agentcore']).default('disabled'),
  // Item 10F: native tool-use loop + coverage critic (fallback chain keeps 10B behavior when off)
  LINE_AI_TOOLUSE_LOOP_ENABLED: envBoolean.default(false),
  LINE_AI_COVERAGE_CRITIC_ENABLED: envBoolean.default(true),
  AWS_PROFILE: z.string().optional(),
  AWS_SDK_LOAD_CONFIG: envBoolean.default(false),
  // AgentCore runtime invoke config (used when LINE_AI_AGENT_RUNTIME=agentcore)
  AGENTCORE_REGION: z.string().optional(),
  AGENTCORE_RUNTIME_ARN: z.string().optional(),
  AGENTCORE_RUNTIME_QUALIFIER: z.string().optional(),
  AGENTCORE_INVOKE_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  // L-12: AgentCore invocation bounds. Enforced while streaming, never after buffering.
  AGENTCORE_MAX_BODY_BYTES: z.coerce.number().int().positive().default(1048576),
  AGENTCORE_MAX_MESSAGE_CHARS: z.coerce.number().int().positive().default(8000),
  AGENTCORE_MAX_ATTACHMENTS: z.coerce.number().int().positive().default(10),
  AGENTCORE_MAX_CONCURRENT_INVOCATIONS: z.coerce.number().int().positive().default(16),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  HTTP_BODY_LIMIT: z.string().default('1mb'),
  SWAGGER_ENABLED: envBoolean.default(false),
  RATE_LIMIT_ENABLED: envBoolean.default(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['text', 'json']).default('json'),
  LOG_REDACTION_ENABLED: envBoolean.default(true),
  // Auth / JWT (mirrors API config; AI Gateway verifies tokens but issues none)
  DEV_AUTH_SECRET: z.string().optional(),
  WATCHDOG_JWT_SECRET_ARN: z.string().optional(),
  WATCHDOG_JWT_ISSUER: z.string().optional(),
  WATCHDOG_JWT_AUDIENCE: z.string().optional(),
  JWT_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(30),
  // Internal service auth
  AI_GATEWAY_INTERNAL_SECRET: z.string().optional(),
  // ERP core URL (AI Gateway calls back to API for tool execution)
  ERP_CORE_INTERNAL_URL: z.string().url().default('http://localhost:3001/v1'),
});

// ─── Web (Next.js) service ────────────────────────────────────────────────────

export const webConfigSchema = baseConfigSchema.extend({
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
  NEXT_PUBLIC_AI_GATEWAY_BASE_URL: z.string().url(),
  NEXT_PUBLIC_APP_ENV: z.enum(['local', 'production']).optional(),
});

// ─── Workers service ──────────────────────────────────────────────────────────

export const workersConfigSchema = baseConfigSchema.extend({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().default('ap-southeast-1'),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: envBoolean.optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  INTERNAL_API_URL: z.string().url().default('http://localhost:3001/v1'),
  WORKER_INTERNAL_TOKEN: z.string().optional(),
  PRODUCTION_SERVING_MODE: z.enum(['live', 'maintenance_only']).optional(),
  QUEUE_ENABLED: envBoolean.default(true),
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),
  QUEUE_RETRY_ATTEMPTS: z.coerce.number().int().nonnegative().default(3),
  QUEUE_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  DLQ_ENABLED: envBoolean.default(true),
  // Item 10F: LINE AI ledger reclaim cadence (drain endpoint caller)
  LINE_AI_LEDGER_RECLAIM_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['text', 'json']).default('json'),
  LOG_REDACTION_ENABLED: envBoolean.default(true),
});

export type ServiceConfig = z.infer<typeof apiConfigSchema>;

// ─── Non-secret JWT defaults (L-04) ───────────────────────────────────────────

// Shared fallback so a non-production verifier still pins iss/aud instead of degrading to
// "unset means skip". Production continues to require explicit WATCHDOG_JWT_ISSUER/AUDIENCE.
export const DEFAULT_JWT_ISSUER = 'watchdog-bms';
export const DEFAULT_JWT_AUDIENCE = 'watchdog-bms-api';

// ─── Workflow webhook allowlist (M-09) ───────────────────────────────────────

// Production requires this key to be non-empty so a task definition that silently lost it
// fails to boot instead of degrading to deny-all unnoticed. A tenant that runs no outbound
// webhooks still needs a way to say so, and inventing a dummy host to satisfy the check would
// be weaker than the deny-all it was standing in for. This reserved word is that answer: it is
// never treated as a hostname, and it resolves to the empty allowlist, which denies every host.
export const WEBHOOK_ALLOWLIST_DENY_ALL = 'none';

/** Parses WORKFLOW_WEBHOOK_ALLOWED_HOSTS; the deny-all sentinel yields an empty allowlist. */
export function parseWebhookAllowedHosts(raw: string): string[] {
  if (raw.trim().toLowerCase() === WEBHOOK_ALLOWLIST_DENY_ALL) return [];
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

// ─── Secret strength rules (L-03) ─────────────────────────────────────────────

// Committed local/example/default fragments. A production secret containing any of these
// is a value that has been in the repo, a doc, or a screenshot.
const SECRET_DENYLIST = [
  'change-me', 'changeme', 'local', 'localhost', 'example', 'placeholder', 'sample',
  'dummy', 'insecure', 'password', 'secret123', 'watchdogbms11', 'todo', 'xxxx',
];

function hasDenylistedToken(value: string): boolean {
  const lowered = value.toLowerCase();
  return SECRET_DENYLIST.some((token) => lowered.includes(token));
}

/** Too few distinct characters, or the whole value is one substring repeated. */
// Rejects the shapes a human types when they mean "fill this in later". A genuinely random
// secret of the enforced length (>=32 chars, or 64 hex) clears all three rules with room to
// spare, so these can only fire on a hand-made value.
function isLowEntropySecret(value: string): boolean {
  if (new Set(value).size < 10) return true;
  // Periodicity for ANY period, not just divisors of the length: a repeated block with one
  // extra character appended (`abcdefgh12345678abcdefgh12345678a`) is still a repeated block,
  // and a cycle whose length does not divide the total (`1234567890` in 32 chars) still cycles.
  for (let period = 1; period * 2 <= value.length; period += 1) {
    if (value.slice(period) === value.slice(0, value.length - period)) return true;
  }
  // Sequential runs catch keyboard walks and counting (`abcdefgh`, `12345678`) that are neither
  // low-alphabet nor periodic.
  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < value.length; i += 1) {
    const delta = value.charCodeAt(i) - value.charCodeAt(i - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= 8 || descending >= 8) return true;
  }
  return false;
}

// ─── Production fail-fast ─────────────────────────────────────────────────────

export function validateProductionConfig(config: Record<string, unknown>): void {
  if (config['APP_ENV'] !== 'production') return;

  const errors: string[] = [];
  const bool = (v: unknown) => v === true || v === 'true';
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const missing = (key: string) => config[key] === undefined || config[key] === null || config[key] === '';
  const hasKey = (key: string) => Object.prototype.hasOwnProperty.call(config, key);
  const isApiConfig = hasKey('AUTH_PROVIDER');
  const isDataServiceConfig = hasKey('DATABASE_URL') || hasKey('DATABASE_SECRET_ARN') || hasKey('S3_BUCKET');
  const isAiConfig = hasKey('AI_GATEWAY_ENABLED') || hasKey('MODEL_PROVIDER');
  // L-03: these two discriminators use always-defaulted schema keys, because an *unset*
  // optional secret is absent from the parsed config and would hide its own requirement.
  const isWorkersConfig = hasKey('QUEUE_ENABLED');
  const readsJwtSecret = hasKey('JWT_CLOCK_TOLERANCE_SECONDS')
    || hasKey('WATCHDOG_JWT_SECRET_ARN')
    || hasKey('DEV_AUTH_SECRET');

  // L-03: one rule set over whichever secret keys this config actually carries. Every message
  // names the key only — a secret value must never reach a log or a crash report.
  const checkSecret = (key: string, tier: 'repo' | 'hex' | 'third-party') => {
    const value = str(config[key]);
    if (!hasKey(key) || value === '') return;
    const minLength = tier === 'repo' ? 32 : tier === 'third-party' ? 16 : 0;
    if (value.length < minLength) {
      errors.push(`${key} must be at least ${minLength} characters in production`);
    }
    if (tier !== 'hex' && hasDenylistedToken(value)) {
      errors.push(`${key} must not reuse a committed local/example/default value in production`);
    }
    if (tier !== 'third-party' && isLowEntropySecret(value)) {
      errors.push(`${key} has too little entropy in production (repeated pattern or too few distinct characters)`);
    }
  };

  // Repo-generated: we control the generator, so demand real length, novelty, and entropy.
  for (const key of ['WORKER_INTERNAL_TOKEN', 'AI_GATEWAY_INTERNAL_SECRET', 'WATCHDOG_JWT_SECRET_ARN']) {
    checkSecret(key, 'repo');
  }
  // Hex keys: the 64-hex shape is already enforced by the schema; add entropy only.
  for (const key of ['AI_ACTOR_DELEGATION_SIGNING_KEY', 'CREDENTIAL_ENCRYPTION_KEY', 'PDPA_PSEUDONYMIZATION_KEY']) {
    checkSecret(key, 'hex');
  }
  // Third-party: length and shape are the vendor's, so only length floor + denylist apply.
  for (const key of [
    'LINE_LOGIN_CHANNEL_SECRET',
    'LINE_MESSAGING_CHANNEL_SECRET',
    'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN',
    'OPENAI_API_KEY',
    'TYPHOON_OCR_API_KEY',
    'S3_SECRET_ACCESS_KEY',
  ]) {
    checkSecret(key, 'third-party');
  }

  for (const key of ['SERVICE_VERSION', 'GIT_SHA', 'PUBLIC_BASE_URL']) {
    if (missing(key)) errors.push(`${key} is required in production`);
  }

  // F1.5.1 — the launch control plane records this identity on every gate transition, so a
  // production process that never received it must not boot at all. Reported here as boot errors
  // (alongside every other production rule) and enforced again at the point of use by
  // `resolveDeploymentIdentity`, which the release-task seeder reaches without this validator.
  const identityEnv = config as Record<string, string | undefined>;
  errors.push(...deploymentIdentityGaps(identityEnv, readDeploymentIdentity(identityEnv)));

  if (config['LOG_FORMAT'] !== 'json') {
    errors.push('LOG_FORMAT must be json in production');
  }
  // L-09: debug logs carry request bodies and AI payloads into CloudWatch.
  if (config['LOG_LEVEL'] === 'debug') {
    errors.push('LOG_LEVEL must not be debug in production');
  }
  // L-08: every process that reads this switch must refuse it, not just the AI Gateway.
  if (bool(config['AI_FINAL_MUTATION_ENABLED'])) {
    errors.push('AI_FINAL_MUTATION_ENABLED must be false in production without ADR approval');
  }
  // Metering spec §7.4: the per-company override ceiling must not sit below the platform
  // default, or the default budget would itself be an illegal override value and the operator
  // could only ever lower a tenant's cap. Both keys live in the API schema alone, so
  // Number.isFinite is what scopes the rule — a config that carries neither skips it. Key
  // names only in the message: a rule must never echo the configured amounts.
  const monthlyBudget = Number(config['AI_MONTHLY_BUDGET_SATANG']);
  const monthlyBudgetCeiling = Number(config['AI_MONTHLY_BUDGET_SATANG_CEILING']);
  if (
    Number.isFinite(monthlyBudget)
    && Number.isFinite(monthlyBudgetCeiling)
    && monthlyBudgetCeiling < monthlyBudget
  ) {
    errors.push('AI_MONTHLY_BUDGET_SATANG_CEILING must be >= AI_MONTHLY_BUDGET_SATANG in production');
  }

  const cors = str(config['CORS_ALLOWED_ORIGINS']);
  if (hasKey('CORS_ALLOWED_ORIGINS') && (!cors || cors === '*' || cors.includes('*'))) {
    errors.push('CORS_ALLOWED_ORIGINS must be a non-empty, non-wildcard allowlist in production');
  }
  if (bool(config['SWAGGER_ENABLED'])) errors.push('SWAGGER_ENABLED must be false in production');
  if (config['LOG_REDACTION_ENABLED'] === false || config['LOG_REDACTION_ENABLED'] === 'false') {
    errors.push('LOG_REDACTION_ENABLED must be true in production');
  }

  if (isDataServiceConfig) {
    for (const key of ['REDIS_URL', 'S3_BUCKET']) {
      if (missing(key)) errors.push(`${key} is required in production`);
    }
    if (missing('DATABASE_URL') && missing('DATABASE_SECRET_ARN')) {
      errors.push('DATABASE_URL or DATABASE_SECRET_ARN is required in production');
    }
    if (str(config['S3_ENDPOINT'])) {
      errors.push('S3_ENDPOINT is local-only and must not be set in production');
    }
    // L-03: a production data URL must not target a local dependency, nor carry a credential
    // that has been committed. Only the userinfo segment is inspected, never the host.
    for (const key of ['DATABASE_URL', 'REDIS_URL']) {
      const url = str(config[key]);
      if (!url) continue;
      // Lowercased, because hostnames are case-insensitive and `LOCALHOST` would otherwise pass.
      // The loopback set covers the spellings a copied local URL actually arrives as.
      const lowered = url.toLowerCase();
      const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', 'host.docker.internal'];
      if (LOOPBACK_HOSTS.some((host) => lowered.includes(host))) {
        errors.push(`${key} must not point at localhost in production`);
      }
      const credentials = /\/\/([^@/]*)@/.exec(url)?.[1] ?? '';
      if (credentials && hasDenylistedToken(credentials)) {
        errors.push(`${key} embeds a known local/default credential and must be rotated in production`);
      }
    }
  }

  if (isApiConfig) {
    if (bool(config['DEV_AUTH_ENABLED'])) {
      errors.push('DEV_AUTH_ENABLED must be false in production');
    }
    if (config['AUTH_PROVIDER'] === 'dev') {
      errors.push('AUTH_PROVIDER=dev is not allowed in production');
    }
    // L-03: the seed fallback password is a local-only affordance.
    if (str(config['SEED_SYSTEM_ADMIN_PASSWORD'])) {
      errors.push('SEED_SYSTEM_ADMIN_PASSWORD must not be set in production');
    }
    for (const key of [
      'LINE_LOGIN_CHANNEL_ID',
      'LINE_LOGIN_CHANNEL_SECRET',
      'LINE_LIFF_ID',
      'LINE_MESSAGING_CHANNEL_ID',
      'LINE_MESSAGING_CHANNEL_SECRET',
      'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN',
      'AI_GATEWAY_INTERNAL_SECRET',
      'AI_ACTOR_DELEGATION_SIGNING_KEY',
      'CREDENTIAL_ENCRYPTION_KEY',
      'PDPA_PSEUDONYMIZATION_KEY',
      // M-09: non-empty means "state a decision", not "allow at least one host" — a tenant with
      // no outbound webhooks sets WEBHOOK_ALLOWLIST_DENY_ALL rather than inventing a host.
      'WORKFLOW_WEBHOOK_ALLOWED_HOSTS',
      'CLAMAV_HOST',
    ]) {
      if (missing(key)) errors.push(`${key} is required in production`);
    }
    if (
      !missing('CREDENTIAL_ENCRYPTION_KEY')
      && config['PDPA_PSEUDONYMIZATION_KEY'] === config['CREDENTIAL_ENCRYPTION_KEY']
    ) {
      errors.push('PDPA_PSEUDONYMIZATION_KEY must be independent from CREDENTIAL_ENCRYPTION_KEY');
    }
    if (
      !missing('AI_ACTOR_DELEGATION_SIGNING_KEY')
      && [
        config['AI_GATEWAY_INTERNAL_SECRET'],
        config['CREDENTIAL_ENCRYPTION_KEY'],
        config['PDPA_PSEUDONYMIZATION_KEY'],
      ]
        .includes(config['AI_ACTOR_DELEGATION_SIGNING_KEY'])
    ) {
      errors.push('AI_ACTOR_DELEGATION_SIGNING_KEY must be independent from workload and data protection keys');
    }
    if (config['AUDIT_ENABLED'] === false || config['AUDIT_ENABLED'] === 'false') {
      errors.push('AUDIT_ENABLED must be true in production');
    }
    if (!bool(config['RATE_LIMIT_ENABLED'])) {
      errors.push('RATE_LIMIT_ENABLED must be true for production API');
    }
    if (missing('RATE_LIMIT_WINDOW_SECONDS')) {
      errors.push('RATE_LIMIT_WINDOW_SECONDS is required in production');
    }
    if (missing('RATE_LIMIT_MAX_REQUESTS')) {
      errors.push('RATE_LIMIT_MAX_REQUESTS is required in production');
    }
    if (config['EMAIL_PROVIDER'] === 'ses') {
      for (const key of ['SES_REGION', 'SES_FROM_ADDRESS']) {
        if (missing(key)) errors.push(`${key} is required when EMAIL_PROVIDER=ses`);
      }
    }
  }

  // L-03: any process that resolves a JWT verification key — the API *and* the AI Gateway,
  // which falls back to DEV_AUTH_SECRET — must hold the real secret and no dev fallback.
  if (readsJwtSecret) {
    if (missing('WATCHDOG_JWT_SECRET_ARN')) {
      errors.push('WATCHDOG_JWT_SECRET_ARN is required in production');
    }
    if (str(config['DEV_AUTH_SECRET'])) {
      errors.push('DEV_AUTH_SECRET must not be set in production');
    }
    // L-04: every verifier pins iss/aud, falling back to the shared non-secret defaults. The API
    // signs with its *configured* values, so a verifier deployed without these two silently pins
    // the defaults and rejects every real token. Keyed on reading a JWT secret rather than on
    // being the API, because the AI Gateway verifies the same tokens.
    for (const key of ['WATCHDOG_JWT_ISSUER', 'WATCHDOG_JWT_AUDIENCE']) {
      if (missing(key)) errors.push(`${key} is required in production`);
    }
  }

  // L-03: workers send this token on every internal call; requiring it only for the API let a
  // production workers process boot and then authenticate with an empty token.
  if ((isApiConfig || isWorkersConfig) && missing('WORKER_INTERNAL_TOKEN')) {
    errors.push('WORKER_INTERNAL_TOKEN is required in production');
  }

  if (isWorkersConfig) {
    const servingMode = str(config['PRODUCTION_SERVING_MODE']);
    if (servingMode !== 'live' && servingMode !== 'maintenance_only') {
      errors.push('PRODUCTION_SERVING_MODE must be exactly live or maintenance_only for production workers');
    } else if (bool(config['QUEUE_ENABLED']) !== (servingMode === 'live')) {
      errors.push(`QUEUE_ENABLED must be ${servingMode === 'live'} when PRODUCTION_SERVING_MODE=${servingMode}`);
    }
  }

  if (isAiConfig) {
    const aiToolsEnabled =
      bool(config['AI_GATEWAY_ENABLED']) ||
      bool(config['AI_AGENT_REGISTRY_ENABLED']) ||
      str(config['MODEL_PROVIDER']) !== 'disabled';

    if (aiToolsEnabled && !bool(config['AI_TOOL_POLICY_ENFORCED'])) {
      errors.push('AI_TOOL_POLICY_ENFORCED must be true when AI tools are enabled');
    }
    if (aiToolsEnabled && !bool(config['AI_TOOL_AUDIT_ENABLED'])) {
      errors.push('AI_TOOL_AUDIT_ENABLED must be true when AI tools are enabled');
    }
    if (bool(config['AI_PROMPT_LOGGING_ENABLED'])) {
      errors.push('AI_PROMPT_LOGGING_ENABLED must be false in production');
    }
    if (missing('AI_GATEWAY_INTERNAL_SECRET')) {
      errors.push('AI_GATEWAY_INTERNAL_SECRET is required in production');
    }
    if (str(config['MODEL_PROVIDER']) === 'openai' && missing('OPENAI_API_KEY')) {
      errors.push('OPENAI_API_KEY is required when MODEL_PROVIDER=openai');
    }
    if (str(config['MODEL_PROVIDER']) === 'openai' && missing('OPENAI_PROCESSING_REGION')) {
      errors.push('OPENAI_PROCESSING_REGION is required when MODEL_PROVIDER=openai');
    }
    if (str(config['MODEL_PROVIDER']) === 'bedrock' && (missing('BEDROCK_REGION') || missing('BEDROCK_MODEL_ID'))) {
      errors.push('BEDROCK_REGION and BEDROCK_MODEL_ID are required when MODEL_PROVIDER=bedrock');
    }
    const approvedProviders = str(config['APPROVED_AI_PROVIDERS']).split(',').map((value) => value.trim()).filter(Boolean);
    const approvedModels = str(config['APPROVED_AI_MODEL_IDS']).split(',').map((value) => value.trim()).filter(Boolean);
    const approvedRegions = str(config['APPROVED_AI_REGIONS']).split(',').map((value) => value.trim()).filter(Boolean);
    const provider = str(config['MODEL_PROVIDER']);
    const modelId = provider === 'bedrock' ? str(config['BEDROCK_MODEL_ID']) : provider === 'openai' ? str(config['OPENAI_MODEL']) : '';
    const region = provider === 'bedrock' ? str(config['BEDROCK_REGION']) : provider === 'openai' ? str(config['OPENAI_PROCESSING_REGION']) : '';
    // A `global.` Bedrock profile may route the turn outside the approved region, so it is
    // refused unless the cross-border transfer has been approved AND the approval is
    // identifiable. Requiring the reference is what keeps this auditable rather than a
    // silent kill switch: the flag alone would let anyone reopen the boundary with no owner.
    const globalProfileApproved = bool(config['AI_GLOBAL_INFERENCE_PROFILE_APPROVED']);
    const globalProfileApprovalRef = str(config['AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF']).trim();
    const globalProfileAllowed = globalProfileApproved && globalProfileApprovalRef !== '';
    if (globalProfileApproved && globalProfileApprovalRef === '') {
      errors.push(
        'AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF is required when AI_GLOBAL_INFERENCE_PROFILE_APPROVED=true (record the data-protection approval reference)',
      );
    }
    if (!globalProfileAllowed && approvedModels.some((approvedModel) => approvedModel.startsWith('global.'))) {
      errors.push('global Bedrock inference profiles must not appear in the production model allowlist');
    }
    if (provider !== 'disabled' && !approvedProviders.includes(provider)) errors.push('MODEL_PROVIDER is not approved');
    if (modelId && !approvedModels.includes(modelId)) errors.push('configured AI model is not approved');
    if (region && !approvedRegions.includes(region)) errors.push('configured AI processing region is not approved');
    if (!globalProfileAllowed && provider === 'bedrock' && modelId.startsWith('global.')) {
      errors.push('global Bedrock inference profiles are not allowed in production; use an approved geographic or regional profile');
    }
    if (str(config['DOCUMENT_AI_MODEL_ID']) && !approvedModels.includes(str(config['DOCUMENT_AI_MODEL_ID']))) {
      errors.push('DOCUMENT_AI_MODEL_ID is not approved');
    }
    if (!missing('TYPHOON_OCR_API_KEY') && missing('TYPHOON_PROCESSING_REGION')) {
      errors.push('TYPHOON_PROCESSING_REGION is required when Typhoon OCR is enabled');
    }
    if (!missing('TYPHOON_OCR_API_KEY') && !approvedProviders.includes('typhoon')) {
      errors.push('Typhoon OCR provider is not approved');
    }
    if (str(config['TYPHOON_PROCESSING_REGION']) && !approvedRegions.includes(str(config['TYPHOON_PROCESSING_REGION']))) {
      errors.push('Typhoon OCR processing region is not approved');
    }
    if (str(config['LINE_AI_AGENT_RUNTIME']) === 'agentcore') {
      for (const key of ['AGENTCORE_REGION', 'AGENTCORE_RUNTIME_ARN', 'AGENTCORE_RUNTIME_QUALIFIER']) {
        if (missing(key)) errors.push(`${key} is required when LINE_AI_AGENT_RUNTIME=agentcore`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Production config validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }
}

// ─── Shared deep log redaction (L-09) ─────────────────────────────────────────

/**
 * Key-name pattern for the one shared log redactor: auth material, internal secrets, AI
 * prompts, and the personal-data keys that must not reach the log pipeline. Substring
 * matching is deliberate, so `idToken`, `internalSecret`, and `signingKey` are all covered.
 *
 * Log pipeline only. The audit trail keeps personal data until an erasure request (L-11).
 */
export const SENSITIVE_LOG_KEY_PATTERN =
  /authorization|passwd|password|token|secret|cookie|key|credential|signature|hmac|jwt|bearer|prompt|actordelegation|phone|email|lineuserid|nationalid|taxid|idcardnumber|address|displayname/i;

const REDACTED = '[REDACTED]';
// ponytail: depth 6 covers err.meta.cause.detail nesting; deeper is truncated, not dropped
const MAX_REDACT_DEPTH = 6;
// `scheme://user:pass@host` anywhere in a string — driver errors carry the whole DSN.
const URL_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi;

function scrubSecretsInString(value: string): string {
  return value.replace(URL_CREDENTIALS_PATTERN, `$1${REDACTED}@`);
}

function redactWalk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubSecretsInString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  if (depth >= MAX_REDACT_DEPTH) return '[TRUNCATED]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => redactWalk(entry, depth + 1, seen));
    if (value instanceof Error) {
      // message/stack are non-enumerable, so an Error needs an explicit shape.
      return {
        name: value.name,
        message: scrubSecretsInString(value.message),
        ...(value.stack === undefined ? {} : { stack: scrubSecretsInString(value.stack) }),
        ...(redactWalk({ ...value }, depth, seen) as Record<string, unknown>),
      };
    }
    // ponytail: only plain objects are walked; Date/Buffer/class instances pass through as-is
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_LOG_KEY_PATTERN.test(key) ? REDACTED : redactWalk(entry, depth + 1, seen),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}

/**
 * Deep, key-pattern log redactor shared by the API, AI Gateway, and workers log pipelines.
 * Recursive, depth-capped, cycle-safe, and never mutates its input.
 */
export function redactLogValue<T>(value: T): T {
  return redactWalk(value, 0, new WeakSet()) as T;
}

// ─── Legacy alias ─────────────────────────────────────────────────────────────
// ponytail: kept for any existing import; remove when callers are updated
export const serviceEnvSchema = apiConfigSchema;
export type ServiceEnv = ServiceConfig;
