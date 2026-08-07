# Mobile Responsive Uplift — Codex CLI Handoff Harness

Status: Implement-ready 2026-08-04. Design authority: `docs/plans/mobile-responsive-uplift-plan.md` (read it first — decisions D1–D6 are binding). Task memory: `docs/agent-memory/mobile-responsive-uplift.md`. Predecessor harness (pattern to follow): `docs/plans/web-receipt-ocr-review-edit-codex-handoff.md`.

Executor model: **Codex CLI** — `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s workspace-write`. Codex codes + runs the listed verify commands per phase and self-reviews. **Claude (harness engineer) reviews each phase — mobile-UX correctness + desktop-parity diff audit + ponytail — drives fixes, runs the real e2e gate, and commits per-phase after PASS (explicit paths only, never `git add -A`). Codex never commits, never `git add`.**

## Problem (ground truth, verified 2026-08-04)

All file:line refs verified on `feat/expense-extraction-doc-type-default`. Full severity narrative in the plan doc §"Ground truth". The mechanical facts you will code against:

- Tailwind **v4** via `@tailwindcss/postcss`; NO `tailwind.config.*`; tokens in `@theme inline` at `apps/web/app/globals.css:16-54`; stock breakpoints (sm 640 / md 768 / lg 1024). Mangmee green tokens come from `packages/design-tokens` → do not restyle, only re-layout.
- Shell: drawer/hamburger/backdrop already exist (`src/common/components/app-shell/`). Known defects: `SidebarContext.tsx:36` breakpoint 768 vs CSS `lg:` 1024; `AppSidebar.tsx:213` `mt-16` vs `AppHeader.tsx:60` `h-[68px]`; backdrop `z-40` under header `z-[99999]`; no scroll lock; hover-expand fires on touch (`AppSidebar.tsx:217-218`); drawer `w-[289px]` = 77% of 375px; `SystemHeader.tsx:28-49` has no mobile path.
- `globals.css:92` `.mangmee-content { overflow-x: clip }` is **deliberate — keep it**. It's why 9 unwrapped tables are silently truncated: `src/features/ledger/LedgerReportsPage.tsx:181,199`; `src/features/accounting-documents/AccountingPages.tsx:154,438`; `src/features/tax/TaxWorkspacePage.tsx:311`; `src/features/inventory/InventoryPages.tsx:129,466,537,700`.
- `100vh` sites: `globals.css:73,79,110`; `src/features/crm-inbox/InboxPrototypePage.tsx:562`; `src/features/crm-inbox/InboxPage.tsx:480`. (`ExpenseReviewPage.tsx:644` already uses `100dvh` — the in-repo precedent.)
- iOS zoom: `src/common/components/field/Field.tsx:31` (`h-10 … text-sm`) + `.mangmee-input` `globals.css:371-379` (`font-size: 0.875rem`) — inputs must hit 16px at base.
- Popover engine: `src/common/components/field/PopoverPanel.tsx:50-58` computes `position: fixed` with no right-edge clamp and no `visualViewport` listener. `ThemedDate.tsx:154` self-protects with `max-w-[90vw]` — the clamp belongs in the engine.
- Core queues needing card views (D3 Tier 2): `src/features/reimbursements/ReimbursementsPages.tsx:713,1080,1238` (three `min-w-[980px]` tables); `src/features/expenses/ExpensesPages.tsx:1061` (`const GRID` pseudo-table) + `:1229-1230`; `src/features/accounting-documents/AccountingPages.tsx:153-158`.
- Reference mobile patterns already in-repo (copy these, don't invent): master-detail toggle `InboxPage.tsx:160,482,610-617`; mobile-only branch `BookingsPrototypePage.tsx:530-548`; responsive stepper `AddEmployeePrototypePage.tsx:622-632`; clamped popover `IndividualPermissionsPrototypePage.tsx:538` (`max-w-[min(15rem,80vw)]`).
- There is NO `useMediaQuery`/`matchMedia` hook anywhere; `src/common/hooks/` has one hook (`use-close-on-outside-click.ts`) — follow its file/naming style.
- E2E: harness in `e2e/harness/` (auth, fixtures, `expectNoClientError`); runner `e2e/run-local.sh` (pins DB `:5432` — never `source .env`); `playwright.config.ts` has a single `chromium` Desktop Chrome project; default UI locale is Thai (assert `th|en` regexes, navigate by URL, assert by role).

## Environment quirks (read before running anything)

- **Node**: shell defaults to v14. Prefix EVERY session: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- Web checks: `pnpm --filter @watchdog-bms/web typecheck` and `pnpm --filter @watchdog-bms/web build`.
- E2E: `e2e/run-local.sh …` only (it boots api+web via Playwright `webServer`; first run rebuilds ~2 min). Seeded DB is native postgres `:5432`. MinIO/Redis may be down — quarantine upload-dependent checks with `test.fixme` + one-line reason, never delete.
- **No schema changes, no API changes, no new dependency.** This is a CSS/TSX-only uplift. If you think you need a package (headless UI, drawer lib), STOP — D6 forbids it.
- Playwright mobile emulation: use `devices['Pixel 7']` from `@playwright/test` (already installed).

## Hard rules (violating any = wrong implementation)

1. **No commits, no `git add`**, no dev servers outside the runner. Shared worktree — touch only files each phase names (a mechanical-sweep phase names files by pattern; list every touched file in your report).
2. **Desktop pixel parity (D2).** Every change is base-breakpoint + desktop value restored at the existing breakpoint (`h-11 sm:h-10`), or `max-width` media queries. The ONLY desktop-visible changes allowed are the ones tagged `[desktop-visible]` in R1. Anything else that alters desktop rendering = defect.
3. **Keep `overflow-x: clip`** on `.mangmee-content`. Fix tables by wrapping them, not by removing the guard.
4. **Do not resurrect dead components** (`DataTable`, `ListPageLayout`, `PageHeader`, `ActionToolbar`) and do not migrate tables onto them. Fix the classes tables already use.
5. **Card views are additive DOM**: `md:hidden` card list + `hidden md:block` around the existing table markup. The desktop table's DOM/classes must be byte-identical inside its new wrapper.
6. Preserve existing behavior: no renamed props, no changed copy except where a phase says so, all Thai copy stays Thai. Status/permission/loading states untouched.
7. Touch-target bumps use padding/hit-area first; visible control size changes only below `sm`.
8. Ponytail full mode: shortest correct diff, existing patterns first, no speculative abstractions.

---

# Phases (sequenced — each gated by Claude review, committed individually)

## R0 — Verification rig (no product code)

Business intent: every later phase lands against a red/green signal; today's breakage is captured as a failing baseline, and desktop gets a tripwire against drift.

Changes:
1. `playwright.config.ts`: add project `{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }`. Existing `chromium` project untouched. Gate responsive specs to the mobile project and existing specs to desktop via `testIgnore`/`testMatch` or in-spec `test.skip(({ isMobile }) => …)` — pick the least-invasive mechanism that keeps the current desktop suite's project assignment unchanged.
2. New `e2e/responsive.spec.ts` (mobile project only), using the existing harness (`e2e/harness/fixtures.ts`, `expectNoClientError`):
   - `ROUTES`: every sidebar route for the seeded company (copy the list from `e2e/sidebar-nav.spec.ts` if it has one; else enumerate from `WorkspaceLayout.tsx` nav items).
   - **INV-1 no page overflow**: after goto + settle, `document.scrollingElement.scrollWidth <= window.innerWidth + 1`.
   - **INV-2 no clipped table**: for each `<table>` (plus `[data-testid="expenses-grid"]` once R4 tags it): some ancestor has computed `overflow-x` `auto|scroll`, OR the table fits the viewport. Report route + table index on failure.
   - **INV-3 drawer works**: hamburger visible at mobile width; tap opens drawer; backdrop tap closes; Escape closes; `document.body` scroll is locked while open. (Write now; expected RED until R1.)
   - **INV-4** `expectNoClientError` per route.
3. Baseline capture: run the spec, commit nothing, write the failing-route list into your report (this is the "before" evidence). Capture desktop screenshots of dashboard, expenses, reimbursements, accounting, journal, settings into `outputs/responsive-baseline/` via a tiny throwaway spec or `--update-snapshots`-free `page.screenshot` helper spec kept under `e2e/` with `test.skip` unless `RESPONSIVE_BASELINE=1`.

Codex verify: `e2e/run-local.sh e2e/responsive.spec.ts` — spec executes on mobile-chromium; INV-1/2 fail exactly on the audited routes (accounting, sales-documents, journal, inventory, tax at minimum); INV-3 fails on scroll-lock/Escape; desktop suite smoke `e2e/run-local.sh --grep @smoke` still green.
Claude gate: invariants assert the right things (no tautologies); failing baseline matches the audit's 9 clipped sites; zero product files touched.

## R1 — Foundation + shell

Business intent: the frame every page lives in is correct on a phone — drawer aligned and usable, nothing overscrolls, notches respected — with desktop untouched except three tagged bug fixes.

Changes:
1. `app/layout.tsx`: add `export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }`.
2. `app/globals.css`:
   - `:root` gains `--app-header-h: 68px` (near the `@theme` block).
   - `100vh` → `100dvh` at :73, :79, :110.
   - `.mangmee-content`: add `padding-bottom: calc(… + env(safe-area-inset-bottom))` (keep existing ladder values).
   - New `.mangmee-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; }` and `.mangmee-table { min-width: max-content; }` appended to the existing `.mangmee-table` block (:429). **Check**: `min-width: max-content` must not visibly change desktop tables that currently fill their card at `width: 100%` — keep `width: 100%` so ≥container tables still fill; verify on `/journal` desktop.
   - `.mangmee-segmented`: add `max-width: 100%; overflow-x: auto;` + hidden scrollbar (reuse/no-scrollbar util if present, else `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`).
   - `@media (max-width: 40rem)` block: `.mangmee-page-header { flex-direction: column; align-items: stretch; }` and `.mangmee-page-actions { justify-content: stretch; }` with buttons allowed to fill.
3. New `src/common/hooks/use-media-query.ts`: SSR-safe `useMediaQuery(query: string): boolean` via `matchMedia` + change listener (`useSyncExternalStore` or effect — match repo React idiom); export `useIsDesktop = () => useMediaQuery('(min-width: 64rem)')`.
4. `src/common/components/app-shell/SidebarContext.tsx`: replace the `innerWidth < 768` resize listener with the hook at 1024; add body scroll lock while `isMobileOpen` (set/clear `document.body.style.overflow`).
5. `src/common/components/app-shell/AppSidebar.tsx`: `mt-16`/`h-[calc(100dvh-4rem)]` → `mt-[var(--app-header-h)]`/`h-[calc(100dvh-var(--app-header-h))]` `[desktop-visible: fixes 4px drawer misalignment]`; drawer width `w-[289px]` → `w-[min(289px,85vw)]` (mobile-only effect); gate `onMouseEnter/Leave` hover-expand behind `(hover: hover)` (via the hook or a `matchMedia` check); Escape closes `isMobileOpen`; `aria-hidden` + `inert` (or `visibility`) while off-canvas below `lg`; logout + collapse buttons `h-8 w-8` → ≥44px hit area at base, `sm:` restores visuals.
6. `src/common/components/app-shell/AppHeader.tsx`: `h-[68px]` → `h-[var(--app-header-h)]`; `window.innerWidth >= 1024` inline check → the hook; hamburger/avatar hit areas ≥44px at base.
7. `src/common/components/app-shell/Backdrop.tsx` + header z-order: backdrop must dim/block the header. Lower header `z-[99999]` → a documented scale (e.g. header `z-30`, backdrop `z-40`, drawer `z-50`, modal stays top) `[desktop-visible: verify sticky header still overlays page content + ThemedSelect/PopoverPanel/Modal portals still stack above header]`.
8. `src/common/components/app-shell/WorkspaceShell.tsx`: remove inert `xl:flex` `[desktop-visible: no-op by analysis — confirm visually]`.
9. `src/common/components/app-shell/SystemHeader.tsx`: below `md`, nav becomes `overflow-x-auto` `whitespace-nowrap` scroller; desktop row unchanged.
10. `src/features/web-core-workspace/WorkspaceScope.tsx`: dropdown panels `w-64`/`w-72` get `max-w-[calc(100vw-2rem)]` + right-edge-safe positioning at base.

Codex verify: web typecheck + build; `e2e/run-local.sh e2e/responsive.spec.ts` — INV-3 now green, INV-1 green on shell-only routes (dashboard, settings); full desktop suite `e2e/run-local.sh` green; manual screenshot pass of header/drawer at 375 and 1280 attached to report.
Claude gate: diff contains zero desktop-affecting changes outside the three `[desktop-visible]` tags; z-order verified against Modal/PopoverPanel portals; scroll-lock releases on route change and unmount; hook is SSR-safe (no hydration mismatch warning in dev console).

## R2 — Shared controls

Business intent: forms and overlays feel native on touch — no iOS zoom, no popover off the edge of the screen, everything tappable.

Changes:
1. `src/common/components/field/Field.tsx`: input class `text-sm` → `text-base sm:text-sm`; height `h-10` → `h-11 sm:h-10`; `SwitchField` (:160) wraps control in ≥44px hit area; password-reveal button (:73) gets ≥44px hit area.
2. `globals.css` `.mangmee-input`: `font-size: 1rem; min-height: 2.75rem;` at base, restore `0.875rem`/`2.5rem` inside `@media (min-width: 40rem)`. (Covers `ThemedSelect` ×29 + `ThemedDate` ×9.)
3. `src/common/components/button/Button.tsx` + `IconButton.tsx`: sizes become `sm: h-9 sm:h-8`, `md: h-11 sm:h-10` (widths likewise for IconButton). Desktop rendering identical at ≥640.
4. `src/common/components/modal/Modal.tsx`: container `items-end sm:items-center`, panel `rounded-t-2xl sm:rounded-lg` + `w-full`, body div gains `overscroll-contain`, add body scroll lock while open (reuse the R1 mechanism — extract to a tiny shared helper if both need it), close button ≥44px hit area, padding `px-4 py-3 sm:px-5 sm:py-4`.
5. `src/common/components/field/PopoverPanel.tsx`: clamp `left` to `[8, innerWidth - width - 8]`, cap `maxWidth: calc(100vw - 16px)`, re-position on `visualViewport` `resize`/`scroll` when available.
6. `src/common/components/field/ThemedDate.tsx`: nav arrows + day cells ≥40px hit area at base (calendar is 286px wide — 44 strict would overflow; 40+ with spacing is the deliberate exception, note it), keep panel `max-w-[90vw]`.
7. `src/common/components/data-table/Pagination.tsx`: `flex-wrap` + `size` bump per Button change (comes mostly free).

Codex verify: web typecheck + build; responsive spec green; desktop suite green; add to `e2e/responsive.spec.ts`: **INV-5 no-zoom** — every visible `input/select/textarea` on login + expenses manual form has computed `font-size >= 16px` at mobile width; **INV-6 popover-in-viewport** — open the branch selector + one ThemedSelect near the right edge (expenses filters), assert `getBoundingClientRect().right <= innerWidth` and `.left >= 0`.
Claude gate: desktop screenshots of a dense form (accounting-tax-setup) and a modal byte-compare vs R0 baseline; iOS-zoom rule actually covers `.mangmee-input` consumers (grep for stray `text-sm` on inputs); no focus-trap regressions in Modal.

## R3 — Mechanical sweep (feature files)

Business intent: no screen anywhere silently hides data or overflows the page; every remaining wide surface scrolls honestly.

Changes (pattern-scoped; list every touched file in the report):
1. Wrap the 9 clipped tables in `<div className="mangmee-table-scroll">`: `LedgerReportsPage.tsx:181,199`, `AccountingPages.tsx:154,438`, `TaxWorkspacePage.tsx:311`, `InventoryPages.tsx:129,466,537,700`. Then sweep: every `<table className="mangmee-table">` in `src/features/` without a scrollable ancestor gets the same wrapper (expect ~a few more — INV-2 is the oracle).
2. Unprefixed grids: `AccountingPages.tsx:598` `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`; `AccountsPayablePages.tsx:535` `grid-cols-5` → `grid-cols-2 sm:grid-cols-5`; Broadcast pages `grid-cols-5` likewise; `InboxPrototypePage.tsx:1323` `grid-cols-3` → `grid-cols-1 sm:grid-cols-3` (pick 1 vs 2 base cols by content width, note choices).
3. `100vh` → `100dvh`: `InboxPrototypePage.tsx:562` (also drop `minHeight: 520` below `md` — use `min-h-0 md:min-h-[520px]` equivalent in the style/class), `InboxPage.tsx:480`.
4. Fixed-px overlays: `BookingsPrototypePage.tsx:563,717` `w-[480px]` → `w-[min(480px,calc(100vw-2rem))]`; `NotificationBell.tsx:84` `w-[360px]` → `w-[min(360px,calc(100vw-2rem))]`.
5. Existing `min-w-[980px]`-style tables stay as-is in this phase (R4 handles the queues; settings matrices remain scrolling tables by design).

Codex verify: web typecheck + build; `e2e/run-local.sh e2e/responsive.spec.ts` — **INV-1 and INV-2 green on ALL routes** (this is the phase's definition); desktop suite green.
Claude gate: sweep completeness (grep `<table` under `src/features` — every hit wrapped or fits); no wrapper added *inside* an `overflow-hidden` card that still clips (wrapper must be the scrolling element); spot-check journal + inventory on desktop vs baseline screenshots.

## R4 — Mobile card views for the core queues

Business intent: the five screens where staff actually work all day become genuinely phone-usable — key facts and the primary action visible without horizontal dragging; desktop tables untouched.

Card anatomy (all queues, per D3): tappable card = line 1 identity (doc no. + counterparty, truncating), line 2 status `MangmeeBadge` + date/age, line 3 amount right-aligned prominent; primary action = whole-card tap when the row's action is "open", else an explicit ≥44px button row. Reuse `MangmeeCard`/`MangmeeBadge`; no new shared abstraction unless all three files converge naturally on one small `QueueCardList` — if they do, put it in the feature that owns it first, promote only if literally identical (ponytail).

Changes:
1. `src/features/reimbursements/ReimbursementsPages.tsx`: for each of the three queue tables (:713, :1080, :1238): wrap existing table block in `hidden md:block` (byte-identical inside), add sibling `md:hidden` card list rendering the same row model — my-requests card fields: เลขที่, เหตุผล (truncate), status, ยอด, primary action; approvals/finance cards surface their row's existing action buttons as full-width ≥44px buttons. Empty/loading/error states shared with the table (render states outside the visibility split).
2. `src/features/expenses/ExpensesPages.tsx`: the `GRID` pseudo-table (:1061, :1229-1259): tag the scroll container `data-testid="expenses-grid"`; wrap in `hidden md:block`; sibling `md:hidden` card list — fields: vendor/doc, status badge + date, ยอดรวม, tap → existing row navigation. Keep KPI cards and filters as-is (already responsive).
3. `src/features/accounting-documents/AccountingPages.tsx`: document list (:153) gets the same split — Type+Number, Status+Date, Total; tap → existing row action. (The :437 line-items table stays a scrolling table — it's a reading surface.)

Codex verify: web typecheck + build; extend `e2e/responsive.spec.ts`: **INV-7 card views** — at mobile width on reimbursements/expenses/accounting list routes: table variant hidden, ≥1 card visible with seeded data, card tap navigates (assert URL), no INV-1 overflow; at desktop width: cards absent, tables visible and (for the three pages) DOM of the table subtree unchanged vs a stored serialization or key-column assertion. Desktop suite green. Quarantine (`test.fixme`) any card check needing MinIO-seeded rows, with reason.
Claude gate: desktop DOM byte-parity on the three files' table subtrees (diff review); card field selection matches the queue's action model (no "mystery meat" cards); states (empty/loading/error/permission) render on both variants; Thai copy reused not re-written; no new dependency, no promoted abstraction unless identical-by-diff.

## R5 — Full matrix + close-out

Business intent: the uplift is proven, recorded, and reproducible.

Changes:
1. Full runs: `e2e/run-local.sh` (desktop) and `e2e/run-local.sh e2e/responsive.spec.ts` (mobile), plus one responsive run with viewport overridden to 375×667 (`test.use` or env-param the viewport in the spec) to prove the 375 floor.
2. Re-capture the 6 desktop screenshots; visually diff vs `outputs/responsive-baseline/`; list any pixel diffs with their `[desktop-visible]` justification.
3. Write `e2e/RESPONSIVE-RESULTS.md`: per-phase status, per-route INV matrix (375 + 412 + desktop), quarantined tests with reasons, every touched file, remaining known gaps (e.g. ThemedDate 40px exception, settings matrices as scroll tables, SystemHeader scroller).
4. Update `docs/agent-memory/mobile-responsive-uplift.md` (status → shipped state, verification evidence) and tick the plan doc's phase table.

Codex verify: all listed runs green (or quarantined-with-reason); RESULTS file complete.
Claude gate: no unexplained red; desktop diff list contains only tagged items; docs updated; final commit sequence recorded.
