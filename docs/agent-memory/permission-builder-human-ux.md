# Agent Memory: Human-Friendly Permission Builder

Status: Implemented and locally verified on 2026-08-21; delivery continues on the active PR branch.
Owner: thawatchai.
Scope: Company Settings > Permissions role creation/editing and related effective-access detail surfaces.
Decisions:
- Company users see only plain-language work capabilities they can actually select.
- Locked, non-entitled, and above-granter-scope packs/presets are omitted; technical feature and permission identifiers never render.
- The advanced raw-key editor and raw-key effective-access detail are removed from company-facing UI.
- Existing permission keys not represented by a visible pack are preserved silently during an ordinary role edit. Applying a preset remains an intentional replacement of the role definition.
- If capability options fail to load, role mutation is blocked with a generic Thai retry message; there is no raw-key fallback.
Open questions: None.
Artifacts:
- `docs/specs/employee-access-role-management-v2-phase1-spec.md`
- `docs/plans/employee-access-role-management-v2-plan.md`
- `apps/web/src/features/employee-access/EmployeeAccessPages.tsx`
- `apps/web/src/features/employee-access/PermissionMatrixPrototypePage.tsx`
- `apps/api/src/modules/employee-access/application/use-cases/list-capability-packs.use-case.ts`
- `e2e/settings.spec.ts`
Verification:
- API and web typechecks passed.
- The registered API suite passed, including a new regression that proves a non-owner editing a custom role preserves an existing hidden grant while new above-scope grants remain blocked.
- Chromium E2E `SET-04A` passed against local Postgres/Redis/MinIO: opened Settings > Permissions, proved advanced/raw/feature-key copy absent, created a role from a plain-language expense capability, edited it to add reimbursement review, and verified the compiled API permissions.
- `git diff --check` passed for the scoped changes.
Next: Verify the active PR checks after push.
