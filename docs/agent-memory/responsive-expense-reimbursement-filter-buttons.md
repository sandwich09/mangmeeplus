# Agent Memory: responsive expense and reimbursement filter buttons

Status: Complete
Owner: Codex
Scope: Make the status filters on the expense list and reimbursement list equal-width and responsive without horizontal scrolling.
Decisions: Use the existing Tailwind grid utilities: 2 columns on narrow screens, 3 from `sm`, and 5 from `lg`. Keep existing labels, counts, state, colors, and 44px mobile touch targets.
Open questions: None.
Artifacts: `apps/web/src/features/expenses/ExpensesPages.tsx`; `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`
Verification: `corepack pnpm --filter @watchdog-bms/web typecheck` passed; scoped `git diff --check` passed. Browser preview using the production Tailwind classes passed at 390px (2 columns, 158px equal button widths, 44px touch height), 768px (3 columns, 223px equal widths), and 1280px (5 columns, 166px equal widths). At every size each grid's `scrollWidth` equalled its rendered width and the document did not overflow horizontally.
Next: Ready for owner review.
