# Agent Memory: reimbursement internal notes

Status: Implemented; isolated branch prepared for main and develop integration
Owner: Codex
Scope: Multi-note CRUD on the reimbursement journey, API, contract, migration, docs
Decisions: Separate note rows; existing claim-read and branch scope; author or company OWNER may edit/delete; excluded from print/export/LINE/AI
Open questions: None. User confirmed visibility and edit authority as proposed.
Artifacts: `docs/specs/reimbursement-internal-notes-spec-th.md`, `docs/plans/reimbursement-internal-notes-plan-th.md`
Verification: On a clean branch based on the common ancestor of `origin/main` and `origin/develop`, Prisma generate/validate, contracts/config builds, focused API specs 107/107, API typecheck, web typecheck, and `git diff --check` passed. The API spec covers adding a note to a `PAID` claim, access rules, and deletion. All 243 migrations and seed completed in isolated local database `watchdog_bms_notes_demo_0925`. Browser verified add, edit, and persistence after reload on `RB-LOCAL-0001` using the local OWNER demo account; the example note remains visible. Local API and web are running on ports 3001 and 3000.
Next: Merge reviewed PRs into `main` and `develop`; apply migration in the target environment through its normal release path. No cloud environment touched.
