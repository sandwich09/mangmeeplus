# Agent Memory: Employee title prefix as its own field

Status: BLOCKED, not started — waiting for another session to commit two files this work must edit. Owner decisions below are final; only the edit window is missing.
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

Verification: not started. When it runs: focused specs for create/update carrying `titlePrefix`, a case proving `displayName` no longer contains a title, `tsc --noEmit` across api/web/contracts, and the api + web suites.

Next:
1. Wait for the other session to commit `update-employee.use-case.ts`, `update-employee-branch-scope.spec.ts`, and `AddEmployeePrototypePage.tsx`. A background watch is armed on exactly those paths.
   - Note: the first watch was wrong and fired immediately — zsh does not word-split an unquoted variable, so the pathspec became one nonexistent path and `git status` was trivially empty. Literal paths, not a variable.
2. Then implement in the order above, API before web, so the web form has a field to send.
