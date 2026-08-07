# Platform Environment Setup Plan

## Linked Specs

- Spec: `docs/specs/platform-environment-config-spec.md`
- Spec: `docs/specs/auth-authorization-rbac-spec.md`
- Spec: `docs/specs/ai-gateway-agents-spec.md`
- Guideline: `docs/guidelines/security-implementation-guideline.md`

## Purpose

Define setup order for non-business platform foundation before implementing inventory, accounting, tax, CRM, LINE assistant, or AI business features.

Solo-dev MVP execution should follow `docs/plans/platform-foundation-local-prod-lean-plan.md` first. This broader setup plan remains the staging-capable path for later team or release maturity.

## Rule

Do not start business feature implementation until the Feature Readiness Gate in this plan is satisfied.

## Step 0: Environment Decisions

### Goal

Freeze naming and environment boundaries.

### Tasks

- [ ] Confirm environments: `local`, `staging`, `production`.
- [ ] Confirm config names from `docs/specs/platform-environment-config-spec.md`.
- [ ] Confirm AWS Secrets Manager or SSM as production secret source.
- [ ] Confirm AI provider default state: `MODEL_PROVIDER=disabled` until AI policy is ready.

### Exit Criteria

- Environment names and config source are documented.
- No service-specific ad hoc config names are introduced.

## Step 1: Shared Config Schema

### Goal

Make config typed, validated, and fail-fast.

### Tasks

- [ ] Expand `packages/config` into service-specific schemas: API, AI Gateway, web, workers.
- [ ] Add environment-aware validation: local vs staging vs production.
- [ ] Add redacted config error messages.
- [ ] Add tests for missing production required values.

### Exit Criteria

- Each service loads config through shared helpers.
- Production fails fast for missing or unsafe config.

## Step 2: Secret Handling

### Goal

Keep secrets out of source, logs, and images.

### Tasks

- [ ] Keep `.env.example` safe and local-only.
- [ ] Document secret references for production.
- [ ] Add redaction helper for known sensitive keys.
- [ ] Add secret scan to CI.

### Exit Criteria

- No real secret in repo.
- Logs cannot print known secret fields.

## Step 3: Runtime and HTTP Security

### Goal

Make every service safe to expose in staging.

### Tasks

- [ ] Validate `HOST`, `PORT`, `PUBLIC_BASE_URL`, `TRUST_PROXY`.
- [ ] Enforce `CORS_ALLOWED_ORIGINS` in deployed env.
- [ ] Keep Swagger disabled in production unless protected.
- [ ] Add rate limit config and storage.
- [ ] Confirm body size limits.

### Exit Criteria

- API and AI Gateway reject unsafe CORS config.
- Public staging has rate limits and strict body limits.

## Step 4: Logging Baseline

### Goal

Get usable logs without leaking sensitive data.

### Tasks

- [ ] Add structured JSON logger.
- [ ] Add request id propagation.
- [ ] Add request logs with method, path, status, duration, request id.
- [ ] Add redaction for auth headers, cookies, passwords, tokens, prompts, and document payloads.
- [ ] Disable SQL logs outside local debugging.

### Exit Criteria

- Logs are structured and redacted.
- Every request can be traced by request id.

## Step 5: Authentication Foundation

### Goal

Validate identity before protected routes.

### Tasks

- [ ] Add auth module.
- [ ] Add LINE Login validation adapter.
- [ ] Add WatchDog-BMS first-party session/JWT issuer and verifier.
- [ ] Add LINE Messaging API webhook signature verifier.
- [ ] Add local dev auth strategy.
- [ ] Add tests for missing, invalid, expired, wrong-audience, and valid tokens.
- [ ] Add tests for unlinked LINE identity.
- [ ] Ensure dev auth cannot run in staging or production.

### Exit Criteria

- Protected routes require verified identity.
- Local development stays convenient but cannot leak into deployed env.

## Step 6: Tenant Context and RBAC

### Goal

Resolve company membership and permissions before business data access.

### Tasks

- [ ] Add user/external-identity/company/membership/role/permission schema.
- [ ] Add seed roles and permissions.
- [ ] Resolve request context from first-party session/JWT subject and company selection.
- [ ] Wire permissions into deny-by-default guard.
- [ ] Add tests for no membership, missing permission, and allowed permission.

### Exit Criteria

- Every protected request has server-derived `userId`, `companyId`, `membershipId`, roles, and permissions.

## Step 7: ABAC Policy Hook

### Goal

Prepare record-level rules before real records exist.

### Tasks

- [ ] Define policy interface.
- [ ] Add placeholder policies for own/team/location/amount/status.
- [ ] Add route or use-case policy hook.
- [ ] Add tests with fake policy decisions.

### Exit Criteria

- Business modules can attach record-level policy checks without redesigning guards.

## Step 8: Audit and Data Access Logs

### Goal

Record sensitive actions from the beginning.

### Tasks

- [ ] Add audit log table and repository.
- [ ] Add audit service with redacted metadata.
- [ ] Add data access log flag for sensitive reads.
- [ ] Add tests for role change and sensitive mutation audit.

### Exit Criteria

- Sensitive actions can be audited before inventory/accounting/tax modules launch.

## Step 9: Database, Redis, Queue, and Idempotency

### Goal

Prepare safe state and background processing.

### Tasks

- [ ] Add DB pool and timeout config.
- [ ] Add Redis prefixes for cache, rate limit, queue, idempotency.
- [ ] Add idempotency key helper for future mutations.
- [ ] Add worker graceful shutdown config.
- [ ] Add DLQ config.

### Exit Criteria

- Retries, queues, and future mutations have safe primitives.

## Step 10: Storage and Upload Safety

### Goal

Prevent unsafe file handling before receipts/documents arrive.

### Tasks

- [ ] Add storage config schema.
- [ ] Add upload limit and MIME allowlist.
- [ ] Add signed URL TTL config.
- [ ] Add tenant-scoped object key convention.

### Exit Criteria

- File uploads/downloads can be implemented through signed URLs and tenant checks.

## Step 11: AI Gateway and Agent Safety

### Goal

Make agents safe before enabling any tool.

### Tasks

- [ ] Add AI Gateway config schema.
- [ ] Default `MODEL_PROVIDER=disabled`.
- [ ] Add agent registry config and `AI_ENABLED_AGENTS`.
- [ ] Add per-agent enable flags: CFO, Sales, Inventory, Tax, CRM, Marketing.
- [ ] Enforce `AI_TOOL_POLICY_ENFORCED=true` before tools can run.
- [ ] Enforce `AI_TOOL_AUDIT_ENABLED=true` before tools can run.
- [ ] Keep `AI_FINAL_MUTATION_ENABLED=false`.
- [ ] Keep `AI_PROMPT_LOGGING_ENABLED=false`.
- [ ] Add max input/output token, max tool calls, and tool timeout config.
- [ ] Add AI rate limit config.
- [ ] Add tests proving tools cannot run when policy/audit is disabled.

### Exit Criteria

- AI Gateway can start safely with agents disabled.
- Agents cannot call tools without permission policy and audit.
- Final mutation remains blocked by config.

## Step 12: Observability

### Goal

Detect failures before business workflows depend on the platform.

### Tasks

- [ ] Add health check timeout config.
- [ ] Add metrics flag.
- [ ] Add tracing config.
- [ ] Add error tracking DSN config.
- [ ] Add service name/version/git sha to logs and traces.

### Exit Criteria

- Staging can show service health, logs, errors, and traces.

## Step 13: CI/CD Security Gates

### Goal

Prevent unsafe changes from shipping.

### Tasks

- [ ] Add typecheck/test gate.
- [ ] Add dependency audit gate.
- [ ] Add secret scan gate.
- [ ] Add container scan gate.
- [ ] Add migration approval gate for production.
- [ ] Add Docker Compose config validation.

### Exit Criteria

- Staging/prod deploy cannot proceed when security gates fail.

## Step 14: Backup and Retention

### Goal

Protect source-of-truth data before real customers or business records.

### Tasks

- [ ] Define DB backup retention.
- [ ] Define object retention.
- [ ] Define app log retention.
- [ ] Define audit retention.
- [ ] Run at least one restore test before production launch.

### Exit Criteria

- Production readiness includes restore path, not only backup creation.

## Step 15: Feature Readiness Gate

Business feature implementation can start only when:

- [ ] Config schema validates required values per service and environment.
- [ ] Secrets are excluded from source, logs, and images.
- [ ] API and AI Gateway enforce strict CORS, body limit, rate limit, and Swagger policy.
- [ ] Structured logging and redaction exist.
- [ ] AuthN verifies identity.
- [ ] Tenant context and RBAC resolve permissions.
- [ ] ABAC hook exists.
- [ ] Audit service exists.
- [ ] DB/Redis/storage/queue config is validated.
- [ ] AI Gateway agents are disabled by default and tool execution is gated by policy and audit.
- [ ] CI runs typecheck, test, dependency audit, secret scan, and container scan.
- [ ] At least one protected-route test proves deny-by-default behavior.

## Recommended Implementation Order

1. Shared config schema.
2. Secrets and redaction.
3. Runtime/HTTP hardening.
4. Structured logs and request IDs.
5. AuthN.
6. Tenant context and RBAC.
7. ABAC hook.
8. Audit service.
9. DB/Redis/queue/idempotency.
10. Storage/upload safety.
11. AI Gateway and agent safety.
12. Observability.
13. CI/CD gates.
14. Backup and retention.
15. Business feature implementation.

## First Business Feature After Gate

After this plan exits, start with a small protected non-financial feature, such as product read-only or company setup read-only, to prove:

- Auth works.
- Company scope works.
- Permission metadata works.
- Audit/logging do not leak data.
- Tests are easy to write.
