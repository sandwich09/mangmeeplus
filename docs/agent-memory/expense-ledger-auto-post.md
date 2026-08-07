# Agent Memory: Expense Ledger Auto-post

Status: COMPLETE
Owner: Codex
Scope: Expense confirmation truthfulness, accountant evidence/export, manual post/retry, per-company guarded
Auto-post, historical backfill, worker, web, contracts, API, tests, and docs.

Decisions:
- Accounting offices include both WatchDog users and external package recipients.
- Export warnings require confirmation but do not block.
- `double_entry_ledger` enabled alone means manual posting.
- Add `expense_auto_post` entitlement for guarded Auto-post; it requires ledger.
- Auto-post applies only to expenses confirmed at/after the entitlement `updatedAt`.
- Auto-post in this scope creates only the confirmation/accrual `expense.record` JV. A later
  `expense.payment` settlement remains a manual posting concern.
- Manual post/retry resolves the next outstanding source from generated journals, not only the shared
  `ExpenseRecord.postingStatus`.
- Warning and accounting-blocker rows stay in accountant handling; retry never bypasses canonical rules.
- Historical pending rows require preview and explicit backfill confirmation.
- Reuse pending source scan rather than `OutboxEvent.status`, which is not a multi-subscriber queue.
- No new dependency or configuration table.

Open questions:
- None for approved scope.

Artifacts:
- `docs/specs/expense-ledger-auto-post-spec.md`
- `docs/plans/expense-ledger-auto-post-plan.md`
- Expense contracts/export fields for posting status, error, JV number, and truncation.
- Truthful expense detail and accounting-evidence UI with manual post/retry.
- Source-filterable compact JV list.
- Per-company `expense_auto_post` entitlement with ledger dependency and stable activation boundary.
- Clean-evidence post-activation drain, worker-token endpoint, and repeatable worker.
- Ledger-truth projection for the next outstanding expense accrual/payment source.
- Permission- and branch-scoped historical backfill preview with blocker counts and bounded samples.
- Explicitly confirmed bounded backfill with retryable failures and summary-only audit.

Verification:
- Contracts build passed.
- Focused API/ledger tests passed: 44/44.
- Focused web expense tests passed: 20/20.
- API and web TypeScript checks passed.
- Web production build passed with webpack; the first Turbopack attempt was inapplicable because test-only
  dependency symlinks point outside the isolated worktree.
- `git diff --check` passed.
- Phase 2 focused API regression passed: 65/65; posting-source projection and drain rerun passed: 10/10.
- Phase 2 focused web expense tests passed: 20/20.
- Contracts, API, web, and workers TypeScript checks passed.
- Worker option test and worker-token controller tests passed.
- Phase 3 combined API regression passed: 75/75.
- Phase 3 API and web TypeScript checks passed; contracts build passed.
- Final Prisma schema validation passed.
- Final web production build was stopped after hanging in optimization twice (including with network access);
  no compile error was reported. The last completed production build passed before the Phase 3 UI change, and
  the final Phase 3 UI passed TypeScript validation.
- Live authenticated browser verification was not rerun in the isolated worktree; the existing user-verified
  confirmation/evidence/export journey and focused automated coverage remain the integration evidence.

Next:
- Roll out `expense_auto_post` per company only after reviewing the historical preview.
- Deployment and live-environment smoke testing remain outside this implementation branch.
