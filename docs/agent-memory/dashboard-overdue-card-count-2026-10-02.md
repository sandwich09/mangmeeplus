# Agent Memory: dashboard overdue card count (2026-10-02)

Status: done in this worktree; focused checks and locked API typecheck passed. Uncommitted, ready for controller review; database/browser verification belongs to the controller.
Owner: implementation lane 1.
Scope: make the daily-brief `sla_breaches` card count the overdue inbox list for the same viewer and instant. No scan, schema, dependency, package.json, or wording change.
Decisions:
- Reuse `conversationCounts(...).overdueCount`, which already uses the repository's canonical `overdueWhere(now)`; remove the unused `countOpenSlaBreaches` method.
- The linked inbox list and chip scope by company and `assignedScopeForList(ctx)` only. They do not apply customer ownership or branch filters. This card follows that existing inbox visibility; other brief aggregates retain their customer scope.
- Keep the card key, Thai label, link, and severity behavior. Pass the brief's `now` into the count.
- Consumer search: the old method has only the daily-brief production caller. LINE `crm.get_inbox_summary` uses the permission-checked list use case and its `overdueCount`; CRM reports already reuse `overdueWhere`. No direct brief-count consumer was found in AI Gateway or workers.
- Web renders the API value and href; it overrides the label through existing `card.sla_breaches` localization (Thai matches API). No independent live dashboard count found.
- `CreateDailyOwnerSummaryUseCase` delivers a dashboard snapshot link/widget count, not the brief's overdue figure. Snapshot providers are inventory and expenses; no other dashboard widget consumes the retired figure.
- Reusing the existing chip aggregate adds its status grouping and mine/unassigned counts to the brief (three extra queries); no new count abstraction. Performance is not checked.
Open questions: none for this scoped fix. Existing ownership/branch differences for other widgets are outside scope.
Artifacts: `docs/specs/crm-line-oa-customer-os-spec.md`; daily-brief and inbox repository source/specs; prior wording memory.
Verification:
- API focused command prefix: `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec`.
- `src/modules/crm-inbox/application/use-cases/crm-daily-brief.use-case.spec.ts`: initial harness run rc 1, 3 passed/7 failed (six failures were missing unrelated payment-proof stubs; corrected before the meaningful red run). Meaningful old-source red rc 1, 3 passed/7 failed: unscanned overdue 0 vs 1; scanned/answered 1 vs 0; SALES scope 1 vs 2; OWNER, MANAGER, COMPANY_VIEW scopes each 1 vs 3; updated scope-spy expectation showed the old customer-scoped call. New-source green rc 0, 10 passed/0 failed; final rerun after test title/timestamp cleanup also rc 0, 10 passed/0 failed. Uses the real repository where builders over an in-memory Prisma fake; no database claim. Three pre-existing tests only had retired-method fixtures replaced; their assertions did not change.
- `src/modules/crm-inbox/infrastructure/prisma-crm-inbox.repository.spec.ts`: rc 0, 46 passed/0 failed. Removed the retired method's call/assertion from the existing customer-scope test; its remaining assertions are unchanged behavior, so this cleanup has no behavioral red claim.
- `src/modules/crm-inbox/application/use-cases/crm-conversation.use-case.spec.ts`: rc 0, 46 passed/0 failed.
- `src/modules/crm-inbox/domain/logic/crm-daily-brief.logic.spec.ts`: rc 0, 5 passed/0 failed.
- `src/modules/crm-inbox/application/use-cases/scan-crm-sla-breaches.use-case.spec.ts`: rc 0, 8 passed/0 failed; expected warning from the notification-failure test.
- `src/modules/line-ai/application/use-cases/erp-crm-operational-tools.use-case.spec.ts`: rc 0, 9 passed/0 failed.
- `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/common/i18n/workspace-i18n.spec.ts`: rc 0, 11 passed/0 failed.
- `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/api typecheck`: rc 0, no compiler errors. The wrapper waited for the lock before starting the compiler.
- Registered-spec check (`node` reading `apps/api/package.json`): rc 0; both edited API spec files are listed in the existing test script.
- `git diff --check`: rc 0. Focused final totals: 124 API tests and 11 web tests passed; 0 failed/skipped. No whole-package suite run.
- No CRM/CRM-inbox real-PostgreSQL spec exists in this checkout (`rg --files apps/api` and searches inside existing `*.pg.spec.ts`); none created because API spec registration must stay unchanged.
- Browser and database verification: not checked; lane rules prohibit servers, browser, network, and database workarounds. Controller should run `e2e/daily-brief.spec.ts`, `e2e/crm.spec.ts`, `e2e/crm-reports.spec.ts` on its stack, including same-viewer card/list equality before scan and after reply.
Next: controller review/commit and full verification. Browser command on the controller's stack: `pnpm exec playwright test e2e/daily-brief.spec.ts e2e/crm.spec.ts e2e/crm-reports.spec.ts`. Verify card/list equality for unscanned overdue and scanned/answered rows at the same instant, for read-all and assignment-limited viewers.
