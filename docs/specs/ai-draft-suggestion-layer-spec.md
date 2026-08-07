# AI Draft and Suggestion Layer Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 17.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/ai-draft-suggestion-layer-plan|AI Draft and Suggestion Layer Plan]]

## 2. Goal

Implement a safe AI Draft and Suggestion Layer for WatchDog-BMS after Workflow Automation item 16 exists.

Users can request or receive AI-generated suggestions and draft artifacts for CFO, Sales/CRM, Inventory, and Tax workflows. Every suggestion must be permission-aware, source-cited, auditable, and reviewable in web before it can create or update any source-module draft record.

The layer uses:

- AI Gateway as the orchestration and model/tool policy boundary.
- ERP Core APIs as the only source-data and draft-creation path.
- Source module validators for source-owned drafts.
- Web as the required review and confirmation surface.
- LINE as a request, summary, alert, and deep-link channel only.

The first implementation makes AI useful without allowing autonomous final money, stock, tax, accounting, approval, export, permission, or external publishing mutations.

## 3. Non-Goals

- Direct final mutation by AI from LINE, web chat, worker, or background job.
- Replacing source-module business rules, validators, approvals, audit, state machines, posting, filing, payment, stock movement, CRM ownership, or document issue/void workflows.
- Letting AI Gateway read the database directly or import ERP Prisma/source repositories.
- Letting model output become a persisted business record without deterministic validation.
- Letting AI update permissions, approval policy, workflow rules, tax config, chart of accounts, bank account settings, or external integrations.
- Full autonomous CFO agent, closed-loop operations, or multi-step self-planning agents.
- Report/BI builder from item 18.
- Marketplace import from item 19.
- AI Marketing external publishing from item 23.
- Public plugin, marketplace, or third-party agent API.
- Admin prompt-body editing in first pass.
- Model training, fine-tuning, vector search platform, or long-term memory beyond scoped conversation/draft records.

## 4. User Roles

- Owner: reviews CFO suggestions, risk summaries, draft finance actions, and cross-module business recommendations.
- Admin: configures AI suggestion templates, policies, provider status, retention settings, and safety controls.
- Manager: reviews team-scoped Sales/CRM, workflow, reimbursement, and operational suggestions where ABAC allows.
- Sales: requests CRM next actions, follow-up drafts, lead/opportunity summaries, and quotation draft proposals for assigned records.
- Inventory: requests reorder, transfer, stockout-risk, dead-stock, and stock anomaly suggestions within allowed location scope.
- Finance: reviews cash, receivable, payable, bank reconciliation, expense, reimbursement, invoice, and draft finance suggestions.
- Accountant: reviews ledger, tax, closing, evidence, and compliance suggestions.
- Marketing: can read customer/product/channel context only where existing permissions allow; external campaign generation remains item 23.
- Staff: can request AI help for own tasks, reimbursements, receipts, and assigned work only.
- Auditor readonly: reads AI suggestions, citations, review history, and tool invocation logs without mutation.
- AI assistant user: asks for suggestions or draft preparation through LINE or web; permissions inherit from that exact user.

## 5. Boundary and Ownership

AI Gateway owns:

- Model/provider ports.
- Prompt and policy execution.
- Tool allowlist and tool-call audit envelope.
- Agent routing.
- Source citation assembly.
- Draft artifact generation.
- Refusal and uncertainty behavior.

AI Draft and Suggestion Layer owns:

- Suggestion templates, template versions, request records, suggestion inbox, draft artifacts, candidate actions, review decisions, source citations, generation jobs, generation errors, and suggestion lifecycle.
- Web review queue and detail experience.
- LINE request/summary/deep-link behavior for suggestions.
- Integration contracts that let Workflow Automation request an AI draft safely.

ERP source modules own:

- Source records and final source-of-truth data.
- Source read APIs and source refs.
- Source draft creation/update APIs.
- Deterministic validation and permission checks for source draft records.
- Final issue, post, approve, pay, file, close, export, publish, void, transfer, or reconcile actions.

Workflow Automation owns:

- Workflow triggers, runs, tasks, dead letters, and safe action requests.
- A workflow may request an AI draft through item 17 APIs, but it cannot apply the draft or finalize business changes.

Dashboard/Notification owns:

- Notification center rows, LINE push delivery, preferences, digesting, quiet hours, and alert read state.
- Item 17 may create notification requests through the existing notification boundary only.

Web owns:

- Full review, edit, acceptance, source draft creation, and source-module deep links.
- Re-checking permission and source state before any action button runs.

LINE owns:

- Conversational request and summary entry points.
- Deep links to web review.
- No source draft creation, final acceptance, final rejection, or source mutation from LINE in item 17.

## 6. Current Repository Baseline

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with feature-folder conventions evolving through earlier items.
- `packages/contracts`: shared contract package exists but may still be thin.
- `packages/config`: shared config package exists but may still be thin.

Before implementation, inspect latest code again because items 01 through 16 may add Prisma, auth, request context, company/branch/team primitives, permissions, audit, outbox, notifications, dashboard snapshots, LINE binding, AI Gateway tool registry, worker queue helpers, workflow action adapters, web shell routes, API client helpers, and source-module draft APIs.

Extend existing primitives. Do not duplicate tenant, auth, audit, outbox, notification, dashboard, LINE, AI Gateway, workflow, web shell, worker queue, source-module API, config, or contract code.

## 7. References

- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 17.
- Implementation plan: [[plans/ai-draft-suggestion-layer-plan|AI Draft and Suggestion Layer Plan]]
- AI Gateway: [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- LINE read-only assistant: [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- LINE channel/auth: [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
- Workflow Automation: [[specs/workflow-automation-spec|Workflow Automation Spec]]
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Web shell: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Dashboard/notification: [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
- Inventory: [[specs/inventory-mvp-spec|Inventory MVP Spec]]
- Accounting documents: [[specs/accounting-documents-spec|Accounting Documents Spec]]
- Expense upload: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Ledger/closing: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
- Thai tax: [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
- Bank reconciliation: [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]]
- Procurement/AP: [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
- Reimbursement: [[specs/reimbursement-approval-spec|Reimbursement and Approval Spec]]
- CRM/Sales: [[specs/crm-sales-spec|CRM and Sales Spec]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Web guideline: [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]
- LINE access ADR: [[adr/0008-line-ai-access-and-auth|ADR 0008 LINE AI Access and Authentication]]

## 8. Product Decisions

- AI suggestions are advisory until reviewed in web.
- AI-generated source drafts require web review and source-module permission checks before creation.
- LINE can create an AI draft request and show summaries/deep links, but cannot create source-module draft records or finalize review decisions.
- Every suggestion must include source citations or explicitly state why evidence is missing.
- Suggestions without enough source evidence must be blocked, downgraded to "needs data", or shown as a question/checklist instead of a recommendation.
- Tool calls inherit the requesting user's permissions and ABAC scope.
- Backend must derive `companyId`, `userId`, roles, permissions, branch/team/location scope, and source refs server-side.
- AI Gateway policy checks are guardrails only. ERP Core must enforce permissions again on every tool call and draft action.
- Source modules validate draft payloads. AI output never bypasses source-module validation.
- Prompt templates are versioned. A suggestion stores the template version and model/provider metadata used to create it.
- Full prompt and full user message retention is configurable. Default storage is preview plus hash for sensitive text, with structured source refs and bounded excerpts.
- First pass supports deterministic test provider and disabled provider fallback so CI does not require network/model credentials.
- Preferred production LLM provider is Amazon Bedrock through the AI Gateway provider port.
- Do not hard-code a production model id in item 17 domain logic. Use env/config, and verify the current Bedrock model id and account access before production wiring.
- Runtime LLM provider should reuse any existing AI Gateway provider primitive. If none exists, add a provider port with Bedrock, fake/test, and disabled implementations.
- Suggestions are AI-authored (owner directive 2026-07-01: "AI 100%, not deterministic"). The API gathers grounded source evidence and the model authors the suggestion content. When LLM generation is disabled or no provider is configured, requests show provider-unavailable state; the system never ships deterministic/canned suggestion content.
- Thai is the default answer language for LINE. Web should support Thai UI copy where existing project conventions do so.
- High-risk suggestions default to `REQUIRES_REVIEW`.
- High-risk CFO ready notifications go to Owner by default only for cash risk, tax/closing readiness blockers, and overdue AR/AP critical suggestions. Other high-risk CFO suggestions stay in the web queue unless configured later.
- Expired, superseded, forbidden, and source-state-changed suggestions cannot be applied.
- Admin-configured auto-generation schedules are optional in item 17. Manual request and workflow-triggered request are the first priority.
- Admin prompt-template body editing is excluded from first pass. Admin may view provider/template status and enable/disable/configure safe template settings only.

## 9. Suggestion Lifecycle

Canonical flow:

```text
Request -> Source Snapshot -> Tool Calls -> Draft Artifact -> Suggestion -> Web Review -> Source Draft Request -> Source Module Validation -> Source Draft Created
```

Request statuses:

```text
QUEUED
GENERATING
READY
NEEDS_DATA
PROVIDER_UNAVAILABLE
FAILED
CANCELED
EXPIRED
```

Suggestion statuses:

```text
NEW
IN_REVIEW
ACCEPTED_FOR_SOURCE_DRAFT
SOURCE_DRAFT_CREATED
DISMISSED
SUPERSEDED
EXPIRED
BLOCKED_BY_PERMISSION
BLOCKED_BY_SOURCE_STATE
FAILED
```

Draft artifact statuses:

```text
DRAFT
REGENERATED
LOCKED_FOR_REVIEW
ACCEPTED
REJECTED
SUPERSEDED
EXPIRED
```

Review decisions:

```text
ACCEPT_AS_SOURCE_DRAFT
REQUEST_REGENERATION
EDIT_AND_ACCEPT
DISMISS
MARK_NEEDS_DATA
MARK_NOT_USEFUL
ESCALATE_TO_OWNER
```

Lifecycle rules:

- Creating an AI suggestion is allowed through LINE, web, workflow, or scheduled job if permission allows.
- Creating a source-module draft from a suggestion is web-only in item 17.
- Source draft creation must re-check permissions, source state, source validator, idempotency key, and suggestion freshness.
- If source data changes materially after generation, the suggestion must require regeneration or explicit web acknowledgement before source draft creation.
- A suggestion can create at most one source-module draft per candidate action idempotency key.
- Dismissal, regeneration, acceptance, source draft creation, and failed application are audited.
- Regeneration creates a new artifact version and preserves prior versions.
- Expired suggestions remain readable with citations and review history.

## 10. Suggestion Types

### AI CFO

First-pass suggestions:

- Cash risk summary from bank cash position, AR/AP aging, overdue invoices, upcoming reimbursement/AP/tax obligations, and bank reconciliation status.
- Overdue receivable action suggestion with customer/invoice citations and source draft task proposal.
- Expense anomaly or missing evidence suggestion from expense, reimbursement, AP, and ledger source data.
- Ledger/tax readiness checklist before period close.
- Profit or margin concern explanation when ledger and source documents exist.

Out of first-pass CFO scope:

- Autonomous payment, bank transfer, tax filing, journal posting, or period close.
- Legal, tax, or accounting certification.

### AI Sales and CRM

First-pass suggestions:

- Next-best follow-up draft from CRM activity, opportunity stage, stale follow-up, quote status, and customer history.
- Opportunity risk suggestion for stale or high-value deals.
- Customer duplicate or missing contact evidence suggestion.
- Quotation draft proposal, routed through Accounting Documents quotation draft validation.
- Manager team pipeline focus list.

Out of first-pass Sales/CRM scope:

- Auto-sending messages.
- Lead import from external channels.
- Opportunity stage movement without web review.
- Customer merge without source-module merge workflow.

### AI Inventory

First-pass suggestions:

- Reorder review suggestion from stock balance, low-stock threshold, sales velocity where available, open purchase data where available, and recent stock movements.
- Stockout-risk or dead-stock summary.
- Stock anomaly review task for unusual adjustment, negative stock policy conflict, or movement inconsistency.
- Transfer/count request draft suggestion where inventory source module exposes a draft/request API.

Out of first-pass Inventory scope:

- Final receive, issue, count approval, transfer completion, or stock adjustment.
- Supplier purchase order finalization.

### AI Tax and Accounting

First-pass suggestions:

- Missing VAT/WHT evidence checklist.
- Tax period preparation suggestion from ledger, invoices, receipts, AP/vendor bills, expenses, and certificates.
- Withholding certificate issue draft proposal where source module supports draft certificate creation.
- Filing/paid reminder explanation with source citations.
- Closing readiness checklist.

Out of first-pass Tax scope:

- Filing with external tax portal.
- Marking tax filed/paid from AI.
- Creating final journal, posting, reversing, closing, or unclosing.
- Overriding verified Thai tax rules.

### Workflow and Cross-Module

First-pass suggestions:

- Workflow-triggered draft request from item 16 safe action adapter.
- Suggestion to create a workflow task or review checklist when the source module lacks a safe draft API.
- Explanation of why a workflow requested an AI draft.

Out of first-pass Workflow scope:

- Enabling workflow rules or changing conditions by AI.
- Retrying dead letters from AI chat.

## 11. Data Model Draft

Use Prisma or current persistence convention. Names below are conceptual and can be adapted to existing naming conventions.

### AISuggestionTemplate

- `id`
- `companyId` nullable for global templates
- `key`
- `domain`: `CFO`, `SALES_CRM`, `INVENTORY`, `TAX_ACCOUNTING`, `WORKFLOW`
- `title`
- `description`
- `defaultAgent`
- `triggerModes`: manual, workflow, schedule, threshold
- `requiredSourceModules`
- `requiredPermissions`
- `riskLevel`: `LOW`, `MEDIUM`, `HIGH`
- `defaultTtlMinutes`
- `enabled`
- `createdAt`
- `updatedAt`

### AISuggestionTemplateVersion

- `id`
- `templateId`
- `version`
- `promptPolicyKey`
- `systemPromptPreview`
- `systemPromptHash`
- `outputSchema`
- `sourceRequirements`
- `candidateActionSchema`
- `createdByUserId`
- `createdAt`
- `activatedAt`
- `retiredAt`

### AIDraftRequest

- `id`
- `companyId`
- `requesterUserId`
- `origin`: `WEB`, `LINE`, `WORKFLOW`, `SCHEDULE`, `SYSTEM`
- `agent`: `CFO`, `SALES`, `CRM`, `INVENTORY`, `TAX`, `ACCOUNTING`, `WORKFLOW`
- `templateId`
- `templateVersionId`
- `sourceModule`
- `sourceRecordType`
- `sourceRecordId`
- `sourceRefsJson`
- `requestedPromptPreview`
- `requestedPromptHash`
- `language`
- `status`
- `priority`
- `idempotencyKey`
- `workflowRunId` nullable
- `expiresAt`
- `createdAt`
- `updatedAt`

### AISuggestion

- `id`
- `companyId`
- `draftRequestId`
- `templateId`
- `templateVersionId`
- `agent`
- `domain`
- `title`
- `summary`
- `recommendation`
- `riskLevel`
- `confidence`: numeric 0 to 1 or enum if repo avoids floats
- `status`
- `needsDataReasonsJson`
- `blockedReasonsJson`
- `sourceStateHash`
- `candidateActionCount`
- `reviewOwnerUserId` nullable
- `assignedRole` nullable
- `expiresAt`
- `createdAt`
- `updatedAt`

### AISuggestionCitation

- `id`
- `suggestionId`
- `companyId`
- `sourceModule`
- `sourceRecordType`
- `sourceRecordId`
- `sourceField`
- `label`
- `valuePreview`
- `valueHash`
- `webDeepLink`
- `capturedAt`

### AIDraftArtifact

- `id`
- `suggestionId`
- `companyId`
- `version`
- `artifactType`: `TEXT`, `JSON_PAYLOAD`, `CHECKLIST`, `SOURCE_DRAFT_PAYLOAD`
- `language`
- `contentPreview`
- `contentHash`
- `structuredContentJson`
- `status`
- `modelProvider`
- `modelName`
- `modelVersion`
- `tokenUsageJson`
- `createdAt`

### AICandidateAction

- `id`
- `suggestionId`
- `artifactId`
- `companyId`
- `actionType`
- `targetModule`
- `targetRecordType`
- `targetRecordId` nullable
- `draftPayloadJson`
- `payloadHash`
- `requiredPermissions`
- `riskLevel`
- `idempotencyKey`
- `status`
- `validationResultJson`
- `createdAt`
- `updatedAt`

Allowed first-pass `actionType` values:

```text
CREATE_CRM_FOLLOW_UP_DRAFT
CREATE_ACCOUNTING_QUOTATION_DRAFT
CREATE_INVENTORY_REORDER_REVIEW
CREATE_INVENTORY_TRANSFER_OR_COUNT_REQUEST
CREATE_TAX_EVIDENCE_CHECKLIST
CREATE_TAX_CERTIFICATE_DRAFT
CREATE_WORKFLOW_TASK
CREATE_REVIEW_CHECKLIST
NO_SOURCE_DRAFT_AVAILABLE
```

### AISuggestionReview

- `id`
- `suggestionId`
- `candidateActionId` nullable
- `companyId`
- `reviewerUserId`
- `decision`
- `note`
- `editedPayloadJson`
- `createdSourceModule`
- `createdSourceRecordType`
- `createdSourceRecordId`
- `sourceDraftDeepLink`
- `createdAt`

### AIToolInvocationLog

Use existing AI tool log if present. Extend only as needed.

- `id`
- `companyId`
- `userId`
- `requestId`
- `suggestionId` nullable
- `agent`
- `toolName`
- `toolCategory`
- `permissionSnapshotJson`
- `inputPreview`
- `inputHash`
- `outputPreview`
- `outputHash`
- `sourceRefsJson`
- `status`
- `durationMs`
- `errorCode`
- `createdAt`

## 12. Permission Keys

Add or align these keys in [[specs/permission-matrix|Permission Matrix]]:

```text
ai.suggestion.read
ai.suggestion.read_own
ai.suggestion.request
ai.suggestion.generate
ai.suggestion.review
ai.suggestion.dismiss
ai.suggestion.admin
ai.draft.read
ai.draft.request
ai.draft.review
ai.draft.create_source_draft
ai.template.read
ai.template.manage
ai.tool_invocation.read
```

Default grants:

```text
OWNER: all AI draft/suggestion permissions
ADMIN: all AI draft/suggestion permissions except source-module draft creation still requires source permissions
MANAGER: ai.suggestion.read, ai.suggestion.request, ai.suggestion.review, ai.suggestion.dismiss, ai.draft.read, ai.draft.request, ai.draft.review within team/assigned ABAC
SALES: ai.suggestion.read_own, ai.suggestion.request, ai.suggestion.dismiss own, ai.draft.read, ai.draft.request, ai.draft.review for own/assigned Sales/CRM records
INVENTORY: ai.suggestion.read_own, ai.suggestion.request, ai.suggestion.dismiss own, ai.draft.read, ai.draft.request, ai.draft.review for allowed inventory locations
FINANCE: ai.suggestion.read, ai.suggestion.request, ai.suggestion.review, ai.suggestion.dismiss, ai.draft.read, ai.draft.request, ai.draft.review for finance/tax/accounting scope
ACCOUNTANT: ai.suggestion.read, ai.suggestion.request, ai.suggestion.review, ai.suggestion.dismiss, ai.draft.read, ai.draft.request, ai.draft.review for accounting/tax scope, ai.tool_invocation.read for accounting/tax audit scope
MARKETING: ai.suggestion.read_own, ai.suggestion.request, ai.draft.read, ai.draft.request only for marketing-safe source data; external campaign generation remains item 23
STAFF: ai.suggestion.read_own, ai.suggestion.request, ai.draft.read, ai.draft.request for own tasks/requests only
AUDITOR_READONLY: ai.suggestion.read, ai.draft.read, ai.template.read, ai.tool_invocation.read
```

Extra rules:

- `ai.draft.create_source_draft` is never sufficient by itself. The user must also hold the source-module draft/create permission and pass ABAC.
- `ai.template.manage` is admin/owner only.
- `ai.tool_invocation.read` may return redacted payloads unless owner/admin/auditor policy allows full audit detail.
- Service actors may hold `ai.suggestion.generate` but cannot bypass user permission context.

Sensitive actions:

```text
ai.template.manage
ai.suggestion.generate for sensitive finance/tax/customer/stock context
ai.suggestion.review
ai.draft.create_source_draft
ai.tool_invocation.read
```

## 13. AI Tool Policy

Tool categories:

```text
read_summary
read_detail
read_evidence_pack
draft_generate
draft_validate
source_draft_create
review_decision
notification_request
final_mutation
```

Rules:

- `read_summary`, `read_detail`, and `read_evidence_pack` require source-module read permission and ABAC.
- `draft_generate` creates AI draft artifacts only.
- `draft_validate` calls deterministic source-module validation without writing final records.
- `source_draft_create` is web-only and creates source-module draft/request records only.
- `review_decision` is web-only for accept, edit-and-accept, dismiss, and escalate.
- `notification_request` must use Dashboard/Notification APIs.
- `final_mutation` is blocked for AI Gateway by default.
- Tool calls must be allowlisted per agent/template/action type.
- Tool call inputs must be structured and schema-validated.
- Model output must be parsed against a schema before persistence.
- Any unparseable, unsupported, low-confidence, or uncited output becomes failed/needs-data state.
- AI cannot call tools for records outside user scope even if source ids appear in prompt text.
- AI cannot create source drafts from LINE.

## 14. API Behavior

Use existing route/version conventions. Names below are conceptual.

### Create Draft Request

- Endpoint: `POST /ai/draft-requests`
- Surface: web, LINE, workflow, schedule.
- Permission: `ai.suggestion.request` plus source read permission.
- Validation:
  - Server derives company/user/context.
  - Template exists and is enabled.
  - Source refs are valid and accessible.
  - Origin is allowed for template.
  - Idempotency key is present for workflow/schedule origin.
- Success:
  - Creates `AIDraftRequest` in `QUEUED`.
  - Enqueues generation job.
- Errors:
  - forbidden, template disabled, source not found, source forbidden, duplicate idempotency key, provider unavailable.

### Generate Draft Request

- Endpoint: `POST /ai/draft-requests/:id/generate`
- Surface: worker/system or admin retry.
- Permission: service actor with `ai.suggestion.generate`; user permission snapshot still applies.
- Validation:
  - Request not expired/canceled.
  - Template version still valid or captured.
  - Source refs still accessible under request user context.
  - Provider enabled. If no provider is available the request stays provider-unavailable; no deterministic fallback content is generated.
- Success:
  - Creates citations, artifact, suggestion, candidate actions, and invocation logs.
- Errors:
  - needs data, provider unavailable, model parse failed, source state changed, permission revoked.

### List Suggestions

- Endpoint: `GET /ai/suggestions`
- Surface: web.
- Permission: `ai.suggestion.read` or `ai.suggestion.read_own`.
- Filters:
  - status, domain, agent, riskLevel, sourceModule, sourceRecordType, assigned user/role, date range, template, review owner.
- Success:
  - Returns redacted list with source labels, risk, confidence, status, expiry, and review/deep-link targets.

### Get Suggestion Detail

- Endpoint: `GET /ai/suggestions/:id`
- Surface: web.
- Permission: read permission plus source read permission for cited records.
- Success:
  - Returns summary, recommendation, citations, artifacts, candidate actions, review history, and source-state warning.
- Error:
  - forbidden if any required sensitive source record is not visible. Implementer may return partial redacted citations only if existing policy supports partial disclosure.

### Validate Candidate Action

- Endpoint: `POST /ai/suggestions/:id/actions/:actionId/validate`
- Surface: web.
- Permission: `ai.draft.review` plus source draft/create permission.
- Behavior:
  - Calls source-module validation.
  - No source record is created.
  - Returns validation errors, warnings, and editable fields.

### Create Source Draft

- Endpoint: `POST /ai/suggestions/:id/actions/:actionId/create-source-draft`
- Surface: web only.
- Permission: `ai.draft.create_source_draft` plus source draft/create permission.
- Validation:
  - Suggestion not expired/superseded/dismissed.
  - Source state hash unchanged or reviewer acknowledges regeneration requirement.
  - Candidate action status allows creation.
  - Source module validates payload.
  - Idempotency key prevents duplicate draft records.
- Success:
  - Creates source-module draft/request record.
  - Records review decision and source draft link.
  - Leaves final source action to source module.
- Errors:
  - forbidden, source state changed, validation failed, duplicate source draft, unsafe action, module unavailable.

### Review Suggestion

- Endpoint: `POST /ai/suggestions/:id/reviews`
- Surface: web only.
- Permission: `ai.suggestion.review` or own/team equivalent.
- Decisions:
  - request regeneration, edit and accept, dismiss, mark needs data, mark not useful, escalate.
- Success:
  - Records review and updates status.

### Admin Template Management

- Endpoint: `GET /ai/suggestion-templates`
- Endpoint: `PATCH /ai/suggestion-templates/:id`
- Endpoint: `POST /ai/suggestion-templates/:id/versions`
- Surface: web admin.
- Permission: `ai.template.read` or `ai.template.manage`.
- Rules:
  - First pass may seed fixed templates and allow enable/disable/config only.
  - Editing prompt bodies is out of first-pass scope even if prompt-template admin primitives already exist.

## 15. UI Behavior

### Web Review Queue

Route names can follow current web conventions. Conceptual surfaces:

- `/ai/suggestions`
- `/ai/suggestions/[id]`
- Source-module side panel or tab for related suggestions when source routes exist.

List view:

- Tabs: `New`, `In review`, `Needs data`, `Accepted`, `Dismissed`, `Expired`, `Failed`.
- Filters: domain, agent, risk, status, assignee, source module, template, created date.
- Columns: priority/risk, title, source, recommendation summary, confidence, citations count, expiry, owner, status.
- Empty states for no suggestions, provider disabled, no permission, and no source modules ready.

Detail view:

- Recommendation summary.
- Source citations with deep links.
- Evidence checklist.
- Candidate action payload with field-level source/provenance.
- Source-state changed warning.
- Editable draft fields before source draft creation if source module allows.
- Validate action button.
- Create source draft button.
- Regenerate, dismiss, mark needs data, escalate buttons.
- Review history and audit timeline.

Admin view:

- Provider status.
- Template catalog.
- Enabled/disabled state.
- Risk level and TTL.
- Required source modules and permissions.
- Retention settings if current config supports them.

UI constraints:

- No marketing landing page.
- Dense operational layout, not hero/card-heavy.
- Use existing web shell/navigation, table, filter, drawer/modal, toast, badge, empty/error/loading primitives.
- Never show raw hidden prompt text to normal users.
- Redact sensitive tool payloads unless permission allows.
- Long generated text must wrap and never overflow controls.

### LINE

Allowed:

- Request a suggestion.
- Ask for pending suggestions summary.
- Receive notification that a suggestion is ready.
- Read short cited summary.
- Open web deep link for review.
- Ask why a suggestion cannot be generated.

Blocked:

- Create source-module draft records.
- Accept, dismiss, or escalate suggestions.
- Final approve/reject, pay, post, file, issue, void, export, transfer, reconcile, publish, or permission mutation.

LINE response rules:

- Thai first unless user asks in English.
- Short summary plus 1 to 3 source labels.
- Web link for full review.
- Clear refusal when action requires web.
- No sensitive values in notification preview unless notification policy already permits them.

## 16. Worker and Generation Behavior

- Generation jobs run through existing worker/queue primitives.
- Jobs are idempotent by `AIDraftRequest.id` and request idempotency key.
- Retry provider/network failures with existing retry policy.
- Do not retry deterministic validation failures unless source data changes or user requests regeneration.
- Store failed state with redacted error code and operator-readable message.
- Dead-letter behavior should reuse workflow/worker dead-letter primitives if item 16 created them.
- Scheduled generation is optional first pass; manual/web, LINE request, and workflow request are priority.
- Provider calls must have timeout, token limit, structured output schema, and redaction policy.
- CI tests must use fake provider only.

## 17. Source Module Draft Integration

Required source-module adapter contract:

```text
collectEvidence(context, sourceRefs) -> EvidencePack
validateDraftPayload(context, payload) -> ValidationResult
createDraft(context, payload, idempotencyKey) -> SourceDraftRef
buildDeepLink(sourceDraftRef) -> WebDeepLink
```

Rules:

- Adapter calls source APIs/use cases, not raw cross-module DB reads.
- Adapter enforces source permissions and ABAC.
- Adapter returns bounded evidence, not unrestricted records.
- Adapter validation is deterministic.
- Adapter create operation creates draft/request/review records only.
- Adapter create operation is idempotent.
- If a source module lacks safe `createDraft`, item 17 creates an AI suggestion and review checklist only.

Minimum first-pass adapters depend on implemented source modules when item 17 starts:

- CRM follow-up/opportunity/customer review draft if CRM item 15 exposes safe draft/task APIs.
- Accounting quotation draft if Accounting Documents item 08 exposes quotation draft API and permission allows.
- Inventory reorder/count/transfer review request if Inventory item 05 exposes draft/request API.
- Tax evidence checklist if Thai Tax item 11 exposes checklist/report preparation APIs.
- Workflow task/review checklist through item 16 if source draft is unavailable.

## 18. Audit, Retention, and Privacy

Always audited:

- Suggestion request.
- Sensitive source evidence read.
- Provider invocation for finance/tax/customer/stock context.
- Suggestion generated.
- Candidate action validated.
- Review decision.
- Source draft created.
- Regeneration.
- Dismissal.
- Template enable/disable or version change.

Retention:

- Store previews and hashes by default for prompts, user text, model outputs, and tool inputs/outputs.
- Store structured draft payloads only when needed for review and source draft creation.
- Redact secrets, tokens, bank full account numbers, and sensitive PII according to existing policy.
- Full prompt/output retention requires explicit config if implemented.
- Deleting source records should not delete audit records; citations can degrade to tombstone labels when source is unavailable.

Privacy:

- AI Gateway never receives more source data than required for a template.
- Evidence packs must be bounded by template source requirements.
- Cross-company data leakage is a P0 bug.

## 19. Edge Cases

- User requests suggestion for inaccessible record.
- User has AI permission but not source read permission.
- User has AI review permission but not source draft/create permission.
- Source record changes after generation.
- Source module removed, disabled, or unavailable.
- Template requires module not yet implemented.
- Provider disabled or credentials missing.
- Provider returns unparseable JSON.
- Provider returns uncited or unsupported recommendation.
- Model suggests final mutation or unsafe action.
- Duplicate generation job runs.
- Duplicate source draft create request occurs.
- Suggestion expires while reviewer is viewing detail page.
- LINE user has multiple companies and no active company context.
- Notification contains sensitive source detail not allowed for preview.
- Prompt injection appears in source data or user prompt.
- Reviewer edits draft payload into invalid source state.
- Source module validation passes first, then fails at create because state changed.
- Auditor tries to read full prompt/model payload without sensitive permission.

## 20. Acceptance Criteria

- [ ] AI Draft and Suggestion Layer has a dedicated API/domain/persistence implementation or explicitly extends existing AI modules without duplicating boundaries.
- [ ] Suggestions can be manually requested from web.
- [ ] Suggestions can be requested from LINE but final review remains in web.
- [ ] Workflow Automation can request an AI draft through a safe action adapter when enabled.
- [ ] Every suggestion has source citations or a `NEEDS_DATA`/blocked state.
- [ ] Every AI tool call is permission-checked and audit-logged.
- [ ] AI Gateway cannot read the database directly.
- [ ] Source draft creation is web-only and requires source-module draft/create permission.
- [ ] LINE cannot create source drafts or final business mutations.
- [ ] Unsafe model output is rejected before persistence or source action.
- [ ] Provider-disabled mode is handled gracefully.
- [ ] Fake provider supports deterministic tests.
- [ ] Web review queue and detail view support review, validation, regeneration, dismissal, and source draft creation where allowed.
- [ ] Source-state changes block or force regeneration before source draft creation.
- [ ] Master Implementation Checklist item 17 remains unchecked until all implementation phases and verification pass.

## 21. Required Tests

Unit tests:

- Permission policy for AI/source permissions.
- Template validation and version snapshot logic.
- Source citation requirement.
- Candidate action schema validation.
- Unsafe final mutation rejection.
- Source-state hash comparison.
- Idempotency key builders.
- Provider output parser.
- Prompt injection guardrails for tool selection.

API tests:

- Create draft request.
- Generate draft request with fake provider.
- List/detail suggestions with role scopes.
- Validate candidate action.
- Create source draft success and denial.
- Review decisions.
- Template enable/disable.
- Provider unavailable.
- Source module unavailable.

Worker tests:

- Job idempotency.
- Retryable provider failure.
- Non-retryable validation failure.
- Dead-letter/retry behavior if shared primitive exists.

Integration tests:

- AI Gateway calls ERP tools through permission-checked APIs.
- Workflow safe action creates AI draft request.
- Notification sent when suggestion is ready.
- Source draft creation calls source-module validator and create-draft API.
- Audit records exist for sensitive reads and review decisions.

Web tests:

- Suggestion list filters and empty/error/loading states.
- Suggestion detail citations and source-state warning.
- Validate/create source draft happy path.
- Forbidden action hidden/disabled with explanation.
- Provider unavailable state.

LINE tests:

- Request suggestion.
- Pending suggestion summary.
- Ready notification/deep link.
- Refusal for source draft creation or final mutation.
- Multi-company ambiguity path.

Security tests:

- Cross-company access denial.
- ABAC source record denial.
- Prompt injection cannot expand tool allowlist.
- Redaction of prompt/tool payloads.
- No final mutation category can execute through AI Gateway.

## 22. Implementation Handoff Checklist

- [ ] Read this spec first.
- [ ] Read [[plans/ai-draft-suggestion-layer-plan|AI Draft and Suggestion Layer Plan]].
- [ ] Read [[specs/permission-matrix|Permission Matrix]] AI tool policy and AI draft permission keys.
- [ ] Read [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]].
- [ ] Read [[specs/workflow-automation-spec|Workflow Automation Spec]] safe AI draft action boundary.
- [ ] Read source-module specs for each enabled adapter.
- [ ] Inspect current `apps/api`, `apps/ai-gateway`, `apps/workers`, `apps/web`, `packages/contracts`, `packages/config`, and Prisma/migration state.
- [ ] Start at plan Phase 0 and Phase 1.
- [ ] Do not implement item 18 Reports/BI, item 19 Marketplace Import, or item 23 AI Marketing.
- [ ] Do not mark checklist item 17 complete until all phase exit criteria and verification commands pass.

## 23. Owner Decisions

- Production LLM provider preference: Amazon Bedrock through the AI Gateway provider port. Exact model id stays config-driven and must be verified against current Bedrock model access before production wiring.
- Admin prompt-template body editing is not included in first pass. Templates stay seeded/code-owned; admin can view status and safe configuration only.
- High-risk CFO ready notifications default to Owner only for cash risk, tax/closing readiness blockers, and overdue AR/AP critical suggestions.

## 24. Remaining Open Questions

- Should full prompt/output retention ever be enabled for finance/tax suggestions, or should previews/hashes remain mandatory?
