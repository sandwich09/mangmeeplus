# Codex CLI kickoff — ACE Tennis Pro Shop E2E suite

Run from the repo root (`WatchDog-BMS`). Codex auto-reads `AGENTS.md`; this prompt points it
at the handoff and the harness.

```bash
codex "You are the E2E test executor for WatchDog-BMS. \
Read e2e/HANDOFF-TENNIS-E2E.md and docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md in full before writing any code. \
The multi-role harness is already built and green: e2e/harness/roles.ts (loginAs, getRoleToken, the access matrix, expectSidebarMatchesRole / expectSubMenuMatchesRole / expectRouteAccess) and the pageAs / apiAs fixtures in e2e/harness/fixtures.ts. Import from it, do not reinvent it. \
e2e/_roles-reference.spec.ts is the pattern to copy. \
\
Task: implement the 247 cases and 8 E2E flows from the catalogue as Playwright specs under e2e/tennis/, using the suite-to-file map in HANDOFF-TENNIS-E2E.md section 5. \
Order: rig proof, then permissions.spec.ts (PERM-01/02), then all P0, then the 8 flows, then P1, then P2. \
\
Environment (all four landmines are live on this machine — HANDOFF-TENNIS-E2E.md section 3): \
- ALWAYS pass API_PORT=3021 WEB_PORT=3020 NEXT_DIST_DIR=.next/e2e-3020. Ports 3000/3001 are an SSH tunnel; reuseExistingServer would silently run the suite against the far end of it and report green. \
- Start by running: API_PORT=3021 WEB_PORT=3020 NEXT_DIST_DIR=.next/e2e-3020 e2e/run-local.sh e2e/_roles-reference.spec.ts — this must be 7/7 green before you write anything. If red, fix the ENVIRONMENT, not the tests. \
- Never source .env. Restore apps/web/next-env.d.ts (git checkout --) when you finish. \
\
Rules that will otherwise make you write wrong-but-green tests (HANDOFF section 4): \
- A denied route is a REDIRECT to the dashboard, not a 403. \
- Sub-pages inherit the parent module gate. SUB_MENUS[].routeGuard tells you which: 'own' means assert a redirect, 'parent' means the page LOADS and you assert its in-UI refusal instead. Never assert a redirect for a 'parent' route. \
- The sidebar renders more menus than the catalogue covers; assert per menu, never set equality. \
- All qa.* accounts are ALL_BRANCHES, so DSH-06, BKG-13, FRP-11, BRN-08 and BRN-09 need branch scope narrowed in test setup via PATCH /companies/:companyId/settings/employees/:employeeId, or quarantined with that reason. \
- These are CORRECT behaviours, not bugs: ADMIN cannot open /sales-documents or /journal; /period-closing is a 'coming soon' placeholder; the expenses sub-menu has 7 children; FINANCE can create but not post a journal entry; the payer cannot approve their own substitute receipt. \
- Default locale is Thai: assert with th|en regexes, navigate by URL, assert by role. \
- After each goto, call expectNoClientError(page). \
- Every write case asserts the UI AND re-reads through apiAs(role) for backend truth. \
- Do not loosen a test to make a product bug pass — file it as BUG-n per HANDOFF section 9 with a trace, quarantine the case if it blocks others, and keep going. Do not fix product code yourself. \
- Quarantine with test.fixme() plus a one-line reason and the blocking dependency. Never silently skip. \
\
Run each suite as you finish it, then a full run: \
API_PORT=3021 WEB_PORT=3020 NEXT_DIST_DIR=.next/e2e-3020 e2e/run-local.sh e2e/tennis/ \
\
Finally write e2e/RESULTS-TENNIS.md in the exact format of HANDOFF-TENNIS-E2E.md section 8, including the mandatory 'Matrix verdict' line (how many of the 100 role x menu cells matched harness/roles.ts). Classify every failure as rig, env, or product with a trace path. \
Stop when P0 and P1 are green and RESULTS-TENNIS.md is written."
```

## Notes

- Add `--full-auto` / your usual approval flags; the suite only touches localhost, the local DB, and (if up) local MinIO.
- First `run-local.sh` invocation rebuilds api+web (~2 min) before the first test. Later runs reuse.
- Legacy suite must keep passing. Before you report done, run
  `API_PORT=3021 WEB_PORT=3020 NEXT_DIST_DIR=.next/e2e-3020 e2e/run-local.sh --grep @smoke`
  — it was 35/35 green at handoff.
- Credentials for all ten roles are in `e2e/harness/roles.ts` (`QA_ACCOUNTS`) and re-seeded on every seed run.
