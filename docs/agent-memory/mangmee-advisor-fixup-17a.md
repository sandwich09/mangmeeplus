# Agent Memory: mangmee-advisor-fixup-17a

Status: complete; diff left uncommitted for review.
Owner: owner decision 2026-10-16.
Scope: J7/C02 claim collection, C03 approvals/payment, C01 expense confirmation/payment/date, C12 approval settings.
Decisions:
- Spec/plan: docs/specs/mangmee-advisor-fixup-17a-spec.md supersedes advisor §11 for claim/expense actions; substitute certify/approve/sign stay web-only.
- Bind receipt/category postbacks to owner/epoch/action and the digest of exact stored facts/options. Keep model-metered intake for choice and photo continuations; use claim evidence policy and existing draft save/submit controls.
- Live J7 tap lacks writeIntent; C02 additionally included the model schema example proposedValue in line values. Replay fixtures preserve the router JSON and tool input, and the shared normalizer drops only that non-business example field.
- Claim payment stages a slip with the reimbursement upload/completion use-cases, previews using the existing payment use-case's complete preflight, and writes only on the signed final card.
- Confirmation retains pending payment through evidence/category repair and prepares the payment card after confirmation. Bangkok today is the default; explicit dates survive. Required expense evidence is retained.
- No settings write tool exists: approval settings link to reimbursement policy settings for an authorized administrator.
Open questions: no product questions. No real-model/live rerun was possible in the network-restricted sandbox. The 60-minute cap was exceeded; feature work stopped and required verification was completed.
Artifacts:
- apps/api/src/modules/line-ai/application/use-cases/fixtures/fx17a-live-routes.json (verbatim router responses extracted from local traces; .live remains untracked).
- Registered replay/guard tests in process-line-webhook.use-case.spec.ts, line-draft-update.security.spec.ts, reimbursement-payment-posting.use-case.spec.ts and line-expense-draft-conversation.use-case.spec.ts.
- Registered LINE_ACTION_RULES × permission table and C12 replay via orchestrator.agent.spec.ts.
Verification:
- Contracts build: passed.
- API/gateway typecheck: both passed (package typecheck scripts).
- Full contracts: 440 passed.
- Full gateway: 1,837 passed; 46 runtime tests cancelled by listen EPERM. Reproduced identically from git archive 9b94ac5b0 at /tmp/fx17a-baseline (0 passed, 46 cancelled in runtime.spec.ts).
- Final full API: 11,254 passed, 175 skipped, 2 listen-EPERM failures; every registered importing API spec was included. The two failures reproduced on 9b94ac5b0 (line-reply.adapter.spec.ts: 15 passed, 2 failed). The prior X2 expectation was updated for the required automatic payment preview.
- Real-module DI + table-driven delivery plan: 32 passed.
- Webhook replay: 4 passed (J7, C02, J7 photo, C03). Focused financial/date guards passed; final registered suite verifies them together.
- No package.json, final-mutation gates, AI budget contract, dependency or feature flag edits. No commits or .live edits.
Next: review the uncommitted diff; handoff is docs/agent-memory/mangmee-advisor-fixup-17a-last-message.md (29 lines). No further feature work pending.
