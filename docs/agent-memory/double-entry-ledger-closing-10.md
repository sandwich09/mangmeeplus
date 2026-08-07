# Agent Memory: double-entry-ledger-closing-10

Status: Implemented MVP integration on 2026-06-25.
Owner: Codex
Scope: Complete checklist item 10 from partial code: ledger compile/runtime wiring, source posting status integration, close checks, web reports workspace, read-only AI ledger summary, migration/seed, docs.

Role gate status:
- BA: Finance, Accountant, Owner, and Auditor need ledger-backed financial reports and period close from finalized accounting/expense sources. Journey is finalized source -> generated balanced journal -> reports -> close checks -> close/unclose; LINE/AI can read summaries only. Rules/exceptions: posted journals are immutable; closed periods block posting; source posting errors/pending items block close; export route remains typed not implemented. Acceptance covered: generated postings, GL/TB/P&L/BS APIs, close policy, web review, read-only AI summary.
- SA: Ledger remains its own module and reuses Prisma, auth request context, audit, outbox, data-model-core document sequence, accounting documents, expenses, and contracts. Contracts stay string-money based. Data model impact is item 10 migration for chart, periods, journals, lines, rules, close runs. Permissions use existing ledger keys. Source adapters update posting status through accounting/expense repositories, not direct ledger table ownership. Scope excludes XLSX/CSV/PDF generation and full 175-row chart import.
- DEV: Ponytail full read. Smallest correct diff: fixed Prisma wrapper use, report compile bugs, generated posting source normalization, source status writers, close blocker checks, migration/seed, web reports page, read-only AI tool. Touched files include ledger API use cases/repository/module/controller dependencies, accounting/expense repositories, LINE AI tools/classifiers, web ledger page/API, Prisma migration/seed, and docs.
- Integration: Backend-to-frontend contract verified by web typecheck against ledger report/period endpoints. UI journey is `/companies/:companyId/reports` with period selector, TB, GL, P&L/BS summary, close checks, close action, loading/error/empty states. Permission states rely on server-side guards and nav visibility via `ledger.report.read`/`ledger.period.read`. AI/LINE path is read-only `ledger.get_financial_summary`; mutation keywords still block post/close/export.

Decisions:
- Seed only the minimum company chart accounts required by built-in posting defaults instead of recreating the full 175-row CSV import in code.
- Keep actual report file generation typed as `export_not_implemented`.
- Use English labels for seeded accounts to avoid corrupting existing mixed-encoding Thai text.
- Treat item 08 `accounting_document` and item 09 `expense.record` payloads as source-owned contracts and normalize them in the ledger generator boundary.

Open questions:
- None blocking item 10 MVP. Backlog: full chart import, posting-rule management UI, richer journal detail/manual journal UI, XLSX/CSV/PDF exports, and Thai copy cleanup.

Artifacts:
- `apps/api/prisma/migrations/20260625000001_item10_double_entry_ledger/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/ledger/**`
- `apps/api/src/modules/accounting-documents/infrastructure/prisma-accounting.repository.ts`
- `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`
- `apps/api/src/modules/line-ai/**`
- `apps/ai-gateway/src/modules/line-ai/**`
- `apps/web/src/features/ledger/**`
- `apps/web/app/(workspace)/companies/[companyId]/reports/page.tsx`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/double-entry-ledger-closing-plan.md`

Verification:
- PASS `corepack pnpm --filter @watchdog-bms/contracts typecheck`
- PASS `corepack pnpm --filter @watchdog-bms/api exec prisma generate`
- PASS `corepack pnpm --filter @watchdog-bms/api typecheck`
- PASS `corepack pnpm --filter @watchdog-bms/api test`
- PASS `corepack pnpm --filter @watchdog-bms/web typecheck`
- PASS `corepack pnpm --filter @watchdog-bms/ai-gateway typecheck`
- PASS `corepack pnpm --filter @watchdog-bms/api prisma:validate`
- NOT RUN full `pnpm test` or `pnpm security:audit`; focused package checks passed.

Next:
- Continue with checklist item 11 Thai Tax MVP.
