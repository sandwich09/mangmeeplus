import { z } from 'zod';

const envBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}, z.boolean());

// Reliability v2 readers and writers must parse the same rollout contract in both services.
// Empty adds no rollout restriction; current owner/channel authorization still applies.
// Nonempty lists are exact restrictions; wildcards and malformed IDs are rejected.
const lineAiIdAllowlist = z.string().default('').transform((value, ctx) => {
  if (value.trim() === '') return [];
  const ids = value.split(',').map((entry) => entry.trim());
  if (ids.some((id) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected comma-separated company or messaging channel IDs without wildcards or empty entries' });
    return z.NEVER;
  }
  return [...new Set(ids)];
});

/** Rollout restriction only; callers must still enforce current access and channel binding. */
export function isLineAiRolloutAllowed(ids: readonly string[], id: string): boolean {
  return id.trim().length > 0 && (ids.length === 0 || ids.includes(id));
}

const lineAiReliabilityConfigShape = {
  LINE_AI_RELIABILITY_V2_MODE: z.enum(['off', 'shadow', 'on']).default('on'),
  LINE_AI_RELIABILITY_V2_COMPANY_IDS: lineAiIdAllowlist,
  LINE_AI_DELIVERY_PLAN_V2_ENABLED: envBoolean.default(true),
  LINE_AI_DELIVERY_PLAN_V2_WRITE_COMPANY_IDS: lineAiIdAllowlist,
  LINE_AI_DELIVERY_PLAN_V2_PUBLIC_CHANNEL_IDS: lineAiIdAllowlist,
  LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED: envBoolean.default(true),
  LINE_AI_DOCUMENT_QA_ENABLED: envBoolean.default(true),
  LINE_AI_APPROVED_KNOWLEDGE_ENABLED: envBoolean.default(true),
  LINE_AI_PUBLIC_LOOKUP_ENABLED: envBoolean.default(false),
  LINE_AI_PREFERENCES_ENABLED: envBoolean.default(true),
};

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
  ...lineAiReliabilityConfigShape,
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
  // P12-1 web LINE login (OAuth Authorization Code + PKCE). Default OFF: the login-channels
  // contract keeps reporting `line` unavailable and the callback endpoint stays 403 until an
  // environment turns this on with both channel id and secret present.
  LINE_WEB_LOGIN_ENABLED: envBoolean.default(false),
  EXTERNAL_SIGNUP_ENABLED: envBoolean.default(false),
  // P12-3b LINE → web deep-link session handoff. Default OFF: with it off no token is ever minted,
  // every LINE link keeps the plain URL it has today, and the exchange endpoint stays 403 — so the
  // observable behaviour is byte-identical to the release before it. Rollout is additionally gated
  // on the UAT link-preview measurement (spec §17 Q2 / G7).
  LINE_WEB_HANDOFF_ENABLED: envBoolean.default(false),
  // P10-L LINE-first signup. Default OFF everywhere: with it off the LIFF endpoints answer 403
  // `line_signup_disabled` and no `line-oa` row can be created, which is the whole rollback.
  LINE_SIGNUP_ENABLED: envBoolean.default(false),
  // MANUAL = every application waits for the admin queue. AUTO_FREE skips the queue up to the daily
  // cap. An unknown value FAILS the schema rather than degrading to the more permissive mode.
  LINE_SIGNUP_APPROVAL_MODE: z.enum(['MANUAL', 'AUTO_FREE']).default('MANUAL'),
  LINE_SIGNUP_AUTO_DAILY_CAP: z.coerce.number().int().nonnegative().default(20),
  // First-week slip ceiling for a LINE trial shop, below its tier's own limit (spec §9).
  LINE_SIGNUP_WARMUP_SLIPS: z.coerce.number().int().positive().default(15),
  // Per-shop AI spend cap for a free trial, in satang. 8000 = ฿80/month, Owner 2026-09-04 from the
  // production meter: a stop, not an expected bill (a normal trial shop spends ฿15–25).
  LINE_FREE_AI_BUDGET_SATANG: z.coerce.number().int().positive().default(8000),
  LINE_SIGNUP_ADMIN_REMINDER_MINUTES: z.coerce.number().int().positive().default(60),
  // §15.6/§15.7: how many trial shops must exhaust their AI budget in one Bangkok day before the
  // operators are told. One shop is a customer being enthusiastic; five is a pricing or abuse
  // signal. Positive on purpose — 0 would alert on a day nothing happened.
  LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY: z.coerce.number().int().positive().default(5),
  // Hold-reconciliation spec §5: how old an UNRESOLVED hold has to be before the 15-minute sweep
  // announces it. Held credit is money the shop cannot use, so the default is one day — long enough
  // that a slow settlement is never announced, short enough that nobody waits a week.
  AI_CREDIT_HOLD_ALERT_AFTER_HOURS: z.coerce.number().int().positive().default(24),
  // Asia/Bangkok office window the "within a business day" promise is measured against.
  // Days are a MON..SUN range; hours are HH:MM-HH:MM on a 24h clock.
  LINE_SIGNUP_BUSINESS_DAYS: z.string().regex(/^(MON|TUE|WED|THU|FRI|SAT|SUN)-(MON|TUE|WED|THU|FRI|SAT|SUN)$/).default('MON-SAT'),
  LINE_SIGNUP_BUSINESS_HOURS: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/).default('09:00-18:00'),
  // Review G-01: the monthly slip ceiling has never been enforced anywhere, so switching it on is
  // the first time EVERY existing shop meets a limit. Separate from the signup flag on purpose.
  RECEIPT_QUOTA_ENFORCED: envBoolean.default(false),
  LINE_LIFF_ID: z.string().optional(),
  LINE_MESSAGING_CHANNEL_ID: z.string().optional(),
  LINE_MESSAGING_CHANNEL_SECRET: z.string().optional(),
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  LINE_OFFICIAL_REPLY_ENABLED: envBoolean.default(false),
  LINE_OFFICIAL_CHANNEL_SECRET: z.string().optional(),
  LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  // LINE AI message buffering (docs/specs/line-ai-message-buffering-spec.md §13)
  LINE_AI_BUFFER_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(2000),
  LINE_AI_BUFFER_MAX_WAIT_MS: z.coerce.number().int().positive().default(8000),
  LINE_AI_LOADING_ANIMATION_ENABLED: envBoolean.default(true),
  // LINE AI latency/autonomy Phase 1 (docs/specs/line-ai-latency-and-autonomy-lanes-spec.md §10/§15).
  // Both default OFF so the effective 2,000 ms path and processing-start loading are unchanged.
  // On, loading is requested once per 1:1 chat right after durable acceptance (before the debounce
  // wait). The debounce experiment assigns a stable per-(company,chat) cohort by HMAC; the secret is
  // required for any assignment to happen, and neither identifiers nor the HMAC bytes are logged.
  LINE_AI_LOADING_ON_ACCEPT_ENABLED: envBoolean.default(false),
  LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED: envBoolean.default(false),
  LINE_AI_DEBOUNCE_EXPERIMENT_SECRET: z.string().optional(),
  // Latency/autonomy Phase 3: default OFF. On, the API forwards the intake route's bounded prepared
  // plan into LineAiTurnRequest for the gateway's shadow comparison (never for execution; §3 plan).
  LINE_AI_FUSED_PLAN_SHADOW_ENABLED: envBoolean.default(false),
  // Latency/autonomy Phase 4: default OFF. On, the API also forwards the prepared plan so the gateway
  // may consume it for a one-call simple read; forwarding is OR-gated with the shadow flag so the two
  // gateway lanes stay independent (the gateway alone decides whether to execute from it).
  // Owner policy 2026-09-27: defaults ON, no manual rollout gate (spec R-L4).
  LINE_AI_PREPARED_SIMPLE_READ_ENABLED: envBoolean.default(true),
  // Substitute-receipt semantic routing mode (substitute-semantic-routing spec §7). Default 'off' keeps
  // the EXACT legacy regex-first behavior; 'primary' makes the semantic route authoritative (narrow
  // canonical fallback only on UNAVAILABLE). 'shadow' is a reserved NO-GO scaffold: the legacy path
  // short-circuits before the router, so a real nonblocking compare cannot run safely in a serverless
  // webhook lifecycle — 'shadow' therefore behaves EXACTLY like 'off' and is intentionally inert (it must
  // never fake agreement). Offline provider replay measures agreement instead.
  LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE: z.enum(['off', 'shadow', 'primary']).default('off'),
  // Expense-vs-reimbursement semantic intake (uat-correctness-latency spec §7/§15). Default 'off' keeps
  // the EXACT legacy intake prompt/parser. 'clarify_only' and 'handoff' are the ONLY modes that turn on
  // the trusted `reimbursementSemantic` router capability (semanticOutcome, fundingSource,
  // REIMBURSEMENT_REQUEST_START): 'clarify_only' keeps reimbursement/ambiguous text out of expense
  // capture with no handoff CTA, 'handoff' additionally sends the permission-checked handoff card.
  // 'shadow' is a reserved NO-GO scaffold for exactly the substitute reason above: the legacy capture
  // path resolves the turn before a comparison could be drawn, so a safe nonblocking compare cannot run
  // in this serverless webhook lifecycle. 'shadow' therefore behaves EXACTLY like 'off' — it grants no
  // capability and logs nothing new — and is intentionally inert (it must never fake agreement). Offline
  // replay of the frozen corpus against the configured provider supplies the agreement evidence instead.
  // No mode ever creates a reimbursement record. Rollback target for every primary mode is
  // 'clarify_only', not 'off'.
  LINE_AI_REIMBURSEMENT_SEMANTIC_MODE: z.enum(['off', 'shadow', 'clarify_only', 'handoff']).default('off'),
  // DB-backed neutral intake state for financial clarifications (uat-correctness-latency spec §8.3,
  // plan Phase 1A). Default 'off' is behavior-identical to today in every byte: the repository is
  // never called and the Redis ledger remains the only continuation state. 'shadow' writes and reads
  // the durable state and logs where it DIVERGES from the ledger's view, but the reply, the writes
  // and the consumption are decided exactly as 'off' decides them — it is a measurement lane, not a
  // behavior lane. 'on' makes the durable state authoritative for a financial clarification
  // continuation, which is what buys the four §8.3 zero-write guarantees: a state-store outage, a
  // stale/expired version, another member, or another chat/company all refuse and write NOTHING.
  // Membership is checked POSITIVELY ('shadow'/'on'), so an unset or unparsed value stays off —
  // this store fails CLOSED, unlike the ledger it backstops.
  LINE_AI_INTAKE_STATE_MODE: z.enum(['off', 'shadow', 'on']).default('off'),
  // Advisor conversation staged rollout (advisor spec §17). ONE capability enum plus ONE execution kill
  // switch, deliberately not a flag per feature. 'off' is behavior-identical to today in every byte: the
  // API never turns the `advisor` router capability on, so the intake prompt/payload/parser stay legacy.
  // 'social' is the only stage Slice A builds toward (SOCIAL_CHAT); 'knowledge' and 'company' are parsed
  // here so the env contract is stable, but their semantics/renderers do not exist yet and their
  // activation gates (spec §18) are unmet — do not set them. An unknown value FAILS the schema (closed),
  // never silently degrading to a more permissive stage. Rollback goes one stage back, or to 'off'.
  LINE_AI_ADVISOR_MODE: z.enum(['off', 'social', 'knowledge', 'company']).default('off'),
  // Execution kill switch, separate from the staged enum so the measurement cohort (mode >= 'social' with
  // this false: the router emits and the server validates an advisorAnswer, but the reply still comes from
  // the existing reference path) can be turned on and off without touching the stage. RESERVED / INERT in
  // Slice A: no consumer reads it yet — the prepared direct-answer lane is a later phase.
  LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED: envBoolean.default(false),
  // Persist exact terminal outcomes before send and replay saved bytes by default.
  // An explicit false retains the legacy path; persistence failure stays fail-closed.
  LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED: envBoolean.default(true),
  // Flex→text delivery fallback (§14.3, reliability R4/E4). Default OFF is byte-identical: a LINE 400
  // that rejects a Flex payload takes the same push path a rejected reply token takes and, when that
  // fails too, ends as `delivery_pending`. ON, the payload is re-sent ONCE as each Flex message's own
  // `altText` — LINE's designated plain-text equivalent, written by the same builder that wrote the
  // bubble — so a renderer-shaped rejection still delivers the answer instead of silence. Never a
  // second model call and never invented copy.
  LINE_AI_FLEX_TEXT_FALLBACK_ENABLED: envBoolean.default(false),
  // Durable multi-turn expense draft collection. Default off until recorded LINE OA UAT passes.
  LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED: envBoolean.default(false),
  // S-4 (draft-control spec §8): editing a captured draft over LINE — preview card, confirm
  // postback, apply. Enabled by default; explicit OFF removes the tools from the catalog,
  // refuses execution and suppresses preview cards. Permission and confirmation gates remain.
  LINE_AI_DRAFT_EDIT_ENABLED: envBoolean.default(true),
  // Item 10F: LINE AI turn ledger on Redis Streams (ADR 0010; fail-open, default off)
  LINE_AI_LEDGER_ENABLED: envBoolean.default(false),
  LINE_AI_LEDGER_MAXLEN: z.coerce.number().int().positive().default(200),
  LINE_AI_LEDGER_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  LINE_AI_LEDGER_CLAIM_MIN_IDLE_MS: z.coerce.number().int().positive().default(120000),
  LINE_AI_LEDGER_DELIVERY_CAP: z.coerce.number().int().positive().default(3),
  AI_DATA_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).default(90),
  // Buyer expense capture (contract appendix §6). The intake gate is the only one of the four
  // wired into deploy.sh: closing it refuses NEW groups and files while every existing group
  // stays readable and every queued read still finishes (A47). ON by default, like the rest of
  // the receipt lane — a shop that can upload a receipt today can upload two tomorrow.
  EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED: envBoolean.default(true),
  // Pages one file is read automatically up to (§4.1). Past it the job PAUSES with `page_limit`
  // and keeps what it read; it never truncates a document silently. Declared scope, not an SLA.
  EXPENSE_CAPTURE_PDF_MAX_PAGES: z.coerce.number().int().min(1).max(200).default(60),
  // Read jobs one API process runs at once (§4.5). Small on purpose: each job holds a whole
  // PDF and its rendered pages in memory.
  EXPENSE_CAPTURE_READ_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  // Days a group with no financial document keeps its files before the retention sweep deletes
  // them (§8, D08 default = AI_DATA_RETENTION_DAYS). Files an expense or certificate references
  // are never swept, whatever this says.
  EXPENSE_CAPTURE_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  // Bytes of DERIVATIVES (copied chunks, rendered pages, tiles) one read job may produce in total
  // before it pauses with `memory_budget` (§4.5 "ประมวลผลทีละ chunk"). The per-call ceilings bound
  // one payload; this bounds the whole job, so a 60-page scan cannot walk a process out of memory
  // one legal chunk at a time.
  EXPENSE_CAPTURE_DERIVATIVE_MAX_BYTES: z.coerce.number().int().min(4_000_000).max(1_073_741_824).default(67_108_864),
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
  EMAIL_PROVIDER: z.enum(['disabled', 'local-console', 'ses', 'postmark']).default('disabled'),
  BILLING_MODE: z.enum(['disabled', 'test', 'live']).default('disabled'),
  STRIPE_ACCOUNT_ID: z.string().regex(/^acct_[a-zA-Z0-9]+$/).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  POSTMARK_SERVER_ID: z.coerce.number().int().positive().optional(),
  POSTMARK_MESSAGE_STREAM: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('outbound'),
  POSTMARK_FROM_ADDRESS: z.string().email().optional(),
  POSTMARK_FROM_NAME: z.string().max(80).regex(/^[^<>\r\n]*$/).default('Mangmee Plus'),
  POSTMARK_UAT_ALLOWED_RECIPIENTS: z.string().default(''),
  POSTMARK_WEBHOOK_USERNAME: z.string().optional(),
  POSTMARK_WEBHOOK_PASSWORD: z.string().optional(),
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
  EMAIL_OTP_HMAC_KEY: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  EMAIL_OTP_HMAC_KEY_VERSION: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).optional(),
  EMAIL_VERIFICATION_REQUEST_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  EMAIL_VERIFICATION_CONFIRM_MAX_PER_IP: z.coerce.number().int().positive().default(10),
  EMAIL_VERIFICATION_CONFIRM_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  LINE_LOGIN_CALLBACK_MAX_PER_IP: z.coerce.number().int().positive().default(10),
  LINE_LOGIN_CALLBACK_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  LINE_QR_CREATE_MAX_PER_IP: z.coerce.number().int().positive().default(10),
  LINE_QR_CREATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  // The desktop polls every 2.5s for the 180s QR lifetime, so one full transaction costs ~72.
  LINE_QR_POLL_MAX_PER_IP: z.coerce.number().int().positive().default(90),
  LINE_QR_POLL_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // P12-3b: the handoff exchange is unauthenticated and the token is the only credential, so the
  // bucket bounds guessing. One tap costs one call; the allowance covers a household behind one NAT.
  LINE_HANDOFF_EXCHANGE_MAX_PER_IP: z.coerce.number().int().positive().default(20),
  LINE_HANDOFF_EXCHANGE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
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
  APPROVED_AI_PROVIDERS: z.string().default('bedrock,openai'),
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
  ...lineAiReliabilityConfigShape,
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  APPROVED_AI_MODEL_IDS: z.string().default(DEFAULT_APPROVED_AI_MODEL_IDS),
  APPROVED_AI_PROVIDERS: z.string().default('bedrock,openai'),
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
  AI_GATEWAY_ENABLED: envBoolean.default(false),
  AI_AGENT_REGISTRY_ENABLED: envBoolean.default(false),
  AI_TOOL_POLICY_ENFORCED: envBoolean.default(true),
  AI_TOOL_AUDIT_ENABLED: envBoolean.default(true),
  AI_FINAL_MUTATION_ENABLED: envBoolean.default(false),
  AI_PROMPT_LOGGING_ENABLED: envBoolean.default(false),
  // M-01: the API issues at most eight single-use delegations for any one tool.
  AI_MAX_TOOL_CALLS: z.coerce.number().int().positive().max(8).default(8),
  AI_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // Item 10B: local agent orchestration. Owner 2026-09-29 ("no more switches; always on"): defaults ON. The
  // gateway reads it only to pick the legacy deterministic path (maintenance serving sets it false); the
  // AgentCore runtime never reads it. The capability keys below are no longer read by any code — the turn
  // path is always on — and stay parseable only so existing deployment envs keep validating.
  LINE_AI_AGENT_ORCHESTRATION_ENABLED: envBoolean.default(true),
  LINE_AI_AGENT_RUNTIME: z.enum(['strands-local', 'disabled', 'agentcore']).default('disabled'),
  // Item 10F: native tool-use loop + coverage critic — always on in code (owner 2026-09-29); unread.
  LINE_AI_TOOLUSE_LOOP_ENABLED: envBoolean.default(true),
  LINE_AI_COVERAGE_CRITIC_ENABLED: envBoolean.default(true),
  // Latency/autonomy Phases 3–6 (docs/plans/line-ai-latency-and-autonomy-lanes-plan.md). All DEFAULT
  // OFF / empty; off restores the current second-router + composer/critic path. Phase 3 shadow only
  // compares (never executes); Phase 4 consumes a server-eligible prepared plan but a family must also
  // be allow-listed by Phase 5 (empty default → no simple read is deterministic-eligible).
  LINE_AI_FUSED_PLAN_SHADOW_ENABLED: envBoolean.default(false),
  // Owner policy 2026-09-27: defaults ON, no manual rollout gate (spec R-L4).
  LINE_AI_PREPARED_SIMPLE_READ_ENABLED: envBoolean.default(true),
  // Same switch as the API's, read here so the five `draft_update` tools are absent from the
  // catalog the model is offered when it is off — "refused later" would still have advertised an
  // ability this deployment does not have. Both containers carry it (deploy.sh).
  LINE_AI_DRAFT_EDIT_ENABLED: envBoolean.default(true),
  // Exact family allowlist (comma-separated; empty = none enabled). Only families with a verified
  // deterministic formatter + fixed fixture and passed blind pairwise eval belong here. Spec R-L4:
  // code default and the UAT/production override use the same list (docs/specs/mangmee-ai-expense-
  // advisor-spec-th.md §5) — the four families already active plus list_recent::list, get_breakdown::
  // list, and both reimbursement families.
  LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES: z.string().default('sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric,expense.list_recent::list,expense.get_breakdown::list,reimbursement.list_pending_approvals::list,reimbursement.get_summary::single_metric,expense.get_detail::single_metric,reimbursement.get_detail::single_metric'),
  // Phase 6 secondary runtime experiments. RESERVED / INERT: these three flags parse and expose getters
  // but are NOT wired to any behavior yet — toggling them changes nothing at runtime. They exist so the
  // env contract is stable ahead of the wiring; keep them default-false and do not document them as active
  // levers until a consumer reads the getter. Their config-parse tests assert only the default/coercion.
  LINE_AI_PROVIDER_CLIENT_REUSE_ENABLED: envBoolean.default(false),
  LINE_AI_AGENTCORE_SESSION_AFFINITY_ENABLED: envBoolean.default(false),
  LINE_AI_SMALL_ROUTER_SHADOW_ENABLED: envBoolean.default(false),
  AWS_PROFILE: z.string().optional(),
  AWS_SDK_LOAD_CONFIG: envBoolean.default(false),
  // AgentCore runtime invoke config (used when LINE_AI_AGENT_RUNTIME=agentcore)
  AGENTCORE_REGION: z.string().optional(),
  AGENTCORE_RUNTIME_ARN: z.string().optional(),
  AGENTCORE_RUNTIME_QUALIFIER: z.string().optional(),
  AGENTCORE_EXPECTED_SOURCE_COMMIT: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  AGENTCORE_EXPECTED_ARTIFACT_SHA256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  AGENTCORE_EXPECTED_CONTRACT_VERSION: z.coerce.number().int().positive().optional(),
  AGENTCORE_INVOKE_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  // L-12: AgentCore invocation bounds. Enforced while streaming, never after buffering.
  AGENTCORE_MAX_BODY_BYTES: z.coerce.number().int().positive().default(1048576),
  AGENTCORE_MAX_MESSAGE_CHARS: z.coerce.number().int().positive().default(8000),
  AGENTCORE_MAX_ATTACHMENTS: z.coerce.number().int().positive().default(10),
  AGENTCORE_MAX_CONCURRENT_INVOCATIONS: z.coerce.number().int().positive().default(16),
  // Hold-reconciliation spec §3: on SIGTERM the gateway waits for guarded provider calls to finish
  // and then flushes its settle-evidence queue, within this budget. It MUST stay below the
  // container's stop timeout, or the runtime SIGKILLs mid-flush and the wait made things worse.
  // `infra/prod-ecs-express/deploy.sh` sets no `stopTimeout` on the Express `primaryContainer` (the
  // shape has no such field), so the live gateway gets ECS's own 30-second default — hence 20s.
  AI_GATEWAY_SHUTDOWN_DRAIN_MS: z.coerce.number().int().positive().max(110_000).default(20_000),
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
}).superRefine((config, ctx) => {
  if (config.ANTHROPIC_API_KEY !== undefined && config.APP_ENV !== 'local') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ANTHROPIC_API_KEY'], message: 'ANTHROPIC_API_KEY is local only (APP_ENV must be local).' });
  }
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

  if (isApiConfig && bool(config['LINE_OFFICIAL_REPLY_ENABLED'])) {
    for (const key of ['LINE_OFFICIAL_CHANNEL_SECRET', 'LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN']) {
      if (!str(config[key]).trim()) errors.push(`${key} is required when Official OA replies are enabled`);
    }
    if (!str(config['WEB_BASE_URL']).startsWith('https://')) {
      errors.push('WEB_BASE_URL must use HTTPS when Official OA replies are enabled');
    }
  }

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
    'LINE_OFFICIAL_CHANNEL_SECRET',
    'LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN',
    'OPENAI_API_KEY',
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
    if (config['EMAIL_PROVIDER'] === 'local-console') {
      errors.push('EMAIL_PROVIDER=local-console is allowed only when APP_ENV=local');
    }
    if (config['EMAIL_PROVIDER'] === 'ses') {
      for (const key of ['SES_REGION', 'SES_FROM_ADDRESS', 'WEB_BASE_URL']) {
        if (missing(key)) errors.push(`${key} is required when EMAIL_PROVIDER=ses`);
      }
    }
  }

  // The API requires its signing key. The AI Gateway can omit it: internal routes use service
  // authentication, and the JWT guard refuses protected routes when no key is configured.
  if (readsJwtSecret) {
    if ((isApiConfig || !isAiConfig) && missing('WATCHDOG_JWT_SECRET_ARN')) {
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
    if (str(config['LINE_AI_AGENT_RUNTIME']) === 'agentcore') {
      for (const key of ['AGENTCORE_REGION', 'AGENTCORE_RUNTIME_ARN', 'AGENTCORE_RUNTIME_QUALIFIER',
        'AGENTCORE_EXPECTED_SOURCE_COMMIT', 'AGENTCORE_EXPECTED_ARTIFACT_SHA256',
        'AGENTCORE_EXPECTED_CONTRACT_VERSION']) {
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
  /authorization|passwd|password|token|secret|cookie|key|credential|signature|hmac|jwt|bearer|otp|nonce|^code$|prompt|actordelegation|phone|email|lineuserid|nationalid|taxid|idcardnumber|address|displayname/i;

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
        SENSITIVE_LOG_KEY_PATTERN.test(key) && !(key === 'code' && typeof entry === 'string' && /^P\d{4}$/.test(entry))
          ? REDACTED : redactWalk(entry, depth + 1, seen),
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
