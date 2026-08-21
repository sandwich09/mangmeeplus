# LINE AI Message Buffering and Turn Serialization Spec

## 1. Goal

Make the LINE AI assistant answer one coherent user utterance per turn, even when the user splits that utterance across multiple LINE message bubbles (for example `ขอ` / `รายชื่อ` / `ลูกค้า` meaning `ขอรายชื่อลูกค้า`), and guarantee that replies come back in the order the user sent messages except for the explicit media-only OCR lane in Section 8.

Users must never be blocked from typing. LINE Messaging API has no mechanism to disable client input, so the server buffers and serializes instead.

## 2. Non-goals

- No hard input blocking or "wait for reply" UX on the LINE client (not possible via Messaging API).
- No distributed (Redis/DB-backed) buffer in this iteration. The buffer is in-process memory with documented degradation under multiple instances (Section 12).
- No merging of fragments separated by more than the buffer window. That case stays covered by the existing semantic layer: intake router `CLARIFY` intent plus 15-minute/16-turn conversation memory (`LINE_AI_CONTEXT_WINDOW_MINUTES`, `LINE_AI_CONTEXT_MAX_TURNS`).
- No postback/rich-menu event handling changes (the webhook controller does not consume postback events today).
- No LINE `unsend` handling (removing an unsent fragment from the buffer is listed as future work).

## 3. Problem and Current-State Evidence

One webhook event is one AI turn today, and events are processed concurrently:

- `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` pushes every event of a delivery into `Promise.allSettled` — fragments in the same POST become parallel AI turns with nondeterministic reply order, all reading the same stale conversation context.
- The controller awaits full processing (including the 15s AI Gateway call, `ai-gateway.client.ts` `AbortSignal.timeout(15_000)`) before returning 200 to LINE, risking LINE-side webhook timeouts/redelivery.
- `line-reply.adapter.ts` only supports reply tokens (single-use, valid roughly one minute, not guaranteed beyond). `process-line-webhook.use-case.ts` step 10 already acknowledges delivery can fail on an expired token; the reply is then silently dropped.
- Media messages are routed with `messageText: ''` (`executeReceiptUploadInner`), so an image and its caption typed as a separate bubble are never joined; the router relies on conversation context after the fact.
- Dedup exists per `webhookEventId` (`LineWebhookEventLog.webhookEventId @unique`), but a crash after the `received` log row is created and before completion leaves the event permanently skipped ("dedup shadow") — a pre-existing hole this spec narrows.

## 4. Design Overview

Three in-process layers sit in front of the existing, unchanged permission/turn pipeline:

```
LINE webhook POST
  └─ Intake (controller): verify signature → dedup + log 'received' → enqueue items → 200 immediately
       └─ Buffer (per chat key): debounce window, max-wait, size caps → flush to batch
            ├─ Main serial queue: text, commands, and captioned media; ≤1 processing + ≤1 pending
            └─ Media-only lane: receipt jobs stay serial with each other but do not block the main queue
```

The buffer and queue are orchestration only. All identity, company, permission, audit, intake-routing, and mutation-boundary logic stays inside the existing use case, called per segment.

## 5. Buffer Item Model and Chat Key

Each accepted webhook event becomes a buffer item:

- `kind`: `text` | `command` | `media`
  - `command` = `parseLineCompanyCommand(text)` matches (`/company`, `/companies`). Command detection moves to the pure domain logic module so the intake layer can use it.
  - `media` = message type `image` | `file` (existing controller filter).
- `webhookEventId`, `replyToken`, `lineMessageId`, `timestamp` (LINE event timestamp, newly extracted), raw `text` for text/command, media metadata for media.

Chat key: `(chatId, lineUserId)` where `chatId = source.groupId ?? source.roomId ?? source.userId` (newly extracted). Keying by user alone would merge messages a user types in a group and in the 1:1 chat, and reply with the wrong token into the wrong chat.

## 6. Buffering Rules

- **Debounce**: flush when no new item arrives for `LINE_AI_BUFFER_DEBOUNCE_MS` after the last buffered item. Normatively, a gap `<= debounce` joins the current turn and a gap `> debounce` starts the next turn; implementation must make equality deterministic rather than depend on timer callback order. `0` disables buffering (every item flushes immediately; serialization still applies). The running default is 2000 ms. [[plans/line-ai-latency-and-autonomy-lanes-plan|The latency/autonomy plan]] compares 1000 ms and 1500 ms candidates before selecting the smallest safe default.
- **Max wait**: flush at `LINE_AI_BUFFER_MAX_WAIT_MS` (default 8000 ms) after the FIRST buffered item, regardless of continued typing. Anchoring at the first item prevents starvation from continuous input.
- **Size caps** (constants, not env): flush immediately when the buffer reaches 20 items or 4000 joined characters.
- **Command fast path**: a `command` item arriving while the chat key is fully idle (empty buffer, no pending batch, nothing processing) flushes immediately as a single-item batch and does not request loading — `/company` stays as snappy as today. If anything is buffered/in flight, the command is appended and forces an immediate flush of the whole buffer, preserving send order (a command must never jump ahead of an earlier query, because `/company <n>` switches the company context that query would run under).
- **Ordering**: at flush, items are sorted by LINE event `timestamp` (heals minor cross-POST arrival reordering), tie-broken by arrival order.
- **Latency trade-off (accepted)**: every text/media utterance gains up to the selected debounce before processing starts. Loading begins after durable acceptance, before the debounce wait, only when accept-time loading is enabled (`LINE_AI_LOADING_ON_ACCEPT_ENABLED`, default OFF, subordinate to the master `LINE_AI_LOADING_ANIMATION_ENABLED`); otherwise it begins at processing start. Completeness heuristics for Thai text remain explicitly rejected as unreliable.

## 7. Serial Queue and Merge-into-Pending

Per chat key:

- At most ONE batch is processing at a time. Replies therefore return in batch order.
- Exception: an uncaptioned media-only segment is handed to the per-chat media lane. The main queue may then answer later text/commands while OCR is still running. Media jobs remain serial with each other, and the selected company is snapshotted at durable acceptance so a later company switch cannot move an earlier receipt into another tenant.
- At most ONE pending batch waits behind it. A flush that occurs while a batch is processing does not enqueue a new entry if a pending batch exists — it merges into it. New items keep appending to the open buffer as usual.
- Consequence: queue depth is structurally bounded at `processing (1) + pending (1) + open buffer`. There is no unbounded queue growth.
- **Overflow guard**: if the pending batch is already at its size caps, further items are dropped with an immediate rate-limit reply (using the dropped item's reply token): `⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า กรุณารอสักครู่แล้วส่งอีกครั้ง`, plus an audit log entry. Reaching this guard means ~40+ rapid messages during one AI turn — treated as flood/abuse, not normal use.
- The pending batch is snapshot-frozen when the worker dequeues it; items arriving after that start a new open buffer.

## 8. Batch Segmentation and Dispatch

A flushed batch is split into ordered segments; each segment produces exactly one turn and one reply, reusing the existing pipeline:

1. **Command segment**: each `command` item is its own segment, dispatched as a synthesized single-message `LineTextEvent` through `execute()` (which already parses and handles company commands first).
2. **Text segment**: consecutive `text` items join with `\n` into one synthesized `LineTextEvent`:
   - `messageText` = joined text (the existing `normalizeLineText` collapses the newlines to spaces downstream — acceptable and unchanged),
   - `webhookEventId` / `replyToken` / `lineMessageId` = those of the LAST member item (freshest reply token),
   - dispatched through `execute()` unchanged.
3. **Media segments**: each media item is its own segment through `executeReceiptUpload()`, with one addition: a new optional `captionText` parameter is passed to the intake route call as `messageText` (today hardcoded `''`).

An uncaptioned media-only group is queued onto a separate per-chat media lane and the main worker continues immediately. A media group containing text remains on the main serial queue because intake may classify that text as a caption, clarification answer, or standalone question; detaching it would break company/context ordering.

Mixed text + media batch rules (caption scope is the CONTENT GROUP between
commands, not the whole batch — a `/company` switch between bubbles changes
which company the surrounding text belongs to):

- All text items of the content group join into the `captionText` given to EVERY media segment of that group (covers "photo then caption", "caption then photo", and "N receipts + one caption").
- When media is present in the group, the text does NOT also run as a standalone text segment — it was consumed as caption. Exception: if the FIRST media segment's route plan returns `BUSINESS_READ_QUESTION` or `UNSUPPORTED` (the text was a question, not a caption), the remaining media segments run caption-less and the joined text additionally runs as one text segment after them, so the question still gets answered.
- A text-only batch and a media-only batch behave exactly like today's flows, just serialized (media-only keeps `captionText = ''`).

Member-event bookkeeping: after a segment's turn completes, all member `LineWebhookEventLog` rows except the synthesized event id are marked `status = 'batched'`. The synthesized (last) id follows the existing status lifecycle inside the use case. The `AiTurn` row references the synthesized event id; `AiTurn.webhookEventId` has no unique constraint, so no schema change.

## 9. Dedup and Redelivery (revised rule)

Dedup moves to enqueue time and becomes age-aware to close the pre-existing "dedup shadow" hole:

- Log row exists with terminal status (anything ≠ `received`) → drop (already handled).
- Log row exists with `received` and age < 2 minutes → drop (currently buffered or processing, possibly on another instance).
- Log row exists with `received` and age ≥ 2 minutes → accept and reprocess (orphan: a crash lost the in-memory buffer; the redelivered LINE event carries the full payload again).
- `execute()` / `executeReceiptUploadInner()` internal dedup relaxes from "row exists" to "row exists with terminal status", because enqueue now creates the `received` row before dispatch. Their `create` of the log row already swallows unique violations, so no further change.

Notes: this rule only fires when LINE actually redelivers, which it does not once the controller has acked 200 — so it never covered a hard crash after the ack. Superseded by Section 11.1: the row now carries the buffered envelope while the turn is in flight, and the sweep replays it from our own DB. The envelope is transient (cleared at every terminal status), so the privacy posture becomes "no raw chat ids in steady state" rather than "never stored".

## 10. Reply Delivery, Push Fallback, Loading Animation

- Each segment replies with its own reply token as today. Unused member tokens are simply discarded.
- `LineReplyAdapter.sendReply` starts reporting success/failure instead of swallowing it. On failure with an expired/used token (HTTP 400 from `/v2/bot/message/reply`), a new `sendPush(lineUserId, messages)` (`POST /v2/bot/message/push`) delivers the same messages. Rationale: with queueing, a reply can exceed the ~1-minute token life; silence after "บันทึกค่าใช้จ่าย" is the worst outcome for an accounting bot. Push consumes the OA monthly message quota (replies are free) — fallback use is logged (`line_push_fallback_used`) for quota monitoring.
- Loading animation: best-effort `POST /v2/bot/chat/loading/start` with `loadingSeconds: 60` after signature/legal/durable acceptance and before debounce. Only for 1:1 chats (`chatId === lineUserId` — the API does not support groups). It auto-dismisses when the reply arrives. Master toggle: `LINE_AI_LOADING_ANIMATION_ENABLED` (default true). Failures are ignored. **Default behavior:** loading starts when a batch begins processing. Accept-time loading (the spinner right after durable acceptance, before the debounce wait) is a **NON-DEFAULT, flag-gated opt-in** behind `LINE_AI_LOADING_ON_ACCEPT_ENABLED` (**default OFF**), a SUB-feature SUBORDINATE to the master switch — both must be on; with the master off there is no spinner anywhere (accept or processing-start), and with the accept flag off (the default) loading still starts at processing start (the legacy behavior).
- Waiting feedback (1:1 chats only): **media-only OCR sends one truthful received/processing acknowledgement immediately** and says normal chat may continue. For normal text, the timeline is anchored to the last accepted user bubble: collect bubbles for about 2 seconds, start LINE loading when processing begins, and—only if no real answer is ready by about second 5—push one short status. The copy is chosen deterministically from multiple upbeat variants relevant to the request (report, summary, comparison, calculation, analysis, search, business-system lookup, or generic work), so repeated turns do not show one fixed “ขอคิดสักครู่” sentence. Because an OA bubble dismisses LINE loading, restart loading 300 ms after the status push; cancel that restart if the real answer becomes ready first, and never let a status or restart appear after the answer. Commands and group chats keep the existing no-status behavior.

## 11. Shutdown Flush

`main.ts` gains `app.enableShutdownHooks()`. On SIGTERM (every ECS deploy), the buffer service's shutdown hook flushes all open buffers immediately and awaits both the main worker and media lane, bounded by the shutdown timeout within the ECS stop grace period. Hard crashes still lose open buffers from memory — recovered from the DB by Section 11.1.

## 11.1 Durable Replay of Orphaned Events

`acceptEvent` stores the `LineBufferEnvelope` on the `received` row it already writes before the 200 ack (no extra query). `RecoverOrphanLineEventsUseCase` runs on the `line-ai-ledger` worker tick (60 s, `POST /internal/ai/line-ledger/sweep-orphan-events`) and hands orphans back to `LineMessageBufferService.enqueue`, so fragment joining, ordering, dedup and the reply→push fallback are the live path's, not a second implementation.

- Candidates: `received` + `errorCode IS NULL`, or `delivery_pending` + `RETRYABLE_*` — i.e. only rows the employee never heard from. Rows released with a `RETRYABLE_*` code were already answered with an error reply; sweeping those would send a second one every minute.
- Replay bound: the sweep stamps `RETRYABLE_ORPHAN_REPLAY`, which `acceptEvent` clears only once the buffer has really taken the message back, so a second replay needs a second real crash. Past 60 minutes the row is parked `orphan_expired` instead of answering a stale question.
- The payload is cleared at every terminal write, so only in-flight and not-yet-swept rows hold a raw chat id.
- `LineWebhookEventLog` also gains retention (`AI_DATA_RETENTION_DAYS`, purged in the same sweep); it previously grew forever.
- Accepted residual: a crash between a successful `deliverReply` and its status write replays an already-answered message. At-least-once beats silence.

## 12. Multi-Instance Degradation (documented, accepted)

Prod deploys are ECS Express CANARY (5%, 3-minute bake) and application autoscaling exists, so two instances can serve traffic during bakes or scale-out. In-memory buffers then degrade gracefully:

- Fragments landing on different instances form separate smaller batches (behavior approaches today's per-event processing).
- Cross-instance reply ordering is not guaranteed during such windows.
- Dedup stays correct (DB-backed). No corruption, no double-processing, no data loss beyond today's behavior.
- If the API is ever scaled out permanently, the buffer must move to a shared store (Redis or DB lease) — out of scope, recorded as the trigger condition for a follow-up ADR.

## 13. Configuration

Env (via `AppConfigService`, following existing `LINE_MESSAGING_*` getter pattern):

- `LINE_AI_BUFFER_DEBOUNCE_MS` — implemented baseline `2000`; candidate defaults `1000` and `1500`; the smallest candidate inside the split-turn/re-ask/cost gates becomes the new default; `0` disables buffering (serialization remains).
- `LINE_AI_BUFFER_MAX_WAIT_MS` — default `8000`.
- `LINE_AI_LOADING_ANIMATION_ENABLED` — default `true`.

Constants in module code (not env): max 20 items / 4000 chars per batch, pending overflow guard, 2-minute orphan age, 60-minute orphan replay window (Section 11.1).

## 14. Failure Mode Matrix

| # | Scenario | Behavior | Mechanism |
|---|----------|----------|-----------|
| 1 | 3 fragments in one POST | 1 joined turn, 1 reply | buffer + segmentation |
| 2 | 3 fragments across POSTs within window | 1 joined turn | buffer keyed by chat, debounce |
| 3 | Fragment, 10 s pause, rest | 2 turns; second answered with context | semantic layer (CLARIFY + 16-turn memory), unchanged |
| 4 | Single complete message | 1 turn, +selected debounce latency | accepted trade-off, loading animation |
| 5 | Message while a text/command turn is processing | joins next batch, replies stay ordered | main serial queue |
| 5a | Message while an uncaptioned receipt is in OCR | main queue answers without waiting; receipt result may arrive later | serial media-only lane |
| 6 | Continuous typing (never idle) | flush every ≤8 s | max-wait anchored at first item |
| 7 | Flood (40+ msgs during one turn) | overflow items dropped + rate-limit reply + audit | pending-batch caps |
| 8 | `/company` while idle | immediate, no added latency | command fast path |
| 9 | `/company` after buffered query text | buffer flushes, query runs first, then switch | command = flush trigger, order preserved |
| 10 | Photo then caption (same window) | media turn with caption text | captionText into intake route |
| 11 | Caption then photo | same as 10 | text joins captionText regardless of position |
| 12 | Photo + unrelated question | media caption-less + question answered as text turn | BUSINESS_READ_QUESTION exception |
| 13 | N receipts + one caption | N media turns, same caption each | mixed-batch rule |
| 14 | Redelivery while original buffered | dropped | dedup: `received` + age < 2 min |
| 15 | Redelivery after completion | dropped | dedup: terminal status |
| 16 | Crash with open buffer | fragments replayed from `payloadJson` after 2 min and re-joined into one turn | Section 11.1 sweep (no OA redelivery needed) |
| 17 | Crash mid-processing | last event row stays `received` → replayed by the sweep; completed members marked `batched` | member bookkeeping order + Section 11.1 |
| 18 | Deploy (SIGTERM) | buffers flush before exit | shutdown hook |
| 19 | Canary bake / scale-out (2 instances) | split batches, per-event-like behavior, no corruption | Section 12 |
| 20 | Reply token expired (long queue) | push fallback delivers | Section 10 |
| 21 | AI Gateway down | one error reply per batch (not per fragment) | existing error path, batched |
| 22 | Unlinked / multi-company user sends fragments | one guidance reply per batch instead of one per fragment | guards run per segment |
| 23 | Group chat message | buffered under (groupId, userId); replies to the group; no loading animation | chat key |
| 24 | Sticker/location/postback | ignored, as today | controller filter unchanged |
| 25 | 5000-char paste | flushes at char cap | size caps |
| 26 | Webhook slow-response timeout at LINE | eliminated — 200 returns after enqueue (<~100 ms) | ack-fast intake |

## 15. Acceptance Criteria

- Three text fragments whose consecutive gaps are each below the selected debounce produce exactly one `AiTurn` and one LINE reply whose answer addresses the joined utterance.
- Two batches from the same user never interleave: replies arrive in send order (single instance).
- An uncaptioned receipt does not block a later text or rich-menu command; receipt jobs remain serial with each other and keep the company selected at acceptance.
- Webhook responds 200 without awaiting AI processing.
- `/company` from an idle chat has no added latency; `/company` sent after query fragments executes after that query.
- Image + caption bubble within one window produce one media turn whose intake route received the caption text.
- A duplicate `webhookEventId` never produces a second turn; a `received` row older than 2 minutes does not block a redelivered event.
- Expired reply token results in push delivery, not silence.
- SIGTERM with a non-empty buffer processes the buffered utterance before exit.
- With `LINE_AI_BUFFER_DEBOUNCE_MS=0`, behavior per event matches today's except serialized ordering.

## 16. Out of Scope / Future

- Redis/DB-backed buffer for multi-instance (trigger: permanent scale-out of the API service).
- LINE `unsend` removing a buffered fragment.
- Postback/quick-reply events as flush triggers (no postback handling exists yet).
- Attaching a late caption to an already-created expense draft (cross-batch; belongs to intake-router follow-up work).

## 17. Linked Docs

- [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
- [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
- [[specs/line-ai-local-agent-orchestration-spec|LINE AI Local Agent Orchestration Spec]]
- [[adr/0008-line-ai-access-and-auth|ADR 0008 LINE AI Access and Authentication]]
- Plan: [[plans/line-ai-message-buffering-plan|LINE AI Message Buffering Plan]]
- Follow-up: [[specs/line-ai-latency-and-autonomy-lanes-spec|LINE AI Latency and Autonomy Lanes]]
