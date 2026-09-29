# Agent Memory: sales-event discount — any one-time payment, once per event (SD-O12)

Status: implemented on `claude/sales-event-discount-anytime-20260929` (from develop `b03b1a0f`); PR to develop open, not merged, not deployed.
Owner: Claude subagent for the controller session (2026-09-29).
Scope: Owner rule change SD-O12 to the sales-event discount ("ส่วนลดจากงาน"). Owner, verbatim: "ฉันอยากให้ได้ส่วนลดใช้ได้ตลอด เลือกเมื่อจ่าย และถ้าเป็น event เดียวใช้ได้ครั้งเดียวต่อบริษัท ถ้าเป็น event ใหม่ก็ยังใช้ได้".

Decisions:
- R1: discountable kinds are INITIAL, RESTART, REPEAT, SCHEDULED_CHANGE, FULL_PACKAGE_UPGRADE and UPGRADE, in CARD_ONCE and PROMPTPAY_ONCE only (`KINDS`, `EVENT_DISCOUNT_MODES`, `eventDiscountPurchase` in `billing-event-discount.logic.ts`). The buyer still chooses USE/DECLINE at payment, with USE as the default.
- UPGRADE is a basis switch only. `eventDiscountBasis` = `upgrade.amountSatang` when the snapshot has an upgrade, else the offer price. The quote, the Checkout stale check and `eventDiscountExpected` all use it. Scope is checked against the target offer.
  - `eventDiscountExpected` refuses a snapshot whose UPGRADE kind and upgrade source disagree.
  - `paid-checkout-invoice.ts` is unchanged: it already charges `discounted.unitAmountSatang` when present.
  - `upgradeHistory` prorates from catalog offer prices, never paid amounts, so a discounted invoice does not skew later upgrades.
  - Refunds read the invoice rows.
- R2: at most one ticket per shop per event, where an event is every batch with the exact same stored `eventName` (the key the event report groups by).
  - `usedEvents` covers tickets RESERVED or USED at the shop, either way.
  - `holderTickets` filters `eventName notIn used` in the query. With `spent`, it returns the holder's tickets from used events instead, which drive the "already used" line.
  - `reserveEventDiscount` rechecks inside the Checkout transaction, after the company lock. That serializes it per shop.
  - `eventDiscountBlock` now means a deal only. `eventDiscountHolderBlock` serves the LINE read.
- Migration `20260929190000_sales_event_discount_per_event` drops `SalesEventTicket_company_discount_key` (SD-O5). The old migration is not edited. `SalesEventTicket_batch_company_key` stays.
- Reason `COMPANY_ALREADY_USED` became `EVENT_ALREADY_USED` in the contract. The view names the event.
- `eventDiscountPath(source, renewalMode)`:
  - DISCOUNT for package-menu sources, and for PAID_CURRENT_MODE in CARD_ONCE/PROMPTPAY_ONCE.
  - CREDIT for auto-renewing PAID_CURRENT_MODE.
  - null for review sources.
  - `status.eventDiscount` is built when the path is DISCOUNT and `new_sales` is open.
- CARD_AUTO and PROMPTPAY_RENEW stay excluded, for both the first bill and renewals. An Owner decision on automatic renewals is pending.
  - LINE and the web held notice say "ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ ส่วนลดจากงานยังใช้กับรอบตัดเงินอัตโนมัติไม่ได้".
  - The old "จะเปิดให้ใช้เร็วๆ นี้" line was removed, so no promise is made.
- Also fixed (pre-existing, found while tracing): `checkoutExpirySession` compared the session total with the undiscounted `quote.totalSatang`. The customer's cancel ("ยุติหน้าชำระเงิน", "เลือกแพ็กเกจใหม่") and the admin's terminate of any discounted Checkout would fail until the session expired. It now uses `eventDiscountExpected(snapshot)?.totalSatang ?? quote.totalSatang`.

Open questions:
- Owner: automatic renewals (CARD_AUTO / PROMPTPAY_RENEW) with an event discount.
- SD-F: whether a one-time shop can also take credit. The credit path is unbuilt, and one-time shops now route to DISCOUNT.
- Card lines on the package page are computed from catalog prices. The UPGRADE confirm step shows the exact prorated discount, which can be none when the difference after discount would be under ฿10.

Artifacts:
- API:
  - `billing-event-discount.logic.ts` and `billing-event-discount.ts`
  - `billing.service.ts` (quote, checkout, status, LINE read)
  - `billing-checkout-expiry-source.ts`
  - `line-event-discount.logic.ts`
  - `liff-page.security.ts`
  - `sales-event.logic.ts` (the field label in messages)
  - `schema.prisma` (comment only)
  - the new migration
- Contracts: `packages/contracts/src/billing.ts`, reason union and docs.
- Web:
  - `BillingPage.tsx`: choice passed for FULL_PACKAGE too; the toggle keeps the FULL_PACKAGE intent; the "ชำระวันนี้" discounted total for REPEAT/FULL_PACKAGE_UPGRADE; the "ส่วนต่างแพ็กเกจ" line for UPGRADE; no "(บิลแรก)".
  - `billing-event-discount.ts`
  - `SalesEventBatchForm.tsx`: label "ส่วนลด (บาท)" and an event-name hint about one per event.
  - `sales-events.logic.ts`
  - `BillingCompanyOverview.tsx`
- Docs:
  - Spec: SD-O12 row; §0, §4.1, §4.1.1, §4.3, §6.1, §7.2 reason, §8, §8.1, §12 SD-Q2/SD-Q4, SD-E06/E08/E17/E23/E28.
  - Plan: §5 status row.

Verification (2026-09-29, worktree `/private/tmp/mangmee-sd-anytime-20260929`):
- Focused API specs (`pnpm exec tsx --test <file>` in apps/api), all pass:
  - billing-event-discount logic 6/6
  - billing-event-discount unit 4/4
  - line-event-discount logic 7/7
  - LIFF page 11/11
  - sales-event logic 15/15
  - process-line-webhook discount lane 6/6 (`--test-name-pattern`)
  - checkout-expiry source 3/3 and owner 2/2
  - paid-checkout-invoice 6/6
  - W00 capability manifest 4/4, no regeneration needed
- Focused web specs: billing-event-discount + sales-events.logic + action-loading 34/34.
- PG on a throwaway `postgres:18.3-alpine` (`sdany-pg`, 127.0.0.1:15561), fresh `prisma migrate deploy` including the new migration; container removed afterwards:
  - `billing-event-discount.pg.spec.ts` 2/2. Covers:
    - two events at one shop both succeed;
    - a same-event ticket from another batch is refused and the view says EVENT_ALREADY_USED with the event name;
    - the per-batch unique still refuses;
    - a REPEAT CARD_ONCE quote and Checkout take a new event's ticket at 44900.
  - `sales-event-discounts.pg.spec.ts` 13/13, updated for the dropped lifetime index.
  - `claim-event-discount.pg.spec.ts` 4/4.
- Native typecheck (scratchpad `api-typecheck.sh ... both`): API rc=0, WEB rc=0.
- Whole-chain acceptance (`node scripts/run-line-ai-whole-chain-acceptance.mjs` under the heavy lock), rerun after the last change: exit 0, 3,409 passed, 0 failed.
- GitHub Actions currently dies at startup (startup_failure), so CI evidence is local only.

Next: controller reviews the PR, runs every PG spec at merge, merges to develop and main, then deploys via the runbook release with the Owner. UAT check:
- An active one-time shop sees the choice box when it buys its next period, changes or upgrades.
- The same event is refused at the same shop.
- A new event works.
