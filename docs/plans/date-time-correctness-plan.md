# Date & Time Correctness Implementation Plan

## Linked Spec

- Spec: [[specs/date-time-correctness-spec|Date & Time Correctness Spec]]
- Audit: [[qa/date-time-handling-audit-2026-08-06|Date & Time Handling Audit]]
- Guidelines: `.agents/skills/ponytail/SKILL.md` (full mode)

## Purpose

Generalise the date fixes already made for expenses to the rest of the system, and repair the period-close guard, which currently cannot see blockers dated the last day of a period.

## Current Repository Context

- **Apps:** `packages/contracts` (helpers), `apps/api` (most sites), `apps/web` (delete a duplicate).
- **Reuse:** `packages/contracts/src/civil-date.ts` — extend it; do not add a third date module. `prisma-expense.repository.ts:23-38` already has the working `lt`-bound shape to generalise.
- **Dependencies:** none added.
- **Risks:** the close guard gets stricter (spec §6.1); instant-comparison sites must not be touched (spec §6.6).

## Implementation Rules

- One module owns civil dates. Every fix imports from `@watchdog-bms/contracts`.
- **Do not touch any `package.json`** (AGENTS.md). This decides where tests live — see spec §8.
- Do not change instant-to-instant comparisons; spec §6.6 lists them by file and line.
- Every phase lands a check that is **red before, green after**.

## Scope

### In Scope

Spec §5.1–§5.4, plus deleting the two duplicate helpers (§4).

### Out of Scope

- Threading `company.timezone` through call sites that do not already load the company (spec §9). Default stays `Asia/Bangkok`.
- The reversal `entryDate` vs `periodId` policy question (spec §6.7).
- `crm/bookings.model.ts` browser-local rendering (spec §6.4) — a documented decision.
- Back-filling historical rows or reopening closed periods (spec §6.1).

## Phase 0: Baseline

### Goal

Prove the defects before changing anything, so "green after" means something.

### Tasks

- [ ] Confirm local Docker infra is up and seeded (`POSTGRES_PORT=5432`).
- [ ] Record the failing measurements from spec §3 as the baseline.
- [ ] Confirm `apps/api` typecheck, `apps/web` test, and the expenses/reimbursements E2E are green on `develop` before edits.

### Exit Criteria

Baseline recorded; nothing edited.

## Phase 1: One home for civil dates

### Goal

The vocabulary exists in one place, tested, before any call site moves.

### Tasks

- [ ] **`packages/contracts/src/civil-date.ts`** — add, in the existing style and doc voice:
  - `civilDayRangeToUtc(from?, to?): { gte?: Date; lt?: Date }` — inclusive civil range → half-open UTC instants. `to` becomes the **next** midnight. Slice inputs to 10 chars so a caller passing a full ISO cannot stretch the range.
  - `coerceCivilDate(value: string | Date, timeZone?): CivilDate` — a civil date passes through; anything else is read as an instant through `civilDate(...)`, so an instant becomes the **company's** day, not the UTC day.
  - `civilPeriodKey(value: CivilDate): string` — `YYYY-MM`. A name for the slice that would otherwise appear ten times.
- [ ] **`packages/contracts/src/civil-date.spec.ts`** — extend (already in the contracts test list):
  - range: `to` yields next-midnight exclusive; a row at 11:00 on the last day is inside; open-ended `from`/`to`; a full-ISO input does not widen the range.
  - coerce: civil in → same out; `2026-08-05T19:00:00Z` → `2026-08-06` in Bangkok (the case the deleted helper got wrong); invalid input throws.
  - period key: `2026-08-06` → `2026-08`.

### Tests

- [ ] `pnpm --filter @watchdog-bms/contracts test`

### Exit Criteria

Helpers green. No call site changed yet; both apps still build.

## Phase 2: Delete the duplicates (spec §4)

### Goal

Do this **before** Phases 3–5 so later fixes cannot spread the wrong helper.

### Tasks

- [ ] Delete `apps/api/src/common/date/business-date.logic.ts`; repoint its 11 call sites at `todayCivilDate()` / `civilDateToUtcDate(coerceCivilDate(...))`.
- [ ] Delete `apps/web/src/common/functions/today.ts` and its spec; repoint ~13 files at `todayCivilDate()` and `civilPeriodKey(todayCivilDate())`.
- [ ] Leave `crm/bookings.model.ts` alone (spec §6.4).

### Tests

- [ ] `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter api lint`
- [ ] Existing expense E2E (EXP-24, EXP-25) must stay green — they cover the paths being repointed.

### Exit Criteria

No module defines its own civil-date logic; behaviour unchanged except spec §6.5.

## Phase 3: The range bound (spec §5.1) — highest value

### Goal

A date range includes its last day, everywhere. The close guard can see last-day blockers.

### Tasks

- [ ] Replace the private `exclusiveEndOfDay` in `prisma-expense.repository.ts:23-38` with `civilDayRangeToUtc`, so there is one implementation.
- [ ] **Close guard** — `period.use-case.ts:139,143,147` (inline counts) plus the five repository counters: `prisma-accounting.repository.ts:762,773`, `prisma-procurement.repository.ts:768,1204`, `prisma-reimbursement.repository.ts:2117,2122`, `prisma-expense.repository.ts:1393`. These take `Date` params from `period.startDate/endDate`; the bound becomes `lt: endDate + 1 day`.
- [ ] **List filters** — `prisma-procurement.repository.ts:287,386,883,1223`, `prisma-accounting.repository.ts:280,792`.
- [ ] **LINE AI tool** — `erp-business-tools.use-case.ts:304`, so chat answers match the web list.
- [ ] Verify `prisma-banking.repository.ts:223,480` before touching: `startDate`/`postedDate` may be `@db.Date`, in which case they are already correct and stay.
- [ ] Do **not** touch spec §6.6.

### Tests

- [ ] E2E: a vendor bill dated today (posted with a timestamp) appears in a `fromDate=toDate=today` filter. Red before, green after.
- [ ] E2E: the period-close check counts a blocker dated the period's **last day**.

### Exit Criteria

Both E2E red→green; the §6.6 sites are byte-identical in the diff.

## Phase 4: Period keys (spec §5.2)

### Goal

Every default period names the company's month.

### Tasks

- [ ] Ten sites → `civilPeriodKey(todayCivilDate())`: `erp-tax-tools.use-case.ts:193,226,285`, `erp-tools.use-case.ts:163`, `get-tax-summary.use-case.ts:19`, `journal.use-case.ts:311`, `expense-draft.use-case.ts:779`, `payment.use-case.ts:119`, `document.use-case.ts:337`, `report-query-validator.logic.ts:11,15`.
- [ ] `report-query-validator.logic.ts` keeps its injected `now` parameter — it is the only one already testable directly.

### Tests

- [ ] `report-query-validator` is covered by a spec already in the api list (`report.use-cases.spec.ts` / validator spec) — assert `2026-08-05T19:00:00Z` yields `2026-08`.
- [ ] Sweep: no `new Date().toISOString().slice(0, 7)` outside `civil-date.ts`.

### Exit Criteria

Sweep clean; the LINE tax tool and the web tax summary agree on the period.

## Phase 5: Date columns (spec §5.3, §5.4)

### Goal

A `@db.Date` column receives a date, built the same way everywhere.

### Tasks

- [ ] `journal.use-case.ts:313` — `entryDate: civilDateToUtcDate(todayCivilDate())`.
- [ ] `period.use-case.ts:70-71`, `journal.use-case.ts:511-512`, `tax-period.logic.ts:72` — local-midnight construction → explicit UTC. **No behaviour change on the UTC host** (spec §5.4), so this is a safety fix, not a bug fix; verify the diff is a no-op in production before claiming otherwise.

### Tests

- [ ] E2E: a reversal created with the clock at 02:00 Bangkok carries today's date. If the clock cannot be moved in E2E, cover it as a unit assertion on the helper and state plainly that the end-to-end case is unverified.

### Exit Criteria

Reversal date correct; period construction explicit.

## Phase 6: Review

### Tasks

- [ ] Re-run every audit sweep from the audit doc §4 and confirm each class is empty.
- [ ] Diff review against spec §6.6 — nothing in that table changed.
- [ ] Confirm no `package.json` is in the diff.
- [ ] Update the audit doc with per-finding status, and the spec with a verification section.

## Integration Verification

- **Contracts:** `pnpm --filter @watchdog-bms/contracts test`
- **API/web:** `pnpm --filter api lint`, `pnpm --filter web test`, `pnpm --filter web typecheck`
- **API specs** for every touched module, run directly (the `pretest` reimbursement race spec fails pre-existing — see audit).
- **E2E:** expenses, reimbursements, procurement, accounting, journal.
- **Data:** re-run the audit's measurement queries; the hidden-row counts must go to zero.

```bash
pnpm --filter @watchdog-bms/contracts test && pnpm --filter api lint && pnpm --filter web test && pnpm --filter web typecheck
```

```bash
DATABASE_URL="postgresql://watchdog:watchdog_local_password@localhost:5432/watchdog_bms?schema=public" REDIS_URL="redis://localhost:6379" pnpm exec playwright test e2e/expenses.spec.ts e2e/procurement.spec.ts e2e/accounting.spec.ts e2e/journal.spec.ts e2e/reimbursements.spec.ts
```

## Risks

| Risk | Mitigation |
| --- | --- |
| The close guard blocks a close that used to succeed (spec §6.1) | Intended. Call it out in the release note; do not gate it |
| An instant comparison gets "fixed" and breaks reminders or orphan reclaim | Spec §6.6 lists them by line; Phase 6 diffs against that table |
| A `toDate` carrying a full ISO stretches a range by a day | `civilDayRangeToUtc` slices to 10 chars; unit-tested in Phase 1 |
| Wide diff across many modules hides a mistake | Phases are per-class, each with a red→green check; sweeps prove completeness |
| Test coverage lands in the wrong file because `package.json` is frozen | Spec §8 states where each kind of test goes and why |

## Open Questions

Both in spec §9, with recommendations: default timezone now vs threading per-company; whether §6.1 needs an announcement. Neither blocks implementation.
