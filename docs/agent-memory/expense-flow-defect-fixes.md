# Agent Memory: expense-flow-defect-fixes

Status: DONE (2026-08-09) — three defects found while writing the expense-flow user
manual, all fixed and verified against the running local stack. Not committed.
Owner: Claude
Scope: `apps/api/prisma/seed.ts`, `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`,
`packages/contracts/src/expenses.ts`, `apps/web/src/features/expenses/{ExpenseReviewPage.tsx,expenses.model.ts}`,
`apps/web/src/common/i18n/workspace-dictionary.ts`.

## Findings and fixes

1. **Seed stored VAT rate in the wrong unit.** `seed.ts` wrote `vatRate: '7'` at 10 sites
   while the domain uses a 0–1 fraction, so every seeded VAT line rendered as `700%`.
   The API is not at fault — `PATCH .../review-fields` with `"7"` is rejected with
   *"Line 1 VAT rate must be between 0 and 1…"*; the seed bypasses the use-case by writing
   through Prisma. Blast radius on a fresh seed was 7 rows across 5 tables (ExpenseLine,
   AccountingDocumentLine, PurchaseRequestLine, PurchaseOrderLine, VendorBillLine).
   Not cosmetic: the expense review step 1 hard-blocks on the out-of-range rate, so
   EXP-LOCAL-0006 could not reach step 2 at all. Fix = `'7'` → `'0.07'`.

2. **Raw ledger codes reached the screen.** `journal.use-case.ts` passes machine codes
   (`posting_rule_missing`, `posting_unbalanced`, `account_not_found:<id>`, …) as the stored
   `postingError`, and `ExpenseReviewPage` rendered that value verbatim, so the accounting
   card literally said `posting_rule_missing`. The API storing a code is deliberate —
   `template-company-posting.use-case.spec` asserts it — so the wording belongs in the web:
   `postingErrorText()` in `expenses.model.ts` maps code → Thai, keeps the `:<accountId>`
   suffix, and passes through non-code values (the auto-post worker writes a Thai sentence).
   Fixing it at render also covers rows already stored.

3. **Duplicate warning card was undecidable.** It printed `candidateExpenseId.slice(-8)`
   (`seed-expense-record-ads` → `cord-ads`) because `DuplicateCandidateSummary` carried no
   human fields. The repository query already joins `candidateExpense` for the branch-scope
   filter, so adding a `select` to that include costs no extra round-trip. The card now reads
   `EXP-LOCAL-0002 · Meta Ads Thailand · 7 ส.ค. 2569 · ฿3,424.00` plus the reason codes that
   were already being returned and never displayed.

## Verification

- `pnpm --filter @watchdog-bms/web typecheck` ✓ · `apps/api tsc --noEmit` ✓
- web unit tests 821/821 ✓ (4 new `postingErrorText` cases)
- `IS_WEBPACK_TEST=1 pnpm --filter @watchdog-bms/web build` ✓
- API specs touching the change ✓: expense repository atomic-confirm / duplicate-resolve,
  expense-status.logic, expense-auto-post, expense-backfill, template-company-posting.
- Full `apps/api pnpm test` fails in `feature-launch/execution-attempt.service.race.spec.ts`
  (array-order assertion on a DB-backed spec). Confirmed pre-existing: it fails the same way
  with these changes stashed.
- Browser check against the new code (API on 3101 + `next dev` on 3100, docker DB):
  VAT reads `7%`; duplicate card reads the document number, payee, date and amount plus
  `ผู้ขายและเลขที่เอกสารตรงกัน · ผู้ขาย วันที่ และยอดเงินตรงกัน`; the accounting card reads
  `ยังไม่ได้กำหนดกฎการลงบัญชีสำหรับเอกสารประเภทนี้ กรุณาตั้งค่ากฎการลงบัญชีก่อน`.
- Local docker DB re-seeded; all five tables now hold `0.0700`.

## Next

- [ ] Commit (left uncommitted: the working tree also carries an unrelated in-flight
      privacy/terms/data-deletion change from another session — commit these seven files only).
- [ ] Optional: auto-post writes `ลงบัญชีอัตโนมัติไม่สำเร็จ (<code>)` while generate writes the
      bare code. Storing the bare code in both paths would let `postingErrorText()` own all wording.
