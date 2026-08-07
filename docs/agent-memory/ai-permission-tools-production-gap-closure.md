# Agent Memory: AI Permission and Tool Production Gap Closure

Status: REVIEWED + SCOPED TO MVP1; P0a STARTED. Gap ledger CONFIRMED by two independent reviews (Codex 5.6 xhigh + Claude 17-agent workflow). Harness live: [[agent-memory/ai-permission-tools-mvp1-harness]].

Review outcome 2026-07-12:
- Both engines independently CONFIRMED every in-scope SEC/CUST/TOOL/RECEIPT/OPS claim against file:line. No in-scope gap refuted. Catalog math correct (38/27/7/4).
- Corrections folded into the plan's "Review Synthesis" section: catalog reachability 24 specialist-visible/23 API-call-capable; SEC-05 is a lossy payload contract + second-process env flags, NOT divergent authz code; CUST-03 narrower (toggle recheck + withLiveCustomerLock already exist in dirty tree, residual = atomic + channel/global reload); CUST-04 understated (no active-staff/branch gate at all); RECEIPT-01 is registry hygiene (tools already model-unreachable); RECEIPT-02 split (bytes-before-OCR + manual-review draft already exist; real work = media idempotency + honest OCR reason + durable local storage); RECEIPT-03 tests exist at HEAD (gap = OWNER-journey binding + E2E + canary); TOOL-03 no live authz effect.
- New in-scope gaps added: CUST-10 (booking reminder sweep no consent), CUST-11 (void audit/outbox in retry sweep), RECEIPT-05 (mixed msg drops media — likely OWNER-screenshot root cause), RECEIPT-06 (terminal status blocks LINE redelivery retry), SEC-06 (more public shared-secret routes + timing-unsafe token compare), OPS-05 (broken test registration, in-place migration edit, CI skips develop, untracked build output).
- MVP1 scope cut (owner order): IN = SEC-01..04+06 (prereq; MVP1 SEC-02/03 = server re-resolve caller perms, full grant rotation deferred), CUST-01..11, RECEIPT-01..06, TOOL-01(accounting)/03/04/06(reimb+crm only), OPS-04/05. OUT = bank/hr/tax/workflow/inventory/ledger/dashboard/notifications/reports/employee-PII tools, ROLE-01..06, SCOPE general, TOOL-02/05/07/08, OPS-02/03.
- P0a finding: kill-switch = CRM_AUTO_REPLY_ENABLED (packages/config/src/index.ts:74, default FALSE) gates all autonomous auto-reply + booking commit. Keep FALSE in prod until C1-C4 pass. AuditLog.actorUserId is a REAL enforced FK to User(id) (no seeded 'system' user) — CUST-01 breaks real-DB LIFF registration.

OPEN POLICY DECISION (owner): plan default "UNKNOWN consent never auto-sends" contradicts canonical CRM LINE OA spec §28. Proceeding with the safer deny default; blocks C3 acceptance until owner confirms which is canonical.

Original status: DOCS READY FOR IMPLEMENTATION HANDOFF; NOT IMPLEMENTED
Owner: Product / Auth-RBAC / AI Gateway / ERP Core / CRM / Production Ops
Scope: Cross-cutting production remediation for AI tool catalog and execution parity, AgentCore trust, employee role/permission/ABAC safety, customer end-user AI autonomy, receipt intake, verification, and rollout.
Decisions:
- The API is the sole authority for active identity, membership, permissions, entitlements, roles, and scopes.
- OWNER does not bypass feature entitlement.
- Every catalog entry must be either executable model tool, deterministic attachment intake, or truthful planned capability.
- Target catalog disposition is 32 model tools, 5 receipt-intake capabilities, and 1 planned HR tool.
- AgentCore receives identity references only; API re-resolves current authorization for each tool invocation.
- Role assignment is separate from ordinary employee editing and uses one transaction-safe assignment policy.
- MANAGER is team/branch scoped; unknown team scope fails closed.
- Customer/company-OA agents have zero ERP tools.
- Customer automated outbound requires GRANTED or NOT_REQUIRED consent.
- Booking requires a persisted proposal and explicit customer confirmation before atomic commit.
- Receipt image/PDF/text remains a deterministic, API-owned shared-OA intake flow, not a model-selected ERP tool.
- Customer automation and unsafe AgentCore ERP access stay off until the relevant security gates pass.
Open questions:
- Exact AWS workload-auth mechanism for the deployed AgentCore-to-API path must be selected from the current supported private/IAM/mTLS options during Phase P0; shared secret is transitional only.
- Canary thresholds and tenant allowlist require production owner/ops sign-off before rollout.
Artifacts:
- `docs/plans/ai-permission-tools-production-gap-closure-plan.md`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/implementation-roadmap.md`
- `docs/agent-memory/ai-permission-tools-production-gap-closure.md`
Verification:
- Planning pass only; no runtime tests rerun and no production changes made.
- Source audit baseline recorded in the plan: focused API 211, AI Gateway/AgentCore/customer separation 102, AI Draft API 85, AI Draft Gateway 6, and relevant typechecks passed during the audit.
- Plan includes a complete gap ledger, all-38 tool disposition, role/end-user matrix, parallel workstream ownership, migrations/backfills, test matrix, rollout, rollback, observability, and Definition of Done.
Next:
- Start Phase P0 only after owner authorizes implementation.
- Preserve and inventory the existing dirty worktree before assigning implementation agents.
- Use one coordinator plus three bounded agents per wave; coordinator owns shared contracts, permission registry, Prisma schema/migrations, package test lists, deployment wiring, and canonical docs.
