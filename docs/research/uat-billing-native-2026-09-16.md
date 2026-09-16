# Native UAT billing acceptance — 2026-09-16

Scope: genuine company-owner Chrome Developer session → UAT application → actual Stripe Sandbox Checkout → signed webhook/worker → native return, rights and documents. This supplements the earlier fixture/CI proof; it does not mark all native provider/device cases complete. Production was unchanged. The owner has paused merging to batch further changes.

Serving source `7ccff81178e547817d5d21571aa88ee2dde94628`, UAT operation `20260916T103914Z-350853d8`, TEST billing settings version1. The new branch `codex/uat-billing-native-20260916` is based on main `2221b24df9dde13378e4bb204e805c7e2421965c`. Its copy changes are not deployed. [Prior CI/release](../agent-memory/billing-single-admin-2026-09-16.md) and [bounded native evidence](../evidence/uat-billing-native-2026-09-16.json).

| Case | Observed result | Status |
| --- | --- | --- |
| Legacy company without a plan term/account | Quote rejected before Stripe I/O; no quote/account was inserted. Existing page used a generic unresolved-result message and implied a review was underway. Specific recovery copy and accurate missing-tier label are now a local fix. | Backend guard PASS; local UI fix typechecked, deployed browser acceptance pending |
| Trial → Starter monthly | Quote249THB,VAT0,30receipts, immediate start and discarded remaining trial days. Actual Stripe page visibly identified Sandbox. | PASS |
| Insufficient-funds card | Stripe rejected payment. Independent application read retained trial,3remaining receipts and original expiry. Recovery used the same Checkout. | PASS |
| Successful card → rights | Native return automatically showed Starter,30receipts and16October expiry. One invoice, one grant; subsequent return/reload did not add another grant. | PASS |
| Invoice and receipt | Actual Stripe invoice FAZ5SA7A-0001 and receipt2500-2831 showed249THB paid. PDF actions were present, but PDF bytes/rendering were not tested. | Hosted pages PASS; PDF not run |
| Repeat full package | Quote showed30additional receipts,60total and16October→16November. Successful Sandbox payment returned through paid/pending to active60. Existing base subscription retained, both paidThrough and nextCharge moved to16November. | PASS |
| Web/LINE billing notices | Both invoices have SENT delivery records, one attempt each. LINE provider accepted requests. No claim that a person read them or completed a native LINE purchase. | Transport PASS; device journey not run |
| Postmark billing notice | First attempt CONFIG/uat_recipient_not_allowed; no provider submission. Durable outbox/issue records retained, without withholding paid rights. | Restriction verified; delivery blocked |
| Support metadata | Hosted receipt displays a sample US telephone number rather than the application's Thai support contact. | Sandbox configuration follow-up |

The first paid invoice applied8.248seconds after its provider payment timestamp; the repeat invoice applied13.235seconds after its payment timestamp. These are backend payment-to-apply intervals, not a frontend performance SLA. The repeat page showed a truthful pending state before the worker finished, then updated automatically.

Use [Stripe's official testing reference](https://docs.stripe.com/testing) for synthetic cards. No real payment credentials, full Checkout/receipt URLs, private email content or tokens are included in committed evidence. Read-only inspection uses bounded company-scoped queries inside `BEGIN READ ONLY`/`ROLLBACK`; no direct data repair was performed.

## Remaining acceptance and delivery boundary

- Billing email requires a recipient authorized for UAT, normal verification, and the existing reviewed resend path. Do not broaden mail access or change identity as a shortcut. Earlier real OTP delivery is separate evidence and does not prove these billing notices were sent.
- Correct Sandbox merchant support metadata before signing off customer-facing documents; no Production change is authorized by this proof.
- This run did not cover native annual purchase, tier changes, 3DS, due-date renewal, refunds/disputes, PDF rendering, or LINE iOS/Android handoff. Existing simulation/CI coverage remains separate.
- The legacy-company fix preserves the backend review boundary, tenant/owner checks and navigation/support exits. Only copy changed; the focused web typecheck passed. Native proof above uses the deployed source, not this local change.
- No new PR, CI, merge or deploy is dispatched while the owner is collecting additional changes. Keep the existing branch and evidence; resume delivery only on instruction.
