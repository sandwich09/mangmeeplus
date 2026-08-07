# Enterprise Architecture Spec

## 1. Goal

Define a scalable architecture for "ERP/Business OS for one-person SME builder" that can start lean but not trap the product when modules, web workflows, LINE AI assistant, AI, tax, accounting, and marketplace integrations grow.

## 2. Architecture Principles

- Modular monolith first for ERP core; split services only when operational pain justifies it.
- AI Gateway is a separate service from ERP core.
- Source-of-truth records live in ERP database, not AI memory.
- Every business mutation passes permission, validation, and audit.
- Web APIs support full detail-heavy workflows; LINE APIs support AI chat, summaries, alerts, account linking, and deep links.
- Backend modules follow hexagonal architecture with presentation, application/use cases, domain, and infrastructure separated.
- Tax/accounting rules are configurable and versioned.
- External integrations are isolated behind adapters and queues.

## 3. Target Applications

```
apps/
  web/          Next.js admin: Business OS, finance, tax, BI, setup
  api/          NestJS ERP core: domain APIs and source-of-truth logic
  ai-gateway/   AI orchestration: agents, tools, policies, citations
  workers/      queues: notification, import, report, webhook, AI jobs
packages/
  contracts/    shared API schemas and event contracts
  config/       environment schema and shared config helpers
  design-tokens/ shared web and LIFF theme tokens
infra/
  docker/
  deploy/
  migrations/
```

## 4. Bounded Contexts

- Identity and Access: user, role, permission, workspace, sessions.
- Company Setup: company profile, tax id, branches, document sequences.
- Product and Inventory: product, location, lot, movement, stock balance.
- CRM and Sales: customer, lead, opportunity, activity, quotation draft.
- Accounting Documents: quotation, invoice, billing note, receipt, tax invoice, payment.
- Double-Entry Ledger and Closing: chart of accounts, posting rules, journal entries, journal lines, financial statements, and accounting periods.
- Expense and Reimbursement: expense, receipt attachment, approval, payment.
- Document Capture: web upload, OCR/AI extraction, draft document review, duplicate detection.
- Tax: VAT, WHT, CIT calendar, tax period, filing export, 50 Tawi.
- Approval Workflow: approval request, steps, policy, SLA.
- Notification: rules, events, delivery, preferences.
- Dashboard and Reporting: metrics, snapshots, exports.
- Marketplace Integration: platform account, order import, sales summary.
- AI Gateway: agents, tool invocation, conversation, citation, policy.
- Audit and Compliance: immutable audit log and data access log.

## 5. Runtime Architecture

```
Next.js Web    -> API Gateway/BFF -> NestJS ERP Core -> PostgreSQL
LINE OA        -> Messaging Webhook -> AI Gateway -> permission-checked ERP tools
LIFF           -> account link/deep link screens -> API Gateway/BFF
AI Gateway     -> permission-checked tools -> NestJS ERP Core
ERP Core       -> Event Outbox -> Workers -> Notifications/Webhooks/Imports
Workers        -> Redis Queue -> LINE/Email/External APIs
```

Recommended MVP infrastructure:

- PostgreSQL for source-of-truth relational data.
- Redis for queue, rate limit, cache, and idempotency.
- Object storage for receipts, PDFs, exports, and attachments.
- Queue workers for notifications, reports, marketplace imports, and AI background tasks.
- REST first with a shared TypeScript contract package for MVP implementation and OpenAPI documentation for inspection/integration.
- Shared design-token package generates web CSS variables.
- Prisma for MVP database access and migrations.
- LINE Login for MVP user login, with backend-issued first-party session/JWT for WatchDog-BMS APIs.
- Cognito or another identity broker remains optional later if operational needs justify it.
- Application database for company/workspace membership, roles, permissions, and audit.
- Redis/BullMQ for queue, cache, rate limit, and idempotency in Phase 1.
- AWS-first hosting target. Solo-dev MVP uses a local/prod lean path; staging is deferred until release risk or team size justifies it. See `docs/adr/0005-aws-first-hosting-and-deployment-strategy.md`.
- Phase 1 stack defaults. See `docs/adr/0006-phase-1-platform-stack-defaults.md`.

## 6. Data Architecture

Rules:

- Every table has `companyId` unless global config.
- Business records include `createdBy`, `updatedBy`, and timestamps.
- Financial/tax/source records use immutable correction/reversal, not silent overwrite after lock.
- Document numbers come from sequence service with transaction locking.
- Finalized accounting documents generate balanced double-entry journal entries where accounting posting applies.
- Posted journal entries are locked; corrections use reversal or adjustment records.
- Period close locks relevant source records and journal posting.
- Financial reports derive from ledger entries; operational reports are reproducible from source records or stored snapshots with checksum.
- Marketplace imports keep raw payload copy for audit/debug.

## 7. Multi-Tenant and Permission Model

- Tenant boundary = company/workspace.
- All APIs require company context.
- RBAC controls module/action access.
- ABAC rules handle owner/assignee/customer-owner/amount-threshold cases.
- AI tools inherit the same permission checks as user APIs.
- Admin can configure users, but cannot bypass audit.

## 8. Event and Queue Model

Use transactional outbox:

1. Domain service writes source record.
2. Same DB transaction writes outbox event.
3. Worker publishes queue job.
4. Worker updates event delivery state.

Event examples:

- inventory.stock_low_detected
- crm.follow_up_due
- accounting.invoice_issued
- accounting.journal_posted
- accounting.period_closed
- accounting.invoice_overdue
- reimbursement.submitted
- approval.sla_breached
- tax.period_due_soon
- marketplace.order_imported
- ai.summary_requested
- notification.delivery_failed
- line.message_received
- document.web_upload_requested
- document.extraction_completed
- document.extraction_review_required
- line.delivery_failed

## 9. AI Gateway Architecture

AI Gateway owns:

- Agent routing.
- Prompt policy.
- Tool catalog.
- Tool invocation audit.
- Conversation memory.
- Citation formatting.
- Model/provider selection.
- Safety rules for draft versus final action.

ERP core owns:

- Source-of-truth data.
- Permission checks.
- Business validation.
- Audit logs.
- Final mutation.

Rule: AI Gateway can call ERP tools; ERP core must not embed LLM calls in domain services.

## 10. Security and Compliance

- LINE Login validation during login/link flow and WatchDog-BMS session/JWT validation on every protected API call.
- LINE Messaging API webhook signature validation.
- Refresh token rotation.
- Optional 2FA for owner/admin/finance/accountant.
- Object storage uses signed URLs and content-type validation.
- PII and financial data access is logged.
- Secrets stored in environment/secret manager.
- Webhook signatures use HMAC.
- Rate limits for auth, AI chat, imports, and exports.
- Backup and restore tested before production.

## 11. Observability

Minimum:

- Structured logs with requestId, companyId, userId where safe.
- Audit log for business actions.
- Metrics: API latency, queue lag, notification failures, AI tool errors.
- Error tracking for web, LINE webhook, AI Gateway, and backend.
- Health checks per service.
- Admin-visible job status for imports/reports/exports.

## 12. Deployment Environments

- Local: Docker compose for PostgreSQL, Redis, object storage emulator.
- Staging: AWS-managed services with production-like data shape and test credentials.
- Production: AWS-managed PostgreSQL, Redis-compatible service, object storage, separate workers, secrets, logs, and backups.

Default AWS service mapping:

- Web, API, and AI Gateway: containerized services on ECS Fargate for first production.
- Workers: ECS Fargate tasks or services.
- Database: Amazon RDS for PostgreSQL.
- Queue/cache/idempotency: Amazon ElastiCache for Redis or Valkey.
- Files and exports: Amazon S3.
- Secrets: AWS Secrets Manager or SSM Parameter Store.
- Logs and metrics: Amazon CloudWatch.

Default production region is Asia Pacific Singapore (`ap-southeast-1`) unless Thailand region service/model availability, pricing, and operational readiness are confirmed for the required stack.

App Runner is not a default target for new deployments because it is no longer open to new AWS customers as of the 2026-06-23 docs review.

Release gates:

- DB migration reviewed.
- Tests pass.
- Seed/config diff checked.
- Backup exists before migration.
- Tax/accounting changes require extra review.

## 13. Performance Targets

- LINE AI summary reply p95 < 5 s for cached/read-only answers where provider allows.
- Simple API p95 < 300 ms.
- Dashboard web initial load < 3 s for normal tenant.
- Product search p95 < 500 ms for 10,000 SKUs.
- Notification delivery p95 < 10 s after trigger.
- AI first token target < 5 s for simple summary where provider allows.

## 14. Acceptance Criteria

- [ ] App boundaries are explicit: Next.js web, LINE OA/LIFF account-linking, NestJS, and AI Gateway.
- [ ] Domain modules map to bounded contexts.
- [ ] Source-of-truth and AI responsibilities are separated.
- [ ] Multi-tenant and permission model is clear.
- [ ] Queue/outbox pattern is specified.
- [ ] Security, observability, backup, and release gates exist.

## 15. First Implementation Decisions

- Default AWS region: Asia Pacific Singapore (`ap-southeast-1`) until Thailand region service/model availability and cost are confirmed.
- API contract path: shared TypeScript contract package first; OpenAPI documentation required; generated clients later.
- Native mobile push: later. MVP starts with LINE delivery, LINE AI chat, and web notification center.
- Queue path: Redis/BullMQ first; review SQS before beta or before high-value durable background jobs.
- Identity path: LINE Login plus backend-issued WatchDog-BMS session/JWT is enough for alpha. Cognito or another broker remains optional later.
