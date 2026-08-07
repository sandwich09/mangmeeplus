# Agent Memory: Accounting + Tax "plug-in later" path (from Expense/receipt data)

Status: ANALYSIS / not implemented. Captured for future continuation (no code written for this).
Owner: develop
Scope: Confirm whether enabling `double_entry_ledger` + `thai_tax` later "just plugs in" and computes
accounting/tax from bills/receipts already captured via the expense + LINE AI features.

## Answer in two layers

**Layer 1 — access/menus: plugs in instantly (admin toggle, no redeploy).**
Enabling `double_entry_ledger` / `thai_tax` at the system-admin panel un-strips `ledger.*` / `journal.*`
/ `tax.*` permissions → menus (สมุดรายวัน, ปิดงวด, งบการเงิน, ภาษี) + APIs appear. Same entitlement gate
as everything else (see [[feature-entitlement-dashboard-gating]]). Packs: `pack.ledger.*`→double_entry_ledger,
`pack.tax.*`→thai_tax in `capability-pack.registry.ts`.

**Layer 2 — computing accounting from stored bills/receipts: the architecture is source-document-driven and
already built for this, BUT it is not zero-touch.**

Data flow (verified in code):
```
LINE upload → expense record (stored + postingStatus='pending' + emits outbox 'expense.confirmed')
      [enable double_entry_ledger]
   → GenerateJournalFromSource (posting engine) → journal entry   (idempotent; default Thai SME chart)
      [enable thai_tax]
   → sync-tax-events → VAT/WHT computed from the same documents
```

## What ALREADY exists (pointers)
- Expense is the source of truth, tracks posting: `postingStatus` ('pending'/'posted'/'reversed'/'not_required').
  - `expenses/application/use-cases/expense-draft.use-case.ts` — on CONFIRM sets postingStatus='pending' and
    `outbox.append('expense.confirmed', 'expense_record', ...)`. Void → 'reversed'.
- Posting engine: `ledger/domain/logic/posting-engine.logic.ts` — handles event types `expense.confirmed`,
  `expense.posted`, `expense.payment`, `expense.voided`; has `buildDefaultPostingLines` using a built-in
  **Thai SME chart of accounts** (line ~23) so it can post without custom rules.
- Poster use-case: `ledger/application/use-cases/journal.use-case.ts` — `GenerateJournalFromSourceUseCase.execute`:
  `requirePerm('journal.entry.post')` (gated by double_entry_ledger), idempotent (`findGeneratedJournal`),
  tries `findActivePostingRule` then default lines, resolves account codes → ids, `markSource()` writes
  postingStatus back. Errors: `posting_rule_missing`, `account_not_found`.
- HTTP trigger (on-demand): `ledger/presentation/http/ledger.controller.ts` `POST generateJournalHandler`.
- accounting-documents (invoices/receipts) also carry postingStatus 'pending' → same posting path
  (`accounting-documents/infrastructure/prisma-accounting.repository.ts`).
- Tax: `tax/application/use-cases/sync-tax-events.use-case.ts` (tax.event.sync, gated by thai_tax).

## Gaps to build when this is enabled for real
1. **Chart of accounts must exist per company** — posting resolves account by code; missing → `account_not_found`.
   Seed exists but must be present in that company (seed on ledger-enable, or onboarding).
2. **Posting rules** (category→account mapping) — optional; default lines cover the basics.
3. **Tax profile/config** (VAT/WHT rates, periods) for thai_tax.
4. **Auto-post worker (MAIN missing piece)** — posting is currently **on-demand via endpoint**; no consumer
   drains `expense.confirmed` → posting is wired. To auto-post new expenses AND backfill the 'pending' backlog,
   add a worker in `apps/workers` (BullMQ already there; existing drainers: `workflow-outbox-drain`,
   notifications) that consumes `expense.confirmed`/`accounting.document`/`payment` events → calls
   GenerateJournalFromSource. Backfill = reprocess sources where postingStatus='pending'.

## Verification
Read-only code trace (no changes). Confirmed: postingStatus field, outbox emit, posting engine event map +
default chart, GenerateJournalFromSource (perm-gated, idempotent), on-demand controller trigger, no
outbox→ledger auto-drain currently wired.

## Next (when resumed)
- Decide auto-post trigger placement (worker consuming expense.confirmed) + backfill strategy for existing
  'pending' receipts.
- Confirm chart-of-accounts + posting-rule + tax-config bootstrap on feature-enable (or onboarding).
