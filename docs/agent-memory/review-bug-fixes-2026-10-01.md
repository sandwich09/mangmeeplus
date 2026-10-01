# Agent Memory: review-bug-fixes-2026-10-01

Status: Six bugs from the two 2026-10-01 spec reviews fixed, one commit each, on `claude/review-bug-fixes-20261001` (from `origin/develop` `ae13970b0`). Not pushed, no PR, nothing deployed.

Owner: Coordinator session; implementation by one agent in worktree `/private/tmp/mangmee-review-bugfix-20261001`.

Scope: RB-40, RB-36, RB-34, RB-38 (`docs/research/mangmee-executive-spec-review-backend-2026-10-01-th.md` §3) and B1/F02, B3 (`docs/research/manual-expense-web-entry-flag-review-2026-10-01-th.md` §4). Every change is application source, a spec or a doc: no migration, dependency, `package.json` or config change, and no file pinned by the maintenance-release validator.

Decisions:
- RB-40: the target-company path parameter on platform routes is `:partnerCompanyId`. Four routes had `:companyId`, not two: the referral repair, the flag review, and the two `system/identity-reconciliation/companies/…` routes. The referral repair still does not set `referredAt` (owner decision). The referral editor has no description line, so the screen was left alone.
- RB-36: a controller guard, `SalesAgentActiveGuard` in `sales-context.ts`, on every sales-console controller that requires a sales permission. `assertPlatformTenant` is synchronous and has no database access, so the status check could not live inside it without touching 45 call sites or adding a sales field to the auth request context. No profile passes; SYSTEM_ADMIN is exempt. The web notice lives in `SalesHeader` because `apps/web/app/**` is outside the hotfix allow-list.
- B3: one rule, `salesDealFeatureKeys` (contracts `sales.ts`), bounded by `SALES_DEAL_ALLOWED_FEATURE_KEYS`. Unbounded, a bare `dashboard_notifications` (which the starter preset itself carries) would gain two submenus a deal may not sell and every deal would fail its next save. Billing reads stored deals through `dealSnapshot` → `buildDealSnapshot`, so the save rule is also the hand-off rule.
- RB-34: `roleGrantViolation` takes the platform-company fact from the use cases (default refuses). Only the two sales roles are filtered from a shop's role list; `SYSTEM_ADMIN` stays listed as before.
- F02: `@RequireAnyPermission('expense.delete', 'expense.update')`. `expense.delete` is gated by `expenses` only, not `expenses.manual`; the runoff-matrix row records that.
- RB-38: the filter is in `PrismaAuditRepository.getCompanyLogs`, whose only caller is the shop-facing endpoint. "Platform staff" is a member of the platform company with no membership in the shop, not "no membership row": an account merge moves the membership and would otherwise hide the shop's own history. System-written `billing.*` rows are treated as platform bookkeeping.

Open questions:
- RB-38: should a shop see system-written billing rows about its own subscription (a renewal applied, grace started)? They are hidden now.
- B3: shops that already paid a bare-parent deal keep the wrong entitlement rows; that is a data repair, not done here.
- RB-34: `MANGMEE_EXECUTIVE`, when it is added, must join `PLATFORM_ONLY_ROLE_KEYS`.

Artifacts: commits `56151efc9` (RB-40), `e1017e68d` (RB-36), `4ed43b6f9` (B3), `0c4df95b0` (RB-34), `a4d8e288d` (F02), `6d94fcd9e` (RB-38). Docs touched: sales-deals spec §20.4.1, RBAC spec §19.6 audit endpoint, runoff matrix DELETE row, hard-delete plan note.

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

Next: coordinator review, then push/PR and the release path the owner chooses. If the hotfix path is used, every changed `src` spec is a `--regression-test`.
