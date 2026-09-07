# Agent Memory: receipt reliability and draft continuity

Status: Authorized implementation in progress; spec/plan ready, before code.
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
Next: Delegate coding lanes, implement coordinator OCR fix, integrate and verify T01–T18, push and merge reviewed PRs to develop/main.
