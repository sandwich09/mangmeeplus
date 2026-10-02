# Feature: Expense Ledger Auto-post with Accountant Exception Queue

## 1. Status

- Status: Approved for implementation
- Roadmap/checklist item: Follow-up to items 09 and 10
- Owner: WatchDog-BMS product owner
- Date: 2026-07-29
- Linked plan: [[plans/expense-ledger-auto-post-plan|Expense Ledger Auto-post Implementation Plan]]

## 2. Goal

Make the expense-to-ledger journey truthful and usable for both in-product accountants and external
accounting offices:

- Confirming an expense confirms the source document; it does not claim that a JV already exists.
- A company with `double_entry_ledger` enabled starts in manual-posting mode.
- A company may additionally enable guarded Auto-post for newly confirmed, clean expenses.
- Expenses with evidence warnings or accounting blockers remain visible in an accountant work queue.
- An accountant can fix the cause and retry without creating duplicate journals.
- Evidence exports warn but do not block when selected rows still need review.

## 3. Source Docs

- Expense capture: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Ledger: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]
- Known gaps: [[specs/finance-accounting-gaps-spec|Finance and Accounting Gaps]]
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Existing activation analysis: [[agent-memory/accounting-tax-plugin-path|Accounting and Tax Plug-in Path]]

## 4. Non-goals

- Auto-posting sales documents, procurement bills, or supplier payments in this phase. Reimbursement
  (claim) payouts were out of scope until the 2026-10-01 amendment in section 17.
- Bypassing evidence, account mapping, tax snapshot, branch, permission, or period-close rules.
- Automatically backfilling historical pending expenses when Auto-post is enabled.
- Public permanent evidence links or public folders.
- A bundled ZIP export. The first pass keeps XLSX plus an expiring evidence-link manifest.
- Changing journal accounting rules or introducing a new chart-of-accounts abstraction.

## 5. User Roles

- Finance: confirms expense source documents and resolves source-data warnings.
- Accountant: reads the evidence queue, manually posts or retries eligible expenses, reviews JV results,
  and runs an explicitly confirmed historical backfill.
- Owner: has the same accounting actions when granted by the current role/permission model.
- System administrator: enables `double_entry_ledger` and the separate per-company
  `expense_auto_post` entitlement.
- External accounting office: receives an XLSX index plus an expiring evidence-link manifest.
- Auditor readonly: reads evidence and posting status but cannot post, retry, or backfill.
- LINE/AI user: no post, retry, backfill, export, or configuration mutation.

## 6. Business Journey

1. Finance confirms a reviewed expense.
2. The system assigns the `EXP-*` number, locks the confirmed source, records the outbox event, and sets
   source posting status to `pending`.
3. The UI reports `ยืนยันเอกสารแล้ว · รอลงสมุดรายวัน`; it does not report that accounting posting is done.
4. If `double_entry_ledger` is disabled, the source remains pending and the UI explains that ledger is not
   enabled.
5. If ledger is enabled but `expense_auto_post` is disabled, an authorized accountant posts manually.
6. If both entitlements are enabled, a worker considers only expenses confirmed at or after the current
   Auto-post activation time:
   - clean evidence continues through the existing canonical journal generator;
   - evidence warnings stay pending for accountant review;
   - mapping, tax, account, or period errors remain actionable and retryable.
7. Successful generation creates the posted expense-accrual JV (`expense.record`) and updates the
   expense posting status.
8. The accountant can open the exact JV from the expense/evidence view.
9. Historical pending expenses are excluded from automatic processing. An accountant must preview counts
   and blockers, confirm, then run the bounded backfill action.
10. Each expense payment appends a separate immutable payment fact. The aggregate expense keeps only the
    cumulative paid/outstanding summary; it never owns the settlement JV state.
11. A payment may post independently after its accrual JV is posted. In Auto-post mode the worker scans
    new payment facts by their creation time; in manual mode the detail page selects the oldest pending payment.

## 7. Business Rules

### 7.1 Activation modes

| Ledger entitlement | Expense Auto-post entitlement | Mode |
|---|---|---|
| off | off | Ledger unavailable; confirmed source remains pending |
| on | off | Manual posting |
| on | on | Guarded Auto-post for newly confirmed expenses |
| off | on | Invalid configuration; server rejects it |

`CompanyFeatureEntitlement.updatedAt` for `expense_auto_post` is the activation boundary. Disabling and
re-enabling Auto-post establishes a new boundary; it never silently catches up older pending rows.

### 7.2 Auto-post evidence gate

An expense is not attempted automatically when any warning is present:

- no active linked evidence file;
- tax evidence status is `NEEDS_REVIEW`;
- tax evidence status is `NOT_TAX_EVIDENCE`;
- vendor name is blank.

Informational evidence states, such as `SUPPORTING_ONLY`, do not block Auto-post by themselves. Existing
ledger validation remains authoritative for chart accounts, posting rules, tax account determination,
currency, branch scope, journal balance, and open periods.

The evidence gate applies to the accrual source. A payment source becomes eligible only after the parent
expense is confirmed and its generated accrual journal is `POSTED`; it cannot clear a payable that has not
yet been recognized.

### 7.3 Manual queue and retry

- `pending` plus an evidence warning means `รอนักบัญชีตรวจ`.
- `posting_error` means an accounting attempt failed and must expose a redacted reason.
- The manual action resolves the next outstanding source from generated-journal truth: expense accrual
  first, then an eligible later expense-payment settlement. It does not infer completeness from the shared
  expense posting flag alone.
- Retry calls the existing canonical journal generator for that outstanding source; it never bypasses
  validation.
- Posting is idempotent per `(companyId, sourceType, sourceId)`. A retry returns the existing generated
  journal if one already exists.
- A closed period is a blocker, not an override path.
- Partial payments are cumulative and append-only. Each `ExpensePayment.id` is its own `expense.payment`
  source, posting status, journal identity, retry boundary, and reversal boundary.
- A claim-born expense cannot be settled through this path; it settles through `reimbursement.payment`
  (section 17).

### 7.4 Evidence and export

- The accounting-evidence view defaults to confirmed expenses.
- Voided expenses are available only through an explicit filter for audit work.
- Draft and rejected expenses are not part of the default accounting-office package.
- `ความครบถ้วน`, source-document status, and ledger posting status are separate UI concepts.
- Export with warnings is allowed after an explicit confirmation showing the warning count.
- The XLSX includes posting status, posting error code, and JV reference.
- The response reports total matched rows and whether the bounded export was truncated; no silent 500-row
  truncation is allowed.
- The external package remains XLSX plus JSON manifest with expiring signed links in this phase.

## 8. Boundary and Ownership

- Web owns truthful labels, evidence/posting filters, warning confirmation, manual post/retry, JV deep link,
  Auto-post feature explanation, and backfill preview/confirmation.
- Expense module owns evidence completeness inputs, source status, posting error, journal reference, shared
  evidence queries, and export contents.
- Ledger module owns canonical source loading, account/tax/period validation, journal generation,
  idempotency, posting status writes, manual retry, and backfill execution.
- System partner management owns the per-company `expense_auto_post` entitlement and dependency validation.
- Workers own bounded recurring calls to the worker-token-protected expense Auto-post drain.
- AI Gateway and LINE own no mutation in this journey.

## 9. Data Model

- Reuse `CompanyFeatureEntitlement(featureKey='double_entry_ledger')`.
- Add approved feature key `expense_auto_post`; it is disabled by default.
- Reuse its `updatedAt` as the new-document activation boundary.
- `ExpenseRecord.paidAmount`, `outstandingAmount`, `paymentStatus`, `paymentMethod`, and `paidAt` are a
  compatibility/read summary only. Recording a payment increments this summary under a serializable lifecycle
  lock and optimistic CAS; it never overwrites accrual `postingStatus`, `postingError`, or `journalEntryId`.
- `ExpensePayment` stores one append-only payment event with exact amount/date/method, actor, lifecycle status,
  and its own posting status/error/JV pointer. Existing paid expenses are migrated as one legacy payment source
  while preserving the old immutable `expense.payment` journal source identity.
- Compute the next outstanding source from the accrual journal and ordered payment events: accrual first, then
  the oldest `RECORDED` payment in `pending`/`posting_error`.
- Reuse `OutboxEvent` as durable source-event evidence, but do not treat its single publish status as a
  multi-consumer ledger queue. The worker scans authoritative pending expense and payment rows.

## 10. Permission and Audit

- Read evidence: existing `expense.read`.
- Export: existing `expense.read` plus `expense.export`.
- Manual post/retry/backfill: existing `journal.entry.create` plus `journal.entry.post`; source visibility
  remains company/branch scoped.
- Auto-post configuration: existing `system.partner_feature.manage`.
- Worker: least-privilege system context containing only journal create/post and required source reads.
- Audit:
  - feature entitlement change uses existing high-risk partner-feature audit;
  - journal generation uses existing high-risk ledger audit;
  - backfill preview is read-only;
  - backfill execution writes a bounded audit summary;
  - export retains its current audited action and adds warning/truncation counts.

## 11. API Behavior

Existing:

```text
POST /v1/companies/:companyId/posting/generate
```

- Remains the canonical manual post/retry action for the explicitly selected outstanding source.
- Requires `journal.entry.create` and `journal.entry.post`.
- Accepts only server-recognized source identity.

Add:

```text
GET /v1/companies/:companyId/posting/expense-backfill-preview
POST /v1/companies/:companyId/posting/expense-backfill
POST /v1/internal/ledger/expense-auto-post/drain
```

- Preview returns activation time, eligible count, manual-review count, blocker counts, and bounded sample
  rows for historical pending expenses.
- Backfill requires an explicit request and processes only eligible pre-activation expenses in a bounded
  batch. It returns posted, failed, skipped, and remaining counts.
- Internal drain requires the worker token, considers active companies with both entitlements, and processes
  only post-activation pending accruals and payment events. A payment waits for a posted accrual.
- All mutations remain idempotent and company scoped.

## 12. UI Behavior

### Expense detail

- Confirmation button: `ยืนยันเอกสาร`.
- Confirmed/pending: `ยืนยันแล้ว · รอลงสมุดรายวัน`.
- Ledger disabled: `ยังไม่เปิดใช้ระบบบัญชี`.
- Manual mode with permission: resolve the next outstanding source, then show
  `สร้างและผ่านรายการ JV`.
- Auto mode: `รอระบบลงบัญชีอัตโนมัติ`.
- Posting error with permission: show redacted reason and `แก้ไขแล้ว ลองลงบัญชีอีกครั้ง`.
- Posted: show `ลงบัญชีแล้ว` and the exact JV number/link.
- Show append-only payment history with amount, date, method, payment lifecycle, and per-payment posting state.

### Accounting evidence

- Default status is confirmed.
- First status column is labelled `ความครบถ้วน`.
- Add source status and ledger status columns/filters.
- Folder warning uses the actual count of expenses with active evidence.
- Export warning confirmation never blocks solely because warning rows are selected.
- Export result states exactly what was downloaded: XLSX plus an optional JSON evidence-link manifest.
- Truncated exports show matched/exported counts.

### Journal

- Add a compact generated-JV list using the existing list/detail APIs.
- An expense source deep link filters by `sourceId=<id>` and can show both accrual and later payment JVs.
- Report and period-close views remain available.

### Partner feature settings

- Show `expense_auto_post` as disabled by default.
- Explain that it requires `double_entry_ledger` and applies only to newly confirmed expenses.
- Server validation remains authoritative if the client submits an invalid combination.

## 13. Edge Cases

- Auto-post is enabled while ledger is disabled: reject the configuration.
- Ledger is disabled while Auto-post remains enabled: reject the configuration until Auto-post is disabled
  in the same request.
- Auto-post is toggled off/on: only rows after the new `updatedAt` boundary are automatic.
- An unrelated feature is changed while Auto-post remains enabled: do not rewrite the Auto-post entitlement
  or move its activation boundary.
- Worker and accountant post the same expense concurrently: idempotency returns one journal.
- Period closes after preview but before execution: generation fails closed and the row remains retryable.
- Two partial payments recorded concurrently: the lifecycle lock serializes them; a stale/overpaying request
  rolls back its payment row and aggregate update together.
- A substitute receipt marks an expense paid: approval appends only the remaining amount as a payment event;
  an already fully paid record gets no duplicate event.
- Voiding a paid expense reverses every posted payment JV and marks every payment event voided in the same
  transaction; unposted legs become `not_required`.
- Bank reconciliation treats every recorded payment event as a separate candidate with its exact amount,
  date, currency, and source id; it must not collapse partial payments back to the expense aggregate.
- Warning disappears after source correction: accountant retry or the next eligible worker pass may post.
- Export contains more than 500 rows: return explicit truncation metadata.
- Signed evidence links expire: UI explains expiry and allows package regeneration.

## 14. Acceptance Criteria

- [x] Confirm UI never claims that a JV exists before source posting status is `posted`.
- [x] Default accounting-evidence view/export includes confirmed expenses only.
- [x] Evidence folder completeness uses real active attachment counts.
- [x] Evidence UI separates completeness, document status, and ledger status.
- [x] XLSX carries posting status/error/JV reference and export truncation is explicit.
- [x] `double_entry_ledger` alone gives manual mode.
- [x] `expense_auto_post` cannot be enabled without ledger and is off by default.
- [x] Auto-post processes only clean, post-activation confirmed expenses.
- [x] Partial payments accumulate without overwriting accrual posting state and retain per-payment history.
- [x] Manual and Auto-post can post each partial payment independently after accrual posting.
- [x] Void reverses all posted partial-payment journals and terminalizes all payment events atomically.
- [x] Warning rows remain in the manual queue and are not silently discarded.
- [x] Mapping/tax/account/period failures are actionable and retryable.
- [x] Manual retry and worker races do not create duplicate JVs.
- [x] Historical pending rows require preview and explicit backfill confirmation.
- [ ] External-office export remains permission-checked at package creation and uses expiring evidence links.
- [ ] LINE/AI cannot reach post, retry, backfill, export, or configuration mutations.

## 15. Test Cases

- Unit: evidence Auto-post blocker classification.
- Unit: entitlement dependency and activation-boundary behavior.
- Unit: default confirmed evidence filter and real folder evidence count.
- Unit: export posting columns and truncation metadata.
- API: manual post/retry permission, idempotency, posting-error recovery, and branch scope.
- API: worker token failure, active-company check, entitlement check, and bounded drain.
- API: concurrent partial payments, overpayment rollback, substitute-payment creation, per-payment posting,
  period close blockers, multi-payment reversal, and independent bank-match allocation.
- API: backfill preview/run excludes post-activation rows and warning rows.
- Web: truthful confirmation copy, posting badges/actions, export warning confirmation, and JV deep link.
- Worker: repeatable job calls the internal endpoint and reports non-2xx failures.
- E2E: confirm expense -> pending -> Auto-post/manual post -> exact posted JV.

## 16. Resolved Decisions

- Accounting offices include both WatchDog users and external package recipients.
- Evidence warnings require confirmation but do not block export.
- Auto-post is enabled per company.
- Warning/mapping/rule/period exceptions go to accountant handling; manual actions never bypass rules.
- Retry is allowed after the cause is fixed.
- Auto-post applies to new documents by default.
- Historical pending documents require a separate previewed and confirmed backfill.

## 17. Amendment 2026-10-01: Claim Payouts (`reimbursement.payment`)

Until this amendment a recorded claim payout stayed `pending` until someone called
`POST /posting/generate` by hand: no worker drained it and no screen offered it (finance-gaps spec
GAP-02, follow-up (ก), never built). Period close then refuses for as long as one is pending.
Nothing about the accounting changes here. The journal still comes from the existing canonical
generator and its existing mapping; this amendment only makes the two existing modes reach it.

### 17.1 Auto-post mode

The drain selects a claim payout under the rules it already applies to an expense payment:

- the company has `expense_auto_post`, `double_entry_ledger` and `expenses` enabled;
- the payment is `RECORDED`, its posting status is `pending`, and it was created at or after the
  activation boundary (section 7.1) — a payout recorded before Auto-post was switched on is never
  picked up automatically;
- no generated `reimbursement.payment` journal exists for it;
- it waits for its accruals: every claim line has an expense record that is either `CONFIRMED` with a
  `POSTED` accrual journal, or a confirmed duplicate that needs none. A suspected duplicate, a missing
  expense record or an accrual still waiting keeps the payout out of the candidate set, so it stays
  `pending`; it is not attempted and marked as an error once a minute.

A frozen `reimbursement` family (an explicit disabled entitlement row) removes claim payouts from the
drain while expense sources keep posting. `reimbursement` is not a requirement of the drain itself.

A refused attempt marks that payment `posting_error`, and is not retried by the worker. Two rules
keep that mark honest (review 2026-10-01):

- It lands on a `RECORDED` payment only. A payment voided after the candidates were read keeps the
  status its void gave it (`reversed` or `not_required`) and is counted as neither posted nor failed.
- The journal table decides. The worker stamps `posting_error` first and reads the journal table
  after it, in one transaction; when a posted settlement exists (another run or an accountant got
  there first, or only the bookkeeping after the post failed) it stamps `posted` instead. The stamp
  holds the payment row, so no settlement can commit behind that read.

`ReimbursementPayment` has no error column. The reason is kept as a structured log line,
`ledger.auto_post.claim_payout_failed`, with the company id, the payment id and the failure code,
and it is shown again when an accountant retries from the screen.

A void needs no worker step, and the worker has none: voiding a posted payout creates and posts its
reversing entry inside the void transaction, and voiding an unposted one marks it `not_required`.
A voided payout is never a candidate, and a reversal is never left pending for a worker to post.

### 17.1.1 A post and a void of the same payout take turns

The generator reads the payment as `RECORDED` and writes its journal many queries later, so a void
could commit in between and leave a posted settlement on a voided payment. For a claim payout the
settlement is therefore one transaction whose first statement stamps the payment `posted` with
`status = 'RECORDED'` in its `where`. That row write and the void's own update of the same row take
turns, and whoever is second sees the other's committed result:

- the void is second: it finds the posted settlement and reverses it;
- the post is second: it finds a voided payment, writes nothing (no journal, no journal number, no
  stamp) and is refused with `reimbursement_payment_not_recorded`.

The journal number is reserved and committed inside the same transaction, so a refused or failed
settlement leaves no number behind. Two posters of one payout take turns in the same way; the second
is answered with the first's journal. Other sources keep their existing, non-transactional path.

### 17.2 Manual mode

- The accounting-evidence screen lists recorded payouts whose posting status is `pending` or
  `posting_error`, of any age, from the existing `GET /reimbursements/posting/pending` worklist, and
  posts one through the existing `POST /posting/generate`.
- The worklist is bounded: the endpoint returns at most 200 payouts, the oldest payment first, and
  the screen draws ten at a time with "แสดงเพิ่ม". At the limit the heading says these are the first
  200, not a total. Posting the ones shown brings the next ones in.
- The section is on the page from the start: one line while it loads, one line when nothing is
  waiting, and the reason with "โหลดอีกครั้ง" when the list could not be read. It never reports zero
  for a list it has not read.
- A row is labelled "ยังไม่ลงบัญชี" or "ลงบัญชีผิดพลาด", the same words the period-close check uses.
  Money in another currency is named in Thai; a currency code is never printed.
- It is shown to a user who may post to the ledger (`journal.entry.create` and `journal.entry.post`)
  and may read the worklist (`reimbursement.finance_review`). It follows the same presentation switch
  as the other posting buttons, so it stays hidden while the accounting screens are closed.
- A refusal stays on screen in Thai and the row stays listed for a retry.
- The period-close check `reimbursement_postings_complete` carries a `breakdown` of its three counts
  (unconfirmed claim expenses, pending payouts, failed payouts). The web names each kind that is
  pending and links to the screen that fixes it, and shows the checks when a close is refused.

### 17.3 The date a payout may carry

Recording a claim payment refuses a paid date that falls in an accounting period which is not
`OPEN` or `REOPENED` (a month with no period row yet is open). The answer is 409
`reimbursement_payment_accounting_period_locked:<month>`, the month taken from the paid date in Thai
time, and nothing is written: no payment, no payment number, no notice. The web tells the payer to
check the date, or to have the period reopened first when the money really left on that day. A replay
of a payment that was already recorded is answered as recorded. This is the rule expense confirmation
applies; before it a payout could be recorded in a closed month and then never be posted until that
month was reopened. A payout that already sits in a closed period is still refused with
`period_closed` when posted, and stays on the worklist.

The check is a read before the write, not a lock. The period close runs its checks and then updates
the period without one, for every source, so a close and a recording in the same instant are not
serialized.

### 17.4 Known limits (not changed by this amendment)

- A company on the `TH_SME_COA_V1` chart has no reviewed mapping for a settlement (cash or bank by
  payment method is still undecided work, chart bootstrap plan Phase 6). Its payout is refused with
  `posting_rule_missing`, no journal is created, and the payment becomes `posting_error`. The same is
  true of `expense.payment`.
- A claim line typed into the claim form carries no expense category, so on that chart its accrual is
  refused with `expense_account_unmapped:no_category` and its payout keeps waiting.
- The historical backfill (section 11) covers expense accruals only. A payout recorded before the
  activation boundary is posted from the screen.
- For expense sources (`expense.record`, `expense.payment`) the worker and an accountant posting the
  same source at the same moment still produce one journal, but the loser can leave the status flag
  at `posting_error`, and two posters can collide on the journal number; posting again corrects it.
  A claim payout no longer has this exposure (section 17.1.1).
- Auto-post readiness does not check the settlement mappings. A company could pass it and still have
  every payout refused; it fails closed.

### 17.5 Acceptance

- [x] A ready claim payout is posted by the drain; a payout that is not ready stays `pending`.
- [x] Auto-post never posts a payout recorded before its activation boundary, a voided payout, or
      one that already has a generated journal.
- [x] After posting, the claim's paid total, the payment, the settlement journal and the expense
      records carry the same amount, and the employee payable nets to zero.
- [x] After a void, the settlement and its reversal net to zero and the claim, its expense records
      and the payable read unpaid again; paying again leaves one live payment and one net settlement.
- [x] The screen lists pending and failed payouts and a refusal does not hide the list.
- [x] The period-close check names what is pending and where to fix it.
- [x] A post and a void of one payout, in either order and fired together, never leave a posted
      settlement on a voided payment; the second of two posters gets the first's journal.
- [x] A posting stamp never lands on a voided payment, and `posting_error` never stays on a payout
      that has a posted settlement.
- [x] A settlement that is refused or fails midway leaves no journal, no journal number and no stamp.
- [x] The worklist is bounded and drawn ten rows at a time.
- [x] A payment dated in a closed accounting period is refused at recording and writes nothing.
- [x] CI runs the candidate SQL and the row locking against PostgreSQL
      (`claim-payment-posting.pg.spec.ts`, job "Migrations and Boot", in a database of its own).
