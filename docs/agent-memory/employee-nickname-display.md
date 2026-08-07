# Agent Memory: employee nickname (ชื่อเล่น) field + display

Status: DONE 2026-07-12 — implemented, migrated, verified (unit + live browser)
Owner: Claude session (develop, shared worktree)
Scope: Add optional `nickname` to employees; display it (fallback `displayName`) in the bookings feature and the individual-permissions page.

Decisions:
- `nickname` is optional (`String?` on `EmployeeAccessProfile`); no backfill, existing employees fall back to `displayName`.
- Display rule lives in ONE helper: `employeeShortName(e)` in `apps/web/src/features/employee-access/employee-access.api.ts` (`nickname?.trim() || displayName`). Both pages import it.
- Update contract allows `nickname: null` to clear the field (same pattern as addressLine etc.).
- displayName composition unchanged (`title + first + last`); nickname is a separate call-name, not part of displayName.

Artifacts (touch points, in dependency order):
- `packages/contracts/src/employee-access.ts` — EmployeeSummary / CreateEmployeeInput (`nickname?`), UpdateEmployeeInput (`nickname?: string | null`). Contracts dist must be rebuilt (`pnpm --filter @watchdog-bms/contracts build`) or web typecheck sees stale types.
- `apps/api/prisma/schema.prisma` + `prisma/migrations/20260712100000_employee_nickname/` — column added (applied to local docker :15432 DB).
- `apps/api/.../employee-access.dtos.ts` — Create/Update DTOs `@MaxLength(80)`.
- `apps/api/.../create-employee.use-case.ts` — command type + both writes (new profile + resume-draft).
- `apps/api/.../update-employee.use-case.ts` — update data block.
- `apps/api/.../employee-access.mapper.ts` — row type + `toEmployeeSummary`.
- `apps/web/.../AddEmployeePrototypePage.tsx` — state, step-1 field (ชื่อเล่น, optional), edit hydration, submit payload, reset.
- `apps/web/.../IndividualPermissionsPrototypePage.tsx` — list row, avatar initials, header, "เมนูที่ X จะเห็นจริง", delete-confirm, search also matches nickname.
- `apps/web/.../BookingsPrototypePage.tsx` — `staffLabel()` + both staff pickers (create/reschedule).
- Spec updated: `docs/specs/mangmee-flow-a-be-integration-spec.md` §8 EmployeeAccessProfile row.

Verification:
- `create-employee.use-case.spec.ts` extended (nickname persists on create + resume-draft) — 14/14 pass via `npx tsx --test`.
- Live E2E on isolated api :3011 (launch config `api-verify-3011`): PATCH nickname → returned in GET list/detail; `nickname: null` clears. Script: scratchpad verify-nickname.py.
- Browser (Next dev :3000): edited seed employee `seed-room45-employee-mind` via wizard → nickname "บอส" saved (PATCH 200, displayName unchanged); สิทธิ์รายบุคคล shows บอส in row/header/menu heading; bookings create-modal staff picker shows บอส. Left in dev DB as living example.
- api/web typecheck clean for these files (remaining errors at the time were the OTHER session's booking-buffer work: crm-booking-availability spec `bufferMinutes`, BookingsPrototypePage duplicate `min` attr).

Open questions / adjacent findings:
- Seed CRM bookings store `staffUserId` = User id while UI picker sends EmployeeAccessProfile id → seed bookings label as generic "พนักงาน" (pre-existing; spawned separate task "Unify booking staffUserId id space").

Next: none — feature complete. If สิทธิ์รายบุคคล later needs full-name disambiguation for duplicate nicknames, add secondary text in EmployeeRow.
