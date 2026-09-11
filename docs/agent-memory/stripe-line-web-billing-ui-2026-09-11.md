# Agent Memory: LINE and web billing UI 2026-09-11

Status: DESIGN COMPLETE; runtime implementation NOT STARTED; LB01–LB20 / provider / native device E2E NOT RUN.
Owner: Product owner requested complete LINE + web payment and UI design; Codex maintains docs.
Scope: P26/S2/S4 journey, routing/contracts, LIFF external-browser entry, billing recovery, U01–U12, wireframes, Stripe document UI, tests and mangmee_web alignment. Docs only this turn.

Decisions:
- LINE and web enter the same per-company billing backend/UI, Stripe hosted Checkout/Portal and customer Invoice/Receipt. Postmark selection/accounting boundary preserved.
- Generic LIFF billing entry verifies the opener and selects the company; mint existing single-use handoff at use and consume in destination browser. LINE-only users do not set a password just to pay; web-only users do not need LINE.
- Current LINE package-change button is an admin request, not Checkout. Current LIFF start and handoff exchange reject non-ACTIVE companies; add billing-specific expiry recovery before integration acceptance.
- Use current app routing: /billing chooser, company settings/billing pages, existing /renew. Target contracts are documented, not executable endpoints yet. Preserve exact safe return through auth/legal gates.
- Payment/apply/access/document states are separate. No success from redirects; pending/unknown must not suggest paying twice. Current OWNER/permissions checked at every billing action.
- No changes to price/trial/grace/cancellation/refund policies; B01–B10 remain open where already open. No provider sends/charges, cloud reads, deploy, code or package.json edits.

Open questions:
- B01–B10 still require applicable business decisions before enabled actions; signup OTP/link and other identity proposals remain proposals. Not blockers for completing this design document scope.
- Runtime/device/provider behavior needs L1–L5 implementation and evidence; do not infer actual availability from design.

Artifacts:
- [UI spec + U01–U12 + wireframes](../specs/mangmee-line-web-billing-ui-spec-th.md)
- [UI plan + LB01–LB20](../plans/mangmee-line-web-billing-ui-plan-th.md)
- [LINE/Stripe developer reference](../research/line-stripe-browser-payment-reference-th.md)
- [P26](../specs/mangmee-billing-subscription-spec-th.md), [Stripe plan](../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md), [LINE signup](../specs/mangmee-line-first-signup-spec-th.md), [handoff](../specs/line-web-deeplink-handoff-spec.md), [P29](../specs/mangmee-company-plan-term-spec-th.md), [unified signup](../specs/unified-easy-signup-spec-th.md)
- [Sibling alignment](../../../mangmee_web/docs/specs/stripe-billing-alignment-spec-th.md), [sibling task memory](../../../mangmee_web/docs/agent-memory/stripe-line-web-billing-ui-2026-09-11.md)

Verification:
- Reviewed current LINE command/session/handoff/controller/web route/layout/renew code and official LINE/Stripe docs (sources in reference).
- Focused document check PASS: 12 documents, 134 local file links, balanced code fences, no trailing whitespace, U01–U12 exactly 12 screens and LB01–LB20 exactly 20 test cases; zero errors. Scoped git diff --check PASS in both repos. Commands: Python balanced-link/inventory validator against the 12 touched docs; git diff --check -- <touched doc paths> in each repo. This is D0 evidence only.
- No runtime or provider/device tests run because this turn changes design documents only; existing S-pre/browser evidence retains its original scope.

Next:
- Implement L1 shared contracts and expiry-scoped recovery; then L2/L3 UI and entries, L4 provider integration, L5 device/ops acceptance according to dependencies. Keep paid disabled until relevant policy/integration/release gates pass.


## Follow-up: clickable example

- User requested an example. Created a contained Thai UI mock for LINE/web entry, company selection, plan/review/consent, simulated Stripe Checkout, success/decline/paid-applying/paid-held/unknown, document history and Portal/cancellation examples.
- Inline source: /Users/thawatchai/.codex/visualizations/2026/09/08/01a081b8-25dc-71a2-bee2-a29ceee5af5d/mangmee-payment-example.html.
- Amounts, quota, tax presentation, dates and cancellation behavior are illustrative assumptions, not new approved business policy. No actual card collection, network requests, document creation, notification, deployment or runtime billing changes.
- Verification: fragment read back; no literal escaped markup/newlines, one script, under 1 MB, no fetch/XHR/WebSocket. Embedded script passed node --check. No browser/provider/native LINE tests run. L1–L5 and LB01–LB20 status unchanged.
