# Agent Memory: Billing profile setup reminder

Status: Implemented locally; pending CI and merge.
Owner: thawatchai + Codex
Scope: Show the existing billing-profile missing-field list and a link to shop settings on the package overview before purchase.
Decisions:
- Reuse `BillingStatus.billingProfile.missingFields` and `BILLING_PROFILE_FIELD_LABELS`; do not create a second required-field rule.
- Keep the existing purchase-time modal and API gate. The overview notice is advisory and does not block the page.
- This billing reminder is separate from TSIC and does not make business type, tax ID, or VAT answers purchase prerequisites.
Open questions: None.
Artifacts: `apps/web/src/features/billing/BillingPage.tsx`; billing profile spec and plan.
Verification: Not run yet.
Next: Review diff, then run repository CI through the PR before admin merge. No deployment.
