# Agent Memory: mobile-responsive-uplift

Status: R0 PASS 2026-08-04 (rig by Codex gpt-5.6-sol; runtime verification + gate by Claude — Codex sandbox cannot reach localhost postgres, so Claude runs all e2e). Baseline: INV-2 red on /accounting, /sales-documents, /inventory/products, /settings/crm-catalog (net-new find); INV-3 red on scroll-lock+Escape; desktop smoke has 4 PRE-EXISTING failures (SMOKE-02, SET-01, roles-matrix ตั้งค่าบริษัท [possible real permission bug — file separately], RPT-04 Redis-down) = not-to-grow set. Evidence: outputs/responsive-baseline/R0-REPORT.md.
R1 PASS 2026-08-04, commit ab1cb8af. Claude gate caught + fixed 2 Codex defects: (1) useIsDesktop SSR snapshot false → desktop sidebar flash — fixed with serverDefault param (desktop-first); (2) .mangmee-table min-width:max-content clipped PAYMENT/POSTING on desktop /accounting and pushed reimbursements actions off-screen — scoped to .mangmee-table-scroll only; legacy overflow-x-auto wrappers migrate site-by-site in R3 WITH desktop screenshot check each. Desktop parity after fixes: reimbursements/accounting byte-identical to baseline. INV-3 green. Evidence: R1-REPORT.md gate section. Next actor: Codex R2 (shared controls).
Owner: Claude (harness engineer) authors/gates; Codex CLI executes; Claude commits per phase.
Scope: `apps/web` only (CSS/TSX). No API, no schema, no new dependency. Desktop pixel parity is a hard rule (D2) — only `[desktop-visible]`-tagged shell bug fixes may alter desktop.

Decisions:
- D1 stock Tailwind v4 breakpoints; single JS boundary 1024 via new `useMediaQuery` hook; table↔card switching is CSS-only (`md:`); min supported width 375.
- D3 tables: Tier 1 = wrap everything in new `.mangmee-table-scroll` (keep `overflow-x: clip` on `.mangmee-content`); Tier 2 = `md:hidden` card lists ONLY for 5 core queues (reimbursements ×3, expenses list, accounting hub) with desktop table DOM byte-identical.
- D6: dead shared components (`DataTable`, `ListPageLayout`, `PageHeader`, `ActionToolbar` — 0 consumers) stay dead; do not migrate onto them.
- Verification rig (R0) is built BEFORE fixes: `mobile-chromium` Playwright project (Pixel 7) + `e2e/responsive.spec.ts` INV-1..7 + desktop screenshot baseline in `outputs/responsive-baseline/`.

Open questions: none blocking. ThemedDate uses a deliberate 40px (not 44) touch-target exception; settings matrices/GL stay scrolling tables by design.

Artifacts:
- Plan: `docs/plans/mobile-responsive-uplift-plan.md` (audit ground truth + D1–D6 + phase map)
- Handoff: `docs/plans/mobile-responsive-uplift-codex-handoff.md` (phases R0–R5, per-phase Codex verify + Claude gates)
- Thai summary: `docs/mobile-responsive-uplift-summary-th.md`
- Results (to be written in R5): `e2e/RESPONSIVE-RESULTS.md`

Verification: audit evidence = three parallel code audits 2026-08-04 on `feat/expense-extraction-doc-type-default`; all file:line refs in the plan verified at authoring time. No code run yet.

Next:
1. Codex executes R0 (rig) → Claude gates failing-baseline matches the 9 audited clipped-table sites.
2. R1 shell → R2 shared controls → R3 sweep → R4 card views → R5 matrix + RESULTS, commit per phase after PASS.

R5 CLOSE-OUT 2026-08-04: full matrix green on mobile (412 + 375 floor 53/53); desktop full suite 167/12/65 — all 12 classified NOT-ours in e2e/RESPONSIVE-RESULTS.md (4 pre-existing, 3 Redis-env, 5 merge-drift from 11c6076a; NAV proven by isolation run against merge parent acda6327). Rig additions: RESPONSIVE_VIEWPORT override + desktop-parity auto-skip. Follow-ups for the team: stale specs SMOKE-02, SET-01, and roles-matrix ตั้งค่าบริษัท (owner confirmed 2026-08-04: menu is permission-driven, MANAGER holds tax.profile.read by design — update the spec, not the product); merge-side REIMB-03/SET-03A/BOOK-04/NAV failures. PROJECT DONE.

FOLLOW-UP 2026-08-05 (UAT iPhone screenshots 2026-08-04 22:14): three mobile defects missed by R0–R5, fixed via `docs/plans/mobile-responsive-followup-20260805-codex-handoff.md` (Codex executed, Claude gated; same D2 desktop-parity rules). F1 NotificationBell popover spilled past the LEFT viewport edge (right-anchored to a bell ~60px from the right edge; width clamp alone can't fix anchor overflow) → mobile fixed sheet under header + `max-h-[min(380px,60dvh)]`. F2 dashboard period chips left รีเฟรช stranded on its own wrap row → mobile no-wrap `overflow-x-auto` strip. F3 expense review footer groups wrapped chaotically → mobile `flex-col-reverse` stack, destructive last; F4 duplicate rows stacked. F5 INV-6 now also opens the dashboard bell popover (that was the coverage gap that let F1 ship). Verified: web typecheck PASS, INV-6 mobile PASS, full responsive.spec.ts run PASS (2026-08-05). Not yet committed — worktree carries unrelated in-flight expense/reimbursement work.

FOLLOW-UP #2 2026-08-05 (full-app sweep): owner asked to check every remaining page for the same patterns. Three parallel audits at 390px found ~30 instances → `docs/plans/mobile-responsive-followup2-20260805-codex-handoff.md` (recipes A scroll-strip / B stack / B2 2-col grid / C gap patch / E fixed-sheet menu). HIGH fixed: Banking+AP+Procurement tab bars clipped unreachable ([A]); ExpensesPages export group clipped; IndividualPermissionsPrototypePage ⋮ menu spilled past left edge ([E] `fixed inset-x-4 top-auto`). MEDIUM: chip/filter strips ×7, action rows ×8 (incl. PartnerDetailPage sticky footer), gapless justify-between ×9, shared Modal.tsx footer got flex-wrap. Cleared as safe: InboxPage :657/:683 dropdowns (measured), Bookings/Broadcast/Customers/ledger/inventory/reimb-create, MangmeePage primitives. Codex executed (26 files); Claude verified per-file that pre-existing dirty diffs were byte-identical (NB: first awk-based check was silently broken — use python difflib split). Gates: typecheck PASS, responsive suite 57/57 PASS incl. new INV-8 tab-reachability. Not committed.
