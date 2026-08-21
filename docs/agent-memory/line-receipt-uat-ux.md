# Agent Memory: LINE receipt UAT UX

Status: Implemented and locally verified; ready for PR
Owner: Codex
Scope: Remove the false receipt-upload affordance and prevent media-only OCR from blocking later LINE chat turns; investigate the receipt-result web CTA separately.
Decisions:
- Native LINE camera/camera-roll Quick Replies are the only upload affordances; the decorative drop-zone is removed.
- Uncaptioned receipt OCR uses a per-chat serial media lane. The main text/command lane may continue, while captioned media keeps ordered processing.
- Snapshot the resolved company at durable acceptance for media so a later company switch cannot move the receipt across tenants.
- Send an immediate truthful media status that explicitly says the user may continue chatting.
- The existing web CTA is structurally a URI action and UAT responds, but bare deep links still require the separate security/session handoff decision in `docs/specs/line-web-deeplink-handoff-spec.md`.
Open questions:
- Owner decision: should LINE web links auto-sign-in the LINE-linked user through a single-use 15-minute handoff?
Artifacts:
- `docs/specs/line-rich-menu-v2-spec.md`
- `docs/specs/line-ai-message-buffering-spec.md`
Verification:
- `pnpm --filter @watchdog-bms/api typecheck` — passed.
- Focused prompt/buffer/service test set — passed.
- `line-message-buffer.service.spec.ts` — passed independently, including detached OCR, media serialization, caption ordering, durable company snapshot/replay, immediate feedback, and shutdown drain.
- `process-line-webhook.use-case.spec.ts` + `line-business-card.logic.spec.ts` — passed.
- Whole LINE-AI glob produced one pre-existing global timer/clock concurrency failure; the same buffer file passed independently before and after the glob run.
- `git diff --check` — passed.
Next: Stage only the LINE receipt files (preserve concurrent employee-access/advisor work), commit, push, and open a PR to `develop`. Keep authenticated web handoff outside this PR until the owner decision is recorded.
