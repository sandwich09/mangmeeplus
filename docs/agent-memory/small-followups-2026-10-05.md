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

- Owner, 2026-10-05, D3: "แต่เราก็มีเตือนเรื่องใบซ้ำด้วยใช่ไหม" and "ห้ามจ่ายจนกว่าจะเอารายการซ้ำออกหรือยกเลิกใบเบิก และมีคำแนะนำด้วย อย่าปิดเงียบ". Announce confirmed blocks and remind the cancellation turn; exclude the confirmer, never add the owner by role alone.
- Owner, 2026-10-05, Round 4 counts: "นับเฉพาะใบที่จ่ายได้จริง แต่เราก็มีเตือนเรื่องใบซ้ำด้วยใช่ไหม". The summary tile "รอจ่าย N", "ยอดคงค้างรวม", the hub payment bucket and LINE aggregate "อนุมัติแล้วรอจ่าย" count only their existing population minus `duplicateBlocksPayment` on the submitted policy. Blocked payment-step claims remain counted and listed under “ติดรายการซ้ำ”; D2 fixes existing payment notices; the new confirmed-duplicate notices are D3.
- D2, controller brief 2026-10-05: confirmed-duplicate claims produce no payment reminder candidate or ready-to-pay event. Unresolved blockers retain the existing payment turn and receive a check-first sentence; void notices describe the post-void state. Company-admin conditions, recipients and cooldown are preserved; runtime wording and suppression do not depend on those conditions. Legacy events without the new facts retain previous wording. No new D3 notice.
- Owner, 2026-10-05 ~09:45: "ทำงานเล็ก ต่อ แต่ยังไม่ต้อง deploy uat prod ใช้ codex เหมือนเดิม".
- Owner, 2026-10-05 ~10:00, on a claim whose receipt a reviewer confirmed as a real duplicate and which could still be paid in full: "ก) ห้ามจ่ายจนกว่าจะเอารายการซ้ำออกหรือยกเลิกใบเบิก และมีคำแนะนำด้วย อย่าปิดเงียบ". The controller reads it as: under every duplicate policy; nothing already paid is reversed.
- Controller (the owner delegated screen design on 2026-10-04): with the contact pair shown, an extra sort column replaces the note column on a desktop instead of narrowing every text column. The first pass narrowed them and cut the package badges and put an e-mail on three lines.
- Owner, 2026-10-05 ~11:55, on the legal screen a new executive account passes at its first sign-in: "ก) ปล่อยไว้". The screen is the one every account passes (the executive spec already requires it, like sales accounts); two phrases on it are written for shop users ("พื้นที่ทำงานของร้าน" under the logo, "การยืนยันนี้ใช้กับบัญชีของคุณทุกกิจการ"). They stay as they are; the documents and the three statements were never in question.
- Left out on purpose: a payment date in the future on sales-document receipts. Sales documents are not in the packs that are sold (`focus-on-sold-feature-packs`).

Open questions:

- The business-type cell still splits some Thai compounds (สิน|ค้า, จัด|ทำ). The split comes from the browser's own Thai word list (the same library answers the same way outside a page), and the cell forces no break, so a layout rule cannot change it. Left.
- With the churn filter the list can carry more than one extra fact column and then scrolls sideways, as before.
- A claim blocked by a confirmed duplicate keeps its stored status. Round 4 D3 implements confirmed-duplicate notices for cancellable claims. Controller decision 2026-10-05: a PARTIALLY_PAID claim gets no new notice. It is a legacy state (claims are paid in one payment now), its way out starts with voiding the payments already recorded, and the block is shown with that guidance on every screen that shows the claim; inventing a second recipient order for it is outside what the owner asked ("อะไรที่ยังไม่อยู่ในขอบเขตก็ไม่ต้องทำ"). This separate follow-up remains:
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

#### Round 4 — lane dupc D2, 2026-10-05

Status: Implementation complete; focused checks and API typecheck pass. Uncommitted, ready for controller review. D1 accepted as `28ba338d2`; its two real-PostgreSQL tests passed according to the controller (not rerun by this lane).
Owner: Lane dupc, controller reviews/commits and runs full integration acceptance.
Scope: Existing payer reminders, every ready-to-pay emitter and requester payment-void notices. No migration, new notice, deployment or AI-gateway edit. Started 07:43 UTC; 45-minute cap is 08:28 UTC.
Decisions: Same submitted-policy duplicate predicate and reasons. Confirmed means no payer notice: remove its scan candidate and ready event at their source, independent of a copied/admin-edited rule's condition. Unresolved means the existing payer turn with check-first wording. Old events without the field keep today's output. Existing recipient preference/order, branch/permission/active-member checks, exclusions, web-only actors, severity, period and cooldown remain. Template resync preserves actual admin edits; runtime source-aware wording still fixes unresolved/voided sentences even when the admin changed the trigger key. Existing stored notices are not backfilled in D2; new confirmed-duplicate notices are D3.
Open questions: None for D2. Database/browser behavior not checked here (lane forbids database/network/server/browser work). No new PostgreSQL fixture; the controller's fallback-line trigger finding was read and respected.
Artifacts: `paymentNoticeFacts(tx, companyId, requestId)` rereads the claim with the pay queue's live candidates/own expense select and the transaction's company policy. `claimPaymentDuplicateBlock` calls the existing `claimDuplicateBlocksPayment`/`duplicateBlocksPayment` and `claimDuplicateReasons`. Ready events carry only `paymentDuplicateBlock`; a void carries `paymentVoidedNotice` composed from post-void status, cancellation state and those facts. No account, free-text reason or duplicate target enters the new fields. Contracts own all three notices' sentences/title. Specs §17.3 and the duplicate Round 4 continuation reflect these rules.

Emitter inventory (all call the same transaction helper):

1. Normal manager approval: `ApproveReimbursementUseCase` completion callback.
2. Payout-account reapproval: the same use case's `approvePayoutCorrectionAtomic` callback.
3. Payout submission with no approval: `SubmitPayoutCorrectionUseCase` persisted callback.
4. Initial submission with no approval/finance step: `SubmitReimbursementUseCase` policy completion callback.
5. Finance approval: `FinanceReviewReimbursementUseCase` finance completion callback.
6. Projection reconciler: MANAGER, FINANCE and POLICY replay completion callback.
7. Payment void: `PrismaReimbursementRepository.voidPaymentTrueReversal`, after rollup/mirror changes (existing notice only).

Verification:

Prefixes: `A`, `W`, `G`, `H` are defined above; `C` below is `pnpm --filter @watchdog-bms/contracts exec node --import tsx --test`. All test files were already listed in their package's test script. No whole suite, browser, server, docker, network or git mutation was used.

| New/changed test evidence | Old production red | Fixed production green |
|---|---|---|
| Payment scan: omit confirmed under every policy; open candidate/own unresolved retained; same payer preference; clear baseline unchanged | A `--test-name-pattern='D2:'` scan/action files: exit 1, 0 pass / 2 fail. Confirmed was offered and block fact absent | Full focused API command below passes |
| Every ready emitter: CONFIRMED emits no ready event; UNRESOLVED/NONE carries the field; other decision events and recipient fields stay | Initial emitter run exit 1, 0/30 (included one bad finance-test capture); corrected finance/helper red exit 1, 0/5. Final controlled baseline below proves every valid emitter case | Full focused API command below passes |
| Old/edited payer rules: legacy/NONE unchanged; UNRESOLVED title/body; CONFIRMED skip; changed trigger-key source bypass refusal; no larger recipient list | Controlled old runner fails every unresolved/confirmed child; clear/legacy invariants pass | Full focused API command below passes |
| Void outbox and old/edited requester rule: NONE, UNRESOLVED, CONFIRMED plus legacy; same requester-only list | Temporarily restored old repository/runner: exit 1, 2 pass / 7 fail; old void omitted the new field, edited rules printed “กลับไปรอจ่าย” through a block | Full focused API command below passes |
| Contracts post-void state: shared confirmed cancellation/remaining-payment-void guidance, unresolved clearance, clear waiting, still-paid and cancellation-in-progress cases | C `--test-name-pattern='D2:' src/business-policy.spec.ts`: exit 1, 0/1, old production has no state-aware function | C full file: exit 0, 7/0 |
| Existing exact ready payloads (reapproval, finance approval, no-approval payout) and exact scan query/payload now include the new fact | Each failed in final controlled baseline below | Full focused API command below passes |

Controlled final baseline: saved nine changed API production sources in memory, temporarily wrote `git show HEAD:<path>` contents by hand, ran the SAME seven-file focused command below, then restored every fix in `finally`. Contracts remained built with the new words so the old runner's ignored facts could be tested directly. Exit 1, **605 pass / 53 fail** (counts include parent subtests). Every changed behavior assertion failed; unchanged recipient/legacy invariants passed. No git restore/check-out command and no persistent backup files.

```sh
# Exact seven-file command, old and fixed production:
pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts src/modules/workflow/application/use-cases/workflow-action-runner.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts src/modules/reimbursements/application/services/reimbursement-projection-reconciler.service.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.payment-mirror.spec.ts
```

- Fixed seven-file command: exit **0**, **658 pass / 0 fail**.
- A `src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts src/modules/workflow/application/use-cases/workflow-action-runner.use-case.spec.ts src/modules/workflow/application/use-cases/workflow-event-ingest.use-case.spec.ts src/modules/workflow/application/use-cases/workflow-template-auto-enable.spec.ts src/modules/workflow/application/use-cases/workflow-template.use-case.spec.ts`: exit **0**, **189/0** (before the additional source-trigger-key subtests; final seven-file run covers those). Resync preserves edited rules and re-pins unedited ones.
- A five reimbursement files (approval, request, finance, reconciler, repository payment mirror): exit **0**, **523/0**. Earlier full runs exposed four stale exact expectations (scan query/payload and three ready payloads), corrected before the final baseline/green proof.
- C `src/business-policy.spec.ts`: exit **0**, **7/0**.
- W `src/features/dashboard-notifications/dashboard-notifications.logic.spec.ts`: exit **0**, **12/0**. Old title/body sentences were searched across API, gateway, web and `e2e/` specs: only this web file and the already-run action-runner/event-ingest files matched.
- `pnpm --filter @watchdog-bms/contracts build`: exit **0** after the final title extraction too.
- H `pnpm --filter @watchdog-bms/api typecheck`: first exit **2**, raw Prisma policy allowed nullable branchId where the domain record expects undefined. Used the existing `toPolicy` converter; A `src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.payment-mirror.spec.ts` then exit **0**, **16/0**. Typecheck retry exit **0**.
- `git diff --check`: exit **0** on the final handoff diff.

Next: Controller reviews and commits the uncommitted diff, runs real-PostgreSQL acceptance/full checks and browser if needed, and integrates develop. D3 new confirmed-duplicate notices remain untouched. Finished within the 45-minute cap (before 08:28 UTC).


#### Round 4 — lane dupc D3, 2026-10-05

Status: Cancellable-state implementation and focused verification complete; PARTIALLY_PAID decided by the controller: no new notice (see above). D1/D2 committed by controller at 28ba338d2/97cd1670c. Start 09:24:53 UTC, cap 10:09:53 UTC. Changes uncommitted.
Owner: Lane dupc; controller owns commit, database acceptance and integration.
Scope: Confirmation notices, one reminder per confirmed-block period, unread resolution, personal-advance expense progress label, guide/specs. No migration, schema, package, gateway, paid-invoice or billing-schedule change.
Decisions: Expense repository emits a claim outbox event in the confirmation/audit transaction, calling D2 paymentNoticeFacts; no reimbursement use-case import in expenses. Idempotent claim event key and identical confirmation retry are read-only. Cancellable states from canTransition: DRAFT/PENDING_APPROVAL/APPROVED/FINANCE_REVIEW/READY_FOR_PAYMENT. Requester always selected except confirmer; finance fallback only when mayCancelReimbursement says requester cannot act, narrowed to a named eligible finance reviewer before all branch-eligible reviewers, never OWNER by role alone. Actor excluded everywhere. Two confirmation notice keys keep requester/fallback bodies separate. Shared contracts guidance, action severity, existing preferences/auto-enable patterns. Reminder clock/period is earliest live own confirmed candidate resolvedAt (D2 reader extended), deadline from submitted policy; no cancellation-in-progress reminder.
Open questions: Asked user asynchronously: PARTIALLY_PAID can receive payment but cannot CANCELLED-transition until payment voids. Should D3 reminder cover only presently cancellable states or ask payment-void recipients first? Leave that state undone until answered. No database/browser here; controller runs PG proof.
Artifacts: Catalog EVENT/SLA templates, bindings, zero cooldown, sibling switches, source-module gates; scan adapter; IMPLEMENTED/ALWAYS_DELIVERED/feature-key lists; three document notification state entries. Personal-advance progress adds exactly one sourceExpenses relation in its existing claim query and calls claimPaymentDuplicateBlock for the new optional fact; contracts labels it ติดรายการซ้ำ. PG test uses existing decidedClaim/projection fixtures, never inserts a fallback line.
Verification:
- Initial A --test-name-pattern='D3:' duplicate-resolve/document-state specs: exit 1, 0/3, old code omitted event/rollback and retained cleared notice.
- Initial A --test-name-pattern='D3:' runner/scan specs: exit 1, 0/14 (parent/subtests included); old recipient selection and scan failed. C --test-name-pattern='D3:' business-policy.spec: exit 1, 0/1 (old expense label).
- Initial W --test-name-pattern='D3:' user-guide.content.spec: exit 1, 0/1, old guide omitted new recipient/period rows.
- Six focused API files (duplicate-resolve, runner, scan, document-state, payment-mirror, expense-evidence-sources): exit 0, 197/0 before the additional named-finance preference assertion/progress read assertion. Contracts full business-policy.spec: exit 0, 8/0; contracts build exit 0.
- Named-finance preference red: A runner D3 pattern exit 1, 8/5. Removing configured actor exclusions red: same command exit 1, 7/6; runtime exclusion fixes it. Registration/progress old production restored by hand: A notification.logic/expense-evidence-sources D3 pattern exit 1, 0/2, then restored fixes. Final ten-file focused API run exit 0, 261/0; C full file exit 0, 8/0; W guide full file exit 0, 38/0. An earlier ten-file run was exit 1, 259/2 due to stale registration counts, now corrected. Web typecheck through H exit 0; API first run exit 2 (duplicate imports), retry exit 0. PG D3 pattern exit 0, 0/0/1 skipped, DATABASE_URL absent. git diff --check exit 0 so far. A ps diagnostic was refused with "operation not permitted"; not retried.
Next: Controller reviews/commits, runs the real-PostgreSQL D3 test and final-diff API typecheck (last scope guard was added during the check), and decides the PARTIALLY_PAID notice/void order. No response to that question; leave it undone. Finished before 10:09:53 UTC cap, no deploy.

D3 final controlled API baseline: saved eight production files in memory, wrote their HEAD (97cd1670c) contents by hand, ran the ten-file command below, restored every fix in finally. Exit 1, **240 pass / 22 fail**. Every new/changed API behavior test failed, including earliest confirmation/actor, all twelve recipient cases, both updated registration expectations, clearance resolution and expense fact projection. Contracts stayed built with the new words. No git mutation or persistent backup file.

```sh
pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/expenses/infrastructure/prisma-expense.repository.duplicate-resolve.spec.ts src/modules/workflow/application/use-cases/workflow-action-runner.use-case.spec.ts src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts src/modules/dashboard-notifications/infrastructure/document-notification-state.spec.ts src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.payment-mirror.spec.ts src/modules/expenses/infrastructure/expense-evidence-sources.spec.ts src/modules/workflow/application/use-cases/workflow-template-auto-enable.spec.ts src/modules/workflow/application/use-cases/workflow-template.use-case.spec.ts src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts
```

- Same fixed command exit **0**, **262/0**. Existing D2 payload/recipient tests and template resync/preferences pass. No whole suite.
- Scope invariant: restricting identical-confirmation retry to claim projections. Added a standalone-expense assertion to the D3 parent; it failed the too-broad first implementation (A duplicate-resolve D3 pattern exit 1, 1/1). Restored standalone expense retry conflict; claim retries alone are idempotent. Focused whole duplicate-resolve file exit **0**, **22/0**; final ten-file repeat exit **0**, **262/0**. This final scope guard was added while the API typecheck retry was running; its exact line is not checked by a compiler run started afterwards.
- Initial API H typecheck exit **2**, duplicate test imports (fixed); retry exit **0**. Web H typecheck exit **0** twice, including final guide edits.
- PG command: A --test-name-pattern='D3:' src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts: exit **0**, **0 pass / 0 fail / 1 skip**. Exact controller test: `D3: confirmed duplicate notice commits with confirmation, rolls back with it and retries once`. Real commit/rollback red/green **not checked**, DATABASE_URL absent. Uses existing decidedClaim helper/fallback line; no inserted first line.
- Changed-label search: `rg -l 'รอจ่ายคืน' apps/api apps/ai-gateway apps/web e2e --glob '*.spec.ts' --glob '*e2e*'`: no matching old expectations (rg exit 1); clear rows keep that label. No LINE-AI file change, so no manifest update required.
- Diagnostic `ps -axo pid,ppid,etime,pcpu,rss,command | rg 'tsc --noEmit|tsc.js|pnpm.*typecheck' | head -8` printed `operation not permitted` for ps; not retried. Pipeline exited 0; the diagnostic did not succeed.

D3 registration inventory: WORKFLOW_TEMPLATE_CATALOG (EVENT with two distinct notice keys, SLA_SCAN with one), DEFAULT_TRIGGER_CONFIG, DEFAULT_COOLDOWN_SECONDS (zero), FOLLOWS_SIBLING switches; requiredPermissions (none to configure; actor rights resolved at dispatch) and requiredSourceModules reimbursements; scan adapter; IMPLEMENTED_TRIGGER_KEYS, ALWAYS_DELIVERED_TRIGGER_KEYS and NOTIFICATION_TRIGGER_FEATURE_KEYS; DOCUMENT_NOTIFICATION_STATES for all three keys. New templates have no former names. Existing outbox drain accepts the reimbursement prefix/aggregate, and uses the existing reimbursement entitlement gate. Notice selection always excludes the confirmer even if an admin removes configured exclusions.

Item 4: existing personal-advance progress reader can load live own sourceExpenses in the same reimbursementLine/request query: exactly one added relation plus the policy snapshot scalar, no extra read. It calls claimPaymentDuplicateBlock; optional hasConfirmedDuplicate drives the shared contracts label. Paid expenses retain จ่ายคืนแล้ว.

Final D3 handoff: contracts build exit 0; contracts 8/0; guide 38/0; ten API focused files 262/0; API H exit 2 then 0, web H exit 0 twice; final git diff --check exit 0. No new LINE-AI files, full suites, network, servers, browser, docker, schema, migration, dependency or package changes. Controller must check the real database transaction and compile the final scope guard; neither is claimed checked here. All files remain uncommitted.
