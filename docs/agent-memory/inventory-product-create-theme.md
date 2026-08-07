# Agent Memory: inventory product create and theme alignment

Status: Fixed and browser-verified locally
Owner: Codex
Scope: Product list/create theme alignment and local product mutation failures caused by the typed-audit schema rollout gap.
Decisions:
- Reuse `MangmeePage`, `MangmeeCard`, shared Field components, `Button`, and brand tokens; do not create inventory-only UI primitives.
- Keep typed audit as the primary path. On P2022 for `AuditLog.actorType|actorRefId`, preserve legacy USER audit writes with parameterized SQL; non-USER actors still fail closed.
- Do not apply migrations to the shared local Docker database because its migration history diverges from the repository.
Open questions: Coordinated owner/ops migration remains required before non-USER typed audit actors can run on the shared local database.
Artifacts:
- `apps/api/src/modules/audit/infrastructure/prisma-audit.repository.ts`
- `apps/api/src/modules/audit/infrastructure/prisma-audit.repository.spec.ts`
- `apps/web/src/features/inventory/InventoryPages.tsx`
Verification:
- Focused audit fallback test passed (1/1).
- Full API suite passed (1915/1915) and full Web suite passed (271/271) via `node --import tsx --test` fallback after the package `tsx` runner hit sandbox IPC `EPERM`.
- API and Web typechecks passed; `git diff --check` passed.
- Browser smoke passed: local dev sign-in, product create returned 201 and redirected to detail, product update returned 200 with Saved state, list rendered the created row, and API remained running after audit fallback.
- Product list filter controls render in one aligned responsive grid; create form uses labeled themed fields and brand actions. Smoke product and its audit rows were removed afterward.
Next: Apply the pending typed-audit migration through the coordinated DB migration path; remove the legacy USER fallback after all supported environments have the typed actor columns.
