# Agent Memory: LINE/AI R1 Remediation

Status: Implemented and focused verification passed 2026-08-10.
Owner: Platform/AI.
Scope: Close the three LINE/AI R1 findings in the 2026-08-09 production-readiness audit: monthly
budget concurrency, Bedrock timeout spend undercount, and unbounded LINE media buffering.
Decisions:
- Monthly budget admission is one distributed Redis lease per company/Bangkok-month. The owner
  keeps it through the provider action and usage write; the admission month is pinned across the
  lease, spend read and ledger row so local-midnight crossings cannot split them. Production store
  loss fails closed.
- Exact cost is unknowable before completion, so one admitted action may cross the cap. Concurrent
  actions no longer multiply that overshoot and receive `AI_BUDGET_BUSY` without calling a model.
- Bedrock timeouts abort the SDK request. With no exact timeout response usage, meter the current
  approved-model ceiling (200k input plus requested max output); preserve real usage on parse error.
- LINE content is streamed with a running `uploadMaxBytes` cap and cancelled on overflow.
Open questions: None for this remediation. The 200k timeout ceiling must be reviewed if the approved
model list later admits a model with a larger input context.
Artifacts:
- API budget admission: `redis-rate-limit.service.ts`, `company-ai-usage-meter.ts`, and all five
  cost-bearing seams.
- Provider/media: `bedrock.provider.ts`, `process-line-webhook.use-case.ts`, contracts comment.
- Specs/audit: AI metering spec/plan, usage logging spec, consolidated readiness audit.
Verification:
- Focused API + DI-token guard: 131/131 passed (lease, month pin, meter race, LINE media,
  LINE/CRM/draft clients, injectable runtime tokens).
- Focused AI Gateway: 25/25 passed (abort, timeout estimate, real-usage preservation).
- AI Gateway typecheck passed.
- API typecheck reports only the pre-existing 14 errors in substitute-receipt/report specs; none in
  the touched LINE/AI files.
- API boot smoke was attempted but stops first at `PrismaExpenseRepository` constructor index 1
  from unrelated pre-existing dirty expense-repository work; the dedicated DI-token guard passes.
Next: Deploy through the normal release workflow and monitor `ai.budget.*` / `ai.usage` signals.
