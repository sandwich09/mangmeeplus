# Agent Memory: trial FAQ card Production hotfix — 2026-09-18

Status: COMPLETE. Isolated card hotfix deployed and signed with explicit owner browser HTTP waiver; matching integration merged into main and develop.
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
- Live release retains exact source/config/readiness/public OPEN and signed result. Owner stopped repeated browser HTTP checks after personally testing the first release; record any waiver explicitly without claiming unperformed identity/logout checks passed.

Open questions: None required for delivery. See consolidated evidence for bounded-observation limits.
Artifacts: Isolated branch `codex/trial-faq-card-prod-hotfix-20260918`.
Verification:
- Existing lockfile installed offline with scripts disabled; existing contracts build and Prisma generation completed. No dependency/package/lock change.
- Focused API matcher, card renderer and webhook tests: 343 passed, zero failures. Includes both screenshot phrases, ten additional trial-end variants, business/quote/renewal negatives, linked/unlinked callers, one Flex card with official URI and canonical fallback, zero AI calls, durable delivery/dedup and support-state failure behavior.
- API typecheck and git diff --check passed.
- First live business journey independently completed: SRC-202609-00003 prepared unsigned and cancelled; original LeoPard845 confirmed as EXP-202609-00002. First deployment still awaits fresh current-admin identity/logout evidence; no second release or branch integration claimed.
Next: No further deployment or repeated browser verification. Keep native rollback snapshots.

Integration evidence:
- Isolated Production candidate is immutable1406d3825db2eb7d70987b207c80f89ae05edb3b, draftPR639 on the first hotfix branch. Newer development features remain outside that candidate.
- Matching integration applies on65e20e164cdab54bb4b9259b46c76ac9d0746f60.427focused matcher/card/webhook tests pass and API typecheck passes with the existing8GB Node heap setting. Initial default4GB invocation hit a local heap limit; no code change was needed.
- Candidate build took194.790s; prepared operation20260918T132054Z-07bf4d3d passed in57.009s without deployment, reusing the build.
- First operation20260918T113740Z-2b1e04fa is KMS-signed OWNER_ACCEPTED_BROWSER_HTTP_WAIVED. ECS rollback-window closure is separately signed after actual old task STOPPED/0capacity, obsolete authority retirement and removal of temporary migration IAM. First integration CI35348631418 is pending at this checkpoint.


Final delivery:
- Production20260918T143800Z-e6c3b860 accepted14:42:13UTC; source1406d382, KMSverified, publicOPEN, all4service containers/fullconfig/deepreadiness pass.252.880s receipt/253.009s command,230.844s website,1.269s signing.
- Initial publication timeout20260918T133750Z-80b36194 and258.563s tools-only upload reconciliation retained; no service mutation in failedattempt.
- CI35349893178 passed exactcefa946b; PR640 mergeddevelop70d1359d andsameheadmainad425087. Three93secondboundedruntime/publicsamples passed; browser and actualLINE not repeated perowner.
- [Full report, limitations and both-round timings](../evidence/production-two-hotfixes-2026-09-18.md). Earlier pending statements above are historical checkpoints.
