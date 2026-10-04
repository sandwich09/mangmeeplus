# Agent Memory: owner-preview-batch-2026-10-04

Status: Batch assembled on `claude/owner-preview-20261004` from the owner's own check of a local stack on 2026-10-04 and the night of 2026-10-05. One pull request to `develop` and its `main` twin. UAT deploy authorised by the owner once the batch is merged; Production is NOT authorised.

Owner: Controller (Claude) assembled, reviewed and verified; implementation by Codex lanes and, for the screen rounds of the last night, by Claude agents that looked at the real screen. The product owner decides the Production go.

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

Open questions (none blocks UAT):

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

Next: merge to `develop` and `main`; UAT deploy by the local Kamal path with smoke acceptance (`docs/runbooks/uat-production-v2-deployment.md`, `infra/kamal/README.md`), then the POST SQL on UAT. Production waits for the owner's own go and sign-in.

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
