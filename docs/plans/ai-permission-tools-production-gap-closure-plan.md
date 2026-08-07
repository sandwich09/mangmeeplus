# AI Permission and Tool Production Gap Closure Plan

## Status

**Implementation-ready plan. Not implemented.**

This plan was created from the 2026-07-12 code-and-doc audit of employee/shared-OA LINE AI, AgentCore, ERP read tools, employee role governance, customer/company-OA AI, and receipt intake.

The planning pass changes documentation only. It does not make any runtime, permission, schema, deployment, or production-data change.

## Linked Sources of Truth

- [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- [[specs/line-ai-local-agent-orchestration-spec|LINE AI Local Agent Orchestration Spec]]
- [[specs/ai-runtime-production-integration-spec|AI Runtime Production Integration Spec]]
- [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
- [[specs/employee-access-role-management-spec|Employee Access and Role Management Spec]]
- [[specs/employee-access-role-management-v2-phase1-spec|Smart Roles Phase 1 Spec]]
- [[specs/permission-matrix|Permission Matrix]]
- [[specs/crm-line-oa-customer-os-spec|CRM + Company LINE OA Customer OS Spec]]
- [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- [[plans/ai-runtime-production-integration-plan|AI Runtime Production Integration Plan]]
- [[plans/employee-access-role-management-v2-plan|Employee Access and Role Management v2 Plan]]
- [[plans/crm-line-oa-customer-os-plan|CRM + Company LINE OA Customer OS Plan]]
- [[plans/expense-receipt-upload-plan|Expense Receipt Upload Plan]]
- [[plans/master-implementation-checklist|Master Implementation Checklist]]
- [[agent-memory/ai-permission-tools-production-gap-closure|Task Memory]]

## Purpose

Make every AI capability truthful, permission-safe, scope-safe, and production-verifiable for:

- company OWNER and ADMIN;
- MANAGER and operational employees;
- FINANCE, ACCOUNTANT, AUDITOR, SALES, INVENTORY, STAFF, and custom roles;
- branch-, location-, team-, assignment-, and own-data-restricted memberships;
- shared WatchDog OA users using employee ERP tools;
- company-OA customer end users using the separate CRM customer agent family;
- local orchestration and AgentCore runtime;
- text, image, PDF, and mixed text-plus-receipt intake.

"All tools ready" does not mean every identity may call every tool. It means every catalog entry has exactly one truthful state:

1. `enabled/model_tool`: executable through every required layer and authorized at the source;
2. `enabled/attachment_intake`: deterministic intake capability, never model-selected as an ERP tool; or
3. `planned`: not callable or advertised as ready, with a precise owning-module blocker.

No tool may remain router-enabled but unreachable, agent-callable but API-blocked, or advertised with a non-canonical permission.

## Current Baseline

The audit found:

- 38 canonical LINE/ERP catalog entries;
- 27 router-enabled entries, but only 23 currently reachable through the active orchestrator;
- 7 explicitly disabled entries and 4 receipt entries outside both router sets;
- OWNER receives canonical company permissions but still correctly passes through feature-entitlement filtering;
- default new-company entitlements are `expenses`, `crm`, and `ai_line_assistant` only;
- employee/company-OA customer separation is structurally present, but both sides have production blockers;
- the AgentCore path drops membership, role, and scope context and the internal ERP endpoint trusts caller-supplied context;
- employee role create/update paths permit privilege escalation, and disabled roles can become effective through draft completion;
- manager/team and several branch-scoped reads are not enforced end to end;
- customer autonomy has audit-actor, booking-confirmation, final-boundary race, rate-limit, and internal-auth gaps;
- receipt intake is a separate pipeline from model-callable receipt tools, but the current catalog and agents blur that boundary;
- local sales/receipt regression work exists in the dirty worktree but is not production evidence and must not be assumed deployed.

Focused audit verification passed 211 API tests, 102 AI Gateway/AgentCore/customer-separation tests, 85 AI Draft API tests, 6 AI Draft Gateway tests, and contracts/API/AI Gateway typechecks. Those checks prove the inspected baseline, not production readiness; the missing security invariants, races, real database paths, object storage, and external LINE flows were not covered.

## Production Invariants

1. The API is the sole authority for active identity, membership, roles, permissions, entitlements, and ABAC scopes.
2. AI Gateway and AgentCore never authorize from caller-supplied permissions, roles, branches, locations, teams, or company identifiers.
3. Every ERP tool invocation is re-authorized at execution time using current database state.
4. Empty scope never means both restricted-empty and unrestricted; use explicit `ALL` or `RESTRICTED(ids)` semantics.
5. Every enabled tool has one canonical descriptor and complete router-to-source parity.
6. Feature entitlement and role permission are separate gates; OWNER does not bypass entitlement.
7. Role assignment is a separate privileged action from ordinary employee editing.
8. Disabled roles never contribute permissions in any membership state.
9. Restricted users never receive company-wide aggregates from a source that cannot enforce their scope.
10. Customer/company-OA identities never receive employee ERP tools or employee permission context.
11. Customer AI may classify and propose, but booking commit requires persisted, explicit customer confirmation.
12. Consent, channel state, staff/branch state, caps, and source state are rechecked atomically at the final send or booking boundary.
13. Every automated read, send, draft intake, and booking has durable actor, policy, source, and correlation evidence.
14. LINE/AI final business mutations remain blocked except the explicitly governed confirmed-booking and receipt-draft intake envelopes.
15. Production readiness requires prod-shaped E2E plus a real canary; unit/typecheck evidence alone cannot close the gate.

## Implementation Defaults

These defaults remove ambiguity for the implementation pass unless the owner explicitly overrides them before Phase 0 closes:

- OWNER has all permissions only inside active company entitlements; there is no OWNER bypass.
- Existing company entitlements are never expanded automatically. A full/demo package is an explicit audited onboarding preset.
- AgentCore uses a short-lived API-issued invocation grant containing identity references only; permissions and scopes are resolved by the API at every tool call.
- Shared secrets are transitional only. The production target is workload-authenticated internal traffic plus short-lived audience-bound grants.
- MANAGER is truly team- and branch-scoped. Until team assignments exist, team-sensitive reads deny or fall back to own-only, never company-wide.
- Role create/update/draft completion use one assignment-policy service; `access.role.manage` or a dedicated `access.role.assign` is required to change `roleIds`.
- Role grants outside active entitlements are rejected at save time. Existing dormant grants are quarantined for explicit review rather than silently reactivated later.
- Customer automated outbound requires `GRANTED` or `NOT_REQUIRED`; `UNKNOWN` and `REVOKED` use staff handling and never auto-send or auto-book.
- Booking uses `availability query -> proposal -> explicit confirmation -> atomic commit`. Change/cancel never falls through to create.
- Customer agents retain an empty ERP tool allowlist.
- Sales summary is a CRM-authorized cash-received aggregate, not booked revenue, and never exposes payment-row details without accounting permission.
- Receipt photo/PDF/text intake remains a deterministic API-owned attachment pipeline; receipt processing stages are not model-callable ERP tools.

## Gap Ledger

| ID | Gap to close | Required disposition | Work package |
|---|---|---|---|
| SEC-01 | AgentCore drops membership/role/branch/location/team context | API-issued grant plus server re-resolution at every invocation | A1 |
| SEC-02 | Public internal ERP route trusts caller context behind one shared secret | Workload auth, audience-bound grant, ignore caller claims | A1, C4 |
| SEC-03 | `ai.tool.invoke` is not enforced at the execution boundary | Central authorization service requires AI, channel, source, entitlement, and ABAC gates | A1 |
| SEC-04 | AgentCore returns no authoritative tool lineage/source references | API-side invocation ledger and revocation-safe context reuse | A2 |
| SEC-05 | Local and AgentCore authorization semantics can diverge | One policy evaluator and parity fixtures for both runtimes | A1, T1 |
| ROLE-01 | Employee create/update can assign roles above requester authority | Separate role assignment permission and shared assignment policy | B1 |
| ROLE-02 | Disabled roles can survive DRAFT and later become effective | ACTIVE-role filter, draft revalidation, disable invariant | B1 |
| ROLE-03 | Custom-role grants can be saved outside entitlements | Save-time rejection and reconciliation queue | B2 |
| ROLE-04 | Effective-access UI reports stored grants, not runtime-effective access | Use the canonical resolver and show denied/dormant reasons plus scopes | B2 |
| ROLE-05 | Feature enablement may silently activate hidden historical grants | Explicit approval/review during feature activation | B2 |
| ROLE-06 | Role/employee mutations lack a full delegated-scope rule | Enforce target, self-change, protected role, company, team, branch, and last-owner rules in transaction | B1 |
| SCOPE-01 | MANAGER team scope is documented but not modeled/enforced | Add Team model and repository predicates | B3 |
| SCOPE-02 | Employee detail exposes company-wide PII | Team/own predicate plus field-level redaction | B3 |
| SCOPE-03 | Dashboard, inventory health, ledger, tax, reports, and some accounting/AP reads drop branch scope | Complete source ABAC or deny `SCOPE_NOT_SUPPORTED` | B3 |
| SCOPE-04 | Workflow LINE tool loses trusted role context | Carry server-resolved roles/scopes through ERP tool context | B3 |
| TOOL-01 | Four router-enabled tools are not orchestrator-reachable | Fix accounting client block and notification/product-search specialist allowlists | T2 |
| TOOL-02 | Registry, router, specialist, client, controller, provider, and readiness lists drift | Canonical descriptor and build-blocking parity suite | T1 |
| TOOL-03 | Stock and expense permission metadata differs from source enforcement | Canonical `allOf`/`anyOf` expressions used at every layer | T1 |
| TOOL-04 | `expense.receipt.read` and `hr.leave.read` are not canonical executable permissions | Receipt becomes intake-only; HR remains planned until item 20 owns a real permission/API | T1, R1 |
| TOOL-05 | Reports backend is wired but router reason and specialist status are stale | Fully wire as a model tool and derive readiness | T2 |
| TOOL-06 | Disabled bank, reimbursement, and CRM follow-up tools have shipped owning modules but no complete AI path | Add source adapters, permission/ABAC tests, then enable | T3 |
| TOOL-07 | OWNER receives vague feature-not-ready replies | Effective catalog and distinct entitlement/permission/runtime reason codes | T1, U1 |
| TOOL-08 | Legacy `/agents` readiness omits tools and reports wrong states | Derive sanitized readiness from canonical descriptors and runtime bindings | T1, O1 |
| CUST-01 | Customer/system audit actors violate `AuditLog.actorUserId` FK or are swallowed | Typed audit actor model and atomic/durable audit writes | C1 |
| CUST-02 | Availability, change, cancel, and create can all become a booking | Persisted proposal/confirmation state machine | C2 |
| CUST-03 | Consent/channel/toggle can change during slow model evaluation | Final-boundary reload and atomic guard | C3 |
| CUST-04 | Autonomous booking can target disabled staff or stale branch | Revalidate active tenant staff/branch/catalog immediately before commit | C3 |
| CUST-05 | Caps and holding-message dedupe are check-then-act | Atomic reservations/idempotency | C3 |
| CUST-06 | LIFF registration trusts spoofable first X-Forwarded-For value | Shared trusted-proxy resolver plus distributed limiter | C4 |
| CUST-07 | Customer internal AI routes are public and secret-only | Workload-scoped internal authentication and rate limits | C4 |
| CUST-08 | No customer self-service withdrawal/export production path | LIFF/chat request flow with audited export/withdrawal lifecycle | C5 |
| CUST-09 | Customer autonomy docs contradict runtime | Canonical consent, booking, and autonomy state docs | D1 |
| RECEIPT-01 | Receipt agents call planned/unimplemented tools directly | Remove them from model-callable surface; use deterministic intake stages | R1 |
| RECEIPT-02 | Text, image, PDF, OCR-down, and mixed-message outcomes are not one durable flow | Persist bytes first, idempotent extract/draft, manual-review fallback | R1 |
| RECEIPT-03 | OWNER screenshot regression is not production-proven | OWNER entitlement/permission/media regression tests and real LINE canary | R2 |
| RECEIPT-04 | Company-OA customer might be confused with shared-OA employee intake | Negative channel/identity separation tests | R2, C5 |
| OPS-01 | No build gate proves cross-layer tool parity | Generated parity tests and release fingerprint | T1 |
| OPS-02 | No full role/runtime/customer matrix | Prod-shaped fixture matrix across web/local/AgentCore/customer OA | V1 |
| OPS-03 | Readiness/metrics cannot distinguish feature, permission, scope, implementation, or dependency failures | Bounded reason codes, logs, metrics, and alarms | O1 |
| OPS-04 | Existing local fixes are not deployed and may overlap new work | Dirty-tree inventory, explicit ownership, immutable release bundle, canary and rollback | P0, P4 |

## Target Disposition for All 38 Catalog Entries

| Catalog entry | Target state | Closure condition |
|---|---|---|
| `company.get_current_context` | enabled/model_tool | Trusted context, entitlement and company tests |
| `company.list_branches` | enabled/model_tool | Branch metadata policy documented and tested |
| `dashboard.get_business_health_summary` | enabled/model_tool | Restricted-scope aggregate implemented or explicit deny |
| `notifications.list_open_alerts` | enabled/model_tool | Specialist wiring plus source permission test |
| `notifications.get_daily_summary` | enabled/model_tool | Specialist wiring plus source permission test |
| `inventory.search_products` | enabled/model_tool | Inventory specialist wiring and branch/location policy |
| `inventory.get_stock_balance` | enabled/model_tool | Product + report permission contract aligned |
| `inventory.list_low_stock` | enabled/model_tool | Branch/location ABAC and adapter tests |
| `inventory.summarize_stock_movements` | enabled/model_tool | Branch/location ABAC and adapter tests |
| `ledger.get_financial_summary` | enabled/model_tool | Restricted-scope support or honest deny |
| `expense.list_recent` | enabled/model_tool | `anyOf` read/review/read-own plus own/branch ABAC |
| `sales.get_sales_summary` | enabled/model_tool | CRM cash-received aggregate contract and scope tests |
| `crm.suggest_sales_followups` | enabled/model_tool | Source-backed CRM adapter, own/assigned scope, no mutation |
| `accounting.capture_receipt_evidence` | enabled/attachment_intake | Deterministic receipt intake only; absent from model tool list |
| `accounting.get_summary` | enabled/model_tool | Remove stale client block and add end-to-end regression |
| `accounting.list_recent_documents` | enabled/model_tool | Accounting permission and scope tests |
| `procurement.get_ap_outstanding` | enabled/model_tool | Procurement/AP scope and permission tests |
| `company.get_employee_summary` | enabled/model_tool | Role/team/branch field policy |
| `company.get_employee_detail` | enabled/model_tool | Team/own predicate and PII redaction |
| `expense.get_breakdown` | enabled/model_tool | `anyOf` contract plus own/company scope tests |
| `bank.get_account_balances` | enabled/model_tool | Banking source adapter, entitlement and scope tests |
| `bank.get_reconciliation_status` | enabled/model_tool | Banking source adapter, entitlement and scope tests |
| `reimbursement.list_pending_approvals` | enabled/model_tool | Assignment/approval-scope adapter; read-only result |
| `hr.get_leave_summary` | planned | Not callable until item 20 provides canonical permission, source API, and privacy policy |
| `reports.get_monthly_report_summary` | enabled/model_tool | Specialist wiring, derived readiness, report/source permission recheck |
| `receipt.get_attachment_metadata` | enabled/attachment_intake | API-owned internal receipt stage, not model-selected |
| `receipt.create_or_update_evidence_draft` | enabled/attachment_intake | Idempotent reviewable draft stage, no final expense mutation |
| `receipt.find_duplicate_by_hash` | enabled/attachment_intake | Company-scoped hash check with no cross-tenant disclosure |
| `receipt.score_authenticity` | enabled/attachment_intake | Evidence-based score or typed unavailable; never fabricated LOW |
| `tax.get_upcoming_tax_obligations` | enabled/model_tool | Source permission plus scope behavior tested |
| `tax.get_vat_summary` | enabled/model_tool | Source permission plus scope behavior tested |
| `tax.get_wht_summary` | enabled/model_tool | Source permission plus scope behavior tested |
| `tax.get_cit_calendar` | enabled/model_tool | Source permission plus scope behavior tested |
| `tax.list_missing_tax_documents` | enabled/model_tool | Source permission plus scope behavior tested |
| `workflow.explain_run` | enabled/model_tool | Trusted role/scope context and source permission |
| `workflow.list_assigned_tasks` | enabled/model_tool | Literal and role-assigned task visibility tested |
| `workflow.list_recent_failures` | enabled/model_tool | Scope/source permission tests |
| `workflow.summarize_rule_health` | enabled/model_tool | Scope/source permission tests |

This target yields 32 model tools, 5 deterministic receipt-intake capabilities, and 1 truthful planned HR tool. A tool may stay disabled during intermediate deploys, but the release gate is not closed until it reaches its target state or the owner explicitly changes this table.

## Role and Identity Acceptance Matrix

| Identity / role | Expected effective AI scope |
|---|---|
| OWNER | All company data inside active entitlements; no system-wide data and no feature bypass |
| ADMIN | Entitled company data; may manage non-protected roles according to assignment policy |
| MANAGER | Managed teams plus assigned branches/locations; no unmanaged employee PII |
| STAFF / employee | Own records/tasks and explicitly assigned operational scope only |
| SALES | Own/assigned CRM and approved branch aggregates; no accounting row details |
| INVENTORY | Assigned branches/locations and inventory reads only |
| FINANCE | Finance data inside membership scope; no role administration unless separately granted |
| ACCOUNTANT | Accounting/tax data inside membership scope; governed mutation remains web-only |
| AUDITOR | Read-only effective data inside scope; no AI or web mutation |
| Custom role | Intersection of active grants, active entitlements, delegable role policy, and ABAC scope |
| COMPANY_VIEW | No company AI invocation unless a later explicit policy grants it |
| SYSTEM_ADMIN | Partner/system administration only; no company business AI by default |
| Inactive/unlinked user | No Gateway or ERP invocation |
| Customer/company-OA end user | Customer-visible catalog, FAQ, conversation, availability, confirmed booking, and PDPA flows only; zero ERP tools |

Every applicable employee row must be tested through direct web API, shared-OA local orchestration, and AgentCore. Customer rows must use the separate company-OA webhook and CRM agent family.

## Parallel Agent Execution Model

Use one integration coordinator plus at most three implementation agents per wave. Agents work on bounded modules and do not edit the same choke-point files concurrently.

### Coordinator-owned choke points

Only the integration coordinator edits these shared files during a wave:

- `packages/contracts/src/ai-tools.ts` and shared exports;
- `apps/api/src/modules/auth/permission-registry.ts`;
- `apps/api/prisma/schema.prisma` and migration timestamps;
- module provider arrays and root package test scripts;
- deployment environment/IAM wiring;
- canonical docs, checklist, roadmap, and task memory.

Implementation agents submit the exact contract, permission, schema, provider, and test-registration changes they require; the coordinator applies them serially before integration tests.

### Wave ownership

| Wave | Agent A | Agent B | Agent C | Integration gate |
|---|---|---|---|---|
| 0 | Baseline/tool parity red tests | Role/security red tests | Customer/receipt red tests | Dirty-tree manifest and failing-invariant evidence |
| 1 | AgentCore trust boundary and invocation lineage | Role assignment, disabled-role, effective-access safety | Customer audit actor, confirmation state, final guard | P0 security negatives all green |
| 2 | Canonical catalog and tool execution parity | Team/branch/source ABAC | Receipt pipeline, customer separation, rate/internal auth | All 38 entries and all roles have deterministic outcomes |
| 3 | OWNER/admin readiness UX and reason codes | Backfills, metrics, alarms, runbooks | Prod-shaped E2E and canary harness | Release candidate evidence and rollback drill |

No later wave starts on a work package whose security dependency is red. Independent packages inside the same wave may run in parallel.

## Phase P0 — Containment, Baseline, and Policy Freeze

### Goal

Prevent unsafe expansion while producing reproducible red tests for every audited gap.

### Tasks

- Inventory and preserve the existing dirty worktree; map local sales/receipt changes to this plan without resetting or assuming them complete.
- Keep customer auto-reply and booking commit OFF in production until C1-C4 pass.
- Route employee business-data turns through the guarded local path or disable ERP tools until A1 passes; do not authorize from AgentCore claims.
- Require role-management authority for any request carrying `roleIds` and reject draft activation with non-ACTIVE roles as the first containment patch.
- Disable factual context reuse when the turn has no authoritative invocation/source lineage.
- Freeze the implementation defaults and target tool disposition above in linked specs before behavior changes.
- Add failing tests for each SEC, ROLE, SCOPE, TOOL, CUST, RECEIPT, and OPS gap.

### Exit criteria

- Unsafe AgentCore ERP access and customer booking commit are not live.
- Every audited gap has a failing automated invariant or an explicit prod-shaped/manual acceptance case.
- Existing local changes are attributed to an owner and file set.
- No canonical checklist item is marked complete because of the plan alone.

## Phase P1 — Additive Data and Contract Foundations

This phase is coordinator-owned and lands before Wave 1 to avoid migration and contract collisions.

### Data foundations

- Replace fake audit users with a typed actor shape:
  - `actorType: USER | SYSTEM | CRM_CUSTOMER | SERVICE`;
  - nullable `actorUserId` only for `USER`;
  - stable non-PII `actorRefId` for customer/service actors.
- Add persisted booking proposal/confirmation state with tenant, customer, conversation, service, staff, branch, slot, source message, expiry, and idempotency keys.
- Add explicit team, team-member, and team-manager relations needed for MANAGER scope.
- Add or extend authoritative AI tool invocation records with membership, tool/version, scope and permission fingerprints, source references, policy result, and trace IDs.
- Add atomic cap/reservation and durable outbound/job fields only where existing primitives cannot provide the invariant.

### Contract foundations

- Extend canonical tool metadata with:
  - availability and execution surface;
  - `allOf`/`anyOf` permission requirements;
  - feature requirements;
  - supported agent/source owner;
  - bounded blocker reason;
  - registry version/fingerprint.
- Define explicit `ALL | RESTRICTED` scope semantics.
- Define the short-lived invocation-grant contract without authoritative permission/scope claims.
- Define customer booking proposal/confirmation DTOs and safe state transitions.

### Migration rules

- Migrations are additive first and support rolling deploys.
- Every backfill has dry-run counts, company partitioning, resumability, audit output, and idempotent reruns.
- Old application builds remain readable until the new build is fully promoted.
- No destructive cleanup or constraint tightening occurs before reconciliation reports are reviewed.

### Exit criteria

- Prisma validation/generation and contract builds pass.
- Old and new application versions can coexist during the migration window.
- Invalid actor, cross-company proposal, ambiguous scope, and missing lineage states are representable and fail closed.

## Workstream A — Trusted AI Runtime and Lineage

### A1. Authoritative invocation boundary

Tasks:

- API issues a short-lived, audience-bound invocation grant containing only user/company/membership/channel/request references, `jti`, issue time, and expiry.
- Protect internal routes with workload authentication; keep shared secret only during bounded rotation.
- At every tool call, the API verifies workload/grant, resolves current ACTIVE membership, roles, permissions, entitlements, teams, branches, locations, and LINE binding, then requires `ai.tool.invoke`, `line.ai.query` where applicable, tool feature, source permission, and ABAC.
- Ignore and reject caller-supplied authoritative context; bind actor and company server-side.
- Use the same authorization service for local and AgentCore execution.
- Return bounded denials: `feature_not_entitled`, `ai_permission_denied`, `source_permission_denied`, `scope_not_supported`, `tool_not_ready`, `dependency_unavailable`.

Likely files:

- `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/runtime.port.ts`
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts`
- `apps/ai-gateway/src/agentcore/runtime.ts`
- `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.ts`
- `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/access-control/`

Acceptance:

- Forged user, company, membership, permission, role, branch, location, or team fields have no effect.
- Permission, role, feature, membership, or scope revocation between model planning and execution denies the call.
- Local and AgentCore return the same decision for the same current actor.
- Expired, replayed, wrong-audience, modified, or cross-company grants are rejected before source access.

### A2. Invocation lineage and safe context reuse

Tasks:

- Persist each API-executed tool call before its result becomes reusable conversation context.
- AgentCore returns authoritative invocation IDs, tool status, duration, source references, and registry version; the model cannot manufacture the ledger.
- Re-resolve access on subsequent turns and scrub prior facts whose tool/source permission, entitlement, or scope fingerprint is no longer valid.
- Treat business answers with empty or missing lineage as non-reusable.
- Store only bounded safe previews; keep raw prompts and unnecessary PII out of logs/history.

Acceptance:

- Revoked permissions/scopes prevent both fresh reads and replay of prior facts.
- `toolsInvoked: []` cannot make a factual ERP answer reusable.
- Every factual response can be traced from LINE event to invocation, source reference, policy decision, and response.

## Workstream B — Employee Roles, Effective Access, and ABAC

### B1. Role-mutation safety

Tasks:

- Separate ordinary employee fields from role assignment.
- Reuse one assignment-policy service from create, update, draft completion, invite acceptance, and future bulk flows.
- Enforce active requester/target, same company, ACTIVE candidate roles, protected roles, self-change, last-owner, explicit delegability, requester scope, and entitlement checks inside the transaction.
- Filter non-ACTIVE roles in the permission resolver.
- Disable/quarantine draft attachments to disabled roles and revalidate on completion.
- Audit actor, target, before/after roles and scopes, reason, and correlation ID without secrets or identity documents.

Acceptance:

- MANAGER or a custom role cannot assign ADMIN, FINANCE, ACCOUNTANT, protected, or more-privileged custom roles.
- `access.employee.create` alone cannot choose a role.
- Disabled roles immediately cease contributing permissions and cannot reactivate through DRAFT.
- Self-elevation and last-owner removal fail in web and API.

### B2. Entitlement-aware role storage and effective access

Tasks:

- Reject new role grants outside active entitlements.
- Inventory historical out-of-entitlement grants and place them in an explicit review queue.
- Require audited review when feature activation would make historical grants effective.
- Make preview, save, access matrix, effective-access UI, and runtime use the same resolver.
- Return stored grants, effective grants, removed-by-entitlement grants, full scope, and denial reasons.
- Backfill explicit entitlement rows before removing legacy fail-open behavior.

Acceptance:

- Role preview, saved role, web effective access, LINE, and AgentCore agree.
- Feature enablement never silently activates a hidden custom grant.
- OWNER, ADMIN, standard roles, and custom roles have stable automated entitlement matrices.

### B3. Team, branch, location, assignment, and own-data ABAC

Tasks:

- Add real team relationships and populate `teamIds` in trusted context.
- Apply employee PII policy: OWNER/ADMIN company scope, MANAGER managed team, operational employee self-only unless separately granted.
- Propagate trusted roles/scopes through dashboard snapshots, inventory health, ledger, tax, reports, accounting/AP, workflow, and employee tools.
- Add source predicates and indexes. If a source record cannot be attributed safely, restricted callers receive `SCOPE_NOT_SUPPORTED`, not a company-wide result.
- Backfill deterministic branch attribution; quarantine ambiguous records from restricted aggregates.

Acceptance:

- MANAGER sees only managed teams and assigned branches/locations.
- STAFF sees only self-owned data.
- Restricted users never receive company-wide dashboard, stock, ledger, tax, accounting/AP, report, or workflow totals.
- Role-assigned workflow tasks remain visible to authorized role members.

## Workstream T — Canonical Tool Catalog and Execution Parity

### T1. Single descriptor and build gate

Tasks:

- Derive router enabled/disabled sets, effective per-user catalog, readiness endpoint, deterministic fallback selection, and documentation tables from canonical descriptors.
- Add one pure `allOf`/`anyOf` permission-and-feature evaluator used by policy, preview reuse, routing, specialist preflight, and tests.
- Validate every enabled permission against the canonical permission registry.
- Export runtime binding manifests from Gateway and API for parity tests without putting Nest instances into contracts.
- Fail closed on API/Gateway/AgentCore registry fingerprint mismatch.

Acceptance:

- CI fails if an enabled model tool lacks a router route, exactly one compatible specialist, client path, API dispatch/provider, canonical permission, or source handler.
- Planned and attachment-intake entries cannot be model-called.
- Legacy readiness is derived and accurate for all 38 entries.

### T2. Repair currently enabled execution gaps

Tasks:

- Remove the stale `accounting.get_summary` client block.
- Add both notification tools to their routed specialist with response shaping.
- Add `inventory.search_products` to InventoryAgent.
- Align stock balance to product + report permissions.
- Align expense list/breakdown to `anyOf` read/review/read-own and enforce own/branch ABAC.
- Fully wire `reports.get_monthly_report_summary` through a specialist and source permission checks.
- Keep tool budget, mutation refusal, input validation, timeouts, and source references intact.

Acceptance:

- Every target model tool in this package has a successful API path and a denial path.
- No enabled tool overlaps a client-unimplemented set.
- Accounting, notification, product-search, and report questions produce source-backed responses.

### T3. Complete safe read-only source adapters

Tasks:

- Add CRM follow-up suggestion, bank balance/reconciliation status, and pending reimbursement approval adapters.
- Apply their owning feature, source permission, assignment/branch/team scope, bounded response size, and redaction policy.
- Never expose bank credentials, full account numbers, payment execution, approval mutation, or CRM mutation.

Acceptance:

- The four tools are enabled only after focused happy, denial, ABAC, and cross-company tests pass.
- AUDITOR remains read-only; operational roles see only assigned/own scope.

## Workstream C — Customer End-User AI and Public Boundaries

### C1. Typed audit actors and atomic audit behavior

Tasks:

- Migrate registration, auto-reply, holding, booking, and customer actions to typed actors; eliminate literal `system` in user FKs.
- Make customer/identity creation plus audit atomic, or use a durable audit outbox that cannot silently drop.
- Fail closed before external send/booking if durable policy/audit evidence cannot be recorded.
- Reconcile existing invalid/orphan actor values with a dry-run report.

Acceptance:

- Real-Postgres registration never commits then returns an audit-FK 500.
- Every autonomous send/holding/booking has a valid durable actor and correlation chain.
- Audit failures are alerted and never swallowed silently.

### C2. Persisted booking confirmation state machine

States:

`DRAFT -> PROPOSED -> AWAITING_CONFIRMATION -> CONFIRMED -> COMMITTING -> BOOKED`

Terminal states: `EXPIRED`, `CANCELLED`, `CONFLICTED`, `HANDED_TO_STAFF`.

Tasks:

- Separate availability, create, change, cancel, confirmation, status, and unclear intents.
- AI only classifies/extracts bounded candidates; deterministic code owns transition eligibility.
- Persist tenant/customer/conversation/service/staff/branch/slot/source/expiry/idempotency evidence.
- Availability questions only return available slots/proposals.
- Create commits only after an affirmative reply tied to one active proposal.
- Change/cancel never create a new booking; route to a deterministic verified flow or staff.
- Recheck slot and all final gates under transaction/lock; confirmation retries are idempotent.

Acceptance:

- “พรุ่งนี้บ่ายสองว่างไหม” creates zero bookings.
- “ขอยกเลิกนัดพรุ่งนี้” creates zero new bookings.
- A valid explicit confirmation creates exactly one booking.
- Concurrent/retried confirmations have one winner and preserve source evidence.

### C3. Final-boundary guard and atomic reservations

Tasks:

- Immediately before send, holding, proposal, or booking, reload global flag, active channel, conversation toggle, latest consent, customer/identity, active staff, active branch, published catalog item, confidence/action class, cap reservation, proposal state, and tenant ownership.
- Claim autonomy jobs and cap slots with compare-and-set/atomic reservation.
- Use transaction plus staff/slot lock for booking.
- Cancel pending jobs/proposals when consent is revoked or channel is disabled.
- Make outbound states durable and retry-safe.

Acceptance:

- Mid-evaluation consent revoke or channel/toggle OFF yields zero automated action.
- Disabled staff/branch before commit hands off to staff.
- Concurrent turns cannot exceed channel/conversation caps.
- One staff/slot interval cannot receive two bookings.

### C4. Rate limit and internal service authentication

Tasks:

- Reuse one trusted-proxy resolver; behind ALB use the last trusted forwarding hop.
- Use Redis-backed limits for LIFF registration, webhook/job ingestion, and internal AI routes with bounded key cardinality.
- Scope credentials by route family so CRM credentials cannot invoke employee ERP routes.
- Prefer private service connectivity. Where public ingress remains necessary, use workload identity or short-lived service credentials with audience/scope, rotation, replay protection, WAF/application limits, and auth metrics.
- Rotate from current shared secrets with an overlap window; never log credentials.

Acceptance:

- A public user JWT cannot call an internal AI route.
- CRM service credentials cannot call employee ERP tools.
- Spoofed first-hop XFF does not bypass registration limits.
- Credential rotation causes no downtime and provider/model calls do not occur after internal-auth failure.

### C5. Customer capability and PDPA lifecycle

Tasks:

- Keep all CRM customer agent tool allowlists empty and context customer-visible only.
- Provide an audited customer request flow for consent withdrawal, export, and erasure; staff review may remain required for legally retained finance records.
- Cancel pending autonomy on withdrawal and use the same lock/final guard as inbound automation.
- Test tenant-safe export, exempt-record justification, media/text erasure, and registration/provider identity binding.

Acceptance:

- Customer OA cannot invoke any employee, expense, accounting, bank, tax, report, or workflow tool.
- Withdrawal during an AI turn prevents outbound action.
- Export and erasure cannot cross customer or tenant boundaries.

## Workstream R — Receipt and Media Intake

### R1. Deterministic durable intake

Flow:

`signed shared-OA event -> linked active user -> active company context -> canonical upload permission + entitlement + branch scope -> persist original bytes/text -> classify -> OCR/extract -> duplicate check -> reviewable draft -> Thai summary + web review link`

Tasks:

- Remove receipt processing stages from model-callable lists and route attachment orchestration directly to API-owned intake services.
- Use canonical permissions for LINE upload and review; do not invent executable `expense.receipt.read` unless the owning permission model adopts it.
- Persist original JPEG/PNG/PDF bytes before OCR; webhook acknowledgement is not coupled to slow OCR.
- Idempotency covers provider event ID, message ID, attachment ID, and company-scoped file hash.
- Correlate text followed by image when unambiguous; never create duplicate drafts.
- OCR/provider failure still produces a manual-review draft with an honest reason.
- Authenticity output is evidence-based or typed unavailable; never fabricated.

Acceptance:

- OWNER and permitted employees can submit text, photo, PDF, and mixed text/photo.
- Duplicate delivery produces one intake/draft.
- OCR down preserves bytes and a reviewable record.
- Feature-off, permission-denied, and runtime/OCR failures return distinct messages.

### R2. Screenshot regression and channel separation

Tasks:

- Add OWNER default-package and all-feature-package tests for `/company`, sales questions, expense text, and receipt media.
- Verify branch-restricted employee intake and negative permission cases.
- Prove company-OA customer webhook cannot reach shared-OA expense intake.
- Add real LINE canary cases for JPEG, PNG, PDF, text-only expense, and text-plus-image.

Acceptance:

- The reported OWNER sales and receipt journeys pass in the deployed release.
- Customer OA attempts are handled as customer conversation content and never create ERP drafts.

## Workstream U/O — OWNER UX, Readiness, and Observability

### U1. Effective availability UX

Tasks:

- Admin onboarding/company detail shows active features, LINE AI state, tools available to OWNER, tools locked by entitlement, and truly planned/runtime-unavailable tools.
- LINE copy distinguishes feature package, role permission, unsupported scope, tool not ready, and temporary dependency failures without leaking policy internals.
- A full/demo onboarding preset writes explicit audited entitlement rows; no deploy-time backfill expands existing companies.

Acceptance:

- OWNER never sees “feature not enabled” for a runtime/OCR/tool wiring failure.
- Web, nav, API, readiness, and LINE availability change together when entitlement changes.

### O1. Readiness, metrics, and alerts

Expose sanitized readiness per tool:

- registry version/fingerprint;
- declared availability and execution surface;
- effective feature/permission status;
- router/specialist/client/API/source readiness;
- bounded blocker reason.

Record bounded events and metrics for:

- internal tool auth denials and context mismatches;
- role assignment denial and disabled-role attachment;
- scope filters and unsupported-scope denials;
- invocation latency/status by tool and runtime;
- feature vs permission vs runtime failures;
- conversation context scrubbing;
- customer proposal/confirmation/expiry/conflict;
- final-boundary consent/channel denial;
- cap reservation/overshoot;
- receipt download/persist/OCR/manual-review/duplicate;
- internal-auth failure and registry-version mismatch.

Do not use raw prompts, receipt bytes, tokens, customer text, or high-cardinality user/company IDs as metric dimensions.

Acceptance:

- Readiness cannot report ready when any execution layer is missing.
- Alerts distinguish security/policy denials from provider or source dependency failures.
- One trace links webhook, job, invocation/proposal, source, outbound/booking, and audit.

## Verification V1 — Build-Blocking Test Matrix

### Static and focused tests

- Canonical descriptor uniqueness and permission/feature validity.
- Router, specialist, client, controller, provider, source handler, and readiness parity.
- Local and AgentCore policy/result parity.
- Every enabled adapter has happy, permission-denied, feature-off, cross-company, input, and relevant ABAC tests.
- Role assignment negative cases, disabled-role DRAFT, self-elevation, last-owner, dormant grants, and feature activation.
- Explicit empty/restricted scope behavior.
- Thai/English booking intent and confirmation phrase matrix.
- Mid-turn consent/channel/staff/branch revocation races.
- Cap and booking concurrency.
- XFF spoof, internal credential scope, replay, wrong audience, and registry mismatch.
- Receipt text/photo/PDF/mixed/duplicate/OCR-down.
- Customer-agent empty tool allowlists and cross-channel negative paths.

### Role/runtime matrix

Run every applicable role in the Role and Identity Acceptance Matrix across:

- direct web API;
- shared-OA local orchestration;
- AgentCore;
- feature enabled and disabled;
- unrestricted and restricted branch/location/team scopes;
- active, disabled, and revoked membership/role states;
- multi-company selection;
- permission or scope revocation between planning and execution.

### Prod-shaped E2E rig

Run API, web, AI Gateway, workers, Postgres, Redis, object storage, fake LINE, and fake provider together:

1. Shared-OA OWNER asks `/company`, sales, alerts, inventory, accounting, tax, workflow, and report questions.
2. Restricted employee receives only own/team/branch data through local and AgentCore.
3. Customer/company-OA conversation reaches zero ERP tools.
4. Customer availability proposal requires confirmation and commits one booking.
5. Consent/channel revocation during a pending turn yields no send or booking.
6. LIFF registration uses a verified identity and survives real DB audit constraints.
7. Shared-OA receipt text/photo/PDF creates one durable reviewable draft.
8. Internal service credentials fail outside their route/tool scope.
9. Permission/feature/role revocation invalidates prior factual context.

### Standard commands

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
CI=true corepack pnpm --filter @watchdog-bms/contracts build
CI=true corepack pnpm --filter @watchdog-bms/config test
CI=true corepack pnpm --filter @watchdog-bms/api test
CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test
CI=true corepack pnpm --filter @watchdog-bms/web test
CI=true corepack pnpm --filter @watchdog-bms/api typecheck
CI=true corepack pnpm --filter @watchdog-bms/ai-gateway typecheck
CI=true corepack pnpm --filter @watchdog-bms/web typecheck
e2e/run-local.sh --grep @smoke
e2e/run-local.sh <new-ai-permission-e2e-files>
git diff --check
```

Any new API spec must be registered in the hand-maintained `apps/api/package.json` test list.

## Migration and Backfill Runbook Requirements

Before enforcement:

1. Report all memberships linked to disabled roles, including DRAFT.
2. Report non-OWNER/ADMIN users holding privileged roles; do not auto-demote without owner review.
3. Backfill team relations; unmapped MANAGER access defaults to own-only/deny.
4. Backfill deterministic branch attribution; mark ambiguous records unscoped and exclude them from restricted aggregates.
5. Backfill explicit company entitlements before fail-closed legacy behavior.
6. Reconcile out-of-entitlement custom grants into a review queue.
7. Backfill typed audit actors; quarantine invalid actor rows with a report.
8. Mark old factual conversation turns without trustworthy lineage non-reusable.
9. Add required indexes for active membership/role/team/branch resolution, proposal idempotency, cap reservation, and invocation-grant replay checks.

Every script supports `--dry-run`, company batching, resume cursor, stable counts, and safe rerun. Backfill summaries are retained as release evidence.

## Production Rollout

1. Keep customer automation and unsafe AgentCore ERP tools OFF.
2. Deploy additive schema and reconciliation/report code.
3. Deploy API with canonical resolver, typed audit actors, role safety, and backward-compatible contracts.
4. Run dry-run backfills; review counts; execute and verify before enforcement flags.
5. Deploy matching AI Gateway and AgentCore artifacts from the same immutable commit and registry fingerprint.
6. Shadow-compare caller context with server-resolved context; mismatches never authorize.
7. Canary internal test companies:
   - standard-package OWNER;
   - all-feature OWNER;
   - restricted STAFF/SALES/INVENTORY/MANAGER;
   - company-OA test customer.
8. Enable employee reads by risk: OWNER/ADMIN, own-scope employee, branch roles, then MANAGER/team; enable ledger/tax/report only after source ABAC passes.
9. Enable customer phases independently: staff-only, proposal-only, informational reply, confirmed booking commit.
10. Promote 1% -> 10% -> 50% -> 100% only after denial/error/latency/data-scope and audit review.
11. Run real shared-OA and company-OA LINE canaries, object-storage receipt proof, and rollback drill.
12. Update checklist status only after production evidence is recorded.

## Rollback

- Independent kill switches disable AgentCore ERP tools, customer informational reply, booking proposal, booking commit, and receipt OCR while preserving staff inbox and web review.
- Roll back API, Gateway, and AgentCore as one immutable release bundle with compatible registry fingerprint.
- Keep server-side authorization, role safety, and final-boundary guards enabled during every rollback.
- Keep additive schema and audit history; do not drop data to roll back application behavior.
- Pending proposals expire/cancel and never auto-commit after rollback.
- Receipt intake falls back to durable manual review.
- Internal credentials support a bounded old/new rotation window; compromised credentials are revoked independently by route family.
- Never roll back to caller-authoritative permission/scope claims or fail-open entitlements.

## Definition of Done

This production gate closes only when all conditions are true:

- all 38 catalog entries match the target disposition table;
- zero enabled model tool has a router/specialist/client/API/source mismatch;
- zero enabled tool uses a non-canonical or runtime-divergent permission expression;
- API, local orchestration, and AgentCore resolve identical current authorization and scope;
- role assignment cannot elevate above explicit delegation, and disabled roles never authorize;
- OWNER, standard roles, custom roles, restricted scopes, inactive identities, and customer end users pass the matrix;
- no restricted actor receives company-wide data from unsupported source modules;
- customer agents have zero ERP access, zero booking without persisted confirmation, and zero automated action after final-boundary revoke/disable;
- every automated action and factual response has durable valid actor, policy, lineage, source, and trace evidence;
- receipt text/photo/PDF/mixed/OCR-down paths create one durable reviewable result and customer OA cannot reach them;
- readiness, UI, and LINE copy distinguish entitlement, permission, scope, implementation, and temporary failures accurately;
- focused, full package, prod-shaped E2E, real Postgres/Redis/object-storage, and live LINE canary evidence pass;
- canary metrics remain within agreed thresholds and rollback drill succeeds;
- linked specs, permission matrix, runbooks, checklist, roadmap, and task memory match deployed truth.

## Explicitly Not Done in This Planning Pass

- no production code edited;
- no Prisma schema or migration created;
- no permission, role, entitlement, or customer record changed;
- no environment flag changed;
- no AWS resource, deployment, or live LINE configuration changed;
- no existing company feature package expanded;
- no checklist item marked implemented or production-ready.

---

# Review Synthesis, Corrections, and MVP1 Scope Cut (2026-07-12)

Two independent reviews ran against the live code before implementation: Codex CLI (gpt-5.6-sol, xhigh, read-only) and a 17-agent Claude verification workflow (8 family verifiers plus adversarial rechecks and two implementation-surface maps). Both were adversarial and instructed to refute. This section records their consensus, the corrections they forced, the gaps they added, and the owner-approved reduction of this pass to MVP1 capabilities only.

## Review consensus

The gap ledger is accurate. Every SEC, CUST, TOOL, RECEIPT, and OPS claim in scope was independently CONFIRMED against file:line evidence by both engines, with the specific refinements below. No in-scope gap was refuted. Catalog math is correct: 38 canonical entries, 27 router-enabled, 7 explicitly disabled, 4 `receipt.*` outside both router sets. The name-by-name 38-entry table matches `packages/contracts/src/ai-tools.ts` exactly.

## Corrections to existing gap descriptions

- **Catalog reachability wording.** "23 orchestrator-reachable" is imprecise. Actual: 24 tools are admitted by specialist allowlists; of those `accounting.get_summary` is short-circuited to `unsupported_module` in the gateway client before any HTTP call, leaving 23 able to issue an API request. Use "24 specialist-visible / 23 API-call-capable."
- **SEC-05 cause is wrong.** Local and AgentCore do NOT run different authorization code — both construct the same `OrchestratorAgent` → `ErpToolClient` → internal route. Divergence comes from (1) the lossy AgentCore payload contract that drops `membershipId`/`branchIds`/`locationIds` (SEC-01), (2) a second deployment process reading its own env policy flags, and (3) response post-processing that drops lineage (SEC-04). Do not "merge two authz implementations"; fix the payload contract and lineage return, and pin the env flags at deploy time.
- **SEC-01 also drops `roles` on BOTH paths.** `ErpToolContext` has no `roles` field and `toCtx` hardcodes `roles: []`, so roles are never used for tool authz anywhere. AgentCore-specific losses are `membershipId`/`branchIds`/`locationIds`. Concrete impact: `balance.query.ts` only applies the branch filter when `branchIds` is present, so on the AgentCore path branch ABAC is silently dropped.
- **CUST-03 is narrower than written.** The conversation `autoReplyEnabled` toggle IS already re-read after model evaluation (non-atomically), and the dirty working tree already added `withLiveCustomerLock` around the send that re-reads customer liveness and REVOKED consent. Residual gap: the final boundary still does not reload channel status/toggle or the global flag, and the toggle recheck is not atomic with the send/commit. Make the existing rechecks atomic and add channel/global reloads — do not re-add the toggle recheck.
- **CUST-04 is understated, not a pure race.** The autonomous booking path has NO active-staff/active-branch gate at any point; `findStaffDefaultBranch` does not filter membership status and `CrmBooking.branchId`/`staffUserId` carry no FKs. Red tests must cover the non-race case (staff/branch already disabled before evaluation), not only mid-evaluation disable.
- **RECEIPT-01 remediation is largely a no-op as written.** The four `receipt.*` tools are already unreachable by any model tool-choice path (`supportedAgents: []`, absent from ROUTER_ENABLED and every specialist allowlist); the two receipt agents run a deterministic for-loop, not model selection, and the orchestrator receipt branch is dead for production intake (the API media path never calls `line-turn` with attachments). Real work is registry hygiene: delete the four metas, the two dead agents, the orchestrator branch (`orchestrator.agent.ts:244-256`), and the `erp-tool.client.ts` blocklist entries.
- **RECEIPT-02 must be split; two sub-claims are inaccurate.** Bytes ARE already persisted to object storage before the OCR call, and OCR failure DOES already produce a durable `NEEDS_REVIEW` draft. The real residuals are: (a) media-path idempotency keyed on `lineMessageId`/attachment/`checksumSha256` plus an atomic event-log claim (today `find`-then-`create` with `.catch(()=>{})`); (b) persist bytes before the CLASSIFY model call (not before OCR — that already holds); (c) the dishonest `NOT_CONFIGURED` reason that conflates "OCR down" with "OCR never configured"; (d) the local storage adapter writes to `os.tmpdir()` and is not durable across restart (only S3/MinIO is).
- **RECEIPT-03 framing is wrong.** Unit regression tests for the mixed receipt-media + sales-question scenario already exist and are registered at HEAD (`line-intake-dispatch.use-case.spec.ts`). The real gap is: no single test binds OWNER role + default entitlement package + media in one journey, no cross-process E2E (webhook signature → buffer → dispatch → gateway → OCR), and no LINE media canary (the local smoke script cannot even send media).
- **TOOL-03 has no current authorization effect.** The permission-metadata drift corrupts catalog/readiness/docs only; the source check (`anyOf`) is authoritative and correct-shaped, and the gateway policy layer never evaluates `requiredPermissions` beyond `[0]`. This is a metadata-correctness fix, not a live authz hole.
- **TOOL-01 mechanism differs by tool.** `notifications.*` and `inventory.search_products` are never offered to the model (missing from specialist allowlists); `accounting.get_summary` IS offered, burns a tool call, and always fails from the gateway client — the model sees a "working" tool that always returns `unsupported_module`.

## New production gaps both engines surfaced (in MVP1 scope)

- **CUST-10 — booking reminder sweep sends automated LINE pushes with no consent check.** `scan-crm-booking-reminders.use-case.ts:52-67` checks only channel status and link, never `consentStatus`. Disposition: gate reminder pushes on the same consent/final-boundary rules as inbound autonomy. Work package: C3.
- **CUST-11 — fire-and-forget durability holes in sweeps.** `retry-crm-inbox-deliveries.use-case.ts:104-108` uses `void outbox.append(...)` and `void audit.log(...)`; an FK-rejected audit becomes an unhandled rejection (process-terminating on Node ≥15), and outbox writes can silently drop. Disposition: await + durable-outbox both. Work package: C1.
- **RECEIPT-05 — mixed receipt+question message silently drops media.** When a media message carries a caption classified `BUSINESS_READ_QUESTION`, the image/PDF bytes are discarded with no draft, attachment, or record; only the caption is answered (`process-line-webhook.use-case.ts:1032-1038`, locked in by a test). This is the plausible root of the OWNER screenshot regression. Work package: R1.
- **RECEIPT-06 — failed receipt intake is unrecoverable.** Any error marks the webhook event log terminal (`receipt_upload_error`/`media_download_failed`), and both the use-case dedup and the buffer redelivery guard drop redelivered events whose row is non-`received`, so LINE's automatic redelivery can never retry a transiently failed receipt. Work package: R1.
- **SEC-06 — more than one public shared-secret internal route, plus timing-unsafe compares.** Beyond `internal-tools.controller.ts`, `@Public()` shared-secret routes also exist at `line-ai-ledger-internal.controller.ts`, and `crm-internal.controller.ts` / `crm-ai-internal.controller.ts` compare the worker token with plain `!==` (timing-unsafe); `GET /internal/ai/agents` readiness is fully unauthenticated. The internal-boundary audit also records the caller-supplied identity and skips denials. Fold into the SEC-02/CUST-07 boundary hardening. Work package: A1/C4.
- **OPS-05 — current-tree hygiene defects.** `apps/api/package.json` registers a nonexistent `expense-branch-scope.spec.ts` (real file is `.use-case.spec.ts`) so verification silently skips it; the committed CRM migration was edited in place (+110 lines vs `31b17c97`) risking drift if already applied to any DB; CI triggers only on `main`/`develop`, so `develop` gets zero CI; and `apps/web/.next-customer-build/` is untracked build output polluting the worktree. Work package: P0a.

Out-of-scope new gaps were also recorded but deferred (employee weak initial credential = date-of-birth, draft-resume account rewrite, credential-regeneration lacks protected-target guard, role-disable/assign race, tax/dashboard schema and cache scope holes, first-XFF spoof duplicated in the auth controller, AgentCore playground-payload default identity, unbounded AgentCore request body). These belong to the full (non-MVP1) pass.

## Owner-approved MVP1 scope cut (2026-07-12)

This pass is reduced to the AI capabilities that are live-or-imminent for MVP1: expense/reimbursement, receipt/bill intake, and CRM customer-facing AI (conversation, booking, consent, customer identity). Only the security prerequisites those capabilities actually ride are included.

**In scope**

- Trust-boundary prerequisite (the expense/accounting/CRM tools all ride the one insecure internal route): SEC-01, SEC-02, SEC-03, SEC-04, SEC-06. MVP1 cut of SEC-02/03 = the internal route ignores caller-supplied `permissions`/scope and re-resolves them server-side from the DB by authenticated `companyId`+`userId`, and re-checks `ai.tool.invoke` at the execution boundary. Full workload-identity/short-lived-grant rotation (mTLS, audience-bound grants) is a follow-on, not MVP1.
- Customer AI autonomy and booking: CUST-01, CUST-02, CUST-03, CUST-04, CUST-05, CUST-06, CUST-07, CUST-08, CUST-09, CUST-10, CUST-11.
- Receipt/media intake: RECEIPT-01, RECEIPT-02, RECEIPT-03, RECEIPT-04, RECEIPT-05, RECEIPT-06.
- Expense/accounting/CRM tool truthfulness: TOOL-01 (accounting.get_summary block only), TOOL-03 (expense metadata only), TOOL-04 (expense.receipt.read → canonical or removed), TOOL-06 (reimbursement.list_pending_approvals + crm.suggest_sales_followups only — NOT bank).
- Ops: OPS-04 (dirty-tree ownership), OPS-05 (current-tree hygiene), OPS-01 scoped to MVP1 tools' parity only.

**Out of scope (deferred to the full pass)**

- Tools: bank×2, hr, all tax, all workflow, inventory, ledger, dashboard, notifications, reports (general), employee-PII tools.
- Families: ROLE-01..06 (employee role governance), SCOPE-01/02/03/04 general team/branch ABAC (retain only expense own/branch narrowing that TOOL-03 already enforces), TOOL-02/05/07/08 general catalog/readiness/UX, OPS-02/03 general matrix/observability.

## Revised sequencing (supersedes the single P0 red-test wave)

The original "add failing tests for every gap" P0 is replaced, per both reviewers, to avoid landing dozens of red tests that poison every lane's integration signal and to respect the shared dirty tree:

- **P0a — coordinator only.** Dirty-tree ownership manifest and kill-switch verification: confirm customer auto-reply and booking commit are OFF in prod config; attribute all 40 dirty files to their owner; fix OPS-05 hygiene (test-registration typo, `.gitignore` the customer build output, note the migration-drift risk); do not reset or commit another session's WIP.
- **P0b — containment with focused tests, package-local.** Immediate low-risk guards each shipped with their own passing test, not a repo-wide red wave: require role-management authority for `roleIds` (out of MVP1 — skip), block AgentCore ERP claims / disable factual context reuse without lineage, and the MVP1 containment: internal route stops trusting caller permissions.
- **P1 — additive schema/contracts (coordinator).** Typed audit actor, booking proposal/confirmation state extending `CrmAutonomyJob`, atomic cap reservation fields, invocation lineage — additive, rolling-deploy-safe.
- **Waves — per-package red→green slices**, not a universal red wave: each work package lands its failing test immediately followed by its implementation, cross-reviewed, then merged.

## Expanded coordinator-owned choke points

Add to the original choke list: `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts` (tool binding map), API and Gateway `line-ai.module.ts`, `crm-inbox.module.ts`, root `app.module.ts`, shared internal-auth guards/middleware, generated Prisma client refresh, and migration ordering.

## Owner decisions (2026-07-12) resolving the two open questions

1. **Consent model — RESOLVED: keep spec §28 (opt-out).** The earlier Implementation Default ("require GRANTED or NOT_REQUIRED; UNKNOWN never auto-sends") was WRONG — it contradicted the canonical owner decision in CRM LINE OA spec §28 (2026-07-10): `REVOKED` blocks every automated send; `UNKNOWN`, `GRANTED`, `NOT_REQUIRED` pass (Level 0 serves everyone, incl. new/unscored customers); a missing customer row fails closed. The current code already implements this (`crm-ai-auto-reply.use-case.ts:58` blocks only `REVOKED`). **No consent-gating code change.** The C3 work is to make that `REVOKED` check ATOMIC at the final send/booking boundary and to also reload channel status/toggle and the global flag there — not to change which consent states pass. This plan's Implementation Default #7 is superseded by §28.
2. **Mixed receipt-media + business-question — RESOLVED: clarify once.** When a media message carries a caption the intake router classifies as `BUSINESS_READ_QUESTION`, do NOT silently discard the image (current behavior) and do NOT auto-create a draft. Instead reply once asking whether the image is a receipt to record or an illustration for the question, then route on the reply. RECEIPT-05 (R1) implements a CLARIFY branch reusing the existing intake CLARIFY infrastructure; no spurious drafts, no lost receipts, one extra round-trip. The `defer_text` path (`process-line-webhook.use-case.ts:1037`) is replaced by this clarify-for-media-with-question branch.

## Verdict

Both engines: proceed. Codex verdict was GO-WITH-CHANGES for a coordinator-first P0a/P0b (not the simultaneous three-agent Wave 0). All required changes are folded into this synthesis. The harness, lane split, and dirty-tree handling are in `docs/agent-memory/ai-permission-tools-mvp1-harness.md`.
