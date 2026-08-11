# LINE AI Read-Only Assistant Spec

## 1. Status

Implemented and verified on 2026-06-25. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 07.

Owner follow-up 2026-07-15: item 07 remains the implemented safe read-assistant foundation. System-wide business-question completeness, subject-safe tool routing, and structured clarification continuity are the open item 10G scope in [[specs/line-ai-business-query-coverage-spec|LINE AI Business Query Coverage Spec]] and [[plans/line-ai-business-query-coverage-plan|its implementation plan]].

Active implementer target: Sonnet 4.6 or later.

## 2. Goal

Implement the first production-safe LINE AI assistant slice for WatchDog-BMS.

Users can ask natural-language questions in LINE and receive concise, permission-aware answers derived from implemented WatchDog-BMS source data. Answers must include source references or web deep links when useful, and must never perform final money, stock, tax, accounting, approval, permission, export, or external publishing mutations from LINE.

The assistant uses:

- LINE Official Account webhook as the chat ingress.
- Existing LINE account linking and channel trust from item 02.
- AI Gateway as the orchestration boundary.
- ERP Core read tools as the only path to source data.
- Web deep links for full detail, review, and action.

Item 07 remains final-mutation blocked. Owner update on 2026-06-25 allows this phase to include read/report/suggestion workflows plus narrow accounting evidence capture from uploaded slips/receipts. Later source-module specs may add equally narrow intake actions, such as item 20 own leave-request intake, only when they create pending review/approval-ticket records with provenance and keep final approval/action in web. Capture/intake may update draft, capture, or pending-ticket records with provenance, but still blocks final confirmation, approval, payment, void, export, posting, period close, stock final mutation, permission change, and external publishing from LINE or web AI chat.

## 3. Non-goals

- Replacing the web workspace for create, edit, approve, post, file, export, setup, or audit workflows, except explicitly allowlisted source-owned intake flows that create only draft/pending-ticket records.
- Implementing final actions from LINE chat or web AI chat.
- Implementing AI approval workflows from item 17. Sales suggestions are allowed in this phase when they only recommend follow-up and cite source data.
- Implementing marketing content generation from item 23.
- Implementing accounting documents, ledger reports, tax reports, procurement, bank reconciliation, CRM, payroll, fixed assets, manufacturing, or marketplace data before those roadmap items exist.
- Auto-sending marketing campaigns, LINE broadcasts, offers, or commitments to customers.
- Letting AI Gateway read the database directly.
- Letting LINE user-submitted company id, role, permission, approval state, branch scope, location scope, price, tax, or stock quantity override server context.
- Treating AI output as accountant, tax, legal, or audit certification.
- Building a full web AI chat panel unless it already exists and can reuse the same read-only contract safely.

## 4. User Roles

- Owner: asks for business health, open alerts, low stock, daily summary, and what needs attention.
- Admin: checks system/channel/account-link status and allowed company summaries.
- Manager: asks for team-level alerts, dashboard summaries, and status where ABAC allows.
- Inventory staff: asks for product, location, stock balance, low-stock, and stock movement summaries within allowed location scope.
- Finance/accountant: asks only for implemented finance/accounting summaries; before item 08 and item 10, unsupported finance questions must say the module is not ready.
- Sales/CRM/Marketing users: receive a clear unsupported-module answer until later roadmap items add read tools.
- Auditor readonly: asks read-only summary/detail questions within audit/report permission scope.
- Unlinked LINE user: receives account-link/invite-required guidance and no business data.

## 5. Boundary and Ownership

LINE/Auth item 02 owns:

- LINE Login validation.
- LINE Messaging webhook signature verifier.
- `ExternalIdentity` and LINE user mapping.
- Company membership, role, permission, and request context.
- First-party session/JWT behavior for LIFF/web deep links.

Dashboard/Notification item 06 owns:

- Dashboard snapshots.
- Notification events, preferences, delivery rows, and LINE push delivery.
- Daily summary and alert delivery primitives.

LINE AI Read-Only Assistant item 07 owns:

- LINE message webhook routing into AI Gateway.
- AI conversation/turn records for LINE chat.
- Read-only agent/tool policy for LINE.
- AI Gateway orchestration for one user turn.
- Permission-checked ERP read tool registry.
- Thai-first concise answer format for LINE.
- Source references and web deep links in AI answers.
- Refusal behavior for unsupported, forbidden, or mutation requests.

ERP source modules own:

- Read APIs/use cases for their own records.
- Permission and ABAC checks for every tool call.
- Source object references and deep-link targets.
- Audit payloads for sensitive read tool calls.

Web owns:

- Detail/action routes opened from LINE links.
- Re-checking current permission and record state when deep links open.
- Final user actions and confirmations.

AI Gateway owns no ERP source-of-truth data and must not import API Prisma clients or source-module repositories.

## 6. Current Repository Baseline

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with matching health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with `app/layout.tsx`, `app/page.tsx`, and global CSS only in the current snapshot.
- `packages/contracts`: shared contract package with thin `HealthStatus` and `TenantContext` exports.
- `packages/config`: shared config package exists and is currently thin.
- No Prisma schema exists in this snapshot.
- Items 01 through 06 may add Prisma, auth, audit, outbox, request context, branch/location scope, web workspace routes, inventory APIs, dashboard/notification APIs, LINE bindings, worker conventions, and shared contracts before item 07 starts.

Before implementation, inspect latest code again. Extend existing primitives. Do not duplicate tenant, auth, audit, outbox, LINE binding, dashboard, notification, inventory, worker, web-shell, config, or contract code.

## 7. Linked Plan and References

- Plan: [[plans/line-ai-read-only-assistant-plan|LINE AI Read-Only Assistant Plan]]
- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 07.
- LINE channel/auth: [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
- LINE UX: [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
- AI Gateway: [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Dashboard/notification: [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
- Inventory: [[specs/inventory-mvp-spec|Inventory MVP Spec]]
- Web shell/deep links: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Runtime config: [[specs/platform-environment-config-spec|Platform Environment Config]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]
- LINE access ADR: [[adr/0008-line-ai-access-and-auth|ADR 0008 LINE AI Access and Authentication]]

## 8. Product Decisions

- LINE is the daily AI assistant and alert channel, not the full Business OS.
- Thai (`th-TH`) is the default answer language for LINE. English can be used when the user asks in English.
- The first assistant is read/report/suggest/capture-only.
- Later source modules may allow a narrow `approval_request`/intake flow only when the source-module spec explicitly permits it, the request is permission-checked in ERP Core, and the result is a pending web review ticket rather than approval/final mutation.
- Accounting capture is allowed only from user-uploaded slips/receipts/PDF evidence and must preserve original file, extracted fields, confidence, user, timestamp, and audit metadata.
- Capture can create/update draft or evidence records only when source module permissions allow it; final payment/posting/approval remains blocked.
- Final business mutations from LINE are blocked.
- AI Gateway can call only allowlisted tools.
- Every tool call uses server-derived `userId`, `companyId`, roles, permission grants, branch/location scope, and request context.
- ERP Core enforces permissions on every read tool call. AI Gateway policy checks are additional guardrails only.
- The assistant must answer from implemented modules only.
- Before source modules exist, finance, accounting, tax, sales, and CRM questions that need those modules should receive an honest "not available yet" answer plus any available dashboard/notification context.
- Inventory and dashboard/notification are the first expected business read sources after items 05 and 06.
- Source references are required for finance, tax, stock, CRM, customer, and audit-like answers.
- Web deep links must be generated by backend/server code from known route contracts, not copied blindly from AI output.
- Conversation retention must be configurable. Item 07 stores message preview plus hash by default, not full user message text.
- Unknown or unlinked LINE users receive account-link/invite-required guidance and no business data.
- Normal employee users may have only one active company membership. OWNER users may belong to multiple companies and must use a server-verified active company context. If an OWNER context is ambiguous, send the user to a LIFF/web company selector or LINE context command list.
- LINE company context commands are control-plane commands, not AI intent classification: `/companies`, `/company`, or the exact natural-language request `เปลี่ยนบริษัท` lists active OWNER-accessible companies, and `/company <number-or-companyId>` switches `LineCompanyContext` only after active membership and OWNER checks pass.
- A company picker creates a short-lived server-side pending-selection state. The immediately following reply may be a bare displayed number (including Thai digits) and must be mapped deterministically to that picker before the same active membership and OWNER checks run. A bare number without that pending state is ordinary conversation text and never switches company.
- Inactive or removed company membership fails closed: no AI Gateway call, no ERP tool call, no source refs, no upload/capture, and no business data in LINE replies.
- Item 07 starts with deterministic classifier and answer composer. LLM provider integration can be added later behind a port after read tools, source refs, audit, and refusal behavior are stable.
- First LINE rich menu for item 07 should expose `Ask AI`, `Open Alerts`, and `Link Account`. `Daily Summary` can reuse item 06 behavior if already enabled, but item 07 should not build a new daily-summary workflow.

## 9. First Read Tool Scope

The first implementation should expose read tools only for modules that exist when item 07 starts.

Minimum expected tools if items 05 and 06 are complete:

```text
company.get_current_context
dashboard.get_business_health_summary
notifications.list_open_alerts
notifications.get_daily_summary
inventory.search_products
inventory.get_stock_balance
inventory.list_low_stock
inventory.summarize_stock_movements
```

Tool behavior:

- `company.get_current_context`: returns display-safe company/user/context info for answer framing.
- `dashboard.get_business_health_summary`: returns latest dashboard snapshot widgets user can read.
- `notifications.list_open_alerts`: returns active alerts user can access, sorted by severity/time.
- `notifications.get_daily_summary`: returns deterministic daily summary from item 06 when available.
- `inventory.search_products`: searches active/archived products user can read.
- `inventory.get_stock_balance`: returns product/location balance within permission and location scope.
- `inventory.list_low_stock`: returns products where `balance <= reorderPoint` when reorder point exists.
- `inventory.summarize_stock_movements`: returns recent movement summary and source links within allowed scope.

Later roadmap items can add tools without changing the LINE assistant boundary:

```text
accounting.list_overdue_invoices
accounting.get_receivable_summary
ledger.get_profit_and_loss_summary
tax.get_upcoming_tax_obligations
crm.list_follow_up_priorities
procurement.get_payable_summary
bank.get_cash_position
```

Do not add stub tools that return fake numbers. If a source module is absent, return an unsupported-module result.

Current phase extra tool categories:

```text
report
suggestion
evidence_capture
```

Current phase extra tools when source modules exist:

```text
sales.get_sales_summary
crm.suggest_sales_followups
accounting.capture_receipt_evidence
```

`sales.get_sales_summary` first production slice reads only recorded customer receipts (`AccountingPayment.direction=RECEIVED`, `status=RECORDED`) for a Bangkok-time period, grouped by currency and constrained by the caller's branch scope. Replies must label this basis as cash actually received, not booked/accrual revenue. The API repeats the `crm.report.read` permission check and returns source refs to CRM reports.

Evidence-capture tools are not final mutation tools. They must be permission-checked in ERP Core, retain uploaded evidence provenance, and ask for user correction when extracted amount/date/vendor/customer/reference confidence is low.

## 10. Core Workflows

### Ask AI from linked LINE account

1. User sends a LINE text message or taps an Ask AI rich-menu shortcut.
2. `apps/api` receives `POST /v1/line/webhook`.
3. API verifies LINE signature using the raw request body before trusting the event.
4. API deduplicates webhook event id when the platform provides one.
5. API maps LINE user id and channel id to internal `ExternalIdentity`, user, active company context, membership, roles, permission grants, and ABAC scope. Identity fallback: when the channel-scoped lookup misses, fall back to any ACTIVE LINE identity for that `providerUserId` and log the fallback distinctly, so identities linked before `providerChannelId` was recorded still resolve without relinking (same behavior as the notification delivery path).
6. API rejects or returns link-required guidance for unknown/unlinked users.
7. API creates or finds a LINE AI conversation.
8. API forwards a server-signed internal request to AI Gateway with server-derived context and sanitized user message.
9. AI Gateway classifies intent as read-summary, read-detail, unsupported, forbidden, or mutation-request.
10. AI Gateway chooses allowlisted read tools only.
11. ERP Core read tools repeat permission and ABAC checks and return scoped result summaries plus source references.
12. AI Gateway formats a short answer with uncertainty, source refs, and web links.
13. API replies to LINE using the current LINE adapter.
14. AI turn, source refs, tool calls, and sensitive-read audit events are recorded according to retention config.

### Unlinked LINE account

1. LINE webhook signature is valid.
2. API cannot map LINE user id to active internal user/company membership.
3. API does not call business read tools.
4. LINE reply says account linking or invite is required.
5. Reply includes LIFF/web account-link URL if current config and invite policy allow it.
6. Audit records unknown LINE access attempt without storing secrets.

### Inactive or removed company membership

1. LINE webhook signature is valid and LINE user maps to an internal user.
2. API finds that the selected or only company membership is inactive, removed, or no longer grants `line.ai.query`.
3. API ignores cached `LineCompanyContext` and does not call AI Gateway or ERP tools.
4. LINE reply says the account no longer has access to this company and should contact Owner/Admin.
5. Audit records denied access with user, company where known, reason, and webhook event id without storing raw LINE secrets.

### Owner multi-company user

1. API resolves more than one active company membership for the linked LINE user.
2. API verifies the linked user has an active `OWNER` membership for the selected company. Non-owner multi-company membership is a policy violation and no business tools are called.
3. If a recent verified conversation context exists, use it only if membership is still active.
4. If ambiguous, reply with an ordered accessible-company picker and exact command guidance: `/companies` or `เปลี่ยนบริษัท` to list and `/company <number-or-companyId>` to switch.
5. While that picker is the immediately preceding LINE turn and is at most 15 minutes old, accept a bare displayed number as selector input. Invalid numbers re-display the picker so the next reply can retry; any unrelated intervening turn or timeout ends the pending selection.
6. Do not accept a raw company id or bare number as authorization by itself; every selector input must be rechecked against active OWNER membership before writing `LineCompanyContext`.
7. Natural-language business questions never switch company context. AI routing starts only after server-side company context is resolved.

### Re-link same LINE account to a newly selected company

1. User may scan the same shared LINE OA and see old LINE chat history. This is expected LINE behavior and does not prove company context.
2. Account-link flow must verify LINE Login id token, resolve current WatchDog user session, and create or confirm `ExternalIdentity`.
3. Account-link flow must resolve the current selected WatchDog company from the web/session route or explicit selector.
4. If the current user is OWNER for the selected company, account-link flow upserts `LineCompanyContext(lineUserId -> companyId)`.
5. If the same LINE identity is already linked to the same WatchDog user, the flow must refresh `LineCompanyContext` and return success instead of blocking with conflict.
6. If the LINE identity is linked to another WatchDog user, the flow must fail closed and audit.
7. After relink, the next LINE message must use the new `LineCompanyContext.companyId`; old LINE chat messages or old AI conversation state must not select company.
8. Verification requires rows in `ExternalIdentity`, `LineCompanyContext`, and `LineWebhookEventLog` after real LIFF link plus LINE message.

### Forbidden or out-of-scope question

1. AI Gateway detects requested data outside permission or unsupported module.
2. It does not call tools that the user cannot use.
3. LINE answer clearly says the user does not have access or the module is not ready.
4. If appropriate, include a web link to request access or view allowed dashboard data.

### Mutation request from LINE

1. User asks LINE to approve, transfer stock, post accounting, issue invoice, file tax, export, change permission, or publish externally.
2. AI Gateway classifies request as mutation-request.
3. AI Gateway refuses final mutation.
4. LINE answer explains that final action must happen in web and gives a relevant deep link when available.
5. Sensitive attempted mutation is audited if policy marks it sensitive.

## 11. Answer Format

Default LINE answer shape is a Mangmee-themed Flex bubble (or carousel when a turn contains multiple completed answers):

```text
Header: <short answer title>
Body: <direct answer in 1-3 short Thai bullets or lines>
Source: <short source labels>
Footer: <safe tenant web-link buttons when useful>
Quick Reply: <permission-filtered staff menu after a completed turn>

```

Rules:

- Keep answers concise enough for LINE chat.
- Use a Flex card for completed business, capture, correction, refusal, and reference answers. A missing structured AI presentation must fall back to a generic Flex card rather than visible plain text.
- Render safe tenant web links as URI buttons and remove the corresponding raw URL from the visible card body.
- Restore the existing permission-filtered staff Quick Reply menu after a completed turn, capped at 13 LINE actions. Do not attach it to a clarification or media prompt that is still waiting for input.
- Put exception/risk first.
- Include numbers only when returned by trusted tools.
- Include `asOf` or period when source data is time-based.
- State uncertainty when data is missing, stale, partial, or module unavailable.
- Use source labels users understand, such as product SKU, alert title, dashboard snapshot time, or movement number.
- Do not expose internal ids unless needed for support.
- Do not reveal hidden records by saying exact counts outside permission scope.
- Do not ask the user to confirm final actions in LINE for item 07.

## 12. Source References and Deep Links

Each tool result can return source refs:

```text
SourceRef
- sourceType: dashboard_snapshot | notification_event | product | stock_balance | stock_movement | company | unsupported
- sourceId
- sourceLabel
- module
- permissionChecked: true
- asOf nullable
- webPath nullable
```

Deep-link rules:

- Generate links server-side from known route contracts.
- Include company route context when current web routing requires it.
- Re-check permission and current record state when opened.
- Never perform final mutation by opening a link.
- Expired or forbidden links show a web forbidden/not-found state, not raw errors.

## 13. Shared Contracts

Add or extend shared contracts under `packages/contracts/src`.

Recommended files:

```text
packages/contracts/src/line-ai.ts
packages/contracts/src/ai-tools.ts
packages/contracts/src/index.ts
```

Minimum exported types:

```ts
export type LineAiAgent =
  | 'general'
  | 'cfo'
  | 'inventory'
  | 'notifications'
  | 'sales'
  | 'crm'
  | 'tax'
  | 'marketing';

export type AiToolCategory =
  | 'read_summary'
  | 'read_detail'
  | 'draft_create'
  | 'approval_request'
  | 'final_mutation';

export type AiToolResultStatus =
  | 'ok'
  | 'empty'
  | 'forbidden'
  | 'unsupported'
  | 'stale'
  | 'error';

export type AiSourceRef = {
  sourceType: string;
  sourceId?: string;
  sourceLabel: string;
  module: string;
  permissionChecked: true;
  asOf?: string;
  webPath?: string;
};

export type AiReadToolResult<TSummary = unknown> = {
  status: AiToolResultStatus;
  summary?: TSummary;
  sources: AiSourceRef[];
  asOf?: string;
  message?: string;
};

export type LineAiTurnRequest = {
  conversationId?: string;
  messageText: string;
  conversationContext?: {
    windowMinutes: 15;
    maxTurns: 15;
    lastTurnAt?: string;
    recentTurns: Array<{
      at: string;
      userMessagePreview?: string;
      assistantReplyPreview?: string;
      intent?: string;
      agent?: string;
      refused?: boolean;
    }>;
  };
  preferredAgent?: LineAiAgent;
  locale: 'th-TH' | 'en-US';
};

export type LineAiTurnResponse = {
  conversationId: string;
  replyText: string;
  sources: AiSourceRef[];
  webLinks: Array<{ label: string; path: string }>;
  refused: boolean;
  refusalReason?: string;
};
```

Keep internal service auth, LINE signatures, raw LINE payloads, tokens, full audit payloads, and raw tool internals out of public contracts.

`conversationContext` is short-term LINE chat context only. It is bounded to the previous 16 `AiTurn` rows within 15 active minutes for the same company/user and is sent only after current `line.ai.query` permission is confirmed. It may help resolve follow-up wording, but it must not select company, authorize access, or serve as source-of-truth business data. Long-lived company selection remains `LineCompanyContext`.

## 14. Data Model Draft

Reuse item 02 models where they exist:

```text
ExternalIdentity
PlatformLineChannel
LineCompanyContext
LineChannelBinding (legacy/company-specific only; do not use for WatchDog shared OA company resolution)
LineConversation
LineDelivery
AuditLog
OutboxEvent
CompanyMembership
```

Add item-07-specific records only when missing:

```text
AiConversation
- id
- companyId
- userId
- channel: LINE | WEB
- lineUserId nullable
- activeAgent
- locale
- status
- lastTurnAt
- createdAt
- updatedAt

AiTurn
- id
- conversationId
- companyId
- userId
- channel
- provider nullable
- model nullable
- userMessagePreview
- userMessageHash
- replyPreview
- tool invocation relation used to decide whether a previous assistant `replyPreview` may be reused in short-term context under the current permission set
- refused
- refusalReason nullable
- sourceRefsJson
- startedAt
- completedAt nullable
- errorCode nullable

AiToolInvocation
- id
- aiTurnId
- companyId
- userId
- toolName
- toolCategory
- inputHash
- status
- sourceRefsJson
- durationMs nullable
- errorCode nullable
- createdAt

LineWebhookEventLog
- id
- lineChannelId
- webhookEventId nullable
- lineUserIdHash nullable
- signatureStatus
- eventType
- processingStatus
- receivedAt
- processedAt nullable
- errorCode nullable
```

Retention/logging rules:

- Store message preview plus hash by default.
- Store full user message only after an explicit retention policy allows it. Dev/test-only full logs are allowed only when redaction is active and data is non-production.
- Never store raw LINE access tokens, channel secrets, signatures, or first-party JWTs.
- Redact logs before they leave the process.

## 15. API Behavior

### Public LINE webhook

```text
POST /v1/line/webhook
```

Behavior:

- Public route, but protected by LINE signature verification.
- Reads raw request body for signature verification.
- Rejects invalid signature with `401` or `403`.
- Deduplicates event id where available.
- Handles text messages and supported postback/rich-menu payloads.
- Ignores unsupported event types safely.
- Maps LINE identity to server context before any AI/tool call.
- Replies with account-link guidance for unlinked users.
- For linked users, calls AI Gateway internal turn endpoint.

Local tunnel behavior:

- Real LINE OA and LIFF testing must use the active HTTPS tunnel URL, not `localhost`.
- The LINE developer webhook URL points to `<tunnel>/v1/line/webhook`.
- LINE Developers LIFF endpoint URL points to the tunnel-hosted `/v1/auth/line/link-page` so LINE webview, LIFF, and API calls share the public origin.
- LIFF pages must use a same-origin external client script; query values must never be interpolated into executable script. Their CSP `script-src` must exclude `'unsafe-inline'`, responses use `Referrer-Policy: no-referrer` plus `Cache-Control: no-store`, and credential-bearing fetches must remain same-origin.
- Employee link tokens are exactly 32 base64url characters and are removed from the visible URL after LIFF login initializes; LINE ID tokens, channel ids, and company ids are format/length bounded again at the API boundary before provider or repository work.
- Account-link QR/short link shown to users should point to the LIFF URL `https://liff.line.me/<LINE_LIFF_ID>`, not the raw tunnel endpoint.
- After password change, the success screen must show a scannable QR code and copyable short link for the shared LINE OA add URL when configured.
- The same success screen must show a scannable QR code and copyable short link for account linking. The account-link URL comes from `LINE_ACCOUNT_LINK_URL` when configured, otherwise from `https://liff.line.me/<LINE_LIFF_ID>` when LIFF id exists, then `NEXT_PUBLIC_API_BASE_URL + /auth/line/link-page`.
- Local DB must contain the `LineCompanyContext` table before real multi-company LINE testing. If the table is absent, account linking cannot persist selected-company context and tests must stop until migration `20260626000004_item10a_shared_line_credential_and_line_company_context` is applied.
- The web dashboard can be used immediately after password change; LINE AI remains unavailable until the same user adds the shared LINE OA and completes the tunnel-hosted account-link flow.
- A successful linked-user tunnel smoke must prove invalid signatures fail, unlinked users see no business data, linked active members reach AI Gateway with server-derived context, and inactive/removed memberships fail closed.

### Internal AI Gateway turn endpoint

```text
POST /internal/ai/line-turn
```

Behavior:

- Accepts only trusted API service requests using existing internal auth/service token pattern.
- Rejects user-supplied context that is not signed/server-derived.
- Runs intent classification, tool policy, tool calls, answer composition, and source ref formatting.
- Returns reply text and source refs to API for LINE delivery.

### Internal ERP read tool endpoint or port

```text
POST /internal/ai-tools/:toolName
```

Behavior:

- Accepts only AI Gateway/API internal service requests using existing internal auth pattern.
- Requires server-derived user/company/request context.
- Re-checks permissions and ABAC.
- Calls source module application services or query ports.
- Returns scoped summaries and source refs, not unrestricted rows.

If the repo already has a safer in-process module port or internal API convention, use that convention. Keep the same boundary: AI Gateway cannot bypass ERP permission-checked read use cases.

## 16. Security and Compliance Rules

- Verify LINE signature before trusting webhook payload fields.
- Use raw body for signature verification.
- Never log raw secrets, signatures, access tokens, id tokens, authorization headers, or first-party session/JWT values.
- Unknown or unlinked LINE users never see business data.
- Inactive users, removed/inactive memberships, suspended companies, and disabled LINE identities never see business data.
- Server derives user, company, membership, role, permission, and ABAC scope.
- Deny tool access by default.
- AI Gateway allowlists tools per role/permission/tool category.
- ERP Core re-checks permission for every read tool call.
- Final mutation tools are blocked for LINE item 07.
- Sensitive read tool calls are audited with user, company, tool, input hash, source refs, and timestamp.
- The assistant must not reveal whether forbidden records exist.
- Deep links must re-check current permission and record state.
- Production startup must fail if required LINE, internal service auth, AI Gateway, redaction, audit, or runtime config is unsafe according to platform config rules.

## 17. Edge Cases

- Invalid LINE signature.
- Duplicate webhook delivery.
- Unsupported LINE event type.
- Unlinked LINE user.
- Linked user removed from company after prior conversation.
- Linked user belongs to multiple companies.
- User asks for forbidden finance/customer/stock data.
- User asks for unsupported module data.
- User asks for final mutation.
- Tool returns stale, empty, or partial data.
- AI provider timeout or quota error.
- AI Gateway is unavailable.
- ERP read tool is unavailable.
- LINE reply delivery fails.
- Web deep link opens after permission or record state changed.
- User sends very long message or unsupported attachment.

## 18. Acceptance Criteria

- [ ] Master checklist item 07 has this spec and the implementation plan linked.
- [ ] LINE webhook rejects invalid signatures before processing events.
- [ ] Unlinked LINE user receives account-link/invite guidance and no business data.
- [ ] Linked LINE user can ask at least one implemented read-only business question from LINE.
- [ ] AI Gateway uses allowlisted read tools only.
- [ ] ERP Core read tools re-check permission and ABAC on every call.
- [ ] User without permission receives a safe refusal with no hidden-record leakage.
- [ ] Mutation requests from LINE are refused and routed to web when a safe deep link exists.
- [ ] Answers include source references or web links for stock, alert, and dashboard answers.
- [x] Completed answers are Flex cards; safe tenant links are buttons and terminal turns restore the permission-filtered Quick Reply menu.
- [ ] AI/tool invocation audit records exist for sensitive reads.
- [ ] Conversation/tool logs do not store raw secrets or auth tokens.
- [ ] Web deep links from answers re-check permission when opened.
- [ ] Verification commands pass or skipped checks are recorded with concrete reasons.

## 19. Test Cases

- Invalid LINE signature returns `401` or `403` and does not call AI Gateway.
- Duplicate webhook event does not create duplicate AI turns or duplicate replies when idempotency data exists.
- Unlinked LINE user gets link-required response and no tool calls.
- Inactive company membership gets no AI Gateway call, no ERP tool call, and a safe no-access reply.
- Same LINE user relinked from a newly selected OWNER company updates `LineCompanyContext` and the next LINE webhook event stores the new `companyId`.
- Same LINE user relinked to the same WatchDog user returns success and refreshes context, not conflict.
- Same LINE user linked to another WatchDog user fails closed and does not modify context.
- Removed company member cannot query old company data from LINE.
- Multi-company user without active context gets company selection guidance.
- Inventory user can ask "low stock?" and receives only allowed locations/products.
- User without inventory permission cannot get stock balance details.
- Dashboard summary answer includes snapshot time or stale/unavailable state.
- Open alerts answer includes only alerts user can access.
- Unsupported accounting/tax/CRM question returns module-not-ready response before those modules exist.
- "Approve this payment" and "transfer stock now" are refused from LINE.
- AI Gateway cannot call a non-allowlisted tool.
- ERP read tool rejects missing/forged internal context.
- Source refs include `permissionChecked: true`.
- Logs redact LINE tokens/signatures/auth headers.
- Web deep link opened after permission removal shows forbidden/not-found state.

## 20. Open Questions

- None blocking implementation handoff for item 07.

## 21. Owner Decisions

- Web remains the full workspace.
- LINE AI item 07 is read-only.
- Final actions from LINE are blocked.
- First account linking uses admin-created user/invite flow from item 02.
- Unknown LINE users receive link/invite-required response and no business data.
- Local LINE verification uses the active HTTPS tunnel for webhook and LIFF/account-link URLs; `localhost` is not a valid LINE platform callback.
- Inventory and dashboard/notification are the first expected data sources for item 07.
- Item 07 starts deterministic-first. Add AI provider/model behind a port after read tools and safety behavior are stable.
- Store LINE AI user messages as preview plus hash by default. Full message retention waits for an approved retention policy.
- Multi-company selection uses LIFF/web selector. LINE quick reply may guide, but must not become authorization source of truth.
- First item 07 rich menu uses `Ask AI`, `Open Alerts`, and `Link Account`. `Daily Summary` stays item 06 reuse unless owner enables it later.
