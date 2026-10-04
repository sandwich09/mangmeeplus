# Agent Memory: executive-design-v2-2026-10-04

Status: Implementation and local verification complete; uncommitted diff for controller review. Browser acceptance not checked (lane prohibits browser/server/network).
Owner: Codex implementation lane; controller reviews, runs integration/browser verification and commits.
Scope: Web presentation on all executive report views, company directory/detail, export and executive account list/create/detail; shared Thai words and UI layout spec. No API, schema, migration, dependency, package.json, cloud or environment feature-switch changes.
Decisions:
- Reuse MangmeePage/Card/StatCard, Button, SelectField, existing icon family and brand/gold tokens. Shared report/account styling is scoped; other dashboards keep their density.
- Native auto popover owns dismiss/focus restoration. Staged global filters apply together; mobile bottom sheet has safe-area padding, desktop panel anchors to the button. Existing URL/history helpers preserve month, reset page and update drilled filters. Chips reflect effective query values, not dormant saved globals; global picks are not repeated below the chips.
- Portaled themed select/date menus attach to their native popover/dialog ancestor when present, otherwise to body, so they stay in the same top layer. This shared placement change needs real browser verification.
- Donut geometry uses returned segment counts/population, not rounded shares. Legend keeps returned percentages and rounding/coverage reasons. All four statuses remain, including hatched unknown and neutral no-entitlement; segment and legend clicks use the same drill filters.
- Follow-up groups are chosen once from NOT_STARTED/INACTIVE. The band uses only positive counts; no new cohort/score, and unknown companies are never assigned to these groups.
- One responsive semantic table, eight explicit columns, one checkbox per company and a stretched row link. Existing origin, status, active-user, document and assistant content remains secondary text. Figures still use the existing coverage/qualifier helpers.
- ExecutiveCompanyRow has no detailed business type, last expense-receipt date, receipt-addition days or rolling 7/30-day counts. Use industryGroup and lastActivityAt with their truthful existing labels. Active days remains all system use. Do not derive receipt buckets from one paginated list or add estimates.

Open questions:
- Next API lane: will the directory expose detailed business type, last expense-receipt date, receipt-addition days and rolling 7/30-day counts? Existing contracts expose none of these distinctions.
- Receipt-distribution 0 / 1–5 / 6+ chart cannot be built for the whole population from this API response. Requires a complete aggregate from the next API lane.
- Browser/1280px/390px visual QA, overview first-fold criterion, keyboard/zoom/dark-mode checks and E2E are not checked: this lane prohibits browser and servers. Controller must confirm native-popover nested menus, dismiss/focus restoration and the row link versus comparison checkbox.

Artifacts:
- UI layout amendments: docs/specs/mangmee-executive-business-ui-spec-th.md (§4, §5, §6, §11.2 and design v2 amendment).
- Shared presentation: ExecutiveReportDesign.tsx; shared Thai additions in packages/contracts/src/executive-report-words.ts; filter/megaphone additions in the existing design icon family.
- ExecutiveFilters.tsx; ExecutiveReportPage.tsx; ExecutiveReportContent.tsx; ExecutiveExportPanel.tsx; executive account list/detail/create pages; PopoverPanel.tsx.
- Regression coverage: executive-design-v2.spec.ts (9 tests), ExecutiveReportContent.spec.ts (1 changed test), ExecutiveReports.wiring.spec.ts (2 changed tests), executive-presentation.spec.ts (3 changed tests).
- e2e/executive-report.spec.ts: semantic KPI selector, new size expectation and filter panel/apply journey. Not run here.

Per-screen review (source/rendered markup only; both viewport sizes not checked):
| Screen | Change | Controller check |
|---|---|---|
| Overview | Icon KPIs, notes inside tiles, green/gold donut beside follow-ups, positive-count follow-up band | First fold, long/partial figures, four legend states, drill counts |
| Usage: adoption / ranking | Donut, icon paid-usage tiles, gold attention tiles; ranking metric and all-ranks action in header | Tile wrapping, rank/tie text, selected metric and row targets |
| Revenue: summary / top | Icon money KPIs, purchase table in section card, shared chart/table styling, top-payer icons | Signed baseline, labels/gaps/partial figures and payer boundaries |
| Customers: industry / discovery / both sellers | Shared green-bar headings, sticky numeric headers and existing horizontal tracks | Long labels, counts/percentages, credited-sales notes |
| Compare | Shared controls/result cards, outlined selected navigation | Two sides, null values, differences and group/company links |
| Companies | Eight sticky columns; same two-column mobile rows; full-row link with separate checkbox | 768 breakpoint, all fields, no overflow, checkbox isolation and paging |
| Company detail: company / usage / history | Shared tabs/cards and icon KPIs; existing source/contact/history states retained | Three tabs, contacts denied, month-before-signup and paging |
| Export | Section header/back action, brand sheet tiles, contact target styling | Action in first fold, state/permission/expiry handling |
| Admin accounts: list / create / detail | Shared page/card headers, sticky list header, outlined search, desktop form layout, account commands in card header | Create rights off, credential handoff, suspend/reset reasons and responsive states |

Verification:
Commands below use `W = pnpm --filter @watchdog-bms/web exec node --import tsx --test` and report specs live under `src/features/executive-reports/`.
The heavy wrapper is `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh`.
- Contracts build: `pnpm --filter @watchdog-bms/contracts build`, twice, exit 0 both (no test count).
- Test-first initial v2 run: W executive-design-v2.spec.ts, exit 1, 0 passed / 7 failed. During implementation the same file produced 5 passed / 2 failed (exit 1): corrected test coverage fixture that accidentally supplied `value: 0` as source coverage and invalid industry fixture `FOOD`. Final isolated v2 run: exit 0, 9 passed / 0 failed.
- Existing content/presentation/wiring focused run, twice before expectation updates: exit 1, 43 passed / 5 failed (stale structure assertions and incomplete lifetime fixture).
- W executive-reports.logic.spec.ts executive-export.logic.spec.ts plus src/features/executive-users/executive-users.logic.spec.ts and executive-users.qa.spec.ts: exit 0, 54 passed / 0 failed.
- W executive-design-v2.spec.ts ExecutiveReportContent.spec.ts executive-presentation.spec.ts ExecutiveReports.wiring.spec.ts: green twice, exit 0, 57 passed / 0 failed.
- Red proof with final regression expectations: temporarily wrote HEAD production content/page/export/admin/icons/PopoverPanel bytes and removed the two newly introduced production components; all current bytes restored in finally. The four-file command exited 1, 42 passed / 15 failed. All 9 new and 6 changed tests failed on the original presentation. No git mutation commands used. Full suite on restored implementation confirms all 57 green.
- Locked web typecheck: `heavy.sh pnpm --filter @watchdog-bms/web typecheck`, three runs, exit 0 each (no test count).
- Locked full web suite: `heavy.sh pnpm --filter @watchdog-bms/web exec node --import tsx --test "src/**/*.spec.ts"`, both runs with every S3_* environment variable removed by the invoking Python process. First: exit 1, 2,986 passed / 1 failed / 0 skipped; INV-9 caught missing mobile safe-area padding in the new sheet. Added explicit safe-area padding; W src/common/styles/safe-area.spec.ts src/features/executive-reports/executive-design-v2.spec.ts: exit 0, 10 passed / 0 failed. Final full suite: exit 0, 2,987 passed / 0 failed / 0 skipped (573 suites).
- Old filter text scan: `rg -l --glob '*spec.*' 'ตัวกรองรายงาน|ตัวกรองรายงาน ·|ตัวกรองรายงาน.*0' apps/api apps/ai-gateway apps/web e2e`, exit 0, only wiring spec (run) and executive E2E (not checked) matched. Existing words remain in the panel; trigger now uses shared W.filters.
- `git diff --check`: exit 0; final check repeated after this note.
- No sandbox-refused commands, no network/docker/browser/server attempts. Real PostgreSQL not checked: no API change and controller owns those checks.

Next:
Controller: review the uncommitted diff; run `pnpm exec playwright test e2e/executive-report.spec.ts` with its required worker/database/server setup; check every screen/subview at 1280 and 390 px, including safe area, popover option interaction, focus/keyboard, overflow and long/partial/empty/denied/stale cases. Resolve missing API fields in the next lane; commit only after acceptance.
