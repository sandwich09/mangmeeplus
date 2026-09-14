# Stripe refund and invoice-adjustment research

Status: developer research for the unfinished C08 controls; no refund implementation, provider mutation or financial policy approval in this note. Read official documentation on2026-09-14. Existing manual-review policy remains authoritative.

Stripe can refund part or all of an original payment, with aggregate refunds bounded by the original charge. Refunds return to the original payment method. An accepted card refund can remain pending when the Stripe balance is insufficient; refunds can also fail. Original processing fees are not returned. Therefore a submitted request must not be presented as money received by the customer. Stripe refund email delivery depends on customer/email configuration. [Refund lifecycle](https://docs.stripe.com/refunds).

The create API targets the original Charge or PaymentIntent and can specify an amount in the currency's smallest unit. Original provider identity must be resolved from verified local invoice/payment evidence, not supplied as arbitrary Admin input. Listing refunds provides a read path to reconcile original requests; metadata, pagination and current API-version fields still need a detailed implementation review. [Create refund](https://docs.stripe.com/api/refunds/create), [List refunds](https://docs.stripe.com/api/refunds/list), [Refund object](https://docs.stripe.com/api/refunds/object).

A credit note adjusts a finalized invoice while preserving the original invoice. Stripe recommends associating credit with original invoice line items. Credit amounts and invoice limits constrain subsequent adjustments. This document is distinct from the card refund's banking outcome. [Invoice credit notes](https://docs.stripe.com/invoicing/dashboard/credit-notes).

The credit-note API can create a refund through `refund_amount` or associate existing refunds through `refunds`; it can also credit customer balance or record an outside payment. Those components must match the post-payment adjustment. These alternatives must not become independent retry actions for the same intended refund. [Create credit note](https://docs.stripe.com/api/credit_notes/create).

Implementation implications to resolve in spec/plan before code:

- Prefer one original invoice/command identity with separate money, document and entitlement observations. Never implement “refund” as reversing an APPLIED flag or deleting receipt grants.
- Decide and document whether the approved command issues a credit note with its refund, or links an existing observed refund. Preserve original invoice lines/tax treatment; reject unsupported credit-balance/outside-payment paths rather than inventing evidence.
- Retain PREVIEW/approval/source/permission/lease boundaries, original command lookup, bounded provider reconciliation and ambiguous-response recovery. A lost response must not mint another refund or credit note.
- Surface pending/failed/canceled/refund-review states, dispute conflicts and accounting-document gaps with original case links. Failed financial execution and support contact are distinct outcomes.
- Existing commercial refund eligibility remains manual review. Monetary thresholds or automatic entitlement revocation are not selected by this research. No Thai tax-law compliance conclusion is made here.
