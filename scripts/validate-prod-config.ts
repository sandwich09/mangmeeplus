// ponytail: minimal script; runs via `pnpm config:validate` (tsx)
//
// PRE-DEPLOY PREFLIGHT — validate the environment you are about to ship:
//   pnpm config:validate .env.production
//   pnpm config:validate infra/uat.env --service ai-gateway
//   pnpm config:validate --process-env --service workers
// It runs exactly what boot runs (the service's own schema `parse`, then
// `validateProductionConfig` on the parsed result) and exits non-zero on any failure, so a
// missing key or a weak secret is a red preflight instead of a failed deploy. Only key names are
// printed — never a value, and never a fragment of one.
//
// SELF-TEST — no arguments runs the fixture suite that proves the rule engine itself is intact:
//   pnpm config:validate
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import {
  SENSITIVE_LOG_KEY_PATTERN,
  aiGatewayConfigSchema,
  apiConfigSchema,
  resolveDeploymentIdentity,
  validateProductionConfig,
  workersConfigSchema,
} from '../packages/config/src/index.ts';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${(err as Error).message}`);
    failed++;
  }
}

// ─── Preflight: validate a REAL environment the way boot does ─────────────────

/** Every service that validates config at boot, keyed by the SERVICE_NAME it boots under. */
const SCHEMAS = {
  api: apiConfigSchema,
  'ai-gateway': aiGatewayConfigSchema,
  workers: workersConfigSchema,
} as const;
type Service = keyof typeof SCHEMAS;

// The env file is a positional path on purpose: `--env-file` is one of node's own flags, and tsx
// forwards it to node, which then tries to load the file itself instead of handing it to us.
const USAGE = `Usage:
  pnpm config:validate                                self-test the L-03 rule engine (fixtures)
  pnpm config:validate <env-file> [--service <name>]  preflight an env file
  pnpm config:validate --process-env [--service ...]  preflight this process's environment

  --service   ${Object.keys(SCHEMAS).join(' | ')}   (default: SERVICE_NAME from the environment)

Exit code 0 = safe to deploy this environment, non-zero = do not deploy.`;

/**
 * Values that must never be echoed: the secret-shaped keys the log redactor already knows about,
 * plus the URLs/ARNs that carry a credential inside them. Longest first, so a short value cannot
 * chop a longer one into a partially-readable fragment.
 *
 * No message printed today carries a value — the rule engine names keys only, and the zod messages
 * this reaches quote a value only for enums, none of which is a secret. This is the guard that
 * keeps it that way when a schema message eventually starts quoting what it received; the
 * self-test below asserts the property on the report text either way.
 */
function secretValues(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([key, value]) =>
      typeof value === 'string'
      && value.length >= 4
      && (SENSITIVE_LOG_KEY_PATTERN.test(key) || /_(URL|ARN)$/i.test(key)))
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
}

/**
 * Returns the report instead of printing it, so the self-test below can assert that no secret
 * value (and no fragment of one) ever reaches the output.
 */
function preflight(service: Service, env: Record<string, string>, source: string): { ok: boolean; lines: string[] } {
  const secrets = secretValues(env);
  const scrub = (line: string) => secrets.reduce((acc, value) => acc.split(value).join('***'), line);
  const lines = [`\nProduction Config Preflight — service: ${service}, source: ${source}\n`];

  // Phase 1 is the schema, exactly as at boot: the process throws here before any production rule
  // is reached, so a schema failure stops the preflight the same way.
  const parsed = SCHEMAS[service].safeParse(env);
  if (!parsed.success) {
    lines.push(`  ✗ schema (${service} refuses to boot on this):`);
    for (const issue of parsed.error.issues) lines.push(scrub(`      - ${issue.path.join('.') || '(config)'}: ${issue.message}`));
    lines.push('', '  Fix the keys above in the deploy environment, then re-run. Production rules were not',
      '  reached: the schema has to pass first, exactly as at boot.');
    return { ok: false, lines };
  }
  lines.push('  ✓ schema');

  if (parsed.data.APP_ENV !== 'production') {
    // One rule still applies outside production, and only `resolveDeploymentIdentity` owns it: a
    // local-mode process must not CLAIM `uat`/`production`. The raw env is passed, not the parsed
    // data, because the schema defaults an absent key to `local` — an absent key is not a claim.
    try {
      resolveDeploymentIdentity(env);
    } catch (err) {
      lines.push('  ✗ deployment identity:');
      for (const line of (err as Error).message.split('\n').slice(1)) lines.push(scrub(`    ${line}`));
      lines.push('', '  APP_ENV decides the security mode; DEPLOY_ENVIRONMENT records which deployment this is.',
        '  Set APP_ENV=production for a uat/production task definition, or drop the claim.');
      return { ok: false, lines };
    }
    lines.push(
      `  – production rules skipped: APP_ENV=${parsed.data.APP_ENV}`,
      '',
      '  This run proves the shape only. validateProductionConfig is a no-op outside production,',
      '  so preflight the PRODUCTION environment before a production deploy.',
    );
    return { ok: true, lines };
  }

  try {
    validateProductionConfig(parsed.data as unknown as Record<string, unknown>);
  } catch (err) {
    lines.push('  ✗ production rules:');
    // First line is the "Production config validation failed:" banner; the rest are the keys.
    for (const line of (err as Error).message.split('\n').slice(1)) lines.push(scrub(`    ${line}`));
    lines.push('', '  Set or rotate the keys named above (AWS Secrets Manager + the ECS task definition),',
      '  then re-run. Values are never printed, only key names.');
    return { ok: false, lines };
  }
  lines.push('  ✓ production rules', '', `  ${service} can boot with this environment.`);
  return { ok: true, lines };
}

function fail(problem: string): never {
  console.error(`\n${problem}\n\n${USAGE}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const serviceIndex = argv.indexOf('--service');
const serviceArg = serviceIndex === -1 ? undefined : argv[serviceIndex + 1];
const useProcessEnv = argv.includes('--process-env');
// Positional = the env file; anything else that starts with `--` is a typo we must not ignore.
const paths = argv.filter((arg, index) =>
  !arg.startsWith('--') && !(serviceIndex !== -1 && index === serviceIndex + 1));
const unknownFlags = argv.filter((arg) => arg.startsWith('--') && arg !== '--service' && arg !== '--process-env');

if (unknownFlags.length > 0) fail(`unknown option: ${unknownFlags.join(' ')}`);
if (paths.length > 1) fail(`one env file at a time, got: ${paths.join(' ')}`);
if (serviceIndex !== -1 && serviceArg === undefined) fail('--service needs a name');

if (paths.length === 1 || useProcessEnv) {
  const envFile = paths[0];
  let env: Record<string, string>;
  if (envFile === undefined) {
    // Only defined values: an unset variable must stay absent, not become ''.
    env = Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => value !== undefined),
    ) as Record<string, string>;
  } else {
    try {
      env = parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>;
    } catch (err) {
      fail(`cannot read ${envFile}: ${(err as Error).message}`);
    }
  }
  const service = serviceArg ?? env['SERVICE_NAME'] ?? '';
  if (!(service in SCHEMAS)) {
    fail(service
      ? `unknown service "${service}"`
      : 'no service to check: pass --service, or set SERVICE_NAME in the environment');
  }
  const result = preflight(service as Service, env, envFile ?? 'process.env');
  for (const line of result.lines) console.log(line);
  console.log('');
  process.exit(result.ok ? 0 : 1);
}

if (argv.length > 0) fail(`unexpected arguments: ${argv.join(' ')}`);

// F1.5.1 deployment identity, exactly as a real task definition injects it: the environment this
// deploy IS, and the FULL commit (`infra/prod-ecs-express/deploy.sh` passes `git rev-parse HEAD`;
// `validate-production-manifest.sh` and `run-release-task.sh` both assert `^[0-9a-f]{40}$`). A
// fixture carrying a short sha would prove the rule engine accepts what production refuses.
const PRODUCTION_GIT_SHA = '4f1c93b7a5d208e6c1b4f9a37d05e289f3c7a1e5';
const PRODUCTION_IMAGE_DIGEST = 'sha256:5b8d26f04ae913c7b52d8a06e4f1c93b7a5d208e6c1b4f9a37d05e289f3c7a1e';

// Valid production fixture — all required prod values present
const validProd: Record<string, unknown> = {
  APP_ENV: 'production',
  DEPLOY_ENVIRONMENT: 'production',
  SERVICE_NAME: 'api',
  SERVICE_VERSION: '0.1.0',
  GIT_SHA: PRODUCTION_GIT_SHA,
  PUBLIC_BASE_URL: 'https://api.watchdog-bms.example.com',
  AUTH_PROVIDER: 'line',
  DEV_AUTH_ENABLED: false,
  DEV_AUTH_SECRET: '',
  CORS_ALLOWED_ORIGINS: 'https://app.watchdog-bms.example.com',
  SWAGGER_ENABLED: false,
  RATE_LIMIT_ENABLED: true,
  RATE_LIMIT_WINDOW_SECONDS: 60,
  RATE_LIMIT_MAX_REQUESTS: 120,
  AUDIT_ENABLED: true,
  LOG_REDACTION_ENABLED: true,
  LOG_FORMAT: 'json',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://watchdog:8Kq2Vx9Rt4Zw1Ns6@db.internal:5432/watchdog_bms',
  REDIS_URL: 'redis://cache.internal:6379',
  S3_BUCKET: 'watchdog-bms-prod',
  S3_ENDPOINT: '',
  // Identifiers are NOT secrets, so the L-03 rules must leave these placeholders alone.
  LINE_LOGIN_CHANNEL_ID: 'PLACEHOLDER_LINE_CHANNEL_ID',
  LINE_LIFF_ID: 'PLACEHOLDER_LINE_LIFF_ID',
  LINE_MESSAGING_CHANNEL_ID: 'PLACEHOLDER_LINE_MESSAGING_ID',
  // Secrets must look like real rotated material (length + novelty + entropy).
  LINE_LOGIN_CHANNEL_SECRET: '7f4a2c91b6d8e05341aab7c9f2e6d10b',
  LINE_MESSAGING_CHANNEL_SECRET: 'c1d93e8a75b0f42d6ae83b19cf70d245',
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'kQ8vTz3mRy7Nb2Xw9Ld5Fh1Ps4Cj6Gu0Ae',
  AI_GATEWAY_INTERNAL_SECRET: 'Zr4Hn8Wc1Kp6Bv3Tq9Md5Xs2Lf7Jy0Ga',
  AI_ACTOR_DELEGATION_SIGNING_KEY: '9f3c7a1e5b8d26f04ae913c7b52d8a06e4f1c93b7a5d208e6c1b4f9a37d05e28',
  WORKER_INTERNAL_TOKEN: 'Vb7Kq2Mz9Rt4Xw1Ns6Ld3Fh8Pj5Cg0Ae',
  WATCHDOG_JWT_ISSUER: 'https://api.watchdog-bms.example.com',
  WATCHDOG_JWT_AUDIENCE: 'watchdog-bms',
  // Despite the _ARN name, the runtime value is the resolved secret itself: ECS injects it via
  // `secrets:` and it is handed straight to jwt.sign/jwt.verify as HMAC key material. So the
  // fixture must be secret-shaped, not an ARN — an ARN literal also trips the L-03 entropy rule
  // on the account-id digits.
  WATCHDOG_JWT_SECRET_ARN: 'Qw7Fj2Nb5Yx8Rk1Vt4Hm9Zs3Ld6Pc0Ge',
  CREDENTIAL_ENCRYPTION_KEY: '5a1f8c204e7b93d6af0c2185b74e39dc61f0a84b27de53c9081b6f4a9e2d7c30',
  PDPA_PSEUDONYMIZATION_KEY: 'b62d09f4a7c1385e0d9b47f2a6c8501e3f7b29d4068ace51729f3b8d0c4e6a15',
  WORKFLOW_WEBHOOK_ALLOWED_HOSTS: 'hooks.watchdog-bms.internal',
  CLAMAV_HOST: 'clamav.internal',
};

/**
 * `expected` pins WHY the fixture was refused. Without it a reject-case stays green when the rule
 * it names is deleted and some unrelated key in the fixture rots — the failure mode that let a
 * whole class of these tests pass while proving nothing.
 */
function expectRejected(name: string, overrides: Record<string, unknown>, expected?: RegExp) {
  check(name, () => {
    let message = '';
    try { validateProductionConfig({ ...validProd, ...overrides }); }
    catch (err) { message = (err as Error).message; }
    if (message === '') throw new Error('expected rejection but config was accepted');
    // Rule messages name keys only, never values, so quoting one here cannot leak a secret.
    if (expected && !expected.test(message)) throw new Error(`rejected for the wrong reason: ${message}`);
  });
}

console.log('\nProduction Config Validation\n');

// --- Acceptance: valid fixture must PASS ---
check('accepts valid production fixture', () => {
  validateProductionConfig(validProd);
});

// --- Rejection: unsafe values must FAIL ---
check('rejects DEV_AUTH_ENABLED=true', () => {
  let threw = false;
  try { validateProductionConfig({ ...validProd, DEV_AUTH_ENABLED: true }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects AUTH_PROVIDER=dev', () => {
  let threw = false;
  try { validateProductionConfig({ ...validProd, AUTH_PROVIDER: 'dev' }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects wildcard CORS_ALLOWED_ORIGINS', () => {
  let threw = false;
  try { validateProductionConfig({ ...validProd, CORS_ALLOWED_ORIGINS: '*' }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects empty CORS_ALLOWED_ORIGINS', () => {
  let threw = false;
  try { validateProductionConfig({ ...validProd, CORS_ALLOWED_ORIGINS: '' }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects AUDIT_ENABLED=false', () => {
  let threw = false;
  try { validateProductionConfig({ ...validProd, AUDIT_ENABLED: false }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects LOG_REDACTION_ENABLED=false', () => {
  let threw = false;
  try { validateProductionConfig({ ...validProd, LOG_REDACTION_ENABLED: false }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects missing LINE_LOGIN_CHANNEL_ID when AUTH_PROVIDER=line', () => {
  let threw = false;
  try { validateProductionConfig({ ...validProd, LINE_LOGIN_CHANNEL_ID: '' }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects missing LINE messaging and WatchDog JWT config', () => {
  let threw = false;
  try {
    validateProductionConfig({
      ...validProd,
      LINE_MESSAGING_CHANNEL_SECRET: '',
      WATCHDOG_JWT_SECRET_ARN: '',
    });
  }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects missing database/redis/storage config', () => {
  let threw = false;
  try { validateProductionConfig({ ...validProd, DATABASE_URL: '', REDIS_URL: '', S3_BUCKET: '' }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects public Swagger in production', () => {
  let threw = false;
  try { validateProductionConfig({ ...validProd, SWAGGER_ENABLED: true }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('rejects an AI monthly budget ceiling below the platform default', () => {
  let threw = false;
  try {
    validateProductionConfig({
      ...validProd,
      AI_MONTHLY_BUDGET_SATANG: 200000,
      AI_MONTHLY_BUDGET_SATANG_CEILING: 100000,
    });
  }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('accepts an AI monthly budget ceiling at or above the platform default', () => {
  validateProductionConfig({
    ...validProd,
    AI_MONTHLY_BUDGET_SATANG: 200000,
    AI_MONTHLY_BUDGET_SATANG_CEILING: 1000000,
  });
});

check('rejects AI prompt logging and final mutation in production', () => {
  let threw = false;
  try {
    validateProductionConfig({
      APP_ENV: 'production',
      DEPLOY_ENVIRONMENT: 'production',
      SERVICE_NAME: 'ai-gateway',
      SERVICE_VERSION: '0.1.0',
      GIT_SHA: PRODUCTION_GIT_SHA,
      PUBLIC_BASE_URL: 'https://ai.watchdog-bms.example.com',
      LOG_FORMAT: 'json',
      LOG_REDACTION_ENABLED: true,
      MODEL_PROVIDER: 'disabled',
      AI_GATEWAY_ENABLED: false,
      AI_FINAL_MUTATION_ENABLED: true,
      AI_PROMPT_LOGGING_ENABLED: true,
    });
  }
  catch { threw = true; }
  if (!threw) throw new Error('expected rejection but config was accepted');
});

check('is a no-op for local APP_ENV with dev values', () => {
  validateProductionConfig({ APP_ENV: 'local', DEV_AUTH_ENABLED: true, AUTH_PROVIDER: 'dev' });
});

// --- F1.5.1 deployment identity: what a deploy CLAIMS to be must be usable ---
// Every rule here is owned by packages/config (`deploymentIdentityGaps` / `resolveDeploymentIdentity`)
// and only reached from this script, so the boot validator, the release-task seeder, and this
// preflight cannot drift apart.
expectRejected('rejects DEPLOY_ENVIRONMENT=local when APP_ENV=production', { DEPLOY_ENVIRONMENT: 'local' },
  /DEPLOY_ENVIRONMENT must be "uat" or "production"/);
expectRejected('rejects a missing DEPLOY_ENVIRONMENT when APP_ENV=production', { DEPLOY_ENVIRONMENT: undefined },
  /DEPLOY_ENVIRONMENT must be "uat" or "production"/);
check('accepts DEPLOY_ENVIRONMENT=uat — a UAT task definition is APP_ENV=production', () => {
  validateProductionConfig({ ...validProd, DEPLOY_ENVIRONMENT: 'uat' });
});
expectRejected('rejects a short GIT_SHA in production', { GIT_SHA: 'abc123' },
  /GIT_SHA must be the full 40-character lowercase commit sha/);
expectRejected('rejects the unreplaced <GIT_SHA> task-definition placeholder', { GIT_SHA: '<GIT_SHA>' },
  /GIT_SHA is still an unreplaced/);
expectRejected('rejects a malformed image digest', { IMAGE_DIGEST: 'sha256:beef' },
  /IMAGE_DIGEST must be sha256: followed by 64/);
check('accepts a well-formed sha256 image digest', () => {
  validateProductionConfig({ ...validProd, IMAGE_DIGEST: PRODUCTION_IMAGE_DIGEST });
});
check('rejects an APP_ENV=local process that claims a deployed DEPLOY_ENVIRONMENT', () => {
  for (const declared of ['uat', 'production']) {
    let threw = false;
    try {
      resolveDeploymentIdentity({ APP_ENV: 'local', DEPLOY_ENVIRONMENT: declared, GIT_SHA: PRODUCTION_GIT_SHA });
    } catch { threw = true; }
    if (!threw) throw new Error(`APP_ENV=local must not claim DEPLOY_ENVIRONMENT=${declared}`);
  }
});

// --- L-03 secret strength, denylist, lifecycle ---
expectRejected('rejects a short repo-generated secret', { WORKER_INTERNAL_TOKEN: 'k7Qm2Vx9Rt4Zw1Ns' });
expectRejected('rejects a committed local secret value', { AI_GATEWAY_INTERNAL_SECRET: 'local-ai-internal-secret' });
expectRejected('rejects a repeated-pattern hex key', {
  AI_ACTOR_DELEGATION_SIGNING_KEY: '3456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012',
});
expectRejected('rejects a low-distinct-character hex key', { CREDENTIAL_ENCRYPTION_KEY: '11'.repeat(32) });
expectRejected('rejects a third-party secret under 16 characters', { LINE_MESSAGING_CHANNEL_SECRET: 'short-secret' });
expectRejected('rejects a localhost DATABASE_URL', {
  DATABASE_URL: 'postgresql://watchdog:8Kq2Vx9Rt4Zw1Ns6@localhost:5432/watchdog_bms',
});
expectRejected('rejects a committed credential inside a remote DSN', {
  DATABASE_URL: 'postgresql://watchdog:watchdog_local_password@db.internal:5432/watchdog_bms',
});
expectRejected('rejects SEED_SYSTEM_ADMIN_PASSWORD in production', { SEED_SYSTEM_ADMIN_PASSWORD: 'Xr7Kq2Mz9Rt4Vw1N' });
expectRejected('rejects LOG_LEVEL=debug in production', { LOG_LEVEL: 'debug' });
// M-09: deny-all must be sayable without inventing a host, but an unset key must still fail.
check('accepts the deny-all webhook sentinel in production', () => {
  validateProductionConfig({ ...validProd, WORKFLOW_WEBHOOK_ALLOWED_HOSTS: 'none' });
});
expectRejected('rejects an unset webhook allowlist in production', { WORKFLOW_WEBHOOK_ALLOWED_HOSTS: '' });
expectRejected('rejects AI_FINAL_MUTATION_ENABLED=true for the API', { AI_FINAL_MUTATION_ENABLED: true });

check('never echoes a secret value in the failure message', () => {
  const weak = 'changeme-changeme-changeme-abcd';
  try {
    validateProductionConfig({ ...validProd, AI_GATEWAY_INTERNAL_SECRET: weak });
    throw new Error('expected rejection but config was accepted');
  } catch (err) {
    const message = (err as Error).message;
    if (!message.includes('AI_GATEWAY_INTERNAL_SECRET')) throw new Error('failure must name the key');
    if (message.includes(weak) || message.includes('changeme')) throw new Error('failure leaked the secret value');
  }
});

// --- L-03 production holes: AI Gateway JWT fallback and workers internal token ---
const validAiGateway: Record<string, unknown> = {
  APP_ENV: 'production',
  DEPLOY_ENVIRONMENT: 'production',
  SERVICE_NAME: 'ai-gateway',
  SERVICE_VERSION: '0.1.0',
  GIT_SHA: PRODUCTION_GIT_SHA,
  PUBLIC_BASE_URL: 'https://ai.watchdog-bms.example.com',
  CORS_ALLOWED_ORIGINS: 'https://app.watchdog-bms.example.com',
  LOG_FORMAT: 'json',
  LOG_LEVEL: 'info',
  LOG_REDACTION_ENABLED: true,
  MODEL_PROVIDER: 'disabled',
  AI_GATEWAY_ENABLED: false,
  AI_TOOL_POLICY_ENFORCED: true,
  AI_TOOL_AUDIT_ENABLED: true,
  AI_FINAL_MUTATION_ENABLED: false,
  AI_PROMPT_LOGGING_ENABLED: false,
  AI_GATEWAY_INTERNAL_SECRET: 'Zr4Hn8Wc1Kp6Bv3Tq9Md5Xs2Lf7Jy0Ga',
  JWT_CLOCK_TOLERANCE_SECONDS: 30,
  WATCHDOG_JWT_SECRET_ARN: 'Qw7Fj2Nb5Yx8Rk1Vt4Hm9Zs3Ld6Pc0Ge',
  // L-04: deliberately the same iss/aud as validProd — the gateway verifies tokens the API
  // signed, so a fixture that let them diverge would accept a config that rejects every token.
  WATCHDOG_JWT_ISSUER: 'https://api.watchdog-bms.example.com',
  WATCHDOG_JWT_AUDIENCE: 'watchdog-bms',
};

const validWorkers: Record<string, unknown> = {
  APP_ENV: 'production',
  DEPLOY_ENVIRONMENT: 'production',
  PRODUCTION_SERVING_MODE: 'live',
  SERVICE_NAME: 'workers',
  SERVICE_VERSION: '0.1.0',
  GIT_SHA: PRODUCTION_GIT_SHA,
  PUBLIC_BASE_URL: 'https://api.watchdog-bms.example.com',
  LOG_FORMAT: 'json',
  LOG_LEVEL: 'info',
  LOG_REDACTION_ENABLED: true,
  DATABASE_URL: 'postgresql://watchdog:8Kq2Vx9Rt4Zw1Ns6@db.internal:5432/watchdog_bms',
  REDIS_URL: 'redis://cache.internal:6379',
  S3_BUCKET: 'watchdog-bms-prod',
  QUEUE_ENABLED: true,
  WORKER_INTERNAL_TOKEN: 'Vb7Kq2Mz9Rt4Xw1Ns6Ld3Fh8Pj5Cg0Ae',
};

check('accepts a valid production AI Gateway fixture', () => validateProductionConfig(validAiGateway));
check('accepts a valid production workers fixture', () => validateProductionConfig(validWorkers));

for (const [name, config] of [
  ['requires WATCHDOG_JWT_SECRET_ARN for a production AI Gateway', { ...validAiGateway, WATCHDOG_JWT_SECRET_ARN: undefined }],
  ['forbids the DEV_AUTH_SECRET JWT fallback for a production AI Gateway', { ...validAiGateway, DEV_AUTH_SECRET: 'local-dev-secret-change-me' }],
  ['requires WORKER_INTERNAL_TOKEN for a production workers process', { ...validWorkers, WORKER_INTERNAL_TOKEN: undefined }],
] as const) {
  check(name, () => {
    let threw = false;
    try { validateProductionConfig(config as Record<string, unknown>); }
    catch { threw = true; }
    if (!threw) throw new Error('expected rejection but config was accepted');
  });
}

// --- Preflight mode: a real environment, and the no-leak guarantee ------------------------------
// An env file arrives as strings, so the fixtures are stringified exactly as `parseEnv` yields them.
const asEnv = (config: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]),
  );

// Distinctive planted values: any fragment of these in the output is a leak, and none of them can
// collide with the fixed text of a rule message.
const PLANTED_WEAK_SECRET = 'zqfPLANTEDzqfPLANTED';
const PLANTED_BAD_HEX = 'zqfPLANTEDHEXzqf9f3c7a1e5b8d26f04ae913c7b52d8a06e4f1c93b7a5d208e6c';
const planted = [PLANTED_WEAK_SECRET, PLANTED_BAD_HEX];

const noPlantedFragment = (lines: string[]) => {
  const output = lines.join('\n');
  for (const secret of planted) {
    for (let i = 0; i + 8 <= secret.length; i += 1) {
      const fragment = secret.slice(i, i + 8);
      if (output.includes(fragment)) throw new Error(`output leaked a fragment of a secret value at offset ${i}`);
    }
  }
};

check('preflight accepts a real production API environment', () => {
  const result = preflight('api', asEnv(validProd), 'fixture');
  if (!result.ok) throw new Error(`expected pass, got:\n${result.lines.join('\n')}`);
});

check('preflight fails a production API environment with a weak real secret', () => {
  // Repeated pattern + committed-value tier rules must fire on the value an operator really set.
  const result = preflight('api', { ...asEnv(validProd), WORKER_INTERNAL_TOKEN: PLANTED_WEAK_SECRET }, 'fixture');
  if (result.ok) throw new Error('expected failure');
  const output = result.lines.join('\n');
  if (!output.includes('WORKER_INTERNAL_TOKEN')) throw new Error('failure must name the key');
  noPlantedFragment(result.lines);
});

check('preflight fails, and leaks nothing, when the schema rejects a secret', () => {
  // Schema phase: a malformed hex key never reaches the rule engine, so this covers the other path.
  const result = preflight('api', { ...asEnv(validProd), CREDENTIAL_ENCRYPTION_KEY: PLANTED_BAD_HEX }, 'fixture');
  if (result.ok) throw new Error('expected failure');
  if (!result.lines.join('\n').includes('CREDENTIAL_ENCRYPTION_KEY')) throw new Error('failure must name the key');
  noPlantedFragment(result.lines);
});

check('preflight reports every failing key at once, not just the first', () => {
  const result = preflight('api', {
    ...asEnv(validProd),
    WORKER_INTERNAL_TOKEN: PLANTED_WEAK_SECRET,
    LINE_MESSAGING_CHANNEL_SECRET: '',
    CLAMAV_HOST: '',
  }, 'fixture');
  const output = result.lines.join('\n');
  for (const key of ['WORKER_INTERNAL_TOKEN', 'LINE_MESSAGING_CHANNEL_SECRET', 'CLAMAV_HOST']) {
    if (!output.includes(key)) throw new Error(`${key} missing from the report`);
  }
  noPlantedFragment(result.lines);
});

check('preflight validates the AI Gateway and workers environments with their own schemas', () => {
  for (const [service, fixture] of [['ai-gateway', validAiGateway], ['workers', validWorkers]] as const) {
    const result = preflight(service, asEnv(fixture), 'fixture');
    if (!result.ok) throw new Error(`${service} expected pass, got:\n${result.lines.join('\n')}`);
  }
  // The schema really is per service: the workers env has no AI keys, so an ai-gateway check of it
  // must fail rather than silently approximate.
  if (preflight('ai-gateway', asEnv(validWorkers), 'fixture').ok) {
    throw new Error('a workers environment must not pass the ai-gateway preflight');
  }
});

check('preflight skips the production rules for a non-production environment', () => {
  // The identity has to drop back to `local` with APP_ENV: the pair is checked for consistency.
  const local = { ...asEnv(validProd), APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'local' };
  const result = preflight('api', local, 'fixture');
  if (!result.ok) throw new Error(`a local environment with a valid shape must pass:\n${result.lines.join('\n')}`);
  if (!result.lines.join('\n').includes('production rules skipped')) {
    throw new Error('the report must say the production rules did not run');
  }
});

check('preflight rejects a local environment that claims a deployed DEPLOY_ENVIRONMENT', () => {
  // The one rule that still bites outside production: local security mode, uat-labelled records.
  const result = preflight('api', { ...asEnv(validProd), APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'uat' }, 'fixture');
  if (result.ok) throw new Error('an APP_ENV=local environment must not claim DEPLOY_ENVIRONMENT=uat');
  if (!result.lines.join('\n').includes('DEPLOY_ENVIRONMENT')) throw new Error('failure must name the key');
});

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
