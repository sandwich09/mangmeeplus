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

## Implemented Slice — Constrained Role Picker (2026-08-21)

- [x] Replace the internal mode + free-text role controls with one role dropdown.
- [x] Load options from a manage-only endpoint; do not add `access.role.read`.
- [x] Let `reimbursement.policy.manage` load the policy form without a separate read grant.
- [x] Resolve system/company role overrides, entitlements, active users/memberships, branch scopes, and active branches in batched reads.
- [x] Make only ACTIVE, non-platform roles with read+approve+reject, active holders, and safe COMPLETE/PARTIAL coverage selectable; OWNER recovery must have the same approval capability.
- [x] Show human role names only; never render holder counts, coverage enums, quorum-like wording, or internal role keys as editable text.
- [x] Revalidate an explicit role edit on save, canonicalize its server-owned mode, and clear a stale named user.
- [x] Preserve a legacy named-person route when the role field is untouched.
- [x] Cover complete/partial/no-holder/missing-capability/OWNER-recovery and mode mapping with focused tests.
- [x] Verify select → save → reopen and restore through the local browser at desktop and 390 px.

This was the smallest independently safe UI/write slice. Phases 1–8 are now implemented and locally
verified on the PR branch; Phase 9 release-wide evidence and Phase 10 UAT/Production remain separate.

## Phase 0 — Read-Only Preflight and Worktree Protection

### Tasks

- [x] Re-read the linked spec and reconfirm cited code/schema facts.
- [x] Record `git status`; preserve unrelated worktree changes.
- [ ] Add a read-only classifier for duplicate NULL-branch policies, divergent threshold columns, legacy route shapes, inactive policies, and no-snapshot pending requests.
- [x] Run the migration and schema checks against local real PostgreSQL.
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

- [x] Add nullable `ReimbursementRequest.approvalPolicySnapshotJson Json?`.
- [x] Add nullable `ReimbursementApprovalStep.assignedApproverUserIdsJson Json?`.
- [x] Add raw partial unique index on `ReimbursementPolicy(companyId) WHERE branchId IS NULL`.
- [x] Synchronize `approvalThresholdAmount = approvalRequiredFromAmount` in migration SQL.
- [x] Keep all readers tolerant of null snapshot.
- [x] Add POLICY projection intent support for durable status APPROVED with no human approval step.
- [x] Keep existing MANAGER/FINANCE intents unchanged.
- [x] Let workflow recipient payload keys flatten scalar/array strings, dedupe, and ignore malformed values.
- [x] Add payload-derived exact task user and task-role fallback while retaining static `assigneeRole`.
- [x] Keep the migration/runtime expansion backward-compatible with legacy null rows.

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

- [x] Add role option/coverage/issue contracts and policy snapshot V1.
- [x] Narrow policy update to spec §9.2.
- [x] Add concrete runtime DTO; reject mode, user, deprecated threshold, server fields, and unknown fields.
- [x] Add a versioned, fail-closed server snapshot parser; null means legacy, malformed non-null is an operational error.
- [x] Add pure canonical role mapping.
- [x] Add pure policy evaluation returning ACTIVE gate, threshold result, initial status, finance status, and whether a step/projection is required.
- [x] Include snapshot in the new-request approval hash.
- [x] Add stable Thai errors from spec §9.3.

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

- [x] Load system/company roles, company overrides, entitlements, active holders, membership scopes, active branches, and OWNER readiness through tenant-bound reads.
- [x] Reuse `loadEntitledFeatureKeys`, `filterPermissionsByEntitlement`, role override rules, and branch helpers.
- [x] Exclude inactive/platform/incomplete-capability/zero-holder roles.
- [x] Calculate COMPLETE/PARTIAL/NONE and uncovered branch names.
- [x] Make PARTIAL selectable only when OWNER covers every uncovered active branch.
- [x] Add manage-only `GET reimbursement-policy/approver-options`; do not require `access.role.read`.
- [x] Classify current/legacy route without writes.
- [x] Return only safe role/coverage/current-route facts.
- [x] Use batched queries; no per-role/per-branch N+1.

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

- [x] Return virtual ACTIVE default only when no company policy row exists.
- [x] Detect duplicate company rows and fail with `duplicate_company_policy`; never `findFirst` silently.
- [x] Apply `expectedUpdatedAt` compare-and-set for stored rows.
- [x] Map partial-index create collision to `reimbursement_policy_changed`.
- [x] Validate route on every ACTIVE save. Preserve a valid legacy route when omitted; require explicit role correction or deactivation for an unsafe route.
- [x] Canonicalize role edit and clear named user.
- [x] Preserve exact legacy route when role is omitted.
- [x] Enforce one canonical threshold, dual-write the deprecated database column, and keep the response alias equal.
- [x] Make status meaning explicit; deactivation may preserve an invalid route, activation may not.
- [x] Write HIGH-risk before/after audit within successful mutation boundary.
- [x] Emit safe policy-updated facts in the same transaction; GET/options perform zero writes.

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

- [x] Validate receipt/evidence/duplicate/branch and load one ACTIVE policy before mutation.
- [x] Revalidate role/OWNER for human-approval submissions.
- [x] Apply request-specific self-approval filtering during revalidation; a sole non-exempt holder requires actionable OWNER recovery or submit fails before mutation.
- [x] Build policy snapshot V1 and include it in the approval hash.
- [x] Write snapshot, document number, request status, optional role step, and outbox facts atomically.
- [x] Freeze exact actionable recipient user ids on the new approval step; NULL remains legacy.
- [x] Human path: PENDING_APPROVAL + role step.
- [x] Below threshold + finance: FINANCE_REVIEW, no step, `approvedAt=submittedAt`, finance PENDING.
- [x] Below threshold + no finance: APPROVED durable POLICY projection, then READY only after projections pass.
- [x] Emit `approval_not_required` and `finance_review_requested` as applicable.
- [x] Record SYSTEM auto-decision audit without fabricating approver user/signature.
- [x] Extend reconciler to resume POLICY intents idempotently.
- [x] Guarantee INACTIVE/zero-route/validation failures make zero durable submit mutation.

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

- [x] New claims read self-approval, finance, duplicate/payment, and SLA facts from their snapshot.
- [x] Legacy null-snapshot claims keep existing behavior.
- [x] Queue, view, approve/reject, and transaction share one frozen-assignment predicate: active assignee wins even after role/permission change; only all-inactive opens recorded role/OWNER recovery.
- [x] Declare `account.session.read` on dynamic task routes so the global deny-by-default HTTP guard does not block a valid frozen assignee before the use-case gate runs.
- [x] Keep the approval tab permission-driven for ordinary users, then add it dynamically only after the
      exact-assignment-filtered queue confirms frozen work; bind that confirmation to the current company.
- [x] Let a task deep link reach only the hub probe with `account.session.read` after all reimbursement
      permissions are removed; do not reveal the sidebar module or nested routes from that baseline grant.
- [x] Current policy edits never change submitted-claim finance or payment blockers.
- [x] Role/permission drift is prospective for active frozen assignees; user/company-membership disablement remains authoritative and opens recovery.
- [x] Keep branch scope dynamic: an assignee moved away from the request branch no longer blocks the
      recorded role/OWNER recovery route, and SLA recipients use the same branch-aware active set.
- [x] Existing named-user step fallback remains unchanged.
- [x] Approval SLA applies only to PENDING_APPROVAL and uses snapshotted `slaHours`.
- [x] Projection/cancellation/payment reconcilers parse the same snapshot version.

### Tests

- [ ] Selected holder, OWNER, unrelated role, self exemption/non-exemption.
- [x] Assigned-user role/permission change, unrelated current permission holder denial, and all-assignees-inactive OWNER recovery.
- [ ] Branch drift between page and transaction.
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

- [x] Type policy/options/update state and avoid new unsafe client-owned routing fields.
- [x] Delete mode selector/free-text role; add one existing `ThemedSelect` labeled “ส่งใบเบิกให้ใครอนุมัติ?”.
- [x] Add “เปิดรับใบเบิกใหม่” control and truthful inactive behavior/copy.
- [x] Keep the picker low-tech: show selectable role names only and one human error for a stored role that is no longer ready.
- [x] Add threshold/finance decision preview from server-compatible pure logic.
- [x] Render loading/retry/empty/unavailable/legacy/inactive/conflict/busy/error/success without exposing internal coverage/count fields.
- [x] Keep explicit route dirty state; omit role on unrelated save.
- [x] Use accurate self-approval and prospective copy.
- [x] Refetch policy/options after save.
- [x] Narrow E2E PUT helpers to writable fields; never spread GET output or normalize legacy during restore.
- [x] Old cached-client DTO errors instruct refresh.
- [x] Register every new stable API code in the shared Thai error map so the launch-wide raw-code coverage gate passes.

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

- [x] Submission payload publishes exact role recipient ids, exact helper-task user, task-role fallback, requester exclusion, and snapshot version.
- [x] Pending template consumes the frozen recipient payload; it never re-resolves later holders for existing work.
- [x] Fallback uses OWNER payload/task.
- [x] SLA escalates active frozen recipients + OWNER.
- [x] SLA uses active frozen recipients after role edits and switches to recorded role/OWNER only when all frozen assignees are inactive.
- [x] Below-threshold paths create no approval notification/task.
- [x] Add/consume `reimbursement.finance_review_requested`.
- [x] Version/resync only sync-owned rules; prove admin-created/edited/archived rules untouched.
- [x] Keep zero-recipient failures observable without aborting unrelated healthy SLA candidates.

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

- [x] Run full contracts/API/web suites and typechecks.
- [ ] Real-Postgres full migration + zero drift.
- [ ] E2E role save/reload → submit → queue/notification/task → approve/reject.
- [ ] E2E threshold below/equal/above × finance on/off.
- [ ] E2E inactive zero-mutation and in-flight continuation.
- [ ] E2E partial branch fallback, missing OWNER, role/member drift, and double decision.
- [x] Local HTTP/browser-assisted flow: submit as OWNER, verify exact assignee snapshot, change assigned
      `qa.manager` from MANAGER to STAFF, then prove approval queue 200 + exact row, detail 200 with
      `canApprove/canReject`, and approve 200 to FINANCE_REVIEW; restore MANAGER afterward. New-route
      prospective behavior remains covered by routing tests.
- [x] Web regression proves an ordinary/no-permission session does not receive an unconditional approval
      tab, while a server-confirmed frozen assignee receives it in canonical order without duplicates.
- [x] Freeze recipient order, notify every already-validated recipient (including a valid self-approver),
      and give each correction/resubmit a distinct durable outbox epoch.
- [ ] E2E sole-holder self-approval denial plus OWNER recovery, including a user holding multiple roles.
- [ ] E2E policy edit after submit proves snapshot consistency through finance/payment/SLA.
- [ ] E2E legacy non-routing save and old pending step unchanged.
- [ ] Browser-check all spec §5 states.
- [ ] Verify LINE/AI still call permission-checked read use cases and gain no mutation.
- [x] Review diff for unrelated files, dependency/package changes, historical rewrite, unsafe backfill, and PII.
- [x] Update memory/checklist with exact command results.

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

## Phase C2 — Permission Composition and Multi-Role UI (independent implementation slice)

### Goal

Make reimbursement actions follow effective permissions rather than literal role names, and expose the backend's existing multi-role union safely in the two live employee screens.

### Tasks

- [x] Remove the OWNER/ADMIN role-name gate from the policy tab; require only `reimbursement.policy.manage`.
- [x] Let `reimbursement.read` open the related-items tab and request company-wide scope.
- [x] Gate approve, reject, finance review, duplicate resolution, payment record, and drawer actions by their exact permissions.
- [x] Keep finance correction available to a review-only role while disabling duplicate clearance without `reimbursement.duplicate.resolve`.
- [x] Change add/edit employee and individual-permissions screens from one `roleId` to `roleIds[]`; preserve all current roles and prevent removing the final role.
- [x] Render every held role in employee list rows so the list matches the selected detail; stack badges on one right-aligned axis without mobile overflow.
- [x] Apply protected-role and all-branch rules across every selected role.
- [x] Add narrow `pack.reimbursement.review` to `tpl.x.accounting`; do not grant payment, void, or duplicate resolution.
- [x] Gate employee create/edit routes by their exact permissions and make update-only DRAFT editing stop before create-only activation.
- [x] Gate role create/edit/disable controls by `access.role.manage`; select the created role and the new company-fork id after save/reload.
- [x] Let employee create/update and role-manage permissions load only their required supporting catalogs via equivalent-authority OR guards; do not broaden company employee-list read.
- [x] Apply the same composition rule to expense capture and substitute receipts: creator reopens only its own draft, confirmer loads approval context, false create/upload actions are hidden, and capture/review packs include attachment upload authority.
- [x] Add focused helper/registry tests for arbitrary permission sets and multi-role pinning.

### Verification

- Web reimbursement and role-picker tests.
- Employee-access capability/template/permission-registry tests.
- Employee/role controller metadata and workspace route/navigation contract tests.
- Expense creator ownership, substitute approver journey, and capability-pack completeness tests.
- Web/API/contracts typechecks and scoped diff review.
- Local browser/E2E evidence: create Finance + Accountant employee through the four-step UI; add a
  second role through the active employee editor; create/edit one role from expense + reimbursement
  packs; log in as an isolated Staff + custom reviewer; create an expense draft, open substitute-
  receipt work, and verify reimbursement related/finance tabs while approval/policy/payment authority
  stays absent. Run the seeded ten-persona sidebar/route matrix and the expense, reimbursement, role,
  and employee suites together. Evidence: targeted permission journeys passed 46/46; the full Chromium
  workspace run passed 158 tests with 80 project/feature-contract skips and zero failures.
- Follow-up evidence: SET-08B asserts both roles in the employee row plus no row overflow; local 390 px
  browser check showed Finance and Accountant in both the row and selected detail with document width 390/390.

### Exit

- A role name is never required for a reimbursement action when the effective permission, route, branch, member, and state guards pass.
- Adding a second role does not replace the first; removing one does not remove unrelated rights.
- UI does not offer actions that the current permission set must reject.
- Expense creation and substitute-receipt approval remain executable for a custom role composed from the corresponding capability, without granting unrelated company employee or payment authority.

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
| Assignment snapshot becomes a general privilege. | It authorizes only the exact step; active membership and branch remain mandatory, unrelated queues/actions still require current permission, and transaction repeats the same predicate. |
| Dynamic task routes are rejected before the snapshot gate. | Declare baseline `account.session.read` route metadata for the deny-by-default guard, then enforce normal permission or exact frozen assignment in the use case and again in the mutation transaction. HTTP evidence covers the changed-role session. |
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
