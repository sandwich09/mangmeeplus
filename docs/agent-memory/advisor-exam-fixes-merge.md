# Agent Memory: advisor-exam-fixes-merge

Status: merge resolution and requested offline verification complete; diff left unstaged/uncommitted for the controller.
Owner: Codex integration, 2026-10-17 04:00 UTC start, 60-minute cap.
Scope: merge exam lanes B c7a4f4f91, C e8fa00670 and A 252512b06 without staging or committing.
Decisions:
- Keep B completion/date/source/receipt-photo guards and C read/permission/package policy; use A presentation-language propagation on the combined reply surfaces.
- English expense drafts ask the first missing question only; default unit display, saved-claim photo prompt, missing-receipt question, how-to actions, catalog tier name and pending-claim waiting desks have English variants.
- English photo choice continues through category and draft confirmation; the later photo updates the owner-bound saved draft through the existing guarded use cases.
- No package.json, dependency, flags, AI budget or final-mutation policy changes; no cloud, git add or commit.
Open questions:
- A memory records a pre-existing employee/branch wizard language gap; the merge scope adds language coverage for B/C surfaces, not a rewrite of that wizard.
Artifacts:
- Extended line-delivery-plan.logic.spec.ts th/en/mixed matrix covers B completion/claim questions and C how-to/limit/pending-reader surfaces through durable primary/fallback plans and the actual LINE adapter.
- /private/tmp/exam-merge-*.log; final report will be /private/tmp/exam-merge-last-message.md.
Verification:
- Contracts build PASS; Prisma generate PASS.
- Focused API: 675/675, including all process-webhook replays, pending-claim permission tool, W00 and delivery table.
- Focused gateway orchestrator/composer: 755/755.
- W00 regenerated with UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 after resolving code.
- API package typecheck completed naturally with exit 0, running ALONE; gateway package typecheck exit 0.
- FULL API scripts: pretest 16 pass/131 PostgreSQL skips; main (511 registered files) 11,978 pass/198 skips/2 baseline socket EPERM failures (12,178 tests).
- FULL gateway script (51 files): 2,268 pass/46 baseline runtime cancellations/0 assertion failures (2,314 tests).
- FULL contracts script (13 files): 475/475 pass.
- Dedicated 28 direct API importers plus mandatory DI/delivery selection: 2,691 pass/2 identical baseline socket failures; real Nest module DI and table-driven delivery matrix pass.
- Original lane B 18 replay acceptance cases and lane C 17 exact routing replays plus 48 pending-read variants pass in the focused/full suites; lane A replay specs also pass.
- Starting HEAD df990b9a11802828c7e3f0c1af114f6d44d5aa75 archived cleanly in /private/tmp/exam-merge-base-rzllkyug, with its own contracts build; baseline API adapter 15 pass/2 listen EPERM; baseline gateway runtime 46 cancellations.
- /private/tmp/exam-merge-baseline-comparison.json asserts identical nonpassing names, failure types and messages for full API/gateway; importing selection names also match baseline.
- git diff --check PASS; no conflict markers, package.json edits, gate/budget changes, git add or commit. Git index remains unmerged until the controller stages the three resolved files.
Next: controller reviews, stages and commits the existing merge; inherited wizard-language gap and live LINE/provider validation remain separate work.
