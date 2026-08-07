# Business Use Cases

Status: Draft catalogue from existing requirements, specs, and plans.

Owner: Product / BA.

Purpose: convert the current WatchDog-BMS requirements, plans, and specs into business-facing use cases. This document does not add implementation scope; it summarizes what existing source docs already require.

## Source Docs

- [[product/vision|Product Vision]]
- [[product/business-model|Business Model Draft]]
- [[specs/sme-business-os-overview|SME Business OS Overview Spec]]
- [[specs/requirements-coverage|Requirements Coverage Matrix]]
- [[plans/implementation-roadmap|Implementation Roadmap]]
- [[plans/master-implementation-checklist|Master Implementation Checklist]]
- Linked feature specs and plans under each use case.

## Product Boundary

- Web is the full Business OS workspace for data entry, review, approval, reporting, export, setup, audit, and final business actions.
- LINE is the AI assistant, alert, summary, account-linking, and deep-link channel.
- AI can explain, summarize, draft, and suggest only through permission-checked tools.
- Final money, stock, tax, accounting, approval, permission, export, external publishing, production, or infrastructure mutations stay in web and source modules.
- Every sensitive business action needs permission checks, ABAC where applicable, audit, and source refs.

## Actors

| Actor | Business intent |
|---|---|
| System admin | Onboard customer companies, create first owner access, prepare LINE handoff, and audit setup without joining customer workspaces by default. |
| Owner | See company health, approve high-impact decisions, review risks, and control settings. |
| Admin | Configure company, users, roles, permissions, master data, workflow rules, and module settings. |
| Manager / Approver | Review queues, approve requests, handle exceptions, and monitor team work. |
| Sales | Manage customers, leads, opportunities, quotations, follow-ups, and assigned sales records. |
| Inventory / Warehouse | Manage products, locations, stock movements, scans, counts, and warehouse tasks. |
| Finance | Manage documents, invoices, payments, expenses, reimbursements, bank matching, and exports. |
| Accountant | Review ledger, tax, close, reports, evidence, compliance, and correction workflows. |
| Staff / Requester | Submit expenses, reimbursements, receipts, tasks, and own operational requests. |
| Marketing | Request campaign ideas and marketing drafts from trusted product/customer data. |
| Auditor readonly | Read records, reports, source refs, AI/tool logs, and audit trails without mutation. |
| AI assistant user | Ask questions, request summaries, and receive deep links within exact permission scope. |

## Use Case Map

| ID | Roadmap item | Business use case | Primary actors | Outcome |
|---|---:|---|---|---|
| BUC-01 | 01 | Platform foundation and runtime readiness | Owner, Admin | Services run locally/prod, config validates, health and CI gates exist. |
| BUC-02 | 02 | Company access, LINE linking, RBAC, and audit | System admin, Owner, Admin, all users | Companies and first users are onboarded safely; users access only allowed company data; key actions are audited. |
| BUC-03 | 03 | Web Business OS workspace | All web users | Users work from shared company-scoped web shell and deep-link targets. |
| BUC-04 | 04 | Shared company data, attachment, sequence, audit, and outbox primitives | Admin, Finance, Accountant | Business modules reuse one company/branch/evidence/numbering foundation. |
| BUC-05 | 05 | Inventory stock control | Inventory, Owner, Manager | Stock changes are recorded as auditable movements and visible as balances. |
| BUC-06 | 06 | Dashboard and notification monitoring | Owner, Manager, all users | Exceptions and KPIs surface in web and LINE with source links. |
| BUC-07 | 07 + 10G | LINE AI business assistant/read coverage | Owner, Sales, Inventory, Finance, Accountant | Users ask about shipped business features and receive permission-scoped cited answers directly in LINE; web links are secondary. |
| BUC-08 | 08 | Accounting sales documents and receivables | Sales, Finance, Accountant, Owner | Quotation-to-invoice-to-payment workflow becomes ledger-ready. |
| BUC-09 | 09 | Expense and receipt capture | Staff, Finance, Accountant | Receipt/bill uploads become reviewed, tax-ready, ledger-ready expenses. |
| BUC-09A | 09A | Cross-domain business-document image intake | Staff, Sales, Finance, Accountant | Images are classified before routing so receipts become expense drafts while quotations, scheduling documents, order-only slips, and unrelated images do not. |
| BUC-09B | 09B | Substitute receipt evidence hardening | Staff, Finance, Accountant, Approver | Missing/incomplete receipt cases produce real immutable internal evidence without becoming tax invoices or losing original proof. |
| BUC-09C | 09C | Substitute receipt company policy | Owner, Admin, Staff, Finance, Approver | Each company chooses eligible approvers and cash-evidence minimums; payer and approver sign the exact artifact with transparent signatures. |
| BUC-10 | 10 | Double-entry ledger and period close | Finance, Accountant, Owner | Finalized source records post to balanced journals and financial reports. |
| BUC-10C | 10C | Employee access and role management | Owner, Admin, Employees, Auditor readonly | Owner/admin creates employee users, temporary passwords, roles, and LINE link QR packages for permission-governed access. |
| BUC-11 | 11 | Thai tax preparation | Finance, Accountant, Owner | VAT/WHT/CIT support is prepared from source events and ledger summaries. |
| BUC-11B | 11B | SAP-compatible transaction tax and account determination | Finance, Accountant, Procurement, Sales, Inventory, Owner, Auditor readonly | Domestic purchase/sale, import, imported service, export, and correction taxes resolve by company profile, post to reviewed accounts, and reconcile to Thai tax reports. |
| BUC-12 | 12 | Procurement, supplier, and AP | Manager, Finance, Accountant, Inventory | Purchase requests/orders, receipts, bills, AP, and supplier payments align. |
| BUC-13 | 13 | Bank accounts and reconciliation | Finance, Accountant, Owner | Bank statements reconcile to internal payments and ledger cash accounts. |
| BUC-14 | 14 | Reimbursement approval | Staff, Manager, Finance | Requests move through approval, finance review, payment, and audit. |
| BUC-15 | 15 | CRM and sales pipeline | Sales, Manager, Owner | Customers, leads, opportunities, follow-ups, and quotation links are managed. |
| BUC-16 | 16 | Workflow automation | Admin, Manager, all users | Rules create safe alerts, tasks, review requests, retries, and history. |
| BUC-17 | 17 | AI draft and suggestion layer | Owner, Manager, Sales, Finance, Inventory, Accountant | AI suggestions are cited, reviewable, and web-approved before source drafts. |
| BUC-18 | 18 | Reports and BI | Owner, Manager, Finance, Accountant, Auditor readonly | Users query, save, export, and summarize permission-checked reports. |
| BUC-19 | 19 | Marketplace import | Owner, Finance, Sales, Inventory | Channel sales data imports without bypassing accounting/inventory validation. |
| BUC-20 | 20 | Payroll and HR compliance | Owner, HR/Admin, Finance, Accountant, Staff | Employee, leave, payroll, tax, social security, payslip, and ledger inputs align. |
| BUC-21 | 21 | Fixed assets | Owner, Finance, Accountant | Assets, capitalization, depreciation, disposal, audit, tax, and ledger links are controlled. |
| BUC-22 | 22 | Manufacturing, MRP, and advanced warehouse | Production, Inventory, Manager, Finance | BOM, production, MRP, warehouse tasks, and stock movements stay auditable. |
| BUC-23 | 23 | AI marketing drafts | Marketing, Owner, Sales, Inventory | AI drafts campaigns from trusted business data without auto-publishing. |
| BUC-24 | 24 | Production operations readiness | Owner, Admin | Backup, restore, monitoring, rollback visibility, cost guard, and runbooks are visible. |

## Use Cases

### BUC-01: Platform Foundation and Runtime Readiness

Source: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 01, [[plans/platform-foundation-local-prod-lean-plan|Local/Prod Lean Plan]], [[specs/platform-foundation-local-prod-lean-spec|Local/Prod Lean Spec]].

- Goal: give the solo-dev product a runnable, secure baseline for local and production paths.
- Main flow: configure services, validate env, run health checks, seed core roles, expose logs, and pass CI/promote gates.
- Rules/exceptions: staging is deferred; business workflows, real AI provider, and production infra provisioning stay out of this use case.
- Acceptance: services build/run, config fails fast, secrets redact, health checks work, and CI/security gates are defined.

### BUC-02: Company Access, LINE Linking, RBAC, and Audit

Source: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]], [[specs/permission-matrix|Permission Matrix]], [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]], [[specs/admin-company-onboarding-spec|Admin Company Onboarding Spec]], [[plans/auth-rbac-audit-plan|Auth RBAC Audit Plan]], [[plans/admin-company-onboarding-plan|Admin Company Onboarding Plan]].

- Goal: onboard each customer company, identify each user, resolve company membership, apply roles/permissions/ABAC, and audit sensitive access or mutations.
- Main flow: protected system admin seed authenticates, creates company plus first owner username/temporary credentials and handoff package; customer owner signs in within 72 hours, changes temporary password, adds LINE OA, links LINE account through LIFF/web, selects company when needed, backend resolves membership and permissions, route/tool access is checked, and audit events are written.
- Rules/exceptions: seeded `thawatchai.watchdog` is permanent protected super user but can change password; first pass creates first owner only and later customer company staff are invited separately; deny by default; LINE OA add/follow is not authorization; account linking requires verified LINE identity plus authenticated internal user/company membership; AI tools inherit exact user permission; multi-company LINE users must select company before company-scoped answers; important actions need audit.
- Acceptance: protected routes reject unauthorized access, unlinked LINE users receive account-link guidance only, linked LINE users resolve safely to company-scoped request context, and AI/tools cannot bypass permissions.

### BUC-03: Web Business OS Workspace

Source: [[specs/web-core-workspace-spec|Web Core Workspace Spec]], [[plans/web-core-workspace-plan|Web Core Workspace Plan]].

- Goal: make web the full company-scoped workspace for all source-of-truth work.
- Main flow: user opens workspace, selects company if needed, sees permission-aware navigation, opens module list/detail/form, uses loaders/error/forbidden states, and follows deep links from LINE/notifications.
- Rules/exceptions: frontend permission checks improve UX only; backend remains authority; deep links never perform final mutations.
- Acceptance: shared shell, navigation, state components, list/detail/form patterns, API error model, and deep-link helpers support later modules without redesign.

### BUC-04: Shared Company Data, Attachment, Sequence, Audit, and Outbox Primitives

Source: [[specs/data-model-core-spec|Data Model Core Spec]], [[plans/data-model-core-plan|Data Model Core Plan]].

- Goal: prevent every business module from rebuilding tenant, branch, attachment, document number, audit, and outbox primitives.
- Main flow: admin maintains company/branch scope, users upload/link evidence, modules reserve document numbers, mutations write audit and outbox events.
- Rules/exceptions: business modules still own their records and state machines; document number allocation is shared service, not public user endpoint.
- Acceptance: branches, attachments, document sequences, audit taxonomy, outbox claim/update, and smoke worker path are reusable by later modules.

### BUC-05: Inventory Stock Control

Source: [[specs/inventory-mvp-spec|Inventory MVP Spec]], [[plans/inventory-mvp-plan|Inventory MVP Plan]].

- Goal: keep stock trustworthy through products, locations, immutable movements, and derived balances.
- Main flow: admin creates products/barcodes/internal QR labels and locations; inventory staff scans or enters stock actions; system records movement; balances/reports update; LINE/AI can read summaries later.
- Rules/exceptions: stock-affecting actions create immutable movements; web owns stock mutations; LINE/AI cannot mutate stock; no dedicated scanner hardware or offline mode in MVP.
- Acceptance: product/location/movement/balance workflows are permission-protected, audited, visible in web, and ready for dashboard/AI read hooks.

### BUC-06: Dashboard and Notification Monitoring

Source: [[specs/dashboard-notification-spec|Dashboard and Notification Spec]], [[plans/dashboard-notification-plan|Dashboard and Notification Plan]].

- Goal: surface business health, exceptions, reminders, and source-linked alerts.
- Main flow: source modules publish snapshot/alert candidates; worker scans rules; notification rows and delivery attempts are created; users read/dismiss alerts in web; LINE receives supported pushes.
- Rules/exceptions: notifications cannot perform final approvals, payments, stock moves, postings, filing, permission changes, or external publishing.
- Acceptance: alerts link to source records, owner sees business health, web notification center works, LINE delivery works where linked identity exists.

### BUC-07: LINE AI Read-Only Assistant

Source: [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]], [[specs/line-ai-business-query-coverage-spec|LINE AI Business Query Coverage Spec]], [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]], [[specs/ai-gateway-agents-spec|AI Gateway Spec]], [[plans/line-ai-read-only-assistant-plan|LINE AI Read-Only Assistant Plan]], [[plans/line-ai-business-query-coverage-plan|LINE AI Business Query Coverage Plan]].

- Goal: let users ask ordinary questions about production WatchDog-BMS features and receive useful answers directly in LINE without turning LINE into a mutation workspace.
- Main flow: linked LINE user sends a question; webhook verifies signature and current access; AI Gateway resolves each business subject and follow-up; subject-compatible tools call permission/ABAC-checked source-module use cases; successful business answers return as a Mangmee-themed LINE card (one answer = one bubble, multiple completed answers = carousel) with Thai-first facts, source refs, and an optional web drill-down link. An owner can tap `บริษัทของฉัน` in Quick Reply, see selectable company cards, and tap one to switch the permission-checked LINE company context.
- Rules/exceptions: tools map to distinct business question capabilities rather than HTTP endpoints; a subject cannot fall back to an adjacent subject's tool; unsupported mutations are refused; unlinked/unauthorized users and feature-gated modules get safe honest guidance; web remains required for setup, bulk investigation, evidence inspection, and final actions.
- Acceptance: every shipped production read feature is covered or explicitly classified web-only/feature-gated; summary/search/detail/breakdown question kinds are supported where applicable; successful empty data renders as a zero/no-record card while forbidden/unavailable remain distinct text states; owner company-card taps re-check active membership and owner policy before changing context; clarifications continue the original request; answers cite sources, respect current permissions/ABAC, provide useful data before links, and cannot perform final money, stock, tax, accounting, approval, export, or permission mutations.

### BUC-08: Accounting Sales Documents and Receivables

Source: [[specs/accounting-documents-spec|Accounting Documents Spec]], [[plans/accounting-documents-mvp-plan|Accounting Documents MVP Plan]], [[specs/accounting-product-benchmark|Accounting Product Benchmark]].

- Goal: support FlowAccount-style sales document workflow while preserving ledger-ready source data.
- Main flow: sales/finance creates counterparty, drafts quotation, submits for approval, manager/finance approves, quotation issues, invoice or billing note is created, payment and receipt are recorded, tax invoice is issued when required, and credit/debit notes correct issued records.
- Rules/exceptions: sales cannot self-approve; issued documents lock money/tax/snapshot/line fields; official numbers come from sequences; overpayment becomes unapplied customer credit; web owns mutations.
- Acceptance: quotation-to-payment flow is clear, partial payment/overpayment are represented, finalized documents expose deterministic posting inputs and posting status.

### BUC-09: Expense and Receipt Capture

Source: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]], [[plans/expense-receipt-upload-plan|Expense Receipt Upload Plan]], [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]].

- Goal: turn web or LINE receipt, tax invoice, transfer slip, handwritten cash bill, marketplace screenshot, any-language expense document, and short expense note intake into reviewed, tax-ready, ledger-ready expense records without relying on Google Drive as primary storage.
- Main flow: staff/finance uploads a PDF/photo/file or sends a LINE note such as `ค่ากาแฟ 65 บาท`; LINE Intake Router Agent and OCR classification first distinguish accepted expense evidence from quotation, scheduling document, quantity-only order/check bill, signature, non-financial image, or clarification; deterministic evidence gates run before a shared-LINE expense draft exists; accepted evidence stores attachment/provenance and auto-keys bounded draft fields; finance reviews missing data/duplicates/category/tax fields; all final accounting actions remain web-owned.
- Rules/exceptions: every standard active employee role can report its own expense through a linked LINE account; auditor/platform/demo roles are not employee intake roles. OCR/AI never final-confirms; `RECEIPT` requires printed positive total plus receipt/settlement evidence; item names/quantities without amount are not receipts; transfer slips are payment evidence, not tax invoices; quotations and appointment/booking/reservation images do not auto-create accounting/CRM records; provider-unavailable uncaptioned media clarifies instead of creating an expense; a manual web upload classified as non-expense keeps its file/draft but cannot advance or confirm until a finance reviewer explicitly acknowledges a reviewed expense document type with a bounded reason; tax evidence status is review guidance, not legal filing; LINE can capture accepted drafts but not finalize accounting treatment.
- Acceptance: receipt, bill, quotation, scheduling document, order-only, signature, non-financial, unreadable, ambiguous, and multi-document scenarios route according to [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]]; accepted expense capture, tax/category/review, signature ticket, accountant evidence, audit, and final web boundaries remain intact.

### BUC-09A: Cross-Domain Business-Document Image Intake

Source: [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]], [[plans/business-document-image-intake-plan|Business Document Image Intake Plan]].

- Goal: stop receipt-biased intake and choose the correct safe business route before creating a source-module record.
- Main flow: classify image content/family/kind and evidence; validate printed totals and settlement signals; combine classifier output with caption, permission, provider availability, and channel; create only an eligible expense draft or existing signature ticket; otherwise return bounded review guidance or clarification.
- Rules/exceptions: global classification is separate from expense type; one image may have multiple evidence roles but one primary route; quotation/scheduling images never auto-mutate official records; customer-OA attachments remain isolated from employee shared-OA agents.
- Acceptance: quantity-only food order creates no expense; valid receipt journey remains; provider-unavailable uncaptioned image fails closed; web explicit upload applies no fields for a non-expense image and cannot mark ready/confirm without a valid finance resolution; original classification and override audit history remain visible; all permission/idempotency/audit boundaries pass.

### BUC-09B: Substitute Receipt Evidence Hardening

Source: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]], [[plans/substitute-receipt-evidence-hardening-plan|Substitute Receipt Evidence Hardening Plan]].

- Goal: let finance support a real business expense when receipt evidence is missing/incomplete without fabricating a receipt, tax invoice, signature, VAT entitlement, or accountant-export reference.
- Main flow: finance reviews eligibility and source/payment evidence; the employee who actually paid personally certifies the `ใบรับรองแทนใบเสร็จรับเงิน` with their name, position, company-business declaration, signature, and date; the authorized approver signs separately; the system snapshots reviewed expense facts and creates a versioned immutable artifact; confirmation, ledger/tax handoff, and accountant export consume the same evidence version.
- Rules/exceptions: preserve original classification and attachments; a lost VAT tax invoice routes to the supplier for an issuer-created replacement; internal evidence remains `SUPPORTING_ONLY` and `NON_CLAIMABLE`; quotations/orders/appointments/bookings/non-business images are ineligible; reimbursement approval/payment remains item 14; every mutation enforces tenant, branch, permission, web-channel, state, and idempotency boundaries.
- Acceptance: the artifact carries the canonical title, company/branch, date, itemized expense and amount, actual payer name/position/certification/signature, authorized approval, and supporting/payment references; artifact preview/download and accountant manifest resolve; snapshot/hash/version remain stable after later edits; retry is idempotent and regeneration supersedes without deletion; no input-VAT journal/event is created; no applied/signed state exists without rendered evidence; legacy metadata-only rows fail closed; focused API/ledger/tax/web tests and browser paths pass.
- Implementation status 2026-07-13: accepted locally. The immutable prepare -> payer-certified -> issued -> superseded lifecycle, deterministic Revenue Department-aligned artifact, preview/checksum acknowledgements, distinct payer/approver roles, branch/download/export/retention controls, manual-web branch/classification parity, and VAT/ledger/tax fail-closed behavior passed focused, migration, build, and authenticated browser verification recorded in [[agent-memory/substitute-receipt-evidence-hardening|Substitute Receipt Evidence Hardening Memory]]. Production enablement still requires tenant-specific approver and cash-evidence policy plus a representative non-sensitive smoke.

### BUC-09C: Substitute Receipt Company Policy

Source: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]], [[plans/substitute-receipt-company-policy-plan|Substitute Receipt Company Policy Plan]].

- Goal: turn the production-policy follow-up from BUC-09B into company-owned settings and runtime controls without weakening the Revenue Department-aligned signer roles.
- Main flow: owner/admin selects active users with `expense.confirm`, chooses whether cash requires a separate payment-evidence image/PDF, and records accountant-approved instructions; finance prepares eligible evidence; the actual payer and a distinct currently configured approver each remove the light background, inspect their transparent PNG, and sign the exact version.
- Rules/exceptions: no policy is fail-closed; branch scope and current role are rechecked at action time; inactive/stale approvers are flagged and removed from the editable selection; strict cash requires a separate linked payment-evidence file; issued versions are not rewritten. The certificate contains payer/certifier and approver signatures; a payee acknowledgement/signature remains separate payment-voucher/cash evidence.
- Acceptance: settings load/save under `company.setup.manage`; invalid candidates cannot be saved; prepare/approve reject missing policy, same user, stale role, wrong branch, or missing strict cash evidence; empty cleaned signatures are rejected; the previewed transparent PNG is the uploaded/rendered file; two persisted users can issue and download the artifact.
- Implementation status 2026-07-13: accepted locally. Focused policy/lifecycle/image tests, typechecks/build, fresh migration/seed, authenticated settings save, and a strict-cash two-user lifecycle ending `ISSUED` with two embedded PNG signatures passed. Each production tenant must still choose its actual users and evidence wording before real use.

### BUC-10: Double-Entry Ledger and Period Close

Source: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]], [[plans/double-entry-ledger-closing-plan|Double-Entry Ledger and Period Closing Plan]].

- Goal: make financial reports reproducible from balanced journal entries and controlled period close.
- Main flow: accountant seeds chart of accounts and posting rules; finalized documents/expenses/payments expose source posting inputs; system generates locked balanced journals; users review GL, Trial Balance, P&L, and Balance Sheet; accountant closes/uncloses periods with checks.
- Rules/exceptions: source documents stay owners of business state; corrections use reversal/adjustment; close blocks direct mutation in closed periods; actual XLSX/CSV/PDF generation can be deferred behind export contracts.
- Acceptance: finalized documents generate balanced journals, reports derive from ledger, close policy blocks mutation, and AI/LINE can read ledger summaries only.

### BUC-10C: Employee Access and Role Management

Source: [[specs/employee-access-role-management-spec|Employee Access and Role Management Spec]], [[plans/employee-access-role-management-plan|Employee Access and Role Management Plan]], [[specs/permission-matrix|Permission Matrix]], [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]], [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]].

- Goal: let a customer owner/admin create employee access without sharing owner credentials, then govern each employee's web and LINE AI access through roles and permissions.
- Main flow: owner opens Settings > Employees, creates employee with name, Thai national ID or passport, phone, and role, receives one-time temporary password plus LINE link QR package, employee logs in to web, changes password, links LINE, and uses only assigned permissions.
- Rules/exceptions: payroll/HR details stay in item 20; generated password, full ID/passport, QR token, and LINE token must not appear in logs or audit metadata; LINE follow is not authorization; LINE/AI cannot create users, change passwords, assign roles, change permissions, disable users, or generate QR packages.
- Acceptance: employee user, active membership, access profile, role assignment, temporary credential, LINE link token, permission checks, last-owner protection, disabled-membership fail-closed behavior, and audit evidence all pass verification.

### BUC-11: Thai Tax Preparation

Source: [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]], [[specs/tax-2026-verified-rules|Thai Tax Verified Baseline]], [[plans/thai-tax-mvp-plan|Thai Tax MVP Plan]].

- Goal: prepare VAT, WHT, CIT calendar/supporting summaries, certificates, exports, reminders, and AI explanations from source evidence.
- Main flow: finalized sales/purchase/expense/payment records create tax events; system classifies VAT/WHT/excluded/review-needed; events group into periods; finance/accountant reviews reports and issues 50 Tawi data; export package is generated; manual filing/payment status is updated after external action.
- Rules/exceptions: rates/deadlines/export formats stay config-driven with source/reviewer metadata; item-11A `O7`/`OX`/`O0` values are an initial SAP ERP-style compatibility profile rather than statutory RD or universal WatchDog codes; full company/profile/line/account/report behavior is BUC-11B; a plain receipt is payment evidence with no Tax Code and cannot create VAT again; a receipt/tax invoice must satisfy tax-invoice requirements; credit/debit notes adjust their referenced tax event; export generation is not e-filing; AI Tax must warn when accountant/RD confirmation is needed.
- Acceptance: VAT/WHT/CIT support derives from source events/ledger summaries; plain receipt/payment paths cannot duplicate VAT; Tax Code eligibility follows the reviewed document-role matrix; review issues are visible; exports and status changes are audited; and LINE shows read-only reminders/summaries.

### BUC-11B: SAP-Compatible Transaction Tax and Account Determination

Source: [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]], [[plans/sap-compatible-transaction-tax-account-determination-plan|SAP-Compatible Transaction Tax and Account Determination Plan]].

- Goal: let each company use its real SAP ERP, SAP S/4HANA, WatchDog, or custom Tax Codes across purchases, sales, imports, imported services, exports, returns, and corrections while keeping Thai tax reports and the existing chart of accounts reproducible.
- Primary actors: Finance prepares source/evidence; Sales and Procurement select allowed line codes in their own flows; Inventory/Fixed Assets identify capitalization destination; Accountant reviews Tax Code profiles, account/report mappings, evidence, reconciliation, and exceptions; Owner sees configuration/period risk; Auditor readonly traces source-to-report evidence.
- Main flow: company imports or selects a Tax Code profile; accountant reviews effective codes, rates, treatments, evidence rules, G/L account roles, and ภ.พ.30/ภ.พ.36 mappings; users create tax-relevant source lines; system resolves immutable line snapshots and previews journal/report effects; finalized sources create Tax Events and balanced journals; accountant reconciles source, Tax Event, G/L, and report boxes before filing or close.
- SAP-version rule: external code is never business meaning by itself. Legacy ERP `O7=7%` and current S/4 `O1=7%` may map to the same internal treatment, while legacy `O1=10%` remains a separate profile meaning.
- Domestic sale use case: standard VAT posts output tax; zero-rated and exempt sales retain separate bases/report boxes despite zero tax; non-taxable remains separate; a mixed invoice can carry several line codes.
- Domestic purchase use case: supplier VAT and claimability are reviewed separately; claimable VAT posts to input VAT, pending evidence remains blocked/pending, and non-deductible VAT goes to reviewed expense/inventory/asset cost rather than claimable input VAT.
- Import-goods use case: finance links supplier invoice, goods receipt, customs declaration/assessment/payment, duty, excise/other assessed tax, and import VAT; system uses authoritative amounts, applies reviewed capitalization/expense/account roles, and preserves claim evidence without inventing tariff or privilege.
- Imported-service use case: foreign-service payment creates separate ภ.พ.36 payable and input pending/claimable components using reviewed timing/evidence; the same payment cannot produce duplicate self-assessed or input VAT.
- Partial-payment/FX rule: imported-service recognition uses the bill's immutable functional-currency snapshot exactly once, rounds cumulative base/tax with the profile policy, posts only the delta, and assigns the final remainder to the last payment. Concurrent payment, claim, or void attempts must not duplicate recognition or orphan a ภ.พ.30 claim.
- Export use case: export zero-rate requires the configured customs/shipment/foreign-use/payment evidence; complete evidence maps the base to total/zero-rated sales, while incomplete evidence remains review-blocked rather than silently becoming 7%, exempt, or accepted 0%.
- Correction use case: credit/debit notes inherit the original line Tax Code/profile/account/report snapshots; credit reverses and debit increases the original treatment; plain receipt/payment remains no-code and never creates VAT again.
- WHT/customs/excise boundary: VAT Tax Code, withholding-tax code, customs duty/tariff classification, and excise classification are separate regimes that may coexist on one transaction but cannot overwrite one another.
- Permissions/exceptions: tax profile/report configuration requires `tax.config.manage`; actual chart/account mapping requires ledger permissions; source-module permissions remain required; missing/ambiguous/expired mappings, evidence, accounts, or period state fail closed; filed/closed history uses adjustment/reversal rather than rewrite.
- Review journey: an evidence reviewer must be able to open every uploaded customs, export, payment, tax-invoice, and ภ.พ.36 attachment before Verify/Reject. Manual/upload expense confirmation and other final mutations recheck evidence and period locks atomically.
- Acceptance: legacy/current SAP profiles coexist; line-level mixed tax works; `O0` and `OX` reach different ภ.พ.30 boxes; domestic/import/PP36/export/correction journals balance; source tax equals active Tax Events, configured tax-account G/L movement, and report-box contribution; every mismatch is reviewable and blocks filing/close according to policy.
- Delivery status: implemented, independently reviewed, and locally verified on 2026-07-14 across backend, web, ledger, reconciliation, AP/evidence, manual/accounting sources, and AI read tools. No known P0/P1 remains after the final review/fix pass. Master item 11B remains unchecked until the productive accountant profile/account/report/evidence/rounding review and a full-period acceptance fixture pass. `PARTIALLY_DEDUCTIBLE` is deliberately review-blocked until the company defines the deductible percentage and non-deductible destination; the system never guesses that split.

### BUC-12: Procurement, Supplier, and Accounts Payable

Source: [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]], [[plans/procurement-supplier-ap-plan|Procurement, Supplier, and Accounts Payable Plan]].

- Goal: connect purchase requests, purchase orders, goods receipt, vendor bills, AP aging, supplier payments, tax, ledger, and audit.
- Main flow: finance/admin creates supplier; requester creates purchase request; manager approves; PO is issued; inventory records goods receipt; finance matches vendor bill to PO/receipt; payment allocation updates AP aging and supplier statement.
- Rules/exceptions: goods receipt must use inventory movement integration; supplier payment does not execute bank transfer; RFQ, supplier portal, EDI, landed cost, and advanced receiving are later.
- Acceptance: purchase documents link supplier, stock receipt, payable, payment, tax candidate, approval, ledger posting input, and audit records.

### BUC-13: Bank Accounts and Reconciliation

Source: [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]], [[plans/bank-reconciliation-plan|Bank Accounts and Reconciliation Plan]].

- Goal: give finance trustworthy cash visibility and reconciliation evidence.
- Main flow: finance creates bank/cash account; imports statement preview or enters lines; confirms commit; system suggests matches to payments/ledger cash lines; finance confirms/splits/rejects; accountant reviews variance and ignored lines; session completes and evidence exports.
- Rules/exceptions: no bank transfer execution, direct bank feeds, OAuth, scraping, or LINE/AI banking mutation; full account number storage needs approved encryption/tokenization.
- Acceptance: payments reconcile to statement lines and ledger cash accounts, unmatched lines remain reviewable, completion locks session evidence, and summaries are read-only.

### BUC-14: Reimbursement Approval

Source: [[specs/reimbursement-approval-spec|Reimbursement and Approval Spec]], [[plans/reimbursement-approval-plan|Reimbursement Approval Plan]].

- Goal: let staff request reimbursement while managers approve and finance pays with audit and policy checks.
- Main flow: staff drafts/submits reimbursement with evidence; system snapshots amount/policy; manager approves or rejects in web; finance reviews duplicates/tax/accounting blockers; finance can generate a payment voucher (`ใบสำคัญจ่าย`) grouped by requester/payee; finance records full payment; LINE sends alerts/status summaries.
- Rules/exceptions: approval required from 1 THB by default; self-approval is blocked; full-payment-only in MVP; payment voucher prepares repayment documentation but does not execute bank transfer; LINE/AI cannot approve, reject, pay, export, post, or change policy.
- Acceptance: requester, approval, finance, detail/timeline, payment voucher, payment status, policy settings, audit/outbox, and bounded evidence export work.

### BUC-15: CRM and Sales Pipeline

Source: [[specs/crm-sales-spec|CRM and Sales Spec]], [[plans/crm-sales-mvp-plan|CRM Sales MVP Plan]], [[specs/crm-product-service-catalog-spec|CRM Product and Service Catalog Spec]].

- Goal: help sales manage customers, leads, opportunities, follow-ups, quotation links, and the products/services offered to customers.
- Main flow: sales/admin creates customer/contact; owner/admin maintains a shared product/service catalog in CRM Settings; staff selects a published service when creating a booking; CRM AI receives the same published catalog when answering product/service questions or extracting a booking; sales continues lead conversion, pipeline, follow-up, and quotation-link work.
- Rules/exceptions: Inventory owns the shared Product record; publication is explicit and defaults off; archived/internal rows never enter customer AI; accounting owns quotation issue/approval/invoice/payment; catalog presence is not stock or slot availability; AI Gateway never reads the database directly.
- Acceptance: customer/contact, lead, opportunity, follow-up, timeline, catalog-backed staff booking, grounded AI product/service answers, duplicate/merge, dashboard/notification hooks, and read-only AI/LINE summaries are supported.

### BUC-16: Workflow Automation

Source: [[specs/workflow-automation-spec|Workflow Automation Spec]], [[plans/workflow-automation-plan|Workflow Automation Plan]].

- Goal: automate safe operational reminders, tasks, review requests, and explanations without replacing source-module rules.
- Main flow: admin enables template/rule; source event, schedule, threshold, SLA, or manual replay triggers run; structured JSON condition is evaluated; action creates notification/task/review/draft request/audit note; failures retry then dead-letter; users inspect history.
- Rules/exceptions: no arbitrary scripts, SQL, final money/stock/tax/accounting/approval/export/permission/external mutation, or hidden audit changes.
- Acceptance: templates cover daily summary, low stock, overdue invoice, tax due, reimbursement, bank/procurement aging, CRM follow-up, stuck opportunity, sales target risk, disabled AI draft/webhook states, and LINE explanations.

### BUC-17: AI Draft and Suggestion Layer

Source: [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]], [[plans/ai-draft-suggestion-layer-plan|AI Draft and Suggestion Layer Plan]].

- Goal: let AI propose cited business suggestions and draft artifacts that users review in web before source-module changes.
- Main flow: user or workflow requests suggestion; AI Gateway gathers permission-checked source evidence; provider returns structured output; system stores citations/artifacts/candidate actions; web review queue supports validate, regenerate, dismiss, or create source draft where allowed; LINE can request/summarize/deep-link only.
- Rules/exceptions: AI Gateway cannot read database directly; unsafe output is rejected; source-state changes can block or force regeneration; source draft creation is web-only.
- Acceptance: suggestions have citations or blocked state, tool calls are audited, provider-disabled mode is graceful, and no autonomous final mutation exists.

### BUC-18: Reports and BI

Source: [[specs/reports-bi-spec|Reports BI Spec]], [[plans/reports-bi-plan|Reports BI Plan]].

- Goal: provide curated operational and financial reports with safe filters, saved views, exports, and AI summaries.
- Main flow: user opens report catalog; system shows available datasets and freshness; user filters/query/drills down; saved view and export request are permission-checked; report-ready notification emits; LINE/AI summarize and deep-link.
- Rules/exceptions: no arbitrary SQL, unrestricted pivot builder, external BI, PDF export first pass, email delivery, LINE export, or source mutation.
- Acceptance: financial statements derive from ledger lines, expense/accountant evidence exports use registered datasets, missing modules show unavailable/partial state, CSV export works, XLSX works or returns typed unavailable, exports are audited, and permission revocation blocks later download.

### BUC-19: Marketplace Import

Source: [[specs/marketplace-import-spec|Marketplace Import Spec]], [[plans/marketplace-import-plan|Marketplace Import Plan]], [[plans/implementation-roadmap|Implementation Roadmap]].

- Goal: import Shopee/TikTok/Facebook/Lazada-style channel data later without bypassing accounting, inventory, tax, or ledger validation.
- Main flow: operator imports channel data; raw payload is retained; system validates orders/payments/fees/tax/stock impact; exceptions go to review; accepted records feed source modules and reports.
- Rules/exceptions: roadmap backlog; direct platform integration and channel mutation wait until core finance/ops is stable.
- Acceptance: raw payload remains traceable, validation is source-module aware, and imports cannot bypass ledger/accounting/inventory checks.

### BUC-20: Payroll and HR Compliance

Source: [[specs/payroll-hr-compliance-spec|Payroll and HR Compliance Spec]], [[plans/payroll-hr-compliance-plan|Payroll and HR Compliance Plan]].

- Goal: manage employee records, leave, payroll preparation, Thai payroll tax/social security support, payslips, LINE leave notifications, and ledger/tax/report hooks.
- Main flow: HR/admin creates employee and sensitive profiles; config sets tax/social security rules; staff requests leave in web or linked LINE; LINE intake creates a pending approval ticket for manager/HR; employee receives LINE/web notification when leave is submitted, approved, rejected, or reaches the frequent-leave warning threshold; payroll run is created/calculated/reviewed/approved/finalized; payslips and compliance prep events are produced.
- Rules/exceptions: no auto-filing, bank transfer execution, plaintext full bank/tax/SSO identifiers without secure primitive, recruitment/performance/time-clock suite, or LINE/AI payroll/leave approval mutation. Frequent-leave warning defaults to 5 requests per employee per payroll period/month and is notification-only, not auto-rejection.
- Acceptance: payroll records are permission-protected, auditable, exportable for accountant/HR review, config-driven for statutory rules, linked to tax/ledger/reporting outputs, and LINE can only create the linked employee's own pending leave request plus safe notifications.

### BUC-21: Fixed Assets

Source: [[specs/fixed-assets-spec|Fixed Assets Spec]], [[plans/fixed-assets-plan|Fixed Assets Plan]], [[plans/master-implementation-checklist|Master Implementation Checklist]] item 21, [[plans/implementation-roadmap|Implementation Roadmap]], related [[specs/accounting-documents-spec|Accounting Documents Spec]], [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]], [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]], and [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]].

- Goal: track asset register, capitalization, depreciation schedule, transfer/custody, disposal/write-off, tax review, ledger source data, reports, approvals, and audit.
- Main flow: finance creates capitalization draft from vendor bill, expense, accounting/manual evidence, or attachment; accountant/approver reviews cost, useful life, residual value, ledger mapping, and source refs; approved asset enters the register; monthly depreciation run is calculated/reviewed/approved; transfer/custody changes preserve history; disposal/write-off is approved and stops future depreciation; ledger/tax/report hooks receive source data.
- Rules/exceptions: web/API own fixed-asset mutations; LINE/AI are read-only and deep-link to web; item 10 owns journal generation; item 11 owns tax filing/export lifecycle; first pass excludes hardware scanning, maintenance, leasing, construction-in-progress, component accounting, complex revaluation, and multi-book tax engine.
- Acceptance: asset transactions flow to ledger, tax, reporting, approval, and audit without bypassing controls; depreciation and disposal are reviewable, permission-protected, and source-linked.

### BUC-22: Manufacturing, MRP, and Advanced Warehouse

Source: [[specs/manufacturing-mrp-warehouse-spec|Manufacturing, MRP, and Advanced Warehouse Spec]], [[plans/manufacturing-mrp-warehouse-plan|Manufacturing, MRP, and Advanced Warehouse Plan]].

- Goal: support BOM, production orders, material issue/receipt, lot/batch/serial/bin traceability, warehouse tasks, MRP suggestions, and costing hooks.
- Main flow: planner sets product planning profile/BOM/routing; manager releases production order; warehouse issues materials; production receives output/scrap; MRP creates reviewable purchase/production/transfer suggestions; warehouse executes putaway/pick/replenishment/cycle count.
- Rules/exceptions: no MES/OEE, finite capacity solver, scanner fleet, complex quality, shipping, EDI, or final LINE/AI manufacturing/warehouse mutation in first pass.
- Acceptance: production and warehouse movements create auditable stock movements, costing flows to ledger only when policy exists, and AI suggestions stay draft/approval-gated.

### BUC-23: AI Marketing Drafts

Source: [[specs/ai-marketing-platforms-spec|AI Marketing Platforms Spec]], [[plans/ai-marketing-plan|AI Marketing Plan]].

- Goal: help owners/marketing create platform-specific campaign ideas and drafts from trusted business data.
- Main flow: user asks AI Marketing for campaign idea; AI checks product, stock, sales trend, margin, customer segment, and channel history; AI drafts caption/script/promotion direction; user edits and approves manually.
- Rules/exceptions: roadmap backlog; marketplace/platform integrations are later; no external post/store mutation without explicit confirmation.
- Acceptance: AI drafts TikTok/Facebook/Shopee-style content, warns when stock/data is insufficient, and never auto-posts.

### BUC-24: Production Operations Readiness

Source: [[specs/production-ops-spec|Production Ops Spec]], [[plans/production-ops-plan|Production Ops Plan]].

- Goal: make production health, backups, restore drills, monitoring, releases, rollback records, runbooks, and cost guard visible without exposing destructive controls.
- Main flow: admin opens ops dashboard; system shows readiness/evidence, backup policy/status, restore drill records, monitoring alerts, release/rollback visibility, cost guard, and runbook links; notifications/AI provide read-only summaries.
- Rules/exceptions: no production deploy, rollback, restore, migration rollback, IAM, secret, budget, or infrastructure mutation from app UI, LINE, or AI.
- Acceptance: restore is tested, logs/metrics are useful, rollback path is documented, cost guard is visible, and sensitive evidence is sanitized.

## Cross-Use-Case Acceptance

- Web remains the source of truth for final business workflows.
- LINE and AI remain read-only or draft/request channels unless a source module explicitly adds a reviewed web action.
- Every money, stock, tax, accounting, approval, permission, export, and external publishing path has permission checks and audit.
- Source documents, ledger entries, tax events, reports, and AI answers cite source refs or show missing/blocked state.
- Missing modules show unavailable/partial state, not fake zero.
- Roadmap order follows [[plans/master-implementation-checklist|Master Implementation Checklist]] unless owner records a reorder.

## Open Business Decisions From Existing Docs

- Should bank reconciliation be MVP?
- Does sales need visit scheduling or map routing?
- Does the business often use deposits, partial payment, or partial delivery?
- Which export format does the accountant or accounting office expect?
- Is external accountant an invited user role from MVP?
- Which LINE invite/linking flow should ship first: admin invite link, phone/email match, or manual admin approval?
