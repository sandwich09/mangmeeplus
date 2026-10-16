# Agent Memory: mangmee-advisor-fx23

Status: R1/R2 implemented and required verification complete against d5b1e15b6; R3 awaits missing raw model output. Uncommitted.
Owner: Fix-up 23, 2026-10-16.
Scope: R1 manual claim facts across planner timeout, R2 waiting receipt, R3 C06 schema rejection.
Decisions:
- Follow fix-up 17A acceptance and expense-evidence routing spec; preserve metered intake, signed submit, own-draft guards, budget and final-mutation policy.
- Exact J7 routes before/after 22A retain the same hints. after-fx22 times out in the second line.loop after get_options, without ever calling preview_create; the empty collection produces the misleading details question.
- Persist uniquely grounded intake description, explicit purpose/reason and deterministic amount/day via the existing proposal parser on CREATE options with no prior proposal. Existing eligible bills still require source selection; retained-task seeding is excluded. No inferred category/reason or financial commit.
- Web waiting path saves an incomplete evidence draft without documentReviewAcknowledged; LINE uses the same UpdateExpenseDraftUseCase and offers receipt upload next.
- C06 logs clause_keys_invalid on both attempts. Supplied trace contains only the UNAVAILABLE gateway response, not raw provider JSON; requested raw text from user.
Open questions: C06 raw provider JSON needed to prove the exact rejected key/index.
Artifacts: local .live evidence (never commit); registered replay/security specs; /private/tmp/fixup-23-last-message.md (final report).
Verification:
- 14 focused tests pass: exact after-fx21/J7, after-fx22/J7 and after-fx22/E03 router JSON through signed controller, real persisted initial admission, adapter/use-case, captured second-planner timeout and real LINE delivery payload; receipt/category/save facts survive, explicit E03 purpose survives. Existing signed submit/own-draft tests also pass.
- Exact after-fx22/E02 waiting text runs through controller/use-case/delivery and the real web UpdateExpenseDraftUseCase including LINE source projection; saves documentEvidenceDraft without documentReviewAcknowledged, remains DRAFT, offers upload, and binds that upload to the same revision.
- Real-module DI and table-driven delivery-plan specs: 33 pass.
- Contracts build and full package test list: 445 pass. Gateway typecheck passes; full package list: 2,014 pass / 46 runtime cancellations, matching starting commit in failure names/type/error/code.
- API pretest: 16 pass / 128 skip. Final full list: 11,348 pass / 175 skip / 2 listen-EPERM failures; both failures match starting commit. Final 35 importing API specs: 2,064 pass / 128 skip / 31 failures, identical to starting commit.
- Final API and gateway package typechecks pass (exit 0). git diff --check passes. Logs /private/tmp/fx23-*-latest.log; baseline checkout /private/tmp/fx23-baseline; exact failure comparison /private/tmp/fx23-baseline-comparison.json. Handoff /private/tmp/fixup-23-last-message.md (27 lines).
Next: complete R3 only once the C06 raw provider JSON is available. No live network, Docker, deploy, commits, package.json edits, flags, budget/final-mutation policy changes or .live modifications.
