# Agent Memory: Platform Foundation (01)

Status: Complete (Codex fix 2026-06-24 closed item 01 blockers)
Owner: Augment Agent / sandwich09 / Codex
Scope: docs/plans/platform-foundation-local-prod-lean-plan.md Phases 1-7

## Role gate status:

- BA: Complete - spec and plan existed before implementation; business goal, rules, and acceptance criteria are in docs/specs/platform-foundation-local-prod-lean-spec.md
- SA: Complete - production fail-fast contract, runtime config boundary, local Docker topology, migration run order, and AI Gateway-to-ERP permission boundary are documented and implemented.
- DEV: Complete - Ponytail read; smallest correct diff focused on item 01 gaps; config validation, tests, Prisma seed/migration workflow, Docker runtime paths, and app config DI were fixed.
- Integration: Complete - backend, AI Gateway, workers, web, DB, Redis, and MinIO local stack path was verified through Docker with health endpoints and seed/migration flow.

## Codex fix summary

- Expanded `@watchdog-bms/config` schemas and production fail-fast checks for service metadata, public URL, JSON logging, CORS, swagger, LINE auth/messaging, JWT issuer/audience/secret, audit/rate limit, DB/Redis/S3, AI policy/audit/final-mutation/prompt logging, and workers config.
- Routed API runtime config through `AppConfigService` and a global config module; logger, Prisma, auth guard, LINE/JWT/dev verifiers, health flow, and bootstrap use config services instead of ad hoc runtime env reads.
- Routed AI Gateway config through `AiGatewayConfigService`; bootstrap validates config, CORS, body limits, swagger, and startup failures explicitly.
- Enforced AI tool policy to require ERP core permission checks; tool policy tests now cover the repeat rule.
- Added workers config parsing and production validation before heartbeat startup.
- Made API and AI package tests executable in `pnpm test` using `tsx --test`; fixed API AuthGuard spec.
- Added idempotent Prisma seed for health permission, default company, owner user, dev external identity, company membership, and owner membership role.
- Added Prisma validation and migration-review scripts, plus CI migration-review job.
- Fixed local Docker environment propagation, env-overridable host ports, service metadata, S3/Redis/DB/AI/API/web env, package build order, and Docker CMD paths.
- Updated platform foundation plan with role gates, integration verification, migration run order, and completion markers for item 01 gaps.

## Decisions

- APP_ENV uses `local` and `production` only (not staging); lean path per spec.
- Prisma 7 adapter-based client remains the API DB boundary; `PrismaService` exposes `.client`.
- No new runtime pretty-logging dependency; production requires JSON logs.
- Rate limit config is validated now; full Nest throttler wiring remains deferred to the business module phase.
- Auth guard order: `AuthGuard` runs before `DenyByDefaultGuard`.
- Local dev auth is allowed only in local mode and requires `DEV_AUTH_SECRET`; production rejects dev auth and `DEV_AUTH_SECRET`.
- LINE Login remains verified through `https://api.line.me/oauth2/v2.1/verify`; LINE webhook uses HMAC-SHA256 with timing-safe comparison.
- AI Gateway keeps `MODEL_PROVIDER=disabled` by default; tools cannot execute without policy, audit, and ERP core permission checks enabled.

## Artifacts

- `packages/config/src/index.ts` - expanded schemas, `validateProductionConfig`, and `redact`.
- `packages/config/src/index.test.ts` - 34 config schema/production validation tests.
- `scripts/validate-prod-config.ts` - 13 production config validation checks.
- `apps/api/src/common/config/` - global API config module and `AppConfigService`.
- `apps/api/src/common/database/`, `apps/api/src/common/logger/`, `apps/api/src/modules/auth/`, `apps/api/src/modules/audit/`, `apps/api/src/modules/health/` - API runtime config integration and tests.
- `apps/api/prisma/` and `apps/api/prisma.config.ts` - schema, migration, seed, and Prisma config.
- `apps/ai-gateway/src/common/config/`, `apps/ai-gateway/src/common/logger/`, `apps/ai-gateway/src/common/ai/` - AI Gateway config and tool policy enforcement.
- `apps/workers/src/main.ts` - workers config validation before startup.
- `infra/docker/compose.local.yml` and app Dockerfiles - local integration runtime fixes.
- `.github/workflows/ci.yml` - typecheck/test/security/secret/docker/config/migration review workflow coverage.
- `docs/plans/platform-foundation-local-prod-lean-plan.md` - role gates, integration verification, migration run order, and item 01 completion evidence.

## Verification:

- `pnpm --filter @watchdog-bms/config test`: pass, 34/34 tests.
- `pnpm --filter @watchdog-bms/config build`: pass.
- `pnpm --filter @watchdog-bms/api typecheck`: pass.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: pass.
- `pnpm --filter @watchdog-bms/workers typecheck`: pass.
- `pnpm --filter @watchdog-bms/api test`: pass, 6/6 tests.
- `pnpm --filter @watchdog-bms/ai-gateway test`: pass, 6/6 tests.
- `pnpm config:validate`: pass, 13/13 checks.
- `pnpm --filter @watchdog-bms/api prisma:validate`: pass.
- `pnpm --filter @watchdog-bms/api migration:review > /tmp/watchdog-bms-migration-review.sql`: pass, generated 188-line SQL review file.
- `pnpm typecheck`: pass, 9/9 packages.
- `pnpm test`: pass, 9/9 packages.
- `pnpm build`: pass, 7/7 tasks.
- `pnpm security:audit`: pass at high threshold; 1 moderate vulnerability remains reported by audit.
- `docker compose -f infra/docker/compose.local.yml --env-file .env.example config`: pass.
- Docker local integration with alternate host ports:
  - Postgres/Redis/MinIO started healthy.
  - `prisma migrate deploy`: pass.
  - `prisma db seed`: pass.
  - API health `http://127.0.0.1:13001/v1/health`: returned `status: ok`, `db: ok`.
  - AI Gateway health `http://127.0.0.1:13002/v1/health`: returned `status: ok`.
  - Web `http://127.0.0.1:13000`: returned HTTP 200.
  - Workers container emitted heartbeat JSON.
  - Local Docker stack was shut down after verification.
- `pnpm agent:gates -- docs/agent-memory/platform-foundation-01.md docs/plans/platform-foundation-local-prod-lean-plan.md`: pass; memory and plan gate evidence ok.

## Next:

Item 01 Platform Foundation is ready for item 02 Auth/RBAC/Audit work. Track the remaining moderate `pnpm audit` finding separately because the current security gate only fails on high severity.
