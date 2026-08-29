# Agent Memory: Employee single role and card refresh

Status: IMPLEMENTED AND VERIFIED; Draft PR #341 open to develop (https://github.com/MangmeeDev/mangmeeplus/pull/341), commit ab766aaf. Owner confirmed the legacy transition and local permission-save test on 2026-08-29; not merged.
Owner: Codex / root, 2026-08-29.
Scope: Employee assignment is one role per company membership; replace role only with existing grant authority. Header/list/permission projection consistency. Combined delivery with expense leading-zero fix, PR/merge develop then main; no deployment or live data mutation.
Decisions:
- Reuse the existing QA checkout, branch codex/expense-leading-zero-input, Web3000/API3003; no extra worktree/server or dependency.
- Ponytail full: use existing picker, DTO, use-case, transaction, role-permission editor and tests.
- Screenshot header shows jobTitle, not role; retain jobTitle and add explicit current role so the two concepts are not conflated.
- Current overview waits for list reload and ignores the successful PATCH response. Apply that response to employee state before refreshing projections.
- Existing multi-role rows must not lose access automatically. Owner confirmed keeping existing roles accurately visible until an authorized user explicitly replaces them; no bulk migration or inferred ranking.
- Preserve unrelated dirty docs/agent-memory/main-ui-qa-uat-release-2026-08-28.md. Remote develop advanced by PR337 during discovery; synchronize without overwriting it or local edits.
- Fast-forwarded the same checkout to origin/develop ac592215707310e87a6bda9ab11ba8c09dd53274 without overwriting pending work. Upstream package.json changes were not authored/edited/staged by this task.
- Role-definition forks now update existing membership rows in place; they cannot append a stale assignment after a concurrent employee role change. Actual moved-row count is audited.
Open questions:
- Main merge must respect the active release freeze: observed UAT run 33196850745 on controller 5cf3f59d946d093555315ea9b620eca10b953fce and failed readiness 33199068342. Recheck before merging; do not dispatch/cancel/retry that release.
Artifacts: spec/plan, HTTP/use-case validation, transactional role-fork fix, all employee picker surfaces, numeric helper consumers, unit and browser regression cases.
Verification:
- API focused suites after upstream sync: 132 tests / 18 suites passed, including DTO cardinality, create/update/legacy replacement, HR/self/owner/branch safeguards and role-fork interleaving.
- API full test command (including pretest): passed. API and web typechecks passed, including after upstream sync.
- Web full suite: 1,254 tests passed; focused employee UI/helper suite: 23 tests passed.
- E2E cases compile/discover via playwright --list; browser CLI suite not executed. Added/revised cases cover one-role wizard, legacy display, role replacement/card refresh/reload/403 and extra capabilities in one composed role.
- Actual Chrome/local UI: OWNER has no change-role picker; header explicitly shows current role. Wizard selecting ACCOUNTANT then FINANCE leaves only FINANCE selected, no save made; navigated away without changing fixture access.
- Actual Chrome/local expense manual and substitute wizard normalize 0400/000400 -> 400 and preserve 0.402/0.0042 after blur with no step mismatch; no document saved. Review input was verified earlier and restored without saving.
- After latest upstream sync, repeated full API and web tests passed; web still 1,254/1,254. Both typechecks passed. Five scoped E2E regressions discover successfully after final edits.
- After owner confirmation, Chrome local saved QACOMPLETE UI Regression STAFF -> ACCOUNTANT. Header current-role badge, employee-list card and permission source updated immediately; job title remained unchanged. Reload confirmed ACCOUNTANT persisted.
- Restored the same synthetic fixture ACCOUNTANT -> STAFF through the UI. Reload and DOM assertions confirmed the original STAFF role, list card, permission source and job title. No UAT/Production permission was changed.
- git diff --check passed. No new dependency, server, worktree, migration or live-data mutation.
Next: Commit verification evidence, wait for required CI and merge PR #341 into develop; then main only after the release freeze is clear. Do not repair UAT financial data or change live employee permissions.
