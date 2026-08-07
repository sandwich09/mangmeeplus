# Date & Time Correctness Spec

## 1. Status

v1.0, 2026-08-06. **Implemented and verified.**

Owner: thawtchai. Follows [[qa/date-time-handling-audit-2026-08-06|Date & Time Handling Audit]], which found the faults fixed for expenses in `5435996b`/`6417c5fb`/`a37445b1` still live in four other modules — and one of them sitting under the period-close guard.

Linked plan: [[plans/date-time-correctness-plan|Date & Time Correctness Plan]]

Related: [[specs/list-filter-retention-spec|List Filter Retention Spec]] §9 (the expense-only fixes this generalises), [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger Closing Spec]] (owns period close, whose guard §5.1 repairs).

## 2. Goal

Two invariants, applied everywhere:

1. **A date means the company's calendar day.** Not the UTC day, not the host's day.
2. **A date range includes its last day.** Whatever time the rows carry.

The system violates both today, and the second one silently weakens a financial control.

## 3. Source Facts (verified 2026-08-06)

| Fact | Evidence |
| --- | --- |
| The API runs on a **UTC host**; no `TZ` is set in any compose file or task definition | API container reports UTC while the operator machine is +07 |
| `packages/contracts/src/civil-date.ts` already documents both timezone traps and exports per-company helpers | `civil-date.ts:1-15`, exported at `index.ts:267` |
| It is used by **two** modules only — VAT registration, identity reconciliation | `company-vat-registration.use-case.ts:55`, `resolve-identity-reconciliation.use-case.ts` |
| `Company.timezone` exists, defaults `Asia/Bangkok`; it is **not** on `RequestContext` and needs a lookup | `schema.prisma:228`; `company-vat-registration.use-case.ts:44` does exactly that lookup |
| Only **25** columns are `@db.Date`. `expenseDate`, `billDate`, `documentDate`, `paymentDate`, `paidAt`, `orderDate`, `receivedAt` are plain `DateTime` and carry times | `schema.prisma`, confirmed against `information_schema.columns` |
| `JournalEntry.entryDate` and `AccountingPeriod.startDate/endDate` **are** true Postgres `date` | same |
| Rows really do carry times — `VendorBill.billDate` 14/14, `AccountingPayment.paidAt` 9/9, `SupplierPayment.paymentDate` 6/8, `PurchaseOrder.orderDate` 1/1, `GoodsReceipt.receivedAt` 1/1, `BankAdjustment.adjustmentDate` 1/1 | local seeded DB |
| A day filter on `2026-08-05` returns **0 of 13** vendor bills and **0 of 8** accounting payments | measured |
| `civil-date.spec.ts` exists and is already in the contracts test list | `packages/contracts/package.json` |
| `apps/api` runs an **explicit spec list** in `package.json`; AGENTS.md keeps that file out of unrelated diffs | `apps/api/package.json` |

## 4. Key Design Decision — extend `civil-date.ts`, delete the duplicates

**One module owns civil dates: `packages/contracts/src/civil-date.ts`.** It already has the vocabulary (`CivilDate`, `civilDate`, `todayCivilDate`, `civilDateToUtcDate`, `utcDateToCivilDate`, `addCivilDays`), it is timezone-parameterised on the company, and both apps already depend on the package.

Two helpers added there rather than reinvented per module:

```ts
/** Inclusive YYYY-MM-DD range → the half-open UTC instant range a DateTime column needs. */
civilDayRangeToUtc(from?: CivilDate, to?: CivilDate): { gte?: Date; lt?: Date }

/** An instant or a civil date → the company's civil date. For write boundaries. */
coerceCivilDate(value: string | Date, timeZone?: string): CivilDate
```

Period keys need no new function: `todayCivilDate(tz).slice(0, 7)` is already the company's month. It gets one name, `civilPeriodKey`, because ten call sites otherwise repeat a bare slice.

**Two duplicates are deleted**, both mine:

- `apps/api/src/common/date/business-date.logic.ts` (`a37445b1`) — hardcodes Bangkok, and its `businessDateOnly()` **slices** an instant, taking the UTC day. For `2026-08-05T19:00:00Z` (02:00 on the 6th in Bangkok) it yields the 5th where `civilDate()` yields the 6th. It is wrong for the exact case it was written to fix.
- `apps/web/src/common/functions/today.ts` (`5435996b`) — browser-local. `apps/web` already depends on `@watchdog-bms/contracts`.

## 5. The four defect classes

### 5.1 — Inclusive `lte` bound hides the range's last day (CRITICAL)

`lte: new Date('2026-08-05')` is `lte: 2026-08-05T00:00:00Z`, so a row at `2026-08-05T11:00:00Z` is excluded.

**This sits under the period-close guard.** `RunPeriodCloseChecksUseCase` (`period.use-case.ts:120-150`) runs seven blocker counts, every one bounded `lte: period.endDate` — the last day at UTC midnight. Because the columns involved are ~100% timestamped, **unposted documents dated the last day of a month are invisible to the guard, and a period can be closed with them outstanding.** That is a financial control failing open, not a list showing fewer rows.

| File | Line | Column | Surface |
| --- | --- | --- | --- |
| `period.use-case.ts` | 139, 143, 147 | `orderDate`, `receivedAt`, `adjustmentDate` | Close guard, inline counts |
| `prisma-accounting.repository.ts` | 762, 773 | `documentDate`, `paidAt` | Close guard |
| `prisma-procurement.repository.ts` | 768, 1204 | `billDate`, `paymentDate` | Close guard |
| `prisma-reimbursement.repository.ts` | 2117, 2122 | `paidAt`, `expenseDate` | Close guard |
| `prisma-expense.repository.ts` | 1393 | `expenseDate` | Close guard (`countPostingBlockers`) |
| `prisma-procurement.repository.ts` | 287, 386, 883, 1223 | `createdAt`, `orderDate`, `billDate`, `paymentDate` | List filters |
| `prisma-accounting.repository.ts` | 280, 792 | `documentDate` | List filters |
| `erp-business-tools.use-case.ts` | 304 | `expenseDate` | **LINE AI tool** |

### 5.2 — Clock-derived period keys read the UTC month (HIGH)

Ten sites. This is the half the `a37445b1` sweep missed: it matched `slice(0, 10)` and never `slice(0, 7)`.

`erp-tax-tools.use-case.ts:193,226,285` and `erp-tools.use-case.ts:163` are the LINE AI tools — before 07:00 on the 1st, "ภาษีเดือนนี้" answers with last month, in a channel with no UI to reveal which period was used. Also `get-tax-summary.use-case.ts:19`, `journal.use-case.ts:311`, `expense-draft.use-case.ts:779`, `payment.use-case.ts:119`, `document.use-case.ts:337`, `report-query-validator.logic.ts:11,15`.

### 5.3 — An instant written into a true `date` column (HIGH)

`journal.use-case.ts:313` — `entryDate: new Date()` on the reversal path, into `JournalEntry.entryDate` (`@db.Date`). Postgres truncates in UTC, so a reversal posted before 07:00 Bangkok carries **yesterday** as its accounting date. The neighbouring writes at `:241` and `:611` are already correct because they pass a supplied date.

### 5.4 — Local-midnight construction into `@db.Date` (MEDIUM, host-dependent)

`period.use-case.ts:70-71`, `journal.use-case.ts:511-512`, `tax-period.logic.ts:72` use `new Date(y, m - 1, 1)` — local midnight. Correct on the UTC host **today**; a day out on any non-UTC host. Trap #1 in `civil-date.ts:7-9`.

## 6. Impact — what changes, and what breaks

The point of this section is that none of this is silent.

### 6.1 Period close becomes stricter, on purpose

After 5.1, the guard counts blockers it previously could not see. **A period close that would have succeeded yesterday may now be blocked**, because a last-day document is genuinely unposted. This is the control working, but it is the one change an operator will feel. It needs saying in the release note, not discovering during a month-end.

Already-closed periods are **not** reopened and nothing is back-dated. If a past close let something through, this change surfaces it the next time anything queries that range — it does not rewrite history.

### 6.2 Lists, reports and AI answers return more rows

Every `fromDate`/`toDate` surface gains the last day. Any expectation of a specific count changes. All of these were under-reporting; none was over-reporting, so no figure shrinks.

### 6.3 Period keys shift for seven hours a month

Between 00:00 and 07:00 Bangkok on the 1st, a newly reserved document number moves from the previous month's sequence to the current one. `DocumentSequence` is keyed on `(companyId, documentType, periodKey)` with `MONTHLY` reset, so this selects a different counter row — no duplicate, no gap, no collision. It is the correct period; today's behaviour is the wrong one.

### 6.4 Web moves from browser-local to company time

`todayCivilDate()` reads the company's zone, so a user working from another country sees the Thai business day. More correct, and a behaviour change worth naming.

**Exception, deliberately not changed:** `crm/bookings.model.ts` uses browser-local **by documented decision** (`bookings.model.ts:1-5`) — a booking grid is a wall-clock view for a user standing in the shop. It stays.

### 6.5 Write-boundary semantics change for instants

`coerceCivilDate` converts an instant to the *company's* day where the deleted `businessDateOnly` sliced the *UTC* day. A caller posting `2026-08-05T19:00:00Z` now stores the 6th, not the 5th. Only callers that send instants are affected — after `a37445b1` that is the E2E helper, not the app.

### 6.6 What is explicitly NOT touched

Instant-to-instant comparisons are correct and must stay. Changing them would break real behaviour:

| File | Line | Why it stays |
| --- | --- | --- |
| `prisma-crm.repository.ts` | 2118 | `startAt: { gt: now, lte: now + leadMs }` — a booking-reminder lead window, pure instant math |
| `process-line-webhook.use-case.ts` | 2153 | `processedAt: { lte: now - ORPHAN_MS }` — orphan reclaim |
| `recover-orphan-line-events.use-case.ts` | 67 | same |
| `common/export/thai-date.logic.ts` | — | already pins Asia/Bangkok, with a worked example |
| `crm-booking.logic.ts`, `crm-daily-brief.logic.ts` | — | already do correct explicit-UTC maths |

Also unchanged: slicing a stored `@db.Date` column (it holds UTC midnight by construction), and `apps/workers` (fixed intervals, no day boundary).

### 6.7 A pre-existing inconsistency this does *not* fix

A journal reversal takes `entryDate` = today but `periodId` = **the original entry's** period (`journal.use-case.ts:313`). Today's date need not fall inside that period. 5.3 makes the date correct; whether a reversal should be dated today or within its target period is a policy question for the ledger spec, not this one. Recorded so it is not mistaken for a regression.

## 7. Acceptance Criteria

- [ ] A `fromDate=toDate=<day>` filter returns every row dated that day, for expenses, vendor bills, supplier payments, accounting documents, accounting payments, purchase orders, purchase requests, reimbursements — regardless of time component.
- [ ] The period-close guard counts a blocker dated the **last day** of the period.
- [ ] The LINE AI expense/tax tools answer for the same period the web shows.
- [ ] With the clock at 02:00 Bangkok on the 1st, every default period key names **that** month.
- [ ] A journal reversal created at 02:00 Bangkok carries **today's** date, not yesterday's.
- [ ] `business-date.logic.ts` and `common/functions/today.ts` are gone; no module defines its own civil-date logic.
- [ ] `grep` finds no `new Date().toISOString().slice(0, 7)` or `(0, 10)` outside `civil-date.ts`.
- [ ] Instant-comparison sites in §6.6 are byte-identical.
- [ ] The bookings calendar still uses browser-local time.

## 8. Test Strategy

Constrained by tooling, so stated explicitly:

- **`packages/contracts`** — `civil-date.spec.ts` is already in the test list, so the new helpers are unit-tested there properly, with an injected clock and no fake timers.
- **`apps/api`** — the spec list lives in `package.json`, which AGENTS.md keeps out of unrelated diffs. New coverage therefore goes into specs **already** in that list, or into E2E.
- **E2E** is the strongest evidence for 5.1 and 5.3 anyway, since the defect only appears against a real database. Each gets a test verified **red before the fix and green after**, the method used for EXP-24/25.
- **`apps/web`** — `pnpm --filter web test` globs `src/**/*.spec.ts`, so the removal of `today.ts` is covered by deleting its spec and letting typecheck prove the call sites moved.

## 9. Open Questions

- **Per-company timezone threading.** Every helper takes a timezone and defaults to `Asia/Bangkok`. Sites that already load the company pass `company.timezone`; sites that do not keep the default rather than adding a query per call. Correct today — `civil-date.ts:18` says every tenant is Thai — and the seam is in place when it stops being true. **Recommendation: default now, thread later, do not add lookups in this change.**
- **Should 6.1 be announced before deploy?** A stricter close guard is the intended outcome, but month-end is a bad time to be surprised. **Recommendation: flag it in the release note; no code gate.**

## 10. Verification (2026-08-06)

| Check | Result |
| --- | --- |
| `pnpm --filter @watchdog-bms/contracts test` | **99 pass** (+16 new on the helpers) |
| `pnpm --filter web test` / `typecheck` | **729 pass**, typecheck clean |
| `pnpm --filter api lint` | clean |
| API specs across every touched module | **197 pass** |
| E2E: expenses, AP, procurement, accounting, journal, reimbursements, banking | **37 pass** |

Sweeps, all empty:

- `new Date().toISOString().slice(...)` outside `civil-date.ts` — none in `apps/api`, `apps/web`, `apps/ai-gateway`, `apps/workers`, `packages`.
- Both duplicate helpers deleted; no module defines its own civil-date logic.
- The §6.6 instant sites are byte-identical — `prisma-crm.repository.ts:2118`, `process-line-webhook.use-case.ts:2152`, `recover-orphan-line-events.use-case.ts:67` verified present and unchanged; `bookings.model.ts` untouched.
- No `package.json` in the diff.

**Regression tests, each verified red before the fix and green after:**

- `e2e/accounts-payable.spec.ts` **AP-20** — a vendor bill stamped with a time appears in a `fromDate=toDate=today` range.
- `e2e/journal.spec.ts` **JRNL-20** — **the close guard**. A supplier payment recorded on the period's last day at 14:00, still unposted, must make `source_postings_complete` FAIL. Reverting `prisma-procurement.repository.ts` to its pre-fix version makes it fail; restoring makes it pass. This closes the gap the first verification pass recorded as unproven.
- `e2e/expenses.spec.ts` EXP-24 / EXP-25 (from the earlier commits) still green against the generalised helper.

Instrumented evidence that §5.1 is fixed rather than merely compiling: a one-day vendor-bill filter returned **4** rows during the run, where the pre-fix bound returned **0**.

### Not verified

- ~~The close-guard case has no end-to-end test.~~ **Closed** — JRNL-20 above drives a real month-end close against a last-day unposted supplier payment and is verified red→green.

  Two false starts worth recording, because both would have produced a test that passes for the wrong reason. First, an *expense* was the obvious vehicle — but the write boundary added in §5.3/§6.5 now normalises `expenseDate` to a calendar date, so an expense can no longer carry a time and could not reproduce the fault. Second, an approved vendor bill lands `postingStatus: 'not_required'` in this environment and is therefore not counted as a blocker at all. A supplier payment works because `countSupplierPaymentPostingBlockers` counts `not_required` alongside `pending` (`prisma-procurement.repository.ts:1207`).
- ~~§5.3 (reversal `entryDate`) has no clock-shifted test.~~ **Closed by simulation** — see §12.
- ~~§5.4 is a no-op on the UTC host.~~ **Closed by pinning the zone** — see §12.
- Production data volumes are unmeasured; all counts are from local seed data.

## 11. Review pass (2026-08-06, after implementation)

A second look, specifically for faults the remediation itself might have introduced.

### It had introduced one

The new helpers throw on input that is not a calendar day, and `fromDate`/`toDate` reach them
straight off the query string — no controller or DTO validates them. So a malformed filter became
an unhandled `TypeError`, and the client got a **500**. Measured against the pre-fix code:

| Query | Before | After the fix | Now |
| --- | --- | --- | --- |
| `fromDate=garbage` | 400 | **500** | 400 |
| `fromDate=2026-02-30` | **200** | **500** | 400 |
| `fromDate=2026-8-4` | 200 / 400 | **500** | 400 |
| `fromDate=` (absent) | 200 | 200 | 200 |

Fixed by giving civil-date a typed `InvalidCivilDateError` (subclassing `TypeError`, so existing
callers and tests are unaffected) and translating it to 400 in `AllExceptionsFilter` — the same
shape the filter already uses for Prisma errors. The helpers stay framework-free; the HTTP concern
stays at the HTTP boundary.

Note the middle row: `2026-02-30` previously returned **200** and silently queried **2 March**,
because `new Date('2026-02-30')` rolls over. The end state is stricter than what it replaced, and
that is the point — a filter the user did not ask for is worse than an error.

Pinned by `e2e/cross-cutting.spec.ts` **XC-20**.

### Everything else checked and clean

- **No missed `lte` date bounds.** The remaining ones are instant comparisons, plus
  `erp-tools.use-case.ts:337`, which already builds an explicit Bangkok end-of-day and is correct.
- **No date-equality (`equals:`) comparisons** anywhere — the same fault with a different operator
  does not exist.
- **`apps/ai-gateway` was already correct**: all four date derivations use
  `toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })`; its `toISOString()` uses are `asOf`
  instants.
- **`apps/workers`** computes only backoff instants. No calendar logic.
- The §6.6 protected sites are still byte-identical.

### Final verification

| Check | Result |
| --- | --- |
| contracts | 99 pass |
| web test / typecheck | 729 pass, clean |
| api lint | clean |
| api specs (incl. exception filter) | 139 pass |
| E2E, 8 suites | 43 pass, 1 skipped |

Regression tests, each verified red→green by reverting the relevant file from the parent commit
(note `git stash push <file>` is a silent no-op once committed, and proves nothing):
EXP-24, EXP-25, AP-20, JRNL-20, XC-20.

## 12. Closing the last two gaps by simulation (2026-08-06)

Both remaining gaps were recorded as untestable. Neither actually was — the obstacle was assuming
the test had to observe real time on the real host.

**§5.3, the reversal date.** `node:test` mock timers move the clock inside the process:
`t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-05T19:00:00.000Z') })` — 02:00 on
6 August in Bangkok. The use case runs against the existing in-memory ledger store and the
reversal's `entryDate` is asserted.

**§5.4, the period bounds.** The fault only appears off-UTC, so the spec pins
`process.env.TZ = 'Asia/Bangkok'` before any `Date` is constructed. The test also asserts its own
premise — that local and UTC midnight actually differ — so it fails loudly rather than passing
vacuously if the pin ever stops working.

I had also mis-stated the environment. The API *container* runs UTC, but `pnpm --filter api test`
runs on the **host**, which is +07. §5.4 was therefore always observable in the unit-test
environment; the pin makes it deterministic on a UTC CI box too.

Both verified by restoring `journal.use-case.ts` and `period.use-case.ts` from the parent commit:

| Test | Pre-fix actual | Expected |
| --- | --- | --- |
| reversal at 02:00 Bangkok | `2026-08-05T19:00:00.000Z` — previous day, carrying a time | `2026-08-06T00:00:00.000Z` |
| bounds of period `2026-05` | `2026-04-30T17:00:00.000Z` — **the wrong month** | `2026-05-01T00:00:00.000Z` |

The second is worse than §5.4 described: on a +07 host the period `2026-05` began on 30 April, so
every close check, blocker count and report bounded by it was off by a day at both ends.

Restored, both pass. Ledger and exception-filter specs together: 58 pass.

### Correction

That claim was made once before it was true. §5.2 (the period-key defaults) had no test at all —
Phase 4 ran a sweep and a typecheck and I mistook that for coverage. `defaultPeriodKey` and
`defaultDateRange` already take an injectable clock, so it needed no simulation, only writing:
at 02:00 Bangkok on 1 September the old code answered `2026-08` and a range of
`2026-08-01..2026-08-31` — a whole month out. Now pinned in
`report-query-validator.logic.spec.ts`.

**Every finding in this spec now has a test that fails against the code it replaced**, verified
one at a time by restoring the relevant file from the parent commit: §5.1 AP-20 and JRNL-20,
§5.2 the validator defaults, §5.3 and §5.4 the ledger specs, §11 XC-20, plus EXP-24/EXP-25 from
the earlier commits. Nothing in §5 rests on inspection alone.
