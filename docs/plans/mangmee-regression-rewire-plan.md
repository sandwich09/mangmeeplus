# มั่งมี Prototype Regression Rewire + Gap Closure — Implementation Plan

## Linked Docs

- Spec: none new — this is a regression-fix + gap-closure coordination plan, not a new product spec. Product decisions it depends on live in `docs/specs/mangmee-flow-a-be-integration-spec.md` (D1–D14) and `docs/specs/employee-access-role-management-v2-phase1-spec.md`.
- Supersedes (partially): `docs/plans/mangmee-flow-a-be-integration-plan.md` (status amendment below), `docs/plans/mangmee-system-ui-alignment-plan.md` Phase 4 (status amendment below).
- Agent memory: `docs/agent-memory/mangmee-regression-rewire.md`
- Thai summary: `Doc/mangmee-regression-rewire-summary-th.md`

## Purpose

Make every screen in `apps/web` read/write real data through real, permission-checked `apps/api` endpoints, with no fake mutations and no orphaned real implementations. Triggered by an owner-directed full gap audit (2026-07-09) that found two distinct problems on branch `redesign-ui-and-remove-menu-fogot-password`:

1. **Undocumented regression**: commit `73dd44f` ("feat: complete Mangmee prototype screens", 2026-07-08) replaced several already-working, fully API-wired screens with static mock pages. The real implementations still exist in the repo, just unrouted. No spec or plan ever authorized this swap.
2. **Genuine net-new gaps**: five screens (Bookings, Broadcast, Discount Policy, PO Approval tiers, CRM Reports) have prototype UI shells with no backend at all. A spec+plan for exactly this work already exists (`mangmee-flow-a-be-integration-spec.md`/`-plan.md`, 2026-07-05) but is almost entirely unimplemented.

Plus a set of smaller, already-real-feature coverage gaps (Banking, AP, Procurement, Reimbursements, Tax, Inventory, System Partners) found in the same audit, including one data-integrity bug.

## Owner decisions (2026-07-09)

1. **Rewire, don't revert**: for regressed screens, keep the new "Mangmee prototype" visual design and port real API logic into it. Do not point routes back at the old orphaned components (though their logic is reused/ported, then the old component files are deleted once absorbed).
2. **Build all five** net-new backends (Bookings, Broadcast, Discount Policy, PO Approval, CRM Reports) — not a subset.
3. **Single approval, continuous execution**: plan approved once; execution proceeds phase by phase across tracks without re-approval, pausing only for genuine product decisions (flagged explicitly where they occur).

## Status amendment to `docs/plans/mangmee-flow-a-be-integration-plan.md`

- **Phase 0 (branch consolidation)**: moot. `feat/employee-access-v2-phase1-smart-roles` and `migrete-ui-with-be` have both long since converged into the current branch; there is nothing to merge.
- **Phase 1 (session & matrix foundation, D3/D6)**: executed here as Track A Phase A3.
- **Phase 2 (permissions write paths, D3–D5/D12)**: executed here as Track A Phase A5.
- **Phase 3 (inbox write path, D7)**: mostly already shipped independently via item 15A Phase 2/3 (reply/assign/status/priority/tags/read/SLA/spam/ABAC scoping — see `docs/agent-memory/crm-line-oa-customer-os-15a.md`). The residual piece (booking auto-advance) is folded into this plan's Track B Phase B2; AI-panel draft wiring is folded into Track A Phase A7.
- **Phase 4 (customers extensions, D10)**: executed here as Track B Phase B1.
- **Phase 5 (bookings, D8)**: executed here as Track B Phase B2.
- **Phase 6 (settings policies + reports/dashboard, D13/D14)**: executed here as Track B Phase B3.
- **Phase 7 (broadcast, D9)**: executed here as Track B Phase B4.
- **Phase 8 (auth channels & hardening — LINE QR login, OTP, tenancy fuzz sweep)**: **out of scope for this effort.** Recorded as a deferred follow-up; nothing in Phase 8 is required for "every screen wired to real data."

## Status amendment to `docs/plans/mangmee-system-ui-alignment-plan.md`

- Phase 4's five open bullets ("choose next flow priority: inbox, bookings, broadcast, PO approval, discount policy, or CRM reports" and the generic add-endpoints/add-clients/add-pages/add-tests tasks) are **superseded** by this plan's Track A Phase A7 (inbox) and Track B Phases B1–B4 (bookings/broadcast/PO-approval/discount-policy/CRM-reports). Do not execute alignment-plan Phase 4 separately — it is closed by reference once Track B's exit checkpoint is reached.
- The alignment spec's explicit note that PO-approval settings "must not fake save behavior until a backend policy contract is added" is the exact violation Track B Phase B3 fixes.

## Screen inventory (regression track)

| Screen | Route | Currently renders | Orphaned real implementation |
|---|---|---|---|
| Expenses | `.../expenses/page.tsx` | `MangmeeModulePrototypePage` (`expenses`) | `features/expenses/ExpensesPages.tsx` (`ExpensesHubPage`) + `expenses.api.ts` |
| Reports | `.../reports/page.tsx` | `MangmeeModulePrototypePage` (`reports`) | `features/reports/ReportsWorkspacePage.tsx` + `reports.api.ts` (needs `authedApiFetch` fix, currently uses legacy localStorage Bearer token) |
| Dashboard | `.../dashboard/page.tsx` | `features/dashboard-notifications/DashboardPages.tsx`, 100% hardcoded + discards `permissions` param | Real unused `getDashboard`/`generateSnapshot` (`dashboard-notifications.api.ts`) |
| Journal (ledger) | `.../journal/page.tsx` | `MangmeeModulePrototypePage` (`journal`) | `features/ledger/LedgerReportsPage.tsx` + `ledger.api.ts`, fully wired, no route |
| Sales / Period-closing / Sales-documents | `.../sales`, `.../period-closing`, `.../sales-documents` | `MangmeeModulePrototypePage` (various) | None exists — revert to honest `PlannedModulePage`, out of scope for new backend |
| Settings → Notifications | `.../settings/notifications/page.tsx` | `MangmeeModulePrototypePage` (`notifications`) — duplicate | Real page at `.../notifications/preferences` → `NotificationPreferencesPage` |
| Inbox | `.../inbox/page.tsx` | `crm-inbox/InboxPrototypePage.tsx` — 100% mock | `crm-inbox/InboxPage.tsx` + `crm-inbox.api.ts` (15A) |
| Employees wizard | `.../settings/employees/page.tsx` | `AddEmployeePrototypePage.tsx` — 100% local state | `features/employee-access/EmployeeAccessPages.tsx` (`EmployeesView`) + `employee-access.api.ts` |
| Roles / Permission matrix | `.../settings/roles`, `.../settings/permissions` | `PermissionMatrixPrototypePage.tsx` — hardcoded | `EmployeeAccessPages.tsx` (`RolesView`/`RoleBuilder`) |
| Access overview | `.../settings/access-overview` | `IndividualPermissionsPrototypePage.tsx` — hardcoded roster | `EmployeeAccessPages.tsx` (`EmployeeDetailPanel`) |
| Company switcher | header shell | Not rendered | `CompanySwitcher` in `WorkspaceScope.tsx` — real, just unrendered |

## Tracks and phases

Full phase breakdown (per-screen recipe, exact endpoint/model/permission lists, verification per phase) lives in the approved plan record; this doc is the durable, versioned copy for the repo. Summary:

- **Track A** (rewire regressed screens): A1 zero-risk mechanical fixes → A2 Dashboard+Reports → A3 matrix/menu projection foundation (gates A4/A5) → A4 Roles/Permissions/Access-overview → A5 matrix write-path + Employees wizard → A6 Journal → A7 Inbox.
- **Track B** (net-new backend, executes Flow-A plan Phases 4–7): B1 Customers extensions → B2 Bookings → B3 PO-approval + discount-policy + CRM-reports + dashboard KPIs → B4 Broadcast.
- **Track C** (other gaps, run last): C1 Banking correctness fix (data-integrity bug — priority) → C2 AP forms → C3 Procurement forms → C4 Reimbursements upload → C5 Tax → C6 Inventory → C7 System-partner registry drift → C8 Customers-prototype decision (pause point) + Platform-foundation cleanup.

Execution order: Phase 0 (this doc + memory) → A1..A7 → B1..B4 → C1..C8. Only C8's `/customers` fate needs a real pause for owner confirmation; everything else proceeds phase-by-phase per the single-approval execution mode.

## Cross-cutting rules (apply to every phase)

- Every `.api.ts` uses `authedApiFetch` (`apps/web/src/common/api/authed-fetch.ts`) — no bespoke fetch wrappers.
- Every new permission key registered in `apps/api/src/modules/auth/permission-registry.ts` in the same phase as its first consuming endpoint.
- Prisma migrations additive-only, one migration per phase, standard `NNNNNNNNNNNNNN_itemXX_description` naming.
- Every mutation: DTO validation, `@RequirePermissions` deny-by-default, audit row in-transaction, at least one test.
- Every new route: cross-company tenancy fuzz test as it's built.
- No fake mutations/success anywhere.

## Verification

Per phase: API + web typecheck, focused tests for touched modules. At each track's exit (A7, B4, C8): full API suite, full web suite, production build, browser smoke of the primary journeys touched. Update `docs/agent-memory/mangmee-regression-rewire.md` after every phase.
