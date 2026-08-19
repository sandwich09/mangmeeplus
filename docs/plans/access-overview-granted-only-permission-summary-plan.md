# Access Overview Granted-Only Permission Summary Implementation Plan

## 1. Status

- Status: COMPLETE
- Date: 2026-08-19
- Production code changed: Yes — web projection/UI plus focused E2E only; no API, contract, schema, route-policy, or dependency change
- Linked spec: `docs/specs/access-overview-granted-only-permission-summary-spec.md`
- Roadmap/checklist item: 10C+ focused UX/correctness follow-up

## 2. Purpose

Replace the noisy, button-like all-menu permission summary on `/settings/access-overview` with an honest granted-only summary. The implementation must stay small, reuse the existing entitlement-filtered permission matrix, and close the discovered false-zero and multi-role display gaps without changing authorization or role grants.

## 3. Current Repository Context

### Live path

- Route: `apps/web/app/(workspace)/companies/[companyId]/settings/access-overview/page.tsx`
- Page: `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`
- Pure display logic: `apps/web/src/features/employee-access/access-overview.model.ts`
- Existing pure tests: `apps/web/src/features/employee-access/access-overview.model.spec.ts`
- Client API: `apps/web/src/features/employee-access/employee-access.api.ts`
- Contract/menu projection: `packages/contracts/src/access-matrix.ts`
- API projection: `apps/api/src/modules/employee-access/application/use-cases/get-access-matrix.use-case.ts`
- API guard: `access.role.read`
- Page route guard: `access.employee.read`
- Browser coverage: `e2e/settings.spec.ts`, `e2e/responsive.spec.ts`

### Patterns to reuse

- `capabilityLabels()` and stable action ordering.
- Existing `MENU_GROUP_ORDER` and Thai group labels.
- Existing `LoadingState`, card primitives, localized error mapping, and reload path.
- Existing server-computed, entitlement-filtered `PermissionMatrix`; do not derive permissions from raw keys in the browser.
- Existing hide-not-disable policy from `permission-page-visibility-plan.md`.

### Known constraints

- The summary is bounded to `MVP1_INDIVIDUAL_PERMISSION_MENU_IDS` (seven menus).
- Employee contracts/API support multiple roles even though this page's picker writes one replacement role.
- `reload()` currently settles four requests independently and ignores roles/matrix/branches failures.
- The page contains unrelated employee status, role, credential, and branch mutations that must remain byte-for-byte behaviorally equivalent.
- The repo has existing responsive evidence for both `/settings/access-overview` and `/settings/permissions`.
- Do not edit any `package.json`; no dependency is needed.

## 4. Scoped Impact and File Ownership

### Expected production-code edits

1. `apps/web/src/features/employee-access/access-overview.model.ts`
2. `apps/web/src/features/employee-access/access-overview.model.spec.ts`
3. `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`
4. `e2e/settings.spec.ts`
5. `e2e/responsive.spec.ts` only if a focused invariant cannot be expressed in `settings.spec.ts`

### Verify, do not change unless a Phase 0 contradiction is found

- `packages/contracts/src/access-matrix.ts`
- `apps/api/src/modules/employee-access/application/use-cases/get-access-matrix.use-case.ts`
- `apps/api/src/modules/employee-access/presentation/http/access-catalog.controller.ts`
- `apps/web/src/features/web-core-workspace/route-permissions.ts`
- `apps/web/src/features/employee-access/PermissionMatrixPrototypePage.tsx`

### Explicitly excluded

- Prisma/schema/migration.
- API response or permission-guard change.
- Workspace navigation or settings-hub change.
- Role-builder or role-picker policy redesign.
- LINE/AI/workers/cloud/deploy.

## 5. Phase 0 — Correctness Baseline and Scope Lock

### Goal

Prove the existing data contract and establish a red baseline for the exact defects before changing presentation.

### Tasks

- [x] Read the linked spec, current access-overview component/model/tests, access-matrix contract/use-case, route guard, and old redesign memory.
- [x] Read and follow the repo Ponytail skill before the first production-code edit.
- [x] Record the owner decision that denied rows disappear and that this supersedes the old D1 muted-row behavior.
- [x] Confirm the seven supported menu ids have not changed.
- [x] Confirm every assigned `EmployeeRoleRef.id` can be matched to a matrix row under a normal successful response.
- [x] Add failing focused tests for:
  - denied menu filtering;
  - empty-group pruning;
  - multi-role action union;
  - missing assigned-role row as incomplete/error;
  - matrix failure not becoming zero access;
  - granted count matching rendered rows.
- [x] Run the current focused web test and typecheck commands and record any pre-existing failures before edits.
- [x] Inspect existing dirty files and keep unrelated changes untouched.

### Exit criteria

- A bounded red test set represents the requested behavior and discovered correctness gaps.
- No requirement to change API, schema, permission grants, or the seven-menu catalog is found.
- If the matrix cannot represent the required union or entitlement result, stop and update the spec instead of inventing client permission rules.

## 6. Phase 1 — Pure Granted-Access Projection

### Goal

Move all union/filter/group/count decisions into small pure helpers so the JSX cannot silently conflate load failure with denied access.

### Tasks

- [x] Add a pure helper that merges cells for all assigned role ids using boolean OR per action.
- [x] Return a distinct incomplete/error result when any assigned role id lacks a matrix row.
- [x] Add a pure projection that:
  - keeps the existing seven-menu set;
  - retains only merged cells with `view === true`;
  - maps granted actions in stable order;
  - groups by existing group order;
  - removes empty groups;
  - derives the rendered menu count.
- [x] Keep `capabilityLabels()` compatible with current callers or replace it only within the same model file.
- [x] Do not import API clients or React into the model.
- [x] Extend focused `node:test` coverage for every spec rule above.

### Tests

- `node --import tsx --test src/features/employee-access/access-overview.model.spec.ts` from `apps/web`, or the current package-equivalent command discovered in Phase 0.

### Exit criteria

- Pure tests prove single-role, multi-role, zero-menu, missing-row, stable-order, and group-pruning behavior.
- No UI code independently recalculates permission truth.

## 7. Phase 2 — Honest Load State and Responsive UI

### Goal

Render the projection as a granted-only, non-interactive summary without changing employee/role/branch mutation behavior.

### Tasks

#### Data and state

- [x] Give roles/matrix failures a permission-card-specific error state.
- [x] Give branch failure a branch-card-specific state if the current global error cannot distinguish it safely.
- [x] Clear or invalidate permission projection after a failed post-mutation reload; never keep a stale role/matrix combination while claiming it is current.
- [x] Preserve the selected employee and existing directory behavior when unrelated branch data fails.
- [x] Derive the selected employee's role ids from all `selectedEmployee.roles`, not `roles[0]`, for summary display.
- [x] Preserve existing role-picker mutation payload and guards; multi-role authoring is out of scope.

#### Permission card

- [x] Render only projected granted groups and rows.
- [x] Delete the `ไม่เห็นเมนูนี้` branch from this card.
- [x] Replace `N/7 เมนู` with `ใช้งานได้ N เมนู`.
- [x] Render all assigned role names in the inherited-access copy.
- [x] Add distinct no-role, zero-supported-menu, incomplete/missing-row, and matrix-load-error states.
- [x] Add honest preview copy for DRAFT and unusable-account copy for SUSPENDED/DISABLED.
- [x] Keep branch/record scope explicitly separate from menu/action grants.

#### Visual and responsive

- [x] Remove `truncate` from menu labels in this card only.
- [x] Make the label wrap normally with no line clamp.
- [x] On mobile, place `สิทธิ์ที่มี` and granted actions below the menu title.
- [x] Render action status as plain text + non-color-only granted indicator; remove filled pill styling.
- [x] Ensure status elements have no interactive roles, tab stops, hover, or pointer cursor.
- [x] Do not add an inner horizontal scroller or table to the individual summary.
- [x] Preserve desktop density with a two-column alignment only when the full label remains readable.

#### Regression containment

- [x] Do not change `PermissionMatrixPrototypePage`; its full matrix must remain visible.
- [x] Do not change role/status/credential/branch API calls, payloads, permission gates, confirmation, or save feedback.
- [x] Do not change the route page, API client, contracts, or backend unless Phase 0 proves the existing contract cannot satisfy the spec.

### Exit criteria

- The individual summary matches every UI and honesty rule in the spec.
- No unrelated control or mutation path changes.

## 8. Phase 3 — Regression and Browser Evidence

### Goal

Prove the change works across permission states and widths, and that the editor/security boundaries are intact.

### Tasks

- [x] Extend `SET-08` or add focused settings E2E cases for granted-only rows, action subset, and count.
- [x] Add a matrix-request failure case using route interception and assert explicit error/retry state with no zero-access claim.
- [x] Add a route-intercepted multi-role employee fixture and assert unioned menu access/role copy without mutating shared seed data.
- [x] Assert `ไม่เห็นเมนูนี้` is absent from the access-overview permission card.
- [x] Assert action statuses are not buttons/links and do not create extra focus stops.
- [x] Assert `/settings/permissions` still shows denied/supported cells in its full table.
- [x] Verify at 375, 390, 412, and 1280 CSS pixels:
  - full menu label visible;
  - no permission-card horizontal scroll;
  - no page-level overflow;
  - no overlap with action status.
- [x] Re-run route visibility tests to prove navigation/direct-URL policy did not change.
- [x] Record screenshots or Playwright evidence for one view-only row, one five-action row, and the error state.

### Required commands

Use the exact package scripts available at implementation time; expected minimum:

```bash
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/web test
pnpm --filter @watchdog-bms/api test -- get-access-matrix.use-case.spec.ts
```

Host-stack verification when available:

```bash
e2e/run-local.sh e2e/settings.spec.ts
e2e/run-local.sh e2e/responsive.spec.ts
```

Do not weaken or skip an invariant to make the suite pass. If the host stack is unavailable, record the exact blocker and retain the automated unit/typecheck evidence.

### Exit criteria

- Focused and package-level checks pass.
- Browser evidence covers success, empty/error, mobile, and desktop states.
- The role editor and route/API permission boundaries are demonstrably unchanged.

## 9. Phase 4 — Documentation and Handoff

### Tasks

- [x] Update `docs/agent-memory/access-overview-granted-only-permission-summary.md` with touched files and exact verification results.
- [x] Update the implementation status in this plan and the master checklist follow-up.
- [x] Record any discovered menu-registry/workspace parity issue as a separate scoped follow-up; do not silently expand this implementation.
- [x] Record whether multi-role browser coverage was feasible and what evidence substitutes if not.

### Exit criteria

- Product, architecture, implementation, and integration evidence are all linked.
- No required work remains hidden in commentary or an untracked local note.

## 10. Bug-Gap Regression Checklist

- [x] Denied row accidentally remains through a second render branch.
- [x] Empty group heading remains.
- [x] Count uses catalog length instead of rendered length.
- [x] `matrix === null`, matrix rejection, and true zero grants are distinguishable.
- [x] Missing role row is not treated as denied.
- [x] Multi-role employee is not reduced to `roles[0]` in summary or copy.
- [x] Duplicate grants do not duplicate labels.
- [x] DRAFT/SUSPENDED/DISABLED does not read as currently usable access.
- [x] Entitlement-disabled menu stays hidden.
- [x] Long Thai/custom label has no ellipsis.
- [x] Plain action text does not look or behave like a button.
- [x] No inner or page-level horizontal scroll appears.
- [x] Branch card and branch mutation remain intact.
- [x] Role change/status toggle/credential/reset/employee menu remain intact.
- [x] `/settings/permissions` still shows the full authoring matrix.
- [x] Sidebar/settings/direct URL/API guards remain unchanged and fail closed.

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Hiding denied rows also hides a data-load failure | False access report | Explicit roles/matrix error and missing-row states before filtering |
| Multi-role union changes displayed count/actions | Owner sees a larger but correct result | Pure OR-union tests and all-role copy; no grant mutation |
| Inactive account appears usable | Governance misunderstanding | State-specific preview/unavailable copy |
| UI refactor touches unrelated mutation-heavy page | Employee access regression | Limit JSX diff to derivation/load state/permission card; run SET-02/03A/08 |
| Role editor accidentally adopts granted-only behavior | Admin cannot grant new access | Do not touch editor; explicit E2E regression |
| Long labels solve truncation by causing page overflow | Mobile regression | Stack/wrap; test 375/390/412; no fixed permission width |
| Existing seven-menu catalog is mistaken for full workspace truth | Misleading claim | Keep bounded scope and copy; separate catalog audit follow-up |
| Route guard and dependent endpoint keys diverge for a custom role | Partial page/403 | Honest scoped error now; do not broaden API authority in a UX patch |

## 12. Implementation Stop Conditions

Stop and update the spec before proceeding if any of these are found:

- The requested display requires broadening an API permission or returning raw permission keys to a weaker viewer.
- Correct multi-role effective display cannot be produced from the existing entitlement-filtered matrix.
- A required change would alter role grants, route visibility, per-member overrides, or branch ABAC.
- The seven-menu summary cannot be described honestly without a full workspace catalog migration.
- Existing dirty work overlaps the same permission-card lines and cannot be preserved safely.
