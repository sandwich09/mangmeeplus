# Agent Memory: tennis-shop-e2e-suite

Status: Harness built and proven green. Handoff written. Awaiting Codex execution + RESULTS-TENNIS.md, then bug review.

Owner: harness engineer (Claude) authors harness + handoff + reviews/fixes bugs; Codex CLI executes the specs.

Scope:
- Test catalogue: `docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md` (247 cases, 8 flows, 10 roles) + `.xlsx` fill-in workbook + `build_tennis_shop_test_workbook.py` generator.
- Harness: `e2e/harness/roles.ts` (new), `e2e/harness/fixtures.ts` (pageAs/apiAs added), `e2e/_roles-reference.spec.ts` (rig proof), `e2e/run-local.sh` (preflight hardened).
- Handoff: `e2e/HANDOFF-TENNIS-E2E.md`, `e2e/CODEX-PROMPT-TENNIS.md`.

Decisions:
- Role logins use the real credentialed path (`POST {web}/api/auth/login`, `POST {api}/auth/password/login`) with the seeded `qa.*` accounts. `dev-login` is owner-bound and cannot produce a SALES/STAFF session.
- `pageAs()` opens a fresh browser context per role on purpose: auth cookies are chunked on one name, so two roles in one context overwrite each other. Segregation-of-duties cases need two roles alive at once.
- The access matrix in `harness/roles.ts` (`MENUS`/`SUB_MENUS`.visibleTo) is derived from `ROLE_GRANTS` × `WORKSPACE_MODULES.requiredAnyPermissions`, not from reading the UI. It is the single source of truth for catalogue §4 and PERM-01/02.
- New suite lives under `e2e/tennis/` so the legacy specs (`e2e/expenses.spec.ts` etc.) stay untouched and keep passing.

Open questions (carried from the catalogue §10, unchanged):
- No-show forfeited-deposit accounting rule is unspecified — blocks judging F07 step 6.
- Product variant (shoe sizes) has no data model — PSV-08 records actual behaviour rather than asserting.
- Zero-price product allowed or not — PSV-07.
- Confirm with PO that ADMIN lacking `accounting.document.read` / `ledger.journal.read` is intended (PERM-03 asserts it as correct).

Artifacts:
- `docs/qa/tennis-shop-e2e-test-cases-2026-07-29.{md,xlsx}`
- `docs/qa/build_tennis_shop_test_workbook.py`
- `e2e/harness/roles.ts`, `e2e/harness/fixtures.ts`, `e2e/_roles-reference.spec.ts`
- `e2e/HANDOFF-TENNIS-E2E.md`, `e2e/CODEX-PROMPT-TENNIS.md`, `e2e/run-local.sh`

Verification (2026-07-29, ports 3020/3021):
- `e2e/run-local.sh e2e/_roles-reference.spec.ts` → **7 passed**. All 10 QA roles obtain API tokens and browser sessions; sidebar matches the matrix for OWNER/SALES/STAFF; expenses sub-menu matches for FINANCE/MARKETING; denied route redirects.
- `e2e/run-local.sh --grep @smoke` → **35 passed** (legacy suite intact after the env repair).
- Access-matrix derivation cross-checked by script against `ROLE_GRANTS` + `WORKSPACE_MODULES`.

Environment repair performed (local dev DB was 18 migrations behind the branch; symptom was `500` on `/auth/password/login` and `P2022 ColumnNotFound` in the seed):
1. `prisma migrate deploy` (18 applied, 95 total)
2. `prisma generate` (client was stale too — `Unknown argument chartOfAccountsTemplateKey`)
3. `tsx prisma/seed.ts` (11 QA role accounts now present)
`run-local.sh` preflight now fails fast on a behind-head schema and re-seeds when `qa.*` accounts are missing, so this cannot silently recur.

Live environment landmines on this machine:
- Ports 3000/3001 are an **SSH tunnel**, not the local stack. With `reuseExistingServer` Playwright would run the whole suite against the far end and report green. Always pass `API_PORT=3021 WEB_PORT=3020 NEXT_DIST_DIR=.next/e2e-3020`.
- `NEXT_DIST_DIR` rewrites the tracked `apps/web/next-env.d.ts`; restore with `git checkout --` after each session.

Bugs found and fixed (2026-07-29, reported by the user, reproduced then fixed by the harness engineer):
- **BUG-1 sidebar accordion.** `AppSidebar`'s route-sync effect also depended on `openSubmenu` and re-asserted the active parent whenever they differed. On any page whose module has children (ค่าใช้จ่ายและใบเสร็จ, พนักงานและสิทธิ์) the user could neither collapse that parent nor open a different one — every toggle was undone on the next render. Fixed by syncing once per pathname (`syncedPathRef`), guarded against the first render where `navItems` is still empty. Regression: `e2e/sidebar-nav.spec.ts` NAV-04.
- **BUG-1b (found while fixing).** The drawer height was measured in `useEffect`, so the inline style was the invalid string `undefinedpx` for one frame on a menu's first expand — it snapped open instead of animating. Changed to `useLayoutEffect`.
- **BUG-2 role screen looked broken.** `/settings/permissions` never passed `viewerPermissions` (its sibling `access-overview` does), and `PermissionMatrixPrototypePage` inferred editability from `catalog.length > 0`. The catalog fetch is `allSettled` and needs its own `access.permission.read`, so a viewer without it got every control silently disabled and no reason shown. Fixed: page passes the session permissions; gate is now `access.role.manage` (mirrors `RoleController`); a read-only banner names the missing permission. Regression: `e2e/settings.spec.ts` SET-09.
- **DRIFT (security-relevant).** The system ADMIN role in the DB still held `access.role.manage`, `admin.role.manage`, `access.role_template.manage` — all three deliberately removed from `ROLE_GRANTS.ADMIN` on 2026-07-28 ("a default ADMIN cannot hand out permissions"). `prisma/seed.ts` does **not** reconcile system-role grants; only `prisma/sync-permissions.ts` revokes stale ones, and it had never been run here. Ran it: 4 stale grants revoked, role-management now OWNER-only. **Any environment where only the seed ran is still exposed — run `sync-permissions.ts` there.**

Not a bug (verified, do not "fix"):
- The real OWNER can manage everything (`POST settings/roles` → 201, `settings/employees` → 200). The account shown in the UI as **"เจ้าของ"** is the `COMPANY_VIEW` role, which holds `access.role.read` but no `access.role.manage` and no `access.employee.*` at all (`settings/employees` → 403). It cannot set anyone's permissions **by grant design**. Open product question below.

Decided 2026-07-29 (owner call), implemented:
- **COMPANY_VIEW renamed to "Company owner" / "เจ้าของบริษัท".** Was labelled "เจ้าของ" (th) / "Owner" (en), colliding with the real OWNER role. Changed in `SYSTEM_ROLES` (`permission-registry.ts`) and both locales of `workspace-dictionary.ts`. The role key is unchanged — renaming it would need a data migration and buys nothing.
- **ตั้งค่าบริษัท restricted to Owner / Company owner / Admin.** Its gate was the union of every card inside the hub, which included `account.password.change` and `company.branch.read` — keys every role holds — so all ten roles saw it. Added a dedicated permission **`company.settings.view`** (granted to ADMIN and COMPANY_VIEW; OWNER holds every company key) and set the module gate to `['company.settings.view', 'company.setup.manage']`.
  - Why a new key rather than reusing one: `company.setup.read` is held by Manager/Finance/Accountant (too broad); `company.setup.manage` also guards the substitute-receipt policy, so granting it to COMPANY_VIEW would hand out a write the menu never needed; `admin.role.read` happens to match the three roles today but would silently re-expose the menu the moment someone grants it elsewhere.
  - `company.setup.manage` stays in the gate so Owner/Admin keep the menu in an environment that has not run `sync-permissions.ts` yet — fails safe, not open.
  - Nobody is stranded: account security is reached from the header user menu, and Tax Code / บัญชีภาษี are linked from the tax workspace (`/tax`), not only from the hub.
  - `/settings/branches` and `/settings/security` keep their own route rules, so they remain reachable by direct URL for roles that no longer see the hub. Left deliberately (security must stay reachable); raise branches if that leak matters.
  - Regression: `e2e/_roles-reference.spec.ts` "ตั้งค่าบริษัท is Owner / Company owner / Admin only" checks all ten roles for menu + route; unit coverage in `web-core-workspace.spec.ts`.

Next:
1. Decide the COMPANY_VIEW label-vs-grants question above.
2. Run `e2e/CODEX-PROMPT-TENNIS.md` against Codex CLI.
2. Review `e2e/RESULTS-TENNIS.md`: confirm the Matrix verdict line, re-verify each product bug against `ROLE_GRANTS` before accepting it, then fix confirmed bugs and re-run the affected suite.
3. Feed confirmed defects back into the catalogue/xlsx if an expected result was wrong.
