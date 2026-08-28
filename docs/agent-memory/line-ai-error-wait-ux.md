# Agent Memory: LINE AI error & waiting UX message map

Status: Implemented; specs and tests updated; delivering via develop → main (2026-08-29)
Owner: thawatchai (approved the message map in chat, 2026-08-29)
Scope: LINE AI waiting/failure/recovery feedback only — no routing, capture, or permission changes.

Decisions:

- Owner approved a full message map for image-error and long-silence cases; three principles bind it:
  every message states what happened / data state / who acts next; exactly one retry owner per
  failure; no silence longer than ~60 s between acceptance and the terminal reply.
- OCR context: Typhoon OCR is fully removed (`70dcf631`); reads are model vision (`6d9845a1`).
  Internal names still say "ocr". PR #332 fixed the truncation that failed 6/6 real receipts.
- Keeps the Owner 2026-08-27 "quieter waiting" decision: with the spinner on, quick text turns stay
  bubble-free. New: ONE slow-turn status at 55 s (before the 60 s spinner ceiling) in both animation
  modes, restarting loading to cover the stretch to the 120 s timeout. With the animation disabled
  the 5 s topic status returns as the fallback (it had silently become dead code — the old guard
  returned a noop whenever the animation flag was off).

What changed (all in apps/api/src/modules/line-ai/ + 2 specs):

- `domain/logic/line-message-buffer.logic.ts` — media ack now sets "ปกติไม่เกิน 1 นาที" expectation;
  new `LINE_WAIT_STATUS_SLOW_DELAY_MS` (55 s), slow-status texts, and `lineWaitStages()` as the
  single source of each turn's waiting ladder.
- `application/line-message-buffer.service.ts` — `withWaitFeedback`/`startWaitFeedback` take a stage
  list; media = ack@0 + slow@55 s, text = (topic@5 s when animation off) + slow@55 s.
- `application/use-cases/process-line-webhook.use-case.ts` — `MEDIA_DOWNLOAD_FAILED_REPLY` (bytes
  never arrived → provably nothing recorded, resend the photo), `MEDIA_PROCESSING_FAILED_REPLY`
  (state uncertain → no false promise, duplicate warning covers resend);
  `formatOcrGovernanceClarifyReply(errorCode, readFailed)` admits a transient read failure instead of
  the bare "รูปนี้เป็นอะไรคะ" menu.
- `domain/logic/line-ai-formatter.logic.ts` — `ai_timeout` copy tells the user to send the same
  question again.
- `application/use-cases/recover-orphan-line-events.use-case.ts` — §8.3 outcome replay pushes a
  context prefix naming the question (stored payload verbatim; a full 5-message payload drops the
  prefix, never the answer). Legacy input replay unchanged (recomputes; no prefix).
- Specs: `line-ai-assistant-ux-spec.md` gained the message-map section + acceptance items;
  `line-ai-latency-and-autonomy-lanes-spec.md` §10 records the 55 s slow status and the
  spinner-replaces-5 s-status rule.

Key non-bug: media download fail releases `RETRYABLE_LINE_MEDIA_DOWNLOAD_FAILED` but the orphan
sweep deliberately skips errorCode-carrying rows — there is no double-reply retry; only LINE
redelivery replays it. The reply text was the only defect.

Open questions: none blocking.

Artifacts: branch `codex/line-ai-error-wait-ux` (worktree
`/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-line-ux-feedback`, base origin/main 7a777eec).

Verification: `pnpm exec tsc --noEmit` clean; `tsx --test` on the five touched spec files:
process-line-webhook 167/167, buffer service + buffer logic + orphan recovery + formatter 116/116.
Updated tests: spinner-until-slow-status ladder, animation-off 5 s fallback, read-failure clarify
lead-in, upload-error reply, §8.3 prefix + 5-message-cap.

Next: PR into develop, merge, then PR develop→main, merge (owner instructed both merges in chat).
