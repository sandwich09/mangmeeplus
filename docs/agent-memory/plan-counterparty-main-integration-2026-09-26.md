# Agent Memory: Integrate plan delegation and scoped counterparty access into main

Status: Scoped implementation and local browser verification complete on a clean main-based worktree. No deployment.
Owner: Codex
Scope: Port only the company package permission and receipt-uploader counterparty access missing from main; retain main's LINE, billing, reimbursement, and sales changes.
Decisions:
- Keep the existing creator path for expense and sales documents while adding original receipt-uploader access to one counterparty row.
- Store the uploader only when an active primary receipt first auto-creates the row. Existing rows are not backfilled or reassigned.
- Keep company-wide counterparty permissions and the sales-document launch gate separate from manual registry edits.
- Use `company.plan.manage` for purchase entry points; only the actual OWNER may grant or assign it. Legal ownership stays OWNER-only.
- Port from the prior branch by scoped file/hunk, never merge its checkpoint or local LINE changes wholesale.
Open questions: None for implementation.
Artifacts: `docs/specs/company-plan-management-delegation-spec-th.md`, `docs/specs/vendor-address-and-counterparty-autosave-spec-th.md`, and scoped API/Web/contract/E2E files.
Verification: Prisma generate, contracts build, API and Web typecheck passed. Focused API/Web tests passed. Four browser E2E cases passed against an isolated seeded local PostgreSQL database: delegated plan management, finance counterparty edit, original receipt-uploader row access, and closed sales gate with independent counterparty registry. `git diff --check` passed. LINE AI source remains identical to main.
Next: finalize diff, open and merge scoped PRs into main and develop; do not deploy.
