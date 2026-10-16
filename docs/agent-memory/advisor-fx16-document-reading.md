# Agent Memory: advisor-fx16-document-reading

Status: Complete locally; uncommitted and not deployed. All required checks ran; environment failures reproduced on the starting commit.
Owner: Codex
Scope: O1 signed printed rounding, O2 combined line/bill discount, O3 bill-payment amount, O4 bounded image row recovery, O5 capture seller branch normalization.

Decisions:
- Existing OCR/capture contracts, expense permissions, status/tenant checks and final-mutation gates remain in force; no dependency, flag, package.json, or AI budget-contract changes.
- Extraction/transcription explicitly include printed rounding, both discount levels, and bill-payment paid amounts. A combined discount absent as a single printed number is admitted only when source-backed subtotal, charges, VAT and total prove it.
- Rounding adjusts settlement after VAT. Discount validation and missing VAT/base/total completion exclude it from the pre-VAT base. Capture mapping preserves negative ROUNDING with zero tax.
- An incomplete item block can trigger recovery even when it also raises clarification. One additional provider call returns fresh transcription plus extraction. Existing evidence/classification checks run again; acceptance requires reconciled rows, the same total, compatible document number and a usable classification. Failed/partial recovery preserves the first reading.
- Printed seller branches normalize through the existing strict branch validator; manual entry keeps its existing five-digit requirement.
- Regressions embed actual synthetic benchmark gateway JSON (D3, R4, S4, P1) and F2 capture document JSON. Corrected model responses are explicitly mocked and do not imply a live model rerun.
- Carbon-book document numbers and vendor-name prefixes remain unchanged.

Open questions: No product questions. Live model accuracy remains unmeasured after the prompt changes because this sandbox has no network.
Artifacts:
- User Fix-up 16 acceptance criteria; existing expense VAT source reconciliation spec, capture contract appendix and OCR total-recovery memory.
- Gateway: expense-capture-read.logic.ts; line-ai-internal.controller.ts and its registered spec.
- API: receipt-ocr-apply.service.ts/spec; expense-capture-fields.logic.ts/spec; expense-vendor-identity.logic.ts.
- Temporary verification logs: /tmp/fx16-*.log. Local synthetic evidence stays under .live/ocr/.

Verification:
- Full registered test lists are executed from package.json without editing them: `python3 /tmp/fx16-run-suite.py apps/ai-gateway`, `... packages/contracts`, `... apps/api`. The wrapper substitutes `pnpm --filter <package> exec node --import tsx --test <every registered file>` for the tsx CLI. API uses --test-concurrency=4 and TAP for exact counts.
- Gateway full (51 registered files): 1,736 pass, 46 cancelled, 0 failures. The 46 AgentCore runtime tests cannot open a listening socket (EPERM). On a clean archive of starting commit ab59c32e1, `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/agentcore/runtime.spec.ts` produces the identical 46 cancellations and listen EPERM.
- Contracts full (13 registered files): 440 pass, 0 failures.
- Gateway focused controller + capture route specs: 194 pass.
- API focused receipt apply + capture fields + vendor identity specs: 164 pass.
- All five registered API specs referencing changed modules, plus real-module DI and delivery-plan specs: 733 pass. `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts src/modules/expenses/domain/logic/expense-capture-fields.logic.spec.ts src/modules/expenses/application/services/expense-capture-read-runner.service.spec.ts src/modules/expenses/domain/logic/expense-vendor-identity.logic.spec.ts src/modules/line-ai/application/use-cases/erp-draft-update-tools.di.spec.ts src/modules/line-ai/domain/logic/line-delivery-plan.logic.spec.ts`. Output: /tmp/fx16-api-impacted.log.
- Real Nest modules and delivery-plan separately: 32 pass after building the local contracts distribution.
- `pnpm --filter @watchdog-bms/contracts build`: pass. Both package `typecheck` scripts pass after the build.
- Initial full API run: 11,243 pass, 175 skipped, 2 failures (both local socket EPERM in line-reply.adapter.spec.ts). On starting commit ab59c32e1, the same spec produces 15 pass and the identical 2 socket failures. Baseline logs: /tmp/fx16-api-line-reply-base.log and /tmp/fx16-gateway-runtime-base.log.
- Final full API rerun (511 registered files): 11,243 pass, 175 skipped, 2 failures, 0 cancellations. Both failures are the same line-reply socket EPERM failures reproduced on the starting commit; no new failures.
- `git diff --check`: pass. No package.json, contracts source, cloud or deployed state changed. No commit made.

Next: Handoff is .live/last-message.txt (at most 40 lines). Review the uncommitted diff; rerun the live full-field benchmark and socket-dependent tests in an environment that permits networking.
