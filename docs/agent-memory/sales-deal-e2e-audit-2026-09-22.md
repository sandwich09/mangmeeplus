# Agent Memory: sales-deal-e2e-audit-2026-09-22

Status: P1/P2 FIXED LOCALLY — UAT conversion evidence still pending a disposable fixture
Owner: Codex
Scope: Verify the implemented sales-agent → special-deal → approval → customer-payment journey against the running local system and source contracts; fix the discovered active-CARD_AUTO conversion and company-preselection gaps without changing UAT or production state.
Decisions: Treat source specs and runbooks as product truth. User authorized the existing Q7 choice: a healthy CARD_AUTO subscription converts to a one-time deal with no proration; the payment applies first, then a durable observed/retry operation cancels the old subscription. UAT is Stripe test mode, but creation of a user and final payment action still require explicit confirmation; the temporary-password change must be performed by the user under computer-use policy.
Open questions: User confirmation to create a disposable UAT sales account and a dedicated UAT customer in NO_PACKAGE/TRIAL/expired state; conversion still needs Stripe test-mode evidence.
Artifacts: `docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md`; `apps/api/src/modules/billing/application/billing-deal-subscription-cancel.ts`; `apps/web/src/features/sales-console/SalesCompaniesPage.tsx`; `e2e/sales-console.spec.ts`.
Verification:
- Read UAT cloud and deployment protocol. UAT is serving and the payment configuration reports test mode/no real charges.
- Browser UAT: SYSTEM_ADMIN reached `/system/sales-team` (empty sales-team list), `/sales/deals` (empty), `/sales/deals/new` (full form), and verified client-side required errors for shop, amount, and internal reason.
- Browser UAT: sales-company search returned only currently active test tenants; no safe no-package deal fixture was found. `WatchDog UAT` is active on STARTER.
- Focused checks passed: API sales-deal/deal-offer/package-request/price-service tests and web sales-console/billing-deal tests (all dot-reporter cases passed).
- After the fixes: API and web typecheck pass; focused cancellation observation and sales-console QA/logic/billing-deal tests pass.
- Coverage inspection: `e2e/sales-console.spec.ts` finishes at lead approval; there is no end-to-end test that covers approved deal → OWNER billing card → card/PromptPay Checkout → webhook/reconciler → APPLIED/unlocked.
- Findings: (Resolved P1 locally) an active healthy CARD_AUTO subscription can now open card/PromptPay modes for an approved deal; quote and Checkout revalidate its snapshot, payment applies the deal, and `DEAL_SUBSCRIPTION_CANCEL` cancels the old subscription with observed/retry handling. (Resolved P2 UX) `/sales/companies` “สร้างดีล” now carries the chosen company into the new-deal form, which re-reads the limited audited search row before selecting it. (Resolved P2 docs) the sales-deal spec, plan, and current memory state that customers pay by Stripe card or PromptPay only; no transfer or slip path.
Next: With confirmation, create a disposable UAT sales account; user completes its mandatory temporary-password change; then use a dedicated active CARD_AUTO customer to exercise submit/approve/payment/conversion and collect the old-subscription cancellation observation.
