# Agent Memory: LINE AI waiting feedback

Status: Complete — revised after UAT 2026-08-21
Owner: Codex
Scope: Employee LINE AI 1:1 waiting UX only; no CRM customer auto-reply or group-chat change.
Decisions: Keep LINE's native loading animation first. If a normal text turn is still running after 4 seconds, push exactly one deterministic but varied, request-relevant status instead of repeating “ขอคิดสักครู่”; restart loading 750 ms later so the status bubble reaches the device first, and cancel both pending status/restart when the answer is ready. Receipt OCR remains the exception: push one immediate truthful acknowledgement, keep OCR detached from normal chat, and order the acknowledgement before its final result.
Open questions: None.
Artifacts: `docs/specs/line-ai-message-buffering-spec.md`; LINE message-buffer logic/service/tests.
Verification: `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=tap src/modules/line-ai/domain/logic/line-message-buffer.logic.spec.ts src/modules/line-ai/application/line-message-buffer.service.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — 219/219 passed. `pnpm --filter @watchdog-bms/api typecheck` — passed.
Next: Deploy to UAT, then exercise one fast and one slow normal-text turn plus one receipt upload on a 1:1 LINE OA.
