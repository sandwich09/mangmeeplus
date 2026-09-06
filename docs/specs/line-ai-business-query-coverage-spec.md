# LINE AI Business Query Coverage Spec

## 1. Status

Core contract, routing, clarification, CRM, shipped-operations coverage, Mangmee-themed answer cards, and the owner company-card picker are deployed to production. The latest rollout shipped on 2026-07-15 at commit `55f89a40`; ECS and public health/log acceptance passed. Representative owner LINE OA journeys and post-journey review remain open.

Canonical checklist item: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10G.

Implementation plan: [[plans/line-ai-business-query-coverage-plan|LINE AI Business Query Coverage Plan]].

This specification extends the implemented item 07 read-only assistant, item 10B orchestration, and item 10F multi-intent/turn-ledger contracts. It does not replace their authentication, runtime, buffering, value-grounding, or mutation boundaries.

## 2. Owner Outcome

A linked and authorized employee should be able to ask LINE AI ordinary questions about production WatchDog-BMS features and receive the useful answer in LINE without opening the web application.

Web remains required for setup, bulk exploration, evidence inspection that cannot fit safely in chat, and final business mutations. A web link is optional drill-down after an answer; it is not a substitute for an answer that an available read tool can provide.

Examples:

- `ลูกค้าทั้งหมดมีกี่คน` -> scoped customer counts, not employee counts.
- `วันนี้ขายได้เท่าไร` -> amount, currency, period, and accounting basis.
- `ใครต้องติดตามวันนี้` -> bounded permission-scoped customer/follow-up list.
- `ของอะไรใกล้หมด` -> bounded low-stock list within location scope.
- `มีบิลค่าใช้จ่ายค้างตรวจเท่าไร` -> count/amount by source state.
- `ภาษีอะไรใกล้ครบกำหนด` -> obligation, due date, and source period.

## 3. Core Design Decision: Tools Are Business Capabilities, Not HTTP Endpoints

The number of LINE AI tools must not equal the number of ERP APIs.

- HTTP APIs are transport/resource contracts for screens, CRUD, files, callbacks, settings, and internal jobs.
- AI tools are stable, permission-scoped business question capabilities.
- One tool may call one existing source-module use case that already aggregates several repositories or records.
- Several HTTP endpoints may map to one tool when they answer one business question with the same permission, subject, filters, source state, and output shape.
- One HTTP endpoint may support several tools when its result safely serves distinct summary/detail question families.
- Webhook, upload-completion, secret rotation, worker scan, setup, archive, approve, pay, post, file, close, export-publication, and other mutation endpoints are not automatically AI tools.

A new tool is justified only when at least one of these differs materially:

1. business subject or meaning;
2. required permission or ABAC scope;
3. required/optional input and clarification behavior;
4. summary/list/detail/report output shape;
5. sensitivity/audit requirement;
6. source-state or accounting basis;
7. freshness or bounded-result behavior.

Do not create a generic `query_database`, `call_api`, `crm.query_everything`, or model-authored URL tool.

## 4. Scope

### 4.1 In scope

- Read-summary, read-list/search, read-detail, report/explain, and existing explicitly allowlisted suggestion/evidence-capture capabilities.
- Production features visible to the current user in web, subject to the same feature entitlement, permission, company, branch, location, assignment/team, source-state, and retention rules.
- Thai-first natural language, follow-up references, multi-intent questions, period/branch filters, and safe clarification.
- Direct, source-backed LINE answers with optional deep links.
- A feature-to-tool coverage manifest and regression corpus that makes coverage measurable.
- Explicit unsupported/forbidden/partial behavior when a feature, adapter, permission, or source state is unavailable.

### 4.2 Out of scope

- Mirroring every ERP endpoint as a tool.
- Letting the model call arbitrary URLs, controllers, SQL, Prisma, repositories, or MCP servers.
- Making LINE a full CRUD/setup/audit/export workspace.
- Final approval, payment, transfer, stock mutation, issue/void, ledger posting, tax filing, period close, permission change, external send/publish, or destructive action.
- Returning unrestricted tables, raw evidence bytes, secrets, credentials, full identity documents, hidden notes, or data outside current ABAC scope.
- Fabricated placeholder tools or fake data for source modules that are not production-ready.
- Deterministic Thai/English keyword lists as the semantic intent engine. Deterministic code may validate structured model decisions and execution boundaries only.

## 5. Users and Journeys

### Owner and manager

- Ask for business health, sales/cash received, receivables/payables, expenses, stock, customers, bookings, tax deadlines, approvals, and exceptions.
- Compare bounded periods or branches where permissions allow.
- Receive the answer first, then an optional link for investigation/action.

### Sales and CRM staff

- Search assigned/visible customers, inspect a customer summary, list follow-ups, view pipeline/booking status, and read scoped CRM reports.
- Never receive customers outside assignment/team/company rules.

### Inventory staff

- Search products, inspect stock by allowed location, low-stock and movement summaries.
- Never infer stock availability from catalog presence alone.

### Finance and accountant

- Read document/payment/expense/reimbursement/AP/ledger/tax/bank summaries and bounded details according to permissions.
- Every amount states currency, period/as-of time, and business/accounting basis when ambiguity is possible.

### Staff

- Read own tasks, own reimbursement/leave states, and other own-scoped data only.

### Auditor/read-only collaborator

- Read only explicitly granted audit/report/source summaries. No approval is implied by read access.

## 6. Architecture and Trust Boundaries

```text
LINE event
  -> API signature/idempotency/identity/company/membership/permission resolution
  -> bounded conversation context + open clarification context
  -> AI Gateway semantic routing and tool selection
  -> allowlisted tool metadata/policy validation
  -> internal ERP tool endpoint
  -> authoritative access re-resolution + source-module use case
  -> bounded ToolResult + SourceRef
  -> grounded answer + optional server-known deep link
  -> persisted turn/tool audit + LINE reply
```

Mandatory boundaries:

- API owns LINE trust, selected company, current membership, current permissions, and ABAC scope.
- AI Gateway owns semantic routing/orchestration but no ERP persistence or database access.
- ERP source modules own business definitions, query correctness, state interpretation, and source references.
- The internal tool endpoint re-resolves authoritative access and re-checks every required permission.
- Tool input is allowlisted and sanitized; user/model-supplied company/user/permission/scope fields are ignored.
- Tool output is bounded and display-safe; the model never receives unrestricted repository rows.
- Web deep links are server-known paths and re-check access/current state when opened.

## 7. Canonical Contracts

### 7.1 Business subject

Add a shared `LineAiBusinessSubject` enum/union and carry one subject per routed sub-request:

```text
company | branch | employee | customer | conversation | lead | opportunity |
follow_up | booking | crm_report | product | inventory | sale | payment |
accounting_document | expense | reimbursement | supplier | procurement |
ledger | tax | bank | workflow | report | payroll | leave | fixed_asset |
marketplace | unknown
```

Each `ToolMeta` declares `businessSubjects`. The router must return the subject it inferred from the current message plus permitted conversation/open-clarification context. Before any tool is offered or executed, deterministic policy checks:

```text
routed subject intersects tool.businessSubjects
AND tool is enabled/wired
AND tool category is LINE-allowed
AND current permissions contain every tool permission
```

If subject/tool compatibility fails, do not substitute the nearest enabled tool. Re-route once within the existing model budget; then return honest unsupported/clarify behavior.

This is an execution guard, not a keyword classifier. For example, `customer` can never execute an `employee`-only tool even if both return a count of people.

### 7.2 Tool metadata

Extend the canonical shared registry rather than maintaining semantic descriptions only in AI Gateway:

```ts
type ToolMeta = {
  name: string;
  description: string;
  businessSubjects: LineAiBusinessSubject[];
  questionKinds: ('summary' | 'search' | 'list' | 'detail' | 'breakdown' | 'explain')[];
  category: ToolCategory;
  requiredPermissions: string[];
  sourceModule: string;
  supportedAgents: string[];
  sensitiveAudit: boolean;
  requiresErpPermissionCheck: true;
  requiredInputFields?: readonly string[];
  optionalInputFields?: readonly string[];
};
```

Existing `ToolResult`, `SourceRef`, allowed categories, internal endpoint, and policy enforcer remain the base contract. Do not introduce a second tool registry.

### 7.3 Clarification state

Every model-generated `ask_user` must produce a structured clarification outcome, including when no tool has run:

```ts
type LineAiClarification = {
  originalText: string;
  subject: LineAiBusinessSubject;
  question: string;
  missingFields: string[];
  createdAt: string;
};
```

The API persists it through the existing per-chat turn ledger as `waiting_user`. A follow-up such as `ทั้งหมด`, `วันนี้`, `ลูกค้า`, or a branch name fills the original request; it must not silently become an unrelated fresh request. A clarification is acknowledged only after the original request is answered, refused, explicitly cancelled, or expires under the existing ledger policy.

Do not add a second conversation/slot database.

### 7.4 Tool result rules

Every successful result must include:

- `toolName`, `status=ok`, `asOf`, and at least one `permissionChecked: true` source ref;
- the effective company scope implicitly from server context, never echoed from user input;
- effective period/as-of for time-based data;
- currency and basis for monetary totals;
- filters/definition needed to interpret counts, for example active-only versus including archived;
- a bounded `items` list and a separate exact scoped `total` when list questions are supported;
- `stale=true` when the source module says the result is stale.

Empty data is a valid grounded result, not a reason to invent or switch subjects.

## 8. Coverage Standard

A production read feature is `LINE-covered` only when all applicable question kinds are supported:

1. **summary**: count/amount/status/health;
2. **search or list**: bounded matching records with total and filters;
3. **detail**: one safely resolved record where users naturally ask about one record;
4. **breakdown or explain**: only where the web exposes a business breakdown or users need the basis explained.

Not every feature needs all four. The feature coverage manifest must record `N/A` with a reason rather than silently omit a question kind.

Coverage is based on business feature/journey, not controller count. Internal jobs, callbacks, uploads, configuration, mutations, and web-only evidence views can be `N/A`.

## 9. Minimum Feature-to-Tool Coverage

Names below are canonical implementation targets. Existing tools are reused; new names are additive.

| Feature/subject | Minimum tools | Primary permissions | Notes |
|---|---|---|---|
| Company/branch | `company.get_current_context`, `company.list_branches` | `company.setup.read`, `company.branch.read` | Existing; company selection remains API control plane. |
| Dashboard/alerts | `dashboard.get_business_health_summary`, `notifications.list_open_alerts`, `notifications.get_daily_summary` | `dashboard.read`, `notification.read` | Existing; answer direct, link optional. |
| Employees | `company.get_employee_summary`, `company.get_employee_detail` | `access.employee.read` | Existing; detail remains sensitive-audited and masked. |
| CRM customers | `crm.get_customer_summary`, `crm.search_customers`, `crm.get_customer_360` | `crm.customer.read` | First closure priority; canonical `CrmCustomer`; state/scope definitions explicit. |
| CRM inbox | `crm.get_inbox_summary`, `crm.list_conversations`, `crm.get_conversation_summary` | `crm.inbox.read` | Never expose hidden message bytes/notes outside policy. |
| CRM pipeline | `crm.get_pipeline_summary`, `crm.list_open_followups` | `crm.opportunity.read`, `crm.follow_up.read` | Reuse assignment/team ABAC. Suggestions remain separate from reads. |
| Bookings | `crm.get_booking_summary`, `crm.list_bookings` | `crm.booking.read` | Period/status/branch filters; no create/cancel tool. |
| CRM reports/sales | `crm.get_report_summary`, `sales.get_sales_summary` | `crm.report.read` | Reuse implemented CRM report and received-payment sources; label basis exactly. |
| Products/inventory | existing four inventory tools plus `inventory.get_product_detail` if search output cannot answer detail | inventory read/report permissions | Location scope and active/customer-visible/catalog concepts remain distinct. |
| Accounting documents | existing `accounting.get_summary`, `accounting.list_recent_documents` plus `accounting.get_document_detail`, `accounting.get_receivable_summary` | `accounting.document.read` | Detail excludes evidence bytes; official state/balance comes from source module. |
| Expenses | existing `expense.list_recent`, `expense.get_breakdown` plus `expense.get_detail`, `expense.explain_record` | `expense.read` or source-enforced `expense.read_own` | Source type, review/payment/tax-evidence status; no confirm/void/payment. `expense.explain_record` (draft-control spec §5.5) explains ONE record captured in the caller's own LINE chat — same read permissions, chat-provenance resolver shared with the correction lane, deterministic Thai answer. |
| Reimbursements | existing `reimbursement.list_pending_approvals` plus `reimbursement.get_summary`, `reimbursement.get_detail` | `reimbursement.read` or source-enforced `reimbursement.read_own`; `reimbursement.list_pending_approvals` needs `reimbursement.approve` | Read does not imply approve — and the approval queue is not a read. It runs through the web queue use case (`ListApprovalQueueUseCase`), so it returns only the rows this approver may act on. |
| Procurement/AP | existing `procurement.get_ap_outstanding` plus `procurement.get_summary`, `procurement.search_suppliers`, `procurement.get_purchase_order_detail` | `procurement.ap.report`, `procurement.supplier.read`, `procurement.purchase_order.read` | No supplier-bank read, approve, receive, vendor-bill, or payment mutation. |
| Ledger | existing `ledger.get_financial_summary` plus `ledger.get_report_summary`, `ledger.get_period_status` | `ledger.report.read`, `ledger.period.read` | P&L/BS/TB basis and period required; no journal/close action. |
| Tax | existing eight tax tools | current tax read keys | Keep profile/effective-date/evidence/reconciliation guards. |
| Bank | existing registered balance/reconciliation tools plus `bank.list_recent_transactions` when source is ready | bank account/reconciliation read keys | Feature-gated; never expose credentials/account secrets. |
| Workflow/tasks | existing four workflow tools | workflow read keys | Assigned/own scope preserved. |
| Reports/BI | existing `reports.get_monthly_report_summary`; add catalog/query tools only when their governed source contracts are production-ready | `report.catalog.read`, `report.dataset.read`, `report.query.run` | Item 18 source is shipped; no arbitrary SQL or model-authored dataset expression. |
| HR/leave/payroll | `hr.get_leave_summary`, then summary/detail tools owned by item 20 when shipped | HR/payroll read/own keys | Feature-gated; PII minimization and own/team scope. |
| Fixed assets | summary/search/detail tools owned by item 21 when shipped | fixed-asset read keys | Feature-gated; assignment/location scope. |
| Marketplace | summary/order/performance tools owned by item 19 when shipped | marketplace read keys | Feature-gated; never publish campaigns/orders. |

The implementation plan may merge a proposed summary/list/detail tool only when the merge criteria in section 3 prove the permission, subject, inputs, output, sensitivity, and source-state are the same. Any merge must remain explicit in the coverage manifest.

## 10. Customer Semantics Required for the First Closure

`crm.get_customer_summary`:

- reads canonical same-company `CrmCustomer` records through the CRM source module;
- returns scoped `total`, `active`, `archived`, and time-bounded `newCustomers` when the source use case can compute it honestly;
- explicitly records whether `total` includes archived records;
- applies current assignment/team/branch policy before aggregate counts;
- never counts company memberships/employees, conversations, counterparties, leads, or LINE identities as customers;
- does not infer that two records are the same person; canonical merge state owns identity.

`crm.search_customers`:

- accepts bounded `search`, `status`, `assignedToMe`, and pagination/limit fields supported by the existing CRM query;
- returns exact scoped total plus at most 10 display-safe matches by default;
- masks contact/PDPA fields according to current source policy;
- asks for clarification when a detail request has several same-name matches.

`crm.get_customer_360`:

- requires a server-resolved canonical customer id selected from a prior scoped search result or an unambiguous source lookup;
- returns only sections the caller may read and records redacted/omitted sections honestly;
- never lets a model-authored id bypass company/permission checks.

## 11. Routing and Answer Rules

1. Resolve the current turn against structured open clarification and bounded conversation context.
2. Classify each sub-request with subject and question kind.
3. Offer only subject-compatible, enabled, permission-compatible tools.
4. Prefer the smallest tool set that can answer all sub-requests.
5. If required input is missing, ask one concrete question and persist it as waiting.
6. If the subject is supported but the source tool is not wired, say the feature is not available; do not use another subject's tool.
7. If permission is missing, return a safe forbidden answer without revealing existence/count.
8. If data is empty, answer zero/no matching data with the effective scope and period.
9. Answer useful facts in LINE first. Add at most one primary deep link when it helps drill down or perform a blocked action.
10. `Sources:` must name the actual source module/entity used. A source label incompatible with the question subject is a failed turn.

### 11.1 LINE answer cards

- Every successful business read/query answer is delivered as a server-rendered LINE Flex answer card. Clarifications, refusals, permission denials, unavailable/error responses, intake/capture flows, and other non-business-read messages remain text unless a dedicated safe template already exists.
- One coherent answer uses one `bubble`. Multiple completed answers in the same turn use one `carousel` with one bubble per answer. The renderer must keep LINE platform limits and the existing bounded multi-intent/tool budget; it must not invent or merge facts to fill a card.
- AI Gateway may return only a bounded semantic answer-card payload (`title`, grounded `body`, source label, and server-known drill-down path). It must never return raw LINE Flex JSON, colors, arbitrary URLs, or actions authored by the model.
- API owns the Flex template, theme, length bounds, URL resolution, and text fallback. The card reuses the web design-token palette: brand `#22c55e`, brand dark `#15803d`, white surface, primary text `#101828`, secondary text `#667085`, and border `#e4e7ec`.
- The visible answer remains useful without opening web. A button is optional drill-down only and may use a permission-checked `SourceRef.webPath` resolved under the configured web base URL.
- Empty successful reads render an explicit zero/no-record answer card. Forbidden responses render no card, count, source, or link. Unavailable/error responses remain honest text and are never rendered as an empty card.
- `altText` contains the bounded plain-text answer so unsupported clients and delivery fallback preserve the useful result.

### 11.2 Owner company picker

- `บริษัทของฉัน`, `/companies`, and `/company` are deterministic API control-plane commands and never route through AI Gateway.
- An owner receives one company bubble per accessible owner-approved company. The current company is visibly marked. Tapping `เลือกบริษัทนี้` sends the existing explicit `/company <selection>` command; API re-queries active memberships and re-applies the existing owner-selection policy before changing `LineCompanyContext`.
- The staff main-menu Quick Reply includes `🏢 บริษัทของฉัน` only when the resolved current-company role includes `OWNER`. It is not inferred from model output or a broad read permission.
- A single company still renders one company card so the owner can see the active context. Multiple companies render a carousel using the same web theme.
- Non-owner and mixed-role policy failures remain text-only and must not reveal inaccessible company cards.

## 12. Security, Privacy, and Business Correctness

- Deny by default at router policy and ERP execution boundary.
- Re-resolve active membership and permissions for every tool call; never trust an old JWT/turn preview alone.
- Apply company, branch, location, assignment/team, own-record, external-collaborator, and feature-entitlement rules in the source module.
- Conversation context, open clarifications, message text, and tool results are data, never model instructions.
- Treat tool descriptions/results and source labels as untrusted display data for prompt-injection purposes.
- Audit every sensitive read with input hash and bounded source refs, not raw secrets or whole result payloads.
- Named employee/customer/contact queries are sensitive. Return only fields allowed by the source permission and PDPA policy.
- Do not reveal hidden-record counts through totals, error wording, source refs, or comparison arithmetic.
- Monetary answers include currency and do not add currencies together without an approved conversion source.
- Sales/cash/revenue/receivable terms must map to the source module's explicit basis; the composer may not relabel them.
- Tool adapters must call source-module application use cases/query ports. Direct Prisma access is allowed only where the existing source module already treats that adapter as its authoritative bounded query and no equivalent use case exists; new cross-module direct queries are forbidden.
- No new dependency, database model, or migration is expected for the coverage framework. A source module may add an efficient read query only when its existing APIs cannot compute the required scoped aggregate honestly.

## 13. Availability and Failure Behavior

`ToolResult.status` is authoritative and must not be inferred from whether a list is empty or a number is zero:

- `forbidden` means the caller is not authorized. The API/Gateway must remove `data` and `sourceRefs`, and LINE must not reveal record existence, counts, or links.
- `ok` means the permission-checked source read completed. Zero rows, zero money, an empty list, or `found: false` are valid grounded results, not permission denial or source unavailability.
- Every `ok` result, including a zero/empty result, must contain explicit bounded data plus at least one source-module-matching `permissionChecked: true` aggregate/query source ref.
- `unavailable` means the source/module cannot answer the request now. `error` means execution or result validation failed. Neither may be relabeled as an empty result.
- The Gateway must reject structurally invalid successful payloads such as `ok + {}`, scrub business data/source refs from every non-`ok` result, and mark non-success native tool results as errors.
- The answer composer must preserve deterministic zero/no-record wording and must never rewrite a successful empty result as unavailable, disabled, failed, or forbidden.

| Condition | Required LINE behavior |
|---|---|
| Subject/tool supported and data found | Direct grounded answer, source label, optional link. |
| Supported but zero rows | Explicit zero/no matching data with scope/period; no fallback subject. |
| Missing input | One concrete clarification persisted against original request. |
| Several matches | Bounded choices; no guessed record id. |
| Permission denied | Safe forbidden response; no count/existence leak. |
| Feature entitlement/module/tool unavailable | Honest unavailable response; no nearest-tool substitution. |
| Partial multi-intent coverage | Answer completed parts in order, name unavailable part, persist only genuinely waiting work. |
| Stale source | Label stale/as-of status; never present as current. |
| Provider/router failure | Existing deterministic safe fallback/refusal; no arbitrary tool execution. |
| Tool/provider timeout | Existing retry/ledger behavior; no duplicate mutation because this scope is read-only. |

## 14. Coverage Manifest and Governance

Maintain one checked-in manifest/test fixture derived from the canonical tool registry. For every production business feature record:

- feature key and business subject;
- representative Thai/English questions;
- summary/search/list/detail/breakdown coverage or `N/A` reason;
- tool names and wired/disabled state;
- source module/use case;
- permission and ABAC rule;
- sensitive audit flag;
- source-state/basis/freshness rule;
- direct-answer and optional-link expectations;
- focused contract/router/tool/integration test references.

CI must fail when:

- a router-enabled tool is missing from the shared registry or internal tool map;
- a wired tool lacks description, subject, question kind, permission, or source module;
- a production feature is marked LINE-covered without at least one golden question and ERP permission test;
- a disabled/unwired tool is advertised as enabled;
- subject incompatibility can reach tool execution;
- source refs do not match the executed tool's source module.
- an `ok` empty result has no permission-checked aggregate/query source ref;
- a non-`ok` result carries business data or entity source refs across the Gateway boundary;
- a specialist fabricates zero/default fields from a structurally invalid successful payload;
- the answer layer describes an explicit successful empty result as forbidden or unavailable.

## 15. Acceptance Criteria

- [x] Tools are mapped to business capabilities, not copied one-per-API.
- [x] Shared tool metadata contains canonical descriptions, subjects, question kinds, permissions, source modules, and audit flags.
- [x] Model-routed subject/tool compatibility is enforced before execution.
- [x] No customer question can execute employee tools, and no employee question can execute customer tools.
- [x] Every model-generated clarification is persisted and resolves the original request on the follow-up turn.
- [x] Production read features have a coverage manifest with explicit supported/N/A question kinds.
- [x] Direct answers contain the useful data; web links are optional drill-down or mutation handoff.
- [x] ERP Core re-resolves current access and applies tenant/ABAC/source-state rules for every tool call.
- [x] Sensitive reads are audited and display-safe; hidden record existence/counts do not leak.
- [x] Monetary/count answers expose period/as-of, scope/definition, currency/basis as applicable.
- [x] Empty, forbidden, unavailable, stale, partial, ambiguous, and provider-failure paths are honest and tested locally.
- [x] AI Gateway has no Prisma/repository/database dependency.
- [x] Existing final-mutation block remains intact.
- [ ] Focused contract, API, AI Gateway, webhook/ledger, and live LINE smoke evidence is recorded before checklist closure.

### Mandatory regression journey from the reported failure

```text
User: มีลูกค้าเยอะไหม
AI: asks whether the user wants a count or another customer measure
User: ทั้งหมด
AI: resolves the open customer request; it must not ask for sales/stock/business-health scope

Alternative direct path:
User: ลูกค้าทั้งหมดมีกี่คน
AI: calls crm.get_customer_summary and returns the scoped customer count
```

Assertions:

- tools invoked contain `crm.get_customer_summary`;
- tools invoked do not contain `company.get_employee_summary` or `company.get_employee_detail`;
- source labels/modules are CRM customer sources, never `พนักงาน`/employee-access;
- answer count equals the permission-scoped canonical CRM fixture;
- removing `crm.customer.read` yields forbidden with no count;
- a second company fixture never contributes to the result;
- `ทั้งหมด` resolves the waiting customer clarification rather than starting a new subject;
- Haiku and the approved stronger chat model both satisfy the same deterministic contract tests/live evaluation set.

## 16. Release Gate

Item 10G remains unchecked until:

1. contract/routing/clarification safety is implemented;
2. CRM customer closure passes the mandatory journey;
3. every currently shipped production feature is classified as covered, explicitly web-only, or feature-gated unavailable in the manifest;
4. focused and full relevant suites/typechecks pass;
5. dev LINE OA smoke passes representative owner, sales, inventory, finance, forbidden, multi-turn, and multi-company journeys;
6. production rollout is canaried with wrong-tool, unavailable, forbidden, clarification-repeat, and no-source metrics/log queries reviewed;
7. checklist, roadmap, source specs/plans, and agent memory reflect verified reality.
