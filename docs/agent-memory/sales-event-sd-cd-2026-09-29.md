# Agent Memory: sales-event discounts SD-C + SD-D (MVP)

Status: implemented on branch `claude/sales-event-sd-cd-20260929` (not pushed); one-time purchases only.
Owner: controller session (sales-event program); this worktree `/private/tmp/mangmee-sales-event-sd-cd-20260929`.
Scope: first-bill discount at quote, Checkout and paid apply (SD-C) and the package-page choice (SD-D) for CARD_ONCE and PROMPTPAY_ONCE purchases of kind INITIAL/RESTART. Merged SD-A e7ab6a4a + 3ffdb3e8 (includes SD-B 6bbfef83) and SD-E contracts 34b19615.
Decisions:
- Discount math is SD-A's `eventDiscountUnitAmountSatang` + `SALES_EVENT_MIN_UNIT_AMOUNT_SATANG` + `scopeFromJson`; `billing-event-discount.logic.ts` only wraps it (amounts, eligibility, pick, stale rule, validator expectation).
- The page reads its offer from `BillingStatus.eventDiscount` (status route is already in the locked-shop allowlist), so no new route, no `auth.guard.ts` change and no pins sync here. SD-B owns `GET …/billing/event-discount`.
- `EVENT_DISCOUNT_REVIEW` is raised with SD-E's `BILLING_EVENT_DISCOUNT_REVIEW_ISSUE`, referenceId = invoice id (controller 2026-09-29).
- No gate or flag (Owner: the batch is the control). No new error code: Checkout uses the existing `BILLING_QUOTE_STALE`.
Open questions: none blocking. Renewing modes (CARD_AUTO, PROMPTPAY_RENEW) follow spec §5.3 — see plan SD-D "TODO ต่อจาก MVP".
Artifacts: `apps/api/src/modules/billing/domain/billing-event-discount.logic.ts` (+ spec), `apps/api/src/modules/billing/application/billing-event-discount.ts`, `apps/api/src/modules/billing/billing-event-discount.pg.spec.ts`, `apps/web/src/features/billing/billing-event-discount.ts` (+ spec); edits in `billing.service.ts`, `billing-reconciler.service.ts`, `paid-checkout-invoice.ts` (expected amounts only), DTO/controller, contracts `billing.ts`, `BillingPage.tsx`, `billing.api.ts`, `ci.yml`, whole-chain catalog, plan.
Verification: see the final handoff (commands and counts are recorded there and in the plan's MVP note).
Next: renewing modes (spec §5.3 items 1–6), history line `eventDiscountSatang`, expired/suspended texts, HTTP smoke, e2e at 390 px, reconcile-level PG evidence.
