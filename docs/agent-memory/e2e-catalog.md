# Agent Memory: e2e-catalog

Status: P0/P1 green; final report written
Owner: Codex
Scope: Implement WatchDog-BMS Playwright catalog P0/P1 specs on localhost and report results.
Decisions:
- Used repo-local ponytail instructions because `/Users/spare058/WatchDog-BMS/.agents/skills/ponytail/SKILL.md` is absent.
- Fixed `e2e/run-local.sh` preflight to strip Prisma `?schema=public` only for `psql`.
- Installed Playwright Chromium for local execution.
- Updated smoke reference selectors to current Thai UI and made the API fixture resolve relative paths under `/v1/`.
- Added catalog specs for P0/P1 ready suites and selected P2 checks needed for current breadth.
- Marked EXP-06 as `test.fixme` because local MinIO/object storage is down.
- Filed BUG-1 for ACCT-05: zero-line accounting documents can be issued through the API.
Open questions:
- Remaining P2 catalog cases were deferred because the requested stop condition was P0 and P1 green with `RESULTS.md` written.
Artifacts:
- `e2e/run-local.sh`
- `e2e/_reference.spec.ts`
- `e2e/harness/fixtures.ts`
- `e2e/harness/e2e-utils.ts`
- `e2e/login.spec.ts`
- `e2e/dashboard.spec.ts`
- `e2e/inventory.spec.ts`
- `e2e/expenses.spec.ts`
- `e2e/accounting.spec.ts`
- `e2e/reports.spec.ts`
- `e2e/journal.spec.ts`
- `e2e/banking.spec.ts`
- `e2e/accounts-payable.spec.ts`
- `e2e/reimbursements.spec.ts`
- `e2e/procurement.spec.ts`
- `e2e/workflow.spec.ts`
- `e2e/ai-suggestions.spec.ts`
- `e2e/notifications.spec.ts`
- `e2e/crm.spec.ts`
- `e2e/bookings.spec.ts`
- `e2e/settings.spec.ts`
- `e2e/system-admin.spec.ts`
- `e2e/cross-cutting.spec.ts`
- `e2e/RESULTS.md`
Verification:
- `e2e/run-local.sh --grep @smoke` -> 3 passed.
- Targeted suite runs completed while implementing: login, dashboard, inventory, expenses, accounting P0/P1, reports, accounts payable, procurement, settings, and affected reruns.
- `e2e/run-local.sh e2e/expenses.spec.ts` -> 6 passed, 1 skipped/fixme.
- `e2e/run-local.sh` -> 89 passed, 1 failed, 3 skipped. P0 28/28 and P1 58/58 green. Failure is P2 ACCT-05 product bug with trace at `test-results/accounting-ACCT-—-accounti-c0931--rejected-by-API-validation-chromium/trace.zip`.
Next:
- Fix BUG-1 or mark the expected product behavior if zero-line issue is intended, then rerun `e2e/run-local.sh`.
- Bring MinIO up before enabling EXP-06.
