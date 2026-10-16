# Agent Memory: mangmee-advisor-fx20b

Status: complete; locally verified and left uncommitted on 60b509528.
Owner: Fix-up 20B, 2026-10-16.
Scope: action how-to selection, editable-item choices, status/permission edit guidance, capture confirmation/payment intent, unavailable-package choices; exclude lane 20A claim approval/payout and dropped document buttons.
Decisions:
- Existing advisor/draft-control and expense-edit consistency specs plus this request define acceptance: one sentence and buttons; prepare only, human confirmation writes.
- Real C04/C08/C09/E05 router responses omit howToActionId; permissions are present. The existing composer fallback asks for helpActions but its sole JSON example omits it and accepts missing selections. Complete that schema in the existing metered call/repair budget; no model-free how-to routing.
- Reuse web use-case reads and correction capabilities; preserve tenant, branch, provenance, final-mutation gates and AI budget contracts.
- Vague edits use the already-metered intake, then permission-filtered recent choices (at most four plus Other); selection continues through existing preview and signed confirmation.
- Add branch_edit navigation to the existing BRANCH_UPDATE flow: E05 must not send the branch-create command. No new business operation or flag.
Open questions: none on intended behavior.
Artifacts: .live/after-fx18 and .live/edit-fx19 are read-only local evidence, excluded from delivery; registered specs and docs/evidence replay fixture will carry regressions.
Verification:
- Real-router replays: C04/C08/C09/E05/C11 omitted howToActionId; registered orchestrator spec now exercises existing composer selection and its one allowed repair. Every action × allowed/denied is covered (44 rows, including branch_edit).
- Registered webhook regressions replay E01/E04 vague edits, E04 permission denial, E02 confirm+paid+cash capture; selected-expense preview/confirm, 16 status/payment/permission rows and guarded void/recreate are included.
- Shared draft-tool status/permission table uses the real LineDraftUpdateUseCase and verifies zero committed changes. EXTRACTING/VOIDED do not acquire a false confirmed label.
- Focused API webhook/security/real-module DI/delivery-plan: 734 passed, zero failed. Registered intake dispatch: 365 passed, zero failed. All 8 directly importing registered API specs: 1,540 passed, zero failed.
- Full declared API pretest: 16 passed, 128 skipped; full test: 11,312 passed, 175 skipped, 2 socket failures. Full gateway: 2,013 passed, zero failed, 46 socket-dependent cancellations. Full contracts: 445 passed, zero failed; contracts build passed before API/gateway typechecks.
- Every remaining failure/cancellation reproduces on archived exact starting commit 60b5095287f9984ce274eb6b03fec339497b2169 with identical names, failure types, error messages and codes; /private/tmp/fx20b-baseline-comparison.json.
- Full package scripts use their unchanged declared file lists via /private/tmp/fx19-run-tests.py, substituting pnpm --filter <package> exec node --import tsx --test --test-concurrency=4 for the sandbox-incompatible tsx CLI; API pretest ran before test.
- Final API and gateway package typecheck scripts both exited 0, after the contracts build. An intermediate test fixture lacked locale; corrected before the final runs.
- All 31 API specs referencing changed modules, including standalone specs: 1,829 passed, 6 skipped, 31 pre-existing failures; exact-base rerun: 1,797 passed, 6 skipped, the same 31 failures with identical error/expected/actual blocks.
- git diff --check passed. No package.json/budget/final-mutation flag edits, no commits/cloud operations; .live remains excluded.
- Logs: /private/tmp/fx20b-{api-focused,api-importers,intake,security,orchestrator,api-full-post-contracts,gateway-full,contracts-full,api-typecheck-after-contracts,gateway-typecheck,baseline-gateway,baseline-api-reply}.log.
Next: review the diff and /private/tmp/fixup-20b-last-message.md; real provider/LINE/database acceptance remains unavailable in this sandbox.
