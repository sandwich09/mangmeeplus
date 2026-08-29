# Agent Memory: Main VAT-Included Navigation Review

Status: Main review complete on 2026-08-27; subsequently authorized implementation delivered to develop by `/root/wht_units_mixed_vat/zero_vat_persistence`. Code `abd3e47a9d9393ac8de17fc387c50c9329bb8138`, delivery tip `8c472324455ca51eb872326f20f17275c286af44`, included in parent-fetched develop `be7d58c644e31abd123501e0c06f3be0931076fd`. No live deployment or database change.

Owner: Current backlog review task.

Scope:

- User screenshot: an expense receipt for 25 baht, VAT รวมในราคา selected, effective rate labelled ยังไม่ระบุ, and disabled ถัดไป.
- Checked remote main again: `007dcba70376acb94aa5b55275840304cabd6f68`.
- No application changes or live environment inspection were authorized by this follow-up report. Existing WHT implementation continues independently in its own worktree.

Decisions:

- The screenshot is consistent with an unknown line VAT rate. `validateExpenseReview` raises `expenses.v_vat_rate_required` for an empty `lines[].vatRate` in VAT_INCLUDED/VAT_EXCLUDED; `ExpenseReviewPage` disables Next whenever the data-step error count is nonzero. The screenshot cannot rule out other errors in fields outside the visible area.
- Selecting VAT_INCLUDED changes only price mode; it does not set an assumed VAT rate. This is intentional under expense-receipt-upload-spec section 19g: unknown is neither 0% nor 7%.
- Main already has the visibility repair: `showsVatCard` is true for VAT_INCLUDED/VAT_EXCLUDED independently of SIMPLE capture policy. It shows the VAT source card below the mode and a line-rate control with a field-level error. This differs from the supplied screenshot layout, but does not prove which version the user's live environment serves.
- Main still does not implement 'choose inclusive price mode and immediately continue with no rate/evidence'. The footer provides a generic error count through the disabled button title; it does not automatically focus/scroll to the specific missing rate.
- Report the two states separately: hidden VAT controls are fixed in source; the missing-rate block remains. Do not remove it by silently guessing 7% or instruct the user to falsify the receipt as no-VAT.

Open questions:

- None required for this source-status report. Live reproduction would require identifying the actual environment/record; no deployment inference is made from main.

Artifacts:

- [Main field validation](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/expenses/expense-review-validation.ts#L140).
- [Main VAT visibility](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/expenses/ExpensesPages.tsx#L1220): source card at 1471; line-rate control/error at 1748-1775; validation-count callback at 1267.
- [Main Next button](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/expenses/ExpenseReviewPage.tsx#L594).
- Visibility expression introduced by `239ec625 feat(expenses): reconcile source VAT`, contained in audited main.

Verification:

- Existing main snapshot at `/tmp/mangmee-main-wht-vat.nbXuKs`; contracts were built from that snapshot in the preceding review.
- `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/expenses/expense-review-validation.spec.ts` — PASS, 27 tests, including included/excluded mode with unknown rate and explicit-rate cases.
- Source inspection verifies control visibility and the validation-to-Next connection. No browser reproduction, actual record/API-state inspection, or UAT/Production verification was performed.

Next:

- User explicitly requested implementation by an agent, branching from develop, testing, and pushing the completed result into develop while continuing backlog questions here.
- Prepared worktree: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-vat-included-navigation`; branch `codex/vat-included-navigation`; freshly fetched base `origin/develop` at `a53bb992`.
- New-agent spawn was rejected by the four-agent thread limit. `/root/wht_units_mixed_vat/zero_vat_persistence` safely handed off its previous work (179 tests passed) to the WHT owner, received this full implementation brief, and confirmed starting the separate navigation worktree. It will no longer edit the old WHT worktree. The 179-test result belongs to the old persistence subtask, not verification of this navigation fix.
- Coordinate shared files and integrate into develop serially with the WHT implementation. Neither agent may overwrite the other's changes or force-push. Refresh develop and rerun affected combined tests before delivery. Leave the dirty `plan` checkout and all other worktrees untouched; no deploy is authorized.

Implementation brief:

- Make the inclusive-price review journey usable end to end: required inputs visible in SIMPLE and full modes; valid rate/source evidence can save and advance; a 25-baht inclusive gross must remain 25 rather than adding VAT again.
- Unknown/inconsistent VAT must have a specific visible actionable reason and reachable input, not only a generic tooltip on a disabled Next button. Use existing interaction patterns for focusing the error or an adjacent actionable message; preserve permission, concurrency, save/retry, and confirmation boundaries.
- Do not silently assume 7%, infer tax treatment from the product label, weaken validation, or switch to NO_VAT to bypass the error. Existing section 19g policy remains authoritative unless the user explicitly changes it.
- Investigate whether valid amount-only source evidence is incorrectly blocked by client-side missing-line-rate validation before the server can derive it; fix only a verified in-scope mismatch with server/frontend parity.
- Do not duplicate WHT amount/unit or durable VAT-treatment features owned by the other agent. Coordinate overlap in `ExpensesPages.tsx`, `ExpenseReviewPage.tsx`, models, validation, and contracts before editing.
- Read AGENTS.md and ponytail FULL before code edits; scoped spec/plan first as needed. Use apply_patch, no package.json edits unless dependencies genuinely change, and maintain `docs/agent-memory/vat-included-navigation.md` in the isolated worktree.
- Add focused regressions for inclusive/exclusive switching, blank/known/zero rates, source amount where supported, and Next/save behavior. Run relevant tests/typechecks and a safe local browser interaction when feasible; record exact limitations otherwise. Never use a real customer's record as a mutating test.
- Commit only scoped files, push the feature branch, integrate to develop through normal non-force git/required PR protections, and verify remote containment. Report fix and final develop SHAs with verification evidence before marking delivered.
