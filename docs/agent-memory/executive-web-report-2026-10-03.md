# Agent Memory: executive web report — stage E4b

Status: Implementation in the worktree; uncommitted. Focused tests, web typecheck and final locked whole-web run pass. Controller acceptance and live API/browser checks not checked.
Owner: executive report web lane, 2026-10-03.
Scope: EX-01 overview, EX-02 directory, EX-03A–D usage/revenue/customers/compare, EX-04 company/usage/history; API01–API06; shell/login/legal entry, permission/menu, Thai formatting, URL/history state, shared responsive controls. No backend, contracts, migration, dependency, package manifest, export, executive-account management, partner-label or deferred deletion change.

Decisions:
- Existing UI plan steps 2–8 and E3a contracts guide this lane. All controls/cards/states/tables reuse the system patterns and shared theme.
- Exact session permission gates the report subtree and menu. API01 capability can deny entry; a later read denial clears report data/context and removes the menu. Executive-only sessions land on reports without a remembered shop redirect or operator-support-count fetch.
- URL carries month, global filters, views, compare sides, directory filters/order/page and complete encoded drill query. Search is local to a history entry (300 ms debounce), never URL/localStorage. Build reference is layout memory. Drill query is complete: do not merge the source global filters into it. Changing a shared filter also changes its corresponding picked query field.
- Abort superseded reads. One response owns the figures. Reload buildChanged exactly once. SOURCE_STALE keeps the returned build and timestamp. A missing-month 503 is a no-data/retry state, never zeros; API01/history source failures are source errors, not missing-month claims. A failed history read retains the permitted company response; denial/not-found still clears it. Context and report retries share one countdown hook and respect returned 429 wait time. Known zero stays zero; unavailable has no number; partial counts say “อย่างน้อย”, partial money says “ยอดเฉพาะรายการที่ยืนยันแล้ว”.
- Back returns the actual originating history entry even after filter/page pushes. Restore search from that entry. Direct-entry fallback uses the report context. Back label names the actual source screen.
- Labels/options/events are reused from contracts. Page copy and product transliteration have one report dictionary; reason/error copy has one common dictionary. Latest lane rule overrides the earlier seller-code/English-label wording: omit returned seller code suffixes, translate product/control labels, use first/second Thai sides, omit UAT token; render the two existing operator menu labels in Thai while on report routes, including admin readers. User-entered names/contacts remain actual values.
- Money is satang converted to two decimals; dates/months reuse Thai/Buddhist helpers. Only complete negative net has the refund-over-receipts explanation; negative fees/tax/costs, comparison differences and partial net do not prove that claim. Partial receipt/net flags do not invent a negative assertion. The received-money/non-positive-net difference never proves full refunds.
- Contact NOT_PERMITTED renders neither labels nor values, even if forbidden values are supplied. Other contact statuses use only allowed payload fields. History shows event/date/plan allowlist only. Company id appears in links, never visible copy.
- API05 measured AI cost carries its own coverage since E3a round 2 (2026-10-03, backend spec §16.6): it renders through the shared figure (partial = confirmed-only money with its reason; unavailable = no figure with its reason). Still “ที่วัดได้”, never total cost.

Open questions:
- Answered by E3a round 2 (2026-10-03, backend spec §16.6), wired on the same branch: API04 `spendConcentration` returns `restCount`, `restShare`, `topCompanyShare` / `prefix80CompanyShare` / `restCompanyShare`, `nonPositiveCount` and `roundingNote`, shown as returned (no web arithmetic); API01 returns `builtMonths` and the month picker disables the other months (`ThemedDate` `selectable`); API05 `aiCostSatang` has its own coverage (rule proposed, owner to confirm).

Artifacts:
- apps/web/app/system/executive/: permission layout and seven route pages.
- apps/web/src/features/executive-reports/: typed reads, provider/page orchestration, responsive presentation, shared words/logic and three focused spec files.
- Existing system/company layouts, SystemHeader, session gate/spec, common error words, ThemedDate/spec.
- UI/wording specs and UI plan status updated in the same diff. Browser matrix below.

Verification:
- Initial test-first command (logic + wiring + auth gate): exit 1, 54 tests, 33 pass / 21 fail (13 new logic, 5 new wiring, 3 new auth). Wiring initially had an incorrect relative path; corrected before green and reproved against the baseline below.
- ThemedDate spec red: exit 1, 5 tests, 4 pass / 1 fail. Default clear behavior remains covered by four existing tests.
- Corrected wiring + eight rendering cases reproved against old production state: existing shell/header temporarily replaced with git-show HEAD bytes; new feature production modules/root route blanked to represent old absence; backups restored in finally. Test command exit 1, 13 tests, 0 pass / 13 fail. No git mutation. Node SVG loader setup was required before this meaningful rendering run.
- Targeted red assertions: complete picked-filter edits + unavailable reconciliation (exit 1, 0/2); reversed-sort words + 429 delay + confirmed zero-money month + revoked-menu wiring (exit 1, 0/4); clearing history search (exit 1, 0/1); back-distance/source-label helper (exit 1, 0/1); clickable receipt chart (exit 1, 0/1); product/seller/environment words + header wiring + clickable spend chart (exit 1, 0/3); measured cost does not invent partial coverage (exit 1, 0/1); drilled seller chips exclude code and sort tokens (exit 1, 0/1); negative fees and partial net never claim refunds exceed receipts (exit 1, 0/1); operator menu labels for admin report readers are Thai (exit 1, 0/2); source failure context/history preservation and first-context retry wiring (exit 1, 0/2). Each passed in a subsequent complete focused run or the final whole-web run, including the last measured-cost assertion.
- Final focused five-file run: exit 0, 74 tests, 74 pass / 0 fail, 11 suites, including measured-cost wording, drilled seller-code chips, negative-money context and context/history source errors. Commands use pnpm --filter @watchdog-bms/web exec node --import tsx --test followed by the three executive spec paths, src/common/auth/session-gate.logic.spec.ts, src/common/components/field/ThemedDate.spec.ts.
- Web typecheck via supplied heavy.sh: earlier exit 2 (JSX brace), then exit 0; later exit 2 (missing Thai-label import and fixture cast), corrected, final exit 0 (next typegen + tsc --noEmit). No typecheck bypass.
- Earlier whole-web run via heavy.sh, all S3_* environment variables removed: exit 0, 2689 tests, 2689 pass / 0 fail, 547 suites. Final run after all production changes: exit 0, 2696 tests, 2696 pass / 0 fail, 547 suites, 0 skipped/cancelled/todo, 30989.334917 ms. Preceding whole-web runs also passed after negative-money context and operator-menu copy corrections. The immediately preceding whole-web run also passed 2694/2694 before the last drilled-chip fix.
- git diff --check: exit 0, no whitespace errors.
- Copy inventory inspection: first ESM named-import command exit 1 (tsx exposes this module as CommonJS); corrected node --import tsx -e require command exit 0. This was not a test run or sandbox refusal.
- Contracts unchanged; contracts build not required. No API/browser/database/network/server commands run. No sandbox refusal occurred.

Next:
- Hand off the verified uncommitted diff. Temporary verification logs removed after recording counts here.
- Controller: review exact contract gaps, run real PostgreSQL/API specs and browser checks below. Do not consider layout/theme/browser acceptance checked by unit or source-wiring tests.

## Browser checklist for the controller — all not checked in this lane

Base each route on an executive reader session and month returned by API01 (example 2026-09 only if built). Repeat the report routes with admin+read, no-read, and revoked-during-read sessions. At 390×844, 768 px and desktop, check no horizontal page scroll; long names, negative money, unknown/partial/zero, touch targets; light theme under device dark mode; popup portal/clipping and keyboard/focus/Escape/outside close. Use real API data or test-harness response setup; production paths have no fixtures.

| Route/state | Loaded and interactions | Inputs/dropdowns |
|---|---|---|
| /system/executive | Four figures, four receipt groups, follow-ups; click figure, chart colour and legend → exact group list → detail → back | Month; expanded shared industry/discovery/referring-sales filters |
| /system/executive/companies | Whole-filter summary, mobile cards/desktop fixed table, long names, sorting/reversed URL order, page bounds, empty filter result and clear; select two companies → compare; search restored after detail/back | Month; shared three filters; search; sort; expanded current company/plan status, usage, paid-ever, receipt history, spend group, signup rail |
| /system/executive/usage?view=adoption | Receipt adoption and paid usage including unknown reasons and full-refund flag; exact drills | Month; shared three filters; adoption/ranking view buttons |
| /system/executive/usage?view=ranking&rank=expenseReceiptCount | Three metrics, backend rank/ties, long names; complete list preserves metric order | Month; shared three filters; ranking metric dropdown |
| /system/executive/revenue?view=summary | Receipts/refunds/net/fees/VAT, purchase groups including unavailable addon, unmatched/excluded amounts, six-month signed trend and gaps | Month; shared three filters; summary/top view buttons |
| /system/executive/revenue?view=top | TOP20/REST/TO80, ties and drills; <10 population, no positive net, incomplete money; missing contract figures remain absent | Month; shared three filters; summary/top view buttons |
| /system/executive/customers?view=industry | Group count/share/money, unknown group and coverage line, group drills | Month; shared three filters; industry/discovery/sales view buttons |
| /system/executive/customers?view=discovery | Channels/unknown/other, Thai channel labels and group drills | Same shared controls |
| /system/executive/customers?view=sales&seller=referring | Referring seller groups, no-code names, none/unknown/unresolved; switch to credited current figures, waiting counts and three credit notes | Same shared controls; referring/credited seller-view dropdown |
| /system/executive/compare | Empty selection/same sides, groups/company selection, seven server metrics/diffs, null averages, side swap, group/company drills, return context | Month only; dimension; first/second searchable dropdowns for groups; company choice links to directory; no shared filters applied |
| /system/executive/companies/<id>?tab=company | Four month figures plus current identity/status/plan/contact/source; no forbidden contact labels/values; month before signup; admin-only management link | Month only; company/usage/history tab buttons; no shared filters applied |
| /system/executive/companies/<id>?tab=usage | Receipt/day/user/document/helper metrics, line/web split, distinct timestamps, actual measured cost, complete zero flags versus unknown; partial money/usage | Month and detail tabs only |
| /system/executive/companies/<id>?tab=history&page=1 | Event/date/plan allowlist, empty history, multiple pages and back; no actors/reasons/cases | Month and detail tabs; pagination |
| All seven routes: permission/errors | Direct no-read URL denies gracefully; no menu; API01 denial and later read denial clear data and menu; expired auth returns with context; missing-build 503 no numbers + retry; API01/source failure generic error; API06 failure keeps successful company figures; stale banner timestamp; buildChanged reload once; fieldErrors under matching field; unknown diagnostics stay Thai; 429 returned wait disables retry | Check all relevant month/filter/search/compare fields in error state |
| All applicable views: partial/empty/loading | Partial counts “อย่างน้อย”, partial money qualifier, unavailable no number+reason, genuine zero; empty filtered list has selected conditions+clear; rapid changes/late responses never show old figures under new filters | All controls open and closed, before/during/after reads |
