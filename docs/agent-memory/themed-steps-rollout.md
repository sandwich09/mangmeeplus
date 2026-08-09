# Agent Memory: themed-steps-rollout

Status: COMPLETE + VERIFIED (2026-08-08). Owner supplied a reference design
(rounded-square nodes on a horizontal track) and asked for every step
indicator in the system to match it.
Owner: Claude
Scope: Web-only. New shared `ThemedSteps` + swap of all 4 real progress
steppers. Explainer strips (ExpensesUi `HowItWorks`, PoApprovalSettingsPage
`DemoTimeline`, ReimbursementsPages approval-step status list) are NOT
progress indicators and were left alone on purpose.

Decisions:
- `apps/web/src/common/components/steps/ThemedSteps.tsx`: node = h-10 w-10
  rounded-xl — done: brand-500 + white check svg; current: brand-500 + inner
  white square + `ring-4 ring-brand-100` halo; upcoming: gray-200 outline +
  gray square; attention: warning outline + ⚠ (kept for the review page's
  flagged-step semantics). Connector halves are absolutely positioned per
  flex-1 column (`w-[calc(50%-1.625rem)]` at `top-5`) so labels stay centered
  under nodes; the half after a done node is brand-500, after the current node
  `bg-linear-to-r from-brand-500 to-gray-200` ("in progress" fade), else gray.
- API: `steps: {key, label, description?, state, href?, onSelect?, disabled?}`
  — caller computes state ('done'|'current'|'upcoming'|'attention'); href →
  Link, onSelect → button, neither → static. aria-current="step" from
  state === 'current' only.
- Swapped sites:
  - ExpenseReviewPage guided strip (~:688) — active step maps to 'current'
    even when flagged; the attention look returns after the user moves on.
    Fragment import removed with the old markup.
  - SubstituteReceiptWizardPage journey stages (~:1755) — static (no click),
    kept `journey_label` aria-label.
  - AccountingTaxSetupPage `Stepper` — href-driven; steps before the active
    key now render as done (position-based, page tracks no completion);
    wrapped in `overflow-x-auto` with `min-w-[36rem]` for 5 Thai labels.
  - AddEmployeePrototypePage — replaced the step-button row AND the redundant
    gradient progress bar (`progressWidth` deleted).

Verification:
- typecheck ✓; unit ✓ 783/783 (3 new ThemedSteps.spec.ts tests: aria-current
  uniqueness + node states, connector colors incl. gradient, href/button
  rendering); build ✓. Baseline before this task was 772 + concurrent edits.

Next:
- [ ] Host E2E + commit (with toast v2 / themed-date / themed-file /
      manual-multi-item / permission-visibility work — all uncommitted)
