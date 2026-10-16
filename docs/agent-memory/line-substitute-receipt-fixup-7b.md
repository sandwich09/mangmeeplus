# Agent Memory: LINE substitute receipt fix-up 7B

Status: Complete for W1–W4 of the existing LINE continuation; verified locally, uncommitted.
Owner: Codex, lane 7B.
Scope: W1 combined missing-fact collection; W2 explicit no-more-evidence; W3 target open substitute work for payment photos; W4 signed personal LINE presses through existing prepare/certify/approve use cases.
Decisions:
- Owner request 2026-10-16 supersedes the old web-only signing boundary for authenticated LINE presses. Real request context, tenant/branch/member checks, owned signatures, separate certification and approval, source/checksum/version locks remain authoritative.
- Approval and issuance remain one atomic existing use case, including company-payment idempotency; personal advance never creates a reimbursement/payment through this wrapper.
- Reuse LINE signature upload, signed preview store, private-chat control transport and delivery-plan acceptance. No public document links, new flags, dependencies, package metadata changes or final-mutation policy changes.
- Preserve paper signing, actual scan and original-retention rules; returned legacy LINE paper scans can use the same certify/approve use cases without any digital signature asset. Blank or accountless paper forms never become digitally signed documents.
Open questions: No product ambiguity in W1–W4. Live LINE replay and PostgreSQL integration are unavailable in this sandbox; accountless paper creation/submission/review remains the existing separate paper journey.
Artifacts: .live-r6/out-b.json and trace-b.jsonl (read-only live evidence; never commit); existing substitute receipt specs and plan plus 7B owner amendment.
Verification:
- Contracts build: `pnpm --filter @watchdog-bms/contracts build` passed (`/tmp/fx7b-contracts-build-final.log`).
- API and gateway package typecheck scripts both passed with exit 0 after the final code changes (`/tmp/fx7b-api-typecheck-final7b.log`, `/tmp/fx7b-gateway-typecheck-final7b.log`).
- API: full set of 13 registered test roots importing changed files, including the continuation suite imported by the registered substitute-receipt spec: 1,612 pass, 0 fail/cancel/skip (`/tmp/fx7b-api-affected-final.log`). Invoked with `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-concurrency=4 <registered roots>`; exact command and root list are in the log.
- FULL contracts package test script file list, via `pnpm --filter @watchdog-bms/contracts exec node --import tsx --test <all script files>`: 419 pass, 0 fail (`/tmp/fx7b-contracts-full-final.log`).
- FULL gateway package test script file list, same node/tsx invocation: 1,667 pass, 0 assertion failures, 46 HTTP-server tests cancelled; command exit 1. The FULL suite was run on an untouched archive of original base `claude/advisor-all-20261015` = `2bf84b0368b1de2672aaa3d901f341e78c23ad0b`: exactly 1,667 pass, 0 fail, the same 46 cancellations and identical cancelled-test names (`/tmp/fx7b-gateway-base-full.log`). No claim that these cancelled tests passed.
- W1/W2/W3/W4 and security cases live in already-registered `substitute-receipt.use-case.spec.ts`, `line-intake-dispatch.use-case.spec.ts`, and `process-line-webhook.use-case.spec.ts`. No package.json edits. Existing real certify/approve tests now run for both web and LINE with separate actor/source audits.
- New test cases verify the live combined answer, no-more-evidence with mandatory transfer proof retained, early photo pairing, failed post-attachment refresh, exact caller context, private conversation epoch, company/user/member/chat/branch/revision/digest/token/expiry rejection, revoked permissions/signature/policy, separate certify/approve presses, duplicate refusal, paper scan retention without digital assets, designated approver without expense.review, and quote context for the round-6 confirm/payment continuation.
- `git diff --check` passed. No commit, package metadata, expense-capture-* or line-expense-action.service.ts edits; no flags or tool-policy gate changes. `.live-r6/` remains untracked and untouched.
Next: Integrate the uncommitted diff with lane 7A and replay the live influencer journey when a LINE environment is available. No further local implementation work remains.
