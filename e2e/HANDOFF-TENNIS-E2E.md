# Handoff — ACE Tennis Pro Shop E2E suite (247 cases, 10 roles)

**Role split.** The harness (auth, fixtures, access matrix, runner landmines) is built and
**proven green** by the harness engineer. You (Codex CLI) are the executor: turn the
catalogue into Playwright specs, run them, triage, report. Extend the harness — do not
redesign it.

**Catalogue (the spec you implement):**
[`docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md`](../docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md)
— 247 cases across 21 groups + 8 end-to-end flows (66 steps). Same content as the
`.xlsx` next to it; read the markdown, it is the source.

**Read first, in this order:** this file → the catalogue → [`_roles-reference.spec.ts`](./_roles-reference.spec.ts)
(the pattern to copy) → the original [`HANDOFF.md`](./HANDOFF.md) §2 (principles) and §3
(environment) which still apply.

---

## 1. Definition of done

- Every **P0** (108 cases) implemented and green.
- Every **P1** (103 cases) implemented and green, or explicitly quarantined with a reason.
- **P2** (36 cases) implemented as far as the stop condition allows; anything skipped is named in the report.
- All 8 E2E flows green end to end (a flow is one test; a half-passing flow is a failure).
- `e2e/RESULTS-TENNIS.md` written in the format of §8.
- Every failure classified **rig / env / product**, with a trace path. Product failures filed as `BUG-n` per §9.

**Do not loosen an assertion to make a product bug pass.** If the app disagrees with the
catalogue, one of them is wrong — say which, with evidence.

---

## 2. What is already built (import it, don't rewrite it)

### `harness/roles.ts` — multi-role auth + the access matrix
The old harness could only sign in as OWNER (`/api/auth/dev-login` hands out an owner-bound
dev token). This catalogue is 90% "who may see what", so real credentialed login was added:

```ts
import { loginAs, getRoleToken, ALL_ROLES, MENUS, SUB_MENUS, href,
         expectSidebarMatchesRole, expectSubMenuMatchesRole, expectRouteAccess } from './harness/roles';
```

`MENUS` / `SUB_MENUS` carry a `visibleTo: RoleKey[]` derived from
`apps/api/src/modules/auth/permission-registry.ts` (`ROLE_GRANTS`) crossed with
`apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts`
(`WORKSPACE_MODULES.requiredAnyPermissions`) — **not** from reading the UI. This table is the
single source of truth for §4 of the catalogue and for PERM-01/02. If a test disagrees with
it, find out whether the table, the app, or the catalogue is wrong before touching anything.

### `harness/fixtures.ts` — two new fixtures

```ts
test('finance certifies, owner approves', async ({ pageAs, apiAs, companyId }) => {
  const finance = await pageAs('FINANCE');   // own browser context, real cookie session
  const owner   = await pageAs('OWNER');     // a second one, simultaneously
  const api     = await apiAs('ACCOUNTANT'); // bearer + X-Company-Id for backend truth
});
```

Each `pageAs` call builds a **fresh browser context**. That is deliberate: the auth cookie is
chunked across one cookie name, so two roles in one context overwrite each other. Segregation-
of-duties cases (EXP-SR-05/06, F05) need two roles alive at once — this is how.

`authedPage` / `api` (seeded OWNER) still exist and still work; use them where role does not matter.

### `_roles-reference.spec.ts` — the rig proof
7 tests, **green at handoff**: all 10 roles get an API token, all 10 open a browser session,
the sidebar matches the matrix for OWNER/SALES/STAFF, the expenses sub-menu matches for
FINANCE/MARKETING, and a denied route bounces. **Run this first.** If it is red, the
environment is broken — fix §3, not the tests.

---

## 3. Environment contract

### Verified-good state at handoff (2026-07-29)
| Service | Port | State |
|---|---|---|
| Postgres (migrated to head + seeded) | 5432 | UP — 95 migrations applied, 11 QA accounts present |
| API (NestJS) | 3021 | booted by Playwright `webServer` |
| Web (Next.js) | 3020 | booted by Playwright `webServer` |
| Redis | 6379 | DOWN (optional) |
| MinIO / S3 | 19000 | UP on this machine (`run-local.sh` auto-detects) |

### One-command run
```bash
API_PORT=3021 WEB_PORT=3020 NEXT_DIST_DIR=.next/e2e-3020 e2e/run-local.sh e2e/_roles-reference.spec.ts
API_PORT=3021 WEB_PORT=3020 NEXT_DIST_DIR=.next/e2e-3020 e2e/run-local.sh e2e/tennis/
```

### ⚠️ Landmines — four of these were live at handoff and cost a full red run

1. **Ports 3000/3001 are an SSH tunnel on this machine, not the local stack.**
   `lsof -nP -iTCP:3000 -sTCP:LISTEN` shows `ssh`. With `reuseExistingServer: !CI`,
   Playwright would happily run the whole suite against **whatever is on the far end of that
   tunnel** and report green. Always pass `API_PORT=3021 WEB_PORT=3020`. Re-check the tunnel
   before every session; if it is gone, the default ports are fine again.

2. **`run-local.sh`'s seed check is presence-based, not content-based.** It re-seeds only when
   `seed-local-company` is missing. The QA role accounts (`qa.owner` … `qa.staff`) were added to
   the seed *after* this database was last seeded, so the row existed and the accounts did not —
   every login returned 500. The preflight now checks for `qa.owner` too, but if you ever see
   auth 500s, re-seed explicitly:
   ```bash
   cd apps/api && DATABASE_URL="postgresql://watchdog:watchdog_local_password@localhost:5432/watchdog_bms?schema=public" \
     corepack pnpm exec tsx prisma/seed.ts
   ```

3. **A stale schema looks exactly like an auth bug.** The DB was 18 migrations behind the
   branch; `POST /auth/password/login` returned `500 Internal server error` and the seed died
   with `P2022 ColumnNotFound`. Fixed at handoff with, in this order:
   ```bash
   cd apps/api
   corepack pnpm exec prisma migrate deploy   # apply pending migrations
   corepack pnpm exec prisma generate         # the client was stale too (Unknown argument …)
   corepack pnpm exec tsx prisma/seed.ts
   ```
   `prisma migrate status` is the one-line check. Do this before blaming the harness.

4. **`NEXT_DIST_DIR` dirties a tracked file.** `next dev` rewrites `apps/web/next-env.d.ts` to
   point at whatever distDir it is given. Restore it when you finish a session:
   ```bash
   git checkout -- apps/web/next-env.d.ts
   ```

Still true from the original handoff: default locale is **Thai** (assert `th|en`); a "planned"
nav badge does **not** mean a dead route; never `source .env` (it points at a dead docker port).

---

## 4. Rules of engagement specific to this catalogue

These are the things that will make you write a wrong-but-green test. Read them twice.

### 4.1 A denied route is a redirect, not a 403
`WorkspaceLayout` calls `router.replace('/companies/:id/dashboard')` and renders `null`.
So "must be blocked" means **the URL ends up on the dashboard**, and the guarded content was
never painted. `expectRouteAccess()` already encodes this.

### 4.2 Sub-pages are gated at the *module* level, not per tab
`canAccessWorkspacePath` matches the longest module href. `/expenses/upload` matches the
`expenses` module, whose gate is the **union** of all expense permissions. So a MANAGER
(who has `expense.read` but not `expense.receipt.upload`) is **not** redirected away from
`/expenses/upload` — the page itself refuses via `canAccessExpenseTab`.

`SUB_MENUS[].routeGuard` tells you which is which:
- `'own'` → the route has its own rule; assert a redirect (`expectRouteAccess`).
- `'parent'` → the route loads; assert **the page's in-UI refusal** and that no data is shown. Never assert a redirect.

Cases affected: EXP-UP-09, EXP-MN-10, EXP-CAT-06, EXP-SIG-07, EXP-EV-06.

### 4.3 The sidebar contains more menus than the catalogue covers
`inbox`, `customers`, `crmreport`, `reimbursements`, `tax` also render. Assert **per menu**
(present / absent), never set-equality against the whole nav. `expectSidebarMatchesRole` does this.

### 4.4 All QA accounts are `ALL_BRANCHES` — branch-scope cases need setup
The seed gives every `qa.*` account `branchScopeMode: 'ALL_BRANCHES'`. Cases that assert a
narrowed scope (**DSH-06, BKG-13, FRP-11, BRN-08, BRN-09**) are meaningless until you narrow it.
Do it in the test's own setup as OWNER, then restore in teardown:
```
PATCH /companies/:companyId/settings/employees/:employeeId
  { branchScopeMode: 'SELECTED_BRANCHES', branchIds: [...] }
```
If you cannot resolve the employeeId for a QA account, quarantine those five with that reason —
do not silently assert against ALL_BRANCHES and call it green.

### 4.5 Expected behaviours that look like bugs — do not "fix" them
| Observation | Status |
|---|---|
| ADMIN cannot open `/sales-documents` or `/journal` | **Correct.** `ADMIN` has neither `accounting.document.read` nor `ledger.journal.read`. PERM-03 asserts it deliberately. |
| `/period-closing` shows only "เร็วๆ นี้" | **Correct.** It is `PlannedModulePage`. CLS-01/02/03/04 assert the placeholder. Real closing (`ledger.period.close`, CLS-05/06/07) is ACCOUNTANT-only through the ledger API. |
| The expenses sub-menu has 7 children, the catalogue's §1.2 lists 6 | **Correct.** `ลายเซ็นบริษัท` is the 7th; EXP-SIG covers it. |
| FINANCE can create a journal entry but not post it | **Correct.** `journal.entry.create` without `.post`. JRN-03/04. |
| The payer cannot approve their own substitute receipt | **Correct.** Segregation of duties. EXP-SR-05. |

### 4.6 Data
The catalogue's tennis dataset (§3) is the **shape** to create, not seeded rows — the seed ships
a Room45 eyelash-salon demo. Create what a test needs with a unique suffix
(`E2E-${test.info().title}-${Date.now()}`) and prefer disposable records over editing seed rows.
Where a case only needs "some product exists", use the seeded one rather than inventing setup.

### 4.7 Prove backend truth
Every write case asserts the UI **and** re-reads through `apiAs(role)`. A green UI over a broken
contract is the failure mode this whole suite exists to catch.

---

## 5. Suite → spec file map

Put everything under `e2e/tennis/` so the new suite stays separate from the legacy specs
(`e2e/expenses.spec.ts` etc. already exist and must keep passing).

| Catalogue group | Cases | Spec file |
|---|---|---|
| DSH — แดชบอร์ด | 9 | `e2e/tennis/dashboard.spec.ts` |
| BKG — การจองออนไลน์ | 18 | `e2e/tennis/bookings.spec.ts` |
| SDC — เอกสารขายและรับชำระ | 17 | `e2e/tennis/sales-documents.spec.ts` |
| PSV — สินค้าและบริการ | 14 | `e2e/tennis/products-services.spec.ts` |
| EXP-L / UP / MN / CAT / SIG / SR / EV | 73 | `e2e/tennis/expenses-*.spec.ts` (one per sub-menu) |
| JRN — สมุดรายวัน | 13 | `e2e/tennis/journal.spec.ts` |
| FRP — รายงานการเงิน | 14 | `e2e/tennis/reports.spec.ts` |
| CLS — ปิดงวด | 8 | `e2e/tennis/period-closing.spec.ts` |
| EMP-OV / LS / LN / ROLE | 47 | `e2e/tennis/employees-*.spec.ts` |
| BRN — สาขา | 12 | `e2e/tennis/branches.spec.ts` |
| PERM — สิทธิ์ข้ามเมนู | 12 | `e2e/tennis/permissions.spec.ts` |
| EDGE — ขอบเขต | 10 | `e2e/tennis/edge.spec.ts` |
| F01–F08 — E2E flows | 8 tests | `e2e/tennis/flows.spec.ts` |

Conventions: one `test.describe` per group; test title starts with the case ID
(`test('BKG-04 duplicate customer is offered for merge @p0', …)`); tag `@p0` / `@p1` / `@p2`
matching **Pri** so `--grep @p0` works.

---

## 6. Order of work

1. `_roles-reference.spec.ts` green. **Stop if not.**
2. `permissions.spec.ts` (PERM-01/02) — 12 cases that exercise the matrix across all 10 roles.
   This is the highest-value, cheapest suite and it validates the harness against the whole app.
3. All remaining **P0**, group by group, running each suite as you finish it.
4. The 8 flows (they depend on most P0 behaviour already working).
5. **P1**, then **P2**.
6. Full run, then write the report.

---

## 7. Quarantine policy

`test.fixme()` with a one-line reason **and** the blocking dependency. Never delete, never
silently skip, never weaken. Expected quarantine candidates:
- Receipt/file upload cases if MinIO goes down (EXP-UP-*).
- LINE OA webhook cases needing a real channel (EMP-LN-03/04, F01 step 1, F02 step 1) —
  drive them through the API's inbound-message path instead where possible.
- Branch-scope cases per §4.4 if you cannot resolve QA employee ids.

---

## 8. Report format — write to `e2e/RESULTS-TENNIS.md`

```md
## Tennis E2E Run <ISO timestamp> — <git sha>
Environment: web :3020 / api :3021 / db :5432 (migrated+seeded) / redis <up|down> / minio <up|down>
Command: API_PORT=3021 WEB_PORT=3020 NEXT_DIST_DIR=.next/e2e-3020 e2e/run-local.sh e2e/tennis/
Result: <n> passed, <n> failed, <n> quarantined, <n> not implemented
        (P0 <x>/108, P1 <x>/103, P2 <x>/36, flows <x>/8)

### Failures
- <CASE-ID> — <one line> — classification: rig|env|product — trace: test-results/<path>

### Quarantined
- <CASE-ID> — <reason> — blocking dependency: <what>

### Not implemented
- <CASE-IDs> — <why / which stop condition>

### Bugs filed
- BUG-n — <CASE-ID> <title> — <endpoint or screen> — expected <x>, got <y>

### Matrix verdict
PERM-01: <n>/100 role×menu cells matched harness/roles.ts. Mismatches: <list or none>
```

The **Matrix verdict** line is mandatory — it is the single number that says whether the
permission model behaves as designed.

---

## 9. Bug filing

A product bug gets: the case ID, the exact request/response or screenshot, the expected
behaviour **with its source** (catalogue section, or the permission key in `ROLE_GRANTS`), and a
trace path. Do not fix product code yourself — file it, quarantine the case if it blocks
others, and keep going. The harness engineer reviews and fixes.

Format:
```
BUG-n — <CASE-ID> <short title>
  Where:    <route / endpoint / file>
  Expected: <behaviour> (source: <catalogue §x | ROLE_GRANTS.<ROLE>.<permission>>)
  Actual:   <behaviour>
  Repro:    <command + steps>
  Trace:    test-results/<path>/trace.zip
```
