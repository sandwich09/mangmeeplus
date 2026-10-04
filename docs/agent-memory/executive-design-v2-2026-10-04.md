# Agent Memory: executive-design-v2-2026-10-04

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
