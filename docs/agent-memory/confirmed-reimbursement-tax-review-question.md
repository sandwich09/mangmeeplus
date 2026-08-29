# Agent Memory: Confirmed reimbursement tax-review question

Status: DIAGNOSED from screenshot, develop source and read-only live UAT UI via the user's Chrome session.
Owner: Codex / root, 2026-08-29.
Scope: User asks what action is available for confirmed `EXP-202608-00002`, “เบิกคืนพนักงาน: sandwich”, with pending tax evidence and pending posting. Explanation only, no data/code/cloud changes authorized for this case.
Decisions:
- `ExpenseReviewPage.tsx` makes CONFIRMED records read-only, including receipt replacement and document review. Void requires its permission; journal generation is separately permission/state gated. Pending posting and pending tax review are different states.
- `MaterializeClaimExpensesService.buildItems` has created reimbursement projections with OTHER_EXPENSE_DOCUMENT, SUPPORTING_ONLY, NO_VAT, NON_CLAIMABLE and the source claim number since `7470a0a7` (2026-08-10), specifically because leaving NEEDS_REVIEW on an immutable confirmed projection is unresolvable.
- Screenshot is consistent with an older/inconsistent reimbursement projection, but the exact cause cannot be established from the screenshot alone. Check the source reimbursement and projection history before deciding any repair; do not invent source tax/document values or void/rebook automatically.
- `docs/specs/expense-confirmed-return-for-correction-spec.md` remains Proposed/not implemented; linked plan is blocked on sign-off. No return-for-correction action exists today.
Open questions: Exact historical projection/settlement failure and approved record-repair procedure. No database/history read or repair was authorized/performed; UI establishes the inconsistency but not the full historical cause.
Artifacts: Supplied screenshot; source references above.
Verification:
- Chrome expense URL supplied by owner: UAT company cmsn5m75e00dg1z5tggf420vy / expense cmsn8j8au00v91z5ta0n6wpio. CONFIRMED on 2026-08-10; pending posting, unreviewed VAT/document/tax evidence, missing reference, 289.00 unpaid; all review fields disabled. Only visible final action is void (not clicked).
- Reimbursements UI: RB-202608-00001 matches requester, 2026-05-27 date, health-check/welfare description, 289.00 and exact attachment name. Finance APPROVED; PAID, outstanding 0.00; cash payment RBPAY-202608-00001 recorded; all four signature roles signed on 2026-08-10. Signed-form upload list contains 0 files, separately from the four completed digital signatures. Only viewed the detail dialog; no mutation.
- The source claim is already paid while the matching expense projection says unpaid/unreviewed. User was told not to pay again or void/rebook casually. This is not a normal pending-review user action.
- No UAT/Production data changes, deployment, signature action or repair attempted.
Next: Explain that authorized historical projection/settlement reconciliation is required; current code already creates review-complete reimbursement expense projections. Do not promise a UI review/return action exists, infer a legal tax claim, or run the unscoped reconciler as a repair.
