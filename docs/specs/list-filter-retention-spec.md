# List Filter Retention Spec

## 1. Status

v1.2, 2026-08-06. **Implemented and verified** — unit, typecheck, build, and E2E against local Docker infra (Postgres, Redis, MinIO).

Owner: thawtchai. Reported from use: a user parks the expense list on กันยายน, opens one receipt row, presses กลับ, and the list is back on the current month. The filter is not remembered anywhere, so every return trip re-derives "today".

v1.1: **G9 promoted from a deferred, unconfirmed note to a confirmed bug and fixed** (§9A). Running the data check the v1.0 spec asked for showed the LINE receipt-photo path writes a timestamped `expenseDate`, which the list's `lte`-midnight bound then hid — a day view of today returned nothing.

v1.2: **G10 — the same two date bugs on the server** (§9A). The G9 read fix made those rows visible but left the write side posting an instant, and left every server-side "today" reading the UTC day on a UTC host. Both fixed; the API now has `businessToday()` / `businessDateOnly()`.

Linked plan: [[plans/list-filter-retention-plan|List Filter Retention Plan]]

Related: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] (owns the expense list surface), [[specs/web-core-workspace-spec|Web Core Workspace Spec]] (owns the nav registry this spec reuses for menu identity).

## 2. Goal

A list filter should survive a round trip into a row's detail page and back — and survive nothing else.

The user's rule, stated three ways because each half rules out a different implementation:

| Event | Filter |
| --- | --- |
| First arrival at a list | Defaults to the current day/month |
| Row → detail → back to the list | **Preserved** |
| Browser refresh (F5) | Reset to current |
| Switch to another menu and return | Reset to current |

The value is small and the annoyance is large: a bookkeeper reviewing กันยายน opens twenty receipts in a sitting and currently re-picks the month twenty times.

## 3. Source Facts (verified in code on 2026-08-06)

| Fact | Evidence | Consequence for this design |
| --- | --- | --- |
| The expense list holds its period entirely in `useState`, with the default computed inline | `ExpensesPages.tsx:1216-1218` | Nothing persists it; every mount recomputes "now" |
| The detail view is a **separate route**, opened with `router.push` | `ExpensesPages.tsx:1674` | App Router unmounts the list's client tree — React state is gone, not stale |
| The กลับ control is a forward `<Link>` / `router.push`, not `router.back()` | `ExpenseReviewPage.tsx:238`, `:164` | Browser history state cannot help; there is no back-entry to restore |
| `BranchFilterProvider` already solves the sibling problem — a filter held above the page, in a context, mounted inside the company layout | `WorkspaceScope.tsx:33`, mounted `WorkspaceLayout.tsx:81` | The shape to copy. But it persists to `localStorage` (`:31`) **on purpose** — branch is meant to outlive a refresh. Period is not |
| Nav identity is already resolved by longest-href-prefix, "most specific module wins" | `getActiveModuleKey`, `web-core-workspace.logic.ts:268-286`; `isUnderHref`, `:27-29` | The rule "which menu am I on" exists and is tested. It is the right primitive — but it matches **modules**, and every expense tab shares the one `expenses` module |
| Expense tabs are **nav sub-items** with their own hrefs (`expenses.list` → `/expenses`, `expenses.evidence` → `/expenses/evidence`) | `web-core-workspace.logic.ts:182-232` | Resolving against sub-item hrefs — not module hrefs — is what separates a sibling tab from a detail row |
| Detail routes carry an opaque id (`/expenses/<expenseId>`) and are **not** in the nav registry | `ExpensesPages.tsx:1674` vs `:182-232` | Longest-prefix over sub-item hrefs classifies `/expenses/abc123` under `expenses.list` and `/expenses/evidence` under `expenses.evidence`. This is exactly the boundary the user asked for, for free |
| `navItems` handed to the shell is filtered by a design-handoff whitelist after `buildNavItems` | `WorkspaceLayout.tsx:56-68` | Menu resolution must read the **pre-whitelist** list, or whitelisted-out menus resolve wrong |
| Web unit tests run `tsx --test "src/**/*.spec.ts"` — `.ts` only | `apps/web/package.json` | No component testing. Logic must land in a pure `.ts` module to be testable at all |
| The API reads `fromDate`/`toDate` as UTC instants (`new Date(rest.fromDate)`) | `prisma-expense.repository.ts:412` | Became G9 once the data check ran — the inclusive `lte` bound hid every row carrying a time |
| The API runs on a **UTC host**; no `TZ` is set in any compose file or task definition | verified 2026-08-06: API container reports UTC, operator machine +07 | Server-side `toISOString().slice(0, 10)` names the UTC day → G10 |

## 4. Scope Note — retention plus the bugs found underneath it

This spec started as retention only. The survey (§9) turned up defects in the same date-handling code, and the owner ruled on 2026-08-06: **"ที่เป็นบั๊ค ต้องแก้ด้วย" — the ones that are genuine bugs get fixed in this change.**

So the spec covers two things that share a code path:

1. **Retention** (§5–§8) — the reported problem: a filter that will not stay put.
2. **The bugs underneath it** (§9A) — G1, G3, G5, then G9 and G10 as later passes confirmed them. A filter that stays put but defaults to the wrong month is not fixed, and neither is a list that cannot see the receipts a user sent through LINE.

Findings that are *not* bugs — dead code, duplication, tooling limits, latent traps with no reachable symptom — stay recorded and deferred in §9B. "Fix the bugs" is not "fix everything the survey touched."

### Non-goals

- Persisting a filter across a refresh or a browser restart. That is a different feature ("saved views"), it already exists server-side for the reports workspace (`ReportsWorkspacePage.tsx:145`), and the user explicitly does not want it here.
- Putting filters in the URL. See §5.
- Changing date **arithmetic**, list queries, or API contracts. G1 changes which *timezone* a default is read in; it does not change what a default means.
- Retaining non-filter list state (scroll position, expanded rows, selection).
- Touching the branch filter. It persists across refresh deliberately and correctly.

## 5. Key Design Decision — menu-scoped, in memory

**Each of the four rows in §2 eliminates a storage medium. Exactly one survives all four.**

| Medium | Survives detail trip | Resets on refresh | Resets on menu change | Verdict |
| --- | --- | --- | --- | --- |
| `useState` in the page | ✗ | ✓ | ✓ | Today's bug |
| `localStorage` | ✓ | **✗** | ✗ | Wrong — outlives everything |
| `sessionStorage` | ✓ | **✗** | ✗ | Wrong — a tab session spans refreshes |
| URL search params | ✓ | **✗** | ✓ | Wrong — the URL is restored by F5 |
| Context above the page, cleared on menu change | ✓ | ✓ | ✓ | **This** |

React state held in a provider inside the company layout is in memory only. A refresh destroys the whole tree, so requirement 3 is satisfied by doing nothing — which is the point: no clearing code, no storage key, nothing to get wrong.

**"Menu" means the nav sub-item, resolved by longest-href-prefix.** The repo already has this rule for lighting up the sidebar (`isUnderHref` + most-specific-wins). Applying it to *sub-item* hrefs rather than module hrefs gives:

```
/companies/x/expenses            → expenses.list        (the list)
/companies/x/expenses/abc123     → expenses.list        (detail — no nav href is more specific)  → KEEP
/companies/x/expenses/evidence   → expenses.evidence    (a real sub-item href, more specific)    → RESET
/companies/x/dashboard           → dashboard                                                     → RESET
```

The detail page keeps the filter because nothing in the nav registry claims its path. A sibling tab resets it because it has an href of its own. No route allowlist, no id-shaped-segment heuristic, no per-page wiring — and every menu added later is classified correctly on the day it is added.

**Store shape: one slot, replaced wholesale on menu change.** `{ menuKey, values: Record<string, unknown> }`. A page asks for its value under its own key; if `menuKey` no longer matches the current menu the whole slot is dropped and the page gets its default. Multiple filters on one screen coexist under distinct keys; two screens never collide because a menu change wipes the slot first.

## 6. Business Journey

1. An accountant opens รายการค่าใช้จ่าย. No stored value → the list shows the current month. (Unchanged from today.)
2. They switch to กันยายน 2569 and scan the rows.
3. They click a receipt row. The detail page opens at `/expenses/<id>` — same menu, so the slot is untouched.
4. They press กลับ. The list remounts, reads กันยายน out of the context, and loads September data. **This is the fix.**
5. Steps 3–4 repeat for as many receipts as they like.
6. They click หลักฐานประกอบ in the sidebar. Different menu → the slot is dropped. Returning to รายการค่าใช้จ่าย shows the current month again.
7. They press F5. The provider is a fresh mount with an empty slot → current month.

## 7. Business Rules

1. A list's filter default is unchanged: whatever the page computes today (current month for the expense list, `''` = all months for the evidence panel) stays the default when no value is stored.
2. A stored value is returned only when the current menu key equals the key it was stored under. There is no partial or fuzzy match.
3. The store is memory-only. No `localStorage`, no `sessionStorage`, no cookie, no URL parameter, no server round trip.
4. The store holds presentation state only — never an id, a permission, a scope, or anything a query result depends on for correctness. A restored filter is always a filter the user could have picked by hand at that moment.
5. Restoring a filter must not skip the list's normal load path. The restored value flows through the same `useEffect`/`useCallback` chain a manual pick uses, so loading, error, and empty states behave identically.
6. The branch filter is untouched by this spec and keeps its `localStorage` behaviour.

## 8. Scope — pages in and out

### 8.1 In scope: the reported bug

| Page | Filter state | Detail route | Why it is in scope |
| --- | --- | --- | --- |
| รายการค่าใช้จ่าย `/expenses` | `gran`, `month`, `day` — `ExpensesPages.tsx:1216-1218` | `router.push('/expenses/<id>')` `:1674` | The reported bug, verbatim |
| หลักฐานประกอบ `/expenses/evidence` | `yearMonth`, `dateField` — `ExpensesWorkspacePanels.tsx:441-442` | `onOpenExpense` → same detail route | Same class, same mechanism, one line of wiring once the hook exists |

For the expense list, `chip` (`:1214`), `query` (`:1215`) and `columnSet` (`:1223`) reset on the same trip and are the same annoyance. They are **in scope** — retaining the month but dropping "แสดงเฉพาะรออนุมัติ" would be a half-fix that reads as a new bug. `page` (`:1219`) is **excluded**: an effect force-resets it to 1 whenever a filter changes (`:1264`), so a restored page number would be clobbered on mount — see §9 G2.

### 8.2 Correctly behaved today — no change

Verified during the survey and deliberately left alone, because under the user's own rule they are already right:

- **Dashboard** `/dashboard`. `periodKind` defaults to `'today'` (`DashboardPages.tsx:204`) and its cards link out via server-supplied deep links (`:124`) that point at *other* menus. Leaving the dashboard is a menu change, so resetting on return is the specified behaviour, not a defect. (An earlier read of this page called it broken; the link targets show it is not.)
- **Journal / Ledger** `/journal` (`LedgerReportsPage.tsx:53`), **Tax Reconciliation** (`TaxReconciliationPage.tsx:32`), **Reports workspace** (`ReportsWorkspacePage.tsx:50`), **CRM reports** (`CrmReportsPrototypePage.tsx:81`), **Bookings** (`BookingsPrototypePage.tsx:148-149`). None has a row → detail route, so no round trip exists to lose state on.

These are not free of the *pattern* — every one recomputes its default on mount. They become bugs the moment a detail route is added. Adopting the hook there is a one-line change and is listed as optional Phase 4 in the plan.

### 8.3 Blocked — cannot be fixed by this mechanism

**เบิกจ่าย `/reimbursements`** navigates to its detail drawer with a plain `<a href="?tab=…&focus=…">` (`ReimbursementsPages.tsx:637`, `:1063`, `:1261`). That is a full document navigation: the React tree, every provider, and any in-memory store are destroyed. The page has no date filter today, so nothing is broken right now — but it is a trap. If a date filter is ever added there, this spec's mechanism will silently fail on it. Converting those three anchors to `<Link>` is the prerequisite, recorded as G3.

## 9. Gaps and Bugs Found During the Survey

Every finding is recorded with its evidence and an explicit fix-or-defer decision. §9A is in scope per §4; §9B is not.

### 9A. Bugs — fixed in this change

**G1 — date defaults are read in UTC, not local time.** `new Date().toISOString().slice(0, 10)` yields the **UTC** date. Bangkok is UTC+7, so between **00:00 and 06:59 local** the app's "today" is yesterday, and on the 1st of a month before 07:00 the period default lands in the **previous month**.

This is worse than a display fault, because the same expression seeds **form fields that get saved**:

| Impact | Sites |
| --- | --- |
| Wrong period shown on a list/report | `ExpensesPages.tsx:67-68` (`todayIso`, `thisMonth` — feeds `:1217`, `:1218`, and the KPI at `:1237`), `LedgerReportsPage.tsx:53`, `TaxReconciliationPage.tsx:32`, `ReportsWorkspacePage.tsx:51` |
| **Wrong date written to an accounting record** | `ExpensesPages.tsx:204` (upload `expenseDate`), `:1469` (manual `expenseDate`), `:400` (`subPaymentDate`), `AccountsPayablePages.tsx:52`, `:175`, `:176`, `:383` (claim / bill / due / payment dates), `AccountingPages.tsx:233`, `:374`, `:414` (document dates), `ReimbursementsPages.tsx:1373` (`paidAt`) |
| Wrong effective-from on configuration | `AccountingTaxSetupPage.tsx:152`, `TaxCodeSettingsPage.tsx:53`, `PartnerDetailPage.tsx:166`, `SystemOnboardingNewPage.tsx:313`, `:343` |
| Wrong date in a tax-context probe or export filename | `ExpensesWorkspacePanels.tsx:101`, `TaxAccountSettingsPage.tsx:136`, `ReportsWorkspacePage.tsx:174` |

`bookings.model.ts:1-5` records the repo's position — browser-local time is acceptable for a Thailand-only userbase — and these call sites simply did not follow it. The fix is one shared local-date helper plus a mechanical replacement, which also closes G8.

**Not touched by G1:** `new Date().toISOString()` used as a genuine **instant** is correct as UTC and stays — `LedgerReportsPage.tsx:112` (audit note timestamp), `AccountingPages.tsx:600` (`paidAt` instant).

**G3 — three navigations do a full page reload inside a client-routed app.** `<a href="?tab=…&focus=…">` at `ReimbursementsPages.tsx:637`, `:1063`, `:1261` destroys the React tree, every provider, and any in-memory state, then re-runs the whole session bootstrap — for what is a same-page drawer. Two reasons it is in scope: it is a real defect today (a white flash and a full refetch on every "ดูรายละเอียด"), and it is the one place where this spec's mechanism would silently fail if a date filter were ever added there.

Verified safe to convert: the page reads the parameter reactively — `useSearchParams()` at `:228`, `focusId` at `:234`, and `useEffect(… openDetail(focusId), [focusId, openDetail])` at `:258` — so a client-side `<Link>` navigation opens the drawer through the same path a reload does.

**G5 — unthemed date control.** `TaxReconciliationPage.tsx:84` uses a raw `<input type="month">` where every other date input in the app uses `ThemedDate` (e.g. `ExpensesPages.tsx:1324-1325`). Visible as an unstyled control in dark mode. One line.

**G9 — a date range hid every row that carried a time.** Promoted from "latent, unconfirmed" (§9B in v1.0) to a confirmed bug after running the data check on 2026-08-06. It is the most serious finding here.

`expenseDate` is a `DateTime`, and the list filter compared it with `lte: new Date(toDate)` — the range's last day at **UTC midnight** (`prisma-expense.repository.ts:412`). Any row whose `expenseDate` carries a time therefore fell outside the range on that day. In a day view, where `fromDate === toDate`, that means **only rows sitting exactly on midnight matched at all**.

Reachability, which v1.0 could not establish, is now settled: **the LINE receipt-photo path writes a full timestamp.**

```
process-line-webhook.use-case.ts:1674   expenseDate: new Date().toISOString()
```

So every receipt a user sends through LINE — the product's primary capture channel — produced a row invisible to the list's day view, and invisible to a month view whenever it landed on the month's last day. The earlier reading ("no caller found that omits the field") was looking at the wrong thing: the LINE path *does* pass the field, it just passes an instant where every other caller passes `YYYY-MM-DD`.

Measured on the local seeded database:

| Query | Rows |
| --- | --- |
| Actually dated 2026-08-03 | 2 |
| Returned by the old bound (`lte` midnight) | **0** |
| Returned by the new bound (`lt` next midnight) | 2 |

6 of 21 rows carried a time component, across `WEB_UPLOAD`, `WEB_MANUAL` and `LINE_UPLOAD`.

**Fixed on the read side, not the write side.** `exclusiveEndOfDay()` turns the inclusive `YYYY-MM-DD` end into the following midnight and compares with `lt` — the same shape `buildSharedEvidenceWhere` in the same file already used. This is the smaller change and, unlike normalising writes, it repairs **rows already stored** without a data migration touching historical accounting dates. The identical bug on `uploadedToDate` is fixed in the same line; `uploadedAt` is always an instant, so that filter's last day was returning almost nothing.

Note the v1.0 gap register named the table `"Expense"`. It is `"ExpenseRecord"` — the suggested owner query would have errored.

**G10 — the server had both date bugs too, on the LINE capture path.** Raised by the owner on 2026-08-06 after G9 landed: the read-side fix made timestamped rows *visible* but left two things wrong underneath.

*(a) The write side.* `process-line-webhook.use-case.ts:1674` posted `new Date().toISOString()` into `expenseDate` — an instant in a column that means a calendar date, and the only caller that did so. Now `businessToday()`.

*(b) The timezone.* The API runs on a **UTC host** (verified: the local API container reports UTC while the operator's machine is +07; no `TZ` is set in any compose file or task definition). So every server-side `new Date().toISOString().slice(0, 10)` named the UTC day — this is G1 again, on the back end, where the web fix could not reach it. A receipt sent through LINE at 02:00 Bangkok was stamped with the previous day.

The repo already had the correct idiom in three places, including the same file as the bug:

```ts
new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })   // → YYYY-MM-DD
```

`common/date/business-date.logic.ts` gives it a name (`businessToday`) so the next caller does not reach for `toISOString()` again, alongside `businessDateOnly()`, which keeps only the date part of whatever a caller sends. The hazard is the one `common/export/thai-date.logic.ts` already documents with a worked example.

Sites changed — every server-side default that means a **calendar date**:

| Site | Field | Why it matters |
| --- | --- | --- |
| `process-line-webhook.use-case.ts:1674` | `expenseDate` | The reported bug: LINE receipt photos |
| `expense-document.use-case.ts:76` | `expenseDate` | LINE text-only expense notes — same channel, same field |
| `expense-upload.use-case.ts:67` | `expenseDate` | Boundary: normalises whatever any caller sends |
| `expense-draft.use-case.ts:73`, `:340` | `expenseDate` | Boundary for web manual create and edit |
| `expense.controller.ts:196` | `expenseDate` | The timestamped fallback G9 first flagged |
| `transaction-tax-config.use-case.ts:241` | `effectiveFrom` | A tax profile effective from the wrong day |
| `internal.controller.ts:135` | `periodKey` | A worker firing at 02:00 summarised the wrong day |
| `report.use-cases.ts:713`, `:685` | `periodKey`, export filename | |
| `reconciliation.use-case.ts:58` | session number | Cosmetic, same substitution |

**Untouched:** genuine instants. `uploadedAt`, `paidAt`, `occurredAt`, audit timestamps and outbox `occurredAt` are moments, not dates, and stay UTC.

**Normalising writes is safe here in a way it was not for G9.** The G9 objection — "the fix would rewrite stored dates" — applied to a *migration*. These changes only affect rows written from now on; nothing historical is touched. Pinned by EXP-25, verified red before and green after.


### 9B. Not bugs — recorded and deferred

| # | Finding | Evidence | Why it is not fixed here |
| --- | --- | --- | --- |
| **G2** | `useEffect(… setPage(1) …, [chip, query, gran, month, day, branchId])` fires on mount, not only on change | `ExpensesPages.tsx:1264` | Not a defect — `page` already starts at 1, so the mount call is a no-op. It is a *constraint*: `page` cannot be retained without restructuring the effect. Handled by excluding `page` (§8.1) |
| **G4** | `serializeListQuery` / `deserializeListQuery` are implemented and tested with **zero production callers** | `src/common/functions/list-query.ts`, `list-query.spec.ts` | Dead code, not a bug. Left in place; the risk it poses — a future reader rebuilding this on URL params, which §5 rejects — is addressed by a comment pointing here rather than by deleting a tested module |
| **G7** | `pnpm --filter web test` runs `tsx --test "src/**/*.spec.ts"`; `.tsx` is unmatched and there is no component runner | `apps/web/package.json` | A tooling limit, not a defect. Shapes where logic lives (pure `.ts` + spec, thin React shell). Adding a component runner is a `package.json` change and its own decision |
| **G8** | Four private copies of "default to current month/day" | `ExpensesPages.tsx:67-68`, `ReportsWorkspacePage.tsx:50-60`, `LedgerReportsPage.tsx:53`, `TaxReconciliationPage.tsx:32` | Duplication is why G1 is four bugs instead of one. Closed as a side effect of the G1 fix, not pursued separately |
| ~~G9~~ | Moved to §9A — **confirmed and fixed**. The data check found 6 of 21 rows carrying a time on `expenseDate`, and the LINE receipt path (`process-line-webhook.use-case.ts:1674`) was found writing a full timestamp | see §9A | Promoted 2026-08-06 |

**G6** is not a gap in the codebase — it is a constraint on this implementation. `navItems` is filtered by `DESIGN_HANDOFF_NAV_RANK` before reaching the shell (`WorkspaceLayout.tsx:56-68`), so menu resolution must consume the **pre-whitelist** `buildNavItems` output or it will misclassify any whitelisted-out menu and retain filters across it. Handled in Phase 1.

## 10. Boundary and Ownership

- **Web owns** all of it. This is client presentation state.
- **Backend/API owns** nothing here. No contract, no endpoint, no payload changes. The same `listExpenses(companyId, { fromDate, toDate, … })` call is made with the same shape.
- **Out of boundary:** any server-side saved view, any per-user preference record, any LINE/LIFF or AI Gateway surface.

## 11. Permission and Audit

No permission gate and no audit event. The store holds only values the user could pick by hand, and every list still applies its own permission checks and branch scope on load (`ExpensesPages.tsx:1234`). A restored filter narrows a view; it can never widen one.

One deliberate consequence of resolving menus from the **permission-filtered** nav list: a user who lacks `expense.evidence.read` has no `/expenses/evidence` href, so that path would resolve to `expenses.list`. Such a user is already redirected away from the page by `canAccessWorkspacePath` (`WorkspaceLayout.tsx:70-74`), so the case is unreachable. Recorded because it is a real asymmetry, not because it needs handling.

## 12. UI Behavior

No visual change. No new control, no "filter remembered" badge, no toast. The only observable difference is that the date control shows the value the user last chose instead of today's, on exactly one navigation path.

Loading, empty, error, and forbidden states are unchanged: a restored filter enters through the same load path as a manual pick (§7 rule 5), so a restored month with no rows shows the ordinary empty state.

## 13. Edge Cases

| Case | Expected |
| --- | --- |
| Detail page is opened by deep link (`?expenseId=` → `router.replace`, `ExpensesPages.tsx:1668-1671`), then กลับ | No stored value for this menu yet → default. Correct: the user never set a filter |
| Company is switched while a filter is stored | The company layout remounts on a different `companyId`; provider state goes with it → default |
| Filter set, then a hard reload happens on the **detail** page, then กลับ | Reset. The refresh destroyed the store, which is rule 3 |
| Two tabs, different months | Independent. Memory is per document |
| A menu whose href is a strict prefix of another (`/expenses` vs `/expenses/evidence`) | Longest match wins — the whole point of §5 |
| Restored month contains no rows | Ordinary empty state, no error |
| Restored `gran: 'day'` with a stored `day` from a previous session | Unreachable — a session boundary always clears the store |

## 14. Acceptance Criteria

- [ ] Expense list: pick a non-current month → open a row → กลับ → the month is still selected and the rows shown are that month's.
- [ ] The same holds for the status chip, the search text, and the export column set.
- [ ] F5 on the list → current month.
- [ ] List → any other sidebar menu → back to the list → current month.
- [ ] List → หลักฐานประกอบ → back to the list → current month (sibling tab counts as a menu change).
- [ ] หลักฐานประกอบ: pick a month folder → open an expense → กลับ → the same folder is still selected.
- [ ] First arrival at either page, with no prior interaction, still defaults exactly as it does today.
- [ ] No value is written to `localStorage`, `sessionStorage`, or the URL by this feature.
- [ ] Menu resolution is driven by the pre-whitelist nav list (G6), verified by a unit test covering a whitelisted-out menu.

Bug fixes (§9A):

- [ ] **G1** — with the machine clock set to 02:00 Bangkok on the 1st of a month, the expense list defaults to **that** month, not the previous one, and the upload form pre-fills **that** day.
- [ ] **G1** — no `new Date().toISOString().slice(…)` remains as a date/month *default* anywhere in `apps/web`; genuine instant uses are untouched.
- [ ] **G3** — "ดูรายละเอียด" in เบิกจ่าย opens the drawer without a full page reload, on all three surfaces (mine / approvals / finance), and the deep-link entry still works.
- [ ] **G5** — the tax reconciliation period picker is themed in dark mode.

## 15. Test Cases

**Unit** (pure `.ts`, per G7) — local-date helper, with an injected clock so no fake timers are needed:

- `2026-09-01T02:00:00+07:00` → `2026-09-01` / `2026-09` (the G1 regression: UTC would give `2026-08-31` / `2026-08`)
- `2026-09-30T23:59:00+07:00` → `2026-09-30` (UTC would give `2026-10-01`)
- a midday instant, where UTC and local agree
- single-digit month and day are zero-padded

**Unit** (pure `.ts`, per G7) — menu resolution and store reduction:

- `/companies/x/expenses` → `expenses.list`
- `/companies/x/expenses/abc123` → `expenses.list` (detail is not a menu)
- `/companies/x/expenses/evidence` → `expenses.evidence` (longest prefix wins)
- `/companies/x/expenses/upload` → `expenses.upload`
- `/companies/x/dashboard` → `dashboard`
- unknown path → `null`, and a `null` menu never returns a stored value
- a menu absent from the design-handoff whitelist still resolves (G6)
- store: same key → value returned; changed menu key → slot dropped, default returned; two keys under one menu → independent

**E2E** (`e2e/expenses.spec.ts`) — the four rows of §2 as four assertions, since the mechanism is only observable through real navigation.

**Not tested:** the provider component itself. No component runner exists (G7); its behaviour is covered by the unit tests beneath it and the E2E above it.

## 16. Open Questions

None blocking. Settled during review on 2026-08-06:

- *Should a sibling tab (`/expenses/evidence`) reset the list's filter?* **Yes** — owner decision. "Different sidebar entry = different menu = reset." This is what makes sub-item resolution the right primitive rather than module resolution.
- *Should non-date list state (chip, query, columnSet) be retained too?* **Yes** — §8.1. Retaining only the date would read as a new bug.
- *Should G1 (UTC default) be fixed in the same change?* **Yes** — reversed by the owner on 2026-08-06 ("ที่เป็นบั๊ค ต้องแก้ด้วย"). The survey showed G1 is not merely a display fault: the same expression seeds date fields that are **saved** to expenses, bills, payments, and tax configuration (§9A). Retaining a filter that defaults to the wrong month would not have fixed the user's problem. G3 and G5 come in on the same rule.
- *Should G9 (timestamped `expenseDate`) be fixed too?* **Yes — resolved 2026-08-06 by running the data check instead of guessing.** v1.0 answered "no, not on speculation", which was the right call *at the time*: reachability was unproven and the write-side fix would have rewritten stored dates. The check then found 6 of 21 rows carrying a time and the LINE receipt path writing a full timestamp. Fixing the **read** side (`lt` next midnight) turned out to need no migration and to repair existing rows, so the original objection did not apply to the fix that was actually needed. Pinned by EXP-24, which fails against the old bound.
