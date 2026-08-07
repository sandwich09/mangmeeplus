# Agent Memory: Dashboard and Notification 06

Status: Completed
Owner: Codex
Scope: Item 06 Dashboard and Notification implementation review, fixes, verification, and checklist closure.
Role gate status:
- BA: Goal is owner/operator visibility for company health plus actionable notification delivery. Target users are owner, manager, accountant, and staff. Journey covers dashboard snapshot, inventory health widgets, notification center, preferences, rules, and LINE push when a linked identity exists. Rules/exceptions: no LINE AI chat in item 06, quiet hours and disabled channels suppress delivery, missing LINE binding/token skips safely, cross-company notification state is blocked. Acceptance criteria are the spec/plan phases for dashboard APIs, inventory-backed alerts, web notification UX, notification preferences/rules, worker scheduling/delivery, and focused verification.
- SA: Architecture fits existing Nest hexagonal modules, Prisma repositories, Next workspace routes, worker entrypoint, shared config, and contracts. Contracts include company dashboard, notification list/state, preferences/rules, internal worker delivery, and daily owner summary endpoints. Data model impact adds dashboard snapshot/widget tables plus notification event/recipient/delivery/preference/rule tables and item 05 inventory tables required by widgets. Permissions use registered dashboard/notification actions and company ownership checks. State transitions cover event pending/queued/sent/skipped/failed, recipient read/dismiss, delivery retry metadata, and dashboard snapshot generation. Scope excludes LINE AI chat and broader workflow automation.
- DEV: Ponytail full mode read. Smallest correct diff kept to completing the existing item 06 surface: migration coverage, API use cases/controllers, worker startup/jobs, delivery policy, LINE push adapter, web API normalization, preferences/settings routes, config/compose env, and focused tests. Touched areas: Prisma migration/schema/seed, dashboard-notification API module, worker notification module, web dashboard-notification feature/routes, shared config/contracts, local compose/env.
- Integration: Backend-to-frontend contract verified by typecheck, unit tests, web build, config validation, migration review, and browser smoke. UI journey checked for dashboard, notification center, preferences, rules, and settings aliases on desktop and mobile. Loading/error states render with API unavailable; permission/company routing is wired through workspace routes and API company checks. API-backed browser E2E was not run because local API/database stack was not started; unit/build/contract/browser route smoke passed.
Decisions:
- Keep dashboard and notification primitives reusable for later report/BI and workflow items.
- Use API-owned internal endpoints for worker actions so delivery policy, audit, and LINE identity lookup stay server-side.
- LINE push is delivery-only in item 06; conversational LINE AI remains item 07.
- Preserve missing LINE token/binding as skipped delivery rather than hard failure.
Open questions:
- None for item 06 closure.
Artifacts:
- `apps/api/prisma/migrations/20260624000003_item05_inventory_item06_dashboard_notifications/migration.sql`
- `apps/api/src/modules/dashboard-notifications/`
- `apps/workers/src/modules/notifications/`
- `apps/web/src/features/dashboard-notifications/`
- `apps/web/app/(workspace)/companies/[companyId]/notifications/`
- `apps/web/app/(workspace)/companies/[companyId]/settings/notifications/`
- `apps/web/app/(workspace)/companies/[companyId]/settings/notification-rules/`
Verification:
- `pnpm --filter @watchdog-bms/api prisma:validate` passed.
- `pnpm --filter @watchdog-bms/api typecheck` passed.
- `pnpm --filter @watchdog-bms/web typecheck` passed.
- `pnpm --filter @watchdog-bms/workers typecheck` passed.
- `pnpm --filter @watchdog-bms/contracts typecheck` passed.
- `pnpm --filter @watchdog-bms/config test` passed.
- `pnpm --filter @watchdog-bms/api test` passed.
- `pnpm --filter @watchdog-bms/web test` passed.
- `pnpm --filter @watchdog-bms/workers test` passed.
- `pnpm --filter @watchdog-bms/api migration:review` passed.
- `pnpm --filter @watchdog-bms/web build` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm config:validate` passed.
- `pnpm build` passed.
- `docker compose -f infra/docker/compose.local.yml --env-file .env.example config` passed.
- Local Docker Postgres migration/seed smoke was attempted but not completed because host port 5432 was already occupied by an existing local Postgres process; the temporary Redis container started during the attempt was stopped.
- Browser smoke passed for dashboard, notifications, notification preferences, notification rules, settings notifications, and settings notification rules on desktop; dashboard/notifications/preferences/rules also passed on mobile.
Next:
- Item 06 is ready for handoff. Continue with item 07 LINE AI read-only assistant when scheduled.
