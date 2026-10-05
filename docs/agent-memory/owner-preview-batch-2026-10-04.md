# Agent Memory: owner-preview-batch-2026-10-04

Status: **On Production since 2026-10-05 09:14 Bangkok** (`main` `2aa87ac68`, tree equal to develop `6ac6d8a63`); UAT serves the same source. The batch was assembled on `claude/owner-preview-20261004` from the owner's own check of a local stack on 2026-10-04 and the night of 2026-10-05, merged as #1002/#1003, and followed by one fix round (#1004/#1005) for two defects the owner found on UAT. The owner gave the UAT go and, after the fix round, the Production go; both are quoted under Decisions. What people still have to do after the release is listed under "Release record".

Owner: Controller (Claude) assembled, reviewed and verified; implementation by Codex lanes and, for the screen rounds of the last night, by Claude agents that looked at the real screen. The product owner decided the Production go and signed in himself for its acceptance.

Scope: everything the owner asked for while checking the local stack, on top of `develop` `f1d500a8a`.

- Expense review: one withholding block after the line list (decision, payee type, income category, rate, amount). The decision changes only when the user changes it; the rate may be empty while typing; a missing field stops ถัดไป and says what is missing.
- Withholding income categories: 12 kinds ACTIVE for every shop and 3 DRAFT, switched by Mangmee System Admin only (`/system/wht-income-categories`); migration `20261004120000_open_wht_income_categories`.
- Expense correction after confirmation: "แก้ไขเอกสาร" reopens a confirmed expense under the same number until it is posted to the ledger or a 50 ทวิ is issued; "ยกเลิกรายการจ่ายนี้" cancels an unposted payment with a reason; a payment date after today is refused; the 50 ทวิ print action stays reachable.
- Claims: the self-approval switch applies to every role at decision time; a duplicate receipt is found across requesters and blocks payment under BLOCK_PAYMENT; a payout date after today is refused; with payment evidence attached the reference number is not required (a cheque needs its number or evidence, a transfer needs its slip, cash nothing).
- Notifications: the bell, the list, the unread count and queued WEB/LINE delivery show only notices of modules the shop has; a notice the server calls resolved is not unread.
- Mangmee team note: one shared plain-text note per company (`20261004130000_company_team_note`), edited from the admin console and from the executive report with one editor; an optional third right on executive accounts lets an executive edit it.
- Executive report: month range with shortcuts (เดือนนี้ … ทั้งหมด, กำหนดช่วงเดือน), one status banner per page that names only months of the chosen period, KPI strips in one row, the churn figure ("เลิกใช้ (ไม่ได้ใช้ติดต่อกันเกิน 1 เดือน)"), figures as of the data date (receipts per company, recent use, packages found), a follow-up band, the company list as the owner's own sheet (nine columns, the other sheet facts in the opened row, ten a page), Excel for the applied period. Migration `20261004150000_executive_company_sheet_facts`.
- Taken out for now at the owner's word: the executive comparison page and the compare checkboxes (web only; the API is untouched, the old address opens the overview).
- From `main` only (#999–#1001, another session): the public Official OA flex replies and their isolated publication. Brought in unchanged so `develop` and `main` stay tree-equal; its unregistered spec got an owning runner and the W00 capability manifest was regenerated, because both left `main` red on the API suite and the whole-chain acceptance.

Decisions (owner, verbatim where quoted):

- "สวิตช์มีผลกับทุกคน" — claim self-approval.
- "แก้ได้จนกว่าจะลงบัญชีหรือออก 50 ทวิ" — correcting a confirmed expense.
- "ห้ามวันอนาคต" — payment dates of expenses and claims (sales-document receipts not changed).
- "แนบสลิปแล้วไม่ต้องบังคับเลขอ้างอิง" — claim payment reference.
- "เลิกใช้ 1 เดือน และต้องบอกด้วยว่าไม่ได้ใช้ติดต่อกันเกิน 1 เดือน"; distinct users are counted per month only.
- "ช่วงเดือน + ปุ่มลัด" — executive period.
- "มีช่องหมายเหตุในระบบเลย มีทั้งฝั่ง console และ ceo ให้ consistency กัน" — team note.
- 2026-10-05, on the executive screens: ten companies a page with paging; the top-right controls on one line; the opened row rebuilt; "หน้าจอเปรียบเทียบตรงนี้ใช้ยาก ให้เอาฟีเจอร์นี้ ออกก่อน รวมทั้งฝั่งทาง กดเช็คบ็อค เปรียบเทียบด้วย"; "ขยับ menu บริษัทลูกค้า มาไว้อันดับ 2".
- 2026-10-05, receipt counts: "นับที่มีอยู่ในระบบ" — the company sheet's receipt count, its 0 / 1–5 / 6+ group and the as-of figures count the uploaded receipts that are in the system on the data date; receipts deleted earlier are not counted. Before this every company older than the first report build carried "at least" for good.
- 2026-10-05: "หลังจาก แก้และทำทุกอย่าเสร็จแล้ว ก็ขึน uat ได้"; UAT acceptance is the automatic (smoke) one, chosen by the owner.
- 2026-10-05, scope freeze before UAT: "cut ของไปแค่นี้พี่ เรื่องที่ค้าง งานเล็ก อื่นยังไม่ต้องไป เพราะไม่ block เราลากยาวมานานเกินไปแล้ว ไม่ได้ขึ้น uat สักที".
- 2026-10-05, after his check on UAT: "แก้อันนี้ด้วย ต้องตอบเป็นการ์ด แล้ว เอาขึ้น uat หลังจากนั้น promote prod ได้เลย"; right before the Production apply: "พร้อม เริ่มเลย".

Open questions (none blocks UAT):

- Later the same day (2026-10-05) the owner had the small follow-ups below done: see `small-followups-2026-10-05.md` for what was fixed (the confirmed-duplicate payment by his decision, the screen items, the export column, the withholding word, the browser test, the note saved by an executive account proven on a screen) and what was left (future dates on sales-document receipts: not a sold feature).

- A claim whose expense is a CONFIRMED duplicate can still be paid (existing rule). The owner has not asked to change it.
- Future dates on sales-document receipts are still accepted; the owner's "ห้ามวันอนาคต" was applied to expense payments and claim payouts only.
- The refreshed approved-help card went live on source review alone, as the owner's 2026-09-27 decision allows; a model-backed evaluation needs a new budget approval.
- A withholding kind that was switched off reads the same as one never opened ("ยังไม่เปิดใช้งาน"): the server keeps only the status.
- The body of a resolved notification is the sentence written when it was created; the web no longer shows it as a pending request, the server still stores it.
- Screen items seen and left: an email shortened in its cell at 1280 px (full address in the link), a tenth column when the list is sorted by a fact outside the nine, a Thai word broken inside the two-line business-type cell, the mixed-unit header "จำนวน (จำนวน / บาท)" on unmatched money, seven paid-usage tiles leaving one alone on its row.
- Not proven on a screen: a note saved from the report by a real executive account that holds the note right (no such seed account; proven at the API and with a mocked answer in the browser).
- Follow-ups set aside when the owner froze the scope on 2026-10-05 ("cut ของไปแค่นี้ … ไม่ได้ขึ้น uat สักที"): `e2e/receipt-draft-continuity.spec.ts` (about lines 524–585) still pins the old withholding behaviour and will fail when Playwright e2e runs again (it is not part of the release path); the usage Excel still carries the cumulative column "ใบเสร็จสะสม" next to the in-system groups.

Artifacts:

- Branch `claude/owner-preview-20261004`; lane branches merged into it are listed in the commit history (`git log --first-parent origin/develop..`).
- Task notes of the lanes: `expense-withholding-ux-2026-10-04.md`, `wht-income-category-catalog-2026-10-04.md`, `expense-correction-after-confirm-2026-10-04.md`, `claim-self-approval-and-words-2026-10-04.md`, `notifications-only-owned-modules-2026-10-04.md`, `company-team-note-2026-10-04.md`, `executive-period-range-backend-2026-10-04.md`, `executive-design-v2-2026-10-04.md`, `approved-product-help-refresh-2026-10-04.md`, `seed-claim-approval-2026-10-04.md`.
- Release note and counts-only SQL: `release-readiness-2026-10-04.md` ("Candidate update 2", "Controller review of update 2", "Candidate update 3") and `docs/evidence/release-2026-10-04/`.
- Controller fixes found by running the whole thing: the void decides from the status it read (`51fb422dc`); a period comparison no longer holds the figure it is attached to — the overview answered 500 over HTTP while every spec passed (`078e4e74a`); the period sheet keeps clear of the phone's home indicator (`7d8e4a056`).

Verification: see the section at the end of this note.

Next: the steps for people under "Release record" (company labels first). The follow-ups the owner set aside stay parked until he asks for them.

## Verification (controller, 2026-10-05 06:52–06:57, final code head `e51e532f5`)

GitHub Actions has ended every pull-request run in `startup_failure` with zero jobs since 2026-09-25, so the gates were run locally with `scratchpad/integration-verify.sh` (the 17 steps CI runs): **all 17 exit 0** — contracts build, Prisma generate and validate, maintenance pins, migration review, config validation, DI, typechecks, unit suites, acceptance, harness, LINE-AI whole-chain acceptance, M01, P1, boot, `git diff --check`, and every registered real-PostgreSQL spec.

| Suite | Result |
|---|---|
| API fixed-list suite | 11,860 tests, 0 failed |
| Web (`src/**/*.spec.ts`) | 3,154 pass, 0 fail |
| AI gateway | 1,535 pass, 0 fail |
| Contracts | 350 pass, 0 fail |
| Config | 153 pass, 0 fail |
| Workers | 47 pass, 0 fail |
| Real-PostgreSQL specs | 457 pass, 0 fail |

Also run: the release's database phase on a production-era schema (see "Candidate update 3" in the release note); the read-only UAT preflight; the PRE SQL on UAT (exit 0: 266 migrations applied, 13 of this release pending, none unfinished).

Screen checks at 390 px and 1280 px on the local stack by agents that looked at the real screen: the executive pages and tabs, the claim payment form, the withholding block (found and fixed a dead end and a silent save), expense correction, the withholding-category admin page, the team note card, notifications. Playwright e2e was not run.

## Release record (2026-10-05, controller)

Operation ids, timings and the cloud findings are in `docs/runbooks/cloud-environment-operations.md`, "Release 2026-10-05". GitHub workflow ids: `NOT_DISPATCHED` (local Kamal path). Times are Bangkok.

- 06:58–06:59: #1002 → develop `8a4de3b35`, #1003 (twin, one sync commit) → main `69e8e5f21`; trees equal.
- 07:25: UAT round 1, operation `20261005T002032Z-8cf8f08c`, smoke acceptance, ACCEPTED_LINE_DEFERRED; 13 migrations applied.
- 08:37–08:42: the owner's check on UAT found two defects. A file with a Thai name would not open ("เปิดดูไฟล์นี้"): the storage refuses a download header that is not Latin-1, which the local storage accepts. The LINE answer to "รายการรออนุมัติ" arrived as text: the card lacked the proof the V2 delivery plan needs to send it as a card.
- 08:57: fix `24603fbd6`, 17/17 local gates on it; #1004 → develop `6ac6d8a63`, #1005 (twin) → main `2aa87ac68`; trees equal.
- 09:06: UAT round 2, operation `20261005T020153Z-ab52b619`, smoke acceptance, ACCEPTED_LINE_DEFERRED.
- 09:09–09:20: Production, operation `20261005T020935Z-c3166cc2`, promoted from UAT round 2 with no rebuild. Website ready 09:14:35; the owner signed in himself; 10/10 browser checks (identity, System Admin right, customers OPEN, serving live, sign-out, the session refused after sign-out); ACCEPTED_LINE_DEFERRED, signature verified. Production served `908e7aab` before it.

### Counts before and after (`docs/evidence/release-2026-10-04`, read-only transactions, exit 0 every time)

| Block | UAT | Production |
|---|---|---|
| P1 completed migrations; of this release applied / pending; unfinished | 266; 0 / 13; 0 → 279; 13 / 0; 0 | 266; 0 / 13; 0 → 279; 13 / 0; 0 |
| P2 companies (active), claims, claim payments, memberships | 30 (19 → 11, see the runbook: not this release), 18, 11, 54 | 87 (21), 9, 1, 97 — unchanged |
| P3 pairs to backfill | 0 → 0 | 0 → 0 |
| P4 missing catalog entries / missing rule pairs | 5 / 95 → 0 / 0 | 5 / 105 → 0 / 0 |
| P5 and Q3 stale approval tasks | 12 → 0 | 8 → 0 |
| P7 active System Admins (with an expired credential) | 2 (1) | 2 (1) |
| P10 and Q10 withholding catalog; expenses awaiting confirmation; certificates | 0 → 15 (12 active + 3 draft); 1 in 1 company; 0 | 0 → 15 (12 active + 3 draft); 11 in 3 companies; 0 |
| Q1 new tables / payout guards | 9 / 2 | 9 / 2 |
| Q2 missing destination / incomplete slip pointers / posting errors | 0 / 0 / 0 | 0 / 0 / 0 (9 claims submitted before the release) |
| Q4 companies with the manual-expense menu hidden and no setting row | 30 | 87 |
| Q5 and Q6 | all 0 | all 0 |
| Q7 label marker; customer / internal / unclassified (of them signup-linked) / invalid; executive rights; roles | 1; 10 / 1 / 19 (0) / 0; 5; 4 | 1; 22 / 1 / 64 (0) / 0; 5; 4 |
| Q8 builds; latest present; stale; FULL today; profiles; month headers; company months; mismatches | 1; 1; 0; 1; 30; 4; 79; 0 | 1; 1; 0; 1; 87; 5; 231; 0 |
| Q9 months before billing collection / with incomplete scan coverage / untied money / unsuccessful refunds / before the first build / revised; published daily scans | not recorded | 3 / 2 / 0 / 0 / 5 / 0; 0 |
| Q11 note table / rows | 1 / 0 | 1 / 0 |
| Q12 new rights / note role / required pairs / unexpected | 2 / 1 / 3 / 0 | 2 / 1 / 3 / 0 |
| P11 and Q13 companies with self-approval off; pending claims assigned only to their requester (frozen off) | 2; 0 | 0; 1 (1) |
| P12 and Q14 | all 0 | all 0 |
| Q15 sheet columns / profiles without sheet facts / company months without the history boundary | 6 / 0 / 0 | 6 / 0 / 0 |

Two support counts on Production after the release (counts only, same read-only session as the second PRE run):

- The one pending claim assigned only to its requester: its frozen assignee list names the requester, who is an active member and the only active member of that company, and it has waited more than 30 days. A frozen assignment lets the requester decide (`assignedBySnapshot` in `reimbursement-approval.use-case.ts`), so the every-role self-approval rule of this release does not strand it. Not read: whether that member's branch scope still covers the claim's branch, which the same rule also requires. No company on Production has the switch off today.
- Company labels: 64 unclassified (4 active, 60 not active; 36 have at least one expense), 22 customers (16 active, 6 not), 1 internal.

### Still to do by people (the release does none of these)

1. **Company labels.** 64 companies are unclassified. The executive report counts customers only, and while any company is unclassified its as-of figures read "at least". Classify them in the admin console (customer, test or internal). The hourly build picks up a label change for the current and the previous month; earlier months follow with the next day's first build.
2. **Payment-provider back-read**, which the owner authorised on 2026-10-02. Tell him before the session. Production has 2 live billing accounts and no successful balance scan yet.
3. **Publish the daily provider scan** (0 published schedules today).
4. **The first executive account**, with the export, contact and note rights only if wanted, after steps 1–3.
5. **11 withholding expenses in 3 shops** still wait for a person to review payee, category and rate. The release confirms none of them.
6. **The manual-expense web menu** is hidden for all 87 companies, old ones included, as the owner decided. System Admin turns it on for a shop that needs it.
7. **UAT hosts** are running; the owner decides when to park them.
