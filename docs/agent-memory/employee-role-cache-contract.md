# Agent Memory: Employee role cache contract

Status: Entitlement-alignment and employee self-service baseline complete locally; not deployed
Owner: Codex
Scope: Diagnose why the employee role picker remained empty on UAT after the cache-boundary release, correct the shared grant rule across list/create/update, add the internal-employee self-service role baseline, and verify regression/gap/impact before a single deployment.
Decisions:
- Treat ERP API responses as tenant/session/permission-contextual by default: `private, no-store, max-age=0` and no Express-generated ETags.
- Keep Next/static asset caching unchanged because it is served by the separate web process.
- Request the role catalog with browser `cache: 'no-store'` so the first rollout cannot reuse a representation cached before the server fix.
- Keep `RoleSummary.assignableByCurrentUser` optional for requester-less backend reads, but require a boolean in browser role catalogs and surface an invalid-response load error if absent.
- Correct the earlier diagnosis: cache hardening was deployed and works, but was not the remaining root cause. UAT returned a valid current contract whose flags were all false.
- `RequestContext.permissions` is entitlement-filtered, while system-role permission rows are intentionally raw. `RequestContext.entitlementDeniedPermissions` already records the otherwise-granted raw keys removed by entitlement evaluation.
- Make the resolver-denied map an explicit argument to shared `roleGrantViolation`; list roles, create employee, and update employee all pass it. The helper restores those proven raw grants for a raw-to-raw subset check. This fixes UAT without allowing a requester to pre-assign dormant feature permissions they never held, and adds no create/update database query.
- Do not add another protected system role. OWNER/ADMIN remain the employee lifecycle roles; a delegated people administrator remains a custom role composed from the existing people packs.
- Grant expense capture, receipt upload, own-draft update/delete, reimbursement self lifecycle, and personal-signature self management to the nine protected internal employee roles. Keep AUDITOR_READONLY, COMPANY_VIEW, SYSTEM_ADMIN, and arbitrary custom roles out of the automatic baseline.
- Add `expense.signature.self_manage`; it authorizes only the caller's rows. Backend list/archive/preview/write/invoke ownership checks make every role, including OWNER/ADMIN, see and use only its own signatures. Historical signed documents keep pinned attachments.
- Existing custom roles opt in through `pack.expense.self`/`pack.reimbursement.self`; the new signature key is backfilled only when `expense.create` proves an existing expense-self role.
Open questions: None.
Artifacts:
- `docs/adr/0012-private-no-store-api-default.md`
- `apps/api/src/common/middleware/api-cache-control.middleware.ts`
- `apps/api/src/main.ts`
- `apps/web/src/features/employee-access/employee-access.api.ts`
- `apps/web/src/features/employee-access/role-picker.logic.ts`
- `packages/contracts/src/employee-access.ts`
- `docs/specs/employee-access-role-picker-scope-spec.md`
- `apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts`
- `apps/api/src/modules/employee-access/application/use-cases/list-roles.use-case.ts`
- `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts`
- `apps/api/src/modules/employee-access/application/use-cases/update-employee.use-case.ts`
- `apps/api/src/modules/auth/permission-registry.ts`
- `apps/api/src/modules/expenses/application/use-cases/signature-asset.use-case.ts`
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx`
- `packages/contracts/src/feature-entitlements.ts`
- `docs/specs/permission-matrix.md`
Verification:
- API focused: 25/25 passed (`request-logger.middleware.spec.ts` including cache policy, plus `role-management.use-case.spec.ts`).
- Web focused: 13/13 passed (`employee-access.api.spec.ts` and `role-picker.logic.spec.ts`).
- Web full suite: 975/975 passed.
- Contracts build, API typecheck, Web typecheck: passed.
- API boot DI smoke: Nest resolved every provider.
- HTTP smoke: response was `private, no-store, max-age=0`, no ETag, and a conditional request returned 200 rather than 304.
- `git diff --check`: passed.
- Impact audit: Next/static and immutable legal caching are separate and unchanged; direct S3 presigned downloads are unchanged; no API route uses intentional public caching. The public LIFF script's existing `no-cache` override remains, but disabling API ETags means its small body now transfers on each load. Repeated API GETs transfer full JSON; controller/database work already occurred before Express's former 304 decision.
- Live UAT evidence (release commit `250e063`): `/v1/health` and unauthenticated role requests return `private, no-store, max-age=0`, no ETag, Cloudflare DYNAMIC. The signed-in employee page accepted the strict response contract and showed no load error, but no role options.
- Read-only UAT DB/effective-permission audit for company `cmsn5m75e00dg1z5tggf420vy`: current user is ADMIN; raw ADMIN has 194 permissions and the entitlement-filtered request context has 94. The old raw-vs-effective comparison reported 100 false missing permissions; restoring the resolver's 100 entitlement-denied raw grants makes ADMIN and other valid roles grantable while real superset/finance restrictions remain.
- Entitlement regression suite: 86/86 passed across shared logic, role listing, employee create, and employee update.
- API typecheck passed after regenerating the ignored Prisma client from the current schema.
- API boot DI smoke: Nest resolved every provider in 138ms.
- `git diff --check`: passed after code and documentation updates.
- Employee baseline/API focused regression: 265/265 passed across permission registry, role packs/backfills, entitlement filtering, role grantability, expense signature/own-draft delete, substitute receipt, and reimbursement self lifecycle.
- LINE intake regression: 133/133 passed, including `expense.signature.self_manage` upload through LINE.
- Web full suite: 1004/1004 passed; personal-signature navigation, route, owner-only UI, and receipt-upload OCR capability are aligned.
- Contracts focused: 30/30 passed and contracts build passed.
- API and Web typechecks passed; API boot DI smoke resolved every provider in 162ms.
- Impact audit: no schema migration or new dependency; production boot's existing `sync-permissions.ts` creates the new permission, reconciles protected system-role grants, and additively backfills only custom roles anchored by `expense.create`. Entitlement OFF still strips the new mutations. Signature list now reads fewer rows and removes the user-name query; ordinary request latency is not increased.
- `git diff --check`: passed after the combined code and documentation update.
Next: Commit and push the isolated branch to update PR #201. After required review and merge, deploy to UAT only through the mandatory deployment protocol, then verify role listing/add-employee plus employee expense, reimbursement, and owner-only signature journeys. No deployment was performed in this fix task.
