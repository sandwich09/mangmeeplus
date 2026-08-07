# Fixed Assets Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 21.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/fixed-assets-plan|Fixed Assets Plan]]

This spec is a product and engineering baseline, not accounting, tax, legal, or audit advice. Before implementation, activation, export, or release, verify current Thai accounting policy, Revenue Department tax depreciation rules, document retention rules, and accountant requirements. Do not hard-code statutory rates, useful-life defaults, depreciation limits, or tax treatment in business logic.

Owner decision on 2026-07-05: item 21 is pulled forward for docs readiness. It remains unchecked until implementation and verification pass.

## 2. Goal

Ship the first trustworthy fixed-assets slice for Thai SMEs:

- Fixed asset register with category, branch/location, custodian, serial/tag, evidence, cost, useful life, residual value, and status.
- Capitalization workflow from purchase/AP/expense/manual source evidence.
- Accounting depreciation schedule and monthly depreciation run.
- Disposal, write-off, impairment/adjustment, and transfer/custody history.
- Ledger-ready source posting inputs for acquisition, depreciation, disposal, gain/loss, and write-off.
- Tax/report hooks without making fixed assets the tax filing or ledger authority.
- Approval, permission, audit, outbox, report, dashboard, workflow, and read-only AI/LINE integration.

Item 21 must connect earlier finance foundations without creating parallel accounting. Accounting documents, procurement/AP, expenses, and manual evidence create asset candidates or capitalization sources. Fixed Assets owns the asset register and depreciation schedule. Ledger item 10 owns journal generation and financial statements. Thai Tax item 11 owns tax periods, tax filing/export lifecycle, and any statutory tax treatment.

## 3. Non-goals

- Accounting, tax, legal, or audit advice as final authority.
- Auto-filing, portal submission, or direct mutation of Revenue Department, DBD, bank, vendor, marketplace, or government systems.
- Replacing item 10 chart of accounts, posting rules, journals, period close, or financial statements.
- Replacing item 11 tax event review, tax filing packages, or tax export authority.
- Replacing item 12 procurement/AP, item 09 expense capture, or item 08 accounting document workflows.
- Physical asset scanning app, RFID/NFC integration, barcode hardware management, IoT telemetry, GPS tracking, maintenance management, insurance claims, leasing accounting, revaluation-heavy enterprise fixed asset accounting, component accounting, construction-in-progress, or multi-book statutory engine in first pass.
- Multi-currency acquisition, foreign exchange revaluation, complex group/intercompany asset transfers, or IFRS/TFRS policy automation beyond source fields and review gates.
- LINE or AI mutation for capitalization, approval, depreciation run, disposal, write-off, export, posting, tax treatment, permission, or accounting policy.

## 4. Product Decisions for First Pass

- Web/API own all fixed-asset mutations.
- LINE and AI are read-only for fixed assets and can only summarize, explain, and deep-link through permission-checked tools.
- First pass supports one accounting depreciation book per company. Tax book fields may exist as review metadata, but tax calculations/export authority stays item 11.
- Depreciation method starts with straight-line monthly depreciation. Manual adjustment lines are allowed only through approved adjustment/impairment workflow.
- Asset capitalization requires source evidence: vendor bill line, expense record, accounting document/payment, or manual capitalization packet with attachment and reason.
- Supplier/AP bill lines may be flagged as fixed-asset candidates, but item 21 owns final capitalization and asset register creation.
- Expenses may be marked as asset candidates during finance review, but item 21 owns final capitalization.
- Capitalized assets start depreciation from configured available-for-use date, not necessarily invoice/payment date.
- Disposals and write-offs require approval by default and must stop future depreciation.
- Corrections after capitalization use adjustment, reversal, disposal/write-off, or depreciation correction records. Do not silently edit locked historical depreciation lines.
- Ledger integration emits source posting inputs only. Item 10 generates journals and respects period close.
- Reports integration registers fixed-asset datasets when item 18 report primitives exist.
- Attachments use item 04 attachment primitives. Do not store public asset evidence URLs.
- Document numbers use shared document sequence primitives.

## 4.1 Backlog Notes

Do not build these in the first implementation pass:

- RFID/NFC/scanner hardware flows, physical count mobile app, GPS/IoT tracking, maintenance scheduling, insurance/claim workflow, lease accounting, construction-in-progress, component depreciation, asset revaluation reserve accounting, and multi-book statutory/tax engine.
- Auto-posting journals without item 10 posting rules and period close checks.
- Tax filing/export mutation without item 11 review/export lifecycle.
- Marketplace, procurement, bank, or government system mutation.
- LINE/AI final fixed-asset mutation, approval, export, posting, disposal, write-off, or tax treatment.

Recommended follow-up when first pass is stable:

- Add physical asset count/reconciliation and tag-print workflow.
- Add maintenance and warranty reminders.
- Add tax book depreciation once accountant-reviewed statutory rules are modeled as verified configuration.
- Add leasing and construction-in-progress only as separate approved scopes.
- Add bulk import after single-asset lifecycle and ledger/tax/report hooks are proven.

## 5. User Roles

- Owner: sees asset value, depreciation exposure, disposal/write-off approvals, and audit trail.
- Admin: configures asset categories, tags, locations, and module settings when granted; no accounting policy override unless granted.
- Finance: creates asset candidates, reviews capitalization packets, manages asset register, runs depreciation draft, and prepares disposal/write-off records.
- Accountant: verifies capitalization policy, depreciation policy, posting readiness, tax review metadata, disposal accounting, and period close blockers.
- Manager/Approver: approves capitalization, transfer, disposal, or write-off where company policy grants.
- Inventory/Warehouse: reads assigned asset location/tag/custody information when granted; does not mutate accounting values by default.
- Staff/Custodian: reads own assigned assets only if employee/custodian mapping exists and self-service is enabled.
- Auditor readonly: reads asset register, evidence, depreciation history, posting status, reports, and audit trail without mutation.
- AI assistant user: asks scoped read-only questions and receives explanations with source refs and web deep links.

## 6. Boundary and Ownership

Fixed Assets owns:

- Asset categories, capitalization policy metadata, and default accounting mappings.
- Asset register lifecycle, asset identity, tag/serial, location/custodian assignment, and status history.
- Capitalization review/approval and capitalization source links.
- Depreciation schedule, depreciation runs, depreciation lines, and depreciation corrections.
- Asset transfer/custody history, impairment/adjustment, disposal, write-off, and reversal records.
- Fixed-asset permissions, audit names, outbox events, web pages, and report source adapters.

Accounting documents item 08 owns:

- Sales/customer accounting documents, receipt/payment workflows, document status, and source posting inputs for those records.

Expense item 09 owns:

- Expense/receipt evidence intake, OCR/AI extraction, tax evidence status, category review, and confirmed expense lifecycle.
- Item 09 may mark an expense as an asset candidate only. Item 21 owns final asset creation.

Procurement/AP item 12 owns:

- Supplier, purchase request/order, goods receipt, vendor bill, AP, supplier payment, and purchase-side evidence.
- Item 12 may flag vendor bill lines as fixed-asset candidates only. Item 21 owns final capitalization.

Ledger item 10 owns:

- Chart of accounts, posting rules, journal generation, period close/unclose, GL, Trial Balance, P&L, and Balance Sheet.
- Fixed Assets emits source posting inputs and posting status updates only.

Thai Tax item 11 owns:

- Tax periods, filing/export packages, review lifecycle, and statutory tax event treatment.
- Fixed Assets emits tax review candidates and asset tax metadata only.

Reports item 18 owns:

- Report catalog, saved views, exports, and report-ready notification primitives.
- Fixed Assets registers datasets and source permissions when report primitives exist.

AI Gateway owns:

- Permission-checked read tools and summaries. It must call ERP APIs/tools, not fixed-asset repositories or Prisma directly.

## 7. Current Repository Baseline

Current docs/code snapshot on 2026-07-05 shows no existing fixed-assets module or shared contract. Item 21 should start after these foundations:

- Item 04 data model core: company, branch, attachment, document sequence, audit, and outbox primitives.
- Item 08 accounting documents: source financial documents and payment evidence.
- Item 09 expense/receipt upload: receipt evidence and expense review fields.
- Item 10 ledger/period close: posting rules, generated journals, source posting adapter contract, and close policy.
- Item 11 Thai tax: tax event review/export authority.
- Item 12 procurement/AP: vendor bills, goods receipts, AP, and supplier payment source data.
- Item 16 workflow: approval/review/deadline tasks.
- Item 17 AI draft/suggestion: reviewable AI suggestions, not final fixed-asset mutation.
- Item 18 reports/BI: dataset registry and controlled export behavior.
- Item 20 payroll/HR: optional employee/custodian context if already implemented.

Before implementation, inspect latest code again. Previous roadmap items may add Prisma models, request context, auth guards, permission registry, audit/outbox helpers, attachment storage, document sequences, ledger source adapters, tax adapters, report datasets, workflow hooks, notification events, web routes, and shared API clients.

## 8. Linked References

- Plan: [[plans/fixed-assets-plan|Fixed Assets Plan]]
- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 21
- Accounting documents: [[specs/accounting-documents-spec|Accounting Documents Spec]]
- Expense receipt upload: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Procurement/AP: [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
- Ledger: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
- Thai tax: [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
- Reports: [[specs/reports-bi-spec|Reports BI Spec]]
- Workflow automation: [[specs/workflow-automation-spec|Workflow Automation Spec]]
- AI Draft/Suggestion: [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]]
- Permission matrix: [[specs/permission-matrix|Permission Matrix]]
- Web shell: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Web guideline: [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## 9. Business Workflow

### Setup

1. Admin/Accountant creates asset categories with code, name, default useful-life policy, residual-value policy, asset account mapping, accumulated depreciation mapping, depreciation expense mapping, gain/loss mapping, and tax review behavior.
2. Finance configures asset tag sequence, capitalization threshold guidance, default branch/location, and approval policy.
3. Accountant verifies that category mappings point to valid ledger accounts when item 10 exists.
4. System blocks active policy use when required mappings or reviewer metadata are missing.

### Capitalization

1. Finance sees asset candidates from vendor bill lines, confirmed expenses, accounting documents, or manual evidence packet.
2. Finance creates capitalization draft with source link, asset category, description, acquisition date, available-for-use date, cost, tax treatment review status, branch/location, custodian, serial/tag, useful life, residual value, and attachments.
3. System validates source status, duplicate source use, amount, currency, dates, category policy, closed period, attachment/evidence, and permissions.
4. Finance submits capitalization for approval.
5. Accountant/Manager/Owner reviews capitalization, cost, source evidence, useful life, residual value, and ledger/tax mappings.
6. Approved capitalization creates or activates fixed asset register record, locks source snapshot fields, creates initial transaction history, emits outbox/audit event, and exposes ledger/tax/report source data.

### Depreciation

1. Finance/Accountant opens monthly depreciation run for company/branch/book/period.
2. System loads active depreciable assets, category policy, cost, accumulated depreciation, residual value, available-for-use date, disposal/write-off status, closed period state, and previous runs.
3. System calculates draft straight-line depreciation lines using decimal-safe math.
4. Blocking review issues are shown: missing policy, missing ledger mapping, negative book value, duplicate period, disposed asset, closed period, unverified tax/accounting policy, or source mismatch.
5. Accountant reviews, adjusts only through explicit adjustment reason if allowed, and submits/approves run.
6. Approved run locks depreciation lines, emits posting inputs for item 10, updates asset accumulated depreciation/read models, and registers report events.

### Transfer and Custody Change

1. Finance or authorized manager creates transfer/custody change draft.
2. System records from/to branch, location, custodian, reason, effective date, and evidence.
3. Transfer does not change acquisition cost, accumulated depreciation, or ledger postings unless a later approved accounting policy says so.
4. Approved transfer updates current assignment and preserves immutable history.

### Impairment, Adjustment, and Correction

1. Accountant creates impairment or adjustment proposal with reason, amount, effective date, evidence, and posting/tax review metadata.
2. System validates non-negative carrying amount, period close, permissions, and source refs.
3. Owner/Accountant approval locks the adjustment and emits posting input.
4. Historical depreciation lines are not edited silently; corrections use reversal/adjustment records.

### Disposal and Write-off

1. Finance creates disposal/write-off draft for active asset with reason, disposal date, proceeds if any, buyer/reference if any, attachments, and tax review status.
2. System calculates carrying amount, accumulated depreciation to date, gain/loss candidate, and posting inputs.
3. Manager/Owner/Accountant approves according to policy.
4. Approved disposal/write-off stops future depreciation, locks disposal transaction, emits ledger/tax/report source data, and updates asset status.

## 10. Core Business Rules

- Server derives company, user, membership, roles, permissions, and ABAC scope from trusted auth context.
- Client-sent company, role, permission, branch, location, custodian, source amount, and posting status are hints only.
- Asset register is company-scoped. Branch/location/custodian ABAC narrows read/write where available.
- Asset numbers/tags use shared document sequence or explicit unique tag validation per company.
- Source evidence is required for capitalization, disposal/write-off, impairment, and material adjustment.
- A source line cannot be capitalized into multiple assets unless the source supports explicit split allocation and the full allocated amount reconciles.
- One asset can be created from multiple source lines only when every source link is approved and the total reconciles.
- Capitalized cost, residual value, depreciation amount, impairment amount, proceeds, and carrying amount use decimal-safe math and contract strings.
- Residual value cannot exceed capitalized cost.
- Depreciable base cannot be negative.
- Accumulated depreciation cannot exceed capitalized cost minus residual value unless an approved correction/write-off explains it.
- Depreciation starts on available-for-use date by company policy.
- Depreciation stops after disposal/write-off date.
- Depreciation run is unique per company/book/period.
- Re-running a draft depreciation run replaces draft lines only. Approved/posting-ready lines are immutable.
- Depreciation for a closed ledger period is blocked unless item 10 provides an approved adjustment path.
- Disposal/write-off in a closed period is blocked unless item 10 allows an adjustment period.
- Manual changes to useful life, residual value, category, cost, or depreciation method after capitalization require reason, audit, and recalculation/correction preview.
- Tax depreciation metadata is review guidance until item 11 consumes it. Fixed Assets does not file tax or create tax export packages.
- Posting status is derived from item 10 results. Fixed Assets must not mark journals posted by itself.
- LINE/AI cannot create, edit, approve, run depreciation, dispose, write off, export, post, change policy, or mutate permissions.

## 11. Statuses and Enumerations

Asset status:

```text
DRAFT
PENDING_CAPITALIZATION
ACTIVE
SUSPENDED
FULLY_DEPRECIATED
HELD_FOR_DISPOSAL
DISPOSED
WRITTEN_OFF
ARCHIVED
```

Capitalization status:

```text
DRAFT
PENDING_REVIEW
APPROVED
CAPITALIZED
REJECTED
VOIDED
```

Depreciation method:

```text
STRAIGHT_LINE_MONTHLY
MANUAL_REVIEW_ONLY
```

Depreciation run status:

```text
DRAFT
CALCULATED
NEEDS_REVIEW
PENDING_APPROVAL
APPROVED
POSTING_READY
POSTED
VOIDED
```

Asset transaction type:

```text
CAPITALIZATION
DEPRECIATION
TRANSFER
CUSTODY_CHANGE
IMPAIRMENT
ADJUSTMENT
DISPOSAL
WRITE_OFF
REVERSAL
```

Posting status:

```text
NOT_READY
READY
SUBMITTED
POSTED
BLOCKED
REVERSED
```

Tax review status:

```text
NOT_REVIEWED
REVIEW_NEEDED
REVIEWED
EXCLUDED
```

## 12. Data Model Contract

Use current Prisma and domain conventions, but the implementation should include these logical records:

- `FixedAssetCategory`: code, name, status, default useful life, residual policy, depreciation method, ledger account mappings, tax review metadata.
- `FixedAsset`: company, asset number/tag, category, description, serial, branch/location, custodian, acquisition/available dates, cost, residual value, useful life, method, status, current carrying values, posting/tax/report status.
- `FixedAssetSourceLink`: source type, source id, source line id, amount, attachment ids, snapshot JSON, allocation status.
- `FixedAssetTransaction`: immutable transaction history for capitalization, depreciation, transfer, impairment, adjustment, disposal, write-off, reversal.
- `AssetDepreciationRun`: company/book/period, status, totals, reviewer, approval, posting batch/source ref.
- `AssetDepreciationLine`: run, asset, period, opening cost, opening accumulated depreciation, depreciation amount, closing accumulated depreciation, closing carrying amount, review issue.
- `AssetDisposal`: disposal/write-off draft and approval record with proceeds, carrying amount, gain/loss candidate, evidence, tax review status, posting source ref.
- `AssetAssignmentHistory`: branch/location/custodian effective history.
- `AssetReviewIssue`: blocking/warning issue for capitalization, depreciation, disposal, tax, ledger, or source evidence.

Implementation may merge or split tables to match repo patterns, but it must preserve these behaviors and immutable history.

## 13. API and Contract Behavior

Expected shared contract file:

```text
packages/contracts/src/fixed-assets.ts
```

Expected API route base:

```text
/v1/companies/:companyId/fixed-assets
```

Required API behaviors:

- List asset categories and assets with filters by status, category, branch/location, custodian, acquisition date, depreciation period, posting status, and tax review status.
- Create/update/archive asset category and policy.
- Create capitalization draft from source link or manual evidence.
- Submit, approve, reject, void, and capitalize approved capitalization.
- Read asset detail with source links, transactions, depreciation schedule, assignments, disposal/write-off state, posting status, and audit refs.
- Update editable asset fields before capitalization; require adjustment workflow after capitalization for sensitive fields.
- Create/calculate/recalculate draft depreciation run.
- Submit/approve/void depreciation run and expose posting-ready source inputs.
- Create/approve transfer/custody change.
- Create/approve impairment/adjustment.
- Create/approve/void disposal/write-off.
- Export/read reports only through report/export primitives when item 18 exists.

API responses must use typed errors for permission denied, closed period, duplicate source allocation, invalid depreciation policy, negative carrying amount, missing evidence, stale source state, and posting/tax unavailable.

## 14. Web UX

Add a Fixed Assets workspace under finance/accounting navigation when permissions allow:

- Asset Register: list, filters, status badges, carrying value, depreciation status, posting status, tax review status, and deep links.
- Asset Detail: overview, source evidence, depreciation schedule, transaction timeline, assignments, disposal/write-off panel, audit links.
- Capitalization Queue: candidates from procurement/AP, expenses, accounting/manual evidence; review, split/merge allocation, submit/approve.
- Depreciation Runs: period selector, calculate/review/approve, issues, totals, posting-ready state.
- Disposal/Write-off: draft, approval, carrying amount, proceeds, gain/loss candidate, evidence.
- Categories and Policies: category defaults, ledger mappings, useful-life guidance, status.
- Reports: asset register, depreciation schedule, NBV roll-forward, disposal/write-off summary, audit evidence export where reports module supports it.

UI states must cover loading, empty, forbidden, partial integration unavailable, stale source, closed period blocked, review issues, posting blocked, and export unavailable.

## 15. Permission Keys

Use the keys in [[specs/permission-matrix|Permission Matrix]]:

```text
fixed_asset.category.read
fixed_asset.category.manage
fixed_asset.policy.read
fixed_asset.policy.manage
fixed_asset.asset.read
fixed_asset.asset.create
fixed_asset.asset.update
fixed_asset.asset.archive
fixed_asset.capitalization.review
fixed_asset.capitalization.approve
fixed_asset.depreciation.read
fixed_asset.depreciation.run
fixed_asset.depreciation.review
fixed_asset.depreciation.approve
fixed_asset.depreciation.post
fixed_asset.transfer.create
fixed_asset.transfer.approve
fixed_asset.adjustment.create
fixed_asset.adjustment.approve
fixed_asset.disposal.read
fixed_asset.disposal.create
fixed_asset.disposal.approve
fixed_asset.disposal.void
fixed_asset.report.read
fixed_asset.report.export
fixed_asset.ai.read
```

Permission rules:

- OWNER has all fixed-asset permissions.
- FINANCE can create/update asset drafts, run depreciation draft, create disposal/transfer drafts, and export reports when granted.
- ACCOUNTANT can review/approve accounting policy, depreciation, posting readiness, tax metadata, and disposal/write-off.
- ADMIN can manage categories/settings only when granted and cannot bypass accounting approvals by default.
- MANAGER can approve transfer/disposal/capitalization only where policy/ABAC allows.
- AUDITOR_READONLY can read/export audit-safe fixed-asset records.
- LINE/AI require `fixed_asset.ai.read` plus source read permissions for summaries.

## 16. Integration Requirements

### Ledger

- Emit source posting inputs for acquisition/capitalization, depreciation, impairment/adjustment, disposal proceeds, gain/loss, write-off, and reversal.
- Respect closed periods before capitalization, depreciation approval, disposal/write-off, and adjustment.
- Consume posting result/status from item 10; never create journal rows directly from fixed-assets repositories.

### Tax

- Emit tax review candidates with source refs, asset category, acquisition date, cost, depreciation metadata, disposal/write-off metadata, and reviewer status.
- Do not calculate final statutory tax treatment unless item 11 provides verified rule config and explicit adapter contract.
- Do not file, submit, or export tax packages directly.

### Reports

- Register fixed-asset datasets when item 18 exists:
  - `fixed_asset.register`
  - `fixed_asset.depreciation_schedule`
  - `fixed_asset.roll_forward`
  - `fixed_asset.disposal_summary`
- Missing fixed-assets module must show unavailable state in reports until implementation exists.

### Workflow and Notifications

- Create review/approval tasks for capitalization, depreciation run approval, disposal/write-off, impairment/adjustment, and closed-period blocker where workflow primitives exist.
- Notify owner/accountant/finance for high-risk disposal/write-off, failed depreciation run, missing ledger mappings, and asset policy gaps.

### LINE and AI

- Allow read-only answers for asset count, NBV, depreciation due, disposal status, missing mappings, and blocked reviews when user has scoped read permissions.
- Always deep-link to web for action.
- Refuse fixed-asset mutation, approval, depreciation run, disposal/write-off, export, posting, tax treatment, or policy changes.

## 17. Edge Cases

- Source amount split across multiple assets.
- Multiple source lines combined into one asset.
- Duplicate supplier invoice/expense accidentally offered as candidate twice.
- Asset available-for-use date before/after invoice/payment date.
- Residual value greater than cost.
- Useful life changed after depreciation started.
- Depreciation run recalculated while source asset changed.
- Asset disposed mid-period.
- Asset fully depreciated but still active.
- Closed ledger/tax period blocks depreciation or disposal.
- Disposal proceeds exceed carrying amount.
- Write-off with missing evidence.
- Asset category ledger mapping removed after assets exist.
- Permission revoked after export requested but before download.
- LINE/AI request asks to "run depreciation" or "write off asset"; system refuses and links web.

## 18. Required Tests

At minimum:

- Contract tests for DTO enums, money string fields, permissions, and typed errors.
- Domain tests for straight-line monthly depreciation, residual value floor, duplicate period, disposal stop date, source allocation reconciliation, and closed-period blockers.
- Permission tests for finance/accountant/admin/manager/auditor/LINE/AI boundaries.
- API tests for capitalization, depreciation run, transfer, adjustment, disposal/write-off, and posting source output.
- Repository tests or integration tests for immutable transaction history and source-link uniqueness.
- Web tests for register, capitalization queue, depreciation run, disposal approval, forbidden, loading, empty, and blocked states.
- AI/LINE tests for read summaries and mutation refusals.
- Report adapter tests if item 18 exists.

## 19. Acceptance Criteria

- Asset category and policy setup exists with permission and audit controls.
- Finance can create capitalization draft from source evidence; accountant/approver can approve; asset register becomes active with immutable source snapshot.
- Monthly straight-line depreciation run calculates, shows issues, approves, locks lines, and emits ledger-ready source posting inputs.
- Disposal/write-off workflow calculates carrying amount and gain/loss candidate, requires approval, stops future depreciation, and emits source refs.
- Transfer/custody history is auditable and does not mutate accounting values.
- Ledger/tax/report/workflow/notification/AI integration points are explicit and permission-checked.
- LINE/AI can summarize and deep-link only; all fixed-asset mutations stay web/API.
- Permission matrix, checklist, roadmap, plan, spec, and memory agree on item 21 state.

## 20. Implementation Handoff

Sonnet 4.6 should implement Phase 0 and Phase 1 from [[plans/fixed-assets-plan|Fixed Assets Plan]] first. Continue phase by phase only after each phase leaves touched packages typecheckable and focused tests pass.

Do not mark item 21 complete until all implementation phases, migration/seed, permission sync, backend/frontend tests, report/AI refusal checks, and at least one browser or API smoke path are recorded in [[plans/master-implementation-checklist|Master Implementation Checklist]] and [[agent-memory/fixed-assets-21|Fixed Assets Memory]].
