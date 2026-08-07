# Bank Accounts and Reconciliation Spec

## 1. Status

Pre-amendment item 13 baseline is ready/implemented as recorded in its plan. The 2026-07-31 Feature Entitlement Decoupling v5.1 allocation-command, tax cash-evidence, redaction and safe-unmatch amendment in this spec is owner-confirmed and not yet implemented/verified.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/bank-reconciliation-plan|Bank Accounts and Reconciliation Plan]]

Owner decisions assumed for first pass on 2026-06-23:

- Bank transfer execution is out of scope. Item 13 records and reconciles bank activity only.
- Statement import supports CSV/XLSX-style files, manual entry, generic mapping, and first-pass alias presets for KBank K BIZ and SCB Business Anywhere. Direct bank API feeds are deferred.
- Matching tolerance starts at zero amount variance. Any variance requires override permission and reason.
- Full bank account number storage is deferred when encryption/tokenization primitives are absent. Store masked/last4 display data only.
- Reconciliation completion is ACCOUNTANT-owned by default.
- Ignored statement lines require Accountant review before reconciliation completion.
- Evidence export first pass supports JSON, CSV, XLSX, and PDF.
- Bank adjustment approval is ACCOUNTANT-owned by default.

## 2. Goal

Ship the first trustworthy cash-control workflow for WatchDog-BMS:

- Bank and cash account master data.
- Bank account linkage to ledger cash/bank accounts.
- Statement import preview, validation, duplicate detection, and commit.
- Manual bank statement line entry for low-volume SMEs.
- Matching between bank statement lines and recorded payments from accounting documents, expenses, AP, reimbursements, and ledger cash movements.
- Reconciliation sessions with opening balance, statement balance, book balance, variance, status, audit history, and evidence export.
- Cash visibility by bank account, cash account, unmatched line, unreconciled payment, and ledger posting status.
- Permission, audit, outbox, web, and read-only AI/LINE hooks.

Item 13 must connect earlier accounting foundations without creating parallel systems. Customer payments come from item 08 accounting documents. Expense payments come from item 09. Supplier payments and vendor bills come from item 12. Cash/bank ledger accounts, posting status, and period close rules come from item 10. Reconciliation may read tax-sensitive payment facts, but item 11 owns tax filing and certificate workflows.

## 3. Non-goals

- Executing bank transfers, prompting external bank approval, payment rails, direct debit, card settlement, PromptPay initiation, or bank API write actions.
- Direct bank feed integration, OAuth bank connections, statement scraping, or open-banking provider setup in the first pass.
- Replacing invoice, receipt, vendor bill, expense, reimbursement, or payment workflows.
- Creating a separate payment ledger. Existing source payment records remain source of truth.
- Generating double-entry journals, chart of accounts, financial statements, or period close implementation. Item 10 owns them.
- Thai tax filing, WHT certificate generation, tax export packages, or final legal tax advice. Item 11 owns them.
- Payroll, fixed assets, manufacturing, marketplace settlement, or CRM collection workflow.
- Multi-currency revaluation or FX gain/loss automation in the first pass.
- LINE or AI final matching, reconciliation completion, payment recording, bank adjustment approval, ledger posting, or money movement mutation.

## 4. User Roles

- Owner: sees cash position, unreconciled payments, unmatched bank lines, reconciliation status, and high-risk reopening or overrides.
- Admin: configures bank accounts and import mappings when granted.
- Finance: imports statements, enters manual lines, reviews matches, exports evidence, and manages bank adjustment drafts.
- Accountant: reviews bank-to-ledger alignment, ignored statement lines, posting status, closed-period blockers, reconciliation evidence, bank adjustment approvals, and reconciliation completion.
- Auditor readonly: reads bank accounts, statement lines, matches, sessions, evidence exports, and audit history without mutation.
- Manager: reads cash summaries when branch/company ABAC allows.
- AI assistant user: asks for cash, reconciliation, unmatched, and payment status summaries through permission-checked read tools only.

## 5. Business Workflow

1. Finance creates a bank or cash account with bank name, account display name, masked account number, currency, optional branch, and linked ledger cash/bank account.
2. Finance configures optional statement import mapping for the bank format.
3. Finance uploads a statement file or enters statement lines manually.
4. System parses the file into an import preview and validates required columns, date format, debit/credit amount, currency, balance, and duplicate line hashes.
5. Finance confirms import. System commits immutable statement lines and logs audit/outbox events.
6. System creates deterministic match suggestions against recorded customer payments, supplier payments, expense payments, reimbursement payments, bank adjustments, and ledger cash journal lines where available.
7. Finance reviews suggestions and confirms, splits, overrides, or rejects matches.
8. Unmatched statement lines remain in a review queue with category hints such as unknown deposit, unknown withdrawal, bank fee, interest, transfer, duplicate, or needs source document.
9. Finance can create a bank adjustment draft for bank fees, interest, owner contribution/draw, or inter-account transfer when no existing source payment exists.
10. Bank adjustment approval creates ledger-ready source posting input for item 10. Item 10 later generates journals when posting rules exist.
11. Finance starts a reconciliation session for a bank account and period.
12. System calculates book balance from reconciled internal cash movements, statement balance from committed lines, and difference from session inputs.
13. Accountant reviews ignored statement lines, unreconciled internal payments, bank adjustments, and balance variance.
14. Reconciliation can complete only when required statement lines are matched or explicitly ignored with reason and Accountant review, unreconciled internal payments are explained, and variance is zero unless policy grants override.
15. Completed reconciliation locks matched lines for that session. Reopen requires dedicated permission, reason, and audit trail.
16. Finance or Accountant exports JSON/CSV/XLSX/PDF reconciliation evidence for accountant/auditor review.
17. LINE/AI may summarize cash position, open reconciliations, unmatched lines, and pending payment matches with web deep links only.

## 6. Core Business Rules

- Bank accounts are company-scoped and may be branch-scoped.
- Each active bank account must have a currency. First pass default is `THB`.
- Each bank account should link to a ledger cash/bank asset account when item 10 is enabled.
- If no ledger account exists yet, bank account may be created with `ledgerAccountId = null`. With Ledger off, reconciliation may complete from bank balances plus confirmed/ignored source evidence, labels `bookBalanceBasis=MATCHED_SOURCE_EVIDENCE`, and a derived `ledgerPostingStatus=NOT_APPLICABLE|PENDING_ENABLE` never blocks it. With Ledger on, a valid link and period policy are required. Later Ledger enable binds/backfills from retained sessions/matches without statement re-import or re-match; an unresolved account produces one prefilled mapping task.
- Full bank account number storage requires approved encryption/tokenization primitive. Without it, store only masked display value, last4, bank code, and user-facing account name.
- Bank account deactivation is blocked while it has unreconciled statement lines or open reconciliation sessions unless admin override records reason.
- Statement import uses preview then commit. Preview does not create durable statement lines.
- Committed statement lines are append-only. Corrections use voided import, ignored line with reason, reversal/adjustment, or new statement line.
- Statement line duplicate detection uses at least company, bankAccountId, postedDate, signedAmount, currency, bank reference, normalized description, running balance when present, and source file hash/row number.
- Exact duplicate line commits are blocked by default.
- Potential duplicate lines can be committed only with override permission and reason.
- Manual statement lines require audit and must be visibly marked `MANUAL`.
- Money calculations must be decimal-safe. Do not use JavaScript floating-point math for business totals.
- Statement lines store signed amount and direction. Deposits are positive; withdrawals are negative.
- Imported debit/credit columns must normalize to signed amount deterministically.
- Running balance from bank statement is optional but must be preserved when present.
- Matching tolerance default is zero. Amount, currency, and bank account must match unless override permission and reason exist.
- Date tolerance default for match suggestion is plus/minus 7 calendar days around payment date.
- Matching suggestions are not final evidence until confirmed by authorized user.
- One statement line can match multiple internal payments when the statement combines deposits or withdrawals.
- One internal payment can match multiple statement lines only when split payment evidence exists and total allocation equals payment amount.
- A confirmed match cannot allocate more than the remaining statement line amount or remaining source payment amount.
- Confirm/unmatch is command-idempotent and locks the statement line's expected `allocationVersion`; active allocations plus the new allocation cannot exceed the absolute line amount. Tax refund/payment evidence uses this same allocation authority, so a free-form reference cannot consume bank cash and one confirmed allocation cannot support two tax artifacts. Once a Tax/Ledger projection consumes a tax match, ordinary unmatch is blocked. An economic PAYMENT_REVERSAL uses a new opposite-direction match and never frees the original. Artifact supersession with unchanged cash atomically transfers evidence ownership to the successor without freeing the confirmed match; only an explicit corrected-evidence unlink may reverse/current-open-correct the dependent projection and void/free the allocation under both expected versions.
- Matched amount sign must agree with source direction: customer receipt/deposit positive, supplier payment/expense/withdrawal negative.
- Customer payment overpayment/unapplied credit remains owned by item 08. Bank reconciliation only matches the bank deposit.
- Supplier payment allocation remains owned by item 12. Bank reconciliation only matches the bank withdrawal.
- Expense payment remains owned by item 09. Bank reconciliation only matches the bank withdrawal.
- Reimbursement payment remains owned by item 14 when it exists. Until then, reimbursement source type is reserved.
- Bank adjustment records are allowed only for bank-origin activity not already represented by a source module.
- Bank adjustment approval is ACCOUNTANT-owned by default and must produce ledger-ready source posting input and posting status `pending` when item 10 exists.
- Bank fee, bank interest, owner contribution/draw, and inter-account transfer categories need explicit account/category mapping before posting.
- Inter-account transfer reconciliation should link both bank account sides when both statement lines exist.
- Reconciliation completion is ACCOUNTANT-owned by default.
- Reconciliation completion is blocked when any ignored statement line lacks Accountant review.
- Reconciliation completion is blocked for a missing Ledger link or closed Ledger period only when Ledger is enabled; Bank-only completion has no Ledger dependency.
- Reopening a completed reconciliation requires `bank.reconciliation.reopen`, reason, and audit.
- Voiding an import or unmatching a line from a completed reconciliation requires reopening the session first.
- Evidence exports must include enough data to reproduce balances: session inputs, bank account, period, statement lines, matches, ignored reasons, open items, variance, user/time stamps, and export hash.
- Evidence export first pass supports JSON, CSV, XLSX, and PDF.
- Web permission checks are UX only; backend remains authoritative.
- Company, branch, role, and record scope are enforced server-side on every route.
- LINE and AI are read-only for item 13.

## 7. Statuses and Enumerations

Bank account statuses:

```text
ACTIVE
INACTIVE
ARCHIVED
```

Bank account types:

```text
BANK_CHECKING
BANK_SAVINGS
CASH
E_WALLET
OTHER
```

Statement import statuses:

```text
PREVIEW
COMMITTED
VOIDED
FAILED
```

Statement line sources:

```text
IMPORT
MANUAL
API_STUB
```

Statement line directions:

```text
DEPOSIT
WITHDRAWAL
ZERO
```

Statement line statuses:

```text
UNMATCHED
SUGGESTED
PARTIALLY_MATCHED
MATCHED
IGNORED
VOIDED
```

Match statuses:

```text
SUGGESTED
CONFIRMED
REJECTED
VOIDED
```

Match source types:

```text
CUSTOMER_PAYMENT
SUPPLIER_PAYMENT
EXPENSE_PAYMENT
REIMBURSEMENT_PAYMENT
BANK_ADJUSTMENT
LEDGER_JOURNAL_LINE
INTER_ACCOUNT_TRANSFER
VAT_REFUND_OUTCOME
VAT_SCOPE_TRANSITION_REFUND
VAT_FILING_PAYMENT
TAX_FILING_PAYMENT
OTHER_SOURCE
```

Bank adjustment statuses:

```text
DRAFT
PENDING_APPROVAL
APPROVED
VOIDED
POSTED
POSTING_ERROR
```

Bank adjustment categories:

```text
BANK_FEE
BANK_INTEREST
OWNER_CONTRIBUTION
OWNER_DRAW
INTER_ACCOUNT_TRANSFER
UNKNOWN_DEPOSIT
UNKNOWN_WITHDRAWAL
OTHER
```

Reconciliation session statuses:

```text
DRAFT
IN_REVIEW
COMPLETED
REOPENED
VOIDED
```

Posting statuses:

```text
not_required
pending
posted
posting_error
reversed
```

## 8. Data Model Draft

Use repo conventions and current Prisma naming when implementation starts. The shape below is the required business contract, not exact ORM syntax.

### BankAccount

```text
BankAccount
- id
- companyId
- branchId nullable
- displayName
- bankName nullable
- bankCode nullable
- accountType
- accountNumberMasked nullable
- accountNumberLast4 nullable
- accountHolderName nullable
- currency
- ledgerAccountId nullable
- openingBalanceAmount
- openingBalanceDate nullable
- status
- notes nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,displayName
- index companyId,status
- index companyId,ledgerAccountId
```

### BankStatementImport

```text
BankStatementImport
- id
- companyId
- bankAccountId
- sourceType: IMPORT, MANUAL, API_STUB
- originalFileName nullable
- fileHash nullable
- parserVersion
- mappingJson nullable
- statementStartDate nullable
- statementEndDate nullable
- status
- lineCount
- duplicateLineCount
- committedAt nullable
- committedByUserId nullable
- voidedAt nullable
- voidedByUserId nullable
- voidReason nullable
- createdByUserId
- createdAt
- updatedAt
- unique companyId,bankAccountId,fileHash when fileHash exists
- index companyId,bankAccountId,status
```

### BankStatementLine

```text
BankStatementLine
- id
- companyId
- bankAccountId
- importId nullable
- sourceType
- rowNumber nullable
- lineHash
- postedDate
- valueDate nullable
- description
- normalizedDescription nullable
- counterpartyName nullable
- bankReference nullable
- chequeNumber nullable
- direction
- signedAmount
- debitAmount nullable
- creditAmount nullable
- runningBalanceAmount nullable
- currency
- status
- allocationVersion
- duplicateOfLineId nullable
- ignoredReason nullable
- createdByUserId nullable
- createdAt
- updatedAt
- unique companyId,bankAccountId,lineHash
- index companyId,bankAccountId,postedDate
- index companyId,bankAccountId,status
```

### BankReconciliationMatch

```text
BankMatchAllocationCommand
- id
- companyId
- statementLineId
- action: CONFIRM_ALLOCATIONS, VOID_MATCH
- commandOrigin: LIVE, LEGACY_RECONCILED
- commandId
- payloadFingerprint
- expectedStatementLineAllocationVersion nullable only for LEGACY_RECONCILED
- resultingStatementLineAllocationVersion
- allocationSetHash
- targetMatchId nullable; required only for VOID_MATCH
- actorUserId nullable only for LEGACY_RECONCILED
- createdAt
- unique companyId,commandId
- unique companyId,targetMatchId where action=VOID_MATCH

BankReconciliationMatch
- id
- companyId
- bankAccountId
- statementLineId
- sourceType
- sourceId
- sourceArtifactHash nullable; required for tax source types
- sourceAction nullable; required for tax source types
- sourceCashEffect nullable: NONE, DEPOSIT, WITHDRAWAL; required for VAT refund/external-transition tax source types
- sourceDisplayNumber nullable
- allocatedAmount
- currency
- allocationCommandId nullable; required once CONFIRMED
- allocationSeq nullable; required once CONFIRMED
- confidenceScore nullable
- status
- suggestedBy nullable: system, user
- suggestedReason nullable
- confirmedByUserId nullable
- confirmedAt nullable
- rejectedByUserId nullable
- rejectedAt nullable
- rejectionReason nullable
- overrideReason nullable
- voidCommandId nullable
- voidedByUserId nullable
- voidedAt nullable
- voidReason nullable
- createdAt
- updatedAt
- unique companyId,statementLineId,sourceType,sourceId,status where active
- unique allocationCommandId,allocationSeq where allocationCommandId is not null
- unique voidCommandId where voidCommandId is not null
- index companyId,bankAccountId,status
- index companyId,sourceType,sourceId
```

For `VAT_REFUND_OUTCOME`, `VAT_SCOPE_TRANSITION_REFUND`, `VAT_FILING_PAYMENT` and `TAX_FILING_PAYMENT`, `sourceId` is the immutable tax artifact ID and `sourceAction`/`sourceArtifactHash` are required. An ORIGINAL/REPLACEMENT `VAT_REFUND_OUTCOME` is eligible only when `outcome=REFUND_RECEIVED` and `cashEffect=DEPOSIT`; its evidence-backed economic REVERSAL is eligible only with `cashEffect=WITHDRAWAL`. An external-transition child follows the same rule with `dispositionType=REFUNDED`. A classification/evidence correction with `cashEffect=NONE`, or `OFFSET_APPLIED|RETURN_TO_AVAILABLE|DISALLOWED|EXPIRED|USED|OTHER_REVIEWED`, rejects before allocation. PP30/PP36/PND PAYMENT requires WITHDRAWAL and its proven PAYMENT_REVERSAL requires DEPOSIT. Any artifact-action/hash/sign/cash-effect mismatch rejects. The Bank match proves bank account/currency even when that BankAccount has no Ledger mapping; Tax evidence may become ACTIVE while its Ledger projection remains PENDING until Ledger enable resolves the account without cash re-selection. One CONFIRM_ALLOCATIONS command may create multiple ordered child matches atomically, increments the line version once and stores a hash of the complete result set. Same command + fingerprint returns that whole immutable set before version checks; key reuse or stale version changes nothing. A live VOID_MATCH requires its own command/fingerprint plus expected current allocation version. If a dependent tax/Ledger projection exists, `/void` returns `tax_evidence_in_use`; only explicit corrected-evidence unlink may reverse/current-open-correct it and append the void. PAYMENT_REVERSAL or a proven refund economic reversal instead consumes new opposite-direction evidence, while artifact supersession with still-true cash transfers the allocation to its successor without voiding the match. Reviewed tax evidence without a confirmed match remains valid tax history but cannot post or infer bank cash.

The v5 expansion is deploy-owned and does not ask customers to repair matches. Add parent/child fields nullable/defaulted first, lock each company/line during backfill, verify active allocations do not exceed the statement line or durable source remaining amount, initialize `allocationVersion` deterministically from its durable match rows, and seed each existing confirmed match as the one child of `LEGACY_RECONCILED` command `legacy-bank-match:{matchId}` with a fingerprint/hash of immutable match fields (plus a separate deterministic legacy VOID_MATCH parent where applicable). Ambiguous or over-allocated legacy rows remain unchanged but create one prefilled internal review and block only new allocations on that line. After clean shadow evidence, enforce required LIVE command/version fields and parent/child uniqueness. Rollback is fix-forward to the dual-read phase; no bank line, match or tax evidence is deleted or re-entered.

### BankAdjustment

```text
BankAdjustment
- id
- companyId
- bankAccountId
- adjustmentNumber nullable until approved
- category
- status
- adjustmentDate
- description
- signedAmount
- currency
- counterpartyName nullable
- ledgerDebitAccountId nullable
- ledgerCreditAccountId nullable
- sourceStatementLineId nullable
- postingStatus
- postedJournalEntryId nullable
- createdByUserId
- approvedByUserId nullable
- approvedAt nullable
- voidedByUserId nullable
- voidedAt nullable
- voidReason nullable
- createdAt
- updatedAt
- unique companyId,adjustmentNumber when present
- index companyId,bankAccountId,status
- index companyId,postingStatus
```

### BankReconciliationSession

```text
BankReconciliationSession
- id
- companyId
- bankAccountId
- sessionNumber
- periodStartDate
- periodEndDate
- openingStatementBalanceAmount
- closingStatementBalanceAmount
- calculatedStatementMovementAmount
- calculatedBookMovementAmount
- calculatedBookBalanceAmount
- bookBalanceBasis: LEDGER, MATCHED_SOURCE_EVIDENCE
- differenceAmount
- currency
- status
- ledgerPostingStatus: NOT_APPLICABLE, PENDING_ENABLE, READY, POSTED, NEEDS_REVIEW (derived)
- completedAt nullable
- completedByUserId nullable
- reopenedAt nullable
- reopenedByUserId nullable
- reopenReason nullable
- voidedAt nullable
- voidedByUserId nullable
- voidReason nullable
- createdByUserId
- createdAt
- updatedAt
- unique companyId,sessionNumber
- index companyId,bankAccountId,status
- index companyId,periodStartDate,periodEndDate
```

### BankReconciliationSessionLine

```text
BankReconciliationSessionLine
- id
- companyId
- sessionId
- statementLineId
- statusAtCompletion
- matchedAmountAtCompletion
- ignoredReasonAtCompletion nullable
- createdAt
- unique companyId,sessionId,statementLineId
```

### BankReconciliationEvidenceExport

```text
BankReconciliationEvidenceExport
- id
- companyId
- sessionId
- format: JSON, CSV, XLSX, PDF
- exportHash
- fileAttachmentId nullable
- generatedByUserId
- generatedAt
- expiresAt nullable
- index companyId,sessionId
```

## 8.1 Statement Parser Presets

First pass includes generic mapping plus two built-in alias presets:

```text
GENERIC_CSV_XLSX
KASIKORNBANK_KBIZ
SCB_BUSINESS_ANYWHERE
```

Public source check on 2026-06-23:

- K BIZ public app at `https://kbiz.kasikornbank.com` exposes account statement/recent transaction and CSV/PDF/XLSX export strings in its public app bundle.
- SCB Business Anywhere public app at `https://www.scbbusinessanywhere.com` exposes balance/statement permission and CSV/XLSX/PDF/TXT format strings in its public app bundle.

Stable official sample CSV/XLSX column layouts were not found. Therefore built-in presets must be alias-based and fixture-validated, not hardcoded to a single unverified column order.

Common required normalized fields:

```text
postedDate
description
signedAmount or debitAmount/creditAmount
currency default THB when absent
```

Common optional normalized fields:

```text
valueDate
counterpartyName
bankReference
chequeNumber
runningBalanceAmount
branchCode
channel
rawTransactionCode
```

Common aliases:

```text
postedDate: Date, Transaction Date, Effective Date, Posted Date, วันที่, วันที่ทำรายการ
valueDate: Value Date, วันที่มีผล
description: Description, Details, Transaction Details, Particulars, รายละเอียด, รายการ
debitAmount: Debit, Withdrawal, Paid Out, DR, ถอน, เงินออก, จ่าย
creditAmount: Credit, Deposit, Paid In, CR, ฝาก, เงินเข้า, รับ
signedAmount: Amount, Transaction Amount, จำนวนเงิน
runningBalanceAmount: Balance, Running Balance, Ledger Balance, Available Balance, คงเหลือ, ยอดคงเหลือ
bankReference: Reference, Ref, Transaction Ref, Bank Ref, เลขที่อ้างอิง
chequeNumber: Cheque No, Check No, เลขที่เช็ค
counterpartyName: Counterparty, Sender, Receiver, From/To, คู่ค้า, ผู้โอน, ผู้รับ
```

KBank K BIZ preset:

- Preset id: `KASIKORNBANK_KBIZ`.
- Bank code: `KBANK`.
- Must support CSV and XLSX input.
- Must support account statement/recent transaction style exports when headers map to aliases above.
- Date parsing candidates: `dd/MM/yyyy`, `dd/MM/yy`, `yyyy-MM-dd`, Thai Buddhist Era year when detected.
- Amount parsing candidates: comma-separated decimal, parenthesized negative amount, separate debit/credit columns.

SCB Business Anywhere preset:

- Preset id: `SCB_BUSINESS_ANYWHERE`.
- Bank code: `SCB`.
- Must support CSV and XLSX input.
- Must support balance/statement exports when headers map to aliases above.
- Date parsing candidates: `dd/MM/yyyy`, `dd/MM/yy`, `yyyy-MM-dd`, Thai Buddhist Era year when detected.
- Amount parsing candidates: comma-separated decimal, separate debit/credit columns, signed amount column.

Preset acceptance rules:

- Each preset must have synthetic fixtures for CSV and XLSX-like rows.
- Each preset must pass the same normalized output contract as generic mapping.
- Phase 0 should replace or add fixtures from one real export per bank when available.
- Parser must return actionable unmapped-header errors instead of guessing silently.
- Parser must preserve raw row JSON for audit/debug.

## 9. Source Integration Contracts

Item 13 should read or adapt these source records instead of duplicating them:

- `CUSTOMER_PAYMENT`: item 08 payment where direction is `RECEIVED`.
- `SUPPLIER_PAYMENT`: item 12 supplier payment or shared payment where direction is `PAID`.
- `EXPENSE_PAYMENT`: item 09 confirmed expense payment.
- `REIMBURSEMENT_PAYMENT`: item 14 reimbursement payment when available.
- `LEDGER_JOURNAL_LINE`: item 10 posted journal line against linked cash/bank account.
- `BANK_ADJUSTMENT`: item 13 approved bank adjustment.
- `INTER_ACCOUNT_TRANSFER`: item 13 transfer record or paired bank adjustment when available.
- `VAT_REFUND_OUTCOME`: item 11 ORIGINAL/REPLACEMENT `REFUND_RECEIVED,cashEffect=DEPOSIT` artifact or its evidence-backed economic `cashEffect=WITHDRAWAL` reversal; classification/evidence-only reversals and every noncash outcome are ineligible.
- `VAT_SCOPE_TRANSITION_REFUND`: item 11 immutable ORIGINAL/REPLACEMENT `REFUNDED,cashEffect=DEPOSIT` external-transition disposition or its evidence-backed economic `cashEffect=WITHDRAWAL` reversal; every NONE/noncash disposition is ineligible.
- `VAT_FILING_PAYMENT`: item 11 APPLIED PP30 PAYMENT/PAYMENT_REVERSAL cash artifact; withdrawal/deposit direction follows the immutable cash movement and remaining unmatched amount.
- `TAX_FILING_PAYMENT`: item 11 non-legacy PP36/PND payment/reversal artifact; no legacy marker without amount may become a candidate.

Required source payment read shape:

```text
BankMatchCandidate
- sourceType
- sourceId
- sourceAction nullable
- sourceCashEffect nullable: NONE, DEPOSIT, WITHDRAWAL; required for VAT refund/external-transition targets
- sourceArtifactHash nullable; required for tax cash targets
- sourceDisplayNumber nullable; redacted when caller lacks owning-source detail permission
- companyId
- branchId nullable
- bankAccountId nullable
- ledgerAccountId nullable
- direction: DEPOSIT or WITHDRAWAL
- paymentDate
- amount
- targetCashAmount
- remainingUnmatchedAmount
- currency
- counterpartyName nullable; redacted when caller lacks owning-source detail permission
- reference nullable; redacted when caller lacks owning-source detail permission
- status
- postingStatus nullable
- webUrl nullable; present only when caller can open the owning source
```

Candidate adapters receive the acting principal and enforce company/branch plus owning-source permissions before returning detail. Tax adapters derive `sourceAction`, immutable artifact hash, `cashEffect`, direction and canonical target cash amount from the same rules as `TaxCashEvidenceLink`; neither `mutationKind=REVERSAL` by itself nor a legacy marker with unknown amount is eligible. Bank-only users may see the minimum labeled source type, date, direction, amount and remaining allocation needed to reconcile their own bank line, but no hidden Tax/payment reference, counterparty or dead link. Tax-visible users receive the permitted detail/deep link. Candidate generation never broadens source permissions merely because `bank.match.read` is present.

Cross-module wiring is port-based and one-way at each boundary. A contracts-owned immutable `TaxCashTargetReader` exposes eligible target identity/action/hash/amount/direction to Bank; a Bank-owned `BankConfirmedMatchEvidenceReader` exposes confirmed allocation-set/version/hash to Tax. Adapters are composed at the application composition/read-model boundary. Neither module imports the other's repository or mutation service, and `forwardRef` is not an acceptable shortcut. Both modules must unit-test against fake ports.

Required source posting shape for approved bank adjustments:

```text
BankAdjustmentPostingInput
- sourceType: BANK_ADJUSTMENT
- sourceId
- companyId
- branchId nullable
- sourceNumber
- sourceDate
- description
- currency
- lines:
  - ledgerAccountId
  - debitAmount
  - creditAmount
  - description
```

## 10. Permission Keys

Use these keys for Bank Accounts and Reconciliation:

```text
bank.account.read
bank.account.manage
bank.account.sensitive_read
bank.statement.read
bank.statement.import
bank.statement.manual_line
bank.statement.void
bank.match.read
bank.match.suggest
bank.match.confirm
bank.match.unmatch
bank.match.override
bank.adjustment.read
bank.adjustment.create
bank.adjustment.approve
bank.adjustment.void
bank.reconciliation.read
bank.reconciliation.create
bank.reconciliation.complete
bank.reconciliation.reopen
bank.reconciliation.export
bank.cash.read
```

Default grants:

```text
OWNER: all bank permissions
ADMIN: bank.account.read, bank.account.manage, bank.statement.read, bank.match.read, bank.adjustment.read, bank.reconciliation.read, bank.cash.read
FINANCE: all bank permissions except bank.adjustment.approve, bank.reconciliation.complete, and bank.reconciliation.reopen by default
ACCOUNTANT: bank.account.read, bank.statement.read, bank.match.read, bank.match.confirm, bank.match.unmatch, bank.match.override, bank.adjustment.read, bank.adjustment.approve, bank.adjustment.void, bank.reconciliation.read, bank.reconciliation.create, bank.reconciliation.complete, bank.reconciliation.reopen, bank.reconciliation.export, bank.cash.read
AUDITOR_READONLY: bank.account.read, bank.statement.read, bank.match.read, bank.adjustment.read, bank.reconciliation.read, bank.reconciliation.export, bank.cash.read
MANAGER: bank.cash.read where ABAC allows summary
SALES, INVENTORY, MARKETING, STAFF: no bank mutation permissions by default
```

Sensitive permissions:

```text
bank.account.sensitive_read
bank.statement.import
bank.statement.manual_line
bank.statement.void
bank.match.confirm
bank.match.unmatch
bank.match.override
bank.adjustment.approve
bank.adjustment.void
bank.reconciliation.complete
bank.reconciliation.reopen
bank.reconciliation.export
```

## 11. API Behavior

Route base:

```text
/v1/companies/:companyId/banking
```

Bank account actions:

- `GET /bank-accounts`
  - Permission: `bank.account.read`
  - Returns bank accounts, linked ledger account summary, open statement count, unreconciled line count, last reconciliation status, and latest known balance.
- `POST /bank-accounts`
  - Permission: `bank.account.manage`
  - Validates unique display name, currency, masked account fields, ledger account compatibility, and branch scope.
- `PATCH /bank-accounts/:bankAccountId`
  - Permission: `bank.account.manage`
  - Blocks changing currency after statement lines or matches exist.
- `POST /bank-accounts/:bankAccountId/deactivate`
  - Permission: `bank.account.manage`
  - Blocks open reconciliation/unmatched line cases unless override policy is explicit.

Statement import actions:

- `POST /bank-accounts/:bankAccountId/statement-imports/preview`
  - Permission: `bank.statement.import`
  - Accepts file reference or parsed rows, mapping, timezone/date settings, and preview mode.
  - Returns parsed rows, validation errors, duplicate warnings, opening/closing balance candidates, and commit token.
- `POST /bank-accounts/:bankAccountId/statement-imports/commit`
  - Permission: `bank.statement.import`
  - Requires preview commit token and duplicate resolution.
  - Creates import and statement lines in one transaction.
- `POST /bank-accounts/:bankAccountId/statement-lines`
  - Permission: `bank.statement.manual_line`
  - Creates manual immutable statement line with audit marker.
- `POST /statement-imports/:importId/void`
  - Permission: `bank.statement.void`
  - Blocks lines already in completed reconciliation unless session is reopened.

Matching actions:

- `GET /bank-accounts/:bankAccountId/match-candidates`
  - Permission: `bank.match.read`
  - Returns statement lines, source candidates, confidence, reasons, and remaining amounts.
- `POST /statement-lines/:statementLineId/suggestions/run`
  - Permission: `bank.match.suggest`
  - Regenerates deterministic suggestions.
- `POST /statement-lines/:statementLineId/matches`
  - Permission: `bank.match.confirm`
  - Confirms one or more source allocations.
  - Requires `bank.match.override` when amount/date/reference tolerance fails.
- `POST /matches/:matchId/reject`
  - Permission: `bank.match.confirm`
  - Rejects suggestion with reason.
- `POST /matches/:matchId/void`
  - Permission: `bank.match.unmatch`
  - Requires command id/fingerprint, expected statement-line allocation version and reason. Voids a confirmed match unless locked by completed reconciliation or consumed by a dependent tax/Ledger projection; the latter must use the owning linked reversal/supersession transaction.
- `POST /statement-lines/:statementLineId/ignore`
  - Permission: `bank.match.override`
  - Marks line ignored with reason. Ignored lines appear in evidence export.

Bank adjustment actions:

- `GET /adjustments`
  - Permission: `bank.adjustment.read`
- `POST /adjustments`
  - Permission: `bank.adjustment.create`
  - Creates draft adjustment from statement line or manual input.
- `POST /adjustments/:adjustmentId/submit`
  - Permission: `bank.adjustment.create`
- `POST /adjustments/:adjustmentId/approve`
  - Permission: `bank.adjustment.approve`
  - Default role: ACCOUNTANT or OWNER only.
  - Creates posting input and sets posting status `pending`.
- `POST /adjustments/:adjustmentId/void`
  - Permission: `bank.adjustment.void`

Reconciliation actions:

- `GET /reconciliations`
  - Permission: `bank.reconciliation.read`
- `POST /reconciliations`
  - Permission: `bank.reconciliation.create`
  - Creates or recalculates draft session for bank account and period.
- `GET /reconciliations/:sessionId`
  - Permission: `bank.reconciliation.read`
  - Returns lines, matches, open items, ignored reasons, balances, and variance.
- `POST /reconciliations/:sessionId/complete`
  - Permission: `bank.reconciliation.complete`
  - Default role: ACCOUNTANT or OWNER only.
  - Blocks unreconciled required lines, ignored lines without Accountant review and unexplained variance in every mode. Missing ledger link or closed-period policy blocks only with Ledger enabled; Bank-only completion records the matched-source-evidence basis and non-blocking Ledger status.
- `POST /reconciliations/:sessionId/reopen`
  - Permission: `bank.reconciliation.reopen`
  - Requires reason and audit.
- `POST /reconciliations/:sessionId/export`
  - Permission: `bank.reconciliation.export`
  - Generates evidence export.

Cash visibility actions:

- `GET /cash-position`
  - Permission: `bank.cash.read`
  - Returns latest statement balance, book balance, unreconciled deposits/withdrawals, pending payments, open bank adjustments, and stale reconciliation warnings.

## 12. UI Behavior

### Web

Route group:

```text
/finance/banking
```

Screens:

- Bank accounts list: account name, bank, masked number, currency, ledger link, latest statement balance, book balance, unreconciled count, last reconciled date, status.
- Bank account detail: tabs for Overview, Statement Lines, Matches, Reconciliations, Adjustments, Settings.
- Statement import: upload/select mapping, preview table, validation errors, duplicate warnings, balance preview, commit action.
- Manual statement line drawer: date, description, direction, amount, reference, running balance, reason.
- Matching workspace: left statement lines, right candidate payments, confidence indicators, split allocation, confirm/reject/ignore controls, source web links.
- Reconciliation session: period inputs, opening/closing statement balances, book movements, unmatched lines, ignored-line Accountant review, unreconciled payments, difference, complete/reopen/export actions.
- Cash position: total cash by account, stale account warnings, unreconciled deposits/withdrawals, pending source payments, ledger posting errors.

UX rules:

- Use dense finance tables and filters, not marketing-style cards.
- Use badges for status and icons for import, match, unmatch, export, reopen, and warnings.
- Show masked account numbers by default.
- Show irreversible or high-risk actions in confirmation modal with reason field.
- Disable actions optimistically only in UI; backend must enforce all permissions.
- Every bank line, match, adjustment, and session links to audit/history when current primitives exist.

### LINE

LINE can answer only via permission-checked read tools:

- "เงินสดวันนี้เท่าไร"
- "บัญชีไหนยังไม่ได้กระทบยอด"
- "รายการธนาคารที่ยังไม่ match มีอะไรบ้าง"
- "ยอดรับเงินลูกค้าที่รอกระทบยอดเท่าไร"
- "งวดเดือนนี้ปิด reconciliation หรือยัง"

LINE responses must include:

- Short summary.
- Source refs or counts.
- Web deep link for review.
- Permission-safe refusal when user lacks access.

LINE must refuse:

- Import statement.
- Confirm/unmatch.
- Complete/reopen reconciliation.
- Create/approve bank adjustment.
- Record payment or initiate transfer.

### AI Gateway

AI tools are read-only:

- `banking.cashPosition.read`
- `banking.unmatchedStatementLines.read`
- `banking.reconciliationStatus.read`
- `banking.matchCandidates.read`
- `banking.bankAccountSummary.read`

AI Gateway must call permission-checked ERP APIs/tools only. It must not import API Prisma client or banking repositories.

## 13. Audit and Outbox Events

Audit actions:

```text
bank.account.create
bank.account.update
bank.account.deactivate
bank.statement.import.preview
bank.statement.import.commit
bank.statement.import.void
bank.statement.line.create_manual
bank.match.suggest
bank.match.confirm
bank.match.reject
bank.match.void
bank.statement.line.ignore
bank.adjustment.create
bank.adjustment.submit
bank.adjustment.approve
bank.adjustment.void
bank.reconciliation.create
bank.reconciliation.complete
bank.reconciliation.reopen
bank.reconciliation.void
bank.reconciliation.export
```

Outbox events:

```text
BankAccountCreated
BankAccountUpdated
BankStatementImportCommitted
BankStatementLineMatched
BankStatementLineUnmatched
BankAdjustmentApproved
BankReconciliationCompleted
BankReconciliationReopened
BankReconciliationEvidenceExported
```

## 14. Reporting and Cash Visibility

Cash visibility must distinguish:

- Latest statement balance from imported/manual bank lines.
- Book balance from matched source payments and ledger journal lines where available.
- Unreconciled deposits.
- Unreconciled withdrawals.
- Pending source payments not yet seen on statement.
- Bank adjustment drafts and posting errors.
- Stale accounts with no recent statement import.
- Reconciled-through date per bank account.

Reports must be deterministic from stored source records and as-of date. Do not cache as source of truth unless current reporting primitives require snapshots.

## 15. Edge Cases

- Statement import has mixed debit/credit columns and signed amount column.
- Bank uses Buddhist Era year in CSV.
- Bank exports same row twice.
- Statement line has no reference number.
- Customer pays multiple invoices in one deposit.
- Bank batches card/marketplace deposits before item 19 settlement exists.
- Supplier payment appears as one withdrawal for multiple vendor bills.
- Payment recorded on web but bank date differs by several days.
- Bank fee appears with no existing expense source.
- Interest income appears with no existing accounting document source.
- Inter-account transfer appears in one bank account before the other side is imported.
- Reconciliation period overlaps a completed session.
- Ledger period is closed before reconciliation completion.
- User tries to unmatch line from completed reconciliation.
- Bank account currency differs from source payment currency.
- Source payment was voided after match suggestion but before confirmation.
- Imported running balance does not equal calculated movement.
- Statement line is manually ignored without reason.

## 16. Acceptance Criteria

- [ ] Finance can create bank/cash accounts with masked account details, currency, status, and optional ledger account link.
- [ ] Finance can preview and commit statement imports with validation, duplicate detection, and audit.
- [ ] Generic, KBank K BIZ, and SCB Business Anywhere alias presets parse supported CSV/XLSX-style rows into the normalized statement line contract.
- [ ] Finance can create manual statement lines with audit marker.
- [ ] System generates deterministic match suggestions from existing source payments and ledger cash lines where available.
- [ ] Finance can confirm, split, reject, unmatch, or ignore statement line matches according to permissions.
- [ ] Matching blocks over-allocation, wrong sign, wrong currency, and variance without override permission.
- [ ] Bank adjustment drafts support bank fee, interest, owner contribution/draw, inter-account transfer, and other review categories.
- [ ] Approved bank adjustments expose ledger-ready posting inputs and posting status.
- [ ] Finance can create reconciliation sessions with opening balance, statement balance, book balance, difference, matched lines, ignored lines, and open items.
- [ ] Accountant can review ignored lines and complete reconciliation sessions.
- [ ] A Bank-only company can complete from retained balances/matches without a Ledger link; later Ledger enable binds/backfills without re-import/re-match and consolidates any unresolved mapping into one prefilled task.
- [ ] Completed reconciliation locks included lines until reopened by authorized user with reason.
- [ ] Finance or Accountant can export JSON/CSV/XLSX/PDF reconciliation evidence.
- [ ] Cash position view shows statement balance, book balance, unreconciled deposits/withdrawals, pending payments, and stale account warnings.
- [ ] Permission keys protect all read/write/sensitive actions server-side.
- [ ] Audit/outbox events exist for important changes when primitives exist.
- [ ] LINE/AI can answer read-only banking summaries and refuses mutation.
- [ ] Item 13 remains unchecked until implementation and verification commands pass.

## 17. Test Cases

- Unit: statement row normalization from debit/credit/signed columns.
- Unit: KBank K BIZ and SCB Business Anywhere preset alias mapping.
- Unit: duplicate hash generation and duplicate classification.
- Unit: match suggestion scoring by amount, date, reference, counterparty, and direction.
- Unit: split allocation prevents over-allocation.
- Unit: reconciliation balance calculation and zero-variance completion rule.
- Unit: bank adjustment posting input maps debit/credit lines correctly.
- Integration: create bank account, import statement preview, commit lines, and audit events.
- Integration: match customer payment deposit from item 08 payment source.
- Integration: match supplier payment withdrawal from item 12 payment source when available.
- Integration: complete reconciliation session and lock matched lines.
- Integration: Bank-only completion succeeds with `ledgerAccountId=null`; OFF→ON resolves/backfills the retained session without re-import/re-match, while unresolved mapping creates one task.
- Integration: ignored statement line blocks completion until Accountant review exists.
- Integration: reopen reconciliation and unmatch line with reason.
- API permission: unauthorized role cannot import, match, complete, reopen, export, or read sensitive account fields.
- UI: statement import preview handles validation errors and duplicate warnings.
- UI: matching workspace supports confirm/reject/ignore/split flow.
- UI: reconciliation screen blocks completion with visible error state when difference is non-zero.
- AI/LINE: read tools return scoped summaries and mutation requests are refused.
- Edge: missing link/closed ledger period blocks completion only when item 10 is enabled.

## 18. Open Questions

- Which Thai bank CSV formats should become first built-in parser presets after generic mapping works?
- Which exact exported headers should replace the alias presets after collecting real KBank and SCB sample files?
- Should bank adjustment approval use same approval engine as procurement/reimbursement when workflow automation exists?

## 19. Owner Update 2026-07-06 — Statement Upload as Closing Input, Duplicate Goal

- Statements can be uploaded at any time, including overlapping ranges and re-uploads. The hard requirement is only that duplicated data must never corrupt balances or reports.
- Any dedupe design that guarantees this is acceptable; the current line-hash dedupe with `skip` default qualifies. An update/supersede policy is optional, not required.
- Lines already matched or locked by a completed reconciliation must never be silently replaced by a later upload.
- Statement/reconciliation status becomes an evidence input for period-close readiness (see Double-Entry Ledger and Closing Spec owner update 2026-07-06, checklist item 10E).

## 20. Owner Update 2026-07-06 (2) — PDF/Photo Statement Intake via AI/OCR (new requirement)

- New requirement: staff can upload a bank statement as a PDF or photo and the system extracts the rows ("OCR statement"). Today's import accepts structured CSV/XLSX rows only; OCR exists in the repo only for employee receipts (item 09). This section adds the missing intake path.
- Recommended approach (recorded because the owner asked for a direction between OCR and the current path):
  - CSV/XLSX stays the canonical, preferred intake. Bank-exported files carry exact figures and parse deterministically — when the user has a choice, the UI should nudge them to CSV/XLSX.
  - PDF/photo becomes an ADDITIONAL intake that funnels into the SAME preview -> human-commit flow. Extraction order: PDF text layer first (most Thai bank PDFs are text PDFs — no AI model involved), real OCR via the AI Gateway (item 09 receipt-OCR pattern) only for scans/photos.
  - Extraction output is candidate rows only, never a commit: per-row confidence, mandatory human preview (same screen as CSV), and deterministic guardrails before commit — running-balance continuity check across extracted rows, date/amount validation, and the existing `statementLineHash` dedupe so a CSV and a PDF of the same period can never double-import.
  - AI/OCR never mutates banking state. Commit stays behind `bank.statement.import` with the same audit/outbox events; extraction provenance is stored on the import record (`sourceKind: csv_xlsx | pdf_text | ocr`, model id when OCR ran) for audit.
- Scope: extends item 13's statement-import phase only; matching/reconciliation behavior is unchanged. Plan tasks: [[plans/bank-reconciliation-plan|Bank Accounts and Reconciliation Plan]] follow-up scope 2026-07-06.
