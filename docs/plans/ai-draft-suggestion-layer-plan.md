# AI Draft and Suggestion Layer Plan

## Status

Implemented 2026-07-01 (Phases 0–9). Verified with unit/integration tests (`apps/api` 730/730, `apps/web` 116/116, `apps/workers` 5/5), typecheck (api/web/ai-gateway/contracts), and `prisma validate`/`generate`. Migration `20260701140000_item17_ai_draft_suggestion` added but NOT deployed to a live DB in this environment; seed not run. See implementation-review note in [[plans/master-implementation-checklist|Master Implementation Checklist]] item 17 and [[agent-memory/ai-draft-suggestion-17]] for delivered scope and caveats. Master checklist item 17 remains unchecked pending owner review of noted deferred items and live migration/seed deploy.

Original handoff guidance (retained): implement one phase at a time; first handoff scope was Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Specs

- Spec: [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 17. AI Draft and Suggestion Layer
- Related specs:
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
  - [[specs/workflow-automation-spec|Workflow Automation Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
  - [[specs/inventory-mvp-spec|Inventory MVP Spec]]
  - [[specs/accounting-documents-spec|Accounting Documents Spec]]
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
  - [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]]
  - [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
  - [[specs/reimbursement-approval-spec|Reimbursement and Approval Spec]]
  - [[specs/crm-sales-spec|CRM and Sales Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]
  - [[adr/0008-line-ai-access-and-auth|ADR 0008 LINE AI Access and Auth]]

## Purpose

Implement the first safe AI Draft and Suggestion Layer for WatchDog-BMS:

- Manual, LINE, workflow-triggered, and optional scheduled AI draft requests.
- Source-cited suggestions for CFO, Sales/CRM, Inventory, Tax/Accounting, and Workflow review contexts.
- AI draft artifacts and candidate source-draft actions.
- Web review queue where users validate, edit, dismiss, regenerate, or create source-module drafts.
- Source-module adapters that collect evidence, validate draft payloads, and create draft/request records only.
- Permission-aware AI Gateway tool calls, model/provider port, fake provider for tests, disabled-provider fallback, and structured output validation.
- Audit, retention, source citations, idempotency, retry, and blocked unsafe action behavior.
- LINE request/summary/deep-link flow with no source draft creation or final mutation from LINE.

This plan gives Sonnet 4.6 enough detail to implement without reopening ownership of AI Gateway, ERP source modules, workflow automation, notifications, LINE auth, permissions, audit, or final business mutations.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with shared feature-folder conventions evolving through prior items.
- `packages/contracts`: shared contract package exists but may still be thin.
- `packages/config`: shared config package exists but may still be thin.

Before implementation, inspect latest code again because items 01 through 16 may add Prisma, auth, request context, company/branch/team primitives, permissions, audit, outbox, notification delivery, dashboard snapshots, LINE binding, AI tool registry, worker queue helpers, workflow action adapters, web shell routes, API client helpers, and source-module draft contracts.

Extend existing primitives. Do not duplicate tenant, auth, audit, outbox, notification, dashboard, LINE, AI Gateway, workflow, web shell, worker queue, source-module API, config, or contract code.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/ai-draft-suggestion-layer-spec.md`.
3. Read `docs/specs/permission-matrix.md`.
4. Read `docs/specs/ai-gateway-agents-spec.md`.
5. Read `docs/specs/workflow-automation-spec.md`.
6. Read `docs/specs/line-ai-read-only-assistant-spec.md`.
7. Read source-module specs for each adapter being enabled.
8. Read backend, web, and security guidelines.
9. Inspect `apps/api`, `apps/ai-gateway`, `apps/workers`, `apps/web`, `packages/contracts`, `packages/config`, and current Prisma state.
10. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 17 complete until Phase 0 through Phase 9 exit criteria pass and verification commands are recorded.

## Core Rule

AI may suggest and draft. Web-reviewed source modules decide. Final money, stock, tax, accounting, approval, export, permission, and external publishing mutations stay blocked for AI.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 16.
- If Prisma is missing, add it under `apps/api` following ADR 0006 and existing package conventions.
- If Prisma/auth/audit/outbox/notification/dashboard/LINE/AI/workflow primitives already exist, extend them with additive migrations and module code.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use server-derived `companyId`, `userId`, roles, permissions, branch/team/location scope, and source refs. Never trust client-sent tenant, permission, or role fields.
- AI Gateway must not import API Prisma clients or source-module repositories.
- ERP Core APIs/use cases must enforce source permissions again for every tool call and draft action.
- AI Gateway policy checks are guardrails, not the source of authorization truth.
- Model/provider calls must go through a provider port with timeout, token cap, structured output schema, and redaction policy.
- Tests must use fake provider only.
- Missing provider credentials must produce provider-unavailable state, not crash startup.
- Prompt templates and output schemas must be versioned.
- Model output must be parsed and validated before persistence.
- Suggestions must have source citations or become `NEEDS_DATA`/blocked.
- Candidate actions must be allowlisted, schema-validated, and risk-classified.
- Source draft creation is web-only in item 17.
- LINE may request, summarize, notify, and deep-link only.
- Source draft creation must re-check source state, source permissions, source validators, and idempotency.
- Every sensitive source read, generation, review, regeneration, dismissal, validation, and source draft creation writes audit.
- Previews and hashes are default for prompt/user/model/tool payload retention.
- Each phase must leave touched packages typecheckable.
- Record verification commands and skipped tests with concrete reasons.

## Scope

### In Scope

- Shared AI draft/suggestion contracts in `packages/contracts`.
- AI draft/suggestion permission keys and role grant alignment.
- Prisma schema/migration/seed for templates, versions, requests, suggestions, citations, artifacts, candidate actions, reviews, and tool logs if persistence exists or is added.
- API AI draft/suggestion module using hexagonal folder structure.
- AI Gateway model/provider port, fake provider, disabled provider, structured output parsing, tool policy, and tool invocation logging.
- Source evidence collection and draft adapters for implemented source modules.
- Suggestion template seeds for CFO, Sales/CRM, Inventory, Tax/Accounting, and Workflow review contexts.
- Manual web request flow.
- LINE request/summary/deep-link flow.
- Workflow Automation safe action adapter integration.
- Generation worker with idempotency, retry, and provider-unavailable/needs-data handling.
- Web AI suggestion queue, detail, review, validation, regeneration, dismissal, and source draft creation.
- Admin template/provider status view when current web/admin primitives support it.
- Tests for contracts, domain logic, API, permissions, provider parsing, worker jobs, source adapters, LINE refusal, web review, and audit.

### Out of Scope

- Autonomous final business mutations.
- LINE source draft creation or review decisions.
- Direct database access from AI Gateway.
- Generic agent plugin marketplace.
- Report/BI builder from item 18.
- Marketplace import from item 19.
- AI Marketing external campaign publishing from item 23.
- Admin prompt-template body editing.
- Payroll, fixed asset, manufacturing, MRP, advanced warehouse, or external bank/tax/social mutation.
- Prompt fine-tuning, vector memory platform, or full long-term AI memory.
- Replacing source-module approvals, validations, state machines, or audit.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: `String @id @default(cuid())` unless repo already standardizes UUIDs before item 17 starts.
- Default language: `th-TH` for LINE, web follows current locale conventions.
- Production provider preference: Amazon Bedrock through AI Gateway provider port, with exact model id kept in env/config and verified before production wiring.
- First provider mode: reuse existing AI Gateway provider if present; otherwise add Bedrock, fake/test, and disabled providers.
- CI provider: fake provider only.
- Full prompt/output storage: disabled by default.
- Stored text fields: preview plus hash unless structured draft payload is required for review.
- Suggestion TTL: 7 days for normal suggestions, 24 hours for high-risk source-state-sensitive suggestions.
- Default risk: `MEDIUM`.
- High-risk suggestions require web review and source validator pass.
- High-risk CFO ready notifications default to Owner only for cash risk, tax/closing readiness blockers, and overdue AR/AP critical suggestions.
- Source-state hash required before source draft creation.
- Source draft creation idempotency: one source draft per candidate action idempotency key.
- LINE actions: request, status, summary, deep link, refusal only.
- Workflow action: request AI draft only; no apply/create source draft.
- Template seeds: enabled only when required source modules and source read/draft APIs exist; otherwise visible as unavailable with reason.
- Admin prompt-template body editing stays out of first pass. Admin can view status and safe template settings only.
- If source module lacks safe draft create API, create AI review checklist/task only.
- If model output lacks citations, mark failed or needs data.
- If provider unavailable, keep request visible with retry/config message.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect `apps/ai-gateway/package.json`, `apps/ai-gateway/src`, provider/tool/policy code, and ERP API client patterns.
- [ ] Inspect `apps/workers/package.json`, `apps/workers/src`, queue conventions, retry/dead-letter helpers, and worker bootstrap.
- [ ] Inspect `apps/web/package.json`, `apps/web/app`, `apps/web/src/common`, and current feature folders.
- [ ] Inspect `packages/contracts/src` and export pattern.
- [ ] Inspect `packages/config/src` for env/feature-flag patterns.
- [ ] Identify existing auth/request context, permission decorator, ABAC helpers, audit log, outbox, notification API, LINE binding, deep-link helper, AI tool log, and workflow action adapter.
- [ ] Identify source modules available for AI draft adapters: CRM, accounting documents, inventory, tax, workflow, reimbursement, procurement/AP, bank reconciliation, expense, ledger.
- [ ] Identify source modules that expose safe evidence/read APIs.
- [ ] Identify source modules that expose safe draft/create/request APIs.
- [ ] Identify current route naming, navigation, API client, form, table, tabs, modal/drawer, empty/error, toast, loading, and test primitives in web.
- [ ] Identify current test commands for root, API, AI Gateway, workers, web, contracts, config, Prisma, and e2e if present.
- [ ] Record conflicts, missing primitives, and first files to edit before coding.

### Tests

- No production code required.
- Run lightweight existing checks only if needed to confirm baseline.

### Exit Criteria

- Implementation summary states which existing primitives will be reused.
- No duplicate shared module is planned.
- Exact first source paths for contracts, API module, AI Gateway provider/tool code, worker integration, web feature, source adapters, and tests are known.
- Phase 1 can start without product ownership questions.

## Phase 1: Contracts, Permissions, and Domain Logic

### Goal

Define shared contracts, permissions, enums, lifecycle logic, validation schemas, and safety policy.

### Tasks

- [ ] Add shared AI draft/suggestion enums/contracts in `packages/contracts` following current package style.
- [ ] Add permission keys from spec section 12 and align default grants using existing permission seed/config primitives.
- [ ] Define contracts for templates, template versions, draft requests, suggestions, citations, artifacts, candidate actions, reviews, provider status, and tool invocation logs.
- [ ] Define structured output schemas for each first-pass template family.
- [ ] Implement template/version validation.
- [ ] Implement request status transition rules.
- [ ] Implement suggestion status transition rules.
- [ ] Implement candidate action schema validation and unsafe final mutation rejection.
- [ ] Implement source citation requirement validator.
- [ ] Implement source-state hash builder.
- [ ] Implement idempotency key builders for requests, generation jobs, artifacts, candidate actions, and source draft creation.
- [ ] Implement retention helpers for preview/hash/redaction.
- [ ] Implement permission policy helpers for AI permission plus source-module permission requirements.

### Tests

- Contract/type tests where current setup supports them.
- Unit tests for status transitions.
- Unit tests for citation requirement.
- Unit tests for unsafe action rejection.
- Unit tests for idempotency builders.
- Unit tests for source-state hash behavior.
- Unit tests for preview/hash/redaction helpers.
- Unit tests for permission policy helpers.

### Exit Criteria

- Contracts export cleanly.
- Permission keys are available to API/web/AI code.
- Invalid template/action/output shapes fail before persistence.
- Final mutation action types are impossible by design.
- Domain tests pass.

## Phase 2: Persistence, Migrations, and Template Seeds

### Goal

Persist AI draft/suggestion records and seed first-pass templates safely.

### Tasks

- [ ] Add Prisma models or equivalent persistence using spec section 11.
- [ ] Add uniqueness constraints for idempotency keys.
- [ ] Add indexes for company/status/domain/agent/template/source/assignee/date filters.
- [ ] Add migrations using existing migration convention.
- [ ] Add repositories and query services for templates, requests, suggestions, citations, artifacts, actions, reviews, and invocation logs.
- [ ] Add data mappers between domain models and persistence.
- [ ] Add template seed data for CFO, Sales/CRM, Inventory, Tax/Accounting, and Workflow review contexts.
- [ ] Template seeds must mark missing source modules unavailable with reasons.
- [ ] Ensure prompt/model/tool payload storage follows preview/hash defaults.
- [ ] Ensure secrets/provider credentials are not stored in suggestion tables.

### Tests

- Migration/schema validation command.
- Repository tests where DB test setup exists.
- Seed tests or snapshots for template catalog.
- Uniqueness/idempotency tests.
- Redaction tests for persistence payloads.

### Exit Criteria

- Database schema supports first-pass AI draft/suggestion data.
- Template catalog can show available/unavailable state.
- Duplicate request/generation/source-draft attempts do not create duplicate rows.
- Sensitive prompt/tool values are not returned by default APIs.

## Phase 3: AI Gateway Provider, Tool Policy, and Generation Pipeline

### Goal

Enable AI Gateway to generate structured draft artifacts through safe provider and tool boundaries.

### Tasks

- [ ] Inspect existing AI Gateway provider/tool registry. Extend it instead of replacing it.
- [ ] Add `LlmTextGenerationPort` or equivalent if no provider port exists.
- [ ] Add Bedrock provider behind env/config when production provider wiring is in scope; do not hard-code model ids.
- [ ] Add fake provider for deterministic tests.
- [ ] Add disabled provider that returns provider-unavailable state without crashing.
- [ ] Reuse existing production provider if present; otherwise leave Bedrock provider disabled until env/config is present.
- [ ] Add structured output parser with schema validation and actionable parse errors.
- [ ] Add tool policy for `read_summary`, `read_detail`, `read_evidence_pack`, `draft_generate`, `draft_validate`, `source_draft_create`, `review_decision`, `notification_request`, and blocked `final_mutation`.
- [ ] Add ERP API client calls for evidence packs through permission-checked APIs only.
- [ ] Add source citation assembly and citation validation.
- [ ] Add prompt injection guardrails for source text and user prompt text.
- [ ] Add provider timeout, token cap, retry classification, and redacted logging.
- [ ] Add tool invocation log writing through API/audit boundary if existing architecture requires API-owned persistence.

### Tests

- Unit tests for fake provider.
- Unit tests for disabled provider.
- Unit tests for structured output parsing.
- Unit tests for tool policy allow/deny.
- Prompt injection tests that try to expand tool allowlist.
- Provider timeout/error classification tests.
- Integration tests for AI Gateway calling ERP evidence tools through API boundary.

### Exit Criteria

- CI does not need network/model credentials.
- Provider-unavailable mode is visible and safe.
- AI Gateway cannot execute final mutation tools.
- AI Gateway uses ERP APIs/tools, not database repositories.
- Generated output is structured, cited, and validated before API persistence.

## Phase 4: API Module and Review Use Cases

### Goal

Expose permission-checked APIs for draft requests, suggestions, reviews, validation, source draft creation, and template management.

### Tasks

- [ ] Create API AI draft/suggestion module using repo's hexagonal folder layout.
- [ ] Add controllers/routes following existing company-scoped conventions.
- [ ] Implement create draft request use case.
- [ ] Implement generation result persistence use case if AI Gateway/worker calls API to save results.
- [ ] Implement list suggestions use case with filters and ABAC-aware query behavior.
- [ ] Implement suggestion detail use case with citation redaction.
- [ ] Implement candidate action validation use case.
- [ ] Implement create source draft use case with web-only guard.
- [ ] Implement review decision use case.
- [ ] Implement regeneration request use case.
- [ ] Implement template list/status/admin use cases within first-pass scope.
- [ ] Enforce AI permissions and source-module permissions server-side.
- [ ] Emit audit/outbox/notification records through existing primitives.
- [ ] Add OpenAPI/contract exports if current project does that.

### Tests

- API tests for create request, list/detail, validation, source draft creation, review, regeneration, and template status.
- Permission tests for Owner/Admin/Manager/Sales/Inventory/Finance/Accountant/Staff/Auditor.
- Source permission denial tests.
- Web-only guard tests for source draft creation.
- Source-state changed tests.
- Audit/outbox/notification assertion tests where primitives exist.

### Exit Criteria

- APIs enforce AI permission plus source permission.
- Source draft creation is impossible outside web-authenticated context.
- Suggestion detail never leaks unauthorized citations.
- Review and regeneration behavior is auditable.
- Source draft creation is idempotent.

## Phase 5: Source Evidence and Draft Adapters

### Goal

Connect AI suggestions to implemented source modules without bypassing source ownership.

### Tasks

- [ ] Define source adapter interface from spec section 17.
- [ ] Implement adapter registry with availability reasons.
- [ ] Implement CRM/Sales adapter if CRM item 15 APIs exist.
- [ ] Implement Accounting Documents quotation draft adapter if item 08 APIs exist.
- [ ] Implement Inventory reorder/transfer/count review adapter if item 05 APIs exist.
- [ ] Implement Tax evidence/checklist/certificate draft adapter if item 11 APIs exist.
- [ ] Implement Workflow task/review checklist fallback through item 16 when source draft API is unavailable.
- [ ] Implement finance/CFO evidence packs from ledger, bank, AP, AR, expense, reimbursement, and tax modules only where those APIs exist.
- [ ] Keep every adapter using source APIs/use cases, not raw cross-module database reads.
- [ ] Add source-state hash and source-state changed detection per adapter.
- [ ] Add deep-link builders through existing web route contracts.

### Tests

- Adapter availability tests.
- Evidence-pack permission and ABAC tests.
- Draft payload validation tests.
- Source-state hash tests.
- Source draft create idempotency tests.
- Deep-link generation tests.
- Fallback review checklist tests for unavailable source draft APIs.

### Exit Criteria

- At least one real source adapter or workflow-review fallback is implemented based on available modules.
- Missing modules show unavailable state, not runtime crashes.
- Source adapters never bypass source validators.
- Source draft creation creates draft/request records only.

## Phase 6: Worker Jobs, Workflow Integration, and Notifications

### Goal

Run generation asynchronously, integrate workflow requests, and notify users safely.

### Tasks

- [ ] Add generation job queue using existing worker/queue convention.
- [ ] Add job idempotency by request id and idempotency key.
- [ ] Add retry policy for provider/network/transient API failures.
- [ ] Add non-retry handling for permission denied, validation failed, unsafe output, and source state changed.
- [ ] Reuse workflow/worker dead-letter primitive if item 16 created one.
- [ ] Add workflow safe action adapter integration for `REQUEST_AI_DRAFT`.
- [ ] Add notification request when suggestion is ready, failed, needs data, or requires high-risk review.
- [ ] Limit default Owner notifications for high-risk CFO suggestions to cash risk, tax/closing readiness blockers, and overdue AR/AP critical suggestions.
- [ ] Add optional manual retry/regenerate behavior.
- [ ] Add structured logs/metrics hooks if current observability primitives exist.

### Tests

- Worker job idempotency tests.
- Retryable versus non-retryable error tests.
- Dead-letter tests where primitive exists.
- Workflow action adapter tests.
- Notification request tests.
- Provider-unavailable job tests.

### Exit Criteria

- Duplicate generation jobs do not duplicate suggestions.
- Workflow can request AI drafts but cannot apply them.
- Users receive safe ready/failed/needs-data notifications.
- Failed jobs are inspectable and retryable where appropriate.

## Phase 7: Web AI Suggestion Review Experience

### Goal

Build the web review queue and detail flow for operational use.

### Tasks

- [ ] Add AI Suggestions navigation entry following existing web shell conventions.
- [ ] Build suggestion list with tabs, filters, status badges, risk badges, citations count, owner, expiry, and source labels.
- [ ] Build suggestion detail with summary, recommendation, citations, artifacts, candidate actions, validation result, source-state warning, and review history.
- [ ] Add manual request flow from AI Suggestions page.
- [ ] Add source-module side panel/tab link if source routes exist.
- [ ] Add validate candidate action button.
- [ ] Add create source draft button with disabled/forbidden/needs-regeneration states.
- [ ] Add regenerate, dismiss, mark needs data, mark not useful, and escalate actions.
- [ ] Add provider unavailable and template unavailable states.
- [ ] Add admin template/provider status surface where current admin primitives support it.
- [ ] Exclude admin prompt-template body editing from first-pass UI.
- [ ] Ensure text wraps and controls keep stable dimensions on mobile/desktop.

### Tests

- Component/unit tests where current setup supports them.
- Web tests for list filters/tabs.
- Web tests for detail citations and source-state warning.
- Web tests for validate/create source draft happy path.
- Web tests for forbidden/disabled/provider-unavailable states.
- Accessibility checks where current setup supports them.

### Exit Criteria

- Web users can request, review, validate, regenerate, dismiss, and create source drafts where permitted.
- Unauthorized users see no leaked source data.
- UI is usable on supported desktop/mobile viewports.
- Source draft creation always routes through API and source validators.

## Phase 8: LINE Request, Summary, and Deep-Link Flow

### Goal

Let LINE users request and inspect AI suggestions without source mutation.

### Tasks

- [ ] Extend existing LINE AI routing for suggestion request intents.
- [ ] Add pending/ready suggestion summary response.
- [ ] Add ready notification copy and deep-link payload through notification/LINE primitives.
- [ ] Add refusal response for accept/create-source-draft/final mutation attempts.
- [ ] Add multi-company ambiguity handling through existing LIFF/web selector.
- [ ] Add source citation labels in short LINE responses.
- [ ] Ensure no sensitive values are sent in LINE preview when notification policy forbids it.

### Tests

- LINE request suggestion tests.
- LINE pending summary tests.
- LINE ready deep-link tests.
- LINE refusal tests for source draft creation and final mutation.
- Multi-company ambiguity tests.
- Sensitive preview redaction tests.

### Exit Criteria

- LINE can request and summarize suggestions.
- LINE cannot create source drafts or final mutations.
- LINE responses include source labels or clear needs-data/provider-unavailable reason.
- Web deep links re-check permission when opened.

## Phase 9: Verification, Documentation, and Checklist Gate

### Goal

Verify implementation, update docs, and only then close Master Implementation Checklist item 17.

### Tasks

- [ ] Run root lint/typecheck/test commands that exist.
- [ ] Run API tests.
- [ ] Run AI Gateway tests.
- [ ] Run worker tests.
- [ ] Run web tests.
- [ ] Run contract/config tests if present.
- [ ] Run Prisma migration/schema checks if Prisma exists.
- [ ] Run e2e/smoke flow: request suggestion -> generate with fake provider -> review in web -> validate -> create source draft or fallback checklist -> audit visible.
- [ ] Run LINE smoke flow: request suggestion -> ready summary/deep link -> refusal for source draft creation.
- [ ] Verify cross-company and ABAC denial cases.
- [ ] Verify provider-unavailable state.
- [ ] Verify no final mutation tools can execute from AI Gateway.
- [ ] Update docs only for actual implementation deltas.
- [ ] Record verification commands and skipped checks with reasons.
- [ ] Update Master Implementation Checklist item 17 checkbox only after all exit criteria pass.

### Tests

- Full available suite plus targeted smoke/e2e checks above.

### Exit Criteria

- All available tests/checks pass or skipped checks have concrete recorded reasons.
- Docs match implementation behavior.
- Item 17 acceptance criteria in spec section 20 pass.
- No item 18/19/23 scope leaked into implementation.
- Master checklist is updated only after implementation and verification are complete.

## Review Checklist

- [ ] AI Gateway does not import ERP Prisma/source repositories.
- [ ] ERP Core enforces permission on every evidence/read/draft action.
- [ ] LINE cannot create source drafts or final mutations.
- [ ] Source draft creation is web-only and idempotent.
- [ ] Every suggestion has citations or blocked/needs-data state.
- [ ] Unsafe model output is rejected.
- [ ] Provider-unavailable state is graceful.
- [ ] Fake provider makes CI deterministic.
- [ ] Prompt/user/model/tool payload storage follows preview/hash/redaction defaults.
- [ ] Source-state changes block or force regeneration.
- [ ] Audit records exist for sensitive reads, generation, review, validation, source draft creation, and template changes.
- [ ] Source adapters use source APIs/use cases and validators.
- [ ] Web UI handles forbidden, unavailable, expired, failed, and source-state-changed states.
- [ ] Master Implementation Checklist item 17 remains unchecked until verification passes.

## Suggested First Sonnet 4.6 Prompt

Implement Master Implementation Checklist item 17: AI Draft and Suggestion Layer.

Start with Phase 0 and Phase 1 only unless I explicitly expand scope.

Read, in order:

1. `docs/plans/master-implementation-checklist.md`
2. `docs/plans/ai-draft-suggestion-layer-plan.md`
3. `docs/specs/ai-draft-suggestion-layer-spec.md`
4. `docs/specs/permission-matrix.md`
5. `docs/specs/ai-gateway-agents-spec.md`
6. `docs/specs/workflow-automation-spec.md`
7. Relevant source-module specs for adapters available in current code
8. `docs/guidelines/backend-hexagonal-code-style.md`
9. `docs/guidelines/web-frontend-code-style.md`
10. `docs/guidelines/security-implementation-guideline.md`

Then inspect current code in `apps/api`, `apps/ai-gateway`, `apps/workers`, `apps/web`, `packages/contracts`, and `packages/config`.

For Phase 0, report existing primitives and exact files to extend. For Phase 1, implement contracts, permission keys, status/domain logic, validation schemas, unsafe action rejection, citation requirement, source-state hash, idempotency builders, retention preview/hash helpers, and focused unit tests.

Do not implement final money, stock, tax, accounting, approval, export, permission, external publishing, item 18 Reports/BI, item 19 Marketplace Import, or item 23 AI Marketing.

Keep Master Implementation Checklist item 17 unchecked until all phases and verification pass.

## Risks

- AI scope creep into autonomous final actions. Mitigation: blocked final mutation category, source-module validation, web-only source draft creation, and tests.
- Permission leakage through citations or summaries. Mitigation: source permission checks, ABAC-aware queries, redacted citations, and cross-company tests.
- Provider dependency makes CI flaky. Mitigation: fake provider and disabled-provider fallback.
- Source modules have inconsistent draft APIs. Mitigation: adapter availability registry and workflow-review checklist fallback.
- Prompt injection in source records or user messages. Mitigation: structured tools, allowlist policy, output schema validation, and injection tests.
- Duplicate source drafts. Mitigation: idempotency keys and unique constraints.
- Full prompt/model output retention creates privacy risk. Mitigation: preview/hash defaults and config gate.

## Owner Decisions

- Production LLM provider preference: Amazon Bedrock through the AI Gateway provider port. Exact model id stays env/config-driven and must be verified before production wiring.
- Admin prompt-template body editing is not included in first pass. Templates stay seeded/code-owned; admin can view status and safe configuration only.
- High-risk CFO ready notifications default to Owner only for cash risk, tax/closing readiness blockers, and overdue AR/AP critical suggestions.
