# Agent Memory: M-03 deterministic LINE outbound policy

Status: Complete
Owner: Codex
Scope: Deterministic policy for autonomous company LINE OA replies; model `needsHuman` signal handling; URL-domain allowlist; current-version human approval for templates; focused API/Gateway/web verification; security checklist evidence.
Decisions:
- Enforce content policy in the API use case that owns the autonomous send decision; AI Gateway remains stateless and tool-less.
- Route URL/domain, payment, commitment, PII, and model-human signals to the existing deduplicated staff-handoff flow.
- Empty `CRM_AI_OUTBOUND_ALLOWED_DOMAINS` fails closed for every URL; wildcard subdomains require explicit `*.` entries.
- ACTIVE quick replies remain usable by staff, while autonomous context uses only AI-approved current versions.
- Re-run the same deterministic policy at the durable AI delivery-retry boundary so pre-deploy pending drafts cannot bypass the new initial-send gate.
- Template approval is current-version conditional, stores reviewer/time/version as one consistent set, and returns conflict when a concurrent edit invalidates the reviewed version.
Open questions: None.
Artifacts:
- `docs/specs/crm-line-oa-customer-os-spec.md` §34
- `docs/plans/crm-line-oa-customer-os-plan.md` Phase 4 M-03 work
- `apps/api/src/modules/crm-inbox/domain/logic/crm-auto-reply.logic.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/crm-ai-auto-reply.use-case.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/retry-crm-inbox-deliveries.use-case.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/crm-template.use-case.ts`
- `apps/api/prisma/migrations/20260728120000_m03_crm_ai_outbound_policy/migration.sql`
- `apps/ai-gateway/src/modules/crm-customer-ai/agents/crm-customer-reply.agent.ts`
- `apps/web/src/features/crm-inbox/InboxPage.tsx`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/deploy-uat.yml`
- `infra/prod-ecs-express/deploy.sh`
- `infra/docker/compose.local.yml`
- `docs/security-remediation-checklist-merged-2026-07-17.md`
Verification:
- Focused API policy/lifecycle/integration/retry/repository suite: 201/201 passed.
- Full API suite: 2516/2516 passed.
- Full AI Gateway suite: 458/458 passed.
- Config suite: 58/58 passed.
- API, AI Gateway, Web, and Contracts typechecks: passed.
- Prisma schema validation and `git diff --check`: passed.
- Outbound allowlist deployment wiring: production image security scanner, deploy shell syntax, and Docker Compose config passed.
- Local allowlist: `localhost,127.0.0.1,mangmeeplus.com,uat.mangmeeplus.com`.
- Live UAT ECS exact-host allowlist: `uat.mangmeeplus.com`; config-only canary rollout `SUCCESSFUL`.
- Live production ECS exact-host allowlist: `mangmeeplus.com`; config-only canary rollout `SUCCESSFUL`.
- GitHub Actions Environment variables verified by readback: `uat` = `uat.mangmeeplus.com`; `production` = `mangmeeplus.com`.
- Docker/local PostgreSQL was unavailable, so the additive migration was schema/SQL reviewed but not replayed against a disposable database in this workspace.
Next: Deploy the M-03 application and additive migration through clean CI, then smoke-test sanitized deny/allow audit events before enabling autonomous replies. The allowlists are already configured and durable across the patched UAT/production workflows. Emergency rollback is `CRM_AUTO_REPLY_ENABLED=false`.
