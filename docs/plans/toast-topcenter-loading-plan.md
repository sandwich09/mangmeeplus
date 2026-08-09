# Toast v2 (Top-Center Redesign) + Global Loading Coverage — Plan

Status: APPROVED FOR IMPLEMENTATION (Codex executor)
Date: 2026-08-08
Execution: `docs/plans/toast-topcenter-loading-codex-handoff.md`
Owner: Claude (harness engineer) + Codex CLI (executor)
Predecessor: `docs/plans/global-toast-feedback-plan.md` (design authority for the
toast system internals — bus, provider, seam, specs). This plan CHANGES ONLY the
visual/positional layer and adds a system-wide loading-state workstream.
Task memory: `docs/agent-memory/global-toast-feedback.md`

## 1. Problem

Product requirement (owner, 2026-08-08):

1. Toast must render **top-center** of the viewport (currently bottom-center),
   keeping the three pastel tones — success = pastel green, warning = pastel
   yellow, error = pastel red — and looking deliberately designed, not default.
2. Every page must show a loading indicator: while the page's initial data
   fetch is in flight AND while any mutation is in flight. A prior sweep
   (Phase 7, 2026-08-08) fixed the worst mutation gaps; this plan closes the
   rest and standardizes the visual.

Current state:

- `ToastTone` is already `success | warning | error` with the required pastel
  surfaces (`success-50 #ecfdf3`, `warning-50 #fffaeb`, `error-50 #fef3f2`).
  **No model/type change is needed** — this workstream is visual only.
- Toast stack: `fixed inset-x-0 bottom-6` in
  `apps/web/src/common/components/toast/ToastProvider.tsx:64`.
- Initial-load feedback is inconsistent: shared `LoadingState` (3 uses) and
  `CoverLoader` (4 uses) exist in `apps/web/src/common/components/state/`, but
  ~69 sites render ad-hoc `กำลังโหลด...` text and some pages render nothing at
  all during load (tables in §3).

## 2. Toast v2 — visual & positional design

All changes live in `Toast.tsx`, `ToastProvider.tsx`, `app/globals.css`, and
`toast-render.spec.ts`. Bus, logic, model, hook, seam: untouched.

### 2.1 Container (ToastProvider.tsx)

Replace the stack container class with:

```
pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[100000] flex flex-col items-center gap-2 px-4
```

- Top-center below the iOS safe area (`viewportFit: 'cover'` is set in
  `app/layout.tsx`, so `env(safe-area-inset-top)` is real on notched devices).
- The app header (`AppHeader.tsx:67`, `h-[68px] z-30`) is left/right justified
  with an empty visual center — a transient pill overlapping it briefly is
  fine and matches platform convention. Do NOT anchor below the header; toast
  must sit at the same spot on `/login` and `/system/*` which have different
  headers.
- `z-[100000]` unchanged (above Modal `z-[99999]`).
- **Newest on top**: render `[...items].reverse()` so a new toast enters at the
  top row and pushes older ones down (standard for top-anchored stacks).
  `toast.logic.ts` ordering (append + `slice(-MAX_VISIBLE)`) stays untouched.

### 2.2 Pill (Toast.tsx)

Keep the pastel tone surfaces exactly as registered (constraint: `@theme` in
`globals.css` registers only these shades — `success-100`/`error-100` do NOT
exist; do not invent shades):

| Tone | Surface classes | Icon chip classes | Glyph | role |
|---|---|---|---|---|
| success | `border-brand-100 bg-success-50 text-success-700` | `bg-success-500/15 text-success-700` | ✓ | `status` |
| warning | `border-warning-100 bg-warning-50 text-warning-700` | `bg-warning-500/20 text-warning-700` | ⚠ | `status` |
| error | `border-error-500/20 bg-error-50 text-error-700` | `bg-error-500/15 text-error-700` | ✕ | `alert` |

New pill structure (replaces the bare-glyph layout):

```tsx
<div role={…} className={`toast-enter pointer-events-auto flex w-fit max-w-[min(92vw,28rem)] items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-[0_12px_32px_-8px_rgba(16,24,40,0.18)] ${TONE_CLASS[tone]}`} onClick={onDismiss}>
  <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] ${TONE_CHIP[tone]}`}>{glyph}</span>
  <span className="min-w-0 break-words pt-0.5 leading-5">{message}</span>
  <IconButton … className="-mr-2 -mt-0.5 h-6 w-6 text-current hover:bg-black/5" />  {/* dismiss, unchanged behavior */}
</div>
```

Design rationale: the circular tone chip gives the glyph a finished badge
instead of a floating character; `items-start + break-words + max-w` lets long
Thai API error messages wrap to multiple lines without stretching full-bleed;
the soft long-throw shadow (`0_12px_32px_-8px`) reads "floating over the page"
at top placement where `shadow-lg` looked flat. Radius `rounded-2xl` matches
`MangmeeCard`.

Unchanged: dismiss `IconButton` with `aria-label="ปิดการแจ้งเตือน"`, glyphs,
click-anywhere-to-dismiss, `role` mapping, durations (4 s / 4 s / 6 s),
`MAX_VISIBLE = 3`, `DEDUP_MS = 1000`.

### 2.3 Motion (app/globals.css)

Inside the existing `@media (prefers-reduced-motion: no-preference)` block,
replace the `toast-in` keyframes (enter now slides DOWN from above):

```css
@keyframes toast-in {
  from { opacity: 0; transform: translateY(-0.625rem) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.toast-enter { animation: toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1); }
```

Class name `.toast-enter` MUST stay — `e2e/toast-feedback.spec.ts` selects
`[role="status"].toast-enter` / `[role="alert"].toast-enter`.

### 2.4 Spec updates

- `toast-render.spec.ts` — update class assertions: tone surface classes stay;
  ADD assertions for the chip classes (`bg-success-500/15` etc.), `rounded-2xl`,
  and `max-w-[min(92vw,28rem)]`.
- Add one assertion in a provider-level spec (or extend `toast-render.spec.ts`
  with a static render of the container if practical): stack renders newest
  first. If static-render of the provider is impractical (portal), assert the
  reverse ordering via a tiny pure helper `visibleToasts(items) =>
  [...items].reverse()` exported from `toast.logic.ts` and used by the
  provider — one line, unit-testable, no DOM needed.
- e2e: no changes required.

## 3. Loading coverage (audit: 2026-08-08, full feature sweep)

Standard primitives (already in `apps/web/src/common/`, do not build new ones):

- `components/state/LoadingState.tsx` — centered brand spinner + optional
  label (`size` sm/md/lg). Standard for initial page/section body loads.
- `components/state/CoverLoader.tsx` — spinner overlay (`active`, `scope`,
  `label`, children stay mounted). Standard when existing content should stay
  visible under the load (refetch, table refresh).
- Mutation in-flight idiom: `disabled={busy}` + label swap
  `{busy ? 'กำลังบันทึก...' : 'บันทึก'}` (the repo-dominant pattern, ~40
  sites), or the shared `Button loading={busy}` where `Button` is already in
  use. Do NOT convert hand-rolled `<button className={btnClass}>` sites to the
  shared `Button` — its variant classes differ and the churn is not worth it.

### 3.1 L1 — initial-load gaps (page fetches on mount; user sees nothing or a fake empty state)

High-impact (fix all):

| File | Component | Problem while loading |
|---|---|---|
| `features/accounting-documents/AccountingPages.tsx:648` | `CounterpartyListPage` | shows "No counterparties" empty state during fetch |
| `features/accounting-documents/AccountingPages.tsx:695` | `PaymentListPage` | shows "No payments" during fetch |
| `features/workflow/WorkflowPages.tsx:252` | `RuleDetailModal` | `if (!rule) return null` → blank modal until response |
| `features/workflow/WorkflowPages.tsx:379` | `RunDetailModal` | same blank-modal problem |
| `features/tax/TaxReconciliationPage.tsx:31` | page | shows "ยังไม่มีผลในตัวกรองนี้" while history loads (and on every filter change) |
| `features/tax/TaxWorkspacePage.tsx:120` | period detail pane | `loadPeriodDetail` clears events/issues then awaits — pane silently empty |
| `features/banking/StatementImportPanel.tsx:34` | history table | shows "ยังไม่มีการนำเข้า" during fetch |
| `features/accounts-payable/AccountsPayablePages.tsx:226` | `ApprovalPolicyPanel` | renders form with WRONG defaults until policy arrives (actively misleading) |

Fix shape: add a `loading` flag (or reuse an existing one that is set but never
rendered), render `<LoadingState label="กำลังโหลด..." />` in the body slot —
for the two modals render it inside the modal frame so the modal opens
instantly with a spinner. For `ApprovalPolicyPanel`, gate the form itself on
loaded data (spinner until then) — showing wrong policy values is worse than a
spinner.

Lower-impact (fix in the same phase, smallest diff — a disabled select with a
`กำลังโหลด...` placeholder option, or a small inline spinner row, is enough):

- `banking/StatementImportPanel.tsx:51`, `banking/MatchingPanel.tsx:57` — bank-account selects render optionless
- `accounts-payable/AccountsPayablePages.tsx:61,192,287` — evidence/supplier selects, `?billId=` deep-link
- `crm/CrmPages.tsx:342` — opportunity row `onClick` awaits `getCrmOpportunity` with no busy: drawer "doesn't appear"; add row-level busy + disable
- `crm/CustomersPrototypePage.tsx:506` — filter dropdown sources
- `expenses/ExpensesPages.tsx:441,1241`, `expenses/SubstituteReceiptWizardPage.tsx:410` — history list + category maps
- `employee-access/AddEmployeePrototypePage.tsx:267` — step 1 renders with empty role/branch chips; gate step body on the `Promise.allSettled` load

Already correct — do NOT touch: `system-partners/*` (animate-pulse skeletons),
`crm-inbox/*`, `ai-suggestions`, `auth/*`, `account-security`, `procurement`,
banking list panels, inventory list/detail.

### 3.2 L3 — mutation in-flight gaps (freely double-clickable)

Severe — double-click creates duplicate records/journal entries. Root-cause
rule (ponytail): where a shared action helper exists, add ONE busy state to the
helper and disable every button it feeds — do not patch per button.

| File | Fix at |
|---|---|
| `features/accounting-documents/AccountingPages.tsx:405` | `run` helper has NO busy at all — add `busy` state to it; buttons at :553–562 (submit/approve/reject/issue/convert ×2/credit-note/debit-note/void) all disable on it; payment form :612–634 and counterparty form :670–681 get the same flag |
| `features/banking/BankingPages.tsx:232` | `ReconciliationList.handleCreate` — add `creating` flag exactly like the two sibling lists already have (:85, :337 pattern) |
| `features/inventory/InventoryPages.tsx:440,459` | `LocationsPageClient` `submit` + `qr` — same `busy` idiom as `ProductDetailPageClient` |

Moderate — duplicate state transitions / racing optimistic updates:

| File | Sites |
|---|---|
| `features/tax/TaxWorkspacePage.tsx` | `handleMarkFiled` :147, `handleMarkPaid` :157, `handleGenerateReport` :167, `handleExport` :181 (4 export buttons) — one `busyAction` string state covers all |
| `features/dashboard-notifications/NotificationPages.tsx` | `handleMarkAllRead` :60, `handleMarkRead` :50, `handleDismiss` :55, `toggleRule` :273 |
| `features/tax/TaxCodeSettingsPage.tsx:194–195` | `disabled={busy}` is decorative — the inline activate handler and `retireProfile` never SET busy; wire them |
| `features/tax/TradeTaxEvidencePage.tsx:96` | `verify()` — busy per evidence id |
| `features/expenses/ExpensesWorkspacePanels.tsx:132,324` | `runUpdate` and `doAction` helpers have no busy — fix in the helpers (feeds :184,:191,:233,:354,:361,:391) |
| `features/crm-inbox/InboxPage.tsx` | `assignToMe` :412, `changePriority` :387, `changeStatus` :370 |
| `features/crm-inbox/InboxPrototypePage.tsx:454` | `assignToMe` |
| `features/workflow/WorkflowPages.tsx:285` | `runTest` — modal already has `busy`; use it |
| `features/employee-access/PermissionMatrixPrototypePage.tsx:210` | `handleDisable` |
| `features/reports/ReportsWorkspacePage.tsx:213,224` | `loadMoreRuns`, `downloadExport` |

Minor (fix only if trivially adjacent to other edits in the same file):
quiet-hours blur inputs (`NotificationPages.tsx:222,238`), refresh/retry
buttons without `disabled={loading}`.

Already fixed (Phase 7 + earlier) — do NOT re-touch: banking BankAccount/
Adjustment lists, inventory product pages, LineOaSettingsPage, PartnerDetail,
system-onboarding, accounting-tax-setup, procurement action buttons, AP
action/busy sites, reimbursements, expenses main pages, CRM booking/customer
pages, workflow (except runTest), auth, account-security, branch-settings,
employee-access main pages.

### 3.3 L2 — standardization sweep (mechanical, last)

1. Pattern `{loading ? <div className="text-sm text-gray-500">กำลังโหลด...</div> : (…)}`
   and early-return `if (loading) return <…>กำลังโหลด…</…>` (~47 sites across
   banking, procurement, accounts-payable, workflow, inventory, expenses, crm,
   employee-access, accounting-documents): replace the loading BRANCH ONLY with
   `<LoadingState label="กำลังโหลด..." />` when it fills a page/section/panel
   body. Keep the ad-hoc inline div where the context is a table row, chip, or
   single-line slot where a py-12 centered block would look wrong — judgment
   rule: if the loading branch currently occupies a block that later holds a
   table/card/form, use `LoadingState`; if it is inline text inside a row,
   leave it (just normalize the copy).
2. Copy normalization, whole `src/features` tree: `กำลังโหลด…` → `กำลังโหลด...`
   (ASCII three dots; 38-vs-16 majority) and `กำลังบันทึก…` → `กำลังบันทึก...`
   (breaks a 21/19 tie in favor of matching the loading rule). Domain-suffixed
   variants (`กำลังโหลดนโยบาย…` ฯลฯ) keep their suffix, same ellipsis swap.
3. English holdouts in workspace pages (`accounting-documents/AccountingPages.tsx`
   :167,180,182,359,404 `Loading...`/`Saving...`) → Thai (`กำลังโหลด...` /
   `กำลังบันทึก...`). `/system/*` pages KEEP English per the standing rule.
4. Do not migrate the 4 `animate-pulse` skeletons in `system-partners` — they
   are deliberate upgrades, not drift.

## 4. Verification gates (per phase)

1. `corepack pnpm --filter @watchdog-bms/contracts build` (fresh clones only)
2. `corepack pnpm --filter @watchdog-bms/web typecheck`
3. `cd apps/web && CI=true npx tsx --test "src/**/*.spec.ts"` — 0 fail
   (baseline 755; `node --import tsx --test` fallback if npx IPC is blocked)
4. `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build`
5. E2E `toast-feedback.spec.ts` on the host when the stack is available
   (ports 3000/3001 may be held by ssh tunnels — check first).

## 5. Out of scope

- No `loading` toast tone; in-flight feedback lives on the controls.
- No new dependencies; toast stays hand-rolled.
- Unmounted/mock pages (`crm/BroadcastPrototypePage.tsx`,
  `mangmee-prototype/MangmeeModulePrototypePage.tsx`, unmounted
  `crm-inbox/InboxPage.tsx`) stay untouched.
- No skeleton-screen system — `LoadingState` spinner is the standard; skeletons
  are a separate future decision.
