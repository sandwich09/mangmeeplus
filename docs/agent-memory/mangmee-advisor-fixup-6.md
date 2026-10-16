# Agent Memory: mangmee-advisor-fixup-6

Status: Y1–Y4 implemented and verified locally; no new assertion failures. Diff left uncommitted.
Owner: Codex
Scope: Signed confirmation chain, repair continuation/payment entry, contract-backed evidence choices and photo/substitute routing, PDF purpose buttons/current checkpoint retry/dense-page prompt, Thai payment dates/result copy.
Decisions:
- Base is e355ca759a8c2ab2e01991b8c610d2f00ebbb2d6 (original claude/advisor-all-20261015 HEAD). Ponytail full; no dependencies, package.json edits, feature flags, final-mutation gate changes, commits or cloud operations.
- Product: bot prepares, user presses. A signed CONFIRM previews all web guards, then runs ready → review → confirm as needed using the actor and each committed CAS revision. A repair reoffers the pending confirmation. A confirmed unpaid expense offers a signed payment-preview opener; payment still requires its own press.
- Architecture: reuse MarkExpenseReadyUseCase, UpdateExpenseDraftUseCase, ConfirmExpenseUseCase, CompleteReceiptUploadUseCase and LineSubstituteReceiptContinuationUseCase. No new DI dependencies. Branch/tenant/permission/source-state checks remain in those use-cases. Delivery permits the payment opener only with the matching applied expense-action proof; forged/current-final controls stay refused.
- Evidence matches ExpensesPages.tsx and expense-evidence contracts: attach/wait for receipt; attached alternative evidence plus the user's reason; substitute receipt. No none-with-reason confirmation route exists. Photo choice binds one draft/revision/chat/lifecycle, uses web receipt completion and reoffers confirmation; an uploaded result is marked saved before subsequent delivery can fail. Substitute selection starts the real existing continuation for exactly that draft.
- PDF: preserve windowPlanVersion 3 on reload; older versions still fail closed. On retry retain complete pages, invalidate changed extraction windows and downstream priorDocuments context, and keep one document admission.
- G3 owner evidence reports ~2,200 output tokens on partial page 0; trace-g3.jsonl is empty and out-g3 usage does not retain token counts. Current configured read limit is 8,192 tokens / 20,000 stored characters per page, so no 2,200-token cap exists. Removed the prompt's false requirement that an intermediate page must have totals; dense A4 text must be transcribed fully, partial only for visible content it could not read. A mocked 2,200-token-scale page verifies the boundary; live provider attribution remains an inference.
- Refused signed actions offer the existing exact repair/refresh choice or a button to that expense in the web review. Applied cards omit pre-confirm instructions; payment detail dates reuse formatThaiDate.
Artifacts:
- Existing conversation spec/plan have fix-up 6 acceptance and verification entries. W00 frozen artifact regenerated for source hashes only; operation/catalog/gate content unchanged.
- Registered tests: line-draft-update.security.spec.ts; expense-capture-read-runner.service.spec.ts; process-line-webhook.use-case.spec.ts; gateway expense-capture-routes.spec.ts. All new tests live in existing package-script entries.
- .live-r5/ remains untracked and untouched. Baseline snapshot: /private/tmp/fx6-original-base. Comparison: /private/tmp/fx6-baseline-comparison.json.
Verification:
- PASS contracts build: pnpm --filter @watchdog-bms/contracts build; /private/tmp/fx6-contracts-build.log.
- PASS both package typecheck scripts: pnpm --filter @watchdog-bms/ai-gateway typecheck and pnpm --filter @watchdog-bms/api typecheck; /private/tmp/fx6-gateway-typecheck-complete.log and /private/tmp/fx6-api-typecheck-complete.log. API completed naturally with exit 0 (required package script, never bare tsc).
- Literal gateway/contracts test scripts both attempted; tsx IPC listen is forbidden (EPERM). Complete unchanged script file lists ran with pnpm --filter <pkg> exec node --import tsx --test <files>; no exclusions.
- FULL gateway: 51 registered files, 1,667 pass / 0 fail / 46 cancelled / 0 skipped; /private/tmp/fx6-gateway-full.log. Exact original base FULL gateway: 1,666 pass / 0 fail / same 46 cancelled; /private/tmp/fx6-original-gateway-full.log. All cancelled test names match; listener sandbox limitation.
- FULL contracts: 13 registered files, 419 pass / 0 fail/cancelled/skipped; /private/tmp/fx6-contracts-full.log.
- API: all 159 registered direct/transitive importers of changed runtime files (selection /private/tmp/fx6-api-specs.json): 5,496 pass / 2 fail / 0 cancelled / 233 skipped; /private/tmp/fx6-api-full-final.log. The two unchanged HTTP listener tests both fail with listen EPERM on the exact original base: 15 pass / same 2 fail in line-reply.adapter.spec.ts; /private/tmp/fx6-original-api-http.log. DB/integration skips are declared by their existing suites when no database is available. No new assertion failures.
- Real AppModule DI smoke passes in the complete API set; no added dependencies. Existing contract/receipt upload/payment/permission/CAS/security/branch and delivery integration checks pass.
- Additional W00 manifest: 5 pass / 0 fail after source-hash refresh; /private/tmp/fx6-manifest-final.log. git diff --check passes.
Open questions: Live provider/device acceptance and the socket/DB checks require a capable environment; no live reread was possible. No unresolved local assertion failure.
Next: Review/integrate the uncommitted diff; live device/provider and socket/DB acceptance remain external. Handoff: /private/tmp/fixup-6-last-message.md (at most 40 lines).
