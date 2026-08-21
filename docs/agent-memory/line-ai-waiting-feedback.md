# Agent Memory: LINE AI waiting feedback

Status: Implemented and locally verified — revised after UAT 2026-08-21; redeploy/device UAT pending
Owner: Codex
Scope: Employee LINE AI 1:1 waiting UX only; no CRM customer auto-reply or group-chat change.
Decisions: Anchor normal-text UX to the latest durable acceptance across the turn: collect bubbles for 2 seconds, start LINE loading at processing, push one deterministic but varied request-relevant status only if no answer is ready by second 5, restart loading 300 ms after that bubble, and send one cancellable keepalive at 1,300 ms for slow device delivery. Cancel pending status/restarts when the answer is ready. Receipt OCR remains the exception: push one immediate truthful acknowledgement, keep OCR detached from normal chat, and order the acknowledgement before its final result. A gap greater than 2 seconds intentionally starts a new turn; watch split-turn/duplicate/re-ask metrics rather than hiding this boundary with extra wait.
Open questions: None.
Artifacts: `docs/specs/line-ai-message-buffering-spec.md`; LINE message-buffer logic/service/tests.
Verification: Timeline regressions verify no loading before 2.0 seconds, loading at processing start, one status at 5.0 seconds from the latest durable acceptance even when LINE timestamps reorder, loading restart at 5.3 seconds, and one cancellable keepalive at 6.3 seconds. Current follow-up checks: buffer logic/service 88/88, API typecheck passed, config 130/130. Read-only UAT ECS inspection found no overrides for `LINE_AI_BUFFER_DEBOUNCE_MS`, `LINE_AI_LOADING_ON_ACCEPT_ENABLED`, or `LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED`, so the next deployed build will use the reviewed defaults. Any debounce experiment after this change starts a fresh 1,000/1,500/2,000 ms window; historical 2,500 ms observations are not combined.
Next: Deploy to UAT, then exercise one fast and one slow normal-text turn plus one receipt upload on a 1:1 LINE OA.
