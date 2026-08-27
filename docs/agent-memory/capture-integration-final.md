# Capture integration final — corrected AI + merged P11

Status: PASS — bounded source review found no new P0/P1/P2 blocker; fresh exact-head local integration passed. Not main/UAT/live acceptance.
Owner: `/root/phase6_lock_design`; root owns CI, PR and release decisions.
Scope: Independently review the final expense amount-role fix and test the integrated P11/AI source without editing production source.

## Exact source and preservation

- Dedicated detached worktree: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-capture-integration-final`.
- HEAD: `29a0605b10102cc6efc0802ba90abe4e5482b6d7`, merging amount fix `86c72e7f` with develop/P11 `d8d9808e41d15360810ed67e9169ade0cd5605ab`.
- HEAD tree: `b62ee9b8355cb50835487c01336d4f15835cdbb1`. First parent: `86c72e7f46a1a66becb9c5132bce5f1e5ca757df`.
- Independently asserted that all eight AI files in `d8d9808e..HEAD` have identical Git blob IDs between `86c72e7f` and HEAD. The integrated merge preserved the reviewed fix.
- The earlier `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-capture-integration-check` worktree, HEAD `6f85339d`, MERGE_HEAD `70033af2`, merged index and report are preserved. Its passing checks predate the discovered amount/date-role bug and do not establish correctness of the fix.
- Rechecked old full HEAD `6f85339d6179a456957a7db77a3fc161047b8647`, MERGE_HEAD `70033af22415d59424fa3415448e150404262e48`, and old report SHA256 `9652436066c2a999f16389a7d1021dae7b7f9e51aae936336e492448211bf9fc`; unchanged. No write operation was performed in that worktree.
- Reuse prior safe check runner and registered file lists; no package, test or production source edits. Only this untracked report is authored here.

## Review and acceptance

- Read current scoped AI spec/plan/memory, exact production fix and registered regressions.
- Supported sole-expense amount and count answers now return canonical source facts before provider composition; the unreachable amount-only projection is removed.
- `response-composer.agent.ts:374` returns the canonical fallback before `generateText` for both count and supported amount-only requests. It therefore cannot replace 85 with year 2026, prior-context 150, or extracted user value 60. Other model paths use the same unprojected `toolData` consistently for payload and guards.
- Verify date/year, previous-context amount and extracted user-value candidates cannot replace the current amount; preserve count/amount distinction, invalid/missing/truncated and subset guards.
- Recheck actual API tool → specialist → composer → presentation/card for count and amount with fake dependencies only.
- Preserve other-tool/detail/multi-tool model paths and existing safe tenant links. No new router, monetary parser or live-AI quality claim.
- Registered amount/date/context/candidate regressions are in `response-composer.agent.spec.ts:243–303`; count/role, missing/truncated/subset, other-tool and multi-turn tests remain registered. The generic number-formatting test now exercises sales (still a provider path), while amount-only tests assert zero provider calls. English amount-only replies intentionally retain the existing Thai canonical fact line; full fallback localization is not acceptance for this slice.

### Exact source SHA256

- Composer: `fcc5bea96b9fea612f91b13296d9ffe14397069fe30604961ee788764f7f03e3`.
- Composer registered spec: `9b4a395da4fade450017ed04f8451906a14521a2be4098923e76357e7ff1f858`.
- API LINE business card: `d274859b8a4329a362b6c9d51ca5980eb0a77987462e5337eab511267e54904d`.

## Verification

All commands ran in the dedicated final worktree on 2026-08-27; no earlier-head test result is substituted below.

### Preparation and static checks

```sh
corepack pnpm install --offline --frozen-lockfile --ignore-scripts
env -u DIRECT_URL -u SHADOW_DATABASE_URL DATABASE_URL=postgresql://integration_final_only:unused@127.0.0.1:1/no_database_generate_only corepack pnpm --filter @watchdog-bms/api exec prisma generate
corepack pnpm --filter @watchdog-bms/config build
corepack pnpm --filter @watchdog-bms/contracts build
env -u DATABASE_URL -u DIRECT_URL -u SHADOW_DATABASE_URL EMAIL_PROVIDER=disabled MODEL_PROVIDER=disabled AWS_EC2_METADATA_DISABLED=true NEXT_TELEMETRY_DISABLED=1 corepack pnpm --filter @watchdog-bms/api typecheck
env -u DATABASE_URL -u DIRECT_URL -u SHADOW_DATABASE_URL EMAIL_PROVIDER=disabled MODEL_PROVIDER=disabled AWS_EC2_METADATA_DISABLED=true NEXT_TELEMETRY_DISABLED=1 corepack pnpm --filter @watchdog-bms/ai-gateway typecheck
env -u DATABASE_URL -u DIRECT_URL -u SHADOW_DATABASE_URL EMAIL_PROVIDER=disabled MODEL_PROVIDER=disabled AWS_EC2_METADATA_DISABLED=true NEXT_TELEMETRY_DISABLED=1 corepack pnpm --filter @watchdog-bms/web typecheck
node infra/security/sync-production-maintenance-release-pins.mjs --check
git diff --check
```

All PASS. Install reused 754 packages and downloaded zero. Prisma 7.8.0 generated the client from this exact merged schema, with no database connection or migration. API/gateway `tsc --noEmit` and web `next typegen && tsc --noEmit` passed. Maintenance check: 45 exact files, validator SHA256 `5c1abcf7a5816993fa9d47e6bd8907c080cdfd779e43e24004f0052617b1a322`.

### Full registered suites

Actual invocations were `node -e <in-memory-suite-runner> apps/api`, `node -e <in-memory-suite-runner> apps/ai-gateway`, and `node -e <in-memory-suite-runner> apps/web`. The runner read each exact-head package's existing `scripts.test`, preserved every registered test path/glob, replaced only the reporter with TAP, and invoked `corepack pnpm exec tsx --test --test-reporter=tap ...` in that package. No test/package files were edited. It parsed TAP totals and skip reasons in memory rather than changing scripts or writing a new harness.

| Suite | Tests | Pass | Fail | Skip | Cancel/Todo | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| API | 5,425 | 5,327 | 0 | 98 | 0 / 0 | 47.094 s |
| AI Gateway | 984 | 984 | 0 | 0 | 0 / 0 | 11.496 s |
| Web | 1,139 | 1,139 | 0 | 0 | 0 / 0 | 13.211 s |

All three exit codes were zero, with no failure diagnostics. API skip reasons: no database reachable (45); local PostgreSQL/P27 migration unavailable (6); local PostgreSQL/payment-idempotency migration unavailable (3); local PostgreSQL unavailable (1); no database reachable at local 15432 (5); no database (29); DATABASE_URL not set (9). These 98 are not counted as passes and establish no real-DB coverage.

Test environment removed database/PostgreSQL/Redis/provider credentials (`DATABASE`, `DIRECT_URL`, `SHADOW_DATABASE`, `PG*`, `P27_REQUIRE_POSTGRES`, `REDIS_URL`, `AWS_*`, `OPENAI_*`, `ANTHROPIC_*`, `BEDROCK_*`, LINE token/secret, `SES_*`). Set EMAIL/MODEL disabled, AWS metadata disabled, AWS config/credential files `/dev/null`, telemetry disabled, and `TSX_DISABLE_CACHE=1`. A Node preload rejected external TCP/TLS/fetch and unowned loopback sockets; only current-process HTTP fixture ports and tsx Unix IPC were permitted. Gateway's registered AgentCore HTTP fixture therefore ran without any external provider/service.

Instrumentation SHA256: suite runner `b767d8b2c32ee3a5050d88355f86eb225c7c60bbb3d7a2f4f8e74e100ba26f0c`; network preload `8c4a82a2154f9c06b1fd388f443d865554ef89726cfcd79f503b54008015ca37`. Registered test-script SHA256: API `70c92120555598e67acd51fb54f354075a7f57121d4f754de8e75fbbda3a3ffb`; gateway `3de12c75621fbac2ed5606a4bf83a8f08dce6418b202a185784b26656d8b2f89`; web `73be80667f0b4b7d74b2c3b712ee3a34a79dceaa555de1c83ad609b3d117d376`.

### Real-class source → summary → composer → presentation/card

Separate in-memory probe loaded actual `ExpenseListRecentTool`, `AccountingSummaryAgent`, `ResponseComposerAgent`, `buildAnswerPresentation`, and `buildLineBusinessAnswerMessage` from this final worktree using `tsx/cjs` with `TSX_TSCONFIG_PATH=../ai-gateway/tsconfig.json`. Same network fence, no database or provider. Probe SHA256: `fba88ec88444fbd2573e4616dec5e06d9365e22bebd0ce8a8f8b2c35a36a576b`.

Synthetic API repository data contained ten rows, three VOIDED, seven counted records totaling 85, and a five-row preview that also included cancelled amounts. Six cases PASS: Thai count; Thai money with year 2026; English money with year 2026; currentDate 2026; prior conversation amount 150; Thai-word candidate 60. Count answer retained seven records and current 85.00-baht fact; each money answer was exactly `• ยอดรวม: 85.00 บาท`. Every presentation/card body matched the actual composed reply; safe link stayed `https://app.example.com/companies/c1/expenses`. Fake provider call count was zero, so its intentionally wrong 2026-baht candidate never became answer content.

After all checks, both tracked working-tree and staged diffs were empty. `git status --short` contained only `?? docs/agent-memory/capture-integration-final.md`.

## Limits and next

No real database/migration, email, LINE, browser, cloud, commit, push or PR operation. This is fresh local combined-source proof and bounded review, not main/UAT acceptance, live-AI correctness/performance, arbitrary-language coverage, or proof of the 98 skipped DB cases. Root owns current exact-head CI and the merge decision; old CI/old combined evidence must not replace these new checks.
