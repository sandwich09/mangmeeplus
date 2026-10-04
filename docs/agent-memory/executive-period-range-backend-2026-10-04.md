# Agent Memory: executive-period-range-backend-2026-10-04

Status:
- Backend/contracts diff implemented and left uncommitted for controller review; focused checks complete; PostgreSQL/browser/capacity acceptance pending. No web, network, servers, migration, Prisma schema, package.json, dependency, W00/manifest or pins changes.

Owner:
- Codex backend implementation lane; controller reviews/commits and runs real PostgreSQL, browser and capacity acceptance.

Scope:
- R1 API01–06/contracts and R3 API13 export from existing monthly summary tables. R2 and RP11–RP14 are the next web lane; R4 real end-to-end/capacity belongs to controller.
- Preserve old single-month requests and history without a period. Paired requests use range contracts/words, even for one month.

Decisions:
- Read AGENTS.md and repository ponytail full SKILL.md first. Existing summary tables/build/version/permission/audit boundaries reused; no build change required by §23.3.
- 2026-10-04 Q32/Q38: ผู้ควบคุมงานตัดสินตามที่เจ้าของมอบหมายเรื่อง UX. Bangkok days 1–7 default LAST_MONTH, otherwise THIS_MONTH. Only preset starts before the first built month may shorten; ALL first built…latest built; no end/interior gap shortening. API01.defaultPeriod names the resolved preset; explicit pairs return appliedPreset=null because a pair cannot prove the chosen shortcut.
- Q39: no churn KPI. Q40: only monthly distinct users, null/DISTINCT_USERS_NOT_AVAILABLE across months. Multi-month disputed invoices also have no distinct total. Q41: 10,000 unique exported companies plus existing 20 MiB/30 second limits, no silent truncation.
- Range rows sum before ranking/cohort classification; active/receipt-paying companies use union evidence; paid/refund flags come from final month; current profile dimensions classify all months. Monthly revisions/dataThrough and equal-length previous-period facts are returned separately.
- Missing headers/rows never prove zero; before signup is not applicable. Coverage is scoped per metric/month/company; cost separate. Filtered list/detail summaries exclude gaps belonging to excluded companies. Purchase-kind money excludes unavailable months just like period totals.
- Closed/current actuals may compare only when both sources complete; zero/negative/absent/partial bases have separate states/words. Ratios use exact integer products before one rounding; unsafe whole totals refuse rather than silently round.

Open questions:
- No product decision needed in this lane. Real PostgreSQL, browser acceptance, actual Excel opening and ALL × equal-length previous-period capacity: not checked; unavailable/assigned to controller.
- Existing web reasonText map does not recognize new RANGE_MONTH_NOT_BUILT (and must also consume DISTINCT_USERS_NOT_AVAILABLE/MONTH_SUMMARY_INCOMPLETE). Required web text-regression run has one failure; web editing expressly excluded.

Artifacts:
- Contracts: executive-business.ts, executive-report-words.ts; tests in registered business-policy.spec.ts.
- API: executive-report-read.service.ts, executive-read.logic.ts, executive-export.logic.ts, executive-report.controller.ts; tests in registered executive-report-read.pg.spec.ts. Build production/spec unchanged.
- Specs: backend §23 decision register/contracts handoff, plain-language P words/default, Excel range section; backend plan R1/R3 status.
- Web handoff: ExecutivePeriodRequest from/to (month legacy alone), context.defaultPeriod/presets, period/months/previousMonths, affectedMonths, periodComparisons/KPI comparison, monthlySeries (A/B side), detail.periodSummary/periodReasonCodes/monthlyHistory.applicable, nullable range users/disputes, joinedInPeriod drill flag, shared EXECUTIVE_PERIOD_WORDS and month/period/filter/sort/comparison helpers. Export filters exclude the period: body owns it. Pair downloads expose a UTF-8 Thai report title/actual-period/creation-date filename; legacy filename retained.

Verification:
- RED old production: temporarily wrote HEAD versions of read service/controller/read logic, ran focused node test, restored exact saved bytes in finally (no git mutation). Command: pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec --test-name-pattern='executive period range|writes every source date' src/modules/executive-business/executive-report-read.pg.spec.ts. Final baseline exit 1: 1 existing fixture test pass, all 20 new non-DB range cases fail.
- RED contracts: pnpm --filter @watchdog-bms/contracts exec node --import tsx --test src/business-policy.spec.ts, exit 1, 3 pass/1 fail (missing range preset contract). GREEN same command exit 0, 4 pass/0 fail. Final word assertions also RED exit 1 (3 pass/1 fail: repeated single-month name), then GREEN exit 0 (4 pass/0 fail) after matching P06/P08 exactly.
- Additional test-first RED/GREEN on implemented range path: RP07 purchase-kind reconciliation exit 1 (45,000 versus 35,000 receipts), then exit 0 (1 pass); RP07/RP15 scoped summaries exit 1 (null versus 5,000), again exit 1 (unrelated partial-money chart qualifier), then exit 0 (1 pass); RP15 group money notes exit 1 (at-least word instead of confirmed money), then exit 0 (1 pass); RP15 HTTP range filename exit 1 (legacy generic filename), then exit 0 (1 pass); creation-date assertion also exit 1 before adding the spec-required date, then final whole read run GREEN.
- All 20 new non-DB cases in read spec: RP01 period validation/legacy; RP02–03 Bangkok defaults/shortcuts/gaps; RP04–06/RP19 sum/union/end flags/current partitions; RP07 interior gaps; RP07–08 distinct users/disputes/missing row/cost; RP07 purchase-kind reconciliation; RP07/RP15 scoped summaries/cost words; RP15 grouped money words; RP09 prior period/base states; RP10/RP19 open actuals/monthly/current; API06 history/audit period; RP15/RP17 cached export/monthly/previous sources; RP15 HTTP Thai download filename; RP01 HTTP DTOs/forged filters; RP02/RP09 quarter/year crossover; RP05–06 signed range cohorts; RP07 wholly missing company rows; RP09–10/RP19 A/B/rate/partial/long series/stale sources; RP18 changed build/export expiry/company cap basis; RP20 integer bounds/rounding.
- New registered real-PG cases (not run/red/green not checked): RP04/RP08/RP19 real built range and reconciliation; RP07 delete/restore header/company row; RP16 hourly build old row IDs/current labels. Controller runs EXECUTIVE_REPORT_READ_TEST_DATABASE_URL and EXECUTIVE_REPORT_BUILD_TEST_DATABASE_URL on disposable PostgreSQL as documented in the specs/CI.
- Existing date fixture corrected to October, matching its companies' October signup; behavior expectation unchanged and passes on original production. Existing PG nullable metric assertion/JSON restore adapted for types only.
- Contracts build: pnpm --filter @watchdog-bms/contracts build, exit 0.
- API typecheck: heavy.sh pnpm --filter @watchdog-bms/api typecheck, exit 0 after coverage refinements; final repeat after Thai filename/creation date and P06/P08 word alignment exit 0. Earlier exit 2 exposed optional-month/nullable metric and PG JSON typing, corrected.
- Old-text scan: rg over every API/ai-gateway/web spec and e2e file with 22 replaced month phrases, exit 0; filename scan also exit 0 (only API read spec), P06/P08 scan exit 0 (only contracts business-policy spec); only read.pg.spec.ts, ExecutiveReportContent.spec.ts and executive-reports.logic.spec.ts matched; no e2e match.
- Web text specs: pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/executive-reports/ExecutiveReportContent.spec.ts src/features/executive-reports/executive-reports.logic.spec.ts, exit 1, 41 pass/1 fail. Failure: every reason and paid-ever sub-reason has reviewed Thai words, RANGE_MONTH_NOT_BUILT falls back to generic error. Content 20/20, logic 21/22. No web changes.
- Final read spec command: pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/executive-business/executive-report-read.pg.spec.ts, exit 0, 52 pass/0 fail; real-PG suite explicitly SKIP.
- Build spec command: pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/executive-business/executive-report-build.pg.spec.ts, exit 0, 6 pass/0 fail; real-PG suite explicitly SKIP.
- git diff --check: exit 0; repeated after final note update below.

Next:
- Controller reviews the uncommitted diff; all authorized backend implementation is present. Final API typecheck and git diff --check pass; ready for review/handoff within this lane.
- Controller: real PostgreSQL read/build specs, full verification, actual workbook/API reconciliation and ALL capacity, then next web range lane consumes §23.6 contracts and extends all reason-text/coverage maps; URL origin/from migration/browser remains R2.
