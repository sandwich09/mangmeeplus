# Agent Memory: UAT LINE AI 24h Hotfix

Status: Deployed to UAT; live LINE acceptance pending.
Owner: Codex
Scope: Make the first customer LINE message reach CRM AI after a newly connected UAT channel becomes active; keep UAT API, AI Gateway, and workers continuously available.
Decisions:
- Preserve `ACTIVE` as the autonomy/security gate.
- After the signed customer webhook transaction promotes `CONNECTED` to `ACTIVE`, pass the promoted status to the inbound pipeline in the same request.
- Keep ECS Express `minTaskCount: 1` for API, AI Gateway, and workers.
Open questions: None.
Artifacts:
- `apps/api/src/modules/crm-inbox/presentation/http/crm-line-webhook.controller.ts`
- `apps/api/src/modules/crm-inbox/presentation/http/crm-line-webhook.controller.spec.ts`
Verification:
- Focused controller regression: 6 tests passed, 0 failed.
- UAT run `30167794331` deployed source `676122c1760630c3b63e331a9501c287ca17a47b`; tests, immutable images, release task, rollout, digest verification, and health checks passed.
- AWS readback shows API, AI Gateway, and workers `ACTIVE` on `GIT_SHA=676122c17606`, each with `minTaskCount=1,maxTaskCount=2`.
- Public API health, AI Gateway health, and UAT login returned HTTP 200.
- Live LINE evidence remains pending.
Next: Send one real customer LINE message and verify `crm.autonomy.job_gate created:true` plus the AI reply.
