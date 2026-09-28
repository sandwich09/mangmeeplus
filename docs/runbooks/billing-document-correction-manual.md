# Runbook: correcting a paid invoice's name/address/tax id manually

Status: written 2026-09-28 (purchase-without-setup PR E, not deployed). Stopgap only — the
automated "reissue" engine described in the original plan (`docs/plans/mangmee-purchase-without-setup-plan-th.md`
§P3 item 2, `DOCUMENT_REISSUE` operation, `BillingInvoice.kind/replacesInvoiceId/replacedByInvoiceId`)
was **not built**. The 2026-09-27 code review (see `docs/agent-memory/purchase-without-setup-2026-09-26.md`,
"Review 2026-09-27") found the evidence-chain risk too high to ship inside this program: a reissue
credit note can be misread as a refund by the reconciler, which holds/reviews/blocks a later
purchase, and the legal-identity permission and pending-operation-slot interactions were not fully
worked out. That work was parked to a future, separate spec (`docs/specs/billing-document-reissue-spec-th.md`,
not yet written). Until that spec ships, correcting a wrong company name/address/tax id **on a
document Stripe already issued** is a manual Stripe Dashboard procedure, done by someone with
Stripe Dashboard access — not something this admin console can do. (The console's own
"แก้ไขข้อมูลจดทะเบียน" form, shipped in this same PR E, corrects the company's *record* — the
`Company`/legal-identity row used on *future* documents. It does not touch a document already
issued. Use this runbook only for a document that already went out with wrong details on it.)

## When to use this

A customer's paid invoice or receipt already carries the wrong registered name, address, or tax id
— usually because they had not set up their company profile before buying (self-service purchase
without setup: Stripe's own Checkout-collected name/address/tax id was wrong or incomplete), and
they need a corrected document to file, not just an updated record for next time.

Do **not** use this runbook for:
- A wrong document **recipient email** — use the admin "เปลี่ยนอีเมลผู้รับเอกสาร" tool on the
  invoice page instead (PR E, this same release): it resends existing documents to a new address
  without touching the documents themselves.
- A document that has not been sent yet, or an amount/quantity error — those are ordinary Stripe
  support paths, not this one.
- A refund — decide the refund question first (see the pre-checks below); this runbook is about
  reissuing a *correct* document, not returning money.

## Pre-checks (do these before touching Stripe)

1. **Confirm the company's registered-name/tax-id/address record is now correct** in the admin
   console first (`/system/partners/:id` → "แก้ไขข้อมูลจดทะเบียน", or the customer's own profile
   page). Reissuing a document before the underlying record is fixed just produces a second wrong
   document.
2. **Decide the refund question first.** If there is any chance this purchase will also need a
   refund (not just a corrected document), do the refund *before* the reissue, not after. A refund
   issued against a credit-noted/replaced invoice is harder to trace, and the existing admin refund
   tool assumes it is refunding the invoice customers can still see as "the" invoice for that
   purchase.
3. **Check for an in-flight restart on this company's subscription.** The evidence-chain review
   above flagged that a reissue during a restart (`RESTART` purchase-kind) can leave the restart's
   own evidence checks unable to find the invoice they expect. If the company has a purchase or
   restart operation in progress (`/system/billing/companies/:id` → operations list shows anything
   non-terminal), wait for it to finish or fail first.
4. **Tell the team before doing this** (not a solo action): post in the usual ops channel with the
   company, invoice, and reason. This is a manual, unaudited-by-the-app action — the only record of
   it living in Stripe's own dashboard history plus whatever you write in the ops channel and the
   support case. Add an internal note on the support/package-change case referencing what you did,
   since the admin console cannot show a manual dashboard action in its own timeline.

## Procedure

All of this happens in the Stripe Dashboard, in the account's live or test mode matching the
invoice (check the mode badge before doing anything — this codebase runs both TEST and LIVE Stripe
accounts side by side).

1. **Open the original paid invoice** in the Dashboard (Customers → the company's Customer → the
   invoice), and confirm the amount, currency, and customer match what you expect before changing
   anything.
2. **Issue a credit note against it, out of band, with no customer email.** The credit note's
   reason should record that this is a document correction, not a refund — it must not move money
   (no "Refund" line, only a "credit balance" or straight void-equivalent adjustment as Stripe's
   current credit-note flow offers) and it must not trigger Stripe's own customer-facing email
   (Stripe's credit-note API distinguishes an out-of-band credit note that carries no `email_type`
   from one that emails the customer — pick the out-of-band, no-email option). If the Dashboard
   only offers a refunding credit note for a paid invoice, stop and get engineering to do this via
   the API's out-of-band credit-note path instead of forcing it through the Dashboard.
3. **Create the replacement invoice** for the same company/customer, with the corrected name,
   address, and tax id already applied to the Customer record (this is why the pre-check above
   matters — set the Customer's own name/address/tax id fields before creating this invoice, so it
   is correct on this new document too, not just in this app's database).
   - Same line items, amount, and currency as the original.
   - Mark it **paid out of band** (it is not collecting a new payment — the money already came in
     on the original invoice).
   - Set its **effective/period date to match the original invoice's date**, not today's date. The
     customer already paid on the original date; the replacement should read as what they should
     have received then, not a new purchase.
   - If the company has a tax id on file, set the Customer's `tax_ids` to include a `th_vat` entry
     with that number before finalizing, so it prints on the new invoice.
4. **Send the replacement invoice/receipt to the customer's current document recipient** (check the
   admin invoice page's "เอกสารและผู้รับเอกสาร" panel for the current recipient before sending —
   do not assume it is the account owner's email; this program's whole point was making that not be
   a safe assumption).
5. **Record what you did** — the ops channel post from the pre-checks, plus an internal note on the
   relevant support case (`referenceKind: 'invoice'`, the *original* invoice's id, so a later "เปิด
   รายการ" click still finds the right thread) saying a manual replacement was issued in Stripe, its
   new invoice/receipt id, and the date.

## After this program's reissue spec ships

Once `docs/specs/billing-document-reissue-spec-th.md` exists and its engine is deployed, this
runbook becomes historical — delete or fold it into that spec's own operational notes rather than
maintaining two procedures for the same problem.
