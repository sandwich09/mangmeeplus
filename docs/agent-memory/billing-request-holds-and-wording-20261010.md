# Agent Memory: billing request holds and wording — 2026-10-10

Status: merged to `main` and `develop`; not on UAT (both UAT hosts were stopped by the owner at 19:32 on 2026-10-10) and not on Production.

Owner: controller session of 2026-10-10 (owner's word after the 14:06 release: "ทำที่เหลือต่อเลย").

Scope: the follow-ups left open by the PromptPay QR refund release, and what reviewing them turned up in the same class.

## What was wrong

1. **A dispatched refund request the provider never created stayed `UNKNOWN` for ever.** After its ten-minute expiry every worker pass stopped at `CONTROL_PREVIEW_STALE`, after 23 hours at `CONTROL_REFUND_AGED_UNKNOWN`; no staff action ended it; `pendingRefund` then held the company's other refunds and, through `assertNoPendingRefund` in quote and checkout, the shop's own purchases. Two UAT test shops were in that state after the morning's rejected attempts.
2. **An Admin recipient e-mail change the provider never applied was recorded as a success.** A dispatched request whose `POST /customers/{id}` had an unknown outcome read back the previous address on the next pass, skipped the send (`if (!journal.dispatchedAt)`), and fell through to the success write: `SUCCEEDED`, `recipientEmail` set to the new address, "changed" notices queued, the provider still holding the old one. Proven by a test against the unchanged code before the fix (`actual: 'SUCCEEDED'`, no POST sent).
3. **A request never sent to the provider kept holding the shop after it expired.** `pendingAdminRecipientChange` counted `PREVIEW`, `AWAITING_APPROVAL`, `QUEUED` and `BLOCKED` with no regard to expiry, and quote, checkout and status read it (`BILLING_EMAIL_UPDATE_PENDING`): an Admin draft left open stopped the shop buying until somebody cancelled it. The same for a refund approved but not dispatched before its expiry.
4. **Wording that was not true in every case.**
   - The purchase review said "ชำระสำเร็จแล้ว ใช้งานได้ N เดือน" before anything was paid.
   - A shop holding an event discount it cannot use now was told "ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ" / "ต่ออายุด้วยบิล QR ทุกงวด" by renewal mode alone, also when its renewal was switched off.
   - A shop with an unpaid renewal was told on LINE that it can use its discount now, with the package button, while the package page opens no purchase for it.
   - The renewal panel said "ต่ออายุอัตโนมัติเปิดอยู่" to a one-time shop with a prepaid package waiting.

## Decisions

- **No new screen and no staff button for the stuck requests: the worker ends them from provider facts.** A dispatched request ends as `FAILED` one hour after its `expiresAt` when the provider does not hold its result (`CONTROL_REFUND_NOT_CREATED`: the complete list of the invoice's credit notes has none of this operation; `CONTROL_RECIPIENT_NOT_CHANGED`: the customer's address is not the target). Why one hour after expiry: the dispatch step refuses every send once `expiresAt` has passed, so nothing is in flight an hour later and nothing will be sent again. The review case stays open; `run` is not offered; staff start a new request. The 23-hour rules of these two commands are gone (unreachable).
- **A recipient change finishes only on a readback equal to the target.** While the request is still valid it is sent again with the same idempotency key.
- **A request never sent holds nothing once it has expired** (both guards). A dispatched one holds until it ends, whatever its age. The expired row stays visible and cancellable.
- **A sentence states only what the code has in hand.** `BillingEventDiscountView.renewalState` (`RUNNING` | `STOPPED` | `UNPAID`, optional) is set by the API from the account columns `status()` reads; web and LINE choose the same words from it (LINE adds "ค่ะ"); absent means the general sentence. `STOPPED` says the state, not who closed the renewal. The three Admin sentences for an ended request say "คำขอนี้จึงไม่ได้คืนเงิน" / "อีเมลผู้รับเอกสารตอนนี้ไม่ใช่อีเมลใหม่ตามคำขอนี้" instead of claiming more than the check knows.

Specs carrying the rules: `docs/specs/mangmee-billing-controls-spec-th.md` (refund note of 2026-10-10), `docs/plans/purchase-without-setup/pr-e-admin-tools.md` (recipient note), `docs/specs/sales-event-discounts-spec-th.md` §8.1 (the surface × case table), `docs/specs/mangmee-line-web-billing-ui-spec-th.md`.

## Open questions

- **Other billing commands still carry a 23-hour "review" rule** (`billing-collection.ts`, `billing-price-return.ts`, `billing-free-days.ts`, `billing-repeat.ts`, `billing-admin-collection.ts`, the customer's own e-mail change in `billing-email-recipient.ts`). Not read for this class in this round. Known from the lane's reading only: the customer e-mail change keeps `activeEmailOperationId` after 23 hours, which holds the shop's purchases. Each needs its own end rule; propose one audit round.
- **Still waiting with a review case, by design:** a dispatched refund whose local customer, charge or invoice ids changed after the dispatch; one whose provider read keeps failing or returns several or foreign matches.
- **LINE's "you can use your discount" does not look at the other purchase blocks** (an open checkout, a refund under review, a pending collection, sales closed). Only the unpaid renewal was closed here, because the view already carried that fact.
- **Rows already `BLOCKED` with `CONTROL_RECIPIENT_AGED_UNKNOWN`** (none exists on Production; UAT not read) are released by the new guard when expired and undispatched, and end by the new rule on their next run when dispatched; the worker does not pick `BLOCKED` rows up by itself.

## Artifacts

- Branch `claude/billing-followups-20261010` (six commits: three lanes and their second rounds).
- Production read of 2026-10-10 20:14, aggregates only: one refund operation ever (`SUCCEEDED`, 2026-09-23), no recipient change, no company held. The fixes are preventive.

## Verification

See the PR body for the commands and counts of this branch (GitHub Actions is in `startup_failure`, so the gate was run locally).

## Next

1. When the owner starts the two UAT hosts: read-only preflight, deploy, then watch the two stuck UAT refund operations end by the worker's next pass and confirm those shops can request a refund and buy again.
2. UAT, with the owner's sign-in: the review sentence, the held-discount note for a switched-off shop, one LINE turn "ฉันมีส่วนลดไหม" from a QR-bill shop.
3. Production only on the owner's explicit go.
