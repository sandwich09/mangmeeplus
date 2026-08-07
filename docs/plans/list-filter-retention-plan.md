# List Filter Retention Implementation Plan

## Linked Spec

- Spec: [[specs/list-filter-retention-spec|List Filter Retention Spec]]
- Related guidelines: `.agents/skills/ponytail/SKILL.md` (full mode — shortest correct diff)
- Task memory: [[agent-memory/list-filter-retention|List Filter Retention]]

## Purpose

Make a list filter survive a row → detail → back round trip, and nothing else. Today the expense list recomputes "current month" on every mount because the detail view is a separate route, so a bookkeeper reviewing กันยายน re-picks the month once per receipt.

The whole change is one primitive plus two call sites. It adds no dependency, no storage, no contract, and no UI.

## Current Repository Context

- **App:** `apps/web` only. No API, contracts, workers, or AI Gateway involvement.
- **Patterns to reuse:**
  - `BranchFilterProvider` (`src/features/web-core-workspace/WorkspaceScope.tsx:33`, mounted `WorkspaceLayout.tsx:81`) — the provider-above-the-page shape. Copy the shape, **not** its `localStorage` persistence.
  - `isUnderHref` + most-specific-wins (`web-core-workspace.logic.ts:27-29`, `:268-286`) — the existing, tested route→menu rule. The new resolver is a sibling of `getActiveModuleKey` in the same file.
  - `buildNavItems` (`web-core-workspace.logic.ts:110+`) — already produces every menu href including sub-items.
- **Dependencies:** none added. React 19 / Next 16 App Router, already present.
- **Risks:**
  - The provider must reset its slot *during render* so the child's `useState` initializer sees the cleared store in the same pass (Phase 1, §Design note).
  - `navItems` is whitelist-filtered before it reaches the shell (spec §9 G6) — resolution must read the pre-whitelist list.
  - `page` cannot be retained (spec §9 G2). Do not try.

## Implementation Rules

- Follow `docs/plans/master-implementation-checklist.md`.
- Reuse `isUnderHref` rather than writing a second prefix matcher.
- Pure logic lands in `.ts` with a spec; the React shell stays thin — `pnpm --filter web test` matches `src/**/*.spec.ts` only (spec §9 G7).
- Do not add `localStorage`, `sessionStorage`, cookies, or URL parameters. The spec rejects all four in §5 and the rejection *is* the feature.
- Do not change any default value, date arithmetic, or list query.
- Do not touch `package.json`.

## Scope

### In Scope

**Retention** (Phases 1–3):

- One pure resolver + one pure store reducer, unit tested.
- One context provider mounted in `WorkspaceLayout`.
- Splitting the `navItems` memo so menu resolution reads the pre-whitelist list (G6).
- Expense list: `gran`, `month`, `day`, `chip`, `query`, `columnSet`.
- Evidence panel: `yearMonth`, `dateField`.
- E2E coverage of the four behaviours in spec §2.

**Bug fixes** (Phases 4–5), per the owner's 2026-08-06 ruling — spec §4, §9A:

- **G1** — a local-date helper plus mechanical replacement of every UTC now-default in `apps/web`. Closes G8 on the way.
- **G3** — three `<a href>` → `<Link>` in reimbursements.
- **G5** — `ThemedDate` in tax reconciliation.

### Out of Scope

- `page` on the expense list (G2) — a constraint, not a defect.
- ~~**G9**~~ — moved **in scope** (Phase 5b) after the data check confirmed it. See spec §9A.
- ~~**G10**~~ — server-side date defaults, moved **in scope** (Phase 5c) on owner instruction. See spec §9A.
- Deleting the dead `list-query.ts` helper (G4); adding a component test runner (G7).
- Journal, tax reconciliation, reports, CRM reports, bookings, dashboard **retention** — spec §8.2. (Their G1 *defaults* are still fixed in Phase 4; that is a different change to the same files.) Phase 6 is optional and deferred.

## Phase 0: Discovery and Alignment

### Goal

Confirm the survey is still accurate before writing code.

### Tasks

- [x] Map every list page with a date filter, its storage, and its default (spec §3, §8).
- [x] Confirm the detail view is a separate route and the กลับ control is a forward push (`ExpensesPages.tsx:1674`, `ExpenseReviewPage.tsx:238`, `:164`).
- [x] Confirm nav sub-items carry their own hrefs, so longest-prefix separates a sibling tab from a detail row (`web-core-workspace.logic.ts:182-232`).
- [x] Confirm no converted setter uses a functional updater — verified: all ten call sites pass plain values (`ExpensesPages.tsx:1320-1363`, `ExpensesWorkspacePanels.tsx:587-654`), so `useMenuFilterState` can be a drop-in for `useState`.
- [x] Record adjacent bugs rather than absorbing them (spec §9).

### Exit Criteria

Owner has accepted spec §16 — sibling tab resets, non-date list state is included, G1 deferred. **Accepted 2026-08-06.**

## Phase 1: The primitive

### Goal

A menu-scoped, memory-only filter store that a page consumes exactly like `useState`.

### Tasks

- [ ] **`src/features/web-core-workspace/web-core-workspace.logic.ts`** — add two pure exports beside `getActiveModuleKey`:
  - `collectMenuTargets(items: NavItem[]): { key: string; href: string }[]` — flattens items + `subItems`, dropping entries with no `href` (a disabled module has `href: undefined`, `:124`).
  - `resolveMenuKey(pathname: string, targets: { key: string; href: string }[]): string | null` — longest `href` satisfying `isUnderHref`, else `null`. Same rule as `getActiveModuleKey:281-283`, applied to sub-item hrefs.
- [ ] **`src/features/web-core-workspace/MenuFilterScope.tsx`** — new, ~35 lines:
  - `MenuFilterProvider({ menuKey, children })` holding `useRef<{ menuKey: string | null; values: Map<string, unknown> }>`; when `menuKey` differs from the slot's, replace the slot **during render**.
  - `useMenuFilterState<T>(key: string, initial: () => T): [T, (value: T) => void]` — `useState` seeded from the store, and a setter that writes through.
- [ ] **`WorkspaceLayout.tsx`** — split the `navItems` memo (`:56-68`) so the raw `buildNavItems(...)` result is kept, derive `menuKey = resolveMenuKey(pathname, collectMenuTargets(allNavItems))`, and wrap the shell in `<MenuFilterProvider menuKey={menuKey}>` inside `BranchFilterProvider` (`:81`). The existing whitelist filter keeps operating on the same raw list, so the sidebar is unchanged.

### Design note — why the slot resets during render

The reset must be visible to a child's `useState` initializer in the *same* render pass, and children render after their parent. An effect would run one paint too late and the page would flash the previous menu's filter. Mutating a ref during render is the derive-from-props escape hatch, and it is idempotent here: a second pass with the same `menuKey` is a no-op, so StrictMode double-render is safe, and a torn concurrent render can only over-reset — which yields the default, the safe direction. This reasoning goes in a comment at the mutation.

### Sentinel note

`useMenuFilterState` treats `undefined` as "no stored value" and never stores `undefined`. This matters: the evidence panel's `yearMonth` default is `''` (= all months) and a stored `''` must round-trip, so `??` on the read would be wrong.

### Tests

- [ ] `web-core-workspace.spec.ts` — extend with spec §15 unit cases: `/expenses` → `expenses.list`; `/expenses/abc123` → `expenses.list`; `/expenses/evidence` → `expenses.evidence`; `/expenses/upload` → `expenses.upload`; `/dashboard` → `dashboard`; unknown → `null`; a menu absent from `DESIGN_HANDOFF_NAV_RANK` still resolves (G6).
- [ ] Command: `pnpm --filter web test`

### Exit Criteria

Resolver and store are unit-green. The app builds and behaves exactly as before — nothing consumes the hook yet.

## Phase 2: Expense list

### Goal

The reported bug is fixed.

### Tasks

- [ ] `ExpensesPages.tsx:1214-1223` — replace six `useState` calls with `useMenuFilterState`, keys prefixed `expenses.list.`:

  | Line | From | To |
  | --- | --- | --- |
  | 1214 | `useState<…>('all')` | `useMenuFilterState('expenses.list.chip', () => 'all')` |
  | 1215 | `useState('')` | `useMenuFilterState('expenses.list.query', () => '')` |
  | 1216 | `useState<Gran>('month')` | `useMenuFilterState('expenses.list.gran', () => 'month')` |
  | 1217 | `useState(thisMonth())` | `useMenuFilterState('expenses.list.month', thisMonth)` |
  | 1218 | `useState(todayIso())` | `useMenuFilterState('expenses.list.day', todayIso)` |
  | 1223 | `useState<…>('summary')` | `useMenuFilterState('expenses.list.columnSet', () => 'summary')` |

- [ ] Leave `page` (`:1219`) as `useState`. The effect at `:1264` resets it to 1 on mount (G2); retaining it would be a lie.
- [ ] Change nothing else — `periodRange`, `load`, and the export path already read these values and keep working unmodified.

### Tests

- [ ] `pnpm --filter web test` and `pnpm --filter web typecheck`
- [ ] Manual, against the acceptance criteria in spec §14: pick กันยายน → open a row → กลับ → still กันยายน; F5 → current; switch menu and return → current; switch to หลักฐานประกอบ and return → current.

### Exit Criteria

All four rows of spec §2 behave correctly on `/expenses`, verified by hand.

## Phase 3: Evidence panel

### Goal

Close the second in-scope page with the same primitive.

### Tasks

- [ ] `ExpensesWorkspacePanels.tsx:441-442` — `dateField` → `useMenuFilterState('expenses.evidence.dateField', () => 'uploadedAt')`, `yearMonth` → `useMenuFilterState('expenses.evidence.yearMonth', () => '')`.
- [ ] Verify the tab buttons at `:587-588`, which call `setDateField(...)` and `setYearMonth('')` together, still clear the folder correctly — the empty string must be stored, not treated as absent (see Phase 1 sentinel note).

### Tests

- [ ] Manual: pick a month folder → open an expense → กลับ → the folder is still selected.
- [ ] Manual: switch วันที่ส่งเข้า / วันที่เอกสาร → folder resets to ทั้งหมด, as today.

### Exit Criteria

Evidence panel matches spec §14.

## Phase 4: G1 — local-date defaults

### Goal

A default date is the user's date. No screen shows or saves yesterday because the clock has not reached 07:00 Bangkok.

### Tasks

- [ ] **`src/common/functions/today.ts`** — new, two exports, clock injectable so the spec needs no fake timers:
  - `todayIso(now = new Date())` — `${y}-${mm}-${dd}` from `getFullYear`/`getMonth`/`getDate`, zero-padded.
  - `currentMonthIso(now = new Date())` — `todayIso(now).slice(0, 7)`.
  - Header comment stating the position and pointing at `bookings.model.ts:1-5`: browser-local is the intended reading for a Thailand-only userbase, and `toISOString()` is the bug this module exists to prevent.
- [ ] Replace every **date/month default** listed in spec §9A across ~13 files. In `ExpensesPages.tsx` this means the private `todayIso`/`thisMonth` at `:67-68` are deleted and re-imported from the shared module, which closes G8 for that file.
- [ ] **Do not touch** genuine instants: `LedgerReportsPage.tsx:112`, `AccountingPages.tsx:600`. Both want a UTC timestamp and are correct.
- [ ] Sweep afterwards: `grep -rn "new Date()\.toISOString()\.slice" apps/web/src` must return nothing.

### Tests

- [ ] `today.spec.ts` — the four cases in spec §15, including the `2026-09-01T02:00:00+07:00` → `2026-09` regression that pins the bug.
- [ ] `pnpm --filter web test && pnpm --filter web typecheck`

### Exit Criteria

The sweep is clean, the regression test fails against the old implementation and passes against the new one, and no instant-valued call site changed.

## Phase 5: G3 + G5 — reload anchors and the unthemed picker

### Goal

Two small, verified-safe defects closed while the surrounding code is already open.

### Tasks

- [ ] `ReimbursementsPages.tsx:637`, `:1063`, `:1261` — `<a href={...}>` → `<Link href={...}>`, adding the `next/link` import. Keep every attribute as-is: `:637` is a full-card overlay (`className="absolute inset-0 z-10 …"`) carrying `aria-label` and `data-testid`, and `:1063`/`:1261` carry `data-testid` the E2E suite selects on. Nothing but the element name changes.
- [ ] `TaxReconciliationPage.tsx:84` — raw `<input type="month">` → `<ThemedDate mode="month" …>`, matching `ExpensesPages.tsx:1325`.

### Why G3 is safe

The drawer is opened from the URL, reactively: `useSearchParams()` (`:228`) → `focusId` (`:234`) → `useEffect(… openDetail(focusId), [focusId, openDetail])` (`:258`). A client-side navigation updates `useSearchParams`, so the effect fires exactly as it does after a reload. The reload was never load-bearing.

### Tests

- [ ] `pnpm exec playwright test e2e/reimbursements.spec.ts` — the existing suite already drives `reimbursements-mine-card`, `reimbursements-approvals-card`, and `reimbursements-finance-card`, so it covers this directly.
- [ ] Manual: open a เบิกจ่าย deep link (`?tab=mine&focus=<id>`) in a fresh tab — the drawer still opens on first load.

### Exit Criteria

All three surfaces open the drawer with no full reload; deep-link entry unchanged; tax reconciliation picker themed.

## Phase 5b: G9 — a date range that hid every row carrying a time

### Goal

A day view of today shows the receipts captured today, including the ones that arrived by LINE.

### Tasks

- [x] `prisma-expense.repository.ts` — add `exclusiveEndOfDay(value)`: next UTC midnight, built from `value.slice(0, 10)` so a caller passing a full ISO string cannot stretch the range.
- [x] Swap both inclusive bounds on the list where-clause to `lt: exclusiveEndOfDay(...)` — `toDate` (`expenseDate`) and `uploadedToDate` (`uploadedAt`). Matches the shape `buildSharedEvidenceWhere` already used in the same file.
- [x] Fixed on the **read** side only. Normalising writes would need a migration over historical accounting dates; the read fix repairs stored rows for free.

### Tests

- [x] `e2e/expenses.spec.ts` EXP-24 — `createExpense` posts a full ISO timestamp, so a `fromDate=toDate=today` query reproduces the bug exactly. **Verified failing against the old bound and passing against the new one.**

### Exit Criteria

EXP-24 red before, green after. Met.

## Phase 5c: G10 — server-side date defaults

### Goal

The server agrees with the user about what day it is, and a date column holds a date.

### Tasks

- [x] `common/date/business-date.logic.ts` — `businessToday()` (Bangkok `YYYY-MM-DD`, clock injectable) and `businessDateOnly()` (keeps only the date part of whatever a caller sends). Names the idiom the repo already used inline in `process-line-webhook.use-case.ts` and `company-ai-usage-meter.ts`.
- [x] LINE capture: `process-line-webhook.use-case.ts:1674` (photo) and `expense-document.use-case.ts:76` (text note) — the reported paths.
- [x] Write boundaries so no caller can reintroduce it: `expense-upload.use-case.ts`, `expense-draft.use-case.ts` (create + update), `expense.controller.ts`.
- [x] Remaining server-side calendar-date defaults: tax `effectiveFrom`, notification and report `periodKey`, report filename, reconciliation session number.
- [x] Genuine instants left alone — `uploadedAt`, `paidAt`, `occurredAt`, audit and outbox timestamps.
- [x] Sweep: `grep -rn "new Date()\.toISOString()\.slice(0, 10)" apps/api/src apps/ai-gateway/src apps/workers/src` returns only the doc comment.

### Tests

- [x] `expense-upload.use-case.spec.ts` (+4) — the Bangkok boundary and the date-only strip. Placed in that file, not beside the helper, because `apps/api` runs an explicit spec list in `package.json` that AGENTS.md keeps out of unrelated diffs; this file is already listed and is the helper's main consumer.
- [x] `e2e/expenses.spec.ts` EXP-25 — posting a full ISO instant must still store a date. **Verified red before the fix, green after.**
- [x] 232 API specs across every touched module pass.

### Exit Criteria

Sweep clean, EXP-25 red→green, no instant-valued site changed. Met.

## Phase 6 (optional, deferred): remaining period-filter pages

Journal (`LedgerReportsPage.tsx:53`), tax reconciliation (`TaxReconciliationPage.tsx:32`), reports (`ReportsWorkspacePage.tsx:50`), CRM reports (`CrmReportsPrototypePage.tsx:81`), bookings (`BookingsPrototypePage.tsx:148-149`).

None has a row → detail route today (spec §8.2), so none is broken. Each is a one-line adoption if a detail route is ever added. **Do not do this speculatively** — it is six edits with no observable user benefit today.

## Integration Verification

- **Backend/API contract:** unchanged. `listExpenses(companyId, { branchId?, fromDate, toDate, pageSize })` is called with the same shape from the same place (`ExpensesPages.tsx:1234`); only the source of `fromDate`/`toDate` changes.
- **Web journey:** spec §6, steps 1–7.
- **Loading/error/permission states:** unchanged by construction — a restored value enters through the existing `load` `useCallback`/`useEffect` chain, so a restored month with no rows shows the ordinary empty state and a restored filter is still branch-scoped and permission-checked on the server.
- **E2E:** extend `e2e/expenses.spec.ts` with the four §2 behaviours. This is the only layer where the mechanism is observable, since it depends on real route transitions.
- **Commands:**

```bash
pnpm --filter web test && pnpm --filter web typecheck
```

```bash
pnpm exec playwright test e2e/expenses.spec.ts e2e/reimbursements.spec.ts
```

```bash
grep -rn "new Date()\.toISOString()\.slice" apps/web/src
```

## Risks

| Risk | Mitigation |
| --- | --- |
| Render-time ref mutation is unfamiliar and may be "cleaned up" later into an effect, reintroducing a one-frame flash | Comment at the mutation explaining why an effect is too late (Phase 1 design note) |
| A future reader finds the unused `list-query.ts` URL helpers (G4) and rebuilds this on search params, breaking the refresh-resets rule | Spec §5 states the rejection with the elimination table; consider deleting the dead helper or pointing it here |
| Menu resolution silently misclassifies if `navItems` shape changes | Unit test pins the whitelisted-out case (G6); resolution reuses `isUnderHref` rather than a parallel matcher |
| Retained `query` surprises a user who expects a fresh search box | Accepted — it is the same round trip and the same expectation as the month. Reversible by dropping one line if UAT disagrees |
| Storing a value that is not presentation state | Spec §7 rule 4 bounds what may be stored; all eight retained values are user-pickable filters |
| **G1 touches ~20 sites in 13 files** — a wide diff where a wrong edit silently changes a saved accounting date | Each edit is a like-for-like substitution of the same shape; the instant-valued sites are enumerated in spec §9A and explicitly excluded; a `grep` sweep proves completeness; the helper carries a regression test that fails against the old behaviour |
| G1 changes dates written to records, so a mistake is not display-only | The change moves a default from UTC to browser-local. It cannot produce an invalid date, and every affected field remains user-editable before save |
| G3 converts anchors the E2E suite selects on | `data-testid` and `aria-label` are preserved verbatim; `e2e/reimbursements.spec.ts` is run as part of verification |

## Open Questions

None. Spec §16 records the decisions taken on 2026-08-06: sibling tab resets; non-date list state included; **G1/G3/G5 fixed here** (reversing the earlier deferral); G9 deferred pending a data check.
