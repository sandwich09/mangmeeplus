# Agent Memory: trial FAQ card Production hotfix — 2026-09-18

Status: Preparing isolated second hotfix; first Production operation still awaiting browser acceptance.
Owner: thawatchai + Codex
Scope: Render the existing public trial policy in the standard LINE card and recognize standalone questions about what happens after the free promotion ends.

Decisions:
- Base is exact first hotfix source `0b0058adbc7353ec906a33746867af2a235b0934`; no main/develop/UAT application backlog.
- Preserve the approved no automatic charge policy, time-limited trial, official package link, human-support pause, durable delivery and deduplication. No model call, subscription/account assertion, billing mutation, schema or dependency change.
- Reuse the existing business-card bubble renderer, canonical fallback text and delivery path. Keep business/mixed/quoted questions and paid subscription renewals outside this FAQ.
- Owner requests first acceptance and merge to main+develop, then second hotfix with measured stability/timing, then merge the second patch to both branches. Local preparation may continue while browser control is blocked; no second deployment before the first operation terminalizes.

Acceptance:
- Both screenshot phrases return one Flex card, with the approved policy and working official-package button.
- Close standalone Thai trial-end variants take the same deterministic route for linked and unlinked callers, with zero model/intake calls and retained duplicate suppression.
- Focused matcher/card/webhook tests and API typecheck pass; exact source scope is retained.
- Live release requires signed result and fresh current-admin OPEN/logout acceptance; record timings without conflating build/deploy time with operator wait.

Open questions: None for application behavior. Release remains dependent on first acceptance and reviewed closure of the retained ECS rollback window.
Artifacts: Isolated branch `codex/trial-faq-card-prod-hotfix-20260918`.
Verification:
- Existing lockfile installed offline with scripts disabled; existing contracts build and Prisma generation completed. No dependency/package/lock change.
- Focused API matcher, card renderer and webhook tests: 343 passed, zero failures. Includes both screenshot phrases, ten additional trial-end variants, business/quote/renewal negatives, linked/unlinked callers, one Flex card with official URI and canonical fallback, zero AI calls, durable delivery/dedup and support-state failure behavior.
- API typecheck and git diff --check passed.
- First live business journey independently completed: SRC-202609-00003 prepared unsigned and cancelled; original LeoPard845 confirmed as EXP-202609-00002. First deployment still awaits fresh current-admin identity/logout evidence; no second release or branch integration claimed.
Next: Implement and check the scoped card/matcher patch; finish first release, integrate, then use the reviewed follow-up release path.
