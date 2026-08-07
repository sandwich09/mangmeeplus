# Agent Memory: Auth, RBAC, and Audit (02)

Status: COMPLETE / VERIFIED (rechecked 2026-06-24)
Owner: Codex
Scope: apps/api auth module, access-control module, audit module, apps/ai-gateway auth boundary

Role gate status:
- BA: Goal/users/journey/rules accepted from docs/specs/auth-authorization-rbac-spec.md and docs/specs/permission-matrix.md: identify users, resolve company membership, enforce deny-by-default RBAC/ABAC, audit sensitive actions, and keep AI tools permission-inherited.
- SA: Architecture/contracts accepted from docs/plans/auth-rbac-audit-plan.md: Nest API SecurityModule/AuthModule/AccessControlModule/AuditModule plus AI Gateway auth boundary; Prisma identity/access/audit models; RequestContext and audit contracts in packages/contracts; no direct DB in AI Gateway.
- DEV: Ponytail read. Smallest corrective diff after review: make protected routes without permission metadata fail closed, centralize audit metadata sanitization, enforce audit role/category filters, align audit action taxonomy, and audit LINE exchange denial/session refresh. Touched files are listed below. Focused and repo checks pass.
- Integration: Backend-to-AI contract verified by API + AI Gateway tests and repo build/typecheck. No browser/E2E UI path exists for item 02; protected API/AI permission/error paths are covered by unit/integration-style tests.

Decisions:
- Prisma 7 schema uses status enums (not isActive booleans): UserStatus, MembershipStatus, etc.
- AuthSession model tracks all issued tokens; tokenId = JWT jti claim
- ExternalIdentity unique key: (provider, providerChannelId, providerUserId)
- Role unique key: (scopeKey, key) — scopeKey='system' for system roles
- AccessControlModule is @Global(); PermissionResolverService delegates to PrismaPermissionResolverRepository
- JWT access tokens embed permissions[] at issuance for AI Gateway consumption (no DB call in gateway)
- AI Gateway verifies WatchDog JWT, reads permissions from claims, enforces ai.tool.invoke — no Prisma
- Raw body in webhook uses JSON.stringify fallback; upgrade path: add verify hook to json() in main.ts
- Audit writes are fire-and-forget (void) so they never block auth flows
- Protected routes without `@RequirePermissions(...)` now return `403`; no auth-only protected route bypass remains.
- Audit metadata is sanitized centrally before persistence: tokens, cookies, auth headers, raw prompts, full bodies/payloads/content, and oversized strings are redacted/truncated.
- Audit log read ABAC is role/category filtered: OWNER/AUDITOR_READONLY full company, ADMIN admin/security, ACCOUNTANT accounting/tax/finance, fallback own logs.
- Audit action taxonomy now follows docs/specs/auth-authorization-rbac-spec.md §19.8.
- Owner decision 2026-06-26: normal employee users may have only one active company membership. Active multi-company membership is reserved for OWNER users. LINE/LIFF company selection is OWNER-only by default; non-owner multi-company membership is a policy violation to block and audit until Admin fixes membership.
- Owner decision 2026-06-26: inactive or removed company membership fails closed immediately for web, LIFF, LINE AI, alerts, deep links, uploads, AI tools, and internal API calls. Valid LINE Login, valid webhook signature, cached `LineCompanyContext`, existing session, or old deep link never bypasses active membership.

Artifacts:
- apps/api/prisma/schema.prisma — full spec-aligned schema
- apps/api/prisma/migrations/20260624000001_item02_schema/migration.sql
- apps/api/src/modules/auth/ — auth guard, endpoints, use-cases (issue, exchange, refresh, logout, link, unlink)
- apps/api/src/modules/access-control/ — PermissionResolverService, ABAC policies (own-record, tenant-boundary, composite)
- apps/api/src/modules/audit/ — AuditAction taxonomy, GET /v1/audit/logs with role-based filtering
- apps/ai-gateway/src/auth/ — WatchdogContextVerifier, AiToolGuard, AiAuthModule
- packages/contracts/src/index.ts — RequestContext, AuditEventInput, AuthProvider types
- docs/plans/master-implementation-checklist.md — item 02 ticked after verification
- 2026-06-26 docs update: auth/RBAC spec, LINE AI spec/plan, and permission matrix now encode employee single-company and OWNER multi-company policy.
- 2026-06-26 docs update: LINE channel/auth, auth/RBAC, LINE AI spec/plan, and permission matrix now encode LINE verification layers and inactive-membership fail-closed behavior.

Verification:
- pnpm --filter @watchdog-bms/api typecheck: ✅
- pnpm --filter @watchdog-bms/api test: 52/52 ✅
- pnpm --filter @watchdog-bms/ai-gateway typecheck: ✅
- pnpm --filter @watchdog-bms/ai-gateway test: 19/19 ✅
- pnpm typecheck: ✅ 10/10 tasks
- pnpm build: ✅ 7/7 tasks
- pnpm test: ✅ 10/10 tasks, API 52/52, AI Gateway 19/19
- pnpm --filter @watchdog-bms/api prisma:validate: ✅ schema valid
- pnpm security:audit: ✅ high threshold pass; 1 moderate vulnerability remains
- AI Gateway DB bypass check: `rg "@prisma/client|PrismaService|database|prisma" apps/ai-gateway/src apps/ai-gateway/package.json` returned no matches.
- Recheck 2026-06-24:
  - `pnpm --filter @watchdog-bms/api typecheck`: pass.
  - `pnpm --filter @watchdog-bms/ai-gateway typecheck`: pass.
  - `pnpm --filter @watchdog-bms/api prisma:validate`: pass.
  - `pnpm --filter @watchdog-bms/api test`: first sandbox run failed with `listen EPERM` on tsx IPC pipe under `/var/folders/.../T`; escalated rerun passed 52/52.
  - `pnpm --filter @watchdog-bms/ai-gateway test`: first sandbox run failed with `listen EPERM` on tsx IPC pipe under `/var/folders/.../T`; escalated rerun passed 19/19.
- 2026-06-26 docs-only policy update:
  - BA: Company owners can manage multiple companies; employees (บัญชี/การเงิน/คลัง/etc.) operate in one company to avoid accidental cross-tenant context.
  - SA: Keep `CompanyMembership` model; enforce active multi-company membership only when the user has OWNER role. Non-owner duplicates return 403 and audit violation until corrected. Inactive/removed memberships reject before company data, regardless of LINE Login/webhook/session validity.
  - DEV: Ponytail read. Smallest diff updates existing docs only; no schema/code change in this turn.
  - Integration: LINE/web context rule aligned: employees resolve from single membership, owners use LIFF/web selector, all deep links/tools still re-check active company membership and permission. LINE Login proves identity; webhook signature proves channel event; WatchDog auth still owns authorization.
  - Commands: `git diff --check -- <touched docs>` pass. `pnpm agent:gates -- <touched docs>` blocked by pnpm install preflight: first no-TTY module purge, then frozen lockfile overrides mismatch after `CI=true`; no source doc lint issue found before preflight.

Next:
- 03. Web Core Workspace is now verified separately.
- 04. Data Model Core.
