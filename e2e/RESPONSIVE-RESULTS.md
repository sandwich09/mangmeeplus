# Mobile Responsive Uplift — Final Results (R5)

Date: 2026-08-04. Harness engineer: Claude (authored plan/handoff, gated every phase, ran all Playwright gates, committed per phase). Executor: Codex CLI `gpt-5.6-sol` xhigh (all product code except gate fixes). Plan: `docs/plans/mobile-responsive-uplift-plan.md`. Handoff: `docs/plans/mobile-responsive-uplift-codex-handoff.md`. Per-phase evidence: `outputs/responsive-baseline/R0..R4-REPORT.md` (each ends with a Claude gate verdict).

## Phase outcomes

| Phase | Commit | Result | Gate fixes (defects caught in review, fixed before commit) |
|---|---|---|---|
| R0 rig | `f6901b0c` | PASS | — (baseline red matched audit + 1 net-new find: /settings/crm-catalog) |
| R1 shell | `ab1cb8af` | PASS | 2: SSR sidebar flash (serverDefault); `min-width:max-content` clipped desktop tables → scoped to `.mangmee-table-scroll` |
| R2 controls | `6a6ec567` | PASS | 1: per-id login font rule ineffective → systemic 16px floor `<640px` (`!important`, media-scoped) |
| R3 sweep | `feba17ab` | PASS | 0 — first fully green mobile run (50/50) |
| R4 cards | `a6de43c5` | PASS | 0 — reimbursements desktop screenshot byte-identical; 5th smoke red proven ECONNRESET flake by re-run |

## Final matrix (clean servers, merged HEAD `11c6076a`, migrations applied + reseeded)

| Suite | Result |
|---|---|
| Mobile invariants @ Pixel 7 412px (INV-1..7, 45 routes + drawer + zoom + popover + 3 card views) | **GREEN** (in full run, mobile-chromium project all passed) |
| Mobile invariants @ **375×667 floor** (`RESPONSIVE_VIEWPORT=375x667`) | **53/53 GREEN** |
| Full desktop suite (all specs, chromium) | 167 passed / 12 failed / 65 skipped — all 12 classified below, **none caused by the responsive uplift** |
| Desktop parity screenshots vs R0 baseline | journal + settings byte-identical; reimbursements/expenses = seed-data rows only (layout identical, verified visually); accounting = accepted squeeze→scroll improvement (R3); dashboard = R1 flash-fix + merge content |

## Invariants now enforced by the rig (regression guard, runs on `mobile-chromium`)

INV-1 no page-level horizontal overflow · INV-2 no clipped table (every `<table>`/pseudo-table scrollable or fits) · INV-3 drawer opens/backdrop/Escape/body-scroll-lock · INV-4 no client error per route · INV-5 ≥16px form fields (no iOS focus zoom) · INV-6 popovers inside viewport · INV-7 card views (mobile: cards+nav work; desktop: cards absent, tables intact). `RESPONSIVE_BASELINE=1` captures the 6-page desktop parity set; `RESPONSIVE_VIEWPORT=WxH` re-runs the mobile suite at any width (desktop-parity tests auto-skip under an override).

## Desktop full-suite failures — classification (12)

Pre-existing since R0 baseline (in every run, before any responsive change):
1. `SMOKE-02` — 'Trial Balance' strict-mode (28 matches): stale spec vs reports catalog. **product/spec drift**
2. `SET-01` — settings heading strict-mode (2 matches): stale spec. **product/spec drift**
3. roles-matrix `ตั้งค่าบริษัท` — MANAGER sees the menu. **NOT a bug (owner-confirmed 2026-08-04):** menu visibility is permission-driven (`requiredAnyPermissions` union in `web-core-workspace.constants.ts:309`) and the registry deliberately grants MANAGER `tax.profile.read`/`tax.config.read` ("Item 11 – Manager sees tax summary", `permission-registry.ts:598`). The **spec is stale** (asserts the old Owner/Admin-only matrix) — and the FE comment above the menu entry is stale the same way. Fix = update `_roles-reference.spec.ts:63` (+ that comment), not the product.
4. `RPT-04` CSV export — Redis down. **env**

Same Redis export path (first exposed by the full run — smoke never covered them):
5. `RPT-05`, 6. `RPT-06`. **env**

Merge-drift (arrived with merge `11c6076a` of develop, mid-uplift; verified on clean rebuilt servers):
7. `REIMB-03` — API returns `403 not_eligible_approver` on approve: backend approver-policy change (CC2 migrations). Server-side — UI cards cannot cause a 403. **merge product/spec drift**
8. `SET-03A` — employee wizard waits for a `https://liff.line.me/…` link that never renders (LIFF invite config/flow). **merge/env**
9. `BOOK-04` — reschedule dialog: expected month text not found (booking flow changed). **merge product/spec drift**
10-12. `NAV-01/02/03` — sidebar active-state counts wrong (2 sub-items active / 0 top active). Isolation run: same specs against the develop merge parent's product tree (without the 4 responsive commits) → see verdict line below. Our AppSidebar diff (R1) touched classNames/touch-targets/Escape/inert only, never active-state resolution.

> NAV isolation verdict (run 2026-08-04): NAV-01/02/03 fail **identically** with the responsive commits absent (product tree checked out from merge parent `acda6327`, current specs, clean servers) — 3 failed / 2 passed, same counts. **Confirmed merge-side drift; not caused by this uplift.**

## Known accepted deviations
- ThemedDate touch targets are 40px (not 44) — the 286px calendar can't fit 44px cells; documented exception.
- Settings matrices / GL / movements stay scrolling tables by design (reading surfaces).
- Empty queues on desktop now show the shared EmptyState without table headers (states hoisted outside the card/table split).
- `DataTable`/`ListPageLayout`/`PageHeader`/`ActionToolbar` remain dead code — deletion deferred (D6).
- Upload-dependent checks unaffected (MinIO down; EXP-06 auto-skips — pre-existing behavior).

## How to re-run
```bash
e2e/run-local.sh e2e/responsive.spec.ts                          # mobile invariants (Pixel 7)
RESPONSIVE_VIEWPORT=375x667 e2e/run-local.sh e2e/responsive.spec.ts   # 375 floor
RESPONSIVE_BASELINE=1 e2e/run-local.sh e2e/responsive-baseline.spec.ts # desktop parity shots
e2e/run-local.sh                                                  # everything
```
