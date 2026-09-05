# Username Case Uniqueness — promoting `User_username_lower_idx` to UNIQUE

> **สถานะ: ⏳ รอผลตรวจ production** — index ที่ไม่ unique ลงไปแล้วใน
> `20260905140000_user_username_lower_idx` ขั้นถัดไปคือ query ข้อ 1 บน production
> ถ้าได้ 0 แถว จึงค่อย apply migration ข้อ 2

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

- **0 rows** → go to step 2.
- **Any rows** → do NOT apply step 2. Each group is two accounts whose owners currently believe
  they have different logins. Resolving them is a support decision (rename or merge via the
  account-merge ticket flow), not a migration. Re-run this query afterwards.

Run the same query on UAT before production; a UAT hit is the cheap rehearsal.

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

Today nothing at the database level stops two case-variant usernames from being created, because
both checks are read-then-write with no constraint behind them:

| Writer | Path |
| --- | --- |
| The person themselves | `AccountProfileUseCase.setInitialPassword` — LINE-first owner sets their own username |
| A company admin | `CreateEmployeeUseCase.execute` — employee create, and the `linkExistingUser` attach that reads the same row |

Two concurrent requests — a LINE-first owner claiming `somchai` while an admin creates an employee
`SomChai` — both read "free" before either writes, and both succeed. The case-sensitive `@unique`
does not collide, so the system ends up with two logins that a human reads as the same name, and
the `linkExistingUser` confirmation dialog can then point at either of them.

The unique functional index makes the second writer fail with `P2002`, which both use cases already
translate into their existing username-taken conflicts (`username_taken` /
`employee_username_conflict`) — no application change is needed when it lands.

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
