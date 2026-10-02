# Agent Memory: review-bug-fixes-2026-10-01

Status: Six bugs from the two 2026-10-01 spec reviews fixed, one commit each, plus two follow-ups (2026-10-02), on `claude/review-bug-fixes-20261001` (from `origin/develop` `ae13970b0`). Not pushed, no PR, nothing deployed.

Update 2026-10-02: that branch is on develop (merge of #950, `6dd3c8c7d`). Round 2 and round 3 (single-admin mode for a data-rights case) are the dated sections at the end of this file.

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

## Round 3 — 2026-10-02 (single-admin mode for a data-rights case, with a migration)

Status: Built. Branch `claude/data-rights-single-admin-20261002` from `claude/review-bug-fixes-2-20261002` (`e10854eb4`), worktree `/private/tmp/mangmee-data-rights-single-admin-20261002`. Develop moved twice while this was being built and is merged in both times: `8cd71f594` (round 2 had reached develop as #954; docs only, no conflict) and `80c6b7952` (the sales-credit work, #956; two status documents were edited on both sides and both sides are kept). Not pushed, no PR, nothing deployed. It carries a migration, a `schema.prisma` change and a `ci.yml` line, so it goes through the normal release path (UAT, READY, Production), not the hotfix path.

Scope: the owner's decision on Fix 2 of round 2 (build it with a migration and lift all five same-person rules the same explicit way), the admin page for it, and one small extra: `crm-lead.use-case.ts` trusted a role key `SYSTEM` that no role has.

Decisions:
- When it applies: only while the platform has exactly one active System Admin and that person is the caller. "Active System Admin" is an active person holding the system-owned System Admin role through an active membership of an active company (`PLATFORM_SEAT_EXEMPT_ROLE`); a company role that merely carries the key does not count. `DataRightsService.selfStep` counts inside the transaction of the step. With a second active System Admin the separation rules stand and the single-admin path is refused, with or without a reason.
- An account whose sign-in is disabled does not count. The first version counted every active holder of the system role. The production System Admin cutover of 2026-09-07 (`prisma/system-admin-cutover.ts`, evidence under `docs/qa/evidence/release-2026-09-07/`) retired the old admin by disabling its credential and kept the protected user, membership and role rows, so production would have counted two admins for ever and refused the one real admin. Fixed in `497939aae`: a credential with status DISABLED takes the account out of the count; a temporary or active credential, or no password credential at all, still counts.
- What it is: each of the five steps the database refuses to the same person (creator = approver, approver = executor, executor = verification starter, executor recording independent verification, executor = completer) may be taken as an explicit single-admin step: a reason (20 to 1000 characters, at least 8 distinct letters; one rule in `packages/contracts/src/data-rights.ts`), a marker and the reason stored on the row of that step, an audit row of its own (`system.data_rights.single_admin_step`, CRITICAL) and a label on the case journal entry. The audit row and the label are written last, after the step's own checks and write have succeeded.
- Guardrails: nothing is relaxed. Every step keeps the checks it had (identity and company authority verified, all 12 category decisions current and allowed, retention dates current, execution evidence complete, the completing verifier's own independent-verification evidence, the hash format).
- Database: migration `20261002120000_data_rights_single_admin_mode` adds ten columns (four marker and reason pairs on `DataRightsCase`, one pair on `DataRightsEvidenceRecord`), three CHECK constraints and replaces the two trigger functions in place. The marker is true exactly when the same person took both steps (CHECK, both directions); a marker needs a reason of at least 20 characters and a reason needs a marker; a same-person step without the marker and reason is refused with the same SQLSTATE 55000 messages as before; a marker or reason changes only on its own step; a marker on other evidence or on another person's evidence is refused. No back-fill; existing rows keep the default.
- The database does not know how many System Admins exist. That part is the service's, as decided. A row written straight to the database with a marker and reason by the same person is accepted whatever the admin count.
- No erasure. No executor exists and none was added. `startExecution` and the later steps move the case status, stamp the actor and append a journal row. The case page says so on every case and again when a case is closed.
- No system-wide switch. P31 §8.6 asks for an explicitly declared setting. Availability comes from the admin count (the owner's 2026-10-02 rule) and every use is declared step by step, so no step passes silently. A separate on/off switch was not built.
- Not built: gates E1 and E3 (they need the inventory tool of plan D2 and an executor that produces evidence; neither exists), E4 and E4' (replaced by the deferred B8 fourteen-day hold), and the completion letter (the system writes none; the runbook tells the operator to state the single-person steps).
- Not built, and a question: gate E2 (typing the shop's name before execution). It is the one gate of P31 §8.4 that could exist without the executor. The spec ties it to the execute button that really deletes, and it needs three product answers first: which of the shop's names counts (`name`, `registeredName`, `brandName`), whether the page shows that name, and whether it applies to the single-admin path only or to both. If wanted, it is an API and page change with no migration.
- Web: `dataRightsSameActorModes` replaces `dataRightsRoleSeparationBlocks` and answers NORMAL, SINGLE_ADMIN or SECOND_ADMIN for approval, execution and verification from the `singleAdminAvailable` flag the API returns with a case. The evidence form used to be hidden from the executor in every status, so the executor could not add execution evidence through the page at all; it is now hidden only while the case is in verification and a second admin has to record the result.
- CRM extra: the smaller correct change was to remove `SYSTEM` from the role list in `crm-lead.use-case.ts`, since no role has that key. Reserving the name would not have covered a role that already exists.

Release gates (read in the repository, not run against a deployed environment):
- CI job "Migrations and Boot": `prisma validate`, `migration:review`, `prisma migrate deploy` on an empty database, then the PostgreSQL specs, now including `data-rights-single-admin.pg.spec.ts`.
- UAT, READY and Production (`infra/kamal/release.py`): `verify-applied-migration-catalog.ts` with pending migrations allowed runs `assertProductionA5NoDestructiveSql` on each pending migration, then `prisma migrate deploy`, then the exact catalog check. The migration passes that scan (a service test holds it). READY also rehearses `migrate deploy` on a clone of production (`run-release-readiness-clone.ts`), which is where the three CHECK constraints meet the real rows.
- `apps/api/prisma/production-a5/reviewed-migration-catalog.ts` pins md5 hashes of the two old function bodies. Only the first-generation `reviewed-v1` path reads them, and that path runs only on a database where its 42 migrations are still pending. No current gate compares against the old bodies, so the catalog was left alone and no decision was needed.

Open questions:
- Production and UAT must each have exactly one active System Admin by the definition above for the mode to be available. From the cutover records that is the replacement account alone, but it was not read from a database. If another account that can sign in also holds the system role, the mode is refused and two people are needed as before; on UAT that is also the designed behaviour to test.
  The count is: distinct `userId` of `CompanyMembership` rows with status ACTIVE, whose user is ACTIVE with no DISABLED credential and whose company is ACTIVE, joined through `MembershipRole` to the `Role` with key `SYSTEM_ADMIN`, status ACTIVE, `isSystem` true, `scopeKey` `system` and no `companyId`.
- The migration also adds three CHECK constraints, beyond the columns and the two replaced functions the brief named. They make the marker truthful on INSERT as well as UPDATE, which a transition trigger cannot. If only columns and functions are wanted, the same rules can move into the trigger functions.
- The case page still shows user ids and English operator terms in the parts that were already there. Not changed.
- In local `next dev` the page sometimes stays on the root loading text: the loading segment's script tag has no CSP nonce under Turbopack and is blocked, and the runtime then waits for it forever. It happens on pages this branch does not touch and a reload gets past it. Not changed; production builds with webpack.

Artifacts: commits `6e6979633` (CRM role key), `47d60d7e8` (backend, migration, PostgreSQL spec, CI line), `8e2aad4f9` (web), `78863a43f` (web follow-ups from the browser check), `4c8ecc818` (hash-format test), `6467ff20d` (docs), `8cd71f594` (merge of develop), `6787050d3` (retention-date test), `3790e47a7` (docs: the bug record and the executive spec no longer call the dead end open), `497939aae` (a disabled sign-in is not a second admin), `16ecd1872` (docs for that rule), `80c6b7952` (second merge of develop), `e7afb3f03` (one status sentence that arrived with it). Docs: P31 spec §8.7 and §11.5, P31 plan D5.1, runbook §2 and §2.1, the current-code bug record (RB-30), executive backend spec §18, §18.2 and §21.

Verification (2026-10-02, last full run 08:42 to 08:48 on `e7afb3f03`, after the second merge of develop and a fresh `prisma generate`; the commit after it changes this file only):
- API typecheck (package script, heap flag): pass. Web typecheck: pass, and once more without the incremental cache.
- Touched specs: API 92 pass (service 17, controller 5, CRM workflow 70), web 32 pass (logic 15, API client 6, error coverage 11), contracts 344 pass.
- Each new test fails on the previous sources. With the sources of each commit reversed: CRM 69 pass, 1 fail; backend 15 pass, 7 fail, and the 4 PostgreSQL tests cancelled because their setup needs the migration; web 16 pass, 5 fail (4 added, 1 rewritten for the new function); the contracts spec file does not load, because it imports an export that does not exist yet. For the sign-in rule alone, with only that change reversed: the PostgreSQL spec gives 3 pass, 1 fail (a retired admin is counted), and the service spec fails on the query it pins.
- PostgreSQL spec on a throwaway `postgres:18.3-alpine` container (the image CI uses): 4 pass; skipped cleanly without its environment variable. Every container this work started, and its volume, was removed.
- Upgrade path (scratch probe, not committed, run on `6467ff20d`): 266 migrations, then three cases written through the old guards by two people (one completed, one in review, one executing; 37 evidence rows), then this migration on top without error. The existing rows keep every marker false. The new code reads the completed case, and the only admin approves the case that was in review and verifies and closes the one that was executing, as single-admin steps.
- `migration:review`: exit 0. `prisma validate`: valid. `prisma migrate deploy` on an empty database: every migration applied.
- Release-gate specs outside `src` (`verify-applied-migration-catalog`, `verify-production-ready-migration`, `run-clone-rehearsal`, `run-production-apply`): 26 pass.
- Boot DI smoke: Nest resolved every provider (no provider changed).
- Whole web suite: 2231 pass (2220 before the sales-credit merge). Full API `test` script: exit 0.
- W00 capability manifest spec: 4 pass, no regeneration. Maintenance release pins: current, no pinned file changed. `git diff --check`: clean.
- Local HTTP run (API built from `8e2aad4f9` on a throwaway PostgreSQL): the one System Admin took a case from RECEIVED to COMPLETED. Each of the five steps answered 422 `data_rights_single_admin_reason_required` without a reason and 200 with one.
- Browser at 390 px on the same local stack: all five single-admin steps taken through the page; the closed case shows the label, the five reasons and the history labels; no horizontal overflow. With a second System Admin the page shows the refusal and no reason field, and a page left open while a second admin appeared got the plain-Thai refusal from the server. Two things that check found are fixed in `78863a43f`.
- Not run: Playwright e2e (no e2e spec touches these pages), the LINE-AI whole-chain acceptance (no LINE-AI file changed), anything against a deployed environment.

Hotfix allow-list: not eligible (migration, `schema.prisma`, `.github/workflows/ci.yml`).

Next: coordinator review, the answer to the shop-name question, then push/PR and the normal release path. At merge: other open branches add PostgreSQL spec lines at the same place in `ci.yml` and may edit the status lines of the bug record and the executive documents that this branch also edits (keep both sides, as was done for #956), and worktrees that take this change need `prisma generate`. Before relying on the mode in production, confirm with a read that the count of active System Admins there is one.
