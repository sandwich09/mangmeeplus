# Mobile Responsive Uplift — R3 Mechanical Sweep Report

Status: **IMPLEMENTED — typecheck, webpack build, and static sweep checks pass.** Postgres-dependent E2E was not run, per the executor instruction for this sandbox.

## Scope held

- Executed Phase R3 items 1–5 only.
- Product changes are wrapper and class/style substitutions only. No logic, copy, table columns, API, schema, dependency, or global CSS changes were made.
- Kept `.mangmee-content { overflow-x: clip }` unchanged.
- Kept intrinsic table width scoped to `.mangmee-table-scroll .mangmee-table`; no global `.mangmee-table` minimum width was added.
- Kept the existing global sub-640px 16px form-control floor unchanged; no per-field font-size fixes were added.
- No `git add` or commit was run.

## Every touched file

| File | R3 change |
|---|---|
| `apps/web/src/features/accounting-documents/AccountingPages.tsx` | Added inner `mangmee-table-scroll` wrappers to the document list and document line-items tables; changed payment rows from four base columns to two, restoring four at `sm`. |
| `apps/web/src/features/accounts-payable/AccountsPayablePages.tsx` | Changed the five AP-aging bucket columns to two at base, restoring five at `sm`. |
| `apps/web/src/features/crm-inbox/InboxPage.tsx` | Changed the inbox pane height from `100vh` to `100dvh`. |
| `apps/web/src/features/crm-inbox/InboxPrototypePage.tsx` | Changed pane height to `100dvh`; moved the 520px minimum height to `md` and used zero below `md`; changed the customer summary from three base columns to one, restoring three at `sm`. |
| `apps/web/src/features/crm/BookingsPrototypePage.tsx` | Clamped both 480px booking dialogs with `w-[min(480px,calc(100vw-2rem))]`. |
| `apps/web/src/features/crm/BroadcastPage.tsx` | Changed the five poster-color swatches to two base columns, restoring five at `sm`. |
| `apps/web/src/features/crm/BroadcastPrototypePage.tsx` | Changed the five poster-color swatches to two base columns, restoring five at `sm`. |
| `apps/web/src/features/dashboard-notifications/NotificationBell.tsx` | Replaced the fixed 360px panel width and separate 90vw cap with `w-[min(360px,calc(100vw-2rem))]`. |
| `apps/web/src/features/inventory/InventoryPages.tsx` | Added `mangmee-table-scroll` wrappers to products, locations, movement history, and stock report tables. Each wrapper is inside its card/container. |
| `apps/web/src/features/ledger/LedgerReportsPage.tsx` | Added inner `mangmee-table-scroll` wrappers to trial balance and general ledger tables. |
| `apps/web/src/features/tax/TaxWorkspacePage.tsx` | Added a `mangmee-table-scroll` wrapper to the review-issues table. |
| `apps/web/next-env.d.ts` | `next typegen` regenerated this verification-owned file; restored its pre-run `.next/dev/types/routes.d.ts` form so R3 does not take ownership of the pre-existing worktree change. |
| `outputs/responsive-baseline/R3-REPORT.md` | Added this report. |

## Table-by-table desktop-impact audit

The nine required wrappers are inside their cards/containers, so the wrapper—not an outer `overflow-hidden` card—is the reachable horizontal scroller.

| File / table | Known route(s) | Could desktop visibly change? |
|---|---|---|
| `AccountingPages.tsx` — document list | `/accounting`, `/sales-documents` | **Yes, accepted.** The table now opts into scoped `min-width: max-content`; formerly squeezed columns may widen and scroll. |
| `AccountingPages.tsx` — document line items | `/accounting`, `/sales-documents` | **Yes, accepted.** The six-column reading table can preserve intrinsic column width and scroll instead of squeezing/clipping. |
| `LedgerReportsPage.tsx` — trial balance | `/journal` | **Yes, accepted.** The audited statement was column-squeezed; intrinsic width plus local scrolling is the intended improvement. |
| `LedgerReportsPage.tsx` — general ledger | `/journal` | **Yes, accepted.** The audited statement was column-squeezed; intrinsic width plus local scrolling is the intended improvement. |
| `TaxWorkspacePage.tsx` — review issues | `/tax` | **Yes, accepted.** Long issue text can widen the table and engage the local scroller rather than disappear beyond the card. |
| `InventoryPages.tsx` — products | `/inventory/products`, `/settings/crm-catalog` | **Potentially, accepted.** The existing table classes are preserved; if intrinsic content exceeds the card, it is now reachable by horizontal scrolling rather than clipping. |
| `InventoryPages.tsx` — locations | `/inventory/locations` | **Potentially, accepted.** The existing table classes are preserved; over-wide content can now scroll locally. |
| `InventoryPages.tsx` — movement history | `/inventory/movements` | **Yes, accepted.** This `mangmee-table` now receives the scoped intrinsic-width rule and may unsqueeze columns; its local wrapper owns the resulting scroll. |
| `InventoryPages.tsx` — stock report | `/inventory/reports/stock` | **Potentially, accepted.** The existing table classes are preserved; over-wide content can now scroll locally. |

No other table site was wrapped, so there is no additional uncertain desktop-impact site to flag.

### Full `mangmee-table` sweep

All 20 literal `mangmee-table` tables under `apps/web/src/features/` were audited. Six now use the new wrapper directly (accounting ×2, ledger ×2, tax issues, inventory movement history). The other 14 already have a scrollable ancestor and were intentionally left unchanged:

- reports result table: `overflow-auto`;
- reimbursements tables ×6: `overflow-x-auto`;
- ledger journal table: `overflow-x-auto`;
- tax events table: `overflow-x-auto`;
- expense workspace tables ×3: `overflow-x-auto`;
- chart-of-accounts settings tables ×2: `overflow-x-auto`.

The three additional raw inventory tables required by the static audit were also wrapped, producing the nine R3 wrappers in total.

## Responsive class choices

- Four- and five-item metric/swatch grids use two base columns, then restore their original count at `sm`; the cards/swatches remain usable at 375px without changing desktop layout.
- The inbox customer summary uses one base column because each item combines a label and variable-width value; it restores three columns at `sm`.
- `InboxPrototypePage` restores its original 520px minimum height at `md`, exactly matching the instruction to drop that floor only below `md`.
- Dialog and notification widths retain their original 480px/360px result when the viewport has room.

## Verification

- `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"; pnpm --filter @watchdog-bms/web typecheck` — **environment command unavailable** (exit 127: `pnpm` not found).
- Same requested PATH with `corepack pnpm --filter @watchdog-bms/web typecheck` — **PASS** (exit 0): Next route types generated and `tsc --noEmit` completed.
- Same requested PATH with `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build` — **PASS** (exit 0): Next.js 16.2.11 webpack compiled successfully, generated 11/11 static pages, finalized optimization, and collected build traces. The pre-existing unsupported `eslint` configuration warnings remained non-failing.
- `git diff --check` — **PASS**.
- Static unprefixed-grid scan under `apps/web/src/features/` — **PASS**: no unprefixed `grid-cols-3` through `grid-cols-9` remains.
- Static target scans — **PASS**: no `100vh` remains in the two CRM inbox files; no fixed `w-[480px]` remains in booking dialogs; no fixed `w-[360px]` remains in `NotificationBell`; all nine audited table wrappers are present.
- Binding CSS boundary check — **PASS**: the intrinsic-width selector remains `.mangmee-table-scroll .mangmee-table`, and the global sub-640px form-control floor remains present and unchanged.

The Postgres-dependent responsive and desktop E2E suites were **not run**, per the explicit sandbox instruction. Runtime INV-1/INV-2 green status therefore remains for the Claude gate; this report does not claim it.

## Deviations

- The requested Node 22.14.0 path is absent in this environment; after applying it, Node resolves to `/usr/local/bin/node` v24.14.0. The requested bare `pnpm` command is unavailable. Verification used repository-pinned pnpm 9.15.0 through Corepack, matching the accepted R1/R2 workaround.
- No E2E or browser checks were run because the sandbox cannot reach Postgres, as instructed.
- Pre-existing `test-results` changes and `outputs/responsive-r2-after/` artifacts were not modified or included in R3.

Work stops after R3.

---

## Claude gate verdict (2026-08-04) — PASS, no fixes needed

- Mobile `responsive.spec.ts`: **50/50 GREEN — first fully green mobile run.** INV-1/INV-2 pass on all 45 routes; the former failing set (/accounting, /sales-documents, /inventory/products, /settings/crm-catalog) all fixed. Note: /settings/crm-catalog was fixed via the shared `ProductsPageClient` in InventoryPages.tsx — one wrap covered both routes.
- Desktop smoke: 32/4 — identical pre-existing set, no growth.
- Desktop screenshots vs baseline: journal/reimbursements/settings byte-identical; dashboard = the R1 flash-fix diff; expenses = smoke-seeded data rows; accounting = the accepted squeeze→scroll improvement (cells now single-line and readable; PAYMENT/POSTING reachable by in-card scroll — previously truncated/clipped even on desktop).
- Wrapper placement verified inside overflow-hidden cards (the wrapper is the scrolling element).
