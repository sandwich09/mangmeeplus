# Agent Memory: paid purchases repair themselves; a failed deal price return is tried again — 2026-10-10

Status: merged to `main` and `develop`; NOT deployed (owner, 2026-10-10 about 21:20: "ยังไม่ต้องดีพอย"). UAT hosts were stopped by the owner at 19:32.

Owner: controller session of 2026-10-10.

Scope: the two decisions left open by the audit of the same evening (`docs/agent-memory/billing-unknown-outcome-audit-20261010.md`, "Open questions" 1 to 4).

## Decisions (the owner's, in his words)

1. **A deal price return that ended failed:** "ข้อแรกเอาตามแนะนำ" — the system tries it again by itself, once a day, until it succeeds.
2. **A paid purchase whose step after payment is stuck:** he chose option "ค" of three ("เอา ค. ตามแนะนำ") — the system repairs it by itself (it asks the provider whether the next-round set-up of that purchase exists; if not, it sends the set-up again until it succeeds, then releases the shop) AND staff can refund as the backup. He was told: nothing is charged beyond what the shop chose when it bought.

## Rules built (they extend R-A … R-E of the audit)

- **P-1 Read first, every pass.** The complete list of what the step creates or changes is read before anything is sent. There → the existing success path at any age. More than one object of the attempt, or an unknown shape → nothing is sent, the review case stays.
- **P-2 / P-3 Generations.** A send keeps its idempotency key for one hour from its first send; after ten quiet minutes the next generation goes out under a new key (`<key>:g<n>`), journalled in a guarded transaction before the send. One new generation per seventy minutes at most, no limit on their number. Why a new key: a key that stored a 5xx replays it for its life.
- **P-4 A refusal is only a 400 or a 402** that is not an idempotency error (the test PR #1071 uses for a refund create). It sets a refused marker and stops the generations. A 401, 403, 404, 409 or 429 is not a refusal and is retried.
- **P-5 A refund stops the repair** (`refundStopsBinding`, one definition for every flow): refunded money on the attempt's invoice, or a refund request on it that is not cancelled, failed, or expired unsent.
- **P-6 The boundary.** QR bills and the prepaid card: when the paid period ends within the hour or is over, no subscription of the attempt is listed and no send can be in flight, the binding is over — the slot is cleared and the stored renewal mode becomes the one-time mode of the same payment method (with only the slot cleared, `billingPurchaseSource` answered `SOURCE_INCONSISTENT` and the renewal line would have claimed a renewal). No provider call.
- **Staff refund as the backup.** `unrepairableBinding` (one predicate for refund review, preview, `current`, and both end-package checks): only the invoice of the account's active attempt, never a repeat purchase, and only when (a) the refused marker is set, or (b) an advance deal is at its boundary with no send in the last hour ten. Its pin is hashed into the proposal, so the request goes stale when the marker goes, a subscription binds or the slot moves. After a full refund the next pass releases the shop (QR bills / prepaid card: `endUnboundRenewal`; advance deal: the existing `cancelAdvanceDeal`). A partial refund of a QR / card purchase releases nothing and the staff page says so.

## What was built, per flow

| Flow | Proof on unchanged code | Now |
|---|---|---|
| Deal price return ended `FAILED` | The sweep queued nothing (its create hit the unique key and was swallowed) | A failed return at least 24 h old gets a new operation (key `…:<attempt number>`), the failed row becomes `SUPERSEDED`; no row while the account is not ready (slot held, plan change pending, boundary under two hours, deal no longer applied, subscription differs); a real refusal ends `SPECIAL_PRICE_RETURN_REJECTED` and is not retried; success resolves every attempt's review case |
| Renewal binding after payment: QR bills every period, prepaid card | `billing.promptpay_renewal_request_unknown` for ever from 23 h | Generations until the provider holds the subscription; boundary ending; refund backup |
| Renewal binding after payment: advance deal | The key stayed `…:advance-renewal` (the for-ever throw itself was read, not reached by the spec) | Generations; at its boundary, or refused: staff refund |
| Repeat purchase, nothing paid: profile write or Checkout never reached the provider | `'UNKNOWN' !== 'FAILED'`, subscription left paused (`pause_collection`) | From one hour ten, with nothing of the attempt at the provider, the existing `abort()` un-pauses the subscription and the attempt ends `FAILED` |
| Repeat purchase, paid: schedule create / update, resume | `'PENDING' !== 'APPLIED'` | Generations per step; `apply()` when the provider shows the whole target shape |

The package page's line for a paid purchase whose next round is not set up yet now reads "ชำระแล้ว การตั้งรอบถัดไปยังไม่เสร็จ ไม่ต้องชำระซ้ำ" (it used to say the team was checking).

## Open questions

- **A repeat purchase the provider refused after payment has no refund backup:** its unwind needs a schedule revert nobody has built; it keeps its review case and holds the slot.
- **A repeat purchase whose bought period is itself over** (`apply()` refuses): the slot is held and the subscription stays paused; a correct ending needs an un-pause and a refund.
- **An advance deal is cancelled by any refunded amount** (existing `cancelAdvanceDeal`), also a partial one.
- **A refused deal price return** (`SPECIAL_PRICE_RETURN_REJECTED`) has no staff action to queue it again. **`DEAL_SUBSCRIPTION_CANCEL`** re-sends its `DELETE` under one key with no bound and holds the slot until it succeeds.
- A full refund without "end package" leaves a refunded, still-running one-time period (believed to be how any refunded one-time invoice behaves; not run).
- From the earlier rounds: a bare schedule left by a create whose update never applied; staff add-days after a term drift; an unlinked Customer after a lost create; LINE's "you can use your discount" and the other purchase blocks.

## Artifacts

- Branch `claude/billing-paid-self-repair-20261010`.
- Production read of 2026-10-10 22:45, aggregates only: no sales deal exists; no deal-end operation; three purchase attempts ever. Everything here is preventive.

## Verification

See the PR body (GitHub Actions is in `startup_failure`; everything was run locally).

## Next

1. Deploy to UAT only when the owner says so; then, with the fake provider gone, the proofs owed: one QR-bill purchase whose binding is made to fail, one refund of a refused binding, one repeat purchase.
2. The open questions above, in the order the owner chooses.
