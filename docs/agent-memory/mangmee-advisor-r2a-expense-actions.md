# Agent Memory: mangmee-advisor-r2a-expense-actions

Status: implemented and locally verified (2026-10-15), diff left uncommitted.
Owner: Round 2 lane A
Scope: MARK_READY, CONFIRM, DELETE_DRAFT, VOID through LINE preview and explicit confirm/cancel buttons; no gateway final mutations.
Decisions:
- Full-capability plan principle 1: model can call only expense.action.preview, always available in draft_update category with expenses entitlement and permission anyOf. Existing final-mutation policy/flags unchanged; no new dependencies, flags or package.json changes.
- Preview uses GetExpenseUseCase and real web eligibility, stopping before business writes. Delete reuses its full read-only guards (claim ownership, retention, linked data and attachment holds). Confirm preserves the ordinary LINE execute refusal and exposes a postback-only entry that repeats the same validators. Mark-ready preserves reviewer/own-updater rules and rejected-record reopening. Void preserves financial-state, claim, certificate, reservation and period guards.
- Target IDs must come from expense records actually shown, current own chat captures or active drafts. Both gateway sanitizers and the API enforce provenance; the API re-reads the current record using the user's RequestContext.
- Reuse LineDraftPreviewStore with an isolated action namespace, atomic claim and short applied receipt. HMAC binds action ID, user, company, membership, chat, conversation epoch, revision, source digest, card facts, reason and ten-minute expiry. Postback re-resolves membership/access/feature and calls the existing web use-case with authProvider=line; revision reaches the write CAS/transaction.
- Confirm/cancel survives signature-verified webhook ingress, buffering and orphan recovery. Group/room writes are refused. Replays do not execute again. Stale source/revision, changed access, forged tokens and expired/replaced/cancelled cards refuse safely.
- API builds Thai confirm/result cards. Durable delivery checks pending/applied source revisions, binds the signed button after all required facts, and retains buttons in text fallback. Mixed action cards cannot borrow a read-only legacy replay authorization.
Open questions: none within the requested input contract. VOID requiring separate tax-filing/certificate attestation returns the existing guard's Thai explanation; no attestation is granted automatically.
Artifacts: docs/plans/mangmee-advisor-full-capability-plan-th.md; docs/research/mangmee-ai-capability-manifest-2026-09-27.json; /private/tmp/round-2-lane-a-last-message.md.
Verification:
- pnpm --filter @watchdog-bms/contracts build — PASS.
- pnpm --filter @watchdog-bms/api typecheck — PASS (package script, no bare tsc).
- pnpm --filter @watchdog-bms/ai-gateway typecheck — PASS.
- API node --import tsx --test: line-draft-update.security, delete-expense.use-case, expense-branch-scope.use-case, void-expense-true-reversal.use-case, line-message-buffer.service, recover-orphan-line-events.use-case, auth/line-webhook.controller, process-line-webhook.use-case, erp-draft-update-tools.di — 724/724 PASS. Final process-line-webhook rerun after legacy-replay authorization tightening — 445/445 PASS.
- Gateway node --import tsx --test: orchestrator.agent, agent-tools.registry, agent-tools.parity, intent-router.agent, erp-tool.client — 321/321 PASS.
- UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts — 5/5 PASS; artifact regenerated after final source edits.
- New tests remain in registered specs. Real web validators cover all four preview permission/status cases, own-delete, missing VOID reason, exact user context, stale/revoked scope, signed token/user/company/membership/chat/epoch/expiry, replay, concurrent presses, cancel, source-bound result delivery, card labels, durable plan fallback and provenance in both API/gateway. Signature/buffer/recovery and group/feature/incomplete-delivery postback paths are covered.
- git diff --check — PASS; no package.json diff.
- No live LINE/browser/Postgres integration run: sandbox has no network/Docker. Repository/transaction boundaries exercised with fakes; existing business-validator regressions passed.
Next: review/integrate lane A with other round-2 lanes; live validation remains a later authorized environment step.
