# Agent Memory: Reimbursement Policy Correctness and Role Routing

Status: Phase C1/C2 and the threshold/status/policy-snapshot/exact-assignee/workflow/concurrency reimbursement-policy correction are implemented and locally verified on the PR branch (2026-08-22). Final regression review and PR handoff are in progress; no UAT/Production deployment is claimed.

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
- New submissions store versioned `approvalPolicySnapshotJson` plus exact recipient ids on the approval step. An active frozen assignee retains that exact task after a role/permission change; active membership and branch remain dynamic, and all-inactive opens recorded role/OWNER recovery.
- Queue/detail/approve/reject routes declare baseline `account.session.read` metadata to satisfy the global deny-by-default guard. Normal reimbursement permission or exact frozen-step assignment remains the business gate, and approve/reject repeat it transactionally.
- Notification goes to every frozen recipient. The single-assignee workflow helper task is pinned to one exact frozen recipient by user id; payload/static role is legacy fallback only. A later holder of the old role never inherits that reminder or approval task.
- Existing null-snapshot requests keep legacy behavior; no historical snapshot is guessed.
- Policy CAS uses `expectedUpdatedAt`; a raw partial unique index enforces one NULL-branch company policy.
- Duplicate company-policy rows block migration until authorized remediation selects a canonical row.
- Existing named-user/contradictory policies are classified. Omitted role preserves them; a save is allowed when the route is actionable or the policy is being deactivated. Unsafe ACTIVE routes must be corrected explicitly. Pending steps never change.
- Rollout requires Release A additive schema/runner/projection expansion before Release B API/UI/template switch; rollback B targets accepted A.
- One additive Prisma migration is required: nullable request policy snapshot JSON, nullable step assignment snapshot JSON, partial unique index, and synchronization of the dead threshold alias. No new dependency, permission key/grant, or package script.
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
  manage-only catalog, shows human role labels without approver counts, and sends the role only when
  the route was explicitly edited. The API recomputes entitlement/holder/branch readiness at save,
  canonicalizes MANAGER/OWNER/custom mode, and clears a stale named user. Focused role readiness/save
  tests passed 7/7, permission-registry tests 34/34, and reimbursement-guide tests 7/7; contracts, API, and web typechecks passed. Local browser evidence proved OWNER select →
  save → reopen, then restored MANAGER, at desktop and 390 px. The local read-only policy uniqueness
  preflight returned zero duplicate company-level policies.
- Picker wording follow-up removed all visible approver headcounts because they looked like an approval
  quorum. The dropdown now shows role names only; the only steady-state helper explains the
  one-decision/first-result rule.
- Pre-implementation review found the remaining end-to-end gaps are executable, not speculative:
  submit does not revalidate request-specific role/branch/self readiness; workflow notification/task/SLA
  still routes statically to MANAGER/OWNER; threshold is audit-only; submitted work reloads mutable policy
  facts; policy writes lack CAS/NULL-branch uniqueness; and CI catches the two new picker errors outside
  the shared Thai map. The spec and plan now include these findings and preserve the no-holder-count UX.
- Release A/B local implementation added the nullable request policy snapshot and approval-step assignee
  snapshot, synchronized threshold alias, partial central-policy uniqueness, strict DTO/parser, policy
  CAS, transactional audit/outbox, ACTIVE/threshold state paths, POLICY projection/reconciliation,
  exact routing at submit, frozen queue/decision/SLA behavior, and dynamic notification/task payloads.
- Local PostgreSQL applied migration `20260821190000_reimbursement_policy_runtime_correctness`; Prisma
  reports all migrations applied. The partial unique index and both nullable JSONB columns were read
  back from the real catalog.
- Targeted API reimbursement/policy/workflow tests passed after the exact-assignment changes; the
  post-review focused approval/request/workflow run passed 76/76. Full API regression and
  contracts/API/web typechecks also passed after the final branch/notification/outbox fixes.
- In-app browser local evidence as seed OWNER confirmed the real dropdown wording, no count helper,
  threshold/finance outcome preview, and values `แอดมิน`, `ผู้จัดการ`, `เจ้าของกิจการ` only. Screenshot:
  `/Users/thawatchai/.codex/visualizations/2026/08/21/01a022c1-6b71-7721-a597-7bb03856c7d2/reimbursement-policy-role-dropdown-local-focused.png`.
- Browser-assisted HTTP snapshot flow created `RB-202608-00078` under the MANAGER policy and verified the
  step froze the exact eligible user ids. After changing `qa.manager` from MANAGER to STAFF, the first
  HTTP run exposed a real integration bug: routes without permission metadata were rejected before the
  use-case snapshot gate (`Permission metadata is required`). Baseline session route metadata fixed it.
  The changed-role session then received queue 200 with exactly the target row, detail 200 with both
  decision actions true, and approve 200 to FINANCE_REVIEW; the step records
  `decisionByUserId=seed-qa-user-manager`. The QA membership was restored to MANAGER afterward.
- Web navigation now keeps ordinary approval-tab visibility permission-driven and probes the server only
  for sessions without approve/reject. A non-empty exact-assignment queue adds the tab for that company;
  a zero-row response exposes nothing, and completing the last frozen task does not erase the success
  state during the current page session. Final full web regression passed: 1,047 tests, 0 failures.
- The workspace route gate now admits `account.session.read` only to the reimbursement hub root so an
  exact task deep link survives removal of all reimbursement permissions. It does not add a sidebar row
  or open nested reimbursement paths; the hub still requires the server-confirmed frozen queue.
- Final semantic review also made active-assignee recovery branch-aware, removed a second requester
  exclusion that suppressed valid self-approval notifications, sorted frozen recipient ids for a
  deterministic helper-task owner, and keyed submit/outbox events by submission epoch so a correction
  resubmitted under the same policy is not deduplicated away.
- Prisma schema validation and migration status passed with all 147 migrations applied. A separate
  drift diagnostic reports only pre-existing, unrelated differences in DataRightsCase, ExpenseRecord,
  LegalDocumentActionRecord, and RemoteRelease tables/indexes; it reports no reimbursement object.

Next:
- Keep the two unrelated untracked LINE advisor docs untouched.
- Commit and push only the reimbursement-policy change set to the existing PR; record CI outcome. UAT/Production remains a separately authorized phase.
