# Agent Memory: executive-design-v2-2026-10-04

## Round B — 2026-10-04; after cc9281321

Status: Complete in the working tree; uncommitted for controller review. Controller confirmed Round A geometry; Round B browser geometry/computed fonts remain not checked (lane prohibits browser/server).
Owner: Codex implementation lane; controller reviews, commits and measures the local stack.
Scope: B c/d/e(iii–v)/f plus the four listed Round A screenshot findings. No shared-component restyling, backend, dependency or money-rule changes; C and e(i–ii) remain deferred.
Decisions: Source-specific column contexts include wrapped figures and mixed-source columns; inferred hoists union source reasons, explicit sources retain exceptional-row dots. Header/value dots sit outside the number box; phone labels carry none. Trend hoists its common source once to the title. KPI strips share longest-value/unit sizing; equal 104px tiles use one phone column, two at 1024px, three at 1280px for revenue/paid usage (overview/detail stay two). Units never wrap, labels reserve two lines and arrows have a slot. Warning words use explicit warning-700 (#b54708), calculated 5.43:1 on white. Open month heading uses existing “เดือนนี้ยังไม่จบ”; closed issues use neutral “หมายเหตุข้อมูล” with the remaining issue. Summaries are unclamped, details show native open state/chevron and a two-column definition list; unknown source ownership stays under general notes. Package badge contains only its name, abnormal state is separate small text; header rule clears the search hint. Overview top-payers row lives inside the full-width adoption card. Base counts and company-summary money keep qualifications accessible and put the dot after the unit; “จาก” is extracted once from the existing word source.
Open questions: e(i) reason relevance/subjects and e(ii) duplicate classification notes intentionally wait for backend per-source status. Actual font equality, long-number fit, two-line labels, opened mobile banner, package fit, overview page height and final dot alignment are not checked without a browser.
Artifacts: ExecutiveReportDesign.tsx, ExecutiveReportContent.tsx, contracts word source, five adjusted executive spec files, UI spec layout rules. Existing e2e data-executive-value hooks/selectors remain valid and unchanged.
Verification: Six focused node/tsx executive files (executive-browser-review, executive-compact-report, executive-design-v2, executive-presentation, ExecutiveReportContent, ExecutiveReports.wiring): final exit 0, 96 passed/0 failed/0 skipped; compact alone exit 0, 18 passed. Earlier adaptation run exit 1, 80 passed/11 failed; corrected expectations/harness and retained stale notice. Web typecheck through heavy.sh: initial exit 2 (new strip helper type), corrected final exit 0. Contracts build exit 0; warning contrast calculation exit 0 (5.43:1); git diff --check exit 0. No whole suite or restored-baseline red proof, per the lighter protocol.
Next: Controller browser-check B at 1280×800/390×844 (including September, long money and paid usage), review/commit; merged-branch suites run by controller. Await C and backend integration findings separately.

## Round A — 2026-10-04; after d3fdf06d0

Status: Complete in the working tree for controller review; final browser geometry not checked (no browser/server in this lane).
Owner: Codex implementation lane; controller reviews, commits and checks the local stack.
Scope: Round A only: compact report frame, page-scrolling tables, company columns/cards and scoped shared-field options. Rounds B/C deferred.
Decisions: Title/description/actions share a compact header; directory search/sort move there. Time controls centre vertically, empty chip rows disappear, folded banner is 40px. Tables grow with rows; headers use top 80px/z-30 above row controls z-10. Directory widths total at most 936px wide/694px narrow across seven sorts; lower-priority columns move into the closed expander, sorted column stays visible. Phone cards use three figures (four for assistant sort), with details inside the same card and icon-set chevrons. Single-page pagination was already hidden. New short words: เทียบ, สมัคร, ใบเสร็จเดือน, สุทธิ (บาท), ย่อ. Optional Field frame/hint and ThemedDate panel classes leave ordinary defaults, selected-day colour and disabled-day dimming unchanged. Executive hint uses gray-600 (#475467), calculated contrast 7.69:1 on white; actual computed colour not checked.
Open questions: No product decision needed. Actual y≈260/380 first figures, y≈330 first company row, 120px phone-card height, Thai font/header fit and sticky behaviour are not checked without a browser; controller must measure at 1280/1024/768/390px.
Artifacts: ExecutiveReportDesign/Content/Page/Filters; Field.tsx and ThemedDate.tsx opt-in props; contracts word source; four executive specs; UI spec §11.1/§11.2 and Round A frame rule. Neutral e2e hooks and detail button accessible name remain unchanged.
Verification: Focused node/tsx run of executive-browser-review, executive-compact-report, executive-design-v2, executive-presentation, ExecutiveReportContent and ExecutiveReports.wiring: exit 0, 91 passed/0 failed/0 skipped. Earlier expectation/harness run: exit 1, 81 passed/7 failed, corrected. Web typecheck through heavy.sh: initial exit 2 (new test child.props cast), corrected run exit 0. Contracts build exit 0. Token contrast calculation exit 0. git diff --check exit 0. No restored baseline/red proof and no whole suite, per the lighter Round A protocol.
Next: Controller browser-check Round A measurements, review/commit this uncommitted diff, run merged-branch suites under the agreed protocol; send B/C findings separately.

## Run 1 — archived; controller committed f12068bbc

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

## Run 2 — compact values and panels (2026-10-04)

Status: Implementation and local checks complete; uncommitted changes on f12068bbc. Actual viewport/browser acceptance not checked because this lane prohibits browser/server/network.
Owner: Executive presentation lane; controller reviews, verifies integration/viewport behavior and commits.
Scope: Web presentation, shared Thai words, regression/E2E selectors and UI layout spec. No backend, package.json, dependency, schema, migration or environment-switch changes.
Decisions:
- Owner's replacement brief removes every numbered reference, including chart references. ReasonNotes is extended into one context-controlled status banner, not a second notes mechanism. Full per-source explanations and money cutoff live in its closed-by-default details. Stale wording stays visible in its summary. Complete periods with only lag/informational notes use a neutral “หมายเหตุข้อมูล” heading instead of claiming incomplete figures.
- Numbers are clean; Figure retains the full qualifier/reason in its accessible name. Fixed 6 px amber dots have accessible names/title. Uniform incomplete sources hoist to the column header; intersection of reason codes leaves any additional row reason marked in the cell. Generic source reasons appear once in the banner; company-specific reasons appear in the closed row expander.
- Horizontal 96 px KPI tiles reserve a 16 px sub-line, have a 40 px round icon left, separate units and 26 px semibold digits. Long digits scale to their container instead of wrapping; this can reduce them below 26 px on a phone. Existing unlayered Mangmee CSS needs scoped important utilities/inline font size for the chosen icon shape/type/padding to take effect. Zero counts/money are muted.
- One semantic responsive table is shared by all report tables and the account list. Header units, light dividers, 48–52 px rows, explicit proportional colgroup widths, sticky name/header, right-aligned numbers and mobile two-column fields. At 1280 px the table shrinks to the real space after the 256 px system sidebar; at narrower desktop widths it scrolls internally. Long tables have a 560 px viewport. Metadata in an expanded full-width row is deliberately outside the numeric cells.
- Company list has the requested ten base columns, one status badge and one package badge. Rank is conditional on a numeric sort; cumulative share is conditional on the net sort. Their headers use the relevant source mark. Existing “ไม่นับในสัดส่วน” moves into the expander only when complete money and non-positive net actually establish exclusion; partial billing does not establish that fact (read service withholds money ranks/shares). Checkbox/chevron events stop row navigation. Metadata is closed by default. With 20 rows at the maximum intended 52 px row height, table content plus its 44 px header is about 1,084 px; rendered dimensions not checked.
- Shared underline tabs use view in the URL, arrow/Home/End navigation and roving tabIndex. Keyboard focus is restored after data reload only when focus is still on a tab or body. Old view=top/view=ranking and detail tab= links remain valid. Presentation-only revenue/usage tabs map to the existing summary/adoption endpoint payloads.
- Top revenue has no summary figures in its existing payload: web reads the existing summary using the same buildId. A changed/different build is rejected through the existing read error/retry path; never combine figures across builds.
- No new business rules or figures. Overview donut geometry still uses counts/population and returned legend percentages. Follow-up band still requires a known positive NOT_STARTED/INACTIVE count. Chart labels are clean numbers; missing months are hatched and marked unavailable. Negative net wording remains once outside numeric cells and in accessible names.

Open questions:
- Actual above-fold contents at 1280×800 and 390×844, overview one-screen height, every other page's 1.5-screen limit, long-money/column/badge overflow, phone expanded rows, zoom and keyboard/browser behavior: not checked; browser/server forbidden. No page is claimed to meet a measured height threshold.
- Height risks for controller to inspect: overview with both follow-ups and long definitions; company-list search/filter/paging; company information/contact/credit notes; top-payer boundary notes; expanded status/export details. Long names/badges may need sizing adjustments after visual inspection.
- Still awaiting next API lane: detailed business type, last expense-receipt date, receipt-addition days, rolling 7/30-day receipt counts and a complete receipt-bucket aggregate. No substitute/estimate added.

Artifacts:
- Shared primitives: apps/web/src/features/executive-reports/ExecutiveReportDesign.tsx.
- Report content/page/API query adapter/logic/words/export; executive account list; info icon in existing DesignIcons.
- Shared words: packages/contracts/src/executive-report-words.ts (built).
- UI spec: docs/specs/mangmee-executive-business-ui-spec-th.md layout/value/status/tab sections, including removal of contradictory numbered-reference paragraphs.
- New compact regression spec; updated content, wiring, presentation, design, export, logic and account QA specs; e2e/executive-report.spec.ts selectors/expander/keyboard journey.

Per-screen layout priority (source and rendered markup; actual above fold at BOTH sizes is not checked):

| Screen | 1280×800 layout priority | 390×844 layout priority | Tabs / remaining check |
|---|---|---|---|
| Overview | Header/time/status; four horizontal KPIs; 160 px donut beside compact follow-ups; positive-count green band | Header/time/status; 2×2 KPIs; donut then follow-ups/band | No tabs; one-screen criterion not checked |
| Usage | Header/time/status; underline tabs; one adoption, paid-tile or ranking panel | Same; scrolling tabs, 2-column paid tiles or compact rank cards | การเริ่มใช้ / ลูกค้าที่จ่ายแล้ว / อันดับการใช้; ranking keeps old URL |
| Revenue | Header/time/status; five KPIs, net first/emphasised; one selected table/chart/top panel | 2-column KPI strip (five tiles); scrolling tabs; selected panel/cards | ประเภทการซื้อ / แนวโน้ม 6 เดือน / เงินที่ยังไม่ผูกบริษัท / ลูกค้าที่สร้างรายรับสูง |
| Customers and origins | Header/time/status; three tabs; one shared group/seller table | Scrolling tabs; compact name/share/count cards; more reveals remaining fields | ธุรกิจ / ช่องทาง / เซลล์; existing referring/credited selector retained |
| Compare | Header/time/status/base; dimension, side A, swap, side B in one row; side actions and one result table | Controls stack; two side actions; compact metric cards | No tabs; units/difference direction in header/help, never repeated in cells |
| Companies | Header/time/status; search/sort/closed directory filters; compact all-result summary; ten columns with closed expanders | Same controls; one checkbox/name and six important fields per card, more opens the rest/metadata | Conditional rank/share; 20-row height and column fit not checked |
| Company detail | Header/time/status; four KPIs; tabs; information cards side by side or usage/money tables or history | 2×2 KPIs; scrolling tabs; information cards/compact table rows | ข้อมูลบริษัท / การใช้งานและรายรับ / ประวัติบริษัท; legacy tab links preserved |
| Export panel | Shared header/back; one status banner; creation action before folded sheet/column details | Same action order and folded details | No added mutation on open; first-fold action/browser not checked |
| Admin account list | Shared header/actions/search; same responsive table, one status badge per row | Name/username plus two-column rights/status/date | Existing permission/error/paging behavior retained |
| Admin account create/detail | Existing scoped header/cards/forms/commands with tighter shared section spacing and green title | Existing responsive form/credential handoff/commands | No new account behavior/text; first-fold and long content not checked |

Words (all controlled additions/changes come from the one contracts words source; existing reasons/definitions reused):

| Where | Old | New | Cases |
|---|---|---|---|
| Status heading | Separate reasons below each figure | ตัวเลขบางส่วนยังไม่ครบ | Selected month unfinished or any reported figure incomplete/unavailable |
| Status source labels | No compact source summary | เงิน / การใช้งาน / ต้นทุนผู้ช่วย | Only applicable incomplete sources; AI cost from its own meter |
| Money source summary | Repeated ยอดเฉพาะรายการที่ยืนยันแล้ว | นับเฉพาะรายการที่ยืนยันแล้ว | Partial receipt/payment money |
| Count summary and KPI sub-line | อย่างน้อย N in the number | นับได้อย่างน้อย | Partial counts; N stays in the value |
| Money KPI sub-line | N บาท (ยอดเฉพาะรายการที่ยืนยันแล้ว) | เฉพาะที่ยืนยันแล้ว | Partial payment money; unit separate |
| Measured cost summary/sub-line | N บาท (ยอดเฉพาะช่วงที่วัดได้) | เฉพาะช่วงที่วัดได้ | Partial meter costs only |
| Dot / legend | [n], ดูเหตุผลข้อ n | ● ยังไม่ครบ; accessible name ยังไม่ครบ — เหตุผล | Incomplete figures; header hoist or row-specific marker |
| Banner/row toggle | Numbered reason links / inline metadata | รายละเอียด | Expands status or row metadata |
| Mobile row toggle | All row details always visible | ดูเพิ่ม | Additional fields/metadata exist |
| Unavailable numeric/ratio value | — and repeated reason sentence | – | No numeric value; reasons remain in status/row details |
| Unknown paid-usage tiles | ข้อมูลการใช้งานไม่ครบ / ข้อมูลการชำระไม่ครบ | ยังประเมินการใช้งานไม่ได้ / ยังประเมินการชำระไม่ได้ | Corresponding count > 0; full reason/count detail once |
| Company header | Multiple row status badges, no status column | สถานะ | One most important returned status |
| Package header | แพ็กเกจ (ปัจจุบัน) | แพ็กเกจ | Current package; ปัจจุบัน stays in the card help/action line |
| Net KPI/headers | ยอดรับสุทธิในเดือน | ยอดรับสุทธิ | Selected period remains in time row; บาท in header/unit |
| Receipt money KPI/rows | เงินรับในเดือน | เงินรับ | Same selected-period money |
| Refund KPI/rows | คืนเงินในเดือน | คืนเงิน | Same selected-period money |
| Fees KPI/rows | ค่าธรรมเนียมการรับชำระ | ค่าธรรมเนียม | Existing fee figure, not deducted from net |
| Usage tab | Paid card stacked with adoption | ลูกค้าที่จ่ายแล้ว | Separate panel for existing paid-usage data |
| Revenue first tab | สรุปรายรับ | ประเภทการซื้อ | Same summary API data, one purchase panel |
| Revenue trend tab | Stacked แนวโน้มยอดรับสุทธิ 6 เดือน | แนวโน้ม 6 เดือน | Tab choice; full chart title retained |
| Revenue unmatched tab | Stacked เงินที่ยังไม่ผูกบริษัท | เงินที่ยังไม่ผูกบริษัท | Existing reconciliation data in two-column table |
| Difference header | ต่างกัน (ฝั่งแรกลบฝั่งที่สอง) | ต่างกัน | Full direction sentence once below comparison |
| Cumulative header | สัดส่วนสะสม sentence in money cell | สะสม % | Net sort only; backend ratio |
| Excluded share detail | ไม่นับในสัดส่วน for every absent ratio | ไม่นับในสัดส่วน in the expander | Complete money, non-positive net and no cumulative ratio only; partial money remains unknown |
| Quantity header | Mixed figures as a list | จำนวน | Unit template applied for count/money rows |
| Units/header template | Units in values | บาท; ชื่อ (หน่วย) | เงินรับ (บาท), คืนเงิน (บาท), ยอดรับสุทธิ (บาท), แนวโน้มยอดรับสุทธิ 6 เดือน (บาท), บริษัท (%), ยอดที่ใช้คำนวณสัดส่วน (%), metric (ใบ/วัน/ครั้ง), ยอดชำระครั้งแรกสะสม (บาท), จำนวน (จำนวน / บาท), จำนวน (บาท), ฝั่งแรก/ฝั่งที่สอง (จำนวน / บาท / %), ต่างกัน (จำนวน / บาท / จุด) |
| History date header | เดือนรายงาน | วันเวลา | Existing event.at timestamp; report month still in time row |
| Company secondary line | Full signup date among row details | สมัคร 2 ก.ค. 69 (date varies) | Existing joinedAt; short Buddhist date, province beside it |
| Money cutoff detail | ข้อมูลเงินถึง … | ข้อมูลเงินถึงวันที่ … | billing listed as lagging and its timestamp exists; same banner in export |
| Full reasons and definitions | Repeated inside every numeric cell/KPI | Same existing sentences, once in status details or shared help | Full coverage/unavailable/negative/tax/usage meanings retained; complete data with only lag uses existing หมายเหตุข้อมูล |

Verification:
Commands use W = `pnpm --filter @watchdog-bms/web exec node --import tsx --test`. Spec paths below are relative to apps/web. Heavy wrapper H = `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh`.
- Final contracts build: `pnpm --filter @watchdog-bms/contracts build`, exit 0. Baseline/final rebuilds in red proofs also exit 0; final bytes restored and compared equal. No test counts for compiler commands.
- Test-first: initial compact suite 0/7, exit 1 before fixes. Final baseline proof used git show HEAD production bytes (f12068bbc), rebuilt old words, then ran eight focused files; each exit 1. 47 named regression tests failed, 62 other tests passed. Restored final production in finally and rebuilt contracts, exit 0. No git mutation command used.
- Additional test-first layout checks: horizontal/overview subset exit 1, 0/3 then exit 0, 3/3; shared table proportional-width check exit 1, 0/1 then compact+logic exit 0, 35/35; ratio-dash check exit 1, 21/22 then green 22/22; raw-zero KPI check exit 1, 0/1 then compact exit 0, 13/13; numeric-zero table cell old line put back by hand exit 1, 0/1, restored then compact exit 0, 13/13; excluded-share expander assertion exit 1, 0/1, then final compact exit 0, 13/13; history date header assertion exit 1, 0/1 before label fix, then content exit 0, 20/20.
- Focused final files: compact 13/13, content 20/20, wiring 14/14, presentation 14/14, design 9/9, export 6/6, logic 22/22, account QA 11/11; each command exit 0 (109 total). Full final suite also runs these final assertions.
- `H pnpm --filter @watchdog-bms/web typecheck`: final exit 0 (route generation + TypeScript; no tests). Earlier development runs had exit 2 for types/expectations that were corrected; subsequent runs exit 0.
- `H pnpm --filter @watchdog-bms/web exec node --import tsx --test "src/**/*.spec.ts"`: all S3_* keys removed from environment by invoking Python. First run exit 1, 2,995 passed/3 failed (old account structural expectations, corrected); subsequent run exit 0, 2,999 passed/0 failed; later runs including FINAL after last code edit exit 0, 3,000 passed/0 failed/0 skipped, 573 suites.
- Old text scan: `rg -l --glob '*spec.*' --glob '*e2e*' 'ข้อมูลเงินถึง|สรุปรายรับ|ค่าธรรมเนียมการรับชำระ|เงินรับในเดือน|คืนเงินในเดือน|ยอดรับสุทธิในเดือน|แพ็กเกจ \(ปัจจุบัน\)|ต่างกัน \(ฝั่งแรกลบฝั่งที่สอง\)' apps/api apps/ai-gateway apps/web e2e`, exit 0. Matched four web files (all run) and executive-report-read.pg.spec.ts (run below); no gateway/E2E match. Additional old history-header scan `rg -l --glob '*spec.*' 'เดือนรายงาน' apps/api apps/ai-gateway apps/web e2e`: exit 1, no matches.
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/executive-business/executive-report-read.pg.spec.ts`: exit 0, 32 pure tests passed/0 failed; real-PostgreSQL suite skipped because its database URL is absent (Node test skipped count 0, one database suite explicitly SKIP). Real PostgreSQL not checked.
- `git diff --check`: one development run found a trailing blank line, corrected. Final exit 0.
- No sandbox-refused command. No network/docker/browser/server attempts. E2E not checked: prohibited here.

Named red tests and green file counts (each named test failed with production from f12068bbc and passes in the final web suite):


`W src/features/executive-reports/executive-compact-report.spec.ts`

- #1: clean values keep full accessible qualifications, dots and no reference numbers — red exit 1; green exit 0.
- #2: one status detail deduplicates reasons; cells and KPI digits never contain sentences — red exit 1; green exit 0.
- #3: hoisting requires every non-empty value incomplete for one source, never hides mixed completeness — red exit 1; green exit 0.
- #4: shared tables keep column structure fixed with dots, explicit widths, sticky names and compact mobile fields — red exit 1; green exit 0.
- #5: horizontal KPI digits and unit stay clean and reserve identical height/sub-line with or without a dot — red exit 1; green exit 0.
- #6: tabs expose keyboard navigation, URL choices and compatible legacy report views — red exit 1; green exit 0.
- #7: directory columns, closed row expanders and conditional rank/share replace the tall rows — red exit 1; green exit 0.
- #8: top revenue loads the existing summary at the same build and refuses to combine different builds — red exit 1; green exit 0.
- #9: every report panel keeps complete, partial and unavailable reasons out of cells and KPI values — red exit 1; green exit 0.
- #10: row clicks open the link; comparison and expander events never navigate and expansion starts closed — red exit 1; green exit 0.
- #11: complete selected-period data never receives an incomplete heading just because another source is late — red exit 1; green exit 0.
- #12: paid usage names the two unknown sources truthfully and keeps each sub-reason count once in the status detail — red exit 1; green exit 0.
- #13: keyboard tab focus survives a report reload without stealing focus from an input — red exit 1; green exit 0.

`W src/features/executive-reports/ExecutiveReportContent.spec.ts`

- #1: rendered partial and unavailable figures retain their reasons and negative amounts have words — red exit 1; green exit 0.
- #2: screen and workbook money qualifiers use the same facts and Thai words for every coverage and add-on sale state — red exit 1; green exit 0.
- #3: figures and receipt adoption use counted-data reasons when a number is shown — red exit 1; green exit 0.
- #4: overview renders four server metrics, a partial count, and four receipt groups with independent drill queries — red exit 1; green exit 0.
- #5: directory uses the all-result summary rather than row sums and wraps unknown usage instead of inventing zero — red exit 1; green exit 0.
- #7: group tables and comparisons preserve null averages and the backend difference — red exit 1; green exit 0.
- #8: each table names its first column for what its rows are, and differences use the Thai number format — red exit 1; green exit 0.
- #13: history shows only the event/date/plan allowlist and Buddhist dates — red exit 1; green exit 0.
- #14: small or incomplete spend groups show the reason instead of a fabricated group, while returned ties stay exact — red exit 1; green exit 0.
- #15: unavailable money never becomes zero in reconciliation; trend has a signed zero baseline and gaps — red exit 1; green exit 0.
- #17: spend groups show each group as the backend counts it: companies of all, share of the weight, and the companies at 0 or below — red exit 1; green exit 0.
- #18: the measured AI cost keeps its own coverage: what was measured is not the whole month, and a month before measuring has no figure — red exit 1; green exit 0.
- #19: company detail explains each distinct reason once with accessible dots and clean mixed-state figures — red exit 1; green exit 0.

`W src/features/executive-reports/ExecutiveReports.wiring.spec.ts`

- #8: Thai shared fields, detail tabs, history paging and responsive tables retain the permission-gated export panel — red exit 1; green exit 0.
- #13: web re-exports one shared words source including later report polish and state-aware reasons — red exit 1; green exit 0.

`W src/features/executive-reports/executive-presentation.spec.ts`

- #2: overview aligns KPIs and puts adoption and follow-ups beside each other with a header button — red exit 1; green exit 0.
- #3: drill links are focusable tiles and paid usage has large counts and company actions — red exit 1; green exit 0.
- #4: directory uses explicit receipt columns, labelled secondary summaries and one comparison checkbox per company — red exit 1; green exit 0.
- #5: revenue trend has a fixed height, bar labels, signed baseline, gaps and one explanation per reason — red exit 1; green exit 0.
- #6: money lag appears once in the status detail and not in any KPI — red exit 1; green exit 0.
- #7: ranking rows use the shared table, aligned values and sort state in its header — red exit 1; green exit 0.
- #10: top payers show the exact cohorts and shares in compact shared tables with tie links — red exit 1; green exit 0.
- #11: comparison groups controls in one card and results in another with side buttons and no repeated difference words — red exit 1; green exit 0.
- #13: export wraps in a card, folds columns and displays sheet tiles — red exit 1; green exit 0.
- #14: admin table lives in the shared section card with its filter form — red exit 1; green exit 0.

`W src/features/executive-reports/executive-design-v2.spec.ts`

- #3: v2 KPI icons and arrows stay compact while long payment context lives outside the tiles — red exit 1; green exit 0.
- #4: v2 directory exposes available fields as sticky columns and the same two-column mobile row — red exit 1; green exit 0.
- #6: v2 filter panel is a labelled responsive native popover in the time row, and views use tabs — red exit 1; green exit 0.
- #9: v2 shared design reaches every report/account view and export, without a new palette — red exit 1; green exit 0.

`W src/features/executive-reports/executive-export.logic.spec.ts`

- #6: preparation panel puts the action before column details, contacts default off, and empty/unavailable scopes explain a disabled action — red exit 1; green exit 0.

`W src/features/executive-reports/executive-reports.logic.spec.ts`

- #8: satang, negative amounts, rounded ratios and Buddhist dates have one Thai format — red exit 1; green exit 0.

`W src/features/executive-users/executive-users.qa.spec.ts`

- #2: list handles stale responses, URL filters, text-only empty results, mobile cards and shared paging — red exit 1; green exit 0.
- #3: every account status uses a distinct theme tone in mobile, desktop and detail badges — red exit 1; green exit 0.
- #8: new account components use themed controls and mobile touch targets — red exit 1; green exit 0.

Next:
Controller: review and commit the uncommitted diff only after acceptance. Run `pnpm exec playwright test e2e/executive-report.spec.ts` on the configured local stack/worker/database; check every screen/tab at 1280×800 and 390×844, including actual above fold and the 1/1.5-screen height targets, long figures, column/badge overflow, dot/header stability, row checkboxes/expansion, filter popover/sheet, keyboard focus/Back, unavailable/stale/empty/denied/export/admin states. Run real-PostgreSQL executive specs with their documented DB URL. Continue missing figures/period ranges in the next API lane.

## Browser review follow-up — round 3 (2026-10-04)

Status:
Implementation and final local checks complete on 8131c6fff; uncommitted for controller review. Focused regression proof, locked typecheck and whole web suite pass on final code/tests. Browser acceptance not checked: this lane prohibits browsers/servers/network. No second browser findings message received in this turn.
Owner:
Executive presentation web lane; controller reviews, commits and runs browsers.
Scope:
A, B1–B5 and C6–C16 from the controller's round-1 browser findings. Web feature, shared field/select/date behavior where the defect originates, system navigation, specs and E2E selectors. No contracts source change, backend change, package manifest, dependency, schema, migration or environment switch.
Decisions:
- Use own utility-only executive page/KPI markup and neutral data hooks. No Mangmee internal override remains. Shared cards, badges, fields and link buttons are used with their existing markup; field height uses an important minimum-height utility against the normal unlayered input rule. No change to globals.css.
- Incomplete words use existing warning-700 (#b54708); dots remain gold-500. Muted executive words and zeroes use gray-600. WCAG sRGB token calculations: warning-700 / white 5.43:1, warning-700 / gold-100 at 40% over white 5.20:1; gray-600 / white 7.69:1, / that amber background 7.36:1. These are calculated token ratios, not measured browser-computed styles.
- One executiveHref helper owns path/query joining for page, drill-down, menu, report/history client URLs. No feature href appends a literal ampersand. Paths passed to the helper have no existing query.
- Keep the table's own bounded overflow container as its sticky context; isolate its stacking. Retain run-2 clean figures, dots, shared table and URL tabs.
- One atomic filter panel: shared group then directory group, all applied choices (including KPI-only drill flags) have individually removable chips. Nested select toggles cannot change the enclosing panel's open state/body lock.
- Select keyboard defect exists in the shared select: trigger lacked arrow handling; portal-mounted search autofocus ran before placement. Focus after placement, use enabled options, and prevent/bubble-stop Escape for the open option list. No portal implementation change in this round.
- Report identity depends only on normalized report query; detail tabs/history paging do not re-read company figures. Independent history reads retain their own error and cached last page. Re-reads keep permitted old content, its old navigation context, and a stable dimmed/inert read overlay. Hard denied/not-found/no-data states suppress retained content immediately. Export preview requires the current query's completed response; export busy means file creation only.
- Reuse existing words. Comparison company names use the existing contract helper that preserves free names; system group labels keep the existing Thai conversion. C16 explicitly restores the admin sidebar's original LINE/AI labels.

Item audit (fixed refers to code/tests; actual browser outcome is not checked):

| Item | Status and evidence |
|---|---|
| A | Fixed: own header/KPI markup, no mangmee-stat or external Mangmee selectors; data hooks; 26 px utility owns default size, container-based utility for long figures, reserved sub-line. Contrast tests calculate existing tokens and verify dark amber/muted hooks. |
| B1 | Fixed: helper joins all executive query URLs, including empty first-visit query and encoded company IDs; regression checks exactly one question mark for all four reported links. |
| B2 | Run 2 already had bounded table scrolling. Strengthened relative/isolate/overscroll context and tested sticky headers within it. Actual header position not checked. |
| B3 | Fixed: phone panel left/right zero, bottom zero, margin zero, full width/max-width; desktop anchored 384 px with viewport cap. Classes checked; computed rectangle not checked. |
| B4 | Fixed shared select trigger arrows, enabled-option navigation, search focus after mounting, and Escape stopping at the option list. Ordinary fields still use the unchanged body portal; panel fields still portal inside the popover. Actual Chromium/WebKit focus timing not checked. |
| B5 | Fixed: one status message, stable retained-content overlay, no report reload for same-data tabs/detail history pages, history-only errors, hard permission/not-found guards, export not busy during report reads, no stale-scope export preview. |
| C6 | Fixed: one segment palette supplies ring and swatches, including grey hatch. |
| C7 | Main row/detail usage badge was already singular in run 2. Fixed duplicate payment words in the list expander when they equal the main row status; preserved a distinct payment state. |
| C8 | Fixed: combined draft filter panel/chips, including embedded directory and KPI-only choices; removed inline directory filter/duplicate badges; real Pagination buttons retained and one-page pagination hidden. First row above fold not checked. |
| C9 | Five-wide desktop grid and nowrap trend numbers already existed in run 2; added mobile snap strip. Actual long chart-label overlap not checked. |
| C10 | Fixed: side-name placeholders instead of repeated long instruction, constrained dimension control, result/side headings name the comparison, small side actions retained. Free company names preserved. |
| C11 | Fixed: own header removes double eyebrow wrapper; fields minimum 44 px, phone actions stacked; suspend last with separator. Actual rendered geometry not checked. |
| C12 | Fixed: time controls share items-center alignment; month buttons/navigation/footer minimum 44 px, readable selected/disabled month colours. Selection rules unchanged. |
| C13 | Fixed: sheet names and columns are genuine bullet lists, contact option before create, parent detail back action hidden while export open. |
| C14 | Fixed: not-found hides time row, comparison/detail controls and header actions, retained data suppressed; one state with one back action. |
| C15 | Fixed: follow-up groups appear only in the band; phone band stacks full-width links. Band's existing positive-known visibility rule retained. |
| C16 | Fixed: remove admin-label Thai transform, report navigation precedes admin groups on report pages, permission gates unchanged. |

Per-screen layout from code (1280×800 and 390×844 above-fold positions/heights: **not checked**; no browser is available):

| Screen | 1280 layout target | 390 layout target | Tabs / remaining visual verification |
|---|---|---|---|
| Overview | Own header/time/status, four horizontal KPIs, 160 px donut beside next-topic card, one follow-up band | Two-column KPI strip, stacked cards and full-width band links | No tabs; one-screen target not checked |
| Usage | Header/time/status then chosen panel, compact adoption/paid/ranking | Scrollable tabs, paid tiles two-column, ranking mobile cards | การเริ่มใช้งาน / ลูกค้าที่จ่ายแล้ว / จัดอันดับ; report re-read only when normalized view changes |
| Revenue | Net first in five-wide KPI row, then one panel | Snap KPI row, one selected panel, unbroken chart numbers | ประเภทการซื้อ / แนวโน้ม 6 เดือน / เงินที่ยังไม่ผูกบริษัท / ลูกค้าที่สร้างรายรับสูง; physical label fit not checked |
| Customers/source | Time/status, shared tabs and one compact table | Same tabs scroll; compact two-column row cards | ธุรกิจ / ช่องทาง / เซลล์; actual table width/height not checked |
| Compare | Constrained dimension + two sides/swap in one row; named result table | Stacked controls and compact result cards | No tabs; free company names retained; control/result height not checked |
| Company list | One filter button/chips, search/sort row, compact all-result summary, bounded table; row extras closed | Same filter sheet, two-column compact rows with more | No tabs; first row above fold and 20-row height not checked; rolling 7/30-day figures still unavailable in current API and not invented |
| Company detail | KPI strip and chosen panel; history reads independently | Two-column KPIs, shared scrolling tabs and compact tables | บริษัท / การใช้งาน / ประวัติ; unknown company is state alone; actual one-and-a-half-screen target not checked |
| Export | One back action, scope/notes, contact choice, create, bullet sheet list and folded bullet columns | Same order, action precedes the long columns | No tabs; actual action above fold and downloaded workbook/browser behavior not checked |
| Executive accounts list | Own title/action, aligned minimum-44px filters, shared table | Filters stack and rows use mobile cards | No tabs; actual above fold not checked |
| Executive account create | Own header/breadcrumb, two-column form and rights | Stacked minimum-44px form | No tabs; viewport height not checked |
| Executive account detail | Own header, account details, actions with suspend separated last | Full-width action stack; suspend last | No tabs; four-action positioning not checked |

Words (all controlled report words still come from the unchanged contracts word source; admin labels retain their existing source):

| Where | Old | New / placement | Cases |
|---|---|---|---|
| Compare side placeholders | เลือกสองกลุ่มที่ต้องการเปรียบเทียบ | ฝั่งแรก / ฝั่งที่สอง | Side not selected; full instruction remains once in the empty state |
| Compare result | ตัวเลข | เปรียบเทียบ · <first group/company> · <second group/company> | Comparison returned; names from contract helper/API |
| Report sidebar admin links | ตั้งค่า ไลน์; เพดานความปลอดภัยค่าปัญญาประดิษฐ์ | ตั้งค่า LINE; เพดานความปลอดภัยค่า AI | Original admin labels, authorized explicitly by C16 |
| Filter group headings | ตัวกรองรายงาน panel / ตัวกรองรายชื่อบริษัท inline | Same words for the two groups in one panel | Directory view only adds the second group |
| KPI-only drill choice | เงื่อนไขที่กดมา + badges + ล้างเงื่อนไขที่กดมา | Same choice words in a removable chip; accessible ล้างตัวกรอง <choice> | Each applied non-select drill condition; individual removal |
| Directory payment | ยังไม่เคยชำระเงิน in status and expander | Same words once when main status matches paidEver | Matching main/payment state only; distinct states retained |
| Read feedback | กำลังอ่านข้อมูล… / failure or empty words twice | Same words once in skeleton/overlay/state | Loading, error, empty, denied, not found |
| Month status | เดือนนี้ยังไม่จบ in time badge and detail | Same words only in the shared status detail | API isPartialMonth |
| Follow-up labels | Same two group words above band and inside band | Same group words only inside band | Known positive NOT_STARTED / INACTIVE only |
| Export lists/contact | Existing sheet/column/contact words | Unchanged words in bullet lists; contact before create | Existing sheet allowlist; columns for scope; contact permission only |

Artifacts:
- Updated executive design/page/content/filter/export/client logic, account pages, shared fields, system header; executive specs and E2E neutral KPI hook.
- Updated UI spec §§4, 6, 11.1, 11.2 and browser-review layout section.
- Read-only round-1 browser evidence under the supplied execdesign-check directory; opened JSON evidence and filter-04-chosen-390.png. Did not execute evidence scripts or open a browser.

Verification:
W = `pnpm --filter @watchdog-bms/web exec node --import tsx --test` (paths relative to apps/web).
H = `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh`.
- Final red proof: replaced changed production files with `git show HEAD:<path>` bytes in this worktree, ran seven specs together with W, then restored final bytes in finally and verified every file equals its saved bytes. Node exit 1: 109 tests, 70 passed, **39 failed**, 0 skipped. No git write/mutation command used. Each named regression below failed with 8131c6fff production.
- Final green focused command: W plus all seven files below; exit 0, **109 passed, 0 failed, 0 skipped**. Every named red regression is green. Compatibility tests also remain green.
- Final `H pnpm --filter @watchdog-bms/web typecheck`: exit 0 (Next route type generation and TypeScript; no test count). Final `H pnpm --filter @watchdog-bms/web exec node --import tsx --test "src/**/*.spec.ts"`: all S3_* removed via Python subprocess environment, exit 0, **3,017 passed, 0 failed, 0 skipped, 573 suites**, after the last code/test edit. Earlier successful locked runs had the same counts. Development typecheck earlier exited 2 for two test type errors, corrected.
- Contracts build not needed: no packages/contracts/src change this round.
- Exact old text grep across API/gateway/web/E2E specs: exit 0, 13 web files, one API file and two E2E files matched the broad old heading/label search. Web files covered by whole suite. Matched API file rerun: `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/executive-business/executive-report-read.pg.spec.ts`, exit 0, **32 pure tests passed, 0 failed**. Real-PostgreSQL suite explicitly SKIP because EXECUTIVE_REPORT_READ_TEST_DATABASE_URL is absent (Node skipped-test count is 0); real PostgreSQL not checked. E2E not checked because browsers/server are prohibited. No ai-gateway matches.
- Token contrast calculation exit 0; ratios above, structural tests cover the selected text classes.
- `git diff --check`: exit 0 after final production/test changes and again after this note. Final status lists only scoped files; no generated next-env.d.ts change.
- No sandbox-refused command. No browser/network/docker/server attempt.

Named regression evidence, per file (W + that path is the reproducible focused command; the proof ran them together; red exit 1 for combined command, green exit 0):

`src/features/executive-reports/executive-browser-review.spec.ts` — green 15/15; red 15 failing regressions:

- #1: A: executive markup owns its styles without unlayered Mangmee overrides — red failed, green passed.
- #2: A: incomplete words, muted figures and field hints meet 4.5:1 from existing tokens — red failed, green passed.
- #3: B1: first-visit ranking, top payers, all ranks and company comparison have one question mark — red failed, green passed.
- #4: B2: sticky headers stay in their isolated, bounded scroll context below the app bar — red failed, green passed.
- #5: B3: filter sheet explicitly fills the phone and has an anchored desktop width — red failed, green passed.
- #6: B4: select arrows work from the trigger, search focuses after mount, Escape closes only options — red failed, green passed.
- #7: B5: one read status, retained content, and export busy only while creating a file — red failed, green passed.
- #8: C8/C12/C14: one atomic directory filter, centred time controls, one-page paging hidden and not-found alone — red failed, green passed.
- #9: C10/C11/C13/C16: concise comparison, account controls, genuine export list and unchanged admin menu words — red failed, green passed.
- #10: C6/C15: ring and swatches share tokens; follow-up rows appear once, in the band — red failed, green passed.
- #11: C7: the directory does not repeat the main payment status in the expander — red failed, green passed.
- #12: C9/C12: revenue has a mobile snap strip and date/month touch targets are at least 44px — red failed, green passed.
- #13: B5: retained data is never rendered after denied access, a missing company or an unavailable month — red failed, green passed.
- #14: B5: a history read failure belongs to the history tab and export never previews a different query — red failed, green passed.
- #15: C10: comparison titles and side headers preserve free company names from the API — red failed, green passed.

`src/features/executive-reports/executive-compact-report.spec.ts` — green 13/13; red 6 failing regressions:

- #1: clean values keep full accessible qualifications, dots and no reference numbers — red failed, green passed.
- #2: one status detail deduplicates reasons; cells and KPI digits never contain sentences — red failed, green passed.
- #4: shared tables keep column structure fixed with dots, explicit widths, sticky names and compact mobile fields — red failed, green passed.
- #5: horizontal KPI digits and unit stay clean and reserve identical height/sub-line with or without a dot — red failed, green passed.
- #9: every report panel keeps complete, partial and unavailable reasons out of cells and KPI values — red failed, green passed.
- #12: paid usage names the two unknown sources truthfully and keeps each sub-reason count once in the status detail — red failed, green passed.

`src/features/executive-reports/executive-design-v2.spec.ts` — green 11/11; red 5 failing regressions:

- #3: v2 KPI icons and arrows stay compact while long payment context lives outside the tiles — red failed, green passed.
- #5: v2 filter drafts apply atomically, dismiss without mutation, clear and remove a single chip — red failed, green passed.
- #8: v2 directory filter controls and chips use effective drill filters rather than unrelated saved globals — red failed, green passed.
- #10: directory filters share the atomic draft and removable chips, including embedded drill choices — red failed, green passed.
- #11: KPI-only conditions share the time-row filter chips and can be removed individually — red failed, green passed.

`src/features/executive-reports/executive-presentation.spec.ts` — green 14/14; red 4 failing regressions:

- #2: overview aligns KPIs and puts adoption and follow-ups beside each other with a header button — red failed, green passed.
- #5: revenue trend has a fixed height, bar labels, signed baseline, gaps and one explanation per reason — red failed, green passed.
- #6: money lag appears once in the status detail and not in any KPI — red failed, green passed.
- #11: comparison groups controls in one card and results in another with side buttons and no repeated difference words — red failed, green passed.

`src/features/executive-reports/ExecutiveReportContent.spec.ts` — green 20/20; red 2 failing regressions:

- #4: overview renders four server metrics, a partial count, and four receipt groups with independent drill queries — red failed, green passed.
- #15: unavailable money never becomes zero in reconciliation; trend has a signed zero baseline and gaps — red failed, green passed.

`src/features/executive-reports/ExecutiveReports.wiring.spec.ts` — green 15/15; red 7 failing regressions:

- #2: the system shell and report gate use the exact permission, and the header has report links only for readers — red failed, green passed.
- #3: reads use authenticated fetch, no tenant target header, and reload/abort protect the entire answer — red failed, green passed.
- #7: directory chips hide empty drill rows and each filter toggle names its own scope — red failed, green passed.
- #8: Thai shared fields, detail tabs, history paging and responsive tables retain the permission-gated export panel — red failed, green passed.
- #9: search stays in the history entry with a 300ms debounce, back has a direct-link fallback — red failed, green passed.
- #11: opening/closing export and refreshing built months preserve report identity and read dependencies on every screen — red failed, green passed.
- #15: B5: company detail tabs and history pages preserve the company read identity — red failed, green passed.

`src/features/executive-reports/executive-reports.logic.spec.ts` — green 21/21; red 0 failing regressions:

- Removed the test for the now-unused reportFilterChips helper with that dead helper. All remaining 21 tests pass on old and new production; no new behavior claimed.

- Compact #8 only changes its API harness to supply executiveHref; same-build/mismatch behavior was already correct and remains green on old and new code. No regression red claimed for this harness adaptation.
- E2E only migrates the KPI selector to data-executive-value; not checked in a browser here.

Next:
Controller: review/commit uncommitted changes, then run `pnpm exec playwright test e2e/executive-report.spec.ts --project=chromium` on the configured local stack with its worker token. The repository has no project named webkit; its iphone13-webkit project only matches responsive/evidence specs, so use the controller’s existing Chromium/WebKit browser matrix for this report. Check all pages/tabs/states at 1280×800 (also original 1280×900) and 390×844: actual computed styles/contrast, popover box, nested select search/arrows/Escape, table sticky position/overflow, retained-data overlay, tabs/Back/read counts, long chart/KPI numbers, first directory row, action placement and page-height targets. Run the real-PostgreSQL suite with its documented database URL. Broad stale-text grep also matched e2e/settings.spec.ts and e2e/plan-term-billing-readiness.spec.ts; browser checks not available here. Second browser report can be handled when delivered; no claim it passed. Missing rolling figures/period ranges remain the next API lane.
