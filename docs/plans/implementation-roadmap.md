# Implementation Roadmap

## Purpose

Summarize the build path for WatchDog-BMS.

Canonical execution order lives in [[plans/master-implementation-checklist|Master Implementation Checklist]]. This roadmap explains why the order exists and what each milestone unlocks.

Web is the full Business OS workspace. LINE is the AI assistant, summary, alert, account-linking, and deep-link channel. AI lives behind a separate AI Gateway and must use permission-checked tools.

## MVP 1 Focus Sequence

Owner-level MVP 1 sequencing across CRM LINE, WatchDog shared LINE OA, and bill/receipt capture lives in [[plans/mvp-1-crm-line-bill-capture-sequence|MVP 1 Execution Sequence: CRM LINE + Bill Capture]].

Use that plan to prioritize remaining product closure across items 08, 09, 10B/10F, and 15A. Use this roadmap and the master checklist for canonical item ownership and verification.

Customer-management closure 2026-07-12: `/companies/:companyId/customers` is the single production directory across manual, walk-in, phone, web, LINE, and AI-assisted-preview intake. Item 15 owns canonical identity/re-point/merge; item 15A owns verified company-OA ingestion. This slice is implemented and locally accepted with security re-audit P0/P1 = 0, full package tests/builds, all 53 migrations from empty PostgreSQL, and browser create/edit/duplicate/masked-LINE/Customer-360 evidence in [[agent-memory/customer-management-identity-linking]]. Both broad items remain unchecked for their unrelated wider gates.

Cross-cutting AI production gate 2026-07-12: [[plans/ai-permission-tools-production-gap-closure-plan|AI Permission and Tool Production Gap Closure Plan]] is the implementation-ready remediation path for items 07, 09, 10B, 10C/10C+, 15A, 17, and 24. It is a plan only; affected AI paths are not production-ready until its role/end-user, AgentCore, tool-parity, customer-autonomy, receipt, E2E, canary, and rollback gates pass.

Reviewed + MVP1-scoped 2026-07-12: gap ledger CONFIRMED by two independent reviews; the active implementation pass is reduced to MVP1 AI capabilities (items 09 expense/receipt + 15A CRM customer AI/booking, plus the security prerequisite on the shared internal tool route). Non-MVP1 AI tools (bank/hr/tax/workflow/inventory/ledger/dashboard/reports) and employee role/ABAC governance remain in the plan but deferred. Split-engine (Codex + Claude) harness and lane ownership: [[agent-memory/ai-permission-tools-mvp1-harness]].

## Roadmap

| Order | Milestone                                   | Outcome                                                                                                                                         | Primary Links                                                                                                                                                         |
| ----: | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    01 | Platform Foundation                         | Local/prod foundation, service shells, Docker, config, CI gates.                                                                                | [[plans/platform-foundation-phase-1-plan]], [[plans/platform-foundation-local-prod-lean-plan]], [[plans/platform-environment-setup-plan]]                             |
|    02 | Auth, RBAC, and Audit                       | LINE Login, account linking, company membership, permissions, audit.                                                                            | [[specs/auth-authorization-rbac-spec]], [[specs/permission-matrix]], [[specs/line-ai-channel-auth-spec]]                                                              |
|    03 | Web Core Workspace                          | Shared full-workspace web shell, navigation, forms, list/detail patterns.                                                                       | [[specs/web-core-workspace-spec]], [[plans/web-core-workspace-plan]]                                                                                                  |
|    04 | Data Model Core                             | Company, branch, attachment, sequence, audit, outbox primitives.                                                                                | [[specs/data-model-core-spec]], [[plans/data-model-core-plan]]                                                                                                        |
|    05 | Inventory MVP                               | Product, location, movement, derived stock balance, web scan/actions.                                                                           | [[specs/inventory-mvp-spec]], [[plans/inventory-mvp-plan]]                                                                                                            |
|    06 | Dashboard and Notification                  | KPI dashboard, alert rules, web notification center, LINE delivery.                                                                             | [[specs/dashboard-notification-spec]], [[plans/dashboard-notification-plan]]                                                                                          |
|    07 | LINE AI Read-Only Assistant                 | LINE questions, permission-checked read tools, source refs, web links.                                                                          | [[specs/line-ai-read-only-assistant-spec]], [[specs/line-ai-channel-auth-spec]], [[specs/line-ai-assistant-ux-spec]], [[specs/ai-gateway-agents-spec]]                |
|    08 | Accounting Documents MVP                    | Quotation, invoice, receipt, tax invoice, payment, document status, ledger-ready source documents.                                              | [[specs/accounting-documents-spec]], [[plans/accounting-documents-mvp-plan]]                                                                                          |
|    09 | Expense and Receipt Upload                  | Web/LINE expense-document intake including receipt, tax invoice, transfer slip, handwritten bill, marketplace screenshot, and text note; categories; tax evidence status; multi-line AI auto-keying; substitute receipt; LINE AI signature-image ticket intake; owner-approved company signature fill; accountant web evidence view and generic Thai accounting-office export package; ledger-ready source. | [[specs/expense-receipt-upload-spec]], [[plans/expense-receipt-upload-plan]], [[specs/typhoon-receipt-ocr-spec]], [[plans/typhoon-receipt-ocr-plan]]                  |
|   09A | Business Document Image Intake              | Cross-domain classify-before-create gate for receipts, bills/orders, quotations, scheduling documents, signatures, non-financial, unreadable, and multi-document images. | [[specs/business-document-image-intake-spec]], [[plans/business-document-image-intake-plan]] |
|   09B | Substitute Receipt Evidence Hardening       | Implemented and locally verified 2026-07-13: immutable/versioned internal expense evidence with original-source retention, Revenue Department-aligned artifact, VAT safety, branch/permission gates, rendered payer certification plus separate approval, and resolvable accountant export. | [[specs/expense-receipt-upload-spec]], [[plans/substitute-receipt-evidence-hardening-plan]] |
|   09C | Substitute Receipt Company Policy           | Implemented and locally verified 2026-07-13: company-configured eligible approvers, cash-evidence policy, fail-closed runtime enforcement, transparent exact-artifact payer/approver signatures, and persisted two-user issuance smoke. | [[specs/expense-receipt-upload-spec]], [[plans/substitute-receipt-company-policy-plan]] |
|    10 | Double-Entry Ledger and Period Closing      | Chart of accounts, generated locked journals, GL, trial balance, P&L, balance sheet, close/unclose policy.                                      | [[specs/double-entry-ledger-closing-spec]], [[plans/double-entry-ledger-closing-plan]]                                                                                |
|   10A | Admin Company Onboarding and Partner Mgmt   | Admin creates partner/owner, configures features/model/shared LINE readiness, customer first-login links WatchDog shared LINE OA and selected company context, read-only AI has no autonomous agent. | [[specs/admin-company-onboarding-spec]], [[plans/admin-company-onboarding-plan]]                                                                                       |
|   10B | LINE AI Local Agent Orchestration           | LINE Intake Router Agent, cross-domain business-document reference routing, governed AI Gateway specialist agents, permission-checked tools, safe LINE replies, and production-ready real AI runtime path before Thai Tax MVP. | [[specs/line-ai-local-agent-orchestration-spec]], [[specs/business-document-image-intake-spec]], [[specs/ai-runtime-production-integration-spec]], [[plans/line-ai-local-agent-orchestration-plan]], [[plans/ai-runtime-production-integration-plan]], [[runbooks/line-ai-local-agent-10b-runbook]] |
|   10C | Employee Access and Role Management         | Customer owner/admin creates draft-safe employee users, then explicitly activates temporary-password, role, permission, and LINE-link access only when the wizard is finished. | [[specs/employee-access-role-management-spec]], [[plans/employee-access-role-management-plan]], [[specs/permission-matrix]] |
|   10G | LINE AI Business Query Coverage             | Core deployed at `0e640770`; result-semantics hotfix at `c2860d0e`; Mangmee-themed business answer cards, multi-answer carousel contract, owner-only `บริษัทของฉัน` Quick Reply, and permission-rechecked company picker deployed at `55f89a40` on 2026-07-15. ECS/public health/log checks passed; owner LINE OA journeys and post-journey review remain open. | [[specs/line-ai-business-query-coverage-spec]], [[plans/line-ai-business-query-coverage-plan]] |
|    11 | Thai Tax MVP                                | VAT, WHT, CIT reminders, configurable calendar, ledger-backed report/export baseline.                                                           | [[specs/tax-thailand-2026-spec]], [[specs/tax-2026-verified-rules]], [[plans/thai-tax-mvp-plan]]                                                                      |
|   11A | Output VAT Tax Code and Receipt Boundary    | Implemented and locally verified 2026-07-13: initial SAP ERP-style `O7`/`OX`/`O0` compatibility eligibility by legal document role; plain receipt remains payment-only with no Tax Code and no duplicate VAT event. Full profile-backed meaning is item 11B. | [[specs/tax-thailand-2026-spec]], [[specs/tax-2026-verified-rules]], [[specs/accounting-documents-spec]], [[plans/thai-tax-mvp-plan]] |
|   11B | SAP-Compatible Transaction Tax and Account Determination | Implemented, independently reviewed, and locally verified 2026-07-14 across SAP/custom profiles, profile rounding/tolerance, line Tax Codes, domestic/import/export/PP36/correction/customs-excise components, atomic final mutations, account/report determination, reconciliation, AP/manual/accounting web flows, evidence-file inspection, and fail-closed AI read awareness. Final checklist closure awaits productive accountant configuration plus the full-period fixture; partial deductibility remains fail-closed until an explicit company split policy exists. | [[specs/sap-compatible-transaction-tax-account-determination-spec]], [[plans/sap-compatible-transaction-tax-account-determination-plan]], [[agent-memory/sap-transaction-tax-account-determination-11b]], [[product/business-use-cases]] |
|    12 | Procurement, Supplier, and Accounts Payable | Supplier master, purchase request/order, goods receipt, vendor bill, AP aging, approval, tax/ledger links.                                      | Implemented and locally verified 2026-06-30; [[specs/procurement-supplier-ap-spec]], [[plans/procurement-supplier-ap-plan]] |
|    13 | Bank Accounts and Reconciliation            | Bank account master, payment matching, statement import/manual entry, reconciliation status, cash visibility tied to ledger cash/bank accounts. | [[specs/bank-reconciliation-spec]], [[plans/bank-reconciliation-plan]], [[specs/accounting-documents-spec]], [[specs/double-entry-ledger-closing-spec]]               |
|    14 | Reimbursement Approval                      | Request, manager approval in web, payment voucher, payment status, LINE alert.                                                                  | [[specs/reimbursement-approval-spec]], [[plans/reimbursement-approval-plan]]                                                                                          |
|    15 | CRM and Sales MVP                           | Canonical `/customers` directory, same-person identity/re-point/merge, customer/contact, lead, opportunity, follow-up, pipeline, quotation link. | [[specs/crm-sales-spec]], [[plans/crm-sales-mvp-plan]], [[agent-memory/customer-management-identity-linking]]                                                        |
|   15A | CRM Customer OS — Company LINE OA          | Company-OA inbox, Customer 360, deterministic LINE identity reuse, appointments, customer AI assist/guarded autonomy, and customer-directory integration. | [[specs/crm-line-oa-customer-os-spec]], [[plans/crm-line-oa-customer-os-plan]], [[agent-memory/customer-management-identity-linking]]                     |
|    16 | Workflow Automation                         | Rules, SLA, tasks, templates, safe automation, workflow history.                                                                                | [[specs/workflow-automation-spec]], [[plans/workflow-automation-plan]]                                                                                                |
|    17 | AI Draft and Suggestion Layer               | CFO/Sales/Inventory/Tax/CRM suggestions, draft-only actions, web review.                                                                        | [[specs/ai-draft-suggestion-layer-spec]], [[specs/ai-gateway-agents-spec]], [[plans/ai-draft-suggestion-layer-plan]]                                                  |
|    18 | Reports and BI                              | Sales, stock, receivable, expense/accountant evidence, tax, ledger-backed financial reports, and operational reports.                           | [[specs/reports-bi-spec]], [[plans/reports-bi-plan]], [[specs/double-entry-ledger-closing-spec]]                                                                      |
|    19 | Marketplace Import                          | Roadmap backlog. Do later after core finance/ops is stable.                                                                                     | [[specs/marketplace-import-spec]], [[plans/marketplace-import-plan]], [[specs/double-entry-ledger-closing-spec]]                                                      |
|    20 | Payroll and HR Compliance                   | Employee master, payroll prep, payroll WHT, social security reminders, payslip/50 Tawi, leave/benefit records, LINE leave request intake, and frequent-leave warnings. | [[specs/payroll-hr-compliance-spec]], [[plans/payroll-hr-compliance-plan]], [[specs/tax-thailand-2026-spec]], [[specs/double-entry-ledger-closing-spec]]              |
|    21 | Fixed Assets                                | Asset register, capitalization, monthly depreciation, transfer/custody history, disposal/write-off, ledger/tax/report hooks, and audit trail.    | [[specs/fixed-assets-spec]], [[plans/fixed-assets-plan]], [[specs/double-entry-ledger-closing-spec]], [[specs/tax-thailand-2026-spec]]                                |
|    22 | Manufacturing, MRP, and Advanced Warehouse  | BOM, production order, material issue/receipt, lot/batch, warehouse automation, reorder/MRP suggestions, costing hooks.                         | [[specs/manufacturing-mrp-warehouse-spec]], [[plans/manufacturing-mrp-warehouse-plan]], [[specs/inventory-mvp-spec]], [[specs/double-entry-ledger-closing-spec]]      |
|    23 | AI Marketing                                | Roadmap backlog. Do later after core finance/ops is stable.                                                                                     | [[specs/ai-marketing-platforms-spec]], [[plans/ai-marketing-plan]]                                                                                                    |
|    24 | Production Ops                              | Backup, restore test, monitoring, runbook, rollback, cost guard.                                                                                | [[specs/production-ops-spec]], [[plans/production-ops-plan]], [[specs/platform-environment-config-spec]]                                                              |

## Roadmap Backlog

These items are intentionally deferred. They do not block active implementation unless owner explicitly pulls them forward.

1. Marketplace Import, item 19: do later after accounting, ledger, reports, and production ops are stable. Keep raw payload validation design, but do not build marketplace/channel imports now.
2. AI Marketing, item 23: do later after AI draft/suggestion, permissions, ops, and core business data are stable. Keep external publishing mutation gated by explicit confirmation.

Fixed Assets item 21 was pulled forward for docs readiness on 2026-07-05. It now has a spec and plan, but remains unchecked until implementation and verification pass.

## Critical Path

Do these first before complex marketplace, payroll, fixed asset, or manufacturing work:

1. Platform Foundation
2. Auth, RBAC, and Audit
3. Web Core Workspace
4. Data Model Core
5. Inventory MVP
6. Dashboard and Notification
7. LINE AI Read-Only Assistant
8. Accounting Documents MVP
9. Expense and Receipt Upload
10. Double-Entry Ledger and Period Closing
11. Admin Company Onboarding and Partner Management
12. LINE AI Local Agent Orchestration
13. Employee Access and Role Management
14. LINE AI Business Query Coverage foundation and CRM customer closure
15. Thai Tax MVP

This creates usable product skeleton plus accounting correctness, customer onboarding, governed LINE AI runtime proof, customer-side staff access, and first-pass Thai tax readiness: web stores and manages data, backend owns truth, LINE can answer questions and deliver alerts, finance reports derive from balanced ledger entries, new companies can be provisioned, employee users can be permissioned, AI tool policy is proven, and tax workflows can prepare review/export evidence before procurement/AP expands the purchase side.

## LINE AI Item 07 Defaults

Use these defaults when implementing item 07:

1. Start deterministic-first: classifier, answer composer, source refs, audit, and refusal behavior work before any LLM provider dependency.
2. Store LINE AI user messages as preview plus hash by default. Full message retention waits for an approved retention policy.
3. Use LIFF/web selector for multi-company users. LINE quick reply can guide only; authorization stays server-verified.
4. First rich menu uses Ask AI, Open Alerts, and Link Account. Daily Summary stays item 06 reuse unless owner enables it later.
5. Keep LINE read-only: no final money, stock, tax, accounting, approval, permission, export, or external publishing mutation.

## ERP Completeness Backlog

Keep these visible even if they are not first accounting-critical:

1. Procurement, Supplier, and Accounts Payable closes purchase-side ERP gaps.
2. Bank Accounts and Reconciliation closes finance cash-control gaps.
3. Payroll and HR Compliance remains later, but must connect to tax, ledger, and accounting outputs.
4. Fixed Assets now has implementation-ready docs and must connect to ledger, tax, depreciation, reporting, approval, and audit when implemented.
5. Manufacturing, MRP, and Advanced Warehouse remains later, because first release intentionally avoids complex manufacturing and warehouse automation.

## Ledger Backlog

Keep these out of the first Double-Entry Ledger item 10 implementation unless owner explicitly pulls them forward:

1. Manual journal two-step approval before beta.
2. CSV export after XLSX accountant-review export works.
3. PDF financial statement export after ledger reports stabilize.
4. Accounting-office-specific export templates.
5. Optional OWNER/MFA extra gate for close or unclose before beta.

## UI and Workspace Backlog

Keep these out of Web Core Workspace item 03 unless owner explicitly pulls them forward:

1. TailAdmin dark mode: defer dark-mode provider, toggle, and QA until after the first business workspace screens are stable.

## Implementation Rule

For every milestone:

1. Open [[plans/master-implementation-checklist|Master Implementation Checklist]].
2. Confirm milestone order or record owner-approved reorder.
3. Create or update linked spec.
4. Create or update linked implementation plan.
5. Ask Auggie to inspect codebase before editing.
6. Implement only one small phase at a time.
7. Add tests and run relevant checks.
8. Update ADRs when architecture decisions are made.
9. Re-check Thai tax filing rules against current Revenue Department guidance before tax implementation or release.
