# Agent Memory: pg-spec-guards

Status: Complete — pushed on `codex/pg-spec-guards-skip-when-down`, no PR opened.
Owner: agent (Claude Code)
Scope: `apps/api` real-PostgreSQL spec guards only. Four suites that guarded on a *missing*
`DATABASE_URL` but had nothing for a *present but unreachable* one.

Decisions:
- One shared helper, `apps/api/src/common/database/pg-spec-guard.ts` →
  `pgSpecUnreachableReason(probe, requireEnvVar)`. It runs the suite's existing reachability probe
  once, returns `null` on success, and otherwise returns a skip reason — or rethrows.
- **Skip rule chosen: skip on unreachable only when `process.env.CI` is unset AND the suite's own
  `*_REQUIRE_POSTGRES` is not `'true'`.** Why this and not a new `PG_SPEC_SKIP_WHEN_DOWN=1` opt-in:
  - `OCR_REQUIRE_POSTGRES` / `EXPENSE_PAYMENT_REQUIRE_POSTGRES` already exist, and `ci.yml`'s
    "P27, OCR, and expense payment integrity against PostgreSQL" step already sets both. Reusing
    them means no new env surface and no CI wiring to keep in sync.
  - `process.env.CI` is the belt: a future CI step that supplies `DATABASE_URL` and forgets the
    require flag still FAILS on a broken database instead of skipping past it.
  - A new opt-in flag would have had to be *added* to CI to be safe — the failure mode of forgetting
    it is a silent green, which is the exact bug being fixed. Default-fail beats default-skip.
- The `CI` belt applies ONLY to the "URL set but unreachable" branch. The "no `DATABASE_URL`"
  branch is untouched, because CI's plain `pnpm test` step runs these same four files with no
  database at all and must keep skipping there.
- Followed the pattern already in `prisma-accounting.repository.atomic-issue.spec.ts` /
  `prisma-crm.repository.spec.ts` (probe, catch, skip unless required) rather than inventing a new
  one; the helper only removes the fourfold duplication of the fail-vs-skip decision.
- Prisma's error message is a multi-line block whose FIRST line is the invocation banner, so the
  skip reason takes the LAST non-empty line ("Can't reach database server at 127.0.0.1:15999").

Open questions:
- None blocking. `a5-capacity-mutating.pg.spec.ts` and `line-recovery.pg.spec.ts` still throw from
  their own `before`/`connect` when their dedicated `*_TEST_DATABASE_URL` points at a dead server;
  they were out of the named scope and CI does not set those variables to a shared database.

Artifacts:
- `apps/api/src/common/database/pg-spec-guard.ts` (new, 28 lines)
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts`
  — "Expense payment intent integrity (real PostgreSQL)": `before` records the reason instead of
  throwing; the six `t.skip` calls now report it.
- `apps/api/src/modules/line-ai/application/company-ai-usage-meter.spec.ts`
  — "company OCR admission" and "company OCR admission — commercial plan ceiling".
- `apps/api/src/modules/system-partner-management/application/use-cases/get-partner-ai-usage.use-case.spec.ts`
- `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-ai-model.use-case.spec.ts`

Verification (isolated docker PostgreSQL `wd-pgguard-ada82`, port 15607, db
`watchdog_pgguard_ada82`, `prisma migrate deploy` applied; the four spec files run together with
`tsx --test`):

| Branch | Env | Result |
| --- | --- | --- |
| unset | no `DATABASE_URL` | pass 112, fail 0, **skipped 10** — `# DATABASE_URL is not set` |
| set-but-down | `DATABASE_URL=…@127.0.0.1:15999/watchdog_down` (closed port) | pass 112, fail 0, **skipped 10** — `# PostgreSQL at DATABASE_URL is unreachable — Raw query failed. Code: `N/A`. Message: `Can't reach database server at 127.0.0.1:15999` — set OCR_REQUIRE_POSTGRES=true or CI=1 to fail instead of skip` |
| set-and-up | `DATABASE_URL=…@127.0.0.1:15607/watchdog_pgguard_ada82` | **pass 122, fail 0, skipped 0** — all 10 real-PostgreSQL tests ran |
| CI must not skip | same closed port + `CI=1` | **fail 4 suites, skipped 0** (11 red entries) |
| require-flag must not skip | same closed port + `OCR_REQUIRE_POSTGRES=true EXPENSE_PAYMENT_REQUIRE_POSTGRES=true` | **fail 4 suites, skipped 0** |
| CI as configured | port 15607 + `CI=1` + both require flags (mirrors ci.yml) | pass 122, fail 0, skipped 0 |

- Pre-fix baseline (same files stashed back to `origin/develop`, closed port, no flags):
  **fail 4 suites / 11 red test entries, skipped 0** — the failure this change converts to a skip.
- `pnpm --filter @watchdog-bms/api typecheck` → exit 0.
- No `package.json` edits.

Next:
- Nothing required. If the two out-of-scope `*.pg.spec.ts` files above ever get a shared CI
  database, give them the same helper.
