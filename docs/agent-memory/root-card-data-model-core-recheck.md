# Agent Memory: Root Card and Data Model Core Recheck

Status: COMPLETE / VERIFIED (2026-06-25)
Owner: Codex
Scope: Root platform status card fix plus Data Model Core item 04 recheck. No item 04 schema/API rewrite.

Role gate status:
- BA: Root page must not mislead users by showing the implemented Business workspace shell as planned; users need a visible path into the company-scoped workspace. Item 04 business goal remains shared tenant, branch, attachment, document sequence, audit, and outbox primitives for later modules.
- SA: Stale root source was `PLATFORM_FOUNDATION_STATUS_ITEMS`; existing workspace route is `/companies/[companyId]/dashboard`. Data Model Core item 04 is already present in Prisma schema/migrations, API module, contracts, and workers; no duplicate Company/User/Membership/AuditLog/OutboxEvent work needed.
- DEV: Ponytail read. Smallest correct diff: add optional `href`/`actionLabel` to platform status items, mark Business workspace shell `ready`, and link it to `/companies/demo-company/dashboard`. Item 04 had no code gap found during recheck, so no schema/API changes were made.
- Integration: Root page typecheck/build and localhost HTML smoke verified the ready badge/link and workspace route. Browser automation tool was not exposed by `tool_search`, so no visual click smoke was run. Item 04 backend-to-contract path verified through API typecheck/tests, Prisma validate, contracts typecheck, and workers typecheck/tests.

Decisions:
- Keep `/` as platform foundation status page.
- Keep company workspace entry at `/companies/demo-company/dashboard` for local/demo navigation.
- Do not add Data Model Core cards to root page; this task only fixed stale shell status and verified item 04.
- Do not rerun local database migration/seed because item 04 memory already records empty-DB migration/seed verification, and this recheck made no schema changes.

Open questions:
- None.

Artifacts:
- `apps/web/src/features/platform-foundation/platform-foundation.model.ts`
- `apps/web/src/features/platform-foundation/platform-foundation.constants.ts`
- `apps/web/src/features/platform-foundation/components/PlatformFoundationPage.tsx`
- `apps/web/src/features/platform-foundation/components/PlatformFoundationPage.module.css`
- `docs/agent-memory/root-card-data-model-core-recheck.md`

Verification:
- `pnpm --filter @watchdog-bms/web typecheck`: pass.
- `pnpm --filter @watchdog-bms/web build`: pass; `/` and `/companies/[companyId]/dashboard` built.
- `pnpm --filter @watchdog-bms/api typecheck`: pass.
- `pnpm --filter @watchdog-bms/contracts typecheck`: pass.
- `pnpm --filter @watchdog-bms/workers typecheck`: pass.
- `pnpm --filter @watchdog-bms/api prisma:validate`: pass.
- `pnpm --filter @watchdog-bms/api test`: sandbox run failed with `listen EPERM` on tsx IPC pipe; escalated rerun passed 281/281.
- `pnpm --filter @watchdog-bms/workers test`: sandbox run failed with `listen EPERM` on tsx IPC pipe; escalated rerun passed 5/5.
- `pnpm agent:gates -- docs/agent-memory/data-model-core-04.md`: pass.
- `pnpm --filter @watchdog-bms/web dev`: sandbox run failed with `listen EPERM` on `127.0.0.1:3000`; escalated temporary dev server started on `http://127.0.0.1:3003` because port 3000 was already in use.
- Localhost smoke with escalated fetch: `/` returned 200 and included `Business workspace shell`, `ready`, `Open workspace`, and `/companies/demo-company/dashboard`.
- Localhost smoke with escalated fetch: `/companies/demo-company/dashboard` returned 200 and included workspace/company content.
- `pnpm agent:gates -- docs/agent-memory/root-card-data-model-core-recheck.md docs/agent-memory/data-model-core-04.md`: pass.

Next:
- Next product roadmap item remains 11. Thai Tax MVP unless owner reorders.
