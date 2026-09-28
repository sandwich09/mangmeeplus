# Agent Memory: admin-member-display-name-interim

Status: Implemented and focused checks passed (2026-09-28); ready for requested admin merges, no deployment
Owner: thawatchai + Codex
Scope: Add the missing Owner name field in Admin Console.

Decisions:
- User wants a small interim fix for Owner, and rejected the oversized spec. The short spec/plan supersede the earlier broad proposal.
- One name field + save/cancel on the Owner member row; use userId without EmployeeAccessProfile or credentials.
- Update global User.displayName; keep company/profile names and all access/login data unchanged. Reuse member-manage permission and atomic audit.
- Compare the existing displayName on write to prevent ordinary stale overwrites. No new revision field, reason form, schema, dependency, or notification.
- Employee-name writers, prefix handling and general account UX are separate work, not companion changes in this scope.

Open questions: None for the scoped spec.

Artifacts:
- [Spec](../specs/admin-member-display-name-interim-spec-th.md)
- [Plan](../plans/admin-member-display-name-interim-plan.md)

Known limitations from the earlier audit (not fixed):
- Open tabs retain the old name until reload; account names are shared across companies.
- The existing shell formatter strips Thai prefixes (นายก → ก) and hardcodes นภา → คุณนภา วงศ์ทอง. These particular names may display differently from the stored value.
- If an account has a single-company EmployeeAccessProfile, a later employee edit can overwrite a distinct account name. The usual onboarding Owner has no profile; do not claim this risk is impossible for every Owner.
- Sales console already has its own sales-agent name edit; this task addresses customer Owners.

Verification:
- API: 52 tests passed — `corepack pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/system-partner-management/application/use-cases/partner-member-console.use-cases.spec.ts src/modules/system-partner-management/presentation/http/partner.controller.spec.ts src/common/pipes/body-validation-coverage.spec.ts`.
- Web QA: 10 tests passed — `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/system-partners/PartnerSupportTools.qa.spec.ts`.
- Chromium: 1 passed — `API_PORT=3211 WEB_PORT=3210 E2E_API_BASE_URL=http://127.0.0.1:3211/v1 E2E_WEB_BASE_URL=http://127.0.0.1:3210 corepack pnpm exec playwright test e2e/system-settings-ux.spec.ts --project=chromium --grep 'console renames' --workers=1`. Actual web with local fixture API: save, cancel, reload, mobile width and conflict preserving draft; not a live database/account test.
- `corepack pnpm --filter @watchdog-bms/api typecheck`, `corepack pnpm --filter @watchdog-bms/web typecheck` and `git diff --check` passed.
- API tests check validation, permission guard, target filters, stale writes and transaction error handling using mocks; no real PostgreSQL transaction test.
- Scoped diff has no schema, dependency or package.json changes. Unrelated original checkout changes preserved in an isolated worktree.

Next: User authorized admin merge into main and develop without waiting for CI. No deployment or live account mutation requested.
