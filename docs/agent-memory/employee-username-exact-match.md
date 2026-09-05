# Agent Memory: employee-username-exact-match

Status: implementation complete on `codex/employee-username-exact-match`; gates recorded below.
Two follow-ups are deliberately NOT in this branch, both documented in
`docs/runbooks/username-case-uniqueness-followup.md`: promoting the index to UNIQUE, and the
writer/login case-folding that must ship before it.

Owner: agent (branch `codex/employee-username-exact-match`, cut from `origin/develop` @ `cb709772`)

Scope:

- `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts` —
  the cross-company username reuse read, and its two P2002 catch blocks.
- `apps/api/src/common/database/prisma-error.ts` — new, shared `uniqueConstraintFields()`.
- `apps/api/src/modules/auth/application/use-cases/account-profile.use-case.ts` (+ its spec) —
  the second dead `meta.target` reader.
- `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.spec.ts` —
  the in-memory fake that hid bug 1.
- `apps/api/src/modules/employee-access/create-employee-username.pg.spec.ts` — new, real Postgres.
- `apps/api/package.json` — one appended path in the fixed `test` list (the only permitted edit).
- `apps/api/prisma/migrations/20260905140000_user_username_lower_idx/` + a pointer comment on
  `model User` in `apps/api/prisma/schema.prisma`.
- `docs/runbooks/username-case-uniqueness-followup.md`.

## Bug 1 — the ILIKE username lookup

`user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } })` compiles on
PostgreSQL to `"username" ILIKE $1` with the value bound raw and no LIKE-metacharacter escaping.
`employee-access.dtos.ts:31` allows `_`, a single-character LIKE wildcard, so `som_hai` matched a
stored `somchai`. (`%` is rejected by that same DTO pattern, so `_` is the only wildcard reachable
over HTTP — the `som%` case in the spec is defence in depth, not a live route.)

Two consequences, the second much worse than the first:

1. Without `linkExistingUser`: a free username was refused with `employee_existing_user`.
2. With `linkExistingUser: true`: the WRONG `User` row flowed into `attachExistingUser(...)`, so an
   account the admin never chose gained a `CompanyMembership` (DRAFT) in this company, with roles
   and an access profile. `EMAIL_MUST_DIFFER` does not catch it — the wrong account's login email
   differs from the company email too, so the guard passes and the attach proceeds.

Same class as the already-merged fix in `AccountProfileUseCase` (PR #416), whose style this mirrors.

## Bug 2 — every unique-violation translation was dead in production

Found while reviewing bug 1. Under Prisma 7.8 + `@prisma/adapter-pg`, P2002 arrives with
`meta.target === undefined`; the columns are at `meta.driverAdapterError.cause.constraint.fields`.
Probed directly against the local docker Postgres:

```
code: 'P2002'
meta: { modelName: 'User', driverAdapterError: { cause: {
  originalCode: '23505', kind: 'UniqueConstraintViolation',
  constraint: { fields: ['username'] } } } }
```

Both readers in this change's scope knew only `meta.target`, so both were no-ops (two more readers
elsewhere have the same blindness and are deliberately left for a separate decision — see Open
questions):

| Site | Dead codes |
| --- | --- |
| `create-employee.use-case.ts` (BOTH catch blocks) | `employee_username_conflict`, `employee_phone_conflict`, `employee_email_conflict`, `employee_identity_conflict` |
| `account-profile.use-case.ts` | `username_taken`, `password_already_set` |

**Severity, measured rather than assumed:** this is not a 500. The raw error reaches
`AllExceptionsFilter`, which maps P2002 to a **409** — but a generic one (`Duplicate value: a record
with the same unique field(s) already exists.`) carrying no `code`, because that filter reads
`meta.target` too. The web wizard keys its Thai field-level message off the code
(`EMPLOYEE_CONFLICT_KEYS`), so the user got a generic English message that could not name the field.

A unique **functional** index reports its expression truncated at the first `(` — a violation of
`(lower("username"))` arrives as `['lower(username']`, confirmed by probe. The helper normalises
that back to `username`, otherwise the documented UNIQUE promotion would silently re-break the
translation the day it lands.

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
- **One shared `uniqueConstraintFields()`**, not a fix per call site. It reads `meta.target` FIRST
  (still the non-adapter shape, and what the unit fakes model), falls back to the adapter shape, and
  normalises the functional-index form. The local `uniqueConstraintTarget` in `create-employee` was
  deleted rather than aliased.
- **`AllExceptionsFilter` and `DataRightsService` deliberately left alone**, though both have the
  same blindness. The filter's spec (`all-exceptions.filter.spec.ts:96`) requires a string ARRAY
  specifically so a bare `target` — an index *name*, not a column list — cannot enrich a
  client-facing body: a stricter, security-boundary rule than these use cases need, and widening
  what may leave that filter is a decision rather than a patch. `data-rights` degrades to the wrong
  code rather than to no code, which is milder than what was fixed here. Both are recorded as open
  questions to settle in one change, not silently folded into this one.
- **`update-employee.use-case.ts` needed no change**: it has no P2002 translation at all, only
  read-then-write pre-checks.
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
  equality, which is exactly why 48 green unit tests never saw bug 1 — and it never enforced
  uniqueness at all, which is why none of them saw bug 2 either.

## Sweep: every `mode: 'insensitive'` in `apps/api/src` (specs excluded)

Zero `equals`-style sites remain after this change. All **17** survivors are `contains` search
filters (17 grep hits; `prisma-crm.repository.ts:816` carries two `contains` on one line, only one
of which is `insensitive`).

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

Every mutation was applied to the shipped code and reverted afterwards. Counts are `tests`, not the
dot reporter's dot count (which adds one dot per suite — the 48-test spec prints 54 dots).

| mutation | `create-employee-username.pg.spec.ts` | `create-employee.use-case.spec.ts` | `account-profile.use-case.spec.ts` |
| --- | --- | --- | --- |
| none (as shipped) | tests 3 · **pass 3 · fail 0** | tests 48 · **pass 48 · fail 0** | tests 23 · **pass 23 · fail 0** |
| restore `{ equals: username, mode: 'insensitive' }` | tests 3 · **pass 2 · fail 1** — `` `_` is a LIKE wildcard: nobody holds som_hai``, actual `'employee_existing_user'`, expected `'created'` | tests 48 · **pass 11 · fail 37** — `case-insensitive Prisma filters are not modelled here` | unaffected |
| drop `lower()` (`WHERE "username" = $1`) | tests 3 · **pass 2 · fail 1** — `case-folded equality still catches the real collision` (what the mixed-case `SomChai` seed is for) | tests 48 · **pass 11 · fail 37** — the fake's SQL-shape assertion no longer matches the query | unaffected |
| remove the `driverAdapterError` branch from `uniqueConstraintFields` | tests 3 · **pass 1 · fail 2** — BOTH translation tests depend on it; the first reports actual `` 'uncaught:PrismaClientKnownRequestError:P2002:… Unique constraint failed on the fields: (`username`)' ``, expected `'employee_username_conflict'` | unaffected — its fake never enforced uniqueness at all | tests 23 · **pass 22 · fail 1** — the read-vs-write race test |
| drop the `lower(` normalisation from `uniqueConstraintFields` | tests 3 · **pass 2 · fail 1** — actual `` '… Unique constraint failed on the fields: (`lower(username`)' ``, expected `'employee_username_conflict'` | unaffected | unaffected |

Two cells in an earlier revision of this file were wrong, both now re-measured rather than reasoned
about: the drop-`lower()` mutation was recorded as PASSING the unit spec (it fails 37 of 48 — the
fake's SQL-shape assertion catches it), and the remove-adapter-branch mutation as `pass 2 · fail 1`
(that figure predated the third pg test, which depends on the same branch; it is `pass 1 · fail 2`).

## Artifacts

- Bug 1 fix: `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts:270`
- Bug 2 fix: `apps/api/src/common/database/prisma-error.ts`, wired at **10 call sites** — 9 in
  `create-employee.use-case.ts` (`:244-246`, `:400-408`, `:518-519`) and 1 in
  `account-profile.use-case.ts:139`
- Hostile fake: `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.spec.ts:150`
- Adapter-shaped fake + the read-vs-write race test that reaches the translation at all:
  `apps/api/src/modules/auth/application/use-cases/account-profile.use-case.spec.ts:62,238`
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
| new pg spec alone, env set | tests 3 · suites 1 · pass 3 · fail 0 · skipped 0 |
| api `pretest` list (5 spec paths) | tests 30 · suites 5 · pass 16 · fail 0 · skipped 14 · todo 0 |
| api `test` list (456 spec paths), no pg env | tests 6450 · suites 1311 · pass 6351 · **fail 0** · cancelled 0 · skipped 99 · todo 0 — new spec reports `ok 556 … # SKIP`, same as `account-profile-username.pg.spec.ts` |
| api `test` list, `EMPLOYEE_ACCESS_TEST_DATABASE_URL` set | tests 6453 · suites 1311 · pass 6354 · **fail 0** · cancelled 0 · skipped 99 · todo 0 — the three pg tests run against local docker inside the full suite |
| `apps/api/package.json` | 456 spec paths, 0 duplicates; the only edit is one appended path |
| `pnpm -r typecheck` | 7/8 workspace projects, all `Done`, 0 errors (config, contracts, design-tokens, api, ai-gateway, web, workers) |
| `npx prisma validate` | `The schema at prisma/schema.prisma is valid` |
| `npx prisma migrate deploy` (local) | 170 migrations found; applied `20260905140000_user_username_lower_idx` |
| `prisma migrate diff --from-schema --to-migrations --script` | **byte-identical before and after** (28 lines of pre-existing, unrelated drift both times) — expression indexes are invisible to it, same as `CompanySignupRequest_line_open_key` |
| `EXPLAIN` on `lower("username") = $1` | before: `Seq Scan on "User"`; after (`enable_seqscan=off` to force the choice on a 97-row local table): `Index Scan using "User_username_lower_idx"` |
| `node infra/security/sync-production-maintenance-release-pins.mjs --check` (in the worktree) | `exactFiles=45 validatorSha256=452265ed… status=current` — no pinned file touched |
| leftover rows after the pg spec | 0 `User` and 0 `Company` rows matching the spec tag |

## Open questions

- **Two `meta.target`-only readers remain, both out of scope here and best decided together:**
  - `all-exceptions.filter.ts:97` — the global fallback, so any P2002 NOT translated by a use case
    still answers a field-less generic 409. Fixing it means deciding whether adapter-reported
    constraint fields may enrich a client body; its spec currently forbids even a bare `meta.target`
    string, on the grounds that an index name is not a column list. A deliberate security-boundary
    rule, not an oversight — so widening it is a decision, not a patch.
  - `data-rights.service.ts:988-991` — `uniqueTargetColumns()` returns `[]` under the driver
    adapter, so the `targetColumns.includes('requestKey')` branch at `:309-316` never fires and a
    `requestKey` collision is misreported as `data_rights_active_target_conflict` instead of
    `data_rights_request_key_conflict`. Milder than the two fixed here: both arms are coded 409s, so
    the caller gets *a* code, just the wrong one. `isUniqueViolation` at `:972` still detects the
    violation (it also accepts `23505`); only the column discrimination is blind. It should adopt
    `uniqueConstraintFields()` in the same change that settles the filter question.
- Does production hold any case-variant usernames today? Cannot be read from a development
  checkout. The detection query is step 1 of the follow-up runbook, and its answer is **not
  durable** — two of the four writers can create a new case-variant pair at any time.
- `User.email` uniqueness is case-SENSITIVE at the database level and compared case-insensitively in
  JavaScript in two places. Not a LIKE-injection issue, so it was left alone — but the same
  "two rows a human reads as one identity" race exists for email as for username.

## Next

1. Open the PR from `codex/employee-username-exact-match` into `develop`.
2. Separate task, prerequisite for any UNIQUE promotion: make `signup-claim.use-case.ts` and
   `create-company-onboarding.use-case.ts` lower-case at write time and fold their pre-checks, AND
   fold `PasswordLoginUseCase:39` in the same change — lower-casing writes alone breaks every
   existing mixed-case login. That file is on the maintenance pin list.
3. Only then: run step 1 of `docs/runbooks/username-case-uniqueness-followup.md` against production,
   record the row count, and if it is zero land the UNIQUE promotion migration as written there.
