# Agent Memory: advisor-fx18-printed-money

Status: Implementation complete locally; uncommitted. API typecheck remains incomplete after the time cap.
Owner: Codex
Scope: OCR rounding evidence, omitted POS subtotal, and printed-money preservation during receipt apply. No LINE chat changes.
Decisions:
- Reuse existing OCR/apply contracts, tenant/status/permission fences, review states and reviewer acceptance. No dependency, flag, package.json, budget or final-mutation changes.
- Bind ROUNDING to one physical printed label/amount row; complete settlement proves its sign independently of the model quote. Incomplete settlement retains an explicitly printed negative sign. Ambiguous or contradictory rows stay missing.
- A1's captured gateway fields omitted subtotalAmount; its image prints ยอดรวม (8 รายการ) 156.00. The prompt now explicitly requests subtotals without discounts, and the cross-check recovers only an unambiguous labelled subtotal.
- Stop reverse-solving a VAT-exclusive summary base/rate when a printed base/subtotal exists, including zero. Do not complete a missing base by contradicting the printed subtotal.
- Always preserve printed grand total and VAT exactly. On unreconciled drafts also preserve printed subtotal/taxable headers; leave line calculations and snapshot evidence intact and require NEEDS_REVIEW. Valid WHT is subtracted from printed settlement; excessive WHT remains rejected.
- Reconciled mixed-tax and rounding layouts retain existing base/subtotal meanings. No changes to generic totals arithmetic or contracts.
- Reviewer acceptance supports both historical calculated headers and new printed headers, requires unchanged rows/calculation and exact provenance, and refuses a remaining discrepancy against the printed grand total.
Open questions:
- API typecheck did not complete within the time cap; no diagnostics were emitted before stopping its own session. Rerun it before accepting the implementation.
- No live model rerun or PostgreSQL execution: this sandbox has no network/docker or configured money-test database.
Artifacts:
- Gateway line-ai-internal.controller.ts and its registered spec.
- API receipt-ocr-apply.service.ts/spec and expense-vat-reconciliation.logic.ts.
- docs/research/fixtures/receipt-fx18-printed-money.json: exact four captured aiVerifiedFieldsJson payloads, verified against .live/ocr; text transcribed from the images. Reconstructed pre-cross-check rounding/discount candidates are explicitly labelled in tests.
- .live/last-message.txt contains the requested handoff. Original .live/ocr evidence is unchanged and must not be committed.
Verification:
- Focused API apply + totals: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts src/modules/expenses/domain/logic/expense-totals.logic.spec.ts`: 241 pass, zero failures (/tmp/fx18-api-focused.log).
- Gateway registered controller spec: 190 pass, zero failures; its 43 new cases cover exact captured fields, A1 subtotal, rounding sign/quote variants, D3 combined discount, and rejected ambiguous/unprinted evidence.
- Full package scripts use every file from package.json test via /tmp/fx18-run-suite.py, substituting the required node --import tsx runner and --test-concurrency=4. No package.json edits.
- `python3 /tmp/fx18-run-suite.py apps/ai-gateway`: 1,779 pass, zero failures, 46 cancellations (/tmp/fx18-gateway-full-final.log). All cancellations are AgentCore listen EPERM; exact starting-commit archive 9b94ac5b0 reproduces all 46 (/tmp/fx18-baseline-gateway-runtime.log).
- `python3 /tmp/fx18-run-suite.py apps/api`: final run 11,259 pass, 175 skipped, two failures, zero cancellations (/tmp/fx18-api-full-verified.log). Both failures are line-reply.adapter.spec.ts listen EPERM; starting-commit archive reproduces 15 pass and the identical two failures (/tmp/fx18-baseline-api-line-reply.log). Final full run itself took 3,940,975 ms, exceeding the overall time cap while running.
- Every API spec importing a changed file, real-module DI, delivery-plan table, and money PG suites: 872 pass, zero failures (/tmp/fx18-api-impacted-verified.log); exact files are in /tmp/fx18-api-impacted-files.txt. Four PostgreSQL suites skip for unset database URLs.
- Explicit money PostgreSQL command: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/receipt-truth.pg.spec.ts src/modules/expenses/expense-line-charge-kind.pg.spec.ts src/modules/expenses/line-draft-update.pg.spec.ts`: three suites skipped, zero executed tests (/tmp/fx18-api-money-pg.log).
- `pnpm --filter @watchdog-bms/contracts build`: pass (needed for the real-module DI spec).
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: pass. `pnpm --filter @watchdog-bms/api typecheck`: incomplete/stopped after time cap (/tmp/fx18-api-typecheck-final.log).
- `git diff --check`: pass. No commit, deployment, package.json edit, contracts source change or cloud operation.
Next: Rerun API typecheck, then review the diff and rerun the live OCR benchmark and socket/PG checks in a capable environment.

Controller decision 2026-10-16: the API apply/reconciliation part (printed header amounts kept while rows keep the calculation) was NOT taken — it changes the header = sum-of-rows money invariant without the owner. Only the gateway rounding/discount/subtotal evidence fix is committed.
