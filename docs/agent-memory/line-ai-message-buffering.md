# Agent Memory: line-ai-message-buffering

Status: Implemented + unit-verified (2026-07-05). All three phases shipped together after owner approved: OA redelivery enabled, +≤2.5 s latency accepted, push quota accepted. Remaining: manual dev-OA E2E (plan "Post-deploy checks") and the `fragments` smoke scenario against a running stack.
Owner: thawatchai.phuchana
Scope: LINE AI webhook intake — buffer multi-bubble utterances into one AI turn, serialize turns per chat, ack webhook fast, push fallback for expired reply tokens. Turn pipeline internals and AI Gateway contracts unchanged.
Decisions:
- Buffer service lives at `line-ai/application/line-message-buffer.service.ts` (flat `application/`, matching audit module convention — plan originally said `application/services/`).
- Pure logic split into `domain/logic/line-message-buffer.logic.ts` (no framework/timer imports; time injected) per repo domain-logic style.
- Caption scope = content group between commands (refined from batch-level during implementation; spec §8 updated).
- `executeReceiptUploadInner` returns `LineMediaTurnOutcome | undefined` so ~15 existing bare `return;` paths stay untouched; wrapper coalesces to `{outcome:'done'}`.
- All 36 reply sites route through a `deliverReply(event, text)` helper (perl structural replace, verified 36→0 leftovers) — push fallback + `line_push_fallback_used` counter live in one place; push target `pushTargetId ?? lineUserId`.
- Dedup at enqueue is create-first (unique-violation → inspect row) to close the findUnique/create race; use-case dedup relaxed to skip only terminal statuses; orphan window 2 min.
- Worker-loop race fixed by design: `processing=false` + pending re-check happen synchronously in the loop's `finally` (a microtask-interleaved flush cannot strand a pending batch).
- Prisma Client reconnects lazily after `$disconnect`, so Nest destroy-hook ordering vs PrismaService is not correctness-critical for the shutdown flush.
- New env (all with defaults, added to `@watchdog-bms/config` zod schema): `LINE_AI_BUFFER_DEBOUNCE_MS` (2500; 0 = serialize-only), `LINE_AI_BUFFER_MAX_WAIT_MS` (8000), `LINE_AI_LOADING_ANIMATION_ENABLED` (true).
- Event-log statuses added (free-form string column, no migration): `batched`, `rate_limited`, `caption_deferred_to_text`.
Open questions: none blocking. Future (spec §16): Redis/DB-lease buffer if the API scales out permanently; LINE `unsend` removal; postback flush triggers.
Artifacts: docs/specs/line-ai-message-buffering-spec.md; docs/plans/line-ai-message-buffering-plan.md. Code: line-message-buffer.logic.ts/.service.ts (+specs), line-webhook.controller.ts (+spec rewrite — old spec asserted the inverted "waits before 200" behavior), process-line-webhook.use-case.ts, line-reply.adapter.ts, line-ai-classifier.logic.ts (+parseLineCompanyCommand move), line-ai.module.ts, app-config.service.ts, packages/config/src/index.ts, main.ts (enableShutdownHooks), line-webhook-local-smoke.ts (fragments scenario), apps/api/package.json (test list).
Verification: `pnpm -C apps/api test` 975/975 pass; `packages/config` 46/46; `tsc --noEmit` clean for all touched files (pre-existing unrelated errors from concurrent auth-email/crm-inbox work remain). Node 22.14.0 via nvm (shell default v14 is too old for pnpm).
Next: owner runs post-deploy checks on dev OA; consider enabling the `fragments` smoke in the local runbook.
