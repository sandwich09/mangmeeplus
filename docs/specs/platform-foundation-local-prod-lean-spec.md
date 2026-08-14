# Platform Foundation Local/Prod Lean Spec

## 1. Goal

Define the minimum platform foundation needed for one developer to build locally and promote to production quickly without weakening security boundaries.

This spec narrows the broader platform docs into a lean execution mode:

- Local is the developer and integration environment.
- Production is the only deployed environment in the first promote path.
- Staging is deferred until team size, release risk, or customer count justifies it.
- Business features must wait until config, auth, RBAC, audit, AI safety, and CI gates exist.

## 2. Non-goals

- No staging environment in the first promote path.
- No custom username/password authentication.
- No direct AI access to ERP database tables.
- No final AI mutation for money, stock, tax, roles, permissions, or production data.
- No heavy compliance automation beyond the required security gates.
- No multi-region, blue/green, canary, or Kubernetes setup.

## 3. Operating Mode

### Solo developer rule

One developer owns local and production. The system must be simple enough to operate without a separate DevOps role.

Rules:

- Prefer one documented path over multiple optional paths.
- Prefer fail-fast startup over runtime surprises.
- Prefer managed production services over manually patched servers.
- Prefer local Docker parity for infrastructure dependencies.
- Keep production promotion gated by automated checks, not manual memory.

### Environment rule

Supported environment values for this lean phase:

```text
APP_ENV=local
APP_ENV=production
```

`staging` may remain in older docs as a future environment, but it is not part of this lean promote path.

## 4. Runtime Boundaries

### Local

Local uses:

- `.env` copied from `.env.example`.
- Docker Compose for PostgreSQL, Redis, and MinIO.
- Local API, AI Gateway, workers, web, LIFF account-link screens, and LINE webhook mock workflows.
- Local dev auth only when `APP_ENV=local`.
- Signed dev JWTs as the first local dev auth strategy.
- Local service ports bound to `127.0.0.1`.

Local may use weak placeholder secrets only because it is isolated to the developer machine.

### Production

Production uses:

- Containerized web, API, AI Gateway, and workers.
- ECS Fargate as the first production runtime target for web, API, AI Gateway, and workers.
- LINE Login for primary user identity.
- WatchDog-BMS first-party session/JWT issuance after LINE identity validation.
- PostgreSQL on Amazon RDS.
- Redis-compatible service on ElastiCache or Valkey.
- S3 for object storage.
- AWS Secrets Manager or SSM Parameter Store for secrets.
- CloudWatch or equivalent for structured logs and metrics.
- Backups enabled before customer data enters the system.

Production must not use local-only auth, local-only secrets, public Swagger, or permissive CORS.

Default production region is Asia Pacific Singapore (`ap-southeast-1`) until a Thailand region is confirmed to support all required runtime, data, storage, queue/cache, secret, log, and AI/model services for the account and budget.

App Runner is not a default target for new deployments because it is no longer open to new AWS customers as of the 2026-06-23 docs review.

## 5. Config Contract

### Common variables

| Variable | Local | Production | Rule |
|---|---:|---:|---|
| `APP_ENV` | required | required | `local` or `production` only in lean path. |
| `NODE_ENV` | required | required | Framework runtime mode. |
| `SERVICE_NAME` | required | required | Used in logs, metrics, and errors. |
| `SERVICE_VERSION` | optional | required | Release version. |
| `GIT_SHA` | optional | required | Build provenance. |
| `HOST` | required | required | `127.0.0.1` local direct run, `0.0.0.0` container. |
| `PORT` | required | required | Service port. |
| `PUBLIC_BASE_URL` | optional | required | External URL for deployed service. |

### HTTP security variables

| Variable | Local | Production | Rule |
|---|---:|---:|---|
| `CORS_ALLOWED_ORIGINS` | required | required | Production cannot be empty or wildcard. |
| `HTTP_BODY_LIMIT` | required | required | Keep bounded. |
| `SWAGGER_ENABLED` | allowed | false by default | Production only if protected by explicit decision. |
| `RATE_LIMIT_ENABLED` | optional | required | Required for public production endpoints. |
| `RATE_LIMIT_WINDOW_SECONDS` | optional | required | Required when rate limit enabled. |
| `RATE_LIMIT_MAX_REQUESTS` | optional | required | Required when rate limit enabled. |

### Authentication variables

| Variable | Local | Production | Rule |
|---|---:|---:|---|
| `AUTH_PROVIDER` | `dev` or `line` | `line` | `dev` forbidden outside local. |
| `DEV_AUTH_ENABLED` | allowed | forbidden | Must fail startup if true in production. |
| `DEV_AUTH_SECRET` | required if dev auth | forbidden | Local only. |
| `LINE_LOGIN_CHANNEL_ID` | optional | required | Required for LINE Login validation. |
| `LINE_LOGIN_CHANNEL_SECRET` | optional | required secret | Required for LINE Login validation. |
| `LINE_MESSAGING_CHANNEL_ID` | optional | required | Required for Messaging API webhook/user mapping. |
| `LINE_MESSAGING_CHANNEL_SECRET` | optional | required secret | Required for webhook signature verification. |
| `WATCHDOG_JWT_ISSUER` | optional | required | Issuer for first-party API tokens. |
| `WATCHDOG_JWT_AUDIENCE` | optional | required | Audience for first-party API tokens. |
| `WATCHDOG_JWT_SECRET_ARN` | optional | required secret | Signing key or secret reference for first-party API tokens. |

### Authorization variables

| Variable | Local | Production | Rule |
|---|---:|---:|---|
| `REQUIRE_COMPANY_CONTEXT` | required | required | Default true. |
| `COMPANY_CONTEXT_HEADER` | required | required | Default `X-Company-Id`. |
| `SEED_SYSTEM_ROLES_ENABLED` | allowed | deploy-job only | Do not seed blindly from app startup. |

### Data and storage variables

| Variable | Local | Production | Rule |
|---|---:|---:|---|
| `DATABASE_URL` | required | required or secret reference | Source of truth. |
| `DATABASE_SECRET_ARN` | optional | preferred | Preferred production secret source. |
| `REDIS_URL` | required | required or secret reference | BullMQ queues, distributed rate limits and optional LINE ledger. |
| `S3_BUCKET` | required | required | Tenant-scoped object keys. |
| `S3_ENDPOINT` | local only | forbidden unless explicit | MinIO/local emulator only. |
| `S3_PUBLIC_ENDPOINT` | self-hosted only | optional | Browser-reachable presigning endpoint; unset falls back to `S3_ENDPOINT` or the SDK AWS URL. |
| `UPLOAD_MAX_BYTES` | required | required | Bounded upload size. |
| `UPLOAD_PENDING_MAX_BYTES_PER_COMPANY` | required | required | Tenant quota for pending/quarantined objects. Provider lifecycle expires the current `pending/` object after 1 day and removes its noncurrent byte version after 1 further day; rejected/quarantined evidence follows the reviewed case policy. |
| `ALLOWED_UPLOAD_MIME_TYPES` | required | required | Explicit allowlist. |
| `SIGNED_URL_TTL_SECONDS` | required | required | Upload-intent lifetime, hard-capped at 300 seconds. |

### Logging and audit variables

| Variable | Local | Production | Rule |
|---|---:|---:|---|
| `LOG_LEVEL` | required | required | `debug` only local. |
| `LOG_FORMAT` | required | required | Production must be `json`. |
| `LOG_REDACTION_ENABLED` | required | required | Production must be true. |
| `REQUEST_LOG_ENABLED` | required | required | Include request id. |
| `SQL_LOG_ENABLED` | allowed | false | Disable outside local debugging. |
| `AUDIT_ENABLED` | required | required | Production must be true. |
| `AUDIT_SINK` | required | required | Database first. |

### AI Gateway variables

| Variable | Local | Production | Rule |
|---|---:|---:|---|
| `MODEL_PROVIDER` | `disabled` default | `disabled` default | Enable only after policy and audit gates pass. |
| `AI_GATEWAY_ENABLED` | false default | false default | Service can run with AI disabled. |
| `AI_AGENT_REGISTRY_ENABLED` | false default | false default | Agents opt in. |
| `AI_TOOL_POLICY_ENFORCED` | required | required | Must be true before tools run. |
| `AI_TOOL_AUDIT_ENABLED` | required | required | Must be true before tools run. |
| `AI_FINAL_MUTATION_ENABLED` | false | false | Production true requires ADR. |
| `AI_PROMPT_LOGGING_ENABLED` | false | false | Raw prompt logging forbidden. |
| `AI_MAX_TOOL_CALLS` | required | required | Prevent loops. |
| `AI_TOOL_TIMEOUT_MS` | required | required | Bound tool execution. |

## 6. Production Fail-fast Rules

Production startup must fail when:

- `APP_ENV` is not `production`.
- `AUTH_PROVIDER=dev`.
- `DEV_AUTH_ENABLED=true`.
- LINE Login channel config, Messaging API channel config, or WatchDog-BMS session/JWT config is missing.
- `CORS_ALLOWED_ORIGINS` is empty or wildcard.
- `SWAGGER_ENABLED=true` without explicit protected deployment decision.
- `LOG_REDACTION_ENABLED=false`.
- `AUDIT_ENABLED=false`.
- Database, Redis, or storage config is missing.
- `AI_TOOL_POLICY_ENFORCED=false` while AI tools are enabled.
- `AI_TOOL_AUDIT_ENABLED=false` while AI tools are enabled.
- `AI_FINAL_MUTATION_ENABLED=true` without explicit ADR.
- `AI_PROMPT_LOGGING_ENABLED=true`.

## 7. Authentication, Authorization, and RBAC

### Authentication

Local uses signed dev JWTs first. Fixed dev identity headers are allowed only as test fixtures when `APP_ENV=local`.

Production uses LINE Login for login/linking and WatchDog-BMS first-party sessions/JWTs for protected APIs.

LINE Login validation checks:

- issuer
- audience or channel id
- expiration and not-before time
- nonce/state where applicable
- signature

LINE Messaging webhook validation checks:

- `X-Line-Signature`
- active Messaging API channel secret
- replay/idempotency where event id is available

WatchDog-BMS session/JWT verification checks:

- issuer
- audience or client id
- expiration and not-before time
- signature
- revocation where applicable
- allowed algorithms

### Request context

Every protected request gets server-derived context:

```ts
type RequestContext = {
  requestId: string;
  authSubject: string;
  userId: string;
  companyId: string;
  membershipId: string;
  roles: string[];
  permissions: string[];
  scopes: {
    branchIds?: string[];
    locationIds?: string[];
    teamIds?: string[];
  };
};
```

Client-submitted company id is only a selection hint. Server must verify membership before any business access.

### Authorization

Rules:

- `@Public()` required for public routes.
- All protected routes require permission metadata.
- Missing auth returns `401`.
- Missing route permission metadata returns `403`.
- Missing membership, role, permission, or ABAC access returns `403`.
- Cross-company data access returns `403` or hidden `404`, depending on endpoint policy.

### Minimum data model

Required before business modules:

- `Company`
- `User`
- `ExternalIdentity`
- `PlatformLineChannel`
- `LineCompanyContext`
- `LineChannelBinding` (legacy/company-specific only)
- `CompanyMembership`
- `Role`
- `Permission`
- `RolePermission`
- `MembershipRole`
- `AuditLog`
- `OutboxEvent`

Seed roles:

- `OWNER`
- `ADMIN`
- `MANAGER`
- `SALES`
- `INVENTORY`
- `FINANCE`
- `ACCOUNTANT`
- `MARKETING`
- `STAFF`
- `AUDITOR_READONLY`

## 8. Audit and Logging

Application logs and audit logs are separate.

### Application logs

Structured logs must include:

- timestamp
- service name
- level
- request id
- method
- path
- status
- duration
- user id and company id when available and safe

Must redact:

- authorization headers
- cookies
- passwords
- access keys
- refresh tokens
- raw AI prompts
- document contents
- attachment payloads

### Audit logs

Always audit:

- login mapping failure for unknown internal user
- company context switch
- user invite, disable, role change, permission change
- export
- AI tool invocation touching sensitive data
- stock adjustment
- accounting document issue, void, credit note, debit note
- payment create/update
- tax report generation/export
- period close/unclose
- workflow rule enable/disable

Minimum audit fields:

```text
actorUserId
companyId
action
targetType
targetId
requestId
result
metadataJson
createdAt
```

Do not store raw tokens, passwords, full prompts, or full document payloads in audit metadata.

## 9. AI Agent Safety

AI Gateway must stay separate from ERP core.

Rules:

- AI Gateway calls ERP core through permission-checked APIs or tools.
- AI tools inherit the exact user permissions and record scope.
- Tool definitions declare required permission, risk level, confirmation requirement, and audit requirement.
- AI cannot directly query source-of-truth tables.
- AI cannot perform final money, stock, tax, or permission mutations.
- Drafts require deterministic server validation before becoming business records.
- Business data answers require source references where available.
- Prompt input and tool output are treated as untrusted data.

Default production AI state:

```text
MODEL_PROVIDER=disabled
AI_GATEWAY_ENABLED=false
AI_AGENT_REGISTRY_ENABLED=false
AI_TOOL_POLICY_ENFORCED=true
AI_TOOL_AUDIT_ENABLED=true
AI_FINAL_MUTATION_ENABLED=false
AI_PROMPT_LOGGING_ENABLED=false
AI_MEMORY_ENABLED=false
```

## 10. CI and Security Gates

Required before production deploy:

- Typecheck.
- Unit and integration tests.
- Dependency audit for production packages.
- Secret scan.
- Docker build for deployable services.
- Config validation for production sample.
- Migration review or dry-run.

Required before business feature merge:

- Protected route tests for auth, membership, permission, and allowed access.
- Audit test for sensitive mutation.
- AI bypass test when feature touches AI tools.
- Input validation test for route payloads.

## 11. Promote Contract

Promotion from local to production is allowed only when:

1. Local infra starts.
2. App services build.
3. API and AI Gateway health checks pass.
4. Database migrations run locally.
5. Seed creates owner/admin roles and permissions.
6. Auth/RBAC tests pass.
7. Audit and redaction tests pass.
8. AI safety tests pass or AI remains disabled.
9. CI gates pass.
10. Production config validates fail-fast rules.

## 12. Acceptance Criteria

- [ ] Shared config package validates API, AI Gateway, web, and worker variables for local and production.
- [ ] `.env.example` documents only safe local placeholders.
- [ ] Production config rejects dev auth, unsafe CORS, missing LINE/session config, disabled redaction, and disabled audit.
- [ ] Prisma schema contains minimum identity, RBAC, audit, and outbox models.
- [ ] Seed creates default roles and permissions.
- [ ] Protected routes require auth, company context, and explicit permission metadata.
- [ ] Sensitive mutation writes audit log.
- [ ] Logs are structured and redacted.
- [ ] AI Gateway cannot run tools without policy and audit gates.
- [ ] CI blocks production deploy when typecheck, tests, audit, secret scan, Docker build, or config validation fails.

## 13. Test Cases

- Public health route succeeds without auth.
- Protected route without token returns `401`.
- Protected route with invalid or expired token returns `401`.
- LINE webhook with invalid signature returns `401` or `403`.
- LINE Login with wrong audience or expired token returns `401`.
- Unlinked LINE identity cannot access business data.
- Protected route without permission metadata returns `403`.
- Authenticated user without company membership returns `403`.
- Authenticated user without required permission returns `403`.
- Authenticated user with required permission succeeds.
- Cross-company read/write attempt is denied or hidden.
- Sensitive mutation writes audit log.
- Production startup rejects `DEV_AUTH_ENABLED=true`.
- Production startup rejects wildcard CORS.
- Production startup rejects `AUDIT_ENABLED=false`.
- AI tool invocation fails when policy or audit is disabled.
- AI final mutation remains blocked by config.

## 14. First Implementation Decisions

- Local dev auth uses signed dev JWTs first. Fixed dev identity headers are test-only and local-only.
- Production runtime starts on ECS Fargate for web, API, AI Gateway, and workers.
- Worker jobs use BullMQ/Redis for first launch. SQS is reviewed before beta or before high-value durable background jobs.
- OWNER MFA starts as policy/config hooks for high-risk actions; full MFA UX and enrollment can follow after auth foundation is stable.
- Production secrets use AWS Secrets Manager or SSM references. Non-secret runtime values can use plain environment variables.
- Default AWS region is Asia Pacific Singapore (`ap-southeast-1`) until Thailand region service/model availability and cost are confirmed.
- API contract starts with shared TypeScript contracts. OpenAPI docs are still required; generated OpenAPI clients can come later.

## 15. HTTP Error Contract: Prisma Failures at the API Boundary (addendum 2026-07-29)

Plan: `docs/plans/prisma-error-mapping-and-enum-parity-plan.md`. Memory: `docs/agent-memory/prisma-error-mapping-and-enum-parity.md`.

### 15.1 Context

Live incident (UAT, 2026-07-28): `POST /v1/procurement/suppliers` with `supplierType: "COMPANY"` returned HTTP 500. The controller takes `@Body() body: any`, so the global ValidationPipe had nothing to check; the unknown enum value travelled to the Prisma insert, Prisma threw `PrismaClientValidationError`, and the global filter (`apps/api/src/common/filters/all-exceptions.filter.ts`) turned every non-`HttpException` into a 500.

The class is API-wide, not procurement-only: `@Body() body: any` appears 53 times across 21 controller files (a formatting-exact grep finds 51/19; grep broadly), and the procurement repository alone has ~80 `as any` casts at the Prisma boundary, so invalid values type-check and only fail at runtime. Commit `84a76d9f` fixed supplier create/update with use-case enum checks; this section defines the API-wide backstop.

### 15.2 Mapping contract

The global exception filter in `apps/api` translates exactly these Prisma client failures into `HttpException`s before delegating to the default Nest rendering. Everything else keeps today's behavior.

| Prisma failure | Detection | HTTP status | Client body (Nest default shape) |
|---|---|---|---|
| `PrismaClientValidationError` (bad enum value, wrong field type, malformed query payload) | `instanceof` | 400 | `{ statusCode: 400, message: "Request shape or field values are invalid.", error: "Bad Request" }` |
| `PrismaClientKnownRequestError` code `P2002` (unique constraint violation) | `instanceof` + `code` | 409 | `{ statusCode: 409, message: "Duplicate value: a record with the same unique field(s) already exists." (+ column names from `meta.target` when it is a string array), error: "Conflict" }` |
| `PrismaClientKnownRequestError` code `P2025` (required record not found — update/delete/connect miss) | `instanceof` + `code` | 404 | `{ statusCode: 404, message: "Record not found.", error: "Not Found" }` |
| `PrismaClientKnownRequestError` code `P2003` (foreign key constraint violation) | `instanceof` + `code` | 409 | `{ statusCode: 409, message: "Operation conflicts with related records: a referenced record is missing or this record is still referenced.", error: "Conflict" }` |
| Anything else (see 15.3) | — | 500 (unchanged) | Nest default `{ statusCode: 500, message: "Internal server error" }` |

**Why P2003 is 409, not 400.** A P2003 payload is well-formed — the request names a referent that the database state does not support (parent id absent, or dependents still attached on delete). That is a conflict between the request and current data state (RFC 9110 409), not a malformed request (400). One fixed status also avoids per-method heuristics: the blocked-delete flavor of P2003 is unambiguously 409, and "referenced record missing" on create is acceptably described by 409 with the message above, so a single deterministic mapping covers both without lying about either. It also groups P2002+P2003 into one client-actionable bucket ("re-check current data, then retry") distinct from 400 ("fix the payload").

**Detection is `instanceof` against the generated client** (`import { Prisma } from '../../generated/prisma/client'`; classes re-exported in `src/generated/prisma/internal/prismaNamespace.ts`). Precedent for `common/` importing the generated client: `apps/api/src/common/database/prisma.service.ts`. Structural sniffing (`err.code === 'P2002'`) is not sufficient in a filter that sees every exception in the app. There is a single generated client instance (one relative-path source dir), so `instanceof` is reliable.

### 15.3 What must NOT be remapped (stays 500, stays in the 5xx log)

The purpose of the mapping is to stop mislabelling client mistakes as server faults — not to make server faults quieter. The following remain 500 and continue through the existing enriched 5xx log path:

- **`P2021` / `P2022` (table / column does not exist).** These are schema drift between the deployed code and the database — a real production incident class in this repo (the dirty-tree migration drift produced `P2022` missing-column 500s in prod). A 4xx here would hide a broken deploy from the 5xx logs while telling clients their request was wrong. Never remap.
- **Connection/availability failures:** `PrismaClientInitializationError`, `P1000–P1017` (auth failed, DB unreachable, timeouts). Server-side outage; must alarm, not 4xx. (Note the ALB canary RollbackAlarm keys on 4xx% — turning outages into 4xx would also distort deploy health signals.)
- **`P2024` (connection pool timeout).** Capacity/saturation problem.
- **`P2034` (transaction write conflict / serialization failure).** Transient server-side concurrency; retryable at the server's discretion, not a client error. Mapping it to 4xx would hide load problems.
- **`PrismaClientUnknownRequestError`, `PrismaClientRustPanicError`.** Unclassified engine failures.
- **Raw database errors** (e.g. Postgres `25P02` current-transaction-aborted from the fake-txn poison pattern, raw-query failures via `P2010`). Cause is a server-side bug by definition.
- **Any `PrismaClientKnownRequestError` code not in the 15.2 table.** Unknown codes default to 500. Extend the table only with observed, argued cases (e.g. `P2000` value-too-long is currently unreachable: the schema has zero `@db.VarChar` columns).

Rule of thumb: remap only failures that are deterministically caused by request content against a healthy database. Anything whose other plausible cause is "the server/database is broken" stays 500.

### 15.4 Response body and logging rules

- Bodies use the Nest built-in exception shape (`{ statusCode, message, error }`) via `BadRequestException` / `ConflictException` / `NotFoundException`. No new envelope.
- **Never echo `exception.message` from `PrismaClientValidationError` to the client.** It contains the constructed query with argument values (request payload data, potential PII) and Prisma internals. The 400 message is the fixed constant above.
- For P2002, only column names from `meta.target` (when it is a string array) may be appended to the message. No constraint names, no table names, no raw messages for P2003/P2025.
- No machine-readable `code` field is added to the body. Clients branch on `statusCode`; `x-request-id` remains the correlation handle. (Revisit only when a web feature genuinely needs to distinguish conflict causes — open question in the memory doc.)
- Translated 4xx responses log exactly one `warn` line with `{ requestId, method, path, prismaCode, target }` — the request logger records status but not cause, and UAT debugging needs the cause. The existing behavior is otherwise unchanged: untranslated non-`HttpException`s keep the enriched `error`-level 5xx log ("unhandled exception", M-02), and plain 4xx `HttpException`s stay quiet. Mapped Prisma errors stop emitting the M-02 "unhandled exception" event (they are no longer unhandled); everything still 500 emits it as before.

### 15.5 Interaction with the global ValidationPipe and existing layers

Order of gates for a mutating request: ValidationPipe (only when the handler declares a DTO class) → controller → use case (business validation, e.g. `assertSupplierEnums` in `supplier.use-case.ts`) → repository/Prisma → this filter.

- Endpoints with typed DTOs already answer 400 at the pipe (`whitelist: true, forbidNonWhitelisted: true, transform: true` — `GLOBAL_VALIDATION_PIPE_OPTIONS`), with field-level `message: string[]`. The filter never sees those.
- `@Body() body: any` endpoints bypass the pipe entirely (no metatype). For them, the filter is the **last-resort backstop**, not the primary validator. Use-case-level checks remain the preferred first line because they name the offending field and allowed values; the filter's 400 is deliberately generic.
- Existing use-case catches of Prisma codes (e.g. `link-line-identity` P2002 → domain response) keep working: the filter only sees exceptions nobody caught. This mapping does NOT make catch-P2002-inside-`$transaction` safe (Postgres aborts the transaction, `25P02`); the txn poison rule stands.
- Converting an `any` endpoint to a DTO is a **client-compatibility change**, not a refactor: any extra field a caller sends becomes a 400 under `forbidNonWhitelisted`. See the staged conversion plan (gap section of the plan doc).

### 15.6 Interaction with apps/web

`apps/web/src/common/api/api-error.logic.ts` maps status → `ApiError.kind`: 404 → `not_found`; 400 → `validation` (string message ⇒ no field errors ⇒ generic "Validation failed." toast); 409 → falls to `unknown` kind but `body.message` is surfaced, so the fixed messages above are user-visible. Accepted residuals: filter-originated 400s render generically in web (field-quality errors come from DTOs/use-case checks), and web has no dedicated `conflict` kind (candidate small web follow-up, out of scope here).

LINE webhook endpoints are unaffected: they force `@HttpCode(200)` and catch internally, so the filter mapping cannot change webhook retry semantics.

### 15.7 Scope

`apps/api` global filter only. The AI Gateway has no Prisma dependency (and must not gain one — §9 / AGENTS.md boundary); its M-02 filter stays log-only.

### 15.8 Enum contract parity invariant (contracts ↔ schema.prisma)

Commit `84a76d9f` made four enum lists runtime-checkable (`as const` arrays in `@watchdog-bms/contracts` with the union type derived from the array). That removes list-vs-type drift *inside* contracts, but `apps/api/prisma/schema.prisma` remains a second source of truth: adding a value to a Prisma enum without updating the contracts array makes runtime validation reject a legitimate value — a quiet 400-where-200-is-correct, worse than the original 500.

Invariant, enforced by a guard test (`packages/contracts/src/prisma-enum-parity.spec.ts`):

- Every contracts `as const` enum array that corresponds to a Prisma enum MUST be registered in the test's explicit registry as `{ contracts export ↔ Prisma enum name }` and MUST be **set-equal** (both directions, order-insensitive, duplicate-free) to the Prisma enum's values, parsed from `schema.prisma` text — the source of truth — not from the generated client (which can be stale against the schema file).
- Cross-named pairs require explicit registry entries; three exist today: `PROCUREMENT_VAT_MODES ↔ AccountingVatMode`, `CRM_AI_SENTIMENTS ↔ CrmSentiment`, `CRM_AI_CUSTOMER_RISKS ↔ CrmRiskLevel`.
- Lists that intentionally exist on only one side are out of parity scope: contracts-only lists with no Prisma enum (e.g. `TAX_ROUNDING_MODES`, `ACCOUNTANT_INDEX_COLUMNS`) are simply not registered; Prisma-only enums (the large majority) stay unregistered until a runtime contracts list for them exists. Type-only unions in contracts (no runtime array) cannot be runtime-checked and are accepted residual drift risk.
- The test must fail loudly — never skip — if `schema.prisma` cannot be found or parses to zero enums, and must fail (via a discovery sweep) when a new same-named `as const` array appears in contracts without a registry entry. New runtime enum lists at API boundaries MUST be added to contracts as `as const` arrays and registered here (this extends §14 "API contract starts with shared TypeScript contracts").

### 15.9 Acceptance criteria (addendum)

- [ ] Filter maps exactly `PrismaClientValidationError`→400, P2002→409, P2025→404, P2003→409; all other exceptions keep today's status and logging byte-for-byte.
- [ ] No Prisma message/internals leak into 4xx bodies beyond P2002 `meta.target` column names.
- [ ] Genuine server faults (P2021/P2022, P1xxx, P2024, P2034, unknown/panic/raw errors) still return 500 and still produce the enriched 5xx log line.
- [ ] Parity test registers the 12 currently-matching array↔enum pairs, is set-equality based, fails loudly on parser breakage, and flags unregistered same-named arrays.
- [ ] Both new spec files are registered in their package's hand-maintained test list (`apps/api/package.json`, `packages/contracts/package.json`) — unregistered specs silently never run.
