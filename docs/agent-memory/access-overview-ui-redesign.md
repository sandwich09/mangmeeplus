# Agent Memory: access-overview-ui-redesign

Status: implemented by Codex and independently verified (2026-07-29)
Owner: main thread (design + verification), Codex (implementation)

## Verification performed by the main thread

Re-ran outside Codex's sandbox, not taken from its report:

- `pnpm --filter @watchdog-bms/web typecheck` — clean
- `pnpm --filter @watchdog-bms/web test` — 553 pass / 0 fail
- All 14 hard-constraint items re-checked against the new file by reading it, not the report.
- Dead code confirmed gone: `AccessRow`, `MenuChip`, `visibleMenus` have zero occurrences;
  `<ToggleSwitch` appears exactly once (account status), so no disabled toggles remain.

One defect **introduced by this handoff's own spec** (section B3 said each summary tile should be a
`<button>` wrapping a `MangmeeCard`): `MangmeeCard` renders a `<section>`, and a `<button>` may only
contain phrasing content. Fixed in the main thread by applying the `mangmee-card` class to the
button directly and dropping the wrapper. Typecheck and tests re-run green after the fix.

## Scope

Visual/UX redesign of `settings/access-overview` (หน้า "สิทธิ์รายบุคคล") only.
`apps/web` frontend. No API, no Prisma, no `packages/contracts`, no new dependency.

Route: `apps/web/app/(workspace)/companies/[companyId]/settings/access-overview/page.tsx`
Component: `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`

## Problems found in the current screen

1. **Duplicate data, two renderings.** The green card `เมนูที่ X จะเห็นจริง` (chips of enabled
   menus) and the bottom card `สิทธิ์เฉพาะบุคคล` (all MVP1 menus with disabled toggles) both
   render the same field: `matrix.rows[roleId].menus[menuId].view`.
2. **Dead controls.** `AccessRow` renders `<ToggleSwitch ... disabled />` for every menu. They look
   interactive, are not, and occupy roughly half the page height while offering no next action.
3. **Hidden affordance.** Changing an employee's role requires knowing that the coloured role badge
   is clickable; the only hint is a 14px caret inside the badge.
4. **Fetched data never surfaced.** `PermissionMatrixCell` carries `view | create | edit | del |
   approve` (`packages/contracts/src/access-matrix.ts`). The UI reads `view` only, so the page
   answers "which menus appear" but not "what can this person actually do".
5. **Silent writes.** Branch chips and role change fire `updateEmployee` immediately; the only
   feedback is a global `busy` flag that disables controls without telling the user why.
6. **Off-system header.** Hand-rolled breadcrumb + `<h1>` instead of `MangmeePage`, and no primary
   action, unlike every other settings page.
7. **Colour system collision.** `colorForRole()`'s identity hue and the brand/green state hue are
   used at the same visual weight, so "which role" and "is this granted" compete.

## Design decisions

Existing มั่งมี design system is authoritative. No new palette, no new typeface, no new
component file. The work is information architecture and state encoding.

- **Layout: directory → dossier.** Left rail = persistent filterable people directory (sticky, own
  scroll). Right = single-column dossier ordered by the questions an owner actually asks:
  who is this (identity + account status) → what can they do (permissions) → where (branch scope).
- **D1. Merge the two duplicate cards** into one `สิทธิ์การใช้งานของ X`, grouped by `menu.group`,
  each menu row showing its granted actions as capability pills (ดู · เพิ่ม · แก้ไข · ลบ · อนุมัติ)
  derived from the already-fetched matrix cell. Menus without `view` stay visible but muted, so
  "off" is legible rather than absent.
- **D2. Delete the disabled toggles.** Replace with one honest line plus a link to the surface that
  can actually change it: `สิทธิ์มาจากตำแหน่ง <role> — แก้ที่ ตั้งค่าสิทธิ์ตามตำแหน่ง →`
  (`/companies/{companyId}/settings/permissions`). Turns a dead end into a next action.
- **D3. Role becomes a labelled control** (`ตำแหน่ง` field, button that looks like a button,
  `aria-haspopup="listbox"` / `aria-expanded`), not a badge you must guess is clickable.
- **D4. Branch scope gets an explicit `ทุกสาขา / เลือกสาขา` mode switch** mirroring the real
  `branchScopeMode` field, so ALL_BRANCHES is a stated choice rather than an emergent side effect
  of ticking every chip.
- **D5. Summary strip before detail** — 4 counters (ทั้งหมด / ใช้งาน / แบบร่าง / ปิดใช้งาน) that
  double as status filters for the directory.
- **D6. Per-card save feedback** (`กำลังบันทึก…` → `บันทึกแล้ว`) replacing the invisible global busy.
- **D7. `MangmeePage` header** with primary CTA `+ เพิ่มพนักงาน`, gated on `access.employee.create`.
- **D8. Colour discipline.** `colorForRole()` hue = identity only (avatar + role badge). Brand green
  = granted / active. Gray = not granted. Amber = draft, needs action. Error red = disabled account.

## Hard constraint

Behaviour must not change. Same API calls, same payloads, same permission gates, same guards, same
error handling. This is a re-presentation of existing state, plus one new write path (D4) that
reuses the exact `updateEmployee` payload shape the current all-branches case already produces.

## Verification

- `pnpm --filter @watchdog-bms/web typecheck`
- `pnpm --filter @watchdog-bms/web lint`
- `node --test` on the new `access-overview.model.spec.ts`
- e2e guards that must keep passing: SET-02, SET-03A, SET-08 (`e2e/settings.spec.ts`)

## Artifacts

- `docs/agent-memory/access-overview-ui-redesign.handoff.md` — implementation spec for Codex
- `docs/agent-memory/access-overview-ui-redesign.results.md` — Codex's report

## Next

Codex implements against the handoff; main thread verifies against the checklist in the handoff's
section G before accepting.
