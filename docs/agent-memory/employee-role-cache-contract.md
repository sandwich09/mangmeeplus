# Agent Memory: Employee role cache contract

Status: Complete locally; not deployed
Owner: Codex
Scope: Fix the employee role picker disappearing after deployment, add a durable API cache boundary, and verify regression/gap/impact without deploying.
Decisions:
- Treat ERP API responses as tenant/session/permission-contextual by default: `private, no-store, max-age=0` and no Express-generated ETags.
- Keep Next/static asset caching unchanged because it is served by the separate web process.
- Request the role catalog with browser `cache: 'no-store'` so the first rollout cannot reuse a representation cached before the server fix.
- Keep `RoleSummary.assignableByCurrentUser` optional for requester-less backend reads, but require a boolean in browser role catalogs and surface an invalid-response load error if absent.
Open questions: None.
Artifacts:
- `docs/adr/0012-private-no-store-api-default.md`
- `apps/api/src/common/middleware/api-cache-control.middleware.ts`
- `apps/api/src/main.ts`
- `apps/web/src/features/employee-access/employee-access.api.ts`
- `apps/web/src/features/employee-access/role-picker.logic.ts`
- `packages/contracts/src/employee-access.ts`
- `docs/specs/employee-access-role-picker-scope-spec.md`
Verification:
- API focused: 25/25 passed (`request-logger.middleware.spec.ts` including cache policy, plus `role-management.use-case.spec.ts`).
- Web focused: 13/13 passed (`employee-access.api.spec.ts` and `role-picker.logic.spec.ts`).
- Web full suite: 975/975 passed.
- Contracts build, API typecheck, Web typecheck: passed.
- API boot DI smoke: Nest resolved every provider.
- HTTP smoke: response was `private, no-store, max-age=0`, no ETag, and a conditional request returned 200 rather than 304.
- `git diff --check`: passed.
- Impact audit: Next/static and immutable legal caching are separate and unchanged; direct S3 presigned downloads are unchanged; no API route uses intentional public caching. The public LIFF script's existing `no-cache` override remains, but disabling API ETags means its small body now transfers on each load. Repeated API GETs transfer full JSON; controller/database work already occurred before Express's former 304 decision.
Next: Review/commit the isolated branch, then deploy to UAT only through the mandatory deployment protocol and verify the authenticated role response/header plus the add-employee picker. No live deployment was performed in this task.
