# Agent Memory: Package entitlement consistency 2026-09-11

Status: Spec/plan amendment complete; scoped verification PASS. Stripe/annual runtime NOT IMPLEMENTED; full package E2E NOT RUN.
Owner: Product owner / Codex.
Scope: Both repos' spec/plan, existing defaults and executable checks; no application feature implementation/deploy/live payment/config/customer changes.
Decisions:
- Match supplied monthly/yearly prices and aggregate branch/user/monthly receipt limits.
- Signup alone grants existing starter7menus (6parents/17keys; Dashboard and Notifications share key), FREE_TRIAL_15,1branch/2users/15slips per Bangkok month/default30days; no card or Stripe subscription.
- Lock entire ENTERPRISE_1999 month/year and ภ.ง.ด.53/50ทวิ Coming soon, no payment/custom bypass. PRO_999 remains separate.
- Reuse existing ledger/permissions/presets; annual does not grant12times pooled quota or reset usage. No paid→standard/full feature assumption.
- Full PE01–PE36 acceptance targets include all paid variants/web/LINE and negative enterprise paths; scoped tests do not imply future runtime passes.
Open questions: Existing E0 easy web auth, remaining B01 paid transition timing, B05 plan/interval change/proration, B06 tax and other unapproved financial rules remain behavior-specific gates. No need to resolve these to finish documentation.
Artifacts: [Spec](../specs/mangmee-package-entitlements-spec-th.md), [plan](../plans/mangmee-package-entitlements-plan-th.md), [evidence](../evidence/package-entitlements-2026-09-11/README.md).
Verification: 330/330 focused tests PASS (3source/doc+327application/contract), 0skipped/fail; current marketing2/2desktop/mobile PASS with0externalPOST; docs/link/catalog/PE01–PE36 check PASS. Exact commands/TAP/JSON in evidence; use-case data stores simulated, no real DB or Stripe/nativeLINE acceptance. Historical evidence untouched.
Next: PE-S1–S5 implementation and real Stripe/native LINE acceptance separately. Preserve unrelated working-tree changes.

Impact: P26 stale modulePackage/default-family description corrected. 50ทวิ uses existing3 specialistCLOSED routes; preserved external certificate handoff/sourcepayment/manualtaxreview. Added exact tax boundary inventory in main spec§6.1 and corrected Stripe developer reference monthly-only statements. No application code/package.json/live state changed.
