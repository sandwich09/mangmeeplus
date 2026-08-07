# Agent Memory: Item 11 — Thai Tax MVP

Status: Complete — item 11 and output Tax Code/receipt boundary follow-up 11A implemented and locally verified as of 2026-07-13
Owner: Codex
Scope: Phase 0–8 Thai Tax MVP per `docs/plans/thai-tax-mvp-plan.md`
Branch: develop

## Decisions

- WHT events sourced from `ExpenseRecord.whtAmount` (not `AccountingPayment` — that model has no WHT fields)
- Concrete repo pattern over interface implements: dropped `implements TaxPeriodRepositoryPort` etc. to avoid method name conflicts; repo methods renamed distinctly: `upsertPeriod`, `upsertEvent`, `findPeriod`, `findPeriods`, `findEventsByPeriod`, `findIssuesByPeriod`, `createIssue`, `resolveIssue`, `updatePeriodStatus`, `supersedeEvent`
- `AccountingPaymentSourceAdapter` is a no-op stub — WHT from payments is impossible in current schema; file retained at `infrastructure/adapters/accounting-payment-source.adapter.ts` to avoid breaking imports
- Domain logic in `tax-period.logic.ts` exports `makeReviewIssue` accepting `ReviewIssueCode` — `MISSING_TAX_ID` and `INPUT_VAT_NOT_CLAIMABLE` are the two codes wired in sync
- Prisma client generated with dummy DATABASE_URL (`DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" pnpm prisma generate`)
- Migration SQL hand-written at `apps/api/prisma/migrations/20260630000000_item11_thai_tax_mvp/migration.sql` (no live DB for `prisma migrate dev`)
- Review/export completion on 2026-06-30 uses existing document sequence keys `tax.filing_export` and `tax.wht_certificate`; no new XLSX/PDF dependency was added.
- Export artifacts are generated inline by API response with checksum and audit metadata. Durable attachment-backed export storage is a follow-up improvement, not required for first-pass local verification.
- LINE/AI tax summaries were changed to decimal-string math instead of `parseFloat`.
- Owner decision 2026-07-13: item-11A `O7`/`OX`/`O0` are initial SAP ERP-style output-tax compatibility values, not Revenue Department code names or permanent global meanings. A plain receipt has no Tax Code, is payment evidence only, and must never create VAT again. A receipt/tax invoice may carry a code only when tax-invoice requirements are satisfied; credit/debit notes adjust the referenced tax event.
- Supplied item-11A mapping: invoice/tax invoice, credit note, debit note, and receipt/tax invoice allow `O7`/`OX`/`O0`; invoice-only follows reviewed company policy (baseline `O0`); receipt-only has no Tax Code. Item 11B expands code meaning through company/profile/line configuration. The repeated credit-note row is an intentional duplicate with no separate semantics.
- Implementation boundary: `RECEIPT` is always payment-only/no-code; a combined receipt/tax invoice is represented by `TAX_INVOICE` linked to an issued `RECEIPT` (or issued `INVOICE`); only `TAX_INVOICE`, `CREDIT_NOTE`, and `DEBIT_NOTE` enter output VAT sync.
- Correction boundary: credit/debit notes require the issued original `TAX_INVOICE` and the same output Tax Code; correction-against-correction is rejected. Credit-note taxable/VAT amounts are stored as negative tax events; retry-safe signing prevents double negation.
- Owner expansion 2026-07-14 is a separate unchecked item 11B, documented in `docs/agent-memory/sap-transaction-tax-account-determination-11b.md`. It does not reopen item 11A, but it replaces the narrow global/header code assumption with SAP profile-backed, line-level, all-transaction-tax, G/L account-determination, and Thai-report reconciliation scope.

## Artifacts

### API backend
- `packages/contracts/src/tax.ts` — full tax contract types
- `packages/contracts/src/ai-tools.ts` — 5 tax read tools added to LINE_TOOL_REGISTRY
- `apps/api/src/modules/auth/permission-registry.ts` — 20 tax permission keys added
- `apps/api/prisma/schema.prisma` — 12 enums + 13 tax models appended; Company back-relations added
- `apps/api/prisma/migrations/20260630000000_item11_thai_tax_mvp/migration.sql` — hand-written SQL
- `apps/api/prisma/seed.ts` — document sequences + 15 WHT categories seeded
- Domain logic: `tax-period.logic.ts`, `vat-report.logic.ts`, `wht-report.logic.ts`, `tax-event.logic.ts`
- Domain ports: `tax-period.repository.port.ts`, `tax-event.repository.port.ts`, `tax-review-issue.repository.port.ts`, `source-reader.port.ts`
- Infrastructure: `prisma-tax.repository.ts`, `accounting-document-source.adapter.ts`, `expense-source.adapter.ts`
- Use cases: `sync-tax-events.use-case.ts`, `generate-vat-report.use-case.ts`, `generate-wht-report.use-case.ts`
- Export/certificate/CIT use cases: `generate-tax-filing-package.use-case.ts`, `create-wht-certificate.use-case.ts`, `get-cit-calendar.use-case.ts`
- Export artifact logic: `tax-export.logic.ts` creates REVIEW_JSON, CSV, minimal XLSX, and minimal PDF artifacts without a new dependency
- AI tools: `line-ai/application/use-cases/erp-tax-tools.use-case.ts` — 5 tools registered
- Module: `tax.module.ts`, wired in `app.module.ts`, tools wired in `line-ai.module.ts` + `internal-tools.controller.ts`
- HTTP controller: `tax.controller.ts` — profile, periods, sync, events, VAT/WHT report, review issues, filing status, export packages, 50 ทวิ certificates, CIT calendar, WHT categories
- Output Tax Code follow-up: `packages/contracts/src/accounting-documents.ts`, `apps/api/src/modules/accounting-documents/domain/logic/accounting-status.logic.ts`, `apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts`, and `apps/api/src/modules/tax/infrastructure/adapters/accounting-document-source.adapter.ts`
- Persistence migration: `apps/api/prisma/migrations/20260713210000_output_vat_tax_code_receipt_boundary/migration.sql` adds code columns/constraints, backfills unambiguous legal tax documents, leaves ambiguous legacy tax documents review-gated, supersedes legacy output-VAT events from non-tax document roles, and signs legacy credit-note events negative

### Web frontend
- `apps/web/src/features/tax/tax.api.ts` — API client functions including report/export artifact calls
- `apps/web/src/features/tax/TaxWorkspacePage.tsx` — tax workspace UI (VAT/WHT/CIT tabs, period list, event detail, review issues, recompute report, export files, mark filed/paid)
- `apps/web/app/(workspace)/companies/[companyId]/tax/page.tsx` — replaced PlannedModulePage with TaxWorkspacePage
- `apps/web/src/features/accounting-documents/AccountingPages.tsx` — manual document creation uses the same Tax Code/document-role rules as the API; receipt shows no-code/no-duplicate-VAT guidance; tax invoice and correction flows preserve code

### Tests
- `tax-period.logic.spec.ts` — 19 tests (period key format, lock, due date evaluation, review issue creation)
- `vat-report.logic.spec.ts` — 6 tests (VAT totals, excluded lines, review issue count)
- `wht-report.logic.spec.ts` — 7 tests (WHT grouping, totals, certificate validation)
- `tax-export.logic.spec.ts` — 5 tests (REVIEW_JSON/CSV/XLSX/PDF artifact generation and XLSX/PDF signatures)
- `accounting-status.logic.spec.ts` — plain receipt, tax invoice, combined receipt/tax invoice, and correction source/code validation
- `sync-tax-events-output-code.use-case.spec.ts` — `O7`/`OX`/`O0`, zero-tax event preservation, negative credit note, retry-safe signing
- `accounting-documents.model.spec.ts` — web VAT-mode-to-Tax-Code mapping
- All 404 API tests pass

## Follow-ups

- Implement item 11B from `docs/specs/sap-compatible-transaction-tax-account-determination-spec.md` and its phased plan; start with Phase 0/1 only.
- Durable attachment-backed storage/download for generated export/PDF artifacts. Current API returns artifact content inline with checksum and keeps audit metadata clean.
- Worker push reminders for upcoming tax obligations. Current read-only LINE/AI tax tool can summarize upcoming/overdue periods from `TaxPeriod`.
- Deeper CIT supporting summary population from full ledger P&L once real accounting-period report APIs are expanded.

## Verification

Commands run:
- `CI=true corepack pnpm --filter @watchdog-bms/api exec tsc --noEmit` → 0 errors
- `CI=true corepack pnpm --filter @watchdog-bms/web exec tsc --noEmit` → 0 errors
- `CI=true corepack pnpm --filter @watchdog-bms/contracts exec tsc --noEmit` → 0 errors
- `CI=true corepack pnpm --filter @watchdog-bms/api test` → 404/404 pass
- `CI=true corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/tax/domain/logic/tax-export.logic.spec.ts` → 5/5 pass
- `CI=true corepack pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma` → schema valid
- `CI=true corepack pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma` → Prisma Client generated
- `git diff --check -- apps/api apps/web packages/contracts docs` → pass
- `DATABASE_URL=postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public CI=true corepack pnpm --filter @watchdog-bms/api exec prisma migrate status --schema prisma/schema.prisma` → 12 migrations found; database schema is up to date
- `DATABASE_URL=postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public CI=true corepack pnpm --filter @watchdog-bms/api exec prisma migrate deploy --schema prisma/schema.prisma` → no pending migrations
- `DATABASE_URL=postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public CI=true corepack pnpm --filter @watchdog-bms/api exec prisma db seed --schema prisma/schema.prisma` → seed complete
- Local DB smoke: `WhtIncomeCategory` count = 15; `DocumentSequence` has `tax.filing_export` and `tax.wht_certificate`
- `pnpm --filter @watchdog-bms/api test` → 1,879/1,879 pass, including registered output Tax Code and expense VAT invariant suites
- `pnpm --filter @watchdog-bms/web test` → 270/270 pass
- Contracts build, API build/typecheck, web typecheck, Prisma generate/validate, and `git diff --check` → pass
- Fresh isolated database `watchdog_tax_code_smoke_20260713`: all 60 migrations applied and seed completed
- Runtime API smoke: receipt carrying `O7` rejected `422`; correction-against-correction rejected `422`; issued plain receipt created no VAT event; `O7`/`OX`/`O0` events created; credit note produced taxable `-100` and VAT `-7`
- Database constraint smoke: mismatched `OX` + VAT-excluded/positive-VAT update was rejected, while the intentional `outputTaxCode = null` + `NEEDS_REVIEW` legacy state was accepted inside a rolled-back transaction
- Authenticated browser smoke at `/companies/seed-local-company/sales-documents` and `/tax`: manual receipt no-code rule visible, tax invoice offers `O7`/`OX`/`O0`, document detail and tax event table show code, credit note shows negative adjustment, zero console errors

Notes:
- The repo-local Docker database uses root `.env` (`127.0.0.1:15432/watchdog_bms`). `apps/api/.env` still contains Prisma sample values for `localhost:5432/mydb`; use root `.env` or override `DATABASE_URL` for local gates.
- Prisma migrate initially failed in the sandbox because local TCP/tsx IPC needed elevated execution. The same commands passed when rerun with local DB/IPC access.
- Item 11 migration was applied to the already-running local Docker DB with `psql` after Prisma CLI was blocked by sandbox TCP access, then recorded in `_prisma_migrations`; subsequent Prisma `migrate status` and `migrate deploy` both reported up to date/no pending migrations.

## Next

1. Add durable export attachment storage if users need re-download/history beyond inline first-pass artifacts.
2. Add worker push reminders when notification scheduling is prioritized for tax deadlines.
