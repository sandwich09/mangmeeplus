# Agent Memory: items-01-10-business-integration-review

Status: Complete after live API-backed E2E integration fix on 2026-06-25.
Owner: Codex
Scope: Recheck Master Implementation Checklist items 01-10 as one integrated flow across docs, API, web, contracts, auth, Prisma seed, and Playwright smoke.
Role gate status:
- BA: Complete - items 01-10 map to BUC-01 through BUC-10. Business goal is web-first SME Business OS with LINE/AI read-only assistant channel. Target users are Owner/Admin/Manager/Sales/Inventory/Finance/Accountant/Staff/Auditor readonly. Journey now verified at smoke level: dev auth -> dashboard -> inventory products -> accounting -> expenses -> ledger reports. Rules/exceptions remain: web owns final business mutations, LINE/AI stay read-only/draft-only for these items, permission checks and audit boundaries stay mandatory. Acceptance criteria are covered by item memories plus live smoke for core web/API paths.
- SA: Complete - architecture fit remains item 01-04 foundation plus item 05-10 modules. Contracts build before API/web E2E servers, web resolves `@watchdog-bms/contracts` through package dist, Prisma migrations/seed create the local dev company/user/product/chart/rules, and guarded API routes now expose permission metadata for accounting documents/payments/counterparties, expenses/categories, and ledger. Data model impact: none new beyond existing migrations. Permissions/ABAC: deny-by-default guard is preserved; use cases still enforce finer permissions after route metadata. State transitions remain source-owned. Scope boundary: this smoke does not upload files/S3, does not run real LINE Messaging delivery, and does not test full document/expense mutation lifecycle.
- DEV: Complete - Ponytail read. Smallest correct diff fixed actual integration blockers found by E2E: Playwright web server used API `PORT`, web package missed contracts dependency and source alias resolved stale `src/*.js`, API item 08-10 controllers lacked `@RequirePermissions`, and E2E Trial Balance selector was ambiguous. Touched files are listed in Artifacts. Focused API typecheck/test plus root checks pass.
- Integration: Complete for item 01-10 smoke - live API-backed Playwright now opens dashboard, inventory, accounting, expenses, and ledger reports with dev auth and no client Unauthorized/Forbidden/Request failed text. Backend-to-frontend contract, UI journey, loading/error surfacing, permission guard metadata, and production build were verified. E2E used isolated Postgres on `localhost:15432` plus existing Redis on `localhost:6379`; MinIO port 9000 was occupied, but current smoke does not cover upload/S3.
Decisions:
- Keep `DenyByDefaultGuard` fail-closed behavior; fix missing route metadata instead of weakening guard.
- Use package-dist resolution for web `@watchdog-bms/contracts`; remove web's source alias that let Next resolve stale generated `packages/contracts/src/*.js`.
- Build `@watchdog-bms/config` and `@watchdog-bms/contracts` before the Playwright web dev server so parallel API/web startup cannot race shared packages.
- Keep E2E smoke scoped to core read/render integration for items 05/06/08/09/10; deeper mutation/upload/LINE delivery flows remain covered by package tests and future focused E2E expansion.
Open questions:
- None blocking item 01-10 integration smoke. Later: add focused E2E for receipt upload/S3, accounting issue/payment, expense confirm/payment, ledger posting/close, and LINE webhook end-to-end with signed payload fixtures.
Artifacts:
- `playwright.config.ts`
- `e2e/business-smoke.spec.ts`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/api/src/modules/accounting-documents/presentation/http/accounting-document.controller.ts`
- `apps/api/src/modules/accounting-documents/presentation/http/accounting-payment.controller.ts`
- `apps/api/src/modules/accounting-documents/presentation/http/counterparty.controller.ts`
- `apps/api/src/modules/expenses/presentation/http/expense.controller.ts`
- `apps/api/src/modules/ledger/presentation/http/ledger.controller.ts`
- `pnpm-lock.yaml`
- `docs/agent-memory/items-01-10-business-integration-review.md`
Verification:
- `corepack pnpm install`: pass; synced missing Playwright package and web workspace dependency.
- `DATABASE_URL=postgresql://watchdog:watchdog_local_password@localhost:15432/watchdog_bms?schema=public corepack pnpm --filter @watchdog-bms/api exec prisma migrate deploy`: pass; 6 migrations applied to isolated e2e DB.
- `DATABASE_URL=postgresql://watchdog:watchdog_local_password@localhost:15432/watchdog_bms?schema=public corepack pnpm --filter @watchdog-bms/api exec prisma generate`: pass.
- `DATABASE_URL=postgresql://watchdog:watchdog_local_password@localhost:15432/watchdog_bms?schema=public corepack pnpm --filter @watchdog-bms/api exec prisma db seed`: pass after Prisma generate; seed created local company, owner, branch, inventory seed, document sequences, expense categories, ledger chart, and notification rules.
- `API_PORT=3301 WEB_PORT=3300 DATABASE_URL=postgresql://watchdog:watchdog_local_password@localhost:15432/watchdog_bms?schema=public REDIS_URL=redis://localhost:6379 corepack pnpm e2e`: pass, 1/1 Playwright chromium smoke.
- `corepack pnpm --filter @watchdog-bms/api typecheck`: pass.
- `corepack pnpm --filter @watchdog-bms/api test`: pass, 281/281.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: pass.
- `corepack pnpm typecheck`: pass, 7 workspace projects.
- `corepack pnpm test`: pass; config 35/35, web 91/91, API 281/281, AI Gateway 42/42, workers 5/5, contracts/design-tokens 0-test packages pass.
- `corepack pnpm build`: pass; API, AI Gateway, workers, packages, and Next production build pass.
- `corepack pnpm security:audit`: pass at high threshold; pnpm still reports 1 moderate vulnerability.
- `corepack pnpm agent:gates -- docs/agent-memory/platform-foundation-01.md docs/agent-memory/auth-rbac-audit-02.md docs/agent-memory/web-core-workspace-03.md docs/agent-memory/data-model-core-04.md docs/agent-memory/inventory-mvp-05.md docs/agent-memory/dashboard-notification-06.md docs/agent-memory/line-ai-read-only-assistant-07.md docs/agent-memory/accounting-documents-mvp-08.md docs/agent-memory/expense-receipt-upload-09.md docs/agent-memory/double-entry-ledger-closing-10.md docs/agent-memory/items-01-10-business-integration-review.md`: pass.
Next:
- Continue with item 11 Thai Tax MVP after owner approval/scheduling.
- Add focused E2E for upload/mutation/LINE paths before beta acceptance if those flows become release-critical.
