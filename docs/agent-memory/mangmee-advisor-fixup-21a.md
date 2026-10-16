# Agent Memory: mangmee-advisor-fixup-21a

Status: complete; uncommitted diff ready for review; no live-provider rerun in this sandbox.
Owner: owner request 2026-10-16
Scope: claim receipt/category/draft/submit/edit and approval preflight; lane 21B untouched.
Decisions:
- Follow fix-up 17A spec and existing claim/action architecture. No flags, dependencies, package.json, budget contract, final-mutation gates, or substitute-receipt actions changed.
- E03 trace preview_create joined noncontiguous user phrases, failed invalid_provenance and left no proposal; no-receipt then returned needs_fields and delivery repeated the receipt question. Preserve exact ordered phrase spans using the existing contract's newline join. Collections without a validated line ask for its details instead of looping through receipt buttons.
- J7 after-fx20-b already reached categories, then asked for a reason. Replay its literal postback against reconstructed stored options/proposal; assert the full digest matches before using the real controller parser, use case, adapter and LINE delivery.
- Replay C02's literal photo postback and E03's literal no-proposal postback as well. E03's corrected initial request reaches receipt choice, suggested category first, reason collection, draft confirmation, guarded submit card, and a separate saved-draft UPDATE confirm card for the original 380-baht text.
- A sole editable draft exposes exact LINE choices in get_options without selecting its TARGET. The model names issued target/line refs and uses the current turn's amount proof; the new human card alone saves the change.
- C03 preview now reaches the same locked repository source/snapshot/branch/assignment guards as apply. Before either decision, reuse materialization and expense validateConfirm to catch projection evidence/amount failures. Blocked approvals deliver one sentence and a claim web button; rejection is unchanged.
Open questions:
- No product questions. A collection already left without a validated proposal (old E03 state) asks for the missing details; it cannot invent the lost facts. New E03 requests retain them.
- No real model, LINE service, Docker or PostgreSQL acceptance was available. HTTP-listening tests are sandbox-limited as below.
Artifacts:
- Source: gateway reimbursement-draft-input; API line-reimbursement-draft-adapter, line-expense-action, reimbursement card logic, materialize-claim-expenses, reimbursement-approval, prisma-reimbursement repository.
- Registered regression additions: process-line-webhook.use-case.spec.ts, reimbursement-approval.use-case.spec.ts, orchestrator.agent.spec.ts; existing line-draft-update.security expectation updated for the required web link.
- fixtures/fx21a-live.json contains local trace inputs/routes and reconstructed stored authority. No .live files were changed or committed.
- Handoff: /private/tmp/fixup-21a-last-message.md (at most 40 lines).
Verification:
- Exact-postback/controller/use-case/real-delivery regressions: 4 passed; approval use-case and real repository preflight spec: 131 passed.
- Full API declared pretest: 16 passed, 128 skipped. Full API declared test: 11,321 passed, 175 skipped, 2 listen-EPERM failures.
- Full gateway: 2,014 passed, 46 runtime/socket cancellations. Full contracts: 445 passed. Contracts were untouched, so no contracts rebuild required.
- Both API and gateway package typecheck scripts exited 0 after the final source/test edits.
- All 24 registered API specs importing changed production modules plus delivery-plan: 1,861 passed, 122 skipped, no failures. Nine additional importing specs: 43 passed, 1 skipped, no failures. Explicit real-module DI + table-driven delivery-plan: 33 passed.
- All remaining failures/cancellations match the exact starting commit c18cdf95886fe347aeeaa91de2f61acb2220a189, extracted at /private/tmp/fx21a-baseline. /private/tmp/fx21a-baseline-comparison.json compares test names, failure types, errors and codes (both comparisons identical).
- Full scripts ran their unchanged declared lists through /private/tmp/fx20a-run-tests.py, replacing the sandbox-incompatible tsx CLI with pnpm --filter <package> exec node --import tsx --test --test-concurrency=4; API pretest ran before test.
- Logs: /private/tmp/fx21a-{api-full-final,gateway-full,contracts-full,api-typecheck-final,gateway-typecheck-final,di-delivery,replay,approval,extra-importers,baseline-gateway,baseline-line-reply}.log; registered importers result in /private/tmp/fx21a-importers-result.txt.
- git diff --check passed; no commits, cloud operations or package manifests changed.
Next: review the diff and perform a real-provider/LINE acceptance rerun outside the sandbox.
