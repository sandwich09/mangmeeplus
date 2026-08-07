# Agent Memory: expense-detail-500-observability

Status: RESOLVED 2026-07-15. Corrective migration deployed (api-web `56311b88`, task def :160); prod startup applied `20260715120000_heal_item11b_tax_columns`; expense detail now returns 200 (verified on `cmrlyu9oo00074c5voeycpeht`, the record that threw P2022), 0 unhandled exceptions.
Owner: thawtchai
Scope: `GET /v1/companies/:companyId/expenses/:expenseId` returns 500 in prod (mangmeeplus.com); observability defect in `apps/api/src/main.ts` + prod schema drift.

## ROOT CAUSE (confirmed 2026-07-15)
Prod log (after the observability deploy `55f89a40`) showed the real throw:
`PrismaClientKnownRequestError P2022: The column ExpenseLine.sourceCurrencySnapshot does not exist in the current database` on `prisma.expenseRecord.findFirst()` (the detail path's `include: { lines }`).
- The column is added by migration `20260714120000_item11b_transaction_tax_schema`, which prod RECORDED as applied on 2026-07-14 16:12 UTC — but that migration's file was only committed on 2026-07-15 02:42 UTC (`dcdb0fe0`), ~10h later. So prod dirty-deployed an earlier/incomplete version, recorded it applied, and `migrate deploy` then skips the finalized file → the `ALTER TABLE` column-adds never landed.
- List path works (no `lines` include → never SELECTs the missing columns); every detail read 500s.
- Same partial-apply almost certainly left the sibling line/event tables (AccountingDocumentLine, JournalLine, TaxEvent, Purchase*/VendorBillLine) missing the same columns.

## Symptom
- Prod: expense **detail** read 500s for every record (`cmrkovuvf…`, `cmrkoyejt…`); **list** read 200/304. ~49ms. requestId e.g. `f2a6af06-…`.

## Investigation (confirmed)
- Path: [GetExpenseUseCase.execute](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts) → [findByIdWithRelations](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts). Detail runs 3 extra queries (include `lines`, `attachmentLink`, `expenseSubstituteReceiptEvidence`) + mappers; list only reads `ExpenseRecord`. That asymmetry = why list works, detail 500s.
- **NOT a migration/schema problem.** Prod CloudWatch shows all 64 migrations applied (incl. `Applying migration 20260714120000_item11b_transaction_tax_schema … applied`). Built a shadow DB migrated to 64 and ran the real generated client against every detail-path relation (`findMany take:1`) → all OK → no schema drift. So prod is fully migrated; "run migrate" would NOT fix it.
- **Why no stack in logs:** [main.ts](../../apps/api/src/main.ts) bootstraps with `logger: false` and there was no exception filter → Nest returns 500 silently. CloudWatch window ±3s around the 500 had only the `msg:"request"` line.
- Deployed image tag `ecs-api-web-c2860d0e` == HEAD expense code (HEAD `af382cc4` is docs-only on top). Committed code guards every mapper for schema-valid data → the prod throw is data-triggered OR from dirty-tree-deployed code (repo ships dirty tree on deploy).
- Local repro hit P2022 `ExpenseLine.taxCodeDefinitionId does not exist` but that is a LOCAL-only artifact: local DB (`watchdog_bms` @15432) has a FAILED migration `20260712140000_crm_booking_canonical_customer` (P3009) blocking the 07-14 tax migration. Not prod's cause.

## Decision
- Fix observability first (the real blocker), and make it complete so future incidents don't need ad-hoc logging:
  1. Global exception filter logs 5xx with stack + Prisma code/meta + requestId, keeps 4xx quiet, preserves the exact 500 response (extends `BaseExceptionFilter`). Registered in main.ts using the in-scope `logger`, same pattern as `ApiRateLimitGuard`.
  2. `RequestLoggerMiddleware` now logs every request at level-by-status (5xx=error, 4xx=warn, else info) so all failed requests are filterable/alertable by level, not just 500.

## Artifacts
- New: `apps/api/src/common/filters/all-exceptions.filter.ts`
- Edited: `apps/api/src/main.ts` (import + `useGlobalFilters`)
- Edited: `apps/api/src/common/middleware/request-logger.middleware.ts` (level-by-status)

## Verification
- Self-check `check-filter.ts`: 5xx logged with stack/code/meta, 4xx not logged. PASS.
- Self-check `check-request-logger.ts`: level = error(5xx)/warn(4xx)/info(else). PASS.
- `tsc --noEmit` in apps/api: exit 0, no errors.

## FIX (written, verified, awaiting deploy)
New idempotent corrective migration `apps/api/prisma/migrations/20260715120000_heal_item11b_tax_columns/migration.sql`:
- `CREATE TYPE` (DO-block guarded) for the 7 enums the snapshot columns need; `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for the tax-snapshot columns on all 7 line/event tables.
- No-op where columns exist; adds them where prod is missing them. Deliberately excludes the original migration's new tables / FKs / one-time data backfills (not needed for these reads; riskier to replay — revisit if tax-config/reconciliation features error).
- Applies automatically on next deploy (startup `migrate deploy`). Only adds nullable columns → safe for the canary (also un-breaks the still-running old task, which shares the DB).

Verified on a fresh shadow DB migrated to all 64 (= prod schema):
- Run as-is → clean no-op, exit 0 (only "already exists, skipping" NOTICEs).
- Drop 3 ExpenseLine tax cols (simulate prod drift) → re-run → all 3 re-added.
- Generated client detail-path probe (`expenseLine.findMany` etc.) → all OK post-heal.

## Next
1. Deploy (startup `migrate deploy` applies `20260715120000` → prod columns added → detail read recovers). 2. Confirm: `logs.sh api "unhandled exception" 15m` should go quiet for `/expenses/:id`; verify one authenticated 200 on the expense page. 3. Watch for the same drift on other tables the partial migration touched (procurement/ledger/tax-config reads) — corrective migration covers their COLUMNS; if tax-config/reconciliation features 500, prod is also missing the new tax TABLES (separate corrective step, needs prod schema check).
- Prevention: deploy pipeline ships the dirty tree with no `migrate deploy` gate, so migrations can be applied from unfinished files. Consider committing migrations before deploy / adding a checksum guard.
- Local cleanup owed: failed migration on local `watchdog_bms`; scratch DB `watchdog_shadow` on @15432.
