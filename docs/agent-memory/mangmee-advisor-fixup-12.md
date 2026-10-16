# Agent Memory: Mangmee advisor fix-up 12

Status: Implementation complete locally, uncommitted; no new verification failures. Broad-suite exceptions reproduced on exact base `deb345399924dc8f18ec43ffde75a855f133fcb8`. Live provider and real PostgreSQL acceptance remain unavailable in this sandbox.
Owner: Codex, one lane.
Scope: Q1–Q5 from live round 10; preserve fix-up 11 web-only substitute signing/approval and all existing tenant, branch, permission, revision and final-mutation guards.

Decisions:
- Q1: delete the model-free ROUTED intercept. Both intake prompt and registry tool description identify create/edit counterparty commands as a new write request regardless of prior help/expense turns. The normal model intake consumes ordinal zero before the existing authority narrows to mixed. No budget contract or authority implementation change.
- Q2: admit the unique printed header date through the existing deterministic date reader, including when the model omits it or selects a due date. Merge the header date across windows. The durable PDF apply atomically records dateStatus and recognized fields alongside the accepted date, using the same source/revision fence as OCR. Missing dates remain missing in capture fields, are hidden in the LINE snapshot, and display “ยังไม่มีวันที่” with a request for the document date.
- Date storage boundary: the existing required expenseDate column retains its internal unverified placeholder; it is never promoted to a read/verified capture date. Reuse expenseDateIsReadable and existing confirmation completeness guards; no schema change.
- Q3a: discard a charge exactly equal to the document's sale-row sum or printed merchandise subtotal before reconciliation, using Decimal. Genuine other charges and unresolved missing rows keep their existing behavior.
- Q3b root cause: the original local `scratchpad/live-r10/gateway-j5b2.log` records all three pages read. Page 3 contains only signature/acknowledgement labels. Its extract and repair emitted no document, and the normaliser's mandatory nonempty documents check rejected it; therefore only w1/w2 were stored. The normaliser now accepts explicit empty fact arrays for a signature/acknowledgement-only page with no numeric facts or unreadable text. This stores w3 and physical coverage without inventing a financial document. Failed extraction windows remain PARTIAL; cached windows retain DONE state on resume.
- Q4: historical draft references with past markers survive the shared write-claim guard. Independent new save/confirmation claims still fail. A refusal retains the non-claim social/question text and adds an actionable draft/revision next step.
- Q5a: accepted date edits use the existing Thai date format; other customer dates in the same class were checked.
- Q5b: category + row-review repair uses the existing rollback preview and one signed category → ready → evidence review → confirm transaction path. Other missing fields retain their existing questions and all stale/permission checks.
- Q5c: the LINE and web extraction callers identify transfer slips before shared OCR apply; an existing TRANSFER_SLIP is also recognized there. Payment evidence does not perform supplier lookup/autosave, preventing a second counterparty before receipt pairing. Explicit counterparty actions remain separate guarded use-cases.
- No package.json edits, dependencies, new flags/env switches, commits, cloud operations or deploys.

Open questions:
- Real DB connection for the recorded assembly replay fails `connect EPERM 127.0.0.1:15439`; AI_BUDGET_RESERVATION_TEST_DATABASE_URL is absent. The PostgreSQL authority suite, including the new real reserve/settle intake regression, was invoked but its suite is skipped. The runnable webhook regression uses the real issuer/narrow authority with fake storage/provider dispatch; it does not claim database reservation coverage.
- Recorded model checkpoint JSON could not be replayed over that socket. Recorded numeric rows/date/signature text were recovered from the original local PDF fixtures instead. Paid-model J6 routing and live PDF acceptance need an environment that can make those calls.

Artifacts:
- `.live-r10/` remains untracked evidence; unchanged inputs.
- `apps/api/src/modules/expenses/domain/logic/fixtures/live-r10-pdf-excerpts.json`: all 70 actual three-page PDF rows (sum 1,050,447.00), printed VAT/total, two-page header date 26/09/2569, and signature-page text; no model outputs invented.
- `/private/tmp/mangmee-advisor-fx12-last-message.txt`: handoff, under 40 lines.
- `/tmp/fx12-api-specs.json`: 165 API specs from the package test lists that transitively import changed files, plus every direct API spec importer and required DI/delivery/budget checks.
- `/tmp/fx12-verification-summary.json`: current/base failure-name/type/error comparison.
- Exact baseline: git archive of deb345399 at `/private/tmp/fx12-original-deb345399`, isolated baseline contracts build, identical installed dependencies.

Behavior evidence:
- Q1: `process-line-webhook.use-case.spec.ts` R10 Q1 executes the full webhook against real issue/narrow and proves ordinal-zero refusal before intake; `line-ai-budget-authority.pg.spec.ts` adds real reserve/settle coverage (not run against DB); `line-intake-router.agent.spec.ts` R10 J6 asserts the capabilities → exact vendor command sequence and prompt/catalog guidance.
- Q2: `expense-capture-routes.spec.ts` R10 Q2 covers recorded header date, absent date, conflicting dates and due-date precedence; `expense-capture-fields.logic.spec.ts` merges header/footer; `receipt-ocr-apply.service.spec.ts` proves the PDF date provenance is saved atomically and an unread date stays missing; `line-capture-result-notifier.use-case.spec.ts` hides the placeholder and asks for the date.
- Q3: `expense-capture-assembly.logic.spec.ts` replays all 70 recorded rows, subtotal-as-charge and signature-only third window; `expense-capture-routes.spec.ts` accepts the signature page but refuses empty facts on numeric/unreadable pages; `expense-capture-read-runner.service.spec.ts` stores w3 and resumes a failed third extraction without re-reading paid pages.
- Q4: `orchestrator.agent.spec.ts` R10 Q4 covers the live social/draft wording and independent current claims; F3/H4 verify useful non-claim text survives unsafe claims on planner and composer paths.
- Q5: `line-expense-draft-conversation.logic.spec.ts` proves Thai edit dates; `line-draft-update.security.spec.ts` R10 Q5b proves category+review in one signed press using real use-cases; OCR apply, webhook pairing and web extraction specs prove transfer-slip classification reaches the shared registry guard.

Verification:
- `pnpm --filter @watchdog-bms/contracts build`: PASS.
- `pnpm --filter @watchdog-bms/api typecheck` and `pnpm --filter @watchdog-bms/ai-gateway typecheck`: PASS, using package scripts.
- Full declared contracts test list via `pnpm --filter @watchdog-bms/contracts exec node --import tsx --test ...`: 419 pass, 0 fail.
- Full declared gateway test list via the same node/tsx runner: 1,674 pass, 0 fail, 46 cancelled by unavailable local sockets. Exact base: 1,670 pass, 0 fail, the same 46 cancelled tests and error types.
- All 165 affected API specs via `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-concurrency=4 ...`: 5,721 pass, 37 fail, 225 skipped. Exact base: 5,709 pass, the same 37 failures and 225 skips. All failed/cancelled names, failure types and error messages compare equal; no new failure.
- All changed API spec files plus DI/delivery logic: 1,039 pass, 0 fail. Required real-module DI + delivery-plan logic: 32 pass, 0 fail; PostgreSQL suite explicitly skipped. The separately requested table-driven frozen-delivery tests in process-line-general-v2.spec.ts were included in both broad runs; their 27 stale-fixture failures reproduce identically on the exact base.
- Both literal full package test scripts were attempted for gateway/contracts; tsx CLI fails listen EPERM on its IPC socket on current and exact base. The full file lists above were then executed with the user-prescribed node --import tsx runner.
- `git diff --check`: PASS. No package.json diff.

Next: Review/integrate the uncommitted diff; run the skipped DB suite and paid live J6/PDF acceptance in a socket-enabled environment. No deployment performed.

Changed source files:
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/domain/logic/expense-capture-read.logic.ts`
- `apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts`
- `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-capture-line.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-capture-assembly.logic.ts`
- `apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.ts`
- `apps/api/src/modules/line-ai/application/line-expense-action.service.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.ts`
- `packages/contracts/src/ai-tools.ts`

Changed existing spec files:
- `apps/ai-gateway/src/modules/line-ai/agents/line-intake-router.agent.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/presentation/http/expense-capture-routes.spec.ts`
- `apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.spec.ts`
- `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts`
- `apps/api/src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-capture-assembly.logic.spec.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-capture-fields.logic.spec.ts`
- `apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.spec.ts`
- `apps/api/src/modules/line-ai/application/line-ai-budget-authority.pg.spec.ts`
- `apps/api/src/modules/line-ai/application/use-cases/line-capture-result-notifier.use-case.spec.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`
