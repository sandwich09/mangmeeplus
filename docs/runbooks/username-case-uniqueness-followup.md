# Username Case Uniqueness — promoting `User_username_lower_idx` to UNIQUE

> **สถานะ: ⏳ รอ prerequisite + ผลตรวจ production** — index ที่ไม่ unique ลงไปแล้วใน
> `20260905140000_user_username_lower_idx` การ promote เป็น UNIQUE ต้องผ่านข้อ 0 ทั้งสองข้อก่อน
> (การแปล P2002 ต้องยังทำงาน + ต้องแก้ writer ที่เก็บตัวพิมพ์ใหญ่และแก้ login ให้ fold ก่อน)
> แล้วจึงรัน query ข้อ 1 บน production ถ้าได้ 0 แถว จึงค่อย apply migration ข้อ 2

Created 2026-09-05, alongside the ILIKE→`lower()` fix in
`CreateEmployeeUseCase` (and the same fix already merged in
`AccountProfileUseCase`, PR #416).

---

## Why the index is not UNIQUE yet

`User.username` has a plain B-tree `@unique`, which is **case-sensitive**: `somchai` and
`SomChai` are two different rows to Postgres. Both username-uniqueness reads therefore compare
`lower("username")` in application code, and the migration above indexes that expression so those
reads stop being sequential scans.

Making that index UNIQUE in the same change would have been wrong: **a unique functional index
fails the migration outright if the table already holds two case-variant usernames**, and
production data cannot be read from a development checkout. A failed `prisma migrate deploy` on
production is a much worse outcome than one more round trip.

## 0. Prerequisites — both MUST be deployed before step 2

**0a. The unique-violation translation must be alive.** Promotion turns the read-then-write race
below into a database rejection, so whatever the application does with a P2002 becomes the
user-visible behaviour. Until `uniqueConstraintFields()` shipped, `meta.target` was the only shape
read and `@prisma/adapter-pg` never populates it — so a rejection escaped untranslated and the
caller lost its conflict code. Promoting before that fix would have turned this race into a
field-less generic 409 on the public claim page and in the employee wizard. Required files:

- `apps/api/src/common/database/prisma-error.ts` (the helper; also folds the `lower(username`
  form Postgres reports for a functional index down to `username`)
- `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts`
- `apps/api/src/modules/auth/application/use-cases/account-profile.use-case.ts`

`create-employee-username.pg.spec.ts` rehearses exactly this: it builds a temporary UNIQUE
functional index and asserts the violation still answers `employee_username_conflict`.

**0b. Every writer must lower-case, and login must fold.** See section 3 — two of the four writers
still store mixed case behind case-SENSITIVE pre-checks, so promotion would start rejecting writes
that succeed today. That change is NOT in this branch: lower-casing at write time without folding
`PasswordLoginUseCase` breaks every existing mixed-case login.

## 1. Detect case-variant duplicates (production, read-only)

Run through the bastion port-forward (`docs/runbooks/production-support-access.md`):

```sql
SELECT lower(username) AS folded, count(*) AS rows, array_agg(username ORDER BY username) AS variants
FROM "User"
WHERE username IS NOT NULL
GROUP BY 1
HAVING count(*) > 1
ORDER BY 2 DESC;
```

- **0 rows** → go to step 2, but only with section 0 satisfied.
- **Any rows** → do NOT apply step 2. Each group is two accounts whose owners currently believe
  they have different logins. Resolving them is a support decision (rename or merge via the
  account-merge ticket flow), not a migration. Re-run this query afterwards.

Run the same query on UAT before production; a UAT hit is the cheap rehearsal.

**A zero-row result is not durable.** Two of the four writers in section 3 can still create a new
case-variant pair at any moment, so this query answers "is it safe right now", not "is it safe".
Re-run it immediately before applying step 2, and treat a gap between the check and the migration
as a reason to re-check rather than to proceed.

## 2. Follow-up migration, once step 1 reports zero rows

`apps/api/prisma/migrations/<timestamp>_user_username_lower_unique/migration.sql`:

```sql
-- Promotes the functional index added in 20260905140000_user_username_lower_idx to UNIQUE, once
-- production confirmed zero case-variant usernames (docs/runbooks/username-case-uniqueness-followup.md).
DROP INDEX "User_username_lower_idx";
CREATE UNIQUE INDEX "User_username_lower_idx" ON "User" (lower("username"));
```

Keep the index **name** unchanged so the pointer comment on `model User` in `schema.prisma` stays
accurate; update that comment's last line when this lands. Expression indexes are invisible to
`prisma migrate diff`, so the diff output must not change — same as
`CompanySignupRequest_line_open_key`.

## 3. The race this closes

Nothing at the database level stops two case-variant usernames from being created: every check is a
read-then-write with no constraint behind it. There are **four** writers, not two, and only two of
them normalise:

| Writer | Path | Stores | Pre-check |
| --- | --- | --- | --- |
| The person themselves | `AccountProfileUseCase.setInitialPassword` — LINE-first owner sets their own username | lower-cased | case-folded (`lower("username")`) |
| A company admin | `CreateEmployeeUseCase.execute` — employee create, and the `linkExistingUser` attach that reads the same row | lower-cased (`:114`) | case-folded (`:270`) |
| A new customer claiming their account | `signup-claim.use-case.ts:108` — the public claim page | **MIXED case** (`:83` trims only; `USERNAME_PATTERN` in `public-company-signup.controller.ts:23` allows `A-Z`) | **case-SENSITIVE** (`:85`, `findUnique({ where: { username } })`) |
| A system admin onboarding a company | `create-company-onboarding.use-case.ts:314` — writes `cmd.ownerUsername` verbatim | **MIXED case** (`ownerUsername` at `system-onboarding.controller.ts:41` has no `@Matches` pattern at all) | **case-SENSITIVE** (`:208`, `findUnique`) |

`provision-signup.use-case.ts:314` feeds that last writer as
`username ?? suggestedUsernameFromEmail(contactEmail) ?? contactEmail`. The middle term folds, but
the final fallback is the **raw `contactEmail`** — reached whenever the address's local part cleans
to fewer than 3 characters — so an address with capitals becomes a mixed-case username.

Two concurrent requests — a LINE-first owner claiming `somchai` while an admin creates an employee
`SomChai` — both read "free" before either writes, and both succeed. The case-sensitive `@unique`
does not collide, so the system ends up with two logins that a human reads as the same name, and
the `linkExistingUser` confirmation dialog can then point at either of them.

**Prerequisite for promotion (0b above), a separate task.** Before the index becomes UNIQUE, the two
mixed-case writers must lower-case at write time and fold their pre-checks — otherwise promotion
converts writes that succeed today into rejections. And lower-casing alone is not enough:
`PasswordLoginUseCase:39` matches `{ username: trimmed }` **case-sensitively**, so the moment stored
names are folded, every existing user who types their name the way they registered it stops being
able to log in. That file is on the production maintenance pin list, which is a second reason it
does not belong in this change. Fold the login lookup and the writers together, ship that, and only
then promote the index.

Once all of it is in place the index makes the second writer fail with `P2002`, which
`uniqueConstraintFields()` translates into the existing username-taken conflicts (`username_taken` /
`employee_username_conflict`).

## Verification when it lands

```bash
# apps/api
EMPLOYEE_ACCESS_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15432/watchdog_bms?schema=public' \
  npx tsx --test src/modules/employee-access/create-employee-username.pg.spec.ts
ACCOUNT_PROFILE_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15432/watchdog_bms?schema=public' \
  npx tsx --test src/modules/auth/account-profile-username.pg.spec.ts
```

Both specs seed a mixed-case holder and clean up after themselves; they must stay green across the
promotion.
