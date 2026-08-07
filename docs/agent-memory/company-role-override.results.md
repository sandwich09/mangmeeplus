# Agent Memory: company-role-override results

Status: implemented; source checks and local test equivalents pass; literal `pnpm` verification is environment-blocked
Owner: Codex (implementer), Claude (verifier on return)
Scope: company copy-on-write overrides for editable system roles, role-list de-duplication, permission-matrix UI gating, and plan step 7 tests
Decisions: kept permission compilation before the transaction; kept fork creation, permission copy, tenant-scoped membership repoint, role update, permission replacement, and both audit rows in one transaction
Open questions: none in the implementation; the verification environment needs the pinned `pnpm` and the already-declared `heic-to` dependency installed

## Diff summary

- Contracts: added `NON_EDITABLE_ROLE_KEYS` and `isRoleEditableByCompany`, exported through the existing `employee-access` wildcard barrel, and added predicate coverage to the contracts test script.
- API update: editable system roles now resolve or create one `(companyId, key)` fork, copy source permissions for name-only edits, move only memberships whose related membership belongs to the requesting company, and continue all writes/audits against the fork ID.
- API list: a company-scoped role hides the system role with the same key before summaries and effective counts are projected. `GetAccessMatrixUseCase` inherits this through `ListRolesUseCase`.
- Web: editable standard roles expose `แก้ไข`, keep `ปิดใช้งาน` hidden, and show the requested copy/membership/other-company notice in edit mode. Protected keys show the requested muted lock note.
- Tests: covered all protected keys, permission-copy and requested-set replacement, unchanged source permissions, tenant-isolated membership movement, stale system-ID idempotency, fork/update audits, and list de-duplication.

## Verification evidence

Requested commands were each invoked, but this shell has no `pnpm` executable:

- `pnpm --filter @watchdog-bms/contracts test` → exit 127, `zsh: command not found: pnpm`.
- `pnpm --filter @watchdog-bms/api test` → exit 127, `zsh: command not found: pnpm`.
- `pnpm --filter @watchdog-bms/web typecheck` → exit 127, `zsh: command not found: pnpm`.

Corepack could not supply the pinned `pnpm@9.15.0`: its default cache is outside the writable sandbox; with `COREPACK_HOME` redirected to `/private/tmp`, download failed because registry DNS/network access is unavailable (`ENOTFOUND registry.npmjs.org`). The installed package binaries were therefore used directly:

- `tsc -p packages/contracts/tsconfig.json` → exit 0 (also refreshed ignored contract build artifacts needed by API/web runtime resolution).
- Contracts package's complete configured test list via `node --import tsx --test ...` → 45 tests, 45 passed, 0 failed.
- API package's complete configured test list, replacing only the IPC-opening `tsx` CLI entry with `node --import tsx` → exit 0; dot reporter showed all configured tests passing.
- Focused `role-management.use-case.spec.ts` → 15 tests, 15 passed, 0 failed.
- `tsc -p apps/api/tsconfig.json --noEmit` → exit 0.
- Web `next typegen` → exit 0. The ordinary project `tsc --noEmit` then stopped on an unrelated missing install: `Cannot find module 'heic-to/csp'` in `expense-upload.logic.ts`; `heic-to@1.5.2` is declared in `apps/web/package.json` and `pnpm-lock.yaml` but absent from this workspace's `node_modules`.
- Web project `tsc --noEmit` with a temporary generated declaration for only that missing external module → exit 0. The declaration was removed immediately; no source workaround was retained.
- `git diff --check` → exit 0.

## Plan deviations and exclusions

- Plan step 4 was skipped exactly as amended in the handoff because `GetAccessMatrixUseCase` calls `ListRolesUseCase`; no duplicate filter was added.
- No explicit `packages/contracts/src/index.ts` edit was needed because it already has `export * from './employee-access.js'`.
- The three literal `pnpm` commands could not execute for the environment reasons above; direct installed-binary equivalents were run instead.
- E2E `SET-04`, `SET-05`, and `SET-09` were not run; the handoff reserves those for Claude's return verification.
- `disable-role.use-case.ts` and `sync-permissions.ts` were not touched. Unrelated existing worktree changes were preserved.

## Permission refresh behavior

ERP API authorization has no effective-permission cache: it resolves membership roles and permissions from Prisma on each protected request. Affected employees therefore receive the new backend access on their next API request, and the web session/UI refreshes on the next reload or server navigation (`/auth/me` uses `cache: 'no-store'`). AI Gateway permissions are embedded in the access JWT, so that path can lag until token refresh or re-login, at most the current 15-minute access-token lifetime.

Artifacts: contracts/API/web changes plus this results file
Verification: evidence above
Next: install/enable the pinned `pnpm` and workspace dependencies, rerun the three requested commands literally, then run E2E `SET-04`, `SET-05`, and `SET-09` during Claude verification
