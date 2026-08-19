# Agent Memory: access-overview-granted-only-permission-summary

Status: Complete; verified; ready for PR to `develop`
Owner: Main thread
Scope: Granted-only, source-honest, responsive permission summary on `/settings/access-overview`

Decisions:

- Hide menu rows whose merged `view` grant is not true.
- Hide group headings left empty after filtering.
- Show granted actions as wrapping, non-interactive status text; no pills/buttons and no horizontal scroller.
- Show full menu labels without truncation.
- Replace `N/7` with granted-only count copy.
- Preserve the existing seven-menu MVP1 summary catalog.
- Union all roles assigned to the employee for display.
- Keep `/settings/permissions` as the full authoring/audit matrix.
- Do not change API/schema/permission/route/branch/LINE/AI behavior in this slice.

Open questions:

- Deferred product decision: keep role authoring permanently single-role or expose the backend's existing multi-role capability.
- Deferred catalog task: align/expand the seven-menu summary against the full workspace module registry.

Artifacts:

- `docs/specs/access-overview-granted-only-permission-summary-spec.md`
- `docs/plans/access-overview-granted-only-permission-summary-plan.md`
- `docs/agent-memory/access-overview-granted-only-permission-summary.md`

Implementation:

- Added a pure role-union projection that ORs actions across every assigned role, preserves action/group order, filters unsupported or denied menus, removes empty groups, and reports missing role rows as incomplete.
- Replaced denied rows and button-like pills with full wrapping menu labels plus checkmarked plain-text status.
- Added honest no-role, true-zero, roles/matrix error, stale/missing-row, DRAFT/INVITED/SUSPENDED/DISABLED, and branch-load-error states.
- Kept the seven-menu MVP1 boundary and the existing entitlement-filtered access matrix as the permission source.
- Kept role/status/credential/branch mutation payloads and guards unchanged.
- Added browser coverage for one-action and five-action rows, false-zero prevention, multi-role union without seed mutation, scoped branch failure, and mobile overflow/ellipsis/focus behavior.

Touched files:

- `apps/web/src/features/employee-access/access-overview.model.ts`
- `apps/web/src/features/employee-access/access-overview.model.spec.ts`
- `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`
- `e2e/settings.spec.ts`
- `e2e/responsive.spec.ts`
- Linked spec, plan, coverage, and master-checklist docs listed above.

Pre-implementation impact findings:

- The prior UI rendered all seven MVP1 rows and labeled denied ones `ไม่เห็นเมนูนี้`.
- Menu labels used `truncate`; granted actions used filled rounded pills.
- A matrix/roles request failure was ignored by `reload()` and could look like zero access.
- The page used `selectedEmployee.roles[0]`, while contracts/API support multiple roles.
- The role matrix is entitlement-filtered and must remain the source; the browser must not reconstruct raw permission truth.
- Draft/suspended/disabled account state must be distinguished from assigned role grants.
- Existing route/API guards remain authoritative and are regression boundaries, not implementation targets.

Verification:

- Focused web model: 8/8 passed.
- Full web package: 958 tests passed.
- Web typecheck passed after building the existing config/contracts workspace artifacts.
- Existing API access-matrix projection: 4/4 passed, including entitlement filtering.
- Settings E2E: SET-05, SET-08, SET-08A, SET-08B, SET-08C, and SET-09 passed on desktop Chromium.
- Responsive E2E: six access-overview checks passed at 375, 390, and 412 CSS px; desktop SET-08 ran at the standard 1280 px Chromium viewport.
- `git diff --check` passed.
- The host helper could not run because `psql` is unavailable and its hard-coded native Postgres port 5432 is down; equivalent Playwright commands passed against the running local compose Postgres on 15432 after the normal Prisma client generation step.
- No package manifest, dependency, contract, API, schema, route policy, deployment, or cloud state changed.
- A concurrent role-picker/sidebar task modified overlapping files in the original worktree; this change was reconstructed and verified in a clean worktree so those unrelated edits are not included in the commit.

Next:

- Commit the clean scoped diff, push the branch, and open a PR to `develop`.
