# Agent Memory: sales-event discount — first bill of CARD_AUTO / PROMPTPAY_RENEW (SD-O13) and choosing which discount (SD-O14)

Status: implemented on `claude/sales-event-discount-card-auto-20260929` (from develop `9499acb4`); PR to develop open, not merged, not deployed.
Owner: Claude subagent for the controller session (2026-09-29).
Scope:
- SD-O13. The controller told the Owner that the automatic-renewal first-bill discount was tomorrow's work. Owner, verbatim: "ต้องทำเลยเผื่อลูกค้าเลือกตัดบัตร เราต้องเอาเงินไว้ก่อน".
- SD-O14, added mid-task by the controller. Owner UAT report, verbatim: "ร้านที่มีส่วนลดอยู่แล้วจาก event 2 ยังไม่ได้ใช้ พอกดสแกน event 3 และมาหน้าจอจ่ายเงิน และส่วนลด กลับไม่เจอ ส่วนลดจาก event 2". The buyer now picks which held discount a payment uses.

Decisions:
- Which purchases take the discount:
  - `eventDiscountPurchase`: one-time modes take every kind in `KINDS`, as before. CARD_AUTO and PROMPTPAY_RENEW take INITIAL and RESTART only (`FIRST_PERIOD_KINDS`).
  - Never discounted: REPEAT and UPGRADE on a running subscription, every renewal, ADVANCE_DEAL, deals and add-ons.
  - A one-time shop mid-package cannot switch to a renewing mode at all (the quote refuses the mode change), so there is no conversion payment to discount. The web keeps the old note and the "เลือกจ่ายครั้งเดียว" button there.
- `EVENT_DISCOUNT_MODES` became `EVENT_DISCOUNT_ONE_TIME_MODES`. It is used only by `eventDiscountPath`, where a PAID_CURRENT_MODE auto-renewing shop stays on CREDIT.
- One predicate, `eventDiscountCardAuto(snapshot)` (CARD_AUTO + `eventDiscount.choice = 'USE'`), routes the attempt everywhere PROMPTPAY_RENEW goes:
  - `paymentCheckoutSnapshot` and `setup_future_usage`;
  - reconcile routing, import (both the first-period invoice and a bound subscription's renewal invoice), retry, and the `reconcileOneTime` mode check;
  - the held `activeAttemptId`, the bind call, the $0 skip;
  - the collection and status trial predicates, and the checkout-expiry session mode.
- `bindPromptPayRenewal` keeps its name and takes `intent`. The card branch:
  - uses bindAdvanceDeal's card checks;
  - refuses any other collectible subscription;
  - uses idempotency key `mm:{attempt}:card-renewal`;
  - on a mismatched or early-invoiced card trial of ours, cancels it (`invoice_now: false, prorate: false`) before throwing, so it cannot charge unattended;
  - allows only $0 invoices created before `paidThrough` (a late bind may already see its first renewal).
  - The PromptPay branch is unchanged: same checks, key and journal field (`qrSubscriptionRequestedAt`, shared by both).
- Purchase source: `billingPurchaseSource`'s binding window and `BillingService.purchaseSource`'s `attemptBound` now include CARD_AUTO without a subscription.
- Untouched: `paid-invoice.ts`, `billing-schedule.ts`, `paid-checkout-invoice.ts` (it already reads `eventDiscountExpected`), and everything in spec §5.4. No flags, no coupons.
- SD-O14, the choice between held discounts:
  - `BillingStatus.eventDiscount.tickets` (optional, additive) lists every usable ticket, best first, each with the cards it lowers. Tickets that lower no card are dropped.
  - The quote takes `eventDiscountTicketSerial` with USE. None = the best ticket for the card, as before. A serial it cannot use → `SALES_EVENT_TICKET_UNAVAILABLE`; it never swaps tickets silently.
  - Web: one radio row per ticket, the first chosen by default (web state `null` = default), then "ไม่ใช้ครั้งนี้", then the line "ใช้ได้ครั้งละ 1 ส่วนลดต่อการจ่าย ส่วนลดที่ไม่ได้เลือกยังเก็บไว้ใช้ครั้งถัดไปได้". Card lines follow the pick.
- Wording:
  - The confirm step for a renewing mode adds "รอบถัดไป {ราคาเต็ม} ตัดบัตรอัตโนมัติวันที่ {วันที่}", or for QR "รอบถัดไป {ราคาเต็ม} วันที่ {วันที่}", plus "ส่วนลดใช้กับบิลแรกเท่านั้น งานเดียวกันใช้ได้ร้านละครั้ง".
  - LINE adds "ถ้าเลือกตัดบัตรอัตโนมัติหรือสแกนบิล QR ทุกงวด ลดเฉพาะบิลแรก รอบต่อไปคิดราคาเต็มค่ะ", and says "เลือกได้ตอนจ่ายว่าจะใช้ส่วนลดไหน (ครั้งละ 1 ส่วนลด)" when more than one ticket is usable.
  - An auto-renewing shop keeps "ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ ส่วนลดจากงานยังใช้กับรอบตัดเงินอัตโนมัติไม่ได้ค่ะ".

Open questions:
- UAT native proof (spec §14) is still owed:
  - one-time Checkout with `setup_future_usage` saves the card;
  - a test clock to the period end charges the full price, and it applies as RENEWAL;
  - a declined card after the trial goes to grace;
  - "หยุดต่ออายุ" while trialing.
- Rollback (spec §11): count CARD_AUTO accounts whose `activeAttemptId` points at a USE attempt (binding pending) before any rollback. An old binary cannot stop the trial.
- Pre-existing, out of scope: `billing-checkout-expiry-source.ts` expects a `subscription` session for a CARD_AUTO advance-deal attempt, whose Checkout is a payment session. The customer's cancel button would refuse that deal Checkout. Not changed here.
- `ci.yml` changed (one registration line). The main sync PR must carry the same blob.

Artifacts:
- API:
  - `billing-event-discount.logic.ts`
  - `billing-event-discount.ts`
  - `billing.service.ts`
  - `billing-reconciler.service.ts`
  - `billing-collection.ts`
  - `billing-purchase-source.ts`
  - `billing-checkout-expiry-source.ts`
  - `billing.dto.ts`
  - `billing.controller.ts`
  - `line-event-discount.logic.ts`
- Contracts: `packages/contracts/src/billing.ts` (`eventDiscount.tickets`).
- Web:
  - `BillingPage.tsx`
  - `billing-event-discount.ts`
  - `billing.api.ts`
  - `api-error-message.ts` (`SALES_EVENT_TICKET_UNAVAILABLE`)
- Tests:
  - new `billing-event-discount-renewal.pg.spec.ts` (3 cases), registered in `ci.yml`;
  - updated `billing-event-discount.pg.spec.ts`, logic, purchase-source, checkout-expiry-source, collection, application, paid-checkout-invoice, LINE and web specs.
- Docs: spec SD-O13/SD-O14 rows, §0, §4.1.1, §4.3, §5.2/§5.3 status, §7.2, §7.3, §8, §8.1, SD-E06, SD-E32; plan §5 status row.

Verification (2026-09-29, worktree `/private/tmp/mangmee-sd-cardauto-20260929`):
- Native typecheck (scratchpad `api-typecheck.sh … both`): API rc=0, WEB rc=0.
- Focused API unit specs (`pnpm exec tsx --test`), all pass:
  - logic + purchase-source + checkout-expiry-source + collection 22/22
  - application event-discount 5/5
  - LINE event-discount 7/7
  - paid-checkout-invoice 6/6 (expectation flipped for a renewing first bill, REPEAT still refused)
  - body-validation + checkout-expiry-owner + price-return + refund-source + schedule + paid-invoice-promptpay green alongside
- Web: billing-event-discount + api-error-coverage + action-loading 25/25.
- PG on a throwaway `postgres:18.3-alpine` (`sdauto-pg`, 127.0.0.1:15577), fresh `prisma migrate deploy`:
  - new renewal spec 3/3. Mutation-checked: reverting the $0 skip, or the purchase-source window, fails case 1.
  - existing `billing-event-discount.pg.spec.ts` 2/2
  - `sales-event-discounts.pg.spec.ts` 13/13
  - advance-deal + purchase-source + grace PG 20/20 (0 skipped)
- Whole-chain acceptance (`node scripts/run-line-ai-whole-chain-acceptance.mjs`, under the heavy lock): exit 0, 3,412 passed, 0 failed.
- GitHub Actions dies at startup (startup_failure), so CI evidence is local only.

Next: controller review → merge to develop → main sync PR (same `ci.yml` blob) → UAT with the §14 test-clock proofs → Owner acceptance.
