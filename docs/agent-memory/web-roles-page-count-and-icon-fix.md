# Agent Memory: roles page — entitlement-scoped permission count + clipped lock icon

Status: Done (2026-07-29), unstaged on `feat/company-settings-scope-and-sidebar-fix`.

Owner: Claude (plan + verification), Codex (implementation).

Scope: `สิทธิ์การใช้งาน` page (`PermissionMatrixPrototypePage`) — two reported defects.

## Defects and root causes

1. **"N สิทธิ์" per role was wrong.** The card rendered `role.permissionKeys.length`, the raw grant
   list of a `scopeKey='system'` Role row — identical for every company. The matrix rendered beside it
   is entitlement-filtered (`get-access-matrix.use-case.ts` → `filterPermissionsByEntitlement`), so a
   company with few features enabled saw "Admin · 186 สิทธิ์" next to a nearly empty matrix, and
   Finance (187) outranked Admin (186).
2. **Amber system-role lock icon rendered clipped.** DOM probe: `viewBox=null`, `width/height=20`,
   CSS box 16×16, `overflow:hidden` → outer 4px cut. `@svgr/webpack` was registered with no options in
   `apps/web/next.config.mjs`; SVGR only disables svgo's `removeViewBox` when `icon:true` or
   `dimensions:false` is set, so svgo stripped `viewBox` from ~45 of the 58 icons in
   `apps/web/src/common/icons` (every file whose viewBox equals its width/height). Reducing the CSS
   size would have clipped it further — the viewBox had to come back.

## Decisions

- Count = entitlement-effective permissions for the company being viewed, so the card agrees with the
  matrix. Raw `permissionKeys` stays untouched in the payload — the role builder edits from it.
- New contract field is optional (`effectivePermissionCount?`), so `toRoleSummary` / `get-role` and
  other RoleSummary producers stay unchanged.
- Icon fixed at the loader (root cause, whole icon set) rather than per-file; size stays `h-4 w-4`,
  plus `shrink-0` so the flex row cannot squeeze it.

## Artifacts

- `packages/contracts/src/employee-access.ts` — `RoleSummary.effectivePermissionCount?: number`.
- `apps/api/.../use-cases/list-roles.use-case.ts` — loads `loadEntitledFeatureKeys` alongside the role
  query and attaches `filterPermissionsByEntitlement(...).length`.
- `apps/api/.../use-cases/role-management.use-case.spec.ts` — `ListRolesUseCase` case.
- `apps/web/next.config.mjs` — svgr `svgoConfig` with `removeViewBox: false` (+ `prefixIds` kept).
- `apps/web/src/features/employee-access/PermissionMatrixPrototypePage.tsx` — count + `shrink-0`.

## Verification (2026-07-29)

- `node --import tsx --test` on `role-management`, `get-access-matrix`, `feature-gate` specs → 53 pass.
- `tsc --noEmit` in `apps/api` and `apps/web` → clean (after rebuilding `packages/contracts`).
- Dev servers (API 3101 / web 3100) against the local docker postgres, Playwright:
  - `seed-local-company-2` (3 entitlement rows): API now returns ADMIN raw=186 effective=86,
    FINANCE raw=187 effective=55, OWNER raw=311 effective=101; the card renders "0 คน · 86 สิทธิ์".
  - `seed-local-company` (no entitlement rows → documented fail-open): effective == raw, unchanged.
  - Lock icon: `viewBox="0 0 20 20"` present, `getBBox` fits inside it, rendered 16×16 — glyph complete.
  - Before/after screenshots of dashboard, expenses, employees, reimbursements, roles: no icon
    regressions from the loader change.

## Next / not done

- `EmployeeAccessPages.tsx` (legacy roles list) still prints raw `permissionKeys.length` — out of scope.
- No automated guard against a future `viewBox` strip; the check lived in a throwaway Playwright spec.
- `apps/web/next-env.d.ts` gets rewritten by `next dev` with a custom `NEXT_DIST_DIR`; it was restored
  after verification (see the note in `playwright.config.ts`).
