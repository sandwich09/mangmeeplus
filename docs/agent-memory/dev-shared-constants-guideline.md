# Agent Memory: dev-shared-constants-guideline

Status: Updated docs.
Owner: Codex main thread emulating BA -> SA -> DEV -> Integration.
Scope: Add developer guideline for reusable values as shared constants.

## 2026-06-26 Migration Guard Guideline Follow-up

Status: COMPLETE.
Owner: Codex main thread emulating BA -> SA -> DEV -> Integration.
Scope: Add dev-facing backend guideline for DB migration existence guards.

Role gate status:
- BA: Goal is reduce migration retry friction; target users are DEV/reviewers touching Prisma/PostgreSQL migrations; acceptance is backend guideline tells DEV when to add `IF EXISTS`/`CREATE OR REPLACE` guards.
- SA: Documentation-only architecture guidance; no runtime contract, data model, permissions/ABAC, or state transition changed. Boundary: guard retry-prone trigger/function/index recreation, not make every Prisma migration fully idempotent.
- DEV: Ponytail read; smallest correct diff updates `docs/guidelines/backend-hexagonal-code-style.md` and this memory file.
- Integration: Backend/frontend behavior unchanged; no E2E/browser path needed for docs-only guideline.

Decisions:
- Use `DROP TRIGGER IF EXISTS ... ON ...` before trigger recreation.
- Use `CREATE OR REPLACE FUNCTION` for migration-managed functions.
- Keep normal table/enum creation aligned with Prisma migration history.

Open questions:
- None.

Artifacts:
- `docs/guidelines/backend-hexagonal-code-style.md`
- `docs/agent-memory/dev-shared-constants-guideline.md`

Verification:
- Not completed: local process creation failed with `Too many open files in system (os error 23)` before `rg` or `pnpm agent:gates` could start.

Next:
- None.

Role gate status:
- BA: Goal is easier maintenance/root-cause analysis for devs/reviewers by avoiding duplicated reusable values; journey is dev adds or reviews code, finds one constant source to change; acceptance is backend/frontend guidelines mention reusable constants and review checks.
- SA: Architecture fit is documentation-only in existing code-style guidelines; no runtime contracts, data model, permissions/ABAC, or state transitions changed; scope excludes code refactor.
- DEV: Ponytail read; smallest correct diff updates existing backend/frontend guidelines and this memory file; touched files are `docs/guidelines/backend-hexagonal-code-style.md`, `docs/guidelines/web-frontend-code-style.md`, and this file.
- Integration: Backend-to-frontend contract unchanged; UI journey/loading/error/permission states unaffected; E2E/browser path not run because this is docs-only.

Decisions:
- Reused values should become named constants.
- Keep constants module-local/feature-local until a second module or feature needs them.
- Move shared constants to common or contract source-of-truth when reuse crosses boundaries.
- Do not create constants for one-off obvious literals.

Accepted assumptions:
- User wanted dev-facing guideline, not code refactor.

Open questions:
- None.

Artifacts:
- `docs/guidelines/backend-hexagonal-code-style.md`
- `docs/guidelines/web-frontend-code-style.md`
- `docs/agent-memory/dev-shared-constants-guideline.md`

Verification:
- `pnpm agent:gates -- docs/agent-memory/dev-shared-constants-guideline.md` passed.

Next:
- Use guideline during future code review/refactor work.
