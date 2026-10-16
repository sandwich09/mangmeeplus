# Agent Memory: mangmee-advisor-fx20a

Status: complete; scoped implementation and verification finished; diff left uncommitted.
Owner: Fix-up 20A, 2026-10-16.
Scope: A1–A5 in the user request; existing 17A spec and 17B task-selection plan apply.
Decisions:
- Preserve model admission, final mutation gates, tenant/branch/permission/source guards and claim payment-before-signature order.
- Claim collection postbacks are stripped by delivery-plan inline-action authorization; bind them to the existing revalidated options proof.
- C05 already has quick replies in line-send, followed by redundant numbered limitations; use the selector itself as the pending-work limitation.
- C03 seed has no approvalSnapshotHash and placeholder step hashes; repair seed, never waive production approval guards. Its approved claim has no payout data: retain a short exact-claim web hand-off.
- E03 router correctly marks REIMBURSEMENT_CLAIM but CORRECTION enters expense editing; retain the claim semantic route and existing claim preview/confirm path.
Open questions: none about intended behavior; live LINE/database execution unavailable in this sandbox.
Artifacts: local .live traces are evidence only and must not be committed; final handoff target /private/tmp/fixup-20a-last-message.md.
Verification:
- Exact base: 60b5095287f9984ce274eb6b03fec339497b2169; archived under /private/tmp/fx20a-base for isolated comparisons, sharing only dependencies/generated artifacts.
- Registered webhook replays now use real deliverMessages/sendMessagesV2, build/validate plan, replay, and LineReplyAdapter.sendFrozenV2; only DB persistence and HTTP fetch are fake. Claim photo/no-receipt/category/confirm/submit payloads pass; E03 amount 380 survives to confirmation without a write before press.
- C05 selector has one button-bearing message and no numbered limitations; voucher create/submit/approve/pay and 50 ทวิ issue cards test primary and fallback LINE payloads.
- C03 seeded approval traverses the real approval use-case and repository snapshot guard, exact millisecond revision, then signed apply; no pre-payment signatures. Missing payout data retains one sentence plus the exact claim web button.
- Core replays: 8 passed. Full registered webhook (including final multi-source payout fixture): 502 passed. Real Nest module DI plus table-driven delivery-plan spec: 33 passed. Advisor script suites: 154 passed.
- Full contracts: 444 passed. Full gateway: 1,957 passed, zero failed, 46 socket-dependent cancellations; identical on exact base (normalized test names/errors compared).
- API full (two full runs agree): pretest 16 passed/128 skipped; full 11,283 passed/175 skipped/2 socket failures. Both failed HTTP tests reproduce identically on exact base.
- All 33 directly importing API specs plus required DI/delivery checks: 1,826 passed/128 skipped/31 failures. Exact base: 1,822 passed/128 skipped/the same 31 failures, matching normalized names, error, failureType, code, expected/actual/operator fields. DI passes after removing the application import from the pure delivery-plan logic.
- New regression specs overlaid onto base product source: seven of eight fail for missing buttons/redundant numbered limits/missing approval snapshot; the stronger real multi-source payout fixture also fails on base and passes with the fix.
- API and gateway package typecheck scripts both exited 0. Test-only fixture typing issues were corrected; final API typecheck exec session 17422 completed successfully. git diff --check passed.
- Commands expand unchanged package scripts with /private/tmp/fx20a-run-tests.py, using pnpm --filter <pkg> exec node --import tsx --test --test-concurrency=4 <declared files>; API pretest runs first. Importer list: /private/tmp/fx20a-api-importers.json. No package.json edits.
- Logs and normalized comparisons: /private/tmp/fx20a-*.log and /private/tmp/fx20a-compare-*.json.
Next: review the uncommitted diff and /private/tmp/fixup-20a-last-message.md (33 lines). Live replays must reseed to replace the invalid old fixture snapshots; no automatic repair of existing claims, cloud access or live LINE/provider verification is claimed. No further implementation work remains in this lane.
