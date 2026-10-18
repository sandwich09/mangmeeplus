# Agent Memory: billing commands after an unknown provider answer — audit of 2026-10-10

Status: merged to `main` and `develop`; NOT deployed (owner, 2026-10-10 about 21:20: "ยังไม่ต้องดีพอย"). UAT hosts were stopped by the owner at 19:32.

Owner: controller session of 2026-10-10. Owner's word for this round: "ทำเลย", after asking what the proposed audit was, how it would be fixed and what it would change.

Scope: every billing command that carried the rule "23 hours, then a human must look", read for three defect classes after the two commands fixed earlier the same day (`docs/agent-memory/billing-request-holds-and-wording-20261010.md`):
1. **Stuck for ever** — after a provider call with an unknown outcome the command never ends, nobody (shop or staff) can end it, and it holds the shop.
2. **False success** — a later pass records success although the provider never applied the change.
3. **Never sent, still holding** — a command that was never sent keeps holding the shop after it can no longer be sent.

## Rules decided (they are the same in every flow touched)

- **R-A** A command ends only from a provider read made in that same pass, never by elapsed time alone. A failed read waits. A read that shows the change runs the existing success path at any age.
- **R-B** A command the shop waits on is re-sent under its idempotency key for ONE HOUR from its first send (was 23 hours); from then on a pass only reads; from one hour ten minutes, when the read shows the change is not there, it ends as failed and stops holding the shop. Why not 23 hours: that was the life of the idempotency key, not a decision about how long a shop may be held, and a provider that stored a 5xx for a key replays it for the key's life.
- **R-C** A staff command cannot be sent after its ten-minute `expiresAt`; its bound is `expiresAt` + one hour.
- **R-D** Never sent and unable to be sent = over at once, and it releases what it holds. A "sent" marker is written only when the send really follows.
- **R-E** Ending sends nothing and repairs nothing at the provider. A case that needs a provider mutation to end correctly is NOT ended; it keeps waiting with its review case (list below).
- **Purchase attempt with no Checkout at the provider:** ends ten minutes after its last write, the shop's own cancel after 60 seconds, both only after the pass's own complete list of the customer's sessions found none of this attempt. Safe because the request is sent once and never re-sent, and a session created late cannot be paid by anyone: its address was never delivered.

## What was found and fixed

Every defect below was proven by a test that failed on the unchanged code before the fix, unless marked "read".

| Command | What was wrong | Now |
|---|---|---|
| New purchase, Checkout creation answered unknown, or the process died before sending | The attempt stayed `CREATING` / `REQUESTING` / `UNKNOWN` with no session id for ever; every pass threw `billing.checkout_unknown`; the shop could not quote or check out; "ชำระเงินต่อ", "ตรวจผล", "ยกเลิกรายการนี้" and the staff reconcile did nothing | `EXPIRED` / `BILLING_CHECKOUT_NOT_STARTED` ten minutes after its last write (shop's cancel: 60 s), slot, event discount and promotion right released. A repeat purchase is excluded (R-E) |
| Profile write before Checkout | Threw `billing.profile_sync_review` for ever at 23 h | Re-sent for one hour, then read; ends `FAILED` / `BILLING_PROFILE_SYNC_RETRY` from one hour ten |
| Shop's own change of the document e-mail, sent but not applied | `RECONCILING` for ever after 23 h, holding `activeEmailOperationId` (quote, checkout, document resend, card portal, staff change refused) | R-B: ends `FAILED` / `provider_email_not_target`, hold cleared, issue kept |
| Same, never sent | `BLOCKED` until the owner pressed cancel | Ends at once (`email_authorization_changed`); a provider read that fails before any send waits while the request can still be sent |
| Company-profile sync during a recipient change in flight | POSTed the old address over a change the provider had applied | The sync defers while a shop or staff recipient change is in flight |
| Shop stops / resumes renewal, schedules or cancels a downgrade (also the `DELETE` after `paidThrough`), sent but not applied | `UNKNOWN` for ever after 23 h, holding `activeCollectionOperationId`; the panel offered nothing | R-B: `FAILED` / `BILLING_COLLECTION_NOT_APPLIED` when neither the subscription nor its schedule carries the operation id and the source hash is unchanged |
| Same, started but never sent | `UNKNOWN` / `BLOCKED` with no action | "Sent" is the send marker, not `startedAt`; ends at once as `BILLING_COLLECTION_NOT_SENT`, no review case |
| Staff adds days | The send marker was stored although the authority check then refused the send: `UNKNOWN`, staff could not cancel | Marker kept only when stored with the check; never sent and expired ends `CONTROL_FREE_DAYS_NOT_SENT`; sent ends by R-C as `CONTROL_FREE_DAYS_NOT_APPLIED` |
| Staff pauses / resumes collection | `UNKNOWN` for ever from ten minutes on (a retry needs an unexpired request) | R-C: `CONTROL_COLLECTION_NOT_APPLIED` / `CONTROL_COLLECTION_NOT_SENT` |
| Deal price return | Never started: `BLOCKED` for ever holding the slot. Started: 23 h then stuck (read) | Never sent ends at once; sent: R-B, ends `FAILED` / `SPECIAL_PRICE_RETURN_NOT_APPLIED` only when the read still shows the deal price on the same item and no schedule |

No false success was found in these flows: every success write follows a provider read that shows the change. Read, not proven: while `activeCollectionOperationId` is set the reconciler runs the command and returns before any invoice is applied (`billing-reconciler.service.ts`, the branch before `observeBillingCharges`), so a stuck renewal command also stopped renewal payments from being applied locally until it cleared.

Screens: the shop's renewal panel and recipient panel, and the staff adjustment page, show an ended command with a sentence that states only what the read knows, and offer nothing for it.

## Open questions (next round — each needs a decision by the owner, because ending them needs a provider mutation or concerns money already paid)

1. **A failed deal price return is never tried again.** After `FAILED` the subscription keeps the deal price; the sweep's `queue()` reuses the unique key `deal-return:<deal>:<paidThrough>`, so no new operation is created (read, not run). Before this round the same return sat `BLOCKED` for ever and also held the shop. The shop keeps paying the deal price until someone acts. Proposal: let the sweep queue a new attempt under a new key.
2. **Paid, binding stuck (QR-renew bills, prepaid card).** The package is granted before the binding; only the next round is not set up; `activeAttemptId` stays, and a staff refund is refused. Completing it is `POST /subscriptions` under a new key after the list read proves none exists.
3. **Paid, advance deal binding stuck.** The deal period is not activated until the binding; same completion. A refund made at the provider is observed and releases it (read).
4. **Repeat purchase stuck.** The running subscription stays paused at the provider (`pause_collection`), so its renewal bills stay drafts. Before payment the existing `abort()` restores it once `abortRequested` is set; after payment the stuck step must be re-sent under a new key.
5. **A bare schedule left by a `from_subscription` create whose update never applied** (downgrade, add days): the source hash differs, so the command keeps waiting; ending it needs a schedule release.
6. **Staff add-days sent, then the term or `paidThrough` drifts:** the catch's own fence throws and the pass errors every time (read).
7. **A Customer the provider created after a lost answer stays unlinked;** after the key's 24 hours the next purchase creates a second one (cosmetic).
8. From the earlier round: LINE's "you can use your discount" ignores purchase blocks other than an unpaid renewal.

## Artifacts

- Branch `claude/billing-unknown-outcomes-20261010`.
- Production read of 2026-10-10 21:52, aggregates only: 2 billing accounts in all; none held by an attempt, a renewal command or an e-mail change; 3 purchase attempts ever. The fixes are preventive.

## Verification

See the PR body for the commands and counts (GitHub Actions is in `startup_failure`; the gate, the Postgres specs, the billing HTTP smokes and the browser specs were run locally).

## Next

1. Deploy to UAT only when the owner says so (hosts must be started by him first); then the proofs owed from the earlier round plus one walk of a purchase whose Checkout creation is refused.
2. The next-round decisions above.
