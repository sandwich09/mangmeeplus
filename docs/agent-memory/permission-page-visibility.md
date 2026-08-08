# Agent Memory: permission-page-visibility

Status: PHASE C COMPLETE + VERIFIED (2026-08-08) — implementation is complete;
host E2E remains. Owner report: users without rights still see pages with
read-only banners; product decision = no right → no menu, no page.
Owner: Claude (harness engineer) + Codex gpt-5.6-sol (executor)
Scope: Web-only visibility policy. Plan:
`docs/plans/permission-page-visibility-plan.md`. Handoff:
`docs/plans/permission-page-visibility-codex-handoff.md`. API untouched.

Decisions:
- Three tiers: T-MANAGE (config screens — manage key or invisible), T-READ
  (data screens — read key shows page, mutation controls HIDE not disable,
  banners abolished), T-BLOCK (ForbiddenState + layout redirect).
- AUDITOR_READONLY keeps tax/ledger read pages (spec-mandated persona) —
  the owner directive is implemented as manage-only for CONFIG screens, not
  as blanket "manage or nothing" everywhere.
- Single registry `route-permissions.ts` feeds all four gate layers (route
  rules, nav children, settings cards, page guards) — the holes existed
  because keys were hand-copied in four files.
- Permission keys disappear from user-facing copy (they leaked via banners).

## Audit inventory (2026-08-08, full sweep — Phase B work list)

Model: NO server-side permission gate; the only gate is client-side
`WorkspaceLayout.tsx:74-83` → `canAccessWorkspacePath()`
(`web-core-workspace.logic.ts:39-92`; exact rules :53-77, module fallback
:81-91). Session plumbing: `server-session.ts` per-page fetch, permissions as
flat `string[]`, `?? []` fallback (fail-closed). Sidebar filtering:
`WorkspaceLayout.tsx:50-66` + `buildNavItems` (logic.ts:100-279) + hardcoded
`DESIGN_HANDOFF_NAV_RANK` allowlist (:23-42). Settings cards:
`settings-menu.logic.ts:16-109`.

Read-only banners (delete; hide controls where page stays T-READ):
- PermissionMatrixPrototypePage.tsx:255-259 (access.role.manage — the
  reported banner; buttons :268,:304,:315,:345,:350)
- IndividualPermissionsPrototypePage.tsx:414-419 (employee.update/disable;
  controls :525,:540,:576,:693,:705,:722)
- TaxAccountSettingsPage.tsx:121-123 (banner says tax.config.read, code
  checks manage — text/logic mismatch)
- TaxReconciliationPage.tsx:93-96 (tax.report.recompute)
- TradeTaxEvidencePage.tsx:134-136,143 (canPrepareEvidence; attachment.read)
- AccountingTaxSetupPage.tsx:134-141,536,581 (ledger.account.manage etc.)
- TaxWorkspacePage.tsx:440 (tax.config.manage panel)
- AccountsPayablePages.tsx:306-308 (procurement.approval_policy.manage);
  :185,:918 inline attachment.create / wht.external_certificate.link notes
- ExpensesPages.tsx:1640-1641 (expense.create manual panel)
- AccountingPages.tsx:360-361 (dead branch — form only renders when
  canCreateDocuments, :781)
- CustomersPrototypePage.tsx:430 (literal "อ่านอย่างเดียว" action cell)
- KEEP: InboxPrototypePage.tsx:946 composer notice (dictionary string
  workspace-dictionary.ts:424) — correct UX, not a banner.

No-gate pages (add gates in Phase B):
- TradeTaxEvidencePage — no read key checked at all
- TaxWorkspacePage — no top-level gate (fetches individually guarded)
- NotificationPages.tsx:32-50 NotificationCenterPage — no notification.read
- InventoryPages.tsx:79,245 — `canManage = true` DEFAULT; /inventory/*
  page.tsx files pass nothing (only /settings/crm-catalog/* pass real flags)
- Route/page mismatch: /settings/access-overview rule access.effective.read
  vs page needing access.employee.read (listEmployees 403 inside
  Promise.allSettled :241-252 → double banner)

Unrouted/unruled: /settings/po-approval + /settings/discount-policy have no
route rule AND no page gate; roles submenu children poapproval/discount/
lineoa pushed without permission check (logic.ts:163-173); roles parent
buildHref hardcodes /settings/permissions (:135).

Full-block already correct (do not touch): ChartOfAccountsSettingsPage:101,
TaxCodeSettingsPage:183-184, TaxAccountSettingsPage:102,
TaxReconciliationPage:85, CustomersPrototypePage:613, CrmPages:62-71,
BankingPages:442-448, WorkflowPages:63-72, ProcurementPages:290-291,
AccountsPayablePages:931-932, Reimbursements*:327/:97-104,
NotificationPages:226,:316, ExpensesPages:1701/:1709 tab blocks,
inventory/page.tsx:29.

Dead/unused (delete in Phase B): ForbiddenState `readonly` prop +
state.readonly.* dictionary strings (workspace-dictionary.ts:87-88,
1208-1209), permission-state.model.ts. Dead component (out of scope, note
only): EmployeeAccessPages.tsx not imported by any route.

Open questions: none blocking. Owner may later veto T-READ for tax settings
(would move them to T-MANAGE — one-line table edits once the registry lands).

Verification:
- Baseline before execution — typecheck ✓, unit 759/759, build ✓ (2026-08-08,
  includes toast v2 + loading + themed-date work, uncommitted).
- Phase B — `corepack pnpm --filter @watchdog-bms/web typecheck` ✓;
  `CI=true node --import tsx --test "src/**/*.spec.ts"` ✓ (765/765);
  `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build` ✓;
  `grep -rn "อ่านอย่างเดียว" apps/web/src/features` returned zero rows;
  `git diff --check` ✓.
- Phase C — existing Phase A specs already cover every registry rule at the
  route gate plus every real sidebar/settings-card surface; no duplicate
  matrix spec added. Added the four-layer `access.role.read` regression and
  fail-closed inventory render specs (targeted 3/3) ✓;
  `corepack pnpm --filter @watchdog-bms/web typecheck` ✓;
  `CI=true node --import tsx --test "src/**/*.spec.ts"` ✓ (768/768);
  `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build` ✓;
  `git diff --check` ✓.
- Phase C copy sweep — no manage permission key is rendered as user-facing
  copy. Matches are registry values, capability checks, comments, and tests;
  no `ForbiddenState` description contains a raw permission key.
- Host E2E not run: the handoff environment contract forbids DB-dependent E2E.
- Report-only stale expectations: `e2e/settings.spec.ts` SET-09 and
  `e2e/cross-cutting.spec.ts` XC-03; `e2e/harness/roles.ts` still grants
  COMPANY_VIEW the roles route and feeds later access-matrix coverage.

Next:
- [x] Codex Phase A (route-permissions registry + 4-layer unification) → gate
- [x] Codex Phase B (page guards, banner removal, inventory default fix) → gate
- [x] Codex Phase C (parity specs + hardening) → gate
- [ ] Host E2E → commit (alongside toast v2 / loading / themed-date work)
