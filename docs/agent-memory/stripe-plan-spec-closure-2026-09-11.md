# Agent Memory: Stripe plan/spec closure after simulated readiness

> Latest state: [implemented repair + local proof](stripe-access-repair-2026-09-11.md). Historical notes below are preserved; S-pre is now complete and Stripe provider E2E remains NOT RUN.


Status: DOCUMENT REVIEW COMPLETE — plans/specs aligned; runtime repair and Stripe E2E remain outstanding.
Owner: thawatchai + Codex
Scope: Owner asked to put fixes in plan/spec and continue the review to completion after the Sep 11 simulation found five blockers. Update app P26, shared P29, implementation plans, developer reference and sibling mangmee_web spec; no runtime implementation or new business-policy decision in this task.

Decisions:
- Keep executed evidence unchanged: browser 6 passed/2 failed; PostgreSQL 1 passed/3 failed. R01/R02/R03/R05/R06 remain OPEN until rerun after implementation.
- Add S-pre before reusing the existing access flow for Stripe, with concrete transaction/dedupe/lifecycle/recovery/notification acceptance. S0 policy work can proceed alongside; no trial/grace/tax/refund choice is inferred from documentation authorization.
- Add R07 as STATIC RISK / NOT RUN only: sweep stamps warning/expired notification flags before notify; failure can suppress future job creation. R04 marketing remains static/unverified by browser.
- Define selected-company/permission/error/status semantics and terminal attempt recovery. Reuse authenticated routes, shared contracts, OutboxEvent/notification machinery and entitlement CAS patterns; do not introduce speculative runtime APIs/tables/provider abstractions.
- Resolve stale P29 plan trial preset to current FREE_TRIAL_15 policy. Preserve historic implementation evidence and unrelated working-tree changes.

Open questions:
- B01–B10 remain pending where indicated; decision owner/date/revision/config/copy/test linkage is now required before affected flows open.
- Exact Stripe SDK/API/account/config and concrete new billing DTO/routes are implementation deliverables, not invented in the docs.

Artifacts:
- `docs/plans/mangmee-stripe-billing-implementation-and-test-plan-th.md`: current R01–R07 register, S-pre, §9 implementation/contract/RG01–RG06/business handoff/done criteria.
- `docs/specs/mangmee-billing-subscription-spec-th.md`: §14–15 recovery/status/permission/completion contract and corrected terminal invoice recovery.
- `docs/specs/mangmee-company-plan-term-spec-th.md`, `docs/plans/mangmee-company-plan-term-plan-th.md`: shared repair requirements and current trial baseline.
- `docs/research/stripe-developer-reference-th.md`: latest evidence links, S-pre handoff and official lifecycle follow-up.
- Sibling `mangmee_web/docs/specs/stripe-billing-alignment-spec-th.md`: same contract, statuses, marketing R04 and release criteria.

Verification:
- Read actual Renew/Set/Lifecycle/Sweep/Notice use cases, recovery page/helper, notification creation and Prisma audit/outbox constraints. R07 is an inference from source; no new failure probe run claimed.
- Reviewed official Stripe webhooks, idempotent requests and subscription lifecycle docs on 2026-09-11; cited sources in changed documents.
- Final Python stdlib checks passed across 7 scoped Markdown files: 59 local links, 12 new anchor references, 5 catalog offers in both repos (name/price/satang/limits/payment mode/disabled state), complete R01–R07/RG01–RG06/B01–B10/T01–T42 registers and valid fences/whitespace. Stripe/new RG cases remain NOT RUN and slices remain NOT STARTED.
- Compared all 7 source/test SHA-256 hashes in the executed simulation report: unchanged. Preserved browser 6/2 and PG 1/3 results and five confirmed blockers. No evidence was relabeled as passing. Checked S-pre has no dependency on future Checkout/Portal/billing UI; those additional tests belong to S2–S4.
- `git diff --check` passed in both repos; package.json and website index.html diffs are empty. Documentation status distinguishes historical implementation, current failures, static risks and future acceptance.
- No runtime test rerun: this follow-up changes Markdown only; previous failures remain the latest executable results. No package.json/index.html/runtime/secret/config change, Stripe account call, cloud operation, charge, deploy, commit or push.

Next:
- Implementation handoff: S-pre → policy-approved S0–S5 → actual Stripe sandbox/browser/ops acceptance. Documentation complete must not be reported as runtime fixed or payment E2E passed.
