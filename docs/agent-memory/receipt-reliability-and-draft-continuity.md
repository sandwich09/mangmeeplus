# Agent Memory: receipt reliability and draft continuity

Status: Authorized implementation in progress; spec/plan committed, three coding lanes running; coordinator T01 fix and real-DB regression passed.
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
Open questions:
- Publish exact narrow sourceDraft API/read projection before web wiring. Proposed shape and authority boundaries specified in spec §5.
- Need real local DB/browser availability and all-lane test outcomes. Never claim live UAT/OA proof from fixtures or PR merge.
Artifacts:
- docs/specs/receipt-reliability-and-draft-continuity-spec.md
- docs/plans/receipt-reliability-and-draft-continuity-plan.md
- docs/research/line-receipt-reliability-ux-review-2026-09-07-th.md
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
Next: Delegate coding lanes, implement coordinator OCR fix, integrate and verify T01–T18, push and merge reviewed PRs to develop/main.
