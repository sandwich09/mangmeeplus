# Agent Memory: LINE AI waiting feedback

Status: Complete — revised after UAT 2026-08-21
Owner: Codex
Scope: Employee LINE AI 1:1 waiting UX only; no CRM customer auto-reply or group-chat change.
Decisions: Anchor normal-text UX to the last user bubble: collect bubbles for 2 seconds, start LINE loading at processing, push one deterministic but varied request-relevant status only if no answer is ready by second 5, and restart loading 300 ms after that bubble. Cancel pending status/restart when the answer is ready. Receipt OCR remains the exception: push one immediate truthful acknowledgement, keep OCR detached from normal chat, and order the acknowledgement before its final result.
Open questions: None.
Artifacts: `docs/specs/line-ai-message-buffering-spec.md`; LINE message-buffer logic/service/tests.
Verification: Final timeline regression verifies no loading before 2.0 seconds, loading at processing start, one status at 5.0 seconds from the last bubble, and loading restart at 5.3 seconds. The 219 focused LINE buffer/webhook tests passed; API typecheck passed; all 130 config tests passed.
Next: Deploy to UAT, then exercise one fast and one slow normal-text turn plus one receipt upload on a 1:1 LINE OA.
