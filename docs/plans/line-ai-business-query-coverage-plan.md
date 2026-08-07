# LINE AI Business Query Coverage Implementation Plan

## Status

Core implementation, the cross-tool result-semantics hotfix, Mangmee-themed answer cards, and the owner company-card picker are deployed to production. The card rollout shipped on 2026-07-15 at commit `55f89a40`; API/Web task definition `:158`, AI Gateway `:63`, and Workers `:18` reached `COMPLETED`, public health/login returned HTTP 200, and no `ERROR` was found in the three service log groups during the 10-minute post-deploy window. Owner LINE OA journeys and post-journey review remain open, so checklist item 10G stays unchecked.

Latest local evidence: API 1,999/1,999, focused API LINE/business coverage 142/142, AI Gateway 413/413, focused Gateway/AgentCore presentation coverage 61/61, contracts/API/Gateway builds or typechecks green, and `git diff --check` green. The matrix covers every specialist-reachable read/report tool for explicit zero/empty, invalid empty payload, forbidden, and unavailable/error behavior.

Canonical checklist item: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10G.

## Linked Specification

- [[specs/line-ai-business-query-coverage-spec|LINE AI Business Query Coverage Spec]]
- [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- [[specs/line-ai-local-agent-orchestration-spec|LINE AI Local Agent Orchestration Spec]]
- [[specs/line-ai-multi-intent-completion-spec|LINE AI Multi-Intent Completion Spec]]
- [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
- [[specs/permission-matrix|Permission Matrix]]
- [[product/business-use-cases|Business Use Cases]] BUC-07

## Purpose

Close LINE AI business-question coverage systematically. The implementation must make current production read features answerable in LINE through stable business tools, while preserving the existing identity, tenant, permission, ABAC, audit, source-state, grounding, multi-turn, and final-mutation boundaries.

The first user-visible closure is the reported customer/employee misrouting. The plan then expands by business feature, not by controller count.

## Non-negotiable Implementation Rules

- Read `.agents/skills/ponytail/SKILL.md` before edits.
- Reuse `LINE_TOOL_REGISTRY`, `ToolMeta`, `ToolResult`, `SourceRef`, `ErpReadToolPort`, `InternalToolsController`, `IntentRouterAgent`, `OrchestratorAgent`, the Redis turn ledger, and source-module use cases.
- Do not create a second registry, generic API caller, arbitrary query tool, new AI database, or AI Gateway repository access.
- Do not implement semantic intent with keyword lists. The model classifies a structured business subject; deterministic code validates compatibility and safety.
- Do not mark a source feature enabled until its adapter is wired and verified.
- Keep each phase green and deployable independently.
- No new dependency is expected.

## Phase 0 - Baseline and Coverage Manifest

### Work

1. Enumerate current production feature/navigation keys from shared contracts and shipped source modules.
2. Enumerate the shared LINE registry, router enabled/disabled sets, internal tool map, required permissions, source modules, and test coverage.
3. Add one checked-in coverage fixture/manifest under the existing LINE AI test/code area. Prefer TypeScript data consumed by tests rather than a second hand-maintained prose table.
4. Mark each feature/question kind `covered`, `web_only` with reason, or `feature_gated` with owning roadmap item.
5. Record the 2026-07-15 baseline, including the missing CRM customer read tools and the customer-to-employee wrong-tool regression.

### Likely files

- `packages/contracts/src/ai-tools.ts`
- `packages/contracts/src/access-matrix.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/agent-tools.registry.spec.ts`
- new focused coverage manifest/spec beside existing LINE AI registry tests
- `docs/agent-memory/line-ai-business-query-coverage.md`

### Verification

- Manifest contains every registry tool exactly once.
- Every router-enabled name exists in registry and the API internal tool map.
- Disabled/unwired tools are not advertised as enabled.
- `git diff --check` on touched files.

## Phase 1 - Canonical Subject Metadata and Wrong-Tool Guard

### Contracts

1. Add `LineAiBusinessSubject` to shared LINE contracts.
2. Extend routed sub-request/intent shape with `subject`.
3. Extend `ToolMeta` with canonical `description`, `businessSubjects`, and `questionKinds`.
4. Move existing router descriptions into the shared registry and delete the duplicated gateway-only description map after parity tests pass.
5. Tag all existing tools with subjects/question kinds. Keep names and wire behavior stable.

### Gateway

1. Update the router prompt/schema to return `subject` for each sub-request.
2. Validate subject membership and reject unknown subject values.
3. Filter both JSON-loop and native-tool-loop available tools by subject compatibility before the model sees them.
4. Validate compatibility again immediately before execution.
5. On incompatibility, allow one bounded re-route; otherwise return unsupported/clarify. Never substitute a semantically adjacent tool.
6. Include subject in coverage critic inputs and turn output metadata.

### Required tests

- `customer` cannot select either employee tool.
- `employee` cannot select CRM customer tools.
- sales cash-received cannot silently become ledger/accounting document summary.
- booking cannot become employee/customer count.
- disabled/unwired subject tool returns unavailable rather than nearest-tool data.
- all existing enabled tools remain reachable for their correct subject.

### Likely files

- `packages/contracts/src/ai-tools.ts`
- `packages/contracts/src/line-ai.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts`
- their focused specs and registry parity spec

### Verification

- contracts build/typecheck;
- focused router/orchestrator/native-loop/model-loop/registry tests;
- AI Gateway typecheck.

## Phase 2 - Structured Clarification Continuity

### Work

1. Add `LineAiClarification` to the turn response/open-clarification contract.
2. Make both JSON `askUser` and native `ask_user` return the same structured clarification outcome even when zero tools ran.
3. Include original text, subject, missing fields, and bounded question.
4. Persist every clarification as `waiting_user` through the existing Redis Streams ledger.
5. On the next turn, pass the open clarification to intake routing, intent routing, native/model tool loops, and coverage critic.
6. Ack only after the original request completes/refuses/cancels/expires.
7. Preserve the existing 15-turn/15-minute conversation context separately; do not treat free-text history as authoritative slot state.

### Required tests

- `มีลูกค้าเยอะไหม` -> clarification -> `ทั้งหมด` retains subject `customer`.
- branch/period/name follow-ups fill the original request.
- a new unrelated question does not get forced into an old clarification; policy cancels or carries it honestly.
- expiry clears stale waiting work.
- provider/Redis unavailable paths retain existing safe fallback/fail-open policy without wrong-tool execution.

### Likely files

- `packages/contracts/src/line-ai.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- existing turn-ledger implementation/specs
- focused webhook/orchestrator/ledger tests

### Verification

- contracts build;
- focused gateway ask-user and API webhook/ledger tests;
- API and AI Gateway typechecks.

## Phase 3 - CRM Customer Closure (First User-Visible Slice)

### Tools

Implement and wire:

```text
crm.get_customer_summary
crm.search_customers
crm.get_customer_360
```

### Source implementation

1. Reuse canonical CRM customer list/detail and Customer 360 use cases/query ports.
2. Add only the smallest source-owned aggregate query needed for exact scoped counts; do not scan an arbitrary capped page to compute totals.
3. Reuse `crm.customer.read`, assignment/team/company policies, canonical merge state, and PDPA redaction.
4. `total` definition must explicitly include/exclude archived records; expose both active/archived counts when permitted.
5. Bound search results to 10 by default and require safe disambiguation for detail.
6. Return CRM source refs and server-known `/customers`/customer detail paths.

### Wiring

- Add shared registry metadata.
- Add API tool adapters and providers to the existing LINE AI module/internal controller map.
- Enable in router only after API adapter tests pass.
- Extend the existing CRM/accounting specialist allowlist or reuse the current CRM agent path; do not create another one-tool agent class.

### Required tests

- Mandatory screenshot journey from the spec.
- Direct `ลูกค้าทั้งหมดมีกี่คน` journey.
- active/archived definition, zero customers, multi-company isolation, assignment/team scope, permission denied, same-name disambiguation, PDPA redaction, and source-ref correctness.
- Exact negative assertion: no employee tool invocation/source label.

### Likely source files

- existing CRM customer application use cases/repository/query ports
- `apps/api/src/modules/line-ai/application/use-cases/erp-crm-tools.use-case.ts` (new cohesive adapter file is acceptable)
- `apps/api/src/modules/line-ai/line-ai.module.ts`
- internal tool controller specs
- gateway registry/router/orchestrator specs

### Verification

- focused CRM source tests;
- focused API tool/controller tests;
- focused gateway journey tests;
- contracts/API/AI Gateway typechecks;
- local internal-tool smoke with seeded company;
- dev LINE OA Thai multi-turn smoke.

## Phase 4 - CRM Operational Coverage

Implement from existing source use cases, in this order:

1. `crm.get_report_summary` reusing the shipped CRM reports summary.
2. `crm.get_pipeline_summary` and `crm.list_open_followups` with assignment/team ABAC.
3. `crm.get_booking_summary` and `crm.list_bookings` with period/status/branch filters.
4. `crm.get_inbox_summary`, `crm.list_conversations`, and `crm.get_conversation_summary` with inbox permissions and safe message/PII bounds.
5. Keep `crm.suggest_sales_followups` separate as suggestion semantics; enable it only after its actual source adapter is wired.

For each tool: source test -> adapter test -> registry enablement -> router regression -> LINE answer test. Do not batch-enable tools before their source proof exists.

## Phase 5 - Current Core Operations Coverage

Close summary/list/detail gaps for currently shipped modules:

1. Inventory/product detail where the existing four tools cannot answer safely.
2. Accounting document detail and receivable summary.
3. Expense detail summary.
4. Reimbursement summary/detail.
5. Procurement summary, supplier search, and purchase-order detail.
6. Ledger report/period status.
7. The shipped item 18 governed monthly report summary; keep arbitrary dataset/query execution blocked until its bounded query contract is proven.

Rules:

- Reuse source-module queries and permission keys.
- Do not duplicate business calculations in AI Gateway.
- Do not derive totals from truncated display lists.
- Every monetary output includes currency, period/as-of, and basis.
- Every detail lookup fails safely on multiple/no matches.

## Phase 6 - Feature-Gated Business Coverage

Wire only when the owning module is production-ready:

- banking balances/reconciliation/transactions;
- HR/leave/payroll read views;
- fixed-asset summary/search/detail;
- marketplace summary/orders/performance.

Until then, registry entries may remain explicitly disabled with `unsupported_module`; they must not be offered as enabled or answered through adjacent tools.

Each owning feature plan must add/update its coverage-manifest row as part of done. This makes future business features responsible for their LINE read surface without forcing one tool per API.

## Phase 7 - Answer UX and Source Honesty

1. Update answer composition so successful read turns answer in LINE before adding an optional link.
2. Include effective filters, period/as-of, currency/basis, state definition, and stale/partial markers where applicable.
3. Emit at most one primary drill-down link per coherent answer unless multi-intent results require clearly labeled separate sources.
4. Treat source-subject mismatch as a failed grounded answer and fall back safely.
5. Keep answer length bounded; for long lists show scoped total plus first results and explain how to narrow, not only a web link.
6. Treat ERP status as the result-state authority: `forbidden` is never empty, `ok + zero/empty/found:false` is never unavailable, and true `unavailable/error` is never presented as zero.
7. Give every successful zero-item adapter an aggregate/query source ref; do not derive all source refs only from returned rows.
8. Reject invalid `ok` payload shapes before they reach the model, scrub non-success payloads, and deterministically preserve zero/no-record fallback wording.

Required golden outputs cover zero, one, many, partial, stale, forbidden, unavailable, and ambiguous results in Thai and English.

The zero/permission matrix is mandatory for every specialist-reachable read/report tool: `ok + explicit zero/empty`, `ok + structurally invalid empty object`, `forbidden`, and `unavailable/error`. Detail tools additionally cover `ok + found:false` without exposing the requested hidden id.

### Phase 7A - LINE answer-card presentation

1. Extend the existing LINE turn contract with an optional bounded semantic answer-card list; do not add raw Flex JSON or a second presentation registry.
2. Build one grounded card for one successful business answer and one card per completed answer for multi-intent turns. Preserve the existing text reply as `altText` and fallback.
3. Add one deterministic API Flex renderer using the generated web design-token colors. Resolve only server-known permission-checked deep links.
4. Deliver cards through the existing `LineReplyAdapter`; keep clarification, forbidden, unavailable/error, and intake paths text-only.
5. Replace the `/companies` text list with an owner-only company bubble/carousel whose message action reuses `/company <selection>` and therefore the existing membership/owner re-check.
6. Add `🏢 บริษัทของฉัน` to the main Quick Reply only for a resolved `OWNER` role.

Required focused proof:

- one successful answer -> one Flex bubble with useful `altText`;
- multiple completed answers -> carousel using the same theme;
- explicit zero -> answer card; forbidden and unavailable/error -> text-only;
- missing/unsafe deep link -> no button;
- owner one/many company memberships -> bubble/carousel, current marker, tap command;
- non-owner cannot see the Quick Reply or company cards and cannot switch context;
- expired reply-token push fallback preserves the same Flex payload.

## Phase 8 - Integration, Evaluation, and Rollout

### Automated proof

- Build contracts.
- Run focused source-module, API tool/controller, AI Gateway router/orchestrator/composer, webhook/ledger, and registry/coverage tests.
- Run full relevant API and AI Gateway suites.
- Typecheck contracts, API, AI Gateway, and workers if ledger contracts changed.
- Run `git diff --check`.

### Model evaluation

Run the same checked-in corpus against the currently approved chat model and Sonnet baseline. Model quality may affect pass rate/latency, but deterministic subject/tool/permission/source guards must pass for both. Do not use a stronger model to waive a contract failure.

Minimum corpus domains:

- customer versus employee;
- sales versus cash received versus accounting documents;
- product/catalog versus stock availability;
- expense versus receipt capture;
- booking versus employee/customer count;
- ambiguous branch/period/person;
- forbidden and cross-company attempts;
- multi-intent and follow-up clarification;
- prompt injection inside message/context/tool data;
- empty/stale/unavailable source.

### Live proof

1. Seed or identify safe dev-company fixtures for owner, sales, inventory, finance, restricted, and multi-company users.
2. Exercise dev LINE OA with Thai natural-language and multi-turn journeys.
3. Confirm actual tool invocation, source labels, answer, audit, company/ABAC scope, and optional link.
4. Canary production behind the existing orchestration/tool-use flags or a narrow company allowlist if current deployment controls support it; do not add a new flag framework.
5. Review logs/metrics for wrong-subject rejection, repeated clarification, unsupported feature, forbidden, no-source, tool error, and latency before broad enablement.
6. Roll back by disabling only new tool enablement/coverage path; existing item 07 fallback remains available.

## Documentation Closure

After each implemented tranche:

- update this plan and the linked spec with verified behavior only;
- update item 10G checklist status and roadmap wording;
- update the owning source-module spec/plan when its LINE contract changes;
- update `docs/product/business-use-cases.md` only if the product journey/boundary changes;
- append exact commands/results and remaining live blockers to `docs/agent-memory/line-ai-business-query-coverage.md`.

Do not check item 10G merely because CRM customer tools pass. Full closure requires the release gate in the spec.

## Definition of Done

- Feature-to-tool coverage is explicit and CI-guarded.
- Current shipped read features are covered or honestly classified web-only/feature-gated.
- Wrong-subject execution is deterministically impossible after model routing.
- Clarification answers continue the original request.
- CRM customer questions return canonical scoped CRM data, never employee data.
- Answers are useful in LINE; links are secondary.
- Permissions/ABAC/audit/source-state/mutation boundaries pass focused and live proof.
- Docs, checklist, roadmap, and memory match deployed reality.
