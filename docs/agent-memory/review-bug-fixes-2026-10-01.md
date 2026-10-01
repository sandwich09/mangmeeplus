# Agent Memory: review-bug-fixes-2026-10-01

Status: Six bugs from the two 2026-10-01 spec reviews fixed, one commit each, plus two follow-ups (2026-10-02), on `claude/review-bug-fixes-20261001` (from `origin/develop` `ae13970b0`). Not pushed, no PR, nothing deployed.

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
