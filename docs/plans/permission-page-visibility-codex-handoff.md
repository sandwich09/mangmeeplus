# Permission Page Visibility — Codex Execution Handoff

Read `docs/plans/permission-page-visibility-plan.md` first — it is the design
authority (§3 route policy table, §4 design). Execute ONLY the phase named in
your kickoff prompt, in order A → B → C.

## Environment contract (read every phase)

- Repo root: current working directory. App: `apps/web` (Next 16, React 19,
  Tailwind v4, TypeScript strict).
- Your shell has NO bare `pnpm`. Use `corepack pnpm …`.
- Your sandbox CANNOT reach postgres — never run e2e or anything needing the DB.
- If typecheck reports `Cannot find module '@watchdog-bms/contracts'`, run
  `corepack pnpm --filter @watchdog-bms/contracts build` once and retry.
- Unit tests from `apps/web`:
  `CI=true npx tsx --test "src/**/*.spec.ts"`; on IPC `listen EPERM` use
  `CI=true node --import tsx --test "src/**/*.spec.ts"`.
  Baseline: **759 pass / 0 fail**. Keep 0 fail; only ADD tests.
- Typecheck: `corepack pnpm --filter @watchdog-bms/web typecheck`.
- Build: `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build`.
- Do NOT edit `package.json`, `pnpm-lock.yaml`, or `packages/contracts/*`.
- Do NOT touch `e2e/` except to REPORT (not fix) affected specs.
- Spec files `.spec.ts` with `node:test` + `node:assert/strict`; follow the
  idioms already in `web-core-workspace.spec.ts` and
  `settings-menu.logic` tests if present.
- UI copy: formal-professional Thai; `/system/*` pages keep English.
- Ponytail: shortest correct diff, reuse existing patterns, no new
  dependencies, no speculative abstractions.
- When the plan says "mirror the API guard": find the API route handler that
  serves that page's data/mutation (grep `apps/api` for the endpoint path
  used by the page's `*.api.ts`) and copy the exact permission keys it
  enforces. Never invent keys — every key you write must exist in the API's
  permission registry. Report each discovered key in your final report.

## Phase A — Single source of truth for route visibility

Files: `apps/web/src/features/web-core-workspace/route-permissions.ts` (new),
`web-core-workspace.logic.ts`, `WorkspaceLayout.tsx`,
`settings-menu.logic.ts`, plus their spec files.

1. Create `route-permissions.ts` exactly per plan §4.1, encoding the FULL §3
   table (discover the po-approval / discount-policy / line-oa / tax-evidence
   keys from the API as described above).
2. Replace the hand-written `exactSettingsRules` block in
   `web-core-workspace.logic.ts:53-77` with lookups into
   `ROUTE_PERMISSION_RULES`. Module-fallback matching (`:81-91`) stays.
3. `buildNavItems` (`web-core-workspace.logic.ts:100-279`):
   - gate `poapproval`, `discount`, `lineoa` children (`:163-173`) with their
     table rules;
   - `roles` parent: visible iff ANY child rule passes; its `buildHref`
     targets the FIRST child the viewer can see instead of hardcoding
     `/settings/permissions`.
4. `filterSettingsMenuItems` (`settings-menu.logic.ts:16-109`): replace each
   card's inline key list with the table lookup; delete the "keep in sync"
   comment at `web-core-workspace.logic.ts:66-68` — it is obsolete once both
   read one table.
5. Specs: extend the existing logic specs to assert (a) every §3 route in the
   table resolves the same way through `canAccessWorkspacePath`, nav
   children, and settings cards (parity test iterating the table), (b) the
   reported case: `access.role.read` WITHOUT `access.role.manage` can no
   longer see `/settings/permissions`, (c) `roles` parent href falls back
   correctly per permission set.

Gate: typecheck → unit 0 fail (≥759 + new) → build. Report the discovered
API keys for po-approval / discount-policy / line-oa / tax-evidence.

## Phase B — Page-level enforcement and banner removal

Work through plan §3 + §4.3. The audit's file:line inventory is embedded in
`docs/agent-memory/permission-page-visibility.md` — read it.

1. `requireRoutePermission` helper per plan §4.2 (place it in
   `web-core-workspace` next to the registry; server-usable — no 'use
   client'). Apply to: settings/permissions, settings/access-overview,
   settings/po-approval, settings/discount-policy, settings/substitute-receipt,
   settings/line-oa pages' `page.tsx`.
2. Banner deletions + hide-not-disable (T-READ pages):
   - `PermissionMatrixPrototypePage.tsx:255-259` banner + its read-only
     matrix branch (page is now manage-only — the read-only branch is dead).
   - `IndividualPermissionsPrototypePage.tsx:414-419` banner; edit controls
     render only with their keys (today they disable).
   - `TaxAccountSettingsPage.tsx:121-123` (the wrong-key banner),
     `TaxReconciliationPage.tsx:93-96` (recompute button hides),
     `TradeTaxEvidencePage.tsx:134-136,143` (prepare form renders only with
     `canPrepareEvidence`; attachment note only with `attachment.read`),
     `AccountingTaxSetupPage.tsx:134-141,536,581` (apply buttons hide),
     `TaxWorkspacePage.tsx:440` (panel toggle hides),
     `AccountsPayablePages.tsx:306-308` (policy inputs render read-only
     values, save hides), `ExpensesPages.tsx:1640-1641` (manual panel renders
     only with `expense.create` — follow the expenses precedent),
     `AccountingPages.tsx:360-361` (dead branch — delete),
     `CustomersPrototypePage.tsx:430` (literal "อ่านอย่างเดียว" cell → empty).
   - InboxPrototypePage composer notice (`:946`) STAYS — replacing a composer
     with an explanation is correct UX, not a banner (plan §3 last row).
3. New gates: `TaxWorkspacePage` top-level `tax.period.read` block;
   `TradeTaxEvidencePage` read-key block; `NotificationCenterPage`
   `notification.read` block — all render `ForbiddenState`.
4. Inventory: flip `canManage = true` defaults to `false`
   (`InventoryPages.tsx:79,245` and any sibling client with the same
   default); every `/inventory/*` `page.tsx` fetches the session and passes
   real flags (copy the `/settings/crm-catalog` wrappers' pattern).
5. `/settings/access-overview` route key becomes `access.employee.read`
   (already in the Phase A table — verify the page no longer double-errors).
6. Delete now-unused: `ForbiddenState`'s `readonly` prop + its
   `state.readonly.*` dictionary strings, `permission-state.model.ts`.

Gate: typecheck → unit 0 fail → build →
`grep -rn "อ่านอย่างเดียว" apps/web/src/features` returns ZERO rows (the
inbox composer string lives in the dictionary, not features — verify).
Report every e2e spec file whose selectors reference removed banners/routes
(grep `e2e/` — report only, do not edit).

## Phase C — Consistency specs and hardening

1. Registry parity spec (if not fully covered in Phase A): iterate
   `ROUTE_PERMISSION_RULES` and assert sidebar/card/route agreement per rule.
2. Spec the reported regression end-to-end at logic level: a permission set
   `['access.role.read']` sees neither the `roles.permissions` nav child, nor
   a settings card, nor passes `canAccessWorkspacePath('/settings/permissions')`,
   nor `requireRoutePermission`.
3. Spec inventory defaults: `ProductsPageClient`/`ProductDetailPageClient`
   render no manage controls when `canManage` is omitted.
4. Sweep check: no feature file references `access.role.manage` (or any
   manage key) inside a string shown to users EXCEPT `ForbiddenState`
   descriptions — permission keys are not user-facing copy under the new
   policy. Report leftovers.
5. Update `docs/agent-memory/permission-page-visibility.md` status +
   verification evidence.

Gate: typecheck → unit 0 fail → build.

## Reporting format (every phase)

Files touched (count + list), gate outputs (last lines), API keys discovered
(Phase A), e2e specs affected (Phase B, report-only), deviations with
one-line justification, and findings that belong to a later phase.
