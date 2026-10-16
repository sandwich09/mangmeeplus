# Agent Memory: line-payment-evidence-pairing

Status: implemented and locally verified; no deployment or commit (2026-10-15).
Owner: Round 1 lane B.
Scope: receipt/slip pairing, undo, text association route, recent capture detail grounding.
Decisions: owner 2026-10-15; two-hour capture window; exact decimal auto-match; explicit selection for ambiguity; retain slip as VOIDED with original status for undo. No final payment/status confirmation, schema, dependency, package.json or flags. Receipt-after-slip only if a single unambiguous recent slip exists.
Open questions: none blocking. A manual receipt selection can link a different amount without altering money; only auto-link requires exact equality.
Artifacts: docs/specs/line-payment-evidence-pairing-spec.md; docs/plans/line-payment-evidence-pairing-plan.md; outputs/round-1-lane-b-last-message.md.
Verification:
- Contracts build: `pnpm --filter @watchdog-bms/contracts build` exit 0.
- Full API package script: `pnpm --filter @watchdog-bms/api typecheck` exit 0. The first run exposed four local typing errors; all were fixed before the successful rerun.
- Current API production/declarations plus touched API specs (1,423 files): the same package `typecheck --project outputs/.lane-b-api-typecheck.json` exit 0. Temporary project included all non-spec API files and touched registered API specs, extended the normal API tsconfig, and was removed after success. This checks the final pagination/retention changes made while the full check was running.
- Gateway package script: `pnpm --filter @watchdog-bms/ai-gateway typecheck` exit 0 on final gateway code.
- API focused command below: 927/927 pass, 0 skip. Guard suite rerun after final retention guard: 60/60 pass (overlaps the 927; do not add counts).
- Gateway focused command below: 258/258 pass, 0 skip (includes the compact semantic write inventory).
- Contracts focused command below: 87/87 pass, 0 skip.
- `git diff --check` passes. All added tests are in package-script-registered spec files. Package.json, value normalizer, AI_FINAL_MUTATION_ENABLED, final-mutation tool policy, and PLW base regions 4500–5400 / 6300–7700 are untouched.
- No PostgreSQL, browser, provider or live LINE execution: sandbox has no network/docker. Transaction rollback, permission/source refusals and delivery are tested with in-process doubles; shared repository attachment-conflict and API read guards remain the production seams.

Implementation/integration evidence:
- One exact candidate: evidence link and VOIDED slip retirement commit with audit; no money/payment/confirmation changes. Undo restores the same original draft and primary attachment, is operation-bound and replay-safe, and suppresses immediate auto-pairing. See expense-upload.use-case.spec.ts.
- Pairing tests cover exact decimal comparison, same document day, symmetric two-hour capture boundary, multiple candidates, mismatch, out-of-window, tenant/chat/currency/status/evidence exclusions. See expense-document.logic.spec.ts.
- Synchronous OCR and file-result push call the same use-case. UNKNOWN transfer direction accepts the same explicit expense context as the file lane; inbound directions remain refused by the shared eligibility guard. See process-line-webhook.use-case.spec.ts and line-capture-result-notifier.use-case.spec.ts.
- Choice pages show four receipts each, so every displayed record fits the existing five-record delivery proof bound including the slip. Page taps only refresh choices; explicit selection rechecks sources. Payment-evidence postbacks survive v2 primary/fallback only when their exact record ids are in private capture/revision proofs. Other financial controls retain their existing rules. See line-non-receipt-reply.logic.spec.ts.
- Both real association statements bypass new text capture. The semantic and compact router use EXPENSE_PAYMENT_EVIDENCE_LINK; low confidence clarifies. Captured draft ids are API-derived for this user/company/chat and can ground expense.get_detail, with unrelated ids stripped and API source ABAC unchanged. See gateway router/intake/orchestrator and API webhook/core-detail specs.

```sh
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/domain/logic/expense-document.logic.spec.ts src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts src/modules/expenses/application/use-cases/delete-expense.use-case.spec.ts src/modules/expenses/application/services/expense-capture-read-runner.service.spec.ts src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.spec.ts src/modules/line-ai/domain/logic/line-delivery-plan.logic.spec.ts src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/line-ai/application/use-cases/line-capture-result-notifier.use-case.spec.ts src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/agents/intent-router.agent.spec.ts src/modules/line-ai/agents/line-intake-router.agent.spec.ts src/modules/line-ai/agents/orchestrator.agent.spec.ts
pnpm --filter @watchdog-bms/contracts exec node --import tsx --test src/line-ai-prepared-plan.spec.ts src/line-ai-input-evidence.spec.ts src/line-ai-advisor-answer.spec.ts
```
Next: lane integration/review and a real LINE/PostgreSQL smoke test in an authorized environment. No local implementation work remains.
