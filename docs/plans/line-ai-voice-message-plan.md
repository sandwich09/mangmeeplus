# LINE AI Voice Message Plan

Spec: `docs/specs/line-ai-voice-message-spec.md`
Task memory: `docs/agent-memory/line-ai-voice-messages.md`

## Sequencing rationale

Un-ghosting ships first because it is a five-line fix to the worst current behavior (silence) and it is also the permanent disabled/fallback state of the full feature — nothing about it is throwaway. The vendor probe comes before any provider code because the pinned vendor decides the only genuinely open design inputs (latency shape, transcoding need, IAM vs API-key plumbing, price table); building an adapter before measuring would be guessing with code. The pipeline phase lands entirely behind `LINE_AI_VOICE_ENABLED=false`, so deploy and launch are separate decisions, and metering/governance completes before UAT enablement because a cost-bearing lane must never run unmetered (metering spec principle).

## Phase 0a — Un-ghost voice notes (ship immediately)

- `line-webhook.controller.ts`: accept `message.type === 'audio'` (extend the local `LineMessageEvent` type with `duration?: number`), enqueue a new buffer item `kind: 'audio'` carrying `durationMs`.
- `line-message-buffer.logic.ts`: add the `audio` item kind (1 item / 0 chars toward caps); segmentation treats an unresolved audio item as its own group.
- `line-message-buffer.service.ts`: dispatch of an audio group replies the spec §10 decline text via the existing reply adapter and marks the event row terminal (`stt_disabled`).
- Tests: controller enqueues audio with duration; buffer logic segments audio items; dispatch replies decline + terminal status. Register every new spec file in the hand-maintained `apps/api` `package.json` test list (unregistered specs silently never run).
- Verify: `pnpm --filter api test` (registered files) + one manual voice note against local dev responding with the decline.

Exit: a voice note always gets the polite decline within normal latency; silence is structurally impossible from here on.

## Phase 0b — Transcript eval set + STT vendor probe (local only, no deploy)

- Collect 20–30 real employee voice clips + the field-test chat transcripts, with the owner asking the pilot group for consent; store clips OUTSIDE the repo (scratch/local), reference results only.
- Scratch probe harness (local, following the prompt-iterate-locally rule): for each candidate — Typhoon (confirm ASR API availability first), OpenAI (`whisper-1` and `gpt-4o-mini-transcribe`), AWS Transcribe batch th-TH (and streaming th-TH availability check) — measure per clip: transcript quality on Thai orthography / Thai-Eng code-switch / spoken numbers-amounts (manual scoring, amounts weighted highest), wall-clock latency from ap-southeast-1 perspective, price per clip.
- Also run the collected TYPED transcripts (findings 1–2) through the current local gateway to baseline whether typo/code-switch failures are real and where (chat vs tool lookup) — this decides whether any retrieval-fuzziness follow-up is warranted, separately from this feature.
- Pin the vendor by the spec §9 selection rule; record the decision, measurements, rejected options, and Typhoon-API findings in the task memory doc.

Exit: `STT_PROVIDER` default target pinned with numbers attached; typo/code-switch baseline recorded.

## Phase 1 — STT pipeline behind the flag

- Contracts (`packages/contracts`): `LineSttRequest` / `LineSttResponse` (+ `usage?: AiUsageEntry[]` on the response, additive pattern). Rebuild contracts dist before typechecking dependents (stale-dist trap).
- Gateway: `/internal/ai/line-stt` route on the line-ai internal controller; STT provider factory + the pinned vendor's adapter (one adapter only — the factory IS the port; follow `provider.factory.ts` + `assertApproved` conventions); config getters `sttProvider/sttModelId/sttProcessingRegion`; packages/config validation rules (required-when-enabled, approved provider/region) with unit tests; usage-context entry (`tag 'stt'`, tokens 0, audio `durationMs`); no transcript text in any log line.
- API: `requestLineStt` on `AiGatewayClient` with `assertBudget('stt', …)` (`AI_STT_MAX_PER_COMPANY`); audio variant of the LINE content download with the size guard; buffer-worker resolution step (spec §7) — substitution before `segmentBatch`, failed/empty/oversize/disabled → fixed-reply segments with terminal event statuses; 🎙️ echo prefix on voice-sourced turns (`LINE_AI_VOICE_ECHO_ENABLED`); STT hop appended to `AiTurn.modelLineageJson`.
- Tests, all registered in BOTH hand-maintained lists (`apps/api`, `apps/ai-gateway`): buffer resolution success/empty/fail/oversize/mixed-with-photo (caption = transcript); echo-prefix clamp; gateway route auth + approved-config rejection + usage entry shape; client rate-bucket refusal shape; redelivery-after-terminal no-recharge.
- Boot: new injectables mean `pnpm --filter api build` (swc) + boot probe (DI failures only surface at boot — tsx probes give false ghosts).
- Verify locally end to end: full local stack + local gateway with the pinned vendor's real key; one real voice note → transcript turn; one voice+photo burst → caption behavior; bad key → "ฟังไม่ชัด" path.

Exit: with the flag on locally, spec §18 criteria 2–4 demonstrable; with the flag off, Phase 0a behavior byte-identical.

## Phase 2 — Metering, governance, deploy, UAT enable

- Metering: `AI_STT_MODEL_PRICES` per-minute table + duration branch in `computeCostSatang` (ceil-to-second, half-up satang, unknown-model max-price fallback + warn); `sourceRoute 'line-stt'` wired through `recordCompanyAiUsage` at the client seam; unit tests against pinned prices (register them).
- PDPA: add the STT processor row to `docs/security-evidence/p1-ai-processor-lawful-basis-register.md` (purpose, hops, region, no-audio-retention, not-biometric) following the register's [DECIDE] workflow with the owner.
- Deploy plumbing (`infra/prod-ecs-express/deploy.sh`): api + gateway env additions; STT preflight gap check (M-05 Typhoon pattern: secret/provider/region coherence in one pass); vendor credential per its existing pattern (Typhoon-style secret / `OPENAI_API_KEY` / task-role IAM for Transcribe — IAM is an owner console action, provisioning-ceiling risk, request early if Transcribe won the probe).
- `.env.example` sync across local/uat/prod per the env-example-sync memory doc.
- UAT: config-copy env update only (never workstation `deploy.sh` → UAT), enable `LINE_AI_VOICE_ENABLED` on UAT first, live-verify with a real voice note + one mutation-by-voice confirm flow + budget card showing the `stt` tag; then prod enable as a config change after the standard canary.
- No DB migration in any phase — migration preflight gate is N/A (state this in the deploy checklist rather than skipping it silently).

Exit: spec §18 criteria complete on UAT; prod flag-on is a recorded owner decision.

## Explicitly deferred

- CRM customer-OA voice (owner decision to revisit + inbox UI work) — spec §19.
- Buffer/context-window re-tuning from finding 3 — separate micro-change after the Phase 0b baseline.
- Any second STT adapter, streaming transcription, or transcoding dependency unless the probe forces it.

## Verification traps checklist (from repo memory)

- Hand-maintained test lists in BOTH apps — new spec files must be registered or they never run.
- Contracts dist rebuild before dependent typecheck; swc build + boot probe for DI.
- Node via nvm PATH prefix for every shell.
- Local DB: pass `DATABASE_URL` explicitly (stale `apps/api/.env` trap).
- UAT env-preserve; prod deploy ships the dirty tree — keep the worktree clean of unrelated edits at deploy time.
- Never probe the prod endpoint during canary bake (RollbackAlarm); verify with one 200 after.
