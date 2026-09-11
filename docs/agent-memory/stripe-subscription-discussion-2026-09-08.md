# Agent Memory: Stripe subscription discussion

> Latest state: [implemented repair + local proof](stripe-access-repair-2026-09-11.md). Historical notes below are preserved; S-pre is now complete and Stripe provider E2E remains NOT RUN.


Status: REVIEW COMPLETE 2026-09-10 — Stripe specs aligned across both repos; business/test plan and local readiness evidence verified. Stripe implementation and payment E2E remain NOT STARTED / NOT RUN.

Latest 2026-09-11: local simulated readiness execution completed, but readiness FAIL. Browser 6 passed/2 failed; real PostgreSQL probes 1 passed/3 failed. See `docs/agent-memory/stripe-billing-simulated-readiness-2026-09-11.md` and its evidence for the five confirmed blockers; no runtime fix or actual Stripe E2E.

Follow-up 2026-09-11: Owner requested plan/spec fixes and completion of the review. Documentation closure is complete in `docs/agent-memory/stripe-plan-spec-closure-2026-09-11.md`: P26/P29/website aligned, S-pre and RG01–RG06 specified, R07 added as static risk only, terminal checkout/recovery contracts clarified. Executed failures remain unchanged; implementation NOT STARTED and B01–B10 not implicitly approved.
Owner: Product owner + Codex
Scope: Mangmee's own SaaS subscription collection and official-website contract, separate from customer ERP payments and accounting. User explicitly requested spec changes in both sibling repos.

Decisions:
- User confirmed automatic renewal, then instructed replacement of K BIZ + EasySlip with Stripe in both repos' specifications.
- P26 now specifies Stripe Payments + Billing + hosted Checkout and Customer Portal; marketing hands off to the app, whose backend owns company/OWNER checks, price mapping, signed invoice events, dedupe/reconciliation and entitlement/term changes.
- Paid offers remain disabled; PromptPay is deferred, not an automatic-renewal/fallback method. No payment step is inserted into the existing signup/approval/identity flow.
- Corrected the older P26 trial description to the later owner decisions on 2026-09-05/07 and current contracts: FREE_TRIAL → FREE_TRIAL_15, 1 branch / 2 staff / 15 receipts per Bangkok calendar month from day one, default 30 elapsed days from provisioning. PRO_TRIAL is only a legacy alias.
- Paid periods follow confirmed Stripe service periods; payment replay does not reset calendar-month receipt usage. Trial/admin terms retain their policy, and paid renewal cannot clear admin/security holds.
- P26's obsolete free-fallback wording was removed; trial/admin expiry follows P29 while paid grace/access policy remains undecided. Failed OCR allowance compensation follows the newer onboarding spec.

Open questions:
- Must customers provide a card when starting their trial, or may they begin without one and opt into a paid subscription later?
- What is the grace period and access policy when a recurring payment fails?
- When does the first paid charge take effect on trial conversion, and how are remaining trial days handled?
- Cancellation timing, upgrade/downgrade/proration, refunds and custom ENTERPRISE behavior.
- Who issues Mangmee's tax documents, and what is the tax treatment of the advertised prices?

Artifacts:
- `docs/specs/mangmee-billing-subscription-spec-th.md`: authoritative Stripe flow, catalog, acceptance and pending policies.
- `docs/specs/mangmee-external-signup-contract-spec-th.md`, `docs/specs/mangmee-company-plan-term-spec-th.md`: signup/trial/term integration boundaries.
- `docs/plans/mangmee-four-lane-gap-closure-plan-th.md`, `docs/plans/mangmee-brain-2-5-day-priority-plan-th.md`, `docs/plans/mangmee-line-first-signup-review-round-1-th.md`: remove active old-provider instructions and reference P26 Stripe.
- `docs/agent-memory/easyslip-v2-auto-register-plan.md`: explicitly superseded historical record.
- Sibling `/Users/thawatchai/Project/MangmeeYungYuen/mangmee_web/docs/specs/stripe-billing-alignment-spec-th.md`, `README.md` and `docs/agent-memory/stripe-billing-alignment-2026-09-08.md`.
- https://stripe.com/en-th/pricing
- https://docs.stripe.com/payments/promptpay
- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/customer-management
- https://docs.stripe.com/billing/revenue-recovery/smart-retries

Verification:
- Read P26/P29/P10, newer onboarding/trial policy and current plan-term/signup contracts; checked existing provider references. Historical P26 discovery claims are now labeled as dated evidence rather than current implementation truth.
- Checked official Stripe documentation on 2026-09-08: domestic cards 3.65% + THB 10; PromptPay 1.65%; Billing pay-as-you-go 0.7% of Billing volume.
- PromptPay is customer-initiated; subscriptions/invoices require `send_invoice`; Checkout subscription/setup modes do not support PromptPay.
- Python stdlib consistency check passed: all 5 offers match across both specs for names/prices/satang/limits/payment modes/paid-disabled state, and limits match existing PLAN_TIER_PRESETS.
- Checked 28 newly added local documentation links, including cross-repo paths and explicit billing anchors; all resolve. No trailing whitespace in changed/new docs.
- `git diff --check` passed in both repos. Targeted provider search confirms no active EasySlip/THAI_QR_SLIP branch or obsolete billing anchor in signup and delivery specs/plans; only explicit supersession/history remains in P26/memory.
- `git diff -- index.html` in mangmee_web is empty; no package.json changed. Source inspection found an existing PRO/trial coupling in its bundled template; website spec records this as an implementation acceptance gap, not a completed UI fix.
- Docs-only: no runtime tests required, no code/cloud/payment account/real charge/deployment changes. Existing unrelated working-tree edits were preserved. No commit/push requested or performed.
- The AGENTS.md ponytail path under /Users/spare058 was absent; read the current repo's `.agents/skills/ponytail/SKILL.md` and applied full mode. No additional dependency or abstraction introduced.

## Readiness review requested 2026-09-10

Scope:
- Owner asked whether integration, test payments, failure handling, E2E and automatic unlock are ready, including technical/business cases; explicitly asked to read https://stripe.com/en-th.
- Audited local docs/runtime/test paths and official Stripe documentation. Expanded both specs and added the implementation/test plan; did not implement billing or change deployed state.

Findings and decisions:
- No Stripe integration or Stripe E2E suite was found in the checkout. A paid plan value in local data is not evidence of a real payment; no cloud/account inventory was accessed.
- R01 reproduced using the real manual-renew use case with in-memory dependencies: term/audit commits, activation throws, same-request replay skips activation and the company remains DISABLED. This is a recovery gap to fix before reuse, not a verified production incident.
- R02 (expired-company OWNER billing access) and R03 (expiry-sweep race) are static integration risks requiring dedicated tests; R04 is the existing marketing PRO/trial coupling. None was fixed by this docs review.
- P26 §11 requires paid evidence and completed access application to be tracked separately; replay must resume activation. Unlock only the purchased company/plan, preserve roles/admin/security holds, refresh web/LINE state, and never ask a paid-but-pending customer to pay again.
- B01–B10 record pending trial, calendar quota, grace/retries, cancellation, plan changes, tax/WHT, refund/dispute, debt, payer/legacy and cost/support decisions. Seven-day renewal grace and other recommendations remain proposals, not owner approval.
- T01–T42 cover sandbox payments, lifecycle simulation, failure injection, real protected business actions, tenant isolation and browser journeys. All are NOT RUN. Applicable cases are release gates; unsupported/deferred features need an explicit reason and must actually be unavailable.
- Official Stripe findings: Portal plan changes can end trial/invoice immediately by default; schedules constrain Portal updates/cancellation; Portal is hosted and cannot be embedded in an iframe. Hard declines need customer action/new payment details, PromptPay is not Checkout subscription auto-renew, and the dispute auto-cancel delay cannot be proved with Test Clocks.
- Test cards/Test Clocks do not move money; Test Clocks do not move the app clock. Website sales gates do not stop Stripe recurring collection. Thailand card brands/account capabilities must be verified on the actual account before LIVE; the official support search returned Visa/Mastercard but fetching its full page failed.

Artifacts:
- `docs/plans/mangmee-stripe-billing-implementation-and-test-plan-th.md`: S0–S5, B01–B10, T01–T42, official sources, sandbox procedures and ops acceptance.
- `docs/evidence/stripe-readiness-2026-09-10/README.md` and `manual-renew-replay.probe.ts`: runnable local evidence with scope limitations.
- P26 §11–13 and sibling website spec §7 mirror activation/failure/business acceptance.

Verification:
- Existing plan-term + AuthGuard focused suites: 67 tests passed (exit 0); exact command in evidence README. This is LOCAL PASS only, not payment/E2E evidence.
- Manual-renew injected-failure probe: REPRODUCED GAP (exit 0 means the asserted defect was reproduced). No real DB or Stripe call.
- Stripe sandbox checkout, Test Clocks, renewal E2E, UAT and LIVE acceptance: NOT RUN because integration is absent.
- Final Python stdlib check passed across 14 scoped files: 43 added local links/anchors resolve; all 5 offers match names/prices/satang/limits/modes/paid-disabled state across both specs and PLAN_TIER_PRESETS; T01–T42 and B01–B10 occur exactly once as matrix rows; Stripe cases remain NOT RUN; all four card + Billing fee examples recompute correctly. Added/new text has no trailing whitespace.
- `git diff --check` passed in both repos. `git diff -- index.html` in the website repo and package.json diffs in the main repo are empty. Unrelated working-tree edits were preserved.
- No runtime fix, package.json edit, secret/config change, external notification, charge, cloud operation, deployment, commit or push.

Next:
- Settle policy dependencies in B01–B10 before implementation of the relevant S0–S5 slices; fix R01/recovery and test R02/R03. Align the actual marketing trial template (R04), then execute applicable T01–T42 with provider/API/DB/browser evidence. Keep paid offers disabled until both repos and required release gates pass.

## Developer reference collection — follow-up 2026-09-10

- Owner asked whether Stripe developer docs/specs had been collected. Earlier turns had official links/findings in P26 and the plan; this follow-up adds a dedicated local developer reference.
- Added `docs/research/stripe-developer-reference-th.md` and entry links from P26, the implementation/test plan, and the sibling website spec. It contains Stripe endpoint references, request requirements, metadata propagation, version-sensitive Invoice/Subscription/line-item joins, full event names, paid-apply recovery, Portal configuration and test setup.
- Re-read official API/developer docs. Versioning page currently reports `2026-08-26.dahlia`; this is a reviewed upstream value, not a selected Mangmee SDK/API version. Invoice line service periods differ from Invoice.period_end; current item periods and subscription parent references must be parsed for the chosen version. Event.account is nullable for direct-account events.
- Checkout guide returned a variant index and the detailed hosted variant fetch failed; the reference records that limit and uses successfully read Create/Retrieve/Expire Checkout API docs for field facts. No full-site mirror or copied SDK samples were added.
- Validation PASS: 6 scoped Markdown files; 7 new local references/backlinks resolve; reference contains 28 unique official Stripe source URLs; full event names, code fences and whitespace valid; B01–B10/T01–T42 preserved and Stripe cases remain NOT RUN. `git diff --check` passed in both repos; website index.html/package.json diffs are empty.
- Existing 67 local tests and the R01 probe were not rerun because this follow-up only changes Markdown. No provider/SDK/runtime/account configuration, live charge, deployment, commit or push.
