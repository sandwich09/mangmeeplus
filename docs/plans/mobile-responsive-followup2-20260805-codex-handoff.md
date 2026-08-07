# Mobile Responsive Follow-up #2 (full-app sweep) — Codex CLI Handoff

Status: Implement-ready 2026-08-05. Successor to `docs/plans/mobile-responsive-followup-20260805-codex-handoff.md` (already implemented) and `docs/plans/mobile-responsive-uplift-codex-handoff.md` — the uplift's Hard rules and **D2 desktop pixel parity** are binding. Task memory: `docs/agent-memory/mobile-responsive-uplift.md`.

Executor: **Codex CLI**. Codex codes + runs typecheck + self-reviews. Claude reviews the diff, runs the e2e gate, commits. **Codex never commits, never `git add`, never `git checkout/restore/stash`, never starts servers.**

⚠ **Dirty worktree**: several files carry uncommitted in-flight work — notably `apps/web/src/features/reimbursements/ReimbursementsPages.tsx` (which you WILL edit) and `apps/web/src/common/i18n/workspace-dictionary.ts` / `apps/api/**` (which you must NOT touch). Edit on top of the current working-tree state; reverting anything = critical failure. Touch ONLY the files named below.

## Context

Three parallel code audits (2026-08-05, all measurements at a 390px viewport, content ≈358px at page `p-4`, ≈318–326px inside cards) found ~30 instances of the same three defect patterns fixed yesterday in the dashboard/expense-review. Environment facts: Tailwind v4, `.mangmee-content { overflow-x: clip }` (deliberate — anything that overflows without a scroll wrapper is UNREACHABLE, not scrollable); `.mangmee-btn` is `inline-flex; justify-content:center` so flex-col items stretch full-width with centered labels automatically.

## Recipes (apply exactly; every change is mobile-first with the CURRENT classes restored at `sm:` unless the finding says otherwise)

- **[A] Scroll strip** (chip rows / tab bars): container becomes a single no-wrap horizontal scroller below `sm`:
  `flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible` (adapt: keep the row's existing border/margin classes; if the original has no `flex-wrap` — the tab bars — the `sm:` restore is just `sm:overflow-x-visible` and no `sm:flex-wrap`). Every child gets `shrink-0 whitespace-nowrap` prepended (desktop-inert: they never shrank/wrapped at desktop widths). Precedent: `DashboardPages.tsx:270` (yesterday's F2).
- **[B] Stacked actions**: button row becomes `flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center` (carry over the row's other existing classes; `sm:` restores today's exact layout, including `sm:ml-auto` where a member had `ml-auto`). Destructive button goes visually last on mobile via `order-last sm:order-none` when it isn't already last in DOM. Precedent: `ExpenseReviewPage.tsx` F3.
- **[B2] 2-col grid actions** (4+ short-ish buttons where a full stack is too tall): `grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center`.
- **[C] Gap patch** (gapless `justify-between` rows that wrap into collision): prepend `gap-x-3 gap-y-2` (desktop-inert when the row never wraps at desktop widths — all listed rows fit on one line ≥640px).
- **[E] Fixed-sheet menu** (edge-clipped absolute menu): base `fixed inset-x-4 top-auto` + `sm:` restore of the original anchor classes. `position:fixed` with `top:auto` keeps the static (in-flow) vertical position, so no top calc is needed. Precedent: `NotificationBell.tsx` F1.

## Findings — Phase H (HIGH: content unreachable at 390px, fix first)

| # | File:line | Current | Fix |
|---|---|---|---|
| H1 | `apps/web/src/features/banking/BankingPages.tsx:413` | `flex border-b border-gray-200` — 6 Thai tabs ≈750px, no wrap/scroll → last tabs clipped, panels unopenable | **[A]** tab scroll strip (`gap` not needed; keep `border-b`); each tab button `shrink-0 whitespace-nowrap` |
| H2 | `apps/web/src/features/accounts-payable/AccountsPayablePages.tsx:766` | same tab bar ≈545px → AP Aging tab unreachable | **[A]** same |
| H3 | `apps/web/src/features/procurement/ProcurementPages.tsx:276` | same tab bar ≈530px → GR tab clipped | **[A]** same |
| H4 | `apps/web/src/features/expenses/ExpensesPages.tsx:1233` | inner `flex items-center gap-2` (export group; parent row `:1231` is fine) — select+button+badge ≈410px in 326, no wrap → export clipped | change inner to `flex flex-wrap items-center gap-2` and give the `ThemedSelect` `min-w-0`; nothing else |
| H5 | `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx:585` | `absolute right-0 top-10 z-20 w-52 …` — trigger sits mid-card (right edge ≈x210) → menu spans past the left content edge; "ลบพนักงาน" clipped by `overflow-x: clip` | **[E]**: `fixed inset-x-4 top-auto z-20 … sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-52` (keep every other class) |

## Findings — Phase M (medium: ragged/colliding but reachable)

Chip/filter rows → **[A]**:
- `features/crm/CrmReportsPrototypePage.tsx:228` (5 period chips + export button; keep them all in the strip, same order)
- `features/crm-inbox/InboxPage.tsx:458` (status chip cloud; the single-row strip also restores the `calc(100dvh - 220px)` height assumption at `:480` — do NOT touch the calc)
- `features/crm-inbox/InboxPrototypePage.tsx:528` (same chip cloud, inline-styled chips still get `shrink-0 whitespace-nowrap` via className)
- `features/expenses/ExpensesPages.tsx:1216` (segmented + date + reset row)
- `features/expenses/ExpensesPages.tsx:1247` (count chips; also give the `<div className="flex-1" />` spacer at `:1256` `hidden sm:block` so it doesn't distort the strip)
- `features/expenses/ExpensesWorkspacePanels.tsx:614` (6 filter chips)
- `features/reimbursements/ReimbursementsPages.tsx:516` (5 status chips) ⚠ dirty file — edit on top
- `features/tax/TaxWorkspacePage.tsx:196` (5 nav links — **[A]** or **[B2]**, pick [B2] since they're navigation, 2-col grid reads better)
- `features/tax/TaxWorkspacePage.tsx:295` (compute + 4 export buttons → **[B2]**)

Action rows / footers → **[B]** unless noted:
- `features/crm/CrmPages.tsx:398` (4 drawer actions → **[B2]**)
- `features/employee-access/EmployeeAccessPages.tsx:672` (7 long buttons → **[B]**)
- `features/employee-access/PoApprovalSettingsPage.tsx:54` (tier row → **[B]**; delete button `self-end sm:self-auto sm:ml-auto`)
- `features/system-partners/PartnerDetailPage.tsx:632` (3 preset buttons + count badge: badge gets `basis-full sm:basis-auto` so it takes a tidy own row on mobile; buttons untouched)
- `features/system-partners/PartnerDetailPage.tsx:968` (sticky footer: outer → `flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between` keeping its sticky/border/bg classes; the button group inside gets `flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none` so คืนค่า/ตรวจสอบและบันทึก share one full-width row)
- `features/accounting-documents/AccountingPages.tsx:496` (up to 10 doc actions → **[B2]**; the Void/destructive button additionally `col-span-2 order-last sm:order-none` on mobile)
- `features/accounts-payable/AccountsPayablePages.tsx:158` (4 evidence buttons → **[B2]**, ปฏิเสธหลักฐาน `order-last sm:order-none`)
- `features/banking/StatementImportPanel.tsx:238` → `flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4`
- `features/expenses/ExpensesWorkspacePanels.tsx:549` (filter bar → **[B]** on the container i.e. `flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end` + keep `p-4`; the two `ml-auto` members at `:586-587` become `sm:ml-auto` only — on mobile they're full-width rows like the rest)
- `features/expenses/ExpensesPages.tsx:291` (upload stepper: give both arrow `<svg>`/wrapper elements `hidden sm:block` so mobile shows clean centered chips without dangling arrows; chips row otherwise untouched)

Gapless justify-between rows → **[C]** (add `gap-x-3 gap-y-2`, nothing else):
- `features/dashboard-notifications/NotificationPages.tsx:79` and `:283`
- `features/ai-suggestions/AiSuggestionsPages.tsx:81`
- `features/system-partners/PartnerListPage.tsx:118`
- `features/workflow/WorkflowPages.tsx:408`, `:461`, `:623`
- `features/tax/TaxWorkspacePage.tsx:271` (parent row; its inner `:282` group additionally gets `gap-y-2` — it already wraps)
- `features/accounts-payable/AccountsPayablePages.tsx:531` (also add `flex-wrap` — it has none)
- `features/employee-access/DiscountPolicyPage.tsx:209` → `flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between` (steppers drop below label cleanly)
- `features/tax/TaxReconciliationPage.tsx:99` (inner group): → `flex flex-wrap items-center gap-3` + give the note `mangmee-input` wrapper `min-w-[10rem] flex-1`
- `features/banking/MatchingPanel.tsx:179` add `gap-y-2`; the `:185` group → `ml-auto basis-full justify-end sm:basis-auto` appended (keeps right alignment on its own mobile row)

Shared component (desktop-inert — footers never wrap ≥640px):
- `common/components/modal/Modal.tsx:112` footer: add `flex-wrap gap-y-2` (fixes reimbursement modal footers at `ReimbursementsPages.tsx:661-671` and every other modal with >2 actions)

## Regression guard

`e2e/responsive.spec.ts` (mobile-chromium): add one test `INV-8 tab bars reachable` — for routes `/banking`, `/accounts-payable`, `/procurement`: locate the LAST tab button in the tab bar (`getByRole('button')` within the strip; identify by its Thai label: `รายการปรับปรุง`, the last AP tab, `ใบรับสินค้า (GR)` — read the source for exact labels), `scrollIntoViewIfNeeded()` + `tap()`, assert no client error via the existing `expectNoClientError` fixture and that the tapped tab reports selected state (aria or class) or its panel heading appears. Follow the file's existing idioms (`gotoAndSettle`, soft asserts).

## Out of scope

- `ReportsWorkspacePage.tsx:236` (fits at 390) and its chart grid; InboxPage `calc()` constants; anything not listed. Popover leads in InboxPage 657/683 were measured SAFE — do not touch.

## Verify (Codex runs ONLY this)

```
corepack pnpm --filter @watchdog-bms/web typecheck
```

No e2e, no build, no servers (sandbox has no DB; zombie servers on :3000/:3001 poison later runs). Claude runs the e2e gate.

Report per file: pattern applied, why desktop-inert. List every touched file — it must be exactly the files named here (24 app files + Modal.tsx + the e2e spec).
