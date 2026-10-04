# Agent Memory: notifications-only-owned-modules-2026-10-04

Status: Ready for controller review; implementation, focused specs, final API typecheck and diff check passed. Full trigger classification remains pending the future marketing ownership decision.
Owner: Codex implementation lane; controller reviews, commits and runs full verification.
Scope: API notification trigger ownership, event creation, retained-event visibility/counts and queued delivery; dashboard notification spec. No web, schema, dependencies, rules or template changes.
Decisions:
- Gate the shared CreateOrUpdateNotificationEventUseCase before dedup/recipient repair; every production module event writer traced uses it. Billing has a separate delivery service for platform package notices, which stay available.
- One ownership map beside the implemented/future lists also covers workflow, signup and CRM erasure keys emitted outside those lists. Empty array means platform-wide; null explicitly blocks the future marketing trigger pending ownership. Unknown/unregistered keys are blocked until classified, including arbitrary custom workflow trigger names.
- Reuse loadEntitledFeatureKeys, including legacy inheritance, explicit submenu OFF and no-row everything-on semantics for classified triggers.
- Filter event and recipient reads before pagination and unread database grouping. Retain rows, read/dismiss history, rules and templates; purchasing a feature makes retained events visible again.
- Suppress unentitled queued WEB/LINE notices with CAS without provider egress, including always-delivered reimbursement notices. Both LINE transaction paths take sharedEntitlementLock before current-event reads and hold it through the provider call; billing/partner downgrade writers already take its exclusive side.
- Skip stock-low inventory reads when unentitled. CRM's global candidate scan also marks SLA state and writes its outbox, so it is unchanged; central notification gating prevents events. Avoid a second SQL entitlement evaluator for that cross-company scan.
- No shop-visible sentences or labels changed. FEATURE_NOT_ENABLED is an internal delivery error code, with no new errorMessage. Provider calls in tests use a fetch stub, never the network.
Open questions:
- Which sold feature owns campaign_opportunity? It is future/disabled and documented as marketing, but no marketing feature exists in the catalog. Asked the owner; leave its map entry null (blocked), never platform-wide. Full feature classification is pending that one answer.
Artifacts:
- apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts — ownership map and pure predicate.
- apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts — creation gate, queued suppression and final LINE lock/recheck.
- apps/api/src/modules/dashboard-notifications/application/use-cases/stock-low-scan.use-case.ts — early inventory gate.
- apps/api/src/modules/dashboard-notifications/infrastructure/prisma-notification.repository.ts — event/recipient list and grouped unread filters.
- apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts — 20 new regressions in an existing API test-script-listed file.
- apps/api/src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts — legacy entitlement/lock doubles and type narrowing only; existing behavior assertions retained.
- docs/specs/dashboard-notification-spec.md — owner rule, retained-event/delivery semantics and acceptance tests.
Verification:
- Base focused command: pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec
- First correctness run before production edits: exit 1, 14 pass / 10 fail of 24. Some creation failures were an incomplete alertState fixture; corrected the fixture before using red results as regression evidence.
- Corrected red correctness run: exit 1, 14 pass / 13 fail of 27 (classification; CRM/stock STARTER creation; downgrade dedup; explicit CRM inbox OFF; retained list/counts; CRM/stock/mandatory reimbursement WEB and LINE; early stock reads).
- Added transaction downgrade cases and ran correctness again before production edits: exit 1, 14 pass / 15 fail of 29. Each new test failed for its intended behavior: 1 event vs 0; old dedup update; visible old module event; sent vs suppressed; provider pushes 1 vs 0; inventory read 1 vs 0; missing mapping.
- First green correctness run: exit 0, 29 pass / 0 fail.
- Existing process-due-deliveries.use-case.spec.ts: exit 0, 35 pass / 0 fail after adding legacy entitlement doubles.
- Focused sibling command with src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts src/modules/dashboard-notifications/application/use-cases/notification-preference.use-case.spec.ts src/modules/dashboard-notifications/presentation/http/internal.controller.spec.ts src/modules/crm-inbox/application/use-cases/scan-crm-sla-breaches.use-case.spec.ts src/modules/workflow/application/use-cases/workflow-action-runner.use-case.spec.ts: exit 0, 130 pass / 0 fail.
- Shared-lock red command: base plus --test-name-pattern='holds the shared' src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts. Exit 1, 0 pass / 2 fail before adding the lock. Both CRM and stock transaction entitlement reads ran without the shared company fence.
- Recipient-read red command: base plus --test-name-pattern='filters the recipient read path' src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts. Manually restored the old production where clause for this run, then restored the fix. Exit 1, 0 pass / 1 fail (missing event.triggerKey filter).
- Green correctness + process-due-deliveries after those additions: exit 0, 67 pass / 0 fail.
- Unread-count red command: base plus --test-name-pattern='counts only entitled retained' src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts. Manually restored the old groupBy where clause for one run, then restored the fix. Exit 1, 0 pass / 1 fail: total 3 vs 1, critical/action 1 vs 0.
- Green command before the final unknown-trigger case: base plus src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts. Exit 0, 68 pass / 0 fail (33 correctness + 35 existing delivery tests, no skips).
- Unknown/unresolved trigger red command: base plus --test-name-pattern='blocks unregistered' src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts. Manually restored the original creation guard absence for one run, then restored the fix. Exit 1, 0 pass / 1 fail (skipped false vs true).
- Final green command: base plus src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts src/modules/dashboard-notifications/application/use-cases/process-due-deliveries.use-case.spec.ts. Exit 0, 69 pass / 0 fail (34 correctness + 35 existing delivery tests; no skips). Every new behavior test has a recorded red run. Existing delivery assertions were only adapted for their legacy database doubles and optional event type; those controls stay green.
- API typecheck through /private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/api typecheck: first run exit 0; re-run after final LINE lock edits exit 0. Last run after the final regression test exit 0 (all three typecheck runs succeeded; no test counts for typechecking).
- git diff --check: exit 0, including the final note.
- No package.json, paid-invoice.ts, billing-schedule.ts, schema, migration, web, AI gateway or contracts source changes. No full suite, real database, browser, server, cloud or network checks run; these are unavailable/prohibited in this lane. The web bell/notification page uses the gated list and unread APIs (contract traced in dashboard-notifications.api.ts); actual browser behavior is not checked.
Next:
- Controller: review/commit this uncommitted diff, run full API verification.
- Real PostgreSQL: REIMBURSEMENT_PG_GATE_REQUIRED=true pnpm --filter @watchdog-bms/api test:reimbursement-compatibility with its migrated test DATABASE_URL, as wired in .github/workflows/ci.yml. Covers src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts and src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts, both using the real event writer. Not checked here because no database is available. No new PG spec file was created.
- Controller browser: STARTER owner's bell/notification list has no CRM/stock events or badge counts (including old rows); package/security notices still show. Full-preset shop keeps CRM/stock notices and working source links. Downgrade hides retained module notices/counts and drops queued pushes; re-enable restores list visibility without changing rules/templates. Actual LINE/network egress and database lock contention need controller verification.
- Resolve future marketing ownership before enabling campaign_opportunity.
