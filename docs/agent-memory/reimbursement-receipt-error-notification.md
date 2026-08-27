# Agent Memory: Reimbursement Receipt Error Notification

Status: Complete; implemented, verified and pushed to develop (2026-08-27). No live deployment.
Owner: /root/reimbursement_receipt_error_notification
Scope: User-authorized notification-only fix on `codex/reimbursement-receipt-error-notification`,
branched from `origin/develop` at `be7d58c644e31abd123501e0c06f3be0931076fd` in an isolated worktree.

Decisions:

- Follow ponytail full from the repo skill; the legacy absolute skill path in AGENTS is unavailable.
- Confirmed the submit use case still returns HTTP 422 `missing_receipt` when company policy
  rejects unevidenced lines. The shared mutation toast lacks that translation and incorrectly
  asks the requester to reload; the reimbursement inline error already gives receipt guidance.
- Add the missing stable-code translation in the shared map and remove the two receipt-error
  overrides from the feature map so toast and inline errors use the same reviewed copy.
- Keep `missing_receipt` policy-neutral: direct the requester to attach receipts or review the
  request without promising that a reason can replace evidence when company policy disallows it.
- Keep `missing_receipt_reason_required` distinct and keep safe generic fallbacks for unknown
  API failures. No receipt-policy, permission, approval-route, eligibility, or mutation change.
- No new dependency, package.json edit, database access, deployment, live UAT inspection, or
  shared generated/dependency artifact write. The ambiguous second-click report and waived-policy
  readiness gap are outside this explicitly narrowed task.

Acceptance:

- Real submit client -> shared fetch -> toast bus and feature inline translation show the same
  actionable Thai guidance for message-only and stable-code receipt-policy errors.
- Known missing-evidence errors do not advise reload or imply a UI/version mismatch; unknown
  400/422 diagnostics remain safely hidden. Original error status/code/details are preserved.
- Existing receipt-policy API checks still pass; rejection is not bypassed or retried.

Open questions: None blocking this notification-only change.
Artifacts: Shared API error map, reimbursement error map, regression tests, reimbursement spec.
Verification:

- Before the map fix, the new real-client regressions failed four known-receipt cases and
  passed the four unknown-error cases. After the fix, all eight passed; the original two
  receipt-upload tests also passed. Both message-only and code-only HTTP bodies are exercised.
- Web command: `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test
  --test-reporter=spec apps/web/src/features/reimbursements/reimbursements.model.spec.ts
  apps/web/src/features/reimbursements/reimbursements.logic.spec.ts
  apps/web/src/features/reimbursements/reimbursements.api.spec.ts
  apps/web/src/common/api/api-error-message.spec.ts apps/web/src/common/api/authed-fetch.spec.ts
  apps/web/src/common/files/upload-file.logic.spec.ts
  apps/web/src/features/expenses/expense-upload.logic.spec.ts
  apps/web/src/common/components/field/ThemedFile.spec.ts` — PASS 186 tests, 32 suites.
- API command: `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test
  --test-reporter=spec apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts
  apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts
  apps/api/src/modules/reimbursements/presentation/http/reimbursement.dtos.spec.ts
  apps/api/src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts`
  — PASS 177 tests, 35 suites. Strict/allowed/waived receipt-policy and approval boundaries unchanged.
- `./apps/api/node_modules/.bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json`
  — PASS. `git diff --check` — PASS. Contracts were compiled only into this worktree's own
  `packages/contracts/dist`; installed dependency links were used read-only, with no Prisma generation.
- No browser/E2E or live UAT check: this is a shared translation-only fix, and the regression
  runs the actual submit client, fetch wrapper, toast bus and inline translator with synthetic HTTP
  responses. It verifies one toast, one POST, unchanged raw error details, and policy-safe Thai copy.

Integration:

- Refetched develop immediately before delivery; it remained at `be7d58c6`, so no merge or
  rebase was needed after the 363 passing tests and web typecheck.
- Implementation commit `a4bdfedb` (`fix(reimbursements): align receipt-policy error notifications`).
- `git push --atomic origin HEAD:refs/heads/codex/reimbursement-receipt-error-notification
  HEAD:refs/heads/develop` succeeded without force. Remote branch lookup confirmed both heads
  at the implementation commit; worktree was clean and temporary dependency links were removed.
- This documentation-only follow-up records delivery; no application code changed after verification.

Next: Parent may continue backlog review. UAT/Production and company receipt policies remain unchanged.
