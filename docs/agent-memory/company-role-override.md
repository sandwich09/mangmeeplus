# Agent Memory: company-role-override

Status: verified — implemented by Codex, independently verified by Claude 2026-07-31; ready for commit/review
Owner: Claude (harness engineer / verifier), Codex (implementer)
Scope: owner/admin edits standard (system-seeded) roles; edits saved as company-scoped copies
Spec: `docs/specs/company-role-override-spec.md`
Plan: `docs/plans/company-role-override-plan.md`

## Product requirement (from owner, 2026-07-31)

1. Master data: system roles seeded at company onboarding stay platform-owned and are never
   mutated (they are correct as seeded).
2. Company owner — or an admin holding `access.role.manage` — must be able to edit roles **lower
   than their own** (a non-owner can never grant a permission they do not hold themselves —
   enforced by existing `ownerGatedGrantViolation`).
3. Any permission change is saved **as that company's own role** (copy-on-write fork,
   `scopeKey: companyId`), never onto the shared system row.

## Decisions

- Copy-on-write override per spec R1–R8. No schema migration.
- `NON_EDITABLE_ROLE_KEYS = ['OWNER', 'SYSTEM_ADMIN', 'COMPANY_VIEW']` stay 403.
- De-dup (hide system role once an override with the same key exists) lives in
  `ListRolesUseCase` only — `GetAccessMatrixUseCase` reuses it, so plan step 4 is a no-op.
- "Lower role" enforcement = existing `ownerGatedGrantViolation` + `compileRole` granter scope.
  No new privilege model.

## Verified assumptions (checked against code 2026-07-31, do not re-derive)

- `apps/api/prisma/schema.prisma` — `Role.companyId String?`, `@@unique([scopeKey, key])` (L558);
  `MembershipRole` has `membership` relation to `CompanyMembership` (L594). Plan's repoint query
  is valid as written.
- `update-role.use-case.ts` — permission compilation happens **before** the `$transaction`
  (L31–51); keep that order. The blanket guard to replace is L28.
- `get-access-matrix.use-case.ts` — injects and calls `ListRolesUseCase` (L6, L17).
- Web gate: `PermissionMatrixPrototypePage.tsx` L190 `canEditRoles`, L323 `{!selectedRole.isSystem
  && ...}` action bar.
- `RoleSummary` in `packages/contracts/src/employee-access.ts` already carries `key` + `isSystem`
  (L131) — the web predicate needs no contract change beyond the new constant/predicate.

## Handoff to Codex — implementation instructions

Implement exactly `docs/plans/company-role-override-plan.md` with these amendments:

- **Skip plan step 4** (`get-access-matrix.use-case.ts`): it reuses `ListRolesUseCase`; the
  de-dup in step 3 covers it. Do not duplicate the filter.
- Ponytail full mode applies (`.agents/skills/ponytail/SKILL.md`): shortest correct diff,
  existing patterns, no new dependencies, no speculative abstractions.
- Order of work: contracts constant/predicate → `update-role.use-case.ts` fork logic →
  `list-roles.use-case.ts` de-dup → web page gating/banners → tests (plan step 7).
- The fork + membership repoint + permission copy + audit rows must be **one** `$transaction`.
  A partial apply may not leave any employee role-less (plan Risks §1).
- Do not touch `disable-role.use-case.ts` or `sync-permissions.ts`.
- Run the verification commands below yourself before returning; include their output in your
  result summary, or the exact reason a command was not run.

## Acceptance criteria (Claude verifies each; from spec §Acceptance)

1. Owner edits `Admin` → save succeeds; company-scoped fork created, `isSystem: false`, same `key`.
2. This company's memberships repointed to the fork; **another company's memberships and the
   system role's RolePermission rows byte-for-byte unchanged**.
3. Role list shows exactly one `Admin` after override exists (and matrix agrees).
4. Second edit updates the fork in place — no second fork row.
5. `OWNER`/`SYSTEM_ADMIN`/`COMPANY_VIEW` update → 403 with reason.
6. UI: pre-save notice on system-role edit (copy semantics, N employees move, other companies
   unaffected); non-editable roles show the muted lock note; `ปิดใช้งาน` still hidden for
   system roles.
7. Audit rows: `ACCESS_ROLE_CREATE` (fork, `forkedFromRoleId`, `movedMemberships`, HIGH) and
   `ACCESS_ROLE_UPDATE`.

## Verification (run independently by Claude, 2026-07-31 — all pass)

- `corepack pnpm --filter @watchdog-bms/contracts test` → 45/45 pass (includes new
  `employee-access.spec.ts` predicate coverage).
- `corepack pnpm --filter @watchdog-bms/api test` (full configured suite) → exit 0, no failures;
  focused `role-management.use-case.spec.ts` → 15/15 pass.
- `corepack pnpm --filter @watchdog-bms/web typecheck` → pass. (First run failed on pre-existing
  missing install `heic-to/csp` in expenses; fixed by `pnpm install --frozen-lockfile` — an
  environment gap, not this change. Codex hit the same and left no stub behind — confirmed.)
- e2e `SET-04`, `SET-05`, `SET-09` → 3/3 pass (after `npx playwright install chromium`; Redis
  ECONNREFUSED warnings from webServer are unrelated noise).
- Manual diff review vs spec R1–R8 — confirmed: fork idempotency via
  `scopeKey_key: { scopeKey: companyId, key }` lookup; membership repoint scoped by
  `membership: { companyId: cmd.companyId }`; single `$transaction` covers fork + permission copy
  + repoint + audits + update; compile-before-transaction order preserved; system role rows never
  written; de-dup lives only in `ListRolesUseCase` (matrix inherits); `disable-role` and
  `sync-permissions` untouched. Acceptable deviation: `ACCESS_ROLE_CREATE` audit written only when
  the fork is actually created (not on idempotent reuse) — more correct than the plan's wording.
- Test coverage confirms acceptance criteria 1–5 + 7: cross-tenant isolation (other company's
  membership stays on system role), source `RolePermission` rows unchanged, one fork per key, all
  `NON_EDITABLE_ROLE_KEYS` → 403, name-only edit copies full permission set, list shows one row
  per key.
- Permission pickup (criterion in plan Risks §2): API resolves permissions per request (no cache)
  → employees get new access on next request; web UI on next reload (`/auth/me` is `no-store`);
  AI Gateway lags at most the 15-minute access-token lifetime. Recorded in results doc §Permission
  refresh behavior.

## Open questions

None blocking. Out of scope confirmed by spec: reset-to-default, per-employee overrides,
clickable matrix cells.

## Artifacts

- `docs/specs/company-role-override-spec.md`
- `docs/plans/company-role-override-plan.md`
- Results (Codex to create): `docs/agent-memory/company-role-override.results.md`

## Next

Done — all verification passed. Remaining: owner reviews and commits the change set
(contracts, api use-cases + spec, web page, docs). Spec status in
`docs/specs/company-role-override-spec.md` can move from draft → implemented on commit.
