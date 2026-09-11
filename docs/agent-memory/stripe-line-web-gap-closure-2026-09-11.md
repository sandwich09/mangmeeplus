# Agent Memory: Stripe LINE/web gap closure

Status: OWNED DESIGN + EXISTING RUNTIME REPAIRS VERIFIED LOCALLY. Full Stripe/native integration remains OPEN. User requested complete Mangmee-owned design/spec, round-trip E2E, bug/gap/impact discovery and fixes across web and LINE.
Owner: Product owner / Codex.
Scope: Audit existing auth/LINE/renewal/marketing journeys and P26/U01–U12 contracts; close reproducible defects, run local tests and record exact remaining Stripe/native-device scope. Existing unrelated dirty files preserved. No deployment, external messages, card charges or production operations.

Decisions:
- Existing runtime repairs can proceed without choosing the open trial/tax/grace/refund policies. Stripe collection and real provider acceptance still require implementation and approved applicable B01–B10.
- Reuse current session, token, company membership, P29 recovery and notification patterns; no package.json edits or added dependency.
- Keep simulated LINE identity/Stripe outcome evidence distinct from real browser/API/DB behavior and native provider proof.

Open questions: Existing B01–B10 policies remain unapproved where open. No new commercial promise from this task.

Artifacts:
- [UI spec](../specs/mangmee-line-web-billing-ui-spec-th.md)
- [UI plan](../plans/mangmee-line-web-billing-ui-plan-th.md)
- [Gap and impact register](../research/stripe-line-web-gap-closure-2026-09-11.md)

Verification:
- 565 focused cases pass: auth/LIFF/handoff, signed webhook/controller, durable LINE buffer, full process webhook, real Ver2 rich menu manifest and card routing.
- Real Chromium/web/API/PG 25/25 after final source changes; LINE proof and manual payment outcome are simulated boundaries, not Stripe E2E.
- Real sibling bundle: 22 scenarios pass, including 20 intercepted trial/contact outcomes; no delivery occurred.
- API/web production-source typechecks exit 0; scoped diff check clean; scoped fixture cleanup counts zero. Source/artifacts in [evidence](../evidence/stripe-line-web-gap-2026-09-11/README.md).
- Native LINE/OA bindings, Stripe/Postmark live providers and new billing U04–U10 remain NOT RUN. All LB rows have explicit partial/not-run dispositions.
Next: Implement S1 billing schema/DTO/uniques and PostgreSQL crash/concurrency tests against [owned developer design](../specs/mangmee-owned-billing-integration-spec-th.md); then approved-policy TEST adapter/invoice apply/UI/purpose=billing, sandbox/native acceptance. Current fixes are uncommitted/local, not a Stripe launch. No open existing-runtime defect remains in GW01–GW06/GW09–GW10; GW07/GW08 remain explicit integration gaps.
