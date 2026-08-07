# Agent Memory: expense-review-page-redesign

Status: SHIPPED.
- Original implementation: commit `933d0ecd` (17 files, +2642/-816), merged into
  `20260731` via PR #70 (merge commit `1c70f0ff`, 2026-08-01).
- Equivalent cherry-pick: commit `468000a0`, merged into `develop` via PR #71
  (merge commit `4a5f852e`, 2026-08-03).
- Re-verified on the `develop` base: web unit 619/619, typecheck, build, and
  e2e EXP-01..09 9/9.
- Owner decision: the work living on both branches is intentional; no revert of #70.
- During that re-verification, the local DB required nine then-pending migrations
  (`20260802100000_attempt_identity_lease` … `20260804120000_feature_launch_observation_bucket`)
  plus `prisma generate` before `e2e/run-local.sh` passed preflight.
Owner: Claude (harness engineer) → Codex CLI (executor) → Claude (per-phase gate).

Scope: `apps/web` review screen for `/companies/:companyId/expenses/:expenseId` + `e2e/expenses.spec.ts`.
No API, no contracts, no schema, no new dependency.

Decisions (full rationale in `docs/plans/expense-review-page-redesign-plan.md` §2):
- D1 The canonical deep link `/companies/:c/expenses/:e` becomes the real review page; the hub's
  `?expenseId=` redirects to it (it already redirected the other way, so no link contract changes).
- D2 One code path — `ExpenseDetailModal` is deleted; the page serves every status. Editable drafts
  get the wizard, everything else keeps today's continuous-scroll order.
- D3 Steps 4 → 3: `data` → `evidence` → `review`. The old `document` step was always `done` right
  after upload and showed no data; its AI content becomes a banner on `data`.
- D4 After AI finishes the user lands on `data` — the prefill-verification screen — with per-field
  AI provenance marks (`recognizedFields` → 🤖 chip, `missingFields` → amber "กรอกเอง" hint).
- D5 Receipt viewer becomes a sticky full-height left column (~1.6× its modal width).
- D6 New pure `validateExpenseReview()` (17 rules, `error` blocks / `warn` passes) + `node:test` spec.
- D7 New shared `InfoTip` built on the **existing** `PopoverPanel` — the repo had no tooltip at all.
- D8 VAT/WHT rate inputs keep fraction (0..1) storage; the mislabelled `หัก ณ ที่จ่าย (%)` is
  corrected and both fields gain a tooltip + a live `= 7%` echo. Percent-display-with-÷100-on-save
  was rejected: `TransactionTaxLineSelector` also writes `vatRate`, so two writers would have to
  agree on a unit.

Behaviour freeze (must survive byte-equivalent): `DocumentReviewSection` internals, `goToStep`
save-on-leave, `hidden`-not-unmounted panels, `deriveExpenseAuditChecks`, the substitute-receipt
flow, and every terminal action's condition/handler/`disabled`/`title`.

Defects caught at the gates (both were found by Claude, not by Codex's own tests):
1. Phase 1 — `computedGrandTotal` hand-rolled the VAT math and defaulted a blank `vatRate` to 0.07,
   while the repo's `calculateManualExpenseTotals` treats a blank rate as no VAT. Reproduced:
   `VAT_EXCLUDED`, 1 × 100, blank rate, AI total 100 → false "computed 107.00" mismatch warning —
   firing in the most common post-OCR state (no tax code picked yet). Fixed by reusing the existing
   helper. Codex's spec missed it because every case used `NO_VAT`.
2. Phase 3 — the extraction-notice `sessionStorage` read was moved from a `useEffect` into a
   `useMemo` that runs during render. The route builds as `ƒ` (SSR-on-demand), so server render
   emitted no banner and client hydration did → hydration mismatch on exactly the upload → AI →
   review journey. Fixed by restoring the `useEffect` pattern.

Resolved by owner 2026-08-01 — reviewer-trap question, option (a):
blocking `goToStep` on validation errors trapped a reviewer on a draft that fails validation
(e.g. AI read nothing: no vendor, no lines) because `ปฏิเสธ` renders only on the `review` step
(`ExpenseReviewPage.tsx:316,321`). Owner chose: stepper chips navigate freely, `ถัดไป` keeps its
block. Implemented as `goToStep(key, allowUnsaved = false)` — chips pass `true`, `ถัดไป`/`ย้อนกลับ`
do not. Safe because the step panels are `hidden`, not unmounted, so `ExpenseReviewEditSection`
stays mounted and its unsaved `values` and error banner survive the navigation. This restores the
"freely clickable step" behaviour settled in `expense-detail-stepper-ux`.

Artifacts:
- `docs/plans/expense-review-page-redesign-plan.md` — design source of truth
- `docs/plans/expense-review-page-redesign-codex-handoff.md` — 4-phase Codex harness
- `docs/agent-memory/expense-review-page-redesign.results.md` — Codex's per-phase report

Verification (Claude re-ran every gate command outside Codex's sandbox — Codex is blocked from the
`tsx` IPC socket and from fetching Google Fonts, so its own build/test runs were fallbacks):
- `corepack pnpm --filter @watchdog-bms/web test` → 599 tests, 147 suites, pass 599 / fail 0
- `corepack pnpm --filter @watchdog-bms/web typecheck` → clean
- `corepack pnpm --filter @watchdog-bms/web build` → compiled successfully;
  route emitted as `ƒ /companies/[companyId]/expenses/[expenseId]` (server-rendered on demand)
- `grep -rn 'ExpenseDetailModal\|selectedExpenseId' apps/web` → no hits
- Full-file `git diff` of `ExpensesPages.tsx` reviewed: hunks confined to the modal removal, the
  hub navigation change, and the Phase 4 form wiring; `ExpensesHubPage` tab routing, `EXPENSES_TABS`
  and permission gating untouched; non-guided section order byte-matches HEAD.

Live-stack verification 2026-08-01 (native postgres :5432, colima + compose MinIO :19000,
Playwright webServer api :3001 / web :3000):
- `S3_E2E=1 e2e/run-local.sh e2e/expenses.spec.ts` → **EXP-01..09 all 9 pass, 0 skipped.**
- Local DB was one migration behind the branch; applied
  `20260801130000_feature_launch_control_plane_additive` + `prisma generate` to bring it to head.
- A throwaway 7-case browser spec (created, run, then deleted) covered: canonical URL renders with
  no dialog, `?expenseId=` redirect, sticky geometry, chip escape hatch, tooltip open/Escape,
  inline validation, mobile no-horizontal-overflow. All 7 green at the end.

Two defects found by the browser pass that every prior gate had missed:
3. **The sticky stepper was invisible.** `sticky top-0` pinned it *underneath* `AppHeader`
   (`sticky top-0 z-[99999] h-[68px]`), so the "you are here" rail vanished the moment the user
   scrolled — the exact opposite of its purpose. Screenshots caught it; the first geometry test did
   not, because `document.querySelector('.sticky.top-0')` matched **AppHeader itself**, so the test
   compared the app header against the viewer and passed green. Lesson: never select a sticky
   element by its offset class in a page that has app chrome — select by content it owns.
   Fixed with measured constants (`APP_HEADER_REM` 4.25 = 68px, `STEPPER_REM` 4.5 = 72px,
   `VIEWER_TOP_REM` = sum, `VIEWER_BOTTOM_GAP_REM` 6). Verified: header bottom 68 → stepper
   68–140 → viewer top 140, viewer bottom 804 of 900. The replacement assertion checks the stepper
   clears the app header, so this cannot regress silently.
4. **Back-to-list was a `<button>` + `router.push`** although it navigates to another URL — no
   cmd/middle-click, no visible target, announced as an action. Now a `next/link` `<Link>`; the
   then-dead `onClose` was deleted.

Measuring caveat for future geometry tests: a `position: sticky` box is clamped by its own
container's bottom edge, so a short form measures the end-of-container state, not the pinned state.
Test with enough content (12 lines) and a modest scroll.

Deep verification pass 2026-08-01 (throwaway 19-case browser spec, run then deleted):
- **DEEP-A (validation, 6 cases)** — every blocking rule renders its own message, disables `ถัดไป`,
  and recovers when corrected: vendor required / >200, tax id 13 digits (separators accepted),
  doc number >50, future date blocks, >5y old only warns, description required, quantity > 0,
  unit price ≥ 0, discount ≤ line total, VAT and WHT rate fraction range, zero total warns only,
  and the rate echo renders `= 7%` / `= 3.5%` without ever writing back into the field.
- **DEEP-B (AI prefill, 3 cases)** — with a seeded `aiVerificationSummaryJson`, the banner, the
  `ต้องกรอกเอง` chips, the 🤖 provenance marks and the per-field `AI อ่านไม่ได้` hints all render;
  a manual expense (null summary) renders none of them; an AI-total mismatch warns with both
  numbers and does not block.
- **DEEP-C (3 cases)** — CONFIRMED / REJECTED / VOIDED each render the continuous-scroll nav chips
  with no wizard and no `ถัดไป`.
- **DEEP-D (2 cases)** — ACCOUNTANT (read-only) sees the record with no wizard and no edit actions;
  STAFF cannot edit another user's draft.
- **DEEP-E (3 cases)** — 4 tooltips on the data step and 3 on the evidence step all open, carry
  real copy, and close on Escape; invalid fields carry `aria-invalid`; the active step carries
  `aria-current`.
- **DEEP-F (2 cases)** — leaving the data step persists edits (verified by re-reading the API);
  a validation-blocked save leaves the backend untouched even when the chip escape hatch navigates.
Result 19/19. Three initial failures were all defects in the throwaway spec, not the product
(a 12-digit tax id typo, a missing vendor fill that confounded "warn does not block", and
`input[type=date]` — `ThemedDate` is a button + calendar popover, so dates must be seeded).

Regression proof: full suite = 115 passed / 11 failed / 4 skipped. Stashing this work and re-running
the 5 affected spec files at HEAD gave **9 failed / 22 passed**, and re-running the identical scope
with the work restored gave **9 failed / 22 passed** — byte-identical. The 9 (bookings, settings,
sidebar-nav, `_roles-reference`) pre-exist on this branch; `SET-01` for instance fails on a strict-mode
violation from a new `การตั้งค่าขั้นสูง` heading, unrelated to expenses. The 2 extra
(`BOOK-01`, `AUTON-02`) pass in isolation both with and without the work — full-suite load flakes.
**No regression is attributable to this change.**

Caution for anyone repeating that comparison: `git stash pop` aborted on untracked `test-results/`
collisions and restored only the untracked files, silently leaving every tracked edit at HEAD.
Keep an independent `git diff > patch` backup and re-apply with
`--exclude='apps/web/next-env.d.ts' --exclude='test-results/*'`.

Next: nothing blocking. Optional — an OCR-configured walkthrough so the prefill banner is driven by
a real Typhoon read rather than a seeded summary (the local stack has no key, so
`requestExpenseExtraction` returns `not_configured`).
