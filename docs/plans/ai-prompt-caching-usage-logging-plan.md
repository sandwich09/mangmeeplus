# AI Prompt Caching & Usage Logging Plan

Spec: [[specs/ai-prompt-caching-usage-logging-spec|AI Prompt Caching & Token Usage Logging Spec]] (authoritative for design + acceptance criteria; read it first).

Lane split (owner decision 2026-07-26): Fable 5 = plan/spec + final business verification; Opus 5 = implementation, tests, review pass.

## Steps

1. **Provider port** — `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts`
   - Add optional `cacheableContext?: string` and `usageTag?: string` to `ProviderInput` and `ProviderToolsInput` with the doc comments from spec §4.2.

2. **BedrockProvider** — `.../provider/bedrock.provider.ts`
   - `CACHE_MIN_CHARS = 3000` module const (comment: ≈1,024-token Sonnet minimum, conservative for English-heavy prompts).
   - System checkpoint rule + `cacheableContext` leading-block rule per spec §4.3 (context block always rendered; checkpoint size-gated). Keep attachment blocks on the last user message exactly as today.
   - `ai.usage` logging per spec §4.3 in BOTH `generateText` and `generateWithTools`: wrap the `client.send` race, measure `durationMs`, read `response.usage`, `console.log(JSON.stringify({...}))`. One line per call, success or failure; never throw from logging.

3. **OpenAI provider** — `.../provider/openai.provider.ts`
   - Prepend `cacheableContext` to first user text; emit `ai.usage` when the response exposes usage. No caching.

4. **Intent router** — `.../agents/intent-router.agent.ts`
   - `route()`: catalog → `cacheableContext`; message JSON per spec §4.5. `routeIntake()`: only add `usageTag: 'line.intake-route'`.

5. **usageTag at every provider call site** (one-line each) per spec §4.6 table:
   - `line-ai-internal.controller.ts` (3 sites), `orchestrator.agent.ts` (native loop + JSON model loop), `coverage-critic.agent.ts`, `response-composer.agent.ts` (2 sites), all 8 `crm-customer-ai` use-case/agent call sites, `ai-draft/generate-draft.use-case.ts`.

6. **Tests** (extend existing specs; register any NEW file in `apps/ai-gateway/package.json` `test` — the list is hand-maintained, unregistered specs silently never run):
   - `bedrock.provider.spec.ts`: mock `client.send` capture → assert system cachePoint ≥/< threshold; cacheableContext block order (context, checkpoint, text); attachments unaffected; `ai.usage` line emitted with cache fields (spy `console.log`); generateWithTools same; failure path logs `ok:false` + `errorCode`.
   - `intent-router.agent.spec.ts`: `route()` provider stub asserts `cacheableContext` contains `enabledFeatures` and message text does not; catalog serialization is byte-stable across two builds.
   - `openai.provider.spec.ts`: prepend behavior.
   - Run the business-query regression spec (`line-ai-business-query-regression.spec.ts` — already registered) to confirm plan parsing is unaffected.

7. **Verification commands** (record outputs in task memory):
   ```bash
   pnpm --filter @watchdog-bms/ai-gateway typecheck
   pnpm --filter @watchdog-bms/ai-gateway test
   ```
   - Live smoke (spec A7): a throwaway script (do NOT commit) calling `BedrockProvider.generateText` twice with the real `RECEIPT_OCR_PROMPT` + a short user text; assert call 2 logs `cacheReadInputTokens > 0`. Region `ap-southeast-1`; model from root `.env` `BEDROCK_MODEL_ID`; AWS creds: `AWS_PROFILE=watchdog-bedrock` (default profile is expired).

8. **Do not** commit, deploy, or touch `apps/api` / `apps/web`. Leave the working tree with only the intended diffs (shared worktree — never `git add -A`, and re-read files before editing; another session may have touched them).

## Environment traps (from prior sessions)

- Node via nvm: prefix `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"` on every shell command (default shell resolves Node 14, which breaks pnpm/tsx).
- Zscaler TLS: outbound Node TLS needs `NODE_EXTRA_CA_CERTS` if the live smoke fails with cert errors; the AWS CLI path works with proxies stripped (`env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy`).
- `tsx --test` runs only the files listed in the package's `test` script.
- Ponytail full mode applies: shortest correct diff, reuse existing patterns (e.g. the `console.log(JSON.stringify(...))` observability precedent), no speculative abstraction, no new dependency.

## Rollout note (out of task scope)

Effect reaches prod only after an ai-gateway deploy. Prod deploy via `infra/prod-ecs-express/deploy.sh` (canary + rollback alarm — do not probe during bake); UAT must NOT be deployed via deploy.sh from a workstation (env-preserve runbook: copy live config, swap image only).
