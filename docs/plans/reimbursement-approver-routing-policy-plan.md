# Reimbursement Policy Correctness Implementation Plan

## Linked Artifacts

- Spec: [[specs/reimbursement-approver-routing-policy-spec|Reimbursement Policy Correctness and Role Routing Spec]]
- Parent: [[specs/reimbursement-approval-spec|Reimbursement and Approval Spec]] / [[plans/reimbursement-approval-plan|Reimbursement Approval Plan]]
- Task memory: `docs/agent-memory/reimbursement-approver-routing-policy.md`
- Roadmap: item 14 correctness follow-up in [[plans/master-implementation-checklist|Master Implementation Checklist]]
- Execution rules: ponytail full; existing patterns first; no dependency or `package.json` edit; focused runnable evidence for every non-trivial slice.

## Purpose

Make the whole policy page truthful and executable: one constrained approver role, real amount-threshold behavior, enforceable ACTIVE/INACTIVE status, frozen prospective policy facts, consistent queue/workflow/SLA delivery, concurrency safety, and zero-guess legacy handling.

## Frozen Decisions

- New route edits choose one role only. Server owns mode/user normalization.
- Routine approval notification/task targets the selected role; OWNER is routine only for fallback and is included in SLA escalation.
- Role options require complete capability, active holders, and safe branch/OWNER coverage.
- `approvalRequiredFromAmount` is the only executable threshold; amount equal to threshold requires approval.
- INACTIVE blocks new submission before mutation while drafts and in-flight work continue.
- Every new submission stores `approvalPolicySnapshotJson`; security facts remain current at action time.
- Below-threshold + finance on goes directly to FINANCE_REVIEW; below-threshold + finance off uses durable APPROVED/POLICY projection before READY_FOR_PAYMENT.
- Existing no-snapshot requests, named-user policies, and pending steps are not guessed or rewritten.
- A nullable snapshot column and raw partial unique index are required; duplicate company-policy rows block migration until explicitly resolved.
- Rollout remains expand Release A then switch Release B.

## Phase 0 — Read-Only Preflight and Worktree Protection

### Tasks

- [ ] Re-read the linked spec and reconfirm cited code/schema facts.
- [ ] Record `git status`; preserve unrelated worktree changes.
- [ ] Add a read-only classifier for duplicate NULL-branch policies, divergent threshold columns, legacy route shapes, inactive policies, and no-snapshot pending requests.
- [ ] Run against an isolated real-Postgres copy/fixture.
- [ ] If duplicate company-level policies exist, produce a restricted remediation artifact with ids/timestamps/audit references and stop. An authorized operator must select the canonical row.
- [ ] Record counts/evidence in task memory without tenant names or PII.

### Verification

- Classifier performs zero writes.
- Re-running it produces the same result.
- Duplicate rows cause a clear blocked precondition, not automatic cleanup.

### Exit

- Data is safe for the partial unique index, or implementation is explicitly blocked before migration.

## Phase 1 — Release A: Additive Schema and Runtime Expansion

### Files

- `apps/api/prisma/schema.prisma`
- new Prisma migration under `apps/api/prisma/migrations/`
- `apps/api/src/modules/workflow/application/use-cases/workflow-action-runner.use-case.ts`
- workflow runner specs
- reimbursement projection repository/orchestrator/reconciler and specs

### Tasks

- [ ] Add nullable `ReimbursementRequest.approvalPolicySnapshotJson Json?`.
- [ ] Add raw partial unique index on `ReimbursementPolicy(companyId) WHERE branchId IS NULL`.
- [ ] Synchronize `approvalThresholdAmount = approvalRequiredFromAmount` in migration SQL.
- [ ] Keep all readers tolerant of null snapshot.
- [ ] Add POLICY projection intent support for durable status APPROVED with no human approval step.
- [ ] Keep existing MANAGER/FINANCE intents unchanged.
- [ ] Let workflow recipient payload keys flatten scalar/array strings, dedupe, and ignore malformed values.
- [ ] Add payload-derived task role while retaining static `assigneeRole`.
- [ ] Do not change current policy API/UI/templates in Release A.

### Focused verification

```bash
pnpm --filter @watchdog-bms/api exec prisma validate
pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/workflow/application/use-cases/workflow-action-runner.use-case.spec.ts \
  src/modules/workflow/application/use-cases/workflow-task.use-case.spec.ts \
  src/modules/reimbursements/application/services/reimbursement-projection-reconciler.service.spec.ts
pnpm --filter @watchdog-bms/api typecheck
```

### Real-Postgres gate

- Apply every migration from zero.
- Apply over a pre-change schema fixture.
- Prove one NULL-branch policy succeeds and a concurrent second create violates the partial index.
- Prove old requests with null snapshot still load/execute.
- Prove threshold columns are equal after migration.

### Exit

- Release A is backward-compatible and accepted before any Release B template/API producer is deployable.

## Phase 2 — Contracts, DTOs, Snapshot Parser, and Pure Policy Evaluation

### Files

- `packages/contracts/src/reimbursements.ts`
- `apps/api/src/modules/reimbursements/presentation/http/reimbursement.dtos.ts`
- DTO/body-validation specs
- `apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts`
- domain specs
- web API error mapping

### Tasks

- [ ] Add role option/coverage/issue contracts and policy snapshot V1.
- [ ] Narrow policy update to spec §9.2.
- [ ] Add concrete runtime DTO; reject mode, user, deprecated threshold, server fields, and unknown fields.
- [ ] Add a versioned, fail-closed server snapshot parser; null means legacy, malformed non-null is an operational error.
- [ ] Add pure canonical role mapping.
- [ ] Add pure policy evaluation returning ACTIVE gate, threshold result, initial status, finance status, and whether a step/projection is required.
- [ ] Include snapshot in the new-request approval hash.
- [ ] Add stable Thai errors from spec §9.3.

### Tests

- [ ] Below/equal/above threshold and zero/decimal values.
- [ ] ACTIVE/INACTIVE matrix.
- [ ] MANAGER/OWNER/custom mapping and stale user clearing.
- [ ] Snapshot V1 serialize/parse/hash; null legacy; malformed non-null.
- [ ] DTO accepts every legitimate writable field and rejects all server-owned/deprecated fields.

### Verification

```bash
pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/reimbursements/presentation/http/reimbursement.dtos.spec.ts \
  src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts \
  src/common/pipes/body-validation-coverage.spec.ts
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/api typecheck
```

### Exit

- The complete state decision is executable as pure tested logic before database mutation changes.

## Phase 3 — Role Catalog, Holders, Coverage, and OWNER Recovery

### Files

- reimbursement routing service (new)
- reimbursement repository
- policy use case/controller/module
- focused role/branch/entitlement specs

### Tasks

- [ ] Load system/company roles, company overrides, entitlements, active holders, membership scopes, active branches, and OWNER readiness through tenant-bound reads.
- [ ] Reuse `loadEntitledFeatureKeys`, `filterPermissionsByEntitlement`, role override rules, and branch helpers.
- [ ] Exclude inactive/platform/incomplete-capability/zero-holder roles.
- [ ] Calculate COMPLETE/PARTIAL/NONE and uncovered branch names.
- [ ] Make PARTIAL selectable only when OWNER covers every uncovered active branch.
- [ ] Add manage-only `GET reimbursement-policy/approver-options`; do not require `access.role.read`.
- [ ] Classify current/legacy route without writes.
- [ ] Return only safe role/coverage/current-route facts.
- [ ] Use batched queries; no per-role/per-branch N+1.

### Real-Postgres tests

- [ ] System role and company override with same key.
- [ ] Role/user/membership ACTIVE/INACTIVE.
- [ ] Missing read/approve/reject individually and entitlement OFF.
- [ ] ALL/SELECTED/DEFAULT scope, central, complete/partial/none, new branch.
- [ ] OWNER ready/missing on uncovered branch.
- [ ] Cross-company isolation and bounded query count.

### Exit

- One server service produces the same readiness facts for options, save, submit, queue, workflow, and SLA.

## Phase 4 — Policy Read/Write, Status, CAS, and Legacy Preservation

### Files

- policy use cases/controller/repository/mapper
- audit/outbox integration
- focused policy specs

### Tasks

- [ ] Return virtual ACTIVE default only when no company policy row exists.
- [ ] Detect duplicate company rows and fail with `duplicate_company_policy`; never `findFirst` silently.
- [ ] Apply `expectedUpdatedAt` compare-and-set for stored rows.
- [ ] Map partial-index create collision to `reimbursement_policy_changed`.
- [ ] Validate route on every ACTIVE save. Preserve a valid legacy route when omitted; require explicit role correction or deactivation for an unsafe route.
- [ ] Canonicalize role edit and clear named user.
- [ ] Preserve exact legacy route when role is omitted.
- [ ] Enforce one canonical threshold, dual-write the deprecated database column, and keep the response alias equal.
- [ ] Make status meaning explicit; deactivation may preserve an invalid route, activation may not.
- [ ] Write HIGH-risk before/after audit within successful mutation boundary.
- [ ] Emit safe policy-updated facts; GET/options perform zero writes.

### Tests

- [ ] CAS success/conflict and concurrent default create.
- [ ] Deactivate with no route edit; reactivate valid/invalid.
- [ ] Legacy unrelated edit preserves the route byte-for-byte when actionable or deactivating; unsafe ACTIVE save is rejected.
- [ ] Explicit legacy normalization for MANAGER/OWNER/custom.
- [ ] Threshold alias equality; deprecated write rejected.
- [ ] Duplicate-row read/update fails closed.

### Exit

- Policy persistence is canonical, concurrency-safe, status-aware, and non-destructive to legacy routes.

## Phase 5 — Atomic Submission Snapshot and Threshold Paths

### Files

- reimbursement request use case/repository
- projection orchestrator/reconciler/repository
- request/domain/race specs

### Tasks

- [ ] Validate receipt/evidence/duplicate/branch and load one ACTIVE policy before mutation.
- [ ] Revalidate role/OWNER for human-approval submissions.
- [ ] Build policy snapshot V1 and include it in the approval hash.
- [ ] Write snapshot, document number, request status, optional role step, and outbox facts atomically.
- [ ] Human path: PENDING_APPROVAL + role step.
- [ ] Below threshold + finance: FINANCE_REVIEW, no step, `approvedAt=submittedAt`, finance PENDING.
- [ ] Below threshold + no finance: APPROVED durable POLICY projection, then READY only after projections pass.
- [ ] Emit `approval_not_required` and `finance_review_requested` as applicable.
- [ ] Record SYSTEM auto-decision audit without fabricating approver user/signature.
- [ ] Extend reconciler to resume POLICY intents idempotently.
- [ ] Guarantee INACTIVE/zero-route/validation failures make zero durable submit mutation.

### Tests

- [ ] Full threshold × finance state matrix.
- [ ] Equality and decimal behavior.
- [ ] INACTIVE zero mutation, including number/step/outbox.
- [ ] Role/OWNER/no-route branch matrix.
- [ ] Snapshot/hash atomicity and submit race.
- [ ] POLICY projection success/failure/retry/idempotency.
- [ ] Claim form has no human approver for auto-policy path.

### Verification

```bash
pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts \
  src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts \
  src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts \
  src/modules/reimbursements/application/services/reimbursement-projection-reconciler.service.spec.ts
pnpm --filter @watchdog-bms/api typecheck
```

### Exit

- The threshold/status labels now determine a durable, retry-safe runtime path.

## Phase 6 — Snapshot-Consistent Queue, Decision, Finance, Payment, and SLA

### Files

- approval/finance/payment use cases and repository transaction methods
- summary/SLA scan
- policy/snapshot helpers
- focused approval/finance/payment/branch specs

### Tasks

- [ ] New claims read self-approval, finance, duplicate/payment, and SLA facts from their snapshot.
- [ ] Legacy null-snapshot claims keep existing behavior.
- [ ] Queue, view, approve/reject, and transaction repeat current role/OWNER, permission, branch, member, self, state, hash, and CAS predicates.
- [ ] Current policy edits never change submitted-claim finance or payment blockers.
- [ ] Role/member/permission drift remains authoritative; stored responsibility does not change.
- [ ] Existing named-user step fallback remains unchanged.
- [ ] Approval SLA applies only to PENDING_APPROVAL and uses snapshotted `slaHours`.
- [ ] Projection/cancellation/payment reconcilers parse the same snapshot version.

### Tests

- [ ] Selected holder, OWNER, unrelated role, self exemption/non-exemption.
- [ ] Permission/member/branch drift between page and transaction.
- [ ] Two actors decide concurrently; one commits.
- [ ] Policy edit after submit does not alter finance, duplicate/payment, self, or SLA.
- [ ] Legacy no-snapshot paths remain behavior-compatible.
- [ ] Auto-policy requests never appear in approval queue/SLA.

### Verification

```bash
pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts \
  src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts \
  src/modules/reimbursements/application/use-cases/reimbursement-branch-scope.use-case.spec.ts \
  src/modules/reimbursements/application/use-cases/reimbursement-payment-posting.use-case.spec.ts
pnpm --filter @watchdog-bms/api typecheck
```

### Exit

- Every downstream action uses frozen business facts plus current security facts.

## Phase 7 — Role-Only Policy UX

### Files

- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`
- reimbursement API/logic/specs
- API error messages
- `e2e/reimbursements.spec.ts`

### Tasks

- [ ] Type policy/options/update state and remove touched `any`.
- [ ] Delete mode selector/free-text role; add one existing `ThemedSelect` labeled “บทบาทผู้อนุมัติ”.
- [ ] Add “เปิดรับการส่งใบเบิกใหม่” control and truthful inactive behavior/copy.
- [ ] Show holder count, coverage, uncovered branches, and OWNER fallback.
- [ ] Add threshold/finance decision preview from server-compatible pure logic.
- [ ] Render loading/retry/empty/none/partial/unavailable/legacy/inactive/conflict/busy/error/success.
- [ ] Keep explicit `routeDirty`; omit role on unrelated save.
- [ ] Use accurate self-approval and prospective copy.
- [ ] Refetch policy/options after save.
- [ ] Narrow E2E PUT helpers to writable fields; never spread GET output or normalize legacy during restore.
- [ ] Old cached-client DTO errors instruct refresh.

### Verification

```bash
pnpm --filter @watchdog-bms/web test
pnpm --filter @watchdog-bms/web typecheck
```

Browser-check desktop and 390 px, keyboard/focus/error association, ≥44 px controls, and no horizontal overflow.

### Exit

- The page communicates actual runtime outcomes without exposing internal enums.

## Phase 8 — Release B Dynamic Workflow

### Preconditions

- [ ] Accepted Release A is deployed and recorded as rollback target.

### Tasks

- [ ] Submission payload publishes exact role recipient ids, task role, fallback, requester exclusion, and snapshot version.
- [ ] Pending template consumes selected-role payload only.
- [ ] Fallback uses OWNER payload/task.
- [ ] SLA escalates selected role + OWNER.
- [ ] Below-threshold paths create no approval notification/task.
- [ ] Add/consume `reimbursement.finance_review_requested`.
- [ ] Version/resync only sync-owned rules; prove admin-created/edited/archived rules untouched.
- [ ] Make zero-recipient state observable and terminal where retry cannot fix it.

### Verification

```bash
pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/workflow/application/use-cases/workflow-action-runner.use-case.spec.ts \
  src/modules/workflow/application/use-cases/workflow-event-ingest.use-case.spec.ts \
  src/modules/workflow/application/use-cases/workflow-template-auto-enable.spec.ts \
  src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts
pnpm --filter @watchdog-bms/api typecheck
```

### Exit

- Authorization, notification, task, finance request, and SLA agree on the snapshotted policy path.

## Phase 9 — Integrated Evidence and Adversarial Review

### Tasks

- [ ] Run full contracts/API/web suites and typechecks.
- [ ] Real-Postgres full migration + zero drift.
- [ ] E2E role save/reload → submit → queue/notification/task → approve/reject.
- [ ] E2E threshold below/equal/above × finance on/off.
- [ ] E2E inactive zero-mutation and in-flight continuation.
- [ ] E2E partial branch fallback, missing OWNER, role/member drift, and double decision.
- [ ] E2E policy edit after submit proves snapshot consistency through finance/payment/SLA.
- [ ] E2E legacy non-routing save and old pending step unchanged.
- [ ] Browser-check all spec §5 states.
- [ ] Verify LINE/AI still call permission-checked read use cases and gain no mutation.
- [ ] Review diff for unrelated files, dependency/package changes, historical rewrite, unsafe backfill, and PII.
- [ ] Update memory/checklist with exact command results.

### Commands

```bash
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/web test
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/api exec prisma validate
pnpm exec playwright test e2e/reimbursements.spec.ts e2e/responsive.spec.ts
git diff --check
```

### Exit

- Every acceptance criterion in spec §15 has automated, database, browser, or UAT evidence.

## Phase C1 — Correction and Post-Payment Recovery (independent implementation slice)

This phase implements spec §18 without bypassing the role-routing Release A/B preconditions.

### Backend

- [x] Make finance `NEEDS_INFO` require a note and return `FINANCE_REVIEW -> DRAFT` inside the existing
      request lock/finance-decision transaction.
- [x] Reset approval/payability/duplicate/current-form facts, invalidate active signatures/signed-copy
      links, preserve approval history, and emit correction audit/outbox facts.
- [x] Make corrected resubmit clear finance-review stamps and create a fresh approval snapshot/step while
      reusing the request number.
- [x] Apply the same current-form invalidation to existing `REJECTED -> DRAFT` reopen.
- [x] Make latest-approved-step selection deterministic across resubmissions.

### Web

- [x] Reuse the create form for `/reimbursements/:requestId/edit`, prefill current lines and receipts, and
      PATCH only an editable DRAFT.
- [x] Add the drawer correction banner/link and finance “ส่งกลับให้แก้ไข” reason modal.
- [x] Add payment-row “ยกเลิกการจ่าย” with reason + real-transfer acknowledgement, permission/state gates,
      error handling, success refresh, and guidance to pay again or cancel separately.
- [x] Let a finance reviewer use the existing cancel path according to the server's current permission
      rule; do not label that actor as the requester.

### Verification

- [x] API focused tests: NEEDS_INFO state/reset/artifact invalidation/outbox, corrected resubmit, rejected
      reopen invalidation, payment true reversal, branch/permission/stale/double-decision guards.
- [x] Web focused tests: edit/cancel predicates, latest-step selection, payment-void visibility, form
      validation and retained/replaced receipt ids.
- [x] Run registered API/web reimbursement tests, API/web typechecks, API build, and workflow
      synchronization tests.
- [x] Browser render check: existing-draft edit, cancel/correction/void reason modals, permission-visible
      actions, disabled confirmations, no horizontal overflow at 390 px, and no console error.
- [ ] Mutation E2E: owner correction round trip; recorded payment -> void -> repay; recorded payment -> void
      -> explicit cancel; desktop and 390 px modal/form checks.
- [x] Self-review contracts, task/notification terminal states, signatures/signed copies, projection/ledger
      rollups, retry/idempotency, tenant/branch scope, audit, and unrelated dirty files before commit.

### Exit

- Spec §18 acceptance criteria are evidenced; role-routing phases remain governed by their own preflight
  and Release A/B exits.

## Phase 10 — UAT and Production

No cloud action is authorized by this planning task.

1. Read `docs/runbooks/cloud-environment-operations.md`.
2. Before each Release A/B UAT or Production action, follow `docs/runbooks/uat-production-v2-deployment.md`.
3. Record exact UAT, READY, and Production run ids; do not dispatch duplicates to discover errors.
4. Release A UAT proves current UI/API/static workflows and legacy requests are unchanged.
5. Release B UAT proves:
   - role COMPLETE/PARTIAL/OWNER;
   - below/equal/above threshold with finance on/off;
   - inactive blocks new submit while in-flight work completes;
   - policy edit does not alter a submitted claim;
   - explicit legacy normalization and unrelated legacy preservation;
   - CAS conflict and one-winner shared queue.
6. Review tenant-anonymized legacy/health metrics.
7. Promote only signed accepted builds and require customer `OPEN` acceptance.
8. Roll back Release B only to accepted Release A.

## Risks and Controls

| Risk | Control |
|------|---------|
| Duplicate NULL-branch policy blocks unique index. | Mandatory read-only preflight and authorized remediation; no guessing. |
| Snapshot freezes a privilege. | Snapshot freezes business responsibility only; current permission/member/branch remains mandatory. |
| Malformed snapshot row weakens behavior. | Versioned parser fails closed; null alone is legacy. |
| Below-threshold projection creates a fake approver. | POLICY/SYSTEM audit path, no approval step/user/signature. |
| Shared queue obscures personal ownership. | Actual decision actor audit; one-winner CAS; task claiming stays explicit backlog. |
| OWNER receives excessive alerts. | Routine selected role only; OWNER fallback/SLA only. |
| Partial role promises unavailable fallback. | PARTIAL selectable only with OWNER coverage for every uncovered branch. |
| Policy edit rewrites legacy or pending work. | Optional role field + routeDirty, snapshot, byte-preservation tests, no pending updates. |
| Cached old web sends rejected fields. | Stable refresh error; web/API switch together in Release B. |
| Dynamic templates reach old runtime. | Release A expand before Release B switch; rollback B→A. |
| Threshold alias diverges again. | Canonical writer, migration synchronization, deprecated update rejected. |
| Query cost grows with roles × branches. | Batched tenant query and bounded query-count test. |

## Handoff Checklist

- [ ] Combined threshold/status/routing/snapshot/workflow decisions match the spec.
- [ ] Preflight proves migration safety or records a real blocker.
- [ ] Nullable snapshot migration and partial unique index are additive and real-Postgres verified.
- [ ] Security, tenant, permission, branch, self, CAS, audit, privacy, and legacy boundaries pass.
- [ ] API-to-web loading/error/coverage/inactive/legacy/conflict states pass.
- [ ] Focused/full/database/browser/E2E evidence is recorded.
- [ ] Release A/B ids and UAT/READY/Production evidence are recorded if deployed.
- [ ] Item 14 remains unchecked until all required implementation and verification are complete.
