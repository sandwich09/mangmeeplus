# Agent Memory: main-branch-warehouse-option-review

Status: Implementation and develop delivery complete on 2026-08-27. Remote develop/feature `554ef68ed99ef6929e292af78dad0f3bfb9a0504`, code `01f937ad`; parent fetch and ancestry check confirmed. No root product code changes or live deployment.
Owner: /root for coordination; /root/hide_warehouse_branch_option for implementation/delivery.
Scope: User asks to hide the `คลังสินค้า` branch-type option for the current expense-focused release. Interpret the screenshots as the type selector in `+ เพิ่มสาขา`, not permission to remove existing warehouse branches, delete BTS/PZ001, or alter branch scoping.

Decisions:

- Fresh refs: main `007dcba70376acb94aa5b55275840304cabd6f68`; develop `2ef787b1cabf08f0958890d5b6f2ce68e327b2d6`.
- `apps/web/src/features/branch-settings/BranchSettingsPage.tsx:16` includes WAREHOUSE in TYPE_LABELS. The create selector at line 133 enumerates every label without filtering. The settings/branches route renders this component directly.
- The same label map renders existing branch types in the list. Keep it intact so historical warehouse rows still display correctly. The edit form does not offer type changes and its PATCH does not send type.
- `branches.api.ts`, API DTOs, and domain models retain WAREHOUSE as a valid stored type. The smallest UI-only change is filtering WAREHOUSE from the create options, retaining HEAD_OFFICE / BRANCH / ONLINE and all existing data/contracts. No schema migration, data deletion, inventory-wide changes, or new dependency needed.
- No main-to-develop diff in BranchSettingsPage, branches.api or branch DTOs: this UI gap is also still present in develop at the fetched revision.
- Read the relevant existing multi-company/branch spec sections: settings uses existing branch read/manage APIs; branch selection/data access remain independent of the creation affordance. Follow ponytail full; local skill read fully, legacy absolute skill path unavailable as previously recorded.

Open questions: None for hiding this one creation option. Do not infer authorization to remove existing branches or hide them from expense filters. User explicitly authorized the delegated delivery after the review.

Artifacts:

- Source inspection used the exact-main snapshot `/tmp/mangmee-main-wht-vat.nbXuKs`; route/spec inspected via git show origin/main.
- User screenshots show the create branch type selector with warehouse and a normal BTS/PZ001 row; no live data queried.

Verification:

- Read the entire BranchSettingsPage and branch API client, traced the route and create/update DTO shape; compared the specific files against develop (no diff).
- No unit/browser/E2E run: this is a read-only option-list review with no product-code edits. After implementation, verify three create options, working normal creation, existing warehouse row/edits retained, and narrow-screen dropdown behavior using synthetic data.
- No live UAT/Production, database, account, deployment or git push changes.

Implementation handoff:

- Fetched fresh develop `aa003846af101976c2554b6cad71840abcf4ef0d` (draft employee deletion + password test-runner follow-up included); main unchanged.
- Created `codex/hide-warehouse-branch-option` in `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-hide-warehouse-branch-option` from that develop. Initial worktree clean; root remains on `plan` with unrelated edits preserved.
- Spawned `/root/hide_warehouse_branch_option` with the create-selector-only scope, existing warehouse display/edit/data preservation, no package/schema/dependency changes, focused UI/contract tests and web typecheck, local synthetic browser check where available, docs memory and normal non-force feature/develop push. Agent must read AGENTS and ponytail itself.
- The next notification-button review remains root-owned and is not part of this branch. Checkbill agent is about to push; VAT-source agent also active. Re-fetch, merge and rerun focused checks before pushing; no main push or live deployment.

Delivery:

- Code `01f937ad`, merge `80bc3a17` preserves Checkbill `dbf1501a`, verification `fc6ccc10`, final remote feature/develop `554ef68ed99ef6929e292af78dad0f3bfb9a0504`. Agent verified ls-remote; parent fetched and verified code ancestry. Worktree clean.
- One-line creation-option filter only, plus scoped regressions/memory (3 files). Stored/API branch types, historical warehouse labels and editing remain unchanged; no package/lock/schema/dependency changes.
- 43 focused web tests, full web typecheck and owned contracts build passed, repeated after merge. Synthetic browser at 390x844 and 1280x900 passed all three allowed create types/default BRANCH, pending/error/retry/cancel, and historical warehouse name/tax/status editing without a type in PATCH.
- Fixture/server/tab and owned dependency symlinks cleaned up; no shared targets, real records/DB/UAT or deployments touched. Full evidence: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-hide-warehouse-branch-option/docs/agent-memory/hide-warehouse-branch-option.md`.

Next: No required implementation remains; root continues backlog intake. This is develop delivery, not UAT/Production deployment.
