# Agent Memory: Mangmee capture-first delivery scope

Status: SCOPE UPDATED 2026-08-27; docs-only branch from develop d33f8d2e; not a full-product completion or production acceptance.
Owner: User scope decision; Codex execution.
Scope: Keep current non-subscription delivery, but collect income/expense data and documents before reconciliation/integrations.

Decisions:

- User explicitly deferred bank/Marketplace connections, Revenue Inbox/Matching and reconciliation. P15–P17, P18–P20 and matching-dependent revenue auto-accounting are not current release/main gates, including preparatory foundation/harness work.
- In context, the external-connector group includes POS/Partner API; this does not remove purchase-order documents or purchase/payment capture. Do not change those internal journeys based on the abbreviation “PO”.
- Manual/OCR-assisted capture, source documents, recorded receipts/payments, accurate amounts, permission/tenant isolation, audit, review and existing explicit confirmation boundaries remain. No bank match is required to save a normal income/expense document; no automatic revenue/VAT/journal from bank inflows is introduced.
- Keep existing merged code/data/entitlements intact. This is a delivery-scope change, not authorization to delete history, turn off existing company features or change accounting policy.
- P15-0 worktree `mangmeeplus-p15-foundation`, branch `codex/p15-revenue-classification-read-model`, HEAD `086a4549`, remains uncommitted/unpushed/unmerged. Preserve tests and proposed migration; do not apply it to shared/live DB or integrate it just because it was already written.
- P9 PR #281 merged after CI 33032595709 success at `d33f8d2eaff629d6a4e1660ce6232f04b39d6246`; OCR PR #280 and P27 phases 0–6 are already on develop. No main merge or cloud action occurred.
- P24 shared-shell work remains in a separate worktree. Its first new browser suite returned 10/12 pass with two desktop collapse assertions needing investigation of existing hover behavior; it is not CI/merge-ready yet. Real Chrome measured the scoped buttons at 44px on desktop/tablet/mobile; local screenshots remain with that worktree.

Open questions:

- No decision about P28 credit/debit-note/approval policy, P10/P13 identity/security, accounting/tax reviewer, or live provider rollout was supplied by this scope change; active-scope gates remain unchanged.

Artifacts:

- Master index, four-lane gap closure plan, P15–17 spec and P18–20 contract carry the scope override; old future designs are retained.
- Separate retained P15 and P24 task memories contain their exact worktree/tests/current limits.

Verification:

- Read-only GitHub check confirmed PR #281 MERGED and CI 33032595709 SUCCESS; production-image jobs were skipped as expected for this PR, not deployment evidence.
- Docs-only verification passed: six changed/new Markdown files, 109 relative links checked, zero missing targets; explicit deferred-scope assertions passed in the index, plan and both specs. `git diff --check` passed. No runtime/package/schema change or data mutation.

Next:

- Resume capture-focused income/expense/document and UX acceptance under the revised scope; do not reopen reconciliation or integrations without a new user request.
- Main remains gated by tests/CI/acceptance of the remaining active scope, not by the deferred features.
