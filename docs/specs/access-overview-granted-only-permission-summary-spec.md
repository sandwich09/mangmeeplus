# Feature: Access Overview Granted-Only Permission Summary

## 1. Status

- Roadmap/checklist item: 10C+ focused UX/correctness follow-up
- Owner: MangmeePlus product owner
- Decision date: 2026-08-19
- Implementation status: Implemented and verified on `codex/access-overview-granted-summary-pr`
- Supersedes: `docs/agent-memory/access-overview-ui-redesign.md` decision D1 only, which kept denied menus visible as muted rows

## 2. Goal

On `/companies/[companyId]/settings/access-overview`, let an authorized owner, admin, or manager answer these questions without guessing:

1. Which supported menus does this employee receive from their assigned role or roles?
2. What can the employee do in each visible menu?
3. Is the displayed state current role access, a future preview for a draft account, or unavailable because data failed to load?

The screen must show only granted menu rows, keep every menu name readable on small screens, and render action words as read-only status rather than controls.

## 3. Source Docs and Current Evidence

- Employee access: `docs/specs/employee-access-role-management-spec.md`
- Effective access: `docs/specs/employee-access-role-management-v2-phase1-spec.md`
- Permission policy: `docs/specs/auth-authorization-rbac-spec.md`, `docs/specs/permission-matrix.md`
- Route visibility precedent: `docs/plans/permission-page-visibility-plan.md`
- Existing design history: `docs/agent-memory/access-overview-ui-redesign.md`
- Existing responsive evidence: `outputs/mobile-evidence/EVIDENCE.md`
- Live route: `apps/web/app/(workspace)/companies/[companyId]/settings/access-overview/page.tsx`
- Live component: `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`
- Projection contract: `packages/contracts/src/access-matrix.ts`
- Projection API: `GET /v1/companies/:companyId/settings/access/matrix`

## 4. Problem and Impact Audit

### 4.1 Confirmed UX problems

- A denied menu is rendered as a muted row with `ไม่เห็นเมนูนี้`, creating noise instead of answering what the employee can use.
- Granted actions are rendered in filled rounded pills. Although they are plain `<span>` elements, they look tappable.
- The menu label uses `truncate`; on a narrow screen `ค่าใช้จ่าย+ใบเสร็จ` can become `ค่าใ...` with no detail interaction available.
- The count is shown as `N/7 เมนู` while denied rows remain visible, mixing granted count with catalog size.
- Actions and names compete for one horizontal row, so long names lose before action status does.

### 4.2 Confirmed correctness gaps that this change must not hide

1. **Matrix failure can look like zero access.** `reload()` uses `Promise.allSettled()`, but a rejected matrix or role request does not receive a scoped error state. `matrix ?? []` and a missing row can therefore collapse to zero/denied UI.
2. **Multiple roles are supported but the page reads only the first role.** Contracts and API inputs use `roleIds: string[]`; effective access unions role grants. The current page uses `selectedEmployee.roles[0]`, so a multi-role employee can be under-reported.
3. **Account state and role grants are different facts.** A draft, suspended, or disabled employee can retain assigned role grants but cannot currently use them. The UI must not present the grant preview as live access.
4. **Feature entitlement filtering is already part of the matrix contract.** Disabled-feature permissions are stripped in `GetAccessMatrixUseCase`; the UI must not reconstruct unfiltered permissions from raw role keys.
5. **The page intentionally summarizes seven MVP1 menu ids.** Expanding it to all registry/workspace modules is a separate product/catalog task. This change must not silently change the denominator or claim full-system coverage.
6. **Branch/record ABAC is not a menu action.** The separate branch card explains where data is visible. `ดู` in this card must not imply access to every branch or every record.

## 5. Scope

### In Scope

- The read-only permission summary card on `/settings/access-overview`.
- Granted-only menu filtering and empty-group pruning.
- Readable menu labels and non-interactive granted-action status.
- Correct union of the selected employee's assigned role rows for display.
- Honest loading, error, no-role, zero-menu, and inactive-account states.
- Focused unit, E2E, accessibility, and responsive regression coverage.
- Existing seven-menu summary set only:
  - `dashboard`
  - `inbox`
  - `customers`
  - `booking`
  - `crmreport`
  - `expenses`
  - `salesdoc`

### Out of Scope

- Filtering denied items out of `/settings/permissions`; that route is an authoring/audit matrix and must keep showing the complete catalog.
- Adding, removing, or changing role/permission grants.
- Changing API authorization, deny-by-default guards, route visibility, navigation, or settings-hub policy.
- Adding an employee-level permission override model.
- Expanding the summary from seven menus to all workspace modules.
- Changing the existing role assignment control from single-select replacement to multi-role authoring. This screen must display existing multi-role data correctly, but role-authoring policy remains a separate task.
- Changing branch scope, record ownership, ABAC, feature entitlement, audit, LINE, or AI behavior.
- New API endpoints, Prisma schema, dependency, or package script changes.

## 6. Users and Main Journey

### Authorized viewer

- OWNER, ADMIN, MANAGER, auditor, or custom role that passes the existing page/API gates.
- The viewer is inspecting another employee's assigned access; this is not an employee self-service surface.

### Journey

1. Viewer opens `รายชื่อพนักงาน` and selects an employee.
2. The screen loads employees, roles, the entitlement-filtered role × menu × action matrix, and branches.
3. The permission card merges every role assigned to the selected employee.
4. The card removes menus whose merged `view` value is not `true`.
5. The card removes groups left with no visible menus.
6. Each remaining row shows the full menu name and only the granted actions in stable order.
7. Changing the selected employee or role reloads and recomputes the same projection.
8. A data failure renders an explicit scoped error and retry path; it never renders a truthful-looking zero-access result.

## 7. Product and Display Rules

### R1 — Granted-only rows

- A menu row renders only when the merged cell has `view === true`.
- A denied menu renders nothing: no row, icon, placeholder, dash, or `ไม่เห็นเมนูนี้` status.
- A group heading renders only when at least one granted menu remains in that group.

### R2 — Effective display across multiple roles

- For each supported menu and action, merge assigned role rows with boolean OR.
- Duplicate roles or duplicate grants do not duplicate actions or menu rows.
- Action order remains `view`, `create`, `edit`, `del`, `approve`.
- Thai display order remains `ดู`, `เพิ่ม`, `แก้ไข`, `ลบ`, `อนุมัติ`.
- The role copy lists all assigned role names when more than one role exists; it must not name only `roles[0]`.
- If an assigned role has no matrix row, treat the permission summary as incomplete/error, not as a denied role.

### R3 — Status, not control

- Granted actions are plain text with a small semantic granted indicator such as a checkmark.
- No action word may use `<button>`, `<a>`, `role="button"`, hover styling, pointer cursor, filled pill background, or border that suggests interaction.
- Each row includes a visible label equivalent to `สิทธิ์ที่มี` so an absent action is understood as not granted.
- The row itself is not clickable and does not open a detail view.

### R4 — Responsive information hierarchy

- The menu icon and full menu label appear before action status.
- Menu labels use normal wrapping and must never use `truncate`, `line-clamp`, or ellipsis in this card.
- On narrow screens, action status moves below the menu name and wraps naturally.
- The permission card must not require horizontal scrolling.
- On wider screens, the same content may align in two columns, but the name column must keep enough width to display the full label.
- This individual summary does not become a matrix table. The table pattern remains on `/settings/permissions`, where cross-menu authoring/comparison is the task.

### R5 — Count and copy

- Replace `N/7 เมนู` with granted-only copy such as `ใช้งานได้ N เมนู`.
- The count equals the number of rendered menu rows after role union and entitlement filtering.
- The UI does not expose the seven-menu catalog denominator.
- For one role, retain singular position copy.
- For multiple roles, use plural/combined copy and list the role names without truncating the meaning.

### R6 — Account-state honesty

- ACTIVE: show the granted-only summary as current assigned menu access.
- DRAFT: show the granted-only preview but label it as access the employee will receive after activation.
- SUSPENDED or DISABLED: show the assigned-role preview with a clear message that the account cannot currently use it.
- Account status must not mutate or reinterpret role grants in the browser.

### R7 — Branch and record scope honesty

- The permission card describes menu/action grants only.
- Keep the separate branch-access card unchanged.
- Add or retain concise copy that data visibility can still be narrowed by assigned branches and record-level policy.

### R8 — Source and failure honesty

- Employees are required to render the directory and selected identity.
- Roles plus access matrix are required to render the permission summary.
- Branches are required only for the branch card.
- A failure in one dependency is scoped to its affected panel where possible.
- A failed roles/matrix request, missing assigned-role row, or stale role/matrix mismatch must never produce `0 เมนู`, an empty permission card, or a denied interpretation.
- Retry uses the existing reload path; no fake/local permission data is allowed.

### R9 — Empty states

- Employee has no assigned role: state that no role is assigned; do not render a zero-access list.
- Assigned role or role union grants zero supported menus: render one empty state such as `ยังไม่มีเมนูที่ใช้งานได้จากตำแหน่งที่กำหนด`.
- All groups empty: no orphan group heading.
- No employees: preserve the existing employee-directory empty state.

### R10 — Security boundary

- UI hiding is presentation only.
- Backend permission guards, tenant scope, role-grant ceiling, last-owner protection, entitlement filtering, and direct-URL blocking remain authoritative and unchanged.
- The role editor continues to show denied cells because absence there is editable/auditable state, not irrelevant summary data.

## 8. Architecture and Ownership

### Web owns

- Union/filter/group/count derivation as pure functions in `access-overview.model.ts`.
- Responsive, non-interactive rendering in `IndividualPermissionsPrototypePage.tsx`.
- Scoped load/error/empty/account-status presentation.

### Contracts/API own

- `MENU_REGISTRY`, action mapping, entitlement-filtered `PermissionMatrix`, and role rows remain the source projection.
- No wire-format change is required for this slice.

### Authorization owns

- Existing server session, route guard, controller permissions, tenant isolation, and feature entitlement behavior.
- This feature must consume their result and must not create a second permission resolver.

### Out of boundary

- AI Gateway, LINE, workers, notifications, Prisma, and cloud environment.

## 9. Surface Impact Matrix

| Surface | Expected impact | Required regression evidence |
|---|---|---|
| `/settings/access-overview` permission card | Direct visual and derivation change | Granted-only rows, full labels, plain statuses, honest states |
| Employee directory/search/filter | No behavior change | Selection and filters still work |
| Role picker and employee mutations | No behavior change | Existing gates, payloads, save feedback, and reload remain |
| Branch access card | Copy-only at most; no behavior change | All/selected branch paths still work |
| `/settings/permissions` role editor | No filtering change | Denied/supported cells remain visible and editable as before |
| Sidebar/settings menu/direct URL | No policy change | Existing `route-permissions` tests remain green |
| `GET .../settings/access/matrix` | No response or guard change | Existing API projection/entitlement tests remain green |
| Feature entitlements | No change | Disabled feature remains absent from the summary |
| LINE/AI | No change | Not in implementation diff |

## 10. Accessibility Requirements

- Action status is exposed as readable text, not interactive semantics.
- The permission-card heading and employee identity remain programmatically associated by visible text.
- Error and post-reload status changes use an appropriate live region without announcing every static action label.
- Color is not the only grant indicator; use text plus checkmark or equivalent.
- Thai and English long labels remain readable at 320, 375, 390, and 412 CSS pixels.
- No focus stop is added for a permission status or menu row.

## 11. Edge Cases

- One role grants only `view`.
- One role grants all five actions.
- Two roles grant complementary actions on the same menu.
- Two roles grant different menus.
- Duplicate action grants across roles.
- Employee has no roles.
- Assigned role is absent from the returned matrix.
- Matrix succeeds with zero supported visible menus.
- Matrix or roles request fails while employees succeed.
- Branch request fails while permission data succeeds.
- Feature entitlement removes a permission granted by a role.
- DRAFT, SUSPENDED, and DISABLED employee with assigned grants.
- Long Thai menu name and long custom role name.
- Role change succeeds but permission reload fails.
- Viewer has page permission but a dependent endpoint returns 403; show a permission-data error, never zero grants.

## 12. Acceptance Criteria

- [x] Denied menu rows and `ไม่เห็นเมนูนี้` do not render on the individual summary.
- [x] Empty menu groups do not render.
- [x] Granted count equals rendered rows and does not show `/7`.
- [x] Full menu names are visible without ellipsis at mobile widths.
- [x] Granted actions wrap below the name on narrow screens and are visibly read-only.
- [x] No horizontal scrolling is required inside the permission card or page.
- [x] A view-only employee row shows only `ดู`; a richer role shows only its granted subset in stable order.
- [x] Multi-role employees show the OR-union of every assigned role and all assigned role names.
- [x] Missing/failed role or matrix data displays an error/retry state, not an empty or zero-access state.
- [x] Draft/inactive account copy does not claim the employee can currently use assigned grants.
- [x] Feature-disabled menus remain absent because the existing entitlement-filtered matrix is preserved.
- [x] Branch scope remains separate and unchanged.
- [x] The role permission editor still displays the full menu/action matrix, including denied cells.
- [x] Existing route/API authorization remains fail-closed and unchanged.
- [x] Focused unit, web typecheck/test, E2E, and browser-width verification pass with recorded evidence.

## 13. Required Test Cases

### Pure model tests

- Merge `undefined`/empty cells safely.
- OR complementary actions across two or more role rows.
- De-duplicate actions and preserve stable order.
- Filter menus by merged `view === true`.
- Remove empty groups.
- Count rendered menus.
- Return a distinct incomplete/error result for a missing assigned-role row.
- Preserve entitlement-filtered false values.

### Web/E2E tests

- Seed/select an employee with one visible menu and assert denied menu labels are absent.
- Assert `ไม่เห็นเมนูนี้` is absent from `/settings/access-overview`.
- Assert a long menu label is not ellipsized.
- Assert status labels have no button/link roles and cannot receive focus.
- Assert multi-role fixtures display unioned grants.
- Intercept/fail the matrix request and assert explicit error/retry copy with no zero-access claim.
- Verify DRAFT/SUSPENDED/DISABLED copy.
- Verify `/settings/permissions` still renders the complete matrix.
- Verify no page overflow or clipped permission content at 375, 390, and 412 pixels; desktop smoke at 1280 pixels.

### Existing regression suites

- `access-overview.model.spec.ts`
- `web-core-workspace.spec.ts`
- `permission-page-visibility.spec.ts`
- API `get-access-matrix.use-case.spec.ts`
- E2E `SET-02`, `SET-03A`, `SET-08`, `SET-09`
- Responsive route coverage for `/settings/access-overview` and `/settings/permissions`

## 14. Decisions and Deferred Follow-ups

### Decisions locked for this slice

- Granted-only summary; denied rows disappear.
- No horizontal permission scroller on mobile.
- Plain status text, not pills or buttons.
- Seven-menu MVP1 summary remains bounded.
- Multi-role display is a union even though the current role picker authors one replacement role.
- No API/schema/security-policy change.

### Deferred follow-ups

- Decide whether employee role authoring is permanently single-role or should expose the backend's multi-role capability.
- Audit/expand the seven-menu summary catalog against the full workspace module registry as a separate source-of-truth task.
- Add employee-level menu overrides only under the separately specified audited membership-override model.
