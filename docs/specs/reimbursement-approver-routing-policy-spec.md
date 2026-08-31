# Reimbursement Policy Correctness and Role Routing Spec

## 1. Status and Authority

- Status: **Implemented and locally verified on the PR branch; UAT/Production release evidence is not claimed.**
- Date: 2026-08-21
- Latest owner decision: policy administrators choose one role, not a person or internal routing mode.
- Parent: [[specs/reimbursement-approval-spec|Reimbursement and Approval Spec]] (item 14)
- Related journey: [[specs/reimbursement-journey-uplift-spec|Reimbursement Journey Uplift Spec]]
- Plan: [[plans/reimbursement-approver-routing-policy-plan|Reimbursement Policy Correctness Implementation Plan]]
- Memory: `docs/agent-memory/reimbursement-approver-routing-policy.md`

This spec is the source of truth for the entire reimbursement-policy correction, not only the control shown on screen. It supersedes the free-text, person-only, and role-picker-only drafts. It includes role routing, threshold behavior, policy activation, prospective policy snapshots, concurrency, workflow delivery, legacy compatibility, and data-integrity controls.

Implementation note (2026-08-22): the policy screen uses the manage-only role-options endpoint and never accepts a newly typed role key. The server revalidates explicit role edits, canonicalizes MANAGER/OWNER/custom mode, clears the named user, executes the threshold/ACTIVE state, stores the policy and assignee snapshots, applies CAS and database uniqueness, and routes notification/task/SLA from the frozen submission result. Role names are shown without holder counts because users interpreted the count as an approval quorum. The implementation and migration are verified locally; deployment remains governed by §14.

## 2. Product Outcome

An administrator can answer four business questions without knowing internal enums:

1. At what amount is human approval required?
2. Which role is responsible?
3. Must finance review the claim after approval?
4. Is submission currently open?

For every submitted claim, the system must then produce one consistent answer across status, frozen policy facts, queue, authorization, notification, task, SLA, finance, payment, audit, and retry/reconciliation.

### Success measures

- No arbitrary role key or contradictory mode/user combination can be newly persisted.
- No claim enters a queue with zero actionable selected-role or OWNER route.
- Threshold and ACTIVE/INACTIVE settings change runtime behavior exactly as the UI states.
- A policy edit never changes the business rules of a claim already submitted under a versioned snapshot.
- Routine alerts go to the responsible role; OWNER is alerted only as fallback or escalation.
- Existing named-person policies and pending claims continue without automatic historical rewriting.

### Explicit non-goals

- Named-person routing, backup person, delegation, round-robin, task claiming, or workload balancing.
- Multi-step, amount-tier, category-specific, or branch-specific policy designers.
- Reassigning existing pending claims from the policy screen.
- Automatically choosing a canonical row when duplicate company-level policies already exist.
- Changing finance/payment, ledger, tax, or LINE/AI mutation authority beyond consuming the corrected snapshot/events.

## 3. Verified Current-State Evidence

| ID | Verified fact | Repository evidence | Consequence |
|----|---------------|---------------------|-------------|
| E1 | Policy UI exposes an internal mode selector and free-text role input. | `ReimbursementsPages.tsx:1555-1562` | Typo, stale key, and contradictory combinations are possible. |
| E2 | Web submits mode + role on every policy save, including unrelated edits. | `ReimbursementsPages.tsx:1517-1530` | A stricter route contract needs explicit dirty-field handling. |
| E3 | Shared update input accepts mode, user, role, both threshold fields, and status. | `packages/contracts/src/reimbursements.ts:96-109` | Server-owned and duplicate concepts cross the trust boundary. |
| E4 | Policy controller uses an interface at `@Body()`; no concrete runtime DTO is applied. | `reimbursement-policy.controller.ts:25-29` | Unknown/server-owned fields are not rejected by validation metadata. |
| E5 | Policy update validates only enum/numeric shape, then writes role/user without tenant, role, permission, holder, or branch validation. | `reimbursement-policy.use-case.ts:53-86` | Invalid routes can be persisted. |
| E6 | Policy read/upsert has no optimistic concurrency. | `prisma-reimbursement.repository.ts:211-235` | Last save silently wins. |
| E7 | The schema uses `@@unique([companyId, branchId])` while `branchId` is nullable. | `schema.prisma:5195-5219` | PostgreSQL can hold multiple company-level rows with NULL branchId; create races are not safely fenced. |
| E8 | Two threshold columns exist; web/runtime use `approvalRequiredFromAmount`, while `approvalThresholdAmount` is writable but has no decision consumer. | contracts, policy use case, production-readiness audit §8 | Integrations can write a dead field and believe behavior changed. |
| E9 | `requiresApproval()` implements amount ≥ threshold, but submit always creates a step and enters PENDING_APPROVAL; the result is audit-only. | `reimbursement.logic.ts:32-37`; `reimbursement-request.use-case.ts:337,385-428,454` | The threshold label is currently false. |
| E10 | `findPolicy()` does not filter status and `effectivePolicy()` consumes any stored row. | repository `:211-215`; `reimbursement.constants.ts:38-52` | INACTIVE has no runtime effect. |
| E11 | Submission snapshots role/user in the step, but the request has no policy snapshot JSON even though the parent spec drafted one. | `schema.prisma:5222-5286,5337-5361`; parent spec §11 | Later policy edits can affect self-approval, finance, duplicate/payment, and SLA behavior of pending claims. |
| E12 | Role authorization already supports snapshotted role or OWNER. | `reimbursement.logic.ts:488-502` | Role-only routing fits the current authorization model. |
| E13 | Queue and decisions require current permission, branch scope, self-approval, state, hash, and transactional CAS. | approval use case/repository decision methods | Without a step-scoped exception, removing/changing an assignee's role also removes the permission needed to finish work already assigned. |
| E14 | Company-central records are visible to every branch scope; branch-scoped records require membership coverage. | `branch.logic.ts:42-60` | Coverage must distinguish active request branches from central requests. |
| E15 | Role catalog already resolves company override over the same system key and entitlement-filters permission counts. | `list-roles.use-case.ts:20-49` | A purpose-built routing catalog can reuse proven logic. |
| E16 | Generic role listing requires `access.role.read`, while policy management requires `reimbursement.policy.manage`. | role controller; policy controller | Reusing the generic endpoint would broaden/couple authority. |
| E17 | Pending and SLA workflow rules are hardcoded MANAGER/OWNER; tasks are hardcoded MANAGER. | `workflow-template-catalog.ts:118-170` | Custom/ADMIN role selection would disagree with delivery. |
| E18 | Workflow runner accepts scalar recipient payload ids and static task role only. | `workflow-action-runner.use-case.ts:172-198,244-266` | Dynamic role recipients/tasks require backward-compatible expansion. |
| E19 | Existing runner/template resync preserves admin-owned edits. | workflow template use case and sync script | Default rules can change without overwriting customer customization. |
| E20 | Current self-approval policy exempts OWNER/ADMIN/MANAGER even when the toggle is off. | `reimbursement.logic.ts:247-275` | Copy and request-specific recipient filtering must reflect the real rule. |
| E21 | E2E spreads GET output into PUT and restores it the same way. | `e2e/reimbursements.spec.ts:43-50` | Strict DTOs and legacy preservation require writable-only fixtures. |
| E22 | Existing columns support role/mode/user and one named approver, but not the set of people resolved from a role at submit. | `schema.prisma:5195-5220,5337-5361` | A nullable step assignment snapshot is required to distinguish new frozen assignments from legacy dynamic-role steps. |
| E23 | Employee create/update contracts and API already accept `roleIds[]` and union effective permissions, but both active employee screens submitted only the first role. | employee-access contracts/use cases; active employee pages | Adding a role was not safely representable and saving could silently drop other assignments. |
| E24 | Policy-tab visibility was additionally narrowed to the literal role names OWNER/ADMIN even though the API authorizes `reimbursement.policy.manage`. | reimbursement web logic; policy controller/use case | STAFF/custom roles granted the permission still could not use it. |
| E25 | Approval and finance queues displayed reject, duplicate resolution, and payment actions without checking their distinct permissions. | reimbursement queue/drawer actions | Composed roles could see actions that deterministically returned 403. |
| E26 | The accounting preset lacked reimbursement review while the only reusable finance pack also granted payment/void/duplicate authority. | capability-pack, role-template, and permission registries | Small companies could not compose review-only work without over-granting payment authority. |
| E27 | The role page route required `access.role.manage`, but its supporting role/matrix/catalog APIs required separate read keys; a system-role fork also returns a new id that the page ignored. | permission route/page; role, permission, and access-catalog controllers; update-role use case | A composed manage-only role could pass the route then get partial 403s, and a successful STAFF/system-role fork could jump to an unrelated role after reload. |
| E28 | The employee wizard route required employee read, while create/update/complete are separate permissions; its role/address/detail reads did not accept the action permissions, and completing an edited DRAFT requires create authority. | employee route/page; employee, role, and access-catalog controllers | A composed creator/editor could hold the mutation right but not finish the screen; DRAFT activation could also predictably return 403. |
| E29 | The same action-without-supporting-read gap existed outside reimbursement: `expense.create` could save then fail opening its own draft, `expense.confirm` could see a substitute-receipt approval row but not load its detail/history/artifact, and expense capture/review packs omitted the attachment authority their visible upload controls invoke. | expense controller/use cases, substitute-receipt hub/wizard, capability packs | Custom STAFF/accounting/finance roles could enter the advertised flow and dead-end after a successful write or before approval. |
| E30 | The registered reimbursement guide test still encoded an OWNER/ADMIN role-name restriction for policy even after the hub/API became permission-driven. | user-guide content contract test | Secondary navigation/help could contradict the executable permission model unless it reuses the same tab resolver. |
| E31 | The role-picker validates readiness on policy save but submit copies the stored role into a step without revalidating current holder, permission, branch, or requester-specific self-approval facts. | `reimbursement-request.use-case.ts:344-417` | A later membership/permission change, or a sole non-exempt holder submitting their own claim, can create pending work with no actionable routine approver. |
| E32 | The submit event publishes `approverRole`, but pending notification/task and SLA templates still use static MANAGER/OWNER routing. | request submit outbox + workflow template catalog | ADMIN, ACCOUNTANT, STAFF, or custom-role holders may see the authorization queue but miss the notification/task while unrelated managers receive it. |
| E33 | New role-picker error codes are translated only inside the reimbursement feature map, while the registered launch error-coverage test audits the shared map. | `api-error-coverage.spec.ts` CI run 32501884949 | The PR fails CI and another surface using the shared translator can expose raw snake_case. |
| E34 | The earlier UX contract required holder counts even though the owner removed them after users read them as quorum. | previous §5/§15 wording versus implemented picker | Documentation could reintroduce confusing copy during a later refactor unless the no-count decision is explicit. |
| E35 | A role-routed step stores only the role key. Queue/API/UI all require the assignee's current role-derived permission. | approval step schema, controller decorators, queue/action predicates | Changing an already-assigned employee's role steals the existing task and can strand the claim. |

## 4. System Design Decisions

### D1 — One role picker, no mode/person/text input

The policy screen exposes:

```text
ส่งใบเบิกให้ใครอนุมัติ?
[ ผู้จัดการ                                      ▾ ]
```

The client selects one logical role key. Mode and user are server-owned. The control shows role names only: no holder count, raw key, permission key, coverage enum, or quorum-like wording. A logical key may appear as secondary admin context only when duplicate display names need disambiguation.

### D2 — Canonical server mapping

| Selected role | Stored mode | Stored role | Stored user |
|---------------|-------------|-------------|-------------|
| MANAGER | MANAGER_ROLE | MANAGER | null |
| OWNER | OWNER_ROLE | OWNER | null |
| any other eligible role | CUSTOM_ROLE | exact logical key | null |

`DIRECT_MANAGER` and `CUSTOM_USER` remain response/legacy-compatible only. The API rejects client-supplied mode or user.

### D3 — A dedicated routing service is the single source of truth

One reimbursement-owned service provides:

- effective role options;
- active holder and branch coverage;
- selected-route validation;
- OWNER recovery readiness;
- submission route and recipients;
- queue/mutation route facts;
- notification/task/SLA payload facts;
- legacy classification.

The web never calculates permission, entitlement, holder, branch, or fallback readiness.

| Component | Owns | Must not own |
|-----------|------|--------------|
| Policy web | User intent and route-dirty state | Permission/coverage calculation or mode mapping |
| Policy API/use case | DTO boundary, CAS, audit, canonical write | Generic employee/role administration |
| Routing service | Role/holder/branch/OWNER readiness and route facts | Granting permissions or mutating policy |
| Policy evaluator | ACTIVE/threshold/finance state decision and snapshot shape | Database queries |
| Request repository | One atomic submit/decision mutation | Recomputing business policy |
| Workflow | Delivering payload-derived notification/task/SLA | Approve/reject authorization |
| Finance/payment | Consuming submitted snapshot plus current security | Reloading current policy for submitted claims |

### D4 — Policy selection does not grant general authority; a submitted assignment grants only that step

A route says who is responsible; it does not grant permission. Every action still requires:

- active tenant membership and active user;
- current endpoint permission, or an active frozen assignment to this exact approval step;
- request branch scope;
- snapshotted responsibility role or OWNER;
- snapshotted self-approval policy;
- pending state and matching request/step hash;
- transactional version/CAS.

The HTTP routes for queue, detail, approve, and reject declare the universal authenticated-company
session permission `account.session.read` so the global deny-by-default guard remains explicit. The
use case then narrows access to the normal reimbursement read/decision permissions or the exact active
frozen step assignment, and the mutation transaction repeats that assignment, branch, state, hash, and
CAS check. Omitting route metadata is invalid because the global guard rejects it before the task
capability can run.

### D5 — Policy behavior is prospective and snapshotted

Every new submission stores a server-generated versioned policy snapshot. Later edits do not change that claim's:

- threshold result;
- responsibility role;
- self-approval rule;
- finance-review requirement;
- receipt/duplicate policy facts;
- SLA hours.

The submit transaction also stores the exact resolved user ids on the approval step. An active frozen
assignee may finish that exact step after a later role/permission change; this does not grant access to
other approvals or product functions. Active user/company membership and branch scope remain dynamic.
When every frozen assignee is inactive, has left the company, or no longer covers the request branch,
the recorded role/OWNER recovery path becomes authoritative. Null assignment snapshot means a legacy
step and preserves current dynamic-role behavior.

### D6 — INACTIVE means “closed for new submission”

- ACTIVE: drafts may be submitted under the current validated policy.
- INACTIVE: new submission is rejected before document number, approval step, status, projection, audit-success, or outbox mutation.
- Drafts may still be created/edited.
- Existing pending approval, finance review, payment, cancellation, and reconciliation continue from their snapshots.
- Reactivation requires a currently valid route and policy configuration. A valid legacy named-user route may be preserved; an invalid legacy route requires explicit role selection.
- A missing stored policy remains the existing virtual ACTIVE default.

### D7 — Threshold has one canonical meaning

`approvalRequiredFromAmount` is the only writable and executable threshold.

- amount ≥ threshold: human approval is required;
- amount < threshold: approval is not required by policy;
- equality requires approval;
- zero means every non-negative claim requires approval.

`approvalThresholdAmount` remains a deprecated response alias temporarily and must always equal the canonical value. It is rejected as an update field after Release B; whenever the canonical threshold changes, the repository dual-writes the deprecated column until that column is removed.

### D8 — OWNER is recovery, not routine noise

- When the selected role has an eligible holder for the request branch, routine notification/task goes to that role only.
- OWNER can still see and act through authorization.
- When the selected role has no eligible holder for that branch, effective task/notification route becomes OWNER.
- Approval SLA breach escalates to eligible selected-role holders plus OWNER.
- If OWNER is the selected role, OWNER is the routine route.

### D9 — Existing work is immutable from policy and role edits

Policy save never updates a pending request or approval step. A role/permission change does not remove an
active frozen assignee from work already assigned; it affects submissions created after the change. Disabling
the user or company membership activates recorded role/OWNER recovery and does not rewrite the step.

### D10 — Shared queue semantics are explicit

All actionable holders resolved at submission are frozen onto the step and can see the same claim even if
their role later changes. The first valid transactional decision wins. Task claiming, distribution, or round-robin remains backlog.

### D11 — Policy writes use optimistic concurrency and DB uniqueness

- Stored policy update requires `expectedUpdatedAt` and compare-and-set.
- A partial unique index enforces one company-level policy where `branchId IS NULL`.
- A create race becomes a stable 409 conflict, never duplicate rows.
- Existing duplicates block the migration until explicitly resolved; no code guesses the winner.

### D12 — Legacy reads perform zero writes

Named user, DIRECT_MANAGER, contradictory mode/role, unknown role, unavailable role, duplicate company-policy rows, and missing policy snapshot are classified without mutation.

### D13 — Authorization is permission-driven and composable

- Role keys describe responsibility/routing; effective permissions authorize product actions, except for the exact approval step frozen onto an active assignee.
- Every live web tab and action mirrors the exact permission enforced by its API and must not add a role-name allowlist.
- The approval tab is visible when the session currently has approve/reject permission. If it does not,
  the web probes the exact-assignment-filtered queue and adds the tab only when the server confirms a
  frozen task for that user. The confirmation is company-bound and remains visible for the page session
  after the last task is completed so a success result is not replaced by a misleading no-access screen.
- The workspace permits `account.session.read` to reach only the reimbursement hub root so a task or
  notification deep link can run that exact-assignment probe after all reimbursement permissions were
  removed. This does not add the reimbursement module to navigation and does not open nested routes.
- Sidebar, route guards, employee summaries, and user-guide shortcuts reuse the same effective-permission
  facts as their destination; help/navigation must not reintroduce a role-name restriction.
- A member may hold multiple roles. Effective permissions are the union of those roles; removing one role removes only its contribution.
- Employee list rows show every held role and match the selected employee detail; badges stay right-aligned without horizontal overflow at 390 px.
- The same capability works whether granted through OWNER, ACCOUNTANT, STAFF, a forked system role, a custom role, or multiple roles.
- Tenant, active membership, branch scope, frozen assignment/selected approval recovery route, submitted self-approval decision, state, snapshot/hash, and CAS checks remain mandatory.
- Sensitive capabilities stay separable: finance review does not imply payment record/void or duplicate resolution.

## 5. UX Contract

### 5.1 Policy controls

```text
เปิดรับการส่งใบเบิกใหม่                              [เปิด]

ต้องอนุมัติเมื่อยอดตั้งแต่ (บาท)
[ 1.00 ]
ยอดต่ำกว่านี้จะข้ามผู้อนุมัติ และไปขั้นตรวจการเงินตามนโยบาย

ส่งใบเบิกให้ใครอนุมัติ?
[ แอดมิน                                       ▾ ]

ตรวจการเงินก่อนจ่าย                                 [เปิด]

อนุญาตให้อนุมัติใบเบิกของตนเอง                     [ปิด]
มีผลกับบทบาทอื่นเท่านั้น เจ้าของ ผู้ดูแล และผู้จัดการทำได้อยู่แล้ว
```

### 5.2 Decision preview

The summary must show behavior, not enums:

```text
ยอดตั้งแต่ 1.00 บาท
ผู้จัดการ → ตรวจการเงิน → พร้อมจ่าย

ยอดต่ำกว่า 1.00 บาท
ไม่ต้องรอผู้อนุมัติ → ตรวจการเงิน → พร้อมจ่าย
```

If finance review is off, preview ends with “ระบบตรวจความพร้อม → พร้อมจ่าย”.

### 5.3 Role readiness states

- The picker lists selectable role names only. It does not show holder counts or internal coverage states.
- COMPLETE is selectable.
- PARTIAL is selectable only if OWNER covers every uncovered branch; otherwise it is omitted.
- NONE and OWNER_RECOVERY_NOT_READY are omitted.
- A currently stored role that becomes unsafe remains visible as disabled with the human message “บทบาทที่ตั้งไว้ยังไม่มีคนพร้อมอนุมัติ กรุณาเลือกบทบาทใหม่”.
- The API may retain COMPLETE/PARTIAL/NONE and counts as server-side readiness facts for validation, observability, and tests; the policy UI does not render them.

Company-central requests are explained as “ส่วนกลาง” and follow existing all-scope visibility.

### 5.4 Legacy route

```text
ตั้งค่าเดิมเป็นพนักงานรายบุคคล
การแก้ช่องอื่นจะยังคงผู้อนุมัติเดิม
หากต้องการเปลี่ยนเส้นทาง กรุณาเลือกบทบาท
```

Unrelated fields preserve the exact route when the role field is omitted. The save is allowed when that route is currently actionable or the same save deactivates the policy. An ACTIVE policy with an unsafe route must be corrected by explicit role selection or deactivated; it cannot report a healthy save while remaining unroutable.

### 5.5 Policy inactive

```text
ปิดรับการส่งใบเบิกใหม่
พนักงานยังแก้ไขแบบร่างได้ ใบที่ส่งแล้วจะดำเนินการต่อ
```

Submit buttons are disabled with the same server-backed message. The server remains authoritative.

### 5.6 Required page states

Loading, retry, options error, empty catalog, COMPLETE, PARTIAL, NONE, unavailable saved role, legacy named user, inactive, save conflict, busy, error, and success must be designed for desktop and 390 px. Never fall back to free text.

## 6. Role Eligibility and Coverage

### 6.1 Selectable role

A role option must:

- resolve from the effective system/company catalog with company override winning;
- be ACTIVE;
- not be platform-only `SYSTEM_ADMIN` or `COMPANY_VIEW`;
- contain `reimbursement.read`, `reimbursement.approve`, and `reimbursement.reject` in its own effective role definition after entitlement filtering;
- have at least one ACTIVE membership + ACTIVE user holding it.

Requiring complete capability in the selected role keeps the label honest. Runtime permission may still be composed across a person's other roles.

### 6.2 Coverage

Coverage is calculated from current active branches and membership scope:

- COMPLETE: every active branch has an eligible selected-role holder, or an all-branch holder exists;
- PARTIAL: at least one branch is covered by the role and every uncovered branch has eligible OWNER recovery;
- NONE: no active branch is covered by the role;
- unsafe partial: visible but not selectable when any uncovered branch lacks OWNER recovery.

With no active branches, an active eligible holder makes the company-central route COMPLETE.

> **Owner decision 2026-08-31 (D3):** for a customer company that state is no longer reachable — a
> company always keeps one undeletable ACTIVE head office, and branch administration now refuses any
> transition that would leave zero active branches. The rule above is retained because it still
> describes the platform tenant, which holds no branch rows at all. Do not build customer-facing
> behaviour on the assumption that a customer company can have no active branch.

### 6.3 Revalidation points

Options load, policy save/reactivation, submission, queue read, mutation transaction, notification recipient resolution, task creation, and SLA scan use the same routing service and current security facts.

## 7. Submission State Machine

All receipt, evidence, duplicate, branch, policy-status, and snapshot validations occur before the first durable submit mutation.

| Policy/amount | Durable submit result | Approval step | Next work |
|---------------|-----------------------|---------------|-----------|
| INACTIVE | Reject `reimbursement_policy_inactive` | none | draft unchanged |
| ACTIVE and amount ≥ threshold | PENDING_APPROVAL | one role step | selected role or OWNER fallback |
| ACTIVE and amount < threshold; finance required | FINANCE_REVIEW | none | finance queue |
| ACTIVE and amount < threshold; finance not required | APPROVED (projection pending) | none | policy-auto projection, then READY_FOR_PAYMENT |

### 7.1 Auto-approved-by-policy path

- Set `approvedAt=submittedAt`; no approver user/step/signature exists.
- Audit actor type is SYSTEM with reason `BELOW_APPROVAL_THRESHOLD`; requester remains the submitting actor, not the approver.
- Emit `reimbursement.approval_not_required`.
- If finance is required, also emit `reimbursement.finance_review_requested`.
- If finance is not required, create a durable POLICY projection intent from status APPROVED. Projection retry never fabricates a human approver.
- The claim form leaves the approver signature block blank and states “ไม่ต้องอนุมัติตามนโยบาย” in decision context.

### 7.2 Human approval path

- Snapshot exact role key; no named user for new writes.
- Resolve current selected-role recipients for the request branch.
- Freeze those recipient user ids on the approval step; a later role/permission edit has prospective effect only.
- If none, snapshot/use OWNER only when eligible OWNER exists.
- If neither can act, reject before submission mutation.
- If all frozen assignees later become inactive/leave, use recorded role/OWNER recovery; never silently widen while any frozen assignee remains active.
- Existing named-user legacy steps retain their historical fallback behavior.

### 7.3 Finance and payment

New claims use the submitted policy snapshot for finance requirement and duplicate/payment policy. Current policy edits never add/remove finance review or change payment blocking for an already submitted claim.

## 8. Policy Snapshot Contract

Add nullable `approvalPolicySnapshotJson` to `ReimbursementRequest`.

```ts
type ReimbursementPolicySnapshotV1 = {
  schemaVersion: 1;
  policyId: string | 'default';
  policyVersion: string; // stored updatedAt ISO, or the stable literal "default:v1"
  approvalRequiredFromAmount: string;
  requiresApproval: boolean;
  route: null | {
    mode: 'MANAGER_ROLE' | 'OWNER_ROLE' | 'CUSTOM_ROLE';
    roleKey: string;
    effectiveTaskRole: string;
    ownerFallbackUsedAtSubmission: boolean;
  };
  allowSelfApproval: boolean;
  requireReceipt: boolean;
  allowMissingReceiptWithReason: boolean;
  duplicatePolicy: 'WARN' | 'BLOCK_SUBMIT' | 'BLOCK_PAYMENT';
  financeReviewRequired: boolean;
  slaHours?: number;
};
```

Rules:

- Server-generated only; never accepted from client.
- The virtual default uses stable `policyVersion="default:v1"`; it never uses request time as a version.
- Written atomically with submit status/step/document number.
- Included in the request approval hash for new claims.
- Read by queue, mutation, finance/payment, SLA, workflow payload, and projection retry.
- Missing snapshot marks a legacy request; it follows existing behavior without guessed backfill.
- Snapshot stores logical keys and policy facts, not employee names, permission catalogs, or recipient ids.
- Recipient ids are stored separately on the approval step as a nullable assignment snapshot. `null` is legacy; a non-null array is fail-closed and never shown on the policy UI.

## 9. API Contract

### 9.1 Role options

```text
GET /v1/companies/:companyId/reimbursement-policy/approver-options
Permission: reimbursement.policy.manage
```

```ts
type ReimbursementApproverRoleOption = {
  key: string;
  name: string;
  optionLabel: string;
  eligibleApproverCount: number;
  coverage: 'COMPLETE' | 'PARTIAL' | 'NONE';
  uncoveredBranchNames: string[];
  selectable: boolean;
  unavailableReason?:
    | 'MISSING_CAPABILITY'
    | 'NO_ACTIVE_HOLDERS'
    | 'OWNER_RECOVERY_NOT_READY';
};

type ReimbursementApproverConfigurationIssue =
  | 'LEGACY_NAMED_USER'
  | 'MODE_ROLE_MISMATCH'
  | 'ROLE_UNAVAILABLE'
  | 'DIRECT_MANAGER_UNSUPPORTED'
  | 'DUPLICATE_COMPANY_POLICY'
  | 'LEGACY_NO_POLICY_SNAPSHOT';
```

The endpoint returns no employee directory, contact data, credentials, or raw permission catalog.

### 9.2 Policy update

```ts
type UpdateReimbursementPolicyInput = {
  expectedUpdatedAt?: string;          // required for a stored row
  approvalRequiredFromAmount?: string;
  defaultApproverRole?: string;        // present only when explicitly edited
  allowSelfApproval?: boolean;
  requireReceipt?: boolean;
  allowMissingReceiptWithReason?: boolean;
  duplicatePolicy?: 'WARN' | 'BLOCK_SUBMIT' | 'BLOCK_PAYMENT';
  financeReviewRequired?: boolean;
  slaHours?: number | null;
  status?: 'ACTIVE' | 'INACTIVE';
};
```

Reject `approverMode`, `defaultApproverUserId`, `approvalThresholdAmount`, company/id/timestamps, and unknown fields. Omitted role preserves the exact route. ACTIVE saves require an actionable current or newly selected route; deactivation may preserve an unsafe legacy route.

### 9.3 Stable errors

| Code | Meaning | Thai intent |
|------|---------|-------------|
| `approver_role_required` | Explicit route edit has no role. | กรุณาเลือกบทบาทผู้อนุมัติ |
| `approver_role_not_eligible` | Role inactive/missing capability. | บทบาทนี้ไม่สามารถอนุมัติใบเบิกได้ |
| `approver_role_has_no_active_holders` | No active holder. | ยังไม่มีพนักงานที่พร้อมอนุมัติในบทบาทนี้ |
| `owner_recovery_not_ready` | An uncovered branch has no OWNER recovery. | ยังไม่มีเจ้าของกิจการที่พร้อมอนุมัติในบางสาขา |
| `reimbursement_approver_not_ready` | Request has neither role nor OWNER route. | ยังไม่มีผู้อนุมัติที่พร้อมใช้งาน |
| `reimbursement_policy_inactive` | Submission is closed. | บริษัทปิดรับการส่งใบเบิกใหม่ชั่วคราว |
| `reimbursement_policy_changed` | Policy CAS conflict. | นโยบายถูกแก้ไขแล้ว กรุณาโหลดใหม่ |
| `duplicate_company_policy` | More than one central row exists. | พบนโยบายซ้ำ กรุณาให้ผู้ดูแลระบบตรวจสอบ |
| `deprecated_policy_field` | Client sent removed threshold/mode/user field. | กรุณาโหลดหน้าใหม่ก่อนบันทึก |

## 10. Workflow, Task, and SLA

### 10.1 Payload

```ts
type ReimbursementApprovalRoutePayload = {
  policySnapshotVersion: 1;
  approverRole: string;
  approverRecipientUserIds: string[];
  approverTaskUserId?: string;
  approverTaskRole: string;
  approverFallbackToOwner: boolean;
  requesterUserId?: string;
};
```

Recipient ids are computed by the routing service from current role, permission, branch, active state, and real self-approval predicate.

### 10.2 Default behavior

- Pending approval: notify every frozen recipient and assign the workflow helper task to one exact
  frozen recipient (`approverTaskUserId`). The reimbursement queue remains available to every frozen
  recipient, including after their role changes. A new holder of the old role does not inherit an old
  claim. The task is only a reminder because the workflow task schema has one assignee.
- Recipient ids are sorted before snapshot/event creation so the one helper-task assignee is stable
  across retries. Notification does not remove the requester again: self-approval eligibility was
  already decided while resolving the frozen route at submission.
- Branch fallback: notify/assign OWNER only.
- SLA breach: notify the active frozen recipients plus OWNER; its helper task stays pinned to an exact
  active recipient. Switch to the recorded role/OWNER recovery only when every frozen recipient is inactive.
- Below threshold: no approval notification/task/SLA.
- Finance required: emit/consume `reimbursement.finance_review_requested`.
- Custom admin-owned workflows may differ in delivery but never authorization.

### 10.3 Runner compatibility

The workflow runner supports string-array recipient payloads, payload-derived exact task user, and
payload-derived task role. Exact user wins when present; static/payload role remains a backward-compatible
fallback for legacy events that have no assignment snapshot.

## 11. Concurrency and Transaction Boundaries

- Options reads never reserve readiness; save/submit revalidate.
- Submit readiness is request-specific: it applies branch scope and the real self-approval predicate. A sole non-exempt holder submitting their own claim is not counted; OWNER recovery must be actionable for that request or submit fails before mutation.
- Policy update uses `UPDATE ... WHERE id=? AND updatedAt=?`.
- Company-default create is fenced by a partial unique index and conflict mapping.
- Submit writes policy snapshot, status, optional step, document number, request version, and outbox facts atomically.
- Every submission has its own durable event-key epoch. A correction/resubmit under the same unchanged
  policy emits a new request/finance/projection event set instead of being suppressed as a retry.
- Queue is advisory; approve/reject transaction repeats permission, role/OWNER, branch, self, state, hash, and CAS checks.
- Two role holders may open the same claim; only one decision commits.
- Projection failure leaves a durable retryable status and never marks a claim READY early.

## 12. Legacy and Migration

### 12.1 Preflight classifier

Before migration, run read-only counts for:

- duplicate `branchId IS NULL` policies by company;
- named-user, DIRECT_MANAGER, mode/role mismatch, and unknown/unavailable role;
- inactive policy;
- pending requests without policy snapshot;
- divergent threshold columns.

Output is tenant-anonymized for aggregate reporting and contains explicit ids only in a restricted remediation artifact.

### 12.2 Schema/data migration

- Add nullable `ReimbursementRequest.approvalPolicySnapshotJson Json?`.
- Add nullable `ReimbursementApprovalStep.assignedApproverUserIdsJson Json?`; existing NULL rows remain legacy dynamic-role steps.
- Add raw partial unique index on `ReimbursementPolicy(companyId) WHERE branchId IS NULL`.
- Synchronize `approvalThresholdAmount = approvalRequiredFromAmount` for existing policy rows.
- Keep the deprecated column for compatibility; remove it only in a separately approved migration.
- Do not backfill historical policy snapshots or rewrite pending steps.
- Do not auto-resolve duplicate company policies. Migration is blocked until an authorized operator selects the canonical row using audit/business evidence.

### 12.3 Legacy execution

- Existing pending rows keep stored user/role/hash/fallback semantics.
- Existing requests without snapshot use the existing policy-read behavior and are clearly marked legacy in support telemetry.
- Unrelated policy edits preserve named-user/contradictory route fields byte-for-byte.
- Explicit role edit normalizes only the policy row under D2.

## 13. Security, Audit, Privacy, and Observability

### Security

- Manage-only options endpoint uses `reimbursement.policy.manage`; generic role-read permission is not added.
- Tenant is derived from request context, never body.
- Role selection never grants or expands permission.
- Current branch and active membership remain mandatory. Current permission remains mandatory except for an active assignee finishing the exact frozen step.
- LINE and AI remain read-only and call permission-checked reimbursement use cases.

### Audit

Policy audit, in the successful CAS boundary, records:

- before/after canonical route, threshold, status, finance, self, duplicate, receipt, SLA;
- routeEdited flag, coverage, expected/current version;
- actor and request id.

Submission audit records policy id/version, threshold result, selected/effective role, recipient count, branch, and fallback. Auto approval records SYSTEM + `BELOW_APPROVAL_THRESHOLD`. Actual human decision audit records the actor. Do not include employee names/contact data.

### Observability

Metrics/alerts:

- options with zero selectable roles;
- unsafe PARTIAL roles;
- submission blocked by route/status;
- OWNER fallback count by branch;
- zero recipient/task resolution;
- policy CAS conflicts;
- legacy no-snapshot count;
- duplicate policy count;
- projection intents stuck in APPROVED/PENDING_APPROVAL/FINANCE_REVIEW.

## 14. Rollout and Rollback

### Preflight — no mutation

Run the classifier and resolve duplicate company-level policies before deployment. If duplicates exist, stop; no migration or release guesses the winner.

### Release A — expand

- Add nullable snapshot column and partial unique index.
- Synchronize duplicate threshold column values.
- Add snapshot-tolerant readers and POLICY projection/reconciliation support.
- Expand workflow runner for array recipients and payload task role.
- Keep current UI/API/template behavior.

Verify current static MANAGER/OWNER workflows and old requests remain unchanged.

### Release B — switch

- Enable strict policy DTO, CAS, status/threshold semantics, routing service/options endpoint, snapshot-producing submission, and role-only UI.
- Switch sync-owned workflow templates to dynamic recipients/tasks/SLA and finance-review-request event.
- Refetch policy/options after save.

Rollback Release B only to accepted Release A. Release A schema is additive and can read null snapshots. Admin-created/edited/archived workflow rules remain untouched.

Before every UAT/Production action, follow:

- `docs/runbooks/cloud-environment-operations.md`
- `docs/runbooks/uat-production-v2-deployment.md`

Record exact UAT, READY, and Production run ids.

## 15. Acceptance Criteria

### Policy UX/API

- [ ] Exactly one constrained role picker; no mode, person picker, or free-text role.
- [ ] Only eligible role names are selectable; no holder count, raw key, coverage enum, or quorum-like wording is visible.
- [ ] Unsafe PARTIAL and NONE cannot be saved.
- [ ] Server canonicalizes mode/role and clears user on explicit role edit.
- [ ] Runtime DTO rejects mode/user/deprecated threshold/server fields.
- [ ] Unrelated edit preserves legacy route; unsafe ACTIVE route must be corrected or deactivated.
- [ ] Stored policy requires CAS; create race cannot produce duplicate central rows.
- [ ] ACTIVE/INACTIVE behavior and copy match D6.
- [ ] Decision preview matches threshold/finance state table.
- [ ] Desktop and 390 px states pass accessibility/overflow checks.

### Submission/runtime

- [ ] Amount equal to threshold requires approval.
- [ ] Below threshold skips approval and follows finance/no-finance paths in §7.
- [ ] INACTIVE submit produces zero durable mutation.
- [ ] New submit atomically writes snapshot and includes it in the hash.
- [ ] Policy edits do not change new claims already submitted.
- [ ] Current branch and active membership remain authoritative; current permission is required unless the actor is an active frozen assignee of that exact step.
- [ ] Changing an assigned employee's role/permissions does not remove their existing task and affects only later submissions.
- [ ] While any frozen assignee is active, unrelated role/OWNER holders cannot take over; recovery opens only after every frozen assignee becomes inactive.
- [ ] Role/OWNER queue and transaction produce the same result.
- [ ] Submit revalidates role/member/permission/branch/self facts and a sole self-ineligible holder cannot create stranded pending work.
- [ ] Existing pending steps and legacy requests remain executable.
- [ ] Projection failure remains retryable and not payable.

### Workflow

- [ ] Routine pending alert/task matches effective selected role only.
- [ ] OWNER receives routine work only for fallback; SLA still escalates to OWNER.
- [ ] Below-threshold requests create no approval work.
- [ ] Finance-review-request and ready-for-payment events reach correct permission holders.
- [ ] Sync-owned rules version; admin-owned rules remain unchanged.
- [ ] Release A/B compatibility and B→A rollback are proven.

### Evidence

- [ ] Real-Postgres test proves partial unique index, create race, role override, entitlement, holders, and branch coverage.
- [ ] E2E proves role save/reload → submit → correct queue/notification/task → approve/reject.
- [ ] E2E proves ADMIN, ACCOUNTANT, STAFF/custom, multi-role, OWNER fallback, and sole-holder self-approval routing.
- [ ] E2E proves all threshold/finance/status paths.
- [ ] E2E proves non-routing legacy save and pending-step immutability.
- [ ] Full registered contracts/API/web suites, typechecks, workflow tests, browser checks, and UAT pass.

## 16. Required Test Matrix

| Area | Minimum cases |
|------|---------------|
| DTO/canonicalization | MANAGER, OWNER, custom; mode/user/deprecated/unknown rejected; role omitted preserves; CAS conflict. |
| Policy uniqueness | no row, one row, concurrent create, duplicate-null preflight, partial index on real Postgres. |
| Role catalog | system/company override; inactive; missing each permission; entitlement OFF; platform role; zero holder; cross-company. |
| Coverage | no branches; central; ALL/SELECTED/DEFAULT; complete/partial/none; missing OWNER; new branch after save. |
| Threshold | below/equal/above; zero; decimal; finance on/off; no step on below; projection retry. |
| Status | active; inactive zero-mutation submit; draft edit allowed; pending/finance/payment continue; reactivation validation. |
| Snapshot | V1 write/read/hash; later policy edit; permission/member drift; missing legacy snapshot; malformed server row fails closed. |
| Legacy | named user; missing user; mismatch; unknown role; DIRECT_MANAGER; zero-write GET; unrelated save; explicit normalization. |
| Queue/mutation | holder; OWNER; unrelated role; self exemption/non-exemption; branch; permission; double decision/CAS. |
| Workflow | selected role; fallback OWNER; SLA; finance request; below-threshold none; array payload; admin-owned untouched. |
| Web/E2E | loading, retry, empty, complete, partial, none, inactive, legacy, conflict, summary, busy/error/success, desktop/390. |

## 17. Remaining Backlog

- Named-person/backup/delegation and reassignment.
- Shared-task claiming, round-robin, workload limits, or escalation by unclaimed duration.
- Multi-step, tiered, category, cost-center, and branch-specific policies.
- Historical policy-snapshot reconstruction for reporting; never infer without authoritative evidence.
- Removal of deprecated `approvalThresholdAmount` in a separately versioned contract/migration.

## 18. Correction and Post-Payment Recovery Amendment

This amendment is implementation-scoped independently from the Release A/B policy-routing rollout.
It closes existing journey dead ends without weakening the policy, permission, branch, audit, payment,
projection, or ledger boundaries above.

### 18.1 Verified gaps

- The finance API accepts `NEEDS_INFO`, but persistence leaves the request in `FINANCE_REVIEW`; draft
  update accepts only `DRAFT`. Exposing the decision without a state change strands the requester.
- `REJECTED -> DRAFT` already exists and the UI already offers “แก้ไขและยื่นใหม่”, but the web has no
  full edit page for an existing draft; it can change only line receipts from the drawer.
- The payment-void API and true-reversal transaction exist, and the web API client already wraps it,
  but no reimbursement UI invokes it.
- After a payment is voided, the existing transaction returns the request to `READY_FOR_PAYMENT`; the
  existing cancellation saga can then close the request. The two business intents must remain two
  explicit user actions in v1 so a failed second action is visible and safely retryable, never a hidden
  browser-side chain.
- Claim signatures and uploaded signed copies describe one exact request snapshot. Reopening or
  returning a request for correction must remove them from the active form before editable facts change.
  The attachment bytes and audit entries remain retained; only the active links/signature rows are
  invalidated.

### 18.2 Finance return for correction

`POST :requestId/finance-review` with `{ decision: 'NEEDS_INFO', note }` is the single command; no
second return endpoint is added.

- Allowed only from `FINANCE_REVIEW` before `APPROVED_FOR_PAYMENT` and before any recorded payment or
  claim projection exists.
- `note` is mandatory, trimmed, and at most 500 characters.
- In one request-locked transaction, write the finance decision/audit/outbox facts and return the
  request to `DRAFT`; clear current submission/approval/payability/snapshot fields, reset duplicate evaluation, remove
  current signature rows and signed-copy links, and preserve the prior approval steps as history.
- The finance note remains visible while the correction draft is open. A corrected resubmission clears
  the current finance-review stamps, revalidates receipts/evidence/duplicates, computes a new request
  hash, creates a new approval step, and reuses the request/document number.
- The latest approved step for display/signing is selected by decision time, never by ambiguous
  sequence ordering across resubmissions.
- Emit a requester-targeted `reimbursement.correction_requested` event. Workflow delivery is best
  effort; the durable draft and finance note remain the source of truth.

### 18.3 Existing-draft edit UX

- Add `/companies/:companyId/reimbursements/:requestId/edit` using the create form's fields and
  validation rather than a second form implementation.
- Server read and PATCH remain authoritative for tenant, requester, permission, branch, state, evidence,
  line-count, money, and stale-write checks.
- Existing receipts are retained unless explicitly removed or replaced. New uploads that succeed before
  a later PATCH failure remain unattached evidence and do not mutate the request.
- The drawer shows “แก้ไขคำขอ” only when the same client predicate as the server permits a DRAFT edit.
- A correction draft displays the finance note above the form and in the drawer.

### 18.4 Payment void and cancel-after-payment UX

- A recorded payment row shows “ยกเลิกการจ่าย” only with `reimbursement.payment.void`.
- The modal requires a non-empty reason and an explicit acknowledgement that the operator has checked
  the real-world transfer/refund. The server remains authoritative and records the reason in the payment,
  audit, outbox, and any ledger reversal.
- Success reloads the same request. The payment is `VOIDED`; a posted settlement journal has one true
  reversal; request and expense-payment rollups return to unpaid; the request becomes
  `READY_FOR_PAYMENT` and can be paid again.
- If the business intent is to stop the claim, the user then invokes the existing “ยกเลิกคำขอ” action
  with a separate required reason. The cancellation saga voids the claim projections and finishes as
  `CANCELLED`. History still proves that a payment existed and was reversed.
- v1 deliberately does not add a one-click `void-after-payment` composite endpoint. The existing atomic
  payment reversal plus durable cancellation intent already make each boundary independently retryable;
  hiding both under two browser calls would make partial success harder to understand and recover.

### 18.5 Acceptance criteria

- [ ] Finance “ส่งกลับให้แก้ไข” requires a reason and atomically produces an editable DRAFT.
- [ ] The requester can edit reason, every line, category, date, amount, purpose, receipt, and missing-
      receipt reason, then resubmit under the same request number.
- [ ] Resubmission creates a new approval snapshot/step, keeps old decisions as history, and never reuses
      signatures or signed copies from the previous facts.
- [ ] Owner can complete correction -> resubmit -> self-approve -> finance -> pay end to end.
- [ ] A user with payment-void permission can void one recorded payment from the drawer; a user without it
      cannot see or invoke the action.
- [ ] Posted and unposted payment voids both end with correct payment/request/projection totals; posted
      void has exactly one ledger reversal under retry/concurrency.
- [ ] After void, the user can either pay again or explicitly cancel the request; cancellation records its
      own reason and never runs automatically in the browser.
- [ ] Loading, permission, stale state, double click, lost response, validation, and server failure leave
      the visible request refreshable and consistent with the server.
