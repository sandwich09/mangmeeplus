# Agent Memory: env example sync for local, UAT, and production

Status: Safe defaults and the production CloudWatch Logs KMS key are configured. UAT
`CLAMAV_HOST=127.0.0.1` is configured and read back. Production is explicitly skipped:
production `CLAMAV_HOST` and `SECURITY_ALERT_TOPIC_ARN` remain unset.
Owner: Codex `/root`
Scope:
- Mirror the keys added to `.env.example` into local `.env`, Docker Compose,
  UAT/production workflows, ECS task rendering, and AgentCore deployment.
Decisions:
- Keep local-only values non-secret and preserve existing local overrides.
- Use explicit safe numeric defaults in UAT/production workflows.
- Keep KMS/SNS destinations and the DPO approval reference environment-owned; never invent
  resource identifiers or approval evidence. The co-located ClamAV host is deterministically
  `127.0.0.1`, but must not be enabled against an image that predates the daemon.
- Production remains pinned to Claude Sonnet 4.6 and fails closed without
  `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF`.
- Owner decision 2026-07-28: configure UAT now and skip all production changes until the
  persistent promotion checklist in `m14-clamav-provisioning.md` is complete.
Artifacts:
- `.env` (gitignored local configuration)
- `infra/docker/compose.local.yml`
- `.github/workflows/deploy-uat.yml`
- `.github/workflows/deploy-production.yml`
- `infra/prod-ecs-express/deploy.sh`
- `infra/ai-gateway/agentcore-deploy.sh`
- `infra/docker/production-image-security.spec.sh`
Verification:
- Every key added to `.env.example` in commit `23c61c08` is present in local,
  UAT workflow, production workflow, and applicable runtime rendering.
- Local `.env` now contains every current `.env.example` key (142/142) plus the
  existing local-only `CRM_AI_MIN_CONFIDENCE` and `DOCUMENT_AI_MODEL_ID` overrides.
  API, AI Gateway, and workers schema preflights all pass with `APP_ENV=local`.
- GitHub Environment variables were read back after writing on 2026-07-28:
  `uat` verified 18/18 with 0 mismatches and `production` verified 18/18 with
  0 mismatches.
- Production `LOG_KMS_KEY_ID` was validated as an enabled, single-Region,
  customer-managed symmetric encryption key. Its policy grants the scoped
  CloudWatch Logs service and production deploy role statements, and the exact
  ARN was read back successfully from the GitHub `production` environment.
- GitHub UAT `CLAMAV_HOST` was set to `127.0.0.1` and read back successfully on 2026-07-28.
Next:
- Keep UAT deploys dispatched from `develop`; run `30426182495` built
  `2d8776b6fa01`, but API/Web later rolled back because sharp's linux-x64 optional package
  was absent. The urgent UAT-only direct rollout at `276f32ec38a0` is now `SUCCESSFUL` for
  journey testing; the normal signed/scanned UAT/all pipeline follow-up remains recorded in
  `uat-environment.md`.
- Keep production skipped until `docs/agent-memory/m14-clamav-provisioning.md` section
  “Production promotion prerequisites” is fully satisfied.
- Provision or identify `SECURITY_ALERT_TOPIC_ARN`.
- Verify the present production `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` corresponds to actual
  DPO/legal evidence before enabling the global Sonnet 4.6 inference profile. The webhook key
  needs no GitHub value while the workflow retains its `none` deny-all default.
