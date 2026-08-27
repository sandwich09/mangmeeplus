# Agent Memory: Mangmee capture-first delivery scope

Status: SCOPE MERGED via PR #282 at `d2b40f37`; progress rechecked 2026-08-27 against develop `11153296` after P24/partner-copy and sales/vendor/expense capture PRs #283–287. Not full-product completion or production acceptance.
Owner: User scope decision; Codex execution.
Scope: Keep current non-subscription delivery, but collect income/expense data and documents before reconciliation/integrations.

Decisions:

- User explicitly deferred bank/Marketplace connections, Revenue Inbox/Matching and reconciliation. P15–P17, P18–P20 and matching-dependent revenue auto-accounting are not current release/main gates, including preparatory foundation/harness work.
- In context, the external-connector group includes POS/Partner API; this does not remove purchase-order documents or purchase/payment capture. Do not change those internal journeys based on the abbreviation “PO”.
- Manual/OCR-assisted capture, source documents, recorded receipts/payments, accurate amounts, permission/tenant isolation, audit, review and existing explicit confirmation boundaries remain. No bank match is required to save a normal income/expense document; no automatic revenue/VAT/journal from bank inflows is introduced.
- Keep existing merged code/data/entitlements intact. This is a delivery-scope change, not authorization to delete history, turn off existing company features or change accounting policy.
- P15-0 worktree `mangmeeplus-p15-foundation`, branch `codex/p15-revenue-classification-read-model`, HEAD `086a4549`, remains uncommitted/unpushed/unmerged. Preserve tests and proposed migration; do not apply it to shared/live DB or integrate it just because it was already written.
- P9 PR #281 merged after CI 33032595709 success at `d33f8d2eaff629d6a4e1660ce6232f04b39d6246`; OCR PR #280 and P27 phases 0–6 are already on develop. No main merge or cloud action occurred.
- P24-2a shared-shell correction merged via PR #283 at `b98e500f`, CI `33034949214` SUCCESS. Final scoped E2E16/16, mobile3/3, sidebar5/5, web1125/1125 and five tracked JPEG supersede the first 10/12 run; final Opus5 max follow-up APPROVE followed the corrected outline/width tests. Full P24 stays PARTIAL, not physical-device or 40+ human acceptance.
- Partner-copy PR #284 merged at `78057e38` / CI `33035656163` SUCCESS; sales-payment retry PR #285 merged `145924a3` / CI `33036847494` SUCCESS; vendor-bill capture PR #286 merged `21f109d5` / CI `33037405174` SUCCESS; expense-payment/date PR #287 merged `11153296` / CI `33039136161` SUCCESS. Final combined E2E33/33 (accounting6 + AP6 + expense21), zero skipped/flaky, ชุดตรวจ 128/128 รวม real PostgreSQL 6 เคส, web1139/1139 และ [tracked images/API proof](../evidence/expense-payment-capture-integrity/README.md) support the scoped capture delivery, not main/Production approval.
- P11 disabled-safe foundation remains an uncommitted candidate on `11153296`, no PR: root-recorded Opus5 max conditional APPROVE does not cover the subsequent explicit WEB_BASE_URL fallback correction now in progress. AI owner-summary correction is OPEN PR #288, head `70033af2`, CI `33040537029` still in progress; root local checks/independent review passed, not merged or live-provider accepted. LINE recovery PR #265 is held on five security findings and an unresolved one-time contract; see [progress audit](capture-first-progress-audit.md#pr265--security-hold-unmerged-branch-only). No new policy/owner decision is inferred.

Open questions:

- P27 VAT-unknown draft question has been sent asynchronously and still awaits an explicit Owner answer; no schema/policy is chosen. No decision about P28 credit/debit-note/approval policy, P10/P13 identity/security, accounting/tax reviewer, or live provider rollout was supplied by this scope change; active-scope gates remain unchanged.

Artifacts:

- Master index, four-lane gap closure plan, P15–17 spec and P18–20 contract carry the scope override; old future designs are retained.
- Separate retained P15 and [P24 task memory](p24-shared-shell-touch-targets.md) contain their exact tests/current limits; P15 remains deferred and unmerged, while P24-2a evidence is now tracked on develop.

Verification:

- Read-only GitHub check confirmed PR #281 MERGED and CI 33032595709 SUCCESS; production-image jobs were skipped as expected for this PR, not deployment evidence.
- Docs-only verification passed: six changed/new Markdown files, 109 relative links checked, zero missing targets; explicit deferred-scope assertions passed in the index, plan and both specs. `git diff --check` passed. No runtime/package/schema change or data mutation.
- Follow-up audit: read-only GitHub confirms PR #283 MERGED / CI `33034949214` SUCCESS and PR #284 MERGED / CI `33035656163` SUCCESS. The earlier six-file/109-link result belongs to the scope PR, not this follow-up; current audit checks are recorded separately.
- Refreshed read-only verification confirms PR #285 MERGED / CI `33036847494` SUCCESS on `b6f99079` and PR #286 MERGED / CI `33037405174` SUCCESS on `cfbd91d8`; exact merge IDs and evidence links are in the progress audit.
- Latest read-only verification confirms PR #287 MERGED at `111532966c415fee11abb36ca1749bf1fc66ee52`, 2026-08-27T04:36:17Z; CI `33039136161` SUCCESS on `179981a45f00a1d0b3a1898dce9f877f2457563e`. No runtime/DB/cloud change in this audit.

Next:

- Resume capture-focused income/expense/document and UX acceptance under the revised scope; do not reopen reconciliation or integrations without a new user request.
- Main remains gated by tests/CI/acceptance of the remaining active scope, not by the deferred features.
