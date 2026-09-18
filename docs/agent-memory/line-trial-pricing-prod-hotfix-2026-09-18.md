# Agent Memory: LINE trial pricing hotfix — 2026-09-18

Status: Integration candidate prepared locally on develop e1f81a7c; hold shared-branch merge until isolated Production hotfix acceptance. Historical initial release blockers below were superseded by the owner-authorized Kamal migration; the active Production ledger is production-kamal-two-release-paths-2026-09-18.md in the migration checkout.
Owner: thawatchai + Codex
Scope: Answer short Thai questions about free trial charges with the owner-approved policy; preserve receipt/business routes and support pauses. No billing, schema, dependency or release-controller changes. The integration branch is not the isolated Production candidate.

Decisions:
- Owner asks for only this fix on Production, then integration into main/develop/UAT. Production baseline is `fc2838c4cb691033f41595c0d43587f10377d33c`; work is isolated from the dirty main checkout.
- Use the existing API deterministic public-answer and durable delivery path. A bounded whole-message FAQ matcher covers the reported three phrasings and close variants; it is not a general semantic billing assistant. Mixed business requests and quoted/pasted text stay in their existing routes.
- Copy describes the free-trial policy, not the caller's current subscription: no trial charge or automatic paid conversion; payment starts only after choosing a package and confirming payment. Trial rights remain time-limited. An existing paid subscription's renewal is outside this answer.
- Link directly to the official package page without asserting that online purchases are currently enabled, hardcoding a price, or showing the obsolete Production PRO-free poster.
- An active human-support pause retains ownership of ordinary text. A support-state read failure propagates rather than bypassing the pause. Existing webhook preflight/legal acceptance and reply retry/dedup remain unchanged.

Plan / acceptance:
1. Add the bounded FAQ matcher and reply in existing menu logic, then connect it before model routing.
2. Test reported questions, spelling/politeness variants, business/renewal/quote negatives, zero AI calls, durable delivery/dedup, support pause and failure handling.
3. Verify the exact Production-base diff and current-branch integration applicability. Commit only the scoped patch.
4. Resolve the release-order incompatibility before any merge or live mutation.

Open questions:
- Existing V2 requires candidate ancestry in develop/main, signed UAT Passport and READY before Production. `deploy-uat.yml` also requires candidate/controller CI-policy blob equality; current main CI differs from the Production baseline. Therefore the requested prod-before-merge/UAT order is not supported by the current pipeline. Do not dispatch a known-failing run or bypass it.
- The owner reconfirmed proceeding after discussion of a separate hotfix path. This supplies deployment intent, not evidence that a new release path has been implemented or reviewed. Do not ask for the same deployment permission again. A new path must preserve independent review, exact-source CI, signed rehearsal/READY/result, durable build authority and rollback; do not remove the existing checks or label a local test as UAT acceptance.

Artifacts:
- Branch `codex/line-trial-pricing-prod-hotfix-20260918` in the managed `line-trial-pricing-prod-hotfix` worktree, now pushed with exact candidate `8f5b508ac3754c72acf10165c7db82a9d1749371`. Its runtime/source content is unchanged.
- Production readback: API digest `sha256:95faa147060b2c0aedc78d9460c41adf41d1c9b00c890479e29057f72464b87d`; AI `sha256:e52c27161d65d7840c43feb728d5f09b1531b2fa69c317bee45b651f3a0f725c`; workers `sha256:f26af356a17778643cc201c365cdc749d092bd3ab57b2c1c8ed0d9da4dced22c`, all RUNNING.

Verification:
- Follow-up scoped-release approval: owner said “ถ้าแน่ใจว่าไม่มีอะไรติดไปด้วย ก็ hot fix ได้เลย”. Exact tree comparison of patch commit `8f5b508ac3754c72acf10165c7db82a9d1749371` against Production `fc2838c4cb691033f41595c0d43587f10377d33c` confirms only 2 API runtime files, 2 tests and this memory document differ. All schema, dependency/lock, web, AI Gateway, workers, shared package, infra and workflow files are identical.
- Fresh ECS active API image and ECR tag still agree with that Production baseline. The old `deploy-production.yml` has a partial-incident input but is not the canonical V2 protocol and still requires source ancestry in main. The Kamal command pins latest main and Production is not enrolled; neither is a supported workaround for this candidate.
- Read-only release precheck: candidate is not an ancestor of either main or develop. Candidate CI blob `f9d78d3f74d517abe87e7355ea7441f333c00d16` differs from current controller CI `b5f923366ce18e166cc0a751e054a066166f925f`; deploy-uat blobs match. No failed workflow was dispatched to rediscover these known blockers. No policy waiver, allowlist exemption, validation bypass or alternate deployment path was introduced.
- Read cloud operations, Production V2 protocol and ponytail full instructions before work.
- Latest UAT/READY/Production workflow runs are terminal. These historical runs are not release authority for this patch.
- `pnpm install --frozen-lockfile --offline --ignore-scripts` reused the existing package store; package/lock files unchanged. Generated the existing Prisma client locally.
- Focused API tests: `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`: **310 passed, 0 failed**. The surrounding diagnostic shell returned 1 only because `rg 'not ok'` found no failures; TAP confirms the test result.
- Initial checks caught an unsupported URI quick-reply action and test fixtures missing the existing durable-delivery flag. Fixed by using a normal clickable text URL and enabling that flag in the relevant test fixtures; final tests and typecheck pass.
- `pnpm --filter @watchdog-bms/api typecheck`: passed; `git diff --check`: passed.
- Isolated temporary-index `git apply --cached --3way --check` passed for both `origin/main` (`4af30319`) and `origin/develop` (`e4702e23`). No branch or working tree was changed by these applicability checks; they are not integration runtime tests.
- The three reported phrases were tested for both linked and unlinked identities with zero intake/model calls, saved terminal outcome, and no duplicate delivery. Support pause, support-store failure, durable-outcome failure, 14 accepted variants and 17 negative/mixed/quoted cases are covered.
- No synthetic customer LINE message, billing mutation, cloud mutation, UAT deployment, Production deployment or shared-branch merge performed. Existing main working changes remain untouched.
- Fresh remote main is `4474e4d6ce3e1a62c69aa68b752954d296d25a46`; develop is `c49f70ca6f65069780f2d034b1b19b67ecaf2fa6`. Main requires one approving review.
- `deploy-production.yml` partial incident also requires the API source to be already accepted and unretired (`deploy.sh` and `run-release-task.sh`). It cannot register this new candidate through its read-only preflight. A source-only hotfix is therefore not just a different workflow input.
- Prepared `codex/line-trial-pricing-integration-20260918` on that develop head. Cherry-pick applied without conflicts; its current-branch checks must not be presented as Production-candidate checks. No deployment should use this integration branch because it contains newer unrelated application code.

Next:
- Scoped Production release is approved. Finish the separate integration PR validation and retain it unmerged for review. Ordinary V2 requires merge/integration and UAT before Production; a Production-baseline-only candidate also needs reviewed CI/controller compatibility and isolated rehearsal work because current-main CI references newer application tests and current UAT has newer database migrations. Do not imply that simply merging this commit makes it deployable.
- If a dedicated prod-first hotfix channel is requested, specify/review that release-controller change separately; retain CI, immutable image, signed readiness/result, rollback and final OPEN acceptance. Do not silently widen this application hotfix or deploy latest main's unrelated changes.
- Integration focused tests: **394 passed, 0 failed**, 3.721s; integration API typecheck also passed on the develop-based branch. Production-base evidence remains the earlier 310 tests; these are different source trees.
- No UAT_RUN_ID, READY_RUN_ID or PROD_RUN_ID exists for this hotfix yet.


## Integration preparation after the combined hotfix approval

- Owner added cancelled-substitute confirmation0b0058ad to pricing8f5b508a on exact Production
  baselinefc2838c4. This integration branch is never a Production hotfix candidate.
- Merged origin/develop e1f81a7c9d0dc8479b257df190d230684ff8927a locally without conflicts, preserving
  published PR629 history. No main/develop shared merge or UAT deployment from this preparation.
- Newer v2 evidence review already permits a reviewed original receipt despite the retained historical
  missing-receipt reason. Both API preflight and locked final transaction use the shared contract; the UI
  evaluates that same current review. Do not copy the older Prod fallback guards over this contract.
- Extended the existing final-transaction certificate-history regression to include and retain the old
  missing-receipt reason. It confirms with the current original receipt and cancelled certificate history.
  Existing tests still reject removed/stale reviews and invalid substitute evidence.
- Verification after develop merge: contracts build PASS; atomic confirmation28tests PASS; pricing394
  tests PASS; contracts evidence10tests PASS; web evidence37tests PASS; API typecheck PASS.
  The first combined root-cwd invocation could not resolve the web @/ alias before web test execution;
  reran the web command from its existing package context successfully. No code workaround.
- Commands: pnpm --filter @watchdog-bms/contracts build; pnpm --filter @watchdog-bms/api exec tsx
  --test src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts; pricing
  process-line-webhook/line-staff-menu specs; packages/contracts/src/expense-evidence.spec.ts;
  pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/expense-review-steps.logic.spec.ts;
  pnpm --filter @watchdog-bms/api typecheck.
- Next: retain locally until Prod signed/OPEN acceptance; then update PR629 with both scopes and run
  exact-head CI before develop/main integration and UAT. No remote uat branch exists; use UAT environment.
