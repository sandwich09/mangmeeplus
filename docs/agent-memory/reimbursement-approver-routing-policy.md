# Agent Memory: Reimbursement Policy Correctness and Role Routing

Status: Combined spec + implementation plan complete; Phase C1 correction/post-payment recovery implemented, reviewed, and ready for PR (2026-08-21). Role-routing Release A/B remains preflight-gated.

Owner: thawatchai.

Scope:
- Replace reimbursement policy mode + free-text role with one constrained role selection.
- Make approval threshold and ACTIVE/INACTIVE policy behavior truthful.
- Freeze prospective policy facts per new submitted request.
- Close role/holder/branch/OWNER, policy-write concurrency/uniqueness, queue/mutation, notification/task/SLA, finance/payment snapshot, runtime DTO, and legacy-state gaps.
- Preserve existing pending steps, null-snapshot requests, named-user routes, and admin-owned workflow rules.
- Close finance NEEDS_INFO, existing-draft edit, payment-void UI, signature/signed-copy invalidation, and
  explicit post-void cancel gaps as independent Phase C1.

Decisions:
- New UI/new route writes choose one role only; there is no mode, person picker, or free-text role.
- Canonical save: MANAGER → `MANAGER_ROLE`, OWNER → `OWNER_ROLE`, other eligible role → `CUSTOM_ROLE`; explicit role edits clear `defaultApproverUserId`.
- Purpose-built `reimbursement-policy/approver-options` stays under `reimbursement.policy.manage`; do not require `access.role.read`.
- Selectable roles are ACTIVE, non-platform, contain reimbursement read+approve+reject after entitlement filtering, and have active holders.
- Coverage is COMPLETE/PARTIAL/NONE over actual active branches. PARTIAL is selectable only when OWNER covers every uncovered branch.
- Routine notification/task targets the selected role. OWNER is routine only for branch/unavailable fallback and joins SLA escalation.
- Shared role queue is intentional; one-winner CAS and actual decision audit provide safety/accountability. Claiming/round-robin stays backlog.
- `approvalRequiredFromAmount` is the sole executable threshold; amount equal or above requires approval.
- Below threshold skips the approval step: finance on → FINANCE_REVIEW; finance off → durable APPROVED/POLICY projection → READY_FOR_PAYMENT.
- INACTIVE blocks new submit before mutation; drafts and in-flight approvals/finance/payments continue.
- New submissions store versioned `approvalPolicySnapshotJson`; business facts are frozen while current permission/member/branch facts remain authoritative.
- Existing null-snapshot requests keep legacy behavior; no historical snapshot is guessed.
- Policy CAS uses `expectedUpdatedAt`; a raw partial unique index enforces one NULL-branch company policy.
- Duplicate company-policy rows block migration until authorized remediation selects a canonical row.
- Existing named-user/contradictory policies are classified. Omitted role preserves them; a save is allowed when the route is actionable or the policy is being deactivated. Unsafe ACTIVE routes must be corrected explicitly. Pending steps never change.
- Rollout requires Release A additive schema/runner/projection expansion before Release B API/UI/template switch; rollback B targets accepted A.
- One additive Prisma migration is required: nullable snapshot JSON, partial unique index, and synchronization of the dead threshold alias. No new dependency, permission key/grant, or package script.
- Phase C1 reuses the current finance-review command, payment true reversal, cancellation saga, request
  number reuse, and create form. It adds no permission key, dependency, package script, or one-click
  browser chain for void+cancel.

Open questions:
- None in product semantics. Phase 0 data preflight may reveal duplicate company policies requiring authorized business selection before migration.
- Named-person routing, backup/delegation, reassignment, task claiming/round-robin, and branch/multi-step/amount-tier policy designers remain backlog.

Artifacts:
- `docs/specs/reimbursement-approver-routing-policy-spec.md`
- `docs/plans/reimbursement-approver-routing-policy-plan.md`
- `docs/plans/master-implementation-checklist.md` item-14 follow-up + reorder log
- Interactive role-only mockup under the Codex visualization workspace.
- Spec §18 and plan Phase C1 define correction and post-payment recovery.

Verification:
- Repository discovery traced current UI/contracts/controller/use case/repository, nullable company-policy uniqueness, duplicate threshold fields, status reads, submit state/step/hash, projection/reconciliation, queue + approve/reject + transaction guards, finance/payment policy reads, feature entitlements, branch scope, role override/catalog, workflow recipients/tasks/SLA, workflow rule resync, self-approval, registered tests, and reimbursement E2E.
- Verified the parent spec drafted `approvalPolicySnapshotJson` but the live Prisma request model does not contain it.
- Verified current threshold result is audit-only, INACTIVE is consumed like ACTIVE, workflow delivery is hardcoded MANAGER/OWNER, policy upsert lacks CAS, and E2E spreads GET into PUT.
- Owner superseded the temporary person-only decision with role-only on 2026-08-21.
- Existing interactive role picker validation passed COMPLETE/PARTIAL/legacy states at 736 px and 360 px with one role picker, no mode/person picker, ≥44 px touch height, no horizontal overflow, and no JavaScript error.
- Combined documentation validation passed on 2026-08-21: tracked `git diff --check`, no-index whitespace checks for all three new docs, source-of-truth link existence, and targeted stale-decision/placeholder scans. Spec and plan both cover threshold, INACTIVE, snapshot, partial uniqueness, role/OWNER, legacy, and Release A/B.
- Phase C1 registered reimbursement suites passed: API 269 passed/8 skipped (277 tests) and web 70 passed
  (2026-08-21). Focused workflow, claim-form/signature, payment-reversal, request/resubmit,
  permission/branch, correction-transaction, and evidence-retention tests are included in those runs.
- API and web typechecks passed on the scoped reimbursement branch. API build also passed.
- Workflow auto-enable synchronization and event-ingest suites passed together (28 tests), including the
  correction requester route and the updated finance condition.
- Final UI review closed a failure-state gap: reject/correction/cancel/payment-void dialogs now remain
  open and show the server error; they close only after the mutation succeeds. Web typecheck and focused
  reimbursement tests passed again after this fix.
- Local browser read-only verification passed with the seed OWNER: draft drawer -> existing-draft edit,
  cancel/correction/void reason modals, disabled confirmation gates, desktop rendering, 390 px rendering
  with `scrollWidth === innerWidth`, and zero browser console errors. No correction/void/cancel mutation
  was submitted during this check, so the three mutation E2E journeys remain open.
- Existing unrelated dirty changes were observed and not edited.

Next:
- Commit only Phase C1 scoped files, push `codex/reimbursement-role-correction-void`, and open a PR to
  `develop`; keep unrelated LINE worktree files uncommitted.
- Execute Phase 0 read-only preflight. Do not create/apply the partial unique index until duplicate NULL-branch policies are proven absent or explicitly resolved.
- Then implement and accept Release A before combining any Release B API/UI/template switch.
