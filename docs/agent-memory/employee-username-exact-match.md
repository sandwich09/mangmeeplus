# Agent Memory: employee-username-exact-match

Status: implementation complete on `codex/employee-username-exact-match`; gates recorded below.
Follow-up (promoting the index to UNIQUE) is deliberately NOT in this branch — see
`docs/runbooks/username-case-uniqueness-followup.md`.

Owner: agent (branch `codex/employee-username-exact-match`, cut from `origin/develop` @ `cb709772`)

Scope:

- `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts` —
  the cross-company username reuse read.
- `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.spec.ts` —
  the in-memory fake that hid the bug.
- `apps/api/src/modules/employee-access/create-employee-username.pg.spec.ts` — new, real Postgres.
- `apps/api/package.json` — one appended path in the fixed `test` list (the only permitted edit).
- `apps/api/prisma/migrations/20260905140000_user_username_lower_idx/` + a pointer comment on
  `model User` in `apps/api/prisma/schema.prisma`.
- `docs/runbooks/username-case-uniqueness-followup.md`.

## The bug

`user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } })` compiles on
PostgreSQL to `"username" ILIKE $1` with the value bound raw and no LIKE-metacharacter escaping.
Usernames allow `_`, a single-character LIKE wildcard, so `som_hai` matched a stored `somchai`.

Two consequences, the second much worse than the first:

1. Without `linkExistingUser`: a free username was refused with `employee_existing_user`.
2. With `linkExistingUser: true`: the WRONG `User` row flowed into `attachExistingUser(...)`, so an
   account the admin never chose gained a `CompanyMembership` (DRAFT) in this company, with roles
   and an access profile. `EMAIL_MUST_DIFFER` does not catch it — the wrong account's login email
   differs from the company email too, so the guard passes and the attach proceeds.

Same class as the already-merged fix in `AccountProfileUseCase` (PR #416), whose style this mirrors.

## Decisions

- **Exact case-folded `$queryRaw`, not escaped ILIKE.** `lower("username") = ${username}` has no
  pattern semantics at all, so there is nothing to escape and nothing to get wrong later. Escaping
  `_`/`%`/`\` correctly for ILIKE would be more code and one refactor away from being wrong again.
- **No `.toLowerCase()` at the call site.** `username` is already `cmd.username.trim().toLowerCase()`
  (line 113 of the use case) and the same value is what gets INSERTed, so re-lowering would be dead
  code that hides where normalisation actually happens.
- **Selected fields unchanged** (`id, username, status, email`) and every downstream branch
  untouched: same conflict codes, same `linkExistingUser` path, same `LIMIT 1`/`findFirst`
  arbitrary-row semantics.
- **`User.email` was reviewed, not changed.** The nearby email comparison
  (`companyEmail.toLowerCase() === (existingUser.email ?? '').toLowerCase()`) is a JavaScript string
  compare on an already-fetched row — no SQL operator, no LIKE semantics. Its sibling in
  `update-employee.use-case.ts:116` (`where: { email: cmd.email }`) is exact and case-SENSITIVE, so
  it also has no LIKE exposure; whether email uniqueness should be case-folded is a separate
  question and out of scope here.
- **Index is NOT unique.** A unique functional index fails the migration outright if production
  already holds case-variant usernames, and production data cannot be read from here. Promotion is
  documented as a follow-up instead.
- **The fake is now hostile, not helpful.** It refuses any Prisma `mode:` clause and stubs
  `$queryRaw` with an SQL-shape assertion. The old fake answered `mode: 'insensitive'` as plain
  equality, which is exactly why 54 green unit tests never saw this.

## Sweep: every `mode: 'insensitive'` in `apps/api/src` (specs excluded)

Zero `equals`-style sites remain after this change. All 16 survivors are `contains` search filters.

| file:line | field | operator | gates | verdict |
| --- | --- | --- | --- | --- |
| `modules/employee-access/application/use-cases/create-employee.use-case.ts:270` | `User.username` | `equals` | **identity + uniqueness** — refuses the username, and picks which account `attachExistingUser` grants a membership to | **FIXED** — parameterised `lower("username") = $1` |
| `modules/crm-inbox/infrastructure/prisma-crm-inbox.repository.ts:545` | `Customer.displayName` | `contains` | search filter (inbox customer list, company-scoped) | leave — cosmetic |
| `modules/crm-inbox/infrastructure/prisma-crm-inbox.repository.ts:551` | `Conversation.lastMessagePreview` | `contains` | search filter (inbox conversation list, company-scoped) | leave — cosmetic |
| `modules/crm/infrastructure/prisma-crm.repository.ts:329` | `Customer.displayName` | `contains` | search filter (customer list) | leave — cosmetic |
| `modules/crm/infrastructure/prisma-crm.repository.ts:330` | `Customer.legalName` | `contains` | search filter (customer list) | leave — cosmetic |
| `modules/crm/infrastructure/prisma-crm.repository.ts:816` | `rawName` | `contains` | search filter (import/staging rows) | leave — cosmetic |
| `modules/crm/infrastructure/prisma-crm.repository.ts:1037` | `title` | `contains` | search filter | leave — cosmetic |
| `modules/inventory/infrastructure/repositories/prisma-location.repository.ts:31` | `Location.code` | `contains` | search filter (location list) | leave — cosmetic |
| `modules/inventory/infrastructure/repositories/prisma-location.repository.ts:32` | `Location.name` | `contains` | search filter (location list) | leave — cosmetic |
| `modules/inventory/infrastructure/repositories/prisma-product.repository.ts:30` | `Product.name` | `contains` | search filter (product list) | leave — cosmetic |
| `modules/inventory/infrastructure/repositories/prisma-product.repository.ts:31` | `Product.sku` | `contains` | search filter (product list) | leave — cosmetic |
| `modules/inventory/infrastructure/repositories/prisma-product.repository.ts:32` | `ProductBarcode.value` | `contains` | search filter — `list()` only; the scan/resolve path uses `findUnique`, so no stock movement is decided here | leave — cosmetic |
| `modules/line-ai/application/use-cases/erp-business-tools.use-case.ts:235` | `User.displayName` | `contains` | search filter — LINE AI employee lookup, gated on `access.employee.read` and `ctx.companyId` | leave — cosmetic (see note) |
| `modules/line-ai/application/use-cases/erp-business-tools.use-case.ts:236` | `EmployeeAccessProfile.displayName` | `contains` | as above | leave — cosmetic (see note) |
| `modules/line-ai/application/use-cases/erp-business-tools.use-case.ts:237` | `EmployeeAccessProfile.legalName` | `contains` | as above | leave — cosmetic (see note) |
| `modules/procurement/infrastructure/prisma-procurement.repository.ts:239` | `displayNameSnapshot` | `contains` | search filter (supplier list) | leave — cosmetic |
| `modules/system-partner-management/application/use-cases/lookup-users.use-case.ts:54` | `User.displayName` | `contains` | search filter — system console person lookup; the same `OR` matches `email`/`username` EXACTLY (no `mode`), read-only, no write follows | leave — cosmetic |
| `modules/workflow/infrastructure/prisma-workflow.repository.ts:125` | `name` | `contains` | search filter (workflow list) | leave — cosmetic |

Note on `erp-business-tools`: a wildcard can widen the candidate set, and on exactly one match the
tool returns that person's phone number. It is still only a company-scoped read the caller already
holds `access.employee.read` for, over a field that is a substring search **by design**, and it
decides no authorization and writes nothing — so it is a filter, not an identity gate. Recorded
here rather than silently dropped.

## Sweep: raw `LIKE`/`ILIKE` and raw SQL for unescaped user input

| site | pattern source | verdict |
| --- | --- | --- |
| `scripts/a5-capacity-mutating.pg.ts:60,67,96,119,155,166,205,209` | `fixtureEventPattern(marker)` = `` `${marker}:%` ``; `marker` is validated `^U5C-[0-9A-F]{12,32}$` before use | safe — no metacharacter can enter; the `%` is the intended wildcard; operator env var, not user input |
| `scripts/a5-capacity-mutating.pg.ts:156,167,174` (`${table}` interpolation) | `quotedIdentifier()` — `^[A-Za-z_][A-Za-z0-9_]*$` plus quote doubling, over a fixed constant list | safe |
| `scripts/a5-readonly-evidence.logic.ts:564-565,589-590,606-607` | literal `'pg_toast%'` / `'pg_temp_%'` catalogue filters | safe — no input |
| `modules/inventory/infrastructure/repositories/prisma-movement.repository.ts:85`, `modules/procurement/infrastructure/prisma-procurement.repository.ts:853` | `$executeRawUnsafe('… hashtext($1)', value)` | safe — parameterised, no LIKE |
| `modules/health/application/use-cases/get-health.use-case.ts:25` | literal `SELECT 1` | safe |
| `scripts/production-a5-evidence.pg.ts` (all `$queryRawUnsafe`) | template text is static; no `${}` inside any SQL string | safe |

## Mutation results

Both mutations were applied to the fixed use case and reverted afterwards.

| mutation | `create-employee-username.pg.spec.ts` | `create-employee.use-case.spec.ts` |
| --- | --- | --- |
| none (the fix as shipped) | **pass 1 / fail 0** | **pass 54 / fail 0** |
| restore `{ equals: username, mode: 'insensitive' }` | **FAIL** — `` `_` is a LIKE wildcard: nobody holds som_hai``, actual `'existing-user'`, expected `'created'` | **FAIL 37 / pass 11** — `case-insensitive Prisma filters are not modelled here` |
| drop `lower()` (`WHERE "username" = $1`) | **FAIL** — `case-folded equality still catches the real collision`, actual `'created'`, expected `'existing-user'` (this is what the mixed-case `SomChai` seed is for) | pass (in-memory fake compares the lower-cased value either way — which is precisely why the pg spec exists) |

## Artifacts

- Fix: `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts:270`
- Hostile fake: `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.spec.ts:150`
- New real-Postgres spec: `apps/api/src/modules/employee-access/create-employee-username.pg.spec.ts`
  (skips without `EMPLOYEE_ACCESS_TEST_DATABASE_URL`; refuses any database not named `watchdog_bms`)
- Migration: `apps/api/prisma/migrations/20260905140000_user_username_lower_idx/migration.sql`
- Follow-up: `docs/runbooks/username-case-uniqueness-followup.md`
- Reference this mirrors: `apps/api/src/modules/auth/application/use-cases/account-profile.use-case.ts:116`
  and `apps/api/src/modules/auth/account-profile-username.pg.spec.ts`

## Verification

Run from `apps/api` unless noted. Local DB
`postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public`.

| check | result |
| --- | --- |
| `EMPLOYEE_ACCESS_TEST_DATABASE_URL=… npx tsx --test src/modules/employee-access/create-employee-username.pg.spec.ts` | tests 1 · suites 1 · pass 1 · fail 0 · skipped 0 |
| api `pretest` list (5 spec paths) | tests 30 · suites 5 · pass 16 · fail 0 · skipped 14 · todo 0 |
| api `test` list (456 spec paths), no pg env | tests 6449 · suites 1311 · pass 6350 · **fail 0** · cancelled 0 · skipped 99 · todo 0 — new spec reports `ok 556 … # SKIP`, same as `account-profile-username.pg.spec.ts` |
| api `test` list, `EMPLOYEE_ACCESS_TEST_DATABASE_URL` set | tests 6450 · suites 1311 · pass 6351 · **fail 0** · cancelled 0 · skipped 99 · todo 0 — new spec reports `ok 556` (ran against local docker inside the full suite) |
| `pnpm -r typecheck` | 7/8 workspace projects, all `Done`, 0 errors (config, contracts, design-tokens, api, ai-gateway, web, workers) |
| `npx prisma validate` | `The schema at prisma/schema.prisma is valid` |
| `npx prisma migrate deploy` (local) | 170 migrations found; applied `20260905140000_user_username_lower_idx` |
| `prisma migrate diff --from-schema --to-migrations --script` | **byte-identical before and after** (28 lines of pre-existing, unrelated drift both times) — expression indexes are invisible to it, same as `CompanySignupRequest_line_open_key` |
| `EXPLAIN` on `lower("username") = $1` | before: `Seq Scan on "User"`; after (`enable_seqscan=off` to force the choice on a 97-row local table): `Index Scan using "User_username_lower_idx"` |
| `node infra/security/sync-production-maintenance-release-pins.mjs --check` | `exactFiles=45 validatorSha256=452265ed… status=current` — no pinned file touched |
| leftover rows after the pg spec | 0 `User` and 0 `Company` rows matching the spec tag |

## Open questions

- Does production hold any case-variant usernames today? Cannot be read from a development
  checkout. The detection query is step 1 of the follow-up runbook; the answer decides whether the
  index can be promoted to UNIQUE.
- `User.email` uniqueness is case-SENSITIVE at the database level and compared case-insensitively in
  JavaScript in two places. Not a LIKE-injection issue, so it was left alone — but the same
  "two rows a human reads as one identity" race exists for email as for username.

## Next

1. Open the PR from `codex/employee-username-exact-match` into `develop`.
2. On the next production access window, run step 1 of
   `docs/runbooks/username-case-uniqueness-followup.md` and record the row count there.
3. If it reports zero, land the UNIQUE promotion migration exactly as written in that runbook.
