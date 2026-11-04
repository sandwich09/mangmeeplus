import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  isLineAiRolloutAllowed,
  validateProductionConfig,
  redactLogValue,
  SENSITIVE_LOG_KEY_PATTERN,
  DEFAULT_APPROVED_AI_MODEL_IDS,
  DEFAULT_JWT_AUDIENCE,
  DEFAULT_JWT_ISSUER,
  WEBHOOK_ALLOWLIST_DENY_ALL,
  aiGatewayConfigSchema,
  apiConfigSchema,
  parseWebhookAllowedHosts,
  resolveDeploymentIdentity,
  workersConfigSchema,
} from './index.ts';

// F1.5.1: a production build id must be the FULL commit — a short prefix is an abbreviation, not
// an immutable identity — so every production fixture carries what the deploy scripts inject.
const PRODUCTION_GIT_SHA = '9f3c7a1e5b8d26f04ae913c7b52d8a06e4f1c93b';
const PRODUCTION_IMAGE_DIGEST = 'sha256:5b8d26f04ae913c7b52d8a06e4f1c93b7a5d208e6c1b4f9a37d05e289f3c7a1e';

// Helper: base production config that should pass
const validProduction: Record<string, unknown> = {
  APP_ENV: 'production',
  // F1.5.1: a real production task definition injects the deployment identity; the fixture must
  // carry it too, because a production config without it no longer boots.
  DEPLOY_ENVIRONMENT: 'production',
  SERVICE_NAME: 'api',
  SERVICE_VERSION: '0.1.0',
  GIT_SHA: PRODUCTION_GIT_SHA,
  PUBLIC_BASE_URL: 'https://api.example.com',
  AUTH_PROVIDER: 'line',
  DEV_AUTH_ENABLED: false,
  DEV_AUTH_SECRET: '',
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  SWAGGER_ENABLED: false,
  RATE_LIMIT_ENABLED: true,
  RATE_LIMIT_WINDOW_SECONDS: 60,
  RATE_LIMIT_MAX_REQUESTS: 100,
  AUDIT_ENABLED: true,
  LOG_REDACTION_ENABLED: true,
  LOG_FORMAT: 'json',
  DATABASE_URL: 'postgresql://user:pass@db:5432/watchdog',
  REDIS_URL: 'redis://cache:6379',
  S3_BUCKET: 'watchdog-prod',
  S3_ENDPOINT: '',
  LINE_LOGIN_CHANNEL_ID: 'chan-123',
  LINE_LOGIN_CHANNEL_SECRET: 'line-login-secret',
  LINE_LIFF_ID: 'liff-123',
  LINE_MESSAGING_CHANNEL_ID: 'msg-123',
  LINE_MESSAGING_CHANNEL_SECRET: 'line-msg-provider-key-7F2A',
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'line-msg-provider-token-4D8C',
  WEB_BASE_URL: 'https://app.example.com',
  WORKER_INTERNAL_TOKEN: 'wK7m2Q9v4X8c1L6p3R5t0N2s7H9j4F6a',
  AI_GATEWAY_INTERNAL_SECRET: 'gA4x8M1q6V3n9C2r7T5p0K8s1D6h4J9z',
  AI_ACTOR_DELEGATION_SIGNING_KEY: 'f3a1c7e94b2d8605a8f1c493e7b260d54a9c1e783f5b6204d8a3c971e5f204b6',
  WATCHDOG_JWT_ISSUER: 'https://api.example.com',
  WATCHDOG_JWT_AUDIENCE: 'watchdog-bms',
  WATCHDOG_JWT_SECRET_ARN: 'arn:aws:secretsmanager:ap-southeast-1:123:secret:jwt',
  CREDENTIAL_ENCRYPTION_KEY: 'a4d9e2f710c83b65d1e9472af6305c8b7e1d0493a6f25c80b4e9712da8356fc0',
  PDPA_PSEUDONYMIZATION_KEY: '7c2e5a9104f8d36ba1e7095c2f864d30e9a157c4b82d06f3a5e91872c40b6df1',
  WORKFLOW_WEBHOOK_ALLOWED_HOSTS: 'hooks.example.com',
  CLAMAV_HOST: 'clamav.internal',
};

describe('validateProductionConfig', () => {
  it('passes with a valid production config', () => {
    assert.doesNotThrow(() => validateProductionConfig(validProduction));
  });

  it('is a no-op for local APP_ENV', () => {
    assert.doesNotThrow(() =>
      validateProductionConfig({ APP_ENV: 'local', DEV_AUTH_ENABLED: true, AUTH_PROVIDER: 'dev' }),
    );
  });

  it('parses explicit local-console email delivery locally and rejects it in production', () => {
    assert.equal(apiConfigSchema.parse({
      APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://local/test', S3_BUCKET: 'local-test',
    }).EMAIL_PROVIDER, 'disabled');
    assert.equal(apiConfigSchema.parse({
      APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://local/test',
      S3_BUCKET: 'local-test', EMAIL_PROVIDER: 'local-console',
    }).EMAIL_PROVIDER, 'local-console');
    assert.throws(
      () => validateProductionConfig({ ...validProduction, EMAIL_PROVIDER: 'local-console' }),
      /EMAIL_PROVIDER=local-console is allowed only when APP_ENV=local/,
    );
  });

  it('requires the SES region and sender address when SES is enabled', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, EMAIL_PROVIDER: 'ses', SES_REGION: '', SES_FROM_ADDRESS: '' }),
      /SES_REGION is required when EMAIL_PROVIDER=ses/,
    );
    assert.doesNotThrow(() => validateProductionConfig({
      ...validProduction,
      EMAIL_PROVIDER: 'ses',
      SES_REGION: 'ap-southeast-1',
      SES_FROM_ADDRESS: 'no-reply@example.com',
    }));
  });

  it('requires an explicit SES frontend base even when the public API origin is configured', () => {
    for (const WEB_BASE_URL of [undefined, '']) {
      assert.throws(() => validateProductionConfig({
        ...validProduction, EMAIL_PROVIDER: 'ses', SES_REGION: 'ap-southeast-1',
        SES_FROM_ADDRESS: 'no-reply@example.com', WEB_BASE_URL,
      }), /WEB_BASE_URL is required when EMAIL_PROVIDER=ses/);
    }
    assert.doesNotThrow(() => validateProductionConfig({
      ...validProduction, EMAIL_PROVIDER: 'disabled', WEB_BASE_URL: undefined,
    }));
    assert.doesNotThrow(() => validateProductionConfig({
      ...validProduction, EMAIL_PROVIDER: 'ses', SES_REGION: 'ap-southeast-1',
      SES_FROM_ADDRESS: 'no-reply@example.com', WEB_BASE_URL: 'https://frontend.example.com',
    }));
  });

  it('rejects DEV_AUTH_ENABLED=true', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, DEV_AUTH_ENABLED: true }),
      /DEV_AUTH_ENABLED must be false/,
    );
  });

  it('rejects DEV_AUTH_SECRET in production', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, DEV_AUTH_SECRET: 'local-secret' }),
      /DEV_AUTH_SECRET/,
    );
  });

  it('rejects DEV_AUTH_ENABLED="true" (string)', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, DEV_AUTH_ENABLED: 'true' }),
      /DEV_AUTH_ENABLED must be false/,
    );
  });

  it('rejects AUTH_PROVIDER=dev', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, AUTH_PROVIDER: 'dev' }),
      /AUTH_PROVIDER=dev/,
    );
  });

  it('requires the credential encryption key', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, CREDENTIAL_ENCRYPTION_KEY: '' }),
      /CREDENTIAL_ENCRYPTION_KEY is required/,
    );
  });

  it('requires an independent PDPA pseudonymization root key', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, PDPA_PSEUDONYMIZATION_KEY: '' }),
      /PDPA_PSEUDONYMIZATION_KEY is required/,
    );
    assert.throws(
      () => validateProductionConfig({
        ...validProduction,
        PDPA_PSEUDONYMIZATION_KEY: validProduction['CREDENTIAL_ENCRYPTION_KEY'],
      }),
      /must be independent/,
    );
  });

  it('rejects empty CORS_ALLOWED_ORIGINS', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, CORS_ALLOWED_ORIGINS: '' }),
      /CORS_ALLOWED_ORIGINS/,
    );
  });

  it('rejects wildcard CORS_ALLOWED_ORIGINS', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, CORS_ALLOWED_ORIGINS: '*' }),
      /CORS_ALLOWED_ORIGINS/,
    );
  });

  it('rejects partial-wildcard CORS_ALLOWED_ORIGINS', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, CORS_ALLOWED_ORIGINS: 'https://*.example.com' }),
      /CORS_ALLOWED_ORIGINS/,
    );
  });

  it('rejects AUDIT_ENABLED=false', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, AUDIT_ENABLED: false }),
      /AUDIT_ENABLED/,
    );
  });

  it('rejects AUDIT_ENABLED="false" (string)', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, AUDIT_ENABLED: 'false' }),
      /AUDIT_ENABLED/,
    );
  });

  it('rejects LOG_REDACTION_ENABLED=false', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, LOG_REDACTION_ENABLED: false }),
      /LOG_REDACTION_ENABLED/,
    );
  });

  it('rejects LOG_REDACTION_ENABLED="false" (string)', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, LOG_REDACTION_ENABLED: 'false' }),
      /LOG_REDACTION_ENABLED/,
    );
  });

  it('rejects missing LINE_LOGIN_CHANNEL_ID when AUTH_PROVIDER=line', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, LINE_LOGIN_CHANNEL_ID: '' }),
      /LINE_LOGIN_CHANNEL_ID/,
    );
  });

  it('rejects missing LINE, messaging, and WatchDog JWT production secrets', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          ...validProduction,
          LINE_LOGIN_CHANNEL_SECRET: '',
          LINE_MESSAGING_CHANNEL_ID: '',
          LINE_MESSAGING_CHANNEL_SECRET: '',
          WATCHDOG_JWT_ISSUER: '',
          WATCHDOG_JWT_AUDIENCE: '',
          WATCHDOG_JWT_SECRET_ARN: '',
        }),
      /LINE_LOGIN_CHANNEL_SECRET/,
    );
  });

  it('rejects missing database, redis, or storage config', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, DATABASE_URL: '', REDIS_URL: '', S3_BUCKET: '' }),
      /DATABASE_URL or DATABASE_SECRET_ARN/,
    );
  });

  it('rejects local S3 endpoint in production', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, S3_ENDPOINT: 'http://minio:9000' }),
      /S3_ENDPOINT/,
    );
  });

  it('rejects public Swagger in production', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, SWAGGER_ENABLED: true }),
      /SWAGGER_ENABLED/,
    );
  });

  it('rejects non-json production logs', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, LOG_FORMAT: 'text' }),
      /LOG_FORMAT/,
    );
  });

  it('rejects disabled API rate limiting in production', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, RATE_LIMIT_ENABLED: false }),
      /RATE_LIMIT_ENABLED/,
    );
  });

  it('rejects AI final mutation and prompt logging in production', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          APP_ENV: 'production',
          SERVICE_NAME: 'ai-gateway',
          SERVICE_VERSION: '0.1.0',
          GIT_SHA: PRODUCTION_GIT_SHA,
          PUBLIC_BASE_URL: 'https://ai.example.com',
          LOG_FORMAT: 'json',
          LOG_REDACTION_ENABLED: true,
          MODEL_PROVIDER: 'disabled',
          AI_GATEWAY_ENABLED: false,
          AI_FINAL_MUTATION_ENABLED: true,
          AI_PROMPT_LOGGING_ENABLED: true,
        }),
      /AI_FINAL_MUTATION_ENABLED/,
    );
  });

  it('rejects disabled AI policy or audit when AI tools are enabled', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          APP_ENV: 'production',
          SERVICE_NAME: 'ai-gateway',
          SERVICE_VERSION: '0.1.0',
          GIT_SHA: PRODUCTION_GIT_SHA,
          PUBLIC_BASE_URL: 'https://ai.example.com',
          LOG_FORMAT: 'json',
          LOG_REDACTION_ENABLED: true,
          MODEL_PROVIDER: 'openai',
          AI_GATEWAY_ENABLED: true,
          AI_TOOL_POLICY_ENFORCED: false,
          AI_TOOL_AUDIT_ENABLED: false,
          AI_FINAL_MUTATION_ENABLED: false,
          AI_PROMPT_LOGGING_ENABLED: false,
          AI_GATEWAY_INTERNAL_SECRET: 'internal-secret',
        }),
      /AI_TOOL_POLICY_ENFORCED/,
    );
  });

  it('rejects missing AI internal secret for production API', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, AI_GATEWAY_INTERNAL_SECRET: '' }),
      /AI_GATEWAY_INTERNAL_SECRET/,
    );
  });

  it('requires an independent API-only AI actor delegation signing key', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, AI_ACTOR_DELEGATION_SIGNING_KEY: '' }),
      /AI_ACTOR_DELEGATION_SIGNING_KEY is required/,
    );
    assert.throws(
      () => validateProductionConfig({
        ...validProduction,
        AI_ACTOR_DELEGATION_SIGNING_KEY: validProduction['PDPA_PSEUDONYMIZATION_KEY'],
      }),
      /must be independent from workload and data protection keys/,
    );
    assert.throws(
      () => validateProductionConfig({
        ...validProduction,
        AI_ACTOR_DELEGATION_SIGNING_KEY: validProduction['AI_GATEWAY_INTERNAL_SECRET'],
      }),
      /must be independent from workload and data protection keys/,
    );
  });

  it('rejects missing AgentCore config when LINE_AI_AGENT_RUNTIME=agentcore', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          APP_ENV: 'production',
          SERVICE_NAME: 'ai-gateway',
          SERVICE_VERSION: '0.1.0',
          GIT_SHA: PRODUCTION_GIT_SHA,
          PUBLIC_BASE_URL: 'https://ai.example.com',
          LOG_FORMAT: 'json',
          LOG_REDACTION_ENABLED: true,
          MODEL_PROVIDER: 'bedrock',
          BEDROCK_REGION: 'ap-southeast-1',
          BEDROCK_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
          AI_GATEWAY_ENABLED: true,
          AI_TOOL_POLICY_ENFORCED: true,
          AI_TOOL_AUDIT_ENABLED: true,
          AI_FINAL_MUTATION_ENABLED: false,
          AI_PROMPT_LOGGING_ENABLED: false,
          AI_GATEWAY_INTERNAL_SECRET: 'internal-secret',
          LINE_AI_AGENT_RUNTIME: 'agentcore',
          // Runtime binding and expected signed identity intentionally missing.
        }),
      /AGENTCORE_REGION/,
    );
  });

  it('rejects AgentCore production without signed expected artifact identity', () => {
    assert.throws(
      () => validateProductionConfig({
        ...validProduction,
        SERVICE_NAME: 'ai-gateway',
        AI_GATEWAY_ENABLED: true,
        AI_TOOL_POLICY_ENFORCED: true,
        AI_TOOL_AUDIT_ENABLED: true,
        LINE_AI_AGENT_RUNTIME: 'agentcore',
        AGENTCORE_REGION: 'ap-southeast-1',
        AGENTCORE_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:ap-southeast-1:311414082667:runtime/test-AbCdEf1234',
        AGENTCORE_RUNTIME_QUALIFIER: 'candidate_production_aaaaaaaaaaaa',
      }),
      /AGENTCORE_EXPECTED_SOURCE_COMMIT/,
    );
  });

  it('rejects an unapproved or global AI model/region in production', () => {
    assert.throws(
      () => validateProductionConfig({
        APP_ENV: 'production',
        SERVICE_NAME: 'ai-gateway',
        MODEL_PROVIDER: 'bedrock',
        BEDROCK_REGION: 'us-east-1',
        BEDROCK_MODEL_ID: 'global.anthropic.example',
        APPROVED_AI_PROVIDERS: 'bedrock',
        APPROVED_AI_MODEL_IDS: 'apac.anthropic.approved',
        APPROVED_AI_REGIONS: 'ap-southeast-1',
        AI_GATEWAY_INTERNAL_SECRET: 'internal-secret',
        AI_TOOL_POLICY_ENFORCED: true,
        AI_TOOL_AUDIT_ENABLED: true,
      }),
      /configured AI model is not approved|global Bedrock inference profiles are not allowed/,
    );
  });

  it('rejects global profiles anywhere in the production tenant model allowlist', () => {
    assert.throws(
      () => validateProductionConfig({
        APP_ENV: 'production',
        SERVICE_NAME: 'ai-gateway',
        MODEL_PROVIDER: 'bedrock',
        BEDROCK_REGION: 'ap-southeast-1',
        BEDROCK_MODEL_ID: 'apac.model-v1',
        APPROVED_AI_PROVIDERS: 'bedrock',
        APPROVED_AI_MODEL_IDS: 'apac.model-v1,global.anthropic.claude-sonnet-4-6',
        APPROVED_AI_REGIONS: 'ap-southeast-1',
        AI_GATEWAY_INTERNAL_SECRET: 'gA4x8M1q6V3n9C2r7T5p0K8s1D6h4J9z',
        AI_TOOL_POLICY_ENFORCED: true,
        AI_TOOL_AUDIT_ENABLED: true,
      }),
      /must not appear in the production model allowlist/,
    );
  });

  it('accepts a newer global profile only with a recorded approval reference', () => {
    // Running a model newer than the newest APAC-published profile means a `global.`
    // profile, which may route the turn outside the approved region. That is allowed
    // only as a deliberate, attributable exception — never by relaxing the rule.
    const withGlobalModel = (extra: Record<string, unknown>) => ({
      ...validProduction,
      APP_ENV: 'production',
      SERVICE_NAME: 'ai-gateway',
      MODEL_PROVIDER: 'bedrock',
      BEDROCK_REGION: 'ap-southeast-1',
      BEDROCK_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
      APPROVED_AI_PROVIDERS: 'bedrock',
      APPROVED_AI_MODEL_IDS: 'global.anthropic.claude-sonnet-4-6',
      APPROVED_AI_REGIONS: 'ap-southeast-1',
      AI_GATEWAY_INTERNAL_SECRET: 'gA4x8M1q6V3n9C2r7T5p0K8s1D6h4J9z',
      AI_TOOL_POLICY_ENFORCED: true,
      AI_TOOL_AUDIT_ENABLED: true,
      ...extra,
    });

    // Default posture is unchanged: no exception, no global profile.
    assert.throws(() => validateProductionConfig(withGlobalModel({})), /global Bedrock inference profiles/);

    // The flag on its own is refused — an approval nobody can trace is not an approval.
    assert.throws(
      () => validateProductionConfig(withGlobalModel({ AI_GLOBAL_INFERENCE_PROFILE_APPROVED: true })),
      /AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF is required/,
    );
    assert.throws(
      () => validateProductionConfig(withGlobalModel({
        AI_GLOBAL_INFERENCE_PROFILE_APPROVED: true,
        AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF: '   ',
      })),
      /AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF is required/,
    );

    // Flag plus reference: accepted, and both the allowlist rule and the model rule relax together.
    assert.doesNotThrow(() => validateProductionConfig(withGlobalModel({
      AI_GLOBAL_INFERENCE_PROFILE_APPROVED: true,
      AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF: 'DPO-2026-07-28-bedrock-global',
    })));

    // The exception covers cross-border routing only; every other guard still applies.
    assert.throws(
      () => validateProductionConfig(withGlobalModel({
        AI_GLOBAL_INFERENCE_PROFILE_APPROVED: true,
        AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF: 'DPO-2026-07-28-bedrock-global',
        BEDROCK_REGION: 'us-east-1',
      })),
      /configured AI processing region is not approved/,
    );
    assert.throws(
      () => validateProductionConfig(withGlobalModel({
        AI_GLOBAL_INFERENCE_PROFILE_APPROVED: true,
        AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF: 'DPO-2026-07-28-bedrock-global',
        BEDROCK_MODEL_ID: 'global.anthropic.some-other-model',
      })),
      /configured AI model is not approved/,
    );
  });

  it('defaults the global-profile exception to off in both schemas', () => {
    assert.equal(apiConfigSchema.parse(validProduction).AI_GLOBAL_INFERENCE_PROFILE_APPROVED, false);
    assert.equal(
      aiGatewayConfigSchema.parse({ ...validProduction, SERVICE_NAME: 'ai-gateway' })
        .AI_GLOBAL_INFERENCE_PROFILE_APPROVED,
      false,
    );
  });

  it('reads the global-profile exception flag from env strings without failing open', () => {
    // The flag arrives from the environment as a STRING, never as a boolean. Under
    // z.coerce.boolean() every non-empty string is true, so `=false` — the value
    // .env.example ships — silently switched the exception ON whenever an approval ref
    // happened to be set. The other exception tests pass a real boolean and so cannot
    // see this. Parse from strings here, the way a container actually boots.
    const parse = (value: string) =>
      aiGatewayConfigSchema.parse({
        ...validProduction,
        SERVICE_NAME: 'ai-gateway',
        AI_GLOBAL_INFERENCE_PROFILE_APPROVED: value,
      }).AI_GLOBAL_INFERENCE_PROFILE_APPROVED;

    assert.equal(parse('true'), true);
    assert.equal(parse('false'), false);
    // Anything that is not true/false is refused outright rather than guessed at.
    for (const junk of ['0', '1', 'no', 'yes']) {
      assert.throws(() => parse(junk), `expected the schema to reject ${junk}`);
    }
  });

  it('ships an approved-model default that passes production validation', () => {
    // The config services validate the *parsed* config
    // (safeParse(process.env) -> validateProductionConfig), so a schema default
    // reaches production boot whenever APPROVED_AI_MODEL_IDS is unset. Every other
    // allowlist test above passes the value explicitly, so nothing exercised the
    // shipped default against the `global.` rule — and the default contained
    // `global.` profiles, failing AI Gateway boot on any deploy that did not
    // override it. Parse first; do not hand-write the allowlist here.
    const parsed = aiGatewayConfigSchema.parse({
      ...validProduction,
      SERVICE_NAME: 'ai-gateway',
      MODEL_PROVIDER: 'bedrock',
      BEDROCK_REGION: 'ap-southeast-1',
      BEDROCK_MODEL_ID: DEFAULT_APPROVED_AI_MODEL_IDS.split(',')[0],
    });
    assert.doesNotThrow(() => validateProductionConfig(parsed as unknown as Record<string, unknown>));

    // The API schema carries its own copy of the same key; keep them in lockstep.
    const api = apiConfigSchema.parse(validProduction);
    assert.equal(api.APPROVED_AI_MODEL_IDS, DEFAULT_APPROVED_AI_MODEL_IDS);
    assert.equal(parsed.APPROVED_AI_MODEL_IDS, DEFAULT_APPROVED_AI_MODEL_IDS);
  });

  // Metering spec §7.4 — the first numeric-comparison rule in this engine.
  it('rejects an AI monthly budget ceiling below the platform default', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          ...validProduction,
          AI_MONTHLY_BUDGET_SATANG: 200000,
          AI_MONTHLY_BUDGET_SATANG_CEILING: 100000,
        }),
      /AI_MONTHLY_BUDGET_SATANG_CEILING must be >= AI_MONTHLY_BUDGET_SATANG/,
    );
  });

  it('accepts a ceiling equal to or above the default, and skips the rule when neither key is present', () => {
    for (const ceiling of [200000, 1000000]) {
      assert.doesNotThrow(() =>
        validateProductionConfig({
          ...validProduction,
          AI_MONTHLY_BUDGET_SATANG: 200000,
          AI_MONTHLY_BUDGET_SATANG_CEILING: ceiling,
        }),
      );
    }
    // Gateway/workers configs carry neither key; a NaN comparison must not invent an error.
    assert.doesNotThrow(() => validateProductionConfig(validProduction));
  });

  it('names only the budget keys, never the configured amounts', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          ...validProduction,
          AI_MONTHLY_BUDGET_SATANG: 424242,
          AI_MONTHLY_BUDGET_SATANG_CEILING: 131313,
        }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.equal(message.includes('424242'), false, 'a rule must name keys, not echo values');
        assert.equal(message.includes('131313'), false);
        return true;
      },
    );
  });

  it('ships defaults that satisfy the ceiling rule at boot', () => {
    const parsed = apiConfigSchema.parse(validProduction);
    assert.equal(parsed.AI_MONTHLY_BUDGET_SATANG, 200000);
    assert.equal(parsed.AI_MONTHLY_BUDGET_SATANG_CEILING, 1000000);
    assert.doesNotThrow(() => validateProductionConfig(parsed as unknown as Record<string, unknown>));
  });

  it('collects multiple errors in one throw', () => {
    assert.throws(
      () =>
        validateProductionConfig({
          APP_ENV: 'production',
          AUTH_PROVIDER: 'dev',
          DEV_AUTH_ENABLED: true,
          CORS_ALLOWED_ORIGINS: '',
          AUDIT_ENABLED: false,
          LOG_REDACTION_ENABLED: false,
        }),
      /Production config validation failed/,
    );
  });
});

describe('aiGatewayConfigSchema – item 10B new keys', () => {
  const base = { APP_ENV: 'local', SERVICE_NAME: 'ai-gateway', PORT: 3002 };

  it('accepts an Anthropic API key only in local mode', () => {
    const local = aiGatewayConfigSchema.parse({ ...base, ANTHROPIC_API_KEY: ' test-key \n' });
    assert.equal(local.ANTHROPIC_API_KEY, 'test-key');
    assert.equal(aiGatewayConfigSchema.parse(base).ANTHROPIC_API_KEY, undefined);
    assert.equal(aiGatewayConfigSchema.safeParse({ ...base, ANTHROPIC_API_KEY: ' ' }).success, false);
    assert.equal(aiGatewayConfigSchema.safeParse({ ...base, APP_ENV: 'uat', ANTHROPIC_API_KEY: 'test-key' }).success, false);
    // Deployed UAT uses APP_ENV=production plus DEPLOY_ENVIRONMENT=uat.
    for (const DEPLOY_ENVIRONMENT of ['uat', 'production']) {
      const result = aiGatewayConfigSchema.safeParse({ ...base, APP_ENV: 'production', DEPLOY_ENVIRONMENT, ANTHROPIC_API_KEY: 'test-key' });
      assert.equal(result.success, false);
      if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path[0] === 'ANTHROPIC_API_KEY' && issue.message.includes('local only')));
      assert.equal(aiGatewayConfigSchema.safeParse({ ...base, APP_ENV: 'production', DEPLOY_ENVIRONMENT }).success, true);
    }
  });

  it('caps AI_MAX_TOOL_CALLS at the eight-delegation M-01 budget', () => {
    assert.equal(aiGatewayConfigSchema.safeParse({ ...base, AI_MAX_TOOL_CALLS: 8 }).success, true);
    assert.equal(aiGatewayConfigSchema.safeParse({ ...base, AI_MAX_TOOL_CALLS: 9 }).success, false);
  });

  it('defaults LINE_AI_AGENT_ORCHESTRATION_ENABLED to true (owner 2026-09-29: always on)', () => {
    const result = aiGatewayConfigSchema.safeParse(base);
    assert.equal(result.success, true);
    assert.equal(result.data?.LINE_AI_AGENT_ORCHESTRATION_ENABLED, true);
  });

  it('defaults the remaining Phase 3/6 shadow flags OFF; PREPARED_SIMPLE_READ_ENABLED and its R-L4 family allowlist default ON (owner policy 2026-09-27, no manual rollout)', () => {
    const parsed = aiGatewayConfigSchema.parse(base);
    assert.equal(parsed.LINE_AI_FUSED_PLAN_SHADOW_ENABLED, false);
    assert.equal(parsed.LINE_AI_PREPARED_SIMPLE_READ_ENABLED, true);
    assert.equal(parsed.LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES,
      'sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,'
      + 'expense.get_daily_closing::single_metric,expense.list_recent::list,expense.get_breakdown::list,'
      + 'reimbursement.list_pending_approvals::list,reimbursement.get_summary::single_metric,'
      + 'expense.get_detail::single_metric,reimbursement.get_detail::single_metric');
    assert.equal(parsed.LINE_AI_PROVIDER_CLIENT_REUSE_ENABLED, false);
    assert.equal(parsed.LINE_AI_AGENTCORE_SESSION_AFFINITY_ENABLED, false);
    assert.equal(parsed.LINE_AI_SMALL_ROUTER_SHADOW_ENABLED, false);
  });

  it('parses an explicit deterministic-family allowlist as a comma list', () => {
    const parsed = aiGatewayConfigSchema.parse({ ...base, LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES: 'single_metric, list' });
    assert.equal(parsed.LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES, 'single_metric, list');
  });

  it('defaults LINE_AI_AGENT_RUNTIME to disabled', () => {
    const result = aiGatewayConfigSchema.safeParse(base);
    assert.equal(result.success, true);
    assert.equal(result.data?.LINE_AI_AGENT_RUNTIME, 'disabled');
  });

  it('defaults AWS_SDK_LOAD_CONFIG to false', () => {
    const result = aiGatewayConfigSchema.safeParse(base);
    assert.equal(result.success, true);
    assert.equal(result.data?.AWS_SDK_LOAD_CONFIG, false);
  });

  it('accepts LINE_AI_AGENT_ORCHESTRATION_ENABLED=true', () => {
    const result = aiGatewayConfigSchema.safeParse({ ...base, LINE_AI_AGENT_ORCHESTRATION_ENABLED: 'true' });
    assert.equal(result.success, true);
    assert.equal(result.data?.LINE_AI_AGENT_ORCHESTRATION_ENABLED, true);
  });

  it('accepts LINE_AI_AGENT_RUNTIME=strands-local', () => {
    const result = aiGatewayConfigSchema.safeParse({ ...base, LINE_AI_AGENT_RUNTIME: 'strands-local' });
    assert.equal(result.success, true);
    assert.equal(result.data?.LINE_AI_AGENT_RUNTIME, 'strands-local');
  });

  it('rejects invalid LINE_AI_AGENT_RUNTIME value', () => {
    const result = aiGatewayConfigSchema.safeParse({ ...base, LINE_AI_AGENT_RUNTIME: 'openai-agents' });
    assert.equal(result.success, false);
  });

  it('accepts optional AWS_PROFILE', () => {
    const result = aiGatewayConfigSchema.safeParse({ ...base, AWS_PROFILE: 'watchdog-bedrock' });
    assert.equal(result.success, true);
    assert.equal(result.data?.AWS_PROFILE, 'watchdog-bedrock');
  });

  it('accepts LINE_AI_AGENT_RUNTIME=agentcore', () => {
    const result = aiGatewayConfigSchema.safeParse({ ...base, LINE_AI_AGENT_RUNTIME: 'agentcore' });
    assert.equal(result.success, true);
    assert.equal(result.data?.LINE_AI_AGENT_RUNTIME, 'agentcore');
  });

  it('defaults AGENTCORE_INVOKE_TIMEOUT_MS to 20000', () => {
    const result = aiGatewayConfigSchema.safeParse(base);
    assert.equal(result.success, true);
    assert.equal(result.data?.AGENTCORE_INVOKE_TIMEOUT_MS, 20000);
  });

  it('accepts optional AgentCore region/arn/qualifier', () => {
    const result = aiGatewayConfigSchema.safeParse({
      ...base,
      AGENTCORE_REGION: 'ap-southeast-1',
      AGENTCORE_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:ap-southeast-1:123:runtime/abc',
      AGENTCORE_RUNTIME_QUALIFIER: 'DEFAULT',
      AGENTCORE_EXPECTED_SOURCE_COMMIT: 'a'.repeat(40),
      AGENTCORE_EXPECTED_ARTIFACT_SHA256: 'b'.repeat(64),
      AGENTCORE_EXPECTED_CONTRACT_VERSION: '1',
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.AGENTCORE_REGION, 'ap-southeast-1');
    assert.equal(result.data?.AGENTCORE_RUNTIME_QUALIFIER, 'DEFAULT');
    assert.equal(result.data?.AGENTCORE_EXPECTED_CONTRACT_VERSION, 1);
  });
});

describe('apiConfigSchema LINE draft edit rollout gate (S-4)', () => {
  const base = { APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://local', S3_BUCKET: 'local' };
  it('defaults the LINE draft edit lane on in both services', () => {
    assert.equal(apiConfigSchema.parse(base).LINE_AI_DRAFT_EDIT_ENABLED, true);
    assert.equal(aiGatewayConfigSchema.parse({ ...base, SERVICE_NAME: 'ai-gateway' }).LINE_AI_DRAFT_EDIT_ENABLED, true);
  });
  it('accepts an explicit UAT enable on both services', () => {
    assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_DRAFT_EDIT_ENABLED: 'true' }).LINE_AI_DRAFT_EDIT_ENABLED, true);
    assert.equal(
      aiGatewayConfigSchema.parse({ ...base, SERVICE_NAME: 'ai-gateway', LINE_AI_DRAFT_EDIT_ENABLED: 'true' }).LINE_AI_DRAFT_EDIT_ENABLED,
      true,
    );
  });
  it('preserves an explicit off in both services', () => {
    for (const schema of [apiConfigSchema, aiGatewayConfigSchema]) {
      assert.equal(schema.parse({ ...base, LINE_AI_DRAFT_EDIT_ENABLED: 'false' }).LINE_AI_DRAFT_EDIT_ENABLED, false);
    }
  });
  it('refuses a non-boolean spelling rather than treating it as truthy', () => {
    assert.equal(apiConfigSchema.safeParse({ ...base, LINE_AI_DRAFT_EDIT_ENABLED: 'yes' }).success, false);
  });
});

describe('apiConfigSchema LINE expense draft rollout gate', () => {
  const base = { APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://local', S3_BUCKET: 'local' };

  it('defaults the unproven LINE expense conversation off', () => {
    assert.equal(apiConfigSchema.parse(base).LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED, false);
  });

  it('accepts an explicit UAT enable', () => {
    assert.equal(apiConfigSchema.parse({ ...base, LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED: 'true' }).LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED, true);
  });
});

describe('apiConfigSchema LINE AI latency/autonomy Phase-1 flags', () => {
  const base = { APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://local', S3_BUCKET: 'local' };

  it('defaults every new flag OFF and leaves the debounce default and experiment secret unset', () => {
    const parsed = apiConfigSchema.parse(base);
    assert.equal(parsed.LINE_AI_LOADING_ON_ACCEPT_ENABLED, false);
    assert.equal(parsed.LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED, false);
    assert.equal(parsed.LINE_AI_DEBOUNCE_EXPERIMENT_SECRET, undefined);
    // Phase 3 shadow-forwarding gate defaults off (API forwards nothing extra unless it is on).
    assert.equal(parsed.LINE_AI_FUSED_PLAN_SHADOW_ENABLED, false);
    // Phase 4 forwarding defaults ON (owner policy 2026-09-27, spec R-L4: no manual rollout gate) —
    // the gateway alone still decides whether to execute from the forwarded plan.
    assert.equal(parsed.LINE_AI_PREPARED_SIMPLE_READ_ENABLED, true);
    // Substitute semantic routing defaults to the exact legacy regex-first behavior.
    assert.equal(parsed.LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE, 'off');
    // Default debounce keeps multi-bubble joining while starting work after 2 seconds of quiet.
    assert.equal(parsed.LINE_AI_BUFFER_DEBOUNCE_MS, 2000);
  });

  it('enabling the experiment without a secret still parses (the buffer then keeps the configured debounce)', () => {
    const parsed = apiConfigSchema.parse({ ...base, LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED: 'true' });
    assert.equal(parsed.LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED, true);
    assert.equal(parsed.LINE_AI_DEBOUNCE_EXPERIMENT_SECRET, undefined);
    assert.equal(parsed.LINE_AI_BUFFER_DEBOUNCE_MS, 2000);
  });

  it('accepts explicit opt-in values', () => {
    const parsed = apiConfigSchema.parse({ ...base, LINE_AI_LOADING_ON_ACCEPT_ENABLED: 'true', LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED: 'true', LINE_AI_DEBOUNCE_EXPERIMENT_SECRET: 's3cr3t' });
    assert.equal(parsed.LINE_AI_LOADING_ON_ACCEPT_ENABLED, true);
    assert.equal(parsed.LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED, true);
    assert.equal(parsed.LINE_AI_DEBOUNCE_EXPERIMENT_SECRET, 's3cr3t');
  });

  it('accepts the three substitute semantic-routing modes and rejects an unknown one', () => {
    for (const mode of ['off', 'shadow', 'primary'] as const) {
      assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE: mode }).LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE, mode);
    }
    assert.equal(apiConfigSchema.safeParse({ ...base, LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE: 'canary' }).success, false);
  });

  it('reimbursement semantic intake defaults off and accepts only its four modes', () => {
    assert.equal(apiConfigSchema.parse(base).LINE_AI_REIMBURSEMENT_SEMANTIC_MODE, 'off');
    for (const mode of ['off', 'shadow', 'clarify_only', 'handoff'] as const) {
      assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_REIMBURSEMENT_SEMANTIC_MODE: mode }).LINE_AI_REIMBURSEMENT_SEMANTIC_MODE, mode);
    }
    // 'primary' is deliberately NOT a mode: the safe rollback target is clarify_only, never a bare primary.
    assert.equal(apiConfigSchema.safeParse({ ...base, LINE_AI_REIMBURSEMENT_SEMANTIC_MODE: 'primary' }).success, false);
    assert.equal(apiConfigSchema.safeParse({ ...base, LINE_AI_REIMBURSEMENT_SEMANTIC_MODE: 'true' }).success, false);
  });

  it('neutral intake state defaults off, accepts its three modes, and FAILS closed on anything else', () => {
    assert.equal(apiConfigSchema.parse(base).LINE_AI_INTAKE_STATE_MODE, 'off');
    for (const mode of ['off', 'shadow', 'on'] as const) {
      assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_INTAKE_STATE_MODE: mode }).LINE_AI_INTAKE_STATE_MODE, mode);
    }
    // This flag guards a money path, so an unparsable value must break the boot rather than land
    // on a mode the operator did not choose. 'true'/'1'/'enabled' are the plausible typos that a
    // boolean-shaped flag would have silently accepted as ON — here they must all fail.
    for (const bad of ['true', '1', 'enabled', 'On', 'primary', 'all', '']) {
      assert.equal(apiConfigSchema.safeParse({ ...base, LINE_AI_INTAKE_STATE_MODE: bad }).success, false, bad);
    }
  });


  it('has no multi-part terminal Flex switch: card replies are always on', () => {
    const retiredKey = 'LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED';
    assert.equal(retiredKey in apiConfigSchema.shape, false);
    for (const value of ['true', 'false', 'invalid']) {
      assert.equal(retiredKey in apiConfigSchema.parse({ ...base, [retiredKey]: value }), false);
    }
  });

  it('durable terminal-outcome replay defaults on and honors an explicit off', () => {
    assert.equal(apiConfigSchema.parse(base).LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED, true);
    assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED: 'true' }).LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED, true);
    assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED: 'false' }).LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED, false);
  });

  it('has no CHAT/OCR split activation switch: SPLIT is always savable (owner 2026-09-29)', () => {
    // A deploy that still carries the retired key must parse (zod drops unknown keys) and never
    // surface it, so an old ECS baseline cannot bring the switch back.
    assert.equal('AI_BUDGET_SPLIT_ACTIVATION_ENABLED' in apiConfigSchema.shape, false);
    assert.equal('AI_BUDGET_SPLIT_ACTIVATION_ENABLED' in apiConfigSchema.parse({ ...base, AI_BUDGET_SPLIT_ACTIVATION_ENABLED: 'true' }), false);
  });

  it('buyer expense capture: intake ON by default, bounded page/concurrency/retention numbers', () => {
    // Appendix §6/§15 item 2: the intake gate ships ON in both environments, like the rest of the
    // receipt lane. The three numbers are bounded so a mistyped deploy input cannot ask the reader
    // for 5,000 pages or 64 parallel jobs — it fails the parse instead.
    const parsed = apiConfigSchema.parse(base);
    assert.equal(parsed.EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED, true);
    assert.equal(parsed.EXPENSE_CAPTURE_PDF_MAX_PAGES, 60);
    assert.equal(parsed.EXPENSE_CAPTURE_READ_CONCURRENCY, 2);
    assert.equal(parsed.EXPENSE_CAPTURE_RETENTION_DAYS, 90);
    assert.equal(apiConfigSchema.parse({ ...base, EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED: 'false' }).EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED, false);
    assert.equal(apiConfigSchema.parse({ ...base, EXPENSE_CAPTURE_PDF_MAX_PAGES: '200' }).EXPENSE_CAPTURE_PDF_MAX_PAGES, 200);
    for (const invalid of [
      { EXPENSE_CAPTURE_PDF_MAX_PAGES: '0' }, { EXPENSE_CAPTURE_PDF_MAX_PAGES: '201' },
      { EXPENSE_CAPTURE_READ_CONCURRENCY: '0' }, { EXPENSE_CAPTURE_READ_CONCURRENCY: '5' },
      { EXPENSE_CAPTURE_RETENTION_DAYS: '6' }, { EXPENSE_CAPTURE_RETENTION_DAYS: '3651' },
    ]) {
      assert.equal(apiConfigSchema.safeParse({ ...base, ...invalid }).success, false, JSON.stringify(invalid));
    }
  });

  it('Flex→text delivery fallback defaults off and opts in only on an explicit boolean', () => {
    assert.equal(apiConfigSchema.parse(base).LINE_AI_FLEX_TEXT_FALLBACK_ENABLED, false);
    assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_FLEX_TEXT_FALLBACK_ENABLED: 'true' }).LINE_AI_FLEX_TEXT_FALLBACK_ENABLED, true);
    assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_FLEX_TEXT_FALLBACK_ENABLED: 'false' }).LINE_AI_FLEX_TEXT_FALLBACK_ENABLED, false);
  });

  it('advisor mode defaults off, accepts only its four stages, and FAILS closed on anything else', () => {
    assert.equal(apiConfigSchema.parse(base).LINE_AI_ADVISOR_MODE, 'off');
    for (const mode of ['off', 'social', 'knowledge', 'company'] as const) {
      assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_ADVISOR_MODE: mode }).LINE_AI_ADVISOR_MODE, mode);
    }
    // A typo or a removed stage must break the boot, never silently land on a MORE permissive stage.
    for (const bad of ['shadow', 'Social', 'true', '1', 'all', '']) {
      assert.equal(apiConfigSchema.safeParse({ ...base, LINE_AI_ADVISOR_MODE: bad }).success, false, bad);
    }
  });

  it('advisor direct-answer kill switch defaults off and opts in only on an explicit boolean', () => {
    // RESERVED / INERT in Slice A: parsed for a stable env contract, with no runtime consumer yet.
    assert.equal(apiConfigSchema.parse(base).LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED, false);
    assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED: 'true' }).LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED, true);
    assert.equal(apiConfigSchema.parse({ ...base, LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED: 'false' }).LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED, false);
  });
});

describe('apiConfigSchema CRM AI confidence', () => {
  const base = { APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://localhost/test', S3_BUCKET: 'test' };

  it('defaults CRM_AI_MIN_CONFIDENCE to 0.7', () => {
    assert.equal(apiConfigSchema.parse(base).CRM_AI_MIN_CONFIDENCE, 0.7);
  });

  it('parses CRM_AI_MIN_CONFIDENCE from the environment', () => {
    assert.equal(apiConfigSchema.parse({ ...base, CRM_AI_MIN_CONFIDENCE: '0.8' }).CRM_AI_MIN_CONFIDENCE, 0.8);
  });
});

describe('apiConfigSchema CRM autonomous outbound domains', () => {
  const base = { APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://localhost/test', S3_BUCKET: 'test' };

  it('fails closed with an empty default and preserves an explicit allowlist', () => {
    assert.equal(apiConfigSchema.parse(base).CRM_AI_OUTBOUND_ALLOWED_DOMAINS, '');
    assert.equal(
      apiConfigSchema.parse({ ...base, CRM_AI_OUTBOUND_ALLOWED_DOMAINS: 'shop.example.com,*.cdn.example.com' })
        .CRM_AI_OUTBOUND_ALLOWED_DOMAINS,
      'shop.example.com,*.cdn.example.com',
    );
  });
});

describe('apiConfigSchema attachment upload controls', () => {
  const base = { APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://localhost/test', S3_BUCKET: 'test' };

  it('accepts an optional browser-reachable S3 endpoint', () => {
    assert.equal(apiConfigSchema.parse(base).S3_PUBLIC_ENDPOINT, undefined);
    assert.equal(
      apiConfigSchema.parse({ ...base, S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:19000' }).S3_PUBLIC_ENDPOINT,
      'http://127.0.0.1:19000',
    );
  });

  it('defaults upload intents to a five-minute TTL and 100 MiB tenant pending quota', () => {
    const config = apiConfigSchema.parse(base);
    assert.equal(config.SIGNED_URL_TTL_SECONDS, 300);
    assert.equal(config.UPLOAD_PENDING_MAX_BYTES_PER_COMPANY, 100 * 1024 * 1024);
  });

  it('rejects upload-intent TTLs longer than five minutes', () => {
    assert.throws(() => apiConfigSchema.parse({ ...base, SIGNED_URL_TTL_SECONDS: 301 }));
  });
});

describe('apiConfigSchema PDPA pseudonymization key rotation', () => {
  const base = { APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://localhost/test', S3_BUCKET: 'test' };

  it('accepts an optional comma-separated previous-key ring', () => {
    const first = '11'.repeat(32);
    const second = '22'.repeat(32);
    assert.equal(
      apiConfigSchema.parse({ ...base, PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS: `${first}, ${second}` })
        .PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS,
      `${first}, ${second}`,
    );
  });

  it('accepts a dedicated current key', () => {
    const current = '33'.repeat(32);
    assert.equal(
      apiConfigSchema.parse({ ...base, PDPA_PSEUDONYMIZATION_KEY: current }).PDPA_PSEUDONYMIZATION_KEY,
      current,
    );
  });

  it('rejects malformed previous keys', () => {
    assert.throws(
      () => apiConfigSchema.parse({ ...base, PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS: 'not-a-64-hex-key' }),
      /comma-separated 64-character lowercase hex keys/,
    );
  });
});

describe('local env accepts .env.example values', () => {
  it('does not throw for local APP_ENV with dev values', () => {
    assert.doesNotThrow(() =>
      validateProductionConfig({
        APP_ENV: 'local',
        AUTH_PROVIDER: 'dev',
        DEV_AUTH_ENABLED: true,
        CORS_ALLOWED_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000',
        AUDIT_ENABLED: true,
        LOG_REDACTION_ENABLED: true,
      }),
    );
  });
});

// L-03: the committed .env.example is read from disk so the rules are proven against the
// real values, not against a copy that can drift.
const envExample = (() => {
  const raw = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
  const entries = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) entries.set(match[1], match[2]);
  }
  return entries;
})();

describe('validateProductionConfig – L-03 secret entropy, denylist, lifecycle', () => {
  it('rejects every secret value committed in .env.example', () => {
    for (const key of [
      'WORKER_INTERNAL_TOKEN',
      'AI_GATEWAY_INTERNAL_SECRET',
      'WATCHDOG_JWT_SECRET_ARN',
      'AI_ACTOR_DELEGATION_SIGNING_KEY',
      'S3_SECRET_ACCESS_KEY',
    ]) {
      const committed = envExample.get(key);
      assert.ok(committed, `${key} must still be committed in .env.example`);
      assert.throws(
        () => validateProductionConfig({ ...validProduction, [key]: committed }),
        new RegExp(key),
        `${key} committed .env.example value must be rejected in production`,
      );
    }
  });

  it('rejects the committed .env.example DEV_AUTH_SECRET and local data URLs', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, DEV_AUTH_SECRET: envExample.get('DEV_AUTH_SECRET') }),
      /DEV_AUTH_SECRET must not be set in production/,
    );
    assert.throws(
      () => validateProductionConfig({ ...validProduction, DATABASE_URL: envExample.get('DATABASE_URL') }),
      /DATABASE_URL must not point at localhost in production/,
    );
    assert.throws(
      () => validateProductionConfig({ ...validProduction, REDIS_URL: envExample.get('REDIS_URL') }),
      /REDIS_URL must not point at localhost in production/,
    );
  });

  it('rejects a committed credential embedded in a remote DSN', () => {
    assert.throws(
      () => validateProductionConfig({
        ...validProduction,
        DATABASE_URL: 'postgresql://watchdog:watchdog_local_password@db.internal:5432/watchdog_bms',
      }),
      /DATABASE_URL embeds a known local\/default credential/,
    );
  });

  it('rejects the repeated-pattern hex key committed in .env.example (period 16)', () => {
    const committed = envExample.get('AI_ACTOR_DELEGATION_SIGNING_KEY');
    assert.equal(committed?.length, 64, 'the committed value is a well-formed 64-hex key');
    assert.throws(
      () => validateProductionConfig({ ...validProduction, AI_ACTOR_DELEGATION_SIGNING_KEY: committed }),
      /AI_ACTOR_DELEGATION_SIGNING_KEY has too little entropy/,
    );
  });

  it('rejects hand-made secrets that clear the length and denylist rules', () => {
    // Each of these passed the original entropy check: a cycle whose length does not divide the
    // total, a repeated block with one character appended, a low-alphabet value sitting exactly
    // on the old distinct-character floor, and a plain alphabet walk.
    const handMade = [
      '12345678901234567890123456789012',
      'abcdefgh12345678abcdefgh12345678a',
      'aaaabbbbccccddddeeeeffffgggghhhh',
      'abcdefghijklmnopqrstuvwxyz012345',
    ];
    for (const value of handMade) {
      assert.throws(
        () => validateProductionConfig({ ...validProduction, WORKER_INTERNAL_TOKEN: value }),
        /WORKER_INTERNAL_TOKEN has too little entropy/,
        `expected rejection for ${value.slice(0, 8)}…`,
      );
    }
  });

  it('does not reject genuinely random secrets', () => {
    // The entropy rules fail closed at boot, so a false rejection is a production outage.
    // Sample rather than assert once: a rule that fires on 1-in-200 random values would
    // otherwise look green here and brick a deploy later.
    for (let i = 0; i < 200; i += 1) {
      assert.doesNotThrow(() => validateProductionConfig({
        ...validProduction,
        // Hex keeps this entropy stress test independent from the semantic denylist: unrestricted
        // Base64 can randomly spell `todo`, `local`, or another deliberately rejected word.
        WORKER_INTERNAL_TOKEN: randomBytes(24).toString('hex'),
        CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      }));
    }
  });

  it('rejects every loopback spelling in a production data URL', () => {
    for (const host of ['LOCALHOST', 'localhost', '127.0.0.1', '[::1]', '0.0.0.0', 'host.docker.internal']) {
      assert.throws(
        () => validateProductionConfig({
          ...validProduction,
          DATABASE_URL: `postgresql://app:9fKq2Wm7@${host}:5432/watchdog`,
        }),
        /DATABASE_URL must not point at localhost in production/,
        `expected rejection for ${host}`,
      );
    }
  });

  it('rejects a low-distinct-character hex key', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, CREDENTIAL_ENCRYPTION_KEY: '11'.repeat(32) }),
      /CREDENTIAL_ENCRYPTION_KEY has too little entropy/,
    );
  });

  it('rejects a repo-generated secret shorter than 32 characters', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, WORKER_INTERNAL_TOKEN: 'k7Qm2Vx9Rt4Zw1Ns' }),
      /WORKER_INTERNAL_TOKEN must be at least 32 characters/,
    );
  });

  it('rejects a third-party secret shorter than 16 characters', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, LINE_MESSAGING_CHANNEL_SECRET: 'k7Qm2Vx9Rt4Zw' }),
      /LINE_MESSAGING_CHANNEL_SECRET must be at least 16 characters/,
    );
  });

  it('names the key and never echoes the secret value', () => {
    const weak = 'changeme-changeme-changeme-abcd';
    assert.throws(
      () => validateProductionConfig({ ...validProduction, AI_GATEWAY_INTERNAL_SECRET: weak }),
      (error: Error) => {
        assert.match(error.message, /AI_GATEWAY_INTERNAL_SECRET/);
        assert.ok(!error.message.includes(weak), 'the secret value must not appear in the error');
        assert.ok(!error.message.includes('changeme'), 'no fragment of the secret value may appear');
        return true;
      },
    );
  });

  it('does not treat identifiers as secrets', () => {
    assert.doesNotThrow(() => validateProductionConfig({
      ...validProduction,
      LINE_LOGIN_CHANNEL_ID: '1234567890',
      LINE_MESSAGING_CHANNEL_ID: '1234567890',
      LINE_LIFF_ID: '1234567890-abcdefgh',
      S3_ACCESS_KEY_ID: 'AKIALOCALEXAMPLE',
    }));
  });

  it('accepts genuinely random high-entropy secrets', () => {
    assert.doesNotThrow(() => validateProductionConfig({
      ...validProduction,
      WORKER_INTERNAL_TOKEN: randomBytes(24).toString('base64url'),
      AI_GATEWAY_INTERNAL_SECRET: randomBytes(24).toString('base64url'),
      WATCHDOG_JWT_SECRET_ARN: randomBytes(24).toString('base64url'),
      AI_ACTOR_DELEGATION_SIGNING_KEY: randomBytes(32).toString('hex'),
      CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      PDPA_PSEUDONYMIZATION_KEY: randomBytes(32).toString('hex'),
      LINE_LOGIN_CHANNEL_SECRET: randomBytes(16).toString('hex'),
      LINE_MESSAGING_CHANNEL_SECRET: randomBytes(16).toString('hex'),
      LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: randomBytes(32).toString('base64url'),
    }));
  });

  it('forbids SEED_SYSTEM_ADMIN_PASSWORD in production', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, SEED_SYSTEM_ADMIN_PASSWORD: randomBytes(18).toString('base64url') }),
      /SEED_SYSTEM_ADMIN_PASSWORD must not be set in production/,
    );
    assert.doesNotThrow(() => validateProductionConfig({ ...validProduction, SEED_SYSTEM_ADMIN_PASSWORD: '' }));
  });
});

describe('validateProductionConfig – L-03 closes the gateway and workers holes', () => {
  const productionAiGateway = (): Record<string, unknown> => ({
    APP_ENV: 'production',
    DEPLOY_ENVIRONMENT: 'production',
    SERVICE_NAME: 'ai-gateway',
    SERVICE_VERSION: '0.1.0',
    GIT_SHA: PRODUCTION_GIT_SHA,
    PUBLIC_BASE_URL: 'https://ai.example.com',
    CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    LOG_FORMAT: 'json',
    LOG_LEVEL: 'info',
    LOG_REDACTION_ENABLED: true,
    MODEL_PROVIDER: 'disabled',
    AI_GATEWAY_ENABLED: false,
    AI_TOOL_POLICY_ENFORCED: true,
    AI_TOOL_AUDIT_ENABLED: true,
    AI_FINAL_MUTATION_ENABLED: false,
    AI_PROMPT_LOGGING_ENABLED: false,
    AI_GATEWAY_INTERNAL_SECRET: 'gA4x8M1q6V3n9C2r7T5p0K8s1D6h4J9z',
    // present in every parsed gateway config because the schema defaults it
    JWT_CLOCK_TOLERANCE_SECONDS: 30,
    WATCHDOG_JWT_SECRET_ARN: 'arn:aws:secretsmanager:ap-southeast-1:123:secret:jwt',
    WATCHDOG_JWT_ISSUER: 'https://api.example.com',
    WATCHDOG_JWT_AUDIENCE: 'watchdog-bms',
  });

  const productionWorkers = (): Record<string, unknown> => ({
    APP_ENV: 'production',
    DEPLOY_ENVIRONMENT: 'production',
    SERVICE_NAME: 'workers',
    SERVICE_VERSION: '0.1.0',
    GIT_SHA: PRODUCTION_GIT_SHA,
    PUBLIC_BASE_URL: 'https://api.example.com',
    LOG_FORMAT: 'json',
    LOG_LEVEL: 'info',
    LOG_REDACTION_ENABLED: true,
    DATABASE_URL: 'postgresql://watchdog:pW9xK2mQ7v@db.internal:5432/watchdog_bms',
    REDIS_URL: 'redis://cache.internal:6379',
    S3_BUCKET: 'watchdog-prod',
    PRODUCTION_SERVING_MODE: 'live',
    // present in every parsed workers config because the schema defaults it
    QUEUE_ENABLED: true,
    WORKER_INTERNAL_TOKEN: 'wK7m2Q9v4X8c1L6p3R5t0N2s7H9j4F6a',
  });

  it('accepts a well-configured production gateway and workers process', () => {
    assert.doesNotThrow(() => validateProductionConfig(productionAiGateway()));
    assert.doesNotThrow(() => validateProductionConfig(productionWorkers()));
  });

  it('accepts a production AI Gateway without WATCHDOG_JWT_SECRET_ARN', () => {
    const { WATCHDOG_JWT_SECRET_ARN: _omitted, ...withoutArn } = productionAiGateway();
    assert.doesNotThrow(() => validateProductionConfig(withoutArn));
    assert.doesNotThrow(() => validateProductionConfig(aiGatewayConfigSchema.parse(withoutArn)));
    assert.doesNotThrow(() => validateProductionConfig({ ...withoutArn, WATCHDOG_JWT_SECRET_ARN: '' }));
  });

  it('still requires WATCHDOG_JWT_SECRET_ARN for a production API', () => {
    const { WATCHDOG_JWT_SECRET_ARN: _omitted, ...withoutArn } = validProduction;
    for (const config of [withoutArn, apiConfigSchema.parse(withoutArn), { ...withoutArn, WATCHDOG_JWT_SECRET_ARN: '' }]) {
      assert.throws(() => validateProductionConfig(config), /WATCHDOG_JWT_SECRET_ARN is required in production/);
    }
  });

  // L-04: every verifier pins iss/aud, falling back to the shared non-secret defaults, while the
  // API signs with its own configured values. A gateway deployed without these two would pin the
  // defaults and reject every real token — so the requirement follows the JWT secret, not the API.
  it('requires WATCHDOG_JWT_ISSUER/AUDIENCE for any process that reads a JWT secret', () => {
    for (const key of ['WATCHDOG_JWT_ISSUER', 'WATCHDOG_JWT_AUDIENCE']) {
      const { [key]: _omitted, ...withoutClaim } = productionAiGateway();
      assert.throws(() => validateProductionConfig(withoutClaim), new RegExp(`${key} is required in production`));
      assert.throws(
        () => validateProductionConfig({ ...productionAiGateway(), [key]: '' }),
        new RegExp(`${key} is required in production`),
      );
      // Still enforced for the API, and still not demanded of a process that verifies nothing.
      const { [key]: _apiOmitted, ...apiWithoutClaim } = validProduction;
      assert.throws(() => validateProductionConfig(apiWithoutClaim), new RegExp(`${key} is required in production`));
      assert.doesNotThrow(() => validateProductionConfig(productionWorkers()));
    }
  });

  it('forbids the DEV_AUTH_SECRET JWT fallback for a production AI Gateway', () => {
    assert.throws(
      () => validateProductionConfig({ ...productionAiGateway(), DEV_AUTH_SECRET: 'local-dev-secret-change-me' }),
      /DEV_AUTH_SECRET must not be set in production/,
    );
  });

  it('requires WORKER_INTERNAL_TOKEN for a production workers process', () => {
    const { WORKER_INTERNAL_TOKEN: _omitted, ...withoutToken } = productionWorkers();
    assert.throws(
      () => validateProductionConfig(withoutToken),
      /WORKER_INTERNAL_TOKEN is required in production/,
    );
    assert.throws(
      () => validateProductionConfig({ ...productionWorkers(), WORKER_INTERNAL_TOKEN: '' }),
      /WORKER_INTERNAL_TOKEN is required in production/,
    );
  });

  it('keeps worker queues exact to the production serving mode', () => {
    const { PRODUCTION_SERVING_MODE: _omitted, ...withoutMode } = productionWorkers();
    assert.throws(
      () => validateProductionConfig(withoutMode),
      /PRODUCTION_SERVING_MODE must be exactly live or maintenance_only/,
    );
    assert.throws(
      () => validateProductionConfig({
        ...productionWorkers(),
        PRODUCTION_SERVING_MODE: 'maintenance_only',
        QUEUE_ENABLED: true,
      }),
      /QUEUE_ENABLED must be false when PRODUCTION_SERVING_MODE=maintenance_only/,
    );
    assert.throws(
      () => validateProductionConfig({
        ...productionWorkers(),
        PRODUCTION_SERVING_MODE: 'live',
        QUEUE_ENABLED: false,
      }),
      /QUEUE_ENABLED must be true when PRODUCTION_SERVING_MODE=live/,
    );
    assert.doesNotThrow(() => validateProductionConfig({
      ...productionWorkers(),
      PRODUCTION_SERVING_MODE: 'maintenance_only',
      QUEUE_ENABLED: false,
    }));
  });

  it('applies the secret rules to the gateway internal secret too', () => {
    assert.throws(
      () => validateProductionConfig({ ...productionAiGateway(), AI_GATEWAY_INTERNAL_SECRET: 'local-ai-internal-secret' }),
      /AI_GATEWAY_INTERNAL_SECRET/,
    );
  });

  // Unset optional secrets are absent from parsed configs. Only the API requires the JWT key.
  it('keeps required API and worker secrets enforced on schema-parsed configs', () => {
    const { WATCHDOG_JWT_SECRET_ARN: _omitted, ...withoutArn } = validProduction;
    const api = apiConfigSchema.parse(withoutArn);
    assert.equal(
      Object.prototype.hasOwnProperty.call(api, 'WATCHDOG_JWT_SECRET_ARN'),
      false,
      'an unset optional secret is absent from the parsed config',
    );
    assert.throws(
      () => validateProductionConfig(api as unknown as Record<string, unknown>),
      /WATCHDOG_JWT_SECRET_ARN is required in production/,
    );

    const workers = workersConfigSchema.parse({
      APP_ENV: 'production',
      SERVICE_NAME: 'workers',
      DATABASE_URL: 'postgresql://watchdog:pW9xK2mQ7v@db.internal:5432/watchdog_bms',
      S3_BUCKET: 'watchdog-prod',
    });
    assert.equal(Object.prototype.hasOwnProperty.call(workers, 'WORKER_INTERNAL_TOKEN'), false);
    assert.throws(
      () => validateProductionConfig(workers as unknown as Record<string, unknown>),
      /WORKER_INTERNAL_TOKEN is required in production/,
    );
  });
});

describe('validateProductionConfig – L-09 log level pin and L-08 API mutation mirror', () => {
  it('rejects LOG_LEVEL=debug in production', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, LOG_LEVEL: 'debug' }),
      /LOG_LEVEL must not be debug in production/,
    );
    assert.doesNotThrow(() => validateProductionConfig({ ...validProduction, LOG_LEVEL: 'info' }));
  });

  it('refuses AI_FINAL_MUTATION_ENABLED=true for the API, not only the gateway', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, AI_FINAL_MUTATION_ENABLED: true }),
      /AI_FINAL_MUTATION_ENABLED must be false in production/,
    );
    assert.throws(
      () => validateProductionConfig({ ...validProduction, AI_FINAL_MUTATION_ENABLED: 'true' }),
      /AI_FINAL_MUTATION_ENABLED must be false in production/,
    );
  });
});

describe('validateProductionConfig – M-09 webhook allowlist deny-all sentinel', () => {
  it('still refuses an unset allowlist, so a dropped key cannot pass as deny-all', () => {
    for (const value of ['', undefined]) {
      assert.throws(
        () => validateProductionConfig({ ...validProduction, WORKFLOW_WEBHOOK_ALLOWED_HOSTS: value }),
        /WORKFLOW_WEBHOOK_ALLOWED_HOSTS is required in production/,
      );
    }
  });

  it('accepts the deny-all sentinel in production, so deny-all needs no invented host', () => {
    for (const value of [WEBHOOK_ALLOWLIST_DENY_ALL, 'NONE', '  none  ']) {
      assert.doesNotThrow(
        () => validateProductionConfig({ ...validProduction, WORKFLOW_WEBHOOK_ALLOWED_HOSTS: value }),
      );
    }
  });

  it('resolves the sentinel to an empty allowlist and leaves real hosts alone', () => {
    assert.deepEqual(parseWebhookAllowedHosts(WEBHOOK_ALLOWLIST_DENY_ALL), []);
    assert.deepEqual(parseWebhookAllowedHosts(' NONE '), []);
    assert.deepEqual(parseWebhookAllowedHosts(''), []);
    assert.deepEqual(
      parseWebhookAllowedHosts('hooks.example.com, *.partner.example'),
      ['hooks.example.com', '*.partner.example'],
    );
    // Only the whole value is the sentinel; alongside a real host it stays an unmatchable entry.
    assert.deepEqual(parseWebhookAllowedHosts('none,hooks.example.com'), ['none', 'hooks.example.com']);
  });
});

/**
 * F1.5.1 item 3 — deployment identity fail-close. `local` / `unknown-build` are what an unlabelled
 * process truthfully is; they are also what a production deploy that forgot to inject the identity
 * would silently RECORD on every launch-gate transition. Production therefore refuses to run.
 */
describe('deployment identity fail-close (F1.5.1)', () => {
  it('keeps the defaults for a local process — nothing to inject, nothing to fail', () => {
    assert.deepEqual(
      resolveDeploymentIdentity({ APP_ENV: 'local' }),
      { targetEnvironment: 'local', buildReleaseId: 'unknown-build' },
    );
    assert.deepEqual(
      resolveDeploymentIdentity({ APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'local', GIT_SHA: 'local' }),
      { targetEnvironment: 'local', buildReleaseId: 'local' },
    );
  });

  it('resolves an injected production identity', () => {
    assert.deepEqual(
      resolveDeploymentIdentity({ APP_ENV: 'production', DEPLOY_ENVIRONMENT: 'uat', GIT_SHA: 'a'.repeat(40) }),
      { targetEnvironment: 'uat', buildReleaseId: 'a'.repeat(40) },
    );
    // IMAGE_DIGEST is the accepted alternative build id.
    assert.equal(
      resolveDeploymentIdentity({
        APP_ENV: 'production',
        DEPLOY_ENVIRONMENT: 'production',
        IMAGE_DIGEST: PRODUCTION_IMAGE_DIGEST,
      }).buildReleaseId,
      PRODUCTION_IMAGE_DIGEST,
    );
  });

  it('refuses a build id that cannot be resolved back to one artifact', () => {
    // Set, and still unusable: a tag prefix, the template the task definition ships, a truncated
    // digest. Each would otherwise be recorded as if it were an immutable build identity.
    for (const [override, expected] of [
      [{ GIT_SHA: 'abc123' }, /GIT_SHA must be the full 40-character lowercase commit sha/],
      [{ GIT_SHA: '9F3C7A1E5B8D26F04AE913C7B52D8A06E4F1C93B' }, /GIT_SHA must be the full 40-character/],
      [{ GIT_SHA: '<GIT_SHA>' }, /GIT_SHA is still an unreplaced <\.\.\.> template placeholder/],
      [{ GIT_SHA: PRODUCTION_GIT_SHA, IMAGE_DIGEST: 'sha256:beef' }, /IMAGE_DIGEST must be sha256: followed by 64/],
    ] as const) {
      assert.throws(
        () => resolveDeploymentIdentity({ APP_ENV: 'production', DEPLOY_ENVIRONMENT: 'production', ...override }),
        expected,
      );
      assert.throws(() => validateProductionConfig({ ...validProduction, ...override }), expected);
    }
    assert.doesNotThrow(
      () => validateProductionConfig({ ...validProduction, IMAGE_DIGEST: PRODUCTION_IMAGE_DIGEST }),
    );
  });

  it('refuses a non-production process that claims a deployed environment', () => {
    // The mirror of the production gap: local security mode, uat-labelled control-plane records.
    for (const declared of ['uat', 'production'] as const) {
      assert.throws(
        () => resolveDeploymentIdentity({ APP_ENV: 'local', DEPLOY_ENVIRONMENT: declared, GIT_SHA: PRODUCTION_GIT_SHA }),
        /DEPLOY_ENVIRONMENT="(uat|production)" requires APP_ENV=production/,
      );
      assert.throws(
        () => resolveDeploymentIdentity({ DEPLOY_ENVIRONMENT: declared }),
        /requires APP_ENV=production \(got no value\)/,
      );
    }
  });

  it('throws under APP_ENV=production when DEPLOY_ENVIRONMENT is missing, local, or unrecognized', () => {
    for (const declared of [undefined, 'local', 'staging', '']) {
      assert.throws(
        () => resolveDeploymentIdentity({ APP_ENV: 'production', DEPLOY_ENVIRONMENT: declared, GIT_SHA: PRODUCTION_GIT_SHA }),
        /DEPLOY_ENVIRONMENT must be "uat" or "production"/,
        `DEPLOY_ENVIRONMENT=${String(declared)} must not resolve to local in production`,
      );
    }
  });

  it('throws under APP_ENV=production when no immutable build id was injected', () => {
    assert.throws(
      () => resolveDeploymentIdentity({ APP_ENV: 'production', DEPLOY_ENVIRONMENT: 'production' }),
      /GIT_SHA or IMAGE_DIGEST must carry an immutable build id/,
    );
    assert.throws(
      () => resolveDeploymentIdentity({ APP_ENV: 'production', DEPLOY_ENVIRONMENT: 'production', GIT_SHA: '   ' }),
      /GIT_SHA or IMAGE_DIGEST must carry an immutable build id/,
    );
  });

  it('fails the same way at boot, through validateProductionConfig', () => {
    assert.throws(
      () => validateProductionConfig({ ...validProduction, DEPLOY_ENVIRONMENT: undefined }),
      /DEPLOY_ENVIRONMENT must be "uat" or "production"/,
    );
    assert.throws(
      () => validateProductionConfig({ ...validProduction, DEPLOY_ENVIRONMENT: 'local' }),
      /DEPLOY_ENVIRONMENT must be "uat" or "production"/,
    );
    assert.throws(
      () => validateProductionConfig({ ...validProduction, GIT_SHA: '', IMAGE_DIGEST: '' }),
      /GIT_SHA or IMAGE_DIGEST must carry an immutable build id/,
    );
    // uat is a legitimate DEPLOY_ENVIRONMENT for an APP_ENV=production task definition.
    assert.doesNotThrow(() => validateProductionConfig({ ...validProduction, DEPLOY_ENVIRONMENT: 'uat' }));
  });

  it('leaves a local boot alone — test:boot runs with APP_ENV=local', () => {
    assert.doesNotThrow(() => validateProductionConfig({ APP_ENV: 'local' }));
    assert.doesNotThrow(() => resolveDeploymentIdentity({}));
  });
});

describe('shared config values consumed by lanes A/B/C/D', () => {
  const apiBase = { APP_ENV: 'local', SERVICE_NAME: 'api', DATABASE_URL: 'postgresql://localhost/test', S3_BUCKET: 'test' };
  const gatewayBase = { APP_ENV: 'local', SERVICE_NAME: 'ai-gateway', PORT: 3002 };

  it('defaults the API-side lane values', () => {
    const config = apiConfigSchema.parse(apiBase);
    assert.equal(config.SESSION_REFRESH_REUSE_GRACE_SECONDS, 30);
    assert.equal(config.PASSWORD_RESET_RESPONSE_MIN_MS, 300);
    assert.equal(config.AI_FINAL_MUTATION_ENABLED, false);
    assert.equal(config.REIMBURSEMENT_WRITE_QUIESCE, false);
    assert.equal(config.SEED_SYSTEM_ADMIN_PASSWORD, undefined);
  });

  it('accepts only a boolean reimbursement upgrade quiesce value', () => {
    assert.equal(apiConfigSchema.parse({ ...apiBase, REIMBURSEMENT_WRITE_QUIESCE: 'true' }).REIMBURSEMENT_WRITE_QUIESCE, true);
    assert.equal(apiConfigSchema.parse({ ...apiBase, REIMBURSEMENT_WRITE_QUIESCE: 'false' }).REIMBURSEMENT_WRITE_QUIESCE, false);
    assert.throws(() => apiConfigSchema.parse({ ...apiBase, REIMBURSEMENT_WRITE_QUIESCE: 'yes' }));
  });

  it('accepts 0 for the strict refresh-reuse grace and the response floor', () => {
    const config = apiConfigSchema.parse({
      ...apiBase,
      SESSION_REFRESH_REUSE_GRACE_SECONDS: '0',
      PASSWORD_RESET_RESPONSE_MIN_MS: '0',
    });
    assert.equal(config.SESSION_REFRESH_REUSE_GRACE_SECONDS, 0);
    assert.equal(config.PASSWORD_RESET_RESPONSE_MIN_MS, 0);
  });

  it('rejects a negative refresh-reuse grace window', () => {
    assert.throws(() => apiConfigSchema.parse({ ...apiBase, SESSION_REFRESH_REUSE_GRACE_SECONDS: '-1' }));
  });

  it('defaults the AgentCore invocation bounds', () => {
    const config = aiGatewayConfigSchema.parse(gatewayBase);
    assert.equal(config.AGENTCORE_MAX_BODY_BYTES, 1048576);
    assert.equal(config.AGENTCORE_MAX_MESSAGE_CHARS, 8000);
    assert.equal(config.AGENTCORE_MAX_ATTACHMENTS, 10);
    assert.equal(config.AGENTCORE_MAX_CONCURRENT_INVOCATIONS, 16);
  });

  it('exposes non-secret JWT fallbacks without adding schema defaults', () => {
    assert.equal(DEFAULT_JWT_ISSUER, 'watchdog-bms');
    assert.equal(DEFAULT_JWT_AUDIENCE, 'watchdog-bms-api');
    const config = apiConfigSchema.parse(apiBase);
    assert.equal(config.WATCHDOG_JWT_ISSUER, undefined);
    assert.equal(config.WATCHDOG_JWT_AUDIENCE, undefined);
    assert.equal(aiGatewayConfigSchema.parse(gatewayBase).WATCHDOG_JWT_ISSUER, undefined);
  });
});

describe('redactLogValue() – L-09 shared deep log redactor', () => {
  const asRecord = (value: unknown) => value as Record<string, unknown>;

  it('masks the key names the old shallow redactor covered', () => {
    const result = asRecord(redactLogValue({
      password: 'hunter2',
      AccessToken: 'abc',
      DEV_AUTH_SECRET: 'x',
      authorization: 'Bearer xyz',
      session_cookie: 'abc',
      api_key: 'k',
      user_prompt: 'some data',
      db_credential: 'pass',
    }));
    for (const key of [
      'password', 'AccessToken', 'DEV_AUTH_SECRET', 'authorization',
      'session_cookie', 'api_key', 'user_prompt', 'db_credential',
    ]) {
      assert.equal(result[key], '[REDACTED]', `${key} must be redacted`);
    }
  });

  it('covers the L-09 named keys wherever they appear', () => {
    for (const key of [
      'idToken', 'refreshToken', 'workerToken', 'internalSecret', 'channelSecret',
      'clientSecret', 'signingKey', 'encryptionKey', 'signature', 'hmac', 'jwt',
      'bearer', 'credentials', 'actorDelegations', 'passwd',
    ]) {
      assert.ok(SENSITIVE_LOG_KEY_PATTERN.test(key), `${key} must match the sensitive key pattern`);
      assert.equal(asRecord(redactLogValue({ [key]: 'leak' }))[key], '[REDACTED]');
    }
  });

  it('redacts at depth 3 instead of stopping at a depth-2 ceiling', () => {
    const result = redactLogValue({ a: { b: { accessToken: 'leak', keep: 'visible' } } }) as
      { a: { b: { accessToken: string; keep: string } } };
    assert.equal(result.a.b.accessToken, '[REDACTED]');
    assert.equal(result.a.b.keep, 'visible');
  });

  it('redacts err.meta.password and keeps non-personal forensic content', () => {
    const result = redactLogValue({
      err: { message: 'insert failed', meta: { password: 'hunter2', table: 'AuthSession', rows: 3 } },
    }) as { err: { message: string; meta: { password: string; table: string; rows: number } } };
    assert.equal(result.err.meta.password, '[REDACTED]');
    assert.equal(result.err.meta.table, 'AuthSession');
    assert.equal(result.err.meta.rows, 3);
    assert.equal(result.err.message, 'insert failed');
  });

  it('scrubs a DSN embedded in an error message string', () => {
    const result = redactLogValue({
      err: { message: 'connect ECONNREFUSED postgresql://watchdog:hunter2@db.internal:5432/watchdog_bms' },
    }) as { err: { message: string } };
    assert.ok(!result.err.message.includes('hunter2'), 'the DSN password must not survive');
    assert.ok(result.err.message.includes('[REDACTED]@db.internal:5432'), 'the non-secret host must survive');
  });

  it('scrubs a DSN carried by a real Error instance', () => {
    const error = new Error('auth failed for redis://cache:s3cr3t@cache.internal:6379');
    const result = redactLogValue({ err: error }) as { err: { message: string } };
    assert.ok(!result.err.message.includes('s3cr3t'));
  });

  it('redacts personal-data keys in the log pipeline', () => {
    const result = asRecord(redactLogValue({
      phoneNumber: '081-234-5678',
      email: 'owner@watchdog.local',
      lineUserId: 'U1234',
      taxId: '0105561000000',
      displayName: 'คุณพิม',
      address: '45 Siam Rd',
      companyId: 'seed-local-company',
      requestId: 'req-1',
    }));
    for (const key of ['phoneNumber', 'email', 'lineUserId', 'taxId', 'displayName', 'address']) {
      assert.equal(result[key], '[REDACTED]', `${key} is personal data`);
    }
    assert.equal(result['companyId'], 'seed-local-company', 'correlation fields must survive');
    assert.equal(result['requestId'], 'req-1', 'correlation fields must survive');
  });

  it('walks arrays of objects', () => {
    const result = redactLogValue({ toolCalls: [{ name: 'crm_list', apiKey: 'leak' }, { name: 'crm_get' }] }) as
      { toolCalls: Array<{ name: string; apiKey?: string }> };
    assert.equal(result.toolCalls[0]?.apiKey, '[REDACTED]');
    assert.equal(result.toolCalls[0]?.name, 'crm_list');
    assert.equal(result.toolCalls[1]?.name, 'crm_get');
  });

  it('survives a cyclic object', () => {
    const cyclic: Record<string, unknown> = { name: 'root', token: 'leak' };
    cyclic['self'] = cyclic;
    const result = asRecord(redactLogValue(cyclic));
    assert.equal(result['token'], '[REDACTED]');
    assert.equal(result['name'], 'root');
    assert.equal(result['self'], '[CIRCULAR]', 'the cycle is cut at the first revisit');
  });

  it('still walks a shared, non-cyclic reference twice', () => {
    const shared = { apiKey: 'leak', keep: 1 };
    const result = redactLogValue({ a: shared, b: shared }) as
      { a: { apiKey: string; keep: number }; b: { apiKey: string } };
    assert.equal(result.a.apiKey, '[REDACTED]');
    assert.equal(result.b.apiKey, '[REDACTED]');
    assert.equal(result.a.keep, 1);
  });

  it('caps depth instead of recursing without bound', () => {
    let deep: Record<string, unknown> = { token: 'leak' };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    assert.doesNotThrow(() => redactLogValue(deep));
  });

  it('does not mutate its input', () => {
    const input = { password: 'hunter2', nested: { apiKey: 'leak', keep: 1 } };
    const result = redactLogValue(input);
    assert.equal(input.password, 'hunter2');
    assert.equal(input.nested.apiKey, 'leak');
    assert.notEqual(result, input);
    assert.notEqual(result.nested, input.nested);
  });

  it('preserves non-matching values and types', () => {
    const date = new Date('2026-07-28T00:00:00.000Z');
    const result = asRecord(redactLogValue({
      APP_ENV: 'local', SERVICE_NAME: 'api', PORT: 3001, ok: true, none: null, when: date,
    }));
    assert.equal(result['APP_ENV'], 'local');
    assert.equal(result['PORT'], 3001);
    assert.equal(result['ok'], true);
    assert.equal(result['none'], null);
    assert.equal(result['when'], date);
  });

  it('handles empty and primitive input', () => {
    assert.deepEqual(redactLogValue({}), {});
    assert.equal(redactLogValue('plain'), 'plain');
    assert.equal(redactLogValue(7), 7);
    assert.equal(redactLogValue(null), null);
    assert.equal(redactLogValue(undefined), undefined);
  });
});


describe('trial allowance defaults', () => {
  it('grants fifteen from day one in API config and deployment defaults', () => {
    assert.equal(apiConfigSchema.shape.LINE_SIGNUP_WARMUP_SLIPS.parse(undefined), 15);
    assert.match(readFileSync(new URL('../../../infra/prod-ecs-express/deploy.sh', import.meta.url), 'utf8'), /LINE_SIGNUP_WARMUP_SLIPS:-15/);
  });
});

describe('LINE reliability v2 rollout configuration', () => {
  const base = { APP_ENV: 'local', SERVICE_NAME: 'test', DATABASE_URL: 'postgresql://localhost/test', S3_BUCKET: 'test' };
  const flags = [
    'LINE_AI_DELIVERY_PLAN_V2_ENABLED', 'LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED',
    'LINE_AI_DOCUMENT_QA_ENABLED', 'LINE_AI_APPROVED_KNOWLEDGE_ENABLED',
    'LINE_AI_PUBLIC_LOOKUP_ENABLED', 'LINE_AI_PREFERENCES_ENABLED',
  ] as const;
  const allowlists = [
    'LINE_AI_RELIABILITY_V2_COMPANY_IDS', 'LINE_AI_DELIVERY_PLAN_V2_WRITE_COMPANY_IDS',
    'LINE_AI_DELIVERY_PLAN_V2_PUBLIC_CHANNEL_IDS',
  ] as const;

  for (const [service, schema] of [['API', apiConfigSchema], ['Gateway', aiGatewayConfigSchema]] as const) {
    it(`${service} defaults supported capabilities on, public lookup off, and rollout restrictions empty`, () => {
      const config = schema.parse(base);
      assert.equal(config.LINE_AI_RELIABILITY_V2_MODE, 'on');
      for (const key of flags) assert.equal(config[key], key !== 'LINE_AI_PUBLIC_LOOKUP_ENABLED', key);
      for (const key of allowlists) assert.deepEqual(config[key], [], key);
      for (const key of flags) {
        assert.equal(schema.parse({ ...base, [key]: 'false' })[key], false, key);
        assert.equal(schema.parse({ ...base, [key]: 'true' })[key], true, key);
        assert.equal(schema.safeParse({ ...base, [key]: '1' }).success, false, key);
      }
    });

    it(`${service} validates optional exact rollout restrictions without wildcards or malformed entries`, () => {
      for (const key of allowlists) {
        assert.deepEqual(schema.parse({ ...base, [key]: ' company-A,1234567890,company-A ' })[key], ['company-A', '1234567890']);
        assert.deepEqual(schema.parse({ ...base, [key]: '  ' })[key], []);
        for (const invalid of ['*', 'company-A,', ',company-A', 'company-A,,company-B', 'company A', 'company/A', 'a'.repeat(129)]) {
          assert.equal(schema.safeParse({ ...base, [key]: invalid }).success, false, `${key}: ${invalid}`);
        }
      }
    });

    it(`${service} keeps shadow distinct and rejects unknown mode values`, () => {
      assert.equal(schema.parse({ ...base, LINE_AI_RELIABILITY_V2_MODE: 'off' }).LINE_AI_RELIABILITY_V2_MODE, 'off');
      assert.equal(schema.parse({ ...base, LINE_AI_RELIABILITY_V2_MODE: 'shadow' }).LINE_AI_RELIABILITY_V2_MODE, 'shadow');
      assert.equal(schema.parse({ ...base, LINE_AI_RELIABILITY_V2_MODE: 'on' }).LINE_AI_RELIABILITY_V2_MODE, 'on');
      assert.equal(schema.safeParse({ ...base, LINE_AI_RELIABILITY_V2_MODE: 'enabled' }).success, false);
    });
  }

  it('API and Gateway produce identical effective values for the negotiated flags', () => {
    const env = {
      ...base, LINE_AI_RELIABILITY_V2_MODE: 'on',
      ...Object.fromEntries(flags.map((key) => [key, 'true'])),
      ...Object.fromEntries(allowlists.map((key) => [key, 'company-A,oa-B'])),
    };
    const api = apiConfigSchema.parse(env);
    const gateway = aiGatewayConfigSchema.parse(env);
    for (const key of ['LINE_AI_RELIABILITY_V2_MODE', ...flags, ...allowlists] as const) {
      assert.deepEqual(api[key], gateway[key], key);
    }
  });
});


describe('LINE AI rollout restriction', () => {
  it('allows an authorized nonblank ID when unrestricted and honors exact restrictions', () => {
    assert.equal(isLineAiRolloutAllowed([], 'company-A'), true);
    assert.equal(isLineAiRolloutAllowed([], ''), false);
    assert.equal(isLineAiRolloutAllowed([], '  '), false);
    assert.equal(isLineAiRolloutAllowed(['company-A'], 'company-A'), true);
    for (const id of ['company-B', 'company-a', ' company-A', 'company-A ']) {
      assert.equal(isLineAiRolloutAllowed(['company-A'], id), false);
    }
  });
});
