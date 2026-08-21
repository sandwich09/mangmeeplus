# LINE AI Message Buffering Implementation Plan

## Status

Implemented and verified on 2026-07-05 (all three phases, shipped together after owner approved the 3 open questions: OA redelivery is enabled, +≤2.5 s default latency accepted, push-fallback quota accepted).

Historical implementation note: the running code still defaults to 2,500 ms. The proposed follow-up
compares 1,000 ms and 1,500 ms candidates plus loading after durable acceptance; see
[[plans/line-ai-latency-and-autonomy-lanes-plan|LINE AI Latency and Autonomy Lanes Plan]].

Implementation evidence: [[agent-memory/line-ai-message-buffering|Agent Memory: line-ai-message-buffering]].

## Linked Spec

- Spec: [[specs/line-ai-message-buffering-spec|LINE AI Message Buffering and Turn Serialization Spec]]
- Related: [[plans/line-ai-read-only-assistant-plan|LINE AI Read-Only Assistant Plan]], [[plans/line-ai-local-agent-orchestration-plan|LINE AI Local Agent Orchestration Plan]]

## Purpose

1. Fix today's concurrency bugs: parallel processing of same-delivery events (misordered replies, context races) and webhook ack delayed behind the 15 s AI call.
2. Add per-chat message buffering (debounce 2.5 s / max-wait 8 s) so multi-bubble utterances become one AI turn, including media + caption.
3. Make delayed replies deliverable (push fallback) and deploys lossless (shutdown flush).

## Phase 1 — Ack-fast + per-chat serialization

- [x] `line-ai/domain/logic/line-message-buffer.logic.ts`: pure item/segmentation/timing logic (time injected, no framework imports).
- [x] `parseLineCompanyCommand` moved to `line-ai-classifier.logic.ts` (shared by use case + buffer).
- [x] `line-ai/application/line-message-buffer.service.ts` (flat `application/` per repo convention, not `application/services/`): per-chat-key state, timers, serial worker loop, enqueue-time age-aware dedup, member `batched` bookkeeping.
- [x] `auth/presentation/line-webhook.controller.ts`: extracts `timestamp` + `chatId` (`groupId ?? roomId ?? userId`), enqueues, acks 200 without awaiting turns; per-event enqueue errors logged and skipped.
- [x] `process-line-webhook.use-case.ts`: dedup relaxed to "row exists with terminal status" in both text and media paths.
- [x] Wired in `line-ai.module.ts` (provider + export).
- [x] `LINE_AI_BUFFER_DEBOUNCE_MS=0` = serialize-only mode (per-event turns, ordered) — covered by a dedicated test.

## Phase 2 — Debounce buffering + segmentation + media caption

- [x] Debounce (default 2500 ms) / max-wait anchored at first bubble (default 8000 ms) / caps 20 items / 4000 chars; env via `@watchdog-bms/config` schema + `AppConfigService` getters.
- [x] Text joined with `\n`; synthesized event carries the LAST bubble's id/token; items sorted by LINE timestamp (arrival seq tie-break).
- [x] `executeReceiptUpload(event, captionText?)` → caption feeds `tryRouteIntake.messageText` (was hardcoded `''`); caption included in intake-turn memory previews.
- [x] Mixed-group rules incl. `BUSINESS_READ_QUESTION`/`UNSUPPORTED` + caption → `defer_text` outcome (media log status `caption_deferred_to_text`, caller runs the text turn).
- [x] Command fast path when idle; command with anything buffered/in flight = flush trigger preserving send order.
- [x] Merge-into-pending (structural queue-depth bound) + overflow guard: drop newest, one Thai rate-limit reply per episode, `rate_limited` log status, `ai.line.flood_dropped` audit entries.

## Phase 3 — Delivery hardening

- [x] `line-reply.adapter.ts`: `sendReply` returns `LineDeliveryResult` (`400` → `failed_token`); `sendPush`; `startLoadingAnimation` (60 s, 2 s timeout, best-effort).
- [x] Push fallback centralized in the use case's `deliverReply` helper (all 36 reply sites route through it); fallback logged as `line_push_fallback_used`; target = `pushTargetId ?? lineUserId` (group-safe).
- [x] `main.ts`: `app.enableShutdownHooks()`; buffer `onModuleDestroy` flushes open buffers and drains workers with a 25 s bound.
- [x] Loading animation for 1:1 chats only, toggle `LINE_AI_LOADING_ANIMATION_ENABLED` (default true).

## Verification (run 2026-07-05, Node 22.14.0)

- `pnpm -C apps/api test` → 975 tests / 0 fail (includes 2 new spec files added to the `test` script list: `line-message-buffer.logic.spec.ts` 14 tests, `line-message-buffer.service.spec.ts` 16 tests, plus new cases in controller/classifier/use-case/intake specs).
- `pnpm -C packages/config test` → 46 / 0 fail (new env vars have defaults; production validation unaffected).
- `tsc --noEmit`: no errors in any file touched by this change (pre-existing errors from unrelated concurrent work in auth/email + crm-inbox remain and are not part of this scope).
- `line-webhook-local-smoke.ts` gained `SMOKE_SCENARIO=fragments` (3 bubbles in one delivery → expect ONE joined `requestLineTurn` in API logs). Requires local API + AI Gateway + seeded identity — not run in this pass.

## Post-deploy checks (manual, dev OA)

1. Type `ขอ` / `รายชื่อ` / `ลูกค้า` quickly → single coherent reply after ~2.5 s.
2. Send a receipt photo then `บันทึกค่าใช้จ่าย` within the window → one draft whose intake route saw the caption.
3. `/companies` while idle → replies as fast as before.
4. Watch logs for `line_push_fallback_used` (quota) and `LINE buffer overflow` (flood) counters.
