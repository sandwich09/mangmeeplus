# Workflow Automation Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 16.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Specs

- Spec: [[specs/workflow-automation-spec|Workflow Automation Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 16. Workflow Automation
- Related specs:
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
  - [[specs/crm-sales-spec|CRM and Sales Spec]]
  - [[specs/reimbursement-approval-spec|Reimbursement and Approval Spec]]
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
  - [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]]
  - [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
  - [[specs/accounting-documents-spec|Accounting Documents Spec]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]
  - [[adr/0008-line-ai-access-and-auth|ADR 0008 LINE AI Access and Auth]]

## Purpose

Implement the first safe Workflow Automation slice for WatchDog-BMS:

- Template catalog and admin-managed workflow rules.
- Structured condition evaluator with no arbitrary script execution.
- Event/schedule/threshold/SLA/manual triggers.
- Safe action runner for notifications, workflow tasks, approval-review tasks, draft requests, audit notes, and disabled-by-default signed webhooks.
- Idempotent workflow runs and action runs.
- Retry, dead-letter, replay, and resolution-note workflows.
- Web workflow console for templates, rules, runs, tasks, dead letters, and webhooks.
- LINE/AI read-only workflow explanations and alerts through existing notification/AI boundaries.

This plan gives Sonnet 4.6 enough detail to implement without reopening ownership of source modules, notification delivery, AI Gateway, LINE auth, permissions, or final business mutations.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with shared feature-folder conventions evolving through prior items.
- `packages/contracts`: shared contract package exists but may still be thin.
- `packages/config`: shared config package exists but may still be thin.

Before implementation, inspect latest code again because items 01 through 15 may add Prisma, auth, request context, company/branch/team primitives, permission grants, audit, outbox, notification delivery, dashboard snapshots, LINE binding, AI tool registry, worker queue helpers, web shell routes, API client helpers, and source-module event contracts.

Extend existing primitives. Do not duplicate tenant, auth, audit, outbox, notification, dashboard, LINE, AI Gateway, web shell, worker queue, source-module API, config, or contract code.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/workflow-automation-spec.md`.
3. Read `docs/specs/permission-matrix.md`.
4. Read `docs/specs/data-model-core-spec.md`.
5. Read `docs/specs/auth-authorization-rbac-spec.md`.
6. Read `docs/specs/web-core-workspace-spec.md`.
7. Read `docs/specs/dashboard-notification-spec.md`.
8. Read `docs/specs/line-ai-read-only-assistant-spec.md`.
9. Read `docs/specs/ai-gateway-agents-spec.md`.
10. Read source-module specs for every template you enable.
11. Read backend, web, and security guidelines.
12. Inspect `apps/api`, `apps/web`, `apps/workers`, `apps/ai-gateway`, `packages/contracts`, `packages/config`, and current Prisma state.
13. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 16 complete until Phase 0 through Phase 9 exit criteria pass and verification commands are recorded.

## Core Rule

Workflow Automation coordinates safe work. It never performs final money, stock, tax, accounting, approval, export, permission, or publishing mutations.

Unsafe workflow intents must become drafts, workflow tasks, approval-review requests, or source-module requests that require permission-checked web confirmation.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 15.
- If Prisma is missing, add it under `apps/api` following ADR 0006 and existing package conventions.
- If Prisma/auth/audit/outbox/notification/dashboard/LINE/AI primitives already exist, extend them with additive migrations and module code.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use server-derived `companyId`, `userId`, roles, permissions, branch/team scope, and source refs. Never trust client-sent permission or tenant fields.
- Workflow condition evaluation must be deterministic and side-effect free.
- No arbitrary JS, SQL, eval, shell, WASM, or user plugin execution.
- Rule enablement creates immutable rule versions.
- Historical runs keep rule-version snapshots.
- Event ingestion, run creation, action execution, task creation, webhook calls, dead-letter replay, and manual tests must be idempotent.
- Every run/action writes audit or audit-linked records.
- Webhooks are allowlisted, signed, rate-limited, disabled by default, and audited.
- Secrets are stored through existing secret/config mechanisms, never returned by API, and never kept in rule JSON.
- LINE/AI must call permission-checked APIs/tools only. They must not import API Prisma clients or workflow repositories.
- Each phase must leave touched packages typecheckable.
- Record verification commands and any skipped tests with concrete reasons.

## Scope

### In Scope

- Shared workflow contracts in `packages/contracts`.
- Workflow permission keys and default role-grant alignment.
- Prisma schema/migration/seed for workflow models if Prisma exists or is added.
- API workflow module using hexagonal folder structure.
- Template catalog, rule CRUD, rule enable/disable, version snapshots, condition test endpoint.
- Event inbox, event matching, schedule/threshold/SLA scan hooks, manual replay.
- Safe action runner for:
  - notifications through existing notification module,
  - workflow tasks,
  - approval-review tasks,
  - AI draft request envelope/disabled fallback,
  - report/export draft request envelope where source module supports it,
  - signed outbound webhook action disabled by default,
  - audit note action.
- Retry, dead-letter, replay, ignore, and resolution-note behavior.
- Web workflow console with templates, rules, editor/test, runs, tasks, dead letters, and webhooks.
- LINE/AI read-only explanations and assigned task summaries through existing boundaries.
- Tests for contracts, condition logic, action safety, use cases, APIs, permissions, idempotency, worker retry/dead-letter, LINE/AI read scope, and web UI where test setup supports them.

### Out of Scope

- Low-code marketplace, script runner, custom code, or SQL builder.
- Autonomous final money, stock, tax, accounting, approval, export, permission, or external publishing mutation.
- Replacing notification delivery, dashboard snapshots, source-module approvals, CRM follow-ups, reimbursement approvals, ledger posting, accounting document state machines, tax filing, stock movement, bank transfer, or marketplace import logic.
- Broad AI Draft and Suggestion Layer from item 17.
- AI Marketing and platform publishing from later roadmap items.
- Direct external tax portal, bank, marketplace, social, or payment rail mutation.
- Public workflow marketplace/API.
- Production infrastructure provisioning beyond code/config needed by app.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: `String @id @default(cuid())` unless repo already standardizes UUIDs before item 16 starts.
- Rule timezone: company timezone; fallback `Asia/Bangkok` only when company timezone is absent and existing config agrees.
- Rule default status: `DRAFT`.
- Template default status: `AVAILABLE` when all required source modules exist, otherwise `UNAVAILABLE`.
- Template default enabled: `false`.
- Every first-pass template requires admin enable/configure flow in web.
- WorkflowTask is workflow-owned for item 16; source-specific tasks/approvals remain in source modules.
- Shared cross-module task center is future scope after real workflow usage exists.
- Cooldown default: 3600 seconds for alert/task templates unless template says otherwise.
- Retry default: 3 attempts with exponential backoff and jitter unless worker primitives define standard policy.
- Dead-letter default: after max retry attempts for retryable action errors.
- Webhooks: disabled by default, HMAC-signed, allowlisted, timeout capped, no secret returned by API.
- AI draft action: disabled or creates a review task until item 17 provider exists.
- Report/export draft action: only enabled if source module already exposes safe draft/export-request API.
- Manual replay: admin-only and re-validates source state, permissions, idempotency, and action safety.
- LINE: alert/explain/task summary only; no final action.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect `apps/workers/package.json`, `apps/workers/src`, queue conventions, and worker bootstrap.
- [ ] Inspect `apps/web/package.json`, `apps/web/app`, `apps/web/src/common`, and `apps/web/src/features`.
- [ ] Inspect `apps/ai-gateway/src` for tool registration, policy, and ERP API client patterns.
- [ ] Inspect `packages/contracts/src` and export pattern.
- [ ] Inspect `packages/config/src` for feature flags and env patterns.
- [ ] Identify existing request context, auth guard, permission decorator, ABAC helpers, audit log, outbox, notification API, dashboard snapshots, LINE binding, deep-link helpers, and source-module event contracts.
- [ ] Identify source modules available for templates: inventory, accounting, tax, reimbursement, procurement/AP, bank reconciliation, CRM, dashboard/notification, AI.
- [ ] Identify existing task/approval concepts from reimbursement/CRM/source modules to avoid duplication.
- [ ] Identify current route naming, navigation, API client, form, table, tabs, drawer/modal, empty/error, toast, loading, and test primitives in web.
- [ ] Identify current test commands for root, API, workers, web, contracts, config, Prisma, and e2e if present.
- [ ] Record conflicts, missing primitives, and first files to edit before coding.

### Tests

- No production code required.
- Run lightweight existing checks only if needed to confirm baseline.

### Exit Criteria

- Implementation summary states which existing primitives will be reused.
- No duplicate shared module is planned.
- Exact first source paths for contracts, API module, worker integration, web feature, AI hooks, and tests are known.
- Phase 1 can start without product ownership questions.

## Phase 1: Contracts, Permissions, and Domain Logic

### Goal

Define workflow contracts, permission keys, enums, condition evaluator, action safety validator, and domain invariants.

### Tasks

- [ ] Add shared workflow enums/contracts in `packages/contracts` following current package style.
- [ ] Add permission keys from spec section 12 and align role grants using existing permission seed/config primitives.
- [ ] Define contracts for templates, rules, rule versions, event envelope, condition tree, actions, runs, action runs, tasks, dead letters, and webhook endpoints.
- [ ] Implement condition schema validation for `ALL`, `ANY`, `NOT`, and allowed operators only.
- [ ] Implement deterministic condition evaluator with type-safe handling for strings, numbers, booleans, dates, arrays, missing fields, and timezone-aware windows.
- [ ] Implement action schema validation and unsafe action rejection.
- [ ] Implement dedup/idempotency key builders for workflow runs and action runs.
- [ ] Implement cooldown policy logic.
- [ ] Implement rule-version snapshot builder.
- [ ] Implement human-readable explanation builder from trigger, condition result, action results, and source refs.

### Tests

- Contract/type tests where current setup supports them.
- Unit tests for condition validation/evaluation.
- Unit tests for unsafe action rejection.
- Unit tests for idempotency key builders.
- Unit tests for cooldown and rule-version snapshot behavior.

### Exit Criteria

- Contracts export cleanly.
- Permission keys are available to API/web/AI code.
- Invalid condition/action JSON fails before persistence.
- Arbitrary code execution is impossible by design.
- Domain tests pass.

## Phase 2: Persistence, Migrations, and Template Seeds

### Goal

Persist workflow rules, versions, event inbox rows, runs, action runs, tasks, dead letters, webhook endpoints, and template catalog.

### Tasks

- [ ] Add Prisma models or equivalent persistence using spec section 11.
- [ ] Add uniqueness constraints for run/action idempotency.
- [ ] Add indexes for company/status/date/rule/source/action/dead-letter/task filters.
- [ ] Add migrations using existing migration convention.
- [ ] Add template seed data with required source modules and unavailable reasons.
- [ ] Add repository interfaces and infrastructure implementations.
- [ ] Add data mappers between domain models and persistence.
- [ ] Ensure webhook secrets use secret references, not plaintext JSON.
- [ ] Add seed/update path that is additive and safe across environments.

### Tests

- Migration/schema validation command.
- Repository tests where DB test setup exists.
- Seed tests or snapshot tests for template catalog.
- Uniqueness/idempotency tests for workflow run/action run records.

### Exit Criteria

- Database schema supports all first-pass workflow data.
- Template catalog can mark missing-source templates unavailable.
- Duplicate event/run/action attempts do not create duplicate rows.
- No secret is persisted in returned API payloads.

## Phase 3: API Module and Admin Rule Management

### Goal

Expose permission-checked workflow APIs for templates, rules, tests, runs, tasks, dead letters, and webhooks.

### Tasks

- [ ] Create API workflow module using repo's hexagonal folder layout.
- [ ] Add controllers/routes following existing company-scoped conventions.
- [ ] Implement template list and enable-from-template use cases.
- [ ] Implement rule create/read/update/enable/disable/test use cases.
- [ ] Implement run/action/dead-letter/task read use cases with filters.
- [ ] Implement workflow task snooze/complete/cancel use cases.
- [ ] Implement dead-letter replay/ignore use cases with resolution note.
- [ ] Implement webhook endpoint manage use cases if webhook action is included in first pass.
- [ ] Enforce workflow permissions and source-module permission checks server-side.
- [ ] Emit audit/outbox records through existing primitives.
- [ ] Add OpenAPI/contract exports if current project does that.

### Tests

- API tests for rule CRUD, enable/disable, template enable, test endpoint, run list/detail, task update, dead-letter replay/ignore.
- Permission tests for Owner/Admin/Manager/Staff/Auditor and denied roles.
- Validation tests for invalid conditions/actions/recipients/webhooks.
- Audit/outbox assertion tests where primitives exist.

### Exit Criteria

- Admin can manage draft/disabled/enabled rules through API.
- Non-admin cannot manage workflow config.
- Rule test endpoint performs no side effects.
- Read APIs enforce workflow permission plus source-module ABAC.
- Audit/outbox integration exists or explicit blocker is recorded.

## Phase 4: Event Ingestion, Scheduler, and Runner

### Goal

Match source events/schedules/scans to workflow rules and create idempotent workflow runs.

### Tasks

- [ ] Add workflow event inbox ingestion from existing outbox/worker mechanism.
- [ ] Add event-to-rule matcher for `EVENT` triggers.
- [ ] Add schedule trigger registration using existing worker/queue scheduler conventions.
- [ ] Add threshold/SLA scan jobs that call source-module read APIs, not raw cross-module DB reads unless repo already uses shared read models.
- [ ] Add workflow run creation use case with condition evaluation and cooldown enforcement.
- [ ] Queue action runs from successful condition matches.
- [ ] Record skipped runs with reason when condition fails, source missing, module unavailable, or schema mismatch.
- [ ] Add structured logs and metrics hooks if current observability primitives exist.

### Tests

- Worker/use-case tests for event ingestion idempotency.
- Rule matching tests for multiple rules and missing schema.
- Schedule timezone tests.
- Cooldown tests preventing noisy duplicate runs.
- Scan pagination tests if scan adapters are implemented.

### Exit Criteria

- Duplicate event ingestion is safe.
- Matching rules create at most one run per rule version and dedup key.
- Condition-failed and unavailable-source cases are inspectable.
- Scheduled/scanned triggers respect company timezone and source permissions.

## Phase 5: Safe Action Execution, Retry, and Dead Letters

### Goal

Execute allowed actions safely with retry, action-level idempotency, and dead-letter handling.

### Tasks

- [ ] Implement action runner port and action adapter registry.
- [ ] Implement `SEND_NOTIFICATION` adapter through existing notification module.
- [ ] Implement `CREATE_WORKFLOW_TASK` adapter.
- [ ] Implement `CREATE_APPROVAL_REVIEW_REQUEST` as workflow task/review request unless source module exposes a safe approval-request API.
- [ ] Implement `REQUEST_AI_DRAFT` as disabled/unavailable fallback unless item 17 provider already exists; if provider exists, create draft only.
- [ ] Implement `CREATE_REPORT_EXPORT_DRAFT` only through source-module draft/export-request API where present.
- [ ] Implement `ADD_AUDIT_NOTE` through existing audit primitive.
- [ ] Implement `CALL_WEBHOOK` disabled by default with HMAC signature, allowlist, timeout, retry, redacted logs, and no returned secret.
- [ ] Implement retry policy with retryable/final error classification.
- [ ] Implement dead-letter creation after max attempts.
- [ ] Implement replay path that creates new action attempt while preserving original history.
- [ ] Ensure every adapter re-checks source state and permission where applicable.

### Tests

- Unit tests for adapter registry and safety checks.
- Integration tests for notification/task/audit note actions.
- Webhook signing, timeout, retry, redaction, and dead-letter tests.
- Retry policy tests for retryable versus final errors.
- Dead-letter replay tests with idempotency.
- Source-state revalidation tests for replay.

### Exit Criteria

- Safe actions execute through existing boundaries.
- Unsafe final actions are impossible.
- Retry/dead-letter lifecycle is visible and deterministic.
- Replay does not duplicate successful side effects.

## Phase 6: Web Workflow Console

### Goal

Build web admin/operator surfaces for workflow templates, rules, runs, tasks, dead letters, and webhooks.

### Tasks

- [ ] Add web feature folder following existing structure.
- [ ] Register workflow routes/navigation according to web shell conventions.
- [ ] Build templates tab with availability, required modules, enable/configure flow, and disabled reasons.
- [ ] Build rules tab with filters, status, trigger, source module, last run, owner, enable/disable actions.
- [ ] Build rule editor with structured trigger/condition/action forms, recipient settings, cooldown, validation errors, and test sample panel.
- [ ] Build runs tab/detail with rule version, trigger, condition result, action results, audit refs, and source deep links.
- [ ] Build workflow tasks tab with own/team/admin filters, snooze, complete, cancel, priority, due date, and source link.
- [ ] Build dead-letter tab/detail with error, replay eligibility, replay/ignore actions, and resolution note.
- [ ] Build webhook settings tab if webhook action is implemented.
- [ ] Add permission-aware empty/forbidden/loading/error states.
- [ ] Ensure text fits across mobile/desktop and no controls overlap.

### Tests

- Component tests where current setup supports them.
- API client tests or mocks for workflow pages.
- Permission/forbidden state tests.
- Rule test UI side-effect-free test.
- Basic responsive smoke checks where Playwright exists.

### Exit Criteria

- Admin can manage workflow config in web.
- Non-admin users see only allowed task/run surfaces.
- Rule testing and dead-letter replay UX clearly show no/final-action boundaries.
- Web UI follows existing design system and frontend guideline.

## Phase 7: LINE and AI Read-Only Explanations

### Goal

Expose workflow explanations and assigned task summaries to LINE/AI without allowing final actions.

### Tasks

- [ ] Add workflow read tools/API endpoints for AI Gateway using existing tool registry pattern.
- [ ] Add `workflow.explain_run`, `workflow.list_assigned_tasks`, `workflow.list_recent_failures`, and `workflow.summarize_rule_health` if current AI Gateway supports tool registration.
- [ ] Ensure AI tools call API with server-derived user/company context and source permissions.
- [ ] Add LINE alert explanation handoff through existing notification/LINE deep-link patterns.
- [ ] Add low-risk task snooze only if current LINE action pattern supports permission-checked API calls; otherwise link to web.
- [ ] Add refusal behavior for forbidden, unsupported, final-action, and mutation requests.
- [ ] Add Thai-first concise response shape if current LINE AI assistant uses Thai defaults.

### Tests

- AI tool permission tests.
- Forbidden source/run explanation tests.
- LINE deep-link/refusal tests where harness exists.
- Mutation request refusal tests.
- Source ref/citation shape tests.

### Exit Criteria

- LINE/AI can explain workflow history and tasks within permission scope.
- LINE/AI cannot enable/replay/execute final actions.
- Responses include source refs or web deep links where useful.

## Phase 8: Cross-Module Templates and Integration Hardening

### Goal

Wire first-pass templates to available source modules without creating duplicate domain logic.

### Tasks

- [ ] Enable Daily owner summary only if dashboard summary source exists.
- [ ] Enable Low stock and Stockout risk only if inventory source/events exist.
- [ ] Enable Overdue invoice only if accounting invoice source/events exist.
- [ ] Enable Tax due soon only if tax period source/events exist.
- [ ] Enable Reimbursement pending and Approval SLA breach only if source approval states exist.
- [ ] Enable Vendor bill pending only if procurement/AP source exists.
- [ ] Enable Bank reconciliation aging only if bank reconciliation source exists.
- [ ] Enable CRM follow-up due, Opportunity stuck, and Sales below target only if CRM/dashboard source exists.
- [ ] Keep AI draft requested disabled until item 17 provider exists unless current AI Gateway already exposes safe draft port.
- [ ] Keep outbound webhook disabled by default even when implemented.
- [ ] Add integration tests for every template marked `AVAILABLE`.
- [ ] Add unavailable-reason tests for missing source modules.
- [ ] Review source-module specs to confirm each template stays within ownership boundary.

### Tests

- Template availability tests.
- Integration tests per available template.
- Permission tests combining workflow permission and source-module permission.
- Cooldown/idempotency tests per noisy event type.
- Source unavailable tests.

### Exit Criteria

- Every available template has passing integration coverage.
- Every unavailable template has clear reason in API/web.
- No template performs final unsafe mutation.
- Source-module ownership remains intact.

## Phase 9: Verification, Documentation, and Checklist Gate

### Goal

Verify implementation, update docs, and only then close Master Implementation Checklist item 16.

### Tasks

- [ ] Run root/package typecheck, lint, tests, and build commands that exist.
- [ ] Run API tests and migration validation.
- [ ] Run worker tests for ingestion/retry/dead-letter.
- [ ] Run web tests/build.
- [ ] Run AI Gateway tests if tools were added.
- [ ] Run Playwright/smoke tests if current repo has e2e harness.
- [ ] Record verification commands and results in implementation notes or PR description.
- [ ] Update specs/plans only for real implementation deviations.
- [ ] Update master checklist item 16 checkbox only after all phase exit criteria pass.
- [ ] Note any deferred templates/actions with reasons and owner follow-up.

### Tests

- All relevant automated checks available in repo.
- Manual smoke for web workflow console if no e2e harness exists.
- Manual smoke for a sample event -> run -> action -> task/dead-letter path.

### Exit Criteria

- Phase 0 through Phase 8 exit criteria are complete.
- Verification commands pass or skipped commands have concrete repo-state reasons.
- No known unsafe final mutation path exists.
- Master checklist can be updated truthfully.

## Review Checklist

- [ ] Workflow rules are company-scoped and permission-checked.
- [ ] Rule conditions use constrained JSON only.
- [ ] Rule enablement creates immutable versions.
- [ ] Run/action idempotency constraints exist and are tested.
- [ ] Unsafe actions are blocked or converted to draft/task/approval-review requests.
- [ ] Source modules retain ownership of final state changes.
- [ ] Notification action reuses notification module.
- [ ] LINE/AI are read-only explanation surfaces.
- [ ] Webhook action is signed, allowlisted, redacted, disabled by default, and audited.
- [ ] Retry/dead-letter/replay paths are tested.
- [ ] Audit/source refs exist for runs and actions.
- [ ] Web UI has templates, rules, runs, tasks, dead letters, and permission states.
- [ ] Master Implementation Checklist item 16 remains unchecked until verification passes.

## Suggested Implementation Prompt

Use this when handing item 16 to Sonnet 4.6:

```text
Implement Master Implementation Checklist item 16: Workflow Automation.

Read first:
- docs/plans/workflow-automation-plan.md
- docs/specs/workflow-automation-spec.md
- docs/specs/permission-matrix.md
- docs/specs/data-model-core-spec.md
- docs/specs/auth-authorization-rbac-spec.md
- docs/specs/web-core-workspace-spec.md
- docs/specs/dashboard-notification-spec.md
- docs/specs/line-ai-read-only-assistant-spec.md
- docs/specs/ai-gateway-agents-spec.md
- relevant source-module specs for every template you enable
- docs/guidelines/backend-hexagonal-code-style.md
- docs/guidelines/web-frontend-code-style.md
- docs/guidelines/security-implementation-guideline.md

Start with Phase 0 and Phase 1 only unless owner expands scope.
Reuse existing primitives. Do not duplicate tenant/auth/audit/outbox/notification/dashboard/LINE/AI/source modules.
Workflow must never perform final money, stock, tax, accounting, permission, export, approval, or publishing mutation.
Keep Master Implementation Checklist item 16 unchecked until all phases and verification pass.
```

## Risks

- Source modules may expose inconsistent event contracts. Mitigation: add adapters and unavailable reasons instead of guessing.
- Workflow tasks may overlap with CRM/reimbursement tasks. Mitigation: keep workflow tasks generic and source-linked; source-specific completion stays in source module.
- Dead-letter replay can duplicate side effects if action idempotency is weak. Mitigation: unique action idempotency keys and adapter-level dedup tests.
- Webhook action can leak data or secrets. Mitigation: disabled by default, allowlist, HMAC, redaction, permission checks, and audit.
- AI draft action can accidentally implement item 17. Mitigation: keep disabled/fallback unless safe provider already exists.

## Open Questions

- Which channel beyond web/LINE should receive workflow notifications first if email/SMS exists?
- Which source module owns sales target data before Reports/BI item 18?

## Resolved Decisions

- 2026-06-23: First-pass templates stay disabled by default. Admin enables and configures each template from web.
- 2026-06-23: WorkflowTask stays workflow-owned for item 16. Shared task center is future scope, not part of first implementation.
