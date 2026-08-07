# LINE AI Voice Message (Speech-to-Text Intake) Spec

## 1. Goal

Let an employee send a LINE voice message to the employee OA and get the same AI answer they would get by typing: the audio is transcribed server-side, the transcript enters the existing buffered text pipeline unchanged, and the reply shows what the system heard so mis-transcription is visible and correctable before anything is acted on.

Field discovery (2026-07-30, real staff users) found employees prefer speaking over typing: they already use LINE's client-side voice-to-text ("voice พิมพ์") and asked to "voice สั่งเลย" — send the voice note itself. Today the employee OA silently ignores voice messages (Section 4), which is the worst possible response shape: the user speaks and nothing happens.

## 2. Discovery Evidence

Observed with real employees on the employee OA (2026-07-30 field test):

1. Thai typed with spelling variance (พิมพ์ผิดถูกบ้าง).
2. Thai–English code-switched compounds (คำประสมไทย-Eng).
3. Fragmented, non-continuous conversation (คุยไม่ต่อเนื่อง).
4. Heavy use of LINE client voice-to-text as a typing substitute.
5. Explicit ask: send the voice note directly, no typing step at all.

Findings 1–2 and the voice-to-text output of 4 are input-robustness concerns handled by the LLM layer and measured by the transcript eval set (plan Phase 0); they need no new machinery in this spec. Finding 3 is already addressed structurally by the message buffer (multi-bubble joins) and the conversation context window (`LINE_AI_CONTEXT_WINDOW_MINUTES` / `LINE_AI_CONTEXT_MAX_TURNS`); re-tuning those is out of scope here. Finding 5 is this spec.

## 3. Non-goals

- No voice replies (TTS) — replies stay text/flex.
- No inline audio player anywhere (reaffirms owner decision 2026-07-06 in `crm-inbox.logic.ts`: "Future direction is voice-to-text first, not an inline player").
- No CRM customer-OA voice support in this iteration (Section 19; the customer-side fail-marker behavior is unchanged).
- No speaker identification, voiceprints, or any biometric use of the audio. Audio is used solely to produce a transcript.
- No streaming/real-time transcription UX; one voice note = one (buffered) turn.
- No persistence of audio bytes (Section 12).
- No LINE `video` message support (stays ignored on the employee OA, fail-marker on CRM).

## 4. Current State Evidence

- `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` enqueues only `text` and `image | file` events; an `audio` event falls through the loop — no buffer item, no reply, no log beyond the generic webhook receipt. The employee gets silence.
- LINE delivers voice notes as ordinary message events: `message: { id, type: 'audio', duration }` (duration in ms), binary fetchable from `GET /v2/bot/message/{id}/content` as AAC/M4A — the same content endpoint `downloadLineMedia` (`process-line-webhook.use-case.ts:1747`) already uses for images and files.
- The message buffer (`line-ai-message-buffering-spec.md`) gives us ack-fast intake, per-chat serialization, dedup with orphan recovery, reply-token push fallback, and a 60 s loading animation — all directly reusable for a slow STT hop.
- The AI Gateway already has multi-provider governance: `createProvider` + `assertApproved` against `APPROVED_AI_PROVIDERS` / `APPROVED_AI_MODEL_IDS` / approved regions (`provider.factory.ts`), with per-vendor processing-region config (`OPENAI_PROCESSING_REGION`, `TYPHOON_PROCESSING_REGION`) and a deploy-time preflight for vendor config gaps (`infra/prod-ecs-express/deploy.sh` M-05 Typhoon block).
- Usage metering is in place end to end: gateway routes append `AiUsageEntry` (which already carries `durationMs` — `packages/contracts/src/ai-lineage.ts`), the API prices entries into satang (`ai-model-pricing.ts` `computeCostSatang`) and records `AiUsageEvent` rows (free-string `sourceRoute`/`usageTag`/`modelId` — no migration needed for a new lane), and `assertCompanyAiBudget` enforces the monthly cap bucket-agnostically.
- Per-turn model lineage exists: `AiTurn.modelProvider/modelId/modelRegion/modelPurpose/modelLineageJson`. Receipt OCR already records a two-hop lineage (Typhoon OCR read → Bedrock understanding), registered in `docs/security-evidence/p1-ai-processor-lawful-basis-register.md` (rows P2/P3). Voice adds an analogous STT hop.
- Privacy posture to inherit: `LineWebhookEventLog` stores hashes only; `AiTurn` stores preview (≤120 chars) + SHA-256 prefix, never full raw text.

## 5. Design Overview

One new capability (STT), zero new pipeline shapes. The voice note becomes a text buffer item as early as possible, and everything downstream is the existing, unchanged flow:

```
LINE webhook POST (audio event)
  └─ Intake (controller): accept type 'audio' → duration gate → enqueue { kind: 'audio' } → 200
       └─ Buffer: audio buffers exactly like text (debounce/max-wait/caps unchanged)
            └─ Dispatch (worker, per batch, before segmentation):
                 resolve each audio item → download content (LINE) → AI Gateway /internal/ai/line-stt
                 → replace item with a text item (same timestamp/seq, sourceModality 'voice')
                 → STT failure/empty/oversize → item becomes a fixed-reply segment
            └─ Segmentation & dispatch: UNCHANGED — transcript joins bubbles, becomes
               caption for media in the same group, forms turns via execute()
                 └─ Reply: prefixed with 🎙️ "<transcript>" so the user sees what was heard
```

Key property: because substitution happens before `segmentBatch`, every buffering-spec semantic (§6–§10 of `line-ai-message-buffering-spec.md`) is inherited without modification — bubble joining, caption consumption, command ordering, serial replies, push fallback, orphan recovery.

## 6. Intake Rules (controller + buffer item)

- `line-webhook.controller.ts` gains an `audio` branch mirroring the media branch: requires `message.id`; enqueues `{ kind: 'audio', webhookEventId, replyToken, lineMessageId, durationMs: message.duration, timestamp }`.
- The `LineMessageEvent` local type gains `duration?: number`.
- **Feature flag**: `LINE_AI_VOICE_ENABLED=false` (default) → the audio branch still enqueues, but dispatch resolves the item straight to the disabled fallback reply (Section 10). Flag off must NEVER mean silence again — the un-ghosting reply ships in all states.
- **Duration gate at intake**: `duration > LINE_AI_STT_MAX_DURATION_MS` (default 120 000) → enqueue as an oversize marker; dispatch replies the too-long fallback without downloading. LINE supplies `duration`, so no bytes are fetched for oversize notes.
- Buffer accounting: an audio item counts as 1 item toward the 20-item cap and 0 chars toward the 4000-char cap pre-resolution (the transcript's real length applies naturally to any LATER batch, not retroactively; accepted).
- Dedup/orphan/redelivery rules are untouched — the audio event id flows through `LineWebhookEventLog` exactly like text.

## 7. Resolution at Dispatch (buffer worker)

At `dispatchBatch`, after the batch snapshot and before `segmentBatch`:

1. For each `audio` item, in batch order: download bytes via the existing LINE content-endpoint pattern (audio variant of `downloadLineMedia`; size guard `LINE_AI_STT_MAX_CONTENT_BYTES`, default 5 MB — 120 s of LINE AAC is well under 1 MB).
2. Call the AI Gateway STT route (Section 8) with base64 audio + `durationMs` — the same base64-over-internal-HTTP shape receipt OCR uses.
3. Success → replace the item in place with `{ kind: 'text', text: transcript, sourceModality: 'voice', … }` preserving `webhookEventId`, `replyToken`, `timestamp`, `seq`.
4. Empty/whitespace transcript (silence, music) → failed-item semantics.
5. Failure (download error, STT error, timeout `LINE_AI_STT_TIMEOUT_MS` default 30 000, budget refusal) → the item becomes its own fixed-reply segment (Section 10) dispatched in order; other items in the batch process normally. Its event row gets a terminal status (`stt_failed` / `stt_disabled` / `stt_too_long`) so redelivery cannot double-charge STT.
6. Mixed batches: after substitution the transcript is ordinary text — it joins neighboring bubbles into one utterance and is consumed as media caption per buffering-spec §8. A voice note + receipt photo in one burst yields a receipt turn whose caption is the transcript (this is the expected field usage: photo + spoken description).
7. Resolution happens inside the serial worker: STT latency occupies the chat's single processing slot; later bubbles merge into pending per §7 of the buffering spec. No concurrency change.

## 8. STT Execution: Gateway Route and Governance

STT is a vendor AI call, so it lives in the AI Gateway behind the existing provider governance, not in the API (mirrors receipt OCR's first hop):

- New internal route `POST /internal/ai/line-stt` (internal-secret auth like siblings): request `{ requestId, companyId, audioBase64, mimeType: 'audio/m4a', durationMs, languageHint: 'th' }`; response `{ transcript, sttModelId, sttProvider, sttRegion, usage: AiUsageEntry[] }`.
- Provider selected by `STT_PROVIDER` (`disabled` default) through a factory following `provider.factory.ts` conventions, with `assertApproved(provider, modelId, region)` against the SAME approved-provider/model/region lists — an STT vendor is not exempt from data-residency governance.
- Config validation (packages/config, mirroring the Typhoon OCR rules): when `STT_PROVIDER` ≠ `disabled`, `STT_MODEL_ID` and `STT_PROCESSING_REGION` are required, the region must be approved, and the provider must be in `APPROVED_AI_PROVIDERS`; deploy.sh preflight reports all gaps in one pass (M-05 pattern).
- The route runs inside the existing usage-context interceptor, appending one `AiUsageEntry` per call: `tag: 'stt'`, `modelId`, `ok`, all token fields 0, real `durationMs` (of the AUDIO, not wall clock — the pricing unit).
- No permissions/tools are involved: STT is a pure transformation ahead of the permission-checked turn; the transcript then goes through the normal permission-checked pipeline. The gateway must not log transcript text (existing `ai.usage` log shape carries counts, never content).

## 9. STT Provider Selection

The default vendor is pinned by a measured probe (plan Phase 0) over 20–30 real employee voice clips (Thai + code-switch, phone-in-field acoustics), scoring transcript quality on the terms that matter here (Thai orthography, Thai–English mixing, spoken numbers/amounts), latency, and residency. Facts known today:

| Candidate | In stack today | Thai + code-switch | Latency shape | Residency | Open questions (probe) |
|---|---|---|---|---|---|
| `typhoon` (SCB10X) | Yes — Typhoon OCR is the receipt OCR first hop; secret + region governance + PDPA row exist | Built for Thai, incl. code-switch (their stated focus; matches our exact pain) | API, expected seconds | `TYPHOON_PROCESSING_REGION` = ap-southeast-1 already approved | Does their API expose ASR/audio today? Pricing? m4a accepted? |
| `openai` (whisper family / 4o-transcribe) | Provider + region governance exist (`OPENAI_API_KEY`, `OPENAI_PROCESSING_REGION`); key not currently provisioned in prod task def | Proven good Thai, good code-switch | ~1–3 s, m4a native | US processing — needs region approval decision | Prod key provisioning; model choice (`whisper-1` vs `gpt-4o-mini-transcribe`); price ~$0.006/min ≈ ฿0.1 per 30 s |
| `transcribe` (AWS) | Account-native, IAM-only (no new vendor/DPA), ap-southeast-1 | th-TH supported; code-switch historically weaker | Batch: m4a native BUT S3 staging + job startup, often 10–30 s. Streaming: fast but PCM/OGG/FLAC only → transcoding dependency (ffmpeg in image) | In-region | Real batch latency from ECS; th-TH streaming availability; whether 10–30 s turn overhead is acceptable |

Selection rule: quality on our clips wins first (a wrong amount transcribed is worse than a slow answer), then residency, then latency, then price. The pinned choice, its measurements, and rejected alternatives are recorded in `docs/agent-memory/line-ai-voice-messages.md` — and the provider port means repinning later is config + one adapter, not a redesign.

## 10. Reply UX

- **Echo-back (always, config `LINE_AI_VOICE_ECHO_ENABLED` default true)**: a turn whose utterance included voice begins its reply with `🎙️ ได้ยินว่า: "<transcript>"` (transcript clamped to 200 chars + ellipsis), then the answer. This is the trust mechanism: the user sees the machine's hearing and can immediately correct it. It doubles as implicit consent UX — the person sees their speech became text.
- **Fixed replies** (existing reply/push adapters):
  - Disabled: `ตอนนี้ยังฟังข้อความเสียงไม่ได้ครับ พิมพ์ข้อความ หรือใช้ปุ่ม voice-to-text ของ LINE ได้เลย`
  - Failed/unclear/empty: `ขอโทษครับ ฟังเสียงไม่ชัด ลองอัดใหม่ในที่เงียบขึ้น หรือพิมพ์แทนได้ครับ`
  - Too long: `ข้อความเสียงยาวเกิน 2 นาที ช่วยแบ่งเป็นช่วงสั้น ๆ หรือพิมพ์แทนครับ`
- Loading animation (buffering spec §10) covers the STT wait in 1:1 chats; the push fallback covers reply-token expiry if STT + turn exceed the ~1-minute token life.

## 11. Mutation Safety Invariant

A voice-sourced turn must never reach a final mutation through any path a typed turn would not. This holds by construction — gates key on turn semantics, not input modality — and this spec adds visibility, not new gates:

- The transcript is `messageText`; intake routing, permission checks, ask-lock/clarification, and transaction-coupled finalize (CUST-02 hardening) all apply unchanged.
- The echo-back prefix plus the existing confirmation step give DOUBLE provenance on mutations: the user saw the transcript, then confirmed the action built from it. Spoken amounts ("ห้าร้อย" → 500) are the known risk; the confirm card already displays the parsed amount.
- The transcript is untrusted user data. The orchestrator already instructs models to treat `messageText`/`nContext` as data, never instructions; a spoken prompt-injection is exactly a typed one. No new surface.
- `AiTurn.modelLineageJson` for a voice turn records the STT hop `{ purpose: 'stt', provider, modelId, region, durationMs }` ahead of the LLM hop — the audit trail shows an amount originated from speech.

## 12. Privacy, PDPA, Data Residency

- **Audio bytes are transient**: held in memory for download + STT call, never written to S3/DB, never re-served. No retention policy needed for audio; LINE's own content availability window is the only copy.
- **Transcript inherits the typed-text posture exactly**: `AiTurn` preview ≤120 chars + hash, conversation context window, no full-text store; `LineWebhookEventLog` remains hashes-only. The gateway logs usage counts, never transcript content.
- **Processor register**: add a row to `docs/security-evidence/p1-ai-processor-lawful-basis-register.md` — actor: employee; data: voice audio (speech content), company id; hops: STT vendor (`STT_PROCESSING_REGION`) → Bedrock/OpenAI turn model; purpose: transcription for the employee assistant; retention: none (audio), turn-preview policy (transcript). Lawful-basis decision follows the register's existing [DECIDE] workflow.
- **Not biometric processing**: audio is used solely for content transcription; no speaker recognition, no voiceprint, nothing derived that identifies a person by voice. Stated here so the register row can say it.
- **Residency**: the vendor's processing region is config-governed and deploy-preflighted like every other AI region in this system. Choosing a US-processed vendor (OpenAI) is an explicit approval decision, not a default.

## 13. Cost and Budget

- Rate window: new `stt` bucket beside `llm`/`ocr` in `assertBudget` (`ai-gateway.client.ts:86`), limit `AI_STT_MAX_PER_COMPANY` per existing window config. Applied at the API before the gateway call, like siblings.
- Monthly cap: nothing to do — `assertCompanyAiBudget` is bucket-agnostic and the STT usage rows (below) feed the same meter, so voice spend counts against the same monthly satang budget and refuses in the same exhaustion shape.
- Metering: `AiUsageEvent` rows with `sourceRoute: 'line-stt'`, `usageTag: 'stt'`, tokens 0, `costSatang` from a per-minute price: `computeCostSatang` gains a duration branch — models present in a new `AI_STT_MODEL_PRICES` per-minute table price as `ceil-to-second(durationMs) × usdPerMinute`, same THB/FX chain, half-up satang rounding, unknown-model max-price fallback. No schema migration (all free-string columns).
- Scale sanity: at whisper-class pricing a 30 s note adds ≈ ฿0.1 on top of the existing per-turn LLM cost (`docs/agent-memory/`, AI cost-per-message measurements) — the LLM turn remains the dominant cost. Transcribe-class ≈ ฿0.4/30 s. Confirm the pinned vendor's real price at probe.

## 14. Latency Budget

| Stage | Expected |
|---|---|
| Buffer debounce (unchanged) | ≤ 2.5 s |
| Content download from LINE | ~0.2–0.5 s |
| STT (vendor-dependent) | 1–3 s (API vendors) / 10–30 s (Transcribe batch) |
| Existing LLM turn | 5–15 s |

Worst case must stay under the push-fallback + loading-animation envelope (60 s), which it does for every candidate. Shutdown (SIGTERM mid-STT): the drain bound (`LINE_BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS` 25 s) may cut a Transcribe-batch resolution; the event row stays `received` and the orphan rule (buffering spec §9) recovers via redelivery — no new mechanism, but this is a real strike against a >20 s vendor.

## 15. Configuration

API (`AppConfigService` + `.env.example` sync per `docs/agent-memory/env-example-sync-local-uat-production.md`):

- `LINE_AI_VOICE_ENABLED` — default `false`. Deploy ≠ launch; UAT turns it on first.
- `LINE_AI_STT_MAX_DURATION_MS` — default `120000`.
- `AI_STT_MAX_PER_COMPANY` — per-window rate cap, default sized from `AI_OCR_MAX_PER_COMPANY`'s reasoning.
- Constants (not env): `LINE_AI_STT_TIMEOUT_MS = 30_000`, `LINE_AI_STT_MAX_CONTENT_BYTES = 5_000_000`, echo clamp 200 chars.

Gateway (`AiGatewayConfigService` + packages/config validation):

- `STT_PROVIDER` — `disabled` (default) | `typhoon` | `openai` | `transcribe`.
- `STT_MODEL_ID`, `STT_PROCESSING_REGION` — required when enabled; region must be in `APPROVED_AI_REGIONS`; provider must be in `APPROVED_AI_PROVIDERS`.
- Credentials: reuse the vendor's existing secret/role pattern (`TYPHOON_OCR_API_KEY`-style secret, `OPENAI_API_KEY`, or task-role IAM for Transcribe — the last needs an owner-granted IAM change; note the account's provisioning ceiling).

## 16. Deploy / Ops Impact

- Task-def env additions on BOTH services (api: 3 vars; gateway: 3 vars + possible secret ARN) via `infra/prod-ecs-express/deploy.sh` — follow the metering deploy's pending-env pattern; UAT gets them by config-copy (never a workstation `deploy.sh` run against UAT — env-preserve trap).
- deploy.sh preflight: STT gap check mirroring the M-05 Typhoon block (secret/provider/region coherence reported in one pass).
- If `transcribe` is pinned: IAM policy addition to the task role (`transcribe:*Transcription*` + S3 staging bucket if batch) — owner console action, blocked-by-IAM risk same as M-14.
- No DB migration. No new container dependency unless Transcribe-streaming forces ffmpeg (a probe outcome that weighs against choosing it).
- Rollback: `LINE_AI_VOICE_ENABLED=false` reverts to the polite-decline state (never to silence); `STT_PROVIDER=disabled` fails closed to the same.
- Canary note: STT calls during bake are ordinary gateway traffic; no ALB-4xx interaction beyond existing AI routes.

## 17. Failure Mode Matrix

| # | Scenario | Behavior | Mechanism |
|---|----------|----------|-----------|
| 1 | Voice note, feature off | Polite decline reply (never silence) | disabled fallback at dispatch |
| 2 | Voice note, happy path | Transcript turn + 🎙️ echo prefix | resolve-at-dispatch |
| 3 | Voice + text bubbles in one burst | One joined utterance incl. transcript | substitution before segmentation |
| 4 | Voice note + receipt photo | Receipt turn with transcript as caption | buffering spec §8 inherited |
| 5 | Silent/music audio | "ฟังไม่ชัด" reply | empty-transcript rule |
| 6 | Note > 2 min | "ยาวเกิน" reply, no download | duration gate at intake |
| 7 | STT vendor down/timeout | "ฟังไม่ชัด" reply for that item; other items unaffected | failed-item segment |
| 8 | STT rate window exceeded | Existing rate-limit reply shape | `stt` bucket in assertBudget |
| 9 | Monthly budget exhausted | Existing exhaustion reply shape | bucket-agnostic monthly cap |
| 10 | Redelivery after STT charged | No second STT call | terminal event-row status |
| 11 | SIGTERM mid-STT | Row stays `received`; orphan redelivery reprocesses | buffering spec §9 |
| 12 | Spoken amount mis-heard | Echo shows it; mutation confirm shows parsed amount | §11 double provenance |
| 13 | Spoken prompt injection | Same handling as typed injection (data, not instructions) | existing orchestrator rules |
| 14 | Group chat voice note | Same path; reply to group; no loading animation | chat key unchanged |
| 15 | Audio > size cap | "ฟังไม่ชัด" reply, download aborted | content-bytes guard |
| 16 | CRM customer OA voice note | Unchanged fail-marker row, no player | out of scope, §19 |

## 18. Acceptance Criteria

- A voice note on the employee OA with the feature disabled gets the decline reply within normal turn latency — silence is impossible in any configuration.
- A clear Thai voice note produces exactly one AiTurn whose `messageText` is the transcript, whose reply starts with the 🎙️ echo, and whose `modelLineageJson` contains an STT hop with provider/model/region/durationMs.
- A voice note + caption-less receipt photo in one burst produces a receipt turn whose intake caption equals the transcript.
- A mutation initiated by voice shows the standard confirmation with the parsed values before finalize; declining works as with text.
- An `AiUsageEvent` row exists per STT call (`sourceRoute 'line-stt'`, tokens 0, satang priced per minute), and month-to-date spend reflects it; at cap, the voice turn refuses in the standard exhaustion shape.
- Gateway config validation fails boot when `STT_PROVIDER` is enabled with a missing/unapproved model or region; deploy preflight reports the same gaps pre-rollout.
- No audio bytes exist at rest after a turn (code inspection + no storage writes on the path); no transcript full text in `LineWebhookEventLog`, logs, or `AiTurn` beyond the preview policy.
- Empty-transcript, oversize, vendor-down, and redelivery scenarios behave per the matrix (unit-tested at the buffer logic level; vendor-down also live-verified with a bad key on local).

## 19. Out of Scope / Future

- **CRM customer OA voice** (phase 2 candidate): same STT route is reusable; requires the owner to revisit the 2026-07-06 decision, plus inbox UI for transcripts and the CRM message-store contract (`isDownloadableLineMedia` / fail-marker semantics). Trigger: customer-side demand evidence.
- Transcribe-streaming (or any vendor swap) behind the same port; trigger: probe data or vendor issues.
- Re-tuning buffer debounce / context window from field data (discovery finding 3) — separate small change, measured first.
- Retrying STT with a second vendor on low-confidence results; voice-note re-listen UI; per-user language hints.

## 20. Linked Docs

- [[specs/line-ai-message-buffering-spec|LINE AI Message Buffering Spec]] (§6–§10 semantics inherited)
- [[specs/ai-usage-metering-and-monthly-budget-spec|AI Usage Metering & Monthly Budget Spec]] (lane pattern extended)
- [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
- [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
- `docs/security-evidence/p1-ai-processor-lawful-basis-register.md` (new STT row required)
- Plan: [[plans/line-ai-voice-message-plan|LINE AI Voice Message Plan]]
