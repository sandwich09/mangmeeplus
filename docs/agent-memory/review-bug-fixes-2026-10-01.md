# Agent Memory: review-bug-fixes-2026-10-01

Status: Six bugs from the two 2026-10-01 spec reviews fixed, one commit each, plus two follow-ups (2026-10-02), on `claude/review-bug-fixes-20261001` (from `origin/develop` `ae13970b0`). Not pushed, no PR, nothing deployed.

Update 2026-10-02: that branch is on develop (merge of #950, `6dd3c8c7d`). Round 2 is the dated section at the end of this file.

Owner: Coordinator session; implementation by one agent in worktree `/private/tmp/mangmee-review-bugfix-20261001`.

Scope: RB-40, RB-36, RB-34, RB-38 (`docs/research/mangmee-executive-spec-review-backend-2026-10-01-th.md` §3) and B1/F02, B3 (`docs/research/manual-expense-web-entry-flag-review-2026-10-01-th.md` §4). Every change is application source, a spec or a doc: no migration, dependency, `package.json` or config change, and no file pinned by the maintenance-release validator.

Decisions:
- RB-40: the target-company path parameter on platform routes is `:partnerCompanyId`. Four routes had `:companyId`, not two: the referral repair, the flag review, and the two `system/identity-reconciliation/companies/…` routes. The referral repair still does not set `referredAt` (owner decision). The referral editor has no description line, so the screen was left alone.
- RB-36: a controller guard, `SalesAgentActiveGuard` in `sales-context.ts`, on every sales-console controller that requires a sales permission. `assertPlatformTenant` is synchronous and has no database access, so the status check could not live inside it without touching 45 call sites or adding a sales field to the auth request context. No profile passes; SYSTEM_ADMIN is exempt. The web notice lives in `SalesHeader` because `apps/web/app/**` is outside the hotfix allow-list.
- B3: one rule, `salesDealFeatureKeys` (contracts `sales.ts`), bounded by `SALES_DEAL_ALLOWED_FEATURE_KEYS`. Unbounded, a bare `dashboard_notifications` (which the starter preset itself carries) would gain two submenus a deal may not sell and every deal would fail its next save. Billing reads stored deals through `dealSnapshot` → `buildDealSnapshot`, so the save rule is also the hand-off rule.
- RB-34: `roleGrantViolation` takes the platform-company fact from the use cases (default refuses). Only the two sales roles are filtered from a shop's role list; `SYSTEM_ADMIN` stays listed as before.
- F02: `@RequireAnyPermission('expense.delete', 'expense.update')`. `expense.delete` is gated by `expenses` only, not `expenses.manual`; the runoff-matrix row records that.
- RB-38: the filter is in `PrismaAuditRepository.getCompanyLogs`, whose only caller is the shop-facing endpoint. "Platform staff" is a member of the platform company with no membership in the shop, not "no membership row": an account merge moves the membership and would otherwise hide the shop's own history. System-written `billing.*` rows are treated as platform bookkeeping.
- Follow-up 1 (RB-34, approver picker): `ListReimbursementApproverOptionsUseCase.loadCandidates` ran its own role query and still offered a shop the two sales roles. It now applies the same test as `ListRolesUseCase`. That one method feeds both the picker and the route check, so a shop's route naming a sales role is refused as `approver_role_not_eligible`.
- Follow-up 2 (system-written audit rows): `AuditLog.actorUserId` is a foreign key to `User`. A USER-actor row carrying the placeholder id `system` is rejected (P2003 on `AuditLog_actorUserId_fkey`) and `AuditService.log` resolves without throwing, so the row is lost. Each occurrence now names a typed SYSTEM actor: the literal site by hand, the context-driven sites through `auditActorOf(userId, subsystem)`. `normalizeAuditActor`, which every `AuditService` write passes through, also keeps that id out of the foreign key, so a later caller cannot lose a row the same way. The consent withdrawal is a SYSTEM row (`crm-line-inbound`), as the code intended; the customer is the row's target. The verified self-service route already writes the customer as the actor (`CRM_CUSTOMER`).

Open questions:
- RB-38: should a shop see system-written billing rows about its own subscription (a renewal applied, grace started)? They are hidden now.
- B3: shops that already paid a bare-parent deal keep the wrong entitlement rows; that is a data repair, not done here.
- RB-34: `MANGMEE_EXECUTIVE`, when it is added, must join `PLATFORM_ONLY_ROLE_KEYS`.
- RB-34: the role endpoints that take a role id (`GET roles/:id`, the preview, `PATCH roles/:id`) do not apply the platform-only rule. A shop that knows a sales role's id can read it and fork it into a company role with the same key. The fork cannot be assigned (the grant rule is by key) and its permissions do nothing outside the platform company, but it would then appear in the shop's role list and approver picker, because both filters drop only the system-scoped row. Not changed: it is not a role list, and the id is no longer shown to a shop.
- Audit: some system-written rows pass neither a user nor an actor type (for example `billing.grace.started`, `workflow.run.execute`, the failed-delivery notification rows) and are stored as a USER actor with no user. They persist; only the label is imprecise. Not changed.
- Audit: `CreateAutonomousCrmBookingUseCase` writes no audit row of its own. Not changed.

Artifacts: commits `56151efc9` (RB-40), `e1017e68d` (RB-36), `4ed43b6f9` (B3), `0c4df95b0` (RB-34), `a4d8e288d` (F02), `6d94fcd9e` (RB-38), `1eabc5921` (follow-up 1), `c72350853` (follow-up 2). Docs touched: sales-deals spec §20.4.1, RBAC spec §19.6 audit endpoint and §19.8 audit actor rule, runoff matrix DELETE row, hard-delete plan note.

Verification (run on the six commits, 2026-10-02 00:03–00:25):
- API typecheck (package script) and web typecheck: pass.
- All changed spec files were run with the 21 changed source files reverted: the 15 new API tests, the 2 new web tests and the one updated assertion fail there, everything else passes; with the fix restored all pass.
- Every new API test is in a spec file listed in the `test` script of `apps/api/package.json`.
- Full API `test` script: exit 0. Whole web suite: 2216 pass. Contracts tests: 343 pass.
- `test:boot`: Nest resolved every provider.
- W00 capability manifest spec: pass, no regeneration (no hashed file changed). Whole-chain acceptance: exit 0.
- Maintenance release pins: current. `git diff --check`: clean.
- RB-38 SQL: the Prisma-generated query was run against an in-process Postgres (PGlite, scratch only) and returned exactly the expected rows, including rows with no user.
- Not run: `*.pg.spec.ts` and Playwright e2e (no database or stack in this session).

Follow-up 2, occurrences of the lost audit row (all fixed in `c72350853`):
- `crm.customer.marketing_consent.revoked` in `process-inbound-line-message.use-case.ts`: the only literal `actorUserId: 'system'` that reaches the audit table.
- `ledger.journal.generate`, three writes in `GenerateJournalFromSourceUseCase`: the auto-post worker runs it under `systemWorkerContext` (`userId: 'system'`). Now named by the worker's `authSubject`.
- `document.number.reserve` in `ReserveDocumentNumberUseCase`: the reservation that journal makes under the worker id. Now `document-number`, as commit/void/cancel already do.
- `accounting.counterparty.create|update` in `EnsureVendorCounterpartyFromExpenseUseCase`: the capture read applies a document as `{ companyId, userId: 'system' }`. Now `vendor-counterparty-auto-save`.
- Checked and not affected: the other `SYSTEM_ACTOR` / `LAUNCH_GATE_SYSTEM_ACTOR` uses (outbox payloads, `EntitlementTransition`, `FeatureLaunchGateTransition` and CRM columns, none a foreign key; the launch-gate command and the entitlement normalizer already type their audit rows), the `system:…` bootstrap ids (reviewer columns), the billing initiators `billing-worker` and `system:sales-deal-return` (their audit rows are typed SYSTEM or carry no actor), the workflow scan and the notification sweeps (no audit row with the context id), the reimbursement reconciler and the capture-result notifier (real user ids). Only 17 columns reference `User`; `AuditLog.actorUserId` is the only one a placeholder id reached.

Verification of the follow-ups (2026-10-02 00:30–01:00):
- API typecheck: pass after each follow-up.
- Follow-up 1: `reimbursement-request.use-case.spec.ts` with the source reverted: the one new test fails, 68 pass; restored: all pass.
- Follow-up 2: the five touched spec files with the sources reverted: the 6 new tests fail, 160 pass; restored: 166 pass. All five files are listed in the `test` script of `apps/api/package.json`.
- Follow-up 2 on an in-process Postgres with the full schema (PGlite, scratch only): on the old sources the entries the real use cases write are rejected with P2003 and 0 of 4 rows are stored, and `AuditService.log` resolves without throwing; on the fixed sources 4 of 4 are stored as SYSTEM rows, and an entry still written the old way is stored as SYSTEM `system`.
- Full API `test` script: exit 0. `test:boot`: Nest resolved every provider (no provider changed). W00 capability manifest spec: 4 pass, no regeneration. Whole-chain acceptance: exit 0. Maintenance release pins: current. `git diff --check`: clean.

Next: coordinator review, then push/PR and the release path the owner chooses. If the hotfix path is used, every changed `src` spec is a `--regression-test`.

## Round 2 — 2026-10-02 (two fixes the owner approved)

Status: Fix 1 is done in two commits. Fix 2 is NOT built: it needs a migration, so work stopped before writing one, as instructed. Branch `claude/review-bug-fixes-2-20261002` from `origin/develop` `6dd3c8c7d`, worktree `/private/tmp/mangmee-review-bugfix2-20261002`. Not pushed, no PR, nothing deployed.

Scope: (1) a shop could still read and copy a platform-only role by its id, and a custom role's name could derive a system role key; (2) the single System Admin cannot finish a data-rights case.

Decisions, Fix 1:
- One list. `PLATFORM_ONLY_ROLE_KEYS` now lives in `apps/api/src/modules/auth/permission-registry.ts`, and `PLATFORM_ROLE_KEYS` is built from it. A new platform-only role (the executive-report role) is defined in `SYSTEM_ROLES` and `ROLE_GRANTS` like any role and its key is added to that list; nothing else changes. This answers the round-1 open question about `MANGMEE_EXECUTIVE`.
- One test. `platformOnlyRoleRefused(roleKey, platformTenant)` in `employee-access.logic.ts`, asked by key. `roleGrantViolation`, `ListRolesUseCase` and the reimbursement approver candidates use it, and now so do `GetRoleUseCase`, `PreviewRoleUseCase` and `UpdateRoleUseCase`, which answer `404 Role not found`, the answer for an unknown id. This answers the round-1 open question about the routes that take a role id.
- A copy a shop already made. Because the test is by key, the copy is no longer listed, readable, editable, assignable or offered as an approver. The row and any assignment of it are left alone (the round-1 rule). `DisableRoleUseCase` is unchanged, so a copy can still be disabled by id.
- Reserved names. `reservedRoleKey` in `create-role.use-case.ts` refuses a new custom role whose key would be any `SYSTEM_ROLES` key or a platform-only key: `409 role_name_reserved`, message "ชื่อนี้ซ้ำกับบทบาทมาตรฐานของระบบ กรุณาใช้ชื่ออื่น", shown by the role form. Every system key is reserved, not only OWNER, SYSTEM_ADMIN and COMPANY_VIEW: a new role named after a standard role hid that role from the list while its holders kept the original, and a standard role is changed by editing it.
- The audit H-19 preset lookup is kept, narrowed. A name with no Latin letters still takes the key of the preset it names, but only for a preset that exists in the catalogue and never for an owner or platform key. `roleTemplateKey` is free text on the request: a Thai name sent with `x.system_admin` got the key `SYSTEM_ADMIN` before.
- Rules written down as R9 and R10 in `docs/specs/company-role-override-spec.md`; a pointer in the executive backend spec §17.1.

Decisions, Fix 2:
- No code. The five same-person rules are enforced by the database as well as by `data-rights.service.ts`: migration `20260809120000_data_rights_case_orchestration` creates `enforce_data_rights_case_transition` (creator = approver, approver = executor, executor = verification starter, executor = completer) and `enforce_data_rights_evidence_phase` (executor = recorder of independent verification), all `SQLSTATE 55000`. A self-approval built in the service is therefore rejected by the database, and the service spec would not notice because its fake database has no triggers.
- The only honest way through is a migration that replaces those two functions, which is outside the production hotfix allow-list. Recording the approval under any other user id would be the fake second account the owner forbids.
- Recorded in the P31 spec §8.1 and §11.5, the P31 plan D5.1 and the data-rights runbook §2.

What else trusts a bare role key (read, with a search agent, and the main citations re-read):
- `ctx.roles` is the list of KEYS of a membership's active roles, system or company-scoped, and most role checks compare those keys.
- OWNER, SYSTEM_ADMIN, COMPANY_VIEW: no product path can put a same-key company role on a membership. Employee create and update refuse these keys, editing refuses to copy them, and onboarding and the sales console look the role up by `scopeKey: 'system'`. So the unscoped checks below are not reachable through the product today; they would matter if such a row existed with a member (old data, a hand-written row, a future write path).
  - Platform-closed bypass: `auth.guard.ts:269`, `refresh-session.use-case.ts:93`, `password-login.use-case.ts:96`.
  - No Terms or Privacy acceptance required: `legal-acceptance.service.ts:247`, `:405`.
  - The platform operators' directory: `signup-admin-notify.service.ts:136` (new-signup notices that name other companies, and the operator of record for auto-approved signups), `plan-term-sweep.use-case.ts:198`, `sales-renewal.service.ts:270`.
  - Owner shortcut on grants: `role.controller.ts:33/51/65/80`, `employee.controller.ts:57/89`; owner fallback on approvals: `reimbursement.logic.ts:620`.
- ADMIN, MANAGER, FINANCE, ACCOUNTANT, HR, AUDITOR_READONLY and the other ordinary keys: a company role with the key is treated as that standard role. That is the override design, with consequences worth knowing: all-branch scope is forced by key (`ALL_BRANCH_ROLE_KEYS`), self-approval exemptions go by key (procurement, reimbursement, substitute receipt), and the CRM, inbox, audit and workflow broad-read lists and several notification recipient lists go by key. After R10 the ways to such a key are an edited copy of the standard role, the H-19 preset path, and rows that already exist.
- Checks that are scoped correctly and are the pattern to copy: `plan-term-limit.ts:24` (`PLATFORM_SEAT_EXEMPT_ROLE`), `billing-scopes.service.ts:14`, `system-email-delivery.service.ts:33`, `signup-claim-history.ts:10`. Checks that also need a `system.*` or `sales.*` permission, or sit behind `assertPlatformTenant`, are safe because a company role cannot carry those permissions.
- The payout-account rule is not in this worktree (docs only).

Open questions:
- Fix 2, for the owner: (a) the release path, since a migration means UAT then promotion, not the hotfix path; (b) the scope: lifting only creator = approver leaves a one-admin case stuck at the next rule (approver = executor), so finishing a case needs all five lifted the same explicit way.
- Fix 2, until then: two real people can finish a case (one opens and executes, the other approves, verifies and closes).
- Do any company-scoped roles keyed OWNER, SYSTEM_ADMIN, COMPANY_VIEW or a platform-only key exist in production, and does anyone hold one? Not checked: it needs a read of `Role` (`scopeKey <> 'system'`) joined to `MembershipRole`.
- The H-19 lookup never runs from the web: the role form does not send `roleTemplateKey` (and never did), so a Thai-named role made from the Manager preset still gets the key `ROLE` and matches no MANAGER-routed approval step. Not changed.
- `crm-lead.use-case.ts:228` accepts a role key `SYSTEM`, which no role in the registry has, so a custom role named "System" passes that role test (it still needs `crm.lead.convert`). Not changed.
- `update-role.use-case.ts`: when a company role with the same key already exists, editing the system role by id adopts that role as the copy and moves the system role's holders onto it. R10 stops new same-key roles by name; rows that already exist are not changed.

Artifacts: commits `9b418c2bb` (docs: the database also enforces the separation rules), `1e3fbf5bb` (platform-only role by id, a shop's copy, one list), `60ac698bb` (reserved role names, web message).

Verification (2026-10-02, on `60ac698bb`):
- API typecheck (package script) and web typecheck: pass. Commit `1e3fbf5bb` was also typechecked and tested by itself.
- The nine new API tests and the one extended web test fail on the previous sources and pass on the fix: with the ten changed source files reversed, the five touched API spec files give 166 pass, 9 fail, and the web error-coverage spec gives 10 pass, 1 fail. All are in spec files listed in the `test` script of `apps/api/package.json`.
- Full API `test` script: exit 0. Whole web suite: 2216 pass. `test:boot`: Nest resolved every provider (no provider changed).
- W00 capability manifest spec: 4 pass, no regeneration. Maintenance release pins: current, no pinned file changed. `git diff --check`: clean.
- Fix 2 finding: the migration SQL, unchanged, was run in an in-process Postgres (PGlite, scratch only) and the statements the service issues were replayed: each of the five same-person steps is refused with SQLSTATE 55000, and a case finishes with two people.
- Not run: `*.pg.spec.ts`, Playwright e2e, the LINE-AI whole-chain acceptance (no LINE-AI file changed), any query against a deployed database.

Hotfix allow-list: every changed path of the three commits is application source under `apps/api/src` or `apps/web/src`, or `docs/`. No migration, dependency, `package.json` or config change. Fix 2, when built, will not qualify.

Next: coordinator review; the owner's decision on Fix 2; then push/PR and the release path the owner chooses. If the hotfix path is used, every changed `src` spec is a `--regression-test`.
