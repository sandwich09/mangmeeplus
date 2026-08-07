# Agent Memory: Cross-company employee attach (owner of A → employee of B)

Status: Implemented + deploy-ready (2026-07-12). Migration applied to the local dev DB; full test
suite, both production builds, and a real-Postgres integration smoke all pass. Not yet driven through
the live web UI end-to-end.

Owner: (supapron)

Scope: Let an existing user (e.g. the OWNER of company A) become an employee of company B by
attaching a second `CompanyMembership` to their existing `User` instead of minting a duplicate login.
The data model already allowed this (`CompanyMembership @@unique([companyId, userId])`, roles per
`MembershipRole`, no company FK on `User`); the gap was `CreateEmployeeUseCase` always calling
`user.create()`. Mirrors the existing `attachExistingOwner` mode in `create-company-onboarding.use-case.ts`.

Decisions:
- Match the existing account by **username** (case-insensitive), not by national ID — owners are created
  via onboarding and have **no `EmployeeAccessProfile`, so no `identityHash`** to match on.
- Consent model = **confirm before linking** (user choice). First submit throws a soft conflict
  `employee_existing_user`; the wizard shows a confirm banner; re-submit carries `linkExistingUser: true`.
- Attaching **never** touches the shared account: no password reset, no username/email/displayName
  overwrite, no temporary password issued (`reusedExistingAccount: true`, empty `temporaryPassword`).
  The new membership + profile start as DRAFT and activate through the normal `completeDraft` step.
- **Different email per company (2026-07-12 addition):** a person attached across companies must be
  addressable by a company-specific email, not the login email of the account they already own.
  Added `EmployeeAccessProfile.email String?` (per-company, like `phoneNumber`). Attaching now
  **requires** `email` and rejects it (`employee_email_must_differ`) if missing or equal (case-insensitive)
  to the existing `User.email`; it is stored on the profile, never on the shared `User`. `update-employee`
  routes a shared user's email edit to `profile.email` (same must-differ rule, skips global-unique check);
  a company-local user keeps email-on-User. Mapper shows `profile.email ?? user.email`. Login still keys
  off `User.email`/username. NOTE: this reverses the earlier schema comment "email lives on User, not here".
- Closed three cross-tenant credential/identity holes that shared users newly expose:
  1. `create-employee` resume-draft branch skips the user/credential mutation when the user belongs to
     another company (else re-submitting a still-DRAFT attach would reset the shared password).
  2. `regenerate-employee-credential` throws `ForbiddenException` for a shared user.
  3. `update-employee` skips the `User.email` overwrite for a shared user.
  Detection everywhere: `companyMembership.count({ where: { userId, companyId: { not } } }) > 0`.
- `set-employee-status` (disable/suspend) was already membership-scoped — safe, unchanged.

Open questions:
- National-ID-based auto-detection for people who already have a profile in another company is NOT
  implemented (username is the only signal). Add later if needed.
- Regenerate/update-email guards are covered by typecheck + the shared resume-guard test pattern but
  have no dedicated unit tests (no existing spec harness for those use-cases).

Artifacts:
- prisma: `schema.prisma` (`EmployeeAccessProfile.email String?`) +
  `migrations/20260712130000_employee_profile_email/migration.sql` (applied to local dev DB via
  `migrate deploy`; brought the DB current — it was 11 migrations behind).
- api: `create-employee.use-case.ts` (detect + `attachExistingUser` + resume guard + email-must-differ),
  `regenerate-employee-credential.use-case.ts`, `update-employee.use-case.ts` (email routing),
  `application/dto/employee-access.mapper.ts` (`profile.email ?? user.email`),
  `presentation/http/employee-access.dtos.ts` (`linkExistingUser`).
- contracts: `packages/contracts/src/employee-access.ts` (`linkExistingUser`, `reusedExistingAccount`).
- web: `features/employee-access/AddEmployeePrototypePage.tsx` (confirm banner + reused-account handoff),
  `common/i18n/workspace-dictionary.ts` (`employee.error.email_must_differ`, th+en).
- test: `create-employee.use-case.spec.ts` (+4: confirm-gate, attach, email-must-differ, resume-guard).

Verification (deploy-ready gate, 2026-07-12):
- Full api unit suite `npm test` → 1478/1479 pass; the 1 failure is pre-existing/unrelated
  (`s3-storage.adapter.spec.ts`: `Cannot find module '@aws-sdk/client-s3'` — dep not installed here).
- Migration chain proven deploy-safe: all 50 migrations applied cleanly to a fresh scratch DB, then
  `migrate deploy` applied the 11 pending to the real dev DB → `Database schema is up to date`; the
  `email` column confirmed via information_schema. (Pending migrations scanned first — all additive.)
- Production builds: api swc build OK; web `next build` → Compiled successfully.
- `tsc --noEmit` clean for api (minus the aws-sdk file) and web.
- Real-Postgres integration smoke (rolled-back tx, nothing persisted): `mode:'insensitive'` username
  match works, cross-company `count` works, and the new `EmployeeAccessProfile.email` write works.

Next (optional):
- Drive the real web UI end-to-end: add owner-of-A's username + a DIFFERENT company email in company B's
  AddEmployee, confirm the link, complete the draft, then confirm B appears in `GET /v1/auth/me/companies`,
  the employee shows the B email, and the company-A login still works. (DB seed may be older than schema.)
- DB connection landmine: dev/seeded Postgres is native on :5432 (`watchdog:watchdog_local_password@
  localhost:5432/watchdog_bms`); `.env` DATABASE_URL points at :15433 (compose, not running here).
