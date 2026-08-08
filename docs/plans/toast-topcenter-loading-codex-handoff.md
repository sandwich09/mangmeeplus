# Toast v2 + Global Loading — Codex Execution Handoff

Read `docs/plans/toast-topcenter-loading-plan.md` first — it is the design
authority (§2 toast visual spec, §3 loading tables). This file tells you what
to do in each phase, the environment quirks of your sandbox, and the gate you
must pass before reporting done. Execute ONLY the phase named in your kickoff
prompt. Phases are independent except where noted; run them in order A → D.

## Environment contract (read every phase)

- Repo root: current working directory. App: `apps/web` (Next 16, React 19,
  Tailwind v4, TypeScript strict).
- Your shell has NO bare `pnpm`. Use `corepack pnpm …`.
- Your sandbox CANNOT reach postgres — never run e2e or anything needing the DB.
- If typecheck reports `Cannot find module '@watchdog-bms/contracts'`, run
  `corepack pnpm --filter @watchdog-bms/contracts build` once and retry.
- Unit tests: run from `apps/web` with
  `CI=true npx tsx --test "src/**/*.spec.ts"` (if npx hits an IPC
  `listen EPERM`, use `CI=true node --import tsx --test "src/**/*.spec.ts"`).
  Baseline: **755 pass / 0 fail**. Your phase must keep 0 fail and only ADD tests.
- Typecheck: `corepack pnpm --filter @watchdog-bms/web typecheck`.
- Build check: `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build`
  (default Turbopack stalls in your sandbox; use exactly this).
- Do NOT edit any `package.json`, `pnpm-lock.yaml`, or `packages/contracts/*`.
  No new dependencies.
- Do NOT touch `e2e/`.
- Test files must be `.spec.ts` (NOT `.spec.tsx` — the glob won't match) and
  use `node:test` + `node:assert/strict`. React rendering in specs via
  `renderToStaticMarkup` + `React.createElement` with `globalThis.React = React`
  and a dynamic `await import('./X')` — copy the idiom from the existing
  `apps/web/src/common/components/toast/toast-render.spec.ts`.
- UI copy: formal-professional Thai, verb-first, no emoji/casual particles.
  `/system/*` pages keep English.
- Keep diffs minimal: reuse existing patterns, no speculative abstractions,
  match surrounding code style. Do not reformat untouched code.
- A busy/loading state you add must ALWAYS be cleared in `finally` — never in
  the try body.

## Phase A — Toast v2 (top-center redesign)

Files: `apps/web/src/common/components/toast/Toast.tsx`,
`ToastProvider.tsx`, `toast.logic.ts`, `toast.logic.spec.ts`,
`toast-render.spec.ts`, `apps/web/app/globals.css`. Nothing else.

1. `toast.logic.ts` — add one pure helper:
   `export function visibleToasts(items: ToastItem[]): ToastItem[] { return [...items].reverse(); }`
   (newest first for a top-anchored stack).
2. `ToastProvider.tsx` — container div classes become exactly:
   `pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[100000] flex flex-col items-center gap-2 px-4`
   and the map iterates `visibleToasts(items)`. No other provider changes —
   timers, dedup, portal, context value all stay.
3. `Toast.tsx` — restructure the pill per plan §2.2:
   - Pill: `toast-enter pointer-events-auto flex w-fit max-w-[min(92vw,28rem)] items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-[0_12px_32px_-8px_rgba(16,24,40,0.18)]`
     + existing `TONE_CLASS[tone]` (tone surface classes UNCHANGED).
   - New `TONE_CHIP` record: success `bg-success-500/15 text-success-700`,
     warning `bg-warning-500/20 text-warning-700`, error
     `bg-error-500/15 text-error-700`. Glyph span becomes
     `flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] ${TONE_CHIP[tone]}`
     (keep `aria-hidden="true"` and the ✓ ⚠ ✕ glyphs).
   - Message span: `min-w-0 break-words pt-0.5 leading-5`.
   - Dismiss `IconButton`: add `-mt-0.5` to its className; everything else
     (aria-label, stopPropagation) unchanged.
   - `role` mapping unchanged (`alert` for error, `status` otherwise).
4. `app/globals.css` — inside the EXISTING
   `@media (prefers-reduced-motion: no-preference)` block, replace the
   `toast-in` keyframes + class with:
   ```css
   @keyframes toast-in {
     from { opacity: 0; transform: translateY(-0.625rem) scale(0.97); }
     to { opacity: 1; transform: translateY(0) scale(1); }
   }
   .toast-enter { animation: toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1); }
   ```
   The class NAME `.toast-enter` must not change (e2e selects on it).
5. Specs:
   - `toast.logic.spec.ts` — add a `visibleToasts` case: 3 items in, reversed
     order out, input array not mutated.
   - `toast-render.spec.ts` — keep the tone-surface and role assertions; add
     assertions for `bg-success-500/15` / `bg-warning-500/20` /
     `bg-error-500/15`, `rounded-2xl`, and `max-w-[min(92vw,28rem)]` in the
     rendered markup. Update any assertion that the old layout classes
     (`items-center`, `rounded-xl`, `py-2.5`) break.
6. Verify in the build output CSS that `bg-success-500/15` produced a
   `color-mix(...)` background (same check the original plan did for
   `border-error-500/20`). If a chip class produces nothing, fall back to an
   inline `style={{ background: 'color-mix(in srgb, var(--color-success-500) 15%, transparent)' }}`
   per tone and note it in your report.

Gate: typecheck → unit 0 fail (≥755 + new) → webpack build. Report class
strings found in the generated CSS for the three chip classes.

## Phase B — initial-load gaps (plan §3.1)

Fix every row of the §3.1 high-impact table, then the lower-impact list.
Import `LoadingState` from `@/common/components/state` (check the barrel
`index.ts` export name first; import from the exact path used by
`reimbursements/ReimbursementsPages.tsx` if the barrel doesn't export it).

Rules:

- Reuse an existing `loading` flag if the component already tracks one that is
  simply never rendered; otherwise add `const [loading, setLoading] = useState(true)`
  set false in `finally`.
- Body slots: `{loading ? <LoadingState label="กำลังโหลด..." /> : (…existing…)}`.
- `WorkflowPages.tsx` modals (`RuleDetailModal` :252, `RunDetailModal` :379):
  replace the `if (!rule) return null` guard so the modal FRAME renders
  immediately with `<LoadingState label="กำลังโหลด..." />` as its body until
  the fetch lands. Keep the error path (if any) intact.
- `AccountsPayablePages.tsx` `ApprovalPolicyPanel` :226: the form must not
  render with default values while the real policy loads — spinner until data.
- `TaxReconciliationPage.tsx` / `TaxWorkspacePage.tsx` detail pane /
  `StatementImportPanel.tsx` history: loading branch replaces the fake empty
  state, so "ยังไม่มี..." shows only when the fetch RESOLVED empty.
- Selects with async options (`StatementImportPanel` :51, `MatchingPanel` :57,
  AP :61,:192): smallest diff — `disabled` while loading with a single
  `<option>กำลังโหลด...</option>` placeholder. Do not restructure the forms.
- `CrmPages.tsx:342` opportunity row: add a per-row busy id state; disable the
  row (`aria-busy`, `opacity-60 pointer-events-none` or `disabled` if it's a
  button) while `getCrmOpportunity` is in flight.
- `AddEmployeePrototypePage.tsx:267`: gate the step-1 body on the
  `Promise.allSettled` completion with `LoadingState`.

No new specs required for this phase (JSX branches only), but if a touched
file has an existing render spec, keep it green.

Gate: typecheck → unit 0 fail → webpack build.

## Phase C — mutation in-flight gaps (plan §3.2)

Root-cause rule: when a shared helper feeds several buttons, add ONE busy
state in the helper and disable all its buttons — never per-button patches.
Always clear in `finally`. Busy label idiom:
`{busy ? 'กำลังบันทึก...' : '<เดิม>'}` with a contextual verb where the action
isn't a save (กำลังส่ง... / กำลังสร้าง... / กำลังดาวน์โหลด...). English pages
(`/system/*`) use `Saving...` etc.

Work through §3.2 exactly:

1. `accounting-documents/AccountingPages.tsx` — `run` helper (:405): add
   `busy` state; every button routed through it (:553–:562) gets
   `disabled={busy}`; the payment form (:612–:634) and inline counterparty
   form (:670–:681) submit buttons get busy + label swap. This file is the
   double-record risk — treat it as the phase's core deliverable.
2. `banking/BankingPages.tsx` `ReconciliationList.handleCreate` (:232):
   replicate the `creating` flag from `BankAccountList` — the pattern is three
   siblings, two done, one missed.
3. `inventory/InventoryPages.tsx` `LocationsPageClient` `submit` (:440) + `qr`
   (:459): same `busy` idiom as `ProductDetailPageClient` in the same file.
4. `tax/TaxWorkspacePage.tsx`: one `busyAction: string | null` state covering
   mark-filed, mark-paid, generate-report, and the 4 export buttons; each
   button disables when `busyAction !== null` and swaps its own label when it
   is the active one (idiom: `reports/ReportsWorkspacePage.tsx` `busyAction`).
5. `tax/TaxCodeSettingsPage.tsx` (:194–:195): the `busy` state exists but the
   activate/retire handlers never set it — wire `setBusy` into both.
6. `tax/TradeTaxEvidencePage.tsx` `verify` (:96): busy keyed by evidence id;
   both ยืนยัน/ปฏิเสธ buttons of that row disable.
7. `expenses/ExpensesWorkspacePanels.tsx`: add busy to the `runUpdate` (:132)
   and `doAction` (:324) helpers; controls at :184,:191,:233,:354,:361,:391
   disable on it.
8. `dashboard-notifications/NotificationPages.tsx`: busy for `handleMarkRead`,
   `handleDismiss`, `handleMarkAllRead`, `toggleRule` (per-notification id for
   the row actions; a single flag for mark-all).
9. `crm-inbox/InboxPage.tsx` (:370,:387,:412) + `InboxPrototypePage.tsx`
   (:454): busy on status/priority/assign actions; menu items disable while
   in flight.
10. `workflow/WorkflowPages.tsx` `runTest` (:285): use the modal's existing
    `busy` state.
11. `employee-access/PermissionMatrixPrototypePage.tsx` `handleDisable`
    (:210): busy + label swap.
12. `reports/ReportsWorkspacePage.tsx` `loadMoreRuns` (:213) /
    `downloadExport` (:224): extend the existing `busyAction` union.

Do NOT touch the files listed as already-fixed in plan §3.2.

Gate: typecheck → unit 0 fail → webpack build.

## Phase D — standardization sweep (plan §3.3)

1. Loading-branch upgrades (~47 sites, dirs listed in §3.3): swap the loading
   BRANCH to `<LoadingState label="กำลังโหลด..." />` only where it fills a
   block that later holds a table/card/form. Inline single-line contexts keep
   their div (copy normalized). When in doubt, leave the structure and only
   normalize copy — this phase must not change component structure.
2. Copy normalization across `apps/web/src/features/**`:
   - `กำลังโหลด…` → `กำลังโหลด...` (keep domain suffixes, swap ellipsis only)
   - `กำลังบันทึก…` → `กำลังบันทึก...`
   - Same swap for other `กำลัง…` in-flight labels using U+2026.
   - `accounting-documents/AccountingPages.tsx` English holdouts
     (:167,:180,:182,:359,:404) → Thai. `/system/*` files keep English.
3. Leave `system-partners` skeletons and all `common/` components untouched.
4. Sweep check before reporting: `grep -rn "กำลังโหลด…\|กำลังบันทึก…" apps/web/src/features`
   must return zero rows.

Gate: typecheck → unit 0 fail → webpack build.

## Reporting format (every phase)

Report: files touched (count + list), the gate command outputs (last lines),
any deviation from this handoff with one-line justification, and anything you
found mid-phase that belongs in a later phase (do not fix it early).
