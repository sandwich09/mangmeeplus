# P2 Security Hardening L-01–L-15 Plan

Spec: `docs/specs/p2-security-hardening-l01-l15-spec.md`
Memory: `docs/agent-memory/p2-security-hardening-l01-l15.md`

## Concurrency constraint (read first)

A concurrent session owns P1 `M-04`–`M-18` and is actively editing this same working
tree. Rules for every lane:

1. **Re-read a file immediately before editing it.** Never rely on a line number
   captured earlier in the session.
2. **Never `git add -A`.** Staging is surgical and done by the orchestrator only.
3. **Do not edit a file another lane owns** (table below). If a change seems to
   require it, report it instead of doing it.
4. **Do not edit `apps/api/package.json`.** New spec files are reported upward and the
   orchestrator registers them in the hand-maintained `test` file list in one edit.
5. New Prisma migrations use timestamps `>= 20260728190000` so they order after the
   concurrent session's four untracked migrations.

## Phase 0 — Config and secrets (serial, must land before phases 1–4)

Owner files: `packages/config/src/index.ts`, `packages/config/src/index.test.ts`,
`apps/api/src/common/config/app-config.service.ts`,
`apps/ai-gateway/src/common/config/ai-gateway-config.service.ts`, `.env.example`,
`apps/api/prisma/seed.ts`.

Delivers `L-03` plus every config value the later lanes consume:

| Key | Default | Consumer |
| --- | --- | --- |
| `WATCHDOG_JWT_ISSUER` / `WATCHDOG_JWT_AUDIENCE` | non-secret defaults in api + gateway schemas | L-04 |
| `SESSION_REFRESH_REUSE_GRACE_SECONDS` | `30` | L-01 |
| `PASSWORD_RESET_RESPONSE_MIN_MS` | `300` | L-06 |
| `AI_FINAL_MUTATION_ENABLED` readable by the API | `false` | L-08 |
| `AGENTCORE_MAX_BODY_BYTES` | `1048576` | L-12 |
| `AGENTCORE_MAX_MESSAGE_CHARS` | `8000` | L-12 |
| `AGENTCORE_MAX_ATTACHMENTS` | `10` | L-12 |
| `AGENTCORE_MAX_CONCURRENT_INVOCATIONS` | `16` | L-12 |
| `SEED_SYSTEM_ADMIN_PASSWORD` | forbidden in production | L-03 |
| `LOG_LEVEL` production pin (no `debug`) | — | L-09 |
| shared deep log redactor export | — | L-09 |

## Phases 1–4 (parallel, disjoint ownership)

| Lane | Findings | Owned paths |
| --- | --- | --- |
| A | L-01, L-04, L-05, L-06 | `apps/api/src/modules/auth/**`, `AuthSession` in `apps/api/prisma/schema.prisma` + new migration, `apps/ai-gateway/src/auth/**` |
| B | L-09, L-14 | `apps/api/src/common/logger/**`, `apps/ai-gateway/src/common/logger/**`, both `all-exceptions.filter.ts`, `request-logger.middleware.ts`, `apps/workers/src/**`, `apps/api/src/common/security/api-rate-limit.guard.ts`, `crm-line-webhook.controller.ts`, `workflow-webhook.use-case.ts` deny site, `infra/prod-ecs-express/deploy.sh` alarm filter |
| C | L-10, L-11, L-15 | `apps/api/src/modules/audit/**`, financial use-case audit call sites (ledger, accounting-documents, procurement, expenses), `outbox-append.service.ts`, `prisma-crm-inbox.repository.ts` erasure block, new L-15 migration |
| D | L-07, L-08, L-12, L-13 | `secret-compare.ts`, `worker-token.ts`, `internal-secret.ts`, `apps/web/src/common/auth/middleware.logic.ts`, `internal-tools.controller.ts`, `apps/ai-gateway/src/agentcore/runtime.ts`, both `modules/health/**`, both `main.ts` |

Cross-lane contract: lanes B and A/C/D agree on security event names by using the
literal dotted strings listed in the spec. No lane imports another lane's new module.

## Phase 5 — Verification

Node must be pinned per Bash call: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.

1. Per-lane focused tests (`tsx --test <files>`).
2. `packages/config` tests, contracts build.
3. Orchestrator registers all new specs in `apps/api/package.json` `test`, then runs the
   full API suite once (no concurrent typecheck runs).
4. Typechecks serially: api, ai-gateway, web, contracts, config.
5. `prisma validate` + migration review; migrations applied to the local database with
   `DATABASE_URL` passed explicitly (`postgresql://…@localhost:15432/watchdog_bms`).
6. `pnpm config:validate` against production-shaped values for L-03.
7. `bash -n` on any touched shell script.

## Phase 6 — Review and closure

1. Fable 5 review pass per lane, hunting gaps and bugs against the spec contracts.
2. Opus 5 fixes every confirmed finding.
3. Checklist evidence written per item; top-level `[x]` only where code + tests are the
   stated closure evidence, otherwise `[x] Code/test remediation` + `[ ] Live closure`.
