# Agent Memory: sales-credit-refund-rules-2026-10-02

Status: The four owner decisions on sales credit (RB-37 / Q36, decided 2026-10-02) are implemented on `claude/sales-credit-refund-rules-20261002`, cut from `origin/develop` `55daababb` and merged with develop `e2f7eb423` (#954), which landed while the branch was being built. Not pushed, no PR, nothing deployed. The branch carries a migration, so it cannot ship on the hotfix path.

Owner: one implementation agent in worktree `/private/tmp/mangmee-sales-credit-20261002`.

Scope: the sales console's credit rules and report (`apps/api/src/modules/sales-console`), the two billing functions that feed it (`billing-financial.ts`, `billing-package-request.ts`), one additive migration, the report screen `/sales/reports`, and the docs below. `paid-invoice.ts` and every `billing-schedule.ts` are untouched. No `package.json` edit, no environment switch, no AI model call.

Decisions:
- **Decision 4, one base.** A referral is credited with the package price the shop was charged, which is what a deal already passes. `recordReferralAttribution` reads it from the invoice's own verified numbers: `totalSatang − taxSatang` when the pinned policy is `EXCLUSIVE_VAT_7`, else `totalSatang` (the figure it already was). No caller changed.
- A first bill lowered by a sales-event discount is credited with the discounted price, not the full package price. The sales-event spec §5.5 already said a referral records the amount really charged, and a credit above what the shop paid would survive a full refund. If the owner wants the full price, it is one line in `recordReferralAttribution`, and the deduction must then be scaled.
- **Decisions 1 to 3, dated deductions.** New table `SalesAttributionDeduction`: one row per refund that succeeded or dispute that was lost, with the provider's id (unique), the amount taken, `occurredAt` (the provider's time of the refund, or of the dispute being opened) and `createdAt` (when it was recorded).
- The 60 days run from `SalesAttribution.paidAt` to `occurredAt`, inclusive of day 60. The time of observation plays no part.
- The deduction is booked in the Bangkok month of `createdAt`, the month it was recorded. The system records within minutes (webhook, or the 5-minute account sweep), so this is the month the refund happened. When it learns later, the deduction goes to the month it learned, because the owner's rule is that a month that is over never changes. The line still shows the provider's date. The one-line alternative is `bangkokMonthKey(item.occurredAt)` in `aggregateReport` and `occurredAt` in the report query.
- A dispute is deducted when its status is `lost`. Won, open and inquiry statuses deduct nothing. The window is counted to the day the dispute was opened; the booking month is the month the loss was recorded.
- The amount taken is the refunded or lost satang, capped at the credit that is left on the row. A full refund therefore takes exactly the credit, also when the money returned includes tax added on top.
- Ingestion lives in `observeBillingCharges`, the one place a refund or dispute is observed. For the one payment per shop that carries credit, and only while credit is left, it also reads `GET /refunds?charge=` and `GET /disputes?charge=`. Any other payment costs no extra provider call. An entry that is not exactly a settled refund or dispute of that charge, in THB, with a positive amount and a time, is left out, never guessed. The provider's id is taken as given, because it is only the key against a second write, and the amount has no upper bound of its own, because the credit that is left caps it. A provider error fails that account's reconcile for the cycle, like any other provider read there.
- `recordBillingFinancials` records the deductions whether or not the invoice totals changed: a dispute is lost, and a pending refund succeeds, without `amount_refunded` or `disputed` moving.
- A flagged row nobody reviewed counts zero, and so do its deductions.

How rows from before this change combine with new ones in one report:
- `SalesAttribution.refundedSatang` is the old cumulative, undated refund. The report still takes it off in the payment month: `max(0, amountSatang − refundedSatang)`. Months already read do not move. The column is never written again, so it is 0 on every new row.
- A new refund or lost dispute on an old row is a dated deduction in its own month. One row can therefore show both: the old cumulative amount in the payment month and dated lines later. Together they never exceed the row's credit.
- When the provider's refunds are read for a row that carries `refundedSatang`, the earliest refunds are consumed against that amount and only what exceeds it is dated. A dispute was never part of it.
- A dispute lost before this change, opened inside the 60 days, becomes a deduction in the month the system first reads it after the release, not in a past month.
- Existing REFERRAL amounts are not rewritten.

Existing rows credited on a different base:
- One kind of case differs: a REFERRAL row created while tax was added on top (`EXCLUSIVE_VAT_7`). It holds the invoice total, which is the new base plus the tax. Whether the first bill also used an event discount does not change the cause, only the price the tax sits on.
- Rows created with tax included, or with no VAT registration, already equal the new base. DEAL rows never changed.
- A second kind would exist only if the owner decides the base is the full package price: every REFERRAL row whose first bill used an event discount, old or new, under any tax setting. Query (2) lists them.
- Both queries were run on a scratch PostgreSQL with seven synthetic rows and returned exactly the expected ones. They have not been run on production or UAT. They are read-only.

```sql
-- (1) REFERRAL rows credited on the old base, where it differs from the base used since 2026-10-02.
SELECT a."companyId", c."name" AS shop, u."displayName" AS salesperson, a."paidAt",
       a."amountSatang" AS credited_satang,
       i."totalSatang" - i."taxSatang" AS new_base_satang,
       a."amountSatang" - (i."totalSatang" - i."taxSatang") AS difference_satang,
       EXISTS (SELECT 1 FROM "SalesEventTicket" t WHERE t."invoiceId" = i."id" AND t."redeemedAs" = 'DISCOUNT') AS used_event_discount
FROM "SalesAttribution" a
JOIN "BillingInvoice" i ON i."id" = a."sourceInvoiceId"
LEFT JOIN "Company" c ON c."id" = a."companyId"
LEFT JOIN "User" u ON u."id" = a."salesUserId"
WHERE a."source" = 'REFERRAL'
  AND i."contractSnapshot"->'policy'->>'taxTreatment' = 'EXCLUSIVE_VAT_7'
  AND a."amountSatang" <> i."totalSatang" - i."taxSatang"
ORDER BY a."paidAt";

-- (2) For information: REFERRAL rows whose first bill used an event discount, with the full package price beside the credit.
SELECT a."companyId", c."name" AS shop, u."displayName" AS salesperson, a."paidAt",
       a."amountSatang" AS credited_satang,
       (i."offerSnapshot"->>'priceSatang')::int AS full_package_price_satang,
       t."appliedDiscountSatang" AS discount_satang
FROM "SalesAttribution" a
JOIN "BillingInvoice" i ON i."id" = a."sourceInvoiceId"
JOIN "SalesEventTicket" t ON t."invoiceId" = i."id" AND t."redeemedAs" = 'DISCOUNT'
LEFT JOIN "Company" c ON c."id" = a."companyId"
LEFT JOIN "User" u ON u."id" = a."salesUserId"
WHERE a."source" = 'REFERRAL'
ORDER BY a."paidAt";
```

Where refund and dispute facts come from:
- Refund time and amount: the provider's refund list for the charge (`created`, `amount`, `status`). Before this change it was read only for the admin's adjustment list and the in-app refund flow, and never stored.
- Dispute outcome: the provider's dispute list for the charge (`status`, `amount`, `created`). Before this change only the charge's `disputed` flag was stored. The event handler fetched the dispute and used nothing but its charge id.
- The balance reader (`billing-settlement.service.ts`) stores refund movements with the provider's time, but only for windows an admin scans, and it files dispute adjustments as `MANUAL` with no invoice. It was not used.
- Still not ingested: the provider's time of a dispute being closed. The dispute object carries none. Only the `charge.dispute.closed` event does, and events are stored with the time they were received, not the provider's.

Open questions:
- Owner: for a shop that used an event discount, is the referral credit the discounted price (implemented) or the full package price?
- Owner: is the booking month the month the system recorded the deduction (implemented, a month that is over never changes), or the provider's date even when that month is already over?
- With tax added on top, a partial refund takes its tax share from the credit too. Scale by credit over paid if partial refunds under `EXCLUSIVE_VAT_7` ever matter. In-app refunds under that setting fail closed today.
- Not known: the tax treatment set in production, and whether any production row has a refund or a dispute.
- Found and not changed: after the Owner chooses "ตัดออกจากยอด" on a flagged row, the row has flags and a review time, so the report counts it in full. The screen and the contract say it should count zero. Flagged as a separate task.
- RB-39 still applies: the report reads at most 5,000 rows, now for credit and for deductions separately.

Artifacts:
- `1d743f2b7` referral base; `d19fe87b9` schema and migration `20261002100000_sales_credit_deductions`; `acf7888ab` report reads deductions; `dd295c74c` ingestion of refunds and lost disputes; `3116069aa` and `7fa5d5b37` the report screen; `e1a021f77` docs; `2a552d984` merge of develop `e2f7eb423`; `c0c36ea78` and `206797862` two more PostgreSQL tests; `b18e1a017` the reader takes any provider id; then the commit that records this paragraph.
- Docs: sales spec §17.1.1 (new) and the note in §17.2; bugs file RB-37; executive backend spec §14.3 and its two status lines; one status line each in the executive gap-impact file and backend plan; sales-event spec §5.5.

Verification (2026-10-02):
- New tests: 26 (12 in `sales-attribution.logic.spec.ts`, 4 in `billing-financial.spec.ts`, 4 in `sales-console.pg.spec.ts`, 5 in `sales-console.logic.spec.ts`, 1 in `sales-console.qa.spec.ts`). With the six changed source files put back to `55daababb`, all 26 fail, plus the three older aggregation tests whose call now passes the deductions list; everything else in those five files passes (20 of 35, 4 of 8, 16 of 20, 55 of 60, 45 of 46).
- Where they run: `sales-attribution.logic.spec.ts` and `billing-financial.spec.ts` are in the whole-chain acceptance catalog, which CI runs; no billing or sales-console spec is in the `test` script of `apps/api/package.json`. `sales-console.pg.spec.ts` is registered in `.github/workflows/ci.yml`. No spec file was added, so nothing had to be registered.
- `sales-console.pg.spec.ts` on a scratch PostgreSQL 18.3 with every migration applied: 20 pass (16 before). One of the four new cases drives the real charge observer against real tables with a stand-in for the provider only. Its first run found that the reader dropped facts whose id did not match one pattern, which is why `b18e1a017` exists.
- Before the merge, on `55daababb` plus the code commits: package typechecks (API with its 8 GB heap flag, web) 0 errors; whole-chain acceptance exit 0; full API `test` script exit 0; web suite 2222 pass; contracts 343 pass.
- After merging develop `e2f7eb423`: native typechecks 0 errors; whole-chain acceptance exit 0; full API `test` script exit 0; web suite 2222 pass; contracts 343 pass.
- On the head before this note was committed (`206797862`): package typechecks, API with its 8 GB heap flag and web, 0 errors each; whole-chain acceptance exit 0; the five touched spec files pass (43 API, 106 web, 20 PostgreSQL); `migration:review` exit 0; W00 capability manifest spec 4 pass with no regeneration; maintenance pins current; `test:boot` resolved every provider; `git diff --check` clean.
- `prisma migrate deploy` applied the new migration on the scratch database, and `prisma migrate diff` from that database to the schema shows no difference for the new table.
- Browser, local stack (the API and web of this branch, a seeded scratch database, the seeded QA lead): `/sales/reports` at 390 px and 1280 px, team view and single-salesperson view. No horizontal scroll, a negative month and a negative agent shown with the sign before ฿ and marked, deduction lines stacked with the shop, the payment month and the date. That look found the month total of a negative month still painted green, fixed in `7fa5d5b37`.
- An ordinary เซลล์ does not hold `sales.report.read` and is sent back to the deals page, so the single-salesperson view is what a lead or the Owner sees when one person is in the answer.
- Not run: the Playwright e2e suite, any UAT or production system, the real payment provider. The two provider list reads (`/refunds?charge=`, `/disputes?charge=`) were exercised only against stand-ins.

Next: coordinator review; the owner's answer on the two open questions; then push, PR and the release path with a migration (UAT, then promote). After the release, run query (1) on production to see whether any existing referral row sits on the old base.
