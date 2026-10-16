# Agent Memory: mangmee-advisor-r3a-reimbursement-actions

Status: implemented and locally verified (2026-10-15); diff left uncommitted.
Owner: Round 3 lane A
Scope: LINE reimbursement submit/cancel/approve/reject and ordinary confirmed-expense payment, prepared by the bot and applied only by a private signed postback.
Decisions:
- Extend expense.action.preview and the Round 2 signed store/card/delivery lifecycle; no new tool, dependency, flag, package.json or final-mutation-policy edits.
- Reimbursement IDs come from shown reimbursement read items or signed opening buttons on the existing permission-scoped queue/recipient notice. Opening a button only prepares the existing confirmation. Missing rejection reason is retained in the same private conversation and asked once before confirmation.
- Existing reimbursement use-cases expose a read-only preview option and accept the card revision; execution retains the same permission, scope, frozen approver assignment, payout, audit, atomic-write and notification paths. Confirmation explicitly attests the displayed receiving-account version and third-party payout when relevant.
- Payment defaults to the satang outstanding amount and Bangkok today. Optional method stays optional. Reuse existing payment validation, idempotency key and repository locks. Existing active chat slip is rechecked and linked through LinkAttachmentUseCase inside the payment transaction.
Open questions: none; no live LINE, database or browser access in this sandbox.
Artifacts: docs/plans/mangmee-advisor-full-capability-plan-th.md; /private/tmp/round-3-lane-a-last-message.md.
Verification:
- Exact reproducible commands: `/private/tmp/r3-checks.sh`; tests were added only to existing registered specs.
- `pnpm --filter @watchdog-bms/contracts build` — PASS; `/private/tmp/r3-contracts-build.log`.
- `pnpm --filter @watchdog-bms/api typecheck` — PASS against frozen final sources; `/private/tmp/r3-source-frozen-api-typecheck.log`. A new menu spec needed a Flex type guard; corrected and rechecked, with 82/82 menu tests passing.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck` — PASS; `/private/tmp/r3-final-gateway-typecheck.log`.
- API focused command in r3-checks.sh (13 registered specs): 1,294 PASS, 75 SKIP, 0 FAIL; `/private/tmp/r3-final-api-tests.log`. PostgreSQL cases skipped because DATABASE_URL is absent; no network/Docker.
- Gateway focused command in r3-checks.sh (orchestrator, intent-router, agent-tools registry/parity): 300/300 PASS; `/private/tmp/r3-focused-gateway.log`.
- `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` — 5/5 PASS; artifact regenerated after final source changes.
- `git diff --check` — PASS; no package.json, feature-switch, environment or tool-policy changes.
Integration evidence:
- Submit/cancel: reimbursement-request.use-case.spec.ts, Round 3 LINE submit/cancel use-case preview, covers real owner/permission/status/branch/revision validation with no writes.
- Approve/reject: reimbursement-approval.use-case.spec.ts, LINE reimbursement approval read-only preview, covers actual frozen multi-role recipients, outsiders, missing rights, stale revisions, completed claims, rejection reason and payout-version attestation.
- All five actions: line-draft-update.security.spec.ts, Round 3 reimbursement and payment confirm cards, checks use-case selection, exact user ctx, press-time revision, replay, actor/company/membership/chat/group/signature refusal; concurrent approval/payment presses execute once. Ineligible approver refusal names the actual approvers.
- Reject opening button asks one short question, stores an unconfirmable pending reason, then issues a signed final card; stale answers refuse. Approval bank/version/third-party attestation appears in card facts and is forwarded only on press.
- Payment: shared original repository validators cover permission, branch, confirmed status, amount/date/method and claim-projection refusal. Defaults are the satang outstanding amount and Bangkok today; optional method stays omitted.
- Slip: security spec checks recent same-chat selection and stale/foreign-chat refusal. record-expense-payment.use-case.spec.ts uses the actual LinkAttachmentUseCase on the same transaction and proves a failed active-file check prevents payment commit. prisma-expense.repository.payment.spec.ts verifies revision again under payment/source locks.
- Menu/notice opening controls: line-staff-menu.logic.spec.ts and process-due-deliveries.use-case.spec.ts; only the existing permission-scoped queue/notice recipient gets controls. Mixed procurement queues remain visible. Delivered notice locators are bound to the recipient's private chat hash; business data is re-read through use-cases.
- Webhook prepared-card proof and group refusal: process-line-webhook.use-case.spec.ts; signature, buffering and recovery regressions also pass. erp-draft-update-tools.di.spec.ts checks Nest exports for all added use-case/evidence dependencies.
- Gateway orchestrator.agent.spec.ts accepts only reimbursement summary/detail/pending-approval shownItems and rejects expense/category/capture/invented IDs for claims; deterministic preview replies cannot claim execution.
Next: review/integrate the uncommitted diff. No implementation or local-check work remains. Live LINE/browser/PostgreSQL validation requires a suitable environment.
