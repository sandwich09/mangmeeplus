# Agent Memory: receipt reliability and draft continuity

Status: Complete for Git delivery. Implementation, local verification and both CI runs passed; admin-merged #473 to develop and #474 to main. Final remote file trees match the tested candidate.
Owner: Coordinator, delegated GPT-6 Astra xhigh and GPT-5.6 Sol xhigh per user's explicit request.
Scope: All 18 issue/acceptance entries since the first receipt incident; implement, verify, commit/push, PR/admin merge to develop and main. No deployment in this Git delivery request.
Decisions:
- Latest user instruction supersedes the prior diagnosis-only scope for code/spec/plan/PR delivery. It explicitly permits coding delegation and admin merge.
- Base develop updated 91957572 → 4b91953f; dedicated branch codex/receipt-reliability-remediation-20260907. apps/packages unchanged relative to diagnosed 604ac785.
- Pull initially collided with two untracked local memories. Original copies preserved in ../mangmeeplus-receipt-remediation-local-backup-20260907 and restored on the original develop checkout after fast-forward. Never stage these unrelated original-checkout changes.
- Shared dedicated worktree /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-receipt-remediation-20260907; coding lanes have disjoint file ownership; coordinator alone handles Git writes.
- Read root AGENTS.md; stale ponytail path absent, applied .agents/skills/ponytail/SKILL.md from this repository, full mode. No dependency/package.json change planned.
- Preserve monetary values when accepting only header/control/no fields. Ask all missing user facts together, allow partial answers and save-for-later, silence/unrelated tasks do not finalize or consume unrelated text.
- Keep API permissions/CAS/tenant/branch and final financial boundaries explicit; reuse staged metadata instead of fabricating monetary zero/one.
- Owner directive after delivery, 2026-09-07: the NEXT deployment must enable `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=true` and `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=true` in both UAT and Production. This explicitly authorizes these two flag activations for that deployment; it is not a request to deploy or change live env now. Verify workflow/deploy-script wiring and actual running configuration, not only GitHub variables or schema defaults. Test in UAT before promotion and verify Production readback and behavior afterward.
Open questions:
- No question or Git delivery work remains. Live UAT/OA acceptance remains a separate runtime step.
Artifacts:
- docs/specs/receipt-reliability-and-draft-continuity-spec.md
- docs/plans/receipt-reliability-and-draft-continuity-plan.md
- docs/research/line-receipt-reliability-ux-review-2026-09-07-th.md
- docs/research/receipt-reliability-remediation-verification-2026-09-07.md
Verification:
- git pull --ff-only origin develop succeeded after preserving/restoring local conflicting files.
- git diff --stat 604ac785 HEAD -- apps packages empty.
- pnpm install --frozen-lockfile --offline --ignore-scripts passed, no lockfile/dependency edits.
- Existing release workflows manual; read deployment protocol for boundary/context; no dispatch performed.
- Spec/plan and sanitized evidence committed as 5d7b3415 before first application fix commit.
- T01 permanent regression first failed against original source: expected 0.0000, actual NaN. Shared OCR mapper changed to nonNegativeMoney consistent with its validator. All receipt-ocr-apply.service.spec.ts tests pass, including explicit zero/0.01 control and unreadable/NaN/Infinity/negative amount cases.
- Dedicated disposable PostgreSQL container mangmeeplus-receipt-remediation-pg-20260907 at 127.0.0.1:15439, database watchdog_bms. All 176 baseline migrations applied; no schema change. Config/contracts built and Prisma client generated.
- RECEIPT_TRUTH_TEST_DATABASE_URL pointing only to that local container + RECEIPT_TRUTH_REQUIRE_POSTGRES=true: receipt-truth.pg.spec.ts passed 8 tests, 0 fail, 0 skip, including real zero-priced Decimal persistence and sibling VAT/charge/date/correction cases.
- Seeded isolated DB using APP_ENV=local, disabled AI/mail and no S3 credentials/bucket (local fixture storage). Seed passed; output/receipt-remediation-20260907/local-seed.log retained locally. No production services or customer data touched.
- SourceDraft contract is published and integrated with real HTTP GET/PATCH; upload-only source editor passed actual authentication and revision checks. No finance permission added.
- Final Playwright 6/6 passed in 14.6 seconds at 390/1280 px: partial reload, stale PATCH409, reviewer legacy READY reopen, upload-only image preview/save, and empty-OCR add-item continuation. Compact source-only layout, truthful unknown totals/date and visible correction CTA verified. Uses dedicated versioned local MinIO bucket receipt-remediation-20260907-01a0778d; fixtures remove their exact image versions and records.
- Final root real PostgreSQL suites passed 26/26 with zero skips: receipt truth 8, source draft 11, capture/delivery reliability 6, existing LINE draft edit 1. Source suite uses real repository/audit transactions with a passthrough tax resolver and existing tax/confirmation suites as supplements.
- Final whole workspace pnpm test passed. Owner focused suites passed 185/185 source and 537/537 delivery. API TypeScript with existing 8 GB heap, contracts build and gateway TypeScript passed; root web typecheck passed after the final correction CTA. Do not add overlapping test counts together.
- Combined review fixed legacy READY correction dead-end, unpersisted source completeness at final mutation, source-to-financial row identity/deletion, saved marker leakage across attempts, canonical JSONB push identity, and default role/navigation compatibility. No dependencies, schema migrations or runtime default changes.
- CI invokes source/LINE continuation via the existing whole-chain catalog plus both new PostgreSQL suites. Spec coverage 3/3 and catalog contract 4/4 passed without package.json changes. Final diff check passed.
- Existing whole-chain acceptance runner passed all eight repository suites (21 catalog scenarios); its three external-image/provider acceptance scenarios remain explicitly outside this local pass.
- Integrated implementation committed/pushed as d4896759; develop PR https://github.com/MangmeeDev/mangmeeplus/pull/473. Initial CI 34102495652 stopped at stale maintenance pins before tests. Regenerated only the changed upload-intent digest and dependent validator digest using the existing pin-sync script; enforcement behavior is unchanged. Both pin/validator contract suites and pin --check pass.
- Fetched origin develop/main: still 4b91953f /3720db9a; no open PRs when checked.
Delivery checkpoint after develop merge:
- Tested feature head: 3ee21ed64d190def8b1888a428000d1ce3585a31. Full CI https://github.com/MangmeeDev/mangmeeplus/actions/runs/34102641318 succeeded, including Typecheck and Test (17m17s), security audit, secret scan, config validation, migration review and release-control contracts. Image publishing jobs are intentionally skipped for pull requests.
- Admin-merged https://github.com/MangmeeDev/mangmeeplus/pull/473 at 2026-09-07T09:07:53Z. Develop merge SHA: ca36d69751ad37629bb512b0d0d3585afdcf010e. Its file tree equals the tested feature head.
- Local develop fast-forwarded to ca36d697; three pre-existing investigation files were backed up under ../mangmeeplus-receipt-remediation-local-backup-20260907/before-final-develop-update and restored byte-for-byte. Other pre-existing local edits were untouched.
- Main PR: https://github.com/MangmeeDev/mangmeeplus/pull/474, head develop ca36d697. CI: https://github.com/MangmeeDev/mangmeeplus/actions/runs/34104354102 succeeded for that exact head. Admin-merged at 2026-09-07T09:27:38Z; main merge SHA: 1596cfa7fddd61917818d1b8cd379471ab3b0e79.
- Removed only own disposable PostgreSQL container and local MinIO bucket. Bucket had zero remaining versions after fixture cleanup. Existing local PostgreSQL/Redis/MinIO services remain available. Test logs/screenshots remain in the dedicated worktree.
- Post-merge `git diff --exit-code origin/develop origin/main` and feature HEAD → origin/main both pass. All three file trees equal b24b222fa4163a8e136152836e3a1de806ed854d. The dedicated implementation worktree is clean. This closes plan delivery checkpoints 7–9.
- Both complete successful CI logs are retained in the dedicated worktree's output/receipt-remediation-20260907/github-ci-{develop,main}-success.log. Local browser launcher retained outside Git under ../mangmeeplus-receipt-remediation-local-backup-20260907/test-tools/run-browser.py.
- This local memory entry records post-merge delivery state; the merged code/spec/evidence remains the reviewed PR content. No cloud release, LINE message or runtime flag change was performed. The existing LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED and LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED defaults were not changed; live flag values were not queried in this Git delivery task.
Next: At the next UAT → Production deployment, enable both owner-required flags above explicitly and verify they are `true` in the actual running environments. Exercise LINE partial answers/all missing facts, save-for-later/web/resume, and saved-outcome delivery recovery without repeated OCR/business writes. Follow the mandatory UAT/production protocol and record actual OA/device acceptance plus exact UAT/READY/Production run IDs. This note changes documentation only; no live activation or deployment has been performed.
