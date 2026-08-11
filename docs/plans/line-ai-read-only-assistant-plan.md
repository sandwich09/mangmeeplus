# LINE AI Read-Only Assistant Implementation Plan

## Status

Implemented and verified on 2026-06-25. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 07.

Coverage expansion follow-up: [[plans/line-ai-business-query-coverage-plan|LINE AI Business Query Coverage Plan]] item 10G owns system-wide feature coverage and the customer-versus-employee wrong-tool closure. Do not reopen the item 07 foundation or mirror every API as a tool.

Implementation evidence: [[agent-memory/line-ai-read-only-assistant-07|Agent Memory: line-ai-read-only-assistant-07]].

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 07. LINE AI Read-Only Assistant
- Related specs:
  - [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
  - [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
  - [[specs/inventory-mvp-spec|Inventory MVP Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/platform-environment-config-spec|Platform Environment Config]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]
  - [[adr/0008-line-ai-access-and-auth|ADR 0008 LINE AI Access and Authentication]]

## Purpose

Implement the first safe LINE AI chat loop:

- LINE webhook receives user messages.
- API verifies LINE signature and resolves linked WatchDog-BMS user/company context.
- AI Gateway orchestrates one read-only turn.
- ERP Core read tools return permission-checked summaries and source refs.
- LINE receives concise Thai-first answer with source refs and web deep links.
- Mutation requests are refused and routed to web when a safe link exists.

This plan should give Sonnet 4.6 enough detail to implement without reopening product, security, service-boundary, or LINE/web ownership decisions.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with matching health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with `app/layout.tsx`, `app/page.tsx`, and global CSS only in the current snapshot.
- `packages/contracts`: shared contract package with thin `HealthStatus` and `TenantContext` exports.
- `packages/config`: shared config package exists and is currently thin.
- No Prisma schema exists in this snapshot.
- Root, API, AI Gateway, workers, web, contracts, and config packages expose build/typecheck/test-style scripts through Turbo or package scripts.
- Items 01 through 06 may add Prisma, auth, audit, outbox, request context, branch/location scope, web workspace routes, inventory APIs, dashboard/notification APIs, LINE bindings, worker conventions, and shared contracts before item 07 starts.

Before implementation, inspect latest code again. Extend existing primitives. Do not duplicate tenant, auth, audit, outbox, LINE binding, dashboard, notification, inventory, worker, web-shell, config, or contract code.

## Implementation Readiness Status

Status: implemented and verified as of 2026-06-25. See [[agent-memory/line-ai-read-only-assistant-07|Agent Memory: line-ai-read-only-assistant-07]] for role-gate evidence and verification results.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/line-ai-read-only-assistant-spec.md`.
3. Read `docs/specs/line-ai-channel-auth-spec.md`.
4. Read `docs/specs/line-ai-assistant-ux-spec.md`.
5. Read `docs/specs/ai-gateway-agents-spec.md`.
6. Read `docs/specs/permission-matrix.md`.
7. Read `docs/specs/auth-authorization-rbac-spec.md`.
8. Read `docs/specs/dashboard-notification-spec.md`.
9. Read `docs/specs/inventory-mvp-spec.md`.
10. Read `docs/guidelines/backend-hexagonal-code-style.md`.
11. Read `docs/guidelines/security-implementation-guideline.md`.
12. Inspect `apps/api`, `apps/ai-gateway`, `apps/workers`, `apps/web`, `packages/contracts`, `packages/config`, and current Prisma state.
13. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 07 complete until Phase 0 through Phase 9 exit criteria pass and verification commands are recorded.

## Core Rule

Start with read-only permission-checked tools. No final mutation from LINE. Later source-module plans may add explicitly allowlisted intake flows only when they create draft/pending-ticket records and keep approval/final action in web.

## Phase 1A Addendum: Read, Report, Suggest, and Accounting Evidence Capture

Owner update on 2026-06-25: this phase now covers omnichannel AI chat through LINE OA/LIFF and the web side chat pattern, but only for safe information and capture workflows.

Allowed in this phase:

- Ask business questions and view implemented summaries/reports for accounting, ledger, sales, inventory, notifications, customers, and CRM where source modules and permissions exist.
- Generate sales suggestions for sales users, such as customers to follow up, reasons, and source-backed next-best-action hints.
- Upload slip/receipt images or PDFs from LINE/LIFF or web chat so the accounting capture flow can OCR/extract fields and update draft/accounting capture records with provenance.
- Create source-module-owned pending review tickets only when a later source spec explicitly allows it, such as item 20 own leave-request intake.
- Use AI provider/model config behind AI Gateway after safety envelope, tool policy, source refs, and refusal behavior stay intact.

Blocked in this phase:

- AI approval, payment, transfer, posting, period close, stock final mutation, order confirmation, tax filing, export, permission change, or external campaign/broadcast.
- Auto-sending marketing messages or sales commitments.
- Any accounting update that is not derived from user-uploaded financial evidence and server-side validation.

Implementation defaults:

- Keep AI agents server-side. LIFF/web side chat call NestJS/API or AI Gateway endpoints; they never hold AI provider keys.
- Keep `AI_FINAL_MUTATION_ENABLED=false`.
- Allow tool categories `read_summary`, `read_detail`, `report`, `suggestion`, `evidence_capture`, and later source-owned `approval_request` only when it creates a pending web review ticket.
- Treat `evidence_capture` as draft/capture-only with original file, extracted fields, confidence, user, timestamp, and audit metadata.
- Ask follow-up questions when required receipt/slip fields or OCR confidence are missing.
- Provider readiness means code/config exposes `MODEL_PROVIDER`, provider model settings, and key placeholders; actual provider invocation can remain behind deterministic fallback until keys are set.

## Role Gates

BA gate: Business goal is a safe LINE/LIFF and web side-chat assistant for business inquiry, reports, sales suggestions, and slip/receipt accounting capture. Target users are owner/admin/finance/accountant/sales/CRM users. Journey is chat or upload -> server-side AI Gateway -> permission-checked ERP tool -> source-aware answer or missing-field prompt. Rules/exceptions block approval, payment, posting, transfer, order confirmation, export, permission change, and campaign broadcast. Acceptance requires report/suggestion/capture intents to route to allowed tools and final mutations to remain refused.

SA gate: Architecture keeps LIFF/web as clients only and agents/server policy in AI Gateway. Contracts add `report`, `suggestion`, and `evidence_capture`; ERP Core owns data access, ABAC, validation, and draft/capture persistence. Data impact is provenance for uploaded evidence, extracted fields, confidence, user, timestamp, and audit metadata. Scope excludes browser-held provider keys, direct DB reads from AI Gateway, and final business mutations.

DEV gate: Ponytail full applies: smallest diff extends existing contracts/config/intent logic/docs without adding new SDK dependency or duplicate service boundary. Touched code is limited to AI Gateway contracts/config and deterministic route/policy logic. Focused checks must cover capture vs mutation, sales suggestion routing, report routing, and final-mutation refusal.

Integration gate: Backend contract remains LINE OA/LIFF/web side chat -> API/AI Gateway -> ERP tools. UI states are existing refused/forbidden/no-data replies plus capture missing-field prompts from ERP. Browser/E2E is needed only when the web side drawer UI is implemented; this patch has no web UI code.

## Integration Verification

- Run `pnpm --filter @watchdog-bms/ai-gateway test`.
- Run `pnpm --filter @watchdog-bms/contracts typecheck`.
- Run `pnpm --filter @watchdog-bms/config typecheck`.
- Run `pnpm agent:gates -- docs/plans/line-ai-read-only-assistant-plan.md docs/agent-memory/line-ai-read-only-assistant-07.md`.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 06.
- If Prisma/auth/audit/outbox/LINE shared-channel context already exists, extend it with additive migrations and module code.
- Do not duplicate `Company`, `User`, `CompanyMembership`, `ExternalIdentity`, `PlatformLineChannel`, `LineCompanyContext`, `LineConversation`, `LineDelivery`, `AuditLog`, `OutboxEvent`, dashboard, notification, or inventory models. Treat `LineChannelBinding` as legacy/company-specific only.
- Keep LINE webhook trust in API or the existing LINE module boundary from item 02.
- Verify LINE webhook signature using raw body before trusting event fields.
- Keep AI Gateway separate from ERP core.
- AI Gateway must not import API Prisma client, source-module repositories, or direct database adapters.
- AI Gateway may call only allowlisted read tools for item 07.
- ERP Core read tools must repeat permission and ABAC checks.
- Tool results must return scoped summaries and source refs, not unrestricted rows.
- Use server-derived user/company/request context only.
- Do not accept typed company ids, roles, permission names, branch scope, location scope, approval state, price, tax, or stock quantity from LINE user text as authorization.
- Treat inactive users, inactive/removed company memberships, suspended companies, and disabled LINE identities as fail-closed. A valid LINE signature, valid LINE Login identity, existing first-party session, cached `LineCompanyContext`, old notification, or old deep link must not expose company data after access is removed.
- Mutation requests from LINE must be refused.
- Web deep links from LINE must re-check current permission and record state.
- Store no raw LINE secrets, signatures, tokens, auth headers, or first-party JWTs in logs, audit metadata, conversation rows, or tool-call rows.
- Each phase must leave touched packages typecheckable.
- Record verification commands and any skipped tests with concrete reasons.

## Scope

### In Scope

- Shared LINE AI and AI tool contracts in `packages/contracts`.
- API LINE webhook route or extension of item 02 LINE webhook module.
- LINE webhook signature verification integration if item 02 left only a verifier port.
- Linked-user/company-context resolution for LINE message events.
- Conversation/turn persistence where storage primitives exist.
- AI Gateway internal line-turn endpoint.
- AI Gateway intent classification for read, unsupported, forbidden, and mutation-request intents.
- Read-only tool registry and tool policy.
- ERP Core read tool adapters for implemented item 05 and item 06 sources.
- Thai-first LINE answer formatting.
- Source refs and safe web deep links.
- Audit/tool-call logging for sensitive reads.
- Idempotency for duplicate webhook events where event ids are available.
- Tests for contracts, signature failure, unlinked user, forbidden data, mutation refusal, tool policy, source refs, and redaction where current test setup supports them.

### Out of Scope

- Final approve/reject, payment, accounting posting, stock mutation, tax filing, permission change, export, or external publishing from LINE.
- AI draft/suggestion layer from item 17.
- AI marketing generation from item 23.
- Full web AI chat panel unless it already exists and can reuse contracts safely.
- Native mobile app.
- Email delivery.
- New dashboard/notification delivery primitives beyond item 06.
- New inventory mutation APIs beyond item 05.
- Accounting, ledger, tax, CRM, procurement, bank, payroll, fixed asset, manufacturing, marketplace, or BI read tools before those roadmap items exist.
- Production infrastructure provisioning.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- LINE answer locale: `th-TH`.
- English answer allowed when user writes in English.
- Default agent: `general`.
- First enabled agents: `general`, `inventory`, `notifications`.
- CFO/tax/sales/CRM/marketing agents can exist as enum values but must return unsupported-module answers until source modules exist.
- AI behavior: deterministic classifier and answer composer first. Add AI provider/model adapter later behind a port after tool policy, source refs, audit, and refusal behavior are stable.
- First read tools:
  - `company.get_current_context`
  - `dashboard.get_business_health_summary`
  - `notifications.list_open_alerts`
  - `notifications.get_daily_summary` only when item 06 already exposes deterministic daily summary behavior
  - `inventory.search_products`
  - `inventory.get_stock_balance`
  - `inventory.list_low_stock`
  - `inventory.summarize_stock_movements`
- Tool category allowlist for LINE item 07: `read_summary`, `read_detail`.
- Tool categories blocked for LINE item 07 first pass: `draft_create`, `approval_request`, `final_mutation`. Later source modules may opt into a narrow `approval_request` intake only when their spec keeps final approval in web.
- User message persistence: preview plus hash. Full user message text waits for an approved retention policy. Dev/test-only full logs are allowed only with active redaction and non-production data.
- Multi-company selection: OWNER-only via LIFF/web selector. Normal employees have one active company membership. LINE quick reply can guide an owner, but typed or tapped company ids in LINE are not authorization source of truth.
- Access removal: Owner/Admin inactivation takes effect on the next request; no grace period for LINE AI, alerts, uploads, deep links, or web routes.
- First rich menu for item 07: `Ask AI`, `Open Alerts`, `Link Account`. Do not build a new `Daily Summary` workflow in item 07; reuse item 06 only when already available and owner enables it.
- Reply format: concise Thai lines or bullets, then source labels and web link label when useful.
- Source refs required for stock, alert, dashboard, finance, tax, CRM, customer, and audit-like answers.
- Web paths should use item 03 route conventions if available; otherwise keep route builder isolated and easy to update.
- AI provider config is not required for item 07 handoff readiness.
- If LINE reply delivery cannot finish inside webhook constraints, record limitation and use existing item 06 delivery worker only if already safe and available.
- Local LINE test default when a tunnel exists: use the tunnel URL for `/v1/line/webhook`, `/v1/auth/line/link-page`, LIFF/deep-link callback behavior, and mobile LINE webview retest. Do not use `localhost` for LINE platform callbacks.
- Password-change success screen must show QR code plus copyable short link for the shared LINE OA add URL and account-link page. Account-link uses `LINE_ACCOUNT_LINK_URL` when set, otherwise `https://liff.line.me/<LINE_LIFF_ID>` when LIFF id exists, then `NEXT_PUBLIC_API_BASE_URL + /auth/line/link-page`. LINE Developers LIFF endpoint still points to the active tunnel `/v1/auth/line/link-page`.
- Shared LINE OA uses one LINE chat thread. Seeing old LINE chat history after scanning again is expected. Server-side `LineCompanyContext`, not chat history, decides current company.
- Account-link flow must be idempotent for the same WatchDog user and LINE user: if already linked to the same user, refresh selected company context and return success. If linked to another user, fail closed.
- Current implementation gap found during local test: `LinkLineIdentityUseCase` creates `ExternalIdentity` but does not yet upsert `LineCompanyContext`; implement this before accepting multi-company OWNER switching.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect item 02 auth/request-context/permission/audit/LINE modules if present.
- [ ] Inspect item 04 data model/outbox/audit/worker primitives if present.
- [ ] Inspect item 05 inventory API/query ports/contracts if present.
- [ ] Inspect item 06 dashboard/notification API/query ports/contracts/LINE delivery if present.
- [ ] Inspect `apps/ai-gateway/package.json`, `apps/ai-gateway/src/common`, and current module structure.
- [ ] Inspect `apps/workers/package.json`, worker entrypoint, queue/config conventions, and any outbox consumers.
- [ ] Inspect `apps/web/app`, current workspace route conventions, and deep-link route helpers.
- [ ] Inspect `packages/contracts/src` and export style.
- [ ] Inspect `packages/config` for LINE, AI Gateway, internal service auth, Redis, and public API config helpers.
- [ ] Confirm current permission key registry and seed location.
- [ ] Confirm current test commands for root, API, AI Gateway, workers, contracts, config, and web.
- [ ] Confirm whether LINE webhook raw-body handling exists.
- [ ] Confirm whether internal service-to-service auth pattern exists.
- [ ] Confirm whether AI provider/model config exists, but do not block item 07 because deterministic behavior is the default.
- [ ] Confirm whether conversation, tool-call, audit, and webhook event logging tables exist.
- [ ] Decide extension path:
  - extend existing LINE/auth/audit/outbox/dashboard/inventory modules, or
  - create missing item-07-specific pieces with clear notes.
- [ ] Record schema, route, permission, queue, AI provider, LINE, or tool-contract conflicts before coding.

### Tests

- No code tests required unless reconciliation changes setup.

### Exit Criteria

- Implementer knows exact files/modules to touch.
- Implementer knows whether to add or extend Prisma.
- Implementer knows where LINE webhook, AI Gateway turn endpoint, ERP read tools, audit logs, and source refs belong.
- No duplicate tenant/auth/audit/outbox/LINE/dashboard/notification/inventory/web-core plan remains unresolved.

## Phase 1: Contracts, Tool Policy, and Pure Logic

### Goal

Create framework-free contracts and pure logic for LINE AI turns before persistence, HTTP, LINE SDK, or AI provider wiring.

### Tasks

- [ ] Add or extend `packages/contracts/src/line-ai.ts`.
- [ ] Add or extend `packages/contracts/src/ai-tools.ts`.
- [ ] Export contracts from `packages/contracts/src/index.ts`.
- [ ] Define shared types for:
  - LINE AI agents
  - tool categories
  - tool result statuses
  - source refs
  - web links
  - turn request/response
  - refusal reasons
  - unsupported-module responses
- [ ] Add API module folder if no existing LINE module fits:
  - `apps/api/src/modules/line-ai/application`
  - `apps/api/src/modules/line-ai/domain`
  - `apps/api/src/modules/line-ai/infrastructure`
  - `apps/api/src/modules/line-ai/presentation/http`
- [ ] Add AI Gateway module folder:
  - `apps/ai-gateway/src/modules/line-ai/domain`
  - `apps/ai-gateway/src/modules/line-ai/application`
  - `apps/ai-gateway/src/modules/line-ai/infrastructure`
  - `apps/ai-gateway/src/modules/line-ai/presentation/http`
- [ ] Add pure logic:
  - normalize LINE text message
  - classify mutation request keywords/intents
  - classify unsupported module requests
  - choose default agent
  - enforce tool category allowlist
  - format forbidden/unsupported/mutation refusal
  - build source label list
  - build safe web link list from source refs
  - redact secrets from log-like objects
- [ ] Add stable domain error codes for invalid signature, duplicate event, unlinked user, ambiguous company, forbidden, unsupported module, mutation blocked, tool unavailable, AI timeout, and LINE delivery failure.

### Tests

- `packages/contracts` typecheck.
- Pure unit tests for tool category allowlist.
- Pure unit tests for mutation-request classification.
- Pure unit tests for unsupported-module classification.
- Pure unit tests for source ref formatting.
- Pure unit tests for redaction.

### Exit Criteria

- Shared contracts compile and are exported.
- Pure logic has no NestJS, Prisma, HTTP, LINE SDK, AI provider, storage, queue, or browser imports.
- Read-only and refusal behavior is covered by pure tests.

## Phase 2: Persistence, Audit, and Idempotency

### Goal

Persist AI turns, tool invocations, and webhook event processing safely without storing secrets.

### Tasks

- [ ] Reuse existing Prisma/storage/audit/outbox modules if present.
- [ ] Add Prisma only if prior items still have not added it and current repo conventions require persistence now.
- [ ] Add or extend data models from the spec:
  - `AiConversation`
  - `AiTurn`
  - `AiToolInvocation`
  - `LineWebhookEventLog`
- [ ] Reuse existing `LineConversation` if item 02 already created it. Do not create a conflicting conversation table.
- [ ] Add indexes:
  - company/user/channel last turn lookup
  - webhook event id dedup lookup
  - tool invocation by turn/company/user
  - audit/time lookup where existing audit supports it
- [ ] Store user message preview plus hash by default.
- [ ] Store reply preview, refusal flag, source refs, status, duration, and error code.
- [ ] Add repository ports and infrastructure adapters.
- [ ] Add audit append calls for:
  - unlinked LINE access attempt
  - sensitive read tool call
  - blocked mutation request
  - AI Gateway/tool failure where policy requires audit
- [ ] Add idempotency behavior for duplicate LINE webhook event ids where available.
- [ ] Add retention config hook or TODO note if no retention framework exists.

### Tests

- Migration/schema validation command when Prisma exists.
- Repository tests where current test setup supports DB tests.
- Unit tests for duplicate event handling.
- Unit tests for preview/hash persistence behavior.
- Unit tests or integration tests proving secrets are not persisted in normal log payloads.

### Exit Criteria

- AI turns and tool calls are persisted or clearly deferred behind ports if persistence primitives are not available.
- Duplicate webhook event does not create duplicate business-visible processing.
- Sensitive reads are auditable.
- Raw LINE/auth secrets are not stored.

## Phase 3: API LINE Webhook Ingress

### Goal

Receive LINE messages safely, resolve linked user context, and call AI Gateway with server-derived context.

### Tasks

- [ ] Add or extend `POST /v1/line/webhook`.
- [ ] Ensure raw request body is available to signature verifier.
- [ ] Verify LINE signature before parsing/trusting event fields.
- [ ] Reject invalid signatures with `401` or `403`.
- [ ] Parse supported event types:
  - text message
  - rich-menu/postback shortcuts for Ask AI, Open Alerts, and Link Account where configured
  - Daily Summary only when item 06 already exposes it and owner enables the shortcut
- [ ] Ignore unsupported event types safely and idempotently.
- [ ] Validate the WatchDog shared LINE channel from messaging channel id/config.
- [ ] Resolve company context from linked `ExternalIdentity` plus `LineCompanyContext`; do not infer company from channel id.
- [ ] Map LINE user id to internal user through `ExternalIdentity`.
- [x] Update `/v1/auth/line/link` so it can receive/derive the currently selected WatchDog `companyId`.
- [x] In `LinkLineIdentityUseCase`, when LINE identity is already linked to the same WatchDog user, refresh `LineCompanyContext` and return success instead of throwing conflict.
- [x] In `LinkLineIdentityUseCase`, after successful new link, upsert `LineCompanyContext` for `lineUserId -> selectedCompanyId`.
- [x] Validate selected company membership before writing `LineCompanyContext`: OWNER may select among active owned companies; normal employee must have exactly one active company and cannot select arbitrary company.
- [ ] Keep fail-closed behavior when LINE identity is linked to another WatchDog user.
- [ ] Resolve active company membership, roles, permissions, branch/location scope, locale, and current conversation context.
- [ ] Reject inactive users, inactive memberships, disabled LINE identities, and suspended companies before AI Gateway or ERP tool calls.
- [ ] Handle unlinked user with account-link/invite-required reply.
- [ ] Handle ambiguous company context with safe company-selection guidance.
- [ ] Create/find AI conversation.
- [ ] Forward request to AI Gateway internal endpoint using service-to-service auth or existing internal auth pattern.
- [ ] Include only server-derived context in AI Gateway request.
- [ ] Do not include raw LINE secrets, signature, tokens, or auth headers.
- [ ] Record webhook processing status and errors.

### Tests

- Integration test: invalid signature rejects and AI Gateway client is not called.
- Integration test: unsupported event is ignored safely.
- Integration test: unlinked LINE user receives link-required response and no business tool calls.
- Integration test: linked user request calls AI Gateway with server-derived context.
- Integration test: ambiguous multi-company context does not accept typed company id as authorization.
- Integration test: inactive membership rejects before AI Gateway/ERP tool calls and sends no business data.

### Exit Criteria

- LINE ingress is signature-verified, idempotent where possible, and context-safe.
- Unlinked and ambiguous users do not leak data.
- AI Gateway receives no user-forged auth context.

## Phase 4: AI Gateway Orchestration

### Goal

Process one LINE AI turn with read-only tool policy and safe answer composition.

### Tasks

- [ ] Add `POST /internal/ai/line-turn` or extend existing AI Gateway chat endpoint with a LINE-specific internal contract.
- [ ] Protect endpoint with existing internal service auth pattern.
- [ ] Validate server-derived context payload.
- [ ] Add `LineAiTurnUseCase`.
- [ ] Add intent/router logic:
  - read-summary
  - read-detail
  - unsupported module
  - forbidden
  - mutation request
- [ ] Add agent selection for `general`, `inventory`, and `notifications`.
- [ ] Add deterministic fallback answer composer if AI provider config is absent.
- [ ] Add AI provider port only if config/provider conventions already exist or are added safely.
- [ ] Add timeout/error handling around classifier/provider/tool calls.
- [ ] Add tool registry and per-tool metadata:
  - name
  - category
  - required permission keys
  - source module
  - supported agents
  - sensitivity/audit flag
- [ ] Enforce LINE item 07 category allowlist.
- [ ] Return `LineAiTurnResponse` with reply text, source refs, web links, refusal state, and error state.

### Tests

- Unit test: mutation request is refused without tool calls.
- Unit test: unsupported module returns module-not-ready answer.
- Unit test: non-allowlisted tool cannot be called.
- Unit test: provider timeout returns safe fallback.
- Integration test: AI Gateway rejects missing/invalid internal auth.

### Exit Criteria

- AI Gateway can complete one read-only LINE turn.
- Tool policy blocks draft/approval/final mutation categories.
- AI provider absence does not block deterministic first-slice behavior.

## Phase 5: ERP Read Tool Adapters

### Goal

Expose implemented source data to AI Gateway through permission-checked read tools.

### Tasks

- [ ] Create ERP read tool port/interface if no current convention exists.
- [ ] Add `company.get_current_context`.
- [ ] Add `dashboard.get_business_health_summary` using item 06 dashboard snapshot/source provider.
- [ ] Add `notifications.list_open_alerts` using item 06 notification query behavior.
- [ ] Add `notifications.get_daily_summary` using item 06 deterministic summary where available.
- [ ] Add `inventory.search_products` using item 05 inventory query behavior.
- [ ] Add `inventory.get_stock_balance` using item 05 stock balance query behavior.
- [ ] Add `inventory.list_low_stock` using item 05 low-stock logic or item 06 alert/source behavior.
- [ ] Add `inventory.summarize_stock_movements` using item 05 movement query behavior.
- [ ] Re-check permissions and ABAC in each tool.
- [ ] Return scoped summaries, source refs, `asOf`, stale/unavailable flags, and safe web paths.
- [ ] Return unsupported-module result for later modules if router receives those intents.
- [ ] Add audit append for sensitive read tool calls according to permission matrix.
- [ ] Do not expose raw database rows, internal-only ids, hidden counts, or forbidden record existence.

### Tests

- Unit/use-case tests for each implemented tool.
- Permission tests for allowed and forbidden roles.
- ABAC/location-scope tests for inventory tools where item 05 scope exists.
- Test that unsupported modules return unsupported status, not fake data.
- Test that source refs include `permissionChecked: true`.

### Exit Criteria

- At least one dashboard/notification or inventory read question can be answered end to end if item 05/06 data exists.
- Every read tool repeats server-side permission checks.
- Tool outputs are source-aware and safe for LINE answer composition.

## Phase 6: Source Refs, Deep Links, and Answer Formatting

### Goal

Make LINE answers useful without turning LINE into a full workspace.

### Tasks

- [ ] Add source ref mapper for dashboard snapshots, notification events, products, stock balances, stock movements, and company context.
- [ ] Add route/deep-link builder using item 03 web route conventions when available.
- [ ] Add fallback link labels when a source has no detail page yet.
- [ ] Add Thai-first answer templates:
  - direct answer
  - low stock
  - stock balance
  - recent stock movement
  - open alerts
  - daily summary
  - forbidden
  - unsupported module
  - mutation blocked
  - stale/unavailable data
- [ ] Include `asOf` or source freshness when relevant.
- [ ] Keep messages concise for LINE.
- [ ] Add web link only when detail/action belongs in web.
- [x] Render every completed LINE answer through the shared Mangmee Flex-card composer, including deterministic receipt/correction/reference replies and structured-presentation fallbacks.
- [x] Convert safe tenant links to Flex URI buttons and omit their raw URLs from the visible card body.
- [x] Attach the existing permission-filtered staff Quick Reply menu to completed turns only, capped at 13 actions.
- [ ] Ensure web route guards re-check permission when link opens. If no route exists yet, answer should avoid dead action links and use available dashboard route.

### Tests

- Unit tests for source ref to link mapping.
- Unit tests for Thai answer templates.
- Unit tests for stale/unavailable data wording.
- Unit tests for forbidden answer not leaking hidden record existence.
- Unit tests for Flex fallback, raw-link removal, safe URI buttons, Quick Reply permission filtering/cap, and no completion menu on clarification prompts.

### Exit Criteria

- Answers have useful source labels and safe web links.
- Unsupported/forbidden/mutation answers are clear and non-leaky.
- Deep links are generated by trusted code, not by free-form AI output.

## Phase 7: LINE Reply Delivery and Failure Handling

### Goal

Reply to LINE reliably and handle platform/service failures without duplicate unsafe behavior.

### Tasks

- [ ] Reuse item 06 LINE delivery adapter if it supports reply messages safely.
- [ ] Add LINE reply adapter port if only push delivery exists.
- [ ] Keep Messaging API channel config in `packages/config` or existing config module.
- [ ] Do not log access tokens or authorization headers.
- [ ] Reply to:
  - normal AI answer
  - unlinked account guidance
  - ambiguous company guidance
  - forbidden/unsupported/mutation refusal
  - temporary service failure
- [ ] Handle AI Gateway timeout with safe fallback message.
- [ ] Handle LINE reply failure with status logging and retry decision. Do not blindly retry replies if platform semantics make duplicate replies likely.
- [ ] If existing worker/outbox supports safe follow-up delivery, use it only for explicitly queued safe messages.
- [ ] Add delivery status linkage to `LineDelivery` or item-07 delivery log if existing schema allows it.

### Tests

- Unit test: reply adapter redacts auth headers in errors.
- Integration test: AI Gateway timeout returns safe fallback.
- Integration test: LINE delivery failure records failed status without leaking secrets.
- Test duplicate event does not send duplicate reply when idempotency can prevent it.

### Exit Criteria

- LINE users receive correct response for success and major error states.
- Delivery failure is visible to logs/audit without secret leakage.
- Retry/idempotency behavior is explicit.

## Phase 8: Security, Permission, and Abuse Hardening

### Goal

Close high-risk bypasses before item 07 can be marked complete.

### Tasks

- [ ] Add deny-by-default tests for AI Gateway internal endpoint.
- [ ] Add tests proving invalid LINE signature blocks processing.
- [ ] Add tests proving unlinked users cannot call tools.
- [ ] Add tests proving inactive/removed memberships cannot call tools, upload evidence, or use cached company context.
- [ ] Add tests proving removed company membership blocks old LINE conversation context.
- [ ] Add tests proving user-supplied company id is ignored as authorization.
- [ ] Add tests proving forbidden inventory/dashboard/notification data does not leak.
- [ ] Add tests proving final mutation requests from LINE are refused.
- [ ] Add tests proving final mutation tool categories are blocked even if router tries to call them.
- [ ] Add redaction tests for LINE signature, channel access token, authorization header, id token, JWT, and service token.
- [ ] Add rate-limit or abuse-control hook if platform/security modules already expose one. If not, document follow-up.
- [ ] Review production config requirements for LINE channel secret, Messaging API token, AI Gateway internal auth, redaction, audit, and provider config.

### Tests

- Root/package typecheck.
- API tests for webhook/auth/context.
- AI Gateway tests for policy/router/tool calls.
- Contracts typecheck.
- Config validation tests if config package supports them.
- Security/redaction tests.

### Exit Criteria

- Main LINE/AI permission bypasses are covered by tests.
- Unsafe config paths fail or are documented as blockers.
- Security checklist items relevant to LINE and AI Gateway are satisfied.

## Phase 9: End-to-End Verification and Docs

### Goal

Verify item 07 as a user-visible read-only LINE assistant slice and update handoff docs without marking implementation complete prematurely.

### Tasks

- [ ] Run available verification commands:
  - `pnpm typecheck`
  - `pnpm test`
  - package-specific tests for `@watchdog-bms/api`
  - package-specific tests for `@watchdog-bms/ai-gateway`
  - package-specific tests for `@watchdog-bms/contracts`
  - lint/build commands touched by implementation
- [ ] Run local smoke path with a signed or test-mode LINE webhook payload if local tooling supports it.
- [ ] When tunnel exists, run the real local tunnel path:
  - verify local DB has `LineCompanyContext`; if missing, apply migration `20260626000004_item10a_shared_line_credential_and_line_company_context` before testing
  - open tunnel-hosted `/v1/auth/line/link-page` from LINE client or mobile browser
  - verify the LIFF response has no executable inline script, `script-src` has no `'unsafe-inline'`, and a `</script>` query payload neither executes nor appears in any subresource URL/referrer
  - scan user-facing account-link QR as `https://liff.line.me/<LINE_LIFF_ID>`, not raw tunnel URL
  - confirm password-change completion can continue to web dashboard
  - add the shared LINE OA
  - complete account linking through LINE Login/LIFF
  - verify `ExternalIdentity` has the real LINE `providerUserId`, not only seed/dev identity
  - verify `LineCompanyContext` contains the selected company id and updates when the same OWNER links from a different selected company
  - send a LINE message and confirm API receives the signed webhook
  - verify `LineWebhookEventLog.companyId` equals the selected company id for the latest message
  - verify linked active user reaches AI Gateway with server-derived context
  - verify inactive/removed membership fails before AI Gateway/ERP tool calls
- [ ] Verify invalid signature path.
- [ ] Verify unlinked user path.
- [ ] Verify linked user allowed stock/dashboard/alert question.
- [ ] Verify forbidden user path.
- [ ] Verify mutation-refusal path.
- [ ] Verify web deep link opens with permission re-check.
- [ ] Record exact commands and results in implementation notes or PR body.
- [ ] Update docs if implementation deviates from this plan with owner-approved reason.
- [ ] Keep Master Implementation Checklist item 07 unchecked until all phases and verification pass.
- [ ] After implementation and verification pass, update item 07 docs readiness/completion status according to repo convention.

### Tests

- Full verification commands above.

### Exit Criteria

- LINE AI read-only assistant works for at least one implemented business-data question.
- Invalid/unlinked/forbidden/mutation cases are safe.
- Source refs and web links work.
- Tests and verification commands are recorded.

## Review Checklist

- [ ] LINE webhook verifies signature before processing.
- [ ] Raw body support works for signature verification.
- [ ] Unlinked users see no business data.
- [ ] Multi-company context is server-verified.
- [ ] AI Gateway has no direct DB/source repository access.
- [ ] Tool registry blocks non-read categories for LINE item 07.
- [ ] ERP tools repeat permission and ABAC checks.
- [ ] Source refs are included for stock/dashboard/alert answers.
- [ ] Deep links re-check permission in web.
- [ ] Mutation requests are refused.
- [ ] Sensitive tool calls are audited.
- [ ] Logs and persisted rows redact secrets/tokens/signatures.
- [ ] Duplicate webhook handling is explicit.
- [ ] Unsupported modules do not return fake data.
- [ ] Verification commands are recorded.

## Handoff Prompt for Sonnet 4.6

Use this prompt when handing item 07 to Sonnet 4.6:

```text
Implement Master Implementation Checklist item 07: LINE AI Read-Only Assistant.

Read these first:
- docs/plans/master-implementation-checklist.md
- docs/specs/line-ai-read-only-assistant-spec.md
- docs/plans/line-ai-read-only-assistant-plan.md
- docs/specs/line-ai-channel-auth-spec.md
- docs/specs/line-ai-assistant-ux-spec.md
- docs/specs/ai-gateway-agents-spec.md
- docs/specs/permission-matrix.md
- docs/specs/auth-authorization-rbac-spec.md
- docs/specs/dashboard-notification-spec.md
- docs/specs/inventory-mvp-spec.md
- docs/guidelines/backend-hexagonal-code-style.md
- docs/guidelines/security-implementation-guideline.md

Start with Phase 0 and Phase 1 only unless owner explicitly expands scope.
Reuse current repo conventions and prior checklist outputs.
Do not duplicate tenant/auth/audit/outbox/LINE/dashboard/notification/inventory primitives.
Keep LINE AI read-only except explicitly allowlisted source-owned draft/pending-ticket intake.
AI Gateway cannot bypass ERP permission-checked read tools.
No final money, stock, tax, accounting, approval, permission, export, or external publishing mutation from LINE.
Record verification commands and keep checklist item 07 unchecked until every phase passes.
```
