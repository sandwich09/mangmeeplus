# Agent Memory: Employee title prefix as its own field

Status: COMPLETE 2026-08-15 — all eight files done and green. Create, update, and the employee form now keep คำนำหน้า in its own column; nothing guesses it out of `displayName` except an explicit fallback for pre-split rows. Owner decisions below are final.
Owner: develop
Scope: Give `EmployeeAccessProfile` a real `titlePrefix` field instead of concatenating คำนำหน้า into `displayName`, and remove the two places that reverse-engineer it by `startsWith`.

Decisions:
- UAT 2026-08-15: an admin corrected her คำนำหน้า from นาย to นางสาว and the sidebar kept greeting her as นายมีนา ใจงาม. Two separate causes were found. (1) The shell name comes from the global `User` row via `/auth/me` ([auth.controller.ts:609](../../apps/api/src/modules/auth/presentation/auth.controller.ts)), and a company-scoped rename did not reach it — fixed by another session, which syncs `displayName` onto `User` but deliberately skips a cross-company shared login. (2) The title has no field of its own, so nothing about it is addressable.
- Shipped first as a display-level workaround in `d0c3e5c`: `stripThaiTitlePrefix` at the shell boundary. Owner then asked the right question — "ทำไมไม่แยกฟิลด์?" — and the answer is that `EmployeeAccessProfile` already separates `firstName`/`lastName`/`nickname`; only `titlePrefix` was ever missing. The strip is a second guess layered on the first, not a fix.
- **Owner decision — storage shape (option A):** after the split, `displayName` carries NO title. `titlePrefix: 'นางสาว'` and `displayName: 'มีนา ใจงาม'` are separate. The rejected option B (keep the title inside `displayName` and add `titlePrefix` alongside) would have forced two values to stay in sync forever and kept the strip helper alive.
- **Owner decision — no backfill.** The product has no real users yet, so existing rows may stay garbage. This removes the risky half of the migration: add a nullable column, let new and updated records write the clean shape, do not rewrite history and do not audit every existing `displayName` reader.
- **Owner decision — the sidebar keeps hiding the title.** Under option A that becomes automatic, since `displayName` no longer contains one. `stripThaiTitlePrefix` then has nothing to strip; keep it as a safety net for rows written before the split rather than deleting it in the same change.

Owner-account impact (checked 2026-08-15, before starting):
- The OWNER is created on a completely different path and **has no `EmployeeAccessProfile` at all**. [create-company-onboarding.use-case.ts](../../apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts) creates only `User`, `CompanyMembership`, and `MembershipRole`; `create-employee.use-case.ts` is the sole writer of profiles.
- Therefore `titlePrefix` — a column on `EmployeeAccessProfile` — **does not reach an owner**. Nothing to write, nothing to read.
- The owner also never appears in the employee list: [list-employees.use-case.ts:11](../../apps/api/src/modules/employee-access/application/use-cases/list-employees.use-case.ts) reads `employeeAccessProfile` only. So an owner cannot edit their own name there today and will not gain a title picker from this work either.
- An owner's name comes from a single free-text input at registration ([SystemOnboardingNewPage.tsx:489](../../apps/web/src/features/system-onboarding/SystemOnboardingNewPage.tsx)) — there is no คำนำหน้า picker on that form, so any "นาย" in an owner's name was typed deliberately by a human, not composed by the system.
- **Owner decision 2026-08-15: leave it.** The already-shipped shell strip (`d0c3e5c`) therefore also strips a title an owner typed on purpose. Accepted knowingly, for consistency — the shell shows no title for anyone. The two alternatives were rejected as more machinery than the problem is worth: teaching `/auth/me` to report whether the session has a profile so only picker-sourced titles are stripped, or giving onboarding a title picker plus an owner profile.

Open questions:
- None blocking. Whether to delete `stripThaiTitlePrefix` once no un-split rows remain is a later cleanup, not part of this slice.

Artifacts (planned — 8 files, 2 currently held by another session):
- `apps/api/prisma/schema.prisma` — `titlePrefix String?` on `EmployeeAccessProfile`, plus an additive migration with no backfill
- `packages/contracts/src/employee-access.ts` — the three shapes at lines 29/59/81 that already carry `displayName` + `firstName`
- `apps/api/src/modules/employee-access/presentation/http/employee-access.dtos.ts`
- `apps/api/src/modules/employee-access/application/dto/employee-access.mapper.ts`
- `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts`
- ✋ `apps/api/src/modules/employee-access/application/use-cases/update-employee.use-case.ts` — held
- ✋ `apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx` — held; composes at line 389 (`${title}${fullName}`) and reverse-engineers at lines 52-56
- `apps/web/src/features/employee-access/EmployeeAccessPages.tsx`, `IndividualPermissionsPrototypePage.tsx` — render `displayName`

Landed 2026-08-15 (six files, no conflicts):
- `schema.prisma` + migration `20260815000000_employee_title_prefix` — `titlePrefix TEXT` nullable, no backfill.
- `employee-access.ts` — `EMPLOYEE_TITLE_PREFIXES`, `EmployeeTitlePrefix`, `employeeFullName`, and `titlePrefix` on all three shapes. `displayName` is documented as the name WITHOUT the title.
- `employee-access.dtos.ts` — `@IsIn(EMPLOYEE_TITLE_PREFIXES)` on create and update, so the column can only ever hold a real คำนำหน้า. The update DTO accepts it already even though the use case cannot store it yet.
- `employee-access.mapper.ts` — surfaces `titlePrefix`, null on pre-split rows.
- `create-employee.use-case.ts` — persists it on both profile creates and on the resumed-draft update. `User.displayName` deliberately keeps the bare name: the account name is the person, the title is a profile field.
- `EmployeeAccessPages.tsx` — the two employee lists render `employeeFullName`; `InitialAvatar` stays on the bare `displayName`, because initials must never start at the title.
- The controller needed no change: it spreads `...body`, so `titlePrefix` reaches the create command on its own.

Landed 2026-08-15, second pass (the two previously held files — owner said to go ahead while they were still uncommitted in the other session's tree; their `User.displayName` sync was edited on top of, never reverted):
- `update-employee.use-case.ts` — one line. `UpdateEmployeeCommand` is `UpdateEmployeeInput & {...}`, so it already inherited `titlePrefix` from the contract; only the profile write was missing. Without it the update controller's `...body` spread dropped the field silently, and TypeScript could not catch that — a spread is not an object-literal excess-property check.
- `AddEmployeePrototypePage.tsx` — sends `displayName` as the bare name plus `titlePrefix`. The local `displayName` that composed `${title}${fullName}` is renamed `previewName`: naming the preview after the stored field is what made the title look like part of the name in the first place. `employeeTitle()` now reads `employee.titlePrefix` and keeps the `startsWith` guess only as a fallback for pre-split rows, alongside a new `employeeNameWithoutTitle()` that does not slice a split row.

Remaining cleanup (not blocking):
- Delete the `startsWith` fallback in `employeeTitle()` and `stripThaiTitlePrefix` in the shell once no pre-split rows remain. Both are dead weight for any record written after this change, and harmless until then.

Verification (2026-08-15, six-file slice):
- `CI=true corepack pnpm --filter @watchdog-bms/contracts test`: pass 125/125 — 4 new `employeeFullName` cases including "นายก" surviving intact, which the old concatenation could not do.
- `node_modules/.bin/tsx --test src/modules/employee-access/application/use-cases/create-employee.use-case.spec.ts`: pass 23/23 — 3 new: title stored beside a title-free `displayName` and never written to `User`, a corrected title carried through a resumed draft, and no title invented when none is sent.
- `CI=true corepack pnpm --filter @watchdog-bms/api test`: pass, exit 0 · `--filter @watchdog-bms/web test`: pass 901/901
- `prisma:validate` pass, `prisma generate` pass, `tsc --noEmit` pass across api and web.
- NOT verified: no migration was applied to a running database (no local stack up), so the column exists in schema and migration only.

Verification (2026-08-15, second pass):
- `node_modules/.bin/tsx --test src/modules/employee-access/application/use-cases/update-employee-branch-scope.spec.ts`: pass 17/17 — 1 new: a corrected title lands in its own column, `displayName` stays bare, and `User` receives the name without a title.
- `CI=true corepack pnpm --filter @watchdog-bms/api test`: pass, exit 0 · `--filter @watchdog-bms/web test`: pass 901/901 · `tsc --noEmit` pass across api and web.

Next:
1. Apply the migration wherever this deploys — `prisma migrate deploy`. The column exists in schema and migration only; no running database has it yet, and the API will fail selecting it until then.
2. Re-run the UAT that started this: change a คำนำหน้า, confirm the employee page shows the new title, and confirm the sidebar shows the bare name (it hides the title by owner decision, so it should read มีนา ใจงาม either way).
