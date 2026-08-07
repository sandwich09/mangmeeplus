# SME Business OS Overview Spec

## Goal

Define WatchDog-BMS as an SME Business OS for Thai SMEs where web is the full source-of-truth workspace and LINE is the AI assistant channel for checking data, summaries, and alerts.

Default stack:

- Web Admin: Next.js full workspace
- LINE assistant channel: LINE Official Account + Messaging API + LIFF + LINE Login
- Backend: NestJS
- AI: separate AI Gateway service with domain agents
- Hosting target: AWS-first for staging and production

## Non-goals

- Full enterprise ERP in the first release
- Automatic tax filing submission without accountant/user confirmation in MVP
- Complex manufacturing, MRP, or warehouse automation
- Multi-country compliance before core workflows are stable
- AI embedded directly inside ERP domain services
- AI making irreversible business changes without user approval

## User Roles

- Owner: sees all dashboards, approves settings, reviews alerts
- Admin: manages master data, employee users, roles, permissions, configuration
- Employee: uses web and LINE AI within assigned role permissions
- Sales: manages leads, customers, orders, follow-ups
- Inventory staff: manages stock in/out, adjustments, counts
- Accountant or finance: reviews sales, expenses, receivables, exports
- Manager: approves reimbursement, purchase orders, leave, and discounts
- Marketing: creates campaign drafts and platform-specific content
- AI assistant user: asks questions and requests summaries within permission scope

## Core Modules

1. Authentication, LINE account linking, employee access, roles, and team permissions
2. Product and inventory management
3. Customer and CRM workflow
4. Sales/order workflow
5. FlowAccount-style accounting documents and finance workflow
6. Thai tax support for VAT, withholding tax, and corporate tax calendar
7. Expense and reimbursement workflow
8. Dashboard and KPI monitoring
9. Notification and approval system
10. Workflow automation
11. AI Gateway and agent chat
12. Audit log and activity history

## Business Workflow

1. Admin sets up company, employee users, roles, products, stock locations, and customers.
2. Team records stock movements, sales, customer activity, and expenses.
3. System updates dashboards and business metrics.
4. Notifications alert users about exceptions or follow-up tasks.
5. Web users create, view, edit, approve, and review full business records.
6. LINE users ask AI about system data and receive alerts or summaries.
7. AI replies with concise answers and links back to web detail when needed.
8. Owner reviews daily summary and takes action in web when a final change is needed.

## Business Rules

- Stock-affecting actions must create immutable movement records.
- Sensitive accounting data must be permission-controlled.
- AI responses must cite data source or state uncertainty.
- User actions that affect money, stock, or permissions must be auditable.
- Employee access changes, temporary password generation, role assignment, and LINE link token generation must be audited without storing secrets.
- Reports should be reproducible from stored source-of-truth records.
- AI agents must access ERP data only through permission-checked APIs/tools.
- Web is the source of truth for full data entry, data viewing, approvals, reports, and configuration.
- LINE may summarize and explain data, but it must not become a second workspace for final business mutations.

## Data Model Draft

- Company
- User
- Role
- Permission
- EmployeeAccessProfile
- Product
- InventoryLocation
- StockMovement
- Customer
- Lead
- SalesOrder
- InvoiceDraft
- PaymentRecord
- ExpenseRecord
- ReimbursementRequest
- DocumentCapture
- ApprovalRequest
- TaxInvoice
- WithholdingTaxCertificate
- TaxFilingPeriod
- Notification
- PlatformLineChannel
- LineCompanyContext
- LineChannelBinding (legacy/company-specific only)
- ExternalIdentity
- LineConversation
- WorkflowRule
- ActivityLog
- AiAgent
- AiConversation
- AiToolInvocation

## API Behavior

- APIs should validate permission before returning business data.
- Mutating APIs should record actor, timestamp, and business reason where relevant.
- List APIs should support pagination, filtering, and sorting.
- Dashboard APIs should return full web data and compact AI summary inputs.
- AI APIs should operate through approved tools and permission boundaries.
- Web APIs expose detail-heavy accounting/tax/BI/data-management views.
- Financial statement APIs should use the double-entry ledger after item 10, not ad hoc document totals.
- LINE APIs optimize for AI chat, alert delivery, source references, and web deep links.
- Employee access APIs create named users, temporary password handoff, role assignment, and LINE link tokens through permission-checked web flows only.

## UI Behavior

- Web admin prioritizes data entry, data viewing, setup, employee/role management, accounting, tax reports, GL, trial balance, journal entries, advanced BI, bulk management, approvals, audit, and permissions.
- LINE Official Account prioritizes AI chat, data questions, summaries, and alerts.
- LIFF is limited to account linking, auth bridge, and deep links from LINE to web detail.
- Critical alerts should be visible within one tap from home screen.
- Complex reports are web-first and can have LINE AI summaries.

### LINE examples

- Owner: today/month sales, top products, overdue invoices, low stock, tax reminders, reimbursement alerts, AI summary
- Sales: follow-up due, pipeline summary, customer status questions
- Warehouse: low-stock and stockout-risk questions
- Manager: approval queue summary and SLA-risk alerts

### Web examples

- Product, customer, stock, sales, expense, reimbursement, and accounting data entry
- Settings > Employees and Settings > Roles for employee access, temporary password handoff, and LINE link QR generation
- General Ledger, Trial Balance, Journal Entry, period closing from double-entry ledger
- VAT report, withholding tax report, CIT report preparation
- Profit & Loss, Balance Sheet, forecasting, advanced BI
- Approval decision pages, audit review, setup, permissions, exports

## Edge Cases

- Offline or delayed stock updates
- Negative stock prevention versus allowed backorder
- Duplicate customers or products
- Permission changes during active session
- AI cannot answer because data is missing or user lacks permission
- Accounting period locked after review
- Tax rules or filing dates change after docs are written
- AI suggestion conflicts with current approval policy
- LINE account is not linked to an internal user.
- User opens an old LIFF deep link after permission or approval state changed.

## Acceptance Criteria

- Product scope is documented and understandable by non-technical stakeholders.
- MVP modules are clearly separated from future modules.
- Every future feature spec can link back to this overview.
- Implementation plans can be phased without losing core product direction.

## Test Cases

- Verify each module has owner, workflow, and source-of-truth record.
- Verify permission-sensitive modules are marked as such.
- Verify AI assistant has explicit safety boundaries.
- Verify inventory and accounting records require auditability.
- Verify web/LINE boundary is clear for every major module.
- Verify AI Gateway is separated from core ERP logic.

## First Implementation Decisions

- Default AWS region and deployment service: Asia Pacific Singapore (`ap-southeast-1`) on ECS Fargate first, unless Thailand region service/model availability and cost are confirmed before production launch.

## Open Questions

- Which accounting scope is required first beyond document flow and reports?
- Which inventory workflows are mandatory for target customers?
- Which AI actions may create drafts versus only answer questions?
- Which LINE rich menu actions should ship first?
