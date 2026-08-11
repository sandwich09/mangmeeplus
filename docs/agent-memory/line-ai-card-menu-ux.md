# Agent Memory: line-ai-card-menu-ux

Status: Complete
Owner: Codex
Scope: Render completed employee LINE AI replies as Mangmee Flex cards, convert safe tenant links to URI buttons, and restore the permission-filtered staff Quick Reply menu after terminal turns.
Decisions:
- Reuse `line-business-card.logic.ts` and `line-staff-menu.logic.ts`; do not add a second card/menu system.
- Keep clarification, media-choice, and transient error replies focused on the pending action; attach the staff menu only when the turn is complete.
- Keep link validation tenant-scoped and server-derived. Raw external or cross-tenant URLs never become buttons.
- Respect LINE's current maximum of 13 Quick Reply actions.
Open questions: None.
Artifacts:
- `docs/specs/line-ai-assistant-ux-spec.md`
- `docs/specs/line-ai-read-only-assistant-spec.md`
- `docs/plans/line-ai-read-only-assistant-plan.md`
Verification:
- `corepack pnpm --dir apps/api exec tsx --test src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts` — 24/24 passed.
- `corepack pnpm --dir apps/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — 69/69 passed.
- `corepack pnpm --dir apps/api typecheck` — passed.
- `git diff --check` — passed.
Next: Deploy through the existing UAT workflow, then smoke-test a business answer, receipt completion, safe link button, completion menu, and clarification reply in the real LINE client.
