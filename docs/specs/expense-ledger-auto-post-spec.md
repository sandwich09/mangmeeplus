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

- Auto-posting sales documents, procurement bills, later expense-payment settlement
  (`expense.payment`), supplier payments, or reimbursements in this phase.
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

No new table is required.

- Reuse `CompanyFeatureEntitlement(featureKey='double_entry_ledger')`.
- Add approved feature key `expense_auto_post`; it is disabled by default.
- Reuse its `updatedAt` as the new-document activation boundary.
- Reuse `ExpenseRecord.postingStatus`, `postingError`, `journalEntryId`, `confirmedAt`.
- Compute the next outstanding expense posting source from existing generated journals; do not add another
  persisted posting-state field in this phase.
- Reuse `OutboxEvent` as durable source-event evidence, but do not treat its single publish status as a
  multi-consumer ledger queue. The worker scans authoritative pending expense rows.

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
  only post-activation pending expenses.
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
