# Agent Memory: mangmee-advisor-fx27

Status: implemented and locally verified; uncommitted from 464d02730e3ea54da4b81d6d829925a9eb09d3f9.
Owner: Codex, 2026-10-16.
Scope: E02 confirmed/paid amount correction guidance; C05 deterministic capture of explicit hired-service amount/purpose despite absent router capture hints.
Decisions:
- Ponytail full from repository skill; obsolete /Users/spare058 skill path is absent.
- E02 latest route carries amount plus reference-only vendor; saved legal vendor spacing/prefix differs. Resolve only a unique same-chat/user/tenant/branch authorized record using existing name resolution, GetExpenseUseCase and existing void preflight.
- C05 failing router omits captureHints entirely; passing routes carry amount 10000 and description ทำป้ายหน้าร้าน. Recover explicit hired-company/service/amount source fields at shared capture boundary, keeping metered semantic routing, source/conflict guards and web draft use case.
- No package.json, flags, budget, final-mutation policy, substitute certification, .live, commit or cloud changes.
Open questions: none.
Artifacts: docs/evidence/mangmee-advisor-fx27-router-replays.json; existing registered webhook and expense-document specs; /private/tmp/fixup-27-last-message.md.
Verification:
- Artifact webhook bodies and router responses mechanically equal .live/ondev-fx26/{E02,C05}, .live/ondev/C05 and .live/after-fx24/C05. The failing C05 route has no captureHints; this is not a paraphrased-hint grounding rejection.
- Exact signed-controller/webhook/router/use-case/LINE payload replays plus source recovery guard: 12/12 passed; /private/tmp/fx27-acceptance-final.log. E02 covers web reopen allowed/blocked × void allowed/tax period/reservation/certificate blocker, no mutations and one metered intake. C05 replays all three real routes through CaptureLineExpenseNoteUseCase and CreateExpenseDraftUseCase, producing gross 10000, WHT 300 and net 9700 with a retained purpose; missing semantic authority and conflicting amounts still write nothing.
- Same new tests against original production bytes from starting HEAD: 2 passing-route controls pass and 10 fail, reproducing all eight latest E02 matrix failures, missing-hint C05 and its source-recovery guard; /private/tmp/fx27-replay-baseline.log. Baseline test files restored afterward.
- API and gateway package typecheck scripts passed (exit 0); /private/tmp/fx27-{api,gateway}-typecheck.log. No contracts source change, so no rebuild required.
- Full API package pretest list: 16 pass / 131 skipped. Full test list: 11918 pass / 198 skipped / 2 localhost listen EPERM failures; /private/tmp/fx27-api-{pretest,test}.log. Both failures reproduce identically on starting HEAD in line-reply.adapter.spec.ts; /private/tmp/fx27-api-sockets-baseline.log.
- All 30 directly importing/text-reading API specs plus mandatory DI/delivery-plan: 1770 pass / 6 skipped / 31 existing failures; /private/tmp/fx27-all-importers-final.log. Starting HEAD has identical failure names/types/errors/codes; /private/tmp/fx27-all-importers-baseline.log. File list: /private/tmp/fx27-all-importers.json.
- Real-module DI + complete table-driven delivery-plan separately: 34/34 pass; /private/tmp/fx27-di-delivery.log.
- Full gateway package test list: 2017 pass / 46 AgentCore runtime cancellations, identical on starting HEAD; /private/tmp/fx27-gateway-test{,-baseline}.log. Full contracts package test list: 449/449 pass; /private/tmp/fx27-contracts-test.log.
- Package scripts' exact complete file argv read from unchanged package.json and run as `pnpm --filter <package> exec node --import tsx --test <files>` because the tsx CLI is sandbox-blocked. Runner/argv: /private/tmp/fx27-run.py and fx27-*.command.json. Mechanical failure comparison: /private/tmp/fx27-baseline-comparison.json.
- An initial new guard assertion expected an unformatted decimal; corrected to numeric equality. Final focused, importer and complete API runs all pass that guard. No production change was needed for that assertion.
- git diff --check passed; source hashes: /private/tmp/fx27-source-hashes.json. No live-provider/LINE/PostgreSQL/browser run offline; no web screen changed. .live remains untracked and untouched.
Next: review/integrate uncommitted diff; concise report is /private/tmp/fixup-27-last-message.md. No required local implementation/check remains.
