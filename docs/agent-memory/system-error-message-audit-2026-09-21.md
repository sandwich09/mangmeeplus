# Agent Memory: system error message audit

Status: Complete for default-open features
Owner: Codex
Scope: Audit system-wide error meaning, then implement reviewed customer copy only for default-open
features plus billing/renewal.
Decisions:
- Preserve the existing fail-closed customer-message boundary; do not show raw API messages.
- Treat 3,123 throw sites and 1,320 potential generic-fallback sites as static audit scope, not as
confirmed runtime defects.
- Prioritize confirmed wrong-context errors and active journeys instead of blindly translating all
323 identifiers missing from the shared catalogue.
- Require stable codes, bounded details, audience-aware Thai copy, and source-derived coverage for
each implementation batch.
- User narrowed implementation to default-open features only. Use `DEFAULT_ENABLED_FEATURE_KEYS`
  plus billing/renewal as the implementation boundary. Public signup/onboarding is currently closed;
  it and other disabled/planned/internal features remain audit-only.
Open questions: None.
Artifacts:
- `docs/qa/system-error-message-audit-2026-09-21.md`
- `docs/specs/system-wide-user-facing-error-copy-spec.md`
- `docs/plans/system-wide-user-facing-error-copy-plan.md`
- `apps/web/src/common/api/api-error-message.ts`
- `apps/web/src/common/api/api-error-coverage.spec.ts`
- Existing shared translator and coverage/safety tests under `apps/web/src/common/api/`.
Verification:
- Static scan covered non-test API source and mounted web error display seams.
- Confirmed eight representative wrong-context outputs by executing the shared renderer.
- Focused error safety/coverage tests passed 13/13.
- Source-derived coverage now requires reviewed Thai for every code-like identifier returned by the
  in-scope default-open API modules.
- Final scoped renderer, coverage, no-raw-display, API client, and reimbursement tests passed
  104/104 after public signup/onboarding was excluded.
- The coverage gate found and checked 453 code-like identifiers across the in-scope modules.
- Web typecheck passed (`next typegen && tsc --noEmit`).
- `git diff --check` passed.
Next: Keep disabled/planned feature findings audit-only until those features are opened.
