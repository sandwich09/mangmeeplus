# Main local QA fixes and regression — 2026-08-28

## Result and scope

All nine reproducible findings from the local main audit are fixed. The affected paths were exercised against local web/API and an isolated database, with backend state checks, full automated suites and a production web build. This is **not** a claim that every role, integration, policy combination or sensitive final action has passed.

- Source: main `0d96b01973ac465ee91d48f8c85dd51d71ef4b5c`, branch `codex/main-local-qa-fixes`.
- Company: `seed-local-company`; baseline stays **16 ON / 44 OFF** explicit feature switches. This is not the separate newly-onboarded default package or Bloom's broader legacy defaults.
- Local web `127.0.0.1:3000`, API `127.0.0.1:3003`, database `watchdog_main_qa_20260828`. Only isolated QA data mutated. No cloud, production deployment, feature activation, external messages or real financial transactions.
- No dependency, package.json, schema or backend policy changes. Original dirty `plan` worktree excluded.

## Fix acceptance

| Finding | Change and observed regression | Evidence |
| --- | --- | --- |
| F01 False posting success | Expense confirmation now says document confirmed, without claiming ledger posting. New EXP-202608-00049 remained posting=pending/journal=NULL, correctly reflected in UI. | [12](12-expense-confirmation-copy.jpg) |
| F02 Read-only branch controls | Finance can read branch list but has no create/edit actions; Owner retains them. Server authorization unchanged. | [09](09-finance-branch-read-only.jpg) |
| F03 Quotation self-approval | Submitter sees the reason and disabled approval; Finance approves another user's quotation and issues it. Draft quotation also no longer offers premature issue. | [08](08-quotation-self-approval.jpg), [10](10-quotation-other-user-issued.jpg) |
| F04 Duplicate category message | Duplicate create and rename both explain the duplicate name. New unique name and rename succeed. | [03](03-category-duplicate-create.jpg), [04](04-category-duplicate-update.jpg) |
| F05 Branch tax code | Create/edit reject short/non-digit values inline. Blank optional code creates successfully; valid 00005 saves on edit. | [01](01-branch-invalid-create.jpg), [02](02-branch-invalid-edit.jpg) |
| F06 Notification consistency | Successful reads leave the unread view and update the bell; failed read/dismiss/read-all preserve state and show errors. Bell and center synchronize after recovery. | [13](13-notification-read-removes-row.jpg), [15](15-center-read-all-failure.jpg), [16](16-notification-recovery-empty.jpg), [17](17-bell-failure-message.jpg) |
| F07 Sales wording/status | Customer-facing heading/description, Thai posting labels, and existing unapplied credit visible. | [07](07-sales-localized-status.jpg), [11](11-invoice-partial-overpayment-credit.jpg) |
| F08 Password guidance | Voluntary change has neutral guidance; forced-change copy and route guards retained. No password changed. | [06](06-password-voluntary.jpg), SSR regression tests |
| F09 Employee no-match | Search with no results no longer claims that the company has no employees. | [05](05-employee-filter-empty.jpg), [19](19-mobile-employee-filter.jpg) |

## Repeated local journeys

| Journey | Post-fix evidence/result |
| --- | --- |
| Navigation and role visibility | Owner20 and Finance14 observed navigation targets loaded with heading/loading/error checks; see [owner-navigation.json](owner-navigation.json) and [finance-navigation.json](finance-navigation.json). Read-only direct branch URL also tested. Runoff reimbursement creation remains disabled by baseline policy. |
| Quotation → invoice → payment | Owner submits137.50; Finance approves/issues QT-202608-00002; conversion issues INV-202608-00011. Payment50 → outstanding87.50; payment88.50 → paid137.50 plus unapplied credit1.00. |
| Income | Immediate400 with WHT12/cash388 creates INV-202608-00012 and REC-202608-00002; deferred225 creates INV-202608-00013 unpaid. Source branch SIAM retained. |
| Corrections | On INV-202608-00011: credit140 rejected against137.50; correct127.50 issues CN-202608-00002 for10. Debit125 rejected against new base127.50; correct132.50 issues DN-202608-00002 for5. [22](22-credit-note-issued.jpg), [23](23-debit-note-issued.jpg). |
| Receipt upload/review/confirmation | Synthetic PNG upload/preview, local OCR-unavailable manual fallback, category/classification and QA duplicate resolution → EXP-202608-00049 confirmed163.25. Confirmation copy matches pending posting. |
| Expense payment |63.25 partial → outstanding100; attempted101 rejected without mutation;100 succeeds → paid163.25. SQL corroborates status and amounts. |
| Manual expense | Fresh two-line60+40−5=95 draft on SIAM (`cmtcorc960000x2k19ko87384`); no receipt means no unsupported final confirmation. |
| Branch/category | Fresh QA branch created with blank tax code and edited to00005; invalid create/edit values blocked. Fresh expense category created/renamed; duplicate create/rename messages verified. |
| Employee draft | Required name/email and impossible31/02/1990 validation; valid data, STAFF role, QA branch as sole/default branch persisted through step4. Stopped before Finish/activation; no invitation sent. Credential-bearing final-step screenshot excluded. |
| Notifications | Three local fixture events, no delivery. Individual read, dismiss and read-all tested with API deliberately stopped; error state retained unread rows. API restored and retries succeeded. Bell mark-all failure/success and cross-surface refresh checked. |
| Evidence export | App export downloaded and opened read-only: one sheet,43columns,5records; new expense grand total/net due/paid163.25 and outstanding0 are numeric and match DB. Workbook range A1:J6 rendered legibly, no spreadsheet error cells found. Manifest JSON parsed with2entries; signed attachment links themselves not fetched. [21](21-export-success.jpg). |
| Mobile |390×844 sales and employee no-match views inspected; changed text readable without observed clipping. [18](18-mobile-sales.jpg), [19](19-mobile-employee-filter.jpg). Not a complete real-device/keyboard matrix. |
| Authentication | Owner/Finance password login and logout repeated. Staff still stops at legal prerequisite, with no acceptance fabricated. [20](20-staff-legal-prerequisite.jpg). |

## Automated checks

Executed in the isolated QA worktree (existing dependencies, no new test framework):

```sh
(cd apps/web && pnpm test)       # 1213 tests, 256 suites, 0 failed/skipped
(cd apps/api && pnpm test)       # full pretest + test, exit 0
(cd apps/web && pnpm typecheck)  # exit 0
(cd apps/api && pnpm typecheck)  # exit 0
# Local QA environment loaded; no production credentials:
(cd apps/web && NODE_ENV=production pnpm build) # exit 0
git diff --check                # clean
```

Focused backend accounting/expense/branch regression also passed103tests/21suites. New web tests cover branch validation/permission wiring, precise error mappings, quotation approval/issue guards, expense success copy, password variants, employee empty states, notification filtering and success-only change events. Some UI guard tests are source-contract tests; real browser evidence above supplies behavioral coverage for the changed paths.

## Explicit limits / next manual checks

- Do not merge main on an assumption of universal UAT approval. No production/UAT deployment or customer OPEN acceptance was attempted.
- Staff legal acceptance, actual account activation/deletion/password changes, final substitute certification/signature/issue and real LINE/OCR/email/push integrations require their real prerequisites and/or action-time human participation. None is reported passed.
- Initial audit additionally covered signature assets, unsigned substitute drafts, unassigned role creation, mixed VAT expense arithmetic, correction/billing flows and Bloom14 extra page-load checks. Not every one of those mutation/permutation checks was repeated after the fix; the full automated suites do not replace the missing UI cases.
- During the later repeat of the role page, one in-app browser tab crashed. A fresh tab loaded the page, then the controller refused further access under its browser URL policy. Stopped browser actions without bypassing the policy. Additional role creation and remaining UI permutations are **not passed**. The crash cause is not established as an application defect or a browser defect.
- Deliberate API outages produced expected errors; no claim of an entirely clean console/network log. Recovered API `/v1/health` returned statusok and web `/login` returned HTTP200.
- Repository evidence excludes passwords, environment files and signed download URLs. Local QA records are retained for reproduction.

Integration is limited to this fix branch → develop and a develop → main PR. Exact PR/merge results belong in the final handoff; main remains unmerged by this task.
