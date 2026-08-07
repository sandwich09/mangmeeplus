# Agent Memory: ai-prompt-caching-usage-logging

Status: COMMITTED 2f09868e on develop (2026-07-26) — NOT pushed; deploy pending owner decision.
Owner: thawtchai (request 2026-07-26: "ทำ prompt caching ทั้งฝั่งแชทและ OCR + log token usage; Fable plan/spec + business check, Opus 5 codes/tests/reviews")
Scope: apps/ai-gateway only, 23 files (+625/−49) — bedrock provider (Converse cachePoint + ai.usage log via single converse() helper), openai provider parity, provider port (cacheableContext/usageTag), intent-router route() catalog→cacheableContext, usageTag at 19 call sites, tests (+13).
Decisions:
- Converse API → `cachePoint {type:'default'}` blocks (NOT anthropic cache_control); SDK 3.1075.0 native support, no dep change.
- CACHE_MIN_CHARS = 4000 exported (review corrected initial 3000 ≈ 955 tok < 1024 floor). Sub-min checkpoint = ignored by Bedrock, no billing — gate avoids dead checkpoints.
- Checkpoints cover the WHOLE prefix before them: route()'s catalog checkpoint caches system+catalog together (live-verified 5,094-token read) even though INTENT_ROUTER system alone is sub-threshold.
- ai.usage log = console.log JSON in provider `finally` (exactly one line per call, structurally; logUsage self-guarded); counts only, no content (PDPA posture).
- Review round (Opus 5, CHANGES_REQUIRED → fixed): logUsage moved out of success-try (double-log risk), generateWithTools parsing back inside error boundary (JSON-loop fallback preserved), context never dropped when no user turn, openai never logs ok:true for failures, +tests for tools-path context and openai usage.
- Deliberately NOT cached at current sizes: line.loop systems (~1.9–2.1k chars, spec's ~4.2k estimate was wrong), CRM intake/critic/compose/polish (small prompts). crm.reply = 4,013 chars — 13 above gate; prompt trims silently drop its caching.
Open questions: none.
Artifacts:
- docs/specs/ai-prompt-caching-usage-logging-spec.md (A1–A8; §4.1/§4.6 corrected post-review)
- docs/plans/ai-prompt-caching-usage-logging-plan.md
- Smoke script (throwaway, outside repo): scratchpad cache-smoke.mts
Verification (independently rerun by coordinator):
- typecheck clean; test 436/436; test:line-ai-business-coverage 361/361 (regression corpus — NOT in default test script).
- Live smoke ap-southeast-1 / global.anthropic.claude-sonnet-4-6, call-2 ai.usage lines: receipt shape cacheReadInputTokens=2174; route() shape cacheReadInputTokens=5094 (system+catalog), plan still ROUTABLE w/ sales.get_sales_summary. No ValidationException.
- Business check (Fable): all production prompts byte-identical (diff touches no *_PROMPT const); gates untouched (isExpenseExtractionEligible, CRM auto-reply consent/cap/confidence, permission checks, business-document-classification.logic); catalog moved within the same user turn (model-visible content equivalent); logs content-free.
Expected effect after deploy (@฿32.5/USD): receipt scan ฿0.44→~฿0.25; employee business question ฿1.33→~฿0.7 (loop lane uncached); customer answered msg ฿0.39→~฿0.30. Savings need repeat traffic within 5-min TTL windows.
Next: owner decides commit (surgical staging — shared worktree has unrelated dirty files) → deploy ai-gateway (prod via deploy.sh canary; UAT ONLY via env-preserve image-swap runbook) → after a few days read ai.usage lines from CloudWatch to answer cost questions from real data.
