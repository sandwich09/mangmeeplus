# Agent Memory: mangmee-advisor-fx25

Status: complete; both regressions reproduced on 18b98aba0 and fixed; required local verification complete, uncommitted.
Owner: Fix-up 25, 2026-10-16.
Scope: J2 category edit → evidence → substitute preparation/web sign handoff; J7 pending reason → draft confirmation.
Decisions:
- Ponytail full; repository skill replaces the missing obsolete /Users/spare058 path.
- R1: fx24 returned an unsuccessful combined confirmation preview immediately, skipping the existing signed category edit. Keep dependent WHT pickers while falling back to the category edit when evidence is still missing.
- R2: actual router emits REIMBURSEMENT_REQUEST_START / AMBIGUOUS for the reason; D1 only accepted EXPENSE_DRAFT_CONTINUATION / REIMBURSEMENT_CLAIM. Planner then echoed unproved old lines; API correctly refused invalid_provenance and retained fields.reason missing. Route the current field through the existing proof-validating reason adapter after the same metered intake.
- Preserve use-case guards, proof validation, budget/final-mutation gates, web-only substitute signing/approval/preview, no flags/dependencies/package.json changes.
Open questions: none.
Artifacts: docs/evidence/mangmee-advisor-fx25-router-replays.json (literal after-fx24 router JSON, webhook bodies and tool calls; J7 persisted options reconstructed with existing raw choices, validated against literal postback digests).
Verification:
- Exact after-fx24 J2 and J7 webhook/router/postback replays pass through the real controller, business use cases, delivery plan validation and LINE HTTP payload. J2 uses existing saved payment/signature fixtures and the trace's pending-task locator; J7 reconstructs the collected options and checks literal postback digests. Copied bodies, router JSON and tool inputs/results mechanically match the source traces.
- J2 proves rollback before signed category confirmation, evidence choice, real substitute preparation, DRAFT expense retained and one final message with one web-sign URI. J7 proves the exact reason is stored in the preview, a confirm card follows, and only signed confirmation saves once. No-receipt policy notice and category choices remain in the same reply.
- Both replays fail on the original production files from 18b98aba0 with the exact reported Thai messages; /private/tmp/fx25-replay-baseline-final.log. Baseline production file bytes verified against git show 18b98aba0.
- Focused replays plus fix-up 24 D4 checks: 5 passed; /private/tmp/fx25-acceptance-final.log.
- Full API pretest/test scripts (same complete package lists, pnpm exec node --import tsx --test replacing the EPERM tsx CLI): 16 passed / 131 skipped; main 11,896 passed / 198 skipped / 2 listener EPERM failures. Exact failing spec on starting HEAD reproduces both; /private/tmp/fx25-api-full-final.log and fx25-api-sockets-baseline.log.
- All 14 registered importers/mandatory specs: 2,014 passed; /private/tmp/fx25-importers-final.log.
- All 33 importing API specs, including unregistered and PG specs: 2,097 passed / 6 skipped / 31 failures. Same 31 names/type/error/code on 18b98aba0; /private/tmp/fx25-all-importers-{final,baseline}.log.
- Real-module DI and full table-driven delivery-plan specs: 34 passed; /private/tmp/fx25-di-delivery.log.
- Full gateway test script: 2,017 passed / 46 runtime cancellations, identical on starting HEAD; /private/tmp/fx25-gateway-{full,baseline}.log.
- Full contracts test script: 449 passed; unchanged contracts require no rebuild; /private/tmp/fx25-contracts-full.log.
- Final API and gateway package typechecks passed (exit 0); /private/tmp/fx25-api-typecheck-frozen.log and fx25-gateway-typecheck-final.log.
- Failure comparison: /private/tmp/fx25-baseline-comparison.json (all equal). git diff --check passed; final production/spec/evidence hashes unchanged, /private/tmp/fx25-source-hashes.json.
- No package.json, dependency, flag, budget/final-mutation policy, .live, commit, network, Docker, cloud or deployment changes. No fresh live-model/LINE/PostgreSQL/browser run in the offline sandbox.
Next: review/integrate the uncommitted diff; no required local work remains. The 31-line report is /private/tmp/fixup-25-last-message.md. Completed in about 18 minutes.
