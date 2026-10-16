# Agent Memory: mangmee-advisor-fx22a

Status: implementation ready; verification incomplete only for the still-running final API typecheck at time-capped handoff; uncommitted against b4fc45255.
Owner: Fix-up 22A, 2026-10-16.
Scope: E03 saved-claim submit opening, own draft update authority, J7 contextual reason question; lane 22B excluded.
Decisions:
- Follow fix-up 17A spec/plan and ponytail full; reuse signed Round 3 openings, draft preview/confirm, web permission/status/branch guards.
- A saved receipt offers a claim-bound signed submit opening; opening prepares, final press submits.
- A model-admitted untyped write may prepare UPDATE through existing proof and ownership guards regardless of the intake classifier's refusal label.
- Web edits DRAFT only; rejected/pending claims get a scoped, revision-checked web reopen/withdraw button before editing. Decided approvals and payout correction rounds offer only the claim page.
- Raw saved-claim UUIDs on get_options are never issued target choices: discard them as selections and list authorized targets without silently selecting one. Exact UPDATE preview still needs issued target/line refs and current-turn amount proof.
- Web permits incomplete evidence on draft save. Defer that requirement to the unchanged submit use-case; blocked receipt guards get short Thai text.
- Keep metered intake, budget contract, final-mutation gates, manifests and .live unchanged.
Open questions: none.
Artifacts: existing registered webhook/card/security specs; /private/tmp/fixup-22a-last-message.md.
Verification:
- after-fx21 literal no-receipt/category/save replay + exact 380-baht message/controller/real adapter/use-case/delivery: 11 focused regression tests passed.
- Real persisted-write authority exercised for UPDATE, including bad actor/signature and CREATE-admission refusal; pending, rejected and decided-state web recovery also verified.
- Signed action security + delivery-plan suites: 208 passed. All new tests are in the two already registered webhook/security specs; the table-driven delivery-plan spec is run unchanged.
- Full contracts: 445 passed. Full gateway: 2,014 passed, 46 socket/runtime cancellations, matching starting-commit baseline.
- Final API declared scripts: pretest 16 passed/128 skipped; test 11,337 passed/175 skipped/2 baseline listen-EPERM failures.
- All 37 importer/text-reference specs: 2,101 passed/128 skipped/31 existing failures, identical by name/type/code/error to b4fc45255.
- Final registered security + real-module DI + unchanged table-driven delivery plan: 214 passed.
- Final API typecheck remains in progress (session 67477; /private/tmp/fx22a-api-typecheck-registered-final.log); it has printed no diagnostics and is not claimed passed. Gateway typecheck passed (exit 0).
- Baseline comparisons: /private/tmp/fx22a-baseline-comparison.json; all identical. git diff --check passed.
Next: poll the existing API typecheck session 67477 to completion (or rerun the package typecheck if the session is gone), then review the uncommitted diff. Handoff: /private/tmp/fixup-22a-last-message.md. No live provider/network/Docker available.
