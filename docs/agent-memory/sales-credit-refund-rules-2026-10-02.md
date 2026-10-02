# Agent Memory: sales-credit-refund-rules-2026-10-02

Status: The four owner decisions on sales credit (RB-37 / Q36, decided 2026-10-02) are implemented on `claude/sales-credit-refund-rules-20261002`, cut from `origin/develop` `55daababb` and merged with develop `e2f7eb423` (#954), which landed while the branch was being built. Not pushed, no PR, nothing deployed. The branch carries a migration, so it cannot ship on the hotfix path.
A fifth decision of the same day, a shop waiting for review is not an opened shop until it is reviewed, is implemented on `claude/sales-waiting-not-activation-20261002`, cut from develop `603f461dd` in worktree `/private/tmp/mangmee-sales-waiting-20261002`. Not pushed, no PR, nothing deployed. It carries no migration.

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
- **A shop the Owner cut out counts zero in every figure** (added the same day at the coordinator's request). "ตัดออกจากยอด" keeps the flags and stamps the review; the report used to count any reviewed row, so the cut-out shop was credited in full. One rule now, `salesCreditState` in contracts, read by the report and by the Owner's queue: no flag = counted, flag and no review = waiting, flag and a review = cut out. A cut-out shop is no amount, no activation (§17.2 counts "ร้านที่นับได้") and no pending flag, and its deductions cannot make a month negative. A shop confirmed as not abnormal counts as before. A waiting shop still showed as an activation with the "ถูกธง" marker at that point; the next decision changed that.
- **A shop that carries a flag and still waits for review is not an opened shop until it is reviewed** (owner 2026-10-02, after the lane merged; branch `claude/sales-waiting-not-activation-20261002`). One rule beside `salesCreditState`: `salesCountsAsActivation(state)`, true for a counted row only. It decides the amount and the opened-shop count together, in the report (`aggregateReport`, `countableAmountSatang`) and in the Owner's morning digest (`dailyDigest`).
  - Waiting: no amount and no opened shop in any figure. It is reported on its own: the count per salesperson (`flaggedCount`, shown as "รอตรวจ N ร้าน"), and one named line per shop in the month of its payment (`SalesReportMonth.waiting`: the shop, deal or referral, and the flags).
  - Confirmed: counts from then on, the shop and the amount in the month of its payment, which is the rule the amount already followed. Cut out: never counts, as before.
  - The digest counted every row created the day before as a new shop with its amount, flags ignored, cut-out rows included. It now counts by the same rule and says "รอตรวจ N ร้าน (ยังไม่นับในยอด)" for the ones waiting.
  - Words: "รอตรวจ" everywhere (the report said "ถูกธง"); the reasons on a waiting line are the ones the Owner's queue shows. The queue's confirm box names the month that will gain the shop.
  - No migration, no new permission, no `package.json` edit. `paid-invoice.ts` and every `billing-schedule.ts` are untouched.
- A cut-out shop can still be confirmed, which undoes it. Cutting out a shop that was already confirmed is refused (`SALES_FLAG_REVIEW_INVALID`), because confirming clears the flags and nothing would change while the audit trail said it had.
- The Owner's queue (`/system/sales-team`) says where each row stands, with the review date and the reason, and offers only a decision that still changes something.

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
- The two readings below were accepted by the coordinator on 2026-10-02 and stand until the owner objects; the sales spec §17.1.1 says so in one sentence each.
  - A referral whose first bill used an event discount is credited with the discounted price, not the full package price.
  - A deduction is booked in the month the system recorded it, not at the provider's date, so a month that is over never changes.
- With tax added on top, a partial refund takes its tax share from the credit too. Scale by credit over paid if partial refunds under `EXCLUSIVE_VAT_7` ever matter. In-app refunds under that setting fail closed today.
- Not known: the tax treatment set in production, and whether any production row has a refund or a dispute.
- A shop confirmed as not abnormal cannot be cut out later, because confirming clears the flags. Allowing it needs the review outcome stored apart from the flags.
- Not known: whether any production row was already cut out while the report still counted it (the review route only works since #950).
- The task chip raised for the cut-out bug, before the coordinator asked for the fix here, could not be withdrawn: it was reported as already started. No session for it showed in the session list at the time. If one exists, it works from develop on the same lines and must be stopped or reconciled with this branch.
- RB-39 still applies: the report reads at most 5,000 rows, now for credit and for deductions separately.
- A shop confirmed after the month of its payment ended raises that month's figures, the opened-shop count and the amount together. Before the waiting decision only the amount moved. This is the payment-month rule the owner's wording keeps, and it is not the "a month that is over never changes" rule of deductions. Nothing in the code pays or ranks by the count (no commission, target, tier or bonus exists; the report sorts by amount), so no other figure moves. Keeping a closed month fixed here needs a decision: book the confirmed shop in the month of the review (`flagReviewedAt` is stored, so no migration), and say where deductions recorded while it waited go.
- An ordinary salesperson (`MANGMEE_SALES`) does not hold `sales.report.read`, and `permission-registry.spec.ts` pins that, so they have no screen with their own count and cannot see the waiting line themselves; a lead or the Owner reads it for them. The API already forces such a caller onto their own rows. Granting the permission is a decision that was not taken here.
- The digest names only the shops recorded the day before. A shop confirmed later appears in the report, in the month of its payment, and in no digest as a new shop.

Artifacts:
- `1d743f2b7` referral base; `d19fe87b9` schema and migration `20261002100000_sales_credit_deductions`; `acf7888ab` report reads deductions; `dd295c74c` ingestion of refunds and lost disputes; `3116069aa` and `7fa5d5b37` the report screen; `e1a021f77` docs; `2a552d984` merge of develop `e2f7eb423`; `c0c36ea78` and `206797862` two more PostgreSQL tests; `b18e1a017` the reader takes any provider id; `35666bff4` task note; `cff86d365` a cut-out shop counts zero; `7be4013c8` the Owner's queue shows where each row stands; then the docs commit that records this paragraph.
- Docs: sales spec §17.1.1 (new) and the note in §17.2; bugs file RB-37 and the cut-out bug beside it; executive backend spec §14.3 and its two status lines; one status line each in the executive gap-impact file and backend plan; sales-event spec §5.5.

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

Verification of the cut-out fix (2026-10-02, on top of `35666bff4`):
- Re-verified first on the unchanged head: the report counted a cut-out row exactly like a confirmed one (49,900 and one activation), in the pure rule and on PostgreSQL through the real `reviewFlag` and `summary`.
- New tests: 9 (3 in `sales-attribution.logic.spec.ts`, 1 in `sales-console.pg.spec.ts`, 4 in `sales-console.logic.spec.ts`, 1 in `sales-console.qa.spec.ts`). With the five changed source files put back to `35666bff4`, exactly these 9 fail and everything else in the four files passes (35 of 38, 20 of 21, 60 of 64, 46 of 47). One older test that had encoded the bug, by expecting the full amount for a row with flags and a review, now states the confirmed case.
- Browser, local stack, a system-admin test account created for the check: the queue at 390 px and 1280 px with waiting, cut-out and confirmed rows; then a waiting shop was cut out through the real screen and the report read as the seeded lead. The row showed "ตัดออกจากยอดแล้ว", lost its "ตัดออกจากยอด" button, and left the report's amount, shop count and pending count.
- That look found the queue 276 px wider than a 390 px screen when a shop name is long, before this change as well; fixed in `7be4013c8` and measured at 0 px.
- Reruns on `7be4013c8`, the head before this note was committed: package typechecks, API with its 8 GB heap flag, web and contracts, 0 errors each; the touched specs pass (46 API, 111 web); `sales-console.pg.spec.ts` 21 pass; whole-chain acceptance exit 0; web suite 2227 pass; contracts 343 pass; full API `test` script exit 0; `test:boot` resolved every provider; W00 capability manifest spec 4 pass with no regeneration; maintenance pins current; `git diff --check` clean.

Verification of the waiting-shop change (2026-10-02, on `claude/sales-waiting-not-activation-20261002`):
- New tests: 11. On the API side both are in `sales-console.pg.spec.ts` (the report through the real `summary` and `reviewFlag`, the digest through the real `dailyDigest`). On the web side: 5 in `sales-console.logic.spec.ts`, 1 in `sales-console.qa.spec.ts`, 3 in the new `sales-waiting-shops.qa.spec.ts`.
- Older tests whose expectation changed with the rule: 2 report cases and 2 digest-text cases in the two domain specs, the cut-out case in the pg spec, the queue case in the QA spec.
- With the seven changed source files put back to `603f461dd`, exactly these fail and everything else passes: 4 of 45 in the two domain specs, 3 of 23 in the pg spec, 10 of 120 in the three web specs.
- On the final code: the two domain specs 45 pass; `sales-console.pg.spec.ts` 23 pass on a scratch PostgreSQL 18.3 with every migration applied and no seed; the three web sales specs 120 pass; web suite 2607 pass; contracts 344 pass; package typechecks, API with its 8 GB heap flag and web, 0 errors each; boot smoke resolved every provider; `git diff --check` clean.
- W00 capability manifest spec 4 pass with no regeneration. No file the manifest hashes changed, so the whole-chain acceptance was not run; the two domain specs it lists were run directly.
- `sales-console.pg.spec.ts` needs a database that was never seeded. Its payroll case decrypts every `SalesAgentProfile` with the spec's own key, so the two seeded QA salespeople make it fail. Seen on a seeded scratch database, on the old code and the new alike.
- Screens: `sales-waiting-shops.qa.spec.ts` renders the real report page and the real queue page with the state they load swapped in, for one counted, one waiting and one cut-out shop, and asserts the visible text of both.
- Browser, 390 px: the same rendered markup with the app's compiled CSS and fonts, served as static pages. The report as one salesperson and as a lead, the queue, and the confirm box, with a 75-character shop name written without a space and three reasons on one shop. No horizontal scroll on any of the four.
- Not done: a signed-in look against a running API (it needs an account password typed in), the Playwright e2e suite, any UAT or production system.

Artifacts of the waiting-shop change: `13bae91fe` the rule in contracts; `bbe6a8dc1` the report; `53140a928` the digest; `978664ea5` the PostgreSQL tests; `4c826bd5a` the screens and their tests; `94e25f2b6` the phone wrap of a long shop name; `3355b7a12` and `611eceaf0` docs; then the commit that records this line.

Next for the waiting-shop branch: coordinator review; the owner's word on the two points it leaves open (a late confirmation changes a closed month; an ordinary salesperson cannot open the report); then push and PR. It has no migration.

Next: coordinator review; the owner's answer on the two open questions; then push, PR and the release path with a migration (UAT, then promote). After the release, run query (1) on production to see whether any existing referral row sits on the old base.
