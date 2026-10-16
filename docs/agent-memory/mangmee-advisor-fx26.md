# Agent Memory: mangmee-advisor-fx26

Status: implemented and verified locally; starting HEAD fea8cd90da9bf004f3c0ae07e3fa715d1a62505b. Uncommitted.
Owner: Codex, 2026-10-16.
Scope: C07 counterparty address update and E02 confirmed/paid expense edit, with exact recorded router/webhook replays.
Decisions:
- Ponytail full using the repository skill; obsolete /Users/spare058 skill path is absent.
- C07 ondev trace has zero tool calls and TOOL_INPUT_NOT_AUTHORIZED, not an API exception; drive.log has no counterparty read/update failure. Unlike pre-merge's search then preview, the model uses the counterparty ID saved by the prior signed action in the completed task. preserveSemanticTask drops completed tasks before the gateway turn. Carry that ID through the existing quote/read-memory locator shape before pruning; no financial facts or gateway authorization changes. The existing counterparty service and sold web use cases still authorize and fence every preview/apply.
- E02's receipt and linked slip make the recent set plural. Resolve an explicitly named vendor within the same chat/user/tenant/branch set using GetExpenseUseCase before deciding edit status; never write a confirmed expense. Reply “รายการนี้ยืนยันและจ่ายแล้ว จึงแก้ยอดใน LINE ไม่ได้ค่ะ”, offer its web correction path and void/recreate only after the existing VoidExpenseUseCase.previewLineAction passes. Web reopening and void eligibility remain independent.
- Updated the existing bound-photo fixture to provide its real context service's empty projection; retained all photo journey checks.
- Keep AI budget, final-mutation policy, web-only substitute actions, flags, dependencies and package.json unchanged.
Open questions: none.
Artifacts: .live/{after-fx24,ondev}/{C07,E02} (read only, untracked); docs/evidence/mangmee-advisor-fx26-router-replays.json; /private/tmp/fixup-26-last-message.md.
Verification:
- Exact ondev C07/E02 webhook bodies, router JSON and prior task projections copied into the evidence artifact; body/router equality checked mechanically against trace.jsonl. Replay uses the real signature-verifying controller, use cases, plan validation and LINE HTTP payload; transport, repositories and provider are faked offline. Tenant/user/epoch use existing harness bindings.
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-name-pattern='Fix-up 26' src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`: 9 passed; /private/tmp/fx26-acceptance-final.log. C07 preview writes nothing, signed confirm saves once, replay does not save twice, and sold address lock/postcode/CAS survive. E02 covers web reopen allowed/blocked × void allowed/tax period/reservation/certificate blocker, without amount/status changes or draft/final mutation controls.
- The same 9 replays against original production bytes from starting HEAD all fail with the exact reported Thai messages; /private/tmp/fx26-replay-baseline-final.log. Baseline production bytes verified against git show HEAD.
- Full registered importer + mandatory DI/delivery-plan group: 1,612 passed; /private/tmp/fx26-importers-final.log. Full webhook/dispatch: 933 passed; /private/tmp/fx26-webhook-dispatch.log. Real-module DI and table-driven delivery-plan alone: 34 passed; /private/tmp/fx26-di-delivery.log.
- All 29 importing API specs, including unregistered/database specs: 1,695 passed, 6 skipped, 31 pre-existing failures, identical in name/type/error/code on starting HEAD; /private/tmp/fx26-all-importers-{final,baseline-final}.log.
- Full gateway package script: 2,017 passed, 46 runtime cancellations, identical on starting HEAD; /private/tmp/fx26-gateway-test.log and fx26-gateway-runtime-baseline.log. Full contracts package script: 449 passed; /private/tmp/fx26-contracts-test.log.
- Frozen-source full API package scripts: pretest 16 passed / 131 skipped; main 11,905 passed / 198 skipped / 2 localhost listen EPERM failures, identical on starting HEAD; /private/tmp/fx26-api-frozen-summary.log, fx26-api-test.log and fx26-api-sockets-baseline.log. Earlier full runs caught incomplete fixtures introduced by the new projection read; corrected fixtures and all final runs passed apart from those two baseline failures.
- API and gateway package typechecks passed; /private/tmp/fx26-api-typecheck-final.log and fx26-gateway-typecheck.log. No contracts source changed, so no rebuild required.
- Complete package script argv read from unmodified package.json; `pnpm --filter <package> exec node --import tsx --test <exact complete file list>` substitutes for the sandbox-blocked tsx CLI. Runner/argv: /private/tmp/fx26-run.py and fx26-*-test.command.json.
- Baseline failures compared mechanically: /private/tmp/fx26-baseline-comparison.json. Final source/evidence hashes: /private/tmp/fx26-source-hashes.json. git diff --check passed.
- No live-model/LINE/PostgreSQL/browser/cloud/deploy run in the offline sandbox; no web screen changed. No package.json, dependency, flag, budget, final-mutation policy, .live, stage or commit changes.
Next: review/integrate the uncommitted diff; report: /private/tmp/fixup-26-last-message.md (30 lines).
