# Agent Memory: Executive business demo

Status: 2026-10-01 plain-language review and source-controlled prototype prepared. User authorized landing this executive spec/demo work in main and develop; isolated checkout and PR/CI verification in progress. Actual application/export remains unimplemented.
Owner: User / Codex
Scope: Platform executive reports, company segmentation/detail/paid usage, executive accounts, and contextual Excel export design. Deletion is entirely deferred and hidden; this turn changes documentation and local demo presentation only. No application/backend implementation is authorized.

## Decisions

- User clarified this is for Mangmee platform executives, not tenant owners.
- User paused implementation to discuss needs, then explicitly requested a demo.
- Prioritize business overview → filter/compare business categories → company details.
- Separate legal entity type from business industry; show province, plan, acquisition channel, usage, platform receipts, and measurable service costs.
- Platform receipts are fees paid to Mangmee, not the customer company's sales or financial records.
- Use twelve fictional companies; all aggregate numbers derive from the same fixture rows.
- Demo runs locally in conversation with no application/API integration and no real mutations.
- Deletion intake represents an email request and starts awaiting identity verification. The demo does not approve or execute erasure. P31 and data-rights controls remain source of truth, with the 2026-09-30 fourteen-day owner amendment below superseding the old one-day cooldown.
- User requested explicit discovery channel (how the customer heard about Mangmee) and referring salesperson. Added independent fields, directory column, company attribution section with sample reference, global filters, and two analysis tables with company-count/paying-company/net-receipt totals and drilldown.
- The initial demo allowed discovery plus a salesperson (e.g. Facebook + คุณฟ้า). Owner B6 rejected that signup behavior; v2 fixtures now respect sales-or-channel capture. Preserve signup route/current service team separately and distinguish confirmed no referrer from unknown data.
- User requested a screen spec and strict parity with the existing theme, especially every dropdown and text input; backend logic is explicitly deferred to the next discussion.
- Real implementation must reuse the current system shell, design tokens/fonts and shared fields, not the demo's custom palette/font/native select/dark appearance. Require open-dropdown and input-state browser evidence, not just a default screenshot.

Open questions: Precise metric/event/cutoff contracts, identity/account administration and per-user permissions. Deletion clock anchor, access during waiting, cancellation, execution mode and lawful retention inventory are deferred by the user; the fourteen-day/all-data rule itself is decided. B6 is closed: retain existing conditional salesperson capture.

## Artifacts

- Inline source: `/Users/thawatchai/.codex/visualizations/2026/09/30/01a0f012-a7a3-7733-a08a-a31db64bc2a7/mangmee-executive.html`
- Local preview, browser verification script `check-demo.cjs`, and QA screenshots live alongside the inline source.
- V2 editable source: `executive-preview.tsx`, `executive-preview.css`, `preview-locale.ts`; reproduce with `node build-preview.cjs` in that same directory, then the visualize skill's `scripts/render.py` wrapper. No dependency/package.json changes.
- Design references inspected in earlier discussion: `docs/specs/admin-company-onboarding-spec.md`, `docs/specs/mangmee-company-data-lifecycle-deletion-spec-th.md`, existing system data-rights routes and sales reports.
- Ponytail path supplied in AGENTS.md was stale; used repo `.agents/skills/ponytail/SKILL.md` instead.
- Screen spec: `docs/specs/mangmee-executive-business-ui-spec-th.md`
- Delivery/check plan: `docs/plans/mangmee-executive-business-ui-plan-th.md`
- Backend decision draft: `docs/specs/mangmee-executive-business-backend-spec-th.md`
- Amended P31 spec/plan: `docs/specs/mangmee-company-data-lifecycle-deletion-spec-th.md`, `docs/plans/mangmee-company-data-lifecycle-deletion-plan-th.md`

## Verification

- Passed `node /Users/thawatchai/.codex/visualizations/2026/09/30/01a0f012-a7a3-7733-a08a-a31db64bc2a7/check-demo.cjs` against the skill's sandboxed preview wrapper.
- Checked September overview (12 companies, 11 using, 9 paying, THB 10,956 net), restaurant filter, August totals, and agreement between segment rows and overview.
- Checked industry/entity/search filters, empty search, company profile/usage/history, and a month before company signup.
- Checked local request intake → pending identity verification → request detail, with company count unchanged. Native form navigation is disabled by the preview sandbox; the demo uses a local button and form validation.
- Checked layout at 1056/736/390/320 px with no outer horizontal overflow or page errors; tables retain contained horizontal scrolling on narrow screens.
- Visually inspected desktop overview, company detail, mobile overview, and dark appearance screenshots.
- Application code, dependencies, cloud resources, and live data were not changed.
- Follow-up attribution checks passed in the same runnable browser check: independent discovery/sales filters, combined empty results, no-referrer vs unknown, company detail, channel/sales drilldown, and both report tables reconciling to 12 companies / 9 paying / THB 10,956. Inspected updated attribution-analysis and company-detail screenshots.
- Screen-spec handoff: Python check passed for relative Markdown links, balanced fences, whitespace, referenced shared component/test/route paths and key screen/theme requirements across the spec/plan/memory. Scoped `git diff --check` passed (these new files are untracked; the Python check also inspected their full contents). No application tests rerun for this documentation-only change.
- Backend-decisions round: Python check passed across all six scoped documents for relative links, balanced fences, whitespace, B1–B8, EX-07/08, theme requirements and removal of operative one-day/waiver instructions. Scoped `git diff --check` passed. No application tests/typecheck/E2E rerun because this round changes documentation only.
- B6 clarification: Python check passed across four scoped documents for relative links, whitespace, balanced fences, the accepted existing-flow decision and removal of stale B6-pending statements. No application tests run for this documentation-only clarification.

## Backend discovery / BA-SA discussion (2026-09-30)

- User invited requirements questions; the discovery notes below preceded the owner answers recorded in the next section.
- Existing signup discovery options are Website / IG / TikTok / Facebook / Sales / Other (`packages/contracts/src/external-signup.ts`). The public signup contract ties `referralSalesCode` to discovery `SALES`; owner B6 subsequently confirmed retaining this flow.
- Company already has `businessTypeCode`/`businessTypeOther` for declared TSIC activity, a separate `businessCategory` that must not be repurposed as the commercial industry taxonomy, and `referralSalesUserId`/`referredAt`/`referralSource`.
- `SalesAttribution` and the sales reports service already track credited first paid activation. The credited salesperson can differ from the original referring salesperson (deal attribution). Existing owner decision §17.2 excludes renewals from salesperson credit; executive portfolio receipts must remain separately named if requested.
- At discovery time P31 recorded manual emailed requests, no automatic purge, explicit single-admin mode and a default one-day cooldown. The latest owner answer supersedes that cooldown and immediate-waiver path. Do not infer executor readiness from case-management screens.

## Owner answers / screen structure update (2026-09-30)

- B1: Owner plus executives currently total four. Add executive-account list/create/detail structure in admin console (EX-07/08). Four is not a cap and does not mean all four are System Admins. `/system/users` currently redirects to partners; no real accounts/invitations created.
- B2: All real companies/statuses, filterable, exclude test/internal, count each company workspace once.
- B3: Meaningful feature activity, login separate. Show paid-but-not-started and usage extent. Latest clarification merges awaiting activation into the single paid-not-started business group; insufficient usage evidence is a coverage note, not a customer-status filter. Inactive and active groups remain. Counts/days/users first; no invented low/medium/high thresholds.
- B4: Real platform receipts for packages/renewals/add-ons less refunds; fees/costs separately.
- B5: Show original referring seller separately from credited first activation seller; preserve current sales attribution/renewal exclusion rules.
- B6: User clarified “ไม่ๆ ถ้ามีเซลล์ก็เซลล์ ช่องทางก็ช่องทาง”. Retain current flow: sales origin identifies the referring seller; other origins identify the channel, with Other free text unchanged. Do not add independent referral codes to every source. Updated backend/UI spec and plan; original referring seller vs credited seller (B5) still remain distinct. Do not infer/rewrite historical attribution. Fixtures were corrected in the later v2 repair below.
- B7: Readable business groups with detailed existing activity types underneath; mapping still needed.
- B8: Request → approval → retain all data fourteen days → actual erasure leaving only lawfully retained data. User explicitly defers details and permits screen structure first. Updated P31 D4/E4 and plan to supersede one-day/immediate-waiver instructions; no automatic purge, role allocation, timer anchor or retention categories inferred.
- Updated UI spec/plan for account management, paid-usage cohorts, distinct salesperson credit and request stages. Demo HTML was not changed in this round; these are documented screen structures, not implemented routes.

## Consistency review before repair (2026-09-30)

- User asked whether screens and backend are consistent. Static review confirmed accepted business decisions align across UI/backend draft and P31, but this is not full contract or integration readiness.
- Demo is behind: Facebook/event/referral plus seller fixtures contradict B6; credited seller view, full paid-usage cohorts, executive-account screens and fourteen-day retention stage are absent. It still uses custom theme/native selects. Demo was inspected, not edited in this review.
- Current code: signup still drops sales codes outside SALES; `/system/users` redirects to partners; system layout uses existing SystemAdmin/billing gates; new executive routes were not found in the inspected system route tree. Data-rights `startExecution()` validates state/retention/actor separation but has no new fourteen-day waiting guard. Existing case workflow is not evidence of a full deletion executor.
- Corrected UI source examples to canonical signup options; Google/LINE/events/referrals belong in OTHER details when recorded, not silently invented enums.
- Added UI/backend/demo/code comparison in backend draft §8 and explicit remaining demo work in delivery plan. No app implementation, live-environment inspection or browser/integration test was performed.
- Verification: Python check passed for all four scoped documents' local links, source file references, balanced fences, whitespace and explicit consistency-status sections. Application/runtime tests were not run for this static review and documentation-only update.

## Consistency repair — user requested “แก้สิ” (2026-09-30)

- Replaced the old fragment at the same path with v2, preserving the demo/design scope. No real ERP routes, database, auth grants, deletion executor or cloud deployment changed.
- The local build imports actual repo `SelectField`, `ThemedSelect`, `TextField`, `TextareaField`, `ThemedDate`, `Button`, `MangmeePage/Card/StatCard/Badge`; compiles app global CSS/design tokens with installed Tailwind and embeds existing Outfit/IBM Plex Sans Thai fonts. Shell preview geometry follows SystemHeader's light appearance; actual SystemHeader/auth is not mounted. Locale/session integration alone is stubbed to Thai for the sandbox.
- Uses actual `SIGNUP_DISCOVERY_SOURCE_OPTIONS` and `signupDiscoveryLabel`; no non-SALES source has a referring seller in fixtures. Separate credited-seller report/detail demonstrates original referrer versus deal credit.
- Overview/directory/detail cover not-started, inactive, active, awaiting-service, unknown and unpaid states. Actual example counts show usage extent, while unknown remains null/—. Login is separate. September example totals reconcile across source/industry/referring-seller groups: 12 companies, 6 using, 9 with receipts, THB 10,956 net. Historical trend is explicitly a fixture, not a production formula; other report months return unavailable instead of fake zero.
- Added four fictional executive accounts, searchable/filterable list, create validation/duplicate email, detail and local status toggle. Reader perspective hides account/request-management actions. No credentials or invitations.
- Added request creation, simulated approval, all-data fourteen-day waiting examples (9 days remaining and an already-elapsed case), null hold dates after new approval until backend confirms clock, and outcome/retention placeholders. Deletion action stays disabled in every demo state; elapsed time is not a successful deletion. Anchor/retention law details remain deferred as requested.
- Added loading/error/retry/forbidden examples in a demo-only footer. Replaced old native selects, fixed a saved-state echo navigation issue and narrow-screen money overflow, and cleared field-specific validation errors when inputs change.
- Updated UI spec, backend draft §8 status and §9 presentation contracts, plus delivery plan. Fields/filter context/coverage/money units/permissions/hold dates/command errors now map explicitly; unresolved policy does not become a guessed API rule.
- Verification passed: `node build-preview.cjs` → 445,591-byte fragment; `python3 .../visualize/1.0.45/skills/visualize/scripts/render.py <fragment> <preview> --force`; `node check-demo.cjs`.
- Browser checks: source/seller combinations, distinct credited seller, cohort drilldown/back, unknowns, report sums, month unavailable, searchable dropdown no-results/keyboard/Escape/outside-click/switching, account invalid/duplicate/create/pending/status/search, request intake/approval/hold/elapsed/null dates, reader actions and loading/error/forbidden. No runtime page errors and no rendered native selects.
- Browser layout checks passed 1440/1024/768/390/320px, including popup bounds. Fixed app light colors and font stack verified with OS dark preference. Visually inspected overview, open dropdown, account focus/error, fourteen-day request and mobile dark-OS screenshots. This is browser evidence for the local shared-component preview, not API/system-shell integration evidence; native browser zoom/autofill remain for application QA.
- Screenshots with suffix `-v2.png` live beside the source, including `overview-v2.png`, `analysis-v2.png`, `dropdown-v2.png`, `account-form-v2.png`, `account-form-error-v2.png`, `request-hold-v2.png`, `mobile-v2.png`, `mobile-dropdown-dark-os-v2.png`.

## Simplify paid-not-started (2026-09-30)

- User requested one label for the compared pre-use states: “จ่ายแล้ว ยังไม่เริ่มใช้”. Removed the separate waiting-for-service group from filters, cards and fixture service status; its company now belongs to NOT_STARTED.
- Kept previously-used-but-inactive and active groups. Insufficient activity evidence is a neutral “ยังประเมินการใช้งานไม่ได้” note, not a business-status option/card; usageGroup is null, counts stay null/— and it is not silently counted as not-started.
- Overview now shows paid cohorts 2 not-started / 3 inactive / 5 active plus 1 paid company not yet assessable. The 12-company population and THB 10,956 receipts-minus-refunds total remain unchanged.
- Updated UI/backend presentation contract and delivery plan together. Restored old demo filters map AWAITING_SERVICE to NOT_STARTED and removed UNKNOWN usage filter to ALL; old service filter is cleared so it cannot trap the list.
- Rebuilt the same fragment (446,650 bytes) and preview. `node check-demo.cjs` passed, including the merged two-company drilldown, three cohort cards, removed dropdown options and neutral unknown note; all existing source/account/request/theme/mobile checks still passed. Visually inspected the updated overview.
- This changes the demo/read-model design, not production signup, billing, service activation or the deletion executor.

## Detailed backend design and E2E simulation (2026-10-01)

- User requested detailed BE spec, bugs/gaps/impacts across adjacent modules, and simulation of every feasible FE→BE flow; explicitly “อย่าพึ่งเขียนโค้ด”. No application, demo source, migration, dependency, package.json or executable test code was edited.
- Expanded backend spec to requirements R01–R16, architecture/source ownership, population/time/snapshot/filter contract, metrics/null/coverage, activity taxonomy, billing cash facts, attribution, API01–API12, auth/accounts, case transitions/hold/execution/evidence, data-model candidates, performance and Q01–Q09 decision register. API12 gives executives safe summaries of every company's case as already requested; detailed requester/evidence fields and commands remain separate Q06 permissions.
- All new endpoints, fields, roles and metric policies are marked proposed. Kept B1–B8, SALES-or-channel and one NOT_STARTED group. No retention law or deletion clock anchor was invented.
- Added `docs/research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md`: evidence E01–E18, 35 findings G01–G35, 19 adjacent module groups. Distinguishes actual code behavior, new-feature gaps, demo limitations and potential integration risks.
- Added `docs/qa/mangmee-executive-business-e2e-simulation-2026-10-01-th.md`: 12 detailed walkthroughs; 176 scenarios in 9 families plus 12 combined scenarios = 188 unique cases. Every row states target outcome/current support/open decisions. This is static request/response/state simulation, not a claim of live HTTP/DB integration.
- Added `docs/plans/mangmee-executive-business-backend-plan-th.md` with stages, decision dependencies and verification gates. Updated UI spec/plan cross-links and FE contract requirements; added a short P31 current-audit note without rewriting deferred legal/execution policies.
- Confirmed critical gaps: executive reader role/routes absent; shell and default membership/landing integration; paidAt/refund-effective-time history insufficient for cash-by-month; model-call/OCR-admission counters not successful customer activity; legal entity/classification/industry source gaps; case form required fields and approval prerequisites missing in demo; no current 14-day guard; current actor segregation differs from P31 single-admin proposal; no full erasure executor/machine-verifiable evidence.
- Other concrete findings: existing SalesReportsService silently takes at most 5000 eligible rows; demo keeps hidden list filters when drilling; negative cash trend bars are not supported; demo 3% fee/credit formulas are fixtures, not source policies; account boolean cannot represent activation/enrollment. Executive case summaries are already in scope; detailed requester/evidence visibility requires a separate decision.
- Partial usage correction: fixture confirms at least 6 active companies with one unknown, so target BE should send activeCompanies value null/knownValue 6/partial. Counts can be lower bounds; signed net cash/cost cannot use “at least” when refunds/corrections are missing. Demo source deliberately not changed in this no-code turn.
- Fresh schema survey: 201 models declare companyId; 27 lack a direct Company relation. These are not all orphans; indirect relations/retention need separate inspection. P31 historical counts/config/legal statements were not treated as current proof. No cloud inspection was performed.
- Clarified preflight evidence versus post-execution evidence to avoid requiring proof of completed erasure before allowing execution.

### Verification for this turn

- Existing `node /Users/thawatchai/.codex/visualizations/2026/09/30/01a0f012-a7a3-7733-a08a-a31db64bc2a7/check-demo.cjs` PASS. It regenerated existing QA screenshots, did not change demo source, and used the local file sandbox. It verifies the existing fixture behavior, not the newly specified target contracts.
- Existing focused tests command below: **58 passed, 0 failed, 0 skipped**. Mocks/domain tests only; no new test code, external provider or database operations.

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
  src/modules/data-rights/data-rights.service.spec.ts \
  src/modules/data-rights/data-rights.controller.spec.ts \
  src/modules/sales-console/domain/sales-attribution.logic.spec.ts \
  src/modules/external-signup/domain/line-signup.logic.spec.ts \
  src/modules/billing/application/billing-financial.spec.ts
```

- The current approve→startExecution unit scenario passes immediately, which evidences G08 rather than proving the new hold requirement.
- Final documentation check PASS across 8 scoped documents: 83 local links exist, balanced fences, consistent table columns, no trailing whitespace; 188 unique case IDs, 12 walkthroughs, 35 findings, 16 requirements, 12 API reference groups and 9 decision gates. All findings and API reference groups appear in the QA trace. An initial check found API06 only in compact grouped notation; made the reference explicit and reran successfully.
- Fixture arithmetic PASS against the existing TSX seed: 12 companies, 6 confirmed active, 9 receipt companies, receipts 1,145,500 satang, refunds 49,900, net 1,095,600; cohorts 2/3/5 +1 unknown +1 unpaid; source/referrer totals reconcile. Known documents 2,147 and AI requests 3,466 remain partial because one company's activity is unknown.
- Scoped git diff --check PASS. The content checker also reads untracked new documents, which git diff alone does not validate. No full app build/typecheck/live E2E/load test/restore/erasure was run: no application code changed and new endpoints are not implemented.

Next: Discuss current Q01–Q05/Q09, beginning account authority/activation, usage and cash definitions. All deletion work including Q06–Q08 stays deferred until requested. Do not start application implementation or claim simulated scenarios passed real E2E.


## Defer and hide deletion — latest owner request (2026-10-01)

- User: “เรื่อง ลบข้อมูล ให้ข้ามไปก่อน และ hide fetaure นี้ไว้ ส่วน gap bug คุณปิดมาแล้วหรือยัง”. Explained that remedies are specified but application bugs/gaps are not fixed; prior no-code constraint still applies.
- Active screens: EX-01–04 and EX-07/08. EX-05/06, case history/API06 case projection, API11 executive integration, API12, R12–14, S6/S7 and Q06–08 are DEFERRED, not CLOSED.
- Local preview only: `DATA_RIGHTS_ENABLED=false`; shared `availableRoute` guards initial state, host state events, navigation and persistence. Menu, company case history/actions and account deletion permission labels are absent. Company history is now “ประวัติบริษัท”. Existing operator module is untouched.
- Audit status: 22 OPEN_NOT_IMPLEMENTED (G01–05/G11–24/G26–27/G35), 13 DEFERRED_DELETION (G06–10/G25/G28–34), 0 CLOSED_VERIFIED. Mixed G35 retains report/account scope.
- QA preserves 188 baseline IDs: 47 deletion cases deferred, 141 retained/narrowed report/account cases; J08–J12 deferred. Four additional local HIDE checks are separate from baseline.
- Build: `node build-preview.cjs` PASS; inline fragment 446781 bytes. Wrapped with visualize `scripts/render.py ... --force`.
- Browser: `node check-demo.cjs` PASS. HIDE-01–04 cover admin/reader, companies MM003/MM006/MM011 with prior cases, all three hidden routes both on host event and initial persisted load. Existing report/account/input/dropdown/month/error/permission/theme checks pass; widths 1440/1024/768/390/320 and dark OS; no page errors.
- Visually inspected `company-history-hidden-deletion.png` and `mobile-v2.png`; no deletion controls or case data displayed. Existing `request-hold-v2.png` is historical, not the current interface.
- No application code, API, DB, package.json, cloud, existing operator permissions or live data changed. Prior 58 BE tests were not rerun in this presentation-only turn.
- Next: keep deletion hidden; discuss active decision gates when requested. Fixes require implementation and real regression evidence before any G is closed.

Documentation verification: PASS on 7 files/76 existing local links, table widths/fences/whitespace; 35 findings=22 OPEN+13 DEFERRED; 188 unique baseline case IDs=141 retained/narrowed+47 DEFERRED; 12 journeys/5 deferred and 4 HIDE checks. Scoped git diff --check PASS (new docs also checked directly).


## Receipt adoption charts and Pareto — 2026-10-01

- User requested color-coded clickable analysis charts, usage ordering, example72realcompanies/40everreceipt55.6%/32never44.4%, and80/20 Topspender. User answered async clarification: payments to Mangmee minus refunds.
- Added `docs/specs/mangmee-executive-usage-pareto-spec-th.md`; linked main UI/BE specs, plans, QA and audit. Receipt activity is expense-receipt successful capture, not billing `companiesWithReceipts`. Lifetime adoption versus selected-month ranking is explicit; Q03 source/inclusion coverage and detailed Q04 cash policy still apply.
- Local fixture78 total includes72 CUSTOMER,4 TEST,2 INTERNAL; excluded records intentionally high-value/high-usage to verify exclusion. All current overview/analysis/list/detail use same72eligible rows. Older12-company oracle is historical only.
- Added local-only `executive-analytics.ts` with receiptAdoption/rankCompanies/spendConcentration and `check-analytics.ts` checks. No app modules/contracts/schema changed.
- Receipt segmented chart: EVERgreen/NEVERblue/UNKNOWNgray; clickable marks and legends→matching directory with explicit cohort+sort. Industry/channel/seller group counts have stable colored bars with count/% drilldown. Usage top10 selector receipt/day/AI→company detail or all sorted companies.
- Pareto: net cash to Mangmee, Top20 ceil(N*.2) over eligibleN; shares use positive net weights with signed/negative disclosure; null cash blocks exact groups. Native accessible segment/legend and prefix80 actions. Fixture: top15=204930baht/83.4%; prefix13=198950baht/80.9%; rest57. Total245806baht.
- Directory gained receipt/spend filters, sort and12row local paging; resetting list-only filters on chart drill fixes G22 in demo only. Detail Back retains page/cohort, analysis detail returns analysis. Saved state restores defaults for added fields and keeps deletion routes blocked. Active KPI now lower bound “อย่างน้อย38”.
- Browser first run caught analysis mobile min-content overflow. Fixed grid track minmax(0,1fr), min-width0 for content children and shorter80%action label; second full run PASS.
- Verification: `node node_modules/tsx/dist/cli.mjs <visual-dir>/check-analytics.ts` PASS; `node <visual-dir>/build-preview.cjs` PASS470390bytes; skill render wrapper PASS; `node <visual-dir>/check-demo.cjs` PASS. Browser covers72/40/32, all-page memberships/sums, Top15/prefix13/Rest57, usage sort, Back, source/credit, account/permission/field states, deletionHIDE01–04, overview1440/1024/768/390/320 and analysis1024/390/320, darkOS/no page errors.
- Visually inspected pareto-v3.png and pareto-mobile-v3.png. New screenshots overview-v3/analysis-v3/mobile-v3 also stored beside inline fragment. Default saved view remains overview; analysis opens via “ดูอันดับและ80/20”.
- Future checks: source reconciliation/backfill/coverage, query/snapshot/cursor/auth integration, receipt null/cash incomplete UI using dedicated backend fixtures. Current null-edge math tests are not backend or full unknown-state browser proof.
- No application implementation/dependency/package.json/cloud/live data changes. Deletion remains deferred and hidden. Next: discuss remaining current-source/policy gaps before real integration; preserve user no-application-code instruction.

เพิ่มเติมการตรวจ: category bar ผ่าน Enter, receipt legend ผ่าน Space; กรองร้านอาหารได้ฐาน14/EVER10(71.4%)/NEVER4(28.6%) และ directory10ตรงกัน; AI sort มาก→น้อยและเปิดอันดับทั้งหมดผ่าน. ลด follow-up preview เหลือ5ตัวอย่างพร้อมจำนวนทั้งหมด และใช้ category color mapping คงที่ตามkey

Documentation validation: 8 executive docs,89 local links, Markdown tables/fences/whitespace PASS; prior188 scenario IDs and47deferred preserved separately from chart extension. Final inline fragment470390bytes; prior58 BE tests not rerun because application code unchanged.


## Executive navigation and comparison UX — 2026-10-01

- User said too many headings/too much scrolling; requested UX thinking around executive questions, subpages/submenus and comparisons. Built concrete local navigation proposal; no application/backend implementation.
- Added `docs/specs/mangmee-executive-navigation-comparison-spec-th.md`; linked core UI/BE/chart specs and updated UI/BE plans, QA extension UX-01–12 and audit impact.
- Overview now4KPI+receiptadoption+3next-actions, no long tables/trend/ranking. Actual desktop1440 main785px. Sidebar one-level analysis group: usage/revenue/customers/compare; companies separate; accountmanagement separate. Mobile uses actual themed Select instead of wrapping all navbuttons.
- Usage tabs adoption/ranking; revenue cash/Pareto; customers industry/source/sales, with legalentity and credit views via existing themed selectors. All earlier report/cohort/Pareto and account abilities remain accessible.
- Compact month row, collapsible sharedfilter panel with visible selectedlabels/reset; directory search/sort visible, detailedfilters folded with cohort/context outside; demo role/status tools folded.
- Added A/B industry/discovery/referrer/company comparisons: common eligible population/period, count, cash, per-company cash, receiptcount/per-company, adoptionrate and activity; signed A−B deltas, pp for rates, null-safe unknown. Samegroup and invalidrestoredselection unavailable. Monthcomparison intentionally unavailable until complete prior-period sources exist.
- Comparison uses base company population while preserving reportfilters separately; drill side produces matching directory, list/detail/back preserve comparison selection. Restaurant14vsretail13: net58464vs54464; avg4176vs4189.54; receiptadoption71.4vs53.8, delta17.6pp. Raw and normalized metrics answer different questions.
- Persisted viewstate includes subviews/compareA-B; legacyanalysis withspend cohort→revenue/Pareto elseusage. Initial and hostevent migration identical; deletionroutes remain normalized tooverview. Newview/month route changes never create data mutations.
- Local `check-demo.cjs` rewritten for current navigation; previous file preserved as `check-demo-v3-historical.cjs`, not runnable current acceptance. Existing puremath module unchanged.
- Browser PASS: compactoverview, focusedtabs/routes, 40company cohort/Top15/prefix13 memberships and sums, Back/page/sort, comparison math/swap/same/null/drilldown, filtervisibility/base separation, accountvalidation/create/status, allnewreport permission/loading/error states, legacyhoststate migration/deletionhidden, desktop/mobilemenu and sharedcontrols/theme.
- Layout allnewpages1440/1024/768/390/320 noouteroverflow; screenshots overview-v4/comparison-v4/overview-mobile-v4/comparison-mobile-v4. Visually inspected overviewdesktop+mobile andcomparison desktop. Currentfragment490930bytes.
- Additional initial persisted legacy routes, saved comparisonselection and companywithpriorcase history checks added to current harness. Record final completion below.
- No changes in apps/packages/dependencies/package.json/cloud/live data. Original no-application-code constraint persists. Deletedfeature stays hidden;22applicationfindings remain open/13deferred. Next: review UXproposal, then close actual source/permission/comparison contracts before implementation.
- Final expanded v4 browser harness PASS (exit0), including initial persisted legacy/deletion routes and saved comparison/filter separation; no page errors. Documentation validation PASS: 9 executive docs/99 local links, tables/fences/whitespace, 188 baseline cases with47deferred preserved,12 UX extension IDs, fragment format/size490930bytes. Existing BE tests not rerun because application code is unchanged; these results verify the local demo and specifications only.


## Export Excel design — 2026-10-01

Status: design + local preview in progress; no application/API/XLSX file implementation
Scope: user requested Excel export UX; header action, report/subview context, all matching list pages, comparison A/B, company detail and optional company projection
Decisions: no new sidebar menu; replace report body with export preparation panel; same theme/controls; initial summary preset; no current-page-only option; company/detail single preset; compare excludes dormant global filters; real XLSX uses typed values/blank unknown/text IDs
Artifacts: new `docs/specs/mangmee-executive-excel-export-spec-th.md`; updated UI/BE/navigation specs, UI/BE plans, impact and QA; local preview TSX/CSS and new check-export harness
Source evidence: shared `apps/api/src/common/export/xlsx.logic.ts` supports one sheet/text+numeric/freeze only; billing history CSV is paginated and not a reusable all-company export contract
Open questions: Q01 grant export capability to executives, Q09 bounded row/byte/time caps and accepted scale, existing report source gates. Design recommendation only, no automatic permission grant
Next: build and browser verify export + prior journeys; record exact results. G stays22OPEN/13DEFERRED and XG01–04 not implemented; deletion remains hidden

Verification completed: `node build-preview.cjs` PASS516866bytes; visualize render wrapper PASS; `node check-export.cjs` PASS and `node check-demo.cjs` PASS on final fragment. Export checks cover all-page manifest40, Top15/prefix13, A/B27 with totals/averages, detail1, subviews/sorts, report-vs-list filter separation, overview4KPI including59 receipt-paying companies, empty/unavailable/roles, duplicate-click/ready/error/retry/expired/contextchange, shared dropdown keyboard and widths1440/1024/768/390/320 under light/darkOS. No page errors.
Initial export harness failed because the selector matched both the disclosure summary and the shared Select summary; narrowed to direct-child summary, then passed. This was a test selector issue, not an export product bug.
Visually reviewed export-comparison-v5.png and export-mobile-v5.png; same themed controls, readable text, contained horizontal table scroll. Final edits preserve their geometry; final test regenerated screenshots. export-overview-v5.png also available.
Documentation validation PASS10docs/113local links, table/fence/whitespace,12EXL IDs and fragment size/format; scoped git diff --check PASS. Export case IDs remain separate from188baseline/47deferred and UX12; no G closed.
Limitations: all-row manifests and preview values are local fixtures, not downloaded workbook verification. EXL10–12 actual HTTP/auth/snapshot/multi-sheet typed XLSX/limits/audit/shared-writer regression remain NOT_IMPLEMENTED. Existing application BE tests not rerun because app code unchanged. No package.json/dependency/cloud/live changes.
Next: user reviews export flow/presets; resolve Q01 default export grants/Q09 limits and existing source gates before real implementation. No additional menu/job/storage/email/scheduler added.


## Owner Excel Dashboard reference — 2026-10-01

User selected `outputs/company-infographic-20261001/company-receipts-dashboard-v4.xlsx` as export template. Supersedes v5 summary-only/optional-company/values-only proposals above; fixed2-sheet Dashboard/source with template-authored formulas and native Excel charts, green+gold, supporting calculation blocks below Dashboard and source metadata. No new export menu or generic workbook designer.
Inspected reference with bundled artifact-tool read-only: sheets ภาพรวม/รายบริษัท,72source rows A7:H78,26formulas,4 native charts(doughnut1/bar3); input receipt count sum130, EVER40/NEVER32; noformulaerrors. Rendered actual file and visually reviewed. Reference uses28Sep snapshot/all-status receipt records; retain current Q03 definition gate and never transplant130/33/7-day/30-day values into fictional30Sep demo. File SHA256 before/after04296d1455b7c216620e1a52409c52cd44201a6942f445e8879183492716eb05. No original workbook mutation/re-export or native GoogleSheet changes.
Read-only helper/render in ignored `.codex/outputs/executive-export-reference-20261001/`; no individual source names/contacts copied to docs or inline demo.
Updated Excel spec in place, linked UI/BE/navigation, UI/BEplans, QA/impact; API13 templateKey replaces includeCompanies, server selects templateVersion/hash. XG03 expands to charts/formula/cache/style/multi-sheet capability; no assumption current minimal writer meets it. Source values fixed; approved formulas update local workbook when edited, no external links or live writeback; formula-like user strings stay text. Filters don't silently change workbook-wide denominator.
Local preview v6 now displays2sheet manifest, sample green/gold Dashboard + source rows; adapted charts/cards by current report, calculator detail and metadata disclosures. Preview uses existing fictional source; it is not actual XLSX generation. No 100% donut for single company, no invented7/30day metrics, no deleted-feature data. Main app theme unchanged.
Verification: build527547bytes + skill render PASS; `check-export.cjs` v6 PASS withfixed2sheets,40/15/13/27/1scopes, source/sort/sharedfilterseparation, overview4KPIs, A/Bdelta17.6pp and unknown, detail, invalid/empty/roles/error/retry/expiry/contextcancellation,1440/1024/768/390/320 widths, keyboard and darkOS app-lighttheme. Prior `check-demo.cjs` PASS; no page errors. Visually reviewed `export-dashboard-v6.png`, `export-dashboard-mobile-v6.png`, and actual-reference readback. Previouscheck-export-v5-historical.cjs retained only as history.
Next: review template-derived UX, resolve original source/auth/limits gates, implement native XLSX only when authorized. EXL13–14 added integration acceptance; G findings:22OPEN/13DEFERRED and XG01–04 NOT_IMPLEMENTED remain. No application/API/dependency/package.json/cloud changes and no permission request introduced.

Final documentation/reference check PASS:10executive docs/118local links, tables/fences/whitespace,14EXL IDs, unchanged original workbook SHA256, fragment527547bytes; scoped git diff --check PASS.


## Email and phone correction — 2026-10-01

User asked why Excel omitted email/phone; corrected previous exclusion and added standard contact columns to report source sheets. Actual workbook updated as `outputs/company-infographic-20261001/company-receipts-dashboard-v5.xlsx`; v4 reference untouched. No new app/backend feature implementation.
Source: local `.codex/outputs/company-executive-20261001/summary-variants/native-final.xlsx`, รายบริษัท header7/emailS/phoneT, only inclusionflag=1. Match unique normalized company names; original v4 lacks stable IDs so2duplicate-name companies remain blank, no ordinal/first-match guessing. Three source email cells contain non-email text and remain blank with review color. Other source blanks retained. Final64 valid-format emails/61 phone strings,8email blanks/11phone blanks; contact scope72. EarlierGmail55/49counts are historical and differ from this later native snapshot with user edits.
Source IDs/evidence and matching details remain private in ignored `.codex/outputs/executive-export-reference-20261001/`. Reference is not overwritten. All61phone strings already contain10digits starting0 in savedXLSX; no inferred prefix was added. Source/contact files not copied into tracked docs or inline preview.
Builder artifact-tool `add-contacts.mjs`: appendI:J, theme headers/stripes, source/date/blank/review notes and yellow unresolved cells. Recalculate once before export; no new formulas. Review source duplicates were initially caught before editing and narrowed to eligible rows; remained ambiguous and deliberately unfilled.
Verification `verify-contacts.py` PASS: all72originalrecords,26formulas/caches,4nativechart bindings/caches/exact colors/zero baselines, originalA:H andDashboardcells/formulas unchanged, keyDashboardstyles/merges/freezepanes preserved; every populatedcontactcell typedtext and matches staged evidence. Sourcev4SHA remains04296d1455b7c216620e1a52409c52cd44201a6942f445e8879183492716eb05.
Rendered modifiedsource areas and reviewed headers/wrapping/review colors. Artifact renderer drops leadingzero visually from numeric-looking strings despite @ format; read-only openpyxl verifies savedXLSX strings retainall61leadingzeros. No data mutation workaround applied for renderer. NativeExcel UI not opened; unchangedDashboard visual and dependentcalculations checks reused as permitted.
Spec UI/BE/Excel + QA/impact now include contactEmail/contactPhone with source/coverage and field-specificvalidation; EXL15 new integrationcriterion. Canonical backendcontactsource mapping stillopen beforeimplementation. Inline source preview adds fictionalexample.com/maskedphone columns only; no realcontacts inHTML.
Local preview build527837bytes andrenderPASS; `check-export.cjs` PASS includingcontactheaders/examplevalues and prior template/context/mobile/auth/errorchecks. Prior non-exportnavigation/appBE checks not rerun for2column presentation change. No application/package/dependency/cloud/live/contact-source edits.
Next (superseded by system-source clarification below): v5 contact evidence is from a Sheet and must not be treated as system data. Actual executiveAPI/Excel generation stillNOT_IMPLEMENTED and Gfindings22OPEN/13DEFERRED unchanged.

## Contact source correction: system records — 2026-10-01

Owner said “ของระบบเราสิ”, correcting the assistant's answer about Gmail/Sheet. Decision: report contacts must come from Mangmee system records joined by stable company/user IDs. Existing v5 and its 64/61 counts are historical Sheet artifacts, not system coverage or accepted system-source output. No workbook overwrite, live DB/cloud/Gmail read, application code or inline demo change this turn.
Read local schema, signup provision/onboarding, account-profile and admin partner-member projection. Company.email/phone and User.email/phoneNumber are separate; signup stores original contactEmail/phoneNumber. LINE signup can copy email into Company and eligible User, but signup phone travels to User. Existing account contacts can differ from new-shop signup; account edits clear/update User fields independently. Company email cannot inherit User.emailVerifiedAt semantics.
Open question Q-EXL-CONTACT sent with two options: latest owner account contacts (recommended for following up usage), or company contacts. Do not assume an answer or choose arbitrary OWNER; owner eligibility/ambiguity needs explicit mapping if that option wins. No app source integration or fresh workbook promised complete.
Artifacts: Excel export spec §9/9.1, linked UI/BE specs, QA EXL-15, impact note and this memory corrected. Existing G counts remain 22 OPEN / 13 DEFERRED.
Verification: local source tracing only; document consistency/link/whitespace checks recorded below. Runtime tests not applicable to documentation-only correction.
Verification result: focused Python check PASS for all 7 scoped docs, existing local link targets, whitespace/fences, explicit system-source fields and pending Q-EXL-CONTACT consistency.
Next at that turn (superseded below): resolve Q-EXL-CONTACT before finalizing the projection.

## Owner account contact decision — 2026-10-01

Owner answered the pending question: “เจ้าของบัญชีที่ใช้มั่งมี — ข้อมูลล่าสุดในบัญชี”. Q-EXL-CONTACT RESOLVED. Current User.email/phoneNumber are the source, joined via companyId → active membership → canonical active OWNER role → userId; no Company/signup/Gmail/Sheet fallback. This is a design/source decision, not live data access authorization or completed export integration.
Projection uses one distinct current owner or explicit NO_CURRENT_OWNER/MULTIPLE_OWNERS/SOURCE_UNAVAILABLE with null scalar contacts. RESOLVED can still have a missing individual email/phone; retain the other field. User account status and email verification are separate and cannot silently switch owner identity. One company remains one row; current contacts are materialized at report snapshot time, not reconstructed for a historical reporting month. §9.2 contains full rules and EXL-15(a)–(l).
Updated Excel/UI/BE/QA/impact docs and fictional demo labels/detail/source preview. Latest owner-account contact values are fictional in demo; actual application and XLSX v5 data are not replaced. No auth/signup mutations, dependency changes, cloud/live reads or backend implementation.
Verification: docs consistency check PASS (7 files, 97 local links, fences/whitespace, resolved decision/projection); demo build PASS 528681 bytes and render wrapper PASS. Existing check-export.cjs PASS with added exact owner-contact headers and MM001 detail/source agreement, retained export scopes/states/permissions and widths 1440/1024/768/390/320/theme/keyboard checks. EXL-15 system-source edge cases remain integration acceptance, not executed API evidence. No additional application runtime tests needed for docs and local presentation-only changes.
Next: integrate the agreed contract only when implementation resumes; verify EXL-15 against controlled system-source fixtures and live acceptance when authorized. G counts remain 22 OPEN / 13 DEFERRED.

## Plain-language review and main/develop handoff — 2026-10-01

Owner found “รายรับและ 80/20” confusing, then requested every executive-screen word be understandable to general users and authorized landing in main + develop. Scope remains specs/fictional prototype, not implementation of the unfinished system.
Changed navigation to รายรับ, tab to ลูกค้าที่สร้างรายรับสูง, chart to รายรับมาจากลูกค้ากลุ่มใด. Audited all active screens, account forms/states, comparison, filters, screen-reader labels and export preview. Removed technical words including Pareto/Top spender/Dashboard/production snapshot/OCR from displayed copy; explained 20%/80% in context, sales first-payment attribution, and percentage differences in plain Thai. Internal route/filter IDs and calculations unchanged.
Added plain-language source-of-truth spec and repository prototype sources, existing checks and a standalone preview. Customer workbooks/contacts and unrelated changes stay out of the diff. Source files use repo-relative dependency paths; no package.json change.
Working branch: codex/executive-copy-main-20261001, based on origin/main 9aad1fd2c; isolated managed worktree. Develop base observed e7d3ef1f3. Existing checkout had numerous unrelated changes and was left on its original branch. UAT/Production deploys are workflow_dispatch; no deploy or cloud operation requested/performed. Branch-protection API returns 403 (plan feature unavailable); do not infer bypass authorization, use normal PR/CI flow.
Verification: portable build PASS (535199-byte inline fragment); check-demo.cjs PASS (790px overview, preserved 40/15/13 company drilldowns and cash sums, comparisons, state restore, permission/account states, 320–1440px and theme); check-export.cjs PASS including owner contacts and all prior scope/state tests. Focused revenue copy/overflow checks PASS at 1440/390/320; reviewed the 390px screenshot. All 12 scoped Markdown docs have 142 valid local links. No forbidden UI wording found in the revenue view.
The first portable wrapper check exposed missing stored-view restoration; added the same local state bridge used by the inline host and reran the full check successfully. No calculation or backend change.
Delivery: submit this checked spec/prototype revision via separate main/develop PRs; record final PR/check/merge IDs in the local handoff memory and final response. Actual app integration remains unimplemented.

## Independent review and backend document amendments — 2026-10-02

Two independent reviews ran on 2026-10-01 against `origin/develop` `ae13970b0`: backend (RB-01–RB-42, `docs/research/mangmee-executive-spec-review-backend-2026-10-01-th.md`) and UI (RU-01–RU-30, `docs/research/mangmee-executive-spec-review-ui-2026-10-01-th.md`). This entry records the backend-side amendments that followed. Documentation only: no application code, no prototype code, no database, cloud, payment-provider or AI calls. Branch `claude/spec-reviews-20261001` in worktree `/private/tmp/mangmee-executive-review-20261001`; not pushed.

UI-side documents (UI spec and plan, navigation/comparison, plain-language, Pareto, Excel export, QA scenarios, prototype) are amended by a different agent in a different worktree and branch. They were not touched here. Backend contract changes that RU findings needed (RU-03, RU-05, RU-06, RU-08, RU-10–RU-13, RU-15, RU-17–RU-21) were applied in the backend spec.

Changed files:

- `docs/specs/mangmee-executive-business-backend-spec-th.md` — status v2, a “what changed and why” table citing finding ids, a renamed-contract table for the UI-side documents, rewritten §9–§17 and §20–§22, notes on §7, §8 and §18.
- `docs/plans/mangmee-executive-business-backend-plan-th.md` — new stage order, itemised S2 migrations/backfills, prohibitions, test strategy with CI registration, conditions before real use.
- `docs/research/mangmee-executive-business-be-gap-impact-2026-10-01-th.md` — dated section appended; nothing above it rewritten.
- `docs/research/mangmee-executive-current-code-bugs-2026-10-01-th.md` — new; bugs in today's code that stand on their own.
- `docs/research/mangmee-executive-spec-review-backend-2026-10-01-th.md` — status line only.

Main contract changes in the backend spec:

- API05/API06 use `:targetCompanyId`. Rule: no route under `system/` may name a parameter `companyId`, and the web must not send a customer `X-Company-Id`, because `AuthGuard` reads both as the caller's company (RB-01; same root cause as the live bug RB-40).
- The 15-minute snapshot is gone. A scheduled, re-runnable job (worker → `POST /v1/internal/executive/rebuild`) builds `ExecutiveCompanyMonth`, `ExecutiveCompanyProfile` and `ExecutiveReportBuild` (proposed names). They hold numbers and dimension codes only; owner contact is read live from `User`. Responses carry `build.id`; a stale `buildId` on a read returns `buildChanged: true`; only the export returns 409 `EXECUTIVE_SNAPSHOT_EXPIRED` (code name kept on purpose).
- Money comes from the existing billing settlement reader (`billing-settlement.service.ts`, `SCAN_PROVIDER_BALANCE` → `OBSERVE_PROVIDER_BALANCE`), counted once per provider movement id. `paid-invoice.ts` and `billing-schedule.ts` are never modified. `productKind` keeps the real billing values; `purchaseKind` is derived; paid add-ons are “not on sale”, not zero.
- Usage is computed from existing transaction tables (`ExpenseRecord.confirmedAt`, `AccountingDocument.issuedAt`, `AiUsageEvent` on `line-turn`). No event table, no producers. `AiTurn` is purged and cannot be history.
- Permissions `system.executive.read`, `.export`, `.contact.read`, `system.executive_user.manage`; roles `MANGMEE_EXECUTIVE` plus per-person add-on roles `MANGMEE_EXECUTIVE_EXPORT` and `MANGMEE_EXECUTIVE_CONTACT`; `SYSTEM_ADMIN` holds all four. All executive roles are platform-only and every endpoint also calls `assertPlatformTenant`.
- Accounts follow the sales-agent pattern (username + temporary password, forced change), are dedicated accounts, and suspension sets the platform membership to `SUSPENDED` and revokes sessions. No `commandId`/`expectedVersion`.
- One endpoint table API01–API15 (API13 export, API14 credential, API15 per-person access), `page`/`pageSize` (20/100), `sortBy`/`sortDir`, `planState` replaces `serviceStatus`, `entity` removed from v1, a full `reasonCodes` list, and an export data contract in §16.4.
- Audit rows `executive.report.read`, `executive.company.read`, `executive.export.created`, `executive.user.*` never carry a customer `companyId`. No environment feature switches.

Decided facts recorded (BE §21.3 D01–D08): deletion deferred and hidden; contact source is the owner account; an admin-assigned referrer after signup gives the salesperson no credit (RB-35 is intended, owner decision 2026-10-01); bugs RB-40, RB-36, RB-34, RB-38 are being fixed in a separate lane (owner, 2026-10-01); `paid-invoice.ts`/`billing-schedule.ts` are never modified; no environment feature switches; exactly one System Admin; plain Thai on screens.

Open questions: BE §21.2 Q10–Q36 (27 questions). The owner has not answered; each is written for the recommended answer, marked “ข้อเสนอ รอเจ้าของยืนยัน”, with the alternative and its cost. Q01–Q09 ids are unchanged and now act as group headings. Q35 (single-admin data-rights deadlock) and Q36 (sales credit differs from the sales spec in four places) are separate from the report work. Q06–Q08 stay deferred.

Corrections to the backend review found while writing the amendments (also noted in that file's status line):

- `CompanyOcrUsageEvent` rows are deleted when an admission is compensated (`company-ocr-governance.ts`), so the review's “no deleting code found” was wrong. They remain positive evidence only.
- Balance scans are created by an admin command but executed by the billing worker; an automatic schedule exists for provider event scans (`CONFIGURE_PROVIDER_SCANS`, default off), not for balance scans.
- A company-level web-entry source exists: `AuditLog` rows `auth.line.liff_session` and `auth.line_handoff.exchange` carry `companyId` (written fire-and-forget), already used by the admin partner timeline.
- `ReceiptUnitEntry` exists only for lot-bound receipt reads, so “receipt read succeeded” is not a v1 metric.
- CI runs API specs through three lists, not one: the `test` script in `apps/api/package.json`, `scripts/line-ai-whole-chain-acceptance.catalog.mjs`, and per-file `*.pg.spec.ts` steps in `.github/workflows/ci.yml`.
- Refinements: suspend by membership status instead of removing the role (RB-25); the Excel export grant is per person, default off (RB-05, following RU-20); manual package terms are shown as their own label in v1 instead of asking the admin to back-enter amounts (RB-12).

Verification: every amended file checked for existing relative link targets, balanced code fences, table column counts, odd backticks and trailing whitespace (`git diff --check` clean). No tests were run because no code changed. G counts in the application remain 22 OPEN / 13 DEFERRED / 0 CLOSED.

Next: owner answers Q10–Q15 first (they unblock S1 and S5), then Q16–Q34. The UI-side documents must adopt the renamed contract (BE “ชื่อในสัญญาที่เปลี่ยน” table). Before any real use: the legal review in BE §20.3, the one-off company classification, and the provider read-back, which needs the owner's go and the cloud runbook.
