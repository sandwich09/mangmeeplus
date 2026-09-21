# Agent Memory: สมัครแล้วล็อก + Sales console + ดีลพิเศษ (ฉบับรวม)

Status: PHASE 1 IN REVIEW 2026-09-20 — PR #666 to develop open (branch codex/sales-deals-phase1-20260920, commit 02b7a15b); all local gates green; awaiting CI + admin-merge, then main sync PR.
Owner: thawatchai (product) / Claude controller; implementation to be delegated per phase.
Scope: no free trial (constant), new shops locked to settings+package until paid; Sales console (roles MANGMEE_SALES_LEAD / MANGMEE_SALES in the platform tenant, admin-created users with encrypted tax/bank data for external payroll/50ทวิ), sales deals with any price/months/limits/menus/AI budget → lead approval → offer card only on that shop's package page, valid 3 days → customer pays via Stripe one-time Checkout (card + PromptPay, auto-activate) or transfer+slip (admin verify); no access before payment; deal renewal by re-offer.
Decisions (Owner 2026-09-20): no trial going forward; existing trials run to their end; pay within 3 days; no provisional access; commissions outside the system; leads see all teams; deals can set everything.
Design: reuse PackageChangeRequest (kind SALES_DEAL) + special-invoice columns; one-time Checkout path (`billing-repeat.ts` shape) with a new DealSource for shops without subscriptions; `paid-checkout-invoice.ts` extended for promptpay; subscription evidence files untouched; shops with an active catalog subscription cannot take a deal (v1).
Open questions: none — D1–D7 and Q1–Q6 all decided 2026-09-20 (Q2: not VAT-registered yet, deal price = amount paid, VAT split follows billing policy later).
Artifacts: [spec](../specs/mangmee-sales-deals-and-locked-signup-spec-th.md) (register S01–S25), [plan](../plans/mangmee-sales-deals-and-locked-signup-plan-th.md); superseded: free-usage-close-toggle-plan-th.md, special-invoice-manual-payment-spec/plan, billing-special-price-spec/plan.
Verification: read-only discovery only; no tests run.
Next: watch PR #666 CI (ccd_pr), fix if red, admin-merge to develop, open the main sync PR from a main-based branch; then Phase 2 (Sales console) brief in a fresh worktree; owner still owes the marketing-site CTA copy change.
