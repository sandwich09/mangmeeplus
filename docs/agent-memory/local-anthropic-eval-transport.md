# Agent Memory: local-anthropic-eval-transport

Status: Complete (2026-10-15); local-only diff left uncommitted, no live calls.
Owner: Codex
Scope: Owner's local Anthropic Messages API transport design for LINE AI evals; Sonnet 4.6, global fetch, no dependencies. UAT/Production remain on Bedrock; AgentCore runtime is out of scope.
Decisions:
- Product: a local key selects Anthropic for existing Bedrock workloads; preserve prompts, tools, model approval, budget wrapping, usage shape, cache boundaries, deadlines, and fail-safe timeout accounting.
- Architecture: reject ANTHROPIC_API_KEY unless APP_ENV=local at config validation; keep the Bedrock model ID for pricing/approval and map only the outbound API model ID.
- Implementation plan: add the provider with shared Bedrock helpers; wire factory and eval/smoke callers; add key-file launcher support and docs; verify with stubbed fetch and config tests plus gateway typecheck.
- Acceptance: attachments/cache/tool round trip, usage and timeout accounting, bounded throttling, stop/error mapping, environment restriction, and factory selection have runnable focused checks.
- Ponytail full read from .agents/skills/ponytail/SKILL.md (the instructed /Users/spare058 path does not exist here).
Open questions: None.
Artifacts:
- apps/ai-gateway/src/modules/line-ai/infrastructure/provider/anthropic-api.provider.ts; existing Bedrock usage/timeout/cache-index/throttle helpers reused without changing its behavior.
- Config schema/getter and budgeted factory; orchestrator/provider smoke and both direct-provider benchmark paths use the same choice. AgentCore runtime and package.json files untouched.
- Key-file gateway launcher, .env.example, docs/qa/line-ai-expense-advisor-eval.md; tests added to already-registered provider/config spec files.
- last-message.md contains the requested concise report.
Verification:
- `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts`: PASS, 57 tests (37 existing + 20 new). Fetch and launcher spawn stubbed; launcher covers eight credential/file cases.
- Provider tests cover wire model mapping, text/image/PDF/cache boundaries, parallel tools/results and validation, output limits, usage fields, bounded 429/529 retries, deadlines/aborts, conservative budget charges, refusal/malformed/generic errors, approval/budget enforcement, and key-free logs.
- `pnpm --filter @watchdog-bms/config test`: sandbox blocks tsx CLI IPC socket (`listen EPERM`); identical registered files run with `pnpm --filter @watchdog-bms/config exec node --import tsx --test src/index.test.ts src/deployment-identity-manifest.test.ts`: PASS, 154 tests. New case covers local/blank/missing keys, literal APP_ENV=uat, and actual deployed UAT/Production (APP_ENV=production).
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`: PASS.
- `pnpm --filter @watchdog-bms/config build` and `pnpm --filter @watchdog-bms/ai-gateway build`: PASS; ignored local dist artifacts refreshed.
- Compiled config/getter/factory check: PASS, 3 assertions (local with key → Anthropic, without key → Bedrock, deployed UAT rejects key), no dispatch. Fixture explicitly uses AWS_SDK_LOAD_CONFIG=true; inherited value 1 is rejected by the existing boolean schema.
- `node --check scripts/line-ai-expense-advisor/launch-gateway.mjs` and `git diff --check`: PASS.
- No cloud calls, real API calls, database operations, commits, or dependency changes. Browser/E2E not applicable to this transport-only change; live eval intentionally not run.
Next: Owner supplies the local key file and runs the existing real-mode eval harness; live Anthropic acceptance/cache behavior remains unverified in this network-disabled task.
