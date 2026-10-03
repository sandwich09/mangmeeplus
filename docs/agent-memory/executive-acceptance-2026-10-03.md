# Agent Memory: executive report — browser acceptance on a seeded local stack

Status: Done 2026-10-03. Branch `claude/executive-acceptance-20261003` (from the program head `3ddcf09f7`), not pushed. Eleven small defects fixed in eleven commits (tests red then green) plus an e2e spec; bigger findings listed below for the owner/controller. The Excel export was not part of this check.

Owner: browser-acceptance lane of 2026-10-03; the controller reviews, pushes and merges.

Scope: the System Admin's executive-account pages (E1/E4a) and the report labels on the partner pages (E4a); the executive's whole journey (sign-in, forced password change, legal release, landing, menus, denied URLs) and every report screen and state of E4b (UI spec §5–§8, §11), at 390 and 1280 px, on a throwaway local stack (Postgres/Redis/MinIO containers, API + `next dev`) with fictional data written the way the read pg spec writes it, and the build run through `POST /v1/internal/executive/rebuild` with a local worker token. Billing ran in TEST mode with a made-up account id so the build reads the written money rows.

Decisions:

- Data, all fictional (`exa-*`): 23 customer companies in several states (active, suspended, disabled, archived), one test, one unclassified, the seeded demo shops as test and the platform as internal; business types, owners with `example.test` contacts, expenses, assistant questions, receipt reading from 10 Aug, billing accounts from 5 Aug, paid invoices, one balance scan 1 Aug–3 Oct, one untied August charge, a full and a partial refund, a disputed invoice, seller credits (one flagged), 23 lifecycle rows on one company. The first round's time was moved back to 25 Aug ("report running since"), so September is complete, August partial (usage before the first round, untied money), July money unavailable, October running.
- Labels were set through the partner pages (each company's overview card), not SQL.
- Fixes stay inside the executive screens: no API, contract or migration change; the one shared file touched is the `SystemHeader` path check. Wording that needs the owner (one sentence for a reason code used in two meanings) is listed, not changed.

Defects fixed (commit — what):

- `9a02646c1` + `fba31da06` — every in-page control of the report (filters, month picker, views, tabs, sort, paging, compare sides, swap, clear) changed the URL but not the page: the history calls passed Next's own `__NA` key, so Next 16 skipped the router update. They pass only the report's keys; the URL clean-up stays URL-only so a page opens with one read.
- `b98087f0c` — the executive account pages had no page container (flush to the screen edge at 390, to the sidebar at 1280, no `<main>`).
- `cc5edaf51` — the admin menu turned "ตั้งค่า LINE"/"…ค่า AI" into Thai on `/system/executive-users` too (bare path prefix).
- `a9313e82d` — all "เลือกเพื่อเปรียบเทียบ" toggles shared one id: tapping the words on any row picked the page's first company; the table checkboxes had no name.
- `45a465ac7` — the list wrote "อันดับการใช้ 1" under "999.00 บาท" when sorted by money; now "อันดับ".
- `697113e12` — Instagram ("IG", label equal to its value) showed as "ไม่ระบุ" in the channel filter, table, chips and compare.
- `61dc0162c` — the channel/seller tables and the compare table headed their first column "กลุ่มธุรกิจ"; compare differences were bare numbers.
- `fadacc3c0` — "· เชียงใหม่": a stray separator before the province when a company has no registered name.
- `2dd113207` — company detail: "ไม่มีสิทธิ์ดูข้อมูลติดต่อ" for a reader without the right (UI spec §8.1); the "อื่น ๆ" line only for the "other" channel.
- `6310b89d0` — detail and compare repeated the page's "หน้านี้ไม่ใช้ตัวกรองของรายงาน" sentence inside the content.
- `f3d2db78d` — e2e `e2e/executive-report.spec.ts` EXEC-01 (create executive → sign in → overview → drill → detail).

Open questions (left for the owner/controller):

- D3 wording: `HISTORY_BEFORE_COLLECTION` has one sentence, "ยังไม่มีข้อมูลของช่วงนี้ เพราะเป็นช่วงก่อนที่ระบบเริ่มเก็บ" (plain-language spec line 216). It is true for an unavailable figure (July money) and untrue next to a number: the adoption chart's "ยังประเมินไม่ได้" group (companies older than receipt reading), usage "อย่างน้อย" in August, and the partial AI cost of August, which also carries the money qualifier "ยอดเฉพาะรายการที่ยืนยันแล้ว" although nothing is unconfirmed there (the meter began on 12 Aug). Needs one sentence per meaning in the plain-language spec.
- D10: on a partial month the company detail repeats the month's two reason sentences under every one of its ~14 figures (long at 390); show the month's reasons once?
- D13: after a round builds a month that was missing, the open page shows it (after its reload-once) but the month picker still disables it until a full reload (the context's `builtMonths` is read once).
- D14: when the read right is removed and the page is reloaded, the `/system` layout shows the admin-console denial ("…ส่วนผู้ดูแลแพลตฟอร์ม", "กลับไปยังพื้นที่ทำงาน") to an executive; the report layout's own Thai denial is never reached. The same page answers `/sales/deals`.
- D16/D17 (minor): a drill with no condition shows an empty "เงื่อนไขที่กดมา … ล้างเงื่อนไขที่กดมา" row and a drilled condition shows twice; the company list has two toggles both named "ตัวกรอง · N" (report filters and list filters).
- By design (backend spec §886), the sentence "มีอีก 3 บริษัทที่จ่ายเท่ากับลำดับสุดท้ายของกลุ่ม" opens the list of all 4 tied companies, the group's last one included.
- D19 (minor): every account status badge is the same green, "ถอนสิทธิ์แล้ว" and "ระงับ" included. Sign-in while suspended answers the shared "บริษัทถูกปิดใช้งานหรือสิทธิ์ของคุณถูกยกเลิก…".
- Noticed outside the executive screens: the shared `ThemedSelect` `<summary role="combobox">` is not labelled by its `<label for>` (its accessible name is the selected value); the legal page shows "Secure business workspace", "LEGAL ACCEPTANCE"; "ชำระในเดือน: ชำระในเดือน" on the detail repeats its label as the value.

Artifacts:

- Commits above on `claude/executive-acceptance-20261003`; e2e spec `e2e/executive-report.spec.ts`.
- Lane notes, scripts, seed scripts, probe specs, logs and screenshots (not in git): `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/exec-accept/` (`NOTES.md`, `seed-report*.ts`, `probe-specs/`, `shots/final-*`).

Verification:

- Browser (Playwright Chromium, real login form, 390 and 1280): first pass while fixing, then the whole set again on the final code from an empty stack (`final-run.sh`, logs `final-run-part1/2.log` and `final-run.log`): every journey probe passed; 335 screens recorded with no sideways scroll and no page error; the words sweep (20 report views + 3 admin pages at both widths) found no code tokens, internal ids, Gregorian/ISO dates or bare 4+ digit numbers.
- E2E `e2e/executive-report.spec.ts` EXEC-01: passed on a freshly seeded stack (8.9 s) and on the full data set (exit 0); ad-hoc native `tsc` of the spec exit 0.
- Focused web specs, red then green per fix (logs `d*-red.log` / `d*-green.log`): final executive specs 40/40 + account specs 10/10.
- Web typecheck (native tsc via the shared helper, under the heavy lock) exit 0; whole web suite under the heavy lock without S3_* variables exit 0, 2845/2845, 572 suites, 0 skipped; `git diff --check 3ddcf09f7..HEAD` exit 0; maintenance pins `--check` exit 0 (no pinned file touched).
- No API, contract or migration change, so no API typecheck or pg spec was run.

Next: controller review; owner wording for D3 (and D10/D14); push with the program branch.

## Fixed after acceptance

Status: Done in this implementation lane, 2026-10-03; uncommitted diff ready for controller review. Focused checks, final locked typecheck, final locked whole web suite and diff whitespace check pass; browser acceptance belongs to the controller.
Owner: executive-polish lane; controller owns review, commit and browser acceptance.
Scope: state-aware reasons and measured-cost wording, detail reason references, refreshed month availability, executive denial, filter chips/toggle names, account status colours and shared field dropdown naming. No API read logic, billing, legal page, export, schema or dependency changes.
Decisions:

- Coverage is passed through every figure, adoption chart, ranking, company-list summary and spend reason renderer. The shared Thai API-message seam owns the three state-dependent historical reasons. All 38 contracted reason/sub-reason × partial/unavailable pairs are checked. Partial measured cost uses its own time-coverage qualifier; billing amounts keep their confirmation qualifier.
- Company detail deduplicates actual reason sentences once per page, including row-status reasons, and gives each affected figure a numbered link to its reason. Different sentences for unavailable and partial data remain separate; every figure retains its state words.
- A changed-build reload refreshes API01 with the same abort signal. The normalised query, rather than the context object's identity, controls report reads so a new builtMonths list does not cause a third report read. Refresh errors belong to the context, including denial and retry delay.
- The executive role identifies an executive-only session even after its read right is removed. This changes presentation/landing only; report access still requires the read permission. System and sales denial gates use the existing EXECUTIVE_ACCESS_DENIED words for those sessions.
- Drill chips omit ALL, empty and sort-only conditions and remove matching applied-filter chips by key and value. The two filter toggles name their own scopes. Account status labels and theme tones share one mapping: active/brand, waiting/amber, suspended/danger, revoked/slate.
- The dropdown fix is the one-line SelectField label forwarding change. AST audit found all 24 SelectField call sites have a label, with no aria-label override. Initial audit found 103 unnamed direct ThemedSelect sites including the wrapper; after the fix, 102 other direct call sites lack explicit aria names (some have surrounding labels). They are outside this scoped diff, including forbidden billing files; actual browser names there are not checked. Scope clarification was requested; no response received, so the stated minimal scope was retained.

Open questions: broader direct-ThemedSelect accessibility work needs controller scoping; no unresolved product decision in the executive fixes. Suspended sign-in's shared message and the repeated paid-in-month detail label remain as noted in the original acceptance, outside this brief.

Artifacts: scoped working-tree diff; updated `docs/specs/mangmee-executive-plain-language-spec-th.md` and `docs/specs/mangmee-executive-business-ui-spec-th.md`. No API/contract/schema/package.json, billing, legal-page or Excel-export edits.

Verification:

Focused red command: `pnpm --filter @watchdog-bms/web exec node --import tsx --test <file>`; green adds `--test-reporter=spec` before `<file>`.

| File under apps/web | Red on original implementation | Green |
|---|---|---|
| src/features/executive-reports/executive-reports.logic.spec.ts | exit 1; 19 passed / 3 failed (context refresh, reason states, chips) | exit 0; 22 passed / 0 failed |
| src/features/executive-reports/ExecutiveReportContent.spec.ts | exit 1; 15 passed / 4 failed (counted reasons, measured cost, repeated reasons, denial) | exit 0; 19 passed / 0 failed |
| src/features/executive-reports/ExecutiveReports.wiring.spec.ts | exit 1; 5 passed / 3 failed (context refresh wiring, denial gates, chip/toggle wiring) | exit 0; 9 passed / 0 failed after the added refresh-error check |
| src/common/auth/session-gate.logic.spec.ts | exit 1; 36 passed / 1 failed (executive session after read removal) | exit 0; 37 passed / 0 failed |
| src/features/executive-users/executive-users.qa.spec.ts | exit 1; 10 passed / 1 failed (status tones and all badge placements) | exit 0; 11 passed / 0 failed |
| src/common/components/field/ThemedSelect.spec.ts | exit 1; 1 passed / 1 failed (field label name at both selected values) | exit 0; 2 passed / 0 failed |

- The extra context-refresh error wiring test was added before its error handling: reporter=spec run exit 1, 8 passed / 1 failed, then exit 0, 9 passed / 0 failed.
- Strengthened reason-pair test, with the old reasonText production line restored for one run: reporter=spec run exit 1, 21 passed / 1 failed, listing all three changed pairs; restored fix exit 0, 22 passed / 0 failed.
- Independent repetition proof, with the old Reasons rendering line restored for one run: `pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec --test-name-pattern='company detail explains' src/features/executive-reports/ExecutiveReportContent.spec.ts` exit 1, 0 passed / 1 failed: the unchanged first-build sentence appeared 22 times instead of once. Restored fix, whole content file exit 0, 19 passed / 0 failed.
- Locked web typecheck: `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/web typecheck` exit 0, including the final repeat after strengthening the tests; route type generation succeeded and tsc emitted no errors.
- Locked whole web suite: the same heavy.sh with `pnpm --filter @watchdog-bms/web exec node --import tsx --test 'src/**/*.spec.ts'`, launched with all environment keys starting S3_ removed, exit 0; 2,858 passed, 0 failed, 0 skipped, 572 suites. Final repeat after strengthening the tests also exited 0 with the same counts (34.1 seconds).
- `git diff --check`: exit 0, no whitespace errors.
- Browser, e2e, live permission removal and real build refresh: not checked because this lane has no browser, servers, network or database.

Next: controller reviews/commits the diff and runs `pnpm exec playwright test e2e/executive-report.spec.ts` on the seeded stack with WORKER_INTERNAL_TOKEN set (otherwise the spec skips). At 390 and 1280 px, re-check August partial usage/adoption/cost, July unavailable money/cost, mixed company-detail reason references and all tabs, missing-month build becoming selectable without full reload (and one reload only), context-refresh failure/retry/denial, empty/sort-only/drilled chips, both filter-toggle names, four account badge colours in list/detail, combobox field names after changing selections, and executive-only denial on `/system/executive`, `/system/partners` and `/sales/deals` after read permission removal. Check an admin and a mixed session retain their prior gate behaviour.

## Browser re-check after the fixes (round 2)

Status: Done 2026-10-03 on the program head `13fd99c01` (fast-forwarded), plus one fix commit `0ca55cdca` on this branch; not pushed.
Owner: browser-acceptance lane; the controller reviews, pushes and merges.
Scope: the nine re-check items at 390 and 1280 px, on a freshly built throwaway stack with the round-1 data, the build run through the internal rebuild call. One September payment of each purchase kind was added, all fictional: a SCHEDULED_CHANGE payment; deals for a shop whose package was still running, a shop whose package had ended, and a shop that never paid.

Results:

1. Words, August and July on ten screens each (overview, companies, usage, ranking, revenue, top payers, customers, compare, detail usage and company tabs): no "ยังไม่มีข้อมูลของช่วงนี้…" beside a shown number; each one sits under "— ยังไม่มีตัวเลข". Partial figures read "ตัวเลขนี้ครอบคลุมเฉพาะข้อมูลที่เก็บได้ ช่วงก่อนเริ่มเก็บยังประเมินไม่ได้" or "ข้อมูลก่อนเริ่มทำรายงาน นับได้เฉพาะรายการที่ยังเหลืออยู่". AI cost: July "— ยังไม่มีตัวเลข", August "3.00 บาท (ยอดเฉพาะช่วงที่วัดได้)", September 6.00 บาท.
2. Company detail (August): each reason once, numbered 1–3, on all three tabs. The figures point to them through links named "ดูเหตุผลข้อ N" (7, 37 and 7 links).
3. With October's build rows deleted, the month picker disables October. After a build round and "ลองอีกครั้ง", October becomes selectable at 390 and 1280 without a reload, and picking it loads the month.
4. Read permission removed from the executive role: the open page and the report, partners, executive-users and sales URLs all show "คุณไม่มีสิทธิ์ใช้งานส่วนนี้", and the menu is empty.
   - Edge found and fixed in `0ca55cdca`: when the base role row itself was removed (export/contacts roles left), every URL fell back to the admin console's denial. After the fix, five URLs were re-checked, the workspace URL included.
   - A System Admin is unchanged: report, partners, executive-users and sales all open.
   - A mixed session (the seeded sales lead plus the executive role) is unchanged: report and sales open; partners and executive-users show the admin console's denial.
5. An empty pick and a sort-only pick show no "เงื่อนไขที่กดมา" row. A real pick shows its chip once. The toggles read "ตัวกรองรายงาน · N" and "ตัวกรองรายชื่อบริษัท · N".
6. Account status colours are the same in cards, table and detail:

   | Status | Background | Text |
   |---|---|---|
   | รอเปิดใช้งาน | #FFFAEB | #B54708 |
   | เปิดใช้งาน | #ECFDF3 | #15803D |
   | ระงับ | #FEF3F2 | #B42318 |
   | ถอนสิทธิ์แล้ว | #F2F4F7 | #475467 |

7. Every report dropdown's accessible name is its field label: overview, companies, ranking, sales view and compare.
8. September purchase groups:

   | Group | Total | Includes |
   |---|---|---|
   | ซื้อครั้งแรก | 6,938.00 | the never-paid deal, 4,444.00 |
   | ต่ออายุ | 7,414.00 | SCHEDULED_CHANGE 1,111.00, live deal 2,222.00, ended deal 3,333.00 |
   | อัปเกรด | 999.00 | — |

   Company histories show "ต่ออายุแพ็กเกจ" for the first three payments and "ซื้อแพ็กเกจ" for the never-paid deal. The deal payments carry no change-request row, so their time is the charge time, the reader's documented fallback.
9. e2e `e2e/executive-report.spec.ts` passed on a fresh seed (9.2 s), on full data (8.2 s) and on the final code `0ca55cdca` (11.5 s).
   - The round-1 journeys J1–J5 were re-run on this code and all pass: 378 screens, no sideways scroll, no page error. The words sweep is clean.

Decisions: `isExecutiveOnlySession` recognises any of the three executive roles or any `system.executive.*` permission. It still never applies with the admin role or with any permission beyond the report and the account. This changes presentation and landing only; the report still needs the read permission. Maintenance pins were refreshed (validator and workflow).

Open questions:

- A person holding both a sales role and an executive role lands after sign-in on the platform workspace page "ยังไม่มีหน้าที่คุณเปิดได้ในบริษัทนี้". From there, nothing leads to the report or the sales console.
  - This is the generic fallback of `resolveLoginLanding`, and this round did not change it.
  - The UI spec §3.1 defines only executive-only, admin and billing-only accounts, and Q12 makes executives separate accounts.
  - The owner decides only if such accounts are expected.
- Minor: the numbered reason links are 15–17 × 18 px at 390 (13.5 px text), inline after the figures.
- Minor, from round 1: "ชำระในเดือน: ชำระในเดือน" on the detail repeats its label.

Artifacts: lane folder (see above); round 2 screenshots `shots/r2-*`; logs `final-run2.log`, `r2-d20-red/green.log`, `e2e-r2-exec01-*.log`, `final-checks-r2.log`.

Verification:

- Session-gate spec red, then green: 36/37 (exit 1), then 37/37 (exit 0).
- Maintenance pins `--check`: exit 0.
- Web typecheck (native tsc, under the heavy lock): exit 0.
- Whole web suite (under the heavy lock, without S3_* variables): exit 0, 2858/2858 tests, 572 suites, 0 skipped.
- `git diff --check 13fd99c01..HEAD`: exit 0.
- The billing and build Postgres specs changed by the owner-answers commits were not run here; CI runs them at merge (`ci.yml` lines 797–803).

Next: controller review; take `0ca55cdca` into the program branch.
