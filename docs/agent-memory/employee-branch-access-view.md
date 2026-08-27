# Agent Memory: employee-branch-access-view

Status: Implementation and scoped verification complete; integrating latest develop before delivery.
Owner: /root
Scope: Employee access-overview card only: align the all-branch badge and let users view accessible branch names without changing the employee's permissions. Work on `codex/employee-branch-access-view` from develop `463feeb0eba0b207c65861a6a6cafc71bb3b733f`; merge/push develop after verification. No deployment or live account changes.

Decisions:

- User clarified that the pictured employee-card button is the target, not the workspace header selector. Preserve company-wide employee-list behavior and the header.
- Follow branch-scope-visibility-spec R2/R3/R8: Finance/Accountant and other oversight roles remain ALL_BRANCHES in UI and API. Viewing names must not PATCH an employee or relax scope guards.
- Ponytail full: reuse the existing branch list and local expanded state. Render an explicit read-only disclosure for non-editable ALL_BRANCHES employees, retain the guarded assignment controls for editable employees, and render save-status text only when nonempty to remove the mobile leading flex gap.
- Acceptance: an all-branch Finance/Accountant, owner, or read-only target can expand/collapse accessible names without a mutation; branch chips in that state are not permission buttons. Editable scope assignment and last-branch protection remain intact. Loading/errors remain explicit. Badge aligns with the heading on a narrow viewport.

Open questions: None. Display-only scope is confirmed; no policy change requested.

Artifacts:

- `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`
- Scoped regression in `e2e/settings.spec.ts`; synthetic local browser fixture for actual component/CSS at mobile and desktop sizes.

Verification:

```sh
./packages/contracts/node_modules/.bin/tsc -p packages/contracts/tsconfig.json
./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/employee-access/application/use-cases/update-employee-branch-scope.spec.ts
# 27 passed, 0 failed/skipped; includes Finance/Accountant narrowing guards and atomic widening.
./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test apps/web/src/features/employee-access/*.spec.ts apps/web/src/features/web-core-workspace/branch-scope-label.logic.spec.ts
# 54 passed, 0 failed/skipped.
# From apps/web:
./node_modules/.bin/next typegen
# From repo root:
./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json
./node_modules/.bin/playwright test e2e/settings.spec.ts --list --grep 'SET-08F' --project=chromium
# 4 new regression cases discovered (OWNER/COMPANY_VIEW x 390/1280px).
```

- Contracts build, route generation and full web typecheck passed. No package.json, API, data schema, role grant or workspace header changes.
- Synthetic local fixture bundles the real employee page, API clients, ToastProvider, SVGs, compiled app CSS and bundled fonts. Only Next navigation/link are stubbed; employee/branch responses are in-memory. All browser interactions use the in-app Browser, not real accounts or live APIs.
- 390px: initial loading rendered; badge and heading both x=37 (no leading gap), no horizontal page overflow. Finance+Accountant, OWNER, suspended and DRAFT targets expand/collapse all three names; names are noninteractive and no employee PATCH is sent. Switching employee resets expansion.
- Read-only viewer at 390px: Finance+Accountant and STAFF with all scope can view names, no assignment controls/PATCHes. A selected-scope target shows only its one assigned branch, not the other company branches.
- Editable STAFF: 3 -> 2 -> 1 branches sends the existing expected scope/default-branch payloads. Last selected branch remains disabled. ALL_BRANCHES restores scope and closes the picker. Pending writes disable chips/show saving status; a synthetic 503 preserves the old scope, shows the error, and re-enables controls.
- Branch GET failure: explicit scoped error and retry, no misleading all-branch badge or disclosure. Recovery restores the card. Desktop 1280px: both editor and read-only viewer expand/collapse three noninteractive names without PATCHes, no horizontal overflow. Mobile/desktop screenshots inspected; no browser error/warn logs.
- Durable database-backed E2E cases were added/listed, not executed against seeded or live accounts. Equivalent UI scenarios were exercised with synthetic data through the actual component. Broad E2E test discovery initially failed on unrelated absent generated Prisma imports; settings-only discovery passed without generating shared clients. Fixture initial bundling needed the existing web dependency path; corrected locally without adding dependencies.

Next: Merge latest develop, rerun focused checks/types, normal-push feature/develop, and record exact delivery hashes. Remove only the owned temporary fixture/dependency links and stop its server/tab/viewport. Preserve the root `plan` worktree and unrelated edits.
