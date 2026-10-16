# Agent Memory: mangmee-advisor-fx19

Status: complete; scoped product fix verified, diff left uncommitted.
Owner: Fix-up 19, 2026-10-16.
Scope: restore 17A claim approve/reject cards after the 17B merge, preserving request-scoped voucher/certificate previews and the how-to bridge.
Decisions:
- Existing 17A spec and 17B memory define acceptance; no feature expansion.
- 17B added current-read conversation binding but dropped the final currentResults argument to bindRequestedReadFilters. Claim fresh-ID validation consequently saw an empty result list and rejected the preview before API invocation.
- Restore the argument with results from the matching semantic subrequest; retain checked-source validation and all API use-case guards and signed final presses.
- Keep model budget, final-mutation gates, substitute-receipt web-only boundaries, package manifests and dependencies unchanged.
Open questions: none about intended behavior.
Artifacts: semantic-turn-v2.ts; registered orchestrator regression; existing C03 and 17B webhook replays; /private/tmp/fixup-19-last-message.md.
Verification:
- Exact starting-commit C03 replay failed with missing card footer; log /private/tmp/fx19-c03-baseline.log.
- After product fix, C03 plus 17B webhook replays: 8 passed, 0 failed.
- Full webhook spec (the registered API importer of semantic-turn-v2): 500 passed, 0 failed.
- Registered orchestrator/model-loop/native-loop: 358 passed; new Fix-up 19 case checks approve/reject against checked, unchecked, missing-source, invented-ID and other-subrequest evidence (10 scenarios).
- Security + real Nest module DI + table-driven delivery-plan specs: 202 passed, 0 failed.
- Full contracts package script: 444 passed, 0 failed; contracts unchanged.
- Full gateway package script: 1,957 passed, 0 failed, 46 socket-dependent cancellations.
- Full API package script: 11,280 passed, 175 skipped, 2 socket-dependent failures; pretest 16 passed, 128 skipped.
- Standalone semantic/retained-source specs: 176 passed, 10 failures already present at the starting commit.
- Every failure/cancellation was rerun on archived exact starting commit 5490fc5fd373a910e024a6c23f5fd7dd4f4afd04. Normalized failure names, types and error/expected/actual blocks match identically; /private/tmp/fx19-baseline-comparison.json records comparison.
- Full scripts use their unchanged declared file lists via /private/tmp/fx19-run-tests.py, substituting pnpm --filter <package> exec node --import tsx --test --test-concurrency=4 for sandbox-incompatible tsx CLI; API pretest runs first.
- API and gateway package typecheck scripts both exited 0. git diff --check passed.
- Logs: /private/tmp/fx19-{api-full,gateway-full,contracts-full,webhook-full,orchestrator,gateway-semantic,api-security-di-delivery,api-typecheck,gateway-typecheck,baseline-gateway,baseline-api-reply}.log.
Next: review the uncommitted diff; pre-existing semantic expectations and socket restrictions remain outside this merge-regression scope. No live provider/database acceptance was possible; no product doubts remain.
