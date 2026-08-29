# Agent Memory: main-employee-branch-access-ui-review

Status: Completed and merged/pushed to develop on 2026-08-27. Display-only branch visibility and badge alignment fixed; existing role policy preserved. No deployment.
Owner: /root
Scope: User asks to align the `ทุกสาขา` UI on employee details and reports inability to select/view another branch despite all-branch access. Screenshots show `สาขาที่เข้าถึงได้` on employee permissions, with Finance/Accountant roles and disabled all/selected scope-assignment buttons, not the workspace header branch filter.

Decisions:

- Baseline main `007dcba70376acb94aa5b55275840304cabd6f68`; develop `554ef68ed99ef6929e292af78dad0f3bfb9a0504`. Develop's changes in the employee page are the delivered draft-delete path/menu positioning, not this branch card. WorkspaceScope and shared all-branch role keys are unchanged.
- `IndividualPermissionsPrototypePage.tsx:779` always renders an empty save-status span before the count badge inside a flex container with gap-3. When the group wraps onto its own line on mobile, that empty element still contributes a leading gap before the badge. This is a concrete alignment defect consistent with the screenshot; no browser measurement was performed in this review.
- `branchPickerLocked` at line 338 is true when the selected employee holds a role in ALL_BRANCH_ROLE_KEYS. Both assignment buttons are disabled at 790/802. Selected branch names render only for SELECTED_BRANCHES or branchPickerOpen (814), so an all-branch locked employee cannot expand their names using this control.
- The handlers `toggleBranch` / `selectAllBranches` send an employee-scope PATCH; they are not a read-only branch viewer or data filter. Enabling them unconditionally would alter permissions rather than fix viewing.
- Source policy `docs/specs/branch-scope-visibility-spec.md` R8 explicitly requires Finance/Accountant (and other oversight roles) to remain ALL_BRANCHES, disabling narrowing in both UI and API. `packages/contracts/src/employee-access.ts:214` lists roles; `UpdateEmployeeUseCase` rejects narrowing and widens atomically on assignment. Do not weaken this rule without an explicit new policy decision.
- Scope selection in the workspace header is separate: `WorkspaceScope.tsx` intersects ACTIVE branches with the logged-in membership scope; only a one-visible-branch restricted context is locked. Unrestricted multi-branch users get a dropdown of all visible branches. Employee pages are company-wide by spec R2, not filtered by that dropdown.
- Smallest scoped UI fix: conditionally render a nonempty save status so the badge aligns; separate read-only visibility of accessible branch names from the permission assignment control, keeping Finance/Accountant all-branch. Do not introduce employee-list filtering, account grant changes, or a new header behavior under this screenshot alone.
- User follow-up `ปุ่มในภาพ` confirms the employee-card control is the reported target. The requested viewing behavior should expose the accessible branch names without a scope PATCH; existing editable branch-scopable roles must retain their normal guarded assignment path. This is not a request to relax Finance/Accountant policy.

Open questions:

- Resolved: user identifies the employee-card button in the screenshot, not the header selector. No remaining scope question for badge alignment and read-only branch visibility. No real permission change is authorized or needed.

Artifacts:

- Main snapshot `/tmp/mangmee-main-wht-vat.nbXuKs`; source files above plus branch label logic and update-employee-branch-scope specs.
- Read source-of-truth branch-scope-visibility R2/R3/R8 and relevant multi-company branch rules through git show. Historical spec test claims were not treated as current live verification.

Verification:

```sh
./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec apps/api/src/modules/employee-access/application/use-cases/update-employee-branch-scope.spec.ts
# 27 passed; includes Finance/Accountant narrowing refusals and atomic all-scope widening
./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/web-core-workspace/branch-scope-label.logic.spec.ts
# 10 passed; distinguishes true all-branch vs locked single-branch labels
```

- 37 focused checks pass, confirming current policy/label behavior, not the UI fix. No live DB, account permission changes, browser/E2E, deployment or application edits performed.
- Notification header-link removal has already been independently delegated to `/root/remove_notification_settings_actions` from develop554ef68e; it is not blocked by this review.

Implementation — 2026-08-27:

- Created `codex/employee-branch-access-view` from develop `463feeb0eba0b207c65861a6a6cafc71bb3b733f` in `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-employee-branch-access-view`. Latest request asks root to fix/merge, not create another agent. Root `plan` checkout and unrelated changes remain untouched.
- Scoped memory/acceptance: `docs/agent-memory/employee-branch-access-view.md` in that branch. Conditional nonempty save status removes the leading badge gap; a separate read-only disclosure exposes names for locked/read-only all-branch targets. Existing branch mutation guards remain.
- API branch/role guard checks: 27 passed; employee web/branch-label checks: 54 passed; contracts build, route type generation and full web typecheck passed. Two durable owner-view E2E cases at 390/1280px added and discovered by the settings-only runner. Final review removed COMPANY_VIEW from those cases because that role lacks employee read permission; no access grant was broadened. Read-only permission behavior was exercised in the component fixture. No database-backed E2E run.
- Synthetic actual-component/CSS browser at 390px: badge/heading both x=37, no horizontal overflow; Finance/Accountant, OWNER, inactive and draft all-scope names open with zero PATCHes and no interactive branch chips. Editable STAFF still narrows/expands scope, blocks removal of the last branch, and restores ALL_BRANCHES. Read-only viewer shows only assigned names for selected-scope staff; all-scope staff can expand all names. Failed writes preserve scope; failed branch reads show the explicit scoped error/retry rather than an all-branch badge. Desktop 1280px editor/read-only disclosure and collapse passed with no PATCHes or overflow. Browser logs clean.

Delivery:

- UI commit `240706d4e1c039e1ac941c30e14c3108cd298ca1`, test-fixture correction `cda74a15`, integration `fdc17fb2` with notification delivery `854fd1d4`. Initial atomic push was rejected after the independent LINE intake-timeout PR #314 advanced develop; neither remote was partially updated and no force push used.
- Merged fresh develop `483f614948b5a88c798593eb65d512298a59a011`; resulting integration `4012d491c112d12a68c2359b5b823e45b16f0aca` passed all 81 focused checks and full web typecheck again. Normal atomic feature/develop push succeeded and ls-remote confirmed both at that integration.
- Documentation-only completion commit `17e49c8664a5d3f8dad89ba0ff7e396719d12525` pushed successfully to both feature and develop, confirmed with ls-remote; feature worktree clean. Full evidence: `docs/agent-memory/employee-branch-access-view.md` in `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-employee-branch-access-view`. Owned fixture/server/tab/viewport and dependency links cleaned; root unrelated work preserved.

Next: No implementation remains for this card. Any live deployment is separate and must follow the mandatory runbook.
