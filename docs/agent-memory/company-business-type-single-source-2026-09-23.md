# Agent Memory: company-business-type-single-source-2026-09-23

Status: Implemented and locally verified on isolated `origin/develop` worktree; PR/CI/merge pending.
Owner: thawatchai + Codex.
Scope: Remove approval/onboarding business category and use owner-selected TSIC in company settings as the current business type.
Decisions: Owner confirmed the former PDPA health-adjacent alert can be retired because that work is complete. Preserve historical signup free text and audit records; do not infer TSIC from the old seven-value category.
Open questions: None.
Artifacts: `docs/specs/company-business-type-single-source-spec-th.md`, `docs/plans/company-business-type-single-source-plan-th.md`.
Verification: Prisma client generated and schema validated. Isolated API typecheck passed; focused API tests 168/168 and security-event tests 38/38; web typecheck passed and focused web tests 157/157; contracts typecheck and focused tests 49/49. `git diff --check` passed. No DB migration or browser session was run locally; release migration and UI smoke remain CI/UAT responsibilities.
Next: Commit scoped files, open PR to develop, wait for exact-head CI, admin merge, then integrate the same change to main under owner authorization. No deploy in this task.
