# Platform Environment and Runtime Config Spec

## 1. Goal

Define non-business environment, runtime, security, logging, audit, observability, worker, and AI agent configuration that must exist before business feature implementation.

Solo-dev MVP execution uses `docs/specs/platform-foundation-local-prod-lean-spec.md` as the active local/prod profile. This broader spec still documents staging-capable configuration for the future.

This spec covers:

- Local `.env.example`.
- Shared config schema.
- Staging and production secret/config setup.
- Service startup validation.
- CI/CD required variables.
- AI Gateway and agent safety controls.

## 2. Principles

- Production must fail fast when required config is missing or unsafe.
- Secrets must not be committed, logged, embedded in Docker images, or exposed through `NEXT_PUBLIC_*`.
- Local defaults are allowed only for local development.
- Security, audit, logging, and observability are platform features, not business feature follow-up.
- AI agents must be disabled or constrained until tool policy, audit, and permission checks are ready.
- Public browser/LIFF config must contain no secrets.

## 3. Config Sources

### Local

- `.env.example` documents safe placeholders.
- `.env` stores developer-local values and stays ignored by git.
- Local secret values may be weak only when isolated to local Docker.

### Staging and Production

- Non-secret config can come from deployment environment variables.
- Secrets come from AWS Secrets Manager or SSM Parameter Store.
- Runtime services receive secret references or injected secret values from the deployment platform.
- No production secret should live in source control, CI logs, or image layers.

### CI/CD

- CI has read-only tokens wherever possible.
- Deploy jobs use environment-scoped credentials.
- Security gates must run before deployment.

## 4. Naming Rules

- Use uppercase snake case.
- Prefer shared names across services: `APP_ENV`, `SERVICE_NAME`, `LOG_LEVEL`.
- Prefix service-specific values only when needed: `AI_GATEWAY_PORT`, `WEB_PORT`.
- Public browser values must start with `NEXT_PUBLIC_` and contain no secrets.
- Boolean flags use `true` or `false`.
- Durations include unit in name: `_SECONDS`, `_MS`, `_DAYS`.
- Sizes include unit in name: `_BYTES`.

## 5. Runtime Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `NODE_ENV` | yes | `production` | Framework runtime mode. |
| `APP_ENV` | yes | `local`, `staging`, `production` | Deployment environment. |
| `SERVICE_NAME` | yes | `api` | Logs, metrics, traces. |
| `SERVICE_VERSION` | deployed env | `0.1.0` | Release version. |
| `GIT_SHA` | deployed env | `abc123` | Build provenance. |
| `HOST` | yes | `0.0.0.0` in container | Direct local run can use `127.0.0.1`. |
| `PORT` | yes | `3001` | Service port. |
| `PUBLIC_BASE_URL` | deployed env | `https://api.example.com` | External callbacks/links. |
| `TRUST_PROXY` | deployed env | `true` | Required behind load balancer/proxy. |

## 6. HTTP Security Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `CORS_ALLOWED_ORIGINS` | deployed env | `https://app.example.com` | Comma-separated allowlist. |
| `HTTP_BODY_LIMIT` | yes | `1mb` | Default request body limit. |
| `SWAGGER_ENABLED` | yes | `false` | Production default must be false unless protected. |
| `RATE_LIMIT_ENABLED` | public env | `true` | Enable before public staging. |
| `RATE_LIMIT_WINDOW_SECONDS` | public env | `60` | Per window. |
| `RATE_LIMIT_MAX_REQUESTS` | public env | `120` | Per identity/IP policy. |
| `COOKIE_SECURE` | if cookies exist | `true` | Browser session only. |
| `COOKIE_SAME_SITE` | if cookies exist | `lax` | Browser session only. |
| `CSRF_ENABLED` | if cookies exist | `true` | Required for cookie auth. |

## 7. Authentication Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `AUTH_PROVIDER` | yes | `line` | `dev` only in local. |
| `LINE_LOGIN_CHANNEL_ID` | deployed env | `line-login-channel-id` | Expected LINE Login audience/channel id. |
| `LINE_LOGIN_CHANNEL_SECRET` | deployed env secret | `secret-ref` | Required for LINE Login verification where applicable. |
| `LINE_MESSAGING_CHANNEL_ID` | deployed env | `line-messaging-channel-id` | Messaging API channel id. |
| `LINE_MESSAGING_CHANNEL_SECRET` | deployed env secret | `secret-ref` | Required for webhook signature verification. |
| `WATCHDOG_JWT_ISSUER` | deployed env | `https://api.example.com` | First-party token issuer. |
| `WATCHDOG_JWT_AUDIENCE` | deployed env | `watchdog-bms` | First-party token audience. |
| `WATCHDOG_JWT_SECRET_ARN` | deployed env secret | `arn:aws:secretsmanager:...` | First-party token signing secret/key reference. |
| `JWT_CLOCK_TOLERANCE_SECONDS` | yes | `30` | Clock skew tolerance. |
| `DEV_AUTH_ENABLED` | local only | `true` | Must be false outside local. |
| `DEV_AUTH_SECRET` | local only | `local-secret` | Required for signed dev JWT strategy. |

## 8. Authorization and Tenant Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `REQUIRE_COMPANY_CONTEXT` | yes | `true` | Protected routes need company context. |
| `COMPANY_CONTEXT_HEADER` | yes | `X-Company-Id` | Default company selector. |
| `PERMISSION_CACHE_TTL_SECONDS` | yes | `60` | Short cache for RBAC resolution. |
| `RBAC_SEED_ENABLED` | local/staging | `true` | Seed system roles and permissions. |
| `OWNER_MFA_REQUIRED_FOR_HIGH_RISK` | production | `true` | Export/tax/role changes. |

## 9. Secrets and Secret References

Use secret references in deployed env where possible:

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `DATABASE_SECRET_ARN` | production | `arn:aws:secretsmanager:...` | Preferred over raw DB password env. |
| `REDIS_SECRET_ARN` | production | `arn:aws:secretsmanager:...` | If Redis auth is enabled. |
| `S3_SECRET_ARN` | production | `arn:aws:secretsmanager:...` | Only if using static object storage credentials. |
| `AI_PROVIDER_SECRET_ARN` | production | `arn:aws:secretsmanager:...` | LLM provider credentials. |

Raw secret values are acceptable only when injected by runtime secret manager and never printed.

## 10. Database Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `DATABASE_URL` | yes | `postgresql://...` | Local can use direct URL. |
| `DATABASE_POOL_MIN` | yes | `1` | Pool floor. |
| `DATABASE_POOL_MAX` | yes | `10` | Pool cap. |
| `DATABASE_STATEMENT_TIMEOUT_MS` | yes | `10000` | Prevent runaway queries. |
| `MIGRATIONS_ENABLED` | deploy job | `true` | Do not auto-run blindly in app containers. |
| `SEED_SYSTEM_ROLES_ENABLED` | local/staging | `true` | System roles and permissions. |

## 11. Redis, Cache, Rate Limit, and Queue Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `REDIS_URL` | yes | `redis://redis:6379` | Queue, cache, rate limit. |
| `CACHE_TTL_SECONDS` | yes | `300` | Shared default cache TTL. |
| `IDEMPOTENCY_TTL_SECONDS` | yes | `86400` | Mutation retry safety. |
| `RATE_LIMIT_REDIS_PREFIX` | yes | `watchdog:rate` | Avoid key collision. |
| `QUEUE_REDIS_PREFIX` | yes | `watchdog:queue` | Avoid key collision. |

## 12. Object Storage and Upload Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `S3_BUCKET` | yes | `watchdog-bms-prod` | Business documents and exports. |
| `S3_REGION` | yes | `ap-southeast-1` | Storage region. |
| `S3_ENDPOINT` | local only | `http://localhost:19000` | MinIO/local emulator. |
| `S3_PUBLIC_ENDPOINT` | self-hosted only | `http://127.0.0.1:19000` | Browser-reachable endpoint for presigned upload/download URLs; unset preserves existing SDK behavior. |
| `S3_FORCE_PATH_STYLE` | local only | `true` | MinIO compatibility. |
| `UPLOAD_MAX_BYTES` | yes | `10485760` | Upload limit. |
| `UPLOAD_PENDING_MAX_BYTES_PER_COMPANY` | yes | `104857600` | Maximum pending/quarantined bytes retained in the 24-hour cleanup window per tenant. |
| `ALLOWED_UPLOAD_MIME_TYPES` | yes | `application/pdf,image/png,image/jpeg` | Comma-separated. |
| `SIGNED_URL_TTL_SECONDS` | yes | `300` | Upload-intent lifetime, hard-capped at 300 seconds. |

## 13. Logging Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `LOG_LEVEL` | yes | `info` | `debug` only local. |
| `LOG_FORMAT` | yes | `json` | Production logs must be structured. |
| `LOG_REDACTION_ENABLED` | yes | `true` | Redact secrets and sensitive data. |
| `REQUEST_LOG_ENABLED` | yes | `true` | Include method/path/status/duration/request id. |
| `SQL_LOG_ENABLED` | yes | `false` | Enable only local debugging. |
| `LOG_SAMPLE_RATE` | yes | `1` | Can reduce noisy logs later. |

Must redact:

- Authorization headers.
- Cookies.
- Passwords.
- Access keys.
- Refresh tokens.
- Raw AI prompts that include business data.
- Document contents and attachment payloads.

## 14. Audit Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `AUDIT_ENABLED` | yes | `true` | Must be true before business modules. |
| `AUDIT_SINK` | yes | `database` | Database first. |
| `AUDIT_RETENTION_DAYS` | yes | `2555` | Seven years default for business records. |
| `AUDIT_HASH_CHAIN_ENABLED` | later | `false` | Future tamper-evidence. |
| `DATA_ACCESS_LOG_ENABLED` | sensitive modules | `true` | Reads of finance/tax/customer data. |

Audit logs are separate from application logs.

## 15. Observability Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `OTEL_ENABLED` | yes | `true` | Traces/metrics where supported. |
| `OTEL_SERVICE_NAME` | yes | `watchdog-api` | Service identity. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | staging/prod | `https://otel...` | Collector endpoint. |
| `METRICS_ENABLED` | yes | `true` | Runtime metrics. |
| `TRACING_SAMPLE_RATE` | yes | `0.1` | Tune per env. |
| `HEALTHCHECK_TIMEOUT_MS` | yes | `2000` | Health check dependency budget. |
| `ERROR_TRACKING_DSN` | staging/prod | `https://...` | Sentry or equivalent. |

## 16. Worker Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `QUEUE_ENABLED` | yes | `true` | Enable worker jobs. |
| `QUEUE_CONCURRENCY` | yes | `5` | Per worker process. |
| `QUEUE_RETRY_ATTEMPTS` | yes | `3` | Retry count. |
| `QUEUE_RETRY_BACKOFF_MS` | yes | `1000` | Base backoff. |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | yes | `15000` | Graceful shutdown budget. |
| `DLQ_ENABLED` | yes | `true` | Dead-letter queue for failed jobs. |

## 17. AI Gateway and Agent Variables

AI and agents must be config-gated before tool execution exists.

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `MODEL_PROVIDER` | AI Gateway | `bedrock`, `openai`, `disabled` | Default `disabled` until configured. |
| `MODEL_ID` | when AI enabled | `model-id` | Primary model. |
| `MODEL_REGION` | provider-specific | `us-east-1` | Required for AWS Bedrock. |
| `AI_GATEWAY_ENABLED` | yes | `false` | Service-level AI flag. |
| `AI_AGENT_REGISTRY_ENABLED` | yes | `false` | Agent routing flag. |
| `AI_ENABLED_AGENTS` | yes | `cfo,sales,inventory,tax,crm,marketing` | Comma-separated allowlist. |
| `AI_TOOL_AUDIT_ENABLED` | yes | `true` | Required for tool calls. |
| `AI_TOOL_POLICY_ENFORCED` | yes | `true` | Must be true before tools. |
| `AI_FINAL_MUTATION_ENABLED` | yes | `false` | Keep false for MVP unless approved. |
| `AI_PROMPT_LOGGING_ENABLED` | yes | `false` | Avoid raw prompt logs. |
| `AI_RESPONSE_CITATIONS_REQUIRED` | yes | `true` | Finance/tax/stock/CRM answers need sources. |
| `AI_MAX_INPUT_TOKENS` | yes | `6000` | Cost/safety limit. |
| `AI_MAX_OUTPUT_TOKENS` | yes | `1200` | Cost/safety limit. |
| `AI_MAX_TOOL_CALLS` | yes | `8` | Prevent loops. |
| `AI_TOOL_TIMEOUT_MS` | yes | `10000` | Tool execution budget. |
| `AI_CONVERSATION_RETENTION_DAYS` | yes | `30` | Retain minimal history. |
| `AI_MEMORY_ENABLED` | yes | `false` | Disable until privacy rules exist. |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | yes | `60` | AI-specific limit. |
| `AI_RATE_LIMIT_MAX_REQUESTS` | yes | `20` | Per user/company policy. |

Agent-specific flags:

| Variable | Default | Notes |
|---|---|---|
| `AI_AGENT_CFO_ENABLED` | `false` | Finance summaries; requires finance permissions. |
| `AI_AGENT_SALES_ENABLED` | `false` | Pipeline and quote drafts. |
| `AI_AGENT_INVENTORY_ENABLED` | `false` | Stock summary and anomaly checks. |
| `AI_AGENT_TAX_ENABLED` | `false` | Tax explanations and reminders; never legal final authority. |
| `AI_AGENT_CRM_ENABLED` | `false` | Customer follow-up and history. |
| `AI_AGENT_MARKETING_ENABLED` | `false` | Campaign drafts only. |

Agent safety defaults:

- Final mutation disabled.
- Tool audit enabled.
- Tool policy enforced.
- Prompt logging disabled.
- Memory disabled.
- Citations required for business data answers.

## 18. Web and LIFF Public Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | web | `https://api.example.com/v1` | Public URL, no secret. |
| `NEXT_PUBLIC_AI_GATEWAY_BASE_URL` | web | `https://ai.example.com/v1` | Public URL, no secret. |
| `NEXT_PUBLIC_APP_ENV` | web | `staging` | UI environment label if needed. |
| `NEXT_PUBLIC_LIFF_ID` | LIFF | `1234567890-abcdef` | Public LIFF id, no secret. |
| `LINE_OA_ADD_URL` | web | `https://line.me/R/ti/p/@watchdog` | Shared LINE OA add short link shown after password change. Public URL, no secret. |
| `LINE_OA_QR_IMAGE_URL` | web | `https://.../line-oa-qr.png` | Optional pre-generated LINE OA QR image. Public URL, no secret. |
| `LINE_ACCOUNT_LINK_URL` | web | `https://liff.line.me/1234567890-abcdef` | Optional account-link short link shown after password change. Prefer LIFF URL for QR scanning. Falls back to `https://liff.line.me/<LINE_LIFF_ID>` when LIFF id exists, then `NEXT_PUBLIC_API_BASE_URL + /auth/line/link-page`. Public URL, no secret. |
| `LINE_ACCOUNT_LINK_QR_IMAGE_URL` | web | `https://.../line-link-qr.png` | Optional pre-generated account-link QR image. Public URL, no secret. |

LIFF config should be injected through build/runtime config and must not contain secrets.

## 19. CI/CD and Release Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `IMAGE_TAG` | deploy | `api-abc123` | Container tag. |
| `DEPLOY_ENV` | deploy | `staging` | Deployment target. |
| `SECURITY_AUDIT_REQUIRED` | CI | `true` | Dependency audit gate. |
| `SECRET_SCAN_REQUIRED` | CI | `true` | Secret scan gate. |
| `CONTAINER_SCAN_REQUIRED` | CI | `true` | Image scan gate. |
| `MIGRATION_APPROVAL_REQUIRED` | prod deploy | `true` | DB migration gate. |
| `ROLLBACK_ENABLED` | deploy | `true` | Deployment rollback. |

## 20. Backup and Retention Variables

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `BACKUP_ENABLED` | production | `true` | Database backup. |
| `BACKUP_RETENTION_DAYS` | production | `35` | Operational backup retention. |
| `RESTORE_TEST_REQUIRED` | production readiness | `true` | Restore drill before launch. |
| `OBJECT_RETENTION_DAYS` | production | `2555` | Business document retention target. |
| `LOG_RETENTION_DAYS` | uat / production | `3` (UAT), `14` (production) | CloudWatch application log retention; support-session and legacy production groups use 14 days. |

## 21. Production Fail-Fast Rules

Production startup must fail when:

- `CORS_ALLOWED_ORIGINS` is empty.
- `AUTH_PROVIDER` is `dev`.
- LINE channel config or WatchDog-BMS session/JWT config is missing.
- `DEV_AUTH_ENABLED=true`.
- `SWAGGER_ENABLED=true` without explicit protected deployment decision.
- `LOG_REDACTION_ENABLED=false`.
- `AUDIT_ENABLED=false`.
- `AI_TOOL_POLICY_ENFORCED=false` while AI tools are enabled.
- `AI_PROMPT_LOGGING_ENABLED=true`.
- `AI_FINAL_MUTATION_ENABLED=true` without explicit ADR.
- Database, Redis, or storage config is missing.

## 22. Acceptance Criteria

- Shared config schema validates all required variables per service and environment.
- `.env.example` documents safe local defaults.
- Production config has no local-only secrets or dev auth flags.
- API, AI Gateway, web, and workers each fail fast with clear config errors.
- Logs redact sensitive fields.
- Audit can be enabled before business mutations exist.
- AI Gateway cannot run tools unless tool policy and tool audit are enabled.
- Feature implementation prompt references this spec before coding.
