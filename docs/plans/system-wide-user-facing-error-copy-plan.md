# System-wide User-facing Error Copy Plan

Status: COMPLETE — DEFAULT-OPEN FEATURES ONLY
Date: 2026-09-21
Spec: `docs/specs/system-wide-user-facing-error-copy-spec.md`
Audit: `docs/qa/system-error-message-audit-2026-09-21.md`
Mode: ponytail full — reuse the shared renderer and existing domain translators; no new framework.

## Implementation

1. Replace misleading generic 400/422, 409, 503, and permission fallbacks with neutral actionable
   Thai and pin them in the renderer tests.
2. Add reviewed stable-code and legacy-message mappings for the confirmed common-journey gaps:
   notifications, product catalog, ledger, Thai tax, CRM, LINE OA, AI, company/employee settings,
   expenses/reimbursements, and billing.
3. Complete coverage only for `DEFAULT_ENABLED_FEATURE_KEYS`: expenses, reimbursement, product
   catalog, CRM, LINE OA, dashboard/notifications, AI assistant, employee access, company settings,
   Thai tax, double-entry ledger, and workflow automation. Billing/renewal remains in scope because
   it is reachable without an entitlement switch. Public signup/onboarding is currently closed and
   remains out of scope.
4. Do not change procurement, bank reconciliation, reports, inventory-only, sales-document,
   data-rights, or feature-launch copy while those features are not default-open.
5. Expand source-derived coverage from the original launch modules to the in-scope modules and keep
   explicit exemptions only for identifiers proven not to be customer HTTP errors.
6. Run focused tests, web typecheck, and diff checks. Record any route that needs browser/runtime
   evidence without weakening its error contract.

## Scope Boundaries

- No raw server-message pass-through.
- No changes to validation, status codes, permissions, schemas, or workflow decisions.
- No translation package or dependency.
- Do not rewrite provider/log diagnostics; only customer rendering changes.
