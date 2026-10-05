# Agent Memory: small-followups-2026-10-05

Status: Complete on `claude/small-followups-20261005` (from `develop` `373477010`), verified locally, on the owner's local stack. Not deployed: the owner said to continue the small work with Codex and NOT to deploy to UAT or Production yet.

Owner: Controller (Claude) scoped each item from the real screen and the code, reviewed and ran everything; implementation by Codex lanes (`gpt-6.1-sol`, effort high; xhigh for the money rule); one Claude agent for a browser proof.

Scope: the follow-ups that were set aside when the scope was frozen before the 2026-10-05 release (`owner-preview-batch-2026-10-04.md`, "Open questions"), plus one money rule the owner decided the same morning.

- Executive report, company list: an e-mail address shows whole (it wraps before "@"); a sort fact from outside the nine columns takes the note's place on a desktop where the contact pair is shown, so the list fits its 974 px box at 1280 px and no other column is squeezed (the note stays in the opened row and on a phone card).
- Executive report, revenue, money not tied to a company: the header is "จำนวน" and each value carries its unit (รายการ, บาท, ใบ) in a slot of one width.
- Executive report, tiles: no tile alone on a row for four to eight tiles (four share one row from 768 px; seven or eight use four columns; on a phone the last of seven spans the row). Six stay 3 + 3.
- Executive Excel: the per-company sheet has ONE receipt count, the sheet's own "ใบเสร็จในระบบ (รายการ)", with the same qualifier as every screen; the cumulative column "ใบเสร็จสะสม" is gone (the first pass renamed it and left the same figure twice: seen in a file downloaded from the local stack). The fictional reference workbook uses "ใบเสร็จในระบบ" for its column, KPI and chart, and is regenerated.
- Executive account page in the console: the suspend button stands at the right end, with no divider left stranded when it wraps.
- Withholding kinds (Mangmee admin): a kind that is off reads "ไม่ได้เปิดใช้งาน", true whether it was ever on (the server keeps only the status).
- `e2e/receipt-draft-continuity.spec.ts`: the withholding journey follows today's block. Test only.
- Claims: a claim with a receipt confirmed as a duplicate takes no new payment under every duplicate policy, asked before the payment lock and under it, with its own reason and refusal. The claim detail and journey, both pay-queue layouts, the payment refusal, the API error map and the LINE claim answer say why and the way out for the claim's state, from one function in contracts (`reimbursementDuplicateBlockNotice`). Neither "ปลดรายการซ้ำ" nor the finance override is offered for it. Before the confirmation, on an expense that comes from a claim, the page says the claim will not be payable, must be cancelled, and that the confirmation cannot be undone. Nothing recorded is reversed; approval is not blocked. Spec: `docs/specs/reimbursement-approval-spec.md`. A second round, after a browser check on a real stack, made the other sentences true for a blocked claim: the badge reads "รอยกเลิก", the desk line and the timeline name who can cancel instead of "พร้อมจ่าย" and "กำลังรอ … บันทึกจ่าย" (claim page, lists, both pay-queue layouts, the LINE claim and backlog answers); the toast after voiding a payment says only what the reader can do next; the pay-queue table wraps the guidance and fits at 1280 px; the summary card reads "ติดรายการซ้ำ"; the duplicate override on a confirmed duplicate is refused with `duplicate_confirmed` before any write (it answered 200 and wrote a SUCCESS audit row while clearing nothing); a payment form opened before the confirmation reads the claim again and closes; the payout send-back is not offered on a blocked claim. A third round (controller, after the second browser check): both claim list reads load the claim's own duplicate expenses, so a list card reads "รอยกเลิก" too (the lists returned no duplicate reason and still said "พร้อมจ่าย"); the pay-queue line "อยู่ที่ …" wraps on a phone instead of being cut.

Decisions:

- Owner, 2026-10-05, Round 4 counts: "นับเฉพาะใบที่จ่ายได้จริง แต่เราก็มีเตือนเรื่องใบซ้ำด้วยใช่ไหม". The summary tile "รอจ่าย N", "ยอดคงค้างรวม", the hub payment bucket and LINE aggregate "อนุมัติแล้วรอจ่าย" count only their existing population minus `duplicateBlocksPayment` on the submitted policy. Blocked payment-step claims remain counted and listed under “ติดรายการซ้ำ”; reminders and a new duplicate notice are round D2.
- Owner, 2026-10-05 ~09:45: "ทำงานเล็ก ต่อ แต่ยังไม่ต้อง deploy uat prod ใช้ codex เหมือนเดิม".
- Owner, 2026-10-05 ~10:00, on a claim whose receipt a reviewer confirmed as a real duplicate and which could still be paid in full: "ก) ห้ามจ่ายจนกว่าจะเอารายการซ้ำออกหรือยกเลิกใบเบิก และมีคำแนะนำด้วย อย่าปิดเงียบ". The controller reads it as: under every duplicate policy; nothing already paid is reversed.
- Controller (the owner delegated screen design on 2026-10-04): with the contact pair shown, an extra sort column replaces the note column on a desktop instead of narrowing every text column. The first pass narrowed them and cut the package badges and put an e-mail on three lines.
- Owner, 2026-10-05 ~11:55, on the legal screen a new executive account passes at its first sign-in: "ก) ปล่อยไว้". The screen is the one every account passes (the executive spec already requires it, like sales accounts); two phrases on it are written for shop users ("พื้นที่ทำงานของร้าน" under the logo, "การยืนยันนี้ใช้กับบัญชีของคุณทุกกิจการ"). They stay as they are; the documents and the three statements were never in question.
- Left out on purpose: a payment date in the future on sales-document receipts. Sales documents are not in the packs that are sold (`focus-on-sold-feature-packs`).

Open questions:

- The business-type cell still splits some Thai compounds (สิน|ค้า, จัด|ทำ). The split comes from the browser's own Thai word list (the same library answers the same way outside a page), and the cell forces no break, so a layout rule cannot change it. Left.
- With the churn filter the list can carry more than one extra fact column and then scrolls sideways, as before.
- A claim blocked by a confirmed duplicate keeps its stored status. After the Round 4 counts decision, these follow-ups remain for D2 or later:
  - the payment reminders and their notices (`workflow-template-catalog.ts`: "รอคุณบันทึกการจ่ายเงิน", "พร้อมจ่ายเบิกจ่าย", "ใบเบิกกลับไปรอจ่าย") can still name it. Changing that touches who is notified and the reminder selection;
  - the void dialog: its guidance is true but circular for the person voiding (it tells the voider to void).
- The finance-review decision on a claim that is at the finance-review step with a confirmed duplicate is covered by unit tests only; it was not opened on a screen.

Artifacts:

- Branch `claude/small-followups-20261005`; lane branches `codex/small-exec-20261005`, `codex/small-wht-20261005`, `codex/small-dup-20261005`.
- Browser proof (local stack, 1280 and 390 px): an executive account holding the note right saves the team note from the company list and from the company page, the text survives a reload, the System Admin reads the same text in the console, and an account without the right has no edit control ("คุณอ่านหมายเหตุได้ แต่ยังไม่มีสิทธิ์แก้ไข"); a direct save by that account answers 403. This closes "not proven on a screen" of the batch note.
- Browser proof of the duplicate rule (local stack, 1280 and 390 px, seed shop owner): round 1 — the refusal, the guidance for each state, no "ปลดรายการซ้ำ" and no override on a confirmed duplicate, the warning before the confirmation (all passed, three findings: the badge and desk line still said "พร้อมจ่าย", the void toast, the table too wide). Round 2 — six of seven passed; the two left (list cards, the cut desk line on a phone) were fixed in the third round and seen again: the "mine" tab and the queue read "รอยกเลิก", the desk line stands on two lines, the summary card reads "ติดรายการซ้ำ", and the list API returns the reason `EXPENSE_CONFIRMED_DUPLICATE`.

Verification: see the section at the end of this note.

Next: merge to `develop` and `main`. No deploy until the owner says so; the next release needs a new UAT round and his explicit go for Production.

## How the lanes went

- `small-wht` (6 minutes): the status word and the browser test. The test had never been run; running it on a throwaway stack found four more things the product had changed since it was written (two toasts on a save, the counterparty list remembering a vendor's payee type between runs, ย้อนกลับ behind เพิ่มเติม, seeded income kinds for a person).
- `small-exec` (23 minutes): six items. The controller then reworked the extra-sort-column layout and removed the duplicate Excel column after looking at the real screen and a downloaded file, and reverted a class that changed nothing.
- `small-dup`: the first turn stopped after eleven minutes when the service answered "selected model is at capacity"; resumed on another model from its own diff and finished in 37 minutes. The controller tidied the sentence joins and one fallback sentence.

## Verification (controller, 2026-10-05 12:49–12:55, head `0dc66f10c`)

GitHub Actions has ended every pull-request run in `startup_failure` with zero jobs since 2026-09-25, so the gates were run locally with `scratchpad/integration-verify.sh` (the 17 steps CI runs): **all 17 exit 0** on the final code head. The same run was green at 11:27 on `fe99cb8aa` (before the second claims round) and at 12:32 on `2a68482c4` (before the third).

| Suite | Result |
|---|---|
| API fixed-list suite | 11,868 tests, exit 0 |
| Web (`src/**/*.spec.ts`) | 3,175 pass, 0 fail |
| AI gateway | 1,536 pass, 0 fail |
| Contracts | 351 pass, 0 fail |
| Config | 153 pass, 0 fail |
| Workers | 47 pass, 0 fail |
| Real-PostgreSQL specs | exit 0; the reimbursement compatibility job includes "a confirmed own expense blocks detail, queue and new payment under the real lock for every policy", which also asserts that both list reads return the confirmed-duplicate count |
| LINE-AI whole-chain acceptance | exit 0, capability manifest regenerated on the merged tree |

The first full run (11:13) was red on two older checks that pinned yesterday's behaviour, both corrected: the four-tile class in `executive-presentation.spec.ts`, and `claim-payment-posting.pg.spec.ts`, which paid a claim after its receipt was confirmed as a duplicate (now the payment is recorded first, which is still possible, and the worker posts it as before).

`e2e/receipt-draft-continuity.spec.ts`: 11 of 11 on chromium, three runs in a row, on a throwaway stack (own containers; database named `watchdog_bms` and bucket `receipt-remediation-…` as the spec's own safety checks require).

Seen on the owner's local stack at 1280 and 390 px: the company list with and without an extra sort column, the unmatched-money table, the withholding kinds page, the executive account page, a usage export downloaded and opened (60 columns, one receipt count).

### Round 4 — lane dupc D1, 2026-10-05

Status: D1 implementation complete, uncommitted on `codex/dup-counts-20261005`; focused checks and all three typechecks pass. Real PostgreSQL and browser acceptance not checked (lane has no database, browser or servers). No reminder or notice changes, no migration, no deployment.

- Tests first on old production: API Round 4 summary/hub 0 pass / 2 fail (8 instead of 2 payable; no blocked count); web Round 4 1 pass / 3 fail (approval invariant passed; hub/card/pay-count regressions failed); gateway Round 4 0 pass / 1 fail (missing duplicate clause); guide Round 4 0 pass / 1 fail (missing new card/chip explanation).
- Policy facts are adapted once by `claimDuplicateBlocksPayment`, which calls the unchanged `duplicateBlocksPayment` with `effectivePolicyForRequest`. Hub facts, row summaries, pay-queue rows, LINE summary and backlog use that adapter. Confirmed own duplicates block every policy; open candidates and unresolved own expenses block only the submitted `BLOCK_PAYMENT` policy. Approval figures keep their existing population.
- Hub: one extra minimal facts read per request, sharing scope and search; its ceiling is the scope's unpaid payment-step claims. Blocked ids split counts and `id in` / `id notIn` page filters. The `ponytail:` comment records an indexed eligibility projection maintained by the same domain predicate as the upgrade if that ceiling becomes too large. Six buckets sum to `all`; a row's server-supplied blocker fact selects the same bucket. The new chip always appears because all neighbouring chips do, including zero; the danger card appears only above zero.
- Contracts rebuilt after source changes and after every temporary old-code proof. No capability-manifest drift; no regeneration needed. Old wording was searched across API, gateway, web specs and `e2e/`; affected existing backlog/ERP/web wording specs were run too. No package, schema, migration, paid-invoice or billing-schedule changes.

#### Surface audit

| Surface | Before | D1 result |
|---|---|---|
| Hub payment card/chip/list and row bucket | Existing payment-bucket statuses, including duplicate blockers | Same population minus the predicate; blockers retained in the sixth bucket, with matching counts/search/scope |
| Pay-queue waiting count and outstanding total | Every queue row | Nonblocked rows only; duplicate card and full table retain blocked rows |
| Approval-queue summary | All approval rows and SLA flags | Unchanged; pinned before the fix |
| LINE summary and `reimbursement.get_summary` | Existing unpaid-approved statuses, including blockers | Same population minus the predicate, optional blocked count in Thai/English headline; the adapter forwards the complete summary unchanged |
| LINE claim backlog | Blocked payment-step claims still counted as payment, with confirmed-duplicate actor labels | Retained under the shared duplicate label/kind, preserving cancellation/void notes and overall totals |
| Dashboard cards/badges and `erp-dashboard-tools` health | Inventory/expense providers; confirmed expense-record outstanding amounts, no reimbursement claim-payment counter | Unchanged: a different record population, not a claim queue |
| `notifications.list_open_alerts`, notification bell/dashboard unread badges | Stored open notification events, not live claim counts | Unchanged: payment reminder selection, event resolution and new duplicate notice are explicitly D2 |
| Sidebar | Static reimbursement link, no claim-count producer | Unchanged; generic `badgeCount` rendering has no assigned reimbursement count |
| Expense list/review progress badges; income/expense ledger | A linked claim's stored progress label; expense/accounting amounts | Unchanged: single-record labels/accounting balances, not a claim waiting-payment number/list. A linked expense badge can still say “รอจ่ายคืน”; noticed for controller, outside D1 aggregates |

#### Commands and red/green evidence

Command prefixes below run from this worktree; paths are relative to the corresponding package. No `tsx` CLI, whole suite or server was used.

```sh
# A
pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec
# W
pnpm --filter @watchdog-bms/web exec node --import tsx --test --test-reporter=spec
# G
pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test --test-reporter=spec
# H (machine-wide lock)
/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh
```

| Tests | Old production result | Fixed production result |
|---|---|---|
| A `--test-name-pattern='Round 4' src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts`: LINE summary/backlog; frozen-policy hub split/search/row buckets | Exit 1, 0 pass / 2 fail | Both pass in the full focused file runs below |
| A request + `reimbursement-approval-backlog.use-case.spec.ts`: existing confirmed-duplicate backlog; six-bucket paging, own/empty scope, search counts, accepted bucket validation | Temporarily restored HEAD production files (including contracts), exit 1, 222 pass / 7 fail; each changed behavior expectation failed | Exact same two-file command, exit 0, 229 pass / 0 fail |
| W reimbursements logic + plain-Thai QA + API spec: pay totals/count; duplicate card/chip/filter; full pay table and approval cards; existing mixed flagged summary, split chips, chip layout/search expectations | Temporarily restored HEAD production, exit 1, 221 pass / 7 fail. Approval-only invariant passes old and new, as intended; API changes are fixture shape only | Exit 0, 228 pass / 0 fail |
| W `--test-name-pattern='Round 4' src/features/user-guide/user-guide.content.spec.ts`: new card/chip and payable figure explanation | Exit 1, 0 pass / 1 fail | Full guide/wording run below, exit 0 |
| G `--test-name-pattern='Round 4' src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts`: Thai/English blocked clause, absent/zero backward compatibility, invalid count refusal | Exit 1, 0 pass / 1 fail | Full formatter run, exit 0, 125 pass / 0 fail |
| A real-PostgreSQL hub tests (names below) | Not checked: no database; no red or green database proof claimed | Loader run exit 0, 0 pass / 0 fail / 2 skipped |

The controlled old-code runs saved current contents in memory, temporarily wrote HEAD production contents by hand, then restored all fixes in `finally` and rebuilt contracts. No git mutation command was used. Initial integration corrections were rerun: missing `findPolicy` in an older backlog mock (API request 217/1 and backlog/ERP 43/11), and stale chip expectations (web 226/2). These are superseded by the green runs below.

| Command (prefix above) | Actual result |
|---|---|
| `pnpm --filter @watchdog-bms/contracts build` | Exit 0, including rebuild after the final old-code proof |
| A `src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-approval-backlog.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts` | Exit 0, 354 pass / 0 fail |
| A `src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-approval-backlog.use-case.spec.ts src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.spec.ts src/modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-related-access.use-case.spec.ts` | Exit 0, 284 pass / 0 fail |
| A `src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-approval-backlog.use-case.spec.ts` (after final baseline restore) | Exit 0, 229 pass / 0 fail |
| W `src/features/reimbursements/reimbursements.logic.spec.ts src/features/reimbursements/ReimbursementPages.plain-thai.qa.spec.ts src/features/reimbursements/reimbursements.api.spec.ts src/features/user-guide/user-guide.content.spec.ts` | Exit 0, 265 pass / 0 fail |
| W `src/common/api/api-error-message.spec.ts src/features/reimbursements/reimbursements.model.spec.ts src/features/reimbursements/reimbursement-stranded-claims.qa.spec.ts` | Exit 0, 114 pass / 0 fail |
| W `src/features/user-guide/user-guide.content.spec.ts src/common/i18n/sold-features-wording.spec.ts` | Exit 0, 57 pass / 0 fail |
| G `src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts src/modules/line-ai/agents/semantic-turn-v2-approval-backlog.spec.ts` | Exit 0, 135 pass / 0 fail |
| A `src/modules/line-ai/line-ai-capability-manifest.spec.ts` | Exit 0, 4 pass / 0 fail, no drift |
| A `--test-name-pattern='Round 4\|counts every hub card as the rows its filter returns over all pages' src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts` | Exit 0, 0 pass / 0 fail / 2 skipped; no DATABASE_URL |
| H `pnpm --filter @watchdog-bms/api typecheck` | First exit 2: PostgreSQL fixture nested line carried invalid companyId; removed it. Retry exit 0 |
| H `pnpm --filter @watchdog-bms/web typecheck` | Exit 0 |
| H `pnpm --filter @watchdog-bms/ai-gateway typecheck` | Exit 0 |
| `git diff --check` | Exit 0 on final handoff diff |

#### Controller acceptance still required

Run with the controller's real test database and `REIMBURSEMENT_PG_GATE_REQUIRED=true`, using A and the same name pattern/file above:

- `Round 4: searched hub payment and duplicate_blocked pages match counts across frozen policies`.
- `counts every hub card as the rows its filter returns over all pages: company, own, related and branch-limited, with and without a search`.

Browser: verify hub card/chip/filter/search and pay-queue counts at desktop/phone widths, with mixed payable/blocked claims. Not checked here: no browser or servers allowed. Controller owns full verification and commit. D2 reminder selection/new duplicate notice remains unimplemented as requested; no unresolved D1 product decision.
