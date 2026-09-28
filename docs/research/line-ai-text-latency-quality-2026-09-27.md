# LINE text latency and quality evidence — 2026-09-27

Status: **the Starter OWNER smoke failed useful-answer acceptance on both turns.** The local synthetic sink accepted two text replies, but neither answered the user’s question. This is a diagnostic result, not production acceptance or proof of a latency improvement.

## Run identity and scope

- Source: frozen candidate `e51b9a59a89dd376c58fab808b72bd1593d8363f`; the worktree was clean for the build and run.
- Provider: Bedrock `global.anthropic.claude-sonnet-4-6`, `ap-southeast-1`, `strands-local` over local HTTP. Profile approval reference: `DPO-2026-07-23-bedrock-global`.
- Tenant fixture: synthetic `STARTER_249` OWNER. It seeded all 62 canonical entitlement rows (17 enabled, 45 disabled), 334 production OWNER grants filtered by Starter entitlements, and one effective branch (`branch-bkk`). The paid term limits were one branch, two employees, and 30 monthly slips. The runtime resolver/effective permission guards passed before the provider calls. No broad permission/feature union was applied.
- Local-only boundary: dedicated task database `watchdog_ai_reliability_replay_starter_owner_20260927`, Redis DB 14, API port 19194, Gateway port 19195, and the repository’s synthetic HTTP LINE sink. No live customer, production write, public lookup, native LINE delivery, or deployment was involved. The evidence records `nativeLineVerified=false` and `cacheStateVerified=false`.
- Prompts, in one conversation with the same seeded snapshot:
  1. `เดือนนี้ค่าไช้จ่ายไปเท่าไหร่แล้ว`
  2. `รายการยืนยันแล้ว แปลว่าจ่ายเงินแล้วหรือยัง`
- Exact runner command from the frozen repository root: `pnpm exec tsx /tmp/mangmee-latency-pilot-20260927/run-starter-owner-smoke.ts`.

The runner and safe manifest hashes are respectively `60ad9aeaa89cfeb8ed424a09ff7e9e72cd38b5efc6473cc2c19feed8259efad6` and `83e2ffc975af23e6afb9d0b376f6ec0e63298737e28e2c514fa29564535a4d14`. The raw evidence hash is `2d3ab9bb4a32ba1d68cb630e895e0c624324318d3d1d875675d74590f03fefda`. Artifacts remain under `/tmp/mangmee-latency-pilot-20260927/`:

- `starter-owner-smoke.e51b9a59.redis14.json`
- `starter-owner-smoke.e51b9a59.redis14.manifest.safe.json`
- `run-starter-owner-smoke.ts`
- `launch-gateway-starter-owner.py`

The compiled files were captured in the manifest. Key SHA-256 values: API webhook use case `0f807f294b21e03774beb90dd1ef51ad20f3790fbc9c387cda477647d2d1f07a`; API delivery plan `de9cef9575cd086bf50c389fefde4b1c88bf1e757818cab4a26ad7d2621d45aa`; Gateway intent router `3aeef9468abf43dfa8d6276f35a25be9fc32bc4cabcb49d90827871c60f9d24c`; Gateway orchestrator `9e2ad5fc43b79c9c8df1219481e87ddfd87024c1d95215628c34c8c1d9920103`; Gateway semantic turn `987f9313f475bce6a7c28340a86839d2e35e9ea694c3e1b019d6f416dfc221f3`.

## Turn results

| Turn | Model work and observed latency | Actual accepted sink text | Reviewed result |
|---|---|---|---|
| 1 — current-month expense typo | One provider call (`line.intake-route`), 5,293 ms; 1,431 input / 313 output tokens; 141 satang. Accepted → model work complete: 6,702 ms. Accepted → synthetic sink: **6,750 ms**. | `ยังตรวจสอบคำขอนี้ไม่ได้ค่ะ ยังไม่ได้ทำรายการให้ กรุณาลองใหม่` | **Fail.** Intake proposed a `simple_grounded` single-metric plan for `expense.get_breakdown` with 2026-09-01 through 2026-09-27 filters. No tool was invoked and no expense total, source, or status basis was delivered. |
| 2 — confirmed versus paid | Three calls: intake 4,446 ms (1,597 / 251 tokens, 37 satang), `line.loop` 9,334 ms (3,668 / 770 tokens, 74 satang), and `line.compose` 7,201 ms (1,608 / 556 tokens, 43 satang). Total turn usage: 6,873 input / 1,577 output tokens, 154 satang. Accepted → model work complete: 22,269 ms. Accepted → synthetic sink: **22,318 ms**. | `ยังตรวจสอบส่วนนี้ไม่ได้ กรุณาระบุคำขอส่วนนี้อีกครั้ง` | **Fail.** Intake recognized the question as an explanation of “confirmed” versus “paid,” but the conversation produced no explanation and asked the user to restate it. No tool or source was used. |

Both HTTP sink batches were accepted. Each payload was a text message with quick-reply buttons; neither contained a business answer card, source references, labels, or web links. Both turns had empty tool results, `toolsInvoked`, and side-effect/effect records. Thus the smoke confirms safe non-mutation and local sink acceptance, but not task completion, a useful answer, source-grounded delivery, or native LINE rendering. Synthetic sink receipt IDs are `sink-040cf132-f841-45a8-acd8-5bed136cbe4b` and `sink-5d7ee1f7-0755-482d-bc4e-afc9838f9074`.

## Failure attribution and scoring

The first turn’s exact source path was independently traced by the implementation owner. The prepared-read eligibility check rejects `expense.get_breakdown::single_metric` as `formatter_family_not_allowed` because the only enabled deterministic family in this fixture is `expense.list_recent::single_metric` ([prepared-simple-read.logic.ts:92](/Users/thawatchai/.codex/worktrees/mangmee-ai-spec-v24/mangmeeplus/apps/ai-gateway/src/modules/line-ai/domain/logic/prepared-simple-read.logic.ts:92)). The two-slot non-general guard then returns `PREPARED_READ_UNAVAILABLE` without invoking a full-path tool ([orchestrator.agent.ts:1044](/Users/thawatchai/.codex/worktrees/mangmee-ai-spec-v24/mangmeeplus/apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts:1044)). The intake prompt directs total questions toward `expense.list_recent`, but its available scoped catalog allowed the incompatible `expense.get_breakdown` proposal. This is a confirmed planning/catalog-family mismatch; no attempt was made to bypass the guard.

For turn 2, `SEMANTIC_CONTROL_UNAVAILABLE` means the `calls`/`questions` control response failed the semantic-turn-v2 validation predicate ([semantic-turn-v2.ts:162](/Users/thawatchai/.codex/worktrees/mangmee-ai-spec-v24/mangmeeplus/apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts:162)). The runner did not capture the provider’s raw control JSON, so the specific malformed/missing field is **unknown** and is not inferred. The Gateway log exposed provider usage only; no raw model text is available for this run.

The generic record scorer marks `semanticCorrect=true`, `factsCorrect=true`, `effectsCorrect=true`, and `completed=true` for the scenario. Those labels are not an acceptance pass: both turn traces have `outcome=needs_input`, no facts/tools/effects, and sink replies that do not answer either prompt. Human task-level review therefore records both turns as **FAIL**; the raw scorer labels were preserved unchanged in the evidence artifact.

## Spend accounting and limits

Across the previous 16 paid text turns plus this two-turn smoke, the saved usage artifacts contain **18 text turns and 28 provider calls**. Summed provider-reported usage fields are 56,535 `inputTokens`, 197,950 cached-read input tokens, 51,630 cached-write input tokens, and 12,214 output tokens; the local ledger estimates 1,998 satang total cost. The earlier turns were baseline/candidate pilot (4 turns/4 calls), a baseline repeat slice (2/2), and a ten-turn baseline diagnostic (10/18); this Starter smoke adds 2 turns/4 calls. These runs used different fixtures/profile scopes and are not one paired experiment. The cost is the local usage ledger estimate, not a provider invoice.

The first Redis-13 runner attempt was safely stopped before any provider call because the runtime ownership guard found two pre-existing keys. Its unchanged failure artifact is `attempt-redis13.json`; DB 13 was not flushed. A read-only check found DB 14 empty, and the measured attempt used DB 14. The setup failure contributes zero calls and is excluded from the 18/28 usage total.

The current Starter run is one conversation (`n=1`), with cache state unverified and no matched baseline using the same Starter OWNER snapshot. It cannot establish median/p95 latency, an SLO, a production result, or improvement over baseline. A fast refusal does not count as successful useful-answer latency. The correct outcome is that both tasks failed, with the second taking 22.318 seconds end to end at the local synthetic sink.

## Related evidence

The separate four-call NAT-01/NAT-02 broad-fixture pilot and its manual review are in `/tmp/mangmee-latency-pilot-20260927/attempt-review/paired-pilot-review.md`. That review also warns that the faster NAT-02 candidate reply answers cash receipts rather than the asked sales metric, so it is not a successful-answer latency sample. It is not evidence for the current Starter OWNER profile.
