# Agent Memory: Reimbursement Policy Correctness and Role Routing

Status: Phase C1/C2 and the constrained reimbursement role-picker/save-validation slice are implemented and locally verified on the PR branch (2026-08-21). Broader threshold/snapshot/workflow Release A/B remains preflight-gated.

Owner: thawatchai.

Scope:
- Replace reimbursement policy mode + free-text role with one constrained role selection.
- Make approval threshold and ACTIVE/INACTIVE policy behavior truthful.
- Freeze prospective policy facts per new submitted request.
- Close role/holder/branch/OWNER, policy-write concurrency/uniqueness, queue/mutation, notification/task/SLA, finance/payment snapshot, runtime DTO, and legacy-state gaps.
- Preserve existing pending steps, null-snapshot requests, named-user routes, and admin-owned workflow rules.
- Close finance NEEDS_INFO, existing-draft edit, payment-void UI, signature/signed-copy invalidation, and
  explicit post-void cancel gaps as independent Phase C1.
- Close role-name authorization gates, action/permission mismatches, active-screen single-role replacement,
  and review-only accounting preset drift as independent Phase C2.

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
- Effective permissions, not role names, authorize reimbursement tabs/actions. Role keys still govern
  approval responsibility and existing branch/self/state/snapshot/CAS boundaries.
- Members may hold multiple roles; employee UI saves the complete `roleIds[]` and effective access is
  the union. The final role cannot be removed.
- `pack.reimbursement.review` grants read/related/finance-review/export only. It is included in
  `tpl.x.accounting` and deliberately excludes payment record/void and duplicate resolution.
- Permission composition is system-wide, not reimbursement-specific: the same role union drives expense
  creation, evidence upload, substitute-receipt review/confirmation, reimbursement, navigation, routes,
  employee summaries, and user-guide shortcuts. Supporting reads widen only to the matching action and
  retain tenant/ownership/related-record scope; they never become a company directory/read grant.

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
- Phase C2 source evidence confirmed backend multi-role storage/union, role-fork editing, all-branch
  enforcement, and permission-checked reimbursement APIs already existed; gaps were in active web
  pickers, role-name tab gating, action-level UI gating, and preset composition.
- Employee/role flow review additionally found and closed read-only create/edit controls, direct employee
  route permission mismatches, update-only DRAFT activation, stale selection after role creation, and
  stale system-role id after a company fork.
- A second employee/role contract pass found action-without-read dead ends: employee create/update and
  role-manage permissions could pass the mutation check but fail supporting role/address/catalog reads.
  Supporting read endpoints now accept the equivalent action permission with OR guards; the role page
  deliberately skips company employee-list loading unless `access.employee.read` is present.
- Owner expanded the rule beyond reimbursement to expense creation and substitute receipts. The audit
  found that `expense.create` could not reopen the draft it had just made, `expense.confirm` could list
  substitute approvals but not load their detail/history/PDF, and expense self/review packs omitted
  `attachment.create` while their UI offered evidence upload. These seams are now aligned without
  giving a creator company-wide expense read; its supporting read is creator-owned only.
- Phase C2 focused evidence: reimbursement/role-picker web tests 65/65; employee create/update/role
  management tests 78/78; permission/template registry tests 102/102. The STAFF fork test proves finance
  review is added, payment/void/duplicate rights are absent, and this company's membership moves to the
  fork.
- Local Postgres was migrated through all 146 migrations, then seed and permission synchronization
  completed (345 permissions, 13 system roles, 1,449 grants, 11 QA accounts). Local API/web and MinIO
  were used for real browser flows; no cloud environment was touched.
- In-app browser evidence with seed OWNER confirmed the composed-role screen and a Finance + Accountant
  employee summary: both role names persist, effective capabilities are displayed as a union, and the
  all-branch rule remains explicit.
- Playwright browser evidence passed 46/46 in one run across the ten seeded personas, sidebar/direct-route
  matrix, expense create/edit/cancel/confirm/upload, reimbursement create/submit/approve/finance/pay,
  employee create/edit/multi-role, and role create/edit flows. SET-08E creates an isolated Staff + custom
  expense/reimbursement reviewer, completes its temporary-password journey, logs in as that employee,
  creates an expense draft, opens substitute-receipt work, sees related + finance reimbursement tabs,
  and proves approval/policy/payment rights remain absent.
- The complete Chromium workspace run finished with 158 passed, 80 project/feature-contract skips, and
  zero failures across every registered desktop feature suite. It exposed three
  stale journal UI expectations: the screens are intentionally closed by `ACCOUNTING_UI_HIDDEN`, but the
  tests still expected them to render. The harness now asserts the launch-time dashboard redirect and
  automatically re-enables the three journal journeys when the feature flag opens.
- Final focused API tests passed 179/179; the complete registered web suite passed 1,040/1,040 after a
  stale role-name assertion in the user-guide contract was corrected to `reimbursement.policy.manage`.
  API, web, and contracts typechecks passed; `git diff --check` passed.
- Multi-role display follow-up closed the remaining list/detail mismatch: employee rows no longer read
  only `roles[0]`; all held roles are stacked on the same right-aligned axis. Web typecheck and SET-08B
  passed, and a local 390 px browser check showed Finance + Accountant consistently in the row and
  detail with `scrollWidth === innerWidth === 390`.
- Reimbursement policy role-picker follow-up closed the free-text role key: the page consumes a
  manage-only catalog, shows human labels plus active approver counts, and sends the role only when
  the route was explicitly edited. The API recomputes entitlement/holder/branch readiness at save,
  canonicalizes MANAGER/OWNER/custom mode, and clears a stale named user. Focused role readiness/save
  tests passed 7/7, permission-registry tests 34/34, and reimbursement-guide tests 7/7; contracts, API, and web typechecks passed. Local browser evidence proved OWNER select →
  save → reopen, then restored MANAGER, at desktop and 390 px. The local read-only policy uniqueness
  preflight returned zero duplicate company-level policies.
- Picker wording follow-up removed “N คนพร้อมอนุมัติ” from each role option because it looked like an
  approval quorum. The selected-role help now separates “ผู้รับผิดชอบ N คน” from the executable rule
  “ใบเบิกใช้คำตัดสิน 1 คน และใช้ผลจากคนแรกที่อนุมัติหรือปฏิเสธ”.

Next:
- Review the final scoped diff, commit only reimbursement picker task files, and update the active PR;
  keep unrelated partner-package, LINE, menu-entitlement, and employee-access files uncommitted.
- Execute Phase 0 read-only preflight. Do not create/apply the partial unique index until duplicate NULL-branch policies are proven absent or explicitly resolved.
- Then implement and accept Release A before combining any Release B API/UI/template switch.
