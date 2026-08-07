# Workflow Automation Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 16.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/workflow-automation-plan|Workflow Automation Plan]]

## 2. Goal

Implement safe workflow automation for WatchDog-BMS after CRM/Sales item 15 exists:

- Admin-configured workflow templates and rules.
- Event, schedule, threshold, SLA, and manual replay triggers.
- Deterministic conditions using a constrained JSON condition tree.
- Safe actions that notify, create tasks, create approval-review requests, request drafts, call allowlisted webhooks, or write audit notes.
- Workflow run history, action retry, dead-letter review, and replay.
- LINE alert/explanation surfaces with web deep links only.
- AI-readable workflow explanations through permission-checked APIs.

Workflow Automation connects modules but does not become the source of truth for money, stock, tax, accounting, CRM, permissions, or external publishing.

## 3. Non-Goals

- Full low-code marketplace, custom code execution, arbitrary scripts, or user-defined SQL.
- Replacing domain-owned business rules, approval policies, document state machines, ledger posting, stock movement logic, tax filing, bank transfer, CRM ownership, or notification delivery infrastructure.
- AI performing irreversible actions.
- LINE final approvals, payments, stock mutations, tax filing, accounting issue/post/void, permission changes, exports, or external publishing.
- Implementing the broad AI Draft and Suggestion Layer from item 17.
- Implementing AI Marketing/marketplace campaign execution from later roadmap items.
- Direct external bank, tax portal, marketplace, or social platform mutation.
- General public workflow API or third-party integration marketplace.

## 4. User Roles

- Owner: enables high-impact templates, reviews workflow health, receives escalation alerts, and audits business impact.
- Admin: manages workflow rules, templates, recipients, channels, cooldowns, webhook settings, retries, and dead letters.
- Manager: receives workflow tasks, approval-review tasks, and SLA escalations within assigned scope.
- Sales manager or Sales: receives CRM follow-up, overdue opportunity, and customer task alerts within CRM permissions.
- Inventory: receives low-stock, stockout-risk, reorder, and stock exception tasks within inventory permissions.
- Finance: receives overdue invoice, reimbursement, AP, bank reconciliation, and finance checklist tasks within finance permissions.
- Accountant: receives tax due, ledger/closing, evidence, and compliance checklist tasks within accounting/tax permissions.
- Marketing: receives draft-request tasks and campaign-review tasks; final publishing is out of scope.
- Staff: receives own tasks and reminders.
- Auditor readonly: reads workflow rules, runs, action history, and audit evidence without mutation.
- AI assistant user: asks why a workflow fired, what failed, or what needs attention; answers inherit same permissions as web.

## 5. Boundary and Ownership

Workflow Automation owns:

- Workflow templates, rules, trigger subscriptions, condition definitions, action definitions, rule versions, workflow runs, action runs, generic workflow tasks, dead letters, retry policy, and workflow explanation read models.

Source modules own:

- Source records and final mutations.
- Domain validation, permissions, ABAC, audit, and source-specific state machines.
- Event emission through outbox or equivalent integration points.
- Source-specific task/approval completion semantics when a task links back to a source record.

Dashboard/Notification owns:

- Notification preferences, notification center rows, delivery channels, LINE push delivery, quiet hours, digests, and dashboard snapshots.
- Workflow Automation calls notification APIs/actions; it must not duplicate notification delivery infrastructure.

AI Gateway owns:

- LLM orchestration, model calls, tool policy, citations, and AI draft generation after item 17.
- Workflow Automation may request a draft through an AI action adapter when an approved provider exists; otherwise the draft action must stay disabled or create a review task only.

LINE/Auth owns:

- LINE account linking, identity trust, webhook signature verification, and LIFF/web deep-link auth.

## 6. Current Repository Baseline

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with shared feature-folder conventions evolving through prior roadmap items.
- `packages/contracts`: shared contract package exists but may still be thin.
- `packages/config`: shared config package exists but may still be thin.

Before implementation, inspect latest code again because items 01 through 15 may add Prisma, auth, request context, company/branch/team primitives, permissions, audit, outbox, notifications, dashboard providers, LINE binding, AI tool registration, web shell routes, API client helpers, and source-module events. Extend existing primitives. Do not create duplicate tenant, auth, audit, outbox, notification, dashboard, LINE, AI Gateway, web shell, worker queue, or contract code.

## 7. References

- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 16.
- Implementation plan: [[plans/workflow-automation-plan|Workflow Automation Plan]]
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Shared data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Web shell: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Dashboard/notification: [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
- LINE read-only assistant: [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- AI Gateway: [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- CRM/Sales: [[specs/crm-sales-spec|CRM and Sales Spec]]
- Reimbursement: [[specs/reimbursement-approval-spec|Reimbursement and Approval Spec]]
- Expense upload: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Bank reconciliation: [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]]
- Procurement/AP: [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
- Accounting documents: [[specs/accounting-documents-spec|Accounting Documents Spec]]
- Ledger/closing: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
- Thai tax: [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Web guideline: [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## 8. Product Decisions

- Workflow Automation starts after item 15 and can integrate with implemented modules from items 05 through 15.
- Tenant boundary is always `companyId`.
- Web is the only rule builder and dead-letter replay surface.
- LINE receives alerts and explanations only, then deep-links to web.
- AI can explain workflow runs and suggest rule configuration, but cannot enable rules or execute unsafe actions without admin web confirmation.
- Workflow rules use a structured JSON condition tree. No arbitrary JavaScript, SQL, eval, or plugin code.
- Rule enablement creates immutable rule versions. Existing runs keep their original rule version snapshot.
- Every run and action run is idempotent and auditable.
- Unsafe actions create drafts, tasks, approval-review requests, or source-module requests. Source modules still decide final mutation.
- Workflow tasks are generic operational tasks. They must link to source records and must not replace CRM follow-ups, reimbursement approvals, accounting approvals, ledger posting, stock movement, tax filing, or payment records.
- Webhook actions are allowlisted, signed, rate-limited, audited, and disabled by default.
- Template seeds are disabled by default unless source module has already shipped a safe default in its own spec.
- Rule cooldown prevents noisy duplicate tasks/alerts.
- Dead-letter replay re-validates current permissions, source state, action safety, and idempotency.
- Workflow cannot hide, modify, or delete audit records.
- WorkflowTask remains workflow-owned in item 16. A shared cross-module task center is future scope and needs its own checklist item or explicit owner approval.

## 9. Automation Model

Canonical flow:

```text
Trigger -> Rule Version -> Conditions -> Action Plan -> Action Runs -> Audit -> Retry/Dead Letter/Resolution
```

Trigger types:

```text
EVENT
SCHEDULE
THRESHOLD_SCAN
SLA_SCAN
MANUAL_TEST
MANUAL_REPLAY
```

Condition groups:

```text
ALL
ANY
NOT
```

Condition operators:

```text
EQ
NEQ
GT
GTE
LT
LTE
IN
NOT_IN
EXISTS
MISSING
CONTAINS
STARTS_WITH
OLDER_THAN
WITHIN_NEXT
BETWEEN
```

Allowed action types:

```text
SEND_NOTIFICATION
CREATE_WORKFLOW_TASK
CREATE_APPROVAL_REVIEW_REQUEST
REQUEST_AI_DRAFT
CREATE_REPORT_EXPORT_DRAFT
CALL_WEBHOOK
ADD_AUDIT_NOTE
NOOP_DISABLED_TEMPLATE
```

Unsafe final actions are not allowed action types.

## 10. Event Contract

Workflow consumes source-module events through outbox/inbox primitives when present.

Minimum event envelope:

```text
eventId
eventType
companyId
sourceModule
sourceType
sourceId
sourceVersion
occurredAt
actorUserId
dedupKey
payload
schemaVersion
```

Rules:

- `eventId` is globally unique.
- `dedupKey` is deterministic for retryable source events.
- `payload` must contain only stable fields needed for conditions and source refs.
- Workflow must fetch current source state before unsafe or replayed actions when source module exposes a read API.
- Unknown event schema versions are ignored and recorded as skipped, not failed.

Required first source events if source modules exist:

```text
inventory.stock_balance_low
inventory.stockout_risk_detected
accounting.invoice_overdue
tax.period_due_soon
reimbursement.request_submitted
reimbursement.approval_pending
procurement.vendor_bill_pending_approval
bank.reconciliation_unmatched_line_aged
crm.follow_up_due
crm.opportunity_stuck
crm.sales_target_at_risk
notification.delivery_failed
ai.draft_requested
```

If any source module lacks an event, implementation should add an adapter or register the template as unavailable with a clear reason.

## 11. Data Model Draft

Use existing Prisma/schema conventions if present. Names below are conceptual.

### WorkflowTemplate

- `id`
- `key` unique
- `name`
- `description`
- `category`
- `sourceModule`
- `triggerType`
- `defaultConditionJson`
- `defaultActionJson`
- `requiredPermissions`
- `requiredSourceModules`
- `defaultEnabled`
- `status`: `AVAILABLE`, `UNAVAILABLE`, `DEPRECATED`
- `unavailableReason`
- `createdAt`
- `updatedAt`

### WorkflowRule

- `id`
- `companyId`
- `templateId`
- `name`
- `description`
- `status`: `DRAFT`, `ENABLED`, `DISABLED`, `ARCHIVED`
- `triggerType`
- `triggerConfigJson`
- `conditionJson`
- `actionJson`
- `recipientConfigJson`
- `cooldownSeconds`
- `timezone`
- `createdBy`
- `updatedBy`
- `enabledBy`
- `enabledAt`
- `disabledBy`
- `disabledAt`
- `currentVersion`
- `createdAt`
- `updatedAt`

### WorkflowRuleVersion

- `id`
- `ruleId`
- `companyId`
- `version`
- `status`
- `triggerSnapshotJson`
- `conditionSnapshotJson`
- `actionSnapshotJson`
- `recipientSnapshotJson`
- `cooldownSeconds`
- `createdBy`
- `createdAt`

### WorkflowEventInbox

- `id`
- `companyId`
- `eventId`
- `eventType`
- `sourceModule`
- `sourceType`
- `sourceId`
- `sourceVersion`
- `payloadJson`
- `dedupKey`
- `status`: `RECEIVED`, `MATCHED`, `SKIPPED`, `FAILED`
- `receivedAt`
- `processedAt`
- `errorCode`
- `errorMessage`

### WorkflowRun

- `id`
- `companyId`
- `ruleId`
- `ruleVersionId`
- `triggerType`
- `triggerEventId`
- `sourceModule`
- `sourceType`
- `sourceId`
- `sourceVersion`
- `dedupKey`
- `conditionResultJson`
- `status`: `QUEUED`, `RUNNING`, `SUCCEEDED`, `PARTIAL_FAILED`, `FAILED`, `SKIPPED`, `CANCELED`
- `startedAt`
- `finishedAt`
- `createdAt`

Unique constraint:

```text
companyId + ruleVersionId + dedupKey
```

### WorkflowActionRun

- `id`
- `companyId`
- `workflowRunId`
- `actionKey`
- `actionType`
- `actionConfigSnapshotJson`
- `status`: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `DEAD_LETTERED`, `SKIPPED`, `CANCELED`
- `idempotencyKey`
- `targetType`
- `targetId`
- `attemptCount`
- `nextAttemptAt`
- `lastErrorCode`
- `lastErrorMessage`
- `resultJson`
- `startedAt`
- `finishedAt`
- `createdAt`
- `updatedAt`

Unique constraint:

```text
companyId + actionType + idempotencyKey
```

### WorkflowTask

- `id`
- `companyId`
- `workflowRunId`
- `workflowActionRunId`
- `sourceModule`
- `sourceType`
- `sourceId`
- `title`
- `description`
- `assigneeUserId`
- `assigneeRole`
- `priority`: `LOW`, `NORMAL`, `HIGH`, `CRITICAL`
- `status`: `OPEN`, `SNOOZED`, `DONE`, `CANCELED`
- `dueAt`
- `snoozedUntil`
- `completedBy`
- `completedAt`
- `cancelReason`
- `webDeepLink`
- `createdAt`
- `updatedAt`

### WorkflowDeadLetter

- `id`
- `companyId`
- `workflowRunId`
- `workflowActionRunId`
- `errorCode`
- `errorMessage`
- `errorDetailsJson`
- `resolutionStatus`: `OPEN`, `REPLAYED`, `IGNORED`, `RESOLVED_EXTERNALLY`
- `resolvedBy`
- `resolvedAt`
- `resolutionNote`
- `createdAt`

### WorkflowWebhookEndpoint

- `id`
- `companyId`
- `name`
- `url`
- `status`: `DISABLED`, `ENABLED`
- `secretRef`
- `allowedEventTypes`
- `createdBy`
- `createdAt`
- `updatedAt`

## 12. Permission Keys

Use or add these permission keys:

```text
workflow.template.read
workflow.rule.read
workflow.rule.manage
workflow.rule.enable
workflow.run.read
workflow.run.replay
workflow.task.read
workflow.task.work
workflow.dead_letter.read
workflow.dead_letter.replay
workflow.webhook.manage
workflow.audit.read
```

Default grants:

```text
OWNER: all workflow permissions
ADMIN: all workflow permissions except no implicit bypass of source-module permissions
MANAGER: workflow.run.read where ABAC allows, workflow.task.read/team, workflow.task.work/team
SALES: workflow.task.read/own, workflow.task.work/own
INVENTORY: workflow.task.read/own, workflow.task.work/own
FINANCE: workflow.task.read/own, workflow.task.work/own, workflow.run.read where finance source permission allows
ACCOUNTANT: workflow.task.read/own, workflow.task.work/own, workflow.run.read where accounting/tax source permission allows, workflow.audit.read
MARKETING: workflow.task.read/own, workflow.task.work/own
STAFF: workflow.task.read/own, workflow.task.work/own
AUDITOR_READONLY: workflow.template.read, workflow.rule.read, workflow.run.read, workflow.dead_letter.read, workflow.audit.read
```

Rules:

- Managing a workflow rule requires workflow permission and permission to read the source module used by the rule.
- Enabling an action that creates source-module tasks or draft requests requires workflow permission plus relevant source-module permission.
- Replaying a failed action re-checks current user permission and source state.
- AI tools inherit the user's workflow and source-module permissions.

## 13. API Behavior

REST paths may follow existing route conventions. Use names below as behavioral contract.

### Templates

- `GET /companies/:companyId/workflow/templates`
  - Permission: `workflow.template.read`.
  - Returns available/unavailable templates and unavailable reasons.
- `POST /companies/:companyId/workflow/templates/:templateKey/enable`
  - Permission: `workflow.rule.manage` and `workflow.rule.enable`.
  - Validates source modules, required fields, recipients, cooldown, and source permissions.
  - Creates disabled draft or enabled rule according to request.

### Rules

- `GET /companies/:companyId/workflow/rules`
  - Permission: `workflow.rule.read`.
  - Filters by status, trigger, source module, template, and search text.
- `POST /companies/:companyId/workflow/rules`
  - Permission: `workflow.rule.manage`.
  - Creates draft rule after condition/action validation.
- `GET /companies/:companyId/workflow/rules/:ruleId`
  - Permission: `workflow.rule.read`.
- `PATCH /companies/:companyId/workflow/rules/:ruleId`
  - Permission: `workflow.rule.manage`.
  - Edits draft/disabled rule and creates a new version when enabled later.
- `POST /companies/:companyId/workflow/rules/:ruleId/enable`
  - Permission: `workflow.rule.enable`.
  - Creates immutable rule version and starts trigger subscription/schedule.
- `POST /companies/:companyId/workflow/rules/:ruleId/disable`
  - Permission: `workflow.rule.manage`.
  - Stops future runs. Existing queued action runs follow policy.
- `POST /companies/:companyId/workflow/rules/:ruleId/test`
  - Permission: `workflow.rule.manage`.
  - Evaluates condition/action plan against sample payload without performing actions.

### Runs and Actions

- `GET /companies/:companyId/workflow/runs`
  - Permission: `workflow.run.read`.
  - Filters by rule, status, source, action type, date, and search.
- `GET /companies/:companyId/workflow/runs/:runId`
  - Permission: `workflow.run.read`.
  - Returns rule version snapshot, condition result, action runs, audit refs, and source refs.
- `POST /companies/:companyId/workflow/action-runs/:actionRunId/replay`
  - Permission: `workflow.run.replay`.
  - Re-validates source state and idempotency, then queues replay if safe.

### Tasks

- `GET /companies/:companyId/workflow/tasks`
  - Permission: `workflow.task.read`.
  - Filters by assignee, status, priority, due date, source, and search.
- `POST /companies/:companyId/workflow/tasks/:taskId/snooze`
  - Permission: `workflow.task.work`.
- `POST /companies/:companyId/workflow/tasks/:taskId/complete`
  - Permission: `workflow.task.work`.
  - Completion only closes the workflow task, not the source business record.
- `POST /companies/:companyId/workflow/tasks/:taskId/cancel`
  - Permission: `workflow.task.work` or `workflow.rule.manage` according to ownership.

### Dead Letters

- `GET /companies/:companyId/workflow/dead-letters`
  - Permission: `workflow.dead_letter.read`.
- `POST /companies/:companyId/workflow/dead-letters/:deadLetterId/replay`
  - Permission: `workflow.dead_letter.replay`.
- `POST /companies/:companyId/workflow/dead-letters/:deadLetterId/ignore`
  - Permission: `workflow.dead_letter.replay`.
  - Requires resolution note.

### Explanation

- `GET /companies/:companyId/workflow/explanations/:runId`
  - Permission: `workflow.run.read`.
  - Returns human-readable reason: trigger, matching condition, actions attempted, source refs, and next action.

## 14. Worker Behavior

- Event ingestion stores inbound events in `WorkflowEventInbox` before matching rules.
- Rule matching must be deterministic and side-effect free.
- Action execution runs in workers with capped retry and dead-letter transition.
- Default retry policy: 3 attempts with exponential backoff and jitter unless existing worker policy differs.
- Failed notification delivery follows Notification module policy; Workflow records linked action result and dead letter only when the workflow action itself cannot complete.
- Scheduled scans must use company timezone.
- Long scans must page through source read APIs and avoid loading full company data into memory.
- Workers must emit structured logs with request/job id, company id, rule id, run id, action run id, and source ref where safe.

## 15. Web UI Behavior

Workflow workspace route should follow existing web shell conventions. Suggested tabs:

- Templates: prebuilt templates, availability, enable/configure flow.
- Rules: list, filters, status, trigger type, source module, last run, owner, enable/disable.
- Rule editor: name, trigger, conditions, actions, recipients, cooldown, test sample, validation errors.
- Runs: searchable run history with status, source, condition result, action results, and source links.
- Tasks: assigned workflow tasks with snooze, complete, cancel, source deep link, and priority.
- Dead letters: error details, retry/ignore, resolution note, source refs, and replay eligibility.
- Webhooks: endpoint list, signing status, allowed events, disabled-by-default warning.

UI rules:

- Admin-only configuration actions are hidden/disabled according to permission, but backend remains source of truth.
- Dangerous-looking action setup must show explicit draft/approval behavior, not imply final mutation.
- Rule test mode never performs actions.
- Dead-letter replay shows current source-state warnings before queuing.
- Every detail view should include audit/source refs and web deep links.

## 16. LINE and LIFF Behavior

LINE users can:

- Receive workflow-created alerts and task reminders through Notification module delivery.
- Ask AI why a workflow fired.
- Ask for assigned workflow tasks or workflow status summaries.
- Open source record or workflow run in web.
- Snooze low-risk reminders only when the workflow task action is explicitly allowed and re-checked by API.

LINE users cannot:

- Build, enable, disable, replay, or delete workflow rules.
- Approve/reject final business records.
- Run bulk automation.
- Override finance, tax, accounting, stock, CRM, approval, or permission policy.
- Trigger final money, stock, tax, accounting, approval, permission, export, webhook, or external publishing mutations.

LIFF is limited to account linking, context selection, and deep-link handoff. Full workflow rule configuration opens in web.

## 17. AI Behavior

AI can:

- Explain why a workflow fired.
- Summarize workflow runs, failures, dead letters, and assigned tasks.
- Suggest rule configuration text for an admin to review in web.
- Draft notification copy when used as text only and saved as draft/review material.

AI cannot:

- Enable/disable rules without admin web confirmation.
- Replay dead letters without admin web confirmation.
- Execute unsafe actions.
- Hide or rewrite workflow/audit history.
- Create final marketing posts, tax filings, payments, stock movements, accounting postings, or permission changes.

AI Gateway must call permission-checked workflow APIs/tools. It must not import API Prisma clients or workflow repositories.

## 18. Prebuilt Templates

| Template | Trigger | Conditions | Actions | First-pass status |
|---|---|---|---|---|
| Daily owner summary | Schedule daily 07:00 company timezone | Owner/Admin recipients exist | Send notification with dashboard summary link | Available if dashboard summary exists |
| Low stock alert | `inventory.stock_balance_low` or threshold scan | Balance <= reorder point | Notify inventory/owner, create workflow task | Available if inventory exists |
| Stockout risk | `inventory.stockout_risk_detected` | Days left <= threshold | Notify owner/inventory, create reorder review task | Available if inventory projection exists |
| Overdue invoice follow-up | `accounting.invoice_overdue` or schedule | Due date older than N days and unpaid | Notify finance/sales owner, create follow-up task | Available if accounting invoice exists |
| Tax due soon | `tax.period_due_soon` or schedule | Due within N days and not filed | Notify accountant/owner, create tax checklist task | Available if tax period exists |
| Reimbursement pending approval | `reimbursement.request_submitted` | Amount/department policy match | Notify manager, create approval-review task | Available if reimbursement exists |
| Approval SLA breach | SLA scan | Pending approval age > policy | Escalate to owner/manager, create escalation task | Available if approval source exposes pending state |
| Vendor bill pending | procurement/AP event or scan | Pending approval/payment beyond threshold | Notify finance/accountant, create task | Available if procurement/AP exists |
| Vendor bill second approval | `vendor_bill.approval_recorded` | Bill at/above dual-approval threshold has first approval recorded (H-07) | Notify holders of `procurement.vendor_bill.approve` minus submitter and recorded approvers (permission-resolved recipients with payload-key exclusions) | Available |
| Bank reconciliation aging | bank scan | Unmatched line age > N days | Notify finance, create reconciliation task | Available if bank reconciliation exists |
| CRM follow-up due | `crm.follow_up_due` | Due now/open | Notify sales owner, create task link | Available if CRM exists |
| Opportunity stuck | `crm.opportunity_stuck` or schedule | No stage/activity change > N days | Notify sales manager, create review task | Available if CRM exists |
| Sales below target | schedule | Actual sales < target by cutoff | Notify owner/manager, create review task | Available if target/dashboard source exists |
| AI draft requested | `ai.draft_requested` | Draft provider available and safe | Request AI draft or create disabled-task note | Disabled until item 17 provider exists |
| Outbound webhook | selected event | Endpoint allowlisted and enabled | Signed webhook call | Disabled by default |

## 19. Safety Rules

- Workflow cannot directly move money.
- Workflow cannot directly issue, approve, post, void, reconcile, close, or file accounting/tax records.
- Workflow cannot directly reduce stock or create stock movement without a source-module user action.
- Workflow cannot change permissions, roles, membership, auth, or LINE account linking.
- Workflow cannot publish marketing content or send external customer-facing campaign content without a later approved module.
- Workflow cannot export sensitive data automatically unless a source module provides a draft/export-request action with explicit review.
- Any source-module write adapter must verify current source state, permission, and idempotency.
- Action payloads must avoid storing unnecessary PII or secrets.
- Webhook secrets must be stored through existing secret/env mechanisms, not plaintext in config JSON.

## 20. Acceptance Criteria

- [ ] Workflow templates cover daily summary, low stock, stockout risk, overdue invoice, tax due, reimbursement/approval, bank/procurement aging where source modules exist, CRM follow-up, stuck opportunity, sales target risk, AI draft request disabled state, and outbound webhook disabled state.
- [ ] Admin can enable, disable, test, and edit workflow rules from web.
- [ ] Rule conditions use constrained JSON only; arbitrary script/SQL execution is impossible.
- [ ] Every rule enable creates immutable rule version snapshot.
- [ ] Every run is idempotent by deterministic dedup key.
- [ ] Every action run is idempotent by deterministic action idempotency key.
- [ ] Every run/action writes audit and source refs.
- [ ] Unsafe actions become drafts, tasks, or approval-review requests.
- [ ] Failed retryable actions retry with capped backoff and then enter dead-letter state.
- [ ] Admin can inspect, replay, or ignore dead letters with resolution notes.
- [ ] LINE receives alerts/explanations only and deep-links to web for final action.
- [ ] AI explanations are permission-aware and cite workflow/source refs.
- [ ] Unauthorized users cannot read or manage workflow rules/runs/tasks outside permission and ABAC scope.

## 21. Test Cases

- Unit: condition evaluator handles `ALL`, `ANY`, `NOT`, numeric/date/string/list operators, missing fields, timezone windows, and invalid schemas.
- Unit: unsafe action validator rejects final money, stock, tax, accounting, permission, export, and publishing actions.
- Unit: rule version snapshot remains stable after rule edit.
- Unit: dedup key prevents duplicate workflow runs for same source event.
- Unit: action idempotency key prevents duplicate notifications/tasks/webhooks on retry.
- Integration: template enable validates source module availability and permission.
- Integration: low-stock event creates one run, one notification action request, and one task action.
- Integration: approval SLA breach escalates once within cooldown window.
- Integration: failed webhook retries then creates dead letter.
- Integration: dead-letter replay re-checks permission/source state before queueing.
- Integration: disabling a rule stops future runs but keeps historical run visibility.
- API permission: non-admin cannot create, enable, disable, replay, or manage webhook rules.
- API ABAC: user sees own/team workflow tasks only unless role grants broader scope.
- LINE/AI: user can ask why a workflow fired only if they can read that run and source record.
- UI: web rule test displays condition/action plan without performing side effects.
- UI: dead-letter detail shows error, source ref, retry eligibility, and requires resolution note for ignore.
- Worker: retry policy transitions retryable failure to dead letter after max attempts.
- Security: webhook payload is signed, endpoint is allowlisted, and secrets are not returned by API.

## 22. Open Questions

- Which notification channels beyond web/LINE should be enabled first if email/SMS adapters exist?
- Which source modules expose sales target data before Reports/BI item 18?

## 23. Resolved Decisions

- 2026-06-23: First-pass workflow templates are disabled by default. Admin must enable and configure recipients, thresholds, cooldowns, and channels in web.
- 2026-06-23: WorkflowTask is workflow-owned for MVP. Source-specific tasks and approvals remain in their source modules. Shared task center is future scope.
