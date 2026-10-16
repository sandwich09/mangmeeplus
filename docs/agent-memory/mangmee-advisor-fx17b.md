# Agent Memory: mangmee-advisor-fx17b

Status: implementation complete; verification incomplete — API typecheck has not exited by the time cap
Owner: Fix-up 17B, 2026-10-16
Scope: B1–B5 from the user's request; local `.live/C04`, C05, C06, C07, C10 and C11 are evidence, never committed artifacts.
Decisions:
- Use ponytail full; reuse the action registry, metered answer/control calls, immutable retained task sources, ERP previews and signed human confirmation cards.
- Resolve uncovered how-to questions semantically into registry actions in the existing answer budget; one reviewed sentence and a permission/feature-checked action button. Payout details use the existing personal payout-account web page.
- Let a bounded second control round prepare voucher/counterparty/certificate previews after permission-checked reads; accept only IDs returned by those reads, with matching API-owned evidence.
- Route multiple writes through the existing durable task selector, four choices plus more, retaining exact original facts and selecting only one operation. Preserve tenant, owner, revision, dependency, permission, entitlement and final-mutation boundaries.
- No changes to claims/approval implementation, LINE_ACTION_RULES, package.json, dependencies, flags, AI budget contract or final-mutation gates; no cloud operations or commits.
Open questions: none about intended behavior; live provider/database acceptance is unavailable in this sandbox.
Artifacts: existing fix-up-15 spec plus this scoped acceptance/plan record; registered gateway/contracts/API regression specs; final report at `/private/tmp/fixup-17b-last-message.md`.
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: passed before API/gateway checks. Gateway `typecheck` script: passed.
- API `typecheck` script was started but has not exited or produced diagnostics. No passing API typecheck is claimed. Exec sessions 59698, 38521, 64355 and 23965 are the outstanding attempts; 23965 is the final attempt. Stop at the user's time cap instead of further implementation or speculative fixes.
- Full package test scripts were expanded unchanged through `/private/tmp/fx17b_run_tests.py`, replacing the sandbox-incompatible tsx CLI with `pnpm --filter <package> exec node --import tsx --test --test-concurrency=4 <declared files>`; TAP supplies counts. API pretest ran first.
- Contracts full: 444 passed, zero failed. Gateway full: 1,812 passed, zero failed, 46 cancelled. The identical 46 cancellations and their `listen EPERM 0.0.0.0` cause reproduce on archived exact base 9b94ac5b0dd4ccf05c44890481b2d64f09abb911.
- API full: 11,269 passed, 175 skipped, 2 failures; pretest: 16 passed, 128 skipped, zero failed. Both full-suite failures reproduce on base (HTTP/socket restrictions in line-reply.adapter).
- All 35 directly importing API specs plus required checks: 1,911 passed, 6 skipped, 33 failures. Exact base with the same list: 1,881 passed, 6 skipped, 37 failures. Every remaining failed name/error matches base; four mixed-flow failures were repaired by supplying the missing deliveredTextTurns test fixture.
- Separate real Nest module DI and table-driven delivery-plan check: 32 passed, zero failed. Gateway focused router/semantic replay/terminal suites: 423 passed, zero failed. C11 bound webhook replays: 3 passed. Tax formatter focused suite: 24 passed. `git diff --check`: passed.
- Registered tests cover all 14 capability groups and all 21 entries × allowed/permission-denied/feature-denied; exact available real router inventories; C04/C07 lookup-to-preview webhook delivery; C05 durable shared-source selection, revoked access and pagination; voucher presses through the 50 ทวิ issue card; request-scoped ID/owner/chat/type/state guards; C06 current-month extraction; C11 web navigation without purpose questions.
Artifacts:
- `/private/tmp/fixup-17b-last-message.md` (at most 40 lines), `/private/tmp/fx17b-changed-files.json`, `/private/tmp/fx17b-api-importers.json`, `/private/tmp/fx17b-baseline-comparison.json`.
- Full logs: `/private/tmp/fx17b-contracts-full.log`, `/private/tmp/fx17b-gateway-full.log`, `/private/tmp/fx17b-api-full.log`, `/private/tmp/fx17b-api-importers-final.log`, `/private/tmp/fx17b-api-di-delivery.log`.
Next: capture the final API typecheck exit before accepting this handoff as fully verified; run real-provider/LINE/database acceptance in the connected environment. No further feature polishing. No commits, package.json changes, cloud operations or `.live` artifacts included.
