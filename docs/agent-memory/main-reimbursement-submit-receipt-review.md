# Agent Memory: Main reimbursement submit and receipt review

Status: Closed. Notification-only fix delivered to develop by `/root/reimbursement_receipt_error_notification`: code `a4bdfedbdfed96c098d9e52315188c99059c76d5`, delivery `3b8bfd137db0786441874214acce9a41eb5c2137`; 363 tests and web typecheck passed. The separate second-click/waived-receipt-flow issues were not changed by that agent, but the user explicitly confirms on 2026-08-27 that they already fixed them. Do not list those as pending. Their separate fix's commit/deployment has not been independently verified; no live deployment is claimed.

Owner: Current backlog review task for evidence/coordination; `/root/reimbursement_receipt_error_notification` for the notification-only fix, tests, and develop integration.

Scope:

- User reports that a second click works and that ส่งอนุมัติ reports missing receipt evidence or reason.
- Screenshot shows a draft with two unevidenced lines (560 + 120 = 680 THB), a saved claim-level missing-receipt reason, REQUIRED receipt status, and both a generic reload toast and a receipt-specific inline error.
- Source baseline: `007dcba70376acb94aa5b55275840304cabd6f68` (`origin/main`, unchanged after fetch). Root `plan` checkout is not the source baseline.
- Read-only source/test diagnosis. No live UAT/browser session, deployed revision, database, policy, feature-gate, permission, or deployment changes. Only this memory and an isolated temporary diagnostic test were added.

Decisions:

1. Main already has policy-specific draft readiness, introduced by `48c2746f fix(reimbursements): normalize receipts and reuse saved signatures`. `reimbursementSubmitReadiness` blocks REQUIRED drafts before submit; detail shows a visible explanation and an edit action. It explicitly says a reason cannot replace a receipt when the policy disallows it. Detail GET recomputes draft receipt state with the current company policy instead of trusting a stale persisted status.
2. A claim-level reason already covers several unevidenced lines when `allowMissingReceiptWithReason` is true. With the pictured two empty evidence rows and reason `โอนจ่าย`, the domain returns MISSING_WITH_REASON if allowed, but REQUIRED/missing_receipt under a strict policy. The presence of text in the reason field alone therefore does not prove an erroneous rejection. Actual company policy must not be guessed or changed from the screenshot.
3. Main still has a reproducible shared-toast defect: `SubmitReimbursementUseCase` can throw HTTP 422 with message `missing_receipt`; `authedApiFetch` emits the shared mutation-error toast, whose global translation lacks this code and falls back to the generic reload message. The reimbursement-specific inline translator does recognize it. One error can therefore produce contradictory guidance. Temporary diagnostic test calls the real toast bus and verifies both messages.
4. Additional UI/API readiness gap: `requireReceipt=false` gives WAIVED_BY_POLICY and the current UI does not preblock even when there is neither evidence nor a reason. The submit use case still requires a reason for each unevidenced claim (one claim-level reason covers gaps) to avoid stranding later expense projection. Existing API regression proves the rejection; temporary diagnostic proves the current UI does not anticipate it. This is distinct from the pictured saved-reason case.
5. Main also normalizes mobile receipt image formats, awaits intent/upload/complete then line PATCH, preserves successful uploads on partial create failure, and reopens the existing draft instead of creating another one. This does not establish that the user's exact second-click symptom is fixed. The static screenshot does not identify which click failed or its network response. No browser/iPad reproduction was performed.

Open questions:

- None pending: the user confirms the second-click/waived-receipt-flow issues are already fixed. Earlier button/policy questions are superseded for backlog tracking; no additional implementation or policy changes requested.

Artifacts:

- [Main receipt policy logic](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts#L324).
- [Main submit gates](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts#L396).
- [Main readiness helper](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/reimbursements/reimbursements.model.ts#L151) and [detail button](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/reimbursements/ReimbursementsPages.tsx#L1063).
- [Main shared mutation toast](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/common/api/authed-fetch.ts#L203) and [shared fallback](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/common/api/api-error-message.ts#L515).
- Isolated diagnostic: `/tmp/mangmee-main-wht-vat.nbXuKs/apps/web/src/features/reimbursements/reimbursement-receipt-review.probe.spec.ts`. It intentionally asserts observed current behavior, including defects, and is not a product fix or a proposed regression expectation.
- Relevant main docs inspected: reimbursement-approval-spec rules around lines 212–224; reimbursement-receipt-upload-normalization and reimbursement-receipt-saved-signature-ux memories.

Verification:

- Used exact-main snapshot `/tmp/mangmee-main-wht-vat.nbXuKs`, installed dependencies, and separately built snapshot contracts. No branch switching or source modifications.
- API: `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts apps/api/src/modules/reimbursements/presentation/http/reimbursement.dtos.spec.ts` — PASS 112 tests, 29 suites.
- Web: `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/reimbursements/reimbursements.model.spec.ts apps/web/src/features/reimbursements/reimbursements.logic.spec.ts apps/web/src/features/reimbursements/reimbursements.api.spec.ts apps/web/src/common/api/api-error-message.spec.ts apps/web/src/common/api/authed-fetch.spec.ts apps/web/src/common/files/upload-file.logic.spec.ts apps/web/src/features/expenses/expense-upload.logic.spec.ts` — PASS 175 tests, 31 suites.
- Diagnostic and picker: `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/reimbursements/reimbursement-receipt-review.probe.spec.ts apps/web/src/common/components/field/ThemedFile.spec.ts` — PASS 6 tests (3 existing picker tests plus 3 observation probes).
- Total: 290 existing regression tests plus 3 diagnostic observations passed. Initial attempt to use the web-local tsx binary failed because it does not exist; rerun used the installed API tsx binary with the web tsconfig.
- Ponytail full informed use of existing helpers and a small isolated diagnostic instead of product changes during review. No browser/E2E, live API request, or actual iPad click-flow claim is made.

Historical notification-only handoff (completed):

- Report partially fixed: correct evidence-policy handling/readiness exists, but misleading generic toast remains; second-click symptom needs the exact button identified.
- User authorized an agent to fix the notification bug, test, and push into develop. Created branch `codex/reimbursement-receipt-error-notification` in `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-reimbursement-receipt-error-notification` from freshly fetched develop `be7d58c644e31abd123501e0c06f3be0931076fd` (includes all three earlier delegated deliveries). Agent confirmed started.
- Scope is ONLY accurate notification/error translation for known receipt-policy rejections. Reuse the shared mapper/toast path and test message-only and stable-code errors, consistent feature guidance, and safe unknown-error fallback. Preserve strict-policy wording; a reason is not always acceptable.
- Do not alter receipt policy, approval routing, permissions, mutation eligibility, the separate waived-policy readiness gap, or the unclarified second-click issue. No live data, deployment, customer-gate, or permission sync changes.
- Agent will keep implementation memory in its worktree, verify focused tests, fetch/reconcile latest develop, and push without force. Root's dirty `plan` checkout and shared generated/dependency artifacts are outside its edit scope.

Next: No further work. Agent-delivered notification fix is already in develop; the other two symptoms are closed per user confirmation. Do not duplicate the user's work or imply independent verification of their commit/deployment.
