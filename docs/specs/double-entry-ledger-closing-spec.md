# Double-Entry Ledger and Period Closing Spec

## 1. Status

The pre-v5 item 10 baseline is ready/implemented as recorded in its plan. The 2026-07-31 Feature Entitlement Decoupling v5.1 VAT-close and posted-cash-evidence amendment in this spec is owner-confirmed and not yet implemented/verified.

Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10.

Active implementer target: Sonnet 4.6 or later.

Chart-master bootstrap, legacy compatibility, and existing-company application are specified separately in [[specs/chart-of-accounts-master-data-bootstrap-spec|Chart of Accounts Master Data Bootstrap Spec]].

## 2. Goal

Make WatchDog-BMS accounting-correct by generating balanced debit/credit journal entries from finalized business documents, then using the ledger as the source for General Ledger, Trial Balance, Profit and Loss, Balance Sheet, accountant exports, and period closing.

Document workflows remain user-facing. Double-entry ledger becomes the accounting source of truth after documents are finalized.

## 3. Non-goals

- Replacing quotation, invoice, receipt, tax invoice, expense, and payment workflows.
- Filing Thai tax forms directly without finance/accountant confirmation.
- Letting LINE edit journals, close periods, or post final ledger mutations.
- Complex consolidation, multi-book accounting, IFRS/Thai GAAP policy automation, or multi-currency revaluation in the first ledger pass.
- Payroll, fixed asset depreciation, manufacturing costing, marketplace settlement, and bank reconciliation detail beyond ledger-ready hooks.

## 4. User Roles

- Owner: reviews financial statements, close status, and high-risk corrections.
- Finance: reviews generated journals, creates draft manual journals when granted, and exports reports.
- Accountant: manages chart of accounts, posting rules, manual adjusting entries, journal posting/reversal, close/unclose, and accountant exports.
- Auditor readonly: reads ledger, journals, close history, reports, and audit trail without mutation.
- AI assistant user: asks for ledger-derived summaries through permission-checked read tools only.

## 5. Product Direction

The product now uses a double-entry ledger path:

1. Users create normal business documents on web.
2. Finalized accounting-relevant documents generate balanced journal entries.
3. Posted journal entries are locked accounting evidence.
4. Corrections use reversal, credit/debit note, void policy, or adjusting entry instead of silent mutation.
5. Financial reports derive from ledger entries, not ad hoc document totals.
6. Period close locks source document mutation and journal posting for the period.

Business documents still come first in UX, but ledger readiness moves directly after accounting/expense source documents.

## 6. References

- Accounting documents: [[specs/accounting-documents-spec|Accounting Documents Spec]]
- Expense upload: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Web workspace: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Platform config: [[specs/platform-environment-config-spec|Platform Environment Config]]
- Thai tax: [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
- SAP-compatible transaction tax/account determination: [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]]
- Chart of accounts CSV analysis: [[research/chart-of-accounts-csv-analysis|Chart of Accounts CSV Analysis]]
- Architecture: [[specs/enterprise-architecture-spec|Enterprise Architecture Spec]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Frontend guideline: [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## 6.1 Boundary and Ownership

Ledger owns:

- Chart of accounts and account report mapping.
- Accounting periods and close/unclose state.
- Journal entries, journal lines, posting rules, and generated posting results.
- GL, Trial Balance, P&L, Balance Sheet, and ledger export API contracts.
- Ledger close checks and close history.

Source modules own:

- Business document lifecycle, source document status, evidence attachments, tax-ready fields, customer/vendor snapshots, and payment facts.
- Source posting input contract and posting status fields exposed to ledger.
- Source mutation rules before item 10; after period close, source modules must call ledger period policy before mutation.

Auth/RBAC owns user identity, company membership, permissions, request context, and audit guard primitives. Data Model Core owns document sequence, branch, audit, outbox, and attachment primitives. Ledger must extend these instead of creating duplicates.

## 7. Core Rules

- Every posted journal entry must balance: total debit equals total credit in the same currency.
- Journal entries are company-scoped and period-scoped.
- Source document finalization creates generated journal entries through posting rules.
- Generated journal entries are locked after posting.
- Manual journal drafts are allowed with `journal.entry.create`. Posting/reversal is ACCOUNTANT/OWNER-only by default through `journal.entry.post` and `journal.entry.reverse`.
- Reversals create new journal entries; they do not mutate original posted lines.
- Period close blocks posting, voiding, and source mutation in the closed period unless unclose policy passes.
- Unclose requires high-risk audit and `ledger.period.unclose`.
- Chart of account code locks after first journal line reference.
- Ledger reports read journal lines and account mapping, not raw documents.
- All money calculations must be decimal-safe.
- Backend enforces tenant, branch, and permission scope; web checks are UX only.
- Generated posting status writes back to source modules only through source adapters/use cases.
- LINE can answer ledger summaries but cannot post, reverse, close, or unclose.

## 8. Chart of Accounts Seed

Use the local CSV analysis as the first Thai SME chart-of-accounts seed reference. Phase 1 should curate seed data from `docs/research/chart-of-accounts-csv-analysis.md`; it must not block on locating the original CSV file.

- 175 accounts.
- Code format `dddd-dd`.
- No duplicate account codes found.
- `Group1` is not reliable for financial statement class because revenue/cost/expense appear under `Group1 = Equity`.
- Derive account class from code prefix and normalized `Group2`.
- Normalize source typo `Service expesnes` to `Service expenses`.

Recommended class mapping:

```text
1xxx -> ASSET
2xxx -> LIABILITY
3xxx -> EQUITY
4xxx -> REVENUE
5xxx -> COST or EXPENSE depending on normalized Group2
6xxx -> TAX_EXPENSE
9xxx -> SUSPENSE
```

Recommended normal balance (per-row reviewed values, including the nine contra-account overrides, are governed by the Chart of Accounts Master Data Bootstrap Spec):

```text
ASSET, COST, EXPENSE, TAX_EXPENSE -> DEBIT
LIABILITY, EQUITY, REVENUE -> CREDIT
SUSPENSE -> DEBIT
contra overrides: 1130-03, 1420-02..1420-05 -> CREDIT; 4100-03, 4100-04 -> DEBIT; 5130-02, 5130-03 -> CREDIT
```

`9999-99 บัญชีพัก` must be a controlled suspense account, not a normal user-facing posting target.

## 9. Data Model Draft

### ChartOfAccount

```text
ChartOfAccount
- id
- companyId
- code
- nameTh
- nameEn nullable
- accountClass
- reportGroup
- normalBalance
- parentAccountId nullable
- isPosting
- isSystem
- taxCategory nullable
- cashFlowCategory nullable
- sourceGroup1 nullable
- sourceGroup2 nullable
- status
- createdByUserId nullable
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,code
- index companyId,accountClass,status
```

### AccountingPeriod

```text
AccountingPeriod
- id
- companyId
- periodKey
- startDate
- endDate
- status: OPEN, CLOSING_REVIEW, CLOSED, REOPENED
- closedByUserId nullable
- closedAt nullable
- reopenedByUserId nullable
- reopenedAt nullable
- closeNote nullable
- createdAt
- updatedAt
- unique companyId,periodKey
```

### JournalEntry

```text
JournalEntry
- id
- companyId
- periodId
- entryNumber
- entryType: GENERATED, MANUAL, REVERSAL, OPENING_BALANCE, CLOSING
- sourceType nullable
- sourceId nullable
- reversalOfJournalEntryId nullable
- status: DRAFT, POSTED, REVERSED, VOIDED
- entryDate
- postedAt nullable
- postedByUserId nullable
- memo nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,entryNumber
- unique companyId,sourceType,sourceId,entryType where source fields exist
- index companyId,periodId,status
- index companyId,sourceType,sourceId
```

### JournalLine

```text
JournalLine
- id
- companyId
- journalEntryId
- accountId
- branchId nullable
- lineNumber
- description nullable
- debitAmount
- creditAmount
- currency
- sourceType nullable
- sourceId nullable
- taxCode nullable
- createdAt
- index companyId,accountId
- index companyId,branchId
- index journalEntryId,lineNumber
```

Rules:

- Exactly one of `debitAmount` or `creditAmount` must be positive per line.
- Zero-value lines are not allowed.
- Entry totals must balance before POSTED.
- `currency` starts as `THB`; multi-currency detail can follow later.
- Manual-journal create and post resolve every account server-side. Each account must be active, posting-enabled, and either owned by the request company or an approved global system account (`companyId = null` and `isSystem = true`).
- Every non-null manual-journal branch must be active, owned by the request company, and inside `RequestContext.scopes.branchIds`; the same checks run again when posting a draft.
- Manual-journal callers may set only account, branch, description, debit/credit, currency, entry date, and memo. Entry/line source identity, tax snapshots/codes/components, report contributions, tenant ids, status, and actor provenance are server-owned.
- Composite tenant relations bind journal entries to their company period and journal lines to their company journal/branch. The account relation also permits approved global system accounts, so the database enforces that local-or-global invariant with a constraint trigger.
- `lineNumber` is stable inside a journal entry and unique per `journalEntryId`.
- Debit and credit totals must be derived from lines, not trusted from request bodies.

### PostingRule

```text
PostingRule
- id
- companyId
- documentType
- ruleKey
- version
- status
- debitAccountId nullable
- creditAccountId nullable
- conditionJson nullable
- mappingJson
- effectiveFrom
- effectiveTo nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,documentType,ruleKey,version
```

Posting rules map finalized source documents to debit/credit lines. They must be versioned because accounting behavior can change over time.

### PeriodCloseRun

```text
PeriodCloseRun
- id
- companyId
- periodId
- status: STARTED, PASSED, FAILED, CLOSED, REOPENED
- checksJson
- requestedByUserId
- completedByUserId nullable
- createdAt
- completedAt nullable
- index companyId,periodId,createdAt
```

## 9.1 Shared Contract Draft

Add `packages/contracts/src/ledger.ts` and export it from `packages/contracts/src/index.ts`.

Minimum contract types:

```ts
export type LedgerAccountClass =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'COST'
  | 'EXPENSE'
  | 'TAX_EXPENSE'
  | 'SUSPENSE';

export type LedgerNormalBalance = 'DEBIT' | 'CREDIT';
export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'REVERSED' | 'VOIDED';
export type JournalEntryType = 'GENERATED' | 'MANUAL' | 'REVERSAL' | 'OPENING_BALANCE' | 'CLOSING';
export type AccountingPeriodStatus = 'OPEN' | 'CLOSING_REVIEW' | 'CLOSED' | 'REOPENED';

export type MoneyAmount = {
  amount: string;
  currency: 'THB' | string;
};

export type LedgerSourceRef = {
  sourceType: string;
  sourceId: string;
  sourceEventType?: string;
};

export type LedgerJournalLineInput = {
  accountId: string;
  branchId?: string;
  description?: string;
  debitAmount?: string;
  creditAmount?: string;
  currency: 'THB' | string;
  taxCode?: string;
  sourceRef?: LedgerSourceRef;
};

export type LedgerSourcePostingInput = {
  companyId: string;
  branchId?: string;
  sourceType: string;
  sourceId: string;
  sourceEventType: string;
  idempotencyKey: string;
  documentNumber?: string;
  sourceDate: string;
  periodKey: string;
  currency: 'THB' | string;
  counterpartyId?: string;
  totalAmount: string;
  taxTotal?: string;
  whtTotal?: string;
  paidAmount?: string;
  lines: Array<{
    sourceLineId?: string;
    description?: string;
    quantity?: string;
    netAmount: string;
    vatAmount?: string;
    whtAmount?: string;
    categoryKey?: string;
    accountHint?: string;
  }>;
  payment?: {
    paymentDate?: string;
    method?: string;
    amount: string;
    reference?: string;
  };
};
```

Contracts must use strings for money to avoid float drift across API boundaries.

## 9.2 Data Integrity Rules

- Use existing repo ID convention; default to `String @id @default(cuid())` when no convention exists.
- Use PostgreSQL/Prisma decimal columns or existing money pattern for debit, credit, tax, and totals.
- Add unique constraints for company account code, journal entry number, and generated source idempotency.
- Add indexes for company/period/status, company/account/date, company/source, and company/report class filters.
- Use transactions for generated posting, journal post/reverse, period close, period unclose, audit, outbox, and source posting status updates where repository support exists.
- Do not hard-delete chart accounts, journal entries, journal lines, posting rules, periods, close runs, or audit/outbox evidence through user routes.

### 9.3 Posted cash evidence port

Feature Entitlement Decoupling v5 adds one read-only Ledger-owned adapter for Banking-off tax cash reconciliation:

```text
LedgerCashEvidenceReader.getPostedCashJournalLineEvidence(companyId, journalLineId)
-> companyId, journalEntryId, journalLineId, postingDate, bankCashLedgerAccountId,
   direction, absoluteAmount, currency, contentHash, reversalState
```

The adapter returns only a POSTED, unreversed line on an active posting Cash/Bank asset account owned by the company, with a content hash over immutable entry/line/account/amount/direction facts. It never accepts a raw account ID as proof. Feature v5's normalized `TaxCashEvidenceAllocation` owns the unique CURRENT `(companyId, POSTED_CASH_JOURNAL_LINE, journalLineId)` allocation, so v5 permits exact full-line use by only one tax cash target; partial/reused/reversed/non-cash lines fail to one prefilled review. Automatic provenance linking may use this port under the owning source/tax action; interactive selection also requires `ledger.journal.read`. Releasing a consumed line requires the linked tax reversal/supersession and projection reversal/current-open correction in the same transaction—never an ordinary edit or silent unlink.

## 10. Minimum Posting Coverage

First ledger pass should support generated entries for:

- Invoice issued.
- Receipt/payment received.
- Tax invoice issued.
- Expense approved/posted.
- Expense payment.
- WHT withheld/recognized.
- Inventory movement cost hook if Inventory MVP has cost data; otherwise leave COGS hook explicit and unposted until cost policy exists.

Example patterns:

```text
Invoice issued:
Dr Accounts Receivable
Cr Revenue
Cr Output VAT when VAT applies

Payment received:
Dr Cash/Bank
Cr Accounts Receivable

Expense posted:
Dr Expense or Asset
Dr Input VAT when recoverable
Cr Accounts Payable or Cash/Bank

WHT withheld on supplier payment:
Dr Accounts Payable
Cr Cash/Bank
Cr WHT Payable
```

Final account ids come from posting rules, not hard-coded source code.

## 10.1 Source Posting and Status Contract

Item 08 and item 09 sources must be consumed through a source adapter or application port:

```text
LedgerSourceReader
- getPostingInput(companyId, sourceType, sourceId): LedgerSourcePostingInput
- listFinalizedUnposted(companyId, periodKey): LedgerSourceRef[]
- assertSourceMutationAllowed(companyId, sourceType, sourceId, mutationDate): void

LedgerSourcePostingStatusWriter
- markPostingPending(companyId, sourceType, sourceId)
- markPosted(companyId, sourceType, sourceId, journalEntryId, entryNumber)
- markPostingError(companyId, sourceType, sourceId, code, message)
- markReversed(companyId, sourceType, sourceId, reversalJournalEntryId)
```

Ledger infrastructure must not update accounting document or expense tables directly unless source modules expose that repository as an explicit adapter.

Posting status values:

```text
not_required
pending
posted
posting_error
reversed
```

Error messages must be actionable and redacted. They may name missing posting rules or blocked periods, but must not include raw OCR payloads, object storage keys, or full export data.

## 11. API Behavior

All routes are under `/v1/companies/:companyId`.

```text
GET /chart-of-accounts
- Permission: ledger.account.read
- Lists accounts with filters and hierarchy.

POST /chart-of-accounts
- Permission: ledger.account.manage
- Creates account. Code unique per company.

PATCH /chart-of-accounts/:accountId
- Permission: ledger.account.manage
- Updates name, report group, tax/cash-flow mapping, status.
- Blocks code change after first journal line reference.

GET /journal-entries
- Permission: ledger.journal.read
- Lists journals by period, status, source, account, branch.

POST /journal-entries/manual
- Permission: journal.entry.create
- Creates draft manual journal entry.

POST /journal-entries/:journalEntryId/post
- Permission: journal.entry.post
- Posts balanced draft journal if period is open.

POST /journal-entries/:journalEntryId/reverse
- Permission: journal.entry.reverse
- Creates reversal entry.

POST /posting-rules
- Permission: ledger.posting-rule.manage
- Creates or versions posting rule.

POST /posting/generate
- Internal use case or protected admin repair endpoint.
- Generates entry from finalized source document idempotently.

GET /reports/general-ledger
- Permission: ledger.report.read
- Returns ledger lines by account/date/period.

GET /reports/trial-balance
- Permission: ledger.report.read
- Returns debit/credit movement and ending balance by account.

GET /reports/profit-and-loss
- Permission: ledger.report.read
- Returns P&L from revenue/cost/expense account classes.

GET /reports/balance-sheet
- Permission: ledger.report.read
- Returns assets, liabilities, and equity from account balances.

POST /reports/:reportType/export
- Permission: ledger.export
- Creates an audited export request for `general-ledger`, `trial-balance`, `profit-and-loss`, or `balance-sheet`.
- First pass may return `export_not_implemented` when XLSX generation infrastructure is absent, but route, permission, request validation, and audit behavior must exist.

POST /periods/:periodId/close
- Permission: ledger.period.close
- Runs close checks and closes period when checks pass. With Ledger enabled, the checks include only CURRENT Ledger-owned effective-period VAT source/opening/settlement/external-scope-transition/refund/payment projection heads, including `VatClaimLedgerProjection` and `TaxLedgerProjection`; `PENDING|READY|NEEDS_REVIEW` blocks and returns one actionable grouped row, while `POSTED|SATISFIED` passes. A Tax projection pending solely because Tax is off is ignored. Tax-only companies have no Ledger close check.

POST /periods/:periodId/unclose
- Permission: ledger.period.unclose
- Reopens period with high-risk audit and required note.
```

## 11.1 API Response and Error Behavior

- Missing authentication returns `401`.
- Missing permission returns `403`.
- Cross-company access returns `404` or `403` according to existing repo policy; do not leak record existence.
- Posting an unbalanced journal returns validation error with debit total, credit total, and line error references.
- Posting into a closed period returns `period_closed` with period key and reopen guidance.
- Missing posting rule returns `posting_rule_missing` and leaves source posting status as `posting_error`.
- Duplicate generated posting returns the existing journal entry summary rather than creating a second entry.
- Report APIs return period/date filters, currency, account grouping, opening balance, movement, ending balance, and source refs where drill-down exists.
- Export API validates report type and filters, requires `ledger.export`, writes audit metadata, and may return `export_not_implemented` until XLSX generation is implemented.
- Close-check API returns rows with check key, status, severity, message, count/amount where useful, and fix link target where web has a route.
- VAT projection close rows group by projection class/status and link to the prefilled Ledger exception. Enabling Ledger after a historical period was already closed routes pending history through the current-open correction/backfill policy; the close service never asks users to reopen or re-key it.

## 11.2 Web UI Behavior

Web owns full ledger workspace:

- Accounting > Ledger navigation entry when Web Core registry exists.
- Chart of accounts list with filters for class, report group, posting/non-posting, status, and search.
- Account detail/edit screen for name, report group, tax/cash-flow mapping, and status.
- Journal list with filters for period, status, type, source, account, branch, and entry number.
- Journal detail with balanced debit/credit totals, line table, source links, reversal link, audit summary, and immutable posted state.
- Manual journal form for permitted users with line validation before submit.
- General Ledger report screen with account/date/period filters and source drill-down.
- Trial Balance screen that always shows debit total, credit total, and difference.
- P&L and Balance Sheet baseline screens grouped by report group and account class.
- Period close checklist screen showing passed/failed checks and fix links.
- Forbidden, readonly, empty, loading, validation-error, and posting-error states.

Do not add LINE mutation UI. LINE replies should link users back to web for review.

## 12. Permission Keys

Add these permissions:

```text
ledger.account.read
ledger.account.manage
ledger.journal.read
journal.entry.create
journal.entry.post
journal.entry.reverse
ledger.posting-rule.read
ledger.posting-rule.manage
ledger.report.read
ledger.period.read
ledger.period.close
ledger.period.unclose
ledger.export
```

Default grants:

```text
OWNER: all ledger permissions
ADMIN: ledger.account.read, ledger.journal.read, ledger.report.read, ledger.period.read
FINANCE: ledger.account.read, ledger.journal.read, journal.entry.create, ledger.report.read, ledger.period.read, ledger.export
ACCOUNTANT: all ledger permissions
AUDITOR_READONLY: ledger.account.read, ledger.journal.read, ledger.report.read, ledger.period.read, ledger.export
MANAGER: ledger.report.read where ABAC allows summary
SALES, INVENTORY, MARKETING, STAFF: no ledger mutation permissions by default
```

## 13. Audit Actions

Always audit:

```text
ledger.account.create
ledger.account.update
ledger.account.disable
ledger.posting_rule.create
ledger.posting_rule.update
ledger.journal.generate
ledger.journal.create
ledger.journal.post
ledger.journal.reverse
ledger.period.close
ledger.period.unclose
ledger.report.export
```

Audit metadata must include ids, entry number, period key, source type/id, debit total, credit total, and check status. Do not store full exported report files in audit metadata.

## 13.1 Security and Outbox Boundaries

- All ledger routes require authenticated company context except health/public docs routes outside this feature.
- Every mutation must check permission server-side with deny-by-default behavior.
- Branch filtering applies where source branch or journal line branch exists; lack of branch scope must not widen access accidentally.
- AI Gateway must call permission-checked read endpoints/tools only.
- Export requests require `ledger.export`, are audited, and must not write full file contents into audit metadata.
- Outbox payloads should include ids, source refs, period key, entry number, status, and totals only.
- Sensitive report access from AI tools should emit an audit or access log entry when current audit primitives support it.

## 14. Close Checks

Period close must check at minimum:

- All journal entries in period are balanced.
- No draft journals remain in period.
- No finalized source documents in period are missing generated journals.
- No pending required posting-rule errors remain.
- Suspense account balance is zero or explicitly approved by accountant.
- Trial balance totals debit equals credit.
- Closed-period source mutation will be blocked after close.

Close failure returns actionable check rows for web review.

## 14.1 Report Calculation Rules

General Ledger:

- Group by account and sort by entry date, entry number, and line number.
- Include opening balance, period movement, ending balance, source refs, and branch where available.

Trial Balance:

- Include all posting accounts with movement or balance in the selected period unless filter excludes zero rows.
- Debit and credit totals must match for posted balanced journals.
- Report should expose difference value even when zero.

Profit and Loss:

- Include `REVENUE`, `COST`, `EXPENSE`, and `TAX_EXPENSE` accounts.
- Exclude asset, liability, equity, and suspense accounts.
- Net profit equals revenue minus cost/expense/tax expense according to normal-balance handling.

Balance Sheet:

- Include `ASSET`, `LIABILITY`, and `EQUITY` accounts.
- Current-period profit can appear through a retained earnings/current profit mapping policy.
- Suspense must be shown separately or block close when unresolved.

Reports must not read raw accounting documents or expenses directly except for source-link labels already attached to journal lines.

## 15. LINE and AI Behavior

LINE AI can answer:

- Revenue, expense, profit, AR/AP, tax payable, and cash summaries from ledger/report APIs.
- Close status and missing-posting warnings.
- Links to web report pages and journal/source records.

LINE AI cannot:

- Create, post, reverse, close, unclose, export, or change chart of accounts.
- Show ledger details outside user permission and ABAC scope.
- Invent accounting treatment when posting rules are missing. It must say accountant setup is required.

## 16. Edge Cases

- Source document finalized twice: posting generation must be idempotent and return existing journal.
- Source document voided after posting: create reversal or module-approved correction entry.
- Account code change after journal reference: reject.
- Account disabled with balance: allow disable only if policy allows hidden future posting; never delete.
- Period closed: reject journal posting and source mutation.
- Period unclosed: require note, permission, high-risk audit, and visible close history.
- Suspense account used: require review before period close.
- Posting rule missing: source document remains finalized but accounting status remains `pending` or becomes `posting_error` with an actionable message.

## 17. Acceptance Criteria

- [ ] Chart of accounts seed/import supports the reviewed Thai SME account CSV shape.
- [ ] Account class derives from code prefix and normalized group, not raw `Group1`.
- [ ] Finalized supported source documents generate balanced posted journal entries.
- [ ] Journal posting rejects unbalanced entries.
- [ ] Generated journals are idempotent per source document.
- [ ] Source posting status moves through pending, posted, posting_error, and reversed through source adapters only.
- [ ] Posted entries cannot be edited directly.
- [ ] Corrections create reversal or adjustment entries.
- [ ] General Ledger and Trial Balance derive from journal lines.
- [ ] P&L and Balance Sheet derive from account classes/report groups.
- [ ] Report APIs return bounded company-scoped data and source refs for drill-down.
- [ ] Export API route/contract exists for ledger reports, enforces `ledger.export`, audits access, and returns a typed not-implemented response if XLSX generation is not available.
- [ ] Period close blocks new posting/source mutation in the period.
- [ ] Close check returns actionable failed rows for missing postings, draft journals, suspense balance, and unbalanced trial balance.
- [ ] With Ledger enabled, close check blocks only CURRENT Ledger-owned effective-period VAT source/opening/settlement/external-scope-transition/refund/payment projection heads in PENDING/READY/NEEDS_REVIEW, groups the actionable exceptions, and passes only POSTED/SATISFIED; a Tax projection pending solely because Tax is off is ignored, while Tax-only and enable-after-closed behavior remain non-blocking/current-open respectively.
- [ ] Posted cash evidence port returns only immutable eligible lines; one line cannot fund two tax targets, and a linked reversal/supersession is required before release.
- [ ] Period unclose requires permission, note, and high-risk audit.
- [ ] Web ledger workspace exposes chart, journal, report, and close views with forbidden/readonly states.
- [ ] LINE AI can read ledger summaries only through permission-checked APIs.
- [ ] LINE/AI cannot post, reverse, close, unclose, export, or edit chart accounts.

## 18. Test Cases

- Import/seed chart of accounts normalizes `Service expesnes`.
- Account code `9999-99` is marked controlled suspense.
- Invoice generated journal balances debit and credit.
- Payment generated journal clears receivable.
- Expense generated journal handles VAT/WHT accounts.
- Duplicate posting request returns existing generated journal.
- Posting status writer marks source as posted with journal id and entry number.
- Missing posting rule marks source as posting_error with redacted actionable message.
- Manual journal cannot post when unbalanced.
- Arithmetic-balanced manual journals with a foreign-tenant account are rejected at create and post so each tenant report remains independently balanced.
- Manual journals with a foreign/out-of-scope/inactive branch are rejected at create and post.
- Manual-journal caller source/tax/report metadata is rejected at HTTP validation and cannot be persisted by the use case or direct database writes.
- Posted journal cannot update lines.
- Reversal creates opposite debit/credit lines.
- Trial balance debit total equals credit total.
- P&L excludes balance-sheet accounts.
- Balance Sheet excludes revenue/expense accounts except current-profit mapping policy.
- GL is scoped by company and denied cross-company.
- Report export API without `ledger.export` returns `403`.
- Report export API returns `export_not_implemented` when XLSX generation is not implemented.
- Close fails when draft journal remains.
- Close fails when source document has posting error.
- Close fails when suspense account has unresolved balance.
- Close fails for each Ledger-owned effective-period VAT projection class in PENDING/READY/NEEDS_REVIEW, returns one grouped fix target, and succeeds after all become POSTED/SATISFIED; Ledger ON + Tax OFF passes when the Ledger projection is POSTED even if its Tax projection remains PENDING.
- Tax-only filing has no Ledger close blocker; enabling Ledger after a period is closed creates a current-open correction/backfill task and no reopen/re-entry prompt.
- Banking-off tax cash evidence accepts one exact eligible posted cash journal line, rejects partial/reused/reversed/non-cash lines, and a concurrent second target loses the unique allocation race.
- Close succeeds and blocks period mutation.
- Unclose writes audit and reopens period.
- AI ledger read tool without `ledger.report.read` returns `403`.
- AI mutation attempt for post/reverse/close/unclose is refused before reaching ledger use case.

## 19. Implementation Notes

First implementation should start with chart of accounts, periods, journal model, generated posting service, and GL/TB reports. P&L/Balance Sheet can follow once report groups are verified.

Do not hard-code one company chart forever. Seed default accounts, then allow company-specific account mapping under accountant control.

## 20. Resolved Owner Decisions

- Manual journals: MVP allows ACCOUNTANT to create and post manual journals. FINANCE may create draft manual journals when granted, but posting remains controlled by `journal.entry.post`. Two-step approval is deferred before beta.
- Period close: ACCOUNTANT can close an open period. OWNER can close and unclose. Unclose always requires a note and high-risk audit.
- Export API/contract should exist in item 10. Actual XLSX file generation is backlog after ledger reports stabilize. CSV export follows XLSX. PDF export is deferred.

## 21. Ledger Backlog Not in First Pass

- Two-step approval for manual journal posting before beta.
- XLSX report file generation behind the export API.
- CSV export after XLSX baseline.
- PDF financial statement export.
- Accounting-office-specific export templates.
- OWNER/MFA-style extra approval gate for close or unclose if accountant review requires it before beta.

## 22. Owner Update 2026-07-06 — AI-Prepared Close Draft, Accountant Review, Auditor Approval

- AI prepares the period-close package as a draft only, through the item 17 AI Draft and Suggestion layer: runs close-readiness checks, drafts adjusting entries, summarizes TB/P&L/BS, and summarizes bank-statement/reconciliation evidence (item 13). AI never executes close/unclose and never posts entries.
- ACCOUNTANT reviews the AI-prepared package and records an explicit approval in web.
- A new auditor approval step is required before final close. Both the ACCOUNTANT reviewer and the auditor may be internal or external (accounting office / audit firm). External collaborators use the guest/external-collaborator access feature (permission-scoped, no seat cost per the 10C+ owner decision) and must carry an explicit "external" flag/toggle visible in team UI, close approval records, and audit metadata (owner refinement 2026-07-06; see Auth/RBAC Spec §22).
- `AUDITOR_READONLY` stays read-only. The approval uses a distinct new permission (working name `ledger.period.approve_close`) assignable to an auditor collaborator role.
- Final close remains human-executed by ACCOUNTANT (or OWNER) under `ledger.period.close`, only after accountant review + auditor approval records exist. Every step is audited.
- Tracked as checklist item 10E; supersedes the §20 single-step "Period close" rule once item 10E ships.

## 23. Owner Update 2026-07-14 — Tax Account Determination and Reconciliation

- Generic source posting rules continue to determine receivable/payable, revenue, expense, inventory, asset, cash, and counterparty lines.
- Item 11B adds versioned Tax Code account rules for output/input/import VAT, PP36, non-deductible VAT, customs duty, excise, and related semantic account roles. Ledger resolves both rule sets into one balanced posting preview.
- External SAP code is carried as line metadata/snapshot; it does not replace chart account id or stable internal tax treatment.
- Existing `2210-01` Output VAT and `1280-00` Input VAT are reviewed baseline mappings only. Missing account roles cause `posting_error`; suspense must not be selected silently.
- Credit notes reverse original revenue/receivable/tax components and debit notes increase the original treatment. Amount-only inference is insufficient.
- Period close exposes source-vs-Tax Event-vs-tax-account-vs-report reconciliation blockers from [[specs/sap-compatible-transaction-tax-account-determination-spec|item 11B]].

## 24. Owner Update 2026-07-29 — Company Chart Master Bootstrap

- The reviewed 175-row Thai SME chart becomes a fixed versioned platform template copied into company-owned accounts during onboarding.
- Existing companies use preview/apply with semantic conflict detection; code equality alone is insufficient.
- Confirmed collisions at `1210-00` and `5310-01` must block unsafe migration or built-in posting fallback.
- Tax Code definitions and account-role rules remain separate from chart creation and require accountant review before activation.
- Line-level Tax Code snapshots are authoritative; legacy header values must never override or contradict an S/4HANA/current profile code.
- Implementation and verification move to checklist item 10H and [[plans/chart-of-accounts-master-data-bootstrap-plan|Chart of Accounts Master Data Bootstrap Plan]].
