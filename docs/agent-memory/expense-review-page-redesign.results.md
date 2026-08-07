# Expense Review Page Redesign — Results

## Phase 1 — Pure logic: 3-step model + validation module

Status: COMPLETE 2026-07-31. Phases 2–4 not started.

Files touched:

- `apps/web/src/features/expenses/expenses.model.ts`
- `apps/web/src/features/expenses/expense-review-steps.logic.spec.ts`
- `apps/web/src/features/expenses/expense-review-validation.ts` (new)
- `apps/web/src/features/expenses/expense-review-validation.spec.ts` (new)
- `apps/web/src/features/expenses/ExpensesPages.tsx` (mechanical Phase 1 key references and panel merge only)
- `docs/agent-memory/expense-review-page-redesign.results.md` (this report)

Decisions and design checks:

- `initialExpenseReviewStep` needed no explicit no-attachment guard: complete `data` plus missing receipt evidence naturally makes `evidence` the first non-done step, and the retained test passes.
- `hasAiGrandTotalMismatch` was not reused because it intentionally uses a 0.05 reconciliation tolerance; Phase 1 requires 0.01. The new validation module keeps the 0.01 comparison in one pure helper.
- The computed-total helper mirrors the existing expense server arithmetic: per-line satang rounding, default 0.07 VAT rate when a VAT mode has no entered rate, VAT-included/excluded handling, and WHT excluded from grand total.
- The Phase 1 validation literals are declared locally and cast to the required `DictionaryKey` field type until Phase 2 adds those literals to the dictionary union.
- The `evidence` and `review` step-state expressions, `initialExpenseReviewStep` body, permission gates, terminal actions, and non-guided layout were not changed.
- No design-plan contradiction found.

Verification:

Exact command attempted:

```text
$ corepack pnpm --filter @watchdog-bms/web test
Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/54156.pipe
    at Server.setupListenHandle [as _listen2] (node:net:1926:21)
  code: 'EPERM',
  syscall: 'listen',
Node.js v24.14.0
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/web@0.1.0 test
Exit status 1
```

Setting `TMPDIR=/private/tmp` produced the same `listen EPERM`, confirming the sandbox blocks the `tsx` CLI IPC socket rather than the selected temp directory. Equivalent non-IPC fallback over the same `src/**/*.spec.ts` set:

```text
$ rg --files src -g '*.spec.ts' | sort | xargs node --import tsx --test
ℹ tests 593
ℹ suites 147
ℹ pass 593
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1284.57875
```

Exact command:

```text
$ corepack pnpm --filter @watchdog-bms/web typecheck
> @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

Deviations:

- Verification only: the exact `pnpm ... test` command could not start because this sandbox rejects the Unix IPC socket opened by the `tsx` CLI. The same complete spec set passed via `node --import tsx --test`; no test selection was reduced.
- No implementation deviations.

Next: stop for the Phase 1 gate. Do not begin Phase 2 until explicitly requested.

## Phase 2 — Shared InfoTip + dictionary keys

Status: COMPLETE 2026-07-31. Awaiting gate; phases 3–4 not started.

Files touched:

- `apps/web/src/common/components/field/InfoTip.tsx` (new)
- `apps/web/src/common/components/field/index.ts`
- `apps/web/src/common/i18n/workspace-dictionary.ts`
- `apps/web/src/features/expenses/ExpensesPages.tsx` (replace the two remaining legacy step dictionary references only)
- `apps/web/src/features/expenses/expense-review-validation.ts` (remove the Phase 1 `DictionaryKey` cast and temporary comment)
- `docs/agent-memory/expense-review-page-redesign.md`
- `docs/agent-memory/expense-review-page-redesign.results.md` (this report)

Decisions and design checks:

- `InfoTip` reuses both the existing `PopoverPanel` and `useCloseOnOutsideClick`; no positioning code or dependency was added.
- The button is touch-click toggleable, keyboard focusable, hover/focus openable, and closes on blur, mouse leave, Escape, and outside pointer press.
- Tooltip content is rendered as a React text node with no HTML injection.
- All requested Phase 2 keys, including `expenses.v_blocking_count`, exist in both locales. The Thai tooltip copy matches plan §5 verbatim; English equivalents are natural translations.
- `expenses.step_document`, `expenses.step_document_helper`, `expenses.step_details`, and `expenses.step_details_helper` were deleted only after their remaining two callers were moved to `expenses.step_data` and `expenses.step_data_helper`.
- With the dictionary literals now included in `DictionaryKey`, validation issues assign `messageKey` directly without a cast.
- No Phase 3 or Phase 4 implementation was started.

Verification:

Initial typecheck attempt exposed the repo's lack of a global `JSX` namespace:

```text
$ corepack pnpm --filter @watchdog-bms/web typecheck
Generating route types...
✓ Types generated successfully
src/common/components/field/InfoTip.tsx(7,76): error TS2503: Cannot find namespace 'JSX'.
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/web@0.1.0 typecheck
Exit status 2
```

`InfoTip` now imports React's `JSX` type explicitly. Final verification follows.

Exact command:

```text
$ corepack pnpm --filter @watchdog-bms/web typecheck
> @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

Complete sandbox-safe test command and output tail:

```text
$ cd apps/web && rg --files src -g '*.spec.ts' | sort | xargs node --import tsx --test
ℹ tests 597
ℹ suites 147
ℹ pass 597
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1265.331416
```

Locale parity command and output:

```text
$ node --import tsx --input-type=module -e "import { workspaceDictionary } from './apps/web/src/common/i18n/workspace-dictionary.ts'; const th=Object.keys(workspaceDictionary.th); const en=Object.keys(workspaceDictionary.en); const thOnly=th.filter((key)=>!en.includes(key)); const enOnly=en.filter((key)=>!th.includes(key)); console.log({th:th.length,en:en.length,thOnly,enOnly}); if(thOnly.length||enOnly.length) process.exit(1)"
{ th: 907, en: 907, thOnly: [], enOnly: [] }
```

Legacy-key check:

```text
$ rg -n "step_document|step_details" apps/web e2e
# no output
```

Deviations:

- Verification only: as explicitly directed for this sandbox, the `corepack pnpm --filter @watchdog-bms/web test` wrapper was not retried because its `tsx` CLI IPC socket is known to fail with `EPERM`. The sandbox-safe command ran the same complete `src/**/*.spec.ts` set and passed 597/597.
- No implementation deviations.

Next: stop for the Phase 2 gate. Do not begin Phase 3 until explicitly requested.

## Phase 3 — The page: route conversion + layout

Status: COMPLETE 2026-07-31. Awaiting gate; Phase 4 not started.

Files touched:

- `apps/web/src/features/expenses/ExpenseReviewPage.tsx` (new)
- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/src/features/expenses/expenses.model.ts` (stale deleted-component comment only)
- `apps/web/app/(workspace)/companies/[companyId]/expenses/[expenseId]/page.tsx`
- `e2e/expenses.spec.ts`
- `docs/agent-memory/expense-review-page-redesign.md`
- `docs/agent-memory/expense-review-page-redesign.results.md` (this report)

Decisions and design checks:

- The existing `ExpenseDetailModal` component was mechanically copied as one contiguous block,
  renamed to `ExpenseReviewPage`, and only then adapted at its props and shell boundaries. No hook,
  effect, ref, handler, derived flag, or named section block was dropped.
- The handoff-approved smaller-diff helper option was used: existing helpers/section components in
  `ExpensesPages.tsx` were exported rather than moving the two large section implementations.
- The page derives `expenseCapabilities(permissions)`, reads and removes its extraction notice from
  `sessionStorage`, and uses a back button that calls `router.push` to the expense list.
- The viewer is a sticky `4fr/5fr` desktop column with its own scroll; the mobile attachment strip,
  viewer rendering/fallbacks, and transient full-screen preview modal are unchanged.
- The `อ่านอีกครั้ง` control moved verbatim from the footer into the `data` step's existing
  `CoverLoader`, as required. All terminal-action conditions, handlers, disabled expressions, and
  title strings compare byte-identically with HEAD.
- Non-guided order remains: notices → posting → audit → money → vendor → document review → price
  mismatch → AI data → duplicates → payment. The legacy navigation chips remain above that
  continuous-scroll view; they are not a stepper and preserve existing section navigation.
- Full-file `ExpensesPages.tsx` diff audit: every hunk is an export needed by the mechanical modal
  extraction, modal/list selection removal, or hub canonical-route navigation. `EXPENSES_TABS`,
  `EXPENSES_TAB_ROUTES`, `TAB_META`, `canAccessExpenseTab`, the forbidden-state branch, and all
  non-list tab permission-protected renders are unchanged.
- EXP-04 changed only the requested step-tab name from `ผู้ขายและรายการ` to `ตรวจข้อมูล`; EXP-03 and
  EXP-04 retain `?expenseId=` so they exercise the compatibility redirect.
- No Phase 4 validation/provenance/tooltip/rate-echo wiring was started.

Verification:

Final typecheck:

```text
$ corepack pnpm --filter @watchdog-bms/web typecheck
> @watchdog-bms/web@0.1.0 typecheck .../apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

Exact test command (sandbox IPC failure):

```text
$ corepack pnpm --filter @watchdog-bms/web test
Error: listen EPERM: operation not permitted .../tsx-501/56531.pipe
  code: 'EPERM',
  syscall: 'listen'
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/web@0.1.0 test
Exit status 1
```

Complete sandbox-safe test fallback:

```text
$ cd apps/web && rg --files src -g '*.spec.ts' | sort | xargs node --import tsx --test
ℹ tests 597
ℹ suites 147
ℹ pass 597
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1330.563375
```

Exact build command reached compilation but did not terminate in the restricted sandbox:

```text
$ corepack pnpm --filter @watchdog-bms/web build
▲ Next.js 16.2.11 (Turbopack)
  Creating an optimized production build ...
```

The first invocation became detached from its captured tool session and continues to hold
`apps/web/.next/lock`; the sandbox denied a signal to that process. An isolated-distDir retry reached
the same compilation stage and was stopped after producing no further output. A webpack diagnostic
made the external blocker explicit:

```text
$ NEXT_DIST_DIR=.next-phase3-webpack corepack pnpm --filter @watchdog-bms/web exec next build --webpack
getaddrinfo ENOTFOUND fonts.googleapis.com
Failed to compile.
app/layout.tsx
`next/font` error:
Failed to fetch `IBM Plex Sans Thai` from Google Fonts.
app/layout.tsx
`next/font` error:
Failed to fetch `Outfit` from Google Fonts.
Exit status 1
```

Invariant audits:

```text
$ diff ... # static hub config (`EXPENSES_TABS` through `ExpensesHubPage`)
# no output
$ diff ... # permission/tab surfaces inside `ExpensesHubPage`
# no output
$ diff ... # all terminal action conditions/handlers/disabled/title lines, HEAD vs page
# no output
$ git diff --check
# no output
```

Required final checks:

```text
$ grep -rn 'ExpenseDetailModal\|selectedExpenseId' apps/web
# no output

$ git diff --stat
 .../[companyId]/expenses/[expenseId]/page.tsx      |  11 +-
 apps/web/src/common/components/field/index.ts      |   1 +
 apps/web/src/common/i18n/workspace-dictionary.ts   |  76 ++-
 apps/web/src/features/expenses/ExpensesPages.tsx   | 760 +--------------------
 .../expenses/expense-review-steps.logic.spec.ts    |  24 +-
 apps/web/src/features/expenses/expenses.model.ts   |   8 +-
 e2e/expenses.spec.ts                               |   2 +-
 7 files changed, 108 insertions(+), 774 deletions(-)
```

`git diff --stat` reports tracked diffs only; the new untracked Phase 1–3 files (including
`ExpenseReviewPage.tsx`) are visible in `git status --short` and were intentionally not staged.

Deviations:

- Verification only: the exact test wrapper cannot open its `tsx` IPC socket in this sandbox; the
  same complete 597-spec set passed through the established non-IPC runner.
- Verification only: the exact Turbopack build could not reach a terminal result in the
  network-restricted sandbox. The webpack diagnostic confirms the repository's root Google Fonts
  imports require unavailable DNS/network access. No source was changed to bypass production font
  loading.
- No implementation deviations.

Next: stop for the Phase 3 gate. Do not begin Phase 4 until explicitly requested.

## Phase 4 — Prefill verification: validation, provenance, tooltips

Status: COMPLETE 2026-07-31. Awaiting gate.

Files touched:

- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`
- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/src/features/expenses/expenses.model.ts`
- `apps/web/src/features/expenses/expenses.model.spec.ts`
- `apps/web/src/features/tax/TransactionTaxLineSelector.tsx`
- `apps/web/src/common/components/field/InfoTip.tsx`
- `docs/agent-memory/expense-review-page-redesign.md`
- `docs/agent-memory/expense-review-page-redesign.results.md`

Implementation and invariant checks:

- Fixed the Phase 3 SSR hydration defect by initializing `notice` to `null` and doing the
  `sessionStorage` read, removal, parse, and `setNotice` in one `useEffect([expenseId])`. There is
  no storage read in render and malformed/disabled storage remains caught.
- Replaced the viewer's independent `7rem`/`13rem` literals with one commented
  `REVIEW_STICKY_HEADER_REM` constant used by both `top` and viewport-height calculation.
- `ExpenseReviewEditSection` memoizes the existing pure `validateExpenseReview` result, renders
  issue lookups only, blocks its save before any API call when errors exist, and reports the error
  count to the existing page navigation. `goToStep` itself is unchanged.
- The data-step Next button is disabled for validation errors and uses the same localized blocking
  count as its title. Step-chip navigation still exercises the existing save-on-leave path.
- AI provenance uses one exported alias map (`AI_REVIEW_FIELD_KEYS`) and one tested pure lookup.
  A null `aiVerificationSummaryJson` returns no chip, hint, wrapper, or banner; the manual path's
  AI-specific rendered markup is unchanged.
- Guided mode uses the new prefill banner with status, instructional missing-field chips, and the
  existing extraction action. Non-guided mode still renders the original `aiDataBox` in its
  original section order.
- All eight §5 tooltip anchors are present. `DocumentReviewSection` changes are label markup only;
  its state, effects, handlers, substitute flow, and save logic are unchanged.
- VAT/WHT values remain the same controlled fraction strings. The tested formatter only produces
  display text and is never passed to `setValues` or `buildExpenseDraftReviewPayload`.
- Permission/capability expressions, terminal action conditions/handlers/disabled/title strings,
  hidden-not-unmounted panels, and non-guided section order were not changed.
- `git diff --check` passed. `git status --short` shows no staged entries; no `git add` or commit was
  run.

Verification tails:

```text
$ corepack pnpm --filter @watchdog-bms/web typecheck
> @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

```text
$ cd apps/web && rg --files src -g '*.spec.ts' | sort | xargs node --import tsx --test
ℹ tests 599
ℹ suites 147
ℹ pass 599
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1065.034792
```

Deviations:

- Phase 4's nominal two-file list was extended to `expenses.model.ts` and its existing spec. The
  handoff requires one exported provenance mapping, reuse of the AI-grand-total accessor, and pure
  tested behavior; centralizing those beside the existing expense model helpers avoids duplicating
  AI payload shapes in JSX.
- `TransactionTaxLineSelector.tsx` gained one optional `labelAddon` prop because it owns the Tax
  Code label. This places the required tooltip beside that label without duplicating it; all other
  call sites retain the same selector behavior.
- `InfoTip.tsx` gained the missing Escape handler. Phase 2's report claimed Escape support, but the
  actual component lacked it; the Phase 4 keyboard-reachability gate required correcting that
  omission.
- The Phase 4 harness lists a production build, but it was not rerun after this phase because this
  sandbox cannot fetch the repository's Google Fonts. The user independently supplied a successful
  Phase 3 build and confirmed the route is `ƒ` SSR-on-demand. Post-Phase-4 verification therefore
  used the explicitly requested typecheck plus the complete sandbox-safe test fallback.

No product, permission, validation-rule, workflow, or manual-path deviation was made. No design-plan
contradiction was found.

Next: stop for the Phase 4 gate. Do not stage or commit.
