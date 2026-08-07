# Agent Memory: LINE owner media and sales regression

Status: Implemented and focused-verified locally on 2026-07-12; not deployed
Owner: Product owner / Codex
Scope: Shared WatchDog LINE OA owner flow, receipt/signature media persistence, sales summary read routing, mixed enabled/disabled intent handling
Decisions:
- The screenshots do not show an OWNER RBAC failure. `/company` and text expense capture prove identity, company context, and expense grants resolve successfully.
- LINE media must PUT the exact downloaded bytes and MIME type to the storage upload intent before attachment completion. The same shared step covers receipt/PDF evidence and signature images.
- `sales.get_sales_summary` is now a permission-checked API tool. Its first slice reports recorded received customer payments by Bangkok-time period and currency; it does not claim booked/accrual revenue.
- Mixed requests retain enabled intents as `PARTIAL` and append an honest availability note instead of collapsing the whole turn when one tool is disabled.
- Existing entitlement policy remains unchanged: OWNER gets all entitled company permissions but does not bypass disabled partner features.
Open questions:
- The two failed production image attempts likely left DRAFT expenses with PENDING_UPLOAD attachments. Inspect and clean them only with explicit owner approval.
- Production deploy and a real OWNER LINE smoke are still required before calling the live bug closed.
Artifacts:
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts`
- `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts`
- `apps/api/src/modules/line-ai/line-ai.module.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts`
- `packages/contracts/src/ai-tools.ts`
- `docs/specs/line-ai-read-only-assistant-spec.md`
Verification:
- Focused API LINE/tool suites: PASS, 80 tests (79-test combined run plus the added sales-controller dispatch regression rerun).
- Focused AI Gateway router/orchestrator/turn suites: PASS, 38 tests.
- Contracts typecheck: PASS.
- API typecheck: PASS after the concurrent CRM worktree returned to a type-consistent state.
- AI Gateway typecheck: PASS.
- `git diff --check`: PASS at handoff.
- Read-only CloudWatch check confirmed the production webhook sequence at 10:52-10:55 Asia/Bangkok. Precise exception text was unavailable because the API disables Nest Logger output.
Next:
- Deploy API + AI Gateway + AgentCore/runtime artifact together through the established ECS canary path.
- Real smoke as linked OWNER: ask today's sales/expense summary, send JPEG/PNG receipt, send PDF evidence, and verify web download bytes plus review draft.
- Inspect failed-attempt orphan records before any cleanup mutation.
