# Date & Time Handling Audit — whole system, 2026-08-06

Owner: thawtchai. Auditor: Claude. Branch `develop`, commit `a37445b1`.

Scope: `apps/api`, `apps/web`, `apps/ai-gateway`, `apps/workers`, `packages/contracts`. Read at code level; the reachable findings are verified against the local seeded database, not inferred.

Follows [[specs/list-filter-retention-spec|List Filter Retention Spec]] §9, which fixed this class **for expenses only**. This audit asks whether the rest of the system has the same faults. It does.

## 0. The two traps, and the module that already documents them

`packages/contracts/src/civil-date.ts:1-15` states both, verbatim and correctly:

1. `new Date('2026-08-04')` is **UTC** midnight; `new Date(2026, 7, 4)` is **LOCAL** midnight. Writing the latter into a `@db.Date` column from a Bangkok machine stores `2026-08-03T17:00Z`, which reads back as the 3rd.
2. `new Date().toISOString()` gives the **UTC** day. Between 00:00 and 07:00 Bangkok that is yesterday.

It exports `todayCivilDate(tz, now)`, `civilDate(instant, tz)`, `civilDateToUtcDate(civil)`, `utcDateToCivilDate(date)`, `isCivilDate`, `addCivilDays`, and `DEFAULT_COMPANY_TIME_ZONE`, keyed on a **per-company** timezone. It is exported from the contracts index (`index.ts:267`).

**It is used by two modules — VAT registration and identity reconciliation — and nowhere else.** Every finding below is a place that should have used it and did not.

Environment fact behind all of this: **the API runs on a UTC host.** Verified 2026-08-06 — the API container reports UTC while the operator's machine is +07, and no `TZ` is set in any compose file or task definition.

## 1. Findings, ranked

### T1 — CRITICAL: an inclusive `lte` date bound hides the range's last day. Systemic.

Identical to the expense bug fixed in `6417c5fb`, still live in **four other modules**. A `YYYY-MM-DD` filter becomes `lte: <that day at UTC midnight>`, so any row whose column carries a time falls outside the range on that day.

How much data actually carries a time (local seeded DB):

| Column | Rows | With a time component |
| --- | --- | --- |
| `VendorBill.billDate` | 14 | **14 (100%)** |
| `AccountingPayment.paidAt` | 9 | **9 (100%)** |
| `SupplierPayment.paymentDate` | 8 | **6 (75%)** |
| `PurchaseRequest.createdAt` | 1 | **1 (100%)** |
| `AccountingDocument.documentDate` | 24 | 3 (12%) |

Consequence, measured on 2026-08-05:

| Filter | Rows on that day | Visible with `lte` midnight | Visible with `lt` next midnight |
| --- | --- | --- | --- |
| VendorBill by `billDate` | 13 | **0** | 13 |
| AccountingPayment by `paidAt` | 8 | **0** | 8 |

Sites:

| File | Line | Column | Note |
| --- | --- | --- | --- |
| `procurement/infrastructure/prisma-procurement.repository.ts` | 287 | `createdAt` | An instant by definition — the last day returns ~nothing |
| " | 386 | `orderDate` | |
| " | 883 | `billDate` | 100% of rows carry a time |
| " | 1223 | `paymentDate` | 75% carry a time |
| `accounting-documents/infrastructure/prisma-accounting.repository.ts` | 280 | `documentDate` | |
| " | 792 | `documentDate` | |
| `reimbursements/infrastructure/prisma-reimbursement.repository.ts` | 2117 | `paidAt` | An instant by definition |
| `line-ai/application/use-cases/erp-business-tools.use-case.ts` | 304 | `expenseDate` | **The AI tool path** — asking LINE for a period's expenses hits this, not the fixed repository method |

Fix: the same `exclusiveEndOfDay()` shape already added to `prisma-expense.repository.ts:23-38`, or `civilDateToUtcDate` + one day. Read-side, so it repairs stored rows with no migration.

### T2 — HIGH: clock-derived period keys read the UTC month. 10 sites.

This is the half of the server-side date fix (`a37445b1`) that I missed: **my sweep matched `slice(0, 10)` and never `slice(0, 7)`**, so every month-granularity default was left on UTC. On the 1st of a month before 07:00 Bangkok, all of these name the previous month.

| File | Line | What it defaults |
| --- | --- | --- |
| `line-ai/erp-tax-tools.use-case.ts` | 193, 226, 285 | **LINE AI tax tools** — "ภาษีเดือนนี้" answers with last month's numbers |
| `line-ai/erp-tools.use-case.ts` | 163 | Same, general ERP tool |
| `tax/get-tax-summary.use-case.ts` | 19 | Tax summary default period |
| `ledger/journal.use-case.ts` | 311 | `periodKey` reserving a **reversal entry number** |
| `expenses/expense-draft.use-case.ts` | 779 | `periodKey` reserving void/reversal numbers |
| `accounting-documents/payment.use-case.ts` | 119 | Notification `periodKey` |
| `accounting-documents/document.use-case.ts` | 337 | Notification `periodKey` |
| `reports/report-query-validator.logic.ts` | 11, 15 | `defaultPeriodKey()` / `defaultDateRange()` — `now` is injectable but every caller uses the default |

The LINE tool sites are the most user-visible: they are the answer an owner gets from a chat message, with no UI to reveal which period was actually used.

### T3 — HIGH: an instant written straight into a true `date` column.

`ledger/journal.use-case.ts:313` — `entryDate: new Date()` on the **reversal** path.

`JournalEntry.entryDate` is `@db.Date` (`schema.prisma:2358`), confirmed as Postgres `date`. Postgres truncates the timestamp **in UTC**, so a reversal posted between 00:00 and 07:00 Bangkok is dated **yesterday** — and that is the accounting date of a posted ledger entry.

Neighbouring writes are already correct because they pass a supplied date: `:241` (`new Date(input.entryDate)`) and `:611` (`new Date(source.sourceDate)`). Only the reversal invents "now".

### T4 — MEDIUM, host-dependent: local-midnight construction into `@db.Date`.

Exactly trap #1 above.

| File | Line | Expression |
| --- | --- | --- |
| `ledger/period.use-case.ts` | 70-71 | `new Date(y, m - 1, 1)` / `new Date(y, m, 0)` → `AccountingPeriod.startDate/endDate`, both `@db.Date` |
| `ledger/journal.use-case.ts` | 511-512 | same pair |
| `tax/domain/logic/tax-period.logic.ts` | 72 | `new Date(nextYear, nextMonth - 1, rule.day)` |

On the UTC production host local == UTC, so these are correct **today**. They are wrong the moment anything runs with a non-UTC `TZ` — a developer's Mac in Bangkok, a container that later sets `TZ`, or a CI box. An accounting period silently starting a day early is the kind of fault that surfaces as a reconciliation mismatch months later.

Contrast `crm-booking.logic.ts:68-96` and `crm-daily-brief.logic.ts:35-36`, which do this correctly with explicit `Date.UTC(...)` and an offset, and say so in comments.

### T5 — META: I added a duplicate of `civil-date.ts`.

`apps/api/src/common/date/business-date.logic.ts` (mine, commit `a37445b1`) reimplements what `packages/contracts/src/civil-date.ts` already provided, and is **weaker** in two ways:

- It hardcodes `Asia/Bangkok`; `todayCivilDate(company.timezone)` supports the per-company timezone the schema already carries.
- `businessDateOnly()` **slices** an incoming instant, which takes the UTC day. `civilDate(instant, tz)` takes the *company's* day. For `2026-08-05T19:00:00Z` (02:00 on the 6th in Bangkok) mine yields `2026-08-05`; the contracts helper yields `2026-08-06`. **Mine is wrong for exactly the case it was written to fix.**

`apps/web/src/common/functions/today.ts` (commit `5435996b`) is a second, browser-local duplicate. `apps/web` already depends on `@watchdog-bms/contracts` (`package.json`), so it can use the same module — and `todayCivilDate('Asia/Bangkok')` is *more* correct than browser-local, since an accountant travelling abroad should still see the company's business day.

This is an AGENTS.md violation on my part ("Reuse existing repo patterns, helpers, contracts... before adding new shapes"). Both helpers should be deleted and their call sites pointed at contracts.

## 2. Checked and clean

- **No server-side date formatting without an explicit `timeZone`.** Every `toLocaleString` hit in `apps/api` and `apps/ai-gateway` formats a *number*, not a date. Date rendering already pins Asia/Bangkok (`common/export/thai-date.logic.ts`, `regenerate-employee-credential.use-case.ts:101`).
- **Workers have no day-boundary assumption.** `apps/workers` schedules on fixed intervals (`{ every: intervalMs }`, `scan-worker.ts:43`), not cron day boundaries, so nothing fires against a UTC midnight.
- **CRM booking and daily-brief date maths are correct** and documented — `crm-booking.logic.ts`, `crm-daily-brief.logic.ts`.
- **Thailand has no DST**, so fixed-offset reasoning in `company-ai-usage-meter.ts:30` is safe.
- **Slicing a stored `@db.Date` column** (`utcDateToCivilDate`-style, e.g. `bill.billDate.toISOString().slice(0, 7)`) is correct — those columns hold UTC midnight by construction. Not a finding.

## 3. Recommended order

1. **T1** — biggest blast radius, read-side, no migration, and the pattern is already written and tested in `prisma-expense.repository.ts`. Include `erp-business-tools.use-case.ts:304` so the LINE answers match the web list.
2. **T5** — do before T2/T3 so the remaining fixes use the right helper instead of spreading the duplicate.
3. **T2** — mechanical once T5 lands.
4. **T3** — one line.
5. **T4** — one line each; prevents a class of fault that is invisible until the host changes.

Each of T1, T2 and T3 is verifiable the way the expense fixes were: a regression test that is red before and green after, run against local Docker infra.

## 4. Verification method

- Static: `grep` sweeps per class over `apps/*/src` and `packages/*/src`, excluding `**/generated/**` and `*.spec.ts`.
- Schema: `@db.Date` columns enumerated from `apps/api/prisma/schema.prisma` (25 total) and confirmed against `information_schema.columns`.
- Data: local Docker Postgres, seeded, `POSTGRES_PORT=5432`. Counts and the visible/hidden comparisons in T1 are query results, not estimates.
- Not verified: UAT/production data volumes. The percentages above are from seed data and show the *mechanism* is live, not the production blast radius.
