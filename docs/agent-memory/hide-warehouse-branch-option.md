# Agent Memory: hide-warehouse-branch-option

Status: Complete on 2026-08-27; tested implementation pushed to develop and the feature branch without force. No deployment.
Owner: /root/hide_warehouse_branch_option
Scope: Hide the warehouse type from Settings > Branches > Add branch for the current expense-focused release. User authorized an isolated develop branch, implementation, testing, and normal push into develop; no deployment.

Decisions:

- Base: `origin/develop` `aa003846af101976c2554b6cad71840abcf4ef0d`; worktree `mangmeeplus-hide-warehouse-branch-option`, branch `codex/hide-warehouse-branch-option`.
- Follow `docs/specs/multi-company-branch-scope-spec.md` sections 5/7/8: existing branch management API, company permissions, branch scoping and audit remain unchanged.
- Filter `WAREHOUSE` only in the creation selector. Retain the shared labels, stored enum/API support, existing rows, branch selectors, and update payload. No migration, data removal, feature flags, dependencies, or package metadata changes.
- Acceptance: create options remain Head Office / Branch / Online with Branch as default; normal create still submits and refreshes; historical warehouse rows keep their label and remain editable without rewriting type; loading/failure/retry and narrow-screen selector remain usable.
- Ponytail full: legacy skill location is unavailable; read the available repository skill completely. Smallest correct selector-only change, existing source-contract test pattern and browser validation using synthetic local data.

Open questions: None.

Artifacts:

- `apps/web/src/features/branch-settings/BranchSettingsPage.tsx`
- `apps/web/src/features/branch-settings/BranchSettingsPage.spec.ts`

Verification:

- Focused web checks: **43 passed**, zero failed/skipped: `./node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test apps/web/src/features/branch-settings/BranchSettingsPage.spec.ts apps/web/src/features/web-core-workspace/branch-scope-label.logic.spec.ts apps/web/src/common/components/field/ThemedSelect.spec.ts apps/web/src/common/api/authed-fetch.spec.ts`.
- The two new source-contract checks follow the existing web test pattern and are automatically included by the existing `src/**/*.spec.ts` test glob; no test-runner/package edit.
- Contracts built locally with `./packages/contracts/node_modules/.bin/tsc -p packages/contracts/tsconfig.json`; web route type generation and full typecheck passed from `apps/web`: `./node_modules/.bin/next typegen && ./node_modules/.bin/tsc --noEmit`. An initial typegen invocation from the repository root reported no app directory; corrected working directory and reran successfully.
- In-app browser, synthetic local data only, viewport **390×844** and **1280×900**: exactly Head Office / Branch / Online, default Branch, dropdown fits viewport (mobile x41/y435/w308/h129.5); no warehouse creation option.
- Browser created BRANCH and ONLINE on mobile and HEAD_OFFICE on desktop. Verified trimmed/uppercased code, selected type, optional tax branch payload, disabled submit while pending, refreshed row and success toast; permission failure retained form values and surfaced localized error, retry succeeded; cancel closed the form.
- Historical WAREHOUSE row retained its label. Editing its name, tax branch code, and status submitted PATCH without `type`, retained the WAREHOUSE label after refresh, and showed success; no data/scoping change.
- Temporary synthetic fixture was removed, its local development server stopped, browser tab closed, and viewport override reset. No live API, database, account, cloud, deployment, or user-data access.
- Scoped implementation commit `01f937ad`; integrated latest `origin/develop` `dbf1501a2b6292e748fe558d99685d912ce2190e` in merge `80bc3a1772b7dd3bc5584b313539ed86fe82d7bd`. After merge, repeated all 43 focused checks, rebuilt contracts in the isolated worktree, regenerated web route types after fixture removal, and passed full web typecheck and `git diff --check`.
- Diff against develop is exactly the component's one-line filter, its focused web spec, and this memory. No package, schema, API, branch-scope, or unrelated file changes. Existing database-backed branch E2E suite was not run; browser coverage used synthetic responses and therefore does not claim live persistence or deployment validation.
- Atomic normal push succeeded. `git ls-remote --heads origin develop codex/hide-warehouse-branch-option` confirmed both refs at `fc6ccc10d790b7fc36ef7f65cc43267fce811ce6` after integrated verification; this final documentation-only commit records that delivery.

Next: None for implementation. Deploy only under a separately authorized release following the repository runbook.
