# Agent Memory: list-filter-retention

Status: **Phases 1–5c implemented and verified end to end.** Docker infra (Postgres/Redis/MinIO) up locally 2026-08-06. E2E 20/20; API specs across every touched module 232/232; web 734/734. G9 and G10 both promoted from notes to confirmed bugs and fixed.
Owner: thawtchai (reporter, decisions) / Claude (survey, docs)
Scope: `apps/web` + `apps/api` (grew from web-only once the date bugs turned out to have server-side twins). Make a list filter survive a row → detail → back round trip; reset on refresh and on menu change. Reported against the expense list (`/expenses`).

## Decisions

- **Storage is memory-only, in a context above the page.** Each of the four required behaviours eliminates a medium: `useState` loses the round trip; `localStorage`, `sessionStorage`, and URL params all survive F5, which the owner does not want. Only in-memory React state above the page satisfies all four. Elimination table in spec §5.
- **"Menu" = nav sub-item, resolved by longest-href-prefix**, reusing the existing `isUnderHref` + most-specific-wins rule. This classifies `/expenses/abc123` under `expenses.list` (keep) and `/expenses/evidence` under `expenses.evidence` (reset) with no route allowlist and no id heuristic — and classifies every future menu correctly for free.
- **Sibling tab resets the filter** (owner, 2026-08-06). "Different sidebar entry = different menu = reset." This is the reason resolution must target sub-item hrefs rather than module hrefs — `getActiveModuleKey` is too coarse, since all expense tabs share the one `expenses` module.
- **Non-date list state is included** (`chip`, `query`, `columnSet`). Retaining the month but dropping the status chip would read as a new bug.
- **`page` is excluded.** An effect force-resets it to 1 on mount (`ExpensesPages.tsx:1264`), so a restored page number would be clobbered.
- **G1/G3/G5 are fixed in this change** — owner ruling 2026-08-06, "ที่เป็นบั๊ค ต้องแก้ด้วย", reversing the earlier deferral. Decisive detail found on the second pass: G1 is not display-only. The same `toISOString()` expression seeds date fields that are **saved** — expense date, bill/due/payment date, document date, tax effective-from — so before 07:00 Bangkok the app writes yesterday into accounting records.
- **G9 was fixed after the data check disproved the reason for deferring it.** The check found the LINE receipt path (`process-line-webhook.use-case.ts:1674`) writing a full timestamp into `expenseDate`, which the list's `lte`-midnight bound then hid — a day view of today returned nothing. Deferring was right while reachability was unproven; the check settled it. Crucially the fix landed on the **read** side (`lt` next midnight), which needs no migration and repairs already-stored rows — so the original objection ("it would rewrite stored dates") never applied to the fix actually needed.

- **G10 — the server had both date bugs too** (owner instruction, 2026-08-06). The G9 read fix made timestamped rows visible but left (a) the LINE path writing an instant into a date column and (b) every server-side "today" reading the **UTC** day. The API runs on a UTC host — verified, no `TZ` set anywhere — so this is G1 again where the web fix could not reach. `common/date/business-date.logic.ts` names the idiom the repo already used inline. Normalising writes was safe here in a way it was not for G9: these only affect rows written from now on, nothing historical is rewritten.

## Accepted assumptions

- Provider state resets during render, not in an effect — an effect runs one paint too late and the page would flash the previous menu's filter. Idempotent, so StrictMode-safe.
- `undefined` is the "no stored value" sentinel; `''` must round-trip (evidence panel's `yearMonth` default is `''` = all months), so `??` on the read would be wrong.
- Menu resolution reads the **pre-whitelist** `buildNavItems` output. `WorkspaceLayout.tsx:56-68` filters `navItems` by `DESIGN_HANDOFF_NAV_RANK` before handing it to the shell; using the filtered list would silently retain filters across whitelisted-out menus.

## Open questions

None blocking.

## Artifacts

- Spec: [[specs/list-filter-retention-spec|List Filter Retention Spec]] — survey, elimination table, impact scope §8, gap register §9
- Plan: [[plans/list-filter-retention-plan|List Filter Retention Plan]] — Phases 0–4
- Reported bug: `ExpensesPages.tsx:1216-1218` (state) + `:1674` (detail push) + `ExpenseReviewPage.tsx:238` (forward-push กลับ)

## Gap register (found during survey, each deferred with evidence)

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| G1 | `toISOString()` defaults are UTC; before 07:00 Bangkok "today" is yesterday, and on the 1st before 07:00 the period lands in the previous month. **Also seeds saved fields** — expense/bill/due/payment/document dates, tax effective-from | ~20 sites, 13 files — enumerated in spec §9A | **FIX — Phase 4** |
| G2 | `setPage(1)` effect fires on mount, not only on change | `ExpensesPages.tsx:1264` | Not a bug (page starts at 1). Constrains design; `page` excluded |
| G3 | Reimbursements navigates by `<a href>` = full reload; any in-memory store dies there | `ReimbursementsPages.tsx:637`, `:1063`, `:1261` | **FIX — Phase 5.** Verified safe: `focus` is read reactively (`useSearchParams` `:228` → effect `:258`), so `<Link>` opens the drawer the same way |
| G4 | `list-query.ts` serialize/deserialize helpers are tested with zero production callers | `src/common/functions/list-query.ts` | Dead code, not a bug. Invites the rejected URL-param design — comment rather than delete |
| G5 | Tax reconciliation uses a raw `<input type="month">`, not `ThemedDate` | `TaxReconciliationPage.tsx:84` | **FIX — Phase 5.** One line |
| G6 | `navItems` is whitelist-filtered before the shell sees it | `WorkspaceLayout.tsx:56-68` | **Prerequisite** — handled in Phase 1 |
| G7 | Web tests are `tsx --test "src/**/*.spec.ts"` — no `.tsx`, no component runner | `apps/web/package.json` | Tooling limit. Shapes the plan: pure `.ts` logic + E2E |
| G8 | Four private copies of "default to current month/day" | 4 sites | Why G1 is four bugs. Closed by the Phase 4 helper |
| G10 | Server-side: LINE wrote a full **timestamp** into `expenseDate`, and every server `toISOString().slice(0,10)` named the **UTC** day on a UTC host — a receipt sent at 02:00 Bangkok was stamped yesterday | `process-line-webhook.use-case.ts:1674`, +8 sites in spec §9A | **FIXED — Phase 5c.** `businessToday()` / `businessDateOnly()`; write boundaries normalise so no caller can reintroduce it. Instants untouched. Pinned by EXP-25 |
| G9 | The **LINE receipt path** writes a full timestamp into `expenseDate` (`process-line-webhook.use-case.ts:1674`); the list filter used `lte: <UTC midnight>`, so those rows were invisible on the last day of any range and invisible in day view entirely | `process-line-webhook.use-case.ts:1674`, `prisma-expense.repository.ts:412` | **FIXED — Phase 5b.** Confirmed by data check: 6 of 21 rows carried a time; a day view of 2026-08-03 returned 0 of 2 rows. Read-side fix (`lt` next midnight) — no migration, repairs stored rows. Pinned by EXP-24. Table is `"ExpenseRecord"`, not `"Expense"` |

## Verification

Run 2026-08-06 on branch `develop`:

| Check | Result |
| --- | --- |
| `pnpm --filter web test` | **734 pass, 0 fail** (was 722 before; +12 new) |
| `pnpm --filter web typecheck` | **clean** |
| `pnpm --filter web build` | **clean** — full production build |
| `grep -rn "new Date()\.toISOString()\.slice" apps/web/src` | only the doc comment in `today.ts`; the two genuine instants (`LedgerReportsPage.tsx:113`, `AccountingPages.tsx:601`) untouched |
| `pnpm --filter api lint` | **clean** |

New unit coverage:

- `common/functions/today.spec.ts` (5) — pins G1. `process.env.TZ = 'Asia/Bangkok'` is set before any `Date` is built, so `2026-09-01T02:00:00+07:00` asserts `toISOString()` gives `2026-08-31` while `todayIso()` gives `2026-09-01`. **The old implementation fails this test.**
- `web-core-workspace/menu-filter.spec.ts` (7) — the retention rule itself: same menu keeps the slot object, changed menu drops it, `''` round-trips, the default factory is not called when a value is stored.
- `web-core-workspace.spec.ts` `resolveMenuKey` (+7) — `/expenses/<id>` resolves to the same key as `/expenses`; `/expenses/evidence|upload|manual` each resolve to their own; a whitelist-dropped menu (`journal`) still resolves (G6).

### E2E — run against local Docker infra

`docker compose -f infra/docker/compose.local.yml up -d postgres redis minio minio-create-bucket` with `POSTGRES_PORT=5432` (compose defaults to 15432; Playwright expects 5432). Schema was already at head on the existing volume; `sync-permissions.ts` run before the suite. `run-local.sh` was bypassed because its preflight shells out to `psql`/`redis-cli`, neither of which is installed here — Playwright was invoked directly with the same env.

**`pnpm exec playwright test e2e/expenses.spec.ts e2e/reimbursements.spec.ts` → 19 passed, 0 failed.**

The first attempt found a real defect **in the tests, not the code**: they navigated with `gotoCompany()`, which is `page.goto()` — a full document load that resets the store by design. EXP-20 failed for that reason, and EXP-22/23 were passing *vacuously* (a full reload always resets, so they would have passed with the feature absent). Rewritten to use genuine client-side navigation — clicking a row, the กลับ link, and sidebar links, following the pattern in `sidebar-nav.spec.ts`. The probe is the export-columns select, the one retained value that does not filter the list, so a row stays clickable for the round trip. `data-testid="expenses-row"` added to the desktop grid row (the mobile card already had one).

EXP-24 was verified as a true regression test: **red with the fix stashed, green with it restored.**

### Not verified

- No manual click-through in a browser; the E2E covers the same journeys.
- The React provider has no direct test (G7 — no component runner). Covered beneath by `menu-filter.spec.ts` and above by E2E.
- `pnpm --filter api test` fails in `pretest` on `prisma-reimbursement.repository.draft-submit-race.spec.ts` (`legacy_reimbursement_approval_path_disabled`, 409). **Pre-existing** — reproduced with the API change stashed. A launch-gate state issue, unrelated to this work. The API specs covering the changed repository were run directly and pass (29 tests).

### Design note settled during implementation

`resolveMenuKey('/companies/x/expenses')` returns `'expenses'`, not `'expenses.list'` — the `expenses` **module** and its `expenses.list` **sub-item** share one href, so the longest-prefix tie falls to whichever comes first. Harmless: both name the same screen, and only the grouping matters. The test asserts the detail route resolves to *the same key as the list* rather than to a hard-coded string.

Survey verification (earlier, same day): all line references above read directly from the working tree; no functional-updater setters among the ten converted call sites (`ExpensesPages.tsx:1320-1363`, `ExpensesWorkspacePanels.tsx:587-654`), so `useMenuFilterState` was a safe drop-in for `useState`.

## Next

1. **Push** — `git push origin develop`. No push credentials on this Mac.
2. **Optional data cleanup.** The read fix makes existing timestamped `expenseDate` rows visible and the write fix stops new ones, but ~6 historical rows still carry a time. Harmless now; normalise only if a report ever needs date equality rather than range.
3. Optional, deferred: Phase 6 (retention on journal / tax / reports / CRM / bookings) — none has a row → detail route today.
4. Tear down local infra: `docker compose -f infra/docker/compose.local.yml down`.
5. Pre-existing, unrelated: `pnpm --filter api test` fails in `pretest` on the reimbursement draft-submit race spec (`legacy_reimbursement_approval_path_disabled`). Reproduced with all changes stashed. Someone should look at that launch-gate state.

## Files touched

New: `common/functions/today.ts` (+spec), `web-core-workspace/MenuFilterScope.tsx`, `web-core-workspace/menu-filter.logic.ts` (+spec).
New (api): `common/date/business-date.logic.ts`.
Changed (api): `prisma-expense.repository.ts` (G9 bound), `process-line-webhook.use-case.ts`, `expense-document.use-case.ts`, `expense-upload.use-case.ts`, `expense-draft.use-case.ts`, `expense.controller.ts`, `transaction-tax-config.use-case.ts`, `internal.controller.ts`, `report.use-cases.ts`, `reconciliation.use-case.ts`, `expense-upload.use-case.spec.ts` (+4 tests).
Changed (web): `web-core-workspace.logic.ts` (+`collectMenuTargets`, `resolveMenuKey`), `WorkspaceLayout.tsx` (split memo, mount provider), `ExpensesPages.tsx`, `ExpensesWorkspacePanels.tsx`, `ReimbursementsPages.tsx`, `TaxReconciliationPage.tsx`, plus 10 files for the G1 sweep. `e2e/expenses.spec.ts` (+6: EXP-20…25).
